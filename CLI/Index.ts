#!/usr/bin/env npx ts-node

import { Command } from "commander";
import { registerConfigCommands } from "./Commands/ConfigCommands";
import { registerResourceCommands } from "./Commands/ResourceCommands";
import { registerUtilityCommands } from "./Commands/UtilityCommands";

const program: Command = new Command();

program
  .name("oneuptime")
  .description("OneUptime CLI - Manage your OneUptime resources from the command line")
  .version("1.0.0")
  .option("--api-key <key>", "API key (overrides config)")
  .option("--url <url>", "OneUptime instance URL (overrides config)")
  .option("--context <name>", "Use a specific context")
  .option("-o, --output <format>", "Output format: json, table, wide")
  .option("--no-color", "Disable colored output");

// Register command groups
registerConfigCommands(program);
registerUtilityCommands(program);
registerResourceCommands(program);

program.parse(process.argv);
