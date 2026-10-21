import { Command } from "commander";
import { registerConfigCommands } from "../Commands/ConfigCommands";
import { buildProgram } from "../Program";
import * as ConfigManager from "../Core/ConfigManager";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CONFIG_DIR: string = path.join(os.homedir(), ".oneuptime");
const CONFIG_FILE: string = path.join(CONFIG_DIR, "config.json");

describe("ConfigCommands", () => {
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
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    jest.restoreAllMocks();
  });

  function createProgram(): Command {
    const program: Command = new Command();
    program.exitOverride(); // Prevent commander from calling process.exit
    program.configureOutput({
      writeOut: () => {},
      writeErr: () => {},
    });
    registerConfigCommands(program);
    return program;
  }

  describe("login command", () => {
    it("should create a context and set it as current", async () => {
      const program: Command = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "login",
        "my-api-key",
        "https://example.com",
      ]);

      const ctx: ReturnType<typeof ConfigManager.getCurrentContext> =
        ConfigManager.getCurrentContext();
      expect(ctx).not.toBeNull();
      expect(ctx!.name).toBe("default");
      expect(ctx!.apiUrl).toBe("https://example.com");
      expect(ctx!.apiKey).toBe("my-api-key");
    });

    it("should use custom context name", async () => {
      const program: Command = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "login",
        "key123",
        "https://prod.com",
        "--context-name",
        "production",
      ]);

      const ctx: ReturnType<typeof ConfigManager.getCurrentContext> =
        ConfigManager.getCurrentContext();
      expect(ctx!.name).toBe("production");
    });

    it("should handle login errors gracefully", async () => {
      // Mock addContext to throw
      const addCtxSpy: jest.SpyInstance = jest
        .spyOn(ConfigManager, "addContext")
        .mockImplementation(() => {
          throw new Error("Permission denied");
        });

      const program: Command = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "login",
        "key123",
        "https://example.com",
      ]);

      expect(exitSpy).toHaveBeenCalledWith(1);
      addCtxSpy.mockRestore();
    });

    it("should strip trailing slashes from URL", async () => {
      const program: Command = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "login",
        "key123",
        "https://example.com///",
      ]);

      const ctx: ReturnType<typeof ConfigManager.getCurrentContext> =
        ConfigManager.getCurrentContext();
      expect(ctx!.apiUrl).toBe("https://example.com");
    });
  });

  describe("context list command", () => {
    it("should show message when no contexts exist", async () => {
      const program: Command = createProgram();
      await program.parseAsync(["node", "test", "context", "list"]);
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it("should list contexts with current marker", async () => {
      ConfigManager.addContext({
        name: "a",
        apiUrl: "https://a.com",
        apiKey: "k1",
      });
      ConfigManager.addContext({
        name: "b",
        apiUrl: "https://b.com",
        apiKey: "k2",
      });

      const program: Command = createProgram();
      await program.parseAsync(["node", "test", "context", "list"]);
      expect(consoleLogSpy).toHaveBeenCalled();
    });
  });

  describe("context list output format through the CLI entry point", () => {
    const originalIsTTY: boolean | undefined = process.stdout.isTTY;

    function setStdoutIsTTY(value: boolean | undefined): void {
      Object.defineProperty(process.stdout, "isTTY", {
        value,
        writable: true,
        configurable: true,
      });
    }

    beforeEach(() => {
      ConfigManager.addContext({
        name: "a",
        apiUrl: "https://a.com",
        apiKey: "secret-key-a",
      });
      ConfigManager.addContext({
        name: "b",
        apiUrl: "https://b.com",
        apiKey: "secret-key-b",
      });
    });

    afterEach(() => {
      setStdoutIsTTY(originalIsTTY);
    });

    it.each([
      { argv: ["context", "list", "-o", "json"], tty: true },
      { argv: ["--output", "json", "context", "list"], tty: true },
      { argv: ["context", "list"], tty: false },
    ])(
      "prints JSON without API keys for $argv, tty=$tty",
      async ({ argv, tty }: { argv: string[]; tty: boolean }) => {
        setStdoutIsTTY(tty);

        await buildProgram().parseAsync(["node", "test", ...argv]);

        expect(consoleLogSpy).toHaveBeenCalledTimes(1);
        const output: string = consoleLogSpy.mock.calls[0][0];
        expect(JSON.parse(output)).toEqual([
          { name: "a", apiUrl: "https://a.com", isCurrent: true },
          { name: "b", apiUrl: "https://b.com", isCurrent: false },
        ]);
        expect(output).not.toContain("secret-key");
      },
    );

    it.each([
      { argv: ["context", "list", "-o", "table"], tty: false },
      { argv: ["-o", "wide", "context", "list"], tty: false },
      { argv: ["context", "list"], tty: true },
    ])(
      "prints the table for $argv, tty=$tty",
      async ({ argv, tty }: { argv: string[]; tty: boolean }) => {
        setStdoutIsTTY(tty);

        await buildProgram().parseAsync(["node", "test", ...argv]);

        expect(consoleLogSpy).toHaveBeenCalledTimes(1);
        const output: string = consoleLogSpy.mock.calls[0][0];
        expect(output).toContain("─");
        expect(output).toContain("https://a.com");
        expect(output).not.toContain("secret-key");
      },
    );

    it("prints an empty JSON array when no contexts exist", async () => {
      ConfigManager.removeContext("a");
      ConfigManager.removeContext("b");
      setStdoutIsTTY(true);

      await buildProgram().parseAsync([
        "node",
        "test",
        "context",
        "list",
        "-o",
        "json",
      ]);

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      expect(JSON.parse(consoleLogSpy.mock.calls[0][0])).toEqual([]);
    });
  });

  describe("context use command", () => {
    it("should switch to the specified context", async () => {
      ConfigManager.addContext({
        name: "a",
        apiUrl: "https://a.com",
        apiKey: "k1",
      });
      ConfigManager.addContext({
        name: "b",
        apiUrl: "https://b.com",
        apiKey: "k2",
      });

      const program: Command = createProgram();
      await program.parseAsync(["node", "test", "context", "use", "b"]);

      const current: ReturnType<typeof ConfigManager.getCurrentContext> =
        ConfigManager.getCurrentContext();
      expect(current!.name).toBe("b");
    });

    it("should handle non-existent context", async () => {
      const program: Command = createProgram();
      await program.parseAsync(["node", "test", "context", "use", "nope"]);

      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("context current command", () => {
    it("should show current context info", async () => {
      ConfigManager.addContext({
        name: "myctx",
        apiUrl: "https://myctx.com",
        apiKey: "abcdefghijklm",
      });

      const program: Command = createProgram();
      await program.parseAsync(["node", "test", "context", "current"]);

      // Check that masked key is shown
      expect(consoleLogSpy).toHaveBeenCalledWith("Context: myctx");
      expect(consoleLogSpy).toHaveBeenCalledWith("URL:     https://myctx.com");
      // Key should be masked: abcd****jklm
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("****"),
      );
    });

    it("should show message when no current context", async () => {
      const program: Command = createProgram();
      await program.parseAsync(["node", "test", "context", "current"]);
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it("should mask short API keys", async () => {
      ConfigManager.addContext({
        name: "short",
        apiUrl: "https://s.com",
        apiKey: "abc",
      });

      const program: Command = createProgram();
      await program.parseAsync(["node", "test", "context", "current"]);

      expect(consoleLogSpy).toHaveBeenCalledWith("API Key: ****");
    });
  });

  describe("context delete command", () => {
    it("should delete a context", async () => {
      ConfigManager.addContext({
        name: "todelete",
        apiUrl: "https://del.com",
        apiKey: "k1",
      });

      const program: Command = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "context",
        "delete",
        "todelete",
      ]);

      const contexts: ReturnType<typeof ConfigManager.listContexts> =
        ConfigManager.listContexts();
      expect(contexts).toHaveLength(0);
    });

    it("should handle deletion of non-existent context", async () => {
      const program: Command = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "context",
        "delete",
        "nonexistent",
      ]);

      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
