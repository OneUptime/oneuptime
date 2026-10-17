import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Rules a detail card's source must keep, read from the source itself so a
 * later change cannot quietly bring back what made the maintainer's
 * screenshot look the way it did:
 *
 *   - no field sized by an inline width of 100/n percent - measured against
 *     its own grid column, it made a field 1/n of its column wide, so rules
 *     stopped at odd widths and text broke mid-word in four columns;
 *   - the default style's cells and grid laid out by DetailGridLayout, the
 *     one place the rows are worked out;
 *   - no shouted names: the field label is never upper-cased or tracked;
 *   - no header action in the outline button style, whose class no
 *     stylesheet defines (no border, no hover);
 *   - the fields' box built from the card's own ruled body.
 */

const UI_DIR: string = path.join(__dirname, "..", "..", "..", "..", "UI");

// Code only: the comments explain what was there before.
const readCode: (file: string) => string = (file: string): string => {
  return fs
    .readFileSync(path.join(UI_DIR, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ");
};

const DETAIL: string = readCode("Components/Detail/Detail.tsx");
const DETAIL_FIELD_LABEL: string = readCode(
  "Components/Detail/DetailFieldLabel.tsx",
);
const CARD_MODEL_DETAIL: string = readCode(
  "Components/ModelDetail/CardModelDetail.tsx",
);
const CARD_MORE_MENU: string = readCode("Components/Card/CardMoreMenu.tsx");
const MODEL_DETAIL: string = readCode("Components/ModelDetail/ModelDetail.tsx");

describe("Detail", () => {
  test("sizes no field with an inline width", () => {
    expect(DETAIL).not.toContain('showDetailsInNumberOfColumns + "%"');
    expect(DETAIL).not.toMatch(/width:\s*100\s*\//);

    // The only inline style left is an uploaded image's height.
    const styles: Array<string> = Array.from(
      DETAIL.matchAll(/style=\{\{([^}]*)\}\}/g),
    ).map((match: RegExpMatchArray): string => {
      return (match[1] || "").replace(/\s+/g, " ").trim();
    });

    expect(styles).toEqual(['height: "100px",']);
  });

  test("lays out the default style's cells and grid with DetailGridLayout", () => {
    expect(DETAIL).toContain("getDetailCellClassNames(");
    expect(DETAIL).toContain("getDetailGridClassName(");
    expect(DETAIL).toContain('from "./DetailGridLayout"');
  });

  test("draws every field's name with DetailFieldLabel, not the shouting FieldLabel", () => {
    expect(DETAIL).toContain("<DetailFieldLabel");
    expect(DETAIL).not.toContain("<FieldLabelElement");
    expect(DETAIL).not.toContain('from "./FieldLabel"');
  });

  test("shows an empty value with EmptyValue", () => {
    expect(DETAIL).toContain("<EmptyValue");
    // The italic grey placeholders of the dropdown values.
    expect(DETAIL).not.toContain("italic");
  });

  test("hides no copy button until hover", () => {
    expect(DETAIL).not.toContain("opacity-0");
    expect(DETAIL).not.toContain("group-hover/copyable");
  });
});

describe("DetailFieldLabel", () => {
  test("never upper-cases, tracks or bolds a name, and draws no dot", () => {
    expect(DETAIL_FIELD_LABEL).not.toMatch(/\buppercase\b/);
    expect(DETAIL_FIELD_LABEL).not.toMatch(/\btracking-/);
    expect(DETAIL_FIELD_LABEL).not.toMatch(/\bfont-(semibold|bold)\b/);
    expect(DETAIL_FIELD_LABEL).not.toContain("rounded-full");
  });
});

describe("CardModelDetail", () => {
  test("draws no header action in the outline style", () => {
    expect(CARD_MODEL_DETAIL).not.toContain("ButtonStyleType.OUTLINE");
    expect(CARD_MORE_MENU).not.toContain("ButtonStyleType.OUTLINE");
    // The ⋯ is a button of its own look.
    expect(CARD_MORE_MENU).toContain("elementToBeShownInsteadOfButton");
    expect(CARD_MORE_MENU).toContain("CARD_MORE_MENU_TRIGGER_CLASS_NAME");
  });

  test("keeps the documentation and the demo in the card's ⋯", () => {
    expect(CARD_MODEL_DETAIL).toContain("<CardMoreMenu");
    expect(CARD_MODEL_DETAIL).toContain("<MoreMenuItem");
    expect(CARD_MODEL_DETAIL).toMatch(
      /props\.documentationLink[\s\S]*<MoreMenuItem/,
    );
    expect(CARD_MODEL_DETAIL).toMatch(/props\.videoLink[\s\S]*<MoreMenuItem/);
    expect(CARD_MODEL_DETAIL).not.toContain("max-md:hidden");
  });

  test("builds the fields' box from the card's ruled body", () => {
    expect(CARD_MODEL_DETAIL).toContain("CARD_RULED_BODY_CLASS_NAME");
    expect(CARD_MODEL_DETAIL).not.toContain("-m-6");
  });
});

describe("ModelDetail", () => {
  test("loads with the skeleton, not the bar loader, and retries with a real button", () => {
    expect(MODEL_DETAIL).toContain("<DetailSkeleton");
    expect(MODEL_DETAIL).not.toContain("LoaderType.Bar");
    expect(MODEL_DETAIL).toContain("onRefreshClick");
    // The "Refresh?" span with an onClick a keyboard could not reach.
    expect(MODEL_DETAIL).not.toMatch(/<span[^>]*onClick/);
  });
});
