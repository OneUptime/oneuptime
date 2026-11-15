import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import ObjectID from "../../../Types/ObjectID";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * A DATABASE SERVER'S RUNTIME CHARTS, IN THE READER'S LANGUAGE (#8060).
 *
 * A database that runs on Kubernetes, Docker or Podman shows the CPU and
 * memory of its pods or containers in its Runtime section. The CPU chart's
 * title was the metric's title with " (cores)" glued on in the code: "CPU
 * per pod (cores)" is no key of the locales, so the title read English in
 * every language, beside a memory chart that read "Arbeitsspeicher pro
 * Pod" in German. And its axis ticks and hover values were written with
 * toPrecision and toFixed: "0.025" with a decimal point in German, Latin
 * digits in Persian.
 *
 * The title is one key now, worded in every Dashboard language, and the
 * figures are written in the reader's digits, decimal sign and percent
 * sign. This renders the real section, with its real chart cards, under a
 * real i18next instance built from the Dashboard's locale files; only the
 * line chart is stood in for, showing the series it is handed and what its
 * y formatter writes for a few figures.
 */

const SAMPLE_FIGURES: ReadonlyArray<number> = [0, 0.025, 1.25, 12, 1048576];

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (props: {
      data: Array<{ seriesName: string }>;
      yAxis: { options: { formatter: (value: number) => string } };
    }): ReactElement => {
      return (
        <div data-testid="runtime-line-chart">
          {props.data.map((series: { seriesName: string }) => {
            return (
              <span key={series.seriesName} data-part="series">
                {series.seriesName}
              </span>
            );
          })}
          {[0, 0.025, 1.25, 12, 1048576].map((figure: number) => {
            return (
              <span key={figure} data-part="tick" data-figure={figure}>
                {props.yAxis.options.formatter(figure)}
              </span>
            );
          })}
        </div>
      );
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseRunsOnLink",
  () => {
    return {
      __esModule: true,
      DatabaseRunsOnLink: (): ReactElement => {
        return <span>prod-eu</span>;
      },
      DatabaseWorkloadLink: (): ReactElement => {
        return <span>payments/StatefulSet/postgres</span>;
      },
    };
  },
);

import DatabaseRuntimeSection from "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseRuntimeSection";
import {
  DATABASE_RUNTIME_METRICS,
  DatabaseRuntimePlatform,
  formatDatabaseRuntimeAxisValue,
  getDatabaseRuntimeChartTitle,
  writeDatabaseFigureInLanguage,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerPresentation";
import { DatabaseTimePoint } from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerTelemetryQueries";

type LocaleTree = { [key: string]: string | LocaleTree };

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const PRESENTATION_SOURCE: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerPresentation.ts",
);

function readLocale(language: string): LocaleTree {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as LocaleTree;
}

async function instanceFor(
  language: string,
  locale: LocaleTree = readLocale(language),
): Promise<i18n> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: language,
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      [language]: { translation: locale },
    },
    interpolation: { escapeValue: false },
  });

  return instance;
}

const START: Date = new Date("2026-11-15T10:00:00.000Z");

function series(values: Array<number>): Array<DatabaseTimePoint> {
  return values.map((value: number, index: number): DatabaseTimePoint => {
    return { x: new Date(START.getTime() + index * 60000), y: value };
  });
}

interface DrawnChart {
  title: string;
  series: Array<string>;
  ticks: Record<string, string>;
}

async function drawSection(
  instance: i18n,
  platform: DatabaseRuntimePlatform,
): Promise<Array<DrawnChart>> {
  await act(async () => {
    render(
      <I18nextProvider i18n={instance}>
        <DatabaseRuntimeSection
          modelId={new ObjectID("d8060000-0000-4000-8000-000000000001")}
          platform={platform}
          source={{} as never}
          instanceCount={3}
          memberCount={3}
          cpuSeries={series([0.02, 0.025, 0.03])}
          memorySeries={series([1048576, 2097152])}
          isLoading={false}
          windowStart={START}
          windowEnd={new Date(START.getTime() + 3600000)}
        />
      </I18nextProvider>,
    );
  });

  return screen
    .getAllByTestId("chart-card-chart")
    .map((chart: HTMLElement): DrawnChart => {
      const card: HTMLElement = chart.parentElement as HTMLElement;
      const ticks: Record<string, string> = {};

      chart.querySelectorAll('[data-part="tick"]').forEach((tick: Element) => {
        ticks[tick.getAttribute("data-figure") || ""] = tick.textContent || "";
      });

      return {
        // The card's header: its title, then its (i).
        title: (card.firstElementChild?.textContent || "").trim(),
        series: Array.from(chart.querySelectorAll('[data-part="series"]')).map(
          (part: Element): string => {
            return part.textContent || "";
          },
        ),
        ticks,
      };
    });
}

const PERSIAN_DIGITS: RegExp = /[۰-۹]/;
const LATIN_DIGITS: RegExp = /[0-9]/;

afterEach(() => {
  cleanup();
});

describe("the runtime charts' titles", () => {
  test("in English, exactly as before: the CPU chart names its unit, the memory chart does not", () => {
    expect(
      getDatabaseRuntimeChartTitle(DATABASE_RUNTIME_METRICS.kubernetes.cpu),
    ).toBe("CPU per pod (cores)");
    expect(
      getDatabaseRuntimeChartTitle(DATABASE_RUNTIME_METRICS.kubernetes.memory),
    ).toBe("Memory per pod");
    expect(
      getDatabaseRuntimeChartTitle(DATABASE_RUNTIME_METRICS.docker.cpu),
    ).toBe("CPU per container");
    expect(
      getDatabaseRuntimeChartTitle(DATABASE_RUNTIME_METRICS.podman.memory),
    ).toBe("Memory per container");
  });

  test("regression: no title is joined to its unit in the code", () => {
    const source: string = fs.readFileSync(PRESENTATION_SOURCE, "utf8");

    expect(source).not.toMatch(/\$\{metric\.title\} \(cores\)/);
    expect(source).not.toMatch(/title\s*\+\s*" \(cores\)"/);
  });

  test("every title and series name the section draws is a key of en.json", () => {
    const english: LocaleTree = readLocale("en");

    for (const metrics of Object.values(DATABASE_RUNTIME_METRICS)) {
      for (const metric of [metrics.cpu, metrics.memory]) {
        expect(english[getDatabaseRuntimeChartTitle(metric)]).toBe(
          getDatabaseRuntimeChartTitle(metric),
        );
        expect(english[metric.title]).toBe(metric.title);
      }
    }
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "the CPU title is worded in %s",
    (language: string) => {
      const locale: LocaleTree = readLocale(language);
      const worded: unknown = locale["CPU per pod (cores)"];

      expect(typeof worded).toBe("string");
      expect(worded).not.toBe("CPU per pod (cores)");
    },
  );

  test("in English the cards read as they always did", async () => {
    const charts: Array<DrawnChart> = await drawSection(
      await instanceFor("en"),
      DatabaseRuntimePlatform.Kubernetes,
    );

    expect(
      charts.map((chart: DrawnChart): string => {
        return chart.title;
      }),
    ).toEqual(["CPU per pod (cores)", "Memory per pod"]);
    expect(charts[0]!.series).toEqual(["CPU per pod"]);
    expect(charts[1]!.series).toEqual(["Memory per pod"]);
  });

  test.each(["de", "fa", "ar", "ru", "ja"])(
    "in %s the CPU title and both series are the language's, the memory title as the locale words it",
    async (language: string) => {
      const locale: LocaleTree = readLocale(language);
      const charts: Array<DrawnChart> = await drawSection(
        await instanceFor(language),
        DatabaseRuntimePlatform.Kubernetes,
      );

      expect(charts[0]!.title).toBe(locale["CPU per pod (cores)"]);
      expect(charts[0]!.title).not.toContain("(cores)");
      expect(charts[1]!.title).toBe(locale["Memory per pod"]);
      expect(charts[0]!.series).toEqual([locale["CPU per pod"]]);
      expect(charts[1]!.series).toEqual([locale["Memory per pod"]]);
    },
  );

  test("German: 'CPU pro Pod (Kerne)' beside 'Arbeitsspeicher pro Pod'", async () => {
    const charts: Array<DrawnChart> = await drawSection(
      await instanceFor("de"),
      DatabaseRuntimePlatform.Kubernetes,
    );

    expect(charts[0]!.title).toBe("CPU pro Pod (Kerne)");
    expect(charts[1]!.title).toBe("Arbeitsspeicher pro Pod");
  });

  test("negative control: without its key - as the title joined in the code was - German reads English", async () => {
    const german: LocaleTree = readLocale("de");
    delete german["CPU per pod (cores)"];

    const charts: Array<DrawnChart> = await drawSection(
      await instanceFor("de", german),
      DatabaseRuntimePlatform.Kubernetes,
    );

    expect(charts[0]!.title).toBe("CPU per pod (cores)");
  });

  test("a container's CPU chart, in percent, has no unit to name", async () => {
    const charts: Array<DrawnChart> = await drawSection(
      await instanceFor("de"),
      DatabaseRuntimePlatform.Docker,
    );

    expect(charts[0]!.title).toBe("CPU pro Container");
    expect(charts[1]!.title).toBe("Arbeitsspeicher pro Container");
  });
});

describe("the runtime charts' figures, in the reader's digits", () => {
  test("English, exactly as before", () => {
    expect(formatDatabaseRuntimeAxisValue(0.025, "cores")).toBe("0.025");
    expect(formatDatabaseRuntimeAxisValue(1.25, "cores")).toBe("1.25");
    expect(formatDatabaseRuntimeAxisValue(12, "percent")).toBe("12%");
    expect(formatDatabaseRuntimeAxisValue(0.024, "percent")).toBe("0.024%");
    expect(formatDatabaseRuntimeAxisValue(1048576, "bytes")).toBe("1.0 MiB");
    expect(formatDatabaseRuntimeAxisValue(2500, "cores")).toBe("2.5k");
    // Named English, or none at all, is the same.
    expect(formatDatabaseRuntimeAxisValue(0.025, "cores", "en")).toBe("0.025");
    expect(formatDatabaseRuntimeAxisValue(0.025, "cores", "en-GB")).toBe(
      "0.025",
    );
    expect(formatDatabaseRuntimeAxisValue(null, "cores", "de")).toBe("");
    expect(formatDatabaseRuntimeAxisValue(NaN, "percent", "de")).toBe("");
  });

  test("German: a decimal comma, its own percent sign, the size's unit kept", () => {
    expect(formatDatabaseRuntimeAxisValue(0.025, "cores", "de")).toBe("0,025");
    expect(formatDatabaseRuntimeAxisValue(1.25, "cores", "de")).toBe("1,25");
    expect(formatDatabaseRuntimeAxisValue(12, "percent", "de")).toMatch(
      /^12\s%$/,
    );
    expect(formatDatabaseRuntimeAxisValue(1048576, "bytes", "de")).toBe(
      "1,0 MiB",
    );
    expect(formatDatabaseRuntimeAxisValue(2500, "cores", "de")).toBe("2,5k");
  });

  test("Persian: Persian digits and percent sign, no Latin digit", () => {
    for (const [value, unit] of [
      [0.025, "cores"],
      [1.25, "cores"],
      [12, "percent"],
      [1048576, "bytes"],
    ] as Array<[number, "cores" | "percent" | "bytes"]>) {
      const written: string = formatDatabaseRuntimeAxisValue(value, unit, "fa");

      expect(written).toMatch(PERSIAN_DIGITS);
      expect(written).not.toMatch(LATIN_DIGITS);
    }
    expect(formatDatabaseRuntimeAxisValue(12, "percent", "fa")).toContain("٪");
    expect(formatDatabaseRuntimeAxisValue(1048576, "bytes", "fa")).toMatch(
      / MiB$/,
    );
  });

  test("Arabic keeps Latin digits, as OneUptime writes Arabic", () => {
    expect(formatDatabaseRuntimeAxisValue(1.25, "cores", "ar")).toMatch(
      LATIN_DIGITS,
    );
  });

  test("what is not a figure is drawn as written", () => {
    expect(writeDatabaseFigureInLanguage("—", "de")).toBe("—");
    expect(writeDatabaseFigureInLanguage("1e-7", "de")).toBe("1e-7");
    expect(writeDatabaseFigureInLanguage("", "fa")).toBe("");
    expect(writeDatabaseFigureInLanguage("0.025", undefined)).toBe("0.025");
  });

  test("on the drawn card: the CPU ticks in German and Persian, English unchanged", async () => {
    const english: Array<DrawnChart> = await drawSection(
      await instanceFor("en"),
      DatabaseRuntimePlatform.Kubernetes,
    );
    expect(english[0]!.ticks["0.025"]).toBe("0.025");
    expect(english[0]!.ticks["1.25"]).toBe("1.25");
    expect(english[1]!.ticks["1048576"]).toBe("1.0 MiB");
    cleanup();

    const german: Array<DrawnChart> = await drawSection(
      await instanceFor("de"),
      DatabaseRuntimePlatform.Kubernetes,
    );
    expect(german[0]!.ticks["0.025"]).toBe("0,025");
    expect(german[0]!.ticks["1.25"]).toBe("1,25");
    expect(german[1]!.ticks["1048576"]).toBe("1,0 MiB");
    cleanup();

    const persian: Array<DrawnChart> = await drawSection(
      await instanceFor("fa"),
      DatabaseRuntimePlatform.Kubernetes,
    );
    for (const figure of SAMPLE_FIGURES) {
      expect(persian[0]!.ticks[String(figure)]).not.toMatch(LATIN_DIGITS);
    }
    cleanup();

    const docker: Array<DrawnChart> = await drawSection(
      await instanceFor("de"),
      DatabaseRuntimePlatform.Docker,
    );
    expect(docker[0]!.ticks["12"]).toMatch(/^12\s%$/);
  });
});
