import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import logger from "../../../Server/Utils/Logger";
import Email from "../../../Types/Email";
import ObjectID from "../../../Types/ObjectID";
import StatusPageEventType from "../../../Types/StatusPage/StatusPageEventType";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Every subscriber job asks shouldSendNotification about every subscriber,
 * and the subscribers they read carry their unsubscribe token - a credential
 * that cancels the subscription, on private pages too. With LOG_LEVEL=DEBUG
 * the call's debug lines must still never write it.
 */

const TOKEN: string = "7a".repeat(32);

afterEach(() => {
  jest.restoreAllMocks();
});

describe("StatusPageSubscriberService.shouldSendNotification", () => {
  test("logs the subscriber's id, never its unsubscribe token", () => {
    const debug: ReturnType<typeof jest.spyOn> = jest
      .spyOn(logger, "debug")
      .mockImplementation(() => {});

    const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
    subscriber._id = "30000000-0000-4000-8000-000000000003";
    subscriber.subscriberEmail = new Email("someone@example.com");
    subscriber.unsubscribeToken = TOKEN;
    subscriber.isSubscribedToAllResources = true;

    const statusPage: StatusPage = new StatusPage();
    statusPage.id = new ObjectID("20000000-0000-4000-8000-000000000002");

    expect(
      StatusPageSubscriberService.shouldSendNotification({
        subscriber: subscriber,
        statusPageResources: [],
        statusPage: statusPage,
        eventType: StatusPageEventType.Incident,
      }),
    ).toBe(true);

    expect(debug).toHaveBeenCalled();

    const logged: string = JSON.stringify(debug.mock.calls);

    expect(logged).not.toContain(TOKEN);
    expect(logged).toContain("30000000-0000-4000-8000-000000000003");
  });
});
