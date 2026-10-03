import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import DashboardKeyboardShortcuts from "../../../../App/FeatureSet/Dashboard/src/Components/KeyboardShortcuts/DashboardKeyboardShortcuts";
import MonitorManualGuideCard from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorManualGuideCard";
import DashboardNavbar from "../../../../App/FeatureSet/Dashboard/src/Components/NavBar/NavBar";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import frenchLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fr.json";
import EventName from "../../../../App/FeatureSet/Dashboard/src/Utils/EventName";
import ObjectID from "../../../Types/ObjectID";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import {
  DESKTOP_WIDTH,
  PROJECT_ID,
  goTo,
  setViewportWidth,
} from "./SideMenuHarness";

/*
 * The Dashboard in French, read from the real locale files.
 *
 * Every string asserted below was English in fr.json, or chained word for
 * word ("Alerte Épisode Interne Note"), until the French translation pass
 * filled the file in. Three kinds of lookup are covered:
 *
 *  - nested keys read with t("a.b") (the products menu and the keyboard
 *    shortcuts dialog),
 *  - flat keys a Common component looks up for the Dashboard (the Card's
 *    title and description),
 *  - and the default-separator configuration the Dashboard's own i18next
 *    instance uses (Utils/i18n.ts), so a flat key that looked like a path
 *    would show up here as English.
 *
 * The instance reaches the components through I18nextProvider only, so no
 * other suite in this worker sees French.
 */

const french: i18n = createInstance();
const ORIGINAL_WIDTH: number = window.innerWidth;
const MONITOR_ID: ObjectID = new ObjectID(
  "0193c0de-7777-4aaa-8bbb-000000000008",
);

/*
 * English source key → the French fr.json ships for it. A test at the end
 * keeps these copies honest against the file.
 */
const PRODUCTS_MENU_FRENCH: Array<[string, string]> = [
  ["navbar.items.securityEventsTitle", "Événements de sécurité"],
  [
    "navbar.items.securityEventsDescription",
    "Signaux SIEM corrélés avec vos données d'observabilité.",
  ],
  ["navbar.items.networkTitle", "Réseau"],
  [
    "navbar.items.networkDescription",
    "Surveillez les équipements réseau via SNMP et regroupez-les par sites.",
  ],
  ["navbar.items.llmObservabilityTitle", "IA / LLM"],
];

const SHORTCUTS_FRENCH: Array<[string, string]> = [
  ["keyboardShortcuts.title", "Raccourcis clavier"],
  [
    "keyboardShortcuts.description",
    "Travaillez plus vite sans quitter le clavier.",
  ],
  ["keyboardShortcuts.groups.general", "Général"],
  ["keyboardShortcuts.groups.goTo", "Aller à"],
  ["keyboardShortcuts.commandPalette", "Ouvrir la palette de commandes"],
  ["keyboardShortcuts.searchList", "Rechercher dans la liste de cette page"],
  ["keyboardShortcuts.dismiss", "Fermer une boîte de dialogue ou un panneau"],
];

const CARD_FRENCH: Array<[string, string]> = [
  ["Manual monitor", "Moniteur manuel"],
  [
    "Status is set by people, not by checks.",
    "Le statut est défini par des personnes, et non par des vérifications.",
  ],
];

/*
 * Model names go into tables, forms and sentences as one term. The older
 * French translated each English word on its own and kept the English
 * order; these now read as French noun phrases.
 */
const MODEL_NAMES_FRENCH: Array<[string, string]> = [
  ["Alert Episode Internal Note", "Note interne de l'épisode d'alerte"],
  [
    "Incident Episode State Timelines",
    "Chronologies des états de l'épisode d'incident",
  ],
  [
    "Scheduled Maintenance Template Team Owner",
    "Équipe propriétaire du modèle de maintenance planifiée",
  ],
  [
    "On-Call Schedule Layer User",
    "Utilisateur de la couche du planning d'astreinte",
  ],
  [
    "Status Page History Chart Bar Color",
    "Couleur des barres du graphique d'historique de la page de statut",
  ],
  ["Log Drop Filter", "Filtre de suppression de journaux"],
  ["Telemetry Ingestion Key", "Clé d'ingestion de télémétrie"],
  [
    "Workspace User Auth Token",
    "Jeton d'authentification utilisateur de l'espace de travail",
  ],
];

/*
 * What the older file said for some of those names, plus terms the
 * glossary replaced. None of them may come back.
 */
const RETIRED_FRENCH: Array<string> = [
  "Alerte Épisode Interne Note",
  "Incident Épisode État Chronologies",
  "Planifié Maintenance Modèle Équipe Propriétaire",
  "Astreinte Planification Couche Utilisateur",
  "Page de statut Historique Graphique Barre Couleur",
  "Journal Suppression Filtre",
  "Télémétrie Ingestion Key",
  "Espace de travail Utilisateur Auth Jeton",
  "Filtres d'abandon",
];

type LocaleFile = Record<string, unknown>;

/*
 * A key as the locale files hold it: flat when the file has it flat, and
 * otherwise as a path through the nested objects.
 */
const readKey: (locale: LocaleFile, key: string) => unknown = (
  locale: LocaleFile,
  key: string,
): unknown => {
  if (key in locale) {
    return locale[key];
  }

  let node: unknown = locale;

  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) {
      return undefined;
    }
    node = (node as Record<string, unknown>)[part];
  }

  return node;
};

// Every string value in a locale file, nested ones included.
const allValues: (node: unknown) => Array<string> = (
  node: unknown,
): Array<string> => {
  if (typeof node === "string") {
    return [node];
  }

  if (typeof node !== "object" || node === null) {
    return [];
  }

  return Object.values(node as Record<string, unknown>).flatMap(allValues);
};

const withFrench: (children: ReactElement) => ReactElement = (
  children: ReactElement,
): ReactElement => {
  return <I18nextProvider i18n={french}>{children}</I18nextProvider>;
};

beforeAll(async () => {
  Element.prototype.scrollIntoView = (): void => {};

  // The Dashboard's own configuration (Utils/i18n.ts): default separators.
  await french.init({
    lng: "fr",
    fallbackLng: "en",
    resources: {
      en: { translation: englishLocale },
      fr: { translation: frenchLocale },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  window.localStorage.clear();
  setViewportWidth(DESKTOP_WIDTH);
  goTo(`/dashboard/${PROJECT_ID}/home`);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

afterAll(() => {
  setViewportWidth(ORIGINAL_WIDTH);
});

describe("the products menu in French", () => {
  test("names and describes the products in French", () => {
    render(withFrench(<DashboardNavbar show={true} />));

    fireEvent.click(screen.getByRole("button", { name: "Produits" }));

    const menu: HTMLElement = screen.getByRole("dialog");

    /*
     * The menu opens on Essentials and folds the other sections to one line
     * each. These products sit in two of them, named in French as well:
     * open those the way a user would.
     */
    for (const section of ["Observabilité", "Infrastructure"]) {
      const toggle: HTMLElement = within(menu).getByRole("button", {
        name: section,
      });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(toggle);
    }
    expect(
      within(menu).queryByRole("button", { name: "Observability" }),
    ).toBeNull();

    for (const [, value] of PRODUCTS_MENU_FRENCH) {
      expect(within(menu).getAllByText(value).length).toBeGreaterThan(0);
    }

    expect(within(menu).queryByText("Security Events")).toBeNull();
    expect(
      within(menu).queryByText(
        "SIEM signals correlated with your observability data.",
      ),
    ).toBeNull();
    expect(
      within(menu).queryByText(
        "Monitor network devices via SNMP and group them into sites.",
      ),
    ).toBeNull();
  });
});

describe("the keyboard shortcuts dialog in French", () => {
  test("titles, groups and shortcuts read in French", () => {
    render(withFrench(<DashboardKeyboardShortcuts />));

    act(() => {
      GlobalEvents.dispatchEvent(EventName.KEYBOARD_SHORTCUTS_TOGGLE);
    });

    const dialog: HTMLElement = screen.getByRole("dialog");

    for (const [, value] of SHORTCUTS_FRENCH) {
      expect(within(dialog).getByText(value)).toBeInTheDocument();
    }

    expect(within(dialog).queryByText("Keyboard shortcuts")).toBeNull();
    expect(within(dialog).queryByText("Open the command palette")).toBeNull();
  });
});

describe("a Dashboard card in French", () => {
  test("the manual monitor card's title and description are French", () => {
    goTo(`/dashboard/${PROJECT_ID}/monitors/${MONITOR_ID.toString()}`);

    render(withFrench(<MonitorManualGuideCard monitorId={MONITOR_ID} />));

    for (const [, value] of CARD_FRENCH) {
      expect(screen.getByText(value)).toBeInTheDocument();
    }

    expect(screen.queryByText("Manual monitor")).toBeNull();
    expect(
      screen.queryByText("Status is set by people, not by checks."),
    ).toBeNull();
  });
});

describe("model names read as French noun phrases", () => {
  test.each(MODEL_NAMES_FRENCH)("%s", (english: string, value: string) => {
    expect(french.t(english)).toBe(value);
  });

  test("no retired word-for-word chain or replaced term is left in fr.json", () => {
    const values: Set<string> = new Set<string>(allValues(frenchLocale));

    expect(
      RETIRED_FRENCH.filter((retired: string): boolean => {
        return values.has(retired);
      }),
    ).toEqual([]);
  });
});

describe("the French above is the French fr.json ships", () => {
  const all: Array<[string, string]> = [
    ...PRODUCTS_MENU_FRENCH,
    ...SHORTCUTS_FRENCH,
    ...CARD_FRENCH,
    ...MODEL_NAMES_FRENCH,
  ];

  test.each(all)("%s", (key: string, value: string) => {
    const shipped: unknown = readKey(frenchLocale as LocaleFile, key);
    const english: unknown = readKey(englishLocale as LocaleFile, key);

    expect(typeof english).toBe("string");
    expect(shipped).toBe(value);
    expect(shipped).not.toBe(english);
  });
});
