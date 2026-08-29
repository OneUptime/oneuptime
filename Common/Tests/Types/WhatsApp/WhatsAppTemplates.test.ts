import {
  WhatsAppTemplateId,
  WhatsAppTemplateIds,
  WhatsAppTemplateMessages,
  renderWhatsAppTemplate,
} from "../../../Types/WhatsApp/WhatsAppTemplates";
import { describe, expect, test } from "@jest/globals";

/*
 * renderWhatsAppTemplate performs the {{var}} substitution that turns a
 * stored WhatsApp template into the message body actually sent. It is strict
 * by design: an unknown template id and a missing variable both throw rather
 * than sending a message with a literal "{{acknowledge_url}}" in it or a
 * silently blank field. These tests pin both the happy path and those two
 * refusals.
 */

describe("renderWhatsAppTemplate", () => {
  test("substitutes a single numbered variable (the verification code template)", () => {
    const rendered: string = renderWhatsAppTemplate(
      WhatsAppTemplateIds.VerificationCode,
      { "1": "123456" },
    );

    expect(rendered).toBe(
      "123456 is your verification code. For your security, do not share this code.",
    );
  });

  test("substitutes every named variable and leaves no {{placeholder}} behind", () => {
    const rendered: string = renderWhatsAppTemplate(
      WhatsAppTemplateIds.AlertCreated,
      {
        alert_number: "42",
        alert_title: "High CPU",
        project_name: "Acme",
        acknowledge_url: "https://example.com/ack",
        alert_link: "https://example.com/alert/42",
      },
    );

    expect(rendered).toContain("#42");
    expect(rendered).toContain("High CPU");
    expect(rendered).toContain("Acme");
    expect(rendered).toContain("https://example.com/ack");
    expect(rendered).toContain("https://example.com/alert/42");
    // No un-substituted placeholder may survive into the sent message.
    expect(rendered).not.toMatch(/\{\{.*?\}\}/);
  });

  test("throws when a referenced variable is missing rather than sending a blank", () => {
    expect(() => {
      return renderWhatsAppTemplate(WhatsAppTemplateIds.AlertCreated, {
        alert_number: "42",
        // alert_title deliberately omitted.
        project_name: "Acme",
        acknowledge_url: "https://example.com/ack",
        alert_link: "https://example.com/alert/42",
      });
    }).toThrow(/Missing variable "alert_title"/);
  });

  test("throws for a template id that is not defined", () => {
    expect(() => {
      return renderWhatsAppTemplate(
        "totally_made_up_template" as WhatsAppTemplateId,
        {},
      );
    }).toThrow(/is not defined/);
  });

  test("ignores extra variables that the template does not reference", () => {
    const rendered: string = renderWhatsAppTemplate(
      WhatsAppTemplateIds.VerificationCode,
      { "1": "999", unused: "should-not-appear" },
    );

    expect(rendered).toContain("999");
    expect(rendered).not.toContain("should-not-appear");
  });

  test("every registered template renders once its own variables are supplied", () => {
    /*
     * Guard against a template whose stored text carries a placeholder the
     * renderer can never fill deterministically (e.g. a malformed {{ }}). We
     * feed each template the variables it actually names and assert it renders
     * without a leftover placeholder.
     */
    for (const [templateId, templateText] of Object.entries(
      WhatsAppTemplateMessages,
    )) {
      const variableNames: Array<string> = Array.from(
        templateText.matchAll(/\{\{(.*?)\}\}/g),
      ).map((match: RegExpMatchArray) => {
        return match[1] as string;
      });

      const variables: Record<string, string> = {};
      for (const name of variableNames) {
        variables[name] = "x";
      }

      const rendered: string = renderWhatsAppTemplate(
        templateId as WhatsAppTemplateId,
        variables,
      );
      expect(rendered).not.toMatch(/\{\{.*?\}\}/);
    }
  });
});
