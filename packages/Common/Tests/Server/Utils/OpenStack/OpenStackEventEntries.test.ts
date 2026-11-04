import { describe, expect, test } from "@jest/globals";
import ObjectID from "../../../../Types/ObjectID";
import { OpenStackResourceKind } from "../../../../Types/OpenStack/OpenStackResourceKind";
import {
  OPENSTACK_CHART_HOST_ATTRIBUTE,
  OPENSTACK_CHART_ID_ATTRIBUTE,
  OPENSTACK_CLOUD_PROVIDER,
  OpenStackRecordedEvent,
  buildOpenStackChangeEntry,
  buildOpenStackFeedLine,
  buildOpenStackFeedSummaryLine,
  chooseOpenStackFeedEvents,
} from "../../../../Server/Utils/OpenStack/OpenStackEventEntries";
import { ParsedChangeEventEntry } from "../../../../Server/Utils/Telemetry/ChangeEventRow";
import {
  OpenStackEvent,
  OpenStackEventAttribute,
  OpenStackEventOutcome,
  readOpenStackNotification,
} from "../../../../Utils/OpenStack/OpenStackNotifications";
import {
  OPENSTACK_CLOUD_LOG_ATTRIBUTE,
  OpenStackLogAttribute,
} from "../../../../Utils/OpenStack/OpenStackLogs";
import {
  ChangeEventAttribute,
  ChangeEventSource,
  ChangeEventStatus,
  ChangeEventType,
} from "../../../../Utils/Telemetry/ChangeEventFields";

/*
 * What an event becomes: a change event, marked on a part's charts and a suspect for OneUptime
 * AI, and a line on the cloud's feed. Pure, and read here by the real reading of a notification.
 */

const INSTANCE: string = "1cd8b1e6-41ab-4e40-a4c6-b8b1a7d1f9f0";
const USER: string = "0123456789abcdef0123456789abcdef";
const CLOUD_ID: ObjectID = ObjectID.generate();

function recordedOf(
  eventType: string,
  fields: Record<string, unknown>,
  more: Record<string, unknown> = {},
): OpenStackRecordedEvent {
  const event: OpenStackEvent | null = readOpenStackNotification({
    message: {
      event_type: eventType,
      message_id: "m-1",
      publisher_id: "nova-compute:compute-01",
      priority: "INFO",
      timestamp: "2026-10-30 10:00:00.000000",
      payload: { "nova_object.data": fields },
      ...more,
    },
  });

  expect(event).not.toBeNull();

  return {
    event: event as OpenStackEvent,
    time: new Date("2026-10-30T10:00:00Z"),
    region: "RegionOne",
    service: "nova-compute",
    host: "compute-01",
  };
}

function entryOf(recorded: OpenStackRecordedEvent): ParsedChangeEventEntry {
  return buildOpenStackChangeEntry({
    recorded,
    cloudId: CLOUD_ID,
    cloudName: "production",
  });
}

const INSTANCE_FIELDS: Record<string, unknown> = {
  uuid: INSTANCE,
  display_name: "web-1",
  host: "compute-01",
  node: "compute-01.example.internal",
  action_initiator_user: USER,
  action_initiator_project: "project-id",
  request_id: "req-1",
};

describe("an event as a change event", () => {
  const recorded: OpenStackRecordedEvent = recordedOf(
    "instance.live_migration_post.end",
    INSTANCE_FIELDS,
  );
  const entry: ParsedChangeEventEntry = entryOf(recorded);

  test("is the kind of change it is, when it really happened", () => {
    expect(entry.eventType).toBe(ChangeEventType.OpenStackEvent);
    expect(entry.time).toEqual(new Date("2026-10-30T10:00:00Z"));
    expect(entry.title).toBe("Instance web-1: live migrated");
  });

  test("says it is about the cloud, so an incident linked to the cloud sees it", () => {
    expect(entry.attributes[ChangeEventAttribute.ResourceType]).toBe(
      "OpenStackCloud",
    );
    expect(entry.attributes[ChangeEventAttribute.ResourceId]).toBe(
      CLOUD_ID.toString(),
    );
    expect(entry.attributes[ChangeEventAttribute.Source]).toBe(
      ChangeEventSource.OpenStack,
    );
  });

  test("is read apart from a project's deploys", () => {
    expect(entry.attributes[ChangeEventAttribute.CloudProvider]).toBe(
      OPENSTACK_CLOUD_PROVIDER,
    );
  });

  test("names the part, by the labels its charts are filtered by", () => {
    expect(entry.attributes[ChangeEventAttribute.CloudResourceId]).toBe(
      INSTANCE,
    );
    expect(entry.attributes[OPENSTACK_CHART_ID_ATTRIBUTE]).toBe(INSTANCE);
    expect(entry.attributes[OPENSTACK_CHART_HOST_ATTRIBUTE]).toBe(
      "compute-01.example.internal",
    );
    expect(entry.attributes[OpenStackEventAttribute.PartKind]).toBe(
      OpenStackResourceKind.Instance,
    );
    expect(entry.attributes[ChangeEventAttribute.CloudResourceName]).toBe(
      "web-1",
    );
  });

  test("names the cloud both ways a chart of it can be filtered", () => {
    expect(entry.attributes["openstack.cloud.name"]).toBe("production");
    expect(entry.attributes[OPENSTACK_CLOUD_LOG_ATTRIBUTE]).toBe("production");
    expect(entry.attributes[ChangeEventAttribute.CloudRegion]).toBe(
      "RegionOne",
    );
  });

  test("says who, and in which request", () => {
    expect(entry.attributes[ChangeEventAttribute.CloudActor]).toBe(USER);
    expect(entry.attributes[OpenStackLogAttribute.RequestId]).toBe("req-1");
    expect(entry.attributes[OpenStackLogAttribute.InstanceId]).toBe(INSTANCE);
    expect(entry.attributes[ChangeEventAttribute.CloudEventId]).toBe("m-1");
  });

  test("names the machine by its short name, for its Feed tab", () => {
    expect(entry.attributes[OpenStackLogAttribute.Host]).toBe("compute-01");
  });

  test("what succeeded and what failed each say so", () => {
    expect(entry.attributes[ChangeEventAttribute.Status]).toBe(
      ChangeEventStatus.Succeeded,
    );

    const failed: ParsedChangeEventEntry = entryOf(
      recordedOf(
        "instance.create.error",
        {
          ...INSTANCE_FIELDS,
          fault: {
            "nova_object.data": {
              exception: "BuildAbortException",
              exception_message: "Build aborted",
            },
          },
        },
        { priority: "ERROR" },
      ),
    );

    expect(failed.attributes[ChangeEventAttribute.Status]).toBe(
      ChangeEventStatus.Failed,
    );
    expect(failed.description).toBe("Build aborted");
    expect(failed.attributes[OpenStackEventAttribute.Exception]).toBe(
      "BuildAbortException",
    );
  });

  test("a compute service's says which, on which machine", () => {
    const service: ParsedChangeEventEntry = entryOf(
      recordedOf("service.update", {
        binary: "nova-compute",
        host: "compute-01",
        disabled: true,
      }),
    );

    expect(service.attributes[OpenStackLogAttribute.Service]).toBe(
      "nova-compute",
    );
    expect(service.attributes[OpenStackLogAttribute.Host]).toBe("compute-01");
    expect(service.attributes[OPENSTACK_CHART_HOST_ATTRIBUTE]).toBe(
      "compute-01",
    );
  });

  test("an empty value is left out rather than stored", () => {
    const quiet: ParsedChangeEventEntry = entryOf(
      recordedOf(
        "aggregate.add_host.end",
        { name: "rack-1" },
        {
          publisher_id: "nova-api",
          message_id: "",
        },
      ),
    );

    for (const value of Object.values(quiet.attributes)) {
      expect(value).not.toBe("");
    }
  });

  test("what the record said wrote the machine, when the notification does not", () => {
    const noHost: OpenStackRecordedEvent = {
      ...recordedOf("volume.attach.end", {}, { publisher_id: "cinder" }),
      service: "cinder-volume",
      host: "storage-01",
    };

    expect(entryOf(noHost).attributes[OpenStackLogAttribute.Host]).toBe(
      "storage-01",
    );
  });
});

describe("an event as a line on the feed", () => {
  test("says what, who and which event", () => {
    const line: string = buildOpenStackFeedLine(
      recordedOf("instance.power_off.end", INSTANCE_FIELDS),
    ).toString();

    expect(line).toContain("Instance web-1: stopped");
    expect(line).toContain(USER);
    expect(line).toContain("instance.power_off.end");
    expect(line).toContain("🔔");
  });

  test("a failure stands out", () => {
    expect(
      buildOpenStackFeedLine(
        recordedOf("instance.create.error", INSTANCE_FIELDS, {
          priority: "ERROR",
        }),
      ).toString(),
    ).toContain("❌");
  });

  test("a name anyone can set cannot write Markdown into the feed", () => {
    const line: string = buildOpenStackFeedLine(
      recordedOf("instance.power_off.end", {
        uuid: INSTANCE,
        display_name: "[click](https://example.com) **bold** <img src=x>",
      }),
    ).toString();

    expect(line).not.toContain("[click](https://example.com)");
    expect(line).not.toContain("**bold**");
  });

  test("what a batch left out is counted", () => {
    expect(buildOpenStackFeedSummaryLine(12).toString()).toContain("12");
  });
});

describe("which events a feed shows", () => {
  function at(
    minute: number,
    outcome: OpenStackEventOutcome,
  ): OpenStackRecordedEvent {
    const recorded: OpenStackRecordedEvent = recordedOf(
      "instance.power_off.end",
      INSTANCE_FIELDS,
    );

    return {
      ...recorded,
      event: { ...recorded.event, outcome },
      time: new Date(Date.UTC(2026, 9, 30, 10, minute)),
    };
  }

  test("all of them, in order, when they fit", () => {
    const chosen: { chosen: Array<OpenStackRecordedEvent>; leftOut: number } =
      chooseOpenStackFeedEvents(
        [
          at(2, OpenStackEventOutcome.Succeeded),
          at(1, OpenStackEventOutcome.Succeeded),
        ],
        5,
      );

    expect(chosen.leftOut).toBe(0);
    expect(chosen.chosen[0]?.time.getUTCMinutes()).toBe(1);
  });

  test("the failures first when they do not", () => {
    const chosen: { chosen: Array<OpenStackRecordedEvent>; leftOut: number } =
      chooseOpenStackFeedEvents(
        [
          at(1, OpenStackEventOutcome.Succeeded),
          at(2, OpenStackEventOutcome.Succeeded),
          at(3, OpenStackEventOutcome.Failed),
          at(4, OpenStackEventOutcome.Failed),
        ],
        2,
      );

    expect(chosen.leftOut).toBe(2);
    expect(
      chosen.chosen.every((recorded: OpenStackRecordedEvent): boolean => {
        return recorded.event.outcome === OpenStackEventOutcome.Failed;
      }),
    ).toBe(true);
  });

  test("a limit below nothing is nothing", () => {
    expect(
      chooseOpenStackFeedEvents([at(1, OpenStackEventOutcome.Succeeded)], -1)
        .chosen,
    ).toEqual([]);
  });
});
