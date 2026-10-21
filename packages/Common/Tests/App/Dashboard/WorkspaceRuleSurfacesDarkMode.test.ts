import { describe, expect, test } from "@jest/globals";
import { DarkModeScan, scanDarkMode } from "../../Helpers/DarkModeScan";

/*
 * A workspace notification rule's surfaces, in the dark theme: its card in
 * the rules list (which records, then what it does), its conditions, the
 * rule form's Conditions and Destination steps with the box that says what
 * the rule does, and the divider between the Destination step's groups.
 *
 * Theme.css re-colours the light utility classes under html.dark, one rule
 * per class and per variant; a class without a rule keeps its light colour
 * and nothing fails (Tests/Helpers/DarkModeScan). The divider is the
 * shared HorizontalRule: gray-700 at 10% opacity, which no rule re-colours,
 * all but vanished on a dark surface, leaving only its gap.
 */

// Relative to Common/UI, where the scan reads from.
const WORKSPACE: string =
  "../../App/FeatureSet/Dashboard/src/Components/Workspace";

const FILES: Array<string> = [
  `${WORKSPACE}/NotificationRuleViewElement/NotificationRuleViewElement.tsx`,
  `${WORKSPACE}/NotificationRuleViewElement/NotificationRuleViewConditions.tsx`,
  `${WORKSPACE}/NotificationRuleViewElement/NotificationRuleViewCondition.tsx`,
  `${WORKSPACE}/NotificationRuleViewElement/VideoCallRuleSummary.tsx`,
  `${WORKSPACE}/NotificationRuleForm/NotificationRuleForm.tsx`,
  `${WORKSPACE}/NotificationRuleForm/NotificationRuleConditions.tsx`,
  `${WORKSPACE}/NotificationRuleForm/NotificationRuleSummary.tsx`,
  "Components/HorizontalRule/HorizontalRule.tsx",
];

/*
 * The bullets of the card's sentences and conditions: gray-400 is #9ca3af,
 * and the dark theme draws gray-400 text as #94a3b8 - the same grey either
 * way, so the marker needs no rule of its own.
 */
const SAME_IN_BOTH_THEMES: Array<string> = ["marker:text-gray-400"];

describe("a workspace rule's card and form in the dark theme", () => {
  const scan: DarkModeScan = scanDarkMode({
    files: FILES,
    sameInBothThemes: SAME_IN_BOTH_THEMES,
  });

  test("no part uses a dark: variant or builds a colour class from a template", () => {
    expect(scan.filesUsingDarkVariant).toEqual([]);
    expect(scan.filesWithTemplatedColour).toEqual([]);
  });

  test("every colour class they use is remapped for dark mode", () => {
    // The scan found their colours at all, so this is not vacuous.
    expect(scan.colorTokens).toEqual(
      expect.arrayContaining([
        // The conditions' words, and the sentences.
        "text-gray-900",
        "text-gray-700",
        "text-gray-500",
        // The box that says what the rule does.
        "border-gray-200",
        "bg-gray-50",
      ]),
    );

    expect(scan.unmapped).toEqual([]);
  });

  test("the divider between a form's groups is drawn in a colour the dark theme repaints", () => {
    const divider: DarkModeScan = scanDarkMode({
      files: ["Components/HorizontalRule/HorizontalRule.tsx"],
    });

    expect(divider.colorTokens).toEqual(["border-gray-200"]);
    expect(divider.unmapped).toEqual([]);
  });
});
