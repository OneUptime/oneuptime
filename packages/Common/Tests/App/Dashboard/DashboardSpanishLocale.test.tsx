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
import spanishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/es.json";
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
 * The Dashboard in Spanish, read from the real locale files.
 *
 * Every string asserted below was English in es.json, chained word for
 * word ("Alerta Episodio Interno Nota"), or addressed the user as usted
 * ("Busque y analice registros."), until the Spanish translation pass
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
 * other suite in this worker sees Spanish.
 */

const spanish: i18n = createInstance();
const ORIGINAL_WIDTH: number = window.innerWidth;
const MONITOR_ID: ObjectID = new ObjectID(
  "0193c0de-7777-4aaa-8bbb-000000000009",
);

/*
 * English source key → the Spanish es.json ships for it. A test at the end
 * keeps these copies honest against the file.
 */
const PRODUCTS_MENU_SPANISH: Array<[string, string]> = [
  ["navbar.items.securityEventsTitle", "Eventos de seguridad"],
  [
    "navbar.items.securityEventsDescription",
    "Señales SIEM correlacionadas con tus datos de observabilidad.",
  ],
  ["navbar.items.networkTitle", "Red"],
  [
    "navbar.items.networkDescription",
    "Monitorea dispositivos de red mediante SNMP y agrúpalos en sitios.",
  ],
  ["navbar.items.llmObservabilityTitle", "IA / LLM"],
  ["navbar.items.logsDescription", "Busca y analiza registros."],
];

/*
 * "General" is the same word in Spanish, so it is not listed here: the
 * last test checks that every listed value differs from the English.
 */
const SHORTCUTS_SPANISH: Array<[string, string]> = [
  ["keyboardShortcuts.title", "Atajos de teclado"],
  ["keyboardShortcuts.description", "Trabaja más rápido sin dejar el teclado."],
  ["keyboardShortcuts.groups.goTo", "Ir a"],
  ["keyboardShortcuts.commandPalette", "Abrir la paleta de comandos"],
  ["keyboardShortcuts.searchList", "Buscar en la lista de esta página"],
  ["keyboardShortcuts.dismiss", "Cerrar un cuadro de diálogo o panel"],
];

const CARD_SPANISH: Array<[string, string]> = [
  ["Manual monitor", "Monitor manual"],
  [
    "Status is set by people, not by checks.",
    "El estado lo definen personas, no comprobaciones.",
  ],
];

/*
 * Model names go into tables, forms and sentences as one term. The older
 * Spanish translated each English word on its own and kept the English
 * order; these now read as Spanish noun phrases.
 */
const MODEL_NAMES_SPANISH: Array<[string, string]> = [
  ["Alert Episode Internal Note", "Nota interna del episodio de alerta"],
  [
    "Incident Episode State Timelines",
    "Cronologías de estados del episodio de incidente",
  ],
  [
    "Scheduled Maintenance Template Team Owner",
    "Equipo propietario de la plantilla de mantenimiento programado",
  ],
  [
    "On-Call Schedule Layer User",
    "Usuario de la capa de la programación de guardia",
  ],
  [
    "Status Page History Chart Bar Color",
    "Color de las barras del gráfico de historial de la página de estado",
  ],
  ["Log Drop Filter", "Filtro de descarte de registros"],
  ["Telemetry Ingestion Key", "Clave de ingesta de telemetría"],
  [
    "Workspace User Auth Token",
    "Token de autenticación de usuario del espacio de trabajo",
  ],
];

/*
 * The Dashboard speaks to the user as tú, like the rest of the Spanish.
 * The older file mixed in usted ("¿Está seguro de que desea…?").
 */
const INFORMAL_SPANISH: Array<[string, string]> = [
  [
    "Are you sure you want to delete this item?",
    "¿Seguro que quieres eliminar este elemento?",
  ],
  [
    "You have unsaved changes. Are you sure you want to cancel?",
    "Tienes cambios sin guardar. ¿Seguro que quieres cancelar?",
  ],
];

/*
 * What the older file said for some of those strings. None of them may
 * come back.
 */
const RETIRED_SPANISH: Array<string> = [
  "Alerta Episodio Interno Nota",
  "Incidente Episodio Estado Líneas de tiempo",
  "Programado Mantenimiento Plantilla Equipo Propietario",
  "Guardia Programación Capa Usuario",
  "Página de estado Historial Gráfico Barra Color",
  "Registro Descarte Filtro",
  "Telemetría Ingesta Key",
  "Espacio de trabajo Usuario Auth Token",
  "Busque y analice registros.",
  "¿Está seguro de que desea eliminar este elemento?",
];

// Formal-register openings that the tú register replaced everywhere.
const USTED_PHRASES: Array<string> = [
  "¿Está seguro",
  "¿Está segura",
  "Haga clic",
  "haga clic",
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

const withSpanish: (children: ReactElement) => ReactElement = (
  children: ReactElement,
): ReactElement => {
  return <I18nextProvider i18n={spanish}>{children}</I18nextProvider>;
};

beforeAll(async () => {
  Element.prototype.scrollIntoView = (): void => {};

  // The Dashboard's own configuration (Utils/i18n.ts): default separators.
  await spanish.init({
    lng: "es",
    fallbackLng: "en",
    resources: {
      en: { translation: englishLocale },
      es: { translation: spanishLocale },
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

describe("the products menu in Spanish", () => {
  test("names and describes the products in Spanish", () => {
    render(withSpanish(<DashboardNavbar show={true} />));

    fireEvent.click(screen.getByRole("button", { name: "Productos" }));

    const menu: HTMLElement = screen.getByRole("dialog");

    for (const [, value] of PRODUCTS_MENU_SPANISH) {
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
    expect(within(menu).queryByText("Search and analyze logs.")).toBeNull();
  });
});

describe("the keyboard shortcuts dialog in Spanish", () => {
  test("titles, groups and shortcuts read in Spanish", () => {
    render(withSpanish(<DashboardKeyboardShortcuts />));

    act(() => {
      GlobalEvents.dispatchEvent(EventName.KEYBOARD_SHORTCUTS_TOGGLE);
    });

    const dialog: HTMLElement = screen.getByRole("dialog");

    for (const [, value] of SHORTCUTS_SPANISH) {
      expect(within(dialog).getByText(value)).toBeInTheDocument();
    }

    expect(within(dialog).queryByText("Keyboard shortcuts")).toBeNull();
    expect(within(dialog).queryByText("Open the command palette")).toBeNull();
    expect(within(dialog).queryByText("Go to")).toBeNull();
  });
});

describe("a Dashboard card in Spanish", () => {
  test("the manual monitor card's title and description are Spanish", () => {
    goTo(`/dashboard/${PROJECT_ID}/monitors/${MONITOR_ID.toString()}`);

    render(withSpanish(<MonitorManualGuideCard monitorId={MONITOR_ID} />));

    for (const [, value] of CARD_SPANISH) {
      expect(screen.getByText(value)).toBeInTheDocument();
    }

    expect(screen.queryByText("Manual monitor")).toBeNull();
    expect(
      screen.queryByText("Status is set by people, not by checks."),
    ).toBeNull();
  });
});

describe("model names read as Spanish noun phrases", () => {
  test.each(MODEL_NAMES_SPANISH)("%s", (english: string, value: string) => {
    expect(spanish.t(english)).toBe(value);
  });

  test("no retired word-for-word chain or usted wording is left in es.json", () => {
    const values: Set<string> = new Set<string>(allValues(spanishLocale));

    expect(
      RETIRED_SPANISH.filter((retired: string): boolean => {
        return values.has(retired);
      }),
    ).toEqual([]);
  });
});

describe("the Dashboard addresses the user as tú", () => {
  test.each(INFORMAL_SPANISH)("%s", (english: string, value: string) => {
    expect(spanish.t(english)).toBe(value);
  });

  test("interpolated confirmations stay informal", () => {
    expect(
      spanish.t("Are you sure you want to delete this {{itemName}}?", {
        itemName: "monitor",
      }),
    ).toBe("¿Seguro que quieres eliminar este elemento (monitor)?");
  });

  test("no value in es.json asks ¿Está seguro…? or says Haga clic", () => {
    expect(
      allValues(spanishLocale).filter((value: string): boolean => {
        return USTED_PHRASES.some((phrase: string): boolean => {
          return value.includes(phrase);
        });
      }),
    ).toEqual([]);
  });
});

describe("the Spanish above is the Spanish es.json ships", () => {
  const all: Array<[string, string]> = [
    ...PRODUCTS_MENU_SPANISH,
    ...SHORTCUTS_SPANISH,
    ...CARD_SPANISH,
    ...MODEL_NAMES_SPANISH,
    ...INFORMAL_SPANISH,
  ];

  test.each(all)("%s", (key: string, value: string) => {
    const shipped: unknown = readKey(spanishLocale as LocaleFile, key);
    const english: unknown = readKey(englishLocale as LocaleFile, key);

    expect(typeof english).toBe("string");
    expect(shipped).toBe(value);
    expect(shipped).not.toBe(english);
  });
});
