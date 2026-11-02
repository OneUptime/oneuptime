import { CustomFieldDefinition } from "../../../Types/CustomField/CustomFieldDefinition";
import { getCustomFieldValueEntryKey } from "../../../Types/CustomField/CustomFieldFile";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import OneUptimeDate from "../../../Types/Date";
import {
  customFieldValueToDate,
  customFieldValueToText,
  formatCustomFieldCalendarDate,
} from "../../../Types/CustomField/CustomFieldValueFormat";
import { isCustomFieldValueEmpty } from "../../../Types/CustomField/CustomFieldValueMapping";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";

/*
 * WHAT AN UPDATE CHANGED OF A RECORD'S CUSTOM FIELDS, FOR ITS FEED.
 *
 * An incident's "updated" feed item - posted to its Slack and Microsoft
 * Teams channels as well - has a line for each title, description, label and
 * severity an update changes (EventFieldChange). Its custom fields had none:
 * a responder who set "Customer Impact" from Slack, the Custom Fields card or
 * the API left no trace in the feed, and the channel never heard of it.
 *
 * Now the item lists the fields whose value changed, each with its new value
 * as it reads ("High", "Yes", "2026-10-15", "Oct 15 2026, 09:12 UTC",
 * "eu-west, us-east"), or that it was cleared, in the order the Custom Fields
 * card lists them:
 *
 *   📝 Custom Fields:
 *   - Customer Impact: High
 *   - Ticket: cleared
 *
 * Only what changed: the Custom Fields card sends the whole bag back with
 * every save, so every field it did not change is the same value again -
 * "42" and 42 are one number, the same options in another order one
 * selection, a day written two ways one day. A key the update leaves out of
 * a bag it writes is gone from the record (the column is replaced whole), so
 * it is cleared.
 *
 * Values are text, placed with mdText: a field's value is whatever somebody
 * typed, and a Markdown field's value is shown as its text, on one line.
 */

// A field whose value changed: its new value, or null for one cleared.
export interface CustomFieldFeedChangeItem {
  name: string;
  value: unknown;
}

// A value longer than this is cut on its line: the record has it all.
const MAX_VALUE_LENGTH: number = 200;

// How many changed fields the item names before "and N more".
const MAX_FIELDS: number = 20;

const WHITESPACE_RUN: RegExp = /\s+/g;

export default class CustomFieldFeedChange {
  // The feed item's heading for the fields.
  public static readonly HEADING: string = "📝 Custom Fields";

  // What a field that was emptied reads as.
  public static readonly CLEARED: string = "cleared";

  /*
   * The fields whose value `written` - the bag an update stores - changed
   * from `before`, the bag the record held: in the order `definitions` lists
   * them (the Custom Fields card's, when the caller sorts them so), then any
   * field no definition names, in the order `written` lists them, then those
   * it dropped. The database keeps a bag's keys in an order of its own, so
   * the order a bag is written in says nothing. Empty when `written` is not
   * a bag: the update does not write the custom fields.
   */
  public static getChanges(data: {
    written: unknown;
    before: unknown;
    definitions: Array<CustomFieldDefinition>;
  }): Array<CustomFieldFeedChangeItem> {
    if (!CustomFieldFeedChange.isBag(data.written)) {
      return [];
    }

    const written: Record<string, unknown> = data.written;
    const before: Record<string, unknown> = CustomFieldFeedChange.isBag(
      data.before,
    )
      ? data.before
      : {};

    const typeOf: (name: string) => CustomFieldType | undefined = (
      name: string,
    ): CustomFieldType | undefined => {
      return data.definitions.find((definition: CustomFieldDefinition) => {
        return definition.name === name;
      })?.customFieldType;
    };

    const changes: Array<CustomFieldFeedChangeItem> = [];

    for (const [name, value] of Object.entries(written)) {
      if (
        !CustomFieldFeedChange.isSame({
          type: typeOf(name),
          a: value,
          b: before[name],
        })
      ) {
        changes.push({
          name: name,
          value: isCustomFieldValueEmpty(value) ? null : value,
        });
      }
    }

    for (const [name, value] of Object.entries(before)) {
      if (
        !Object.prototype.hasOwnProperty.call(written, name) &&
        !isCustomFieldValueEmpty(value)
      ) {
        changes.push({ name: name, value: null });
      }
    }

    const placeOf: (name: string) => number = (name: string): number => {
      const index: number = data.definitions.findIndex(
        (definition: CustomFieldDefinition): boolean => {
          return definition.name === name;
        },
      );

      return index === -1 ? Number.POSITIVE_INFINITY : index;
    };

    // Stable: fields no definition names keep the order they came in.
    return changes
      .map((change: CustomFieldFeedChangeItem, index: number) => {
        return { change: change, index: index, place: placeOf(change.name) };
      })
      .sort(
        (
          a: {
            change: CustomFieldFeedChangeItem;
            index: number;
            place: number;
          },
          b: {
            change: CustomFieldFeedChangeItem;
            index: number;
            place: number;
          },
        ): number => {
          if (a.place !== b.place) {
            return a.place < b.place ? -1 : 1;
          }

          return a.index - b.index;
        },
      )
      .map(
        (entry: {
          change: CustomFieldFeedChangeItem;
          index: number;
          place: number;
        }): CustomFieldFeedChangeItem => {
          return entry.change;
        },
      );
  }

  /*
   * The feed item's lines for the changes, with each value as it reads;
   * empty for none.
   */
  public static getFeedMarkdown(data: {
    changes: Array<CustomFieldFeedChangeItem>;
    definitions: Array<CustomFieldDefinition>;
  }): MarkdownText {
    if (data.changes.length === 0) {
      return FeedMarkdown.empty();
    }

    const shown: Array<CustomFieldFeedChangeItem> = data.changes.slice(
      0,
      MAX_FIELDS,
    );

    const lines: Array<MarkdownText> = shown.map(
      (change: CustomFieldFeedChangeItem): MarkdownText => {
        const type: CustomFieldType | undefined = data.definitions.find(
          (definition: CustomFieldDefinition) => {
            return definition.name === change.name;
          },
        )?.customFieldType;

        const value: string =
          change.value === null
            ? CustomFieldFeedChange.CLEARED
            : CustomFieldFeedChange.toReadableValue({
                customFieldType: type,
                value: change.value,
              }) || CustomFieldFeedChange.CLEARED;

        return mdText`**${change.name}**: ${value}`;
      },
    );

    const more: number = data.changes.length - shown.length;

    if (more > 0) {
      lines.push(mdText`and ${more} more`);
    }

    return mdText`\n\n**${CustomFieldFeedChange.HEADING}**:\n\n${FeedMarkdown.bulletList(
      lines,
    )}\n`;
  }

  /*
   * A value as it reads to a person, on one line: "High", "Yes", "No",
   * "2026-10-15" for a Date field, "Oct 15 2026, 09:12 UTC" for a Date and
   * time field - its zone named, as the feed's other times are - and
   * "eu-west, us-east" for a list. Empty for none.
   */
  public static toReadableValue(data: {
    customFieldType: CustomFieldType | undefined;
    value: unknown;
  }): string {
    if (isCustomFieldValueEmpty(data.value)) {
      return "";
    }

    let text: string;

    switch (data.customFieldType) {
      case CustomFieldType.Boolean:
        text = data.value === true || data.value === "true" ? "Yes" : "No";
        break;
      case CustomFieldType.Date:
        text = formatCustomFieldCalendarDate(data.value);
        break;
      case CustomFieldType.DateTime: {
        const date: Date | null = customFieldValueToDate(data.value);

        text = date
          ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date)
          : customFieldValueToText(data.value);
        break;
      }
      default:
        text = customFieldValueToText(data.value);
    }

    const oneLine: string = text.replace(WHITESPACE_RUN, " ").trim();

    if (oneLine.length <= MAX_VALUE_LENGTH) {
      return oneLine;
    }

    return `${Array.from(oneLine)
      .slice(0, MAX_VALUE_LENGTH - 1)
      .join("")
      .trimEnd()}…`;
  }

  /*
   * Whether two values of a field are the same answer, as its type reads
   * them (see the header).
   */
  public static isSame(data: {
    type: CustomFieldType | undefined;
    a: unknown;
    b: unknown;
  }): boolean {
    const aEmpty: boolean = isCustomFieldValueEmpty(data.a);
    const bEmpty: boolean = isCustomFieldValueEmpty(data.b);

    if (aEmpty || bEmpty) {
      return aEmpty && bEmpty;
    }

    switch (data.type) {
      case CustomFieldType.Number: {
        const a: number = Number(data.a);
        const b: number = Number(data.b);

        if (Number.isFinite(a) && Number.isFinite(b)) {
          return a === b;
        }
        break;
      }
      case CustomFieldType.Boolean:
        return (
          (data.a === true || data.a === "true") ===
          (data.b === true || data.b === "true")
        );
      case CustomFieldType.Date:
        return (
          formatCustomFieldCalendarDate(data.a) ===
          formatCustomFieldCalendarDate(data.b)
        );
      case CustomFieldType.DateTime: {
        const a: Date | null = customFieldValueToDate(data.a);
        const b: Date | null = customFieldValueToDate(data.b);

        if (a && b) {
          return a.getTime() === b.getTime();
        }
        break;
      }
      default:
        break;
    }

    return (
      CustomFieldFeedChange.canonicalize(data.a) ===
      CustomFieldFeedChange.canonicalize(data.b)
    );
  }

  /*
   * One spelling of a value: a list in any order is one list, and a file is
   * the file it names, whichever shape names it (getCustomFieldValueEntryKey)
   * - so a list of files sent back as the dashboard holds them is no change,
   * and two lists of different files are never one.
   */
  private static canonicalize(value: unknown): string {
    if (Array.isArray(value)) {
      return JSON.stringify(
        value
          .map((entry: unknown): string => {
            return getCustomFieldValueEntryKey(entry);
          })
          .sort(),
      );
    }

    if (CustomFieldFeedChange.isBag(value)) {
      return getCustomFieldValueEntryKey(value);
    }

    if (value instanceof Date) {
      return isNaN(value.getTime()) ? "" : value.toISOString();
    }

    if (typeof value === "object" && value !== null) {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }

    return String(value);
  }

  private static isBag(value: unknown): value is Record<string, unknown> {
    return (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !(value instanceof Date)
    );
  }
}
