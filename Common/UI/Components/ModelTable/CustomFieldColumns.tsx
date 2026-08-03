import Column from "./Column";
import Columns from "./Columns";
import FieldType from "../Types/FieldType";
import DropdownValueBadge from "../Dropdown/DropdownValueBadge";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import {
  CustomFieldDropdownOption,
  parseCustomFieldDropdownOptions,
} from "../../../Types/CustomField/CustomFieldDropdownOption";
import { JSONObject } from "../../../Types/JSON";
import React, { ReactElement } from "react";

/*
 * ---------------------------------------------------------------------------
 * One table column per custom field
 * ---------------------------------------------------------------------------
 *
 * Custom field *definitions* live in a per-resource table (MonitorCustomField,
 * IncidentCustomField, ...); the *values* live in a single `customFields`
 * jsonb column on the resource itself, keyed by the definition's name. So a
 * generated column reads the whole JSON column and picks one key out of it:
 *
 *     field:            { customFields: true }   <- a real model column
 *     selectedProperty: "Severity"               <- the key inside it
 *
 * which BaseModelTable turns into the column key "customFields.Severity".
 *
 * Two things about that shape are load-bearing:
 *
 *  - the declared field has to be the real column. A synthetic
 *    `field: { "customFields.Severity": true }` would fail the model's column
 *    check in getSelectFromColumns and throw the whole table away.
 *
 *  - sorting has to be off. Nothing downstream validates `sort` before it
 *    reaches TypeORM, so a clickable header here would send an unknown
 *    property into the query builder. Postgres can only order by a jsonb
 *    key through an explicit ->> expression, which the sort path has no
 *    concept of.
 *
 * Cells render through `getElement` for the same class of reason: the typed
 * cell renderers index `item[column.key]` directly, so they would look for a
 * literal "customFields.Severity" property and find nothing. Only the
 * fall-through text branch understands a dotted key.
 */

export interface CustomFieldDefinition {
  name: string;
  description?: string | undefined;
  customFieldType?: CustomFieldType | undefined;
  dropdownOptions?: string | undefined;
}

export const CustomFieldsColumnKey: string = "customFields";

export type ParseDropdownOptionsFunction = (
  value: string | undefined | null,
) => Array<CustomFieldDropdownOption>;

/*
 * Kept as an exported wrapper for callers and tests that historically used
 * this module's parser. The shared parser understands both legacy newline
 * values and the colored JSON representation.
 */
export const parseDropdownOptions: ParseDropdownOptionsFunction = (
  value: string | undefined | null,
): Array<CustomFieldDropdownOption> => {
  return parseCustomFieldDropdownOptions(value);
};

export type GetCustomFieldDefinitionsFunction = (
  items: Array<BaseModel | JSONObject>,
) => Array<CustomFieldDefinition>;

/*
 * Normalise whatever the definition API returned into a plain, sorted list.
 *
 * Sorting matters: the definition models carry no ordering column and the
 * list endpoint is queried with an empty sort, so Postgres is free to hand
 * back a different order on every request. Without a deterministic order
 * here, a viewer's saved column layout would appear to shuffle itself
 * between page loads.
 */
export const getCustomFieldDefinitions: GetCustomFieldDefinitionsFunction = (
  items: Array<BaseModel | JSONObject>,
): Array<CustomFieldDefinition> => {
  const definitions: Array<CustomFieldDefinition> = [];
  const seenNames: Set<string> = new Set();

  for (const item of items || []) {
    const name: unknown = (item as JSONObject)?.["name"];

    if (typeof name !== "string" || name.trim().length === 0) {
      continue;
    }

    const trimmedName: string = name.trim();

    if (seenNames.has(trimmedName)) {
      continue;
    }

    seenNames.add(trimmedName);

    const description: unknown = (item as JSONObject)["description"];
    const customFieldType: unknown = (item as JSONObject)["customFieldType"];
    const dropdownOptions: unknown = (item as JSONObject)["dropdownOptions"];

    definitions.push({
      name: trimmedName,
      description: typeof description === "string" ? description : undefined,
      customFieldType:
        typeof customFieldType === "string"
          ? (customFieldType as CustomFieldType)
          : undefined,
      dropdownOptions:
        typeof dropdownOptions === "string" ? dropdownOptions : undefined,
    });
  }

  return definitions.sort(
    (a: CustomFieldDefinition, b: CustomFieldDefinition) => {
      return a.name.localeCompare(b.name);
    },
  );
};

export type GetCustomFieldValueFunction = (
  item: unknown,
  name: string,
) => unknown;

export const getCustomFieldValue: GetCustomFieldValueFunction = (
  item: unknown,
  name: string,
): unknown => {
  const customFields: unknown = (item as JSONObject | undefined)?.[
    CustomFieldsColumnKey
  ];

  if (!customFields || typeof customFields !== "object") {
    return undefined;
  }

  return (customFields as JSONObject)[name];
};

type BadgeFunction = (data: {
  label: string;
  key: string;
  color?: string | undefined;
}) => ReactElement;

const badge: BadgeFunction = (data: {
  label: string;
  key: string;
  color?: string | undefined;
}): ReactElement => {
  return (
    <DropdownValueBadge key={data.key} label={data.label} color={data.color} />
  );
};

export type RenderCustomFieldValueFunction = (data: {
  value: unknown;
  definition: CustomFieldDefinition;
  noValueMessage?: string | undefined;
}) => ReactElement;

export const renderCustomFieldValue: RenderCustomFieldValueFunction = (data: {
  value: unknown;
  definition: CustomFieldDefinition;
  noValueMessage?: string | undefined;
}): ReactElement => {
  const { value, definition } = data;
  const noValueMessage: string = data.noValueMessage ?? "-";

  const empty: ReactElement = (
    <span className="text-gray-400">{noValueMessage}</span>
  );

  if (value === undefined || value === null || value === "") {
    return empty;
  }

  if (definition.customFieldType === CustomFieldType.Boolean) {
    /*
     * A boolean custom field renders "No" rather than falling into the empty
     * branch above - `false` is a real answer, not a missing one.
     */
    const isTrue: boolean = value === true || value === "true";

    return (
      <span
        className={
          isTrue
            ? "inline-flex items-center px-2 py-1 rounded-md bg-green-50 text-green-700 text-xs font-medium ring-1 ring-inset ring-green-600/20"
            : "inline-flex items-center px-2 py-1 rounded-md bg-gray-50 text-gray-600 text-xs font-medium ring-1 ring-inset ring-gray-500/10"
        }
      >
        {isTrue ? "Yes" : "No"}
      </span>
    );
  }

  if (definition.customFieldType === CustomFieldType.MultiSelectDropdown) {
    /*
     * Tolerant on the way out: an older single-select value that was later
     * switched to multi-select is still a bare string in the JSON.
     */
    const values: Array<unknown> = Array.isArray(value) ? value : [value];

    const labels: Array<string> = values
      .filter((entry: unknown) => {
        return entry !== undefined && entry !== null && entry !== "";
      })
      .map((entry: unknown) => {
        return String(entry);
      });

    if (labels.length === 0) {
      return empty;
    }

    const configuredOptions: Array<CustomFieldDropdownOption> =
      parseDropdownOptions(definition.dropdownOptions);

    return (
      <div className="flex flex-wrap gap-1.5">
        {labels.map((label: string, index: number) => {
          const option: CustomFieldDropdownOption | undefined =
            configuredOptions.find(
              (configuredOption: CustomFieldDropdownOption) => {
                return configuredOption.value === label;
              },
            );

          return badge({
            label,
            key: `${label}-${index}`,
            color: option?.color,
          });
        })}
      </div>
    );
  }

  if (definition.customFieldType === CustomFieldType.Dropdown) {
    const label: string = String(value);
    const option: CustomFieldDropdownOption | undefined = parseDropdownOptions(
      definition.dropdownOptions,
    ).find((configuredOption: CustomFieldDropdownOption) => {
      return configuredOption.value === label;
    });

    return badge({ label, key: label, color: option?.color });
  }

  if (Array.isArray(value)) {
    return <span>{value.join(", ")}</span>;
  }

  if (typeof value === "object") {
    return <span>{JSON.stringify(value)}</span>;
  }

  return <span>{String(value)}</span>;
};

export type GetCustomFieldColumnsFunction = <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(data: {
  definitions: Array<CustomFieldDefinition>;
  isHiddenByDefault?: boolean | undefined;
}) => Columns<TBaseModel>;

/*
 * Custom field columns default to hidden. A project is free to define a dozen
 * of them, and turning every one on by default would push the columns the
 * table was designed around off the side of the screen the first time anyone
 * opens it. They are all listed in the column picker, one click away.
 */
export const getCustomFieldColumns: GetCustomFieldColumnsFunction = <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(data: {
  definitions: Array<CustomFieldDefinition>;
  isHiddenByDefault?: boolean | undefined;
}): Columns<TBaseModel> => {
  const isHidden: boolean = data.isHiddenByDefault !== false;

  return (data.definitions || []).map(
    (definition: CustomFieldDefinition): Column<TBaseModel> => {
      return {
        id: `${CustomFieldsColumnKey}.${definition.name}`,
        field: {
          [CustomFieldsColumnKey]: true,
        } as Column<TBaseModel>["field"],
        selectedProperty: definition.name,
        title: definition.name,
        description: definition.description,
        type: FieldType.Element,
        /*
         * See the file header: sorting a jsonb key is not something the
         * query path can express.
         */
        disableSort: true,
        isHiddenByDefault: isHidden,
        getExportValue: (item: TBaseModel): string => {
          const value: unknown = getCustomFieldValue(item, definition.name);

          if (value === undefined || value === null) {
            return "";
          }

          if (Array.isArray(value)) {
            return value.join(", ");
          }

          if (typeof value === "object") {
            return JSON.stringify(value);
          }

          return String(value);
        },
        getElement: (item: TBaseModel): ReactElement => {
          return renderCustomFieldValue({
            value: getCustomFieldValue(item, definition.name),
            definition: definition,
          });
        },
      };
    },
  );
};
