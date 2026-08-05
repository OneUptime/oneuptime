import {
  BOOLEAN_CUSTOM_FIELD_OPTIONS,
  CUSTOM_FIELD_FACET_KEY_PREFIX,
  CUSTOM_FIELD_QUERY_FIELD,
  buildCustomFieldFacetQuery,
  buildCustomFieldFacets,
  getCustomFieldFacetKey,
  getCustomFieldFacetKind,
  getCustomFieldFacetOperators,
  getCustomFieldFacetOptions,
  getCustomFieldNameFromFacetKey,
  mergeCustomFieldQueryValue,
} from "../../FeatureSet/Dashboard/src/Components/CustomFields/CustomFieldFacets";
import {
  FilterChipDropdownOption,
  FilterOperator,
  NUMBER_FACET_OPERATORS,
  OPTION_FACET_OPERATORS,
  TEXT_FACET_OPERATORS,
} from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";
import { ResourceFacet } from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/ResourceFacet";
import EndsWith from "Common/Types/BaseDatabase/EndsWith";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import LessThan from "Common/Types/BaseDatabase/LessThan";
import LessThanOrEqual from "Common/Types/BaseDatabase/LessThanOrEqual";
import NotContains from "Common/Types/BaseDatabase/NotContains";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import Search from "Common/Types/BaseDatabase/Search";
import StartsWith from "Common/Types/BaseDatabase/StartsWith";
import { CustomFieldDefinition } from "Common/Types/CustomField/CustomFieldDefinition";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import { JSONObject } from "Common/Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * This module is the contract between what a custom field chip in the facet
 * bar says and what the database is actually asked. If a value here stops
 * meaning what the chip claims, the product lies: the chip reads "Team is
 * Payments" over a list of incidents that is not the Payments incidents, and
 * there is nothing on screen to explain it.
 *
 * Two things about custom fields make that easier to get wrong than for the
 * built-in chips. The values live inside one shared jsonb column keyed by the
 * field's *name*, so every chip on the bar writes the same query field and
 * they have to be merged rather than overwrite each other. And a field's type
 * decides both which control appears and how its value is compared, so the
 * mapping from CustomFieldType to chip kind is load-bearing in two directions
 * at once.
 *
 * The key strings are also the URL / saved-view vocabulary, so their literal
 * form is pinned — a rename has to be a conscious edit here rather than a
 * silent orphaning of every link already pasted into a ticket.
 */

type DefinitionFunction = (
  overrides: Partial<CustomFieldDefinition>,
) => CustomFieldDefinition;

const definition: DefinitionFunction = (
  overrides: Partial<CustomFieldDefinition>,
): CustomFieldDefinition => {
  return {
    name: "Team",
    customFieldType: CustomFieldType.Text,
    ...overrides,
  };
};

type QueryForFunction = (
  def: CustomFieldDefinition,
  values: Array<string>,
  operator: FilterOperator,
) => JSONObject | undefined;

const queryFor: QueryForFunction = (
  def: CustomFieldDefinition,
  values: Array<string>,
  operator: FilterOperator,
): JSONObject | undefined => {
  return buildCustomFieldFacetQuery({
    definition: def,
    values: values,
    operator: operator,
  });
};

describe("custom field facet keys", () => {
  test("namespaces the key so a field cannot collide with a built-in chip", () => {
    /*
     * A custom field called "labels" would otherwise take over the bar's own
     * Labels chip's slot in the persisted selection.
     */
    expect(CUSTOM_FIELD_FACET_KEY_PREFIX).toBe("customField:");
    expect(getCustomFieldFacetKey("labels")).toBe("customField:labels");
  });

  test("round-trips a name through the key", () => {
    expect(getCustomFieldNameFromFacetKey(getCustomFieldFacetKey("Team"))).toBe(
      "Team",
    );
  });

  test("survives a name with a colon in it", () => {
    const key: string = getCustomFieldFacetKey("Region: EU");

    expect(getCustomFieldNameFromFacetKey(key)).toBe("Region: EU");
  });

  test("returns null for a key that is not a custom field's", () => {
    expect(getCustomFieldNameFromFacetKey("currentIncidentState")).toBeNull();
    expect(getCustomFieldNameFromFacetKey("customField:")).toBeNull();
  });

  test("every chip writes the customFields column", () => {
    expect(CUSTOM_FIELD_QUERY_FIELD).toBe("customFields");
  });
});

describe("chip kind per custom field type", () => {
  test("Text and Number get a typed-value chip", () => {
    expect(
      getCustomFieldFacetKind(
        definition({ customFieldType: CustomFieldType.Text }),
      ),
    ).toBe("text");
    expect(
      getCustomFieldFacetKind(
        definition({ customFieldType: CustomFieldType.Number }),
      ),
    ).toBe("number");
  });

  test("Boolean gets an option chip with Yes / No", () => {
    const def: CustomFieldDefinition = definition({
      customFieldType: CustomFieldType.Boolean,
    });

    expect(getCustomFieldFacetKind(def)).toBe("options");
    expect(getCustomFieldFacetOptions(def)).toEqual(
      BOOLEAN_CUSTOM_FIELD_OPTIONS,
    );
  });

  test("a dropdown with options gets an option chip", () => {
    expect(
      getCustomFieldFacetKind(
        definition({
          customFieldType: CustomFieldType.Dropdown,
          dropdownOptions: "Low\nHigh",
        }),
      ),
    ).toBe("options");
  });

  test("a dropdown with no options configured falls back to a text chip", () => {
    /*
     * The field is real and has values in it. An empty picker would offer the
     * user nothing at all; a text box at least lets them type what they know
     * is in there.
     */
    expect(
      getCustomFieldFacetKind(
        definition({
          customFieldType: CustomFieldType.Dropdown,
          dropdownOptions: "",
        }),
      ),
    ).toBe("text");
  });

  test("a definition with no type at all is treated as text", () => {
    expect(
      getCustomFieldFacetKind(definition({ customFieldType: undefined })),
    ).toBe("text");
  });

  test("offers the operator set that matches the chip kind", () => {
    expect(
      getCustomFieldFacetOperators(
        definition({ customFieldType: CustomFieldType.Text }),
      ),
    ).toEqual(TEXT_FACET_OPERATORS);
    expect(
      getCustomFieldFacetOperators(
        definition({ customFieldType: CustomFieldType.Number }),
      ),
    ).toEqual(NUMBER_FACET_OPERATORS);
    expect(
      getCustomFieldFacetOperators(
        definition({
          customFieldType: CustomFieldType.Dropdown,
          dropdownOptions: "Low\nHigh",
        }),
      ),
    ).toEqual(OPTION_FACET_OPERATORS);
  });
});

describe("dropdown options reach the chip", () => {
  test("reads the legacy one-per-line format", () => {
    const options: Array<FilterChipDropdownOption> = getCustomFieldFacetOptions(
      definition({
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: "Low\nHigh",
      }),
    );

    expect(options).toEqual([
      { value: "Low", label: "Low", color: undefined },
      { value: "High", label: "High", color: undefined },
    ]);
  });

  test("carries colours across from the JSON format", () => {
    /*
     * An option that renders as an amber badge in the table has to be the same
     * amber in the picker, or the two read as different vocabularies.
     */
    const options: Array<FilterChipDropdownOption> = getCustomFieldFacetOptions(
      definition({
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: '[{"value":"Low","color":"#fef08a"}]',
      }),
    );

    expect(options).toEqual([{ value: "Low", label: "Low", color: "#fef08a" }]);
  });
});

describe("building the query — equality", () => {
  test("a single-select chip writes a bare value under the field name", () => {
    expect(
      queryFor(
        definition({
          customFieldType: CustomFieldType.Dropdown,
          dropdownOptions: "Low\nHigh",
        }),
        ["Low"],
        "is",
      ),
    ).toEqual({ Team: "Low" });
  });

  test("a multi-select chip writes Includes", () => {
    const query: JSONObject | undefined = queryFor(
      definition({
        customFieldType: CustomFieldType.MultiSelectDropdown,
        dropdownOptions: "Low\nHigh",
      }),
      ["Low", "High"],
      "is",
    );

    expect(query!["Team"]).toBeInstanceOf(Includes);
    expect((query!["Team"] as unknown as Includes).values).toEqual([
      "Low",
      "High",
    ]);
  });

  test("a boolean chip writes a real boolean, not the string", () => {
    /*
     * The value is stored as a JSON boolean, and a multi-select that happens
     * to hold booleans is matched by containment against `[true]` — which
     * `"true"` would not satisfy.
     */
    expect(
      queryFor(
        definition({ customFieldType: CustomFieldType.Boolean }),
        ["true"],
        "is",
      ),
    ).toEqual({ Team: true });
    expect(
      queryFor(
        definition({ customFieldType: CustomFieldType.Boolean }),
        ["false"],
        "is",
      ),
    ).toEqual({ Team: false });
  });

  test("a multi-select whose dropdown lost its options is treated as single", () => {
    /*
     * It renders as a text chip in that state, and a text chip holds one
     * typed value — so "is" has to mean equality rather than membership.
     */
    expect(
      queryFor(
        definition({
          customFieldType: CustomFieldType.MultiSelectDropdown,
          dropdownOptions: "",
        }),
        ["Low"],
        "is",
      ),
    ).toEqual({ Team: "Low" });
  });
});

describe("building the query — negation", () => {
  test("a single-select chip writes NotEqual", () => {
    const query: JSONObject | undefined = queryFor(
      definition({
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: "Low\nHigh",
      }),
      ["Low"],
      "is_not",
    );

    expect(query!["Team"]).toBeInstanceOf(NotEqual);
  });

  test("a multi-select chip writes IncludesNone", () => {
    const query: JSONObject | undefined = queryFor(
      definition({
        customFieldType: CustomFieldType.MultiSelectDropdown,
        dropdownOptions: "Low\nHigh",
      }),
      ["Low", "High"],
      "is_not",
    );

    expect(query!["Team"]).toBeInstanceOf(IncludesNone);
    expect((query!["Team"] as unknown as IncludesNone).values).toEqual([
      "Low",
      "High",
    ]);
  });
});

describe("building the query — emptiness", () => {
  test("is_empty asks about the key, not the whole column", () => {
    /*
     * The predicate goes *inside* the customFields object. Writing IsNull at
     * the column instead would ask whether the resource has no custom fields
     * at all — a different and almost always wrong question.
     */
    const query: JSONObject | undefined = queryFor(
      definition({}),
      [],
      "is_empty",
    );

    expect(query!["Team"]).toBeInstanceOf(IsNull);
  });

  test("is_not_empty likewise", () => {
    const query: JSONObject | undefined = queryFor(
      definition({}),
      [],
      "is_not_empty",
    );

    expect(query!["Team"]).toBeInstanceOf(NotNull);
  });

  test("the empty operators need no selection", () => {
    expect(queryFor(definition({}), [], "is_empty")).toBeDefined();
    expect(queryFor(definition({}), [], "is_not_empty")).toBeDefined();
  });
});

describe("building the query — text operators", () => {
  test("maps each substring operator to its query type", () => {
    expect(
      queryFor(definition({}), ["pay"], "contains")!["Team"],
    ).toBeInstanceOf(Search);
    expect(
      queryFor(definition({}), ["pay"], "not_contains")!["Team"],
    ).toBeInstanceOf(NotContains);
    expect(
      queryFor(definition({}), ["pay"], "starts_with")!["Team"],
    ).toBeInstanceOf(StartsWith);
    expect(
      queryFor(definition({}), ["pay"], "ends_with")!["Team"],
    ).toBeInstanceOf(EndsWith);
  });

  test("trims the typed value", () => {
    const query: JSONObject | undefined = queryFor(
      definition({}),
      ["  pay  "],
      "contains",
    );

    expect((query!["Team"] as unknown as Search<string>).value).toBe("pay");
  });
});

describe("building the query — numeric operators", () => {
  const numberDefinition: CustomFieldDefinition = definition({
    name: "Impacted Users",
    customFieldType: CustomFieldType.Number,
  });

  test("maps each comparison to its query type, with a real number", () => {
    const gt: JSONObject | undefined = queryFor(
      numberDefinition,
      ["500"],
      "greater_than",
    );

    expect(gt!["Impacted Users"]).toBeInstanceOf(GreaterThan);
    expect(
      (gt!["Impacted Users"] as unknown as GreaterThan<number>).value,
    ).toBe(500);

    expect(
      queryFor(numberDefinition, ["500"], "greater_than_or_equal")![
        "Impacted Users"
      ],
    ).toBeInstanceOf(GreaterThanOrEqual);
    expect(
      queryFor(numberDefinition, ["500"], "less_than")!["Impacted Users"],
    ).toBeInstanceOf(LessThan);
    expect(
      queryFor(numberDefinition, ["500"], "less_than_or_equal")![
        "Impacted Users"
      ],
    ).toBeInstanceOf(LessThanOrEqual);
  });

  test("refuses a comparison against something that is not a number", () => {
    /*
     * The chip's input prevents this; a hand-edited URL does not. Compiling it
     * anyway would produce a predicate matching nothing, under a chip claiming
     * to filter by "over abc".
     */
    expect(queryFor(numberDefinition, ["abc"], "greater_than")).toBeUndefined();
    expect(
      queryFor(numberDefinition, ["Infinity"], "less_than"),
    ).toBeUndefined();
  });
});

describe("building the query — nothing to constrain", () => {
  test("an empty selection on a value operator constrains nothing", () => {
    /*
     * `undefined` is how mergeFiltersIntoQuery is told to skip the key
     * entirely. Returning `{ Team: "" }` instead would filter for the empty
     * string under a chip showing nothing.
     */
    expect(queryFor(definition({}), [], "is")).toBeUndefined();
    expect(queryFor(definition({}), [], "is_not")).toBeUndefined();
    expect(queryFor(definition({}), [], "contains")).toBeUndefined();
  });

  test("a whitespace-only value constrains nothing", () => {
    expect(queryFor(definition({}), ["   "], "is")).toBeUndefined();
  });

  test("a definition with no name constrains nothing", () => {
    expect(queryFor(definition({ name: "" }), ["Low"], "is")).toBeUndefined();
  });
});

describe("merging two chips over the same column", () => {
  test("ANDs both fields into one object", () => {
    /*
     * The single most important behaviour here. Both chips write
     * `customFields`, and the bar's merge is the only thing keeping the second
     * from silently replacing the first while both stay lit.
     */
    const first: JSONObject = queryFor(
      definition({ name: "Team" }),
      ["Payments"],
      "is",
    )!;
    const second: JSONObject = queryFor(
      definition({ name: "Region" }),
      ["eu-west-1"],
      "is",
    )!;

    expect(mergeCustomFieldQueryValue(first, second)).toEqual({
      Team: "Payments",
      Region: "eu-west-1",
    });
  });

  test("a later chip on the same field replaces the earlier predicate", () => {
    // One key can only carry one predicate; the newer one is the live filter.
    expect(
      mergeCustomFieldQueryValue({ Team: "Payments" }, { Team: "Billing" }),
    ).toEqual({ Team: "Billing" });
  });

  test("hands the column to a non-custom-field constraint rather than blending", () => {
    /*
     * A page's own `query` prop can write this column. Spreading an operator
     * instance into an object would produce a shape neither side chose.
     */
    const isNull: IsNull = new IsNull();

    expect(mergeCustomFieldQueryValue(isNull, { Team: "x" })).toEqual({
      Team: "x",
    });
    expect(mergeCustomFieldQueryValue({ Team: "x" }, isNull)).toBe(isNull);
  });
});

describe("buildCustomFieldFacets", () => {
  const definitions: Array<CustomFieldDefinition> = [
    { name: "Team", customFieldType: CustomFieldType.Text },
    { name: "Impacted Users", customFieldType: CustomFieldType.Number },
    { name: "Regulated", customFieldType: CustomFieldType.Boolean },
    {
      name: "Severity Band",
      customFieldType: CustomFieldType.Dropdown,
      dropdownOptions: "P1\nP2",
    },
    {
      name: "Squads",
      customFieldType: CustomFieldType.MultiSelectDropdown,
      dropdownOptions: "infra\napps",
    },
  ];

  const facets: Array<ResourceFacet> = buildCustomFieldFacets(definitions);

  test("makes one chip per definition, in order", () => {
    expect(
      facets.map((facet: ResourceFacet) => {
        return facet.key;
      }),
    ).toEqual([
      "customField:Team",
      "customField:Impacted Users",
      "customField:Regulated",
      "customField:Severity Band",
      "customField:Squads",
    ]);
  });

  test("labels each chip with the field's name", () => {
    expect(facets[0]!.label).toBe("Team");
  });

  test("every chip writes customFields and knows how to share it", () => {
    for (const facet of facets) {
      expect(facet.queryField).toBe("customFields");
      expect(facet.mergeQueryValue).toBeDefined();
      expect(facet.handlesValuelessOperators).toBe(true);
      expect(facet.toQueryValue).toBeDefined();
    }
  });

  test("marks only the multi-select dropdown as multi-select", () => {
    expect(
      facets
        .filter((facet: ResourceFacet) => {
          return facet.isMultiSelect;
        })
        .map((facet: ResourceFacet) => {
          return facet.key;
        }),
    ).toEqual(["customField:Squads"]);
  });

  test("gives option chips their options and typed chips none", () => {
    expect(facets[3]!.options).toHaveLength(2);
    expect(facets[4]!.options).toHaveLength(2);
    expect(facets[0]!.options).toBeUndefined();
    expect(facets[1]!.options).toBeUndefined();
  });

  test("routes toQueryValue through the same builder", () => {
    expect(facets[0]!.toQueryValue!(["Payments"], "is")).toEqual({
      Team: "Payments",
    });
  });

  test("skips a definition with no name", () => {
    expect(
      buildCustomFieldFacets([
        { name: "" },
        { name: "Team", customFieldType: CustomFieldType.Text },
      ]),
    ).toHaveLength(1);
  });

  test("tolerates an empty definition list", () => {
    expect(buildCustomFieldFacets([])).toEqual([]);
  });

  test("produces a stable query for the same definitions", () => {
    /*
     * The table refetches when `JSON.stringify(query)` changes, so an unstable
     * key order here would loop it.
     */
    const build: () => string = (): string => {
      return JSON.stringify(
        buildCustomFieldFacets(definitions).reduce(
          (accumulated: JSONObject, facet: ResourceFacet): JSONObject => {
            const value: unknown = facet.toQueryValue!(["x"], "is");

            return value
              ? (mergeCustomFieldQueryValue(accumulated, value) as JSONObject)
              : accumulated;
          },
          {} as JSONObject,
        ),
      );
    };

    expect(build()).toBe(build());
  });
});

describe("names that are hostile to a query builder", () => {
  test("a name with quotes reaches the query key untouched", () => {
    /*
     * The server binds the key as a parameter, so nothing here needs escaping
     * — and escaping it here would filter for a name no resource has.
     */
    const name: string = `x' OR 1=1 --`;

    expect(queryFor(definition({ name: name }), ["v"], "is")).toEqual({
      [name]: "v",
    });
  });

  test("a name with a percent sign reaches the query key untouched", () => {
    expect(
      queryFor(definition({ name: "100% Coverage" }), ["v"], "is"),
    ).toEqual({ "100% Coverage": "v" });
  });
});
