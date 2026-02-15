import { Command } from "commander";
import { registerConfigCommands } from "../Commands/ConfigCommands";
import * as ConfigManager from "../Core/ConfigManager";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CONFIG_DIR = path.join(os.homedir(), ".oneuptime");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

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
    const program = new Command();
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
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "login",
        "my-api-key",
        "https://example.com",
      ]);

      const ctx = ConfigManager.getCurrentContext();
      expect(ctx).not.toBeNull();
      expect(ctx!.name).toBe("default");
      expect(ctx!.apiUrl).toBe("https://example.com");
      expect(ctx!.apiKey).toBe("my-api-key");
    });

    it("should use custom context name", async () => {
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "login",
        "key123",
        "https://prod.com",
        "--context-name",
        "production",
      ]);

      const ctx = ConfigManager.getCurrentContext();
      expect(ctx!.name).toBe("production");
    });

    it("should handle login errors gracefully", async () => {
      // Mock addContext to throw
      const addCtxSpy = jest
        .spyOn(ConfigManager, "addContext")
        .mockImplementation(() => {
          throw new Error("Permission denied");
        });

      const program = createProgram();
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
      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "login",
        "key123",
        "https://example.com///",
      ]);

      const ctx = ConfigManager.getCurrentContext();
      expect(ctx!.apiUrl).toBe("https://example.com");
    });
  });

  describe("context list command", () => {
    it("should show message when no contexts exist", async () => {
      const program = createProgram();
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

      const program = createProgram();
      await program.parseAsync(["node", "test", "context", "list"]);
      expect(consoleLogSpy).toHaveBeenCalled();
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

      const program = createProgram();
      await program.parseAsync(["node", "test", "context", "use", "b"]);

      const current = ConfigManager.getCurrentContext();
      expect(current!.name).toBe("b");
    });

    it("should handle non-existent context", async () => {
      const program = createProgram();
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

      const program = createProgram();
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
      const program = createProgram();
      await program.parseAsync(["node", "test", "context", "current"]);
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it("should mask short API keys", async () => {
      ConfigManager.addContext({
        name: "short",
        apiUrl: "https://s.com",
        apiKey: "abc",
      });

      const program = createProgram();
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

      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "context",
        "delete",
        "todelete",
      ]);

      const contexts = ConfigManager.listContexts();
      expect(contexts).toHaveLength(0);
    });

    it("should handle deletion of non-existent context", async () => {
      const program = createProgram();
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
