import CustomFieldType from "../../Types/CustomField/CustomFieldType";
import { isCustomFieldValueEmpty } from "../../Types/CustomField/CustomFieldValueMapping";
import OneUptimeDate from "../../Types/Date";
import { JSONObject } from "../../Types/JSON";
import SubscriberNotificationTemplateCompiler from "../../Types/StatusPage/SubscriberNotificationTemplateCompiler";
import { escapeMarkdownValue } from "../Markdown/MarkdownEscape";

/*
 * The {{placeholders}} an incident note template can carry, and their values
 * for one incident. The note template's own example has always shown
 * "**Incident**: {{incident.title}}", but until this nothing filled them in:
 * picking a template put the braces into the note as written.
 *
 * Filling happens in the dashboard, when a template is picked in a note's
 * composer, so the author sees - and can change - the filled-in text before
 * posting it. Placeholders are filled by the same single-pass compiler the
 * subscriber templates use (SubscriberNotificationTemplateCompiler), so:
 *
 *   - a placeholder with no value here stays exactly as written, for the
 *     author to see and fill in by hand;
 *   - a value that itself contains "{{...}}" is never expanded again;
 *   - "$&" and friends in a value are text, not replacement patterns.
 *
 * The note is Markdown, and after posting it is rendered for the team, on the
 * status page and in subscriber emails. So every plain value is escaped with
 * escapeMarkdownValue - a title cannot become a link, an image or HTML -
 * while a Rich text (Markdown) custom field is placed as the Markdown it is.
 * The renderers then do the rest, as for any note: raw HTML is dropped or
 * escaped, and links keep only safe protocols.
 *
 * Pure, with no database or React imports, so it is tested directly.
 */

export type NoteTemplateVariables = Record<string, string>;

export interface IncidentNoteTemplateVariableInfo {
  // As written between the braces.
  name: string;
  // What it is filled with; English, and the key of its translation.
  description: string;
}

export const INCIDENT_NOTE_CUSTOM_FIELD_VARIABLE_PREFIX: string =
  "customFields.";

/*
 * The placeholders, in the order the note template settings list them. The
 * first and the startedAt one are the names IncidentNoteTemplate's example
 * has documented all along.
 */
export const INCIDENT_NOTE_TEMPLATE_VARIABLES: ReadonlyArray<IncidentNoteTemplateVariableInfo> =
  [
    { name: "incident.title", description: "Title" },
    { name: "incident.number", description: "Incident Number" },
    { name: "incident.severity", description: "Incident Severity" },
    { name: "incident.state", description: "Current State" },
    { name: "incident.startedAt", description: "Declared At" },
    { name: "incident.labels", description: "Labels" },
    {
      name: "incident.affectedStatusPages",
      description: "Affected Status Pages",
    },
    {
      name: `${INCIDENT_NOTE_CUSTOM_FIELD_VARIABLE_PREFIX}<key>`,
      description:
        "An incident custom field, by the Template Variable shown in the incident custom field settings",
    },
  ];

// One incident custom field, as the note placeholders need it.
export interface IncidentNoteTemplateCustomField {
  name: string;
  // The key in {{customFields.<key>}}; fields without one are not offered.
  variableKey?: string | null | undefined;
  customFieldType?: CustomFieldType | null | undefined;
}

/*
 * What is known about the incident. Anything left undefined is unknown - it
 * could not be read - and its placeholder is left as written rather than
 * filled with nothing. An empty list or a missing value on a known incident
 * is known, and fills its placeholder with an empty string.
 */
export interface IncidentNoteTemplateSource {
  title?: string | null | undefined;
  incidentNumber?: number | null | undefined;
  incidentNumberWithPrefix?: string | null | undefined;
  severityName?: string | null | undefined;
  stateName?: string | null | undefined;
  declaredAt?: Date | string | null | undefined;
  labelNames?: Array<string> | undefined;
  affectedStatusPageNames?: Array<string> | undefined;
  customFields?: JSONObject | null | undefined;
  customFieldDefinitions?: Array<IncidentNoteTemplateCustomField> | undefined;
  /*
   * How a date and time reads in the note. The default is the author's own
   * time zone, named ("Sep 27 2026, 14:05 BST"), so readers elsewhere can
   * tell which it is.
   */
  formatDateTime?: ((date: Date) => string) | undefined;
}

type FormatDateTimeFunction = (date: Date) => string;

const defaultFormatDateTime: FormatDateTimeFunction = (date: Date): string => {
  return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date);
};

type ToDateFunction = (value: unknown) => Date | null;

const toDate: ToDateFunction = (value: unknown): Date | null => {
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const date: Date = new Date(value.trim());
    return isNaN(date.getTime()) ? null : date;
  }

  return null;
};

const ISO_DATE_PREFIX: RegExp = /^(\d{4}-\d{2}-\d{2})/;

type ToTextFunction = (value: unknown) => string;

// Plain text for a value of no particular type.
const toText: ToTextFunction = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }

  if (Array.isArray(value)) {
    return value
      .filter((entry: unknown) => {
        return !isCustomFieldValueEmpty(entry);
      })
      .map((entry: unknown) => {
        return toText(entry);
      })
      .join(", ");
  }

  if (value instanceof Date) {
    return isNaN(value.getTime()) ? "" : value.toISOString();
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
};

export type FormatCustomFieldValueForNoteFunction = (data: {
  customFieldType?: CustomFieldType | null | undefined;
  value: unknown;
  formatDateTime?: ((date: Date) => string) | undefined;
}) => string;

/**
 * One custom field value as it reads in a note: Yes or No, the options of a
 * multi-select joined with commas, a date and time in the author's time zone,
 * Rich text as its Markdown. Every other value is escaped (escapeMarkdownValue).
 */
export const formatCustomFieldValueForNote: FormatCustomFieldValueForNoteFunction =
  (data: {
    customFieldType?: CustomFieldType | null | undefined;
    value: unknown;
    formatDateTime?: ((date: Date) => string) | undefined;
  }): string => {
    const value: unknown = data.value;

    if (isCustomFieldValueEmpty(value)) {
      return "";
    }

    const formatDateTime: FormatDateTimeFunction =
      data.formatDateTime || defaultFormatDateTime;

    switch (data.customFieldType) {
      // Written in the Markdown editor; it is formatting, so it stays that.
      case CustomFieldType.Markdown:
        return toText(value);

      case CustomFieldType.LongText:
        return escapeMarkdownValue(toText(value), { keepLineBreaks: true });

      case CustomFieldType.Boolean:
        if (value === true || value === "true") {
          return "Yes";
        }

        if (value === false || value === "false") {
          return "No";
        }

        return escapeMarkdownValue(toText(value));

      case CustomFieldType.DateTime: {
        const date: Date | null = toDate(value);

        return escapeMarkdownValue(date ? formatDateTime(date) : toText(value));
      }

      /*
       * A calendar date: the day that was picked, with no time zone to shift
       * it into the day before for a reader west of UTC.
       */
      case CustomFieldType.Date: {
        const match: RegExpMatchArray | null =
          typeof value === "string"
            ? value.trim().match(ISO_DATE_PREFIX)
            : null;

        if (match) {
          return match[1]!;
        }

        const date: Date | null = toDate(value);

        return escapeMarkdownValue(
          date ? date.toISOString().slice(0, 10) : toText(value),
        );
      }

      default:
        return escapeMarkdownValue(toText(value));
    }
  };

export type BuildIncidentNoteTemplateVariablesFunction = (
  source: IncidentNoteTemplateSource,
) => NoteTemplateVariables;

/**
 * Every placeholder this incident has a value for. Placeholders it cannot
 * fill are left out, so they stay in the note as written.
 */
export const buildIncidentNoteTemplateVariables: BuildIncidentNoteTemplateVariablesFunction =
  (source: IncidentNoteTemplateSource): NoteTemplateVariables => {
    const variables: NoteTemplateVariables = {};
    const formatDateTime: FormatDateTimeFunction =
      source.formatDateTime || defaultFormatDateTime;

    const setText: (name: string, value: string | null | undefined) => void = (
      name: string,
      value: string | null | undefined,
    ): void => {
      if (value === undefined || value === null) {
        return;
      }

      variables[name] = escapeMarkdownValue(value);
    };

    const setList: (name: string, values: Array<string> | undefined) => void = (
      name: string,
      values: Array<string> | undefined,
    ): void => {
      if (!values) {
        return;
      }

      variables[name] = values
        .map((value: string) => {
          return (value || "").trim();
        })
        .filter((value: string) => {
          return value.length > 0;
        })
        .map((value: string) => {
          return escapeMarkdownValue(value);
        })
        .join(", ");
    };

    setText("incident.title", source.title);

    if (source.incidentNumberWithPrefix) {
      setText("incident.number", source.incidentNumberWithPrefix);
    } else if (
      typeof source.incidentNumber === "number" &&
      Number.isFinite(source.incidentNumber)
    ) {
      setText("incident.number", `#${source.incidentNumber}`);
    }

    setText("incident.severity", source.severityName);
    setText("incident.state", source.stateName);

    const declaredAt: Date | null = toDate(source.declaredAt);

    if (declaredAt) {
      setText("incident.startedAt", formatDateTime(declaredAt));
    }

    setList("incident.labels", source.labelNames);
    setList("incident.affectedStatusPages", source.affectedStatusPageNames);

    /*
     * By the field's template key, which never changes when the field is
     * renamed; the value is read from the bag by the field's current name.
     */
    if (source.customFieldDefinitions) {
      const bag: JSONObject =
        source.customFields &&
        typeof source.customFields === "object" &&
        !Array.isArray(source.customFields)
          ? source.customFields
          : {};

      for (const definition of source.customFieldDefinitions) {
        const variableKey: string = (definition.variableKey || "").trim();
        const name: string = `${INCIDENT_NOTE_CUSTOM_FIELD_VARIABLE_PREFIX}${variableKey}`;

        if (
          !variableKey ||
          !definition.name ||
          !SubscriberNotificationTemplateCompiler.isPlaceholderName(name)
        ) {
          continue;
        }

        variables[name] = formatCustomFieldValueForNote({
          customFieldType: definition.customFieldType,
          value: Object.prototype.hasOwnProperty.call(bag, definition.name)
            ? bag[definition.name]
            : undefined,
          formatDateTime: formatDateTime,
        });
      }
    }

    return variables;
  };

export type FillNoteTemplateFunction = (
  template: string,
  variables: NoteTemplateVariables | null | undefined,
) => string;

/**
 * A note template with its placeholders filled in. Placeholders with no
 * value, and every placeholder when there are no variables at all, are left
 * as written.
 */
export const fillNoteTemplate: FillNoteTemplateFunction = (
  template: string,
  variables: NoteTemplateVariables | null | undefined,
): string => {
  if (!variables || Object.keys(variables).length === 0) {
    return template;
  }

  return SubscriberNotificationTemplateCompiler.compileTemplate(
    template,
    variables,
  );
};
