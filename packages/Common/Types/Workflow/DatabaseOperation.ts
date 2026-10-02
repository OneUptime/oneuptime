import Text from "../Text";

/*
 * The eleven kinds of step BaseModelComponent.getComponents generates for
 * every model a workflow can use, by the end of their component id:
 * Find, Create, Update and Delete (one and many), and the On Create, On
 * Update and On Delete triggers.
 *
 * Kept apart from the documentation that explains them, so anything that
 * only needs to know which operation a step is - the Add Component picker
 * orders and searches by it - can ask without loading that documentation.
 * Types/Workflow/Documentation/DatabaseDocumentation re-exports both.
 */
export enum DatabaseOperation {
  FindOne = "find-one",
  FindMany = "find-many",
  CreateOne = "create-one",
  CreateMany = "create-many",
  UpdateOne = "update-one",
  UpdateMany = "update-many",
  DeleteOne = "delete-one",
  DeleteMany = "delete-many",
  OnCreate = "on-create",
  OnUpdate = "on-update",
  OnDelete = "on-delete",
}

// The steps that write rows, as opposed to reading them or reacting to a write.
export const WRITE_DATABASE_OPERATIONS: ReadonlyArray<DatabaseOperation> =
  Object.freeze([
    DatabaseOperation.CreateOne,
    DatabaseOperation.CreateMany,
    DatabaseOperation.UpdateOne,
    DatabaseOperation.UpdateMany,
    DatabaseOperation.DeleteOne,
    DatabaseOperation.DeleteMany,
  ]);

export type GetDatabaseOperationFunction = (data: {
  componentId: string;
  tableName: string;
}) => DatabaseOperation | null;

/*
 * BaseModelComponent.getComponents names each step
 * `<table name in dashes>-<operation>`.
 */
export const getDatabaseOperation: GetDatabaseOperationFunction = (data: {
  componentId: string;
  tableName: string;
}): DatabaseOperation | null => {
  const prefix: string = `${Text.pascalCaseToDashes(data.tableName)}-`;

  if (!data.componentId.startsWith(prefix)) {
    return null;
  }

  const suffix: string = data.componentId.slice(prefix.length);

  return (
    Object.values(DatabaseOperation).find(
      (operation: DatabaseOperation): boolean => {
        return operation === suffix;
      },
    ) || null
  );
};
