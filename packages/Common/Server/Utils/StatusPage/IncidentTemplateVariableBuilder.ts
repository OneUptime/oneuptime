import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import Label from "../../../Models/DatabaseModels/Label";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { sortCustomFieldDefinitions } from "../../../Types/CustomField/CustomFieldOrder";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import {
  customFieldValueToDate,
  customFieldValueToText,
  formatCustomFieldBoolean,
  formatCustomFieldCalendarDate,
} from "../../../Types/CustomField/CustomFieldValueFormat";
import { isCustomFieldValueEmpty } from "../../../Types/CustomField/CustomFieldValueMapping";
import {
  getCustomFieldTemplateVariableName,
  isValidCustomFieldVariableKey,
} from "../../../Types/CustomField/CustomFieldVariableKey";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SafeHtml from "../../../Types/SafeHtml";
import SubscriberNotificationTemplateCompiler, {
  SubscriberNotificationEmailBodyTemplateVariables,
  SubscriberNotificationTextTemplateVariables,
} from "../../../Types/StatusPage/SubscriberNotificationTemplateCompiler";
import Timezone from "../../../Types/Timezone";
import { escapeMarkdownInline } from "../../../Utils/Markdown/MarkdownEscape";
import IncidentCustomFieldService from "../../Services/IncidentCustomFieldService";
import Markdown, { MarkdownContentType } from "../../Types/Markdown";
import { syncIsPublicForMarkdownImages } from "../InlineImageAccessTokenSync";
import StatusPageResourceUtil from "../StatusPageResource";

/*
 * The values an incident's status page subscriber messages are filled with -
 * the incident created, state changed, public note (posted and updated) and
 * postmortem sends - in the format each channel renders.
 *
 * The four incident jobs used to assemble these inline, each a little
 * differently. Built here once, so a value every channel should carry is in
 * every channel, and so the escaping rules are written down once:
 *
 *   - emailBody, for a custom EMAIL template's body. Plain values stay plain
 *     strings, which compileEmailBodyTemplate escapes; only HTML this code
 *     produced itself - rendered Markdown, the escaped resource list, a long
 *     text value's escaped lines, a date and time in the page's time zones -
 *     is wrapped in SafeHtml and goes in as it is.
 *   - plainText, for a custom email subject and SMS: every value as the text
 *     it reads as, Markdown flattened to plain text, nothing escaped.
 *   - markdown, for custom Slack and Microsoft Teams messages: the same, but
 *     Markdown kept as it was written.
 *
 * On top of the values the jobs always had, every incident message offers
 * {{incidentLabels}}, {{affectedStatusPages}} and one {{customFields.<key>}}
 * per incident custom field of the project, by the field's Template Variable
 * key (SubscriberNotificationTemplateVariables). A field the incident holds
 * no value for is an empty string, never a placeholder left as written.
 *
 * The default templates cannot name a project's fields, so they get the
 * fields marked "Include in Subscriber Notifications" as a list, in the
 * fields' order: customFieldRows for the default email (DetailBoxField, with
 * a plain value on plainText= and HTML on the raw slot) and
 * customFieldsMarkdownLines for the default Slack and Teams messages. Fields
 * with no value are left out of those lists. The default SMS carries none:
 * an SMS is billed by the segment, and a rich or long value cannot fit.
 *
 * The object records which fields go out, as each message is about to be
 * sent (recordIncludedFieldsSent, recordFieldsUsedBy), for the incident
 * feed's "Subscriber Notification Sent" item (getSentCustomFieldsMarkdown),
 * and gives webhooks their structured customFields (getWebhookCustomFields).
 *
 * A Rich text field's inline images are uploaded private. The ones in a
 * value that goes out are made public, as a public note's are when it is
 * posted, so the recipient's mail client can load them - and only then: by
 * those same two calls, the first time a message carries the field, never
 * when the values are built. A send that reaches no status page or no
 * subscriber, or a custom template that is not used (an email template on a
 * page with no SMTP of its own, an SMS template with no Twilio), makes no
 * image public. Like a public note's, an image stays public once it went
 * out: the messages that carry it have been delivered and must still load it.
 */

// One incident custom field, as the subscriber messages read it.
export interface IncidentTemplateCustomFieldDefinition {
  name?: string | null | undefined;
  variableKey?: string | null | undefined;
  customFieldType?: CustomFieldType | null | undefined;
  includeInSubscriberNotifications?: boolean | null | undefined;
  sortOrder?: number | null | undefined;
}

/*
 * A row of the default email's custom fields. The template escapes the title
 * and plainText; renderedHtml goes into its raw slot, and only this module
 * fills it, with HTML it built from escaped or rendered values.
 */
export interface IncidentCustomFieldEmailRow extends JSONObject {
  title: string;
}

// What one status page's messages are filled with.
export interface IncidentStatusPageTemplateVariables {
  // A custom email template's body.
  emailBody: SubscriberNotificationEmailBodyTemplateVariables;
  // A custom email subject and a custom SMS.
  plainText: SubscriberNotificationTextTemplateVariables;
  // A custom Slack or Microsoft Teams message.
  markdown: SubscriberNotificationTextTemplateVariables;
  // The resource list for a default email's raw slot: every name escaped.
  resourcesAffectedHtml: string;
  // The resource list as written, for everything else.
  resourcesAffectedPlainText: string;
  // The default email's rows for the included fields that hold a value.
  customFieldRows: Array<IncidentCustomFieldEmailRow>;
  /*
   * The same fields as Markdown lines ("**Name:** value") for the default
   * Slack and Teams messages; empty when there are none.
   */
  customFieldsMarkdownLines: Array<string>;
}

// A custom field and its value, read once per send.
interface PreparedCustomField {
  name: string;
  // Null for a field without a valid key: no placeholder reaches it.
  variableKey: string | null;
  customFieldType: CustomFieldType | undefined;
  isIncludedInSubscriberNotifications: boolean;
  value: unknown;
  hasValue: boolean;
  // A Rich text field's value, rendered once rather than once per page.
  markdown?: {
    source: string;
    html: string;
    plainText: string;
  };
}

// One custom field value in each format.
interface FormattedCustomFieldValue {
  plainText: string;
  markdown: string;
  // HTML this module built, or null when the plain text is escaped instead.
  html: SafeHtml | null;
}

const LINE_BREAK_PATTERN: RegExp = /\r\n|\r|\n/g;

export class IncidentTemplateVariables {
  private readonly incident: Incident;
  private readonly customFields: Array<PreparedCustomField>;
  private readonly textVariables: Record<string, string>;
  private readonly markdownVariables: Record<
    string,
    { source: string; html: string; plainText: string }
  >;
  private readonly incidentLabels: string;
  private readonly affectedStatusPages: string;

  // Fields whose images have been made public in this send.
  private readonly publishedImageFields: Set<string> = new Set<string>();

  // What went out, for the feed.
  private includedFieldsSent: boolean = false;
  private readonly fieldKeysSent: Set<string> = new Set<string>();

  public constructor(data: {
    incident: Incident;
    customFields: Array<PreparedCustomField>;
    textVariables: Record<string, string>;
    markdownVariables: Record<
      string,
      { source: string; html: string; plainText: string }
    >;
    incidentLabels: string;
    affectedStatusPages: string;
  }) {
    this.incident = data.incident;
    this.customFields = data.customFields;
    this.textVariables = data.textVariables;
    this.markdownVariables = data.markdownVariables;
    this.incidentLabels = data.incidentLabels;
    this.affectedStatusPages = data.affectedStatusPages;
  }

  /**
   * Every value one status page's messages are filled with, in each
   * channel's format, except the subscriber's own unsubscribeUrl, which the
   * job adds per subscriber.
   */
  public forStatusPage(data: {
    statusPage: StatusPage;
    statusPageUrl: string;
    detailsUrl: string;
    resources: Array<StatusPageResource>;
    /*
     * What the resource list reads when the page lists none of the
     * incident's resources. The state change notification has always said
     * "None"; the others leave it empty.
     */
    noResourcesText?: string | undefined;
  }): IncidentStatusPageTemplateVariables {
    const statusPage: StatusPage = data.statusPage;
    const noResourcesText: string = data.noResourcesText || "";

    // Empty when the page lists none: the default messages test for that.
    const resourcesAffectedHtml: string =
      StatusPageResourceUtil.getResourcesGroupedByGroupName(data.resources);
    const resourcesAffectedPlainText: string =
      StatusPageResourceUtil.getResourcesGroupedByGroupNameAsPlainText(
        data.resources,
      );

    const timezones: Array<Timezone> = statusPage.subscriberTimezones || [];

    // The values that read the same on every channel.
    const shared: Record<string, string> = {
      statusPageName:
        IncidentTemplateVariableBuilder.getStatusPageName(statusPage),
      statusPageUrl: data.statusPageUrl,
      detailsUrl: data.detailsUrl,
      incidentTitle: this.incident.title || "",
      incidentSeverity: this.incident.incidentSeverity?.name || " - ",
      incidentLabels: this.incidentLabels,
      affectedStatusPages: this.affectedStatusPages,
      ...this.textVariables,
    };

    const emailBody: SubscriberNotificationEmailBodyTemplateVariables = {
      ...shared,
      resourcesAffected: SafeHtml.fromTrustedHtml(
        resourcesAffectedHtml || SafeHtml.escape(noResourcesText),
      ),
    };
    const plainText: Record<string, string> = {
      ...shared,
      resourcesAffected: resourcesAffectedPlainText || noResourcesText,
    };
    const markdown: Record<string, string> = {
      ...shared,
      resourcesAffected: resourcesAffectedPlainText || noResourcesText,
    };

    for (const [name, value] of Object.entries(this.markdownVariables)) {
      emailBody[name] = SafeHtml.fromTrustedHtml(value.html);
      plainText[name] = value.plainText;
      markdown[name] = value.source;
    }

    const customFieldRows: Array<IncidentCustomFieldEmailRow> = [];
    const customFieldsMarkdownLines: Array<string> = [];

    for (const field of this.customFields) {
      const formatted: FormattedCustomFieldValue = this.formatValue(
        field,
        timezones,
      );

      if (field.variableKey) {
        const variableName: string = getCustomFieldTemplateVariableName(
          field.variableKey,
        );

        emailBody[variableName] = formatted.html || formatted.plainText;
        plainText[variableName] = formatted.plainText;
        markdown[variableName] = formatted.markdown;
      }

      if (!field.isIncludedInSubscriberNotifications || !field.hasValue) {
        continue;
      }

      customFieldRows.push(
        formatted.html
          ? { title: field.name, renderedHtml: formatted.html.toHtml() }
          : { title: field.name, plainText: formatted.plainText },
      );

      customFieldsMarkdownLines.push(
        field.customFieldType === CustomFieldType.Markdown ||
          field.customFieldType === CustomFieldType.LongText
          ? `**${field.name}:**\n${formatted.markdown}`
          : `**${field.name}:** ${formatted.markdown}`,
      );
    }

    return {
      emailBody: emailBody,
      plainText: plainText,
      markdown: markdown,
      resourcesAffectedHtml: resourcesAffectedHtml,
      resourcesAffectedPlainText: resourcesAffectedPlainText,
      customFieldRows: customFieldRows,
      customFieldsMarkdownLines: customFieldsMarkdownLines,
    };
  }

  /*
   * One of the event's Markdown values (markdownVariables), in its three
   * forms, for a default template: "" in each when it has none.
   */
  public getMarkdownVariable(name: string): {
    source: string;
    html: string;
    plainText: string;
  } {
    return (
      this.markdownVariables[name] || { source: "", html: "", plainText: "" }
    );
  }

  /**
   * A default message is about to go out on a channel that carries the
   * included fields: the default email, Slack or Teams message, or a
   * webhook. Awaited before the message is sent: the first time, it makes
   * the included Rich text fields' images public, so the recipient can load
   * them. Never throws.
   */
  public async recordIncludedFieldsSent(): Promise<void> {
    if (this.includedFieldsSent) {
      return;
    }

    this.includedFieldsSent = true;

    for (const field of this.customFields) {
      if (field.isIncludedInSubscriberNotifications && field.hasValue) {
        await this.publishImages(field);
      }
    }
  }

  /**
   * A message is about to go out through these custom templates - the ones
   * actually compiled into it. Awaited before the message is sent: it makes
   * the images of the Rich text fields they place ({{customFields.<key>}})
   * public, each field once per send. Never throws.
   */
  public async recordFieldsUsedBy(
    templates: Array<string | null | undefined>,
  ): Promise<void> {
    const keys: Set<string> =
      IncidentTemplateVariables.getKeysUsedBy(templates);

    for (const key of keys) {
      this.fieldKeysSent.add(key);
    }

    for (const field of this.customFields) {
      if (field.variableKey && keys.has(field.variableKey) && field.hasValue) {
        await this.publishImages(field);
      }
    }
  }

  /**
   * The custom field values this send put into a message, as Markdown for
   * the incident feed's "Subscriber Notification Sent" item, or "" when it
   * sent none. Fields with no value are left out.
   */
  public getSentCustomFieldsMarkdown(): string {
    const sent: Array<PreparedCustomField> = this.customFields.filter(
      (field: PreparedCustomField): boolean => {
        if (!field.hasValue) {
          return false;
        }

        return (
          (this.includedFieldsSent &&
            field.isIncludedInSubscriberNotifications) ||
          Boolean(
            field.variableKey && this.fieldKeysSent.has(field.variableKey),
          )
        );
      },
    );

    if (sent.length === 0) {
      return "";
    }

    const listLines: Array<string> = [];
    const richTextBlocks: Array<string> = [];

    for (const field of sent) {
      const name: string = escapeMarkdownInline(field.name);

      // Rich text is Markdown already, and goes in as the block it is.
      if (field.customFieldType === CustomFieldType.Markdown) {
        richTextBlocks.push(`**${name}:**\n\n${field.markdown?.source || ""}`);
        continue;
      }

      const value: FormattedCustomFieldValue = this.formatValue(field, [
        Timezone.UTC,
      ]);

      listLines.push(`- **${name}:** ${escapeMarkdownInline(value.plainText)}`);
    }

    return ["**Custom fields sent:**", listLines.join("\n"), ...richTextBlocks]
      .filter(Boolean)
      .join("\n\n");
  }

  /**
   * The included fields for a webhook's data, by Template Variable key:
   * each field's name, type and value as stored (null when it holds none),
   * so an integration reads typed values under keys that survive a rename.
   */
  public getWebhookCustomFields(): JSONObject {
    const customFields: JSONObject = {};

    for (const field of this.customFields) {
      if (!field.isIncludedInSubscriberNotifications || !field.variableKey) {
        continue;
      }

      customFields[field.variableKey] = {
        name: field.name,
        type: field.customFieldType || null,
        value: field.hasValue ? (field.value as JSONValue) : null,
      } as JSONObject;
    }

    return customFields;
  }

  private async publishImages(field: PreparedCustomField): Promise<void> {
    if (
      !field.markdown ||
      !field.markdown.source ||
      this.publishedImageFields.has(field.name)
    ) {
      return;
    }

    this.publishedImageFields.add(field.name);

    await syncIsPublicForMarkdownImages(
      field.markdown.source,
      true,
      `incident ${this.incident.id?.toString() || ""} custom field "${field.name}"`,
    );
  }

  private formatValue(
    field: PreparedCustomField,
    timezones: Array<Timezone>,
  ): FormattedCustomFieldValue {
    if (!field.hasValue) {
      return { plainText: "", markdown: "", html: null };
    }

    const value: unknown = field.value;

    switch (field.customFieldType) {
      case CustomFieldType.Markdown: {
        const rendered: { source: string; html: string; plainText: string } =
          field.markdown || { source: "", html: "", plainText: "" };

        return {
          plainText: rendered.plainText,
          markdown: rendered.source,
          html: SafeHtml.fromTrustedHtml(rendered.html),
        };
      }

      // Several lines of plain text: escaped, with its line breaks kept.
      case CustomFieldType.LongText: {
        const text: string = customFieldValueToText(value);

        return {
          plainText: text,
          markdown: text,
          html: SafeHtml.fromTrustedHtml(
            SafeHtml.escape(text).replace(LINE_BREAK_PATTERN, "<br/>"),
          ),
        };
      }

      case CustomFieldType.Boolean: {
        const text: string = formatCustomFieldBoolean(value);
        return { plainText: text, markdown: text, html: null };
      }

      /*
       * The day that was picked. It is stored as the author's local
       * midnight, not as the day (see formatCustomFieldCalendarDate), so it
       * is not read in the page's time zones: those are the subscribers',
       * not the author's.
       */
      case CustomFieldType.Date: {
        const text: string = formatCustomFieldCalendarDate(value);
        return { plainText: text, markdown: text, html: null };
      }

      /*
       * A date and time in the status page's subscriber time zones, as its
       * scheduled maintenance emails show one: a line each in HTML, and
       * separated by commas in text.
       */
      case CustomFieldType.DateTime: {
        const date: Date | null = customFieldValueToDate(value);

        if (!date) {
          const text: string = customFieldValueToText(value);
          return { plainText: text, markdown: text, html: null };
        }

        const lines: Array<string> =
          OneUptimeDate.getDateAsFormattedArrayInMultipleTimezones({
            date: date,
            timezones: timezones,
            use12HourFormat: true,
          });

        return {
          plainText: lines.join(", "),
          markdown: lines.join(", "),
          html: SafeHtml.fromTrustedHtml(
            lines
              .map((line: string): string => {
                return SafeHtml.escape(line);
              })
              .join("<br/>"),
          ),
        };
      }

      default: {
        const text: string = customFieldValueToText(value);
        return { plainText: text, markdown: text, html: null };
      }
    }
  }

  /*
   * The custom field keys these templates place, {{customFields.<key>}},
   * found the way the compiler finds the placeholders it fills.
   */
  private static getKeysUsedBy(
    templates: Array<string | null | undefined>,
  ): Set<string> {
    const keys: Set<string> = new Set<string>();
    const prefix: string = getCustomFieldTemplateVariableName("");

    for (const name of SubscriberNotificationTemplateCompiler.getPlaceholderNames(
      templates,
    )) {
      if (name.startsWith(prefix)) {
        keys.add(name.slice(prefix.length));
      }
    }

    return keys;
  }
}

export default class IncidentTemplateVariableBuilder {
  /**
   * Reads what an incident's subscriber messages need, once per send.
   *
   * The incident needs projectId, title, incidentSeverity.name, labels.name
   * and customFields selected. statusPages are the pages the send reaches
   * (IncidentStatusPageScope), and name {{affectedStatusPages}}.
   * markdownVariables are the event's Markdown values - the description, a
   * note, the postmortem - rendered here once for every page;
   * textVariables are its plain ones, such as incidentState and postedAt.
   *
   * customFieldDefinitions skips reading the project's incident custom
   * fields, for a caller that has them already.
   */
  public static async build(data: {
    incident: Incident;
    statusPages: Array<StatusPage>;
    markdownVariables?: Record<string, string | null | undefined> | undefined;
    textVariables?: Record<string, string> | undefined;
    customFieldDefinitions?:
      | Array<IncidentTemplateCustomFieldDefinition>
      | undefined;
  }): Promise<IncidentTemplateVariables> {
    const incident: Incident = data.incident;

    const definitions: Array<IncidentTemplateCustomFieldDefinition> =
      data.customFieldDefinitions ||
      (await this.getCustomFieldDefinitions(incident.projectId));

    const customFields: Array<PreparedCustomField> =
      await this.prepareCustomFields({
        definitions: definitions,
        values: incident.customFields,
      });

    const markdownVariables: Record<
      string,
      { source: string; html: string; plainText: string }
    > = {};

    for (const [name, source] of Object.entries(data.markdownVariables || {})) {
      markdownVariables[name] = await this.renderMarkdown(source || "");
    }

    /*
     * No image is made public here: nothing has gone out yet, and a send may
     * reach no one (see recordIncludedFieldsSent).
     */
    return new IncidentTemplateVariables({
      incident: incident,
      customFields: customFields,
      textVariables: { ...(data.textVariables || {}) },
      markdownVariables: markdownVariables,
      incidentLabels: this.getLabelNames(incident.labels).join(", "),
      affectedStatusPages: this.getAffectedStatusPageNames(
        data.statusPages,
      ).join(", "),
    });
  }

  /*
   * The name a status page goes by in its subscribers' messages: its page
   * title, or its name.
   */
  public static getStatusPageName(statusPage: StatusPage): string {
    return statusPage.pageTitle || statusPage.name || "Status Page";
  }

  /*
   * The pages that show the incident, by the name their subscribers know
   * them by, in the order given (name order, from IncidentStatusPageScope).
   * A page that does not show incidents is left out: the incident is not on
   * it.
   */
  public static getAffectedStatusPageNames(
    statusPages: Array<StatusPage>,
  ): Array<string> {
    const names: Array<string> = [];

    for (const statusPage of statusPages) {
      if (statusPage.showIncidentsOnStatusPage === false) {
        continue;
      }

      const name: string = this.getStatusPageName(statusPage).trim();

      if (name && !names.includes(name)) {
        names.push(name);
      }
    }

    return names;
  }

  // Label names, alphabetically, so the order does not depend on a join.
  public static getLabelNames(
    labels: Array<Label> | null | undefined,
  ): Array<string> {
    return (labels || [])
      .map((label: Label): string => {
        return (label.name || "").trim();
      })
      .filter((name: string): boolean => {
        return name.length > 0;
      })
      .sort((a: string, b: string): number => {
        return a.localeCompare(b, undefined, { sensitivity: "base" });
      });
  }

  // The project's incident custom fields, in the order they are shown.
  public static async getCustomFieldDefinitions(
    projectId: ObjectID | undefined,
  ): Promise<Array<IncidentTemplateCustomFieldDefinition>> {
    if (!projectId) {
      return [];
    }

    const fields: Array<IncidentCustomField> =
      await IncidentCustomFieldService.findBy({
        query: {
          projectId: projectId,
        },
        select: {
          name: true,
          variableKey: true,
          customFieldType: true,
          includeInSubscriberNotifications: true,
          sortOrder: true,
        },
        // Creation order breaks ties in the order below.
        sort: {
          createdAt: SortOrder.Ascending,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    return fields;
  }

  private static async prepareCustomFields(data: {
    definitions: Array<IncidentTemplateCustomFieldDefinition>;
    values: JSONObject | null | undefined;
  }): Promise<Array<PreparedCustomField>> {
    // Values are stored under each field's name.
    const values: JSONObject =
      data.values &&
      typeof data.values === "object" &&
      !Array.isArray(data.values)
        ? data.values
        : {};

    const prepared: Array<PreparedCustomField> = [];
    const seenNames: Set<string> = new Set<string>();

    for (const definition of sortCustomFieldDefinitions(data.definitions)) {
      const name: string =
        typeof definition.name === "string" ? definition.name : "";

      if (!name || seenNames.has(name)) {
        continue;
      }

      seenNames.add(name);

      const variableKey: string | null = isValidCustomFieldVariableKey(
        definition.variableKey,
      )
        ? (definition.variableKey as string)
        : null;

      const value: unknown = Object.prototype.hasOwnProperty.call(values, name)
        ? values[name]
        : undefined;

      /*
       * 0 and false are values (a Boolean left at No, a count of zero); an
       * answer of only spaces is not, and would show a subscriber a row
       * with nothing in it.
       */
      const hasValue: boolean =
        !isCustomFieldValueEmpty(value) &&
        !(typeof value === "string" && value.trim().length === 0);

      const field: PreparedCustomField = {
        name: name,
        variableKey: variableKey,
        customFieldType: definition.customFieldType || undefined,
        isIncludedInSubscriberNotifications:
          definition.includeInSubscriberNotifications === true,
        value: value,
        hasValue: hasValue,
      };

      if (hasValue && field.customFieldType === CustomFieldType.Markdown) {
        field.markdown = await this.renderMarkdown(
          customFieldValueToText(value),
        );
      }

      prepared.push(field);
    }

    return prepared;
  }

  /*
   * Markdown in the three forms the channels take: HTML through the email
   * renderer (which escapes raw HTML and keeps only safe links), plain text,
   * and the source as written.
   */
  private static async renderMarkdown(
    source: string,
  ): Promise<{ source: string; html: string; plainText: string }> {
    return {
      source: source,
      html: await Markdown.convertToHTML(source, MarkdownContentType.Email),
      plainText: Markdown.convertToPlainText(source),
    };
  }
}
