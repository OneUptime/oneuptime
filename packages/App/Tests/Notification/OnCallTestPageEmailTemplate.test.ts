import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { visibleText } from "Common/Tests/Helpers/HtmlText";
import OnCallTestPageDelivery from "Common/Server/Utils/OnCall/OnCallTestPageDelivery";
import OnCallPageLinks from "Common/Server/Utils/OnCall/OnCallPageLinks";
import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import { getServerTranslator } from "Common/Server/Utils/ServerTranslation";
import { OnCallTestPageRecordKind } from "Common/Types/OnCallDutyPolicy/OnCallTestPage";
import { registerEmailLanguageHelpers } from "../../FeatureSet/Notification/Utils/EmailLanguage";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * Registers the product's real `concat` / `ifCond` helpers as an import
 * side effect, so this suite renders with the helpers the product ships.
 */
import "../../FeatureSet/Notification/Utils/Handlebars";

registerEmailLanguageHelpers(Handlebars);

/*
 * A TEST PAGE'S EMAIL (OnCallTestPage.hbs).
 *
 * TEST in its headline, that nothing is wrong and what it tests, who sent
 * it, one button that acknowledges it - no Escalate, no record - and why
 * the person got it. Rendered with the vars the delivery hands it
 * (OnCallTestPageDelivery.getEmailMessage), in English and in the person's
 * language.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "Templates",
);

const ACKNOWLEDGE_LINK: string =
  "https://oneuptime.example.com/api/user-notification-log-timeline/acknowledge-page/abc";

function render(vars: Record<string, unknown>): string {
  return Handlebars.compile(
    fs.readFileSync(
      Path.resolve(TEMPLATES_DIR, EmailTemplateType.OnCallTestPage),
      { encoding: "utf8" },
    ),
  )({
    homeURL: "https://oneuptime.example.com",
    year: "2026",
    ...vars,
  });
}

function englishVars(): Record<string, unknown> {
  return {
    productName: "OneUptime",
    projectName: "Acme",
    whatItTests:
      "Nothing is wrong. This tests how Acme pages you for an incident of severity Critical.",
    sentBy: "Ana Lopez sent you this test page.",
    acknowledgeLink: ACKNOWLEDGE_LINK,
  };
}

beforeAll(() => {
  const partialsDir: string = Path.resolve(TEMPLATES_DIR, "Partials");

  for (const filename of fs.readdirSync(partialsDir)) {
    if (!filename.endsWith(".hbs")) {
      continue;
    }

    Handlebars.registerPartial(
      filename.slice(0, -".hbs".length),
      fs.readFileSync(Path.resolve(partialsDir, filename), {
        encoding: "utf8",
      }),
    );
  }
});

describe("a test page's email", () => {
  test("opens with TEST, says nothing is wrong and what it tests, and who sent it", () => {
    const text: string = visibleText(render(englishVars()));

    expect(text).toContain("TEST page from OneUptime");
    expect(text).toContain(
      "Nothing is wrong. This tests how Acme pages you for an incident of severity Critical.",
    );
    expect(text).toContain("Ana Lopez sent you this test page.");
    expect(text.indexOf("TEST page from OneUptime")).toBeLessThan(
      text.indexOf("Nothing is wrong."),
    );
  });

  test("has one way to answer it: Acknowledge test page, by its link - no Escalate, no record", () => {
    const html: string = render(englishVars());
    const text: string = visibleText(html);

    expect(text).toContain("Acknowledge test page");
    expect(html).toContain(`href="${ACKNOWLEDGE_LINK}"`);
    expect(text).not.toContain("Escalate");
    expect(text).not.toMatch(/View (Incident|Alert)/);
    expect(text).toContain(
      "A test page was sent to check that on-call pages reach you. It is not about an incident or an alert, and nobody else is told about it.",
    );
  });

  test("with nobody known to have sent it, says nothing about who did", () => {
    const text: string = visibleText(
      render({ ...englishVars(), sentBy: "" }),
    );

    expect(text).not.toContain("sent you this test page");
  });

  test("in the person's language: German, TEST first", () => {
    const text: string = visibleText(
      render({ ...englishVars(), emailLanguage: "de" }),
    );

    expect(text).toContain("TEST-Alarmierung von OneUptime");
    expect(text).toContain("Test-Alarmierung bestätigen");
    expect(text).not.toContain("Acknowledge test page");
  });

  test("renders the vars the delivery hands it", async () => {
    jest
      .spyOn(OnCallPageLinks, "getEmailAcknowledgePageUrl")
      .mockResolvedValue(URL.fromString(ACKNOWLEDGE_LINK) as never);

    const message: { vars: Record<string, string> } =
      (await OnCallTestPageDelivery.getEmailMessage({
        timelineId: ObjectID.generate(),
        context: {
          recordKind: OnCallTestPageRecordKind.Alert,
          severityName: "High",
          projectName: "Acme",
          isSentBySelf: true,
          senderName: "Ana Lopez",
        },
        translator: getServerTranslator("en"),
      })) as unknown as { vars: Record<string, string> };

    const text: string = visibleText(render(message.vars));

    expect(text).toContain("TEST page from OneUptime");
    expect(text).toContain(
      "Nothing is wrong. This tests how Acme pages you for an alert of severity High.",
    );
    expect(text).toContain("You sent yourself this test page.");
    expect(render(message.vars)).toContain(`href="${ACKNOWLEDGE_LINK}"`);
  });
});
