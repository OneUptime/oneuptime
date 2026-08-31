import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import { describe, expect, test, beforeEach } from "@jest/globals";
import MyOnCallPoliciesScreen from "./MyOnCallPoliciesScreen";
import type { ProjectOnCallAssignments } from "../api/types";

/*
 * This screen is the answer to the only question the app exists to answer:
 * am I on call right now? It has exactly one way to get that wrong that
 * matters, and it is not a crash - it is stating "Not currently on-call" when
 * the truth is that nobody managed to ask. A responder who reads that sentence
 * stops watching their phone.
 *
 * So the outcomes asserted here are the three the hook can now tell apart:
 * on duty, genuinely not on duty, and could not establish. The last one has
 * two shapes - every project failed, and enough of them failed that the empty
 * list is meaningless - and both have to reach the same honest screen.
 *
 * The hook is faked rather than the network, because what is under test is
 * which of those states the screen renders, not how the hook arrives at them;
 * useAllProjectOnCallPolicies.test.tsx owns that half. The `mock` prefix is
 * what lets jest.mock's hoisted factory reach the holder.
 */

type OnCallPoliciesResult = ReturnType<
  typeof import("../hooks/useAllProjectOnCallPolicies").useAllProjectOnCallPolicies
>;

const mockOnCallPolicies: { current: OnCallPoliciesResult } = {
  current: {} as OnCallPoliciesResult,
};

jest.mock("../hooks/useAllProjectOnCallPolicies", () => {
  return {
    useAllProjectOnCallPolicies: () => {
      return mockOnCallPolicies.current;
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

function makeProjectAssignments(
  overrides: Partial<ProjectOnCallAssignments> = {},
): ProjectOnCallAssignments {
  return {
    projectId: "project-1",
    projectName: "Acme Production",
    assignments: [
      {
        projectId: "project-1",
        projectName: "Acme Production",
        policyId: "policy-1",
        policyName: "Database Escalation",
        escalationRuleName: "First responders",
        assignmentType: "user",
        assignmentDetail: "You are directly assigned",
      },
    ],
    ...overrides,
  };
}

function resultWith(
  overrides: Partial<OnCallPoliciesResult> = {},
): OnCallPoliciesResult {
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

describe("When the responder is on duty", () => {
  beforeEach(() => {
    mockOnCallPolicies.current = resultWith({
      projects: [makeProjectAssignments()],
      totalAssignments: 1,
    });
  });

  test("the assignment it found is on screen", async () => {
    await render(<MyOnCallPoliciesScreen />);

    await waitFor(() => {
      expect(screen.getByText("Database Escalation")).toBeTruthy();
      expect(screen.getByText("Acme Production")).toBeTruthy();
    });
  });

  test("the summary counts what was found", async () => {
    await render(<MyOnCallPoliciesScreen />);

    await waitFor(() => {
      expect(
        screen.getByText(/on duty for 1 assignment across 1 project\./i),
      ).toBeTruthy();
    });
  });

  test("nothing suggests the responder is off duty", async () => {
    await render(<MyOnCallPoliciesScreen />);

    await waitFor(() => {
      expect(screen.queryByText("Not currently on-call")).toBeNull();
      expect(screen.queryByText("Something went wrong")).toBeNull();
    });
  });
});

describe("When the responder is genuinely not on duty", () => {
  beforeEach(() => {
    mockOnCallPolicies.current = resultWith();
  });

  test("the screen says so", async () => {
    await render(<MyOnCallPoliciesScreen />);

    await waitFor(() => {
      expect(screen.getByText("Not currently on-call")).toBeTruthy();
    });
  });

  test("it does not also say it in numbers", async () => {
    /*
     * The summary line used to render directly above the empty state, so the
     * screen made the same statement twice - the second time as "on duty for
     * 0 assignments across 0 projects", which is a sentence no responder
     * should have to parse.
     */
    await render(<MyOnCallPoliciesScreen />);

    await waitFor(() => {
      expect(screen.queryByText(/on duty for 0 assignments/i)).toBeNull();
    });
  });
});

describe("When the answer could not be established", () => {
  test("a total failure is not dressed up as being off duty", async () => {
    mockOnCallPolicies.current = resultWith({ isError: true });

    await render(<MyOnCallPoliciesScreen />);

    await waitFor(() => {
      expect(screen.getByText("Something went wrong")).toBeTruthy();
      expect(screen.getByText(/not the same as being off duty/i)).toBeTruthy();
      expect(screen.queryByText("Not currently on-call")).toBeNull();
    });
  });

  test("neither is a partial failure that left nothing to show", async () => {
    /*
     * The projects that answered hold no duty, and the projects that could
     * have held some are exactly the ones that did not answer. An empty list
     * here is the absence of an answer, not an answer of "no".
     */
    mockOnCallPolicies.current = resultWith({
      failedProjectCount: 2,
      isPartialFailure: true,
    });

    await render(<MyOnCallPoliciesScreen />);

    await waitFor(() => {
      expect(screen.getByText("Something went wrong")).toBeTruthy();
      expect(screen.queryByText("Not currently on-call")).toBeNull();
    });
  });

  test("there is a way to ask again", async () => {
    const refetch: jest.Mock = jest.fn(async () => {
      return undefined;
    });

    mockOnCallPolicies.current = resultWith({
      isError: true,
      refetch: refetch as unknown as () => Promise<void>,
    });

    await render(<MyOnCallPoliciesScreen />);

    const retry: unknown = await waitFor(() => {
      return screen.getByRole("button", { name: "Retry" });
    });

    fireEvent.press(retry as never);

    await waitFor(() => {
      expect(refetch).toHaveBeenCalled();
    });
  });

  test("a partial failure that still found duty keeps the duty and admits the gap", async () => {
    /*
     * The opposite mistake to the one above: hiding real assignments behind
     * an error page would page nobody. What the screen owes here is both -
     * the duty it did find, and the fact that the list is not complete.
     */
    mockOnCallPolicies.current = resultWith({
      projects: [makeProjectAssignments()],
      totalAssignments: 1,
      failedProjectCount: 1,
      isPartialFailure: true,
    });

    await render(<MyOnCallPoliciesScreen />);

    await waitFor(() => {
      expect(screen.getByText("Database Escalation")).toBeTruthy();
      expect(
        screen.getByText(
          /1 project did not answer, so this list may be incomplete\./i,
        ),
      ).toBeTruthy();
    });
  });
});

describe("While the answer is still being fetched", () => {
  test("no verdict is shown either way", async () => {
    mockOnCallPolicies.current = resultWith({ isLoading: true });

    await render(<MyOnCallPoliciesScreen />);

    await waitFor(() => {
      expect(screen.queryByText("Not currently on-call")).toBeNull();
      expect(screen.queryByText("Something went wrong")).toBeNull();
    });
  });
});
