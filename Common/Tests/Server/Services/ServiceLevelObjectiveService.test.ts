import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import ServiceLevelObjectiveOwnerTeam from "../../../Models/DatabaseModels/ServiceLevelObjectiveOwnerTeam";
import ServiceLevelObjectiveOwnerUser from "../../../Models/DatabaseModels/ServiceLevelObjectiveOwnerUser";
import User from "../../../Models/DatabaseModels/User";
import AlertService from "../../../Server/Services/AlertService";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import ServiceLevelObjectiveBurnRateRuleService from "../../../Server/Services/ServiceLevelObjectiveBurnRateRuleService";
import ServiceLevelObjectiveMonitorRuleEngineService from "../../../Server/Services/ServiceLevelObjectiveMonitorRuleEngineService";
import ServiceLevelObjectiveOwnerTeamService from "../../../Server/Services/ServiceLevelObjectiveOwnerTeamService";
import ServiceLevelObjectiveOwnerUserService from "../../../Server/Services/ServiceLevelObjectiveOwnerUserService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import OwnerTableRegistry from "../../../Server/Types/Database/Permissions/OwnerTableRegistry";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import logger from "../../../Server/Utils/Logger";
import URL from "../../../Types/API/URL";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";
import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";

/*
 * Contract under test for ServiceLevelObjectiveService:
 *
 *   - a target of 0 or 100 is nonsense (no error budget / no room to burn),
 *     and the guard has to hold on update as well as create,
 *   - a brand new SLO must come out of onCreateSuccess already carrying the
 *     two canonical Google-SRE multi-window burn rate rules, with thresholds
 *     scaled to the compliance window (30 days == the textbook 14.4x / 6x),
 *   - disabling or deleting an SLO must resolve everything its burn-rate
 *     rules left open - the Alerts they raised AND the Incidents they
 *     declared - because the evaluation worker skips SLOs it no longer sees
 *     and would otherwise leave on-call escalations running forever,
 *   - and that resolution, while it must attempt every rule, must still
 *     REACH its caller: the worker's guard path only commits the SLO's new
 *     status once the resolve succeeded, so a swallowed failure strands the
 *     records permanently,
 *   - getDueSlos must keep selecting every column the evaluation worker
 *     reads - a dropped column silently produces wrong SLI math.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SLO_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const RULE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const OTHER_RULE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const RESOLVED_STATE_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const RESOLVED_INCIDENT_STATE_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const THIRD_RULE_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);

const TARGET_PERCENTAGE_ERROR_MESSAGE: string =
  "SLO target must be greater than 0 and at most 99.999. A 100% target leaves no error budget.";
const WINDOW_DAYS_ERROR_MESSAGE: string =
  "SLO window must be a whole number of days between 1 and 366.";
const AT_RISK_THRESHOLD_ERROR_MESSAGE: string =
  "SLO at-risk threshold must be a whole percentage between 0 and 100.";

/*
 * Every column getDueSlos must hand to the evaluation worker. Enumerated here
 * (rather than derived from the service) so that dropping one from the select
 * fails this test instead of silently shipping.
 */
const EXPECTED_DUE_SLO_SELECT_KEYS: Array<string> = [
  "_id",
  "projectId",
  "name",
  "isEnabled",
  "sliType",
  "multiMonitorMode",
  "monitors",
  "downtimeMonitorStatuses",
  "metricQueryConfig",
  "targetPercentage",
  "windowType",
  "windowDays",
  "timezone",
  "atRiskThresholdPercentage",
  "currentSliPercentage",
  "errorBudgetRemainingPercentage",
  "errorBudgetRemainingSeconds",
  "errorBudgetTotalSeconds",
  "currentBurnRate",
  "sloStatus",
  "statusChangeNotificationSentAt",
  "lastEvaluatedAt",
  "nextEvaluationAt",
  "lastAccumulatedBucketEndAt",
];

type SloFields = Record<string, unknown>;

function makeSlo(fields: SloFields): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  const writable: Record<string, unknown> = slo as unknown as Record<
    string,
    unknown
  >;

  for (const key of Object.keys(fields)) {
    writable[key] = fields[key];
  }

  return slo;
}

function makeCreateBy(fields: SloFields): CreateBy<ServiceLevelObjective> {
  return {
    data: makeSlo(fields),
    props: { isRoot: true },
  };
}

function makeUpdateBy(data: SloFields): UpdateBy<ServiceLevelObjective> {
  return {
    query: { _id: SLO_ID.toString() },
    data: data,
    props: { isRoot: true },
    limit: 1,
    skip: 0,
  } as unknown as UpdateBy<ServiceLevelObjective>;
}

function makeOnUpdate(data: SloFields): OnUpdate<ServiceLevelObjective> {
  return {
    updateBy: makeUpdateBy(data),
    carryForward: null,
  };
}

function makeMonitorStatus(
  isOperationalState: boolean,
  name: string,
): MonitorStatus {
  const monitorStatus: MonitorStatus = new MonitorStatus();
  monitorStatus._id = ObjectID.generate().toString();
  monitorStatus.name = name;
  monitorStatus.isOperationalState = isOperationalState;
  return monitorStatus;
}

function makeBurnRateRule(id: ObjectID): ServiceLevelObjectiveBurnRateRule {
  const rule: ServiceLevelObjectiveBurnRateRule =
    new ServiceLevelObjectiveBurnRateRule();
  rule._id = id.toString();
  rule.id = id;
  rule.projectId = PROJECT_ID;
  rule.serviceLevelObjectiveId = SLO_ID;
  return rule;
}

function makeAlert(id: ObjectID): Alert {
  const alert: Alert = new Alert();
  alert._id = id.toString();
  alert.id = id;
  alert.projectId = PROJECT_ID;
  return alert;
}

function makeIncident(id: ObjectID): Incident {
  const incident: Incident = new Incident();
  incident._id = id.toString();
  incident.id = id;
  incident.projectId = PROJECT_ID;
  return incident;
}

function makeUser(id: ObjectID): User {
  const user: User = new User();
  user._id = id.toString();
  user.id = id;
  return user;
}

// Calls the protected hook without widening the service's public surface.
function callHook(name: string, ...args: Array<unknown>): Promise<unknown> {
  const hooks: Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  > = ServiceLevelObjectiveService as unknown as Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  >;

  return hooks[name]!.apply(ServiceLevelObjectiveService, args);
}

async function expectBadData(
  promise: Promise<unknown>,
  message: string,
): Promise<void> {
  await expect(promise).rejects.toThrow(BadDataException);
  await expect(promise).rejects.toThrow(message);
}

describe("ServiceLevelObjectiveService.onBeforeCreate - target percentage guard", () => {
  beforeEach(() => {
    jest.spyOn(MonitorStatusService, "findBy").mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const rejectedTargets: Array<{ label: string; value: unknown }> = [
    { label: "0 (a target of nothing is not an objective)", value: 0 },
    { label: "a negative target", value: -1 },
    { label: "exactly 100 (leaves no error budget)", value: 100 },
    { label: "above 100", value: 100.001 },
    { label: "999", value: 999 },
    { label: "just above the 99.999 ceiling", value: 99.9991 },
    { label: "NaN", value: Number.NaN },
    { label: "Infinity", value: Number.POSITIVE_INFINITY },
    { label: "null", value: null },
    /*
     * Strings reach this hook for every numeric column (see the coercion
     * describe block below), so the rejections have to hold in string form too
     * - coercion must not become a way to smuggle an out-of-range target past
     * the guard.
     */
    { label: 'the string "0"', value: "0" },
    { label: 'the string "100"', value: "100" },
    { label: "an empty string", value: "" },
    { label: "a whitespace-only string", value: "   " },
    { label: "a non-numeric string", value: "abc" },
    { label: 'a string that overflows to Infinity ("1e400")', value: "1e400" },
    { label: "a boolean", value: true },
    { label: "an object", value: {} },
  ];

  for (const rejectedTarget of rejectedTargets) {
    it(`rejects ${rejectedTarget.label} with the error-budget rationale`, async () => {
      await expectBadData(
        callHook(
          "onBeforeCreate",
          makeCreateBy({
            projectId: PROJECT_ID,
            targetPercentage: rejectedTarget.value,
          }),
        ),
        TARGET_PERCENTAGE_ERROR_MESSAGE,
      );
    });
  }

  it("rejects a create with no targetPercentage at all - the field is required", async () => {
    await expectBadData(
      callHook("onBeforeCreate", makeCreateBy({ projectId: PROJECT_ID })),
      TARGET_PERCENTAGE_ERROR_MESSAGE,
    );
  });

  it("names the error budget in the rejection so the dashboard can explain why", async () => {
    let thrown: BadDataException | null = null;

    try {
      await callHook(
        "onBeforeCreate",
        makeCreateBy({ projectId: PROJECT_ID, targetPercentage: 100 }),
      );
    } catch (err) {
      thrown = err as BadDataException;
    }

    expect(thrown).toBeInstanceOf(BadDataException);
    expect(thrown!.message).toContain("error budget");
    expect(thrown!.message).toContain("99.999");
  });

  const acceptedTargets: Array<number> = [0.1, 50, 99, 99.9, 99.99, 99.999];

  for (const acceptedTarget of acceptedTargets) {
    it(`accepts a target of ${acceptedTarget}`, async () => {
      await expect(
        callHook(
          "onBeforeCreate",
          makeCreateBy({
            projectId: PROJECT_ID,
            targetPercentage: acceptedTarget,
          }),
        ),
      ).resolves.toBeDefined();
    });
  }

  it("rejects a create without a projectId before it looks at anything else", async () => {
    await expectBadData(
      callHook("onBeforeCreate", makeCreateBy({ targetPercentage: 99.9 })),
      "projectId is required",
    );
  });
});

describe("ServiceLevelObjectiveService.onBeforeUpdate - target percentage guard", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const rejectedTargets: Array<{ label: string; value: unknown }> = [
    { label: "0", value: 0 },
    { label: "a negative target", value: -0.5 },
    { label: "exactly 100", value: 100 },
    { label: "above 100", value: 150 },
    { label: "NaN", value: Number.NaN },
  ];

  for (const rejectedTarget of rejectedTargets) {
    it(`rejects an update to ${rejectedTarget.label}`, async () => {
      await expectBadData(
        callHook(
          "onBeforeUpdate",
          makeUpdateBy({ targetPercentage: rejectedTarget.value }),
        ),
        TARGET_PERCENTAGE_ERROR_MESSAGE,
      );
    });
  }

  const acceptedTargets: Array<number> = [0.1, 99.9, 99.999];

  for (const acceptedTarget of acceptedTargets) {
    it(`accepts an update to ${acceptedTarget}`, async () => {
      await expect(
        callHook(
          "onBeforeUpdate",
          makeUpdateBy({ targetPercentage: acceptedTarget }),
        ),
      ).resolves.toBeDefined();
    });
  }

  it("does not validate the target when the update payload does not carry it", async () => {
    await expect(
      callHook("onBeforeUpdate", makeUpdateBy({ name: "Renamed SLO" })),
    ).resolves.toBeDefined();
  });

  it("treats an explicit null target as 'not being updated' and does not throw", async () => {
    /*
     * The guard is `!== undefined && !== null`, so a null in the payload is
     * skipped rather than rejected. Pinned so the skip stays deliberate.
     */
    await expect(
      callHook("onBeforeUpdate", makeUpdateBy({ targetPercentage: null })),
    ).resolves.toBeDefined();
  });
});

describe("ServiceLevelObjectiveService - window days validation", () => {
  beforeEach(() => {
    jest.spyOn(MonitorStatusService, "findBy").mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const rejectedWindowDays: Array<{ label: string; value: number }> = [
    { label: "0 days", value: 0 },
    { label: "a negative window", value: -7 },
    { label: "more than a year (367)", value: 367 },
    { label: "NaN", value: Number.NaN },
  ];

  for (const rejectedWindow of rejectedWindowDays) {
    it(`rejects a Rolling window of ${rejectedWindow.label} on create`, async () => {
      await expectBadData(
        callHook(
          "onBeforeCreate",
          makeCreateBy({
            projectId: PROJECT_ID,
            targetPercentage: 99.9,
            windowType: SloWindowType.Rolling,
            windowDays: rejectedWindow.value,
          }),
        ),
        WINDOW_DAYS_ERROR_MESSAGE,
      );
    });

    it(`rejects an update to a window of ${rejectedWindow.label}`, async () => {
      await expectBadData(
        callHook(
          "onBeforeUpdate",
          makeUpdateBy({ windowDays: rejectedWindow.value }),
        ),
        WINDOW_DAYS_ERROR_MESSAGE,
      );
    });
  }

  const acceptedWindowDays: Array<number> = [1, 7, 28, 30, 90, 366];

  for (const acceptedWindow of acceptedWindowDays) {
    it(`accepts a Rolling window of ${acceptedWindow} days on create`, async () => {
      await expect(
        callHook(
          "onBeforeCreate",
          makeCreateBy({
            projectId: PROJECT_ID,
            targetPercentage: 99.9,
            windowType: SloWindowType.Rolling,
            windowDays: acceptedWindow,
          }),
        ),
      ).resolves.toBeDefined();
    });

    it(`accepts an update to a window of ${acceptedWindow} days`, async () => {
      await expect(
        callHook(
          "onBeforeUpdate",
          makeUpdateBy({ windowDays: acceptedWindow }),
        ),
      ).resolves.toBeDefined();
    });
  }

  it("validates the window on create when windowType is omitted, because Rolling is the default", async () => {
    await expectBadData(
      callHook(
        "onBeforeCreate",
        makeCreateBy({
          projectId: PROJECT_ID,
          targetPercentage: 99.9,
          windowDays: 0,
        }),
      ),
      WINDOW_DAYS_ERROR_MESSAGE,
    );
  });

  /*
   * Create and update must agree on what a valid window is. When create
   * skipped this check for CalendarMonth, an out-of-range windowDays could be
   * persisted and then never updated (onBeforeUpdate validates it
   * unconditionally), and switching the SLO to Rolling later would evaluate
   * against that out-of-range window.
   */
  it("rejects an out-of-range windowDays on create even for a CalendarMonth SLO", async () => {
    await expectBadData(
      callHook(
        "onBeforeCreate",
        makeCreateBy({
          projectId: PROJECT_ID,
          targetPercentage: 99.9,
          windowType: SloWindowType.CalendarMonth,
          windowDays: 0,
        }),
      ),
      WINDOW_DAYS_ERROR_MESSAGE,
    );
  });

  it("accepts a CalendarMonth SLO that omits windowDays entirely", async () => {
    await expect(
      callHook(
        "onBeforeCreate",
        makeCreateBy({
          projectId: PROJECT_ID,
          targetPercentage: 99.9,
          windowType: SloWindowType.CalendarMonth,
        }),
      ),
    ).resolves.toBeDefined();
  });

  it("does not validate the window on create when the column is absent", async () => {
    await expect(
      callHook(
        "onBeforeCreate",
        makeCreateBy({
          projectId: PROJECT_ID,
          targetPercentage: 99.9,
          windowType: SloWindowType.Rolling,
        }),
      ),
    ).resolves.toBeDefined();
  });

  it("does not validate the window when the update payload does not carry it", async () => {
    await expect(
      callHook("onBeforeUpdate", makeUpdateBy({ timezone: "UTC" })),
    ).resolves.toBeDefined();
  });
});

/*
 * Regression: numeric columns arrive as STRINGS from the dashboard.
 * "Target (%)" is a FormFieldSchemaType.Number, which renders an
 * <input type="number"> whose onChange hands Formik `e.target.value` - a
 * string. ModelForm.onSubmit copies values verbatim and BaseModel.fromJSON
 * does not coerce Number/Decimal columns, so onBeforeCreate used to receive
 * "99.9" and its strict `typeof value !== "number"` check rejected every
 * single dashboard SLO create and edit. The validators now coerce first and
 * write the coerced number back onto the payload, so Postgres never receives
 * a string either.
 */
describe("ServiceLevelObjectiveService - numeric columns supplied as strings", () => {
  beforeEach(() => {
    jest.spyOn(MonitorStatusService, "findBy").mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("accepts the string target the dashboard actually sends and persists it as a number", async () => {
    const createBy: CreateBy<ServiceLevelObjective> = makeCreateBy({
      projectId: PROJECT_ID,
      targetPercentage: "99.9",
    });

    await expect(callHook("onBeforeCreate", createBy)).resolves.toBeDefined();

    expect(createBy.data.targetPercentage).toBe(99.9);
    expect(typeof createBy.data.targetPercentage).toBe("number");
  });

  it("coerces every user-writable numeric column on create, not just the target", async () => {
    const createBy: CreateBy<ServiceLevelObjective> = makeCreateBy({
      projectId: PROJECT_ID,
      targetPercentage: "99.95",
      windowDays: "30",
      atRiskThresholdPercentage: "20",
    });

    await expect(callHook("onBeforeCreate", createBy)).resolves.toBeDefined();

    expect(createBy.data.targetPercentage).toBe(99.95);
    expect(createBy.data.windowDays).toBe(30);
    expect(createBy.data.atRiskThresholdPercentage).toBe(20);

    expect(typeof createBy.data.targetPercentage).toBe("number");
    expect(typeof createBy.data.windowDays).toBe("number");
    expect(typeof createBy.data.atRiskThresholdPercentage).toBe("number");
  });

  it("tolerates surrounding whitespace on a string numeric column", async () => {
    const createBy: CreateBy<ServiceLevelObjective> = makeCreateBy({
      projectId: PROJECT_ID,
      targetPercentage: " 99.9 ",
      windowDays: " 7 ",
    });

    await expect(callHook("onBeforeCreate", createBy)).resolves.toBeDefined();

    expect(createBy.data.targetPercentage).toBe(99.9);
    expect(createBy.data.windowDays).toBe(7);
  });

  it("writes the coerced numbers back onto the update payload so Postgres never sees a string", async () => {
    const updateBy: UpdateBy<ServiceLevelObjective> = makeUpdateBy({
      targetPercentage: "99.5",
      windowDays: "90",
      atRiskThresholdPercentage: "10",
    });

    await expect(callHook("onBeforeUpdate", updateBy)).resolves.toBeDefined();

    expect(updateBy.data.targetPercentage).toBe(99.5);
    expect(updateBy.data.windowDays).toBe(90);
    expect(updateBy.data.atRiskThresholdPercentage).toBe(10);

    expect(typeof updateBy.data.targetPercentage).toBe("number");
    expect(typeof updateBy.data.windowDays).toBe("number");
    expect(typeof updateBy.data.atRiskThresholdPercentage).toBe("number");
  });

  const acceptedWindowDayStrings: Array<string> = ["1", "7", "30", "366"];

  for (const acceptedWindowDayString of acceptedWindowDayStrings) {
    it(`accepts a window of "${acceptedWindowDayString}" days as a string on create and on update`, async () => {
      const createBy: CreateBy<ServiceLevelObjective> = makeCreateBy({
        projectId: PROJECT_ID,
        targetPercentage: 99.9,
        windowDays: acceptedWindowDayString,
      });

      await expect(callHook("onBeforeCreate", createBy)).resolves.toBeDefined();
      expect(createBy.data.windowDays).toBe(Number(acceptedWindowDayString));

      const updateBy: UpdateBy<ServiceLevelObjective> = makeUpdateBy({
        windowDays: acceptedWindowDayString,
      });

      await expect(callHook("onBeforeUpdate", updateBy)).resolves.toBeDefined();
      expect(updateBy.data.windowDays).toBe(Number(acceptedWindowDayString));
    });
  }

  /*
   * Coercion must not widen the accepted range: garbage and out-of-range
   * strings still have to be rejected, on create and on update alike.
   */
  const rejectedWindowDayStrings: Array<{ label: string; value: unknown }> = [
    { label: "an empty string", value: "" },
    { label: "a whitespace-only string", value: "  " },
    { label: "a non-numeric string", value: "abc" },
    { label: 'the string "0"', value: "0" },
    { label: 'the string "367"', value: "367" },
    { label: "a boolean", value: false },
  ];

  for (const rejectedWindowDayString of rejectedWindowDayStrings) {
    it(`rejects a windowDays of ${rejectedWindowDayString.label} on create`, async () => {
      await expectBadData(
        callHook(
          "onBeforeCreate",
          makeCreateBy({
            projectId: PROJECT_ID,
            targetPercentage: 99.9,
            windowDays: rejectedWindowDayString.value,
          }),
        ),
        WINDOW_DAYS_ERROR_MESSAGE,
      );
    });

    it(`rejects a windowDays of ${rejectedWindowDayString.label} on update`, async () => {
      await expectBadData(
        callHook(
          "onBeforeUpdate",
          makeUpdateBy({ windowDays: rejectedWindowDayString.value }),
        ),
        WINDOW_DAYS_ERROR_MESSAGE,
      );
    });
  }

  const rejectedTargetStrings: Array<{ label: string; value: unknown }> = [
    { label: "an empty string", value: "" },
    { label: "a non-numeric string", value: "abc" },
    { label: 'the string "100"', value: "100" },
  ];

  for (const rejectedTargetString of rejectedTargetStrings) {
    it(`rejects a targetPercentage of ${rejectedTargetString.label} on update`, async () => {
      await expectBadData(
        callHook(
          "onBeforeUpdate",
          makeUpdateBy({ targetPercentage: rejectedTargetString.value }),
        ),
        TARGET_PERCENTAGE_ERROR_MESSAGE,
      );
    });
  }

  const rejectedAtRiskValues: Array<{ label: string; value: unknown }> = [
    { label: "an empty string", value: "" },
    { label: "a non-numeric string", value: "abc" },
    { label: "a negative percentage", value: -1 },
    { label: 'the string "-1"', value: "-1" },
    { label: "above 100", value: 101 },
    { label: 'the string "101"', value: "101" },
    { label: "NaN", value: Number.NaN },
  ];

  for (const rejectedAtRisk of rejectedAtRiskValues) {
    it(`rejects an at-risk threshold of ${rejectedAtRisk.label} on create`, async () => {
      await expectBadData(
        callHook(
          "onBeforeCreate",
          makeCreateBy({
            projectId: PROJECT_ID,
            targetPercentage: 99.9,
            atRiskThresholdPercentage: rejectedAtRisk.value,
          }),
        ),
        AT_RISK_THRESHOLD_ERROR_MESSAGE,
      );
    });

    it(`rejects an at-risk threshold of ${rejectedAtRisk.label} on update`, async () => {
      await expectBadData(
        callHook(
          "onBeforeUpdate",
          makeUpdateBy({ atRiskThresholdPercentage: rejectedAtRisk.value }),
        ),
        AT_RISK_THRESHOLD_ERROR_MESSAGE,
      );
    });
  }

  it("leaves an at-risk threshold of 0 and 100 alone - both ends of the range are meaningful", async () => {
    for (const boundary of [0, 100, "0", "100"]) {
      const createBy: CreateBy<ServiceLevelObjective> = makeCreateBy({
        projectId: PROJECT_ID,
        targetPercentage: 99.9,
        atRiskThresholdPercentage: boundary,
      });

      await expect(callHook("onBeforeCreate", createBy)).resolves.toBeDefined();
      expect(createBy.data.atRiskThresholdPercentage).toBe(Number(boundary));
    }
  });

  it("does not touch a numeric column the payload does not carry", async () => {
    const updateBy: UpdateBy<ServiceLevelObjective> = makeUpdateBy({
      name: "Renamed SLO",
    });

    await expect(callHook("onBeforeUpdate", updateBy)).resolves.toBeDefined();

    expect(updateBy.data.targetPercentage).toBeUndefined();
    expect(updateBy.data.windowDays).toBeUndefined();
    expect(updateBy.data.atRiskThresholdPercentage).toBeUndefined();
  });

  it("leaves an already-numeric payload byte-identical", async () => {
    const createBy: CreateBy<ServiceLevelObjective> = makeCreateBy({
      projectId: PROJECT_ID,
      targetPercentage: 99.9,
      windowDays: 28,
      atRiskThresholdPercentage: 25,
    });

    await expect(callHook("onBeforeCreate", createBy)).resolves.toBeDefined();

    expect(createBy.data.targetPercentage).toBe(99.9);
    expect(createBy.data.windowDays).toBe(28);
    expect(createBy.data.atRiskThresholdPercentage).toBe(25);
  });
});

/*
 * Regression: ServiceLevelObjective must carry @OperationalResource().
 * Two behaviors read `isOperationalResource` off the model prototype and
 * silently no-op without it:
 *
 *   - OwnedScopePermission.addOwnedScopeToQuery returns the query unfiltered
 *     when the model is neither an operational resource nor @OwnedThrough, so
 *     a team granted Read/Edit/DeleteServiceLevelObjective with
 *     PermissionScope.Owned would see every SLO in the project - Owned
 *     degrading to All is a permission leak, not a cosmetic bug,
 *   - DatabaseService.autoOwnerOnCreate skips non-operational models, so the
 *     creating user would never land in ServiceLevelObjectiveOwnerUser and the
 *     @OwnedThrough burn-rate-rule query would resolve to the zero ObjectID.
 *
 * Asserted here because there is no model-decorator test suite to host it.
 */
describe("ServiceLevelObjective model - operational resource marking", () => {
  it("is marked @OperationalResource so Owned scope filters and the creator is auto-owned", () => {
    expect(new ServiceLevelObjective().isOperationalResource).toBe(true);
  });

  it("has owner tables registered for the auto-owner-on-create path", () => {
    /*
     * autoOwnerOnCreate looks the model up in OwnerTableRegistry by
     * `this.modelType.name`, so the decorator alone is not enough - the
     * registry entry has to exist under exactly this key.
     */
    expect(ServiceLevelObjective.name).toBe("ServiceLevelObjective");
    expect(OwnerTableRegistry.get("ServiceLevelObjective")).toBeDefined();
    expect(OwnerTableRegistry.get("ServiceLevelObjective")!.fkColumn).toBe(
      "serviceLevelObjectiveId",
    );
  });
});

describe("ServiceLevelObjectiveService.onBeforeCreate - downtime status defaulting", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("defaults downtimeMonitorStatuses to the project's non-operational statuses", async () => {
    const operational: MonitorStatus = makeMonitorStatus(true, "Operational");
    const degraded: MonitorStatus = makeMonitorStatus(false, "Degraded");
    const down: MonitorStatus = makeMonitorStatus(false, "Down");

    const findBySpy: jest.SpyInstance = jest
      .spyOn(MonitorStatusService, "findBy")
      .mockResolvedValue([operational, degraded, down]);

    const createBy: CreateBy<ServiceLevelObjective> = makeCreateBy({
      projectId: PROJECT_ID,
      targetPercentage: 99.9,
    });

    await callHook("onBeforeCreate", createBy);

    expect(createBy.data.downtimeMonitorStatuses).toEqual([degraded, down]);
    expect(createBy.data.downtimeMonitorStatuses).not.toContain(operational);

    const findByArg: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    } = findBySpy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    };

    // Scoped to the project, and it must read isOperationalState to filter on it.
    expect(findByArg.query).toEqual({ projectId: PROJECT_ID });
    expect(findByArg.select).toEqual({ _id: true, isOperationalState: true });
    expect(findByArg.props).toEqual({ isRoot: true });
  });

  it("defaults to an empty list when every project status is operational", async () => {
    jest
      .spyOn(MonitorStatusService, "findBy")
      .mockResolvedValue([makeMonitorStatus(true, "Operational")]);

    const createBy: CreateBy<ServiceLevelObjective> = makeCreateBy({
      projectId: PROJECT_ID,
      targetPercentage: 99.9,
    });

    await callHook("onBeforeCreate", createBy);

    expect(createBy.data.downtimeMonitorStatuses).toEqual([]);
  });

  it("leaves an explicitly chosen set of downtime statuses untouched", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(MonitorStatusService, "findBy")
      .mockResolvedValue([makeMonitorStatus(false, "Down")]);

    const chosen: MonitorStatus = makeMonitorStatus(false, "Offline");
    const createBy: CreateBy<ServiceLevelObjective> = makeCreateBy({
      projectId: PROJECT_ID,
      targetPercentage: 99.9,
      downtimeMonitorStatuses: [chosen],
    });

    await callHook("onBeforeCreate", createBy);

    expect(createBy.data.downtimeMonitorStatuses).toEqual([chosen]);
    expect(findBySpy).not.toHaveBeenCalled();
  });

  it("keeps an explicitly empty downtime status list, rather than re-defaulting it", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(MonitorStatusService, "findBy")
      .mockResolvedValue([makeMonitorStatus(false, "Down")]);

    const createBy: CreateBy<ServiceLevelObjective> = makeCreateBy({
      projectId: PROJECT_ID,
      targetPercentage: 99.9,
      downtimeMonitorStatuses: [],
    });

    await callHook("onBeforeCreate", createBy);

    expect(createBy.data.downtimeMonitorStatuses).toEqual([]);
    expect(findBySpy).not.toHaveBeenCalled();
  });
});

describe("ServiceLevelObjectiveService.onCreateSuccess - burn rate rule seeding math", () => {
  let burnRateRuleCreateSpy: jest.SpyInstance;
  let updateOneByIdSpy: jest.SpyInstance;

  beforeEach(() => {
    updateOneByIdSpy = jest
      .spyOn(ServiceLevelObjectiveService, "updateOneById")
      .mockResolvedValue(1);

    const severity: AlertSeverity = new AlertSeverity();
    severity._id = SEVERITY_ID.toString();
    severity.id = SEVERITY_ID;

    jest.spyOn(AlertSeverityService, "findOneBy").mockResolvedValue(severity);

    burnRateRuleCreateSpy = jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "create")
      .mockResolvedValue(makeBurnRateRule(RULE_ID));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function seededRules(): Array<ServiceLevelObjectiveBurnRateRule> {
    return burnRateRuleCreateSpy.mock.calls.map((call: Array<unknown>) => {
      return (call[0] as CreateBy<ServiceLevelObjectiveBurnRateRule>).data;
    });
  }

  async function runOnCreateSuccess(fields: SloFields): Promise<void> {
    const createdItem: ServiceLevelObjective = makeSlo({
      _id: SLO_ID.toString(),
      id: SLO_ID,
      projectId: PROJECT_ID,
      ...fields,
    });

    const onCreate: OnCreate<ServiceLevelObjective> = {
      createBy: makeCreateBy({ projectId: PROJECT_ID, targetPercentage: 99.9 }),
      carryForward: null,
    };

    await callHook("onCreateSuccess", onCreate, createdItem);
  }

  /*
   * Thresholds are the documented formula evaluated by hand:
   *   fast = round2(0.02 * windowHours / 1)
   *   slow = round2(0.05 * windowHours / 6)
   * Hard-coded numbers on purpose - re-deriving the formula in the test would
   * not catch a change to the formula itself.
   */
  const seedingCases: Array<{
    label: string;
    fields: SloFields;
    windowHours: number;
    fastBurnThreshold: number;
    slowBurnThreshold: number;
  }> = [
    {
      label: "a 30 day rolling window reproduces the textbook 14.4x and 6x",
      fields: { windowType: SloWindowType.Rolling, windowDays: 30 },
      windowHours: 720,
      fastBurnThreshold: 14.4,
      slowBurnThreshold: 6,
    },
    {
      label: "a 7 day rolling window scales down to 3.36x and 1.4x",
      fields: { windowType: SloWindowType.Rolling, windowDays: 7 },
      windowHours: 168,
      fastBurnThreshold: 3.36,
      slowBurnThreshold: 1.4,
    },
    {
      label: "a 28 day rolling window scales to 13.44x and 5.6x",
      fields: { windowType: SloWindowType.Rolling, windowDays: 28 },
      windowHours: 672,
      fastBurnThreshold: 13.44,
      slowBurnThreshold: 5.6,
    },
    {
      label: "a 90 day rolling window scales up to 43.2x and 18x",
      fields: { windowType: SloWindowType.Rolling, windowDays: 90 },
      windowHours: 2160,
      fastBurnThreshold: 43.2,
      slowBurnThreshold: 18,
    },
    {
      label: "a rolling window with no windowDays falls back to 30 days",
      fields: { windowType: SloWindowType.Rolling },
      windowHours: 720,
      fastBurnThreshold: 14.4,
      slowBurnThreshold: 6,
    },
    {
      label: "a CalendarMonth window uses a flat 720 hours",
      fields: { windowType: SloWindowType.CalendarMonth },
      windowHours: 720,
      fastBurnThreshold: 14.4,
      slowBurnThreshold: 6,
    },
    {
      label: "a CalendarMonth window ignores a stale windowDays column",
      fields: { windowType: SloWindowType.CalendarMonth, windowDays: 7 },
      windowHours: 720,
      fastBurnThreshold: 14.4,
      slowBurnThreshold: 6,
    },
  ];

  for (const seedingCase of seedingCases) {
    it(`seeds Fast burn and Slow burn so that ${seedingCase.label}`, async () => {
      await runOnCreateSuccess(seedingCase.fields);

      const rules: Array<ServiceLevelObjectiveBurnRateRule> = seededRules();
      expect(rules).toHaveLength(2);

      const fastBurn: ServiceLevelObjectiveBurnRateRule = rules[0]!;
      expect(fastBurn.name).toBe("Fast burn");
      expect(fastBurn.burnRateThreshold).toBe(seedingCase.fastBurnThreshold);
      expect(fastBurn.longWindowInMinutes).toBe(60);
      expect(fastBurn.shortWindowInMinutes).toBe(5);

      const slowBurn: ServiceLevelObjectiveBurnRateRule = rules[1]!;
      expect(slowBurn.name).toBe("Slow burn");
      expect(slowBurn.burnRateThreshold).toBe(seedingCase.slowBurnThreshold);
      expect(slowBurn.longWindowInMinutes).toBe(360);
      expect(slowBurn.shortWindowInMinutes).toBe(30);
    });
  }

  /*
   * The seeder sets NEITHER output flag, so both rules take the column
   * defaults - shouldCreateAlert true, shouldCreateIncident false. That
   * omission is the whole safety property of the incident feature: an existing
   * install that upgrades keeps seeding alert-only rules, and OneUptime never
   * starts declaring Incidents on a user's behalf until they turn it on
   * themselves. Asserting the ABSENCE of the keys (not `false`) is deliberate:
   * an explicit false here would still be the seeder taking a position on a
   * column whose default already says it.
   */
  it("seeds rules that carry neither output flag, so an upgrade never starts declaring incidents", async () => {
    await runOnCreateSuccess({
      windowType: SloWindowType.Rolling,
      windowDays: 30,
    });

    const rules: Array<ServiceLevelObjectiveBurnRateRule> = seededRules();
    expect(rules).toHaveLength(2);

    for (const rule of rules) {
      expect(rule.shouldCreateIncident).toBeUndefined();
      expect(rule.shouldCreateAlert).toBeUndefined();

      // And no incident wiring either - severity or on-call policies.
      expect(rule.incidentSeverityId).toBeUndefined();
      expect(rule.incidentOnCallDutyPolicies).toBeUndefined();
    }
  });

  it("keeps every seeded threshold rounded to two decimals", async () => {
    // 0.02 * 24 * 13 = 6.24 and 0.05 * 24 * 13 / 6 = 2.6 in exact arithmetic.
    await runOnCreateSuccess({
      windowType: SloWindowType.Rolling,
      windowDays: 13,
    });

    const rules: Array<ServiceLevelObjectiveBurnRateRule> = seededRules();
    expect(rules[0]!.burnRateThreshold).toBe(6.24);
    expect(rules[1]!.burnRateThreshold).toBe(2.6);
  });

  it("scopes both seeded rules to the SLO and its project, and enables them", async () => {
    await runOnCreateSuccess({
      windowType: SloWindowType.Rolling,
      windowDays: 30,
    });

    for (const rule of seededRules()) {
      expect(rule.projectId).toEqual(PROJECT_ID);
      expect(rule.serviceLevelObjectiveId).toEqual(SLO_ID);
      expect(rule.isEnabled).toBe(true);
    }

    for (const call of burnRateRuleCreateSpy.mock.calls) {
      const createBy: CreateBy<ServiceLevelObjectiveBurnRateRule> = (
        call as Array<unknown>
      )[0] as CreateBy<ServiceLevelObjectiveBurnRateRule>;
      expect(createBy.props).toEqual({ isRoot: true });
    }
  });

  it("stamps nextEvaluationAt to now so the worker picks the new SLO up immediately", async () => {
    const before: number = Date.now();
    await runOnCreateSuccess({
      windowType: SloWindowType.Rolling,
      windowDays: 30,
    });
    const after: number = Date.now();

    expect(updateOneByIdSpy).toHaveBeenCalledTimes(1);

    const updateArg: {
      id: ObjectID;
      data: { nextEvaluationAt: Date };
      props: Record<string, unknown>;
    } = updateOneByIdSpy.mock.calls[0]![0] as {
      id: ObjectID;
      data: { nextEvaluationAt: Date };
      props: Record<string, unknown>;
    };

    expect(updateArg.id).toEqual(SLO_ID);
    expect(updateArg.props).toEqual({ isRoot: true });
    expect(updateArg.data.nextEvaluationAt.getTime()).toBeGreaterThanOrEqual(
      before,
    );
    expect(updateArg.data.nextEvaluationAt.getTime()).toBeLessThanOrEqual(
      after,
    );
  });

  it("still seeds the rules when stamping nextEvaluationAt fails", async () => {
    updateOneByIdSpy.mockRejectedValue(new Error("db down"));

    await expect(
      runOnCreateSuccess({
        windowType: SloWindowType.Rolling,
        windowDays: 30,
      }),
    ).resolves.toBeUndefined();

    expect(seededRules()).toHaveLength(2);
  });

  it("does not fail the SLO create when seeding a burn rate rule throws", async () => {
    burnRateRuleCreateSpy.mockRejectedValue(
      new BadDataException("burn rule rejected"),
    );

    await expect(
      runOnCreateSuccess({
        windowType: SloWindowType.Rolling,
        windowDays: 30,
      }),
    ).resolves.toBeUndefined();

    // Both rules were still attempted - the first failure does not abort the loop.
    expect(burnRateRuleCreateSpy).toHaveBeenCalledTimes(2);
  });

  /*
   * A transient severity lookup failure must not cost the SLO its burn rate
   * rules: the rules work without a default severity (the worker falls back to
   * the lowest order severity when it raises the alert), and nothing retries
   * seeding, so losing them here would leave the SLO silently unalertable.
   */
  it("still seeds both burn rate rules when the severity lookup throws", async () => {
    jest
      .spyOn(AlertSeverityService, "findOneBy")
      .mockRejectedValue(new Error("severity lookup exploded"));

    await expect(
      runOnCreateSuccess({
        windowType: SloWindowType.Rolling,
        windowDays: 30,
      }),
    ).resolves.toBeUndefined();

    expect(burnRateRuleCreateSpy).toHaveBeenCalledTimes(2);

    for (const call of burnRateRuleCreateSpy.mock.calls) {
      expect(
        (call[0] as { data: ServiceLevelObjectiveBurnRateRule }).data
          .alertSeverityId,
      ).toBeUndefined();
    }
  });

  it("returns the created item unchanged", async () => {
    const createdItem: ServiceLevelObjective = makeSlo({
      _id: SLO_ID.toString(),
      id: SLO_ID,
      projectId: PROJECT_ID,
      windowType: SloWindowType.Rolling,
      windowDays: 30,
    });

    const returned: unknown = await callHook(
      "onCreateSuccess",
      { createBy: makeCreateBy({}), carryForward: null },
      createdItem,
    );

    expect(returned).toBe(createdItem);
  });

  it("skips seeding entirely when the created row has no id or projectId", async () => {
    const createdItem: ServiceLevelObjective = makeSlo({
      projectId: PROJECT_ID,
      windowType: SloWindowType.Rolling,
      windowDays: 30,
    });

    await callHook(
      "onCreateSuccess",
      { createBy: makeCreateBy({}), carryForward: null },
      createdItem,
    );

    expect(burnRateRuleCreateSpy).not.toHaveBeenCalled();
  });
});

describe("ServiceLevelObjectiveService.onCreateSuccess - default alert severity", () => {
  let burnRateRuleCreateSpy: jest.SpyInstance;

  beforeEach(() => {
    jest
      .spyOn(ServiceLevelObjectiveService, "updateOneById")
      .mockResolvedValue(1);

    burnRateRuleCreateSpy = jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "create")
      .mockResolvedValue(makeBurnRateRule(RULE_ID));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function runOnCreateSuccess(): Promise<void> {
    const createdItem: ServiceLevelObjective = makeSlo({
      _id: SLO_ID.toString(),
      id: SLO_ID,
      projectId: PROJECT_ID,
      windowType: SloWindowType.Rolling,
      windowDays: 30,
    });

    await callHook(
      "onCreateSuccess",
      { createBy: makeCreateBy({}), carryForward: null },
      createdItem,
    );
  }

  it("picks the project's lowest-order (most severe) severity for both rules", async () => {
    const severity: AlertSeverity = new AlertSeverity();
    severity._id = SEVERITY_ID.toString();
    severity.id = SEVERITY_ID;

    const findOneBySpy: jest.SpyInstance = jest
      .spyOn(AlertSeverityService, "findOneBy")
      .mockResolvedValue(severity);

    await runOnCreateSuccess();

    const findOneByArg: {
      query: Record<string, unknown>;
      sort: Record<string, unknown>;
      props: Record<string, unknown>;
    } = findOneBySpy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      sort: Record<string, unknown>;
      props: Record<string, unknown>;
    };

    expect(findOneByArg.query).toEqual({ projectId: PROJECT_ID });
    expect(findOneByArg.sort).toEqual({ order: SortOrder.Ascending });
    expect(findOneByArg.props).toEqual({ isRoot: true });

    // Looked up once for the pair, not once per rule.
    expect(findOneBySpy).toHaveBeenCalledTimes(1);

    for (const call of burnRateRuleCreateSpy.mock.calls) {
      const createBy: CreateBy<ServiceLevelObjectiveBurnRateRule> = (
        call as Array<unknown>
      )[0] as CreateBy<ServiceLevelObjectiveBurnRateRule>;
      expect(createBy.data.alertSeverityId).toEqual(SEVERITY_ID);
    }
  });

  it("still seeds both rules with no severity when the project has none", async () => {
    jest.spyOn(AlertSeverityService, "findOneBy").mockResolvedValue(null);

    await expect(runOnCreateSuccess()).resolves.toBeUndefined();

    expect(burnRateRuleCreateSpy).toHaveBeenCalledTimes(2);

    for (const call of burnRateRuleCreateSpy.mock.calls) {
      const createBy: CreateBy<ServiceLevelObjectiveBurnRateRule> = (
        call as Array<unknown>
      )[0] as CreateBy<ServiceLevelObjectiveBurnRateRule>;
      expect(createBy.data.alertSeverityId).toBeUndefined();
    }
  });
});

describe("ServiceLevelObjectiveService.onUpdateSuccess", () => {
  let resolveAlertsAndIncidentsSpy: jest.SpyInstance;
  let updateOneByIdSpy: jest.SpyInstance;
  let findOneByIdSpy: jest.SpyInstance;

  beforeEach(() => {
    resolveAlertsAndIncidentsSpy = jest
      .spyOn(
        ServiceLevelObjectiveService,
        "resolveOpenBurnRateAlertsAndIncidentsForSlo",
      )
      .mockResolvedValue(undefined);

    updateOneByIdSpy = jest
      .spyOn(ServiceLevelObjectiveService, "updateOneById")
      .mockResolvedValue(1);

    findOneByIdSpy = jest
      .spyOn(ServiceLevelObjectiveService, "findOneById")
      .mockResolvedValue(makeSlo({ projectId: PROJECT_ID }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("resolves the open burn rate alerts and incidents of every SLO that was just disabled", async () => {
    await callHook("onUpdateSuccess", makeOnUpdate({ isEnabled: false }), [
      SLO_ID,
      OTHER_RULE_ID,
    ]);

    expect(resolveAlertsAndIncidentsSpy).toHaveBeenCalledTimes(2);
    expect(resolveAlertsAndIncidentsSpy).toHaveBeenNthCalledWith(1, {
      sloId: SLO_ID,
      projectId: PROJECT_ID,
    });
    expect(resolveAlertsAndIncidentsSpy).toHaveBeenNthCalledWith(2, {
      sloId: OTHER_RULE_ID,
      projectId: PROJECT_ID,
    });
  });

  it("does not resolve anything when the SLO is being enabled", async () => {
    await callHook("onUpdateSuccess", makeOnUpdate({ isEnabled: true }), [
      SLO_ID,
    ]);

    expect(resolveAlertsAndIncidentsSpy).not.toHaveBeenCalled();
  });

  it("skips resolution for a disabled SLO row it cannot re-read", async () => {
    findOneByIdSpy.mockResolvedValue(null);

    await callHook("onUpdateSuccess", makeOnUpdate({ isEnabled: false }), [
      SLO_ID,
    ]);

    expect(resolveAlertsAndIncidentsSpy).not.toHaveBeenCalled();
  });

  /*
   * resolveOpenBurnRateAlertsAndIncidentsForSlo rethrows now, so that the
   * worker's guard path can decline to commit its new status and retry next
   * tick. This hook deliberately does NOT inherit that: it owns its own
   * try/catch so a dead Alert or Incident service cannot fail the update that
   * disabled the SLO - the disable is the user's edit, and refusing it would
   * be worse than a stale open record. Pinned so the propagation change stays
   * confined to the worker's caller.
   */
  it("swallows a throwing resolve for one disabled SLO and still handles the rest", async () => {
    resolveAlertsAndIncidentsSpy
      .mockRejectedValueOnce(new Error("alert service down"))
      .mockResolvedValueOnce(undefined);

    await expect(
      callHook("onUpdateSuccess", makeOnUpdate({ isEnabled: false }), [
        SLO_ID,
        OTHER_RULE_ID,
      ]),
    ).resolves.toBeDefined();

    expect(resolveAlertsAndIncidentsSpy).toHaveBeenCalledTimes(2);
  });

  it("swallows a throwing resolve even when the disabled SLO is the only one", async () => {
    resolveAlertsAndIncidentsSpy.mockRejectedValue(
      new Error("incident state timeline write failed"),
    );

    const onUpdate: OnUpdate<ServiceLevelObjective> = makeOnUpdate({
      isEnabled: false,
    });

    // Still returns the onUpdate it was handed, so the update itself lands.
    await expect(callHook("onUpdateSuccess", onUpdate, [SLO_ID])).resolves.toBe(
      onUpdate,
    );
  });

  const evaluationConfigFields: Array<{ label: string; data: SloFields }> = [
    { label: "targetPercentage", data: { targetPercentage: 99.5 } },
    { label: "windowDays", data: { windowDays: 7 } },
    {
      label: "windowType",
      data: { windowType: SloWindowType.CalendarMonth },
    },
    { label: "monitors", data: { monitors: [] } },
  ];

  async function expectForcedReEvaluation(data: SloFields): Promise<void> {
    const before: number = Date.now();
    await callHook("onUpdateSuccess", makeOnUpdate(data), [SLO_ID]);
    const after: number = Date.now();

    expect(updateOneByIdSpy).toHaveBeenCalledTimes(1);

    const updateArg: {
      id: ObjectID;
      data: { nextEvaluationAt: Date };
      props: Record<string, unknown>;
    } = updateOneByIdSpy.mock.calls[0]![0] as {
      id: ObjectID;
      data: { nextEvaluationAt: Date };
      props: Record<string, unknown>;
    };

    expect(updateArg.id).toEqual(SLO_ID);
    expect(updateArg.props).toEqual({ isRoot: true });
    expect(updateArg.data.nextEvaluationAt.getTime()).toBeGreaterThanOrEqual(
      before,
    );
    expect(updateArg.data.nextEvaluationAt.getTime()).toBeLessThanOrEqual(
      after,
    );
  }

  for (const evaluationConfigField of evaluationConfigFields) {
    it(`forces re-evaluation when ${evaluationConfigField.label} changes`, async () => {
      await expectForcedReEvaluation(evaluationConfigField.data);
    });
  }

  it("forces re-evaluation for every updated SLO id, not just the first", async () => {
    await callHook("onUpdateSuccess", makeOnUpdate({ windowDays: 90 }), [
      SLO_ID,
      OTHER_RULE_ID,
    ]);

    expect(updateOneByIdSpy).toHaveBeenCalledTimes(2);
  });

  it("neither resolves records nor forces re-evaluation for an unrelated field change", async () => {
    await callHook(
      "onUpdateSuccess",
      makeOnUpdate({ description: "just a doc tweak" }),
      [SLO_ID],
    );

    expect(resolveAlertsAndIncidentsSpy).not.toHaveBeenCalled();
    expect(updateOneByIdSpy).not.toHaveBeenCalled();
  });

  it("swallows a failed re-evaluation stamp instead of failing the update", async () => {
    updateOneByIdSpy.mockRejectedValue(new Error("db down"));

    await expect(
      callHook("onUpdateSuccess", makeOnUpdate({ targetPercentage: 99.5 }), [
        SLO_ID,
      ]),
    ).resolves.toBeDefined();
  });

  it("both resolves records and forces re-evaluation when a disable is bundled with a config change", async () => {
    await callHook(
      "onUpdateSuccess",
      makeOnUpdate({ isEnabled: false, windowDays: 7 }),
      [SLO_ID],
    );

    expect(resolveAlertsAndIncidentsSpy).toHaveBeenCalledTimes(1);
    expect(updateOneByIdSpy).toHaveBeenCalledTimes(1);
  });

  it("returns the onUpdate it was given", async () => {
    const onUpdate: OnUpdate<ServiceLevelObjective> = makeOnUpdate({
      name: "unchanged",
    });

    const returned: unknown = await callHook("onUpdateSuccess", onUpdate, [
      SLO_ID,
    ]);

    expect(returned).toBe(onUpdate);
  });
});

describe("ServiceLevelObjectiveService.onBeforeDelete", () => {
  let resolveAlertsAndIncidentsSpy: jest.SpyInstance;
  let findBySpy: jest.SpyInstance;

  beforeEach(() => {
    resolveAlertsAndIncidentsSpy = jest
      .spyOn(
        ServiceLevelObjectiveService,
        "resolveOpenBurnRateAlertsAndIncidentsForSlo",
      )
      .mockResolvedValue(undefined);

    findBySpy = jest.spyOn(ServiceLevelObjectiveService, "findBy");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function makeDeleteBy(): DeleteBy<ServiceLevelObjective> {
    return {
      query: { projectId: PROJECT_ID },
      props: { isRoot: true },
      limit: 10,
      skip: 0,
    } as unknown as DeleteBy<ServiceLevelObjective>;
  }

  it("resolves the open burn rate alerts and incidents of every SLO about to be deleted", async () => {
    const first: ServiceLevelObjective = makeSlo({
      _id: SLO_ID.toString(),
      id: SLO_ID,
      projectId: PROJECT_ID,
    });
    const second: ServiceLevelObjective = makeSlo({
      _id: OTHER_RULE_ID.toString(),
      id: OTHER_RULE_ID,
      projectId: PROJECT_ID,
    });

    findBySpy.mockResolvedValue([first, second]);

    const result: unknown = await callHook("onBeforeDelete", makeDeleteBy());

    expect(resolveAlertsAndIncidentsSpy).toHaveBeenCalledTimes(2);
    expect(resolveAlertsAndIncidentsSpy).toHaveBeenNthCalledWith(1, {
      sloId: SLO_ID,
      projectId: PROJECT_ID,
    });
    expect(resolveAlertsAndIncidentsSpy).toHaveBeenNthCalledWith(2, {
      sloId: OTHER_RULE_ID,
      projectId: PROJECT_ID,
    });

    // The rows are carried forward so onDeleteSuccess can still see them.
    expect(
      (result as { carryForward: { itemsToDelete: Array<unknown> } })
        .carryForward.itemsToDelete,
    ).toEqual([first, second]);
  });

  it("looks the rows up as root with the caller's own delete query", async () => {
    findBySpy.mockResolvedValue([]);

    await callHook("onBeforeDelete", makeDeleteBy());

    const findByArg: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    } = findBySpy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    };

    expect(findByArg.query).toEqual({ projectId: PROJECT_ID });
    expect(findByArg.select).toEqual({ _id: true, projectId: true });
    expect(findByArg.props).toEqual({ isRoot: true });
  });

  it("skips rows that came back without an id or a projectId", async () => {
    findBySpy.mockResolvedValue([
      makeSlo({ projectId: PROJECT_ID }),
      makeSlo({ _id: SLO_ID.toString(), id: SLO_ID }),
    ]);

    await callHook("onBeforeDelete", makeDeleteBy());

    expect(resolveAlertsAndIncidentsSpy).not.toHaveBeenCalled();
  });

  /*
   * The rule-level resolve propagates its failure now, but a delete the user
   * asked for must still go through: the hook's own try/catch is what keeps
   * "the Alert service is down" from making SLOs undeletable. It also has to
   * keep going, or one unreachable project would strand every later row's
   * records in the same delete.
   */
  it("does not block the delete when the now-propagating resolve throws", async () => {
    findBySpy.mockResolvedValue([
      makeSlo({ _id: SLO_ID.toString(), id: SLO_ID, projectId: PROJECT_ID }),
      makeSlo({
        _id: OTHER_RULE_ID.toString(),
        id: OTHER_RULE_ID,
        projectId: PROJECT_ID,
      }),
    ]);
    resolveAlertsAndIncidentsSpy.mockRejectedValue(
      new Error("alert service down"),
    );

    await expect(
      callHook("onBeforeDelete", makeDeleteBy()),
    ).resolves.toBeDefined();

    expect(resolveAlertsAndIncidentsSpy).toHaveBeenCalledTimes(2);
  });
});

describe("ServiceLevelObjectiveService.resolveOpenBurnRateAlertsAndIncidentsForSlo", () => {
  /*
   * The clear that follows each rule's resolve writes to the database through
   * the hookless column path, so every test in here has to stub it or it
   * reaches a connection that does not exist. The two tests that are ABOUT
   * the clear re-spy on it to assert; the rest just need it silent.
   */
  beforeEach(() => {
    jest
      .spyOn(
        ServiceLevelObjectiveBurnRateRuleService,
        "clearOpenOutputStateForRule",
      )
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * The rule-level resolver always runs BOTH passes, so any test that lets it
   * run for real has to give the incident pass something to find - otherwise
   * it would reach the real IncidentService.
   */
  function mockNoOpenIncidents(): jest.SpyInstance {
    return jest.spyOn(IncidentService, "findBy").mockResolvedValue([]);
  }

  function mockResolveForRule(): jest.SpyInstance {
    return jest
      .spyOn(
        ServiceLevelObjectiveBurnRateRuleService,
        "resolveOpenAlertsAndIncidentsForRule",
      )
      .mockResolvedValue(undefined);
  }

  function mockClearOutputState(): jest.SpyInstance {
    return jest
      .spyOn(
        ServiceLevelObjectiveBurnRateRuleService,
        "clearOpenOutputStateForRule",
      )
      .mockResolvedValue(undefined);
  }

  function mockRules(
    rules: Array<ServiceLevelObjectiveBurnRateRule>,
  ): jest.SpyInstance {
    return jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy")
      .mockResolvedValue(rules);
  }

  function resolveForSlo(): Promise<void> {
    return ServiceLevelObjectiveService.resolveOpenBurnRateAlertsAndIncidentsForSlo(
      {
        sloId: SLO_ID,
        projectId: PROJECT_ID,
      },
    );
  }

  it("delegates to every burn rate rule of the SLO with the auto-resolve root cause", async () => {
    const ruleFindBySpy: jest.SpyInstance = mockRules([
      makeBurnRateRule(RULE_ID),
      makeBurnRateRule(OTHER_RULE_ID),
    ]);

    const resolveForRuleSpy: jest.SpyInstance = mockResolveForRule();

    await resolveForSlo();

    const ruleFindByArg: { query: Record<string, unknown> } = ruleFindBySpy.mock
      .calls[0]![0] as { query: Record<string, unknown> };
    expect(ruleFindByArg.query).toEqual({
      serviceLevelObjectiveId: SLO_ID,
      projectId: PROJECT_ID,
    });

    expect(resolveForRuleSpy).toHaveBeenCalledTimes(2);

    /*
     * One call per rule covering both outputs - not resolveOpenAlertsForRule.
     * The root cause is deliberately output-neutral ("Auto-resolved...", not
     * "Alert auto-resolved..."), because the same string is stamped onto the
     * Incident timeline as well.
     */
    expect(resolveForRuleSpy).toHaveBeenNthCalledWith(1, {
      serviceLevelObjectiveId: SLO_ID,
      burnRateRuleId: RULE_ID,
      projectId: PROJECT_ID,
      rootCause:
        "Auto-resolved because the Service Level Objective was disabled or deleted.",
    });
    expect(resolveForRuleSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ burnRateRuleId: OTHER_RULE_ID }),
    );
  });

  /*
   * This path deliberately does NOT stamp the resolve columns — they drive a
   * live rule's re-fire suppression, and disabling an SLO is not a burn rate
   * that recovered. But the evaluation worker reads the CREATED columns to
   * decide whether an output is already open, so leaving those set told the
   * worker "an alert is already open" about an alert this very call had just
   * closed: re-enable the SLO mid-outage and the rule declared nothing for
   * the rest of the burn, while the dashboard showed a red "Firing" pill.
   */
  it("forgets what each rule had open, so a re-enabled SLO can declare again", async () => {
    mockRules([makeBurnRateRule(RULE_ID), makeBurnRateRule(OTHER_RULE_ID)]);
    mockResolveForRule();

    const clearSpy: jest.SpyInstance = mockClearOutputState();

    await resolveForSlo();

    expect(clearSpy).toHaveBeenCalledTimes(2);
    expect(clearSpy).toHaveBeenNthCalledWith(1, {
      burnRateRuleId: RULE_ID,
      clearAlert: true,
      clearIncident: true,
    });
    expect(clearSpy).toHaveBeenNthCalledWith(2, {
      burnRateRuleId: OTHER_RULE_ID,
      clearAlert: true,
      clearIncident: true,
    });
  });

  it("does not forget anything for a rule whose resolve threw", async () => {
    mockRules([makeBurnRateRule(RULE_ID)]);

    jest
      .spyOn(
        ServiceLevelObjectiveBurnRateRuleService,
        "resolveOpenAlertsAndIncidentsForRule",
      )
      .mockRejectedValue(new Error("resolve failed"));

    const clearSpy: jest.SpyInstance = mockClearOutputState();
    jest.spyOn(logger, "error").mockImplementation((): void => {});

    await expect(resolveForSlo()).rejects.toThrow("resolve failed");

    /*
     * The record is still open. Clearing the rule's columns would make the
     * worker declare a second one on top of it.
     */
    expect(clearSpy).not.toHaveBeenCalled();
  });

  /*
   * Why the failure has to PROPAGATE, not just get logged:
   *
   * the evaluation worker's Paused / Misconfigured guard calls this and only
   * commits the SLO's new status once it comes back clean, precisely so that a
   * failed resolve leaves the old status in place and the next tick retries
   * the whole transition. While this method swallowed the error the guard saw
   * a success, committed the status, and the next tick found no transition
   * left to make - the Alert and the Incident stayed open with their on-call
   * escalations running, and nothing ever retried them. The record was
   * stranded for good.
   *
   * The loop still has to attempt every rule first, though: one unreachable
   * rule must not stop the SLO's other rules from being closed. So the shape
   * is "try all, remember the first failure, rethrow at the end".
   */
  it("attempts every rule, logs the failure, and then rejects with the error the failing rule threw", async () => {
    mockRules([
      makeBurnRateRule(RULE_ID),
      makeBurnRateRule(OTHER_RULE_ID),
      makeBurnRateRule(THIRD_RULE_ID),
    ]);

    const failure: Error = new Error("alert state timeline write failed");

    const resolveForRuleSpy: jest.SpyInstance = jest
      .spyOn(
        ServiceLevelObjectiveBurnRateRuleService,
        "resolveOpenAlertsAndIncidentsForRule",
      )
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined);

    const loggerErrorSpy: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {});

    await expect(resolveForSlo()).rejects.toBe(failure);

    // The middle rule failing did not abort the loop - the third still ran.
    expect(resolveForRuleSpy).toHaveBeenCalledTimes(3);

    // And the operator still gets the per-rule context the rethrow cannot carry.
    expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
    expect(String(loggerErrorSpy.mock.calls[0]![0])).toContain(
      OTHER_RULE_ID.toString(),
    );
  });

  /*
   * The FIRST error, not the last. The caller retries the whole SLO either
   * way, but surfacing whatever happened to fail last would bury the original
   * cause behind a downstream symptom.
   */
  it("rejects with the first error when more than one rule fails", async () => {
    mockRules([
      makeBurnRateRule(RULE_ID),
      makeBurnRateRule(OTHER_RULE_ID),
      makeBurnRateRule(THIRD_RULE_ID),
    ]);

    const firstFailure: Error = new Error("first rule exploded");
    const lastFailure: Error = new Error("third rule exploded");

    const resolveForRuleSpy: jest.SpyInstance = jest
      .spyOn(
        ServiceLevelObjectiveBurnRateRuleService,
        "resolveOpenAlertsAndIncidentsForRule",
      )
      .mockRejectedValueOnce(firstFailure)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(lastFailure);

    jest.spyOn(logger, "error").mockImplementation((): void => {});

    await expect(resolveForSlo()).rejects.toBe(firstFailure);

    expect(resolveForRuleSpy).toHaveBeenCalledTimes(3);
  });

  it("resolves without throwing when no rule fails", async () => {
    mockRules([makeBurnRateRule(RULE_ID), makeBurnRateRule(OTHER_RULE_ID)]);

    const resolveForRuleSpy: jest.SpyInstance = mockResolveForRule();

    await expect(resolveForSlo()).resolves.toBeUndefined();

    expect(resolveForRuleSpy).toHaveBeenCalledTimes(2);
  });

  /*
   * A row with no id is SKIPPED, not failed: `continue` must never touch the
   * remembered error. Counting it as a failure would make a wholly successful
   * pass reject, and the worker would then retry the same SLO forever.
   */
  it("skips a rule row that came back without an id, and does not count it as a failure", async () => {
    mockRules([
      new ServiceLevelObjectiveBurnRateRule(),
      makeBurnRateRule(RULE_ID),
    ]);

    const resolveForRuleSpy: jest.SpyInstance = mockResolveForRule();

    await expect(resolveForSlo()).resolves.toBeUndefined();

    expect(resolveForRuleSpy).toHaveBeenCalledTimes(1);
    expect(resolveForRuleSpy).toHaveBeenCalledWith(
      expect.objectContaining({ burnRateRuleId: RULE_ID }),
    );
  });

  it("resolves cleanly when every rule row lacks an id", async () => {
    mockRules([
      new ServiceLevelObjectiveBurnRateRule(),
      new ServiceLevelObjectiveBurnRateRule(),
    ]);

    const resolveForRuleSpy: jest.SpyInstance = mockResolveForRule();

    await expect(resolveForSlo()).resolves.toBeUndefined();

    expect(resolveForRuleSpy).not.toHaveBeenCalled();
  });

  it("is a no-op when the SLO has no burn rate rules", async () => {
    mockRules([]);

    const resolveForRuleSpy: jest.SpyInstance = mockResolveForRule();

    await expect(resolveForSlo()).resolves.toBeUndefined();

    expect(resolveForRuleSpy).not.toHaveBeenCalled();
  });

  /*
   * Straight through the real rule-level resolver: the fingerprint is the only
   * thing tying an SLO's rule to the records it opened, so one wrong character
   * turns the disable path into a silent no-op. Both tables are keyed off the
   * SAME fingerprint - one rule, one series.
   */
  it("queries the open alerts and the open incidents of each rule by that rule's exact fingerprint", async () => {
    mockRules([makeBurnRateRule(RULE_ID)]);

    const alertFindBySpy: jest.SpyInstance = jest
      .spyOn(AlertService, "findBy")
      .mockResolvedValue([makeAlert(ObjectID.generate())]);

    jest
      .spyOn(AlertStateTimelineService, "getResolvedStateIdForProject")
      .mockResolvedValue(RESOLVED_STATE_ID);

    const alertTimelineCreateSpy: jest.SpyInstance = jest
      .spyOn(AlertStateTimelineService, "create")
      .mockResolvedValue(new AlertStateTimeline());

    const incidentFindBySpy: jest.SpyInstance = jest
      .spyOn(IncidentService, "findBy")
      .mockResolvedValue([makeIncident(ObjectID.generate())]);

    jest
      .spyOn(IncidentStateTimelineService, "getResolvedStateIdForProject")
      .mockResolvedValue(RESOLVED_INCIDENT_STATE_ID);

    const incidentTimelineCreateSpy: jest.SpyInstance = jest
      .spyOn(IncidentStateTimelineService, "create")
      .mockResolvedValue(new IncidentStateTimeline());

    await resolveForSlo();

    const fingerprint: string = `slo:${SLO_ID.toString()}:burn-rule:${RULE_ID.toString()}`;

    const alertFindByArg: { query: Record<string, unknown> } = alertFindBySpy
      .mock.calls[0]![0] as { query: Record<string, unknown> };
    expect(alertFindByArg.query).toEqual({
      projectId: PROJECT_ID,
      seriesFingerprint: fingerprint,
      currentAlertState: { isResolvedState: false },
    });

    const incidentFindByArg: { query: Record<string, unknown> } =
      incidentFindBySpy.mock.calls[0]![0] as {
        query: Record<string, unknown>;
      };
    expect(incidentFindByArg.query).toEqual({
      projectId: PROJECT_ID,
      seriesFingerprint: fingerprint,
      currentIncidentState: { isResolvedState: false },
    });

    // And both actually resolved, through their own state timeline tables.
    expect(alertTimelineCreateSpy).toHaveBeenCalledTimes(1);
    const alertTimelineArg: {
      data: { alertStateId: ObjectID; rootCause: string };
    } = alertTimelineCreateSpy.mock.calls[0]![0] as {
      data: { alertStateId: ObjectID; rootCause: string };
    };
    expect(alertTimelineArg.data.alertStateId).toEqual(RESOLVED_STATE_ID);
    expect(alertTimelineArg.data.rootCause).toContain(
      "Service Level Objective was disabled or deleted",
    );

    expect(incidentTimelineCreateSpy).toHaveBeenCalledTimes(1);
    const incidentTimelineArg: {
      data: { incidentStateId: ObjectID; rootCause: string };
    } = incidentTimelineCreateSpy.mock.calls[0]![0] as {
      data: { incidentStateId: ObjectID; rootCause: string };
    };
    expect(incidentTimelineArg.data.incidentStateId).toEqual(
      RESOLVED_INCIDENT_STATE_ID,
    );
    expect(incidentTimelineArg.data.rootCause).toContain(
      "Service Level Objective was disabled or deleted",
    );
  });

  it("tolerates the benign same-state race without rethrowing", async () => {
    mockRules([makeBurnRateRule(RULE_ID)]);
    mockNoOpenIncidents();

    jest
      .spyOn(AlertService, "findBy")
      .mockResolvedValue([makeAlert(ObjectID.generate())]);

    jest
      .spyOn(AlertStateTimelineService, "getResolvedStateIdForProject")
      .mockResolvedValue(RESOLVED_STATE_ID);

    jest
      .spyOn(AlertStateTimelineService, "create")
      .mockRejectedValue(
        new BadDataException("Alert state cannot be same as previous state."),
      );

    await expect(resolveForSlo()).resolves.toBeUndefined();
  });

  /*
   * The incident twin of the race above. It matters more now that the SLO-level
   * method rethrows: a benign duplicate-state race leaking out would make the
   * worker's guard refuse to commit and retry the same already-resolved
   * incident on every single tick.
   */
  it("tolerates the benign same-state race on the incident side too", async () => {
    mockRules([makeBurnRateRule(RULE_ID)]);

    jest.spyOn(AlertService, "findBy").mockResolvedValue([]);

    jest
      .spyOn(IncidentService, "findBy")
      .mockResolvedValue([makeIncident(ObjectID.generate())]);

    jest
      .spyOn(IncidentStateTimelineService, "getResolvedStateIdForProject")
      .mockResolvedValue(RESOLVED_INCIDENT_STATE_ID);

    jest
      .spyOn(IncidentStateTimelineService, "create")
      .mockRejectedValue(
        new BadDataException(
          "Incident state cannot be same as previous state.",
        ),
      );

    await expect(resolveForSlo()).resolves.toBeUndefined();
  });

  it("keeps resolving the remaining open alerts when one alert throws, and still reports it", async () => {
    mockRules([makeBurnRateRule(RULE_ID)]);
    mockNoOpenIncidents();

    jest
      .spyOn(AlertService, "findBy")
      .mockResolvedValue([
        makeAlert(ObjectID.generate()),
        makeAlert(ObjectID.generate()),
      ]);

    jest
      .spyOn(AlertStateTimelineService, "getResolvedStateIdForProject")
      .mockResolvedValue(RESOLVED_STATE_ID);

    const timelineCreateSpy: jest.SpyInstance = jest
      .spyOn(AlertStateTimelineService, "create")
      .mockRejectedValueOnce(new Error("write conflict"))
      .mockResolvedValueOnce(new AlertStateTimeline());

    jest.spyOn(logger, "error").mockImplementation((): void => {});

    /*
     * The per-record isolation goes all the way down — the second alert is
     * still resolved — but the failure travels all the way up, so the worker's
     * guard path does not commit a status change that would make this
     * one-shot and strand the first alert forever.
     */
    await expect(resolveForSlo()).rejects.toThrow("write conflict");

    expect(timelineCreateSpy).toHaveBeenCalledTimes(2);
  });
});

describe("ServiceLevelObjectiveService.getDueSlos", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function capturedFindAllByArg(): Promise<{
    query: Record<string, unknown>;
    select: Record<string, unknown>;
    sort: Record<string, unknown>;
    props: Record<string, unknown>;
  }> {
    const findAllBySpy: jest.SpyInstance = jest
      .spyOn(ServiceLevelObjectiveService, "findAllBy")
      .mockResolvedValue([]);

    await ServiceLevelObjectiveService.getDueSlos();

    return findAllBySpy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      sort: Record<string, unknown>;
      props: Record<string, unknown>;
    };
  }

  it("only picks up enabled SLOs in active projects, oldest due first, as root", async () => {
    const arg: {
      query: Record<string, unknown>;
      sort: Record<string, unknown>;
      props: Record<string, unknown>;
    } = await capturedFindAllByArg();

    expect(arg.query["isEnabled"]).toBe(true);
    expect(arg.sort).toEqual({ nextEvaluationAt: SortOrder.Ascending });
    expect(arg.props).toEqual({ isRoot: true });

    const projectQuery: Record<string, unknown> = arg.query[
      "project"
    ] as Record<string, unknown>;

    // Spread of ProjectService.getActiveProjectStatusQuery().
    expect(Object.keys(projectQuery).sort()).toEqual([
      "paymentProviderMeteredSubscriptionStatus",
      "paymentProviderSubscriptionStatus",
    ]);
  });

  it("treats a never-evaluated SLO as due via lessThanEqualToOrNull", async () => {
    const before: number = Date.now();
    const arg: { query: Record<string, unknown> } =
      await capturedFindAllByArg();
    const after: number = Date.now();

    const nextEvaluationAt: {
      type: string;
      getSql: (alias: string) => string;
      objectLiteralParameters: Record<string, Date>;
    } = arg.query["nextEvaluationAt"] as {
      type: string;
      getSql: (alias: string) => string;
      objectLiteralParameters: Record<string, Date>;
    };

    expect(nextEvaluationAt.type).toBe("raw");

    const sql: string = nextEvaluationAt.getSql("nextEvaluationAt");
    expect(sql).toContain("nextEvaluationAt <= :");
    expect(sql).toContain("nextEvaluationAt IS NULL");

    const parameterValues: Array<Date> = Object.values(
      nextEvaluationAt.objectLiteralParameters,
    );
    expect(parameterValues).toHaveLength(1);
    expect(parameterValues[0]!.getTime()).toBeGreaterThanOrEqual(before);
    expect(parameterValues[0]!.getTime()).toBeLessThanOrEqual(after);
  });

  it("selects exactly the columns the evaluation worker consumes", async () => {
    const arg: { select: Record<string, unknown> } =
      await capturedFindAllByArg();

    expect(Object.keys(arg.select).sort()).toEqual(
      [...EXPECTED_DUE_SLO_SELECT_KEYS].sort(),
    );
  });

  it("expands the monitor and downtime-status relations the worker walks", async () => {
    const arg: { select: Record<string, unknown> } =
      await capturedFindAllByArg();

    expect(arg.select["monitors"]).toEqual({ _id: true });
    expect(arg.select["downtimeMonitorStatuses"]).toEqual({ _id: true });
  });
});

describe("ServiceLevelObjectiveService.findOwners", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockOwners(data: {
    ownerUsers: Array<ServiceLevelObjectiveOwnerUser>;
    ownerTeams: Array<ServiceLevelObjectiveOwnerTeam>;
    teamUsers: Array<User>;
  }): jest.SpyInstance {
    jest
      .spyOn(ServiceLevelObjectiveOwnerUserService, "findBy")
      .mockResolvedValue(data.ownerUsers);
    jest
      .spyOn(ServiceLevelObjectiveOwnerTeamService, "findBy")
      .mockResolvedValue(data.ownerTeams);

    return jest
      .spyOn(TeamMemberService, "getUsersInTeams")
      .mockResolvedValue(data.teamUsers);
  }

  function makeOwnerUser(user: User): ServiceLevelObjectiveOwnerUser {
    const ownerUser: ServiceLevelObjectiveOwnerUser =
      new ServiceLevelObjectiveOwnerUser();
    ownerUser._id = ObjectID.generate().toString();
    ownerUser.user = user;
    return ownerUser;
  }

  function makeOwnerTeam(teamId: ObjectID): ServiceLevelObjectiveOwnerTeam {
    const ownerTeam: ServiceLevelObjectiveOwnerTeam =
      new ServiceLevelObjectiveOwnerTeam();
    ownerTeam._id = ObjectID.generate().toString();
    ownerTeam.teamId = teamId;
    return ownerTeam;
  }

  it("requires a service level objective id", async () => {
    await expect(
      ServiceLevelObjectiveService.findOwners(undefined as unknown as ObjectID),
    ).rejects.toThrow(BadDataException);
  });

  it("returns an empty list when the SLO has no owners at all", async () => {
    const getUsersInTeamsSpy: jest.SpyInstance = mockOwners({
      ownerUsers: [],
      ownerTeams: [],
      teamUsers: [],
    });

    await expect(
      ServiceLevelObjectiveService.findOwners(SLO_ID),
    ).resolves.toEqual([]);

    // No teams, so no need to touch the team membership service at all.
    expect(getUsersInTeamsSpy).not.toHaveBeenCalled();
  });

  it("returns the directly assigned owner users", async () => {
    const alice: User = makeUser(ObjectID.generate());
    const bob: User = makeUser(ObjectID.generate());

    mockOwners({
      ownerUsers: [makeOwnerUser(alice), makeOwnerUser(bob)],
      ownerTeams: [],
      teamUsers: [],
    });

    const owners: Array<User> =
      await ServiceLevelObjectiveService.findOwners(SLO_ID);

    expect(owners).toEqual([alice, bob]);
  });

  it("expands owner teams into their members", async () => {
    const carol: User = makeUser(ObjectID.generate());
    const teamId: ObjectID = ObjectID.generate();

    const getUsersInTeamsSpy: jest.SpyInstance = mockOwners({
      ownerUsers: [],
      ownerTeams: [makeOwnerTeam(teamId)],
      teamUsers: [carol],
    });

    const owners: Array<User> =
      await ServiceLevelObjectiveService.findOwners(SLO_ID);

    expect(owners).toEqual([carol]);
    expect(getUsersInTeamsSpy).toHaveBeenCalledWith([teamId]);
  });

  it("dedupes a user who is both a direct owner and a member of an owner team", async () => {
    const sharedId: ObjectID = ObjectID.generate();
    const directOwner: User = makeUser(sharedId);
    const sameUserViaTeam: User = makeUser(sharedId);
    const otherTeamUser: User = makeUser(ObjectID.generate());

    mockOwners({
      ownerUsers: [makeOwnerUser(directOwner)],
      ownerTeams: [makeOwnerTeam(ObjectID.generate())],
      teamUsers: [sameUserViaTeam, otherTeamUser],
    });

    const owners: Array<User> =
      await ServiceLevelObjectiveService.findOwners(SLO_ID);

    expect(owners).toHaveLength(2);
    expect(owners[0]).toBe(directOwner);
    expect(owners[1]).toBe(otherTeamUser);
  });

  it("passes every owner team id to the membership lookup in a single call", async () => {
    const firstTeamId: ObjectID = ObjectID.generate();
    const secondTeamId: ObjectID = ObjectID.generate();

    const getUsersInTeamsSpy: jest.SpyInstance = mockOwners({
      ownerUsers: [],
      ownerTeams: [makeOwnerTeam(firstTeamId), makeOwnerTeam(secondTeamId)],
      teamUsers: [],
    });

    await ServiceLevelObjectiveService.findOwners(SLO_ID);

    expect(getUsersInTeamsSpy).toHaveBeenCalledTimes(1);
    expect(getUsersInTeamsSpy).toHaveBeenCalledWith([
      firstTeamId,
      secondTeamId,
    ]);
  });
});

describe("ServiceLevelObjectiveService.getSloLinkInDashboard", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("builds the dashboard deep link from the project id and the SLO id", async () => {
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(URL.fromString("https://oneuptime.test/dashboard"));

    const link: URL = await ServiceLevelObjectiveService.getSloLinkInDashboard(
      PROJECT_ID,
      SLO_ID,
    );

    expect(link.toString()).toBe(
      `https://oneuptime.test/dashboard/${PROJECT_ID.toString()}/slos/${SLO_ID.toString()}`,
    );
  });

  it("keeps the configured dashboard host, port and protocol", async () => {
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(URL.fromString("http://localhost:3002/dashboard"));

    const link: URL = await ServiceLevelObjectiveService.getSloLinkInDashboard(
      PROJECT_ID,
      SLO_ID,
    );

    expect(link.toString()).toBe(
      `http://localhost:3002/dashboard/${PROJECT_ID.toString()}/slos/${SLO_ID.toString()}`,
    );
  });

  it("places the project id before the slo id so the dashboard router resolves the tenant", async () => {
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(URL.fromString("https://oneuptime.test/dashboard"));

    const link: URL = await ServiceLevelObjectiveService.getSloLinkInDashboard(
      PROJECT_ID,
      SLO_ID,
    );

    const path: string = link.toString();
    expect(path.indexOf(PROJECT_ID.toString())).toBeLessThan(
      path.indexOf(SLO_ID.toString()),
    );
    expect(path).toContain("/slos/");
  });
});

/*
 * The label rule has to be applied by the service that owns the column, not
 * only by the dashboard that sets it: an SLO created or edited over the API
 * must come out carrying the monitors its rule implies. Both hooks are
 * best-effort - a rule that cannot be applied is logged, never allowed to
 * fail the write that triggered it.
 */
describe("ServiceLevelObjectiveService - applying the monitor label rule", () => {
  let syncMonitorsForSloSpy: jest.SpyInstance;

  beforeEach(() => {
    syncMonitorsForSloSpy = jest
      .spyOn(
        ServiceLevelObjectiveMonitorRuleEngineService,
        "syncMonitorsForSlo",
      )
      .mockResolvedValue({ monitorIdsAdded: [], monitorIdsRemoved: [] });

    jest
      .spyOn(ServiceLevelObjectiveService, "updateOneById")
      .mockResolvedValue(1);
    jest
      .spyOn(ServiceLevelObjectiveService, "findOneById")
      .mockResolvedValue(makeSlo({ projectId: PROJECT_ID }));
    jest
      .spyOn(
        ServiceLevelObjectiveService,
        "resolveOpenBurnRateAlertsAndIncidentsForSlo",
      )
      .mockResolvedValue(undefined);
    jest.spyOn(AlertSeverityService, "findOneBy").mockResolvedValue(null);
    jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "create")
      .mockResolvedValue(makeBurnRateRule(RULE_ID));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("runs the rule for a newly created SLO so it is not born with an empty monitor list", async () => {
    const createdItem: ServiceLevelObjective = makeSlo({
      _id: SLO_ID.toString(),
      id: SLO_ID,
      projectId: PROJECT_ID,
      targetPercentage: 99.9,
    });

    await callHook(
      "onCreateSuccess",
      {
        createBy: makeCreateBy({
          projectId: PROJECT_ID,
          targetPercentage: 99.9,
        }),
        carryForward: null,
      },
      createdItem,
    );

    expect(syncMonitorsForSloSpy).toHaveBeenCalledTimes(1);
    expect(syncMonitorsForSloSpy).toHaveBeenCalledWith({
      serviceLevelObjectiveId: SLO_ID,
    });
  });

  it("does not fail the create when the rule cannot be applied", async () => {
    syncMonitorsForSloSpy.mockRejectedValue(new Error("db down"));

    const createdItem: ServiceLevelObjective = makeSlo({
      _id: SLO_ID.toString(),
      id: SLO_ID,
      projectId: PROJECT_ID,
    });

    await expect(
      callHook(
        "onCreateSuccess",
        {
          createBy: makeCreateBy({ projectId: PROJECT_ID }),
          carryForward: null,
        },
        createdItem,
      ),
    ).resolves.toBe(createdItem);
  });

  it("re-runs the rule for every SLO whose rule was just edited", async () => {
    await callHook(
      "onUpdateSuccess",
      makeOnUpdate({ monitorLabels: [{ _id: RULE_ID.toString() }] }),
      [SLO_ID, OTHER_RULE_ID],
    );

    expect(syncMonitorsForSloSpy).toHaveBeenCalledTimes(2);
    expect(syncMonitorsForSloSpy).toHaveBeenNthCalledWith(1, {
      serviceLevelObjectiveId: SLO_ID,
    });
    expect(syncMonitorsForSloSpy).toHaveBeenNthCalledWith(2, {
      serviceLevelObjectiveId: OTHER_RULE_ID,
    });
  });

  it("re-runs the rule when it is cleared, which is what gives the monitors back", async () => {
    await callHook("onUpdateSuccess", makeOnUpdate({ monitorLabels: [] }), [
      SLO_ID,
    ]);

    expect(syncMonitorsForSloSpy).toHaveBeenCalledTimes(1);
  });

  it("leaves the rule alone for an edit that does not touch it", async () => {
    await callHook(
      "onUpdateSuccess",
      makeOnUpdate({ targetPercentage: 99.5 }),
      [SLO_ID],
    );

    expect(syncMonitorsForSloSpy).not.toHaveBeenCalled();
  });

  it("does not fail the update when the rule cannot be applied", async () => {
    syncMonitorsForSloSpy.mockRejectedValue(new Error("db down"));

    await expect(
      callHook("onUpdateSuccess", makeOnUpdate({ monitorLabels: [] }), [
        SLO_ID,
      ]),
    ).resolves.toBeDefined();
  });
});
