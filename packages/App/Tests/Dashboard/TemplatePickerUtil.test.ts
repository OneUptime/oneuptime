/*
 * The shared template picker's rules (Utils/TemplatePicker/TemplatePickerUtil),
 * over a small catalog of their own, so what the rules promise is pinned
 * apart from either real catalog: Create a workflow's
 * (WorkflowTemplatePickerUtil.test.ts) and Create a dashboard's
 * (DashboardTemplatePickerUtil.test.ts) only say which templates they hold.
 *
 * The maintainer asked for the dashboard templates to work the way the
 * workflow templates do. The way they do is these rules: the views and
 * their order, a search that reads every word in any field (plurals,
 * prefixes, a typo), its ranking, what the list shows, which template is
 * picked and how the arrow keys move the pick.
 */

import { describe, expect, test } from "@jest/globals";
import {
  ALL_TEMPLATES_VIEW_INFO,
  INITIAL_TEMPLATE_PICKER_STATE,
  RECOMMENDED_TEMPLATES_VIEW_INFO,
  TemplateCatalog,
  TemplateCollection,
  TemplateMove,
  TemplatePickerList,
  TemplatePickerRules,
  TemplatePickerState,
  TemplatePickerTemplate,
  TemplatePickerView,
  createTemplatePickerRules,
  templateCountText,
} from "../../FeatureSet/Dashboard/src/Utils/TemplatePicker/TemplatePickerUtil";

enum Shelf {
  Fruit = "fruit",
  Bread = "bread",
  Cheese = "cheese",
}

interface Item extends TemplatePickerTemplate {
  shelf: Shelf;
  part?: string | undefined;
  hidden?: string | undefined;
}

const ITEMS: Array<Item> = [
  {
    id: "apple",
    name: "Green Apple",
    description: "A crisp fruit for lunch boxes.",
    shelf: Shelf.Fruit,
  },
  {
    id: "banana",
    name: "Banana",
    description: "Sweet and soft, sold by the bunch.",
    shelf: Shelf.Fruit,
  },
  {
    id: "rye",
    name: "Rye Loaf",
    description: "A dark loaf that keeps for a week.",
    shelf: Shelf.Bread,
    part: "Loaves",
  },
  {
    id: "baguette",
    name: "Baguette",
    description: "A long French loaf, baked every morning.",
    shelf: Shelf.Bread,
    part: "Loaves",
  },
  {
    id: "croissant",
    name: "Croissant",
    description: "Buttery pastry for breakfast.",
    shelf: Shelf.Bread,
    part: "Pastries",
  },
  {
    id: "brie",
    name: "Brie",
    description: "A soft cheese from France.",
    shelf: Shelf.Cheese,
    hidden: "camembert cousin",
  },
  {
    id: "cheddar",
    name: "Cheddar",
    description: "A sharp cheese for sandwiches and an apple slice.",
    shelf: Shelf.Cheese,
  },
];

const SHELF_LABELS: Record<Shelf, string> = {
  [Shelf.Fruit]: "Fruit and Veg",
  [Shelf.Bread]: "Bakery",
  [Shelf.Cheese]: "Cheese Counter",
};

// Built afresh every call, as the workflow catalog builds its templates.
const freshItems: () => Array<Item> = (): Array<Item> => {
  return ITEMS.map((item: Item): Item => {
    return { ...item };
  });
};

const CATALOG: TemplateCatalog<Item, Shelf> = {
  getTemplates: freshItems,
  getRecommendedTemplates: (): Array<Item> => {
    // Curated, not in catalog order.
    return ["cheddar", "banana", "rye"].map((id: string): Item => {
      return freshItems().find((item: Item): boolean => {
        return item.id === id;
      })!;
    });
  },
  // Not the order the items come in: Cheese Counter before Fruit and Veg.
  categories: [Shelf.Bread, Shelf.Cheese, Shelf.Fruit],
  getCategoryLabel: (shelf: Shelf): string => {
    return SHELF_LABELS[shelf];
  },
  getCategory: (item: Item): Shelf => {
    return item.shelf;
  },
  getSubcategory: (item: Item): string | undefined => {
    return item.part;
  },
  getSearchFields: (item: Item) => {
    return [
      { text: item.name, weight: 1 },
      { text: SHELF_LABELS[item.shelf], weight: 0.7 },
      { text: item.description, weight: 0.35 },
      // Searched, never scored.
      { text: item.hidden || "", weight: 0 },
    ];
  },
};

const RULES: TemplatePickerRules<Item, Shelf> =
  createTemplatePickerRules(CATALOG);

type StateFunction = (
  changes: Partial<TemplatePickerState<Shelf>>,
) => TemplatePickerState<Shelf>;

const stateWith: StateFunction = (
  changes: Partial<TemplatePickerState<Shelf>>,
): TemplatePickerState<Shelf> => {
  return { ...INITIAL_TEMPLATE_PICKER_STATE, ...changes };
};

type IdsFunction = (items: Array<Item>) => Array<string>;

const ids: IdsFunction = (items: Array<Item>): Array<string> => {
  return items.map((item: Item): string => {
    return item.id;
  });
};

type SearchFunction = (search: string) => Array<string>;

const searchIds: SearchFunction = (search: string): Array<string> => {
  return ids(RULES.search(freshItems(), search));
};

describe("the views", () => {
  test("Recommended, then each category in the catalog's order, then All templates", () => {
    expect(
      RULES.getViews().map((info: { view: string; label: string }) => {
        return [info.view, info.label];
      }),
    ).toEqual([
      [TemplateCollection.Recommended, "Recommended"],
      [Shelf.Bread, "Bakery"],
      [Shelf.Cheese, "Cheese Counter"],
      [Shelf.Fruit, "Fruit and Veg"],
      [TemplateCollection.All, "All templates"],
    ]);
    expect(RECOMMENDED_TEMPLATES_VIEW_INFO.label).toBe("Recommended");
    expect(ALL_TEMPLATES_VIEW_INFO.label).toBe("All templates");
  });

  test("a view's info, and All templates for one it does not know", () => {
    expect(RULES.getViewInfo(Shelf.Cheese).label).toBe("Cheese Counter");
    expect(RULES.getViewInfo("nowhere" as TemplatePickerView<Shelf>).view).toBe(
      TemplateCollection.All,
    );
    expect(RULES.getCategoryLabel(Shelf.Fruit)).toBe("Fruit and Veg");
  });

  test("Recommended is the catalog's curated handful, in its order", () => {
    expect(
      ids(RULES.getTemplatesInView(TemplateCollection.Recommended)),
    ).toEqual(["cheddar", "banana", "rye"]);
  });

  test("All templates is every template once, in the categories' order", () => {
    expect(ids(RULES.getTemplatesInView(TemplateCollection.All))).toEqual([
      "rye",
      "baguette",
      "croissant",
      "brie",
      "cheddar",
      "apple",
      "banana",
    ]);
  });

  test("a category is its own templates, in the catalog's order", () => {
    expect(ids(RULES.getTemplatesInView(Shelf.Fruit))).toEqual([
      "apple",
      "banana",
    ]);
  });
});

describe("the search", () => {
  test("nothing searchable typed returns the templates as they are", () => {
    expect(searchIds("")).toEqual(ids(ITEMS));
    expect(searchIds("   ")).toEqual(ids(ITEMS));
    expect(RULES.getSearchTokens("  ")).toEqual([]);
  });

  test("every word typed has to be found, each in any field", () => {
    // "soft" is in both descriptions; "cheese" only in the Brie's and its shelf.
    expect(searchIds("soft cheese")).toEqual(["brie"]);
    expect(searchIds("soft")).toEqual(["banana", "brie"]);
  });

  test("a plural, the start of a word and the inside of one all match", () => {
    // A regular plural: "cheeses" is read as "cheese".
    expect(searchIds("cheeses")).toEqual(["brie", "cheddar"]);
    expect(searchIds("bagu")).toEqual(["baguette"]);
    expect(searchIds("ssant")).toEqual(["croissant"]);
  });

  test("a word that matches nothing as typed is read as a typo", () => {
    expect(RULES.getTypoTokens(["croisant"])).toEqual(["croisant"]);
    expect(searchIds("croisant")).toEqual(["croissant"]);
  });

  test("a word that is right is not also read as a near miss of another", () => {
    expect(RULES.getTypoTokens(["brie"])).toEqual([]);
  });

  test("a field of no weight is searched but not scored", () => {
    expect(searchIds("camembert")).toEqual(["brie"]);
    expect(RULES.getSearchScore(ITEMS[5]!, ["camembert"])).toBe(0);
  });

  test("a word in the name counts for more than one in the category, which counts for more than one in the description", () => {
    // "apple" is Green Apple's name and in Cheddar's description.
    expect(searchIds("apple")).toEqual(["apple", "cheddar"]);
    // "bakery" is the bread shelf's name: those first, by catalog order.
    expect(searchIds("bakery")).toEqual(["rye", "baguette", "croissant"]);
  });

  test("a name that starts with a word typed comes before one that only holds it", () => {
    const green: Item = ITEMS[0]!;

    expect(RULES.getSearchScore(green, ["green"])).toBeGreaterThan(
      RULES.getSearchScore(green, ["apple"]),
    );
  });

  test("the whole phrase in a name lifts it far above the same words apart", () => {
    const cheddar: Item = ITEMS[6]!;
    const apple: Item = ITEMS[0]!;

    expect(
      RULES.getSearchScore(apple, ["green", "apple"], "green apple"),
    ).toBeGreaterThan(
      RULES.getSearchScore(cheddar, ["apple", "slice"], "apple slice") + 300,
    );
  });

  test("ties keep the catalog's order", () => {
    expect(searchIds("loaf")).toEqual(["rye", "baguette"]);
  });

  test("words that say nothing are left out unless they are all there is", () => {
    expect(RULES.getSearchTokens("the banana")).toEqual(["banana"]);
    expect(RULES.getSearchTokens("the")).toEqual(["the"]);
  });

  test("marks what a search matched, and the word a typo was read as", () => {
    const segments: Array<{ text: string; isMatch: boolean }> =
      RULES.getHighlightSegments("Croissant", ["croisant"], ["croisant"]);

    expect(
      segments.filter((segment: { isMatch: boolean }) => {
        return segment.isMatch;
      }).length,
    ).toBeGreaterThan(0);
    expect(
      RULES.getHighlightSegments("Rye Loaf", ["loaf"])
        .filter((segment: { isMatch: boolean }) => {
          return segment.isMatch;
        })
        .map((segment: { text: string }) => {
          return segment.text;
        }),
    ).toEqual(["Loaf"]);
  });

  test("two catalogs keep their words apart, though their ids are the same", () => {
    const other: TemplatePickerRules<Item, Shelf> = createTemplatePickerRules({
      ...CATALOG,
      getTemplates: (): Array<Item> => {
        return [{ ...ITEMS[0]!, name: "Red Plum", description: "A plum." }];
      },
      getSearchFields: (item: Item) => {
        return [{ text: item.name, weight: 1 }];
      },
    });

    // Both read "apple" before the other answers, and neither borrows the other's words.
    expect(searchIds("apple")).toContain("apple");
    expect(ids(other.search(other.catalog.getTemplates(), "plum"))).toEqual([
      "apple",
    ]);
    expect(ids(other.search(other.catalog.getTemplates(), "green"))).toEqual(
      [],
    );
    expect(searchIds("plum")).toEqual([]);
  });
});

describe("the list", () => {
  test("opens on Recommended: one list, no headings", () => {
    const list: TemplatePickerList<Item, Shelf> = RULES.getList(
      INITIAL_TEMPLATE_PICKER_STATE,
    );

    expect(list.view).toBe(TemplateCollection.Recommended);
    expect(list.isSearching).toBe(false);
    expect(list.sections).toHaveLength(1);
    expect(list.sections[0]!.title).toBe("");
    expect(ids(list.templates)).toEqual(["cheddar", "banana", "rye"]);
  });

  test("All templates: every template under its category's name, in the categories' order", () => {
    const list: TemplatePickerList<Item, Shelf> = RULES.getList(
      stateWith({ browseView: TemplateCollection.All }),
    );

    expect(
      list.sections.map((section: { id: string; title: string }) => {
        return [section.id, section.title];
      }),
    ).toEqual([
      ["bakery", "Bakery"],
      ["cheese-counter", "Cheese Counter"],
      ["fruit-and-veg", "Fruit and Veg"],
    ]);
    expect(ids(list.templates)).toEqual(
      ids(RULES.getTemplatesInView(TemplateCollection.All)),
    );
  });

  test("a category split into parts: one heading per part", () => {
    const list: TemplatePickerList<Item, Shelf> = RULES.getList(
      stateWith({ browseView: Shelf.Bread }),
    );

    expect(
      list.sections.map((section: { title: string }) => {
        return section.title;
      }),
    ).toEqual(["Loaves", "Pastries"]);
  });

  test("a category without parts: one list", () => {
    const list: TemplatePickerList<Item, Shelf> = RULES.getList(
      stateWith({ browseView: Shelf.Cheese }),
    );

    expect(list.sections).toHaveLength(1);
    expect(list.sections[0]!.title).toBe("");
  });

  test("a catalog without parts never splits a category", () => {
    const flat: TemplatePickerRules<Item, Shelf> = createTemplatePickerRules({
      ...CATALOG,
      getSubcategory: undefined,
    });

    expect(
      flat.getList(stateWith({ browseView: Shelf.Bread })).sections,
    ).toHaveLength(1);
  });

  test("searching: the matches in the search's view, best first, in one list", () => {
    const list: TemplatePickerList<Item, Shelf> = RULES.getList(
      stateWith({ search: "loaf", searchView: TemplateCollection.All }),
    );

    expect(list.isSearching).toBe(true);
    expect(
      list.sections.map((section: { id: string }) => {
        return section.id;
      }),
    ).toEqual(["results"]);
    expect(ids(list.templates)).toEqual(["rye", "baguette"]);
  });

  test("a search that finds nothing leaves no section at all", () => {
    const list: TemplatePickerList<Item, Shelf> = RULES.getList(
      stateWith({ search: "zzzz", searchView: TemplateCollection.All }),
    );

    expect(list.sections).toEqual([]);
    expect(list.templates).toEqual([]);
  });

  test("counts each view's matches while searching", () => {
    const counts: Map<TemplatePickerView<Shelf>, number> = RULES.getCounts(
      "loaf",
    );

    expect(counts.get(TemplateCollection.All)).toBe(2);
    expect(counts.get(Shelf.Bread)).toBe(2);
    expect(counts.get(Shelf.Cheese)).toBe(0);
    expect(counts.get(TemplateCollection.Recommended)).toBe(1);
    expect(RULES.getCounts("").get(TemplateCollection.All)).toBe(ITEMS.length);
  });
});

describe("the pick", () => {
  test("nothing is picked while browsing until a template is", () => {
    expect(RULES.getActiveTemplate(INITIAL_TEMPLATE_PICKER_STATE)).toBeNull();
    expect(
      RULES.getActiveTemplate(
        RULES.withSelected(INITIAL_TEMPLATE_PICKER_STATE, "banana"),
      )?.id,
    ).toBe("banana");
  });

  test("a pick that is not on the list is not the active template", () => {
    expect(
      RULES.getActiveTemplate(stateWith({ selectedTemplateId: "apple" })),
    ).toBeNull();
  });

  test("while searching, the best match is picked on its own", () => {
    expect(
      RULES.getActiveTemplate(
        RULES.withSearch(INITIAL_TEMPLATE_PICKER_STATE, "loaf"),
      )?.id,
    ).toBe("rye");
  });

  test("a new search looks through every template and lets the pick go", () => {
    const browsing: TemplatePickerState<Shelf> = RULES.withSelected(
      stateWith({ browseView: Shelf.Cheese }),
      "brie",
    );
    const searching: TemplatePickerState<Shelf> = RULES.withSearch(
      browsing,
      "loaf",
    );

    expect(searching.searchView).toBe(TemplateCollection.All);
    expect(searching.browseView).toBe(Shelf.Cheese);
    expect(searching.selectedTemplateId).toBeNull();
    // Cleared, it browses what it browsed before.
    expect(RULES.getCurrentView(RULES.withSearch(searching, ""))).toBe(
      Shelf.Cheese,
    );
  });

  test("a search carried on keeps the view it was narrowed to", () => {
    const narrowed: TemplatePickerState<Shelf> = RULES.withView(
      RULES.withSearch(INITIAL_TEMPLATE_PICKER_STATE, "lo"),
      Shelf.Bread,
    );

    expect(RULES.withSearch(narrowed, "loaf").searchView).toBe(Shelf.Bread);
  });

  test("a category narrows a search, or changes what is browsed, and lets the pick go", () => {
    const picked: TemplatePickerState<Shelf> = RULES.withSelected(
      INITIAL_TEMPLATE_PICKER_STATE,
      "banana",
    );
    const browsing: TemplatePickerState<Shelf> = RULES.withView(
      picked,
      Shelf.Fruit,
    );

    expect(browsing.browseView).toBe(Shelf.Fruit);
    expect(browsing.selectedTemplateId).toBeNull();

    const narrowed: TemplatePickerState<Shelf> = RULES.withView(
      RULES.withSearch(browsing, "a"),
      Shelf.Cheese,
    );

    expect(narrowed.searchView).toBe(Shelf.Cheese);
    expect(narrowed.browseView).toBe(Shelf.Fruit);
  });

  test("no rule changes the state it is given", () => {
    const state: TemplatePickerState<Shelf> = stateWith({});
    const copy: TemplatePickerState<Shelf> = { ...state };

    RULES.withSearch(state, "loaf");
    RULES.withView(state, Shelf.Bread);
    RULES.withSelected(state, "rye");

    expect(state).toEqual(copy);
    expect(INITIAL_TEMPLATE_PICKER_STATE).toEqual({
      search: "",
      browseView: TemplateCollection.Recommended,
      searchView: TemplateCollection.All,
      selectedTemplateId: null,
    });
  });
});

describe("the arrow keys", () => {
  const recommended: TemplatePickerState<Shelf> = INITIAL_TEMPLATE_PICKER_STATE;

  test("from nothing, down picks the first and up the last", () => {
    expect(RULES.getMovedTemplateId(recommended, TemplateMove.Next)).toBe(
      "cheddar",
    );
    expect(RULES.getMovedTemplateId(recommended, TemplateMove.Previous)).toBe(
      "rye",
    );
  });

  test("they move one row at a time, and stop at either end", () => {
    const onBanana: TemplatePickerState<Shelf> = RULES.withSelected(
      recommended,
      "banana",
    );

    expect(RULES.getMovedTemplateId(onBanana, TemplateMove.Next)).toBe("rye");
    expect(RULES.getMovedTemplateId(onBanana, TemplateMove.Previous)).toBe(
      "cheddar",
    );
    expect(
      RULES.getMovedTemplateId(
        RULES.withSelected(recommended, "rye"),
        TemplateMove.Next,
      ),
    ).toBe("rye");
    expect(
      RULES.getMovedTemplateId(
        RULES.withSelected(recommended, "cheddar"),
        TemplateMove.Previous,
      ),
    ).toBe("cheddar");
  });

  test("Home and End go to either end", () => {
    const onBanana: TemplatePickerState<Shelf> = RULES.withSelected(
      recommended,
      "banana",
    );

    expect(RULES.getMovedTemplateId(onBanana, TemplateMove.First)).toBe(
      "cheddar",
    );
    expect(RULES.getMovedTemplateId(onBanana, TemplateMove.Last)).toBe("rye");
  });

  test("they walk a category's parts as one list", () => {
    const bread: TemplatePickerState<Shelf> = RULES.withSelected(
      stateWith({ browseView: Shelf.Bread }),
      "baguette",
    );

    expect(RULES.getMovedTemplateId(bread, TemplateMove.Next)).toBe(
      "croissant",
    );
  });

  test("while searching, they move from the best match", () => {
    const searching: TemplatePickerState<Shelf> = RULES.withSearch(
      recommended,
      "loaf",
    );

    expect(RULES.getMovedTemplateId(searching, TemplateMove.Next)).toBe(
      "baguette",
    );
  });

  test("an empty list has nothing to move to", () => {
    expect(
      RULES.getMovedTemplateId(
        RULES.withSearch(recommended, "zzzz"),
        TemplateMove.Next,
      ),
    ).toBeNull();
  });
});

describe("a count and its noun, translated whole", () => {
  const tx: (value: string) => string = (value: string): string => {
    return value === "{count} results" ? "Results: {count}" : value;
  };

  test("one is its own phrase, any other number goes where the phrase puts it", () => {
    expect(templateCountText(tx, 1, "1 result", "{count} results")).toBe(
      "1 result",
    );
    expect(templateCountText(tx, 12, "1 result", "{count} results")).toBe(
      "Results: 12",
    );
    expect(templateCountText(tx, 0, "1 result", "{count} results")).toBe(
      "Results: 0",
    );
  });
});
