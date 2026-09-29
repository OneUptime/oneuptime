import StatusPageSubscriberUnsubscribeNotice, {
  StatusPageSubscriberUnsubscribeNoticeEmail,
  StatusPageSubscriberUnsubscribeNoticeInput,
  StatusPageSubscriberUnsubscribeSource,
} from "../../../../Server/Utils/StatusPage/StatusPageSubscriberUnsubscribeNotice";
import { StatusPageSubscriberUnsubscribeChannel } from "../../../../Types/StatusPage/StatusPageSubscriberUnsubscribe";
import { describe, expect, test } from "@jest/globals";

/*
 * The email a status page's owners (and the teammate who added the
 * subscriber) get when a subscriber the team added unsubscribes itself - the
 * warning that a site may just have dropped off the page.
 *
 * It goes out through the SimpleMessage template, which inserts `message` as
 * HTML, and the contact in it was typed on a public form or into the
 * dashboard, so every value must arrive escaped.
 */

const BASE: StatusPageSubscriberUnsubscribeNoticeInput = {
  statusPageName: "Site 03",
  contact: {
    channel: StatusPageSubscriberUnsubscribeChannel.Email,
    contact: "site03-all@acme.com",
  },
  source: StatusPageSubscriberUnsubscribeSource.UnsubscribeLink,
  unsubscribedAt: new Date("2026-09-26T10:15:00.000Z"),
  addedByName: "Dana Admin",
  addedAt: new Date("2026-01-05T08:00:00.000Z"),
  subscriberListUrl:
    "https://oneuptime.acme.com/dashboard/p1/status-pages/s1/email-subscribers",
};

function build(
  overrides?: Partial<StatusPageSubscriberUnsubscribeNoticeInput>,
): StatusPageSubscriberUnsubscribeNoticeEmail {
  return StatusPageSubscriberUnsubscribeNotice.build({
    ...BASE,
    ...(overrides || {}),
  });
}

describe("StatusPageSubscriberUnsubscribeNotice.build", () => {
  test("names the subscriber, the page, how and when it left, and who added it", () => {
    const email: StatusPageSubscriberUnsubscribeNoticeEmail = build();

    expect(email.subject).toBe(
      "A subscriber your team added unsubscribed from Site 03",
    );
    expect(email.message).toContain(
      "The email subscriber <strong>site03-all@acme.com</strong> unsubscribed from the status page <strong>Site 03</strong> using the unsubscribe link in a notification",
    );
    expect(email.message).toContain("Sep 26, 2026, 10:15 UTC");
    expect(email.message).toContain("Dana Admin added this subscriber on");
    expect(email.message).toContain("Jan 5, 2026");
    expect(email.message).toContain(
      `<a href="${BASE.subscriberListUrl}">View the status page's subscribers</a>`,
    );
  });

  test("warns that a shared address drops everyone who reads it", () => {
    expect(build().message).toContain(
      "Anyone who reads a shared address, such as a mailing list, can unsubscribe it for everyone who reads it.",
    );
  });

  test("says when it was the manage page rather than the link", () => {
    expect(
      build({
        source: StatusPageSubscriberUnsubscribeSource.ManageSubscriptionPage,
      }).message,
    ).toContain("on the status page's Update Subscription page");
  });

  test("escapes every value it interpolates", () => {
    const email: StatusPageSubscriberUnsubscribeNoticeEmail = build({
      statusPageName: '<img src=x onerror="alert(1)">',
      contact: {
        channel: StatusPageSubscriberUnsubscribeChannel.Email,
        contact: "<script>alert(2)</script>@acme.com",
      },
      addedByName: "<b>Eve</b> & co",
      subscriberListUrl: 'https://x.test/"><script>alert(3)</script>',
    });

    expect(email.message).not.toContain("<script>");
    expect(email.message).not.toContain("<img");
    expect(email.message).not.toContain("<b>Eve</b>");
    expect(email.message).toContain("&lt;script&gt;alert(2)&lt;/script&gt;");
    expect(email.message).toContain("&lt;b&gt;Eve&lt;/b&gt; &amp; co");
    expect(email.message).toContain("&quot;&gt;&lt;script&gt;");
  });

  test("still reads when the teammate or the date is unknown", () => {
    const email: StatusPageSubscriberUnsubscribeNoticeEmail = build({
      addedByName: undefined,
      addedAt: undefined,
    });

    expect(email.message).toContain(
      "Someone on your team added this subscriber.",
    );
  });

  test("a subscriber with no contact to name is still reported", () => {
    const email: StatusPageSubscriberUnsubscribeNoticeEmail = build({
      contact: {
        channel: StatusPageSubscriberUnsubscribeChannel.Slack,
        contact: "",
      },
    });

    expect(email.message).toContain("A Slack subscriber unsubscribed");
  });

  test.each([
    [StatusPageSubscriberUnsubscribeChannel.Email, "email-subscribers"],
    [StatusPageSubscriberUnsubscribeChannel.SMS, "sms-subscribers"],
    [StatusPageSubscriberUnsubscribeChannel.Slack, "slack-subscribers"],
    [
      StatusPageSubscriberUnsubscribeChannel.MicrosoftTeams,
      "microsoft-teams-subscribers",
    ],
    [StatusPageSubscriberUnsubscribeChannel.Webhook, "webhook-subscribers"],
  ])(
    "links a %s subscriber to the dashboard's %s list",
    (channel: StatusPageSubscriberUnsubscribeChannel, route: string) => {
      expect(
        StatusPageSubscriberUnsubscribeNotice.getSubscriberListRoute(channel),
      ).toBe(route);
    },
  );
});
