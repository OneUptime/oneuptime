import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import RelationIdUtil from "./RelationIdUtil";

/*
 * A record's single relation has two names a write can use: the relation
 * (`monitor`, which the dashboard's forms post) and its ID column
 * (`monitorId`, which the API reference, Terraform and server-side callers
 * use). Both are one database column. When a write carries both, TypeORM
 * stores the relation's id (see RelationIdUtil), while a check or a decision
 * that reads one name sees the other's: so a write whose two names hold
 * different values is ambiguous, and every write made in a project - through
 * the API, a workflow or the admin dashboard - is refused before any hook
 * reads it (DatabaseService.assertRelationNamesAgree). A write that names a
 * reference once, under either name, is unchanged.
 *
 * The tenant relation (`project` for `projectId`) is DatabaseService's own:
 * enforceTenantRelationMatchesScalar holds it to the request's project.
 */

export interface RelationName {
  // The relation: "monitor".
  relation: string;
  // Its ID column: "monitorId".
  idColumn: string;
  // How a refusal names it: the relation's title, "Monitor".
  title: string;
}

// Keyed by the model's class.
const relationNamesByModel: Map<unknown, Array<RelationName>> = new Map();

export default class RelationNames {
  /*
   * The ID column a relation is written through. A few user-owned models
   * (UserNotificationRule, the notification methods) name the relation
   * itself as its id column in the metadata - `user` for `user` - while the
   * column holding the id is `userId`; reading the relation twice would miss
   * a payload that sends the id.
   */
  public static getIdColumn(
    model: DatabaseBaseModel,
    column: string,
    metadata: TableColumnMetadata,
  ): string | undefined {
    const idColumn: string | undefined = metadata.manyToOneRelationColumn;

    if (idColumn === column && model.hasColumn(`${column}Id`)) {
      return `${column}Id`;
    }

    return idColumn;
  }

  /*
   * Every single relation of `model` that has an ID column of its own, but
   * the tenant relation. Read once per model from its column metadata.
   */
  public static getSingleRelations(
    model: DatabaseBaseModel,
  ): Array<RelationName> {
    const cached: Array<RelationName> | undefined = relationNamesByModel.get(
      model.constructor,
    );

    if (cached) {
      return cached;
    }

    const tenantColumn: string | null = model.getTenantColumn();
    const relations: Array<RelationName> = [];

    for (const column of model.getTableColumns().columns) {
      const metadata: TableColumnMetadata | undefined =
        model.getTableColumnMetadata(column);

      if (!metadata || metadata.type !== TableColumnType.Entity) {
        continue;
      }

      const idColumn: string | undefined = RelationNames.getIdColumn(
        model,
        column,
        metadata,
      );

      if (
        !idColumn ||
        idColumn === column ||
        idColumn === tenantColumn ||
        !model.hasColumn(idColumn)
      ) {
        continue;
      }

      relations.push({
        relation: column,
        idColumn: idColumn,
        title: metadata.title || column,
      });
    }

    relationNamesByModel.set(model.constructor, relations);

    return relations;
  }

  /*
   * Refuse a write that names one of `model`'s references twice with
   * different values - two records, or a record and a clear - before
   * anything reads it. Reads nothing: the answer depends on the payload
   * alone. A reference written under one name, or the same id under both,
   * passes.
   */
  public static assertNamesAgree(
    model: DatabaseBaseModel,
    payload: unknown,
  ): void {
    if (!payload || typeof payload !== "object") {
      return;
    }

    const data: Record<string, unknown> = payload as Record<string, unknown>;

    for (const relation of RelationNames.getSingleRelations(model)) {
      if (
        data[relation.relation] === undefined ||
        data[relation.idColumn] === undefined
      ) {
        continue;
      }

      RelationIdUtil.readConsistent(
        data,
        [relation.idColumn, relation.relation],
        relation.title,
      );
    }
  }
}
