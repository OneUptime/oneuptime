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
import UptimeBarDayModal from "../../../../UI/Components/MonitorGraphs/UptimeBarDayModal";
import { StatusDuration } from "../../../../UI/Components/Graphs/UptimeDaySummary";
import { Green } from "../../../../Types/BrandColors";
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

/*
 * Contract under test - the dialog a day of the uptime strip opens lists the
 * day's scheduled maintenance beside its incidents (issue #5236).
 *
 * The dialog is how a phone or a keyboard reads a day, so it says what the
 * tooltip says: the day's planned work, each event's window on the
 * reader's clock and its state, each opening the event's page. A day of
 * maintenance and no incidents is not "nothing happened": the all-clear
 * shrinks to one line and the work is the story.
 */

const DAY: Date = new Date("2026-10-21T00:00:00.000Z");

const OPERATIONAL: StatusDuration = {
  label: "Operational",
  seconds: 16 * 60 * 60,
  color: Green,
  isDowntime: false,
};

const DEGRADED: StatusDuration = {
  label: "Degraded",
  seconds: 8 * 60 * 60,
  color: new Color("#eab308"),
  isDowntime: true,
};

function maintenance(
  overrides: Partial<UptimeBarTooltipMaintenance> = {},
): UptimeBarTooltipMaintenance {
  return {
    id: "e7000000-0000-4000-8000-000000000001",
    title: "PHP security patches",
    startsAt: new Date("2026-10-21T16:00:00.000Z"),
    endsAt: new Date("2026-10-22T00:00:00.000Z"),
    currentState: { name: "Completed", color: new Color("#16a34a") },
    phase: ScheduledMaintenancePhaseOfState.Over,
    monitorIds: [new ObjectID("e7100000-0000-4000-8000-000000000001")],
    ...overrides,
  };
}

const INCIDENT: UptimeBarTooltipIncident = {
  id: "e7200000-0000-4000-8000-000000000001",
  title: "Checkout API is down",
  declaredAt: new Date("2026-10-21T09:00:00.000Z"),
  monitorIds: [],
};

function renderDialog(
  props: Partial<React.ComponentProps<typeof UptimeBarDayModal>> = {},
): void {
  render(
    <UptimeBarDayModal
      date={DAY}
      timezone="UTC"
      incidents={[]}
      hasEvents={true}
      uptimePercent={66.67}
      statusDurations={[DEGRADED, OPERATIONAL]}
      onClose={() => {}}
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

describe("UptimeBarDayModal - a day of maintenance and no incidents", () => {
  test("lists the event under its own heading, with how many there are", () => {
    renderDialog({ maintenanceEvents: [maintenance()] });

    const section: HTMLElement = screen.getByTestId("uptime-day-maintenance");

    expect(
      within(section).getByRole("heading", { name: "Scheduled maintenance" }),
    ).toBeInTheDocument();
    expect(within(section).getByText("1")).toBeInTheDocument();
    expect(within(section).getByText("PHP security patches")).toBeInTheDocument();
  });

  test("gives each event's window on the reader's clock, and its state", () => {
    renderDialog({ maintenanceEvents: [maintenance()] });

    expect(
      screen.getByTestId("uptime-day-maintenance-window"),
    ).toHaveTextContent("Oct 21, 18:00 – Oct 22, 02:00 CEST");
    expect(screen.getByTestId("uptime-day-maintenance-state")).toHaveTextContent(
      "Completed",
    );
  });

  test("says there were no incidents in one quiet line, not the big all-clear", () => {
    renderDialog({ maintenanceEvents: [maintenance()] });

    expect(screen.getByTestId("uptime-day-no-incidents-line")).toHaveTextContent(
      "No incidents were reported on this day.",
    );
    // The big empty state's title.
    expect(screen.queryByText("No incidents")).not.toBeInTheDocument();
  });

  test("puts the all-clear line before the maintenance, as incidents come first", () => {
    renderDialog({ maintenanceEvents: [maintenance()] });

    expect(
      screen
        .getByTestId("uptime-day-no-incidents-line")
        .compareDocumentPosition(screen.getByTestId("uptime-day-maintenance")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("keeps the day's reading above it all", () => {
    renderDialog({ maintenanceEvents: [maintenance()] });

    expect(screen.getByText("Uptime")).toBeInTheDocument();
    expect(screen.getByText("Degraded")).toBeInTheDocument();
    expect(
      screen
        .getByText("Uptime")
        .compareDocumentPosition(screen.getByTestId("uptime-day-maintenance")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("its subtitle stays the incidents' - none - so it adds nothing", () => {
    renderDialog({ maintenanceEvents: [maintenance()] });

    expect(
      screen.queryByText(/incidents? reported on this day/),
    ).not.toBeInTheDocument();
  });
});

describe("UptimeBarDayModal - a day of incidents and maintenance", () => {
  test("gives each kind a heading, incidents first", () => {
    renderDialog({
      incidents: [INCIDENT],
      maintenanceEvents: [maintenance()],
    });

    const incidentsHeading: HTMLElement = screen.getByRole("heading", {
      name: "Incidents",
    });
    const maintenanceHeading: HTMLElement = screen.getByRole("heading", {
      name: "Scheduled maintenance",
    });

    expect(
      incidentsHeading.compareDocumentPosition(
        screen.getByText("Checkout API is down"),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen
        .getByText("Checkout API is down")
        .compareDocumentPosition(maintenanceHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("the headings sit under the dialog's own title", () => {
    renderDialog({
      incidents: [INCIDENT],
      maintenanceEvents: [maintenance()],
    });

    expect(
      screen.getByRole("heading", { name: "Incidents" }).tagName,
    ).toBe("H4");
    expect(
      screen.getByRole("heading", { name: "Scheduled maintenance" }).tagName,
    ).toBe("H4");
  });

  test("keeps the incident subtitle and draws no all-clear", () => {
    renderDialog({
      incidents: [INCIDENT],
      maintenanceEvents: [maintenance()],
    });

    expect(
      screen.getByText("1 incident reported on this day"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("uptime-day-no-incidents-line"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("No incidents")).not.toBeInTheDocument();
  });
});

describe("UptimeBarDayModal - opening an event", () => {
  test("each event is a button that opens its page", () => {
    const onMaintenanceClick: ReturnType<
      typeof jest.fn<(id: string) => void>
    > = jest.fn<(id: string) => void>();

    renderDialog({
      maintenanceEvents: [
        maintenance(),
        maintenance({
          id: "e7000000-0000-4000-8000-000000000002",
          title: "Network cutover",
          startsAt: new Date("2026-10-21T20:00:00.000Z"),
          endsAt: new Date("2026-10-21T21:00:00.000Z"),
        }),
      ],
      onMaintenanceClick: onMaintenanceClick,
    });

    fireEvent.click(screen.getByRole("button", { name: /Network cutover/ }));

    expect(onMaintenanceClick).toHaveBeenCalledWith(
      "e7000000-0000-4000-8000-000000000002",
    );
  });

  test("lists every event, however many, in the order given", () => {
    renderDialog({
      maintenanceEvents: [1, 2, 3, 4, 5].map(
        (index: number): UptimeBarTooltipMaintenance => {
          return maintenance({
            id: `e7000000-0000-4000-8000-00000000001${index}`,
            title: `Window ${index}`,
          });
        },
      ),
    });

    expect(
      screen
        .getAllByTestId("uptime-day-maintenance-item")
        .map((item: HTMLElement): string => {
          return item.textContent || "";
        })
        .map((text: string): string => {
          return text.slice(0, "Window 1".length);
        }),
    ).toEqual(["Window 1", "Window 2", "Window 3", "Window 4", "Window 5"]);
    expect(
      within(screen.getByTestId("uptime-day-maintenance")).getByText("5"),
    ).toBeInTheDocument();
  });

  test("is no button when nothing can be opened", () => {
    renderDialog({ maintenanceEvents: [maintenance()] });

    expect(
      screen.queryByRole("button", { name: /PHP security patches/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("uptime-day-maintenance-item").tagName).toBe(
      "DIV",
    );
  });

  test("holds no block element inside its button", () => {
    renderDialog({
      maintenanceEvents: [maintenance()],
      onMaintenanceClick: () => {},
    });

    const item: HTMLElement = screen.getByRole("button", {
      name: /PHP security patches/,
    });

    expect(item.querySelectorAll("div, p, h1, h2, h3, h4")).toHaveLength(0);
  });

  test("an event whose state was not read shows its window and no state", () => {
    renderDialog({
      maintenanceEvents: [maintenance({ currentState: undefined })],
    });

    expect(
      screen.queryByTestId("uptime-day-maintenance-state"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("uptime-day-maintenance-window"),
    ).toBeInTheDocument();
  });
});

describe("UptimeBarDayModal - a day without maintenance is the dialog it always was", () => {
  test("no incidents: the big all-clear, and no maintenance section", () => {
    renderDialog();

    expect(screen.getByText("No incidents")).toBeInTheDocument();
    expect(
      screen.getByText("No incidents were reported on this day."),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("uptime-day-maintenance"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("uptime-day-no-incidents-line"),
    ).not.toBeInTheDocument();
  });

  test("incidents: no headings over them", () => {
    renderDialog({ incidents: [INCIDENT], maintenanceEvents: [] });

    expect(
      screen.queryByRole("heading", { name: "Incidents" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Checkout API is down")).toBeInTheDocument();
  });
});

describe("UptimeBarDayModal - in the caller's language", () => {
  test("the headings and the all-clear line are the caller's words", () => {
    const labels: UptimeHistoryLabels = {
      ...DefaultUptimeHistoryLabels,
      incidents: "Vorfälle",
      scheduledMaintenance: "Geplante Wartung",
      noIncidentsDescription: "An diesem Tag wurden keine Vorfälle gemeldet.",
    };

    renderDialog({ labels: labels, maintenanceEvents: [maintenance()] });

    expect(
      screen.getByRole("heading", { name: "Geplante Wartung" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("uptime-day-no-incidents-line")).toHaveTextContent(
      "An diesem Tag wurden keine Vorfälle gemeldet.",
    );

    cleanup();

    renderDialog({
      labels: labels,
      incidents: [INCIDENT],
      maintenanceEvents: [maintenance()],
    });

    expect(screen.getByRole("heading", { name: "Vorfälle" })).toBeInTheDocument();
  });
});
