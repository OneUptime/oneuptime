import React from "react";
import { StyleSheet } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { beforeEach, describe, expect, test } from "@jest/globals";
import SeverityBadge, { type SeverityLevel } from "./SeverityBadge";
import { ThemeProvider, darkColors, lightColors } from "../theme";
import { radius } from "../theme/tokens";

/*
 * The badge is a one-word answer to "how bad is this", so the two things worth
 * pinning down are that the word is the right colour, and that a word nobody
 * anticipated does not take the screen with it.
 *
 * The unrecognised-severity case is the reason this file exists. The component
 * indexes a five-entry map with whatever it is handed; anything outside those
 * five used to come back undefined and throw on the very next line, out of
 * render, which in React means the nearest boundary swallows whatever screen
 * the badge was sitting on. There are no callers today, so nothing was
 * crashing in production - this is a guard for the first caller that feeds it
 * a severity name straight off the API.
 */

type RenderedElement = ReturnType<typeof screen.getByText>;

/** Styles may be arrays, so they are read flattened. */
function styleOf(element: RenderedElement): Record<string, unknown> {
  return (StyleSheet.flatten(element.props.style) ?? {}) as Record<
    string,
    unknown
  >;
}

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

beforeEach(() => {
  mockColorScheme = "light";
});

describe("A recognised severity is painted in that severity's colours", () => {
  test("a critical badge uses the critical text and background tokens", async () => {
    await render(<SeverityBadge severity="critical" />);

    const label: RenderedElement = screen.getByText("CRITICAL");
    expect(styleOf(label).color).toBe(lightColors.severityCritical);
    expect(styleOf(label.parent as RenderedElement).backgroundColor).toBe(
      lightColors.severityCriticalBg,
    );
  });

  test("an info badge uses the info tokens, not the critical ones", async () => {
    await render(<SeverityBadge severity="info" />);

    const label: RenderedElement = screen.getByText("INFO");
    expect(styleOf(label).color).toBe(lightColors.severityInfo);
    expect(styleOf(label.parent as RenderedElement).backgroundColor).toBe(
      lightColors.severityInfoBg,
    );
  });

  test("each of the five severities renders its own label", async () => {
    const severities: SeverityLevel[] = [
      "critical",
      "major",
      "minor",
      "warning",
      "info",
    ];

    for (const severity of severities) {
      const view: { unmount: () => Promise<void> } = await render(
        <SeverityBadge severity={severity} />,
      );
      expect(screen.getByText(severity.toUpperCase())).toBeTruthy();
      await view.unmount();
    }
  });
});

describe("What the badge says", () => {
  test("the severity itself is the label when none is given", async () => {
    await render(<SeverityBadge severity="major" />);

    expect(screen.getByText("MAJOR")).toBeTruthy();
  });

  test("an explicit label replaces it, still upper-cased", async () => {
    await render(<SeverityBadge severity="major" label="Sev 2" />);

    expect(screen.getByText("SEV 2")).toBeTruthy();
    expect(screen.queryByText("MAJOR")).toBeNull();
  });
});

describe("A severity outside the five it knows", () => {
  /*
   * The cast is the whole point: the type says this cannot happen, and the
   * data says otherwise the first time a project's own severity name is passed
   * through untyped JSON. Without the fallback this render throws
   * "Cannot read properties of undefined (reading 'bg')" and never returns.
   */
  const unknownSeverity: SeverityLevel = "catastrophic" as SeverityLevel;

  test("it renders instead of throwing out of render", async () => {
    await render(<SeverityBadge severity={unknownSeverity} />);

    expect(screen.getByText("CATASTROPHIC")).toBeTruthy();
  });

  test("it is painted neutral rather than borrowing a severity's colour", async () => {
    await render(<SeverityBadge severity={unknownSeverity} />);

    const label: RenderedElement = screen.getByText("CATASTROPHIC");
    expect(styleOf(label).color).toBe(lightColors.textSecondary);
    expect(styleOf(label.parent as RenderedElement).backgroundColor).toBe(
      lightColors.backgroundTertiary,
    );
  });

  test("an unknown severity with a label still shows the label", async () => {
    await render(
      <SeverityBadge severity={unknownSeverity} label="Unclassified" />,
    );

    expect(screen.getByText("UNCLASSIFIED")).toBeTruthy();
  });
});

describe("The pill", () => {
  test("is a rounded pill that holds its label to one line", async () => {
    await render(<SeverityBadge severity="major" />);

    const label: RenderedElement = screen.getByText("MAJOR");
    expect(label.props.numberOfLines).toBe(1);
    expect(label.parent as RenderedElement).toHaveStyle({
      borderRadius: radius.pill,
      backgroundColor: lightColors.severityMajorBg,
    });
  });

  test("in dark mode each severity uses its dark text and tint pair", async () => {
    mockColorScheme = "dark";

    await render(
      <ThemeProvider>
        <SeverityBadge severity="critical" />
      </ThemeProvider>,
    );

    const label: RenderedElement = screen.getByText("CRITICAL");
    expect(label).toHaveStyle({ color: darkColors.severityCritical });
    expect(label.parent as RenderedElement).toHaveStyle({
      backgroundColor: darkColors.severityCriticalBg,
    });
  });

  test("in dark mode an unknown severity is painted with the dark neutrals", async () => {
    mockColorScheme = "dark";

    await render(
      <ThemeProvider>
        <SeverityBadge severity={"catastrophic" as SeverityLevel} />
      </ThemeProvider>,
    );

    const label: RenderedElement = screen.getByText("CATASTROPHIC");
    expect(label).toHaveStyle({ color: darkColors.textSecondary });
    expect(label.parent as RenderedElement).toHaveStyle({
      backgroundColor: darkColors.backgroundTertiary,
    });
  });
});
