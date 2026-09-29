import Column from "./Column";
import Columns from "./Columns";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { JSONObject } from "../../../Types/JSON";

/*
 * ---------------------------------------------------------------------------
 * Per-viewer column layout for a ModelTable
 * ---------------------------------------------------------------------------
 *
 * A layout is two lists of column ids: the order the viewer arranged the
 * columns in, and the ones they switched off. Both are stored - "hidden" is
 * not the complement of "order" - because a column the viewer has never seen
 * (one shipped in a later release, or a custom field added after they last
 * touched this table) has to default to *visible* and land in a predictable
 * spot, rather than silently vanishing because it is missing from `order`.
 *
 * Everything here is pure so the rules below can be pinned by unit tests
 * rather than inferred from a rendered table:
 *
 *  - ids are derived from the declared field, never from array position,
 *    because `props.columns` is edited every release;
 *  - an id that no longer matches a column is dropped on read, the same way
 *    restored filters are sanitized, so a stale entry cannot wedge the table;
 *  - a layout that would leave nothing on screen is refused.
 */

export interface ColumnPreference {
  // Column ids in the order the viewer arranged them.
  order: Array<string>;
  // Column ids the viewer switched off.
  hidden: Array<string>;
}

export type ModelTableColumn<
  TBaseModel extends BaseModel | AnalyticsBaseModel,
> = Column<TBaseModel>;

export const EmptyColumnPreference: ColumnPreference = {
  order: [],
  hidden: [],
};

export type SlugifyFunction = (value: string) => string;

const slugify: SlugifyFunction = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

export type GetColumnBaseIdFunction = <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(
  column: ModelTableColumn<TBaseModel>,
) => string;

/*
 * The identity a column would have if no other column competed for it. An
 * explicit `id` always wins; otherwise it is the field the column reads,
 * which is the one thing about a column that survives re-ordering, renaming
 * and re-styling. `selectedProperty` is part of it so that every custom field
 * on one JSON column gets its own id ("customFields.Severity").
 */
export const getColumnBaseId: GetColumnBaseIdFunction = <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(
  column: ModelTableColumn<TBaseModel>,
): string => {
  if (column.id) {
    return column.id;
  }

  const fieldKey: string | undefined = column.field
    ? Object.keys(column.field)[0]
    : undefined;

  if (fieldKey) {
    return column.selectedProperty
      ? `${fieldKey}.${column.selectedProperty}`
      : fieldKey;
  }

  return slugify(column.title || "") || "column";
};

export type GetColumnIdsFunction = <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(
  columns: Columns<TBaseModel>,
) => Array<string>;

/*
 * Ids for a whole column set, in declaration order and guaranteed unique.
 *
 * Collisions are real and common: a table often carries several cells that
 * render from `getElement` off the same placeholder `field: { _id: true }`.
 * Those are disambiguated by title first (stable, and what the viewer
 * actually sees in the picker) and only then by position, which is the one
 * part that can shift when a column is inserted. A shifted id is harmless -
 * it simply reads as a new column, so it defaults to visible.
 */
export const getColumnIds: GetColumnIdsFunction = <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(
  columns: Columns<TBaseModel>,
): Array<string> => {
  const baseIds: Array<string> = columns.map(
    (column: ModelTableColumn<TBaseModel>) => {
      return getColumnBaseId<TBaseModel>(column);
    },
  );

  const baseIdCounts: Record<string, number> = {};

  for (const baseId of baseIds) {
    baseIdCounts[baseId] = (baseIdCounts[baseId] || 0) + 1;
  }

  const candidateIds: Array<string> = columns.map(
    (column: ModelTableColumn<TBaseModel>, index: number) => {
      const baseId: string = baseIds[index] as string;

      if ((baseIdCounts[baseId] || 0) < 2) {
        return baseId;
      }

      const titleSlug: string = slugify(column.title || "");

      return titleSlug ? `${baseId}:${titleSlug}` : baseId;
    },
  );

  const usedIds: Record<string, number> = {};
  const ids: Array<string> = [];

  for (const candidateId of candidateIds) {
    const timesUsed: number = usedIds[candidateId] || 0;
    usedIds[candidateId] = timesUsed + 1;
    ids.push(timesUsed === 0 ? candidateId : `${candidateId}#${timesUsed + 1}`);
  }

  return ids;
};

export interface CustomizableColumn<
  TBaseModel extends BaseModel | AnalyticsBaseModel,
> {
  id: string;
  column: ModelTableColumn<TBaseModel>;
  isVisible: boolean;
  // Pinned columns are always shown and cannot be moved.
  isPinned: boolean;
  /*
   * The picker may drop this column entirely, not just switch it off. True
   * only for columns the viewer added themselves (attribute columns); a
   * pinned column is never removable, since it is not the viewer's to touch.
   */
  isRemovable?: boolean | undefined;
}

export type IsDefaultHiddenFunction = <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(
  column: ModelTableColumn<TBaseModel>,
) => boolean;

const isHiddenByDefault: IsDefaultHiddenFunction = <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(
  column: ModelTableColumn<TBaseModel>,
): boolean => {
  return Boolean(column.isHiddenByDefault) && !column.isNotCustomizable;
};

export type GetCustomizableColumnsFunction = <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(data: {
  columns: Columns<TBaseModel>;
  preference?: ColumnPreference | null | undefined;
}) => Array<CustomizableColumn<TBaseModel>>;

/*
 * The picker's model: every column the viewer may act on, already in the
 * order they arranged them, each tagged with whether it is currently on.
 *
 * Pinned columns keep their declared position rather than being dragged
 * around by a stale layout - they are not in the picker, so the viewer has no
 * way to put them back if a persisted `order` moved them.
 */
export const getCustomizableColumns: GetCustomizableColumnsFunction = <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(data: {
  columns: Columns<TBaseModel>;
  preference?: ColumnPreference | null | undefined;
}): Array<CustomizableColumn<TBaseModel>> => {
  const { columns, preference } = data;

  const ids: Array<string> = getColumnIds<TBaseModel>(columns);

  const entries: Array<CustomizableColumn<TBaseModel>> = columns.map(
    (column: ModelTableColumn<TBaseModel>, index: number) => {
      const id: string = ids[index] as string;
      const isPinned: boolean = Boolean(column.isNotCustomizable);

      let isVisible: boolean = !isHiddenByDefault<TBaseModel>(column);

      if (preference && !isPinned) {
        if (preference.hidden.includes(id)) {
          isVisible = false;
        } else if (preference.order.includes(id)) {
          /*
           * The viewer has arranged this column at least once and did not
           * put it in `hidden`, so it is on - even if the table now ships it
           * hidden by default.
           */
          isVisible = true;
        }
      }

      return {
        id,
        column,
        isVisible,
        isPinned,
        isRemovable: Boolean(column.isRemovable) && !isPinned,
      };
    },
  );

  if (!preference || preference.order.length === 0) {
    return entries;
  }

  const orderIndexById: Record<string, number> = {};

  preference.order.forEach((id: string, index: number) => {
    if (orderIndexById[id] === undefined) {
      orderIndexById[id] = index;
    }
  });

  /*
   * A column the layout does not mention keeps its declared neighbours: it
   * sorts just after the last arranged column that precedes it in the
   * declaration, so a newly shipped column appears where its author put it
   * rather than being swept to the end.
   */
  const sortKeys: Array<number> = [];
  let lastKnownOrderIndex: number = -1;

  entries.forEach((entry: CustomizableColumn<TBaseModel>) => {
    const knownIndex: number | undefined = entry.isPinned
      ? undefined
      : orderIndexById[entry.id];

    if (knownIndex !== undefined) {
      lastKnownOrderIndex = knownIndex;
      sortKeys.push(knownIndex);
      return;
    }

    sortKeys.push(lastKnownOrderIndex + 0.5);
  });

  return entries
    .map(
      (
        entry: CustomizableColumn<TBaseModel>,
        index: number,
      ): { entry: CustomizableColumn<TBaseModel>; key: number; at: number } => {
        return { entry, key: sortKeys[index] as number, at: index };
      },
    )
    .sort(
      (
        a: { key: number; at: number },
        b: { key: number; at: number },
      ): number => {
        // Stable: equal keys keep declaration order.
        return a.key === b.key ? a.at - b.at : a.key - b.key;
      },
    )
    .map(
      (item: {
        entry: CustomizableColumn<TBaseModel>;
      }): CustomizableColumn<TBaseModel> => {
        return item.entry;
      },
    );
};

export type ApplyColumnPreferenceFunction = <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(data: {
  columns: Columns<TBaseModel>;
  preference?: ColumnPreference | null | undefined;
}) => Columns<TBaseModel>;

/*
 * The column set the table should actually render. Refuses to return an empty
 * set: a layout that hides everything would replace the table with an empty
 * shell the viewer cannot get out of, so it falls back to showing everything.
 */
export const applyColumnPreference: ApplyColumnPreferenceFunction = <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(data: {
  columns: Columns<TBaseModel>;
  preference?: ColumnPreference | null | undefined;
}): Columns<TBaseModel> => {
  const entries: Array<CustomizableColumn<TBaseModel>> =
    getCustomizableColumns<TBaseModel>(data);

  const visible: Columns<TBaseModel> = entries
    .filter((entry: CustomizableColumn<TBaseModel>) => {
      return entry.isVisible;
    })
    .map((entry: CustomizableColumn<TBaseModel>) => {
      return entry.column;
    });

  if (visible.length === 0) {
    return entries.map((entry: CustomizableColumn<TBaseModel>) => {
      return entry.column;
    });
  }

  return visible;
};

export type BuildColumnPreferenceFunction = <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(
  entries: Array<CustomizableColumn<TBaseModel>>,
) => ColumnPreference;

/*
 * The inverse of getCustomizableColumns: turn what the picker is showing back
 * into something storable. Pinned columns are left out entirely - they are
 * not the viewer's to arrange, so recording them would only create entries
 * that go stale when a table stops pinning a column.
 */
export const buildColumnPreference: BuildColumnPreferenceFunction = <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(
  entries: Array<CustomizableColumn<TBaseModel>>,
): ColumnPreference => {
  const order: Array<string> = [];
  const hidden: Array<string> = [];

  for (const entry of entries) {
    if (entry.isPinned) {
      continue;
    }

    order.push(entry.id);

    if (!entry.isVisible) {
      hidden.push(entry.id);
    }
  }

  return { order, hidden };
};

export type SanitizeColumnPreferenceFunction = (data: {
  preference: ColumnPreference | null;
  knownColumnIds: Array<string>;
}) => ColumnPreference | null;

/*
 * Drop everything that no longer names a column on this table. A stored
 * layout outlives the release that produced it, so it routinely mentions
 * columns that have since been renamed, removed, or - for custom fields -
 * deleted from the project.
 */
export const sanitizeColumnPreference: SanitizeColumnPreferenceFunction =
  (data: {
    preference: ColumnPreference | null;
    knownColumnIds: Array<string>;
  }): ColumnPreference | null => {
    const { preference, knownColumnIds } = data;

    if (!preference) {
      return null;
    }

    const known: Set<string> = new Set(knownColumnIds);

    const keep: (ids: Array<string>) => Array<string> = (
      ids: Array<string>,
    ): Array<string> => {
      const seen: Set<string> = new Set();

      return ids.filter((id: string) => {
        if (!known.has(id) || seen.has(id)) {
          return false;
        }
        seen.add(id);
        return true;
      });
    };

    const sanitized: ColumnPreference = {
      order: keep(preference.order),
      hidden: keep(preference.hidden),
    };

    if (sanitized.order.length === 0 && sanitized.hidden.length === 0) {
      return null;
    }

    return sanitized;
  };

export type IsEmptyColumnPreferenceFunction = (
  preference: ColumnPreference | null | undefined,
) => boolean;

export const isEmptyColumnPreference: IsEmptyColumnPreferenceFunction = (
  preference: ColumnPreference | null | undefined,
): boolean => {
  return Boolean(
    !preference ||
      (preference.order.length === 0 && preference.hidden.length === 0),
  );
};

export type ColumnPreferenceToJSONFunction = (
  preference: ColumnPreference | null | undefined,
) => JSONObject | null;

// A layout that changes nothing is stored as nothing.
export const toJSON: ColumnPreferenceToJSONFunction = (
  preference: ColumnPreference | null | undefined,
): JSONObject | null => {
  if (isEmptyColumnPreference(preference)) {
    return null;
  }

  return {
    order: [...preference!.order],
    hidden: [...preference!.hidden],
  };
};

export type ColumnPreferenceFromJSONFunction = (
  json: JSONObject | null | undefined,
) => ColumnPreference | null;

/*
 * Read a stored layout back. Anything on the way in is untrusted - it may
 * have been hand-edited in devtools or written by an older release - so each
 * list is validated on its own and a malformed one degrades to empty instead
 * of taking the other down with it.
 */
export const fromJSON: ColumnPreferenceFromJSONFunction = (
  json: JSONObject | null | undefined,
): ColumnPreference | null => {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return null;
  }

  const readIds: (value: unknown) => Array<string> = (
    value: unknown,
  ): Array<string> => {
    if (!Array.isArray(value)) {
      return [];
    }

    const seen: Set<string> = new Set();

    return value.filter((entry: unknown): entry is string => {
      if (typeof entry !== "string" || entry.length === 0 || seen.has(entry)) {
        return false;
      }
      seen.add(entry);
      return true;
    });
  };

  const preference: ColumnPreference = {
    order: readIds((json as JSONObject)["order"]),
    hidden: readIds((json as JSONObject)["hidden"]),
  };

  if (isEmptyColumnPreference(preference)) {
    return null;
  }

  return preference;
};
