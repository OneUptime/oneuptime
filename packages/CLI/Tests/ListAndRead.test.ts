import { ApiRequestOptions } from "../Core/ApiClient";

const mockExecuteApiRequest: jest.Mock = jest.fn();
jest.mock("../Core/ApiClient", () => {
  return {
    ...jest.requireActual("../Core/ApiClient"),
    executeApiRequest: (...args: unknown[]): unknown => {
      return mockExecuteApiRequest(...args);
    },
  };
});

import {
  LIST_ALL_MAX_RECORDS,
  LIST_ALL_PAGE_SIZE,
} from "../Commands/ResourceCommands";
import {
  clearTestCredentials,
  CliRun,
  INCIDENT_ID,
  printedJson,
  runCli,
  useTestCredentials,
} from "./Helpers/RunCli";
import {
  generateAllFieldsSelect,
  getRefusedSelectColumn,
} from "../Utils/SelectFieldGenerator";
import { JSONObject } from "Common/Types/JSON";
import { FastestRun, fastestRun } from "Common/Tests/Helpers/FastestRun";

/*
 * Reading: --fields picks the fields, --all reads every page, and a list
 * or a get with the default select - every field the key may read - leaves
 * out a field the key may not read and asks again, as the MCP server and
 * the Terraform provider do.
 */

function requests(): Array<ApiRequestOptions> {
  return mockExecuteApiRequest.mock.calls.map(
    (call: Array<unknown>): ApiRequestOptions => {
      return call[0] as ApiRequestOptions;
    },
  );
}

function rows(count: number, from: number = 0): Array<JSONObject> {
  return Array.from(
    { length: count },
    (_: unknown, index: number): JSONObject => {
      return { _id: `row-${from + index}` };
    },
  );
}

describe("reading records", () => {
  beforeEach(() => {
    mockExecuteApiRequest.mockReset();
    mockExecuteApiRequest.mockResolvedValue([]);
    useTestCredentials();
  });

  afterEach(() => {
    clearTestCredentials();
  });

  describe("--fields", () => {
    it("asks for the fields it names, the ID always among them", async () => {
      await runCli([
        "incident",
        "list",
        "--fields",
        "title, createdAt",
        "--json",
      ]);

      expect(requests()[0]?.select).toEqual({
        _id: true,
        title: true,
        createdAt: true,
      });
    });

    it("asks for a relation's ID and name, or for the field a dot names", async () => {
      await runCli([
        "incident",
        "get",
        INCIDENT_ID,
        "--fields",
        "title,currentIncidentState,incidentSeverity.order",
        "--json",
      ]);

      expect(requests()[0]?.select).toEqual({
        _id: true,
        title: true,
        currentIncidentState: { _id: true, name: true },
        incidentSeverity: { _id: true, order: true },
      });
    });

    it("refuses a field the resource does not have, naming the command that lists them", async () => {
      const run: CliRun = await runCli([
        "incident",
        "list",
        "--fields",
        "titel",
      ]);

      expect(run.exitCode).toBe(1);
      expect(mockExecuteApiRequest).not.toHaveBeenCalled();
      expect(run.errors.join("\n")).toContain(
        'The incident resource has no field "titel". `oneuptime incident fields` lists them.',
      );
    });

    it("works for telemetry, by its columns", async () => {
      await runCli(["log", "list", "--fields", "body,severityText", "--json"]);

      expect(requests()[0]?.select).toEqual({
        _id: true,
        body: true,
        severityText: true,
      });

      const unknown: CliRun = await runCli([
        "log",
        "list",
        "--fields",
        "message",
      ]);

      expect(unknown.exitCode).toBe(1);
    });
  });

  describe("--all", () => {
    it("reads page after page until one comes back short, and prints them all", async () => {
      mockExecuteApiRequest
        .mockResolvedValueOnce(rows(LIST_ALL_PAGE_SIZE))
        .mockResolvedValueOnce({
          data: rows(LIST_ALL_PAGE_SIZE, LIST_ALL_PAGE_SIZE),
        })
        .mockResolvedValueOnce(rows(3, LIST_ALL_PAGE_SIZE * 2));

      const run: CliRun = await runCli(["monitor", "list", "--all", "--json"]);

      expect(run.exitCode).toBeUndefined();
      expect(
        requests().map((request: ApiRequestOptions) => [
          request.skip,
          request.limit,
        ]),
      ).toEqual([
        [0, LIST_ALL_PAGE_SIZE],
        [LIST_ALL_PAGE_SIZE, LIST_ALL_PAGE_SIZE],
        [LIST_ALL_PAGE_SIZE * 2, LIST_ALL_PAGE_SIZE],
      ]);
      expect((printedJson(run) as Array<unknown>).length).toBe(
        LIST_ALL_PAGE_SIZE * 2 + 3,
      );
    });

    it("keeps the query and the sort on every page", async () => {
      mockExecuteApiRequest.mockResolvedValue(rows(1));

      await runCli([
        "monitor",
        "list",
        "--all",
        "--query",
        '{"name":"API"}',
        "--sort",
        '{"name":"ASC"}',
      ]);

      expect(requests()[0]?.query).toEqual({ name: "API" });
      expect(requests()[0]?.sort).toEqual({ name: "ASC" });
    });

    it("stops at its limit, should a server answer every page the same, and says so", async () => {
      mockExecuteApiRequest.mockResolvedValue(rows(LIST_ALL_PAGE_SIZE));

      const run: CliRun = await runCli(["monitor", "list", "--all", "--json"]);

      expect(requests()).toHaveLength(
        LIST_ALL_MAX_RECORDS / LIST_ALL_PAGE_SIZE,
      );
      expect(run.errors.join("\n")).toContain(
        `Stopped after ${LIST_ALL_MAX_RECORDS} records.`,
      );
    });

    it("cannot be given with --limit or --skip", async () => {
      const run: CliRun = await runCli([
        "monitor",
        "list",
        "--all",
        "--limit",
        "5",
      ]);

      expect(run.exitCode).toBe(1);
      expect(mockExecuteApiRequest).not.toHaveBeenCalled();
      expect(run.errors.join("\n")).toContain(
        "cannot be used with option '--limit <n>'",
      );
    });

    it("is for records only: telemetry is read a page at a time", async () => {
      const run: CliRun = await runCli(["log", "list", "--all"]);

      expect(run.exitCode).toBe(1);
      expect(run.errors.join("\n")).toContain("unknown option '--all'");
    });
  });

  describe("the default select", () => {
    it("leaves out a field the key may not read, asks again, and says which", async () => {
      mockExecuteApiRequest
        .mockRejectedValueOnce(
          new Error(
            "API error (422): You do not have permissions to select on - rootCause. You need one of these permissions: Project Owner.",
          ),
        )
        .mockRejectedValueOnce(
          new Error(
            "API error (422): You do not have permissions to select on - postmortemNote. No permission allows it: the column is not readable through the API.",
          ),
        )
        .mockResolvedValueOnce([
          { _id: INCIDENT_ID, title: "Checkout is down" },
        ]);

      const run: CliRun = await runCli(["incident", "list", "--json"]);

      expect(run.exitCode).toBeUndefined();
      expect(requests()).toHaveLength(3);
      expect(requests()[0]?.select?.["rootCause"]).toBe(true);
      expect(requests()[1]?.select?.["rootCause"]).toBeUndefined();
      expect(requests()[2]?.select?.["postmortemNote"]).toBeUndefined();
      expect(printedJson(run)).toEqual([
        { _id: INCIDENT_ID, title: "Checkout is down" },
      ]);
      expect(run.errors).toEqual([
        "Left out fields this API key may not read: rootCause, postmortemNote.",
      ]);
    });

    it("does the same for a get", async () => {
      mockExecuteApiRequest
        .mockRejectedValueOnce(
          new Error(
            "API error (422): You do not have permissions to select on - rootCause. You need one of these permissions: Project Owner.",
          ),
        )
        .mockResolvedValueOnce({ _id: INCIDENT_ID });

      const run: CliRun = await runCli([
        "incident",
        "get",
        INCIDENT_ID,
        "--json",
      ]);

      expect(run.exitCode).toBeUndefined();
      expect(requests()).toHaveLength(2);
    });

    it("never drops a field --fields names: the refusal is the answer", async () => {
      mockExecuteApiRequest.mockRejectedValue(
        new Error(
          "API error (422): You do not have permissions to select on - rootCause. You need one of these permissions: Project Owner.",
        ),
      );

      const run: CliRun = await runCli([
        "incident",
        "list",
        "--fields",
        "rootCause",
      ]);

      expect(run.exitCode).toBe(1);
      expect(requests()).toHaveLength(1);
    });

    it("never asks for a field no read rule opens, which the server refuses: a service's language", () => {
      const select: JSONObject = generateAllFieldsSelect("Service", "database");

      expect(select["name"]).toBe(true);
      expect(select["serviceLanguage"]).toBeUndefined();
      // The columns every select may name stay.
      expect(select["_id"]).toBe(true);
      expect(select["createdAt"]).toBe(true);
    });
  });

  describe("the refused field", () => {
    it.each([
      [
        "API error (422): You do not have permissions to select on - rootCause. You need one of these permissions: Project Owner.",
        "rootCause",
      ],
      ["You do not have permissions to select on - is_2fa_on.", "is_2fa_on"],
      ["API error (422): You do not have permissions to read Incident.", null],
      ["You do not have permissions to select on - ", null],
    ])("is read out of %j", (message: string, column: string | null) => {
      expect(getRefusedSelectColumn(message)).toBe(column);
    });

    // Read with indexOf, never a pattern: 400,000 characters of the worst case.
    it("is read in time that grows with the message, on a long one", () => {
      const message: string = `${"permissions to select on - ".repeat(15000)}${"a".repeat(400000)}`;
      const read: FastestRun<string | null> = fastestRun({
        run: (): string | null => {
          return getRefusedSelectColumn(message);
        },
        limitInMs: 2000,
      });

      expect(read.result).toBe("permissions");
      expect(read.inMs).toBeLessThan(2000);
    });
  });

  it.each([
    [
      ["--limit", "ten"],
      '--limit takes a whole number, such as 10, and "ten" is not one.',
    ],
    [
      ["--skip", "-5"],
      '--skip takes a whole number, such as 10, and "-5" is not one.',
    ],
  ])("refuses %j as a page", async (flags: Array<string>, message: string) => {
    const run: CliRun = await runCli(["incident", "list", ...flags]);

    expect(run.exitCode).toBe(1);
    expect(mockExecuteApiRequest).not.toHaveBeenCalled();
    expect(run.errors.join("\n")).toContain(message);
  });
});
