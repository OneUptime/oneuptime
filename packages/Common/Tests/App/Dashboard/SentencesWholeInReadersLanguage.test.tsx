/** @timezone UTC */
import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Color from "../../../Types/Color";
import OneUptimeDate from "../../../Types/Date";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import { WatchlistReaderKind } from "../../../Types/SecurityEvent/SecurityWatchlistFilter";
import { PluralTemplate, translatableTerm } from "../../../Types/Translator";
import EventItem, {
  EVENT_STATE_CHANGED_TO,
  TimelineItemType,
} from "../../../UI/Components/EventItem/EventItem";
import { LABEL_WITH_COLON } from "../../../UI/Utils/LabelWithColon";
import FacetFilterBar, {
  FILTERS_APPLIED,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FacetFilterBar";
import { WatchlistReadByLine } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Watchlists/WatchlistCells";
import {
  READ_BY_NAMES_AND_MORE_LINE,
  READ_BY_NAMES_LINE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Watchlists/WatchlistsCopy";
import {
  MATCHING_EVENTS,
  OBSERVABLES_NOT_SHOWN,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/CorrelateInspector";
import { MATCHING_EVENTS_FOUND } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/CorrelateGraph";
import {
  NO_LONGER_IN_INVENTORY,
  SHOWING_CONNECTIONS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/EntityDetailPanel";
import { TRACES_FOR_SERVICE } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/EdgeDetailPanel";
import { TOOLTIP_COUNT } from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionOccurrenceTrend";
import { OPENSTACK_CAPACITY_ALLOCATED_TITLES } from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackCapacityView";
import { OPENSTACK_CAPACITY_MAIN_CLASSES } from "../../../Types/OpenStack/OpenStackCapacitySnapshot";
import { ROW_KIND_AND_NAME } from "../../../UI/Components/ModelTable/BaseModelTable";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
  readDashboardLocaleAsDrawn,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A SENTENCE WITH A VALUE IN IT IS ONE KEY, IN EVERY LANGUAGE (#8290).
 *
 * The lines #8290 found built in JSX a word at a time - a translated phrase
 * drawn beside a value with a space between - each kept English's order,
 * its plural and its punctuation whatever the pieces said: "Page 2 of 5",
 * "3 callers", "Traces for checkout", a status page's "posted on" and its
 * date, a folded row's "Read by: A, B and 2 more", English's colon after a
 * French label. Each is one key now, its value where the reader's language
 * puts it. Here each is read in English, German, Arabic and Persian as a
 * person reads it, and each new key is worded in every language.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");

const RENDERED: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

const DASHBOARD: Record<string, i18n> = {};
const STATUS_PAGE: Record<string, i18n> = {};

function readStatusPageLocale(language: string): JSONObject {
  return JSON.parse(
    fs.readFileSync(
      path.join(
        REPOSITORY_ROOT,
        "packages/App/FeatureSet/StatusPage/src/Locales",
        `${language}.json`,
      ),
      "utf8",
    ),
  ) as JSONObject;
}

beforeAll(async () => {
  for (const code of RENDERED) {
    const dashboard: i18n = createInstance();

    await dashboard.init({
      lng: code,
      fallbackLng: "en",
      resources: {
        [code]: { translation: readDashboardLocaleAsDrawn(code) },
        en: { translation: readDashboardLocale("en") },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    DASHBOARD[code] = dashboard;

    // The status page reads its nested keys ("eventItem.postedOnDate") by path.
    const statusPage: i18n = createInstance();

    await statusPage.init({
      lng: code,
      fallbackLng: "en",
      resources: {
        [code]: { translation: readStatusPageLocale(code) },
        en: { translation: readStatusPageLocale("en") },
      },
      interpolation: { escapeValue: false },
    });

    STATUS_PAGE[code] = statusPage;
  }
});

// The facet row's Filter is a toggle on a phone's width only.
function setWindowWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("dir");
  setWindowWidth(1024);
});

function inLanguage(instance: i18n, code: string, element: ReactElement): void {
  if (code === "ar" || code === "fa") {
    document.documentElement.setAttribute("dir", "rtl");
  }

  render(<I18nextProvider i18n={instance}>{element}</I18nextProvider>);
}

function textOf(element: HTMLElement): string {
  return withoutIsolateMarks(element.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
}

function filled(template: string, values: Record<string, string>): string {
  let text: string = template;

  for (const name of Object.keys(values)) {
    text = text.split(`{{${name}}}`).join(values[name] as string);
  }

  return text.replace(/\s+/g, " ").trim();
}

const SLATE: Color = new Color("#64748b");

function resolvedState(): IncidentState {
  const state: IncidentState = new IncidentState();
  state.name = "Resolved";
  state.color = SLATE;

  return state;
}

const POSTED_AT: Date = new Date("2026-09-14T18:40:00Z");

describe.each(RENDERED)("a status page event in %s", (code: string) => {
  function renderEvent(): void {
    inLanguage(
      STATUS_PAGE[code] as i18n,
      code,
      <EventItem
        eventTitle="Checkout is failing for some customers"
        eventType="Incident"
        eventTypeColor={new Color("#ef4444")}
        isDetailItem={true}
        eventSecondDescription="Started 18:02 UTC"
        eventTimeline={[
          {
            date: POSTED_AT,
            type: TimelineItemType.Note,
            icon: IconProp.Info,
            iconColor: SLATE,
            note: "We are looking into it.",
          },
          {
            date: POSTED_AT,
            type: TimelineItemType.StateChange,
            icon: IconProp.CheckCircle,
            iconColor: SLATE,
            state: resolvedState(),
            // As the page hands it over: already in its reader's words.
            stateDisplayName: "Resolved",
          },
        ]}
      />,
    );
  }

  test("a note's posted on and its date are one sentence", () => {
    renderEvent();

    const locale: JSONObject = readStatusPageLocale(code);
    const template: string = (locale["eventItem"] as JSONObject)[
      "postedOnDate"
    ] as string;

    expect(textOf(screen.getByTestId("event-item-posted-on"))).toBe(
      filled(template, {
        date: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          POSTED_AT,
        ),
      }),
    );
  });

  test("a change of state names the event and its new state in one sentence", () => {
    renderEvent();

    const template: string = readStatusPageLocale(code)[
      EVENT_STATE_CHANGED_TO
    ] as string;

    expect(textOf(screen.getByTestId("event-item-state-change"))).toBe(
      filled(template, { eventType: "Incident", state: "Resolved" }),
    );
  });
});

describe("the status page's words for an event", () => {
  test("German, word for word", () => {
    const german: JSONObject = readStatusPageLocale("de");

    expect((german["eventItem"] as JSONObject)["postedOnDate"]).toBe(
      "veröffentlicht am {{date}}",
    );
    expect(german[EVENT_STATE_CHANGED_TO]).toBe(
      "{{eventType}}: Status geändert auf {{state}}",
    );
  });

  test("every language words both, and no longer keeps the pieces", () => {
    for (const language of ["en", ...DASHBOARD_LANGUAGES]) {
      const locale: JSONObject = readStatusPageLocale(language);
      const eventItem: JSONObject = locale["eventItem"] as JSONObject;

      expect({
        language,
        postedOnDate: String(eventItem["postedOnDate"]).includes("{{date}}"),
        stateChange:
          String(locale[EVENT_STATE_CHANGED_TO]).includes("{{eventType}}") &&
          String(locale[EVENT_STATE_CHANGED_TO]).includes("{{state}}"),
        pieces: "postedOn" in eventItem || "stateChangedTo" in eventItem,
        english:
          language !== "en" &&
          (eventItem["postedOnDate"] === "posted on {{date}}" ||
            locale[EVENT_STATE_CHANGED_TO] === EVENT_STATE_CHANGED_TO),
      }).toEqual({
        language,
        postedOnDate: true,
        stateChange: true,
        pieces: false,
        english: false,
      });
    }
  });
});

describe.each(RENDERED)("the Dashboard in %s", (code: string) => {
  test("a facet row's Filter names how many chips hold a filter in one sentence", () => {
    setWindowWidth(390);
    inLanguage(
      DASHBOARD[code] as i18n,
      code,
      <FacetFilterBar activeCount={3}>
        <span>chip</span>
      </FacetFilterBar>,
    );

    expect(
      screen.getByTestId("facet-filter-bar-toggle").getAttribute("aria-label"),
    ).toBe(dashboardTranslator(code).translatePlural(FILTERS_APPLIED, 3));
  });

  test("a folded watchlist row says what reads it in one sentence", () => {
    inLanguage(
      DASHBOARD[code] as i18n,
      code,
      <p data-testid="read-by">
        <WatchlistReadByLine
          isLoaded={true}
          hasError={false}
          readers={[
            { id: "1", name: "VIP sign-in" },
            { id: "2", name: "VIP MFA reset" },
            { id: "3", name: "Admin login", kind: WatchlistReaderKind.Hunt },
            { id: "4", name: "Ops", kind: WatchlistReaderKind.Monitor },
          ]}
        />
      </p>,
    );

    const line: string = textOf(screen.getByTestId("read-by"));
    const translator: ReturnType<typeof dashboardTranslator> =
      dashboardTranslator(code);
    const template: string = translator
      .translatePlural(READ_BY_NAMES_AND_MORE_LINE, 2, { names: "\u0000" })
      .split("\u0000")[0] as string;

    // It opens with the language's "Read by:" and names the readers as written.
    expect(line.startsWith(withoutIsolateMarks(template).trim())).toBe(true);
    expect(line).toContain("VIP sign-in");
    expect(line).toContain("VIP MFA reset");
    expect(line).toContain(translator.formatNumber(2));
  });
});

describe("German, word for word", () => {
  test("Read by, and Filter", () => {
    inLanguage(
      DASHBOARD["de"] as i18n,
      "de",
      <p data-testid="read-by">
        <WatchlistReadByLine
          isLoaded={true}
          hasError={false}
          readers={[{ id: "1", name: "VIP sign-in" }]}
        />
      </p>,
    );

    expect(textOf(screen.getByTestId("read-by"))).toBe(
      "Gelesen von: VIP sign-in",
    );

    cleanup();
    setWindowWidth(390);

    inLanguage(
      DASHBOARD["de"] as i18n,
      "de",
      <FacetFilterBar activeCount={2}>
        <span>chip</span>
      </FacetFilterBar>,
    );

    expect(
      screen.getByTestId("facet-filter-bar-toggle").getAttribute("aria-label"),
    ).toBe("Filter: 2 aktiv");
  });

  test("the counts and the names", () => {
    const german: ReturnType<typeof dashboardTranslator> =
      dashboardTranslator("de");

    expect(german.translatePlural(MATCHING_EVENTS, 1)).toBe(
      "1 passendes Ereignis",
    );
    expect(german.translatePlural(MATCHING_EVENTS_FOUND, 4)).toBe(
      "4 passende Ereignisse.",
    );
    expect(german.translatePlural(OBSERVABLES_NOT_SHOWN, 2)).toBe(
      "2 seltenere Observables nicht angezeigt",
    );
    expect(
      german.translateTemplate(TRACES_FOR_SERVICE, { name: "checkout" }),
    ).toBe("Traces für checkout");
    expect(
      german.translateTemplate(SHOWING_CONNECTIONS, {
        shown: "20",
        total: "57",
      }),
    ).toBe("20 von 57 angezeigt");
  });
});

describe("a value's place is the language's", () => {
  test("Japanese names the service before its traces", () => {
    expect(
      dashboardTranslator("ja").translateTemplate(TRACES_FOR_SERVICE, {
        name: "checkout",
      }),
    ).toBe("checkout のトレース");
  });

  test("Persian counts in its own digits", () => {
    const persian: ReturnType<typeof dashboardTranslator> =
      dashboardTranslator("fa");

    expect(persian.translatePlural(OBSERVABLES_NOT_SHOWN, 3)).toContain("۳");
    expect(persian.translatePlural(NO_LONGER_IN_INVENTORY, 12)).toContain("۱۲");
    expect(persian.translatePlural(FILTERS_APPLIED, 2)).toContain("۲");
  });

  test("a label's colon is the language's", () => {
    const status: { label: ReturnType<typeof translatableTerm> } = {
      label: translatableTerm("Status"),
    };

    expect(
      dashboardTranslator("de").translateTemplate(LABEL_WITH_COLON, status),
    ).toBe("Status:");
    // French sets its colon apart, with a no-break space (NoBreakSpaces).
    expect(
      dashboardTranslator("fr").translateTemplate(LABEL_WITH_COLON, status),
    ).toBe("Statut :");
    expect(
      dashboardTranslator("zh-CN").translateTemplate(LABEL_WITH_COLON, status),
    ).toBe("状态：");
    expect(
      withoutIsolateMarks(
        dashboardTranslator("fa").translateTemplate(LABEL_WITH_COLON, status),
      ),
    ).toBe("وضعیت:");
  });
});

const LETTER: RegExp = /\p{L}/u;
const PLACEHOLDER: RegExp = /\{\{[^{}]*\}\}/g;

// The keys #8290 made, each as English writes it, its plural forms beside it.
const NEW_KEYS: ReadonlyArray<string | PluralTemplate> = [
  FILTERS_APPLIED,
  READ_BY_NAMES_LINE,
  READ_BY_NAMES_AND_MORE_LINE,
  TRACES_FOR_SERVICE,
  OBSERVABLES_NOT_SHOWN,
  MATCHING_EVENTS_FOUND,
  EVENT_STATE_CHANGED_TO,
  ...OPENSTACK_CAPACITY_MAIN_CLASSES.map((name: string): string => {
    return OPENSTACK_CAPACITY_ALLOCATED_TITLES[name] as string;
  }),
];

// Keys it reuses, already worded: their meaning is the same where they are drawn.
const REUSED_KEYS: ReadonlyArray<string | PluralTemplate> = [
  MATCHING_EVENTS,
  NO_LONGER_IN_INVENTORY,
  SHOWING_CONNECTIONS,
  TOOLTIP_COUNT,
  ROW_KIND_AND_NAME,
];

describe("every language words the sentences", () => {
  test("each new key and each it reuses, both its forms, never left in English", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const locale: Record<string, string> = readDashboardLocale(language);

      for (const key of [...NEW_KEYS, ...REUSED_KEYS]) {
        const other: string = typeof key === "string" ? key : key.other;
        const forms: Array<string> =
          typeof key === "string" ? [other] : [other, `${other}_one`];

        for (const form of forms) {
          const words: string | undefined = locale[form];
          // A key of no words of its own may read as English does.
          const hasWords: boolean = LETTER.test(other.replace(PLACEHOLDER, ""));

          expect({
            language,
            form,
            worded:
              typeof words === "string" &&
              words.length > 0 &&
              (!hasWords || words !== other),
          }).toEqual({ language, form, worded: true });
        }
      }
    }
  });

  test("a label's colon is a key in every language, as English writes it", () => {
    expect(readDashboardLocale("en")[LABEL_WITH_COLON]).toBe("{{label}}:");

    for (const language of DASHBOARD_LANGUAGES) {
      expect({
        language,
        colon: readDashboardLocale(language)[LABEL_WITH_COLON],
      }).toEqual({
        language,
        colon:
          language === "fr"
            ? "{{label}} :"
            : language === "zh-CN" || language === "zh-TW"
              ? "{{label}}："
              : "{{label}}:",
      });
    }
  });
});
