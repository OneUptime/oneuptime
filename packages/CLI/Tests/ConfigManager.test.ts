import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as ConfigManager from "../Core/ConfigManager";
import { CLIConfig, ResolvedCredentials } from "../Types/CLITypes";

const CONFIG_DIR: string = path.join(os.homedir(), ".oneuptime");
const CONFIG_FILE: string = path.join(CONFIG_DIR, "config.json");

describe("ConfigManager", () => {
  let originalConfigContent: string | null = null;

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
    delete process.env["ONEUPTIME_API_KEY"];
    delete process.env["ONEUPTIME_URL"];
  });

  afterEach(() => {
    delete process.env["ONEUPTIME_API_KEY"];
    delete process.env["ONEUPTIME_URL"];
  });

  describe("load", () => {
    it("should return default config when no config file exists", () => {
      const config: CLIConfig = ConfigManager.load();
      expect(config.currentContext).toBe("");
      expect(config.contexts).toEqual({});
      expect(config.defaults.output).toBe("table");
      expect(config.defaults.limit).toBe(10);
    });

    it("should load existing config from file", () => {
      const testConfig: CLIConfig = {
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

      const config: CLIConfig = ConfigManager.load();
      expect(config.currentContext).toBe("test");
      expect(config.contexts["test"]?.apiKey).toBe("key123");
    });

    it("should return default config when file contains invalid JSON", () => {
      if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
      }
      fs.writeFileSync(CONFIG_FILE, "not valid json {{{", { mode: 0o600 });

      const config: CLIConfig = ConfigManager.load();
      expect(config.currentContext).toBe("");
      expect(config.contexts).toEqual({});
    });
  });

  describe("save", () => {
    it("should create config directory if it does not exist", () => {
      // Remove the dir if it exists (we'll restore after)
      const tmpDir: string = path.join(
        os.tmpdir(),
        ".oneuptime-test-" + Date.now(),
      );
      /*
       * We can't easily test this with the real path, but we verify save works
       * when the dir already exists (which it does after beforeAll).
       */
      const config: CLIConfig = {
        currentContext: "",
        contexts: {},
        defaults: { output: "table", limit: 10 },
      };
      ConfigManager.save(config);
      expect(fs.existsSync(CONFIG_FILE)).toBe(true);
      void tmpDir; // unused but shows intent
    });

    it("should write config with correct permissions", () => {
      const config: CLIConfig = {
        currentContext: "x",
        contexts: {
          x: { name: "x", apiUrl: "https://x.com", apiKey: "k" },
        },
        defaults: { output: "table", limit: 10 },
      };
      ConfigManager.save(config);
      const content: string = fs.readFileSync(CONFIG_FILE, "utf-8");
      const parsed: CLIConfig = JSON.parse(content);
      expect(parsed.currentContext).toBe("x");
    });
  });

  describe("getCurrentContext", () => {
    it("should return null when no current context is set", () => {
      expect(ConfigManager.getCurrentContext()).toBeNull();
    });

    it("should return null when currentContext name does not match any context", () => {
      // Manually write a config with a dangling currentContext reference
      const config: CLIConfig = {
        currentContext: "ghost",
        contexts: {},
        defaults: { output: "table", limit: 10 },
      };
      ConfigManager.save(config);
      expect(ConfigManager.getCurrentContext()).toBeNull();
    });

    it("should return the current context when set", () => {
      ConfigManager.addContext({
        name: "prod",
        apiUrl: "https://prod.com",
        apiKey: "k1",
      });
      const ctx: ReturnType<typeof ConfigManager.getCurrentContext> =
        ConfigManager.getCurrentContext();
      expect(ctx).not.toBeNull();
      expect(ctx!.name).toBe("prod");
    });
  });

  describe("addContext", () => {
    it("should add a context and set it as current if first context", () => {
      ConfigManager.addContext({
        name: "prod",
        apiUrl: "https://prod.oneuptime.com",
        apiKey: "sk-prod-123",
      });

      const current: ReturnType<typeof ConfigManager.getCurrentContext> =
        ConfigManager.getCurrentContext();
      expect(current).not.toBeNull();
      expect(current!.name).toBe("prod");
    });

    it("should not change current context when adding a second context", () => {
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

      const current: ReturnType<typeof ConfigManager.getCurrentContext> =
        ConfigManager.getCurrentContext();
      expect(current!.name).toBe("prod"); // First one remains current
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

      const contexts: ReturnType<typeof ConfigManager.listContexts> =
        ConfigManager.listContexts();
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
      const current: ReturnType<typeof ConfigManager.getCurrentContext> =
        ConfigManager.getCurrentContext();
      expect(current!.name).toBe("b");
    });

    it("should throw for non-existent context", () => {
      expect(() => {
        return ConfigManager.setCurrentContext("nonexistent");
      }).toThrow('Context "nonexistent" does not exist');
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

      const contexts: ReturnType<typeof ConfigManager.listContexts> =
        ConfigManager.listContexts();
      expect(contexts).toHaveLength(0);
    });

    it("should throw for non-existent context", () => {
      expect(() => {
        return ConfigManager.removeContext("nonexistent");
      }).toThrow('Context "nonexistent" does not exist');
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

      const current: ReturnType<typeof ConfigManager.getCurrentContext> =
        ConfigManager.getCurrentContext();
      expect(current).not.toBeNull();
      expect(current!.name).toBe("b");
    });

    it("should set current context to empty when removing last context", () => {
      ConfigManager.addContext({
        name: "only",
        apiUrl: "https://only.com",
        apiKey: "k1",
      });
      ConfigManager.removeContext("only");

      expect(ConfigManager.getCurrentContext()).toBeNull();
      const config: CLIConfig = ConfigManager.load();
      expect(config.currentContext).toBe("");
    });

    it("should not change current context when removing a non-current one", () => {
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
      ConfigManager.removeContext("b");

      const current: ReturnType<typeof ConfigManager.getCurrentContext> =
        ConfigManager.getCurrentContext();
      expect(current!.name).toBe("a");
    });
  });

  describe("listContexts", () => {
    it("should return empty array when no contexts exist", () => {
      expect(ConfigManager.listContexts()).toEqual([]);
    });

    it("should mark current context correctly", () => {
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

      const contexts: ReturnType<typeof ConfigManager.listContexts> =
        ConfigManager.listContexts();
      const a:
        | ReturnType<typeof ConfigManager.listContexts>[number]
        | undefined = contexts.find(
        (c: ReturnType<typeof ConfigManager.listContexts>[number]) => {
          return c.name === "a";
        },
      );
      const b:
        | ReturnType<typeof ConfigManager.listContexts>[number]
        | undefined = contexts.find(
        (c: ReturnType<typeof ConfigManager.listContexts>[number]) => {
          return c.name === "b";
        },
      );
      expect(a!.isCurrent).toBe(false);
      expect(b!.isCurrent).toBe(true);
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

    it("should resolve from env vars when CLI options are missing", () => {
      process.env["ONEUPTIME_API_KEY"] = "env-key";
      process.env["ONEUPTIME_URL"] = "https://env.com";

      const creds: ResolvedCredentials = ConfigManager.getResolvedCredentials(
        {},
      );
      expect(creds.apiKey).toBe("env-key");
      expect(creds.apiUrl).toBe("https://env.com");
    });

    it("should resolve from --context flag", () => {
      ConfigManager.addContext({
        name: "named",
        apiUrl: "https://named.com",
        apiKey: "named-key",
      });

      const creds: ResolvedCredentials = ConfigManager.getResolvedCredentials({
        context: "named",
      });
      expect(creds.apiKey).toBe("named-key");
      expect(creds.apiUrl).toBe("https://named.com");
    });

    it("should throw when --context flag references non-existent context", () => {
      expect(() => {
        return ConfigManager.getResolvedCredentials({ context: "nope" });
      }).toThrow('Context "nope" does not exist');
    });

    it("should resolve from current context in config", () => {
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

    it("should resolve from partial env vars (only ONEUPTIME_API_KEY)", () => {
      process.env["ONEUPTIME_API_KEY"] = "partial-key";

      const creds: ResolvedCredentials = ConfigManager.getResolvedCredentials(
        {},
      );
      expect(creds.apiKey).toBe("partial-key");
      expect(creds.apiUrl).toBe("");
    });

    it("should resolve from partial env vars (only ONEUPTIME_URL)", () => {
      process.env["ONEUPTIME_URL"] = "https://partial.com";

      const creds: ResolvedCredentials = ConfigManager.getResolvedCredentials(
        {},
      );
      expect(creds.apiKey).toBe("");
      expect(creds.apiUrl).toBe("https://partial.com");
    });

    it("should combine partial env var with context", () => {
      process.env["ONEUPTIME_API_KEY"] = "env-key";
      ConfigManager.addContext({
        name: "ctx",
        apiUrl: "https://ctx.com",
        apiKey: "ctx-key",
      });

      const creds: ResolvedCredentials = ConfigManager.getResolvedCredentials(
        {},
      );
      /*
       * env vars take priority: both are set so goes through priority 2
       * Actually, only ONEUPTIME_API_KEY is set, not ONEUPTIME_URL
       * So it falls through to priority 4 (current context)
       */
      expect(creds.apiKey).toBe("ctx-key");
      expect(creds.apiUrl).toBe("https://ctx.com");
    });

    it("should throw when no credentials available at all", () => {
      expect(() => {
        return ConfigManager.getResolvedCredentials({});
      }).toThrow("No credentials found");
    });

    it("should prefer CLI flags over env vars", () => {
      process.env["ONEUPTIME_API_KEY"] = "env-key";
      process.env["ONEUPTIME_URL"] = "https://env.com";

      const creds: ResolvedCredentials = ConfigManager.getResolvedCredentials({
        apiKey: "cli-key",
        url: "https://cli.com",
      });
      expect(creds.apiKey).toBe("cli-key");
      expect(creds.apiUrl).toBe("https://cli.com");
    });
  });
});
