import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import SecurityEventSeverityPill, {
  getSeverityColor,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventSeverityPill";
import { PillSize } from "../../../UI/Components/Pill/Pill";
import {
  getPillColors,
  parseColor,
} from "../../../UI/Components/Pill/PillColors";
import Color from "../../../Types/Color";
import { Blue, Gray500, Orange, Red, Yellow } from "../../../Types/BrandColors";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";

/*
 * The severity pill is the one place Security Events turns an OCSF severity
 * into a colour, and the Correlate page reuses getSeverityColor for its node
 * accents and stats. Pinned here: every OCSF value maps to a brand colour
 * (so a new enum value forces a decision), missing severities read
 * "Unknown", and the optional size reaches Pill without changing the default
 * for existing callers.
 */

afterEach(() => {
  cleanup();
});

const EXPECTED_SEVERITY_COLORS: Record<OcsfSeverity, Color> = {
  [OcsfSeverity.Fatal]: Red,
  [OcsfSeverity.Critical]: Red,
  [OcsfSeverity.High]: Orange,
  [OcsfSeverity.Medium]: Yellow,
  [OcsfSeverity.Low]: Blue,
  [OcsfSeverity.Informational]: Gray500,
  [OcsfSeverity.Unknown]: Gray500,
  [OcsfSeverity.Other]: Gray500,
};

const ALL_SEVERITIES: Array<OcsfSeverity> = Object.values(OcsfSeverity);

type GetPillFunction = () => HTMLElement;

const getPill: GetPillFunction = (): HTMLElement => {
  return screen.getByTestId("pill");
};

// The pill is a tint of its colour; the dot is the colour itself.
const getDot: GetPillFunction = (): HTMLElement => {
  return within(getPill()).getByTestId("pill-dot");
};

describe("getSeverityColor", () => {
  test("the expectation table covers every OCSF severity", () => {
    expect(Object.keys(EXPECTED_SEVERITY_COLORS).sort()).toEqual(
      [...ALL_SEVERITIES].sort(),
    );
  });

  test.each(ALL_SEVERITIES)(
    "maps %s to its brand colour",
    (severity: OcsfSeverity) => {
      expect(getSeverityColor(severity).toString()).toBe(
        EXPECTED_SEVERITY_COLORS[severity].toString(),
      );
    },
  );

  test("uses the exact brand hex values the Correlate accents rely on", () => {
    expect(getSeverityColor(OcsfSeverity.Fatal).toString()).toBe("#fd625e");
    expect(getSeverityColor(OcsfSeverity.Critical).toString()).toBe("#fd625e");
    expect(getSeverityColor(OcsfSeverity.High).toString()).toBe("#f1734f");
    expect(getSeverityColor(OcsfSeverity.Medium).toString()).toBe("#ffbf53");
    expect(getSeverityColor(OcsfSeverity.Low).toString()).toBe("#3686be");
    expect(getSeverityColor(OcsfSeverity.Informational).toString()).toBe(
      "#6b7280",
    );
  });

  test("Fatal and Critical share red; Critical, High, Medium, Low and Informational are all distinct", () => {
    const red: string = getSeverityColor(OcsfSeverity.Critical).toString();
    expect(getSeverityColor(OcsfSeverity.Fatal).toString()).toBe(red);

    const distinct: Set<string> = new Set<string>(
      [
        OcsfSeverity.Critical,
        OcsfSeverity.High,
        OcsfSeverity.Medium,
        OcsfSeverity.Low,
        OcsfSeverity.Informational,
      ].map((severity: OcsfSeverity) => {
        return getSeverityColor(severity).toString();
      }),
    );
    expect(distinct.size).toBe(5);
  });

  test.each([
    ["undefined", undefined],
    ["an empty string", ""],
    ["a lowercase name", "high"],
    ["an unrecognised name", "Severe"],
  ])(
    "falls back to gray for %s",
    (_description: string, severityName: string | undefined) => {
      expect(getSeverityColor(severityName).toString()).toBe(
        Gray500.toString(),
      );
    },
  );

  test.each(ALL_SEVERITIES)(
    "returns a Color with a 6-digit hex value for %s",
    (severity: OcsfSeverity) => {
      const color: Color = getSeverityColor(severity);
      expect(color).toBeInstanceOf(Color);
      // Pill derives its shades from the hex; anything else reads as gray.
      expect(color.toString()).toMatch(/^#[0-9a-f]{6}$/i);
      expect(parseColor(color)).not.toBeNull();
    },
  );
});

describe("<SecurityEventSeverityPill />", () => {
  test.each(ALL_SEVERITIES)(
    "renders %s as the pill text",
    (severity: OcsfSeverity) => {
      render(<SecurityEventSeverityPill severityName={severity} />);

      expect(getPill()).toHaveTextContent(new RegExp(`^${severity}$`));
      expect(screen.getAllByTestId("pill")).toHaveLength(1);
    },
  );

  test("renders a non-OCSF severity verbatim, on gray", () => {
    render(<SecurityEventSeverityPill severityName="Vendor Special" />);

    expect(getPill()).toHaveTextContent(/^Vendor Special$/);
    expect(getDot()).toHaveStyle({
      backgroundColor: Gray500.toString(),
    });
  });

  test("falls back to Unknown when the severity is missing", () => {
    render(<SecurityEventSeverityPill />);

    expect(getPill()).toHaveTextContent(/^Unknown$/);
    expect(getDot()).toHaveStyle({
      backgroundColor: Gray500.toString(),
    });
  });

  test("falls back to Unknown when the severity is an empty string", () => {
    render(<SecurityEventSeverityPill severityName="" />);

    expect(getPill()).toHaveTextContent(/^Unknown$/);
  });

  test.each(ALL_SEVERITIES)(
    "colours the %s pill with getSeverityColor",
    (severity: OcsfSeverity) => {
      render(<SecurityEventSeverityPill severityName={severity} />);

      expect(getDot()).toHaveStyle({
        backgroundColor: getSeverityColor(severity).toString(),
      });
      expect(getPill()).toHaveStyle({
        backgroundColor: getPillColors(getSeverityColor(severity)).light
          .backgroundColor,
      });
    },
  );

  test("sets the Medium and Critical text in a readable shade of their colour", () => {
    /*
     * This used to be black on the yellow fill and white on the red one -
     * and white on #fd625e is 3:1. Pill now picks the shade (PillColors
     * holds it to 4.5:1 and up); what matters here is that it is used.
     */
    const { unmount } = render(
      <SecurityEventSeverityPill severityName={OcsfSeverity.Medium} />,
    );
    expect(getPill()).toHaveStyle({
      color: getPillColors(getSeverityColor(OcsfSeverity.Medium)).light
        .textColor,
    });
    unmount();

    render(<SecurityEventSeverityPill severityName={OcsfSeverity.Critical} />);
    expect(getPill()).toHaveStyle({
      color: getPillColors(getSeverityColor(OcsfSeverity.Critical)).light
        .textColor,
    });
    expect(getPill().style.color).not.toBe("rgb(255, 255, 255)");
  });

  test("keeps the normal 13px size when no size is passed", () => {
    render(<SecurityEventSeverityPill severityName={OcsfSeverity.High} />);

    expect(getPill().style.fontSize).toBe(PillSize.Normal);
    expect(getPill().style.fontSize).toBe("13px");
  });

  test("an explicit undefined size behaves like no size", () => {
    render(
      <SecurityEventSeverityPill
        severityName={OcsfSeverity.High}
        size={undefined}
      />,
    );

    expect(getPill().style.fontSize).toBe(PillSize.Normal);
  });

  test.each(Object.values(PillSize))(
    "passes size %s through to the pill font size",
    (size: PillSize) => {
      render(
        <SecurityEventSeverityPill
          severityName={OcsfSeverity.Critical}
          size={size}
        />,
      );

      expect(getPill().style.fontSize).toBe(size);
      // Size must not disturb the text or the severity colour.
      expect(getPill()).toHaveTextContent(/^Critical$/);
      expect(getDot()).toHaveStyle({
        backgroundColor: getSeverityColor(OcsfSeverity.Critical).toString(),
      });
    },
  );

  test("the small size is 10px", () => {
    render(
      <SecurityEventSeverityPill
        severityName={OcsfSeverity.Low}
        size={PillSize.Small}
      />,
    );

    expect(getPill().style.fontSize).toBe("10px");
  });

  test("renders plain text in the pill with no tooltip wrapper or icon", () => {
    const { container } = render(
      <SecurityEventSeverityPill severityName={OcsfSeverity.High} />,
    );

    expect(container.firstElementChild).toBe(getPill());
    expect(getPill().tagName).toBe("SPAN");
    expect(getPill().querySelector("svg")).toBeNull();
    expect(getPill().textContent).toBe("High");
    expect(getPill()).toContainElement(screen.getByText("High"));
  });
});
