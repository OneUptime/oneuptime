import Label from "../../Models/DatabaseModels/Label";
import { toStoredBoolean } from "../../Types/Database/BooleanColumnValue";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import { escapeMarkdownValue } from "../../Utils/Markdown/MarkdownEscape";
import LabelService from "../Services/LabelService";
import QueryHelper from "../Types/Database/QueryHelper";
import ReferenceChange from "./Database/ReferenceChange";

/*
 * WHAT AN UPDATE REALLY CHANGES ON AN INCIDENT, AN ALERT, A SCHEDULED
 * MAINTENANCE EVENT OR A MONITOR.
 *
 * Each of them records an update in its "updated" feed item - posted to its
 * Slack and Microsoft Teams channels as well - with a line for each text and
 * for the labels the update changes: an incident's or an alert's title,
 * root cause, description and remediation notes, an event's title and
 * description, a monitor's name and description. A change of the labels,
 * or of the Send reminders switch, also matches an incident's, an alert's
 * or an event's reminder rule again (refreshReminderSchedule), which starts
 * the reminder interval over.
 *
 * Updates often write back what a record holds. The Incident Details card
 * sends the title, the severity and the labels with every save, an event's
 * Maintenance Details card its title, window, labels, status pages and
 * reminders, a monitor's Details card its name, description and labels; an
 * API client, a workflow, Terraform or a script may write the whole record
 * back. Those lines used to follow whether an update carried a field, not
 * whether it changed it, so every such save added an "updated" item
 * repeating what it carried, and a labels write restarted the reminder
 * interval even when the labels were the same: a record edited often kept
 * putting its reminders off.
 *
 * So each service reads what each record holds before the write - in the
 * one stored read of its onBeforeUpdate (recordStoredValuesBeforeUpdate),
 * of the columns the update writes and no others - and compares here:
 *
 * - text as it reads: line endings written as "\n", without the whitespace
 *   around it, and "" for none (normalizeText), as the postmortem note is
 *   compared (IncidentPostmortemPublication.normalizeNote);
 * - labels as the set of labels they name: order, repeats and the spelling
 *   of an id mean nothing (ReferenceChange.isListChanged);
 * - Send reminders as on or off: a record that never set it is on, as the
 *   column's default and the reminder job read it (areRemindersOn);
 * - a time as the instant it names, however it was written
 *   (isInstantChanged).
 *
 * Which text columns a record's feed records, which of those hold
 * Markdown, and whether it has a Send reminders switch, is its kind
 * (EventFieldKind): INCIDENT_OR_ALERT_FIELDS unless a service says
 * otherwise. What a scheduled maintenance event compares besides - its
 * window and its reminders before the event - is in
 * ScheduledMaintenanceFieldChange, on these same rules.
 *
 * A record the read before the write did not see - it matched the update
 * only when it was written - counts as changed, so a real change is never
 * missed. An incident's or an alert's severity is compared in its service,
 * under its own names (ReferenceChange.isChanged).
 */

// The text columns a feed item records, in the order it lists them.
export type EventTextColumn =
  | "title"
  | "name"
  | "rootCause"
  | "description"
  | "remediationNotes";

/*
 * What one kind of record compares here. Only these columns are read and
 * compared: a payload naming another (a column the record does not have)
 * is left to the write to refuse.
 */
export interface EventFieldKind {
  // The text columns its feed records.
  textColumns: ReadonlyArray<EventTextColumn>;
  /*
   * Those of them that hold Markdown, shown in the feed as written. Every
   * other text is plain text: quoted inertly (escapeMarkdownValue), so it
   * reads as typed and cannot become a link, an image or HTML.
   */
  markdownColumns: ReadonlyArray<EventTextColumn>;
  // Whether it has a Send reminders switch (enableReminders).
  hasRemindersSwitch: boolean;
}

// Incidents and alerts: what each compared from the start.
export const INCIDENT_OR_ALERT_FIELDS: EventFieldKind = {
  textColumns: ["title", "rootCause", "description", "remediationNotes"],
  markdownColumns: ["rootCause", "description", "remediationNotes"],
  hasRemindersSwitch: true,
};

// A scheduled maintenance event: its title and description (Markdown).
export const SCHEDULED_MAINTENANCE_FIELDS: EventFieldKind = {
  textColumns: ["title", "description"],
  markdownColumns: ["description"],
  hasRemindersSwitch: true,
};

/*
 * A monitor: its name and description, both plain text - the dashboard
 * shows a monitor's description as it was typed - and no reminders.
 */
export const MONITOR_FIELDS: EventFieldKind = {
  textColumns: ["name", "description"],
  markdownColumns: [],
  hasRemindersSwitch: false,
};

/*
 * What a record held before an update, for the compared columns the update
 * writes: a column it leaves out is not read, and stays undefined here. A
 * text the record did not have is null.
 */
export interface EventValuesBeforeUpdate {
  title?: string | null | undefined;
  name?: string | null | undefined;
  rootCause?: string | null | undefined;
  description?: string | null | undefined;
  remediationNotes?: string | null | undefined;
  // The labels it had, normalized (ReferenceChange.normalizeList).
  labelIds?: Array<string> | undefined;
  enableReminders?: boolean | null | undefined;
}

// The compared columns an update writes; the same shape says which it changes.
export interface EventFieldSet {
  textColumns: Array<EventTextColumn>;
  labels: boolean;
  enableReminders: boolean;
}

export default class EventFieldChange {
  // An incident's and an alert's text columns (INCIDENT_OR_ALERT_FIELDS).
  public static readonly textColumns: ReadonlyArray<EventTextColumn> =
    INCIDENT_OR_ALERT_FIELDS.textColumns;

  // Every text column a feed item records, in the order it lists them.
  public static readonly feedOrder: ReadonlyArray<EventTextColumn> = [
    "title",
    "name",
    "rootCause",
    "description",
    "remediationNotes",
  ];

  // What the feed item says for a text that was emptied.
  public static readonly emptyTextLines: Readonly<
    Record<EventTextColumn, string>
  > = {
    title: "No title provided.",
    name: "No name provided.",
    rootCause: "Root cause removed.",
    description: "No description provided.",
    remediationNotes: "Remediation notes removed.",
  };

  // What the feed item says when every label was taken off.
  public static readonly noLabelsLine: string = "All labels removed.";

  /*
   * The compared columns an update writes, of those `kind` has. A column
   * left out - or sent as undefined, which writes nothing - is not written;
   * one sent as null is, and empties it (a list set to null as well:
   * TypeORM empties it, as []).
   */
  public static getFieldsWritten(
    written: Record<string, unknown> | null | undefined,
    kind: EventFieldKind = INCIDENT_OR_ALERT_FIELDS,
  ): EventFieldSet {
    const data: Record<string, unknown> = written || {};

    return {
      textColumns: this.inFeedOrder(kind.textColumns).filter(
        (column: EventTextColumn): boolean => {
          return data[column] !== undefined;
        },
      ),
      labels: data["labels"] !== undefined,
      enableReminders:
        kind.hasRemindersSwitch && data["enableReminders"] !== undefined,
    };
  }

  public static isAnySet(fields: EventFieldSet): boolean {
    return (
      fields.textColumns.length > 0 || fields.labels || fields.enableReminders
    );
  }

  /*
   * The columns the read before the write asks for, for the fields the
   * update writes and no others. The labels are read as their ids.
   */
  public static getSelect(fields: EventFieldSet): Record<string, unknown> {
    const select: Record<string, unknown> = {};

    for (const column of fields.textColumns) {
      select[column] = true;
    }

    if (fields.labels) {
      select["labels"] = {
        _id: true,
      };
    }

    if (fields.enableReminders) {
      select["enableReminders"] = true;
    }

    return select;
  }

  /*
   * What a record read with getSelect held. Each column the update writes is
   * set - a text or a switch the record did not have as null, labels as the
   * ids they name - so it reads as "held nothing", never as "not read".
   */
  public static getValuesBeforeUpdate(data: {
    // The record as the read returned it: a model, or a plain row.
    record: unknown;
    fields: EventFieldSet;
  }): EventValuesBeforeUpdate {
    const record: Record<string, unknown> = (data.record || {}) as Record<
      string,
      unknown
    >;
    const values: EventValuesBeforeUpdate = {};

    for (const column of data.fields.textColumns) {
      const value: unknown = record[column];
      values[column] = typeof value === "string" ? value : null;
    }

    if (data.fields.labels) {
      values.labelIds = ReferenceChange.normalizeList(record["labels"]);
    }

    if (data.fields.enableReminders) {
      const value: unknown = record["enableReminders"];
      values.enableReminders = typeof value === "boolean" ? value : null;
    }

    return values;
  }

  /*
   * What an update changed on one record of `kind`, compared with what it
   * held before the write. `valuesBeforeUpdate` is undefined for a record
   * that read did not see: everything the update writes then counts as
   * changed.
   */
  public static getChanges(data: {
    written: Record<string, unknown> | null | undefined;
    valuesBeforeUpdate: EventValuesBeforeUpdate | undefined;
    kind?: EventFieldKind | undefined;
  }): EventFieldSet {
    const written: Record<string, unknown> = data.written || {};
    const before: EventValuesBeforeUpdate | undefined = data.valuesBeforeUpdate;
    const kind: EventFieldKind = data.kind || INCIDENT_OR_ALERT_FIELDS;

    return {
      textColumns: this.inFeedOrder(kind.textColumns).filter(
        (column: EventTextColumn): boolean => {
          return this.isTextChanged({
            writtenValue: written[column],
            valueBeforeUpdate: before ? before[column] : undefined,
          });
        },
      ),
      labels: ReferenceChange.isListChanged({
        writtenList: written["labels"],
        idsBeforeUpdate: before ? before.labelIds : undefined,
      }),
      enableReminders:
        kind.hasRemindersSwitch &&
        this.isRemindersSwitchChanged({
          writtenValue: written["enableReminders"],
          valueBeforeUpdate: before ? before.enableReminders : undefined,
        }),
    };
  }

  /*
   * A text as a reader sees it: line endings written as "\n", without the
   * whitespace around it, and "" for none. Two texts that read the same
   * here are the same text - a form that saves the text back with "\r\n"
   * line endings or a trailing newline has not changed it.
   */
  public static normalizeText(value: unknown): string {
    if (typeof value !== "string") {
      return "";
    }

    return value.replace(/\r\n?/g, "\n").trim();
  }

  /*
   * True when the update writes a text that reads differently from the one
   * the record held (normalizeText). An update that leaves it out (undefined)
   * writes nothing; null and "" both write no text. A record the read before
   * the write did not see (valueBeforeUpdate undefined) counts as changed.
   */
  public static isTextChanged(data: {
    writtenValue: unknown;
    valueBeforeUpdate: string | null | undefined;
  }): boolean {
    if (data.writtenValue === undefined) {
      return false;
    }

    if (data.valueBeforeUpdate === undefined) {
      return true;
    }

    return (
      this.normalizeText(data.writtenValue) !==
      this.normalizeText(data.valueBeforeUpdate)
    );
  }

  /*
   * The instant a time names, in milliseconds, however it reached the
   * service: a Date, an ISO string (the API, a workflow) or a number of
   * milliseconds. Null for no time, and for a value that names none.
   */
  public static toInstant(value: unknown): number | null {
    if (value === undefined || value === null) {
      return null;
    }

    let instant: number = NaN;

    if (value instanceof Date) {
      instant = value.getTime();
    } else if (typeof value === "number") {
      instant = value;
    } else if (typeof value === "string" && value.trim()) {
      instant = new Date(value.trim()).getTime();
    }

    return Number.isFinite(instant) ? instant : null;
  }

  /*
   * True when the update writes a time that names another instant than the
   * one the record held (toInstant): a form or an API client that sends the
   * same time back - as a Date, an ISO string in another time zone, or with
   * the milliseconds written out - has not changed it. An update that leaves
   * it out (undefined) writes nothing. A record the read before the write
   * did not see (valueBeforeUpdate undefined) counts as changed.
   */
  public static isInstantChanged(data: {
    writtenValue: unknown;
    valueBeforeUpdate: unknown;
  }): boolean {
    if (data.writtenValue === undefined) {
      return false;
    }

    if (data.valueBeforeUpdate === undefined) {
      return true;
    }

    return (
      this.toInstant(data.writtenValue) !==
      this.toInstant(data.valueBeforeUpdate)
    );
  }

  /*
   * Whether Send reminders is on for a value of enableReminders, as the
   * reminder job and refreshReminderSchedule read it: on unless it is
   * switched off. A record that never set it (null) is on, the column's
   * default. Off is what the database stores as false (toStoredBoolean):
   * false, and "false", "no", "off" or 0 - which DatabaseService turns into
   * false before any hook reads the write anyway.
   */
  public static areRemindersOn(value: unknown): boolean {
    return toStoredBoolean(value) !== false;
  }

  /*
   * True when the update turns Send reminders on or off: it writes the
   * switch, and not the way it already stands (areRemindersOn). A record the
   * read before the write did not see counts as changed.
   */
  public static isRemindersSwitchChanged(data: {
    writtenValue: unknown;
    valueBeforeUpdate: boolean | null | undefined;
  }): boolean {
    if (data.writtenValue === undefined) {
      return false;
    }

    if (data.valueBeforeUpdate === undefined) {
      return true;
    }

    return (
      this.areRemindersOn(data.writtenValue) !==
      this.areRemindersOn(data.valueBeforeUpdate)
    );
  }

  /*
   * The feed item's lines for the text and the labels an update changed, in
   * the order the feed lists them, each showing the value the update wrote;
   * "" when it changed none of them. `recordName` ("Incident", "Alert",
   * "Scheduled Maintenance", "Monitor") names the description.
   *
   * A title or a name is quoted inertly (escapeMarkdownValue), as the
   * "created" item quotes it, and so are the label names: none of them can
   * become a link, an image or HTML. A text `kind` holds as Markdown is shown
   * as written; any other text is quoted inertly too, its line breaks kept.
   */
  public static async getFeedMarkdown(data: {
    written: Record<string, unknown> | null | undefined;
    changes: EventFieldSet;
    projectId: ObjectID;
    recordName: string;
    kind?: EventFieldKind | undefined;
  }): Promise<string> {
    const written: Record<string, unknown> = data.written || {};
    const kind: EventFieldKind = data.kind || INCIDENT_OR_ALERT_FIELDS;
    let markdown: string = "";

    for (const column of this.inFeedOrder(data.changes.textColumns)) {
      markdown += this.getTextMarkdown({
        column: column,
        value: written[column],
        recordName: data.recordName,
        isMarkdown: kind.markdownColumns.includes(column),
      });
    }

    if (data.changes.labels) {
      markdown += await this.getLabelsMarkdown({
        writtenLabels: written["labels"],
        projectId: data.projectId,
      });
    }

    return markdown;
  }

  /*
   * One text's line in the feed item, showing the value the update wrote:
   * what emptyTextLines says when it wrote none.
   */
  public static getTextMarkdown(data: {
    column: EventTextColumn;
    value: unknown;
    recordName: string;
    // The text is Markdown (the record's kind says so), shown as written.
    isMarkdown: boolean;
  }): string {
    const text: string | null =
      typeof data.value === "string" && this.normalizeText(data.value)
        ? data.value
        : null;

    const shown: string =
      text === null
        ? this.emptyTextLines[data.column]
        : data.column === "title"
          ? escapeMarkdownValue(text)
          : data.isMarkdown
            ? text
            : escapeMarkdownValue(text, {
                // A name is one line; a plain-text description keeps its own.
                keepLineBreaks: data.column !== "name",
              });

    return `\n\n**${this.getHeading(data.column, data.recordName)}**: \n${shown}\n`;
  }

  private static getHeading(
    column: EventTextColumn,
    recordName: string,
  ): string {
    switch (column) {
      case "title":
        return "Title";
      case "name":
        return "Name";
      case "rootCause":
        return "📄 Root Cause";
      case "description":
        return `${recordName} Description`;
      case "remediationNotes":
        return "🎯 Remediation Notes";
    }
  }

  /*
   * The labels the record has after the update, by name, read within its
   * project - or, when the update took every label off, that it did. "" when
   * none of the labels it names can be read (deleted since, say).
   */
  public static async getLabelsMarkdown(data: {
    writtenLabels: unknown;
    projectId: ObjectID;
  }): Promise<string> {
    const labelIds: Array<string> = ReferenceChange.normalizeList(
      data.writtenLabels,
    );

    if (labelIds.length === 0) {
      return `\n\n**🏷️ Labels**: \n${this.noLabelsLine}\n`;
    }

    const labels: Array<Label> = await LabelService.findBy({
      query: {
        _id: QueryHelper.any(labelIds),
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

    const names: Array<string> = labels
      .map((label: Label): string => {
        return label.name || "";
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

    return `\n\n**🏷️ Labels**:\n\n${names
      .map((name: string): string => {
        return `- ${escapeMarkdownValue(name)}`;
      })
      .join("\n")}\n`;
  }

  // `columns` in the order the feed lists them, each once.
  private static inFeedOrder(
    columns: ReadonlyArray<EventTextColumn>,
  ): Array<EventTextColumn> {
    return this.feedOrder.filter((column: EventTextColumn): boolean => {
      return columns.includes(column);
    });
  }
}
