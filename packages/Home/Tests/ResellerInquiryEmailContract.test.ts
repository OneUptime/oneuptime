import {
  ResellerInquiryParseResult,
  getResellerInquiryEmailVariables,
  parseResellerInquiry,
} from "../Utils/ResellerInquiry";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE SITE'S SIDE OF THE RESELLER INQUIRY EMAIL, HELD TO THE TEMPLATE'S.
 *
 * The site sends variables (Utils/ResellerInquiry.ts) to a template the
 * Notification service renders (App/FeatureSet/Notification/Templates/
 * ResellerInquiry.hbs). A name changed on one side only renders an email
 * with an empty row - the inquiry is lost without an error anywhere - and
 * a value moved to a slot that does not escape it puts what a visitor typed
 * into the email as markup. So: the template reads exactly the variables
 * the site sends, every value a visitor typed through plainText (escaped),
 * the message through blockText (escaped here, line by line), the reply
 * link through the button, and the inbox's preview line (preheader) through
 * the Start partial, which escapes it.
 *
 * App/Tests/Notification/ResellerInquiryTemplate.test.ts renders the
 * template itself.
 */

const TEMPLATE_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "App",
  "FeatureSet",
  "Notification",
  "Templates",
  EmailTemplateType.ResellerInquiry,
);

interface PartialCall {
  partial: string;
  // Each parameter, by name: a variable's name, or a "quoted" literal.
  parameters: Record<string, string>;
}

/*
 * The template's partial calls and the variables they hand over, read from
 * its text: every {{> Partial name=value ... }}, comments left out. A
 * literal is quoted, so its spaces are read as part of it.
 */
function partialCalls(source: string): Array<PartialCall> {
  const calls: Array<PartialCall> = [];

  for (const part of source.split("{{").slice(1)) {
    const tag: string = part.slice(0, part.indexOf("}}")).trim();

    if (!tag.startsWith(">")) {
      continue;
    }

    const words: Array<string> = [];
    let current: string = "";
    let quoted: boolean = false;

    for (const character of tag.slice(1).trim()) {
      if (character === '"') {
        quoted = !quoted;
      }

      if (!quoted && character.trim() === "") {
        if (current) {
          words.push(current);
        }
        current = "";
        continue;
      }

      current += character;
    }

    if (current) {
      words.push(current);
    }

    const parameters: Record<string, string> = {};

    for (const word of words.slice(1)) {
      const equals: number = word.indexOf("=");

      if (equals > 0) {
        parameters[word.slice(0, equals)] = word.slice(equals + 1);
      }
    }

    calls.push({ partial: words[0] || "", parameters: parameters });
  }

  return calls;
}

// The variables a template reads, from its partial calls and its {{ }}.
function variablesRead(source: string): Array<string> {
  const variables: Set<string> = new Set<string>();

  for (const call of partialCalls(source)) {
    for (const value of Object.values(call.parameters)) {
      if (!value.startsWith('"') && !value.startsWith("(")) {
        variables.add(value);
      }
    }
  }

  for (const part of source.split("{{").slice(1)) {
    const tag: string = part.slice(0, part.indexOf("}}")).trim();

    if (
      tag.startsWith(">") ||
      tag.startsWith("!") ||
      tag.startsWith("#") ||
      tag.startsWith("/") ||
      tag === "else"
    ) {
      continue;
    }

    variables.add(tag.startsWith("{") ? tag.slice(1) : tag);
  }

  return Array.from(variables).sort();
}

function sentVariables(): Array<string> {
  const parsed: ResellerInquiryParseResult = parseResellerInquiry({
    name: "Jane Kim",
    email: "jane@acme.co.kr",
    company: "Acme Korea",
    website: "acme.co.kr",
    regions: "South Korea",
    message: "Hello",
  });

  if (parsed.kind !== "valid") {
    throw new Error("The fixture inquiry should be valid.");
  }

  return Object.keys(getResellerInquiryEmailVariables(parsed.inquiry)).sort();
}

/*
 * Variables the template does not name itself: a shared partial it hands
 * all of its variables to ({{> Start this}}) reads them.
 */
const READ_BY_START_PARTIAL: Array<string> = ["preheader"];

const START_PARTIAL_PATH: string = path.join(
  path.dirname(TEMPLATE_PATH),
  "Partials",
  "Start.hbs",
);

describe("the reseller inquiry email's two sides", () => {
  const source: string = fs.readFileSync(TEMPLATE_PATH, "utf8");

  test("the template is where the Notification service looks for it", () => {
    expect(fs.existsSync(TEMPLATE_PATH)).toBe(true);
  });

  test("the template reads exactly the variables the site sends", () => {
    expect(sentVariables()).toEqual([
      "companyName",
      "companyWebsite",
      "contactEmail",
      "contactName",
      "messageHtml",
      "preheader",
      "regions",
      "replyUrl",
    ]);
    expect([...variablesRead(source), ...READ_BY_START_PARTIAL].sort()).toEqual(
      sentVariables(),
    );
  });

  test("the inbox's preview line reaches the Start partial, which escapes it", () => {
    // The template hands the Start partial every variable it was sent.
    expect(source.trimStart().startsWith("{{> Start this}}")).toBe(true);

    const start: string = fs.readFileSync(START_PARTIAL_PATH, "utf8");

    for (const name of READ_BY_START_PARTIAL) {
      expect(start).toContain(`{{${name}}}`);
      expect(start).not.toContain(`{{{${name}}}}`);
    }
  });

  test("every value a visitor typed goes on a row that escapes it", () => {
    const rows: Record<string, Record<string, string>> = {};

    for (const call of partialCalls(source)) {
      if (call.partial === "DetailBoxField") {
        rows[call.parameters["title"] || ""] = call.parameters;
      }
    }

    expect(rows).toEqual({
      '"Company"': { title: '"Company"', plainText: "companyName" },
      '"Website"': { title: '"Website"', plainText: "companyWebsite" },
      '"Countries or regions they sell in"': {
        title: '"Countries or regions they sell in"',
        plainText: "regions",
      },
      '"Name"': { title: '"Name"', plainText: "contactName" },
      '"Email"': { title: '"Email"', plainText: "contactEmail" },
      '"Message"': { title: '"Message"', blockText: "messageHtml" },
    });
  });

  test("the reply link is the button's, and nothing is placed unescaped but the message", () => {
    const button: PartialCall | undefined = partialCalls(source).find(
      (call: PartialCall) => {
        return call.partial === "ButtonBlock";
      },
    );

    expect(button?.parameters).toEqual({
      buttonUrl: "replyUrl",
      buttonText: '"Reply by email"',
    });

    // No triple stash of the template's own: the partials decide escaping.
    expect(source.includes("{{{")).toBe(false);
    // The words it says itself go through the escaped slot.
    expect(
      partialCalls(source)
        .filter((call: PartialCall) => {
          return call.partial === "InfoBlock";
        })
        .map((call: PartialCall) => {
          return Object.keys(call.parameters);
        }),
    ).toEqual([["plainInfo"]]);
  });
});
