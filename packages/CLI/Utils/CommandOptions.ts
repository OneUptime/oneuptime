import { Command } from "commander";
import { CLIOptions } from "../Core/ConfigManager";

/*
 * The program's global options as a command sees them: --api-key, --url
 * and --context, read from the root program, which takes them wherever
 * they are on the command line.
 */
export function getParentOptions(cmd: Command): CLIOptions {
  let current: Command | null = cmd;

  while (current?.parent) {
    current = current.parent;
  }

  const opts: Record<string, unknown> = current?.opts() || {};

  return {
    apiKey: opts["apiKey"] as string | undefined,
    url: opts["url"] as string | undefined,
    context: opts["context"] as string | undefined,
  };
}
