import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { describe, expect, test, beforeEach } from "@jest/globals";
import WhoIsOnCallScreen, { matchesRosterSearch } from "./WhoIsOnCallScreen";
import type { ProjectOnCallScheduleItem } from "../api/types";

/*
 * The roster screen exists so a responder can find a HUMAN quickly - to hand
 * over, or to escalate to. Two things make or break that:
 *
 *   - a schedule with nobody on it must be impossible to miss. It is the only
 *     row here that is a problem, and alphabetical order buries it.
 *   - search has to match the person, not just the schedule name. People look
 *     for "Priya", not for "Primary - EU".
 */

const mockSchedules: {
  current: {
    schedules: ProjectOnCallScheduleItem[];
    isLoading: boolean;
    isError: boolean;
    refetch: () => Promise<void>;
  };
} = {
  current: {
    schedules: [],
    isLoading: false,
    isError: false,
    refetch: async (): Promise<void> => {
      return undefined;
    },
  },
};

const mockUserId: { current: string | null } = { current: "user-me" };

jest.mock("../hooks/useOnCallSchedules", () => {
  return {
    useOnCallSchedules: () => {
      return mockSchedules.current;
    },
  };
});

jest.mock("../hooks/useCurrentUserId", () => {
  return {
    useCurrentUserId: () => {
      return mockUserId.current;
    },
  };
});

jest.mock("../hooks/useNow", () => {
  return {
    useNow: () => {
      return new Date(2026, 2, 3, 12, 0, 0, 0).getTime();
    },
  };
});

jest.mock("../hooks/useHaptics", () => {
  return {
    useHaptics: () => {
      return {
        successFeedback: jest.fn(),
        errorFeedback: jest.fn(),
        lightImpact: jest.fn(),
        mediumImpact: jest.fn(),
        selectionFeedback: jest.fn(),
      };
    },
  };
});

function entry(
  id: string,
  name: string,
  currentUser: { _id: string; name?: string; email?: string } | null,
  projectName: string = "Acme",
): ProjectOnCallScheduleItem {
  return {
    projectId: "project-1",
    projectName,
    item: {
      _id: id,
      name,
      currentUserOnRoster: currentUser,
      nextUserOnRoster: null,
      rosterStartAt: null,
      rosterHandoffAt: null,
      rosterNextStartAt: null,
      rosterNextHandoffAt: null,
    },
  };
}

describe("matchesRosterSearch", () => {
  const row: ProjectOnCallScheduleItem = entry("s1", "Primary EU", {
    _id: "user-2",
    name: "Priya Rao",
    email: "priya@example.com",
  });

  test("matches the schedule name", () => {
    expect(matchesRosterSearch(row, "primary")).toBe(true);
  });

  test("matches the project name", () => {
    expect(matchesRosterSearch(row, "acme")).toBe(true);
  });

  test("matches the person who is on call", () => {
    expect(matchesRosterSearch(row, "priya")).toBe(true);
    expect(matchesRosterSearch(row, "priya@example")).toBe(true);
  });

  test("matches the person who is next", () => {
    const withNext: ProjectOnCallScheduleItem = entry("s1", "Primary", null);
    withNext.item.nextUserOnRoster = { _id: "user-3", name: "Sam Patel" };

    expect(matchesRosterSearch(withNext, "sam")).toBe(true);
  });

  test("an empty search matches everything", () => {
    expect(matchesRosterSearch(row, "   ")).toBe(true);
  });

  test("does not match an unrelated term", () => {
    expect(matchesRosterSearch(row, "database")).toBe(false);
  });
});

describe("WhoIsOnCallScreen", () => {
  beforeEach(() => {
    mockSchedules.current = {
      schedules: [],
      isLoading: false,
      isError: false,
      refetch: async (): Promise<void> => {
        return undefined;
      },
    };
    mockUserId.current = "user-me";
  });

  test("puts uncovered schedules in their own section, ahead of the rest", async (): Promise<void> => {
    mockSchedules.current.schedules = [
      entry("s-covered", "Primary", { _id: "user-2", name: "Priya Rao" }),
      entry("s-uncovered", "Weekend", null),
    ];

    await render(<WhoIsOnCallScreen />);

    expect(screen.getByTestId("section-uncovered")).toBeTruthy();

    /*
     * Order, not just presence: the uncovered schedule has to come FIRST even
     * though "Primary" sorts before "Weekend" alphabetically.
     */
    expect(
      screen
        .getAllByTestId(/^roster-card-/)
        .map((node: { props: { testID?: string } }) => {
          return node.props.testID;
        }),
    ).toEqual(["roster-card-s-uncovered", "roster-card-s-covered"]);
  });

  test("does not render the warning section when everything is covered", async (): Promise<void> => {
    mockSchedules.current.schedules = [
      entry("s-covered", "Primary", { _id: "user-2", name: "Priya Rao" }),
    ];

    await render(<WhoIsOnCallScreen />);

    expect(screen.queryByTestId("section-uncovered")).toBeNull();
    expect(screen.getByTestId("section-covered")).toBeTruthy();
  });

  test("marks the reader's own schedules", async (): Promise<void> => {
    mockSchedules.current.schedules = [
      entry("s1", "Primary", { _id: "user-me", name: "Ada" }),
    ];

    await render(<WhoIsOnCallScreen />);

    expect(screen.getByText("YOU")).toBeTruthy();
  });

  test("filters as the responder types", async (): Promise<void> => {
    mockSchedules.current.schedules = [
      entry("s1", "Primary", { _id: "user-2", name: "Priya Rao" }),
      entry("s2", "Database", { _id: "user-3", name: "Sam Patel" }),
    ];

    await render(<WhoIsOnCallScreen />);

    await fireEvent.changeText(screen.getByTestId("roster-search"), "priya");

    expect(screen.getByTestId("roster-card-s1")).toBeTruthy();
    expect(screen.queryByTestId("roster-card-s2")).toBeNull();
  });

  test("says nothing matched rather than looking empty", async (): Promise<void> => {
    mockSchedules.current.schedules = [
      entry("s1", "Primary", { _id: "user-2", name: "Priya Rao" }),
    ];

    await render(<WhoIsOnCallScreen />);

    await fireEvent.changeText(screen.getByTestId("roster-search"), "zzzz");

    expect(screen.getByText("No schedules match that search.")).toBeTruthy();
  });

  test("distinguishes 'no schedules exist' from 'nothing matched'", async (): Promise<void> => {
    await render(<WhoIsOnCallScreen />);

    expect(screen.getByText("No on-call schedules")).toBeTruthy();
  });

  test("offers a retry when the roster read fails", async (): Promise<void> => {
    mockSchedules.current.isError = true;

    await render(<WhoIsOnCallScreen />);

    expect(screen.getByText("Could not load the on-call roster")).toBeTruthy();
  });
});
