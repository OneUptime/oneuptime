import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import Query from "../Query";
import QueryHelper from "../QueryHelper";
import TablePermission from "./TablePermission";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import { FindWhereProperty } from "../../../../Types/BaseDatabase/Query";
import Dictionary from "../../../../Types/Dictionary";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  UserPermission,
} from "../../../../Types/Permission";
import Text from "../../../../Types/Text";
import {
  combineWithPrivacyClause,
  shouldBypassRecordPrivacy,
} from "../../../Utils/PrivacyFilterUtil";
import { FindOperator, Raw } from "typeorm";

/*
 * THE KINDS OF RECORD THAT CAN BE PRIVATE - an incident, an alert and the
 * two kinds of episode - with the tables their owners and labels are kept
 * in. A private record is seen only by its owners (the people named on it
 * and the members of the teams named on it) and by the project's owners and
 * admins (the privacy filters, Utils/Incident/IncidentPrivacyFilter and its
 * three twins, which name the same tables). PrivateRecordKinds.test holds
 * each entry to the model's own metadata: its table, its owner tables and
 * their key (OwnerTableRegistry), and its labels' join table.
 */
export interface PrivateRecordKind {
  // The model's table, and its name: "Incident".
  tableName: string;
  ownerUserTable: string;
  ownerTeamTable: string;
  // The key the owner rows name the record by: "incidentId".
  ownerKey: string;
  // The join table of the record's labels, and its two keys.
  labelTable: string;
  labelRecordKey: string;
  labelKey: string;
}

export const PRIVATE_RECORD_KINDS: ReadonlyArray<PrivateRecordKind> = [
  {
    tableName: "Incident",
    ownerUserTable: "IncidentOwnerUser",
    ownerTeamTable: "IncidentOwnerTeam",
    ownerKey: "incidentId",
    labelTable: "IncidentLabel",
    labelRecordKey: "incidentId",
    labelKey: "labelId",
  },
  {
    tableName: "Alert",
    ownerUserTable: "AlertOwnerUser",
    ownerTeamTable: "AlertOwnerTeam",
    ownerKey: "alertId",
    labelTable: "AlertLabel",
    labelRecordKey: "alertId",
    labelKey: "labelId",
  },
  {
    tableName: "IncidentEpisode",
    ownerUserTable: "IncidentEpisodeOwnerUser",
    ownerTeamTable: "IncidentEpisodeOwnerTeam",
    ownerKey: "incidentEpisodeId",
    labelTable: "IncidentEpisodeLabel",
    labelRecordKey: "incidentEpisodeId",
    labelKey: "labelId",
  },
  {
    tableName: "AlertEpisode",
    ownerUserTable: "AlertEpisodeOwnerUser",
    ownerTeamTable: "AlertEpisodeOwnerTeam",
    ownerKey: "alertEpisodeId",
    labelTable: "AlertEpisodeLabel",
    labelRecordKey: "alertEpisodeId",
    labelKey: "labelId",
  },
];

/*
 * A private record a model's rows belong to, and the column of the rows
 * that names it: the record itself (`_id` of an incident), or the record a
 * part of one is read through (@CanAccessIfCanReadOn - `incidentId` of an
 * incident's note, its owners, its state timeline).
 */
export interface PrivateRecordColumn {
  kind: PrivateRecordKind;
  // The model of the private records: Incident.
  recordModelType: { new (): BaseModel };
  column: string;
  // Whether the rows are the private records themselves.
  isRecord: boolean;
}

/*
 * WHAT A CALLER'S PERMISSION FOR ONE OPERATION REACHES OF THE PRIVATE
 * RECORDS: those they own themselves - every permission a person holds
 * reaches the records named on them - and, for each team that grants the
 * operation, those that team owns. A team whose every grant of it is
 * limited to labels reaches only the ones of its records carrying one of
 * them. Nothing else: a team that does not own a private record lends it
 * none of its permissions, whatever they reach of the project's other
 * records.
 */
export interface PrivateRecordReach {
  // The person, whose own records every permission of theirs reaches.
  userId: ObjectID | null;
  // Teams any of whose grants reaches every record that team owns.
  teamIds: Array<ObjectID>;
  // Teams whose every grant is limited to labels, with those labels.
  labelledTeams: Array<{ teamId: ObjectID; labelIds: Array<ObjectID> }>;
}

/*
 * A PRIVATE RECORD IS CHANGED ONLY THROUGH ITS OWNERS (block 33 of the
 * maintainer's task document).
 *
 * Who may see a private incident, alert or episode is decided by its
 * owners: the people named on it and the members of the teams named on it
 * see it, as do the project's owners and admins - with the permission to
 * read it they hold, as any record is read (the privacy filters). What they
 * may DO to it is decided by its owners too:
 *
 *   - a person named as an owner acts on it with every permission they
 *     hold, as on any other record;
 *   - a member of a team named as an owner acts on it with that team's
 *     permissions: a team that may only view incidents views it, whatever
 *     another team of the member's may do;
 *   - the project's owners and admins act on every private record
 *     (shouldBypassRecordPrivacy), as they see every one.
 *
 * A permission of a team that does not own the record reaches none of it,
 * as that team's members who are on no owning team cannot see it: Team 1
 * may change every incident it can see, and a private incident only Team 2
 * owns is not one Team 1 can see. Before this, a member of both teams
 * changed it with Team 1's permission because Team 2 let them see it - a
 * view-only owner team's private incident edited, its state changed, its
 * notes and owners rewritten and the incident deleted, through another
 * team's rights.
 *
 * Each team's grant is weighed with its own scope: one limited to labels
 * reaches the records of its team carrying one of its labels, one scoped to
 * Owned the records its team owns (which on a private record is the same as
 * an unscoped one). It holds for every write of the record and of its parts
 * (the records read through it: notes, owners, state timeline, roles,
 * calls, links), and for every operation separately - an Edit from one team
 * and a Delete from another reach what each of those teams owns:
 *
 *   - an update and a delete, in the record rule
 *     (BasePermission.addRecordScopeToQuery: addPrivateRecordScopeToQuery);
 *   - a create of a part under a private record, and a part moved under
 *     one (CreatePermission.checkParentIds: getUnreachableParentIds);
 *   - the routes that check a caller and then write as OneUptime (an
 *     incident call's transcript): assertMayWriteUnder.
 *
 * A read is not narrowed here: who sees a private record is its owners, by
 * membership, as before.
 */
export default class PrivateRecordPermission {
  /*
   * Why a write a person may not make on a private record they can see is
   * refused, after "You do not have permission to <type> this <noun>." -
   * the API's words, which Slack and Microsoft Teams repeat.
   */
  public static readonly PRIVATE_WRITE_REASON: string =
    "It is private, so it is changed only with the permissions of the teams that own it and of the people named as its owners, and none of them lets you do this. Ask a project admin to give one of the teams that own it this permission, or to add you as an owner.";

  // The same, for a part of a private record: an incident's note, say.
  public static getPrivateParentWriteReason(parentNoun: string): string {
    return `The ${parentNoun} it belongs to is private, so it is changed only with the permissions of the teams that own that ${parentNoun} and of the people named as its owners, and none of them lets you do this. Ask a project admin to give one of the teams that own it this permission, or to add you as an owner.`;
  }

  // The kind of private record a table holds, if any: "Incident".
  public static getKind(
    tableName: string | null | undefined,
  ): PrivateRecordKind | null {
    if (!tableName) {
      return null;
    }

    return (
      PRIVATE_RECORD_KINDS.find((kind: PrivateRecordKind): boolean => {
        return kind.tableName === tableName;
      }) || null
    );
  }

  // Whether a model's records can be private: Incident, Alert, the episodes.
  public static isPrivateRecordModel(modelType: {
    new (): BaseModel;
  }): boolean {
    return Boolean(PrivateRecordPermission.getKind(new modelType().tableName));
  }

  // Which column of a model's rows names a private record. See the interface.
  private static columnsByModel: Map<
    { new (): BaseModel },
    PrivateRecordColumn | null
  > = new Map();

  public static getPrivateRecordColumn(modelType: {
    new (): BaseModel;
  }): PrivateRecordColumn | null {
    if (PrivateRecordPermission.columnsByModel.has(modelType)) {
      return PrivateRecordPermission.columnsByModel.get(modelType) || null;
    }

    const column: PrivateRecordColumn | null =
      PrivateRecordPermission.readPrivateRecordColumn(modelType);

    PrivateRecordPermission.columnsByModel.set(modelType, column);

    return column;
  }

  private static readPrivateRecordColumn(modelType: {
    new (): BaseModel;
  }): PrivateRecordColumn | null {
    const model: BaseModel = new modelType();
    const ownKind: PrivateRecordKind | null = PrivateRecordPermission.getKind(
      model.tableName,
    );

    if (ownKind) {
      return {
        kind: ownKind,
        recordModelType: modelType,
        column: "_id",
        isRecord: true,
      };
    }

    const relation: string | null = model.canAccessIfCanReadOn;

    if (!relation) {
      return null;
    }

    const metadata: TableColumnMetadata | undefined =
      model.getTableColumnMetadata(relation);

    if (!metadata || !metadata.modelType) {
      return null;
    }

    const parentKind: PrivateRecordKind | null =
      PrivateRecordPermission.getKind(new metadata.modelType().tableName);

    if (!parentKind) {
      return null;
    }

    /*
     * A part of a private record is read through it by a key column
     * (PrivateRecordParts.test holds every one to it). One read through a
     * list of them would have no one record to follow: refused as
     * misconfigured rather than left unchecked.
     */
    if (
      metadata.type !== TableColumnType.Entity ||
      !metadata.manyToOneRelationColumn
    ) {
      throw new Error(
        `${model.singularName} is read through ${relation}, a list of ${parentKind.tableName} records: a write cannot be held to the private ones.`,
      );
    }

    return {
      kind: parentKind,
      recordModelType: metadata.modelType as { new (): BaseModel },
      column: metadata.manyToOneRelationColumn,
      isRecord: false,
    };
  }

  /*
   * What `type` on `modelType` reaches of the private records, for this
   * caller (PrivateRecordReach): read off the allow rows that grant it - the
   * model's own permissions and its operational-resource wildcard, as the
   * table check reads them - each with the team it is given on
   * (UserPermission.teamId). A row no team grants (a global permission, an
   * API key's) reaches only what the caller owns themselves, and an API key
   * owns nothing.
   */
  public static getReach(
    modelType: { new (): BaseModel },
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): PrivateRecordReach {
    const grantingPermissions: Array<Permission> =
      TablePermission.getGrantingPermissions(modelType, type, props);

    const rows: Array<UserPermission> =
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        props,
        PermissionType.Allow,
      ).filter((row: UserPermission): boolean => {
        return grantingPermissions.includes(row.permission);
      });

    return PrivateRecordPermission.getReachOfRows({
      rows: rows,
      userId: props.userId || null,
    });
  }

  /*
   * The reach of the rows that grant one operation (getReach): each team's
   * rows together, a team reaching every record it owns when one of its rows
   * is not limited to labels (PermissionHelper.isLimitedToLabels: an
   * unscoped row, one scoped to Owned, a role that cannot be scoped), and
   * otherwise the records it owns carrying one of its rows' labels.
   */
  public static getReachOfRows(data: {
    rows: ReadonlyArray<UserPermission>;
    userId: ObjectID | null;
  }): PrivateRecordReach {
    const teams: Map<
      string,
      { teamId: ObjectID; isEveryRecord: boolean; labelIds: Array<ObjectID> }
    > = new Map();

    for (const row of data.rows) {
      if (!row.teamId || row.isBlockPermission === true) {
        continue;
      }

      const key: string = row.teamId.toString().toLowerCase();

      let team:
        | {
            teamId: ObjectID;
            isEveryRecord: boolean;
            labelIds: Array<ObjectID>;
          }
        | undefined = teams.get(key);

      if (!team) {
        team = {
          teamId: new ObjectID(row.teamId.toString()),
          isEveryRecord: false,
          labelIds: [],
        };
        teams.set(key, team);
      }

      if (!PermissionHelper.isLimitedToLabels(row)) {
        team.isEveryRecord = true;
        continue;
      }

      for (const labelId of row.labelIds || []) {
        if (
          !team.labelIds.some((held: ObjectID): boolean => {
            return (
              held.toString().toLowerCase() ===
              labelId.toString().toLowerCase()
            );
          })
        ) {
          team.labelIds.push(new ObjectID(labelId.toString()));
        }
      }
    }

    const reach: PrivateRecordReach = {
      userId: data.userId ? new ObjectID(data.userId.toString()) : null,
      teamIds: [],
      labelledTeams: [],
    };

    for (const team of teams.values()) {
      if (team.isEveryRecord) {
        reach.teamIds.push(team.teamId);
      } else if (team.labelIds.length > 0) {
        reach.labelledTeams.push({
          teamId: team.teamId,
          labelIds: team.labelIds,
        });
      }
    }

    return reach;
  }

  /*
   * The private records of `kind` a write with `reach` may touch, as SQL
   * over a row of the kind's table aliased `r`: the ones the caller owns,
   * and the ones one of the reach's teams owns - a labelled team's carrying
   * one of its labels. Null when the reach owns nothing (no person, no
   * team): then no private record is reached. `parameters` collects the
   * values the SQL names.
   */
  private static getOwnedSql(data: {
    kind: PrivateRecordKind;
    reach: PrivateRecordReach;
    parameters: Dictionary<string | Array<string>>;
  }): string | null {
    const kind: PrivateRecordKind = data.kind;

    const parameter: (prefix: string, value: string | Array<string>) => string =
      (prefix: string, value: string | Array<string>): string => {
        const name: string = `${prefix}_${Text.generateRandomText(10)}`;
        data.parameters[name] = value;
        return name;
      };

    const owned: Array<string> = [];

    if (data.reach.userId) {
      const user: string = parameter(
        "privOwnerUser",
        data.reach.userId.toString(),
      );

      owned.push(
        `r."_id" IN (SELECT pou."${kind.ownerKey}" FROM "${kind.ownerUserTable}" pou WHERE pou."userId" = :${user} AND pou."deletedAt" IS NULL)`,
      );
    }

    if (data.reach.teamIds.length > 0) {
      const teams: string = parameter(
        "privOwnerTeams",
        data.reach.teamIds.map((teamId: ObjectID): string => {
          return teamId.toString();
        }),
      );

      owned.push(
        `r."_id" IN (SELECT pot."${kind.ownerKey}" FROM "${kind.ownerTeamTable}" pot WHERE pot."teamId" IN (:...${teams}) AND pot."deletedAt" IS NULL)`,
      );
    }

    for (const labelled of data.reach.labelledTeams) {
      const team: string = parameter(
        "privLabelTeam",
        labelled.teamId.toString(),
      );
      const labels: string = parameter(
        "privLabels",
        labelled.labelIds.map((labelId: ObjectID): string => {
          return labelId.toString();
        }),
      );

      owned.push(
        `(r."_id" IN (SELECT plt."${kind.ownerKey}" FROM "${kind.ownerTeamTable}" plt WHERE plt."teamId" = :${team} AND plt."deletedAt" IS NULL) AND r."_id" IN (SELECT pl."${kind.labelRecordKey}" FROM "${kind.labelTable}" pl WHERE pl."${kind.labelKey}" IN (:...${labels})))`,
      );
    }

    return owned.length > 0 ? owned.join(" OR ") : null;
  }

  /*
   * The records of `kind` a write with `reach` may touch, as a condition on
   * a column naming them (a record's own id, or the key of a part of one):
   * every record that is not private, and the private ones it owns
   * (getOwnedSql). A part whose key names no record belongs to no private
   * record, and is let through (`allowsNoRecord`).
   */
  public static getReachableCondition(data: {
    kind: PrivateRecordKind;
    reach: PrivateRecordReach;
    allowsNoRecord: boolean;
  }): FindWhereProperty<any> {
    const parameters: Dictionary<string | Array<string>> = {};
    const owned: string | null = PrivateRecordPermission.getOwnedSql({
      kind: data.kind,
      reach: data.reach,
      parameters: parameters,
    });

    const reachable: string = [
      `r."isPrivate" IS NULL`,
      `r."isPrivate" = FALSE`,
      ...(owned ? [owned] : []),
    ].join(" OR ");

    const records: string = `SELECT r."_id" FROM "${data.kind.tableName}" r WHERE r."deletedAt" IS NULL AND (${reachable})`;

    return Raw((alias: string): string => {
      return data.allowsNoRecord
        ? `(${alias} IS NULL OR ${alias} IN (${records}))`
        : `(${alias} IN (${records}))`;
    }, parameters);
  }

  /*
   * The opposite, for a record's id: the private records of `kind` a write
   * with `reach` may NOT touch - private, and owned by neither the caller
   * nor one of the reach's teams. What a create under a parent, and a route
   * that writes as OneUptime, ask of the records they name.
   */
  public static getUnreachableCondition(data: {
    kind: PrivateRecordKind;
    reach: PrivateRecordReach;
  }): FindWhereProperty<any> {
    const parameters: Dictionary<string | Array<string>> = {};
    const owned: string | null = PrivateRecordPermission.getOwnedSql({
      kind: data.kind,
      reach: data.reach,
      parameters: parameters,
    });

    const records: string = `SELECT r."_id" FROM "${data.kind.tableName}" r WHERE r."deletedAt" IS NULL AND r."isPrivate" = TRUE${
      owned ? ` AND NOT (${owned})` : ""
    }`;

    return Raw((alias: string): string => {
      return `(${alias} IN (${records}))`;
    }, parameters);
  }

  /*
   * Whether the private record rule narrows `type` on `modelType` for this
   * caller: an update or a delete (a create is held under its parent, by
   * getUnreachableParentIds) of a private record or a part of one, by
   * anybody but OneUptime itself, a server admin and those who act on every
   * private record of the project.
   */
  public static narrows(
    modelType: { new (): BaseModel },
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): boolean {
    if (
      props.isRoot ||
      props.isMasterAdmin ||
      (type !== DatabaseRequestType.Update &&
        type !== DatabaseRequestType.Delete)
    ) {
      return false;
    }

    if (!PrivateRecordPermission.getPrivateRecordColumn(modelType)) {
      return false;
    }

    return !shouldBypassRecordPrivacy(props);
  }

  /*
   * The record rule's private record step (BasePermission
   * .addRecordScopeToQuery): an update or a delete reaches the private
   * records - and the parts of them - the caller's permission for it
   * reaches (getReach), and every record that is not private. The caller's
   * own filter on the column stays as sent.
   */
  public static addPrivateRecordScopeToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): Query<TBaseModel> {
    if (!PrivateRecordPermission.narrows(modelType, props, type)) {
      return query;
    }

    const column: PrivateRecordColumn =
      PrivateRecordPermission.getPrivateRecordColumn(modelType)!;

    const condition: FindWhereProperty<any> =
      PrivateRecordPermission.getReachableCondition({
        kind: column.kind,
        reach: PrivateRecordPermission.getReach(modelType, props, type),
        allowsNoRecord: !column.isRecord,
      });

    (query as Record<string, unknown>)[column.column] =
      combineWithPrivacyClause(
        (query as Record<string, unknown>)[column.column],
        condition,
      );

    return query;
  }

  /*
   * Of `parentIds` - records of `parentModelType` that a create (or a move)
   * puts a part of `modelType` under - the private ones the caller's
   * permission for `type` on the part does not reach: owned by neither the
   * caller nor a team granting it (getReach). A record that does not exist,
   * or is not private, is not among them: the parent's read rule and the
   * reference checks answer for those. `findIdsInProject` reads, as
   * OneUptime, the ids a query finds in the record's project. None for a
   * caller the rule does not narrow, or a parent of a kind that cannot be
   * private.
   */
  public static async getUnreachableParentIds(data: {
    modelType: { new (): BaseModel };
    parentModelType: { new (): BaseModel };
    parentIds: Array<string>;
    props: DatabaseCommonInteractionProps;
    type: DatabaseRequestType.Create | DatabaseRequestType.Update;
    findIdsInProject: (data: {
      modelType: { new (): BaseModel };
      ids: Array<string>;
      query: Query<BaseModel>;
      props: DatabaseCommonInteractionProps;
    }) => Promise<Array<string>>;
  }): Promise<Array<string>> {
    const ids: Array<string> = data.parentIds.filter((id: string): boolean => {
      return ObjectID.isValidUUID(id);
    });

    if (
      ids.length === 0 ||
      data.props.isRoot ||
      data.props.isMasterAdmin ||
      shouldBypassRecordPrivacy(data.props)
    ) {
      return [];
    }

    const query: Query<BaseModel> | null =
      PrivateRecordPermission.getUnreachableRecordsQuery({
        modelType: data.modelType,
        recordModelType: data.parentModelType,
        recordIds: ids,
        props: data.props,
        type: data.type,
      });

    if (!query) {
      return [];
    }

    return await data.findIdsInProject({
      modelType: data.parentModelType,
      ids: ids,
      query: query,
      props: data.props,
    });
  }

  /*
   * The query, over `recordModelType` (a kind that can be private), that
   * finds which of `recordIds` the caller's permission for `type` on
   * `modelType` - the record itself, or a part of it - does not reach
   * (getUnreachableCondition). Read as OneUptime, for the checks of a write
   * named by its record: a create under a parent, a route that writes as
   * OneUptime once its caller has been checked. Null when there is nothing
   * to find: a kind that cannot be private, or a caller who acts on every
   * private record (shouldBypassRecordPrivacy) - who is the caller's own
   * concern to tell apart from OneUptime.
   */
  public static getUnreachableRecordsQuery(data: {
    modelType: { new (): BaseModel };
    recordModelType: { new (): BaseModel };
    recordIds: Array<string>;
    props: DatabaseCommonInteractionProps;
    type: DatabaseRequestType;
  }): Query<BaseModel> | null {
    const kind: PrivateRecordKind | null = PrivateRecordPermission.getKind(
      new data.recordModelType().tableName,
    );

    if (!kind || data.recordIds.length === 0) {
      return null;
    }

    if (
      data.props.isRoot ||
      data.props.isMasterAdmin ||
      shouldBypassRecordPrivacy(data.props)
    ) {
      return null;
    }

    return {
      _id: combineWithPrivacyClause(
        QueryHelper.any(data.recordIds) as unknown as FindOperator<unknown>,
        PrivateRecordPermission.getUnreachableCondition({
          kind: kind,
          reach: PrivateRecordPermission.getReach(
            data.modelType,
            data.props,
            data.type,
          ),
        }),
      ),
    } as Query<BaseModel>;
  }
}
