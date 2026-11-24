import React from "react";
import { cleanup, renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  useOverrideTeamPeople,
  type OverrideTeamPeopleState,
} from "./useOverrideTeamPeople";
import * as projectUsersApi from "../api/projectUsers";
import type { TeamPeople } from "../api/projectUsers";

/*
 * THE PEOPLE OF THE TEAMS AN OVERRIDE IS KEPT TO (#9883): read only for
 * someone the team rule narrows (teamIds given), once for the teams named
 * whatever their order or case; while it reads, and when it cannot, who is
 * in the teams is not known - so nothing is locked for it - and names that
 * cannot be read only leave the picker without its line.
 */

jest.mock("../api/projectUsers", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../api/projectUsers",
  ) as Record<string, unknown>;

  return {
    ...actual,
    fetchTeamPeople: jest.fn(),
    fetchTeamNames: jest.fn(),
  };
});

function peopleSpy(): jest.Mock {
  return projectUsersApi.fetchTeamPeople as unknown as jest.Mock;
}

function namesSpy(): jest.Mock {
  return projectUsersApi.fetchTeamNames as unknown as jest.Mock;
}

const PAYMENTS_PEOPLE: TeamPeople = {
  users: [
    { userId: "user-ada", name: "Ada", email: "ada@example.com" },
    { userId: "user-sam", name: "Sam", email: "sam@example.com" },
  ],
  membersByTeam: new Map<string, Set<string>>([
    ["team-payments", new Set<string>(["user-ada", "user-sam"])],
  ]),
};

async function renderTeamPeople(data: {
  projectId: string | null;
  teamIds: ReadonlyArray<string> | null;
}): Promise<{ result: { current: OverrideTeamPeopleState } }> {
  const client: QueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return await renderHook(
    () => {
      return useOverrideTeamPeople(data);
    },
    {
      wrapper: ({ children }: { children: React.ReactNode }) => {
        return (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        );
      },
    },
  );
}

beforeEach(() => {
  peopleSpy().mockReset();
  namesSpy().mockReset();
  peopleSpy().mockResolvedValue(PAYMENTS_PEOPLE as never);
  namesSpy().mockResolvedValue(["Payments"] as never);
});

afterEach(() => {
  cleanup();
});

describe("useOverrideTeamPeople", () => {
  test("someone the team rule does not narrow: nothing is read, and nothing is known", async () => {
    const { result } = await renderTeamPeople({
      projectId: "project-1",
      teamIds: null,
    });

    expect(result.current.users).toEqual([]);
    expect(result.current.membersByTeam).toBeNull();
    expect(result.current.teamNames).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(peopleSpy()).not.toHaveBeenCalled();
    expect(namesSpy()).not.toHaveBeenCalled();
  });

  test("no project: nothing is read", async () => {
    await renderTeamPeople({ projectId: null, teamIds: ["team-payments"] });

    expect(peopleSpy()).not.toHaveBeenCalled();
  });

  test("while it reads, it says so, and who is in the teams is not known", async () => {
    peopleSpy().mockReturnValue(new Promise<never>(() => {}) as never);
    namesSpy().mockReturnValue(new Promise<never>(() => {}) as never);

    const { result } = await renderTeamPeople({
      projectId: "project-1",
      teamIds: ["team-payments"],
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.membersByTeam).toBeNull();
    expect(result.current.teamNames).toBeNull();
    expect(result.current.users).toEqual([]);
  });

  test("the teams' people, who is in which team, and their names, read in the project", async () => {
    const { result } = await renderTeamPeople({
      projectId: "project-1",
      teamIds: ["team-payments"],
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.users).toEqual(PAYMENTS_PEOPLE.users);
    expect(result.current.membersByTeam).toBe(PAYMENTS_PEOPLE.membersByTeam);

    await waitFor(() => {
      expect(result.current.teamNames).toEqual(["Payments"]);
    });

    expect(peopleSpy()).toHaveBeenCalledWith("project-1", ["team-payments"]);
    expect(namesSpy()).toHaveBeenCalledWith("project-1", ["team-payments"]);
  });

  test("the teams are asked about once, whatever their order or case", async () => {
    await renderTeamPeople({
      projectId: "project-1",
      teamIds: ["TEAM-PAYMENTS", "team-mobile", "team-payments"],
    });

    await waitFor(() => {
      expect(peopleSpy()).toHaveBeenCalledTimes(1);
    });

    expect(peopleSpy()).toHaveBeenCalledWith("project-1", [
      "team-mobile",
      "team-payments",
    ]);
  });

  test("a limit to no team names nobody, and reads nothing", async () => {
    const { result } = await renderTeamPeople({
      projectId: "project-1",
      teamIds: [],
    });

    expect(result.current.users).toEqual([]);
    expect(result.current.membersByTeam).toEqual(
      new Map<string, Set<string>>(),
    );
    expect(result.current.teamNames).toEqual([]);
    expect(peopleSpy()).not.toHaveBeenCalled();
  });

  test("a failed read of the people: said, and who is in the teams is not known", async () => {
    peopleSpy().mockRejectedValue(new Error("Network Error") as never);

    const { result } = await renderTeamPeople({
      projectId: "project-1",
      teamIds: ["team-payments"],
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.membersByTeam).toBeNull();
    expect(result.current.users).toEqual([]);
  });

  test("names that cannot be read leave out only the line: the people are still the teams'", async () => {
    namesSpy().mockRejectedValue(new Error("Forbidden") as never);

    const { result } = await renderTeamPeople({
      projectId: "project-1",
      teamIds: ["team-payments"],
    });

    await waitFor(() => {
      expect(result.current.teamNames).toEqual([]);
    });

    expect(result.current.isError).toBe(false);
    expect(result.current.users).toEqual(PAYMENTS_PEOPLE.users);
  });

  test("a retry reads the people and the names again", async () => {
    const { result } = await renderTeamPeople({
      projectId: "project-1",
      teamIds: ["team-payments"],
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await result.current.refetch();

    expect(peopleSpy()).toHaveBeenCalledTimes(2);
    expect(namesSpy()).toHaveBeenCalledTimes(2);
  });
});
