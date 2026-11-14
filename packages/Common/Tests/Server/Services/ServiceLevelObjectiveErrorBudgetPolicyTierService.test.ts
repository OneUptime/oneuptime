import Alert from "../../../Models/DatabaseModels/Alert";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveErrorBudgetPolicyTier from "../../../Models/DatabaseModels/ServiceLevelObjectiveErrorBudgetPolicyTier";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import AlertService from "../../../Server/Services/AlertService";
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import ServiceLevelObjectiveErrorBudgetPolicyTierService, {
  SLO_NOT_FOUND_MESSAGE,
  SLO_POLICY_TIER_ALERTS_OFF_ROOT_CAUSE,
  SLO_POLICY_TIER_DELETED_ROOT_CAUSE,
  SLO_POLICY_TIER_DISABLED_ROOT_CAUSE,
  SLO_POLICY_TIER_INCIDENTS_OFF_ROOT_CAUSE,
  SLO_POLICY_TIER_NAME_ERROR_MESSAGE,
  SLO_POLICY_TIER_OPTION_FLAG_DEFAULTS,
  SLO_POLICY_TIER_SLO_DISABLED_OR_DELETED_ROOT_CAUSE,
  SLO_POLICY_TIER_THRESHOLD_ERROR_MESSAGE,
  SLO_POLICY_TIER_WHAT_WE_DO_ERROR_MESSAGE,
  SloAddedRecommendedPolicyTiers,
  SloMissingRecommendedPolicyTiers,
  getSloPolicyTierDuplicateThresholdMessage,
} from "../../../Server/Services/ServiceLevelObjectiveErrorBudgetPolicyTierService";
import { BURN_RATE_RULE_OPTION_FLAG_DEFAULTS } from "../../../Server/Services/ServiceLevelObjectiveBurnRateRuleService";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import {
  OnCreate,
  OnDelete,
  OnUpdate,
} from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import logger from "../../../Server/Utils/Logger";
import SloRecordReferenceValidator from "../../../Server/Utils/Slo/SloRecordReferenceValidator";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import {
  SLO_POLICY_TIER_WHAT_WE_DO_MAX_LENGTH,
  SLO_RECOMMENDED_POLICY_TIERS,
} from "../../../Utils/Slo/SloErrorBudgetPolicy";
import { SLO_RECORD_OUTPUT_MARKDOWN_TEMPLATE_MAX_LENGTH } from "../../../Utils/Slo/SloRecordOutputColumns";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import InMemoryLocks from "../TestingUtils/InMemoryLocks";
import {
  ALERT_STATE_IDS,
  INCIDENT_STATE_IDS,
  mockProjectStates,
} from "../TestingUtils/Services/ProjectStatesHelper";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * The tiers of an SLO's error budget policy, as their service holds them:
 * what a tier must be (a threshold from 0 to 100, unique on its SLO, a name
 * and an agreement), what its outputs default to (nothing, until someone
 * switches them on), what a tier that stops raising something resolves, and
 * "Use the recommended policy" - created as the caller, idempotent under a
 * lock per SLO.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SLO_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const TIER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const OTHER_TIER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const ALERT_SEVERITY_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const NOW: Date = new Date("2026-11-08T10:00:00.000Z");

const LOCK_NAMESPACE: string =
  "ServiceLevelObjectiveErrorBudgetPolicyTierService.addMissingRecommendedTiers";

type TierFields = Record<string, unknown>;

function makeTier(
  fields: TierFields,
): ServiceLevelObjectiveErrorBudgetPolicyTier {
  const tier: ServiceLevelObjectiveErrorBudgetPolicyTier =
    new ServiceLevelObjectiveErrorBudgetPolicyTier();
  const writable: Record<string, unknown> = tier as unknown as Record<
    string,
    unknown
  >;

  for (const key of Object.keys(fields)) {
    writable[key] = fields[key];
  }

  return tier;
}

function storedTier(
  id: ObjectID,
  thresholdPercentage: number,
  fields: TierFields = {},
): ServiceLevelObjectiveErrorBudgetPolicyTier {
  const tier: ServiceLevelObjectiveErrorBudgetPolicyTier = makeTier({
    projectId: PROJECT_ID,
    serviceLevelObjectiveId: SLO_ID,
    name: "Tier",
    thresholdPercentage: thresholdPercentage,
    ...fields,
  });
  tier._id = id.toString();
  tier.id = id;
  return tier;
}

function makeCreateBy(
  fields: TierFields = {},
  props?: DatabaseCommonInteractionProps,
): CreateBy<ServiceLevelObjectiveErrorBudgetPolicyTier> {
  return {
    data: makeTier({
      projectId: PROJECT_ID,
      serviceLevelObjectiveId: SLO_ID,
      name: "Reliability first",
      thresholdPercentage: 25,
      whatWeDo: "Only reliability work ships.",
      ...fields,
    }),
    props: props || { isRoot: true, tenantId: PROJECT_ID },
  };
}

function makeUpdateBy(
  data: TierFields,
): UpdateBy<ServiceLevelObjectiveErrorBudgetPolicyTier> {
  return {
    query: { _id: TIER_ID.toString() },
    data: data,
    props: { isRoot: true },
    limit: 1,
    skip: 0,
  } as unknown as UpdateBy<ServiceLevelObjectiveErrorBudgetPolicyTier>;
}

function makeOnUpdate(
  data: TierFields,
): OnUpdate<ServiceLevelObjectiveErrorBudgetPolicyTier> {
  return {
    updateBy: makeUpdateBy(data),
    carryForward: null,
  };
}

// Calls the protected hook without widening the service's public surface.
function callHook(name: string, ...args: Array<unknown>): Promise<unknown> {
  const hooks: Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  > = ServiceLevelObjectiveErrorBudgetPolicyTierService as unknown as Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  >;

  return hooks[name]!.apply(
    ServiceLevelObjectiveErrorBudgetPolicyTierService,
    args,
  );
}

async function expectBadData(
  promise: Promise<unknown>,
  message: string,
): Promise<void> {
  await expect(promise).rejects.toThrow(BadDataException);
  await expect(promise).rejects.toThrow(message);
}

// Lets the fire-and-forget evaluation request settle.
async function flushPromises(): Promise<void> {
  for (let i: number = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

let tierFindBySpy: jest.SpyInstance;
let requestEvaluationSpy: jest.SpyInstance;
let sloReferenceSpy: jest.SpyInstance;

beforeEach(() => {
  stubProjectDirectory({});
  jest
    .spyOn(ProjectReferenceCheck, "validateCreate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ProjectReferenceCheck, "validateUpdate")
    .mockResolvedValue(undefined as never);
  mockProjectStates();

  sloReferenceSpy = jest
    .spyOn(
      SloRecordReferenceValidator,
      "validateServiceLevelObjectivesBelongToProject",
    )
    .mockResolvedValue(undefined);

  // No other tier at any threshold, unless a case says so.
  tierFindBySpy = jest
    .spyOn(ServiceLevelObjectiveErrorBudgetPolicyTierService, "findBy")
    .mockResolvedValue([] as never);

  requestEvaluationSpy = jest
    .spyOn(ServiceLevelObjectiveService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a tier's fingerprint", () => {
  it("is the SLO and the tier, in a scheme of its own", () => {
    expect(
      ServiceLevelObjectiveErrorBudgetPolicyTierService.getPolicyTierFingerprint(
        {
          serviceLevelObjectiveId: SLO_ID,
          policyTierId: TIER_ID,
        },
      ),
    ).toBe(`slo:${SLO_ID.toString()}:policy-tier:${TIER_ID.toString()}`);
  });
});

describe("onBeforeCreate: what a tier must be", () => {
  it("accepts a tier with a threshold, a name and an agreement", async () => {
    const createBy: CreateBy<ServiceLevelObjectiveErrorBudgetPolicyTier> =
      makeCreateBy();

    await expect(callHook("onBeforeCreate", createBy)).resolves.toBeDefined();
    expect(createBy.data.thresholdPercentage).toBe(25);
    expect(createBy.data.name).toBe("Reliability first");
  });

  it("reads a threshold the Dashboard sends as text, and writes it back as a number", async () => {
    const createBy: CreateBy<ServiceLevelObjectiveErrorBudgetPolicyTier> =
      makeCreateBy({ thresholdPercentage: " 12.5 " });

    await callHook("onBeforeCreate", createBy);

    expect(createBy.data.thresholdPercentage).toBe(12.5);
  });

  it("takes 0 and 100, the whole budget", async () => {
    for (const thresholdPercentage of [0, 100, "0"]) {
      await expect(
        callHook(
          "onBeforeCreate",
          makeCreateBy({ thresholdPercentage: thresholdPercentage }),
        ),
      ).resolves.toBeDefined();
    }
  });

  it("refuses a threshold that is missing, not a number, or outside 0 to 100", async () => {
    for (const thresholdPercentage of [
      undefined,
      null,
      "",
      "abc",
      -1,
      100.5,
      Number.NaN,
    ]) {
      await expectBadData(
        callHook(
          "onBeforeCreate",
          makeCreateBy({ thresholdPercentage: thresholdPercentage }),
        ),
        SLO_POLICY_TIER_THRESHOLD_ERROR_MESSAGE,
      );
    }
  });

  it("needs a name, and trims it", async () => {
    for (const name of [undefined, "", "   "]) {
      await expectBadData(
        callHook("onBeforeCreate", makeCreateBy({ name: name })),
        SLO_POLICY_TIER_NAME_ERROR_MESSAGE,
      );
    }

    const createBy: CreateBy<ServiceLevelObjectiveErrorBudgetPolicyTier> =
      makeCreateBy({ name: "  Caution  " });
    await callHook("onBeforeCreate", createBy);
    expect(createBy.data.name).toBe("Caution");
  });

  it("needs an agreement, and keeps it exactly as written", async () => {
    for (const whatWeDo of [undefined, "", " \n "]) {
      await expectBadData(
        callHook("onBeforeCreate", makeCreateBy({ whatWeDo: whatWeDo })),
        SLO_POLICY_TIER_WHAT_WE_DO_ERROR_MESSAGE,
      );
    }

    const markdown: string = "    indented code\n\n- a list";
    const createBy: CreateBy<ServiceLevelObjectiveErrorBudgetPolicyTier> =
      makeCreateBy({ whatWeDo: markdown });
    await callHook("onBeforeCreate", createBy);
    expect(createBy.data.whatWeDo).toBe(markdown);
  });

  it("holds the agreement to its length", async () => {
    await expect(
      callHook(
        "onBeforeCreate",
        makeCreateBy({
          whatWeDo: "x".repeat(SLO_POLICY_TIER_WHAT_WE_DO_MAX_LENGTH),
        }),
      ),
    ).resolves.toBeDefined();

    await expectBadData(
      callHook(
        "onBeforeCreate",
        makeCreateBy({
          whatWeDo: "x".repeat(SLO_POLICY_TIER_WHAT_WE_DO_MAX_LENGTH + 1),
        }),
      ),
      `"What we do" must be ${SLO_POLICY_TIER_WHAT_WE_DO_MAX_LENGTH} characters or fewer.`,
    );
  });

  it("refuses a second tier at a threshold the SLO's policy already has", async () => {
    tierFindBySpy.mockResolvedValue([storedTier(OTHER_TIER_ID, 25)] as never);

    await expectBadData(
      callHook("onBeforeCreate", makeCreateBy()),
      getSloPolicyTierDuplicateThresholdMessage(25),
    );

    const lookup: {
      query: Record<string, unknown>;
      props: Record<string, unknown>;
    } = tierFindBySpy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      props: Record<string, unknown>;
    };

    expect(lookup.query).toEqual({
      projectId: PROJECT_ID,
      serviceLevelObjectiveId: SLO_ID,
      thresholdPercentage: 25,
    });
    // Every tier counts, not only the ones the caller may read.
    expect(lookup.props).toEqual({ isRoot: true });
  });

  it("the refusal names the threshold, never the other tier", () => {
    expect(getSloPolicyTierDuplicateThresholdMessage(2.5)).toBe(
      "This SLO's error budget policy already has a tier at 2.5%. Each tier needs a threshold of its own.",
    );
  });

  it("checks the SLO is the project's own, by both spellings", async () => {
    await callHook("onBeforeCreate", makeCreateBy());

    expect(sloReferenceSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      serviceLevelObjectives: [SLO_ID, undefined],
      subject: "SLO error budget policy tier",
    });
  });
});

describe("onBeforeCreate: whether a tier freezes deployments", () => {
  it("freezes nothing by default: the switch is written back as false", async () => {
    const createBy: CreateBy<ServiceLevelObjectiveErrorBudgetPolicyTier> =
      makeCreateBy();

    await callHook("onBeforeCreate", createBy);

    expect(createBy.data.freezesDeployments).toBe(false);
  });

  it("the default is the model's own column default", () => {
    expect(
      new ServiceLevelObjectiveErrorBudgetPolicyTier().getTableColumnMetadata(
        "freezesDeployments",
      ).defaultValue,
    ).toBe(false);
  });

  it("keeps it switched on, whether it comes as a boolean or as the text a form or the API sends", async () => {
    for (const value of [true, "true", "on", 1]) {
      const createBy: CreateBy<ServiceLevelObjectiveErrorBudgetPolicyTier> =
        makeCreateBy({ freezesDeployments: value });

      await callHook("onBeforeCreate", createBy);

      expect({ value, stored: createBy.data.freezesDeployments }).toEqual({
        value,
        stored: true,
      });
    }
  });

  it("reads off, and a null or absent switch, as off", async () => {
    for (const value of [false, "false", 0, null, undefined]) {
      const createBy: CreateBy<ServiceLevelObjectiveErrorBudgetPolicyTier> =
        makeCreateBy({ freezesDeployments: value });

      await callHook("onBeforeCreate", createBy);

      expect({ value, stored: createBy.data.freezesDeployments }).toEqual({
        value,
        stored: false,
      });
    }
  });

  it("a tier that freezes deployments and raises nothing is a whole tier", async () => {
    const createBy: CreateBy<ServiceLevelObjectiveErrorBudgetPolicyTier> =
      makeCreateBy({ freezesDeployments: true });

    await expect(callHook("onBeforeCreate", createBy)).resolves.toBeDefined();
    expect(createBy.data.shouldCreateAlert).toBe(false);
    expect(createBy.data.shouldCreateIncident).toBe(false);
  });
});

describe("onBeforeCreate: what a tier raises", () => {
  it("raises nothing by default: both outputs are written back as false", async () => {
    const createBy: CreateBy<ServiceLevelObjectiveErrorBudgetPolicyTier> =
      makeCreateBy();

    await callHook("onBeforeCreate", createBy);

    expect(createBy.data.shouldCreateAlert).toBe(false);
    expect(createBy.data.shouldCreateIncident).toBe(false);
  });

  it("may raise nothing at all - unlike a burn rate rule", async () => {
    await expect(
      callHook(
        "onBeforeCreate",
        makeCreateBy({ shouldCreateAlert: false, shouldCreateIncident: false }),
      ),
    ).resolves.toBeDefined();
  });

  it("keeps an output switched on", async () => {
    const createBy: CreateBy<ServiceLevelObjectiveErrorBudgetPolicyTier> =
      makeCreateBy({ shouldCreateAlert: true, shouldCreateIncident: "true" });

    await callHook("onBeforeCreate", createBy);

    expect(createBy.data.shouldCreateAlert).toBe(true);
    expect(createBy.data.shouldCreateIncident).toBe(true);
  });

  it("writes the option flags as their defaults - a burn rate rule's", async () => {
    const createBy: CreateBy<ServiceLevelObjectiveErrorBudgetPolicyTier> =
      makeCreateBy();

    await callHook("onBeforeCreate", createBy);

    expect(SLO_POLICY_TIER_OPTION_FLAG_DEFAULTS).toEqual(
      BURN_RATE_RULE_OPTION_FLAG_DEFAULTS,
    );

    for (const [flag, value] of Object.entries(
      SLO_POLICY_TIER_OPTION_FLAG_DEFAULTS,
    )) {
      expect({
        flag,
        value: (createBy.data as unknown as Record<string, unknown>)[flag],
      }).toEqual({ flag, value });
    }
  });

  it("the option defaults match the model's own column defaults", () => {
    const model: ServiceLevelObjectiveErrorBudgetPolicyTier =
      new ServiceLevelObjectiveErrorBudgetPolicyTier();

    for (const [flag, value] of Object.entries(
      SLO_POLICY_TIER_OPTION_FLAG_DEFAULTS,
    )) {
      expect({
        flag,
        value: model.getTableColumnMetadata(flag)?.defaultValue,
      }).toEqual({ flag, value });
    }

    expect(
      model.getTableColumnMetadata("shouldCreateAlert")?.defaultValue,
    ).toBe(false);
    expect(
      model.getTableColumnMetadata("shouldCreateIncident")?.defaultValue,
    ).toBe(false);
  });

  it("stores a blank template as nothing, and holds one to its limit", async () => {
    const createBy: CreateBy<ServiceLevelObjectiveErrorBudgetPolicyTier> =
      makeCreateBy({ alertTitleTemplate: "   " });

    await callHook("onBeforeCreate", createBy);
    expect(createBy.data.alertTitleTemplate).toBeNull();

    await expectBadData(
      callHook(
        "onBeforeCreate",
        makeCreateBy({
          incidentDescriptionTemplate: "x".repeat(
            SLO_RECORD_OUTPUT_MARKDOWN_TEMPLATE_MAX_LENGTH + 1,
          ),
        }),
      ),
      "Incident description template must be",
    );
  });

  it("checks the severities it names belong to the project, in its own words", async () => {
    const validatorSpy: jest.SpyInstance = jest
      .spyOn(
        ProjectScopedReferenceValidator,
        "validateReferencesBelongToProject",
      )
      .mockResolvedValue(undefined as never);

    await callHook(
      "onBeforeCreate",
      makeCreateBy({ alertSeverityId: ALERT_SEVERITY_ID }),
    );

    const call: { subject: string; projectId: ObjectID } = validatorSpy.mock
      .calls[0]![0] as { subject: string; projectId: ObjectID };

    expect(call.subject).toBe("SLO error budget policy tier");
    expect(call.projectId).toEqual(PROJECT_ID);
  });

  it("refuses owner users who are not members of the project", async () => {
    jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([] as never);

    await expectBadData(
      callHook(
        "onBeforeCreate",
        makeCreateBy({
          alertOwnerUsers: [{ _id: USER_ID.toString() }],
        }),
      ),
      "This SLO error budget policy tier names owner users who are not members of this project:",
    );

    jest.restoreAllMocks();
  });

  it("accepts owner users who are", async () => {
    const membership: TeamMember = new TeamMember();
    membership.userId = USER_ID;
    jest
      .spyOn(TeamMemberService, "findBy")
      .mockResolvedValue([membership] as never);

    await expect(
      callHook(
        "onBeforeCreate",
        makeCreateBy({
          alertOwnerUsers: [{ _id: USER_ID.toString() }],
        }),
      ),
    ).resolves.toBeDefined();
  });
});

describe("onBeforeUpdate", () => {
  let rowsSpy: jest.SpyInstance;

  beforeEach(() => {
    rowsSpy = jest
      .spyOn(
        ServiceLevelObjectiveErrorBudgetPolicyTierService,
        "findRowsAndHoldUpdateToThem",
      )
      .mockResolvedValue([storedTier(TIER_ID, 50)] as never);
  });

  it("validates and coerces a new threshold", async () => {
    const updateBy: UpdateBy<ServiceLevelObjectiveErrorBudgetPolicyTier> =
      makeUpdateBy({ thresholdPercentage: "40" });

    await callHook("onBeforeUpdate", updateBy);
    expect(updateBy.data.thresholdPercentage).toBe(40);

    await expectBadData(
      callHook("onBeforeUpdate", makeUpdateBy({ thresholdPercentage: 140 })),
      SLO_POLICY_TIER_THRESHOLD_ERROR_MESSAGE,
    );
    await expectBadData(
      callHook("onBeforeUpdate", makeUpdateBy({ thresholdPercentage: null })),
      SLO_POLICY_TIER_THRESHOLD_ERROR_MESSAGE,
    );
  });

  it("refuses a threshold another tier of the same SLO has", async () => {
    tierFindBySpy.mockResolvedValue([storedTier(OTHER_TIER_ID, 25)] as never);

    await expectBadData(
      callHook("onBeforeUpdate", makeUpdateBy({ thresholdPercentage: 25 })),
      getSloPolicyTierDuplicateThresholdMessage(25),
    );
  });

  it("a tier keeping its own threshold is not a duplicate of itself", async () => {
    tierFindBySpy.mockResolvedValue([storedTier(TIER_ID, 50)] as never);

    await expect(
      callHook("onBeforeUpdate", makeUpdateBy({ thresholdPercentage: 50 })),
    ).resolves.toBeDefined();
  });

  it("two tiers of one SLO cannot both take the one threshold", async () => {
    rowsSpy.mockResolvedValue([
      storedTier(TIER_ID, 50),
      storedTier(OTHER_TIER_ID, 25),
    ] as never);

    await expectBadData(
      callHook("onBeforeUpdate", makeUpdateBy({ thresholdPercentage: 10 })),
      getSloPolicyTierDuplicateThresholdMessage(10),
    );
  });

  it("validates a name or an agreement only when the update writes one", async () => {
    await expectBadData(
      callHook("onBeforeUpdate", makeUpdateBy({ name: " " })),
      SLO_POLICY_TIER_NAME_ERROR_MESSAGE,
    );
    await expectBadData(
      callHook("onBeforeUpdate", makeUpdateBy({ whatWeDo: "" })),
      SLO_POLICY_TIER_WHAT_WE_DO_ERROR_MESSAGE,
    );

    const updateBy: UpdateBy<ServiceLevelObjectiveErrorBudgetPolicyTier> =
      makeUpdateBy({ isEnabled: false });

    await expect(callHook("onBeforeUpdate", updateBy)).resolves.toBeDefined();
    expect(updateBy.data).toEqual({ isEnabled: false });
    expect(rowsSpy).not.toHaveBeenCalled();
  });

  it("leaves the flags an update does not carry alone", async () => {
    const updateBy: UpdateBy<ServiceLevelObjectiveErrorBudgetPolicyTier> =
      makeUpdateBy({ shouldCreateAlert: "true", name: "Caution" });

    await callHook("onBeforeUpdate", updateBy);

    expect(updateBy.data).toEqual({
      shouldCreateAlert: true,
      name: "Caution",
    });
  });

  it("writes Freeze Deployments back as a real boolean, and only when the update carries it", async () => {
    const on: UpdateBy<ServiceLevelObjectiveErrorBudgetPolicyTier> =
      makeUpdateBy({ freezesDeployments: "true" });

    await callHook("onBeforeUpdate", on);
    expect(on.data).toEqual({ freezesDeployments: true });

    const off: UpdateBy<ServiceLevelObjectiveErrorBudgetPolicyTier> =
      makeUpdateBy({ freezesDeployments: "false" });

    await callHook("onBeforeUpdate", off);
    expect(off.data).toEqual({ freezesDeployments: false });

    const untouched: UpdateBy<ServiceLevelObjectiveErrorBudgetPolicyTier> =
      makeUpdateBy({ name: "Freeze" });

    await callHook("onBeforeUpdate", untouched);
    expect(untouched.data).not.toHaveProperty("freezesDeployments");
  });
});

describe("onCreateSuccess", () => {
  it("asks for the SLO to be evaluated on the next tick", async () => {
    const created: ServiceLevelObjectiveErrorBudgetPolicyTier = storedTier(
      TIER_ID,
      25,
    );

    await callHook(
      "onCreateSuccess",
      {
        createBy: makeCreateBy(),
        carryForward: null,
      } as OnCreate<ServiceLevelObjectiveErrorBudgetPolicyTier>,
      created,
    );
    await flushPromises();

    expect(requestEvaluationSpy).toHaveBeenCalledWith({
      id: SLO_ID,
      data: { nextEvaluationAt: NOW },
    });
  });
});

describe("onUpdateSuccess: a tier that stops raising something", () => {
  let resolveAlertsSpy: jest.SpyInstance;
  let resolveIncidentsSpy: jest.SpyInstance;
  let clearSpy: jest.SpyInstance;

  beforeEach(() => {
    jest
      .spyOn(ServiceLevelObjectiveErrorBudgetPolicyTierService, "findOneById")
      .mockResolvedValue(storedTier(TIER_ID, 25) as never);
    resolveAlertsSpy = jest
      .spyOn(
        ServiceLevelObjectiveErrorBudgetPolicyTierService,
        "resolveOpenAlertsForTier",
      )
      .mockResolvedValue(undefined);
    resolveIncidentsSpy = jest
      .spyOn(
        ServiceLevelObjectiveErrorBudgetPolicyTierService,
        "resolveOpenIncidentsForTier",
      )
      .mockResolvedValue(undefined);
    clearSpy = jest
      .spyOn(
        ServiceLevelObjectiveErrorBudgetPolicyTierService,
        "clearOpenOutputStateForTier",
      )
      .mockResolvedValue(undefined);
  });

  it("disabled: both outputs are resolved and forgotten, and the SLO evaluated", async () => {
    await callHook("onUpdateSuccess", makeOnUpdate({ isEnabled: false }), [
      TIER_ID,
    ]);
    await flushPromises();

    expect(resolveAlertsSpy).toHaveBeenCalledWith({
      serviceLevelObjectiveId: SLO_ID,
      policyTierId: TIER_ID,
      projectId: PROJECT_ID,
      rootCause: SLO_POLICY_TIER_DISABLED_ROOT_CAUSE,
    });
    expect(resolveIncidentsSpy).toHaveBeenCalledWith({
      serviceLevelObjectiveId: SLO_ID,
      policyTierId: TIER_ID,
      projectId: PROJECT_ID,
      rootCause: SLO_POLICY_TIER_DISABLED_ROOT_CAUSE,
    });
    expect(clearSpy).toHaveBeenCalledWith({
      policyTierId: TIER_ID,
      clearAlert: true,
      clearIncident: true,
    });
    expect(requestEvaluationSpy).toHaveBeenCalledWith({
      id: SLO_ID,
      data: { nextEvaluationAt: NOW },
    });
  });

  it("alerts switched off: only the alert is resolved", async () => {
    await callHook(
      "onUpdateSuccess",
      makeOnUpdate({ shouldCreateAlert: false }),
      [TIER_ID],
    );

    expect(resolveAlertsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        rootCause: SLO_POLICY_TIER_ALERTS_OFF_ROOT_CAUSE,
      }),
    );
    expect(resolveIncidentsSpy).not.toHaveBeenCalled();
    expect(clearSpy).toHaveBeenCalledWith({
      policyTierId: TIER_ID,
      clearAlert: true,
      clearIncident: false,
    });
  });

  it("incidents switched off: only the incident is resolved", async () => {
    await callHook(
      "onUpdateSuccess",
      makeOnUpdate({ shouldCreateIncident: false }),
      [TIER_ID],
    );

    expect(resolveAlertsSpy).not.toHaveBeenCalled();
    expect(resolveIncidentsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        rootCause: SLO_POLICY_TIER_INCIDENTS_OFF_ROOT_CAUSE,
      }),
    );
  });

  it("an alert that fails to resolve keeps its open state, and costs the incident nothing", async () => {
    resolveAlertsSpy.mockRejectedValue(new Error("alert resolve failed"));

    await callHook("onUpdateSuccess", makeOnUpdate({ isEnabled: false }), [
      TIER_ID,
    ]);

    expect(resolveIncidentsSpy).toHaveBeenCalled();
    expect(clearSpy).toHaveBeenCalledWith({
      policyTierId: TIER_ID,
      clearAlert: false,
      clearIncident: true,
    });
  });

  it("a new threshold resolves nothing, and asks for an evaluation", async () => {
    await callHook(
      "onUpdateSuccess",
      makeOnUpdate({ thresholdPercentage: 30 }),
      [TIER_ID],
    );
    await flushPromises();

    expect(resolveAlertsSpy).not.toHaveBeenCalled();
    expect(resolveIncidentsSpy).not.toHaveBeenCalled();
    expect(requestEvaluationSpy).toHaveBeenCalledTimes(1);
  });

  it("Freeze Deployments switched on or off resolves nothing, and asks for an evaluation - the worker moves the gate", async () => {
    for (const freezesDeployments of [true, false]) {
      requestEvaluationSpy.mockClear();

      await callHook(
        "onUpdateSuccess",
        makeOnUpdate({ freezesDeployments: freezesDeployments }),
        [TIER_ID],
      );
      await flushPromises();

      expect(resolveAlertsSpy).not.toHaveBeenCalled();
      expect(resolveIncidentsSpy).not.toHaveBeenCalled();
      expect(clearSpy).not.toHaveBeenCalled();
      expect(requestEvaluationSpy).toHaveBeenCalledTimes(1);
      expect(requestEvaluationSpy).toHaveBeenCalledWith({
        id: SLO_ID,
        data: { nextEvaluationAt: NOW },
      });
    }
  });

  it("never writes the SLO's deploy gate itself: only the worker does", async () => {
    await callHook(
      "onUpdateSuccess",
      makeOnUpdate({ freezesDeployments: true }),
      [TIER_ID],
    );
    await flushPromises();

    for (const call of requestEvaluationSpy.mock.calls) {
      const data: Record<string, unknown> = (
        call[0] as { data: Record<string, unknown> }
      ).data;

      expect(data).not.toHaveProperty("deploymentsAllowed");
      expect(data).not.toHaveProperty("deploymentsFrozenAt");
    }
  });

  it("the worker's own lifecycle stamps do nothing at all", async () => {
    const findOneByIdSpy: jest.SpyInstance = jest.spyOn(
      ServiceLevelObjectiveErrorBudgetPolicyTierService,
      "findOneById",
    );

    await callHook(
      "onUpdateSuccess",
      makeOnUpdate({ lastAlertCreatedAt: NOW }),
      [TIER_ID],
    );
    await flushPromises();

    expect(findOneByIdSpy).not.toHaveBeenCalled();
    expect(requestEvaluationSpy).not.toHaveBeenCalled();
  });
});

describe("onDeleteSuccess", () => {
  let resolveSpy: jest.SpyInstance;

  beforeEach(() => {
    resolveSpy = jest
      .spyOn(
        ServiceLevelObjectiveErrorBudgetPolicyTierService,
        "resolveOpenAlertsAndIncidentsForTier",
      )
      .mockResolvedValue(undefined);
  });

  function onDelete(
    rows: Array<ServiceLevelObjectiveErrorBudgetPolicyTier>,
  ): OnDelete<ServiceLevelObjectiveErrorBudgetPolicyTier> {
    return {
      deleteBy: {
        query: { _id: TIER_ID.toString() },
        props: { isRoot: true },
      } as unknown as DeleteBy<ServiceLevelObjectiveErrorBudgetPolicyTier>,
      carryForward: { itemsToDelete: rows },
    };
  }

  it("resolves what each deleted tier raised, and evaluates its SLO", async () => {
    await callHook("onDeleteSuccess", onDelete([storedTier(TIER_ID, 25)]), [
      TIER_ID,
    ]);
    await flushPromises();

    expect(resolveSpy).toHaveBeenCalledWith({
      serviceLevelObjectiveId: SLO_ID,
      policyTierId: TIER_ID,
      projectId: PROJECT_ID,
      rootCause: SLO_POLICY_TIER_DELETED_ROOT_CAUSE,
    });
    expect(requestEvaluationSpy).toHaveBeenCalledWith({
      id: SLO_ID,
      data: { nextEvaluationAt: NOW },
    });
  });

  it("a candidate the delete did not remove is left alone", async () => {
    await callHook(
      "onDeleteSuccess",
      onDelete([storedTier(TIER_ID, 25), storedTier(OTHER_TIER_ID, 0)]),
      [OTHER_TIER_ID],
    );

    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(
      (resolveSpy.mock.calls[0]![0] as { policyTierId: ObjectID }).policyTierId,
    ).toEqual(OTHER_TIER_ID);
  });

  it("a failed resolve never fails the delete", async () => {
    resolveSpy.mockRejectedValue(new Error("resolve failed"));

    await expect(
      callHook("onDeleteSuccess", onDelete([storedTier(TIER_ID, 25)]), [
        TIER_ID,
      ]),
    ).resolves.toBeDefined();
  });
});

describe("resolving what a tier raised", () => {
  it("resolves every open alert carrying the tier's fingerprint", async () => {
    const alert: Alert = new Alert();
    alert.id = new ObjectID("aaaaaaaa-0000-4000-8000-000000000001");
    alert.projectId = PROJECT_ID;

    const findBySpy: jest.SpyInstance = jest
      .spyOn(AlertService, "findBy")
      .mockResolvedValue([alert] as never);
    jest
      .spyOn(AlertStateTimelineService, "getResolvedStateIdForProject")
      .mockResolvedValue(ALERT_STATE_IDS.resolved as never);
    const createSpy: jest.SpyInstance = jest
      .spyOn(AlertStateTimelineService, "create")
      .mockResolvedValue(new AlertStateTimeline() as never);

    await ServiceLevelObjectiveErrorBudgetPolicyTierService.resolveOpenAlertsForTier(
      {
        serviceLevelObjectiveId: SLO_ID,
        policyTierId: TIER_ID,
        projectId: PROJECT_ID,
        rootCause: "Because.",
      },
    );

    const query: Record<string, unknown> = (
      findBySpy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;

    expect(query["seriesFingerprint"]).toBe(
      `slo:${SLO_ID.toString()}:policy-tier:${TIER_ID.toString()}`,
    );

    const timeline: AlertStateTimeline = (
      createSpy.mock.calls[0]![0] as { data: AlertStateTimeline }
    ).data;

    expect(timeline.alertId).toEqual(alert.id);
    expect(timeline.alertStateId).toEqual(ALERT_STATE_IDS.resolved);
    expect(timeline.rootCause).toBe("Because.");
  });

  it("says why when no reason is given", async () => {
    const incident: Incident = new Incident();
    incident.id = new ObjectID("bbbbbbbb-0000-4000-8000-000000000001");
    incident.projectId = PROJECT_ID;

    jest
      .spyOn(IncidentService, "findBy")
      .mockResolvedValue([incident] as never);
    jest
      .spyOn(IncidentStateTimelineService, "getResolvedStateIdForProject")
      .mockResolvedValue(INCIDENT_STATE_IDS.resolved as never);
    const createSpy: jest.SpyInstance = jest
      .spyOn(IncidentStateTimelineService, "create")
      .mockResolvedValue(new IncidentStateTimeline() as never);

    await ServiceLevelObjectiveErrorBudgetPolicyTierService.resolveOpenIncidentsForTier(
      {
        serviceLevelObjectiveId: SLO_ID,
        policyTierId: TIER_ID,
        projectId: PROJECT_ID,
      },
    );

    expect(
      (createSpy.mock.calls[0]![0] as { data: IncidentStateTimeline }).data
        .rootCause,
    ).toBe(
      "Incident auto-resolved because the error budget policy tier that declared it no longer applies.",
    );
  });

  it("forgetting an open output clears the created stamp, hookless, and never stamps a resolve", async () => {
    const hooklessSpy: jest.SpyInstance = jest
      .spyOn(
        ServiceLevelObjectiveErrorBudgetPolicyTierService,
        "updateColumnsByIdWithoutHooks",
      )
      .mockResolvedValue(undefined as never);

    await ServiceLevelObjectiveErrorBudgetPolicyTierService.clearOpenOutputStateForTier(
      {
        policyTierId: TIER_ID,
        clearAlert: true,
        clearIncident: false,
      },
    );

    expect(hooklessSpy).toHaveBeenCalledWith({
      id: TIER_ID,
      data: { lastAlertCreatedAt: null },
    });

    hooklessSpy.mockClear();

    await ServiceLevelObjectiveErrorBudgetPolicyTierService.clearOpenOutputStateForTier(
      {
        policyTierId: TIER_ID,
        clearAlert: false,
        clearIncident: false,
      },
    );

    expect(hooklessSpy).not.toHaveBeenCalled();
  });
});

describe("resolveOpenPolicyTierAlertsAndIncidentsForSlo: an SLO disabled or archived", () => {
  it("resolves and forgets every tier's outputs, reading every tier as root", async () => {
    tierFindBySpy.mockResolvedValue([
      storedTier(TIER_ID, 25),
      storedTier(OTHER_TIER_ID, 0),
    ] as never);
    const resolveSpy: jest.SpyInstance = jest
      .spyOn(
        ServiceLevelObjectiveErrorBudgetPolicyTierService,
        "resolveOpenAlertsAndIncidentsForTier",
      )
      .mockResolvedValue(undefined);
    const clearSpy: jest.SpyInstance = jest
      .spyOn(
        ServiceLevelObjectiveErrorBudgetPolicyTierService,
        "clearOpenOutputStateForTier",
      )
      .mockResolvedValue(undefined);

    await ServiceLevelObjectiveErrorBudgetPolicyTierService.resolveOpenPolicyTierAlertsAndIncidentsForSlo(
      { sloId: SLO_ID, projectId: PROJECT_ID },
    );

    expect(tierFindBySpy).toHaveBeenCalledWith({
      query: { serviceLevelObjectiveId: SLO_ID, projectId: PROJECT_ID },
      select: { _id: true },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });
    expect(resolveSpy).toHaveBeenCalledTimes(2);
    expect(
      (resolveSpy.mock.calls[0]![0] as { rootCause: string }).rootCause,
    ).toBe(SLO_POLICY_TIER_SLO_DISABLED_OR_DELETED_ROOT_CAUSE);
    expect(clearSpy).toHaveBeenCalledTimes(2);
  });

  it("one tier failing does not skip the next, and the failure reaches the caller", async () => {
    tierFindBySpy.mockResolvedValue([
      storedTier(TIER_ID, 25),
      storedTier(OTHER_TIER_ID, 0),
    ] as never);
    const resolveSpy: jest.SpyInstance = jest
      .spyOn(
        ServiceLevelObjectiveErrorBudgetPolicyTierService,
        "resolveOpenAlertsAndIncidentsForTier",
      )
      .mockRejectedValueOnce(new Error("first tier failed"))
      .mockResolvedValue(undefined);
    const clearSpy: jest.SpyInstance = jest
      .spyOn(
        ServiceLevelObjectiveErrorBudgetPolicyTierService,
        "clearOpenOutputStateForTier",
      )
      .mockResolvedValue(undefined);

    await expect(
      ServiceLevelObjectiveErrorBudgetPolicyTierService.resolveOpenPolicyTierAlertsAndIncidentsForSlo(
        { sloId: SLO_ID, projectId: PROJECT_ID, rootCause: "Archived." },
      ),
    ).rejects.toThrow("first tier failed");

    expect(resolveSpy).toHaveBeenCalledTimes(2);
    // Only the tier that resolved forgets its open state.
    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(
      (resolveSpy.mock.calls[1]![0] as { rootCause: string }).rootCause,
    ).toBe("Archived.");
  });
});

describe("Use the recommended policy", () => {
  function caller(): DatabaseCommonInteractionProps {
    return {
      userId: USER_ID,
      userType: UserType.User,
      tenantId: PROJECT_ID,
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]: {
          _type: "UserTenantAccessPermission",
          projectId: PROJECT_ID,
          permissions: [
            Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
            Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
            Permission.ReadServiceLevelObjective,
          ].map((permission: Permission): UserPermission => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
            };
          }),
        },
      },
    };
  }

  let storedSlo: ServiceLevelObjective | null;
  let storedTiers: Array<ServiceLevelObjectiveErrorBudgetPolicyTier>;
  let sloReadSpy: jest.SpyInstance;
  let createSpy: jest.SpyInstance;
  let locks: InMemoryLocks;

  beforeEach(() => {
    storedSlo = new ServiceLevelObjective();
    storedSlo._id = SLO_ID.toString();
    storedSlo.id = SLO_ID;
    storedSlo.projectId = PROJECT_ID;
    storedTiers = [];

    sloReadSpy = jest
      .spyOn(ServiceLevelObjectiveService, "findOneBy")
      .mockImplementation((async (): Promise<ServiceLevelObjective | null> => {
        return storedSlo;
      }) as never);

    tierFindBySpy.mockImplementation((async (): Promise<
      Array<ServiceLevelObjectiveErrorBudgetPolicyTier>
    > => {
      return [...storedTiers];
    }) as never);

    // A created tier is stored, as Postgres would, so the next read sees it.
    createSpy = jest
      .spyOn(ServiceLevelObjectiveErrorBudgetPolicyTierService, "create")
      .mockImplementation((async (
        createBy: CreateBy<ServiceLevelObjectiveErrorBudgetPolicyTier>,
      ): Promise<ServiceLevelObjectiveErrorBudgetPolicyTier> => {
        const created: ServiceLevelObjectiveErrorBudgetPolicyTier =
          createBy.data;
        created._id = ObjectID.generate().toString();
        storedTiers.push(created);
        return created;
      }) as never);

    locks = new InMemoryLocks();
    locks.install();
  });

  it("reads the SLO as the caller, in the caller's project", async () => {
    await ServiceLevelObjectiveErrorBudgetPolicyTierService.getMissingRecommendedTiers(
      { serviceLevelObjectiveId: SLO_ID, props: caller() },
    );

    const args: {
      query: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    } = sloReadSpy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    };

    expect(args.query).toEqual({
      _id: SLO_ID.toString(),
      projectId: PROJECT_ID,
    });
    expect(args.props.userId).toEqual(USER_ID);
  });

  it("an SLO the caller may not read is not found", async () => {
    storedSlo = null;

    await expect(
      ServiceLevelObjectiveErrorBudgetPolicyTierService.getMissingRecommendedTiers(
        { serviceLevelObjectiveId: SLO_ID, props: caller() },
      ),
    ).rejects.toThrow(new NotFoundException(SLO_NOT_FOUND_MESSAGE));
  });

  it("a request with no project is refused", async () => {
    await expect(
      ServiceLevelObjectiveErrorBudgetPolicyTierService.getMissingRecommendedTiers(
        { serviceLevelObjectiveId: SLO_ID, props: { userId: USER_ID } },
      ),
    ).rejects.toThrow(BadDataException);
  });

  it("names what an SLO with no policy would get: the three recommended tiers", async () => {
    const missing: SloMissingRecommendedPolicyTiers =
      await ServiceLevelObjectiveErrorBudgetPolicyTierService.getMissingRecommendedTiers(
        { serviceLevelObjectiveId: SLO_ID, props: caller() },
      );

    expect(missing.tiers).toEqual([...SLO_RECOMMENDED_POLICY_TIERS]);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("adds them as the caller, raising nothing", async () => {
    const added: SloAddedRecommendedPolicyTiers =
      await ServiceLevelObjectiveErrorBudgetPolicyTierService.addMissingRecommendedTiers(
        { serviceLevelObjectiveId: SLO_ID, props: caller() },
      );

    expect(
      added.tiers.map((tier: { name: string }): string => {
        return tier.name;
      }),
    ).toEqual(["Caution", "Reliability first", "Budget exhausted"]);
    expect(
      added.tiers.every((tier: { tierId: ObjectID | null }): boolean => {
        return tier.tierId !== null;
      }),
    ).toBe(true);

    expect(createSpy).toHaveBeenCalledTimes(3);

    for (const call of createSpy.mock.calls) {
      const createBy: CreateBy<ServiceLevelObjectiveErrorBudgetPolicyTier> =
        call[0] as CreateBy<ServiceLevelObjectiveErrorBudgetPolicyTier>;

      expect(createBy.props.userId).toEqual(USER_ID);
      expect(createBy.data.projectId).toEqual(PROJECT_ID);
      expect(createBy.data.serviceLevelObjectiveId).toEqual(SLO_ID);
      expect(createBy.data.isEnabled).toBe(true);
      // The outputs keep their column defaults: nothing is raised.
      expect(createBy.data.shouldCreateAlert).toBeUndefined();
      expect(createBy.data.shouldCreateIncident).toBeUndefined();
    }

    // Budget exhausted, and only it, freezes deployments.
    expect(
      createSpy.mock.calls.map((call: Array<unknown>): [string, unknown] => {
        const data: ServiceLevelObjectiveErrorBudgetPolicyTier = (
          call[0] as CreateBy<ServiceLevelObjectiveErrorBudgetPolicyTier>
        ).data;

        return [data.name as string, data.freezesDeployments];
      }),
    ).toEqual([
      ["Caution", false],
      ["Reliability first", false],
      ["Budget exhausted", true],
    ]);
    expect(
      added.tiers.map((tier: { freezesDeployments: boolean }): boolean => {
        return tier.freezesDeployments;
      }),
    ).toEqual([false, false, true]);
  });

  it("builds each recommended tier with the freeze its definition says", () => {
    for (const recommended of SLO_RECOMMENDED_POLICY_TIERS) {
      const tier: ServiceLevelObjectiveErrorBudgetPolicyTier =
        ServiceLevelObjectiveErrorBudgetPolicyTierService.buildRecommendedTier({
          projectId: PROJECT_ID,
          serviceLevelObjectiveId: SLO_ID,
          recommended: recommended,
        });

      expect({ name: tier.name, freezes: tier.freezesDeployments }).toEqual({
        name: recommended.name,
        freezes: recommended.freezesDeployments,
      });
    }
  });

  it("is idempotent: asking again adds nothing", async () => {
    await ServiceLevelObjectiveErrorBudgetPolicyTierService.addMissingRecommendedTiers(
      { serviceLevelObjectiveId: SLO_ID, props: caller() },
    );

    const second: SloAddedRecommendedPolicyTiers =
      await ServiceLevelObjectiveErrorBudgetPolicyTierService.addMissingRecommendedTiers(
        { serviceLevelObjectiveId: SLO_ID, props: caller() },
      );

    expect(second.tiers).toEqual([]);
    expect(createSpy).toHaveBeenCalledTimes(3);
  });

  it("two requests at once - a double click - add each tier once", async () => {
    await Promise.all([
      ServiceLevelObjectiveErrorBudgetPolicyTierService.addMissingRecommendedTiers(
        { serviceLevelObjectiveId: SLO_ID, props: caller() },
      ),
      ServiceLevelObjectiveErrorBudgetPolicyTierService.addMissingRecommendedTiers(
        { serviceLevelObjectiveId: SLO_ID, props: caller() },
      ),
    ]);

    expect(createSpy).toHaveBeenCalledTimes(3);
    // The second waited for the first, then found nothing left to add.
    expect(locks.eventsOf("wait").length).toBeGreaterThan(0);
    expect(locks.eventsOf("lock")).toHaveLength(2);
  });

  it("adds only what is missing", async () => {
    storedTiers = [storedTier(TIER_ID, 50, { name: "Yellow" })];

    const added: SloAddedRecommendedPolicyTiers =
      await ServiceLevelObjectiveErrorBudgetPolicyTierService.addMissingRecommendedTiers(
        { serviceLevelObjectiveId: SLO_ID, props: caller() },
      );

    expect(
      added.tiers.map((tier: { name: string }): string => {
        return tier.name;
      }),
    ).toEqual(["Reliability first", "Budget exhausted"]);
  });

  it("holds a lock per SLO, and releases it", async () => {
    await ServiceLevelObjectiveErrorBudgetPolicyTierService.addMissingRecommendedTiers(
      { serviceLevelObjectiveId: SLO_ID, props: caller() },
    );

    expect(locks.eventsOf("lock")).toHaveLength(1);
    expect(locks.eventsOf("release")).toHaveLength(1);
    expect(locks.eventsOf("lock")[0]).toContain(LOCK_NAMESPACE);
    expect(locks.eventsOf("lock")[0]).toContain(SLO_ID.toString());
  });

  it("without Redis it still adds, and says so in the log", async () => {
    locks.unreachable = true;

    const added: SloAddedRecommendedPolicyTiers =
      await ServiceLevelObjectiveErrorBudgetPolicyTierService.addMissingRecommendedTiers(
        { serviceLevelObjectiveId: SLO_ID, props: caller() },
      );

    expect(added.tiers).toHaveLength(3);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "Could not take the lock for adding the recommended error budget policy",
      ),
      expect.anything(),
    );
  });

  describe("all or nothing", () => {
    // Each removal of a tier, as the delete was asked for.
    let deleteSpy: jest.SpyInstance;

    beforeEach(() => {
      deleteSpy = jest
        .spyOn(ServiceLevelObjectiveErrorBudgetPolicyTierService, "deleteOneBy")
        .mockImplementation((async (deleteBy: {
          query: Record<string, unknown>;
        }): Promise<number> => {
          const before: number = storedTiers.length;
          storedTiers = storedTiers.filter(
            (tier: ServiceLevelObjectiveErrorBudgetPolicyTier): boolean => {
              return tier._id !== deleteBy.query["_id"];
            },
          );
          return before - storedTiers.length;
        }) as never);
    });

    // The create of the `failing`th tier (counting from 1) is refused.
    function refuseCreate(failing: number): void {
      let calls: number = 0;
      createSpy.mockImplementation((async (
        createBy: CreateBy<ServiceLevelObjectiveErrorBudgetPolicyTier>,
      ): Promise<ServiceLevelObjectiveErrorBudgetPolicyTier> => {
        calls++;

        if (calls === failing) {
          throw new BadDataException("refused");
        }

        createBy.data._id = ObjectID.generate().toString();
        storedTiers.push(createBy.data);
        return createBy.data;
      }) as never);
    }

    it("a create that fails stops the request, and the tiers it added are removed again", async () => {
      refuseCreate(3);

      await expect(
        ServiceLevelObjectiveErrorBudgetPolicyTierService.addMissingRecommendedTiers(
          { serviceLevelObjectiveId: SLO_ID, props: caller() },
        ),
      ).rejects.toThrow("refused");

      expect(createSpy).toHaveBeenCalledTimes(3);
      expect(storedTiers).toEqual([]);
      expect(deleteSpy).toHaveBeenCalledTimes(2);
    });

    it("removes them as OneUptime, by their ids, on their SLO in their project", async () => {
      refuseCreate(2);

      await expect(
        ServiceLevelObjectiveErrorBudgetPolicyTierService.addMissingRecommendedTiers(
          { serviceLevelObjectiveId: SLO_ID, props: caller() },
        ),
      ).rejects.toThrow("refused");

      const addedId: string = (
        createSpy.mock
          .calls[0]![0] as CreateBy<ServiceLevelObjectiveErrorBudgetPolicyTier>
      ).data._id as string;

      expect(deleteSpy).toHaveBeenCalledTimes(1);
      expect(deleteSpy.mock.calls[0]![0]).toEqual({
        query: {
          _id: addedId,
          projectId: PROJECT_ID,
          serviceLevelObjectiveId: SLO_ID,
        },
        props: {
          isRoot: true,
        },
      });
    });

    it("leaves the tiers the SLO already had", async () => {
      storedTiers = [storedTier(TIER_ID, 50, { name: "Yellow" })];
      refuseCreate(2);

      await expect(
        ServiceLevelObjectiveErrorBudgetPolicyTierService.addMissingRecommendedTiers(
          { serviceLevelObjectiveId: SLO_ID, props: caller() },
        ),
      ).rejects.toThrow("refused");

      expect(
        storedTiers.map(
          (tier: ServiceLevelObjectiveErrorBudgetPolicyTier): string => {
            return tier.name as string;
          },
        ),
      ).toEqual(["Yellow"]);
    });

    it("so asking again adds the whole policy", async () => {
      refuseCreate(3);

      await expect(
        ServiceLevelObjectiveErrorBudgetPolicyTierService.addMissingRecommendedTiers(
          { serviceLevelObjectiveId: SLO_ID, props: caller() },
        ),
      ).rejects.toThrow("refused");

      refuseCreate(0);

      const retried: SloAddedRecommendedPolicyTiers =
        await ServiceLevelObjectiveErrorBudgetPolicyTierService.addMissingRecommendedTiers(
          { serviceLevelObjectiveId: SLO_ID, props: caller() },
        );

      expect(retried.tiers).toHaveLength(3);
      expect(storedTiers).toHaveLength(3);
    });

    it("a removal that fails is logged, the rest are still removed, and the create's refusal is the one passed on", async () => {
      refuseCreate(3);
      deleteSpy.mockRejectedValueOnce(new Error("gone away"));

      await expect(
        ServiceLevelObjectiveErrorBudgetPolicyTierService.addMissingRecommendedTiers(
          { serviceLevelObjectiveId: SLO_ID, props: caller() },
        ),
      ).rejects.toThrow("refused");

      expect(deleteSpy).toHaveBeenCalledTimes(2);
      expect(storedTiers).toHaveLength(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("the SLO keeps it: Error: gone away"),
        expect.anything(),
      );
    });

    it("removes them while it still holds the lock, so a request waiting for it finds the SLO as it was", async () => {
      refuseCreate(3);

      // Each removal lands in the lock's own record, so the order is the real one.
      deleteSpy.mockImplementation((async (): Promise<number> => {
        locks.events.push("remove");
        return 1;
      }) as never);

      await expect(
        ServiceLevelObjectiveErrorBudgetPolicyTierService.addMissingRecommendedTiers(
          { serviceLevelObjectiveId: SLO_ID, props: caller() },
        ),
      ).rejects.toThrow("refused");

      expect(
        locks.events.map((event: string): string => {
          return event.split(":")[0]!;
        }),
      ).toEqual(["lock", "remove", "remove", "release"]);
    });
  });
});
