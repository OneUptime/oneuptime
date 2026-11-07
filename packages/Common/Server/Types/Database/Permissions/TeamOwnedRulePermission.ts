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
import ObjectID from "../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../Types/Permission";
import Text from "../../../../Types/Text";
import TeamOwnedRuleKinds, {
  ACTING_ON_EVERY_TEAM_OWNED_RULE,
  TeamOwnedRuleKind,
} from "../../../../Types/TeamOwnedRule/TeamOwnedRuleKinds";
import CallerPermission from "../../../Utils/Permission/CallerPermission";
import { combineWithPrivacyClause } from "../../../Utils/PrivacyFilterUtil";
import { FindOperator, Raw } from "typeorm";

/*
 * A rule of a kind teams can own, as a model's rows name it: the rule itself
 * (`_id` of an incident on-call rule) or the rule its owning-team rows
 * belong to (`incidentOnCallRuleId`).
 */
export interface TeamOwnedRuleColumn {
  kind: TeamOwnedRuleKind;
  column: string;
  // Whether the rows are the rules themselves.
  isRule: boolean;
}

/*
 * A RULE SOME TEAMS OWN IS CHANGED ONLY THROUGH THOSE TEAMS.
 *
 * An oversight team and the teams that run the services each keep incident
 * rules no other team may change: the oversight team's on-call rule that
 * pages it for every critical incident, the platform team's owner rule. A
 * rule of a kind teams can own (TEAM_OWNED_RULE_KINDS) is either:
 *
 *   - the project's, when no team owns it: changed and deleted by everyone
 *     whose permissions let them change rules of its kind, as every rule
 *     was; or
 *   - its owning teams', when one or more do: changed and deleted only with
 *     the permissions of the teams that own it. A member of an owning team
 *     acts on it with that team's permissions, never with another team's:
 *     a member of the oversight team and of a team that may change every
 *     rule changes the oversight team's rules only as far as the oversight
 *     team may. The project's owners and admins change every rule.
 *
 * Reads are not narrowed: everyone who may read rules of a kind reads every
 * one of them, and who owns it.
 *
 * Adding or removing an owning team is changing the rule (the owning-team
 * rows are its parts, @CanAccessIfCanReadOn the rule): on a rule some teams
 * own, only with the permissions of those teams to add or remove owning
 * teams, or by the project's owners and admins. A rule no team owns takes
 * its first owning team from whoever may add one - who could as well change
 * or delete it.
 *
 * A permission no team grants (an API key's, or the defaults every member
 * holds) reaches no rule a team owns: an API key changes one only as a
 * Project Owner or Project Admin.
 *
 * It holds for every write of a rule and of its owning teams:
 *
 *   - an update and a delete, in the record rule
 *     (BasePermission.addRecordScopeToQuery: addTeamOwnedRuleScopeToQuery);
 *   - an owning team added to a rule (CreatePermission.checkParentIds:
 *     getUnreachableParentIds);
 *   - the refusal of a write by id that reached nothing, which says why
 *     (DatabaseService.getUnwrittenByIdError).
 *
 * The Owned permission scope is another thing: a grant scoped to Owned
 * reaches the records its team owns (OwnerTableRegistry), and narrows
 * nothing of these rules, which are not in that registry.
 */
export default class TeamOwnedRulePermission {
  /*
   * Why a write of a rule some teams own is refused, after "You do not have
   * permission to <type> this <noun>." - the API's words.
   */
  public static readonly TEAM_OWNED_WRITE_REASON: string =
    "Teams own it, so it is changed only with the permissions of the teams that own it, and none of them lets you do this. Ask a member of a team that owns it, or a project admin.";

  // The same, for an owning team of such a rule.
  public static getOwnedParentWriteReason(ruleNoun: string): string {
    return `Teams own the ${ruleNoun} it belongs to, so its owning teams are changed only with the permissions of the teams that own that ${ruleNoun}, and none of them lets you do this. Ask a member of a team that owns it, or a project admin.`;
  }

  /*
   * The column of a model's rows that names a rule teams can own: `_id` of
   * the rule kinds, the rule's key on their owning-team tables. Null for
   * any other model.
   */
  public static getRuleColumn(modelType: {
    new (): BaseModel;
  }): TeamOwnedRuleColumn | null {
    // Asked of every update and delete: read off the model once.
    if (TeamOwnedRulePermission.columnsByModel.has(modelType)) {
      return TeamOwnedRulePermission.columnsByModel.get(modelType) || null;
    }

    const column: TeamOwnedRuleColumn | null =
      TeamOwnedRulePermission.readRuleColumn(modelType);

    TeamOwnedRulePermission.columnsByModel.set(modelType, column);

    return column;
  }

  private static columnsByModel: Map<
    { new (): BaseModel },
    TeamOwnedRuleColumn | null
  > = new Map();

  private static readRuleColumn(modelType: {
    new (): BaseModel;
  }): TeamOwnedRuleColumn | null {
    const tableName: string | null = new modelType().tableName;

    const ruleKind: TeamOwnedRuleKind | null =
      TeamOwnedRuleKinds.getKindOfRule(tableName);

    if (ruleKind) {
      return { kind: ruleKind, column: "_id", isRule: true };
    }

    const owningKind: TeamOwnedRuleKind | null =
      TeamOwnedRuleKinds.getKindOfOwningTeams(tableName);

    if (owningKind) {
      return { kind: owningKind, column: owningKind.ruleKey, isRule: false };
    }

    return null;
  }

  /*
   * Whether the caller changes every rule of the project, whichever teams
   * own it: OneUptime itself, a server admin, and a Project Owner or
   * Project Admin over the whole project (CallerPermission, with blocks).
   */
  public static actsOnEveryTeamOwnedRule(
    props: DatabaseCommonInteractionProps,
  ): boolean {
    if (props.isRoot || props.isMasterAdmin) {
      return true;
    }

    if (!props.tenantId || props.isMultiTenantRequest) {
      return false;
    }

    return CallerPermission.holdsAnyOf(props, ACTING_ON_EVERY_TEAM_OWNED_RULE, {
      projectWideOnly: true,
    });
  }

  /*
   * The teams whose permission for `type` on `modelType` reaches the rules
   * they own: the teams of the caller's allow rows that grant it - the
   * model's own permissions and its operational-resource wildcard, as the
   * table check reads them (UserPermission.teamId). A row no team grants
   * reaches no rule a team owns. Each team once.
   */
  public static getReachingTeamIds(
    modelType: { new (): BaseModel },
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): Array<ObjectID> {
    const grantingPermissions: Array<Permission> =
      TablePermission.getGrantingPermissions(modelType, type, props);

    const teamIds: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const row of DatabaseCommonInteractionPropsUtil.getUserPermissions(
      props,
      PermissionType.Allow,
    )) {
      if (
        !row ||
        row.isBlockPermission === true ||
        !row.teamId ||
        !grantingPermissions.includes((row as UserPermission).permission)
      ) {
        continue;
      }

      const key: string = row.teamId.toString().toLowerCase();

      if (!teamIds.has(key)) {
        teamIds.set(key, new ObjectID(row.teamId.toString()));
      }
    }

    return Array.from(teamIds.values());
  }

  /*
   * Whether the rule narrows `type` on `modelType` for this caller: an
   * update or a delete (an owning team added is held under its rule, by
   * getUnreachableParentIds) of a rule of a kind teams can own, or of its
   * owning teams, by anybody but those who change every rule.
   */
  public static narrows(
    modelType: { new (): BaseModel },
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): boolean {
    if (
      type !== DatabaseRequestType.Update &&
      type !== DatabaseRequestType.Delete
    ) {
      return false;
    }

    if (!TeamOwnedRulePermission.getRuleColumn(modelType)) {
      return false;
    }

    return !TeamOwnedRulePermission.actsOnEveryTeamOwnedRule(props);
  }

  /*
   * The SQL, over a rule of `kind` aliased `r`, of the owning-team rows of
   * the rule - of any team, or of one of `teamIds`. `parameters` collects
   * the values it names.
   */
  private static getOwningTeamsSql(data: {
    kind: TeamOwnedRuleKind;
    alias: string;
    teamIds?: Array<ObjectID> | undefined;
    parameters: Dictionary<string | Array<string>>;
  }): string {
    let ofTeams: string = "";

    if (data.teamIds) {
      const name: string = `ruleOwningTeams_${Text.generateRandomText(10)}`;

      data.parameters[name] = data.teamIds.map((teamId: ObjectID): string => {
        return teamId.toString();
      });

      ofTeams = ` AND ${data.alias}."teamId" IN (:...${name})`;
    }

    return `SELECT 1 FROM "${data.kind.owningTeamTable}" ${data.alias} WHERE ${data.alias}."${data.kind.ruleKey}" = r."_id" AND ${data.alias}."deletedAt" IS NULL${ofTeams}`;
  }

  /*
   * The rules of `kind` a write whose permission `teamIds` grant may touch,
   * as a condition on a column naming them (a rule's own id, or the key of
   * its owning-team rows): every rule no team owns, and the ones one of the
   * teams owns.
   */
  public static getReachableCondition(data: {
    kind: TeamOwnedRuleKind;
    teamIds: Array<ObjectID>;
  }): FindWhereProperty<any> {
    const parameters: Dictionary<string | Array<string>> = {};

    const reachable: Array<string> = [
      `NOT EXISTS (${TeamOwnedRulePermission.getOwningTeamsSql({
        kind: data.kind,
        alias: "rot",
        parameters: parameters,
      })})`,
    ];

    if (data.teamIds.length > 0) {
      reachable.push(
        `EXISTS (${TeamOwnedRulePermission.getOwningTeamsSql({
          kind: data.kind,
          alias: "rto",
          teamIds: data.teamIds,
          parameters: parameters,
        })})`,
      );
    }

    const rules: string = `SELECT r."_id" FROM "${data.kind.tableName}" r WHERE r."deletedAt" IS NULL AND (${reachable.join(" OR ")})`;

    return Raw((alias: string): string => {
      return `(${alias} IN (${rules}))`;
    }, parameters);
  }

  /*
   * The opposite, for a rule's id: the rules of `kind` a write whose
   * permission `teamIds` grant may NOT touch - owned by teams, none of them
   * one of these. What a create of an owning team under a rule, and the
   * refusal of a write that reached nothing, ask of the rules they name.
   */
  public static getUnreachableCondition(data: {
    kind: TeamOwnedRuleKind;
    teamIds: Array<ObjectID>;
  }): FindWhereProperty<any> {
    const parameters: Dictionary<string | Array<string>> = {};

    const conditions: Array<string> = [
      `EXISTS (${TeamOwnedRulePermission.getOwningTeamsSql({
        kind: data.kind,
        alias: "uot",
        parameters: parameters,
      })})`,
    ];

    if (data.teamIds.length > 0) {
      conditions.push(
        `NOT EXISTS (${TeamOwnedRulePermission.getOwningTeamsSql({
          kind: data.kind,
          alias: "uto",
          teamIds: data.teamIds,
          parameters: parameters,
        })})`,
      );
    }

    const rules: string = `SELECT r."_id" FROM "${data.kind.tableName}" r WHERE r."deletedAt" IS NULL AND ${conditions.join(" AND ")}`;

    return Raw((alias: string): string => {
      return `(${alias} IN (${rules}))`;
    }, parameters);
  }

  /*
   * The record rule's team-owned rule step (BasePermission
   * .addRecordScopeToQuery): an update or a delete of a rule, or of its
   * owning teams, reaches every rule no team owns and the ones a team
   * granting the write owns (getReachingTeamIds). The caller's own filter on
   * the column stays as sent.
   */
  public static addTeamOwnedRuleScopeToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): Query<TBaseModel> {
    if (!TeamOwnedRulePermission.narrows(modelType, props, type)) {
      return query;
    }

    const column: TeamOwnedRuleColumn =
      TeamOwnedRulePermission.getRuleColumn(modelType)!;

    (query as Record<string, unknown>)[column.column] =
      combineWithPrivacyClause(
        (query as Record<string, unknown>)[column.column],
        TeamOwnedRulePermission.getReachableCondition({
          kind: column.kind,
          teamIds: TeamOwnedRulePermission.getReachingTeamIds(
            modelType,
            props,
            type,
          ),
        }),
      );

    return query;
  }

  /*
   * The query, over the rules of `ruleModelType`, that finds which of
   * `ruleIds` the caller's permission for `type` on `modelType` - the rule
   * itself, or its owning teams - does not reach (getUnreachableCondition).
   * Read as OneUptime, for the checks of a write named by its rule: an
   * owning team added, the refusal of a write that reached nothing. Null
   * when there is nothing to find: a model of no rule kind, or a caller who
   * changes every rule.
   */
  public static getUnreachableRulesQuery(data: {
    modelType: { new (): BaseModel };
    ruleModelType: { new (): BaseModel };
    ruleIds: Array<string>;
    props: DatabaseCommonInteractionProps;
    type: DatabaseRequestType;
  }): Query<BaseModel> | null {
    const kind: TeamOwnedRuleKind | null = TeamOwnedRuleKinds.getKindOfRule(
      new data.ruleModelType().tableName,
    );

    const ruleIds: Array<string> = data.ruleIds.filter(
      (id: string): boolean => {
        return ObjectID.isValidUUID(id);
      },
    );

    if (
      !kind ||
      ruleIds.length === 0 ||
      TeamOwnedRulePermission.actsOnEveryTeamOwnedRule(data.props)
    ) {
      return null;
    }

    return {
      _id: combineWithPrivacyClause(
        QueryHelper.any(ruleIds) as unknown as FindOperator<unknown>,
        TeamOwnedRulePermission.getUnreachableCondition({
          kind: kind,
          teamIds: TeamOwnedRulePermission.getReachingTeamIds(
            data.modelType,
            data.props,
            data.type,
          ),
        }),
      ),
    } as Query<BaseModel>;
  }

  /*
   * Of `parentIds` - rules of `parentModelType` that a create puts an
   * owning team of `modelType` under - the ones some teams own and the
   * caller's permission for `type` on the owning teams does not reach.
   * A rule that does not exist, or that no team owns, is not among them: the
   * parent's read rule and the reference checks answer for those.
   * `findIdsInProject` reads, as OneUptime, the ids a query finds in the
   * record's project. None for a caller who changes every rule, or a parent
   * of no rule kind.
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
    const query: Query<BaseModel> | null =
      TeamOwnedRulePermission.getUnreachableRulesQuery({
        modelType: data.modelType,
        ruleModelType: data.parentModelType,
        ruleIds: data.parentIds,
        props: data.props,
        type: data.type,
      });

    if (!query) {
      return [];
    }

    return await data.findIdsInProject({
      modelType: data.parentModelType,
      ids: data.parentIds.filter((id: string): boolean => {
        return ObjectID.isValidUUID(id);
      }),
      query: query,
      props: data.props,
    });
  }
}
