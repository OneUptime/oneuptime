import React from "react";
import {
  Appearance,
  Dimensions,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import { ProjectProvider, useActiveProject } from "../hooks/useProject";
import { fetchProjects } from "../api/projects";
import { makeListResponse, makeProject } from "../__tests__/testSupport";
import ProjectSwitcher, { ProjectSwitcherHost } from "./ProjectSwitcher";
import { ThemeProvider } from "../theme";
import { darkColors, lightColors, type ColorTokens } from "../theme/colors";
import { radius } from "../theme/tokens";
import type { ProjectItem } from "../api/types";

let mockSystemScheme: "light" | "dark" | null = "light";

/*
 * react-native exposes useColorScheme through a getter, which cannot be spied
 * on, so the module behind it is replaced instead (as in ThemeContext.test).
 */
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => {
  return {
    __esModule: true,
    default: (): "light" | "dark" | null => {
      return mockSystemScheme;
    },
  };
});

jest.mock("../api/projects", () => {
  return { fetchProjects: jest.fn() };
});
jest.mock("../hooks/useAuth", () => {
  return {
    useAuth: () => {
      return {
        isAuthenticated: true,
        isLoading: false,
        user: { _id: "responder" },
      };
    },
  };
});

const first: ProjectItem = makeProject({
  _id: "project-a",
  name: "Acme Production",
});
const second: ProjectItem = makeProject({
  _id: "project-b",
  name: "Beta Staging",
});
const mockFetchProjects: jest.MockedFunction<typeof fetchProjects> =
  fetchProjects as jest.MockedFunction<typeof fetchProjects>;

function ProjectConsumer(): React.JSX.Element {
  const { projectList } = useActiveProject();
  return (
    <Text testID="visible-projects">
      {projectList
        .map((project: ProjectItem) => {
          return project._id;
        })
        .join(",")}
    </Text>
  );
}

beforeEach(async () => {
  mockSystemScheme = "light";
  await AsyncStorage.clear();
  mockFetchProjects.mockReset();
  mockFetchProjects.mockResolvedValue(makeListResponse([first, second]));
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function show(): Promise<void> {
  await render(
    <SafeAreaInsetsContext.Provider
      value={{ top: 59, bottom: 34, left: 0, right: 0 }}
    >
      <ProjectProvider>
        <View>
          <ProjectSwitcher />
          <ProjectConsumer />
        </View>
      </ProjectProvider>
    </SafeAreaInsetsContext.Provider>,
  );
  await screen.findByLabelText(`Switch project, current project ${first.name}`);
}

test("the header names the active project and selection changes the real scoped context", async () => {
  await show();
  expect(screen.getByTestId("visible-projects").props.children).toBe(first._id);
  await fireEvent.press(screen.getByTestId("project-switcher"));
  expect(
    screen.getByRole("radio", { name: first.name }).props.accessibilityState
      .checked,
  ).toBe(true);
  expect(
    screen.getByRole("radio", { name: second.name }).props.accessibilityState
      .checked,
  ).toBe(false);
  expect(screen.queryByText("All projects")).toBeNull();
  await fireEvent.press(screen.getByRole("radio", { name: second.name }));
  expect(
    screen.getByLabelText(`Switch project, current project ${second.name}`),
  ).toBeTruthy();
  expect(screen.getByTestId("visible-projects").props.children).toBe(
    second._id,
  );
  expect(screen.queryByRole("header", { name: "Switch project" })).toBeNull();
});

test("ARIA aliases preserve expanded and checked native states when choosing and reopening", async () => {
  await show();
  expect(
    screen.getByTestId("project-switcher").props.accessibilityState.expanded,
  ).toBe(false);
  await fireEvent.press(screen.getByTestId("project-switcher"));
  expect(
    screen.getByTestId("project-switcher").props.accessibilityState.expanded,
  ).toBe(true);
  expect(
    screen.getByRole("radio", { name: first.name, checked: true }),
  ).toBeTruthy();
  expect(
    screen.getByRole("radio", { name: second.name, checked: false }),
  ).toBeTruthy();
  await fireEvent.press(screen.getByRole("radio", { name: second.name }));
  expect(
    screen.getByTestId("project-switcher").props.accessibilityState.expanded,
  ).toBe(false);
  await fireEvent.press(screen.getByTestId("project-switcher"));
  expect(
    screen.getByRole("radio", { name: first.name, checked: false }),
  ).toBeTruthy();
  expect(
    screen.getByRole("radio", { name: second.name, checked: true }),
  ).toBeTruthy();
});

test("search finds a project by name without changing the active context until selection", async () => {
  await show();
  await fireEvent.press(screen.getByTestId("project-switcher"));
  await fireEvent.changeText(
    screen.getByLabelText("Search projects to switch"),
    "  BETA  ",
  );
  expect(screen.queryByRole("radio", { name: first.name })).toBeNull();
  expect(screen.getByRole("radio", { name: second.name })).toBeTruthy();
  expect(screen.getByTestId("visible-projects").props.children).toBe(first._id);
  await fireEvent.press(screen.getByRole("radio", { name: second.name }));
  expect(screen.getByTestId("visible-projects").props.children).toBe(
    second._id,
  );
});

test("closing a filtered chooser keeps the current project and resets search on reopening", async () => {
  await show();
  await fireEvent.press(screen.getByTestId("project-switcher"));
  await fireEvent.changeText(
    screen.getByLabelText("Search projects to switch"),
    "missing",
  );
  expect(screen.getByText("No matching projects")).toBeTruthy();
  await fireEvent.press(
    screen.getByRole("button", { name: "Close project switcher" }),
  );
  expect(screen.getByTestId("visible-projects").props.children).toBe(first._id);
  await fireEvent.press(screen.getByTestId("project-switcher"));
  expect(screen.getByLabelText("Search projects to switch").props.value).toBe(
    "",
  );
  expect(screen.getAllByRole("radio")).toHaveLength(2);
});

test("the project list allows a keyboard-open selection and leaves space above the home indicator", async () => {
  await show();
  await fireEvent.press(screen.getByTestId("project-switcher"));
  const list: ReturnType<typeof screen.getByTestId> = screen.getByTestId(
    "project-switcher-list",
  );
  expect(list.props.keyboardShouldPersistTaps).toBe("handled");
  expect(list.props.contentContainerStyle.paddingBottom).toBeGreaterThanOrEqual(
    34 + 40,
  );
});

test("a failed initial load offers retry from the global chooser", async () => {
  mockFetchProjects.mockRejectedValueOnce(new Error("Network down"));
  await render(
    <ProjectProvider>
      <ProjectSwitcher />
    </ProjectProvider>,
  );
  await fireEvent.press(screen.getByTestId("project-switcher"));
  const retry: Awaited<ReturnType<typeof screen.findByRole>> =
    await screen.findByRole("button", {
      name: "Retry loading projects",
    });
  await fireEvent.press(retry);
  expect(screen.getByRole("radio", { name: first.name })).toBeTruthy();
  expect(mockFetchProjects).toHaveBeenCalledTimes(2);
});

test("dismissing the sheet backdrop leaves the active project unchanged", async () => {
  await show();
  await fireEvent.press(screen.getByTestId("project-switcher"));
  await fireEvent.press(
    screen.getByRole("button", {
      name: "Dismiss project switcher",
      includeHiddenElements: true,
    }),
  );
  expect(screen.queryByRole("header", { name: "Switch project" })).toBeNull();
  expect(screen.getByTestId("visible-projects").props.children).toBe(first._id);
});

test.each([
  { width: 320, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
])(
  "the project sheet fits a $width × $height display and can shrink above the keyboard",
  async ({ width, height }: { width: number; height: number }) => {
    jest
      .spyOn(Dimensions, "get")
      .mockReturnValue({ width, height, scale: 2, fontScale: 1 });
    await show();
    await fireEvent.press(screen.getByTestId("project-switcher"));
    const sheetStyle: ViewStyle = StyleSheet.flatten(
      screen.getByTestId("project-switcher-sheet").props.style,
    ) as ViewStyle;
    expect(Number(sheetStyle.height)).toBeLessThanOrEqual(height - 59 - 32);
    expect(sheetStyle.maxWidth).toBe(640);
    expect(sheetStyle.flexShrink).toBe(1);
    expect(sheetStyle.borderTopLeftRadius).toBe(radius.xl);
    expect(sheetStyle.borderTopRightRadius).toBe(radius.xl);
    expect(
      screen.getByText(
        "One project at a time. Your selection stays with you when you reopen the app.",
      ),
    ).toBeTruthy();
  },
);

type Element = ReturnType<typeof screen.getByTestId>;

function flatStyle(element: Element): ViewStyle {
  return StyleSheet.flatten(element.props.style) as ViewStyle;
}

async function showInTheme(): Promise<void> {
  jest.spyOn(Appearance, "setColorScheme").mockImplementation(() => {
    return undefined;
  });
  await render(
    <ThemeProvider>
      <SafeAreaInsetsContext.Provider
        value={{ top: 59, bottom: 34, left: 0, right: 0 }}
      >
        <ProjectProvider>
          <View>
            <ProjectSwitcher />
            <ProjectConsumer />
          </View>
        </ProjectProvider>
      </SafeAreaInsetsContext.Provider>
    </ThemeProvider>,
  );
  await screen.findByLabelText(`Switch project, current project ${first.name}`);
}

describe("The header pill", () => {
  test("shows the active project's two-letter initials beside its name", async () => {
    await show();
    const pill: ReturnType<typeof within> = within(
      screen.getByTestId("project-switcher"),
    );

    expect(
      within(screen.getByTestId("project-switcher-avatar")).getByText("AP"),
    ).toBeTruthy();
    expect(pill.getByText("Project")).toBeTruthy();
    expect(pill.getByText(first.name).props.numberOfLines).toBe(1);
  });

  test("uses a single initial for a one-word project and skips punctuation", async () => {
    mockFetchProjects.mockResolvedValue(
      makeListResponse([makeProject({ _id: "solo", name: "(ops)" })]),
    );
    await render(
      <ProjectProvider>
        <ProjectSwitcher />
      </ProjectProvider>,
    );
    await screen.findByLabelText("Switch project, current project (ops)");

    expect(
      within(screen.getByTestId("project-switcher-avatar")).getByText("O"),
    ).toBeTruthy();
  });

  test("offers to choose a project, with an icon instead of initials, when none is active", async () => {
    mockFetchProjects.mockResolvedValue(makeListResponse<ProjectItem>([]));
    await render(
      <ProjectProvider>
        <ProjectSwitcher />
      </ProjectProvider>,
    );

    await waitFor(() => {
      expect(
        within(screen.getByTestId("project-switcher")).getByText(
          "Choose project",
        ),
      ).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "Choose project" })).toBeTruthy();
    expect(
      within(screen.getByTestId("project-switcher-avatar")).queryByText(
        /^[A-Z]{1,2}$/,
      ),
    ).toBeNull();
  });

  test("is drawn from light tokens by default", async () => {
    await show();

    expect(screen.getByTestId("project-switcher")).toHaveStyle({
      backgroundColor: lightColors.backgroundElevated,
      borderColor: lightColors.borderSubtle,
      borderRadius: radius.pill,
      minHeight: 44,
    });
    expect(screen.getByTestId("project-switcher-avatar")).toHaveStyle({
      backgroundColor: lightColors.actionPrimary,
    });
    expect(screen.getByText("AP")).toHaveStyle({
      color: lightColors.textInverse,
    });
  });

  test.each([
    ["a phone on its side", { width: 852, height: 393 }],
    ["a small phone on its side", { width: 568, height: 320 }],
  ])(
    "on %s it slims to fit a 32-point bar, keeping a 44-point touch area",
    async (_label: string, size: { width: number; height: number }) => {
      jest
        .spyOn(Dimensions, "get")
        .mockReturnValue({ ...size, scale: 3, fontScale: 1 });
      await show();

      const pill: ReturnType<typeof screen.getByTestId> =
        screen.getByTestId("project-switcher");
      const style: ViewStyle = flatStyle(pill);
      const hitSlop: { top: number; bottom: number } = pill.props.hitSlop;
      expect(Number(style.minHeight)).toBeLessThanOrEqual(32);
      expect(
        Number(style.minHeight) + hitSlop.top + hitSlop.bottom,
      ).toBeGreaterThanOrEqual(44);
      expect(screen.getByTestId("project-switcher-avatar")).toHaveStyle({
        width: 24,
        height: 24,
        borderRadius: 12,
      });
      // The name stays, on one line; the "Project" caption above it goes.
      expect(within(pill).getByText(first.name).props.numberOfLines).toBe(1);
      expect(within(pill).queryByText("Project")).toBeNull();
      expect(
        screen.getByRole("button", {
          name: `Switch project, current project ${first.name}`,
        }),
      ).toBeTruthy();
    },
  );

  test("a window of ordinary height keeps the full pill with its caption", async () => {
    jest
      .spyOn(Dimensions, "get")
      .mockReturnValue({ width: 951, height: 669, scale: 3, fontScale: 1 });
    await show();

    const pill: ReturnType<typeof screen.getByTestId> =
      screen.getByTestId("project-switcher");
    expect(flatStyle(pill).minHeight).toBe(44);
    expect(within(pill).getByText("Project")).toBeTruthy();
    expect(screen.getByTestId("project-switcher-avatar")).toHaveStyle({
      width: 32,
      height: 32,
    });
  });

  test.each([
    { width: 280, maxWidth: 160 },
    { width: 320, maxWidth: 192 },
    { width: 390, maxWidth: 262 },
    { width: 768, maxWidth: 300 },
  ])(
    "leaves room for the back button and header actions at $width points",
    async ({ width, maxWidth }: { width: number; maxWidth: number }) => {
      jest
        .spyOn(Dimensions, "get")
        .mockReturnValue({ width, height: 740, scale: 2, fontScale: 1 });
      await show();

      const style: ViewStyle = flatStyle(
        screen.getByTestId("project-switcher"),
      );
      expect(style.maxWidth).toBe(maxWidth);
      expect(Number(style.maxWidth)).toBeLessThanOrEqual(width);
      expect(
        within(screen.getByTestId("project-switcher")).getByText(first.name)
          .props.numberOfLines,
      ).toBe(1);
    },
  );
});

describe("The project sheet", () => {
  test("marks the current project with an accent row and filled avatar", async () => {
    await show();
    await fireEvent.press(screen.getByTestId("project-switcher"));

    const selected: Element = screen.getByTestId(
      `project-switcher-option-${first._id}`,
    );
    const other: Element = screen.getByTestId(
      `project-switcher-option-${second._id}`,
    );
    expect(selected).toHaveStyle({
      backgroundColor: lightColors.cardAccent,
      borderColor: lightColors.actionPrimary,
      borderWidth: 2,
    });
    expect(other).toHaveStyle({
      backgroundColor: lightColors.backgroundElevated,
      borderColor: lightColors.borderSubtle,
      borderWidth: 1,
    });
    expect(within(selected).getByText("Current project")).toHaveStyle({
      color: lightColors.actionPrimary,
    });
    expect(within(other).queryByText("Current project")).toBeNull();
    expect(within(selected).getByText("AP")).toBeTruthy();
    expect(within(other).getByText("BS")).toBeTruthy();
  });

  test("the thicker selected border does not shift the row's content", async () => {
    await show();
    await fireEvent.press(screen.getByTestId("project-switcher"));

    const selected: ViewStyle = flatStyle(
      screen.getByTestId(`project-switcher-option-${first._id}`),
    );
    const other: ViewStyle = flatStyle(
      screen.getByTestId(`project-switcher-option-${second._id}`),
    );
    expect(
      Number(selected.paddingHorizontal) + Number(selected.borderWidth),
    ).toBe(Number(other.paddingHorizontal) + Number(other.borderWidth));
    expect(
      Number(selected.paddingVertical) + Number(selected.borderWidth),
    ).toBe(Number(other.paddingVertical) + Number(other.borderWidth));
  });

  test("an account with no projects is told how to get one", async () => {
    mockFetchProjects.mockResolvedValue(makeListResponse<ProjectItem>([]));
    await render(
      <ProjectProvider>
        <ProjectSwitcher />
      </ProjectProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText("Choose project")).toBeTruthy();
    });
    await fireEvent.press(screen.getByTestId("project-switcher"));

    const empty: ReturnType<typeof within> = within(
      screen.getByTestId("project-switcher-empty"),
    );
    expect(empty.getByText("No projects available")).toBeTruthy();
    expect(
      empty.getByText("Ask your team to invite you to a project."),
    ).toBeTruthy();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  test("a failed load is announced as an alert above the retry", async () => {
    mockFetchProjects.mockRejectedValueOnce(new Error("Network down"));
    await render(
      <ProjectProvider>
        <ProjectSwitcher />
      </ProjectProvider>,
    );
    await fireEvent.press(screen.getByTestId("project-switcher"));

    const error: ReturnType<typeof within> = within(
      await screen.findByTestId("project-switcher-error"),
    );
    expect(
      error.getByRole("alert", {
        name: "Could not load projects. Check your connection and try again.",
      }),
    ).toHaveStyle({ color: lightColors.statusError });
    expect(
      error.getByRole("button", { name: "Retry loading projects" }),
    ).toBeTruthy();
  });

  test("the close control keeps a 48 point target", async () => {
    await show();
    await fireEvent.press(screen.getByTestId("project-switcher"));

    expect(
      screen.getByRole("button", { name: "Close project switcher" }),
    ).toHaveStyle({ minWidth: 48, minHeight: 48 });
  });
});

describe("In dark mode", () => {
  function expectSheetColors(colors: ColorTokens): void {
    expect(screen.getByTestId("project-switcher-sheet")).toHaveStyle({
      backgroundColor: colors.backgroundSecondary,
      borderColor: colors.borderSubtle,
    });
    const selected: Element = screen.getByTestId(
      `project-switcher-option-${first._id}`,
    );
    const other: Element = screen.getByTestId(
      `project-switcher-option-${second._id}`,
    );
    expect(selected).toHaveStyle({
      backgroundColor: colors.cardAccent,
      borderColor: colors.actionPrimary,
    });
    expect(other).toHaveStyle({
      backgroundColor: colors.backgroundElevated,
      borderColor: colors.borderSubtle,
    });
    expect(
      screen.getByTestId(`project-switcher-option-avatar-${first._id}`),
    ).toHaveStyle({ backgroundColor: colors.actionPrimary });
    expect(within(selected).getByText("AP")).toHaveStyle({
      color: colors.textInverse,
    });
    expect(
      screen.getByTestId(`project-switcher-option-avatar-${second._id}`),
    ).toHaveStyle({ backgroundColor: colors.cardAccent });
    expect(within(other).getByText("BS")).toHaveStyle({
      color: colors.actionPrimary,
    });
    expect(within(other).getByText(second.name)).toHaveStyle({
      color: colors.textPrimary,
    });
    expect(screen.getByRole("header", { name: "Switch project" })).toHaveStyle({
      color: colors.textPrimary,
    });
  }

  test("the header pill follows a dark device", async () => {
    mockSystemScheme = "dark";
    await showInTheme();

    expect(screen.getByTestId("project-switcher")).toHaveStyle({
      backgroundColor: darkColors.backgroundElevated,
      borderColor: darkColors.borderSubtle,
    });
    expect(screen.getByTestId("project-switcher-avatar")).toHaveStyle({
      backgroundColor: darkColors.actionPrimary,
    });
    expect(screen.getByText("AP")).toHaveStyle({
      color: darkColors.textInverse,
    });
    expect(
      within(screen.getByTestId("project-switcher")).getByText(first.name),
    ).toHaveStyle({ color: darkColors.textPrimary });
    expect(
      within(screen.getByTestId("project-switcher")).getByText("Project"),
    ).toHaveStyle({ color: darkColors.textSecondary });
  });

  test("the sheet, rows and avatars use dark tokens", async () => {
    mockSystemScheme = "dark";
    await showInTheme();
    await fireEvent.press(screen.getByTestId("project-switcher"));

    expectSheetColors(darkColors);
    expect(
      flatStyle(screen.getByTestId("project-switcher-sheet")).borderWidth,
    ).toBe(1);
  });

  test("an explicit Dark choice wins over a light device", async () => {
    mockSystemScheme = "light";
    await AsyncStorage.setItem("oneuptime_appearance", "dark");
    await showInTheme();

    await waitFor(() => {
      expect(screen.getByTestId("project-switcher")).toHaveStyle({
        backgroundColor: darkColors.backgroundElevated,
      });
    });
    await fireEvent.press(screen.getByTestId("project-switcher"));
    expectSheetColors(darkColors);
  });

  test("a light device keeps the light palette and no sheet edge", async () => {
    await showInTheme();
    await fireEvent.press(screen.getByTestId("project-switcher"));

    expectSheetColors(lightColors);
    expect(
      flatStyle(screen.getByTestId("project-switcher-sheet")).borderWidth,
    ).toBe(0);
  });

  test("selection still works in dark mode", async () => {
    mockSystemScheme = "dark";
    await showInTheme();
    await fireEvent.press(screen.getByTestId("project-switcher"));
    await fireEvent.press(screen.getByRole("radio", { name: second.name }));

    expect(screen.getByTestId("visible-projects").props.children).toBe(
      second._id,
    );
    expect(
      screen.getByLabelText(`Switch project, current project ${second.name}`),
    ).toBeTruthy();
  });

  test("the 320 point sheet still fits in dark mode", async () => {
    mockSystemScheme = "dark";
    jest
      .spyOn(Dimensions, "get")
      .mockReturnValue({ width: 320, height: 568, scale: 2, fontScale: 1 });
    await showInTheme();
    await fireEvent.press(screen.getByTestId("project-switcher"));

    const sheet: ViewStyle = flatStyle(
      screen.getByTestId("project-switcher-sheet"),
    );
    expect(Number(sheet.height)).toBeLessThanOrEqual(568 - 59 - 32);
    expect(sheet.width).toBe("100%");
    expect(flatStyle(screen.getByTestId("project-switcher")).maxWidth).toBe(
      192,
    );
  });
});

describe("One project sheet for the whole app", () => {
  /*
   * On a foldable the headers move: the list's header belongs to the stack
   * on the cover screen and to the list pane when unfolded. The sheet lives
   * in a host above the navigation, so it stays open - mid-search - while
   * the header that opened it is taken away and drawn again elsewhere.
   */
  function hosted(headers: number): React.JSX.Element {
    return (
      <SafeAreaInsetsContext.Provider
        value={{ top: 59, bottom: 34, left: 0, right: 0 }}
      >
        <ProjectProvider>
          <ProjectSwitcherHost>
            <View>
              {Array.from({ length: headers }, (_: unknown, index: number) => {
                return (
                  <View key={index} testID={`header-${index}`}>
                    <ProjectSwitcher />
                  </View>
                );
              })}
              <ProjectConsumer />
            </View>
          </ProjectSwitcherHost>
        </ProjectProvider>
      </SafeAreaInsetsContext.Provider>
    );
  }

  test("however many headers show the switcher, they open one and the same sheet", async () => {
    await render(hosted(2));
    await screen.findAllByLabelText(
      `Switch project, current project ${first.name}`,
    );

    await fireEvent.press(
      within(screen.getByTestId("header-1")).getByTestId("project-switcher"),
    );

    expect(
      screen.getAllByRole("header", { name: "Switch project" }),
    ).toHaveLength(1);
    for (const button of screen.getAllByTestId("project-switcher")) {
      expect(button.props.accessibilityState.expanded).toBe(true);
    }
  });

  test("the sheet and its search outlive the header that opened it", async () => {
    const view: Awaited<ReturnType<typeof render>> = await render(hosted(1));
    await screen.findByLabelText(
      `Switch project, current project ${first.name}`,
    );
    await fireEvent.press(screen.getByTestId("project-switcher"));
    await fireEvent.changeText(
      screen.getByLabelText("Search projects to switch"),
      "Beta",
    );

    // The fold: the header that held the switcher goes away.
    await view.rerender(hosted(0));

    expect(screen.queryByTestId("project-switcher")).toBeNull();
    expect(screen.getByRole("header", { name: "Switch project" })).toBeTruthy();
    expect(screen.getByLabelText("Search projects to switch").props.value).toBe(
      "Beta",
    );

    // Drawn again in its new place, the switcher reports the sheet as open.
    await view.rerender(hosted(1));
    expect(
      screen.getByTestId("project-switcher").props.accessibilityState.expanded,
    ).toBe(true);

    await fireEvent.press(screen.getByRole("radio", { name: second.name }));
    expect(screen.getByTestId("visible-projects").props.children).toBe(
      second._id,
    );
    expect(screen.queryByRole("header", { name: "Switch project" })).toBeNull();
  });

  test("closing the sheet resets its search for next time", async () => {
    await render(hosted(1));
    await screen.findByLabelText(
      `Switch project, current project ${first.name}`,
    );
    await fireEvent.press(screen.getByTestId("project-switcher"));
    await fireEvent.changeText(
      screen.getByLabelText("Search projects to switch"),
      "Beta",
    );
    await fireEvent.press(screen.getByLabelText("Close project switcher"));
    await fireEvent.press(screen.getByTestId("project-switcher"));

    expect(screen.getByLabelText("Search projects to switch").props.value).toBe(
      "",
    );
  });
});
