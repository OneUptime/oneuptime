import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import StatusPageSubscriberUnsubscribe, {
  StatusPageSubscriberContact,
  StatusPageSubscriberUnsubscribeChannel,
  StatusPageSubscriberUnsubscribeCredential,
} from "../../../Types/StatusPage/StatusPageSubscriberUnsubscribe";
import { describe, expect, test } from "@jest/globals";

/*
 * The unsubscribe link every subscriber notification carries,
 * {statusPageUrl}/unsubscribe/{subscriberId}-{token}, and the credential the
 * status page's unsubscribe page reads back out of it.
 *
 * The id and the token travel as ONE path segment so the status page's
 * SensitiveUrlToken bootstrap - which strips exactly one segment after
 * "unsubscribe" - takes both out of the address bar. These pin the shape the
 * builder, the page and the bootstrap all rely on.
 */

const SUBSCRIBER_ID: string = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const TOKEN: string =
  "3f9a1c2b4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8";

describe("StatusPageSubscriberUnsubscribe tokens", () => {
  test("a token is 64 lowercase hex characters", () => {
    expect(StatusPageSubscriberUnsubscribe.TOKEN_LENGTH).toBe(64);
    expect(StatusPageSubscriberUnsubscribe.isWellFormedToken(TOKEN)).toBe(true);
  });

  test.each([
    ["empty", ""],
    ["too short", TOKEN.slice(1)],
    ["too long", `${TOKEN}0`],
    ["uppercase", TOKEN.toUpperCase()],
    ["not hex", `${TOKEN.slice(0, 63)}g`],
    ["a six-digit confirmation code", "123456"],
    ["null", null],
    ["undefined", undefined],
    ["a number", 42],
  ])("%s is not a token", (_label: string, value: unknown) => {
    expect(StatusPageSubscriberUnsubscribe.isWellFormedToken(value)).toBe(
      false,
    );
  });
});

describe("StatusPageSubscriberUnsubscribe links", () => {
  test("the link is the status page URL, /unsubscribe/ and one id-token segment", () => {
    const link: URL = StatusPageSubscriberUnsubscribe.buildLink({
      statusPageUrl: "https://status.acme.com",
      subscriberId: new ObjectID(SUBSCRIBER_ID),
      unsubscribeToken: TOKEN,
    });

    expect(link.toString()).toBe(
      `https://status.acme.com/unsubscribe/${SUBSCRIBER_ID}-${TOKEN}`,
    );
  });

  test("a page without a custom domain keeps its /status-page/{id} prefix", () => {
    const statusPageUrl: string =
      "https://oneuptime.acme.com/status-page/11111111-1111-4111-8111-111111111111";

    const link: URL = StatusPageSubscriberUnsubscribe.buildLink({
      statusPageUrl: URL.fromString(statusPageUrl),
      subscriberId: SUBSCRIBER_ID,
      unsubscribeToken: TOKEN,
    });

    expect(link.toString()).toBe(
      `${statusPageUrl}/unsubscribe/${SUBSCRIBER_ID}-${TOKEN}`,
    );
  });

  test("without a token the link carries only the id - the out-of-date link page", () => {
    for (const token of [undefined, null, "", "not-a-token"]) {
      expect(
        StatusPageSubscriberUnsubscribe.buildLink({
          statusPageUrl: "https://status.acme.com",
          subscriberId: SUBSCRIBER_ID,
          unsubscribeToken: token,
        }).toString(),
      ).toBe(`https://status.acme.com/unsubscribe/${SUBSCRIBER_ID}`);
    }
  });

  test("the link never goes to the manage page any more", () => {
    const link: string = StatusPageSubscriberUnsubscribe.buildLink({
      statusPageUrl: "https://status.acme.com",
      subscriberId: SUBSCRIBER_ID,
      unsubscribeToken: TOKEN,
    }).toString();

    expect(link).not.toContain("update-subscription");
  });

  test("the manage link is the subscriber's Update Subscription page", () => {
    expect(
      StatusPageSubscriberUnsubscribe.buildManageSubscriptionLink({
        statusPageUrl: "https://status.acme.com",
        subscriberId: new ObjectID(SUBSCRIBER_ID),
      }).toString(),
    ).toBe(`https://status.acme.com/update-subscription/${SUBSCRIBER_ID}`);
  });
});

describe("StatusPageSubscriberUnsubscribe credentials", () => {
  test("a link's credential reads back as its id and token", () => {
    const credential: string = StatusPageSubscriberUnsubscribe.buildCredential({
      subscriberId: SUBSCRIBER_ID,
      unsubscribeToken: TOKEN,
    });

    expect(credential).toBe(`${SUBSCRIBER_ID}-${TOKEN}`);
    expect(StatusPageSubscriberUnsubscribe.parseCredential(credential)).toEqual(
      {
        subscriberId: SUBSCRIBER_ID,
        token: TOKEN,
      },
    );
  });

  test("an id alone reads back with no token", () => {
    expect(
      StatusPageSubscriberUnsubscribe.parseCredential(SUBSCRIBER_ID),
    ).toEqual({ subscriberId: SUBSCRIBER_ID, token: null });
  });

  test("case is normalised, as a mail client might change it", () => {
    const parsed: StatusPageSubscriberUnsubscribeCredential | null =
      StatusPageSubscriberUnsubscribe.parseCredential(
        `${SUBSCRIBER_ID.toUpperCase()}-${TOKEN.toUpperCase()}`,
      );

    expect(parsed).toEqual({ subscriberId: SUBSCRIBER_ID, token: TOKEN });
  });

  test.each([
    ["nothing", ""],
    ["null", null],
    ["a truncated token", `${SUBSCRIBER_ID}-${TOKEN.slice(0, 40)}`],
    ["a token without an id", TOKEN],
    ["a password reset token left in the same storage slot", "c0ffee"],
    ["a truncated id", SUBSCRIBER_ID.slice(0, 30)],
    ["extra segments", `${SUBSCRIBER_ID}-${TOKEN}-${TOKEN}`],
    ["a path", `../${SUBSCRIBER_ID}-${TOKEN}`],
  ])("%s is not a credential", (_label: string, value: string | null) => {
    expect(StatusPageSubscriberUnsubscribe.parseCredential(value)).toBeNull();
  });
});

describe("StatusPageSubscriberUnsubscribe contact", () => {
  test("an email address is shown in full, so a shared list is recognisable", () => {
    expect(
      StatusPageSubscriberUnsubscribe.describeContact({
        subscriberEmail: "site03-all@acme.com",
      }),
    ).toEqual({
      channel: StatusPageSubscriberUnsubscribeChannel.Email,
      contact: "site03-all@acme.com",
    });
  });

  test("a phone number is masked to its last four digits", () => {
    const contact: StatusPageSubscriberContact | null =
      StatusPageSubscriberUnsubscribe.describeContact({
        subscriberPhone: "+15555550123",
      });

    expect(contact).toEqual({
      channel: StatusPageSubscriberUnsubscribeChannel.SMS,
      contact: "+•••••••0123",
    });
  });

  test("the team's own notice can ask for the full number", () => {
    expect(
      StatusPageSubscriberUnsubscribe.describeContact(
        { subscriberPhone: "+15555550123" },
        { maskPhone: false },
      )?.contact,
    ).toBe("+15555550123");
  });

  test("Slack and Teams show their workspace names, never their webhook URLs", () => {
    const slack: StatusPageSubscriberContact | null =
      StatusPageSubscriberUnsubscribe.describeContact({
        slackIncomingWebhookUrl:
          "https://hooks.slack.com/services/T0/B0/SECRET",
        slackWorkspaceName: "acme-ops",
      });
    const teams: StatusPageSubscriberContact | null =
      StatusPageSubscriberUnsubscribe.describeContact({
        microsoftTeamsIncomingWebhookUrl:
          "https://acme.webhook.office.com/webhookb2/SECRET",
        microsoftTeamsWorkspaceName: "acme-teams",
      });

    expect(slack).toEqual({
      channel: StatusPageSubscriberUnsubscribeChannel.Slack,
      contact: "acme-ops",
    });
    expect(teams).toEqual({
      channel: StatusPageSubscriberUnsubscribeChannel.MicrosoftTeams,
      contact: "acme-teams",
    });
    expect(JSON.stringify([slack, teams])).not.toContain("SECRET");
  });

  test("a webhook shows only its host, never its path or credentials", () => {
    const contact: StatusPageSubscriberContact | null =
      StatusPageSubscriberUnsubscribe.describeContact({
        subscriberWebhook:
          "https://user:password@Hooks.Acme.com:8443/status/SECRET?key=SECRET",
      });

    expect(contact).toEqual({
      channel: StatusPageSubscriberUnsubscribeChannel.Webhook,
      contact: "hooks.acme.com",
    });
  });

  test("a subscriber with no contact is described as nothing", () => {
    expect(StatusPageSubscriberUnsubscribe.describeContact({})).toBeNull();
  });

  test("maskPhone keeps formatting and short numbers", () => {
    expect(StatusPageSubscriberUnsubscribe.maskPhone("+1 (555) 555-0123")).toBe(
      "+• (•••) •••-0123",
    );
    expect(StatusPageSubscriberUnsubscribe.maskPhone("123")).toBe("123");
  });
});

describe("StatusPageSubscriberUnsubscribe.redactCredentials", () => {
  const link: string = `https://status.acme.com/unsubscribe/${SUBSCRIBER_ID}-${TOKEN}`;
  const redacted: string = `https://status.acme.com/unsubscribe/${SUBSCRIBER_ID}-[redacted]`;

  test("replaces the token of a link built by buildLink, and keeps the id", () => {
    const built: string = StatusPageSubscriberUnsubscribe.buildLink({
      statusPageUrl: "https://status.acme.com",
      subscriberId: new ObjectID(SUBSCRIBER_ID),
      unsubscribeToken: TOKEN,
    }).toString();

    expect(
      StatusPageSubscriberUnsubscribe.redactCredentials(`Unsub: ${built}`),
    ).toBe(`Unsub: ${redacted}`);
  });

  test("every link in the text, on a custom domain or the page's own address", () => {
    const ownAddress: string = `https://oneuptime.acme.com/status-page/${SUBSCRIBER_ID}/unsubscribe/${SUBSCRIBER_ID}-${TOKEN}`;

    const text: string = `First ${link}. Again ${link}. Own address ${ownAddress}.`;

    const result: string =
      StatusPageSubscriberUnsubscribe.redactCredentials(text);

    expect(result).toBe(
      `First ${redacted}. Again ${redacted}. Own address https://oneuptime.acme.com/status-page/${SUBSCRIBER_ID}/unsubscribe/${SUBSCRIBER_ID}-[redacted].`,
    );
    expect(result).not.toContain(TOKEN);
  });

  test("a token some template ran straight into more text is still caught", () => {
    expect(
      StatusPageSubscriberUnsubscribe.redactCredentials(
        `${link}abcdef-and-more`,
      ),
    ).toBe(`${redacted}abcdef-and-more`);
  });

  test("an upper-cased link is caught too", () => {
    expect(
      StatusPageSubscriberUnsubscribe.redactCredentials(
        `/unsubscribe/${SUBSCRIBER_ID.toUpperCase()}-${TOKEN.toUpperCase()}`,
      ),
    ).toBe(`/unsubscribe/${SUBSCRIBER_ID.toUpperCase()}-[redacted]`);
  });

  test("leaves everything else alone: manage links, out-of-date links, other hex", () => {
    const untouched: string = [
      `https://status.acme.com/update-subscription/${SUBSCRIBER_ID}`,
      `https://status.acme.com/unsubscribe/${SUBSCRIBER_ID}`,
      `https://status.acme.com/incidents/${SUBSCRIBER_ID}-${TOKEN}`,
      TOKEN,
    ].join(" ");

    expect(StatusPageSubscriberUnsubscribe.redactCredentials(untouched)).toBe(
      untouched,
    );
    expect(StatusPageSubscriberUnsubscribe.redactCredentials("")).toBe("");
  });

  test("gives the same answer however often it is called (the pattern is global)", () => {
    for (let i: number = 0; i < 3; i++) {
      expect(StatusPageSubscriberUnsubscribe.redactCredentials(link)).toBe(
        redacted,
      );
    }
  });
});

describe("StatusPageSubscriberUnsubscribe.buildSmsLink", () => {
  const unsubscribeUrl: string = StatusPageSubscriberUnsubscribe.buildLink({
    statusPageUrl: "https://status.acme.com",
    subscriberId: new ObjectID(SUBSCRIBER_ID),
    unsubscribeToken: TOKEN,
  }).toString();

  function smsLink(isPublicStatusPage: boolean | null | undefined): string {
    return StatusPageSubscriberUnsubscribe.buildSmsLink({
      isPublicStatusPage: isPublicStatusPage,
      statusPageUrl: "https://status.acme.com",
      subscriberId: new ObjectID(SUBSCRIBER_ID),
      unsubscribeUrl: unsubscribeUrl,
    });
  }

  test("a public page's SMS keeps the manage link, which works there without signing in", () => {
    expect(smsLink(true)).toBe(
      `https://status.acme.com/update-subscription/${SUBSCRIBER_ID}`,
    );
  });

  test("which is 57 characters shorter than the token link - an SMS is billed by the segment", () => {
    expect(unsubscribeUrl.length - smsLink(true).length).toBe(57);
  });

  test.each([
    ["a private page", false],
    ["a page whose visibility was not read", undefined],
    ["a page whose visibility is empty", null],
  ])(
    "%s gets the token link: a manage page may need a signed-in visitor",
    (_label: string, isPublicStatusPage: boolean | null | undefined) => {
      expect(smsLink(isPublicStatusPage)).toBe(unsubscribeUrl);
    },
  );
});
