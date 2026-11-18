import TeamService from "../../Services/TeamService";
import QueryHelper from "../../Types/Database/QueryHelper";
import CaptureSpan from "../Telemetry/CaptureSpan";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Query from "../../../Types/BaseDatabase/Query";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Team from "../../../Models/DatabaseModels/Team";

/*
 * THE NAMES OF THE TEAMS A READER MAY READ, OF THESE.
 *
 * Something said about a person's teams - which ones Remove from Project
 * would leave them in (#6599) - names a team only for a reader who may
 * read it: the teams are read with the reader's own permissions, in the
 * project, so a team the reader may not see is left out, and the caller
 * counts it instead of naming it. A reader who may read no team at all is
 * answered with no name, never with the refusal: what they asked about is
 * someone else's question, and the names were only ever a courtesy.
 */
export default class ReadableTeamNames {
  // By the team's id, lower case; a team the reader may not read is not there.
  @CaptureSpan()
  public static async read(data: {
    teamIds: Array<ObjectID>;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Map<string, string>> {
    const unique: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const teamId of data.teamIds) {
      unique.set(teamId.toString().toLowerCase(), teamId);
    }

    const names: Map<string, string> = new Map<string, string>();

    if (unique.size === 0) {
      return names;
    }

    let teams: Array<Team> = [];

    try {
      teams = await TeamService.findBy({
        query: {
          _id: QueryHelper.any(Array.from(unique.values())),
          projectId: data.projectId,
        } as Query<Team>,
        select: {
          _id: true,
          name: true,
        },
        limit: unique.size,
        skip: 0,
        props: data.props,
      });
    } catch (err) {
      if (
        err instanceof NotAuthorizedException ||
        err instanceof NotAuthenticatedException
      ) {
        return names;
      }

      throw err;
    }

    for (const team of teams) {
      const id: string | undefined = team.id?.toString().toLowerCase();
      const name: string = team.name?.toString().trim() || "";

      if (id && name && unique.has(id)) {
        names.set(id, name);
      }
    }

    return names;
  }
}
