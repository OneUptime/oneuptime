import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import {
  describe,
  expect,
  test,
  beforeEach,
  jest as jestGlobal,
} from "@jest/globals";
import CreateOnCallOverrideScreen, {
  readPrefilledWindow,
} from "./CreateOnCallOverrideScreen";
import type { CreateOverrideInput } from "../hooks/useOnCallOverrides";
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
    useProject: () => {
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
        isError: false,
        refetch: jest.fn(),
      };
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

  test("sends the chosen project when the responder switches", async (): Promise<void> => {
    await render(<CreateOnCallOverrideScreen />);

    await fireEvent.press(screen.getByTestId("project-option-project-2"));
    await pickTeammate();
    await fireEvent.press(screen.getByTestId("submit-override"));

    expect(lastCreateInput().projectId).toBe("project-2");
  });

  test("switching project clears the teammate, because the list changed", async (): Promise<void> => {
    /*
     * The picker lists one project's members. Keeping a selection across a
     * project change would submit somebody the new project does not contain -
     * rejected server-side, after the user had stopped reading.
     */
    await render(<CreateOnCallOverrideScreen />);

    await pickTeammate();
    expect(screen.getByText("Priya Rao")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("project-option-project-2"));
    await fireEvent.press(screen.getByTestId("submit-override"));

    expect(mockCreateOverride).not.toHaveBeenCalled();
    expect(screen.getByText("Choose a teammate.")).toBeTruthy();
  });

  test("hides the project list when there is only one project", async (): Promise<void> => {
    mockProjects.current = [PROJECTS[0]!];

    await render(<CreateOnCallOverrideScreen />);

    expect(screen.queryByTestId("project-option-project-1")).toBeNull();
  });
});

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
    mockProjects.current = PROJECTS;
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

  test("unreadable params degrade to the ordinary sheet", async (): Promise<void> => {
    mockRouteParams.current = prefill({ startsAt: "garbage" });

    await render(<CreateOnCallOverrideScreen />);

    expect(screen.queryByTestId("prefilled-shift")).toBeNull();
    expect(screen.getByTestId("duration-4")).toBeTruthy();
  });

  test("with no params the sheet behaves exactly as before", async (): Promise<void> => {
    mockRouteParams.current = undefined;

    await render(<CreateOnCallOverrideScreen />);

    expect(screen.queryByTestId("prefilled-shift")).toBeNull();
    expect(screen.getByText("I'll take over")).toBeTruthy();
    expect(screen.getByTestId("project-option-project-1")).toBeTruthy();

    await pickTeammate();
    await fireEvent.press(screen.getByTestId("submit-override"));

    expect(lastCreateInput().projectId).toBe("project-1");
  });
});
