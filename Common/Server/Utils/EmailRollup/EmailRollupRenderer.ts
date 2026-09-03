import {
  MAX_ROWS_IN_ROLLUP,
  ROLLUP_PROJECT_NAME_MAX,
  ROLLUP_SUBJECT_LEAD_TITLE_MAX,
} from "./EmailRollupConstants";
import UserNotificationEmailRollupItem from "../../../Models/DatabaseModels/UserNotificationEmailRollupItem";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import RollupCategory, {
  ROLLUP_CATEGORY_LABEL,
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
 *   rollupTitle          raw          {{> EmailTitle title=...}}  -> {{title}}
 *   rollupIntroHtml      pre-escaped  {{> InfoBlock info=...}}    -> {{{info}}}
 *   categoryCountsHtml   pre-escaped  {{> TitleBlock title=...}}  -> {{{title}}}
 *   rows[].title         raw          our own table, {{this.title}}
 *   rows[].link          raw          our own table, href="{{this.link}}"
 *   rows[].hasLink       raw          {{#ifCond this.hasLink "true"}}
 *   rows[].updatesLabel  raw          our own table, {{this.updatesLabel}}
 *   hasMore              raw          {{#ifCond hasMore "true"}}
 *   moreTextHtml         pre-escaped  {{> InfoBlock info=...}}    -> {{{info}}}
 *   projectHomeLink      raw          {{> ButtonBlock buttonUrl=...}}
 *   preferencesHtml      pre-escaped  {{> InfoBlock info=...}}    -> {{{info}}}
 *   preferencesLink      raw          our own <a href="{{preferencesLink}}">
 *
 * The pre-escaped variables carry PLAIN TEXT only - no markup of our own -
 * so "contains no raw `<`" is a property a test can assert on all of them at
 * once. Every visual decision lives in the template, where a designer can
 * change it without reasoning about escaping.
 */

export interface RollupRow {
  title: string;
  link: string;
  hasLink: string;
  updatesLabel: string;
  itemCount: number;
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
  title: string;
  link: string;
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
        title: item.subject ?? "",
        link: link,
        itemCount: 1,
      });
      continue;
    }

    existing.itemCount = existing.itemCount + 1;

    /*
     * >= rather than > so that when a group's items share a timestamp the
     * LAST one in input order wins, which is what "input is sorted ascending"
     * is supposed to buy the reader.
     */
    if (createdAtMs >= existing.latestAt) {
      existing.latestAt = createdAtMs;
      existing.title = item.subject ?? "";
      existing.link = link;
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
      updatesLabel: group.itemCount === 1 ? "" : `${group.itemCount} updates`,
      itemCount: group.itemCount,
    };
  });
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

  const rollupIntro: string =
    `${notificationCount} ${notificationWord} from ${projectName} arrived in the last few minutes. ` +
    `${pluralise(notificationCount, "It has", "They have")} been grouped into this one email so your inbox is not flooded. ` +
    `Nothing was suppressed.`;

  const moreText: string =
    hiddenRows === 0
      ? ""
      : `Showing the ${rows.length} most recent. ${hiddenRows} more ${pluralise(hiddenRows, "update", "updates")} ` +
        `(covering ${hiddenItems} ${pluralise(hiddenItems, "notification", "notifications")}) ` +
        `${pluralise(hiddenRows, "is", "are")} not listed here. Open the project to see everything.`;

  const preferencesText: string =
    "OneUptime groups owner notifications into a single email when several arrive at once for the same project. " +
    "Choose which notifications you receive, or turn email off entirely, from your notification settings:";

  const rowsForTemplate: Array<JSONObject> = rows.map(
    (row: RollupRow, index: number): JSONObject => {
      return {
        title: row.title,
        link: row.link,
        hasLink: row.hasLink,
        updatesLabel: row.updatesLabel,
        /*
         * The zebra stripe is decided here, not in the template. Handlebars
         * has @index, @first, @last and @key but NOT @odd or @even, and an
         * unknown @-variable resolves to undefined rather than erroring - so
         * `{{#if @odd}}` is silently always false and every row comes out the
         * same colour. Emitting the colour as a plain string cannot rot that
         * way, and it keeps the arithmetic in the language that has some.
         */
        rowBackground: index % 2 === 1 ? "#f0f3f9" : "#ffffff",
      };
    },
  );

  const vars: Dictionary<string | JSONObject> = {
    rollupTitle: rollupTitle,
    rollupIntroHtml: escapeHtml(rollupIntro),
    categoryCountsHtml: escapeHtml(categoryCounts),
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

  const subject: string =
    notificationCount === 1
      ? `[${projectName}] 1 notification: ${leadTitle}`
      : `[${projectName}] ${notificationCount} notifications`;

  return {
    subject: subject,
    vars: vars,
  };
};
