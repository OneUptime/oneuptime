import { ApiRequestOptions } from "../Core/ApiClient";

const mockExecuteApiRequest: jest.Mock = jest.fn();
const mockGetServerVersion: jest.Mock = jest.fn();
jest.mock("../Core/ApiClient", () => {
  return {
    ...jest.requireActual("../Core/ApiClient"),
    executeApiRequest: (...args: unknown[]): unknown => {
      return mockExecuteApiRequest(...args);
    },
    getServerVersion: (...args: unknown[]): unknown => {
      return mockGetServerVersion(...args);
    },
  };
});

import { isJsonRequested } from "../Core/OutputFormatter";
import {
  getVersionMismatchWarning,
  KEY_TAKEN,
  maskApiKey,
  readCliVersion,
  versionsMatch,
} from "../Commands/UtilityCommands";
import {
  clearTestCredentials,
  CliRun,
  INCIDENT_ID,
  printedJson,
  runCli,
  TEST_API_KEY,
  TEST_URL,
  useTestCredentials,
} from "./Helpers/RunCli";
import API from "Common/Utils/API";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/*
 * --json on every command, for scripts and AI agents: the same as -o json,
 * on the commands that print records as on those whose answer is a
 * sentence (delete, login, acknowledge...), which print their sentence in
 * a pipe as in a terminal and their JSON when asked. Errors are JSON too
 * when JSON is asked for. And `whoami --check`, which asks OneUptime.
 */

const CONFIG_FILE: string = path.join(
  os.homedir(),
  ".oneuptime",
  "config.json",
);
const PROJECT_ID: string = "0a6f5e2b-1c3d-4e5f-8a9b-0c1d2e3f4a5b";

function requests(): Array<ApiRequestOptions> {
  return mockExecuteApiRequest.mock.calls.map(
    (call: Array<unknown>): ApiRequestOptions => {
      return call[0] as ApiRequestOptions;
    },
  );
}

describe("JSON on every command", () => {
  beforeEach(() => {
    mockExecuteApiRequest.mockReset();
    mockGetServerVersion.mockReset();
    mockExecuteApiRequest.mockResolvedValue([
      { _id: INCIDENT_ID, title: "Down" },
    ]);

    if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE);
    }
  });

  afterEach(() => {
    clearTestCredentials();
    jest.restoreAllMocks();
  });

  describe("--json", () => {
    it("prints what -o json prints, in a terminal too", async () => {
      useTestCredentials();

      const json: CliRun = await runCli(["incident", "list", "--json"], {
        isTTY: true,
      });
      const output: CliRun = await runCli(["incident", "list", "-o", "json"], {
        isTTY: true,
      });

      expect(json.printed).toEqual(output.printed);
      expect(printedJson(json)).toEqual([{ _id: INCIDENT_ID, title: "Down" }]);
    });

    it("wins over -o table, wherever it is on the command line", async () => {
      useTestCredentials();

      const run: CliRun = await runCli(
        ["--json", "incident", "list", "-o", "table"],
        {
          isTTY: true,
        },
      );

      expect(printedJson(run)).toEqual([{ _id: INCIDENT_ID, title: "Down" }]);
    });

    it("is in the help of every command that prints, and of the program", async () => {
      for (const command of [
        [],
        ["incident", "list"],
        ["incident", "acknowledge"],
        ["incident", "fields"],
        ["login"],
        ["context", "use"],
        ["whoami"],
        ["version"],
        ["deploy"],
        ["dbt", "upload"],
      ]) {
        const run: CliRun = await runCli([...command, "--help"]);

        expect({
          command,
          json: run.printed.join("\n").includes("--json"),
        }).toEqual({
          command,
          json: true,
        });
      }
    });
  });

  describe("a command whose answer is a sentence", () => {
    it("deletes and says so in a terminal and in a pipe, and answers JSON when asked", async () => {
      useTestCredentials();
      mockExecuteApiRequest.mockResolvedValue({});

      const terminal: CliRun = await runCli(
        ["incident", "delete", INCIDENT_ID],
        { isTTY: true },
      );
      const pipe: CliRun = await runCli(["incident", "delete", INCIDENT_ID], {
        isTTY: false,
      });
      const json: CliRun = await runCli([
        "incident",
        "delete",
        INCIDENT_ID,
        "--json",
      ]);

      expect(terminal.printed).toEqual([
        `Incident ${INCIDENT_ID} deleted successfully.`,
      ]);
      expect(pipe.printed).toEqual(terminal.printed);
      expect(printedJson(json)).toEqual({ _id: INCIDENT_ID, deleted: true });
    });

    it("prints the version, or {version} as JSON", async () => {
      const plain: CliRun = await runCli(["version"]);
      const json: CliRun = await runCli(["version", "--json"]);

      expect(plain.printed).toEqual([readCliVersion()]);
      expect(printedJson(json)).toEqual({ version: readCliVersion() });
    });

    it("logs in, switches, shows and deletes contexts as JSON, never with a key in full", async () => {
      const login: CliRun = await runCli([
        "login",
        TEST_API_KEY,
        `${TEST_URL}/`,
        "--context-name",
        "production",
        "--json",
      ]);

      expect(printedJson(login)).toEqual({
        name: "production",
        apiUrl: TEST_URL,
        isCurrent: true,
      });

      await runCli([
        "login",
        "sk-staging-key-0123456789",
        TEST_URL,
        "--context-name",
        "staging",
      ]);

      expect(
        printedJson(await runCli(["context", "use", "production", "--json"])),
      ).toEqual({
        name: "production",
        isCurrent: true,
      });
      expect(
        printedJson(await runCli(["context", "current", "--json"])),
      ).toEqual({
        name: "production",
        apiUrl: TEST_URL,
        apiKey: maskApiKey(TEST_API_KEY),
      });
      expect(
        printedJson(await runCli(["context", "delete", "staging", "--json"])),
      ).toEqual({
        name: "staging",
        deleted: true,
      });

      await runCli(["context", "delete", "production"]);

      expect(
        printedJson(await runCli(["context", "current", "--json"])),
      ).toBeNull();
    });

    it("records a deploy, answering what OneUptime took", async () => {
      jest
        .spyOn(API, "post")
        .mockResolvedValue(
          new HTTPResponse<JSONObject>(200, { ingested: 1, skipped: 0 }, {}),
        );
      process.env["ONEUPTIME_URL"] = TEST_URL;
      process.env["ONEUPTIME_TELEMETRY_INGESTION_KEY"] =
        "ingestion-key-0123456789";

      const run: CliRun = await runCli([
        "deploy",
        "--service",
        "checkout",
        "--service-version",
        "2.3.1",
        "--json",
      ]);

      delete process.env["ONEUPTIME_TELEMETRY_INGESTION_KEY"];

      expect(printedJson(run)).toEqual({
        ingested: 1,
        event: {
          title: "Deploy 2.3.1",
          eventType: "deployment",
          serviceName: "checkout",
          version: "2.3.1",
        },
      });
    });
  });

  describe("errors", () => {
    it("are one JSON object on standard error when JSON is asked for, with the same fields every time", async () => {
      useTestCredentials();
      mockExecuteApiRequest.mockRejectedValue(
        new Error(
          "API error (422): You do not have permissions to read Incident.",
        ),
      );

      const run: CliRun = await runCli(["incident", "list", "--json"]);

      expect(run.exitCode).toBe(1);
      expect(run.printed).toEqual([]);
      expect(run.errors).toHaveLength(1);
      expect(JSON.parse(run.errors[0] as string)).toEqual({
        error: {
          message:
            "API error (422): You do not have permissions to read Incident.",
          status: 422,
          exitCode: 1,
          hint: "Give the API key one of the permissions the message names, in Project Settings → Advanced → API Keys.",
        },
      });
    });

    it("say what to do next, on the line after the error, in a terminal", async () => {
      useTestCredentials();
      mockExecuteApiRequest.mockRejectedValue(
        new Error("API error (404): Incident not found."),
      );

      const run: CliRun = await runCli(["incident", "get", INCIDENT_ID], {
        isTTY: true,
      });

      expect(run.exitCode).toBe(3);
      expect(run.errors).toEqual([
        "Not found: API error (404): Incident not found.",
        "`oneuptime incident list` shows the ones this key may read.",
      ]);
    });

    it("name the fields command when OneUptime refuses a create's data", async () => {
      useTestCredentials();
      mockExecuteApiRequest.mockRejectedValue(
        new Error(
          'API error (400): Invalid data. "titel" is not a field of Incident.',
        ),
      );

      const run: CliRun = await runCli([
        "incident",
        "create",
        "--data",
        '{"titel":"x"}',
      ]);

      expect(run.errors[1]).toBe(
        "`oneuptime incident fields` lists every field, and the flag that sets it.",
      );
    });
  });

  describe("isJsonRequested", () => {
    it.each([
      [["node", "oneuptime", "incident", "list", "--json"], true],
      [["node", "oneuptime", "-o", "json", "incident", "list"], true],
      [["node", "oneuptime", "incident", "list", "--output", "json"], true],
      [["node", "oneuptime", "incident", "list", "--output=json"], true],
      [["node", "oneuptime", "incident", "list", "-ojson"], true],
      [["node", "oneuptime", "incident", "list", "-o", "table"], false],
      [["node", "oneuptime", "incident", "list"], false],
      [["node", "oneuptime", "incident", "create", "--", "--json"], false],
    ])("reads %j as %s", (argv: Array<string>, expected: boolean) => {
      expect(isJsonRequested(argv)).toBe(expected);
    });
  });
});

describe("whoami", () => {
  beforeEach(() => {
    mockExecuteApiRequest.mockReset();
    mockGetServerVersion.mockReset();

    if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE);
    }
  });

  afterEach(() => {
    clearTestCredentials();
  });

  it("says what the next command will use, as JSON too, without asking OneUptime", async () => {
    useTestCredentials();

    const run: CliRun = await runCli(["whoami", "--json"]);

    expect(mockExecuteApiRequest).not.toHaveBeenCalled();
    expect(mockGetServerVersion).not.toHaveBeenCalled();
    expect(printedJson(run)).toEqual({
      authenticated: true,
      url: TEST_URL,
      apiKey: maskApiKey(TEST_API_KEY),
      context: null,
      cliVersion: readCliVersion(),
    });
  });

  it("says when nothing is set, and exits with 0", async () => {
    const run: CliRun = await runCli(["whoami", "--json"]);

    expect(run.exitCode).toBeUndefined();
    expect(printedJson(run)).toEqual({ authenticated: false });
  });

  it("with --check, asks OneUptime for the key's project and its version", async () => {
    useTestCredentials();
    mockExecuteApiRequest.mockResolvedValue([
      { _id: PROJECT_ID, name: "Acme" },
    ]);
    mockGetServerVersion.mockResolvedValue(readCliVersion());

    const run: CliRun = await runCli(["whoami", "--check"], { isTTY: true });

    expect(requests()[0]).toEqual(
      expect.objectContaining({
        apiPath: "/project",
        operation: "list",
        select: { _id: true, name: true },
        limit: 1,
      }),
    );
    expect(mockGetServerVersion).toHaveBeenCalledWith(TEST_URL);
    // The answer to --check first, then what it found.
    expect(run.printed).toEqual([
      KEY_TAKEN,
      `URL:     ${TEST_URL}`,
      `API Key: ${maskApiKey(TEST_API_KEY)}`,
      `Project: Acme (${PROJECT_ID})`,
      `Server:  ${readCliVersion()}`,
      `CLI:     ${readCliVersion()}`,
    ]);
    expect(run.errors).toEqual([]);
  });

  it("with --check, warns when the CLI is of another release than OneUptime, and says what to install", async () => {
    useTestCredentials();
    mockExecuteApiRequest.mockResolvedValue([
      { _id: PROJECT_ID, name: "Acme" },
    ]);
    mockGetServerVersion.mockResolvedValue("14.0.2");

    const run: CliRun = await runCli(["whoami", "--check", "--json"]);

    expect(printedJson(run)).toEqual(
      expect.objectContaining({
        project: { _id: PROJECT_ID, name: "Acme" },
        serverVersion: "14.0.2",
        cliVersion: readCliVersion(),
        versionsMatch: false,
      }),
    );
    expect(run.errors).toEqual([
      getVersionMismatchWarning(readCliVersion(), "14.0.2"),
    ]);
    expect(run.errors[0]).toContain("npm install -g @oneuptime/cli@14.0.2");
  });

  it("with --check, still answers for a key that may not read its project", async () => {
    useTestCredentials();
    mockExecuteApiRequest.mockRejectedValue(
      new Error(
        "API error (422): You do not have permissions to read Project.",
      ),
    );
    mockGetServerVersion.mockResolvedValue(null);

    const run: CliRun = await runCli(["whoami", "--check"], { isTTY: true });

    expect(run.exitCode).toBeUndefined();
    // OneUptime took the key: it only refused to show the project.
    expect(run.printed[0]).toBe(KEY_TAKEN);
    expect(run.printed).toContain("Project: this key may not read its project");
    expect(run.printed).toContain("Server:  did not say its version");
  });

  it("with --check, exits with 2 for a key OneUptime refuses, and for no key at all", async () => {
    useTestCredentials();
    mockExecuteApiRequest.mockRejectedValue(
      new Error("API error (400): Invalid API Key"),
    );
    mockGetServerVersion.mockResolvedValue("14.0.2");

    const refused: CliRun = await runCli(["whoami", "--check", "--json"]);

    expect(refused.exitCode).toBe(2);
    expect(JSON.parse(refused.errors[0] as string).error.exitCode).toBe(2);

    // In a terminal too, and never with the line that it took the key.
    const refusedHere: CliRun = await runCli(["whoami", "--check"], {
      isTTY: true,
    });

    expect(refusedHere.exitCode).toBe(2);
    expect(refusedHere.printed).not.toContain(KEY_TAKEN);
    expect(refusedHere.errors[0]).toContain("Invalid API Key");

    clearTestCredentials();

    const none: CliRun = await runCli(["whoami", "--check"]);

    expect(none.exitCode).toBe(2);
    expect(none.errors[0]).toContain("No credentials found.");
  });

  it.each([
    ["14.0.101", "14.0.101", true],
    ["14.0.101", "14.0.99", false],
    ["14.0.101", null, null],
    ["1.0.0", "14.0.101", null],
    ["14.0.101", "1.0.0", null],
  ])(
    "compares the CLI %s with OneUptime %s: %s",
    (cli: string, server: string | null, match: boolean | null) => {
      expect(versionsMatch(cli, server)).toBe(match);
    },
  );

  it("masks every key but its first and last four characters", () => {
    expect(maskApiKey("sk-1234567890abcdef")).toBe("sk-1****cdef");
    expect(maskApiKey("short")).toBe("****");
  });
});
