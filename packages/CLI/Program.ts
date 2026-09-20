import { Command } from "commander";
import { registerConfigCommands } from "./Commands/ConfigCommands";
import { registerResourceCommands } from "./Commands/ResourceCommands";
import {
  readCliVersion,
  registerUtilityCommands,
} from "./Commands/UtilityCommands";

/*
 * Build the CLI program. Kept out of Index.ts so tests can assert on the
 * real wiring without executing the entry point (which parses argv).
 */
export function buildProgram(): Command {
  const program: Command = new Command();

  program
    .name("oneuptime")
    .description(
      "OneUptime CLI - Manage your OneUptime resources from the command line",
    )
    .version(readCliVersion())
    .option("--api-key <key>", "API key (overrides config)")
    .option("--url <url>", "OneUptime instance URL (overrides config)")
    .option("--context <name>", "Use a specific context")
    .option("-o, --output <format>", "Output format: json, table, wide")
    .option("--no-color", "Disable colored output");

  // Register command groups
  registerConfigCommands(program);
  registerUtilityCommands(program);
  registerResourceCommands(program);

  return program;
}
