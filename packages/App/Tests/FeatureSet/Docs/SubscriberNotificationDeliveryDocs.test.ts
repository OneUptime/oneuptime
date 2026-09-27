import {
  getPostedNotificationSummary,
  getUpdateNotificationSummary,
  NoteNotificationSummary,
} from "../../../FeatureSet/Dashboard/src/Components/EventNotes/EventNotesUtil";
import SubscriberNotificationPreviewCopy from "../../../FeatureSet/Dashboard/src/Components/StatusPage/SubscriberNotificationPreviewCopy";
import SubscriberNotificationResendCopy from "../../../FeatureSet/Dashboard/src/Components/StatusPageSubscribers/SubscriberNotificationResendCopy";
import { IncidentFeedEventType } from "Common/Models/DatabaseModels/IncidentFeed";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import SubscriberNotificationTestSendRateLimit from "Common/Server/Middleware/SubscriberNotificationTestSendRateLimit";
import slugify from "Common/Server/Types/MarkdownSlugify";
import SubscriberNotificationDeliveryRecord, {
  SubscriberNotificationRetryScope,
} from "Common/Server/Utils/StatusPage/SubscriberNotificationDeliveryRecord";
import SubscriberNotificationTiming from "Common/Server/Utils/StatusPage/SubscriberNotificationTiming";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberNotificationInterruption from "Common/Types/StatusPage/SubscriberNotificationInterruption";
import SubscriberNotificationPreview from "Common/Types/StatusPage/SubscriberNotificationPreview";
import { getFeedEventTypeLabel } from "Common/UI/Components/Feed/FeedOptions";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the docs say about checking, retrying and resending status page
 * subscriber notifications, against the code that does it.
 *
 * The pages - "Checking what was sent" on Subscribers & Announcements, the
 * public note badges and their Retry and Resend on Incident Notes, Owners &
 * Feed, the preview and per-page Retry in One Status Page per Audience, and
 * the notes on Declaring an Incident and Incident States & Severities - quote
 * numbers, labels and messages that live in code: the send timeouts and
 * window, the sweeper's threshold, the status message a send writes, the
 * "Interrupted:" prefix, the badge wording, the test-send limit. Markdown is
 * not compiled, so nothing else notices when one of them changes. Each test
 * reads the source of truth and checks every page, in English and Persian,
 * still says the same.
 *
 * Two claims are about behaviour rather than wording, and are pinned the same
 * way: which subscriber jobs count their messages (the incident and episode
 * ones do; scheduled maintenance and announcements do not, yet), and that
 * progress is kept per status page, not per subscriber, so a retry after an
 * interruption can send a page's message again to some who already got it.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");
const DASHBOARD_SRC: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src",
);
const WORKER_JOBS: string = path.join(REPO_ROOT, "App/FeatureSet/Workers/Jobs");

const SUBSCRIBERS_PAGE: string = "status-pages/subscribers";
const GUIDE_PAGE: string = "status-pages/one-status-page-per-audience";
const NOTES_PAGE: string = "incidents/notes-owners-and-feed";
const DECLARING_PAGE: string = "incidents/declaring-incidents";
const STATES_PAGE: string = "incidents/states-and-severities";

const PAGES: ReadonlyArray<string> = [
  SUBSCRIBERS_PAGE,
  GUIDE_PAGE,
  NOTES_PAGE,
  DECLARING_PAGE,
  STATES_PAGE,
];

// `fa` is the only translated corpus; every other language falls back to English.
const LANGUAGES: ReadonlyArray<string> = ["en", "fa"];

// The section every other page sends readers to, in each language.
const CHECKING_SECTION: { [language: string]: string } = {
  en: "Checking what was sent",
  fa: "بررسی آنچه فرستاده شد",
};

const FENCE_LINE: RegExp = /^\s*```/;
const ANY_HEADING: RegExp = /^(#{1,6}) (.*)$/;
// Arabic-script letters, which every Persian sentence contains.
const PERSIAN_LETTER: RegExp = /[؀-ۿ]/;

const MINUTE_IN_MS: number = 60 * 1000;

type ReadPageFunction = (relative: string, language?: string) => string;

const readPage: ReadPageFunction = (
  relative: string,
  language: string = "en",
): string => {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, `${relative}.md`),
    "utf8",
  );
};

type ReadSourceFunction = (absolute: string) => string;

const readSource: ReadSourceFunction = (absolute: string): string => {
  return fs.readFileSync(absolute, "utf8");
};

type ProseFunction = (markdown: string) => string;

// Everything outside fenced code blocks.
const proseOf: ProseFunction = (markdown: string): string => {
  const lines: Array<string> = [];
  let inFence: boolean = false;

  for (const line of markdown.split("\n")) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }

    if (!inFence) {
      lines.push(line);
    }
  }

  return lines.join("\n");
};

type TextSetFunction = (markdown: string) => Set<string>;

const inlineCode: TextSetFunction = (markdown: string): Set<string> => {
  return new Set<string>(
    Array.from(proseOf(markdown).matchAll(/`([^`\n]+)`/g)).map(
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    ),
  );
};

// Every **bold** span: how the docs name what is on screen.
const boldText: TextSetFunction = (markdown: string): Set<string> => {
  return new Set<string>(
    Array.from(proseOf(markdown).matchAll(/\*\*([^*\n]+)\*\*/g)).map(
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    ),
  );
};

interface Heading {
  level: number;
  text: string;
}

type HeadingsFunction = (markdown: string) => Array<Heading>;

const headingsOf: HeadingsFunction = (markdown: string): Array<Heading> => {
  return proseOf(markdown)
    .split("\n")
    .map((line: string): RegExpMatchArray | null => {
      return line.match(ANY_HEADING);
    })
    .filter((match: RegExpMatchArray | null): match is RegExpMatchArray => {
      return match !== null;
    })
    .map((match: RegExpMatchArray): Heading => {
      return {
        level: (match[1] as string).length,
        text: (match[2] as string).replace(/^‏/, "").trim(),
      };
    });
};

type SectionFunction = (markdown: string, headingText: string) => string;

// A heading's section: from it to the next heading of the same level or higher.
const sectionOf: SectionFunction = (
  markdown: string,
  headingText: string,
): string => {
  const lines: Array<string> = markdown.split("\n");
  let start: number = -1;
  let level: number = 0;
  let inFence: boolean = false;

  for (let index: number = 0; index < lines.length; index++) {
    const line: string = lines[index] as string;

    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }

    const match: RegExpMatchArray | null = inFence
      ? null
      : line.match(ANY_HEADING);

    if (!match) {
      continue;
    }

    const lineLevel: number = (match[1] as string).length;

    if (start === -1) {
      if ((match[2] as string).trim() === headingText) {
        start = index;
        level = lineLevel;
      }
      continue;
    }

    if (lineLevel <= level) {
      return lines.slice(start, index).join("\n");
    }
  }

  expect({ heading: headingText, found: start !== -1 }).toEqual({
    heading: headingText,
    found: true,
  });

  return lines.slice(start).join("\n");
};

type TableRowsFunction = (markdown: string) => Array<Array<string>>;

// Every Markdown table row, as its trimmed cells.
const tableRows: TableRowsFunction = (
  markdown: string,
): Array<Array<string>> => {
  return proseOf(markdown)
    .split("\n")
    .filter((line: string): boolean => {
      return line.trim().startsWith("|");
    })
    .map((line: string): Array<string> => {
      return line
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((cell: string): string => {
          return cell.trim();
        });
    });
};

type DocsAnchorsFunction = (
  markdown: string,
) => Array<{ page: string; anchor: string }>;

// Every link to another docs page's section.
const docsAnchors: DocsAnchorsFunction = (
  markdown: string,
): Array<{ page: string; anchor: string }> => {
  return Array.from(
    markdown.matchAll(/\]\(\/docs\/([^)#\s]+)#([^)\s]+)\)/g),
  ).map((match: RegExpMatchArray): { page: string; anchor: string } => {
    return { page: match[1] as string, anchor: match[2] as string };
  });
};

type DocsLinksFunction = (markdown: string) => Set<string>;

// Every /docs/ link target, without its #anchor.
const docsLinks: DocsLinksFunction = (markdown: string): Set<string> => {
  return new Set<string>(
    Array.from(markdown.matchAll(/\]\((\/docs\/[^)#\s]+)(?:#[^)\s]*)?\)/g)).map(
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    ),
  );
};

type NumberTextFunction = (value: number, language: string) => string;

// A number as each language's docs write it: "10,000" and "۱۰٬۰۰۰".
const numberText: NumberTextFunction = (
  value: number,
  language: string,
): string => {
  const english: string = value.toLocaleString("en-US");

  if (language !== "fa") {
    return english;
  }

  return english.replace(/[0-9,]/g, (character: string): string => {
    return character === ","
      ? "٬"
      : String.fromCharCode(0x06f0 + Number(character));
  });
};

type MinutesFunction = (ms: number) => number;

const minutes: MinutesFunction = (ms: number): number => {
  expect(ms % MINUTE_IN_MS).toBe(0);

  return ms / MINUTE_IN_MS;
};

type StatusPageFunction = (id: string, name: string) => StatusPage;

const statusPage: StatusPageFunction = (
  id: string,
  name: string,
): StatusPage => {
  const page: StatusPage = new StatusPage();
  page._id = id;
  page.name = name;
  return page;
};

type RecordMessagesFunction = (data: {
  record: SubscriberNotificationDeliveryRecord;
  statusPage: StatusPage;
  method: StatusPageSubscriberNotificationMethod;
  sent?: number;
  failed?: number;
}) => void;

const recordMessages: RecordMessagesFunction = (data: {
  record: SubscriberNotificationDeliveryRecord;
  statusPage: StatusPage;
  method: StatusPageSubscriberNotificationMethod;
  sent?: number;
  failed?: number;
}): void => {
  for (let index: number = 0; index < (data.sent || 0); index++) {
    data.record.recordSent({
      statusPage: data.statusPage,
      method: data.method,
    });
  }

  for (let index: number = 0; index < (data.failed || 0); index++) {
    data.record.recordFailed({
      statusPage: data.statusPage,
      method: data.method,
    });
  }
};

const SITE_03: StatusPage = statusPage(
  "03030303-0303-4303-8303-030303030303",
  "Site 03",
);
const SITE_07: StatusPage = statusPage(
  "07070707-0707-4707-8707-070707070707",
  "Site 07",
);

/*
 * The send the docs use as their example: Site 03's 41 email subscribers all
 * sent it; on Site 07, 16 email and 2 SMS were sent and 2 email failed.
 */
type ExampleSendFunction = () => SubscriberNotificationDeliveryRecord;

const exampleSend: ExampleSendFunction =
  (): SubscriberNotificationDeliveryRecord => {
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: false });

    record.startStatusPage(SITE_03);
    recordMessages({
      record: record,
      statusPage: SITE_03,
      method: StatusPageSubscriberNotificationMethod.Email,
      sent: 41,
    });
    record.finishStatusPage(SITE_03);

    record.startStatusPage(SITE_07);
    recordMessages({
      record: record,
      statusPage: SITE_07,
      method: StatusPageSubscriberNotificationMethod.Email,
      sent: 16,
      failed: 2,
    });
    recordMessages({
      record: record,
      statusPage: SITE_07,
      method: StatusPageSubscriberNotificationMethod.SMS,
      sent: 2,
    });
    record.finishStatusPage(SITE_07);

    return record;
  };

type StatusLabelsFunction = () => Map<
  StatusPageSubscriberNotificationStatus,
  string
>;

/*
 * The label each status gets on the incident's Overview, State Timeline,
 * Postmortem and the scheduled maintenance and announcement pages
 * (getNotificationStatusInfo), read from source: the component is React and
 * a plain-node test must not import it.
 */
const statusLabels: StatusLabelsFunction = (): Map<
  StatusPageSubscriberNotificationStatus,
  string
> => {
  const source: string = readSource(
    path.join(
      DASHBOARD_SRC,
      "Components/StatusPageSubscribers/SubscriberNotificationStatus.tsx",
    ),
  );
  const body: string = source.slice(
    source.indexOf("export const getNotificationStatusInfo"),
  );
  const labels: Map<StatusPageSubscriberNotificationStatus, string> = new Map();

  for (const match of body.matchAll(
    /status === StatusPageSubscriberNotificationStatus\.(\w+)\)\s*\{\s*return\s*\{[^}]*?text:\s*"([^"]+)"/g,
  )) {
    const status: StatusPageSubscriberNotificationStatus =
      match[1] as StatusPageSubscriberNotificationStatus;

    if (!labels.has(status)) {
      labels.set(status, match[2] as string);
    }
  }

  return labels;
};

// The statuses a notification settles in or passes through.
const STATUSES: ReadonlyArray<StatusPageSubscriberNotificationStatus> = [
  StatusPageSubscriberNotificationStatus.Pending,
  StatusPageSubscriberNotificationStatus.InProgress,
  StatusPageSubscriberNotificationStatus.Success,
  StatusPageSubscriberNotificationStatus.Failed,
  StatusPageSubscriberNotificationStatus.Skipped,
];

// The seven incident and episode jobs, which count what they send.
const COUNTED_JOBS: ReadonlyArray<string> = [
  "Incident/SendNotificationToSubscribers.ts",
  "Incident/SendPostmortemNotificationToSubscribers.ts",
  "IncidentStateTimeline/SendNotificationToSubscribers.ts",
  "IncidentPublicNote/SendNotificationToSubscribers.ts",
  "IncidentEpisode/SendNotificationToSubscribers.ts",
  "IncidentEpisodeStateTimeline/SendNotificationToSubscribers.ts",
  "IncidentEpisodePublicNote/SendNotificationToSubscribers.ts",
];

// The scheduled maintenance and announcement jobs, which the docs say do not.
const UNCOUNTED_JOBS: ReadonlyArray<string> = [
  "ScheduledMaintenance/SendNotificationToSubscribers.ts",
  "ScheduledMaintenanceStateTimeline/SendNotificationToSubscribers.ts",
  "ScheduledMaintenancePublicNote/SendNotificationToSubscribers.ts",
  "Announcement/SendNotificationToSubscribers.ts",
];

const SWEEPER: string = path.join(
  WORKER_JOBS,
  "StatusPageSubscriber/TimeoutStuckNotifications.ts",
);

describe("Subscriber notification delivery docs", () => {
  describe("the numbers", () => {
    it("quote the send timeout, the read size, the concurrency and the send window the jobs use", () => {
      const timeout: number = minutes(
        SubscriberNotificationTiming.SEND_TIMEOUT_IN_MS,
      );
      const window: number = minutes(
        SubscriberNotificationTiming.SEND_WINDOW_IN_MS,
      );

      for (const page of [SUBSCRIBERS_PAGE, NOTES_PAGE]) {
        const en: string = readPage(page, "en");

        expect(en).toContain(`no answer within ${timeout} minutes`);
        expect(en).toContain(
          `read ${numberText(SubscriberNotificationTiming.SUBSCRIBERS_PER_READ, "en")} at a time`,
        );
        expect(en).toMatch(
          new RegExp(
            `${SubscriberNotificationTiming.SEND_CONCURRENCY} messages (are )?in flight at once`,
          ),
        );
        expect(en).toMatch(
          new RegExp(`stops starting new messages (after )?${window} minutes`),
        );

        const fa: string = readPage(page, "fa");

        expect(fa).toContain(`${numberText(timeout, "fa")} دقیقه پاسخی`);
        expect(fa).toContain(
          `${numberText(SubscriberNotificationTiming.SUBSCRIBERS_PER_READ, "fa")} تایی`,
        );
        expect(fa).toContain(
          `${numberText(SubscriberNotificationTiming.SEND_CONCURRENCY, "fa")} پیام هم‌زمان`,
        );
        expect(fa).toContain(`${numberText(window, "fa")} دقیقه`);
      }
    });

    it("quote when a send in progress is taken to have been interrupted, and how often that is checked", () => {
      const stuck: number = minutes(
        SubscriberNotificationTiming.STUCK_AFTER_IN_MS,
      );

      // "Longer than any send is allowed to take."
      expect(SubscriberNotificationTiming.STUCK_AFTER_IN_MS).toBeGreaterThan(
        SubscriberNotificationTiming.JOB_TIMEOUT_IN_MS,
      );
      expect(
        SubscriberNotificationTiming.JOB_TIMEOUT_IN_MS,
      ).toBeGreaterThanOrEqual(
        SubscriberNotificationTiming.NOTIFICATION_MAX_IN_MS,
      );

      for (const page of [SUBSCRIBERS_PAGE, NOTES_PAGE]) {
        expect(readPage(page, "en")).toMatch(
          new RegExp(`(for|after) ${stuck} minutes`),
        );
        expect(readPage(page, "fa")).toContain(
          `${numberText(stuck, "fa")} دقیقه`,
        );
      }

      // The sweep runs every five minutes.
      expect(readSource(SWEEPER)).toMatch(/schedule:\s*EVERY_FIVE_MINUTE/);
      expect(readPage(SUBSCRIBERS_PAGE, "en")).toContain(
        "The check runs every 5 minutes.",
      );
      expect(readPage(SUBSCRIBERS_PAGE, "fa")).toContain(
        `هر ${numberText(5, "fa")} دقیقه اجرا می‌شود`,
      );
    });
  });

  describe("the status message", () => {
    it("is quoted as a send writes it", () => {
      const message: string = exampleSend().toStatusMessage({
        sentMessage: "Notification sent to subscribers.",
        retryScope: SubscriberNotificationRetryScope.EveryPage,
      });

      // The notes page quotes the start of the message.
      for (const language of LANGUAGES) {
        const quoted: Array<string> = Array.from(
          inlineCode(readPage(NOTES_PAGE, language)),
        ).filter((code: string): boolean => {
          return code.startsWith("Not every subscriber");
        });

        expect(quoted).toHaveLength(1);
        expect(message.startsWith(quoted[0] as string)).toBe(true);
      }

      // The subscribers page quotes its per-page lines.
      const perPage: string =
        "Site 03: 41 email sent. Site 07: 16 email, 2 SMS sent; 2 email failed.";

      expect(message).toContain(perPage);

      for (const language of LANGUAGES) {
        expect(
          inlineCode(readPage(SUBSCRIBERS_PAGE, language)).has(perPage),
        ).toBe(true);
      }
    });

    it("says Retry sends a note or a state change to every page again, as the docs do", () => {
      const message: string = exampleSend().toStatusMessage({
        sentMessage: "Notification sent to subscribers.",
        retryScope: SubscriberNotificationRetryScope.EveryPage,
      });

      expect(message).toContain(
        "Retry sends it again to every status page, including the subscribers who already got it.",
      );
      expect(readPage(SUBSCRIBERS_PAGE)).toContain(
        "sends it again to every status page, including the subscribers who already got it.",
      );
    });

    it("keeps the 'created' notification's progress per status page, not per subscriber", () => {
      const record: SubscriberNotificationDeliveryRecord = exampleSend();

      // Site 03 was sent it in full and is skipped; Site 07 had a failure and is sent it again in full.
      expect(record.didStatusPageSucceed(SITE_03.id!)).toBe(true);
      expect(record.didStatusPageSucceed(SITE_07.id!)).toBe(false);
      expect(
        record.toStatusMessage({
          sentMessage: "Notification sent to subscribers.",
          retryScope: SubscriberNotificationRetryScope.PagesNotYetSent,
        }),
      ).toContain(
        "Retry sends it again only to the status pages that were not sent it in full: Site 07.",
      );

      // Only the created job resumes; every other job sends to every page again.
      for (const job of COUNTED_JOBS) {
        const source: string = readSource(path.join(WORKER_JOBS, job));
        const scopes: Set<string> = new Set<string>(
          Array.from(
            source.matchAll(/SubscriberNotificationRetryScope\.(\w+)/g),
          ).map((match: RegExpMatchArray): string => {
            return match[1] as string;
          }),
        );

        expect({ job: job, scopes: Array.from(scopes) }).toEqual({
          job: job,
          scopes: [
            job === "Incident/SendNotificationToSubscribers.ts"
              ? SubscriberNotificationRetryScope.PagesNotYetSent
              : SubscriberNotificationRetryScope.EveryPage,
          ],
        });
      }

      // And every page that describes Retry says so, in every language.
      const perPage: { [language: string]: RegExp } = {
        en: /per (status )?page, not per subscriber/,
        fa: /به ازای هر صفحه( وضعیت)? نگه داشته می‌شود، نه به ازای هر مشترک/,
      };

      for (const language of LANGUAGES) {
        for (const page of [SUBSCRIBERS_PAGE, GUIDE_PAGE, NOTES_PAGE]) {
          expect({
            language: language,
            page: page,
            saysPerPage: (perPage[language] as RegExp).test(
              readPage(page, language),
            ),
          }).toEqual({ language: language, page: page, saysPerPage: true });
        }
      }
    });

    it("names the feed entry that carries the counts as the incident feed labels it", () => {
      const label: string = getFeedEventTypeLabel(
        IncidentFeedEventType.SubscriberNotificationSent,
      );

      for (const language of LANGUAGES) {
        expect(boldText(readPage(SUBSCRIBERS_PAGE, language)).has(label)).toBe(
          true,
        );
      }
    });
  });

  describe("interrupted sends", () => {
    it("quote the prefix the sweeper writes, on every page that mentions it", () => {
      const prefix: string = SubscriberNotificationInterruption.messagePrefix;

      expect(
        SubscriberNotificationInterruption.resumesMessage.startsWith(prefix),
      ).toBe(true);
      expect(
        SubscriberNotificationInterruption.resendsMessage.startsWith(prefix),
      ).toBe(true);

      for (const language of LANGUAGES) {
        for (const page of [SUBSCRIBERS_PAGE, GUIDE_PAGE, NOTES_PAGE]) {
          expect({
            language: language,
            page: page,
            quoted: inlineCode(readPage(page, language)).has(prefix),
          }).toEqual({ language: language, page: page, quoted: true });
        }
      }
    });

    it("resumes only the 'created' notification, and covers scheduled maintenance and announcements too", () => {
      const source: string = readSource(SWEEPER);

      // resumesMessage is written for the incident created column alone.
      expect(
        source.match(/SubscriberNotificationInterruption\.resumesMessage/g),
      ).toHaveLength(1);
      expect(source).toMatch(
        /statusColumn:\s*"subscriberNotificationStatusOnIncidentCreated",\s*messageColumn:\s*"subscriberNotificationStatusMessage",\s*message:\s*SubscriberNotificationInterruption\.resumesMessage/,
      );

      for (const service of [
        "ScheduledMaintenanceService",
        "ScheduledMaintenanceStateTimelineService",
        "ScheduledMaintenancePublicNoteService",
        "StatusPageAnnouncementService",
      ]) {
        expect(source).toContain(`service: ${service},`);
      }

      expect(SubscriberNotificationInterruption.resumesMessage).toContain(
        "only to the status pages that were not sent it in full",
      );
      expect(SubscriberNotificationInterruption.resendsMessage).toContain(
        "again to every status page, including the subscribers who already got it",
      );
    });
  });

  describe("which notifications are counted", () => {
    it("counts every incident and episode notification, reading every subscriber", () => {
      for (const job of COUNTED_JOBS) {
        const source: string = readSource(path.join(WORKER_JOBS, job));

        expect({
          job: job,
          fansOut: source.includes("SubscriberNotificationFanOut"),
          records: source.includes("SubscriberNotificationDeliveryRecord"),
        }).toEqual({ job: job, fansOut: true, records: true });
      }
    });

    it("says scheduled maintenance and announcements are not counted yet, while they are not", () => {
      /*
       * When one of these jobs starts counting its messages, the docs'
       * "not counted this way yet" paragraph (and its 10,000-subscriber
       * limit) is out of date: update Checking what was sent, in English and
       * Persian, and this list.
       */
      for (const job of UNCOUNTED_JOBS) {
        const source: string = readSource(path.join(WORKER_JOBS, job));

        expect({
          job: job,
          fansOut: source.includes("SubscriberNotificationFanOut"),
          records: source.includes("SubscriberNotificationDeliveryRecord"),
        }).toEqual({ job: job, fansOut: false, records: false });
      }

      expect(readPage(SUBSCRIBERS_PAGE, "en")).toContain(
        `reaches at most ${numberText(SubscriberNotificationTiming.SUBSCRIBERS_PER_READ, "en")} subscribers of each status page`,
      );
      expect(readPage(SUBSCRIBERS_PAGE, "fa")).toContain(
        `حداکثر به ${numberText(SubscriberNotificationTiming.SUBSCRIBERS_PER_READ, "fa")} مشترک`,
      );
    });
  });

  describe("the dashboard's names", () => {
    it("lists every status with its label, and its public note badge, as the dashboard shows them", () => {
      const labels: Map<StatusPageSubscriberNotificationStatus, string> =
        statusLabels();

      for (const status of STATUSES) {
        const label: string | undefined = labels.get(status);
        const badge: string = getPostedNotificationSummary(status, null).label;

        expect({ status: status, hasLabel: Boolean(label) }).toEqual({
          status: status,
          hasLabel: true,
        });

        for (const language of LANGUAGES) {
          const subscribersRows: Array<Array<string>> = tableRows(
            sectionOf(
              readPage(SUBSCRIBERS_PAGE, language),
              CHECKING_SECTION[language] as string,
            ),
          );

          expect({
            language: language,
            status: status,
            row: subscribersRows.some((cells: Array<string>): boolean => {
              return cells[0] === `**${label}**` && cells[1] === `**${badge}**`;
            }),
          }).toEqual({ language: language, status: status, row: true });

          // The notes page's badge table.
          expect({
            language: language,
            badge: badge,
            row: tableRows(readPage(NOTES_PAGE, language)).some(
              (cells: Array<string>): boolean => {
                return cells[0] === `**${badge}**`;
              },
            ),
          }).toEqual({ language: language, badge: badge, row: true });
        }
      }
    });

    it("names the update badges as a note shows them", () => {
      for (const status of [
        StatusPageSubscriberNotificationStatus.Pending,
        StatusPageSubscriberNotificationStatus.Success,
        StatusPageSubscriberNotificationStatus.Failed,
      ]) {
        const summary: NoteNotificationSummary | null =
          getUpdateNotificationSummary(status, null);

        expect(summary).not.toBeNull();

        for (const language of LANGUAGES) {
          expect({
            language: language,
            label: summary?.label,
            quoted: boldText(readPage(NOTES_PAGE, language)).has(
              summary?.label || "",
            ),
          }).toEqual({
            language: language,
            label: summary?.label,
            quoted: true,
          });
        }
      }

      // A failed update offers Retry notification, and nothing else is offered on an update.
      for (const language of LANGUAGES) {
        expect(
          boldText(readPage(NOTES_PAGE, language)).has(
            SubscriberNotificationResendCopy.retryNoteNotificationButton,
          ),
        ).toBe(true);
      }
    });

    it("names the preview, the test send and the live preview as the dashboard does", () => {
      const expected: Array<{ page: string; names: Array<string> }> = [
        {
          page: SUBSCRIBERS_PAGE,
          names: [
            SubscriberNotificationPreviewCopy.previewButton,
            SubscriberNotificationPreviewCopy.sendTestButton,
            SubscriberNotificationPreviewCopy.livePreviewTitle,
          ],
        },
        {
          page: GUIDE_PAGE,
          names: [
            SubscriberNotificationPreviewCopy.previewButton,
            SubscriberNotificationPreviewCopy.sendTestButton,
            SubscriberNotificationPreviewCopy.livePreviewTitle,
          ],
        },
        {
          page: NOTES_PAGE,
          names: [
            SubscriberNotificationPreviewCopy.previewButton,
            SubscriberNotificationPreviewCopy.sendTestButton,
          ],
        },
        {
          page: DECLARING_PAGE,
          names: [
            SubscriberNotificationPreviewCopy.previewButton,
            SubscriberNotificationPreviewCopy.sendTestButton,
          ],
        },
      ];

      for (const language of LANGUAGES) {
        for (const { page, names } of expected) {
          const bold: Set<string> = boldText(readPage(page, language));

          for (const name of names) {
            expect({
              language: language,
              page: page,
              name: name,
              quoted: bold.has(name),
            }).toEqual({
              language: language,
              page: page,
              name: name,
              quoted: true,
            });
          }
        }
      }
    });

    it("names Retry and Resend as the dashboard labels them", () => {
      for (const language of LANGUAGES) {
        const bold: Set<string> = boldText(
          readPage(SUBSCRIBERS_PAGE, language),
        );

        for (const name of [
          SubscriberNotificationResendCopy.retryButton,
          SubscriberNotificationResendCopy.resendButton,
          SubscriberNotificationResendCopy.resendNoteNotificationButton,
          SubscriberNotificationResendCopy.resendToAllStatusPagesButton,
        ]) {
          expect({
            language: language,
            name: name,
            quoted: bold.has(name),
          }).toEqual({ language: language, name: name, quoted: true });
        }
      }
    });

    it("names the notes feed's search box as it reads", () => {
      const source: string = readSource(
        path.join(DASHBOARD_SRC, "Components/EventNotes/EventNotes.tsx"),
      );

      expect(source).toContain('placeholder={tx("Search notes…")}');

      for (const language of LANGUAGES) {
        expect(
          boldText(readPage(NOTES_PAGE, language)).has("Search notes…"),
        ).toBe(true);
      }
    });
  });

  describe("Send test to me", () => {
    it("quotes the subject prefix a test email is sent with", () => {
      const prefix: string =
        SubscriberNotificationPreview.testEmailSubjectPrefix.trim();

      expect(prefix).toBe("[Test]");

      for (const language of LANGUAGES) {
        expect(
          inlineCode(readPage(SUBSCRIBERS_PAGE, language)).has(prefix),
        ).toBe(true);
      }
    });

    it("quotes the per-person limit on test emails", () => {
      const config: { windowSeconds: number; perUserLimit: number } =
        SubscriberNotificationTestSendRateLimit.getConfig();
      const window: number = minutes(config.windowSeconds * 1000);

      // The docs spell the limit out in words.
      const limitInWords: { [language: string]: { [limit: number]: string } } =
        {
          en: { 10: "ten" },
          fa: { 10: "ده" },
        };

      const en: string | undefined = limitInWords["en"]?.[config.perUserLimit];
      const fa: string | undefined = limitInWords["fa"]?.[config.perUserLimit];

      expect({
        limit: config.perUserLimit,
        spelledOut: Boolean(en && fa),
      }).toEqual({ limit: config.perUserLimit, spelledOut: true });

      expect(readPage(SUBSCRIBERS_PAGE, "en")).toContain(
        `${en} test emails every ${window} minutes`,
      );
      expect(readPage(GUIDE_PAGE, "en")).toContain(
        `${en} times every ${window} minutes`,
      );
      expect(readPage(SUBSCRIBERS_PAGE, "fa")).toContain(
        `هر ${numberText(window, "fa")} دقیقه می‌تواند ${fa} ایمیل آزمایشی`,
      );
      expect(readPage(GUIDE_PAGE, "fa")).toContain(
        `${fa} بار در هر ${numberText(window, "fa")} دقیقه`,
      );
    });

    it("says the account email must be verified, as the route requires", () => {
      const route: string = readSource(
        path.join(
          REPO_ROOT,
          "App/FeatureSet/Notification/API/SubscriberNotificationPreview.ts",
        ),
      );

      expect(route).toContain("if (!user.isEmailVerified) {");
      expect(readPage(SUBSCRIBERS_PAGE, "en")).toContain(
        "it needs your account email to be verified",
      );
      expect(readPage(GUIDE_PAGE, "en")).toContain("once it is verified");
    });
  });

  describe("links and translation", () => {
    it("sends readers of every page to Checking what was sent, in their language", () => {
      for (const language of LANGUAGES) {
        const anchor: string = slugify(CHECKING_SECTION[language] as string);

        for (const page of [
          GUIDE_PAGE,
          NOTES_PAGE,
          DECLARING_PAGE,
          STATES_PAGE,
        ]) {
          expect({
            language: language,
            page: page,
            links: docsAnchors(readPage(page, language)).some(
              (link: { page: string; anchor: string }): boolean => {
                return link.page === SUBSCRIBERS_PAGE && link.anchor === anchor;
              },
            ),
          }).toEqual({ language: language, page: page, links: true });
        }
      }
    });

    it("points every link to another page's section at a heading that page has, in the same language", () => {
      for (const language of LANGUAGES) {
        for (const page of PAGES) {
          for (const link of docsAnchors(readPage(page, language))) {
            const target: string = fs.existsSync(
              path.join(CONTENT_DIR, language, `${link.page}.md`),
            )
              ? language
              : "en";
            const anchors: Array<string> = headingsOf(
              readPage(link.page, target),
            ).map((heading: Heading): string => {
              return slugify(heading.text);
            });

            expect({
              language: language,
              page: page,
              link: `${link.page}#${link.anchor}`,
              found: anchors.includes(link.anchor),
            }).toEqual({
              language: language,
              page: page,
              link: `${link.page}#${link.anchor}`,
              found: true,
            });
          }
        }
      }
    });

    it("keeps the Persian Checking what was sent section in step with the English one", () => {
      const english: string = sectionOf(
        readPage(SUBSCRIBERS_PAGE, "en"),
        CHECKING_SECTION["en"] as string,
      );
      const persian: string = sectionOf(
        readPage(SUBSCRIBERS_PAGE, "fa"),
        CHECKING_SECTION["fa"] as string,
      );

      expect(
        headingsOf(persian).map((heading: Heading): number => {
          return heading.level;
        }),
      ).toEqual(
        headingsOf(english).map((heading: Heading): number => {
          return heading.level;
        }),
      );
      expect(Array.from(inlineCode(persian)).sort()).toEqual(
        Array.from(inlineCode(english)).sort(),
      );
      expect(Array.from(docsLinks(persian)).sort()).toEqual(
        Array.from(docsLinks(english)).sort(),
      );
      expect(tableRows(persian)).toHaveLength(tableRows(english).length);

      // Screen names stay in English; anything else left in English is a leftover.
      const englishNames: Set<string> = boldText(english);

      for (const name of Array.from(boldText(persian)).filter(
        (bold: string): boolean => {
          return !PERSIAN_LETTER.test(bold);
        },
      )) {
        expect({ name: name, inEnglish: englishNames.has(name) }).toEqual({
          name: name,
          inEnglish: true,
        });
      }

      // Every paragraph and list item is Persian.
      for (const block of proseOf(persian)
        .split(/\n\s*\n/)
        .map((paragraph: string): string => {
          return paragraph.trim();
        })
        .filter((paragraph: string): boolean => {
          return paragraph.length > 0 && !paragraph.startsWith("|");
        })) {
        expect({
          block: block.slice(0, 80),
          persian: PERSIAN_LETTER.test(block),
        }).toEqual({ block: block.slice(0, 80), persian: true });
      }
    });
  });
});
