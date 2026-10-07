import Label from "../../Models/DatabaseModels/Label";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import { escapeMarkdownValue } from "../../Utils/Markdown/MarkdownEscape";
import LabelService from "../Services/LabelService";
import QueryHelper from "../Types/Database/QueryHelper";
import ReferenceChange from "./Database/ReferenceChange";

/*
 * WHAT AN UPDATE REALLY CHANGES ON AN INCIDENT OR AN ALERT.
 *
 * An incident's or an alert's "updated" feed item - posted to its Slack and
 * Microsoft Teams channels as well - records the title, the root cause, the
 * description, the remediation notes and the labels an update changes. A
 * change of the labels, or of the Send reminders switch, also matches the
 * record's reminder rule again (refreshReminderSchedule), which starts the
 * reminder interval over.
 *
 * Updates often write back what a record holds. The Incident Details card
 * sends the title, the severity and the labels with every save; the
 * Description, Root Cause and Remediation pages send their one field; an
 * API client, a workflow or a script may write the whole record back. Those
 * lines used to follow whether an update carried a field, not whether it
 * changed it, so every such save added an "updated" item repeating what it
 * carried, and a labels write restarted the reminder interval even when the
 * labels were the same: a record edited often kept putting its reminders
 * off.
 *
 * So IncidentService and AlertService read what each record holds before
 * the write - in the one stored read of their onBeforeUpdate
 * (recordStoredValuesBeforeUpdate), of the columns the update writes and no
 * others - and compare here:
 *
 * - text as it reads: line endings written as "\n", without the whitespace
 *   around it, and "" for none (normalizeText), as the postmortem note is
 *   compared (IncidentPostmortemPublication.normalizeNote);
 * - labels as the set of labels they name: order, repeats and the spelling
 *   of an id mean nothing (ReferenceChange.isListChanged);
 * - Send reminders as on or off: a record that never set it is on, as the
 *   column's default and the reminder job read it (areRemindersOn).
 *
 * A record the read before the write did not see - it matched the update
 * only when it was written - counts as changed, so a real change is never
 * missed. The severity is compared in each service, under its own names
 * (ReferenceChange.isChanged).
 */

// The text columns the feed item records, in the order it lists them.
export type EventTextColumn =
  | "title"
  | "rootCause"
  | "description"
  | "remediationNotes";

/*
 * What a record held before an update, for the compared columns the update
 * writes: a column it leaves out is not read, and stays undefined here. A
 * text the record did not have is null.
 */
export interface EventValuesBeforeUpdate {
  title?: string | null | undefined;
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
  public static readonly textColumns: ReadonlyArray<EventTextColumn> = [
    "title",
    "rootCause",
    "description",
    "remediationNotes",
  ];

  // What the feed item says for a text that was emptied.
  public static readonly emptyTextLines: Readonly<
    Record<EventTextColumn, string>
  > = {
    title: "No title provided.",
    rootCause: "Root cause removed.",
    description: "No description provided.",
    remediationNotes: "Remediation notes removed.",
  };

  // What the feed item says when every label was taken off.
  public static readonly noLabelsLine: string = "All labels removed.";

  /*
   * The compared columns an update writes. A column left out - or sent as
   * undefined, which writes nothing - is not written; one sent as null is,
   * and empties it (a list set to null as well: TypeORM empties it, as []).
   */
  public static getFieldsWritten(
    written: Record<string, unknown> | null | undefined,
  ): EventFieldSet {
    const data: Record<string, unknown> = written || {};

    return {
      textColumns: this.textColumns.filter(
        (column: EventTextColumn): boolean => {
          return data[column] !== undefined;
        },
      ),
      labels: data["labels"] !== undefined,
      enableReminders: data["enableReminders"] !== undefined,
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
   * What an update changed on one record, compared with what it held before
   * the write. `valuesBeforeUpdate` is undefined for a record that read did
   * not see: everything the update writes then counts as changed.
   */
  public static getChanges(data: {
    written: Record<string, unknown> | null | undefined;
    valuesBeforeUpdate: EventValuesBeforeUpdate | undefined;
  }): EventFieldSet {
    const written: Record<string, unknown> = data.written || {};
    const before: EventValuesBeforeUpdate | undefined = data.valuesBeforeUpdate;

    return {
      textColumns: this.textColumns.filter(
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
      enableReminders: this.isRemindersSwitchChanged({
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
   * Whether Send reminders is on for a value of enableReminders, as the
   * reminder job and refreshReminderSchedule read it: on unless it is
   * switched off. A record that never set it (null) is on, the column's
   * default. Postgres stores the string "false" as false, so that is off
   * too.
   */
  public static areRemindersOn(value: unknown): boolean {
    if (value === false) {
      return false;
    }

    return !(
      typeof value === "string" && value.trim().toLowerCase() === "false"
    );
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
   * "" when it changed none of them. `recordName` ("Incident", "Alert")
   * names the description.
   *
   * The title is quoted inertly (escapeMarkdownValue), as the "created" item
   * quotes it, and so are the label names: neither can become a link, an
   * image or HTML. The description, root cause and remediation notes are
   * Markdown, and are shown as written.
   */
  public static async getFeedMarkdown(data: {
    written: Record<string, unknown> | null | undefined;
    changes: EventFieldSet;
    projectId: ObjectID;
    recordName: string;
  }): Promise<string> {
    const written: Record<string, unknown> = data.written || {};
    let markdown: string = "";

    for (const column of this.textColumns) {
      if (!data.changes.textColumns.includes(column)) {
        continue;
      }

      markdown += this.getTextLine({
        column: column,
        value: written[column],
        recordName: data.recordName,
      });
    }

    if (data.changes.labels) {
      markdown += await this.getLabelsLine({
        writtenLabels: written["labels"],
        projectId: data.projectId,
      });
    }

    return markdown;
  }

  private static getTextLine(data: {
    column: EventTextColumn;
    value: unknown;
    recordName: string;
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
          : text;

    return `\n\n**${this.getHeading(data.column, data.recordName)}**: \n${shown}\n`;
  }

  private static getHeading(
    column: EventTextColumn,
    recordName: string,
  ): string {
    switch (column) {
      case "title":
        return "Title";
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
  private static async getLabelsLine(data: {
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
}
