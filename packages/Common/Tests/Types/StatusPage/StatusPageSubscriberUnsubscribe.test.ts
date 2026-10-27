import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import StatusPageSubscriberUnsubscribe, {
  StatusPageSubscriberContact,
  StatusPageSubscriberUnsubscribeChannel,
  StatusPageSubscriberUnsubscribeCredential,
} from "../../../Types/StatusPage/StatusPageSubscriberUnsubscribe";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * The unsubscribe link every subscriber notification carries,
 * {statusPageUrl}/unsubscribe/{subscriberId}-{token}, the manage link that
 * carries the same credential, {statusPageUrl}/update-subscription/
 * {subscriberId}-{token}, and the credential the status page's two pages read
 * back out of them.
 *
 * The id and the token travel as ONE path segment so the status page's
 * SensitiveUrlToken bootstrap - which strips exactly one segment after
 * "unsubscribe" or "update-subscription" - takes both out of the address bar.
 * These pin the shape the builders, the pages and the bootstrap all rely on.
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

  test("the manage link is the subscriber's Update Subscription page, with the same credential", () => {
    expect(StatusPageSubscriberUnsubscribe.MANAGE_PAGE_ROUTE_SEGMENT).toBe(
      "update-subscription",
    );

    expect(
      StatusPageSubscriberUnsubscribe.buildManageSubscriptionLink({
        statusPageUrl: "https://status.acme.com",
        subscriberId: new ObjectID(SUBSCRIBER_ID),
        unsubscribeToken: TOKEN,
      }).toString(),
    ).toBe(
      `https://status.acme.com/update-subscription/${SUBSCRIBER_ID}-${TOKEN}`,
    );
  });

  test("the manage link's last segment is exactly the unsubscribe link's credential", () => {
    const manage: string =
      StatusPageSubscriberUnsubscribe.buildManageSubscriptionLink({
        statusPageUrl: "https://status.acme.com",
        subscriberId: SUBSCRIBER_ID.toUpperCase(),
        unsubscribeToken: TOKEN,
      }).toString();
    const unsubscribe: string = StatusPageSubscriberUnsubscribe.buildLink({
      statusPageUrl: "https://status.acme.com",
      subscriberId: SUBSCRIBER_ID.toUpperCase(),
      unsubscribeToken: TOKEN,
    }).toString();

    const lastSegment: (link: string) => string = (link: string): string => {
      return link.split("/").pop() || "";
    };

    expect(lastSegment(manage)).toBe(lastSegment(unsubscribe));
    expect(
      StatusPageSubscriberUnsubscribe.parseCredential(lastSegment(manage)),
    ).toEqual({ subscriberId: SUBSCRIBER_ID, token: TOKEN });
  });

  test("a manage link on a page without a custom domain keeps its /status-page/{id} prefix", () => {
    const statusPageUrl: string =
      "https://oneuptime.acme.com/status-page/11111111-1111-4111-8111-111111111111";

    expect(
      StatusPageSubscriberUnsubscribe.buildManageSubscriptionLink({
        statusPageUrl: URL.fromString(statusPageUrl),
        subscriberId: SUBSCRIBER_ID,
        unsubscribeToken: TOKEN,
      }).toString(),
    ).toBe(`${statusPageUrl}/update-subscription/${SUBSCRIBER_ID}-${TOKEN}`);
  });

  test("without a token the manage link carries only the id - the page's expired link state", () => {
    for (const token of [undefined, null, "", "not-a-token"]) {
      expect(
        StatusPageSubscriberUnsubscribe.buildManageSubscriptionLink({
          statusPageUrl: "https://status.acme.com",
          subscriberId: SUBSCRIBER_ID,
          unsubscribeToken: token,
        }).toString(),
      ).toBe(`https://status.acme.com/update-subscription/${SUBSCRIBER_ID}`);
    }
  });

  test("an SMS carries the same link as every other channel: there is no SMS-only link any more", () => {
    expect(
      Object.getOwnPropertyNames(StatusPageSubscriberUnsubscribe).filter(
        (name: string): boolean => {
          return name.toLowerCase().includes("sms");
        },
      ),
    ).toEqual([]);
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

  test("replaces the token of a manage link too, and keeps the id", () => {
    const built: string =
      StatusPageSubscriberUnsubscribe.buildManageSubscriptionLink({
        statusPageUrl: "https://status.acme.com",
        subscriberId: new ObjectID(SUBSCRIBER_ID),
        unsubscribeToken: TOKEN,
      }).toString();

    const result: string = StatusPageSubscriberUnsubscribe.redactCredentials(
      `You can manage your subscription here: ${built}`,
    );

    expect(result).toBe(
      `You can manage your subscription here: https://status.acme.com/update-subscription/${SUBSCRIBER_ID}-[redacted]`,
    );
    expect(result).not.toContain(TOKEN);
  });

  test("a message with both links keeps neither token", () => {
    const manage: string = `https://oneuptime.acme.com/status-page/${SUBSCRIBER_ID}/update-subscription/${SUBSCRIBER_ID}-${TOKEN}`;

    const result: string = StatusPageSubscriberUnsubscribe.redactCredentials(
      `Manage: ${manage} Unsubscribe: ${link}`,
    );

    expect(result).toBe(
      `Manage: https://oneuptime.acme.com/status-page/${SUBSCRIBER_ID}/update-subscription/${SUBSCRIBER_ID}-[redacted] Unsubscribe: ${redacted}`,
    );
    expect(result).not.toContain(TOKEN);
  });

  test("leaves everything else alone: links with no token, other pages, other hex", () => {
    const untouched: string = [
      `https://status.acme.com/update-subscription/${SUBSCRIBER_ID}`,
      `https://status.acme.com/unsubscribe/${SUBSCRIBER_ID}`,
      `https://status.acme.com/incidents/${SUBSCRIBER_ID}-${TOKEN}`,
      `https://status.acme.com/confirm-subscription/${SUBSCRIBER_ID}-${TOKEN}`,
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

  /*
   * A visitor who signs up by text is texted the link that confirms the
   * subscription, and the SMS log keeps the text: its code is the whole of
   * what confirms it, so it is kept out of the log as a token is.
   */
  const confirmation: string = `https://status.acme.com/confirm-subscription/${SUBSCRIBER_ID}?verification-token=482913`;
  const confirmationRedacted: string = `https://status.acme.com/confirm-subscription/${SUBSCRIBER_ID}?verification-token=[redacted]`;

  test("replaces the code of a link that confirms a subscription, and keeps the id", () => {
    expect(
      StatusPageSubscriberUnsubscribe.redactCredentials(
        `Confirm your subscription to Acme Status by text message within 24 hours. Not you? Ignore this and you will not be subscribed. ${confirmation}`,
      ),
    ).toBe(
      `Confirm your subscription to Acme Status by text message within 24 hours. Not you? Ignore this and you will not be subscribed. ${confirmationRedacted}`,
    );
  });

  test("a confirmation link on the page's own address, or run into more text, is caught too", () => {
    const ownAddress: string = `https://oneuptime.acme.com/status-page/${SUBSCRIBER_ID}/confirm-subscription/${SUBSCRIBER_ID}?verification-token=000123`;

    expect(
      StatusPageSubscriberUnsubscribe.redactCredentials(
        `${ownAddress} and ${confirmation}xyz`,
      ),
    ).toBe(
      `https://oneuptime.acme.com/status-page/${SUBSCRIBER_ID}/confirm-subscription/${SUBSCRIBER_ID}?verification-token=[redacted] and ${confirmationRedacted}xyz`,
    );
  });

  test("a message with every kind of link keeps no credential", () => {
    const result: string = StatusPageSubscriberUnsubscribe.redactCredentials(
      `${confirmation} ${link}`,
    );

    expect(result).toBe(`${confirmationRedacted} ${redacted}`);
    expect(result).not.toContain("482913");
    expect(result).not.toContain(TOKEN);
  });

  test("replaces a code of 32 hex characters, the shape of the codes minted now, whole", () => {
    const code: string = "9f86d081884c7d659a2feaa0c55ad015";
    const result: string = StatusPageSubscriberUnsubscribe.redactCredentials(
      `Confirm: https://status.acme.com/confirm-subscription/${SUBSCRIBER_ID}?verification-token=${code}`,
    );

    expect(result).toBe(`Confirm: ${confirmationRedacted}`);
    expect(result).not.toContain(code.slice(0, 6));
    expect(result).not.toContain(code.slice(-6));
  });

  test("a code in capitals is caught too, and the text after it is kept", () => {
    expect(
      StatusPageSubscriberUnsubscribe.redactCredentials(
        `https://status.acme.com/confirm-subscription/${SUBSCRIBER_ID}?verification-token=9F86D081884C7D659A2FEAA0C55AD015 - Acme`,
      ),
    ).toBe(`${confirmationRedacted} - Acme`);
  });

  test("leaves a confirmation link with no code, or a code of another page's query, alone", () => {
    const untouched: string = [
      `https://status.acme.com/confirm-subscription/${SUBSCRIBER_ID}`,
      `https://status.acme.com/confirm-subscription/${SUBSCRIBER_ID}?verification-token=`,
      `https://status.acme.com/incidents/${SUBSCRIBER_ID}?verification-token=482913`,
      `https://status.acme.com/confirm-subscription/not-an-id?verification-token=482913`,
    ].join(" ");

    expect(StatusPageSubscriberUnsubscribe.redactCredentials(untouched)).toBe(
      untouched,
    );
  });
});

/*
 * The pattern runs over text people outside OneUptime wrote - an incident's
 * title in an SMS, a custom template's subject - so it must take time in line
 * with the text, never with its square. Its worst cases: text that starts a
 * link at every position and never finishes one.
 */
describe("StatusPageSubscriberUnsubscribe.redactCredentials on long text", () => {
  const LENGTH: number = 400000;

  test.each([
    ["route segments with no id", "/unsubscribe/".repeat(LENGTH / 13)],
    [
      "manage route segments with no id",
      "/update-subscription/".repeat(Math.ceil(LENGTH / 21)),
    ],
    [
      "ids with a token one character short",
      `/update-subscription/${SUBSCRIBER_ID}-${TOKEN.slice(0, 63)} `.repeat(
        Math.ceil(LENGTH / 122),
      ),
    ],
    [
      "ids run into one another",
      `/unsubscribe/${SUBSCRIBER_ID}-`.repeat(Math.ceil(LENGTH / 50)),
    ],
    ["hex alone", "a".repeat(LENGTH)],
    [
      "confirmation route segments with no id",
      "/confirm-subscription/".repeat(Math.ceil(LENGTH / 22)),
    ],
    [
      "confirmation links with no code, run into one another",
      `/confirm-subscription/${SUBSCRIBER_ID}?verification-token=`.repeat(
        Math.ceil(LENGTH / 78),
      ),
    ],
    ["digits alone", "7".repeat(LENGTH)],
  ])(
    "%s: answered in well under two seconds",
    (_label: string, text: string) => {
      const timed: FastestRun<string> = fastestRun({
        run: (): string => {
          return StatusPageSubscriberUnsubscribe.redactCredentials(text);
        },
        limitInMs: 2000,
      });
      const result: string = timed.result;

      expect(timed.inMs).toBeLessThan(2000);
      expect(result).toBe(text);
    },
  );

  test("a confirmation link whose code runs on: the code's 64 characters go, the rest is kept, in well under two seconds", () => {
    const timed: FastestRun<string> = fastestRun({
      run: (): string => {
        return StatusPageSubscriberUnsubscribe.redactCredentials(
          `/confirm-subscription/${SUBSCRIBER_ID}?verification-token=${"f".repeat(LENGTH)}`,
        );
      },
      limitInMs: 2000,
    });
    const result: string = timed.result;

    expect(timed.inMs).toBeLessThan(2000);
    expect(result).toBe(
      `/confirm-subscription/${SUBSCRIBER_ID}?verification-token=[redacted]${"f".repeat(LENGTH - 64)}`,
    );
  });

  test("a long text full of real links: every token goes, in well under two seconds", () => {
    const manage: string = `/update-subscription/${SUBSCRIBER_ID}-${TOKEN} `;
    const unsubscribe: string = `/unsubscribe/${SUBSCRIBER_ID}-${TOKEN} `;
    const text: string = `${manage}${unsubscribe}`.repeat(
      Math.ceil(LENGTH / (manage.length + unsubscribe.length)),
    );

    const timed: FastestRun<string> = fastestRun({
      run: (): string => {
        return StatusPageSubscriberUnsubscribe.redactCredentials(text);
      },
      limitInMs: 2000,
    });
    const result: string = timed.result;

    expect(timed.inMs).toBeLessThan(2000);
    expect(result).not.toContain(TOKEN);
    expect(result).toContain(
      `/update-subscription/${SUBSCRIBER_ID}-[redacted]`,
    );
    expect(result).toContain(`/unsubscribe/${SUBSCRIBER_ID}-[redacted]`);
  });
});
