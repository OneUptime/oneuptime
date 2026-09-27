import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import { StatusPageExclusionReason } from "../../../../Server/Utils/StatusPage/StatusPageExclusion";
import SubscriberNotificationDeliveryRecord, {
  StatusPageDeliverySkipReason,
  SubscriberNotificationRetryScope,
} from "../../../../Server/Utils/StatusPage/SubscriberNotificationDeliveryRecord";
import SubscriberNotificationTiming from "../../../../Server/Utils/StatusPage/SubscriberNotificationTiming";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../Types/JSON";
import logger from "../../../../Server/Utils/Logger";
import Email from "../../../../Types/Email";
import ObjectID from "../../../../Types/ObjectID";
import Phone from "../../../../Types/Phone";
import StatusPageSubscriberNotificationMethod from "../../../../Types/StatusPage/StatusPageSubscriberNotificationMethod";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * The per-send record the incident and episode subscriber jobs keep: it
 * decides whether an email or SMS goes to an address already sent it in this
 * send (only for scoped incidents), and it writes what the send did on each
 * status page for the feed item.
 */

const SITE_03: string = "b0000000-0000-4000-8000-000000000003";
const SITE_07: string = "b0000000-0000-4000-8000-000000000007";
const SITE_09: string = "b0000000-0000-4000-8000-000000000009";

function page(id: string, name: string, pageTitle?: string): StatusPage {
  const statusPage: StatusPage = new StatusPage();
  statusPage._id = id;
  statusPage.name = name;

  if (pageTitle) {
    statusPage.pageTitle = pageTitle;
  }

  return statusPage;
}

const site03: StatusPage = page(SITE_03, "Site 03");
const site07: StatusPage = page(SITE_07, "Site 07");
const site09: StatusPage = page(SITE_09, "Site 09");

describe("SubscriberNotificationDeliveryRecord email and SMS dedupe", () => {
  test("for a scoped send, an address gets one email however many pages it is on", () => {
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: true });

    expect(
      record.shouldSendEmail({
        statusPage: site03,
        email: new Email("manager@acme.com"),
      }),
    ).toBe(true);
    expect(
      record.shouldSendEmail({
        statusPage: site07,
        email: new Email("manager@acme.com"),
      }),
    ).toBe(false);
  });

  test("addresses match whatever their case and surrounding space", () => {
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: true });

    expect(
      record.shouldSendEmail({
        statusPage: site03,
        email: "Manager@Acme.com ",
      }),
    ).toBe(true);
    expect(
      record.shouldSendEmail({ statusPage: site07, email: "manager@acme.com" }),
    ).toBe(false);
  });

  test("phone numbers match however they are formatted", () => {
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: true });

    expect(
      record.shouldSendSms({
        statusPage: site03,
        phone: new Phone("+15555550100"),
      }),
    ).toBe(true);
    expect(
      record.shouldSendSms({ statusPage: site07, phone: "+1 (555) 555-0100" }),
    ).toBe(false);
    // A different number still gets its SMS.
    expect(
      record.shouldSendSms({ statusPage: site07, phone: "+15555550101" }),
    ).toBe(true);
  });

  test("a leading + is part of the number", () => {
    expect(
      SubscriberNotificationDeliveryRecord.normalizePhone("+1 555 0100"),
    ).toBe("+15550100");
    expect(
      SubscriberNotificationDeliveryRecord.normalizePhone("1 555 0100"),
    ).toBe("15550100");
  });

  test("email and SMS are deduplicated separately", () => {
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: true });

    expect(
      record.shouldSendEmail({ statusPage: site03, email: "a@acme.com" }),
    ).toBe(true);
    expect(
      record.shouldSendSms({ statusPage: site03, phone: "+15555550100" }),
    ).toBe(true);
    expect(
      record.shouldSendSms({ statusPage: site07, phone: "+15555550100" }),
    ).toBe(false);
    expect(
      record.shouldSendEmail({ statusPage: site07, email: "b@acme.com" }),
    ).toBe(true);
  });

  test("for an unscoped send, every subscription gets its message, as before", () => {
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: false });

    for (const statusPage of [site03, site07, site09]) {
      expect(
        record.shouldSendEmail({ statusPage, email: "manager@acme.com" }),
      ).toBe(true);
      expect(record.shouldSendSms({ statusPage, phone: "+15555550100" })).toBe(
        true,
      );
    }

    expect(record.toMarkdown()).not.toContain("Not sent again");
  });

  test("addresses are remembered for one send only", () => {
    const first: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: true });
    first.shouldSendEmail({ statusPage: site03, email: "a@acme.com" });

    const second: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: true });

    expect(
      second.shouldSendEmail({ statusPage: site07, email: "a@acme.com" }),
    ).toBe(true);
  });
});

describe("SubscriberNotificationDeliveryRecord counts", () => {
  test("counts what was sent on each page and channel", () => {
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: false });

    record.startStatusPage(site03);
    record.recordSent({
      statusPage: site03,
      method: StatusPageSubscriberNotificationMethod.Email,
      subject: "[Incident] Checkout down",
    });
    record.recordSent({
      statusPage: site03,
      method: StatusPageSubscriberNotificationMethod.Email,
      subject: "[Incident] Something else",
    });
    record.recordSent({
      statusPage: site03,
      method: StatusPageSubscriberNotificationMethod.Webhook,
    });

    expect(record.getSentCount(SITE_03)).toBe(3);
    expect(record.getSentCount(new ObjectID(SITE_03.toUpperCase()))).toBe(3);
    expect(
      record.getSentCount(
        SITE_03,
        StatusPageSubscriberNotificationMethod.Email,
      ),
    ).toBe(2);
    // The first subject sent on the page is the one recorded.
    expect(record.getSubject(SITE_03)).toBe("[Incident] Checkout down");
    expect(record.getSentCount(SITE_07)).toBe(0);
    expect(record.getFailedCount(SITE_03)).toBe(0);
    expect(record.hasAttemptedAny()).toBe(true);
  });

  test("a subject carrying a subscriber's unsubscribe link is recorded with its token redacted", () => {
    /*
     * A custom subject template can use {{unsubscribeUrl}}. The feed is read
     * by everyone who can read the incident; the token belongs to the one
     * subscriber the email went to, and cancels its subscription.
     */
    const token: string = "3e".repeat(32);
    const subscriberId: string = "c0000000-0000-4000-8000-000000000001";

    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: false });

    record.startStatusPage(site03);
    record.recordSent({
      statusPage: site03,
      method: StatusPageSubscriberNotificationMethod.Email,
      subject: `Checkout down - stop: https://status.acme.com/unsubscribe/${subscriberId}-${token}`,
    });

    expect(record.getSubject(SITE_03)).toBe(
      `Checkout down - stop: https://status.acme.com/unsubscribe/${subscriberId}-[redacted]`,
    );
    expect(record.toMarkdown()).not.toContain(token);
  });

  test("a record with nothing sent or tried says so", () => {
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: true });

    record.startStatusPage(site03);

    expect(record.hasAttemptedAny()).toBe(false);
  });
});

describe("SubscriberNotificationDeliveryRecord.toMarkdown", () => {
  test("lists each page with what was sent and the subject, in the order visited", () => {
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: false });

    record.startStatusPage(site07);
    for (let i: number = 0; i < 18; i++) {
      record.recordSent({
        statusPage: site07,
        method: StatusPageSubscriberNotificationMethod.Email,
        subject: "[Incident] Checkout down",
      });
    }
    record.startStatusPage(site03);
    record.recordSent({
      statusPage: site03,
      method: StatusPageSubscriberNotificationMethod.SMS,
    });
    record.recordSent({
      statusPage: site03,
      method: StatusPageSubscriberNotificationMethod.Slack,
    });
    record.recordSent({
      statusPage: site03,
      method: StatusPageSubscriberNotificationMethod.MicrosoftTeams,
    });

    expect(record.toMarkdown()).toBe(
      [
        "**Status pages:**",
        "",
        '- **Site 07**: 18 email sent. Subject: "\\[Incident\\] Checkout down".',
        "- **Site 03**: 1 SMS, 1 Slack, 1 Microsoft Teams sent.",
      ].join("\n"),
    );
  });

  test("says how many addresses were not sent it again, and why", () => {
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: true });

    record.startStatusPage(site03);
    record.shouldSendEmail({ statusPage: site03, email: "a@acme.com" });
    record.recordSent({
      statusPage: site03,
      method: StatusPageSubscriberNotificationMethod.Email,
      subject: "Down",
    });
    record.shouldSendSms({ statusPage: site03, phone: "+15555550100" });
    record.recordSent({
      statusPage: site03,
      method: StatusPageSubscriberNotificationMethod.SMS,
    });

    record.startStatusPage(site07);
    record.shouldSendEmail({ statusPage: site07, email: "a@acme.com" });
    record.shouldSendSms({ statusPage: site07, phone: "+15555550100" });
    // The webhook on the same page is not deduplicated.
    record.recordSent({
      statusPage: site07,
      method: StatusPageSubscriberNotificationMethod.Webhook,
    });

    const markdown: string = record.toMarkdown();

    expect(markdown).toContain(
      "- **Site 07**: 1 webhook sent. Not sent again to 1 email address and 1 phone number already sent it through another status page.",
    );
    expect(markdown).toContain(
      "Email and SMS were sent once per address across these status pages",
    );
  });

  test("names the pages passed over and why", () => {
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: false });

    record.skipStatusPage(site03, StatusPageDeliverySkipReason.AlreadyNotified);
    record.skipStatusPage(site07, StatusPageDeliverySkipReason.HidesIncidents);
    record.skipStatusPage(site09, StatusPageDeliverySkipReason.HidesEpisodes);

    expect(record.toMarkdown()).toBe(
      [
        "**Status pages:**",
        "",
        "- **Site 03**: not sent again, its subscribers were already sent this notification.",
        "- **Site 07**: not sent, this status page does not show incidents.",
        "- **Site 09**: not sent, this status page does not show episodes.",
      ].join("\n"),
    );
  });

  test("a page that failed part-way keeps its counts and says it failed", () => {
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: false });

    record.startStatusPage(site03);
    record.recordSent({
      statusPage: site03,
      method: StatusPageSubscriberNotificationMethod.Email,
      subject: "Down",
    });
    record.skipStatusPage(site03, StatusPageDeliverySkipReason.Failed);

    record.skipStatusPage(site07, StatusPageDeliverySkipReason.Failed);

    const markdown: string = record.toMarkdown();

    expect(markdown).toContain(
      '- **Site 03**: 1 email sent. Sending to this status page failed part-way, so some of its subscribers may not have been sent it. Subject: "Down".',
    );
    expect(markdown).toContain(
      "- **Site 07**: nothing sent. Sending to this status page failed part-way",
    );
  });

  test("a page whose every address was already sent it says nothing new was sent", () => {
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: true });

    record.shouldSendEmail({ statusPage: site03, email: "a@acme.com" });
    record.recordSent({
      statusPage: site03,
      method: StatusPageSubscriberNotificationMethod.Email,
    });
    record.startStatusPage(site07);
    record.shouldSendEmail({ statusPage: site07, email: "a@acme.com" });

    expect(record.toMarkdown()).toContain(
      "- **Site 07**: nothing sent. Not sent again to 1 email address already sent it through another status page.",
    );
  });

  test("a page where no subscriber matched says so", () => {
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: false });

    record.startStatusPage(site09);

    expect(record.toMarkdown()).toContain(
      "- **Site 09**: nothing sent, no subscriber matched.",
    );
  });

  test("names the pages the scope left out, by reason", () => {
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: true });

    record.addExcludedStatusPages([
      {
        statusPage: site07,
        reason: StatusPageExclusionReason.OutsideIncidentScope,
      },
      {
        statusPage: site09,
        reason: StatusPageExclusionReason.OnlyShowsScopedIncidents,
      },
      {
        statusPage: site03,
        reason: StatusPageExclusionReason.OutsideIncidentScope,
      },
    ]);

    expect(record.toMarkdown()).toBe(
      [
        "**Not sent to 2 status pages outside the status pages this is limited to:** Site 07, Site 03.",
        "**Not sent to 1 status page that only shows incidents limited to it:** Site 09.",
      ].join("\n\n"),
    );
  });

  test("a long list of left-out pages is cut short", () => {
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: false });

    record.addExcludedStatusPages(
      Array.from({ length: 30 }, (_v: unknown, i: number) => {
        return {
          statusPage: page(
            `b0000000-0000-4000-8000-0000000001${i.toString().padStart(2, "0")}`,
            `Site ${i + 1}`,
          ),
          reason: StatusPageExclusionReason.OnlyShowsScopedIncidents,
        };
      }),
    );

    const markdown: string = record.toMarkdown();

    expect(markdown).toContain("**Not sent to 30 status pages");
    expect(markdown).toContain("Site 25, and 5 more.");
    expect(markdown).not.toContain("Site 26");
  });

  test("page names and subjects cannot turn into Markdown or break the line", () => {
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: false });

    const tricky: StatusPage = page(SITE_03, "*Internal* [ops]");
    record.startStatusPage(tricky);
    record.recordSent({
      statusPage: tricky,
      method: StatusPageSubscriberNotificationMethod.Email,
      subject: "Line one\nLine _two_ <b>",
    });

    const markdown: string = record.toMarkdown();

    expect(markdown).toContain("**\\*Internal\\* \\[ops\\]**");
    expect(markdown).toContain('Subject: "Line one Line \\_two\\_ \\<b\\>".');
    expect(markdown.split("\n")).toHaveLength(3);
  });

  test("a page goes by its name, then its public title", () => {
    expect(
      SubscriberNotificationDeliveryRecord.getStatusPageName(
        page(SITE_03, "", "Acme Status"),
      ),
    ).toBe("Acme Status");
    expect(
      SubscriberNotificationDeliveryRecord.getStatusPageName(
        page(SITE_03, "Site 03", "Acme Status"),
      ),
    ).toBe("Site 03");
    expect(
      SubscriberNotificationDeliveryRecord.getStatusPageName(page(SITE_03, "")),
    ).toBe("Untitled status page");
  });

  test("an empty record has nothing to say", () => {
    expect(
      new SubscriberNotificationDeliveryRecord({
        dedupeEmailAndSms: true,
      }).toMarkdown(),
    ).toBe("");
  });
});

/*
 * Delivery: each message is awaited and counted sent or failed. A send
 * fails when it throws, when it answers with an HTTPErrorResponse (the
 * Notification service's email and SMS endpoints, and the Slack and webhook
 * senders, return one rather than throw), when it throws the response itself
 * (the Microsoft Teams sender does), or when it does not answer in time.
 */
describe("SubscriberNotificationDeliveryRecord.deliver", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  function quietLogger(): SpyInstance<typeof logger.error> {
    return jest.spyOn(logger, "error").mockImplementation((): void => {});
  }

  const failures: Array<[string, () => Promise<unknown>]> = [
    [
      "throws an error",
      (): Promise<unknown> => {
        return Promise.reject(new Error("connect ECONNREFUSED"));
      },
    ],
    [
      "answers with an HTTPErrorResponse",
      (): Promise<unknown> => {
        return Promise.resolve(
          new HTTPErrorResponse(500, { message: "SMTP rejected" }, {}),
        );
      },
    ],
    [
      "throws an HTTPErrorResponse",
      (): Promise<unknown> => {
        return Promise.reject(
          new HTTPErrorResponse(400, { message: "Bad Request" }, {}),
        );
      },
    ],
    [
      "rejects with nothing at all",
      (): Promise<unknown> => {
        return Promise.reject(null);
      },
    ],
    [
      "throws before it starts",
      (): Promise<unknown> => {
        throw new Error("Slack Webhook URL must start with https://");
      },
    ],
  ];

  for (const [label, send] of failures) {
    test(`a send that ${label} is counted failed, and logged as the subscriber's side of the wire`, async () => {
      const error: SpyInstance<typeof logger.error> = quietLogger();
      const record: SubscriberNotificationDeliveryRecord =
        new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: false });

      record.startStatusPage(site03);

      await expect(
        record.deliver({
          statusPage: site03,
          method: StatusPageSubscriberNotificationMethod.Webhook,
          send: send,
          logAttributes: { projectId: "p1" },
        }),
      ).resolves.toBe(false);

      expect(record.getFailedCount(SITE_03)).toBe(1);
      expect(
        record.getFailedCount(
          SITE_03,
          StatusPageSubscriberNotificationMethod.Webhook,
        ),
      ).toBe(1);
      expect(record.getSentCount(SITE_03)).toBe(0);
      expect(record.hasFailures()).toBe(true);
      expect(record.hasAttemptedAny()).toBe(true);

      expect(error).toHaveBeenCalledTimes(1);
      const attributes: JSONObject = error.mock.calls[0]![1] as JSONObject;
      expect(attributes["projectId"]).toBe("p1");
      // Tagged a user error: a subscriber's dead endpoint is not our defect.
      expect(Object.keys(attributes).length).toBeGreaterThan(1);
    });
  }

  test("a send that answers is counted sent, whatever it answers with", async () => {
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: false });

    record.startStatusPage(site03);

    for (const answer of [
      undefined,
      new HTTPResponse(200, {}, {}),
      new HTTPResponse(202, { queued: true }, {}),
    ]) {
      await expect(
        record.deliver({
          statusPage: site03,
          method: StatusPageSubscriberNotificationMethod.Email,
          send: (): Promise<unknown> => {
            return Promise.resolve(answer);
          },
        }),
      ).resolves.toBe(true);
    }

    expect(record.getSentCount(SITE_03)).toBe(3);
    expect(record.getFailedCount(SITE_03)).toBe(0);
    expect(record.hasFailures()).toBe(false);
  });

  test("a send that does not answer in time is counted failed, and stops being waited for", async () => {
    quietLogger();
    jest.useFakeTimers();

    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({
        dedupeEmailAndSms: false,
        sendTimeoutInMs: 1000,
      });

    record.startStatusPage(site03);

    const delivered: Promise<boolean> = record.deliver({
      statusPage: site03,
      method: StatusPageSubscriberNotificationMethod.Webhook,
      send: (): Promise<unknown> => {
        return new Promise(() => {});
      },
    });

    jest.advanceTimersByTime(1000);

    await expect(delivered).resolves.toBe(false);
    expect(record.getFailedCount(SITE_03)).toBe(1);
  });

  test("waits the send timeout by default: longer than any sender's own retries", () => {
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: false });

    expect(
      (record as unknown as { sendTimeoutInMs: number }).sendTimeoutInMs,
    ).toBe(SubscriberNotificationTiming.SEND_TIMEOUT_IN_MS);
  });

  test("an email's subject is recorded whether it was sent or failed", async () => {
    quietLogger();
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: false });

    record.startStatusPage(site03);
    await record.deliver({
      statusPage: site03,
      method: StatusPageSubscriberNotificationMethod.Email,
      subject: "[Incident] Checkout down",
      send: (): Promise<unknown> => {
        return Promise.reject(new Error("no"));
      },
    });

    expect(record.getSubject(SITE_03)).toBe("[Incident] Checkout down");
  });
});

describe("SubscriberNotificationDeliveryRecord pages sent in full", () => {
  function recordWith(): SubscriberNotificationDeliveryRecord {
    return new SubscriberNotificationDeliveryRecord({
      dedupeEmailAndSms: false,
    });
  }

  test("a page whose every subscriber was reached, with nothing failed, succeeded", () => {
    const record: SubscriberNotificationDeliveryRecord = recordWith();

    record.startStatusPage(site03);
    record.recordSent({
      statusPage: site03,
      method: StatusPageSubscriberNotificationMethod.Email,
    });
    record.finishStatusPage(site03);

    expect(record.didStatusPageSucceed(SITE_03)).toBe(true);
    expect(record.hasFailures()).toBe(false);
  });

  test("a page with no matching subscriber that was read in full succeeded: nobody is owed it", () => {
    const record: SubscriberNotificationDeliveryRecord = recordWith();

    record.startStatusPage(site03);
    record.finishStatusPage(site03);

    expect(record.didStatusPageSucceed(SITE_03)).toBe(true);
  });

  test("one failed message means the page was not sent in full", () => {
    const record: SubscriberNotificationDeliveryRecord = recordWith();

    record.startStatusPage(site03);
    record.recordSent({
      statusPage: site03,
      method: StatusPageSubscriberNotificationMethod.Email,
    });
    record.recordFailed({
      statusPage: site03,
      method: StatusPageSubscriberNotificationMethod.Webhook,
    });
    record.finishStatusPage(site03);

    expect(record.didStatusPageSucceed(SITE_03)).toBe(false);
    expect(record.hasFailures()).toBe(true);
  });

  test.each([
    StatusPageDeliverySkipReason.Failed,
    StatusPageDeliverySkipReason.OutOfTime,
  ])(
    "a page the send stopped part-way through (%s) was not sent in full",
    (reason: StatusPageDeliverySkipReason) => {
      const record: SubscriberNotificationDeliveryRecord = recordWith();

      record.startStatusPage(site03);
      record.recordSent({
        statusPage: site03,
        method: StatusPageSubscriberNotificationMethod.Email,
      });
      record.skipStatusPage(site03, reason);

      expect(record.didStatusPageSucceed(SITE_03)).toBe(false);
      expect(record.hasFailures()).toBe(true);
    },
  );

  test("a page not read to the end did not succeed", () => {
    const record: SubscriberNotificationDeliveryRecord = recordWith();

    record.startStatusPage(site03);
    record.recordSent({
      statusPage: site03,
      method: StatusPageSubscriberNotificationMethod.Email,
    });

    expect(record.didStatusPageSucceed(SITE_03)).toBe(false);
  });

  test.each([
    StatusPageDeliverySkipReason.HidesIncidents,
    StatusPageDeliverySkipReason.HidesEpisodes,
    StatusPageDeliverySkipReason.AlreadyNotified,
  ])(
    "a page passed over (%s) neither succeeded nor counts as a shortfall",
    (reason: StatusPageDeliverySkipReason) => {
      const record: SubscriberNotificationDeliveryRecord = recordWith();

      record.skipStatusPage(site03, reason);

      expect(record.didStatusPageSucceed(SITE_03)).toBe(false);
      expect(record.hasFailures()).toBe(false);
    },
  );

  test("a page never started is unknown to the record", () => {
    expect(recordWith().didStatusPageSucceed(SITE_09)).toBe(false);
  });
});

describe("SubscriberNotificationDeliveryRecord sent and failed, in the feed and the status message", () => {
  function sent(
    record: SubscriberNotificationDeliveryRecord,
    statusPage: StatusPage,
    method: StatusPageSubscriberNotificationMethod,
    count: number,
  ): void {
    for (let i: number = 0; i < count; i++) {
      record.recordSent({ statusPage, method });
    }
  }

  function failed(
    record: SubscriberNotificationDeliveryRecord,
    statusPage: StatusPage,
    method: StatusPageSubscriberNotificationMethod,
    count: number,
  ): void {
    for (let i: number = 0; i < count; i++) {
      record.recordFailed({ statusPage, method });
    }
  }

  // Site 03: 41 email sent. Site 07: 16 email sent, 2 failed, 3 webhook sent.
  function partlyFailedSend(): SubscriberNotificationDeliveryRecord {
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: false });

    record.startStatusPage(site03);
    sent(record, site03, StatusPageSubscriberNotificationMethod.Email, 41);
    record.finishStatusPage(site03);

    record.startStatusPage(site07);
    sent(record, site07, StatusPageSubscriberNotificationMethod.Email, 16);
    failed(record, site07, StatusPageSubscriberNotificationMethod.Email, 2);
    sent(record, site07, StatusPageSubscriberNotificationMethod.Webhook, 3);
    record.finishStatusPage(site07);

    // Passed over: not in the status message, only in the feed.
    record.skipStatusPage(site09, StatusPageDeliverySkipReason.HidesIncidents);

    return record;
  }

  test("the feed lists each page with what was sent and what failed", () => {
    expect(partlyFailedSend().toMarkdown()).toBe(
      [
        "**Status pages:**",
        "",
        "- **Site 03**: 41 email sent.",
        "- **Site 07**: 16 email, 3 webhook sent; 2 email failed.",
        "- **Site 09**: not sent, this status page does not show incidents.",
      ].join("\n"),
    );
  });

  test("a page where every message failed says nothing was sent", () => {
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: false });

    record.startStatusPage(site03);
    failed(record, site03, StatusPageSubscriberNotificationMethod.SMS, 2);
    record.finishStatusPage(site03);

    expect(record.toMarkdown()).toContain(
      "- **Site 03**: nothing sent; 2 SMS failed.",
    );
  });

  test("the totals add up across pages", () => {
    expect(partlyFailedSend().getTotals()).toEqual({ sent: 60, failed: 2 });
  });

  test("a send that reached everyone: the job's line, then each page's counts", () => {
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: false });

    record.startStatusPage(site03);
    sent(record, site03, StatusPageSubscriberNotificationMethod.Email, 41);
    record.finishStatusPage(site03);
    record.startStatusPage(site07);
    sent(record, site07, StatusPageSubscriberNotificationMethod.Email, 18);
    sent(record, site07, StatusPageSubscriberNotificationMethod.SMS, 2);
    record.finishStatusPage(site07);
    record.skipStatusPage(site09, StatusPageDeliverySkipReason.AlreadyNotified);

    expect(
      record.toStatusMessage({
        sentMessage: "Notifications sent successfully to all subscribers.",
        retryScope: SubscriberNotificationRetryScope.EveryPage,
      }),
    ).toBe(
      "Notifications sent successfully to all subscribers. Site 03: 41 email sent. Site 07: 18 email, 2 SMS sent.",
    );
  });

  test("a send that fell short says how many failed, each page's counts, and that Retry sends to every page", () => {
    expect(
      partlyFailedSend().toStatusMessage({
        sentMessage: "Notifications sent successfully to all subscribers.",
        retryScope: SubscriberNotificationRetryScope.EveryPage,
      }),
    ).toBe(
      "Not every subscriber was sent this notification: 2 of 62 messages failed. Site 03: 41 email sent. Site 07: 16 email, 3 webhook sent; 2 email failed. Retry sends it again to every status page, including the subscribers who already got it.",
    );
  });

  test("for the created notification, Retry names the pages it will send to", () => {
    expect(
      partlyFailedSend().toStatusMessage({
        sentMessage: "Notifications sent successfully to all subscribers.",
        retryScope: SubscriberNotificationRetryScope.PagesNotYetSent,
      }),
    ).toBe(
      "Not every subscriber was sent this notification: 2 of 62 messages failed. Site 03: 41 email sent. Site 07: 16 email, 3 webhook sent; 2 email failed. Retry sends it again only to the status pages that were not sent it in full: Site 07.",
    );
  });

  test("a send that ran out of time says so, for the pages it stopped on and the ones it never reached", () => {
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: false });

    record.startStatusPage(site03);
    sent(record, site03, StatusPageSubscriberNotificationMethod.Email, 5);
    record.finishStatusPage(site03);
    record.startStatusPage(site07);
    sent(record, site07, StatusPageSubscriberNotificationMethod.Email, 3);
    record.skipStatusPage(site07, StatusPageDeliverySkipReason.OutOfTime);
    record.skipStatusPage(site09, StatusPageDeliverySkipReason.OutOfTime);

    expect(
      record.toStatusMessage({
        sentMessage: "Sent.",
        retryScope: SubscriberNotificationRetryScope.PagesNotYetSent,
      }),
    ).toBe(
      "Not every subscriber was sent this notification. The send ran out of time before it reached every subscriber. Site 03: 5 email sent. Site 07: 3 email sent, then the send ran out of time. Site 09: not sent, the send ran out of time before it reached this status page. Retry sends it again only to the status pages that were not sent it in full: Site 07 and Site 09.",
    );

    expect(record.toMarkdown()).toBe(
      [
        "**Status pages:**",
        "",
        "- **Site 03**: 5 email sent.",
        "- **Site 07**: 3 email sent. The send ran out of time part-way through this status page, so some of its subscribers were not sent it.",
        "- **Site 09**: not sent, the send ran out of time before it reached this status page.",
      ].join("\n"),
    );
  });

  test("a page that failed part-way says so in the status message", () => {
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: false });

    record.startStatusPage(site03);
    sent(record, site03, StatusPageSubscriberNotificationMethod.Email, 2);
    record.skipStatusPage(site03, StatusPageDeliverySkipReason.Failed);

    expect(
      record.toStatusMessage({
        sentMessage: "Sent.",
        retryScope: SubscriberNotificationRetryScope.EveryPage,
      }),
    ).toBe(
      "Not every subscriber was sent this notification. Sending to a status page failed part-way. Site 03: 2 email sent, then sending failed part-way. Retry sends it again to every status page, including the subscribers who already got it.",
    );
  });

  test("a long list of pages is cut short in the status message", () => {
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: false });

    for (let i: number = 1; i <= 30; i++) {
      const site: StatusPage = page(
        `b0000000-0000-4000-8000-0000000002${i.toString().padStart(2, "0")}`,
        `Site ${i}`,
      );
      record.startStatusPage(site);
      sent(record, site, StatusPageSubscriberNotificationMethod.Email, 1);
      record.finishStatusPage(site);
    }

    const message: string = record.toStatusMessage({
      sentMessage: "Sent.",
      retryScope: SubscriberNotificationRetryScope.EveryPage,
    });

    expect(message).toContain("Site 25: 1 email sent.");
    expect(message).not.toContain("Site 26:");
    expect(message).toContain("And 5 more status pages.");
  });

  test("the status message is plain text on one line, page names as written", () => {
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: false });
    const tricky: StatusPage = page(SITE_03, "*Internal*\nops");

    record.startStatusPage(tricky);
    sent(record, tricky, StatusPageSubscriberNotificationMethod.Email, 1);
    record.finishStatusPage(tricky);

    expect(
      record.toStatusMessage({
        sentMessage: "Sent.",
        retryScope: SubscriberNotificationRetryScope.EveryPage,
      }),
    ).toBe("Sent. *Internal* ops: 1 email sent.");
  });

  test("with nothing to report, the status message is the job's line alone", () => {
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: false });

    record.skipStatusPage(site03, StatusPageDeliverySkipReason.HidesIncidents);

    expect(
      record.toStatusMessage({
        sentMessage: "Sent.",
        retryScope: SubscriberNotificationRetryScope.EveryPage,
      }),
    ).toBe("Sent.");
  });

  test("records whether any subscriber's preferences let the send through", () => {
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: false });

    expect(record.hasMatchedAnySubscriber()).toBe(false);
    record.recordSubscriberMatched();
    expect(record.hasMatchedAnySubscriber()).toBe(true);
  });
});
