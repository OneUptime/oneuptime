import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import TableView from "../../../Models/DatabaseModels/TableView";
import {
  CustomFieldSavedViewState,
  RenamedCustomFieldSavedViewState,
  renameCustomFieldInSavedView,
} from "../../../Types/CustomField/CustomFieldSavedViews";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DatabaseService from "../../Services/DatabaseService";
import TableViewService from "../../Services/TableViewService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../Logger";
import { ColumnMetadata } from "typeorm/metadata/ColumnMetadata";
import { EntityManager, EntityMetadata, Repository } from "typeorm";

/*
 * RENAMING A CUSTOM FIELD.
 *
 * Custom field values live in each record's `customFields` jsonb bag, keyed
 * by the field's display name, so renaming "Impact" to "Business Impact"
 * orphans every stored value unless the key moves with it. This moves it:
 * one UPDATE per table, for the whole project, that takes the value out from
 * under the old key and puts it back under the new one - and does the same
 * to the saved table views that name the field.
 *
 * THE NEW NAME STARTS CLEAN. Deleting a field leaves its values in the
 * records (see the custom fields docs), so a record can hold a value under
 * the new name that belongs to no field: a deleted field's answer. The
 * renamed field must not pick those up - they were never its values, and an
 * incident field marked for subscriber notifications would send them out -
 * so the same UPDATE removes the new name from every record of the project
 * that holds nothing under the old one. After a rename, the values under the
 * new name are exactly the ones that were under the old.
 *
 * WHY NOT DatabaseService.updateBy. It fires the model's "on update" workflow
 * trigger for every changed row, even with ignoreHooks (see _updateBy), and
 * customers' own workflows listen on incident custom fields. A rename is a
 * change of label, not of any incident's answers; it must not start a
 * workflow run per incident. The raw statements here fire no workflow, no
 * realtime event and no audit entry, bump no `version`, and leave `updatedAt`
 * alone, like the other derived-data writes (CustomFieldMappingService).
 *
 * The table and column names come from the entity metadata, never from the
 * caller, and every value is a bound parameter, so the SQL is not an
 * injection surface.
 */

export interface MoveCustomFieldValueKeyInput {
  // The service whose table holds values under the field's name.
  service: DatabaseService<any>;
  projectId: ObjectID;
  oldName: string;
  newName: string;
  // The transaction to run the statement in; on its own when not given.
  manager?: EntityManager | undefined;
}

type GetColumnNameFunction = (
  metadata: EntityMetadata,
  propertyName: string,
) => string;

const getColumnName: GetColumnNameFunction = (
  metadata: EntityMetadata,
  propertyName: string,
): string => {
  const column: ColumnMetadata | undefined =
    metadata.findColumnWithPropertyName(propertyName);

  if (!column) {
    throw new Error(
      `Cannot rename a custom field on ${metadata.tableName}: it has no "${propertyName}" column.`,
    );
  }

  return column.databaseName;
};

export interface MoveCustomFieldValueKeyResult {
  // Records whose value moved from the old name to the new one.
  moved: number;
  // Records that held a value under the new name only, now removed.
  cleared: number;
}

/**
 * Move every value stored under `oldName` to `newName`, on every record of
 * the project in the service's table, and clear what records that hold
 * nothing under `oldName` have under `newName`.
 *
 * Only records whose bag is a JSON object holding one of the two names are
 * written. A value the record already held under `newName` is replaced by
 * the one under `oldName`, or removed when there is none: the renamed
 * field's answer is the only one that counts. One statement, so no reader
 * sees the values half moved.
 */
export const moveCustomFieldValueKey: (
  input: MoveCustomFieldValueKeyInput,
) => Promise<MoveCustomFieldValueKeyResult> = async (
  input: MoveCustomFieldValueKeyInput,
): Promise<MoveCustomFieldValueKeyResult> => {
  if (!input.oldName || !input.newName || input.oldName === input.newName) {
    return { moved: 0, cleared: 0 };
  }

  const repository: Repository<BaseModel> = input.service.getRepository();
  const metadata: EntityMetadata = repository.metadata;
  const customFieldsColumn: string = getColumnName(metadata, "customFields");
  const projectIdColumn: string = getColumnName(metadata, "projectId");

  /*
   * In a CTE so the statement answers with the rows it wrote: TypeORM hands
   * back a top-level UPDATE as [rows, rowCount] whatever happened. RETURNING
   * reads the row as written, so a record holds the new name afterwards
   * exactly when its value was moved there.
   *
   * jsonb_typeof guards the operators: on a jsonb array `-` and `?` act on
   * the array's string elements, and a bag that is not an object is not a
   * bag of named values to rename.
   */
  const sql: string = `WITH "renamed" AS (
    UPDATE "${metadata.tableName}"
    SET "${customFieldsColumn}" = CASE
      WHEN jsonb_exists("${customFieldsColumn}", $2::text)
        THEN ("${customFieldsColumn}" - $2::text) || jsonb_build_object($3::text, "${customFieldsColumn}" -> $2::text)
      ELSE "${customFieldsColumn}" - $3::text
    END
    WHERE "${projectIdColumn}" = $1
      AND jsonb_typeof("${customFieldsColumn}") = 'object'
      AND (
        jsonb_exists("${customFieldsColumn}", $2::text)
        OR jsonb_exists("${customFieldsColumn}", $3::text)
      )
    RETURNING jsonb_exists("${customFieldsColumn}", $3::text) AS "moved"
  ) SELECT
    (COUNT(*) FILTER (WHERE "moved"))::int AS "moved",
    (COUNT(*) FILTER (WHERE NOT "moved"))::int AS "cleared"
  FROM "renamed"`;

  const manager: EntityManager = input.manager || repository.manager;

  const result: unknown = await manager.query(sql, [
    input.projectId.toString(),
    input.oldName,
    input.newName,
  ]);

  const row: JSONObject | undefined = Array.isArray(result)
    ? (result[0] as JSONObject | undefined)
    : undefined;

  return {
    moved: Number(row?.["moved"]) || 0,
    cleared: Number(row?.["cleared"]) || 0,
  };
};

export interface RenameCustomFieldInTableViewsInput {
  projectId: ObjectID;
  // The saved views to look at, by TableView.tableId.
  tableIds: Array<string>;
  oldName: string;
  newName: string;
}

/**
 * Rewrite the saved table views of the project that name the field, so a
 * view keeps its column and its filter chip after the rename. Returns how
 * many views it rewrote.
 *
 * Each view is written with a compare-and-set on the columns it was read
 * with, so a view someone saves at the same moment is left as they saved it
 * rather than half overwritten.
 */
export const renameCustomFieldInTableViews: (
  input: RenameCustomFieldInTableViewsInput,
) => Promise<number> = async (
  input: RenameCustomFieldInTableViewsInput,
): Promise<number> => {
  if (
    !input.oldName ||
    !input.newName ||
    input.oldName === input.newName ||
    input.tableIds.length === 0
  ) {
    return 0;
  }

  const views: Array<TableView> = await TableViewService.findBy({
    query: {
      projectId: input.projectId,
      tableId: QueryHelper.any(input.tableIds),
    },
    select: {
      _id: true,
      query: true,
      facets: true,
      columns: true,
    },
    limit: LIMIT_MAX,
    skip: 0,
    props: {
      isRoot: true,
    },
  });

  let renamedCount: number = 0;

  for (const view of views) {
    const current: CustomFieldSavedViewState = {
      query: (view.query as unknown as JSONObject | undefined) ?? null,
      facets: view.facets ?? null,
      columns: view.columns ?? null,
    };

    const renamed: RenamedCustomFieldSavedViewState =
      renameCustomFieldInSavedView({
        view: current,
        oldName: input.oldName,
        newName: input.newName,
      });

    if (!renamed.hasChanged || !view.id) {
      continue;
    }

    const data: Record<string, unknown> = {};
    const expectedData: Record<string, unknown> = {};

    for (const key of Object.keys(renamed.changes) as Array<
      keyof CustomFieldSavedViewState
    >) {
      data[key] = renamed.changes[key];
      expectedData[key] = current[key];
    }

    await TableViewService.updateColumnsByIdWithoutHooks({
      id: view.id,
      data: data as never,
      expectedData: expectedData as never,
      skipUpdateDateColumn: true,
    });

    renamedCount++;
  }

  return renamedCount;
};

export interface RenameCustomFieldInput {
  projectId: ObjectID;
  oldName: string;
  newName: string;
  // Every service whose table stores values under the field's name.
  valueServices: Array<DatabaseService<any>>;
  // The saved views of tables that show the field.
  tableViewIds: Array<string>;
  // How the field is named in logs, e.g. "incident custom field".
  definitionName: string;
  /*
   * Called when the values could not be moved, and are all still under the
   * old name, before the failure is thrown: the caller gives the field its
   * old name back, so the values stay in view (see renameCustomField).
   */
  onValuesNotMoved?: (() => Promise<void>) | undefined;
}

export interface RenameCustomFieldResult {
  movedRecordsByTable: Record<string, number>;
  // Records whose stale value under the new name was removed, by table.
  clearedRecordsByTable: Record<string, number>;
  renamedTableViews: number;
}

/**
 * Everything a rename has to move: the stored values in each table, then the
 * saved views.
 *
 * The values move in one transaction across the tables, so either every
 * table holds them under the new name or none does. That matters because
 * the move also clears stale values under the new name: had one table moved
 * and another not, renaming the field back would clear the values the
 * second table still held under the old name. When the transaction fails,
 * onValuesNotMoved runs - the caller puts the field's old name back, so the
 * field and its values agree again - and the failure is thrown. A saved view
 * that could not be rewritten only loses the field's column or filter, and
 * throws too.
 */
export const renameCustomField: (
  input: RenameCustomFieldInput,
) => Promise<RenameCustomFieldResult> = async (
  input: RenameCustomFieldInput,
): Promise<RenameCustomFieldResult> => {
  const result: RenameCustomFieldResult = {
    movedRecordsByTable: {},
    clearedRecordsByTable: {},
    renamedTableViews: 0,
  };

  if (!input.oldName || !input.newName || input.oldName === input.newName) {
    return result;
  }

  const firstService: DatabaseService<any> | undefined = input.valueServices[0];

  if (firstService) {
    try {
      await firstService
        .getRepository()
        .manager.transaction(async (manager: EntityManager): Promise<void> => {
          for (const service of input.valueServices) {
            const tableName: string =
              service.getModel().tableName ||
              service.getRepository().metadata.name;

            const moved: MoveCustomFieldValueKeyResult =
              await moveCustomFieldValueKey({
                service: service,
                projectId: input.projectId,
                oldName: input.oldName,
                newName: input.newName,
                manager: manager,
              });

            result.movedRecordsByTable[tableName] = moved.moved;
            result.clearedRecordsByTable[tableName] = moved.cleared;
          }
        });
    } catch (err) {
      logger.error(
        `Could not move ${input.definitionName} values from ${JSON.stringify(
          input.oldName,
        )} to ${JSON.stringify(input.newName)}; none were moved.`,
        {
          projectId: input.projectId.toString(),
        } as LogAttributes,
      );

      if (input.onValuesNotMoved) {
        try {
          await input.onValuesNotMoved();
        } catch (restoreError) {
          logger.error(restoreError, {
            projectId: input.projectId.toString(),
          } as LogAttributes);
        }
      }

      throw err;
    }
  }

  result.renamedTableViews = await renameCustomFieldInTableViews({
    projectId: input.projectId,
    tableIds: input.tableViewIds,
    oldName: input.oldName,
    newName: input.newName,
  });

  logger.info(
    `Renamed ${input.definitionName} values from ${JSON.stringify(
      input.oldName,
    )} to ${JSON.stringify(input.newName)}: ${JSON.stringify(
      result.movedRecordsByTable,
    )} records moved, ${JSON.stringify(
      result.clearedRecordsByTable,
    )} stale values under the new name cleared, ${
      result.renamedTableViews
    } saved views.`,
    {
      projectId: input.projectId.toString(),
    } as LogAttributes,
  );

  return result;
};
