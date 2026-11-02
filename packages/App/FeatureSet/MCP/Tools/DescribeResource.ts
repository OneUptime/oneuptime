/**
 * Describe Resource
 * Answers oneuptime_describe_resource: every field of one resource, on demand.
 *
 * The list and count tools take any field, and the update tools name their
 * fields without saying what they mean (Tools/ToolGenerator), so that
 * tools/list stays small enough for a client to load whole. This is where an
 * agent finds out the rest: which fields a resource has, what each one means,
 * and how to filter, sort and select on it. It is asked for one resource at a
 * time, so only an agent that needs it pays for it.
 */

import AnalyticsBaseModel, {
  AnalyticsBaseModelType,
} from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import AnalyticsColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import {
  getTableColumns,
  TableColumnMetadata,
} from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import { JSONObject } from "Common/Types/JSON";
import { ModelSchema } from "Common/Utils/Schema/ModelSchema";
import { getSchemaFieldNames } from "Common/Utils/Schema/SchemaFields";
import {
  findModelClass,
  getSelectableFieldsForModel,
  SelectableFieldsInfo,
} from "../Services/SelectFieldGenerator";
import ModelType from "../Types/ModelType";

export interface DescribableResource {
  name: string;
  singularName: string;
  modelType: ModelType;
  tools: Record<string, string>;
}

interface DescribedField {
  type: string;
  description?: string;
  // Can be used in `query`, with the operators of its type.
  filter?: true;
  // Can be used in `sort`.
  sort?: true;
  // Comes back only when `select` names it.
  large?: true;
  // Can be written and never read back.
  writeOnly?: true;
}

// What a resource's fields come to, whichever kind of model it is.
interface ResourceFields {
  fields: Record<string, DescribedField>;
  operatorsByType: Record<string, Array<string>>;
  // A field to filter and sort an example on.
  timeField: string;
}

const PART_OF_THE_TEXT: string = "<part of the text>";
const NUMBER_OR_TIME: string = "<number or ISO-8601 time>";

/*
 * How each operator is written. These are what JSONFunctions.deserialize
 * reads on the API: the shapes are not all alike (InBetween has no `value`,
 * IsNull and NotNull nothing to compare), which is why they are spelled out.
 */
const OPERATOR_SYNTAX: Record<string, JSONObject> = {
  EqualTo: { _type: "EqualTo", value: "<value>" },
  NotEqual: { _type: "NotEqual", value: "<value>" },
  EqualToOrNull: { _type: "EqualToOrNull", value: "<value>" },
  GreaterThan: { _type: "GreaterThan", value: NUMBER_OR_TIME },
  GreaterThanOrEqual: { _type: "GreaterThanOrEqual", value: NUMBER_OR_TIME },
  LessThan: { _type: "LessThan", value: NUMBER_OR_TIME },
  LessThanOrEqual: { _type: "LessThanOrEqual", value: NUMBER_OR_TIME },
  InBetween: {
    _type: "InBetween",
    startValue: NUMBER_OR_TIME,
    endValue: NUMBER_OR_TIME,
  },
  Search: { _type: "Search", value: PART_OF_THE_TEXT },
  Includes: { _type: "Includes", value: ["<any of these values>"] },
  IsNull: { _type: "IsNull" },
  NotNull: { _type: "NotNull" },
};

const PRESENCE_OPERATORS: Array<string> = ["IsNull", "NotNull"];

const EQUALITY_OPERATORS: Array<string> = [
  "EqualTo",
  "NotEqual",
  ...PRESENCE_OPERATORS,
];

const ID_OPERATORS: Array<string> = [...EQUALITY_OPERATORS, "Includes"];

const TEXT_OPERATORS: Array<string> = [
  ...ID_OPERATORS,
  "EqualToOrNull",
  "Search",
];

const RANGE_OPERATORS: Array<string> = [
  ...EQUALITY_OPERATORS,
  "GreaterThan",
  "GreaterThanOrEqual",
  "LessThan",
  "LessThanOrEqual",
  "InBetween",
];

/*
 * What a telemetry column can be filtered with, as StatementGenerator compiles
 * it; Tests/DescribeResource runs every one of these through it.
 *
 * This is not AnalyticsModelSchema's list, which documents the REST API and
 * says less than the API does: it gives a DateTime64 or a UInt64 column no
 * range operators, though telemetry's own `time` is a DateTime64 and every
 * query should bound it, and a map column operators that throw.
 */
const TELEMETRY_OPERATORS: Partial<Record<AnalyticsColumnType, Array<string>>> =
  {
    [AnalyticsColumnType.Text]: TEXT_OPERATORS,
    [AnalyticsColumnType.ArrayText]: [...ID_OPERATORS, "Search"],
    [AnalyticsColumnType.ObjectID]: ID_OPERATORS,
    [AnalyticsColumnType.IP]: ID_OPERATORS,
    [AnalyticsColumnType.Boolean]: EQUALITY_OPERATORS,
    [AnalyticsColumnType.Date]: RANGE_OPERATORS,
    [AnalyticsColumnType.DateTime64]: RANGE_OPERATORS,
    [AnalyticsColumnType.Number]: RANGE_OPERATORS,
    [AnalyticsColumnType.LongNumber]: RANGE_OPERATORS,
    [AnalyticsColumnType.BigNumber]: RANGE_OPERATORS,
    [AnalyticsColumnType.Decimal]: RANGE_OPERATORS,
    [AnalyticsColumnType.UInt8]: RANGE_OPERATORS,
    [AnalyticsColumnType.UInt64]: RANGE_OPERATORS,
    [AnalyticsColumnType.Port]: RANGE_OPERATORS,
    [AnalyticsColumnType.ArrayNumber]: PRESENCE_OPERATORS,
    [AnalyticsColumnType.ArrayBigNumber]: PRESENCE_OPERATORS,
    [AnalyticsColumnType.ArrayDecimal]: PRESENCE_OPERATORS,
    [AnalyticsColumnType.JSON]: PRESENCE_OPERATORS,
    [AnalyticsColumnType.JSONArray]: PRESENCE_OPERATORS,
    [AnalyticsColumnType.MapStringString]: [...EQUALITY_OPERATORS, "Search"],
  };

// A telemetry column ClickHouse has no useful order for.
const TELEMETRY_UNSORTABLE_TYPES: Array<AnalyticsColumnType> = [
  AnalyticsColumnType.ArrayText,
  AnalyticsColumnType.ArrayNumber,
  AnalyticsColumnType.ArrayBigNumber,
  AnalyticsColumnType.ArrayDecimal,
  AnalyticsColumnType.JSON,
  AnalyticsColumnType.JSONArray,
  AnalyticsColumnType.MapStringString,
  AnalyticsColumnType.AggregateFunction,
];

/*
 * Number columns ModelSchema's sort schema leaves out, though the API orders
 * by any column: the least severe severity is the one last by its `order`.
 */
const DATABASE_NUMBER_TYPES: Array<TableColumnType> = [
  TableColumnType.SmallNumber,
  TableColumnType.SmallPositiveNumber,
  TableColumnType.PositiveNumber,
  TableColumnType.BigNumber,
  TableColumnType.BigPositiveNumber,
];

/*
 * Telemetry columns anyone may read though they name nobody who may: the API
 * passes these before it looks at a column's readers (ModelPermission).
 */
const TELEMETRY_ALWAYS_READABLE: Array<string> = ["_id", "createdAt"];

function describeDatabaseFields(
  modelType: DatabaseBaseModelType,
): ResourceFields {
  const model: DatabaseBaseModel = new modelType();
  const columns: Record<string, TableColumnMetadata> = getTableColumns(model);
  const selectable: SelectableFieldsInfo = getSelectableFieldsForModel(model);

  const queryFields: Array<string> = getSchemaFieldNames(
    ModelSchema.getQueryModelSchema({ modelType, disableOpenApiSchema: true }),
  );
  const sortFields: Array<string> = getSchemaFieldNames(
    ModelSchema.getSortModelSchema({ modelType, disableOpenApiSchema: true }),
  );
  const writableFields: Array<string> = [
    ...getSchemaFieldNames(
      ModelSchema.getCreateModelSchema({
        modelType,
        disableOpenApiSchema: true,
      }),
    ),
    ...getSchemaFieldNames(
      ModelSchema.getUpdateModelSchema({
        modelType,
        disableOpenApiSchema: true,
      }),
    ),
  ];

  const fields: Record<string, DescribedField> = {};
  const operatorsByType: Record<string, Array<string>> = {};

  for (const [name, column] of Object.entries(columns)) {
    const isReadable: boolean = selectable.allFields.includes(name);

    // Nobody can read it, and no tool can write it: nothing to say about it.
    if (!isReadable && !writableFields.includes(name)) {
      continue;
    }

    const field: DescribedField = { type: column.type };

    if (column.description) {
      field.description = column.description;
    }

    // The API refuses a filter on a column nobody may read.
    if (isReadable && queryFields.includes(name)) {
      field.filter = true;
      operatorsByType[column.type] = ModelSchema.getValidOperatorsForColumnType(
        column.type,
      );
    }

    // A sort is offered on readable columns only, as a filter is.
    if (
      isReadable &&
      (sortFields.includes(name) || DATABASE_NUMBER_TYPES.includes(column.type))
    ) {
      field.sort = true;
    }

    if (selectable.heavyFields.includes(name)) {
      field.large = true;
    }

    if (!isReadable) {
      field.writeOnly = true;
    }

    fields[name] = field;
  }

  return { fields, operatorsByType, timeField: "createdAt" };
}

function describeAnalyticsFields(
  modelType: AnalyticsBaseModelType,
): ResourceFields {
  const model: AnalyticsBaseModel = new modelType();

  const fields: Record<string, DescribedField> = {};
  const operatorsByType: Record<string, Array<string>> = {};

  for (const column of model.getTableColumns() as Array<AnalyticsTableColumn>) {
    const isReadable: boolean =
      TELEMETRY_ALWAYS_READABLE.includes(column.key) ||
      (column.accessControl?.read || []).length > 0;

    // Telemetry is read-only here, so an unreadable column is of no use.
    if (!isReadable) {
      continue;
    }

    const field: DescribedField = { type: column.type };

    if (column.description) {
      field.description = column.description;
    }

    const operators: Array<string> | undefined =
      TELEMETRY_OPERATORS[column.type];

    if (operators) {
      field.filter = true;
      operatorsByType[column.type] = operators;
    }

    if (!TELEMETRY_UNSORTABLE_TYPES.includes(column.type)) {
      field.sort = true;
    }

    fields[column.key] = field;
  }

  return { fields, operatorsByType, timeField: model.defaultSortColumn };
}

// The fields people search on first, where a resource has one.
const EXAMPLE_SEARCH_FIELDS: Array<string> = ["title", "name", "body"];

// A filter, sort and limit this resource really takes, ready to adapt.
function buildExample(
  resource: DescribableResource,
  described: ResourceFields,
): JSONObject {
  const { fields, operatorsByType, timeField } = described;

  const searchableFields: Array<string> = Object.keys(fields).filter(
    (name: string): boolean => {
      const field: DescribedField = fields[name] as DescribedField;

      return (
        Boolean(field.filter) &&
        Boolean(operatorsByType[field.type]?.includes("Search"))
      );
    },
  );

  const searchableField: string | undefined =
    EXAMPLE_SEARCH_FIELDS.find((name: string): boolean => {
      return searchableFields.includes(name);
    }) || searchableFields[0];

  const query: JSONObject = {
    [timeField]: OPERATOR_SYNTAX["GreaterThan"] as JSONObject,
  };

  if (searchableField) {
    query[searchableField] = OPERATOR_SYNTAX["Search"] as JSONObject;
  }

  return {
    tool: resource.tools["list"] as string,
    arguments: { query, sort: { [timeField]: "DESC" }, limit: 10 },
  };
}

// How `query`, `sort` and `select` are written for this resource.
function buildUsage(
  resource: DescribableResource,
  described: ResourceFields,
): JSONObject {
  const usage: JSONObject = {
    query:
      'Pass {"<field>": <value or operator>}. A plain value matches exactly, and every field given must match. Use fields marked filter, with the operators of their type.',
    sort: 'Pass {"<field>": "ASC" or "DESC"}. Use fields marked sort.',
    select: `Pass an array of field names. Omit it for all readable fields${
      resource.modelType === ModelType.Database
        ? ", except those marked large, which come back only when selected."
        : ". Select only what you need: telemetry rows can be large."
    }`,
  };

  if (resource.modelType === ModelType.Analytics) {
    usage["time"] =
      `Telemetry tables are large: always filter on ${described.timeField}.`;
  }

  const mapField: string | undefined = Object.keys(described.fields).find(
    (name: string): boolean => {
      return (
        described.fields[name]?.type === AnalyticsColumnType.MapStringString
      );
    },
  );

  if (mapField) {
    usage["maps"] =
      `A ${AnalyticsColumnType.MapStringString} field is filtered by its keys: {"${mapField}": {"<key>": <value or operator>}}.`;
  }

  return usage;
}

function buildDescription(resource: DescribableResource): JSONObject {
  const ModelClass:
    | { new (): DatabaseBaseModel }
    | { new (): AnalyticsBaseModel }
    | null = findModelClass(resource.name, resource.modelType);

  if (!ModelClass) {
    throw new Error(`No model found for ${resource.singularName}.`);
  }

  const described: ResourceFields =
    resource.modelType === ModelType.Database
      ? describeDatabaseFields(ModelClass as DatabaseBaseModelType)
      : describeAnalyticsFields(ModelClass as AnalyticsBaseModelType);

  const usedOperators: Set<string> = new Set(
    Object.values(described.operatorsByType).flat(),
  );

  return {
    success: true,
    resource: resource.singularName,
    tools: resource.tools,
    usage: buildUsage(resource, described),
    operators: Object.fromEntries(
      Object.entries(OPERATOR_SYNTAX).filter(([name]: [string, JSONObject]) => {
        return usedOperators.has(name);
      }),
    ),
    operatorsByType: described.operatorsByType,
    example: buildExample(resource, described),
    fields: described.fields as unknown as JSONObject,
  };
}

// A model's columns do not change while the process runs.
const descriptions: Map<string, string> = new Map();

export function describeResource(resource: DescribableResource): string {
  let description: string | undefined = descriptions.get(resource.name);

  if (description === undefined) {
    // Compact: an agent reads this, and pays for every byte of it.
    description = JSON.stringify(buildDescription(resource));
    descriptions.set(resource.name, description);
  }

  return description;
}
