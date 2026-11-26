import CloudAccount from "../../../../Models/DatabaseModels/CloudAccount";
import CloudCostReport from "../../../../Models/DatabaseModels/CloudCostReport";
import { readExportWindow } from "../../../../Server/API/CloudCostAPI";
import CloudAccountService from "../../../../Server/Services/CloudAccountService";
import CloudCostSettingService from "../../../../Server/Services/CloudCostSettingService";
import {
  CloudCostBreakdownAnswer,
  CloudCostBreakdownPeriod,
  CloudCostBreakdownRequest,
  answerCloudCostBreakdown,
  getCloudCostBreakdownPeriodWindow,
  readCloudCostBreakdownBody,
  toCloudCostBreakdownAnswerCsv,
} from "../../../../Server/Utils/CloudCost/CloudCostBreakdownAnswer";
import CloudCostReportBuilder from "../../../../Server/Utils/CloudCost/CloudCostReportBuilder";
import { getCloudCostAccountsCurrency } from "../../../../Server/Utils/CloudCost/CloudCostServerReader";
import URL from "../../../../Types/API/URL";
import AggregateBy from "../../../../Types/BaseDatabase/AggregateBy";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import { CloudCostState } from "../../../../Types/Cloud/CloudCost";
import { CloudCostAllocationWindow } from "../../../../Types/Cloud/CloudCostAllocation";
import { CloudCostBasis } from "../../../../Types/Cloud/CloudCostBasis";
import { CloudCostBreakdownReader } from "../../../../Types/Cloud/CloudCostBreakdowns";
import { CloudCostReportScope } from "../../../../Types/Cloud/CloudCostReport";
import {
  EMAIL_ATTACHMENTS_MAX_BYTES,
  getBase64ByteLength,
  readEmailAttachments,
  toEmailAttachmentFileName,
} from "../../../../Types/Email/EmailAttachment";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * THE BREAKDOWN API AND THE CLI'S ASKS (#11009): what POST
 * /cloud-cost/breakdown and /cloud-cost/export take - each by, period and
 * window, refused with what to fix - the days each period is on the UTC
 * calendar, the currency asked of nobody, and the answer as the CSV the
 * page downloads. With the attachments every mail transport now carries,
 * and the link a report's button opens.
 */

const PROJECT: ObjectID = new ObjectID("0192f1a0-1100-7000-8000-000000011009");
const VIEW: string = "0192f1a0-1100-7000-8000-0000000e0001";
const ACCOUNT: string = "0192f1a0-1100-7000-8000-00000000ac01";
const NOW: Date = new Date("2026-12-02T12:00:00.000Z");

function days(window: CloudCostAllocationWindow): string {
  return `${window.start.toISOString().slice(0, 10)}..${window.lastDay
    .toISOString()
    .slice(0, 10)}`;
}

function read(body: unknown): CloudCostBreakdownRequest {
  return readCloudCostBreakdownBody(body, NOW);
}

function accountOf(currency: string, state: CloudCostState): CloudAccount {
  const account: CloudAccount = new CloudAccount();
  account.id = ObjectID.generate();
  account.name = `${currency} account`;
  account.costSummary = {
    state,
    currency,
    monthToDate: 0,
    lastMonth: 0,
    monthFullDays: 0,
    lastMonthToDate: 0,
    projectedMonth: 0,
    last30Days: 0,
    topServices: [],
  } as unknown as JSONObject;
  return account;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what a breakdown is by", () => {
  test.each([
    ["service", "service"],
    ["Services", "service"],
    ["region", "region"],
    ["account", "cloudAccountId"],
    ["cloudAccountId", "cloudAccountId"],
    ["resource", "resourceId"],
    ["environment", "environment"],
    ["apps", "app"],
    ["group", "group"],
    ["cost-group", "group"],
  ])("by %s is a breakdown by %s", (by: string, dimension: string) => {
    expect(
      read({ by, cloudCostViewId: VIEW, tagKey: "team" }).by,
    ).toBe(dimension);
  });

  test("by service when nothing is said", () => {
    expect(read({}).by).toBe("service");
    expect(read(null).by).toBe("service");
    expect(read([]).by).toBe("service");
  });

  test("anything else is refused, naming what it takes", () => {
    expect(() => {
      read({ by: "colour" });
    }).toThrow(
      "Send by as one of service, region, account, resource, environment, app, tag or group.",
    );
  });

  test("by tag needs its key, of at most 128 characters", () => {
    expect(() => {
      read({ by: "tag" });
    }).toThrow("A breakdown by tag needs its tagKey, such as team.");
    expect(() => {
      read({ by: "tag", tagKey: "k".repeat(129) });
    }).toThrow("A tag's key is at most 128 characters.");
    expect(read({ by: "tag", tagKey: "  team " }).tagKey).toBe("team");
  });

  test("by cost group needs the view whose groups it is by, as an ID", () => {
    expect(() => {
      read({ by: "group" });
    }).toThrow(
      "A breakdown by cost group needs the cost view whose groups it is by: send its cloudCostViewId.",
    );
    expect(() => {
      read({ by: "group", cloudCostViewId: "not-an-id" });
    }).toThrow("Send cloudCostViewId as an ID.");
    expect(read({ by: "group", viewId: { _id: VIEW } }).viewId?.toString()).toBe(
      VIEW,
    );
  });
});

describe("the days a breakdown covers", () => {
  test("each period on the UTC calendar of now", () => {
    expect(days(read({ period: "this-month" }).window)).toBe(
      "2026-12-01..2026-12-02",
    );
    expect(days(read({ period: "mtd" }).window)).toBe("2026-12-01..2026-12-02");
    expect(days(read({ period: "last-month" }).window)).toBe(
      "2026-11-01..2026-11-30",
    );
    // Wednesday 2 December: the week before is Monday 23 to Sunday 29.
    expect(days(read({ period: "last-week" }).window)).toBe(
      "2026-11-23..2026-11-29",
    );
    expect(days(read({ period: "last-30-days" }).window)).toBe(
      "2026-11-03..2026-12-02",
    );
    expect(days(read({}).window)).toBe("2026-12-01..2026-12-02");
  });

  test("or a start and an end, as dates or the Dashboard's date values", () => {
    expect(
      days(read({ startDate: "2026-10-01", endDate: "2026-10-31" }).window),
    ).toBe("2026-10-01..2026-10-31");
    expect(
      days(
        read({
          startDate: { _type: "DateTime", value: "2026-10-01T00:00:00.000Z" },
          endDate: { _type: "DateTime", value: "2026-10-05T00:00:00.000Z" },
        }).window,
      ),
    ).toBe("2026-10-01..2026-10-05");
  });

  test("a window that ends before it starts, runs past what is kept, or is no date is refused", () => {
    expect(() => {
      read({ startDate: "2026-11-30", endDate: "2026-11-01" });
    }).toThrow(BadDataException);
    expect(() => {
      read({ startDate: "2024-01-01", endDate: "2026-11-30" });
    }).toThrow("A cost read covers at most 400");
    expect(() => {
      read({ startDate: "yesterday", endDate: "2026-11-30" });
    }).toThrow("Send startDate as a date, such as 2026-11-01.");
    expect(() => {
      read({ period: "last-year" });
    }).toThrow(
      "Send period as this-month, last-month, last-week or last-30-days, or send startDate and endDate.",
    );
  });

  test("the period names are the CLI's", () => {
    expect(
      days(
        getCloudCostBreakdownPeriodWindow({
          period: CloudCostBreakdownPeriod.LastMonth,
          now: new Date("2027-01-10T00:00:00.000Z"),
        }),
      ),
    ).toBe("2026-12-01..2026-12-31");
  });
});

describe("the rest of a breakdown's ask", () => {
  test("accounts as a list of IDs, a basis, a currency, CSV, and the period before unless refused", () => {
    const request: CloudCostBreakdownRequest = read({
      cloudAccountIds: [ACCOUNT],
      basis: "net",
      currency: " eur ",
      format: "CSV",
      compareWithPrevious: false,
    });

    expect(request.cloudAccountIds?.map(String)).toEqual([ACCOUNT]);
    expect(request.basis).toBe(CloudCostBasis.Net);
    expect(request.currency).toBe("EUR");
    expect(request.format).toBe("csv");
    expect(request.compareWithPrevious).toBe(false);
    expect(read({}).compareWithPrevious).toBe(true);
    expect(read({ costBasis: "amortized" }).basis).toBe(CloudCostBasis.Amortized);
  });

  test("anything else is refused with what to send", () => {
    expect(() => {
      read({ cloudAccountIds: ACCOUNT });
    }).toThrow("Send cloudAccountIds as a list of IDs.");
    expect(() => {
      read({ cloudAccountIds: ["nope"] });
    }).toThrow("Send each of cloudAccountIds as an ID.");
    expect(() => {
      read({ basis: "list" });
    }).toThrow("Send basis as billed, amortized or net.");
    expect(() => {
      read({ format: "xlsx" });
    }).toThrow("Send format as json or csv.");
  });
});

describe("the currency nobody asked for", () => {
  test("is Costs' own: the one most of the readable accounts are read in", () => {
    expect(
      getCloudCostAccountsCurrency([
        accountOf("EUR", CloudCostState.Reading),
        accountOf("USD", CloudCostState.Reading),
        accountOf("EUR", CloudCostState.Reading),
        // Not read: counts for nothing.
        accountOf("GBP", CloudCostState.NotAllowed),
        accountOf("GBP", CloudCostState.NotAllowed),
        accountOf("GBP", CloudCostState.NotAllowed),
      ]),
    ).toBe("EUR");
    expect(getCloudCostAccountsCurrency([])).toBe("USD");
    expect(
      CloudCostReportBuilder.getCurrency(
        [accountOf("eur", CloudCostState.Reading)],
        CloudCostBasis.Billed,
      ),
    ).toBe("EUR");
  });

  test("an answer is in the caller's accounts' currency, on the project's basis, named and dated", async () => {
    jest.spyOn(CloudAccountService, "findBy").mockImplementation((async () => {
      const account: CloudAccount = accountOf("EUR", CloudCostState.Reading);
      account.id = new ObjectID(ACCOUNT);
      account.name = "Shop EU";
      return [account];
    }) as never);
    jest
      .spyOn(CloudCostSettingService, "getCostBasisOfProject")
      .mockResolvedValue(CloudCostBasis.Amortized);

    const asked: Array<AggregateBy<never>> = [];
    const reader: CloudCostBreakdownReader = {
      aggregate: async (aggregateBy: AggregateBy<never>) => {
        asked.push(aggregateBy);
        const isNovember: boolean =
          new Date(
            (
              (aggregateBy.query as Record<string, unknown>)["day"] as {
                startValue: Date;
              }
            ).startValue,
          ).getUTCMonth() === 10;
        return {
          data: [
            {
              cloudAccountId: ACCOUNT,
              value: isNovember ? 120 : 100,
            },
            // An account since removed.
            {
              cloudAccountId: "0192f1a0-1100-7000-8000-00000000dead",
              value: isNovember ? 5 : 0,
            },
          ],
        } as unknown as AggregatedResult;
      },
      readAllocation: async () => {
        throw new Error("Not by group.");
      },
      readPlatformLists: async () => {
        return { environments: [], apps: [] };
      },
    } as unknown as CloudCostBreakdownReader;

    const answer: CloudCostBreakdownAnswer = await answerCloudCostBreakdown({
      projectId: PROJECT,
      props: { isRoot: true },
      request: read({ by: "account", period: "last-month" }),
      now: NOW,
      reader,
    });

    expect(answer).toEqual({
      by: "cloudAccountId",
      currency: "EUR",
      basis: CloudCostBasis.Amortized,
      start: "2026-11-01",
      lastDay: "2026-11-30",
      previousStart: "2026-10-01",
      previousLastDay: "2026-10-31",
      previousTotal: 100,
      total: 125,
      shares: [
        { key: ACCOUNT, name: "Shop EU", amount: 120, previousAmount: 100 },
        {
          key: "0192f1a0-1100-7000-8000-00000000dead",
          name: "An account since removed",
          amount: 5,
          previousAmount: 0,
        },
      ],
      rest: [],
      readAt: NOW.toISOString(),
    });
    // Each period read in the answer's currency, on its basis.
    for (const aggregateBy of asked) {
      expect((aggregateBy.query as Record<string, unknown>)["currency"]).toBe(
        "EUR",
      );
      expect(aggregateBy.aggregateColumnName).toBe("amortizedCost");
    }

    // As a CSV: the page's columns, the period before beside it.
    const csv: string = toCloudCostBreakdownAnswerCsv(answer);
    expect(csv.split("\n")[0]).toBe(
      '"account","key","period_start","period_end","previous_period_start","previous_period_end","currency","cost_basis","amount","previous_amount","change_percent"',
    );
    expect(csv.split("\n")[1]).toBe(
      `"Shop EU","${ACCOUNT}","2026-11-01","2026-11-30","2026-10-01","2026-10-31","EUR","amortized","120","100","20"`,
    );
  });

  test("a currency that is no code is refused", async () => {
    await expect(
      answerCloudCostBreakdown({
        projectId: PROJECT,
        props: { isRoot: true },
        request: read({ currency: "dollars", basis: "billed" }),
        now: NOW,
        reader: {} as CloudCostBreakdownReader,
      }),
    ).rejects.toThrow("The currency must be a three-letter code");
  });
});

describe("the FOCUS export's days", () => {
  test("last month unless said, a period or a start and end", () => {
    expect(days(readExportWindow({}, NOW))).toBe("2026-11-01..2026-11-30");
    expect(days(readExportWindow({ period: "month-to-date" }, NOW))).toBe(
      "2026-12-01..2026-12-02",
    );
    expect(
      days(
        readExportWindow({ startDate: "2026-10-01", endDate: "2026-12-31" }, NOW),
      ),
    ).toBe("2026-10-01..2026-12-31");
    expect(() => {
      readExportWindow({ startDate: "soon" }, NOW);
    }).toThrow(
      "Send startDate and endDate as dates, such as 2026-11-01 and 2026-11-30.",
    );
    expect(() => {
      readExportWindow({ period: "forever" }, NOW);
    }).toThrow(BadDataException);
  });
});

describe("a report's button", () => {
  const window: CloudCostAllocationWindow = {
    start: new Date("2026-11-16T00:00:00.000Z"),
    lastDay: new Date("2026-11-22T00:00:00.000Z"),
  };

  test("opens Costs on exactly the report's days and basis, by the view's groups for a view", () => {
    const report: CloudCostReport = new CloudCostReport();
    report.scope = CloudCostReportScope.CostView;

    expect(
      CloudCostReportBuilder.getCostsUrl({
        dashboardUrl: URL.fromString("https://oneuptime.example/dashboard/"),
        projectId: PROJECT,
        report,
        window,
        basis: CloudCostBasis.Net,
        viewId: new ObjectID(VIEW),
      }),
    ).toBe(
      `https://oneuptime.example/dashboard/${PROJECT.toString()}/cloud/costs?start=2026-11-16&end=2026-11-22&basis=net&by=group&view=${VIEW}`,
    );
  });

  test("an account's report opens that account's Costs", () => {
    const report: CloudCostReport = new CloudCostReport();
    report.scope = CloudCostReportScope.Account;
    report.cloudAccountId = new ObjectID(ACCOUNT);

    expect(
      CloudCostReportBuilder.getCostsUrl({
        dashboardUrl: URL.fromString("https://oneuptime.example/dashboard"),
        projectId: PROJECT,
        report,
        window,
        basis: CloudCostBasis.Billed,
      }),
    ).toBe(
      `https://oneuptime.example/dashboard/${PROJECT.toString()}/cloud/accounts/${ACCOUNT}/costs?start=2026-11-16&end=2026-11-22&basis=billed`,
    );
  });
});

describe("an email's attachments", () => {
  const csv: string = Buffer.from('"a","b"\n"1","2"\n', "utf8").toString(
    "base64",
  );

  test("a CSV is carried, its name without a path, a quote or a line break", () => {
    expect(
      readEmailAttachments([
        {
          fileName: '../../etc/"costs"\r\n.csv',
          mimeType: "TEXT/CSV",
          contentBase64: csv,
        },
      ]),
    ).toEqual([
      { fileName: "costs.csv", mimeType: "text/csv", contentBase64: csv },
    ]);
    expect(toEmailAttachmentFileName("")).toBe("attachment");
    expect(toEmailAttachmentFileName("a".repeat(200))).toHaveLength(120);
  });

  test("anything but a CSV, broken base64, a fourth file or one past 512 KB is left out", () => {
    const big: string = Buffer.alloc(EMAIL_ATTACHMENTS_MAX_BYTES - 10).toString(
      "base64",
    );

    expect(
      readEmailAttachments([
        { fileName: "a.exe", mimeType: "application/x-msdownload", contentBase64: csv },
        { fileName: "b.csv", mimeType: "text/csv", contentBase64: "not base64!" },
        { fileName: "c.csv", mimeType: "text/csv", contentBase64: "" },
        "junk",
        null,
      ]),
    ).toEqual([]);
    expect(
      readEmailAttachments([
        { fileName: "1.csv", mimeType: "text/csv", contentBase64: csv },
        { fileName: "2.csv", mimeType: "text/csv", contentBase64: csv },
        { fileName: "3.csv", mimeType: "text/csv", contentBase64: csv },
        { fileName: "4.csv", mimeType: "text/csv", contentBase64: csv },
      ]).map((attachment: { fileName: string }) => attachment.fileName),
    ).toEqual(["1.csv", "2.csv", "3.csv"]);
    expect(
      readEmailAttachments([
        { fileName: "big.csv", mimeType: "text/csv", contentBase64: big },
        { fileName: "more.csv", mimeType: "text/csv", contentBase64: csv },
      ]).map((attachment: { fileName: string }) => attachment.fileName),
    ).toEqual(["big.csv"]);
    expect(readEmailAttachments("nope")).toEqual([]);
  });

  test("a base64 text's size is its bytes'", () => {
    expect(getBase64ByteLength(Buffer.from("hello").toString("base64"))).toBe(5);
    expect(getBase64ByteLength(Buffer.from("hell").toString("base64"))).toBe(4);
    expect(getBase64ByteLength("")).toBe(0);
  });
});
