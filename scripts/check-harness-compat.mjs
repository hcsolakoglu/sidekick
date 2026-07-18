import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(join(root, "docs", "tested-versions.json"), "utf8"));
const probe = process.argv.includes("--probe");
const issueBodyIndex = process.argv.indexOf("--issue-body");
const issueBodyPath = issueBodyIndex < 0 ? undefined : process.argv[issueBodyIndex + 1];
const headers = {
  Accept: "application/json",
  "User-Agent": "sidekick-compat-watch",
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
};

async function getJson(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

function numericParts(version) {
  return version
    .replace(/^v/, "")
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map(Number);
}

function isNewer(candidate, baseline) {
  const left = numericParts(candidate);
  const right = numericParts(baseline);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

function commandProbe(engine, command, args, required) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 30_000,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.error)
    return {
      engine,
      invocation: [command, ...args],
      missing: required,
      error: result.error.message,
    };
  const missing = required.filter((token) => !output.includes(token));
  if (result.status !== 0 || missing.length) {
    return { engine, invocation: [command, ...args], missing, exitCode: result.status };
  }
  return undefined;
}

function findFile(directory, expected) {
  if (!existsSync(directory)) return undefined;
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      const nested = findFile(path, expected);
      if (nested) return nested;
    } else if (entry.toLowerCase() === expected.toLowerCase()) return path;
  }
  return undefined;
}

function devinPlatform() {
  const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : undefined;
  if (!arch) throw new Error(`Devin probe does not support architecture ${process.arch}`);
  if (process.platform === "darwin") return `${arch}-apple-darwin`;
  if (process.platform === "linux") return `${arch}-unknown-linux`;
  if (process.platform === "win32") return `${arch}-pc-windows`;
  throw new Error(`Devin probe does not support platform ${process.platform}`);
}

async function downloadExecutable({ url, sha256, prefix, executableName }) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${prefix} artifact returned HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actualSha = createHash("sha256").update(bytes).digest("hex");
  if (sha256 && actualSha !== sha256.toLowerCase())
    throw new Error(`${prefix} artifact SHA-256 mismatch`);
  const directory = mkdtempSync(join(tmpdir(), `sidekick-${prefix.toLowerCase()}-probe-`));
  const archive = join(directory, basename(new URL(url).pathname));
  writeFileSync(archive, bytes);
  const unpacked = join(directory, "unpacked");
  const result = spawnSync("tar", ["-xf", archive, "-C", directory], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    rmSync(directory, { recursive: true, force: true });
    throw new Error(`could not extract ${prefix} probe: ${result.error?.message ?? result.stderr}`);
  }
  const executable = findFile(unpacked, executableName) ?? findFile(directory, executableName);
  if (!executable) {
    rmSync(directory, { recursive: true, force: true });
    throw new Error(`downloaded ${prefix} artifact contains no ${executableName}`);
  }
  return { executable, directory };
}

async function downloadDevin(manifest) {
  const platform = devinPlatform();
  const artifact = manifest.platforms?.[platform];
  if (!artifact?.url) throw new Error(`Devin manifest has no artifact for ${platform}`);
  return downloadExecutable({
    url: artifact.url,
    sha256: artifact.sha256,
    prefix: "Devin",
    executableName: process.platform === "win32" ? "devin.exe" : "devin",
  });
}

function claudeAssetName() {
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : undefined;
  if (!arch) throw new Error(`Claude probe does not support architecture ${process.arch}`);
  if (process.platform === "darwin") return `claude-darwin-${arch}.tar.gz`;
  if (process.platform === "linux") return `claude-linux-${arch}.tar.gz`;
  if (process.platform === "win32") return `claude-win32-${arch}.zip`;
  throw new Error(`Claude probe does not support platform ${process.platform}`);
}

async function downloadClaude(release) {
  const name = claudeAssetName();
  const artifact = release.assets.find((asset) => asset.name === name);
  const checksumAsset = release.assets.find((asset) => asset.name === "SHASUMS256.txt");
  if (!artifact || !checksumAsset)
    throw new Error(`Claude release has no ${name} or checksum asset`);
  const checksums = await fetch(checksumAsset.browser_download_url, { headers }).then(
    (response) => {
      if (!response.ok) throw new Error(`Claude checksums returned HTTP ${response.status}`);
      return response.text();
    },
  );
  const sha256 = checksums
    .split(/\r?\n/)
    .find((line) => line.trim().endsWith(name))
    ?.trim()
    .split(/\s+/)[0];
  if (!sha256) throw new Error(`Claude checksums do not list ${name}`);
  return downloadExecutable({
    url: artifact.browser_download_url,
    sha256,
    prefix: "Claude",
    executableName: process.platform === "win32" ? "claude.exe" : "claude",
  });
}

const codexMeta = await getJson(config.harnesses["codex-cli"].latestStableSource.url);
const devinMeta = await getJson(config.harnesses.devin.latestStableSource.url);
const claudeMeta = await getJson(config.harnesses.claude.latestStableSource.url);
const hermesRelease = await getJson(config.harnesses.hermes.latestStableSource.url);
const hermesVersion = hermesRelease.name?.match(/\bv?(\d+\.\d+\.\d+)\b/)?.[1];
if (!hermesVersion)
  throw new Error(`Hermes release name contains no package version: ${hermesRelease.name}`);
const latest = {
  "codex-cli": codexMeta.version,
  devin: devinMeta.version,
  claude: claudeMeta.tag_name.replace(/^v/, ""),
  hermes: hermesVersion,
};
const updates = Object.entries(latest)
  .filter(([name, version]) => isNewer(version, config.harnesses[name].testedVersion))
  .map(([name, version]) => ({
    engine: name,
    tested: config.harnesses[name].testedVersion,
    latest: version,
    adapter: config.harnesses[name].adapter,
    source: config.harnesses[name].latestStableSource.url,
  }));
const probeFailures = [];

if (probe) {
  const codexCommand = process.env.SIDEKICK_COMPAT_CODEX_CMD || "codex";
  for (const failure of [
    commandProbe(
      "codex-cli",
      codexCommand,
      ["exec", "--help"],
      ["--json", "--output-last-message"],
    ),
    commandProbe("codex-cli", codexCommand, ["exec", "resume", "--help"], ["SESSION_ID"]),
  ]) {
    if (failure) probeFailures.push(failure);
  }

  let claudeDownload;
  try {
    claudeDownload = await downloadClaude(claudeMeta);
    const failure = commandProbe(
      "claude",
      claudeDownload.executable,
      ["--help"],
      ["--print", "--resume", "--output-format"],
    );
    if (failure) probeFailures.push(failure);
  } finally {
    if (claudeDownload) rmSync(claudeDownload.directory, { recursive: true, force: true });
  }

  let devinDownload;
  try {
    devinDownload = await downloadDevin(devinMeta);
    const failure = commandProbe(
      "devin",
      devinDownload.executable,
      ["--help"],
      ["--prompt-file", "--model", "--permission-mode", "--resume", "--print"],
    );
    if (failure) probeFailures.push(failure);
  } finally {
    if (devinDownload) rmSync(devinDownload.directory, { recursive: true, force: true });
  }

  const hermesPackage = await getJson(`https://pypi.org/pypi/hermes-agent/${hermesVersion}/json`);
  const sourceDistribution = hermesPackage.urls.find((item) => item.packagetype === "sdist");
  if (!sourceDistribution)
    probeFailures.push({
      engine: "hermes",
      missing: ["source distribution"],
      error: "PyPI has no sdist",
    });
  else {
    const response = await fetch(sourceDistribution.url, { headers });
    if (!response.ok) throw new Error(`Hermes sdist returned HTTP ${response.status}`);
    const archive = gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf8");
    const required = ["--oneshot", "--resume", "--pass-session-id", "--model"];
    const missing = required.filter((flag) => !archive.includes(flag));
    if (missing.length)
      probeFailures.push({ engine: "hermes", invocation: [sourceDistribution.url], missing });
  }
}

const issueKeys = [
  ...updates.map((item) => `version:${item.engine}@${item.latest}`),
  ...probeFailures.map((item) => `flags:${item.engine}:${[...item.missing].sort().join(",")}`),
];
const markers = issueKeys.map(
  (key) =>
    `<!-- sidekick-harness-compat:${createHash("sha256").update(key).digest("hex").slice(0, 16)} -->`,
);
const report = {
  generatedAt: new Date().toISOString(),
  testedAt: config.checkedAt,
  latest,
  updates,
  probeFailures,
  needsIssue: updates.length > 0 || probeFailures.length > 0,
  markers,
};

if (issueBodyPath) {
  const updateRows = updates.length
    ? updates
        .map((item) => `| ${item.engine} | ${item.tested} | ${item.latest} | \`${item.adapter}\` |`)
        .join("\n")
    : "| None | - | - | - |";
  const failures = probeFailures.length
    ? probeFailures
        .map(
          (item) =>
            `- **${item.engine}**: missing ${item.missing.join(", ")} (${item.error ?? `exit ${item.exitCode}`})`,
        )
        .join("\n")
    : "- None.";
  writeFileSync(
    issueBodyPath,
    `${markers.join("\n")}\n## Harness compatibility watch\n\nTested versions are recorded in \`docs/tested-versions.json\`.\n\n| Harness | Tested | Latest stable | Affected adapter |\n| --- | --- | --- | --- |\n${updateRows}\n\n### Probe failures\n\n${failures}\n\nUpdate and exercise each affected adapter, then update the tested version only after the real-harness checks pass.\n`,
  );
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
