import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const files = ["integration", "snapshots", "unit"]
  .flatMap((directory) =>
    readdirSync(join("test", directory))
      .filter((file) => file.endsWith(".test.js"))
      .map((file) => join("test", directory, file)),
  )
  .sort();
const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...files], {
  stdio: "inherit",
  shell: false,
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
