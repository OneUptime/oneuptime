import Column from "../../../../UI/Components/ModelTable/Column";
import Columns from "../../../../UI/Components/ModelTable/Columns";
import {
  CustomFieldDefinition,
  CustomFieldsColumnKey,
  getCustomFieldColumns,
  getCustomFieldDefinitions,
  getCustomFieldValue,
  parseDropdownOptions,
  renderCustomFieldValue,
} from "../../../../UI/Components/ModelTable/CustomFieldColumns";
import FieldType from "../../../../UI/Components/Types/FieldType";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorCustomField from "../../../../Models/DatabaseModels/MonitorCustomField";
import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import { JSONObject } from "../../../../Types/JSON";
import "@testing-library/jest-dom/extend-expect";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Custom field *definitions* live in a per-resource table; the *values* live in
 * one `customFields` jsonb column on the resource. This module turns the former
 * into table columns that read the latter, and the exact shape it produces is
 * load-bearing in several places that will not complain loudly when it is
 * wrong - the table either throws on select, sends garbage to TypeORM, or
 * silently renders every cell blank. Each shape rule below is pinned with a
 * note about what breaks if it changes.
 */

const textDefinition: CustomFieldDefinition = {
  name: "Owner",
  customFieldType: CustomFieldType.Text,
};

const booleanDefinition: CustomFieldDefinition = {
  name: "Paging",
  customFieldType: CustomFieldType.Boolean,
};

const dropdownDefinition: CustomFieldDefinition = {
  name: "Severity",
  customFieldType: CustomFieldType.Dropdown,
  dropdownOptions: "Low\nHigh",
};

const coloredDropdownDefinition: CustomFieldDefinition = {
  name: "Severity",
  customFieldType: CustomFieldType.Dropdown,
  dropdownOptions:
    '[{"value":"Low","color":"#22c55e"},{"value":"High","color":"#ef4444"}]',
};

const multiSelectDefinition: CustomFieldDefinition = {
  name: "Teams",
  customFieldType: CustomFieldType.MultiSelectDropdown,
  dropdownOptions: "Infra\nApps",
};

type RenderValueFunction = (data: {
  value: unknown;
  definition: CustomFieldDefinition;
  noValueMessage?: string | undefined;
}) => HTMLElement;

const renderValue: RenderValueFunction = (data: {
  value: unknown;
  definition: CustomFieldDefinition;
  noValueMessage?: string | undefined;
}): HTMLElement => {
  const { container } = render(<>{renderCustomFieldValue(data)}</>);

  return container;
};

/*
 * Every badge is the same markup - an indigo pill with a dot - so counting the
 * pills is how we tell "one badge holding a comma list" apart from "one badge
 * per value".
 */
type GetBadgeLabelsFunction = (container: HTMLElement) => Array<string>;

const getBadgeLabels: GetBadgeLabelsFunction = (
  container: HTMLElement,
): Array<string> => {
  return Array.from(container.querySelectorAll("span.bg-indigo-50")).map(
    (element: Element): string => {
      return (element.textContent || "").trim();
    },
  );
};

type GetPlaceholderFunction = (container: HTMLElement) => Element | null;

const getPlaceholder: GetPlaceholderFunction = (
  container: HTMLElement,
): Element | null => {
  return container.querySelector("span.text-gray-400");
};

const requireElement: (
  element: HTMLElement | null | undefined,
) => HTMLElement = (element: HTMLElement | null | undefined): HTMLElement => {
  if (!element) {
    throw new Error("Expected custom field value badge to be rendered");
  }

  return element;
};

type ColumnAtFunction = (
  columns: Columns<Monitor>,
  index: number,
) => Column<Monitor>;

const columnAt: ColumnAtFunction = (
  columns: Columns<Monitor>,
  index: number,
): Column<Monitor> => {
  const column: Column<Monitor> | undefined = columns[index];

  if (!column) {
    throw new Error(`Expected a generated column at index ${index}`);
  }

  return column;
};

type ExportValueOfFunction = (column: Column<Monitor>, item: Monitor) => string;

const exportValueOf: ExportValueOfFunction = (
  column: Column<Monitor>,
  item: Monitor,
): string => {
  if (!column.getExportValue) {
    throw new Error(`Column "${column.title}" has no getExportValue`);
  }

  return column.getExportValue(item);
};

type RenderColumnFunction = (
  column: Column<Monitor>,
  item: Monitor,
) => HTMLElement;

const renderColumn: RenderColumnFunction = (
  column: Column<Monitor>,
  item: Monitor,
): HTMLElement => {
  if (!column.getElement) {
    throw new Error(`Column "${column.title}" has no getElement`);
  }

  const { container } = render(<>{column.getElement(item)}</>);

  return container;
};

type MonitorWithFieldsFunction = (customFields: JSONObject) => Monitor;

const monitorWithFields: MonitorWithFieldsFunction = (
  customFields: JSONObject,
): Monitor => {
  const monitor: Monitor = new Monitor();
  monitor.customFields = customFields;

  return monitor;
};

afterEach(() => {
  cleanup();
});

describe("CustomFieldColumns.parseDropdownOptions", () => {
  test("splits the stored blob into one option per line", () => {
    /*
     * The settings page writes dropdown options as a textarea blob, so the
     * newline is the only separator there is - a comma is a legal character
     * inside an option label.
     */
    expect(parseDropdownOptions("Low\nMedium\nHigh")).toEqual([
      { value: "Low" },
      { value: "Medium" },
      { value: "High" },
    ]);
  });

  test("trims each option", () => {
    expect(parseDropdownOptions("  Low  \n\tHigh\t")).toEqual([
      { value: "Low" },
      { value: "High" },
    ]);
  });

  test("drops blank and whitespace-only lines", () => {
    // A trailing newline in the textarea must not become an empty option.
    expect(parseDropdownOptions("Low\n\n   \nHigh\n")).toEqual([
      { value: "Low" },
      { value: "High" },
    ]);
  });

  test("returns an empty list for a blob that is only whitespace", () => {
    expect(parseDropdownOptions("\n \n\t\n")).toEqual([]);
  });

  test("returns the single option when the blob has no newline at all", () => {
    expect(parseDropdownOptions("Low")).toEqual([{ value: "Low" }]);
  });

  test("parses colors from the structured representation", () => {
    expect(
      parseDropdownOptions(
        '[{"value":"Low","color":"#22c55e"},{"value":"High","color":"#ef4444"}]',
      ),
    ).toEqual([
      { value: "Low", color: "#22c55e" },
      { value: "High", color: "#ef4444" },
    ]);
  });

  test("returns an empty list for empty, null, undefined and non-string input", () => {
    // The column is nullable and the API is free to hand back anything.
    expect(parseDropdownOptions("")).toEqual([]);
    expect(parseDropdownOptions(null)).toEqual([]);
    expect(parseDropdownOptions(undefined)).toEqual([]);
    expect(parseDropdownOptions(42 as unknown as string)).toEqual([]);
    expect(parseDropdownOptions({} as unknown as string)).toEqual([]);
    expect(parseDropdownOptions([] as unknown as string)).toEqual([]);
  });
});

describe("CustomFieldColumns.getCustomFieldDefinitions", () => {
  test("normalises a plain JSON object off the definitions endpoint", () => {
    expect(
      getCustomFieldDefinitions([
        {
          name: "Severity",
          description: "How bad it is",
          customFieldType: CustomFieldType.Dropdown,
          dropdownOptions: "Low\nHigh",
        },
      ]),
    ).toEqual([
      {
        name: "Severity",
        description: "How bad it is",
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: "Low\nHigh",
      },
    ]);
  });

  test("normalises a hydrated BaseModel the same way", () => {
    /*
     * ModelAPI hands back model instances, not plain JSON, and the hook feeds
     * them in unchanged.
     */
    const model: MonitorCustomField = new MonitorCustomField();
    model.name = "Severity";
    model.description = "How bad it is";
    model.customFieldType = CustomFieldType.Dropdown;
    model.dropdownOptions = "Low\nHigh";

    expect(getCustomFieldDefinitions([model])).toEqual([
      {
        name: "Severity",
        description: "How bad it is",
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: "Low\nHigh",
      },
    ]);
  });

  test("leaves the optional properties undefined when they are absent", () => {
    expect(getCustomFieldDefinitions([{ name: "Owner" }])).toEqual([
      {
        name: "Owner",
        description: undefined,
        customFieldType: undefined,
        dropdownOptions: undefined,
      },
    ]);
  });

  test("drops non-string description, type and options rather than passing them through", () => {
    /*
     * A number sitting in `description` would end up as a column tooltip, and
     * a non-string type would silently miss every renderer branch.
     */
    expect(
      getCustomFieldDefinitions([
        {
          name: "Owner",
          description: 42,
          customFieldType: 7,
          dropdownOptions: ["Low", "High"],
        },
      ]),
    ).toEqual([
      {
        name: "Owner",
        description: undefined,
        customFieldType: undefined,
        dropdownOptions: undefined,
      },
    ]);
  });

  test("skips an entry with no name", () => {
    // The name is the jsonb key; without one there is nothing to read.
    expect(getCustomFieldDefinitions([{ description: "orphan" }])).toEqual([]);
  });

  test("skips an entry whose name is not a string", () => {
    expect(
      getCustomFieldDefinitions([
        { name: 42 },
        { name: null },
        { name: { first: "Severity" } },
        { name: ["Severity"] },
      ]),
    ).toEqual([]);
  });

  test("skips an entry whose name is empty or whitespace-only", () => {
    expect(
      getCustomFieldDefinitions([
        { name: "" },
        { name: "   " },
        { name: "\n" },
      ]),
    ).toEqual([]);
  });

  test("keeps the good entries alongside the skipped ones", () => {
    expect(
      getCustomFieldDefinitions([
        { name: "Owner" },
        { name: "  " },
        { description: "no name here" },
        { name: "Severity" },
      ]).map((definition: CustomFieldDefinition): string => {
        return definition.name;
      }),
    ).toEqual(["Owner", "Severity"]);
  });

  test("trims the name", () => {
    /*
     * The trimmed name becomes the column id and the jsonb key lookup, so a
     * stray space would produce a column that never matches a value.
     */
    expect(
      getCustomFieldDefinitions([{ name: "  Severity  " }])[0]?.name,
    ).toEqual("Severity");
  });

  test("de-duplicates by name, keeping the first entry", () => {
    /*
     * Two definitions with the same name would generate two columns with the
     * same id, and the preference layer keys on that id.
     */
    expect(
      getCustomFieldDefinitions([
        { name: "Severity", description: "first" },
        { name: "Severity", description: "second" },
      ]),
    ).toEqual([
      {
        name: "Severity",
        description: "first",
        customFieldType: undefined,
        dropdownOptions: undefined,
      },
    ]);
  });

  test("de-duplicates after trimming, not before", () => {
    expect(
      getCustomFieldDefinitions([{ name: "Severity" }, { name: " Severity " }]),
    ).toHaveLength(1);
  });

  test("sorts by name", () => {
    /*
     * This is the load-bearing one. The definition models carry no ordering
     * column and the list endpoint is queried with an empty sort, so Postgres
     * may hand back a different order on every request. Without a
     * deterministic order here the viewer's saved column layout would appear
     * to shuffle itself between page loads.
     */
    expect(
      getCustomFieldDefinitions([
        { name: "Zone" },
        { name: "Alpha" },
        { name: "Middle" },
      ]).map((definition: CustomFieldDefinition): string => {
        return definition.name;
      }),
    ).toEqual(["Alpha", "Middle", "Zone"]);
  });

  test("sorts case-insensitively the way a human reads the picker", () => {
    // localeCompare, not a raw code point compare: "apple" sorts before "Banana".
    expect(
      getCustomFieldDefinitions([
        { name: "Banana" },
        { name: "apple" },
        { name: "Cherry" },
      ]).map((definition: CustomFieldDefinition): string => {
        return definition.name;
      }),
    ).toEqual(["apple", "Banana", "Cherry"]);
  });

  test("sorts on the trimmed name", () => {
    expect(
      getCustomFieldDefinitions([{ name: "  Zone" }, { name: "Alpha  " }]).map(
        (definition: CustomFieldDefinition): string => {
          return definition.name;
        },
      ),
    ).toEqual(["Alpha", "Zone"]);
  });

  test("returns an empty list for an empty or missing input", () => {
    expect(getCustomFieldDefinitions([])).toEqual([]);
    expect(
      getCustomFieldDefinitions(undefined as unknown as Array<JSONObject>),
    ).toEqual([]);
    expect(
      getCustomFieldDefinitions(null as unknown as Array<JSONObject>),
    ).toEqual([]);
  });

  test("survives null and undefined entries inside the list", () => {
    expect(
      getCustomFieldDefinitions([
        null as unknown as JSONObject,
        undefined as unknown as JSONObject,
        { name: "Owner" },
      ]),
    ).toHaveLength(1);
  });
});

describe("CustomFieldColumns.getCustomFieldValue", () => {
  test("reads the named key out of the customFields object", () => {
    expect(
      getCustomFieldValue({ customFields: { Severity: "High" } }, "Severity"),
    ).toEqual("High");
  });

  test("reads a value off a hydrated model", () => {
    expect(
      getCustomFieldValue(monitorWithFields({ Owner: "SRE" }), "Owner"),
    ).toEqual("SRE");
  });

  test("preserves the raw value type", () => {
    /*
     * The renderer branches on the value's type, so this must not stringify
     * on the way out.
     */
    expect(
      getCustomFieldValue({ customFields: { Paging: false } }, "Paging"),
    ).toBe(false);
    expect(getCustomFieldValue({ customFields: { Count: 0 } }, "Count")).toBe(
      0,
    );
    expect(
      getCustomFieldValue({ customFields: { Teams: ["Infra"] } }, "Teams"),
    ).toEqual(["Infra"]);
  });

  test("returns undefined when the row carries no customFields", () => {
    /*
     * The column is only selected when at least one definition exists, and a
     * row that has never been edited has a null jsonb column.
     */
    expect(getCustomFieldValue({}, "Severity")).toBeUndefined();
    expect(
      getCustomFieldValue({ customFields: null }, "Severity"),
    ).toBeUndefined();
    expect(
      getCustomFieldValue({ customFields: undefined }, "Severity"),
    ).toBeUndefined();
    expect(getCustomFieldValue(new Monitor(), "Severity")).toBeUndefined();
  });

  test("returns undefined when customFields is not an object", () => {
    expect(
      getCustomFieldValue({ customFields: "High" }, "Severity"),
    ).toBeUndefined();
    expect(
      getCustomFieldValue({ customFields: 42 }, "Severity"),
    ).toBeUndefined();
    expect(
      getCustomFieldValue({ customFields: true }, "Severity"),
    ).toBeUndefined();
  });

  test("returns undefined when the key is absent", () => {
    // A field added after the row was last saved.
    expect(
      getCustomFieldValue({ customFields: { Owner: "SRE" } }, "Severity"),
    ).toBeUndefined();
  });

  test("returns undefined for a missing or non-object row", () => {
    expect(getCustomFieldValue(undefined, "Severity")).toBeUndefined();
    expect(getCustomFieldValue(null, "Severity")).toBeUndefined();
  });
});

describe("CustomFieldColumns.getCustomFieldColumns", () => {
  test("generates one column per definition, in the order given", () => {
    const columns: Columns<Monitor> = getCustomFieldColumns<Monitor>({
      definitions: [textDefinition, dropdownDefinition],
    });

    expect(columns).toHaveLength(2);
    expect(
      columns.map((column: Column<Monitor>): string => {
        return column.title;
      }),
    ).toEqual(["Owner", "Severity"]);
  });

  test("declares the real model column as its field", () => {
    /*
     * A synthetic `field: { "customFields.Severity": true }` would fail the
     * model's column check inside getSelectFromColumns and throw the whole
     * table away, so the declared field has to be exactly the jsonb column.
     */
    const column: Column<Monitor> = columnAt(
      getCustomFieldColumns<Monitor>({ definitions: [dropdownDefinition] }),
      0,
    );

    expect(column.field).toEqual({ customFields: true });
    expect(Object.keys(column.field as JSONObject)).toEqual([
      CustomFieldsColumnKey,
    ]);
  });

  test("puts the definition name in selectedProperty", () => {
    /*
     * BaseModelTable joins field + selectedProperty into the column key
     * "customFields.<name>"; without selectedProperty every custom field
     * column would collapse onto the same key.
     */
    const column: Column<Monitor> = columnAt(
      getCustomFieldColumns<Monitor>({ definitions: [dropdownDefinition] }),
      0,
    );

    expect(column.selectedProperty).toEqual("Severity");
  });

  test("always disables sorting", () => {
    /*
     * Nothing downstream validates `sort` before it reaches TypeORM, so a
     * clickable header here would send an unknown property into the query
     * builder. Postgres can only order by a jsonb key through an explicit ->>
     * expression, which the sort path has no concept of.
     */
    const columns: Columns<Monitor> = getCustomFieldColumns<Monitor>({
      definitions: [
        textDefinition,
        booleanDefinition,
        dropdownDefinition,
        multiSelectDefinition,
      ],
    });

    for (const column of columns) {
      expect(column.disableSort).toBe(true);
    }
  });

  test("gives the column a stable id derived from the field name", () => {
    /*
     * The id is what the saved preference stores. Deriving it from the title
     * (as untagged columns do) would be the same string today but would drift
     * the moment anything about the title changes.
     */
    const columns: Columns<Monitor> = getCustomFieldColumns<Monitor>({
      definitions: [dropdownDefinition, multiSelectDefinition],
    });

    expect(
      columns.map((column: Column<Monitor>): string | undefined => {
        return column.id;
      }),
    ).toEqual(["customFields.Severity", "customFields.Teams"]);
  });

  test("produces the same id for the same definition every time", () => {
    const first: Columns<Monitor> = getCustomFieldColumns<Monitor>({
      definitions: [dropdownDefinition],
    });
    const second: Columns<Monitor> = getCustomFieldColumns<Monitor>({
      definitions: [dropdownDefinition],
      isHiddenByDefault: false,
    });

    expect(columnAt(first, 0).id).toEqual(columnAt(second, 0).id);
  });

  test("hides custom field columns by default", () => {
    /*
     * A project is free to define a dozen custom fields, and turning every one
     * on by default would push the columns the table was designed around off
     * the side of the screen the first time anyone opens it.
     */
    const columns: Columns<Monitor> = getCustomFieldColumns<Monitor>({
      definitions: [textDefinition, dropdownDefinition],
    });

    for (const column of columns) {
      expect(column.isHiddenByDefault).toBe(true);
    }
  });

  test("stays hidden when isHiddenByDefault is passed explicitly or as undefined", () => {
    expect(
      columnAt(
        getCustomFieldColumns<Monitor>({
          definitions: [textDefinition],
          isHiddenByDefault: true,
        }),
        0,
      ).isHiddenByDefault,
    ).toBe(true);

    expect(
      columnAt(
        getCustomFieldColumns<Monitor>({
          definitions: [textDefinition],
          isHiddenByDefault: undefined,
        }),
        0,
      ).isHiddenByDefault,
    ).toBe(true);
  });

  test("can be asked to show the columns instead", () => {
    // Only an explicit `false` opts in - a caller that wants them visible.
    const columns: Columns<Monitor> = getCustomFieldColumns<Monitor>({
      definitions: [textDefinition, dropdownDefinition],
      isHiddenByDefault: false,
    });

    for (const column of columns) {
      expect(column.isHiddenByDefault).toBe(false);
    }
  });

  test("takes the title and description from the definition", () => {
    const column: Column<Monitor> = columnAt(
      getCustomFieldColumns<Monitor>({
        definitions: [
          {
            name: "Severity",
            description: "How bad it is",
            customFieldType: CustomFieldType.Dropdown,
          },
        ],
      }),
      0,
    );

    expect(column.title).toEqual("Severity");
    expect(column.description).toEqual("How bad it is");
  });

  test("leaves the description undefined when the definition has none", () => {
    expect(
      columnAt(
        getCustomFieldColumns<Monitor>({ definitions: [textDefinition] }),
        0,
      ).description,
    ).toBeUndefined();
  });

  test("declares itself as an Element column", () => {
    expect(
      columnAt(
        getCustomFieldColumns<Monitor>({ definitions: [textDefinition] }),
        0,
      ).type,
    ).toEqual(FieldType.Element);
  });

  test("gives every column a getElement", () => {
    /*
     * The typed cell renderers index item[column.key] directly, so with a
     * dotted key like "customFields.Severity" they would look for a literal
     * property of that name and find nothing. Only getElement can reach into
     * the jsonb object.
     */
    const columns: Columns<Monitor> = getCustomFieldColumns<Monitor>({
      definitions: [
        textDefinition,
        booleanDefinition,
        dropdownDefinition,
        multiSelectDefinition,
      ],
    });

    for (const column of columns) {
      expect(typeof column.getElement).toEqual("function");
    }
  });

  test("exports a plain string for a text value", () => {
    /*
     * The CSV export walks the same dotted key and would come back empty
     * without an explicit getExportValue.
     */
    const column: Column<Monitor> = columnAt(
      getCustomFieldColumns<Monitor>({ definitions: [textDefinition] }),
      0,
    );

    expect(exportValueOf(column, monitorWithFields({ Owner: "SRE" }))).toEqual(
      "SRE",
    );
  });

  test("exports non-string scalars through String()", () => {
    const columns: Columns<Monitor> = getCustomFieldColumns<Monitor>({
      definitions: [booleanDefinition, { name: "Count" }],
    });

    /*
     * A zero and a false have to survive the export: the "" fallback is only
     * for undefined and null, so these go through String() like any other
     * scalar.
     */
    expect(
      exportValueOf(columnAt(columns, 0), monitorWithFields({ Paging: false })),
    ).toEqual("false");
    expect(
      exportValueOf(columnAt(columns, 1), monitorWithFields({ Count: 0 })),
    ).toEqual("0");
  });

  test("joins an array value for the CSV cell", () => {
    const column: Column<Monitor> = columnAt(
      getCustomFieldColumns<Monitor>({ definitions: [multiSelectDefinition] }),
      0,
    );

    expect(
      exportValueOf(column, monitorWithFields({ Teams: ["Infra", "Apps"] })),
    ).toEqual("Infra, Apps");
  });

  test("JSON-stringifies an object value for the CSV cell", () => {
    const column: Column<Monitor> = columnAt(
      getCustomFieldColumns<Monitor>({ definitions: [textDefinition] }),
      0,
    );

    expect(
      exportValueOf(column, monitorWithFields({ Owner: { team: "SRE" } })),
    ).toEqual('{"team":"SRE"}');
  });

  test("exports an empty string when the value is missing", () => {
    /*
     * An empty cell, not the literal "undefined", which is what String()
     * would have produced.
     */
    const column: Column<Monitor> = columnAt(
      getCustomFieldColumns<Monitor>({ definitions: [textDefinition] }),
      0,
    );

    expect(exportValueOf(column, new Monitor())).toEqual("");
    expect(exportValueOf(column, monitorWithFields({}))).toEqual("");
    expect(exportValueOf(column, monitorWithFields({ Owner: null }))).toEqual(
      "",
    );
  });

  test("returns no columns for an empty or missing definition list", () => {
    /*
     * A resource with no custom fields must contribute nothing at all, or the
     * picker grows an empty section.
     */
    expect(getCustomFieldColumns<Monitor>({ definitions: [] })).toEqual([]);
    expect(
      getCustomFieldColumns<Monitor>({
        definitions: undefined as unknown as Array<CustomFieldDefinition>,
      }),
    ).toEqual([]);
  });
});

describe("CustomFieldColumns.renderCustomFieldValue", () => {
  test("renders a text value as-is", () => {
    expect(
      renderValue({ value: "SRE", definition: textDefinition }).textContent,
    ).toEqual("SRE");
  });

  test("renders a number value", () => {
    expect(
      renderValue({
        value: 42,
        definition: { name: "Count", customFieldType: CustomFieldType.Number },
      }).textContent,
    ).toEqual("42");
  });

  test("renders a zero rather than treating it as missing", () => {
    // 0 is a real answer; only undefined, null and "" are missing.
    const container: HTMLElement = renderValue({
      value: 0,
      definition: { name: "Count", customFieldType: CustomFieldType.Number },
    });

    expect(container.textContent).toEqual("0");
    expect(getPlaceholder(container)).toBeNull();
  });

  test("renders a false boolean as 'No', not as the empty placeholder", () => {
    /*
     * The whole reason the boolean branch sits above the empty check: `false`
     * is a real answer to a yes/no field, and rendering it as "-" would read
     * as "nobody has filled this in".
     */
    const container: HTMLElement = renderValue({
      value: false,
      definition: booleanDefinition,
    });

    expect(container.textContent).toEqual("No");
    expect(getPlaceholder(container)).toBeNull();
  });

  test("renders a true boolean as 'Yes'", () => {
    expect(
      renderValue({ value: true, definition: booleanDefinition }).textContent,
    ).toEqual("Yes");
  });

  test("renders the string forms of a boolean", () => {
    /*
     * jsonb round-trips through a form that posts strings, so both shapes are
     * in the wild.
     */
    expect(
      renderValue({ value: "true", definition: booleanDefinition }).textContent,
    ).toEqual("Yes");
    expect(
      renderValue({ value: "false", definition: booleanDefinition })
        .textContent,
    ).toEqual("No");
  });

  test("treats anything else on a boolean field as 'No'", () => {
    expect(
      renderValue({ value: "maybe", definition: booleanDefinition })
        .textContent,
    ).toEqual("No");
    expect(
      renderValue({ value: 1, definition: booleanDefinition }).textContent,
    ).toEqual("No");
  });

  test("styles Yes and No differently", () => {
    expect(
      renderValue({
        value: true,
        definition: booleanDefinition,
      }).querySelector("span.bg-green-50"),
    ).not.toBeNull();
    expect(
      renderValue({
        value: false,
        definition: booleanDefinition,
      }).querySelector("span.bg-gray-50"),
    ).not.toBeNull();
  });

  test("still shows the placeholder for a boolean nobody answered", () => {
    // Missing is missing - the boolean branch only claims real values.
    expect(
      getPlaceholder(
        renderValue({ value: undefined, definition: booleanDefinition }),
      ),
    ).not.toBeNull();
  });

  test("renders a dropdown value as a single badge", () => {
    const container: HTMLElement = renderValue({
      value: "High",
      definition: dropdownDefinition,
    });

    expect(getBadgeLabels(container)).toEqual(["High"]);
  });

  test("renders a dropdown value with its configured color", () => {
    const container: HTMLElement = renderValue({
      value: "High",
      definition: coloredDropdownDefinition,
    });
    const badgeElement: HTMLElement | null = container.querySelector(
      '[data-dropdown-value-badge="true"]',
    );

    expect(badgeElement).not.toBeNull();
    expect(requireElement(badgeElement).textContent).toContain("High");
    expect(requireElement(badgeElement).style.backgroundColor).toEqual(
      "rgb(239, 68, 68)",
    );
    expect(requireElement(badgeElement).style.borderColor).toEqual("#ef4444");
    expect(
      requireElement(badgeElement).getAttribute("data-dropdown-value-color"),
    ).toEqual("#ef4444");
    expect(requireElement(badgeElement).style.color).toEqual(
      "rgb(249, 250, 251)",
    );
  });

  test("uses dark text on a light dropdown color", () => {
    const container: HTMLElement = renderValue({
      value: "Low",
      definition: {
        ...coloredDropdownDefinition,
        dropdownOptions: '[{"value":"Low","color":"#fef08a"}]',
      },
    });

    expect(
      requireElement(
        container.querySelector<HTMLElement>(
          '[data-dropdown-value-badge="true"]',
        ),
      ).style.color,
    ).toEqual("rgb(17, 24, 39)");
  });

  test("falls back to the uncolored badge for a saved value no longer in the options", () => {
    const container: HTMLElement = renderValue({
      value: "Critical",
      definition: coloredDropdownDefinition,
    });
    const badgeElement: HTMLElement | null = container.querySelector(
      '[data-dropdown-value-badge="true"]',
    );

    expect(
      requireElement(badgeElement).classList.contains("bg-indigo-50"),
    ).toBe(true);
    expect(
      requireElement(badgeElement).getAttribute("data-dropdown-value-color"),
    ).toBeNull();
  });

  test("renders one badge per multi-select value", () => {
    /*
     * One badge each rather than a single comma-joined badge: the table reads
     * as a set of tags, which is what a multi-select is.
     */
    const container: HTMLElement = renderValue({
      value: ["Infra", "Apps"],
      definition: multiSelectDefinition,
    });

    expect(getBadgeLabels(container)).toEqual(["Infra", "Apps"]);
  });

  test("applies each configured color to the matching multi-select value", () => {
    const container: HTMLElement = renderValue({
      value: ["Infra", "Apps", "Legacy"],
      definition: {
        ...multiSelectDefinition,
        dropdownOptions:
          '[{"value":"Infra","color":"#0ea5e9"},{"value":"Apps","color":"#a855f7"}]',
      },
    });
    const badges: Array<HTMLElement> = Array.from(
      container.querySelectorAll<HTMLElement>(
        '[data-dropdown-value-badge="true"]',
      ),
    );

    expect(badges).toHaveLength(3);
    expect(requireElement(badges[0]).style.backgroundColor).toEqual(
      "rgb(14, 165, 233)",
    );
    expect(requireElement(badges[1]).style.backgroundColor).toEqual(
      "rgb(168, 85, 247)",
    );
    expect(requireElement(badges[2]).classList.contains("bg-indigo-50")).toBe(
      true,
    );
  });

  test("renders a bare string on a multi-select field as one badge", () => {
    /*
     * Tolerant on the way out: a value saved while the field was a
     * single-select is still a bare string in the jsonb after someone switches
     * the field type, and it must not render as one badge per character.
     */
    const container: HTMLElement = renderValue({
      value: "Infra",
      definition: multiSelectDefinition,
    });

    expect(getBadgeLabels(container)).toEqual(["Infra"]);
  });

  test("drops empty entries out of a multi-select array", () => {
    const container: HTMLElement = renderValue({
      value: ["Infra", "", null, undefined, "Apps"],
      definition: multiSelectDefinition,
    });

    expect(getBadgeLabels(container)).toEqual(["Infra", "Apps"]);
  });

  test("stringifies non-string multi-select entries", () => {
    expect(
      getBadgeLabels(
        renderValue({ value: [1, 2], definition: multiSelectDefinition }),
      ),
    ).toEqual(["1", "2"]);
  });

  test("renders the placeholder for an empty multi-select array", () => {
    /*
     * An empty array is not caught by the `value === ""` check above, so the
     * multi-select branch has to fall back to the placeholder itself.
     */
    const container: HTMLElement = renderValue({
      value: [],
      definition: multiSelectDefinition,
    });

    expect(getBadgeLabels(container)).toEqual([]);
    expect(getPlaceholder(container)).not.toBeNull();
    expect(container.textContent).toEqual("-");
  });

  test("renders the placeholder when every multi-select entry is empty", () => {
    const container: HTMLElement = renderValue({
      value: ["", null],
      definition: multiSelectDefinition,
    });

    expect(getPlaceholder(container)).not.toBeNull();
  });

  test("renders the placeholder for undefined, null and an empty string", () => {
    for (const value of [undefined, null, ""]) {
      const container: HTMLElement = renderValue({
        value: value,
        definition: textDefinition,
      });

      expect(container.textContent).toEqual("-");
      expect(getPlaceholder(container)).not.toBeNull();
    }
  });

  test("uses the column's own noValueMessage when it has one", () => {
    expect(
      renderValue({
        value: undefined,
        definition: textDefinition,
        noValueMessage: "Not set",
      }).textContent,
    ).toEqual("Not set");
  });

  test("joins an array value on a plain text field", () => {
    /*
     * The field type changed the other way round - an old multi-select value
     * on a field that is now Text still has to read as something.
     */
    expect(
      renderValue({ value: ["Infra", "Apps"], definition: textDefinition })
        .textContent,
    ).toEqual("Infra, Apps");
  });

  test("JSON-stringifies an object value", () => {
    // Better than React's "[object Object]" or an outright render crash.
    expect(
      renderValue({ value: { team: "SRE" }, definition: textDefinition })
        .textContent,
    ).toEqual('{"team":"SRE"}');
  });

  test("falls through to the text path when the definition has no type", () => {
    /*
     * customFieldType is nullable on the definition models, so an untyped
     * field has to render rather than blank out.
     */
    const definition: CustomFieldDefinition = { name: "Notes" };

    expect(
      renderValue({ value: "hello", definition: definition }).textContent,
    ).toEqual("hello");
    expect(
      renderValue({ value: 7, definition: definition }).textContent,
    ).toEqual("7");
    expect(
      renderValue({ value: true, definition: definition }).textContent,
    ).toEqual("true");
    expect(
      getPlaceholder(renderValue({ value: undefined, definition: definition })),
    ).not.toBeNull();
  });

  test("renders a boolean-looking string on an untyped field as the string", () => {
    /*
     * Without a Boolean type there is no yes/no to render - the value is just
     * text, and pretending otherwise would invent a meaning the field does not
     * have.
     */
    const container: HTMLElement = renderValue({
      value: "false",
      definition: { name: "Notes" },
    });

    expect(container.textContent).toEqual("false");
    expect(container.querySelector("span.bg-gray-50")).toBeNull();
  });
});

describe("CustomFieldColumns generated getElement", () => {
  test("reads the value out of the row's customFields and renders it", () => {
    const column: Column<Monitor> = columnAt(
      getCustomFieldColumns<Monitor>({ definitions: [textDefinition] }),
      0,
    );

    expect(
      renderColumn(column, monitorWithFields({ Owner: "SRE" })).textContent,
    ).toEqual("SRE");
  });

  test("renders the placeholder for a row with no customFields at all", () => {
    const column: Column<Monitor> = columnAt(
      getCustomFieldColumns<Monitor>({ definitions: [textDefinition] }),
      0,
    );

    expect(getPlaceholder(renderColumn(column, new Monitor()))).not.toBeNull();
  });

  test("renders 'No' for a false boolean straight off the row", () => {
    /*
     * The end-to-end version of the boolean rule: a monitor that was
     * explicitly marked as not paging must not read as unanswered in the
     * table.
     */
    const column: Column<Monitor> = columnAt(
      getCustomFieldColumns<Monitor>({ definitions: [booleanDefinition] }),
      0,
    );

    expect(
      renderColumn(column, monitorWithFields({ Paging: false })).textContent,
    ).toEqual("No");
  });

  test("renders one badge per multi-select value straight off the row", () => {
    const column: Column<Monitor> = columnAt(
      getCustomFieldColumns<Monitor>({ definitions: [multiSelectDefinition] }),
      0,
    );

    expect(
      getBadgeLabels(
        renderColumn(column, monitorWithFields({ Teams: ["Infra", "Apps"] })),
      ),
    ).toEqual(["Infra", "Apps"]);
  });

  test("each column reads only its own key", () => {
    /*
     * Every generated column shares the same `field`, so the only thing
     * keeping them apart is the name closed over by getElement.
     */
    const columns: Columns<Monitor> = getCustomFieldColumns<Monitor>({
      definitions: [dropdownDefinition, textDefinition],
    });
    const monitor: Monitor = monitorWithFields({
      Owner: "SRE",
      Severity: "High",
    });

    // Sorted input is not required here; definitions map straight through.
    expect(renderColumn(columnAt(columns, 0), monitor).textContent).toEqual(
      "High",
    );
    expect(renderColumn(columnAt(columns, 1), monitor).textContent).toEqual(
      "SRE",
    );
  });
});
