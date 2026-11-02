import { Command } from "commander";
import { registerConfigCommands } from "./Commands/ConfigCommands";
import { registerDeployCommands } from "./Commands/DeployCommands";
import { registerResourceCommands } from "./Commands/ResourceCommands";
import {
  readCliVersion,
  registerUtilityCommands,
} from "./Commands/UtilityCommands";
import { createJsonOption, createOutputOption } from "./Core/OutputFormatter";
import { useHelpLayout } from "./Core/HelpLayout";

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
    .addOption(createOutputOption())
    .addOption(createJsonOption())
    .option("--no-color", "Disable colored output");

  /*
   * Before any command is made: each takes its help's layout from its
   * parent when it is made (Core/HelpLayout).
   */
  useHelpLayout(program);

  // Register command groups
  registerConfigCommands(program);
  registerUtilityCommands(program);
  registerDeployCommands(program);
  registerResourceCommands(program);

  return program;
}
