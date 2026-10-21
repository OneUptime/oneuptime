import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Form from "../../../Models/DatabaseModels/Form";
import TableView from "../../../Models/DatabaseModels/TableView";
import {
  CustomFieldOptionRenameMap,
  CustomFieldOptionUsageValue,
  RenamedCustomFieldOptionValue,
  renameCustomFieldOptionValue,
} from "../../../Types/CustomField/CustomFieldOptionEdit";
import {
  CustomFieldSavedViewState,
  RenamedCustomFieldSavedViewState,
  renameCustomFieldOptionsInSavedView,
} from "../../../Types/CustomField/CustomFieldSavedViews";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import {
  FormField,
  FormFieldSource,
  readFormFields,
} from "../../../Types/Form/FormField";
import FormTargetType from "../../../Types/Form/FormTargetType";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DatabaseService from "../../Services/DatabaseService";
import FormService from "../../Services/FormService";
import TableViewService from "../../Services/TableViewService";
import QueryHelper from "../../Types/Database/QueryHelper";
import { ColumnMetadata } from "typeorm/metadata/ColumnMetadata";
import { EntityManager, EntityMetadata, Repository } from "typeorm";

/*
 * RENAMING A DROPDOWN FIELD'S OPTIONS (issue #4564).
 *
 * A record stores a dropdown answer as the option's text, in its
 * `customFields` jsonb bag under the field's name - a single value, or a list
 * of them for a multi-select. Renaming an option has to move that text on
 * every record that holds it, or the records go on holding an option the
 * field no longer offers. This moves it: one UPDATE per table, for the whole
 * project, that maps every value through the renames at once (so "A" to "B"
 * and "B" to "A" in one save swaps them), and drops an entry of a list that
 * a rename made repeat. The same mapping is made in TypeScript by
 * renameCustomFieldOptionValue; the Postgres suite checks the two agree.
 *
 * WHY NOT DatabaseService.updateBy, for the reasons CustomFieldRename gives
 * for renaming a field: it would start the "On Update" workflow of every
 * incident (or monitor, or alert...) holding the option, and send a
 * realtime event and an audit entry for each - for a change of wording, not
 * of anyone's answer. The raw statements fire none of that, bump no
 * `version` and leave `updatedAt` alone, like the other derived-data writes
 * (CustomFieldMappingService, CustomFieldRename).
 *
 * The table and column names come from the entity metadata, never from the
 * caller, and every value is a bound parameter, so the SQL is not an
 * injection surface.
 */

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
      `Cannot rename a custom field's options on ${metadata.tableName}: it has no "${propertyName}" column.`,
    );
  }

  return column.databaseName;
};

type ToJSONMapFunction = (renames: CustomFieldOptionRenameMap) => string;

// The renames as the jsonb object the statements look values up in.
const toJSONMap: ToJSONMapFunction = (
  renames: CustomFieldOptionRenameMap,
): string => {
  const map: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;

  for (const [from, to] of renames.entries()) {
    map[from] = to;
  }

  return JSON.stringify(map);
};

/*
 * The SQL that maps one jsonb value through the renames ($3): a single value
 * (text, a number or a yes/no, matched by its text) that is renamed becomes
 * the option's new text; a list has each renamed entry replaced in its place
 * and every entry that repeats an earlier one dropped; anything else is
 * returned as it is. `value` is an SQL expression for the jsonb value.
 */
type MapValueSqlFunction = (value: string) => string;

const mapValueSql: MapValueSqlFunction = (value: string): string => {
  return `CASE
    WHEN jsonb_typeof(${value}) = 'array' THEN (
      SELECT COALESCE(jsonb_agg("deduped"."mapped" ORDER BY "deduped"."position"), '[]'::jsonb)
      FROM (
        SELECT DISTINCT ON ("mapping"."mapped") "mapping"."mapped", "mapping"."position"
        FROM (
          SELECT
            CASE
              WHEN jsonb_typeof("element"."entry") IN ('string', 'number', 'boolean')
                AND jsonb_exists($3::jsonb, "element"."entry" #>> '{}')
              THEN to_jsonb($3::jsonb ->> ("element"."entry" #>> '{}'))
              ELSE "element"."entry"
            END AS "mapped",
            "element"."position"
          FROM jsonb_array_elements(${value}) WITH ORDINALITY AS "element"("entry", "position")
        ) "mapping"
        ORDER BY "mapping"."mapped", "mapping"."position"
      ) "deduped"
    )
    WHEN jsonb_typeof(${value}) IN ('string', 'number', 'boolean')
      AND jsonb_exists($3::jsonb, ${value} #>> '{}')
    THEN to_jsonb($3::jsonb ->> (${value} #>> '{}'))
    ELSE ${value}
  END`;
};

/*
 * The SQL that says whether one jsonb value holds a renamed value: the value
 * itself, or an entry of the list.
 */
type HoldsRenamedValueSqlFunction = (value: string) => string;

const holdsRenamedValueSql: HoldsRenamedValueSqlFunction = (
  value: string,
): string => {
  return `(
    (jsonb_typeof(${value}) IN ('string', 'number', 'boolean')
      AND jsonb_exists($3::jsonb, ${value} #>> '{}'))
    OR (jsonb_typeof(${value}) = 'array' AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(${value}) AS "held"("entry")
      WHERE jsonb_typeof("held"."entry") IN ('string', 'number', 'boolean')
        AND jsonb_exists($3::jsonb, "held"."entry" #>> '{}')
    ))
  )`;
};

export interface MoveCustomFieldOptionValuesInput {
  // The service whose table holds values under the field's name.
  service: DatabaseService<any>;
  projectId: ObjectID;
  fieldName: string;
  renames: CustomFieldOptionRenameMap;
  // The transaction to run the statement in; on its own when not given.
  manager?: EntityManager | undefined;
}

/**
 * Map every value the project's records hold for the field through the
 * renames, in the service's table. Returns how many records were written.
 * Only records whose bag is a JSON object holding a renamed value are
 * touched; one statement, so no reader sees the values half moved.
 */
export const moveCustomFieldOptionValues: (
  input: MoveCustomFieldOptionValuesInput,
) => Promise<number> = async (
  input: MoveCustomFieldOptionValuesInput,
): Promise<number> => {
  if (!input.fieldName || input.renames.size === 0) {
    return 0;
  }

  const repository: Repository<BaseModel> = input.service.getRepository();
  const metadata: EntityMetadata = repository.metadata;
  const bag: string = `"${getColumnName(metadata, "customFields")}"`;
  const projectIdColumn: string = getColumnName(metadata, "projectId");
  const value: string = `(${bag} -> $2::text)`;

  /*
   * In a CTE so the statement answers with the rows it wrote: TypeORM hands
   * back a top-level UPDATE as [rows, rowCount] whatever happened.
   *
   * jsonb_typeof guards the operators: a bag that is not an object holds no
   * named values, and jsonb_set on one would fail the whole statement.
   */
  const sql: string = `WITH "renamed" AS (
    UPDATE "${metadata.tableName}"
    SET ${bag} = jsonb_set(${bag}, ARRAY[$2::text], ${mapValueSql(value)})
    WHERE "${projectIdColumn}" = $1
      AND jsonb_typeof(${bag}) = 'object'
      AND ${holdsRenamedValueSql(value)}
    RETURNING 1
  ) SELECT COUNT(*)::int AS "moved" FROM "renamed"`;

  const manager: EntityManager = input.manager || repository.manager;

  const result: unknown = await manager.query(sql, [
    input.projectId.toString(),
    input.fieldName,
    toJSONMap(input.renames),
  ]);

  const row: JSONObject | undefined = Array.isArray(result)
    ? (result[0] as JSONObject | undefined)
    : undefined;

  return Number(row?.["moved"]) || 0;
};

export interface CountCustomFieldOptionValuesInput {
  service: DatabaseService<any>;
  projectId: ObjectID;
  fieldName: string;
  // The most distinct values to answer with, the most held first.
  limit?: number | undefined;
}

// More distinct values than any option list a person keeps by hand.
export const MAX_COUNTED_CUSTOM_FIELD_VALUES: number = 1000;

/**
 * How many of the project's records hold each value of the field - a
 * single value, or an entry of a list - the most held first. A record that
 * lists a value twice counts once; deleted records, and values that are not
 * text, a number or a yes/no, are not counted.
 */
export const countCustomFieldOptionValues: (
  input: CountCustomFieldOptionValuesInput,
) => Promise<Array<CustomFieldOptionUsageValue>> = async (
  input: CountCustomFieldOptionValuesInput,
): Promise<Array<CustomFieldOptionUsageValue>> => {
  if (!input.fieldName) {
    return [];
  }

  const repository: Repository<BaseModel> = input.service.getRepository();
  const metadata: EntityMetadata = repository.metadata;
  const bag: string = `"record"."${getColumnName(metadata, "customFields")}"`;
  const projectIdColumn: string = getColumnName(metadata, "projectId");
  const idColumn: string = getColumnName(metadata, "_id");
  const deletedAt: ColumnMetadata | undefined =
    metadata.findColumnWithPropertyName("deletedAt");
  const value: string = `(${bag} -> $2::text)`;

  const limit: number = Math.min(
    Math.max(1, Math.floor(input.limit || MAX_COUNTED_CUSTOM_FIELD_VALUES)),
    MAX_COUNTED_CUSTOM_FIELD_VALUES,
  );

  const sql: string = `SELECT "held"."value" AS "value", COUNT(*)::int AS "count"
  FROM (
    SELECT DISTINCT
      "record"."${idColumn}" AS "recordId",
      CASE
        WHEN jsonb_typeof(${value}) = 'array' THEN "element"."entry" #>> '{}'
        ELSE ${value} #>> '{}'
      END AS "value"
    FROM "${metadata.tableName}" AS "record"
    LEFT JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(${value}) = 'array' THEN ${value} ELSE '[]'::jsonb END
    ) AS "element"("entry") ON TRUE
    WHERE "record"."${projectIdColumn}" = $1
      ${deletedAt ? `AND "record"."${deletedAt.databaseName}" IS NULL` : ""}
      AND jsonb_typeof(${bag}) = 'object'
      AND jsonb_typeof(${value}) IN ('string', 'number', 'boolean', 'array')
      AND (
        "element"."entry" IS NULL
        OR jsonb_typeof("element"."entry") IN ('string', 'number', 'boolean')
      )
  ) AS "held"
  WHERE "held"."value" IS NOT NULL AND "held"."value" <> ''
  GROUP BY "held"."value"
  ORDER BY COUNT(*) DESC, "held"."value" ASC
  LIMIT ${limit}`;

  const result: unknown = await repository.manager.query(sql, [
    input.projectId.toString(),
    input.fieldName,
  ]);

  if (!Array.isArray(result)) {
    return [];
  }

  return result
    .map((row: JSONObject): CustomFieldOptionUsageValue => {
      return {
        value: String(row["value"]),
        count: Number(row["count"]) || 0,
      };
    })
    .filter((row: CustomFieldOptionUsageValue): boolean => {
      return row.count > 0;
    });
};

export interface RenameCustomFieldOptionsInTableViewsInput {
  projectId: ObjectID;
  // The saved views to look at, by TableView.tableId.
  tableIds: Array<string>;
  fieldName: string;
  renames: CustomFieldOptionRenameMap;
}

/**
 * Rewrite the project's saved views that filter by the field, so a view
 * that showed the records holding an option still shows them under its new
 * name. Returns how many views it rewrote. Each view is written with a
 * compare-and-set on what it was read with, so a view someone saves at the
 * same moment is left as they saved it.
 */
export const renameCustomFieldOptionsInTableViews: (
  input: RenameCustomFieldOptionsInTableViewsInput,
) => Promise<number> = async (
  input: RenameCustomFieldOptionsInTableViewsInput,
): Promise<number> => {
  if (
    !input.fieldName ||
    input.renames.size === 0 ||
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
    };

    const renamed: RenamedCustomFieldSavedViewState =
      renameCustomFieldOptionsInSavedView({
        view: current,
        fieldName: input.fieldName,
        renames: input.renames,
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

export interface RenameCustomFieldOptionsInFormTemplatesInput {
  projectId: ObjectID;
  // What the forms create: the custom fields their questions can be.
  targetType: FormTargetType;
  // The field the questions are, by its id.
  customFieldId: ObjectID;
  renames: CustomFieldOptionRenameMap;
}

type IsPlainObjectFunction = (value: unknown) => value is JSONObject;

const isPlainObject: IsPlainObjectFunction = (
  value: unknown,
): value is JSONObject => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

/**
 * Rewrite the answers the project's form templates hold for questions that
 * are this field, so a template that picked an option still picks it under
 * its new name - a form refuses to save a template whose answer is not an
 * option of its question. Returns how many forms it rewrote. Only the
 * answers change; every other part of a form is written back exactly as it
 * was read, with a compare-and-set on the templates so a form saved at the
 * same moment is left as it was saved.
 */
export const renameCustomFieldOptionsInFormTemplates: (
  input: RenameCustomFieldOptionsInFormTemplatesInput,
) => Promise<number> = async (
  input: RenameCustomFieldOptionsInFormTemplatesInput,
): Promise<number> => {
  if (input.renames.size === 0) {
    return 0;
  }

  const forms: Array<Form> = await FormService.findBy({
    query: {
      projectId: input.projectId,
      targetType: input.targetType,
    },
    select: {
      _id: true,
      fields: true,
      templates: true,
    },
    limit: LIMIT_MAX,
    skip: 0,
    props: {
      isRoot: true,
    },
  });

  const customFieldId: string = input.customFieldId.toString().toLowerCase();
  let rewritten: number = 0;

  for (const form of forms) {
    if (!form.id || !Array.isArray(form.templates)) {
      continue;
    }

    const questionIds: Array<string> = readFormFields(form.fields)
      .filter((field: FormField): boolean => {
        return (
          field.source === FormFieldSource.TargetCustomField &&
          (field.customFieldId || "").toLowerCase() === customFieldId
        );
      })
      .map((field: FormField): string => {
        return field.id;
      });

    if (questionIds.length === 0) {
      continue;
    }

    let changed: boolean = false;

    const templates: JSONArray = form.templates.map(
      (template: unknown): JSONObject => {
        if (!isPlainObject(template) || !isPlainObject(template["answers"])) {
          return template as JSONObject;
        }

        const answers: JSONObject = { ...template["answers"] };
        let templateChanged: boolean = false;

        for (const questionId of questionIds) {
          if (!Object.prototype.hasOwnProperty.call(answers, questionId)) {
            continue;
          }

          const renamed: RenamedCustomFieldOptionValue =
            renameCustomFieldOptionValue(answers[questionId], input.renames);

          if (renamed.changed) {
            answers[questionId] = renamed.value as JSONObject[string];
            templateChanged = true;
          }
        }

        if (!templateChanged) {
          return template;
        }

        changed = true;
        return { ...template, answers };
      },
    );

    if (!changed) {
      continue;
    }

    await FormService.updateColumnsByIdWithoutHooks({
      id: form.id,
      data: { templates } as never,
      expectedData: { templates: form.templates } as never,
    });

    rewritten++;
  }

  return rewritten;
};

export interface UpdateCustomFieldDropdownOptionsInput {
  // The definition service whose table holds the field.
  service: DatabaseService<any>;
  fieldId: ObjectID;
  // What the field holds now: the write happens only if it still does.
  expectedDropdownOptions: string | null;
  dropdownOptions: string;
  manager?: EntityManager | undefined;
}

/**
 * Set a field's option list, with raw SQL, only if it still holds what it
 * was read with. For a field that copies its value from another one, whose
 * options follow that field's (CustomFieldOptionEditHooks): like the values,
 * a derived write that starts no workflow and changes no version. Returns
 * whether the field was written.
 */
export const updateCustomFieldDropdownOptions: (
  input: UpdateCustomFieldDropdownOptionsInput,
) => Promise<boolean> = async (
  input: UpdateCustomFieldDropdownOptionsInput,
): Promise<boolean> => {
  const repository: Repository<BaseModel> = input.service.getRepository();
  const metadata: EntityMetadata = repository.metadata;
  const optionsColumn: string = getColumnName(metadata, "dropdownOptions");
  const idColumn: string = getColumnName(metadata, "_id");

  const sql: string = `WITH "written" AS (
    UPDATE "${metadata.tableName}"
    SET "${optionsColumn}" = $1
    WHERE "${idColumn}" = $2
      AND "${optionsColumn}" IS NOT DISTINCT FROM $3
    RETURNING 1
  ) SELECT COUNT(*)::int AS "written" FROM "written"`;

  const manager: EntityManager = input.manager || repository.manager;

  const result: unknown = await manager.query(sql, [
    input.dropdownOptions,
    input.fieldId.toString(),
    input.expectedDropdownOptions,
  ]);

  const row: JSONObject | undefined = Array.isArray(result)
    ? (result[0] as JSONObject | undefined)
    : undefined;

  return (Number(row?.["written"]) || 0) > 0;
};
