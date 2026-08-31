import React from "react";
import { Text } from "react-native";
import { render, screen, renderHook } from "@testing-library/react-native";
import { ThemeProvider, useTheme } from "./ThemeContext";
import { darkColors, type ColorTokens } from "./colors";
import { describe, expect, test } from "@jest/globals";

/*
 * Every colour in the app is read through useTheme, and every one of those
 * reads is `theme.colors.something` written straight into a style prop. Two
 * things follow, and they are what this file protects:
 *
 *   - a MISSING token is not a compile error at the point it hurts. It is
 *     `undefined` handed to React Native as a colour, which renders as black on
 *     black - text a responder cannot read on a page they were woken for.
 *   - the context has a default value on purpose. Anything rendered outside the
 *     provider - a modal, a screen mounted on its own in a test - has to come
 *     back with the same tokens rather than crashing or handing back nothing.
 *
 * The token VALUES are not asserted one by one; that would be a copy of
 * colors.ts and would fail on every deliberate palette change. What is asserted
 * is the property the palette exists to provide: the colours that carry meaning
 * have to be distinguishable from each other.
 */

type ThemeContextValue = ReturnType<typeof useTheme>;

async function renderUseTheme(
  withProvider: boolean,
): Promise<ThemeContextValue> {
  const rendered: { result: { current: ThemeContextValue } } =
    (await renderHook(
      () => {
        return useTheme();
      },
      withProvider ? { wrapper: ThemeProvider } : undefined,
    )) as unknown as { result: { current: ThemeContextValue } };

  return rendered.result.current;
}

describe("useTheme inside a ThemeProvider", () => {
  test("hands down the dark token set", async () => {
    const { theme }: ThemeContextValue = await renderUseTheme(true);

    expect(theme.colors).toBe(darkColors);
  });

  test("hands down a theme whose only content is its colours", async () => {
    /*
     * The Theme shape is what every consumer destructures. A second key
     * appearing here silently means half the app is reading a theme that no
     * longer matches the one being provided.
     */
    const { theme }: ThemeContextValue = await renderUseTheme(true);

    expect(Object.keys(theme)).toEqual(["colors"]);
  });
});

describe("useTheme without a ThemeProvider", () => {
  test("still returns a usable theme rather than undefined", async () => {
    /*
     * The default context value exists so a component can be mounted on its own
     * - in a test, or under a navigator that has not been wrapped - without
     * every `theme.colors.x` in it throwing on undefined.
     */
    const value: ThemeContextValue = await renderUseTheme(false);

    expect(value.theme).toBeDefined();
    expect(value.theme.colors).toBeDefined();
  });

  test("returns the SAME tokens the provider would have handed down", async () => {
    /*
     * The point of the default. If it drifted from the provider's value, a
     * screen would render one set of colours under the app and a different set
     * in isolation, and the difference would only ever be noticed on a device.
     */
    const outside: ThemeContextValue = await renderUseTheme(false);
    const inside: ThemeContextValue = await renderUseTheme(true);

    expect(outside.theme.colors).toBe(inside.theme.colors);
  });
});

describe("ThemeProvider", () => {
  test("renders what it is given", async () => {
    /*
     * It wraps its children in a flex View. A provider that dropped them would
     * take the whole app down to a blank screen.
     */
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

  test("keeps the token object identical across re-renders", async () => {
    /*
     * Consumers derive StyleSheet objects from these tokens inside useMemo keyed
     * on `theme.colors`. A fresh object every render would rebuild every style
     * in the app on every render, which on a list of pages is felt as scroll
     * jank.
     */
    const rendered: {
      result: { current: ThemeContextValue };
      rerender: (props: unknown) => Promise<void>;
    } = (await renderHook(
      () => {
        return useTheme();
      },
      { wrapper: ThemeProvider },
    )) as unknown as {
      result: { current: ThemeContextValue };
      rerender: (props: unknown) => Promise<void>;
    };

    const before: ColorTokens = rendered.result.current.theme.colors;
    await rendered.rerender({});

    expect(rendered.result.current.theme.colors).toBe(before);
  });
});

describe("the token set itself", () => {
  test("defines every token as a non-empty colour string", async () => {
    /*
     * The failure this guards against is silent: a token dropped from the
     * palette becomes `undefined` at the style prop, which React Native renders
     * as black. On this app's near-black backgrounds that is invisible text.
     */
    const { theme }: ThemeContextValue = await renderUseTheme(true);
    const entries: Array<[string, string]> = Object.entries(
      theme.colors,
    ) as Array<[string, string]>;

    expect(entries.length).toBeGreaterThan(0);

    entries.forEach((entry: [string, string]): void => {
      expect(typeof entry[1]).toBe("string");
      expect(entry[1].length).toBeGreaterThan(0);
    });
  });

  test("keeps the severity colours distinguishable from one another", async () => {
    /*
     * Severity is read at a glance, half-awake, by colour before the label is
     * read at all. Two severities sharing a colour removes the triage cue that
     * the whole list view depends on.
     */
    const { theme }: ThemeContextValue = await renderUseTheme(true);
    const severities: string[] = [
      theme.colors.severityCritical,
      theme.colors.severityMajor,
      theme.colors.severityMinor,
      theme.colors.severityWarning,
      theme.colors.severityInfo,
    ];

    expect(new Set<string>(severities).size).toBe(severities.length);
  });

  test("keeps the alert states distinguishable from one another", async () => {
    /*
     * Created, acknowledged and resolved are the three facts a responder needs
     * off a timeline. If acknowledged looked like created, a page someone had
     * already picked up would read as still unowned.
     */
    const { theme }: ThemeContextValue = await renderUseTheme(true);
    const states: string[] = [
      theme.colors.stateCreated,
      theme.colors.stateAcknowledged,
      theme.colors.stateResolved,
    ];

    expect(new Set<string>(states).size).toBe(states.length);
  });

  test("keeps on-call active distinguishable from on-call inactive", async () => {
    const { theme }: ThemeContextValue = await renderUseTheme(true);

    expect(theme.colors.oncallActive).not.toBe(theme.colors.oncallInactive);
  });

  test("keeps success and error distinguishable", async () => {
    /*
     * These two colour the outcome of an acknowledge. Sharing a value would
     * make a failed acknowledge look exactly like one that worked.
     */
    const { theme }: ThemeContextValue = await renderUseTheme(true);

    expect(theme.colors.statusSuccess).not.toBe(theme.colors.statusError);
  });

  test("does not paint text in the colour of the surface behind it", async () => {
    /*
     * The literal invisible-text case. Primary text on the primary background is
     * the most common pairing in the app.
     */
    const { theme }: ThemeContextValue = await renderUseTheme(true);

    expect(theme.colors.textPrimary).not.toBe(theme.colors.backgroundPrimary);
    expect(theme.colors.textSecondary).not.toBe(theme.colors.backgroundPrimary);
  });
});
