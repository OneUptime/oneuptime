import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import { EVENT_HEADER_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventHeaderLayout";
import EventStatusPanel from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventStatusPanel";
import IncidentSeverityElement from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentSeverity/IncidentSeverityElement";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import { SERVER_LOCALES } from "../../../Server/Utils/ServerTranslation";
import Color from "../../../Types/Color";
import { StateListType } from "../../../Utils/StateOrder";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * THE SEVERITIES EVERY PROJECT STARTS WITH, IN THE READER'S LANGUAGE
 * (#7821).
 *
 * A new project's incident severities are "Critical Incident", "Major
 * Incident" and "Minor Incident" (ProjectService). Their badge - in a list
 * of severities (IncidentSeverityElement, which the workspace rules'
 * conditions draw too) and in an incident's header (EventStatusPanel) -
 * looks its name up in the reader's language (Pill), and found no key for
 * these three: a German page read "Critical Incident" beside an
 * "Identifiziert". Drawn here with the real Dashboard locales, the three
 * read in every language as the project's notifications say them.
 *
 * A severity is a record its project owns, and may rename. The lookup is
 * of the whole name, as written, so a severity the project named itself -
 * "Critical incident", "Critical Incident (P1)" - has no key and reads
 * exactly as its owner wrote it, in the list and in the header alike. (A
 * name that is one of the product's own words already, such as "Critical",
 * is still looked up by the badge; #7780 has the badge look up OneUptime's
 * default names alone.)
 */

const DEFAULT_INCIDENT_SEVERITY_NAMES: ReadonlyArray<string> = [
  "Critical Incident",
  "Major Incident",
  "Minor Incident",
];

const RED: Color = new Color("#dc2626");

const ENGLISH: Record<string, string> = readDashboardLocale("en");

const instances: Map<string, i18n> = new Map<string, i18n>();

// The Dashboard's words for `language`, English behind them, as it ships.
function i18nFor(language: string): i18n {
  const existing: i18n | undefined = instances.get(language);

  if (existing) {
    return existing;
  }

  const instance: i18n = createInstance();

  instance.init({
    lng: language,
    fallbackLng: "en",
    resources: {
      en: { translation: ENGLISH },
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

function severityNamed(name: string): IncidentSeverity {
  const severity: IncidentSeverity = new IncidentSeverity();

  severity.name = name;
  severity.color = RED;

  return severity;
}

// What a list of severities says for one named `name`.
function listBadgeText(language: string, name: string): string {
  render(
    <I18nextProvider i18n={i18nFor(language)}>
      <IncidentSeverityElement incidentSeverity={severityNamed(name)} />
    </I18nextProvider>,
  );

  const text: string = screen.getByTestId("pill-text").textContent || "";

  cleanup();

  return text;
}

/*
 * What an incident's header says for its severity: the only badge among
 * its chips, with no state picked and nothing private.
 */
function headerSeverityText(language: string, name: string): string {
  render(
    <I18nextProvider i18n={i18nFor(language)}>
      <EventStatusPanel
        stateList={StateListType.IncidentState}
        states={[]}
        identifier="INC-42"
        title="Checkout is down"
        severity={{ name: name, color: RED }}
        actions={[]}
        onActionClick={(): void => {}}
      />
    </I18nextProvider>,
  );

  const chips: HTMLElement = screen.getByTestId(EVENT_HEADER_TEST_IDS.chips);
  const text: string = within(chips).getByTestId("pill-text").textContent || "";

  cleanup();

  return text;
}

afterEach(() => {
  cleanup();
});

describe("on a German page", () => {
  const GERMAN: ReadonlyArray<[string, string]> = [
    ["Critical Incident", "Kritischer Vorfall"],
    ["Major Incident", "Schwerwiegender Vorfall"],
    ["Minor Incident", "Geringfügiger Vorfall"],
  ];

  test.each(GERMAN)(
    "a severity named %j reads %j in a list of severities",
    (name: string, german: string) => {
      expect(listBadgeText("de", name)).toBe(german);
    },
  );

  test.each(GERMAN)(
    "a severity named %j reads %j in an incident's header",
    (name: string, german: string) => {
      expect(headerSeverityText("de", name)).toBe(german);
    },
  );
});

describe("in every language", () => {
  test.each(["en", ...DASHBOARD_LANGUAGES])(
    "%s: the severities a new project starts with read as its notifications say them",
    (language: string) => {
      for (const name of DEFAULT_INCIDENT_SEVERITY_NAMES) {
        const word: string | undefined = SERVER_LOCALES[language]?.[name];

        expect({ language, name, isWorded: Boolean(word) }).toEqual({
          language,
          name,
          isWorded: true,
        });
        expect({
          language,
          name,
          list: listBadgeText(language, name),
          header: headerSeverityText(language, name),
        }).toEqual({ language, name, list: word, header: word });
      }
    },
  );
});

describe("a severity the project named itself", () => {
  const OWN_NAMES: ReadonlyArray<string> = [
    // The product's sentence case, the likeliest rename of all.
    "Critical incident",
    "major incident",
    "MINOR INCIDENT",
    "Critical Incident (P1)",
    "Major Incident - customer facing",
    "Sev 1",
  ];

  test.each(OWN_NAMES)(
    "%j reads as written on a German page, in a list and in the header",
    (name: string) => {
      expect(listBadgeText("de", name)).toBe(name);
      expect(headerSeverityText("de", name)).toBe(name);
    },
  );
});
