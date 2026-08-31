import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";
import { describe, expect, test, beforeEach } from "@jest/globals";
import HomeScreen from "./HomeScreen";
import { useAllProjectCounts } from "../hooks/useAllProjectCounts";
import { useAllProjectOnCallPolicies } from "../hooks/useAllProjectOnCallPolicies";
import { makeProject } from "../__tests__/testSupport";
import type { ProjectItem, ProjectOnCallAssignments } from "../api/types";

/*
 * Home is a verdict screen. A responder glances at it, reads the digits, and
 * decides whether anything needs them. That makes a "0" the most consequential
 * thing this file renders, and there are three completely different states
 * that used to arrive at the same 0:
 *
 *   - the request is still in flight,
 *   - the request failed,
 *   - the request came back and there is genuinely nothing outstanding.
 *
 * Only the third one has earned the number. Every count out of
 * useAllProjectCounts falls back to 0 when its query has no data, so without
 * consulting isLoading AND isError the screen tells a responder "nothing is
 * down" on the strength of a request that never landed - which on an on-call
 * app is not a cosmetic bug.
 *
 * The same applies, harder, to the on-call card: "You are not currently
 * on-call" is a sentence that makes people put the phone down, and a failed
 * or partial fan-out across projects produces the same zero as a real one.
 *
 * The hooks themselves are covered by their own suites. Here they are stand-ins
 * whose state each test sets directly, because the question under test is
 * purely which number this screen is willing to claim from a given hook state.
 * The `mock` prefix is what lets jest.mock's hoisted factories reach them.
 */

type CountsState = ReturnType<typeof useAllProjectCounts>;
type OnCallState = ReturnType<typeof useAllProjectOnCallPolicies>;

const mockCounts: { current: CountsState } = {
  current: {} as CountsState,
};

const mockOnCall: { current: OnCallState } = {
  current: {} as OnCallState,
};

const mockProjects: { current: ProjectItem[] } = { current: [] };

const mockProjectLoadError: { current: Error | null } = { current: null };

jest.mock("../hooks/useAllProjectCounts", () => {
  return {
    useAllProjectCounts: () => {
      return mockCounts.current;
    },
  };
});

jest.mock("../hooks/useAllProjectOnCallPolicies", () => {
  return {
    useAllProjectOnCallPolicies: () => {
      return mockOnCall.current;
    },
  };
});

jest.mock("../hooks/useProject", () => {
  return {
    useProject: () => {
      return {
        projectList: mockProjects.current,
        isLoadingProjects: false,
        projectLoadError: mockProjectLoadError.current,
        refreshProjects: async (): Promise<void> => {
          return undefined;
        },
      };
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

jest.mock("@react-navigation/native", () => {
  return {
    useNavigation: () => {
      return { navigate: jest.fn() };
    },
    useFocusEffect: () => {
      return undefined;
    },
  };
});

/*
 * The SSO banner is not what these tests are about, and it is driven by
 * storage rather than by a hook. A responder with nothing pending keeps it off
 * the screen entirely.
 */
jest.mock("../storage/ssoTokens", () => {
  return {
    getSsoTokens: async () => {
      return {};
    },
    getGlobalSsoToken: async () => {
      return null;
    },
  };
});

jest.mock("../sso/ssoDenials", () => {
  return {
    isProjectSsoDenied: () => {
      return false;
    },
  };
});

function countsWith(overrides: Partial<CountsState> = {}): CountsState {
  return {
    incidentCount: 0,
    alertCount: 0,
    incidentEpisodeCount: 0,
    alertEpisodeCount: 0,
    monitorCount: 0,
    disabledMonitorCount: 0,
    inoperationalMonitorCount: 0,
    isLoading: false,
    isError: false,
    refetch: jest.fn(async () => {
      return undefined;
    }) as unknown as () => Promise<void>,
    ...overrides,
  };
}

function onCallWith(overrides: Partial<OnCallState> = {}): OnCallState {
  return {
    projects: [],
    totalAssignments: 0,
    isLoading: false,
    isError: false,
    failedProjectCount: 0,
    isPartialFailure: false,
    refetch: jest.fn(async () => {
      return undefined;
    }) as unknown as () => Promise<void>,
    ...overrides,
  };
}

function makeOnCallProject(): ProjectOnCallAssignments {
  return {
    projectId: "project-1",
    projectName: "Acme Production",
    assignments: [
      {
        projectId: "project-1",
        projectName: "Acme Production",
        policyId: "policy-1",
        policyName: "Primary rotation",
        escalationRuleName: "Rule 1",
        assignmentType: "user",
        assignmentDetail: "You are directly assigned",
      },
      {
        projectId: "project-1",
        projectName: "Acme Production",
        policyId: "policy-2",
        policyName: "Database escalation",
        escalationRuleName: "Rule 1",
        assignmentType: "team",
        assignmentDetail: "Via the Database team",
      },
    ],
  };
}

/*
 * A settled, unambiguous on-call state for the tests that are about the count
 * cards. It puts a "2" in the on-call slot rather than a "0", so that any zero
 * these tests find on the screen can only have come from a stat card.
 */
function onCallOnDuty(): OnCallState {
  return onCallWith({
    projects: [makeOnCallProject()],
    totalAssignments: 2,
  });
}

describe("A stat card never claims a count it does not have", () => {
  beforeEach(() => {
    mockProjects.current = [makeProject()];
    mockProjectLoadError.current = null;
    mockCounts.current = countsWith();
    mockOnCall.current = onCallOnDuty();
  });

  test("the monitor cards show a placeholder while their counts are in flight", async () => {
    mockCounts.current = countsWith({ isLoading: true });

    await render(<HomeScreen />);

    await waitFor(() => {
      expect(
        screen.getByLabelText("Inoperational, not available yet. Tap to view."),
      ).toBeTruthy();
    });

    expect(
      screen.getByLabelText("Disabled, not available yet. Tap to view."),
    ).toBeTruthy();

    /*
     * Nowhere on the screen, not just not on those two cards: an unfetched
     * count has no business appearing as a number anywhere.
     */
    expect(screen.queryByText("0")).toBeNull();
  });

  test("a zero the account actually reported is printed as a zero", async () => {
    mockCounts.current = countsWith();

    await render(<HomeScreen />);

    await waitFor(() => {
      expect(
        screen.getByLabelText("0 Inoperational. Tap to view."),
      ).toBeTruthy();
    });

    expect(screen.getByLabelText("0 Disabled. Tap to view.")).toBeTruthy();
    expect(screen.queryByText("--")).toBeNull();
  });

  test("a count whose request failed is not printed as a zero", async () => {
    mockCounts.current = countsWith({ isError: true });

    await render(<HomeScreen />);

    await waitFor(() => {
      expect(
        screen.getByLabelText("Inoperational, not available yet. Tap to view."),
      ).toBeTruthy();
    });

    expect(
      screen.getByLabelText("Disabled, not available yet. Tap to view."),
    ).toBeTruthy();
    expect(screen.queryByText("0")).toBeNull();
  });

  test("a failure retires the counts that did come back too", async () => {
    /*
     * useAllProjectCounts reports one isError across seven requests and cannot
     * say which of them failed, so a screen that kept printing the numbers it
     * happens to hold would be presenting a mixture of fact and fallback with
     * no way for the responder to tell them apart.
     */
    mockCounts.current = countsWith({ incidentCount: 4, isError: true });

    await render(<HomeScreen />);

    await waitFor(() => {
      expect(
        screen.getByLabelText(
          "Active Incidents, not available yet. Tap to view.",
        ),
      ).toBeTruthy();
    });

    expect(screen.queryByText("4")).toBeNull();
  });

  test("the total across the top is withheld with the cards", async () => {
    /*
     * The headline number is a sum of four counts that are all still 0 by
     * fallback, which made it the most confident "nothing is happening" on the
     * screen. Seven cards plus the total is every number the counts feed.
     */
    mockCounts.current = countsWith({ isLoading: true });

    await render(<HomeScreen />);

    await waitFor(() => {
      expect(screen.getAllByText("--")).toHaveLength(8);
    });
  });

  test("real counts are still rendered once they land", async () => {
    mockCounts.current = countsWith({
      incidentCount: 1,
      alertCount: 2,
      incidentEpisodeCount: 3,
      alertEpisodeCount: 4,
      monitorCount: 12,
      disabledMonitorCount: 5,
      inoperationalMonitorCount: 6,
    });

    await render(<HomeScreen />);

    await waitFor(() => {
      expect(screen.getByText("12")).toBeTruthy();
    });

    expect(screen.getByLabelText("5 Disabled. Tap to view.")).toBeTruthy();
    expect(screen.getByLabelText("6 Inoperational. Tap to view.")).toBeTruthy();

    /* 1 + 2 + 3 + 4, the headline total. */
    expect(screen.getByText("10")).toBeTruthy();
    expect(screen.queryByText("--")).toBeNull();
  });
});

describe("The on-call card distinguishes not on call from could not ask", () => {
  beforeEach(() => {
    mockProjects.current = [makeProject()];
    mockProjectLoadError.current = null;
    mockCounts.current = countsWith();
    mockOnCall.current = onCallWith();
  });

  test("a complete answer of no duty is reported as not on call", async () => {
    mockOnCall.current = onCallWith();

    await render(<HomeScreen />);

    await waitFor(() => {
      expect(screen.getByText("You are not currently on-call")).toBeTruthy();
    });

    expect(screen.queryByText("--")).toBeNull();
  });

  test("nothing answering is not an all-clear", async () => {
    mockOnCall.current = onCallWith({ isError: true });

    await render(<HomeScreen />);

    await waitFor(() => {
      expect(
        screen.getByText(/Could not check your on-call status/i),
      ).toBeTruthy();
    });

    expect(screen.queryByText("You are not currently on-call")).toBeNull();

    /*
     * The counts are settled zeros in this test, so the only placeholder that
     * can be on the screen is the on-call card's own number.
     */
    expect(screen.getAllByText("--")).toHaveLength(1);
  });

  test("a partial answer that adds up to zero is not an all-clear either", async () => {
    /*
     * This is the dangerous half of a partial fan-out: the project that failed
     * to answer is exactly the one that could be holding the page, and every
     * project that did answer said no.
     */
    mockOnCall.current = onCallWith({
      failedProjectCount: 1,
      isPartialFailure: true,
    });

    await render(<HomeScreen />);

    await waitFor(() => {
      expect(screen.getByText(/Could not check every project/i)).toBeTruthy();
    });

    expect(screen.queryByText("You are not currently on-call")).toBeNull();
    expect(screen.getAllByText("--")).toHaveLength(1);
  });

  test("a partial answer with duty in it keeps its count and says it is incomplete", async () => {
    mockOnCall.current = onCallWith({
      projects: [makeOnCallProject()],
      totalAssignments: 2,
      failedProjectCount: 1,
      isPartialFailure: true,
    });

    await render(<HomeScreen />);

    await waitFor(() => {
      expect(
        screen.getByText(
          "2 active assignments across 1 project (some projects did not answer)",
        ),
      ).toBeTruthy();
    });

    /* "You are on call" is not made wrong by a project that did not reply. */
    expect(screen.getByText("2")).toBeTruthy();
  });

  test("a complete answer with duty in it carries no caveat", async () => {
    mockOnCall.current = onCallOnDuty();

    await render(<HomeScreen />);

    await waitFor(() => {
      expect(
        screen.getByText("2 active assignments across 1 project"),
      ).toBeTruthy();
    });
  });
});

describe("An empty project list says which kind of empty it is", () => {
  beforeEach(() => {
    mockProjects.current = [];
    mockProjectLoadError.current = null;
    mockCounts.current = countsWith();
    mockOnCall.current = onCallWith();
  });

  test("an account that really holds no projects gets the onboarding copy", async () => {
    await render(<HomeScreen />);

    await waitFor(() => {
      expect(screen.getByText("No Projects Found")).toBeTruthy();
    });

    expect(screen.getByText(/Contact your administrator/i)).toBeTruthy();
  });

  test("a project list that could not be fetched is not reported as no access", async () => {
    /*
     * The same empty array reaches this screen either way, and the old copy
     * sent a responder whose request had simply failed off to their
     * administrator for access they already have - while every incident they
     * are responsible for stayed invisible.
     */
    mockProjectLoadError.current = new Error("Network request failed");

    await render(<HomeScreen />);

    await waitFor(() => {
      expect(screen.getByText("Could Not Load Projects")).toBeTruthy();
    });

    expect(screen.queryByText("No Projects Found")).toBeNull();
    expect(screen.queryByText(/Contact your administrator/i)).toBeNull();
    expect(screen.getByText(/not the same as you having none/i)).toBeTruthy();
  });
});
