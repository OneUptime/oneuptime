/*
 * The reading a dark-mode guard is built on (Tests/Helpers/DarkModeScan).
 *
 * A guard that reads too little passes whatever the files hold, so this
 * holds the reading itself: it finds a colour that is only one side of a
 * choice inside a template - where a new colour is most likely to be - and
 * it tells a class Theme.css re-colours from one it does not.
 */

import {
  DarkModeScan,
  isRemappedForDarkMode,
  scanDarkMode,
} from "./DarkModeScan";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

const UI_DIR: string = path.join(__dirname, "..", "..", "UI");

// A file whose classes are chosen inside templates, and one with no colours.
const WITH_CHOICES: string = "Components/Workflow/RunRecordField.tsx";
const WITHOUT_COLOURS: string = "Components/Workflow/RunRecordSource.ts";
// One with a colour that is the same in both themes on purpose.
const COPY_BUTTON: string = "Components/CopyTextButton/CopyTextButton.tsx";

describe("whether Theme.css re-colours a class", () => {
  test("the plain surfaces and text every card uses are", () => {
    for (const token of [
      "bg-white",
      "bg-gray-50",
      "border-gray-200",
      "text-gray-900",
      "text-gray-500",
    ]) {
      expect({ token, remapped: isRemappedForDarkMode(token) }).toEqual({
        token,
        remapped: true,
      });
    }
  });

  test("a class nothing re-colours is not, and neither is a variant of one that is", () => {
    // A shade no rule names (nor Tailwind has, so none ever will).
    expect(isRemappedForDarkMode("bg-gray-55")).toBe(false);
    expect(isRemappedForDarkMode("text-indigo-75")).toBe(false);
    // `.text-gray-700` does not cover a variant of it.
    expect(isRemappedForDarkMode("text-gray-700")).toBe(true);
    expect(isRemappedForDarkMode("focus-visible:text-gray-700")).toBe(false);
  });

  test("a mid-tone hue reads the same in both themes; a mid-tone grey does not get that pass", () => {
    expect(isRemappedForDarkMode("bg-fuchsia-500")).toBe(true);
    expect(isRemappedForDarkMode("text-rose-600")).toBe(true);
    // A grey is only fine where a rule of its own says so.
    expect(isRemappedForDarkMode("bg-zinc-500")).toBe(false);
  });

  test("a longer class is not taken for the shorter one it starts with", () => {
    // `.bg-gray-50` is in Theme.css; that is no rule for bg-gray-5.
    expect(isRemappedForDarkMode("bg-gray-5")).toBe(false);
  });
});

describe("the colours a scan reads out of a file", () => {
  const scan: DarkModeScan = scanDarkMode({ files: [WITH_CHOICES] });
  const source: string = fs.readFileSync(
    path.join(UI_DIR, WITH_CHOICES),
    "utf8",
  );

  test("a colour that is one side of a choice inside a template is read", () => {
    /*
     * The row the keyboard is on: `... ${isActive ? "bg-indigo-50" :
     * "hover:bg-gray-50"}`. Read as one literal with its ${...} taken out,
     * neither side was seen.
     */
    expect(source).toContain('isActive ? "bg-indigo-50" : "hover:bg-gray-50"');
    expect(scan.colorTokens).toEqual(
      expect.arrayContaining(["bg-indigo-50", "hover:bg-gray-50"]),
    );
    // And the two sides of the search box's border, plain and refused.
    expect(scan.colorTokens).toEqual(
      expect.arrayContaining([
        "border-red-300",
        "focus:border-red-500",
        "border-gray-300",
        "focus:border-indigo-500",
      ]),
    );
  });

  test("a colour in a plain class list is read, each once", () => {
    expect(scan.colorTokens).toEqual(
      expect.arrayContaining(["bg-white", "text-gray-900", "bg-gray-100"]),
    );
    expect(new Set(scan.colorTokens).size).toBe(scan.colorTokens.length);
  });

  test("layout classes, prose and comments are not colours", () => {
    for (const token of scan.colorTokens) {
      expect(token).toMatch(
        /(?:^|:)(?:bg|text|border|ring|divide|from|via|to|outline|fill|stroke|placeholder)-/,
      );
    }

    // Named in a comment of the file, never in a class list.
    expect(source).toContain("INC-8");
    expect(scan.colorTokens).not.toContain("INC-8");
  });

  test("a file with no colours has none, and breaks nothing", () => {
    const none: DarkModeScan = scanDarkMode({ files: [WITHOUT_COLOURS] });

    expect(none.colorTokens).toEqual([]);
    expect(none.unmapped).toEqual([]);
    expect(none.filesUsingDarkVariant).toEqual([]);
    expect(none.filesWithTemplatedColour).toEqual([]);
  });
});

describe("what a scan reports", () => {
  test("a class with no dark rule is unmapped, unless it is meant to stay as it is", () => {
    /*
     * The copy button's green tick, once copied: emerald-400, which reads on
     * the pale tint and on the dark one alike, and so has no rule. The
     * settings dialog's guard lists it as meant.
     */
    const found: DarkModeScan = scanDarkMode({ files: [COPY_BUTTON] });

    expect(found.unmapped).toEqual(["text-emerald-400"]);

    const meant: DarkModeScan = scanDarkMode({
      files: [COPY_BUTTON],
      sameInBothThemes: ["text-emerald-400"],
    });

    expect(meant.unmapped).toEqual([]);
    // Still read: left out of the verdict, not of the reading.
    expect(meant.colorTokens).toEqual(found.colorTokens);
    expect(meant.colorTokens).toContain("text-emerald-400");

    // A file whose every colour has a rule has nothing to report.
    expect(scanDarkMode({ files: [WITH_CHOICES] }).unmapped).toEqual([]);
  });

  test("it says which files use a dark: variant or build a colour from a template", () => {
    const scan: DarkModeScan = scanDarkMode({
      files: [WITH_CHOICES, WITHOUT_COLOURS],
    });

    expect(scan.filesUsingDarkVariant).toEqual([]);
    expect(scan.filesWithTemplatedColour).toEqual([]);
  });
});
