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
  isDateCustomField,
  mergeCustomFieldQueryValue,
} from "../../FeatureSet/Dashboard/src/Components/CustomFields/CustomFieldFacets";
import {
  DATE_FACET_OPERATORS,
  FacetKind,
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
import InBetween from "Common/Types/BaseDatabase/InBetween";
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
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
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

/*
 * Date custom fields.
 *
 * A date is the first custom field type whose chip is neither an option list
 * nor a typed value: it renders the shared date-range control and hands its
 * whole operator vocabulary to `buildFacetDateRangeQuery`, so that "warranty
 * expiry is before the 5th" asked of a key inside the jsonb bag returns the
 * same rows as the same question asked of a real timestamp column. A user who
 * has filtered a date anywhere else in the product already knows what these
 * operators mean, and that knowledge has to keep paying off here.
 *
 * Three things about that delegation are easy to break, and each is pinned
 * below.
 *
 * The wrapping. Every other branch here puts its predicate under the field's
 * name before returning; the date branch has to do the same to the range
 * builder's output. A predicate that escaped the wrapper would be read as a
 * constraint on the whole `customFields` column rather than on one key in it.
 *
 * The valueless operators. `is_empty` / `is_not_empty` are answered inside the
 * date branch rather than falling through to the generic one, so a change that
 * returns early from the branch — or that only routes the four *dated*
 * operators through it — leaves "is empty" asking about the column.
 *
 * The `isDateTime` flag. Both date types share every line of this path and
 * differ only in whether "is" means the whole calendar day or the exact
 * instant. Dropping the flag produces a filter that stays right for one of the
 * two types and goes quietly wrong for the other, which is the kind of bug
 * that survives a demo.
 */

const DATE_DEFINITION: CustomFieldDefinition = definition({
  name: "Warranty Expiry",
  customFieldType: CustomFieldType.Date,
});

const DATE_TIME_DEFINITION: CustomFieldDefinition = definition({
  name: "Last Audited At",
  customFieldType: CustomFieldType.DateTime,
});

/** The instant a user picked, in the form the chip stores it. */
const PICKED: Date = new Date("2026-07-16T09:41:23.456Z");
const PICKED_END: Date = new Date("2026-07-20T17:02:11.222Z");

const PICKED_VALUE: string = PICKED.toISOString();

/*
 * A `between` selection is ONE array entry holding both instants joined by a
 * slash — the facet bar treats an array as a set, so a two-entry range would
 * be deduplicated and clamped out of existence before it ever reached here.
 * Spelled out with the literal separator rather than built from
 * FACET_DATE_RANGE_SEPARATOR: this is the form already sitting in shared URLs,
 * so a change to it has to break a test rather than follow the constant.
 */
const RANGE_VALUE: string = `${PICKED.toISOString()}/${PICKED_END.toISOString()}`;

/** Every type a definition can currently declare, plus the untyped case. */
const NON_DATE_TYPES: Array<CustomFieldType | undefined> = [
  CustomFieldType.Text,
  CustomFieldType.Number,
  CustomFieldType.Boolean,
  CustomFieldType.Dropdown,
  CustomFieldType.MultiSelectDropdown,
  undefined,
];

describe("recognising a date custom field", () => {
  test("both date types are date fields", () => {
    expect(
      isDateCustomField(definition({ customFieldType: CustomFieldType.Date })),
    ).toBe(true);
    expect(
      isDateCustomField(
        definition({ customFieldType: CustomFieldType.DateTime }),
      ),
    ).toBe(true);
  });

  test("no other declared type is a date field", () => {
    for (const type of NON_DATE_TYPES) {
      expect(isDateCustomField(definition({ customFieldType: type }))).toBe(
        false,
      );
    }
  });

  test("a definition with no type at all is not a date field", () => {
    /*
     * Worth its own case rather than living in the loop above. The check is
     * `customFieldType === CustomFieldType.Date`, so if the enum ever lost that
     * member the right-hand side would be `undefined` and every untyped
     * definition in the product — the shape a legacy row still has — would
     * quietly become a calendar chip over free text.
     */
    expect(CustomFieldType.Date).toBe("Date");
    expect(CustomFieldType.DateTime).toBe("DateTime");
    expect(isDateCustomField(definition({ customFieldType: undefined }))).toBe(
      false,
    );
  });

  test("nothing a later build adds to the enum becomes a date by accident", () => {
    /*
     * Read off the enum itself so a member added tomorrow is covered today: a
     * new type falls to the text chip until someone deliberately teaches this
     * function about it, rather than inheriting date behaviour it has no
     * storage format for.
     */
    const dateTyped: Array<string> = Object.values(CustomFieldType).filter(
      (type: string) => {
        return isDateCustomField(
          definition({ customFieldType: type as CustomFieldType }),
        );
      },
    );

    expect(dateTyped.sort()).toEqual(["Date", "DateTime"]);
  });
});

describe("chip kind for a date custom field", () => {
  test("a Date field gets the date-range control", () => {
    expect(getCustomFieldFacetKind(DATE_DEFINITION)).toBe("dateRange");
  });

  test("a DateTime field gets the date-range control too", () => {
    /*
     * The two share a control and differ only in the granularity of "is", so
     * splitting them into different chip kinds would double the popover for no
     * user-visible gain.
     */
    expect(getCustomFieldFacetKind(DATE_TIME_DEFINITION)).toBe("dateRange");
  });

  test("stray dropdown options on a date field do not make it a picker", () => {
    /*
     * A field edited from Dropdown to Date keeps its old options string in the
     * definition row. Offering that stale list would let the user filter for
     * "Low" on a column holding ISO-8601 instants.
     */
    expect(
      getCustomFieldFacetKind(
        definition({
          customFieldType: CustomFieldType.Date,
          dropdownOptions: "Low\nHigh",
        }),
      ),
    ).toBe("dateRange");
  });

  test("every other type keeps the kind it already had", () => {
    /*
     * Pinned as a table because the date branch was inserted into the middle
     * of this chain of type checks: a branch placed one line too early would
     * reclassify a neighbouring type, and the only symptom would be the wrong
     * control appearing in a popover nobody opened during review.
     */
    const kindOf: (definition: CustomFieldDefinition) => FacetKind = (
      def: CustomFieldDefinition,
    ): FacetKind => {
      return getCustomFieldFacetKind(def);
    };

    expect(kindOf(definition({ customFieldType: CustomFieldType.Text }))).toBe(
      "text",
    );
    expect(
      kindOf(definition({ customFieldType: CustomFieldType.Number })),
    ).toBe("number");
    expect(
      kindOf(definition({ customFieldType: CustomFieldType.Boolean })),
    ).toBe("options");
    expect(
      kindOf(
        definition({
          customFieldType: CustomFieldType.Dropdown,
          dropdownOptions: "Low\nHigh",
        }),
      ),
    ).toBe("options");
    expect(
      kindOf(
        definition({
          customFieldType: CustomFieldType.MultiSelectDropdown,
          dropdownOptions: "Low\nHigh",
        }),
      ),
    ).toBe("options");
    expect(
      kindOf(
        definition({
          customFieldType: CustomFieldType.Dropdown,
          dropdownOptions: "",
        }),
      ),
    ).toBe("text");
    expect(kindOf(definition({ customFieldType: undefined }))).toBe("text");
  });

  test("no non-date type answers dateRange", () => {
    for (const type of NON_DATE_TYPES) {
      expect(
        getCustomFieldFacetKind(
          definition({ customFieldType: type, dropdownOptions: "Low\nHigh" }),
        ),
      ).not.toBe("dateRange");
    }
  });
});

describe("operators for a date custom field", () => {
  test("a Date field offers the date vocabulary", () => {
    expect(getCustomFieldFacetOperators(DATE_DEFINITION)).toEqual(
      DATE_FACET_OPERATORS,
    );
  });

  test("a DateTime field offers the same vocabulary", () => {
    expect(getCustomFieldFacetOperators(DATE_TIME_DEFINITION)).toEqual(
      DATE_FACET_OPERATORS,
    );
  });

  test("that vocabulary excludes is_not and includes the empty pair", () => {
    /*
     * `is_not` is absent by design — there is no single-field expression for
     * "not on this day" that keeps NULLs honest — and the builder returns
     * undefined for it. If the list ever offered it, the chip would light up
     * over an unfiltered table. The empty pair, conversely, must be offered:
     * "warranty expiry is empty" is the question that finds the rows an import
     * left half-filled.
     */
    expect(DATE_FACET_OPERATORS).not.toContain("is_not");
    expect(DATE_FACET_OPERATORS).toContain("is_empty");
    expect(DATE_FACET_OPERATORS).toContain("is_not_empty");
  });

  test("the other kinds keep their own vocabularies", () => {
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
        definition({ customFieldType: CustomFieldType.Boolean }),
      ),
    ).toEqual(OPTION_FACET_OPERATORS);
    expect(
      getCustomFieldFacetOperators(
        definition({
          customFieldType: CustomFieldType.MultiSelectDropdown,
          dropdownOptions: "Low\nHigh",
        }),
      ),
    ).toEqual(OPTION_FACET_OPERATORS);
    expect(
      getCustomFieldFacetOperators(definition({ customFieldType: undefined })),
    ).toEqual(TEXT_FACET_OPERATORS);
  });
});

describe("building the query — a Date custom field", () => {
  test("wraps the predicate under the field's name", () => {
    /*
     * The one thing this module adds on top of the shared range builder. An
     * unwrapped InBetween would be read as a constraint on the whole
     * `customFields` column — comparing a jsonb object against a timestamp —
     * rather than on the one key the chip is named after.
     */
    const query: JSONObject | undefined = queryFor(
      DATE_DEFINITION,
      [PICKED_VALUE],
      "is",
    );

    expect(Object.keys(query!)).toEqual(["Warranty Expiry"]);
  });

  test("is spans the whole picked day", () => {
    /*
     * A warranty expiring at 09:41 is still expiring "on the 16th". Matching
     * the midnight instant instead would return nothing for almost every row,
     * under a chip claiming to show that day.
     */
    const query: JSONObject | undefined = queryFor(
      DATE_DEFINITION,
      [PICKED_VALUE],
      "is",
    );
    const predicate: InBetween<Date> = query![
      "Warranty Expiry"
    ] as unknown as InBetween<Date>;

    expect(predicate).toBeInstanceOf(InBetween);
    expect(predicate.startValue).toEqual(OneUptimeDate.getStartOfDay(PICKED));
    expect(predicate.endValue).toEqual(OneUptimeDate.getEndOfDay(PICKED));
  });

  test("that day span actually contains the picked instant", () => {
    // The invariant the two boundaries exist to satisfy, stated directly.
    const predicate: InBetween<Date> = queryFor(
      DATE_DEFINITION,
      [PICKED_VALUE],
      "is",
    )!["Warranty Expiry"] as unknown as InBetween<Date>;

    expect(predicate.startValue.getTime()).toBeLessThanOrEqual(
      PICKED.getTime(),
    );
    expect(predicate.endValue.getTime()).toBeGreaterThanOrEqual(
      PICKED.getTime(),
    );
  });

  test("before is a LessThan at the picked instant", () => {
    const predicate: unknown = queryFor(
      DATE_DEFINITION,
      [PICKED_VALUE],
      "before",
    )!["Warranty Expiry"];

    expect(predicate).toBeInstanceOf(LessThan);
    expect(predicate).not.toBeInstanceOf(LessThanOrEqual);
    expect((predicate as LessThan<Date>).value).toEqual(PICKED);
  });

  test("after is a GreaterThan at the picked instant", () => {
    const predicate: unknown = queryFor(
      DATE_DEFINITION,
      [PICKED_VALUE],
      "after",
    )!["Warranty Expiry"];

    expect(predicate).toBeInstanceOf(GreaterThan);
    expect(predicate).not.toBeInstanceOf(GreaterThanOrEqual);
    expect((predicate as GreaterThan<Date>).value).toEqual(PICKED);
  });

  test("between with both ends spans start-of-first to end-of-last day", () => {
    const predicate: InBetween<Date> = queryFor(
      DATE_DEFINITION,
      [RANGE_VALUE],
      "between",
    )!["Warranty Expiry"] as unknown as InBetween<Date>;

    expect(predicate).toBeInstanceOf(InBetween);
    expect(predicate.startValue).toEqual(OneUptimeDate.getStartOfDay(PICKED));
    expect(predicate.endValue).toEqual(OneUptimeDate.getEndOfDay(PICKED_END));
  });

  test("between with only a start constrains nothing", () => {
    /*
     * The user is mid-way through picking the pair. Constraining on the half
     * they have entered would make the table jump to a filter they never
     * finished asking for.
     */
    expect(
      queryFor(DATE_DEFINITION, [`${PICKED_VALUE}/`], "between"),
    ).toBeUndefined();
  });

  test("between with only an end constrains nothing either", () => {
    expect(
      queryFor(DATE_DEFINITION, [`/${PICKED_END.toISOString()}`], "between"),
    ).toBeUndefined();
  });

  test("is_empty asks about the key, through the date branch", () => {
    /*
     * The date branch answers this itself rather than letting it fall through
     * to the generic handler below it. Both produce IsNull today, so the only
     * way to keep the delegation honest is to assert the result exists and is
     * wrapped — a date branch that returned early without handling it would
     * hand back `undefined` and quietly stop filtering.
     */
    const query: JSONObject | undefined = queryFor(
      DATE_DEFINITION,
      [],
      "is_empty",
    );

    expect(Object.keys(query!)).toEqual(["Warranty Expiry"]);
    expect(query!["Warranty Expiry"]).toBeInstanceOf(IsNull);
  });

  test("is_not_empty likewise", () => {
    const query: JSONObject | undefined = queryFor(
      DATE_DEFINITION,
      [],
      "is_not_empty",
    );

    expect(query!["Warranty Expiry"]).toBeInstanceOf(NotNull);
  });

  test("the empty operators need no date picked", () => {
    // They are the two operators whose popover shows no date input at all.
    expect(queryFor(DATE_DEFINITION, [], "is_empty")).toBeDefined();
    expect(queryFor(DATE_DEFINITION, [PICKED_VALUE], "is_empty")).toBeDefined();
  });

  test("is_not constrains nothing", () => {
    /*
     * A date chip does not offer it, so it can only arrive from a hand-edited
     * URL or a view saved against a different chip kind. Inventing a predicate
     * for it would drop every row whose value is NULL, which is not what "is
     * not the 16th" says.
     */
    expect(queryFor(DATE_DEFINITION, [PICKED_VALUE], "is_not")).toBeUndefined();
  });

  test("no date picked constrains nothing, on every dated operator", () => {
    for (const operator of [
      "is",
      "before",
      "after",
      "between",
    ] as Array<FilterOperator>) {
      expect(queryFor(DATE_DEFINITION, [], operator)).toBeUndefined();
    }
  });

  test("a value that is not a date constrains nothing", () => {
    /*
     * The platform's date parser is lenient enough to read "0" as the year
     * 2000. A junk value that became a filter for January 2000 would empty the
     * table and explain it with a date nobody picked.
     */
    expect(queryFor(DATE_DEFINITION, ["0"], "is")).toBeUndefined();
    expect(queryFor(DATE_DEFINITION, ["yesterday"], "before")).toBeUndefined();
    expect(queryFor(DATE_DEFINITION, ["   "], "after")).toBeUndefined();
  });
});

describe("building the query — a DateTime custom field", () => {
  test("is matches the instant, not the day around it", () => {
    /*
     * The whole reason the `isDateTime` flag is threaded through. "Last
     * audited at 09:41" means that moment; widening it to the day would match
     * every other audit that happened between midnight and midnight, and the
     * chip would read as an exact time while filtering as a date.
     */
    const predicate: InBetween<Date> = queryFor(
      DATE_TIME_DEFINITION,
      [PICKED_VALUE],
      "is",
    )!["Last Audited At"] as unknown as InBetween<Date>;

    expect(predicate).toBeInstanceOf(InBetween);
    expect(predicate.startValue).toEqual(PICKED);
    expect(predicate.endValue).toEqual(PICKED);
    expect(predicate.startValue.getTime()).toBe(predicate.endValue.getTime());
  });

  test("between keeps the two instants exactly as picked", () => {
    const predicate: InBetween<Date> = queryFor(
      DATE_TIME_DEFINITION,
      [RANGE_VALUE],
      "between",
    )!["Last Audited At"] as unknown as InBetween<Date>;

    expect(predicate.startValue).toEqual(PICKED);
    expect(predicate.endValue).toEqual(PICKED_END);
  });

  test("a Date field and a DateTime field disagree about is, and only about is", () => {
    /*
     * Stated as a pair so that a regression collapsing the two types into one
     * branch — in either direction — fails here rather than in whichever of
     * the two happens to be exercised first.
     */
    const dateIs: InBetween<Date> = queryFor(
      DATE_DEFINITION,
      [PICKED_VALUE],
      "is",
    )!["Warranty Expiry"] as unknown as InBetween<Date>;
    const dateTimeIs: InBetween<Date> = queryFor(
      DATE_TIME_DEFINITION,
      [PICKED_VALUE],
      "is",
    )!["Last Audited At"] as unknown as InBetween<Date>;

    expect(dateIs.startValue.getTime()).not.toBe(
      dateTimeIs.startValue.getTime(),
    );
    expect(
      (
        queryFor(DATE_TIME_DEFINITION, [PICKED_VALUE], "before")![
          "Last Audited At"
        ] as unknown as LessThan<Date>
      ).value,
    ).toEqual(PICKED);
    expect(
      (
        queryFor(DATE_TIME_DEFINITION, [PICKED_VALUE], "after")![
          "Last Audited At"
        ] as unknown as GreaterThan<Date>
      ).value,
    ).toEqual(PICKED);
  });

  test("the empty operators behave the same for both date types", () => {
    expect(
      queryFor(DATE_TIME_DEFINITION, [], "is_empty")!["Last Audited At"],
    ).toBeInstanceOf(IsNull);
    expect(
      queryFor(DATE_TIME_DEFINITION, [], "is_not_empty")!["Last Audited At"],
    ).toBeInstanceOf(NotNull);
  });

  test("a half-entered range constrains nothing for a DateTime field either", () => {
    expect(
      queryFor(DATE_TIME_DEFINITION, [`${PICKED_VALUE}/`], "between"),
    ).toBeUndefined();
  });
});

describe("a date field with no name", () => {
  test("constrains nothing, whatever the operator", () => {
    /*
     * A definition row mid-rename has an empty name, and the key it would wrap
     * the predicate under is `""` — a key no resource's customFields bag has,
     * so the table would go empty rather than unfiltered. Checked across the
     * whole vocabulary because the name guard sits above the date branch and a
     * reordering would slip the valueless operators past it.
     */
    for (const operator of DATE_FACET_OPERATORS) {
      expect(
        queryFor(
          definition({ name: "", customFieldType: CustomFieldType.Date }),
          [PICKED_VALUE],
          operator,
        ),
      ).toBeUndefined();
    }
  });
});

describe("buildCustomFieldFacets — a date chip", () => {
  const dateFacets: Array<ResourceFacet> = buildCustomFieldFacets([
    { name: "Warranty Expiry", customFieldType: CustomFieldType.Date },
    { name: "Last Audited At", customFieldType: CustomFieldType.DateTime },
    { name: "Team", customFieldType: CustomFieldType.Text },
  ]);

  test("declares itself a dateRange chip", () => {
    /*
     * The shared bar keys its date behaviour off `facet.type` — which control
     * the popover renders, whether the selection is parsed as a range, how the
     * chip's label is formatted. A chip whose query is a date but whose type
     * is not would render a text box that writes ISO strings by hand.
     */
    expect(dateFacets[0]!.type).toBe("dateRange");
    expect(dateFacets[1]!.type).toBe("dateRange");
    expect(dateFacets[2]!.type).toBe("text");
  });

  test("wears a calendar rather than the text or list icon", () => {
    expect(dateFacets[0]!.icon).toBe(IconProp.Calendar);
    expect(dateFacets[1]!.icon).toBe(IconProp.Calendar);
    expect(dateFacets[2]!.icon).toBe(IconProp.Text);
  });

  test("offers the date operator list", () => {
    expect(dateFacets[0]!.supportedOperators).toEqual(DATE_FACET_OPERATORS);
    expect(dateFacets[1]!.supportedOperators).toEqual(DATE_FACET_OPERATORS);
  });

  test("is single-select and carries no options", () => {
    /*
     * Both matter to the shared plumbing: the single-select clamp in
     * `sanitizeFacetSelectionState` is what keeps a range's two instants
     * inside one array entry, and an option list on a date chip would make the
     * popover offer a picker over instants nobody can enumerate.
     */
    expect(dateFacets[0]!.isMultiSelect).toBe(false);
    expect(dateFacets[1]!.isMultiSelect).toBe(false);
    expect(dateFacets[0]!.options).toBeUndefined();
  });

  test("still shares the customFields column like every other chip", () => {
    expect(dateFacets[0]!.queryField).toBe(CUSTOM_FIELD_QUERY_FIELD);
    expect(dateFacets[0]!.mergeQueryValue).toBeDefined();
    expect(dateFacets[0]!.handlesValuelessOperators).toBe(true);
  });

  test("routes toQueryValue through the same date builder", () => {
    const query: JSONObject = dateFacets[0]!.toQueryValue!(
      [PICKED_VALUE],
      "is",
    ) as JSONObject;

    expect(query["Warranty Expiry"]).toBeInstanceOf(InBetween);
  });

  test("claiming handlesValuelessOperators is not an empty promise", () => {
    /*
     * The flag tells the bar to call `toQueryValue` for is_empty rather than
     * writing IsNull at the column itself. If the date path came back
     * undefined for it, the bar would have handed the operator to a chip that
     * dropped it and the column would go unconstrained.
     */
    expect(dateFacets[1]!.toQueryValue!([], "is_empty")).toEqual({
      "Last Audited At": new IsNull(),
    });
  });
});

describe("merging a date chip with a text chip", () => {
  test("ANDs both into one object over the shared column", () => {
    /*
     * Two chips, one jsonb column. The date chip arriving last must not
     * replace the text chip's predicate while both stay lit on the bar — the
     * failure this whole merge exists to prevent, now reachable from a chip
     * kind whose query value is built somewhere else entirely.
     */
    const text: JSONObject = queryFor(
      definition({ name: "Team" }),
      ["Payments"],
      "is",
    )!;
    const date: JSONObject = queryFor(
      DATE_DEFINITION,
      [PICKED_VALUE],
      "before",
    )!;

    const merged: JSONObject = mergeCustomFieldQueryValue(
      text,
      date,
    ) as JSONObject;

    expect(Object.keys(merged).sort()).toEqual(["Team", "Warranty Expiry"]);
    expect(merged["Team"]).toBe("Payments");
    expect(merged["Warranty Expiry"]).toBeInstanceOf(LessThan);
  });

  test("order does not change what survives the merge", () => {
    const text: JSONObject = queryFor(
      definition({ name: "Team" }),
      ["Payments"],
      "is",
    )!;
    const date: JSONObject = queryFor(DATE_DEFINITION, [], "is_empty")!;

    const merged: JSONObject = mergeCustomFieldQueryValue(
      date,
      text,
    ) as JSONObject;

    expect(merged["Team"]).toBe("Payments");
    expect(merged["Warranty Expiry"]).toBeInstanceOf(IsNull);
  });
});
