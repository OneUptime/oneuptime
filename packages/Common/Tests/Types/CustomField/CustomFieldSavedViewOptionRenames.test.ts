import { toCustomFieldOptionRenameMap } from "../../../Types/CustomField/CustomFieldOptionEdit";
import {
  CUSTOM_FIELD_SAVED_VIEW_TABLE_IDS,
  getCustomFieldSavedViewTableIds,
  INCIDENT_CUSTOM_FIELD_TABLE_VIEW_IDS,
  RenamedCustomFieldSavedViewState,
  renameCustomFieldOptionsInSavedView,
} from "../../../Types/CustomField/CustomFieldSavedViews";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * A saved table view can filter by a dropdown custom field's options: the
 * field's chip remembers the options it selected, as their text, in
 * facets.facetSelections["customField:<name>"]. Renaming one of those
 * options (#4564) has to rename it there too, or the view filters for an
 * option nobody holds any more and comes back empty.
 */

const FACETS: JSONObject = {
  selectedOwnerKeys: ["user:abc"],
  facetSelections: {
    "customField:Facility": ["Facility A", "Facility C"],
    "customField:Region": ["Facility A"],
    currentIncidentState: ["state-1"],
  },
  facetOperators: {
    "customField:Facility": "isNot",
  },
};

const RENAMES: Map<string, string> = toCustomFieldOptionRenameMap([
  { from: "Facility A", to: "Facility Alpha" },
]);

describe("renameCustomFieldOptionsInSavedView", () => {
  test("renames the options the field's chip selected, and keeps everything else", () => {
    const renamed: RenamedCustomFieldSavedViewState =
      renameCustomFieldOptionsInSavedView({
        view: { facets: FACETS, query: { title: "x" } },
        fieldName: "Facility",
        renames: RENAMES,
      });

    expect(renamed.hasChanged).toBe(true);
    expect(renamed.changes).toEqual({
      facets: {
        ...FACETS,
        facetSelections: {
          "customField:Facility": ["Facility Alpha", "Facility C"],
          // Another field holding the same text is another field.
          "customField:Region": ["Facility A"],
          currentIncidentState: ["state-1"],
        },
      },
    });
  });

  test("keeps the chip's operator: a view that excluded the option still excludes it", () => {
    const renamed: RenamedCustomFieldSavedViewState =
      renameCustomFieldOptionsInSavedView({
        view: { facets: FACETS },
        fieldName: "Facility",
        renames: RENAMES,
      });

    expect((renamed.changes.facets as JSONObject)["facetOperators"]).toEqual({
      "customField:Facility": "isNot",
    });
  });

  test("a selection merged into one already selected is listed once", () => {
    const renamed: RenamedCustomFieldSavedViewState =
      renameCustomFieldOptionsInSavedView({
        view: {
          facets: {
            facetSelections: {
              "customField:Facility": ["Facility Alpha", "Facility A"],
            },
          },
        },
        fieldName: "Facility",
        renames: RENAMES,
      });

    expect(renamed.changes.facets).toEqual({
      facetSelections: { "customField:Facility": ["Facility Alpha"] },
    });
  });

  test("renames the field's value in the table's own filters, should one name it", () => {
    const renamed: RenamedCustomFieldSavedViewState =
      renameCustomFieldOptionsInSavedView({
        view: {
          query: {
            title: "Outage",
            customFields: { Facility: "Facility A", Region: "Facility A" },
          },
        },
        fieldName: "Facility",
        renames: RENAMES,
      });

    expect(renamed.changes).toEqual({
      query: {
        title: "Outage",
        customFields: { Facility: "Facility Alpha", Region: "Facility A" },
      },
    });
  });

  test("a view that does not select a renamed option is not touched", () => {
    for (const view of [
      {
        facets: {
          facetSelections: { "customField:Facility": ["Facility C"] },
        },
      },
      { facets: { facetSelections: {} } },
      { facets: { facetSelections: "broken" } },
      { facets: { facetSelections: { "customField:Facility": "broken" } } },
      { facets: null, query: null },
      {},
      { query: { customFields: { Facility: { _type: "IsNull" } } } },
      { query: { customFields: "broken" } },
    ] as Array<{ facets?: JSONObject | null; query?: JSONObject | null }>) {
      expect(
        renameCustomFieldOptionsInSavedView({
          view,
          fieldName: "Facility",
          renames: RENAMES,
        }),
      ).toEqual({ changes: {}, hasChanged: false });
    }

    // Selected under another field's name: that field is another field.
    expect(
      renameCustomFieldOptionsInSavedView({
        view: { facets: FACETS },
        fieldName: "Owner Team",
        renames: RENAMES,
      }),
    ).toEqual({ changes: {}, hasChanged: false });
  });

  test("nothing happens without a field name or renames", () => {
    expect(
      renameCustomFieldOptionsInSavedView({
        view: { facets: FACETS },
        fieldName: "",
        renames: RENAMES,
      }).hasChanged,
    ).toBe(false);

    expect(
      renameCustomFieldOptionsInSavedView({
        view: { facets: FACETS },
        fieldName: "Facility",
        renames: new Map(),
      }).hasChanged,
    ).toBe(false);
  });

  test("does not change the view it was handed", () => {
    const facets: JSONObject = JSON.parse(JSON.stringify(FACETS)) as JSONObject;

    renameCustomFieldOptionsInSavedView({
      view: { facets },
      fieldName: "Facility",
      renames: RENAMES,
    });

    expect(facets).toEqual(FACETS);
  });
});

describe("the saved views each resource's custom fields appear in", () => {
  test("lists every custom field definition table, and nothing else", () => {
    expect(Object.keys(CUSTOM_FIELD_SAVED_VIEW_TABLE_IDS).sort()).toEqual(
      [
        "AlertCustomField",
        "IncidentCustomField",
        "InventoryItemCustomField",
        "MonitorCustomField",
        "OnCallDutyPolicyCustomField",
        "ScheduledMaintenanceCustomField",
        "StatusPageCustomField",
        "TeamCustomField",
        "TeamMemberCustomField",
      ].sort(),
    );
  });

  test("the incident tables are the ones a field rename already rewrote", () => {
    expect(getCustomFieldSavedViewTableIds("IncidentCustomField")).toBe(
      INCIDENT_CUSTOM_FIELD_TABLE_VIEW_IDS,
    );
    expect(INCIDENT_CUSTOM_FIELD_TABLE_VIEW_IDS).toEqual([
      "all-incidents-table",
    ]);
  });

  test("names each resource's lists", () => {
    expect(getCustomFieldSavedViewTableIds("AlertCustomField")).toEqual([
      "all-alerts-table",
    ]);
    expect(getCustomFieldSavedViewTableIds("MonitorCustomField")).toEqual([
      "all-monitors-table",
      "archived-monitors-table",
      "security-events-monitors-table",
      "llm-alerts-monitors-table",
    ]);
    expect(
      getCustomFieldSavedViewTableIds("ScheduledMaintenanceCustomField"),
    ).toEqual(["all-scheduled-maintenance-events-table"]);
    expect(getCustomFieldSavedViewTableIds("InventoryItemCustomField")).toEqual(
      ["inventory-items-table", "inventory-archived-table"],
    );
  });

  test("an unknown table, or none, has no saved views", () => {
    expect(getCustomFieldSavedViewTableIds("Incident")).toEqual([]);
    expect(getCustomFieldSavedViewTableIds("constructor")).toEqual([]);
    expect(getCustomFieldSavedViewTableIds("__proto__")).toEqual([]);
    expect(getCustomFieldSavedViewTableIds(undefined)).toEqual([]);
  });

  test("no table id belongs to two resources: a chip of one would be renamed by the other", () => {
    const seen: Map<string, string> = new Map<string, string>();

    for (const [definition, tableIds] of Object.entries(
      CUSTOM_FIELD_SAVED_VIEW_TABLE_IDS,
    )) {
      for (const tableId of tableIds) {
        expect(seen.get(tableId)).toBeUndefined();
        seen.set(tableId, definition);
      }
    }
  });
});
