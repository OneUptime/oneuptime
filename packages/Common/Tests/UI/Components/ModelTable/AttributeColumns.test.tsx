import Column from "../../../../UI/Components/ModelTable/Column";
import Columns from "../../../../UI/Components/ModelTable/Columns";
import {
  getAttributeColumnId,
  getAttributeColumns,
  getAttributeExportValue,
  getAttributeKeyFromColumnId,
  getAttributeKeysFromColumnPreference,
  getAttributeValue,
  normalizeAttributeKeys,
  renderAttributeValue,
} from "../../../../UI/Components/ModelTable/AttributeColumns";
import {
  ColumnPreference,
  getColumnBaseId,
  getColumnIds,
  getCustomizableColumns,
  CustomizableColumn,
} from "../../../../UI/Components/ModelTable/ColumnPreference";
import FieldType from "../../../../UI/Components/Types/FieldType";
import SecurityEvent from "../../../../Models/AnalyticsModels/SecurityEvent";
import { JSONObject } from "../../../../Types/JSON";
import "@testing-library/jest-dom";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Attribute columns are generated from keys inside a row's Map(String,String)
 * column, which is where every source field the OCSF schema has no typed
 * column for ends up. Almost everything about their shape is load-bearing in a
 * way that fails quietly rather than loudly:
 *
 *  - the declared `field` has to be the REAL map column. A synthetic
 *    `field: { "attributes.x": true }` fails the model's column check in
 *    getSelectFromColumns and throws the whole table away.
 *  - the id has to match what ColumnPreference would derive on its own, or a
 *    stored layout and a live column disagree about which column is which.
 *  - sorting has to stay off: a dotted pseudo-column reaching the query
 *    builder is not something ClickHouse can order by.
 *  - the cell has to render through getElement, because the typed renderers
 *    index item[column.key] and would look for a literal
 *    "attributes.device.hostname" property no row has.
 *
 * And the whole "which columns did the viewer add" question is answered by
 * reading the stored layout back, so that round trip is pinned here too.
 */

const ATTRIBUTES: string = "attributes";

afterEach(() => {
  cleanup();
});

type MakeEventFunction = (attributes: JSONObject | undefined) => SecurityEvent;

const makeEvent: MakeEventFunction = (
  attributes: JSONObject | undefined,
): SecurityEvent => {
  const event: SecurityEvent = new SecurityEvent();
  event.attributes = attributes;
  return event;
};

describe("AttributeColumns - ids", () => {
  test("the id is the map column and the key, joined with a dot", () => {
    expect(
      getAttributeColumnId({
        attributesColumnKey: ATTRIBUTES,
        attributeKey: "device.hostname",
      }),
    ).toBe("attributes.device.hostname");
  });

  test("the id round-trips back to the key", () => {
    const columnId: string = getAttributeColumnId({
      attributesColumnKey: ATTRIBUTES,
      attributeKey: "metadata.product.name",
    });

    expect(
      getAttributeKeyFromColumnId({
        attributesColumnKey: ATTRIBUTES,
        columnId: columnId,
      }),
    ).toBe("metadata.product.name");
  });

  test("an id under a different column, or with no key at all, is not an attribute id", () => {
    expect(
      getAttributeKeyFromColumnId({
        attributesColumnKey: ATTRIBUTES,
        columnId: "customFields.Severity",
      }),
    ).toBeNull();

    // The map column itself is a column, not a column-per-key.
    expect(
      getAttributeKeyFromColumnId({
        attributesColumnKey: ATTRIBUTES,
        columnId: "attributes",
      }),
    ).toBeNull();

    expect(
      getAttributeKeyFromColumnId({
        attributesColumnKey: ATTRIBUTES,
        columnId: "attributes.",
      }),
    ).toBeNull();
  });

  /*
   * The explicit id and the one ColumnPreference derives from field +
   * selectedProperty have to be the same string. If they ever drift, a layout
   * saved by one release stops matching the column in the next.
   */
  test("the explicit id matches what ColumnPreference would derive on its own", () => {
    const [column] = getAttributeColumns<SecurityEvent>({
      attributesColumnKey: ATTRIBUTES,
      attributeKeys: ["device.hostname"],
    });

    const derivedId: string = getColumnBaseId<SecurityEvent>({
      ...(column as Column<SecurityEvent>),
      id: undefined,
    });

    expect(column!.id).toBe(derivedId);
  });

  test("ids stay unique across a generated set", () => {
    const columns: Columns<SecurityEvent> = getAttributeColumns<SecurityEvent>({
      attributesColumnKey: ATTRIBUTES,
      attributeKeys: ["a", "b", "a.b", "c"],
    });

    const ids: Array<string> = getColumnIds<SecurityEvent>(columns);

    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("AttributeColumns - normalizeAttributeKeys", () => {
  test("trims, de-duplicates and sorts", () => {
    expect(
      normalizeAttributeKeys([
        "  user.name  ",
        "device.hostname",
        "user.name",
        "class_uid",
      ]),
    ).toEqual(["class_uid", "device.hostname", "user.name"]);
  });

  test("drops empties and non-strings rather than rendering them as columns", () => {
    expect(
      normalizeAttributeKeys(["", "   ", null, undefined, 42, {}, "ok"]),
    ).toEqual(["ok"]);
  });

  test("anything that is not an array degrades to an empty list", () => {
    expect(normalizeAttributeKeys(null)).toEqual([]);
    expect(normalizeAttributeKeys(undefined)).toEqual([]);
    expect(
      normalizeAttributeKeys("device.hostname" as unknown as Array<unknown>),
    ).toEqual([]);
  });

  test("the same input always produces the same order", () => {
    const first: Array<string> = normalizeAttributeKeys(["b", "a", "c"]);
    const second: Array<string> = normalizeAttributeKeys(["c", "a", "b"]);

    expect(first).toEqual(second);
  });
});

describe("AttributeColumns - reading a value off a row", () => {
  test("reads the key out of the map column", () => {
    expect(
      getAttributeValue({
        item: makeEvent({ "device.hostname": "web-1" }),
        attributesColumnKey: ATTRIBUTES,
        attributeKey: "device.hostname",
      }),
    ).toBe("web-1");
  });

  test("a row with no map, or no such key, has no value", () => {
    expect(
      getAttributeValue({
        item: makeEvent(undefined),
        attributesColumnKey: ATTRIBUTES,
        attributeKey: "device.hostname",
      }),
    ).toBeUndefined();

    expect(
      getAttributeValue({
        item: makeEvent({ "user.name": "bob" }),
        attributesColumnKey: ATTRIBUTES,
        attributeKey: "device.hostname",
      }),
    ).toBeUndefined();

    expect(
      getAttributeValue({
        item: undefined,
        attributesColumnKey: ATTRIBUTES,
        attributeKey: "device.hostname",
      }),
    ).toBeUndefined();
  });

  /*
   * The map is typed Map(String,String) in ClickHouse, but rows also reach
   * this code straight from JSON the API returned, and a project can PUT
   * anything over the ingest API - so a non-string must not throw.
   */
  test("a non-object under the map column is treated as absent", () => {
    expect(
      getAttributeValue({
        item: { attributes: "not-a-map" },
        attributesColumnKey: ATTRIBUTES,
        attributeKey: "device.hostname",
      }),
    ).toBeUndefined();
  });
});

describe("AttributeColumns - export values", () => {
  test("scalars stringify", () => {
    expect(getAttributeExportValue("web-1")).toBe("web-1");
    expect(getAttributeExportValue(3002)).toBe("3002");
    expect(getAttributeExportValue(false)).toBe("false");
  });

  test("null and undefined export as an empty cell, not as the word", () => {
    expect(getAttributeExportValue(null)).toBe("");
    expect(getAttributeExportValue(undefined)).toBe("");
  });

  test("arrays join, objects serialize", () => {
    expect(getAttributeExportValue(["a", "b"])).toBe("a, b");
    expect(getAttributeExportValue({ a: 1 })).toBe('{"a":1}');
  });

  /*
   * An empty string is a real stored value; it just has nothing to show. It
   * must not become the literal text "" in a CSV.
   */
  test("an empty string exports as an empty cell", () => {
    expect(getAttributeExportValue("")).toBe("");
  });
});

describe("AttributeColumns - rendering", () => {
  test("renders the value, with the full text available on hover", () => {
    const { container } = render(
      renderAttributeValue({ value: "web-1.prod.internal" }),
    );

    expect(container.textContent).toBe("web-1.prod.internal");
    expect(container.querySelector("span")).toHaveAttribute(
      "title",
      "web-1.prod.internal",
    );
  });

  test("a missing value renders the placeholder rather than nothing", () => {
    const { container } = render(renderAttributeValue({ value: undefined }));

    expect(container.textContent).toBe("-");
  });

  test("the placeholder is configurable", () => {
    const { container } = render(
      renderAttributeValue({ value: null, noValueMessage: "not set" }),
    );

    expect(container.textContent).toBe("not set");
  });

  test("a nested value renders rather than showing [object Object]", () => {
    const { container } = render(
      renderAttributeValue({ value: { product: "SecOps" } }),
    );

    expect(container.textContent).toBe('{"product":"SecOps"}');
  });
});

describe("AttributeColumns - generated column shape", () => {
  const columns: Columns<SecurityEvent> = getAttributeColumns<SecurityEvent>({
    attributesColumnKey: ATTRIBUTES,
    attributeKeys: ["device.hostname"],
  });

  const column: Column<SecurityEvent> = columns[0] as Column<SecurityEvent>;

  test("declares the real map column as its field", () => {
    /*
     * getSelectFromColumns throws a BadDataException for a field the model
     * does not have, which takes the entire table down - so this has to be a
     * column that exists.
     */
    expect(Object.keys(column.field as JSONObject)).toEqual([ATTRIBUTES]);
    expect(new SecurityEvent().hasColumn(ATTRIBUTES)).toBe(true);
  });

  test("names the key through selectedProperty, not through the field", () => {
    expect(column.selectedProperty).toBe("device.hostname");
  });

  test("titles itself with the raw key, so searching for the key finds it", () => {
    expect(column.title).toBe("device.hostname");
  });

  test("is not sortable", () => {
    expect(column.disableSort).toBe(true);
  });

  test("renders through getElement", () => {
    expect(column.type).toBe(FieldType.Element);
    expect(typeof column.getElement).toBe("function");
  });

  test("is removable, so the picker can take it away again", () => {
    expect(column.isRemovable).toBe(true);
  });

  test("defaults to visible - a column you just added should be on screen", () => {
    expect(column.isHiddenByDefault).toBe(false);
  });

  test("can be generated hidden when a caller wants a checklist instead", () => {
    const [hidden] = getAttributeColumns<SecurityEvent>({
      attributesColumnKey: ATTRIBUTES,
      attributeKeys: ["device.hostname"],
      isHiddenByDefault: true,
    });

    expect(hidden!.isHiddenByDefault).toBe(true);
  });

  test("the cell reads its own key off the row", () => {
    const { container } = render(
      column.getElement!(makeEvent({ "device.hostname": "web-1" })),
    );

    expect(container.textContent).toBe("web-1");
  });

  test("the cell renders the placeholder for a row that lacks the key", () => {
    const { container } = render(
      column.getElement!(makeEvent({ "user.name": "bob" })),
    );

    expect(container.textContent).toBe("-");
  });

  test("the export cell reads the same key the rendered cell does", () => {
    expect(
      column.getExportValue!(makeEvent({ "device.hostname": "web-1" })),
    ).toBe("web-1");

    expect(column.getExportValue!(makeEvent({}))).toBe("");
  });

  test("generates one column per key, in the order given", () => {
    const many: Columns<SecurityEvent> = getAttributeColumns<SecurityEvent>({
      attributesColumnKey: ATTRIBUTES,
      attributeKeys: ["b", "a", "c"],
    });

    expect(
      many.map((entry: Column<SecurityEvent>) => {
        return entry.title;
      }),
    ).toEqual(["b", "a", "c"]);
  });

  test("an empty key list generates nothing", () => {
    expect(
      getAttributeColumns<SecurityEvent>({
        attributesColumnKey: ATTRIBUTES,
        attributeKeys: [],
      }),
    ).toEqual([]);
  });

  /*
   * `isRemovable` has to survive the trip into the picker's model, because
   * that is the only thing that tells the modal to offer a remove button.
   */
  test("isRemovable reaches the picker entry", () => {
    const entries: Array<CustomizableColumn<SecurityEvent>> =
      getCustomizableColumns<SecurityEvent>({ columns, preference: null });

    expect(entries[0]!.isRemovable).toBe(true);
  });

  test("a pinned column is never removable, whatever it declares", () => {
    const entries: Array<CustomizableColumn<SecurityEvent>> =
      getCustomizableColumns<SecurityEvent>({
        columns: [
          {
            ...(column as Column<SecurityEvent>),
            isNotCustomizable: true,
          },
        ],
        preference: null,
      });

    expect(entries[0]!.isPinned).toBe(true);
    expect(entries[0]!.isRemovable).toBe(false);
  });

  test("an ordinary column is not removable", () => {
    const entries: Array<CustomizableColumn<SecurityEvent>> =
      getCustomizableColumns<SecurityEvent>({
        columns: [
          {
            field: { message: true },
            title: "Message",
            type: FieldType.Text,
          },
        ],
        preference: null,
      });

    expect(entries[0]!.isRemovable).toBe(false);
  });
});

describe("AttributeColumns - recovering the viewer's keys from a stored layout", () => {
  /*
   * There is no second store for "which attribute columns did they add": a
   * column exists precisely when its id is in the layout. Everything below
   * pins that recovery, because a bug here silently loses columns someone
   * chose, or invents ones they did not.
   */
  test("no stored layout means no attribute columns", () => {
    expect(
      getAttributeKeysFromColumnPreference({
        preference: null,
        attributesColumnKey: ATTRIBUTES,
      }),
    ).toEqual([]);

    expect(
      getAttributeKeysFromColumnPreference({
        preference: undefined,
        attributesColumnKey: ATTRIBUTES,
      }),
    ).toEqual([]);
  });

  test("picks the attribute ids out of the order list, in order", () => {
    const preference: ColumnPreference = {
      order: [
        "time",
        "attributes.device.hostname",
        "severityName",
        "attributes.class_uid",
      ],
      hidden: [],
    };

    expect(
      getAttributeKeysFromColumnPreference({
        preference,
        attributesColumnKey: ATTRIBUTES,
      }),
    ).toEqual(["device.hostname", "class_uid"]);
  });

  /*
   * A viewer who switched an attribute column off still chose it. Losing it
   * here would make "hide" behave like "remove", but only after a reload.
   */
  test("a hidden attribute column is still a column", () => {
    expect(
      getAttributeKeysFromColumnPreference({
        preference: {
          order: ["time", "attributes.device.hostname"],
          hidden: ["attributes.device.hostname"],
        },
        attributesColumnKey: ATTRIBUTES,
      }),
    ).toEqual(["device.hostname"]);
  });

  /*
   * buildColumnPreference always writes both lists, but a payload from an
   * older release - or one hand-edited in devtools - may only carry `hidden`.
   */
  test("an id that appears only in hidden is still recovered", () => {
    expect(
      getAttributeKeysFromColumnPreference({
        preference: { order: [], hidden: ["attributes.device.hostname"] },
        attributesColumnKey: ATTRIBUTES,
      }),
    ).toEqual(["device.hostname"]);
  });

  test("the same key listed twice produces one column", () => {
    expect(
      getAttributeKeysFromColumnPreference({
        preference: {
          order: ["attributes.a", "attributes.a"],
          hidden: ["attributes.a"],
        },
        attributesColumnKey: ATTRIBUTES,
      }),
    ).toEqual(["a"]);
  });

  test("ids belonging to declared columns are left alone", () => {
    expect(
      getAttributeKeysFromColumnPreference({
        preference: { order: ["attributes.device.hostname"], hidden: [] },
        attributesColumnKey: ATTRIBUTES,
        reservedColumnIds: ["attributes.device.hostname"],
      }),
    ).toEqual([]);
  });

  test("custom field ids are not mistaken for attribute ids", () => {
    expect(
      getAttributeKeysFromColumnPreference({
        preference: {
          order: ["customFields.Severity", "attributes.user.name"],
          hidden: [],
        },
        attributesColumnKey: ATTRIBUTES,
      }),
    ).toEqual(["user.name"]);
  });

  test("a different map column name is honoured", () => {
    expect(
      getAttributeKeysFromColumnPreference({
        preference: { order: ["resourceAttributes.host.name"], hidden: [] },
        attributesColumnKey: "resourceAttributes",
      }),
    ).toEqual(["host.name"]);
  });

  /*
   * The full round trip: keys -> columns -> ids -> a stored layout -> keys.
   * This is the loop the feature actually runs every page load.
   */
  test("keys survive the round trip through generated columns and back", () => {
    const keys: Array<string> = ["device.hostname", "finding_info.title"];

    const columns: Columns<SecurityEvent> = getAttributeColumns<SecurityEvent>({
      attributesColumnKey: ATTRIBUTES,
      attributeKeys: keys,
    });

    const preference: ColumnPreference = {
      order: getColumnIds<SecurityEvent>(columns),
      hidden: [],
    };

    expect(
      getAttributeKeysFromColumnPreference({
        preference,
        attributesColumnKey: ATTRIBUTES,
      }),
    ).toEqual(keys);
  });
});
