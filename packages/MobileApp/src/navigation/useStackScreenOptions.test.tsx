import React from "react";
import { Platform } from "react-native";
import type { NativeStackNavigationOptions } from "@react-navigation/native-stack";
import { act, render, renderHook, screen } from "@testing-library/react-native";
import { afterEach, describe, expect, test, jest } from "@jest/globals";
import { useStackScreenOptions } from "./useStackScreenOptions";
import {
  ThemeProvider,
  darkColors,
  lightColors,
  useTheme,
  type ColorTokens,
} from "../theme";

/*
 * Every workspace stack takes its header from this hook, so one mistake here
 * is a mistake on every screen: a header on a different colour from the page,
 * a hairline under it, or content that flashes white while a screen is pushed
 * because the scene has no background of its own. It must also follow the
 * theme live - a person switching to dark mode in Settings should not keep a
 * light header until the app restarts.
 */

jest.mock("../components/ProjectSwitcher", () => {
  const ReactModule: typeof React = jest.requireActual("react");
  const { Text: TextComponent } = jest.requireActual(
    "react-native",
  ) as typeof import("react-native");
  return {
    __esModule: true,
    default: () => {
      return ReactModule.createElement(
        TextComponent,
        { accessibilityRole: "header" },
        "Project Alpha",
      );
    },
  };
});

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

afterEach(() => {
  mockSystemScheme = "light";
});

type HeaderTitleRenderer = (props: {
  children: string;
  tintColor?: string;
}) => React.ReactNode;

async function optionsFor(
  scheme: "light" | "dark" | "no-provider",
): Promise<NativeStackNavigationOptions> {
  if (scheme !== "no-provider") {
    mockSystemScheme = scheme;
  }
  const { result } = (await renderHook(
    () => {
      return useStackScreenOptions();
    },
    scheme === "no-provider" ? undefined : { wrapper: ThemeProvider },
  )) as unknown as { result: { current: NativeStackNavigationOptions } };
  return result.current;
}

function expectCanvasHeader(
  options: NativeStackNavigationOptions,
  colors: ColorTokens,
): void {
  expect(options.headerStyle).toEqual({
    backgroundColor: colors.backgroundPrimary,
  });
  expect(options.contentStyle).toEqual({
    backgroundColor: colors.backgroundPrimary,
  });
  expect(options.headerTintColor).toBe(colors.actionPrimary);
  expect(options.headerTitleStyle).toMatchObject({
    color: colors.textPrimary,
  });
}

describe("The shared header", () => {
  test("shows the project switcher as its title", async () => {
    const options: NativeStackNavigationOptions = await optionsFor("light");

    expect(typeof options.headerTitle).toBe("function");
    await render(
      <>
        {(options.headerTitle as HeaderTitleRenderer)({
          children: "Incidents",
          tintColor: lightColors.actionPrimary,
        })}
      </>,
    );

    expect(screen.getByRole("header", { name: "Project Alpha" })).toBeTruthy();
    /* The route title is not drawn beside the switcher. */
    expect(screen.queryByText("Incidents")).toBeNull();
  });

  test("aligns the switcher to the leading edge on both platforms", async () => {
    const options: NativeStackNavigationOptions = await optionsFor("light");

    expect(options.headerTitleAlign).toBe("left");
  });

  test("draws no hairline under the header, so the page reads as one surface", async () => {
    const options: NativeStackNavigationOptions = await optionsFor("light");

    expect(options.headerShadowVisible).toBe(false);
  });

  test("shows only the back chevron, not the previous screen's title", async () => {
    const options: NativeStackNavigationOptions = await optionsFor("light");

    expect(options.headerBackButtonDisplayMode).toBe("minimal");
  });

  test("the header title style has a readable size and weight", async () => {
    const options: NativeStackNavigationOptions = await optionsFor("light");

    expect(options.headerTitleStyle).toMatchObject({
      fontSize: 17,
      fontWeight: "600",
    });
  });
});

describe("Colours", () => {
  test("in light mode the header and the content share the light canvas", async () => {
    expectCanvasHeader(await optionsFor("light"), lightColors);
  });

  test("in dark mode the header and the content share the dark canvas", async () => {
    const options: NativeStackNavigationOptions = await optionsFor("dark");

    expectCanvasHeader(options, darkColors);
    expect(
      (options.contentStyle as { backgroundColor: string }).backgroundColor,
    ).not.toBe(lightColors.backgroundPrimary);
  });

  test("outside a ThemeProvider it falls back to the light palette rather than crashing", async () => {
    expectCanvasHeader(await optionsFor("no-provider"), lightColors);
  });

  test("the options follow a theme change without a restart", async () => {
    mockSystemScheme = "light";
    const { result } = (await renderHook(
      () => {
        return { options: useStackScreenOptions(), theme: useTheme() };
      },
      { wrapper: ThemeProvider },
    )) as unknown as {
      result: {
        current: {
          options: NativeStackNavigationOptions;
          theme: ReturnType<typeof useTheme>;
        };
      };
    };
    expectCanvasHeader(result.current.options, lightColors);

    await act(async (): Promise<void> => {
      result.current.theme.setPreference("dark");
    });

    expectCanvasHeader(result.current.options, darkColors);
  });
});

describe("Platform-specific options", () => {
  test("iOS gets the compact title with a canvas-coloured large header; Android gets neither", async () => {
    /*
     * babel-preset-expo inlines Platform.OS per Jest project, so each project
     * asserts its own half and neither can pass on the other's values.
     */
    const options: NativeStackNavigationOptions = await optionsFor("dark");

    if (Platform.OS === "ios") {
      expect(options.headerLargeTitle).toBe(false);
      expect(options.headerLargeStyle).toEqual({
        backgroundColor: darkColors.backgroundPrimary,
      });
    } else {
      expect("headerLargeTitle" in options).toBe(false);
      expect("headerLargeStyle" in options).toBe(false);
    }
  });
});

describe("What the hook does not set", () => {
  test("it leaves titles, visibility and presentation to each screen", async () => {
    const options: NativeStackNavigationOptions = await optionsFor("light");

    expect(options.title).toBeUndefined();
    expect(options.headerShown).toBeUndefined();
    expect(options.presentation).toBeUndefined();
    expect(options.gestureEnabled).toBeUndefined();
  });
});
