import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";

const files = ["integration", "snapshots", "unit"]
  .flatMap((directory) =>
    readdirSync(join("test", directory))
      .filter((file) => file.endsWith(".test.js"))
      .map((file) => join("test", directory, file)),
  )
  .sort();
// Test files use per-test temporary state and isolated SIDEKICK_HOME sandboxes,
// so they can run concurrently. Cap concurrency at the file count; override with
// SIDEKICK_TEST_CONCURRENCY (e.g. =1 to reproduce a serial-only failure).
const requested = Number.parseInt(process.env.SIDEKICK_TEST_CONCURRENCY ?? "", 10);
const concurrency =
  requested > 0 ? requested : Math.max(1, Math.min(files.length, availableParallelism()));
const result = spawnSync(
  process.execPath,
  ["--test", `--test-concurrency=${concurrency}`, ...files],
  {
    stdio: "inherit",
    shell: false,
  },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
