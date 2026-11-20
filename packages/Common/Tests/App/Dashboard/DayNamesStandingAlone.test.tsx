/** @timezone UTC */

import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React from "react";
import { initReactI18next } from "react-i18next";
import { DateRange, Formats } from "react-big-calendar";
import OneUptimeDate from "../../../Types/Date";
import {
  DAY_NAME_TITLECASE_CONTEXTS,
  DayNameContext,
  setDateDisplayLanguage,
  writeStandAloneDayName,
} from "../../../Types/DateLanguage";
import { createTranslator, Translator } from "../../../Types/Translator";
import { getCalendarFormats } from "../../../UI/Components/Calendar/Calendar";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import WorkingHoursPicker, {
  WORKING_HOURS_PICKER_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallRule/WorkingHoursPicker";
import { getDayOfWeekMenuOptions } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/RestrictionTimesFieldElement";
import { getShiftDayLabel } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/UpcomingShiftTime";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * A DAY'S NAME STANDING ALONE IS CASED AS ITS LANGUAGE WRITES IT (#7660).
 *
 * Inside a sentence most European languages write a day in lower case.
 * Standing alone - on a button, over a calendar's column, as a menu's item
 * - CLDR's contextTransforms say which take a capital: Spanish, Italian,
 * Dutch, Portuguese and Russian on a button and in a menu, French on a
 * button but not in a menu, and Danish, Norwegian and Swedish never. Every
 * day button, menu and header draws its name through
 * DateLanguage.writeStandAloneDayName, its aria-label and its title too.
 */

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

const readLocale: (language: string) => Record<string, string> = (
  language: string,
): Record<string, string> => {
  return JSON.parse(
    fs.readFileSync(
      path.join(DASHBOARD_SRC, "Locales", `${language}.json`),
      "utf8",
    ),
  ) as Record<string, string>;
};

// A locale's words, as a Translator looks them up.
const lookupIn: (
  locale: Record<string, string>,
) => (text: string) => string | undefined = (
  locale: Record<string, string>,
): ((text: string) => string | undefined) => {
  return (text: string): string | undefined => {
    const found: unknown = locale[text];

    return typeof found === "string" ? found : undefined;
  };
};

/*
 * CLDR 48's contextTransforms for a day's name, as cldr-json publishes
 * them (cldr-misc-full/main/<language>/contextTransforms.json, the keys
 * "day-format-except-narrow" and "day-standalone-except-narrow"). A
 * language not listed has no transform for a day: da, nb (no), sv, de,
 * en, ja, ko, zh, hi, ar and fa.
 */
const CLDR_48_DAY_TRANSFORMS: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  es: {
    "stand-alone": "titlecase-firstword",
    uiListOrMenu: "titlecase-firstword",
  },
  fr: { "stand-alone": "titlecase-firstword" },
  it: {
    "stand-alone": "titlecase-firstword",
    uiListOrMenu: "titlecase-firstword",
  },
  nl: {
    "stand-alone": "titlecase-firstword",
    uiListOrMenu: "titlecase-firstword",
  },
  pt: {
    "stand-alone": "titlecase-firstword",
    uiListOrMenu: "titlecase-firstword",
  },
  ru: {
    "stand-alone": "titlecase-firstword",
    uiListOrMenu: "titlecase-firstword",
  },
};

// CLDR's names for the two contexts.
const CLDR_CONTEXT: Record<DayNameContext, string> = {
  standAlone: "stand-alone",
  menu: "uiListOrMenu",
};

const MONDAY: Date = new Date("2026-11-16T12:00:00Z");

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  setDateDisplayLanguage("en");
});

describe("the table is CLDR's", () => {
  test("every language CLDR capitalises a day in, in each context it does, and no other", () => {
    const expected: Record<string, Array<DayNameContext>> = {};

    for (const language of Object.keys(CLDR_48_DAY_TRANSFORMS)) {
      expected[language] = (
        ["standAlone", "menu"] as Array<DayNameContext>
      ).filter((context: DayNameContext): boolean => {
        return (
          CLDR_48_DAY_TRANSFORMS[language]![CLDR_CONTEXT[context]] ===
          "titlecase-firstword"
        );
      });
    }

    expect(DAY_NAME_TITLECASE_CONTEXTS).toEqual(expected);
  });

  test("Danish, Norwegian and Swedish word a day in lower case, as CLDR writes it everywhere", () => {
    for (const language of ["da", "no", "sv"]) {
      const locale: Record<string, string> = readLocale(language);

      for (const key of [
        "Mon",
        "Tue",
        "Wed",
        "Thu",
        "Fri",
        "Sat",
        "Sun",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
      ]) {
        const word: string = locale[key] || "";

        expect({ language, key, word }).toEqual({
          language,
          key,
          word: word.toLocaleLowerCase(language),
        });
      }
    }
  });
});

describe("writeStandAloneDayName", () => {
  test.each<[string, string, string, string, string]>([
    // language, full name, short name, standing alone, in a menu
    ["en", "Monday", "Mon", "Monday", "Monday"],
    ["de", "Montag", "Mo", "Montag", "Montag"],
    ["es", "lunes", "lun", "Lunes", "Lunes"],
    ["fr", "lundi", "lun.", "Lundi", "lundi"],
    ["it", "lunedì", "lun", "Lunedì", "Lunedì"],
    ["nl", "maandag", "ma", "Maandag", "Maandag"],
    ["pt", "segunda-feira", "seg", "Segunda-feira", "Segunda-feira"],
    ["ru", "понедельник", "пн", "Понедельник", "Понедельник"],
    ["da", "mandag", "man", "mandag", "mandag"],
    ["no", "mandag", "man", "mandag", "mandag"],
    ["sv", "måndag", "mån", "måndag", "måndag"],
    ["ja", "月曜日", "月", "月曜日", "月曜日"],
    ["fa", "دوشنبه", "د", "دوشنبه", "دوشنبه"],
    ["ar", "الاثنين", "الاثنين", "الاثنين", "الاثنين"],
  ])(
    "%s: %s and %s",
    (
      language: string,
      full: string,
      short: string,
      standingAlone: string,
      inAMenu: string,
    ) => {
      expect(
        writeStandAloneDayName({ name: full, language, context: "standAlone" }),
      ).toBe(standingAlone);
      expect(
        writeStandAloneDayName({ name: full, language, context: "menu" }),
      ).toBe(inAMenu);

      // A short name takes the full name's capital, and only the first letter.
      const shortAlone: string = writeStandAloneDayName({
        name: short,
        language,
        context: "standAlone",
      });

      expect(shortAlone.slice(1)).toBe(short.slice(1));
      expect(shortAlone.charAt(0)).toBe(
        standingAlone.charAt(0) === full.charAt(0)
          ? short.charAt(0)
          : short.charAt(0).toLocaleUpperCase(language),
      );
    },
  );

  test("a region's tag reads as its language", () => {
    expect(
      writeStandAloneDayName({
        name: "lunes",
        language: "es-MX",
        context: "standAlone",
      }),
    ).toBe("Lunes");
    expect(
      writeStandAloneDayName({
        name: "mandag",
        language: "da-DK",
        context: "standAlone",
      }),
    ).toBe("mandag");
  });

  test("no language, or no name, is left as it is", () => {
    expect(
      writeStandAloneDayName({
        name: "lunes",
        language: undefined,
        context: "standAlone",
      }),
    ).toBe("lunes");
    expect(
      writeStandAloneDayName({ name: "", language: "es", context: "menu" }),
    ).toBe("");
  });
});

describe("every place a day's name stands alone", () => {
  test("a schedule's day menu lists each day as the language writes a menu's item", () => {
    const menu: (language: string) => Array<string> = (
      language: string,
    ): Array<string> => {
      const translator: Translator = createTranslator(
        lookupIn(readLocale(language)),
        language,
      );

      return getDayOfWeekMenuOptions(translator).map(
        (option: DropdownOption): string => {
          return option.label;
        },
      );
    };

    expect(menu("es")).toContain("Lunes");
    expect(menu("fr")).toContain("lundi");
    expect(menu("da")).toContain("mandag");
    expect(menu("en")).toContain("Monday");

    // Drawn as written: a looked-up label is never looked up again.
    const options: Array<DropdownOption> = getDayOfWeekMenuOptions(
      createTranslator(lookupIn(readLocale("es")), "es"),
    );

    expect(
      options.every((option: DropdownOption): boolean => {
        return option.isUserContent === true;
      }),
    ).toBe(true);
  });

  test("a calendar's column headers and its day's title", () => {
    const format: (language: string, name: keyof Formats) => string = (
      language: string,
      name: keyof Formats,
    ): string => {
      return (getCalendarFormats(language, false)[name] as (d: Date) => string)(
        new Date(2026, 10, 16, 12, 0),
      );
    };

    expect(format("es", "weekdayFormat")).toBe("Lun");
    expect(format("fr", "weekdayFormat")).toBe("Lun.");
    expect(format("da", "weekdayFormat")).toBe("man.");
    expect(format("ru", "weekdayFormat")).toBe("Пн");
    expect(format("de", "weekdayFormat")).toBe("Mo");
    expect(format("es", "dayHeaderFormat")).toBe("Lunes, 16 de noviembre");
    expect(format("da", "dayHeaderFormat")).toBe("mandag 16. november");

    // A range header starts with a month, and keeps its own case.
    expect(
      (
        getCalendarFormats("es", false).dayRangeHeaderFormat as (
          range: DateRange,
        ) => string
      )({ start: new Date(2026, 10, 16), end: new Date(2026, 10, 22) }),
    ).toBe("16 de noviembre – 22 de noviembre");
  });

  test("the schedule timeline's headers", () => {
    setDateDisplayLanguage("es");
    expect(
      OneUptimeDate.getDayOfWeekName(MONDAY, {
        width: "short",
        context: "standAlone",
        timezone: "UTC",
      }),
    ).toBe("Lun");
    expect(
      OneUptimeDate.getDayOfWeekName(MONDAY, {
        width: "long",
        context: "menu",
        timezone: "UTC",
      }),
    ).toBe("Lunes");

    setDateDisplayLanguage("sv");
    expect(
      OneUptimeDate.getDayOfWeekName(MONDAY, {
        width: "long",
        context: "standAlone",
        timezone: "UTC",
      }),
    ).toBe("måndag");

    // A narrow name keeps Intl's case: CLDR's capitals are for wider ones.
    setDateDisplayLanguage("pt");
    expect(
      OneUptimeDate.getDayOfWeekName(MONDAY, {
        width: "narrow",
        context: "standAlone",
        timezone: "UTC",
      }),
    ).toBe("S");
  });

  test("the upcoming shifts card's day beside its date tile", () => {
    const clock: (
      language: string,
    ) => Parameters<typeof getShiftDayLabel>[1] = (
      language: string,
    ): Parameters<typeof getShiftDayLabel>[1] => {
      return {
        timezone: "UTC",
        language: language,
        use12HourClock: false,
        now: new Date("2026-11-16T08:00:00Z"),
      };
    };
    const thursday: Date = new Date("2026-11-19T12:00:00Z");

    expect(getShiftDayLabel(thursday, clock("es"))).toBe("Jueves");
    expect(getShiftDayLabel(thursday, clock("da"))).toBe("torsdag");
    expect(getShiftDayLabel(thursday, clock("de"))).toBe("Donnerstag");
    expect(getShiftDayLabel(thursday, clock("en"))).toBe("Thursday");
  });

  test.each(
    DASHBOARD_LANGUAGES.map((language: string): [string] => {
      return [language];
    }),
  )("%s: a day's name standing alone is the helper's", (language: string) => {
    setDateDisplayLanguage(language);

    const name: string = OneUptimeDate.getDayOfWeekName(MONDAY, {
      width: "long",
      context: "standAlone",
      timezone: "UTC",
    });

    expect(
      writeStandAloneDayName({ name, language, context: "standAlone" }),
    ).toBe(name);
  });
});

describe("the working hours' day buttons", () => {
  beforeAll(async () => {
    await i18next.use(initReactI18next).init({
      lng: "en",
      fallbackLng: "en",
      resources: {
        en: { translation: readLocale("en") },
        es: { translation: readLocale("es") },
        da: { translation: readLocale("da") },
        fr: { translation: readLocale("fr") },
      },
      interpolation: { escapeValue: false },
    });
  });

  const buttonOf: (day: number) => HTMLElement = (day: number): HTMLElement => {
    return screen.getByTestId(`${WORKING_HOURS_PICKER_TEST_ID}-day-${day}`);
  };

  test.each<[string, string, string]>([
    ["es", "Lun", "Lunes"],
    ["fr", "Lun.", "Lundi"],
    ["da", "man", "mandag"],
    ["en", "Mon", "Monday"],
  ])(
    "%s: the button reads %s, and its label and title %s",
    async (language: string, short: string, full: string) => {
      jest
        .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
        .mockReturnValue(false);
      await act(async () => {
        await i18next.changeLanguage(language);
      });

      render(
        <WorkingHoursPicker
          value={undefined}
          timezone="Europe/London"
          onChange={(): void => {}}
        />,
      );

      expect(buttonOf(0)).toHaveTextContent(short);
      expect(buttonOf(0)).toHaveAccessibleName(full);
      expect(buttonOf(0)).toHaveAttribute("title", full);
      expect(buttonOf(0)).toHaveAttribute("aria-label", full);
    },
  );
});
