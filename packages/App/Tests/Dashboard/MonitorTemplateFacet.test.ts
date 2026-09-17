import {
  ALL_MONITORS_TABLE_ID,
  MONITOR_TEMPLATE_FACET_KEY,
  MONITOR_TEMPLATE_FACET_QUERY_FIELD,
  MONITOR_TEMPLATE_RELATION_FIELD,
  buildMonitorTemplateFacetQuery,
  getMonitorTemplateFacetSelection,
  isQueryScopedToMonitorTemplate,
} from "../../FeatureSet/Dashboard/src/Components/Monitor/MonitorFacets";
import {
  FacetColumnQuery,
  buildFacetColumnQuery,
} from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FacetColumnQuery";
import {
  FacetSelectionState,
  getEmptyFacetSelectionState,
  isFacetSelectionActive,
  sanitizeFacetSelectionState,
} from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FacetSelectionState";
import { FacetTileSelection } from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FacetTileSelection";
import { FilterOperator } from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";
import { ResourceFacet } from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/ResourceFacet";
import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import ObjectID from "Common/Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * The Template chip on the monitor list (issue #3491).
 *
 * A monitor template is edited once and pushed onto every monitor created from
 * it, so the question that follows every template edit is "which monitors did
 * that just change?" — and at a few thousand devices sharing one template, the
 * only viable answer is a filter. This file pins what the chip asks the
 * database, because every way it can be wrong looks identical on screen: a chip
 * lit over a list it is not actually filtering.
 */

const TEMPLATE_A: string = "0193a1b2-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const TEMPLATE_B: string = "0193c0de-2222-4aaa-8bbb-000000000002";

/** The chip as MonitorTable declares it, minus the parts that call the API. */
const TEMPLATE_FACET: ResourceFacet = {
  key: MONITOR_TEMPLATE_FACET_KEY,
  queryField: MONITOR_TEMPLATE_FACET_QUERY_FIELD,
  label: "Template",
  isMultiSelect: true,
  supportedOperators: ["is", "is_not", "is_empty", "is_not_empty"],
  toQueryValue: (values: Array<string>, operator: FilterOperator): unknown => {
    return buildMonitorTemplateFacetQuery(values, operator);
  },
};

type ColumnQueryFunction = (
  operator: FilterOperator,
  values: Array<string>,
) => FacetColumnQuery | null;

const columnQuery: ColumnQueryFunction = (
  operator: FilterOperator,
  values: Array<string>,
): FacetColumnQuery | null => {
  return buildFacetColumnQuery({
    facet: TEMPLATE_FACET,
    operator: operator,
    values: values,
    existingValue: undefined,
  });
};

describe("what the Template chip asks the database", () => {
  /*
   * The foreign key, not the `monitorTemplate` relation. "is empty" has to be
   * answerable — a monitor that came from no template has no template row to
   * join against — and it is the same field the template page's Linked Monitors
   * table scopes itself by, which is what makes the conflict below detectable.
   */
  test("writes the monitorTemplateId column", () => {
    expect(MONITOR_TEMPLATE_FACET_QUERY_FIELD).toBe("monitorTemplateId");
    expect(columnQuery("is", [TEMPLATE_A])!.field).toBe("monitorTemplateId");
  });

  test("is not spelled as the relation, which cannot answer 'is empty'", () => {
    expect(MONITOR_TEMPLATE_FACET_QUERY_FIELD).not.toBe(
      MONITOR_TEMPLATE_RELATION_FIELD,
    );
  });

  test("one selected template becomes an Includes over that id", () => {
    const value: unknown = columnQuery("is", [TEMPLATE_A])!.value;

    expect(value).toBeInstanceOf(Includes);
    expect((value as Includes).values).toHaveLength(1);
  });

  /*
   * ObjectID, not the raw string. The column is a uuid; handing the ORM a
   * string is the difference between a filter and a type error at the driver.
   */
  test("selected values are wrapped as ObjectIDs", () => {
    const value: Includes = columnQuery("is", [TEMPLATE_A, TEMPLATE_B])!
      .value as Includes;

    for (const entry of value.values) {
      expect(entry).toBeInstanceOf(ObjectID);
    }

    expect(
      (value.values as Array<ObjectID>).map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([TEMPLATE_A, TEMPLATE_B]);
  });

  /*
   * Multi-select is not decoration: a template that has been superseded leaves
   * monitors on both the old and the new one, and "show me either" is the
   * question that finds the ones still to migrate.
   */
  test("several templates all reach the query", () => {
    expect(
      (columnQuery("is", [TEMPLATE_A, TEMPLATE_B])!.value as Includes).values,
    ).toHaveLength(2);
  });

  test("'is not' excludes rather than includes", () => {
    const value: unknown = columnQuery("is_not", [TEMPLATE_A])!.value;

    expect(value).toBeInstanceOf(IncludesNone);
    expect(value).not.toBeInstanceOf(Includes);
  });

  /*
   * The rows the Template column renders as "—": monitors that came from no
   * template, i.e. the ones a template rollout has not reached.
   */
  test("'is empty' asks the column for NULL", () => {
    expect(columnQuery("is_empty", [])!.value).toBeInstanceOf(IsNull);
    expect(columnQuery("is_empty", [])!.field).toBe("monitorTemplateId");
  });

  test("'is not empty' asks for any template at all", () => {
    expect(columnQuery("is_not_empty", [])!.value).toBeInstanceOf(NotNull);
  });

  /*
   * `null` means "leave this field out of the request entirely", which is a
   * different statement from writing the key with an undefined value — the
   * latter reaches the API as a filter nothing matches.
   */
  test("an empty selection constrains nothing", () => {
    expect(columnQuery("is", [])).toBeNull();
    expect(buildMonitorTemplateFacetQuery([], "is")).toBeUndefined();
    expect(buildMonitorTemplateFacetQuery([], "is_not")).toBeUndefined();
  });

  /*
   * Operators the chip never offers can still arrive from a hand-edited URL or
   * a view saved by a later build. sanitizeFacetSelectionState clamps them
   * first; this is the second line of defence, and it must not turn an option
   * id into a text comparison.
   */
  test("an operator the chip cannot express is clamped before it filters", () => {
    const state: FacetSelectionState = {
      ...getEmptyFacetSelectionState(),
      facetSelections: { [MONITOR_TEMPLATE_FACET_KEY]: [TEMPLATE_A] },
      facetOperators: { [MONITOR_TEMPLATE_FACET_KEY]: "contains" },
    };

    const sanitized: FacetSelectionState = sanitizeFacetSelectionState(state, [
      TEMPLATE_FACET,
    ]);

    // Values kept, operator dropped back to the first one the chip offers.
    expect(sanitized.facetOperators[MONITOR_TEMPLATE_FACET_KEY]).toBe("is");
    expect(sanitized.facetSelections[MONITOR_TEMPLATE_FACET_KEY]).toEqual([
      TEMPLATE_A,
    ]);
  });

  test("multi-select survives sanitizing, so both ids keep filtering", () => {
    const sanitized: FacetSelectionState = sanitizeFacetSelectionState(
      {
        ...getEmptyFacetSelectionState(),
        facetSelections: {
          [MONITOR_TEMPLATE_FACET_KEY]: [TEMPLATE_A, TEMPLATE_B],
        },
        facetOperators: { [MONITOR_TEMPLATE_FACET_KEY]: "is" },
      },
      [TEMPLATE_FACET],
    );

    expect(sanitized.facetSelections[MONITOR_TEMPLATE_FACET_KEY]).toEqual([
      TEMPLATE_A,
      TEMPLATE_B,
    ]);
  });

  /*
   * The chip's lit state and the query have to agree about "is empty": it
   * carries no values, so a bar that counted values alone would show an
   * unfiltered-looking list that is in fact filtered.
   */
  test("'is empty' counts as an active chip", () => {
    expect(
      isFacetSelectionActive(
        {
          ...getEmptyFacetSelectionState(),
          facetOperators: { [MONITOR_TEMPLATE_FACET_KEY]: "is_empty" },
        },
        [TEMPLATE_FACET],
      ),
    ).toBe(true);
  });
});

describe("a table already scoped to one template", () => {
  /*
   * The template page's Linked Monitors table is this same table, scoped by
   * `monitorTemplateId`. `mergeFiltersIntoQuery` builds ONE object, so a
   * Template chip there would overwrite the page's scope rather than narrow it
   * — and the page would go on claiming, in its title and its URL, to be
   * listing the template the user is looking at while showing another one's
   * monitors. MonitorTable drops the chip when it sees the field, so this is
   * the detector.
   */
  test("is recognised from the foreign key the page scopes by", () => {
    expect(
      isQueryScopedToMonitorTemplate({
        projectId: new ObjectID(TEMPLATE_B),
        monitorTemplateId: new ObjectID(TEMPLATE_A),
      }),
    ).toBe(true);
  });

  test("is recognised from the relation spelling too", () => {
    expect(
      isQueryScopedToMonitorTemplate({
        monitorTemplate: { _id: TEMPLATE_A },
      }),
    ).toBe(true);
  });

  test("a plain project-scoped monitor list is not scoped to a template", () => {
    expect(
      isQueryScopedToMonitorTemplate({ projectId: new ObjectID(TEMPLATE_B) }),
    ).toBe(false);
  });

  test("neither is an absent or empty query", () => {
    expect(isQueryScopedToMonitorTemplate(undefined)).toBe(false);
    expect(isQueryScopedToMonitorTemplate(null)).toBe(false);
    expect(isQueryScopedToMonitorTemplate({})).toBe(false);
  });

  /*
   * An explicitly-undefined key is how an optional query field is spelled in
   * TypeScript, and it constrains nothing — reading it as a scope would hide
   * the chip on a list that is showing every monitor.
   */
  test("a key present but unset is not a scope", () => {
    expect(
      isQueryScopedToMonitorTemplate({ monitorTemplateId: undefined }),
    ).toBe(false);
    expect(isQueryScopedToMonitorTemplate({ monitorTemplateId: null })).toBe(
      false,
    );
  });

  test("a non-object query is refused rather than thrown on", () => {
    expect(isQueryScopedToMonitorTemplate("monitorTemplateId")).toBe(false);
    expect(isQueryScopedToMonitorTemplate(42)).toBe(false);
  });
});

describe("the selection a link hands to the monitor list", () => {
  const selection: FacetTileSelection =
    getMonitorTemplateFacetSelection(TEMPLATE_A);

  test("moves the Template chip, not some private filter", () => {
    expect(selection.facetKey).toBe(MONITOR_TEMPLATE_FACET_KEY);
  });

  test("selects the template it was built for, on 'is'", () => {
    expect(selection.values).toEqual([TEMPLATE_A]);
    expect(selection.operator).toBe("is");
  });

  /*
   * The chip and the link have to name the same key or the list arrives
   * unfiltered — and the arriving chip has to produce the same query the user
   * would have got by picking the template by hand.
   */
  test("round-trips through the query builder to the same filter", () => {
    const value: unknown = buildFacetColumnQuery({
      facet: TEMPLATE_FACET,
      operator: selection.operator,
      values: selection.values,
      existingValue: undefined,
    })!.value;

    expect(value).toBeInstanceOf(Includes);
    expect(((value as Includes).values as Array<ObjectID>)[0]!.toString()).toBe(
      TEMPLATE_A,
    );
  });

  test("an empty id yields a chip that constrains nothing", () => {
    const empty: FacetTileSelection = getMonitorTemplateFacetSelection("");

    expect(empty.values).toEqual([]);
    expect(
      buildFacetColumnQuery({
        facet: TEMPLATE_FACET,
        operator: empty.operator,
        values: empty.values,
        existingValue: undefined,
      }),
    ).toBeNull();
  });
});

describe("the table id the chip is persisted under", () => {
  /*
   * Also sitting in bookmarks and in links pasted into tickets, so a rename has
   * to be a conscious edit of this line.
   */
  test("is the one the monitors page already uses", () => {
    expect(ALL_MONITORS_TABLE_ID).toBe("all-monitors-table");
  });
});
