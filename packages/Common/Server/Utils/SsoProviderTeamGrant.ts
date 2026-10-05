import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Team from "../../Models/DatabaseModels/Team";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import TableColumnType from "../../Types/Database/TableColumnType";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../Types/ObjectID";
import DatabaseService from "../Services/DatabaseService";
import TeamPermissionService from "../Services/TeamPermissionService";
import TeamService from "../Services/TeamService";
import ModelPermission from "../Types/Database/Permissions/Index";
import Query from "../Types/Database/Query";
import QueryHelper from "../Types/Database/QueryHelper";
import Select from "../Types/Database/Select";
import UpdateBy from "../Types/Database/UpdateBy";
import RelationValueUtil from "./Database/RelationValueUtil";
import CaptureSpan from "./Telemetry/CaptureSpan";

/*
 * TEAMS ON AN SSO OR SCIM PROVIDER ARE TEAMS THE PERSON SAVING IT COULD
 * GRANT.
 *
 * Someone who signs in with a project's SAML or OIDC provider for the first
 * time joins the provider's teams, and a SCIM connection adds the people it
 * provisions to its default teams - and through its Groups endpoints it can
 * change the members of any team in the project. Joining a team hands a
 * person every permission the team holds, so saving a provider decides what
 * the people who arrive through it may do, exactly as inviting them would.
 * The person saving it therefore meets the ceiling an invitation meets
 * (TeamPermissionService.assertCanGrantTeamPermissions): every permission of
 * every such team must be one their own access could hand on.
 *
 *   SAML and OIDC   the teams the provider holds after the save: the teams
 *                   the save writes, or the ones it already has when the save
 *                   leaves them alone. Every save is weighed, not only one
 *                   that changes the teams: the identity provider's address,
 *                   certificate or client decide who arrives in those teams
 *                   as surely as the teams decide what they arrive to. The
 *                   one exception is switching a provider off with nothing
 *                   else changed: it only stops people signing in, so anyone
 *                   who may edit the provider may do it.
 *   SCIM            every team in the project, because its Groups endpoints
 *                   reach them all. Every project has its Owners team, which
 *                   holds Project Owner and cannot be changed, so that is
 *                   someone who may hand on any permission: a project owner.
 *
 * The caller's own permission to create or edit the provider is checked
 * first, so nobody learns which teams exist from a save they may not make.
 *
 * Teams of another project, or ids that name no team, are refused for every
 * caller, master admins and the server's own writes included: sign-in would
 * write a membership of this project into a team of that one.
 *
 * Root (the server's own writes) and master admins are not otherwise
 * weighed, as for invitations. Only saves are: a provider saved before this
 * rule keeps adding people to its teams until it is saved again.
 *
 * The Dashboard mirrors the ceiling to say which teams a form would be
 * refused (Common/UI/Utils/GrantablePermission), but this is the check.
 */

export enum SsoProviderKind {
  Saml = "SAML",
  Oidc = "OIDC",
  Scim = "SCIM",
}

// How a refusal names the provider: "this SSO provider".
const PROVIDER_NAMES: Record<SsoProviderKind, string> = {
  [SsoProviderKind.Saml]: "SSO provider",
  [SsoProviderKind.Oidc]: "OIDC provider",
  [SsoProviderKind.Scim]: "SCIM connection",
};

// A refusal names this many teams, then says how many more there are.
export const MAX_REFUSED_TEAM_NAMES: number = 5;

export const TEAMS_NOT_IN_PROJECT_MESSAGE: string =
  "One or more of the teams you picked are not in this project.";

export const TEAMS_NOT_REFERENCES_MESSAGE: string =
  "Teams must be given by their IDs.";

export const TEAMS_WITHOUT_PROJECT_MESSAGE: string =
  "Teams can only be picked for a provider that belongs to a project.";

export const SCIM_SAVE_REFUSAL_MESSAGE: string =
  "You can't save this SCIM connection, because your identity provider can add people to any team in this project through SCIM, including Owners. Ask a project owner to save it.";

// "Owners", "Owners and Members", "Owners, Members and Admin", capped.
export const joinTeamNames: (names: Array<string>) => string = (
  names: Array<string>,
): string => {
  const listed: Array<string> = names.slice(0, MAX_REFUSED_TEAM_NAMES);
  const more: number = names.length - listed.length;

  if (more > 0) {
    return `${listed.join(", ")} and ${more} more`;
  }

  if (listed.length <= 1) {
    return listed.join("");
  }

  return `${listed.slice(0, -1).join(", ")} and ${listed[listed.length - 1]}`;
};

/*
 * What the person saving a SAML or OIDC provider is told when its teams are
 * beyond their access: which teams, why, and what to do instead.
 */
export const getProviderTeamsRefusalMessage: (data: {
  kind: SsoProviderKind;
  teamNames: Array<string>;
}) => string = (data: {
  kind: SsoProviderKind;
  teamNames: Array<string>;
}): string => {
  const names: string = joinTeamNames(data.teamNames);
  const isOneTeam: boolean = data.teamNames.length === 1;

  return `You can't save this ${PROVIDER_NAMES[data.kind]} while it adds people to ${names}, because ${
    isOneTeam ? `${names} gives` : "those teams give"
  } more access than you have. Choose teams you could invite someone to, or ask a project owner to save it.`;
};

export const getProviderOutsideProjectMessage: (
  kind: SsoProviderKind,
) => string = (kind: SsoProviderKind): string => {
  return `This ${PROVIDER_NAMES[kind]} can only be saved inside its own project.`;
};

interface ProviderRecord {
  projectId?: ObjectID | undefined;
  teams?: unknown;
}

type ModelType = { new (): BaseModel };

export default class SsoProviderTeamGrant {
  /*
   * The team ids a relation value names, in any shape it reaches a hook in
   * (models, `{ _id }` objects, id strings). No teams at all is none; an
   * element that names no team id is refused rather than skipped.
   */
  public static getTeamIds(teams: unknown): Array<ObjectID> {
    if (teams === undefined || teams === null) {
      return [];
    }

    const ids: Array<string> | null = RelationValueUtil.getRelationIdSet(teams);

    if (
      !ids ||
      !ids.every((id: string): boolean => {
        return ObjectID.isValidUUID(id);
      })
    ) {
      throw new BadDataException(TEAMS_NOT_REFERENCES_MESSAGE);
    }

    return ids.map((id: string): ObjectID => {
      return new ObjectID(id);
    });
  }

  /*
   * The teams these ids name, oldest first, refused unless every one of them
   * is a team of `projectId`. Asked of every caller.
   */
  private static async findProjectTeams(data: {
    projectId: ObjectID | undefined;
    teamIds: Array<ObjectID>;
  }): Promise<Array<Team>> {
    if (data.teamIds.length === 0) {
      return [];
    }

    if (!data.projectId) {
      throw new BadDataException(TEAMS_WITHOUT_PROJECT_MESSAGE);
    }

    const teams: Array<Team> = await TeamService.findAllBy({
      query: {
        _id: QueryHelper.any(data.teamIds),
        projectId: data.projectId,
      },
      select: {
        _id: true,
        name: true,
        createdAt: true,
      },
      sort: {
        createdAt: SortOrder.Ascending,
      },
      props: {
        isRoot: true,
      },
    });

    if (teams.length !== data.teamIds.length) {
      throw new BadDataException(TEAMS_NOT_IN_PROJECT_MESSAGE);
    }

    return teams;
  }

  /**
   * Throws unless the caller could add someone to every team a provider of
   * `kind` in `projectId` reaches with `teams` (its teams after the save),
   * and unless those teams are the project's own.
   */
  @CaptureSpan()
  public static async assertCanSaveTeams(data: {
    kind: SsoProviderKind;
    projectId: ObjectID | undefined;
    teams: unknown;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const teamIds: Array<ObjectID> = SsoProviderTeamGrant.getTeamIds(
      data.teams,
    );

    if (data.props.isRoot || data.props.isMasterAdmin) {
      await SsoProviderTeamGrant.findProjectTeams({
        projectId: data.projectId,
        teamIds: teamIds,
      });

      return;
    }

    const projectId: ObjectID | undefined = data.projectId;
    const tenantId: ObjectID | undefined = data.props.tenantId;

    if (
      !projectId ||
      !tenantId ||
      tenantId.toString().toLowerCase() !== projectId.toString().toLowerCase()
    ) {
      throw new NotAuthorizedException(
        getProviderOutsideProjectMessage(data.kind),
      );
    }

    const canGrantEveryTeam: boolean =
      TeamPermissionService.canGrantEveryPermission(data.props);

    /*
     * A SCIM connection reaches every team, Owners among them, and only an
     * owner may hand on Owners' Project Owner: anyone else is refused before
     * any team is read (the model's own access control says the same).
     */
    if (data.kind === SsoProviderKind.Scim && !canGrantEveryTeam) {
      throw new NotAuthorizedException(SCIM_SAVE_REFUSAL_MESSAGE);
    }

    const providerTeams: Array<Team> =
      await SsoProviderTeamGrant.findProjectTeams({
        projectId: projectId,
        teamIds: teamIds,
      });

    // A project owner may hand on any team: nothing more to read.
    if (canGrantEveryTeam) {
      return;
    }

    const refusedTeamIds: Array<ObjectID> =
      await TeamPermissionService.findTeamsCallerCannotGrant({
        teamIds: providerTeams
          .map((team: Team): ObjectID | null => {
            return team.id;
          })
          .filter((teamId: ObjectID | null): teamId is ObjectID => {
            return Boolean(teamId);
          }),
        // The request's own spelling of the project, which it was checked by.
        projectId: tenantId,
        props: data.props,
      });

    if (refusedTeamIds.length === 0) {
      return;
    }

    const refused: Set<string> = new Set<string>(
      refusedTeamIds.map((teamId: ObjectID): string => {
        return teamId.toString().toLowerCase();
      }),
    );

    throw new NotAuthorizedException(
      getProviderTeamsRefusalMessage({
        kind: data.kind,
        teamNames: providerTeams
          .filter((team: Team): boolean => {
            return refused.has(team.id?.toString().toLowerCase() || "");
          })
          .map((team: Team): string => {
            return team.name?.toString() || team.id?.toString() || "";
          }),
      }),
    );
  }

  /*
   * A provider's onBeforeCreate. The caller's permission to create the
   * provider at all is checked before anything is read. The row is written
   * to the request's project whatever the payload says (DatabaseService
   * stamps the tenant over it), so that is the project whose teams count;
   * without one, the payload's own.
   */
  @CaptureSpan()
  public static async assertCanCreate(data: {
    kind: SsoProviderKind;
    modelType: ModelType;
    provider: BaseModel;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const record: ProviderRecord = data.provider as unknown as ProviderRecord;

    if (!data.props.isRoot && !data.props.isMasterAdmin) {
      ModelPermission.checkCreatePermissions(
        data.modelType,
        data.provider,
        data.props,
      );
    }

    await SsoProviderTeamGrant.assertCanSaveTeams({
      kind: data.kind,
      projectId: data.props.tenantId || record.projectId,
      teams: record.teams,
      props: data.props,
    });
  }

  /*
   * A provider's onBeforeUpdate. The rows are found with the caller's own
   * update permission first (so nobody learns about a provider they may not
   * edit), then read again by id alone, so a filter in the query cannot hide
   * some of a row's teams. Each row's teams after the save are weighed - the
   * ones the update writes, or the ones the row has - once per project and
   * set of teams, unless the update only switches a SAML or OIDC provider
   * off. The write is then held to exactly the rows that were checked.
   *
   * Root and master admins are weighed only when the update writes teams,
   * and then only for the teams being the project's own; their write is held
   * to the checked rows too.
   */
  @CaptureSpan()
  public static async checkUpdate<TModel extends BaseModel>(data: {
    kind: SsoProviderKind;
    service: DatabaseService<TModel>;
    updateBy: UpdateBy<TModel>;
  }): Promise<UpdateBy<TModel>> {
    const updateBy: UpdateBy<TModel> = data.updateBy;
    const isPrivileged: boolean = Boolean(
      updateBy.props.isRoot || updateBy.props.isMasterAdmin,
    );

    const updatedTeams: unknown = (updateBy.data as unknown as ProviderRecord)
      .teams;
    const writesTeams: boolean = updatedTeams !== undefined;

    if (isPrivileged && !writesTeams) {
      return updateBy;
    }

    if (!isPrivileged) {
      updateBy.query = await ModelPermission.checkUpdateQueryPermissions(
        data.service.modelType,
        updateBy.query,
        updateBy.data,
        updateBy.props,
      );
    }

    const selectedRows: Array<TModel> = await data.service.findAllBy({
      query: updateBy.query,
      select: {
        _id: true,
      } as Select<TModel>,
      skip: updateBy.skip,
      limit: updateBy.limit,
      props: {
        isRoot: true,
      },
    });

    const selectedIds: Array<ObjectID> = selectedRows
      .map((row: TModel): ObjectID | null => {
        return row.id;
      })
      .filter((rowId: ObjectID | null): rowId is ObjectID => {
        return Boolean(rowId);
      });

    if (selectedIds.length > 0) {
      const model: BaseModel = data.service.getModel();
      const updateData: Record<string, unknown> =
        updateBy.data as unknown as Record<string, unknown>;

      // The row's project and teams, and what it holds in every written column.
      const select: Record<string, unknown> = {
        _id: true,
        projectId: true,
        teams: {
          _id: true,
        },
      };

      for (const column of Object.keys(updateData)) {
        if (!model.isTableColumn(column) || select[column]) {
          continue;
        }

        select[column] = SsoProviderTeamGrant.isRelationColumn(model, column)
          ? { _id: true }
          : true;
      }

      const rows: Array<TModel> = await data.service.findAllBy({
        query: {
          _id: QueryHelper.any(selectedIds),
        } as Query<TModel>,
        select: select as unknown as Select<TModel>,
        props: {
          isRoot: true,
        },
      });

      const weighed: Set<string> = new Set<string>();

      for (const row of rows) {
        const record: ProviderRecord = row as unknown as ProviderRecord;

        /*
         * Switching a provider off, with nothing else changed, only stops
         * people signing in: anyone who may edit the provider may do it, so
         * a provider can be stopped at once. Turning it back on is a save
         * like any other.
         */
        if (
          !isPrivileged &&
          data.kind !== SsoProviderKind.Scim &&
          SsoProviderTeamGrant.isOnlySwitchingOff({
            model: model,
            row: row,
            updateData: updateData,
          })
        ) {
          continue;
        }

        const teams: unknown = writesTeams ? updatedTeams : record.teams || [];
        const key: string = [
          record.projectId?.toString().toLowerCase() || "",
          ...SsoProviderTeamGrant.getTeamIds(teams).map(
            (teamId: ObjectID): string => {
              return teamId.toString();
            },
          ),
        ].join("|");

        if (weighed.has(key)) {
          continue;
        }

        weighed.add(key);

        await SsoProviderTeamGrant.assertCanSaveTeams({
          kind: data.kind,
          projectId: record.projectId,
          teams: teams,
          props: updateBy.props,
        });
      }
    }

    // The write goes to exactly the rows that were checked, and no others.
    updateBy.query = {
      ...updateBy.query,
      _id: QueryHelper.any(selectedIds),
    } as Query<TModel>;
    updateBy.skip = 0;

    return updateBy;
  }

  /*
   * A column's value as text, to tell whether an update changes it: a URL
   * or an id as what it reads, nothing as empty. Null for a value whose text
   * does not say what it holds (a plain object), which never compares equal.
   */
  private static asText(value: unknown): string | null {
    if (value === undefined || value === null) {
      return "";
    }

    const text: string = String(value);

    return text === "[object Object]" ? null : text;
  }

  private static isRelationColumn(model: BaseModel, column: string): boolean {
    const type: TableColumnType | undefined =
      model.getTableColumnMetadata(column)?.type;

    return (
      type === TableColumnType.EntityArray || type === TableColumnType.Entity
    );
  }

  /*
   * Whether an update only switches the provider off: it writes isEnabled
   * false, and every other column it writes already holds what it writes.
   * Anything that cannot be compared counts as a change.
   */
  private static isOnlySwitchingOff(data: {
    model: BaseModel;
    row: BaseModel;
    updateData: Record<string, unknown>;
  }): boolean {
    if (data.updateData["isEnabled"] !== false) {
      return false;
    }

    const stored: Record<string, unknown> = data.row as unknown as Record<
      string,
      unknown
    >;

    for (const column of Object.keys(data.updateData)) {
      if (column === "isEnabled") {
        continue;
      }

      if (!data.model.isTableColumn(column)) {
        return false;
      }

      const current: unknown = stored[column];
      const updated: unknown = data.updateData[column];

      if (SsoProviderTeamGrant.isRelationColumn(data.model, column)) {
        if (
          RelationValueUtil.haveSameRelationIds(
            current ?? [],
            updated ?? [],
          ) !== true
        ) {
          return false;
        }

        continue;
      }

      const currentText: string | null = SsoProviderTeamGrant.asText(current);
      const updatedText: string | null = SsoProviderTeamGrant.asText(updated);

      if (
        currentText === null ||
        updatedText === null ||
        currentText !== updatedText
      ) {
        return false;
      }
    }

    return true;
  }
}
