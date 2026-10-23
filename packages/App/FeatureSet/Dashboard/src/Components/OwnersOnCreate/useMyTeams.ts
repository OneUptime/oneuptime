import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { getPeoplePickerKindDefinition } from "Common/UI/Components/PeoplePicker/PeoplePickerKinds";
import {
  PeoplePickerKind,
  PeoplePickerOption,
} from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import { useEffect, useState } from "react";
import { MyTeam } from "./OwnersOnCreateRules";

/*
 * The teams of the project the signed-in person is a member of (an accepted
 * invitation), by name - what "Your teams" under an Owners picker offers.
 * Everyone may read their own memberships (TeamMember's CurrentUser
 * permission); the teams' names are read as every owners picker reads
 * them, so a team the person cannot read is not offered. Advisory: when
 * nothing can be read, nothing is offered.
 */

export interface MyTeamsState {
  teams: Array<MyTeam>;
  isLoading: boolean;
}

export const fetchMyTeams: () => Promise<Array<MyTeam>> = async (): Promise<
  Array<MyTeam>
> => {
  const userId: ObjectID | null = UserUtil.getUserId();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!userId || !projectId) {
    return [];
  }

  const memberships: ListResult<TeamMember> =
    await ModelAPI.getList<TeamMember>({
      modelType: TeamMember,
      query: {
        userId: userId,
        projectId: projectId,
        hasAcceptedInvitation: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: {
        teamId: true,
      },
      sort: {},
    });

  const teamIds: Array<string> = [];

  for (const membership of memberships.data) {
    const teamId: string = membership.teamId?.toString() || "";

    if (teamId && !teamIds.includes(teamId)) {
      teamIds.push(teamId);
    }
  }

  if (teamIds.length === 0) {
    return [];
  }

  const options: Array<PeoplePickerOption> =
    await getPeoplePickerKindDefinition(PeoplePickerKind.Team).getByIds({
      projectId: projectId,
      ids: teamIds,
    });

  return options
    .filter((option: PeoplePickerOption): boolean => {
      return !option.isUnknown && Boolean(option.name);
    })
    .map((option: PeoplePickerOption): MyTeam => {
      return { id: option.id, name: option.name };
    });
};

const useMyTeams: () => MyTeamsState = (): MyTeamsState => {
  const [state, setState] = useState<MyTeamsState>({
    teams: [],
    isLoading: true,
  });

  useEffect(() => {
    let isCancelled: boolean = false;

    fetchMyTeams()
      .then((teams: Array<MyTeam>) => {
        if (!isCancelled) {
          setState({ teams: teams, isLoading: false });
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setState({ teams: [], isLoading: false });
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  return state;
};

export default useMyTeams;
