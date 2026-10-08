import { describe, expect, test } from "@jest/globals";
import {
  MAX_TELEGRAM_MESSAGE_LENGTH,
  MAX_WHATSAPP_TEMPLATE_TEXT_LENGTH,
  TRUNCATED_NAME_NOTE,
  TRUNCATED_TEXT_NOTE,
} from "../../Utils/MessageFit";
import {
  TelegramMessageText,
  fitTelegramHtml,
  fitTelegramMessage,
} from "../../Utils/TelegramMessageFit";
import { fitWhatsAppTemplateVariables } from "../../Utils/WhatsAppTemplateFit";
import {
  WhatsAppTemplateId,
  WhatsAppTemplateMessages,
} from "../../Types/WhatsApp/WhatsAppTemplates";

/*
 * TELEGRAM AND WHATSAPP MESSAGES THEIR PROVIDERS TAKE.
 *
 * Telegram refuses a message of more than 4,096 characters once its
 * formatting is read; Meta a WhatsApp template whose text, its variables
 * filled in, is more than 1,024. Either way the notification is lost.
 */

// As Telegram counts a message in HTML: no tags, a reference one character.
function telegramLength(html: string): number {
  return html.replace(/<[^>]*>/g, "").replace(/&(#\d+|[a-z]+);/g, "_").length;
}

describe("fitTelegramMessage", () => {
  test("a message that fits is sent as it is, in its parse mode", () => {
    expect(fitTelegramMessage("<b>Incident</b>", "HTML")).toEqual({
      text: "<b>Incident</b>",
      parseMode: "HTML",
    });
    expect(fitTelegramMessage("x".repeat(4096))).toEqual({
      text: "x".repeat(4096),
      parseMode: undefined,
    });
  });

  test("plain text over the limit is cut, with the note on a line of its own", () => {
    const fitted: TelegramMessageText = fitTelegramMessage(
      "line\n".repeat(2000),
    );

    expect(fitted.text.length).toBeLessThanOrEqual(MAX_TELEGRAM_MESSAGE_LENGTH);
    expect(fitted.text.endsWith(`line\n\n${TRUNCATED_TEXT_NOTE}`)).toBe(true);
  });

  test("Markdown over the limit cannot be cut whole: it goes as plain text, cut", () => {
    const fitted: TelegramMessageText = fitTelegramMessage(
      `*Incident* ${"\\_log\\_ ".repeat(1000)}`,
      "MarkdownV2",
    );

    expect(fitted.parseMode).toBeUndefined();
    expect(fitted.text.length).toBeLessThanOrEqual(MAX_TELEGRAM_MESSAGE_LENGTH);
    expect(fitted.text.endsWith(TRUNCATED_TEXT_NOTE)).toBe(true);
  });

  test("HTML is counted as Telegram counts it: markup that is long but text that fits is not cut", () => {
    const html: string = `<a href="https://example.com/${"p".repeat(3000)}">${"x".repeat(3000)}</a>`;

    expect(html.length).toBeGreaterThan(MAX_TELEGRAM_MESSAGE_LENGTH);
    expect(fitTelegramMessage(html, "HTML").text).toBe(html);
  });

  test("HTML over the limit is cut between tags and references, every open tag closed", () => {
    const html: string = `<b>Incident #42</b>\n<pre><code>${"&lt;log&gt; line &amp; more\n".repeat(400)}</code></pre>`;

    const fitted: string = fitTelegramHtml(html);

    expect(telegramLength(fitted)).toBeLessThanOrEqual(
      MAX_TELEGRAM_MESSAGE_LENGTH,
    );
    expect(fitted.startsWith("<b>Incident #42</b>\n<pre><code>")).toBe(true);
    expect(fitted.endsWith(`</code></pre>\n\n${TRUNCATED_TEXT_NOTE}`)).toBe(
      true,
    );
    // No reference is cut in two.
    expect(/&[a-z]*$/.test(fitted.split("</code>")[0]!)).toBe(false);
  });

  test("an emoji is two characters to Telegram, and never cut in two", () => {
    const fitted: string = fitTelegramHtml(`<i>${"😀".repeat(3000)}</i>`);

    expect(telegramLength(fitted)).toBeLessThanOrEqual(
      MAX_TELEGRAM_MESSAGE_LENGTH,
    );
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(fitted)).toBe(false);
    expect(fitted.endsWith(`</i>\n\n${TRUNCATED_TEXT_NOTE}`)).toBe(true);
  });
});

describe("fitWhatsAppTemplateVariables", () => {
  // The text Meta checks: the template with its variables filled in.
  function hydrated(templateKey: string, variables: Record<string, string>): string {
    return WhatsAppTemplateMessages[templateKey as WhatsAppTemplateId].replace(
      /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g,
      (_placeholder: string, name: string): string => {
        return variables[name] ?? "";
      },
    );
  }

  // Every variable of a template, filled with `value` (links with a link).
  function filled(templateKey: string, value: string): Record<string, string> {
    const variables: Record<string, string> = {};

    for (const match of WhatsAppTemplateMessages[
      templateKey as WhatsAppTemplateId
    ].matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) {
      const name: string = match[1]!;

      variables[name] =
        name.endsWith("_link") || name.endsWith("_url")
          ? `https://oneuptime.example.com/dashboard/${name}`
          : value;
    }

    return variables;
  }

  test("every template, its variables of any length, comes to at most 1,024 characters - its links whole", () => {
    const templateKeys: Array<string> = Object.keys(WhatsAppTemplateMessages);

    expect(templateKeys.length).toBeGreaterThan(10);

    for (const templateKey of templateKeys) {
      const variables: Record<string, string> = filled(
        templateKey,
        `${"a long value ".repeat(300)}end`,
      );
      const fitted: Record<string, string> = fitWhatsAppTemplateVariables(
        templateKey,
        variables,
      )!;

      expect([
        templateKey,
        hydrated(templateKey, fitted).length <= MAX_WHATSAPP_TEMPLATE_TEXT_LENGTH,
      ]).toEqual([templateKey, true]);

      for (const [name, value] of Object.entries(variables)) {
        if (value.startsWith("https://")) {
          expect([templateKey, name, fitted[name]]).toEqual([
            templateKey,
            name,
            value,
          ]);
        } else {
          expect(fitted[name]!.endsWith(TRUNCATED_NAME_NOTE)).toBe(true);
          expect(fitted[name]!.length).toBeGreaterThan(1);
        }
      }
    }
  });

  test("variables that fit, and a template it does not know, are returned as they are", () => {
    const variables: Record<string, string> = {
      incident_number: "42",
      incident_title: "Checkout is down",
      project_name: "Acme",
      acknowledge_url: "https://oneuptime.example.com/a",
      incident_link: "https://oneuptime.example.com/i",
    };

    expect(
      fitWhatsAppTemplateVariables("oneuptime_created_incident", variables),
    ).toBe(variables);
    expect(fitWhatsAppTemplateVariables("unknown_template", variables)).toBe(
      variables,
    );
    expect(
      fitWhatsAppTemplateVariables("oneuptime_created_incident", undefined),
    ).toBeUndefined();
  });

  test("a short value stays whole while a long one is cut", () => {
    const fitted: Record<string, string> = fitWhatsAppTemplateVariables(
      "oneuptime_created_incident",
      {
        incident_number: "42",
        incident_title: "x".repeat(5000),
        project_name: "Acme",
        acknowledge_url: "https://oneuptime.example.com/a",
        incident_link: "https://oneuptime.example.com/i",
      },
    )!;

    expect(fitted["project_name"]).toBe("Acme");
    expect(fitted["incident_number"]).toBe("42");
    expect(fitted["incident_title"]!.endsWith(TRUNCATED_NAME_NOTE)).toBe(true);
  });
});
