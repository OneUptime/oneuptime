import React from "react";
import { Alert, StyleSheet } from "react-native";
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react-native";
import { beforeEach, afterEach, describe, expect, test } from "@jest/globals";
import OnCallOverridesScreen from "./OnCallOverridesScreen";
import { lightColors } from "../theme/colors";
import { radius } from "../theme/tokens";
import type { OnCallOverrideItem } from "../api/types";
import type { UseOnCallOverridesResult } from "../hooks/useOnCallOverrides";
import type { OverrideTeamPeopleState } from "../hooks/useOverrideTeamPeople";
import {
  clearAllProjectPermissions,
  recordProjectPermissions,
} from "../api/projectPermissions";
import {
  OVERRIDE_TEAM_DELETE_REFUSAL,
  OVERRIDE_TEAM_EDIT_REFUSAL,
} from "../oncall/overrideTeamAccess";

const mockNavigate: jest.Mock = jest.fn();
const mockCancel: jest.Mock = jest.fn();
const mockEndNow: jest.Mock = jest.fn();
const mockRefetch: jest.Mock = jest.fn();
const mockOverrides: { current: UseOnCallOverridesResult } = {
  current: {} as UseOnCallOverridesResult,
};
jest.mock("@react-navigation/native", () => {
  return {
    useNavigation: () => {
      return { navigate: mockNavigate };
    },
  };
});
jest.mock("../hooks/useOnCallOverrides", () => {
  return {
    useOnCallOverrides: () => {
      return mockOverrides.current;
    },
  };
});
jest.mock("../hooks/useCurrentUserId", () => {
  return {
    useCurrentUserId: () => {
      return "me";
    },
  };
});
jest.mock("../hooks/useNow", () => {
  return {
    useNow: () => {
      return new Date("2026-09-10T09:00:00Z").getTime();
    },
  };
});
jest.mock("../hooks/useHaptics", () => {
  return {
    useHaptics: () => {
      return {
        lightImpact: jest.fn(),
        successFeedback: jest.fn(),
        errorFeedback: jest.fn(),
      };
    },
  };
});

// The project the list is of: none, as outside a ProjectProvider, unless a test says.
const mockSelectedProjectId: { current: string | null } = { current: null };

jest.mock("../hooks/useProject", () => {
  return {
    useSelectedProjectId: (): string | null => {
      return mockSelectedProjectId.current;
    },
  };
});

/*
 * The people of the teams the list's locks are kept to
 * (useOverrideTeamPeople): what a test says, and what each render asked
 * for. Asked with no teams, nothing is known, as the hook answers.
 */
const mockTeamPeople: { current: OverrideTeamPeopleState | null } = {
  current: null,
};
const mockTeamPeopleAsked: Array<{
  projectId: string | null;
  teamIds: ReadonlyArray<string> | null;
}> = [];

jest.mock("../hooks/useOverrideTeamPeople", () => {
  return {
    useOverrideTeamPeople: (data: {
      projectId: string | null;
      teamIds: ReadonlyArray<string> | null;
    }): OverrideTeamPeopleState => {
      mockTeamPeopleAsked.push(data);

      if (data.teamIds && mockTeamPeople.current) {
        return mockTeamPeople.current;
      }

      return {
        users: [],
        membersByTeam: null,
        teamNames: null,
        isLoading: false,
        isError: false,
        refetch: async (): Promise<void> => {
          return undefined;
        },
      };
    },
  };
});

function override(id: string): OnCallOverrideItem {
  return {
    _id: id,
    projectId: "production",
    projectName: "Production",
    overrideUser: { _id: "me", name: "Sam" },
    routeAlertsToUser: { _id: "priya", name: "Priya" },
    onCallDutyPolicy: null,
    startsAt: "2026-09-10T08:00:00Z",
    endsAt: "2026-09-10T16:00:00Z",
    createdAt: "2026-09-10T07:00:00Z",
  };
}

describe("Coverage management", () => {
  let alertSpy: jest.SpyInstance;
  beforeEach(() => {
    mockNavigate.mockReset();
    mockCancel.mockReset();
    mockEndNow.mockReset();
    mockRefetch.mockReset();
    mockOverrides.current = {
      active: [],
      upcoming: [],
      past: [],
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
      cancelOverride: mockCancel,
      isCancelling: false,
      createOverride: jest.fn(),
      isCreating: false,
      updateOverride: jest.fn(),
      isUpdating: false,
      endOverrideNow: mockEndNow,
      isEnding: false,
    };
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {
      return undefined;
    });
  });
  afterEach(() => {
    alertSpy.mockRestore();
  });

  test("makes arranging cover available when no overrides exist", async (): Promise<void> => {
    await render(<OnCallOverridesScreen />);
    expect(screen.getByText(/No overrides yet/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("new-override"));
    expect(mockNavigate).toHaveBeenCalledWith("CreateOnCallOverride");
    expect(
      screen.getByTestId("overrides-scroll").props.contentContainerStyle
        .paddingBottom,
    ).toBeGreaterThanOrEqual(124);
  });

  /*
   * #7897: every arrangement that has not ended can be edited; one in force
   * is ended with End now, one to come is called off with Cancel; one that
   * has ended has neither.
   */
  test("separates active, upcoming and ended cover: Edit on live arrangements, End now on the one in force, Cancel on the one to come", async (): Promise<void> => {
    mockOverrides.current.active = [override("active")];
    mockOverrides.current.upcoming = [override("upcoming")];
    mockOverrides.current.past = [override("past")];
    await render(<OnCallOverridesScreen />);
    expect(screen.getByTestId("coverage-counts")).toBeTruthy();
    expect(screen.getByTestId("override-edit-active")).toBeTruthy();
    expect(screen.getByTestId("override-edit-upcoming")).toBeTruthy();
    expect(screen.queryByTestId("override-edit-past")).toBeNull();
    expect(screen.getByTestId("override-end-now-active")).toBeTruthy();
    expect(screen.queryByTestId("override-end-now-upcoming")).toBeNull();
    expect(screen.queryByTestId("override-cancel-active")).toBeNull();
    expect(screen.getByTestId("override-cancel-upcoming")).toBeTruthy();
    expect(screen.queryByTestId("override-cancel-past")).toBeNull();
    expect(screen.getAllByText("Your pages go to Priya")).toHaveLength(3);
  });

  test("Edit opens the edit sheet on the exact arrangement", async (): Promise<void> => {
    const upcoming: OnCallOverrideItem = override("upcoming");
    mockOverrides.current.upcoming = [upcoming];
    await render(<OnCallOverridesScreen />);
    await fireEvent.press(screen.getByTestId("override-edit-upcoming"));
    expect(mockNavigate).toHaveBeenCalledWith("EditOnCallOverride", {
      override: upcoming,
    });
  });

  test("End now asks first, saying who stops covering, what is left and who is paged again, then ends the exact arrangement", async (): Promise<void> => {
    const active: OnCallOverrideItem = override("active");
    mockOverrides.current.active = [active];
    await render(<OnCallOverridesScreen />);
    await fireEvent.press(screen.getByTestId("override-end-now-active"));
    expect(mockEndNow).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      "End this override now?",
      expect.stringMatching(
        /^Priya stops covering for you now instead of .+\. From then on, your pages come to you again\.$/,
      ),
      expect.any(Array),
    );
    const buttons: Array<{
      text: string;
      style?: string;
      onPress?: () => void;
    }> = alertSpy.mock.calls[0]![2];
    expect(
      buttons.find((button: { text: string; style?: string }) => {
        return button.text === "Keep it";
      })?.style,
    ).toBe("cancel");
    buttons
      .find((button: { text: string; style?: string }) => {
        return button.style === "destructive";
      })
      ?.onPress?.();
    await waitFor(() => {
      expect(mockEndNow).toHaveBeenCalledWith(active);
    });
  });

  test("an End now refusal is said whole, and the arrangement stays", async (): Promise<void> => {
    mockOverrides.current.active = [override("active")];
    mockEndNow.mockImplementation(async () => {
      throw new Error(
        "This override has already ended, so it can't be changed. Add a new override instead.",
      );
    });
    await render(<OnCallOverridesScreen />);
    await fireEvent.press(screen.getByTestId("override-end-now-active"));
    const buttons: Array<{ style?: string; onPress?: () => void }> =
      alertSpy.mock.calls[0]![2];
    buttons
      .find((button: { style?: string }) => {
        return button.style === "destructive";
      })
      ?.onPress?.();
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        "Could not end override",
        "This override has already ended, so it can't be changed. Add a new override instead.",
      );
    });
    expect(screen.getByTestId("override-card-active")).toBeTruthy();
  });

  test("requires explicit destructive confirmation before cancelling the exact arrangement", async (): Promise<void> => {
    const upcoming: OnCallOverrideItem = override("upcoming");
    mockOverrides.current.upcoming = [upcoming];
    await render(<OnCallOverridesScreen />);
    await fireEvent.press(screen.getByTestId("override-cancel-upcoming"));
    expect(mockCancel).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      "Cancel this override?",
      "Pages will go back to whoever the schedule says is on call.",
      expect.any(Array),
    );
    const buttons: Array<{
      text: string;
      style?: string;
      onPress?: () => void;
    }> = alertSpy.mock.calls[0]![2];
    expect(
      buttons.find(
        (button: { text: string; style?: string; onPress?: () => void }) => {
          return button.text === "Keep it";
        },
      )?.style,
    ).toBe("cancel");
    const confirm:
      | { text: string; style?: string; onPress?: () => void }
      | undefined = buttons.find(
      (button: { text: string; style?: string; onPress?: () => void }) => {
        return button.style === "destructive";
      },
    );
    confirm?.onPress?.();
    await waitFor(() => {
      expect(mockCancel).toHaveBeenCalledWith(upcoming);
    });
  });

  test("shows a cancellation refusal and keeps the coverage visible", async (): Promise<void> => {
    mockOverrides.current.upcoming = [override("upcoming")];
    mockCancel.mockImplementation(async () => {
      throw new Error("Coverage cannot be changed");
    });
    await render(<OnCallOverridesScreen />);
    await fireEvent.press(screen.getByTestId("override-cancel-upcoming"));
    const buttons: Array<{ style?: string; onPress?: () => void }> =
      alertSpy.mock.calls[0]![2];
    buttons
      .find((button: { style?: string; onPress?: () => void }) => {
        return button.style === "destructive";
      })
      ?.onPress?.();
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        "Could not cancel override",
        "Coverage cannot be changed",
      );
    });
    expect(screen.getByTestId("override-card-upcoming")).toBeTruthy();
  });

  test("offers retry when coverage cannot be loaded", async (): Promise<void> => {
    mockOverrides.current.isError = true;
    await render(<OnCallOverridesScreen />);
    expect(screen.queryByText(/No overrides yet/)).toBeNull();
    await fireEvent.press(screen.getByText("Retry"));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  test("does not show an empty coverage claim during loading", async (): Promise<void> => {
    mockOverrides.current.isLoading = true;
    await render(<OnCallOverridesScreen />);
    expect(screen.queryByText(/No overrides yet/)).toBeNull();
    expect(screen.queryByTestId("coverage-counts")).toBeNull();
  });
});

describe("Refresh recovery", () => {
  test.each([false, true])(
    "keeps refresh available and visible while pending (error: %s)",
    async (isError: boolean) => {
      let finish: () => void = (): void => {};
      const refresh: jest.Mock = jest.fn(() => {
        return new Promise<void>((resolve: () => void) => {
          finish = resolve;
        });
      });
      mockOverrides.current = {
        active: [],
        upcoming: [],
        past: [],
        isLoading: false,
        isError,
        refetch: refresh,
        cancelOverride: jest.fn(),
        isCancelling: false,
        createOverride: jest.fn(),
        isCreating: false,
        updateOverride: jest.fn(),
        isUpdating: false,
        endOverrideNow: jest.fn(),
        isEnding: false,
      };
      await render(<OnCallOverridesScreen />);
      expect(screen.getByText("Coverage")).toBeTruthy();
      let request: Promise<void>;
      await act(() => {
        request = screen
          .getByTestId("overrides-scroll")
          .props.refreshControl.props.onRefresh();
      });
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(
        screen.getByTestId("overrides-scroll").props.refreshControl.props
          .refreshing,
      ).toBe(true);
      await act(async () => {
        finish();
        await request;
      });
      expect(
        screen.getByTestId("overrides-scroll").props.refreshControl.props
          .refreshing,
      ).toBe(false);
    },
  );
});

describe("Coverage layout", () => {
  let alertSpy: jest.SpyInstance;
  beforeEach(() => {
    mockNavigate.mockReset();
    mockCancel.mockReset();
    mockRefetch.mockReset();
    mockOverrides.current = {
      active: [],
      upcoming: [],
      past: [],
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
      cancelOverride: mockCancel,
      isCancelling: false,
      createOverride: jest.fn(),
      isCreating: false,
      updateOverride: jest.fn(),
      isUpdating: false,
      endOverrideNow: mockEndNow,
      isEnding: false,
    };
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {
      return undefined;
    });
  });
  afterEach(() => {
    alertSpy.mockRestore();
  });

  test("stat tiles count what is live and what is scheduled, on card surfaces", async (): Promise<void> => {
    mockOverrides.current.active = [override("a1"), override("a2")];
    mockOverrides.current.upcoming = [override("u1")];
    mockOverrides.current.past = [override("p1")];

    await render(<OnCallOverridesScreen />);

    const active: HostElement = screen.getByTestId("coverage-count-active");
    expect(within(active).getByText("2")).toBeTruthy();
    expect(within(active).getByText("Active now")).toBeTruthy();
    expect(active.props.accessibilityLabel).toBe("2 active now");
    const upcoming: HostElement = screen.getByTestId("coverage-count-upcoming");
    expect(within(upcoming).getByText("1")).toBeTruthy();
    expect(upcoming.props.accessibilityLabel).toBe("1 scheduled");

    for (const testID of ["coverage-count-active", "coverage-count-upcoming"]) {
      const style: Record<string, unknown> = flatStyle(testID);
      expect(style.backgroundColor).toBe(lightColors.backgroundElevated);
      expect(style.borderRadius).toBe(radius.lg);
    }
  });

  test("the primary action stays the one filled button", async (): Promise<void> => {
    await render(<OnCallOverridesScreen />);

    expect(flatStyle("new-override").backgroundColor).toBe(
      lightColors.actionPrimary,
    );
    expect(
      screen.getByRole("button", { name: "Arrange coverage" }),
    ).toBeTruthy();
  });

  test("with nothing arranged, an outlined card explains overrides", async (): Promise<void> => {
    await render(<OnCallOverridesScreen />);

    const empty: HostElement = screen.getByTestId("overrides-empty");
    expect(within(empty).getByText("No overrides yet")).toBeTruthy();
    expect(flatStyle("overrides-empty").borderRadius).toBe(radius.lg);
    expect(screen.queryByTestId("coverage-counts")).toBeNull();
  });

  test("sections run live, scheduled, ended and each shows its count", async (): Promise<void> => {
    mockOverrides.current.active = [override("a1")];
    mockOverrides.current.upcoming = [override("u1"), override("u2")];
    mockOverrides.current.past = [override("p1")];

    await render(<OnCallOverridesScreen />);

    expect(
      screen.getAllByTestId(/^overrides-section-/).map((node: HostElement) => {
        return node.props.testID;
      }),
    ).toEqual([
      "overrides-section-active",
      "overrides-section-upcoming",
      "overrides-section-past",
    ]);
    expect(
      within(screen.getByTestId("overrides-section-upcoming")).getByText("2"),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("overrides-section-past")).queryByText(
        "Cancel override",
      ),
    ).toBeNull();
  });

  test("keeping the override does nothing; confirming shows progress on that card only", async (): Promise<void> => {
    let finishCancel: () => void = (): void => {};
    mockCancel.mockImplementation(() => {
      return new Promise<void>((resolve: () => void) => {
        finishCancel = resolve;
      });
    });
    mockOverrides.current.upcoming = [override("first"), override("second")];

    await render(<OnCallOverridesScreen />);

    await fireEvent.press(screen.getByTestId("override-cancel-first"));
    const buttons: Array<{
      text: string;
      style?: string;
      onPress?: () => void;
    }> = alertSpy.mock.calls[0]![2];
    buttons
      .find((button: { text: string }) => {
        return button.text === "Keep it";
      })
      ?.onPress?.();
    expect(mockCancel).not.toHaveBeenCalled();

    await act(async () => {
      buttons
        .find((button: { style?: string }) => {
          return button.style === "destructive";
        })
        ?.onPress?.();
    });

    expect(
      screen.getByTestId("override-cancel-first").props.accessibilityState,
    ).toEqual({ disabled: true, busy: true });
    expect(
      screen.getByTestId("override-cancel-second").props.accessibilityState,
    ).toEqual({ disabled: false, busy: false });

    await act(async () => {
      finishCancel();
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("override-cancel-first").props.accessibilityState,
      ).toEqual({ disabled: false, busy: false });
    });
  });
});

type HostElement = ReturnType<typeof screen.getByTestId>;

function flatStyle(testID: string): Record<string, unknown> {
  return (StyleSheet.flatten(screen.getByTestId(testID).props.style) ??
    {}) as Record<string, unknown>;
}

/*
 * #9883: for someone who manages the user overrides of their own teams'
 * people only (Manage On-Call Policy User Overrides for Own Team), the
 * server refuses any change to an override that names anybody outside
 * those teams. So such an override's card says why in place of Edit, End
 * now and Cancel, in the server's words, as the Dashboard locks them, and
 * an override of the team's people keeps them.
 */
describe("Coverage for someone who manages their own team's overrides", () => {
  const PROJECT: string = "production";
  const TEAM_PAYMENTS: string = "team-payments";
  const TEAM_MOBILE: string = "team-mobile";

  // Sam (signed in) and Priya are in Payments; Omar is in no team of Sam's.
  const PAYMENTS_PEOPLE: OverrideTeamPeopleState = {
    users: [],
    membersByTeam: new Map<string, Set<string>>([
      [TEAM_PAYMENTS, new Set<string>(["me", "priya"])],
    ]),
    teamNames: ["Payments"],
    isLoading: false,
    isError: false,
    refetch: async (): Promise<void> => {
      return undefined;
    },
  };

  function row(
    permission: string,
    data: { teamId?: string; scope?: string; labelIds?: Array<unknown> } = {},
  ): Record<string, unknown> {
    return {
      _type: "UserPermission",
      permission: permission,
      labelIds: data.labelIds ?? [],
      scope: data.scope ?? "All",
      isBlockPermission: false,
      ...(data.teamId
        ? { teamId: { _type: "ObjectID", value: data.teamId } }
        : {}),
    };
  }

  const TEAM_SCOPED: Array<Record<string, unknown>> = [
    row("OnCallViewer"),
    row("ManageTeamOnCallDutyPolicyUserOverride", { teamId: TEAM_PAYMENTS }),
  ];

  function holding(rows: Array<Record<string, unknown>>): void {
    recordProjectPermissions(PROJECT, {
      "project-permissions": JSON.stringify({
        _type: "UserTenantAccessPermission",
        projectId: { _type: "ObjectID", value: PROJECT },
        permissions: rows,
      }),
    });
  }

  // Sam covered by Omar, who is in no team of Sam's.
  function outsiders(id: string): OnCallOverrideItem {
    return {
      ...override(id),
      routeAlertsToUser: { _id: "omar", name: "Omar" },
    };
  }

  function lastTeamPeopleAsked(): (typeof mockTeamPeopleAsked)[number] {
    return mockTeamPeopleAsked[mockTeamPeopleAsked.length - 1]!;
  }

  function lockedLine(id: string): string {
    return within(screen.getByTestId(`override-locked-${id}`)).getByText(
      /user override/,
    ).props.children as string;
  }

  beforeEach(() => {
    clearAllProjectPermissions();
    mockSelectedProjectId.current = PROJECT;
    mockTeamPeople.current = PAYMENTS_PEOPLE;
    mockTeamPeopleAsked.length = 0;
    mockNavigate.mockReset();
    mockCancel.mockReset();
    mockEndNow.mockReset();
    mockOverrides.current = {
      active: [],
      upcoming: [],
      past: [],
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
      cancelOverride: mockCancel,
      isCancelling: false,
      createOverride: jest.fn(),
      isCreating: false,
      updateOverride: jest.fn(),
      isUpdating: false,
      endOverrideNow: mockEndNow,
      isEnding: false,
    };
  });

  afterEach(() => {
    clearAllProjectPermissions();
    mockSelectedProjectId.current = null;
    mockTeamPeople.current = null;
  });

  test("one in force naming somebody outside the teams says why in place of Edit and End now", async (): Promise<void> => {
    holding(TEAM_SCOPED);
    mockOverrides.current.active = [outsiders("active")];

    await render(<OnCallOverridesScreen />);

    expect(screen.queryByTestId("override-edit-active")).toBeNull();
    expect(screen.queryByTestId("override-end-now-active")).toBeNull();
    expect(lockedLine("active")).toBe(OVERRIDE_TEAM_EDIT_REFUSAL);
  });

  test("one to come naming somebody outside the teams says why in place of Edit and Cancel, once", async (): Promise<void> => {
    holding(TEAM_SCOPED);
    mockOverrides.current.upcoming = [
      {
        ...override("upcoming"),
        overrideUser: { _id: "omar", name: "Omar" },
        routeAlertsToUser: null,
      },
    ];

    await render(<OnCallOverridesScreen />);

    expect(screen.queryByTestId("override-edit-upcoming")).toBeNull();
    expect(screen.queryByTestId("override-cancel-upcoming")).toBeNull();
    expect(lockedLine("upcoming")).toBe(OVERRIDE_TEAM_EDIT_REFUSAL);
    expect(screen.queryByText(OVERRIDE_TEAM_DELETE_REFUSAL)).toBeNull();
  });

  test("one of the team's people keeps Edit, End now and Cancel, with nothing locked", async (): Promise<void> => {
    holding(TEAM_SCOPED);
    mockOverrides.current.active = [override("active")];
    mockOverrides.current.upcoming = [override("upcoming")];

    await render(<OnCallOverridesScreen />);

    expect(screen.getByTestId("override-edit-active")).toBeTruthy();
    expect(screen.getByTestId("override-end-now-active")).toBeTruthy();
    expect(screen.getByTestId("override-cancel-upcoming")).toBeTruthy();
    expect(screen.queryByTestId("override-locked-active")).toBeNull();
    expect(screen.queryByTestId("override-locked-upcoming")).toBeNull();

    await fireEvent.press(screen.getByTestId("override-edit-upcoming"));

    expect(mockNavigate).toHaveBeenCalledWith("EditOnCallOverride", {
      override: mockOverrides.current.upcoming[0],
    });
  });

  test("an edit permission that reaches everyone keeps Edit; Cancel alone is locked, with the words for a delete", async (): Promise<void> => {
    holding([...TEAM_SCOPED, row("EditOnCallDutyPolicyUserOverride")]);
    mockOverrides.current.upcoming = [outsiders("upcoming")];

    await render(<OnCallOverridesScreen />);

    expect(screen.getByTestId("override-edit-upcoming")).toBeTruthy();
    expect(screen.queryByTestId("override-cancel-upcoming")).toBeNull();
    expect(lockedLine("upcoming")).toBe(OVERRIDE_TEAM_DELETE_REFUSAL);
  });

  test("the teams' people are asked for once, for every team the locks are kept to", async (): Promise<void> => {
    holding([
      ...TEAM_SCOPED,
      row("ManageTeamOnCallDutyPolicyUserOverride", { teamId: TEAM_MOBILE }),
    ]);
    mockOverrides.current.active = [override("active")];

    await render(<OnCallOverridesScreen />);

    expect(lastTeamPeopleAsked()).toEqual({
      projectId: PROJECT,
      teamIds: [TEAM_MOBILE, TEAM_PAYMENTS],
    });
  });

  test("a global override keeps to the teams over the whole project; a policy's beside a narrower role is the server's to weigh", async (): Promise<void> => {
    holding([
      ...TEAM_SCOPED,
      row("OnCallMember", {
        scope: "Labels",
        labelIds: [{ _type: "ObjectID", value: "label-team-a" }],
      }),
    ]);
    mockOverrides.current.upcoming = [
      outsiders("global"),
      {
        ...outsiders("on-policy"),
        onCallDutyPolicyId: "policy-1",
        onCallDutyPolicy: { _id: "policy-1", name: "Payments Primary" },
      },
    ];

    await render(<OnCallOverridesScreen />);

    expect(lockedLine("global")).toBe(OVERRIDE_TEAM_EDIT_REFUSAL);
    expect(screen.queryByTestId("override-locked-on-policy")).toBeNull();
    expect(screen.getByTestId("override-edit-on-policy")).toBeTruthy();
    expect(screen.getByTestId("override-cancel-on-policy")).toBeTruthy();
  });

  test("while who is in the teams is not known, nothing is locked: the server decides", async (): Promise<void> => {
    holding(TEAM_SCOPED);
    mockTeamPeople.current = { ...PAYMENTS_PEOPLE, membersByTeam: null };
    mockOverrides.current.active = [outsiders("active")];

    await render(<OnCallOverridesScreen />);

    expect(screen.getByTestId("override-edit-active")).toBeTruthy();
    expect(screen.getByTestId("override-end-now-active")).toBeTruthy();
    expect(screen.queryByTestId("override-locked-active")).toBeNull();
  });

  test("an ended override has nothing to lock", async (): Promise<void> => {
    holding(TEAM_SCOPED);
    mockOverrides.current.past = [outsiders("past")];

    await render(<OnCallOverridesScreen />);

    expect(screen.queryByTestId("override-locked-past")).toBeNull();
    // Nothing to change is shown, so nobody is read for it.
    expect(lastTeamPeopleAsked().teamIds).toBeNull();
  });

  test("a permission that reaches everyone: every action as before, and no team read", async (): Promise<void> => {
    holding([row("OnCallMember"), ...TEAM_SCOPED]);
    mockOverrides.current.active = [outsiders("active")];
    mockOverrides.current.upcoming = [outsiders("upcoming")];

    await render(<OnCallOverridesScreen />);

    expect(screen.getByTestId("override-edit-active")).toBeTruthy();
    expect(screen.getByTestId("override-end-now-active")).toBeTruthy();
    expect(screen.getByTestId("override-cancel-upcoming")).toBeTruthy();
    expect(screen.queryByTestId("override-locked-active")).toBeNull();
    expect(lastTeamPeopleAsked().teamIds).toBeNull();
  });

  test("before the server has said anything, every action as before", async (): Promise<void> => {
    mockOverrides.current.active = [outsiders("active")];

    await render(<OnCallOverridesScreen />);

    expect(screen.getByTestId("override-edit-active")).toBeTruthy();
    expect(screen.queryByTestId("override-locked-active")).toBeNull();
    expect(lastTeamPeopleAsked().teamIds).toBeNull();
  });

  test("the locks follow the rows as an answer about the project brings them", async (): Promise<void> => {
    mockOverrides.current.active = [outsiders("active")];

    await render(<OnCallOverridesScreen />);

    expect(screen.getByTestId("override-edit-active")).toBeTruthy();

    await act(async (): Promise<void> => {
      holding(TEAM_SCOPED);
    });

    expect(screen.queryByTestId("override-edit-active")).toBeNull();
    expect(lockedLine("active")).toBe(OVERRIDE_TEAM_EDIT_REFUSAL);
  });
});
