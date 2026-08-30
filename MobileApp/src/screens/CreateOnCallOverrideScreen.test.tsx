import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import {
  describe,
  expect,
  test,
  beforeEach,
  jest as jestGlobal,
} from "@jest/globals";
import CreateOnCallOverrideScreen from "./CreateOnCallOverrideScreen";
import type { CreateOverrideInput } from "../hooks/useOnCallOverrides";
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

jest.mock("@react-navigation/native", () => {
  return {
    useNavigation: () => {
      return { goBack: mockGoBack, navigate: jest.fn() };
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
