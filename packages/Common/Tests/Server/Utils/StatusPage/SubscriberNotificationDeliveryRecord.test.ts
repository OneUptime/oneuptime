import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import { StatusPageExclusionReason } from "../../../../Server/Utils/StatusPage/StatusPageExclusion";
import SubscriberNotificationDeliveryRecord, {
  StatusPageDeliverySkipReason,
} from "../../../../Server/Utils/StatusPage/SubscriberNotificationDeliveryRecord";
import Email from "../../../../Types/Email";
import ObjectID from "../../../../Types/ObjectID";
import Phone from "../../../../Types/Phone";
import StatusPageSubscriberNotificationMethod from "../../../../Types/StatusPage/StatusPageSubscriberNotificationMethod";
import { describe, expect, test } from "@jest/globals";

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
  test("counts what was queued on each page and channel", () => {
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: false });

    record.startStatusPage(site03);
    record.recordQueued({
      statusPage: site03,
      method: StatusPageSubscriberNotificationMethod.Email,
      subject: "[Incident] Checkout down",
    });
    record.recordQueued({
      statusPage: site03,
      method: StatusPageSubscriberNotificationMethod.Email,
      subject: "[Incident] Something else",
    });
    record.recordQueued({
      statusPage: site03,
      method: StatusPageSubscriberNotificationMethod.Webhook,
    });

    expect(record.getQueuedCount(SITE_03)).toBe(3);
    expect(record.getQueuedCount(new ObjectID(SITE_03.toUpperCase()))).toBe(3);
    expect(
      record.getQueuedCountForMethod(
        SITE_03,
        StatusPageSubscriberNotificationMethod.Email,
      ),
    ).toBe(2);
    // The first subject queued on the page is the one recorded.
    expect(record.getSubject(SITE_03)).toBe("[Incident] Checkout down");
    expect(record.getQueuedCount(SITE_07)).toBe(0);
    expect(record.hasQueuedAny()).toBe(true);
  });

  test("a record with nothing queued says so", () => {
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: true });

    record.startStatusPage(site03);

    expect(record.hasQueuedAny()).toBe(false);
  });
});

describe("SubscriberNotificationDeliveryRecord.toMarkdown", () => {
  test("lists each page with what was queued and the subject, in the order visited", () => {
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: false });

    record.startStatusPage(site07);
    for (let i: number = 0; i < 18; i++) {
      record.recordQueued({
        statusPage: site07,
        method: StatusPageSubscriberNotificationMethod.Email,
        subject: "[Incident] Checkout down",
      });
    }
    record.startStatusPage(site03);
    record.recordQueued({
      statusPage: site03,
      method: StatusPageSubscriberNotificationMethod.SMS,
    });
    record.recordQueued({
      statusPage: site03,
      method: StatusPageSubscriberNotificationMethod.Slack,
    });
    record.recordQueued({
      statusPage: site03,
      method: StatusPageSubscriberNotificationMethod.MicrosoftTeams,
    });

    expect(record.toMarkdown()).toBe(
      [
        "**Status pages:**",
        "",
        '- **Site 07**: 18 email queued. Subject: "\\[Incident\\] Checkout down".',
        "- **Site 03**: 1 SMS, 1 Slack, 1 Microsoft Teams queued.",
      ].join("\n"),
    );
  });

  test("says how many addresses were not sent it again, and why", () => {
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: true });

    record.startStatusPage(site03);
    record.shouldSendEmail({ statusPage: site03, email: "a@acme.com" });
    record.recordQueued({
      statusPage: site03,
      method: StatusPageSubscriberNotificationMethod.Email,
      subject: "Down",
    });
    record.shouldSendSms({ statusPage: site03, phone: "+15555550100" });
    record.recordQueued({
      statusPage: site03,
      method: StatusPageSubscriberNotificationMethod.SMS,
    });

    record.startStatusPage(site07);
    record.shouldSendEmail({ statusPage: site07, email: "a@acme.com" });
    record.shouldSendSms({ statusPage: site07, phone: "+15555550100" });
    // The webhook on the same page is not deduplicated.
    record.recordQueued({
      statusPage: site07,
      method: StatusPageSubscriberNotificationMethod.Webhook,
    });

    const markdown: string = record.toMarkdown();

    expect(markdown).toContain(
      "- **Site 07**: 1 webhook queued. Not sent again to 1 email address and 1 phone number already sent it through another status page.",
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
    record.recordQueued({
      statusPage: site03,
      method: StatusPageSubscriberNotificationMethod.Email,
      subject: "Down",
    });
    record.skipStatusPage(site03, StatusPageDeliverySkipReason.Failed);

    record.skipStatusPage(site07, StatusPageDeliverySkipReason.Failed);

    const markdown: string = record.toMarkdown();

    expect(markdown).toContain(
      '- **Site 03**: 1 email queued. Sending to this status page failed part-way, so some of its subscribers may not have been sent it. Subject: "Down".',
    );
    expect(markdown).toContain(
      "- **Site 07**: nothing queued. Sending to this status page failed part-way",
    );
  });

  test("a page whose every address was already sent it says nothing new was queued", () => {
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: true });

    record.shouldSendEmail({ statusPage: site03, email: "a@acme.com" });
    record.recordQueued({
      statusPage: site03,
      method: StatusPageSubscriberNotificationMethod.Email,
    });
    record.startStatusPage(site07);
    record.shouldSendEmail({ statusPage: site07, email: "a@acme.com" });

    expect(record.toMarkdown()).toContain(
      "- **Site 07**: nothing queued. Not sent again to 1 email address already sent it through another status page.",
    );
  });

  test("a page where no subscriber matched says so", () => {
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: false });

    record.startStatusPage(site09);

    expect(record.toMarkdown()).toContain(
      "- **Site 09**: nothing queued, no subscriber matched.",
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
    record.recordQueued({
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
