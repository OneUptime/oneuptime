import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Team from "../../Models/DatabaseModels/Team";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
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
 *                   as surely as the teams decide what they arrive to.
 *   SCIM            every team in the project, because its Groups endpoints
 *                   reach them all; its default teams must also be the
 *                   project's own.
 *
 * Teams of another project are refused outright: sign-in would write a
 * membership of this project into a team of that one.
 *
 * Root (the server's own writes, such as sign-in recording a tested
 * provider) and master admins are not weighed, as for invitations. Only
 * saves are: a provider saved before this rule keeps adding people to its
 * teams until it is saved again.
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
 * What the person saving a provider is told when its teams are beyond their
 * access: which teams, why, and what to do instead.
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

  if (data.kind === SsoProviderKind.Scim) {
    return `You can't save this SCIM connection, because your identity provider can add people to any team in this project through SCIM, and ${names} ${
      isOneTeam ? "gives" : "give"
    } more access than you have. Ask a project owner to save it.`;
  }

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

export default class SsoProviderTeamGrant {
  /*
   * The team ids a relation value names, in any shape it reaches a hook in
   * (models, `{ _id }` objects, id strings). No teams at all is none; an
   * element that names no team is refused rather than skipped.
   */
  public static getTeamIds(teams: unknown): Array<ObjectID> {
    if (teams === undefined || teams === null) {
      return [];
    }

    const ids: Array<string> | null =
      RelationValueUtil.getRelationIdSet(teams);

    if (!ids) {
      throw new BadDataException(TEAMS_NOT_REFERENCES_MESSAGE);
    }

    return ids.map((id: string): ObjectID => {
      return new ObjectID(id);
    });
  }

  /**
   * Throws unless the caller could add someone to every team a provider of
   * `kind` in `projectId` reaches with `teams` (its teams after the save).
   */
  @CaptureSpan()
  public static async assertCanSaveTeams(data: {
    kind: SsoProviderKind;
    projectId: ObjectID | undefined;
    teams: unknown;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    if (data.props.isRoot || data.props.isMasterAdmin) {
      return;
    }

    const projectId: ObjectID | undefined = data.projectId;

    if (
      !projectId ||
      !data.props.tenantId ||
      data.props.tenantId.toString().toLowerCase() !==
        projectId.toString().toLowerCase()
    ) {
      throw new NotAuthorizedException(
        getProviderOutsideProjectMessage(data.kind),
      );
    }

    const teamIds: Array<ObjectID> = SsoProviderTeamGrant.getTeamIds(
      data.teams,
    );

    const providerTeams: Array<Team> =
      teamIds.length === 0
        ? []
        : await TeamService.findAllBy({
            query: {
              _id: QueryHelper.any(teamIds),
              projectId: projectId,
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

    if (providerTeams.length !== teamIds.length) {
      throw new BadDataException(TEAMS_NOT_IN_PROJECT_MESSAGE);
    }

    // A project owner may hand on any team: nothing more to read.
    if (TeamPermissionService.canGrantEveryPermission(data.props)) {
      return;
    }

    const teamsReached: Array<Team> =
      data.kind === SsoProviderKind.Scim
        ? await TeamService.findAllBy({
            query: {
              projectId: projectId,
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
          })
        : providerTeams;

    const refusedTeamIds: Array<ObjectID> =
      await TeamPermissionService.findTeamsCallerCannotGrant({
        teamIds: teamsReached
          .map((team: Team): ObjectID | null => {
            return team.id;
          })
          .filter((teamId: ObjectID | null): teamId is ObjectID => {
            return Boolean(teamId);
          }),
        projectId: projectId,
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
        teamNames: teamsReached
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
   * A provider's onBeforeCreate. The row is written to the request's project
   * whatever the payload says (DatabaseService stamps the tenant over it), so
   * that is the project whose teams count.
   */
  @CaptureSpan()
  public static async assertCanCreate(data: {
    kind: SsoProviderKind;
    provider: BaseModel;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    if (data.props.isRoot || data.props.isMasterAdmin) {
      return;
    }

    await SsoProviderTeamGrant.assertCanSaveTeams({
      kind: data.kind,
      projectId: data.props.tenantId,
      teams: (data.provider as unknown as ProviderRecord).teams,
      props: data.props,
    });
  }

  /*
   * A provider's onBeforeUpdate. The rows are found with the caller's own
   * update permission first (so nobody learns about a provider they may not
   * edit), then read again by id alone, so a filter in the query cannot hide
   * some of a row's teams. Each row's teams after the save are weighed: the
   * ones the update writes, or the ones the row has. The write is then held
   * to exactly the rows that were weighed.
   */
  @CaptureSpan()
  public static async checkUpdate<TModel extends BaseModel>(data: {
    kind: SsoProviderKind;
    service: DatabaseService<TModel>;
    updateBy: UpdateBy<TModel>;
  }): Promise<UpdateBy<TModel>> {
    const updateBy: UpdateBy<TModel> = data.updateBy;

    if (updateBy.props.isRoot || updateBy.props.isMasterAdmin) {
      return updateBy;
    }

    updateBy.query = await ModelPermission.checkUpdateQueryPermissions(
      data.service.modelType,
      updateBy.query,
      updateBy.data,
      updateBy.props,
    );

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

    const updatedTeams: unknown = (
      updateBy.data as unknown as ProviderRecord
    ).teams;
    const writesTeams: boolean = updatedTeams !== undefined;

    if (selectedIds.length > 0) {
      const rows: Array<TModel> = await data.service.findAllBy({
        query: {
          _id: QueryHelper.any(selectedIds),
        } as Query<TModel>,
        select: {
          _id: true,
          projectId: true,
          teams: {
            _id: true,
          },
        } as unknown as Select<TModel>,
        props: {
          isRoot: true,
        },
      });

      for (const row of rows) {
        const record: ProviderRecord = row as unknown as ProviderRecord;

        await SsoProviderTeamGrant.assertCanSaveTeams({
          kind: data.kind,
          projectId: record.projectId,
          teams: writesTeams ? updatedTeams : record.teams || [],
          props: updateBy.props,
        });
      }
    }

    updateBy.query = {
      ...updateBy.query,
      _id: QueryHelper.any(selectedIds),
    } as Query<TModel>;
    updateBy.skip = 0;

    return updateBy;
  }
}
