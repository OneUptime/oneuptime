import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import {
  CloudResourceReading,
  CloudResourceReadings,
  HEADLINE_DATA_SIZE,
  HEADLINE_DOCUMENTS,
  HEADLINE_HEALTH,
  HEADLINE_INDEX_SIZE,
} from "../../../Types/Cloud/CloudResourceHealth";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";
import {
  CloudHeadlineTile,
  NOT_REPORTED,
  PER_MINUTE,
  getCloudHeadlineSublabel,
  getCloudHeadlineTiles,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudHeadlineTiles";
import { getCloudTopologyFacts } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/Builders/CloudAccountTopology";
import ResourceOverview, {
  RESOURCE_OVERVIEW_DETAILS_DESCRIPTION,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ResourceOverview";
import IconProp from "../../../Types/Icon/IconProp";
import { formatCompactDurationAgo } from "../../../Utils/Milliseconds";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * #9740: WHAT A RESOURCE'S PAGE SAYS OF AZURE'S FIVE-MINUTE READINGS.
 *
 *   - A Cosmos DB account leads with what it stores: its data, its indexes
 *     and its documents (DataUsageV2, IndexUsageV2, DocumentCountV2).
 *   - An App Service app with a Health check says the share of its
 *     instances that pass it, with the bar its rule colours.
 *   - Each says how old it is ("12m ago"), in the reader's language: Azure
 *     keeps them at five minutes and a connection reads them every 15,
 *     keeping each between its reads, so a figure can be half an hour old.
 *     A reading every read brings says no age.
 */

const NOW: Date = new Date("2026-11-19T10:00:00.000Z");
const MINUTE_MS: number = 60 * 1000;
const COSMOS: string = "Microsoft.DocumentDB/databaseAccounts";
const APP: string = "Microsoft.Web/sites";
const GIB: number = 1024 * 1024 * 1024;

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);
const LANGUAGES: ReadonlyArray<string> = ["en", ...DASHBOARD_LANGUAGES];
const locales: Record<string, Record<string, string>> = {};
const instances: Record<string, i18n> = {};

// What a locale writes as English does on purpose (i18n/Progress/<code>.json).
function sameAsEnglish(language: string): Array<string> {
  return (
    (
      JSON.parse(
        fs.readFileSync(
          path.resolve(LOCALES_DIR, "../../i18n/Progress", `${language}.json`),
          "utf8",
        ),
      ) as { sameAsEnglish?: Array<string> }
    ).sameAsEnglish || []
  );
}

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

// A translator over one of the Dashboard's locale files, as the page reads it.
function translatorOf(language: string): Translator {
  return createTranslator((text: string): string | undefined => {
    return locales[language]![text];
  }, language);
}

function minutesAgo(minutes: number, value: number): CloudResourceReading {
  return {
    value,
    time: new Date(NOW.getTime() - minutes * MINUTE_MS).toISOString(),
  };
}

function tilesOf(
  type: string,
  readings: CloudResourceReadings,
  language: string = "en",
): Array<CloudHeadlineTile> {
  return getCloudHeadlineTiles({
    provider: "azure",
    type,
    readings,
    hasFreshReadings: true,
    translator: translatorOf(language),
    now: NOW,
  });
}

function rowsOf(
  tiles: Array<CloudHeadlineTile>,
): Array<[string, string, string | undefined]> {
  return tiles.map(
    (tile: CloudHeadlineTile): [string, string, string | undefined] => {
      return [tile.title, tile.value || tile.valueNote || "", tile.sublabel];
    },
  );
}

beforeAll(async () => {
  for (const language of LANGUAGES) {
    locales[language] = readLocale(language);
  }

  for (const language of LANGUAGES) {
    const instance: i18n = createInstance();

    // The Dashboard's own configuration (Utils/i18n.ts).
    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: locales["en"]! },
        [language]: { translation: locales[language]! },
      },
      interpolation: { escapeValue: false },
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

describe("a Cosmos DB account's storage tiles", () => {
  const STORAGE: CloudResourceReadings = {
    datausagev2: minutesAgo(12, 4.8 * GIB),
    indexusagev2: minutesAgo(12, 1.2 * GIB),
    documentcountv2: minutesAgo(12, 1_234_567),
    totalrequests: minutesAgo(4, 1240),
    normalizedruconsumption: minutesAgo(4, 37),
    serversidelatencydirect: minutesAgo(4, 4),
  };

  test("lead with its data, its indexes and its documents, each with its age", () => {
    expect(rowsOf(tilesOf(COSMOS, STORAGE))).toEqual([
      [HEADLINE_DATA_SIZE, "4.8 GiB", "12m ago"],
      [HEADLINE_INDEX_SIZE, "1.2 GiB", "12m ago"],
      [HEADLINE_DOCUMENTS, "1,234,567", "12m ago"],
      // A minute reading every read brings says no age.
      ["Requests", "1,240", PER_MINUTE],
      ["Request units", "37%", undefined],
      ["Latency", "4\u00A0ms", undefined],
    ]);
  });

  test("a reading kept since an earlier read says how old it really is", () => {
    const tiles: Array<CloudHeadlineTile> = tilesOf(COSMOS, {
      ...STORAGE,
      datausagev2: minutesAgo(34, 4.8 * GIB),
    });

    expect(tiles[0]!.sublabel).toBe("34m ago");
  });

  test("a fresh read without them says so, as any level not brought is", () => {
    const tiles: Array<CloudHeadlineTile> = tilesOf(COSMOS, {
      totalrequests: minutesAgo(4, 1240),
    });

    expect(rowsOf(tiles).slice(0, 3)).toEqual([
      [HEADLINE_DATA_SIZE, NOT_REPORTED, undefined],
      [HEADLINE_INDEX_SIZE, NOT_REPORTED, undefined],
      [HEADLINE_DOCUMENTS, NOT_REPORTED, undefined],
    ]);
  });

  test("an account's topology card carries what it stores first", () => {
    expect(
      getCloudTopologyFacts({
        provider: "azure",
        type: COSMOS,
        readings: STORAGE,
      }).map((fact: { label: string; value: string }) => {
        return [fact.label, fact.value];
      }),
    ).toEqual([
      [HEADLINE_DATA_SIZE, expect.stringContaining("GiB")],
      [HEADLINE_INDEX_SIZE, expect.stringContaining("GiB")],
    ]);
  });
});

describe("the line under a tile's value", () => {
  test("a reading every read brings keeps its own line, or none", () => {
    expect(
      getCloudHeadlineSublabel({
        sublabel: PER_MINUTE,
        ageMs: null,
        translator: translatorOf("en"),
      }),
    ).toBe(PER_MINUTE);
    expect(
      getCloudHeadlineSublabel({
        sublabel: undefined,
        ageMs: null,
        translator: translatorOf("en"),
      }),
    ).toBe(undefined);
  });

  test("a slow reading says its age, beside what its figure is per", () => {
    expect(
      getCloudHeadlineSublabel({
        sublabel: undefined,
        ageMs: 12 * MINUTE_MS + 59 * 1000,
        translator: translatorOf("en"),
      }),
    ).toBe("12m ago");
    expect(
      getCloudHeadlineSublabel({
        sublabel: PER_MINUTE,
        ageMs: 12 * MINUTE_MS,
        translator: translatorOf("en"),
      }),
    ).toBe("per minute · 12m ago");
    // Both in the reader's words: the line is drawn as it is handed over.
    const german: Translator = translatorOf("de");

    expect(
      getCloudHeadlineSublabel({
        sublabel: PER_MINUTE,
        ageMs: 12 * MINUTE_MS,
        translator: german,
      }),
    ).toBe(
      `${locales["de"]![PER_MINUTE]} · ${formatCompactDurationAgo(german, {
        minutes: 12,
      })}`,
    );
    // Under a minute, "just now"; past an hour, in hours.
    expect(
      getCloudHeadlineSublabel({
        sublabel: undefined,
        ageMs: 20 * 1000,
        translator: translatorOf("en"),
      }),
    ).toBe("just now");
    expect(
      getCloudHeadlineSublabel({
        sublabel: undefined,
        ageMs: 75 * MINUTE_MS,
        translator: translatorOf("en"),
      }),
    ).toBe("1h ago");
  });
});

describe("an App Service app's health check tile", () => {
  test("says the share of its instances that pass, with the bar its rule colours", () => {
    const tile: CloudHeadlineTile = tilesOf(APP, {
      requests: minutesAgo(4, 1240),
      healthcheckstatus: minutesAgo(14, 50),
    }).find((candidate: CloudHeadlineTile): boolean => {
      return candidate.title === HEADLINE_HEALTH;
    })!;

    expect(tile).toMatchObject({
      key: "healthcheckstatus",
      value: "50%",
      percent: 50,
      sublabel: "14m ago",
      // Red under half, amber under all: the rule's lines.
      higherIsBetter: true,
      thresholds: { warn: 100, danger: 50 },
    });
  });

  test("an app without a Health check has no such tile", () => {
    expect(
      tilesOf(APP, { requests: minutesAgo(4, 1240) }).map(
        (tile: CloudHeadlineTile): string => {
          return tile.title;
        },
      ),
    ).not.toContain(HEADLINE_HEALTH);
  });
});

describe("in every language", () => {
  test("the storage tiles' titles are the Dashboard's own words", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      for (const english of [
        HEADLINE_DATA_SIZE,
        HEADLINE_INDEX_SIZE,
        HEADLINE_DOCUMENTS,
      ]) {
        const drawn: unknown = locales[language]![english];

        expect([language, english, typeof drawn]).toEqual([
          language,
          english,
          "string",
        ]);

        // French writes "Documents" as English does, and says so.
        if (drawn === english) {
          expect([language, sameAsEnglish(language)]).toEqual([
            language,
            expect.arrayContaining([english]),
          ]);
          continue;
        }

        expect([language, drawn]).not.toEqual([language, english]);
      }
    }
  });

  test.each(LANGUAGES)(
    "%s: a tile's age is said in the reader's words and digits",
    (language: string) => {
      const tile: CloudHeadlineTile = tilesOf(
        COSMOS,
        { datausagev2: minutesAgo(12, 4.8 * GIB) },
        language,
      )[0]!;
      const translator: Translator = translatorOf(language);

      // The Dashboard's compact age, as every list says one.
      expect(tile.sublabel).toBe(
        formatCompactDurationAgo(translator, { minutes: 12 }),
      );

      // Worded by the locale wherever it has words for it.
      if (locales[language]!["{{count}}m ago"] !== "{{count}}m ago") {
        expect([language, tile.sublabel]).not.toEqual([language, "12m ago"]);
      }

      render(
        <I18nextProvider i18n={instances[language]!}>
          <MemoryRouter initialEntries={["/dashboard/cloud/resources/1"]}>
            <ResourceOverview
              icon={IconProp.Cloud}
              title="orders-db"
              identifier="Azure Cosmos DB Account"
              identifierLabel="type"
              status="connected"
              lastSeenAt={undefined}
              chips={[]}
              tiles={[
                {
                  title: tile.title,
                  value: tile.value,
                  sublabel: tile.sublabel,
                  icon: tile.icon,
                  iconColor: tile.iconColor,
                },
              ]}
              detailRows={[]}
              detailsDescription={RESOURCE_OVERVIEW_DETAILS_DESCRIPTION}
            />
          </MemoryRouter>
        </I18nextProvider>,
      );

      // As the page draws it, a no-break space held to its figure (#8669).
      expect(
        screen.getByText(tile.sublabel!.replace(/\s+/g, " ")),
      ).toBeInTheDocument();
    },
  );
});
