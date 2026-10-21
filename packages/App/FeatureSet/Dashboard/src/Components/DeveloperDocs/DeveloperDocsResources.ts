import {
  DEVELOPER_DOCS_RESOURCE_OPTIONS,
  DeveloperDocsResourceOptions,
} from "./DeveloperDocsPages";
import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

/*
 * A resource the Developer pages are about: its model, and how the pages
 * word and start it (DEVELOPER_DOCS_RESOURCE_OPTIONS).
 */
export interface DeveloperDocsResource extends DeveloperDocsResourceOptions {
  modelType: DatabaseBaseModelType;
}

export function getDeveloperDocsResource(
  modelType: DatabaseBaseModelType,
): DeveloperDocsResource {
  const tableName: string = new modelType().tableName || "";

  return {
    ...(DEVELOPER_DOCS_RESOURCE_OPTIONS[tableName] || {}),
    modelType,
  };
}

export function getDeveloperDocsSingularName(
  resource: DeveloperDocsResource,
): string {
  const model: DatabaseBaseModel = new resource.modelType();

  return resource.singularName || model.singularName || model.tableName || "";
}

export function getDeveloperDocsPluralName(
  resource: DeveloperDocsResource,
): string {
  const model: DatabaseBaseModel = new resource.modelType();

  return (
    resource.pluralName ||
    model.pluralName ||
    `${getDeveloperDocsSingularName(resource)}s`
  );
}
