import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  DocsHeading,
  hasPage,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import {
  dashboardLocale,
  drawnActionLabel,
  drawnCreateButton,
  isActionLabel,
} from "./DocsDashboardLabels";
import {
  PATH_SEPARATOR,
  boldLabels,
  boldPaths,
  lineShape,
  stepCount,
  tabLabels,
  tables,
  unbalancedLines,
} from "./DocsPageShape";
import {
  CARD_LINE,
  anchorProblems,
  cardLines,
  cardTargets,
  comparableFence,
  inlineCode,
  listItemCount,
  navTitle,
  strayMarkers,
  tableShape,
} from "./DocsTranslationChecks";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Docs overhaul task 18b, the Status Pages pages: the overview, Subscribers
 * & Announcements, and One Status Page per Audience, in every docs language.
 * Each translation says what the English page says:
 *
 *   - line for line: the same number of lines, each heading, table row,
 *     fence, component line and tab on the English one's line, so the two
 *     can be laid side by side and a later English edit shows where it lands;
 *   - the same code, diagrams (by their nodes and arrows), inline code (the
 *     columns, fields, routes and log lines), tables, lists, steps, tabs and
 *     cards, and links that land on a heading in the reader's language;
 *   - a title that is the nav link's, in that language's docs locale.
 *
 * And it names the product the way that language's product draws it. The
 * pages name two products:
 *
 *   - The Dashboard. A bold label is drawnActionLabel (DocsDashboardLabels),
 *     Persian included; a table's create button is drawnCreateButton. A menu
 *     path is drawn segment by segment and stays one bold span with "→" in
 *     every language, as the other Status Pages pages write it; a segment
 *     that is not a label, such as "your page", is worded in the language.
 *     A few labels are drawn from a template (TEMPLATES), from one flat
 *     lookup of a key that differs from the label (FLAT_LOOKUP), or are the
 *     first sentence of a longer message (MESSAGE_LEADS).
 *   - The public status page, which visitors see in their own language: its
 *     nav, its Subscribe page, its subscription pages and its announcement
 *     list are drawn from the status page app's own locale
 *     (StatusPage/src/Locales), by key (STATUS_PAGE_APP), and so are the
 *     messages the pages quote from it (STATUS_PAGE_APP_MESSAGES).
 *
 * Plans, permissions, the template event types, the maintenance states
 * every project starts with and what the server writes in English (feed
 * entries, the email's rows, a chat button) stay in English
 * (KEPT_IN_ENGLISH). The Notification Settings path of the SMS line is held
 * by NotificationChannelsWhoCanDocs (HELD_ELSEWHERE). Every other bold word
 * is one of the pages' own leads or terms (PROSE), which a translation words
 * freely. A new bold word on these English pages fails "know every bold
 * word" until it is in a list.
 */

const LANGUAGES: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

interface TranslatedPage {
  page: string;
  // The page's nav link, as the docs' English locale keys it.
  navTitle: string;
}

const OVERVIEW: string = "status-pages/index";
const SUBSCRIBERS: string = "status-pages/subscribers";
const AUDIENCE: string = "status-pages/one-status-page-per-audience";

const PAGES: ReadonlyArray<TranslatedPage> = [
  { page: OVERVIEW, navTitle: "Status Pages Overview" },
  { page: SUBSCRIBERS, navTitle: "Subscribers & Announcements" },
  { page: AUDIENCE, navTitle: "One Status Page per Audience" },
];

const PAGE_NAMES: Array<string> = PAGES.map((entry: TranslatedPage): string => {
  return entry.page;
});

const STATUS_PAGE_APP_LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/StatusPage/src/Locales",
);

// A table's create button, drawn as translateCreateAction draws it.
const CREATE_BUTTONS: Record<string, Array<string>> = {
  [OVERVIEW]: ["Create Status Page"],
};

interface TemplateLabel {
  english: string;
  key: string;
  // The template's placeholders: a value as written, or a label to draw.
  values: Record<string, { text?: string; label?: string }>;
}

// Labels a page draws from a template with its own values.
const TEMPLATES: Record<string, Array<TemplateLabel>> = {
  [OVERVIEW]: [
    {
      // The create dialog's title (ModelTable).
      english: "Create New Status Page",
      key: "Create New {{itemName}}",
      values: { itemName: { label: "Status Page" } },
    },
    {
      // The display card's days sentence, under each list's switch.
      english: "Show the last … days",
      key: "Show the last {{count}} days",
      values: { count: { text: "…" } },
    },
    {
      // ExportModelCard on Advanced Settings.
      english: "Export Status Page as JSON",
      key: "Export {{itemName}} as JSON",
      values: { itemName: { label: "Status Page" } },
    },
  ],
  [SUBSCRIBERS]: [
    {
      english: "Mark Scheduled Maintenance as `<state name>`",
      key: "Mark Scheduled Maintenance as {{state}}",
      values: { state: { text: "`<state name>`" } },
    },
    {
      english: "Show the last … days",
      key: "Show the last {{count}} days",
      values: { count: { text: "…" } },
    },
  ],
};

interface FlatLookupLabel {
  english: string;
  // The text the screen looks up as it is, trailing space and all.
  key: string;
}

// Labels drawn by one lookup of a key that is not the label itself.
const FLAT_LOOKUP: Record<string, Array<FlatLookupLabel>> = {
  [SUBSCRIBERS]: [
    {
      // The maintenance form's status page picker (Create.tsx).
      english: "Show event on these status pages",
      key: "Show event on these status pages ",
    },
  ],
  [AUDIENCE]: [
    {
      // The audience summary's headline, without its colon.
      english: "Will notify",
      key: "Will notify:",
    },
  ],
};

// Labels that are the first sentence of a longer message on the screen.
const MESSAGE_LEADS: Record<string, Array<FlatLookupLabel>> = {
  [SUBSCRIBERS]: [
    {
      // The Email Reports card while reports are on with nothing scheduled.
      english: "Not scheduled yet",
      key: "Not scheduled yet. Edit the schedule to set when reports go out.",
    },
  ],
};

interface StatusPageAppLabel {
  english: string;
  // The key in the status page app's locale, as "section.name".
  key: string;
}

/*
 * What visitors see, named on these pages: the status page's nav, its
 * Subscribe page, the subscription pages and the announcement list. A label
 * the Dashboard has too is drawn from both where the page names both.
 */
const STATUS_PAGE_APP: Record<string, Array<StatusPageAppLabel>> = {
  [OVERVIEW]: [
    { english: "Overview", key: "nav.overview" },
    { english: "Incidents", key: "nav.incidents" },
    { english: "Announcements", key: "nav.announcements" },
    { english: "Scheduled Events", key: "nav.scheduledEvents" },
    { english: "Subscribe", key: "nav.subscribe" },
    { english: "Log Out", key: "nav.logout" },
    { english: "Active Incidents", key: "overview.activeIncidents" },
    {
      english: "Scheduled Maintenance Events",
      key: "overview.scheduledMaintenanceEvents",
    },
  ],
  [SUBSCRIBERS]: [
    { english: "Subscribe", key: "nav.subscribe" },
    { english: "Subscribe", key: "subscribe.submit" },
    { english: "Email", key: "subscribe.menu.email" },
    { english: "SMS", key: "subscribe.menu.sms" },
    { english: "Slack", key: "subscribe.menu.slack" },
    { english: "MS Teams", key: "subscribe.menu.microsoftTeams" },
    { english: "Webhooks", key: "subscribe.menu.webhooks" },
    { english: "Subscribe by Email", key: "subscribe.email.title" },
    { english: "Your Email", key: "subscribe.email.yourEmail" },
    { english: "Subscribe by SMS", key: "subscribe.sms.title" },
    { english: "Your Phone Number", key: "subscribe.sms.yourPhoneNumber" },
    { english: "Subscribe by Slack", key: "subscribe.slack.title" },
    { english: "Slack Workspace Name", key: "subscribe.slack.workspaceName" },
    {
      english: "Slack Incoming Webhook URL",
      key: "subscribe.slack.webhookUrl",
    },
    {
      english: "Subscribe by Microsoft Teams",
      key: "subscribe.microsoftTeams.title",
    },
    {
      english: "Microsoft Teams Workspace Name",
      key: "subscribe.microsoftTeams.workspaceName",
    },
    {
      english: "Microsoft Teams Incoming Webhook URL",
      key: "subscribe.microsoftTeams.webhookUrl",
    },
    { english: "Subscribe by Webhook", key: "subscribe.webhook.title" },
    { english: "Webhook URL", key: "subscribe.webhook.webhookUrl" },
    { english: "New Subscription", key: "subscribe.newSubscription" },
    {
      english: "Manage Existing Subscription",
      key: "subscribe.manageExisting",
    },
    { english: "Send Management Link", key: "subscribe.sendManagementLink" },
    { english: "Subscribe to All Resources", key: "subscribe.resources.all" },
    {
      english: "Select Resources to Subscribe",
      key: "subscribe.resources.select",
    },
    {
      english: "Subscribe to All Event Types",
      key: "subscribe.eventTypes.all",
    },
    {
      english: "Select Event Types to Subscribe",
      key: "subscribe.eventTypes.select",
    },
    { english: "Preferences", key: "subscribe.preferences.title" },
    { english: "Update Subscription", key: "subscribe.update.title" },
    { english: "Update Subscription", key: "subscribe.update.submit" },
    { english: "Unsubscribe", key: "subscribe.update.unsubscribe" },
    { english: "Unsubscribe", key: "subscribe.unsubscribe.confirmButton" },
    { english: "Confirm Subscription", key: "subscribe.confirm.title" },
    { english: "Active Announcements", key: "announcements.active" },
    { english: "Past Announcements", key: "announcements.past" },
    { english: "Announced at", key: "announcements.announcedAt" },
  ],
};

/*
 * Status page app labels the pages also name on the Dashboard, where the
 * Dashboard's own label is drawn as well: the Channels card's switches, and
 * the Overview and Announcements screens of a status page.
 */
const ALSO_ON_THE_DASHBOARD: Record<string, Array<string>> = {
  [OVERVIEW]: ["Overview", "Announcements"],
  [SUBSCRIBERS]: ["Email", "SMS", "Slack"],
};

/*
 * Sentences the pages quote, in italics or quotes, from the status page app:
 * every language quotes them as its visitors read them.
 */
const STATUS_PAGE_APP_MESSAGES: Record<string, Array<string>> = {
  [SUBSCRIBERS]: [
    "subscribe.subscribedSuccessfully",
    "subscribe.confirm.success",
    "subscribe.unsubscribe.confirmPrompt",
    "subscribe.update.saved",
    "subscribe.preferences.summary.everything",
    "subscribe.preferences.summary.pickedResources",
    "announcements.none",
  ],
};

/*
 * Lines the pages quote from the Dashboard: a folded section's one-line
 * summary, the suggestions' heading, a read-only card's note. Every language
 * quotes them as its Dashboard words them.
 */
const DASHBOARD_QUOTES: Record<string, Array<string>> = {
  [SUBSCRIBERS]: [
    "Subscribers of the event's status pages are notified when it is scheduled, when it starts and when it ends.",
    "Status pages that show the affected monitors:",
    "The event has started, so this can no longer be changed.",
    "Shows now and stays until you end it. Subscribers are notified when it starts showing.",
  ],
};

/*
 * Names every language shows in English: plans and permissions, as the
 * team pages, the API and Terraform name them; the template event types the
 * Notification Templates table lists; the states every project's scheduled
 * maintenance starts with, which are its own data; and what the server
 * writes in English (feed entries, an email's rows, a chat button, a
 * workflow component).
 */
const KEPT_IN_ENGLISH: Array<string> = [
  "Growth",
  "Scale",
  "Project Owner",
  "Project Admin",
  "Project Member",
  "Viewer",
  "Billing Admin",
  "Manage Billing",
  "Incident Admin",
  "Incident Member",
  "Incident Viewer",
  "Status Page Admin",
  "Status Page Member",
  "Status Page Viewer",
  "Create Scheduled Maintenance Status Page Note",
  "Subscriber Incident Created",
  "Subscriber Incident State Changed",
  "Subscriber Incident Note Created",
  "Subscriber Incident Note Updated",
  "Subscriber Incident Postmortem Published",
  "Subscriber Scheduled Maintenance Note Created",
  "Subscriber Scheduled Maintenance Note Updated",
  "Subscriber Announcement Updated",
  "Subscriber Episode Note Updated",
  "Subscriber Report",
  "Note Updated",
  "Scheduled",
  "Ongoing",
  "Ended",
  "Completed",
  "Scheduled Maintenance was updated.",
  "Postmortem Note updated",
  "Custom fields sent",
  "Status:",
  "Updated Note",
  "Mark as Complete",
  "Create One Incident",
  "×",
];

// Bold names the pages hold elsewhere: by NotificationChannelsWhoCanDocs.
const HELD_ELSEWHERE: Array<string> = [
  "Project Settings > Notifications > Notification Settings",
];

/*
 * The pages' own leads and terms: bold words a translation words freely,
 * some of which happen to be Dashboard labels too.
 */
const PROSE: Record<string, Array<string>> = {
  [OVERVIEW]: [
    "Created with two fields.",
    "Resources are what visitors see.",
    "A preview URL from day one.",
    "Visitor-facing routes are gated by settings.",
    "Who can see it is one choice.",
    "Subscribers get told automatically.",
    "Status page",
    "Resource",
    "Group",
    "Announcement",
    "Subscriber",
    "Custom domain",
    "Private user",
    "Any live announcements",
    "An overall status banner",
    "An overall uptime percent",
    "The resource groups",
    "A list that is off",
    "Plans.",
    "Archive status page",
    "Where the colors are.",
    "Images.",
    "What it stores.",
    "Private users and the password don't stack.",
    "Embedded status badge.",
    "RSS feed.",
    "Is offline.",
    "Sends nothing to its subscribers.",
    "Leaves the Status Pages list.",
    "Keeps everything.",
  ],
  [SUBSCRIBERS]: [
    "public",
    "Status",
    "One switch is not enough.",
    "A monitor group stands for every monitor in it.",
    "A subscriber chooses among its own page's resources.",
    "Unconfirmed means silent.",
    "Opening the link changes nothing.",
    "Add people by their own addresses where you can.",
    "The team is told.",
    "The subscriber lists show it.",
    "When the event…",
    "Which status pages?",
    "States of your own.",
    "Waiting to start, over and complete.",
    "Network sites follow every change of state.",
    "What the feed records for an edit.",
    "A note sent with a state change is the one message.",
    "The note names the new state.",
    "Saving it again tells nobody.",
    "Editing a published postmortem tells nobody either.",
    "Taking it off the status page tells nobody, and publishing it again tells them again",
    "A postmortem switched on with no note shows nothing",
    "A postmortem published while its incident is hidden is sent when the incident is made visible.",
    "Notify Subscribers is read when the notification goes out.",
    "The original notification has not gone out yet.",
    "The announcement is scheduled for later.",
    "A message counts as sent",
    "A message counts as failed",
    "Every subscriber is reached.",
    "The counts are recorded per status page.",
    "Progress is kept per status page, not per subscriber.",
    "The incident's 'created' notification",
    "Every other notification",
    "The first time reports are turned on",
    "While reports are on",
    "Turning reports off",
    "Through the API or Terraform",
    "Two of them are internal data.",
    "Placing labels and custom fields needs incident access.",
    "The overview page",
    "The `/announcements` list",
    "An announcement with no end date never expires.",
    "An old but still-active announcement can vanish from the list.",
    "Images follow the announcement.",
  ],
  [AUDIENCE]: [
    "A managed service provider",
    "An organization with sites, plants or regions",
    "Internal IT",
    "among",
    "The notification is still queued, or being sent right now.",
    "Every page you add was told already",
    "The incident was never announced.",
    "The incident was declared before this feature was released.",
    "The incident is hidden.",
    "Custom fields in the default messages.",
    "Updates.",
    "Note templates.",
    "The names of the other audiences.",
    "Scheduled maintenance replaces.",
    "An incident narrows.",
    "When each site needs a status of its own, give each site a Manual monitor.",
    "The incident feed.",
    "Each subscriber notification.",
    "The notification's status.",
    "Picking a status page needs read access to it.",
    "Pages the editor cannot see are kept.",
    "The pages an incident is limited to are part of the incident.",
    "What a send reached is part of the incident too.",
    "The audience summary",
    "Sending a notification again",
  ],
};

/*
 * How each language words a path's "your page", as the other Status Pages
 * pages of that language do.
 */
const YOUR_PAGE: Record<string, string> = {
  da: "din side",
  de: "Ihre Seite",
  es: "tu página",
  fa: "صفحهٔ شما",
  fr: "votre page",
  hi: "आपका पृष्ठ",
  it: "la vostra pagina",
  ja: "対象のページ",
  ko: "해당 페이지",
  nl: "uw pagina",
  no: "siden din",
  pt: "sua página",
  ru: "ваша страница",
  sv: "din sida",
  "zh-CN": "您的页面",
  "zh-TW": "您的頁面",
};

const ONLY_CODE: RegExp = /^`[^`]+`$/;
const FULL_STOP: RegExp = /[.。．।]$/;
const SENTENCE_END: RegExp = /^(.*?[.。．।])(\s|$)/;

const statusPageLocales: Map<string, Record<string, unknown>> = new Map();

function statusPageLocale(language: string): Record<string, unknown> {
  const cached: Record<string, unknown> | undefined =
    statusPageLocales.get(language);

  if (cached) {
    return cached;
  }

  const locale: Record<string, unknown> = JSON.parse(
    fs.readFileSync(
      path.join(STATUS_PAGE_APP_LOCALES_DIR, `${language}.json`),
      "utf8",
    ),
  ) as Record<string, unknown>;

  statusPageLocales.set(language, locale);

  return locale;
}

// What the status page app shows for a key, in this language, trimmed.
function statusPageText(language: string, key: string): string {
  let value: unknown = statusPageLocale(language);

  for (const part of key.split(".")) {
    value = (value as Record<string, unknown> | undefined)?.[part];
  }

  expect({ language, key, found: typeof value === "string" }).toEqual({
    language,
    key,
    found: true,
  });

  return (value as string).trim();
}

function englishPage(page: string): string {
  return readPage("en", page);
}

// The locale's wording of a key, or the key itself where it has none.
function flatLabel(language: string, key: string): string {
  const value: unknown = dashboardLocale(language)[key];

  return typeof value === "string" && value.trim() ? value : key;
}

function drawnTemplate(language: string, entry: TemplateLabel): string {
  let filled: string = flatLabel(language, entry.key);

  for (const [name, value] of Object.entries(entry.values)) {
    const text: string =
      value.text !== undefined
        ? value.text
        : drawnActionLabel(language, value.label as string);

    filled = filled.split(`{{${name}}}`).join(text);
  }

  return filled.trim();
}

function drawnFlat(language: string, entry: FlatLookupLabel): string {
  return flatLabel(language, entry.key)
    .trim()
    .replace(/[:：]$/, "");
}

function drawnMessageLead(language: string, entry: FlatLookupLabel): string {
  const message: string = flatLabel(language, entry.key).trim();
  const lead: RegExpMatchArray | null = message.match(SENTENCE_END);

  return (lead ? (lead[1] as string) : message).replace(FULL_STOP, "");
}

/*
 * The sentences of a quoted Dashboard line: the line itself when the
 * locale has it whole, else each sentence on its own, as a folded section
 * puts two of them side by side.
 */
function quoteKeys(quote: string): Array<string> {
  if (dashboardLocale("en")[quote] !== undefined) {
    return [quote];
  }

  return quote.split(/(?<=\.) /);
}

function drawnQuote(language: string, quote: string): string {
  return quoteKeys(quote)
    .map((key: string): string => {
      return flatLabel(language, key).trim();
    })
    .join(" ");
}

function listed<T>(lists: Record<string, Array<T>>, page: string): Array<T> {
  return lists[page] || [];
}

// Every English bold word a list or a rule accounts for, on a page.
function accountedFor(page: string, span: string): boolean {
  const named: Array<string> = [
    ...listed(CREATE_BUTTONS, page),
    ...listed(TEMPLATES, page).map((entry: TemplateLabel): string => {
      return entry.english;
    }),
    ...listed(FLAT_LOOKUP, page).map((entry: FlatLookupLabel): string => {
      return entry.english;
    }),
    ...listed(MESSAGE_LEADS, page).map((entry: FlatLookupLabel): string => {
      return entry.english;
    }),
    ...listed(STATUS_PAGE_APP, page).map(
      (entry: StatusPageAppLabel): string => {
        return entry.english;
      },
    ),
    ...KEPT_IN_ENGLISH,
    ...HELD_ELSEWHERE,
    ...listed(PROSE, page),
  ];

  return named.includes(span) || isActionLabel(span);
}

/*
 * The Dashboard labels a page names that are drawn by drawnActionLabel:
 * every bold label but the ones a list draws, keeps or frees.
 */
function dashboardLabels(page: string): Array<string> {
  const special: Array<string> = [
    ...listed(CREATE_BUTTONS, page),
    ...listed(TEMPLATES, page).map((entry: TemplateLabel): string => {
      return entry.english;
    }),
    ...listed(FLAT_LOOKUP, page).map((entry: FlatLookupLabel): string => {
      return entry.english;
    }),
    ...listed(MESSAGE_LEADS, page).map((entry: FlatLookupLabel): string => {
      return entry.english;
    }),
    ...KEPT_IN_ENGLISH,
    ...HELD_ELSEWHERE,
    ...listed(PROSE, page),
  ];
  const visitorOnly: Array<string> = listed(STATUS_PAGE_APP, page)
    .map((entry: StatusPageAppLabel): string => {
      return entry.english;
    })
    .filter((english: string): boolean => {
      return !listed(ALSO_ON_THE_DASHBOARD, page).includes(english);
    });

  return boldLabels(englishPage(page)).filter((label: string): boolean => {
    return (
      isActionLabel(label) &&
      !special.includes(label) &&
      !visitorOnly.includes(label)
    );
  });
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A path as this language writes it: its labels drawn, its other words free.
function pathPattern(language: string, segments: Array<string>): RegExp {
  return new RegExp(
    `\\*\\*${segments
      .map((segment: string): string => {
        if (isActionLabel(segment)) {
          return escapeRegex(drawnActionLabel(language, segment));
        }

        return segment === "your page" && YOUR_PAGE[language]
          ? escapeRegex(YOUR_PAGE[language] as string)
          : "[^*→\\n]+?";
      })
      .join(escapeRegex(PATH_SEPARATOR))}\\*\\*`,
  );
}

describe("the lists this test keeps", () => {
  it("name only pages of this group", () => {
    for (const lists of [
      CREATE_BUTTONS,
      TEMPLATES,
      FLAT_LOOKUP,
      MESSAGE_LEADS,
      STATUS_PAGE_APP,
      ALSO_ON_THE_DASHBOARD,
      STATUS_PAGE_APP_MESSAGES,
      PROSE,
    ]) {
      for (const page of Object.keys(lists)) {
        expect(PAGE_NAMES).toContain(page);
      }
    }
  });

  it("know every bold word on the English pages: a label, a path, a name, a template or a lead", () => {
    for (const page of PAGE_NAMES) {
      const unlisted: Array<string> = boldLabels(englishPage(page)).filter(
        (span: string): boolean => {
          return !accountedFor(page, span);
        },
      );

      expect({ page, unlisted }).toEqual({ page, unlisted: [] });
    }
  });

  it("list only bold words the English pages have", () => {
    for (const page of PAGE_NAMES) {
      const english: Array<string> = boldLabels(englishPage(page));
      const stale: Array<string> = [
        ...listed(PROSE, page),
        ...listed(CREATE_BUTTONS, page),
        ...listed(TEMPLATES, page).map((entry: TemplateLabel): string => {
          return entry.english;
        }),
        ...listed(FLAT_LOOKUP, page).map((entry: FlatLookupLabel): string => {
          return entry.english;
        }),
        ...listed(MESSAGE_LEADS, page).map((entry: FlatLookupLabel): string => {
          return entry.english;
        }),
        ...listed(STATUS_PAGE_APP, page).map(
          (entry: StatusPageAppLabel): string => {
            return entry.english;
          },
        ),
      ].filter((span: string): boolean => {
        return !english.includes(span);
      });

      expect({ page, stale }).toEqual({ page, stale: [] });
    }
  });

  it("keep in English only names some English page has, that no list draws", () => {
    const english: Array<string> = PAGE_NAMES.flatMap(
      (page: string): Array<string> => {
        return boldLabels(englishPage(page));
      },
    );

    for (const name of [...KEPT_IN_ENGLISH, ...HELD_ELSEWHERE]) {
      expect({ name, found: english.includes(name) }).toEqual({
        name,
        found: true,
      });
    }
  });

  it("draw the status page app's labels and messages from keys its English locale has", () => {
    for (const page of PAGE_NAMES) {
      for (const entry of listed(STATUS_PAGE_APP, page)) {
        expect({
          key: entry.key,
          text: statusPageText("en", entry.key),
        }).toEqual({ key: entry.key, text: entry.english });
      }

      for (const key of listed(STATUS_PAGE_APP_MESSAGES, page)) {
        expect(englishPage(page)).toContain(statusPageText("en", key));
      }
    }
  });

  it("quote only Dashboard lines the English pages quote, whose sentences the English locale has", () => {
    for (const page of PAGE_NAMES) {
      for (const quote of listed(DASHBOARD_QUOTES, page)) {
        expect(englishPage(page)).toContain(quote);

        for (const key of quoteKeys(quote)) {
          expect({
            key,
            found: dashboardLocale("en")[key] !== undefined,
          }).toEqual({ key, found: true });
        }

        expect(drawnQuote("en", quote)).toBe(quote);
      }
    }
  });

  it("draw the templates, flat lookups and message leads from keys the English locale has, as the English pages write them", () => {
    for (const page of PAGE_NAMES) {
      for (const entry of listed(TEMPLATES, page)) {
        expect(drawnTemplate("en", entry)).toBe(entry.english);
      }

      for (const entry of listed(FLAT_LOOKUP, page)) {
        expect(dashboardLocale("en")[entry.key]).toBeDefined();
        expect(drawnFlat("en", entry)).toBe(entry.english);
      }

      for (const entry of listed(MESSAGE_LEADS, page)) {
        expect(dashboardLocale("en")[entry.key]).toBeDefined();
        expect(drawnMessageLead("en", entry)).toBe(entry.english);
      }
    }
  });
});

describe("the English pages", () => {
  it.each(PAGES)("$page is titled as its nav link", (entry: TranslatedPage) => {
    expect(englishPage(entry.page).split("\n")[0]).toBe(`# ${entry.navTitle}`);
  });

  it.each(PAGES)(
    "$page draws at least one diagram, with a caption",
    (entry: TranslatedPage) => {
      const diagrams: Array<{ info: string }> = scanMarkdown(
        englishPage(entry.page),
      ).fences.filter((fence: { lang: string }): boolean => {
        return fence.lang === "mermaid";
      });

      expect(diagrams.length).toBeGreaterThan(0);

      for (const diagram of diagrams) {
        expect(diagram.info).toMatch(/title="[^"]+"/);
      }
    },
  );

  it.each(PAGES)(
    "$page opens with cards and ends on a Next steps section of cards",
    (entry: TranslatedPage) => {
      const markdown: string = englishPage(entry.page);
      const headings: Array<DocsHeading> = scanMarkdown(markdown).headings;
      const last: DocsHeading = headings[headings.length - 1] as DocsHeading;
      const firstCards: number = markdown.indexOf(":::cards");
      const firstSection: number = markdown.indexOf("\n## ");

      expect(firstCards).toBeGreaterThan(0);
      expect(firstCards).toBeLessThan(firstSection);
      expect(last).toEqual(expect.objectContaining({ level: 2 }));
      expect(last.text).toBe("Next steps");
      expect(markdown.split(":::cards").length - 1).toBe(2);
    },
  );

  it.each(PAGES)(
    "$page has no two headings with the same anchor",
    (entry: TranslatedPage) => {
      const slugs: Array<string> = scanMarkdown(
        englishPage(entry.page),
      ).headings.map((heading: DocsHeading): string => {
        return heading.slug;
      });

      expect(slugs.length).toBe(new Set(slugs).size);
    },
  );

  it.each(PAGES)(
    "$page closes every bold and code span it opens",
    (entry: TranslatedPage) => {
      expect(unbalancedLines(englishPage(entry.page))).toEqual([]);
    },
  );
});

describe.each(LANGUAGES)("%s", (language: string) => {
  describe.each(PAGES)("$page", (entry: TranslatedPage) => {
    const english: string = englishPage(entry.page);

    it("is translated, under the nav link's title", () => {
      expect(hasPage(language, entry.page)).toBe(true);

      const translated: string = readPage(language, entry.page);
      const title: string = navTitle(language, entry.navTitle);

      expect(translated).not.toEqual(english);
      expect(typeof title).toBe("string");
      expect(translated.split("\n")[0]).toBe(`# ${title}`);
    });

    it("lies line for line beside the English page: headings, table rows, fences, components and tabs on the same lines", () => {
      expect(lineShape(readPage(language, entry.page))).toEqual(
        lineShape(english),
      );
    });

    it("keeps every code block, and builds every diagram the same way", () => {
      expect(
        scanMarkdown(readPage(language, entry.page)).fences.map(
          comparableFence,
        ),
      ).toEqual(scanMarkdown(english).fences.map(comparableFence));
    });

    it("keeps every piece of inline code: the columns, fields, routes and values", () => {
      expect(inlineCode(readPage(language, entry.page))).toEqual(
        inlineCode(english),
      );
    });

    it("keeps the tab labels", () => {
      expect(tabLabels(readPage(language, entry.page))).toEqual(
        tabLabels(english),
      );
    });

    it("keeps the code in the first column of every table, row by row", () => {
      const translated: Array<Array<Array<string>>> = tables(
        readPage(language, entry.page),
      );

      tables(english).forEach((table: Array<Array<string>>, index: number) => {
        table.forEach((row: Array<string>, rowIndex: number) => {
          if (rowIndex > 0 && ONLY_CODE.test(row[0] as string)) {
            expect({
              table: index,
              row: rowIndex,
              cell: translated[index]?.[rowIndex]?.[0],
            }).toEqual({
              table: index,
              row: rowIndex,
              cell: row[0],
            });
          }
        });
      });
    });

    it("closes every bold and code span it opens", () => {
      expect(unbalancedLines(readPage(language, entry.page))).toEqual([]);
    });

    it("draws every bold and italic span, with no asterisks or underscores left on the page", async () => {
      expect(
        await strayMarkers(readPage(language, entry.page), language),
      ).toEqual([]);
    });

    it("has the English page's headings, steps, tables and list items", () => {
      const translated: string = readPage(language, entry.page);

      expect(
        scanMarkdown(translated).headings.map((heading: DocsHeading) => {
          return heading.level;
        }),
      ).toEqual(
        scanMarkdown(english).headings.map((heading: DocsHeading) => {
          return heading.level;
        }),
      );
      expect(stepCount(translated)).toBe(stepCount(english));
      expect(tableShape(translated)).toEqual(tableShape(english));
      expect(listItemCount(translated)).toBe(listItemCount(english));
    });

    it("writes its cards with an ASCII ': ' after the link, to the English cards' pages", () => {
      const translated: Array<string> = cardLines(
        readPage(language, entry.page),
      );

      expect(translated.length).toBe(cardLines(english).length);

      for (const line of translated) {
        expect({ line, ascii: CARD_LINE.test(line) }).toEqual({
          line,
          ascii: true,
        });
      }

      expect(cardTargets(translated)).toEqual(cardTargets(cardLines(english)));
    });

    it("links only to anchors that are headings of the page they open", () => {
      expect(anchorProblems(language, entry.page)).toEqual([]);
    });

    it("names every Dashboard label the English page names, as this language's Dashboard draws it", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = [
        ...dashboardLabels(entry.page).map((label: string): string => {
          return drawnActionLabel(language, label);
        }),
        ...listed(CREATE_BUTTONS, entry.page).map((button: string): string => {
          return drawnCreateButton(language, button);
        }),
        ...listed(TEMPLATES, entry.page).map(
          (template: TemplateLabel): string => {
            return drawnTemplate(language, template);
          },
        ),
        ...listed(FLAT_LOOKUP, entry.page).map(
          (flat: FlatLookupLabel): string => {
            return drawnFlat(language, flat);
          },
        ),
        ...listed(MESSAGE_LEADS, entry.page).map(
          (lead: FlatLookupLabel): string => {
            return drawnMessageLead(language, lead);
          },
        ),
      ].filter((drawn: string): boolean => {
        return !translated.includes(`**${drawn}**`);
      });

      expect(missing).toEqual([]);
    });

    it("gives every menu path, segment by segment, as this language's Dashboard draws it, in one bold span", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = boldPaths(english)
        .map((segments: Array<string>): RegExp => {
          return pathPattern(language, segments);
        })
        .filter((pattern: RegExp): boolean => {
          return !pattern.test(translated);
        })
        .map((pattern: RegExp): string => {
          return pattern.source;
        });

      expect(missing).toEqual([]);
    });

    it("names what visitors see as the status page draws it in this language", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = [
        ...listed(STATUS_PAGE_APP, entry.page).map(
          (label: StatusPageAppLabel): string => {
            return `**${statusPageText(language, label.key)}**`;
          },
        ),
        ...listed(STATUS_PAGE_APP_MESSAGES, entry.page).map(
          (key: string): string => {
            return statusPageText(language, key);
          },
        ),
      ].filter((drawn: string): boolean => {
        return !translated.includes(drawn);
      });

      expect(missing).toEqual([]);
    });

    it("quotes the Dashboard's lines as this language's Dashboard words them", () => {
      const translated: string = readPage(language, entry.page);
      const missing: Array<string> = listed(DASHBOARD_QUOTES, entry.page)
        .map((quote: string): string => {
          return drawnQuote(language, quote);
        })
        .filter((drawn: string): boolean => {
          return !translated.includes(drawn);
        });

      expect(missing).toEqual([]);
    });

    it("keeps the plans, permissions, template events, maintenance states and server texts in English", () => {
      const translated: string = readPage(language, entry.page);
      const names: Array<string> = boldLabels(english).filter(
        (span: string): boolean => {
          return KEPT_IN_ENGLISH.includes(span);
        },
      );
      const missing: Array<string> = names.filter((name: string): boolean => {
        return !translated.includes(`**${name}**`);
      });

      expect(missing).toEqual([]);
    });
  });
});

describe("the helpers, on these pages' shapes", () => {
  it("draw a template with its values, a flat lookup without its colon, and a message's first sentence", () => {
    expect(
      drawnTemplate("de", {
        english: "Show the last … days",
        key: "Show the last {{count}} days",
        values: { count: { text: "…" } },
      }),
    ).toBe(
      flatLabel("de", "Show the last {{count}} days").replace("{{count}}", "…"),
    );
    expect(
      drawnTemplate("de", {
        english: "Create New Status Page",
        key: "Create New {{itemName}}",
        values: { itemName: { label: "Status Page" } },
      }),
    ).toBe(
      flatLabel("de", "Create New {{itemName}}").replace(
        "{{itemName}}",
        drawnActionLabel("de", "Status Page"),
      ),
    );
    expect(
      drawnFlat("en", { english: "Will notify", key: "Will notify:" }),
    ).toBe("Will notify");
    expect(
      drawnMessageLead("en", {
        english: "Not scheduled yet",
        key: "Not scheduled yet. Edit the schedule to set when reports go out.",
      }),
    ).toBe("Not scheduled yet");
  });

  it("match a path's placeholder with this language's word for it", () => {
    const pattern: RegExp = pathPattern("de", [
      "Status Pages",
      "your page",
      "Advanced",
      "Advanced Settings",
    ]);

    expect(
      pattern.test(
        `**${drawnActionLabel("de", "Status Pages")} → Ihre Seite → ${drawnActionLabel("de", "Advanced")} → ${drawnActionLabel("de", "Advanced Settings")}**`,
      ),
    ).toBe(true);
    expect(
      pattern.test(
        `**${drawnActionLabel("de", "Status Pages")} → your page → ${drawnActionLabel("de", "Advanced")} → ${drawnActionLabel("de", "Advanced Settings")}**`,
      ),
    ).toBe(false);
  });

  it("read the status page app's locale by key", () => {
    expect(statusPageText("en", "subscribe.email.title")).toBe(
      "Subscribe by Email",
    );
    expect(statusPageText("en", "announcements.announcedAt")).toBe(
      "Announced at",
    );
  });
});
