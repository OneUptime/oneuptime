import type BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import type { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import type TableColumnTypeEnum from "../../../Types/Database/TableColumnType";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * EVERY RELATION RESOLVES, WHICHEVER MODEL A PROCESS LOADS FIRST.
 *
 * User keeps its relation to Project (User.sampleProject: the release
 * before still writes the column, so it stays until a later release drops
 * it), and Project imports User back, as do the models Project imports.
 * When a process loads User.ts before Project.ts, Project.ts and every model
 * it imports are evaluated while User is still undefined, and an eager
 * `modelType: User` keeps that undefined for good: a query that selects
 * the relation then fails with "Select not supported on createdByUser of
 * Incident Severity because this column modelType is not found". It did, on
 * the 16.0.0 branch, for twelve relations: Project's, IncidentSeverity's
 * and AlertSeverity's created/deleted/archived by, Reseller's and
 * ResellerPlan's. Those are lazy (modelTypeThunk), as they were in 14.3.0.
 *
 * Relation Column Model Type Coverage checks every relation in the order
 * the models index loads them. This loads each end of that cycle first, in
 * a module registry of its own, then every other model, and checks every
 * relation of every model resolves to a model.
 */

// Each end of the User - Project cycle.
const FIRST_LOADED: ReadonlyArray<string> = ["User", "Project"];

type ModelType = { new (): BaseModel; name: string };

const unresolvedRelationsWhenLoadedFirst: (first: string) => Array<string> = (
  first: string,
): Array<string> => {
  const unresolved: Array<string> = [];

  jest.isolateModules(() => {
    jest.requireActual(`../../../Models/DatabaseModels/${first}`);

    const models: Array<ModelType> = jest.requireActual<{
      default: Array<ModelType>;
    }>("../../../Models/DatabaseModels/Index").default;
    const Base: ModelType = jest.requireActual<{ default: ModelType }>(
      "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel",
    ).default;
    const TableColumnType: typeof TableColumnTypeEnum = jest.requireActual<{
      default: typeof TableColumnTypeEnum;
    }>("../../../Types/Database/TableColumnType").default;

    for (const modelType of models) {
      const model: BaseModel = new modelType();

      for (const column of model.getTableColumns().columns) {
        const metadata: TableColumnMetadata =
          model.getTableColumnMetadata(column);

        if (
          !metadata ||
          (metadata.type !== TableColumnType.Entity &&
            metadata.type !== TableColumnType.EntityArray)
        ) {
          continue;
        }

        const related: unknown = metadata.modelType
          ? new metadata.modelType()
          : undefined;

        if (!(related instanceof Base)) {
          unresolved.push(`${modelType.name}.${column}`);
        }
      }
    }
  });

  return unresolved.sort();
};

describe("every relation resolves to a model, whichever model loads first", () => {
  test.each(FIRST_LOADED)("%s loaded first", (first: string) => {
    expect(unresolvedRelationsWhenLoadedFirst(first)).toEqual([]);
  });
});
