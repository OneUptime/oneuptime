// UX rule: Docs/ux/README.md#in-every-language
import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import AlertSeverityElement from "../../../../App/FeatureSet/Dashboard/src/Components/AlertSeverity/AlertSeverityElement";
import AlertStateElement from "../../../../App/FeatureSet/Dashboard/src/Components/AlertState/AlertStateElement";
import IncidentSeverityElement from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentSeverity/IncidentSeverityElement";
import IncidentStateElement from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentState/IncidentStateElement";
import MonitorStatusElement from "../../../../App/FeatureSet/Dashboard/src/Components/MonitorStatus/MonitorStatusElement";
import ScheduledMaintenanceStateElement from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenanceState/ScheduledMaintenanceStateElement";
import {
  SecurityCasePriorityPill,
  SecurityCaseStatusPill,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCasePills";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Label from "../../../Models/DatabaseModels/Label";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import Color from "../../../Types/Color";
import CheckboxElement from "../../../UI/Components/Checkbox/Checkbox";
import Dropdown, {
  DropdownOption,
} from "../../../UI/Components/Dropdown/Dropdown";
import LabelElement from "../../../UI/Components/Label/Label";
import Pill from "../../../UI/Components/Pill/Pill";
import Statusbubble from "../../../UI/Components/StatusBubble/StatusBubble";
import DropdownUtil from "../../../UI/Utils/Dropdown";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * A NAME READS AS WRITTEN IN EVERY LANGUAGE THE DASHBOARD SPEAKS (#7780,
 * #7782).
 *
 * The badges and pickers looked every text up, names too, so a name that
 * happened to be one of the product's English words read in the reader's
 * language: a label named "Network" was "Red" in Spanish, "Netzwerk" in
 * German, "Réseau" in French; a state a project named "Open" was the verb
 * "Abrir", "Öffnen", "Ouvrir". RecordNamesReadAsWrittenInSpanish and
 * RecordNamesInPickersInSpanish pin Spanish, case by case. This draws the
 * same badges, a picker and a checkbox with each of the Dashboard's
 * languages, from its real locale files: a name the project gave reads as
 * written in all of them, and OneUptime's default names - "Resolved",
 * "Operational", an alert's "High", "Critical Incident" - read in each
 * language's own word, as they did. The product's own words in a badge, a
 * bubble or a checkbox are still looked up.
 */

const GREEN: Color = new Color("#10b981");

// Words the cases below draw, and the languages' words for them.
const WORDS: ReadonlyArray<string> = [
  "Network",
  "Open",
  "Resolved",
  "Acknowledged",
  "Ongoing",
  "Critical Incident",
  "High",
  "Operational",
  "Investigating",
];

const instances: Map<string, i18n> = new Map<string, i18n>();

// The Dashboard's words in `language`, English behind them, as it ships.
function i18nIn(language: string): i18n {
  const cached: i18n | undefined = instances.get(language);

  if (cached) {
    return cached;
  }

  const instance: i18n = createInstance();

  instance.init({
    lng: language,
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      [language]: { translation: readDashboardLocale(language) },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
    initImmediate: false,
  });

  instances.set(language, instance);

  return instance;
}

function renderIn(language: string, element: ReactElement): void {
  render(<I18nextProvider i18n={i18nIn(language)}>{element}</I18nextProvider>);
}

// The words of the one pill on the page.
function pillText(): string {
  return screen.getByTestId("pill-text").textContent || "";
}

// The words of the one status bubble on the page.
function bubbleText(): string {
  return (screen.getByRole("status").textContent || "").trim();
}

function named<T extends BaseModel>(
  modelType: { new (): T },
  id: string,
  name: string,
): T {
  const row: T = new modelType();
  row._id = id;
  row.setColumnValue("name", name);
  row.setColumnValue("color", GREEN);
  return row;
}

function optionsOf(rows: Array<BaseModel>): Array<DropdownOption> {
  return DropdownUtil.getDropdownOptionsFromEntityArray({
    array: rows,
    labelField: "name",
    valueField: "_id",
  });
}

// What a picker built from `rows` lists, once opened.
async function pickerListing(
  language: string,
  rows: Array<BaseModel>,
): Promise<Array<string>> {
  renderIn(
    language,
    <Dropdown onChange={() => {}} options={optionsOf(rows)} />,
  );

  await act(async (): Promise<void> => {
    fireEvent.keyDown(screen.getByRole("combobox"), {
      key: "ArrowDown",
      code: "ArrowDown",
    });
  });

  return screen.getAllByRole("option").map((option: HTMLElement): string => {
    return (option.textContent || "").trim();
  });
}

afterEach(() => {
  cleanup();
});

describe("the words the cases below lean on", () => {
  test("the Dashboard speaks many languages, so every case runs in each", () => {
    expect(DASHBOARD_LANGUAGES.length).toBeGreaterThanOrEqual(15);
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s has a word for every name the cases draw",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      const missing: Array<string> = WORDS.filter((word: string): boolean => {
        return !words[word];
      });

      expect(missing).toEqual([]);
    },
  );

  test("in nearly every language Network and Open have words of their own, so a name looked up would show", () => {
    const ownWords: Array<string> = DASHBOARD_LANGUAGES.filter(
      (language: string): boolean => {
        const words: Record<string, string> = readDashboardLocale(language);

        return words["Network"] !== "Network" && words["Open"] !== "Open";
      },
    );

    expect(ownWords.length).toBeGreaterThanOrEqual(
      DASHBOARD_LANGUAGES.length - 2,
    );
  });
});

describe.each(DASHBOARD_LANGUAGES)("on a page in %s", (language: string) => {
  const words: Record<string, string> = readDashboardLocale(language);

  describe("a label", () => {
    test("named Network reads Network", () => {
      const label: Label = new Label();
      label.name = "Network";
      label.color = GREEN;

      renderIn(language, <LabelElement label={label} />);

      expect(pillText()).toBe("Network");
    });
  });

  describe("an incident's state", () => {
    test("a state the project named Open reads Open", () => {
      renderIn(
        language,
        <IncidentStateElement
          incidentState={named(IncidentState, "s-1", "Open")}
        />,
      );

      expect(pillText()).toBe("Open");
    });

    test("the default Resolved reads in the language's own word", () => {
      renderIn(
        language,
        <IncidentStateElement
          incidentState={named(IncidentState, "s-2", "Resolved")}
        />,
      );

      expect(pillText()).toBe(words["Resolved"]);
    });
  });

  describe("an alert's state", () => {
    test("the default Acknowledged reads in the language's own word, a state named Open as written", () => {
      renderIn(
        language,
        <AlertStateElement
          alertState={named(AlertState, "a-1", "Acknowledged")}
        />,
      );

      expect(pillText()).toBe(words["Acknowledged"]);

      cleanup();

      renderIn(
        language,
        <AlertStateElement alertState={named(AlertState, "a-2", "Open")} />,
      );

      expect(pillText()).toBe("Open");
    });
  });

  describe("a scheduled maintenance event's state", () => {
    test("the default Ongoing reads in the language's own word, a state named Network as written", () => {
      renderIn(
        language,
        <ScheduledMaintenanceStateElement
          scheduledMaintenanceState={named(
            ScheduledMaintenanceState,
            "m-1",
            "Ongoing",
          )}
        />,
      );

      expect(pillText()).toBe(words["Ongoing"]);

      cleanup();

      renderIn(
        language,
        <ScheduledMaintenanceStateElement
          scheduledMaintenanceState={named(
            ScheduledMaintenanceState,
            "m-2",
            "Network",
          )}
        />,
      );

      expect(pillText()).toBe("Network");
    });
  });

  describe("a severity", () => {
    test("an incident's default Critical Incident reads in the language's own word", () => {
      renderIn(
        language,
        <IncidentSeverityElement
          incidentSeverity={named(IncidentSeverity, "i-1", "Critical Incident")}
        />,
      );

      expect(pillText()).toBe(words["Critical Incident"]);
    });

    test("an incident's severity the project named High is its own: High", () => {
      renderIn(
        language,
        <IncidentSeverityElement
          incidentSeverity={named(IncidentSeverity, "i-2", "High")}
        />,
      );

      expect(pillText()).toBe("High");
    });

    test("an alert's default High reads in the language's own word, a severity named Network as written", () => {
      renderIn(
        language,
        <AlertSeverityElement
          alertSeverity={named(AlertSeverity, "s-1", "High")}
        />,
      );

      expect(pillText()).toBe(words["High"]);

      cleanup();

      renderIn(
        language,
        <AlertSeverityElement
          alertSeverity={named(AlertSeverity, "s-2", "Network")}
        />,
      );

      expect(pillText()).toBe("Network");
    });
  });

  describe("a monitor's status", () => {
    test("the default Operational reads in the language's own word", () => {
      renderIn(
        language,
        <MonitorStatusElement
          monitorStatus={named(MonitorStatus, "o-1", "Operational")}
          shouldAnimate={false}
        />,
      );

      expect(bubbleText()).toBe(words["Operational"]);
    });

    test("a status the project named Open reads Open", () => {
      renderIn(
        language,
        <MonitorStatusElement
          monitorStatus={named(MonitorStatus, "o-2", "Open")}
          shouldAnimate={false}
        />,
      );

      expect(bubbleText()).toBe("Open");
    });
  });

  describe("a security case's priority and status", () => {
    test("a priority a project starts with, High, reads in the language's own word; one named Network as written", () => {
      renderIn(
        language,
        <SecurityCasePriorityPill value={{ name: "High", color: GREEN }} />,
      );

      expect(pillText()).toBe(words["High"]);

      cleanup();

      renderIn(
        language,
        <SecurityCasePriorityPill value={{ name: "Network", color: GREEN }} />,
      );

      expect(pillText()).toBe("Network");
    });

    test("a status a project starts with, Investigating, reads in the language's own word; one named High as written", () => {
      renderIn(
        language,
        <SecurityCaseStatusPill
          value={{ name: "Investigating", color: GREEN }}
        />,
      );

      expect(pillText()).toBe(words["Investigating"]);

      cleanup();

      renderIn(
        language,
        <SecurityCaseStatusPill value={{ name: "High", color: GREEN }} />,
      );

      expect(pillText()).toBe("High");
    });
  });

  describe("a picker built from records", () => {
    test("lists labels named Network and Checkout as written", async () => {
      expect(
        await pickerListing(language, [
          named(Label, "l-1", "Network"),
          named(Label, "l-2", "Checkout"),
        ]),
      ).toEqual(["Network", "Checkout"]);
    });

    test("lists the default Operational in the language's own word, and a status named Open as written", async () => {
      expect(
        await pickerListing(language, [
          named(MonitorStatus, "o-1", "Operational"),
          named(MonitorStatus, "o-2", "Open"),
        ]),
      ).toEqual([words["Operational"], "Open"]);
    });
  });

  describe("a checkbox", () => {
    test("titled with a record's name reads it as written", () => {
      renderIn(
        language,
        <CheckboxElement title="Network" isTitleUserContent={true} />,
      );

      expect(screen.getByText("Network")).toBeInTheDocument();
    });

    test("titled with the product's word still reads it in the language", () => {
      renderIn(language, <CheckboxElement title="Network" />);

      expect(screen.getByText(words["Network"]!)).toBeInTheDocument();
    });
  });

  describe("the product's own words", () => {
    test("in a badge are still looked up", () => {
      renderIn(language, <Pill text="Open" color={GREEN} />);

      expect(pillText()).toBe(words["Open"]);
    });

    test("in a status bubble are still looked up, and a name in one is drawn as written", () => {
      renderIn(
        language,
        <Statusbubble text="Operational" color={GREEN} shouldAnimate={false} />,
      );

      expect(bubbleText()).toBe(words["Operational"]);

      cleanup();

      renderIn(
        language,
        <Statusbubble
          text="Network"
          isUserContent={true}
          color={GREEN}
          shouldAnimate={false}
        />,
      );

      expect(bubbleText()).toBe("Network");
    });
  });
});
