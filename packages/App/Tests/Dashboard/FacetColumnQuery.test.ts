import {
  FacetColumnQuery,
  buildBooleanFacetQuery,
  buildEntityFacetQuery,
  buildFacetColumnQuery,
  defaultFacetQueryValue,
} from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FacetColumnQuery";
import { FilterOperator } from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";
import { ResourceFacet } from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/ResourceFacet";
import { buildCustomFieldFacets } from "../../FeatureSet/Dashboard/src/Components/CustomFields/CustomFieldFacets";
import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import IncludesNoneOrNull from "Common/Types/BaseDatabase/IncludesNoneOrNull";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import NotEqualOrNull from "Common/Types/BaseDatabase/NotEqualOrNull";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import { CustomFieldDefinition } from "Common/Types/CustomField/CustomFieldDefinition";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * The rule this file exists for: the facet bar builds ONE query object, so two
 * chips writing the same field do not AND on their own — the second assignment
 * replaces the first, silently, while both chips stay lit and claim to apply.
 *
 * Every built-in chip owns its column outright, so that never came up. The
 * custom field chips all write `customFields` — one per key inside it — so it
 * comes up on every project that defines more than one custom field, and the
 * symptom is a list filtered by the last chip the user touched with no way to
 * tell from the screen.
 *
 * The second rule is smaller and fails the same way: "is empty" normally means
 * IsNull at the field, which for a chip over a key inside a JSON column would
 * ask whether the resource has no custom fields at all.
 */

type FacetFunction = (overrides: Partial<ResourceFacet>) => ResourceFacet;

const facet: FacetFunction = (
  overrides: Partial<ResourceFacet>,
): ResourceFacet => {
  return {
    key: "status",
    label: "Status",
    ...overrides,
  };
};

type QueryFunction = (data: {
  facet: ResourceFacet;
  operator: FilterOperator;
  values: Array<string>;
  existingValue?: unknown;
}) => FacetColumnQuery | null;

const query: QueryFunction = (data: {
  facet: ResourceFacet;
  operator: FilterOperator;
  values: Array<string>;
  existingValue?: unknown;
}): FacetColumnQuery | null => {
  return buildFacetColumnQuery({
    facet: data.facet,
    operator: data.operator,
    values: data.values,
    existingValue: data.existingValue,
  });
};

describe("which field a chip writes", () => {
  test("defaults to the facet key", () => {
    expect(
      query({ facet: facet({}), operator: "is", values: ["up"] })!.field,
    ).toBe("status");
  });

  test("uses queryField when the chip key differs from the column", () => {
    expect(
      query({
        facet: facet({ queryField: "currentMonitorStatus" }),
        operator: "is",
        values: ["up"],
      })!.field,
    ).toBe("currentMonitorStatus");
  });
});

describe("chips that constrain nothing", () => {
  test("an empty selection on a value operator is dropped", () => {
    /*
     * `null`, not a key with an undefined value: the field has to be absent
     * from the request, which is a different statement from filtering on
     * nothing.
     */
    expect(query({ facet: facet({}), operator: "is", values: [] })).toBeNull();
  });

  test("a value the operator cannot use is dropped", () => {
    // A date operator against an option list has no date to compare with.
    expect(
      query({ facet: facet({}), operator: "between", values: ["up"] }),
    ).toBeNull();
  });

  test("a facet whose toQueryValue returns undefined is dropped", () => {
    expect(
      query({
        facet: facet({
          toQueryValue: (): unknown => {
            return undefined;
          },
        }),
        operator: "is",
        values: ["up"],
      }),
    ).toBeNull();
  });
});

describe("the valueless operators", () => {
  test("write IsNull / NotNull at the field by default", () => {
    expect(
      query({ facet: facet({}), operator: "is_empty", values: [] })!.value,
    ).toBeInstanceOf(IsNull);
    expect(
      query({ facet: facet({}), operator: "is_not_empty", values: [] })!.value,
    ).toBeInstanceOf(NotNull);
  });

  test("go through toQueryValue when the facet opts in", () => {
    /*
     * A chip over one key inside a JSON column has to build this itself —
     * IsNull at the field would ask whether the whole column is null.
     */
    const result: FacetColumnQuery | null = query({
      facet: facet({
        handlesValuelessOperators: true,
        queryField: "customFields",
        toQueryValue: (
          _values: Array<string>,
          operator: FilterOperator,
        ): unknown => {
          return {
            Team: operator === "is_empty" ? new IsNull() : new NotNull(),
          };
        },
      }),
      operator: "is_empty",
      values: [],
    });

    expect(result!.field).toBe("customFields");
    expect((result!.value as JSONObject)["Team"]).toBeInstanceOf(IsNull);
  });

  test("an opted-in facet still applies them with nothing selected", () => {
    expect(
      query({
        facet: facet({
          handlesValuelessOperators: true,
          toQueryValue: (): unknown => {
            return { Team: new IsNull() };
          },
        }),
        operator: "is_empty",
        values: [],
      }),
    ).not.toBeNull();
  });
});

describe("two chips over one field", () => {
  test("the second replaces the first when no merge is declared", () => {
    /*
     * The behaviour every built-in chip relies on, and the reason
     * `exclusiveWith` exists for the ones that would otherwise collide.
     */
    const result: FacetColumnQuery | null = query({
      facet: facet({ key: "b", queryField: "shared" }),
      operator: "is",
      values: ["second"],
      existingValue: "first",
    });

    expect(result!.value).toBe("second");
  });

  test("mergeQueryValue combines them instead", () => {
    const result: FacetColumnQuery | null = query({
      facet: facet({
        key: "b",
        queryField: "shared",
        mergeQueryValue: (existing: unknown, incoming: unknown): unknown => {
          return `${existing as string}+${incoming as string}`;
        },
      }),
      operator: "is",
      values: ["second"],
      existingValue: "first",
    });

    expect(result!.value).toBe("first+second");
  });

  test("mergeQueryValue is not called when nothing is there yet", () => {
    let called: boolean = false;

    const result: FacetColumnQuery | null = query({
      facet: facet({
        queryField: "shared",
        mergeQueryValue: (): unknown => {
          called = true;
          return "merged";
        },
      }),
      operator: "is",
      values: ["first"],
      existingValue: undefined,
    });

    expect(called).toBe(false);
    expect(result!.value).toBe("first");
  });
});

describe("several custom field chips, end to end", () => {
  const definitions: Array<CustomFieldDefinition> = [
    {
      name: "Team",
      customFieldType: CustomFieldType.Dropdown,
      dropdownOptions: "Payments\nBilling",
    },
    {
      name: "Squads",
      customFieldType: CustomFieldType.MultiSelectDropdown,
      dropdownOptions: "infra\napps",
    },
    { name: "Ticket", customFieldType: CustomFieldType.Text },
    { name: "Impacted Users", customFieldType: CustomFieldType.Number },
  ];

  const facets: Array<ResourceFacet> = buildCustomFieldFacets(definitions);

  type MergeAllFunction = (
    selections: Array<{
      index: number;
      values: Array<string>;
      operator: FilterOperator;
    }>,
  ) => Record<string, unknown>;

  /**
   * Exactly what useResourceOwners' merge loop does, over the same helper.
   */
  const mergeAll: MergeAllFunction = (
    selections: Array<{
      index: number;
      values: Array<string>;
      operator: FilterOperator;
    }>,
  ): Record<string, unknown> => {
    const merged: Record<string, unknown> = {};

    for (const selection of selections) {
      const result: FacetColumnQuery | null = buildFacetColumnQuery({
        facet: facets[selection.index]!,
        operator: selection.operator,
        values: selection.values,
        existingValue: merged[facets[selection.index]!.queryField!],
      });

      if (result) {
        merged[result.field] = result.value;
      }
    }

    return merged;
  };

  test("four chips produce one customFields object holding all four keys", () => {
    const merged: Record<string, unknown> = mergeAll([
      { index: 0, values: ["Payments"], operator: "is" },
      { index: 1, values: ["infra", "apps"], operator: "is" },
      { index: 2, values: ["JIRA-1"], operator: "contains" },
      { index: 3, values: ["500"], operator: "greater_than" },
    ]);

    expect(Object.keys(merged)).toEqual(["customFields"]);

    const customFields: JSONObject = merged["customFields"] as JSONObject;

    expect(Object.keys(customFields).sort()).toEqual(
      ["Impacted Users", "Squads", "Team", "Ticket"].sort(),
    );
    expect(customFields["Team"]).toBe("Payments");
    expect(customFields["Squads"]).toBeInstanceOf(Includes);
  });

  test("a chip left empty contributes nothing and does not disturb the others", () => {
    const merged: Record<string, unknown> = mergeAll([
      { index: 0, values: ["Payments"], operator: "is" },
      { index: 2, values: [], operator: "contains" },
    ]);

    expect(merged["customFields"]).toEqual({ Team: "Payments" });
  });

  test("is-not on a multi-select chip merges alongside the others", () => {
    const merged: Record<string, unknown> = mergeAll([
      { index: 0, values: ["Payments"], operator: "is" },
      { index: 1, values: ["infra"], operator: "is_not" },
    ]);

    const customFields: JSONObject = merged["customFields"] as JSONObject;

    expect(customFields["Team"]).toBe("Payments");
    expect(customFields["Squads"]).toBeInstanceOf(IncludesNone);
  });

  test("is-empty on one chip does not null out the whole column", () => {
    /*
     * The regression this guards: writing IsNull at `customFields` would ask
     * for incidents with no custom fields at all, and would also wipe the
     * other chip's predicate on the way.
     */
    const merged: Record<string, unknown> = mergeAll([
      { index: 0, values: ["Payments"], operator: "is" },
      { index: 2, values: [], operator: "is_empty" },
    ]);

    const customFields: unknown = merged["customFields"];

    expect(customFields).not.toBeInstanceOf(IsNull);
    expect((customFields as JSONObject)["Team"]).toBe("Payments");
    expect((customFields as JSONObject)["Ticket"]).toBeInstanceOf(IsNull);
  });

  test("the merge is order-independent in content", () => {
    const forwards: Record<string, unknown> = mergeAll([
      { index: 0, values: ["Payments"], operator: "is" },
      { index: 2, values: ["JIRA-1"], operator: "contains" },
    ]);
    const backwards: Record<string, unknown> = mergeAll([
      { index: 2, values: ["JIRA-1"], operator: "contains" },
      { index: 0, values: ["Payments"], operator: "is" },
    ]);

    expect(Object.keys(forwards["customFields"] as JSONObject).sort()).toEqual(
      Object.keys(backwards["customFields"] as JSONObject).sort(),
    );
  });
});

describe("defaultFacetQueryValue", () => {
  test("wraps a multi-select selection", () => {
    expect(defaultFacetQueryValue(["a", "b"], "is", true)).toBeInstanceOf(
      Includes,
    );
  });

  test("passes a single-select selection through", () => {
    expect(defaultFacetQueryValue(["a"], "is", false)).toBe("a");
  });

  /*
   * "Is not" keeps the rows with no value (#10581): a monitor of no type,
   * an incident of no severity, is not of the one picked either. NotEqual
   * (`<>`) and IncludesNone (`NOT IN`) are not true of an empty column.
   */
  test("is not, of several: none of them, the rows with none kept", () => {
    const value: unknown = defaultFacetQueryValue(["a", "b"], "is_not", true);

    expect(value).toBeInstanceOf(IncludesNoneOrNull);
    expect(value).not.toBeInstanceOf(IncludesNone);
    expect((value as IncludesNoneOrNull).values).toEqual(["a", "b"]);
  });

  test("is not, of one: anything but it, the rows with none kept", () => {
    const value: unknown = defaultFacetQueryValue(["a"], "is_not", false);

    expect(value).toBeInstanceOf(NotEqualOrNull);
    expect(value).not.toBeInstanceOf(NotEqual);
    expect((value as NotEqualOrNull<string>).value).toBe("a");
  });

  test("refuses every operator it has no typed value for", () => {
    /*
     * These reach an option chip only from a hand-edited URL. Producing a
     * filter on an option id that happens to parse as a date or a number is
     * worse than producing none.
     */
    const unusable: Array<FilterOperator> = [
      "before",
      "after",
      "between",
      "contains",
      "not_contains",
      "starts_with",
      "ends_with",
      "greater_than",
      "greater_than_or_equal",
      "less_than",
      "less_than_or_equal",
    ];

    for (const operator of unusable) {
      expect(defaultFacetQueryValue(["a"], operator, false)).toBeUndefined();
    }
  });

  test("handles the valueless operators", () => {
    expect(defaultFacetQueryValue([], "is_empty", false)).toBeInstanceOf(
      IsNull,
    );
    expect(defaultFacetQueryValue([], "is_not_empty", false)).toBeInstanceOf(
      NotNull,
    );
  });
});

/*
 * IS NOT KEEPS EMPTY VALUES (#10581): the entity chips (a template, a state,
 * a severity, a site) and the yes/no chips write "is not" so that a record
 * pointing at nothing - a monitor linked to no template - is still listed
 * under "Template is not X". Only "is not empty" leaves such records out.
 */
describe("buildEntityFacetQuery", () => {
  const TEMPLATE_A: string = "11111111-1111-4111-8111-111111111111";
  const TEMPLATE_B: string = "22222222-2222-4222-8222-222222222222";

  test("is, of several: any of the ids, as ObjectIDs", () => {
    const value: unknown = buildEntityFacetQuery(
      [TEMPLATE_A, TEMPLATE_B],
      "is",
      true,
    );

    expect(value).toBeInstanceOf(Includes);
    expect(
      ((value as Includes).values as Array<ObjectID>).map(
        (id: ObjectID): string => {
          return id.toString();
        },
      ),
    ).toEqual([TEMPLATE_A, TEMPLATE_B]);
  });

  test("is not, of several: none of the ids, the records with none kept", () => {
    const value: unknown = buildEntityFacetQuery(
      [TEMPLATE_A, TEMPLATE_B],
      "is_not",
      true,
    );

    expect(value).toBeInstanceOf(IncludesNoneOrNull);
    expect(value).not.toBeInstanceOf(IncludesNone);

    const ids: Array<unknown> = (value as IncludesNoneOrNull)
      .values as Array<unknown>;

    expect(ids[0]).toBeInstanceOf(ObjectID);
    expect(
      ids.map((id: unknown): string => {
        return String(id);
      }),
    ).toEqual([TEMPLATE_A, TEMPLATE_B]);
  });

  test("is, of one: that id", () => {
    const value: unknown = buildEntityFacetQuery([TEMPLATE_A], "is", false);

    expect(value).toBeInstanceOf(ObjectID);
    expect(String(value)).toBe(TEMPLATE_A);
  });

  test("is not, of one: anything but that id, the records with none kept", () => {
    const value: unknown = buildEntityFacetQuery([TEMPLATE_A], "is_not", false);

    expect(value).toBeInstanceOf(NotEqualOrNull);
    expect(value).not.toBeInstanceOf(NotEqual);
    expect((value as NotEqualOrNull<string>).value).toBe(TEMPLATE_A);
  });

  test("is empty and is not empty stay IsNull and NotNull", () => {
    expect(buildEntityFacetQuery([], "is_empty", true)).toBeInstanceOf(IsNull);
    expect(buildEntityFacetQuery([], "is_not_empty", true)).toBeInstanceOf(
      NotNull,
    );
  });

  test("nothing picked constrains nothing", () => {
    expect(buildEntityFacetQuery([], "is_not", true)).toBeUndefined();
    expect(buildEntityFacetQuery([], "is", false)).toBeUndefined();
  });
});

describe("buildBooleanFacetQuery", () => {
  test("is: the flag itself", () => {
    expect(buildBooleanFacetQuery(["true"], "is")).toBe(true);
    expect(buildBooleanFacetQuery(["false"], "is")).toBe(false);
  });

  test("is not: anything but the flag, a flag never set kept", () => {
    const value: unknown = buildBooleanFacetQuery(["true"], "is_not");

    expect(value).toBeInstanceOf(NotEqualOrNull);
    expect((value as NotEqualOrNull<string>).value).toBe("true");
    expect(
      (buildBooleanFacetQuery(["false"], "is_not") as NotEqualOrNull<string>)
        .value,
    ).toBe("false");
  });
});

describe("buildFacetColumnQuery, is not on an entity chip", () => {
  test("writes the or-empty operator at the chip's field", () => {
    const facet: ResourceFacet = {
      key: "monitorTemplate",
      label: "Template",
      isMultiSelect: true,
      queryField: "monitorTemplateId",
      toQueryValue: (
        values: Array<string>,
        operator: FilterOperator,
      ): unknown => {
        return buildEntityFacetQuery(values, operator, true);
      },
    };

    const columnQuery: FacetColumnQuery | null = buildFacetColumnQuery({
      facet: facet,
      operator: "is_not",
      values: ["11111111-1111-4111-8111-111111111111"],
      existingValue: undefined,
    });

    expect(columnQuery!.field).toBe("monitorTemplateId");
    expect(columnQuery!.value).toBeInstanceOf(IncludesNoneOrNull);
  });
});
