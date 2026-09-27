import { JSONObject } from "../JSON";

/*
 * How a saved table view (TableView) refers to a custom field, and what
 * renaming a field does to those references.
 *
 * Custom field values are keyed by the field's display name, and so is
 * everything a saved view remembers about one:
 *
 *   - TableView.columns = { order: [...ids], hidden: [...ids] }, where a
 *     custom field's column id is "customFields.<name>"
 *     (CustomFieldColumns.getCustomFieldColumns);
 *   - TableView.facets.facetSelections and .facetOperators, keyed by the
 *     facet chip's key "customField:<name>" (Dashboard CustomFieldFacets);
 *   - TableView.query, the table's own filters, which would hold a custom
 *     field under query.customFields["<name>"].
 *
 * A rename that moved the values but not these would leave every saved view
 * pointing at a field that no longer exists: the column silently drops out
 * and the filter chip is discarded as stale. Both prefixes live here so the
 * table, the facet bar and the rename share one spelling.
 */

// Column id of a custom field column: "customFields.Severity".
export const CUSTOM_FIELD_COLUMN_ID_PREFIX: string = "customFields.";

// Facet chip key of a custom field: "customField:Severity".
export const CUSTOM_FIELD_FACET_KEY_PREFIX: string = "customField:";

/*
 * The saved views whose table shows incident custom fields. Only tables that
 * offer saved views (a saveFilterProps.tableId) can have any; today that is
 * the Incidents list. App/Tests/Dashboard/IncidentCustomFieldSavedViews
 * fails if a table of incidents gains saved views without being listed.
 */
export const INCIDENT_CUSTOM_FIELD_TABLE_VIEW_IDS: Array<string> = [
  "all-incidents-table",
];

export interface CustomFieldSavedViewState {
  query?: JSONObject | null | undefined;
  facets?: JSONObject | null | undefined;
  columns?: JSONObject | null | undefined;
}

export interface RenamedCustomFieldSavedViewState {
  /*
   * Only the parts that changed, as the whole new value of that column.
   * Empty when the view does not mention the field.
   */
  changes: CustomFieldSavedViewState;
  hasChanged: boolean;
}

type IsObjectFunction = (value: unknown) => value is JSONObject;

const isObject: IsObjectFunction = (value: unknown): value is JSONObject => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

type RenameKeyFunction = (
  object: JSONObject,
  oldKey: string,
  newKey: string,
) => JSONObject | null;

/*
 * A copy of `object` with `oldKey` renamed, keeping the key's position, or
 * null when there is no such key. The renamed value wins over anything the
 * new key already held, as it does for the values themselves.
 */
const renameKey: RenameKeyFunction = (
  object: JSONObject,
  oldKey: string,
  newKey: string,
): JSONObject | null => {
  if (!Object.prototype.hasOwnProperty.call(object, oldKey)) {
    return null;
  }

  const renamed: JSONObject = {};

  for (const [key, value] of Object.entries(object)) {
    if (key === oldKey) {
      renamed[newKey] = value;
      continue;
    }

    if (key === newKey) {
      continue;
    }

    renamed[key] = value;
  }

  return renamed;
};

type RenameInListFunction = (
  list: unknown,
  oldEntry: string,
  newEntry: string,
) => Array<unknown> | null;

// A copy of the list with the entry renamed (and not doubled), or null.
const renameInList: RenameInListFunction = (
  list: unknown,
  oldEntry: string,
  newEntry: string,
): Array<unknown> | null => {
  if (!Array.isArray(list) || !list.includes(oldEntry)) {
    return null;
  }

  const renamed: Array<unknown> = [];

  for (const entry of list) {
    const next: unknown = entry === oldEntry ? newEntry : entry;

    if (next === newEntry && renamed.includes(newEntry)) {
      continue;
    }

    renamed.push(next);
  }

  return renamed;
};

export type RenameCustomFieldInSavedViewFunction = (data: {
  view: CustomFieldSavedViewState;
  oldName: string;
  newName: string;
}) => RenamedCustomFieldSavedViewState;

/**
 * What a saved view has to become when a custom field it mentions is
 * renamed from `oldName` to `newName`. Everything else in the view is kept
 * exactly as it was.
 */
export const renameCustomFieldInSavedView: RenameCustomFieldInSavedViewFunction =
  (data: {
    view: CustomFieldSavedViewState;
    oldName: string;
    newName: string;
  }): RenamedCustomFieldSavedViewState => {
    const changes: CustomFieldSavedViewState = {};

    if (!data.oldName || !data.newName || data.oldName === data.newName) {
      return { changes, hasChanged: false };
    }

    // Columns: the column ids in the viewer's order and hidden lists.
    if (isObject(data.view.columns)) {
      const oldId: string = `${CUSTOM_FIELD_COLUMN_ID_PREFIX}${data.oldName}`;
      const newId: string = `${CUSTOM_FIELD_COLUMN_ID_PREFIX}${data.newName}`;
      const columns: JSONObject = { ...data.view.columns };
      let changed: boolean = false;

      for (const listName of ["order", "hidden"]) {
        const renamed: Array<unknown> | null = renameInList(
          columns[listName],
          oldId,
          newId,
        );

        if (renamed) {
          columns[listName] = renamed as JSONObject[string];
          changed = true;
        }
      }

      if (changed) {
        changes.columns = columns;
      }
    }

    // Facets: the chip's selection and operator, keyed by the chip.
    if (isObject(data.view.facets)) {
      const oldKey: string = `${CUSTOM_FIELD_FACET_KEY_PREFIX}${data.oldName}`;
      const newKey: string = `${CUSTOM_FIELD_FACET_KEY_PREFIX}${data.newName}`;
      const facets: JSONObject = { ...data.view.facets };
      let changed: boolean = false;

      for (const mapName of ["facetSelections", "facetOperators"]) {
        const map: unknown = facets[mapName];

        if (!isObject(map)) {
          continue;
        }

        const renamed: JSONObject | null = renameKey(map, oldKey, newKey);

        if (renamed) {
          facets[mapName] = renamed;
          changed = true;
        }
      }

      if (changed) {
        changes.facets = facets;
      }
    }

    // The table's own filters, should one ever filter on a custom field.
    if (
      isObject(data.view.query) &&
      isObject(data.view.query["customFields"])
    ) {
      const renamed: JSONObject | null = renameKey(
        data.view.query["customFields"],
        data.oldName,
        data.newName,
      );

      if (renamed) {
        changes.query = { ...data.view.query, customFields: renamed };
      }
    }

    return {
      changes: changes,
      hasChanged: Object.keys(changes).length > 0,
    };
  };
