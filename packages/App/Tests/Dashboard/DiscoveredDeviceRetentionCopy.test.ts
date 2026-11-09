import { describe, expect, test } from "@jest/globals";
import { FoldedSectionItem } from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import { createTranslator, Translator } from "Common/Types/Translator";
import fs from "fs";
import path from "path";
import DiscoveredDeviceRetentionCopy, {
  DISCOVERED_DEVICE_RETENTION_DAYS,
  DISCOVERED_DEVICE_RETENTION_LINE,
  DISCOVERED_DEVICE_RETENTION_PLACE,
  getDiscoveredDeviceRetentionChoices,
  getDiscoveredDeviceRetentionDescription,
  getDiscoveredDeviceRetentionFoldedItem,
  getDiscoveredDeviceRetentionLine,
  getDiscoveredDeviceRetentionText,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveredDevices/DiscoveredDeviceRetentionCopy";

/*
 * Unseen Devices' words (issue #6389): the Discovered Devices list's line
 * on how long a device nothing sees stays, and the setting that changes it.
 * Read here as every Dashboard language reads them, from the shipped
 * locale files: each sentence is translated - the plural line in both its
 * forms, {{count}} kept - and the line comes out in the reader's words and
 * digits for every choice.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src/Locales",
);

type Locale = Record<string, string>;

const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json") && file !== "en.json";
  })
  .map((file: string): string => {
    return file.replace(/\.json$/, "");
  })
  .sort();

function readLocale(code: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as Locale;
}

const ENGLISH: Locale = readLocale("en");

function translatorFor(code: string): Translator {
  const locale: Locale = readLocale(code);

  return createTranslator((text: string): string | undefined => {
    return locale[text];
  }, code);
}

const english: Translator = createTranslator(undefined, "en");

// The sentences written for this, each a key of every locale.
const SENTENCES: Array<string> = [
  DiscoveredDeviceRetentionCopy.cardTitle,
  DiscoveredDeviceRetentionCopy.cardDescription,
  DiscoveredDeviceRetentionCopy.label,
  DiscoveredDeviceRetentionCopy.onDescription,
  DiscoveredDeviceRetentionCopy.offDescription,
  DiscoveredDeviceRetentionCopy.keptLine,
  DISCOVERED_DEVICE_RETENTION_LINE.other,
  `${DISCOVERED_DEVICE_RETENTION_LINE.other}_one`,
];

describe("the words, in English", () => {
  test("the pick offers every length, shortest first, then Never", () => {
    expect(getDiscoveredDeviceRetentionChoices()).toEqual([
      7, 14, 30, 60, 90, 180, 365, 0,
    ]);
    expect(
      getDiscoveredDeviceRetentionChoices().map((days: number): string => {
        return getDiscoveredDeviceRetentionText(days, english);
      }),
    ).toEqual([
      "7 days",
      "14 days",
      "30 days",
      "60 days",
      "90 days",
      "180 days",
      "365 days",
      "Never",
    ]);
  });

  test("the list's line says the days, or that every device stays", () => {
    expect(getDiscoveredDeviceRetentionLine(30, english)).toBe(
      "Devices not seen for 30 days are removed, unless they are monitored or classified.",
    );
    expect(getDiscoveredDeviceRetentionLine(365, english)).toBe(
      "Devices not seen for 365 days are removed, unless they are monitored or classified.",
    );
    expect(getDiscoveredDeviceRetentionLine(0, english)).toBe(
      "Devices stay on this list however long ago they were last seen.",
    );
  });

  test("one day reads as one, though no choice is a day", () => {
    expect(getDiscoveredDeviceRetentionLine(1, english)).toBe(
      "Devices not seen for 1 day are removed, unless they are monitored or classified.",
    );
    expect(getDiscoveredDeviceRetentionText(1, english)).toBe("1 day");
    expect(DISCOVERED_DEVICE_RETENTION_DAYS).toEqual({
      one: "{{count}} day",
      other: "{{count}} days",
    });
  });

  test("the sentence under the pick says what a length means, and what Never means", () => {
    for (const days of [7, 30, 365]) {
      expect(getDiscoveredDeviceRetentionDescription(days)).toBe(
        "Checked every hour. Nothing is removed while the switch or controller that saw a device reports nothing, and a device seen again comes back as new.",
      );
    }

    expect(getDiscoveredDeviceRetentionDescription(0)).toBe(
      "Every device stays until someone deletes it, however long ago it was last seen.",
    );
  });

  test("the card says what it removes, and what always stays", () => {
    expect(DiscoveredDeviceRetentionCopy.cardTitle).toBe("Unseen Devices");
    expect(DiscoveredDeviceRetentionCopy.cardDescription).toBe(
      "Remove discovered devices nothing has seen for a while. Monitored and classified devices, and ones someone added or changed, always stay.",
    );
    expect(DiscoveredDeviceRetentionCopy.label).toBe("Remove after");
  });

  test("its place on the page is its title's: unseen-devices", () => {
    expect(DISCOVERED_DEVICE_RETENTION_PLACE).toBe("unseen-devices");
  });
});

describe("the folded More settings header", () => {
  test("names it, with no value, while it is the default or not read yet", () => {
    for (const days of [30, undefined]) {
      const item: FoldedSectionItem = getDiscoveredDeviceRetentionFoldedItem(
        days,
        english,
      );

      expect(item.title).toBe("Unseen Devices");
      expect(item.key).toBe("unseen-devices");
      expect(item.isSet).toBe(false);
      expect(item.value).toBeUndefined();
    }
  });

  test("says what it is set to otherwise, in the reader's words", () => {
    expect(getDiscoveredDeviceRetentionFoldedItem(0, english)).toMatchObject({
      isSet: true,
      value: "Never",
    });
    expect(getDiscoveredDeviceRetentionFoldedItem(90, english)).toMatchObject({
      isSet: true,
      value: "90 days",
    });
    expect(
      getDiscoveredDeviceRetentionFoldedItem(7, translatorFor("de")),
    ).toMatchObject({ isSet: true, value: "7 Tage" });
  });
});

describe.each(LANGUAGES)("in %s", (code: string) => {
  const locale: Locale = readLocale(code);
  const translator: Translator = translatorFor(code);

  test("every sentence is translated", () => {
    for (const key of SENTENCES) {
      expect({ key, inEnglish: ENGLISH[key] }).toEqual({
        key,
        inEnglish: key.endsWith("_one")
          ? DISCOVERED_DEVICE_RETENTION_LINE.one
          : key,
      });
      expect({ key, translated: Boolean(locale[key]) }).toEqual({
        key,
        translated: true,
      });
      expect({ key, value: locale[key] }).not.toEqual({
        key,
        value: ENGLISH[key],
      });
    }
  });

  test("the line keeps its count in both forms", () => {
    expect(locale[DISCOVERED_DEVICE_RETENTION_LINE.other]).toContain(
      "{{count}}",
    );
    expect(locale[`${DISCOVERED_DEVICE_RETENTION_LINE.other}_one`]).toContain(
      "{{count}}",
    );
  });

  test("the line for every choice is in the reader's words and digits", () => {
    for (const days of [7, 14, 30, 60, 90, 180, 365]) {
      const line: string = getDiscoveredDeviceRetentionLine(days, translator);

      expect(line).not.toContain("{{count}}");
      expect(line).not.toBe(getDiscoveredDeviceRetentionLine(days, english));
      expect(line).toContain(translator.formatNumber(days));
    }

    expect(getDiscoveredDeviceRetentionLine(0, translator)).toBe(
      locale[DiscoveredDeviceRetentionCopy.keptLine],
    );
  });
});

describe("digits", () => {
  test("Persian writes the days in Persian digits", () => {
    const persian: Translator = translatorFor("fa");

    expect(getDiscoveredDeviceRetentionLine(30, persian)).toContain("۳۰");
    expect(getDiscoveredDeviceRetentionText(90, persian)).toContain("۹۰");
  });

  test("German writes them as written in English", () => {
    expect(getDiscoveredDeviceRetentionText(30, translatorFor("de"))).toBe(
      "30 Tage",
    );
    expect(getDiscoveredDeviceRetentionText(0, translatorFor("de"))).toBe(
      "Nie",
    );
  });
});
