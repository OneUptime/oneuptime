import Alert from "../../../Models/DatabaseModels/Alert";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import ServiceLevelObjectiveBurnRateRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import AlertService from "../../../Server/Services/AlertService";
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import ServiceLevelObjectiveBurnRateRuleService from "../../../Server/Services/ServiceLevelObjectiveBurnRateRuleService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";

/*
 * Contract under test for ServiceLevelObjectiveBurnRateRuleService:
 *
 *   - a multi-window burn rate rule is only meaningful when the long window
 *     is strictly longer than the short one and the threshold is positive;
 *     the guard has to hold on create AND on partial updates that touch only
 *     one of the two windows (validated against the persisted sibling),
 *   - the alert fingerprint is the only link between a rule and the alerts it
 *     opened, so it must be exactly `slo:<sloId>:burn-rule:<ruleId>` and
 *     never drift,
 *   - deleting a rule must resolve the alerts it opened, tolerating the
 *     benign same-state race with the evaluation worker and isolating a
 *     failure on one alert from the rest.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SLO_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const RULE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const OTHER_RULE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const RESOLVED_STATE_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);

const THRESHOLD_ERROR_MESSAGE: string =
  "Burn rate threshold must be greater than 0.";
const WINDOWS_REQUIRED_ERROR_MESSAGE: string =
  "Long window and short window are required for a burn rate rule.";
const SHORT_WINDOW_ERROR_MESSAGE: string =
  "Short window must be greater than 0 minutes.";
const LONG_WINDOW_ERROR_MESSAGE: string =
  "Long window must be greater than the short window.";
const WINDOWS_NOT_NUMERIC_ERROR_MESSAGE: string =
  "Long window and short window must be a number of minutes.";
const SAME_STATE_RACE_MESSAGE: string =
  "Alert state cannot be same as previous state.";
const DEFAULT_ROOT_CAUSE: string =
  "Alert auto-resolved because the SLO burn rate rule that created it is no longer active.";
const DELETE_ROOT_CAUSE: string =
  "Alert auto-resolved because the SLO burn rate rule that created it was deleted.";

type RuleFields = Record<string, unknown>;

function makeRule(fields: RuleFields): ServiceLevelObjectiveBurnRateRule {
  const rule: ServiceLevelObjectiveBurnRateRule =
    new ServiceLevelObjectiveBurnRateRule();
  const writable: Record<string, unknown> = rule as unknown as Record<
    string,
    unknown
  >;

  for (const key of Object.keys(fields)) {
    writable[key] = fields[key];
  }

  return rule;
}

function makeCreateBy(
  fields: RuleFields,
): CreateBy<ServiceLevelObjectiveBurnRateRule> {
  return {
    data: makeRule({
      projectId: PROJECT_ID,
      serviceLevelObjectiveId: SLO_ID,
      name: "Fast burn",
      ...fields,
    }),
    props: { isRoot: true },
  };
}

function makeUpdateBy(
  data: RuleFields,
): UpdateBy<ServiceLevelObjectiveBurnRateRule> {
  return {
    query: { _id: RULE_ID.toString() },
    data: data,
    props: { isRoot: true },
    limit: 1,
    skip: 0,
  } as unknown as UpdateBy<ServiceLevelObjectiveBurnRateRule>;
}

function makeDeleteBy(): DeleteBy<ServiceLevelObjectiveBurnRateRule> {
  return {
    query: { serviceLevelObjectiveId: SLO_ID },
    props: { isRoot: true },
    limit: 10,
    skip: 0,
  } as unknown as DeleteBy<ServiceLevelObjectiveBurnRateRule>;
}

function makeAlert(id: ObjectID): Alert {
  const alert: Alert = new Alert();
  alert._id = id.toString();
  alert.id = id;
  alert.projectId = PROJECT_ID;
  return alert;
}

// Calls the protected hook without widening the service's public surface.
function callHook(name: string, ...args: Array<unknown>): Promise<unknown> {
  const hooks: Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  > = ServiceLevelObjectiveBurnRateRuleService as unknown as Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  >;

  return hooks[name]!.apply(ServiceLevelObjectiveBurnRateRuleService, args);
}

async function expectBadData(
  promise: Promise<unknown>,
  message: string,
): Promise<void> {
  await expect(promise).rejects.toThrow(BadDataException);
  await expect(promise).rejects.toThrow(message);
}

describe("ServiceLevelObjectiveBurnRateRuleService.onBeforeCreate", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const rejectedThresholds: Array<{ label: string; value: unknown }> = [
    { label: "0", value: 0 },
    { label: "a negative threshold", value: -1 },
    { label: "null", value: null },
  ];

  for (const rejectedThreshold of rejectedThresholds) {
    it(`rejects a burn rate threshold of ${rejectedThreshold.label}`, async () => {
      await expectBadData(
        callHook(
          "onBeforeCreate",
          makeCreateBy({
            burnRateThreshold: rejectedThreshold.value,
            longWindowInMinutes: 60,
            shortWindowInMinutes: 5,
          }),
        ),
        THRESHOLD_ERROR_MESSAGE,
      );
    });
  }

  it("rejects a rule created with no burn rate threshold at all", async () => {
    await expectBadData(
      callHook(
        "onBeforeCreate",
        makeCreateBy({
          longWindowInMinutes: 60,
          shortWindowInMinutes: 5,
        }),
      ),
      THRESHOLD_ERROR_MESSAGE,
    );
  });

  it("rejects a rule with no long window", async () => {
    await expectBadData(
      callHook(
        "onBeforeCreate",
        makeCreateBy({
          burnRateThreshold: 14.4,
          shortWindowInMinutes: 5,
        }),
      ),
      WINDOWS_REQUIRED_ERROR_MESSAGE,
    );
  });

  it("rejects a rule with no short window", async () => {
    await expectBadData(
      callHook(
        "onBeforeCreate",
        makeCreateBy({
          burnRateThreshold: 14.4,
          longWindowInMinutes: 60,
        }),
      ),
      WINDOWS_REQUIRED_ERROR_MESSAGE,
    );
  });

  it("rejects a short window of 0 minutes", async () => {
    await expectBadData(
      callHook(
        "onBeforeCreate",
        makeCreateBy({
          burnRateThreshold: 14.4,
          longWindowInMinutes: 60,
          shortWindowInMinutes: 0,
        }),
      ),
      SHORT_WINDOW_ERROR_MESSAGE,
    );
  });

  it("rejects a negative short window", async () => {
    await expectBadData(
      callHook(
        "onBeforeCreate",
        makeCreateBy({
          burnRateThreshold: 14.4,
          longWindowInMinutes: 60,
          shortWindowInMinutes: -5,
        }),
      ),
      SHORT_WINDOW_ERROR_MESSAGE,
    );
  });

  it("rejects a long window shorter than the short window", async () => {
    await expectBadData(
      callHook(
        "onBeforeCreate",
        makeCreateBy({
          burnRateThreshold: 14.4,
          longWindowInMinutes: 5,
          shortWindowInMinutes: 60,
        }),
      ),
      LONG_WINDOW_ERROR_MESSAGE,
    );
  });

  it("rejects a long window equal to the short window", async () => {
    await expectBadData(
      callHook(
        "onBeforeCreate",
        makeCreateBy({
          burnRateThreshold: 14.4,
          longWindowInMinutes: 60,
          shortWindowInMinutes: 60,
        }),
      ),
      LONG_WINDOW_ERROR_MESSAGE,
    );
  });

  const acceptedRules: Array<{
    label: string;
    burnRateThreshold: number;
    longWindowInMinutes: number;
    shortWindowInMinutes: number;
  }> = [
    {
      label: "the canonical fast burn rule",
      burnRateThreshold: 14.4,
      longWindowInMinutes: 60,
      shortWindowInMinutes: 5,
    },
    {
      label: "the canonical slow burn rule",
      burnRateThreshold: 6,
      longWindowInMinutes: 360,
      shortWindowInMinutes: 30,
    },
    {
      label: "a sub-1x threshold from a short compliance window",
      burnRateThreshold: 0.01,
      longWindowInMinutes: 2,
      shortWindowInMinutes: 1,
    },
  ];

  for (const acceptedRule of acceptedRules) {
    it(`accepts ${acceptedRule.label}`, async () => {
      await expect(
        callHook(
          "onBeforeCreate",
          makeCreateBy({
            burnRateThreshold: acceptedRule.burnRateThreshold,
            longWindowInMinutes: acceptedRule.longWindowInMinutes,
            shortWindowInMinutes: acceptedRule.shortWindowInMinutes,
          }),
        ),
      ).resolves.toBeDefined();
    });
  }
});

describe("ServiceLevelObjectiveBurnRateRuleService.onBeforeUpdate", () => {
  let findBySpy: jest.SpyInstance;

  beforeEach(() => {
    findBySpy = jest.spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects an update that drops the threshold to 0", async () => {
    await expectBadData(
      callHook("onBeforeUpdate", makeUpdateBy({ burnRateThreshold: 0 })),
      THRESHOLD_ERROR_MESSAGE,
    );
  });

  it("rejects an update to a negative threshold", async () => {
    await expectBadData(
      callHook("onBeforeUpdate", makeUpdateBy({ burnRateThreshold: -2 })),
      THRESHOLD_ERROR_MESSAGE,
    );
  });

  it("accepts an update to a positive threshold without reading the row", async () => {
    await expect(
      callHook("onBeforeUpdate", makeUpdateBy({ burnRateThreshold: 2.5 })),
    ).resolves.toBeDefined();

    expect(findBySpy).not.toHaveBeenCalled();
  });

  it("skips validation entirely when neither the threshold nor a window is touched", async () => {
    await expect(
      callHook("onBeforeUpdate", makeUpdateBy({ name: "Renamed rule" })),
    ).resolves.toBeDefined();

    expect(findBySpy).not.toHaveBeenCalled();
  });

  it("validates both windows in one payload without reading the row", async () => {
    await expect(
      callHook(
        "onBeforeUpdate",
        makeUpdateBy({ longWindowInMinutes: 120, shortWindowInMinutes: 10 }),
      ),
    ).resolves.toBeDefined();

    expect(findBySpy).not.toHaveBeenCalled();
  });

  it("rejects a payload where both windows are inverted", async () => {
    await expectBadData(
      callHook(
        "onBeforeUpdate",
        makeUpdateBy({ longWindowInMinutes: 10, shortWindowInMinutes: 120 }),
      ),
      LONG_WINDOW_ERROR_MESSAGE,
    );

    expect(findBySpy).not.toHaveBeenCalled();
  });

  it("rejects a payload that zeroes the short window while widening the long one", async () => {
    await expectBadData(
      callHook(
        "onBeforeUpdate",
        makeUpdateBy({ longWindowInMinutes: 120, shortWindowInMinutes: 0 }),
      ),
      SHORT_WINDOW_ERROR_MESSAGE,
    );
  });

  it("validates a long-window-only update against the persisted short window and passes", async () => {
    findBySpy.mockResolvedValue([
      makeRule({
        _id: RULE_ID.toString(),
        id: RULE_ID,
        longWindowInMinutes: 60,
        shortWindowInMinutes: 30,
      }),
    ]);

    await expect(
      callHook("onBeforeUpdate", makeUpdateBy({ longWindowInMinutes: 120 })),
    ).resolves.toBeDefined();

    expect(findBySpy).toHaveBeenCalledTimes(1);

    const findByArg: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    } = findBySpy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    };

    // It must read the row through the caller's own query, as root.
    expect(findByArg.query).toEqual({ _id: RULE_ID.toString() });
    expect(findByArg.select).toEqual({
      _id: true,
      longWindowInMinutes: true,
      shortWindowInMinutes: true,
    });
    expect(findByArg.props).toEqual({ isRoot: true });
  });

  it("rejects a long-window-only update that would sink below the persisted short window", async () => {
    findBySpy.mockResolvedValue([
      makeRule({
        _id: RULE_ID.toString(),
        id: RULE_ID,
        longWindowInMinutes: 360,
        shortWindowInMinutes: 30,
      }),
    ]);

    await expectBadData(
      callHook("onBeforeUpdate", makeUpdateBy({ longWindowInMinutes: 20 })),
      LONG_WINDOW_ERROR_MESSAGE,
    );
  });

  it("validates a short-window-only update against the persisted long window and passes", async () => {
    findBySpy.mockResolvedValue([
      makeRule({
        _id: RULE_ID.toString(),
        id: RULE_ID,
        longWindowInMinutes: 360,
        shortWindowInMinutes: 30,
      }),
    ]);

    await expect(
      callHook("onBeforeUpdate", makeUpdateBy({ shortWindowInMinutes: 60 })),
    ).resolves.toBeDefined();
  });

  it("rejects a short-window-only update that would overtake the persisted long window", async () => {
    findBySpy.mockResolvedValue([
      makeRule({
        _id: RULE_ID.toString(),
        id: RULE_ID,
        longWindowInMinutes: 60,
        shortWindowInMinutes: 5,
      }),
    ]);

    await expectBadData(
      callHook("onBeforeUpdate", makeUpdateBy({ shortWindowInMinutes: 90 })),
      LONG_WINDOW_ERROR_MESSAGE,
    );
  });

  it("rejects a short-window-only update to 0 regardless of the persisted long window", async () => {
    findBySpy.mockResolvedValue([
      makeRule({
        _id: RULE_ID.toString(),
        id: RULE_ID,
        longWindowInMinutes: 360,
        shortWindowInMinutes: 30,
      }),
    ]);

    await expectBadData(
      callHook("onBeforeUpdate", makeUpdateBy({ shortWindowInMinutes: 0 })),
      SHORT_WINDOW_ERROR_MESSAGE,
    );
  });

  it("rejects a bulk window update as soon as any matched row would become invalid", async () => {
    findBySpy.mockResolvedValue([
      makeRule({
        _id: RULE_ID.toString(),
        id: RULE_ID,
        longWindowInMinutes: 360,
        shortWindowInMinutes: 30,
      }),
      makeRule({
        _id: OTHER_RULE_ID.toString(),
        id: OTHER_RULE_ID,
        longWindowInMinutes: 60,
        shortWindowInMinutes: 5,
      }),
    ]);

    /*
     * 120 still fits under the first row's 360 minute long window, but it
     * overtakes the second row's 60 minute one - the whole update must fail.
     */
    await expectBadData(
      callHook("onBeforeUpdate", makeUpdateBy({ shortWindowInMinutes: 120 })),
      LONG_WINDOW_ERROR_MESSAGE,
    );
  });

  it("accepts a bulk window update that stays valid for every matched row", async () => {
    findBySpy.mockResolvedValue([
      makeRule({
        _id: RULE_ID.toString(),
        id: RULE_ID,
        longWindowInMinutes: 360,
        shortWindowInMinutes: 30,
      }),
      makeRule({
        _id: OTHER_RULE_ID.toString(),
        id: OTHER_RULE_ID,
        longWindowInMinutes: 60,
        shortWindowInMinutes: 5,
      }),
    ]);

    await expect(
      callHook("onBeforeUpdate", makeUpdateBy({ shortWindowInMinutes: 10 })),
    ).resolves.toBeDefined();
  });

  it("treats an explicit null window as 'not being updated' and skips the row read", async () => {
    await expect(
      callHook("onBeforeUpdate", makeUpdateBy({ longWindowInMinutes: null })),
    ).resolves.toBeDefined();

    expect(findBySpy).not.toHaveBeenCalled();
  });
});

/*
 * Regression: the window columns arrive as STRINGS from the dashboard (number
 * form fields hand Formik `e.target.value`, and neither ModelForm nor
 * BaseModel.fromJSON coerces Number/Decimal columns), so
 * `long <= short` used to be a LEXICOGRAPHIC comparison:
 *
 *   long "1440", short "60"  -> "1440" <= "60"  is TRUE  -> wrongly REJECTED
 *                               (a 24h/60m rule could not be created at all)
 *   long "120",  short "30"  -> "120"  <= "30"  is TRUE  -> wrongly REJECTED
 *   long "60",   short "360" -> "60"   <= "360" is FALSE -> wrongly ACCEPTED
 *                               (a short window LONGER than the long one,
 *                                which breaks the whole multi-window design)
 *
 * Every numeric column is now coerced before validation and the coerced number
 * is written back onto the payload.
 */
describe("ServiceLevelObjectiveBurnRateRuleService - numeric columns supplied as strings", () => {
  let findBySpy: jest.SpyInstance;

  beforeEach(() => {
    findBySpy = jest.spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const lexicographicTraps: Array<{
    label: string;
    longWindowInMinutes: string;
    shortWindowInMinutes: string;
  }> = [
    {
      label: "a 24 hour long window over a 60 minute short window",
      longWindowInMinutes: "1440",
      shortWindowInMinutes: "60",
    },
    {
      label: "a 2 hour long window over a 30 minute short window",
      longWindowInMinutes: "120",
      shortWindowInMinutes: "30",
    },
    {
      label: "a 6 hour long window over a 5 minute short window",
      longWindowInMinutes: "360",
      shortWindowInMinutes: "5",
    },
  ];

  for (const trap of lexicographicTraps) {
    it(`accepts ${trap.label} sent as strings, and persists both as numbers`, async () => {
      const createBy: CreateBy<ServiceLevelObjectiveBurnRateRule> =
        makeCreateBy({
          burnRateThreshold: "14.4",
          longWindowInMinutes: trap.longWindowInMinutes,
          shortWindowInMinutes: trap.shortWindowInMinutes,
        });

      await expect(callHook("onBeforeCreate", createBy)).resolves.toBeDefined();

      expect(createBy.data.longWindowInMinutes).toBe(
        Number(trap.longWindowInMinutes),
      );
      expect(createBy.data.shortWindowInMinutes).toBe(
        Number(trap.shortWindowInMinutes),
      );
      expect(createBy.data.burnRateThreshold).toBe(14.4);

      expect(typeof createBy.data.longWindowInMinutes).toBe("number");
      expect(typeof createBy.data.shortWindowInMinutes).toBe("number");
      expect(typeof createBy.data.burnRateThreshold).toBe("number");
    });
  }

  it('rejects a short window LONGER than the long window when both are strings ("60" / "360")', async () => {
    await expectBadData(
      callHook(
        "onBeforeCreate",
        makeCreateBy({
          burnRateThreshold: 14.4,
          longWindowInMinutes: "60",
          shortWindowInMinutes: "360",
        }),
      ),
      LONG_WINDOW_ERROR_MESSAGE,
    );
  });

  it("rejects string windows that are equal", async () => {
    await expectBadData(
      callHook(
        "onBeforeCreate",
        makeCreateBy({
          burnRateThreshold: 14.4,
          longWindowInMinutes: "60",
          shortWindowInMinutes: "60",
        }),
      ),
      LONG_WINDOW_ERROR_MESSAGE,
    );
  });

  it('rejects a short window of "0" as a string', async () => {
    await expectBadData(
      callHook(
        "onBeforeCreate",
        makeCreateBy({
          burnRateThreshold: 14.4,
          longWindowInMinutes: "60",
          shortWindowInMinutes: "0",
        }),
      ),
      SHORT_WINDOW_ERROR_MESSAGE,
    );
  });

  const nonNumericWindows: Array<{ label: string; value: unknown }> = [
    { label: "an empty string", value: "" },
    { label: "a whitespace-only string", value: "  " },
    { label: "a non-numeric string", value: "abc" },
    { label: "NaN", value: Number.NaN },
    { label: "a boolean", value: true },
  ];

  for (const nonNumericWindow of nonNumericWindows) {
    it(`rejects a long window of ${nonNumericWindow.label} on create`, async () => {
      await expectBadData(
        callHook(
          "onBeforeCreate",
          makeCreateBy({
            burnRateThreshold: 14.4,
            longWindowInMinutes: nonNumericWindow.value,
            shortWindowInMinutes: 5,
          }),
        ),
        WINDOWS_NOT_NUMERIC_ERROR_MESSAGE,
      );
    });

    it(`rejects a short window of ${nonNumericWindow.label} on create`, async () => {
      await expectBadData(
        callHook(
          "onBeforeCreate",
          makeCreateBy({
            burnRateThreshold: 14.4,
            longWindowInMinutes: 60,
            shortWindowInMinutes: nonNumericWindow.value,
          }),
        ),
        WINDOWS_NOT_NUMERIC_ERROR_MESSAGE,
      );
    });
  }

  const rejectedThresholdStrings: Array<{ label: string; value: unknown }> = [
    { label: "an empty string", value: "" },
    { label: "a non-numeric string", value: "abc" },
    { label: 'the string "0"', value: "0" },
    { label: 'the string "-1"', value: "-1" },
  ];

  for (const rejectedThresholdString of rejectedThresholdStrings) {
    it(`rejects a threshold of ${rejectedThresholdString.label} on create`, async () => {
      await expectBadData(
        callHook(
          "onBeforeCreate",
          makeCreateBy({
            burnRateThreshold: rejectedThresholdString.value,
            longWindowInMinutes: 60,
            shortWindowInMinutes: 5,
          }),
        ),
        THRESHOLD_ERROR_MESSAGE,
      );
    });

    it(`rejects a threshold of ${rejectedThresholdString.label} on update`, async () => {
      await expectBadData(
        callHook(
          "onBeforeUpdate",
          makeUpdateBy({ burnRateThreshold: rejectedThresholdString.value }),
        ),
        THRESHOLD_ERROR_MESSAGE,
      );
    });
  }

  it("coerces the optional numeric columns too", async () => {
    const createBy: CreateBy<ServiceLevelObjectiveBurnRateRule> = makeCreateBy({
      burnRateThreshold: "6",
      longWindowInMinutes: "360",
      shortWindowInMinutes: "30",
      minimumSampleCount: "100",
      refireSuppressionMinutes: "360",
    });

    await expect(callHook("onBeforeCreate", createBy)).resolves.toBeDefined();

    expect(createBy.data.minimumSampleCount).toBe(100);
    expect(createBy.data.refireSuppressionMinutes).toBe(360);
    expect(typeof createBy.data.minimumSampleCount).toBe("number");
    expect(typeof createBy.data.refireSuppressionMinutes).toBe("number");
  });

  it("rejects a non-numeric minimum sample count", async () => {
    await expectBadData(
      callHook(
        "onBeforeCreate",
        makeCreateBy({
          burnRateThreshold: 6,
          longWindowInMinutes: 360,
          shortWindowInMinutes: 30,
          minimumSampleCount: "abc",
        }),
      ),
      "Minimum sample count must be a number greater than or equal to 0.",
    );
  });

  it("rejects a negative re-fire suppression window", async () => {
    await expectBadData(
      callHook(
        "onBeforeUpdate",
        makeUpdateBy({ refireSuppressionMinutes: "-5" }),
      ),
      "Re-fire suppression must be a number of minutes greater than or equal to 0.",
    );
  });

  it("accepts both windows as strings in one update payload and writes numbers back", async () => {
    const updateBy: UpdateBy<ServiceLevelObjectiveBurnRateRule> = makeUpdateBy({
      longWindowInMinutes: "1440",
      shortWindowInMinutes: "60",
    });

    await expect(callHook("onBeforeUpdate", updateBy)).resolves.toBeDefined();

    expect(updateBy.data.longWindowInMinutes).toBe(1440);
    expect(updateBy.data.shortWindowInMinutes).toBe(60);
    expect(typeof updateBy.data.longWindowInMinutes).toBe("number");
    expect(typeof updateBy.data.shortWindowInMinutes).toBe("number");
    expect(findBySpy).not.toHaveBeenCalled();
  });

  it("rejects an inverted string window pair in one update payload", async () => {
    await expectBadData(
      callHook(
        "onBeforeUpdate",
        makeUpdateBy({
          longWindowInMinutes: "60",
          shortWindowInMinutes: "360",
        }),
      ),
      LONG_WINDOW_ERROR_MESSAGE,
    );
  });

  it("compares a string long-window update numerically against the persisted short window", async () => {
    findBySpy.mockResolvedValue([
      makeRule({
        _id: RULE_ID.toString(),
        id: RULE_ID,
        longWindowInMinutes: 60,
        shortWindowInMinutes: 30,
      }),
    ]);

    const updateBy: UpdateBy<ServiceLevelObjectiveBurnRateRule> = makeUpdateBy({
      longWindowInMinutes: "1440",
    });

    await expect(callHook("onBeforeUpdate", updateBy)).resolves.toBeDefined();

    expect(updateBy.data.longWindowInMinutes).toBe(1440);
    expect(typeof updateBy.data.longWindowInMinutes).toBe("number");
  });

  /*
   * Rows written before this fix can still hold a string in a Number/Decimal
   * column, so the PERSISTED sibling has to be coerced as well - otherwise the
   * comparison against it is lexicographic all over again.
   */
  it("coerces the persisted sibling window, so a legacy string row still compares numerically", async () => {
    findBySpy.mockResolvedValue([
      makeRule({
        _id: RULE_ID.toString(),
        id: RULE_ID,
        // A row that predates coercion: the short window is stored as text.
        shortWindowInMinutes: "60",
      }),
    ]);

    await expect(
      callHook("onBeforeUpdate", makeUpdateBy({ longWindowInMinutes: 1440 })),
    ).resolves.toBeDefined();
  });

  it("rejects a short-window update that overtakes a persisted long window stored as a string", async () => {
    findBySpy.mockResolvedValue([
      makeRule({
        _id: RULE_ID.toString(),
        id: RULE_ID,
        // "60" lexicographically precedes "360", which used to let this pass.
        longWindowInMinutes: "60",
      }),
    ]);

    await expectBadData(
      callHook("onBeforeUpdate", makeUpdateBy({ shortWindowInMinutes: "360" })),
      LONG_WINDOW_ERROR_MESSAGE,
    );
  });

  it("rejects a non-numeric single-window update before it even reads the rows", async () => {
    await expectBadData(
      callHook("onBeforeUpdate", makeUpdateBy({ longWindowInMinutes: "abc" })),
      WINDOWS_NOT_NUMERIC_ERROR_MESSAGE,
    );

    expect(findBySpy).not.toHaveBeenCalled();
  });

  it("rejects a persisted sibling that is not numeric at all, rather than accepting a NaN comparison", async () => {
    findBySpy.mockResolvedValue([
      makeRule({
        _id: RULE_ID.toString(),
        id: RULE_ID,
        shortWindowInMinutes: undefined,
      }),
    ]);

    await expectBadData(
      callHook("onBeforeUpdate", makeUpdateBy({ longWindowInMinutes: 1440 })),
      WINDOWS_NOT_NUMERIC_ERROR_MESSAGE,
    );
  });

  it("coerces a string single-window update even when the query matches no rows", async () => {
    findBySpy.mockResolvedValue([]);

    const updateBy: UpdateBy<ServiceLevelObjectiveBurnRateRule> = makeUpdateBy({
      shortWindowInMinutes: "30",
    });

    await expect(callHook("onBeforeUpdate", updateBy)).resolves.toBeDefined();

    expect(updateBy.data.shortWindowInMinutes).toBe(30);
    expect(typeof updateBy.data.shortWindowInMinutes).toBe("number");
  });

  it("writes a coerced threshold back onto the update payload", async () => {
    const updateBy: UpdateBy<ServiceLevelObjectiveBurnRateRule> = makeUpdateBy({
      burnRateThreshold: "2.5",
    });

    await expect(callHook("onBeforeUpdate", updateBy)).resolves.toBeDefined();

    expect(updateBy.data.burnRateThreshold).toBe(2.5);
    expect(typeof updateBy.data.burnRateThreshold).toBe("number");
  });
});

describe("ServiceLevelObjectiveBurnRateRuleService.getBurnRateAlertFingerprint", () => {
  it("is exactly slo:<sloId>:burn-rule:<ruleId>", () => {
    expect(
      ServiceLevelObjectiveBurnRateRuleService.getBurnRateAlertFingerprint({
        serviceLevelObjectiveId: SLO_ID,
        burnRateRuleId: RULE_ID,
      }),
    ).toBe(`slo:${SLO_ID.toString()}:burn-rule:${RULE_ID.toString()}`);
  });

  it("is deterministic across calls", () => {
    const first: string =
      ServiceLevelObjectiveBurnRateRuleService.getBurnRateAlertFingerprint({
        serviceLevelObjectiveId: SLO_ID,
        burnRateRuleId: RULE_ID,
      });
    const second: string =
      ServiceLevelObjectiveBurnRateRuleService.getBurnRateAlertFingerprint({
        serviceLevelObjectiveId: SLO_ID,
        burnRateRuleId: RULE_ID,
      });

    expect(second).toBe(first);
  });

  it("distinguishes two rules of the same SLO", () => {
    const first: string =
      ServiceLevelObjectiveBurnRateRuleService.getBurnRateAlertFingerprint({
        serviceLevelObjectiveId: SLO_ID,
        burnRateRuleId: RULE_ID,
      });
    const second: string =
      ServiceLevelObjectiveBurnRateRuleService.getBurnRateAlertFingerprint({
        serviceLevelObjectiveId: SLO_ID,
        burnRateRuleId: OTHER_RULE_ID,
      });

    expect(second).not.toBe(first);
  });

  it("distinguishes the same rule id under two different SLOs", () => {
    const first: string =
      ServiceLevelObjectiveBurnRateRuleService.getBurnRateAlertFingerprint({
        serviceLevelObjectiveId: SLO_ID,
        burnRateRuleId: RULE_ID,
      });
    const second: string =
      ServiceLevelObjectiveBurnRateRuleService.getBurnRateAlertFingerprint({
        serviceLevelObjectiveId: OTHER_RULE_ID,
        burnRateRuleId: RULE_ID,
      });

    expect(second).not.toBe(first);
  });
});

describe("ServiceLevelObjectiveBurnRateRuleService.resolveOpenAlertsForRule", () => {
  let alertFindBySpy: jest.SpyInstance;
  let resolvedStateSpy: jest.SpyInstance;
  let timelineCreateSpy: jest.SpyInstance;

  beforeEach(() => {
    alertFindBySpy = jest.spyOn(AlertService, "findBy").mockResolvedValue([]);

    resolvedStateSpy = jest
      .spyOn(AlertStateTimelineService, "getResolvedStateIdForProject")
      .mockResolvedValue(RESOLVED_STATE_ID);

    timelineCreateSpy = jest
      .spyOn(AlertStateTimelineService, "create")
      .mockResolvedValue(new AlertStateTimeline());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function timelineRows(): Array<AlertStateTimeline> {
    return timelineCreateSpy.mock.calls.map((call: Array<unknown>) => {
      return (call[0] as CreateBy<AlertStateTimeline>).data;
    });
  }

  it("looks up only the unresolved alerts carrying this rule's fingerprint", async () => {
    await ServiceLevelObjectiveBurnRateRuleService.resolveOpenAlertsForRule({
      serviceLevelObjectiveId: SLO_ID,
      burnRateRuleId: RULE_ID,
      projectId: PROJECT_ID,
    });

    const findByArg: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    } = alertFindBySpy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    };

    expect(findByArg.query).toEqual({
      projectId: PROJECT_ID,
      seriesFingerprint: `slo:${SLO_ID.toString()}:burn-rule:${RULE_ID.toString()}`,
      currentAlertState: { isResolvedState: false },
    });
    // projectId is needed on each row to stamp the timeline entry.
    expect(findByArg.select).toEqual({ _id: true, projectId: true });
    expect(findByArg.props).toEqual({ isRoot: true });
  });

  it("is a no-op when the rule has no open alerts", async () => {
    await ServiceLevelObjectiveBurnRateRuleService.resolveOpenAlertsForRule({
      serviceLevelObjectiveId: SLO_ID,
      burnRateRuleId: RULE_ID,
      projectId: PROJECT_ID,
    });

    // It must not even resolve the project's resolved-state id.
    expect(resolvedStateSpy).not.toHaveBeenCalled();
    expect(timelineCreateSpy).not.toHaveBeenCalled();
  });

  it("appends one resolved state timeline row per open alert", async () => {
    const firstAlertId: ObjectID = ObjectID.generate();
    const secondAlertId: ObjectID = ObjectID.generate();

    alertFindBySpy.mockResolvedValue([
      makeAlert(firstAlertId),
      makeAlert(secondAlertId),
    ]);

    await ServiceLevelObjectiveBurnRateRuleService.resolveOpenAlertsForRule({
      serviceLevelObjectiveId: SLO_ID,
      burnRateRuleId: RULE_ID,
      projectId: PROJECT_ID,
    });

    // The resolved state is looked up once for the whole batch.
    expect(resolvedStateSpy).toHaveBeenCalledTimes(1);
    expect(resolvedStateSpy).toHaveBeenCalledWith(PROJECT_ID);

    const rows: Array<AlertStateTimeline> = timelineRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.alertId).toEqual(firstAlertId);
    expect(rows[1]!.alertId).toEqual(secondAlertId);

    for (const row of rows) {
      expect(row.alertStateId).toEqual(RESOLVED_STATE_ID);
      expect(row.projectId).toEqual(PROJECT_ID);
    }

    for (const call of timelineCreateSpy.mock.calls) {
      const createBy: CreateBy<AlertStateTimeline> = (
        call as Array<unknown>
      )[0] as CreateBy<AlertStateTimeline>;
      expect(createBy.props).toEqual({ isRoot: true });
    }
  });

  it("falls back to the generic root cause when the caller supplies none", async () => {
    alertFindBySpy.mockResolvedValue([makeAlert(ObjectID.generate())]);

    await ServiceLevelObjectiveBurnRateRuleService.resolveOpenAlertsForRule({
      serviceLevelObjectiveId: SLO_ID,
      burnRateRuleId: RULE_ID,
      projectId: PROJECT_ID,
    });

    expect(timelineRows()[0]!.rootCause).toBe(DEFAULT_ROOT_CAUSE);
  });

  it("threads the caller's root cause onto every resolved alert", async () => {
    alertFindBySpy.mockResolvedValue([
      makeAlert(ObjectID.generate()),
      makeAlert(ObjectID.generate()),
    ]);

    await ServiceLevelObjectiveBurnRateRuleService.resolveOpenAlertsForRule({
      serviceLevelObjectiveId: SLO_ID,
      burnRateRuleId: RULE_ID,
      projectId: PROJECT_ID,
      rootCause: "Alert auto-resolved because the SLO was disabled.",
    });

    for (const row of timelineRows()) {
      expect(row.rootCause).toBe(
        "Alert auto-resolved because the SLO was disabled.",
      );
    }
  });

  it("ignores an explicitly undefined root cause and uses the fallback", async () => {
    alertFindBySpy.mockResolvedValue([makeAlert(ObjectID.generate())]);

    await ServiceLevelObjectiveBurnRateRuleService.resolveOpenAlertsForRule({
      serviceLevelObjectiveId: SLO_ID,
      burnRateRuleId: RULE_ID,
      projectId: PROJECT_ID,
      rootCause: undefined,
    });

    expect(timelineRows()[0]!.rootCause).toBe(DEFAULT_ROOT_CAUSE);
  });

  it("treats the same-state concurrency race as a benign no-op, not an error", async () => {
    alertFindBySpy.mockResolvedValue([makeAlert(ObjectID.generate())]);
    timelineCreateSpy.mockRejectedValue(
      new BadDataException(SAME_STATE_RACE_MESSAGE),
    );

    const loggerErrorSpy: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {
        return undefined;
      });

    await expect(
      ServiceLevelObjectiveBurnRateRuleService.resolveOpenAlertsForRule({
        serviceLevelObjectiveId: SLO_ID,
        burnRateRuleId: RULE_ID,
        projectId: PROJECT_ID,
      }),
    ).resolves.toBeUndefined();

    /*
     * The inner catch must swallow this one specific message - if it were
     * rethrown, the outer catch would log it as an error.
     */
    expect(loggerErrorSpy).not.toHaveBeenCalled();
  });

  it("keeps resolving the remaining alerts after one alert fails", async () => {
    const firstAlertId: ObjectID = ObjectID.generate();
    const secondAlertId: ObjectID = ObjectID.generate();

    alertFindBySpy.mockResolvedValue([
      makeAlert(firstAlertId),
      makeAlert(secondAlertId),
    ]);

    timelineCreateSpy
      .mockRejectedValueOnce(new Error("write conflict"))
      .mockResolvedValueOnce(new AlertStateTimeline());

    await expect(
      ServiceLevelObjectiveBurnRateRuleService.resolveOpenAlertsForRule({
        serviceLevelObjectiveId: SLO_ID,
        burnRateRuleId: RULE_ID,
        projectId: PROJECT_ID,
      }),
    ).resolves.toBeUndefined();

    expect(timelineCreateSpy).toHaveBeenCalledTimes(2);
    expect(timelineRows()[1]!.alertId).toEqual(secondAlertId);
  });

  it("does not swallow a non-benign BadDataException silently - it is logged", async () => {
    alertFindBySpy.mockResolvedValue([makeAlert(ObjectID.generate())]);
    timelineCreateSpy.mockRejectedValue(
      new BadDataException("Some other validation problem."),
    );

    const loggerErrorSpy: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {
        return undefined;
      });

    await expect(
      ServiceLevelObjectiveBurnRateRuleService.resolveOpenAlertsForRule({
        serviceLevelObjectiveId: SLO_ID,
        burnRateRuleId: RULE_ID,
        projectId: PROJECT_ID,
      }),
    ).resolves.toBeUndefined();

    expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
  });
});

describe("ServiceLevelObjectiveBurnRateRuleService.onBeforeDelete", () => {
  let findBySpy: jest.SpyInstance;
  let resolveOpenAlertsSpy: jest.SpyInstance;

  beforeEach(() => {
    findBySpy = jest.spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy");
    resolveOpenAlertsSpy = jest
      .spyOn(
        ServiceLevelObjectiveBurnRateRuleService,
        "resolveOpenAlertsForRule",
      )
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("resolves the open alerts of every rule about to be deleted", async () => {
    const first: ServiceLevelObjectiveBurnRateRule = makeRule({
      _id: RULE_ID.toString(),
      id: RULE_ID,
      projectId: PROJECT_ID,
      serviceLevelObjectiveId: SLO_ID,
    });
    const second: ServiceLevelObjectiveBurnRateRule = makeRule({
      _id: OTHER_RULE_ID.toString(),
      id: OTHER_RULE_ID,
      projectId: PROJECT_ID,
      serviceLevelObjectiveId: SLO_ID,
    });

    findBySpy.mockResolvedValue([first, second]);

    const result: unknown = await callHook("onBeforeDelete", makeDeleteBy());

    expect(resolveOpenAlertsSpy).toHaveBeenCalledTimes(2);
    expect(resolveOpenAlertsSpy).toHaveBeenNthCalledWith(1, {
      serviceLevelObjectiveId: SLO_ID,
      burnRateRuleId: RULE_ID,
      projectId: PROJECT_ID,
      rootCause: DELETE_ROOT_CAUSE,
    });
    expect(resolveOpenAlertsSpy).toHaveBeenNthCalledWith(2, {
      serviceLevelObjectiveId: SLO_ID,
      burnRateRuleId: OTHER_RULE_ID,
      projectId: PROJECT_ID,
      rootCause: DELETE_ROOT_CAUSE,
    });

    expect(
      (result as { carryForward: { itemsToDelete: Array<unknown> } })
        .carryForward.itemsToDelete,
    ).toEqual([first, second]);
  });

  it("reads the doomed rows as root, honouring the caller's query and paging", async () => {
    findBySpy.mockResolvedValue([]);

    await callHook("onBeforeDelete", makeDeleteBy());

    const findByArg: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      limit: number;
      skip: number;
      props: Record<string, unknown>;
    } = findBySpy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      limit: number;
      skip: number;
      props: Record<string, unknown>;
    };

    expect(findByArg.query).toEqual({ serviceLevelObjectiveId: SLO_ID });
    expect(findByArg.select).toEqual({
      _id: true,
      projectId: true,
      serviceLevelObjectiveId: true,
    });
    expect(findByArg.limit).toBe(10);
    expect(findByArg.skip).toBe(0);
    expect(findByArg.props).toEqual({ isRoot: true });

    expect(resolveOpenAlertsSpy).not.toHaveBeenCalled();
  });

  it("skips rows missing the identity it needs to build a fingerprint", async () => {
    findBySpy.mockResolvedValue([
      // no id
      makeRule({ projectId: PROJECT_ID, serviceLevelObjectiveId: SLO_ID }),
      // no projectId
      makeRule({
        _id: RULE_ID.toString(),
        id: RULE_ID,
        serviceLevelObjectiveId: SLO_ID,
      }),
      // no serviceLevelObjectiveId
      makeRule({
        _id: OTHER_RULE_ID.toString(),
        id: OTHER_RULE_ID,
        projectId: PROJECT_ID,
      }),
    ]);

    await callHook("onBeforeDelete", makeDeleteBy());

    expect(resolveOpenAlertsSpy).not.toHaveBeenCalled();
  });

  it("does not block the delete when resolving one rule's alerts throws", async () => {
    findBySpy.mockResolvedValue([
      makeRule({
        _id: RULE_ID.toString(),
        id: RULE_ID,
        projectId: PROJECT_ID,
        serviceLevelObjectiveId: SLO_ID,
      }),
      makeRule({
        _id: OTHER_RULE_ID.toString(),
        id: OTHER_RULE_ID,
        projectId: PROJECT_ID,
        serviceLevelObjectiveId: SLO_ID,
      }),
    ]);

    resolveOpenAlertsSpy
      .mockRejectedValueOnce(new Error("alert service down"))
      .mockResolvedValueOnce(undefined);

    await expect(
      callHook("onBeforeDelete", makeDeleteBy()),
    ).resolves.toBeDefined();

    // The failure on the first rule must not abort the second.
    expect(resolveOpenAlertsSpy).toHaveBeenCalledTimes(2);
  });
});
