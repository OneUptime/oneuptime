import React from "react";
import { Alert } from "react-native";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import type { UseQueryResult } from "@tanstack/react-query";
import SecurityCaseDetailScreen from "./SecurityCaseDetailScreen";
import * as securityCasesApi from "../api/securityCases";
import { ThemeProvider, darkColors, lightColors } from "../theme";
import {
  SECURITY_PRIORITY_IDS,
  SECURITY_STATUS_IDS,
  createQueryWrapper,
  createTestQueryClient,
  makeNote,
  makeSecurityCase,
  makeSecurityCaseFeedItem,
  makeSecurityCasePriorities,
  makeSecurityCaseStatuses,
  makeWaitingPlaybookRun,
} from "../__tests__/testSupport";
import type {
  NoteItem,
  ProjectUserItem,
  SecurityCaseFeedItem,
  SecurityCaseItem,
  SecurityCasePriorityItem,
  SecurityCaseStatusItem,
  SecurityPlaybookRunItem,
} from "../api/types";

/*
 * The screen a security-case page lands on. A responder woken at night reads
 * it before deciding, and acts on it: a playbook step waiting for their
 * approval first, then who has the case and the next step - Assign to me,
 * Close case with a verdict, Reopen - and the status, priority and assignee
 * a tap from being changed. Every change is the dashboard's own write
 * through the API, never drawn ahead of the server's answer, and a case read
 * again afterwards shows where it really is: changed, closed by somebody
 * else meanwhile, or gone.
 *
 * The read hooks are stand-ins (their suites own how they get their state);
 * the QueryClient is real, because the lists' caches are invalidated through
 * it after a change.
 */

const PROJECT_ID: string = "0b5e55ed-aaaa-4aaa-8aaa-00000000a0a0";
const CASE_ID: string = "5ec0ca5e-0142-4d1a-9a00-000000000142";
const RUN_ID: string = "7a6b0000-0001-4000-8000-000000000001";
const ME: string = "4c0b0b7e-0001-4000-8000-000000000001";
const PRIYA: string = "4c0b0b7e-0002-4000-8000-000000000002";

type Query<T> = UseQueryResult<T, Error>;

const mockCase: { current: Query<SecurityCaseItem | null> } = {
  current: {} as Query<SecurityCaseItem | null>,
};
const mockStatuses: { current: Query<SecurityCaseStatusItem[]> } = {
  current: {} as Query<SecurityCaseStatusItem[]>,
};
const mockPriorities: { current: Query<SecurityCasePriorityItem[]> } = {
  current: {} as Query<SecurityCasePriorityItem[]>,
};
const mockFeed: { current: Query<SecurityCaseFeedItem[]> } = {
  current: {} as Query<SecurityCaseFeedItem[]>,
};
const mockNotes: { current: Query<NoteItem[]> } = {
  current: {} as Query<NoteItem[]>,
};
const mockRuns: { current: Query<SecurityPlaybookRunItem[]> } = {
  current: {} as Query<SecurityPlaybookRunItem[]>,
};
const mockUsers: { current: ProjectUserItem[] } = { current: [] };
const mockUsersProject: { current: string | null } = { current: null };
const mockUserId: { current: string | null } = { current: ME };
const mockSuccessFeedback: jest.Mock = jest.fn();
const mockErrorFeedback: jest.Mock = jest.fn();
let mockColorScheme: "light" | "dark" = "light";

jest.mock("../hooks/useSecurityCaseDetail", () => {
  return {
    useSecurityCaseDetail: () => {
      return mockCase.current;
    },
    useSecurityCaseFeed: () => {
      return mockFeed.current;
    },
    useSecurityCaseNotes: () => {
      return mockNotes.current;
    },
    useCaseWaitingPlaybookRuns: () => {
      return mockRuns.current;
    },
  };
});

jest.mock("../hooks/useSecurityCases", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../hooks/useSecurityCases",
  );
  return {
    isAccessDenied: actual["isAccessDenied"],
    useSecurityCaseStatuses: () => {
      return mockStatuses.current;
    },
    useSecurityCasePriorities: () => {
      return mockPriorities.current;
    },
  };
});

jest.mock("../hooks/useProjectUsers", () => {
  return {
    useProjectUsers: (projectId: string | null) => {
      mockUsersProject.current = projectId;
      return {
        users: projectId ? mockUsers.current : [],
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

jest.mock("../api/securityCases", () => {
  return {
    updateSecurityCase: jest.fn(),
    decidePlaybookStep: jest.fn(),
    createSecurityCaseNote: jest.fn(),
  };
});

jest.mock("../hooks/useHaptics", () => {
  return {
    useHaptics: () => {
      return {
        successFeedback: mockSuccessFeedback,
        errorFeedback: mockErrorFeedback,
        lightImpact: jest.fn(),
        mediumImpact: jest.fn(),
        selectionFeedback: jest.fn(),
      };
    },
  };
});

jest.mock("../hooks/useScreenPadding", () => {
  return {
    useScreenPadding: () => {
      return 248;
    },
  };
});

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => {
  return {
    __esModule: true,
    default: (): "light" | "dark" => {
      return mockColorScheme;
    },
  };
});

const updateMock: jest.Mock =
  securityCasesApi.updateSecurityCase as unknown as jest.Mock;
const decideMock: jest.Mock =
  securityCasesApi.decidePlaybookStep as unknown as jest.Mock;
const noteMock: jest.Mock =
  securityCasesApi.createSecurityCaseNote as unknown as jest.Mock;
const alertSpy: jest.SpiedFunction<typeof Alert.alert> = jest
  .spyOn(Alert, "alert")
  .mockImplementation((): void => {
    return undefined;
  });
const mockNavigate: jest.Mock = jest.fn();

function query<T>(data: T, overrides: Partial<Query<T>> = {}): Query<T> {
  return {
    data,
    isLoading: false,
    isError: false,
    isSuccess: true,
    error: null,
    refetch: jest.fn(async () => {
      return undefined;
    }),
    ...overrides,
  } as unknown as Query<T>;
}

function refused(status: number, message: string): Error {
  return Object.assign(new Error(message), {
    isAxiosError: true,
    response: { status, data: { message } },
  });
}

function setCase(overrides: Partial<SecurityCaseItem> = {}): void {
  mockCase.current = query<SecurityCaseItem | null>(
    makeSecurityCase({ _id: CASE_ID, ...overrides }),
  );
}

const CLOSED: SecurityCaseStatusItem = makeSecurityCaseStatuses()[3]!;
const INVESTIGATING: SecurityCaseStatusItem = makeSecurityCaseStatuses()[1]!;
const CONTAINED: SecurityCaseStatusItem = makeSecurityCaseStatuses()[2]!;

function inStatus(status: SecurityCaseStatusItem): Partial<SecurityCaseItem> {
  return { securityCaseStatusId: status._id, securityCaseStatus: status };
}

const QUERY_WRAPPER: () => ReturnType<typeof createQueryWrapper> = () => {
  return createQueryWrapper(createTestQueryClient());
};

async function renderScreen(): Promise<Awaited<ReturnType<typeof render>>> {
  return render(
    <SecurityCaseDetailScreen
      {...({
        route: {
          key: "SecurityCaseDetail-1",
          name: "SecurityCaseDetail",
          params: { caseId: CASE_ID, projectId: PROJECT_ID },
        },
        navigation: { navigate: mockNavigate },
      } as unknown as React.ComponentProps<typeof SecurityCaseDetailScreen>)}
    />,
    { wrapper: QUERY_WRAPPER() },
  );
}

function guidance(): ReturnType<typeof screen.getByTestId> {
  return screen.getByTestId("response-guidance");
}

function actionLabels(): Array<string> {
  return within(screen.getByTestId("response-actions"))
    .getAllByRole("button")
    .map((element: ReturnType<typeof screen.getByRole>) => {
      return String(element.props.accessibilityLabel);
    });
}

beforeEach(() => {
  mockColorScheme = "light";
  mockUserId.current = ME;
  mockUsers.current = [
    { userId: ME, name: "Alex Morgan", email: "alex@example.test" },
    { userId: PRIYA, name: "Priya Shah", email: "priya@example.test" },
  ];
  setCase();
  mockStatuses.current = query(makeSecurityCaseStatuses());
  mockPriorities.current = query(makeSecurityCasePriorities());
  mockFeed.current = query<SecurityCaseFeedItem[]>([]);
  mockNotes.current = query<NoteItem[]>([]);
  mockRuns.current = query<SecurityPlaybookRunItem[]>([]);
  updateMock.mockReset();
  updateMock.mockResolvedValue(undefined);
  decideMock.mockReset();
  decideMock.mockResolvedValue(undefined);
  noteMock.mockReset();
  noteMock.mockResolvedValue(undefined);
});

describe("before there is a case to show", () => {
  test("while it loads, the page's shape, never an apology", async () => {
    mockCase.current = query<SecurityCaseItem | null>(undefined as never, {
      isLoading: true,
      isSuccess: false,
    });

    await renderScreen();

    expect(screen.getByTestId("response-detail-skeleton")).toBeTruthy();
  });

  test("a case that is gone says so only after a read that succeeded", async () => {
    mockCase.current = query<SecurityCaseItem | null>(null);

    await renderScreen();

    expect(screen.getByText("Case not found")).toBeTruthy();
    expect(
      screen.getByText(
        "This case no longer exists, or it is not part of this project.",
      ),
    ).toBeTruthy();
  });

  test("a read that failed is not a case that is gone, and offers another go", async () => {
    const refetch: jest.Mock = jest.fn(async () => {
      return undefined;
    });
    mockCase.current = query<SecurityCaseItem | null>(undefined as never, {
      isError: true,
      isSuccess: false,
      error: new Error("Network Error"),
      refetch: refetch as never,
    });

    await renderScreen();

    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.queryByText("Case not found")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  test("a refusal says the case is not the reader's to see, without a retry", async () => {
    mockCase.current = query<SecurityCaseItem | null>(undefined as never, {
      isError: true,
      isSuccess: false,
      error: refused(422, "You do not have permission to read Security Case"),
    });

    await renderScreen();

    expect(screen.getByText("You cannot see this case")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});

describe("the top of the case", () => {
  test("what it is, how urgent, where it stands and when it last fired", async () => {
    await renderScreen();

    expect(screen.getByText("Security case")).toBeTruthy();
    expect(screen.getByText("CASE-142")).toBeTruthy();
    expect(
      screen.getByRole("header", { name: "Password spray against the VPN" }),
    ).toBeTruthy();
    expect(screen.getByTestId("detail-state-pill")).toHaveTextContent("New");
    expect(screen.getByTestId("detail-severity-pill")).toHaveTextContent(
      /Critical$/,
    );
    expect(
      within(screen.getByTestId("response-detail-header")).getByText(
        /^Last detected /,
      ),
    ).toBeTruthy();
  });

  test("a case no detection fired for says when it opened instead", async () => {
    setCase({ lastDetectedAt: null });

    await renderScreen();

    expect(
      within(screen.getByTestId("response-detail-header")).getByText(
        /^Opened /,
      ),
    ).toBeTruthy();
  });
});

describe("a case nobody has", () => {
  test("needs an analyst: Assign to me first, then Close case", async () => {
    await renderScreen();

    expect(within(guidance()).getByText("Needs an analyst")).toBeTruthy();
    expect(actionLabels()).toEqual(["Assign CASE-142 to me", "Close CASE-142"]);
  });

  test("Assign to me writes the reader onto the case, then reads it again", async () => {
    await renderScreen();

    await fireEvent.press(
      screen.getByRole("button", { name: "Assign CASE-142 to me" }),
    );

    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith(PROJECT_ID, CASE_ID, {
        assignedToUserId: ME,
      });
    });
    expect(mockSuccessFeedback).toHaveBeenCalled();
    expect(mockCase.current.refetch).toHaveBeenCalled();
    expect(mockFeed.current.refetch).toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test("a refusal is said in the server's words, and the case is read again", async () => {
    updateMock.mockRejectedValue(
      refused(422, "You do not have permission to update this Security Case."),
    );
    await renderScreen();

    await fireEvent.press(
      screen.getByRole("button", { name: "Assign CASE-142 to me" }),
    );

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        "Could not assign the case",
        "You do not have permission to update this Security Case.",
      );
    });
    expect(mockErrorFeedback).toHaveBeenCalled();
    expect(mockSuccessFeedback).not.toHaveBeenCalled();
    expect(mockCase.current.refetch).toHaveBeenCalled();
  });

  test("a case closed by somebody else meanwhile shows closed once it is read again", async () => {
    updateMock.mockRejectedValue(
      refused(400, "A closed case is reopened before it is assigned."),
    );
    const view: Awaited<ReturnType<typeof render>> = await renderScreen();

    await fireEvent.press(
      screen.getByRole("button", { name: "Assign CASE-142 to me" }),
    );
    await waitFor(() => {
      expect(mockCase.current.refetch).toHaveBeenCalled();
    });

    // The read again comes back closed.
    setCase({ ...inStatus(CLOSED), verdict: "False Positive" });
    await view.rerender(
      <SecurityCaseDetailScreen
        {...({
          route: {
            key: "SecurityCaseDetail-1",
            name: "SecurityCaseDetail",
            params: { caseId: CASE_ID, projectId: PROJECT_ID },
          },
          navigation: { navigate: mockNavigate },
        } as unknown as React.ComponentProps<typeof SecurityCaseDetailScreen>)}
      />,
    );

    expect(within(guidance()).getByText("Case closed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Assign CASE-142 to me" })).toBeNull();
  });

  test("a case deleted meanwhile is gone once it is read again", async () => {
    updateMock.mockRejectedValue(refused(404, "This security case no longer exists."));
    const view: Awaited<ReturnType<typeof render>> = await renderScreen();

    await fireEvent.press(
      screen.getByRole("button", { name: "Assign CASE-142 to me" }),
    );
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalled();
    });

    mockCase.current = query<SecurityCaseItem | null>(null);
    await view.rerender(
      <SecurityCaseDetailScreen
        {...({
          route: {
            key: "SecurityCaseDetail-1",
            name: "SecurityCaseDetail",
            params: { caseId: CASE_ID, projectId: PROJECT_ID },
          },
          navigation: { navigate: mockNavigate },
        } as unknown as React.ComponentProps<typeof SecurityCaseDetailScreen>)}
      />,
    );

    expect(screen.getByText("Case not found")).toBeTruthy();
  });

  test("before the app knows who is signed in, it offers nothing it cannot write", async () => {
    mockUserId.current = null;

    await renderScreen();

    expect(actionLabels()).toEqual(["Close CASE-142"]);
  });
});

describe("a case somebody else has", () => {
  beforeEach(() => {
    setCase({
      ...inStatus(INVESTIGATING),
      assignedToUserId: PRIYA,
      assignedToUser: { _id: PRIYA, name: "Priya Shah" },
    });
  });

  test("names them, and offers taking it over", async () => {
    await renderScreen();

    expect(within(guidance()).getByText("Priya Shah has this case")).toBeTruthy();
    expect(actionLabels()).toEqual(["Assign CASE-142 to me", "Close CASE-142"]);
    expect(
      screen.getByRole("button", { name: "Assigned to: Priya Shah" }),
    ).toBeTruthy();
  });

  test("Assign to someone else hands it on from the picker, read only once it opens", async () => {
    await renderScreen();
    expect(mockUsersProject.current).toBeNull();

    await fireEvent.press(
      screen.getByRole("button", { name: "Assigned to: Priya Shah" }),
    );
    expect(mockUsersProject.current).toBe(PROJECT_ID);
    await fireEvent.press(screen.getByTestId(`user-option-${ME}`));

    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith(PROJECT_ID, CASE_ID, {
        assignedToUserId: ME,
      });
    });
  });

  test("picking the person who has it already writes nothing", async () => {
    await renderScreen();

    await fireEvent.press(
      screen.getByRole("button", { name: "Assigned to: Priya Shah" }),
    );
    await fireEvent.press(screen.getByTestId(`user-option-${PRIYA}`));

    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("my case", () => {
  beforeEach(() => {
    setCase({
      ...inStatus(INVESTIGATING),
      assignedToUserId: ME,
      assignedToUser: { _id: ME, name: "Alex Morgan" },
    });
  });

  test("says I have it, and leads with Close case", async () => {
    await renderScreen();

    expect(within(guidance()).getByText("You have this case")).toBeTruthy();
    expect(actionLabels()).toEqual(["Close CASE-142"]);
    expect(screen.getByRole("button", { name: "Assigned to: You" })).toBeTruthy();
  });

  test("once contained, says what is left", async () => {
    setCase({
      ...inStatus(CONTAINED),
      assignedToUserId: ME,
      assignedToUser: { _id: ME, name: "Alex Morgan" },
    });

    await renderScreen();

    expect(
      within(guidance()).getByText(
        "The threat is contained. Close the case with a verdict once the cleanup is done.",
      ),
    ).toBeTruthy();
  });
});

describe("closing a case", () => {
  test("asks what it turned out to be, starting from OneUptime AI's read", async () => {
    setCase({ aiVerdict: "Likely False Positive" });
    await renderScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Close CASE-142" }));

    expect(screen.getByTestId("close-case-sheet")).toBeTruthy();
    expect(
      screen.getByRole("radio", {
        name: "False Positive, Suggested by OneUptime AI",
      }),
    ).toBeTruthy();
    expect(updateMock).not.toHaveBeenCalled();
  });

  test("closes with the verdict and the note, and the sheet goes once it has", async () => {
    await renderScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Close CASE-142" }));

    await fireEvent.press(
      screen.getByTestId("close-case-verdict-True Positive"),
    );
    await fireEvent.changeText(
      screen.getByTestId("close-case-note"),
      "Contained and reset.",
    );
    await fireEvent.press(screen.getByTestId("close-case-submit"));

    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith(PROJECT_ID, CASE_ID, {
        securityCaseStatusId: SECURITY_STATUS_IDS.closed,
        verdict: "True Positive",
        closingNote: "Contained and reset.",
      });
    });
    await waitFor(() => {
      expect(screen.queryByTestId("close-case-sheet")).toBeNull();
    });
  });

  test("a close that is refused keeps the sheet, and what was typed in it", async () => {
    updateMock.mockRejectedValue(refused(422, "Not allowed."));
    await renderScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Close CASE-142" }));
    await fireEvent.press(
      screen.getByTestId("close-case-verdict-Undetermined"),
    );
    await fireEvent.changeText(
      screen.getByTestId("close-case-note"),
      "Keep this.",
    );

    await fireEvent.press(screen.getByTestId("close-case-submit"));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        "Could not close the case",
        "Not allowed.",
      );
    });
    expect(screen.getByTestId("close-case-sheet")).toBeTruthy();
    expect(screen.getByTestId("close-case-note").props.value).toBe("Keep this.");
  });
});

describe("a closed case", () => {
  beforeEach(() => {
    setCase({
      ...inStatus(CLOSED),
      verdict: "False Positive",
      closingNote: "Our own scanner.",
      assignedToUserId: ME,
    });
  });

  test("says how it closed, shows its verdict and note, and offers Reopen", async () => {
    await renderScreen();

    expect(within(guidance()).getByText("Case closed")).toBeTruthy();
    expect(
      within(guidance()).getByText(
        "Closed as False Positive. Reopen it if it needs more work.",
      ),
    ).toBeTruthy();
    expect(actionLabels()).toEqual(["Reopen CASE-142"]);
    expect(screen.getByTestId("case-field-verdict")).toHaveTextContent(
      /False Positive$/,
    );
    expect(screen.getByTestId("case-closing-note")).toBeTruthy();
    expect(screen.getByText("Our own scanner.")).toBeTruthy();
  });

  test("Reopen moves it to the project's acknowledged status, with no verdict", async () => {
    await renderScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Reopen CASE-142" }));

    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith(PROJECT_ID, CASE_ID, {
        securityCaseStatusId: SECURITY_STATUS_IDS.investigating,
      });
    });
  });

  test("nobody takes a closed case: its assignee only reads", async () => {
    await renderScreen();

    expect(screen.queryByRole("button", { name: /^Assigned to:/ })).toBeNull();
  });
});

describe("changing the status and the priority", () => {
  test("a status that does not close the case is written at once", async () => {
    await renderScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Status: New" }));
    await fireEvent.press(
      screen.getByTestId(`case-status-option-${SECURITY_STATUS_IDS.contained}`),
    );

    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith(PROJECT_ID, CASE_ID, {
        securityCaseStatusId: SECURITY_STATUS_IDS.contained,
      });
    });
    expect(screen.queryByTestId("case-status-sheet")).toBeNull();
  });

  test("a status that closes the case asks for a verdict first", async () => {
    await renderScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Status: New" }));
    await fireEvent.press(
      screen.getByTestId(`case-status-option-${SECURITY_STATUS_IDS.closed}`),
    );

    expect(screen.getByTestId("close-case-sheet")).toBeTruthy();
    expect(updateMock).not.toHaveBeenCalled();
  });

  test("a priority is written at once", async () => {
    await renderScreen();

    await fireEvent.press(
      screen.getByRole("button", { name: "Priority: Critical" }),
    );
    await fireEvent.press(
      screen.getByTestId(`case-priority-option-${SECURITY_PRIORITY_IDS.low}`),
    );

    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith(PROJECT_ID, CASE_ID, {
        securityCasePriorityId: SECURITY_PRIORITY_IDS.low,
      });
    });
  });

  test("a refused priority says so in the server's words", async () => {
    updateMock.mockRejectedValue(refused(400, "That priority is archived."));
    await renderScreen();

    await fireEvent.press(
      screen.getByRole("button", { name: "Priority: Critical" }),
    );
    await fireEvent.press(
      screen.getByTestId(`case-priority-option-${SECURITY_PRIORITY_IDS.low}`),
    );

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        "Could not change the priority",
        "That priority is archived.",
      );
    });
  });

  test("without the project's statuses, nothing that needs them is offered", async () => {
    mockStatuses.current = query<SecurityCaseStatusItem[]>([], {
      isError: true,
      data: undefined as never,
    });

    await renderScreen();

    expect(
      screen.getByText(
        "Unable to load the project's case statuses, which the response actions need.",
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId("response-actions")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Status:/ })).toBeNull();
  });
});

describe("OneUptime AI's read", () => {
  test("its suggested priority is one tap when the case is at another", async () => {
    setCase({
      aiVerdict: "Likely Benign",
      aiSuggestedSecurityCasePriorityId: SECURITY_PRIORITY_IDS.low,
      aiTriagedAt: "2026-08-30T09:48:00.000Z",
    });
    await renderScreen();

    expect(screen.getByText("Likely Benign")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Set to Low" }));

    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith(PROJECT_ID, CASE_ID, {
        securityCasePriorityId: SECURITY_PRIORITY_IDS.low,
      });
    });
  });

  test("a suggestion the case already has is not offered", async () => {
    setCase({
      aiVerdict: "Likely Malicious",
      aiSuggestedSecurityCasePriorityId: SECURITY_PRIORITY_IDS.critical,
    });

    await renderScreen();

    expect(screen.queryByTestId("case-ai-suggested-priority")).toBeNull();
  });

  test("its report's timeline entry is left to the AI section", async () => {
    mockFeed.current = query<SecurityCaseFeedItem[]>([
      makeSecurityCaseFeedItem({
        _id: "f-2",
        feedInfoInMarkdown: "OneUptime AI triaged the case: **Likely Malicious**.",
        securityCaseFeedEventType: "AiTriage",
      }),
      makeSecurityCaseFeedItem({ _id: "f-1" }),
    ]);

    await renderScreen();

    expect(screen.getAllByTestId("feed-entry")).toHaveLength(1);
    expect(screen.queryByText(/triaged the case/)).toBeNull();
  });
});

describe("a playbook step waiting for an approval", () => {
  beforeEach(() => {
    mockRuns.current = query<SecurityPlaybookRunItem[]>([
      makeWaitingPlaybookRun({ _id: RUN_ID }),
    ]);
  });

  test("comes first, above who has the case", async () => {
    await renderScreen();

    const card: ReturnType<typeof screen.getByTestId> = screen.getByTestId(
      "playbook-approval-card",
    );
    expect(card).toBeTruthy();
    // Found in the order they are drawn, top first.
    const order: Array<string> = screen
      .getAllByTestId(/^(playbook-approval-card|response-guidance)$/)
      .map((node: ReturnType<typeof screen.getByTestId>) => {
        return String(node.props.testID);
      });
    expect(order).toEqual(["playbook-approval-card", "response-guidance"]);
  });

  test("approving sends the decision with the targets kept and the comment", async () => {
    await renderScreen();

    await fireEvent.press(screen.getByTestId("playbook-approve"));
    await fireEvent.changeText(
      screen.getByTestId("playbook-decision-comment"),
      "Alice did not sign in.",
    );
    await fireEvent.press(screen.getByTestId("playbook-decision-submit"));

    await waitFor(() => {
      expect(decideMock).toHaveBeenCalledWith(PROJECT_ID, RUN_ID, "approve", {
        comment: "Alice did not sign in.",
        targets: ["alice@acme.test"],
      });
    });
    expect(mockSuccessFeedback).toHaveBeenCalled();
    expect(mockRuns.current.refetch).toHaveBeenCalled();
    expect(mockFeed.current.refetch).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByTestId("playbook-approve-sheet")).toBeNull();
    });
  });

  test("rejecting sends the comment, never targets", async () => {
    await renderScreen();

    await fireEvent.press(screen.getByTestId("playbook-reject"));
    await fireEvent.press(screen.getByTestId("playbook-decision-submit"));

    await waitFor(() => {
      expect(decideMock).toHaveBeenCalledWith(PROJECT_ID, RUN_ID, "reject", {
        comment: "",
        targets: undefined,
      });
    });
  });

  test("a step somebody decided a moment ago says so, and the runs are read again", async () => {
    decideMock.mockRejectedValue(
      refused(
        400,
        "This run is not waiting for an approval: somebody may have decided already.",
      ),
    );
    await renderScreen();

    await fireEvent.press(screen.getByTestId("playbook-approve"));
    await fireEvent.press(screen.getByTestId("playbook-decision-submit"));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        "Could not approve the step",
        "This run is not waiting for an approval: somebody may have decided already.",
      );
    });
    expect(mockErrorFeedback).toHaveBeenCalled();
    expect(mockRuns.current.refetch).toHaveBeenCalled();
    expect(screen.queryByTestId("playbook-approve-sheet")).toBeNull();
  });

  test("the run's starter cannot approve it", async () => {
    mockRuns.current = query<SecurityPlaybookRunItem[]>([
      makeWaitingPlaybookRun({ _id: RUN_ID, triggeredByUserId: ME }),
    ]);

    await renderScreen();

    expect(
      screen.getByTestId("playbook-approve").props.accessibilityState,
    ).toMatchObject({ disabled: true });
    expect(
      screen.getByText(
        "You started this run, so someone else must approve its steps.",
      ),
    ).toBeTruthy();
  });

  test("a check for waiting steps that failed says so, with a retry", async () => {
    const refetch: jest.Mock = jest.fn(async () => {
      return undefined;
    });
    mockRuns.current = query<SecurityPlaybookRunItem[]>([], {
      isError: true,
      refetch: refetch as never,
    });

    await renderScreen();

    expect(
      screen.getByText(
        "Could not check for playbook steps waiting for your approval.",
      ),
    ).toBeTruthy();
    await fireEvent.press(
      screen.getByRole("button", { name: "Retry approvals" }),
    );
    expect(refetch).toHaveBeenCalled();
  });
});

describe("the rest of the case", () => {
  test("what it is about, its details, description, timeline and notes", async () => {
    setCase({ description: "Fired **14** times." });
    mockFeed.current = query<SecurityCaseFeedItem[]>([
      makeSecurityCaseFeedItem(),
    ]);
    mockNotes.current = query<NoteItem[]>([
      makeNote({ note: "Called Alice." }),
    ]);

    await renderScreen();

    expect(screen.getByTestId("case-entities-section")).toBeTruthy();
    expect(screen.getByText("alice@acme.test")).toBeTruthy();
    const details: ReturnType<typeof screen.getByTestId> = screen.getByTestId(
      "case-details-section",
    );
    expect(within(details).getByText("Detection rule")).toBeTruthy();
    expect(within(details).getByText("14")).toBeTruthy();
    expect(screen.getByTestId("case-description")).toBeTruthy();
    expect(screen.getByTestId("case-timeline")).toBeTruthy();
    expect(screen.getByText("Called Alice.")).toBeTruthy();
  });

  test("a note is added to the case, and the notes are read again", async () => {
    await renderScreen();

    await fireEvent.press(screen.getByTestId("add-note-button"));
    expect(
      screen.getByText(
        "Notes stay on the case. Only people who can see security cases read them.",
      ),
    ).toBeTruthy();
    await fireEvent.changeText(
      screen.getByTestId("add-note-input"),
      "Reset Alice's password.",
    );
    await fireEvent.press(screen.getByTestId("add-note-submit"));

    await waitFor(() => {
      expect(noteMock).toHaveBeenCalledWith(
        PROJECT_ID,
        CASE_ID,
        "Reset Alice's password.",
      );
    });
    expect(mockNotes.current.refetch).toHaveBeenCalled();
  });

  test("an incident declared for the case opens from it", async () => {
    setCase({ incidentId: "1c1de000-0001-4000-8000-000000000001" });
    await renderScreen();

    await fireEvent.press(
      screen.getByRole("button", {
        name: "Incident: Open the incident declared for this case",
      }),
    );

    expect(mockNavigate).toHaveBeenCalledWith("IncidentDetail", {
      incidentId: "1c1de000-0001-4000-8000-000000000001",
      projectId: PROJECT_ID,
    });
  });

  test("pull to refresh reads the case and everything beside it again", async () => {
    await renderScreen();

    const scroll: ReturnType<typeof screen.getByTestId> = screen.getByTestId(
      "security-case-detail-scroll",
    );
    await act(async () => {
      await scroll.props.refreshControl.props.onRefresh();
    });

    for (const holder of [
      mockCase,
      mockStatuses,
      mockPriorities,
      mockFeed,
      mockNotes,
      mockRuns,
    ]) {
      expect(
        (holder.current as unknown as { refetch: jest.Mock }).refetch,
      ).toHaveBeenCalled();
    }
  });
});

describe("in dark mode", () => {
  test("the page and its cards read from the dark palette", async () => {
    mockColorScheme = "dark";
    mockRuns.current = query<SecurityPlaybookRunItem[]>([
      makeWaitingPlaybookRun({ _id: RUN_ID }),
    ]);

    await render(
      <ThemeProvider>
        <SecurityCaseDetailScreen
          {...({
            route: {
              key: "SecurityCaseDetail-1",
              name: "SecurityCaseDetail",
              params: { caseId: CASE_ID, projectId: PROJECT_ID },
            },
            navigation: { navigate: mockNavigate },
          } as unknown as React.ComponentProps<
            typeof SecurityCaseDetailScreen
          >)}
        />
      </ThemeProvider>,
      { wrapper: QUERY_WRAPPER() },
    );

    expect(screen.getByTestId("security-case-detail-scroll")).toHaveStyle({
      backgroundColor: darkColors.backgroundPrimary,
    });
    expect(screen.getByTestId("playbook-approval-card")).toHaveStyle({
      backgroundColor: darkColors.backgroundElevated,
    });
    expect(screen.getByTestId("response-guidance")).not.toHaveStyle({
      backgroundColor: lightColors.backgroundElevated,
    });
  });
});
