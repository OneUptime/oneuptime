import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import AlertStateTimeline from "../../../../Models/DatabaseModels/AlertStateTimeline";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OpenStackBudget from "../../../../Models/DatabaseModels/OpenStackBudget";
import AlertService from "../../../../Server/Services/AlertService";
import AlertSeverityService from "../../../../Server/Services/AlertSeverityService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import AlertStateTimelineService from "../../../../Server/Services/AlertStateTimelineService";
import OpenStackBudgetService from "../../../../Server/Services/OpenStackBudgetService";
import OpenStackScopedRules from "../../../../Server/Utils/OpenStack/OpenStackScopedRules";
import OpenStackBudgetEvaluator, {
  describeOpenStackBudgetAlert,
  getOpenStackBudgetFingerprint,
  getOpenStackBudgetSpend,
} from "../../../../Server/Utils/OpenStack/OpenStackBudgetEvaluator";
import logger from "../../../../Server/Utils/Logger";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  OpenStackCostSource,
  OpenStackSpendProject,
  OpenStackSpendSnapshot,
} from "../../../../Types/OpenStack/OpenStackSpendSnapshot";

const NOW: Date = new Date("2026-11-10T12:00:00.000Z");
const PROJECT_ID: ObjectID = ObjectID.generate();
const CLOUD_ID: ObjectID = ObjectID.generate();

function snapshot(
  overrides: Partial<OpenStackSpendSnapshot> = {},
): OpenStackSpendSnapshot {
  return {
    currency: "EUR",
    thisMonth: 500,
    onCourseFor: 900,
    ...overrides,
  } as OpenStackSpendSnapshot;
}

function project(
  id: string,
  overrides: Partial<OpenStackSpendProject> = {},
): OpenStackSpendProject {
  return {
    openStackProjectId: id,
    name: `Project ${id}`,
    domainId: null,
    domainName: null,
    thisMonth: 85,
    lastMonth: null,
    onCourseFor: 120,
    source: OpenStackCostSource.PriceList,
    vcpuHours: 0,
    lastMonthVcpuHours: null,
    vcpuHoursOnCourseFor: 0,
    growth: null,
    ...overrides,
  };
}

function budget(overrides: Partial<OpenStackBudget> = {}): OpenStackBudget {
  const model: OpenStackBudget = new OpenStackBudget();
  model.id = ObjectID.generate();
  model.projectId = PROJECT_ID;
  model.openStackCloudId = CLOUD_ID;
  model.name = "Payments";
  model.isEnabled = true;
  model.openStackProjectId = "p";
  model.monthlyAmount = 100;
  model.alertThresholds = "80,100";
  model.alertOnProjection = false;
  Object.assign(model, overrides);
  return model;
}

describe("what a budget reads", () => {
  test("a project's figures, or the whole cloud's with no project named", () => {
    expect(
      getOpenStackBudgetSpend({
        openStackProjectId: "p",
        snapshot: snapshot(),
        projects: [project("p"), project("q", { thisMonth: 1 })],
      }),
    ).toEqual({ spent: 85, projected: 120 });
    expect(
      getOpenStackBudgetSpend({
        openStackProjectId: null,
        snapshot: snapshot(),
        projects: [],
      }),
    ).toEqual({ spent: 500, projected: 900 });
  });

  test("a project with nothing reported has no figures, and a price of zero is no figure either", () => {
    expect(
      getOpenStackBudgetSpend({
        openStackProjectId: "gone",
        snapshot: snapshot(),
        projects: [],
      }),
    ).toEqual({ spent: null, projected: null });
    expect(
      getOpenStackBudgetSpend({
        openStackProjectId: "p",
        snapshot: snapshot(),
        projects: [project("p", { thisMonth: null, onCourseFor: null })],
      }),
    ).toEqual({ spent: null, projected: null });
  });
});

describe("what an alert says", () => {
  const words: ReturnType<typeof describeOpenStackBudgetAlert> =
    describeOpenStackBudgetAlert({
      budgetName: "Payments",
      scope: "project Payments of OpenStack cloud eu-1",
      amount: 100,
      currency: "EUR",
      spent: 85,
      projected: 120,
      alert: { kind: "threshold", threshold: 80 },
      now: NOW,
    });

  test("what's been used of what, where it's heading, and that this isn't a bill", () => {
    expect(words.title).toBe('OpenStack budget "Payments" passed 80%');
    expect(words.description).toContain("€85.00");
    expect(words.description).toContain("€100.00");
    expect(words.description).toContain("(85%)");
    expect(words.description).toContain("€120.00");
    expect(words.description).toContain("20 days");
    expect(words.description).toContain("estimate");
    expect(words.description).toContain("not a bill");
  });

  test("on course to pass says so before it does", () => {
    const projection: ReturnType<typeof describeOpenStackBudgetAlert> =
      describeOpenStackBudgetAlert({
        budgetName: "Payments",
        scope: "x",
        amount: 100,
        currency: "EUR",
        spent: 50,
        projected: 120,
        alert: { kind: "projection" },
        now: NOW,
      });

    expect(projection.title).toBe(
      'OpenStack budget "Payments" is on course to be passed',
    );
    expect(projection.description).toContain("on course for €120.00");
  });

  test("no currency is set: a figure is said with none, never a dollar sign nobody chose", () => {
    const plain: ReturnType<typeof describeOpenStackBudgetAlert> =
      describeOpenStackBudgetAlert({
        budgetName: "x",
        scope: "x",
        amount: 100,
        currency: null,
        spent: 85.5,
        projected: 90,
        alert: { kind: "threshold", threshold: 80 },
        now: NOW,
      });

    expect(plain.description).toContain("85.50 of the 100.00 budget");
    expect(plain.description).not.toContain("$");
  });

  test("a fingerprint keeps a budget's month and threshold apart", () => {
    expect(
      getOpenStackBudgetFingerprint({
        budgetId: "b",
        month: "2026-11",
        alert: { kind: "threshold", threshold: 80 },
      }),
    ).toBe("openstack-budget:b:2026-11:threshold-80");
    expect(
      getOpenStackBudgetFingerprint({
        budgetId: "b",
        month: "2026-11",
        alert: { kind: "projection" },
      }),
    ).toBe("openstack-budget:b:2026-11:projection");
  });
});

describe("a cloud's budgets, on what a reading worked out", () => {
  let created: Array<Alert>;
  let updates: Array<JSONObject>;
  let resolved: Array<AlertStateTimeline>;
  let budgets: Array<OpenStackBudget>;

  const evaluate: (data?: {
    snapshot?: OpenStackSpendSnapshot;
    projects?: Array<OpenStackSpendProject>;
    now?: Date;
  }) => Promise<number> = async (
    data: {
      snapshot?: OpenStackSpendSnapshot;
      projects?: Array<OpenStackSpendProject>;
      now?: Date;
    } = {},
  ): Promise<number> => {
    return await OpenStackBudgetEvaluator.evaluateCloud({
      projectId: PROJECT_ID,
      openStackCloudId: CLOUD_ID,
      cloudName: "eu-1",
      snapshot: data.snapshot || snapshot(),
      projects: data.projects || [project("p")],
      now: data.now || NOW,
    });
  };

  beforeEach(() => {
    created = [];
    updates = [];
    resolved = [];
    budgets = [budget()];

    jest
      .spyOn(OpenStackBudgetService, "findBy")
      .mockImplementation((async () => {
        return budgets;
      }) as never);
    jest
      .spyOn(OpenStackBudgetService, "updateOneById")
      .mockImplementation(((update: { data: JSONObject }) => {
        updates.push(update.data);
        return Promise.resolve();
      }) as never);
    jest
      .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
      .mockResolvedValue([]);
    jest.spyOn(AlertService, "findBy").mockResolvedValue([]);
    jest
      .spyOn(AlertSeverityService, "findOneBy")
      .mockResolvedValue({ id: ObjectID.generate() } as AlertSeverity);
    jest.spyOn(AlertService, "create").mockImplementation(((data: {
      data: Alert;
    }) => {
      created.push(data.data);
      data.data.id = ObjectID.generate();
      return Promise.resolve(data.data);
    }) as never);
    jest
      .spyOn(AlertStateTimelineService, "getResolvedStateIdForProject")
      .mockResolvedValue(ObjectID.generate());
    jest.spyOn(AlertStateTimelineService, "create").mockImplementation(((data: {
      data: AlertStateTimeline;
    }) => {
      resolved.push(data.data);
      return Promise.resolve(data.data);
    }) as never);
    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined as never;
    });
    jest.spyOn(OpenStackScopedRules, "read").mockResolvedValue({
      labelIds: [],
      labelRuleNames: [],
      owners: [],
      ownerRuleNames: [],
    });
    jest.spyOn(OpenStackScopedRules, "finishAlert").mockResolvedValue();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("past a threshold raises one alert for the highest passed, named for its project and cloud", async () => {
    expect(await evaluate()).toBe(1);

    expect(created.length).toBe(1);
    expect(created[0]!.title).toBe('OpenStack budget "Payments" passed 80%');
    expect(created[0]!.description).toContain(
      "project Project p of OpenStack cloud eu-1",
    );
    expect(created[0]!.seriesFingerprint).toBe(
      getOpenStackBudgetFingerprint({
        budgetId: budgets[0]!.id!.toString(),
        month: "2026-11",
        alert: { kind: "threshold", threshold: 80 },
      }),
    );
    expect(created[0]!.isCreatedAutomatically).toBe(true);
    expect(updates[0]).toMatchObject({
      spentThisMonth: 85,
      projectedThisMonth: 120,
      lastCheckedAt: NOW,
    });
  });

  test("it's on the cloud's Alerts page, and goes where the project's alerts go", async () => {
    await evaluate({
      projects: [project("p", { domainId: "d1" })],
    });

    expect(created[0]!.openStackClouds![0]!.id!.toString()).toBe(
      CLOUD_ID.toString(),
    );
    expect(OpenStackScopedRules.read).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      openStackCloudId: CLOUD_ID,
      reached: [{ projectId: "p", domainId: "d1" }],
    });
    expect(OpenStackScopedRules.finishAlert).toHaveBeenCalledTimes(1);
  });

  test("the same threshold doesn't raise twice in a month", async () => {
    await evaluate();
    budgets[0]!.alertState = updates[0]!["alertState"] as JSONObject;
    await evaluate();

    expect(created.length).toBe(1);
  });

  test("a budget over the whole cloud reads the whole cloud", async () => {
    budgets = [budget({ openStackProjectId: undefined, monthlyAmount: 600 })];

    await evaluate();

    expect(created.length).toBe(1);
    expect(created[0]!.description).toContain(
      "the whole of OpenStack cloud eu-1",
    );
    expect(updates[0]!["spentThisMonth"]).toBe(500);
  });

  test("on course to pass alerts once, before it passes, when asked to", async () => {
    budgets = [budget({ monthlyAmount: 110, alertOnProjection: true })];

    await evaluate({ projects: [project("p", { thisMonth: 50 })] });

    expect(created.length).toBe(1);
    expect(created[0]!.title).toContain("on course to be passed");
  });

  test("no prices means no figures: nothing's raised, and the row says it hasn't been checked", async () => {
    await evaluate({
      snapshot: snapshot({
        currency: null,
        thisMonth: null,
        onCourseFor: null,
      }),
      projects: [project("p", { thisMonth: null, onCourseFor: null })],
    });

    expect(created.length).toBe(0);
    expect(updates[0]).toMatchObject({
      spentThisMonth: null,
      projectedThisMonth: null,
      lastCheckedAt: null,
    });
  });

  test("a new month resolves last month's alerts and starts from nothing", async () => {
    const lastMonthsAlert: ObjectID = ObjectID.generate();

    budgets = [
      budget({
        alertState: {
          month: "2026-10",
          thresholds: [80, 100],
          projection: true,
          alertIds: [lastMonthsAlert.toString()],
        },
      }),
    ];

    await evaluate({
      projects: [project("p", { thisMonth: 1, onCourseFor: 1 })],
    });

    expect(resolved.length).toBe(1);
    expect(resolved[0]!.alertId!.toString()).toBe(lastMonthsAlert.toString());
    expect(created.length).toBe(0);
    expect((updates[0]!["alertState"] as JSONObject)["month"]).toBe("2026-11");
    expect((updates[0]!["alertState"] as JSONObject)["thresholds"]).toEqual([]);
  });

  test("one already open of its fingerprint isn't raised again by a second worker", async () => {
    jest
      .spyOn(AlertService, "findBy")
      .mockResolvedValue([{ id: ObjectID.generate() } as Alert]);

    await evaluate();

    expect(created.length).toBe(0);
  });

  test("its on-call policies go on the alert", async () => {
    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy.id = ObjectID.generate();
    budgets = [budget({ onCallDutyPolicies: [policy] })];

    await evaluate();

    expect(created[0]!.onCallDutyPolicies![0]!.id!.toString()).toBe(
      policy.id.toString(),
    );
  });

  test("one budget's trouble stops none of the others", async () => {
    budgets = [budget({ name: "first" }), budget({ name: "second" })];
    jest.spyOn(AlertService, "create").mockImplementationOnce((async () => {
      throw new Error("down");
    }) as never);

    await evaluate();

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(
      created.map((alert: Alert) => {
        return alert.title;
      }),
    ).toEqual(['OpenStack budget "second" passed 80%']);
  });
});
