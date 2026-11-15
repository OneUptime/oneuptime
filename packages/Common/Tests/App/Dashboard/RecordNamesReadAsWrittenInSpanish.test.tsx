// UX rule: Docs/ux/README.md#in-every-language
import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import AlertSeverityElement from "../../../../App/FeatureSet/Dashboard/src/Components/AlertSeverity/AlertSeverityElement";
import { EVENT_HEADER_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventHeaderLayout";
import EventStatusPanel, {
  EventStateItem,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventStatusPanel";
import IncidentStateElement from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentState/IncidentStateElement";
import MonitorStatusElement from "../../../../App/FeatureSet/Dashboard/src/Components/MonitorStatus/MonitorStatusElement";
import {
  SecurityCasePriorityPill,
  SecurityCaseStatusPill,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCasePills";
import { StateSettingsNameCell } from "../../../../App/FeatureSet/Dashboard/src/Components/StateSettings/StateSettingsTable";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Label from "../../../Models/DatabaseModels/Label";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import Color from "../../../Types/Color";
import LabelElement from "../../../UI/Components/Label/Label";
import { StateListType } from "../../../Utils/StateOrder";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

/*
 * A NAME READS AS WRITTEN; ONEUPTIME'S DEFAULT NAMES IN THE READER'S
 * LANGUAGE (#7780).
 *
 * A badge (Pill, StatusBubble) looked every text up in the reader's
 * language, names too. Spanish has words for "Network" (Red) and "Open"
 * (Abrir, the verb), so on a Spanish page a label named "Network" read
 * "Red", and a state a project named "Open" read "Abrir" - beside the
 * filter's menu and chip, which read "Network" and "Open" (#7690).
 *
 * Each badge drawn here with the Dashboard's real Spanish words now says
 * how its name reads: a label's name, always as written; a state's, a
 * severity's, a status's and a security case value's by the one rule for
 * them (Common/Utils/DefaultRecordNames) - OneUptime's default names, such
 * as "Resolved", looked up ("Resuelto"), the project's own as written.
 * RecordNamesInPillsGuard holds every other badge that draws a name to
 * the same rule.
 */

const SPANISH: Record<string, string> = readDashboardLocale("es");
const GREEN: Color = new Color("#10b981");
const RED: Color = new Color("#ef4444");

let spanishInstance: i18n | null = null;

// The Dashboard's Spanish, English behind it, as it ships.
function spanishI18n(): i18n {
  if (spanishInstance) {
    return spanishInstance;
  }

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

  spanishInstance = instance;

  return instance;
}

function renderInSpanish(element: ReactElement): void {
  render(<I18nextProvider i18n={spanishI18n()}>{element}</I18nextProvider>);
}

// The words of the one pill on the page.
function pillText(): string {
  return screen.getByTestId("pill-text").textContent || "";
}

afterEach(() => {
  cleanup();
});

describe("the words the cases below lean on", () => {
  test("Spanish has words of its own for Network, Open, Resolved, High and Operational", () => {
    expect({
      Network: SPANISH["Network"],
      Open: SPANISH["Open"],
      Resolved: SPANISH["Resolved"],
      High: SPANISH["High"],
      Operational: SPANISH["Operational"],
      Investigating: SPANISH["Investigating"],
      Identified: SPANISH["Identified"],
      "Critical Incident": SPANISH["Critical Incident"],
    }).toEqual({
      Network: "Red",
      Open: "Abrir",
      Resolved: "Resuelto",
      High: "Alta",
      Operational: "Operativo",
      Investigating: "Investigando",
      Identified: "Identificado",
      "Critical Incident": "Incidente crítico",
    });
  });
});

describe("a label", () => {
  test("named Network reads Network, never Red", () => {
    const label: Label = new Label();
    label.name = "Network";
    label.color = GREEN;

    renderInSpanish(<LabelElement label={label} />);

    expect(pillText()).toBe("Network");
  });
});

describe("an incident's state in a list of incidents", () => {
  function stateNamed(name: string): IncidentState {
    const state: IncidentState = new IncidentState();
    state.name = name;
    state.color = RED;
    return state;
  }

  test("a state the project named Open reads Open, never Abrir", () => {
    renderInSpanish(
      <IncidentStateElement incidentState={stateNamed("Open")} />,
    );

    expect(pillText()).toBe("Open");
  });

  test("the default Resolved reads Resuelto", () => {
    renderInSpanish(
      <IncidentStateElement incidentState={stateNamed("Resolved")} />,
    );

    expect(pillText()).toBe("Resuelto");
  });

  test("a state with no name reads the product's word for it", () => {
    renderInSpanish(<IncidentStateElement incidentState={stateNamed("")} />);

    expect(pillText()).toBe(SPANISH["Unknown"]);
  });
});

describe("an alert's severity", () => {
  function severityNamed(name: string): AlertSeverity {
    const severity: AlertSeverity = new AlertSeverity();
    severity.name = name;
    severity.color = RED;
    return severity;
  }

  test("the default High reads Alta", () => {
    renderInSpanish(
      <AlertSeverityElement alertSeverity={severityNamed("High")} />,
    );

    expect(pillText()).toBe("Alta");
  });

  test("a severity the project named Network reads Network", () => {
    renderInSpanish(
      <AlertSeverityElement alertSeverity={severityNamed("Network")} />,
    );

    expect(pillText()).toBe("Network");
  });
});

describe("a monitor's status in the monitor list", () => {
  function statusNamed(name: string): MonitorStatus {
    const status: MonitorStatus = new MonitorStatus();
    status.name = name;
    status.color = GREEN;
    return status;
  }

  test("the default Operational reads Operativo", () => {
    renderInSpanish(
      <MonitorStatusElement
        monitorStatus={statusNamed("Operational")}
        shouldAnimate={false}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Operativo");
  });

  test("a status the project named Open reads Open", () => {
    renderInSpanish(
      <MonitorStatusElement
        monitorStatus={statusNamed("Open")}
        shouldAnimate={false}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Open");
    expect(screen.getByRole("status")).not.toHaveTextContent("Abrir");
  });
});

describe("a security case's priority and status", () => {
  test("a priority the project named Network reads Network", () => {
    renderInSpanish(
      <SecurityCasePriorityPill value={{ name: "Network", color: RED }} />,
    );

    expect(pillText()).toBe("Network");
  });

  test("a priority a project starts with is looked up: High reads Alta", () => {
    renderInSpanish(
      <SecurityCasePriorityPill value={{ name: "High", color: RED }} />,
    );

    expect(pillText()).toBe("Alta");
  });

  test("a status a project starts with is looked up: Investigating reads Investigando", () => {
    renderInSpanish(
      <SecurityCaseStatusPill value={{ name: "Investigating", color: RED }} />,
    );

    expect(pillText()).toBe("Investigando");
  });

  test("a status the project named High - a priority's name - is its own: High", () => {
    renderInSpanish(
      <SecurityCaseStatusPill value={{ name: "High", color: RED }} />,
    );

    expect(pillText()).toBe("High");
  });
});

describe("a row on a states page (Incident States)", () => {
  test.each([
    ["Open", "Open"],
    ["Resolved", "Resuelto"],
  ])("%j reads %j", (name: string, shown: string) => {
    renderInSpanish(
      <StateSettingsNameCell
        name={name}
        stateList={StateListType.IncidentState}
        color={GREEN}
      />,
    );

    expect(pillText()).toBe(shown);
  });
});

describe("an incident's header", () => {
  const STATES: Array<EventStateItem> = [
    { id: "identified", name: "Identified", color: RED, order: 1 },
    { id: "open", name: "Open", color: RED, order: 2 },
    { id: "resolved", name: "Resolved", color: GREEN, order: 3 },
  ];

  function renderHeader(data: {
    stateList: StateListType.IncidentState | StateListType.AlertState;
    currentStateId: string;
    severity: string;
  }): void {
    renderInSpanish(
      <EventStatusPanel
        stateList={data.stateList}
        states={STATES}
        identifier="INC-42"
        title="Checkout is down"
        currentStateId={data.currentStateId}
        severity={{ name: data.severity, color: RED }}
        actions={[]}
        onActionClick={(): void => {}}
        onStateSelect={(): void => {}}
      />,
    );
  }

  // The header's badges, the state's first, then the severity's.
  function chips(): Array<string> {
    return within(screen.getByTestId(EVENT_HEADER_TEST_IDS.chips))
      .getAllByTestId("pill-text")
      .map((element: HTMLElement): string => {
        return element.textContent || "";
      });
  }

  function track(): Array<string> {
    return Array.from(
      screen.getByTestId("event-state-track").querySelectorAll("li"),
    ).map((step: HTMLElement): string => {
      return step.textContent || "";
    });
  }

  function menuChoices(): Array<string> {
    fireEvent.click(
      screen.getByRole("button", { name: SPANISH["More actions"]! }),
    );

    return Array.from(
      screen
        .getByRole("menu")
        .querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).map((element: HTMLElement): string => {
      return (element.textContent || "").trim();
    });
  }

  test("in a state the project named Open: its badge, its track and its menu say Open", () => {
    renderHeader({
      stateList: StateListType.IncidentState,
      currentStateId: "open",
      severity: "Critical Incident",
    });

    expect(chips()).toEqual(["Open", "Incidente crítico"]);
    expect(track()).toEqual(["Identificado", "Open", "Resuelto"]);
    expect(menuChoices()).toContain("Resuelto");
  });

  test("before it, the menu offers Open as written", () => {
    renderHeader({
      stateList: StateListType.IncidentState,
      currentStateId: "identified",
      severity: "Critical Incident",
    });

    expect(chips()).toEqual(["Identificado", "Incidente crítico"]);

    const choices: Array<string> = menuChoices();

    expect(choices).toEqual(expect.arrayContaining(["Open", "Resuelto"]));
    expect(choices).not.toContain("Abrir");
  });

  test("resolved: the default Resolved reads Resuelto", () => {
    renderHeader({
      stateList: StateListType.IncidentState,
      currentStateId: "resolved",
      severity: "Critical Incident",
    });

    expect(chips()).toEqual(["Resuelto", "Incidente crítico"]);
  });

  test("an alert's severity High is OneUptime's word, an incident's severity High the project's", () => {
    renderHeader({
      stateList: StateListType.AlertState,
      currentStateId: "resolved",
      severity: "High",
    });

    expect(chips()).toEqual(["Resuelto", "Alta"]);

    cleanup();

    renderHeader({
      stateList: StateListType.IncidentState,
      currentStateId: "resolved",
      severity: "High",
    });

    expect(chips()).toEqual(["Resuelto", "High"]);
  });
});
