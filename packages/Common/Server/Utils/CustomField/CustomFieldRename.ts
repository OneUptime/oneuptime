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
import { EntityMetadata, Repository } from "typeorm";

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

/**
 * Move every value stored under `oldName` to `newName`, on every record of
 * the project in the service's table. Returns how many records it moved.
 *
 * Only records whose bag is a JSON object holding `oldName` are written. A
 * value the record already held under `newName` is replaced: the renamed
 * field's answer is the one that counts.
 */
export const moveCustomFieldValueKey: (
  input: MoveCustomFieldValueKeyInput,
) => Promise<number> = async (
  input: MoveCustomFieldValueKeyInput,
): Promise<number> => {
  if (!input.oldName || !input.newName || input.oldName === input.newName) {
    return 0;
  }

  const repository: Repository<BaseModel> = input.service.getRepository();
  const metadata: EntityMetadata = repository.metadata;
  const customFieldsColumn: string = getColumnName(metadata, "customFields");
  const projectIdColumn: string = getColumnName(metadata, "projectId");

  /*
   * In a CTE so the statement answers with the rows it wrote: TypeORM hands
   * back a top-level UPDATE as [rows, rowCount] whatever happened.
   *
   * jsonb_typeof guards the operators: on a jsonb array `-` and `?` act on
   * the array's string elements, and a bag that is not an object is not a
   * bag of named values to rename.
   */
  const sql: string = `WITH "moved" AS (
    UPDATE "${metadata.tableName}"
    SET "${customFieldsColumn}" = ("${customFieldsColumn}" - $2::text) || jsonb_build_object($3::text, "${customFieldsColumn}" -> $2::text)
    WHERE "${projectIdColumn}" = $1
      AND jsonb_typeof("${customFieldsColumn}") = 'object'
      AND jsonb_exists("${customFieldsColumn}", $2::text)
    RETURNING 1
  ) SELECT COUNT(*)::int AS "count" FROM "moved"`;

  const result: unknown = await repository.manager.query(sql, [
    input.projectId.toString(),
    input.oldName,
    input.newName,
  ]);

  const count: unknown = Array.isArray(result)
    ? (result[0] as JSONObject | undefined)?.["count"]
    : 0;

  return Number(count) || 0;
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
}

export interface RenameCustomFieldResult {
  movedRecordsByTable: Record<string, number>;
  renamedTableViews: number;
}

/**
 * Everything a rename has to move: the stored values in each table, then the
 * saved views. Throws if a statement fails, leaving whatever it has not
 * reached under the old name; renaming the field back moves those values
 * back into view.
 */
export const renameCustomField: (
  input: RenameCustomFieldInput,
) => Promise<RenameCustomFieldResult> = async (
  input: RenameCustomFieldInput,
): Promise<RenameCustomFieldResult> => {
  const result: RenameCustomFieldResult = {
    movedRecordsByTable: {},
    renamedTableViews: 0,
  };

  if (!input.oldName || !input.newName || input.oldName === input.newName) {
    return result;
  }

  for (const service of input.valueServices) {
    const tableName: string =
      service.getModel().tableName || service.getRepository().metadata.name;

    result.movedRecordsByTable[tableName] = await moveCustomFieldValueKey({
      service: service,
      projectId: input.projectId,
      oldName: input.oldName,
      newName: input.newName,
    });
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
    )} records, ${result.renamedTableViews} saved views.`,
    {
      projectId: input.projectId.toString(),
    } as LogAttributes,
  );

  return result;
};
