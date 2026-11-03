import React from "react";
import {
  Keyboard,
  StyleSheet,
  Text,
  View,
  type EmitterSubscription,
  type ViewStyle,
} from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  act,
  fireEvent,
  render,
  screen,
  type RenderResult,
} from "@testing-library/react-native";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import AddNoteModal from "./AddNoteModal";
import CaseSheet from "./security/CaseSheet";
import UserPickerModal from "./UserPickerModal";
import ProjectSwitcher from "./ProjectSwitcher";
import { ProjectProvider } from "../hooks/useProject";
import { fetchProjects } from "../api/projects";
import { WindowLayoutProvider } from "../layout/WindowLayout";
import { TABLETOP_FOLD_GAP } from "../layout/windowLayout";
import { getScreenBottomPadding } from "../theme/layout";
import { radius, spacing } from "../theme/tokens";
import { makeListResponse, makeProject } from "../__tests__/testSupport";
import {
  TEST_WINDOWS,
  resetWindowSize,
  setWindowSize,
} from "../__tests__/windowSize";
import {
  createTestPostureSource,
  flatReport,
  tabletopReport,
  type TestPostureSource,
} from "../__tests__/postureTestSource";

/*
 * Every bottom sheet half open on a table - the note sheet, a security case's
 * sheets (CaseSheet), the person picker and the project switcher. Each rises
 * over the half lying on the table and stops at the band around the fold;
 * with the keyboard up it hangs above the fold, the keys below it, as on a
 * laptop. Anywhere else each is exactly the sheet it was.
 */

/*
 * React Native's KeyboardAvoidingView, as a plain view that shows whether it
 * is on: the test renderer keeps only host views, and `enabled` is the
 * composite's own prop.
 */
jest.mock(
  "react-native/Libraries/Components/Keyboard/KeyboardAvoidingView",
  () => {
    const ReactModule: typeof React = jest.requireActual("react");
    const { View: HostView } =
      jest.requireActual<typeof import("react-native")>("react-native");
    function KeyboardAvoidingViewStub(props: {
      enabled?: boolean;
      testID?: string;
      style?: unknown;
      children?: React.ReactNode;
    }): React.JSX.Element {
      return ReactModule.createElement(
        HostView as unknown as React.ComponentType<Record<string, unknown>>,
        {
          testID: props.testID,
          style: props.style,
          keyboardAvoidingEnabled: props.enabled !== false,
        },
        props.children,
      );
    }
    return { __esModule: true, default: KeyboardAvoidingViewStub };
  },
);

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

const SIZE: { width: number; height: number } =
  TEST_WINDOWS.innerScreenOnItsSide;
const INSETS: { top: number; right: number; bottom: number; left: number } = {
  top: 24,
  right: 0,
  bottom: 16,
  left: 0,
};
// The half below the fold, and the room above it under the status bar.
const BELOW_FOLD: number = SIZE.height - (442 + TABLETOP_FOLD_GAP / 2);
const ABOVE_FOLD: number = 442 - TABLETOP_FOLD_GAP / 2 - INSETS.top;

type KeyboardListener = () => void;
let keyboardListeners: Map<string, Set<KeyboardListener>>;

beforeEach(() => {
  keyboardListeners = new Map();
  jest.spyOn(Keyboard, "addListener").mockImplementation(((
    eventName: string,
    listener: KeyboardListener,
  ): EmitterSubscription => {
    const listeners: Set<KeyboardListener> =
      keyboardListeners.get(eventName) ?? new Set();
    listeners.add(listener);
    keyboardListeners.set(eventName, listeners);
    return {
      remove: (): void => {
        listeners.delete(listener);
      },
    } as unknown as EmitterSubscription;
  }) as unknown as typeof Keyboard.addListener);
  jest.spyOn(Keyboard, "isVisible").mockReturnValue(false);
});

afterEach(() => {
  jest.restoreAllMocks();
  resetWindowSize();
});

// The keyboard coming up or going down, as each platform says it.
async function keyboard(shown: boolean): Promise<void> {
  const names: Array<string> = shown
    ? ["keyboardWillShow", "keyboardDidShow"]
    : ["keyboardWillHide", "keyboardDidHide"];
  await act(async () => {
    for (const name of names) {
      for (const listener of Array.from(keyboardListeners.get(name) ?? [])) {
        listener();
      }
    }
  });
}

function flat(style: unknown): ViewStyle {
  return (StyleSheet.flatten(style as ViewStyle) ?? {}) as ViewStyle;
}

async function renderIn(
  source: TestPostureSource,
  children: React.ReactNode,
): Promise<RenderResult> {
  setWindowSize(SIZE);
  return render(
    <SafeAreaInsetsContext.Provider value={INSETS}>
      <WindowLayoutProvider postureSource={source}>
        {children}
      </WindowLayoutProvider>
    </SafeAreaInsetsContext.Provider>,
  );
}

function tabletop(): TestPostureSource {
  return createTestPostureSource(tabletopReport(SIZE, 442));
}

function noop(): void {
  // Not pressed here.
}

describe("the note sheet", () => {
  function noteSheet(): React.JSX.Element {
    return (
      <AddNoteModal
        visible
        onClose={noop}
        onSubmit={noop}
        isSubmitting={false}
      />
    );
  }

  test("half open on a table it rises over the half on the table and stops at the band", async () => {
    await renderIn(tabletop(), noteSheet());

    const sheet: ViewStyle = flat(
      screen.getByTestId("add-note-sheet").props.style,
    );
    expect(sheet.maxHeight).toBe(BELOW_FOLD);
    expect(sheet).toMatchObject({
      borderTopLeftRadius: radius.xl,
      borderBottomLeftRadius: 0,
    });
    const backdrop: ReturnType<typeof screen.getByTestId> =
      screen.getByTestId("add-note-backdrop");
    expect(flat(backdrop.props.style).justifyContent).toBe("flex-end");
    // The placement keeps it off the crease; the keyboard does not push it across.
    expect(backdrop.props.keyboardAvoidingEnabled).toBe(false);
  });

  test("the smaller writing box, so Submit stays in view in half a window", async () => {
    await renderIn(tabletop(), noteSheet());

    expect(
      flat(screen.getByTestId("add-note-input").props.style).minHeight,
    ).toBe(88);
  });

  test("with the keyboard up it hangs above the fold, every corner round, and goes back down with the keyboard", async () => {
    await renderIn(tabletop(), noteSheet());
    await keyboard(true);

    const backdrop: ViewStyle = flat(
      screen.getByTestId("add-note-backdrop").props.style,
    );
    expect(backdrop).toMatchObject({
      justifyContent: "flex-start",
      paddingTop: INSETS.top,
    });
    const sheet: ViewStyle = flat(
      screen.getByTestId("add-note-sheet").props.style,
    );
    expect(sheet.maxHeight).toBe(ABOVE_FOLD);
    expect(sheet).toMatchObject({
      borderBottomLeftRadius: radius.xl,
      borderBottomRightRadius: radius.xl,
    });

    await keyboard(false);
    expect(
      flat(screen.getByTestId("add-note-backdrop").props.style).justifyContent,
    ).toBe("flex-end");
  });

  test("a half-written note survives the keyboard moving the sheet", async () => {
    await renderIn(tabletop(), noteSheet());
    await fireEvent.changeText(
      screen.getByTestId("add-note-input"),
      "Rolled back the deploy",
    );

    await keyboard(true);
    await keyboard(false);

    expect(screen.getByTestId("add-note-input")).toHaveProp(
      "value",
      "Rolled back the deploy",
    );
  });

  test("lying flat it is the sheet it always was: 92% at most, above the keyboard by itself", async () => {
    await renderIn(createTestPostureSource(flatReport(SIZE)), noteSheet());
    await keyboard(true);

    const backdrop: ReturnType<typeof screen.getByTestId> =
      screen.getByTestId("add-note-backdrop");
    expect(flat(backdrop.props.style).justifyContent).toBe("flex-end");
    expect(backdrop.props.keyboardAvoidingEnabled).toBe(true);
    expect(
      flat(screen.getByTestId("add-note-sheet").props.style).maxHeight,
    ).toBe("92%");
  });

  test("the window's bottom inset, though it was opened from a pane above the fold", async () => {
    await renderIn(
      tabletop(),
      <SafeAreaInsetsContext.Provider value={{ ...INSETS, bottom: 0 }}>
        {noteSheet()}
      </SafeAreaInsetsContext.Provider>,
    );

    const scroll: ReturnType<typeof screen.getByTestId> =
      screen.getByTestId("add-note-sheet");
    const content: ViewStyle = flat(
      (
        scroll.props.children as React.ReactElement<{
          contentContainerStyle: unknown;
        }>
      ).props.contentContainerStyle,
    );
    expect(content.paddingBottom).toBe(
      Math.max(getScreenBottomPadding(INSETS.bottom, false), spacing.xl),
    );
  });
});

describe("a security case's sheet", () => {
  function caseSheet(): React.JSX.Element {
    return (
      <CaseSheet
        visible
        testID="case-status-sheet"
        icon="git-commit-outline"
        title="Change status"
        onClose={noop}
      >
        <Text>Choices</Text>
      </CaseSheet>
    );
  }

  test("rises over the half on the table, and hangs above the fold while typing", async () => {
    await renderIn(tabletop(), caseSheet());

    expect(
      flat(screen.getByTestId("case-status-sheet").props.style).maxHeight,
    ).toBe(BELOW_FOLD);
    expect(
      screen.getByTestId("case-status-sheet-backdrop").props
        .keyboardAvoidingEnabled,
    ).toBe(false);

    await keyboard(true);
    expect(
      flat(screen.getByTestId("case-status-sheet").props.style).maxHeight,
    ).toBe(ABOVE_FOLD);
    expect(
      flat(screen.getByTestId("case-status-sheet-backdrop").props.style)
        .justifyContent,
    ).toBe("flex-start");
  });

  test("lying flat: as it always was", async () => {
    await renderIn(createTestPostureSource(flatReport(SIZE)), caseSheet());

    expect(
      flat(screen.getByTestId("case-status-sheet").props.style).maxHeight,
    ).toBe("92%");
  });
});

describe("the person picker", () => {
  function picker(): React.JSX.Element {
    return (
      <UserPickerModal
        visible
        title="Who covers for you?"
        users={[]}
        isLoading={false}
        selectedUserId={null}
        onSelect={noop}
        onClose={noop}
      />
    );
  }

  test("rises over the half on the table, its search above the fold while typing", async () => {
    await renderIn(tabletop(), picker());

    expect(
      flat(screen.getByTestId("user-picker-sheet").props.style).maxHeight,
    ).toBe(BELOW_FOLD);

    await keyboard(true);
    const sheet: ViewStyle = flat(
      screen.getByTestId("user-picker-sheet").props.style,
    );
    expect(sheet.maxHeight).toBe(ABOVE_FOLD);
    expect(sheet.borderBottomWidth).toBe(1);
  });

  test("lying flat: 85% at most, as it always was", async () => {
    await renderIn(createTestPostureSource(flatReport(SIZE)), picker());

    expect(
      flat(screen.getByTestId("user-picker-sheet").props.style).maxHeight,
    ).toBe("85%");
  });
});

describe("the project switcher", () => {
  const mockFetchProjects: jest.MockedFunction<typeof fetchProjects> =
    fetchProjects as jest.MockedFunction<typeof fetchProjects>;

  beforeEach(async () => {
    await AsyncStorage.clear();
    mockFetchProjects.mockReset();
    mockFetchProjects.mockResolvedValue(
      makeListResponse([
        makeProject({ _id: "project-a", name: "Acme Production" }),
      ]),
    );
  });

  async function openSwitcher(source: TestPostureSource): Promise<void> {
    await renderIn(
      source,
      <ProjectProvider>
        <View>
          <ProjectSwitcher />
        </View>
      </ProjectProvider>,
    );
    await screen.findByLabelText(
      "Switch project, current project Acme Production",
    );
    await fireEvent.press(screen.getByTestId("project-switcher"));
  }

  test("half open on a table, it takes the half on the table - never the whole window", async () => {
    await openSwitcher(tabletop());

    expect(
      flat(screen.getByTestId("project-switcher-sheet").props.style).height,
    ).toBe(BELOW_FOLD);
  });

  test("with the keyboard up, it hangs above the fold", async () => {
    await openSwitcher(tabletop());
    await keyboard(true);

    expect(
      flat(screen.getByTestId("project-switcher-sheet").props.style).height,
    ).toBe(ABOVE_FOLD);
  });

  test("lying flat: as tall as the window allows, up to 660 points", async () => {
    await openSwitcher(createTestPostureSource(flatReport(SIZE)));

    expect(
      flat(screen.getByTestId("project-switcher-sheet").props.style).height,
    ).toBe(Math.min(660, SIZE.height - INSETS.top - 32));
  });
});
