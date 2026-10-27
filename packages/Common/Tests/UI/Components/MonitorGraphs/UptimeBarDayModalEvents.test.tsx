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
import UptimeBarDayModal, {
  DAY_EVENT_CARD_FOCUS_CLASS_NAME,
} from "../../../../UI/Components/MonitorGraphs/UptimeBarDayModal";
import {
  getUptimeDayToneProps,
  INCIDENT_MARK_COLOR,
} from "../../../../UI/Components/Graphs/UptimeDayEventTone";
import { getPillColors } from "../../../../UI/Components/Pill/PillColors";
import { ICON_MIRRORED_RIGHT_TO_LEFT_CLASS_NAME } from "../../../../UI/Components/Icon/Icon";
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
 * Contract under test - the events a day's dialog lists, after the UI
 * review of issue #5236.
 *
 * An incident and a maintenance event are the same kind of thing to a
 * reader - something that happened that day, with a page of its own - so
 * they are the same card: a button a keyboard reaches (the incidents were
 * not, while the maintenance was), the same border (the maintenance card
 * alone carried a blue edge whose round corners drew a bracket), and their
 * states and severities in the product's Pill, which reads in any colour
 * (the stock "Ongoing" amber read at 1.5:1). Each list's heading has its
 * icon, so the two names line up, and the dialog starts on itself, so the
 * Enter that opened it cannot open an event too.
 */

const DAY: Date = new Date("2026-10-21T00:00:00.000Z");

const OPERATIONAL: StatusDuration = {
  label: "Operational",
  seconds: 24 * 60 * 60,
  color: Green,
  isDowntime: false,
};

const INCIDENT: UptimeBarTooltipIncident = {
  id: "e8200000-0000-4000-8000-000000000001",
  title: "Checkout API is down",
  declaredAt: new Date("2026-10-21T09:00:00.000Z"),
  incidentSeverity: { name: "Major", color: Red },
  currentIncidentState: { name: "Resolved", color: Green },
  monitorIds: [],
};

const MAINTENANCE: UptimeBarTooltipMaintenance = {
  id: "e8000000-0000-4000-8000-000000000001",
  title: "Database upgrade",
  startsAt: new Date("2026-10-21T08:00:00.000Z"),
  endsAt: new Date("2026-10-21T10:00:00.000Z"),
  currentState: { name: "Ongoing", color: Yellow },
  phase: ScheduledMaintenancePhaseOfState.InProgress,
  monitorIds: [new ObjectID("e8100000-0000-4000-8000-000000000001")],
};

// A colour as the browser writes it back: "rgb(r, g, b)".
function rgbOf(color: string): string {
  const rgb: RGB = parseColor(color)!;

  return `rgb(${rgb.red}, ${rgb.green}, ${rgb.blue})`;
}

function renderDialog(
  props: Partial<React.ComponentProps<typeof UptimeBarDayModal>> = {},
): void {
  render(
    <UptimeBarDayModal
      date={DAY}
      timezone="UTC"
      incidents={[INCIDENT]}
      maintenanceEvents={[MAINTENANCE]}
      hasEvents={true}
      uptimePercent={100}
      statusDurations={[OPERATIONAL]}
      onIncidentClick={() => {}}
      onMaintenanceClick={() => {}}
      onClose={() => {}}
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

describe("UptimeBarDayModal - every event is reachable", () => {
  test("an incident is a button that opens its page, as a maintenance event is", () => {
    const onIncidentClick: ReturnType<typeof jest.fn<(id: string) => void>> =
      jest.fn<(id: string) => void>();

    renderDialog({ onIncidentClick: onIncidentClick });

    const incident: HTMLElement = screen.getByRole("button", {
      name: /Checkout API is down/,
    });

    expect(incident).toHaveAttribute("data-testid", "uptime-day-incident-item");
    expect(incident).toHaveAttribute("type", "button");

    fireEvent.click(incident);

    expect(onIncidentClick).toHaveBeenCalledWith(INCIDENT.id);
  });

  test("a keyboard reaches both kinds, incidents first", () => {
    renderDialog();

    const names: Array<string> = within(screen.getByRole("dialog"))
      .getAllByRole("button")
      .map((button: HTMLElement): string => {
        return button.getAttribute("data-testid") || "";
      })
      .filter((testId: string): boolean => {
        return testId.startsWith("uptime-day-");
      });

    expect(names).toEqual([
      "uptime-day-incident-item",
      "uptime-day-maintenance-item",
    ]);
  });

  test("an incident nothing can open is no button", () => {
    renderDialog({ onIncidentClick: undefined });

    expect(
      screen.queryByRole("button", { name: /Checkout API is down/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("uptime-day-incident-item").tagName).toBe("DIV");
  });

  test("an incident's button holds no block element", () => {
    renderDialog();

    expect(
      screen
        .getByTestId("uptime-day-incident-item")
        .querySelectorAll("div, p, h1, h2, h3, h4"),
    ).toHaveLength(0);
  });

  test("the dialog starts on itself, so the Enter that opened it opens no event", () => {
    renderDialog();

    expect(screen.getByRole("dialog")).toHaveFocus();
    expect(screen.getByTestId("uptime-day-incident-item")).not.toHaveFocus();
  });
});

describe("UptimeBarDayModal - one card for both kinds", () => {
  test("an incident and a maintenance event are drawn alike", () => {
    renderDialog();

    expect(
      screen.getByTestId("uptime-day-maintenance-item").getAttribute("style"),
    ).toBe(
      screen.getByTestId("uptime-day-incident-item").getAttribute("style"),
    );
  });

  test("the maintenance card carries no blue edge of its own", () => {
    renderDialog();

    const style: string =
      screen.getByTestId("uptime-day-maintenance-item").getAttribute("style") ||
      "";

    expect(style).not.toContain("border-left");
    expect(style).not.toContain(rgbOf(MAINTENANCE_MARK_COLOR.toString()));
  });

  test("each card's chevron turns round with the line on a page read right to left", () => {
    renderDialog();

    const chevrons: Array<HTMLElement> = screen.getAllByTestId(
      "uptime-day-event-chevron",
    );

    expect(chevrons).toHaveLength(2);

    for (const chevron of chevrons) {
      expect(chevron.getAttribute("class")).toBe(
        ICON_MIRRORED_RIGHT_TO_LEFT_CLASS_NAME,
      );
    }
  });

  test("the keyboard's ring is an outline, which the hover's shadow cannot hide", () => {
    renderDialog();

    const card: HTMLElement = screen.getByTestId("uptime-day-maintenance-item");

    expect(card.className).toBe(DAY_EVENT_CARD_FOCUS_CLASS_NAME);
    expect(card.className).toContain("focus-visible:outline-2");

    fireEvent.mouseEnter(card);
    expect(card.style.boxShadow).not.toBe("");

    fireEvent.mouseLeave(card);
    // Taken off, not set to none: a ring drawn as a shadow would lose to it.
    expect(card.style.boxShadow).toBe("");
  });
});

describe("UptimeBarDayModal - states and severities are the product's Pill", () => {
  test("a maintenance event's state is a Pill, toned so the stock amber reads", () => {
    renderDialog();

    const state: HTMLElement = within(
      screen.getByTestId("uptime-day-maintenance-state"),
    ).getByTestId("pill");

    expect(state).toHaveTextContent("Ongoing");
    expect(state.style.color).toBe(
      rgbOf(getPillColors(Yellow).light.textColor),
    );
    expect(state).toHaveAttribute("data-ou-pill");
  });

  test("an incident's severity and state are Pills too", () => {
    renderDialog();

    const pills: Array<HTMLElement> = within(
      screen.getByTestId("uptime-day-incident-item"),
    ).getAllByTestId("pill");

    expect(
      pills.map((pill: HTMLElement): string => {
        return pill.textContent || "";
      }),
    ).toEqual(["Major", "Resolved"]);
    expect(pills[0]!.style.color).toBe(
      rgbOf(getPillColors(Red).light.textColor),
    );
    expect(pills[1]!.style.color).toBe(
      rgbOf(getPillColors(Green).light.textColor),
    );
  });

  test("an event without a state or a severity draws no empty Pill", () => {
    renderDialog({
      incidents: [
        {
          ...INCIDENT,
          incidentSeverity: undefined,
          currentIncidentState: undefined,
        },
      ],
      maintenanceEvents: [{ ...MAINTENANCE, currentState: undefined }],
    });

    expect(screen.queryAllByTestId("pill")).toHaveLength(0);
  });
});

describe("UptimeBarDayModal - the two lists read apart", () => {
  test("each heading has its own icon, so the two names line up", () => {
    renderDialog();

    expect(
      within(screen.getByTestId("uptime-day-incidents")).getByTestId(
        "uptime-day-incident-icon",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("uptime-day-maintenance")).getByTestId(
        "uptime-day-maintenance-icon",
      ),
    ).toBeInTheDocument();
  });

  test("each count is toned in its kind's colour", () => {
    renderDialog();

    const counts: Array<HTMLElement> = screen.getAllByTestId(
      "uptime-day-section-count",
    );
    const tone: (color: Color) => string = (color: Color): string => {
      return rgbOf(String(getUptimeDayToneProps(color).style.color));
    };

    expect(counts).toHaveLength(2);
    expect(counts[0]!.style.color).toBe(tone(INCIDENT_MARK_COLOR));
    expect(counts[1]!.style.color).toBe(tone(MAINTENANCE_MARK_COLOR));
    for (const count of counts) {
      expect(count).toHaveAttribute("data-ou-pill");
    }
  });

  test("a day of incidents alone keeps no headings, as it always had", () => {
    renderDialog({ maintenanceEvents: [] });

    expect(
      screen.queryByTestId("uptime-day-incident-icon"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("uptime-day-section-count"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("1 incident reported on this day"),
    ).toBeInTheDocument();
  });
});
