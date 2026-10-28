import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import Query from "../Query";
import QueryHelper from "../QueryHelper";
import QueryUtil from "../QueryUtil";
import Select from "../Select";
import TablePermission from "./TablePermission";
/*
 * Type-only import: keeps the OwnerTablePair shape available without
 * triggering a runtime load of the registry (which imports 20 owner
 * services that extend DatabaseService). The registry is lazy-required
 * inside getAllowedResourceIds to avoid the class-extends-undefined
 * circular-dep crash at module init.
 */
import type { OwnerTablePair } from "./OwnerTableRegistry";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import MultiSearch from "../../../../Types/BaseDatabase/MultiSearch";
import { FindWhereProperty } from "../../../../Types/BaseDatabase/Query";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import { OwnedThroughMetadata } from "../../../../Types/Database/AccessControl/OwnedThrough";
import PermissionScope from "../../../../Types/Database/AccessControl/PermissionScope";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import HeldPermissionsUtil from "../../../../Types/HeldPermissions";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  UserPermission,
} from "../../../../Types/Permission";
import { combineWithPrivacyClause } from "../../../Utils/PrivacyFilterUtil";
import logger from "../../../Utils/Logger";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

/*
 * A column kept to the owners (OwnedScopePermission.getColumnsKeptToOwners),
 * and the teams whose records it is read on beside the caller's own.
 */
export interface ColumnKeptToOwners {
  column: string;
  teamIds: Array<ObjectID>;
}

/*
 * Implements the `Owned` permission scope (see
 * Internal/Docs/PermissionsSimplification.md). When the requesting user's
 * applicable permission rows are exclusively `Owned`-scoped, this restricts
 * the query to resources where the user is in *OwnerUser or the team of one
 * of those rows is in *OwnerTeam.
 *
 * EACH TEAM'S GRANT REACHES WHAT THAT TEAM OWNS. A row scoped to Owned is a
 * team's permission on the resources that team owns (UserPermission.teamId),
 * and on the ones the member owns themselves - never on the resources the
 * member's other teams own. A member of a team that may change what it owns
 * and of a team that may only view what it owns changes the first team's
 * incidents, and only views the second's (getOwningTeamIds).
 *
 * `All` and `Labels` scoped rows are evaluated elsewhere. A row over the
 * whole project beside the Owned ones reaches every record, and this filter
 * is skipped. Rows limited to labels beside them reach the records carrying
 * their labels, and the Owned rows still reach what they own: the two are
 * one condition (AccessControlPermission.addGrantToQuery, with
 * getOwnedRecordsCondition), and this filter is skipped too.
 *
 * addOwnedScopeToQuery is the rule for one operation. The record rule
 * narrows a write by its read's scope as well, and so asks the two halves
 * itself (BasePermission.addRecordScopeToQuery: isLimitedToOwnedRecords
 * and getOwningTeamIds per operation, then addOwnedRecordsToQuery once for
 * each set of teams).
 *
 * The owners of a resource are owned through it (getOwnedThrough): a grant
 * scoped to Owned adds and removes owners only on the resources the caller
 * or their teams own, however many more they may read.
 *
 * EVERY KIND WITH OWNERS IS NARROWED: the kinds of OwnerTableRegistry, the
 * records that take their owners from one (@OwnedThrough) and the owner
 * rows themselves. A kind other records are set up with - a probe, a
 * runner, a template, an on-call schedule - stays readable to every reader
 * of it, as picking one needs (leavesReadsAlone); its changes and deletes
 * keep to the scope like every other kind's.
 */
export default class OwnedScopePermission {
  @CaptureSpan()
  public static async addOwnedScopeToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): Promise<Query<TBaseModel>> {
    if (!OwnedScopePermission.isLimitedToOwnedRecords(modelType, props, type)) {
      return query;
    }

    return await OwnedScopePermission.addOwnedRecordsToQuery(
      modelType,
      query,
      props,
      OwnedScopePermission.getOwningTeamIds(modelType, props, type),
    );
  }

  /*
   * Whether the caller's grants for `type` on this model reach only the
   * records they or their teams own: every row that grants it is
   * Owned-scoped. Decided without a lookup. Which teams' records it reaches
   * is getOwningTeamIds: the records differ from one operation to another
   * when different teams grant them, so a write limited to owned records
   * for itself and for its read is narrowed by each.
   */
  public static isLimitedToOwnedRecords<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): boolean {
    return (
      OwnedScopePermission.getOwnedOnlyGrantRows(modelType, props, type) !==
      null
    );
  }

  /*
   * THE TEAMS WHOSE RECORDS AN OWNED GRANT REACHES: the teams of the rows
   * that grant `type` on this model, for a caller whose every such row is
   * Owned-scoped (isLimitedToOwnedRecords) - each row reaches what its own
   * team owns (UserPermission.teamId), beside what the caller owns
   * themselves. Each team once, in the order the rows name them. Empty for
   * a caller whose grants are not limited to owned records, and for rows no
   * team grants: those reach only what the caller owns.
   */
  public static getOwningTeamIds<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): Array<ObjectID> {
    return OwnedScopePermission.getTeamIdsOfRows(
      OwnedScopePermission.getOwnedOnlyGrantRows(modelType, props, type) || [],
    );
  }

  // The teams `rows` are granted on, each once (HeldPermissionsUtil).
  public static getTeamIdsOfRows(
    rows: ReadonlyArray<UserPermission>,
  ): Array<ObjectID> {
    return HeldPermissionsUtil.getTeamIdsOfRows(rows);
  }

  /*
   * Of the lists of teams a query is to be narrowed by - one per operation
   * limited to owned records - the ones to narrow by, each a condition of
   * its own: the records one list reaches are the caller's own and its
   * teams', so a list that holds every team of another reaches every
   * record that other one does, and adds nothing to its condition. Only the
   * smaller is kept; of two lists of the same teams, the first.
   */
  public static getTeamListsToNarrowBy(
    teamLists: ReadonlyArray<ReadonlyArray<ObjectID>>,
  ): Array<Array<ObjectID>> {
    const keyed: Array<{ teamIds: Array<ObjectID>; keys: Set<string> }> =
      teamLists.map((teamIds: ReadonlyArray<ObjectID>) => {
        return {
          teamIds: [...teamIds],
          keys: new Set<string>(
            teamIds.map((teamId: ObjectID): string => {
              return teamId.toString().toLowerCase();
            }),
          ),
        };
      });

    const isWithin: (keys: Set<string>, within: Set<string>) => boolean = (
      keys: Set<string>,
      within: Set<string>,
    ): boolean => {
      for (const key of keys) {
        if (!within.has(key)) {
          return false;
        }
      }

      return true;
    };

    return keyed
      .filter(
        (
          list: { teamIds: Array<ObjectID>; keys: Set<string> },
          index: number,
        ): boolean => {
          return !keyed.some(
            (
              other: { teamIds: Array<ObjectID>; keys: Set<string> },
              otherIndex: number,
            ): boolean => {
              if (otherIndex === index || !isWithin(other.keys, list.keys)) {
                return false;
              }

              // Two lists of the same teams: the first one is kept.
              return !isWithin(list.keys, other.keys) || otherIndex < index;
            },
          );
        },
      )
      .map((list: { teamIds: Array<ObjectID>; keys: Set<string> }) => {
        return list.teamIds;
      });
  }

  /*
   * Whether the records `teamIds` reach (the caller's own and those
   * teams') are all among the ones `withinTeamIds` reach: every team of the
   * one is a team of the other.
   */
  public static isTeamListWithin(
    teamIds: ReadonlyArray<ObjectID>,
    withinTeamIds: ReadonlyArray<ObjectID>,
  ): boolean {
    const within: Set<string> = new Set<string>(
      withinTeamIds.map((teamId: ObjectID): string => {
        return teamId.toString().toLowerCase();
      }),
    );

    return teamIds.every((teamId: ObjectID): boolean => {
      return within.has(teamId.toString().toLowerCase());
    });
  }

  /*
   * The rows that grant `type` on this model, when every one of them is
   * Owned-scoped - the caller's grants reach only the records they or the
   * rows' teams own - or null when they are not limited to owned records:
   * a root caller, a create, a model with nothing to own, no row at all, a
   * row of another scope among them, or a read the scope leaves alone.
   */
  private static getOwnedOnlyGrantRows<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): Array<UserPermission> | null {
    if (props.isRoot || props.isMasterAdmin) {
      return null;
    }

    /*
     * Create has no resource to scope to; auto-owner-on-create lives in the
     * create path itself, not here.
     */
    if (type === DatabaseRequestType.Create) {
      return null;
    }

    // A model, or a read, the scope narrows nothing of. See narrowsRecords.
    if (!OwnedScopePermission.narrowsRecords(modelType, type)) {
      return null;
    }

    /*
     * The permissions whose rows grant this operation, as the table check
     * reads them: the model's own, and its operational-resource wildcard
     * unless a block with no labels takes the wildcard away.
     */
    const effectivePermissions: Array<Permission> =
      TablePermission.getGrantingPermissions(
        modelType as DatabaseBaseModelType,
        type,
        props,
      );

    const userPermissions: Array<UserPermission> =
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        props,
        PermissionType.Allow,
      );

    const applicableRows: Array<UserPermission> = userPermissions.filter(
      (p: UserPermission) => {
        return effectivePermissions.includes(p.permission);
      },
    );

    if (applicableRows.length === 0) {
      /*
       * No grant applies — the existing table-level check will reject this
       * request. Leave the query untouched.
       */
      return null;
    }

    /*
     * If any applicable row is non-Owned (All / Labels / undefined), the
     * Owned rows are not all there is: a row over the whole project grants
     * broader access than Owned and the Owned constraint is moot, and rows
     * limited to labels reach their records beside what the Owned rows own
     * (AccessControlPermission.getLabelGrantForModel). Rows for
     * scope-exempt permissions (e.g. ProjectOwner) are treated as broader
     * grants regardless of their stored scope, since scoping doesn't apply
     * to them.
     */
    const hasNonOwnedGrant: boolean = applicableRows.some(
      (p: UserPermission) => {
        if (!PermissionHelper.isScopeApplicable(p.permission)) {
          return true;
        }
        return p.scope !== PermissionScope.Owned;
      },
    );

    if (hasNonOwnedGrant) {
      return null;
    }

    return applicableRows;
  }

  /*
   * WHETHER THE OWNED SCOPE NARROWS `type` ON THIS MODEL'S RECORDS - or
   * whether a grant scoped to Owned reaches every one of them, as a grant
   * over the whole project does:
   *
   *   - a read, a change or a delete of a model whose records have owners:
   *     an operational resource, an explicitly registered ownership root, or
   *     a nested resource that inherits its owners via @OwnedThrough
   *     (hasOwners) - or, on a change or a delete, an owner table of a
   *     registered root (getOwnedThrough). For everything else (settings /
   *     config tables like IncidentState, Label, Team, etc.) the table-level
   *     permission check is the only gate: Owned has no resources to scope
   *     to. Registry membership only enables ownership filtering;
   *     operational wildcard grants still require the existing decorator.
   *     A kind other records are set up with - the probe a monitor runs on,
   *     the template an incident is declared from, the on-call schedule an
   *     escalation rule pages - is read by every reader of it all the same,
   *     and so are the records that take their owners from it: picking one
   *     is reading it. Its changes and deletes keep to the scope
   *     (leavesReadsAlone);
   *   - a create of a record whose creator becomes one of its owners
   *     (hasOwnerTables), or that names the parent it takes its owners from
   *     (getOwnedThrough, an owner row's resource among them): what it may
   *     create keeps to what its creator, or their teams, own
   *     (CreateScopePermission).
   */
  public static narrowsRecords(
    modelType: { new (): BaseModel },
    type: DatabaseRequestType,
  ): boolean {
    if (type === DatabaseRequestType.Create) {
      return (
        OwnedScopePermission.hasOwnerTables(modelType) ||
        OwnedScopePermission.getOwnedThrough(modelType) !== null
      );
    }

    if (
      !OwnedScopePermission.hasOwners(modelType) &&
      !OwnedScopePermission.isOwnerTableWrite(modelType, type)
    ) {
      return false;
    }

    return !(
      type === DatabaseRequestType.Read &&
      OwnedScopePermission.leavesReadsAlone(modelType)
    );
  }

  /*
   * THE RECORDS THE CALLER OR ONE OF `teamIds` OWNS, as a condition rather
   * than a narrowed query: one on the record's id, or - for a model that
   * takes its owners from a parent (getOwnedThrough) - on the key naming
   * the parent (`columnName`), with the rows of no parent where they belong
   * to the project (includeUnattributed). The records addOwnedRecordsToQuery
   * keeps, for a grant scoped to Owned that stands beside grants limited to
   * labels: the two reach their records together
   * (AccessControlPermission.addGrantToQuery). Matches nothing for a caller
   * who owns nothing.
   */
  public static async getOwnedRecordsCondition<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    props: DatabaseCommonInteractionProps,
    teamIds: ReadonlyArray<ObjectID>,
  ): Promise<{
    columnName: string | null;
    condition: FindWhereProperty<any>;
  }> {
    const ownedThrough: OwnedThroughMetadata | null =
      OwnedScopePermission.getOwnedThrough(modelType);

    const allowedIds: Array<ObjectID> =
      await OwnedScopePermission.getAllowedResourceIds(
        modelType,
        props,
        teamIds,
      );

    if (!ownedThrough) {
      return { columnName: null, condition: QueryHelper.any(allowedIds) };
    }

    return {
      columnName: ownedThrough.fkColumn,
      condition: ownedThrough.includeUnattributed
        ? QueryHelper.inOrNull(allowedIds)
        : QueryHelper.any(allowedIds),
    };
  }

  /*
   * The records of a model read through another one (@CanAccessIfCanReadOn)
   * whose parent the caller or one of `teamIds` owns, as a condition rather
   * than a narrowed query: on the key naming the parent (`columnName`), or,
   * for parents through a join table, on the record's id. The records
   * addOwnedParentsToQuery keeps, for a read of the parent scoped to Owned
   * that stands beside one limited to labels (BasePermission
   * .addParentAccessToQuery). Null for a parent the rule cannot follow:
   * it reaches no record.
   */
  public static async getOwnedParentsCondition<
    TBaseModel extends BaseModel,
  >(data: {
    modelType: { new (): TBaseModel };
    props: DatabaseCommonInteractionProps;
    parentModelType: { new (): BaseModel };
    relation: string;
    relationColumn: TableColumnMetadata;
    teamIds: ReadonlyArray<ObjectID>;
  }): Promise<{
    columnName: string | null;
    condition: FindWhereProperty<any>;
  } | null> {
    // As addOwnedParentsToQuery: a parent owned through another has none here.
    const ownedParentIds: Array<ObjectID> =
      OwnedScopePermission.getOwnedThrough(data.parentModelType)
        ? []
        : await OwnedScopePermission.getAllowedResourceIds(
            data.parentModelType,
            data.props,
            data.teamIds,
          );

    if (
      data.relationColumn.type === TableColumnType.Entity &&
      data.relationColumn.manyToOneRelationColumn
    ) {
      return {
        columnName: data.relationColumn.manyToOneRelationColumn,
        condition: QueryHelper.any(ownedParentIds),
      };
    }

    const parentLinks: ReturnType<
      typeof QueryUtil.getManyToManyRelationMetadata
    > =
      data.relationColumn.type === TableColumnType.EntityArray
        ? QueryUtil.getManyToManyRelationMetadata(data.modelType, data.relation)
        : null;

    if (!parentLinks) {
      return null;
    }

    return {
      columnName: null,
      condition: QueryHelper.anyOfEntitiesInManyToMany({
        values: ownedParentIds,
        joinTableName: parentLinks.joinTableName,
        ownerColumnName: parentLinks.ownerColumnName,
        relationColumnName: parentLinks.relationColumnName,
      }),
    };
  }

  /*
   * Narrows `query` to the records the caller or one of `teamIds` owns, or
   * whose parent they own (@OwnedThrough, or the resource an owner row
   * names: getOwnedThrough) - for a caller whose grants are limited to owned
   * records (isLimitedToOwnedRecords), `teamIds` being the teams of those
   * grants (getOwningTeamIds).
   */
  public static async addOwnedRecordsToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    props: DatabaseCommonInteractionProps,
    teamIds: ReadonlyArray<ObjectID>,
  ): Promise<Query<TBaseModel>> {
    const ownedThrough: OwnedThroughMetadata | null =
      OwnedScopePermission.getOwnedThrough(modelType);

    // Resolve allowed resource IDs.
    const allowedIds: Array<ObjectID> =
      await OwnedScopePermission.getAllowedResourceIds(
        modelType,
        props,
        teamIds,
      );

    if (ownedThrough && ownedThrough.includeUnattributed) {
      /*
       * Nested resource whose rows may name no owning resource: those
       * belong to the project and stay, beside the rows of the parents the
       * user owns - AND-combined with any caller-supplied FK filter.
       */
      const fkColumn: string = ownedThrough.fkColumn;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (query as any)[fkColumn] = combineWithPrivacyClause(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (query as any)[fkColumn],
        QueryHelper.inOrNull(allowedIds),
      );
    } else if (ownedThrough) {
      /*
       * Nested resource: ownership inherits via the parent FK. The allowedIds
       * we computed are the parent's IDs, so filter on the FK column.
       */
      const fkColumn: string = ownedThrough.fkColumn;
      if (allowedIds.length === 0) {
        // No accessible parents -> match nothing.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (query as any)._id = QueryHelper.equalTo(
          ObjectID.getZeroObjectID().toString(),
        );
      } else {
        /*
         * AND-combine with any caller-supplied FK filter (e.g. the
         * dashboard's `incidentId: <this incident>`) — overwriting it would
         * widen the query to every owned parent.
         */
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (query as any)[fkColumn] = combineWithPrivacyClause(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (query as any)[fkColumn],
          QueryHelper.any(allowedIds),
        );
      }
    } else if (allowedIds.length === 0) {
      // Top-level operational resource: no accessible IDs -> match nothing.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (query as any)._id = QueryHelper.equalTo(
        ObjectID.getZeroObjectID().toString(),
      );
    } else {
      /*
       * Top-level operational resource: filter on _id, AND-combined with any
       * caller-supplied _id (get/update of a specific record) — overwriting
       * it would resolve the request against a different owned record.
       */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (query as any)._id = combineWithPrivacyClause(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (query as any)._id,
        QueryHelper.any(allowedIds),
      );
    }

    return query;
  }

  /*
   * Narrows the records of a model read through another one
   * (@CanAccessIfCanReadOn - an incident's notes, a status page's
   * announcements) to those of the parents the caller or one of `teamIds`
   * owns: for a caller whose grants on the parent reach only the records
   * they own (isLimitedToOwnedRecords on the parent), `teamIds` being the
   * teams of those grants (getOwningTeamIds on the parent). A parent named
   * by a key column keeps the rows whose key names an owned parent; parents
   * through a join table keep the rows linked to at least one owned parent.
   * A row with no parent, or with none the caller owns, is left out - as it
   * is when the parent's read is limited to labels. The caller's own
   * filters stay as sent.
   */
  public static async addOwnedParentsToQuery<
    TBaseModel extends BaseModel,
  >(data: {
    modelType: { new (): TBaseModel };
    query: Query<TBaseModel>;
    props: DatabaseCommonInteractionProps;
    parentModelType: { new (): BaseModel };
    // The @CanAccessIfCanReadOn relation, and its column.
    relation: string;
    relationColumn: TableColumnMetadata;
    // The teams whose parents the rows keep to, beside the caller's own.
    teamIds: ReadonlyArray<ObjectID>;
  }): Promise<Query<TBaseModel>> {
    /*
     * A parent that takes its owners from a record of its own
     * (@OwnedThrough, or an owner table: getOwnedThrough) has no owner rows
     * to look up here. No model is read through such a parent
     * (Tests/Models/DatabaseModels/ParentOwnedScopeCoverage); one that were
     * would reach none of its rows rather than every one of them.
     */
    const ownedParentIds: Array<ObjectID> =
      OwnedScopePermission.getOwnedThrough(data.parentModelType)
        ? []
        : await OwnedScopePermission.getAllowedResourceIds(
            data.parentModelType,
            data.props,
            data.teamIds,
          );

    if (ownedParentIds.length === 0) {
      // No owned parent: no record of theirs is reached.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (data.query as any)._id = QueryHelper.equalTo(
        ObjectID.getZeroObjectID().toString(),
      );

      return data.query;
    }

    if (
      data.relationColumn.type === TableColumnType.Entity &&
      data.relationColumn.manyToOneRelationColumn
    ) {
      const parentKey: string = data.relationColumn.manyToOneRelationColumn;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (data.query as any)[parentKey] = combineWithPrivacyClause(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (data.query as any)[parentKey],
        QueryHelper.any(ownedParentIds),
      );

      return data.query;
    }

    const parentLinks: ReturnType<
      typeof QueryUtil.getManyToManyRelationMetadata
    > =
      data.relationColumn.type === TableColumnType.EntityArray
        ? QueryUtil.getManyToManyRelationMetadata(data.modelType, data.relation)
        : null;

    /*
     * A parent the rule cannot follow - neither a key column nor a join
     * table - is a misconfigured model (Tests/Models/DatabaseModels
     * /ParentOwnedScopeCoverage holds every model to one the rule follows):
     * it reaches none of its rows, as a caller who owns no parent does,
     * never every one of them - and says so in the log.
     */
    if (!parentLinks) {
      logger.error(
        `${new data.modelType().singularName} is read through ${data.relation}, which the owned scope of ${new data.parentModelType().singularName} cannot follow: no key column or join table. The read reaches no records.`,
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (data.query as any)._id = QueryHelper.equalTo(
        ObjectID.getZeroObjectID().toString(),
      );

      return data.query;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (data.query as any)._id = combineWithPrivacyClause(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (data.query as any)._id,
      QueryHelper.anyOfEntitiesInManyToMany({
        values: ownedParentIds,
        joinTableName: parentLinks.joinTableName,
        ownerColumnName: parentLinks.ownerColumnName,
        relationColumnName: parentLinks.relationColumnName,
      }),
    );

    return data.query;
  }

  /*
   * WHETHER THE OWNED SCOPE LEAVES READS OF A MODEL ALONE: a kind other
   * records are set up with (OwnerTablePair.ownedScopeLeavesReads - probes,
   * runners, AI agents, templates, on-call schedules), or a model that
   * takes its owners only from such kinds (@OwnedThrough - a schedule's
   * layers - or an owner table's resource: getOwnedThrough). Whoever may
   * read it reads all of it, as labels and blocks allow, whatever the scope
   * of their grant; a grant scoped to Owned still changes and deletes only
   * the records its holder or their teams own. False for every other model:
   * a kind with owners is narrowed on reads too, and a model without owners
   * has nothing for the scope to narrow.
   */
  public static leavesReadsAlone(modelType: { new (): BaseModel }): boolean {
    const ownedThrough: OwnedThroughMetadata | null =
      OwnedScopePermission.getOwnedThrough(modelType);

    const kinds: Array<string | undefined> = ownedThrough
      ? ownedThrough.parentModels.map((parentModel: unknown) => {
          return OwnedScopePermission.getClassName(parentModel);
        })
      : [OwnedScopePermission.getClassName(modelType)];

    const ownerTableRegistry: Map<string, OwnerTablePair> =
      this.getOwnerTableRegistry();

    return (
      kinds.length > 0 &&
      kinds.every((kind: string | undefined): boolean => {
        return Boolean(
          kind && ownerTableRegistry.get(kind)?.ownedScopeLeavesReads,
        );
      })
    );
  }

  /*
   * THE COLUMNS OF A KIND WITH OWNERS THAT FOLLOW ITS OWNERS, HOWEVER FAR
   * THE READ OF THE KIND REACHES: the ones only those who may change the
   * kind may read (every permission that reads the column is one that
   * changes the kind) - a Runner's key, which lets whoever presents it claim
   * the work meant for that Runner, a monitor's secret keys, with which a
   * host agent's heartbeats are forged, and the secrets and credentials that
   * come with them. Reading such a column is as good as managing the
   * record, so for a caller whose every grant that lets them read it is
   * scoped to Owned, it is read only on the records they or the teams of
   * those grants own - whatever else lets them read the record: the Owned
   * scope leaves the reads of some kinds alone that they may be picked
   * (leavesReadsAlone), and a Viewer over the whole project beside a
   * Monitor Admin scoped to Owned reads every monitor. It is left out of
   * every other record they read (withholdColumnsKeptToOwners), a filter on
   * it reaches only the records they own (BasePermission
   * .addRecordScopeToQuery), and they may neither order the records by it
   * (DatabaseService) nor filter another record by it (QueryPermission): an
   * order or a match is read one guess at a time. None for a kind without
   * owners, which the scope has nothing to narrow on; none where the read of
   * the kind keeps to the records of those teams already; and none for a
   * caller with a grant over the whole project, or limited to labels, that
   * lets them read the column.
   */
  public static getColumnsKeptToOwners(
    modelType: { new (): BaseModel },
    props: DatabaseCommonInteractionProps,
  ): Array<string> {
    return OwnedScopePermission.getColumnsKeptToOwnersWithTeams(
      modelType,
      props,
    ).map((kept: ColumnKeptToOwners): string => {
      return kept.column;
    });
  }

  /*
   * The columns kept to the owners (getColumnsKeptToOwners), each with the
   * teams whose records it is read on beside the caller's own: the teams of
   * the Owned rows that let the caller read it (getTeamIdsOfRows).
   */
  public static getColumnsKeptToOwnersWithTeams(
    modelType: { new (): BaseModel },
    props: DatabaseCommonInteractionProps,
  ): Array<ColumnKeptToOwners> {
    if (
      props.isRoot ||
      props.isMasterAdmin ||
      !OwnedScopePermission.hasOwners(modelType)
    ) {
      return [];
    }

    const model: BaseModel = new modelType();
    const changePermissions: Array<Permission> = model.getUpdatePermissions();

    /*
     * The teams whose records a read of the kind keeps to already, when it
     * is limited to owned records: a column read on those teams' records
     * at least is left out of none of them.
     */
    const readTeamIds: Array<ObjectID> | null =
      OwnedScopePermission.isLimitedToOwnedRecords(
        modelType,
        props,
        DatabaseRequestType.Read,
      )
        ? OwnedScopePermission.getOwningTeamIds(
            modelType,
            props,
            DatabaseRequestType.Read,
          )
        : null;

    const userPermissions: Array<UserPermission> =
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        props,
        PermissionType.Allow,
      );

    const kept: Array<ColumnKeptToOwners> = [];

    for (const column of model.getTableColumns().columns) {
      const readPermissions: Array<Permission> =
        model.getColumnAccessControlFor(column)?.read || [];

      // A column nobody reads, or one some reader who may not change it reads.
      if (
        readPermissions.length === 0 ||
        !readPermissions.every((permission: Permission): boolean => {
          return changePermissions.includes(permission);
        })
      ) {
        continue;
      }

      const grantingRows: Array<UserPermission> = userPermissions.filter(
        (row: UserPermission): boolean => {
          return readPermissions.includes(row.permission);
        },
      );

      // No grant reads it at all: the select check refuses it already.
      if (
        grantingRows.length === 0 ||
        !grantingRows.every((row: UserPermission): boolean => {
          return (
            PermissionHelper.isScopeApplicable(row.permission) &&
            row.scope === PermissionScope.Owned
          );
        })
      ) {
        continue;
      }

      const teamIds: Array<ObjectID> =
        OwnedScopePermission.getTeamIdsOfRows(grantingRows);

      // The read reaches no record but the ones the column is read on.
      if (
        readTeamIds &&
        OwnedScopePermission.isTeamListWithin(readTeamIds, teamIds)
      ) {
        continue;
      }

      kept.push({ column: column, teamIds: teamIds });
    }

    return kept;
  }

  /*
   * Whether a model's records have owners for the Owned scope to narrow by:
   * an operational resource, a kind of the owner table registry, or a model
   * that takes its owners from one (@OwnedThrough). Every other model has
   * nothing for the scope to narrow (getOwnedOnlyGrantRows).
   */
  public static hasOwners(modelType: { new (): BaseModel }): boolean {
    const model: BaseModel = new modelType();

    return Boolean(
      model.isOperationalResource ||
        model.ownedThrough ||
        this.getOwnerTableRegistry().has(model.constructor.name),
    );
  }

  /*
   * Whether `query` filters on a column the caller reads only on the records
   * they or their teams own (getColumnsKeptToOwners) - by its name, or among
   * the columns a free-text search reads.
   */
  public static namesColumnsKeptToOwners<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    props: DatabaseCommonInteractionProps,
  ): boolean {
    return (
      OwnedScopePermission.getTeamListsOfColumnsKeptToOwnersNamed(
        modelType,
        query,
        props,
      ).length > 0
    );
  }

  /*
   * For each column kept to the owners that `query` filters on (see
   * namesColumnsKeptToOwners), the teams whose records the filter reaches
   * beside the caller's own: a match on such a column says what it holds,
   * so the read reaches only the records the column is read on.
   */
  public static getTeamListsOfColumnsKeptToOwnersNamed<
    TBaseModel extends BaseModel,
  >(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    props: DatabaseCommonInteractionProps,
  ): Array<Array<ObjectID>> {
    const kept: Array<ColumnKeptToOwners> =
      OwnedScopePermission.getColumnsKeptToOwnersWithTeams(modelType, props);

    if (kept.length === 0) {
      return [];
    }

    const named: Set<string> = new Set<string>();

    for (const key of Object.keys(query || {})) {
      const value: unknown = (query as Record<string, unknown>)[key];

      if (value instanceof MultiSearch) {
        for (const field of value.fields || []) {
          named.add(field);
        }

        continue;
      }

      named.add(key);
    }

    return kept
      .filter((column: ColumnKeptToOwners): boolean => {
        return named.has(column.column);
      })
      .map((column: ColumnKeptToOwners): Array<ObjectID> => {
        return column.teamIds;
      });
  }

  /*
   * Refuses an order by a column the caller reads only on the records they
   * or their teams own (getColumnsKeptToOwners) - of the model, or of a
   * record it names, ordered through the relation: where the other records
   * fall in it says what they hold, one guess at a time.
   */
  public static checkSortOnColumnsKeptToOwners(
    modelType: { new (): BaseModel },
    sort: unknown,
    props: DatabaseCommonInteractionProps,
    // How many relations deep the order is read: a few at most.
    depth: number = 0,
  ): void {
    if (!sort || typeof sort !== "object" || depth > 3) {
      return;
    }

    const kept: Array<string> = OwnedScopePermission.getColumnsKeptToOwners(
      modelType,
      props,
    );
    const model: BaseModel = new modelType();

    for (const [column, order] of Object.entries(
      sort as Record<string, unknown>,
    )) {
      if (kept.includes(column)) {
        throw new NotAuthorizedException(
          OwnedScopePermission.getColumnKeptToOwnersRefusal(modelType, column),
        );
      }

      // An order through a relation, by the related record's columns.
      const relatedModelType: { new (): BaseModel } | undefined =
        order && typeof order === "object"
          ? (model.getTableColumnMetadata(column)?.modelType as
              | { new (): BaseModel }
              | undefined)
          : undefined;

      if (relatedModelType) {
        OwnedScopePermission.checkSortOnColumnsKeptToOwners(
          relatedModelType,
          order,
          props,
          depth + 1,
        );
      }
    }
  }

  // How a use of a column kept to the owners is refused (getColumnsKeptToOwners).
  public static getColumnKeptToOwnersRefusal(
    modelType: { new (): BaseModel },
    column: string,
  ): string {
    const model: BaseModel = new modelType();
    const title: string = model.getTableColumnMetadata(column)?.title || column;

    return `Your access lets you read the ${title} only of the ${model.pluralName} you or your teams own, so you cannot sort or filter ${model.pluralName} by it.`;
  }

  /*
   * Leaves the columns kept to the owners (getColumnsKeptToOwners) out of
   * the rows a read hands back that the caller and their teams do not own:
   * the rest of each record is read as before. A row that takes its owners
   * from another record (getOwnedThrough) is theirs when the record it
   * names is. A row read without what tells whose it is - its id, or the
   * key naming the record it takes its owners from - is left without them
   * too.
   */
  public static async withholdColumnsKeptToOwners<
    TBaseModel extends BaseModel,
  >(data: {
    modelType: { new (): TBaseModel };
    rows: Array<TBaseModel>;
    select: Select<TBaseModel> | null | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<TBaseModel>> {
    if (data.rows.length === 0 || !data.select) {
      return data.rows;
    }

    const selected: Array<ColumnKeptToOwners> =
      OwnedScopePermission.getColumnsKeptToOwnersWithTeams(
        data.modelType,
        data.props,
      ).filter((kept: ColumnKeptToOwners): boolean => {
        return Boolean((data.select as Record<string, unknown>)[kept.column]);
      });

    if (selected.length === 0) {
      return data.rows;
    }

    const ownedThrough: OwnedThroughMetadata | null =
      OwnedScopePermission.getOwnedThrough(data.modelType);

    /*
     * Each column is read on the records its own grants' teams own (and the
     * caller's own): the records are looked up once for each set of teams.
     */
    const ownedIdsByTeams: Map<string, Set<string>> = new Map<
      string,
      Set<string>
    >();

    for (const kept of selected) {
      const key: string = OwnedScopePermission.getTeamListKey(kept.teamIds);

      if (ownedIdsByTeams.has(key)) {
        continue;
      }

      ownedIdsByTeams.set(
        key,
        new Set<string>(
          (
            await OwnedScopePermission.getOwnedIds(
              data.modelType,
              data.props,
              kept.teamIds,
            )
          ).map((id: ObjectID): string => {
            return id.toString().toLowerCase();
          }),
        ),
      );
    }

    for (const row of data.rows) {
      const values: Record<string, unknown> = row as unknown as Record<
        string,
        unknown
      >;
      const ownerKey: unknown = ownedThrough
        ? values[ownedThrough.fkColumn]
        : row._id;

      for (const kept of selected) {
        const ownedIds: Set<string> | undefined = ownedIdsByTeams.get(
          OwnedScopePermission.getTeamListKey(kept.teamIds),
        );

        if (
          ownerKey !== null &&
          ownerKey !== undefined &&
          ownedIds?.has(ownerKey.toString().toLowerCase())
        ) {
          continue;
        }

        values[kept.column] = undefined;
      }
    }

    return data.rows;
  }

  // One key for a set of teams, whatever their order or case.
  private static getTeamListKey(teamIds: ReadonlyArray<ObjectID>): string {
    return teamIds
      .map((teamId: ObjectID): string => {
        return teamId.toString().toLowerCase();
      })
      .sort()
      .join(",");
  }

  /*
   * Whether a model's records have owner rows of their own (OwnerTableRegistry:
   * the operational resources and the rest that carry owners) - the ones
   * whose creator becomes an owner (DatabaseService.autoOwnerOnCreate).
   */
  public static hasOwnerTables(modelType: { new (): BaseModel }): boolean {
    return this.getOwnerTableRegistry().has(
      (modelType as unknown as { name: string }).name,
    );
  }

  /*
   * The records the caller or one of `teamIds` owns, by id: of the model
   * itself, or - for a model that takes its owners from a parent
   * (@OwnedThrough, or an owner table: getOwnedThrough) - of that parent. In
   * the request's project. `teamIds` are the teams of the Owned grants
   * being weighed (getOwningTeamIds), never every team the caller is on.
   */
  public static async getOwnedIds(
    modelType: { new (): BaseModel },
    props: DatabaseCommonInteractionProps,
    teamIds: ReadonlyArray<ObjectID>,
  ): Promise<Array<ObjectID>> {
    return await OwnedScopePermission.getAllowedResourceIds(
      modelType,
      props,
      teamIds,
    );
  }

  /*
   * THE RECORD A MODEL'S ROWS TAKE THEIR OWNERS FROM, for the Owned scope:
   * the parent its @OwnedThrough names - a monitor's status timeline, an
   * incident's notes - or, for an owner table of a kind with owners of its
   * own (OwnerTableRegistry: MonitorOwnerUser and MonitorOwnerTeam, and
   * every other kind's), the resource its rows name. Null for any other
   * model.
   *
   * AN OWNER ROW IS OWNED THROUGH ITS RESOURCE. Who owns a monitor is what
   * the Owned scope reads to decide what a member may manage, so adding or
   * removing an owner is managing the monitor: a grant scoped to Owned adds
   * and removes owners only on the monitors the caller or one of their teams
   * own, however many more they may read - reading a monitor is not owning
   * it. A create is held to it by CreateScopePermission (checkOwnedCreate),
   * a change and a delete by the record rule (isLimitedToOwnedRecords,
   * isOwnerTableWrite). A read of owners is not: who owns a resource is read
   * through the resource (BasePermission.addParentAccessToQuery), by its own
   * read rule and scope.
   *
   * Read off the registry, not declared on each owner table, so a kind that
   * is registered there has its owner tables held to the same rule with no
   * other change; the owner tables of a kind that is not are left as before,
   * as its own records are (isLimitedToOwnedRecords).
   */
  public static getOwnedThrough(modelType: {
    new (): BaseModel;
  }): OwnedThroughMetadata | null {
    const declared: OwnedThroughMetadata | null = new modelType().ownedThrough;

    if (declared) {
      return declared;
    }

    return OwnedScopePermission.getOwnerTableOwnership(modelType);
  }

  /*
   * Whether `modelType` is an owner table of a kind with owners of its own
   * (getOwnedThrough): MonitorOwnerUser, MonitorOwnerTeam and the like.
   */
  public static isOwnerTable(modelType: { new (): BaseModel }): boolean {
    return OwnedScopePermission.getOwnerTableOwnership(modelType) !== null;
  }

  /*
   * Whether `type` on `modelType` is a change or a delete of an owner table's
   * rows - one the Owned scope holds to the resource's owners
   * (getOwnedThrough). A read is not: owners are read through the resource.
   * A create is held to it on the record it makes (CreateScopePermission).
   */
  private static isOwnerTableWrite(
    modelType: { new (): BaseModel },
    type: DatabaseRequestType,
  ): boolean {
    return (
      (type === DatabaseRequestType.Update ||
        type === DatabaseRequestType.Delete) &&
      OwnedScopePermission.isOwnerTable(modelType)
    );
  }

  // The resource each owner table's rows name, worked out once per table.
  private static ownerTableResources: WeakMap<
    OwnerTablePair,
    Map<{ new (): BaseModel }, OwnedThroughMetadata>
  > = new WeakMap();

  /*
   * See getOwnedThrough: the resource an owner table of a registered kind
   * names, as @OwnedThrough would declare it - the key column the registry
   * reads its owners by, and the model of the relation on that column. Null
   * for a model that is no registered kind's owner table. The registry is
   * read on every call, so a kind registered after the first request is held
   * to it too. An owner table is known by its model's name, as the registry
   * knows its kinds: a second copy of its class, should a module ever be
   * loaded twice, is the same table and held to the same rule, never left
   * unscoped.
   */
  private static getOwnerTableOwnership(modelType: {
    new (): BaseModel;
  }): OwnedThroughMetadata | null {
    const modelName: string | undefined =
      OwnedScopePermission.getClassName(modelType);

    if (!modelName) {
      return null;
    }

    for (const [kind, pair] of this.getOwnerTableRegistry().entries()) {
      if (
        OwnedScopePermission.getClassName(pair.ownerUserService?.modelType) !==
          modelName &&
        OwnedScopePermission.getClassName(pair.ownerTeamService?.modelType) !==
          modelName
      ) {
        continue;
      }

      let resources:
        | Map<{ new (): BaseModel }, OwnedThroughMetadata>
        | undefined = OwnedScopePermission.ownerTableResources.get(pair);

      if (!resources) {
        resources = new Map<{ new (): BaseModel }, OwnedThroughMetadata>();
        OwnedScopePermission.ownerTableResources.set(pair, resources);
      }

      let ownedThrough: OwnedThroughMetadata | undefined =
        resources.get(modelType);

      if (!ownedThrough) {
        ownedThrough = {
          fkColumn: pair.fkColumn,
          parentModels: [
            OwnedScopePermission.getOwnedResourceType({
              ownerTableType: modelType,
              fkColumn: pair.fkColumn,
              kind: kind,
            }),
          ],
          includeProjectScope: false,
          onlyParentModels: true,
          includeUnattributed: false,
        };

        resources.set(modelType, ownedThrough);
      }

      return ownedThrough;
    }

    return null;
  }

  // A model class's name - what the registry knows models by - if it has one.
  private static getClassName(modelType: unknown): string | undefined {
    const name: unknown = (modelType as { name?: unknown } | undefined)?.name;

    return typeof name === "string" && name ? name : undefined;
  }

  /*
   * The model of the resource an owner table names by `fkColumn`: the
   * relation on that column (MonitorOwnerUser.monitor names a Monitor), which
   * must be the registry's kind (Tests/Models/DatabaseModels
   * /OwnerTablesReadThroughResource holds every owner table to it). An owner
   * table that names no such relation is a misconfigured registry entry: it
   * is refused rather than left unscoped.
   */
  private static getOwnedResourceType(data: {
    ownerTableType: { new (): BaseModel };
    fkColumn: string;
    kind: string;
  }): { new (): BaseModel } {
    const ownerTable: BaseModel = new data.ownerTableType();

    for (const column of ownerTable.getTableColumns().columns) {
      const metadata: TableColumnMetadata | undefined =
        ownerTable.getTableColumnMetadata(column);

      if (
        metadata &&
        metadata.type === TableColumnType.Entity &&
        metadata.manyToOneRelationColumn === data.fkColumn &&
        metadata.modelType &&
        (metadata.modelType as unknown as { name: string }).name === data.kind
      ) {
        return metadata.modelType as { new (): BaseModel };
      }
    }

    throw new BadDataException(
      `${ownerTable.singularName || data.kind} names no ${data.kind} by ${data.fkColumn}, so the Owned scope cannot tell whose it is.`,
    );
  }

  private static getOwnerTableRegistry(): Map<string, OwnerTablePair> {
    /*
     * Services in this registry extend DatabaseService, which imports this
     * permission class. Resolve at request time after both classes exist.
     */
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    return require("./OwnerTableRegistry").default;
  }

  /*
   * Computes the set of resource IDs the requesting user can access via
   * ownership: those where they personally sit in *OwnerUser OR where one of
   * `teamIds` - the teams of the Owned grants being weighed - sits in
   * *OwnerTeam. Not every team the user is on (props.userTeamIds): a team's
   * grant reaches what that team owns.
   *
   * For nested models the lookup uses the parent's owner tables and returns
   * parent IDs (the caller filters the nested query by the parent FK).
   */
  private static async getAllowedResourceIds<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    props: DatabaseCommonInteractionProps,
    teamIds: ReadonlyArray<ObjectID>,
  ): Promise<Array<ObjectID>> {
    const ownedThrough: OwnedThroughMetadata | null =
      OwnedScopePermission.getOwnedThrough(modelType);

    /*
     * Which model(s) owner tables to consult. A nested model can inherit
     * ownership from several parent resource types when its FK is
     * polymorphic (e.g. a telemetry serviceId that may point at a Service,
     * Host, DockerHost or KubernetesCluster) — resolve and union the owned
     * ids across all of them. Top-level operational resources consult
     * their own owner tables, and an owner table its resource's.
     */
    const resolverNames: Array<string> = ownedThrough
      ? ownedThrough.parentModels.map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (parentModel: any) => {
            return parentModel.name;
          },
        )
      : // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [(modelType as any).name];

    const ownerTableRegistry: Map<string, OwnerTablePair> =
      this.getOwnerTableRegistry();

    const seen: Set<string> = new Set<string>();

    for (const resolverName of resolverNames) {
      const registryEntry: OwnerTablePair | undefined =
        ownerTableRegistry.get(resolverName);
      if (!registryEntry) {
        /*
         * No registered owner tables for this parent — skip it. Other
         * parents (or includeProjectScope below) may still resolve.
         */
        continue;
      }

      const fkColumn: string = registryEntry.fkColumn;

      /*
       * User-ownership lookup. Skipped for non-user callers (API keys,
       * Probes with no userId); those evaluate `Owned` as `All` elsewhere.
       */
      if (props.userId) {
        const userOwnedRows: Array<BaseModel> =
          await registryEntry.ownerUserService.findBy({
            query: {
              userId: props.userId,
              ...(props.tenantId ? { projectId: props.tenantId } : {}),
            },
            select: { [fkColumn]: true },
            props: { isRoot: true },
            skip: 0,
            limit: LIMIT_MAX,
          });
        for (const row of userOwnedRows) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const value: ObjectID | undefined = (row as any)[fkColumn];
          if (value) {
            seen.add(value.toString());
          }
        }
      }

      // Team-ownership lookup: the granting teams only.
      if (teamIds.length > 0) {
        const teamOwnedRows: Array<BaseModel> =
          await registryEntry.ownerTeamService.findBy({
            query: {
              teamId: QueryHelper.any([...teamIds]),
              ...(props.tenantId ? { projectId: props.tenantId } : {}),
            },
            select: { [fkColumn]: true },
            props: { isRoot: true },
            skip: 0,
            limit: LIMIT_MAX,
          });
        for (const row of teamOwnedRows) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const value: ObjectID | undefined = (row as any)[fkColumn];
          if (value) {
            seen.add(value.toString());
          }
        }
      }
    }

    /*
     * Polymorphic FK rows with no owning resource (the unattributed
     * "Unknown" telemetry bucket) carry the projectId in the FK column.
     * They belong to the project, not any single owner, so include the
     * tenant id when the model opts in via includeProjectScope.
     */
    if (ownedThrough?.includeProjectScope && props.tenantId) {
      seen.add(props.tenantId.toString());
    }

    const result: Array<ObjectID> = [];
    for (const id of seen) {
      result.push(new ObjectID(id));
    }
    return result;
  }
}
