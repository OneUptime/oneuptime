import DatabaseService from "../../../Server/Services/DatabaseService";
import AuditLogService from "../../../Server/Services/AuditLogService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import Label from "../../../Models/DatabaseModels/Label";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import ServiceLevelObjectiveOwnerUser from "../../../Models/DatabaseModels/ServiceLevelObjectiveOwnerUser";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * DatabaseService._updateBy decides whether an update changed anything with
 * hasSameValues, and that single answer gates THREE side effects: the model's
 * on-update workflow, its realtime event, and its audit entry.
 *
 * The regression pinned here: hasSameValues compared every non-JSON column
 * through toString(), and a relation value is a model instance - which, like
 * any plain object, stringifies to "[object Object]". Swapping a resource's
 * labels A,B for C,D therefore read as "no change", and none of the three
 * fired. Relations now compare by the set of ids they reference; everything
 * else compares exactly as before.
 *
 * Also pinned: the `before` row an audited update loads carries what the audit
 * entry needs - related names, the parent id a child's entries roll up to,
 * and the id that names a nameless row.
 *
 * No Postgres: the repository and the before-row read are stubbed, and the
 * real update path runs in between. AuditLogService is replaced by a module
 * stub - DatabaseService reaches it through a lazy require, and only whether
 * (and with what) it is called matters here; its own behaviour has its own
 * suite. The stub also keeps the service graph behind it out of this suite.
 */

jest.mock("../../../Server/Services/AuditLogService", () => {
  return {
    __esModule: true,
    default: {
      recordCreate: (): Promise<void> => {
        return Promise.resolve();
      },
      recordUpdate: (): Promise<void> => {
        return Promise.resolve();
      },
      recordDelete: (): Promise<void> => {
        return Promise.resolve();
      },
    },
  };
});

type StubbedRepository = {
  save: jest.Mock;
  update: jest.Mock;
  find: jest.Mock;
};

interface UpdateHarness {
  repository: StubbedRepository;
  workflow: jest.SpyInstance;
  realtime: jest.SpyInstance;
  recordUpdate: jest.SpyInstance;
  findBefore: jest.SpyInstance;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "7c1a3c1e-2c55-4c3e-9d8e-7f3b0a4d5e61",
);
const SLO_ID: ObjectID = new ObjectID("0193c0de-2222-4aaa-8bbb-000000000001");
const RULE_ID: ObjectID = new ObjectID("0193c0de-2222-4aaa-8bbb-000000000002");
const OWNER_ID: ObjectID = new ObjectID("0193c0de-2222-4aaa-8bbb-000000000003");
const EPISODE_ID: ObjectID = new ObjectID(
  "0193c0de-2222-4aaa-8bbb-000000000004",
);

const LABEL_A: string = "0193c0de-1111-4aaa-8bbb-00000000000a";
const LABEL_B: string = "0193c0de-1111-4aaa-8bbb-00000000000b";
const LABEL_C: string = "0193c0de-1111-4aaa-8bbb-00000000000c";
const LABEL_D: string = "0193c0de-1111-4aaa-8bbb-00000000000d";

const SEVERITY_1: string = "0193c0de-3333-4aaa-8bbb-000000000001";
const SEVERITY_2: string = "0193c0de-3333-4aaa-8bbb-000000000002";

function setUpUpdate<TModel extends BaseModel>(
  service: DatabaseService<TModel>,
  before: TModel,
): UpdateHarness {
  const repository: StubbedRepository = {
    save: jest.fn((item: unknown) => {
      return Promise.resolve(item);
    }),
    update: jest.fn(() => {
      return Promise.resolve({ affected: 1 });
    }),
    find: jest.fn(() => {
      return Promise.resolve([]);
    }),
  };

  jest.spyOn(service, "getRepository").mockReturnValue(repository as never);

  const workflow: jest.SpyInstance = jest
    .spyOn(service, "onTriggerWorkflow")
    .mockResolvedValue(undefined as never);
  const realtime: jest.SpyInstance = jest
    .spyOn(service, "onTriggerRealtime")
    .mockResolvedValue(undefined as never);
  const recordUpdate: jest.SpyInstance = jest
    .spyOn(AuditLogService, "recordUpdate")
    .mockResolvedValue(undefined as never);

  jest
    .spyOn(ModelPermission, "checkUpdatePermissionByModel")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ModelPermission, "checkUpdateQueryPermissions")
    .mockImplementation(((_modelType: unknown, query: unknown) => {
      return Promise.resolve(query);
    }) as never);

  const findBefore: jest.SpyInstance = jest
    .spyOn(
      service as unknown as { _findBy: () => Promise<Array<BaseModel>> },
      "_findBy",
    )
    .mockResolvedValue([before] as never);

  return { repository, workflow, realtime, recordUpdate, findBefore };
}

function label(id: string, name?: string): Label {
  const item: Label = new Label();
  item._id = id;
  if (name) {
    item.name = name;
  }
  return item;
}

function sloBefore(labels: Array<Label> | undefined): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo._id = SLO_ID.toString();
  slo.projectId = PROJECT_ID;
  slo.name = "Checkout availability";
  if (labels !== undefined) {
    slo.labels = labels;
  }
  return slo;
}

async function updateSlo(
  before: ServiceLevelObjective,
  data: JSONObject,
): Promise<UpdateHarness> {
  const service: DatabaseService<ServiceLevelObjective> =
    new DatabaseService<ServiceLevelObjective>(ServiceLevelObjective);
  const harness: UpdateHarness = setUpUpdate(service, before);

  await service.updateOneById({
    id: SLO_ID,
    data: data as never,
    props: { isRoot: true },
  });

  return harness;
}

function expectChangeReported(harness: UpdateHarness): void {
  expect(harness.workflow).toHaveBeenCalledTimes(1);
  expect(harness.workflow.mock.calls[0]![1]).toEqual(PROJECT_ID);
  expect(harness.workflow.mock.calls[0]![2]).toBe("on-update");
  expect(harness.realtime).toHaveBeenCalledTimes(1);
  expect(harness.recordUpdate).toHaveBeenCalledTimes(1);
}

function expectNoChangeReported(harness: UpdateHarness): void {
  expect(harness.workflow).not.toHaveBeenCalled();
  expect(harness.realtime).not.toHaveBeenCalled();
  expect(harness.recordUpdate).not.toHaveBeenCalled();
}

function selectOfBeforeRead(harness: UpdateHarness): JSONObject {
  expect(harness.findBefore).toHaveBeenCalledTimes(1);
  return (harness.findBefore.mock.calls[0]![0] as { select: JSONObject })
    .select;
}

beforeEach(() => {
  jest.restoreAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a many-to-many change fires the workflow, realtime event and audit entry", () => {
  test("swapping two labels for two others (same count) is a change", async () => {
    const harness: UpdateHarness = await updateSlo(
      sloBefore([label(LABEL_A, "Production"), label(LABEL_B, "Payments")]),
      { labels: [LABEL_C, LABEL_D] } as unknown as JSONObject,
    );

    expectChangeReported(harness);

    // The write still went through save(), the only path for junction rows.
    expect(harness.repository.save).toHaveBeenCalledTimes(1);
  });

  test("replacing one label while keeping the count is a change", async () => {
    const harness: UpdateHarness = await updateSlo(
      sloBefore([label(LABEL_A), label(LABEL_B)]),
      { labels: [{ _id: LABEL_A }, { _id: LABEL_C }] } as unknown as JSONObject,
    );

    expectChangeReported(harness);
  });

  test("the audit entry receives the before-row and the new relation", async () => {
    const before: ServiceLevelObjective = sloBefore([
      label(LABEL_A, "Production"),
    ]);
    const harness: UpdateHarness = await updateSlo(before, {
      labels: [LABEL_B],
    } as unknown as JSONObject);

    const recorded: {
      before: ServiceLevelObjective;
      updatedFields: JSONObject;
      itemId: ObjectID;
    } = harness.recordUpdate.mock.calls[0]![0] as {
      before: ServiceLevelObjective;
      updatedFields: JSONObject;
      itemId: ObjectID;
    };

    expect(recorded.before).toBe(before);
    expect(recorded.itemId.toString()).toBe(SLO_ID.toString());
    expect(
      (recorded.updatedFields["labels"] as unknown as Array<Label>).map(
        (item: Label) => {
          return item._id;
        },
      ),
    ).toEqual([LABEL_B]);
  });

  test("adding a label is a change", async () => {
    expectChangeReported(
      await updateSlo(sloBefore([label(LABEL_A)]), {
        labels: [LABEL_A, LABEL_B],
      } as unknown as JSONObject),
    );
  });

  test("removing every label is a change", async () => {
    expectChangeReported(
      await updateSlo(sloBefore([label(LABEL_A)]), {
        labels: [],
      } as unknown as JSONObject),
    );
  });

  test("the same labels in another order and another shape are not a change", async () => {
    expectNoChangeReported(
      await updateSlo(
        sloBefore([label(LABEL_A, "Production"), label(LABEL_B, "Payments")]),
        {
          labels: [{ _id: LABEL_B }, LABEL_A.toUpperCase()],
        } as unknown as JSONObject,
      ),
    );
  });

  test("an identical label set is not a change", async () => {
    expectNoChangeReported(
      await updateSlo(sloBefore([label(LABEL_A), label(LABEL_B)]), {
        labels: [LABEL_A, LABEL_B],
      } as unknown as JSONObject),
    );
  });

  test("an empty relation saved as empty is not a change", async () => {
    expectNoChangeReported(
      await updateSlo(sloBefore([]), { labels: [] } as unknown as JSONObject),
    );
  });

  test("a relation the before-row did not load still reads as changed, as it always did", async () => {
    expectChangeReported(
      await updateSlo(sloBefore(undefined), {
        labels: [LABEL_A],
      } as unknown as JSONObject),
    );
  });

  test("a model without audit logging sees the swap too, so its workflow fires", async () => {
    const episode: AlertEpisode = new AlertEpisode();
    episode._id = EPISODE_ID.toString();
    episode.projectId = PROJECT_ID;
    episode.labels = [label(LABEL_A), label(LABEL_B)];

    expect(episode.enableAuditLogOn).toBeFalsy();
    expect(episode.enableWorkflowOn?.update).toBe(true);

    const service: DatabaseService<AlertEpisode> =
      new DatabaseService<AlertEpisode>(AlertEpisode);
    const harness: UpdateHarness = setUpUpdate(service, episode);

    await service.updateOneById({
      id: EPISODE_ID,
      data: { labels: [LABEL_C, LABEL_D] } as never,
      props: { isRoot: true },
    });

    expect(harness.workflow).toHaveBeenCalledTimes(1);
    expect(harness.realtime).toHaveBeenCalledTimes(1);
    expect(harness.recordUpdate).not.toHaveBeenCalled();

    // No audit logging, so the before-read keeps its id-only relation select.
    expect(selectOfBeforeRead(harness)["labels"]).toBe(true);
    expect(selectOfBeforeRead(harness)["name"]).toBeUndefined();
  });
});

describe("a many-to-one change compares by the referenced id", () => {
  function ruleBefore(): ServiceLevelObjectiveBurnRateRule {
    const rule: ServiceLevelObjectiveBurnRateRule =
      new ServiceLevelObjectiveBurnRateRule();
    rule._id = RULE_ID.toString();
    rule.projectId = PROJECT_ID;
    rule.serviceLevelObjectiveId = SLO_ID;
    rule.name = "Fast burn";

    const severity: AlertSeverity = new AlertSeverity();
    severity._id = SEVERITY_1;
    rule.alertSeverity = severity;
    rule.alertSeverityId = new ObjectID(SEVERITY_1);

    return rule;
  }

  async function updateRule(data: JSONObject): Promise<UpdateHarness> {
    const service: DatabaseService<ServiceLevelObjectiveBurnRateRule> =
      new DatabaseService<ServiceLevelObjectiveBurnRateRule>(
        ServiceLevelObjectiveBurnRateRule,
      );
    const harness: UpdateHarness = setUpUpdate(service, ruleBefore());

    await service.updateOneById({
      id: RULE_ID,
      data: data as never,
      props: { isRoot: true },
    });

    return harness;
  }

  test("pointing the relation at another row is a change", async () => {
    expectChangeReported(
      await updateRule({ alertSeverity: SEVERITY_2 } as JSONObject),
    );
  });

  test("pointing it at the same row is not", async () => {
    expectNoChangeReported(
      await updateRule({ alertSeverity: SEVERITY_1 } as JSONObject),
    );
  });

  test("the before-read of an audited child asks for its parent id and related names", async () => {
    const harness: UpdateHarness = await updateRule({
      alertOwnerUsers: [OWNER_ID.toString()],
    } as unknown as JSONObject);

    const select: JSONObject = selectOfBeforeRead(harness);

    expect(select["serviceLevelObjectiveId"]).toBe(true);
    expect(select["name"]).toBe(true);
    expect(select["alertOwnerUsers"]).toEqual({ _id: true, name: true });
  });
});

describe("non-relation columns behave exactly as before", () => {
  test("a changed scalar is a change", async () => {
    const before: ServiceLevelObjective = sloBefore(undefined);
    before.targetPercentage = 99;

    expectChangeReported(
      await updateSlo(before, { targetPercentage: 99.5 } as JSONObject),
    );
  });

  test("an unchanged scalar is not", async () => {
    const before: ServiceLevelObjective = sloBefore(undefined);
    before.targetPercentage = 99.9;

    expectNoChangeReported(
      await updateSlo(before, { targetPercentage: 99.9 } as JSONObject),
    );
  });

  test("an ObjectID and its string form are the same value", async () => {
    const rule: ServiceLevelObjectiveBurnRateRule =
      new ServiceLevelObjectiveBurnRateRule();
    rule._id = RULE_ID.toString();
    rule.projectId = PROJECT_ID;
    rule.alertSeverityId = new ObjectID(SEVERITY_1);

    const service: DatabaseService<ServiceLevelObjectiveBurnRateRule> =
      new DatabaseService<ServiceLevelObjectiveBurnRateRule>(
        ServiceLevelObjectiveBurnRateRule,
      );
    const harness: UpdateHarness = setUpUpdate(service, rule);

    await service.updateOneById({
      id: RULE_ID,
      data: { alertSeverityId: SEVERITY_1 } as never,
      props: { isRoot: true },
    });

    expectNoChangeReported(harness);
  });

  test("a JSON column still compares by content, ignoring key order", async () => {
    const before: ServiceLevelObjective = sloBefore(undefined);
    before.metricQueryConfig = { goodQuery: "a", totalQuery: "b" };

    expectNoChangeReported(
      await updateSlo(before, {
        metricQueryConfig: { totalQuery: "b", goodQuery: "a" },
      } as JSONObject),
    );
  });
});

describe("the before-row carries what the audit entry needs", () => {
  test("a relation the update touches is read with its names", async () => {
    const harness: UpdateHarness = await updateSlo(
      sloBefore([label(LABEL_A)]),
      { labels: [LABEL_B] } as unknown as JSONObject,
    );

    const select: JSONObject = selectOfBeforeRead(harness);

    expect(select["labels"]).toEqual({ _id: true, name: true });
    expect(select["name"]).toBe(true);
    expect(select["projectId"]).toBe(true);
  });

  test("a top-level resource asks for no parent column", async () => {
    const before: ServiceLevelObjective = sloBefore(undefined);
    before.targetPercentage = 99;

    const select: JSONObject = selectOfBeforeRead(
      await updateSlo(before, { targetPercentage: 99.5 } as JSONObject),
    );

    expect(select["serviceLevelObjectiveId"]).toBeUndefined();
    expect(select["targetPercentage"]).toBe(true);
  });

  test("a nameless owner row loads its parent id and the id that names it", async () => {
    const owner: ServiceLevelObjectiveOwnerUser =
      new ServiceLevelObjectiveOwnerUser();
    owner._id = OWNER_ID.toString();
    owner.projectId = PROJECT_ID;
    owner.isOwnerNotified = false;

    const service: DatabaseService<ServiceLevelObjectiveOwnerUser> =
      new DatabaseService<ServiceLevelObjectiveOwnerUser>(
        ServiceLevelObjectiveOwnerUser,
      );
    const harness: UpdateHarness = setUpUpdate(service, owner);

    await service.updateOneById({
      id: OWNER_ID,
      data: { isOwnerNotified: true } as never,
      props: { isRoot: true },
    });

    const select: JSONObject = selectOfBeforeRead(harness);

    expect(select["serviceLevelObjectiveId"]).toBe(true);
    expect(select["userId"]).toBe(true);
    expect(select["isOwnerNotified"]).toBe(true);
    // The owner row has no name column to ask for.
    expect(select["name"]).toBeUndefined();
  });
});
