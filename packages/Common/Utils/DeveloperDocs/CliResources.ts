import AnalyticsBaseModel, {
  AnalyticsBaseModelType,
} from "../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsModels from "../../Models/AnalyticsModels/Index";
import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseModels from "../../Models/DatabaseModels/Index";
import {
  CliAction,
  CliOperation,
  CliResourceType,
  getCliActions,
  getCliAnalyticsOperationsOf,
  getCliDatabaseOperationsOf,
  getCliResourceName,
} from "./CliCommands";
import { toTerraformTypeSnakeCase } from "./TerraformSchema";

/*
 * EVERY RESOURCE COMMAND OF THE CLI
 *
 * One per resource of the OneUptime REST API, records first in the order
 * the models are listed, then telemetry (CliCommands.ts says which, and
 * what each takes). Read by the CLI, which builds a command for each, and
 * by the docs, whose command reference lists them from here
 * ({{CLI_RESOURCE_COMMANDS}}), so neither is written down by hand.
 *
 * Kept apart from CliCommands.ts because it loads every model: the
 * dashboard reads one model at a time.
 */

export interface CliResource {
  // The command: `incident`, `on-call-policy`.
  name: string;
  singularName: string;
  pluralName: string;
  tableName: string;
  // Its path under /api: `/incident`.
  apiPath: string;
  modelType: CliResourceType;
  operations: Array<CliOperation>;
  actions: Array<CliAction>;
}

const LEADING_SLASHES: RegExp = /^\/+/;
const UNDERSCORES: RegExp = /_/g;

function toApiPath(path: string): string {
  return `/${path.replace(LEADING_SLASHES, "")}`;
}

/*
 * The model's command (getCliResourceName), or - should a new model share
 * a name with another before ClientResourceNames tells them apart - the
 * table's name, so the CLI still starts with a command for each.
 * Tests/ApiParity in packages/CLI fails on that second case.
 */
function uniqueName(
  model: {
    tableName: string;
    singularName: string;
    apiSingularName?: string | null | undefined;
  },
  taken: Set<string>,
): string {
  const name: string = getCliResourceName(model);

  if (!taken.has(name)) {
    return name;
  }

  return toTerraformTypeSnakeCase(model.tableName).replace(UNDERSCORES, "-");
}

function databaseResource(
  modelType: DatabaseBaseModelType,
  taken: Set<string>,
): CliResource | null {
  const model: DatabaseBaseModel = new modelType();
  const operations: Array<CliOperation> = getCliDatabaseOperationsOf(model);

  if (operations.length === 0) {
    return null;
  }

  const tableName: string = model.tableName || modelType.name;
  const singularName: string = model.singularName || tableName;

  return {
    // The command keeps the name the API keeps; its help says the new one.
    name: uniqueName(
      { tableName, singularName, apiSingularName: model.apiSingularName },
      taken,
    ),
    singularName,
    pluralName: model.pluralName || `${singularName}s`,
    tableName,
    apiPath: toApiPath(model.crudApiPath?.toString() || ""),
    modelType: "database",
    operations,
    actions: getCliActions(tableName),
  };
}

function analyticsResource(
  modelType: AnalyticsBaseModelType,
  taken: Set<string>,
): CliResource | null {
  const model: AnalyticsBaseModel = new modelType();
  const operations: Array<CliOperation> = getCliAnalyticsOperationsOf(model);

  if (operations.length === 0) {
    return null;
  }

  const tableName: string = model.tableName || modelType.name;
  const singularName: string = model.singularName || tableName;

  return {
    name: uniqueName({ tableName, singularName }, taken),
    singularName,
    pluralName: model.pluralName || `${singularName}s`,
    tableName,
    apiPath: toApiPath(model.crudApiPath?.toString() || ""),
    modelType: "analytics",
    operations,
    actions: [],
  };
}

let resources: Array<CliResource> | null = null;

/*
 * Every resource command, records then telemetry. Worked out once: the
 * models do not change while a process runs.
 */
export function getCliResources(): Array<CliResource> {
  if (resources) {
    return resources;
  }

  const found: Array<CliResource> = [];
  const taken: Set<string> = new Set<string>();

  const add: (resource: CliResource | null) => void = (
    resource: CliResource | null,
  ): void => {
    if (!resource) {
      return;
    }

    taken.add(resource.name);
    found.push(resource);
  };

  for (const modelType of DatabaseModels) {
    add(databaseResource(modelType, taken));
  }

  for (const modelType of AnalyticsModels) {
    add(analyticsResource(modelType, taken));
  }

  resources = found;

  return found;
}

// A resource by its command, or null.
export function getCliResource(name: string): CliResource | null {
  return (
    getCliResources().find((resource: CliResource): boolean => {
      return resource.name === name;
    }) || null
  );
}

// A resource by its model's table name, or null.
export function getCliResourceByTableName(
  tableName: string,
): CliResource | null {
  return (
    getCliResources().find((resource: CliResource): boolean => {
      return resource.tableName === tableName;
    }) || null
  );
}

// The record model of a resource, for its fields and flags.
export function getCliDatabaseModelType(
  resource: CliResource,
): DatabaseBaseModelType | null {
  if (resource.modelType !== "database") {
    return null;
  }

  return (
    DatabaseModels.find((modelType: DatabaseBaseModelType): boolean => {
      return new modelType().tableName === resource.tableName;
    }) || null
  );
}

// The telemetry model of a resource.
export function getCliAnalyticsModelType(
  resource: CliResource,
): AnalyticsBaseModelType | null {
  if (resource.modelType !== "analytics") {
    return null;
  }

  return (
    AnalyticsModels.find((modelType: AnalyticsBaseModelType): boolean => {
      return new modelType().tableName === resource.tableName;
    }) || null
  );
}
