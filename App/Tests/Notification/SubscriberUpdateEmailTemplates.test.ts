import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * When an editor asks for it, subscribers are told that an announcement or a
 * public note they already heard about has changed. Those emails use their
 * own templates, so the message says "updated" instead of posing as a brand
 * new post - the confusion this feature exists to avoid. Each updated
 * template is checked against its "created" twin: same details, same
 * navigation, different framing.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "../../FeatureSet/Notification/Templates",
);

const handlebars: typeof Handlebars = Handlebars.create();

const STATUS_URL: string = "https://status.example.com";
const DETAILS_URL: string = "https://status.example.com/announcements/42";
const UNSUBSCRIBE_URL: string =
  "https://status.example.com/update-subscription/sub-1";
const NOTE_HTML: string =
  "<p>The failover finished at <strong>10:42 UTC</strong>.</p>";

const VARIABLES: Record<string, string> = {
  statusPageName: "Acme Status",
  statusPageUrl: STATUS_URL,
  detailsUrl: DETAILS_URL,
  unsubscribeUrl: UNSUBSCRIBE_URL,
  logoUrl: "",
  isPublicStatusPage: "true",
  subscriberEmailNotificationFooterText: "Questions? Reply to this email.",
  announcementTitle: "Planned database maintenance",
  announcementDescription:
    "<p>The maintenance now starts on <strong>Sunday</strong>.</p>",
  incidentTitle: "Checkout requests failing",
  incidentSeverity: "Critical",
  incidentDescription: "Payments fail in Europe.",
  episodeTitle: "Regional network interruption",
  episodeSeverity: "Major",
  eventTitle: "Database engine upgrade",
  eventDescription: "The database engine will be upgraded.",
  resourcesAffected: "Checkout API, Search API",
  note: NOTE_HTML,
  year: "2026",
};

interface TemplatePair {
  created: EmailTemplateType;
  updated: EmailTemplateType;
  title: string;
  updatedIntro: string;
  createdIntro: string;
}

const TEMPLATE_PAIRS: Array<TemplatePair> = [
  {
    created: EmailTemplateType.SubscriberAnnouncementCreated,
    updated: EmailTemplateType.SubscriberAnnouncementUpdated,
    title: "Planned database maintenance",
    updatedIntro:
      "An announcement on Acme Status has been updated. Here is the latest version.",
    createdIntro: "A new announcement has been posted for Acme Status.",
  },
  {
    created: EmailTemplateType.SubscriberIncidentNoteCreated,
    updated: EmailTemplateType.SubscriberIncidentNoteUpdated,
    title: "Incident: Checkout requests failing",
    updatedIntro:
      "A note on this incident has been updated. Here is the latest version:",
    createdIntro: "A new note has been added to the incident.",
  },
  {
    created: EmailTemplateType.SubscriberScheduledMaintenanceEventNoteCreated,
    updated: EmailTemplateType.SubscriberScheduledMaintenanceEventNoteUpdated,
    title: "Scheduled Maintenance Event: Database engine upgrade",
    updatedIntro:
      "A note on this scheduled event has been updated. Here is the latest version:",
    createdIntro: "Here are more details for this scheduled event:",
  },
  {
    created: EmailTemplateType.SubscriberEpisodeNoteCreated,
    updated: EmailTemplateType.SubscriberEpisodeNoteUpdated,
    title: "Incident: Regional network interruption",
    updatedIntro:
      "A note on this incident has been updated. Here is the latest version:",
    createdIntro: "A new note has been added to the incident.",
  },
];

function render(
  template: EmailTemplateType,
  overrides: Record<string, unknown> = {},
): string {
  return handlebars.compile(
    fs.readFileSync(Path.join(TEMPLATES_DIR, template), "utf8"),
  )({ ...VARIABLES, ...overrides });
}

// The label/value pairs of the detail card, in order.
function detailLabels(html: string): Array<string> {
  return Array.from(
    html.matchAll(/<p class="st-DetailCard-label"[^>]*>([^<]*)<\/p>/g),
    (match: RegExpMatchArray): string => {
      return match[1]!.replace(/[:\s]+$/, "").trim();
    },
  );
}

function hrefs(html: string): Array<string> {
  return Array.from(
    html.matchAll(/<a\b[^>]*href="([^"]*)"/g),
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

function heading(html: string): string {
  const match: RegExpMatchArray | null = html.match(
    /<h1 class="st-EmailTitle"[^>]*>([\s\S]*?)<\/h1>/,
  );

  return (match?.[1] || "").trim();
}

beforeAll(() => {
  const partialsDir: string = Path.join(TEMPLATES_DIR, "Partials");

  for (const filename of fs.readdirSync(partialsDir)) {
    if (filename.endsWith(".hbs")) {
      handlebars.registerPartial(
        filename.slice(0, -4),
        fs.readFileSync(Path.join(partialsDir, filename), "utf8"),
      );
    }
  }

  // Same semantics as App/FeatureSet/Notification/Utils/Handlebars.ts.
  handlebars.registerHelper("concat", (...args: Array<unknown>): string => {
    return args
      .slice(0, -1)
      .map((value: unknown): string => {
        return value === null || value === undefined ? "" : String(value);
      })
      .join("");
  });
});

describe("subscriber update email templates", () => {
  test.each(TEMPLATE_PAIRS)(
    "$updated exists on disk for its EmailTemplateType",
    (pair: TemplatePair) => {
      expect(fs.existsSync(Path.join(TEMPLATES_DIR, pair.updated))).toBe(true);
      expect(pair.updated).not.toBe(pair.created);
    },
  );

  test.each(TEMPLATE_PAIRS)(
    "$updated says the content was updated",
    (pair: TemplatePair) => {
      const html: string = render(pair.updated);

      expect(html).toContain(pair.updatedIntro);
      expect(html).not.toContain(pair.createdIntro);
    },
  );

  test.each(TEMPLATE_PAIRS)(
    "$created keeps its original wording",
    (pair: TemplatePair) => {
      const html: string = render(pair.created);

      expect(html).toContain(pair.createdIntro);
      expect(html).not.toMatch(/has been updated/i);
    },
  );

  test.each(TEMPLATE_PAIRS)(
    "$updated keeps the same heading subject as $created",
    (pair: TemplatePair) => {
      expect(heading(render(pair.updated))).toContain(pair.title);
      expect(heading(render(pair.created))).toContain(pair.title);
    },
  );

  test.each(TEMPLATE_PAIRS)(
    "$updated shows the same details as $created, with the note marked as updated",
    (pair: TemplatePair) => {
      const createdLabels: Array<string> = detailLabels(render(pair.created));
      const updatedLabels: Array<string> = detailLabels(render(pair.updated));

      expect(updatedLabels).toEqual(
        createdLabels.map((label: string): string => {
          return label === "Note" ? "Updated Note" : label;
        }),
      );
    },
  );

  test.each(TEMPLATE_PAIRS)(
    "$updated links to the same places as $created",
    (pair: TemplatePair) => {
      expect(hrefs(render(pair.updated))).toEqual(hrefs(render(pair.created)));
      expect(hrefs(render(pair.updated))).toContain(UNSUBSCRIBE_URL);
    },
  );

  test.each(TEMPLATE_PAIRS)(
    "$updated falls back to the status page link without a details URL",
    (pair: TemplatePair) => {
      const html: string = render(pair.updated, { detailsUrl: "" });

      expect(hrefs(html)).toContain(STATUS_URL);
      expect(hrefs(html)).not.toContain(DETAILS_URL);
    },
  );

  test.each(TEMPLATE_PAIRS)(
    "$updated renders the prepared rich content, not escaped markup",
    (pair: TemplatePair) => {
      const html: string = render(pair.updated);
      const content: string =
        pair.updated === EmailTemplateType.SubscriberAnnouncementUpdated
          ? VARIABLES["announcementDescription"]!
          : NOTE_HTML;

      expect(html).toContain(content);
      expect(html).not.toContain("&lt;strong&gt;");
    },
  );

  test.each(TEMPLATE_PAIRS)(
    "$updated carries the status page footer text",
    (pair: TemplatePair) => {
      expect(render(pair.updated)).toContain("Questions? Reply to this email.");
    },
  );

  test.each(TEMPLATE_PAIRS)(
    "$updated renders completely with no unresolved placeholders",
    (pair: TemplatePair) => {
      const html: string = render(pair.updated);

      expect(html).not.toContain("{{");
      expect(html).not.toContain("undefined");
      expect(html).not.toContain("[object Object]");
      expect(html.match(/<h1\b/g)).toHaveLength(1);
    },
  );
});

describe("SubscriberAnnouncementUpdated", () => {
  test("escapes the status page name in its introduction", () => {
    const html: string = render(
      EmailTemplateType.SubscriberAnnouncementUpdated,
      { statusPageName: 'Acme <img src=x onerror="alert(1)">' },
    );

    expect(html).not.toContain("<img src");
    expect(html).toContain("An announcement on Acme &lt;img src");
  });

  test("uses the View Announcement button when it has a details URL", () => {
    const html: string = render(
      EmailTemplateType.SubscriberAnnouncementUpdated,
    );

    expect(html).toMatch(
      new RegExp(
        `<a\\b[^>]*href="${DETAILS_URL}"[^>]*>[\\s\\S]*?View Announcement`,
      ),
    );
  });

  test("omits the details field when the announcement has no description", () => {
    const html: string = render(
      EmailTemplateType.SubscriberAnnouncementUpdated,
      { announcementDescription: "" },
    );

    expect(detailLabels(html)).toEqual(["Announcement"]);
  });

  test("puts Updated in the heading so the email is recognisable in an inbox", () => {
    expect(
      heading(render(EmailTemplateType.SubscriberAnnouncementUpdated)),
    ).toBe("Announcement Updated: Planned database maintenance");
  });
});
