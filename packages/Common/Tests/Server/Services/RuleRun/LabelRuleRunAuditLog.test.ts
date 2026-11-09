import AuditLogService from "../../../../Server/Services/AuditLogService";
import LabelService from "../../../../Server/Services/LabelService";
import MonitorFeedService from "../../../../Server/Services/MonitorFeedService";
import MonitorLabelRuleEngineService from "../../../../Server/Services/MonitorLabelRuleEngineService";
import MonitorLabelRuleService from "../../../../Server/Services/MonitorLabelRuleService";
import MonitorService from "../../../../Server/Services/MonitorService";
import NetworkDeviceLabelRuleEngineService from "../../../../Server/Services/NetworkDeviceLabelRuleEngineService";
import NetworkDeviceLabelRuleService from "../../../../Server/Services/NetworkDeviceLabelRuleService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import logger from "../../../../Server/Utils/Logger";
import RuleRecordScope from "../../../../Server/Utils/Rules/RuleRecordScope";
import { RuleApplicationResultUtil } from "../../../../Server/Utils/Rules/RuleRun/RuleApplication";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorLabelRule from "../../../../Models/DatabaseModels/MonitorLabelRule";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceLabelRule from "../../../../Models/DatabaseModels/NetworkDeviceLabelRule";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import UserType from "../../../../Types/UserType";
import { stubProjectDirectory } from "../../TestingUtils/ProjectDirectory";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * LABELS A LABEL RULE ADDS, IN THE AUDIT LOG, ONE ENGINE END TO END
 * (issue #6284).
 *
 * The monitor engine stands for every engine (each adds its labels through
 * RuleAddedLabels, which HookFreeWritesAreRecorded.test.ts holds them to):
 * Run now enters each monitor it labels by the person who ran the rule, a
 * rule applied as a monitor is created is OneUptime's own, and a monitor it
 * did not change gets nothing. The network device rules' Run now adds a page
 * of devices' labels at once and enters each device the same way.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RULE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const PROD: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EU: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const PERSON: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("33333333-3333-4333-8333-333333333333"),
  userType: UserType.User,
};

interface RecordedUpdate {
  before: { labels?: Array<Label>; _id?: string; name?: string };
  updatedFields: JSONObject;
  itemId: ObjectID;
  props: DatabaseCommonInteractionProps;
}

let recordUpdate: jest.SpyInstance;
let writes: Array<{ of: unknown; added: unknown }>;
let failWrites: boolean;

function label(id: string, name?: string): Label {
  const item: Label = new Label(new ObjectID(id));

  if (name) {
    item.name = name;
  }

  return item;
}

function labelIds(value: unknown): Array<string> {
  return ((value as Array<Label>) || []).map((item: Label): string => {
    return item._id!.toString();
  });
}

function fakeRepository(): unknown {
  let of: unknown = null;
  const builder: Record<string, unknown> = {
    createQueryBuilder: (): unknown => {
      return builder;
    },
    relation: (): unknown => {
      return builder;
    },
    of: (target: unknown): unknown => {
      of = target;
      return builder;
    },
    add: async (added: unknown): Promise<void> => {
      if (failWrites) {
        throw new Error("connection reset");
      }

      writes.push({ of, added });
    },
  };

  return builder;
}

function recorded(): Array<RecordedUpdate> {
  return recordUpdate.mock.calls.map((call: Array<unknown>): RecordedUpdate => {
    return call[0] as RecordedUpdate;
  });
}

beforeEach(() => {
  stubProjectDirectory({});
  writes = [];
  failWrites = false;

  for (const silenced of ["error", "warn", "debug"] as const) {
    jest.spyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }

  recordUpdate = jest
    .spyOn(AuditLogService, "recordUpdate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(RuleRecordScope, "keepIdsInProject")
    .mockImplementation((async (data: { ids: Array<string> }) => {
      return data.ids;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a monitor label rule", () => {
  // A rule with no criteria matches every monitor.
  function rule(): MonitorLabelRule {
    const item: MonitorLabelRule = new MonitorLabelRule(RULE_ID);
    item.name = "Tag Europe";
    item.labelsToAdd = [label(EU)];
    return item;
  }

  function monitorWith(labels: Array<Label>): Monitor {
    const monitor: Monitor = new Monitor(MONITOR_ID);
    monitor.projectId = PROJECT_ID;
    monitor.name = "API";
    monitor.description = "The public API";
    monitor.labels = labels;
    return monitor;
  }

  beforeEach(() => {
    jest
      .spyOn(MonitorService, "getRepository")
      .mockReturnValue(fakeRepository() as never);
    jest
      .spyOn(MonitorService, "findOneById")
      .mockResolvedValue(monitorWith([label(PROD, "production")]));
    jest
      .spyOn(MonitorFeedService, "createMonitorFeedItem")
      .mockResolvedValue(undefined as never);
    jest.spyOn(LabelService, "findBy").mockResolvedValue([]);
  });

  function runTarget(): Monitor {
    const monitor: Monitor = new Monitor(MONITOR_ID);
    monitor.projectId = PROJECT_ID;
    return monitor;
  }

  test("Run now enters the monitor it labelled, by the person who ran it, with its labels before and after", async () => {
    const result: unknown =
      await MonitorLabelRuleEngineService.applyRulesToExistingResource({
        resource: runTarget(),
        rules: [rule()],
        allowOwnerNotification: false,
        props: PERSON,
      });

    expect(result).toEqual(RuleApplicationResultUtil.updated(1));
    expect(writes).toEqual([{ of: MONITOR_ID.toString(), added: [EU] }]);
    expect(recorded()).toHaveLength(1);

    const entry: RecordedUpdate = recorded()[0]!;

    expect(entry.props).toEqual(PERSON);
    expect(entry.itemId.toString()).toBe(MONITOR_ID.toString());
    // Named, so the project-wide audit log says which monitor.
    expect(entry.before.name).toBe("API");
    expect(labelIds(entry.before.labels)).toEqual([PROD]);
    expect(labelIds(entry.updatedFields["labels"])).toEqual([PROD, EU]);
  });

  test("a monitor that has the rule's labels already gets no entry", async () => {
    jest
      .spyOn(MonitorService, "findOneById")
      .mockResolvedValue(monitorWith([label(PROD), label(EU)]));

    const result: unknown =
      await MonitorLabelRuleEngineService.applyRulesToExistingResource({
        resource: runTarget(),
        rules: [rule()],
        allowOwnerNotification: false,
        props: PERSON,
      });

    expect(result).toEqual(RuleApplicationResultUtil.alreadyApplied());
    expect(writes).toEqual([]);
    expect(recordUpdate).not.toHaveBeenCalled();
  });

  test("a rule applied as a monitor is created is OneUptime's own: a system event", async () => {
    jest.spyOn(MonitorLabelRuleService, "findBy").mockResolvedValue([rule()]);

    await MonitorLabelRuleEngineService.applyRulesToMonitor(runTarget());

    expect(recorded()).toHaveLength(1);
    expect(recorded()[0]!.props).toEqual({ isRoot: true });
    expect(labelIds(recorded()[0]!.updatedFields["labels"])).toEqual([
      PROD,
      EU,
    ]);
  });

  test("a label write that fails enters nothing", async () => {
    failWrites = true;

    const result: unknown =
      await MonitorLabelRuleEngineService.applyRulesToExistingResource({
        resource: runTarget(),
        rules: [rule()],
        allowOwnerNotification: false,
        props: PERSON,
      });

    expect(result).toEqual(RuleApplicationResultUtil.failed());
    expect(recordUpdate).not.toHaveBeenCalled();
  });
});

describe("a network device label rule's Run now", () => {
  function device(id: string, labels: Array<Label>): NetworkDevice {
    const item: NetworkDevice = new NetworkDevice(new ObjectID(id));
    item.projectId = PROJECT_ID;
    item.name = `switch-${id.slice(-2)}`;
    item.labels = labels;
    return item;
  }

  const FIRST: string = "d0000000-0000-4000-8000-000000000001";
  const SECOND: string = "d0000000-0000-4000-8000-000000000002";
  const LABELLED: string = "d0000000-0000-4000-8000-000000000003";

  beforeEach(() => {
    const rule: NetworkDeviceLabelRule = new NetworkDeviceLabelRule(RULE_ID);
    rule.isEnabled = true;
    rule.labelsToAdd = [label(EU)];

    jest
      .spyOn(NetworkDeviceLabelRuleService, "findOneBy")
      .mockResolvedValue(rule);
    jest
      .spyOn(NetworkDeviceService, "getRepository")
      .mockReturnValue(fakeRepository() as never);
    jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockResolvedValueOnce([
        device(FIRST, []),
        device(SECOND, [label(PROD, "production")]),
        device(LABELLED, [label(EU, "europe")]),
      ])
      .mockResolvedValue([]);
  });

  test("enters each device it labelled, by the person who ran it, once its page is written", async () => {
    await NetworkDeviceLabelRuleEngineService.applyRuleToExistingNetworkDevices(
      { ruleId: RULE_ID, projectId: PROJECT_ID, props: PERSON },
    );

    expect(writes).toEqual([{ of: [FIRST, SECOND], added: EU }]);
    expect(
      recorded().map((entry: RecordedUpdate): string => {
        return entry.itemId.toString();
      }),
    ).toEqual([FIRST, SECOND]);

    for (const entry of recorded()) {
      expect(entry.props).toEqual(PERSON);
    }

    expect(labelIds(recorded()[1]!.updatedFields["labels"])).toEqual([
      PROD,
      EU,
    ]);
  });

  test("devices whose labels could not be written are not entered", async () => {
    failWrites = true;

    await NetworkDeviceLabelRuleEngineService.applyRuleToExistingNetworkDevices(
      { ruleId: RULE_ID, projectId: PROJECT_ID, props: PERSON },
    );

    expect(recordUpdate).not.toHaveBeenCalled();
  });

  test("without anyone named, the entries are OneUptime's own", async () => {
    await NetworkDeviceLabelRuleEngineService.applyRuleToExistingNetworkDevices(
      { ruleId: RULE_ID, projectId: PROJECT_ID },
    );

    for (const entry of recorded()) {
      expect(entry.props).toEqual({ isRoot: true });
    }
  });
});
