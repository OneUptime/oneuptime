import DatabaseService from "../../Services/DatabaseService";
import CreateBy from "../../Types/Database/CreateBy";
import Query from "../../Types/Database/Query";
import Select from "../../Types/Database/Select";
import UpdateBy from "../../Types/Database/UpdateBy";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import ProjectScopedReferenceValidator, {
  HeldRelationIds,
  ProjectScopedReference,
  ProjectScopedReferenceException,
  resolveReferenceId,
  resolveReferenceIds,
} from "./ProjectScopedReferenceValidator";

/*
 * Every reference a record writes - each many-to-many list (a rule's owner
 * teams, its labels, its on-call policies) and each single relation (an
 * owner row's team, user and resource) - must name a record of the record's
 * own project, and a user must be a member of it. The rules, the owner rows
 * and their engines act on those ids as root: an owner rule adds its teams
 * to every matching resource and their members are notified, an on-call rule
 * pages its policies for every matching incident, a label rule attaches its
 * labels. Nothing between the saved id and that action asked whose record
 * it was.
 *
 * The references come from the model's own column metadata, so a list or
 * relation added to a model later is checked without anyone remembering to.
 * Not checked: the record's own project (the tenant relation, which
 * DatabaseService stamps from the request) and who created or deleted it
 * (stamped by the server). A relation to a model with no project of its own
 * that is not a person has nothing to compare against and is left alone. Ids
 * a JSON column holds are not described by the metadata, so a service names
 * such a column and how to read its references (a JsonReferenceColumn); they
 * are checked together with the rest, in one answer.
 *
 * ProjectScopedReferenceValidator does the checking: lookups pinned to the
 * project, a user counted by membership, and one answer - echoing the ids
 * the caller sent, never what they resolved to - for an id from another
 * project, an id that matches nothing and someone who is not a member.
 *
 * Services opt in by extending ProjectReferencesService, whose create and
 * update hooks call validateCreate and validateUpdate.
 */

export interface ProjectReferenceColumn {
  // The property written: a list ("ownerTeams") or a relation ("team").
  column: string;
  // A single relation's id column ("teamId"), written instead of or beside it.
  idColumn?: string | undefined;
  isList: boolean;
  // How the error names the field: the column's title ("Owner Teams").
  modelName: string;
  service: DatabaseService<DatabaseBaseModel>;
}

/*
 * A JSON column whose value names records - an incident grouping rule's
 * member role assignments, { userId, incidentRoleId } pairs - and the
 * references a value of it names, each with the field name an error uses
 * and the lookup it is checked with.
 */
export interface JsonReferenceColumn {
  column: string;
  getReferences: (value: unknown) => Array<ProjectScopedReference>;
}

// A reference and the column it was written to.
type ColumnReference = ProjectScopedReference & { column: string };

// Relations the server stamps itself, never a reference the caller picks.
const SERVER_STAMPED_ID_COLUMNS: Array<string> = [
  "createdByUserId",
  "deletedByUserId",
];

// Postgres renders a uuid lower-cased, whatever case the payload used.
type NormalizeIdFunction = (id: string) => string;

const normalizeId: NormalizeIdFunction = (id: string): string => {
  return id.trim().toLowerCase();
};

// Keyed by the model's class.
const referenceColumnsByModel: Map<
  unknown,
  Array<ProjectReferenceColumn>
> = new Map();

export default class ProjectReferenceCheck {
  /*
   * The references of `model` this check covers, read once per model from
   * its column metadata: every many-to-many list and every single relation
   * whose model is project-scoped or a person.
   */
  public static getReferenceColumns(
    model: DatabaseBaseModel,
  ): Array<ProjectReferenceColumn> {
    const cached: Array<ProjectReferenceColumn> | undefined =
      referenceColumnsByModel.get(model.constructor);

    if (cached) {
      return cached;
    }

    const tenantColumn: string | null = model.getTenantColumn();
    const columns: Array<ProjectReferenceColumn> = [];

    for (const column of model.getTableColumns().columns) {
      const metadata: TableColumnMetadata | undefined =
        model.getTableColumnMetadata(column);

      if (!metadata || !metadata.modelType) {
        continue;
      }

      const isList: boolean = metadata.type === TableColumnType.EntityArray;
      const isRelation: boolean = metadata.type === TableColumnType.Entity;

      if (!isList && !isRelation) {
        continue;
      }

      if (
        isRelation &&
        (!metadata.manyToOneRelationColumn ||
          metadata.manyToOneRelationColumn === tenantColumn ||
          SERVER_STAMPED_ID_COLUMNS.includes(metadata.manyToOneRelationColumn))
      ) {
        continue;
      }

      const referencedModel: DatabaseBaseModel = new metadata.modelType();

      if (
        !ProjectScopedReferenceValidator.isUserModel(referencedModel) &&
        !referencedModel.getTenantColumn()
      ) {
        continue;
      }

      columns.push({
        column: column,
        idColumn: isRelation ? metadata.manyToOneRelationColumn : undefined,
        isList: isList,
        modelName: metadata.title || referencedModel.singularName || column,
        service: ProjectScopedReferenceValidator.getLookupService(
          metadata.modelType,
        ) as unknown as DatabaseService<DatabaseBaseModel>,
      });
    }

    referenceColumnsByModel.set(model.constructor, columns);

    return columns;
  }

  /*
   * The reference columns a write is checked on: all of them, but for single
   * relations the service checks itself. A list is always checked.
   */
  public static getCheckedColumns(
    model: DatabaseBaseModel,
    relationsCheckedByService?: Array<string> | undefined,
  ): Array<ProjectReferenceColumn> {
    const skipped: Array<string> = relationsCheckedByService || [];

    return ProjectReferenceCheck.getReferenceColumns(model).filter(
      (column: ProjectReferenceColumn): boolean => {
        return column.isList || !skipped.includes(column.column);
      },
    );
  }

  // "host owner rule": how the error names the record being written.
  public static getSubject(model: DatabaseBaseModel): string {
    return (model.singularName || "record").toLowerCase();
  }

  /*
   * A record being created: everything it references must be its project's.
   * The project is the request's tenant (DatabaseService has stamped it on
   * the record by now), else the record's own project - a root or master
   * admin write without a tenant. A write with neither has nothing to
   * compare against and is left to the required project column to refuse.
   */
  public static async validateCreate<TModel extends DatabaseBaseModel>(data: {
    service: DatabaseService<TModel>;
    createBy: CreateBy<TModel>;
    // See ProjectReferencesService.getRelationsCheckedByService.
    relationsCheckedByService?: Array<string> | undefined;
    // See ProjectReferencesService.getJsonReferenceColumns.
    jsonReferenceColumns?: Array<JsonReferenceColumn> | undefined;
  }): Promise<void> {
    const model: DatabaseBaseModel = data.service.getModel();
    const tenantColumn: string | null = model.getTenantColumn();

    if (!tenantColumn) {
      return;
    }

    const record: Dictionary<unknown> = (data.createBy.data ||
      {}) as unknown as Dictionary<unknown>;

    const projectId: ObjectID | undefined =
      data.createBy.props.tenantId ||
      ProjectReferenceCheck.toObjectID(
        resolveReferenceId(record[tenantColumn]),
      );

    const references: Array<ColumnReference> =
      ProjectReferenceCheck.getWrittenReferences({
        model: model,
        payload: record,
        relationsCheckedByService: data.relationsCheckedByService,
        jsonReferenceColumns: data.jsonReferenceColumns,
      });

    if (references.length === 0) {
      return;
    }

    await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
      projectId: projectId,
      references: references,
      subject: ProjectReferenceCheck.getSubject(model),
    });
  }

  /*
   * A record being updated: the references the update adds must be the
   * project's. Ids every matched record of the project already holds are
   * left alone - the dashboard sends a whole list back on every save, and a
   * record written before this check, or naming someone who has since left
   * the project, must not be locked against editing. An empty list or a
   * cleared relation only removes references and needs no check.
   *
   * With a tenant - the caller's own project, the common case - the ids are
   * checked first, and only those that are not the project's are looked for
   * among what the matched records of that project hold: an update that
   * names only the project's records reads nothing else. Hooks run before
   * the tenant narrows the query, so that read is pinned to the tenant here.
   * A root or master admin update with no tenant is checked against each
   * matched record's own project.
   */
  public static async validateUpdate<TModel extends DatabaseBaseModel>(data: {
    service: DatabaseService<TModel>;
    updateBy: UpdateBy<TModel>;
    // See ProjectReferencesService.getRelationsCheckedByService.
    relationsCheckedByService?: Array<string> | undefined;
    // See ProjectReferencesService.getJsonReferenceColumns.
    jsonReferenceColumns?: Array<JsonReferenceColumn> | undefined;
  }): Promise<void> {
    const model: DatabaseBaseModel = data.service.getModel();
    const tenantColumn: string | null = model.getTenantColumn();

    if (!tenantColumn) {
      return;
    }

    const references: Array<ColumnReference> =
      ProjectReferenceCheck.getWrittenReferences({
        model: model,
        payload: (data.updateBy.data || {}) as unknown as Dictionary<unknown>,
        relationsCheckedByService: data.relationsCheckedByService,
        jsonReferenceColumns: data.jsonReferenceColumns,
      });

    if (references.length === 0) {
      return;
    }

    const subject: string = ProjectReferenceCheck.getSubject(model);
    const tenantId: ObjectID | undefined = data.updateBy.props.tenantId;

    const isHeld: (
      held: Dictionary<Set<string>>,
      reference: ColumnReference,
    ) => boolean = (
      held: Dictionary<Set<string>>,
      reference: ColumnReference,
    ): boolean => {
      return Boolean(
        held[reference.column]?.has(
          normalizeId(reference.id?.toString() || ""),
        ),
      );
    };

    if (tenantId) {
      const unavailable: Array<ColumnReference> =
        (await ProjectScopedReferenceValidator.getUnavailableReferences({
          projectId: tenantId,
          references: references,
          subject: subject,
        })) as Array<ColumnReference>;

      if (unavailable.length === 0) {
        return;
      }

      const heldIds: HeldRelationIds = await ProjectReferenceCheck.readHeldIds({
        service: data.service,
        query: {
          ...(data.updateBy.query as Dictionary<unknown>),
          [tenantColumn]: tenantId,
        } as unknown as Query<DatabaseBaseModel>,
        references: unavailable,
        jsonReferenceColumns: data.jsonReferenceColumns,
      });

      const held: Dictionary<Set<string>> =
        heldIds.get(normalizeId(tenantId.toString())) || {};

      const refused: Array<ColumnReference> = unavailable.filter(
        (reference: ColumnReference): boolean => {
          return !isHeld(held, reference);
        },
      );

      if (refused.length === 0) {
        return;
      }

      throw new ProjectScopedReferenceException(
        ProjectScopedReferenceValidator.getRefusalMessage({
          subject: subject,
          described:
            ProjectScopedReferenceValidator.describeReferences(refused),
        }),
      );
    }

    const heldIds: HeldRelationIds = await ProjectReferenceCheck.readHeldIds({
      service: data.service,
      query: data.updateBy.query as unknown as Query<DatabaseBaseModel>,
      references: references,
      jsonReferenceColumns: data.jsonReferenceColumns,
    });

    for (const [projectId, held] of heldIds) {
      await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: new ObjectID(projectId),
        references: references.filter((reference: ColumnReference): boolean => {
          return !isHeld(held, reference);
        }),
        subject: subject,
      });
    }
  }

  /*
   * The ids a payload writes to one reference, each once in any case, in the
   * order given: a list as related rows, { _id } objects, ObjectIDs or plain
   * strings; a relation as the relation itself and/or its id column - both
   * are read, since TypeORM lets the relation win over the id column.
   */
  public static getWrittenIds(
    payload: Dictionary<unknown>,
    column: ProjectReferenceColumn,
  ): Array<string> {
    const values: Array<ObjectID | string> = [
      ...resolveReferenceIds(payload[column.column]),
    ];

    if (column.idColumn) {
      const id: ObjectID | string | undefined = resolveReferenceId(
        payload[column.idColumn],
      );

      if (id) {
        values.push(id);
      }
    }

    const seen: Set<string> = new Set<string>();
    const ids: Array<string> = [];

    for (const value of values) {
      const id: string = value.toString().trim();

      if (!id || seen.has(normalizeId(id))) {
        continue;
      }

      seen.add(normalizeId(id));
      ids.push(id);
    }

    return ids;
  }

  // Everything a payload references, each with the column it was written to.
  private static getWrittenReferences(data: {
    model: DatabaseBaseModel;
    payload: Dictionary<unknown>;
    relationsCheckedByService?: Array<string> | undefined;
    jsonReferenceColumns?: Array<JsonReferenceColumn> | undefined;
  }): Array<ColumnReference> {
    const references: Array<ColumnReference> = [];

    for (const column of ProjectReferenceCheck.getCheckedColumns(
      data.model,
      data.relationsCheckedByService,
    )) {
      for (const id of ProjectReferenceCheck.getWrittenIds(
        data.payload,
        column,
      )) {
        references.push({
          modelName: column.modelName,
          id: id,
          service: column.service,
          column: column.column,
        });
      }
    }

    for (const jsonColumn of data.jsonReferenceColumns || []) {
      const value: unknown = data.payload[jsonColumn.column];

      if (value === undefined || value === null) {
        continue;
      }

      for (const reference of jsonColumn.getReferences(value)) {
        references.push({ ...reference, column: jsonColumn.column });
      }
    }

    return references;
  }

  /*
   * Per project, per column, the ids every record the query matches already
   * holds: lists and relations through getHeldRelationIds, a JSON column by
   * reading it and the references it names. All read as root.
   */
  private static async readHeldIds<TModel extends DatabaseBaseModel>(data: {
    service: DatabaseService<TModel>;
    query: Query<DatabaseBaseModel>;
    references: Array<ColumnReference>;
    jsonReferenceColumns?: Array<JsonReferenceColumn> | undefined;
  }): Promise<HeldRelationIds> {
    const service: DatabaseService<DatabaseBaseModel> =
      data.service as unknown as DatabaseService<DatabaseBaseModel>;

    const columns: Set<string> = new Set<string>(
      data.references.map((reference: ColumnReference): string => {
        return reference.column;
      }),
    );

    const jsonColumns: Array<JsonReferenceColumn> = (
      data.jsonReferenceColumns || []
    ).filter((jsonColumn: JsonReferenceColumn): boolean => {
      return columns.has(jsonColumn.column);
    });

    const isJsonColumn: (column: string) => boolean = (
      column: string,
    ): boolean => {
      return jsonColumns.some((jsonColumn: JsonReferenceColumn): boolean => {
        return jsonColumn.column === column;
      });
    };

    const heldIds: HeldRelationIds =
      await ProjectScopedReferenceValidator.getHeldRelationIds({
        service: service,
        query: data.query,
        columns: Array.from(columns).filter((column: string): boolean => {
          return !isJsonColumn(column);
        }),
      });

    if (jsonColumns.length === 0) {
      return heldIds;
    }

    const tenantColumn: string = service.getModel().getTenantColumn()!;

    const select: Dictionary<boolean> = {
      _id: true,
      [tenantColumn]: true,
    };

    for (const jsonColumn of jsonColumns) {
      select[jsonColumn.column] = true;
    }

    const records: Array<DatabaseBaseModel> = await service.findBy({
      query: data.query,
      select: select as Select<DatabaseBaseModel>,
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const jsonColumn of jsonColumns) {
      // Per project, the ids every record read so far holds in this column.
      const heldInColumn: Map<string, Set<string>> = new Map();

      for (const record of records) {
        const projectId: string = normalizeId(
          record.getValue<ObjectID>(tenantColumn)?.toString() || "",
        );

        if (!projectId) {
          continue;
        }

        const heldByRecord: Set<string> = new Set<string>(
          jsonColumn
            .getReferences(record.getValue(jsonColumn.column))
            .map((reference: ProjectScopedReference): string => {
              return normalizeId(reference.id?.toString() || "");
            }),
        );

        const heldSoFar: Set<string> | undefined = heldInColumn.get(projectId);

        heldInColumn.set(
          projectId,
          heldSoFar
            ? new Set<string>(
                Array.from(heldSoFar).filter((id: string): boolean => {
                  return heldByRecord.has(id);
                }),
              )
            : heldByRecord,
        );
      }

      for (const [projectId, held] of heldInColumn) {
        if (!heldIds.has(projectId)) {
          heldIds.set(projectId, {});
        }

        heldIds.get(projectId)![jsonColumn.column] = held;
      }
    }

    return heldIds;
  }

  private static toObjectID(
    value: ObjectID | string | undefined,
  ): ObjectID | undefined {
    if (!value) {
      return undefined;
    }

    return value instanceof ObjectID ? value : new ObjectID(value);
  }
}
