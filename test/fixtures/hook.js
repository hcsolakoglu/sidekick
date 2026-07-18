import { appendFile } from "node:fs/promises";

await appendFile(
  process.argv[2],
  `${process.env.SIDEKICK_RUN_NAME}:${process.env.SIDEKICK_RUN_STATUS}:${process.env.SIDEKICK_RUN_EXIT_CODE}\n`,
);
