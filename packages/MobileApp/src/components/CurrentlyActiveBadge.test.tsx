import React from "react";
import { AccessibilityInfo, Animated, StyleSheet } from "react-native";
import { act, render, screen, waitFor } from "@testing-library/react-native";
import { afterEach, describe, expect, test } from "@jest/globals";
import CurrentlyActiveBadge, {
  CURRENTLY_ACTIVE_LABEL,
} from "./CurrentlyActiveBadge";
import { ThemeProvider, darkColors, lightColors } from "../theme";
import { radius } from "../theme/tokens";

let mockColorScheme: "light" | "dark" = "light";

/*
 * react-native exposes useColorScheme through a getter that cannot be spied
 * on, so the module behind it is replaced. Light unless a test says otherwise.
 */
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => {
  return {
    __esModule: true,
    default: (): "light" | "dark" => {
      return mockColorScheme;
    },
  };
});

/*
 * The marker on the status that is in effect right now: "Currently Active"
 * with a dot that beats. The beat is the part with rules - it must not start
 * until the OS has said motion is welcome, must never start for a reader who
 * asked for less, and must stop with the badge.
 */

type Rendered = ReturnType<typeof screen.getByTestId>;
type Style = Record<string, unknown>;

/*
 * The beating mark is hidden from assistive technology on purpose, and the
 * default queries honour that, so it is found with this option.
 */
const HIDDEN: { includeHiddenElements: boolean } = {
  includeHiddenElements: true,
};

function styleOf(element: Rendered): Style {
  return (StyleSheet.flatten(element.props.style) ?? {}) as Style;
}

function answerReduceMotionWith(enabled: boolean): void {
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockResolvedValue(enabled);
}

afterEach(() => {
  jest.restoreAllMocks();
  mockColorScheme = "light";
});

describe("What the badge says", () => {
  test('reads "Currently Active"', async () => {
    answerReduceMotionWith(false);

    await render(<CurrentlyActiveBadge />);

    expect(screen.getByText(CURRENTLY_ACTIVE_LABEL)).toBeTruthy();
    expect(CURRENTLY_ACTIVE_LABEL).toBe("Currently Active");
  });

  test("is announced once, as its words, with the moving mark hidden", async () => {
    answerReduceMotionWith(false);

    await render(<CurrentlyActiveBadge />);

    const badge: Rendered = screen.getByTestId("currently-active-badge");

    expect(badge.props.accessible).toBe(true);
    expect(badge.props.accessibilityLabel).toBe(CURRENTLY_ACTIVE_LABEL);

    const mark: Rendered = screen.getByTestId(
      "currently-active-badge-mark",
      HIDDEN,
    );

    expect(mark.props.importantForAccessibility).toBe("no-hide-descendants");
    expect(mark.props.accessibilityElementsHidden).toBe(true);

    // Out of the accessibility tree: a screen reader never lands on the dot.
    await waitFor(() => {
      expect(
        screen.getByTestId("currently-active-badge-pulse", HIDDEN),
      ).toBeTruthy();
    });
    expect(screen.queryByTestId("currently-active-badge-mark")).toBeNull();
    expect(screen.queryByTestId("currently-active-badge-pulse")).toBeNull();
  });

  test("never wraps its words onto a second line", async () => {
    answerReduceMotionWith(true);

    await render(<CurrentlyActiveBadge />);

    expect(screen.getByText(CURRENTLY_ACTIVE_LABEL).props.numberOfLines).toBe(
      1,
    );
  });
});

describe("How the badge looks", () => {
  test("is an indigo pill, the same marker as the web dashboard's", async () => {
    answerReduceMotionWith(true);

    await render(<CurrentlyActiveBadge />);

    expect(styleOf(screen.getByTestId("currently-active-badge"))).toMatchObject(
      {
        backgroundColor: lightColors.statusInfoBg,
        borderRadius: radius.pill,
        alignSelf: "flex-start",
        flexDirection: "row",
      },
    );
    expect(styleOf(screen.getByText(CURRENTLY_ACTIVE_LABEL))).toMatchObject({
      color: lightColors.statusInfo,
      fontWeight: "700",
    });
    expect(
      styleOf(screen.getByTestId("currently-active-badge-dot", HIDDEN)),
    ).toMatchObject({
      backgroundColor: lightColors.statusInfo,
      width: 6,
      height: 6,
      borderRadius: 3,
    });
  });

  test("follows dark mode", async () => {
    answerReduceMotionWith(false);
    mockColorScheme = "dark";

    await render(
      <ThemeProvider>
        <CurrentlyActiveBadge />
      </ThemeProvider>,
    );

    expect(styleOf(screen.getByTestId("currently-active-badge"))).toMatchObject(
      { backgroundColor: darkColors.statusInfoBg },
    );
    expect(styleOf(screen.getByText(CURRENTLY_ACTIVE_LABEL)).color).toBe(
      darkColors.statusInfo,
    );
    expect(
      styleOf(screen.getByTestId("currently-active-badge-dot", HIDDEN))
        .backgroundColor,
    ).toBe(darkColors.statusInfo);

    await waitFor(() => {
      expect(
        styleOf(screen.getByTestId("currently-active-badge-pulse", HIDDEN))
          .backgroundColor,
      ).toBe(darkColors.statusInfo);
    });
  });
});

describe("The beat and the reduce-motion setting", () => {
  test("beats for a reader who has not asked for less motion", async () => {
    answerReduceMotionWith(false);
    const loop: jest.SpyInstance = jest.spyOn(Animated, "loop");

    await render(<CurrentlyActiveBadge />);

    await waitFor(() => {
      expect(loop).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.getByTestId("currently-active-badge-pulse", HIDDEN),
    ).toBeTruthy();
  });

  test("the ring grows out of the dot and fades as it goes", async () => {
    answerReduceMotionWith(false);

    await render(<CurrentlyActiveBadge />);

    await waitFor(() => {
      expect(
        screen.getByTestId("currently-active-badge-pulse", HIDDEN),
      ).toBeTruthy();
    });

    const ring: Style = styleOf(
      screen.getByTestId("currently-active-badge-pulse", HIDDEN),
    );

    expect(ring["position"]).toBe("absolute");
    expect(ring["transform"]).toBeDefined();
    expect(ring["opacity"]).toBeDefined();
  });

  test("does not beat for a reader who asked for less motion", async () => {
    answerReduceMotionWith(true);
    const loop: jest.SpyInstance = jest.spyOn(Animated, "loop");

    await render(<CurrentlyActiveBadge />);

    // Let the answer land before asserting nothing moved.
    await act(async () => {
      await Promise.resolve();
    });

    expect(loop).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("currently-active-badge-pulse", HIDDEN),
    ).toBeNull();
    // The dot and the words still say it.
    expect(
      screen.getByTestId("currently-active-badge-dot", HIDDEN),
    ).toBeTruthy();
    expect(screen.getByText(CURRENTLY_ACTIVE_LABEL)).toBeTruthy();
  });

  test("nothing moves until the OS has actually answered", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockReturnValue(
      new Promise<boolean>(() => {
        /* Deliberately never settles: this is the window before the answer. */
      }),
    );
    const loop: jest.SpyInstance = jest.spyOn(Animated, "loop");

    await render(<CurrentlyActiveBadge />);

    expect(loop).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("currently-active-badge-pulse", HIDDEN),
    ).toBeNull();
  });

  test("a setting the OS refuses to report is treated as reduce motion", async () => {
    jest
      .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
      .mockRejectedValue(new Error("Accessibility manager unavailable"));
    const loop: jest.SpyInstance = jest.spyOn(Animated, "loop");

    await render(<CurrentlyActiveBadge />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(loop).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("currently-active-badge-pulse", HIDDEN),
    ).toBeNull();
  });

  test("stops beating the moment the reader turns reduce motion on", async () => {
    answerReduceMotionWith(false);

    let onChange: ((enabled: boolean) => void) | null = null;
    jest.spyOn(AccessibilityInfo, "addEventListener").mockImplementation(((
      _event: string,
      handler: (enabled: boolean) => void,
    ): { remove: () => void } => {
      onChange = handler;
      return { remove: jest.fn() };
    }) as unknown as typeof AccessibilityInfo.addEventListener);

    const stop: jest.Mock = jest.fn();
    const realLoop: typeof Animated.loop = Animated.loop;
    jest
      .spyOn(Animated, "loop")
      .mockImplementation(
        (
          ...args: Parameters<typeof Animated.loop>
        ): Animated.CompositeAnimation => {
          const animation: Animated.CompositeAnimation = realLoop(...args);
          const realStop: () => void = animation.stop.bind(animation);
          animation.stop = (): void => {
            stop();
            realStop();
          };
          return animation;
        },
      );

    await render(<CurrentlyActiveBadge />);

    await waitFor(() => {
      expect(
        screen.getByTestId("currently-active-badge-pulse", HIDDEN),
      ).toBeTruthy();
    });

    await act(async () => {
      onChange!(true);
    });

    expect(stop).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByTestId("currently-active-badge-pulse", HIDDEN),
    ).toBeNull();
  });

  test("stops beating when the badge goes away", async () => {
    answerReduceMotionWith(false);

    const stop: jest.Mock = jest.fn();
    const realLoop: typeof Animated.loop = Animated.loop;
    jest
      .spyOn(Animated, "loop")
      .mockImplementation(
        (
          ...args: Parameters<typeof Animated.loop>
        ): Animated.CompositeAnimation => {
          const animation: Animated.CompositeAnimation = realLoop(...args);
          const realStop: () => void = animation.stop.bind(animation);
          animation.stop = (): void => {
            stop();
            realStop();
          };
          return animation;
        },
      );

    const view: Awaited<ReturnType<typeof render>> = await render(
      <CurrentlyActiveBadge />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("currently-active-badge-pulse", HIDDEN),
      ).toBeTruthy();
    });

    expect(stop).not.toHaveBeenCalled();

    await act(async () => {
      view.unmount();
    });

    expect(stop).toHaveBeenCalledTimes(1);
  });
});
