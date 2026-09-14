import React from "react";
import { render, screen } from "@testing-library/react-native";
import { describe, expect, test } from "@jest/globals";
import SeverityBadge, { type SeverityLevel } from "./SeverityBadge";
import { darkColors } from "../theme";

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

function styleOf(element: RenderedElement): Record<string, unknown> {
  return element.props.style as Record<string, unknown>;
}

describe("A recognised severity is painted in that severity's colours", () => {
  test("a critical badge uses the critical text and background tokens", async () => {
    await render(<SeverityBadge severity="critical" />);

    const label: RenderedElement = screen.getByText("CRITICAL");
    expect(styleOf(label).color).toBe(darkColors.severityCritical);
    expect(styleOf(label.parent as RenderedElement).backgroundColor).toBe(
      darkColors.severityCriticalBg,
    );
  });

  test("an info badge uses the info tokens, not the critical ones", async () => {
    await render(<SeverityBadge severity="info" />);

    const label: RenderedElement = screen.getByText("INFO");
    expect(styleOf(label).color).toBe(darkColors.severityInfo);
    expect(styleOf(label.parent as RenderedElement).backgroundColor).toBe(
      darkColors.severityInfoBg,
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
    expect(styleOf(label).color).toBe(darkColors.textSecondary);
    expect(styleOf(label.parent as RenderedElement).backgroundColor).toBe(
      darkColors.backgroundTertiary,
    );
  });

  test("an unknown severity with a label still shows the label", async () => {
    await render(
      <SeverityBadge severity={unknownSeverity} label="Unclassified" />,
    );

    expect(screen.getByText("UNCLASSIFIED")).toBeTruthy();
  });
});
