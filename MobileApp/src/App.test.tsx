import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react-native";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import App from "./App";
import { darkColors, lightColors, useTheme } from "./theme";

/*
 * App is the frame around everything: providers, the status bar, the
 * navigator and the offline banner laid over it. What it owns visually is
 * small and very visible - the status bar text must stay readable against
 * the canvas in both themes, and the canvas behind the navigator must match
 * the palette so nothing flashes white while screens mount.
 *
 * Everything below the frame is stubbed; auth, projects and navigation have
 * suites of their own.
 */

let mockSystemScheme: "light" | "dark" | null = "light";

/*
 * react-native exposes useColorScheme through a getter, which cannot be spied
 * on, so the module behind it is replaced instead.
 */
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => {
  return {
    __esModule: true,
    default: (): "light" | "dark" | null => {
      return mockSystemScheme;
    },
  };
});

/*
 * The real provider waits for native inset measurements that never arrive
 * under Jest, and renders nothing until they do.
 */
jest.mock("react-native-safe-area-context", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "react-native-safe-area-context",
  );
  return {
    ...actual,
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => {
      return children;
    },
  };
});

jest.mock("expo-status-bar", () => {
  const ReactModule: typeof React = jest.requireActual("react");
  const { Text } = jest.requireActual(
    "react-native",
  ) as typeof import("react-native");
  return {
    StatusBar: ({ style }: { style?: string }) => {
      return ReactModule.createElement(Text, { testID: "status-bar" }, style);
    },
  };
});

jest.mock("./hooks/useAuth", () => {
  return {
    AuthProvider: ({ children }: { children: React.ReactNode }) => {
      return children;
    },
  };
});

jest.mock("./hooks/useProject", () => {
  return {
    ProjectProvider: ({ children }: { children: React.ReactNode }) => {
      return children;
    },
  };
});

const mockThemeControl: {
  setPreference: ((preference: "system" | "light" | "dark") => void) | null;
} = { setPreference: null };

jest.mock("./navigation/RootNavigator", () => {
  const ReactModule: typeof React = jest.requireActual("react");
  const { Text } = jest.requireActual(
    "react-native",
  ) as typeof import("react-native");
  const theme: { useTheme: typeof useTheme } = jest.requireActual("./theme");
  return {
    __esModule: true,
    default: function RootNavigatorStub(): React.JSX.Element {
      mockThemeControl.setPreference = theme.useTheme().setPreference;
      return ReactModule.createElement(
        Text,
        { testID: "root-navigator" },
        "navigator",
      );
    },
  };
});

jest.mock("./components/OfflineBanner", () => {
  const ReactModule: typeof React = jest.requireActual("react");
  const { Text } = jest.requireActual(
    "react-native",
  ) as typeof import("react-native");
  return {
    __esModule: true,
    default: function OfflineBannerStub(): React.JSX.Element {
      return ReactModule.createElement(
        Text,
        { testID: "offline-banner" },
        "offline",
      );
    },
  };
});

afterEach(() => {
  mockSystemScheme = "light";
  mockThemeControl.setPreference = null;
});

type RenderedElement = ReturnType<typeof screen.getByTestId>;

function frame(): RenderedElement {
  return screen.getByTestId("status-bar").parent as RenderedElement;
}

describe("The app frame", () => {
  test("renders the navigator with the offline banner after it, so the banner lies on top", async () => {
    await render(<App />);

    const children: Array<unknown> = frame().children;
    expect(children).toContain(screen.getByTestId("root-navigator"));
    expect(
      children.indexOf(screen.getByTestId("offline-banner")),
    ).toBeGreaterThan(children.indexOf(screen.getByTestId("root-navigator")));
  });

  test("clips to the screen and fills it", async () => {
    await render(<App />);

    expect(frame()).toHaveStyle({ flex: 1, overflow: "hidden" });
  });
});

describe("The status bar and canvas follow the theme", () => {
  test("a light device gets dark status bar text on the light canvas", async () => {
    await render(<App />);

    expect(screen.getByTestId("status-bar")).toHaveTextContent("dark");
    expect(frame()).toHaveStyle({
      backgroundColor: lightColors.backgroundPrimary,
    });
  });

  test("a dark device gets light status bar text on the dark canvas", async () => {
    mockSystemScheme = "dark";
    await render(<App />);

    expect(screen.getByTestId("status-bar")).toHaveTextContent("light");
    expect(frame()).toHaveStyle({
      backgroundColor: darkColors.backgroundPrimary,
    });
  });

  test("choosing Dark in Settings flips the status bar without a restart", async () => {
    await render(<App />);
    expect(screen.getByTestId("status-bar")).toHaveTextContent("dark");

    await act(async (): Promise<void> => {
      mockThemeControl.setPreference?.("dark");
    });

    await waitFor((): void => {
      expect(screen.getByTestId("status-bar")).toHaveTextContent("light");
    });
    expect(frame()).toHaveStyle({
      backgroundColor: darkColors.backgroundPrimary,
    });
  });
});
