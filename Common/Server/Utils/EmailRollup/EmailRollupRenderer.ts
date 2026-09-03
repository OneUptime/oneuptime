import {
  MAX_ROWS_IN_ROLLUP,
  ROLLUP_PROJECT_NAME_MAX,
  ROLLUP_SUBJECT_LEAD_TITLE_MAX,
  ROLLUP_SUBJECT_MAX_CATEGORIES,
} from "./EmailRollupConstants";
import UserNotificationEmailRollupItem from "../../../Models/DatabaseModels/UserNotificationEmailRollupItem";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import RollupCategory, {
  ROLLUP_CATEGORY_LABEL,
  ROLLUP_CATEGORY_ORDER,
} from "../../../Types/NotificationSetting/NotificationEmailRollupCategory";

/*
 * Why this file exists: everything that turns a pile of deferred owner
 * notifications into one readable email lives here, and nothing else does.
 * It is pure and synchronous - no database, no awaits, no clock - so the
 * flush runner can be tested for its claim/stamp/send ordering without
 * caring about copy, and the copy can be tested without a database.
 *
 * THE ESCAPING CONTRACT, WHICH THE VARIABLE NAMES ENCODE.
 *
 * A variable whose name ends in `Html` is ALREADY ESCAPED here in TypeScript
 * and is rendered by a triple-stache partial. Every other variable is RAW and
 * is escaped by Handlebars at render time. Get this backwards in either
 * direction and the failure is silent: a raw value in a triple stache is an
 * XSS hole in somebody's mail client, and a pre-escaped value in a double
 * stache shows the recipient a literal `&amp;lt;`.
 *
 * The mapping, verified against the partials themselves:
 *
 *   rollupTitle             raw          {{> EmailTitle title=...}} -> {{title}}
 *   rollupIntroHtml         pre-escaped  {{> InfoBlock info=...}}   -> {{{info}}}
 *   summaryCount            raw          our own summary card
 *   summaryWindow           raw          our own summary card
 *   categoryCounts          raw          our own summary card
 *   rows[].title            raw          our own table, {{this.title}}
 *   rows[].link             raw          our own table, href="{{this.link}}"
 *   rows[].hasLink          raw          {{#ifCond this.hasLink "true"}}
 *   rows[].metaLabel        raw          our own table, {{this.metaLabel}}
 *   rows[].isSectionStart   raw          {{#ifCond this.isSectionStart "true"}}
 *   rows[].sectionLabel     raw          our own section heading
 *   rows[].sectionCount     raw          our own section heading
 *   rows[].rowBackground    raw          our own table, style attribute
 *   hasMore                 raw          {{#ifCond hasMore "true"}}
 *   moreTextHtml            pre-escaped  {{> InfoBlock info=...}}   -> {{{info}}}
 *   projectHomeLink         raw          {{> ButtonBlock buttonUrl=...}}
 *   preferencesHtml         pre-escaped  {{> InfoBlock info=...}}   -> {{{info}}}
 *   preferencesLink         raw          our own <a href="{{preferencesLink}}">
 *
 * The summary card and the section headings are OUR OWN markup rather than
 * partials, so their text is rendered through double staches and stays RAW
 * here. That is why categoryCounts lost its `Html` suffix in this revision:
 * the name is the contract, and a pre-escaped value in the double stache it
 * now reaches would show the recipient a literal `&amp;amp;`.
 *
 * The pre-escaped variables carry PLAIN TEXT only - no markup of our own -
 * so "contains no raw `<`" is a property a test can assert on all of them at
 * once. Every visual decision lives in the template, where a designer can
 * change it without reasoning about escaping.
 */

/*
 * One folded resource: everything that happened to one incident, one monitor
 * or one probe during the burst, as a single line the reader can act on.
 *
 * The times are milliseconds rather than formatted strings because the format
 * is a decision about the WHOLE email - a rollup that spans two UTC days has
 * to print the date on every row or on none - and a row cannot see the whole
 * email. buildRollupEmail formats them once it can.
 */
export interface RollupRow {
  title: string;
  link: string;
  hasLink: string;
  itemCount: number;
  category: RollupCategory;
  firstAtMs: number;
  latestAtMs: number;
}

export interface RollupEmailInput {
  projectName: string;
  projectHomeLink: string;
  preferencesLink: string;
  /*
   * Sorted createdAt ASCENDING, the way the flush runner reads them back.
   * Folding does not depend on that ordering - it compares createdAt - but
   * the subject's lead title does, and so does the "last one wins" rule when
   * two items in a group share a timestamp.
   */
  items: Array<UserNotificationEmailRollupItem>;
}

export interface RollupEmail {
  subject: string;
  vars: Dictionary<string | JSONObject>;
}

export type FoldItemsFunction = (
  items: Array<UserNotificationEmailRollupItem>,
) => Array<RollupRow>;

export type BuildRollupEmailFunction = (input: RollupEmailInput) => RollupEmail;

type EscapeHtmlFunction = (value: string) => string;

/*
 * Deliberately a local copy, matching the convention the identical function
 * in WeeklyReadinessDigest.ts already establishes: an escape routine is small
 * enough that duplicating it costs less than the coupling of exporting one,
 * and a shared one invites a caller to escape twice.
 */
const escapeHtml: EscapeHtmlFunction = (value: string): string => {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

type StripHandlebarsBracesFunction = (value: string) => string;

/*
 * MailService compiles the SUBJECT through Handlebars as well as the body, so
 * an incident titled "{{projectName}} is down" would otherwise be substituted
 * away to nothing on its journey to the inbox. Stripping the braces is the
 * cheapest fix that cannot itself break anything: the characters are removed,
 * never interpreted.
 */
const stripHandlebarsBraces: StripHandlebarsBracesFunction = (
  value: string,
): string => {
  return value.replace(/\{\{/g, "").replace(/\}\}/g, "");
};

type TruncateFunction = (value: string, maxLength: number) => string;

/*
 * The ellipsis replaces the last kept character rather than being appended,
 * so the result is never longer than maxLength. Callers use this to stay
 * under a column length or a sane subject length, and a truncation that
 * overshoots its own limit by one character is exactly the kind of bug those
 * limits exist to prevent.
 */
const truncate: TruncateFunction = (
  value: string,
  maxLength: number,
): string => {
  if (value.length <= maxLength) {
    return value;
  }

  if (maxLength <= 1) {
    return value.slice(0, Math.max(maxLength, 0));
  }

  return `${value.slice(0, maxLength - 1)}…`;
};

type PluraliseFunction = (
  count: number,
  singular: string,
  plural: string,
) => string;

const pluralise: PluraliseFunction = (
  count: number,
  singular: string,
  plural: string,
): string => {
  return count === 1 ? singular : plural;
};

type NormaliseCategoryFunction = (value: string | undefined) => RollupCategory;

/*
 * rollupCategory is a plain string column, so a row written by a newer build
 * - or by a build that had a category this one has since removed - can carry
 * a code this process has never heard of. Such a row still belongs in the
 * counts; it just counts as Other rather than crashing the render of an email
 * that is standing in for a hundred others.
 */
const normaliseCategory: NormaliseCategoryFunction = (
  value: string | undefined,
): RollupCategory => {
  if (
    value !== undefined &&
    Object.prototype.hasOwnProperty.call(ROLLUP_CATEGORY_LABEL, value)
  ) {
    return value as RollupCategory;
  }

  return RollupCategory.Other;
};

interface RollupGroup {
  latestAt: number;
  firstAt: number;
  title: string;
  link: string;
  category: RollupCategory;
  itemCount: number;
}

interface CategoryCount {
  label: string;
  count: number;
}

/*
 * Collapse the raw notification list into the rows a human reads.
 *
 * The fold key is the deep link ALONE when there is one, not the event type
 * plus the link. That is the whole point: an incident's created,
 * acknowledged and resolved emails all point at the same incident, so they
 * become ONE row carrying the LATEST subject. A storm of 120 emails becomes
 * roughly 40 rows, and each row is more accurate than any of the individual
 * emails it replaces - every one of those was a stale snapshot by the time it
 * was read, and the row is not.
 *
 * Items with no link have nothing to fold on but their own words, so they
 * fold on event type plus subject. Two identical probe-flip notices collapse;
 * two different ones stay apart.
 */
export const foldItems: FoldItemsFunction = (
  items: Array<UserNotificationEmailRollupItem>,
): Array<RollupRow> => {
  const groups: Map<string, RollupGroup> = new Map<string, RollupGroup>();

  for (const item of items) {
    const link: string = typeof item.viewLink === "string" ? item.viewLink : "";
    const key: string =
      link === "" ? `E:${item.eventType ?? ""}|${item.subject ?? ""}` : link;
    const createdAtMs: number =
      item.createdAt instanceof Date ? item.createdAt.getTime() : 0;
    const existing: RollupGroup | undefined = groups.get(key);

    if (!existing) {
      groups.set(key, {
        latestAt: createdAtMs,
        firstAt: createdAtMs,
        title: item.subject ?? "",
        link: link,
        category: normaliseCategory(item.rollupCategory),
        itemCount: 1,
      });
      continue;
    }

    existing.itemCount = existing.itemCount + 1;

    /*
     * Tracked rather than assumed from input order. The flush runner reads its
     * items back sorted ascending, so firstAt is almost always the first item
     * seen - but "almost always" is not a property a row's own timestamp
     * should depend on, and a Math.min costs nothing.
     */
    if (createdAtMs < existing.firstAt) {
      existing.firstAt = createdAtMs;
    }

    /*
     * >= rather than > so that when a group's items share a timestamp the
     * LAST one in input order wins, which is what "input is sorted ascending"
     * is supposed to buy the reader.
     */
    if (createdAtMs >= existing.latestAt) {
      existing.latestAt = createdAtMs;
      existing.title = item.subject ?? "";
      existing.link = link;
      /*
       * The category follows the LATEST item too. A group is keyed on its deep
       * link, and two events about one resource can in principle be filed
       * under different categories - a monitor status change and the incident
       * it declared both linking to the incident, say - so the section this
       * row lands in is the one its newest event says, not the one its oldest
       * happened to say.
       */
      existing.category = normaliseCategory(item.rollupCategory);
    }
  }

  const groupList: Array<RollupGroup> = Array.from(groups.values());

  // Newest state first: the reader's eye lands on what is true right now.
  groupList.sort((a: RollupGroup, b: RollupGroup): number => {
    return b.latestAt - a.latestAt;
  });

  return groupList.map((group: RollupGroup): RollupRow => {
    return {
      title: group.title,
      link: group.link,
      hasLink: group.link === "" ? "false" : "true",
      itemCount: group.itemCount,
      category: group.category,
      firstAtMs: group.firstAt,
      latestAtMs: group.latestAt,
    };
  });
};

const MONTH_NAMES: ReadonlyArray<string> = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

type PadFunction = (value: number) => string;

const pad: PadFunction = (value: number): string => {
  return value < 10 ? `0${value}` : `${value}`;
};

type FormatTimeFunction = (ms: number, withDate: boolean) => string;

/*
 * UTC, spelled out, and never the server's local time.
 *
 * The times in this email are the one piece of information the individual
 * emails it replaces did not carry - each of those WAS its own timestamp,
 * because it arrived when it happened, and a rollup that arrives minutes
 * later owes the reader the difference. Getting the zone wrong turns that
 * into a lie, and there are two ways to get it wrong: this process's TZ is a
 * deployment detail that says nothing about where the recipient is, and the
 * recipient's own timezone is not a thing this pure function is allowed to
 * go and look up. An explicit "UTC" suffix is the honest answer, is the same
 * for every recipient of the same storm - so two colleagues comparing inboxes
 * see the same numbers - and is deterministic in a test.
 *
 * Intl is deliberately not used: it would pull the format from an ICU build
 * that differs between the App image and a developer's laptop, and a rollup
 * email is not the place to discover that.
 */
const formatTime: FormatTimeFunction = (
  ms: number,
  withDate: boolean,
): string => {
  const date: Date = new Date(ms);
  const clock: string = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;

  if (!withDate) {
    return `${clock} UTC`;
  }

  return `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCDate()}, ${clock} UTC`;
};

type SpansMultipleDaysFunction = (
  earliestMs: number,
  latestMs: number,
) => boolean;

/*
 * True when the window crosses a UTC date boundary, in which case EVERY time
 * in the email prints its date.
 *
 * A rollup normally covers ten minutes, so the date is noise. But a backlog
 * that drained slowly, or a bucket that sat behind a wedged send, can carry
 * items hours or days apart - and "14:22" against "09:03" with no date is
 * actively misleading about which came first. The decision is made once, for
 * the whole email, because a table where some rows carry a date and others do
 * not is harder to read than either consistent choice.
 */
const spansMultipleDays: SpansMultipleDaysFunction = (
  earliestMs: number,
  latestMs: number,
): boolean => {
  const earliest: Date = new Date(earliestMs);
  const latest: Date = new Date(latestMs);

  return (
    earliest.getUTCFullYear() !== latest.getUTCFullYear() ||
    earliest.getUTCMonth() !== latest.getUTCMonth() ||
    earliest.getUTCDate() !== latest.getUTCDate()
  );
};

interface RollupSection {
  category: RollupCategory;
  label: string;
  rows: Array<RollupRow>;
}

type GroupRowsIntoSectionsFunction = (
  rows: Array<RollupRow>,
) => Array<RollupSection>;

/*
 * Split the rendered rows into the sections the email lists them under.
 *
 * Sections follow ROLLUP_CATEGORY_ORDER - fixed, urgency-first - and rows
 * inside a section keep the newest-first order foldItems gave them. A
 * category with no rows produces no section at all, so an email about one
 * flapping probe is one heading, not eleven empty ones.
 */
const groupRowsIntoSections: GroupRowsIntoSectionsFunction = (
  rows: Array<RollupRow>,
): Array<RollupSection> => {
  const byCategory: Map<RollupCategory, Array<RollupRow>> = new Map<
    RollupCategory,
    Array<RollupRow>
  >();

  for (const row of rows) {
    const existing: Array<RollupRow> | undefined = byCategory.get(row.category);

    if (existing) {
      existing.push(row);
      continue;
    }

    byCategory.set(row.category, [row]);
  }

  const sections: Array<RollupSection> = [];

  for (const category of ROLLUP_CATEGORY_ORDER) {
    const sectionRows: Array<RollupRow> | undefined = byCategory.get(category);

    if (!sectionRows || sectionRows.length === 0) {
      continue;
    }

    sections.push({
      category: category,
      label: ROLLUP_CATEGORY_LABEL[category],
      rows: sectionRows,
    });

    byCategory.delete(category);
  }

  /*
   * ANYTHING ROLLUP_CATEGORY_ORDER FORGOT STILL GETS RENDERED, at the end.
   *
   * A category missing from that array is a bug, and the ratchet test exists
   * to catch it - but the failure mode if one ever slips through must not be
   * that a recipient's incidents quietly do not appear in an email whose one
   * promise is that nothing was suppressed. Sorted by label so the output
   * stays deterministic instead of depending on Map insertion order.
   */
  const leftovers: Array<RollupSection> = Array.from(byCategory.entries()).map(
    (entry: [RollupCategory, Array<RollupRow>]): RollupSection => {
      return {
        category: entry[0],
        label:
          ROLLUP_CATEGORY_LABEL[entry[0]] ??
          ROLLUP_CATEGORY_LABEL[RollupCategory.Other],
        rows: entry[1],
      };
    },
  );

  leftovers.sort((a: RollupSection, b: RollupSection): number => {
    if (a.label === b.label) {
      return 0;
    }

    return a.label < b.label ? -1 : 1;
  });

  return sections.concat(leftovers);
};

/*
 * Build the subject and the complete Handlebars variable set for one rollup
 * email. Every string the recipient sees is composed HERE, in TypeScript,
 * because the `concat` helper the templates register takes exactly two
 * arguments and silently drops the rest - a trap two shipped templates are
 * standing in today. NotificationRollup.hbs therefore contains no `concat`
 * call at all, and a test pins that.
 */
export const buildRollupEmail: BuildRollupEmailFunction = (
  input: RollupEmailInput,
): RollupEmail => {
  const items: Array<UserNotificationEmailRollupItem> = input.items;
  const allRows: Array<RollupRow> = foldItems(items);
  const rows: Array<RollupRow> = allRows.slice(0, MAX_ROWS_IN_ROLLUP);
  const hiddenRowList: Array<RollupRow> = allRows.slice(rows.length);
  const hiddenRows: number = hiddenRowList.length;

  let hiddenItems: number = 0;

  for (const row of hiddenRowList) {
    hiddenItems = hiddenItems + row.itemCount;
  }

  /*
   * Counted over ALL items, never over the rendered slice. A 300-item rollup
   * that can only show 100 rows still tells the reader there were 300 things,
   * because the whole promise of this email is that nothing was suppressed.
   */
  const countsByCategory: Map<RollupCategory, number> = new Map<
    RollupCategory,
    number
  >();

  for (const item of items) {
    const category: RollupCategory = normaliseCategory(item.rollupCategory);

    countsByCategory.set(category, (countsByCategory.get(category) ?? 0) + 1);
  }

  const categoryCountList: Array<CategoryCount> = Array.from(
    countsByCategory.entries(),
  ).map((entry: [RollupCategory, number]): CategoryCount => {
    return {
      label: ROLLUP_CATEGORY_LABEL[entry[0]],
      count: entry[1],
    };
  });

  categoryCountList.sort((a: CategoryCount, b: CategoryCount): number => {
    if (a.count !== b.count) {
      return b.count - a.count;
    }

    if (a.label === b.label) {
      return 0;
    }

    return a.label < b.label ? -1 : 1;
  });

  const categoryCounts: string = categoryCountList
    .map((entry: CategoryCount): string => {
      return `${entry.count} ${entry.label}`;
    })
    .join(" · ");

  const projectName: string = truncate(
    stripHandlebarsBraces(input.projectName || "your project"),
    ROLLUP_PROJECT_NAME_MAX,
  );
  const notificationCount: number = items.length;
  const notificationWord: string = pluralise(
    notificationCount,
    "notification",
    "notifications",
  );

  const rollupTitle: string = `${notificationCount} ${notificationWord} from ${projectName}`;

  /*
   * THE TIME WINDOW, WHICH IS THE ONE THING THE INDIVIDUAL EMAILS ALREADY
   * TOLD THE READER AND THIS EMAIL OTHERWISE WOULD NOT.
   *
   * Each of the forty emails this replaces arrived when its event happened,
   * so its arrival time WAS its timestamp. One email that lands five minutes
   * later has to say what period it covers, or a reader cannot tell a storm
   * that ended twenty minutes ago from one still in progress.
   *
   * Empty items produce an empty window rather than a formatted epoch zero.
   * buildRollupEmail is never called with none - the flush runner returns
   * Empty before it gets here - but "1 Jan 1970" is a bad way to find that
   * out, and the test suite calls it directly.
   */
  const timestamps: Array<number> = allRows
    .flatMap((row: RollupRow): Array<number> => {
      return [row.firstAtMs, row.latestAtMs];
    })
    .filter((value: number): boolean => {
      return value > 0;
    });

  const earliestMs: number =
    timestamps.length === 0 ? 0 : Math.min(...timestamps);
  const latestMs: number =
    timestamps.length === 0 ? 0 : Math.max(...timestamps);
  const withDate: boolean =
    timestamps.length > 0 && spansMultipleDays(earliestMs, latestMs);

  let summaryWindow: string = "";

  if (timestamps.length > 0) {
    const earliestLabel: string = formatTime(earliestMs, withDate);
    const latestLabel: string = formatTime(latestMs, withDate);

    summaryWindow =
      earliestLabel === latestLabel
        ? earliestLabel
        : `${earliestLabel} to ${latestLabel}`;
  }

  const summaryCount: string = `${notificationCount} ${notificationWord}`;

  /*
   * The intro says WHY this email exists; the summary card beside it says
   * what is in it. Splitting the two that way is what keeps the count, the
   * window and the category breakdown out of the prose, where they read as a
   * paragraph nobody finishes, and in the card, where they are three lines
   * the eye takes in at once.
   */
  const rollupIntro: string =
    notificationCount === 1
      ? `OneUptime grouped this notification from ${projectName} into a single email. Nothing was suppressed.`
      : `OneUptime grouped these ${notificationCount} notifications from ${projectName} into a single email ` +
        `instead of sending ${notificationCount} separate messages. Nothing was suppressed.`;

  const moreText: string =
    hiddenRows === 0
      ? ""
      : `Showing the ${rows.length} most recent. ${hiddenRows} more ${pluralise(hiddenRows, "update", "updates")} ` +
        `(covering ${hiddenItems} ${pluralise(hiddenItems, "notification", "notifications")}) ` +
        `${pluralise(hiddenRows, "is", "are")} not listed here. Open the project to see everything.`;

  /*
   * The reader of this email did not ask for it, so the footer owes them the
   * way out and not just an explanation. Rollup ships on with no preference,
   * which means somebody who wants an email per event has no idea a switch
   * exists unless this paragraph says so - and it is a per-project switch, so
   * "for this project" is load-bearing rather than padding. It sits under the
   * template's own heading, "Why did I get one email instead of several?",
   * and ends in a colon because the preferencesLink is rendered immediately
   * below it as the sentence's object.
   */
  const preferencesText: string =
    "OneUptime groups owner notifications into a single email when several arrive at once for the same project. " +
    "To go back to one email per notification, sent the moment it happens, turn off email rollup for this project in your notification settings. " +
    "The same page is where you choose which notifications you receive, or turn email off entirely:";

  /*
   * ONE FLAT ARRAY, WITH THE SECTION HEADING CARRIED ON ITS FIRST ROW.
   *
   * The alternative - nesting rows inside a sections array and using two
   * {{#each}} blocks - reads better as data and worse as everything else. It
   * needs a second `this.`-scope in the template, which the test that pins
   * "the template reads no field the builder does not set" cannot then tell
   * apart from the row scope; and a heading in its own <table> breaks the
   * shared borders that make the list look like one list in Outlook. A flag
   * on the first row of each section keeps the template to one loop and one
   * scope, and keeps the whole list inside one <table>.
   */
  const sections: Array<RollupSection> = groupRowsIntoSections(rows);
  const rowsForTemplate: Array<JSONObject> = [];

  for (const section of sections) {
    /*
     * THE HEADING COUNTS NOTIFICATIONS, NOT ROWS, so the numbers in this
     * email reconcile instead of contradicting each other.
     *
     * A section of two incidents can carry five notifications - created,
     * acknowledged and resolved for one, created and a note for the other -
     * and a heading that said "2" beside a summary card saying "5 Incidents"
     * would read as a bug in the email. Counting updates makes the heading
     * the sum of its rows' own "3 updates" labels AND the matching entry in
     * the card, which is the only version a reader can check.
     */
    let sectionItemCount: number = 0;

    for (const row of section.rows) {
      sectionItemCount = sectionItemCount + row.itemCount;
    }

    const sectionCount: string = `${sectionItemCount} ${pluralise(
      sectionItemCount,
      "update",
      "updates",
    )}`;

    section.rows.forEach((row: RollupRow, index: number): void => {
      /*
       * The row's own timestamp, and the count of what folded into it. A
       * single-update row says only when it happened; a folded one says how
       * many updates there were and when the LATEST of them was, because the
       * title it carries is that latest update's words.
       */
      const timeLabel: string = formatTime(row.latestAtMs, withDate);
      const metaLabel: string =
        row.itemCount === 1
          ? timeLabel
          : `${row.itemCount} updates · latest ${timeLabel}`;

      rowsForTemplate.push({
        title: row.title,
        link: row.link,
        hasLink: row.hasLink,
        metaLabel: metaLabel,
        /*
         * The heading is emitted by the first row of the section rather than
         * by an entry of its own, so every element of this array is a real
         * row with a real title - an array with two shapes in it is how a
         * heading ends up rendering an empty href.
         */
        isSectionStart: index === 0 ? "true" : "false",
        sectionLabel: section.label,
        sectionCount: sectionCount,
        /*
         * The zebra stripe is decided here, not in the template. Handlebars
         * has @index, @first, @last and @key but NOT @odd or @even, and an
         * unknown @-variable resolves to undefined rather than erroring - so
         * `{{#if @odd}}` is silently always false and every row comes out the
         * same colour. Emitting the colour as a plain string cannot rot that
         * way, and it keeps the arithmetic in the language that has some.
         *
         * The index is the row's position WITHIN ITS SECTION, so every
         * section starts on white and the stripe reads as part of the section
         * rather than as a pattern running underneath the headings.
         */
        rowBackground: index % 2 === 1 ? "#f7f9fc" : "#ffffff",
      });
    });
  }

  const vars: Dictionary<string | JSONObject> = {
    rollupTitle: rollupTitle,
    rollupIntroHtml: escapeHtml(rollupIntro),
    summaryCount: summaryCount,
    summaryWindow: summaryWindow,
    categoryCounts: categoryCounts,
    /*
     * Dictionary<string | JSONObject> does not accept a bare array, and every
     * other template in the codebase that renders a table launders its rows
     * through this same double cast.
     */
    rows: rowsForTemplate as unknown as JSONObject,
    hasMore: hiddenRows === 0 ? "false" : "true",
    moreTextHtml: escapeHtml(moreText),
    projectHomeLink: input.projectHomeLink,
    preferencesHtml: escapeHtml(preferencesText),
    preferencesLink: input.preferencesLink,
  };

  const leadTitle: string = truncate(
    stripHandlebarsBraces(allRows[0]?.title ?? ""),
    ROLLUP_SUBJECT_LEAD_TITLE_MAX,
  );

  /*
   * THE SUBJECT SAYS WHAT KIND OF STORM THIS IS, not just how big it was.
   *
   * "[Acme] 15 notifications" is what a reader sees in a list of forty other
   * subjects, and it does not distinguish a probe that flapped fifteen times
   * - which can wait until after lunch - from three incidents and a monitor
   * outage, which cannot. The categories are already counted for the summary
   * card; spending them on the subject line costs nothing and is the only
   * part of this email that gets read before it is opened.
   *
   * Sorted by count, so the biggest thing leads; capped, because a client
   * truncates the tail at a width this code cannot see, and a truncation this
   * code performs can at least say how much it left out.
   */
  const namedCategories: Array<CategoryCount> = categoryCountList.slice(
    0,
    ROLLUP_SUBJECT_MAX_CATEGORIES,
  );
  const unnamedCategories: number =
    categoryCountList.length - namedCategories.length;
  const categorySummary: string = namedCategories
    .map((entry: CategoryCount): string => {
      return `${entry.count} ${entry.label}`;
    })
    .join(", ");
  const subjectTail: string =
    unnamedCategories === 0
      ? categorySummary
      : `${categorySummary} +${unnamedCategories} more`;

  const subject: string =
    notificationCount === 1
      ? `[${projectName}] 1 notification: ${leadTitle}`
      : `[${projectName}] ${notificationCount} notifications: ${subjectTail}`;

  return {
    subject: subject,
    vars: vars,
  };
};
