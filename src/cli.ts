#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { exportOneSession, resolveOutputPath } from "./export.js";
import { parseArgs, printHelp } from "./args.js";
import { resolvePickerSessions, resolveSelectedSessions } from "./selection.js";
import { CliError } from "./types.js";
import { runTui } from "./tui.js";

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    printHelp();
    return;
  }

  if (opts.tui) {
    const sessions = await resolvePickerSessions(opts);
    await runTui(opts, sessions);
    return;
  }

  const selected = await resolveSelectedSessions(opts);
  if (selected.length === 0) throw new CliError("没有可导出的会话");

  for (const sessionInfo of selected) {
    const outPath = resolveOutputPath(selected, opts, sessionInfo);
    await exportOneSession(sessionInfo, outPath, opts);
    process.stdout.write(`已导出：${outPath}\n`);
  }

  process.stdout.write(`完成：${selected.length} 个会话\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`错误：${message}\n`);
  process.exit(1);
});
