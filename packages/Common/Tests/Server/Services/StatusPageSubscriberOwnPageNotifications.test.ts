import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import StatusPageEventType from "../../../Types/StatusPage/StatusPageEventType";
import { afterEach, describe, expect, test } from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * A SUBSCRIBER IS TOLD ABOUT AN EVENT ONLY THROUGH RESOURCES OF ITS OWN
 * STATUS PAGE.
 *
 * A subscription names resources of its own page: every write of one is
 * held to that now (StatusPageSubscriberResources). One saved before that
 * check may still name another page's resource; it is left as it is, and
 * is told nothing through it. The subscriber jobs read each picked
 * resource with its page (getSubscribersByStatusPage), and a pick counts
 * only when it is known to be on the page being sent for - one read
 * without its page does not. Every sender hands over the event's resources
 * on that page, so those are matched as they are.
 */

const PAGE_ID: ObjectID = new ObjectID("8a000000-0000-4000-8000-000000000001");
const OTHER_PAGE_ID: ObjectID = new ObjectID(
  "8a000000-0000-4000-8000-000000000002",
);

const OWN_RESOURCE: string = "8b000000-0000-4000-8000-000000000001";
const OTHER_PAGE_RESOURCE: string = "8b000000-0000-4000-8000-000000000002";

function resource(
  id: string,
  statusPageId: ObjectID | null,
): StatusPageResource {
  const row: StatusPageResource = new StatusPageResource();
  row._id = id;

  if (statusPageId) {
    row.statusPageId = statusPageId;
  }

  return row;
}

function pageLettingSubscribersChoose(): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = PAGE_ID.toString();
  page.allowSubscribersToChooseResources = true;
  page.allowSubscribersToChooseEventTypes = false;
  return page;
}

function subscriberPicking(
  picked: Array<StatusPageResource>,
): StatusPageSubscriber {
  const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
  subscriber._id = "8c000000-0000-4000-8000-000000000001";
  subscriber.statusPageId = PAGE_ID;
  subscriber.isUnsubscribed = false;
  subscriber.isSubscribedToAllResources = false;
  subscriber.isSubscribedToAllEventTypes = true;
  subscriber.statusPageResources = picked;
  return subscriber;
}

function isTold(data: {
  subscriber: StatusPageSubscriber;
  eventResources: Array<StatusPageResource>;
  eventType?: StatusPageEventType | undefined;
}): boolean {
  return StatusPageSubscriberService.shouldSendNotification({
    subscriber: data.subscriber,
    statusPageResources: data.eventResources,
    statusPage: pageLettingSubscribersChoose(),
    eventType: data.eventType || StatusPageEventType.Incident,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("StatusPageSubscriberService.shouldSendNotification - own page only", () => {
  test("tells a subscriber about an event on a resource of its page it picked", () => {
    expect(
      isTold({
        subscriber: subscriberPicking([resource(OWN_RESOURCE, PAGE_ID)]),
        eventResources: [resource(OWN_RESOURCE, PAGE_ID)],
      }),
    ).toBe(true);
  });

  test("tells a subscription naming another page's resource nothing through it", () => {
    /*
     * Even were a sender to hand over that page's resource with this page's
     * subscribers: neither side counts it.
     */
    expect(
      isTold({
        subscriber: subscriberPicking([
          resource(OTHER_PAGE_RESOURCE, OTHER_PAGE_ID),
        ]),
        eventResources: [resource(OTHER_PAGE_RESOURCE, OTHER_PAGE_ID)],
      }),
    ).toBe(false);
  });

  test("does not count a pick read without its page, whatever the event's side says", () => {
    expect(
      isTold({
        subscriber: subscriberPicking([resource(OTHER_PAGE_RESOURCE, null)]),
        eventResources: [resource(OTHER_PAGE_RESOURCE, OTHER_PAGE_ID)],
      }),
    ).toBe(false);
  });

  test("does not count another page's resource on the subscriber's side either", () => {
    expect(
      isTold({
        subscriber: subscriberPicking([
          resource(OTHER_PAGE_RESOURCE, OTHER_PAGE_ID),
        ]),
        eventResources: [resource(OTHER_PAGE_RESOURCE, null)],
      }),
    ).toBe(false);
  });

  test("a subscription that also names its own page's resource is told through that one", () => {
    expect(
      isTold({
        subscriber: subscriberPicking([
          resource(OTHER_PAGE_RESOURCE, OTHER_PAGE_ID),
          resource(OWN_RESOURCE, PAGE_ID),
        ]),
        eventResources: [
          resource(OTHER_PAGE_RESOURCE, OTHER_PAGE_ID),
          resource(OWN_RESOURCE, PAGE_ID),
        ],
      }),
    ).toBe(true);
  });

  test("does not count a pick read without its page: it is not known to be on this one", () => {
    expect(
      isTold({
        subscriber: subscriberPicking([resource(OWN_RESOURCE, null)]),
        eventResources: [resource(OWN_RESOURCE, null)],
      }),
    ).toBe(false);

    expect(
      isTold({
        subscriber: subscriberPicking([resource(OWN_RESOURCE, null)]),
        eventResources: [resource(OWN_RESOURCE, PAGE_ID)],
      }),
    ).toBe(false);
  });

  test("matches a pick of this page against the event's resources as the sender hands them over", () => {
    // The senders hand over the event's resources on the page being sent for.
    expect(
      isTold({
        subscriber: subscriberPicking([resource(OWN_RESOURCE, PAGE_ID)]),
        eventResources: [resource(OWN_RESOURCE, null)],
      }),
    ).toBe(true);
  });

  test("tells a subscriber nothing through its picks for a page sent without its id", () => {
    const page: StatusPage = pageLettingSubscribersChoose();
    delete (page as unknown as JSONObject)["_id"];

    expect(
      StatusPageSubscriberService.shouldSendNotification({
        subscriber: subscriberPicking([resource(OWN_RESOURCE, PAGE_ID)]),
        statusPageResources: [resource(OWN_RESOURCE, PAGE_ID)],
        statusPage: page,
        eventType: StatusPageEventType.Incident,
      }),
    ).toBe(false);
  });

  test("does not match an event resource the subscriber did not pick", () => {
    expect(
      isTold({
        subscriber: subscriberPicking([resource(OWN_RESOURCE, PAGE_ID)]),
        eventResources: [
          resource("8b000000-0000-4000-8000-000000000003", PAGE_ID),
        ],
      }),
    ).toBe(false);
  });

  test("tells a subscriber to every resource about everything", () => {
    const subscriber: StatusPageSubscriber = subscriberPicking([]);
    subscriber.isSubscribedToAllResources = true;

    expect(
      isTold({
        subscriber: subscriber,
        eventResources: [resource(OTHER_PAGE_RESOURCE, OTHER_PAGE_ID)],
      }),
    ).toBe(true);
  });

  test("an announcement about no resource still reaches every subscriber", () => {
    expect(
      isTold({
        subscriber: subscriberPicking([
          resource(OTHER_PAGE_RESOURCE, OTHER_PAGE_ID),
        ]),
        eventResources: [],
        eventType: StatusPageEventType.Announcement,
      }),
    ).toBe(true);
  });
});

describe("StatusPageSubscriberService.getSubscribersByStatusPage - resources with their page", () => {
  test("reads each subscriber's resources with the page each is on", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(StatusPageSubscriberService, "findBy")
      .mockResolvedValue([] as never);

    await StatusPageSubscriberService.getSubscribersByStatusPage(PAGE_ID, {
      isRoot: true,
      ignoreHooks: true,
    });

    const select: JSONObject = (
      findBy.mock.calls[0]![0] as unknown as { select: JSONObject }
    ).select;

    expect(select["statusPageResources"]).toEqual({
      _id: true,
      statusPageId: true,
    });
  });
});
