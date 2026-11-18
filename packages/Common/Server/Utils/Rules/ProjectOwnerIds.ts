import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import ObjectID from "../../../Types/ObjectID";
import TeamMemberService from "../../Services/TeamMemberService";
import TeamService from "../../Services/TeamService";
import QueryHelper from "../../Types/Database/QueryHelper";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";

/*
 * WHICH OF THESE IDS ARE PEOPLE AND TEAMS OF THE PROJECT.
 *
 * A condition on who owns a record names people and teams in one list of
 * ids: a workspace rule's owner condition (#7583) and an alert on-call
 * rule's Alert Owner (#9353). Each id is one of the project's teams, or a
 * person who is a member of one of its teams - as the people picker offers
 * them. Hands back those of `ids` that are, written as the database writes
 * ids (lower case); the others are not the project's.
 */
export async function findProjectOwnerIds(data: {
  projectId: ObjectID;
  ids: Array<string>;
}): Promise<Set<string>> {
  const ids: Array<string> = Array.from(
    new Set(
      data.ids.map((id: string): string => {
        return id.trim().toLowerCase();
      }),
    ),
  );

  const found: Set<string> = new Set();

  if (ids.length === 0) {
    return found;
  }

  const teams: Array<Team> = await TeamService.findBy({
    query: {
      projectId: data.projectId,
      _id: QueryHelper.any(ids),
    },
    select: {
      _id: true,
    },
    skip: 0,
    limit: LIMIT_PER_PROJECT,
    props: {
      isRoot: true,
    },
  });

  for (const team of teams) {
    const id: string = team._id?.toString().toLowerCase() || "";

    if (id) {
      found.add(id);
    }
  }

  const notTeams: Array<string> = ids.filter((id: string): boolean => {
    return !found.has(id);
  });

  if (notTeams.length > 0) {
    const members: Array<TeamMember> = await TeamMemberService.findBy({
      query: {
        projectId: data.projectId,
        userId: QueryHelper.any(notTeams),
      },
      select: {
        userId: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    for (const member of members) {
      if (member.userId) {
        found.add(member.userId.toString().toLowerCase());
      }
    }
  }

  return found;
}

export default findProjectOwnerIds;
