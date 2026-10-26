import { describe, expect, test } from "@jest/globals";
import {
  getPageAnchorNameForTitle,
  isPageAnchorName,
} from "../../../UI/Utils/PageAnchor";
import { foldedSectionItem } from "../../../UI/Components/FoldedSection/FoldedSectionItem";
import { fastestRun } from "../../Helpers/FastestRun";

/*
 * The place a card takes after its title where its page names it by
 * nothing else (UI/Utils/PageAnchor's getPageAnchorNameForTitle): what a
 * card in a page's More settings is landed on by, and what its item in the
 * fold is named by (foldedSectionItem), so the two always meet.
 */

describe("a card's place after its title", () => {
  test.each([
    ["Default Bar Color", "default-bar-color"],
    ["Block Permissions", "block-permissions"],
    ["GitHub Trigger Label", "github-trigger-label"],
    ["Investigation limits", "investigation-limits"],
    // Runs of anything else are one "-", never at either end.
    ["  Daily  limits!  ", "daily-limits"],
    ["Bar Color Rules (beta)", "bar-color-rules-beta"],
    ["IP Allowlist / Denylist", "ip-allowlist-denylist"],
    ["SSO & SCIM", "sso-scim"],
    ["Step 2: Review", "step-2-review"],
    // Letters and digits as they are, lower-cased.
    ["OAuth2", "oauth2"],
  ])("%p is %p", (title: string, name: string) => {
    expect(getPageAnchorNameForTitle(title)).toBe(name);
    expect(isPageAnchorName(name)).toBe(true);
  });

  test("a title that starts with no letter, or holds none, makes no place", () => {
    for (const title of [
      "",
      "   ",
      "2FA",
      "123",
      "---",
      // A title in another script: no letter a place can be named by.
      "詳細設定",
      "Дополнительно",
    ]) {
      expect({ title, name: getPageAnchorNameForTitle(title) }).toEqual({
        title,
        name: "",
      });
    }
  });

  test("a title that is not text makes no place", () => {
    for (const title of [undefined, null, 42, {}, ["Daily limits"]]) {
      expect(getPageAnchorNameForTitle(title)).toBe("");
    }
  });

  test("letters beyond a to z part the words, as any other character does", () => {
    expect(getPageAnchorNameForTitle("Café Settings")).toBe("caf-settings");
  });

  /*
   * A title is the product's own words, but a card can be titled by what a
   * person typed - a dashboard's name: the name is read one character at a
   * time, in time in line with its length.
   */
  test("a title of any length takes time in line with it", () => {
    const title: string = "a b ".repeat(100_000);

    const run: { inMs: number; result: string } = fastestRun({
      run: (): string => {
        return getPageAnchorNameForTitle(title);
      },
      limitInMs: 2000,
    });

    expect(run.inMs).toBeLessThan(2000);
    expect(run.result.length).toBe("a-b-".repeat(100_000).length - 1);
  });
});

describe("a folded section's item, named after its card", () => {
  test("by the card's place, unless the page gives a key", () => {
    expect(foldedSectionItem("Default Bar Color").key).toBe(
      "default-bar-color",
    );
    expect(foldedSectionItem("Default Bar Color", { key: "bar" }).key).toBe(
      "bar",
    );
  });

  test("by its title itself, for a title that makes no place", () => {
    expect(foldedSectionItem("詳細設定").key).toBe("詳細設定");
  });

  test("keeps its title as written, to be looked up in the reader's language", () => {
    expect(foldedSectionItem("Default Bar Color").title).toBe(
      "Default Bar Color",
    );
  });
});
