import { Command } from "commander";
import { registerUtilityCommands } from "../Commands/UtilityCommands";
import * as ConfigManager from "../Core/ConfigManager";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CONFIG_DIR: string = path.join(os.homedir(), ".oneuptime");
const CONFIG_FILE: string = path.join(CONFIG_DIR, "config.json");

describe("UtilityCommands", () => {
  let originalConfigContent: string | null = null;
  let consoleLogSpy: jest.SpyInstance;
  let exitSpy: jest.SpyInstance;

  beforeAll(() => {
    if (fs.existsSync(CONFIG_FILE)) {
      originalConfigContent = fs.readFileSync(CONFIG_FILE, "utf-8");
    }
  });

  afterAll(() => {
    if (originalConfigContent) {
      fs.writeFileSync(CONFIG_FILE, originalConfigContent, { mode: 0o600 });
    } else if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE);
    }
  });

  beforeEach(() => {
    if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE);
    }
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = jest.spyOn(process, "exit").mockImplementation((() => {}) as any);
    delete process.env["ONEUPTIME_API_KEY"];
    delete process.env["ONEUPTIME_URL"];
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env["ONEUPTIME_API_KEY"];
    delete process.env["ONEUPTIME_URL"];
  });

  function createProgram(): Command {
    const program: Command = new Command();
    program.exitOverride();
    program.configureOutput({
      writeOut: () => {},
      writeErr: () => {},
    });
    program
      .option("--api-key <key>", "API key")
      .option("--url <url>", "URL")
      .option("--context <name>", "Context");
    registerUtilityCommands(program);
    return program;
  }

  describe("version command", () => {
    it("should print version", async () => {
      const program: Command = createProgram();
      await program.parseAsync(["node", "test", "version"]);
      expect(consoleLogSpy).toHaveBeenCalled();
      // Should print a version string (either from package.json or fallback)
      const versionArg: string = consoleLogSpy.mock.calls[0][0];
      expect(typeof versionArg).toBe("string");
    });
  });

  describe("whoami command", () => {
    it("should show not authenticated when no credentials", async () => {
      const program: Command = createProgram();
      await program.parseAsync(["node", "test", "whoami"]);
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it("should show credentials from current context", async () => {
      ConfigManager.addContext({
        name: "test",
        apiUrl: "https://test.com",
        apiKey: "abcdefghijklm",
      });

      const program: Command = createProgram();
      await program.parseAsync(["node", "test", "whoami"]);

      expect(consoleLogSpy).toHaveBeenCalledWith("URL:     https://test.com");
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("****"),
      );
      expect(consoleLogSpy).toHaveBeenCalledWith("Context: test");
    });

    it("should mask short API keys", async () => {
      ConfigManager.addContext({
        name: "short",
        apiUrl: "https://s.com",
        apiKey: "abc",
      });

      const program: Command = createProgram();
      await program.parseAsync(["node", "test", "whoami"]);

      expect(consoleLogSpy).toHaveBeenCalledWith("API Key: ****");
    });

    it("should show credentials from env vars", async () => {
      process.env["ONEUPTIME_API_KEY"] = "env-key-long-enough";
      process.env["ONEUPTIME_URL"] = "https://env.com";

      const program: Command = createProgram();
      await program.parseAsync(["node", "test", "whoami"]);

      expect(consoleLogSpy).toHaveBeenCalledWith("URL:     https://env.com");
    });

    it("should handle whoami outer catch block", async () => {
      // Mock getCurrentContext to throw an unexpected error
      const spy: jest.SpyInstance = jest
        .spyOn(ConfigManager, "getCurrentContext")
        .mockImplementation(() => {
          throw new Error("Unexpected crash");
        });

      const program: Command = createProgram();
      await program.parseAsync(["node", "test", "whoami"]);

      expect(exitSpy).toHaveBeenCalledWith(1);
      spy.mockRestore();
    });

    it("should not show context line when no context exists", async () => {
      process.env["ONEUPTIME_API_KEY"] = "env-key-long-enough";
      process.env["ONEUPTIME_URL"] = "https://env.com";

      const program: Command = createProgram();
      await program.parseAsync(["node", "test", "whoami"]);

      // Should NOT have a "Context:" call since no context is set
      const contextCalls: any[][] = consoleLogSpy.mock.calls.filter(
        (call: any[]) => {
          return typeof call[0] === "string" && call[0].startsWith("Context:");
        },
      );
      expect(contextCalls).toHaveLength(0);
    });
  });

  describe("resources command", () => {
    it("should list all resources", async () => {
      /*
       * We need registerResourceCommands for discoverResources to work
       * but discoverResources is imported directly, so it should work
       */
      const program: Command = createProgram();
      await program.parseAsync(["node", "test", "resources"]);

      expect(consoleLogSpy).toHaveBeenCalled();
      // Should show total count
      const lastCall: string =
        consoleLogSpy.mock.calls[consoleLogSpy.mock.calls.length - 1][0];
      expect(lastCall).toContain("Total:");
    });

    it("should filter by type", async () => {
      const program: Command = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "resources",
        "--type",
        "database",
      ]);

      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it("should show message when filter returns no results", async () => {
      const program: Command = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "resources",
        "--type",
        "nonexistent",
      ]);

      expect(consoleLogSpy).toHaveBeenCalled();
    });
  });
});
