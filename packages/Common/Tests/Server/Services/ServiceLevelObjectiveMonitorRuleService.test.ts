import Label from "../../../Models/DatabaseModels/Label";
import { ServiceLevelObjectiveFeedEventType } from "../../../Models/DatabaseModels/ServiceLevelObjectiveFeed";
import ServiceLevelObjectiveMonitorRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveMonitorRule";
import LabelService from "../../../Server/Services/LabelService";
import ServiceLevelObjectiveFeedService from "../../../Server/Services/ServiceLevelObjectiveFeedService";
import ServiceLevelObjectiveMonitorRuleEngineService from "../../../Server/Services/ServiceLevelObjectiveMonitorRuleEngineService";
import ServiceLevelObjectiveMonitorRuleService from "../../../Server/Services/ServiceLevelObjectiveMonitorRuleService";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import {
  OnCreate,
  OnDelete,
  OnUpdate,
} from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import SloRecordReferenceValidator from "../../../Server/Utils/Slo/SloRecordReferenceValidator";
import logger from "../../../Server/Utils/Logger";
import SloLegacyMonitorLabelAdoption from "../../../Server/Utils/Slo/SloLegacyMonitorLabelAdoption";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test - the write hooks of SLO monitor rules.
 *
 *   - A rule has to be about something: an empty rule matches nothing yet
 *     still locks the SLO's monitor list, so it is refused on create AND on an
 *     edit that would empty it (judged on the merged, stored-plus-edited rule).
 *   - A pattern the engine could never match is refused at the write (#2940).
 *   - The SLO a rule points at must belong to the caller's project.
 *   - Validation reads made before the permission check pin the caller's
 *     tenant; onBeforeDelete reads with the caller's props and changes nothing.
 *   - Every create, edit and delete re-syncs the SLO's monitors, quietly: the
 *     rule is saved even when the sync fails.
 *   - Every create, meaningful edit and delete is told to the SLO's feed as
 *     the person who did it, with user-controlled text escaped.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "23232323-2323-4323-8323-232323232323",
);
const SLO_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_SLO_ID: ObjectID = new ObjectID(
  "1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a",
);
const THIRD_SLO_ID: ObjectID = new ObjectID(
  "1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b",
);
const RULE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const OTHER_RULE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const CREATOR_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const LABEL_ID: ObjectID = new ObjectID("dddddddd-dddd-4ddd-8ddd-dddddddddddd");

const SLO_LINK: string = "[SLO Checkout](https://oneuptime.test/slos/1)";

type Model = ServiceLevelObjectiveMonitorRule;

// Calls a protected hook without widening the service's public surface.
function callHook(name: string, ...args: Array<unknown>): Promise<unknown> {
  const hooks: Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  > = ServiceLevelObjectiveMonitorRuleService as unknown as Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  >;

  return hooks[name]!.apply(ServiceLevelObjectiveMonitorRuleService, args);
}

function criteria(
  filterCondition: FilterCondition,
  filters: RuleCriteria["filters"],
): RuleCriteria {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition: filterCondition,
    filters: filters,
  };
}

function makeRule(fields: {
  id?: ObjectID | undefined;
  serviceLevelObjectiveId?: ObjectID | undefined;
  name?: string | undefined;
  description?: string | undefined;
  isEnabled?: boolean | undefined;
  labelIds?: Array<ObjectID> | undefined;
  monitorNamePattern?: string | undefined;
  monitorDescriptionPattern?: string | undefined;
  criteria?: RuleCriteria | null | undefined;
  createdByUserId?: ObjectID | undefined;
}): Model {
  const id: ObjectID = fields.id || RULE_ID;

  return {
    id: id,
    _id: id.toString(),
    projectId: PROJECT_ID,
    serviceLevelObjectiveId: fields.serviceLevelObjectiveId || SLO_ID,
    name: fields.name === undefined ? "Production APIs" : fields.name,
    description: fields.description,
    isEnabled: fields.isEnabled === undefined ? true : fields.isEnabled,
    monitorLabels: (fields.labelIds || []).map((labelId: ObjectID) => {
      return { id: labelId, _id: labelId.toString() } as unknown as Label;
    }),
    monitorNamePattern: fields.monitorNamePattern,
    monitorDescriptionPattern: fields.monitorDescriptionPattern,
    criteria: fields.criteria,
    createdByUserId: fields.createdByUserId,
  } as unknown as Model;
}

function makeCreateBy(
  data: Record<string, unknown>,
  props?: Record<string, unknown> | undefined,
): CreateBy<Model> {
  return {
    data: data as unknown as Model,
    props: props || { tenantId: PROJECT_ID, userId: USER_ID },
  } as unknown as CreateBy<Model>;
}

function makeUpdateBy(
  data: Record<string, unknown>,
  props?: Record<string, unknown> | undefined,
): UpdateBy<Model> {
  return {
    query: { _id: RULE_ID.toString() },
    data: data,
    props: props || { tenantId: PROJECT_ID, userId: USER_ID },
    limit: 1,
    skip: 0,
  } as unknown as UpdateBy<Model>;
}

function makeDeleteBy(
  props?: Record<string, unknown> | undefined,
): DeleteBy<Model> {
  return {
    query: { _id: RULE_ID.toString() },
    props: props || { tenantId: PROJECT_ID, userId: USER_ID },
    limit: 1,
    skip: 0,
  } as unknown as DeleteBy<Model>;
}

interface FeedCall {
  serviceLevelObjectiveId: ObjectID;
  projectId: ObjectID;
  serviceLevelObjectiveFeedEventType: ServiceLevelObjectiveFeedEventType;
  feedInfoInMarkdown: string;
  moreInformationInMarkdown?: string | undefined;
  userId?: ObjectID | undefined;
}

function feedCalls(feedSpy: jest.SpyInstance): Array<FeedCall> {
  return feedSpy.mock.calls.map((call: Array<unknown>) => {
    return call[0] as FeedCall;
  });
}

interface HookSpies {
  sync: jest.SpyInstance;
  feed: jest.SpyInstance;
  markdownLink: jest.SpyInstance;
  labelFindBy: jest.SpyInstance;
  referenceValidator: jest.SpyInstance;
  ruleFindBy: jest.SpyInstance;
  ruleFindOneById: jest.SpyInstance;
}

function installSpies(): HookSpies {
  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });

  /*
   * The create hook adopts a legacy label list, which needs a live Postgres.
   * ServiceLevelObjectiveMonitorRuleLegacyLabelAdoption.test.ts covers when.
   */
  jest
    .spyOn(SloLegacyMonitorLabelAdoption, "adoptLegacyMonitorLabels")
    .mockResolvedValue([]);

  return {
    sync: jest
      .spyOn(
        ServiceLevelObjectiveMonitorRuleEngineService,
        "syncMonitorsForSlo",
      )
      .mockResolvedValue({ monitorIdsAdded: [], monitorIdsRemoved: [] }),
    feed: jest
      .spyOn(
        ServiceLevelObjectiveFeedService,
        "createServiceLevelObjectiveFeedItem",
      )
      .mockResolvedValue(undefined),
    markdownLink: jest
      .spyOn(ServiceLevelObjectiveService, "getSloMarkdownLink")
      .mockResolvedValue(SLO_LINK),
    labelFindBy: jest.spyOn(LabelService, "findBy").mockResolvedValue([
      {
        id: LABEL_ID,
        _id: LABEL_ID.toString(),
        name: "Production",
      } as unknown as Label,
    ]),
    referenceValidator: jest
      .spyOn(
        SloRecordReferenceValidator,
        "validateServiceLevelObjectivesBelongToProject",
      )
      .mockResolvedValue(undefined),
    ruleFindBy: jest
      .spyOn(ServiceLevelObjectiveMonitorRuleService, "findBy")
      .mockResolvedValue([]),
    ruleFindOneById: jest
      .spyOn(ServiceLevelObjectiveMonitorRuleService, "findOneById")
      .mockResolvedValue(null),
  };
}

describe("ServiceLevelObjectiveMonitorRuleService.onBeforeCreate", () => {
  let spies: HookSpies;

  beforeEach(() => {
    spies = installSpies();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("refuses a rule that names no SLO", async () => {
    const promise: Promise<unknown> = callHook(
      "onBeforeCreate",
      makeCreateBy({ projectId: PROJECT_ID, monitorNamePattern: ".*" }),
    );

    await expect(promise).rejects.toThrow(BadDataException);
    await expect(promise).rejects.toThrow(
      "Service Level Objective ID is required",
    );
  });

  it("refuses a rule with no match criteria, and names .* as the way to match everything", async () => {
    const promise: Promise<unknown> = callHook(
      "onBeforeCreate",
      makeCreateBy({
        projectId: PROJECT_ID,
        serviceLevelObjectiveId: SLO_ID,
        monitorLabels: [],
      }),
    );

    await expect(promise).rejects.toThrow(BadDataException);
    await expect(promise).rejects.toThrow(
      "Use .* as the name pattern to match every monitor in the project.",
    );
    expect(spies.referenceValidator).not.toHaveBeenCalled();
  });

  it("refuses criteria without a single condition", async () => {
    await expect(
      callHook(
        "onBeforeCreate",
        makeCreateBy({
          projectId: PROJECT_ID,
          serviceLevelObjectiveId: SLO_ID,
          criteria: criteria(FilterCondition.All, []),
        }),
      ),
    ).rejects.toThrow(
      "An SLO monitor rule needs at least one match condition.",
    );
  });

  it("refuses criteria that fail validation", async () => {
    await expect(
      callHook(
        "onBeforeCreate",
        makeCreateBy({
          projectId: PROJECT_ID,
          serviceLevelObjectiveId: SLO_ID,
          criteria: criteria(FilterCondition.All, [
            {
              field: "monitorLabels",
              operator: RuleCriteriaOperator.HasAnyOf,
              value: "not-an-array",
            },
          ]),
        }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  const accepted: Array<{ label: string; data: Record<string, unknown> }> = [
    {
      label: "labels alone",
      data: { monitorLabels: [{ _id: LABEL_ID.toString() }] },
    },
    { label: "a name pattern alone", data: { monitorNamePattern: "^api-" } },
    {
      label: "a description pattern alone",
      data: { monitorDescriptionPattern: "*tier-1*" },
    },
    {
      label: "criteria with a condition",
      data: {
        criteria: criteria(FilterCondition.Any, [
          {
            field: "monitorNamePattern",
            operator: RuleCriteriaOperator.StartsWith,
            value: "api",
          },
        ]),
      },
    },
  ];

  for (const testCase of accepted) {
    it(`accepts a rule with ${testCase.label}`, async () => {
      await expect(
        callHook(
          "onBeforeCreate",
          makeCreateBy({
            projectId: PROJECT_ID,
            serviceLevelObjectiveId: SLO_ID,
            ...testCase.data,
          }),
        ),
      ).resolves.toBeDefined();
    });
  }

  it("refuses a name pattern the engine could never match", async () => {
    await expect(
      callHook(
        "onBeforeCreate",
        makeCreateBy({
          projectId: PROJECT_ID,
          serviceLevelObjectiveId: SLO_ID,
          monitorNamePattern: "api-(01",
        }),
      ),
    ).rejects.toThrow('Monitor Name Pattern "api-(01"');
  });

  it("refuses a description pattern the engine could never match", async () => {
    await expect(
      callHook(
        "onBeforeCreate",
        makeCreateBy({
          projectId: PROJECT_ID,
          serviceLevelObjectiveId: SLO_ID,
          monitorLabels: [{ _id: LABEL_ID.toString() }],
          monitorDescriptionPattern: "[unclosed",
        }),
      ),
    ).rejects.toThrow('Monitor Description Pattern "[unclosed"');
  });

  it("checks the SLO belongs to the caller's project", async () => {
    await callHook(
      "onBeforeCreate",
      makeCreateBy({
        projectId: OTHER_PROJECT_ID,
        serviceLevelObjectiveId: SLO_ID,
        monitorNamePattern: ".*",
      }),
    );

    expect(spies.referenceValidator).toHaveBeenCalledTimes(1);

    const call: {
      projectId: ObjectID;
      subject: string;
      serviceLevelObjectives: unknown;
    } = spies.referenceValidator.mock.calls[0]![0] as {
      projectId: ObjectID;
      subject: string;
      serviceLevelObjectives: unknown;
    };

    // The caller's tenant wins over whatever project the payload claims.
    expect(call.projectId).toBe(PROJECT_ID);
    expect(call.subject).toBe("SLO monitor rule");
    expect(
      SloRecordReferenceValidator.getReferencedIds(call.serviceLevelObjectives),
    ).toEqual([SLO_ID.toString()]);
  });

  it("scopes a root write with no tenant to the payload's project", async () => {
    await callHook(
      "onBeforeCreate",
      makeCreateBy(
        {
          projectId: OTHER_PROJECT_ID,
          serviceLevelObjectiveId: SLO_ID,
          monitorNamePattern: ".*",
        },
        { isRoot: true },
      ),
    );

    expect(
      (
        spies.referenceValidator.mock.calls[0]![0] as {
          projectId: ObjectID;
        }
      ).projectId,
    ).toBe(OTHER_PROJECT_ID);
  });

  it("reads the SLO id off a relation-shaped payload", async () => {
    await callHook(
      "onBeforeCreate",
      makeCreateBy({
        projectId: PROJECT_ID,
        serviceLevelObjective: { _id: SLO_ID.toString() },
        monitorNamePattern: ".*",
      }),
    );

    expect(
      SloRecordReferenceValidator.getReferencedIds(
        (
          spies.referenceValidator.mock.calls[0]![0] as {
            serviceLevelObjectives: unknown;
          }
        ).serviceLevelObjectives,
      ),
    ).toEqual([SLO_ID.toString()]);
  });

  it("refuses an SLO from another project", async () => {
    spies.referenceValidator.mockRejectedValue(
      new BadDataException(
        "This SLO monitor rule references a Service Level Objective from another project.",
      ),
    );

    await expect(
      callHook(
        "onBeforeCreate",
        makeCreateBy({
          projectId: PROJECT_ID,
          serviceLevelObjectiveId: SLO_ID,
          monitorNamePattern: ".*",
        }),
      ),
    ).rejects.toThrow("another project");
  });
});

describe("ServiceLevelObjectiveMonitorRuleService.onCreateSuccess", () => {
  let spies: HookSpies;

  beforeEach(() => {
    spies = installSpies();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function onCreate(props?: Record<string, unknown>): OnCreate<Model> {
    return {
      createBy: makeCreateBy({}, props),
      carryForward: null,
    };
  }

  it("posts MonitorRuleAdded as the person who added it, then syncs the rule's SLO", async () => {
    spies.ruleFindOneById.mockResolvedValue(
      makeRule({ labelIds: [LABEL_ID], monitorNamePattern: "^api-" }),
    );

    await callHook("onCreateSuccess", onCreate(), makeRule({}));

    const calls: Array<FeedCall> = feedCalls(spies.feed);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.serviceLevelObjectiveFeedEventType).toBe(
      ServiceLevelObjectiveFeedEventType.MonitorRuleAdded,
    );
    expect(calls[0]!.serviceLevelObjectiveId).toBe(SLO_ID);
    expect(calls[0]!.projectId).toBe(PROJECT_ID);
    expect(calls[0]!.userId).toBe(USER_ID);
    expect(calls[0]!.feedInfoInMarkdown).toContain("**Production APIs**");
    expect(calls[0]!.feedInfoInMarkdown).toContain(SLO_LINK);
    expect(calls[0]!.moreInformationInMarkdown).toContain(
      "- **Status:** Enabled",
    );
    // Label names are looked up, then the whole summary is escaped.
    expect(calls[0]!.moreInformationInMarkdown).toContain(
      'Labels has any of "Production" AND Name matches pattern "^api\\-"',
    );
    expect(spies.markdownLink).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      sloId: SLO_ID,
    });

    expect(spies.sync).toHaveBeenCalledTimes(1);
    expect(spies.sync).toHaveBeenCalledWith({
      serviceLevelObjectiveId: SLO_ID,
    });

    // Cause before effect: the rule is announced before its monitors attach.
    expect(spies.feed.mock.invocationCallOrder[0]!).toBeLessThan(
      spies.sync.mock.invocationCallOrder[0]!,
    );
  });

  it("reads the stored rule back as root, so the feed describes what the engine evaluates", async () => {
    await callHook("onCreateSuccess", onCreate(), makeRule({}));

    const call: {
      id: ObjectID;
      select: Record<string, unknown>;
      props: unknown;
    } = spies.ruleFindOneById.mock.calls[0]![0] as {
      id: ObjectID;
      select: Record<string, unknown>;
      props: unknown;
    };

    expect(call.id).toBe(RULE_ID);
    expect(call.select["criteria"]).toBe(true);
    expect(call.props).toEqual({ isRoot: true });
  });

  it("credits the user stamped on the row over the request's user", async () => {
    await callHook(
      "onCreateSuccess",
      onCreate(),
      makeRule({ createdByUserId: CREATOR_ID }),
    );

    expect(feedCalls(spies.feed)[0]!.userId).toBe(CREATOR_ID);
  });

  it("says when a rule was added disabled, so nobody waits for monitors that will not come", async () => {
    spies.ruleFindOneById.mockResolvedValue(
      makeRule({ isEnabled: false, monitorNamePattern: ".*" }),
    );

    await callHook("onCreateSuccess", onCreate(), makeRule({}));

    const call: FeedCall = feedCalls(spies.feed)[0]!;

    expect(call.feedInfoInMarkdown).toContain("added disabled");
    expect(call.moreInformationInMarkdown).toContain("- **Status:** Disabled");
  });

  it("escapes the rule name so it cannot rewrite the markdown around it", async () => {
    spies.ruleFindOneById.mockResolvedValue(
      makeRule({ name: "**x** [y](https://evil.test)" }),
    );

    await callHook("onCreateSuccess", onCreate(), makeRule({}));

    const text: string = feedCalls(spies.feed)[0]!.feedInfoInMarkdown;

    expect(text).toContain("**\\*\\*x\\*\\* \\[y\\]\\(https://evil.test\\)**");
    expect(text).not.toContain("](https://evil.test)");
  });

  it("falls back to the created row when the read-back fails", async () => {
    spies.ruleFindOneById.mockRejectedValue(new Error("db down"));

    await callHook("onCreateSuccess", onCreate(), makeRule({}));

    expect(spies.feed).toHaveBeenCalledTimes(1);
    expect(spies.sync).toHaveBeenCalledWith({
      serviceLevelObjectiveId: SLO_ID,
    });
  });

  it("never fails the create when the feed or the sync fails", async () => {
    spies.markdownLink.mockRejectedValue(new Error("config down"));
    spies.sync.mockRejectedValue(new Error("db down"));

    const createdItem: Model = makeRule({});

    await expect(
      callHook("onCreateSuccess", onCreate(), createdItem),
    ).resolves.toBe(createdItem);
    expect(spies.sync).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a created row without an id", async () => {
    const createdItem: Model = { name: "x" } as unknown as Model;

    await expect(
      callHook("onCreateSuccess", onCreate(), createdItem),
    ).resolves.toBe(createdItem);
    expect(spies.feed).not.toHaveBeenCalled();
    expect(spies.sync).not.toHaveBeenCalled();
  });
});

describe("ServiceLevelObjectiveMonitorRuleService.onBeforeUpdate", () => {
  let spies: HookSpies;

  beforeEach(() => {
    spies = installSpies();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("refuses a pattern the engine could never match, before reading anything", async () => {
    await expect(
      callHook(
        "onBeforeUpdate",
        makeUpdateBy({ monitorNamePattern: "api-(01" }),
      ),
    ).rejects.toThrow('Monitor Name Pattern "api-(01"');
    expect(spies.ruleFindBy).not.toHaveBeenCalled();
  });

  it("reads the touched rules with the caller's tenant pinned onto the raw query", async () => {
    spies.ruleFindBy.mockResolvedValue([
      makeRule({ monitorNamePattern: ".*" }),
    ]);

    await callHook("onBeforeUpdate", makeUpdateBy({ name: "Renamed" }));

    const call: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: unknown;
    } = spies.ruleFindBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: unknown;
    };

    expect(call.query).toEqual({
      _id: RULE_ID.toString(),
      projectId: PROJECT_ID,
    });
    expect(call.select["criteria"]).toBe(true);
    expect(call.select["serviceLevelObjectiveId"]).toBe(true);
    expect(call.props).toEqual({ isRoot: true });
  });

  it("trusts a genuinely root caller's query as it is", async () => {
    await callHook(
      "onBeforeUpdate",
      makeUpdateBy({ isEnabled: false }, { isRoot: true }),
    );

    expect(
      (
        spies.ruleFindBy.mock.calls[0]![0] as {
          query: Record<string, unknown>;
        }
      ).query,
    ).toEqual({ _id: RULE_ID.toString() });
  });

  it("costs no read for an edit that touches nothing it validates or describes", async () => {
    await callHook(
      "onBeforeUpdate",
      makeUpdateBy({ createdByUserId: USER_ID }),
    );

    expect(spies.ruleFindBy).not.toHaveBeenCalled();
  });

  it("lets an edit clear the labels on a rule that still has a name pattern", async () => {
    spies.ruleFindBy.mockResolvedValue([
      makeRule({ labelIds: [LABEL_ID], monitorNamePattern: "^api-" }),
    ]);

    await expect(
      callHook("onBeforeUpdate", makeUpdateBy({ monitorLabels: [] })),
    ).resolves.toBeDefined();
  });

  it("refuses an edit that clears the rule's last criterion", async () => {
    spies.ruleFindBy.mockResolvedValue([makeRule({ labelIds: [LABEL_ID] })]);

    await expect(
      callHook("onBeforeUpdate", makeUpdateBy({ monitorLabels: [] })),
    ).rejects.toThrow("needs at least one match criterion");
  });

  it("refuses criteria emptied of every condition", async () => {
    spies.ruleFindBy.mockResolvedValue([makeRule({ labelIds: [LABEL_ID] })]);

    await expect(
      callHook(
        "onBeforeUpdate",
        makeUpdateBy({ criteria: criteria(FilterCondition.All, []) }),
      ),
    ).rejects.toThrow("needs at least one match condition");
  });

  it("carries each touched rule forward as it was before the edit", async () => {
    const stored: Model = makeRule({ monitorNamePattern: ".*" });
    spies.ruleFindBy.mockResolvedValue([stored]);

    const result: OnUpdate<Model> = (await callHook(
      "onBeforeUpdate",
      makeUpdateBy({ name: "Renamed" }),
    )) as OnUpdate<Model>;

    expect(result.carryForward).toEqual({ rulesBeforeUpdate: [stored] });
  });
});

describe("ServiceLevelObjectiveMonitorRuleService.onUpdateSuccess", () => {
  let spies: HookSpies;

  beforeEach(() => {
    spies = installSpies();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function onUpdate(
    rulesBeforeUpdate: Array<Model>,
    props?: Record<string, unknown>,
  ): OnUpdate<Model> {
    return {
      updateBy: makeUpdateBy({ name: "ignored" }, props),
      carryForward: { rulesBeforeUpdate: rulesBeforeUpdate },
    };
  }

  it("posts MonitorRuleChanged listing what changed, as the person who changed it", async () => {
    spies.ruleFindBy.mockResolvedValue([
      makeRule({
        name: "Payments APIs",
        description: "now documented",
        monitorNamePattern: "^payments-",
      }),
    ]);

    await callHook(
      "onUpdateSuccess",
      onUpdate([makeRule({ name: "Production APIs", labelIds: [LABEL_ID] })]),
      [RULE_ID],
    );

    const calls: Array<FeedCall> = feedCalls(spies.feed);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.serviceLevelObjectiveFeedEventType).toBe(
      ServiceLevelObjectiveFeedEventType.MonitorRuleChanged,
    );
    expect(calls[0]!.userId).toBe(USER_ID);
    expect(calls[0]!.feedInfoInMarkdown).toContain(
      "Updated monitor rule **Payments APIs**",
    );
    expect(calls[0]!.moreInformationInMarkdown).toContain(
      "- **Name:** **Production APIs** → **Payments APIs**",
    );
    expect(calls[0]!.moreInformationInMarkdown).toContain(
      "- **Description:** added",
    );
    expect(calls[0]!.moreInformationInMarkdown).toContain(
      '- **Match criteria (before):** Labels has any of "Production"',
    );
    expect(calls[0]!.moreInformationInMarkdown).toContain(
      '- **Match criteria (now):** Name matches pattern "^payments\\-"',
    );
  });

  it("stays silent for a full-form resubmit that changed nothing, and still re-syncs", async () => {
    const rule: Model = makeRule({ labelIds: [LABEL_ID] });
    spies.ruleFindBy.mockResolvedValue([makeRule({ labelIds: [LABEL_ID] })]);

    await callHook("onUpdateSuccess", onUpdate([rule]), [RULE_ID]);

    expect(spies.feed).not.toHaveBeenCalled();
    expect(spies.sync).toHaveBeenCalledWith({
      serviceLevelObjectiveId: SLO_ID,
    });
  });

  it("describes a lone disable as a disable", async () => {
    spies.ruleFindBy.mockResolvedValue([
      makeRule({ isEnabled: false, labelIds: [LABEL_ID] }),
    ]);

    await callHook(
      "onUpdateSuccess",
      onUpdate([makeRule({ labelIds: [LABEL_ID] })]),
      [RULE_ID],
    );

    const call: FeedCall = feedCalls(spies.feed)[0]!;

    expect(call.feedInfoInMarkdown).toContain(
      "Disabled monitor rule **Production APIs**",
    );
    expect(call.moreInformationInMarkdown).toBe(
      "- **Status:** Enabled → Disabled",
    );
  });

  it("describes a lone enable as an enable", async () => {
    spies.ruleFindBy.mockResolvedValue([makeRule({ labelIds: [LABEL_ID] })]);

    await callHook(
      "onUpdateSuccess",
      onUpdate([makeRule({ isEnabled: false, labelIds: [LABEL_ID] })]),
      [RULE_ID],
    );

    expect(feedCalls(spies.feed)[0]!.feedInfoInMarkdown).toContain(
      "Enabled monitor rule **Production APIs**",
    );
  });

  it("reads the updated rules back by id, as root", async () => {
    await callHook("onUpdateSuccess", onUpdate([]), [RULE_ID]);

    const call: { query: Record<string, unknown>; props: unknown } = spies
      .ruleFindBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      props: unknown;
    };

    expect(JSON.stringify(call.query["_id"])).toContain(RULE_ID.toString());
    expect(call.props).toEqual({ isRoot: true });
  });

  it("re-syncs each touched SLO exactly once", async () => {
    spies.ruleFindBy.mockResolvedValue([
      makeRule({ id: RULE_ID, serviceLevelObjectiveId: SLO_ID }),
      makeRule({ id: OTHER_RULE_ID, serviceLevelObjectiveId: SLO_ID }),
      makeRule({
        id: new ObjectID("45454545-4545-4545-8545-454545454545"),
        serviceLevelObjectiveId: OTHER_SLO_ID,
      }),
    ]);

    await callHook("onUpdateSuccess", onUpdate([]), [RULE_ID, OTHER_RULE_ID]);

    expect(spies.sync).toHaveBeenCalledTimes(2);
    expect(spies.sync).toHaveBeenNthCalledWith(1, {
      serviceLevelObjectiveId: SLO_ID,
    });
    expect(spies.sync).toHaveBeenNthCalledWith(2, {
      serviceLevelObjectiveId: OTHER_SLO_ID,
    });
  });

  it("only describes rows the update actually wrote", async () => {
    spies.ruleFindBy.mockResolvedValue([
      makeRule({ id: RULE_ID, name: "Renamed" }),
    ]);

    await callHook(
      "onUpdateSuccess",
      onUpdate([
        makeRule({ id: RULE_ID }),
        makeRule({ id: OTHER_RULE_ID, serviceLevelObjectiveId: OTHER_SLO_ID }),
      ]),
      [RULE_ID],
    );

    expect(spies.feed).toHaveBeenCalledTimes(1);
    // The un-written rule's SLO is not re-synced on its behalf either.
    expect(spies.sync).toHaveBeenCalledTimes(1);
    expect(spies.sync).toHaveBeenCalledWith({
      serviceLevelObjectiveId: SLO_ID,
    });
  });

  it("still re-syncs from the snapshot when the read-back fails", async () => {
    spies.ruleFindBy.mockRejectedValue(new Error("db down"));

    await callHook(
      "onUpdateSuccess",
      onUpdate([makeRule({ serviceLevelObjectiveId: OTHER_SLO_ID })]),
      [RULE_ID],
    );

    expect(spies.feed).not.toHaveBeenCalled();
    expect(spies.sync).toHaveBeenCalledWith({
      serviceLevelObjectiveId: OTHER_SLO_ID,
    });
  });

  it("never fails the update when the sync fails", async () => {
    spies.ruleFindBy.mockResolvedValue([makeRule({})]);
    spies.sync.mockRejectedValue(new Error("db down"));

    await expect(
      callHook("onUpdateSuccess", onUpdate([]), [RULE_ID]),
    ).resolves.toBeDefined();
  });
});

describe("ServiceLevelObjectiveMonitorRuleService delete hooks", () => {
  let spies: HookSpies;

  beforeEach(() => {
    spies = installSpies();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reads the doomed rules with the caller's own props - never as root - and changes nothing", async () => {
    const deleteBy: DeleteBy<Model> = makeDeleteBy();
    spies.ruleFindBy.mockResolvedValue([makeRule({})]);

    const result: OnDelete<Model> = (await callHook(
      "onBeforeDelete",
      deleteBy,
    )) as OnDelete<Model>;

    const call: { query: unknown; props: unknown } = spies.ruleFindBy.mock
      .calls[0]![0] as { query: unknown; props: unknown };

    expect(call.query).toBe(deleteBy.query);
    expect(call.props).toBe(deleteBy.props);
    expect(spies.sync).not.toHaveBeenCalled();
    expect(spies.feed).not.toHaveBeenCalled();
    expect(
      (result.carryForward as { rulesToDelete: Array<Model> }).rulesToDelete,
    ).toHaveLength(1);
  });

  it("does not block the delete when the rules cannot be read", async () => {
    spies.ruleFindBy.mockRejectedValue(new Error("db down"));

    const result: OnDelete<Model> = (await callHook(
      "onBeforeDelete",
      makeDeleteBy(),
    )) as OnDelete<Model>;

    expect(result.carryForward).toEqual({ rulesToDelete: [] });
  });

  it("posts MonitorRuleRemoved per deleted rule as the person who deleted it, then re-syncs each SLO once", async () => {
    await callHook(
      "onDeleteSuccess",
      {
        deleteBy: makeDeleteBy(),
        carryForward: {
          rulesToDelete: [
            makeRule({ id: RULE_ID, name: "First" }),
            makeRule({ id: OTHER_RULE_ID, name: "Second" }),
          ],
        },
      },
      [RULE_ID, OTHER_RULE_ID],
    );

    const calls: Array<FeedCall> = feedCalls(spies.feed);

    expect(calls).toHaveLength(2);
    expect(
      calls.map((call: FeedCall) => {
        return call.serviceLevelObjectiveFeedEventType;
      }),
    ).toEqual([
      ServiceLevelObjectiveFeedEventType.MonitorRuleRemoved,
      ServiceLevelObjectiveFeedEventType.MonitorRuleRemoved,
    ]);
    expect(calls[0]!.userId).toBe(USER_ID);
    expect(calls[0]!.feedInfoInMarkdown).toContain(
      "Removed monitor rule **First**",
    );
    expect(spies.sync).toHaveBeenCalledTimes(1);
    expect(spies.sync).toHaveBeenCalledWith({
      serviceLevelObjectiveId: SLO_ID,
    });
  });

  it("ignores carried rules the permission-checked delete did not remove", async () => {
    await callHook(
      "onDeleteSuccess",
      {
        deleteBy: makeDeleteBy(),
        carryForward: {
          rulesToDelete: [
            makeRule({ id: RULE_ID }),
            makeRule({
              id: OTHER_RULE_ID,
              serviceLevelObjectiveId: OTHER_SLO_ID,
            }),
          ],
        },
      },
      [RULE_ID],
    );

    expect(spies.feed).toHaveBeenCalledTimes(1);
    expect(spies.sync).toHaveBeenCalledTimes(1);
    expect(spies.sync).toHaveBeenCalledWith({
      serviceLevelObjectiveId: SLO_ID,
    });
  });

  it("tolerates a delete that carried nothing forward", async () => {
    await expect(
      callHook(
        "onDeleteSuccess",
        { deleteBy: makeDeleteBy(), carryForward: null },
        [RULE_ID],
      ),
    ).resolves.toBeDefined();
    expect(spies.sync).not.toHaveBeenCalled();
  });

  it("never fails the delete when the sync fails", async () => {
    spies.sync.mockRejectedValue(new Error("db down"));

    await expect(
      callHook(
        "onDeleteSuccess",
        {
          deleteBy: makeDeleteBy(),
          carryForward: { rulesToDelete: [makeRule({})] },
        },
        [RULE_ID],
      ),
    ).resolves.toBeDefined();
  });
});

interface RawCriteriaOperator {
  getSql: (alias: string) => string;
  objectLiteralParameters: Record<string, unknown>;
}

describe("ServiceLevelObjectiveMonitorRuleService.findServiceLevelObjectiveIdsForRulesUsingLabels", () => {
  let spies: HookSpies;

  beforeEach(() => {
    spies = installSpies();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("looks up legacy label references and criteria references, as root", async () => {
    await ServiceLevelObjectiveMonitorRuleService.findServiceLevelObjectiveIdsForRulesUsingLabels(
      [LABEL_ID],
    );

    expect(spies.ruleFindBy).toHaveBeenCalledTimes(2);

    const legacy: {
      query: { monitorLabels: Array<ObjectID> };
      select: unknown;
      limit: number;
      props: unknown;
    } = spies.ruleFindBy.mock.calls[0]![0] as {
      query: { monitorLabels: Array<ObjectID> };
      select: unknown;
      limit: number;
      props: unknown;
    };

    expect(legacy.query.monitorLabels).toEqual([LABEL_ID]);
    expect(legacy.select).toEqual({ _id: true, serviceLevelObjectiveId: true });
    expect(legacy.limit).toBe(LIMIT_MAX);
    expect(legacy.props).toEqual({ isRoot: true });

    const criteriaLookup: {
      query: { criteria: RawCriteriaOperator };
      props: unknown;
    } = spies.ruleFindBy.mock.calls[1]![0] as {
      query: { criteria: RawCriteriaOperator };
      props: unknown;
    };

    const sql: string = criteriaLookup.query.criteria.getSql(
      '"ServiceLevelObjectiveMonitorRule"."criteria"',
    );
    const parameters: Array<unknown> = Object.values(
      criteriaLookup.query.criteria.objectLiteralParameters,
    );

    expect(parameters).toContain("filters");
    expect(parameters).toContain("field");
    expect(parameters).toContain("monitorLabels");
    expect(parameters).toContain("value");
    expect(parameters).toContainEqual([LABEL_ID.toString()]);
    // Values are bound, never spliced into the SQL.
    expect(sql).not.toContain(LABEL_ID.toString());
    expect(criteriaLookup.props).toEqual({ isRoot: true });
  });

  it("unions both lookups and de-duplicates the SLOs in first-seen order", async () => {
    spies.ruleFindBy
      .mockResolvedValueOnce([
        makeRule({ id: RULE_ID, serviceLevelObjectiveId: SLO_ID }),
        makeRule({ id: OTHER_RULE_ID, serviceLevelObjectiveId: OTHER_SLO_ID }),
      ])
      .mockResolvedValueOnce([
        makeRule({ id: OTHER_RULE_ID, serviceLevelObjectiveId: OTHER_SLO_ID }),
        makeRule({
          id: new ObjectID("45454545-4545-4545-8545-454545454545"),
          serviceLevelObjectiveId: THIRD_SLO_ID,
        }),
      ]);

    await expect(
      ServiceLevelObjectiveMonitorRuleService.findServiceLevelObjectiveIdsForRulesUsingLabels(
        [LABEL_ID],
      ),
    ).resolves.toEqual([SLO_ID, OTHER_SLO_ID, THIRD_SLO_ID]);
  });

  it("asks nothing for an empty label list", async () => {
    await expect(
      ServiceLevelObjectiveMonitorRuleService.findServiceLevelObjectiveIdsForRulesUsingLabels(
        [],
      ),
    ).resolves.toEqual([]);
    expect(spies.ruleFindBy).not.toHaveBeenCalled();
  });
});

describe("ServiceLevelObjectiveMonitorRuleService.findServiceLevelObjectiveIdsWithEnabledRules", () => {
  let spies: HookSpies;

  beforeEach(() => {
    spies = installSpies();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns the lower-cased ids of SLOs with an enabled rule, read as root", async () => {
    spies.ruleFindBy.mockResolvedValue([
      makeRule({
        serviceLevelObjectiveId: new ObjectID(SLO_ID.toString().toUpperCase()),
      }),
    ]);

    const result: Set<string> =
      await ServiceLevelObjectiveMonitorRuleService.findServiceLevelObjectiveIdsWithEnabledRules(
        [SLO_ID, OTHER_SLO_ID],
      );

    expect(Array.from(result)).toEqual([SLO_ID.toString().toLowerCase()]);

    const call: { query: Record<string, unknown>; props: unknown } = spies
      .ruleFindBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      props: unknown;
    };

    expect(call.query["isEnabled"]).toBe(true);
    expect(JSON.stringify(call.query["serviceLevelObjectiveId"])).toContain(
      OTHER_SLO_ID.toString(),
    );
    expect(call.props).toEqual({ isRoot: true });
  });

  it("asks nothing for an empty SLO list", async () => {
    await expect(
      ServiceLevelObjectiveMonitorRuleService.findServiceLevelObjectiveIdsWithEnabledRules(
        [],
      ),
    ).resolves.toEqual(new Set<string>());
    expect(spies.ruleFindBy).not.toHaveBeenCalled();
  });
});
