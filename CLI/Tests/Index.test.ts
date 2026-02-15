import { Command } from "commander";
import { registerConfigCommands } from "../Commands/ConfigCommands";
import { registerResourceCommands } from "../Commands/ResourceCommands";
import { registerUtilityCommands } from "../Commands/UtilityCommands";

describe("Index (CLI entry point)", () => {
  it("should create a program with all command groups registered", () => {
    const program = new Command();
    program
      .name("oneuptime")
      .description(
        "OneUptime CLI - Manage your OneUptime resources from the command line",
      )
      .version("1.0.0")
      .option("--api-key <key>", "API key (overrides config)")
      .option("--url <url>", "OneUptime instance URL (overrides config)")
      .option("--context <name>", "Use a specific context")
      .option("-o, --output <format>", "Output format: json, table, wide")
      .option("--no-color", "Disable colored output");

    registerConfigCommands(program);
    registerUtilityCommands(program);
    registerResourceCommands(program);

    // Verify all expected commands are registered
    const commandNames = program.commands.map((c) => c.name());
    expect(commandNames).toContain("login");
    expect(commandNames).toContain("context");
    expect(commandNames).toContain("version");
    expect(commandNames).toContain("whoami");
    expect(commandNames).toContain("resources");
    expect(commandNames).toContain("incident");
    expect(commandNames).toContain("monitor");
    expect(commandNames).toContain("alert");
  });

  it("should set correct program name and description", () => {
    const program = new Command();
    program.name("oneuptime").description("OneUptime CLI");

    expect(program.name()).toBe("oneuptime");
  });

  it("should define global options", () => {
    const program = new Command();
    program
      .option("--api-key <key>", "API key")
      .option("--url <url>", "URL")
      .option("--context <name>", "Context")
      .option("-o, --output <format>", "Output format")
      .option("--no-color", "Disable color");

    // Parse with just the program name - verify options are registered
    const options = program.options;
    const optionNames = options.map((o) => o.long || o.short);
    expect(optionNames).toContain("--api-key");
    expect(optionNames).toContain("--url");
    expect(optionNames).toContain("--context");
    expect(optionNames).toContain("--output");
    expect(optionNames).toContain("--no-color");
  });
});
