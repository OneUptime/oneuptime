import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import logger from "./Logger";
import type { StatusPageWebhookPayload } from "./StatusPageSubscriberWebhook";

/*
 * A custom Webhook template is the JSON body a webhook subscriber receives in
 * place of the default payload. Variables are filled in as JSON-escaped text,
 * so a title with a quote or a note spanning lines cannot break the document;
 * each variable therefore belongs inside a JSON string.
 *
 * A template that still does not produce a JSON object (it was saved before
 * templates were validated, or an unquoted variable received text) is never
 * sent as-is: the subscriber gets the default payload instead, so a broken
 * template can cost the custom shape but never the notification.
 */
export default class StatusPageSubscriberWebhookTemplate {
  public static readonly invalidTemplateMessage: string =
    'A Webhook template must be a JSON object. Put each variable inside double quotes, for example "title": "{{incidentTitle}}".';

  public static compile(
    templateBody: string,
    variables: Record<string, string>,
  ): JSONObject | null {
    let compiled: string = templateBody;

    for (const [name, value] of Object.entries(variables)) {
      const escapedValue: string = this.escapeForJsonString(value || "");

      // A replacer function, so a "$&" in a value is not a replacement pattern.
      compiled = compiled.replace(
        new RegExp(`{{\\s*${this.escapeForRegExp(name)}\\s*}}`, "g"),
        (): string => {
          return escapedValue;
        },
      );
    }

    return this.parseObject(compiled);
  }

  public static getPayload(data: {
    templateBody?: string | undefined;
    variables: Record<string, string>;
    defaultPayload: StatusPageWebhookPayload;
  }): JSONObject {
    if (!data.templateBody) {
      return data.defaultPayload;
    }

    const payload: JSONObject | null = this.compile(
      data.templateBody,
      data.variables,
    );

    if (!payload) {
      logger.warn(
        `Custom webhook template for status page ${data.defaultPayload.statusPageId} did not produce a JSON object. Sending the default ${data.defaultPayload.eventType} payload instead.`,
        { statusPageId: data.defaultPayload.statusPageId },
      );
      return data.defaultPayload;
    }

    return payload;
  }

  /*
   * Checked when a template is saved. Every placeholder, known or not, is
   * filled with a number-like sample so a variable used as a JSON number
   * (such as {{incidentNumber}}) is accepted, while a missing comma or brace
   * is caught before any subscriber is notified.
   */
  public static validateTemplateBody(templateBody: string): void {
    const sample: string = templateBody.replace(/{{[^{}]*}}/g, "0");

    if (!this.parseObject(sample)) {
      throw new BadDataException(this.invalidTemplateMessage);
    }
  }

  public static escapeForJsonString(value: string): string {
    // JSON.stringify quotes the string; the template supplies its own quotes.
    return JSON.stringify(value).slice(1, -1);
  }

  private static escapeForRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private static parseObject(text: string): JSONObject | null {
    try {
      const parsed: unknown = JSON.parse(text);

      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as JSONObject;
      }

      return null;
    } catch {
      return null;
    }
  }
}
