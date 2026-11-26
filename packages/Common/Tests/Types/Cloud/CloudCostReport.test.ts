import { CloudCostAllocationWindow } from "../../../Types/Cloud/CloudCostAllocation";
import {
  CLOUD_COST_REPORT_MAX_EMAIL_ADDRESSES,
  CLOUD_COST_REPORT_PERIOD_LABELS,
  CLOUD_COST_REPORT_PREVIOUS_LABELS,
  CLOUD_COST_REPORT_SCOPE_LABELS,
  CLOUD_COST_REPORT_SKIP_REASON_LABELS,
  CloudCostReportContent,
  CloudCostReportPeriod,
  CloudCostReportScope,
  CloudCostReportSkipReason,
  getCloudCostReportLocalDay,
  getCloudCostReportPreviousWindow,
  getCloudCostReportWindow,
  isCloudCostReportPeriod,
  isCloudCostReportScope,
  isCloudCostReportSkipReason,
  readCloudCostReportEmailAddresses,
  toCloudCostReportDays,
  toCloudCostReportEmailAddress,
} from "../../../Types/Cloud/CloudCostReport";
import {
  CloudCostReportText,
  formatCloudCostDays,
  formatCloudCostMoney,
  formatCloudCostMonth,
  getCloudCostReportChange,
  writeCloudCostReport,
} from "../../../Types/Cloud/CloudCostReportWords";
import { createTranslator, Translator } from "../../../Types/Translator";
import { describe, expect, test } from "@jest/globals";

/*
 * A COST REPORT'S DAYS AND WORDS (#11009): the days each period covers,
 * worked out in the time zone of whoever set the report up, the period it
 * is compared with, the addresses it may go to, and what the email and the
 * chat message say - in English, and in a reader's own language.
 */

function days(window: CloudCostAllocationWindow): string {
  const text: { start: string; lastDay: string } = toCloudCostReportDays(window);
  return `${text.start}..${text.lastDay}`;
}

function windowAt(
  period: CloudCostReportPeriod,
  at: string,
  timezone?: string,
): string {
  return days(getCloudCostReportWindow({ period, at: new Date(at), timezone }));
}

const ENGLISH: Translator = createTranslator(undefined, "en");

// A German reader whose locale has every one of the report's sentences.
const GERMAN_WORDS: Record<string, string> = {
  "What every account cost from {{start}} to {{end}}.":
    "Was alle Konten von {{start}} bis {{end}} gekostet haben.",
  "What {{name}} cost from {{start}} to {{end}}.":
    "Was {{name}} von {{start}} bis {{end}} gekostet hat.",
  Total: "Gesamt",
  "{{percent}} more than {{previous}}": "{{percent}} mehr als {{previous}}",
  "{{percent}} less than {{previous}}": "{{percent}} weniger als {{previous}}",
  "the week before": "in der Woche davor",
  "By cost group": "Nach Kostengruppe",
  Unallocated: "Nicht zugeordnet",
  "Open Costs": "Kosten öffnen",
};
const GERMAN: Translator = createTranslator((text: string) => {
  return GERMAN_WORDS[text];
}, "de");

function content(
  overrides: Partial<CloudCostReportContent> = {},
): CloudCostReportContent {
  return {
    reportId: "r-1",
    reportName: "Weekly cloud costs",
    projectName: "Acme",
    scope: CloudCostReportScope.AllAccounts,
    period: CloudCostReportPeriod.LastWeek,
    start: "2026-11-16",
    lastDay: "2026-11-22",
    previousStart: "2026-11-09",
    previousLastDay: "2026-11-15",
    currency: "USD",
    basis: "amortized",
    section: {
      kind: "summary",
      name: "",
      total: 1200,
      previousTotal: 1000,
      rises: [
        {
          key: "Amazon EC2",
          name: "Amazon EC2",
          amount: 700,
          previousAmount: 500,
        },
      ],
      falls: [
        {
          key: "Amazon S3",
          name: "Amazon S3",
          amount: 50,
          previousAmount: 80,
        },
      ],
      budgets: [
        {
          name: "Production",
          amount: 5000,
          spent: 2500,
          month: "2026-11",
          basis: "amortized",
        },
      ],
      unusualDays: [
        {
          day: "2026-11-18",
          accountName: "Production AWS",
          service: "Amazon EC2",
          amount: 300,
          usual: 100,
        },
      ],
      savings: {
        count: 3,
        monthlySavings: 420,
        top: [
          {
            action: "Stop the idle instance",
            resourceName: "batch-1",
            accountName: "Production AWS",
            monthlySavings: 69,
          },
        ],
      },
      commitments: { coveredPercent: 64, usedPercent: 97, hasCommitments: true },
    },
    otherCurrencies: [],
    costsUrl:
      "https://oneuptime.example/dashboard/p/cloud/costs?start=2026-11-16&end=2026-11-22&basis=amortized",
    csv: "",
    csvFileName: "cloud-costs.csv",
    readAt: "2026-11-23T08:00:00.000Z",
    ...overrides,
  };
}

describe("the days a report covers", () => {
  test("last week is Monday to Sunday of the week before the one it is sent in", () => {
    // Monday 23 November, 09:00 in Berlin.
    expect(
      windowAt(
        CloudCostReportPeriod.LastWeek,
        "2026-11-23T08:00:00Z",
        "Europe/Berlin",
      ),
    ).toBe("2026-11-16..2026-11-22");
    // Sent on a Sunday, the week before is still the last whole one.
    expect(
      windowAt(CloudCostReportPeriod.LastWeek, "2026-11-29T12:00:00Z", "UTC"),
    ).toBe("2026-11-16..2026-11-22");
  });

  test("the week is the sender's: a Monday morning in Tokyo is still Sunday in UTC", () => {
    // 08:30 on Monday 23 November in Tokyo: 23:30 on Sunday in UTC.
    expect(
      windowAt(
        CloudCostReportPeriod.LastWeek,
        "2026-11-22T23:30:00Z",
        "Asia/Tokyo",
      ),
    ).toBe("2026-11-16..2026-11-22");
    expect(
      windowAt(CloudCostReportPeriod.LastWeek, "2026-11-22T23:30:00Z", "UTC"),
    ).toBe("2026-11-09..2026-11-15");
    // Sunday evening in Los Angeles is Monday in UTC.
    expect(
      windowAt(
        CloudCostReportPeriod.LastWeek,
        "2026-11-23T05:00:00Z",
        "America/Los_Angeles",
      ),
    ).toBe("2026-11-09..2026-11-15");
  });

  test("last month is the calendar month before, in the sender's time zone", () => {
    expect(
      windowAt(
        CloudCostReportPeriod.LastMonth,
        "2026-12-01T08:00:00Z",
        "Europe/Berlin",
      ),
    ).toBe("2026-11-01..2026-11-30");
    // Ten at night on 30 November in New York is 1 December in UTC.
    expect(
      windowAt(
        CloudCostReportPeriod.LastMonth,
        "2026-12-01T03:00:00Z",
        "America/New_York",
      ),
    ).toBe("2026-10-01..2026-10-31");
    // January's last month is the year before's December.
    expect(
      windowAt(CloudCostReportPeriod.LastMonth, "2027-01-04T09:00:00Z", "UTC"),
    ).toBe("2026-12-01..2026-12-31");
    // A leap year's February.
    expect(
      windowAt(CloudCostReportPeriod.LastMonth, "2028-03-01T09:00:00Z", "UTC"),
    ).toBe("2028-02-01..2028-02-29");
  });

  test("month to date is the 1st to the day it is sent", () => {
    expect(
      windowAt(
        CloudCostReportPeriod.MonthToDate,
        "2026-11-15T10:00:00Z",
        "UTC",
      ),
    ).toBe("2026-11-01..2026-11-15");
    expect(
      windowAt(
        CloudCostReportPeriod.MonthToDate,
        "2026-11-01T01:00:00Z",
        "America/Los_Angeles",
      ),
    ).toBe("2026-10-01..2026-10-31");
  });

  test("a time zone OneUptime does not know is UTC", () => {
    expect(
      getCloudCostReportLocalDay({
        at: new Date("2026-11-22T23:30:00Z"),
        timezone: "Mars/Olympus_Mons",
      }),
    ).toBe("2026-11-22");
    expect(
      getCloudCostReportLocalDay({ at: new Date("2026-11-22T23:30:00Z") }),
    ).toBe("2026-11-22");
  });

  test("each period is compared with the one before: the week before, the month before, last month by the same day", () => {
    const week: CloudCostAllocationWindow = getCloudCostReportWindow({
      period: CloudCostReportPeriod.LastWeek,
      at: new Date("2026-11-23T08:00:00Z"),
      timezone: "UTC",
    });
    const month: CloudCostAllocationWindow = getCloudCostReportWindow({
      period: CloudCostReportPeriod.LastMonth,
      at: new Date("2026-12-01T08:00:00Z"),
      timezone: "UTC",
    });
    const toDate: CloudCostAllocationWindow = getCloudCostReportWindow({
      period: CloudCostReportPeriod.MonthToDate,
      at: new Date("2026-11-15T08:00:00Z"),
      timezone: "UTC",
    });

    expect(days(getCloudCostReportPreviousWindow(week))).toBe(
      "2026-11-09..2026-11-15",
    );
    expect(days(getCloudCostReportPreviousWindow(month))).toBe(
      "2026-10-01..2026-10-31",
    );
    expect(days(getCloudCostReportPreviousWindow(toDate))).toBe(
      "2026-10-01..2026-10-15",
    );
  });
});

describe("the addresses a report goes to", () => {
  test("any list of addresses, by comma, semicolon, space or line, each once, in lower case", () => {
    expect(
      readCloudCostReportEmailAddresses(
        "Finance@Example.com, accountant@example.org;\nfinance@example.com  cfo@example.co.uk",
      ),
    ).toEqual([
      "finance@example.com",
      "accountant@example.org",
      "cfo@example.co.uk",
    ]);
    expect(
      readCloudCostReportEmailAddresses(["a@example.com", " ", "b@example.com"]),
    ).toEqual(["a@example.com", "b@example.com"]);
    expect(readCloudCostReportEmailAddresses(null)).toEqual([]);
    expect(readCloudCostReportEmailAddresses("")).toEqual([]);
  });

  test("anything that is not an address is refused, saying which", () => {
    expect(() => {
      readCloudCostReportEmailAddresses("finance@example.com, not-an-address");
    }).toThrow('"not-an-address" is not an email address.');
    expect(() => {
      readCloudCostReportEmailAddresses(["Finance <finance@example.com>"]);
    }).toThrow("is not an email address");
    expect(toCloudCostReportEmailAddress("a@b")).toBeNull();
    expect(toCloudCostReportEmailAddress(`${"a".repeat(250)}@example.com`)).toBeNull();
    expect(toCloudCostReportEmailAddress(42)).toBeNull();
  });

  test("a report goes to at most 25 addresses", () => {
    const addresses: Array<string> = [];

    for (let index: number = 0; index <= CLOUD_COST_REPORT_MAX_EMAIL_ADDRESSES; index++) {
      addresses.push(`person${index}@example.com`);
    }

    expect(
      readCloudCostReportEmailAddresses(addresses.slice(0, 25)),
    ).toHaveLength(25);
    expect(() => {
      readCloudCostReportEmailAddresses(addresses);
    }).toThrow("A report goes to at most 25 addresses.");
  });
});

describe("what a report's choices are called", () => {
  test("every scope, period and reason a send leaves someone out has its words", () => {
    for (const scope of Object.values(CloudCostReportScope)) {
      expect(isCloudCostReportScope(scope)).toBe(true);
      expect(CLOUD_COST_REPORT_SCOPE_LABELS[scope]).toBeTruthy();
    }

    for (const period of Object.values(CloudCostReportPeriod)) {
      expect(isCloudCostReportPeriod(period)).toBe(true);
      expect(CLOUD_COST_REPORT_PERIOD_LABELS[period]).toBeTruthy();
      expect(CLOUD_COST_REPORT_PREVIOUS_LABELS[period]).toBeTruthy();
    }

    for (const reason of Object.values(CloudCostReportSkipReason)) {
      expect(isCloudCostReportSkipReason(reason)).toBe(true);
      expect(CLOUD_COST_REPORT_SKIP_REASON_LABELS[reason]).toMatch(
        /^Not (sent|posted)/,
      );
    }

    expect(isCloudCostReportScope("Everything")).toBe(false);
    expect(isCloudCostReportPeriod("LastYear")).toBe(false);
    expect(isCloudCostReportSkipReason(undefined)).toBe(false);
  });
});

describe("a report's figures in the reader's language", () => {
  test("money in the report's currency, whole from a thousand up", () => {
    expect(
      formatCloudCostMoney({ amount: 1234.56, currency: "usd", language: "en" }),
    ).toBe("$1,235");
    expect(
      formatCloudCostMoney({ amount: 12.5, currency: "USD", language: "en" }),
    ).toBe("$12.50");
    expect(
      formatCloudCostMoney({ amount: 1234.56, currency: "EUR", language: "de" }),
    ).toBe("1.235 €");
    expect(
      formatCloudCostMoney({
        amount: 12,
        currency: "USD",
        language: "en",
        whole: true,
      }),
    ).toBe("$12");
    // A code Intl does not know is still written.
    expect(
      formatCloudCostMoney({ amount: 5, currency: "ZZZZ", language: "en" }),
    ).toBe("ZZZZ 5.00");
  });

  test("a week as one range, a month by its name", () => {
    expect(
      formatCloudCostDays({
        start: "2026-11-16",
        lastDay: "2026-11-22",
        language: "en",
      }),
      // Intl's own range: thin spaces about the dash.
    ).toMatch(/^Nov 16\s–\s22, 2026$/);
    expect(
      formatCloudCostDays({ start: "2026-11-16", language: "en" }),
    ).toBe("Nov 16, 2026");
    expect(formatCloudCostMonth({ month: "2026-11", language: "en" })).toBe(
      "November 2026",
    );
    expect(formatCloudCostMonth({ month: "2026-11", language: "de" })).toBe(
      "November 2026",
    );
  });

  test("a change: up, down, the same, or nothing to compare with", () => {
    expect(
      getCloudCostReportChange({
        current: 1200,
        previous: 1000,
        previousLabel: "the week before",
        translator: ENGLISH,
      }),
    ).toEqual({ text: "20% more than the week before", tone: "up" });
    expect(
      getCloudCostReportChange({
        current: 800,
        previous: 1000,
        previousLabel: "the week before",
        translator: ENGLISH,
      }),
    ).toEqual({ text: "20% less than the week before", tone: "down" });
    expect(
      getCloudCostReportChange({
        current: 1001,
        previous: 1000,
        previousLabel: "the week before",
        translator: ENGLISH,
      }),
    ).toEqual({ text: "The same as the week before", tone: "flat" });
    expect(
      getCloudCostReportChange({
        current: 10,
        previous: 0,
        previousLabel: "the week before",
        translator: ENGLISH,
      }),
    ).toBeNull();
  });
});

describe("the report as written", () => {
  test("in English: the total against the week before, its budget, savings and commitments, then each list", () => {
    const text: CloudCostReportText = writeCloudCostReport({
      content: content(),
      translator: ENGLISH,
    });

    expect(text.subject).toMatch(/^Weekly cloud costs: Nov 16\s–\s22, 2026$/);
    expect(text.lead).toBe(
      "What every account cost from Nov 16, 2026 to Nov 22, 2026.",
    );
    expect(text.total).toBe("$1,200");
    expect(text.change).toBe("20% more than the week before");
    expect(text.changeTone).toBe("up");
    expect(text.previous).toBe("It was $1,000 the week before.");
    expect(text.stats.map((stat: { label: string }) => stat.label)).toEqual([
      "Budget",
      "Savings waiting",
      "Commitments cover",
    ]);
    expect(text.stats[0]!.value).toBe("50%");
    expect(text.stats[0]!.hint).toBe("$2,500 of $5,000 in November 2026");
    expect(text.stats[1]!.value).toBe("$420.00 a month");
    expect(text.stats[2]!.value).toBe("64%");
    expect(text.stats[2]!.hint).toBe("97% of them used");
    expect(
      text.sections.map((section: { title: string }) => section.title),
    ).toEqual([
      "Rose the most",
      "Fell the most",
      "Unusual days",
      "Largest savings waiting",
    ]);
    expect(text.sections[0]!.rows[0]).toEqual({
      name: "Amazon EC2",
      value: "$700.00",
      hint: "+$200.00",
      tone: "up",
    });
    expect(text.sections[1]!.rows[0]!.hint).toBe("−$30.00");
    expect(text.sections[2]!.rows[0]).toMatchObject({
      name: "Nov 18, 2026 · Amazon EC2",
      value: "$300.00, usually $100.00",
      hint: "Production AWS",
    });
    // The basis it is on, always said.
    expect(text.notes).toEqual([
      "Cost basis: Amortized. Currency: USD. A cloud reports the last day or two late, and in part.",
    ]);
    expect(text.buttonText).toBe("Open Costs");
    expect(text.costsUrl).toContain("basis=amortized");
    expect(text.shortText).toMatch(
      /^Weekly cloud costs: \$1,200, Nov 16\s–\s22, 2026 \(20% more than the week before\)$/,
    );
    expect(text.chatLines.slice(0, 2)).toEqual([
      "**What every account cost from Nov 16, 2026 to Nov 22, 2026.**",
      "Total: **$1,200** (20% more than the week before)",
    ]);
  });

  test("a cost view's report lists its groups and what no group takes first", () => {
    const text: CloudCostReportText = writeCloudCostReport({
      content: content({
        scope: CloudCostReportScope.CostView,
        section: {
          ...content().section,
          name: "By team",
          groups: [
            { key: "g-pay", name: "Payments", amount: 420, previousAmount: 210 },
            { key: "g-data", name: "Data", amount: 150, previousAmount: 150 },
          ],
          unallocated: { amount: 750, previousAmount: 800 },
        },
      }),
      translator: ENGLISH,
    });

    expect(text.lead).toBe(
      "What By team cost from Nov 16, 2026 to Nov 22, 2026.",
    );
    expect(text.sections[0]!.title).toBe("By cost group");
    expect(
      text.sections[0]!.rows.map((row: { name: string; tone?: string }) => {
        return [row.name, row.tone];
      }),
    ).toEqual([
      ["Payments", "up"],
      ["Data", "flat"],
      ["Unallocated", "down"],
    ]);
  });

  test("a period that cost nothing says so, and accounts in another currency are named", () => {
    const text: CloudCostReportText = writeCloudCostReport({
      content: content({
        section: {
          ...content().section,
          total: 0,
          previousTotal: 0,
          rises: [],
          falls: [],
          budgets: [],
          unusualDays: [],
          savings: undefined,
          commitments: undefined,
        },
        otherCurrencies: [{ name: "Shop EU", currency: "EUR" }],
      }),
      translator: ENGLISH,
    });

    expect(text.change).toBeNull();
    expect(text.stats).toEqual([]);
    expect(text.sections).toEqual([]);
    expect(text.notes).toEqual([
      "Nothing cost anything in this period.",
      "Cost basis: Amortized. Currency: USD. A cloud reports the last day or two late, and in part.",
      "Left out, as billed in another currency: Shop EU (EUR).",
    ]);
  });

  test("in German: the reader's sentences, figures and dates; names as written", () => {
    const text: CloudCostReportText = writeCloudCostReport({
      content: content({
        scope: CloudCostReportScope.CostView,
        section: {
          ...content().section,
          name: "By team",
          groups: [
            { key: "g-pay", name: "Payments", amount: 420, previousAmount: 210 },
          ],
          unallocated: { amount: 750, previousAmount: 800 },
        },
      }),
      translator: GERMAN,
    });

    expect(text.lead).toBe(
      "Was By team von 16. Nov. 2026 bis 22. Nov. 2026 gekostet hat.",
    );
    expect(text.total).toBe("1.200 $");
    expect(text.change).toBe("20 % mehr als in der Woche davor");
    expect(text.totalLabel).toBe("Gesamt");
    expect(text.sections[0]!.title).toBe("Nach Kostengruppe");
    expect(text.sections[0]!.rows[0]!.name).toBe("Payments");
    expect(text.sections[0]!.rows[1]!.name).toBe("Nicht zugeordnet");
    expect(text.buttonText).toBe("Kosten öffnen");
    // A sentence the locale lacks reads whole in English, never half and half.
    expect(text.sections[1]!.title).toBe("Rose the most");
  });
});
