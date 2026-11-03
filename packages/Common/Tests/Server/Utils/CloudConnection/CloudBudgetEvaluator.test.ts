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
  CloudBudgetDecision,
  CloudBudgetSpend,
  formatCloudBudgetAmount,
  readCloudBudgetAlertState,
} from "../../../../Server/Utils/CloudConnection/CloudBudgetEvaluator";
import {
  CloudAccountCostSummary,
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
    });
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
        alertIds: [OLD_ALERT],
      },
      now: NOW,
    });

    expect(decision.resolveAlertIds).toEqual([OLD_ALERT]);
    expect(decision.state).toEqual({
      month: "2026-11",
      thresholds: [],
      projection: false,
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
    const threshold: { title: string; description: string } =
      CloudBudgetEvaluator.describe({
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

    const projection: { title: string; description: string } =
      CloudBudgetEvaluator.describe({
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
      alertIds: [OLD_ALERT],
    });
    expect(formatCloudBudgetAmount(1234.5, "USD")).toBe("$1,234.50");
    expect(formatCloudBudgetAmount(10, "NOT A CODE")).toBe("NOT A CODE 10.00");
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
    accounts = [makeAccount(summary({ monthToDate: 850, projectedMonth: 1200 }))];

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
    jest
      .spyOn(CloudBudgetService, "findOneById")
      .mockImplementation(async (): Promise<CloudBudget | null> => {
        return budget;
      });
    jest
      .spyOn(CloudBudgetService, "updateOneById")
      .mockImplementation(async (input: { data: unknown }): Promise<void> => {
        updates.push(input.data as JSONObject);
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
        async (input: { data: AlertStateTimeline }): Promise<AlertStateTimeline> => {
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
    expect(created[0]!.alertSeverityId?.toString()).toBe(SEVERITY_ID.toString());
    expect(created[0]!.isCreatedAutomatically).toBe(true);
    expect(
      (created[0]!.onCallDutyPolicies || []).map((policy: OnCallDutyPolicy) => {
        return policy.id?.toString();
      }),
    ).toEqual([POLICY_ID.toString()]);

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

  test("an alert of the same fingerprint open already is not raised again", async () => {
    openAlerts = [new Alert()];

    await CloudBudgetEvaluator.evaluateBudgetById(BUDGET_ID);

    expect(created).toHaveLength(0);
    // The state still says the threshold passed: it is not tried again.
    expect(
      (updates[0]!["alertState"] as unknown as CloudBudgetAlertState).thresholds,
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
    expect(timelines[0]!.rootCause).toContain("the month this cloud budget alert was raised in is over");
    expect(created).toHaveLength(0);
    expect(
      (updates[0]!["alertState"] as unknown as CloudBudgetAlertState).month,
    ).toBe("2026-11");
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
