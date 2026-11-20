import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { useEffect, useState } from "react";

/*
 * THE PEOPLE OF THE TEAMS A READER'S USER OVERRIDES ARE KEPT TO
 * (UserOverrideTeamLimit, issue #9733): the teams' names, for the line
 * above a picker's list, and - asked for with `withMembers` - who their
 * accepted members are, for the locks on the overrides that name anyone
 * else and the forms' words under a person outside them.
 *
 * Read once for the teams named, as the reader may read teams and their
 * members. While it reads - and when it cannot - nothing is known: no line
 * is drawn, nothing is locked, and the server decides. A team so big that
 * not all of its members come back in one read is not known either, so
 * nobody is locked for want of a row.
 */

export interface UserOverrideTeamPeople {
  // The teams' names, by name; null while they are read.
  teamNames: Array<string> | null;
  // The teams' accepted members, lower-cased user ids; null while not known.
  memberIds: ReadonlySet<string> | null;
}

const NOTHING_KNOWN: UserOverrideTeamPeople = {
  teamNames: null,
  memberIds: null,
};

const useUserOverrideTeamPeople: (data: {
  // The teams, from UserOverrideTeamLimit; null for a reader kept to none.
  teamIds: Array<string> | null;
  withMembers?: boolean | undefined;
}) => UserOverrideTeamPeople = (data: {
  teamIds: Array<string> | null;
  withMembers?: boolean | undefined;
}): UserOverrideTeamPeople => {
  const teamIds: Array<string> | null = data.teamIds;
  const withMembers: boolean = Boolean(data.withMembers);
  const signature: string = teamIds ? teamIds.join(",") : "";

  const [people, setPeople] = useState<UserOverrideTeamPeople>(NOTHING_KNOWN);

  useEffect(() => {
    if (!teamIds) {
      setPeople(NOTHING_KNOWN);
      return;
    }

    if (teamIds.length === 0) {
      setPeople({ teamNames: [], memberIds: new Set<string>() });
      return;
    }

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      setPeople(NOTHING_KNOWN);
      return;
    }

    let isCancelled: boolean = false;

    setPeople(NOTHING_KNOWN);

    const readTeams: Promise<ListResult<Team>> = ModelAPI.getList<Team>({
      modelType: Team,
      query: {
        projectId: projectId,
        _id: new Includes(teamIds),
      } as unknown as Query<Team>,
      select: { _id: true, name: true },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      sort: { name: SortOrder.Ascending },
    });

    const readMembers: Promise<ListResult<TeamMember> | null> = withMembers
      ? ModelAPI.getList<TeamMember>({
          modelType: TeamMember,
          query: {
            projectId: projectId,
            teamId: new Includes(teamIds),
            hasAcceptedInvitation: true,
          } as unknown as Query<TeamMember>,
          select: { _id: true, userId: true },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          sort: {},
        })
      : Promise.resolve(null);

    Promise.all([readTeams, readMembers])
      .then(
        ([teams, members]: [
          ListResult<Team>,
          ListResult<TeamMember> | null,
        ]) => {
          if (isCancelled) {
            return;
          }

          setPeople({
            teamNames: teams.data
              .map((team: Team): string => {
                return team.name?.toString() || "";
              })
              .filter((name: string): boolean => {
                return Boolean(name);
              }),
            // Every member read, or none known: a list cut short locks nobody.
            memberIds:
              members && members.count <= members.data.length
                ? new Set<string>(
                    members.data
                      .map((member: TeamMember): string => {
                        return (
                          member.userId?.toString().trim().toLowerCase() || ""
                        );
                      })
                      .filter((userId: string): boolean => {
                        return Boolean(userId);
                      }),
                  )
                : null,
          });
        },
      )
      .catch(() => {
        // Not known: no line, no lock - the server decides.
        if (!isCancelled) {
          setPeople({ teamNames: [], memberIds: null });
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [signature, withMembers]);

  return people;
};

export default useUserOverrideTeamPeople;
