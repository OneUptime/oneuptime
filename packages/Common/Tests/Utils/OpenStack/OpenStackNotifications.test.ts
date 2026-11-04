import { describe, expect, test } from "@jest/globals";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import {
  OPENSTACK_MAX_EVENT_REASON_LENGTH,
  OPENSTACK_PROBE_ACTION_MESSAGE_PREFIX,
  OpenStackEvent,
  OpenStackEventFailure,
  OpenStackEventImportance,
  OpenStackEventOutcome,
  readOpenStackNotification,
  readOpenStackNotificationTime,
} from "../../../Utils/OpenStack/OpenStackNotifications";
import { generatedTexts } from "../../Helpers/GeneratedTexts";

/*
 * What a notification says happened.
 *
 * HAND-WRITTEN FIXTURES, from Nova's versioned notification samples and oslo.messaging's log
 * driver. OpenStackRecordedLogs.test.ts reads what the services really sent.
 */

const INSTANCE: string = "1cd8b1e6-41ab-4e40-a4c6-b8b1a7d1f9f0";
const REQUEST: string = "req-2d6c83a1-8d7d-4f53-a5a2-5cf0f9a5e0c1";
const USER: string = "0123456789abcdef0123456789abcdef";
const PROJECT: string = "fedcba9876543210fedcba9876543210";

function notification(
  eventType: string,
  fields: Record<string, unknown> = {},
  more: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    message_id: "6d3e8f6b-9f4a-4d3d-9a6b-1f1b2a3c4d5e",
    publisher_id: "nova-compute:compute-01",
    event_type: eventType,
    priority: "INFO",
    timestamp: "2026-10-30 10:00:00.654321",
    payload: { "nova_object.data": fields },
    ...more,
  };
}

function eventOf(message: unknown): OpenStackEvent {
  const event: OpenStackEvent | null = readOpenStackNotification({ message });

  expect(event).not.toBeNull();

  return event as OpenStackEvent;
}

const INSTANCE_FIELDS: Record<string, unknown> = {
  uuid: INSTANCE,
  display_name: "web-1",
  host: "compute-01",
  node: "compute-01.example.internal",
  state: "active",
  tenant_id: PROJECT,
  user_id: USER,
  request_id: REQUEST,
  action_initiator_user: USER,
  action_initiator_project: PROJECT,
};

describe("the time a notification says", () => {
  test("is UTC, as oslo.messaging writes it with no zone", () => {
    expect(
      readOpenStackNotificationTime(
        "2026-10-30 10:00:00.654321",
      )?.toISOString(),
    ).toBe("2026-10-30T10:00:00.654Z");
  });

  test.each([
    ["2026-10-30T10:00:00Z", "2026-10-30T10:00:00.000Z"],
    ["2026-10-30T10:00:00.000000", "2026-10-30T10:00:00.000Z"],
    ["2026-10-30T10:00:00+02:00", "2026-10-30T08:00:00.000Z"],
    ["2026-10-30T10:00:00-02:00", "2026-10-30T12:00:00.000Z"],
  ])("%s is %s", (text: string, iso: string) => {
    expect(readOpenStackNotificationTime(text)?.toISOString()).toBe(iso);
  });

  test.each([
    [""],
    ["not a time"],
    [12],
    [null],
    [undefined],
    [{}],
    ["2026".repeat(40)],
  ])("%j is none", (value: unknown) => {
    expect(readOpenStackNotificationTime(value)).toBeNull();
  });
});

describe("what is not a notification", () => {
  test.each([
    [null],
    [undefined],
    ["text"],
    [[]],
    [{}],
    [{ event_type: "x" }],
    [{ event_type: "", payload: {} }],
    [{ event_type: "x", payload: "text" }],
    [{ event_type: 12, payload: {} }],
  ])("%j", (message: unknown) => {
    expect(readOpenStackNotification({ message })).toBeNull();
  });
});

describe("Nova's versioned notifications", () => {
  test("instance create, with everything a feed and a suspect need", () => {
    const event: OpenStackEvent = eventOf(
      notification("instance.create.end", INSTANCE_FIELDS),
    );

    expect(event.type).toBe("instance.create.end");
    expect(event.outcome).toBe(OpenStackEventOutcome.Succeeded);
    expect(event.importance).toBe(OpenStackEventImportance.Change);
    expect(event.part).toEqual({
      kind: OpenStackResourceKind.Instance,
      id: INSTANCE,
      name: "web-1",
      binary: "",
    });
    expect(event.title).toBe("Instance web-1: created");
    expect(event.requestId).toBe(REQUEST);
    expect(event.userId).toBe(USER);
    expect(event.projectId).toBe(PROJECT);
    expect(event.instanceId).toBe(INSTANCE);
    expect(event.host).toBe("compute-01");
    expect(event.hypervisor).toBe("compute-01.example.internal");
    expect(event.status).toBe("active");
    expect(event.movesState).toBe(true);
    expect(event.time?.toISOString()).toBe("2026-10-30T10:00:00.654Z");
    expect(event.publisherService).toBe("nova-compute");
    expect(event.publisherHost).toBe("compute-01");
  });

  test("a step on the way is kept to follow a request by, and drawn nowhere", () => {
    const event: OpenStackEvent = eventOf(
      notification("instance.create.start", INSTANCE_FIELDS),
    );

    expect(event.outcome).toBe(OpenStackEventOutcome.Started);
    expect(event.importance).toBe(OpenStackEventImportance.Trail);
    expect(event.movesState).toBe(false);
  });

  test.each([
    ["instance.live_migration_post.end", "Instance web-1: live migrated"],
    ["instance.volume_attach.end", "Instance web-1: volume attached"],
    ["instance.volume_detach.end", "Instance web-1: volume detached"],
    ["instance.power_off.end", "Instance web-1: stopped"],
    ["instance.power_on.end", "Instance web-1: started"],
    ["instance.rebuild.end", "Instance web-1: rebuilt"],
    ["instance.resize_finish.end", "Instance web-1: resize finished"],
    ["instance.evacuate", "Instance web-1: evacuated"],
    ["instance.shelve.end", "Instance web-1: shelved"],
    ["instance.migrate.end", "Instance web-1: migrated"],
    ["instance.delete.end", "Instance web-1: deleted"],
  ])("%s reads %s", (type: string, title: string) => {
    expect(eventOf(notification(type, INSTANCE_FIELDS)).title).toBe(title);
  });

  test("a word it has no word for says the event's own", () => {
    expect(
      eventOf(notification("instance.frobnicate.end", INSTANCE_FIELDS)).title,
    ).toBe("Instance web-1: instance.frobnicate.end");
  });

  test("deleting moves no state: the row goes away instead", () => {
    expect(
      eventOf(notification("instance.delete.end", INSTANCE_FIELDS)).movesState,
    ).toBe(false);
  });

  test("an instance named by nothing but its id", () => {
    expect(
      eventOf(notification("instance.power_off.end", { uuid: INSTANCE })).title,
    ).toBe(`Instance ${INSTANCE}: stopped`);
  });

  test("the line's own context fills what the notification leaves out", () => {
    const event: OpenStackEvent | null = readOpenStackNotification({
      message: notification("instance.power_off.end", { uuid: INSTANCE }),
      requestId: REQUEST,
      userId: USER,
      projectId: PROJECT,
    });

    expect(event?.requestId).toBe(REQUEST);
    expect(event?.userId).toBe(USER);
    expect(event?.projectId).toBe(PROJECT);
  });

  test("a state update moves state only when a state changed", () => {
    expect(
      eventOf(
        notification("instance.update", {
          ...INSTANCE_FIELDS,
          state_update: {
            "nova_object.data": {
              old_state: "building",
              state: "active",
              old_task_state: null,
              new_task_state: null,
            },
          },
        }),
      ).movesState,
    ).toBe(true);
    expect(
      eventOf(
        notification("instance.update", {
          ...INSTANCE_FIELDS,
          state_update: {
            "nova_object.data": {
              old_state: "active",
              state: "active",
              old_task_state: null,
              new_task_state: null,
            },
          },
        }),
      ).movesState,
    ).toBe(false);
  });

  test("instance.update is a step, whatever it changed", () => {
    expect(
      eventOf(notification("instance.update", INSTANCE_FIELDS)).importance,
    ).toBe(OpenStackEventImportance.Trail);
  });
});

describe("what failed, and why", () => {
  test("an action's error, with the reason its fault gives", () => {
    const event: OpenStackEvent = eventOf(
      notification(
        "instance.live_migration_pre.error",
        {
          ...INSTANCE_FIELDS,
          fault: {
            "nova_object.data": {
              exception: "MigrationPreCheckError",
              exception_message: "Migration pre-check error",
            },
          },
        },
        { priority: "ERROR" },
      ),
    );

    expect(event.outcome).toBe(OpenStackEventOutcome.Failed);
    expect(event.importance).toBe(OpenStackEventImportance.Change);
    expect(event.failure).toBe(OpenStackEventFailure.Action);
    expect(event.exception).toBe("MigrationPreCheckError");
    expect(event.reason).toBe("Migration pre-check error");
    expect(event.title).toBe(
      "Instance web-1: live_migration_pre failed: Migration pre-check error",
    );
    expect(event.movesState).toBe(true);
  });

  test("compute.exception", () => {
    const event: OpenStackEvent = eventOf(
      notification(
        "compute.exception",
        {
          uuid: INSTANCE,
          exception: "InstanceNotFound",
          exception_message: "Instance could not be found.",
        },
        { priority: "ERROR" },
      ),
    );

    expect(event.outcome).toBe(OpenStackEventOutcome.Failed);
    expect(event.failure).toBe(OpenStackEventFailure.Action);
    expect(event.reason).toBe("Instance could not be found.");
    expect(event.title).toContain("compute failed");
    expect(event.part?.kind).toBe(OpenStackResourceKind.Instance);
  });

  test("the scheduling failure Nova's documentation names", () => {
    const event: OpenStackEvent = eventOf(
      notification(
        "scheduler.select_destinations.error",
        {
          exception: "NoValidHost",
          exception_message: "No valid host was found.",
        },
        { priority: "ERROR" },
      ),
    );

    expect(event.failure).toBe(OpenStackEventFailure.Scheduling);
    expect(event.importance).toBe(OpenStackEventImportance.Change);
  });

  test("and the one it really sends, a compute task's error holding NoValidHost", () => {
    const event: OpenStackEvent = eventOf(
      notification(
        "compute_task.build_instances.error",
        {
          instance_uuid: INSTANCE,
          reason: {
            "nova_object.data": {
              exception: "NoValidHost",
              exception_message:
                "No valid host was found. There are not enough hosts available.",
            },
          },
        },
        { priority: "ERROR" },
      ),
    );

    expect(event.failure).toBe(OpenStackEventFailure.Scheduling);
    expect(event.part?.id).toBe(INSTANCE);
    expect(event.reason).toContain("No valid host");
  });

  test("the older form, whose reason is words", () => {
    const event: OpenStackEvent = eventOf({
      event_type: "compute.instance.create.error",
      priority: "ERROR",
      publisher_id: "compute.compute-01",
      payload: { instance_id: INSTANCE, message: "Build of instance aborted" },
    });

    expect(event.outcome).toBe(OpenStackEventOutcome.Failed);
    expect(event.reason).toBe("Build of instance aborted");
    expect(event.part?.id).toBe(INSTANCE);
    expect(event.host).toBe("compute-01");
  });

  test("a priority of error fails it, whatever its name says", () => {
    expect(
      eventOf(
        notification("instance.power_off.end", INSTANCE_FIELDS, {
          priority: "CRITICAL",
        }),
      ).outcome,
    ).toBe(OpenStackEventOutcome.Failed);
  });

  test("a reason is cut to a length a feed can show", () => {
    const event: OpenStackEvent = eventOf(
      notification(
        "instance.create.error",
        {
          ...INSTANCE_FIELDS,
          fault: {
            "nova_object.data": { exception_message: "x".repeat(10000) },
          },
        },
        { priority: "ERROR" },
      ),
    );

    expect(event.reason.length).toBe(OPENSTACK_MAX_EVENT_REASON_LENGTH);
  });
});

describe("a compute service", () => {
  const service: Record<string, unknown> = {
    binary: "nova-compute",
    host: "compute-01",
    disabled: true,
    disabled_reason: "maintenance",
    forced_down: false,
  };

  test("being disabled says so, and why", () => {
    const event: OpenStackEvent = eventOf(
      notification("service.update", service),
    );

    expect(event.part?.kind).toBe(OpenStackResourceKind.Service);
    expect(event.part?.binary).toBe("nova-compute");
    expect(event.title).toBe(
      "Service nova-compute on compute-01: disabled: maintenance",
    );
    expect(event.importance).toBe(OpenStackEventImportance.Change);
    expect(event.movesState).toBe(true);
  });

  test("being enabled", () => {
    expect(
      eventOf(notification("service.update", { ...service, disabled: false }))
        .title,
    ).toBe("Service nova-compute on compute-01: enabled");
  });

  test("being forced down", () => {
    expect(
      eventOf(notification("service.update", { ...service, forced_down: true }))
        .title,
    ).toBe("Service nova-compute on compute-01: forced down");
  });

  test("with no reason", () => {
    expect(
      eventOf(
        notification("service.update", {
          binary: "nova-compute",
          host: "compute-01",
          disabled: true,
        }),
      ).title,
    ).toBe("Service nova-compute on compute-01: disabled");
  });

  test("with no host says nothing of a part", () => {
    expect(
      eventOf(notification("service.update", { binary: "nova-compute" })).part,
    ).toBeNull();
  });
});

describe("Neutron's, Cinder's and Glance's", () => {
  test.each([
    ["network.create.end", "network", OpenStackResourceKind.Network],
    ["subnet.update.end", "subnet", OpenStackResourceKind.Subnet],
    ["router.delete.end", "router", OpenStackResourceKind.Router],
    ["floatingip.create.end", "floatingip", OpenStackResourceKind.FloatingIp],
  ])(
    "%s names its %s",
    (type: string, resource: string, kind: OpenStackResourceKind) => {
      const event: OpenStackEvent = eventOf({
        event_type: type,
        priority: "INFO",
        publisher_id: "network.controller",
        payload: { [resource]: { id: "abc", name: "named" } },
      });

      expect(event.part?.kind).toBe(kind);
      expect(event.part?.id).toBe("abc");
      expect(event.part?.name).toBe("named");
      expect(event.importance).toBe(OpenStackEventImportance.Change);
    },
  );

  test("a delete names its id beside the resource's word", () => {
    expect(
      eventOf({
        event_type: "router.delete.end",
        payload: { router_id: "abc" },
      }).part?.id,
    ).toBe("abc");
  });

  test("a port is a step of what uses it", () => {
    const event: OpenStackEvent = eventOf({
      event_type: "port.update.end",
      payload: { port: { id: "abc" } },
    });

    expect(event.importance).toBe(OpenStackEventImportance.Trail);
    expect(event.part).toBeNull();
  });

  test("a security group rule is kept for its audit trail, and is no part", () => {
    expect(
      eventOf({
        event_type: "security_group_rule.create.end",
        payload: { security_group_rule: { id: "abc" } },
      }).part,
    ).toBeNull();
  });

  test.each([
    ["volume.attach.end", OpenStackResourceKind.Volume, "volume_id", true],
    ["volume.detach.end", OpenStackResourceKind.Volume, "volume_id", true],
    ["volume.create.end", OpenStackResourceKind.Volume, "volume_id", true],
    [
      "snapshot.create.end",
      OpenStackResourceKind.Snapshot,
      "snapshot_id",
      false,
    ],
    ["backup.create.end", OpenStackResourceKind.Backup, "backup_id", false],
  ])(
    "%s",
    (
      type: string,
      kind: OpenStackResourceKind,
      idField: string,
      movesState: boolean,
    ) => {
      const event: OpenStackEvent = eventOf({
        event_type: type,
        priority: "INFO",
        publisher_id: "volume.controller@lvm",
        payload: { [idField]: "abc", display_name: "data", status: "in-use" },
      });

      expect(event.part?.kind).toBe(kind);
      expect(event.part?.id).toBe("abc");
      expect(event.part?.name).toBe("data");
      expect(event.movesState).toBe(movesState);
      expect(event.status).toBe("in-use");
    },
  );

  test("Glance's image, and its publisher's host", () => {
    const event: OpenStackEvent = eventOf({
      event_type: "image.activate",
      priority: "INFO",
      publisher_id: "image.controller",
      payload: { id: "abc", name: "cirros" },
    });

    expect(event.part?.kind).toBe(OpenStackResourceKind.Image);
    expect(event.title).toBe("Image cirros: activated");
    expect(event.movesState).toBe(true);
    expect(event.publisherService).toBe("image");
    expect(event.publisherHost).toBe("controller");
  });

  test("Nova's flavors", () => {
    expect(
      eventOf(notification("flavor.create", { flavorid: "f1", name: "tiny" }))
        .part,
    ).toEqual({
      kind: OpenStackResourceKind.Flavor,
      id: "f1",
      name: "tiny",
      binary: "",
    });
  });

  test("an aggregate is a change with no part", () => {
    const event: OpenStackEvent = eventOf(
      notification("aggregate.add_host.end", { name: "rack-1" }),
    );

    expect(event.part).toBeNull();
    expect(event.importance).toBe(OpenStackEventImportance.Change);
    expect(event.title).toBe("Aggregate rack-1: host added");
  });
});

describe("what says nothing happened", () => {
  test.each([
    "metrics.update",
    "compute.metrics.update",
    "compute.instance.exists",
    "instance.exists",
    "volume.usage",
    "snapshot.exists",
  ])("%s is routine", (type: string) => {
    expect(eventOf({ event_type: type, payload: {} }).importance).toBe(
      OpenStackEventImportance.Routine,
    );
  });

  test("a failure among them is still a failure to hear about", () => {
    expect(
      eventOf({ event_type: "volume.usage", priority: "ERROR", payload: {} })
        .outcome,
    ).toBe(OpenStackEventOutcome.Failed);
  });
});

describe("the older notifications, one level up", () => {
  test("compute.instance.create.end", () => {
    const event: OpenStackEvent = eventOf({
      event_type: "compute.instance.create.end",
      publisher_id: "compute.compute-01",
      payload: {
        instance_id: INSTANCE,
        display_name: "web-1",
        tenant_id: PROJECT,
        user_id: USER,
      },
    });

    expect(event.part?.kind).toBe(OpenStackResourceKind.Instance);
    expect(event.part?.id).toBe(INSTANCE);
    expect(event.title).toBe("Instance web-1: created");
  });
});

describe("a probe's reading of an instance's actions", () => {
  test("reads as the notification it stands in for", () => {
    const event: OpenStackEvent = eventOf(
      notification(
        "instance.reboot.error",
        {
          uuid: INSTANCE,
          display_name: "web-1",
          request_id: REQUEST,
          fault: {
            "nova_object.data": {
              exception_message: "No valid host was found",
            },
          },
        },
        {
          message_id: `${OPENSTACK_PROBE_ACTION_MESSAGE_PREFIX}${INSTANCE}/${REQUEST}/failed`,
          publisher_id: "nova-api",
          priority: "ERROR",
        },
      ),
    );

    expect(event.outcome).toBe(OpenStackEventOutcome.Failed);
    expect(event.failure).toBe(OpenStackEventFailure.Scheduling);
    expect(event.publisherService).toBe("nova-api");
    expect(
      event.messageId.startsWith(OPENSTACK_PROBE_ACTION_MESSAGE_PREFIX),
    ).toBe(true);
  });
});

describe("whatever arrives, nothing throws", () => {
  const VALUES: ReadonlyArray<unknown> = [
    null,
    "text",
    12,
    [],
    {},
    { "nova_object.data": null },
    { "nova_object.data": "text" },
    { id: 12 },
  ];
  const KEYS: ReadonlyArray<string> = [
    "uuid",
    "fault",
    "reason",
    "state_update",
    "host",
    "node",
    "network",
    "id",
    "binary",
    "disabled",
  ];

  test.each(
    generatedTexts(2000, 5740, [
      "instance.",
      "compute.",
      "compute_task.",
      "scheduler.",
      "service.",
      "volume.",
      "image.",
      "network.",
      "x",
      ".",
      "start",
      "end",
      "error",
      "update",
      "exists",
    ]).map((text: string, index: number): [number, string] => {
      return [index, text];
    }),
  )("generated type %i", (index: number, type: string) => {
    const fields: Record<string, unknown> = {};

    KEYS.forEach((key: string, position: number): void => {
      fields[key] = VALUES[(index + position) % VALUES.length];
    });

    const result: OpenStackEvent | null = readOpenStackNotification({
      message: { event_type: type || "x", payload: fields },
    });

    expect(result === null || typeof result.title === "string").toBe(true);
  });
});
