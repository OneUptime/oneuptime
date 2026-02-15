import { Command } from "commander";
import { ResourceInfo } from "../Types/CLITypes";
import * as ConfigManager from "../Core/ConfigManager";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Mock the ApiClient module before it's imported by ResourceCommands
const mockExecuteApiRequest = jest.fn();
jest.mock("../Core/ApiClient", () => ({
  ...jest.requireActual("../Core/ApiClient"),
  executeApiRequest: (...args) => mockExecuteApiRequest(...args),
}));

// Import after mock setup
import {
  discoverResources,
  registerResourceCommands,
} from "../Commands/ResourceCommands";

const CONFIG_DIR = path.join(os.homedir(), ".oneuptime");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

describe("ResourceCommands", () => {
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
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(process, "exit").mockImplementation((() => {}) as any);
    mockExecuteApiRequest.mockReset();
    delete process.env["ONEUPTIME_API_KEY"];
    delete process.env["ONEUPTIME_URL"];
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env["ONEUPTIME_API_KEY"];
    delete process.env["ONEUPTIME_URL"];
  });

  describe("discoverResources", () => {
    let resources: ResourceInfo[];

    beforeAll(() => {
      resources = discoverResources();
    });

    it("should discover at least one resource", () => {
      expect(resources.length).toBeGreaterThan(0);
    });

    it("should discover the Incident resource", () => {
      const incident = resources.find((r) => r.singularName === "Incident");
      expect(incident).toBeDefined();
      expect(incident!.modelType).toBe("database");
      expect(incident!.apiPath).toBe("/incident");
    });

    it("should discover the Monitor resource", () => {
      const monitor = resources.find((r) => r.singularName === "Monitor");
      expect(monitor).toBeDefined();
      expect(monitor!.modelType).toBe("database");
    });

    it("should discover the Alert resource", () => {
      const alert = resources.find((r) => r.singularName === "Alert");
      expect(alert).toBeDefined();
    });

    it("should have kebab-case names for all resources", () => {
      for (const r of resources) {
        expect(r.name).toMatch(/^[a-z][a-z0-9-]*$/);
      }
    });

    it("should have apiPath for all resources", () => {
      for (const r of resources) {
        expect(r.apiPath).toBeTruthy();
        expect(r.apiPath.startsWith("/")).toBe(true);
      }
    });

    it("should have valid modelType for all resources", () => {
      for (const r of resources) {
        expect(["database", "analytics"]).toContain(r.modelType);
      }
    });
  });

  describe("registerResourceCommands", () => {
    it("should register commands for all discovered resources", () => {
      const program = new Command();
      program.exitOverride();
      registerResourceCommands(program);

      const resources = discoverResources();
      for (const resource of resources) {
        const cmd = program.commands.find((c) => c.name() === resource.name);
        expect(cmd).toBeDefined();
      }
    });

    it("should register list, get, create, update, delete, count subcommands for database resources", () => {
      const program = new Command();
      program.exitOverride();
      registerResourceCommands(program);

      const incidentCmd = program.commands.find(
        (c) => c.name() === "incident",
      );
      expect(incidentCmd).toBeDefined();

      const subcommands = incidentCmd!.commands.map((c) => c.name());
      expect(subcommands).toContain("list");
      expect(subcommands).toContain("get");
      expect(subcommands).toContain("create");
      expect(subcommands).toContain("update");
      expect(subcommands).toContain("delete");
      expect(subcommands).toContain("count");
    });
  });

  describe("resource command actions", () => {
    function createProgramWithResources(): Command {
      const program = new Command();
      program.exitOverride();
      program.configureOutput({
        writeOut: () => {},
        writeErr: () => {},
      });
      program
        .option("--api-key <key>", "API key")
        .option("--url <url>", "URL")
        .option("--context <name>", "Context");
      registerResourceCommands(program);
      return program;
    }

    beforeEach(() => {
      ConfigManager.addContext({
        name: "test",
        apiUrl: "https://test.oneuptime.com",
        apiKey: "test-key-12345",
      });
      mockExecuteApiRequest.mockResolvedValue({ data: [] });
    });

    describe("list subcommand", () => {
      it("should call API with list operation", async () => {
        const program = createProgramWithResources();
        await program.parseAsync(["node", "test", "incident", "list"]);

        expect(mockExecuteApiRequest).toHaveBeenCalledTimes(1);
        expect(mockExecuteApiRequest.mock.calls[0][0].operation).toBe("list");
        expect(mockExecuteApiRequest.mock.calls[0][0].apiPath).toBe("/incident");
      });

      it("should pass query, limit, skip, sort options", async () => {
        const program = createProgramWithResources();
        await program.parseAsync([
          "node",
          "test",
          "incident",
          "list",
          "--query",
          '{"status":"active"}',
          "--limit",
          "20",
          "--skip",
          "5",
          "--sort",
          '{"createdAt":-1}',
        ]);

        expect(mockExecuteApiRequest).toHaveBeenCalledTimes(1);
        const opts = mockExecuteApiRequest.mock.calls[0][0];
        expect(opts.query).toEqual({ status: "active" });
        expect(opts.limit).toBe(20);
        expect(opts.skip).toBe(5);
        expect(opts.sort).toEqual({ createdAt: -1 });
      });

      it("should extract data array from response object", async () => {
        mockExecuteApiRequest.mockResolvedValue({
          data: [{ _id: "1", name: "Test" }],
        });

        const program = createProgramWithResources();
        await program.parseAsync([
          "node",
          "test",
          "incident",
          "list",
          "-o",
          "json",
        ]);

        expect(console.log).toHaveBeenCalled();
      });

      it("should handle response that is already an array", async () => {
        mockExecuteApiRequest.mockResolvedValue([{ _id: "1" }]);

        const program = createProgramWithResources();
        await program.parseAsync([
          "node",
          "test",
          "incident",
          "list",
          "-o",
          "json",
        ]);

        expect(console.log).toHaveBeenCalled();
      });

      it("should handle API errors", async () => {
        mockExecuteApiRequest.mockRejectedValue(
          new Error("API error (500): Server Error"),
        );

        const program = createProgramWithResources();
        await program.parseAsync(["node", "test", "incident", "list"]);

        expect(process.exit).toHaveBeenCalled();
      });
    });

    describe("get subcommand", () => {
      it("should call API with read operation and id", async () => {
        mockExecuteApiRequest.mockResolvedValue({
          _id: "abc-123",
          name: "Test",
        });

        const program = createProgramWithResources();
        await program.parseAsync([
          "node",
          "test",
          "incident",
          "get",
          "abc-123",
        ]);

        expect(mockExecuteApiRequest).toHaveBeenCalledTimes(1);
        const opts = mockExecuteApiRequest.mock.calls[0][0];
        expect(opts.operation).toBe("read");
        expect(opts.id).toBe("abc-123");
      });

      it("should support output format flag", async () => {
        mockExecuteApiRequest.mockResolvedValue({ _id: "abc-123" });

        const program = createProgramWithResources();
        await program.parseAsync([
          "node",
          "test",
          "incident",
          "get",
          "abc-123",
          "-o",
          "json",
        ]);

        expect(console.log).toHaveBeenCalled();
      });

      it("should handle get errors", async () => {
        mockExecuteApiRequest.mockRejectedValue(new Error("not found 404"));

        const program = createProgramWithResources();
        await program.parseAsync([
          "node",
          "test",
          "incident",
          "get",
          "abc-123",
        ]);

        expect(process.exit).toHaveBeenCalled();
      });
    });

    describe("create subcommand", () => {
      it("should call API with create operation and data", async () => {
        mockExecuteApiRequest.mockResolvedValue({ _id: "new-123" });

        const program = createProgramWithResources();
        await program.parseAsync([
          "node",
          "test",
          "incident",
          "create",
          "--data",
          '{"name":"New Incident"}',
        ]);

        expect(mockExecuteApiRequest).toHaveBeenCalledTimes(1);
        const opts = mockExecuteApiRequest.mock.calls[0][0];
        expect(opts.operation).toBe("create");
        expect(opts.data).toEqual({ name: "New Incident" });
      });

      it("should support reading data from a file", async () => {
        mockExecuteApiRequest.mockResolvedValue({ _id: "new-123" });

        const tmpFile = path.join(
          os.tmpdir(),
          "cli-test-" + Date.now() + ".json",
        );
        fs.writeFileSync(tmpFile, '{"name":"From File"}');

        try {
          const program = createProgramWithResources();
          await program.parseAsync([
            "node",
            "test",
            "incident",
            "create",
            "--file",
            tmpFile,
          ]);

          expect(mockExecuteApiRequest).toHaveBeenCalledTimes(1);
          expect(mockExecuteApiRequest.mock.calls[0][0].data).toEqual({
            name: "From File",
          });
        } finally {
          fs.unlinkSync(tmpFile);
        }
      });

      it("should error when neither --data nor --file is provided", async () => {
        const program = createProgramWithResources();
        await program.parseAsync(["node", "test", "incident", "create"]);

        expect(process.exit).toHaveBeenCalled();
      });

      it("should error on invalid JSON in --data", async () => {
        const program = createProgramWithResources();
        await program.parseAsync([
          "node",
          "test",
          "incident",
          "create",
          "--data",
          "not-json",
        ]);

        expect(process.exit).toHaveBeenCalled();
      });
    });

    describe("update subcommand", () => {
      it("should call API with update operation, id, and data", async () => {
        mockExecuteApiRequest.mockResolvedValue({ _id: "abc-123" });

        const program = createProgramWithResources();
        await program.parseAsync([
          "node",
          "test",
          "incident",
          "update",
          "abc-123",
          "--data",
          '{"name":"Updated"}',
        ]);

        expect(mockExecuteApiRequest).toHaveBeenCalledTimes(1);
        const opts = mockExecuteApiRequest.mock.calls[0][0];
        expect(opts.operation).toBe("update");
        expect(opts.id).toBe("abc-123");
        expect(opts.data).toEqual({ name: "Updated" });
      });

      it("should handle update errors", async () => {
        mockExecuteApiRequest.mockRejectedValue(new Error("API error"));

        const program = createProgramWithResources();
        await program.parseAsync([
          "node",
          "test",
          "incident",
          "update",
          "abc-123",
          "--data",
          '{"name":"x"}',
        ]);

        expect(process.exit).toHaveBeenCalled();
      });
    });

    describe("delete subcommand", () => {
      it("should call API with delete operation and id", async () => {
        mockExecuteApiRequest.mockResolvedValue({});

        const program = createProgramWithResources();
        await program.parseAsync([
          "node",
          "test",
          "incident",
          "delete",
          "abc-123",
        ]);

        expect(mockExecuteApiRequest).toHaveBeenCalledTimes(1);
        const opts = mockExecuteApiRequest.mock.calls[0][0];
        expect(opts.operation).toBe("delete");
        expect(opts.id).toBe("abc-123");
      });

      it("should handle API errors", async () => {
        mockExecuteApiRequest.mockRejectedValue(new Error("not found 404"));

        const program = createProgramWithResources();
        await program.parseAsync([
          "node",
          "test",
          "incident",
          "delete",
          "abc-123",
        ]);

        expect(process.exit).toHaveBeenCalled();
      });
    });

    describe("count subcommand", () => {
      it("should call API with count operation", async () => {
        mockExecuteApiRequest.mockResolvedValue({ count: 42 });

        const program = createProgramWithResources();
        await program.parseAsync(["node", "test", "incident", "count"]);

        expect(mockExecuteApiRequest).toHaveBeenCalledTimes(1);
        expect(mockExecuteApiRequest.mock.calls[0][0].operation).toBe("count");
        expect(console.log).toHaveBeenCalledWith(42);
      });

      it("should pass query filter", async () => {
        mockExecuteApiRequest.mockResolvedValue({ count: 5 });

        const program = createProgramWithResources();
        await program.parseAsync([
          "node",
          "test",
          "incident",
          "count",
          "--query",
          '{"status":"active"}',
        ]);

        expect(mockExecuteApiRequest.mock.calls[0][0].query).toEqual({
          status: "active",
        });
      });

      it("should handle response without count field", async () => {
        mockExecuteApiRequest.mockResolvedValue(99);

        const program = createProgramWithResources();
        await program.parseAsync(["node", "test", "incident", "count"]);

        expect(console.log).toHaveBeenCalledWith(99);
      });

      it("should handle non-object response in count", async () => {
        mockExecuteApiRequest.mockResolvedValue("some-string");

        const program = createProgramWithResources();
        await program.parseAsync(["node", "test", "incident", "count"]);

        expect(console.log).toHaveBeenCalledWith("some-string");
      });

      it("should handle count errors", async () => {
        mockExecuteApiRequest.mockRejectedValue(new Error("API error"));

        const program = createProgramWithResources();
        await program.parseAsync(["node", "test", "incident", "count"]);

        expect(process.exit).toHaveBeenCalled();
      });
    });

    describe("credential resolution in commands", () => {
      it("should use global --api-key and --url flags", async () => {
        ConfigManager.removeContext("test");
        mockExecuteApiRequest.mockResolvedValue({ data: [] });

        const program = createProgramWithResources();
        await program.parseAsync([
          "node",
          "test",
          "--api-key",
          "global-key",
          "--url",
          "https://global.com",
          "incident",
          "list",
        ]);

        expect(mockExecuteApiRequest).toHaveBeenCalledTimes(1);
        expect(mockExecuteApiRequest.mock.calls[0][0].apiKey).toBe(
          "global-key",
        );
        expect(mockExecuteApiRequest.mock.calls[0][0].apiUrl).toBe(
          "https://global.com",
        );
      });
    });
  });
});
