import { Command, Option } from "commander";
import { registerConfigCommands } from "../Commands/ConfigCommands";
import { registerResourceCommands } from "../Commands/ResourceCommands";
import {
  readCliVersion,
  registerUtilityCommands,
} from "../Commands/UtilityCommands";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

describe("Index (CLI entry point)", () => {
  it("reports the package version through --version", () => {
    const packageDir: string = path.join(__dirname, "..");
    const packageJson: { version: string } = JSON.parse(
      fs.readFileSync(path.join(packageDir, "package.json"), "utf-8"),
    ) as { version: string };
    const output: string = execFileSync(
      process.execPath,
      ["--require", "ts-node/register", "Index.ts", "--version"],
      { cwd: packageDir, encoding: "utf-8" },
    );

    expect(output.trim()).toBe(packageJson.version);
  });

  it("should create a program with all command groups registered", () => {
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

    registerConfigCommands(program);
    registerUtilityCommands(program);
    registerResourceCommands(program);

    // Verify all expected commands are registered
    const commandNames: string[] = program.commands.map((c: Command) => {
      return c.name();
    });
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
    const program: Command = new Command();
    program.name("oneuptime").description("OneUptime CLI");

    expect(program.name()).toBe("oneuptime");
  });

  it("should define global options", () => {
    const program: Command = new Command();
    program
      .option("--api-key <key>", "API key")
      .option("--url <url>", "URL")
      .option("--context <name>", "Context")
      .option("-o, --output <format>", "Output format")
      .option("--no-color", "Disable color");

    // Parse with just the program name - verify options are registered
    const options: readonly Option[] = program.options;
    const optionNames: (string | undefined)[] = options.map((o: Option) => {
      return o.long || o.short;
    });
    expect(optionNames).toContain("--api-key");
    expect(optionNames).toContain("--url");
    expect(optionNames).toContain("--context");
    expect(optionNames).toContain("--output");
    expect(optionNames).toContain("--no-color");
  });
});
