import { Command } from "commander";
import { ResourceInfo } from "../Types/CLITypes";
import { buildProgram } from "../Program";
import * as ConfigManager from "../Core/ConfigManager";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Mock the ApiClient module before it's imported by ResourceCommands
const mockExecuteApiRequest: jest.Mock = jest.fn();
jest.mock("../Core/ApiClient", () => {
  return {
    ...jest.requireActual("../Core/ApiClient"),
    executeApiRequest: (...args: unknown[]): unknown => {
      return mockExecuteApiRequest(...args);
    },
  };
});

// Import after mock setup
import {
  discoverResources,
  registerResourceCommands,
} from "../Commands/ResourceCommands";

const CONFIG_DIR: string = path.join(os.homedir(), ".oneuptime");
const CONFIG_FILE: string = path.join(CONFIG_DIR, "config.json");

describe("ResourceCommands", () => {
  let originalConfigContent: string | null = null;
  let consoleLogSpy: jest.SpyInstance;

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
      const incident: ResourceInfo | undefined = resources.find(
        (r: ResourceInfo) => {
          return r.singularName === "Incident";
        },
      );
      expect(incident).toBeDefined();
      expect(incident!.modelType).toBe("database");
      expect(incident!.apiPath).toBe("/incident");
    });

    it("should discover the Monitor resource", () => {
      const monitor: ResourceInfo | undefined = resources.find(
        (r: ResourceInfo) => {
          return r.singularName === "Monitor";
        },
      );
      expect(monitor).toBeDefined();
      expect(monitor!.modelType).toBe("database");
    });

    it("should discover the Alert resource", () => {
      const alert: ResourceInfo | undefined = resources.find(
        (r: ResourceInfo) => {
          return r.singularName === "Alert";
        },
      );
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
      const program: Command = new Command();
      program.exitOverride();
      registerResourceCommands(program);

      const resources: ResourceInfo[] = discoverResources();
      for (const resource of resources) {
        const cmd: Command | undefined = program.commands.find((c: Command) => {
          return c.name() === resource.name;
        });
        expect(cmd).toBeDefined();
      }
    });

    it("should register list, get, create, update, delete, count subcommands for database resources", () => {
      const program: Command = new Command();
      program.exitOverride();
      registerResourceCommands(program);

      const incidentCmd: Command | undefined = program.commands.find(
        (c: Command) => {
          return c.name() === "incident";
        },
      );
      expect(incidentCmd).toBeDefined();

      const subcommands: string[] = incidentCmd!.commands.map((c: Command) => {
        return c.name();
      });
      expect(subcommands).toContain("list");
      expect(subcommands).toContain("get");
      expect(subcommands).toContain("create");
      expect(subcommands).toContain("update");
      expect(subcommands).toContain("delete");
      expect(subcommands).toContain("count");
    });
  });

  describe("resource command actions", () => {
    /*
     * Build on the real program so these tests parse argv exactly as the
     * shipped CLI does. A hand-built root that left out the global
     * -o/--output let the leaf subcommand parse -o itself, which hid the
     * bug fixed in #4096. Subcommands copy exit and output settings when
     * they are created, so they are silenced by walking the whole tree.
     */
    function createProgramWithResources(): Command {
      const program: Command = buildProgram();
      const silence: (cmd: Command) => void = (cmd: Command): void => {
        cmd.exitOverride();
        cmd.configureOutput({
          writeOut: () => {},
          writeErr: () => {},
        });
        cmd.commands.forEach(silence);
      };
      silence(program);
      return program;
    }

    const originalIsTTY: boolean | undefined = process.stdout.isTTY;

    function setStdoutIsTTY(value: boolean | undefined): void {
      Object.defineProperty(process.stdout, "isTTY", {
        value,
        writable: true,
        configurable: true,
      });
    }

    beforeEach(() => {
      /*
       * Use env vars for credentials instead of config file to avoid
       * race conditions with other test files that share ~/.oneuptime/config.json
       */
      process.env["ONEUPTIME_API_KEY"] = "test-key-12345";
      process.env["ONEUPTIME_URL"] = "https://test.oneuptime.com";
      mockExecuteApiRequest.mockResolvedValue({ data: [] });
    });

    afterEach(() => {
      setStdoutIsTTY(originalIsTTY);
    });

    describe("list subcommand", () => {
      it("should use an env API key with the current context URL", async () => {
        ConfigManager.addContext({
          name: "saved",
          apiUrl: "https://saved.oneuptime.com",
          apiKey: "saved-key",
        });
        process.env["ONEUPTIME_API_KEY"] = "env-key";
        delete process.env["ONEUPTIME_URL"];

        const program: Command = createProgramWithResources();
        await program.parseAsync(["node", "test", "incident", "list"]);

        expect(mockExecuteApiRequest).toHaveBeenCalledWith(
          expect.objectContaining({
            apiKey: "env-key",
            apiUrl: "https://saved.oneuptime.com",
          }),
        );
      });

      it("should call API with list operation", async () => {
        const program: Command = createProgramWithResources();
        await program.parseAsync(["node", "test", "incident", "list"]);

        expect(mockExecuteApiRequest).toHaveBeenCalledTimes(1);
        expect(mockExecuteApiRequest.mock.calls[0][0].operation).toBe("list");
        expect(mockExecuteApiRequest.mock.calls[0][0].apiPath).toBe(
          "/incident",
        );
      });

      it("should pass query, limit, skip, sort options", async () => {
        const program: Command = createProgramWithResources();
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
        const opts: Record<string, unknown> =
          mockExecuteApiRequest.mock.calls[0][0];
        expect(opts.query).toEqual({ status: "active" });
        expect(opts.limit).toBe(20);
        expect(opts.skip).toBe(5);
        expect(opts.sort).toEqual({ createdAt: -1 });
      });

      it("should extract data array from response object", async () => {
        // A terminal gets a table by default, so JSON can only come from -o.
        setStdoutIsTTY(true);
        mockExecuteApiRequest.mockResolvedValue({
          data: [{ _id: "1", name: "Test" }],
        });

        const program: Command = createProgramWithResources();
        await program.parseAsync([
          "node",
          "test",
          "incident",
          "list",
          "-o",
          "json",
        ]);

        expect(consoleLogSpy).toHaveBeenCalledTimes(1);
        expect(JSON.parse(consoleLogSpy.mock.calls[0][0])).toEqual([
          { _id: "1", name: "Test" },
        ]);
      });

      it("should handle response that is already an array", async () => {
        setStdoutIsTTY(true);
        mockExecuteApiRequest.mockResolvedValue([{ _id: "1" }]);

        const program: Command = createProgramWithResources();
        await program.parseAsync([
          "node",
          "test",
          "incident",
          "list",
          "-o",
          "json",
        ]);

        expect(consoleLogSpy).toHaveBeenCalledTimes(1);
        expect(JSON.parse(consoleLogSpy.mock.calls[0][0])).toEqual([
          { _id: "1" },
        ]);
      });

      it("should handle API errors", async () => {
        mockExecuteApiRequest.mockRejectedValue(
          new Error("API error (500): Server Error"),
        );

        const program: Command = createProgramWithResources();
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

        const program: Command = createProgramWithResources();
        await program.parseAsync([
          "node",
          "test",
          "incident",
          "get",
          "abc-123",
        ]);

        expect(mockExecuteApiRequest).toHaveBeenCalledTimes(1);
        const opts: Record<string, unknown> =
          mockExecuteApiRequest.mock.calls[0][0];
        expect(opts.operation).toBe("read");
        expect(opts.id).toBe("abc-123");
      });

      it("should handle get errors", async () => {
        mockExecuteApiRequest.mockRejectedValue(new Error("not found 404"));

        const program: Command = createProgramWithResources();
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

        const program: Command = createProgramWithResources();
        await program.parseAsync([
          "node",
          "test",
          "incident",
          "create",
          "--data",
          '{"name":"New Incident"}',
        ]);

        expect(mockExecuteApiRequest).toHaveBeenCalledTimes(1);
        const opts: Record<string, unknown> =
          mockExecuteApiRequest.mock.calls[0][0];
        expect(opts.operation).toBe("create");
        expect(opts.data).toEqual({ name: "New Incident" });
      });

      it("should support reading data from a file", async () => {
        mockExecuteApiRequest.mockResolvedValue({ _id: "new-123" });

        const tmpFile: string = path.join(
          os.tmpdir(),
          "cli-test-" + Date.now() + ".json",
        );
        fs.writeFileSync(tmpFile, '{"name":"From File"}');

        try {
          const program: Command = createProgramWithResources();
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
        const program: Command = createProgramWithResources();
        await program.parseAsync(["node", "test", "incident", "create"]);

        expect(process.exit).toHaveBeenCalled();
      });

      it("should error on invalid JSON in --data", async () => {
        const program: Command = createProgramWithResources();
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

        const program: Command = createProgramWithResources();
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
        const opts: Record<string, unknown> =
          mockExecuteApiRequest.mock.calls[0][0];
        expect(opts.operation).toBe("update");
        expect(opts.id).toBe("abc-123");
        expect(opts.data).toEqual({ name: "Updated" });
      });

      it("should handle update errors", async () => {
        mockExecuteApiRequest.mockRejectedValue(new Error("API error"));

        const program: Command = createProgramWithResources();
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

        const program: Command = createProgramWithResources();
        await program.parseAsync([
          "node",
          "test",
          "incident",
          "delete",
          "abc-123",
        ]);

        expect(mockExecuteApiRequest).toHaveBeenCalledTimes(1);
        const opts: Record<string, unknown> =
          mockExecuteApiRequest.mock.calls[0][0];
        expect(opts.operation).toBe("delete");
        expect(opts.id).toBe("abc-123");
      });

      it("should handle API errors", async () => {
        mockExecuteApiRequest.mockRejectedValue(new Error("not found 404"));

        const program: Command = createProgramWithResources();
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

        const program: Command = createProgramWithResources();
        await program.parseAsync(["node", "test", "incident", "count"]);

        expect(mockExecuteApiRequest).toHaveBeenCalledTimes(1);
        expect(mockExecuteApiRequest.mock.calls[0][0].operation).toBe("count");
        // eslint-disable-next-line no-console
        expect(console.log).toHaveBeenCalledWith("42");
      });

      it("should pass query filter", async () => {
        mockExecuteApiRequest.mockResolvedValue({ count: 5 });

        const program: Command = createProgramWithResources();
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

        const program: Command = createProgramWithResources();
        await program.parseAsync(["node", "test", "incident", "count"]);

        // eslint-disable-next-line no-console
        expect(console.log).toHaveBeenCalledWith("99");
      });

      it("should handle non-object response in count", async () => {
        mockExecuteApiRequest.mockResolvedValue("some-string");

        const program: Command = createProgramWithResources();
        await program.parseAsync([
          "node",
          "test",
          "incident",
          "count",
          "-o",
          "json",
        ]);

        // eslint-disable-next-line no-console
        expect(console.log).toHaveBeenCalledWith('"some-string"');
      });

      it("should handle count errors", async () => {
        mockExecuteApiRequest.mockRejectedValue(new Error("API error"));

        const program: Command = createProgramWithResources();
        await program.parseAsync(["node", "test", "incident", "count"]);

        expect(process.exit).toHaveBeenCalled();
      });
    });

    describe("output format through the CLI entry point", () => {
      describe.each([
        ["incident", "list"],
        ["incident", "get", "test-id-123"],
        ["incident", "create", "--data", '{"title":"API outage"}'],
        [
          "incident",
          "update",
          "test-id-123",
          "--data",
          '{"title":"API outage"}',
        ],
        ["log", "list"],
        ["log", "create", "--data", '{"body":"API outage"}'],
      ])("%s %s", (...args: string[]) => {
        it.each([
          { flag: "--output", format: "table", before: true, tty: false },
          { flag: "-o", format: "table", before: false, tty: false },
          { flag: "--output", format: "json", before: false, tty: true },
          { flag: "", format: "table", before: false, tty: true },
          { flag: "", format: "json", before: false, tty: false },
        ])(
          "uses $format with flag '$flag', before=$before, tty=$tty",
          async ({
            flag,
            format,
            before,
            tty,
          }: {
            flag: string;
            format: string;
            before: boolean;
            tty: boolean;
          }) => {
            setStdoutIsTTY(tty);
            const item: { title: string } = { title: "API outage" };
            const isList: boolean = args[1] === "list";
            mockExecuteApiRequest.mockResolvedValue(
              isList ? { data: [item] } : item,
            );
            const outputArgs: string[] = flag ? [flag, format] : [];
            const program: Command = buildProgram();

            await program.parseAsync([
              "node",
              "test",
              ...(before ? [...outputArgs, ...args] : [...args, ...outputArgs]),
            ]);

            expect(mockExecuteApiRequest).toHaveBeenCalledTimes(1);
            const output: string = consoleLogSpy.mock.calls[0][0];
            if (format === "json") {
              expect(JSON.parse(output)).toEqual(isList ? [item] : item);
            } else {
              expect(output).toContain("\u2500");
              expect(output).toContain("API outage");
            }
          },
        );
      });

      it("ignores the output default older versions wrote to the config file", async () => {
        /*
         * Every config written by `oneuptime login` before this field was
         * dropped says "table". Reading it would turn piped output into a
         * table and break scripts that parse JSON.
         */
        if (!fs.existsSync(CONFIG_DIR)) {
          fs.mkdirSync(CONFIG_DIR, { recursive: true });
        }
        fs.writeFileSync(
          CONFIG_FILE,
          JSON.stringify({
            currentContext: "",
            contexts: {},
            defaults: { output: "table", limit: 10 },
          }),
          { mode: 0o600 },
        );
        setStdoutIsTTY(false);
        mockExecuteApiRequest.mockResolvedValue({
          data: [{ title: "API outage" }],
        });

        await buildProgram().parseAsync(["node", "test", "incident", "list"]);

        expect(JSON.parse(consoleLogSpy.mock.calls[0][0])).toEqual([
          { title: "API outage" },
        ]);
      });

      it("honors wide output for lists with more than six columns", async () => {
        mockExecuteApiRequest.mockResolvedValue({
          data: [{ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, lastColumn: "visible" }],
        });

        await buildProgram().parseAsync([
          "node",
          "test",
          "incident",
          "list",
          "--output",
          "wide",
        ]);

        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining("lastColumn"),
        );
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining("visible"),
        );
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining("\u2500"),
        );
      });

      describe("incident count", () => {
        it.each([
          { argv: ["incident", "count"], tty: true, count: 42 },
          { argv: ["incident", "count"], tty: false, count: 42 },
          { argv: ["incident", "count", "-o", "json"], tty: true, count: 0 },
          {
            argv: ["--output", "table", "incident", "count"],
            tty: false,
            count: 0,
          },
          { argv: ["log", "count", "-o", "wide"], tty: false, count: 7 },
        ])(
          "prints the bare count for $argv, tty=$tty",
          async ({
            argv,
            tty,
            count,
          }: {
            argv: string[];
            tty: boolean;
            count: number;
          }) => {
            setStdoutIsTTY(tty);
            mockExecuteApiRequest.mockResolvedValue({ count });

            await buildProgram().parseAsync(["node", "test", ...argv]);

            expect(consoleLogSpy).toHaveBeenCalledTimes(1);
            expect(consoleLogSpy).toHaveBeenCalledWith(String(count));
          },
        );

        it.each([
          { argv: ["incident", "count"], tty: false },
          { argv: ["incident", "count", "-o", "json"], tty: true },
          { argv: ["-o", "json", "incident", "count"], tty: true },
        ])(
          "prints a response without a count key as JSON for $argv, tty=$tty",
          async ({ argv, tty }: { argv: string[]; tty: boolean }) => {
            setStdoutIsTTY(tty);
            mockExecuteApiRequest.mockResolvedValue({ total: 7 });

            await buildProgram().parseAsync(["node", "test", ...argv]);

            expect(JSON.parse(consoleLogSpy.mock.calls[0][0])).toEqual({
              total: 7,
            });
          },
        );

        it("prints a response without a count key as a table with -o table", async () => {
          setStdoutIsTTY(false);
          mockExecuteApiRequest.mockResolvedValue({ total: 7 });

          await buildProgram().parseAsync([
            "node",
            "test",
            "incident",
            "count",
            "-o",
            "table",
          ]);

          const output: string = consoleLogSpy.mock.calls[0][0];
          expect(output).toContain("\u2500");
          expect(output).toContain("total");
        });
      });

      it.each([
        { argv: ["-o", "yaml", "incident", "list"] },
        { argv: ["incident", "list", "-o", "yaml"] },
        { argv: ["incident", "get", "test-id-123", "--output", "yaml"] },
        { argv: ["incident", "count", "--output=yaml"] },
        { argv: ["resources", "-o", "yaml"] },
        { argv: ["context", "list", "-o", "yaml"] },
      ])(
        "rejects an unknown output format for $argv",
        async ({ argv }: { argv: string[] }) => {
          const errors: string[] = [];
          const program: Command = buildProgram();
          program.exitOverride();
          program.configureOutput({
            writeErr: (str: string) => {
              errors.push(str);
            },
          });

          await expect(
            program.parseAsync(["node", "test", ...argv]),
          ).rejects.toMatchObject({ code: "commander.invalidArgument" });
          expect(errors.join("")).toContain(
            "Allowed choices are json, table, wide.",
          );
          expect(mockExecuteApiRequest).not.toHaveBeenCalled();
          expect(consoleLogSpy).not.toHaveBeenCalled();
        },
      );
    });

    describe("credential resolution in commands", () => {
      it("should use global --api-key and --url flags", async () => {
        delete process.env["ONEUPTIME_API_KEY"];
        delete process.env["ONEUPTIME_URL"];
        mockExecuteApiRequest.mockResolvedValue({ data: [] });

        const program: Command = createProgramWithResources();
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

      it("should use a single --url flag over env credentials", async () => {
        process.env["ONEUPTIME_API_KEY"] = "env-key";
        process.env["ONEUPTIME_URL"] = "https://env.com";
        mockExecuteApiRequest.mockResolvedValue({ data: [] });

        const program: Command = createProgramWithResources();
        await program.parseAsync([
          "node",
          "test",
          "--url",
          "https://cli.com",
          "incident",
          "list",
        ]);

        expect(mockExecuteApiRequest).toHaveBeenCalledTimes(1);
        expect(mockExecuteApiRequest.mock.calls[0][0].apiKey).toBe("env-key");
        expect(mockExecuteApiRequest.mock.calls[0][0].apiUrl).toBe(
          "https://cli.com",
        );
      });
    });
  });
});
