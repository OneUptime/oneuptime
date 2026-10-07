import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import ObjectID from "../../../Types/ObjectID";
import { escapeMarkdownValue } from "../../../Utils/Markdown/MarkdownEscape";
import StatusPageService from "../../Services/StatusPageService";
import QueryHelper from "../../Types/Database/QueryHelper";
import ReferenceChange from "../Database/ReferenceChange";
import EventFieldChange, {
  EventFieldSet,
  EventValuesBeforeUpdate,
  SCHEDULED_MAINTENANCE_FIELDS,
} from "../EventFieldChange";

/*
 * WHAT AN UPDATE REALLY CHANGES ON A SCHEDULED MAINTENANCE EVENT.
 *
 * An event's "updated" feed item - posted to its Slack and Microsoft Teams
 * channels as well - has a line for each of its title, its window (when it
 * starts and ends), its description, the reminders its subscribers get
 * before it starts, what it affects, the status pages it is shown on and
 * its labels that an update changes; a change of the labels or of its Send
 * reminders switch also matches its reminder rule again, which starts the
 * reminder interval over.
 *
 * The event's Maintenance Details card sends the title, the window, the
 * labels, the status pages and the reminders with every save, and an API
 * client, Terraform or a workflow may write the whole event back. So
 * ScheduledMaintenanceService reads what each event holds before the write
 * - one read of its own columns the update writes, and one per list (a
 * read of two many-to-many lists joins a row for every pair) - and every
 * line follows a real change, compared here on EventFieldChange's rules:
 *
 * - the title and the description as text (EventFieldChange.normalizeText);
 * - the window as the instants it names: a time written back as a Date, an
 *   ISO string in any time zone or a number of milliseconds is the same
 *   time (EventFieldChange.isInstantChanged);
 * - the reminders before the event as a set: their order and a repeated
 *   one mean nothing, as the job that sends them reads only the earliest
 *   still to come (normalizeReminderList);
 * - the labels and the status pages as the sets of records they name
 *   (ReferenceChange.isListChanged), as the affected resources are;
 * - Send reminders as on or off (EventFieldChange.areRemindersOn).
 *
 * An event the read did not see counts as changed, so a real change is
 * never missed.
 */

// The two times of an event's window, in the order the feed lists them.
export type ScheduledMaintenanceTimeColumn = "startsAt" | "endsAt";

// The column that holds the reminders subscribers get before the event.
export const REMINDERS_BEFORE_THE_EVENT_COLUMN: string =
  "sendSubscriberNotificationsOnBeforeTheEvent";

// The compared columns an update writes; the same shape says which it changes.
export interface ScheduledMaintenanceFieldSet extends EventFieldSet {
  timeColumns: Array<ScheduledMaintenanceTimeColumn>;
  remindersBeforeTheEvent: boolean;
}

/*
 * What an event held before an update, for the compared columns the update
 * writes. A column it leaves out is not read, and stays undefined here.
 */
export interface ScheduledMaintenanceValuesBeforeUpdate
  extends EventValuesBeforeUpdate {
  // Each time as the instant it names (EventFieldChange.toInstant).
  startsAt?: number | null | undefined;
  endsAt?: number | null | undefined;
  // The reminders before the event, normalized (normalizeReminderList).
  remindersBeforeTheEvent?: Array<string> | undefined;
}

// How each interval reads, as the dashboard shows a reminder.
const INTERVAL_NAMES: Record<EventInterval, { one: string; other: string }> = {
  [EventInterval.Hour]: { one: "Hour", other: "Hours" },
  [EventInterval.Day]: { one: "Day", other: "Days" },
  [EventInterval.Week]: { one: "Week", other: "Weeks" },
  [EventInterval.Month]: { one: "Month", other: "Months" },
  [EventInterval.Year]: { one: "Year", other: "Years" },
};

// The order a reminder list reads in: the longest time before the event first.
const INTERVAL_ORDER: Array<EventInterval> = [
  EventInterval.Year,
  EventInterval.Month,
  EventInterval.Week,
  EventInterval.Day,
  EventInterval.Hour,
];

export default class ScheduledMaintenanceFieldChange {
  public static readonly timeColumns: ReadonlyArray<ScheduledMaintenanceTimeColumn> =
    ["startsAt", "endsAt"];

  // What the feed item says when every reminder before the event was taken off.
  public static readonly noRemindersLine: string =
    "No reminders before the event.";

  // What it says when the event was taken off every status page.
  public static readonly noStatusPagesLine: string =
    "Not shown on any status page.";

  // What it says when the event no longer affects anything.
  public static readonly noResourcesLine: string = "No resources affected.";

  /*
   * The compared columns an update writes. A column left out - or sent as
   * undefined, which writes nothing - is not written; one sent as null is.
   */
  public static getFieldsWritten(
    written: Record<string, unknown> | null | undefined,
  ): ScheduledMaintenanceFieldSet {
    const data: Record<string, unknown> = written || {};

    return {
      ...EventFieldChange.getFieldsWritten(data, SCHEDULED_MAINTENANCE_FIELDS),
      timeColumns: this.timeColumns.filter(
        (column: ScheduledMaintenanceTimeColumn): boolean => {
          return data[column] !== undefined;
        },
      ),
      remindersBeforeTheEvent:
        data[REMINDERS_BEFORE_THE_EVENT_COLUMN] !== undefined,
    };
  }

  public static isAnySet(fields: ScheduledMaintenanceFieldSet): boolean {
    return (
      EventFieldChange.isAnySet(fields) ||
      fields.timeColumns.length > 0 ||
      fields.remindersBeforeTheEvent
    );
  }

  /*
   * The columns the read before the write asks for, for the fields the
   * update writes and no others.
   */
  public static getSelect(
    fields: ScheduledMaintenanceFieldSet,
  ): Record<string, unknown> {
    const select: Record<string, unknown> = EventFieldChange.getSelect(fields);

    for (const column of fields.timeColumns) {
      select[column] = true;
    }

    if (fields.remindersBeforeTheEvent) {
      select[REMINDERS_BEFORE_THE_EVENT_COLUMN] = true;
    }

    return select;
  }

  // What an event read with getSelect held, for each column the update writes.
  public static getValuesBeforeUpdate(data: {
    record: unknown;
    fields: ScheduledMaintenanceFieldSet;
  }): ScheduledMaintenanceValuesBeforeUpdate {
    const record: Record<string, unknown> = (data.record || {}) as Record<
      string,
      unknown
    >;

    const values: ScheduledMaintenanceValuesBeforeUpdate =
      EventFieldChange.getValuesBeforeUpdate({
        record: data.record,
        fields: data.fields,
      });

    for (const column of data.fields.timeColumns) {
      values[column] = EventFieldChange.toInstant(record[column]);
    }

    if (data.fields.remindersBeforeTheEvent) {
      values.remindersBeforeTheEvent = this.normalizeReminderList(
        record[REMINDERS_BEFORE_THE_EVENT_COLUMN],
      );
    }

    return values;
  }

  /*
   * What an update changed on one event, compared with what it held before
   * the write. `valuesBeforeUpdate` is undefined for an event that read did
   * not see: everything the update writes then counts as changed.
   */
  public static getChanges(data: {
    written: Record<string, unknown> | null | undefined;
    valuesBeforeUpdate: ScheduledMaintenanceValuesBeforeUpdate | undefined;
  }): ScheduledMaintenanceFieldSet {
    const written: Record<string, unknown> = data.written || {};
    const before: ScheduledMaintenanceValuesBeforeUpdate | undefined =
      data.valuesBeforeUpdate;

    return {
      ...EventFieldChange.getChanges({
        written: written,
        valuesBeforeUpdate: before,
        kind: SCHEDULED_MAINTENANCE_FIELDS,
      }),
      timeColumns: this.timeColumns.filter(
        (column: ScheduledMaintenanceTimeColumn): boolean => {
          return EventFieldChange.isInstantChanged({
            writtenValue: written[column],
            valueBeforeUpdate: before ? before[column] : undefined,
          });
        },
      ),
      remindersBeforeTheEvent: this.isReminderListChanged({
        writtenList: written[REMINDERS_BEFORE_THE_EVENT_COLUMN],
        remindersBeforeUpdate: before
          ? before.remindersBeforeTheEvent
          : undefined,
      }),
    };
  }

  /*
   * A reminder before the event as one comparable key, "<count> <interval>"
   * ("1 Day"), whatever shape it arrived in: a Recurring, or its JSON (the
   * API, a workflow). Null for an entry that is not a reminder.
   */
  public static getReminderKey(reminder: unknown): string | null {
    try {
      const recurring: Recurring = Recurring.fromJSON(
        reminder as Recurring,
      );
      const count: number = recurring.intervalCount.toNumber();

      if (!Number.isFinite(count) || !INTERVAL_NAMES[recurring.intervalType]) {
        return null;
      }

      return `${count} ${recurring.intervalType}`;
    } catch {
      return null;
    }
  }

  /*
   * The reminders a list names, as their keys (getReminderKey), each once,
   * longest before the event first. A list cleared to null names none, as
   * [] does. An entry that is not a reminder is kept as its JSON, so a list
   * that changes it still counts as changed.
   */
  public static normalizeReminderList(list: unknown): Array<string> {
    if (list === undefined || list === null) {
      return [];
    }

    const keys: Set<string> = new Set<string>();

    for (const entry of Array.isArray(list) ? list : [list]) {
      if (entry === undefined || entry === null) {
        continue;
      }

      keys.add(this.getReminderKey(entry) || JSON.stringify(entry));
    }

    return Array.from(keys).sort((first: string, second: string): number => {
      return this.getReminderSortValue(first) - this.getReminderSortValue(second);
    });
  }

  /*
   * True when an update that writes the reminders before the event leaves
   * the event with another set of them than it had. Their order, and a
   * repeated one, mean nothing; [] and null both clear them. A list left
   * out writes nothing; an event the read before the write did not see
   * counts as changed.
   */
  public static isReminderListChanged(data: {
    writtenList: unknown;
    remindersBeforeUpdate: Array<string> | undefined;
  }): boolean {
    if (data.writtenList === undefined) {
      return false;
    }

    if (data.remindersBeforeUpdate === undefined) {
      return true;
    }

    const written: Array<string> = this.normalizeReminderList(
      data.writtenList,
    );

    return (
      written.length !== data.remindersBeforeUpdate.length ||
      written.some((key: string): boolean => {
        return !data.remindersBeforeUpdate!.includes(key);
      })
    );
  }

  /*
   * The feed item's lines for the title, the window, the description and
   * the reminders before the event an update changed, in that order - the
   * order the feed has always listed them in - each showing the value the
   * update wrote; "" when it changed none of them. The labels, the affected
   * resources and the status pages are the service's to add, after them.
   */
  public static getFeedMarkdown(data: {
    written: Record<string, unknown> | null | undefined;
    changes: ScheduledMaintenanceFieldSet;
  }): string {
    const written: Record<string, unknown> = data.written || {};
    let markdown: string = "";

    if (data.changes.textColumns.includes("title")) {
      markdown += EventFieldChange.getTextMarkdown({
        column: "title",
        value: written["title"],
        recordName: "Scheduled Maintenance",
        isMarkdown: false,
      });
    }

    for (const column of data.changes.timeColumns) {
      markdown += this.getTimeMarkdown({
        column: column,
        value: written[column],
      });
    }

    if (data.changes.textColumns.includes("description")) {
      markdown += EventFieldChange.getTextMarkdown({
        column: "description",
        value: written["description"],
        recordName: "Scheduled Maintenance",
        isMarkdown: SCHEDULED_MAINTENANCE_FIELDS.markdownColumns.includes(
          "description",
        ),
      });
    }

    if (data.changes.remindersBeforeTheEvent) {
      markdown += this.getRemindersMarkdown(
        written[REMINDERS_BEFORE_THE_EVENT_COLUMN],
      );
    }

    return markdown;
  }

  /*
   * "Shown on Status Pages" for the feed item: the pages the event is shown
   * on after the update, by name, read within its project - or, when the
   * update took it off every page, that it did. "" when none of the pages
   * it names can be read (deleted since, say).
   */
  public static async getStatusPagesMarkdown(data: {
    writtenStatusPages: unknown;
    projectId: ObjectID;
  }): Promise<string> {
    const statusPageIds: Array<string> = ReferenceChange.normalizeList(
      data.writtenStatusPages,
    );

    if (statusPageIds.length === 0) {
      return `\n\n**Shown on Status Pages**: \n${this.noStatusPagesLine}\n`;
    }

    const statusPages: Array<StatusPage> = await StatusPageService.findBy({
      query: {
        _id: QueryHelper.any(statusPageIds),
        projectId: data.projectId,
      },
      select: {
        name: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const names: Array<string> = statusPages
      .map((statusPage: StatusPage): string => {
        return statusPage.name || "";
      })
      .filter((name: string): boolean => {
        return name.trim().length > 0;
      })
      .sort((first: string, second: string): number => {
        return first.localeCompare(second);
      });

    if (names.length === 0) {
      return "";
    }

    return `\n\n**Shown on Status Pages**:\n\n${names
      .map((name: string): string => {
        return `- ${escapeMarkdownValue(name)}`;
      })
      .join("\n")}\n`;
  }

  // "Resources Affected" for an event the update left affecting nothing.
  public static getNoResourcesMarkdown(): string {
    return `\n\n**Resources Affected**: \n${this.noResourcesLine}\n`;
  }

  private static getTimeMarkdown(data: {
    column: ScheduledMaintenanceTimeColumn;
    value: unknown;
  }): string {
    const instant: number | null = EventFieldChange.toInstant(data.value);
    const heading: string = data.column === "startsAt" ? "Starts At" : "Ends At";

    return `\n\n**${heading}**: \n${
      instant === null
        ? "No time provided."
        : OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
            new Date(instant),
          )
    }\n`;
  }

  /*
   * "Notify Subscribers Before Event Starts" for the feed item: each
   * reminder the event has after the update, as the dashboard words it
   * ("1 Day", "2 Hours"), longest before the event first - or, when the
   * update took every one off, that it did.
   */
  private static getRemindersMarkdown(writtenList: unknown): string {
    const keys: Array<string> = this.normalizeReminderList(writtenList).filter(
      (key: string): boolean => {
        return this.getReminderSortValue(key) !== Number.MAX_SAFE_INTEGER;
      },
    );

    if (keys.length === 0) {
      return `\n\n**Notify Subscribers Before Event Starts**: \n${this.noRemindersLine}\n`;
    }

    return `\n\n**Notify Subscribers Before Event Starts**:\n\n${keys
      .map((key: string): string => {
        return `- ${this.getReminderText(key)}`;
      })
      .join("\n")}\n`;
  }

  // "1 Day", "2 Hours": a reminder's key as the dashboard words it.
  private static getReminderText(key: string): string {
    const [countText, interval] = key.split(" ") as [string, EventInterval];
    const count: number = Number(countText);
    const names: { one: string; other: string } | undefined =
      INTERVAL_NAMES[interval];

    if (!names) {
      return key;
    }

    return `${count} ${count === 1 ? names.one : names.other}`;
  }

  /*
   * Where a reminder's key sorts: by its interval, longest first, then by
   * its count, largest first - "1 Week" before "2 Days" before "1 Day". An
   * entry that is no reminder sorts last.
   */
  private static getReminderSortValue(key: string): number {
    const [countText, interval] = key.split(" ") as [string, EventInterval];
    const intervalIndex: number = INTERVAL_ORDER.indexOf(interval);
    const count: number = Number(countText);

    if (intervalIndex === -1 || !Number.isFinite(count)) {
      return Number.MAX_SAFE_INTEGER;
    }

    return intervalIndex * 1_000_000 - count;
  }
}
