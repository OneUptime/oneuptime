import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import API from "Common/Utils/API";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import {
  CLOUD_COST_BREAKDOWN_PATH,
  CLOUD_COST_EXPORT_PATH,
  toBreakdownBody,
  toBreakdownRows,
  toChangePercent,
  toExportBody,
} from "../Commands/CloudCostCommands";
import {
  CliRun,
  TEST_API_KEY,
  TEST_URL,
  clearTestCredentials,
  printedJson,
  runCli,
  useTestCredentials,
} from "./Helpers/RunCli";

/*
 * `oneuptime cloud-cost breakdown` AND `export` (#11009): the flags each
 * takes, the request they make of POST /cloud-cost/breakdown and
 * /cloud-cost/export with the key, and what they print - last month's
 * spend by cost group as a table, as JSON, or as the Costs page's CSV, and
 * a month's costs as a FOCUS 1.2 file.
 */

const VIEW: string = "0192f1a0-1100-7000-8000-0000000e0001";
const ACCOUNT: string = "0192f1a0-1100-7000-8000-00000000ac01";

// Last month by cost group, as the API answers it.
const BY_GROUP: JSONObject = {
  by: "group",
  cloudCostViewId: VIEW,
  viewName: "By team",
  currency: "USD",
  basis: "billed",
  start: "2026-11-01",
  lastDay: "2026-11-30",
  previousStart: "2026-10-01",
  previousLastDay: "2026-10-31",
  total: 850,
  previousTotal: 387.5,
  shares: [
    { key: "g-pay", name: "Payments", amount: 490, previousAmount: 201.5 },
    { key: "g-data", name: "Data", amount: 150, previousAmount: 77.5 },
    { key: "g-search", name: "Search", amount: 120, previousAmount: 62 },
  ],
  rest: [
    {
      kind: "not-in-group",
      name: "Unallocated",
      amount: 90,
      previousAmount: 46.5,
    },
  ],
  readAt: "2026-12-02T12:00:00.000Z",
};

let post: jest.SpyInstance;
let written: string;

beforeEach(() => {
  useTestCredentials();
  written = "";
  jest.spyOn(process.stdout, "write").mockImplementation(((
    chunk: string | Uint8Array,
  ): boolean => {
    written += String(chunk);
    return true;
  }) as never);
});

afterEach(() => {
  clearTestCredentials();
  jest.restoreAllMocks();
});

function answerWith(data: unknown): void {
  post = jest
    .spyOn(API, "post")
    .mockResolvedValue(
      new HTTPResponse<JSONObject>(200, data as JSONObject, {}),
    );
}

function asked(): {
  path: string;
  body: JSONObject;
  headers: Record<string, string>;
} {
  const request: {
    url: { toString: () => string };
    data: JSONObject;
    headers: Record<string, string>;
  } = post.mock.calls[0][0];

  return {
    path: new globalThis.URL(request.url.toString()).pathname,
    body: request.data,
    headers: request.headers,
  };
}

describe("what the flags ask", () => {
  test("a breakdown: by service, this month, against the period before, when nothing is said", () => {
    expect(toBreakdownBody({})).toEqual({
      by: "service",
      compareWithPrevious: true,
      period: "this-month",
    });
  });

  test("by cost group, for a view, last month, on a basis, in a currency, for some accounts, as CSV", () => {
    expect(
      toBreakdownBody({
        by: "group",
        view: VIEW,
        period: "last-month",
        basis: "amortized",
        currency: "EUR",
        account: [ACCOUNT, ACCOUNT.replace(/1$/, "2")],
        csv: true,
        compare: false,
      }),
    ).toEqual({
      by: "group",
      cloudCostViewId: VIEW,
      period: "last-month",
      basis: "amortized",
      currency: "EUR",
      cloudAccountIds: [ACCOUNT, ACCOUNT.replace(/1$/, "2")],
      format: "csv",
      compareWithPrevious: false,
    });
  });

  test("days of one's own, both or neither", () => {
    expect(
      toBreakdownBody({ startDate: "2026-11-01", endDate: "2026-11-15" }),
    ).toMatchObject({ startDate: "2026-11-01", endDate: "2026-11-15" });
    expect(() => {
      toBreakdownBody({ startDate: "2026-11-01" });
    }).toThrow("Give both --start-date and --end-date");
    expect(() => {
      toExportBody({ endDate: "2026-11-30" });
    }).toThrow("Give both --start-date and --end-date");
  });

  test("an export: last month unless said", () => {
    expect(toExportBody({})).toEqual({ period: "last-month" });
    expect(
      toExportBody({
        startDate: "2026-10-01",
        endDate: "2026-12-31",
        account: [ACCOUNT],
      }),
    ).toEqual({
      startDate: "2026-10-01",
      endDate: "2026-12-31",
      cloudAccountIds: [ACCOUNT],
    });
  });

  test("the rows printed: each share and what is left out, with its change", () => {
    expect(toBreakdownRows(BY_GROUP)).toEqual([
      {
        name: "Payments",
        key: "g-pay",
        amount: 490,
        previousAmount: 201.5,
        change: "143.2%",
      },
      {
        name: "Data",
        key: "g-data",
        amount: 150,
        previousAmount: 77.5,
        change: "93.5%",
      },
      {
        name: "Search",
        key: "g-search",
        amount: 120,
        previousAmount: 62,
        change: "93.5%",
      },
      {
        name: "Unallocated",
        key: "not-in-group",
        amount: 90,
        previousAmount: 46.5,
        change: "93.5%",
      },
    ]);
    expect(toChangePercent(10, 0)).toBe("");
    expect(toChangePercent(50, 100)).toBe("-50.0%");
  });
});

describe("oneuptime cloud-cost breakdown", () => {
  test("last month's spend by cost group, the done-when of #11009, as JSON", async () => {
    answerWith(BY_GROUP);

    const run: CliRun = await runCli([
      "cloud-cost",
      "breakdown",
      "--by",
      "group",
      "--view",
      VIEW,
      "--period",
      "last-month",
      "--json",
    ]);

    expect(run.exitCode).toBeUndefined();
    expect(printedJson(run)).toEqual(BY_GROUP);
    expect(asked()).toEqual({
      path: CLOUD_COST_BREAKDOWN_PATH,
      body: {
        by: "group",
        cloudCostViewId: VIEW,
        period: "last-month",
        compareWithPrevious: true,
      },
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        APIKey: TEST_API_KEY,
      },
    });
    expect(String(post.mock.calls[0][0].url)).toContain(
      new globalThis.URL(TEST_URL).hostname,
    );
  });

  test("as a table: a row a group, then the period's total", async () => {
    answerWith(BY_GROUP);

    const run: CliRun = await runCli([
      "cloud-cost",
      "breakdown",
      "--by",
      "group",
      "--view",
      VIEW,
      "--period",
      "last-month",
      "--output",
      "table",
    ]);
    const printed: string = run.printed.join("\n");

    expect(printed).toContain("Payments");
    expect(printed).toContain("Unallocated");
    expect(printed.indexOf("Payments")).toBeLessThan(printed.indexOf("Data"));
    expect(printed).toContain("2026-11-01 to 2026-11-30, billed: 850 USD");
  });

  test("--csv prints the Costs page's file as the API gives it", async () => {
    const csv: string =
      '"cost_group","key","amount"\n"Payments","g-pay","490"\n';
    answerWith(csv);

    await runCli(["cloud-cost", "breakdown", "--by", "service", "--csv"]);

    expect(written).toBe(csv);
    expect(asked().headers["Accept"]).toBe("text/csv");
    expect(asked().body["format"]).toBe("csv");
  });

  test("a refusal is said, with the API's words, and the command fails", async () => {
    jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPErrorResponse(
          403,
          { message: "You need a role that may read cloud costs." },
          {},
        ) as never,
      );

    const run: CliRun = await runCli(["cloud-cost", "breakdown"]);

    expect(run.exitCode).not.toBe(0);
    expect(run.errors.join("\n")).toContain(
      "You need a role that may read cloud costs.",
    );
  });

  test("a dimension it does not know is refused before anything is asked", async () => {
    const spy: jest.SpyInstance = jest.spyOn(API, "post");

    const run: CliRun = await runCli([
      "cloud-cost",
      "breakdown",
      "--by",
      "colour",
    ]);

    expect(run.exitCode).not.toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("oneuptime cloud-cost export", () => {
  test("writes last month's FOCUS file where it is told", async () => {
    const focus: string = 'BilledCost,BillingAccountId\n10,"999999999999"\n';
    answerWith(focus);
    const directory: string = fs.mkdtempSync(
      path.join(os.tmpdir(), "cloud-cost-focus-"),
    );
    const file: string = path.join(directory, "focus.csv");

    try {
      const run: CliRun = await runCli([
        "cloud-cost",
        "export",
        "--period",
        "last-month",
        "--file",
        file,
      ]);

      expect(run.exitCode).toBeUndefined();
      expect(fs.readFileSync(file, "utf8")).toBe(focus);
      expect(asked().path).toBe(CLOUD_COST_EXPORT_PATH);
      expect(asked().body).toEqual({ period: "last-month" });
      expect(asked().headers["Accept"]).toBe("text/csv");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("with --json, says where it wrote the file, as JSON", async () => {
    answerWith("BilledCost\n1\n");
    const directory: string = fs.mkdtempSync(
      path.join(os.tmpdir(), "cloud-cost-focus-"),
    );
    const file: string = path.join(directory, "focus.csv");

    try {
      const run: CliRun = await runCli([
        "cloud-cost",
        "export",
        "--file",
        file,
        "--json",
      ]);

      expect(printedJson(run)).toEqual({
        file,
        focusVersion: "1.2",
        bytes: 13,
      });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("prints it to standard output without --file", async () => {
    answerWith("BilledCost\n1\n");

    await runCli([
      "cloud-cost",
      "export",
      "--start-date",
      "2026-10-01",
      "--end-date",
      "2026-10-31",
    ]);

    expect(written).toBe("BilledCost\n1\n");
    expect(asked().body).toEqual({
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });
  });
});
