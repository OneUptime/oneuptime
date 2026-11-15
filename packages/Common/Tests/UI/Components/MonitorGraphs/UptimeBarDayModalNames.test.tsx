/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import UptimeBarDayModal from "../../../../UI/Components/MonitorGraphs/UptimeBarDayModal";
import { StatusDuration } from "../../../../UI/Components/Graphs/UptimeDaySummary";
import { Green, Red, Yellow } from "../../../../Types/BrandColors";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import UptimeBarTooltipIncident from "../../../../Types/Monitor/UptimeBarTooltipIncident";
import UptimeBarTooltipMaintenance from "../../../../Types/Monitor/UptimeBarTooltipMaintenance";
import { ScheduledMaintenancePhaseOfState } from "../../../../Utils/ScheduledMaintenanceStart";
import { readDashboardLocale } from "../../../Helpers/DashboardLocales";

/*
 * A DAY'S EVENTS NAME THEIR SEVERITIES AND STATES AS THE PROJECT DID (#7780).
 *
 * The dialog a day of a monitor's uptime opens (the Dashboard's uptime
 * history, a status page's monitor) draws each incident's severity and
 * state, and each maintenance event's state, as a Pill. The Pill looked
 * every name up: on a Spanish page an incident state a project named
 * "Open" read "Abrir", the verb, and a severity named "Network" read "Red".
 * A name the project gave reads as written now, and the names a new
 * project starts with in the reader's language, each by its own list
 * (Common/Utils/DefaultRecordNames).
 */

const SPANISH: Record<string, string> = readDashboardLocale("es");

const DAY: Date = new Date("2026-10-21T00:00:00.000Z");

const OPERATIONAL: StatusDuration = {
  label: "Operational",
  seconds: 24 * 60 * 60,
  color: Green,
  isDowntime: false,
};

const OWN_SEVERITY_DEFAULT_STATE: UptimeBarTooltipIncident = {
  id: "e8200000-0000-4000-8000-000000000011",
  title: "Checkout API is down",
  declaredAt: new Date("2026-10-21T09:00:00.000Z"),
  incidentSeverity: { name: "Network", color: Red },
  currentIncidentState: { name: "Resolved", color: Green },
  monitorIds: [],
};

const DEFAULT_SEVERITY_OWN_STATE: UptimeBarTooltipIncident = {
  id: "e8200000-0000-4000-8000-000000000012",
  title: "Payments are slow",
  declaredAt: new Date("2026-10-21T11:00:00.000Z"),
  incidentSeverity: { name: "Critical Incident", color: Red },
  currentIncidentState: { name: "Open", color: Yellow },
  monitorIds: [],
};

const DEFAULT_MAINTENANCE_STATE: UptimeBarTooltipMaintenance = {
  id: "e8000000-0000-4000-8000-000000000011",
  title: "Database upgrade",
  startsAt: new Date("2026-10-21T08:00:00.000Z"),
  endsAt: new Date("2026-10-21T10:00:00.000Z"),
  currentState: { name: "Ongoing", color: Yellow },
  phase: ScheduledMaintenancePhaseOfState.InProgress,
  monitorIds: [new ObjectID("e8100000-0000-4000-8000-000000000011")],
};

const OWN_MAINTENANCE_STATE: UptimeBarTooltipMaintenance = {
  id: "e8000000-0000-4000-8000-000000000012",
  title: "Network switch swap",
  startsAt: new Date("2026-10-21T12:00:00.000Z"),
  endsAt: new Date("2026-10-21T13:00:00.000Z"),
  currentState: { name: "Open", color: Yellow },
  phase: ScheduledMaintenancePhaseOfState.InProgress,
  monitorIds: [new ObjectID("e8100000-0000-4000-8000-000000000012")],
};

// The Dashboard's Spanish, English behind it, as it ships.
function spanishI18n(): i18n {
  const instance: i18n = createInstance();

  instance.init({
    lng: "es",
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      es: { translation: SPANISH },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
    initImmediate: false,
  });

  return instance;
}

function renderDayInSpanish(): void {
  render(
    <I18nextProvider i18n={spanishI18n()}>
      <UptimeBarDayModal
        date={DAY}
        timezone="UTC"
        incidents={[OWN_SEVERITY_DEFAULT_STATE, DEFAULT_SEVERITY_OWN_STATE]}
        maintenanceEvents={[DEFAULT_MAINTENANCE_STATE, OWN_MAINTENANCE_STATE]}
        hasEvents={true}
        uptimePercent={100}
        statusDurations={[OPERATIONAL]}
        onIncidentClick={() => {}}
        onMaintenanceClick={() => {}}
        onClose={() => {}}
      />
    </I18nextProvider>,
  );
}

// The words of each pill in each of the day's cards of one kind, in order.
function pillsOfEachCard(cardTestId: string): Array<Array<string>> {
  return screen.getAllByTestId(cardTestId).map((card: HTMLElement) => {
    return within(card)
      .getAllByTestId("pill-text")
      .map((text: HTMLElement): string => {
        return text.textContent || "";
      });
  });
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

describe("the words the cases below lean on", () => {
  test("Spanish has words of its own for Network, Open, Resolved, Critical Incident and Ongoing", () => {
    expect({
      Network: SPANISH["Network"],
      Open: SPANISH["Open"],
      Resolved: SPANISH["Resolved"],
      "Critical Incident": SPANISH["Critical Incident"],
      Ongoing: SPANISH["Ongoing"],
    }).toEqual({
      Network: "Red",
      Open: "Abrir",
      Resolved: "Resuelto",
      "Critical Incident": "Incidente crítico",
      Ongoing: "En curso",
    });
  });
});

describe("a day's events, on a Spanish page", () => {
  test("an incident's severity and state: the project's names as written, a new project's in Spanish", () => {
    renderDayInSpanish();

    expect(pillsOfEachCard("uptime-day-incident-item")).toEqual([
      ["Network", "Resuelto"],
      ["Incidente crítico", "Open"],
    ]);
  });

  test("a maintenance event's state: a new project's in Spanish, the project's own as written", () => {
    renderDayInSpanish();

    expect(pillsOfEachCard("uptime-day-maintenance-item")).toEqual([
      ["En curso"],
      ["Open"],
    ]);
  });
});
