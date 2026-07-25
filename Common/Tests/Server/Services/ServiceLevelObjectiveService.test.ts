import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import ServiceLevelObjectiveOwnerTeam from "../../../Models/DatabaseModels/ServiceLevelObjectiveOwnerTeam";
import ServiceLevelObjectiveOwnerUser from "../../../Models/DatabaseModels/ServiceLevelObjectiveOwnerUser";
import User from "../../../Models/DatabaseModels/User";
import AlertService from "../../../Server/Services/AlertService";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import ServiceLevelObjectiveBurnRateRuleService from "../../../Server/Services/ServiceLevelObjectiveBurnRateRuleService";
import ServiceLevelObjectiveOwnerTeamService from "../../../Server/Services/ServiceLevelObjectiveOwnerTeamService";
import ServiceLevelObjectiveOwnerUserService from "../../../Server/Services/ServiceLevelObjectiveOwnerUserService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import OwnerTableRegistry from "../../../Server/Types/Database/Permissions/OwnerTableRegistry";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
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
 *   - disabling or deleting an SLO must resolve the burn-rate alerts it
 *     opened, because the evaluation worker skips SLOs it no longer sees and
 *     would otherwise leave on-call escalations open forever,
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

const TARGET_PERCENTAGE_ERROR_MESSAGE: string =
  "SLO target must be greater than 0 and at most 99.999. A 100% target leaves no error budget.";
const WINDOW_DAYS_ERROR_MESSAGE: string =
  "SLO window must be between 1 and 366 days.";
const AT_RISK_THRESHOLD_ERROR_MESSAGE: string =
  "SLO at-risk threshold must be a percentage between 0 and 100.";

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
      .mockResolvedValue(undefined);

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
      .mockResolvedValue(undefined);

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
  let resolveAlertsSpy: jest.SpyInstance;
  let updateOneByIdSpy: jest.SpyInstance;
  let findOneByIdSpy: jest.SpyInstance;

  beforeEach(() => {
    resolveAlertsSpy = jest
      .spyOn(ServiceLevelObjectiveService, "resolveOpenBurnRateAlertsForSlo")
      .mockResolvedValue(undefined);

    updateOneByIdSpy = jest
      .spyOn(ServiceLevelObjectiveService, "updateOneById")
      .mockResolvedValue(undefined);

    findOneByIdSpy = jest
      .spyOn(ServiceLevelObjectiveService, "findOneById")
      .mockResolvedValue(makeSlo({ projectId: PROJECT_ID }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("resolves the open burn rate alerts of every SLO that was just disabled", async () => {
    await callHook("onUpdateSuccess", makeOnUpdate({ isEnabled: false }), [
      SLO_ID,
      OTHER_RULE_ID,
    ]);

    expect(resolveAlertsSpy).toHaveBeenCalledTimes(2);
    expect(resolveAlertsSpy).toHaveBeenNthCalledWith(1, {
      sloId: SLO_ID,
      projectId: PROJECT_ID,
    });
    expect(resolveAlertsSpy).toHaveBeenNthCalledWith(2, {
      sloId: OTHER_RULE_ID,
      projectId: PROJECT_ID,
    });
  });

  it("does not resolve alerts when the SLO is being enabled", async () => {
    await callHook("onUpdateSuccess", makeOnUpdate({ isEnabled: true }), [
      SLO_ID,
    ]);

    expect(resolveAlertsSpy).not.toHaveBeenCalled();
  });

  it("skips alert resolution for a disabled SLO row it cannot re-read", async () => {
    findOneByIdSpy.mockResolvedValue(null);

    await callHook("onUpdateSuccess", makeOnUpdate({ isEnabled: false }), [
      SLO_ID,
    ]);

    expect(resolveAlertsSpy).not.toHaveBeenCalled();
  });

  it("swallows a failure while resolving alerts for one disabled SLO and continues", async () => {
    resolveAlertsSpy
      .mockRejectedValueOnce(new Error("alert service down"))
      .mockResolvedValueOnce(undefined);

    await expect(
      callHook("onUpdateSuccess", makeOnUpdate({ isEnabled: false }), [
        SLO_ID,
        OTHER_RULE_ID,
      ]),
    ).resolves.toBeDefined();

    expect(resolveAlertsSpy).toHaveBeenCalledTimes(2);
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

  it("neither resolves alerts nor forces re-evaluation for an unrelated field change", async () => {
    await callHook(
      "onUpdateSuccess",
      makeOnUpdate({ description: "just a doc tweak" }),
      [SLO_ID],
    );

    expect(resolveAlertsSpy).not.toHaveBeenCalled();
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

  it("both resolves alerts and forces re-evaluation when a disable is bundled with a config change", async () => {
    await callHook(
      "onUpdateSuccess",
      makeOnUpdate({ isEnabled: false, windowDays: 7 }),
      [SLO_ID],
    );

    expect(resolveAlertsSpy).toHaveBeenCalledTimes(1);
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
  let resolveAlertsSpy: jest.SpyInstance;
  let findBySpy: jest.SpyInstance;

  beforeEach(() => {
    resolveAlertsSpy = jest
      .spyOn(ServiceLevelObjectiveService, "resolveOpenBurnRateAlertsForSlo")
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

  it("resolves the open burn rate alerts of every SLO about to be deleted", async () => {
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

    expect(resolveAlertsSpy).toHaveBeenCalledTimes(2);
    expect(resolveAlertsSpy).toHaveBeenNthCalledWith(1, {
      sloId: SLO_ID,
      projectId: PROJECT_ID,
    });
    expect(resolveAlertsSpy).toHaveBeenNthCalledWith(2, {
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

    expect(resolveAlertsSpy).not.toHaveBeenCalled();
  });

  it("does not block the delete when alert resolution throws", async () => {
    findBySpy.mockResolvedValue([
      makeSlo({ _id: SLO_ID.toString(), id: SLO_ID, projectId: PROJECT_ID }),
    ]);
    resolveAlertsSpy.mockRejectedValue(new Error("alert service down"));

    await expect(
      callHook("onBeforeDelete", makeDeleteBy()),
    ).resolves.toBeDefined();
  });
});

describe("ServiceLevelObjectiveService.resolveOpenBurnRateAlertsForSlo", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("delegates to every burn rate rule of the SLO with the auto-resolve root cause", async () => {
    const ruleFindBySpy: jest.SpyInstance = jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy")
      .mockResolvedValue([
        makeBurnRateRule(RULE_ID),
        makeBurnRateRule(OTHER_RULE_ID),
      ]);

    const resolveForRuleSpy: jest.SpyInstance = jest
      .spyOn(
        ServiceLevelObjectiveBurnRateRuleService,
        "resolveOpenAlertsForRule",
      )
      .mockResolvedValue(undefined);

    await ServiceLevelObjectiveService.resolveOpenBurnRateAlertsForSlo({
      sloId: SLO_ID,
      projectId: PROJECT_ID,
    });

    const ruleFindByArg: { query: Record<string, unknown> } = ruleFindBySpy.mock
      .calls[0]![0] as { query: Record<string, unknown> };
    expect(ruleFindByArg.query).toEqual({
      serviceLevelObjectiveId: SLO_ID,
      projectId: PROJECT_ID,
    });

    expect(resolveForRuleSpy).toHaveBeenCalledTimes(2);
    expect(resolveForRuleSpy).toHaveBeenNthCalledWith(1, {
      serviceLevelObjectiveId: SLO_ID,
      burnRateRuleId: RULE_ID,
      projectId: PROJECT_ID,
      rootCause:
        "Alert auto-resolved because the Service Level Objective was disabled or deleted.",
    });
    expect(resolveForRuleSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ burnRateRuleId: OTHER_RULE_ID }),
    );
  });

  it("continues to the next rule when one rule's resolution throws", async () => {
    jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy")
      .mockResolvedValue([
        makeBurnRateRule(RULE_ID),
        makeBurnRateRule(OTHER_RULE_ID),
      ]);

    const resolveForRuleSpy: jest.SpyInstance = jest
      .spyOn(
        ServiceLevelObjectiveBurnRateRuleService,
        "resolveOpenAlertsForRule",
      )
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);

    await expect(
      ServiceLevelObjectiveService.resolveOpenBurnRateAlertsForSlo({
        sloId: SLO_ID,
        projectId: PROJECT_ID,
      }),
    ).resolves.toBeUndefined();

    expect(resolveForRuleSpy).toHaveBeenCalledTimes(2);
  });

  it("skips a rule row that came back without an id", async () => {
    jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy")
      .mockResolvedValue([new ServiceLevelObjectiveBurnRateRule()]);

    const resolveForRuleSpy: jest.SpyInstance = jest
      .spyOn(
        ServiceLevelObjectiveBurnRateRuleService,
        "resolveOpenAlertsForRule",
      )
      .mockResolvedValue(undefined);

    await ServiceLevelObjectiveService.resolveOpenBurnRateAlertsForSlo({
      sloId: SLO_ID,
      projectId: PROJECT_ID,
    });

    expect(resolveForRuleSpy).not.toHaveBeenCalled();
  });

  it("is a no-op when the SLO has no burn rate rules", async () => {
    jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy")
      .mockResolvedValue([]);

    const resolveForRuleSpy: jest.SpyInstance = jest
      .spyOn(
        ServiceLevelObjectiveBurnRateRuleService,
        "resolveOpenAlertsForRule",
      )
      .mockResolvedValue(undefined);

    await ServiceLevelObjectiveService.resolveOpenBurnRateAlertsForSlo({
      sloId: SLO_ID,
      projectId: PROJECT_ID,
    });

    expect(resolveForRuleSpy).not.toHaveBeenCalled();
  });

  it("queries the open alerts of each rule by that rule's exact fingerprint", async () => {
    jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy")
      .mockResolvedValue([makeBurnRateRule(RULE_ID)]);

    const alertFindBySpy: jest.SpyInstance = jest
      .spyOn(AlertService, "findBy")
      .mockResolvedValue([makeAlert(ObjectID.generate())]);

    jest
      .spyOn(AlertStateTimelineService, "getResolvedStateIdForProject")
      .mockResolvedValue(RESOLVED_STATE_ID);

    const timelineCreateSpy: jest.SpyInstance = jest
      .spyOn(AlertStateTimelineService, "create")
      .mockResolvedValue(new AlertStateTimeline());

    await ServiceLevelObjectiveService.resolveOpenBurnRateAlertsForSlo({
      sloId: SLO_ID,
      projectId: PROJECT_ID,
    });

    const alertFindByArg: { query: Record<string, unknown> } = alertFindBySpy
      .mock.calls[0]![0] as { query: Record<string, unknown> };

    expect(alertFindByArg.query).toEqual({
      projectId: PROJECT_ID,
      seriesFingerprint: `slo:${SLO_ID.toString()}:burn-rule:${RULE_ID.toString()}`,
      currentAlertState: { isResolvedState: false },
    });

    // And it actually resolved through the AlertStateTimeline path.
    expect(timelineCreateSpy).toHaveBeenCalledTimes(1);
    const timelineArg: { data: { alertStateId: ObjectID; rootCause: string } } =
      timelineCreateSpy.mock.calls[0]![0] as {
        data: { alertStateId: ObjectID; rootCause: string };
      };
    expect(timelineArg.data.alertStateId).toEqual(RESOLVED_STATE_ID);
    expect(timelineArg.data.rootCause).toContain(
      "Service Level Objective was disabled or deleted",
    );
  });

  it("tolerates the benign same-state race without rethrowing", async () => {
    jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy")
      .mockResolvedValue([makeBurnRateRule(RULE_ID)]);

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

    await expect(
      ServiceLevelObjectiveService.resolveOpenBurnRateAlertsForSlo({
        sloId: SLO_ID,
        projectId: PROJECT_ID,
      }),
    ).resolves.toBeUndefined();
  });

  it("keeps resolving the remaining open alerts when one alert throws", async () => {
    jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy")
      .mockResolvedValue([makeBurnRateRule(RULE_ID)]);

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

    await expect(
      ServiceLevelObjectiveService.resolveOpenBurnRateAlertsForSlo({
        sloId: SLO_ID,
        projectId: PROJECT_ID,
      }),
    ).resolves.toBeUndefined();

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
