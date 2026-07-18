import { homedir, release } from "node:os";
import { join, win32 } from "node:path";
import type { EngineName } from "./engines/types.js";

export type SupportLevel = "supported" | "beta" | "unsupported";

export interface EnginePlatformSupport {
  level: SupportLevel;
  detail: string;
}

export interface PromptSupport {
  transport: "stdin" | "prompt-file" | "argv";
  limit: string;
}

export function enginePromptSupport(
  engine: EngineName,
  platform: NodeJS.Platform = process.platform,
): PromptSupport {
  if (engine === "codex" || engine === "claude")
    return {
      transport: "stdin",
      limit: "no Sidekick transport limit; model context still applies",
    };
  if (engine === "devin" || engine === "mock")
    return {
      transport: "prompt-file",
      limit: "no Sidekick transport limit; model context still applies",
    };
  return {
    transport: "argv",
    limit:
      platform === "win32"
        ? "keep prompts below 24 KiB; Windows process command lines are limited to 32,767 characters"
        : "99,941 bytes verified; OS argv and model context limits still apply",
  };
}

export function isWsl(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.WSL_DISTRO_NAME) || /microsoft/iu.test(release());
}

export function platformLabel(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return platform === "linux" && isWsl(env) ? "wsl" : platform;
}

export function enginePlatformSupport(
  engine: EngineName,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): EnginePlatformSupport {
  const label = platformLabel(platform, env);
  if (engine === "mock") return { level: "supported", detail: "bundled test engine" };
  if (!["linux", "darwin", "win32"].includes(platform)) {
    return { level: "unsupported", detail: `${engine} does not document support for ${label}` };
  }
  if (engine === "hermes" && platform === "win32") {
    return {
      level: "beta",
      detail:
        "native Windows is early beta; WSL2 is the battle-tested path; Hermes oneshot prompts use argv, so keep them below 24 KiB natively",
    };
  }
  if (engine === "devin" && platform === "win32") {
    return { level: "supported", detail: "native CLI supported; Devin sandbox mode requires WSL2" };
  }
  if (engine === "claude" && platform === "win32") {
    return { level: "supported", detail: "native CLI supported; sandboxing requires WSL2" };
  }
  if (engine === "codex" && platform === "win32") {
    return { level: "supported", detail: "native PowerShell and WSL2 are supported" };
  }
  return { level: "supported", detail: `${label} is supported` };
}

export function engineStatePath(
  engine: EngineName,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const home = env.USERPROFILE || homedir();
  const joinPath = (...parts: string[]) =>
    platform === "win32" ? win32.join(...parts) : join(...parts);
  switch (engine) {
    case "codex":
      return env.CODEX_HOME || joinPath(home, ".codex");
    case "devin":
      return platform === "win32"
        ? joinPath(env.APPDATA || joinPath(home, "AppData", "Roaming"), "devin", "cli")
        : joinPath(env.XDG_DATA_HOME || joinPath(home, ".local", "share"), "devin", "cli");
    case "claude":
      return env.CLAUDE_CONFIG_DIR || joinPath(home, ".claude");
    case "hermes":
      return (
        env.HERMES_HOME ||
        (platform === "win32"
          ? joinPath(env.LOCALAPPDATA || joinPath(home, "AppData", "Local"), "hermes")
          : joinPath(home, ".hermes"))
      );
    case "mock":
      return "bundled";
  }
}
