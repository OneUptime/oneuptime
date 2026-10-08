import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import type StatusPageSubscriberServiceType from "Common/Server/Services/StatusPageSubscriberService";
import Email from "Common/Types/Email";
import ObjectID from "Common/Types/ObjectID";
import { withUnsubscribeToken } from "./UnsubscribeLinkFixtures";
import { jest } from "@jest/globals";

/*
 * Shared fixtures for the monitor group cases in the subscriber job tests.
 *
 * On a status page that lets subscribers choose resources, a subscriber
 * picks some of the page's resources, and a resource is one monitor or one
 * monitor group. An event on a monitor reaches the page's subscribers who
 * picked the monitor, or a monitor group that holds it - the lookup every
 * job uses (StatusPageResourceService.findByMonitors) returns both kinds -
 * and not those who picked other resources. Each job is driven with the
 * resources that lookup returns, and decides with the real
 * StatusPageSubscriberService.shouldSendNotification.
 *
 * Each job test mocks the services itself (jest.mock is per file); these are
 * only the data, and the real decision it plugs in.
 */

// Who subscribed to what, on one page.
export enum ResourceFan {
  // Subscribed to every resource on the page.
  Everything = "everything",
  // Picked the event's monitor, listed on the page by itself.
  Monitor = "monitor",
  // Picked a monitor group that holds the event's monitor.
  Group = "group",
  // Picked a monitor group that does not hold it.
  OtherGroup = "other-group",
  // Picked both the event's monitor and the group that holds it.
  MonitorAndGroup = "monitor-and-group",
}

const FAN_ORDER: Array<ResourceFan> = [
  ResourceFan.Everything,
  ResourceFan.Monitor,
  ResourceFan.Group,
  ResourceFan.OtherGroup,
  ResourceFan.MonitorAndGroup,
];

// The last twelve hex digits of a status page id, to derive stable ids from.
function suffixOf(statusPageId: ObjectID): string {
  return statusPageId.toString().toLowerCase().slice(-12);
}

function pageResource(data: {
  prefix: string;
  statusPageId: ObjectID;
  displayName: string;
}): StatusPageResource {
  const resource: StatusPageResource = new StatusPageResource();
  resource._id = `${data.prefix}-0000-4000-8000-${suffixOf(data.statusPageId)}`;
  resource.statusPageId = data.statusPageId;
  resource.displayName = data.displayName;
  return resource;
}

// The event's monitor, listed on the page by itself.
export function monitorResourceOn(statusPageId: ObjectID): StatusPageResource {
  return pageResource({
    prefix: "6a000000",
    statusPageId: statusPageId,
    displayName: "Checkout API",
  });
}

// A monitor group on the page that holds the event's monitor.
export function groupResourceOn(statusPageId: ObjectID): StatusPageResource {
  const resource: StatusPageResource = pageResource({
    prefix: "6b000000",
    statusPageId: statusPageId,
    displayName: "Payments",
  });
  resource.monitorGroupId = new ObjectID(
    "6e000000-0000-4000-8000-000000000001",
  );
  return resource;
}

// A monitor group on the page that does not hold the event's monitor.
export function otherGroupResourceOn(
  statusPageId: ObjectID,
): StatusPageResource {
  const resource: StatusPageResource = pageResource({
    prefix: "6c000000",
    statusPageId: statusPageId,
    displayName: "Search",
  });
  resource.monitorGroupId = new ObjectID(
    "6e000000-0000-4000-8000-000000000002",
  );
  return resource;
}

// The address a fan's email goes to.
export function fanEmail(fan: ResourceFan): string {
  return `${fan}@fans.acme.com`;
}

/*
 * Only what a subscriber's chosen resources hold, as
 * getSubscribersByStatusPage reads them: their ids, and the page each is
 * on - a subscriber is told about an event only through its own page's.
 */
function picked(resource: StatusPageResource): StatusPageResource {
  const choice: StatusPageResource = new StatusPageResource();
  choice._id = resource._id!;
  choice.statusPageId = resource.statusPageId!;
  return choice;
}

/*
 * The fans on a page, with an email address each, as
 * getSubscribersByStatusPage reads them (resources and token included).
 */
export function fansOn(
  statusPageId: ObjectID,
  fans: Array<ResourceFan>,
): Array<StatusPageSubscriber> {
  return fans.map((fan: ResourceFan): StatusPageSubscriber => {
    const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
    subscriber._id = `6d00000${FAN_ORDER.indexOf(fan)}-0000-4000-8000-${suffixOf(statusPageId)}`;
    subscriber.statusPageId = statusPageId;
    subscriber.subscriberEmail = new Email(fanEmail(fan));
    subscriber.isUnsubscribed = false;
    subscriber.isSubscribedToAllResources = fan === ResourceFan.Everything;
    subscriber.isSubscribedToAllEventTypes = true;

    const choices: Record<ResourceFan, Array<StatusPageResource>> = {
      [ResourceFan.Everything]: [],
      [ResourceFan.Monitor]: [monitorResourceOn(statusPageId)],
      [ResourceFan.Group]: [groupResourceOn(statusPageId)],
      [ResourceFan.OtherGroup]: [otherGroupResourceOn(statusPageId)],
      [ResourceFan.MonitorAndGroup]: [
        monitorResourceOn(statusPageId),
        groupResourceOn(statusPageId),
      ],
    };

    subscriber.statusPageResources = choices[fan].map(picked);
    return withUnsubscribeToken(subscriber);
  });
}

// A status page whose subscribers choose the resources they hear about.
export function lettingSubscribersChooseResources(
  page: StatusPage,
): StatusPage {
  page.allowSubscribersToChooseResources = true;
  page.allowSubscribersToChooseEventTypes = false;
  return page;
}

/*
 * The page shows the event's monitor only through a monitor group: what the
 * lookup returns for it, and who is on it.
 */
export function pageShowingTheMonitorThroughAGroup(statusPageId: ObjectID): {
  affectedResources: Array<StatusPageResource>;
  subscribers: Array<StatusPageSubscriber>;
  told: Array<string>;
} {
  return {
    affectedResources: [groupResourceOn(statusPageId)],
    subscribers: fansOn(statusPageId, [
      ResourceFan.Everything,
      ResourceFan.Group,
      ResourceFan.OtherGroup,
    ]),
    told: [ResourceFan.Everything, ResourceFan.Group].map(fanEmail),
  };
}

/*
 * The page lists the event's monitor by itself and through a monitor group
 * that holds it.
 */
export function pageShowingTheMonitorTwice(statusPageId: ObjectID): {
  affectedResources: Array<StatusPageResource>;
  subscribers: Array<StatusPageSubscriber>;
  told: Array<string>;
} {
  return {
    affectedResources: [
      monitorResourceOn(statusPageId),
      groupResourceOn(statusPageId),
    ],
    subscribers: fansOn(statusPageId, FAN_ORDER),
    told: [
      ResourceFan.Everything,
      ResourceFan.Monitor,
      ResourceFan.Group,
      ResourceFan.MonitorAndGroup,
    ].map(fanEmail),
  };
}

/*
 * Makes the job's (mocked) StatusPageSubscriberService.shouldSendNotification
 * decide as the real one does.
 */
export function decideWithTheRealSubscriberPreferences(
  shouldSendNotification: unknown,
): void {
  const real: typeof StatusPageSubscriberServiceType = (
    jest.requireActual(
      "Common/Server/Services/StatusPageSubscriberService",
    ) as { default: typeof StatusPageSubscriberServiceType }
  ).default;

  (shouldSendNotification as jest.Mock).mockImplementation(
    (data: unknown): boolean => {
      return real.shouldSendNotification(
        data as Parameters<typeof real.shouldSendNotification>[0],
      );
    },
  );
}
