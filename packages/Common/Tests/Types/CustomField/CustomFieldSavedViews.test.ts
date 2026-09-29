import {
  CUSTOM_FIELD_COLUMN_ID_PREFIX,
  CUSTOM_FIELD_FACET_KEY_PREFIX,
  INCIDENT_CUSTOM_FIELD_TABLE_VIEW_IDS,
  RenamedCustomFieldSavedViewState,
  renameCustomFieldInSavedView,
} from "../../../Types/CustomField/CustomFieldSavedViews";
import { getCustomFieldColumns } from "../../../UI/Components/ModelTable/CustomFieldColumns";
import Columns from "../../../UI/Components/ModelTable/Columns";
import Incident from "../../../Models/DatabaseModels/Incident";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * A saved table view remembers custom fields by name: a column id
 * "customFields.<name>" in its layout, a chip "customField:<name>" in its
 * facets, and (should a table ever filter on one) query.customFields.<name>.
 * Renaming a field has to rewrite exactly those, and nothing else, or the
 * view silently loses the column and the chip.
 */

const FACETS: JSONObject = {
  selectedOwnerKeys: ["user:abc"],
  selectedLabelIds: ["label-1"],
  ownerOperator: "is",
  labelOperator: "is",
  facetSelections: {
    "customField:Impact": ["High"],
    "customField:Region": ["East"],
    currentIncidentState: ["state-1"],
  },
  facetOperators: {
    "customField:Impact": "isNot",
    currentIncidentState: "is",
  },
};

const COLUMNS: JSONObject = {
  order: ["title", "customFields.Impact", "customFields.Region"],
  hidden: ["customFields.Impact", "labels"],
};

describe("renameCustomFieldInSavedView", () => {
  test("renames the field's column, chip and operator, and keeps the rest", () => {
    const renamed: RenamedCustomFieldSavedViewState =
      renameCustomFieldInSavedView({
        view: { facets: FACETS, columns: COLUMNS, query: { title: "x" } },
        oldName: "Impact",
        newName: "Business Impact",
      });

    expect(renamed.hasChanged).toBe(true);
    expect(renamed.changes.columns).toEqual({
      order: ["title", "customFields.Business Impact", "customFields.Region"],
      hidden: ["customFields.Business Impact", "labels"],
    });
    expect(renamed.changes.facets).toEqual({
      ...FACETS,
      facetSelections: {
        "customField:Business Impact": ["High"],
        "customField:Region": ["East"],
        currentIncidentState: ["state-1"],
      },
      facetOperators: {
        "customField:Business Impact": "isNot",
        currentIncidentState: "is",
      },
    });
    // The query does not name the field, so it is not rewritten.
    expect(renamed.changes.query).toBeUndefined();
  });

  test("keeps the chip where it was among the others", () => {
    const renamed: RenamedCustomFieldSavedViewState =
      renameCustomFieldInSavedView({
        view: { facets: FACETS },
        oldName: "Impact",
        newName: "Severity",
      });

    expect(
      Object.keys(
        (renamed.changes.facets!["facetSelections"] as JSONObject) || {},
      ),
    ).toEqual([
      "customField:Severity",
      "customField:Region",
      "currentIncidentState",
    ]);
  });

  test("does not change the objects it was given", () => {
    const facets: JSONObject = JSON.parse(JSON.stringify(FACETS));
    const columns: JSONObject = JSON.parse(JSON.stringify(COLUMNS));

    renameCustomFieldInSavedView({
      view: { facets, columns },
      oldName: "Impact",
      newName: "Severity",
    });

    expect(facets).toEqual(FACETS);
    expect(columns).toEqual(COLUMNS);
  });

  test("renames a filter on the field in the table's own query", () => {
    const renamed: RenamedCustomFieldSavedViewState =
      renameCustomFieldInSavedView({
        view: {
          query: {
            title: "outage",
            customFields: { Impact: "High", Region: "East" },
          },
        },
        oldName: "Impact",
        newName: "Severity",
      });

    expect(renamed.changes.query).toEqual({
      title: "outage",
      customFields: { Severity: "High", Region: "East" },
    });
  });

  test("the renamed field wins over a stale entry under the new name", () => {
    const renamed: RenamedCustomFieldSavedViewState =
      renameCustomFieldInSavedView({
        view: {
          facets: {
            facetSelections: {
              "customField:Severity": ["stale"],
              "customField:Impact": ["High"],
            },
          },
          columns: {
            order: ["customFields.Severity", "customFields.Impact"],
            hidden: [],
          },
        },
        oldName: "Impact",
        newName: "Severity",
      });

    expect(renamed.changes.facets!["facetSelections"]).toEqual({
      "customField:Severity": ["High"],
    });
    expect(renamed.changes.columns!["order"]).toEqual([
      "customFields.Severity",
    ]);
  });

  test("a view that does not mention the field is left alone", () => {
    const renamed: RenamedCustomFieldSavedViewState =
      renameCustomFieldInSavedView({
        view: { facets: FACETS, columns: COLUMNS, query: {} },
        oldName: "Customer",
        newName: "Client",
      });

    expect(renamed).toEqual({ changes: {}, hasChanged: false });
  });

  test("another field whose name merely contains the old one is not touched", () => {
    const renamed: RenamedCustomFieldSavedViewState =
      renameCustomFieldInSavedView({
        view: {
          facets: {
            facetSelections: { "customField:Impact Area": ["a"] },
          },
          columns: { order: ["customFields.Impact Area"], hidden: [] },
        },
        oldName: "Impact",
        newName: "Severity",
      });

    expect(renamed.hasChanged).toBe(false);
  });

  test("a name that is not a custom field's (no prefix) is not touched", () => {
    const renamed: RenamedCustomFieldSavedViewState =
      renameCustomFieldInSavedView({
        view: {
          facets: { facetSelections: { Impact: ["x"] } },
          columns: { order: ["Impact"], hidden: ["Impact"] },
        },
        oldName: "Impact",
        newName: "Severity",
      });

    expect(renamed.hasChanged).toBe(false);
  });

  test.each([
    [{ facets: null, columns: null, query: null }],
    [{ facets: { facetSelections: "broken" }, columns: { order: "broken" } }],
    [{}],
  ])(
    "tolerates a view with nothing, or junk, where it looks (%j)",
    (view: unknown) => {
      expect(
        renameCustomFieldInSavedView({
          view: view as never,
          oldName: "Impact",
          newName: "Severity",
        }).hasChanged,
      ).toBe(false);
    },
  );

  test.each([
    ["Impact", "Impact"],
    ["", "Severity"],
    ["Impact", ""],
  ])("does nothing for %j -> %j", (oldName: string, newName: string) => {
    expect(
      renameCustomFieldInSavedView({
        view: { facets: FACETS, columns: COLUMNS },
        oldName,
        newName,
      }).hasChanged,
    ).toBe(false);
  });
});

describe("the saved-view spellings match the table and the facet bar", () => {
  test("a custom field column's id is the prefix and the name", () => {
    const columns: Columns<Incident> = getCustomFieldColumns<Incident>({
      definitions: [
        { name: "Impact", customFieldType: CustomFieldType.Dropdown },
      ],
    });

    expect(CUSTOM_FIELD_COLUMN_ID_PREFIX).toBe("customFields.");
    expect(columns[0]!.id).toBe(`${CUSTOM_FIELD_COLUMN_ID_PREFIX}Impact`);
  });

  test("the facet chip prefix is the one the dashboard uses", () => {
    expect(CUSTOM_FIELD_FACET_KEY_PREFIX).toBe("customField:");
  });

  test("the incidents list is a table whose saved views are rewritten", () => {
    expect(INCIDENT_CUSTOM_FIELD_TABLE_VIEW_IDS).toContain(
      "all-incidents-table",
    );
  });
});
