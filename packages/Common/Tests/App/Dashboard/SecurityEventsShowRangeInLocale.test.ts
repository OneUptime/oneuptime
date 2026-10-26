import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import { getShowTimeRangeButtonTitle } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsNoResults";
import TimeRange from "../../../Types/Time/TimeRange";

/*
 * Security Events' empty table offers the time range that would bring the
 * newest event back: "Show past 1 week". It used to glue the English range
 * onto "Show", so German read "Show past 1 week" too. Now it is one
 * sentence, "Show {{range}}", with the range named as the time range picker
 * names it, in the reader's language.
 */

const LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(code: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${code}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const GERMAN: Record<string, unknown> = readLocale("de");
const RUSSIAN: Record<string, unknown> = readLocale("ru");

beforeAll(async () => {
  await i18next.init({
    lng: "de",
    fallbackLng: false,
    resources: {
      de: { translation: GERMAN },
      ru: { translation: RUSSIAN },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

describe("the Show button, in the reader's language", () => {
  test("is one German sentence, the range as the picker names it", async () => {
    await i18next.changeLanguage("de");

    expect(
      getShowTimeRangeButtonTitle({ range: TimeRange.PAST_ONE_WEEK }),
    ).toBe(
      (GERMAN["Show {{range}}"] as string).replace(
        "{{range}}",
        GERMAN["Past 1 Week"] as string,
      ),
    );
    expect(
      getShowTimeRangeButtonTitle({ range: TimeRange.PAST_ONE_HOUR }),
    ).toBe("Letzte Stunde anzeigen");
  });

  test("puts the range where Russian puts it, never after an English Show", async () => {
    await i18next.changeLanguage("ru");

    const title: string = getShowTimeRangeButtonTitle({
      range: TimeRange.PAST_ONE_DAY,
    });

    expect(title).not.toMatch(/^Show /);
    expect(title.toLocaleLowerCase("ru")).toContain(
      (RUSSIAN["Past 1 Day"] as string).toLocaleLowerCase("ru"),
    );
  });
});
