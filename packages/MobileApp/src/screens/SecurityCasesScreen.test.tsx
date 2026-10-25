import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import SecurityCasesScreen from "./SecurityCasesScreen";
import { ListPaneProvider, PaneStateScope } from "../navigation/paneState";
import type { OpenSecurityCases } from "../hooks/useSecurityCases";
import { ThemeProvider, darkColors } from "../theme";
import {
  SECURITY_PRIORITY_IDS,
  makeSecurityCase,
  makeSecurityCasePriorities,
  makeSecurityCaseStatuses,
} from "../__tests__/testSupport";
import type { ProjectSecurityCaseItem, SecurityCaseItem } from "../api/types";

/*
 * The selected project's open security cases, inside the Inbox. What is
 * under test is which screen a given state of the cases hook produces: the
 * order a paged analyst works the cases in (a case waiting for an approval
 * first, then the most urgent), the three filters, search, and the states
 * that must never be confused - loading, failed, refused, and genuinely no
 * open cases. useSecurityCases.test.tsx owns how the hook gets there.
 */

const PROJECT_ID: string = "0b5e55ed-aaaa-4aaa-8aaa-00000000a0a0";
const ME: string = "4c0b0b7e-0001-4000-8000-000000000001";

const mockCases: { current: OpenSecurityCases } = {
  current: {} as OpenSecurityCases,
};
const mockRefetch: jest.Mock = jest.fn(async () => {
  return undefined;
});
const mockNavigate: jest.Mock = jest.fn();
const mockRoute: {
  key: string;
  params: Record<string, unknown> | undefined;
} = { key: "InboxList-1", params: undefined };
const mockUserId: { current: string | null } = { current: ME };
let mockColorScheme: "light" | "dark" = "light";

jest.mock("../hooks/useSecurityCases", () => {
  return {
    useOpenSecurityCases: () => {
      return mockCases.current;
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

jest.mock("../hooks/useScreenPadding", () => {
  return {
    useScreenPadding: () => {
      return 248;
    },
  };
});

jest.mock("@react-navigation/native", () => {
  return {
    useRoute: () => {
      return mockRoute;
    },
    useNavigation: () => {
      return { navigate: mockNavigate };
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

function wrap(item: SecurityCaseItem): ProjectSecurityCaseItem {
  return { item, projectId: PROJECT_ID, projectName: "Production" };
}

const SPRAY: SecurityCaseItem = makeSecurityCase({
  _id: "case-spray",
  title: "Password spray against the VPN",
  caseNumberWithPrefix: "CASE-142",
  securityCasePriorityId: SECURITY_PRIORITY_IDS.medium,
  lastDetectedAt: "2026-08-30T08:00:00.000Z",
});
const POWERSHELL: SecurityCaseItem = makeSecurityCase({
  _id: "case-powershell",
  title: "Unusual PowerShell download",
  caseNumberWithPrefix: "CASE-141",
  securityCasePriorityId: SECURITY_PRIORITY_IDS.high,
  assignedToUserId: "priya",
  assignedToUser: { _id: "priya", name: "Priya Shah" },
  entities: [{ type: "Host", value: "fin-laptop-07" }],
  lastDetectedAt: "2026-08-30T09:00:00.000Z",
});
const TRAVEL: SecurityCaseItem = makeSecurityCase({
  _id: "case-travel",
  title: "Impossible travel",
  caseNumberWithPrefix: "CASE-139",
  securityCasePriorityId: SECURITY_PRIORITY_IDS.critical,
  assignedToUserId: ME,
  assignedToUser: { _id: ME, name: "Alex Morgan" },
  lastDetectedAt: "2026-08-30T07:00:00.000Z",
});

function casesWith(
  overrides: Partial<OpenSecurityCases> = {},
): OpenSecurityCases {
  return {
    items: [wrap(SPRAY), wrap(POWERSHELL), wrap(TRAVEL)],
    statuses: makeSecurityCaseStatuses(),
    priorities: makeSecurityCasePriorities(),
    awaitingApprovalCaseIds: new Set<string>(),
    isTruncated: false,
    isLoading: false,
    isError: false,
    isDenied: false,
    refetch: mockRefetch as unknown as () => Promise<void>,
    ...overrides,
  };
}

function rowTitles(): Array<string> {
  return screen
    .getAllByRole("button")
    .map((element: ReturnType<typeof screen.getByRole>) => {
      return String(element.props.accessibilityLabel ?? "");
    })
    .filter((label: string) => {
      return label.startsWith("Security case ");
    })
    .map((label: string) => {
      return label.split(", ")[1]!.split(".")[0]!;
    });
}

beforeEach(() => {
  mockColorScheme = "light";
  mockUserId.current = ME;
  mockRoute.params = undefined;
  mockCases.current = casesWith();
});

describe("the order the cases are worked in", () => {
  test("the most urgent first", async () => {
    await render(<SecurityCasesScreen />);

    expect(rowTitles()).toEqual([
      "Impossible travel",
      "Unusual PowerShell download",
      "Password spray against the VPN",
    ]);
  });

  test("a case waiting for an approval before every other, and marked", async () => {
    mockCases.current = casesWith({
      awaitingApprovalCaseIds: new Set(["case-spray"]),
    });

    await render(<SecurityCasesScreen />);

    expect(rowTitles()[0]).toBe("Password spray against the VPN");
    expect(screen.getAllByTestId("response-row-badge")).toHaveLength(1);
    expect(screen.getByText("Approval needed")).toBeTruthy();
  });

  test("the reader's own case says it is theirs", async () => {
    await render(<SecurityCasesScreen />);

    expect(screen.getByText("Assigned to you")).toBeTruthy();
    expect(screen.getByText("Assigned to Priya Shah")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: /^Security case CASE-142.*Unassigned\./,
      }),
    ).toBeTruthy();
  });

  test("a row opens its case in its project", async () => {
    await render(<SecurityCasesScreen />);

    await fireEvent.press(
      screen.getByRole("button", { name: /^Security case CASE-141/ }),
    );

    expect(mockNavigate).toHaveBeenCalledWith("SecurityCaseDetail", {
      caseId: "case-powershell",
      projectId: PROJECT_ID,
    });
  });
});

describe("the filters", () => {
  test("Open, Mine and Unassigned, with how many each holds", async () => {
    await render(<SecurityCasesScreen />);

    const chips: Array<string> = [
      "Every open case",
      "Open cases assigned to me",
      "Open cases nobody has picked up",
    ];
    for (const name of chips) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("Mine")).toBeTruthy();
    expect(screen.getByText("3 results")).toBeTruthy();
  });

  test("Mine is the reader's open cases", async () => {
    await render(<SecurityCasesScreen />);

    await fireEvent.press(
      screen.getByRole("button", { name: "Open cases assigned to me" }),
    );

    expect(rowTitles()).toEqual(["Impossible travel"]);
    expect(screen.getByText("1 result")).toBeTruthy();
  });

  test("Unassigned is the open cases nobody has picked up", async () => {
    await render(<SecurityCasesScreen />);

    await fireEvent.press(
      screen.getByRole("button", { name: "Open cases nobody has picked up" }),
    );

    expect(rowTitles()).toEqual(["Password spray against the VPN"]);
  });

  test("Reset brings every open case back", async () => {
    await render(<SecurityCasesScreen />);
    await fireEvent.press(
      screen.getByRole("button", { name: "Open cases assigned to me" }),
    );

    await fireEvent.press(
      screen.getByRole("button", { name: "Reset filters" }),
    );

    expect(rowTitles()).toHaveLength(3);
  });

  test("an empty Mine says what to do, and offers every open case", async () => {
    mockUserId.current = "somebody-else";
    await render(<SecurityCasesScreen />);

    await fireEvent.press(
      screen.getByRole("button", { name: "Open cases assigned to me" }),
    );

    expect(screen.getByText("No open cases are assigned to you")).toBeTruthy();
    expect(
      screen.getByText("Pick up one that nobody has taken yet."),
    ).toBeTruthy();
    await fireEvent.press(
      screen.getByRole("button", { name: "Show every open case" }),
    );
    expect(rowTitles()).toHaveLength(3);
  });

  test("a Home shortcut's filter is applied once, and not again after a fold", async () => {
    mockRoute.params = { initialView: "security", initialCaseFilter: "mine" };
    const view: Awaited<ReturnType<typeof render>> = await render(
      <PaneStateScope scope="inbox-list">
        <SecurityCasesScreen />
      </PaneStateScope>,
    );

    expect(rowTitles()).toEqual(["Impossible travel"]);

    await fireEvent.press(
      screen.getByRole("button", { name: "Every open case" }),
    );
    expect(rowTitles()).toHaveLength(3);

    // A fold draws the list afresh with the same params: Open stays.
    await view.rerender(
      <PaneStateScope scope="inbox-list">
        <></>
      </PaneStateScope>,
    );
    await view.rerender(
      <PaneStateScope scope="inbox-list">
        <SecurityCasesScreen />
      </PaneStateScope>,
    );
    expect(rowTitles()).toHaveLength(3);
  });
});

describe("search", () => {
  test("finds a case by what it is about", async () => {
    await render(<SecurityCasesScreen />);

    await fireEvent.changeText(
      screen.getByTestId("security-case-search"),
      "fin-laptop",
    );

    expect(rowTitles()).toEqual(["Unusual PowerShell download"]);
  });

  test("a search that finds nothing says so, and clears", async () => {
    await render(<SecurityCasesScreen />);

    await fireEvent.changeText(
      screen.getByTestId("security-case-search"),
      "ransomware",
    );

    expect(screen.getByText("No matching cases")).toBeTruthy();
    await fireEvent.press(
      screen.getByRole("button", { name: "Clear filters" }),
    );
    expect(rowTitles()).toHaveLength(3);
  });
});

describe("states that must never be confused", () => {
  test("while the cases load: placeholders, never an all-clear", async () => {
    mockCases.current = casesWith({ items: [], isLoading: true });

    await render(<SecurityCasesScreen />);

    expect(screen.getByTestId("security-cases-loading")).toBeTruthy();
    expect(screen.queryByText("No open cases")).toBeNull();
    expect(screen.queryByText(/results?$/)).toBeNull();
  });

  test("a failed read says so, with a way to try again", async () => {
    mockCases.current = casesWith({ items: [], isError: true });

    await render(<SecurityCasesScreen />);

    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.queryByText("No open cases")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(mockRefetch).toHaveBeenCalled();
    });
  });

  test("a refusal says the reader's role does not cover cases, without a retry", async () => {
    mockCases.current = casesWith({
      items: [],
      isError: true,
      isDenied: true,
    });

    await render(<SecurityCasesScreen />);

    expect(screen.getByText("No access to security cases")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  test("no open cases is good news", async () => {
    mockCases.current = casesWith({ items: [] });

    await render(<SecurityCasesScreen />);

    expect(screen.getByText("No open cases")).toBeTruthy();
    expect(
      screen.getByText("New cases appear here as detections fire."),
    ).toBeTruthy();
    expect(screen.getByText("0 results")).toBeTruthy();
  });

  test("a project with more open cases than the list holds says how many it shows", async () => {
    mockCases.current = casesWith({ isTruncated: true });

    await render(<SecurityCasesScreen />);

    expect(
      screen.getByText(
        "Showing the 100 open cases with the latest detections.",
      ),
    ).toBeTruthy();
  });

  test("pull to refresh asks for the cases again", async () => {
    await render(<SecurityCasesScreen />);

    const list: ReturnType<typeof screen.getByTestId> =
      screen.getByTestId("security-case-list");
    await act(async () => {
      await list.props.refreshControl.props.onRefresh();
    });

    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });
});

describe("beside a detail pane, on a wide window", () => {
  test("the case open on the right is marked, and rows lose the chevron", async () => {
    await render(
      <ListPaneProvider
        selection={{
          name: "SecurityCaseDetail",
          params: { caseId: "case-powershell", projectId: PROJECT_ID },
        }}
      >
        <SecurityCasesScreen />
      </ListPaneProvider>,
    );

    expect(
      screen.getByRole("button", { name: /^Security case CASE-141/ }),
    ).toBeSelected();
    expect(
      screen.getByRole("button", { name: /^Security case CASE-142/ }),
    ).not.toBeSelected();
    expect(screen.queryByTestId("response-row-chevron")).toBeNull();
  });
});

describe("in dark mode", () => {
  test("the list paints its canvas from the dark palette", async () => {
    mockColorScheme = "dark";

    await render(
      <ThemeProvider>
        <SecurityCasesScreen />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("security-cases-screen")).toHaveStyle({
      backgroundColor: darkColors.backgroundPrimary,
    });
  });
});
