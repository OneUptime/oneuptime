import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import AlertStateTimeline from "../../../../Models/DatabaseModels/AlertStateTimeline";
import CloudAccount from "../../../../Models/DatabaseModels/CloudAccount";
import CloudBudget from "../../../../Models/DatabaseModels/CloudBudget";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import AlertService from "../../../../Server/Services/AlertService";
import AlertSeverityService from "../../../../Server/Services/AlertSeverityService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import AlertStateTimelineService from "../../../../Server/Services/AlertStateTimelineService";
import CloudAccountService from "../../../../Server/Services/CloudAccountService";
import CloudBudgetService from "../../../../Server/Services/CloudBudgetService";
import CloudBudgetEvaluator, {
  CloudBudgetAlertState,
  CloudBudgetAnomalyDay,
  CloudBudgetDecision,
  CloudBudgetSpend,
  formatCloudBudgetAlertDay,
  formatCloudBudgetAmount,
  getCloudBudgetAnomalyKey,
  getCloudBudgetOldestAnomalyDay,
  readCloudBudgetAlertState,
} from "../../../../Server/Utils/CloudConnection/CloudBudgetEvaluator";
import {
  CloudAccountCostSummary,
  CloudCostAnomaly,
  CloudCostState,
} from "../../../../Types/Cloud/CloudCost";
import OneUptimeDate from "../../../../Types/Date";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A cloud budget, checked against what its accounts cost: the spend it
 * counts (this month's, in its currency), the alerts it raises - the
 * highest threshold passed for the first time this month, and once a month
 * the warning that the month is on course to pass it - never twice, and
 * last month's resolved when a new month starts. Then the whole check with
 * the services stood in: the alert it creates, and what it writes back.
 */

const NOW: Date = new Date("2026-11-20T12:00:00.000Z");
const PROJECT: ObjectID = new ObjectID("10000000-0000-4000-8000-0000000000a1");
const BUDGET_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-0000000000f1",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-0000000000e1",
);
const POLICY_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-0000000000d1",
);
const OLD_ALERT: string = "10000000-0000-4000-8000-0000000000c9";

function summary(
  overrides: Partial<CloudAccountCostSummary>,
): CloudAccountCostSummary {
  return {
    state: CloudCostState.Reading,
    currency: "USD",
    monthToDate: 0,
    lastMonth: 0,
    monthFullDays: 0,
    lastMonthToDate: 0,
    projectedMonth: 0,
    last30Days: 0,
    topServices: [],
    readAt: "2026-11-20T06:00:00.000Z",
    ...overrides,
  };
}

function spend(overrides: Partial<CloudBudgetSpend>): CloudBudgetSpend {
  return {
    spent: 0,
    projected: 0,
    topServices: [],
    accountsCounted: 1,
    accountsInOtherCurrencies: 0,
    ...overrides,
  };
}

describe("what a budget counts", () => {
  test("this month's spend and projection of the accounts read, in its currency", () => {
    expect(
      CloudBudgetEvaluator.computeSpend({
        currency: "usd",
        summaries: [
          summary({ monthToDate: 400.111, projectedMonth: 620 }),
          summary({ monthToDate: 100, projectedMonth: 150 }),
          // Read last month: nothing is known of this month.
          summary({ monthToDate: 999, readAt: "2026-10-31T23:00:00.000Z" }),
          // Could not be read.
          summary({ state: CloudCostState.NotAllowed, monthToDate: 50 }),
          summary({ currency: "EUR", monthToDate: 77 }),
          null,
        ],
        now: NOW,
      }),
    ).toEqual({
      spent: 500.11,
      projected: 770,
      accountsCounted: 2,
      accountsInOtherCurrencies: 1,
      topServices: [],
    });
  });

  test("where the money went: the counted accounts' services summed by name, the costliest three first", () => {
    const counted: CloudBudgetSpend = CloudBudgetEvaluator.computeSpend({
      currency: "USD",
      summaries: [
        summary({
          monthToDate: 700,
          topServices: [
            { service: "Amazon EC2", amount: 300.004 },
            { service: "Amazon S3", amount: 120 },
            { service: "AWS Lambda", amount: 20 },
          ],
        }),
        summary({
          monthToDate: 300,
          topServices: [
            { service: "Amazon EC2", amount: 100 },
            { service: "Amazon RDS", amount: 150 },
            // Nothing spent on it: never named.
            { service: "Amazon SQS", amount: 0 },
          ],
        }),
        // Another currency, and last month's read: not counted, nor their services.
        summary({
          currency: "EUR",
          topServices: [{ service: "Virtual Machines", amount: 9000 }],
        }),
        summary({
          readAt: "2026-10-31T23:00:00.000Z",
          topServices: [{ service: "Compute Engine", amount: 9000 }],
        }),
      ],
      now: NOW,
    });

    expect(counted.topServices).toEqual([
      { service: "Amazon EC2", amount: 400 },
      { service: "Amazon RDS", amount: 150 },
      { service: "Amazon S3", amount: 120 },
    ]);
  });
});

describe("what a budget does", () => {
  test("the highest threshold passed for the first time this month, once", () => {
    const first: CloudBudgetDecision = CloudBudgetEvaluator.decide({
      amount: 1000,
      thresholds: [50, 80, 100],
      alertOnProjection: false,
      spend: spend({ spent: 850, projected: 990 }),
      state: null,
      now: NOW,
    });

    expect(first.raise).toEqual([{ kind: "threshold", threshold: 80 }]);
    expect(first.state).toEqual({
      month: "2026-11",
      thresholds: [50, 80],
      projection: false,
      anomalies: [],
      alertIds: [],
    });

    // Checked again: nothing new.
    expect(
      CloudBudgetEvaluator.decide({
        amount: 1000,
        thresholds: [50, 80, 100],
        alertOnProjection: false,
        spend: spend({ spent: 870, projected: 990 }),
        state: first.state,
        now: NOW,
      }).raise,
    ).toEqual([]);

    // Over the budget: the next one.
    expect(
      CloudBudgetEvaluator.decide({
        amount: 1000,
        thresholds: [50, 80, 100],
        alertOnProjection: false,
        spend: spend({ spent: 1010, projected: 1300 }),
        state: first.state,
        now: NOW,
      }).raise,
    ).toEqual([{ kind: "threshold", threshold: 100 }]);
  });

  test("warns once a month when the month is on course to pass, before it has", () => {
    const warned: CloudBudgetDecision = CloudBudgetEvaluator.decide({
      amount: 1000,
      thresholds: [80, 100],
      alertOnProjection: true,
      spend: spend({ spent: 600, projected: 1050 }),
      state: null,
      now: NOW,
    });

    expect(warned.raise).toEqual([{ kind: "projection" }]);
    expect(warned.state.projection).toBe(true);
    expect(
      CloudBudgetEvaluator.decide({
        amount: 1000,
        thresholds: [80, 100],
        alertOnProjection: true,
        spend: spend({ spent: 650, projected: 1100 }),
        state: warned.state,
        now: NOW,
      }).raise,
    ).toEqual([]);

    // Not asked for, or past the budget already: no warning.
    expect(
      CloudBudgetEvaluator.decide({
        amount: 1000,
        thresholds: [80, 100],
        alertOnProjection: false,
        spend: spend({ spent: 600, projected: 1050 }),
        state: null,
        now: NOW,
      }).raise,
    ).toEqual([]);
    expect(
      CloudBudgetEvaluator.decide({
        amount: 1000,
        thresholds: [],
        alertOnProjection: true,
        spend: spend({ spent: 1001, projected: 1500 }),
        state: null,
        now: NOW,
      }).raise,
    ).toEqual([]);
  });

  test("a new month starts from nothing, and last month's alerts are resolved", () => {
    const decision: CloudBudgetDecision = CloudBudgetEvaluator.decide({
      amount: 1000,
      thresholds: [80, 100],
      alertOnProjection: true,
      spend: spend({ spent: 50, projected: 600 }),
      state: {
        month: "2026-10",
        thresholds: [80, 100],
        projection: true,
        anomalies: ["acc|2026-10-30"],
        alertIds: [OLD_ALERT],
      },
      now: NOW,
    });

    expect(decision.resolveAlertIds).toEqual([OLD_ALERT]);
    expect(decision.state).toEqual({
      month: "2026-11",
      thresholds: [],
      projection: false,
      anomalies: [],
      alertIds: [],
    });
    expect(decision.raise).toEqual([]);
  });

  test("nothing read this month is nothing known spent: no alert", () => {
    expect(
      CloudBudgetEvaluator.decide({
        amount: 10,
        thresholds: [80],
        alertOnProjection: true,
        spend: spend({ accountsCounted: 0, spent: 0, projected: 0 }),
        state: null,
        now: NOW,
      }).raise,
    ).toEqual([]);
  });

  test("an alert is kept apart by its budget, month and threshold", () => {
    expect(
      CloudBudgetEvaluator.getFingerprint({
        budgetId: "b1",
        month: "2026-11",
        alert: { kind: "threshold", threshold: 80 },
      }),
    ).toBe("cloud-budget:b1:2026-11:threshold-80");
    expect(
      CloudBudgetEvaluator.getFingerprint({
        budgetId: "b1",
        month: "2026-11",
        alert: { kind: "projection" },
      }),
    ).toBe("cloud-budget:b1:2026-11:projection");
  });

  test("says what was spent, of what, and where the month is heading", () => {
    const threshold: {
      title: string;
      description: string;
      rootCause?: string | undefined;
    } = CloudBudgetEvaluator.describe({
      budgetName: "Production",
      scope: "every cloud account of the project",
      amount: 1000,
      currency: "USD",
      spend: spend({ spent: 812.5, projected: 1240 }),
      alert: { kind: "threshold", threshold: 80 },
      now: NOW,
    });

    expect(threshold.title).toBe('Cloud budget "Production" passed 80%');
    expect(threshold.description).toBe(
      "This month's cloud spend for every cloud account of the project is $812.50 of the $1,000.00 budget (81%), with 10 days of the month to go. At the pace of the last full week, the month is on course for $1,240.00.",
    );

    const projection: {
      title: string;
      description: string;
      rootCause?: string | undefined;
    } = CloudBudgetEvaluator.describe({
      budgetName: "Production",
      scope: "the web account (AWS 123456789012)",
      amount: 1000,
      currency: "EUR",
      spend: spend({ spent: 600, projected: 1100 }),
      alert: { kind: "projection" },
      now: new Date("2026-11-29T12:00:00.000Z"),
    });

    expect(projection.title).toBe(
      'Cloud budget "Production" is on course to be passed',
    );
    expect(projection.description).toContain("on course for €1,100.00");
    expect(projection.description).toContain("with 1 day to go");

    // No service named: no root cause, never the description again.
    expect(threshold.rootCause).toBeUndefined();
    expect(projection.rootCause).toBeUndefined();
  });

  test("its root cause is where the money went: the services that cost the most this month", () => {
    const words: { rootCause?: string | undefined; description: string } =
      CloudBudgetEvaluator.describe({
        budgetName: "Production",
        scope: "every cloud account of the project",
        amount: 1000,
        currency: "USD",
        spend: spend({
          spent: 812.5,
          projected: 1240,
          topServices: [
            { service: "Amazon EC2", amount: 437.87 },
            { service: "Amazon S3", amount: 272.74 },
            { service: "AWS Lambda", amount: 34.84 },
          ],
        }),
        alert: { kind: "threshold", threshold: 80 },
        now: NOW,
      });

    expect(words.rootCause).toBe(
      "What cost the most this month: Amazon EC2 ($437.87), Amazon S3 ($272.74) and AWS Lambda ($34.84).",
    );
    expect(words.rootCause).not.toBe(words.description);

    expect(
      CloudBudgetEvaluator.describeTopServices(
        [{ service: "Virtual Machines", amount: 80 }],
        "EUR",
      ),
    ).toBe("What cost the most this month: Virtual Machines (€80.00).");
    expect(
      CloudBudgetEvaluator.describeTopServices(
        [
          { service: "Compute Engine", amount: 12 },
          { service: "BigQuery", amount: 3.5 },
        ],
        "USD",
      ),
    ).toBe(
      "What cost the most this month: Compute Engine ($12.00) and BigQuery ($3.50).",
    );
    expect(CloudBudgetEvaluator.describeTopServices([], "USD")).toBeUndefined();
  });

  test("a stored state and an amount read back and written as alerts say them", () => {
    expect(readCloudBudgetAlertState(null)).toBeNull();
    expect(readCloudBudgetAlertState({ month: "" })).toBeNull();
    expect(
      readCloudBudgetAlertState({
        month: "2026-11",
        thresholds: [80, "100", "x"],
        projection: "yes",
        alertIds: [OLD_ALERT, "not-an-id", 3],
      }),
    ).toEqual({
      month: "2026-11",
      thresholds: [80, 100],
      projection: false,
      // A state stored before unusual days had none.
      anomalies: [],
      alertIds: [OLD_ALERT],
    });
    expect(
      readCloudBudgetAlertState({
        month: "2026-11",
        anomalies: ["acc|2026-11-19", "", 4],
      })?.anomalies,
    ).toEqual(["acc|2026-11-19"]);
    expect(formatCloudBudgetAmount(1234.5, "USD")).toBe("$1,234.50");
    expect(formatCloudBudgetAmount(10, "NOT A CODE")).toBe("NOT A CODE 10.00");
  });
});

/*
 * A day that cost far more than usual: an alert of its own, the day after,
 * once for each account and day, naming every service that ran high - unless
 * the budget is told not to.
 */
describe("an unusual day", () => {
  const ACCOUNT_ROW: string = "10000000-0000-4000-8000-0000000000b1";
  const SCOPE: string = "the web-prod account (AWS 123456789012)";

  const lambda: CloudCostAnomaly = {
    day: "2026-11-19",
    service: "AWS Lambda",
    amount: 412,
    usual: 180,
  };
  const whole: CloudCostAnomaly = {
    day: "2026-11-19",
    service: "",
    amount: 2400,
    usual: 1500,
  };

  function anomalyDay(
    anomalies: Array<CloudCostAnomaly> = [lambda],
  ): CloudBudgetAnomalyDay {
    return {
      accountRowId: ACCOUNT_ROW,
      accountScope: SCOPE,
      day: "2026-11-19",
      anomalies,
    };
  }

  test("an account's unusual day alerts once, whatever reads come after it", () => {
    const first: CloudBudgetDecision = CloudBudgetEvaluator.decide({
      amount: 10000,
      thresholds: [80, 100],
      alertOnProjection: true,
      anomalyDays: [anomalyDay()],
      spend: spend({ spent: 100, projected: 900 }),
      state: null,
      now: NOW,
    });

    expect(first.raise).toEqual([
      { kind: "anomaly", anomalyDay: anomalyDay() },
    ]);
    expect(first.state.anomalies).toEqual([`${ACCOUNT_ROW}|2026-11-19`]);
    expect(
      getCloudBudgetAnomalyKey({
        accountRowId: ACCOUNT_ROW,
        day: "2026-11-19",
      }),
    ).toBe(`${ACCOUNT_ROW}|2026-11-19`);

    // The next read finds the same day: nothing new.
    expect(
      CloudBudgetEvaluator.decide({
        amount: 10000,
        thresholds: [80, 100],
        alertOnProjection: true,
        anomalyDays: [anomalyDay([lambda, whole])],
        spend: spend({ spent: 100, projected: 900 }),
        state: first.state,
        now: NOW,
      }).raise,
    ).toEqual([]);

    // The next day's is new.
    expect(
      CloudBudgetEvaluator.decide({
        amount: 10000,
        thresholds: [80, 100],
        alertOnProjection: true,
        anomalyDays: [{ ...anomalyDay(), day: "2026-11-20" }],
        spend: spend({ spent: 100, projected: 900 }),
        state: first.state,
        now: NOW,
      }).raise,
    ).toHaveLength(1);
  });

  test("a budget told not to alerts on none, and keeps no day", () => {
    const decision: CloudBudgetDecision = CloudBudgetEvaluator.decide({
      amount: 10000,
      thresholds: [80, 100],
      alertOnProjection: true,
      alertOnAnomaly: false,
      anomalyDays: [anomalyDay()],
      spend: spend({ spent: 100, projected: 900 }),
      state: null,
      now: NOW,
    });
    expect(decision.raise).toEqual([]);
    expect(decision.state.anomalies).toEqual([]);
  });

  test("a budget's accounts' days: counted ones only, each day of the last week once, a spike told the day it began", () => {
    const days: Array<CloudBudgetAnomalyDay> =
      CloudBudgetEvaluator.getAnomalyDays({
        currency: "usd",
        accounts: [
          {
            id: ACCOUNT_ROW,
            scope: SCOPE,
            summary: summary({
              latestDay: "2026-11-20",
              anomalies: [whole, lambda],
            }),
          },
          // Billed in another currency.
          {
            id: "b",
            scope: "b",
            summary: summary({
              currency: "EUR",
              latestDay: "2026-11-20",
              anomalies: [lambda],
            }),
          },
          // Read last month.
          {
            id: "c",
            scope: "c",
            summary: summary({
              readAt: "2026-10-31T23:00:00.000Z",
              latestDay: "2026-11-20",
              anomalies: [lambda],
            }),
          },
          // Could not be read.
          {
            id: "d",
            scope: "d",
            summary: summary({
              state: CloudCostState.NotAllowed,
              latestDay: "2026-11-20",
              anomalies: [lambda],
            }),
          },
          /*
           * A spike that went on for three days, and a service that began
           * on its third: told on the day each began.
           */
          {
            id: "e",
            scope: "e",
            summary: summary({
              latestDay: "2026-11-20",
              anomalies: [
                lambda,
                { ...lambda, service: "AWS Glue", amount: 60, usual: 0 },
                { ...lambda, day: "2026-11-18" },
                { ...lambda, day: "2026-11-17" },
              ],
            }),
          },
          // Nothing unusual.
          {
            id: "f",
            scope: "f",
            summary: summary({ latestDay: "2026-11-20" }),
          },
          { id: "g", scope: "g", summary: null },
          // Read late: its newest full day is more than a week old.
          {
            id: "h",
            scope: "h",
            summary: summary({
              latestDay: "2026-11-13",
              anomalies: [{ ...lambda, day: "2026-11-12" }],
            }),
          },
          // A week old to the day: still told.
          {
            id: "i",
            scope: "i",
            summary: summary({
              latestDay: "2026-11-14",
              anomalies: [{ ...lambda, day: "2026-11-13" }],
            }),
          },
        ],
        now: NOW,
      });

    expect(days).toEqual([
      {
        accountRowId: ACCOUNT_ROW,
        accountScope: SCOPE,
        day: "2026-11-19",
        anomalies: [whole, lambda],
      },
      {
        accountRowId: "e",
        accountScope: "e",
        day: "2026-11-19",
        anomalies: [{ ...lambda, service: "AWS Glue", amount: 60, usual: 0 }],
      },
      {
        accountRowId: "e",
        accountScope: "e",
        day: "2026-11-17",
        anomalies: [{ ...lambda, day: "2026-11-17" }],
      },
      {
        accountRowId: "i",
        accountScope: "i",
        day: "2026-11-13",
        anomalies: [{ ...lambda, day: "2026-11-13" }],
      },
    ]);
    expect(getCloudBudgetOldestAnomalyDay(NOW)).toBe("2026-11-13");
  });

  test("a month's last day is judged on the next month's first, and alerts once across the two", () => {
    const FIRST: Date = new Date("2026-12-01T09:00:00.000Z");
    const lastDay: CloudBudgetAnomalyDay = {
      ...anomalyDay(),
      day: "2026-11-30",
    };

    // November's last check alerted on its last day but one.
    const november: CloudBudgetAlertState = {
      month: "2026-11",
      thresholds: [80],
      projection: true,
      anomalies: [
        `${ACCOUNT_ROW}|2026-11-02`,
        `${ACCOUNT_ROW}|2026-11-29`,
        `${ACCOUNT_ROW}|2026-11-30`,
      ],
      alertIds: [OLD_ALERT],
    };

    const decision: CloudBudgetDecision = CloudBudgetEvaluator.decide({
      amount: 10000,
      thresholds: [80, 100],
      alertOnProjection: true,
      anomalyDays: [lastDay],
      spend: spend({ spent: 10, projected: 300 }),
      state: november,
      now: FIRST,
    });

    // November's 30th was told in November: not again in December.
    expect(decision.raise).toEqual([]);
    expect(decision.resolveAlertIds).toEqual([OLD_ALERT]);
    // Only the days that can still be read again are kept.
    expect(decision.state).toEqual({
      month: "2026-12",
      thresholds: [],
      projection: false,
      anomalies: [`${ACCOUNT_ROW}|2026-11-29`, `${ACCOUNT_ROW}|2026-11-30`],
      alertIds: [],
    });

    // Judged first on December's first, it is told then.
    expect(
      CloudBudgetEvaluator.decide({
        amount: 10000,
        thresholds: [80, 100],
        alertOnProjection: true,
        anomalyDays: [lastDay],
        spend: spend({ spent: 10, projected: 300 }),
        state: { ...november, anomalies: [] },
        now: FIRST,
      }).raise,
    ).toEqual([{ kind: "anomaly", anomalyDay: lastDay }]);
  });

  test("an account with no unusual spend that day raises nothing", () => {
    expect(
      CloudBudgetEvaluator.decide({
        amount: 10000,
        thresholds: [80, 100],
        alertOnProjection: true,
        anomalyDays: [anomalyDay([])],
        spend: spend({ spent: 100, projected: 900 }),
        state: null,
        now: NOW,
      }).raise,
    ).toEqual([]);
  });

  test("kept apart by its budget, month, account and day", () => {
    expect(
      CloudBudgetEvaluator.getFingerprint({
        budgetId: BUDGET_ID.toString(),
        month: "2026-11",
        alert: { kind: "anomaly", anomalyDay: anomalyDay() },
      }),
    ).toBe(
      `cloud-budget:${BUDGET_ID.toString()}:2026-11:anomaly-${ACCOUNT_ROW}-2026-11-19`,
    );
  });

  test("says which day, which account, and every service that ran high - and where the month stands", () => {
    const words: {
      title: string;
      description: string;
      rootCause?: string | undefined;
    } = CloudBudgetEvaluator.describe({
      budgetName: "Production",
      scope: "every cloud account of the project",
      amount: 10000,
      currency: "USD",
      spend: spend({ spent: 2500, projected: 7800 }),
      alert: {
        kind: "anomaly",
        anomalyDay: anomalyDay([
          lambda,
          { day: "2026-11-19", service: "AWS Glue", amount: 40, usual: 0 },
        ]),
      },
      now: NOW,
    });

    /*
     * The title names the service that ran furthest above its usual and
     * counts the rest, so it never reads as if one service was all of it;
     * its day in words a phone call reads out, not "2026-11-19".
     */
    expect(words.title).toBe(
      'Cloud budget "Production": AWS Lambda and 1 more service cost far more than usual on Nov 19',
    );
    expect(words.description).toBe(
      `On November 19, 2026, in ${SCOPE}, AWS Lambda cost $412.00, 2.3 times its usual $180.00; and AWS Glue cost $40.00, where it usually costs nothing. A day's usual is the median of the 14 days before it: a service is unusual at 2 times its usual day, the account as a whole at 1.5 times. This month's spend is $2,500.00 of the $10,000.00 budget (25%), on course for $7,800.00.`,
    );
    // The services are the description: no root cause beside it.
    expect(words.rootCause).toBeUndefined();

    expect(
      CloudBudgetEvaluator.describe({
        budgetName: "Production",
        scope: "every cloud account of the project",
        amount: 10000,
        currency: "USD",
        spend: spend({ spent: 2500, projected: 7800 }),
        alert: { kind: "anomaly", anomalyDay: anomalyDay([whole]) },
        now: NOW,
      }).title,
    ).toBe(
      `Cloud budget "Production": ${SCOPE} cost far more than usual on Nov 19`,
    );
    expect(CloudBudgetEvaluator.describeAnomaly(whole, "USD")).toBe(
      "the account as a whole cost $2,400.00, 1.6 times its usual $1,500.00",
    );
  });

  test("its title: the account when the account ran high, else the service furthest above usual and how many more", () => {
    const glue: CloudCostAnomaly = {
      day: "2026-11-19",
      service: "AWS Glue",
      amount: 40,
      usual: 0,
    };
    const athena: CloudCostAnomaly = {
      day: "2026-11-19",
      service: "Amazon Athena",
      amount: 96,
      usual: 40,
    };

    expect(
      CloudBudgetEvaluator.getAnomalyTitleSubject(anomalyDay([lambda])),
    ).toBe("AWS Lambda");
    expect(
      CloudBudgetEvaluator.getAnomalyTitleSubject(anomalyDay([lambda, glue])),
    ).toBe("AWS Lambda and 1 more service");
    expect(
      CloudBudgetEvaluator.getAnomalyTitleSubject(
        anomalyDay([lambda, glue, athena]),
      ),
    ).toBe("AWS Lambda and 2 more services");
    // The account as a whole: its services' spikes are part of it.
    expect(
      CloudBudgetEvaluator.getAnomalyTitleSubject(
        anomalyDay([whole, lambda, glue]),
      ),
    ).toBe(SCOPE);
  });

  test("its day in words, in UTC whatever the server's zone, and a day it cannot read as written", () => {
    expect(formatCloudBudgetAlertDay("2026-11-19", "short")).toBe("Nov 19");
    expect(formatCloudBudgetAlertDay("2026-11-19", "long")).toBe(
      "November 19, 2026",
    );
    // A month's first and last days stay theirs: no zone moves them.
    expect(formatCloudBudgetAlertDay("2026-12-01", "short")).toBe("Dec 1");
    expect(formatCloudBudgetAlertDay("2026-11-30", "long")).toBe(
      "November 30, 2026",
    );
    expect(formatCloudBudgetAlertDay("not a day", "short")).toBe("not a day");
  });
});

describe("a budget's check", () => {
  let created: Array<Alert> = [];
  let timelines: Array<AlertStateTimeline> = [];
  let updates: Array<JSONObject> = [];
  let openAlerts: Array<Alert> = [];
  let budget: CloudBudget;
  let accounts: Array<CloudAccount> = [];

  function makeBudget(overrides: Partial<CloudBudget> = {}): CloudBudget {
    const value: CloudBudget = new CloudBudget();
    value.id = BUDGET_ID;
    value.projectId = PROJECT;
    value.name = "Production";
    value.isEnabled = true;
    value.monthlyAmount = 1000;
    value.currency = "USD";
    value.alertThresholds = "80,100";
    value.alertOnProjection = true;
    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy.id = POLICY_ID;
    value.onCallDutyPolicies = [policy];
    Object.assign(value, overrides);
    return value;
  }

  function makeAccount(costSummary: CloudAccountCostSummary): CloudAccount {
    const account: CloudAccount = new CloudAccount();
    account.id = ObjectID.generate();
    account.name = "web";
    account.provider = "aws" as never;
    account.accountId = "123456789012";
    account.costSummary = costSummary as unknown as JSONObject;
    return account;
  }

  beforeEach(() => {
    created = [];
    timelines = [];
    updates = [];
    openAlerts = [];
    budget = makeBudget();
    accounts = [
      makeAccount(summary({ monthToDate: 850, projectedMonth: 1200 })),
    ];

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
    jest
      .spyOn(CloudBudgetService, "findOneById")
      .mockImplementation(async (): Promise<CloudBudget | null> => {
        return budget;
      });
    jest
      .spyOn(CloudBudgetService, "updateOneById")
      .mockImplementation(async (input: { data: unknown }): Promise<number> => {
        updates.push(input.data as JSONObject);
        return 1;
      });
    jest
      .spyOn(CloudAccountService, "findBy")
      .mockImplementation(async (): Promise<Array<CloudAccount>> => {
        return accounts;
      });
    jest
      .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
      .mockImplementation(async (): Promise<Array<ObjectID>> => {
        return [ObjectID.generate()];
      });
    jest
      .spyOn(AlertService, "findBy")
      .mockImplementation(async (): Promise<Array<Alert>> => {
        return openAlerts;
      });
    jest
      .spyOn(AlertSeverityService, "findOneBy")
      .mockImplementation(async (): Promise<AlertSeverity | null> => {
        const severity: AlertSeverity = new AlertSeverity();
        severity.id = SEVERITY_ID;
        return severity;
      });
    jest
      .spyOn(AlertService, "create")
      .mockImplementation(async (input: { data: Alert }): Promise<Alert> => {
        created.push(input.data);
        const saved: Alert = new Alert();
        saved.id = new ObjectID(
          `10000000-0000-4000-8000-00000000000${created.length}`,
        );
        return saved;
      });
    jest
      .spyOn(AlertStateTimelineService, "getResolvedStateIdForProject")
      .mockImplementation(async (): Promise<ObjectID> => {
        return new ObjectID("10000000-0000-4000-8000-0000000000aa");
      });
    jest
      .spyOn(AlertStateTimelineService, "create")
      .mockImplementation(
        async (input: {
          data: AlertStateTimeline;
        }): Promise<AlertStateTimeline> => {
          timelines.push(input.data);
          return input.data;
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("raises the alert of the threshold passed and the month's warning, pages its on-call policies, and keeps the month's state", async () => {
    await CloudBudgetEvaluator.evaluateBudgetById(BUDGET_ID);

    // $850 of $1,000 (80% passed), and on course for $1,200: two alerts.
    expect(created).toHaveLength(2);
    expect(created[0]!.title).toBe('Cloud budget "Production" passed 80%');
    expect(created[0]!.seriesFingerprint).toBe(
      `cloud-budget:${BUDGET_ID.toString()}:2026-11:threshold-80`,
    );
    expect(created[0]!.alertSeverityId?.toString()).toBe(
      SEVERITY_ID.toString(),
    );
    expect(created[0]!.isCreatedAutomatically).toBe(true);
    expect(
      (created[0]!.onCallDutyPolicies || []).map((policy: OnCallDutyPolicy) => {
        return policy.id?.toString();
      }),
    ).toEqual([POLICY_ID.toString()]);
    // The account named no service: no root cause, not the description again.
    expect(created[0]!.rootCause).toBeUndefined();
    expect(created[0]!.description).toContain("$850.00 of the $1,000.00");

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      spentThisMonth: 850,
      projectedThisMonth: 1200,
      lastCheckedAt: NOW,
    });
    const state: CloudBudgetAlertState = updates[0]![
      "alertState"
    ] as unknown as CloudBudgetAlertState;
    expect(created[1]!.title).toBe(
      'Cloud budget "Production" is on course to be passed',
    );
    expect(created[1]!.seriesFingerprint).toBe(
      `cloud-budget:${BUDGET_ID.toString()}:2026-11:projection`,
    );
    expect(state.month).toBe("2026-11");
    expect(state.thresholds).toEqual([80]);
    expect(state.projection).toBe(true);
    expect(state.alertIds).toEqual([
      "10000000-0000-4000-8000-000000000001",
      "10000000-0000-4000-8000-000000000002",
    ]);
  });

  test("an alert names where the money went as its root cause, apart from its description", async () => {
    accounts = [
      makeAccount(
        summary({
          monthToDate: 850,
          projectedMonth: 1200,
          topServices: [
            { service: "Amazon EC2", amount: 500 },
            { service: "Amazon RDS", amount: 250 },
          ],
        }),
      ),
    ];

    await CloudBudgetEvaluator.evaluateBudgetById(BUDGET_ID);

    expect(created).toHaveLength(2);

    for (const alert of created) {
      expect(alert.rootCause).toBe(
        "What cost the most this month: Amazon EC2 ($500.00) and Amazon RDS ($250.00).",
      );
      expect(alert.rootCause).not.toBe(alert.description);
    }
  });

  test("an alert of the same fingerprint open already is not raised again", async () => {
    openAlerts = [new Alert()];

    await CloudBudgetEvaluator.evaluateBudgetById(BUDGET_ID);

    expect(created).toHaveLength(0);
    // The state still says the threshold passed: it is not tried again.
    expect(
      (updates[0]!["alertState"] as unknown as CloudBudgetAlertState)
        .thresholds,
    ).toEqual([80]);
  });

  test("a new month resolves last month's alerts, one resolved already left as it is", async () => {
    budget = makeBudget({
      alertState: {
        month: "2026-10",
        thresholds: [80, 100],
        projection: false,
        alertIds: [OLD_ALERT, "10000000-0000-4000-8000-0000000000c8"],
      } as unknown as JSONObject,
    });
    accounts = [makeAccount(summary({ monthToDate: 10, projectedMonth: 300 }))];

    let calls: number = 0;
    (AlertStateTimelineService.create as jest.Mock).mockImplementation(
      async (input: unknown): Promise<AlertStateTimeline> => {
        calls++;
        if (calls === 2) {
          throw new BadDataException(
            "Alert state cannot be same as previous state.",
          );
        }
        const data: AlertStateTimeline = (input as { data: AlertStateTimeline })
          .data;
        timelines.push(data);
        return data;
      },
    );

    await CloudBudgetEvaluator.evaluateBudgetById(BUDGET_ID);

    expect(calls).toBe(2);
    expect(timelines).toHaveLength(1);
    expect(timelines[0]!.alertId?.toString()).toBe(OLD_ALERT);
    expect(timelines[0]!.rootCause).toContain(
      "the month this cloud budget alert was raised in is over",
    );
    expect(created).toHaveLength(0);
    expect(
      (updates[0]!["alertState"] as unknown as CloudBudgetAlertState).month,
    ).toBe("2026-11");
  });

  test("an account's unusual day is an alert of its own, once, kept apart by its account and day", async () => {
    accounts = [
      makeAccount(
        summary({
          monthToDate: 100,
          projectedMonth: 500,
          latestDay: "2026-11-20",
          anomalies: [
            {
              day: "2026-11-19",
              service: "AWS Lambda",
              amount: 412,
              usual: 180,
            },
          ],
        }),
      ),
    ];

    await CloudBudgetEvaluator.evaluateBudgetById(BUDGET_ID);

    expect(created).toHaveLength(1);
    expect(created[0]!.title).toBe(
      'Cloud budget "Production": AWS Lambda cost far more than usual on Nov 19',
    );
    expect(created[0]!.description).toContain(
      "in the web account (AWS 123456789012), AWS Lambda cost $412.00, 2.3 times its usual $180.00",
    );
    expect(created[0]!.seriesFingerprint).toBe(
      `cloud-budget:${BUDGET_ID.toString()}:2026-11:anomaly-${accounts[0]!.id!.toString()}-2026-11-19`,
    );
    const state: CloudBudgetAlertState = updates[0]![
      "alertState"
    ] as unknown as CloudBudgetAlertState;
    expect(state.anomalies).toEqual([
      `${accounts[0]!.id!.toString()}|2026-11-19`,
    ]);
    expect(state.alertIds).toHaveLength(1);

    // Checked again with that state: not raised twice.
    budget = makeBudget({ alertState: state as unknown as JSONObject });
    await CloudBudgetEvaluator.evaluateBudgetById(BUDGET_ID);
    expect(created).toHaveLength(1);
  });

  test("a budget that does not alert on unusual days raises none", async () => {
    budget = makeBudget({ alertOnAnomaly: false });
    accounts = [
      makeAccount(
        summary({
          monthToDate: 100,
          projectedMonth: 500,
          latestDay: "2026-11-20",
          anomalies: [
            {
              day: "2026-11-19",
              service: "AWS Lambda",
              amount: 412,
              usual: 180,
            },
          ],
        }),
      ),
    ];

    await CloudBudgetEvaluator.evaluateBudgetById(BUDGET_ID);
    expect(created).toHaveLength(0);
  });

  test("a paused budget raises nothing, though its figures are kept", async () => {
    budget = makeBudget({ isEnabled: false });

    await CloudBudgetEvaluator.evaluateBudgetById(BUDGET_ID);

    expect(created).toHaveLength(0);
    expect(updates[0]).toMatchObject({ spentThisMonth: 850 });
  });

  test("one budget's trouble never throws", async () => {
    (CloudAccountService.findBy as jest.Mock).mockImplementation(
      async (): Promise<never> => {
        throw new Error("database down");
      },
    );

    await expect(
      CloudBudgetEvaluator.evaluateBudgetById(BUDGET_ID),
    ).resolves.toBeUndefined();
    expect(updates).toHaveLength(0);
  });
});
