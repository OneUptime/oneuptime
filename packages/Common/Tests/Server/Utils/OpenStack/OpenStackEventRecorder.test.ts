import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import OpenStackCloudFeedService from "../../../../Server/Services/OpenStackCloudFeedService";
import OpenStackResourceService, {
  OpenStackStateChange,
} from "../../../../Server/Services/OpenStackResourceService";
import { OpenStackRecordedEvent } from "../../../../Server/Utils/OpenStack/OpenStackEventEntries";
import OpenStackEventRecorder, {
  OPENSTACK_FEED_LINES_PER_BATCH,
  OpenStackEventBufferEntry,
  isNovaInstanceNotification,
  isOpenStackProbeAction,
  toOpenStackStateChanges,
} from "../../../../Server/Utils/OpenStack/OpenStackEventRecorder";
import TelemetryFanInWriter from "../../../../Server/Utils/Telemetry/TelemetryFanInWriter";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { OpenStackResourceKind } from "../../../../Types/OpenStack/OpenStackResourceKind";
import {
  OPENSTACK_PROBE_ACTION_MESSAGE_PREFIX,
  OpenStackEvent,
  readOpenStackNotification,
} from "../../../../Utils/OpenStack/OpenStackNotifications";

/*
 * Where an event goes once its log is stored: change events, a feed that stays readable, and
 * the real time on the inventory. Best effort: nothing here fails a batch of logs.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const CLOUD_ID: ObjectID = ObjectID.generate();
const INSTANCE: string = "1cd8b1e6-41ab-4e40-a4c6-b8b1a7d1f9f0";

function recordedOf(
  eventType: string,
  fields: Record<string, unknown>,
  more: Record<string, unknown> = {},
  time: string = "2026-10-30T10:00:00Z",
): OpenStackRecordedEvent {
  const event: OpenStackEvent | null = readOpenStackNotification({
    message: {
      event_type: eventType,
      message_id: `m-${eventType}-${time}`,
      publisher_id: "nova-compute:compute-01",
      priority: "INFO",
      payload: { "nova_object.data": fields },
      ...more,
    },
  });

  return {
    event: event as OpenStackEvent,
    time: new Date(time),
    region: "RegionOne",
    service: "nova-compute",
    host: "compute-01",
  };
}

const INSTANCE_FIELDS: Record<string, unknown> = {
  uuid: INSTANCE,
  display_name: "web-1",
};

function probeAction(requestId: string = "req-1"): OpenStackRecordedEvent {
  return recordedOf("instance.reboot.error", INSTANCE_FIELDS, {
    priority: "ERROR",
    message_id: `${OPENSTACK_PROBE_ACTION_MESSAGE_PREFIX}${INSTANCE}/${requestId}/failed`,
    publisher_id: "nova-api",
  });
}

function entryOf(
  ...events: Array<OpenStackRecordedEvent>
): OpenStackEventBufferEntry {
  return { cloudName: "production", events };
}

function record(entry: OpenStackEventBufferEntry): Promise<void> {
  return OpenStackEventRecorder.record({
    projectId: PROJECT_ID,
    cloudId: CLOUD_ID,
    entry,
  });
}

describe("what moves a part's state", () => {
  test("the newest of each, at the moment it really happened", () => {
    expect(
      toOpenStackStateChanges([
        recordedOf(
          "instance.power_off.end",
          INSTANCE_FIELDS,
          {},
          "2026-10-30T10:00:00Z",
        ),
        recordedOf(
          "instance.power_on.end",
          INSTANCE_FIELDS,
          {},
          "2026-10-30T10:05:00Z",
        ),
      ]),
    ).toEqual([
      {
        kind: OpenStackResourceKind.Instance,
        externalId: INSTANCE,
        binary: "",
        host: "",
        at: new Date("2026-10-30T10:05:00Z"),
      },
    ]);
  });

  test("whichever order they arrived in", () => {
    const changes: Array<OpenStackStateChange> = toOpenStackStateChanges([
      recordedOf(
        "instance.power_on.end",
        INSTANCE_FIELDS,
        {},
        "2026-10-30T10:05:00Z",
      ),
      recordedOf(
        "instance.power_off.end",
        INSTANCE_FIELDS,
        {},
        "2026-10-30T10:00:00Z",
      ),
    ]);

    expect(changes[0]?.at).toEqual(new Date("2026-10-30T10:05:00Z"));
  });

  test("a compute service is found by its binary and machine, as its row's id holds its region", () => {
    expect(
      toOpenStackStateChanges([
        recordedOf("service.update", {
          binary: "nova-compute",
          host: "compute-01",
          disabled: true,
        }),
      ]),
    ).toEqual([
      {
        kind: OpenStackResourceKind.Service,
        externalId: "",
        binary: "nova-compute",
        host: "compute-01",
        at: new Date("2026-10-30T10:00:00Z"),
      },
    ]);
  });

  test("what moves nothing, moves nothing", () => {
    expect(
      toOpenStackStateChanges([
        recordedOf("instance.create.start", INSTANCE_FIELDS),
        recordedOf("instance.delete.end", INSTANCE_FIELDS),
        recordedOf("aggregate.add_host.end", { name: "x" }),
      ]),
    ).toEqual([]);
  });
});

describe("telling a probe's reading from what Nova said itself", () => {
  test("by its message ID", () => {
    expect(isOpenStackProbeAction(probeAction())).toBe(true);
    expect(
      isOpenStackProbeAction(
        recordedOf("instance.reboot.error", INSTANCE_FIELDS),
      ),
    ).toBe(false);
  });

  test("Nova speaks when an instance's own notification arrives", () => {
    expect(
      isNovaInstanceNotification(
        recordedOf("instance.reboot.end", INSTANCE_FIELDS),
      ),
    ).toBe(true);
    expect(isNovaInstanceNotification(probeAction())).toBe(false);
    // Another service's notifications say nothing about whether Nova's are on.
    expect(
      isNovaInstanceNotification(
        recordedOf("volume.attach.end", { volume_id: "v" }),
      ),
    ).toBe(false);
  });
});

describe("recording a batch", () => {
  let cache: Map<string, string>;
  let submitted: Array<JSONObject>;
  let feedLines: Array<JSONObject>;
  let stateChanges: Array<OpenStackStateChange>;
  let unmatched: Array<OpenStackStateChange>;
  let hourCount: number;
  let hourLimitReached: boolean;

  beforeEach(() => {
    cache = new Map();
    submitted = [];
    feedLines = [];
    stateChanges = [];
    unmatched = [];
    hourCount = 0;
    hourLimitReached = false;

    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockImplementation(
        async (namespace: string, key: string, value: string) => {
          const name: string = `${namespace}/${key}`;

          if (cache.has(name)) {
            return false;
          }

          cache.set(name, value);

          return true;
        },
      );
    jest
      .spyOn(GlobalCache, "setString")
      .mockImplementation(
        async (namespace: string, key: string, value: string) => {
          cache.set(`${namespace}/${key}`, value);
        },
      );
    jest
      .spyOn(GlobalCache, "getString")
      .mockImplementation(async (namespace: string, key: string) => {
        return cache.get(`${namespace}/${key}`) ?? null;
      });
    jest.spyOn(GlobalCache, "getJSONObject").mockImplementation(async () => {
      return null;
    });
    jest.spyOn(GlobalCache, "setJSON").mockImplementation(async () => {});
    jest.spyOn(GlobalCache, "incrementIfBelow").mockImplementation(async () => {
      hourCount++;
      return hourLimitReached ? null : hourCount;
    });
    jest.spyOn(TelemetryFanInWriter, "submit").mockImplementation((async (
      _service: unknown,
      rows: Array<JSONObject>,
    ) => {
      submitted.push(...rows);
      return { flushed: Promise.resolve() };
    }) as never);
    jest
      .spyOn(OpenStackCloudFeedService, "createOpenStackCloudFeedItem")
      .mockImplementation((async (item: JSONObject) => {
        feedLines.push(item);
      }) as never);
    jest
      .spyOn(OpenStackResourceService, "recordStateChanges")
      .mockImplementation((async (data: {
        changes: Array<OpenStackStateChange>;
      }) => {
        stateChanges.push(...data.changes);
        return unmatched;
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("what is worth a marker becomes a change event, a feed line and a real time", async () => {
    await record(
      entryOf(recordedOf("instance.power_off.end", INSTANCE_FIELDS)),
    );

    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.["title"]).toBe("Instance web-1: stopped");
    expect(feedLines).toHaveLength(1);
    expect(stateChanges[0]?.externalId).toBe(INSTANCE);
  });

  test("a step on the way is kept in the logs and goes nowhere else, but can still date a state", async () => {
    await record(
      entryOf(
        recordedOf("instance.update", {
          ...INSTANCE_FIELDS,
          state_update: {
            "nova_object.data": { old_state: "building", state: "active" },
          },
        }),
      ),
    );

    expect(submitted).toHaveLength(0);
    expect(feedLines).toHaveLength(0);
    expect(stateChanges).toHaveLength(1);
  });

  test("a batch run again says its feed lines once", async () => {
    const entry: OpenStackEventBufferEntry = entryOf(
      recordedOf("instance.power_off.end", INSTANCE_FIELDS),
    );

    await record(entry);
    await record(entry);

    expect(feedLines).toHaveLength(1);
  });

  test("a busy batch says the failures, then how many more", async () => {
    const events: Array<OpenStackRecordedEvent> = [];

    for (
      let index: number = 0;
      index < OPENSTACK_FEED_LINES_PER_BATCH + 5;
      index++
    ) {
      events.push(
        recordedOf(
          "instance.power_off.end",
          { ...INSTANCE_FIELDS, display_name: `web-${index}` },
          {},
          new Date(Date.UTC(2026, 9, 30, 10, 0, index)).toISOString(),
        ),
      );
    }

    await record(entryOf(...events));

    // Every one is a change event, and the feed is bounded.
    expect(submitted).toHaveLength(OPENSTACK_FEED_LINES_PER_BATCH + 5);
    expect(feedLines).toHaveLength(OPENSTACK_FEED_LINES_PER_BATCH + 1);
    expect(
      String(feedLines[feedLines.length - 1]?.["feedInfoInMarkdown"]),
    ).toContain("5 more");
  });

  test("an hour that has said enough says no more", async () => {
    hourLimitReached = true;

    await record(
      entryOf(recordedOf("instance.power_off.end", INSTANCE_FIELDS)),
    );

    expect(submitted).toHaveLength(1);
    expect(feedLines).toHaveLength(0);
  });

  test("a part the scrape has not seen waits for it", async () => {
    const setJson: ReturnType<typeof jest.spyOn> = jest.spyOn(
      GlobalCache,
      "setJSON",
    );
    const change: OpenStackStateChange = {
      kind: OpenStackResourceKind.Instance,
      externalId: INSTANCE,
      binary: "",
      host: "",
      at: new Date("2026-10-30T10:00:00Z"),
    };

    unmatched = [change];

    await record(
      entryOf(recordedOf("instance.power_off.end", INSTANCE_FIELDS)),
    );

    expect(setJson).toHaveBeenCalled();
    expect(JSON.stringify(setJson.mock.calls[0])).toContain(INSTANCE);
  });

  describe("a probe's reading of instance actions", () => {
    test("goes through as a notification would, on a cloud with none of its own", async () => {
      await record(entryOf(probeAction()));

      expect(submitted).toHaveLength(1);
      expect(feedLines).toHaveLength(1);
      expect(stateChanges).toHaveLength(1);
    });

    test("is left out once Nova's own notifications have been heard", async () => {
      await record(
        entryOf(recordedOf("instance.reboot.error", INSTANCE_FIELDS)),
      );

      submitted.length = 0;
      feedLines.length = 0;
      stateChanges.length = 0;

      await record(entryOf(probeAction()));

      expect(submitted).toHaveLength(0);
      expect(feedLines).toHaveLength(0);
      expect(stateChanges).toHaveLength(0);
    });

    test("in the same batch as Nova's own, only Nova's goes", async () => {
      await record(
        entryOf(
          recordedOf("instance.reboot.error", INSTANCE_FIELDS),
          probeAction(),
        ),
      );

      expect(submitted).toHaveLength(1);
    });

    test("another service's notifications do not silence it", async () => {
      await record(
        entryOf(recordedOf("volume.attach.end", { volume_id: "v" })),
      );

      submitted.length = 0;

      await record(entryOf(probeAction()));

      expect(submitted).toHaveLength(1);
    });

    test("a repeat after the probe restarts is said once", async () => {
      await record(entryOf(probeAction()));
      await record(entryOf(probeAction()));

      expect(submitted).toHaveLength(1);
    });

    test("two different actions are two things", async () => {
      await record(entryOf(probeAction("req-1"), probeAction("req-2")));

      expect(submitted).toHaveLength(2);
    });

    test("a cache that cannot answer keeps the failure on the feed", async () => {
      jest.spyOn(GlobalCache, "getString").mockImplementation(async () => {
        throw new Error("Cache is not connected");
      });

      await record(entryOf(probeAction()));

      expect(submitted).toHaveLength(1);
    });
  });

  describe("when something behind it fails", () => {
    test("the change events going wrong costs the feed nothing, and throws nothing", async () => {
      jest
        .spyOn(TelemetryFanInWriter, "submit")
        .mockImplementation((async () => {
          throw new Error("ClickHouse is down");
        }) as never);

      await expect(
        record(entryOf(recordedOf("instance.power_off.end", INSTANCE_FIELDS))),
      ).resolves.toBeUndefined();

      expect(feedLines).toHaveLength(1);
      expect(stateChanges).toHaveLength(1);
    });

    test("the feed going wrong costs the state change nothing", async () => {
      jest
        .spyOn(OpenStackCloudFeedService, "createOpenStackCloudFeedItem")
        .mockImplementation((async () => {
          throw new Error("Postgres is down");
        }) as never);

      await expect(
        record(entryOf(recordedOf("instance.power_off.end", INSTANCE_FIELDS))),
      ).resolves.toBeUndefined();

      expect(stateChanges).toHaveLength(1);
    });

    test("nothing to record writes nothing", async () => {
      await record(entryOf());

      expect(submitted).toHaveLength(0);
      expect(feedLines).toHaveLength(0);
      expect(stateChanges).toHaveLength(0);
    });
  });
});
