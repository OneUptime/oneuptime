import { describe, expect, test } from "@jest/globals";
import {
  FOLDED_SECTION_MAX_UNSET_ITEMS,
  FOLDED_SECTION_MORE_ITEMS,
  FOLDED_SECTION_OFF,
  FOLDED_SECTION_ON,
  FoldedSectionItem,
  FoldedSectionItemsShown,
  foldedSectionItem,
  getFoldedSectionItemsShown,
} from "../../../../UI/Components/FoldedSection/FoldedSectionItem";
import {
  MORE_FIELDS_SECTION_TITLE,
  MORE_SECTION_ICON,
  MORE_SETTINGS_SECTION_TITLE,
  RETIRED_FOLD_TITLE,
} from "../../../../UI/Components/FoldedSection/FoldedSectionTitles";
import IconProp from "../../../../Types/Icon/IconProp";

/*
 * "The advanced section in the form should be called something better -
 * like 'more' or something as such ... show what things are inside it when
 * collapsed (small summary of things)." - the maintainer.
 *
 * What a folded section lists while it is folded: every set item (what is
 * in force must never be hidden) and a few unset names, then how many more.
 * These are the rules behind that list; FoldedSection draws it.
 */

function item(
  key: string,
  isSet: boolean = false,
  value?: string,
): FoldedSectionItem {
  return value === undefined
    ? { key, title: key, isSet }
    : { key, title: key, isSet, value };
}

function keys(shown: FoldedSectionItemsShown): Array<string> {
  return shown.shown.map((candidate: FoldedSectionItem): string => {
    return candidate.key;
  });
}

describe("what a folded section is called", () => {
  test("a form's fold is More fields and a page's More settings, never Advanced", () => {
    expect(MORE_FIELDS_SECTION_TITLE).toBe("More fields");
    expect(MORE_SETTINGS_SECTION_TITLE).toBe("More settings");

    // Not the ⋯ button's name, which every card and table row already has.
    expect(MORE_FIELDS_SECTION_TITLE).not.toBe("More options");
    expect(MORE_SETTINGS_SECTION_TITLE).not.toBe("More options");

    expect(RETIRED_FOLD_TITLE.test(MORE_FIELDS_SECTION_TITLE)).toBe(false);
    expect(RETIRED_FOLD_TITLE.test(MORE_SETTINGS_SECTION_TITLE)).toBe(false);
  });

  test("the retired name is caught however it is written", () => {
    for (const title of [
      "Advanced",
      "advanced",
      "Advanced Options",
      "Advanced Settings",
      "ADVANCED: Timeout and Retries",
    ]) {
      expect(RETIRED_FOLD_TITLE.test(title)).toBe(true);
    }

    for (const title of [
      "More fields",
      "Advancement",
      "Subscriber Notifications",
    ]) {
      expect(RETIRED_FOLD_TITLE.test(title)).toBe(false);
    }
  });

  test("both wear the same icon: things to adjust", () => {
    expect(MORE_SECTION_ICON).toBe(IconProp.AdjustmentHorizontal);
  });

  test("a set switch reads On or Off, and how many more are left is one sentence", () => {
    expect(FOLDED_SECTION_ON).toBe("On");
    expect(FOLDED_SECTION_OFF).toBe("Off");
    expect(FOLDED_SECTION_MORE_ITEMS).toEqual({
      one: "{{count}} more",
      other: "{{count}} more",
    });
  });
});

describe("getFoldedSectionItemsShown", () => {
  test("lists a short section whole", () => {
    const shown: FoldedSectionItemsShown = getFoldedSectionItemsShown([
      item("Declared At"),
      item("Initial State"),
      item("Labels"),
      item("Private Incident"),
    ]);

    expect(keys(shown)).toEqual([
      "Declared At",
      "Initial State",
      "Labels",
      "Private Incident",
    ]);
    expect(shown.hiddenCount).toBe(0);
  });

  test("keeps a long section small: the first few names, then how many more", () => {
    const items: Array<FoldedSectionItem> = [
      "Display Name",
      "Description",
      "Show Current Status",
      "Show Uptime Percent",
      "Uptime Precision",
      "Show Status History Chart",
      "Show Annotations",
      "Labels",
    ].map((title: string): FoldedSectionItem => {
      return item(title);
    });

    const shown: FoldedSectionItemsShown = getFoldedSectionItemsShown(items);

    expect(FOLDED_SECTION_MAX_UNSET_ITEMS).toBe(4);
    expect(keys(shown)).toEqual([
      "Display Name",
      "Description",
      "Show Current Status",
      "Show Uptime Percent",
    ]);
    expect(shown.hiddenCount).toBe(4);
  });

  test("lists one name too many rather than saying '1 more' in its place", () => {
    const shown: FoldedSectionItemsShown = getFoldedSectionItemsShown(
      ["A", "B", "C", "D", "E"].map((title: string): FoldedSectionItem => {
        return item(title);
      }),
    );

    expect(keys(shown)).toEqual(["A", "B", "C", "D", "E"]);
    expect(shown.hiddenCount).toBe(0);
  });

  test("never hides a set item, and keeps the order the section has", () => {
    const shown: FoldedSectionItemsShown = getFoldedSectionItemsShown([
      item("A"),
      item("B"),
      item("C"),
      item("D"),
      item("E"),
      item("F"),
      item("Labels", true, "2"),
      item("G"),
      item("Private", true, "On"),
    ]);

    expect(keys(shown)).toEqual(["A", "B", "C", "D", "Labels", "Private"]);
    expect(shown.hiddenCount).toBe(3);
  });

  test("lists every set item even when there are more than the limit", () => {
    const shown: FoldedSectionItemsShown = getFoldedSectionItemsShown(
      ["A", "B", "C", "D", "E", "F", "G"].map(
        (title: string): FoldedSectionItem => {
          return item(title, true);
        },
      ),
    );

    expect(shown.shown).toHaveLength(7);
    expect(shown.hiddenCount).toBe(0);
  });

  test("takes a limit of its own", () => {
    const shown: FoldedSectionItemsShown = getFoldedSectionItemsShown(
      ["A", "B", "C", "D"].map((title: string): FoldedSectionItem => {
        return item(title);
      }),
      1,
    );

    expect(keys(shown)).toEqual(["A"]);
    expect(shown.hiddenCount).toBe(3);
  });

  test("lists nothing for a section with nothing in it", () => {
    expect(getFoldedSectionItemsShown([])).toEqual({
      shown: [],
      hiddenCount: 0,
    });
  });
});

describe("foldedSectionItem", () => {
  test("a page names a card by its title, unset unless it says so", () => {
    expect(foldedSectionItem("Block Permissions")).toEqual({
      key: "Block Permissions",
      title: "Block Permissions",
      isSet: false,
    });
  });

  test("a set card carries what it is set to", () => {
    expect(
      foldedSectionItem("Block Permissions", {
        key: "blockPermissions",
        isSet: true,
        value: "2",
      }),
    ).toEqual({
      key: "blockPermissions",
      title: "Block Permissions",
      isSet: true,
      value: "2",
    });
  });

  test("an unset card carries no value, whatever it is given", () => {
    expect(
      foldedSectionItem("Block Permissions", { isSet: false, value: "0" }),
    ).toEqual({
      key: "Block Permissions",
      title: "Block Permissions",
      isSet: false,
    });
  });

  test("a value that is an English word says so, to be looked up", () => {
    expect(
      foldedSectionItem("Search Engine Indexing", {
        isSet: true,
        value: "Off",
        translateValue: true,
      }),
    ).toEqual({
      key: "Search Engine Indexing",
      title: "Search Engine Indexing",
      isSet: true,
      value: "Off",
      translateValue: true,
    });
  });
});
