import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import URL from "Common/Types/API/URL";
import StatusPageSubscriberUnsubscribe from "Common/Types/StatusPage/StatusPageSubscriberUnsubscribe";
import crypto from "crypto";
import { expect } from "@jest/globals";

/*
 * The unsubscribe link in the subscriber job tests.
 *
 * Every notification a job sends carries the subscriber's unsubscribe link,
 * {statusPageUrl}/unsubscribe/{subscriberId}-{token}, which only works if the
 * job hands StatusPageSubscriberService.getUnsubscribeLink the subscriber as
 * getSubscribersByStatusPage read it - token included. The job tests mock
 * the service, so they plug in fakeGetUnsubscribeLink: it builds the link
 * with the real builder from whatever the job passed. A job that passed an id
 * (the old signature), or a subscriber without its token, gets a link with no
 * token and fails every assertion on unsubscribeLinkFor.
 */

// A stable 64-hex token per subscriber id, so each fixture subscriber has its own.
export function unsubscribeTokenFor(subscriberId: {
  toString(): string;
}): string {
  return crypto
    .createHash("sha256")
    .update(`unsubscribe:${subscriberId.toString().toLowerCase()}`)
    .digest("hex");
}

// Give a fixture subscriber the token its row would carry.
export function withUnsubscribeToken(
  subscriber: StatusPageSubscriber,
): StatusPageSubscriber {
  if (subscriber._id) {
    subscriber.unsubscribeToken = unsubscribeTokenFor(subscriber._id);
  }

  return subscriber;
}

// The link a subscriber's messages from a page must carry.
export function unsubscribeLinkFor(
  statusPageUrl: string,
  subscriberId: { toString(): string },
): string {
  return `${statusPageUrl}/unsubscribe/${subscriberId
    .toString()
    .toLowerCase()}-${unsubscribeTokenFor(subscriberId)}`;
}

/*
 * The link an SMS from a PUBLIC status page carries instead: the subscriber's
 * manage page, which works there without signing in and is 57 characters
 * shorter - an SMS is billed by the segment (see
 * StatusPageSubscriberUnsubscribe.buildSmsLink). The job fixtures' pages are
 * public. An SMS from a private page carries unsubscribeLinkFor.
 */
export function smsManageLinkFor(
  statusPageUrl: string,
  subscriberId: { toString(): string },
): string {
  return `${statusPageUrl}/update-subscription/${subscriberId.toString()}`;
}

// Stands in for StatusPageSubscriberService.getUnsubscribeLink.
export function fakeGetUnsubscribeLink(
  statusPageUrl: unknown,
  subscriber: unknown,
): URL {
  const row: StatusPageSubscriber = subscriber as StatusPageSubscriber;

  return StatusPageSubscriberUnsubscribe.buildLink({
    statusPageUrl: (statusPageUrl as URL).toString(),
    subscriberId: row.id!,
    unsubscribeToken: row.unsubscribeToken,
  });
}

/*
 * Every call the job made passed a subscriber carrying its token, and every
 * link it produced is a token link - never the old manage page.
 */
export function expectEveryUnsubscribeLinkToCarryAToken(
  getUnsubscribeLink: unknown,
): void {
  const calls: Array<Array<unknown>> = (
    getUnsubscribeLink as { mock: { calls: Array<Array<unknown>> } }
  ).mock.calls;

  expect(calls.length).toBeGreaterThan(0);

  for (const call of calls) {
    const subscriber: StatusPageSubscriber = call[1] as StatusPageSubscriber;

    expect(subscriber).toBeInstanceOf(StatusPageSubscriber);
    expect(
      StatusPageSubscriberUnsubscribe.isWellFormedToken(
        subscriber.unsubscribeToken,
      ),
    ).toBe(true);

    const link: string = fakeGetUnsubscribeLink(call[0], subscriber).toString();

    expect(link).toContain(`/unsubscribe/${subscriber.id!.toString()}-`);
    expect(link).not.toContain("/update-subscription/");
  }
}
