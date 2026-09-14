import Alert from "../../../Models/DatabaseModels/Alert";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import ServiceLevelObjectiveBurnRateRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import AlertService from "../../../Server/Services/AlertService";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import ServiceLevelObjectiveBurnRateRuleService, {
  NO_OUTPUT_ERROR_MESSAGE,
} from "../../../Server/Services/ServiceLevelObjectiveBurnRateRuleService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
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
 *   - a rule must declare SOMETHING - raise an alert, declare an incident, or
 *     both - on create and after any update, judged against the row that will
 *     EXIST afterwards rather than against the payload alone,
 *   - the fingerprint is the only link between a rule and what it opened, and
 *     one fingerprint serves both tables, so it must be exactly
 *     `slo:<sloId>:burn-rule:<ruleId>` and never drift,
 *   - a severity id belonging to another project is accepted by the column but
 *     makes the rule unfireable forever, so both severity references are
 *     validated against the rule's own project on create and on update,
 *   - anything that stops a rule from declaring something - a delete, a
 *     disable, an output switched off - must resolve what it left open,
 *     tolerating the benign same-state race with the evaluation worker and
 *     isolating a failure on one record (or one rule) from the rest.
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
const ALERT_SEVERITY_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const INCIDENT_SEVERITY_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
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
const SAME_STATE_INCIDENT_RACE_MESSAGE: string =
  "Incident state cannot be same as previous state.";
const DEFAULT_ROOT_CAUSE: string =
  "Alert auto-resolved because the SLO burn rate rule that created it is no longer active.";
const DEFAULT_INCIDENT_ROOT_CAUSE: string =
  "Incident auto-resolved because the SLO burn rate rule that declared it is no longer active.";
/*
 * The delete root cause is deliberately output-neutral: one string is stamped
 * on both the alert and the incident the deleted rule left open.
 */
const DELETE_ROOT_CAUSE: string =
  "Auto-resolved because the SLO burn rate rule that created it was deleted.";
const DISABLED_ALERT_ROOT_CAUSE: string =
  "Alert auto-resolved because the SLO burn rate rule that created it was disabled.";
const DISABLED_INCIDENT_ROOT_CAUSE: string =
  "Incident auto-resolved because the SLO burn rate rule that declared it was disabled.";
const ALERTS_TURNED_OFF_ROOT_CAUSE: string =
  "Alert auto-resolved because the SLO burn rate rule that created it no longer raises alerts.";
const INCIDENTS_TURNED_OFF_ROOT_CAUSE: string =
  "Incident auto-resolved because the SLO burn rate rule that declared it no longer declares incidents.";

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
  props?: CreateBy<ServiceLevelObjectiveBurnRateRule>["props"],
): CreateBy<ServiceLevelObjectiveBurnRateRule> {
  return {
    data: makeRule({
      projectId: PROJECT_ID,
      serviceLevelObjectiveId: SLO_ID,
      name: "Fast burn",
      ...fields,
    }),
    props: props || { isRoot: true },
  };
}

/*
 * A create payload whose numeric columns already satisfy the window and
 * threshold guards, so a test about the output flags or the severity
 * references only has to state the field it is actually about.
 */
function makeValidCreateBy(
  fields: RuleFields,
  props?: CreateBy<ServiceLevelObjectiveBurnRateRule>["props"],
): CreateBy<ServiceLevelObjectiveBurnRateRule> {
  return makeCreateBy(
    {
      burnRateThreshold: 14.4,
      longWindowInMinutes: 60,
      shortWindowInMinutes: 5,
      ...fields,
    },
    props,
  );
}

function makeUpdateBy(
  data: RuleFields,
  props?: Record<string, unknown>,
): UpdateBy<ServiceLevelObjectiveBurnRateRule> {
  return {
    query: { _id: RULE_ID.toString() },
    data: data,
    props: props || { isRoot: true },
    limit: 1,
    skip: 0,
  } as unknown as UpdateBy<ServiceLevelObjectiveBurnRateRule>;
}

function makeOnUpdate(
  data: RuleFields,
): OnUpdate<ServiceLevelObjectiveBurnRateRule> {
  return {
    updateBy: makeUpdateBy(data),
    carryForward: null,
  };
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

function makeIncident(id: ObjectID): Incident {
  const incident: Incident = new Incident();
  incident._id = id.toString();
  incident.id = id;
  incident.projectId = PROJECT_ID;
  return incident;
}

interface FindByArguments {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  limit: number;
  skip: number;
  props: Record<string, unknown>;
}

// The argument of the nth call to a findBy spy, typed for assertions.
function findByArgumentsAt(
  spy: jest.SpyInstance,
  index: number,
): FindByArguments {
  return spy.mock.calls[index]![0] as FindByArguments;
}

interface FindOneByIdArguments {
  id: ObjectID;
  select: Record<string, unknown>;
  props: Record<string, unknown>;
}

function findOneByIdArgumentsAt(
  spy: jest.SpyInstance,
  index: number,
): FindOneByIdArguments {
  return spy.mock.calls[index]![0] as FindOneByIdArguments;
}

interface ValidatedReferences {
  projectId: ObjectID | undefined;
  subject: string | undefined;
  references: Array<{
    modelName: string;
    id: ObjectID | undefined;
    service: unknown;
  }>;
}

function validatedReferencesAt(
  spy: jest.SpyInstance,
  index: number,
): ValidatedReferences {
  return spy.mock.calls[index]![0] as ValidatedReferences;
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

/*
 * A rule that neither raises an alert nor declares an incident is a rule the
 * evaluation worker keeps evaluating forever while producing nothing, and
 * nothing downstream ever revisits it. Both flags reach this hook through the
 * public CRUD API, where BaseModel.fromJSON does NOT coerce Boolean columns -
 * so "false" arrives as a non-empty, and therefore truthy, string.
 */
describe("ServiceLevelObjectiveBurnRateRuleService.onBeforeCreate - what the rule declares", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * Both values are written back rather than left to the column defaults:
   * validateOutputsOnUpdate and onUpdateSuccess read these off the persisted
   * row later, and a create that never mentioned them would leave those hooks
   * reading `undefined` for a decision this create actually made.
   */
  it("defaults to raising an alert and declaring no incident, and writes both decisions onto the payload", async () => {
    const createBy: CreateBy<ServiceLevelObjectiveBurnRateRule> =
      makeValidCreateBy({});

    await expect(callHook("onBeforeCreate", createBy)).resolves.toBeDefined();

    expect(createBy.data.shouldCreateAlert).toBe(true);
    expect(createBy.data.shouldCreateIncident).toBe(false);
    expect(typeof createBy.data.shouldCreateAlert).toBe("boolean");
    expect(typeof createBy.data.shouldCreateIncident).toBe("boolean");
  });

  const acceptedOutputs: Array<{
    label: string;
    shouldCreateAlert: unknown;
    shouldCreateIncident: unknown;
    expectedShouldCreateAlert: boolean;
    expectedShouldCreateIncident: boolean;
  }> = [
    {
      label: "an alert-only rule",
      shouldCreateAlert: true,
      shouldCreateIncident: false,
      expectedShouldCreateAlert: true,
      expectedShouldCreateIncident: false,
    },
    {
      label: "an incident-only rule",
      shouldCreateAlert: false,
      shouldCreateIncident: true,
      expectedShouldCreateAlert: false,
      expectedShouldCreateIncident: true,
    },
    {
      label: "a rule that does both",
      shouldCreateAlert: true,
      shouldCreateIncident: true,
      expectedShouldCreateAlert: true,
      expectedShouldCreateIncident: true,
    },
    {
      label: 'alerts switched off with the string "false"',
      shouldCreateAlert: "false",
      shouldCreateIncident: true,
      expectedShouldCreateAlert: false,
      expectedShouldCreateIncident: true,
    },
    {
      label: 'alerts switched off with the string "FALSE"',
      shouldCreateAlert: "FALSE",
      shouldCreateIncident: true,
      expectedShouldCreateAlert: false,
      expectedShouldCreateIncident: true,
    },
    {
      label: 'alerts switched off with a padded " false "',
      shouldCreateAlert: " false ",
      shouldCreateIncident: true,
      expectedShouldCreateAlert: false,
      expectedShouldCreateIncident: true,
    },
    {
      label: 'alerts switched off with the string "0"',
      shouldCreateAlert: "0",
      shouldCreateIncident: true,
      expectedShouldCreateAlert: false,
      expectedShouldCreateIncident: true,
    },
    {
      label: 'incidents switched on with the string "true"',
      shouldCreateAlert: false,
      shouldCreateIncident: "true",
      expectedShouldCreateAlert: false,
      expectedShouldCreateIncident: true,
    },
    {
      label: 'incidents switched on with the string "1"',
      shouldCreateAlert: false,
      shouldCreateIncident: "1",
      expectedShouldCreateAlert: false,
      expectedShouldCreateIncident: true,
    },
    {
      label: 'incidents switched on with an unrecognised string like "yes"',
      shouldCreateAlert: false,
      shouldCreateIncident: "yes",
      expectedShouldCreateAlert: false,
      expectedShouldCreateIncident: true,
    },
    {
      label: "an empty string for incidents, which falls back to the default",
      shouldCreateAlert: true,
      shouldCreateIncident: "",
      expectedShouldCreateAlert: true,
      expectedShouldCreateIncident: false,
    },
    {
      label: "an empty string for alerts, which falls back to the default",
      shouldCreateAlert: "",
      shouldCreateIncident: false,
      expectedShouldCreateAlert: true,
      expectedShouldCreateIncident: false,
    },
    {
      // Anything that is neither boolean nor string falls through to Boolean().
      label: "the numbers a hand-written API call sends instead of booleans",
      shouldCreateAlert: 0,
      shouldCreateIncident: 1,
      expectedShouldCreateAlert: false,
      expectedShouldCreateIncident: true,
    },
  ];

  for (const acceptedOutput of acceptedOutputs) {
    it(`accepts ${acceptedOutput.label}, and persists the coerced booleans`, async () => {
      const createBy: CreateBy<ServiceLevelObjectiveBurnRateRule> =
        makeValidCreateBy({
          shouldCreateAlert: acceptedOutput.shouldCreateAlert,
          shouldCreateIncident: acceptedOutput.shouldCreateIncident,
        });

      await expect(callHook("onBeforeCreate", createBy)).resolves.toBeDefined();

      expect(createBy.data.shouldCreateAlert).toBe(
        acceptedOutput.expectedShouldCreateAlert,
      );
      expect(createBy.data.shouldCreateIncident).toBe(
        acceptedOutput.expectedShouldCreateIncident,
      );
      expect(typeof createBy.data.shouldCreateAlert).toBe("boolean");
      expect(typeof createBy.data.shouldCreateIncident).toBe("boolean");
    });
  }

  const rejectedOutputs: Array<{ label: string; fields: RuleFields }> = [
    {
      label: "both outputs switched off as real booleans",
      fields: { shouldCreateAlert: false, shouldCreateIncident: false },
    },
    {
      label: "alerts switched off with incidents never mentioned",
      fields: { shouldCreateAlert: false },
    },
    {
      label: "alerts switched off with incidents sent as an empty string",
      fields: { shouldCreateAlert: false, shouldCreateIncident: "" },
    },
    {
      label: "alerts switched off with incidents sent as null",
      fields: { shouldCreateAlert: false, shouldCreateIncident: null },
    },
    {
      label: 'alerts off as " FALSE " with incidents off as the string "0"',
      fields: { shouldCreateAlert: " FALSE ", shouldCreateIncident: "0" },
    },
    {
      label: "a numeric 0 for alerts with incidents left at their default",
      fields: { shouldCreateAlert: 0 },
    },
  ];

  for (const rejectedOutput of rejectedOutputs) {
    it(`rejects ${rejectedOutput.label}`, async () => {
      await expectBadData(
        callHook("onBeforeCreate", makeValidCreateBy(rejectedOutput.fields)),
        NO_OUTPUT_ERROR_MESSAGE,
      );
    });
  }

  /*
   * The regression the coercion exists for: a plain
   * `if (!data.shouldCreateAlert && !data.shouldCreateIncident)` ACCEPTS this
   * payload, because the string "false" is truthy. The rule is then persisted
   * declaring nothing at all, and no later hook ever looks at it again.
   */
  it('rejects a payload whose flags are the STRING "false", which a truthiness check would wave through', async () => {
    await expectBadData(
      callHook(
        "onBeforeCreate",
        makeValidCreateBy({
          shouldCreateAlert: "false",
          shouldCreateIncident: "false",
        }),
      ),
      NO_OUTPUT_ERROR_MESSAGE,
    );
  });
});

/*
 * Both severity columns are plain foreign keys with no project scoping of
 * their own, so a severity id from another project is persisted happily and
 * only fails much later - inside the evaluation worker, on every tick, where
 * the throw becomes a log line. The rule looks configured and declares nothing
 * forever, which is why the reference is checked at write time instead.
 */
describe("ServiceLevelObjectiveBurnRateRuleService.onBeforeCreate - severity references", () => {
  let validatorSpy: jest.SpyInstance;

  beforeEach(() => {
    validatorSpy = jest
      .spyOn(
        ProjectScopedReferenceValidator,
        "validateReferencesBelongToProject",
      )
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does not reach for the validator when the rule names no severity at all", async () => {
    await expect(
      callHook("onBeforeCreate", makeValidCreateBy({})),
    ).resolves.toBeDefined();

    expect(validatorSpy).not.toHaveBeenCalled();
  });

  const severityPayloads: Array<{
    label: string;
    alertSeverityId: ObjectID | undefined;
    incidentSeverityId: ObjectID | undefined;
  }> = [
    {
      label: "an alert severity alone",
      alertSeverityId: ALERT_SEVERITY_ID,
      incidentSeverityId: undefined,
    },
    {
      label: "an incident severity alone",
      alertSeverityId: undefined,
      incidentSeverityId: INCIDENT_SEVERITY_ID,
    },
    {
      label: "both severities",
      alertSeverityId: ALERT_SEVERITY_ID,
      incidentSeverityId: INCIDENT_SEVERITY_ID,
    },
  ];

  severityPayloads.forEach(
    (severityPayload: {
      label: string;
      alertSeverityId: ObjectID | undefined;
      incidentSeverityId: ObjectID | undefined;
    }): void => {
      it(`validates ${severityPayload.label} against the rule's own project, in one call`, async () => {
        await expect(
          callHook(
            "onBeforeCreate",
            makeValidCreateBy({
              alertSeverityId: severityPayload.alertSeverityId,
              incidentSeverityId: severityPayload.incidentSeverityId,
            }),
          ),
        ).resolves.toBeDefined();

        expect(validatorSpy).toHaveBeenCalledTimes(1);

        const validated: ValidatedReferences = validatedReferencesAt(
          validatorSpy,
          0,
        );

        expect(validated.projectId).toEqual(PROJECT_ID);
        // The subject is what the user-facing error message is phrased around.
        expect(validated.subject).toBe("SLO burn rate rule");

        /*
         * Both references are always passed, absent id included - the validator
         * skips the empty ones itself, and passing both keeps one lookup per
         * referenced model rather than one per present id.
         */
        expect(validated.references).toHaveLength(2);
        expect(validated.references[0]!.modelName).toBe("Alert Severity");
        expect(validated.references[0]!.id).toEqual(
          severityPayload.alertSeverityId,
        );
        expect(validated.references[0]!.service).toBe(AlertSeverityService);
        expect(validated.references[1]!.modelName).toBe("Incident Severity");
        expect(validated.references[1]!.id).toEqual(
          severityPayload.incidentSeverityId,
        );
        expect(validated.references[1]!.service).toBe(IncidentSeverityService);
      });
    },
  );

  it("falls back to the caller's tenant when the payload itself carries no project", async () => {
    await expect(
      callHook(
        "onBeforeCreate",
        makeValidCreateBy(
          {
            projectId: undefined,
            incidentSeverityId: INCIDENT_SEVERITY_ID,
          },
          { isRoot: true, tenantId: PROJECT_ID },
        ),
      ),
    ).resolves.toBeDefined();

    expect(validatorSpy).toHaveBeenCalledTimes(1);
    expect(validatedReferencesAt(validatorSpy, 0).projectId).toEqual(
      PROJECT_ID,
    );
  });

  /*
   * With no project on either side there is nothing to compare against, and
   * the write is going to fail anyway on the required tenant column. Failing
   * here instead would replace that clear error with a confusing severity one.
   */
  it("skips validation entirely when neither the payload nor the caller names a project", async () => {
    await expect(
      callHook(
        "onBeforeCreate",
        makeValidCreateBy({
          projectId: undefined,
          alertSeverityId: ALERT_SEVERITY_ID,
          incidentSeverityId: INCIDENT_SEVERITY_ID,
        }),
      ),
    ).resolves.toBeDefined();

    expect(validatorSpy).not.toHaveBeenCalled();
  });

  it("lets a cross-project severity rejection abort the create", async () => {
    validatorSpy.mockRejectedValue(
      new BadDataException(
        "This SLO burn rate rule references records that belong to a different project.",
      ),
    );

    await expectBadData(
      callHook(
        "onBeforeCreate",
        makeValidCreateBy({ incidentSeverityId: INCIDENT_SEVERITY_ID }),
      ),
      "belong to a different project",
    );
  });
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
 * The update twin of the create guard, with the extra problem that a form
 * sends only the field the user touched: turning alerts off must be allowed on
 * a rule that already declares incidents and refused on one that declares
 * nothing else. So the check is made against the row that will EXIST after the
 * write - but only when the payload could actually leave a rule empty, because
 * reading the affected rows back costs a query on every update that touches
 * these columns.
 */
describe("ServiceLevelObjectiveBurnRateRuleService.onBeforeUpdate - what the rule declares", () => {
  let findBySpy: jest.SpyInstance;

  beforeEach(() => {
    findBySpy = jest.spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("issues no row read at all when the payload mentions neither output", async () => {
    await expect(
      callHook("onBeforeUpdate", makeUpdateBy({ isEnabled: true })),
    ).resolves.toBeDefined();

    expect(findBySpy).not.toHaveBeenCalled();
  });

  it("treats explicitly null output flags as 'not being updated'", async () => {
    await expect(
      callHook(
        "onBeforeUpdate",
        makeUpdateBy({ shouldCreateAlert: null, shouldCreateIncident: null }),
      ),
    ).resolves.toBeDefined();

    expect(findBySpy).not.toHaveBeenCalled();
  });

  it("rejects a payload that turns both outputs off, without reading a single row", async () => {
    await expectBadData(
      callHook(
        "onBeforeUpdate",
        makeUpdateBy({ shouldCreateAlert: false, shouldCreateIncident: false }),
      ),
      NO_OUTPUT_ERROR_MESSAGE,
    );

    // Both flags are in the payload, so the resulting row is already known.
    expect(findBySpy).not.toHaveBeenCalled();
  });

  it('rejects both outputs turned off as the strings "false" and "FALSE"', async () => {
    await expectBadData(
      callHook(
        "onBeforeUpdate",
        makeUpdateBy({
          shouldCreateAlert: "false",
          shouldCreateIncident: "FALSE",
        }),
      ),
      NO_OUTPUT_ERROR_MESSAGE,
    );

    expect(findBySpy).not.toHaveBeenCalled();
  });

  it("accepts a payload that turns both outputs on", async () => {
    await expect(
      callHook(
        "onBeforeUpdate",
        makeUpdateBy({ shouldCreateAlert: true, shouldCreateIncident: true }),
      ),
    ).resolves.toBeDefined();

    expect(findBySpy).not.toHaveBeenCalled();
  });

  const outputsSwitchedOn: Array<{ label: string; fields: RuleFields }> = [
    { label: "alerts", fields: { shouldCreateAlert: true } },
    { label: "incidents", fields: { shouldCreateIncident: true } },
    {
      label: 'alerts as the string "true"',
      fields: { shouldCreateAlert: "true" },
    },
    {
      label: 'incidents as the string "1"',
      fields: { shouldCreateIncident: "1" },
    },
  ];

  outputsSwitchedOn.forEach(
    (switchedOn: { label: string; fields: RuleFields }): void => {
      /*
       * A deliberate short-circuit, not an oversight: switching one output ON
       * cannot leave a rule with nothing whatever its sibling holds, so the
       * affected rows are never read.
       */
      it(`accepts turning ${switchedOn.label} on without reading any row`, async () => {
        await expect(
          callHook("onBeforeUpdate", makeUpdateBy(switchedOn.fields)),
        ).resolves.toBeDefined();

        expect(findBySpy).not.toHaveBeenCalled();
      });
    },
  );

  it("reads the affected rows as root, through the caller's own query, when the only flag written turns alerts off", async () => {
    findBySpy.mockResolvedValue([
      makeRule({
        _id: RULE_ID.toString(),
        id: RULE_ID,
        shouldCreateIncident: true,
      }),
    ]);

    await expect(
      callHook("onBeforeUpdate", makeUpdateBy({ shouldCreateAlert: false })),
    ).resolves.toBeDefined();

    expect(findBySpy).toHaveBeenCalledTimes(1);

    const findByArguments: FindByArguments = findByArgumentsAt(findBySpy, 0);

    expect(findByArguments.query).toEqual({ _id: RULE_ID.toString() });
    // Only the sibling flags matter; the id keeps the read cheap to reason about.
    expect(findByArguments.select).toEqual({
      _id: true,
      shouldCreateAlert: true,
      shouldCreateIncident: true,
    });
    expect(findByArguments.props).toEqual({ isRoot: true });
  });

  const acceptedAgainstSibling: Array<{
    label: string;
    fields: RuleFields;
    persisted: RuleFields;
  }> = [
    {
      label: "turning alerts off on a rule that declares incidents",
      fields: { shouldCreateAlert: false },
      persisted: { shouldCreateIncident: true },
    },
    {
      label: "turning incidents off on a rule that still raises alerts",
      fields: { shouldCreateIncident: false },
      persisted: { shouldCreateAlert: true },
    },
    {
      label:
        "turning incidents off on a row that never stored shouldCreateAlert, which defaults to true",
      fields: { shouldCreateIncident: false },
      persisted: {},
    },
    {
      /*
       * Legacy rows can hold a string in a Boolean column - written before the
       * coercion existed, or by a raw API call - so the PERSISTED sibling is
       * coerced too. Reading "true" as truthy happens to work; reading "false"
       * as truthy (the case below) does not.
       */
      label: 'turning alerts off on a legacy row storing "true" for incidents',
      fields: { shouldCreateAlert: false },
      persisted: { shouldCreateIncident: "true" },
    },
  ];

  acceptedAgainstSibling.forEach(
    (accepted: {
      label: string;
      fields: RuleFields;
      persisted: RuleFields;
    }): void => {
      it(`accepts ${accepted.label}`, async () => {
        findBySpy.mockResolvedValue([
          makeRule({
            _id: RULE_ID.toString(),
            id: RULE_ID,
            ...accepted.persisted,
          }),
        ]);

        await expect(
          callHook("onBeforeUpdate", makeUpdateBy(accepted.fields)),
        ).resolves.toBeDefined();

        expect(findBySpy).toHaveBeenCalledTimes(1);
      });
    },
  );

  const rejectedAgainstSibling: Array<{
    label: string;
    fields: RuleFields;
    persisted: RuleFields;
  }> = [
    {
      label: "turning alerts off on a rule that declares nothing else",
      fields: { shouldCreateAlert: false },
      persisted: { shouldCreateIncident: false },
    },
    {
      label: "turning incidents off on a rule whose alerts are already off",
      fields: { shouldCreateIncident: false },
      persisted: { shouldCreateAlert: false },
    },
    {
      label:
        "turning alerts off on a row that never stored shouldCreateIncident, which defaults to false",
      fields: { shouldCreateAlert: false },
      persisted: {},
    },
    {
      /*
       * The legacy-row regression: "false" is a truthy string, so a sibling
       * read without coercion says "this rule still raises alerts" and the
       * update leaves a rule declaring nothing.
       */
      label: 'turning incidents off on a legacy row storing "false" for alerts',
      fields: { shouldCreateIncident: false },
      persisted: { shouldCreateAlert: "false" },
    },
  ];

  rejectedAgainstSibling.forEach(
    (rejected: {
      label: string;
      fields: RuleFields;
      persisted: RuleFields;
    }): void => {
      it(`rejects ${rejected.label}`, async () => {
        findBySpy.mockResolvedValue([
          makeRule({
            _id: RULE_ID.toString(),
            id: RULE_ID,
            ...rejected.persisted,
          }),
        ]);

        await expectBadData(
          callHook("onBeforeUpdate", makeUpdateBy(rejected.fields)),
          NO_OUTPUT_ERROR_MESSAGE,
        );
      });
    },
  );

  it("rejects a bulk update as soon as ANY matched rule would be left declaring nothing", async () => {
    findBySpy.mockResolvedValue([
      makeRule({
        _id: RULE_ID.toString(),
        id: RULE_ID,
        shouldCreateIncident: true,
      }),
      makeRule({
        _id: OTHER_RULE_ID.toString(),
        id: OTHER_RULE_ID,
        shouldCreateIncident: false,
      }),
    ]);

    /*
     * The first rule survives losing its alert because it declares incidents;
     * the second does not - and one casualty fails the whole update.
     */
    await expectBadData(
      callHook("onBeforeUpdate", makeUpdateBy({ shouldCreateAlert: false })),
      NO_OUTPUT_ERROR_MESSAGE,
    );
  });

  it("accepts a bulk update that leaves every matched rule still declaring something", async () => {
    findBySpy.mockResolvedValue([
      makeRule({
        _id: RULE_ID.toString(),
        id: RULE_ID,
        shouldCreateIncident: true,
      }),
      makeRule({
        _id: OTHER_RULE_ID.toString(),
        id: OTHER_RULE_ID,
        shouldCreateIncident: true,
      }),
    ]);

    await expect(
      callHook("onBeforeUpdate", makeUpdateBy({ shouldCreateAlert: false })),
    ).resolves.toBeDefined();
  });

  it("accepts a single output switched off when the query matches no rows at all", async () => {
    findBySpy.mockResolvedValue([]);

    await expect(
      callHook("onBeforeUpdate", makeUpdateBy({ shouldCreateIncident: false })),
    ).resolves.toBeDefined();
  });

  it("writes both coerced booleans back onto the update payload", async () => {
    const updateBy: UpdateBy<ServiceLevelObjectiveBurnRateRule> = makeUpdateBy({
      shouldCreateAlert: "false",
      shouldCreateIncident: "true",
    });

    await expect(callHook("onBeforeUpdate", updateBy)).resolves.toBeDefined();

    /*
     * onUpdateSuccess decides what to resolve with a strict `=== false`, so a
     * string that survived this hook would silently strand the open alert the
     * user just switched off.
     */
    expect(updateBy.data.shouldCreateAlert).toBe(false);
    expect(updateBy.data.shouldCreateIncident).toBe(true);
    expect(typeof updateBy.data.shouldCreateAlert).toBe("boolean");
    expect(typeof updateBy.data.shouldCreateIncident).toBe("boolean");
  });

  it("writes the coerced boolean back even when only one flag is being written", async () => {
    findBySpy.mockResolvedValue([
      makeRule({
        _id: RULE_ID.toString(),
        id: RULE_ID,
        shouldCreateIncident: true,
      }),
    ]);

    const updateBy: UpdateBy<ServiceLevelObjectiveBurnRateRule> = makeUpdateBy({
      shouldCreateAlert: "0",
    });

    await expect(callHook("onBeforeUpdate", updateBy)).resolves.toBeDefined();

    expect(updateBy.data.shouldCreateAlert).toBe(false);
    expect(typeof updateBy.data.shouldCreateAlert).toBe("boolean");
  });
});

/*
 * The update twin of the severity guard. A root or API update does not always
 * carry a tenant, so the projects to validate against come from the rows the
 * query actually matches.
 */
describe("ServiceLevelObjectiveBurnRateRuleService.onBeforeUpdate - severity references", () => {
  let findBySpy: jest.SpyInstance;
  let validatorSpy: jest.SpyInstance;

  beforeEach(() => {
    findBySpy = jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy")
      .mockResolvedValue([]);

    validatorSpy = jest
      .spyOn(
        ProjectScopedReferenceValidator,
        "validateReferencesBelongToProject",
      )
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("neither validates nor reads any row when no severity is being changed", async () => {
    await expect(
      callHook("onBeforeUpdate", makeUpdateBy({ name: "Renamed rule" })),
    ).resolves.toBeDefined();

    expect(validatorSpy).not.toHaveBeenCalled();
    expect(findBySpy).not.toHaveBeenCalled();
  });

  const updatedSeverities: Array<{
    label: string;
    fields: RuleFields;
    expectedAlertSeverityId: ObjectID | undefined;
    expectedIncidentSeverityId: ObjectID | undefined;
  }> = [
    {
      label: "an alert severity alone",
      fields: { alertSeverityId: ALERT_SEVERITY_ID },
      expectedAlertSeverityId: ALERT_SEVERITY_ID,
      expectedIncidentSeverityId: undefined,
    },
    {
      label: "an incident severity alone",
      fields: { incidentSeverityId: INCIDENT_SEVERITY_ID },
      expectedAlertSeverityId: undefined,
      expectedIncidentSeverityId: INCIDENT_SEVERITY_ID,
    },
    {
      label: "both severities at once",
      fields: {
        alertSeverityId: ALERT_SEVERITY_ID,
        incidentSeverityId: INCIDENT_SEVERITY_ID,
      },
      expectedAlertSeverityId: ALERT_SEVERITY_ID,
      expectedIncidentSeverityId: INCIDENT_SEVERITY_ID,
    },
  ];

  updatedSeverities.forEach(
    (updatedSeverity: {
      label: string;
      fields: RuleFields;
      expectedAlertSeverityId: ObjectID | undefined;
      expectedIncidentSeverityId: ObjectID | undefined;
    }): void => {
      it(`validates ${updatedSeverity.label} against the caller's tenant, without reading any row`, async () => {
        await expect(
          callHook(
            "onBeforeUpdate",
            makeUpdateBy(updatedSeverity.fields, {
              isRoot: true,
              tenantId: PROJECT_ID,
            }),
          ),
        ).resolves.toBeDefined();

        // A known tenant makes the row read unnecessary.
        expect(findBySpy).not.toHaveBeenCalled();
        expect(validatorSpy).toHaveBeenCalledTimes(1);

        const validated: ValidatedReferences = validatedReferencesAt(
          validatorSpy,
          0,
        );

        expect(validated.projectId).toEqual(PROJECT_ID);
        expect(validated.subject).toBe("SLO burn rate rule");
        expect(validated.references[0]!.id).toEqual(
          updatedSeverity.expectedAlertSeverityId,
        );
        expect(validated.references[1]!.id).toEqual(
          updatedSeverity.expectedIncidentSeverityId,
        );
      });
    },
  );

  it("falls back to the projects of the matched rows, deduplicated, when the update carries no tenant", async () => {
    findBySpy.mockResolvedValue([
      makeRule({
        _id: RULE_ID.toString(),
        id: RULE_ID,
        projectId: PROJECT_ID,
      }),
      makeRule({
        _id: OTHER_RULE_ID.toString(),
        id: OTHER_RULE_ID,
        projectId: PROJECT_ID,
      }),
    ]);

    await expect(
      callHook(
        "onBeforeUpdate",
        makeUpdateBy({ incidentSeverityId: INCIDENT_SEVERITY_ID }),
      ),
    ).resolves.toBeDefined();

    expect(findBySpy).toHaveBeenCalledTimes(1);
    expect(findByArgumentsAt(findBySpy, 0).select).toEqual({
      projectId: true,
    });
    expect(findByArgumentsAt(findBySpy, 0).props).toEqual({ isRoot: true });

    // Two rules, one project: the lookup must not run per rule.
    expect(validatorSpy).toHaveBeenCalledTimes(1);
    expect(validatedReferencesAt(validatorSpy, 0).projectId).toEqual(
      PROJECT_ID,
    );
  });

  it("validates each distinct project when the query spans two of them", async () => {
    findBySpy.mockResolvedValue([
      makeRule({
        _id: RULE_ID.toString(),
        id: RULE_ID,
        projectId: PROJECT_ID,
      }),
      makeRule({
        _id: OTHER_RULE_ID.toString(),
        id: OTHER_RULE_ID,
        projectId: OTHER_PROJECT_ID,
      }),
    ]);

    await expect(
      callHook(
        "onBeforeUpdate",
        makeUpdateBy({ alertSeverityId: ALERT_SEVERITY_ID }),
      ),
    ).resolves.toBeDefined();

    expect(validatorSpy).toHaveBeenCalledTimes(2);
    expect(validatedReferencesAt(validatorSpy, 0).projectId).toEqual(
      PROJECT_ID,
    );
    expect(validatedReferencesAt(validatorSpy, 1).projectId).toEqual(
      OTHER_PROJECT_ID,
    );
  });

  it("validates nothing when no matched row carries a project", async () => {
    findBySpy.mockResolvedValue([
      makeRule({ _id: RULE_ID.toString(), id: RULE_ID }),
    ]);

    await expect(
      callHook(
        "onBeforeUpdate",
        makeUpdateBy({ alertSeverityId: ALERT_SEVERITY_ID }),
      ),
    ).resolves.toBeDefined();

    expect(validatorSpy).not.toHaveBeenCalled();
  });

  it("lets a cross-project severity rejection abort the update", async () => {
    validatorSpy.mockRejectedValue(
      new BadDataException(
        "This SLO burn rate rule references records that belong to a different project.",
      ),
    );

    await expectBadData(
      callHook(
        "onBeforeUpdate",
        makeUpdateBy(
          { alertSeverityId: ALERT_SEVERITY_ID },
          { isRoot: true, tenantId: PROJECT_ID },
        ),
      ),
      "belong to a different project",
    );
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

describe("ServiceLevelObjectiveBurnRateRuleService.getBurnRateFingerprint", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("is exactly slo:<sloId>:burn-rule:<ruleId>", () => {
    expect(
      ServiceLevelObjectiveBurnRateRuleService.getBurnRateFingerprint({
        serviceLevelObjectiveId: SLO_ID,
        burnRateRuleId: RULE_ID,
      }),
    ).toBe(`slo:${SLO_ID.toString()}:burn-rule:${RULE_ID.toString()}`);
  });

  it("is deterministic across calls", () => {
    const first: string =
      ServiceLevelObjectiveBurnRateRuleService.getBurnRateFingerprint({
        serviceLevelObjectiveId: SLO_ID,
        burnRateRuleId: RULE_ID,
      });
    const second: string =
      ServiceLevelObjectiveBurnRateRuleService.getBurnRateFingerprint({
        serviceLevelObjectiveId: SLO_ID,
        burnRateRuleId: RULE_ID,
      });

    expect(second).toBe(first);
  });

  it("distinguishes two rules of the same SLO", () => {
    const first: string =
      ServiceLevelObjectiveBurnRateRuleService.getBurnRateFingerprint({
        serviceLevelObjectiveId: SLO_ID,
        burnRateRuleId: RULE_ID,
      });
    const second: string =
      ServiceLevelObjectiveBurnRateRuleService.getBurnRateFingerprint({
        serviceLevelObjectiveId: SLO_ID,
        burnRateRuleId: OTHER_RULE_ID,
      });

    expect(second).not.toBe(first);
  });

  it("distinguishes the same rule id under two different SLOs", () => {
    const first: string =
      ServiceLevelObjectiveBurnRateRuleService.getBurnRateFingerprint({
        serviceLevelObjectiveId: SLO_ID,
        burnRateRuleId: RULE_ID,
      });
    const second: string =
      ServiceLevelObjectiveBurnRateRuleService.getBurnRateFingerprint({
        serviceLevelObjectiveId: OTHER_RULE_ID,
        burnRateRuleId: RULE_ID,
      });

    expect(second).not.toBe(first);
  });

  /*
   * One fingerprint, two tables - which is what the rename away from
   * getBurnRateAlertFingerprint was about. The Incident lookup must query with
   * the SAME string the Alert lookup does, so a rule that declared both is
   * found on both sides; two fingerprints would silently strand whichever side
   * drifted, with no error anywhere to notice it by.
   */
  it("is the exact string both the alert lookup and the incident lookup query with", async () => {
    const alertFindBySpy: jest.SpyInstance = jest
      .spyOn(AlertService, "findBy")
      .mockResolvedValue([]);
    const incidentFindBySpy: jest.SpyInstance = jest
      .spyOn(IncidentService, "findBy")
      .mockResolvedValue([]);

    await ServiceLevelObjectiveBurnRateRuleService.resolveOpenAlertsForRule({
      serviceLevelObjectiveId: SLO_ID,
      burnRateRuleId: RULE_ID,
      projectId: PROJECT_ID,
    });
    await ServiceLevelObjectiveBurnRateRuleService.resolveOpenIncidentsForRule({
      serviceLevelObjectiveId: SLO_ID,
      burnRateRuleId: RULE_ID,
      projectId: PROJECT_ID,
    });

    const fingerprint: string =
      ServiceLevelObjectiveBurnRateRuleService.getBurnRateFingerprint({
        serviceLevelObjectiveId: SLO_ID,
        burnRateRuleId: RULE_ID,
      });

    expect(
      findByArgumentsAt(alertFindBySpy, 0).query["seriesFingerprint"],
    ).toBe(fingerprint);
    expect(
      findByArgumentsAt(incidentFindBySpy, 0).query["seriesFingerprint"],
    ).toBe(fingerprint);
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

  it("keeps resolving the remaining alerts after one alert fails, then reports the failure", async () => {
    const firstAlertId: ObjectID = ObjectID.generate();
    const secondAlertId: ObjectID = ObjectID.generate();

    alertFindBySpy.mockResolvedValue([
      makeAlert(firstAlertId),
      makeAlert(secondAlertId),
    ]);

    timelineCreateSpy
      .mockRejectedValueOnce(new Error("write conflict"))
      .mockResolvedValueOnce(new AlertStateTimeline());

    /*
     * Isolation and reporting are both required, and they pull in opposite
     * directions: the second alert still has to be resolved, and the caller
     * still has to learn the first one was not. Every caller treats a clean
     * return as "nothing is open any more" — the worker stamps the rule
     * resolved on it, and the Paused / Misconfigured guard commits a status
     * change that makes the attempt one-shot — so a swallowed failure here
     * strands that alert and its on-call escalation permanently.
     */
    await expect(
      ServiceLevelObjectiveBurnRateRuleService.resolveOpenAlertsForRule({
        serviceLevelObjectiveId: SLO_ID,
        burnRateRuleId: RULE_ID,
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow("write conflict");

    expect(timelineCreateSpy).toHaveBeenCalledTimes(2);
    expect(timelineRows()[1]!.alertId).toEqual(secondAlertId);
  });

  it("reports the FIRST failure when more than one alert fails", async () => {
    alertFindBySpy.mockResolvedValue([
      makeAlert(ObjectID.generate()),
      makeAlert(ObjectID.generate()),
    ]);

    timelineCreateSpy
      .mockRejectedValueOnce(new Error("first failure"))
      .mockRejectedValueOnce(new Error("second failure"));

    await expect(
      ServiceLevelObjectiveBurnRateRuleService.resolveOpenAlertsForRule({
        serviceLevelObjectiveId: SLO_ID,
        burnRateRuleId: RULE_ID,
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow("first failure");

    expect(timelineCreateSpy).toHaveBeenCalledTimes(2);
  });

  it("does not swallow a non-benign BadDataException - it is logged and reported", async () => {
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
    ).rejects.toThrow("Some other validation problem.");

    expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
  });

  it("resolves cleanly when the only failure was the benign same-state race", async () => {
    alertFindBySpy.mockResolvedValue([
      makeAlert(ObjectID.generate()),
      makeAlert(ObjectID.generate()),
    ]);

    /*
     * The race is not a failure: two writers agreeing the alert is resolved is
     * the outcome the caller wanted. Counting it would make a healthy resolve
     * look like one that needs retrying.
     */
    timelineCreateSpy
      .mockRejectedValueOnce(new BadDataException(SAME_STATE_RACE_MESSAGE))
      .mockResolvedValueOnce(new AlertStateTimeline());

    await expect(
      ServiceLevelObjectiveBurnRateRuleService.resolveOpenAlertsForRule({
        serviceLevelObjectiveId: SLO_ID,
        burnRateRuleId: RULE_ID,
        projectId: PROJECT_ID,
      }),
    ).resolves.toBeUndefined();
  });
});

/*
 * The incident twin of the suite above: same shape, different table. It is a
 * separate method rather than a branch of the alert path because the two
 * lifecycles are resolved independently - switching `shouldCreateIncident` off
 * must close the incident and leave the alert exactly where it is.
 */
describe("ServiceLevelObjectiveBurnRateRuleService.resolveOpenIncidentsForRule", () => {
  let incidentFindBySpy: jest.SpyInstance;
  let resolvedStateSpy: jest.SpyInstance;
  let timelineCreateSpy: jest.SpyInstance;

  beforeEach(() => {
    incidentFindBySpy = jest
      .spyOn(IncidentService, "findBy")
      .mockResolvedValue([]);

    resolvedStateSpy = jest
      .spyOn(IncidentStateTimelineService, "getResolvedStateIdForProject")
      .mockResolvedValue(RESOLVED_STATE_ID);

    timelineCreateSpy = jest
      .spyOn(IncidentStateTimelineService, "create")
      .mockResolvedValue(new IncidentStateTimeline());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function timelineRows(): Array<IncidentStateTimeline> {
    return timelineCreateSpy.mock.calls.map((call: Array<unknown>) => {
      return (call[0] as CreateBy<IncidentStateTimeline>).data;
    });
  }

  it("looks up only the unresolved incidents carrying this rule's fingerprint", async () => {
    await ServiceLevelObjectiveBurnRateRuleService.resolveOpenIncidentsForRule({
      serviceLevelObjectiveId: SLO_ID,
      burnRateRuleId: RULE_ID,
      projectId: PROJECT_ID,
    });

    const findByArguments: FindByArguments = findByArgumentsAt(
      incidentFindBySpy,
      0,
    );

    expect(findByArguments.query).toEqual({
      projectId: PROJECT_ID,
      seriesFingerprint: `slo:${SLO_ID.toString()}:burn-rule:${RULE_ID.toString()}`,
      currentIncidentState: { isResolvedState: false },
    });
    // projectId is needed on each row to stamp the timeline entry.
    expect(findByArguments.select).toEqual({ _id: true, projectId: true });
    expect(findByArguments.props).toEqual({ isRoot: true });
  });

  /*
   * getResolvedStateIdForProject THROWS when a project has no resolved
   * incident state, so asking for it before there is anything to resolve would
   * fail a project for a state it never needed.
   */
  it("is a no-op when the rule has no open incidents, and never asks for the resolved state", async () => {
    await ServiceLevelObjectiveBurnRateRuleService.resolveOpenIncidentsForRule({
      serviceLevelObjectiveId: SLO_ID,
      burnRateRuleId: RULE_ID,
      projectId: PROJECT_ID,
    });

    expect(resolvedStateSpy).not.toHaveBeenCalled();
    expect(timelineCreateSpy).not.toHaveBeenCalled();
  });

  it("appends one resolved state timeline row per open incident", async () => {
    const firstIncidentId: ObjectID = ObjectID.generate();
    const secondIncidentId: ObjectID = ObjectID.generate();

    incidentFindBySpy.mockResolvedValue([
      makeIncident(firstIncidentId),
      makeIncident(secondIncidentId),
    ]);

    await ServiceLevelObjectiveBurnRateRuleService.resolveOpenIncidentsForRule({
      serviceLevelObjectiveId: SLO_ID,
      burnRateRuleId: RULE_ID,
      projectId: PROJECT_ID,
    });

    // The resolved state is looked up once for the whole batch.
    expect(resolvedStateSpy).toHaveBeenCalledTimes(1);
    expect(resolvedStateSpy).toHaveBeenCalledWith(PROJECT_ID);

    const rows: Array<IncidentStateTimeline> = timelineRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.incidentId).toEqual(firstIncidentId);
    expect(rows[1]!.incidentId).toEqual(secondIncidentId);

    for (const row of rows) {
      expect(row.incidentStateId).toEqual(RESOLVED_STATE_ID);
      expect(row.projectId).toEqual(PROJECT_ID);
    }

    for (const call of timelineCreateSpy.mock.calls) {
      const createBy: CreateBy<IncidentStateTimeline> = (
        call as Array<unknown>
      )[0] as CreateBy<IncidentStateTimeline>;
      expect(createBy.props).toEqual({ isRoot: true });
    }
  });

  it("falls back to the generic root cause when the caller supplies none", async () => {
    incidentFindBySpy.mockResolvedValue([makeIncident(ObjectID.generate())]);

    await ServiceLevelObjectiveBurnRateRuleService.resolveOpenIncidentsForRule({
      serviceLevelObjectiveId: SLO_ID,
      burnRateRuleId: RULE_ID,
      projectId: PROJECT_ID,
    });

    expect(timelineRows()[0]!.rootCause).toBe(DEFAULT_INCIDENT_ROOT_CAUSE);
  });

  it("ignores an explicitly undefined root cause and uses the fallback", async () => {
    incidentFindBySpy.mockResolvedValue([makeIncident(ObjectID.generate())]);

    await ServiceLevelObjectiveBurnRateRuleService.resolveOpenIncidentsForRule({
      serviceLevelObjectiveId: SLO_ID,
      burnRateRuleId: RULE_ID,
      projectId: PROJECT_ID,
      rootCause: undefined,
    });

    expect(timelineRows()[0]!.rootCause).toBe(DEFAULT_INCIDENT_ROOT_CAUSE);
  });

  it("threads the caller's root cause onto every resolved incident", async () => {
    incidentFindBySpy.mockResolvedValue([
      makeIncident(ObjectID.generate()),
      makeIncident(ObjectID.generate()),
    ]);

    await ServiceLevelObjectiveBurnRateRuleService.resolveOpenIncidentsForRule({
      serviceLevelObjectiveId: SLO_ID,
      burnRateRuleId: RULE_ID,
      projectId: PROJECT_ID,
      rootCause: DELETE_ROOT_CAUSE,
    });

    for (const row of timelineRows()) {
      expect(row.rootCause).toBe(DELETE_ROOT_CAUSE);
    }
  });

  it("treats the same-state concurrency race as a benign no-op, not an error", async () => {
    incidentFindBySpy.mockResolvedValue([makeIncident(ObjectID.generate())]);
    timelineCreateSpy.mockRejectedValue(
      new BadDataException(SAME_STATE_INCIDENT_RACE_MESSAGE),
    );

    const loggerDebugSpy: jest.SpyInstance = jest
      .spyOn(logger, "debug")
      .mockImplementation(() => {
        return undefined;
      });
    const loggerErrorSpy: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {
        return undefined;
      });

    await expect(
      ServiceLevelObjectiveBurnRateRuleService.resolveOpenIncidentsForRule({
        serviceLevelObjectiveId: SLO_ID,
        burnRateRuleId: RULE_ID,
        projectId: PROJECT_ID,
      }),
    ).resolves.toBeUndefined();

    /*
     * The evaluation worker and a lifecycle hook can both decide to resolve
     * the same incident; the loser's dedupe throws this exact message and it
     * is a no-op, not a failure. If the inner catch rethrew it, the outer
     * catch would log it as an error.
     */
    expect(loggerDebugSpy).toHaveBeenCalledTimes(1);
    expect(loggerErrorSpy).not.toHaveBeenCalled();
  });

  it("logs any other BadDataException rather than swallowing it", async () => {
    incidentFindBySpy.mockResolvedValue([makeIncident(ObjectID.generate())]);
    timelineCreateSpy.mockRejectedValue(
      new BadDataException("Incident state is not in the right order."),
    );

    const loggerErrorSpy: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {
        return undefined;
      });

    await expect(
      ServiceLevelObjectiveBurnRateRuleService.resolveOpenIncidentsForRule({
        serviceLevelObjectiveId: SLO_ID,
        burnRateRuleId: RULE_ID,
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow("Incident state is not in the right order.");

    // Matching on the message, not the type, is what keeps this one visible.
    expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps resolving the remaining incidents after one incident fails, then reports the failure", async () => {
    const firstIncidentId: ObjectID = ObjectID.generate();
    const secondIncidentId: ObjectID = ObjectID.generate();

    incidentFindBySpy.mockResolvedValue([
      makeIncident(firstIncidentId),
      makeIncident(secondIncidentId),
    ]);

    timelineCreateSpy
      .mockRejectedValueOnce(new Error("write conflict"))
      .mockResolvedValueOnce(new IncidentStateTimeline());

    const loggerErrorSpy: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {
        return undefined;
      });

    /*
     * The same isolation-and-reporting pair the alert twin carries: the second
     * incident still resolves, and the caller still hears that the first one
     * did not. A clean return here is what makes the worker stamp the rule
     * resolved and stop trying.
     */
    await expect(
      ServiceLevelObjectiveBurnRateRuleService.resolveOpenIncidentsForRule({
        serviceLevelObjectiveId: SLO_ID,
        burnRateRuleId: RULE_ID,
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow("write conflict");

    expect(timelineCreateSpy).toHaveBeenCalledTimes(2);
    expect(timelineRows()[1]!.incidentId).toEqual(secondIncidentId);
    expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
  });

  it("resolves cleanly when the only failure was the benign same-state race", async () => {
    incidentFindBySpy.mockResolvedValue([
      makeIncident(ObjectID.generate()),
      makeIncident(ObjectID.generate()),
    ]);

    timelineCreateSpy
      .mockRejectedValueOnce(
        new BadDataException(
          "Incident state cannot be same as previous state.",
        ),
      )
      .mockResolvedValueOnce(new IncidentStateTimeline());

    await expect(
      ServiceLevelObjectiveBurnRateRuleService.resolveOpenIncidentsForRule({
        serviceLevelObjectiveId: SLO_ID,
        burnRateRuleId: RULE_ID,
        projectId: PROJECT_ID,
      }),
    ).resolves.toBeUndefined();
  });

  /*
   * A project with something open but NO resolved incident state cannot be
   * papered over: the incidents would be left open with nothing recording why,
   * so the caller has to hear about it.
   */
  it("propagates a failure to look up the project's resolved incident state", async () => {
    incidentFindBySpy.mockResolvedValue([makeIncident(ObjectID.generate())]);
    resolvedStateSpy.mockRejectedValue(
      new BadDataException("No resolved state found for the project"),
    );

    await expect(
      ServiceLevelObjectiveBurnRateRuleService.resolveOpenIncidentsForRule({
        serviceLevelObjectiveId: SLO_ID,
        burnRateRuleId: RULE_ID,
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow("No resolved state found for the project");

    expect(timelineCreateSpy).not.toHaveBeenCalled();
  });
});

/*
 * What every "this rule can no longer justify what it opened" caller wants:
 * close BOTH sides, because a rule's configuration can have changed since a
 * record was opened, so "it declares incidents now" is not a safe proxy for
 * "it has no open alert".
 */
describe("ServiceLevelObjectiveBurnRateRuleService.resolveOpenAlertsAndIncidentsForRule", () => {
  const resolveData: {
    serviceLevelObjectiveId: ObjectID;
    burnRateRuleId: ObjectID;
    projectId: ObjectID;
    rootCause: string;
  } = {
    serviceLevelObjectiveId: SLO_ID,
    burnRateRuleId: RULE_ID,
    projectId: PROJECT_ID,
    rootCause: DELETE_ROOT_CAUSE,
  };

  let resolveAlertsSpy: jest.SpyInstance;
  let resolveIncidentsSpy: jest.SpyInstance;

  beforeEach(() => {
    resolveAlertsSpy = jest
      .spyOn(
        ServiceLevelObjectiveBurnRateRuleService,
        "resolveOpenAlertsForRule",
      )
      .mockResolvedValue(undefined);
    resolveIncidentsSpy = jest
      .spyOn(
        ServiceLevelObjectiveBurnRateRuleService,
        "resolveOpenIncidentsForRule",
      )
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("closes both sides, handing each the caller's data unchanged", async () => {
    await expect(
      ServiceLevelObjectiveBurnRateRuleService.resolveOpenAlertsAndIncidentsForRule(
        resolveData,
      ),
    ).resolves.toBeUndefined();

    expect(resolveAlertsSpy).toHaveBeenCalledTimes(1);
    expect(resolveAlertsSpy).toHaveBeenCalledWith(resolveData);
    expect(resolveIncidentsSpy).toHaveBeenCalledTimes(1);
    expect(resolveIncidentsSpy).toHaveBeenCalledWith(resolveData);
  });

  /*
   * The reason for the try/catch around each half: a failure on one side must
   * not strand the other, which is exactly what a plain `await a(); await b();`
   * would do.
   */
  it("still closes the incidents when the alert pass throws, then rethrows the alert error", async () => {
    resolveAlertsSpy.mockRejectedValue(new Error("alert service down"));

    await expect(
      ServiceLevelObjectiveBurnRateRuleService.resolveOpenAlertsAndIncidentsForRule(
        resolveData,
      ),
    ).rejects.toThrow("alert service down");

    expect(resolveIncidentsSpy).toHaveBeenCalledTimes(1);
  });

  it("still closes the alerts when the incident pass throws, then rethrows the incident error", async () => {
    resolveIncidentsSpy.mockRejectedValue(new Error("incident service down"));

    await expect(
      ServiceLevelObjectiveBurnRateRuleService.resolveOpenAlertsAndIncidentsForRule(
        resolveData,
      ),
    ).rejects.toThrow("incident service down");

    expect(resolveAlertsSpy).toHaveBeenCalledTimes(1);
  });

  it("rethrows the FIRST error when both passes throw, and runs both anyway", async () => {
    resolveAlertsSpy.mockRejectedValue(new Error("alert service down"));
    resolveIncidentsSpy.mockRejectedValue(new Error("incident service down"));

    await expect(
      ServiceLevelObjectiveBurnRateRuleService.resolveOpenAlertsAndIncidentsForRule(
        resolveData,
      ),
    ).rejects.toThrow("alert service down");

    expect(resolveAlertsSpy).toHaveBeenCalledTimes(1);
    expect(resolveIncidentsSpy).toHaveBeenCalledTimes(1);
  });
});

/*
 * A rule stops declaring something - it is disabled, or one of its two outputs
 * is switched off - and whatever it already has open is an orphan. The
 * evaluation worker cannot clean it up: it only loads ENABLED rules, and for
 * an enabled rule it only resolves the output it is still allowed to create.
 * So without this hook the alert (or incident) and its on-call escalation
 * would keep paging someone about a rule that can no longer justify the page.
 *
 * It runs after the write commits, so a rejected update leaves everything
 * exactly where it was.
 */
describe("ServiceLevelObjectiveBurnRateRuleService.onUpdateSuccess", () => {
  let findOneByIdSpy: jest.SpyInstance;
  let resolveAlertsSpy: jest.SpyInstance;
  let resolveIncidentsSpy: jest.SpyInstance;
  let clearStateSpy: jest.SpyInstance;
  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    findOneByIdSpy = jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findOneById")
      .mockResolvedValue(
        makeRule({
          _id: RULE_ID.toString(),
          id: RULE_ID,
          projectId: PROJECT_ID,
          serviceLevelObjectiveId: SLO_ID,
        }),
      );
    resolveAlertsSpy = jest
      .spyOn(
        ServiceLevelObjectiveBurnRateRuleService,
        "resolveOpenAlertsForRule",
      )
      .mockResolvedValue(undefined);
    resolveIncidentsSpy = jest
      .spyOn(
        ServiceLevelObjectiveBurnRateRuleService,
        "resolveOpenIncidentsForRule",
      )
      .mockResolvedValue(undefined);
    clearStateSpy = jest
      .spyOn(
        ServiceLevelObjectiveBurnRateRuleService,
        "clearOpenOutputStateForRule",
      )
      .mockResolvedValue(undefined);
    loggerErrorSpy = jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("resolves both the alerts and the incidents of every updated rule when the rule is disabled", async () => {
    await callHook("onUpdateSuccess", makeOnUpdate({ isEnabled: false }), [
      RULE_ID,
      OTHER_RULE_ID,
    ]);

    expect(resolveAlertsSpy).toHaveBeenCalledTimes(2);
    expect(resolveIncidentsSpy).toHaveBeenCalledTimes(2);

    // The rule id comes from the updated ids, not from the row that was read.
    expect(resolveAlertsSpy).toHaveBeenNthCalledWith(1, {
      serviceLevelObjectiveId: SLO_ID,
      burnRateRuleId: RULE_ID,
      projectId: PROJECT_ID,
      rootCause: DISABLED_ALERT_ROOT_CAUSE,
    });
    expect(resolveAlertsSpy).toHaveBeenNthCalledWith(2, {
      serviceLevelObjectiveId: SLO_ID,
      burnRateRuleId: OTHER_RULE_ID,
      projectId: PROJECT_ID,
      rootCause: DISABLED_ALERT_ROOT_CAUSE,
    });
    expect(resolveIncidentsSpy).toHaveBeenNthCalledWith(1, {
      serviceLevelObjectiveId: SLO_ID,
      burnRateRuleId: RULE_ID,
      projectId: PROJECT_ID,
      rootCause: DISABLED_INCIDENT_ROOT_CAUSE,
    });
    expect(resolveIncidentsSpy).toHaveBeenNthCalledWith(2, {
      serviceLevelObjectiveId: SLO_ID,
      burnRateRuleId: OTHER_RULE_ID,
      projectId: PROJECT_ID,
      rootCause: DISABLED_INCIDENT_ROOT_CAUSE,
    });

    /*
     * And each rule is told to forget what it had open, per rule id. Without
     * this the worker's firing gate keeps reading the stale created stamp and
     * declares nothing once the rule is re-enabled mid-burn. The edge cases
     * live in their own describe below.
     */
    expect(clearStateSpy).toHaveBeenCalledTimes(2);
    expect(clearStateSpy).toHaveBeenNthCalledWith(1, {
      burnRateRuleId: RULE_ID,
      clearAlert: true,
      clearIncident: true,
    });
    expect(clearStateSpy).toHaveBeenNthCalledWith(2, {
      burnRateRuleId: OTHER_RULE_ID,
      clearAlert: true,
      clearIncident: true,
    });
  });

  it("resolves only the alerts when the rule stops raising alerts", async () => {
    await callHook(
      "onUpdateSuccess",
      makeOnUpdate({ shouldCreateAlert: false }),
      [RULE_ID],
    );

    expect(resolveAlertsSpy).toHaveBeenCalledTimes(1);
    expect(resolveAlertsSpy).toHaveBeenCalledWith({
      serviceLevelObjectiveId: SLO_ID,
      burnRateRuleId: RULE_ID,
      projectId: PROJECT_ID,
      rootCause: ALERTS_TURNED_OFF_ROOT_CAUSE,
    });
    // The incident the rule still declares must be left alone.
    expect(resolveIncidentsSpy).not.toHaveBeenCalled();
  });

  it("resolves only the incidents when the rule stops declaring incidents", async () => {
    await callHook(
      "onUpdateSuccess",
      makeOnUpdate({ shouldCreateIncident: false }),
      [RULE_ID],
    );

    expect(resolveIncidentsSpy).toHaveBeenCalledTimes(1);
    expect(resolveIncidentsSpy).toHaveBeenCalledWith({
      serviceLevelObjectiveId: SLO_ID,
      burnRateRuleId: RULE_ID,
      projectId: PROJECT_ID,
      rootCause: INCIDENTS_TURNED_OFF_ROOT_CAUSE,
    });
    expect(resolveAlertsSpy).not.toHaveBeenCalled();
  });

  it("prefers the 'was disabled' root causes when one payload both disables the rule and switches an output off", async () => {
    await callHook(
      "onUpdateSuccess",
      makeOnUpdate({ isEnabled: false, shouldCreateIncident: false }),
      [RULE_ID],
    );

    expect(resolveAlertsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ rootCause: DISABLED_ALERT_ROOT_CAUSE }),
    );
    expect(resolveIncidentsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ rootCause: DISABLED_INCIDENT_ROOT_CAUSE }),
    );
  });

  it("loads nothing and resolves nothing when the payload carries none of the three flags", async () => {
    await callHook("onUpdateSuccess", makeOnUpdate({ name: "Renamed rule" }), [
      RULE_ID,
    ]);

    expect(findOneByIdSpy).not.toHaveBeenCalled();
    expect(resolveAlertsSpy).not.toHaveBeenCalled();
    expect(resolveIncidentsSpy).not.toHaveBeenCalled();
  });

  it("resolves nothing when a flag is switched ON", async () => {
    await callHook(
      "onUpdateSuccess",
      makeOnUpdate({ isEnabled: true, shouldCreateIncident: true }),
      [RULE_ID],
    );

    expect(findOneByIdSpy).not.toHaveBeenCalled();
    expect(resolveAlertsSpy).not.toHaveBeenCalled();
  });

  /*
   * The strict `=== false` reads here are only sound because onBeforeUpdate
   * coerced both flags first. This pins that dependency rather than the
   * behaviour being desirable on its own: a payload that somehow reached this
   * hook still holding the raw string resolves NOTHING, so the coercion in
   * validateOutputsOnUpdate is load-bearing, not tidiness.
   */
  it('does nothing with an uncoerced "false" string, which onBeforeUpdate is responsible for turning into a boolean', async () => {
    await callHook(
      "onUpdateSuccess",
      makeOnUpdate({ shouldCreateAlert: "false" }),
      [RULE_ID],
    );

    expect(findOneByIdSpy).not.toHaveBeenCalled();
    expect(resolveAlertsSpy).not.toHaveBeenCalled();
  });

  it("reads each updated rule as root, selecting only what a fingerprint needs", async () => {
    await callHook("onUpdateSuccess", makeOnUpdate({ isEnabled: false }), [
      RULE_ID,
    ]);

    const findOneByIdArguments: FindOneByIdArguments = findOneByIdArgumentsAt(
      findOneByIdSpy,
      0,
    );

    expect(findOneByIdArguments.id).toEqual(RULE_ID);
    expect(findOneByIdArguments.select).toEqual({
      _id: true,
      projectId: true,
      serviceLevelObjectiveId: true,
    });
    expect(findOneByIdArguments.props).toEqual({ isRoot: true });
  });

  it("does not read anything when the update matched no rows", async () => {
    await callHook("onUpdateSuccess", makeOnUpdate({ isEnabled: false }), []);

    expect(findOneByIdSpy).not.toHaveBeenCalled();
  });

  const unresolvableRules: Array<{
    label: string;
    rule: ServiceLevelObjectiveBurnRateRule | null;
  }> = [
    { label: "a rule that no longer loads", rule: null },
    {
      label: "a rule that loads without a projectId",
      rule: makeRule({
        _id: RULE_ID.toString(),
        id: RULE_ID,
        serviceLevelObjectiveId: SLO_ID,
      }),
    },
    {
      label: "a rule that loads without a serviceLevelObjectiveId",
      rule: makeRule({
        _id: RULE_ID.toString(),
        id: RULE_ID,
        projectId: PROJECT_ID,
      }),
    },
  ];

  unresolvableRules.forEach(
    (unresolvable: {
      label: string;
      rule: ServiceLevelObjectiveBurnRateRule | null;
    }): void => {
      /*
       * A rule deleted between the update and this hook, or one whose select
       * came back short, has nothing to build a fingerprint from - skipping is
       * right, and it must not turn a successful update into a thrown error.
       */
      it(`skips ${unresolvable.label} without throwing`, async () => {
        findOneByIdSpy.mockResolvedValue(unresolvable.rule);

        await expect(
          callHook("onUpdateSuccess", makeOnUpdate({ isEnabled: false }), [
            RULE_ID,
          ]),
        ).resolves.toBeDefined();

        expect(resolveAlertsSpy).not.toHaveBeenCalled();
        expect(resolveIncidentsSpy).not.toHaveBeenCalled();
        expect(loggerErrorSpy).not.toHaveBeenCalled();
      });
    },
  );

  it("logs the failure of one rule and still resolves the rest", async () => {
    resolveAlertsSpy
      .mockRejectedValueOnce(new Error("alert service down"))
      .mockResolvedValueOnce(undefined);

    await expect(
      callHook("onUpdateSuccess", makeOnUpdate({ isEnabled: false }), [
        RULE_ID,
        OTHER_RULE_ID,
      ]),
    ).resolves.toBeDefined();

    expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
    expect(resolveAlertsSpy).toHaveBeenCalledTimes(2);

    /*
     * Isolation runs in BOTH directions here: a failed alert resolve does not
     * cost the same rule its incident resolve, and it does not cost the next
     * rule anything either. The worker cannot retry any of this — it only ever
     * loads rules where isEnabled is true — so whatever is skipped here stays
     * open forever.
     */
    expect(resolveIncidentsSpy).toHaveBeenCalledTimes(2);
    expect(resolveIncidentsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ burnRateRuleId: RULE_ID }),
    );
    expect(resolveIncidentsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ burnRateRuleId: OTHER_RULE_ID }),
    );
  });

  it("returns the onUpdate object it was handed", async () => {
    const onUpdate: OnUpdate<ServiceLevelObjectiveBurnRateRule> = makeOnUpdate({
      isEnabled: false,
    });

    const result: unknown = await callHook("onUpdateSuccess", onUpdate, [
      RULE_ID,
    ]);

    expect(result).toBe(onUpdate);
  });
});

/*
 * The rule's own lifecycle columns are what the evaluation worker reads to
 * decide whether an output is already open. Closing the record without
 * clearing them told the next tick "an alert is already open" when there was
 * none — and the worker then declared nothing for the rest of the burn. These
 * pin the clear, and pin that it only covers the side that actually closed.
 */
describe("ServiceLevelObjectiveBurnRateRuleService.onUpdateSuccess forgets what it closed", () => {
  let findOneByIdSpy: jest.SpyInstance;
  let resolveAlertsSpy: jest.SpyInstance;
  let resolveIncidentsSpy: jest.SpyInstance;
  let clearStateSpy: jest.SpyInstance;

  beforeEach(() => {
    findOneByIdSpy = jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findOneById")
      .mockResolvedValue(
        makeRule({
          _id: RULE_ID.toString(),
          id: RULE_ID,
          projectId: PROJECT_ID,
          serviceLevelObjectiveId: SLO_ID,
        }),
      );
    resolveAlertsSpy = jest
      .spyOn(
        ServiceLevelObjectiveBurnRateRuleService,
        "resolveOpenAlertsForRule",
      )
      .mockResolvedValue(undefined);
    resolveIncidentsSpy = jest
      .spyOn(
        ServiceLevelObjectiveBurnRateRuleService,
        "resolveOpenIncidentsForRule",
      )
      .mockResolvedValue(undefined);
    clearStateSpy = jest
      .spyOn(
        ServiceLevelObjectiveBurnRateRuleService,
        "clearOpenOutputStateForRule",
      )
      .mockResolvedValue(undefined);
    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("forgets both outputs when a firing rule is disabled", async () => {
    await callHook("onUpdateSuccess", makeOnUpdate({ isEnabled: false }), [
      RULE_ID,
    ]);

    expect(clearStateSpy).toHaveBeenCalledTimes(1);
    expect(clearStateSpy).toHaveBeenCalledWith({
      burnRateRuleId: RULE_ID,
      clearAlert: true,
      clearIncident: true,
    });
  });

  it("forgets only the alert when only alerts were switched off", async () => {
    await callHook(
      "onUpdateSuccess",
      makeOnUpdate({ shouldCreateAlert: false }),
      [RULE_ID],
    );

    expect(clearStateSpy).toHaveBeenCalledWith({
      burnRateRuleId: RULE_ID,
      clearAlert: true,
      clearIncident: false,
    });
  });

  it("forgets only the incident when only incidents were switched off", async () => {
    await callHook(
      "onUpdateSuccess",
      makeOnUpdate({ shouldCreateIncident: false }),
      [RULE_ID],
    );

    expect(clearStateSpy).toHaveBeenCalledWith({
      burnRateRuleId: RULE_ID,
      clearAlert: false,
      clearIncident: true,
    });
  });

  it("does not forget a side whose resolve threw — its record is still open", async () => {
    resolveAlertsSpy.mockRejectedValueOnce(new Error("write conflict"));

    await callHook("onUpdateSuccess", makeOnUpdate({ isEnabled: false }), [
      RULE_ID,
    ]);

    /*
     * Clearing the alert column here would tell the worker to declare a second
     * alert on top of the one that is still open.
     */
    expect(clearStateSpy).toHaveBeenCalledWith({
      burnRateRuleId: RULE_ID,
      clearAlert: false,
      clearIncident: true,
    });
  });

  it("resolves the incident even when the alert resolve throws", async () => {
    resolveAlertsSpy.mockRejectedValueOnce(new Error("write conflict"));

    await callHook("onUpdateSuccess", makeOnUpdate({ isEnabled: false }), [
      RULE_ID,
    ]);

    /*
     * The two outputs are independent lifecycles. Before they had their own
     * try blocks, an alert that failed to resolve took the incident's resolve
     * with it, leaving a live incident escalating for a disabled rule — and
     * the worker never revisits a disabled rule, so nothing retried it.
     */
    expect(resolveIncidentsSpy).toHaveBeenCalledTimes(1);
  });

  it("clears nothing for a rule it could not read", async () => {
    findOneByIdSpy.mockResolvedValue(null);

    await callHook("onUpdateSuccess", makeOnUpdate({ isEnabled: false }), [
      RULE_ID,
    ]);

    expect(clearStateSpy).not.toHaveBeenCalled();
  });
});

describe("ServiceLevelObjectiveBurnRateRuleService.onBeforeDelete", () => {
  let findBySpy: jest.SpyInstance;
  let resolveOpenAlertsAndIncidentsSpy: jest.SpyInstance;

  beforeEach(() => {
    findBySpy = jest.spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy");
    resolveOpenAlertsAndIncidentsSpy = jest
      .spyOn(
        ServiceLevelObjectiveBurnRateRuleService,
        "resolveOpenAlertsAndIncidentsForRule",
      )
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("resolves the open alerts AND incidents of every rule about to be deleted", async () => {
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

    expect(resolveOpenAlertsAndIncidentsSpy).toHaveBeenCalledTimes(2);
    expect(resolveOpenAlertsAndIncidentsSpy).toHaveBeenNthCalledWith(1, {
      serviceLevelObjectiveId: SLO_ID,
      burnRateRuleId: RULE_ID,
      projectId: PROJECT_ID,
      rootCause: DELETE_ROOT_CAUSE,
    });
    expect(resolveOpenAlertsAndIncidentsSpy).toHaveBeenNthCalledWith(2, {
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

    expect(resolveOpenAlertsAndIncidentsSpy).not.toHaveBeenCalled();
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

    expect(resolveOpenAlertsAndIncidentsSpy).not.toHaveBeenCalled();
  });

  it("does not block the delete when resolving one rule's records throws", async () => {
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

    resolveOpenAlertsAndIncidentsSpy
      .mockRejectedValueOnce(new Error("alert service down"))
      .mockResolvedValueOnce(undefined);

    await expect(
      callHook("onBeforeDelete", makeDeleteBy()),
    ).resolves.toBeDefined();

    // The failure on the first rule must not abort the second.
    expect(resolveOpenAlertsAndIncidentsSpy).toHaveBeenCalledTimes(2);
  });
});
