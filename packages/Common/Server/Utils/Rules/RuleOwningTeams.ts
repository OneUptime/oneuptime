import DatabaseRequestType from "../../Types/BaseDatabase/DatabaseRequestType";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import TablePermission from "../../Types/Database/Permissions/TablePermission";
import TeamOwnedRulePermission from "../../Types/Database/Permissions/TeamOwnedRulePermission";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import TeamOwnedRuleKinds, {
  TeamOwnedRuleKind,
} from "../../../Types/TeamOwnedRule/TeamOwnedRuleKinds";
import type DatabaseService from "../../Services/DatabaseService";

/*
 * The key a rule form sends a rule's owning teams under, in the write's misc
 * data: the ids of every team that is to own the rule once it is saved. Sent
 * with an empty list, the rule is to be the project's again; not sent at
 * all, its owning teams stay as they are.
 */
export const OWNING_TEAMS_MISC_DATA_KEY: string = "owningTeams";

// The rules a write names, as OneUptime finds them in the caller's project.
export type RuleIdsFinder = (data: {
  modelType: { new (): BaseModel };
  ids: Array<string>;
  query: Query<BaseModel>;
}) => Promise<Array<string>>;

interface OwningTeamsChange {
  added: Array<ObjectID>;
  removed: Array<ObjectID>;
}

/*
 * A RULE'S OWNING TEAMS, PICKED ON ITS FORM.
 *
 * Most rule lists have no page of their own for a rule, so who owns one is
 * chosen on the rule's own form - on Create and on Edit - and sent with the
 * rule (OWNING_TEAMS_MISC_DATA_KEY). The rows are written as the person
 * saving the rule, through the owning-team service, so every check that
 * holds the owning-team API holds them: the table's permissions, the team
 * being the project's, and only the teams that own a rule changing who owns
 * it (TeamOwnedRulePermission).
 *
 * Asked before the rule is saved, so a pick the person may not make saves
 * nothing (checkBeforeCreate, checkBeforeUpdate), and written once it is
 * (addAfterCreate, syncAfterUpdate): a team that owns a rule may hand it to
 * another team in one save - the rule is changed while the team still owns
 * it, then its owning teams are.
 */
export default class RuleOwningTeams {
  // The kind of rule `modelType` is, when teams can own it.
  public static getKind(modelType: {
    new (): BaseModel;
  }): TeamOwnedRuleKind | null {
    return TeamOwnedRuleKinds.getKindOfRule(new modelType().tableName);
  }

  /*
   * The owning teams a write sent: null when it sent none - the rule's
   * owning teams stay as they are - and otherwise each team once. An id
   * that is not one is refused.
   */
  public static getPickedTeamIds(
    miscDataProps: JSONObject | undefined | null,
  ): Array<ObjectID> | null {
    if (
      !miscDataProps ||
      !Object.prototype.hasOwnProperty.call(
        miscDataProps,
        OWNING_TEAMS_MISC_DATA_KEY,
      )
    ) {
      return null;
    }

    const value: unknown = miscDataProps[OWNING_TEAMS_MISC_DATA_KEY];

    if (value === null || value === undefined) {
      return null;
    }

    const values: Array<unknown> = Array.isArray(value) ? value : [value];
    const teamIds: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const item of values) {
      const id: string | null = RuleOwningTeams.readId(item);

      if (!id || !ObjectID.isValidUUID(id)) {
        throw new BadDataException(
          "Owning teams must be a list of team IDs.",
        );
      }

      teamIds.set(id.toLowerCase(), new ObjectID(id));
    }

    return Array.from(teamIds.values());
  }

  // A team's id as a form sends it: the id, an ObjectID, or { _id }.
  private static readId(value: unknown): string | null {
    if (!value) {
      return null;
    }

    if (typeof value === "string") {
      return value.trim();
    }

    if (value instanceof ObjectID) {
      return value.toString();
    }

    if (typeof value === "object") {
      const record: Record<string, unknown> = value as Record<string, unknown>;

      for (const key of ["_id", "id", "value"]) {
        if (typeof record[key] === "string") {
          return (record[key] as string).trim();
        }

        if (record[key] instanceof ObjectID) {
          return (record[key] as ObjectID).toString();
        }
      }
    }

    return null;
  }

  // The service of a kind's owning teams (TeamOwnedRuleServices, loaded late).
  public static getOwningTeamService(
    kind: TeamOwnedRuleKind,
  ): DatabaseService<BaseModel> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const services: Record<string, DatabaseService<BaseModel>> = require(
      "./TeamOwnedRuleServices",
    ).default;

    const service: DatabaseService<BaseModel> | undefined =
      services[kind.owningTeamTable];

    if (!service) {
      throw new BadDataException(
        `${kind.tableName} has no service for its owning teams.`,
      );
    }

    return service;
  }

  /*
   * Before a rule is created with owning teams: whether the person may add
   * owning teams to a rule of its kind at all. Refused before the rule is
   * saved, in the words of the owning-team table's own permission check.
   */
  public static checkBeforeCreate(data: {
    modelType: { new (): BaseModel };
    miscDataProps: JSONObject | undefined;
    props: DatabaseCommonInteractionProps;
  }): void {
    const kind: TeamOwnedRuleKind | null = RuleOwningTeams.getKind(
      data.modelType,
    );
    const picked: Array<ObjectID> | null = kind
      ? RuleOwningTeams.getPickedTeamIds(data.miscDataProps)
      : null;

    if (!kind || !picked || picked.length === 0) {
      return;
    }

    TablePermission.checkTableLevelPermissions(
      RuleOwningTeams.getOwningTeamService(kind).modelType,
      data.props,
      DatabaseRequestType.Create,
    );
  }

  // Once the rule exists: its owning teams, added as the person creating it.
  public static async addAfterCreate(data: {
    modelType: { new (): BaseModel };
    ruleId: ObjectID;
    projectId: ObjectID | undefined;
    miscDataProps: JSONObject | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const kind: TeamOwnedRuleKind | null = RuleOwningTeams.getKind(
      data.modelType,
    );
    const picked: Array<ObjectID> | null = kind
      ? RuleOwningTeams.getPickedTeamIds(data.miscDataProps)
      : null;

    if (!kind || !picked || picked.length === 0) {
      return;
    }

    await RuleOwningTeams.addTeams({
      kind: kind,
      ruleId: data.ruleId,
      projectId: data.projectId,
      teamIds: picked,
      props: data.props,
    });
  }

  /*
   * Before a rule is changed with owning teams: whether the person may make
   * each change to them - add the teams that are new, remove the ones left
   * out - by the owning-team table's permissions and, on a rule teams own,
   * through the teams that own it. Nothing is asked when the list is the
   * rule's own, nor of a person whose change of the rule itself is refused
   * anyway (it then says why).
   */
  public static async checkBeforeUpdate(data: {
    modelType: { new (): BaseModel };
    ruleId: ObjectID;
    miscDataProps: JSONObject | undefined;
    props: DatabaseCommonInteractionProps;
    findIdsInProject: RuleIdsFinder;
  }): Promise<void> {
    const kind: TeamOwnedRuleKind | null = RuleOwningTeams.getKind(
      data.modelType,
    );
    const picked: Array<ObjectID> | null = kind
      ? RuleOwningTeams.getPickedTeamIds(data.miscDataProps)
      : null;

    if (!kind || !picked) {
      return;
    }

    const change: OwningTeamsChange = await RuleOwningTeams.getChange({
      kind: kind,
      ruleId: data.ruleId,
      picked: picked,
    });

    if (change.added.length === 0 && change.removed.length === 0) {
      return;
    }

    // A change of the rule they may not make is refused as that, later.
    if (
      await RuleOwningTeams.isUnreachable({
        modelType: data.modelType,
        ruleModelType: data.modelType,
        ruleId: data.ruleId,
        props: data.props,
        type: DatabaseRequestType.Update,
        findIdsInProject: data.findIdsInProject,
      })
    ) {
      return;
    }

    const owningTeamModelType: { new (): BaseModel } =
      RuleOwningTeams.getOwningTeamService(kind).modelType;

    for (const [type, teamIds] of [
      [DatabaseRequestType.Create, change.added],
      [DatabaseRequestType.Delete, change.removed],
    ] as Array<[DatabaseRequestType, Array<ObjectID>]>) {
      if (teamIds.length === 0) {
        continue;
      }

      TablePermission.checkTableLevelPermissions(
        owningTeamModelType,
        data.props,
        type,
      );

      if (
        await RuleOwningTeams.isUnreachable({
          modelType: owningTeamModelType,
          ruleModelType: data.modelType,
          ruleId: data.ruleId,
          props: data.props,
          type: type,
          findIdsInProject: data.findIdsInProject,
        })
      ) {
        throw new NotAuthorizedException(
          `You do not have permission to ${type} ${
            new owningTeamModelType().singularName || "owning teams"
          }. ${TeamOwnedRulePermission.getOwnedParentWriteReason(
            (new data.modelType().singularName || "rule").toLowerCase(),
          )}`,
        );
      }
    }
  }

  /*
   * Once the rule is changed: its owning teams made the list sent - the new
   * ones added first, then the ones left out removed - as the person saving
   * it, so a team handing its rule to another team still owns it while it
   * does.
   */
  public static async syncAfterUpdate(data: {
    modelType: { new (): BaseModel };
    ruleId: ObjectID;
    projectId: ObjectID | undefined;
    miscDataProps: JSONObject | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const kind: TeamOwnedRuleKind | null = RuleOwningTeams.getKind(
      data.modelType,
    );
    const picked: Array<ObjectID> | null = kind
      ? RuleOwningTeams.getPickedTeamIds(data.miscDataProps)
      : null;

    if (!kind || !picked) {
      return;
    }

    const change: OwningTeamsChange = await RuleOwningTeams.getChange({
      kind: kind,
      ruleId: data.ruleId,
      picked: picked,
    });

    await RuleOwningTeams.addTeams({
      kind: kind,
      ruleId: data.ruleId,
      projectId: data.projectId,
      teamIds: change.added,
      props: data.props,
    });

    if (change.removed.length > 0) {
      await RuleOwningTeams.getOwningTeamService(kind).deleteBy({
        query: {
          [kind.ruleKey]: data.ruleId,
          teamId: QueryHelper.any(change.removed),
        } as Query<BaseModel>,
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: data.props,
      });
    }
  }

  // The teams that own a rule now, read as OneUptime.
  public static async getOwningTeamIds(data: {
    kind: TeamOwnedRuleKind;
    ruleId: ObjectID;
  }): Promise<Array<ObjectID>> {
    const rows: Array<BaseModel> = await RuleOwningTeams.getOwningTeamService(
      data.kind,
    ).findBy({
      query: { [data.kind.ruleKey]: data.ruleId } as Query<BaseModel>,
      select: { teamId: true } as Select<BaseModel>,
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    });

    return rows
      .map((row: BaseModel): ObjectID | undefined => {
        return row.getValue("teamId") as ObjectID | undefined;
      })
      .filter((teamId: ObjectID | undefined): teamId is ObjectID => {
        return Boolean(teamId);
      });
  }

  // What saving `picked` changes of a rule's owning teams.
  private static async getChange(data: {
    kind: TeamOwnedRuleKind;
    ruleId: ObjectID;
    picked: Array<ObjectID>;
  }): Promise<OwningTeamsChange> {
    const current: Array<ObjectID> = await RuleOwningTeams.getOwningTeamIds({
      kind: data.kind,
      ruleId: data.ruleId,
    });

    const keyOf: (id: ObjectID) => string = (id: ObjectID): string => {
      return id.toString().toLowerCase();
    };

    const currentKeys: Set<string> = new Set<string>(current.map(keyOf));
    const pickedKeys: Set<string> = new Set<string>(data.picked.map(keyOf));

    return {
      added: data.picked.filter((teamId: ObjectID): boolean => {
        return !currentKeys.has(keyOf(teamId));
      }),
      removed: current.filter((teamId: ObjectID): boolean => {
        return !pickedKeys.has(keyOf(teamId));
      }),
    };
  }

  private static async addTeams(data: {
    kind: TeamOwnedRuleKind;
    ruleId: ObjectID;
    projectId: ObjectID | undefined;
    teamIds: Array<ObjectID>;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const service: DatabaseService<BaseModel> =
      RuleOwningTeams.getOwningTeamService(data.kind);

    const projectId: ObjectID | undefined =
      data.props.tenantId || data.projectId;

    for (const teamId of data.teamIds) {
      const row: BaseModel = new service.modelType();
      row.setValue("teamId", teamId);
      row.setValue(data.kind.ruleKey, data.ruleId);

      if (projectId) {
        row.setValue("projectId", projectId);
      }

      await service.create({ data: row, props: data.props });
    }
  }

  // Whether a write of `type` on `modelType` does not reach the rule.
  private static async isUnreachable(data: {
    modelType: { new (): BaseModel };
    ruleModelType: { new (): BaseModel };
    ruleId: ObjectID;
    props: DatabaseCommonInteractionProps;
    type: DatabaseRequestType;
    findIdsInProject: RuleIdsFinder;
  }): Promise<boolean> {
    const query: Query<BaseModel> | null =
      TeamOwnedRulePermission.getUnreachableRulesQuery({
        modelType: data.modelType,
        ruleModelType: data.ruleModelType,
        ruleIds: [data.ruleId.toString()],
        props: data.props,
        type: data.type,
      });

    if (!query) {
      return false;
    }

    const unreachable: Array<string> = await data.findIdsInProject({
      modelType: data.ruleModelType,
      ids: [data.ruleId.toString()],
      query: query,
    });

    return unreachable.length > 0;
  }
}
