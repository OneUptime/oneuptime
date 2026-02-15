import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as ConfigManager from "../Core/ConfigManager";
import { CLIContext, ResolvedCredentials } from "../Types/CLITypes";

const CONFIG_DIR = path.join(os.homedir(), ".oneuptime");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

describe("ConfigManager", () => {
  let originalConfigContent: string | null = null;

  beforeAll(() => {
    // Save existing config if present
    if (fs.existsSync(CONFIG_FILE)) {
      originalConfigContent = fs.readFileSync(CONFIG_FILE, "utf-8");
    }
  });

  afterAll(() => {
    // Restore original config
    if (originalConfigContent) {
      fs.writeFileSync(CONFIG_FILE, originalConfigContent, { mode: 0o600 });
    } else if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE);
    }
  });

  beforeEach(() => {
    // Start each test with empty config
    if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE);
    }
  });

  describe("load", () => {
    it("should return default config when no config file exists", () => {
      const config = ConfigManager.load();
      expect(config.currentContext).toBe("");
      expect(config.contexts).toEqual({});
      expect(config.defaults.output).toBe("table");
      expect(config.defaults.limit).toBe(10);
    });

    it("should load existing config from file", () => {
      const testConfig = {
        currentContext: "test",
        contexts: {
          test: { name: "test", apiUrl: "https://test.com", apiKey: "key123" },
        },
        defaults: { output: "json", limit: 20 },
      };
      if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
      }
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(testConfig), {
        mode: 0o600,
      });

      const config = ConfigManager.load();
      expect(config.currentContext).toBe("test");
      expect(config.contexts["test"]?.apiKey).toBe("key123");
    });
  });

  describe("addContext and getCurrentContext", () => {
    it("should add a context and set it as current if first context", () => {
      const ctx: CLIContext = {
        name: "prod",
        apiUrl: "https://prod.oneuptime.com",
        apiKey: "sk-prod-123",
      };

      ConfigManager.addContext(ctx);

      const current = ConfigManager.getCurrentContext();
      expect(current).not.toBeNull();
      expect(current!.name).toBe("prod");
      expect(current!.apiUrl).toBe("https://prod.oneuptime.com");
    });

    it("should add multiple contexts", () => {
      ConfigManager.addContext({
        name: "prod",
        apiUrl: "https://prod.com",
        apiKey: "key1",
      });
      ConfigManager.addContext({
        name: "staging",
        apiUrl: "https://staging.com",
        apiKey: "key2",
      });

      const contexts = ConfigManager.listContexts();
      expect(contexts).toHaveLength(2);
    });
  });

  describe("setCurrentContext", () => {
    it("should switch the active context", () => {
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

      ConfigManager.setCurrentContext("b");
      const current = ConfigManager.getCurrentContext();
      expect(current!.name).toBe("b");
    });

    it("should throw for non-existent context", () => {
      expect(() => ConfigManager.setCurrentContext("nonexistent")).toThrow(
        'Context "nonexistent" does not exist',
      );
    });
  });

  describe("removeContext", () => {
    it("should remove a context", () => {
      ConfigManager.addContext({
        name: "test",
        apiUrl: "https://test.com",
        apiKey: "k1",
      });
      ConfigManager.removeContext("test");

      const contexts = ConfigManager.listContexts();
      expect(contexts).toHaveLength(0);
    });

    it("should update current context when removing the current one", () => {
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
      ConfigManager.setCurrentContext("a");
      ConfigManager.removeContext("a");

      const current = ConfigManager.getCurrentContext();
      expect(current).not.toBeNull();
      expect(current!.name).toBe("b");
    });
  });

  describe("getResolvedCredentials", () => {
    it("should resolve from CLI options first", () => {
      const creds: ResolvedCredentials = ConfigManager.getResolvedCredentials({
        apiKey: "cli-key",
        url: "https://cli.com",
      });
      expect(creds.apiKey).toBe("cli-key");
      expect(creds.apiUrl).toBe("https://cli.com");
    });

    it("should resolve from env vars", () => {
      process.env["ONEUPTIME_API_KEY"] = "env-key";
      process.env["ONEUPTIME_URL"] = "https://env.com";

      const creds: ResolvedCredentials = ConfigManager.getResolvedCredentials(
        {},
      );
      expect(creds.apiKey).toBe("env-key");
      expect(creds.apiUrl).toBe("https://env.com");

      delete process.env["ONEUPTIME_API_KEY"];
      delete process.env["ONEUPTIME_URL"];
    });

    it("should resolve from current context", () => {
      ConfigManager.addContext({
        name: "ctx",
        apiUrl: "https://ctx.com",
        apiKey: "ctx-key",
      });

      const creds: ResolvedCredentials = ConfigManager.getResolvedCredentials(
        {},
      );
      expect(creds.apiKey).toBe("ctx-key");
      expect(creds.apiUrl).toBe("https://ctx.com");
    });

    it("should throw when no credentials available", () => {
      expect(() => ConfigManager.getResolvedCredentials({})).toThrow(
        "No credentials found",
      );
    });
  });
});
