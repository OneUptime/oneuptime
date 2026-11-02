import { ResourceInfo } from "../Types/CLITypes";
import { isReadableColumn } from "./SelectFieldGenerator";
import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { AnalyticsBaseModelType } from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Dictionary from "Common/Types/Dictionary";
import {
  getTableColumns,
  TableColumnMetadata,
} from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import { JSONObject } from "Common/Types/JSON";
import {
  CLI_FIELDS_SUBCOMMAND,
  CliAnalyticsField,
  CliFieldFlag,
  getCliAnalyticsFields,
  getCliDatabaseOperations,
  getCliFieldFlags,
  getCliResourceName,
  isCliServerSetColumn,
} from "Common/Utils/DeveloperDocs/CliCommands";
import {
  getTerraformAttributes,
  TerraformAttributeDescriptor,
} from "Common/Utils/DeveloperDocs/TerraformSchema";
import {
  getCliAnalyticsModelType,
  getCliDatabaseModelType,
  getCliResource,
} from "Common/Utils/DeveloperDocs/CliResources";

/*
 * `oneuptime <resource> fields`: every field a resource has, what it is
 * for, and how a command reaches it - the flag that sets it, whether a
 * create must give it, whether a key may read it back. Read from the
 * models, so it needs no API key and asks OneUptime nothing: what an agent
 * reads before it writes a create, the CLI's answer to the MCP server's
 * oneuptime_describe_resource tool.
 *
 * The JSON keeps the same fields for every resource, for scripts.
 */

export interface DescribedField {
  name: string;
  title: string;
  type: string;
  description: string;
  // A create must give it.
  required: boolean;
  // A create, an update may set it.
  create: boolean;
  update: boolean;
  // A list or a get may read it back.
  read: boolean;
  // The flag that sets it: null when it is set in --data, or not at all.
  flag: string | null;
  // The flag that names the person in it by email address instead.
  emailFlag: string | null;
  // The command of the resource it names records of: incident-severity.
  relatedResource: string | null;
}

export interface ResourceDescription {
  resource: string;
  singularName: string;
  pluralName: string;
  type: "database" | "analytics";
  apiPath: string;
  commands: Array<string>;
  fields: Array<DescribedField>;
}

// The subcommands of a resource, in the order it has them.
export function getResourceSubcommands(resource: ResourceInfo): Array<string> {
  return [...resource.operations, CLI_FIELDS_SUBCOMMAND, ...resource.actions];
}

const LINE_BREAKS: RegExp = /\s+/g;

function oneLine(text: string | undefined): string {
  return (text || "").replace(LINE_BREAKS, " ").trim();
}

/*
 * The resource a column's records belong to: an ID's relation
 * (`incidentSeverityId` is the key of `incidentSeverity`), a list's model
 * (`labels`), or a relation's own.
 */
function getRelatedModels(
  columns: Dictionary<TableColumnMetadata>,
): Dictionary<DatabaseBaseModelType> {
  const related: Dictionary<DatabaseBaseModelType> = {};

  for (const [name, column] of Object.entries(columns)) {
    if (!column.modelType) {
      continue;
    }

    const modelType: DatabaseBaseModelType =
      column.modelType as DatabaseBaseModelType;

    if (
      column.type === TableColumnType.Entity ||
      column.type === TableColumnType.EntityArray
    ) {
      related[name] = modelType;
    }

    if (
      column.type === TableColumnType.Entity &&
      column.manyToOneRelationColumn
    ) {
      related[column.manyToOneRelationColumn] = modelType;
    }
  }

  return related;
}

function relatedResourceOf(
  modelType: DatabaseBaseModelType | undefined,
): string | null {
  if (!modelType || getCliDatabaseOperations(modelType).length === 0) {
    return null;
  }

  return getCliResourceName(new modelType());
}

function describeDatabaseFields(
  modelType: DatabaseBaseModelType,
): Array<DescribedField> {
  const model: DatabaseBaseModel = new modelType();
  const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);
  const related: Dictionary<DatabaseBaseModelType> = getRelatedModels(columns);
  const attributes: Map<string, TerraformAttributeDescriptor> = new Map(
    getTerraformAttributes(modelType).map(
      (
        descriptor: TerraformAttributeDescriptor,
      ): [string, TerraformAttributeDescriptor] => {
        return [descriptor.columnName, descriptor];
      },
    ),
  );
  const flags: Map<string, CliFieldFlag> = new Map(
    getCliFieldFlags(modelType).map(
      (flag: CliFieldFlag): [string, CliFieldFlag] => {
        return [flag.columnName, flag];
      },
    ),
  );
  const fields: Array<DescribedField> = [];

  for (const [name, column] of Object.entries(columns)) {
    const descriptor: TerraformAttributeDescriptor | undefined =
      attributes.get(name);
    const read: boolean = isReadableColumn(model, name);

    // Nobody may read it and no request may write it: nothing to say.
    if (!read && !descriptor) {
      continue;
    }

    const flag: CliFieldFlag | undefined = flags.get(name);
    /*
     * The project comes from the API key, and who created or deleted a
     * record from the request: no create or update sets them.
     */
    const writable: boolean = !isCliServerSetColumn(name);

    fields.push({
      name,
      title: column.title || name,
      type: column.type,
      description: oneLine(column.description),
      required: writable && Boolean(descriptor?.isRequired),
      create: writable && Boolean(descriptor?.inCreateSchema),
      update: writable && Boolean(descriptor?.inUpdateSchema),
      read,
      flag: flag?.flag || null,
      emailFlag: flag?.person?.flag || null,
      relatedResource: relatedResourceOf(related[name]),
    });
  }

  return fields;
}

function describeAnalyticsFields(
  modelType: AnalyticsBaseModelType,
): Array<DescribedField> {
  return getCliAnalyticsFields(modelType)
    .filter((field: CliAnalyticsField): boolean => {
      return field.isReadable || field.inCreate || field.inUpdate;
    })
    .map((field: CliAnalyticsField): DescribedField => {
      return {
        name: field.columnName,
        title: field.title,
        type: field.type,
        description: field.description,
        required: field.isRequired && field.inCreate,
        create: field.inCreate,
        update: field.inUpdate,
        read: field.isReadable,
        flag: null,
        emailFlag: null,
        relatedResource: null,
      };
    });
}

// Everything `oneuptime <resource> fields` says about a resource.
export function describeResource(resource: ResourceInfo): ResourceDescription {
  const found: ReturnType<typeof getCliResource> = getCliResource(
    resource.name,
  );
  let fields: Array<DescribedField> = [];

  if (found) {
    const databaseModel: DatabaseBaseModelType | null =
      getCliDatabaseModelType(found);
    const analyticsModel: AnalyticsBaseModelType | null =
      getCliAnalyticsModelType(found);

    if (databaseModel) {
      fields = describeDatabaseFields(databaseModel);
    } else if (analyticsModel) {
      fields = describeAnalyticsFields(analyticsModel);
    }
  }

  return {
    resource: resource.name,
    singularName: resource.singularName,
    pluralName: resource.pluralName,
    type: resource.modelType,
    apiPath: resource.apiPath,
    commands: getResourceSubcommands(resource),
    fields,
  };
}

// As JSON: the object above, for scripts.
export function toResourceDescriptionJson(
  description: ResourceDescription,
): JSONObject {
  return description as unknown as JSONObject;
}
