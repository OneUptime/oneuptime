import React from "react";
import { StyleSheet } from "react-native";
import {
  act,
  render,
  screen,
  fireEvent,
  within,
} from "@testing-library/react-native";
import {
  describe,
  expect,
  test,
  afterEach,
  beforeEach,
  jest as jestGlobal,
} from "@jest/globals";
import CreateOnCallOverrideScreen, {
  readPrefilledWindow,
} from "./CreateOnCallOverrideScreen";
import {
  clearAllProjectPermissions,
  recordProjectPermissions,
} from "../api/projectPermissions";
import {
  GLOBAL_OVERRIDE_LIMITED_REASON,
  GLOBAL_OVERRIDE_NOT_ALLOWED_REASON,
} from "../oncall/globalOverrideAccess";
import * as keychain from "../storage/keychain";
import { ThemeProvider } from "../theme";
import { darkColors, lightColors } from "../theme/colors";
import { getScreenBottomPadding } from "../theme/layout";
import { radius } from "../theme/tokens";
import type { CreateOverrideInput } from "../hooks/useOnCallOverrides";
import type { CoverPoliciesState } from "../hooks/useCoverPolicies";
import type { CoverPolicy } from "../api/onCallOverrides";
import type { CreateOnCallOverrideParams } from "../navigation/types";
import type { ProjectItem, ProjectUserItem } from "../api/types";

/*
 * The only screen in the app that changes who gets woken up.
 *
 * Two failures here are unrecoverable from the user's side, and both are
 * silent: creating the override with the two people the WRONG WAY ROUND, and
 * appearing to succeed when the request was never sent. Everything below
 * exists to pin those down - the assertions are on the exact ids handed to the
 * API layer, never on a summary string.
 */

let mockColorScheme: "light" | "dark" = "light";

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => {
  return {
    __esModule: true,
    default: (): "light" | "dark" => {
      return mockColorScheme;
    },
  };
});

const ME: string = "user-me";
const TEAMMATE: string = "user-teammate";

const PROJECTS: ProjectItem[] = [
  { _id: "project-1", name: "Acme", slug: "acme" } as ProjectItem,
  { _id: "project-2", name: "Globex", slug: "globex" } as ProjectItem,
];

const USERS: ProjectUserItem[] = [
  { userId: ME, name: "Ada Lovelace", email: "ada@example.com" },
  { userId: TEAMMATE, name: "Priya Rao", email: "priya@example.com" },
];

const mockCreateOverride: jest.Mock = jestGlobal.fn(
  async (_input: CreateOverrideInput): Promise<void> => {
    return undefined;
  },
) as unknown as jest.Mock;

const mockGoBack: jest.Mock = jestGlobal.fn() as unknown as jest.Mock;

const mockProjects: { current: ProjectItem[] } = { current: PROJECTS };
const mockUsers: { current: ProjectUserItem[] } = { current: USERS };
const mockUsersError: { current: boolean } = { current: false };
const mockRefetchUsers: jest.Mock = jest.fn();
const mockNow: { current: number | null } = { current: null };
const mockUserId: { current: string | null } = { current: ME };
const mockRouteParams: { current: CreateOnCallOverrideParams | undefined } = {
  current: undefined,
};

jest.mock("@react-navigation/native", () => {
  return {
    useNavigation: () => {
      return { goBack: mockGoBack, navigate: jest.fn() };
    },
    useRoute: () => {
      return { params: mockRouteParams.current };
    },
  };
});

jest.mock("../hooks/useProject", () => {
  return {
    useActiveProject: () => {
      return {
        projectList: mockProjects.current,
        isLoadingProjects: false,
        refreshProjects: jest.fn(),
      };
    },
  };
});

jest.mock("../hooks/useProjectUsers", () => {
  return {
    useProjectUsers: () => {
      return {
        users: mockUsers.current,
        isLoading: false,
        isError: mockUsersError.current,
        refetch: mockRefetchUsers,
      };
    },
  };
});

jest.mock("../hooks/useNow", () => {
  return {
    useNow: () => {
      return mockNow.current ?? Date.now();
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

describe("Coverage form recovery", () => {
  beforeEach(() => {
    mockCreateOverride.mockReset();
    mockCreateOverride.mockResolvedValue(undefined);
    mockRefetchUsers.mockReset();
    mockUsersError.current = false;
    mockNow.current = null;
    mockProjects.current = PROJECTS;
    mockUsers.current = USERS;
    mockUserId.current = ME;
    mockRouteParams.current = undefined;
  });

  test("shows a recoverable teammate loading error instead of an empty picker", async () => {
    mockUsersError.current = true;
    mockRefetchUsers.mockResolvedValue(undefined);
    const rendered: Awaited<ReturnType<typeof render>> = await render(
      <CreateOnCallOverrideScreen />,
    );
    expect(screen.getByText(/Could not load your teammates/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("open-user-picker"));
    expect(screen.queryByText("No teammates found")).toBeNull();
    expect(screen.queryByTestId(`user-option-${TEAMMATE}`)).toBeNull();

    await fireEvent.press(screen.getByTestId("retry-coverage-teammates"));
    expect(mockRefetchUsers).toHaveBeenCalledTimes(1);
    mockUsersError.current = false;
    await rendered.rerender(<CreateOnCallOverrideScreen />);
    expect(screen.queryByTestId("coverage-teammates-error")).toBeNull();
    await pickTeammate();
    await fireEvent.press(screen.getByTestId("submit-override"));
    expect(lastCreateInput().routeAlertsToUserId).toBe(TEAMMATE);
  });

  test("advances the coverage end-time preview while the form stays open", async () => {
    mockNow.current = new Date("2026-09-11T08:00:00Z").getTime();
    const rendered: Awaited<ReturnType<typeof render>> = await render(
      <CreateOnCallOverrideScreen />,
    );
    const firstPreview: string =
      screen.getByText(/^Starts now, ends /).props.children;
    mockNow.current += 60 * 60 * 1000;
    await rendered.rerender(<CreateOnCallOverrideScreen />);
    expect(screen.getByText(/^Starts now, ends /).props.children).not.toBe(
      firstPreview,
    );
    mockNow.current = null;
  });

  test("does not turn unreadable shift times into ordinary coverage", async () => {
    mockRouteParams.current = {
      projectId: "project-1",
      scheduleId: "schedule-1",
      scheduleName: "Primary",
      startsAt: "unreadable",
      endsAt: "2026-09-12T17:00:00Z",
    };
    await render(<CreateOnCallOverrideScreen />);
    await pickTeammate();
    await fireEvent.press(screen.getByTestId("submit-override"));
    expect(mockCreateOverride).not.toHaveBeenCalled();
    expect(
      screen.getByText(/This shift's times could not be read/),
    ).toBeTruthy();
  });

  test("closes the previous project's teammate picker when the selected project changes", async () => {
    const rendered: Awaited<ReturnType<typeof render>> = await render(
      <CreateOnCallOverrideScreen />,
    );
    await fireEvent.press(screen.getByTestId("open-user-picker"));
    expect(screen.getByTestId(`user-option-${TEAMMATE}`)).toBeTruthy();
    mockProjects.current = [PROJECTS[1]!];
    await rendered.rerender(<CreateOnCallOverrideScreen />);
    expect(screen.queryByTestId(`user-option-${TEAMMATE}`)).toBeNull();
  });
});

/*
 * Which policies someone limited to some policies may cover, as the server
 * answers (useCoverPolicies has its own tests): an older server's answer -
 * no answer - unless a test says otherwise. Each call records what the
 * sheet asked.
 */
const mockCoverPolicies: { current: CoverPoliciesState } = {
  current: { status: "unavailable" },
};
const mockCoverPoliciesAsked: Array<{
  projectId: string | null;
  enabled: boolean;
  shiftPolicies?: CoverPolicy[] | undefined;
}> = [];

jest.mock("../hooks/useCoverPolicies", () => {
  return {
    useCoverPolicies: (data: {
      projectId: string | null;
      enabled: boolean;
      shiftPolicies?: CoverPolicy[] | undefined;
    }): CoverPoliciesState => {
      mockCoverPoliciesAsked.push(data);
      return data.enabled ? mockCoverPolicies.current : { status: "not-asked" };
    },
  };
});

jest.mock("../hooks/useOnCallOverrides", () => {
  return {
    useOnCallOverrides: () => {
      return {
        active: [],
        upcoming: [],
        past: [],
        isLoading: false,
        isError: false,
        refetch: jest.fn(),
        createOverride: mockCreateOverride,
        isCreating: false,
        cancelOverride: jest.fn(),
        isCancelling: false,
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

async function pickTeammate(): Promise<void> {
  await fireEvent.press(screen.getByTestId("open-user-picker"));
  await fireEvent.press(screen.getByTestId(`user-option-${TEAMMATE}`));
}

function lastCreateInput(): CreateOverrideInput {
  const calls: Array<Array<unknown>> = mockCreateOverride.mock.calls;
  return calls[calls.length - 1]![0] as CreateOverrideInput;
}

describe("CreateOnCallOverrideScreen direction", () => {
  beforeEach(() => {
    mockCreateOverride.mockClear();
    mockGoBack.mockClear();
    mockProjects.current = PROJECTS;
    mockUsers.current = USERS;
    mockUserId.current = ME;
    mockRouteParams.current = undefined;
  });

  test("'cover for me' routes MY pages to the teammate", async (): Promise<void> => {
    await render(<CreateOnCallOverrideScreen />);

    await pickTeammate();
    await fireEvent.press(screen.getByTestId("submit-override"));

    expect(mockCreateOverride).toHaveBeenCalledTimes(1);
    expect(lastCreateInput().overrideUserId).toBe(ME);
    expect(lastCreateInput().routeAlertsToUserId).toBe(TEAMMATE);
  });

  test("'I'll take over' routes the TEAMMATE's pages to me", async (): Promise<void> => {
    await render(<CreateOnCallOverrideScreen />);

    await fireEvent.press(screen.getByText("I'll take over"));
    await pickTeammate();
    await fireEvent.press(screen.getByTestId("submit-override"));

    expect(lastCreateInput().overrideUserId).toBe(TEAMMATE);
    expect(lastCreateInput().routeAlertsToUserId).toBe(ME);
  });

  test("the summary reads back the direction before anything is sent", async (): Promise<void> => {
    await render(<CreateOnCallOverrideScreen />);

    await pickTeammate();

    expect(
      screen.getByText(
        "Your on-call pages go to Priya Rao for the next 4 hours.",
      ),
    ).toBeTruthy();

    await fireEvent.press(screen.getByText("I'll take over"));

    expect(
      screen.getByText(
        "Priya Rao's on-call pages come to you for the next 4 hours.",
      ),
    ).toBeTruthy();
  });
});

describe("CreateOnCallOverrideScreen window", () => {
  beforeEach(() => {
    mockCreateOverride.mockClear();
    mockProjects.current = PROJECTS;
    mockUsers.current = USERS;
    mockUserId.current = ME;
    mockRouteParams.current = undefined;
  });

  test("defaults to four hours starting now", async (): Promise<void> => {
    await render(<CreateOnCallOverrideScreen />);

    await pickTeammate();
    await fireEvent.press(screen.getByTestId("submit-override"));

    const input: CreateOverrideInput = lastCreateInput();
    const hours: number =
      (input.endsAt.getTime() - input.startsAt.getTime()) / (60 * 60 * 1000);

    expect(hours).toBe(4);
  });

  test("announces the selected duration and keeps confirmation above the safe area", async (): Promise<void> => {
    await render(<CreateOnCallOverrideScreen />);
    expect(
      screen.getByTestId("duration-4").props.accessibilityState.selected,
    ).toBe(true);
    await fireEvent.press(screen.getByTestId("duration-8"));
    expect(
      screen.getByTestId("duration-8").props.accessibilityState.selected,
    ).toBe(true);
    expect(
      screen.getByTestId("duration-4").props.accessibilityState.selected,
    ).toBe(false);
    expect(
      screen.getByTestId("create-override-scroll").props.contentContainerStyle
        .paddingBottom,
    ).toBeGreaterThanOrEqual(124);
    expect(screen.getByText("Review your coverage")).toBeTruthy();
  });

  test("a chosen preset changes the window", async (): Promise<void> => {
    await render(<CreateOnCallOverrideScreen />);

    await pickTeammate();
    await fireEvent.press(screen.getByTestId("duration-12"));
    await fireEvent.press(screen.getByTestId("submit-override"));

    const input: CreateOverrideInput = lastCreateInput();
    const hours: number =
      (input.endsAt.getTime() - input.startsAt.getTime()) / (60 * 60 * 1000);

    expect(hours).toBe(12);
  });
});

describe("CreateOnCallOverrideScreen project scope", () => {
  beforeEach(() => {
    mockCreateOverride.mockClear();
    mockProjects.current = PROJECTS;
    mockUsers.current = USERS;
    mockUserId.current = ME;
    mockRouteParams.current = undefined;
  });

  test("defaults to the first project", async (): Promise<void> => {
    await render(<CreateOnCallOverrideScreen />);

    await pickTeammate();
    await fireEvent.press(screen.getByTestId("submit-override"));

    expect(lastCreateInput().projectId).toBe("project-1");
  });

  test("creates coverage in the globally selected project", async (): Promise<void> => {
    mockProjects.current = [PROJECTS[1]!];
    await render(<CreateOnCallOverrideScreen />);
    expect(screen.queryByTestId("project-option-project-1")).toBeNull();
    await pickTeammate();
    await fireEvent.press(screen.getByTestId("submit-override"));
    expect(lastCreateInput().projectId).toBe("project-2");
  });
  test("changing the global project clears the selected teammate", async (): Promise<void> => {
    const rendered: Awaited<ReturnType<typeof render>> = await render(
      <CreateOnCallOverrideScreen />,
    );
    await pickTeammate();
    mockProjects.current = [PROJECTS[1]!];
    await rendered.rerender(<CreateOnCallOverrideScreen />);
    await fireEvent.press(screen.getByTestId("submit-override"));
    expect(mockCreateOverride).not.toHaveBeenCalled();
    expect(screen.getByText("Choose a teammate.")).toBeTruthy();
  });
  test("hides the project list when there is only one project", async (): Promise<void> => {
    mockProjects.current = [PROJECTS[0]!];

    await render(<CreateOnCallOverrideScreen />);

    expect(screen.queryByTestId("project-option-project-1")).toBeNull();
  });

  test("names the project even when there is no project choice", async (): Promise<void> => {
    mockProjects.current = [PROJECTS[0]!];
    await render(<CreateOnCallOverrideScreen />);
    expect(screen.getByTestId("coverage-project-name")).toHaveTextContent(
      PROJECTS[0]!.name,
    );
  });
});

/*
 * How the server refuses an override that overlaps another of the same
 * person in the same scope (OnCallDutyPolicyUserOverrideService): a 400
 * whose body names who is away, who covers them, when, and what to do.
 */
const EVERY_POLICY_OVERLAP_REFUSAL: string =
  "Ada Lovelace is already covered by Priya Rao on every policy from Nov 20, 2026, 09:00 UTC to Nov 20, 2026, 17:00 UTC. Change the times, or edit that override.";

const ONE_POLICY_OVERLAP_REFUSAL: string =
  "Ada Lovelace is already covered by Priya Rao on this policy from Nov 20, 2026, 09:00 UTC to Nov 20, 2026, 17:00 UTC. Change the times, or edit that override.";

// As axios rejects a request the server answered with a 400 and a message.
function serverRefusal(message: string): Error {
  return Object.assign(new Error("Request failed with status code 400"), {
    isAxiosError: true,
    response: { status: 400, data: { message: message } },
  });
}

describe("CreateOnCallOverrideScreen refusals", () => {
  beforeEach(() => {
    mockCreateOverride.mockClear();
    mockGoBack.mockClear();
    mockProjects.current = PROJECTS;
    mockUsers.current = USERS;
    mockUserId.current = ME;
    mockRouteParams.current = undefined;
  });

  test("submitting with no teammate explains rather than failing silently", async (): Promise<void> => {
    await render(<CreateOnCallOverrideScreen />);

    await fireEvent.press(screen.getByTestId("submit-override"));

    expect(mockCreateOverride).not.toHaveBeenCalled();
    expect(screen.getByTestId("override-error")).toBeTruthy();
  });

  test("never offers the signed-in user as the counterpart", async (): Promise<void> => {
    await render(<CreateOnCallOverrideScreen />);

    await fireEvent.press(screen.getByTestId("open-user-picker"));

    expect(screen.queryByTestId(`user-option-${ME}`)).toBeNull();
    expect(screen.getByTestId(`user-option-${TEAMMATE}`)).toBeTruthy();
  });

  test("a server refusal is shown and the screen stays open", async (): Promise<void> => {
    /*
     * Navigating back on failure would leave the responder believing they are
     * covered by an override that does not exist.
     */
    mockCreateOverride.mockRejectedValueOnce(
      new Error("Start time must be before end time") as never,
    );

    await render(<CreateOnCallOverrideScreen />);

    await pickTeammate();
    await fireEvent.press(screen.getByTestId("submit-override"));

    expect(screen.getByText("Start time must be before end time")).toBeTruthy();
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  test("an override that overlaps one already saved is refused in the server's words, whole, and the screen stays open", async (): Promise<void> => {
    mockCreateOverride.mockRejectedValueOnce(
      serverRefusal(EVERY_POLICY_OVERLAP_REFUSAL) as never,
    );

    await render(<CreateOnCallOverrideScreen />);

    await pickTeammate();
    await fireEvent.press(screen.getByTestId("submit-override"));

    // Who, by whom, when, and what to do - never "Server error (400)".
    expect(
      within(screen.getByTestId("override-error")).getByText(
        EVERY_POLICY_OVERLAP_REFUSAL,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Server error|status code 400/)).toBeNull();
    expect(mockGoBack).not.toHaveBeenCalled();

    // Times changed, the next Confirm is sent and closes the sheet.
    await fireEvent.press(screen.getByTestId("duration-12"));
    await fireEvent.press(screen.getByTestId("submit-override"));

    const input: CreateOverrideInput = lastCreateInput();

    expect(mockCreateOverride).toHaveBeenCalledTimes(2);
    expect(
      (input.endsAt.getTime() - input.startsAt.getTime()) / (60 * 60 * 1000),
    ).toBe(12);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  test("a successful create closes the sheet", async (): Promise<void> => {
    await render(<CreateOnCallOverrideScreen />);

    await pickTeammate();
    await fireEvent.press(screen.getByTestId("submit-override"));

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Opened from "Get cover" on a shift card: the window is the shift's, the
 * project is fixed, and the only question left is who takes it.
 * ---------------------------------------------------------------------------
 */

const HOUR: number = 60 * 60 * 1000;

function prefill(
  overrides: Partial<CreateOnCallOverrideParams> = {},
): CreateOnCallOverrideParams {
  return {
    projectId: "project-2",
    scheduleId: "schedule-1",
    scheduleName: "Primary",
    startsAt: new Date(Date.now() + 2 * HOUR).toISOString(),
    endsAt: new Date(Date.now() + 10 * HOUR).toISOString(),
    ...overrides,
  };
}

describe("readPrefilledWindow", () => {
  test("parses the ISO window", () => {
    const params: CreateOnCallOverrideParams = prefill();

    expect(readPrefilledWindow(params)).toEqual({
      startsAt: new Date(params.startsAt),
      endsAt: new Date(params.endsAt),
    });
  });

  test("reads missing or unparseable params as no prefill", () => {
    expect(readPrefilledWindow(undefined)).toBeNull();
    expect(readPrefilledWindow(prefill({ startsAt: "garbage" }))).toBeNull();
    expect(readPrefilledWindow(prefill({ endsAt: "" }))).toBeNull();
  });
});

describe("CreateOnCallOverrideScreen prefilled from a shift", () => {
  beforeEach(() => {
    mockCreateOverride.mockClear();
    mockGoBack.mockClear();
    mockProjects.current = [PROJECTS[1]!];
    mockUsers.current = USERS;
    mockUserId.current = ME;
    mockRouteParams.current = prefill();
  });

  test("shows the shift instead of the direction switch and duration presets", async (): Promise<void> => {
    await render(<CreateOnCallOverrideScreen />);

    expect(screen.getByTestId("prefilled-shift")).toBeTruthy();
    expect(screen.getByText("Primary")).toBeTruthy();
    expect(screen.queryByText("I'll take over")).toBeNull();
    expect(screen.queryByTestId("duration-4")).toBeNull();
  });

  test("fixes the project to the shift's project and hides the picker", async (): Promise<void> => {
    await render(<CreateOnCallOverrideScreen />);

    expect(screen.queryByTestId("project-option-project-1")).toBeNull();

    await pickTeammate();
    await fireEvent.press(screen.getByTestId("submit-override"));

    expect(lastCreateInput().projectId).toBe("project-2");
  });

  test("sends the shift's window, routing MY pages to the teammate", async (): Promise<void> => {
    const params: CreateOnCallOverrideParams = prefill();
    mockRouteParams.current = params;

    await render(<CreateOnCallOverrideScreen />);

    await pickTeammate();
    await fireEvent.press(screen.getByTestId("submit-override"));

    const input: CreateOverrideInput = lastCreateInput();

    expect(input.startsAt.toISOString()).toBe(params.startsAt);
    expect(input.endsAt.toISOString()).toBe(params.endsAt);
    expect(input.overrideUserId).toBe(ME);
    expect(input.routeAlertsToUserId).toBe(TEAMMATE);
    expect("onCallDutyPolicyId" in input).toBe(false);
  });

  test("a shift already in progress is covered from now", async (): Promise<void> => {
    const before: number = Date.now();

    mockRouteParams.current = prefill({
      startsAt: new Date(before - 3 * HOUR).toISOString(),
      endsAt: new Date(before + 5 * HOUR).toISOString(),
    });

    await render(<CreateOnCallOverrideScreen />);

    await pickTeammate();
    await fireEvent.press(screen.getByTestId("submit-override"));

    const input: CreateOverrideInput = lastCreateInput();

    expect(input.startsAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(input.endsAt.toISOString()).toBe(mockRouteParams.current.endsAt);
  });

  test("a policy-variant shift scopes the override to that policy", async (): Promise<void> => {
    mockRouteParams.current = prefill({ policyId: "policy-1" });

    await render(<CreateOnCallOverrideScreen />);

    await pickTeammate();
    await fireEvent.press(screen.getByTestId("submit-override"));

    expect(lastCreateInput().onCallDutyPolicyId).toBe("policy-1");
  });

  test("the summary names the shift, not a duration", async (): Promise<void> => {
    await render(<CreateOnCallOverrideScreen />);

    await pickTeammate();

    expect(
      screen.getByText(
        /Your on-call pages go to Priya Rao for your shift on Primary/,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/for the next 4 hours/)).toBeNull();
  });

  test("refuses a shift that has already ended, without sending anything", async (): Promise<void> => {
    mockRouteParams.current = prefill({
      startsAt: new Date(Date.now() - 10 * HOUR).toISOString(),
      endsAt: new Date(Date.now() - 2 * HOUR).toISOString(),
    });

    await render(<CreateOnCallOverrideScreen />);

    await pickTeammate();
    await fireEvent.press(screen.getByTestId("submit-override"));

    expect(mockCreateOverride).not.toHaveBeenCalled();
    expect(screen.getByText("That shift has already ended.")).toBeTruthy();
  });

  test("refuses a shift without a project instead of substituting the active project", async (): Promise<void> => {
    mockRouteParams.current = prefill({ projectId: "" });
    await render(<CreateOnCallOverrideScreen />);
    await pickTeammate();
    await fireEvent.press(screen.getByTestId("submit-override"));
    expect(mockCreateOverride).not.toHaveBeenCalled();
    expect(
      screen.getByText(/This shift belongs to another project/),
    ).toBeTruthy();
  });
  test("refuses a shift from a different project before making a request", async (): Promise<void> => {
    mockRouteParams.current = prefill({ projectId: "project-not-mine" });
    await render(<CreateOnCallOverrideScreen />);
    await pickTeammate();
    await fireEvent.press(screen.getByTestId("submit-override"));
    expect(mockCreateOverride).not.toHaveBeenCalled();
    expect(
      screen.getByText(/This shift belongs to another project/),
    ).toBeTruthy();
  });
  test("unreadable params degrade to the ordinary sheet", async (): Promise<void> => {
    mockRouteParams.current = prefill({ startsAt: "garbage" });

    await render(<CreateOnCallOverrideScreen />);

    expect(screen.queryByTestId("prefilled-shift")).toBeNull();
    expect(screen.getByTestId("duration-4")).toBeTruthy();
  });

  test("an ordinary coverage form stays in the selected project", async (): Promise<void> => {
    mockRouteParams.current = undefined;
    await render(<CreateOnCallOverrideScreen />);
    expect(screen.queryByTestId("prefilled-shift")).toBeNull();
    expect(screen.getByText("I'll take over")).toBeTruthy();
    expect(screen.queryByTestId("project-option-project-1")).toBeNull();
    await pickTeammate();
    await fireEvent.press(screen.getByTestId("submit-override"));
    expect(lastCreateInput().projectId).toBe("project-2");
  });
});

/*
 * ---------------------------------------------------------------------------
 * The form's shape: a teammate card, preset chips, a tinted preview and one
 * confirm button - in both themes, with the picker sheet clear of the home
 * indicator.
 * ---------------------------------------------------------------------------
 */

describe("CreateOnCallOverrideScreen form layout", () => {
  beforeEach(() => {
    mockCreateOverride.mockClear();
    mockGoBack.mockClear();
    mockUsersError.current = false;
    mockProjects.current = PROJECTS;
    mockUsers.current = USERS;
    mockUserId.current = ME;
    mockRouteParams.current = undefined;
    mockColorScheme = "light";
  });

  test("the teammate card invites a choice, then shows the teammate's initials", async (): Promise<void> => {
    await render(<CreateOnCallOverrideScreen />);

    const picker: HostElement = screen.getByRole("button", {
      name: "Choose a teammate",
    });
    expect(picker.props.testID).toBe("open-user-picker");
    expect(flatStyle("open-user-picker").backgroundColor).toBe(
      lightColors.backgroundElevated,
    );
    expect(flatStyle("open-user-picker").borderRadius).toBe(radius.lg);
    expect(screen.queryByText("Change")).toBeNull();

    await pickTeammate();

    const chosen: HostElement = screen.getByRole("button", {
      name: "Selected Priya Rao. Tap to change.",
    });
    expect(within(chosen).getByText("PR")).toBeTruthy();
    expect(within(chosen).getByText("Priya Rao")).toBeTruthy();
    expect(within(chosen).getByText("Change")).toBeTruthy();
    expect(
      within(chosen).getByTestId("coverage-project-name"),
    ).toHaveTextContent("Acme");
  });

  test("duration presets are chips: the selected one is filled", async (): Promise<void> => {
    await render(<CreateOnCallOverrideScreen />);

    expect(flatStyle("duration-4").backgroundColor).toBe(
      lightColors.actionPrimary,
    );
    expect(flatStyle("duration-8").backgroundColor).toBe(
      lightColors.backgroundElevated,
    );
    expect(flatStyle("duration-8").minHeight).toBeGreaterThanOrEqual(48);
    expect(
      within(screen.getByTestId("duration-4")).getByText("4 hours"),
    ).toHaveStyle({ color: lightColors.textInverse });

    await fireEvent.press(screen.getByTestId("duration-8"));

    expect(flatStyle("duration-8").backgroundColor).toBe(
      lightColors.actionPrimary,
    );
    expect(flatStyle("duration-4").backgroundColor).toBe(
      lightColors.backgroundElevated,
    );
  });

  test("the preview is a tinted card that reads the sentence back", async (): Promise<void> => {
    await render(<CreateOnCallOverrideScreen />);
    await pickTeammate();

    const preview: HostElement = screen.getByTestId("override-preview");
    expect(within(preview).getByText("Review your coverage")).toBeTruthy();
    expect(
      within(preview).getByText(
        "Your on-call pages go to Priya Rao for the next 4 hours.",
      ),
    ).toBeTruthy();
    expect(within(preview).getByText(/^Starts now, ends /)).toBeTruthy();
    expect(flatStyle("override-preview").backgroundColor).toBe(
      lightColors.cardAccent,
    );
    expect(flatStyle("override-preview").borderRadius).toBe(radius.lg);
  });

  test("a refusal appears as a danger banner above the confirm button", async (): Promise<void> => {
    await render(<CreateOnCallOverrideScreen />);

    await fireEvent.press(screen.getByTestId("submit-override"));

    expect(flatStyle("override-error").backgroundColor).toBe(
      lightColors.statusErrorBg,
    );
    expect(
      within(screen.getByTestId("override-error")).getByText(
        "Choose a teammate.",
      ),
    ).toBeTruthy();
    expect(flatStyle("submit-override").backgroundColor).toBe(
      lightColors.actionPrimary,
    );
  });

  test("the teammate loading failure is a tinted alert with its retry inside", async (): Promise<void> => {
    mockUsersError.current = true;

    await render(<CreateOnCallOverrideScreen />);

    const failure: HostElement = screen.getByTestId("coverage-teammates-error");
    expect(failure.props.accessibilityRole).toBe("alert");
    expect(
      within(failure).getByTestId("retry-coverage-teammates"),
    ).toBeTruthy();
    expect(flatStyle("coverage-teammates-error").backgroundColor).toBe(
      lightColors.statusErrorBg,
    );
  });

  test("a prefilled shift is summarised on a tinted card", async (): Promise<void> => {
    mockProjects.current = [PROJECTS[1]!];
    mockRouteParams.current = prefill();

    await render(<CreateOnCallOverrideScreen />);

    const shiftCard: HostElement = screen.getByTestId("prefilled-shift");
    expect(within(shiftCard).getByText("Cover for my shift")).toBeTruthy();
    expect(within(shiftCard).getByText("Primary")).toBeTruthy();
    expect(flatStyle("prefilled-shift").backgroundColor).toBe(
      lightColors.cardAccent,
    );
  });

  test("the nested teammate picker keeps clear of the home indicator", async (): Promise<void> => {
    await render(<CreateOnCallOverrideScreen />);
    await fireEvent.press(screen.getByTestId("open-user-picker"));

    expect(flatStyle("user-picker-sheet").paddingBottom).toBe(
      getScreenBottomPadding(0, false),
    );
  });

  test("dark mode: the form, chips and preview use dark tokens", async (): Promise<void> => {
    mockColorScheme = "dark";

    try {
      await render(
        <ThemeProvider>
          <CreateOnCallOverrideScreen />
        </ThemeProvider>,
      );

      expect(flatStyle("create-override-scroll").backgroundColor).toBe(
        darkColors.backgroundPrimary,
      );
      expect(flatStyle("open-user-picker").backgroundColor).toBe(
        darkColors.backgroundElevated,
      );
      expect(flatStyle("duration-4").backgroundColor).toBe(
        darkColors.actionPrimary,
      );
      expect(
        within(screen.getByTestId("duration-4")).getByText("4 hours"),
      ).toHaveStyle({ color: darkColors.textInverse });
      expect(flatStyle("override-preview").backgroundColor).toBe(
        darkColors.cardAccent,
      );

      await fireEvent.press(screen.getByTestId("open-user-picker"));
      expect(flatStyle("user-picker-overlay").backgroundColor).toBe(
        darkColors.overlay,
      );
    } finally {
      mockColorScheme = "light";
    }
  });
});

/*
 * ---------------------------------------------------------------------------
 * Cover arranged here applies to every on-call policy, which takes a
 * permission to add overrides over the whole project (issue #5617). For
 * someone whose permission covers only some policies, or none, the sheet
 * says why in place of the form - before anything is chosen - instead of
 * refusing it on Confirm. What they hold comes from the server: the rows
 * every answer about the project carries (api/projectPermissions).
 * ---------------------------------------------------------------------------
 */

const LIMITED_TO_TEAM_LABEL: Record<string, unknown> = {
  _type: "UserPermission",
  permission: "OnCallMember",
  labelIds: [{ _type: "ObjectID", value: "label-team-a" }],
  scope: "Labels",
  isBlockPermission: false,
};

const LIMITED_TO_OWNED: Record<string, unknown> = {
  _type: "UserPermission",
  permission: "OnCallMember",
  labelIds: [],
  scope: "Owned",
  isBlockPermission: false,
};

const OVER_THE_WHOLE_PROJECT: Record<string, unknown> = {
  _type: "UserPermission",
  permission: "OnCallMember",
  labelIds: [],
  scope: "All",
  isBlockPermission: false,
};

const ONLY_READS: Record<string, unknown> = {
  _type: "UserPermission",
  permission: "Viewer",
  labelIds: [],
  scope: "All",
  isBlockPermission: false,
};

// The server's answer about `projectId` says the person holds `rows` there.
function holding(
  projectId: string,
  rows: Array<Record<string, unknown>>,
): void {
  recordProjectPermissions(projectId, {
    "project-permissions": JSON.stringify({
      _type: "UserTenantAccessPermission",
      projectId: { _type: "ObjectID", value: projectId },
      permissions: rows,
    }),
  });
}

// A token whose payload says what `claims` say; the app never checks its signature.
function tokenWith(claims: Record<string, unknown>): string {
  const encode: (value: Record<string, unknown>) => string = (
    value: Record<string, unknown>,
  ): string => {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
  };

  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(claims)}.signature`;
}

describe("CreateOnCallOverrideScreen for someone limited to some policies", () => {
  beforeEach(() => {
    mockCoverPolicies.current = { status: "unavailable" };
    mockCreateOverride.mockClear();
    mockGoBack.mockClear();
    mockUsersError.current = false;
    mockProjects.current = PROJECTS;
    mockUsers.current = USERS;
    mockUserId.current = ME;
    mockRouteParams.current = undefined;
    clearAllProjectPermissions();
  });

  afterEach(() => {
    clearAllProjectPermissions();
    jestGlobal.restoreAllMocks();
  });

  function expectNoForm(): void {
    expect(screen.queryByTestId("open-user-picker")).toBeNull();
    expect(screen.queryByTestId("duration-4")).toBeNull();
    expect(screen.queryByTestId("override-preview")).toBeNull();
    expect(screen.queryByTestId("submit-override")).toBeNull();
    expect(screen.queryByText("I'll take over")).toBeNull();
  }

  test("a role limited to the team's label: the sheet says why in place of the form, and sends nothing", async (): Promise<void> => {
    holding("project-1", [LIMITED_TO_TEAM_LABEL]);

    await render(<CreateOnCallOverrideScreen />);

    const locked: HostElement = screen.getByTestId("override-locked");
    expect(
      within(locked).getByText(GLOBAL_OVERRIDE_LIMITED_REASON),
    ).toBeTruthy();
    expect(
      within(locked).getByText("Cover can't be arranged here"),
    ).toBeTruthy();
    // No promise of a handoff the sheet cannot make.
    expect(
      screen.queryByText("A clear handoff, for exactly as long as you need."),
    ).toBeNull();
    expectNoForm();
    expect(mockCreateOverride).not.toHaveBeenCalled();
  });

  test("a role limited to what the team owns: locked the same way", async (): Promise<void> => {
    holding("project-1", [LIMITED_TO_OWNED]);

    await render(<CreateOnCallOverrideScreen />);

    expect(
      within(screen.getByTestId("override-locked")).getByText(
        GLOBAL_OVERRIDE_LIMITED_REASON,
      ),
    ).toBeTruthy();
    expectNoForm();
  });

  test("someone who may not add overrides at all is told that instead", async (): Promise<void> => {
    holding("project-1", [ONLY_READS]);

    await render(<CreateOnCallOverrideScreen />);

    expect(
      within(screen.getByTestId("override-locked")).getByText(
        GLOBAL_OVERRIDE_NOT_ALLOWED_REASON,
      ),
    ).toBeTruthy();
    expectNoForm();
  });

  test("someone over the whole project arranges cover as before", async (): Promise<void> => {
    holding("project-1", [OVER_THE_WHOLE_PROJECT]);

    await render(<CreateOnCallOverrideScreen />);

    expect(screen.queryByTestId("override-locked")).toBeNull();

    await pickTeammate();
    await fireEvent.press(screen.getByTestId("submit-override"));

    expect(mockCreateOverride).toHaveBeenCalledTimes(1);
    expect(lastCreateInput().routeAlertsToUserId).toBe(TEAMMATE);
    expect("onCallDutyPolicyId" in lastCreateInput()).toBe(false);
  });

  test("before the server has said anything, the form shows as before: the server decides", async (): Promise<void> => {
    await render(<CreateOnCallOverrideScreen />);

    expect(screen.queryByTestId("override-locked")).toBeNull();
    expect(screen.getByTestId("submit-override")).toBeTruthy();
  });

  test("rows of another project do not lock this one", async (): Promise<void> => {
    holding("project-2", [LIMITED_TO_TEAM_LABEL]);
    holding("project-1", [OVER_THE_WHOLE_PROJECT]);

    await render(<CreateOnCallOverrideScreen />);

    expect(screen.queryByTestId("override-locked")).toBeNull();
    expect(screen.getByTestId("submit-override")).toBeTruthy();
  });

  test("the sheet follows the rows as an answer about the project brings them", async (): Promise<void> => {
    await render(<CreateOnCallOverrideScreen />);

    expect(screen.getByTestId("submit-override")).toBeTruthy();

    await act(async (): Promise<void> => {
      holding("project-1", [LIMITED_TO_TEAM_LABEL]);
    });

    expect(screen.getByTestId("override-locked")).toBeTruthy();
    expectNoForm();

    await act(async (): Promise<void> => {
      holding("project-1", [OVER_THE_WHOLE_PROJECT]);
    });

    expect(screen.queryByTestId("override-locked")).toBeNull();
    expect(screen.getByTestId("submit-override")).toBeTruthy();
  });

  test("a master admin arranges cover whatever their rows say", async (): Promise<void> => {
    jestGlobal
      .spyOn(keychain, "getCachedAccessToken")
      .mockReturnValue(tokenWith({ userId: ME, isMasterAdmin: true }));
    holding("project-1", [LIMITED_TO_TEAM_LABEL]);

    await render(<CreateOnCallOverrideScreen />);

    expect(screen.queryByTestId("override-locked")).toBeNull();

    await pickTeammate();
    await fireEvent.press(screen.getByTestId("submit-override"));

    expect(mockCreateOverride).toHaveBeenCalledTimes(1);
  });

  test("a token that does not say master admin changes nothing", async (): Promise<void> => {
    jestGlobal
      .spyOn(keychain, "getCachedAccessToken")
      .mockReturnValue(tokenWith({ userId: ME, isMasterAdmin: false }));
    holding("project-1", [LIMITED_TO_TEAM_LABEL]);

    await render(<CreateOnCallOverrideScreen />);

    expect(screen.getByTestId("override-locked")).toBeTruthy();
  });

  test("Get cover on a shift: the shift stays in view, with the reason in place of the form", async (): Promise<void> => {
    mockProjects.current = [PROJECTS[1]!];
    mockRouteParams.current = prefill();
    holding("project-2", [LIMITED_TO_TEAM_LABEL]);

    await render(<CreateOnCallOverrideScreen />);

    expect(screen.getByTestId("prefilled-shift")).toBeTruthy();
    expect(
      within(screen.getByTestId("override-locked")).getByText(
        GLOBAL_OVERRIDE_LIMITED_REASON,
      ),
    ).toBeTruthy();
    expectNoForm();
  });

  test("a shift that exists only inside one policy is covered on that policy: not a global override, so the form stays", async (): Promise<void> => {
    mockProjects.current = [PROJECTS[1]!];
    mockRouteParams.current = prefill({ policyId: "policy-1" });
    holding("project-2", [LIMITED_TO_TEAM_LABEL]);

    await render(<CreateOnCallOverrideScreen />);

    expect(screen.queryByTestId("override-locked")).toBeNull();

    await pickTeammate();
    await fireEvent.press(screen.getByTestId("submit-override"));

    expect(lastCreateInput().onCallDutyPolicyId).toBe("policy-1");
  });
});

type HostElement = ReturnType<typeof screen.getByTestId>;

function flatStyle(testID: string): Record<string, unknown> {
  return (StyleSheet.flatten(screen.getByTestId(testID).props.style) ??
    {}) as Record<string, unknown>;
}

/*
 * ---------------------------------------------------------------------------
 * Where the server says which policies they may cover, the sheet offers
 * those instead of the lock, and arranges the cover on each one ticked: one
 * override per policy, never a global one they could not add. A server too
 * old to say keeps today's lock.
 * ---------------------------------------------------------------------------
 */

const PAYMENTS: CoverPolicy = {
  policyId: "policy-payments",
  policyName: "Payments",
};
const CHECKOUT: CoverPolicy = {
  policyId: "policy-checkout",
  policyName: "Checkout",
};

describe("CreateOnCallOverrideScreen offering the policies someone may cover", () => {
  beforeEach(() => {
    mockCoverPolicies.current = { status: "unavailable" };
    mockCoverPoliciesAsked.length = 0;
    mockCreateOverride.mockReset();
    mockCreateOverride.mockResolvedValue(undefined);
    mockGoBack.mockClear();
    mockUsersError.current = false;
    mockProjects.current = PROJECTS;
    mockUsers.current = USERS;
    mockUserId.current = ME;
    mockRouteParams.current = undefined;
    clearAllProjectPermissions();
    holding("project-1", [LIMITED_TO_TEAM_LABEL]);
  });

  afterEach(() => {
    clearAllProjectPermissions();
  });

  function createdPolicyIds(): Array<string | undefined> {
    return mockCreateOverride.mock.calls.map(
      (call: Array<unknown>): string | undefined => {
        return (call[0] as CreateOverrideInput).onCallDutyPolicyId;
      },
    );
  }

  test("asks only for someone limited to some policies, about the project's policies", async (): Promise<void> => {
    mockCoverPolicies.current = { status: "offered", policies: [PAYMENTS] };

    await render(<CreateOnCallOverrideScreen />);

    const asked: (typeof mockCoverPoliciesAsked)[number] =
      mockCoverPoliciesAsked[mockCoverPoliciesAsked.length - 1]!;

    expect(asked.enabled).toBe(true);
    expect(asked.projectId).toBe("project-1");
    expect(asked.shiftPolicies).toBeUndefined();
  });

  test("one policy: named in place of a choice, and the cover is arranged on it alone", async (): Promise<void> => {
    mockCoverPolicies.current = { status: "offered", policies: [PAYMENTS] };

    await render(<CreateOnCallOverrideScreen />);

    expect(screen.queryByTestId("override-locked")).toBeNull();
    expect(
      within(screen.getByTestId("cover-policy-only")).getByText("Payments"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Your permission to add user overrides covers only this policy, so the cover applies to it alone.",
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("override-preview")).getByText(
        "Only on Payments.",
      ),
    ).toBeTruthy();

    await pickTeammate();
    await fireEvent.press(screen.getByTestId("submit-override"));

    expect(createdPolicyIds()).toEqual([PAYMENTS.policyId]);
    expect(lastCreateInput().overrideUserId).toBe(ME);
    expect(lastCreateInput().routeAlertsToUserId).toBe(TEAMMATE);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  test("several: each is ticked, and the cover is arranged on every one, an override each", async (): Promise<void> => {
    mockCoverPolicies.current = {
      status: "offered",
      policies: [PAYMENTS, CHECKOUT],
    };

    await render(<CreateOnCallOverrideScreen />);

    for (const policy of [PAYMENTS, CHECKOUT]) {
      const toggle: HostElement = screen.getByTestId(
        `cover-policy-${policy.policyId}`,
      );
      expect(toggle.props.accessibilityRole).toBe("checkbox");
      expect(toggle.props.accessibilityState).toEqual({ checked: true });
      expect(toggle.props.accessibilityLabel).toBe(policy.policyName);
    }

    expect(
      within(screen.getByTestId("override-preview")).getByText(
        "Only on Payments and Checkout.",
      ),
    ).toBeTruthy();

    await pickTeammate();
    await fireEvent.press(screen.getByTestId("submit-override"));

    expect(createdPolicyIds()).toEqual([PAYMENTS.policyId, CHECKOUT.policyId]);

    // Every one is the same cover: the same people, the same window.
    const [first, second] = mockCreateOverride.mock.calls.map(
      (call: Array<unknown>): CreateOverrideInput => {
        return call[0] as CreateOverrideInput;
      },
    ) as [CreateOverrideInput, CreateOverrideInput];
    expect({ ...second, onCallDutyPolicyId: undefined }).toEqual({
      ...first,
      onCallDutyPolicyId: undefined,
    });
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  test("a policy unticked is left alone", async (): Promise<void> => {
    mockCoverPolicies.current = {
      status: "offered",
      policies: [PAYMENTS, CHECKOUT],
    };

    await render(<CreateOnCallOverrideScreen />);

    await fireEvent.press(
      screen.getByTestId(`cover-policy-${PAYMENTS.policyId}`),
    );

    expect(
      screen.getByTestId(`cover-policy-${PAYMENTS.policyId}`).props
        .accessibilityState,
    ).toEqual({ checked: false });
    expect(
      within(screen.getByTestId("override-preview")).getByText(
        "Only on Checkout.",
      ),
    ).toBeTruthy();

    await pickTeammate();
    await fireEvent.press(screen.getByTestId("submit-override"));

    expect(createdPolicyIds()).toEqual([CHECKOUT.policyId]);
  });

  test("with every policy unticked, nothing is sent and the sheet says what is missing", async (): Promise<void> => {
    mockCoverPolicies.current = {
      status: "offered",
      policies: [PAYMENTS, CHECKOUT],
    };

    await render(<CreateOnCallOverrideScreen />);

    await fireEvent.press(
      screen.getByTestId(`cover-policy-${PAYMENTS.policyId}`),
    );
    await fireEvent.press(
      screen.getByTestId(`cover-policy-${CHECKOUT.policyId}`),
    );
    await pickTeammate();
    await fireEvent.press(screen.getByTestId("submit-override"));

    expect(mockCreateOverride).not.toHaveBeenCalled();
    expect(
      within(screen.getByTestId("override-error")).getByText(
        "Tick at least one on-call policy.",
      ),
    ).toBeTruthy();
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  test("an overlap refused on one of several policies names that policy, as the server's words do not", async (): Promise<void> => {
    mockCoverPolicies.current = {
      status: "offered",
      policies: [PAYMENTS, CHECKOUT],
    };
    mockCreateOverride
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        serverRefusal(ONE_POLICY_OVERLAP_REFUSAL) as never,
      );

    await render(<CreateOnCallOverrideScreen />);
    await pickTeammate();
    await fireEvent.press(screen.getByTestId("submit-override"));

    expect(createdPolicyIds()).toEqual([PAYMENTS.policyId, CHECKOUT.policyId]);
    expect(
      within(screen.getByTestId("override-error")).getByText(
        `Checkout: ${ONE_POLICY_OVERLAP_REFUSAL}`,
      ),
    ).toBeTruthy();
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  test("with one policy ticked, its overlap refusal reads as the server words it", async (): Promise<void> => {
    mockCoverPolicies.current = {
      status: "offered",
      policies: [PAYMENTS, CHECKOUT],
    };
    mockCreateOverride.mockRejectedValueOnce(
      serverRefusal(ONE_POLICY_OVERLAP_REFUSAL) as never,
    );

    await render(<CreateOnCallOverrideScreen />);
    await fireEvent.press(
      screen.getByTestId(`cover-policy-${PAYMENTS.policyId}`),
    );
    await pickTeammate();
    await fireEvent.press(screen.getByTestId("submit-override"));

    expect(createdPolicyIds()).toEqual([CHECKOUT.policyId]);
    expect(
      within(screen.getByTestId("override-error")).getByText(
        ONE_POLICY_OVERLAP_REFUSAL,
      ),
    ).toBeTruthy();
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  test("a refusal part way is shown, and Confirm again arranges only the rest", async (): Promise<void> => {
    mockCoverPolicies.current = {
      status: "offered",
      policies: [PAYMENTS, CHECKOUT],
    };
    mockCreateOverride
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("The server is busy."));

    await render(<CreateOnCallOverrideScreen />);
    await pickTeammate();
    await fireEvent.press(screen.getByTestId("submit-override"));

    expect(createdPolicyIds()).toEqual([PAYMENTS.policyId, CHECKOUT.policyId]);
    expect(screen.getByTestId("override-error")).toBeTruthy();
    expect(mockGoBack).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId("submit-override"));

    expect(createdPolicyIds()).toEqual([
      PAYMENTS.policyId,
      CHECKOUT.policyId,
      CHECKOUT.policyId,
    ]);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  test("while the server is asked: a line saying so, and nothing to choose yet", async (): Promise<void> => {
    mockCoverPolicies.current = { status: "checking" };

    await render(<CreateOnCallOverrideScreen />);

    expect(screen.getByTestId("override-checking-policies")).toBeTruthy();
    expect(screen.queryByTestId("override-locked")).toBeNull();
    expect(screen.queryByTestId("submit-override")).toBeNull();
    expect(screen.queryByTestId("open-user-picker")).toBeNull();
  });

  test("none of the policies allowed: locked, with the reason, as before", async (): Promise<void> => {
    mockCoverPolicies.current = { status: "offered", policies: [] };

    await render(<CreateOnCallOverrideScreen />);

    expect(
      within(screen.getByTestId("override-locked")).getByText(
        GLOBAL_OVERRIDE_LIMITED_REASON,
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId("submit-override")).toBeNull();
  });

  test("an older server, which cannot say: locked, as before", async (): Promise<void> => {
    mockCoverPolicies.current = { status: "unavailable" };

    await render(<CreateOnCallOverrideScreen />);

    expect(
      within(screen.getByTestId("override-locked")).getByText(
        GLOBAL_OVERRIDE_LIMITED_REASON,
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId("cover-policies")).toBeNull();
  });

  test("Get cover on a shift asks about the shift's own policies, and covers its window on each", async (): Promise<void> => {
    mockProjects.current = [PROJECTS[1]!];
    holding("project-2", [LIMITED_TO_TEAM_LABEL]);
    mockRouteParams.current = prefill({ policies: [PAYMENTS, CHECKOUT] });
    mockCoverPolicies.current = { status: "offered", policies: [CHECKOUT] };

    await render(<CreateOnCallOverrideScreen />);

    const asked: (typeof mockCoverPoliciesAsked)[number] =
      mockCoverPoliciesAsked[mockCoverPoliciesAsked.length - 1]!;

    expect(asked.enabled).toBe(true);
    expect(asked.projectId).toBe("project-2");
    expect(asked.shiftPolicies).toEqual([PAYMENTS, CHECKOUT]);
    expect(screen.getByTestId("prefilled-shift")).toBeTruthy();

    await pickTeammate();
    await fireEvent.press(screen.getByTestId("submit-override"));

    expect(createdPolicyIds()).toEqual([CHECKOUT.policyId]);
    expect(lastCreateInput().endsAt.toISOString()).toBe(
      mockRouteParams.current!.endsAt,
    );
  });

  test("Get cover on a shift no policy pages through: nothing to offer, so locked", async (): Promise<void> => {
    mockProjects.current = [PROJECTS[1]!];
    holding("project-2", [LIMITED_TO_TEAM_LABEL]);
    mockRouteParams.current = prefill();
    mockCoverPolicies.current = { status: "offered", policies: [] };

    await render(<CreateOnCallOverrideScreen />);

    expect(
      mockCoverPoliciesAsked[mockCoverPoliciesAsked.length - 1]!.shiftPolicies,
    ).toEqual([]);
    expect(screen.getByTestId("override-locked")).toBeTruthy();
  });

  test("someone over the whole project is not asked, and arranges a global override as before", async (): Promise<void> => {
    holding("project-1", [OVER_THE_WHOLE_PROJECT]);
    mockCoverPolicies.current = { status: "offered", policies: [PAYMENTS] };

    await render(<CreateOnCallOverrideScreen />);

    expect(
      mockCoverPoliciesAsked.every(
        (asked: (typeof mockCoverPoliciesAsked)[number]): boolean => {
          return !asked.enabled;
        },
      ),
    ).toBe(true);
    expect(screen.queryByTestId("cover-policies")).toBeNull();

    await pickTeammate();
    await fireEvent.press(screen.getByTestId("submit-override"));

    expect(createdPolicyIds()).toEqual([undefined]);
  });

  test("someone who may add no override at all is not asked: locked as before", async (): Promise<void> => {
    holding("project-1", [ONLY_READS]);
    mockCoverPolicies.current = { status: "offered", policies: [PAYMENTS] };

    await render(<CreateOnCallOverrideScreen />);

    expect(
      within(screen.getByTestId("override-locked")).getByText(
        GLOBAL_OVERRIDE_NOT_ALLOWED_REASON,
      ),
    ).toBeTruthy();
    expect(
      mockCoverPoliciesAsked.every(
        (asked: (typeof mockCoverPoliciesAsked)[number]): boolean => {
          return !asked.enabled;
        },
      ),
    ).toBe(true);
  });

  test("a shift that exists only inside one policy is that policy's cover, and asks nothing", async (): Promise<void> => {
    mockProjects.current = [PROJECTS[1]!];
    holding("project-2", [LIMITED_TO_TEAM_LABEL]);
    mockRouteParams.current = prefill({ policyId: "policy-variant" });

    await render(<CreateOnCallOverrideScreen />);

    expect(
      mockCoverPoliciesAsked.every(
        (asked: (typeof mockCoverPoliciesAsked)[number]): boolean => {
          return !asked.enabled;
        },
      ),
    ).toBe(true);

    await pickTeammate();
    await fireEvent.press(screen.getByTestId("submit-override"));

    expect(createdPolicyIds()).toEqual(["policy-variant"]);
  });
});
