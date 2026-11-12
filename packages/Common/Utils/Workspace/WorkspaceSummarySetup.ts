import BadDataException from "../../Types/Exception/BadDataException";

/*
 * WHAT A WORKSPACE SUMMARY NEEDS BEFORE IT CAN BE SENT AT ALL: a project, a
 * channel to post in, and something to say.
 *
 * A summary without them can never be sent, however often it is tried. The
 * report worker tried it again every minute for ever - it put the next send
 * back each time the send threw - and nothing told the project why the
 * summary never came (#7116). Now:
 *
 *   - such a summary is refused when it is created or changed, through the
 *     API or the dashboard (WorkspaceNotificationSummaryService);
 *   - one stored already - before this, or written past the API - is not
 *     sent: the send throws WorkspaceSummaryNotSendableException, the
 *     summary's Notification Logs get an Error row saying why, and the
 *     worker leaves its next send moved on, so it is tried again at its
 *     next time, not a minute later.
 *
 * Channel names are read as a summary may hold them: a list, or the text
 * the dashboard's edit form saved them as ("#ops, #alerts") before it sent
 * a list - each name trimmed, the blank ones left out.
 *
 * Pure, in Common/Utils, so the service, the report worker and the
 * dashboard's form read a summary the same way.
 */

/*
 * Why a summary cannot be sent, in words a person reads where they meet
 * them: the summary form's refusal, Send Test Now's Test Failed (then "Fix
 * the problem above, then send the test again.") and the Error row of the
 * summary's Notification Logs. They were "No channel names configured for
 * summary" and "No summary items selected"; the items are named by the
 * form's field, What to Include, where they are picked. The project one
 * never reaches a person: a summary has its project from the dashboard.
 */
export const WORKSPACE_SUMMARY_NO_PROJECT_REASON: string =
  "Summary project ID not found";
export const WORKSPACE_SUMMARY_NO_CHANNELS_REASON: string =
  "The summary has no channel to post in.";
export const WORKSPACE_SUMMARY_NO_ITEMS_REASON: string =
  "The summary has no items picked under What to Include.";

/*
 * HOW MANY DAYS A SUMMARY COVERS - its Lookback Period (Days): a whole
 * number of days from 1 to a year (#7352).
 *
 * Nothing held it. 0 was refused on create as "numberOfDaysOfData is
 * required" - the column's name, not the field's - and saved by an edit,
 * after which the summary covered 7 days while the summaries table said 0.
 * A negative number was saved, and the summary then covered a window in
 * the future, so it always said nothing had happened. A part of a day
 * reached the integer column and came back as a database error. Now:
 *
 *   - every create and edit, the dashboard's, the API's and OneUptime's
 *     own, is held to it in the field's own words (normalizeWrite), and
 *     text that spells a number is saved as the number;
 *   - the dashboard's box refuses what this refuses (MIN/MAX);
 *   - a summary stored before with less than a day covers the 7 the
 *     column defaults to, one with more than a year covers a year
 *     (getLookbackDays) - never a window in the future. The report, Send
 *     Test Now and the summaries table read it the same way.
 */
export const DEFAULT_LOOKBACK_DAYS: number = 7;
export const MIN_LOOKBACK_DAYS: number = 1;
export const MAX_LOOKBACK_DAYS: number = 365;
export const WORKSPACE_SUMMARY_LOOKBACK_REASON: string =
  "Lookback Period (Days) must be a whole number of days from 1 to 365 (a year).";

// Channel names typed as one text: the names between its commas.
const CHANNEL_NAME_SEPARATOR: string = ",";

/*
 * A summary that cannot be sent as it is set up (getSendProblem). A
 * BadDataException, so the API answers it as it did; the report worker
 * tells it from a passing failure - the database - by its class.
 */
export class WorkspaceSummaryNotSendableException extends BadDataException {}

// The columns of a summary this reads, as a write carries them.
const CHANNEL_NAMES_COLUMN: string = "channelNames";
const SUMMARY_ITEMS_COLUMN: string = "summaryItems";
export const LOOKBACK_DAYS_COLUMN: string = "numberOfDaysOfData";

export default class WorkspaceSummarySetup {
  /*
   * The channels a summary names: a list's texts, or the names between the
   * commas of one text - each trimmed, none blank, in their order.
   */
  public static readChannelNames(value: unknown): Array<string> {
    if (typeof value === "string") {
      return WorkspaceSummarySetup.readTexts(
        value.split(CHANNEL_NAME_SEPARATOR),
      );
    }

    return WorkspaceSummarySetup.readTexts(value);
  }

  /*
   * What a summary includes: a list's texts, or one text as one item -
   * each trimmed, none blank, in their order.
   */
  public static readSummaryItems(value: unknown): Array<string> {
    if (typeof value === "string") {
      return WorkspaceSummarySetup.readTexts([value]);
    }

    return WorkspaceSummarySetup.readTexts(value);
  }

  /*
   * The days a write may save: a whole number from 1 to a year, or text
   * that spells one, as a form or an API client may send it - or null.
   */
  public static readLookbackDays(value: unknown): number | null {
    const days: number = WorkspaceSummarySetup.readNumber(value);

    if (
      !Number.isInteger(days) ||
      days < MIN_LOOKBACK_DAYS ||
      days > MAX_LOOKBACK_DAYS
    ) {
      return null;
    }

    return days;
  }

  /*
   * The days a stored summary covers: its own, a year at most, and the 7 the
   * column defaults to for one stored with less than a day, or with none.
   * Never a window in the future.
   */
  public static getLookbackDays(value: unknown): number {
    const days: number = WorkspaceSummarySetup.readNumber(value);

    if (!Number.isInteger(days) || days < MIN_LOOKBACK_DAYS) {
      return DEFAULT_LOOKBACK_DAYS;
    }

    return Math.min(days, MAX_LOOKBACK_DAYS);
  }

  /*
   * Why a summary cannot be sent as it is set up, or null: no project, no
   * channel to post in, or nothing to include - asked in that order, as
   * sendSummary always has.
   */
  public static getSendProblem(data: {
    hasProject: boolean;
    channelNames: Array<string>;
    summaryItems: Array<string>;
  }): string | null {
    if (!data.hasProject) {
      return WORKSPACE_SUMMARY_NO_PROJECT_REASON;
    }

    if (data.channelNames.length === 0) {
      return WORKSPACE_SUMMARY_NO_CHANNELS_REASON;
    }

    if (data.summaryItems.length === 0) {
      return WORKSPACE_SUMMARY_NO_ITEMS_REASON;
    }

    return null;
  }

  /*
   * A create or an update of a summary: the channel names and the items it
   * writes, written back as lists (readChannelNames, readSummaryItems), its
   * Lookback Period written back as the whole number of days it names
   * (readLookbackDays), and why they would leave the summary nothing to
   * send, or no days it can cover - or null. The channels are said first,
   * then the items, then the days.
   *
   * Only the columns it writes are read: one holding anything but undefined
   * (a model has every column, undefined until set; null clears one). So a
   * change of a summary's name, or the worker moving its next send, is
   * never refused for them - not even for days stored before they were
   * checked - and a create without channels or items is refused as any
   * create without a required column is ("channelNames is required").
   */
  public static normalizeWrite(write: Record<string, unknown>): string | null {
    let problem: string | null = null;

    if (write[CHANNEL_NAMES_COLUMN] !== undefined) {
      const channelNames: Array<string> =
        WorkspaceSummarySetup.readChannelNames(write[CHANNEL_NAMES_COLUMN]);

      write[CHANNEL_NAMES_COLUMN] = channelNames;

      if (channelNames.length === 0) {
        problem = WORKSPACE_SUMMARY_NO_CHANNELS_REASON;
      }
    }

    if (write[SUMMARY_ITEMS_COLUMN] !== undefined) {
      const summaryItems: Array<string> =
        WorkspaceSummarySetup.readSummaryItems(write[SUMMARY_ITEMS_COLUMN]);

      write[SUMMARY_ITEMS_COLUMN] = summaryItems;

      if (summaryItems.length === 0 && !problem) {
        problem = WORKSPACE_SUMMARY_NO_ITEMS_REASON;
      }
    }

    if (write[LOOKBACK_DAYS_COLUMN] !== undefined) {
      const days: number | null = WorkspaceSummarySetup.readLookbackDays(
        write[LOOKBACK_DAYS_COLUMN],
      );

      if (days !== null) {
        write[LOOKBACK_DAYS_COLUMN] = days;
      } else if (!problem) {
        problem = WORKSPACE_SUMMARY_LOOKBACK_REASON;
      }
    }

    return problem;
  }

  // A number, or the number a text spells once trimmed; anything else is NaN.
  private static readNumber(value: unknown): number {
    if (typeof value === "number") {
      return value;
    }

    if (typeof value === "string" && value.trim()) {
      return Number(value.trim());
    }

    return Number.NaN;
  }

  // A list's texts, each trimmed, none blank; anything but a list holds none.
  private static readTexts(value: unknown): Array<string> {
    if (!Array.isArray(value)) {
      return [];
    }

    const texts: Array<string> = [];

    for (const item of value) {
      if (typeof item !== "string") {
        continue;
      }

      const text: string = item.trim();

      if (text) {
        texts.push(text);
      }
    }

    return texts;
  }
}
