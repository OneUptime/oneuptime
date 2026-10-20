import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React, { ReactElement, useState } from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import ExternalCalendarToggles from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ExternalCalendarToggles";
import {
  EXTERNAL_CALENDAR_LINK_PROBLEM_TEXT,
  EXTERNAL_CALENDAR_READ_ERROR_TEXT,
  EXTERNAL_CALENDAR_REFRESH_INTERVAL_LABELS,
  ExternalCalendarHealth,
  getExternalCalendarHealth,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ExternalCalendarStatus";
import { OverlayCalendar } from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/MaintenanceCalendarOverlays";
import ScheduledMaintenanceExternalCalendar from "../../../Models/DatabaseModels/ScheduledMaintenanceExternalCalendar";
import Route from "../../../Types/API/Route";
import {
  EXTERNAL_CALENDAR_READ_ERRORS,
  ExternalCalendarReadError,
} from "../../../Types/ScheduledMaintenance/ExternalCalendar";
import {
  getGlobalTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * The Maintenance Calendar's own page, its external calendars and Calendar
 * Settings (issue #5084) in every language the Dashboard ships, read from
 * the locale files themselves:
 *
 *   - every sentence the pages show is the language's own, and every
 *     sentence listed for a page is still on that page;
 *   - the toggles under the calendar read in the reader's language, the
 *     calendar's own name kept as its owner typed it;
 *   - why a read failed reads in the reader's language with the server's
 *     HTTP status in it.
 */

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const PLACEHOLDER: RegExp = /\{\{\w+\}\}/g;

const LANGUAGES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const LOCALES: Record<string, Record<string, string>> = {};

for (const language of LANGUAGES) {
  LOCALES[language] = readLocale(language);
}

/*
 * The sentences each page shows, by page. Written out so a language that
 * lost one is caught; the first test holds each to its page, so a reworded
 * page is caught too.
 */
const PAGE_SENTENCES: Record<string, Array<string>> = {
  "Pages/ScheduledMaintenanceEvents/SideMenu.tsx": [
    "Maintenance Calendar",
    "Calendar Settings",
  ],
  "Pages/ScheduledMaintenanceEvents/Calendar.tsx": [
    "Maintenance Calendar",
    "Every scheduled maintenance event by month, week or day, in your own time zone.",
  ],
  "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceCalendarSettings.tsx":
    [
      "External Calendars",
      "Show the events of other calendars - public holidays, change freezes, another project's maintenance - on the Maintenance Calendar. Read-only, and never part of this project's own calendar links.",
      "External Calendar",
      "The name the Maintenance Calendar shows for it.",
      "Public holidays",
      "Calendar Link",
      "The calendar's iCal (.ics) link, starting with https:// or webcal://. It can be a private link: it is stored encrypted and never shown again.",
      "The color its events are drawn in on the calendar.",
      "How often OneUptime reads the calendar for changes. Calendar servers often ask for no more than once an hour.",
      "Read it now instead of at its next read.",
      "Change link",
      "Replace its link. The events of the old one are forgotten.",
      "Read it again and show its events.",
      "Stop reading it and hide its events from everyone.",
      "Change the link of {{name}}",
      "Paste the calendar's new iCal (.ics) link. The events of the old link are forgotten, and the new one is read at once.",
      "New Calendar Link",
      "Starting with https:// or webcal://. It is stored encrypted and never shown again.",
      "{{count}} events kept, the nearest today",
      "Not yet",
    ],
  "Components/ScheduledMaintenance/ScheduledMaintenanceTable.tsx": [
    "Add External Calendar",
  ],
  "Components/ScheduledMaintenance/ScheduledMaintenanceCalendar.tsx": [
    "Showing the first {{count}} events of the external calendars in this period. Hide some of them, or look at a week.",
    "{{date}}, all day",
    "{{start}} to {{end}}, all day",
    "Busy",
  ],
  "Components/ScheduledMaintenance/ExternalCalendarToggles.tsx": [
    "External calendars",
    "Hide {{name}} on the calendar",
    "Show {{name}} on the calendar",
    "OneUptime could not read this calendar lately. It shows the events of its last good read.",
    "{{name}} could not be read lately",
    "Calendar settings",
  ],
};

// How a calendar is doing, as the Calendar Settings table words it.
function healthWords(): Array<string> {
  const words: Array<string> = [];

  const shapes: Array<Partial<ScheduledMaintenanceExternalCalendar>> = [
    { isEnabled: false },
    { isEnabled: true },
    { isEnabled: true, lastReadAt: new Date("2026-10-15T10:00:00.000Z") },
    {
      isEnabled: true,
      lastReadError: ExternalCalendarReadError.Timeout,
    },
  ];

  for (const shape of shapes) {
    const calendar: ScheduledMaintenanceExternalCalendar =
      new ScheduledMaintenanceExternalCalendar();
    Object.assign(calendar, shape);

    const health: ExternalCalendarHealth = getExternalCalendarHealth(calendar);
    words.push(health.label, health.tooltip);
  }

  return words;
}

function everySentence(): Array<string> {
  return Array.from(
    new Set<string>([
      ...Object.values(PAGE_SENTENCES).flat(),
      ...Object.values(EXTERNAL_CALENDAR_READ_ERROR_TEXT),
      ...Object.values(EXTERNAL_CALENDAR_LINK_PROBLEM_TEXT),
      ...Object.values(EXTERNAL_CALENDAR_REFRESH_INTERVAL_LABELS),
      ...healthWords(),
      // The plural the Last read column counts kept events with.
      "{{count}} events",
      "{{count}} events_one",
    ]),
  );
}

const CALENDARS: Array<OverlayCalendar> = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Bank Holidays",
    color: "#0ea5e9",
    readError: null,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Change Freeze",
    color: "#f97316",
    readError: ExternalCalendarReadError.Unreachable,
  },
];

function Toggles(): ReactElement {
  const [hiddenIds, setHiddenIds] = useState<Array<string>>([]);

  return (
    <MemoryRouter>
      <ExternalCalendarToggles
        calendars={CALENDARS}
        hiddenIds={hiddenIds}
        onToggle={(calendarId: string, isShown: boolean) => {
          setHiddenIds((current: Array<string>) => {
            return isShown
              ? current.filter((id: string) => {
                  return id !== calendarId;
                })
              : [...current, calendarId];
          });
        }}
        settingsRoute={new Route("/dashboard/p/settings/calendar")}
      />
    </MemoryRouter>
  );
}

function fill(template: string, values: Record<string, string>): string {
  let text: string = template;

  for (const [name, value] of Object.entries(values)) {
    text = text.split(`{{${name}}}`).join(value);
  }

  return text;
}

async function readIn(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {
    en: { translation: readLocale("en") },
  };

  for (const language of LANGUAGES) {
    resources[language] = { translation: LOCALES[language]! };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
  });
});

afterEach(async () => {
  cleanup();
  await readIn("en");
});

describe("every sentence the calendar pages show is the language's own", () => {
  test("each sentence is still on its page", () => {
    for (const [file, sentences] of Object.entries(PAGE_SENTENCES)) {
      const source: string = fs.readFileSync(
        path.join(DASHBOARD_SRC, file),
        "utf8",
      );

      for (const sentence of sentences) {
        expect({ file, sentence, onPage: source.includes(sentence) }).toEqual({
          file,
          sentence,
          onPage: true,
        });
      }
    }
  });

  test("every language words every sentence, its {{placeholders}} kept", () => {
    const sentences: Array<string> = everySentence();

    // The ten reasons a read fails, the four refused links, five intervals.
    expect(sentences.length).toBeGreaterThan(50);
    expect(Object.keys(EXTERNAL_CALENDAR_READ_ERROR_TEXT)).toHaveLength(
      EXTERNAL_CALENDAR_READ_ERRORS.length,
    );

    for (const language of LANGUAGES) {
      const locale: Record<string, string> = LOCALES[language]!;

      for (const sentence of sentences) {
        const value: string | undefined = locale[sentence];
        const english: string = sentence.endsWith("_one")
          ? "{{count}} event"
          : sentence;

        expect({ language, sentence, worded: Boolean(value) }).toEqual({
          language,
          sentence,
          worded: true,
        });
        expect({ language, sentence, own: value !== english }).toEqual({
          language,
          sentence,
          own: true,
        });

        for (const placeholder of english.match(PLACEHOLDER) || []) {
          expect({
            language,
            sentence,
            placeholder,
            kept: value!.includes(placeholder),
          }).toEqual({
            language,
            sentence,
            placeholder,
            kept: true,
          });
        }
      }
    }
  });
});

describe("the toggles under the calendar read in the reader's language", () => {
  test.each(["de", "ru", "ja", "fa"])("in %s", async (language: string) => {
    const locale: Record<string, string> = LOCALES[language]!;

    await readIn(language);
    render(<Toggles />);

    expect(
      screen.getByRole("group", {
        name: locale["External calendars"]!,
      }),
    ).toBeInTheDocument();

    // The calendar's own name, as its owner typed it, inside the sentence.
    const hide: string = fill(locale["Hide {{name}} on the calendar"]!, {
      name: "Bank Holidays",
    });
    const toggle: HTMLElement = screen.getByRole("button", { name: hide });
    expect(toggle).toHaveTextContent("Bank Holidays");

    fireEvent.click(toggle);

    expect(
      screen.getByRole("button", {
        name: fill(locale["Show {{name}} on the calendar"]!, {
          name: "Bank Holidays",
        }),
      }),
    ).toHaveAttribute("aria-pressed", "false");

    expect(
      screen.getByRole("img", {
        name: fill(locale["{{name}} could not be read lately"]!, {
          name: "Change Freeze",
        }),
      }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("link", { name: locale["Calendar settings"]! }),
    ).toBeInTheDocument();

    // No English left in what the toggles say.
    expect(screen.queryByText("External calendars")).not.toBeInTheDocument();
    expect(screen.queryByText("Calendar settings")).not.toBeInTheDocument();
  });
});

describe("why a read failed reads in the reader's language", () => {
  test("the server's HTTP status is in the sentence, in every language", async () => {
    for (const language of LANGUAGES) {
      await readIn(language);

      const translator: Translator = getGlobalTranslator();
      const sentence: string = translator.translateTemplate(
        EXTERNAL_CALENDAR_READ_ERROR_TEXT[
          ExternalCalendarReadError.ServerError
        ],
        { status: "502" },
      );

      expect({ language, sentence }).toEqual({
        language,
        sentence: fill(
          LOCALES[language]![
            EXTERNAL_CALENDAR_READ_ERROR_TEXT[
              ExternalCalendarReadError.ServerError
            ]
          ]!,
          { status: "502" },
        ),
      });
      expect(sentence).toContain("502");
      expect(sentence).not.toContain("answered with an error");
    }
  });

  test("a sentence no language has worded yet falls back to the English", async () => {
    await readIn("de");

    expect(
      getGlobalTranslator().translateText(
        "A sentence no locale file has, kept in English.",
      ),
    ).toBe("A sentence no locale file has, kept in English.");
  });
});
