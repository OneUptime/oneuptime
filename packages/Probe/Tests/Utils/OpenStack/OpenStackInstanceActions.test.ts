import { describe, expect, test } from "@jest/globals";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { OpenStackServiceType } from "Common/Types/OpenStack/OpenStackResourceKind";
import {
  OPENSTACK_PROBE_ACTION_MESSAGE_PREFIX,
  OpenStackEvent,
  OpenStackEventFailure,
  OpenStackEventOutcome,
  readOpenStackNotification,
} from "Common/Utils/OpenStack/OpenStackNotifications";
import {
  OpenStackLogAttribute,
  OpenStackLogStamp,
  stampOpenStackLogRecord,
} from "Common/Utils/OpenStack/OpenStackLogs";
import OpenStackCollectorMemory from "../../../Utils/OpenStack/OpenStackCollectorMemory";
import {
  OpenStackHttpRequest,
  OpenStackHttpResponse,
} from "../../../Utils/OpenStack/OpenStackHttp";
import {
  FIRST_READ_LOOKBACK_IN_MS,
  MAX_ACTIONS_READ_PER_SERVER,
  MAX_SERVERS_READ_PER_COLLECTION,
  OpenStackInstanceActionRead,
  buildOpenStackInstanceActionLogs,
  chooseServersToRead,
  readOpenStackInstanceActions,
  toInstanceActionNotification,
  toNovaFailedStep,
  toNovaInstanceAction,
} from "../../../Utils/OpenStack/OpenStackInstanceActions";
import { NovaServerRecord } from "../../../Utils/OpenStack/OpenStackInventory";
import {
  OpenStackKeystoneSession,
  OpenStackToken,
  parseKeystoneToken,
} from "../../../Utils/OpenStack/OpenStackKeystone";
import OpenStackServiceClient from "../../../Utils/OpenStack/OpenStackServiceClient";
import { COLLECTED_AT_MS, FakeClock, createFakeClock } from "./Helpers/CollectorHarness";

/*
 * What Nova says instances went through, for a cloud that cannot turn its notifications on.
 *
 * HAND-WRITTEN FIXTURES of the instance actions API, from Nova's API reference. What a real Nova
 * answered, on each release, is held in the rig's recording, which
 * packages/Common/Tests/Utils/OpenStack/OpenStackRecordedLogs.test.ts reads.
 */

const INSTANCE: string = "1cd8b1e6-41ab-4e40-a4c6-b8b1a7d1f9f0";
const STATE_KEY: string = "credential/RegionOne/instances/actions";

const NOW: string = new Date(COLLECTED_AT_MS).toISOString();

function server(overrides: Partial<NovaServerRecord> = {}): NovaServerRecord {
  return {
    id: INSTANCE,
    name: "web-1",
    status: "ACTIVE",
    tenantId: "project-1",
    userId: "user-1",
    accessIpv4: null,
    accessIpv6: null,
    hostId: null,
    hypervisorHostname: "compute-01.example.internal",
    availabilityZone: null,
    flavorId: null,
    flavorName: null,
    instanceName: null,
    taskState: null,
    updatedAt: NOW,
    faultMessage: null,
    ...overrides,
  };
}

function action(overrides: JSONObject = {}): JSONObject {
  return {
    action: "reboot",
    instance_uuid: INSTANCE,
    message: null,
    project_id: "project-1",
    request_id: "req-1",
    start_time: "2026-11-04T11:49:00.000000",
    updated_at: "2026-11-04T11:49:30.000000",
    user_id: "user-1",
    ...overrides,
  };
}

interface Nova {
  client: OpenStackServiceClient;
  clock: FakeClock;
  memory: OpenStackCollectorMemory;
  requests: Array<OpenStackHttpRequest>;
  answer: (handler: (url: globalThis.URL) => OpenStackHttpResponse) => void;
  read: (
    servers: Array<NovaServerRecord>,
    options?: { canAskForChanges?: boolean; nextCursor?: string | null },
  ) => Promise<OpenStackInstanceActionRead>;
}

function json(body: JSONObject): OpenStackHttpResponse {
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function nova(): Nova {
  const clock: FakeClock = createFakeClock();
  const memory: OpenStackCollectorMemory = new OpenStackCollectorMemory();
  const requests: Array<OpenStackHttpRequest> = [];
  let handler: (url: globalThis.URL) => OpenStackHttpResponse = () => {
    return json({ instanceActions: [] });
  };

  const client: OpenStackServiceClient = new OpenStackServiceClient({
    service: OpenStackServiceType.Compute,
    regionName: "RegionOne",
    baseUrl: "https://nova.example.com/v2.1",
    clock: clock,
    deadlineAt: clock.now() + 24 * 60 * 60_000,
    session: new OpenStackKeystoneSession({
      token: parseKeystoneToken({ tokenId: "t", body: { token: {} } }),
      isFresh: true,
      login: async (): Promise<OpenStackToken> => {
        throw new Error("No login here.");
      },
    }),
    userAgent: "test",
    transport: async (
      request: OpenStackHttpRequest,
    ): Promise<OpenStackHttpResponse> => {
      requests.push(request);
      return handler(new globalThis.URL(request.url));
    },
  });

  return {
    client,
    clock,
    memory,
    requests,
    answer: (next: (url: globalThis.URL) => OpenStackHttpResponse): void => {
      handler = next;
    },
    read: (
      servers: Array<NovaServerRecord>,
      options: { canAskForChanges?: boolean; nextCursor?: string | null } = {},
    ): Promise<OpenStackInstanceActionRead> => {
      return readOpenStackInstanceActions({
        client,
        memory,
        stateKey: STATE_KEY,
        servers,
        canAskForChanges: options.canAskForChanges ?? true,
        nextCursor: options.nextCursor ?? null,
      });
    },
  };
}

function isDetail(url: globalThis.URL): boolean {
  return /\/os-instance-actions\/[^/]+$/.test(url.pathname);
}

describe("an action, read", () => {
  test("holds what it says", () => {
    expect(toNovaInstanceAction(action({ message: "Error" }))).toEqual({
      action: "reboot",
      requestId: "req-1",
      userId: "user-1",
      projectId: "project-1",
      message: "Error",
      startTime: "2026-11-04T11:49:00.000000",
      updatedAt: "2026-11-04T11:49:30.000000",
    });
  });

  test.each([[{}], [{ action: "reboot" }], [{ request_id: "req-1" }]])(
    "%j is none",
    (item: JSONObject) => {
      expect(toNovaInstanceAction(item)).toBeNull();
    },
  );

  test("the step that failed is named, and its traceback never read", () => {
    const step: { event: string | null; details: string | null } | null =
      toNovaFailedStep({
        instanceAction: {
          events: [
            { event: "compute_stop_instance", result: "Success" },
            {
              event: "compute_reboot_instance",
              result: "Error",
              details: "Reboot failed",
              traceback: "Traceback SECRET",
            },
          ],
        },
      });

    expect(step).toEqual({
      event: "compute_reboot_instance",
      details: "Reboot failed",
    });
    expect(JSON.stringify(step)).not.toContain("SECRET");
  });

  test.each([
    [{}],
    [{ instanceAction: "x" }],
    [{ instanceAction: {} }],
    [{ instanceAction: { events: "x" } }],
    [{ instanceAction: { events: [null, "x", [], { result: "Success" }] } }],
  ])("%j has none", (body: JSONObject) => {
    expect(toNovaFailedStep(body)).toBeNull();
  });
});

describe("an action as the notification Nova would have sent", () => {
  test("a failure reads as one, with the reason it gives", () => {
    const message: JSONObject = toInstanceActionNotification({
      server: server(),
      action: toNovaInstanceAction(action({ message: "Error" }))!,
      failedStep: { event: "compute_reboot_instance", details: "Reboot failed" },
      faultMessage: "An older reason",
    });
    const event: OpenStackEvent | null = readOpenStackNotification({ message });

    expect(event?.type).toBe("instance.reboot.error");
    expect(event?.outcome).toBe(OpenStackEventOutcome.Failed);
    expect(event?.failure).toBe(OpenStackEventFailure.Action);
    expect(event?.reason).toBe("Reboot failed");
    expect(event?.part?.id).toBe(INSTANCE);
    expect(event?.part?.name).toBe("web-1");
    expect(event?.requestId).toBe("req-1");
    expect(event?.userId).toBe("user-1");
    expect(event?.projectId).toBe("project-1");
    expect(event?.hypervisor).toBe("compute-01.example.internal");
    expect(event?.title).toBe("Instance web-1: reboot failed: Reboot failed");
    expect(event?.time?.toISOString()).toBe("2026-11-04T11:49:30.000Z");
    expect(event?.messageId.startsWith(OPENSTACK_PROBE_ACTION_MESSAGE_PREFIX)).toBe(
      true,
    );
  });

  test("the instance's fault says why when the step cannot", () => {
    const event: OpenStackEvent | null = readOpenStackNotification({
      message: toInstanceActionNotification({
        server: server(),
        action: toNovaInstanceAction(action({ action: "create", message: "Error" }))!,
        failedStep: null,
        faultMessage: "No valid host was found. There are not enough hosts available.",
      }),
    });

    expect(event?.reason).toContain("No valid host");
    expect(event?.failure).toBe(OpenStackEventFailure.Scheduling);
  });

  test("the step's name, when nothing says why", () => {
    const event: OpenStackEvent | null = readOpenStackNotification({
      message: toInstanceActionNotification({
        server: server(),
        action: toNovaInstanceAction(action({ message: "Error" }))!,
        failedStep: { event: "compute_reboot_instance", details: null },
        faultMessage: null,
      }),
    });

    expect(event?.reason).toBe("Nova's step compute_reboot_instance failed.");
  });

  test.each([
    ["stop", "Instance web-1: stopped"],
    ["start", "Instance web-1: started"],
    ["reboot", "Instance web-1: rebooted"],
    ["rebuild", "Instance web-1: rebuilt"],
    ["resize", "Instance web-1: resized"],
    ["confirmResize", "Instance web-1: resize confirmed"],
    ["revertResize", "Instance web-1: resize reverted"],
    ["migrate", "Instance web-1: migrated"],
    ["live-migration", "Instance web-1: live migrated"],
    ["attach_volume", "Instance web-1: volume attached"],
    ["detach_volume", "Instance web-1: volume detached"],
    ["attach_interface", "Instance web-1: interface attached"],
    ["createImage", "Instance web-1: snapshotted"],
    ["shelveOffload", "Instance web-1: shelved and offloaded"],
    ["create", "Instance web-1: created"],
    ["delete", "Instance web-1: deleted"],
  ])("Nova's word %s reads %s", (word: string, title: string) => {
    const event: OpenStackEvent | null = readOpenStackNotification({
      message: toInstanceActionNotification({
        server: server(),
        action: toNovaInstanceAction(action({ action: word }))!,
        failedStep: null,
        faultMessage: null,
      }),
    });

    expect(event?.title).toBe(title);
    expect(event?.outcome).toBe(OpenStackEventOutcome.Succeeded);
  });

  test("the same action always has the same message ID, so a repeat is known as one", () => {
    const build: () => JSONObject = (): JSONObject => {
      return toInstanceActionNotification({
        server: server(),
        action: toNovaInstanceAction(action())!,
        failedStep: null,
        faultMessage: null,
      });
    };

    expect(build()["message_id"]).toBe(build()["message_id"]);
  });

  test("goes through the ingest's reading as a notification from Nova's API", () => {
    const stamp: OpenStackLogStamp = stampOpenStackLogRecord({
      attributes: {},
      body: JSON.stringify(
        toInstanceActionNotification({
          server: server(),
          action: toNovaInstanceAction(action({ message: "Error" }))!,
          failedStep: null,
          faultMessage: "Boom",
        }),
      ),
      severityNumber: 17,
    });

    expect(stamp.event?.outcome).toBe(OpenStackEventOutcome.Failed);
    expect(stamp.attributes[OpenStackLogAttribute.Service]).toBe("nova-api");
    expect(stamp.attributes[OpenStackLogAttribute.Component]).toBe("nova");
    expect(stamp.attributes[OpenStackLogAttribute.InstanceId]).toBe(INSTANCE);
    expect(stamp.attributes[OpenStackLogAttribute.RequestRootId]).toBe("req-1");
  });
});

describe("which instances are read", () => {
  const SINCE: string = "2026-11-04T11:00:00Z";

  function choose(
    servers: Array<NovaServerRecord>,
    limit: number = 25,
  ): ReturnType<typeof chooseServersToRead> {
    return chooseServersToRead({ servers, since: SINCE, later: [], limit });
  }

  test("those that changed since the last read, and no others", () => {
    const chosen: ReturnType<typeof chooseServersToRead> = choose([
      server({ id: "changed", updatedAt: "2026-11-04T11:30:00Z" }),
      server({ id: "quiet", updatedAt: "2026-11-04T10:30:00Z" }),
      server({ id: "no-time", updatedAt: null }),
    ]);

    expect(
      chosen.toRead.map((entry: { server: NovaServerRecord }): string => {
        return entry.server.id;
      }),
    ).toEqual(["changed"]);
  });

  test("the failed first, then the newest", () => {
    const chosen: ReturnType<typeof chooseServersToRead> = choose([
      server({ id: "older", updatedAt: "2026-11-04T11:10:00Z" }),
      server({ id: "newer", updatedAt: "2026-11-04T11:30:00Z" }),
      server({ id: "failed", status: "ERROR", updatedAt: "2026-11-04T11:05:00Z" }),
    ]);

    expect(
      chosen.toRead.map((entry: { server: NovaServerRecord }): string => {
        return entry.server.id;
      }),
    ).toEqual(["failed", "newer", "older"]);
  });

  test("what the budget leaves waits, from when it was due", () => {
    const chosen: ReturnType<typeof chooseServersToRead> = choose(
      [
        server({ id: "a", updatedAt: "2026-11-04T11:30:00Z" }),
        server({ id: "b", updatedAt: "2026-11-04T11:20:00Z" }),
      ],
      1,
    );

    expect(chosen.toRead).toHaveLength(1);
    expect(chosen.later).toEqual([{ id: "b", since: SINCE }]);
  });

  test("what waited is read next, even if it has not changed since", () => {
    const chosen: ReturnType<typeof chooseServersToRead> = chooseServersToRead({
      servers: [server({ id: "b", updatedAt: "2026-11-04T10:00:00Z" })],
      since: SINCE,
      later: [{ id: "b", since: "2026-11-04T09:00:00Z" }],
      limit: 5,
    });

    expect(chosen.toRead[0]?.since).toBe("2026-11-04T09:00:00Z");
  });

  test("what waited and has since gone is forgotten", () => {
    expect(
      chooseServersToRead({
        servers: [],
        since: SINCE,
        later: [{ id: "gone", since: SINCE }],
        limit: 5,
      }),
    ).toEqual({ toRead: [], later: [] });
  });
});

describe("reading what happened", () => {
  test("a quiet cloud makes no calls at all", async () => {
    const cloud: Nova = nova();
    const read: OpenStackInstanceActionRead = await cloud.read([
      server({ updatedAt: "2026-11-04T08:00:00Z" }),
    ]);

    expect(cloud.requests).toHaveLength(0);
    expect(read.notifications).toEqual([]);
  });

  test("asks only for what changed since the last read, from 2.58", async () => {
    const cloud: Nova = nova();
    const asked: Array<globalThis.URL> = [];

    cloud.answer((url: globalThis.URL): OpenStackHttpResponse => {
      asked.push(url);
      return json({ instanceActions: [action()] });
    });

    await cloud.read([server()]);

    const expected: number = cloud.clock.now() - FIRST_READ_LOOKBACK_IN_MS;

    expect(asked[0]?.pathname).toBe(
      `/v2.1/servers/${INSTANCE}/os-instance-actions`,
    );
    expect(
      Date.parse(asked[0]?.searchParams.get("changes-since") || ""),
    ).toBe(Math.floor(expected / 1000) * 1000);
  });

  test("before 2.58 asks for all of it, and keeps only what is new", async () => {
    const cloud: Nova = nova();
    const asked: Array<globalThis.URL> = [];

    cloud.answer((url: globalThis.URL): OpenStackHttpResponse => {
      asked.push(url);
      return json({
        instanceActions: [
          action({ request_id: "req-new", updated_at: undefined }),
          action({
            request_id: "req-old",
            start_time: "2026-10-01T00:00:00.000000",
            updated_at: undefined,
          }),
        ],
      });
    });

    const read: OpenStackInstanceActionRead = await cloud.read([server()], {
      canAskForChanges: false,
    });

    expect(asked[0]?.searchParams.get("changes-since")).toBeNull();
    expect(read.notifications).toHaveLength(1);
    expect(JSON.stringify(read.notifications[0])).toContain("req-new");
  });

  test("a failure reads the step that failed, and that costs one more call", async () => {
    const cloud: Nova = nova();

    cloud.answer((url: globalThis.URL): OpenStackHttpResponse => {
      return isDetail(url)
        ? json({
            instanceAction: {
              events: [
                {
                  event: "compute_reboot_instance",
                  result: "Error",
                  details: "Reboot failed",
                  traceback: "Traceback SECRET",
                },
              ],
            },
          })
        : json({ instanceActions: [action({ message: "Error" })] });
    });

    const read: OpenStackInstanceActionRead = await cloud.read([server()]);

    expect(cloud.requests).toHaveLength(2);
    expect(read.notifications).toHaveLength(1);
    expect(read.notifications[0]?.["event_type"]).toBe("instance.reboot.error");
    expect(JSON.stringify(read.notifications)).toContain("Reboot failed");
    expect(JSON.stringify(read.notifications)).not.toContain("SECRET");
  });

  test("the instance's fault goes with its newest failure, and no older one", async () => {
    const cloud: Nova = nova();

    cloud.answer((url: globalThis.URL): OpenStackHttpResponse => {
      return isDetail(url)
        ? json({ instanceAction: {} })
        : json({
            instanceActions: [
              action({
                request_id: "req-newer",
                message: "Error",
                updated_at: "2026-11-04T11:49:40.000000",
              }),
              action({
                request_id: "req-older",
                message: "Error",
                updated_at: "2026-11-04T11:49:20.000000",
              }),
            ],
          });
    });

    const read: OpenStackInstanceActionRead = await cloud.read([
      server({ status: "ERROR", faultMessage: "The newest reason" }),
    ]);

    expect(read.notifications).toHaveLength(2);
    // Oldest first, as they happened.
    expect(JSON.stringify(read.notifications[0])).not.toContain(
      "The newest reason",
    );
    expect(JSON.stringify(read.notifications[1])).toContain("The newest reason");
  });

  test("an action still running waits until its instance has no task", async () => {
    const cloud: Nova = nova();

    cloud.answer((): OpenStackHttpResponse => {
      return json({ instanceActions: [action()] });
    });

    const running: OpenStackInstanceActionRead = await cloud.read([
      server({ taskState: "rebooting" }),
    ]);

    expect(running.notifications).toEqual([]);

    const finished: OpenStackInstanceActionRead = await cloud.read([
      server({ taskState: null }),
    ]);

    expect(finished.notifications).toHaveLength(1);
    expect(finished.notifications[0]?.["event_type"]).toBe("instance.reboot.end");
  });

  test("a failure is said even while a task is running", async () => {
    const cloud: Nova = nova();

    cloud.answer((url: globalThis.URL): OpenStackHttpResponse => {
      return isDetail(url)
        ? json({ instanceAction: {} })
        : json({ instanceActions: [action({ message: "Error" })] });
    });

    expect(
      (await cloud.read([server({ taskState: "rebooting" })])).notifications,
    ).toHaveLength(1);
  });

  test("the same action is said once, however often it comes back in the overlap", async () => {
    const cloud: Nova = nova();

    cloud.answer((): OpenStackHttpResponse => {
      return json({ instanceActions: [action()] });
    });

    expect((await cloud.read([server()])).notifications).toHaveLength(1);
    expect((await cloud.read([server()])).notifications).toHaveLength(0);
  });

  test("a failure after it went well is a new thing to say", async () => {
    const cloud: Nova = nova();
    let message: string | null = null;

    cloud.answer((url: globalThis.URL): OpenStackHttpResponse => {
      return isDetail(url)
        ? json({ instanceAction: {} })
        : json({ instanceActions: [action({ message })] });
    });

    await cloud.read([server()]);
    message = "Error";

    const read: OpenStackInstanceActionRead = await cloud.read([server()]);

    expect(read.notifications[0]?.["event_type"]).toBe("instance.reboot.error");
  });

  test("the next read starts where Nova's own clock said", async () => {
    const cloud: Nova = nova();
    const asked: Array<globalThis.URL> = [];

    cloud.answer((url: globalThis.URL): OpenStackHttpResponse => {
      asked.push(url);
      return json({ instanceActions: [] });
    });

    await cloud.read([server()], { nextCursor: "2026-11-04T11:48:00Z" });
    await cloud.read([server({ updatedAt: "2026-11-04T11:49:00Z" })]);

    expect(asked[1]?.searchParams.get("changes-since")).toBe(
      "2026-11-04T11:48:00Z",
    );
  });

  test("only so many of an instance's actions, the newest", async () => {
    const cloud: Nova = nova();

    cloud.answer((): OpenStackHttpResponse => {
      const many: JSONArray = Array.from(
        { length: MAX_ACTIONS_READ_PER_SERVER + 5 },
        (_unused: unknown, index: number): JSONObject => {
          return action({
            request_id: `req-${index}`,
            updated_at: `2026-11-04T11:49:${String(index).padStart(2, "0")}.000000`,
          });
        },
      );

      return json({ instanceActions: many });
    });

    const read: OpenStackInstanceActionRead = await cloud.read([server()]);

    expect(read.notifications).toHaveLength(MAX_ACTIONS_READ_PER_SERVER);
    expect(JSON.stringify(read.notifications)).not.toContain('"req-0"');
    expect(JSON.stringify(read.notifications)).toContain(
      `req-${MAX_ACTIONS_READ_PER_SERVER + 4}`,
    );
  });

  test("only so many instances a collection, and the rest next time", async () => {
    const cloud: Nova = nova();
    const many: Array<NovaServerRecord> = Array.from(
      { length: MAX_SERVERS_READ_PER_COLLECTION + 3 },
      (_unused: unknown, index: number): NovaServerRecord => {
        return server({ id: `server-${index}` });
      },
    );

    const first: OpenStackInstanceActionRead = await cloud.read(many);

    expect(first.serversRead).toBe(MAX_SERVERS_READ_PER_COLLECTION);
    expect(first.serversLeftForLater).toBe(3);
    expect(cloud.requests).toHaveLength(MAX_SERVERS_READ_PER_COLLECTION);

    const second: OpenStackInstanceActionRead = await cloud.read(
      many.map((entry: NovaServerRecord): NovaServerRecord => {
        return { ...entry, updatedAt: "2026-11-04T08:00:00Z" };
      }),
    );

    expect(second.serversRead).toBe(3);
    expect(second.serversLeftForLater).toBe(0);
  });
});

describe("what a read can be told", () => {
  test.each([
    [403, "a credential that may not read it"],
    [404, "an instance deleted while reading"],
  ])("%i, %s, is an answer", async (status: number) => {
    const cloud: Nova = nova();

    cloud.answer((): OpenStackHttpResponse => {
      return { status, headers: {}, body: "{}" };
    });

    const read: OpenStackInstanceActionRead = await cloud.read([server()]);

    expect(read.notifications).toEqual([]);
    expect(read.serversLeftForLater).toBe(0);
  });

  test("a step that may not be read still says the action failed", async () => {
    const cloud: Nova = nova();

    cloud.answer((url: globalThis.URL): OpenStackHttpResponse => {
      return isDetail(url)
        ? { status: 403, headers: {}, body: "{}" }
        : json({ instanceActions: [action({ message: "Error" })] });
    });

    const read: OpenStackInstanceActionRead = await cloud.read([
      server({ faultMessage: "Its fault" }),
    ]);

    expect(read.notifications).toHaveLength(1);
    expect(JSON.stringify(read.notifications[0])).toContain("Its fault");
  });

  test("a failing Nova keeps what it read, and the rest wait from where they were due", async () => {
    const cloud: Nova = nova();
    let calls: number = 0;

    cloud.answer((): OpenStackHttpResponse => {
      calls++;
      return calls === 1
        ? json({ instanceActions: [action()] })
        : { status: 500, headers: {}, body: "" };
    });

    const read: OpenStackInstanceActionRead = await cloud.read([
      server({ id: "first", updatedAt: "2026-11-04T11:49:00Z" }),
      server({ id: "second", updatedAt: "2026-11-04T11:48:00Z" }),
      server({ id: "third", updatedAt: "2026-11-04T11:47:00Z" }),
    ]);

    expect(read.notifications).toHaveLength(1);
    expect(read.serversRead).toBe(1);
    expect(read.serversLeftForLater).toBe(2);
  });

  test("an answer that is not a list is no action", async () => {
    const cloud: Nova = nova();

    cloud.answer((): OpenStackHttpResponse => {
      return json({
        instanceActions: [{ nothing: "useful" }, action()],
      });
    });

    expect((await cloud.read([server()])).notifications).toHaveLength(1);
  });
});

describe("as OTLP logs", () => {
  const message: JSONObject = toInstanceActionNotification({
    server: server(),
    action: toNovaInstanceAction(action({ message: "Error" }))!,
    failedStep: null,
    faultMessage: "Boom",
  });

  test("one resource per region, each record's body the notification", () => {
    const logs: JSONArray = buildOpenStackInstanceActionLogs({
      byRegion: [
        { regionName: "RegionOne", notifications: [message] },
        { regionName: "RegionTwo", notifications: [] },
      ],
      scopeVersion: "1.2.3",
      now: COLLECTED_AT_MS,
    });

    expect(logs).toHaveLength(1);

    const resource: JSONObject = logs[0] as JSONObject;
    const scope: JSONObject = (resource["scopeLogs"] as JSONArray)[0] as JSONObject;
    const record: JSONObject = (scope["logRecords"] as JSONArray)[0] as JSONObject;

    expect(
      ((resource["resource"] as JSONObject)["attributes"] as JSONArray)[0],
    ).toEqual({
      key: "openstack.region.name",
      value: { stringValue: "RegionOne" },
    });
    expect(record["severityNumber"]).toBe(17);
    expect(record["severityText"]).toBe("ERROR");
    expect(record["timeUnixNano"]).toBe(
      `${Date.parse("2026-11-04T11:49:30.000Z") * 1_000_000}`,
    );
    expect(JSON.parse((record["body"] as JSONObject)["stringValue"] as string)).toEqual(
      message,
    );
  });

  test("names no cloud: the server says which it is", () => {
    expect(
      JSON.stringify(
        buildOpenStackInstanceActionLogs({
          byRegion: [{ regionName: "RegionOne", notifications: [message] }],
          scopeVersion: "1",
          now: COLLECTED_AT_MS,
        }),
      ),
    ).not.toContain("openstack.cloud.name");
  });

  test("nothing that happened is nothing to send", () => {
    expect(
      buildOpenStackInstanceActionLogs({
        byRegion: [{ regionName: "RegionOne", notifications: [] }],
        scopeVersion: "1",
        now: COLLECTED_AT_MS,
      }),
    ).toEqual([]);
  });

  test("an action with no time goes under the collection's", () => {
    const logs: JSONArray = buildOpenStackInstanceActionLogs({
      byRegion: [
        {
          regionName: "RegionOne",
          notifications: [{ priority: "INFO", timestamp: "" }],
        },
      ],
      scopeVersion: "1",
      now: COLLECTED_AT_MS,
    });

    expect(JSON.stringify(logs)).toContain(`${COLLECTED_AT_MS * 1_000_000}`);
  });
});
