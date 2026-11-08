import AuditLogService from "../../../../Server/Services/AuditLogService";
import MonitorService from "../../../../Server/Services/MonitorService";
import RuleAddedLabels, {
  RULE_LABEL_AUDIT_ENTRIES_AT_ONCE,
} from "../../../../Server/Utils/Rules/RuleAddedLabels";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import UserType from "../../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * LABELS A LABEL RULE ADDS, AND THEIR AUDIT LOG ENTRY (issue #6284).
 *
 * The engines added a rule's labels with one relation statement, which no
 * DatabaseService hook sees, so they never reached the audit log. Every
 * engine now adds them through RuleAddedLabels: what it writes, and the one
 * Update entry each record it changes gets - by whoever ran the rule, or as
 * OneUptime's own for a rule applied on create.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROD: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EU: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DB: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const PERSON: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("33333333-3333-4333-8333-333333333333"),
  userType: UserType.User,
};

interface Written {
  target: unknown;
  relation: string;
  of: unknown;
  added: unknown;
}

interface RecordedUpdate {
  model: Monitor;
  before: Monitor;
  updatedFields: JSONObject;
  itemId: ObjectID;
  props: DatabaseCommonInteractionProps;
}

let writes: Array<Written>;
let order: Array<string>;
let recordUpdate: jest.SpyInstance;
let findOneById: jest.SpyInstance;

function label(id: string, name: string): Label {
  const item: Label = new Label(new ObjectID(id));
  item.name = name;
  return item;
}

function monitorWith(labels: Array<Label>): Monitor {
  const monitor: Monitor = new Monitor(MONITOR_ID);
  monitor.projectId = PROJECT_ID;
  monitor.name = "API";
  monitor.labels = labels;
  return monitor;
}

beforeEach(() => {
  writes = [];
  order = [];

  let pending: Partial<Written> = {};
  const builder: Record<string, unknown> = {
    createQueryBuilder: (): unknown => {
      return builder;
    },
    relation: (target: unknown, relation: string): unknown => {
      pending = { target, relation };
      return builder;
    },
    of: (of: unknown): unknown => {
      pending.of = of;
      return builder;
    },
    add: async (added: unknown): Promise<void> => {
      order.push("written");
      writes.push({ ...(pending as Written), added });
    },
  };

  jest
    .spyOn(MonitorService, "getRepository")
    .mockReturnValue(builder as never);
  findOneById = jest
    .spyOn(MonitorService, "findOneById")
    .mockResolvedValue(monitorWith([label(PROD, "production")]));
  recordUpdate = jest
    .spyOn(AuditLogService, "recordUpdate")
    .mockImplementation(async (): Promise<void> => {
      order.push("recorded");
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function onlyRecorded(): RecordedUpdate {
  expect(recordUpdate).toHaveBeenCalledTimes(1);
  return recordUpdate.mock.calls[0]![0] as unknown as RecordedUpdate;
}

function labelIds(value: unknown): Array<string> {
  return (value as Array<Label>).map((item: Label): string => {
    return item._id!.toString();
  });
}

describe("adding a rule's labels to one record", () => {
  test("adds the labels it lacks, then records them, by whoever ran the rule", async () => {
    const added: Array<string> = await RuleAddedLabels.add({
      service: MonitorService,
      resourceId: MONITOR_ID,
      labelIds: [EU, DB],
      props: PERSON,
    });

    expect(added).toEqual([EU, DB]);
    expect(order).toEqual(["written", "recorded"]);
    expect(writes).toEqual([
      {
        target: Monitor,
        relation: "labels",
        of: MONITOR_ID.toString(),
        added: [EU, DB],
      },
    ]);

    const recorded: RecordedUpdate = onlyRecorded();

    expect(recorded.model).toBeInstanceOf(Monitor);
    expect(recorded.itemId.toString()).toBe(MONITOR_ID.toString());
    expect(recorded.props).toEqual(PERSON);
    expect(labelIds(recorded.before.labels)).toEqual([PROD]);
    expect(labelIds(recorded.updatedFields["labels"])).toEqual([PROD, EU, DB]);
    // The labels it had keep their names, so the entry names them as read.
    expect(
      (recorded.updatedFields["labels"] as unknown as Array<Label>)[0]!.name,
    ).toBe("production");
  });

  test("reads the record for its entry: its project, its name and its labels with theirs", async () => {
    await RuleAddedLabels.add({
      service: MonitorService,
      resourceId: MONITOR_ID,
      labelIds: [EU],
    });

    expect(
      (findOneById.mock.calls[0]![0] as { select: unknown; props: unknown })
        .select,
    ).toEqual({
      _id: true,
      projectId: true,
      name: true,
      labels: { _id: true, name: true },
    });
    expect(
      (findOneById.mock.calls[0]![0] as { props: unknown }).props,
    ).toEqual({ isRoot: true });
  });

  test("a rule applied as the record is created is OneUptime's own: a system event", async () => {
    await RuleAddedLabels.add({
      service: MonitorService,
      resourceId: MONITOR_ID,
      labelIds: [EU],
    });

    expect(onlyRecorded().props).toEqual({ isRoot: true });
  });

  test("a record that has every label already is not written, and adds no entry", async () => {
    const added: Array<string> = await RuleAddedLabels.add({
      service: MonitorService,
      resourceId: MONITOR_ID,
      labelIds: [PROD, PROD.toUpperCase()],
      props: PERSON,
    });

    expect(added).toEqual([]);
    expect(writes).toEqual([]);
    expect(recordUpdate).not.toHaveBeenCalled();
  });

  test("a label named twice is added once", async () => {
    await RuleAddedLabels.add({
      service: MonitorService,
      resourceId: MONITOR_ID,
      labelIds: [EU, EU, PROD],
      props: PERSON,
    });

    expect(writes[0]!.added).toEqual([EU]);
    expect(labelIds(onlyRecorded().updatedFields["labels"])).toEqual([
      PROD,
      EU,
    ]);
  });

  test("a record that is gone is not written, and adds no entry", async () => {
    findOneById.mockResolvedValue(null);

    expect(
      await RuleAddedLabels.add({
        service: MonitorService,
        resourceId: MONITOR_ID,
        labelIds: [EU],
        props: PERSON,
      }),
    ).toEqual([]);
    expect(writes).toEqual([]);
    expect(recordUpdate).not.toHaveBeenCalled();
  });

  test("nothing to add reads nothing", async () => {
    await RuleAddedLabels.add({
      service: MonitorService,
      resourceId: MONITOR_ID,
      labelIds: [],
    });

    expect(findOneById).not.toHaveBeenCalled();
    expect(recordUpdate).not.toHaveBeenCalled();
  });

  test("a write that fails adds no entry, and fails as it came", async () => {
    jest.spyOn(MonitorService, "getRepository").mockReturnValue({
      createQueryBuilder: (): unknown => {
        return {
          relation: (): unknown => {
            return {
              of: (): unknown => {
                return {
                  add: async (): Promise<void> => {
                    throw new Error("duplicate key");
                  },
                };
              },
            };
          },
        };
      },
    } as never);

    await expect(
      RuleAddedLabels.add({
        service: MonitorService,
        resourceId: MONITOR_ID,
        labelIds: [EU],
        props: PERSON,
      }),
    ).rejects.toThrow("duplicate key");
    expect(recordUpdate).not.toHaveBeenCalled();
  });
});

describe("recording what a page of records was given", () => {
  test("one entry per record changed, a few at a time, none for a record given nothing", async () => {
    let running: number = 0;
    let most: number = 0;

    recordUpdate.mockImplementation(async (): Promise<void> => {
      running++;
      most = Math.max(most, running);
      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 0);
      });
      running--;
    });

    const changes: Array<{ before: Monitor; labelIds: Array<string> }> = [];

    for (let index: number = 0; index < 25; index++) {
      const before: Monitor = new Monitor(ObjectID.generate());
      before.projectId = PROJECT_ID;
      changes.push({ before, labelIds: index === 3 ? [] : [EU] });
    }

    await RuleAddedLabels.recordInAuditLog({
      modelType: Monitor,
      changes,
      props: PERSON,
    });

    expect(recordUpdate).toHaveBeenCalledTimes(24);
    expect(most).toBeLessThanOrEqual(RULE_LABEL_AUDIT_ENTRIES_AT_ONCE);
    expect(most).toBeGreaterThan(1);
  });

  test("a record with no id is skipped", async () => {
    await RuleAddedLabels.recordInAuditLog({
      modelType: Monitor,
      changes: [{ before: new Monitor(), labelIds: [EU] }],
    });

    expect(recordUpdate).not.toHaveBeenCalled();
  });

  test("reads a model's own name column: an incident is named by its title", () => {
    expect(RuleAddedLabels.getBeforeSelect(new Incident())).toEqual({
      _id: true,
      projectId: true,
      title: true,
      labels: { _id: true, name: true },
    });
  });
});
