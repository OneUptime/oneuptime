/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import UptimeBarTooltip from "../../../../UI/Components/Graphs/UptimeBarTooltip";
import { StatusDuration } from "../../../../UI/Components/Graphs/UptimeDaySummary";
import { Green, Red } from "../../../../Types/BrandColors";
import Color from "../../../../Types/Color";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import Timezone from "../../../../Types/Timezone";
import UptimeBarTooltipIncident from "../../../../Types/Monitor/UptimeBarTooltipIncident";
import UptimeBarTooltipMaintenance from "../../../../Types/Monitor/UptimeBarTooltipMaintenance";
import UptimeHistoryLabels, {
  DefaultUptimeHistoryLabels,
} from "../../../../Types/Monitor/UptimeHistoryLabels";
import { ScheduledMaintenancePhaseOfState } from "../../../../Utils/ScheduledMaintenanceStart";
import { STATUS_TEXT_ATTRIBUTE } from "../../../../UI/Utils/StatusColorStyle";

/*
 * Contract under test - a day's tooltip on the uptime strip lists the day's
 * scheduled maintenance beside its incidents (issue #5236).
 *
 * Before this, a visitor who hovered the day of a planned upgrade read
 * "Degraded 7 hours 59 mins" and nothing else: the maintenance that
 * explained it lived only on the Scheduled Maintenance page, which nobody
 * thinks to open for a day three weeks ago. The tooltip now says what was
 * planned that day - its title, its window on the reader's clock and the
 * state it is in - after the incidents, and opens the event's page.
 */

const DAY: Date = new Date("2026-10-21T00:00:00.000Z");

const DEGRADED: StatusDuration = {
  label: "Degraded",
  seconds: 8 * 60 * 60,
  color: new Color("#eab308"),
  isDowntime: true,
};

const OPERATIONAL: StatusDuration = {
  label: "Operational",
  seconds: 16 * 60 * 60,
  color: Green,
  isDowntime: false,
};

function maintenance(
  overrides: Partial<UptimeBarTooltipMaintenance> = {},
): UptimeBarTooltipMaintenance {
  return {
    id: "e5000000-0000-4000-8000-000000000001",
    title: "PHP security patches",
    // 18:00 to 20:00 in Paris, where this suite's reader lives.
    startsAt: new Date("2026-10-21T16:00:00.000Z"),
    endsAt: new Date("2026-10-21T18:00:00.000Z"),
    currentState: { name: "Completed", color: new Color("#16a34a") },
    phase: ScheduledMaintenancePhaseOfState.Over,
    monitorIds: [new ObjectID("e5100000-0000-4000-8000-000000000001")],
    ...overrides,
  };
}

function incident(
  overrides: Partial<UptimeBarTooltipIncident> = {},
): UptimeBarTooltipIncident {
  return {
    id: "e5200000-0000-4000-8000-000000000001",
    title: "Checkout API is down",
    declaredAt: new Date("2026-10-21T09:00:00.000Z"),
    incidentSeverity: { name: "Major", color: Red },
    monitorIds: [],
    ...overrides,
  };
}

function renderTooltip(
  props: Partial<React.ComponentProps<typeof UptimeBarTooltip>> = {},
): void {
  render(
    <UptimeBarTooltip
      date={DAY}
      timezone="UTC"
      uptimePercent={66.67}
      hasEvents={true}
      statusDurations={[DEGRADED, OPERATIONAL]}
      incidents={[]}
      {...props}
    />,
  );
}

beforeEach(() => {
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(false);
  OneUptimeDate.setUserTimezone("Europe/Paris" as Timezone);
});

afterEach(() => {
  cleanup();
  OneUptimeDate.setUserTimezone(null);
  jest.restoreAllMocks();
});

describe("UptimeBarTooltip - the day's scheduled maintenance", () => {
  test("lists the event under its own heading, with how many there are", () => {
    renderTooltip({ maintenanceEvents: [maintenance()] });

    const section: HTMLElement = screen.getByTestId(
      "uptime-tooltip-maintenance",
    );

    expect(section).toHaveTextContent("Scheduled maintenance");
    expect(within(section).getByText("1")).toBeInTheDocument();
    expect(section).toHaveTextContent("PHP security patches");
  });

  test("gives the window on the reader's clock, with the zone that clock is in", () => {
    renderTooltip({ maintenanceEvents: [maintenance()] });

    expect(
      screen.getByTestId("uptime-tooltip-maintenance-window"),
    ).toHaveTextContent("Oct 21, 18:00 – 20:00 CEST");
  });

  test("names the state the event is in, in its colour, readable on the dark theme too", () => {
    renderTooltip({ maintenanceEvents: [maintenance()] });

    const state: HTMLElement = screen.getByTestId(
      "uptime-tooltip-maintenance-state",
    );

    expect(state).toHaveTextContent("Completed");
    expect(state.style.color).toBe("rgb(22, 163, 74)");
    // The dark theme swaps in a lighter shade (StatusColorStyle).
    expect(state).toHaveAttribute(STATUS_TEXT_ATTRIBUTE);
  });

  test("an event whose state was not read shows no state at all, rather than a blank one", () => {
    renderTooltip({
      maintenanceEvents: [maintenance({ currentState: undefined })],
    });

    expect(
      screen.queryByTestId("uptime-tooltip-maintenance-state"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("uptime-tooltip-maintenance-window"),
    ).toBeInTheDocument();
  });

  test("comes after the incidents, set apart from them", () => {
    renderTooltip({
      incidents: [incident()],
      maintenanceEvents: [maintenance()],
    });

    const incidentTitle: HTMLElement = screen.getByText("Checkout API is down");
    const section: HTMLElement = screen.getByTestId(
      "uptime-tooltip-maintenance",
    );

    expect(
      incidentTitle.compareDocumentPosition(section) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Room above it for the rule that sets it apart.
    expect(section.style.paddingTop).toBe("10px");
  });

  test("on a day of maintenance alone, sits right under the uptime with no rule above it", () => {
    renderTooltip({ maintenanceEvents: [maintenance()] });

    expect(
      screen.getByTestId("uptime-tooltip-maintenance").style.paddingTop,
    ).toBe("");
    expect(screen.queryByText("Incidents")).not.toBeInTheDocument();
  });

  test("shows the first three events and counts the rest", () => {
    const events: Array<UptimeBarTooltipMaintenance> = [1, 2, 3, 4, 5].map(
      (index: number): UptimeBarTooltipMaintenance => {
        return maintenance({
          id: `e5000000-0000-4000-8000-00000000001${index}`,
          title: `Window ${index}`,
        });
      },
    );

    renderTooltip({ maintenanceEvents: events });

    expect(
      screen.getAllByTestId("uptime-tooltip-maintenance-item"),
    ).toHaveLength(3);
    expect(screen.getByText("Window 3")).toBeInTheDocument();
    expect(screen.queryByText("Window 4")).not.toBeInTheDocument();
    expect(screen.getByText("+2 more")).toBeInTheDocument();
    // The heading counts them all.
    expect(
      within(screen.getByTestId("uptime-tooltip-maintenance")).getByText("5"),
    ).toBeInTheDocument();
  });

  test("opens the event's page when the caller can, as a button", () => {
    const onMaintenanceClick: ReturnType<typeof jest.fn<(id: string) => void>> =
      jest.fn<(id: string) => void>();
    const onParentClick: ReturnType<typeof jest.fn<() => void>> =
      jest.fn<() => void>();

    render(
      <div onClick={onParentClick}>
        <UptimeBarTooltip
          date={DAY}
          timezone="UTC"
          uptimePercent={100}
          hasEvents={true}
          statusDurations={[OPERATIONAL]}
          incidents={[]}
          maintenanceEvents={[maintenance()]}
          onMaintenanceClick={onMaintenanceClick}
        />
      </div>,
    );

    const item: HTMLElement = screen.getByRole("button", {
      name: /PHP security patches/,
    });

    fireEvent.click(item);

    expect(onMaintenanceClick).toHaveBeenCalledWith(
      "e5000000-0000-4000-8000-000000000001",
    );
    // The click is the event's, not the bar's beneath the tooltip.
    expect(onParentClick).not.toHaveBeenCalled();
  });

  test("is no button when nothing can be opened", () => {
    renderTooltip({ maintenanceEvents: [maintenance()] });

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByTestId("uptime-tooltip-maintenance-item").tagName).toBe(
      "DIV",
    );
  });

  test("holds no block element inside its button", () => {
    renderTooltip({
      maintenanceEvents: [maintenance()],
      onMaintenanceClick: () => {},
    });

    const item: HTMLElement = screen.getByRole("button");

    expect(item.querySelectorAll("div, p, h1, h2, h3, h4")).toHaveLength(0);
  });

  test("speaks the caller's language", () => {
    const labels: UptimeHistoryLabels = {
      ...DefaultUptimeHistoryLabels,
      scheduledMaintenance: "Geplante Wartung",
      moreMaintenance: "+{{total}} weitere",
    };

    const events: Array<UptimeBarTooltipMaintenance> = [1, 2, 3, 4].map(
      (index: number): UptimeBarTooltipMaintenance => {
        return maintenance({
          id: `e5000000-0000-4000-8000-00000000002${index}`,
          title: `Fenster ${index}`,
        });
      },
    );

    renderTooltip({ maintenanceEvents: events, labels: labels });

    expect(screen.getByText("Geplante Wartung")).toBeInTheDocument();
    expect(screen.getByText("+1 weitere")).toBeInTheDocument();
    expect(screen.queryByText("Scheduled maintenance")).not.toBeInTheDocument();
  });

  test("a day without maintenance draws the tooltip it always drew", () => {
    renderTooltip({ incidents: [incident()] });

    expect(
      screen.queryByTestId("uptime-tooltip-maintenance"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Incidents")).toBeInTheDocument();
    expect(screen.getByText("Checkout API is down")).toBeInTheDocument();

    cleanup();

    renderTooltip({ maintenanceEvents: [] });

    expect(
      screen.queryByTestId("uptime-tooltip-maintenance"),
    ).not.toBeInTheDocument();
  });

  test("a day nobody measured still lists the maintenance on it", () => {
    renderTooltip({
      hasEvents: false,
      statusDurations: [],
      maintenanceEvents: [maintenance()],
    });

    expect(
      screen.getByText("No monitoring data for this day"),
    ).toBeInTheDocument();
    expect(screen.getByText("PHP security patches")).toBeInTheDocument();
  });
});
