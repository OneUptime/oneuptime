import Column from "./Column";
import Columns from "./Columns";
import { ColumnPreference } from "./ColumnPreference";
import FieldType from "../Types/FieldType";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { JSONObject } from "../../../Types/JSON";
import React, { ReactElement } from "react";

/*
 * ---------------------------------------------------------------------------
 * One table column per key inside a Map(String, String) attributes column
 * ---------------------------------------------------------------------------
 *
 * Analytics rows (logs, spans, security events) carry the whole source
 * payload flattened into a single map column - `attributes` - so that
 * arbitrary vendor fields stay queryable without a schema change. Those keys
 * differ per event class and per source, so there is no fixed list to ship as
 * columns: the viewer picks the ones they care about and the table grows a
 * column for each.
 *
 * The shape mirrors CustomFieldColumns, and for the same reasons:
 *
 *     field:            { attributes: true }     <- a real model column
 *     selectedProperty: "device.hostname"        <- the key inside it
 *
 * which BaseModelTable turns into the column key "attributes.device.hostname".
 *
 *  - the declared field has to be the real map column. A synthetic
 *    `field: { "attributes.device.hostname": true }` would fail the model's
 *    column check in getSelectFromColumns and throw the whole table away.
 *
 *  - sorting is off. Nothing between the header and the query builder
 *    validates `sort`, so a clickable header here would send a dotted
 *    pseudo-column into ClickHouse, which can only order by a map key through
 *    an explicit `attributes['key']` subscript the sort path cannot express.
 *
 *  - cells render through `getElement`, because the typed cell renderers index
 *    `item[column.key]` directly and would look for a literal
 *    "attributes.device.hostname" property that no row has.
 *
 * WHERE THE VIEWER'S CHOICE LIVES
 *
 * Nowhere new. A column exists iff its id appears in the stored
 * ColumnPreference, and the id encodes the key, so the list of chosen
 * attribute columns is recovered from the layout the viewer already saves
 * (see getAttributeKeysFromColumnPreference). That keeps "Reset to default"
 * honest, makes a saved TableView carry its attribute columns with it, and
 * means there is no second store that can drift out of sync with the first.
 */

export type GetAttributeColumnIdFunction = (data: {
  attributesColumnKey: string;
  attributeKey: string;
}) => string;

/*
 * Deliberately the same shape ColumnPreference.getColumnBaseId would derive
 * from `field` + `selectedProperty` on its own ("attributes.device.hostname"),
 * so an explicitly-set id and a derived one can never disagree.
 */
export const getAttributeColumnId: GetAttributeColumnIdFunction = (data: {
  attributesColumnKey: string;
  attributeKey: string;
}): string => {
  return `${data.attributesColumnKey}.${data.attributeKey}`;
};

export type GetAttributeKeyFromColumnIdFunction = (data: {
  attributesColumnKey: string;
  columnId: string;
}) => string | null;

export const getAttributeKeyFromColumnId: GetAttributeKeyFromColumnIdFunction =
  (data: { attributesColumnKey: string; columnId: string }): string | null => {
    const prefix: string = `${data.attributesColumnKey}.`;

    if (!data.columnId.startsWith(prefix)) {
      return null;
    }

    const attributeKey: string = data.columnId.slice(prefix.length);

    return attributeKey.length > 0 ? attributeKey : null;
  };

export type NormalizeAttributeKeysFunction = (
  keys: Array<unknown> | null | undefined,
) => Array<string>;

/*
 * Whatever the server said, turned into a stable list: trimmed, de-duplicated,
 * and sorted. The sort is load-bearing rather than cosmetic - the picker shows
 * these in order, and an unsorted list from ClickHouse would reshuffle itself
 * between requests.
 */
export const normalizeAttributeKeys: NormalizeAttributeKeysFunction = (
  keys: Array<unknown> | null | undefined,
): Array<string> => {
  if (!Array.isArray(keys)) {
    return [];
  }

  const seen: Set<string> = new Set();
  const normalized: Array<string> = [];

  for (const key of keys) {
    if (typeof key !== "string") {
      continue;
    }

    const trimmed: string = key.trim();

    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized.sort((a: string, b: string): number => {
    return a.localeCompare(b);
  });
};

export type GetAttributeValueFunction = (data: {
  item: unknown;
  attributesColumnKey: string;
  attributeKey: string;
}) => unknown;

export const getAttributeValue: GetAttributeValueFunction = (data: {
  item: unknown;
  attributesColumnKey: string;
  attributeKey: string;
}): unknown => {
  const attributes: unknown = (data.item as JSONObject | undefined)?.[
    data.attributesColumnKey
  ];

  if (!attributes || typeof attributes !== "object") {
    return undefined;
  }

  return (attributes as JSONObject)[data.attributeKey];
};

export type GetAttributeExportValueFunction = (value: unknown) => string;

export const getAttributeExportValue: GetAttributeExportValueFunction = (
  value: unknown,
): string => {
  if (value === undefined || value === null) {
    return "";
  }

  if (Array.isArray(value)) {
    return value
      .map((entry: unknown): string => {
        return getAttributeExportValue(entry);
      })
      .join(", ");
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
};

export type RenderAttributeValueFunction = (data: {
  value: unknown;
  noValueMessage?: string | undefined;
}) => ReactElement;

/*
 * Map values arrive as strings, but the ingest side is free to write a
 * flattened object or an array under a key, and a project can PUT anything
 * over the API - so this renders whatever it is handed rather than assuming.
 */
export const renderAttributeValue: RenderAttributeValueFunction = (data: {
  value: unknown;
  noValueMessage?: string | undefined;
}): ReactElement => {
  const noValueMessage: string = data.noValueMessage ?? "-";
  const text: string = getAttributeExportValue(data.value);

  if (text.length === 0) {
    return <span className="text-gray-400">{noValueMessage}</span>;
  }

  return (
    <span className="break-words" title={text}>
      {text}
    </span>
  );
};

export type GetAttributeColumnsFunction = <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(data: {
  attributeKeys: Array<string>;
  attributesColumnKey: string;
  isHiddenByDefault?: boolean | undefined;
  noValueMessage?: string | undefined;
}) => Columns<TBaseModel>;

/*
 * `isRemovable` is what separates these from every other optional column: a
 * viewer who switches an attribute column off still has it sitting in the
 * picker forever, and a table whose source writes a few hundred keys would
 * accumulate an unusable list. Removing drops the id from the stored layout,
 * which is the same thing as the column never having been added.
 */
export const getAttributeColumns: GetAttributeColumnsFunction = <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(data: {
  attributeKeys: Array<string>;
  attributesColumnKey: string;
  isHiddenByDefault?: boolean | undefined;
  noValueMessage?: string | undefined;
}): Columns<TBaseModel> => {
  const { attributesColumnKey } = data;

  return (data.attributeKeys || []).map(
    (attributeKey: string): Column<TBaseModel> => {
      return {
        id: getAttributeColumnId({ attributesColumnKey, attributeKey }),
        field: {
          [attributesColumnKey]: true,
        } as Column<TBaseModel>["field"],
        selectedProperty: attributeKey,
        title: attributeKey,
        type: FieldType.Element,
        // See the file header: a map key is not something the sort path can express.
        disableSort: true,
        isHiddenByDefault: Boolean(data.isHiddenByDefault),
        isRemovable: true,
        getExportValue: (item: TBaseModel): string => {
          return getAttributeExportValue(
            getAttributeValue({ item, attributesColumnKey, attributeKey }),
          );
        },
        getElement: (item: TBaseModel): ReactElement => {
          return renderAttributeValue({
            value: getAttributeValue({
              item,
              attributesColumnKey,
              attributeKey,
            }),
            noValueMessage: data.noValueMessage,
          });
        },
      };
    },
  );
};

export type GetAttributeKeysFromColumnPreferenceFunction = (data: {
  preference: ColumnPreference | null | undefined;
  attributesColumnKey: string;
  /*
   * Ids of the columns the table declares for itself. A declared column that
   * happens to sit under the same prefix is not an attribute column, and
   * regenerating one for it would put two columns with the same id in the
   * picker.
   */
  reservedColumnIds?: Array<string> | undefined;
}) => Array<string>;

/*
 * The attribute columns a stored layout implies.
 *
 * Read from the RAW preference rather than the sanitized one: sanitizing drops
 * ids that name no current column, and an attribute column is only ever a
 * current column *because* its id is in here. `hidden` is scanned as well as
 * `order` - buildColumnPreference always writes both, but a payload from an
 * older release (or one hand-edited in devtools) may carry only the one, and
 * losing the column would silently discard the viewer's choice.
 */
export const getAttributeKeysFromColumnPreference: GetAttributeKeysFromColumnPreferenceFunction =
  (data: {
    preference: ColumnPreference | null | undefined;
    attributesColumnKey: string;
    reservedColumnIds?: Array<string> | undefined;
  }): Array<string> => {
    if (!data.preference) {
      return [];
    }

    const reserved: Set<string> = new Set(data.reservedColumnIds || []);
    const seen: Set<string> = new Set();
    const attributeKeys: Array<string> = [];

    const columnIds: Array<string> = [
      ...(data.preference.order || []),
      ...(data.preference.hidden || []),
    ];

    for (const columnId of columnIds) {
      if (reserved.has(columnId)) {
        continue;
      }

      const attributeKey: string | null = getAttributeKeyFromColumnId({
        attributesColumnKey: data.attributesColumnKey,
        columnId: columnId,
      });

      if (!attributeKey || seen.has(attributeKey)) {
        continue;
      }

      seen.add(attributeKey);
      attributeKeys.push(attributeKey);
    }

    return attributeKeys;
  };
