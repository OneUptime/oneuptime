/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The app's own words for a state or a severity, where it has them: the
 * dashboard's locale does, a status page hands its names in translated.
 */
const mockDictionary: Record<string, string> = {
  Completed: "Abgeschlossen",
  Resolved: "Behoben",
};

jest.mock("../../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      const translate: (value: string | undefined) => string | undefined = (
        value: string | undefined,
      ): string | undefined => {
        return value && mockDictionary[value] ? mockDictionary[value] : value;
      };

      return {
        translateString: translate,
        translateValue: (value: unknown): unknown => {
          return typeof value === "string" ? translate(value) : value;
        },
        language: "de",
      };
    },
  };
});

import UptimeBarTooltip from "../../../../UI/Components/Graphs/UptimeBarTooltip";
import {
  getUptimeDayToneProps,
  INCIDENT_MARK_COLOR,
} from "../../../../UI/Components/Graphs/UptimeDayEventTone";
import { StatusDuration } from "../../../../UI/Components/Graphs/UptimeDaySummary";
import { Green, Red, Yellow } from "../../../../Types/BrandColors";
import Color, { RGB } from "../../../../Types/Color";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import UptimeBarTooltipIncident from "../../../../Types/Monitor/UptimeBarTooltipIncident";
import UptimeBarTooltipMaintenance from "../../../../Types/Monitor/UptimeBarTooltipMaintenance";
import { parseColor } from "../../../../Utils/ColorContrast";
import { MAINTENANCE_MARK_COLOR } from "../../../../Utils/StatusPage/HistoryChartBarColors";
import { ScheduledMaintenancePhaseOfState } from "../../../../Utils/ScheduledMaintenanceStart";

/*
 * Contract under test - what a day's tooltip says about its incidents and
 * its scheduled maintenance reads in any colour, in both themes, and the two
 * lists read apart (issue #5236's UI review).
 *
 * The names of states and severities were written in the project's own
 * colours, so the stock "Ongoing" amber of a maintenance event in progress
 * read at 1.5:1; and the incidents' heading had no icon while the
 * maintenance heading had its wrench, so the two names did not line up.
 */

const DAY: Date = new Date("2026-10-21T00:00:00.000Z");

const OPERATIONAL: StatusDuration = {
  label: "Operational",
  seconds: 24 * 60 * 60,
  color: Green,
  isDowntime: false,
};

const INCIDENT: UptimeBarTooltipIncident = {
  id: "e6200000-0000-4000-8000-000000000001",
  title: "Checkout API is down",
  declaredAt: new Date("2026-10-21T09:00:00.000Z"),
  incidentSeverity: { name: "Low", color: Yellow },
  currentIncidentState: { name: "Resolved", color: Green },
  monitorIds: [],
};

const ONGOING: UptimeBarTooltipMaintenance = {
  id: "e6000000-0000-4000-8000-000000000001",
  title: "Database upgrade",
  startsAt: new Date("2026-10-21T08:00:00.000Z"),
  endsAt: new Date("2026-10-21T10:00:00.000Z"),
  currentState: { name: "Ongoing", color: Yellow },
  phase: ScheduledMaintenancePhaseOfState.InProgress,
  monitorIds: [new ObjectID("e6100000-0000-4000-8000-000000000001")],
};

// A colour as the browser writes it back: "rgb(r, g, b)".
function rgbOf(color: string): string {
  const rgb: RGB = parseColor(color)!;

  return `rgb(${rgb.red}, ${rgb.green}, ${rgb.blue})`;
}

// The element is toned in `color`: the Pill's text, and the dark theme's.
function expectToned(element: HTMLElement, color: Color): void {
  const expected: ReturnType<typeof getUptimeDayToneProps> =
    getUptimeDayToneProps(color);

  expect(element).toHaveAttribute("data-ou-pill", "");
  expect(element.style.color).toBe(rgbOf(String(expected.style.color)));
  expect(element.style.getPropertyValue("--ou-pill-dark-text")).toBe(
    expected.style["--ou-pill-dark-text"],
  );
}

function renderTooltip(
  props: Partial<React.ComponentProps<typeof UptimeBarTooltip>> = {},
): void {
  render(
    <UptimeBarTooltip
      date={DAY}
      timezone="UTC"
      uptimePercent={100}
      hasEvents={true}
      statusDurations={[OPERATIONAL]}
      incidents={[INCIDENT]}
      maintenanceEvents={[ONGOING]}
      {...props}
    />,
  );
}

beforeEach(() => {
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("UptimeBarTooltip - names that read in any colour", () => {
  test("a maintenance event's state is toned, so the stock amber reads", () => {
    renderTooltip();

    expectToned(screen.getByTestId("uptime-tooltip-maintenance-state"), Yellow);
  });

  test("an incident's severity and state are toned the same way", () => {
    renderTooltip();

    expectToned(screen.getByTestId("uptime-tooltip-incident-severity"), Yellow);
    expectToned(screen.getByTestId("uptime-tooltip-incident-state"), Green);
  });

  test("the counts are toned in each kind's own colour", () => {
    renderTooltip();

    const incidents: HTMLElement = screen.getByTestId(
      "uptime-tooltip-incidents-count",
    );
    const maintenance: HTMLElement = screen.getByTestId(
      "uptime-tooltip-maintenance-count",
    );

    expect(incidents).toHaveTextContent("1");
    expect(maintenance).toHaveTextContent("1");
    expectToned(incidents, INCIDENT_MARK_COLOR);
    expectToned(maintenance, MAINTENANCE_MARK_COLOR);
  });

  test("no name is written in its raw colour any more", () => {
    renderTooltip({
      incidents: [
        {
          ...INCIDENT,
          incidentSeverity: { name: "Critical", color: Red },
        },
      ],
    });

    for (const testId of [
      "uptime-tooltip-incident-severity",
      "uptime-tooltip-incident-state",
      "uptime-tooltip-maintenance-state",
    ]) {
      const element: HTMLElement = screen.getByTestId(testId);

      expect([
        rgbOf("#fd625e"),
        rgbOf("#2ab57d"),
        rgbOf("#ffbf53"),
      ]).not.toContain(element.style.color);
    }
  });
});

describe("UptimeBarTooltip - the two lists read apart", () => {
  test("each heading has its own icon, so their names line up", () => {
    renderTooltip();

    expect(
      within(screen.getByTestId("uptime-tooltip-incidents")).getByTestId(
        "uptime-day-incident-icon",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("uptime-tooltip-maintenance")).getByTestId(
        "uptime-day-maintenance-icon",
      ),
    ).toBeInTheDocument();
  });

  test("the icons are decoration: the headings say what they mean", () => {
    renderTooltip();

    expect(screen.getByTestId("uptime-day-incident-icon")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.getByTestId("uptime-day-maintenance-icon")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  test("a day of incidents alone still has its icon", () => {
    renderTooltip({ maintenanceEvents: [] });

    expect(screen.getByTestId("uptime-day-incident-icon")).toBeInTheDocument();
    expect(
      screen.queryByTestId("uptime-day-maintenance-icon"),
    ).not.toBeInTheDocument();
  });
});

describe("UptimeBarTooltip - names in the reader's language", () => {
  test("a state the app has words for is named in them, as the dialog's Pills name it", () => {
    renderTooltip({
      maintenanceEvents: [
        {
          ...ONGOING,
          currentState: { name: "Completed", color: Green },
          phase: ScheduledMaintenancePhaseOfState.Over,
        },
      ],
    });

    expect(
      screen.getByTestId("uptime-tooltip-maintenance-state"),
    ).toHaveTextContent("Abgeschlossen");
    expect(
      screen.getByTestId("uptime-tooltip-incident-state"),
    ).toHaveTextContent("Behoben");
  });

  test("one it has no words for is named as given", () => {
    renderTooltip();

    expect(
      screen.getByTestId("uptime-tooltip-maintenance-state"),
    ).toHaveTextContent("Ongoing");
    expect(
      screen.getByTestId("uptime-tooltip-incident-severity"),
    ).toHaveTextContent("Low");
  });
});
