import { XcpNgPoolFeedEventType } from "../../../../Models/DatabaseModels/XcpNgPoolFeed";
import { Green500, Red500, Yellow500 } from "../../../../Types/BrandColors";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import { XcpNgMessageAlert } from "../../../../Types/XcpNg/XcpNgMessageCatalog";
import {
  XCP_NG_MAX_OPEN_MESSAGES_PER_POOL,
  XcpNgBackupJobInfo,
  XcpNgBackupRun,
  XcpNgBackupStatus,
} from "../../../../Types/XcpNg/XcpNgPoolEvents";
import {
  XcpNgEventSource,
  XcpNgPoolBackupJob,
  XcpNgPoolEventState,
} from "../../../../Types/XcpNg/XcpNgPoolEventState";
import {
  XcpNgMessageWatermark,
  XcpNgPoolMessage,
} from "../../../../Types/XcpNg/XcpNgProbeCollection";
import XcpNgResourceKind from "../../../../Types/XcpNg/XcpNgResourceKind";
import {
  XCP_NG_MAX_MESSAGE_FEED_LINES,
  XcpNgPoolEventsInput,
  XcpNgPoolEventsOutput,
  XcpNgStoredPool,
  XcpNgStoredResource,
  processXcpNgPoolEvents,
  resolveXcpNgEventObject,
  summarizeXcpNgRunForPool,
} from "../../../../Server/Utils/XcpNg/XcpNgPoolEventsProcessing";
import FakeXenOrchestraRest, {
  FAKE_XO_TOKEN,
  FakeXoResponse,
  LAB_POOL_PRODUCTION,
} from "../../../Helpers/XcpNg/FakeXenOrchestraRest";
import {
  buildXcpNgBackupJobInfos,
  readXoBackupJobs,
  readXoBackupRun,
  readXoMessages,
  readXoAlarms,
  readXoSchedules,
} from "../../../../Utils/XcpNg/XenOrchestraRest";
import { describe, expect, test } from "@jest/globals";

/*
 * One pool's events worked out (XcpNgPoolEventsProcessing), rule by rule and
 * over the lab's minutes: what becomes a record, a feed line, a column, a
 * VM's last backup and a derived reading.
 */

const POOL: string = LAB_POOL_PRODUCTION;
const PROD_01: string = "9c6c0b6e-4f2a-4a7e-8b1e-0d1f2a3b4c5d";
const PROD_02: string = "4e1d3a2b-7c8d-4e9f-a0b1-c2d3e4f5a6b7";
const PROD_03: string = "f0e1d2c3-b4a5-4968-8776-655443322110";
const WEB_01: string = "e8a5b2c1-3d4e-4f5a-8b6c-7d8e9f0a1b2c";
const DB_01: string = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f";
const APP_02: string = "7b8c9d0e-1f2a-4b3c-9d4e-5f6a7b8c9d0e";
const WIN_03: string = "9d0e1f2a-3b4c-4d5e-8f6a-7b8c9d0e1f2a";
const LAB_VM: string = "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b";
const NFS_SR: string = "1d2c3b4a-5e6f-4789-9abc-def012345678";
const NIGHTLY: string = "59af07fc-e82c-43b5-8137-026832f30166";
const METADATA: string = "b50f95fd-f6b7-4027-87b6-6a02c7dcd5f5";

const NOW: Date = new Date(1795000100 * 1000);
const WATERMARK: XcpNgMessageWatermark = {
  readUntil: new Date(1795000000 * 1000).toISOString(),
  uuidsAtReadUntil: [],
};

function row(
  kind: string,
  externalId: string,
  name: string,
  extra: Partial<XcpNgStoredResource> = {},
): XcpNgStoredResource {
  return {
    kind: kind,
    externalId: externalId,
    name: name,
    isUp: true,
    isEnabled: true,
    isControlDomain: false,
    lastSuccessfulBackupAt: null,
    backupIntervalSeconds: null,
    missingPatchCount: null,
    ...extra,
  };
}

// The Production pool of the recorded lab, as its inventory holds it.
function labInventory(): Array<XcpNgStoredResource> {
  return [
    row(XcpNgResourceKind.Host, PROD_01, "xcp-prod-01"),
    row(XcpNgResourceKind.Host, PROD_02, "xcp-prod-02", { isEnabled: false }),
    row(XcpNgResourceKind.Host, PROD_03, "xcp-prod-03", { isUp: false }),
    row(XcpNgResourceKind.VM, WEB_01, "web-01"),
    row(XcpNgResourceKind.VM, DB_01, "db-01"),
    row(XcpNgResourceKind.VM, APP_02, "app-02", { isUp: false }),
    row(XcpNgResourceKind.VM, WIN_03, "win-03", { isUp: false }),
    row(
      XcpNgResourceKind.VM,
      "ffffffff-0000-4000-8000-00000000d0d0",
      "Control domain on xcp-prod-01",
      {
        isControlDomain: true,
      },
    ),
    row(XcpNgResourceKind.StorageRepository, NFS_SR, "NFS VM store"),
  ];
}

function storedPool(overrides: Partial<XcpNgStoredPool> = {}): XcpNgStoredPool {
  return {
    xcpNgPoolId: "6b3f2a10-0000-4000-8000-0000000000aa",
    poolIdentifier: POOL,
    name: "Production",
    reportedName: "Production",
    xenOrchestraName: "xo-paris",
    isHaEnabled: null,
    haHostFailuresToTolerate: null,
    haPlanExistsFor: null,
    isHaOvercommitted: null,
    masterHostExternalId: null,
    backupJobs: null,
    eventState: null,
    ...overrides,
  };
}

function process(
  overrides: Partial<XcpNgPoolEventsInput> = {},
): XcpNgPoolEventsOutput {
  return processXcpNgPoolEvents({
    now: NOW,
    source: XcpNgEventSource.XenOrchestra,
    pool: storedPool(),
    inventory: labInventory(),
    messagesRead: true,
    messages: [],
    messageWatermark: WATERMARK,
    clearedMessageIds: [],
    patchesChecked: false,
    problems: {},
    ...overrides,
  });
}

function message(
  uuid: string,
  name: string,
  objectUuid: string,
  timeSeconds: number,
  extra: Partial<XcpNgPoolMessage> = {},
): XcpNgPoolMessage {
  return {
    uuid: uuid,
    poolId: POOL,
    name: name,
    priority: 0,
    objectClass: "",
    objectUuid: objectUuid,
    timestamp: new Date(timeSeconds * 1000).toISOString(),
    body: "",
    ...extra,
  };
}

function attributes(record: JSONObject): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of (record["attributes"] || []) as JSONArray) {
    const attribute: JSONObject = entry as JSONObject;
    out[String(attribute["key"])] = String(
      ((attribute["value"] || {}) as JSONObject)["stringValue"],
    );
  }
  return out;
}

function recordsOf(
  output: XcpNgPoolEventsOutput,
  key: string,
  value: string,
): Array<JSONObject> {
  return output.records.filter((record: JSONObject): boolean => {
    return attributes(record)[key] === value;
  });
}

// What the recorded lab's Xen Orchestra answers, read as the probe reads it.
async function labGet(
  xo: FakeXenOrchestraRest,
  path: string,
): Promise<unknown> {
  const response: FakeXoResponse = await xo.handle({
    method: "GET",
    path: path,
    headers: { Cookie: `authenticationToken=${FAKE_XO_TOKEN}` },
  });
  return JSON.parse(response.body) as unknown;
}

describe("the first read", () => {
  test("keeps the watermark and says when and how it read", () => {
    const output: XcpNgPoolEventsOutput = process({ messages: [] });
    expect(output.records).toEqual([]);
    expect(output.feed).toEqual([]);
    expect(output.columns.eventsReadAt).toBe(NOW);
    expect(output.columns.eventReadStatus).toEqual({
      source: XcpNgEventSource.XenOrchestra,
      problems: {},
    });
    expect(output.columns.eventState.messageWatermark).toEqual(WATERMARK);
    expect(output.columns.eventState.openMessages).toEqual([]);
  });

  test("messages not read: neither the watermark nor the time moves", () => {
    const output: XcpNgPoolEventsOutput = process({
      messagesRead: false,
      messageWatermark: undefined,
      problems: { messages: "Xen Orchestra answered HTTP 500." },
    });
    expect(output.columns.eventsReadAt).toBeUndefined();
    expect(output.columns.eventState.messageWatermark).toBeUndefined();
    expect(output.columns.eventReadStatus.problems.messages).toBe(
      "Xen Orchestra answered HTTP 500.",
    );
  });
});

describe("messages", () => {
  test("a crash: a record named by the VM, a red feed line, an open alert", () => {
    const output: XcpNgPoolEventsOutput = process({
      messages: [
        message("m-crash", "VM_CRASHED", WEB_01, 1795000030, { priority: 2 }),
      ],
    });

    const [record] = output.records as Array<JSONObject>;
    expect(attributes(record as JSONObject)).toMatchObject({
      "xcp_ng.message.name": "VM_CRASHED",
      "xcp_ng.message.alert": XcpNgMessageAlert.VmCrashed,
      "xcp_ng.message.state": "raised",
      "xcp_ng.object.type": "vm",
      "xcp_ng.object.uuid": WEB_01,
      "xcp_ng.object.name": "web-01",
    });

    expect(output.feed).toEqual([
      {
        type: XcpNgPoolFeedEventType.XcpNgPoolMessage,
        markdown: "**VM crashed**: web-01.",
        color: Red500,
        postedAt: new Date(1795000030 * 1000),
      },
    ]);

    expect(output.columns.eventState.openMessages).toEqual([
      {
        id: "m-crash",
        name: "VM_CRASHED",
        alert: XcpNgMessageAlert.VmCrashed,
        objectType: "vm",
        objectUuid: WEB_01,
        objectName: "web-01",
        raisedAt: new Date(1795000030 * 1000).toISOString(),
      },
    ]);
  });

  test("priority 5 stays in Logs; priority 4 reaches the feed; neither stays open", () => {
    const output: XcpNgPoolEventsOutput = process({
      messages: [
        message("m-start", "VM_STARTED", WEB_01, 1795000045, { priority: 5 }),
        message("m-plugin", "ACME_PLUGIN_NOTICE", POOL, 1795000050, {
          priority: 4,
          body: "A note a plugin left on the pool",
        }),
      ],
    });
    expect(output.records).toHaveLength(2);
    expect(output.feed).toHaveLength(1);
    expect(output.feed[0]?.markdown).toBe(
      "**Acme plugin notice**: Production. A note a plugin left on the pool",
    );
    expect(output.columns.eventState.openMessages).toEqual([]);
  });

  test("an ALARM is opened per object and variable, and said in words", () => {
    const output: XcpNgPoolEventsOutput = process({
      messages: [
        message("m-cpu", "ALARM", DB_01, 1795000040, {
          priority: 3,
          objectClass: "VM",
          body: 'value: 0.953\nconfig:\n<variable>\n<name value="cpu_usage"/>\n</variable>',
        }),
      ],
    });
    expect(output.feed[0]?.markdown).toBe(
      "**Threshold alarm**: db-01. cpu_usage reached 95.3%",
    );
    expect(output.feed[0]?.color).toBe(Yellow500);
    expect(output.columns.eventState.openMessages[0]?.variable).toBe(
      "cpu_usage",
    );
    expect(
      attributes(output.records[0] as JSONObject)["xcp_ng.message.alert"],
    ).toBe(XcpNgMessageAlert.OtherAlarm);
  });

  test("another pool's message, in the same report, is not this pool's", () => {
    const output: XcpNgPoolEventsOutput = process({
      messages: [
        message("m-lab", "VM_CRASHED", LAB_VM, 1795000030, {
          poolId: "2ad2c2ec-1d43-4a5c-9c62-e8d0b6a4c3f1",
        }),
      ],
    });
    expect(output.records).toEqual([]);
  });

  test("a minute with many messages writes twenty feed lines and says the rest are in Logs", () => {
    const messages: Array<XcpNgPoolMessage> = [];
    for (let index: number = 0; index < 25; index++) {
      messages.push(
        message(`m${index}`, "HA_HOST_FAILED", PROD_03, 1795000000 + index),
      );
    }
    const output: XcpNgPoolEventsOutput = process({ messages: messages });
    expect(output.records).toHaveLength(25);
    expect(output.feed).toHaveLength(XCP_NG_MAX_MESSAGE_FEED_LINES + 1);
    expect(output.feed[XCP_NG_MAX_MESSAGE_FEED_LINES]?.markdown).toBe(
      "5 more XCP-ng messages arrived in the same minute. Every one is on the pool's Logs page.",
    );
  });

  test("the open messages a pool keeps are bounded, oldest let go", () => {
    const messages: Array<XcpNgPoolMessage> = [];
    for (
      let index: number = 0;
      index < XCP_NG_MAX_OPEN_MESSAGES_PER_POOL + 5;
      index++
    ) {
      messages.push(
        message(`m${index}`, "VM_CRASHED", WEB_01, 1795000000 + index),
      );
    }
    const output: XcpNgPoolEventsOutput = process({ messages: messages });
    expect(output.columns.eventState.openMessages).toHaveLength(
      XCP_NG_MAX_OPEN_MESSAGES_PER_POOL,
    );
    expect(output.columns.eventState.openMessages[0]?.id).toBe("m5");
  });
});

describe("a message XCP-ng clears", () => {
  function withOpen(...ids: Array<string>): XcpNgPoolEventState {
    return {
      openMessages: ids.map((id: string) => {
        return {
          id: id,
          name: "ALARM",
          alert: XcpNgMessageAlert.OtherAlarm,
          objectType: "vm",
          objectUuid: DB_01,
          objectName: "db-01",
          variable: "cpu_usage",
          raisedAt: new Date(1795000040 * 1000).toISOString(),
        };
      }),
    };
  }

  test("resolves its alert once the last message of the group is gone", () => {
    const first: XcpNgPoolEventsOutput = process({
      pool: storedPool({ eventState: withOpen("a1", "a2") }),
      clearedMessageIds: ["a1"],
    });
    // a2 still holds the alert open.
    expect(first.records).toEqual([]);
    expect(
      first.columns.eventState.openMessages.map((open: { id: string }) => {
        return open.id;
      }),
    ).toEqual(["a2"]);

    const second: XcpNgPoolEventsOutput = process({
      pool: storedPool({ eventState: first.columns.eventState }),
      clearedMessageIds: ["a2"],
    });
    expect(second.records).toHaveLength(1);
    expect(attributes(second.records[0] as JSONObject)).toMatchObject({
      "xcp_ng.message.state": "cleared",
      "xcp_ng.message.name": "ALARM",
      "xcp_ng.object.uuid": DB_01,
      "xcp_ng.object.name": "db-01",
      "xcp_ng.alarm.variable": "cpu_usage",
    });
    expect(second.columns.eventState.openMessages).toEqual([]);
  });

  test("two messages of one group cleared together write one record", () => {
    const output: XcpNgPoolEventsOutput = process({
      pool: storedPool({ eventState: withOpen("a1", "a2") }),
      clearedMessageIds: ["a1", "a2", "not-open"],
    });
    expect(output.records).toHaveLength(1);
  });

  test("a new message of a group cleared in the same read keeps it open", () => {
    const output: XcpNgPoolEventsOutput = process({
      pool: storedPool({ eventState: withOpen("a1") }),
      messages: [
        message("a3", "ALARM", DB_01, 1795000090, {
          body: 'value: 0.97\nconfig:\n<variable>\n<name value="cpu_usage"/>\n</variable>',
        }),
      ],
      clearedMessageIds: ["a1"],
    });
    expect(recordsOf(output, "xcp_ng.message.state", "cleared")).toEqual([]);
    expect(
      output.columns.eventState.openMessages.map((open: { id: string }) => {
        return open.id;
      }),
    ).toEqual(["a3"]);
  });

  test("straight from XAPI nothing is tracked: the alert resolves by hand", () => {
    const output: XcpNgPoolEventsOutput = process({
      source: XcpNgEventSource.Xapi,
      messageWatermark: undefined,
      messages: [
        message("x1", "VM_CRASHED", WEB_01, 1795000030, {
          priority: 2,
          objectClass: "VM",
        }),
      ],
    });
    expect(output.records).toHaveLength(1);
    expect(output.columns.eventState.openMessages).toEqual([]);
    expect(output.columns.eventReadStatus.source).toBe(XcpNgEventSource.Xapi);
  });
});

describe("what a message is about", () => {
  const inventory: Map<string, XcpNgStoredResource> = new Map(
    labInventory().map((entry: XcpNgStoredResource) => {
      return [entry.externalId, entry];
    }),
  );
  const definition: ReturnType<
    typeof import("../../../../Types/XcpNg/XcpNgMessageCatalog").getXcpNgMessageDefinition
  > = {
    priority: 3,
    objectType: "unknown",
    title: "x",
    alert: XcpNgMessageAlert.OtherAlarm,
  };

  test("the pool itself, its hosts, VMs and storage by their names", () => {
    expect(
      resolveXcpNgEventObject({
        uuid: POOL.toUpperCase(),
        objectClass: "",
        definition: definition,
        pool: storedPool(),
        inventory: inventory,
      }),
    ).toEqual({ type: "pool", uuid: POOL, name: "Production" });
    expect(
      resolveXcpNgEventObject({
        uuid: NFS_SR,
        objectClass: "SR",
        definition: definition,
        pool: storedPool(),
        inventory: inventory,
      }),
    ).toEqual({ type: "sr", uuid: NFS_SR, name: "NFS VM store" });
  });

  test("an object the inventory does not hold reads by its class and UUID", () => {
    expect(
      resolveXcpNgEventObject({
        uuid: "1a2b3c4d-0000-4000-8000-000000000000",
        objectClass: "VM",
        definition: definition,
        pool: storedPool(),
        inventory: inventory,
      }),
    ).toEqual({
      type: "vm",
      uuid: "1a2b3c4d-0000-4000-8000-000000000000",
      name: "VM 1a2b3c4d",
    });
    expect(
      resolveXcpNgEventObject({
        uuid: "9a2b3c4d-0000-4000-8000-000000000000",
        objectClass: "",
        definition: { ...definition, objectType: "host" as never },
        pool: storedPool(),
        inventory: inventory,
      }).name,
    ).toBe("Host 9a2b3c4d");
    expect(
      resolveXcpNgEventObject({
        uuid: "",
        objectClass: "",
        definition: definition,
        pool: storedPool(),
        inventory: inventory,
      }).name,
    ).toBe("Production");
  });
});

describe("HA and the master", () => {
  test("HA on and the master: columns, and the hosts' verdict", () => {
    const output: XcpNgPoolEventsOutput = process({
      poolState: { poolId: POOL, haEnabled: true, masterHostUuid: PROD_01 },
    });
    expect(output.columns.isHaEnabled).toBe(true);
    expect(output.columns.masterHostExternalId).toBe(PROD_01);
    expect(output.columns.haHostFailuresToTolerate).toBeNull();
    // Production has one host up and enabled: it cannot tolerate a failure.
    expect(output.derived.ha).toEqual({
      enabled: true,
      canTolerateHostFailure: false,
      hostFailuresToTolerate: null,
      planExistsFor: null,
    });
    // The first read sets the verdict; it does not post one.
    expect(output.feed).toEqual([]);
    expect(output.columns.eventState.haCouldTolerateHostFailure).toBe(false);
  });

  test("disabling a host of an HA pool of two: HA can no longer tolerate a failure", () => {
    const twoHosts: Array<XcpNgStoredResource> = [
      row(XcpNgResourceKind.Host, PROD_01, "xcp-prod-01"),
      row(XcpNgResourceKind.Host, PROD_02, "xcp-prod-02"),
    ];
    const before: XcpNgPoolEventsOutput = process({
      inventory: twoHosts,
      poolState: { poolId: POOL, haEnabled: true, masterHostUuid: PROD_01 },
    });
    expect(before.derived.ha?.canTolerateHostFailure).toBe(true);

    const after: XcpNgPoolEventsOutput = process({
      pool: storedPool({
        isHaEnabled: true,
        masterHostExternalId: PROD_01,
        eventState: before.columns.eventState,
      }),
      inventory: [
        twoHosts[0] as XcpNgStoredResource,
        { ...(twoHosts[1] as XcpNgStoredResource), isEnabled: false },
      ],
      poolState: { poolId: POOL, haEnabled: true, masterHostUuid: PROD_01 },
    });
    expect(after.derived.ha?.canTolerateHostFailure).toBe(false);
    expect(after.feed).toEqual([
      {
        type: XcpNgPoolFeedEventType.XcpNgPoolHaChanged,
        markdown:
          "High availability can no longer tolerate a host failure: fewer than two hosts are up and enabled to restart VMs on.",
        color: Red500,
        postedAt: NOW,
      },
    ]);

    const recovered: XcpNgPoolEventsOutput = process({
      pool: storedPool({
        isHaEnabled: true,
        masterHostExternalId: PROD_01,
        eventState: after.columns.eventState,
      }),
      inventory: twoHosts,
      poolState: { poolId: POOL, haEnabled: true, masterHostUuid: PROD_01 },
    });
    expect(recovered.feed[0]?.markdown).toBe(
      "High availability can tolerate a host failure again.",
    );
    expect(recovered.feed[0]?.color).toBe(Green500);
  });

  test("straight from XAPI the plan decides, and says what it covers", () => {
    const before: XcpNgPoolEventsOutput = process({
      source: XcpNgEventSource.Xapi,
      messageWatermark: undefined,
      poolState: {
        poolId: POOL,
        haEnabled: true,
        haHostFailuresToTolerate: 1,
        haPlanExistsFor: 1,
        haOvercommitted: false,
        masterHostUuid: PROD_01,
      },
    });
    expect(before.derived.ha?.canTolerateHostFailure).toBe(true);
    expect(before.columns.haHostFailuresToTolerate).toBe(1);

    const after: XcpNgPoolEventsOutput = process({
      source: XcpNgEventSource.Xapi,
      messageWatermark: undefined,
      pool: storedPool({
        isHaEnabled: true,
        haHostFailuresToTolerate: 1,
        haPlanExistsFor: 1,
        isHaOvercommitted: false,
        eventState: before.columns.eventState,
      }),
      poolState: {
        poolId: POOL,
        haEnabled: true,
        haHostFailuresToTolerate: 1,
        haPlanExistsFor: 0,
        haOvercommitted: true,
        masterHostUuid: PROD_01,
      },
    });
    expect(after.feed[0]?.markdown).toBe(
      "High availability can no longer tolerate a host failure: its plan covers 0 host failures of the 1 it is set to tolerate.",
    );
    expect(after.derived.ha).toEqual({
      enabled: true,
      canTolerateHostFailure: false,
      hostFailuresToTolerate: 1,
      planExistsFor: 0,
    });
  });

  test("the master moves: one feed line, and POOL_MASTER_TRANSITION adds none", () => {
    const output: XcpNgPoolEventsOutput = process({
      pool: storedPool({ masterHostExternalId: PROD_01 }),
      poolState: { poolId: POOL, haEnabled: false, masterHostUuid: PROD_02 },
      messages: [
        message("m-master", "POOL_MASTER_TRANSITION", PROD_02, 1795000150),
      ],
    });
    expect(output.feed).toEqual([
      {
        type: XcpNgPoolFeedEventType.XcpNgPoolMasterChanged,
        markdown:
          "The pool master moved from **xcp-prod-01** to **xcp-prod-02**.",
        color: Yellow500,
        postedAt: NOW,
      },
    ]);
    // The message is still kept for its (opt-in) template.
    expect(output.records).toHaveLength(1);
    expect(
      attributes(output.records[0] as JSONObject)["xcp_ng.message.alert"],
    ).toBe(XcpNgMessageAlert.PoolMasterChanged);
    expect(output.columns.eventState.openMessages).toEqual([]);
  });

  test("POOL_MASTER_TRANSITION alone, the master not read this time: its own line", () => {
    const output: XcpNgPoolEventsOutput = process({
      messages: [
        message("m-master", "POOL_MASTER_TRANSITION", PROD_02, 1795000150),
      ],
    });
    expect(output.feed).toHaveLength(1);
    expect(output.feed[0]?.type).toBe(XcpNgPoolFeedEventType.XcpNgPoolMessage);
    expect(output.feed[0]?.markdown).toBe(
      "**The pool master changed**: xcp-prod-02.",
    );
  });

  test("HA turned off and on again", () => {
    const off: XcpNgPoolEventsOutput = process({
      pool: storedPool({ isHaEnabled: true }),
      poolState: { poolId: POOL, haEnabled: false },
    });
    expect(off.feed[0]?.markdown).toBe(
      "High availability was turned off: VMs are no longer restarted on another host when theirs fails.",
    );
    expect(off.derived.ha?.canTolerateHostFailure).toBeNull();
    expect(off.columns.eventState.haCouldTolerateHostFailure).toBeUndefined();

    const on: XcpNgPoolEventsOutput = process({
      pool: storedPool({ isHaEnabled: false }),
      poolState: { poolId: POOL, haEnabled: true },
    });
    expect(on.feed[0]?.markdown).toBe("High availability was turned on.");
  });

  test("Xen Orchestra never keeps an older XAPI plan", () => {
    const output: XcpNgPoolEventsOutput = process({
      pool: storedPool({ haHostFailuresToTolerate: 2, haPlanExistsFor: 2 }),
      poolState: { poolId: POOL, haEnabled: true },
    });
    expect(output.columns.haHostFailuresToTolerate).toBeNull();
    expect(output.columns.haPlanExistsFor).toBeNull();
  });
});

describe("backups", () => {
  async function labRuns(): Promise<{
    runs: Array<XcpNgBackupRun>;
    jobs: Array<XcpNgBackupJobInfo>;
  }> {
    const xo: FakeXenOrchestraRest = new FakeXenOrchestraRest();
    const runs: Array<XcpNgBackupRun> = [];
    for (const id of [
      "1794909600000",
      "1794996000000",
      "1794997800000",
      "1794999600000",
    ]) {
      runs.push(
        readXoBackupRun(
          await labGet(xo, `/rest/v0/backup-logs/${id}`),
        ) as XcpNgBackupRun,
      );
    }
    return {
      runs: runs,
      jobs: buildXcpNgBackupJobInfos({
        jobs: readXoBackupJobs(
          await labGet(
            xo,
            "/rest/v0/backup-jobs?fields=id,name,mode,type,pools",
          ),
        ),
        schedules: readXoSchedules(
          await labGet(
            xo,
            "/rest/v0/schedules?fields=id,jobId,cron,timezone,enabled",
          ),
        ),
      }),
    };
  }

  test("each job's last runs for the pool, newest first, with what failed and why", async () => {
    const lab: {
      runs: Array<XcpNgBackupRun>;
      jobs: Array<XcpNgBackupJobInfo>;
    } = await labRuns();
    const output: XcpNgPoolEventsOutput = process({
      backupRuns: lab.runs,
      backupJobs: lab.jobs,
      backupWatermark: { readSince: 1, deliveredRunIds: [], trackedRuns: [] },
    });

    const jobs: Array<XcpNgPoolBackupJob> = output.columns
      .backupJobs as Array<XcpNgPoolBackupJob>;
    expect(
      jobs.map((job: XcpNgPoolBackupJob) => {
        return job.name;
      }),
    ).toEqual(["Nightly delta", "Pool metadata", "Weekly full"]);

    const nightly: XcpNgPoolBackupJob = jobs[0] as XcpNgPoolBackupJob;
    expect(nightly.intervalSeconds).toBe(86400);
    expect(nightly.isScheduled).toBe(true);
    expect(nightly.mode).toBe("delta");
    expect(nightly.vmCount).toBe(3);
    expect(nightly.lastSuccessAt).toBe(new Date(1794910400300).toISOString());
    expect(
      nightly.runs.map((run: { status: string }) => {
        return run.status;
      }),
    ).toEqual(["failure", "success"]);
    // This pool's VMs only: lab-vm-01 is the other pool's.
    expect(nightly.runs[0]).toEqual({
      runId: "1794996000000",
      status: XcpNgBackupStatus.Failure,
      startedAt: new Date(1794996000000).toISOString(),
      endedAt: new Date(1794996300300).toISOString(),
      vmCount: 3,
      failedVmCount: 2,
      skippedVmCount: 1,
      problemVms: [
        {
          vmId: WEB_01,
          vmName: "web-01",
          status: XcpNgBackupStatus.Failure,
          error: "transfer: ENOSPC: no space left on device, write",
        },
        {
          vmId: APP_02,
          vmName: "app-02",
          status: XcpNgBackupStatus.Failure,
          error: "VDI_IO_ERROR(Device I/O errors)",
        },
        {
          vmId: DB_01,
          vmName: "db-01",
          status: XcpNgBackupStatus.Skipped,
          error:
            "unhealthy VDI chain: Xen Orchestra skipped the VM to protect its disks' chain until it is coalesced",
        },
      ],
    });

    // The metadata job is this pool's by its own pools.
    const metadata: XcpNgPoolBackupJob = jobs[1] as XcpNgPoolBackupJob;
    expect(metadata.runs[0]?.status).toBe(XcpNgBackupStatus.Failure);
    expect(metadata.runs[0]?.vmCount).toBe(0);
    expect(metadata.runs[0]?.error).toContain("ECONNREFUSED");

    const weekly: XcpNgPoolBackupJob = jobs[2] as XcpNgPoolBackupJob;
    expect(weekly.intervalSeconds).toBe(7 * 86400);
    expect(weekly.runs[0]?.status).toBe(XcpNgBackupStatus.Interrupted);

    expect(output.columns.backupsReadAt).toBe(NOW);
    expect(output.columns.eventState.backupsWatchedSince).toBe(
      NOW.toISOString(),
    );
    expect(output.columns.eventState.backupWatermark).toEqual({
      readSince: 1,
      deliveredRunIds: [],
      trackedRuns: [],
    });
  });

  test("a failed run opens an alert naming the VMs that failed; the next success closes it", async () => {
    const lab: {
      runs: Array<XcpNgBackupRun>;
      jobs: Array<XcpNgBackupJobInfo>;
    } = await labRuns();
    const first: XcpNgPoolEventsOutput = process({
      backupRuns: lab.runs.filter((run: XcpNgBackupRun) => {
        return run.jobId === NIGHTLY;
      }),
      backupJobs: lab.jobs,
    });

    const failures: Array<JSONObject> = recordsOf(
      first,
      "xcp_ng.backup.status",
      "failure",
    );
    expect(failures).toHaveLength(1);
    expect(attributes(failures[0] as JSONObject)).toMatchObject({
      "xcp_ng.backup.job.id": NIGHTLY,
      "xcp_ng.backup.job.name": "Nightly delta",
      "xcp_ng.backup.failed_vms": "web-01, app-02",
      "xcp_ng.backup.failed_vm_count": "2",
    });
    expect(first.columns.eventState.openBackupFailures).toEqual([
      {
        jobId: NIGHTLY,
        jobName: "Nightly delta",
        failedVms: "web-01, app-02",
        failedAt: new Date(1794996300300).toISOString(),
      },
    ]);
    expect(
      first.feed.filter((line: { type: XcpNgPoolFeedEventType }) => {
        return line.type === XcpNgPoolFeedEventType.XcpNgPoolBackupFailed;
      }),
    ).toHaveLength(1);

    const success: XcpNgBackupRun = {
      ...(lab.runs[0] as XcpNgBackupRun),
      runId: "1795082400000",
      startedAt: new Date(1795082400000).toISOString(),
      endedAt: new Date(1795083000000).toISOString(),
    };
    const second: XcpNgPoolEventsOutput = process({
      now: new Date(1795083060000),
      pool: storedPool({
        eventState: first.columns.eventState,
        backupJobs: first.columns.backupJobs as Array<XcpNgPoolBackupJob>,
      }),
      backupRuns: [success],
      backupJobs: lab.jobs,
    });

    const resolving: Array<JSONObject> = recordsOf(
      second,
      "xcp_ng.backup.failed_vms",
      "web-01, app-02",
    );
    expect(resolving).toHaveLength(1);
    expect(attributes(resolving[0] as JSONObject)).toMatchObject({
      "xcp_ng.backup.status": "success",
      "xcp_ng.backup.job.name": "Nightly delta",
    });
    expect(second.columns.eventState.openBackupFailures).toEqual([]);
  });

  test("an interrupted or skipped run neither opens nor closes an alert", async () => {
    const lab: {
      runs: Array<XcpNgBackupRun>;
      jobs: Array<XcpNgBackupJobInfo>;
    } = await labRuns();
    const output: XcpNgPoolEventsOutput = process({
      backupRuns: lab.runs.filter((run: XcpNgBackupRun) => {
        return run.status === XcpNgBackupStatus.Interrupted;
      }),
      backupJobs: lab.jobs,
    });
    expect(output.columns.eventState.openBackupFailures).toEqual([]);
    expect(
      output.feed.some((line: { type: XcpNgPoolFeedEventType }) => {
        return line.type === XcpNgPoolFeedEventType.XcpNgPoolBackupFailed;
      }),
    ).toBe(false);
  });

  test("each VM's last backup, and the newest success of any run", async () => {
    const lab: {
      runs: Array<XcpNgBackupRun>;
      jobs: Array<XcpNgBackupJobInfo>;
    } = await labRuns();
    const output: XcpNgPoolEventsOutput = process({
      backupRuns: lab.runs.filter((run: XcpNgBackupRun) => {
        return run.jobId === NIGHTLY;
      }),
      backupJobs: lab.jobs,
    });
    const web: Array<{ vmId: string; lastBackupStatus: string }> =
      output.vmBackupUpdates.filter((update: { vmId: string }) => {
        return update.vmId === WEB_01;
      });
    expect(
      web.map((update: { lastBackupStatus: string }) => {
        return update.lastBackupStatus;
      }),
    ).toEqual(["success", "failure"]);
    const failure: (typeof output.vmBackupUpdates)[number] =
      output.vmBackupUpdates.find(
        (update: { vmId: string; lastBackupStatus: string }) => {
          return (
            update.vmId === WEB_01 && update.lastBackupStatus === "failure"
          );
        },
      ) as (typeof output.vmBackupUpdates)[number];
    expect(failure.lastBackupError).toBe(
      "transfer: ENOSPC: no space left on device, write",
    );
    expect(failure.lastSuccessfulBackupAt).toBeNull();
    expect(failure.lastBackupJobName).toBe("Nightly delta");
    expect(
      output.vmBackupUpdates.some((update: { vmId: string }) => {
        return update.vmId === LAB_VM;
      }),
    ).toBe(false);
  });

  test("how often each VM is backed up, and which are overdue", async () => {
    const lab: {
      runs: Array<XcpNgBackupRun>;
      jobs: Array<XcpNgBackupJobInfo>;
    } = await labRuns();
    const output: XcpNgPoolEventsOutput = process({
      backupRuns: lab.runs,
      backupJobs: lab.jobs,
    });
    const intervals: Record<string, number | null> = {};
    for (const update of output.vmIntervalUpdates) {
      intervals[update.vmId] = update.intervalSeconds;
    }
    expect(intervals).toEqual({
      [WEB_01]: 86400,
      [DB_01]: 86400,
      [APP_02]: 86400,
      [WIN_03]: 604800,
    });
    // Their last good backup (R1) is 25 hours old: not yet overdue.
    expect(
      output.derived.vmBackups.map(
        (vm: { vmName: string; overdue: boolean }) => {
          return `${vm.vmName}:${vm.overdue}`;
        },
      ),
    ).toEqual(["web-01:false", "db-01:false", "app-02:false", "win-03:false"]);

    // Six hours later, still no success since: overdue - win-03 has a week.
    const later: XcpNgPoolEventsOutput = process({
      now: new Date(NOW.getTime() + 6 * 3600 * 1000),
      pool: storedPool({
        eventState: output.columns.eventState,
        backupJobs: output.columns.backupJobs as Array<XcpNgPoolBackupJob>,
      }),
      inventory: labInventory().map((entry: XcpNgStoredResource) => {
        const interval: number | null | undefined = intervals[entry.externalId];
        return interval === undefined
          ? entry
          : {
              ...entry,
              backupIntervalSeconds: interval,
              lastSuccessfulBackupAt:
                entry.externalId === WIN_03 ? null : new Date(1794910100000),
            };
      }),
      backupRuns: [],
      backupJobs: lab.jobs,
    });
    expect(
      later.derived.vmBackups.map(
        (vm: { vmName: string; overdue: boolean }) => {
          return `${vm.vmName}:${vm.overdue}`;
        },
      ),
    ).toEqual(["web-01:true", "db-01:true", "app-02:true", "win-03:false"]);
    // Nothing changed: no interval written again.
    expect(later.vmIntervalUpdates).toEqual([]);
  });

  test("a job deleted in Xen Orchestra goes, with its open failures", async () => {
    const lab: {
      runs: Array<XcpNgBackupRun>;
      jobs: Array<XcpNgBackupJobInfo>;
    } = await labRuns();
    const first: XcpNgPoolEventsOutput = process({
      backupRuns: lab.runs,
      backupJobs: lab.jobs,
    });
    expect(first.columns.eventState.openBackupFailures?.length).toBe(2);

    const second: XcpNgPoolEventsOutput = process({
      pool: storedPool({
        eventState: first.columns.eventState,
        backupJobs: first.columns.backupJobs as Array<XcpNgPoolBackupJob>,
      }),
      backupRuns: [],
      backupJobs: lab.jobs.filter((job: XcpNgBackupJobInfo) => {
        return job.jobId !== METADATA;
      }),
    });
    expect(
      (second.columns.backupJobs as Array<XcpNgPoolBackupJob>).map(
        (job: XcpNgPoolBackupJob) => {
          return job.jobId;
        },
      ),
    ).not.toContain(METADATA);
    expect(
      second.columns.eventState.openBackupFailures?.every(
        (open: { jobId: string }) => {
          return open.jobId !== METADATA;
        },
      ),
    ).toBe(true);
  });

  test("jobs not read this time are kept as they were", async () => {
    const lab: {
      runs: Array<XcpNgBackupRun>;
      jobs: Array<XcpNgBackupJobInfo>;
    } = await labRuns();
    const first: XcpNgPoolEventsOutput = process({
      backupRuns: lab.runs,
      backupJobs: lab.jobs,
    });
    const second: XcpNgPoolEventsOutput = process({
      pool: storedPool({
        eventState: first.columns.eventState,
        backupJobs: first.columns.backupJobs as Array<XcpNgPoolBackupJob>,
      }),
      backupRuns: [],
      backupJobs: undefined,
    });
    // Nothing changed: the column is not written.
    expect(second.columns.backupJobs).toBeUndefined();
  });

  test("a run of another pool's VMs alone is not this pool's", () => {
    expect(
      summarizeXcpNgRunForPool({
        run: {
          runId: "r",
          jobId: "j",
          jobName: "j",
          status: XcpNgBackupStatus.Success,
          startedAt: NOW.toISOString(),
          vms: [{ vmId: LAB_VM, status: XcpNgBackupStatus.Success }],
          includedVmIds: [LAB_VM],
          includedPoolIds: [],
        },
        poolVmIds: new Set<string>([WEB_01]),
        vmNames: new Map<string, string>(),
        jobKnownHere: true,
      }),
    ).toBeNull();
  });

  test("a run that failed before any VM is the pool's when its job is known here", () => {
    const run: XcpNgBackupRun = {
      runId: "r",
      jobId: "j",
      jobName: "j",
      status: XcpNgBackupStatus.Failure,
      startedAt: NOW.toISOString(),
      error: "get remote adapter: ENOENT",
      vms: [],
      includedVmIds: [],
      includedPoolIds: [],
    };
    expect(
      summarizeXcpNgRunForPool({
        run: run,
        poolVmIds: new Set<string>([WEB_01]),
        vmNames: new Map<string, string>(),
        jobKnownHere: false,
      }),
    ).toBeNull();
    expect(
      summarizeXcpNgRunForPool({
        run: run,
        poolVmIds: new Set<string>([WEB_01]),
        vmNames: new Map<string, string>(),
        jobKnownHere: true,
      })?.status,
    ).toBe(XcpNgBackupStatus.Failure);
  });

  test("a run-level failure is the pool's even where its VMs succeeded", () => {
    expect(
      summarizeXcpNgRunForPool({
        run: {
          runId: "r",
          jobId: "j",
          jobName: "j",
          status: XcpNgBackupStatus.Failure,
          startedAt: NOW.toISOString(),
          error: "get SR record: SR_NOT_FOUND",
          vms: [{ vmId: WEB_01, status: XcpNgBackupStatus.Success }],
          includedVmIds: [WEB_01],
          includedPoolIds: [],
        },
        poolVmIds: new Set<string>([WEB_01]),
        vmNames: new Map<string, string>(),
        jobKnownHere: false,
      })?.status,
    ).toBe(XcpNgBackupStatus.Failure);
  });

  test("backups are not read straight from XAPI", () => {
    const output: XcpNgPoolEventsOutput = process({
      source: XcpNgEventSource.Xapi,
      backupRuns: [],
    });
    expect(output.columns.backupsReadAt).toBeUndefined();
    expect(output.columns.backupJobs).toBeUndefined();
  });
});

describe("patches", () => {
  test("each of the pool's hosts checked, and the count as a reading", () => {
    const output: XcpNgPoolEventsOutput = process({
      patchesChecked: true,
      hostPatches: [
        {
          hostId: PROD_01,
          patchCount: 3,
          patches: [
            { name: "libsmbclient" },
            { name: "openssh" },
            { name: "xapi-core" },
          ],
        },
        { hostId: PROD_02, patchCount: 0, patches: [] },
        {
          hostId: "6a7b8c9d-0e1f-4a2b-9c3d-4e5f6a7b8c9d",
          patchCount: 1,
          patches: [{ name: "xapi-core" }],
        },
      ],
    });
    expect(output.columns.patchesCheckedAt).toBe(NOW);
    expect(
      output.hostPatchUpdates.map((host: { hostId: string }) => {
        return host.hostId;
      }),
    ).toEqual([PROD_01, PROD_02]);
    expect(output.derived.hostPatches).toEqual([
      { hostId: PROD_01, hostName: "xcp-prod-01", count: 3 },
      { hostId: PROD_02, hostName: "xcp-prod-02", count: 0 },
    ]);
  });

  test("between checks, the stored count keeps the reading going", () => {
    const output: XcpNgPoolEventsOutput = process({
      inventory: labInventory().map((entry: XcpNgStoredResource) => {
        return entry.externalId === PROD_01
          ? { ...entry, missingPatchCount: 3 }
          : entry;
      }),
    });
    expect(output.columns.patchesCheckedAt).toBeUndefined();
    expect(output.derived.hostPatches).toEqual([
      { hostId: PROD_01, hostName: "xcp-prod-01", count: 3 },
    ]);
  });
});

describe("the recorded lab's first minutes, as the probe reads them", () => {
  test("what minute two brings", async () => {
    const xo: FakeXenOrchestraRest = new FakeXenOrchestraRest();
    xo.setNowSeconds(1795000120);
    const messages: Array<XcpNgPoolMessage> = [
      ...readXoMessages(
        await labGet(
          xo,
          `/rest/v0/messages?fields=id,name,time,$object,$pool,body&filter=${encodeURIComponent(
            `$pool:${POOL} time:>=1795000000`,
          )}`,
        ),
      ),
      ...readXoAlarms(
        await labGet(
          xo,
          `/rest/v0/alarms?fields=id,name,time,object,$pool,body&filter=${encodeURIComponent(
            `$pool:${POOL} time:>=1795000000000`,
          )}`,
        ),
      ),
    ];

    const output: XcpNgPoolEventsOutput = process({ messages: messages });
    const alerts: Record<string, number> = {};
    for (const record of output.records) {
      const alert: string = attributes(record)[
        "xcp_ng.message.alert"
      ] as string;
      alerts[alert] = (alerts[alert] || 0) + 1;
    }
    expect(alerts).toEqual({
      [XcpNgMessageAlert.VmCrashed]: 1,
      [XcpNgMessageAlert.HaHostFailed]: 1,
      [XcpNgMessageAlert.PbdPlugFailed]: 1,
      [XcpNgMessageAlert.StorageGcNoSpace]: 1,
      [XcpNgMessageAlert.OtherAlarm]: 5,
      [XcpNgMessageAlert.None]: 1,
    });
    // Everything but the VM started line reaches the feed.
    expect(output.feed).toHaveLength(9);
    expect(output.columns.eventState.openMessages).toHaveLength(9);
  });
});
