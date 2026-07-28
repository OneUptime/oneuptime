import Column from "../../../../UI/Components/ModelTable/Column";
import Columns from "../../../../UI/Components/ModelTable/Columns";
import {
  ColumnPreference,
  CustomizableColumn,
  EmptyColumnPreference,
  applyColumnPreference,
  buildColumnPreference,
  fromJSON,
  getColumnBaseId,
  getColumnIds,
  getCustomizableColumns,
  isEmptyColumnPreference,
  sanitizeColumnPreference,
  toJSON,
} from "../../../../UI/Components/ModelTable/ColumnPreference";
import FieldType from "../../../../UI/Components/Types/FieldType";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import { JSONObject } from "../../../../Types/JSON";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A ModelTable's column layout is per viewer and is persisted, which means it
 * routinely outlives the release that produced it: the column set is edited
 * every time someone touches the page, and for tables with custom fields the
 * set is not even fixed within a release.
 *
 * So the module has one job that everything else serves — a stored layout must
 * degrade gracefully. Two invariants carry that:
 *
 *  1. Identity comes from the declared field, never from array position, so
 *     inserting a column does not silently re-point every stored id one slot
 *     to the left.
 *  2. Anything the layout does not recognise fails *open*: an unmentioned
 *     column is visible, a stale id is dropped, and a layout that would leave
 *     the table blank is refused outright.
 *
 * These are pinned here rather than through a rendered table because a wrong
 * answer shows up as "my columns are gone", which nobody reports as a bug —
 * they just re-pick them and lose the layout again next release.
 */

type ColumnOverrides = Partial<Column<Monitor>>;

type MakeColumnFunction = (overrides: ColumnOverrides) => Column<Monitor>;

const makeColumn: MakeColumnFunction = (
  overrides: ColumnOverrides,
): Column<Monitor> => {
  return {
    field: {},
    title: "Untitled",
    type: FieldType.Text,
    ...overrides,
  };
};

type TitlesOfFunction = (columns: Columns<Monitor>) => Array<string>;

const titlesOf: TitlesOfFunction = (
  columns: Columns<Monitor>,
): Array<string> => {
  return columns.map((column: Column<Monitor>): string => {
    return column.title;
  });
};

type EntryIdsFunction = (
  entries: Array<CustomizableColumn<Monitor>>,
) => Array<string>;

const entryIds: EntryIdsFunction = (
  entries: Array<CustomizableColumn<Monitor>>,
): Array<string> => {
  return entries.map((entry: CustomizableColumn<Monitor>): string => {
    return entry.id;
  });
};

type VisibilityOfFunction = (
  entries: Array<CustomizableColumn<Monitor>>,
) => Record<string, boolean>;

const visibilityOf: VisibilityOfFunction = (
  entries: Array<CustomizableColumn<Monitor>>,
): Record<string, boolean> => {
  const map: Record<string, boolean> = {};

  entries.forEach((entry: CustomizableColumn<Monitor>): void => {
    map[entry.id] = entry.isVisible;
  });

  return map;
};

type FindEntryFunction = (
  entries: Array<CustomizableColumn<Monitor>>,
  id: string,
) => CustomizableColumn<Monitor>;

const findEntry: FindEntryFunction = (
  entries: Array<CustomizableColumn<Monitor>>,
  id: string,
): CustomizableColumn<Monitor> => {
  const entry: CustomizableColumn<Monitor> | undefined = entries.find(
    (candidate: CustomizableColumn<Monitor>): boolean => {
      return candidate.id === id;
    },
  );

  if (!entry) {
    throw new Error(`No column entry with id "${id}"`);
  }

  return entry;
};

beforeEach(() => {
  /*
   * Nothing here reads storage, but the Common suite runs --runInBand and
   * localStorage leaks between files; clearing keeps a future refactor that
   * memoizes layouts from inheriting another suite's state.
   */
  window.localStorage.clear();
});

describe("getColumnBaseId", () => {
  test("an explicit id beats the derived one", () => {
    /*
     * The escape hatch for cells rendered entirely through getElement off a
     * placeholder field — their derived id would be a title slug, and titles
     * are the part of a column authors change most freely.
     */
    expect(
      getColumnBaseId<Monitor>(
        makeColumn({
          id: "monitor-uptime",
          field: { name: true },
          title: "Uptime",
        }),
      ),
    ).toBe("monitor-uptime");
  });

  test("derives from the first declared field key", () => {
    expect(
      getColumnBaseId<Monitor>(
        makeColumn({ field: { name: true }, title: "Name" }),
      ),
    ).toBe("name");
  });

  test("uses only the first key when a column selects several fields", () => {
    /*
     * A composite cell (say "3/5 online") selects more than one field, but its
     * identity has to be a single stable string, so the first declared key is
     * the one that counts.
     */
    expect(
      getColumnBaseId<Monitor>(
        makeColumn({
          field: { monitorType: true, description: true },
          title: "Type",
        }),
      ),
    ).toBe("monitorType");
  });

  test("a selectedProperty makes each custom field its own column", () => {
    /*
     * This is what the whole custom-field feature rests on: every custom field
     * hangs off the same `customFields` JSON column, so without the property
     * suffix they would all collapse onto one id and switching one off would
     * switch off all of them.
     */
    expect(
      getColumnBaseId<Monitor>(
        makeColumn({
          field: { customFields: true },
          selectedProperty: "Severity",
          title: "Severity",
        }),
      ),
    ).toBe("customFields.Severity");

    expect(
      getColumnBaseId<Monitor>(
        makeColumn({
          field: { customFields: true },
          selectedProperty: "Owning Team",
          title: "Owning Team",
        }),
      ),
    ).toBe("customFields.Owning Team");
  });

  test("falls back to a slug of the title when there is no field key", () => {
    expect(getColumnBaseId<Monitor>(makeColumn({ title: "Row Actions" }))).toBe(
      "row-actions",
    );
  });

  test("the title slug collapses punctuation and trims stray separators", () => {
    expect(getColumnBaseId<Monitor>(makeColumn({ title: "CPU % (avg)" }))).toBe(
      "cpu-avg",
    );
  });

  test("falls back to the title when `field` is missing altogether", () => {
    // Hand-written columns in the wild do omit `field`; the guard must hold.
    const column: Column<Monitor> = {
      ...makeColumn({ title: "Actions" }),
      field: undefined,
    } as unknown as Column<Monitor>;

    expect(getColumnBaseId<Monitor>(column)).toBe("actions");
  });

  test('degrades to the literal "column" when there is nothing to derive from', () => {
    // An id must exist even for a column with neither field nor title.
    expect(getColumnBaseId<Monitor>(makeColumn({ title: "" }))).toBe("column");
    expect(getColumnBaseId<Monitor>(makeColumn({ title: "!!!" }))).toBe(
      "column",
    );
  });
});

describe("getColumnIds", () => {
  test("returns one id per column, in declaration order", () => {
    const columns: Columns<Monitor> = [
      makeColumn({ field: { name: true }, title: "Name" }),
      makeColumn({ field: { description: true }, title: "Description" }),
      makeColumn({ field: { labels: true }, title: "Labels" }),
    ];

    expect(getColumnIds<Monitor>(columns)).toEqual([
      "name",
      "description",
      "labels",
    ]);
  });

  test("empty column set produces no ids", () => {
    expect(getColumnIds<Monitor>([])).toEqual([]);
  });

  test("columns sharing a base field are disambiguated by title slug", () => {
    /*
     * Several cells rendering from the same placeholder `field: { _id: true }`
     * is the common shape, not an edge case. Title is used first because it is
     * what the viewer sees in the picker and it does not move when a column is
     * inserted next to it.
     */
    const columns: Columns<Monitor> = [
      makeColumn({ field: { _id: true }, title: "Actions" }),
      makeColumn({ field: { _id: true }, title: "Owner" }),
    ];

    expect(getColumnIds<Monitor>(columns)).toEqual([
      "_id:actions",
      "_id:owner",
    ]);
  });

  test("columns sharing a base AND a title fall back to a positional suffix", () => {
    const columns: Columns<Monitor> = [
      makeColumn({ field: { _id: true }, title: "Actions" }),
      makeColumn({ field: { _id: true }, title: "Actions" }),
      makeColumn({ field: { _id: true }, title: "Actions" }),
    ];

    expect(getColumnIds<Monitor>(columns)).toEqual([
      "_id:actions",
      "_id:actions#2",
      "_id:actions#3",
    ]);
  });

  test("colliding columns with no title at all still get distinct ids", () => {
    const columns: Columns<Monitor> = [
      makeColumn({ field: { _id: true }, title: "" }),
      makeColumn({ field: { _id: true }, title: "" }),
    ];

    expect(getColumnIds<Monitor>(columns)).toEqual(["_id", "_id#2"]);
  });

  test("only the colliding columns are suffixed", () => {
    const columns: Columns<Monitor> = [
      makeColumn({ field: { name: true }, title: "Name" }),
      makeColumn({ field: { _id: true }, title: "Actions" }),
      makeColumn({ field: { _id: true }, title: "Owner" }),
      makeColumn({ field: { labels: true }, title: "Labels" }),
    ];

    expect(getColumnIds<Monitor>(columns)).toEqual([
      "name",
      "_id:actions",
      "_id:owner",
      "labels",
    ]);
  });

  test("every custom field on one JSON column gets its own id", () => {
    const columns: Columns<Monitor> = [
      makeColumn({
        field: { customFields: true },
        selectedProperty: "Severity",
        title: "Severity",
      }),
      makeColumn({
        field: { customFields: true },
        selectedProperty: "Team",
        title: "Team",
      }),
    ];

    // Different base ids, so no collision handling kicks in.
    expect(getColumnIds<Monitor>(columns)).toEqual([
      "customFields.Severity",
      "customFields.Team",
    ]);
  });

  test("an id does not move when unrelated columns are added around it", () => {
    /*
     * The point of deriving from the field: a release that adds three columns
     * must not invalidate the stored layout for the ones that already existed.
     */
    const small: Columns<Monitor> = [
      makeColumn({ field: { name: true }, title: "Name" }),
      makeColumn({ field: { description: true }, title: "Description" }),
    ];

    const large: Columns<Monitor> = [
      makeColumn({ field: { monitorType: true }, title: "Type" }),
      makeColumn({ field: { name: true }, title: "Name" }),
      makeColumn({ field: { labels: true }, title: "Labels" }),
      makeColumn({ field: { description: true }, title: "Description" }),
      makeColumn({ field: { slug: true }, title: "Slug" }),
    ];

    const smallIds: Array<string> = getColumnIds<Monitor>(small);
    const largeIds: Array<string> = getColumnIds<Monitor>(large);

    expect(smallIds).toEqual(["name", "description"]);
    expect(largeIds).toContain("name");
    expect(largeIds).toContain("description");
  });

  test("an id is unaffected by the column's title when nothing collides", () => {
    const before: Columns<Monitor> = [
      makeColumn({ field: { description: true }, title: "Description" }),
    ];
    const after: Columns<Monitor> = [
      makeColumn({ field: { description: true }, title: "Summary" }),
    ];

    expect(getColumnIds<Monitor>(before)).toEqual(getColumnIds<Monitor>(after));
  });

  test("introducing a collision does re-key the column that was alone", () => {
    /*
     * The documented trade-off, pinned so it is a decision rather than a
     * surprise: adding a second `_id` column changes the first one's id, the
     * stored entry goes stale and the column simply defaults back to visible.
     * Authors who cannot afford that set an explicit `id`.
     */
    expect(
      getColumnIds<Monitor>([
        makeColumn({ field: { _id: true }, title: "Actions" }),
      ]),
    ).toEqual(["_id"]);

    expect(
      getColumnIds<Monitor>([
        makeColumn({ field: { _id: true }, title: "Actions" }),
        makeColumn({ field: { _id: true }, title: "Owner" }),
      ]),
    ).toEqual(["_id:actions", "_id:owner"]);
  });

  test("ids are unique across a pathological column set", () => {
    const columns: Columns<Monitor> = [
      makeColumn({ field: { _id: true }, title: "Actions" }),
      makeColumn({ field: { _id: true }, title: "Actions" }),
      makeColumn({ field: { _id: true }, title: "" }),
      makeColumn({ field: {}, title: "" }),
      makeColumn({ field: {}, title: "" }),
      makeColumn({ id: "explicit", field: { name: true }, title: "Name" }),
    ];

    const ids: Array<string> = getColumnIds<Monitor>(columns);

    expect(ids).toHaveLength(columns.length);
    expect(new Set(ids).size).toBe(columns.length);
  });
});

describe("getCustomizableColumns without a preference", () => {
  test("keeps declaration order and shows everything", () => {
    const columns: Columns<Monitor> = [
      makeColumn({ field: { name: true }, title: "Name" }),
      makeColumn({ field: { description: true }, title: "Description" }),
      makeColumn({ field: { labels: true }, title: "Labels" }),
    ];

    const entries: Array<CustomizableColumn<Monitor>> =
      getCustomizableColumns<Monitor>({ columns });

    expect(entryIds(entries)).toEqual(["name", "description", "labels"]);
    expect(visibilityOf(entries)).toEqual({
      name: true,
      description: true,
      labels: true,
    });
  });

  test("isHiddenByDefault columns start switched off but are still listed", () => {
    // They have to be listed, otherwise there is no way to switch them on.
    const columns: Columns<Monitor> = [
      makeColumn({ field: { name: true }, title: "Name" }),
      makeColumn({
        field: { customFields: true },
        selectedProperty: "Severity",
        title: "Severity",
        isHiddenByDefault: true,
      }),
    ];

    const entries: Array<CustomizableColumn<Monitor>> =
      getCustomizableColumns<Monitor>({ columns });

    expect(entryIds(entries)).toEqual(["name", "customFields.Severity"]);
    expect(findEntry(entries, "customFields.Severity").isVisible).toBe(false);
  });

  test("null and undefined preferences behave the same as no preference", () => {
    const columns: Columns<Monitor> = [
      makeColumn({ field: { name: true }, title: "Name" }),
      makeColumn({ field: { labels: true }, title: "Labels" }),
    ];

    expect(entryIds(getCustomizableColumns<Monitor>({ columns }))).toEqual([
      "name",
      "labels",
    ]);
    expect(
      entryIds(getCustomizableColumns<Monitor>({ columns, preference: null })),
    ).toEqual(["name", "labels"]);
    expect(
      entryIds(
        getCustomizableColumns<Monitor>({ columns, preference: undefined }),
      ),
    ).toEqual(["name", "labels"]);
  });

  test("carries the original column object through untouched", () => {
    // The picker and the table both need the real column, not a copy of it.
    const name: Column<Monitor> = makeColumn({
      field: { name: true },
      title: "Name",
    });

    const entries: Array<CustomizableColumn<Monitor>> =
      getCustomizableColumns<Monitor>({ columns: [name] });

    expect(findEntry(entries, "name").column).toBe(name);
  });

  test("an empty column set yields no entries", () => {
    expect(getCustomizableColumns<Monitor>({ columns: [] })).toEqual([]);
  });
});

describe("getCustomizableColumns pinning", () => {
  test("isNotCustomizable marks the entry pinned", () => {
    const columns: Columns<Monitor> = [
      makeColumn({
        field: { name: true },
        title: "Name",
        isNotCustomizable: true,
      }),
      makeColumn({ field: { labels: true }, title: "Labels" }),
    ];

    const entries: Array<CustomizableColumn<Monitor>> =
      getCustomizableColumns<Monitor>({ columns });

    expect(findEntry(entries, "name").isPinned).toBe(true);
    expect(findEntry(entries, "labels").isPinned).toBe(false);
  });

  test("a pinned column is never hidden by a preference that names it", () => {
    /*
     * Pinned columns are absent from the picker, so a stored `hidden` entry
     * for one would be unrecoverable: the viewer would have no control to
     * bring the row's identifying column back.
     */
    const columns: Columns<Monitor> = [
      makeColumn({
        field: { name: true },
        title: "Name",
        isNotCustomizable: true,
      }),
      makeColumn({ field: { labels: true }, title: "Labels" }),
    ];

    const entries: Array<CustomizableColumn<Monitor>> =
      getCustomizableColumns<Monitor>({
        columns,
        preference: { order: ["labels", "name"], hidden: ["name", "labels"] },
      });

    expect(findEntry(entries, "name").isVisible).toBe(true);
    expect(findEntry(entries, "labels").isVisible).toBe(false);
  });

  test("isHiddenByDefault is ignored on a pinned column", () => {
    // Contradictory flags: pinning wins, because it is the stronger promise.
    const columns: Columns<Monitor> = [
      makeColumn({
        field: { name: true },
        title: "Name",
        isNotCustomizable: true,
        isHiddenByDefault: true,
      }),
    ];

    const entries: Array<CustomizableColumn<Monitor>> =
      getCustomizableColumns<Monitor>({ columns });

    expect(findEntry(entries, "name").isVisible).toBe(true);
  });

  test("a pinned column keeps its declared position under a stale order", () => {
    const columns: Columns<Monitor> = [
      makeColumn({
        field: { name: true },
        title: "Name",
        isNotCustomizable: true,
      }),
      makeColumn({ field: { monitorType: true }, title: "Type" }),
      makeColumn({ field: { labels: true }, title: "Labels" }),
    ];

    /*
     * `name` appears in `order` — a layout written before the column was
     * pinned, or hand-edited. It must not drag the pinned column anywhere.
     */
    const entries: Array<CustomizableColumn<Monitor>> =
      getCustomizableColumns<Monitor>({
        columns,
        preference: {
          order: ["labels", "monitorType", "name"],
          hidden: ["name"],
        },
      });

    expect(entryIds(entries)).toEqual(["name", "labels", "monitorType"]);
    expect(findEntry(entries, "name").isVisible).toBe(true);
  });
});

describe("getCustomizableColumns ordering", () => {
  test("a preference reorders the entries", () => {
    const columns: Columns<Monitor> = [
      makeColumn({ field: { name: true }, title: "Name" }),
      makeColumn({ field: { description: true }, title: "Description" }),
      makeColumn({ field: { labels: true }, title: "Labels" }),
    ];

    const entries: Array<CustomizableColumn<Monitor>> =
      getCustomizableColumns<Monitor>({
        columns,
        preference: { order: ["labels", "name", "description"], hidden: [] },
      });

    expect(entryIds(entries)).toEqual(["labels", "name", "description"]);
  });

  test("an order that lists ids the table no longer has is simply skipped", () => {
    const columns: Columns<Monitor> = [
      makeColumn({ field: { name: true }, title: "Name" }),
      makeColumn({ field: { labels: true }, title: "Labels" }),
    ];

    const entries: Array<CustomizableColumn<Monitor>> =
      getCustomizableColumns<Monitor>({
        columns,
        preference: {
          order: ["labels", "deletedColumn", "name"],
          hidden: [],
        },
      });

    expect(entryIds(entries)).toEqual(["labels", "name"]);
  });

  test("a column declared in the middle and absent from the order stays in the middle", () => {
    /*
     * The load-bearing case for a new release: `slug` ships between
     * Description and Labels and the stored layout has never heard of it. It
     * has to appear where its author put it, not be swept to the end where
     * nobody looks.
     */
    const columns: Columns<Monitor> = [
      makeColumn({ field: { name: true }, title: "Name" }),
      makeColumn({ field: { description: true }, title: "Description" }),
      makeColumn({ field: { slug: true }, title: "Slug" }),
      makeColumn({ field: { labels: true }, title: "Labels" }),
      makeColumn({ field: { monitorType: true }, title: "Type" }),
    ];

    const entries: Array<CustomizableColumn<Monitor>> =
      getCustomizableColumns<Monitor>({
        columns,
        preference: {
          order: ["name", "description", "labels", "monitorType"],
          hidden: [],
        },
      });

    expect(entryIds(entries)).toEqual([
      "name",
      "description",
      "slug",
      "labels",
      "monitorType",
    ]);
  });

  test("an unmentioned column follows the last arranged column declared before it", () => {
    /*
     * The rule is "declared neighbours", not "declared index": once the viewer
     * has reshuffled things, `slug`'s anchor is Description — the last column
     * that both precedes it in the declaration and appears in the layout.
     */
    const columns: Columns<Monitor> = [
      makeColumn({ field: { name: true }, title: "Name" }),
      makeColumn({ field: { description: true }, title: "Description" }),
      makeColumn({ field: { slug: true }, title: "Slug" }),
      makeColumn({ field: { labels: true }, title: "Labels" }),
    ];

    const entries: Array<CustomizableColumn<Monitor>> =
      getCustomizableColumns<Monitor>({
        columns,
        preference: {
          order: ["labels", "name", "description"],
          hidden: [],
        },
      });

    expect(entryIds(entries)).toEqual([
      "labels",
      "name",
      "description",
      "slug",
    ]);
  });

  test("a new first column sorts ahead of everything the layout arranged", () => {
    const columns: Columns<Monitor> = [
      makeColumn({ field: { slug: true }, title: "Slug" }),
      makeColumn({ field: { name: true }, title: "Name" }),
      makeColumn({ field: { labels: true }, title: "Labels" }),
    ];

    const entries: Array<CustomizableColumn<Monitor>> =
      getCustomizableColumns<Monitor>({
        columns,
        preference: { order: ["labels", "name"], hidden: [] },
      });

    expect(entryIds(entries)).toEqual(["slug", "labels", "name"]);
  });

  test("several consecutive new columns keep their relative declaration order", () => {
    const columns: Columns<Monitor> = [
      makeColumn({ field: { name: true }, title: "Name" }),
      makeColumn({ field: { slug: true }, title: "Slug" }),
      makeColumn({ field: { monitorType: true }, title: "Type" }),
      makeColumn({ field: { labels: true }, title: "Labels" }),
    ];

    const entries: Array<CustomizableColumn<Monitor>> =
      getCustomizableColumns<Monitor>({
        columns,
        preference: { order: ["name", "labels"], hidden: [] },
      });

    // Equal sort keys must be broken by declaration order, i.e. stably.
    expect(entryIds(entries)).toEqual([
      "name",
      "slug",
      "monitorType",
      "labels",
    ]);
  });

  test("a duplicated id in the order uses its first occurrence", () => {
    const columns: Columns<Monitor> = [
      makeColumn({ field: { name: true }, title: "Name" }),
      makeColumn({ field: { labels: true }, title: "Labels" }),
    ];

    const entries: Array<CustomizableColumn<Monitor>> =
      getCustomizableColumns<Monitor>({
        columns,
        preference: { order: ["labels", "name", "labels"], hidden: [] },
      });

    expect(entryIds(entries)).toEqual(["labels", "name"]);
  });

  test("an empty order leaves declaration order alone", () => {
    const columns: Columns<Monitor> = [
      makeColumn({ field: { name: true }, title: "Name" }),
      makeColumn({ field: { labels: true }, title: "Labels" }),
    ];

    const entries: Array<CustomizableColumn<Monitor>> =
      getCustomizableColumns<Monitor>({
        columns,
        preference: { order: [], hidden: ["labels"] },
      });

    expect(entryIds(entries)).toEqual(["name", "labels"]);
    expect(findEntry(entries, "labels").isVisible).toBe(false);
  });
});

describe("getCustomizableColumns visibility", () => {
  test("an id in `hidden` switches the column off", () => {
    const columns: Columns<Monitor> = [
      makeColumn({ field: { name: true }, title: "Name" }),
      makeColumn({ field: { labels: true }, title: "Labels" }),
    ];

    const entries: Array<CustomizableColumn<Monitor>> =
      getCustomizableColumns<Monitor>({
        columns,
        preference: { order: ["name", "labels"], hidden: ["labels"] },
      });

    expect(visibilityOf(entries)).toEqual({ name: true, labels: false });
  });

  test("an id in `order` but not `hidden` switches a default-hidden column on", () => {
    /*
     * This is the only mechanism by which a viewer turns a custom field on:
     * custom-field columns ship hidden, and the layout says "on" by naming the
     * id in `order` while leaving it out of `hidden`.
     */
    const columns: Columns<Monitor> = [
      makeColumn({ field: { name: true }, title: "Name" }),
      makeColumn({
        field: { customFields: true },
        selectedProperty: "Severity",
        title: "Severity",
        isHiddenByDefault: true,
      }),
    ];

    const entries: Array<CustomizableColumn<Monitor>> =
      getCustomizableColumns<Monitor>({
        columns,
        preference: {
          order: ["name", "customFields.Severity"],
          hidden: [],
        },
      });

    expect(findEntry(entries, "customFields.Severity").isVisible).toBe(true);
  });

  test("`hidden` wins over `order` when an id is in both", () => {
    const columns: Columns<Monitor> = [
      makeColumn({
        field: { customFields: true },
        selectedProperty: "Severity",
        title: "Severity",
        isHiddenByDefault: true,
      }),
    ];

    const entries: Array<CustomizableColumn<Monitor>> =
      getCustomizableColumns<Monitor>({
        columns,
        preference: {
          order: ["customFields.Severity"],
          hidden: ["customFields.Severity"],
        },
      });

    expect(findEntry(entries, "customFields.Severity").isVisible).toBe(false);
  });

  test("a default-hidden column the layout never mentions stays hidden", () => {
    // A custom field added after the viewer last touched this table.
    const columns: Columns<Monitor> = [
      makeColumn({ field: { name: true }, title: "Name" }),
      makeColumn({
        field: { customFields: true },
        selectedProperty: "Team",
        title: "Team",
        isHiddenByDefault: true,
      }),
    ];

    const entries: Array<CustomizableColumn<Monitor>> =
      getCustomizableColumns<Monitor>({
        columns,
        preference: { order: ["name"], hidden: [] },
      });

    expect(findEntry(entries, "customFields.Team").isVisible).toBe(false);
  });

  test("a normal column the layout never mentions stays visible", () => {
    const columns: Columns<Monitor> = [
      makeColumn({ field: { name: true }, title: "Name" }),
      makeColumn({ field: { slug: true }, title: "Slug" }),
    ];

    const entries: Array<CustomizableColumn<Monitor>> =
      getCustomizableColumns<Monitor>({
        columns,
        preference: { order: ["name"], hidden: [] },
      });

    expect(findEntry(entries, "slug").isVisible).toBe(true);
  });
});

describe("applyColumnPreference", () => {
  test("renders only the visible columns, in layout order", () => {
    const columns: Columns<Monitor> = [
      makeColumn({ field: { name: true }, title: "Name" }),
      makeColumn({ field: { description: true }, title: "Description" }),
      makeColumn({ field: { labels: true }, title: "Labels" }),
    ];

    const rendered: Columns<Monitor> = applyColumnPreference<Monitor>({
      columns,
      preference: {
        order: ["labels", "name", "description"],
        hidden: ["description"],
      },
    });

    expect(titlesOf(rendered)).toEqual(["Labels", "Name"]);
  });

  test("returns the very same column objects, not copies", () => {
    const name: Column<Monitor> = makeColumn({
      field: { name: true },
      title: "Name",
    });
    const labels: Column<Monitor> = makeColumn({
      field: { labels: true },
      title: "Labels",
    });

    const rendered: Columns<Monitor> = applyColumnPreference<Monitor>({
      columns: [name, labels],
      preference: { order: ["labels", "name"], hidden: [] },
    });

    expect(rendered).toEqual([labels, name]);
    expect(rendered[0]).toBe(labels);
    expect(rendered[1]).toBe(name);
  });

  test("shows everything when the layout would leave the table blank", () => {
    /*
     * The safety net. An empty table has no header, therefore no "Columns"
     * button rendered against a column, and a viewer who hid the last column
     * would have nothing left to click to undo it. Refuse the layout instead.
     */
    const columns: Columns<Monitor> = [
      makeColumn({ field: { name: true }, title: "Name" }),
      makeColumn({ field: { description: true }, title: "Description" }),
    ];

    const rendered: Columns<Monitor> = applyColumnPreference<Monitor>({
      columns,
      preference: {
        order: ["description", "name"],
        hidden: ["name", "description"],
      },
    });

    expect(rendered).toHaveLength(2);
    expect(titlesOf(rendered)).toEqual(["Description", "Name"]);
  });

  test("the never-empty fallback also covers a single-column table", () => {
    const columns: Columns<Monitor> = [
      makeColumn({ field: { name: true }, title: "Name" }),
    ];

    expect(
      titlesOf(
        applyColumnPreference<Monitor>({
          columns,
          preference: { order: ["name"], hidden: ["name"] },
        }),
      ),
    ).toEqual(["Name"]);
  });

  test("with no preference the input comes back unchanged", () => {
    const columns: Columns<Monitor> = [
      makeColumn({ field: { name: true }, title: "Name" }),
      makeColumn({ field: { description: true }, title: "Description" }),
      makeColumn({
        field: { labels: true },
        title: "Labels",
      }),
    ];

    expect(titlesOf(applyColumnPreference<Monitor>({ columns }))).toEqual([
      "Name",
      "Description",
      "Labels",
    ]);
    expect(
      titlesOf(applyColumnPreference<Monitor>({ columns, preference: null })),
    ).toEqual(["Name", "Description", "Labels"]);
  });

  test("a default-hidden column is dropped even without a preference", () => {
    const columns: Columns<Monitor> = [
      makeColumn({ field: { name: true }, title: "Name" }),
      makeColumn({
        field: { customFields: true },
        selectedProperty: "Severity",
        title: "Severity",
        isHiddenByDefault: true,
      }),
    ];

    expect(titlesOf(applyColumnPreference<Monitor>({ columns }))).toEqual([
      "Name",
    ]);
  });

  test("no columns in, no columns out", () => {
    expect(applyColumnPreference<Monitor>({ columns: [] })).toEqual([]);
    expect(
      applyColumnPreference<Monitor>({
        columns: [],
        preference: { order: ["gone"], hidden: ["gone"] },
      }),
    ).toEqual([]);
  });
});

describe("buildColumnPreference", () => {
  test("round-trips through getCustomizableColumns", () => {
    const columns: Columns<Monitor> = [
      makeColumn({
        field: { name: true },
        title: "Name",
        isNotCustomizable: true,
      }),
      makeColumn({ field: { description: true }, title: "Description" }),
      makeColumn({ field: { labels: true }, title: "Labels" }),
      makeColumn({ field: { monitorType: true }, title: "Type" }),
    ];

    const preference: ColumnPreference = {
      order: ["monitorType", "description", "labels"],
      hidden: ["labels"],
    };

    const rebuilt: ColumnPreference = buildColumnPreference<Monitor>(
      getCustomizableColumns<Monitor>({ columns, preference }),
    );

    expect(rebuilt).toEqual(preference);
  });

  test("re-applying what it produced is a no-op", () => {
    // Saving the picker without touching it must not perturb the table.
    const columns: Columns<Monitor> = [
      makeColumn({ field: { name: true }, title: "Name" }),
      makeColumn({ field: { description: true }, title: "Description" }),
      makeColumn({ field: { labels: true }, title: "Labels" }),
    ];

    const first: Array<CustomizableColumn<Monitor>> =
      getCustomizableColumns<Monitor>({
        columns,
        preference: { order: ["labels", "name", "description"], hidden: [] },
      });

    const second: Array<CustomizableColumn<Monitor>> =
      getCustomizableColumns<Monitor>({
        columns,
        preference: buildColumnPreference<Monitor>(first),
      });

    expect(entryIds(second)).toEqual(entryIds(first));
    expect(visibilityOf(second)).toEqual(visibilityOf(first));
  });

  test("pinned entries are left out of both lists", () => {
    /*
     * Recording a pinned column would create an entry that goes stale the
     * moment a table stops pinning it — and worse, a `hidden` entry for a
     * column the picker cannot show.
     */
    const columnA: Column<Monitor> = makeColumn({ title: "A" });
    const columnB: Column<Monitor> = makeColumn({ title: "B" });
    const columnC: Column<Monitor> = makeColumn({ title: "C" });

    const entries: Array<CustomizableColumn<Monitor>> = [
      { id: "a", column: columnA, isVisible: true, isPinned: true },
      { id: "b", column: columnB, isVisible: false, isPinned: true },
      { id: "c", column: columnC, isVisible: true, isPinned: false },
    ];

    expect(buildColumnPreference<Monitor>(entries)).toEqual({
      order: ["c"],
      hidden: [],
    });
  });

  test("hidden holds exactly the not-visible, non-pinned ids", () => {
    const column: Column<Monitor> = makeColumn({ title: "X" });

    const entries: Array<CustomizableColumn<Monitor>> = [
      { id: "a", column, isVisible: true, isPinned: false },
      { id: "b", column, isVisible: false, isPinned: false },
      { id: "c", column, isVisible: true, isPinned: false },
      { id: "d", column, isVisible: false, isPinned: false },
    ];

    expect(buildColumnPreference<Monitor>(entries)).toEqual({
      order: ["a", "b", "c", "d"],
      hidden: ["b", "d"],
    });
  });

  test("no entries produce an empty layout", () => {
    expect(buildColumnPreference<Monitor>([])).toEqual({
      order: [],
      hidden: [],
    });
    expect(isEmptyColumnPreference(buildColumnPreference<Monitor>([]))).toBe(
      true,
    );
  });
});

describe("sanitizeColumnPreference", () => {
  test("drops ids that name no current column", () => {
    expect(
      sanitizeColumnPreference({
        preference: {
          order: ["name", "removedInThisRelease", "labels"],
          hidden: ["removedInThisRelease"],
        },
        knownColumnIds: ["name", "labels"],
      }),
    ).toEqual({ order: ["name", "labels"], hidden: [] });
  });

  test("de-duplicates each list", () => {
    expect(
      sanitizeColumnPreference({
        preference: {
          order: ["name", "labels", "name"],
          hidden: ["labels", "labels"],
        },
        knownColumnIds: ["name", "labels"],
      }),
    ).toEqual({ order: ["name", "labels"], hidden: ["labels"] });
  });

  test("returns null when nothing survives", () => {
    expect(
      sanitizeColumnPreference({
        preference: { order: ["gone"], hidden: ["alsoGone"] },
        knownColumnIds: ["name"],
      }),
    ).toBeNull();
  });

  test("returns null when the table has no columns at all", () => {
    expect(
      sanitizeColumnPreference({
        preference: { order: ["name"], hidden: [] },
        knownColumnIds: [],
      }),
    ).toBeNull();
  });

  test("returns null for a null preference", () => {
    expect(
      sanitizeColumnPreference({
        preference: null,
        knownColumnIds: ["name"],
      }),
    ).toBeNull();
  });

  test("returns null for an already-empty preference", () => {
    expect(
      sanitizeColumnPreference({
        preference: { order: [], hidden: [] },
        knownColumnIds: ["name"],
      }),
    ).toBeNull();
  });

  test("a partially stale layout keeps its valid entries", () => {
    expect(
      sanitizeColumnPreference({
        preference: {
          order: ["customFields.Deleted", "name", "customFields.Severity"],
          hidden: ["customFields.Deleted", "customFields.Severity"],
        },
        knownColumnIds: ["name", "customFields.Severity"],
      }),
    ).toEqual({
      order: ["name", "customFields.Severity"],
      hidden: ["customFields.Severity"],
    });
  });

  test("survives when only `hidden` has anything left", () => {
    // `order` empty but `hidden` populated is still a meaningful layout.
    expect(
      sanitizeColumnPreference({
        preference: { order: ["gone"], hidden: ["labels"] },
        knownColumnIds: ["labels"],
      }),
    ).toEqual({ order: [], hidden: ["labels"] });
  });

  test("does not mutate the preference it was given", () => {
    const preference: ColumnPreference = {
      order: ["name", "gone"],
      hidden: ["gone"],
    };

    sanitizeColumnPreference({ preference, knownColumnIds: ["name"] });

    expect(preference).toEqual({ order: ["name", "gone"], hidden: ["gone"] });
  });
});

describe("isEmptyColumnPreference", () => {
  test("null and undefined are empty", () => {
    expect(isEmptyColumnPreference(null)).toBe(true);
    expect(isEmptyColumnPreference(undefined)).toBe(true);
  });

  test("two empty lists are empty", () => {
    expect(isEmptyColumnPreference({ order: [], hidden: [] })).toBe(true);
    expect(isEmptyColumnPreference(EmptyColumnPreference)).toBe(true);
  });

  test("either list carrying something makes it non-empty", () => {
    expect(isEmptyColumnPreference({ order: ["name"], hidden: [] })).toBe(
      false,
    );
    expect(isEmptyColumnPreference({ order: [], hidden: ["name"] })).toBe(
      false,
    );
    expect(isEmptyColumnPreference({ order: ["name"], hidden: ["name"] })).toBe(
      false,
    );
  });
});

describe("toJSON", () => {
  test("a layout that changes nothing is stored as nothing", () => {
    /*
     * Otherwise every table anybody merely opened would write a row of default
     * preferences, and there would be no way to tell "never customised" from
     * "customised back to the default".
     */
    expect(toJSON(null)).toBeNull();
    expect(toJSON(undefined)).toBeNull();
    expect(toJSON({ order: [], hidden: [] })).toBeNull();
    expect(toJSON(EmptyColumnPreference)).toBeNull();
  });

  test("writes both lists", () => {
    expect(toJSON({ order: ["labels", "name"], hidden: ["name"] })).toEqual({
      order: ["labels", "name"],
      hidden: ["name"],
    });
  });

  test("writes an order-only layout", () => {
    expect(toJSON({ order: ["labels", "name"], hidden: [] })).toEqual({
      order: ["labels", "name"],
      hidden: [],
    });
  });

  test("writes a hidden-only layout", () => {
    expect(toJSON({ order: [], hidden: ["labels"] })).toEqual({
      order: [],
      hidden: ["labels"],
    });
  });

  test("copies the arrays rather than aliasing them", () => {
    // The stored value must not change under a later picker edit.
    const preference: ColumnPreference = { order: ["name"], hidden: ["name"] };
    const json: JSONObject | null = toJSON(preference);

    expect(json?.["order"]).not.toBe(preference.order);
    expect(json?.["hidden"]).not.toBe(preference.hidden);
  });
});

describe("fromJSON", () => {
  test("rejects anything that is not a plain object", () => {
    /*
     * The stored value is untrusted: it may have been hand-edited, or written
     * by a release that shaped it differently.
     */
    expect(fromJSON(null)).toBeNull();
    expect(fromJSON(undefined)).toBeNull();
    expect(fromJSON("nope" as unknown as JSONObject)).toBeNull();
    expect(fromJSON(7 as unknown as JSONObject)).toBeNull();
    expect(fromJSON(true as unknown as JSONObject)).toBeNull();
    expect(fromJSON([] as unknown as JSONObject)).toBeNull();
    expect(fromJSON(["name", "labels"] as unknown as JSONObject)).toBeNull();
  });

  test("reads a well-formed layout", () => {
    expect(fromJSON({ order: ["labels", "name"], hidden: ["name"] })).toEqual({
      order: ["labels", "name"],
      hidden: ["name"],
    });
  });

  test("an object with neither list reads as no layout", () => {
    expect(fromJSON({})).toBeNull();
    expect(fromJSON({ order: [], hidden: [] })).toBeNull();
  });

  test("a list that is not an array degrades to empty", () => {
    expect(fromJSON({ order: "labels", hidden: ["name"] })).toEqual({
      order: [],
      hidden: ["name"],
    });
  });

  test("one malformed list does not discard the other", () => {
    // Each list is validated on its own so a single bad key is survivable.
    expect(
      fromJSON({
        order: ["name"],
        hidden: { name: true } as unknown as string,
      }),
    ).toEqual({ order: ["name"], hidden: [] });
  });

  test("non-string entries are dropped", () => {
    expect(
      fromJSON({
        order: ["name", 5, null, true, { a: 1 }, "labels"],
        hidden: [["labels"], "labels"],
      } as unknown as JSONObject),
    ).toEqual({ order: ["name", "labels"], hidden: ["labels"] });
  });

  test("empty-string entries are dropped", () => {
    expect(fromJSON({ order: ["", "name", ""], hidden: [""] })).toEqual({
      order: ["name"],
      hidden: [],
    });
  });

  test("duplicates are dropped within each list independently", () => {
    // The same id in both lists is legitimate: arranged, then switched off.
    expect(
      fromJSON({
        order: ["name", "labels", "name"],
        hidden: ["name", "name"],
      }),
    ).toEqual({ order: ["name", "labels"], hidden: ["name"] });
  });

  test("unknown keys are ignored", () => {
    expect(
      fromJSON({
        order: ["name"],
        hidden: [],
        pinned: ["name"],
        version: 3,
      } as unknown as JSONObject),
    ).toEqual({ order: ["name"], hidden: [] });
  });

  test("a layout that sanitizes down to nothing reads as no layout", () => {
    expect(
      fromJSON({ order: [1, 2], hidden: [""] } as unknown as JSONObject),
    ).toBeNull();
  });
});

describe("ColumnPreference round trip", () => {
  test("survives toJSON -> JSON -> fromJSON unchanged", () => {
    const preference: ColumnPreference = {
      order: ["labels", "name", "customFields.Severity", "description"],
      hidden: ["description"],
    };

    const json: JSONObject | null = toJSON(preference);

    expect(fromJSON(JSON.parse(JSON.stringify(json)))).toEqual(preference);
  });

  test("survives the full picker cycle: columns -> entries -> JSON -> columns", () => {
    const columns: Columns<Monitor> = [
      makeColumn({
        field: { name: true },
        title: "Name",
        isNotCustomizable: true,
      }),
      makeColumn({ field: { description: true }, title: "Description" }),
      makeColumn({ field: { labels: true }, title: "Labels" }),
      makeColumn({
        field: { customFields: true },
        selectedProperty: "Severity",
        title: "Severity",
        isHiddenByDefault: true,
      }),
    ];

    // The viewer drags Severity to the front and switches Description off.
    const edited: Array<CustomizableColumn<Monitor>> = [
      { ...findEntry(getCustomizableColumns<Monitor>({ columns }), "name") },
      {
        ...findEntry(
          getCustomizableColumns<Monitor>({ columns }),
          "customFields.Severity",
        ),
        isVisible: true,
      },
      { ...findEntry(getCustomizableColumns<Monitor>({ columns }), "labels") },
      {
        ...findEntry(
          getCustomizableColumns<Monitor>({ columns }),
          "description",
        ),
        isVisible: false,
      },
    ];

    const stored: JSONObject | null = toJSON(
      buildColumnPreference<Monitor>(edited),
    );

    const restored: ColumnPreference | null = fromJSON(
      JSON.parse(JSON.stringify(stored)),
    );

    expect(
      titlesOf(
        applyColumnPreference<Monitor>({ columns, preference: restored }),
      ),
    ).toEqual(["Name", "Severity", "Labels"]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * The property the whole feature rests on
 * ---------------------------------------------------------------------------
 *
 * A layout is written against one release's column set and read back against
 * another's. Every case below takes ONE stored layout - the one a viewer would
 * plausibly have - and replays it against a changed table. The bar is not
 * "the layout is honoured exactly"; it is "the table is still usable and
 * nothing the viewer did not ask to hide has disappeared".
 */
describe("a stored layout replayed against a changed column set", () => {
  type ReleaseOneColumnsFunction = () => Columns<Monitor>;

  // Name (pinned) | Description | Labels | Severity(custom field)
  const releaseOneColumns: ReleaseOneColumnsFunction = (): Columns<Monitor> => {
    return [
      makeColumn({
        field: { name: true },
        title: "Name",
        isNotCustomizable: true,
      }),
      makeColumn({ field: { description: true }, title: "Description" }),
      makeColumn({ field: { labels: true }, title: "Labels" }),
      makeColumn({
        field: { customFields: true },
        selectedProperty: "Severity",
        title: "Severity",
        isHiddenByDefault: true,
      }),
    ];
  };

  /*
   * What the viewer did: pulled the Severity custom field to the front and
   * switched Labels off.
   */
  const storedPreference: ColumnPreference = {
    order: ["customFields.Severity", "description", "labels"],
    hidden: ["labels"],
  };

  type ReplayFunction = (columns: Columns<Monitor>) => Array<string>;

  const replay: ReplayFunction = (columns: Columns<Monitor>): Array<string> => {
    const sanitized: ColumnPreference | null = sanitizeColumnPreference({
      preference: storedPreference,
      knownColumnIds: getColumnIds<Monitor>(columns),
    });

    return titlesOf(
      applyColumnPreference<Monitor>({ columns, preference: sanitized }),
    );
  };

  test("the layout is honoured when nothing changed", () => {
    expect(replay(releaseOneColumns())).toEqual([
      "Name",
      "Severity",
      "Description",
    ]);
  });

  test("a removed column just falls out; the rest keep their arrangement", () => {
    const columns: Columns<Monitor> = releaseOneColumns().filter(
      (column: Column<Monitor>): boolean => {
        return column.title !== "Labels";
      },
    );

    expect(replay(columns)).toEqual(["Name", "Severity", "Description"]);
  });

  test("a removed CUSTOM FIELD does not drag its neighbours out of order", () => {
    /*
     * Custom fields are deleted by project admins, so this is the most common
     * way a stored id goes stale — much more common than a shipped column
     * being removed.
     */
    const columns: Columns<Monitor> = releaseOneColumns().filter(
      (column: Column<Monitor>): boolean => {
        return column.selectedProperty !== "Severity";
      },
    );

    expect(replay(columns)).toEqual(["Name", "Description"]);
  });

  test("a column added at the start appears there, and visible", () => {
    const columns: Columns<Monitor> = releaseOneColumns();
    columns.splice(1, 0, makeColumn({ field: { slug: true }, title: "Slug" }));

    expect(replay(columns)).toEqual([
      "Name",
      "Slug",
      "Severity",
      "Description",
    ]);
  });

  test("a column added in the middle lands next to its declared predecessor", () => {
    const columns: Columns<Monitor> = releaseOneColumns();
    // Declared between Description and Labels.
    columns.splice(2, 0, makeColumn({ field: { slug: true }, title: "Slug" }));

    expect(replay(columns)).toEqual([
      "Name",
      "Severity",
      "Description",
      "Slug",
    ]);
  });

  test("a column added at the end is visible and does not disturb the layout", () => {
    const columns: Columns<Monitor> = releaseOneColumns();
    columns.push(makeColumn({ field: { monitorType: true }, title: "Type" }));

    const rendered: Array<string> = replay(columns);

    expect(rendered).toContain("Type");
    // Labels stays hidden; the arranged columns keep their relative order.
    expect(rendered).not.toContain("Labels");
    expect(rendered.indexOf("Severity")).toBeLessThan(
      rendered.indexOf("Description"),
    );
  });

  test("a new custom field is offered in the picker but stays switched off", () => {
    /*
     * New custom fields ship hidden by default, and a layout written before
     * they existed says nothing about them — so they stay off until the viewer
     * opts in, rather than widening everyone's table overnight.
     */
    const columns: Columns<Monitor> = releaseOneColumns();
    columns.push(
      makeColumn({
        field: { customFields: true },
        selectedProperty: "Team",
        title: "Team",
        isHiddenByDefault: true,
      }),
    );

    const entries: Array<CustomizableColumn<Monitor>> =
      getCustomizableColumns<Monitor>({
        columns,
        preference: storedPreference,
      });

    // Listed in the picker, so it can be switched on...
    expect(entryIds(entries)).toContain("customFields.Team");
    // ...but off until then.
    expect(findEntry(entries, "customFields.Team").isVisible).toBe(false);
  });

  test("renaming a column does not disturb a layout keyed off its field", () => {
    const columns: Columns<Monitor> = releaseOneColumns().map(
      (column: Column<Monitor>): Column<Monitor> => {
        return column.title === "Description"
          ? { ...column, title: "Summary" }
          : column;
      },
    );

    expect(replay(columns)).toEqual(["Name", "Severity", "Summary"]);
  });

  test("renaming a COLLIDING column loses its layout entry but never the column", () => {
    /*
     * Colliding columns are keyed partly by title, so a rename is a new id.
     * The consequence is bounded on purpose: the entry goes stale, sanitize
     * drops it, and the column comes back as if it were newly shipped —
     * visible. Failing open is the whole point.
     */
    const before: Columns<Monitor> = [
      makeColumn({
        field: { name: true },
        title: "Name",
        isNotCustomizable: true,
      }),
      makeColumn({ field: { _id: true }, title: "Actions" }),
      makeColumn({ field: { _id: true }, title: "Owner" }),
    ];

    const preference: ColumnPreference = {
      order: ["_id:actions", "_id:owner"],
      hidden: ["_id:owner"],
    };

    expect(
      titlesOf(applyColumnPreference<Monitor>({ columns: before, preference })),
    ).toEqual(["Name", "Actions"]);

    const after: Columns<Monitor> = [
      makeColumn({
        field: { name: true },
        title: "Name",
        isNotCustomizable: true,
      }),
      makeColumn({ field: { _id: true }, title: "Actions" }),
      makeColumn({ field: { _id: true }, title: "Owned By" }),
    ];

    const sanitized: ColumnPreference | null = sanitizeColumnPreference({
      preference,
      knownColumnIds: getColumnIds<Monitor>(after),
    });

    expect(sanitized).toEqual({ order: ["_id:actions"], hidden: [] });
    expect(
      titlesOf(
        applyColumnPreference<Monitor>({
          columns: after,
          preference: sanitized,
        }),
      ),
    ).toEqual(["Name", "Actions", "Owned By"]);
  });

  test("a layout whose columns are all gone sanitizes away and the table renders its own defaults", () => {
    const columns: Columns<Monitor> = [
      makeColumn({
        field: { name: true },
        title: "Name",
        isNotCustomizable: true,
      }),
      makeColumn({ field: { monitorType: true }, title: "Type" }),
      makeColumn({ field: { slug: true }, title: "Slug" }),
    ];

    const sanitized: ColumnPreference | null = sanitizeColumnPreference({
      preference: storedPreference,
      knownColumnIds: getColumnIds<Monitor>(columns),
    });

    expect(sanitized).toBeNull();
    expect(
      titlesOf(
        applyColumnPreference<Monitor>({
          columns,
          preference: sanitized,
        }),
      ),
    ).toEqual(["Name", "Type", "Slug"]);
  });

  test("a column that becomes pinned stops obeying the layout that hid it", () => {
    /*
     * Tables do gain a pinned column over time (usually the name). A layout
     * that hid it must not survive that change, or the row would be
     * unidentifiable with no control to fix it.
     */
    const columns: Columns<Monitor> = [
      makeColumn({
        field: { name: true },
        title: "Name",
        isNotCustomizable: true,
      }),
      makeColumn({
        field: { description: true },
        title: "Description",
        isNotCustomizable: true,
      }),
      makeColumn({ field: { labels: true }, title: "Labels" }),
    ];

    expect(
      titlesOf(
        applyColumnPreference<Monitor>({
          columns,
          preference: {
            order: ["labels", "description"],
            hidden: ["description", "labels"],
          },
        }),
      ),
    ).toEqual(["Name", "Description"]);
  });

  test("the whole table changing shape at once still renders something usable", () => {
    // Nothing in common with the layout except the pinned column.
    const columns: Columns<Monitor> = [
      makeColumn({
        field: { name: true },
        title: "Name",
        isNotCustomizable: true,
      }),
      makeColumn({ field: { _id: true }, title: "Actions" }),
      makeColumn({ field: { _id: true }, title: "Actions" }),
      makeColumn({ field: {}, title: "" }),
    ];

    const rendered: Columns<Monitor> = applyColumnPreference<Monitor>({
      columns,
      preference: storedPreference,
    });

    expect(rendered).toHaveLength(4);
    expect(titlesOf(rendered)).toEqual(["Name", "Actions", "Actions", ""]);
  });
});
