import { Command, Option } from "commander";
import { buildProgram } from "../Program";
import * as fs from "fs";
import * as path from "path";

describe("Index (CLI entry point)", () => {
  it("reports the package version through --version", () => {
    const packageJson: { version: string } = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"),
    ) as { version: string };

    expect(buildProgram().version()).toBe(packageJson.version);
  });

  it("should create a program with all command groups registered", () => {
    const program: Command = buildProgram();

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
    const program: Command = buildProgram();

    expect(program.name()).toBe("oneuptime");
    expect(program.description()).toBe(
      "OneUptime CLI - Manage your OneUptime resources from the command line",
    );
  });

  it("should define global options", () => {
    const options: readonly Option[] = buildProgram().options;
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
