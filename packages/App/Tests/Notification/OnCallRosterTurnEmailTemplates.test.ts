import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
// Registers the product's real Handlebars helpers as an import side effect.
import "../../FeatureSet/Notification/Utils/Handlebars";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import {
  EmailElement,
  EmailMarkupTree,
  findElements,
  hasClass,
  readEmailMarkup,
  textOf,
} from "./Fixtures/EmailMarkupTree";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * THE HAND-OFF EMAILS OF A TURN OF ACTIVE HOURS SAY WHEN THE TURN ENDS
 * (#11270).
 *
 * A person on a layer with active hours is told "You are now on-call" once,
 * when their turn starts - not at the start of every window of it - and
 * "You are next on-call" once. So the email says when this window ends (the
 * shift the timeline shows: 07:00 the next morning for 17:00 to 07:00,
 * #11268) and, when more windows of the turn follow it, when the turn ends,
 * with why they are not told at every window and where a reminder before
 * each one is set. A turn of one shift reads as it always did.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "../../FeatureSet/Notification/Templates",
);

const COMMON_VARS: Record<string, string> = {
  homeURL: "https://oneuptime.test",
  year: "2026",
  onCallPolicyName: "Team",
  escalationRuleName: "Nights first",
  escalationRuleOrder: "1",
  reason: "You are now on-call for the policy Team",
  rosterStartsAt: "Nov 26, 2026, 5:00 PM CET",
  rosterEndsAt: "Nov 27, 2026, 7:00 AM CET",
  onCallPolicyViewLink: "https://oneuptime.test/policy",
};

const TURN_ENDS_AT: string = "Nov 30, 2026, 7:00 AM CET";

function render(
  templateType: EmailTemplateType,
  vars: Record<string, string>,
): string {
  return Handlebars.compile(
    fs.readFileSync(Path.join(TEMPLATES_DIR, templateType as string), "utf8"),
  )(vars);
}

function rowsOf(html: string): Array<{ label: string; value: string }> {
  const tree: EmailMarkupTree = readEmailMarkup(html);

  return findElements(tree.root, (element: EmailElement): boolean => {
    return hasClass(element, "st-DetailCard-field");
  }).map((field: EmailElement) => {
    const label: EmailElement | undefined = findElements(
      field,
      (element: EmailElement): boolean => {
        return hasClass(element, "st-DetailCard-label");
      },
    )[0];
    const value: EmailElement | undefined = findElements(
      field,
      (element: EmailElement): boolean => {
        return hasClass(element, "st-DetailCard-value");
      },
    )[0];

    return {
      label: label ? textOf(label).trim() : "",
      value: value ? textOf(value).trim() : "",
    };
  });
}

function textOfEmail(html: string): string {
  return textOf(readEmailMarkup(html).root).replace(/\s+/g, " ");
}

beforeAll(() => {
  const partialsDir: string = Path.join(TEMPLATES_DIR, "Partials");

  for (const file of fs.readdirSync(partialsDir)) {
    if (file.endsWith(".hbs")) {
      Handlebars.registerPartial(
        file.slice(0, -4),
        fs.readFileSync(Path.join(partialsDir, file), "utf8"),
      );
    }
  }
});

describe.each([
  EmailTemplateType.UserCurrentlyOnOnCallRoster,
  EmailTemplateType.UserNextOnOnCallRoster,
])("%s", (templateType: EmailTemplateType) => {
  test("a turn of active hours: the window's end, then the turn's, and why there is one email", () => {
    const html: string = render(templateType, {
      ...COMMON_VARS,
      rosterTurnEndsAt: TURN_ENDS_AT,
    });

    const rows: Array<{ label: string; value: string }> = rowsOf(html);
    const labels: Array<string> = rows.map((row: { label: string }): string => {
      return row.label;
    });

    // The window's end, then the turn's, last.
    expect(labels.slice(-3)).toEqual([
      "Your On-Call Roster Starts At:",
      "Your On-Call Roster Ends At:",
      "Your Turn Ends At:",
    ]);
    expect(rows[rows.length - 2]!.value).toBe(COMMON_VARS["rosterEndsAt"]);
    expect(rows[rows.length - 1]!.value).toBe(TURN_ENDS_AT);

    const text: string = textOfEmail(html);
    expect(text).toContain("Your turn has active hours");
    expect(text).toContain("not at every window");
    expect(text).toContain("Remind me before shifts");
  });

  test("a turn of one shift reads as it always did", () => {
    const html: string = render(templateType, { ...COMMON_VARS });

    const labels: Array<string> = rowsOf(html).map(
      (row: { label: string }): string => {
        return row.label;
      },
    );

    expect(labels).not.toContain("Your Turn Ends At:");
    expect(labels.slice(-2)).toEqual([
      "Your On-Call Roster Starts At:",
      "Your On-Call Roster Ends At:",
    ]);
    expect(textOfEmail(html)).not.toContain("Your turn has active hours");
  });
});
