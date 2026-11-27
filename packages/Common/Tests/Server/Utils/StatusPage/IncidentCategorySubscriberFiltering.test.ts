import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import StatusPageIncidentCategory from "../../../../Models/DatabaseModels/StatusPageIncidentCategory";
import StatusPageResource from "../../../../Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "../../../../Models/DatabaseModels/StatusPageSubscriber";
import StatusPageSubscriberService from "../../../../Server/Services/StatusPageSubscriberService";
import ObjectID from "../../../../Types/ObjectID";
import StatusPageEventType from "../../../../Types/StatusPage/StatusPageEventType";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

describe("subscriber filtering for incident categories", () => {
  let page: StatusPage;
  let subscriber: StatusPageSubscriber;
  let category: StatusPageIncidentCategory;
  let resource: StatusPageResource;

  beforeEach(() => {
    page = new StatusPage();
    page.id = ObjectID.generate();
    page.allowSubscribersToChooseResources = true;
    page.allowSubscribersToChooseEventTypes = true;
    page.allowSubscribersToChooseIncidentCategories = true;

    category = new StatusPageIncidentCategory();
    category.id = ObjectID.generate();
    category.statusPageId = page.id;

    resource = new StatusPageResource();
    resource.id = ObjectID.generate();
    resource.statusPageId = page.id;

    subscriber = new StatusPageSubscriber();
    subscriber.statusPageId = page.id;
    subscriber.isSubscribedToAllResources = false;
    subscriber.statusPageResources = [resource];
    subscriber.isSubscribedToAllEventTypes = false;
    subscriber.statusPageEventTypes = [StatusPageEventType.Incident];
    subscriber.isSubscribedToAllIncidentCategories = false;
    subscriber.statusPageIncidentCategories = [category];
  });

  function shouldSend(
    categories: Array<ObjectID>,
    resources: Array<StatusPageResource> = [resource],
    isIncidentWithoutMonitors: boolean = false,
  ): boolean {
    return StatusPageSubscriberService.shouldSendNotification({
      subscriber,
      statusPage: page,
      statusPageResources: resources,
      eventType: StatusPageEventType.Incident,
      incidentCategoryIds: categories,
      isIncidentWithoutMonitors,
    });
  }

  test("requires the category, resource and event-type preferences together", () => {
    expect(shouldSend([category.id!])).toBe(true);
    expect(shouldSend([ObjectID.generate()])).toBe(false);
    expect(shouldSend([category.id!], [])).toBe(false);
    subscriber.statusPageEventTypes = [StatusPageEventType.Announcement];
    expect(shouldSend([category.id!])).toBe(false);
  });

  test("a subscriber can select no categories and still receive uncategorized incidents", () => {
    subscriber.statusPageIncidentCategories = [];
    expect(shouldSend([category.id!])).toBe(false);
    expect(shouldSend([])).toBe(true);
    subscriber.isSubscribedToAllIncidentCategories = true;
    expect(shouldSend([category.id!])).toBe(true);
  });

  test("monitorless advisories bypass resource filtering and keep category filtering", () => {
    expect(shouldSend([category.id!], [], true)).toBe(true);
    expect(shouldSend([ObjectID.generate()], [], true)).toBe(false);
    expect(shouldSend([], [], true)).toBe(true);
  });
});
