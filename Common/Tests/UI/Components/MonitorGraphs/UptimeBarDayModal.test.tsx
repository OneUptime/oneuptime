import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";
import UptimeBarDayModal from "../../../../UI/Components/MonitorGraphs/UptimeBarDayModal";
import { StatusDuration } from "../../../../UI/Components/Graphs/UptimeDaySummary";
import { Green, Red } from "../../../../Types/BrandColors";
import Color from "../../../../Types/Color";
import OneUptimeDate from "../../../../Types/Date";
import UptimeBarTooltipIncident from "../../../../Types/Monitor/UptimeBarTooltipIncident";
import UptimeHistoryLabels, {
  DefaultUptimeHistoryLabels,
} from "../../../../Types/Monitor/UptimeHistoryLabels";

/*
 * Contract under test - the dialog a day on the uptime strip opens.
 *
 * It used to be an incident list and nothing else, which was fine while only
 * days with incidents could open it. Now that every day opens - the only way a
 * phone or a keyboard can read a day, since the tooltip beside it is
 * hover-only - it has to carry the same reading the tooltip does. A dialog
 * that says "no incidents" on a day the service was down for six hours is
 * worse than no dialog.
 */

const DAY: Date = new Date("2026-03-03T12:00:00.000Z");

function makeIncident(
  overrides: Partial<UptimeBarTooltipIncident> = {},
): UptimeBarTooltipIncident {
  return {
    id: "incident-1",
    title: "Checkout API is down",
    declaredAt: DAY,
    monitorIds: [],
    ...overrides,
  };
}

const DOWNTIME: StatusDuration = {
  label: "Offline",
  seconds: 60 * 60 * 6,
  color: Red,
  isDowntime: true,
};

const UPTIME: StatusDuration = {
  label: "Operational",
  seconds: 60 * 60 * 18,
  color: Green,
  isDowntime: false,
};

describe("UptimeBarDayModal - the day's reading", () => {
  test("shows the uptime percentage when the caller measured the day", () => {
    render(
      <UptimeBarDayModal
        date={DAY}
        incidents={[]}
        hasEvents={true}
        uptimePercent={75}
        statusDurations={[DOWNTIME, UPTIME]}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("Uptime")).toBeInTheDocument();
    expect(screen.getByText("75.00")).toBeInTheDocument();
  });

  test("names every status the day passed through", () => {
    render(
      <UptimeBarDayModal
        date={DAY}
        incidents={[]}
        hasEvents={true}
        uptimePercent={75}
        statusDurations={[DOWNTIME, UPTIME]}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("Offline")).toBeInTheDocument();
    expect(screen.getByText("Operational")).toBeInTheDocument();
  });

  /*
   * A day before the monitor existed is not a day of downtime, and must not
   * be drawn as 0%.
   */
  test("a day with no timeline rows says so rather than showing 0%", () => {
    render(
      <UptimeBarDayModal
        date={DAY}
        incidents={[]}
        hasEvents={false}
        uptimePercent={0}
        statusDurations={[]}
        onClose={() => {}}
      />,
    );

    expect(
      screen.getByText("No monitoring data for this day"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Uptime")).not.toBeInTheDocument();
  });

  /*
   * The dashboard's monitor-group page still opens this dialog without a
   * reading. Rendering "0% uptime" there would be inventing a measurement
   * nobody took.
   */
  test("a caller that measured nothing gets no uptime block at all", () => {
    render(<UptimeBarDayModal date={DAY} incidents={[]} onClose={() => {}} />);

    expect(screen.queryByText("Uptime")).not.toBeInTheDocument();
    expect(
      screen.queryByText("No monitoring data for this day"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("No incidents")).toBeInTheDocument();
  });
});

describe("UptimeBarDayModal - incidents", () => {
  test("a quiet day says it was quiet", () => {
    render(
      <UptimeBarDayModal
        date={DAY}
        incidents={[]}
        hasEvents={true}
        uptimePercent={100}
        statusDurations={[UPTIME]}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("No incidents")).toBeInTheDocument();
    expect(
      screen.getByText("No incidents were reported on this day."),
    ).toBeInTheDocument();
  });

  test("lists the incidents declared that day", () => {
    render(
      <UptimeBarDayModal
        date={DAY}
        incidents={[
          makeIncident(),
          makeIncident({ id: "incident-2", title: "Search is degraded" }),
        ]}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("Checkout API is down")).toBeInTheDocument();
    expect(screen.getByText("Search is degraded")).toBeInTheDocument();
    expect(screen.queryByText("No incidents")).not.toBeInTheDocument();
  });

  test("clicking an incident hands its id back", () => {
    const onIncidentClick: ReturnType<typeof jest.fn<(id: string) => void>> =
      jest.fn<(id: string) => void>();

    render(
      <UptimeBarDayModal
        date={DAY}
        incidents={[makeIncident()]}
        onIncidentClick={onIncidentClick}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByText("Checkout API is down"));

    expect(onIncidentClick).toHaveBeenCalledWith("incident-1");
  });

  test("the dialog is titled with the day it is about", () => {
    render(<UptimeBarDayModal date={DAY} incidents={[]} onClose={() => {}} />);

    expect(
      screen.getByText(
        OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(DAY, true),
      ),
    ).toBeInTheDocument();
  });

  test("one incident is described in the singular", () => {
    render(
      <UptimeBarDayModal
        date={DAY}
        incidents={[makeIncident()]}
        onClose={() => {}}
      />,
    );

    expect(
      screen.getByText("1 incident reported on this day"),
    ).toBeInTheDocument();
  });

  test("more than one is counted", () => {
    render(
      <UptimeBarDayModal
        date={DAY}
        incidents={[
          makeIncident(),
          makeIncident({ id: "incident-2" }),
          makeIncident({ id: "incident-3" }),
        ]}
        onClose={() => {}}
      />,
    );

    expect(
      screen.getByText("3 incidents reported on this day"),
    ).toBeInTheDocument();
  });

  test("a severity and a state are shown when the incident carries them", () => {
    render(
      <UptimeBarDayModal
        date={DAY}
        incidents={[
          makeIncident({
            incidentSeverity: { name: "Major", color: new Color("#ff0000") },
            currentIncidentState: {
              name: "Identified",
              color: new Color("#ffaa00"),
            },
          }),
        ]}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("Major")).toBeInTheDocument();
    expect(screen.getByText("Identified")).toBeInTheDocument();
  });
});

describe("UptimeBarDayModal - translation", () => {
  /*
   * The status page is public and ships in fifteen languages. A dialog every
   * day now opens cannot be the one English thing on it.
   */
  test("every string the caller supplies is used", () => {
    const labels: UptimeHistoryLabels = {
      ...DefaultUptimeHistoryLabels,
      uptime: "Disponibilite",
      noIncidents: "Aucun incident",
      noIncidentsDescription: "Aucun incident signale ce jour-la.",
      close: "Fermer",
    };

    render(
      <UptimeBarDayModal
        date={DAY}
        incidents={[]}
        hasEvents={true}
        uptimePercent={100}
        statusDurations={[UPTIME]}
        labels={labels}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("Disponibilite")).toBeInTheDocument();
    expect(screen.getByText("Aucun incident")).toBeInTheDocument();
    expect(
      screen.getByText("Aucun incident signale ce jour-la."),
    ).toBeInTheDocument();
    expect(screen.getByText("Fermer")).toBeInTheDocument();
  });

  test("the incident count sentence is translated too", () => {
    const labels: UptimeHistoryLabels = {
      ...DefaultUptimeHistoryLabels,
      incidentsOnThisDay: "{{total}} incidents signales",
      declared: "Declare le",
    };

    render(
      <UptimeBarDayModal
        date={DAY}
        incidents={[makeIncident(), makeIncident({ id: "incident-2" })]}
        labels={labels}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("2 incidents signales")).toBeInTheDocument();
    expect(screen.getAllByText(/Declare le/)).toHaveLength(2);
  });

  test("without labels it falls back to English", () => {
    render(<UptimeBarDayModal date={DAY} incidents={[]} onClose={() => {}} />);

    expect(screen.getByText("No incidents")).toBeInTheDocument();
  });
});
