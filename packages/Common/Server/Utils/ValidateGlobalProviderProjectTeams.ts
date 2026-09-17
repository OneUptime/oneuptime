import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import Project from "../../Models/DatabaseModels/Project";
import Team from "../../Models/DatabaseModels/Team";
import QueryHelper from "../Types/Database/QueryHelper";
import TeamService from "../Services/TeamService";

/*
 * The Admin Dashboard attach form submits the chosen project via the `project`
 * relation, not the `projectId` FK: the entity dropdown sets the related
 * Project (as a model with only `_id`), so `createBy.data.projectId` is
 * undefined at create-hook time. Resolve the FK from either shape so the hook
 * can populate the NOT NULL `projectId` column and validate teams against it.
 */
export const resolveAttachmentProjectId: (data: {
  projectId?: ObjectID | undefined;
  project?: Project | undefined;
}) => ObjectID | undefined = (data: {
  projectId?: ObjectID | undefined;
  project?: Project | undefined;
}): ObjectID | undefined => {
  if (data.projectId) {
    return data.projectId;
  }

  const project: (Project & { _id?: string }) | undefined = data.project as
    | (Project & { _id?: string })
    | undefined;

  if (!project) {
    return undefined;
  }

  const idString: string | undefined =
    project._id?.toString() || (project.id ? project.id.toString() : undefined);

  return idString ? new ObjectID(idString) : undefined;
};

/*
 * Guards a Global SSO / Global OIDC project-attachment: every default team
 * selected for the attachment MUST belong to the same project the attachment
 * targets.
 *
 * Without this guard, an admin (or a direct API call) could attach a team that
 * lives in project B to an attachment that targets project A. The SSO/OIDC
 * login fan-out (see App/FeatureSet/Identity/API/GlobalSSO.ts) provisions a
 * TeamMember with `projectId = attachment.projectId` but `teamId = team.id`,
 * and because that path runs with `ignoreHooks: true` no service-level
 * validation would catch the mismatch — producing a corrupt, cross-project
 * membership row. This is the server-side backstop for the project-scoped team
 * picker in the Admin Dashboard.
 */
type ValidateGlobalProviderProjectTeamsFunction = (data: {
  teams: Array<Team> | undefined;
  projectId: ObjectID | undefined;
}) => Promise<void>;

const validateGlobalProviderProjectTeams: ValidateGlobalProviderProjectTeamsFunction =
  async (data: {
    teams: Array<Team> | undefined;
    projectId: ObjectID | undefined;
  }): Promise<void> => {
    const teams: Array<Team> | undefined = data.teams;

    if (!teams || teams.length === 0) {
      // No default teams selected: nothing to validate.
      return;
    }

    if (!data.projectId) {
      throw new BadDataException(
        "A project must be selected before choosing default teams.",
      );
    }

    const projectId: string = data.projectId.toString();

    const teamIds: Array<string> = teams
      .map((team: Team) => {
        return (
          team.id?.toString() ||
          (team as { _id?: string })._id?.toString() ||
          undefined
        );
      })
      .filter((id: string | undefined): id is string => {
        return Boolean(id);
      });

    if (teamIds.length === 0) {
      return;
    }

    const foundTeams: Array<Team> = await TeamService.findBy({
      query: { _id: QueryHelper.any(teamIds) },
      select: { _id: true, projectId: true },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    });

    if (foundTeams.length !== teamIds.length) {
      throw new BadDataException(
        "One or more selected teams could not be found.",
      );
    }

    for (const team of foundTeams) {
      if (team.projectId?.toString() !== projectId) {
        throw new BadDataException(
          "All selected teams must belong to the project this provider is attached to.",
        );
      }
    }
  };

export default validateGlobalProviderProjectTeams;
