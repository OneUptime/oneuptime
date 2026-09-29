import React from "react";
import { Appearance, Text } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  act,
  render,
  screen,
  renderHook,
  waitFor,
} from "@testing-library/react-native";
import { ThemeProvider, useTheme, lightTheme, darkTheme } from "./ThemeContext";
import { darkColors, lightColors, type ColorTokens } from "./colors";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Every colour in the app is read through useTheme. Two things follow, and
 * they are what this file protects:
 *
 *   - a MISSING token is not a compile error at the point it hurts. It is
 *     `undefined` handed to React Native as a colour.
 *   - the context has a default value on purpose. Anything rendered outside
 *     the provider has to come back with usable tokens rather than crashing.
 *
 * Dark mode follows the device unless the person picked Light or Dark in
 * Settings, and that choice survives a restart.
 */

type ThemeContextValue = ReturnType<typeof useTheme>;

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

beforeEach(async () => {
  mockSystemScheme = "light";
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function renderUseTheme(withProvider: boolean): Promise<{
  result: { current: ThemeContextValue };
  rerender: (props: unknown) => Promise<void>;
}> {
  return (await renderHook(
    () => {
      return useTheme();
    },
    withProvider ? { wrapper: ThemeProvider } : undefined,
  )) as unknown as {
    result: { current: ThemeContextValue };
    rerender: (props: unknown) => Promise<void>;
  };
}

describe("useTheme inside a ThemeProvider", () => {
  test("uses the light palette when the device is light", async () => {
    const { result } = await renderUseTheme(true);

    expect(result.current.theme.colors).toBe(lightColors);
    expect(result.current.theme.dark).toBe(false);
    expect(result.current.preference).toBe("system");
  });

  test("uses the dark palette when the device is dark", async () => {
    mockSystemScheme = "dark";
    const { result } = await renderUseTheme(true);

    expect(result.current.theme.colors).toBe(darkColors);
    expect(result.current.theme.dark).toBe(true);
  });

  test("treats an unknown device appearance as light", async () => {
    mockSystemScheme = null;
    const { result } = await renderUseTheme(true);

    expect(result.current.theme).toBe(lightTheme);
  });

  test("hands down a theme made of its colours and whether it is dark", async () => {
    const { result } = await renderUseTheme(true);

    expect(Object.keys(result.current.theme).sort()).toEqual([
      "colors",
      "dark",
    ]);
  });

  test("an explicit Dark choice wins over a light device and is saved", async () => {
    const setColorScheme: jest.SpiedFunction<typeof Appearance.setColorScheme> =
      jest.spyOn(Appearance, "setColorScheme").mockImplementation(() => {
        return undefined;
      });
    const { result } = await renderUseTheme(true);

    await act(async () => {
      result.current.setPreference("dark");
    });

    expect(result.current.theme).toBe(darkTheme);
    expect(result.current.preference).toBe("dark");
    expect(setColorScheme).toHaveBeenCalledWith("dark");
    await waitFor(async () => {
      expect(await AsyncStorage.getItem("oneuptime_appearance")).toBe("dark");
    });
  });

  test("an explicit Light choice wins over a dark device", async () => {
    mockSystemScheme = "dark";
    jest.spyOn(Appearance, "setColorScheme").mockImplementation(() => {
      return undefined;
    });
    const { result } = await renderUseTheme(true);

    await act(async () => {
      result.current.setPreference("light");
    });

    expect(result.current.theme).toBe(lightTheme);
  });

  test("going back to System follows the device again and forgets the override", async () => {
    mockSystemScheme = "dark";
    const setColorScheme: jest.SpiedFunction<typeof Appearance.setColorScheme> =
      jest.spyOn(Appearance, "setColorScheme").mockImplementation(() => {
        return undefined;
      });
    await AsyncStorage.setItem("oneuptime_appearance", "light");
    const { result } = await renderUseTheme(true);
    await waitFor(() => {
      expect(result.current.preference).toBe("light");
    });

    await act(async () => {
      result.current.setPreference("system");
    });

    expect(result.current.theme).toBe(darkTheme);
    expect(setColorScheme).toHaveBeenLastCalledWith("unspecified");
    await waitFor(async () => {
      expect(await AsyncStorage.getItem("oneuptime_appearance")).toBeNull();
    });
  });

  test("restores a saved choice on the next launch", async () => {
    jest.spyOn(Appearance, "setColorScheme").mockImplementation(() => {
      return undefined;
    });
    await AsyncStorage.setItem("oneuptime_appearance", "dark");
    const { result } = await renderUseTheme(true);

    await waitFor(() => {
      expect(result.current.theme).toBe(darkTheme);
    });
  });

  test("ignores a stored value it does not recognise", async () => {
    await AsyncStorage.setItem("oneuptime_appearance", "sepia");
    const { result } = await renderUseTheme(true);

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.preference).toBe("system");
    expect(result.current.theme).toBe(lightTheme);
  });

  test("keeps the token object identical across re-renders", async () => {
    /*
     * Consumers derive style objects from these tokens. A fresh object every
     * render would rebuild every style in the app on every render.
     */
    const rendered: Awaited<ReturnType<typeof renderUseTheme>> =
      await renderUseTheme(true);

    const before: ColorTokens = rendered.result.current.theme.colors;
    await rendered.rerender({});

    expect(rendered.result.current.theme.colors).toBe(before);
  });
});

describe("useTheme without a ThemeProvider", () => {
  test("still returns a usable light theme rather than undefined", async () => {
    const { result } = await renderUseTheme(false);

    expect(result.current.theme).toBe(lightTheme);
    expect(result.current.preference).toBe("system");
    expect(() => {
      result.current.setPreference("dark");
    }).not.toThrow();
  });
});

describe("ThemeProvider", () => {
  test("renders what it is given", async () => {
    await render(
      <ThemeProvider>
        <Text>Acknowledged</Text>
      </ThemeProvider>,
    );

    expect(screen.getByText("Acknowledged")).toBeTruthy();
  });

  test("renders several children rather than only the first", async () => {
    await render(
      <ThemeProvider>
        <Text>Alerts</Text>
        <Text>Incidents</Text>
      </ThemeProvider>,
    );

    expect(screen.getByText("Alerts")).toBeTruthy();
    expect(screen.getByText("Incidents")).toBeTruthy();
  });
});

describe.each([
  ["light", lightColors],
  ["dark", darkColors],
])("the %s token set", (_name: string, colors: ColorTokens) => {
  test("defines every token as a non-empty colour string", () => {
    const entries: Array<[string, string]> = Object.entries(colors) as Array<
      [string, string]
    >;

    expect(entries.length).toBeGreaterThan(0);
    entries.forEach((entry: [string, string]): void => {
      expect(typeof entry[1]).toBe("string");
      expect(entry[1].length).toBeGreaterThan(0);
    });
  });

  test("keeps the severity colours distinguishable from one another", () => {
    const severities: string[] = [
      colors.severityCritical,
      colors.severityMajor,
      colors.severityMinor,
      colors.severityWarning,
      colors.severityInfo,
    ];

    expect(new Set<string>(severities).size).toBe(severities.length);
  });

  test("keeps the alert states distinguishable from one another", () => {
    const states: string[] = [
      colors.stateCreated,
      colors.stateAcknowledged,
      colors.stateResolved,
    ];

    expect(new Set<string>(states).size).toBe(states.length);
  });

  test("keeps on-call active distinguishable from on-call inactive", () => {
    expect(colors.oncallActive).not.toBe(colors.oncallInactive);
  });

  test("keeps destructive distinguishable from primary", () => {
    expect(colors.actionDestructive).not.toBe(colors.actionPrimary);
  });
});
