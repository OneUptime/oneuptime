import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import { getOpenStackShortHostName } from "../../../Types/OpenStack/OpenStackHealthRules";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import {
  OPENSTACK_EVENT_HOST_ATTRIBUTE,
  OPENSTACK_EVENT_SERVICE_ATTRIBUTE,
  OpenStackEvent,
  OpenStackEventAttribute,
  OpenStackEventOutcome,
} from "../../../Utils/OpenStack/OpenStackNotifications";
import {
  OPENSTACK_CLOUD_LOG_ATTRIBUTE,
  OpenStackLogAttribute,
} from "../../../Utils/OpenStack/OpenStackLogs";
import {
  ChangeEventAttribute,
  ChangeEventSource,
  ChangeEventStatus,
  ChangeEventType,
} from "../../../Utils/Telemetry/ChangeEventFields";
import { ParsedChangeEventEntry } from "../Telemetry/ChangeEventRow";

/*
 * What an OpenStack event becomes: a change event, and a line on the cloud's feed. Pure:
 * OpenStackEventRecorder decides what is written and writes it.
 *
 * The change event says what it is about in three ways, each for what reads it:
 *
 *   - the cloud, as oneuptime.resource.type and .id, so an incident linked to the cloud
 *     sees it as a linked change when OneUptime AI investigates;
 *   - the part, as cloud.resource_id and the labels the part's series carry (`id`,
 *     `hostname`), which is how its charts find their own markers (EventOverlayScope);
 *   - cloud.provider, so its changes are read apart from a project's deploys, as a cloud
 *     account's are: a busy cloud must not crowd a deploy out of an investigation.
 */

// The series label a part's chart is filtered by: see OpenStackMetricQueries.
export const OPENSTACK_CHART_ID_ATTRIBUTE: string = "id";
export const OPENSTACK_CHART_HOST_ATTRIBUTE: string = "hostname";

export const OPENSTACK_CLOUD_PROVIDER: string = "openstack";

// The part a change is about, as the chart markers and its Feed tab read it.
export const OPENSTACK_CHANGE_PART_KIND_ATTRIBUTE: string =
  OpenStackEventAttribute.PartKind;

export interface OpenStackRecordedEvent {
  event: OpenStackEvent;
  // When it happened, which may be the record's own time if it says no time itself.
  time: Date;
  region: string;
  // The service and machine the record says it came from.
  service: string;
  host: string;
}

function statusOf(event: OpenStackEvent): string {
  switch (event.outcome) {
    case OpenStackEventOutcome.Failed:
      return ChangeEventStatus.Failed;
    case OpenStackEventOutcome.Succeeded:
    case OpenStackEventOutcome.Changed:
      return ChangeEventStatus.Succeeded;
    default:
      return "";
  }
}

// One event, as the change event it is recorded as.
export function buildOpenStackChangeEntry(data: {
  recorded: OpenStackRecordedEvent;
  cloudId: ObjectID;
  cloudName: string;
}): ParsedChangeEventEntry {
  const { recorded, cloudId, cloudName } = data;
  const { event } = recorded;
  const attributes: Dictionary<string> = {
    [ChangeEventAttribute.Source]: ChangeEventSource.OpenStack,
    [ChangeEventAttribute.ResourceType]: ServiceType.OpenStackCloud,
    [ChangeEventAttribute.ResourceId]: cloudId.toString(),
    [ChangeEventAttribute.CloudProvider]: OPENSTACK_CLOUD_PROVIDER,
    [ChangeEventAttribute.CloudOperation]: event.type,
    // As a chart of the cloud is filtered, whichever spelling it uses.
    "openstack.cloud.name": cloudName,
    [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: cloudName,
    [OpenStackEventAttribute.Type]: event.type,
    [OpenStackEventAttribute.Outcome]: event.outcome,
  };

  const set: (key: string, value: string) => void = (
    key: string,
    value: string,
  ): void => {
    if (value) {
      attributes[key] = value;
    }
  };

  set(ChangeEventAttribute.Status, statusOf(event));
  set(ChangeEventAttribute.CloudRegion, recorded.region);
  set(ChangeEventAttribute.CloudActor, event.userId);
  set(ChangeEventAttribute.CloudEventId, event.messageId);
  set(OpenStackEventAttribute.Reason, event.reason);
  set(OpenStackEventAttribute.Exception, event.exception);
  set(OpenStackLogAttribute.RequestId, event.requestId);
  set(OpenStackLogAttribute.ProjectId, event.projectId);
  set(OpenStackLogAttribute.InstanceId, event.instanceId);
  set(
    OPENSTACK_EVENT_SERVICE_ATTRIBUTE,
    (event.part && event.part.binary) ||
      event.publisherService ||
      recorded.service,
  );

  const host: string = event.host || recorded.host;

  set(OPENSTACK_EVENT_HOST_ATTRIBUTE, getOpenStackShortHostName(host));
  /*
   * A hypervisor's charts are filtered by Nova's name for it, which is its full name when
   * an instance says so, and a service's by the short one its own events say.
   */
  set(OPENSTACK_CHART_HOST_ATTRIBUTE, event.hypervisor || host);

  if (event.part) {
    set(OpenStackEventAttribute.PartKind, event.part.kind);
    set(OpenStackEventAttribute.PartId, event.part.id);
    set(OpenStackEventAttribute.PartName, event.part.name);
    set(ChangeEventAttribute.CloudResourceId, event.part.id);
    set(ChangeEventAttribute.CloudResourceName, event.part.name);
    set(OPENSTACK_CHART_ID_ATTRIBUTE, event.part.id);
  }

  return {
    time: recorded.time,
    eventType: ChangeEventType.OpenStackEvent,
    title: event.title,
    description: event.reason,
    attributes,
  };
}

// One event, as its line on the cloud's feed.
export function buildOpenStackFeedLine(
  recorded: OpenStackRecordedEvent,
): MarkdownText {
  const { event } = recorded;
  const mark: string =
    event.outcome === OpenStackEventOutcome.Failed ? "❌" : "🔔";
  const who: MarkdownText = event.userId
    ? mdText` by ${FeedMarkdown.code(event.userId)}`
    : mdText``;

  return mdText`${FeedMarkdown.asMarkdown(mark)} ${event.title}${who} (${FeedMarkdown.code(event.type)})`;
}

// When more happened in one batch than a feed should say line by line.
export function buildOpenStackFeedSummaryLine(count: number): MarkdownText {
  return mdText`🔔 ${count} more OpenStack events in the same moment. The cloud's Logs page has every one.`;
}

/*
 * The most of them a feed shows, the failures first, and how many that leaves out. Feed
 * lines are rows in Postgres, and a busy cloud boots an instance a second: its charts and
 * OneUptime AI read every change, from ClickHouse, and this keeps the feed a thing to read.
 */
export function chooseOpenStackFeedEvents(
  events: Array<OpenStackRecordedEvent>,
  limit: number,
): { chosen: Array<OpenStackRecordedEvent>; leftOut: number } {
  const failed: Array<OpenStackRecordedEvent> = events.filter(
    (recorded: OpenStackRecordedEvent): boolean => {
      return recorded.event.outcome === OpenStackEventOutcome.Failed;
    },
  );
  const others: Array<OpenStackRecordedEvent> = events.filter(
    (recorded: OpenStackRecordedEvent): boolean => {
      return recorded.event.outcome !== OpenStackEventOutcome.Failed;
    },
  );
  const chosen: Array<OpenStackRecordedEvent> = [...failed, ...others]
    .slice(0, Math.max(0, limit))
    .sort((a: OpenStackRecordedEvent, b: OpenStackRecordedEvent): number => {
      return a.time.getTime() - b.time.getTime();
    });

  return { chosen, leftOut: Math.max(0, events.length - chosen.length) };
}
