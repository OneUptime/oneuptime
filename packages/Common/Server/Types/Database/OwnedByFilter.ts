import QueryHelper, { FindOperator, OwnerTableColumns } from "./QueryHelper";
/*
 * Type-only import: the registry imports every owner table's service, each of
 * which extends DatabaseService, which reads queries through this file. It is
 * required when a filter is first read (getOwnerTableRegistry), by which time
 * every one of those classes exists.
 */
import type { OwnerTablePair } from "./Permissions/OwnerTableRegistry";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OwnedBy from "../../../Types/BaseDatabase/OwnedBy";
import BadDataException from "../../../Types/Exception/BadDataException";

// One owner table of a kind, as the filter reads it.
export interface OwnerTable extends OwnerTableColumns {
  modelType: { new (): BaseModel };
}

// The two tables a kind's owners are kept in.
export interface OwnerTablesOfKind {
  userTable: OwnerTable;
  teamTable: OwnerTable;
}

/*
 * THE OWNERS FILTER (OwnedBy) ON THE SERVER: which tables it reads for a kind
 * of record, and the condition it puts on the records' ids.
 *
 * The kinds with owners of their own, and the tables and key column that hold
 * them, are OwnerTableRegistry's - the same entries the Owned permission scope
 * reads - so a kind registered there can be filtered by its owners with no
 * other change. A person owner is the owner table's userId, a team owner its
 * teamId; Tests/Server/Types/Database/OwnedByFilter holds every registered
 * kind's tables to that.
 */
export default class OwnedByFilter {
  // The owner tables of `modelType`, or null for a kind without owners.
  public static getOwnerTables(modelType: {
    new (): BaseModel;
  }): OwnerTablesOfKind | null {
    const kind: string | undefined = (modelType as unknown as { name?: string })
      ?.name;

    if (!kind) {
      return null;
    }

    const pair: OwnerTablePair | undefined =
      OwnedByFilter.getOwnerTableRegistry().get(kind);

    if (!pair) {
      return null;
    }

    return {
      userTable: OwnedByFilter.getOwnerTable({
        service: pair.ownerUserService,
        resourceColumnName: pair.fkColumn,
        ownerColumnName: "userId",
      }),
      teamTable: OwnedByFilter.getOwnerTable({
        service: pair.ownerTeamService,
        resourceColumnName: pair.fkColumn,
        ownerColumnName: "teamId",
      }),
    };
  }

  /*
   * The condition `ownedBy` puts on the ids of `modelType`'s records
   * (QueryHelper.ownedBy). A kind without owners is refused: a filter that
   * cannot be answered is never left out, which would list every record.
   */
  public static getIdCondition(
    modelType: { new (): BaseModel },
    ownedBy: OwnedBy,
  ): FindOperator<any> {
    const tables: OwnerTablesOfKind | null =
      OwnedByFilter.getOwnerTables(modelType);

    if (!tables) {
      throw OwnedByFilter.getNoOwnersException(modelType);
    }

    return QueryHelper.ownedBy({
      match: ownedBy.match,
      userIds: ownedBy.userIds,
      teamIds: ownedBy.teamIds,
      userTable: tables.userTable,
      teamTable: tables.teamTable,
    }) as FindOperator<any>;
  }

  // What a filter by owners on a kind without owners is told.
  public static getNoOwnersException(modelType: {
    new (): BaseModel;
  }): BadDataException {
    const name: string =
      new modelType().pluralName ||
      (modelType as unknown as { name?: string })?.name ||
      "These records";

    return new BadDataException(
      `${name} have no owners, so they cannot be filtered by their owners.`,
    );
  }

  private static getOwnerTable(data: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service: any;
    resourceColumnName: string;
    ownerColumnName: string;
  }): OwnerTable {
    const modelType: { new (): BaseModel } = data.service.modelType;

    return {
      modelType: modelType,
      tableName: new modelType().tableName as string,
      resourceColumnName: data.resourceColumnName,
      ownerColumnName: data.ownerColumnName,
    };
  }

  private static getOwnerTableRegistry(): Map<string, OwnerTablePair> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    return require("./Permissions/OwnerTableRegistry").default;
  }
}
