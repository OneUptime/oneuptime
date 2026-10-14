/*
 * A record step's field lists and the Run Workflow panel in the dark theme.
 *
 * Theme.css re-colours the light utility classes under html.dark, one rule
 * per class and per variant; a class without a rule keeps its light colour
 * and nothing fails (Tests/Helpers/DarkModeScan). So every colour class
 * these draw with is held to what Theme.css remaps: the chips and their
 * amber "no such field" kind, the Add field list with its rows, pills and
 * foot, the note for a value kept as JSON, and the Run panel's record search,
 * its list and the record once picked.
 *
 * The browser suites check the computed colours of the same parts in the
 * dark theme (E2E/WorkflowBuilder/WorkflowBuilderFieldLists.spec.ts and
 * WorkflowBuilderRunRecord.spec.ts).
 */

import { DarkModeScan, scanDarkMode } from "../../../Helpers/DarkModeScan";
import { describe, expect, test } from "@jest/globals";

const FIELD_LIST_FILES: Array<string> = [
  "Components/Workflow/ModelFieldPicker.tsx",
  "Components/Workflow/FieldPicker/AddFieldsPanel.tsx",
  // Holds no colours today; listed so one added there is seen.
  "Components/Workflow/FieldPicker/FieldPickerOptions.ts",
];

const RUN_PANEL_FILES: Array<string> = [
  "Components/Workflow/RunModal.tsx",
  "Components/Workflow/RunForm.tsx",
  "Components/Workflow/RunRecordField.tsx",
  "Components/Workflow/RunRecordSource.ts",
  "Components/Workflow/RunValues.ts",
];

/*
 * Right in both themes on purpose: the white tick on a chosen field's solid
 * indigo box (indigo-600, which Theme.css leaves as it is).
 */
const SAME_IN_BOTH_THEMES: Array<string> = ["text-white"];

describe("a record step's field lists in the dark theme", () => {
  const scan: DarkModeScan = scanDarkMode({
    files: FIELD_LIST_FILES,
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
        // The box the chips sit in, and a chip.
        "bg-white",
        "border-gray-300",
        "border-gray-200",
        "bg-gray-50",
        "text-gray-800",
        // A field the record does not have, and a value kept as JSON.
        "border-amber-200",
        "bg-amber-50",
        "text-amber-800",
        "text-amber-900",
        // Add field, and the row the pointer or the keyboard is on.
        "text-indigo-600",
        "hover:bg-indigo-50",
        "bg-indigo-50",
        "hover:bg-gray-50",
        // A chosen field's tick box, a field's kind in its pill.
        "border-indigo-600",
        "bg-indigo-600",
        "bg-gray-100",
        "text-gray-600",
        // What empty means, the group headings and the list's foot.
        "text-gray-500",
        "border-gray-100",
        // A required list left empty.
        "border-red-300",
        "text-red-600",
      ]),
    );
    expect(scan.unmapped).toEqual([]);
  });
});

describe("the Run Workflow panel in the dark theme", () => {
  const scan: DarkModeScan = scanDarkMode({
    files: RUN_PANEL_FILES,
    sameInBothThemes: SAME_IN_BOTH_THEMES,
  });

  test("no part uses a dark: variant or builds a colour class from a template", () => {
    expect(scan.filesUsingDarkVariant).toEqual([]);
    expect(scan.filesWithTemplatedColour).toEqual([]);
  });

  test("every colour class it uses is remapped for dark mode", () => {
    expect(scan.colorTokens).toEqual(
      expect.arrayContaining([
        // The search box, plain and refused.
        "bg-white",
        "border-gray-300",
        "text-gray-900",
        "placeholder-gray-400",
        "border-red-300",
        "focus:border-indigo-500",
        // The list, the row the keyboard is on, a record's number.
        "border-gray-200",
        "bg-indigo-50",
        "hover:bg-gray-50",
        "bg-gray-100",
        "text-gray-700",
        // When it was made, "Most recent", and the words for nothing found.
        "text-gray-500",
        // A search the server refused.
        "text-amber-700",
        // The record once picked, and Change.
        "text-indigo-600",
        "hover:text-indigo-700",
        // The field's own message.
        "text-red-600",
      ]),
    );
    expect(scan.unmapped).toEqual([]);
  });
});
