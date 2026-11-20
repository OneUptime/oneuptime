import { useQuery, UseQueryResult } from "@tanstack/react-query";
import {
  fetchTeamNames,
  fetchTeamPeople,
  type TeamPeople,
} from "../api/projectUsers";
import type { ProjectUserItem } from "../api/types";

export interface OverrideTeamPeopleState {
  // The teams' accepted members, each once, by name: whom a picker offers.
  users: ProjectUserItem[];
  // Who is in which team, lower-cased ids; null while not known.
  membersByTeam: ReadonlyMap<string, ReadonlySet<string>> | null;
  // The teams' names, by name, for the line above a picker's list; null while read.
  teamNames: string[] | null;
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<void>;
}

const NOTHING_ASKED: OverrideTeamPeopleState = {
  users: [],
  membersByTeam: null,
  teamNames: null,
  isLoading: false,
  isError: false,
  refetch: async (): Promise<void> => {
    return undefined;
  },
};

/**
 * The people of the teams an override is kept to
 * (hooks/useOverrideTeamLimits): their accepted members, who is in which
 * team, and the teams' names. `teamIds` null asks nothing - the person is
 * not limited. While it reads, and when a read fails, who is in the teams
 * is not known: nothing is locked for it, and the server decides. A limit
 * to no team names nobody.
 */
export function useOverrideTeamPeople(data: {
  projectId: string | null;
  teamIds: ReadonlyArray<string> | null;
}): OverrideTeamPeopleState {
  const teamIds: Array<string> = data.teamIds
    ? Array.from(
        new Set<string>(
          data.teamIds.map((teamId: string): string => {
            return teamId.trim().toLowerCase();
          }),
        ),
      ).sort()
    : [];
  const signature: string = teamIds.join(",");
  const isAsked: boolean = Boolean(data.projectId) && data.teamIds !== null;
  const isReadNeeded: boolean = isAsked && teamIds.length > 0;

  const people: UseQueryResult<TeamPeople, Error> = useQuery({
    queryKey: ["override-team-people", data.projectId ?? "none", signature],
    enabled: isReadNeeded,
    queryFn: async (): Promise<TeamPeople> => {
      return await fetchTeamPeople(data.projectId as string, teamIds);
    },
  });

  const names: UseQueryResult<string[], Error> = useQuery({
    queryKey: ["override-team-names", data.projectId ?? "none", signature],
    enabled: isReadNeeded,
    queryFn: async (): Promise<string[]> => {
      return await fetchTeamNames(data.projectId as string, teamIds);
    },
  });

  if (!isAsked) {
    return NOTHING_ASKED;
  }

  if (!isReadNeeded) {
    return {
      ...NOTHING_ASKED,
      membersByTeam: new Map<string, Set<string>>(),
      teamNames: [],
    };
  }

  return {
    users: people.data?.users ?? [],
    membersByTeam: people.data?.membersByTeam ?? null,
    // Names that could not be read draw no line: the list is kept to the teams all the same.
    teamNames: names.isError ? [] : names.data ?? null,
    isLoading: people.isPending,
    isError: people.isError,
    refetch: async (): Promise<void> => {
      await Promise.all([people.refetch(), names.refetch()]);
    },
  };
}
