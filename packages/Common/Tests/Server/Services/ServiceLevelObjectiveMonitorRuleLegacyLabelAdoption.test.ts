import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveMonitorRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveMonitorRule";
import LabelService from "../../../Server/Services/LabelService";
import MonitorService from "../../../Server/Services/MonitorService";
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
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import SloLegacyMonitorLabelAdoption from "../../../Server/Utils/Slo/SloLegacyMonitorLabelAdoption";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test - creating an SLO's first monitor rule while the SLO
 * still runs on the deprecated "Auto-Add Monitors With Labels" list.
 *
 * During a rolling deploy a previous-release pod can write that list after the
 * one-shot backfill, and its engine attaches the matching monitors as
 * rule-attached. If a user then creates the SLO's first monitor rule on a new
 * pod, the rule's own sync runs with that rule alone - and detached every
 * monitor the list attached that the new rule does not match. So:
 *
 *   - onBeforeCreate adopts the list into a rule first, while the SLO has no
 *     rule row (the adoption's own condition), requiring rule-attached
 *     monitors as evidence, so a converted rule the user deleted is not
 *     brought back by their next rule;
 *   - only for a create every check accepted - the match criteria, the
 *     patterns, the SLO's project and the create permission check
 *     DatabaseService applies after the hook - because adoption is a write;
 *   - a failed adoption fails the create instead of letting the sync detach;
 *   - rule edits and deletes never adopt.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "23232323-2323-4323-8323-232323232323",
);
const SLO_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const RULE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const ADOPTED_RULE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const LABEL_PRODUCTION_ID: ObjectID = new ObjectID(
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
);
const MONITOR_A_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MONITOR_B_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MONITOR_C_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const SLO_LINK: string = "[SLO Checkout](https://oneuptime.test/slos/1)";

type Model = ServiceLevelObjectiveMonitorRule;

interface AdoptionCall {
  projectId: ObjectID;
  serviceLevelObjectiveIds: Array<ObjectID | string>;
  requireRuleAttachedMonitors?: boolean | undefined;
}

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

function makeCreateBy(
  data: Record<string, unknown>,
  props?: Record<string, unknown> | undefined,
): CreateBy<Model> {
  return {
    data: data as unknown as Model,
    props: props || { tenantId: PROJECT_ID, userId: USER_ID },
  } as unknown as CreateBy<Model>;
}

function makeRule(fields: {
  id: ObjectID;
  name: string;
  labelIds?: Array<ObjectID> | undefined;
  monitorNamePattern?: string | undefined;
}): Model {
  return {
    id: fields.id,
    _id: fields.id.toString(),
    projectId: PROJECT_ID,
    serviceLevelObjectiveId: SLO_ID,
    name: fields.name,
    isEnabled: true,
    monitorLabels: (fields.labelIds || []).map((labelId: ObjectID) => {
      return { id: labelId, _id: labelId.toString() } as unknown as Label;
    }),
    monitorNamePattern: fields.monitorNamePattern,
    monitorDescriptionPattern: undefined,
    criteria: undefined,
  } as unknown as Model;
}

// The payload of the rule the user creates: "every checkout-* monitor".
const CHECKOUT_RULE_PAYLOAD: Record<string, unknown> = {
  projectId: PROJECT_ID,
  serviceLevelObjectiveId: SLO_ID,
  name: "Checkout monitors",
  monitorNamePattern: "^checkout-",
};

interface HookSpies {
  adoption: jest.SpyInstance;
  permission: jest.SpyInstance;
  scope: jest.SpyInstance;
  sync: jest.SpyInstance;
  ruleFindBy: jest.SpyInstance;
}

function installSpies(): HookSpies {
  jest.spyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);

  jest
    .spyOn(ServiceLevelObjectiveMonitorRuleService, "findOneById")
    .mockResolvedValue(null);
  jest
    .spyOn(
      ServiceLevelObjectiveFeedService,
      "createServiceLevelObjectiveFeedItem",
    )
    .mockResolvedValue(undefined);
  jest
    .spyOn(ServiceLevelObjectiveService, "getSloMarkdownLink")
    .mockResolvedValue(SLO_LINK);
  jest.spyOn(LabelService, "findBy").mockResolvedValue([]);

  return {
    adoption: jest
      .spyOn(SloLegacyMonitorLabelAdoption, "adoptLegacyMonitorLabels")
      .mockResolvedValue([]),
    permission: jest
      .spyOn(ModelPermission, "checkCreatePermissions")
      .mockImplementation((() => {
        return undefined;
      }) as never),
    // The SLO-belongs-to-the-project check has its own tests.
    scope: jest
      .spyOn(
        ServiceLevelObjectiveMonitorRuleService as never,
        "assertServiceLevelObjectiveIsInScope" as never,
      )
      .mockResolvedValue(undefined as never),
    sync: jest
      .spyOn(
        ServiceLevelObjectiveMonitorRuleEngineService,
        "syncMonitorsForSlo",
      )
      .mockResolvedValue({ monitorIdsAdded: [], monitorIdsRemoved: [] }),
    ruleFindBy: jest
      .spyOn(ServiceLevelObjectiveMonitorRuleService, "findBy")
      .mockResolvedValue([]),
  };
}

describe("ServiceLevelObjectiveMonitorRuleService.onBeforeCreate - adopting the SLO's legacy label list first", () => {
  let spies: HookSpies;

  beforeEach(() => {
    spies = installSpies();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("adopts the SLO's list in the caller's project, with rule-attached monitors required as evidence, once the scope and permission checks passed", async () => {
    await callHook(
      "onBeforeCreate",
      makeCreateBy({ ...CHECKOUT_RULE_PAYLOAD, projectId: OTHER_PROJECT_ID }),
    );

    expect(spies.adoption).toHaveBeenCalledTimes(1);
    expect(spies.adoption.mock.calls[0]![0]).toEqual({
      // The caller's tenant wins over whatever project the payload claims.
      projectId: PROJECT_ID,
      serviceLevelObjectiveIds: [SLO_ID],
      requireRuleAttachedMonitors: true,
    });

    expect(spies.scope.mock.invocationCallOrder[0]!).toBeLessThan(
      spies.adoption.mock.invocationCallOrder[0]!,
    );
    expect(spies.permission.mock.invocationCallOrder[0]!).toBeLessThan(
      spies.adoption.mock.invocationCallOrder[0]!,
    );
  });

  it("asks exactly the create permission check DatabaseService applies next, for this model, payload and caller", async () => {
    const createBy: CreateBy<Model> = makeCreateBy(CHECKOUT_RULE_PAYLOAD);

    await callHook("onBeforeCreate", createBy);

    expect(spies.permission).toHaveBeenCalledTimes(1);
    expect(spies.permission.mock.calls[0]![0]).toBe(
      ServiceLevelObjectiveMonitorRule,
    );
    expect(spies.permission.mock.calls[0]![1]).toBe(createBy.data);
    expect(spies.permission.mock.calls[0]![2]).toBe(createBy.props);
  });

  it("changes nothing for a caller the create is about to refuse, and leaves the refusal to DatabaseService", async () => {
    spies.permission.mockImplementation((() => {
      throw new NotAuthorizedException(
        "You do not have permission to create SLO Monitor Rule.",
      );
    }) as never);

    await expect(
      callHook("onBeforeCreate", makeCreateBy(CHECKOUT_RULE_PAYLOAD)),
    ).resolves.toBeDefined();

    expect(spies.adoption).not.toHaveBeenCalled();
  });

  it("through the real permission check: a member holding no permission changes nothing, a root create (a workflow) adopts in the payload's project", async () => {
    spies.permission.mockRestore();

    await callHook(
      "onBeforeCreate",
      makeCreateBy(CHECKOUT_RULE_PAYLOAD, {
        tenantId: PROJECT_ID,
        userId: USER_ID,
      }),
    );

    expect(spies.adoption).not.toHaveBeenCalled();

    await callHook(
      "onBeforeCreate",
      makeCreateBy(
        { ...CHECKOUT_RULE_PAYLOAD, projectId: OTHER_PROJECT_ID },
        { isRoot: true },
      ),
    );

    expect(spies.adoption).toHaveBeenCalledTimes(1);
    expect((spies.adoption.mock.calls[0]![0] as AdoptionCall).projectId).toBe(
      OTHER_PROJECT_ID,
    );
  });

  it("reads the SLO id off a relation-shaped payload", async () => {
    await callHook(
      "onBeforeCreate",
      makeCreateBy({
        projectId: PROJECT_ID,
        serviceLevelObjective: { _id: SLO_ID.toString() },
        monitorNamePattern: "^checkout-",
      }),
    );

    expect(
      (spies.adoption.mock.calls[0]![0] as AdoptionCall)
        .serviceLevelObjectiveIds,
    ).toEqual([SLO_ID.toString()]);
  });

  it("adopts nothing for a create its validation refuses", async () => {
    await expect(
      callHook(
        "onBeforeCreate",
        makeCreateBy({
          projectId: PROJECT_ID,
          serviceLevelObjectiveId: SLO_ID,
        }),
      ),
    ).rejects.toThrow(BadDataException);

    await expect(
      callHook(
        "onBeforeCreate",
        makeCreateBy({
          ...CHECKOUT_RULE_PAYLOAD,
          monitorNamePattern: "api-(01",
        }),
      ),
    ).rejects.toThrow(BadDataException);

    spies.scope.mockRejectedValue(
      new BadDataException(
        "This SLO monitor rule references a Service Level Objective that does not exist.",
      ) as never,
    );

    await expect(
      callHook("onBeforeCreate", makeCreateBy(CHECKOUT_RULE_PAYLOAD)),
    ).rejects.toThrow("does not exist");

    expect(spies.adoption).not.toHaveBeenCalled();
  });

  it("adopts nothing without a project to pin the adoption to", async () => {
    await callHook(
      "onBeforeCreate",
      makeCreateBy(
        {
          serviceLevelObjectiveId: SLO_ID,
          monitorNamePattern: "^checkout-",
        },
        { isRoot: true },
      ),
    );

    expect(spies.adoption).not.toHaveBeenCalled();
  });

  it("fails the create when the adoption fails, rather than letting the new rule's sync detach what the list attached", async () => {
    spies.adoption.mockRejectedValue(new Error("connection terminated"));

    await expect(
      callHook("onBeforeCreate", makeCreateBy(CHECKOUT_RULE_PAYLOAD)),
    ).rejects.toThrow("connection terminated");
  });
});

describe("ServiceLevelObjectiveMonitorRuleService - rule edits and deletes never adopt", () => {
  let spies: HookSpies;

  beforeEach(() => {
    spies = installSpies();
    spies.ruleFindBy.mockResolvedValue([
      makeRule({
        id: RULE_ID,
        name: "Checkout monitors",
        monitorNamePattern: "^checkout-",
      }),
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("an edit syncs without adopting: the edited rule is itself a rule row", async () => {
    const onUpdate: OnUpdate<Model> = (await callHook("onBeforeUpdate", {
      query: { _id: RULE_ID.toString() },
      data: { isEnabled: false },
      props: { tenantId: PROJECT_ID, userId: USER_ID },
      limit: 1,
      skip: 0,
    } as unknown as UpdateBy<Model>)) as OnUpdate<Model>;

    await callHook("onUpdateSuccess", onUpdate, [RULE_ID]);

    expect(spies.sync).toHaveBeenCalledWith({
      serviceLevelObjectiveId: SLO_ID,
    });
    expect(spies.adoption).not.toHaveBeenCalled();
  });

  it("a delete syncs without adopting: 'no rule, monitors still attached' right after it is what a deliberate delete looks like", async () => {
    const onDelete: OnDelete<Model> = (await callHook("onBeforeDelete", {
      query: { _id: RULE_ID.toString() },
      props: { tenantId: PROJECT_ID, userId: USER_ID },
      limit: 1,
      skip: 0,
    } as unknown as DeleteBy<Model>)) as OnDelete<Model>;

    await callHook("onDeleteSuccess", onDelete, [RULE_ID]);

    expect(spies.sync).toHaveBeenCalledWith({
      serviceLevelObjectiveId: SLO_ID,
    });
    expect(spies.adoption).not.toHaveBeenCalled();
  });
});

/*
 * The reviewer's scenario end to end: onBeforeCreate, the row DatabaseService
 * writes, then onCreateSuccess - with the REAL rule engine doing the sync.
 * Only the database is faked, as one small in-memory SLO, and the adoption
 * follows its SQL's conditions (label rows, no rule row at all, and
 * rule-attached monitors unless waived); the SQL itself is tested against
 * those conditions in SloLegacyMonitorLabelAdoption.test.ts.
 */
describe("creating the first monitor rule of an SLO still on the deprecated label list", () => {
  interface World {
    sloLabelIds: Array<ObjectID>;
    rules: Array<Model>;
    attachedMonitorIds: Array<string>;
    ruleAttachedMonitorIds: Array<string>;
  }

  let world: World;

  // A and B carry the Production label; C matches only the new rule.
  const projectMonitors: Array<Monitor> = [
    { id: MONITOR_A_ID, name: "api-a", labels: [LABEL_PRODUCTION_ID] },
    { id: MONITOR_B_ID, name: "api-b", labels: [LABEL_PRODUCTION_ID] },
    { id: MONITOR_C_ID, name: "checkout-api", labels: [] },
  ].map(
    (monitor: {
      id: string;
      name: string;
      labels: Array<ObjectID>;
    }): Monitor => {
      return {
        id: new ObjectID(monitor.id),
        _id: monitor.id,
        projectId: PROJECT_ID,
        name: monitor.name,
        labels: monitor.labels.map((labelId: ObjectID) => {
          return { id: labelId, _id: labelId.toString() } as unknown as Label;
        }),
      } as unknown as Monitor;
    },
  );

  function toMonitorStubs(ids: Array<string>): Array<Monitor> {
    return ids.map((id: string): Monitor => {
      return { id: new ObjectID(id), _id: id } as unknown as Monitor;
    });
  }

  function toSortedIds(monitors: unknown): Array<string> {
    return ((monitors as Array<Monitor>) || [])
      .map((monitor: Monitor): string => {
        return monitor.id!.toString();
      })
      .sort();
  }

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);
    jest.spyOn(logger, "debug").mockImplementation((() => {
      return undefined;
    }) as never);

    jest
      .spyOn(ModelPermission, "checkCreatePermissions")
      .mockImplementation((() => {
        return undefined;
      }) as never);
    jest
      .spyOn(
        ServiceLevelObjectiveMonitorRuleService as never,
        "assertServiceLevelObjectiveIsInScope" as never,
      )
      .mockResolvedValue(undefined as never);

    jest
      .spyOn(SloLegacyMonitorLabelAdoption, "adoptLegacyMonitorLabels")
      .mockImplementation((async (
        data: AdoptionCall,
      ): Promise<Array<string>> => {
        const isForThisSlo: boolean = data.serviceLevelObjectiveIds.some(
          (id: ObjectID | string): boolean => {
            return (
              id.toString().toLowerCase() === SLO_ID.toString().toLowerCase()
            );
          },
        );

        if (
          !isForThisSlo ||
          world.sloLabelIds.length === 0 ||
          world.rules.length > 0 ||
          (data.requireRuleAttachedMonitors !== false &&
            world.ruleAttachedMonitorIds.length === 0)
        ) {
          return [];
        }

        world.rules.push(
          makeRule({
            id: ADOPTED_RULE_ID,
            name: "Auto-add monitors with labels",
            labelIds: world.sloLabelIds,
          }),
        );

        return [SLO_ID.toString()];
      }) as never);

    jest
      .spyOn(ServiceLevelObjectiveMonitorRuleService, "findOneById")
      .mockImplementation((async (args: {
        id: ObjectID;
      }): Promise<Model | null> => {
        return (
          world.rules.find((rule: Model): boolean => {
            return rule.id!.toString() === args.id.toString();
          }) || null
        );
      }) as never);
    jest
      .spyOn(ServiceLevelObjectiveMonitorRuleService, "findBy")
      .mockImplementation((async (): Promise<Array<Model>> => {
        return world.rules.filter((rule: Model): boolean => {
          return rule.isEnabled !== false;
        });
      }) as never);

    jest
      .spyOn(ServiceLevelObjectiveService, "findOneById")
      .mockImplementation((async (): Promise<ServiceLevelObjective> => {
        return {
          id: SLO_ID,
          _id: SLO_ID.toString(),
          projectId: PROJECT_ID,
          name: "Checkout",
          monitors: toMonitorStubs(world.attachedMonitorIds),
          autoAddedMonitors: toMonitorStubs(world.ruleAttachedMonitorIds),
        } as unknown as ServiceLevelObjective;
      }) as never);
    jest
      .spyOn(ServiceLevelObjectiveService, "updateOneById")
      .mockImplementation((async (args: {
        data: Record<string, unknown>;
      }): Promise<number> => {
        world.attachedMonitorIds = toSortedIds(args.data["monitors"]);
        world.ruleAttachedMonitorIds = toSortedIds(
          args.data["autoAddedMonitors"],
        );
        return 1;
      }) as never);
    jest.spyOn(MonitorService, "findBy").mockResolvedValue(projectMonitors);

    jest
      .spyOn(
        ServiceLevelObjectiveFeedService,
        "createServiceLevelObjectiveFeedItem",
      )
      .mockResolvedValue(undefined);
    jest
      .spyOn(ServiceLevelObjectiveService, "getSloMarkdownLink")
      .mockResolvedValue(SLO_LINK);
    jest.spyOn(LabelService, "findBy").mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function createCheckoutRule(): Promise<void> {
    const createBy: CreateBy<Model> = makeCreateBy(CHECKOUT_RULE_PAYLOAD);

    const onCreate: OnCreate<Model> = (await callHook(
      "onBeforeCreate",
      createBy,
    )) as OnCreate<Model>;

    // DatabaseService.create writes the row between the two hooks.
    const createdRule: Model = makeRule({
      id: RULE_ID,
      name: "Checkout monitors",
      monitorNamePattern: "^checkout-",
    });
    world.rules.push(createdRule);

    await callHook("onCreateSuccess", onCreate, createdRule);
  }

  it("keeps every monitor the label list attached, and adds the new rule's matches next to them", async () => {
    // Written by a previous-release pod after the backfill ran.
    world = {
      sloLabelIds: [LABEL_PRODUCTION_ID],
      rules: [],
      attachedMonitorIds: [MONITOR_A_ID, MONITOR_B_ID],
      ruleAttachedMonitorIds: [MONITOR_A_ID, MONITOR_B_ID],
    };

    await createCheckoutRule();

    expect(world.attachedMonitorIds).toEqual([
      MONITOR_A_ID,
      MONITOR_B_ID,
      MONITOR_C_ID,
    ]);
    expect(world.ruleAttachedMonitorIds).toEqual([
      MONITOR_A_ID,
      MONITOR_B_ID,
      MONITOR_C_ID,
    ]);
    expect(
      world.rules
        .map((rule: Model): string => {
          return rule.name!;
        })
        .sort(),
    ).toEqual(["Auto-add monitors with labels", "Checkout monitors"]);
  });

  it("does not bring back a converted rule the user deleted: its label rows remain, but nothing is attached by them any more", async () => {
    // The delete's sync released the list's monitors; the label rows stay.
    world = {
      sloLabelIds: [LABEL_PRODUCTION_ID],
      rules: [],
      attachedMonitorIds: [],
      ruleAttachedMonitorIds: [],
    };

    await createCheckoutRule();

    expect(world.attachedMonitorIds).toEqual([MONITOR_C_ID]);
    expect(
      world.rules.map((rule: Model): string => {
        return rule.name!;
      }),
    ).toEqual(["Checkout monitors"]);
  });
});
