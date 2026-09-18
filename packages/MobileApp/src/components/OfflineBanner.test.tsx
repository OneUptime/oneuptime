import React from "react";
import { StyleSheet, type TextStyle, type ViewStyle } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import OfflineBanner from "./OfflineBanner";
import { ThemeProvider, darkColors, lightColors } from "../theme";

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

function flat(element: { props: { style?: unknown } }): ViewStyle & TextStyle {
  return (StyleSheet.flatten(element.props.style as ViewStyle) ??
    {}) as ViewStyle & TextStyle;
}

/** The absolutely positioned strip, found from its message. */
function strip(): { props: { style?: unknown; pointerEvents?: string } } {
  return screen.getByText("No internet connection").parent
    ?.parent as unknown as {
    props: { style?: unknown; pointerEvents?: string };
  };
}

/*
 * App.tsx renders this banner above the whole navigator, so it is not just a
 * strip of colour - it is a strip of colour laid over the top of every screen
 * in the app, including the navigation header. Two things therefore matter:
 * that it appears exactly when the device cannot reach the network, and that
 * it lets touches through to whatever it is covering.
 *
 * The second is the defect this file was written for. An absolutely
 * positioned view with 50pt of top padding and no `pointerEvents` is a touch
 * target: while the device was offline it swallowed every tap in that strip,
 * the back button included, which is exactly the wrong moment to make the app
 * feel frozen.
 *
 * The test renderer does no hit-testing, so there is no way to press "through"
 * the banner here and watch what happens; `pointerEvents` on the rendered view
 * is the observable that says the banner is out of the way, so that is what is
 * asserted.
 */

interface NetworkStatus {
  isConnected: boolean;
  isInternetReachable: boolean | null;
}

/*
 * The hook talks to NetInfo, which is native. The `mock` prefix is what lets
 * jest.mock's factory reach this despite hoisting.
 */
const mockNetworkStatus: { current: NetworkStatus } = {
  current: { isConnected: true, isInternetReachable: true },
};

jest.mock("../hooks/useNetworkStatus", () => {
  return {
    useNetworkStatus: () => {
      return mockNetworkStatus.current;
    },
  };
});

describe("When the banner is shown at all", () => {
  beforeEach(() => {
    mockNetworkStatus.current = {
      isConnected: true,
      isInternetReachable: true,
    };
  });

  test("nothing is rendered while the device is online", async () => {
    await render(<OfflineBanner />);

    expect(screen.queryByText("No internet connection")).toBeNull();
  });

  test("it appears when the connection drops", async () => {
    mockNetworkStatus.current = {
      isConnected: false,
      isInternetReachable: false,
    };

    await render(<OfflineBanner />);

    expect(screen.getByText("No internet connection")).toBeTruthy();
  });

  test("it appears when there is a connection that cannot reach the internet", async () => {
    /*
     * Captive-portal wifi: the handset is happily associated, and not one
     * request will land. From the responder's point of view that is offline.
     */
    mockNetworkStatus.current = {
      isConnected: true,
      isInternetReachable: false,
    };

    await render(<OfflineBanner />);

    expect(screen.getByText("No internet connection")).toBeTruthy();
  });

  test("reachability that is merely unknown is not treated as offline", async () => {
    /*
     * NetInfo reports null before it has finished probing. Claiming the app is
     * offline on that would flash the banner over the header on every launch.
     */
    mockNetworkStatus.current = {
      isConnected: true,
      isInternetReachable: null,
    };

    await render(<OfflineBanner />);

    expect(screen.queryByText("No internet connection")).toBeNull();
  });
});

describe("The banner does not take the touches of what it covers", () => {
  beforeEach(() => {
    mockNetworkStatus.current = {
      isConnected: false,
      isInternetReachable: false,
    };
  });

  test("it is transparent to touches", async () => {
    await render(<OfflineBanner />);

    expect(screen.root?.props.pointerEvents).toBe("none");
  });

  test("being transparent to touches does not stop it being read", async () => {
    /*
     * `pointerEvents: none` must not be reached for by hiding the banner - it
     * is the message that explains why nothing is loading.
     */
    await render(<OfflineBanner />);

    expect(screen.getByText("No internet connection")).toBeTruthy();
    expect(screen.root?.props.style.position).toBe("absolute");
  });
});

describe("Where the banner sits", () => {
  beforeEach(() => {
    mockNetworkStatus.current = {
      isConnected: false,
      isInternetReachable: false,
    };
  });

  test.each([0, 20, 47, 59])(
    "it clears a %dpt status bar or notch before its message",
    async (top: number) => {
      /*
       * App.tsx lays the banner over the very top of the screen. A guessed,
       * fixed padding either hid the message under a Dynamic Island or left a
       * tall empty red strip on a device with no notch.
       */
      await render(
        <SafeAreaInsetsContext.Provider
          value={{ top, bottom: 0, left: 0, right: 0 }}
        >
          <OfflineBanner />
        </SafeAreaInsetsContext.Provider>,
      );

      expect(flat(strip()).paddingTop).toBe(top + 8);
      expect(strip().props.pointerEvents).toBe("none");
    },
  );

  test("without a safe-area provider it still pads the message", async () => {
    await render(<OfflineBanner />);

    expect(flat(strip()).paddingTop).toBe(8);
  });

  test("it spans the full width above everything else", async () => {
    await render(<OfflineBanner />);

    expect(flat(strip())).toMatchObject({
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      zIndex: 100,
    });
  });
});

describe("How the banner is coloured", () => {
  beforeEach(() => {
    mockNetworkStatus.current = {
      isConnected: false,
      isInternetReachable: false,
    };
  });

  afterEach(() => {
    mockSystemScheme = "light";
  });

  test("an error-coloured strip with an inverse label and icon", async () => {
    await render(<OfflineBanner />);

    expect(flat(strip()).backgroundColor).toBe(lightColors.statusError);
    expect(screen.getByText("No internet connection")).toHaveStyle({
      color: lightColors.textInverse,
    });
    const icon: { props: { style?: unknown } } = screen.getByText(
      "No internet connection",
    ).parent?.children[0] as unknown as { props: { style?: unknown } };
    expect(flat(icon).color).toBe(lightColors.textInverse);
  });

  test("in dark mode the strip and its label use the dark palette", async () => {
    mockSystemScheme = "dark";
    await render(
      <ThemeProvider>
        <OfflineBanner />
      </ThemeProvider>,
    );

    expect(flat(strip()).backgroundColor).toBe(darkColors.statusError);
    expect(screen.getByText("No internet connection")).toHaveStyle({
      color: darkColors.textInverse,
    });
  });
});
