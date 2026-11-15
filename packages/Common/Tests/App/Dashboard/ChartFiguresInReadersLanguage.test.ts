// UX rule: Docs/ux/README.md#numbers-dates-and-plurals
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  formatCount as formatTraceCount,
  formatDurationMsInLanguage as formatTraceDuration,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/TraceChartData";
import { formatDurationMsInLanguage as formatTelemetryDuration } from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryFormat";
import { formatRuntimeValue } from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/serviceGoldenMetrics";
import { formatVital } from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/WebVitalsCard";
import {
  formatMessageQueueDurationMsInLanguage,
  formatMessageQueueErrorRate,
  formatMessageQueueMetricAxisValue,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueOverviewPresentation";
import {
  formatDatabaseBytes,
  formatDatabaseCount,
  formatDatabaseErrorRate,
  formatDatabaseFraction,
  formatDatabaseLatencyMs,
  formatDatabaseMetricAxisValue,
  formatDatabaseMetricUnitAxisValue,
  formatDatabaseMetricValue,
  formatDatabaseSeconds,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerPresentation";
import {
  formatLatencyInLanguage as formatMerakiLatency,
  formatLoss as formatMerakiLoss,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkTraffic/Meraki/MerakiTrafficRows";
import { formatOpenStackChartBytes } from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackFigures";
import { formatDurationMs as formatTopologyDuration } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyMeta";
import { formatChartCount } from "../../../UI/Components/Charts/Utils/ChartCount";
import KubernetesResourceUtils from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesResourceUtils";
import { formatBytes as formatProxmoxBytes } from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/Utils/ProxmoxResourceUtils";
import ValueFormatter from "../../../Utils/ValueFormatter";
import {
  getChartRowValues,
  getTickTextLength,
  getYAxisWidthForValuesInPx,
  Y_AXIS_MAX_WIDTH_IN_PX,
} from "../../../UI/Components/Charts/Utils/YAxisWidth";
import {
  setDateDisplayLanguage,
  writeFigureInLanguage,
} from "../../../Types/DateLanguage";
import { Translator } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A CHART'S VALUE AXIS AND ITS TOOLTIP, IN THE READER'S LANGUAGE (#8349).
 *
 * On a Persian page a chart's time axis was in Persian digits and the tile
 * above it said "۴۲ میلی‌ثانیه", while the chart's value axis and tooltip
 * said "42 ms": every chart the Dashboard draws with its own formatter
 * wrote its figures in English on purpose. The rule is one now
 * (Docs/ux/README.md#numbers-dates-and-plurals): a value axis and its
 * tooltip write a figure as the tiles beside them do. Each chart formatter
 * is drawn here in English, German, Arabic and Persian, over the locale
 * files the Dashboard ships:
 *
 *   - English reads exactly as it always did;
 *   - German writes its decimal comma ("5,0", "2,5k") and its own unit;
 *   - Arabic writes Latin digits and its own unit;
 *   - Persian writes no Latin digit, and no Latin "ms" after a figure.
 *
 * And the axis is as wide as its widest tick in every language, within the
 * cap that keeps the plot its room.
 */

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

const translators: Record<string, Translator> = Object.fromEntries(
  LANGUAGES.map((language: string): [string, Translator] => {
    return [language, dashboardTranslator(language)];
  }),
);

const LATIN_DIGIT: RegExp = /[0-9]/;
const LATIN_MS_AFTER_A_FIGURE: RegExp = /[0-9\u{06F0}-\u{06F9}]\s?ms\b/u;
const PERSIAN_DIGIT: RegExp = /[\u{06F0}-\u{06F9}]/u;

/*
 * A text with its isolating marks left out and its no-break spaces read as
 * spaces: a locale keeps a figure on its unit's line with a no-break space
 * (withNumbersKeptWithUnits), which the comparisons below need not spell.
 */
function spaced(text: string): string {
  return withoutIsolateMarks(text).replace(/[\u00a0\u202f]/g, " ");
}

function inLanguage(
  write: (translator: Translator) => string,
): Record<string, string> {
  return Object.fromEntries(
    LANGUAGES.map((language: string): [string, string] => {
      return [language, spaced(write(translators[language]!))];
    }),
  );
}

// A Persian figure: Persian digits, none Latin, no Latin "ms" after it.
function expectPersian(text: string): void {
  expect(text).toMatch(PERSIAN_DIGIT);
  expect(text).not.toMatch(LATIN_DIGIT);
  expect(text).not.toMatch(LATIN_MS_AFTER_A_FIGURE);
}

afterEach(() => {
  setDateDisplayLanguage("en");
});

describe("a duration on a chart's value axis and in its tooltip", () => {
  test("the trace chart widget and the traces explorer: each unit in the reader's words", () => {
    expect(
      inLanguage((t: Translator): string => {
        return formatTraceDuration(42.4, t);
      }),
    ).toEqual({
      en: "42 ms",
      de: "42 ms",
      ar: "42 ملي ث",
      fa: "۴۲ میلی‌ثانیه",
    });
    expect(
      inLanguage((t: Translator): string => {
        return formatTraceDuration(5, t);
      }),
    ).toEqual({
      en: "5.0 ms",
      de: "5,0 ms",
      ar: "5.0 ملي ث",
      fa: "۵٫۰ میلی‌ثانیه",
    });

    // Seconds and minutes, as the language shortens them.
    const seconds: Record<string, string> = inLanguage(
      (t: Translator): string => {
        return formatTraceDuration(1500, t);
      },
    );
    expect(seconds["en"]).toBe("1.50 s");
    expect(seconds["de"]).toBe("1,50 Sek.");
    expect(seconds["ar"]).toBe("1.50 ث");
    expectPersian(seconds["fa"]!);
    expect(seconds["fa"]).toContain("ثانیه");

    const minutes: Record<string, string> = inLanguage(
      (t: Translator): string => {
        return formatTraceDuration(90000, t);
      },
    );
    expect(minutes["en"]).toBe("1.5 min");
    expect(minutes["de"]).toBe("1,5 Min.");
    expectPersian(minutes["fa"]!);

    const microseconds: Record<string, string> = inLanguage(
      (t: Translator): string => {
        return formatTraceDuration(0.5, t);
      },
    );
    expect(microseconds["en"]).toBe("500 µs");
    expectPersian(microseconds["fa"]!);
    expect(formatTraceDuration(Infinity, translators["fa"]!)).toBe("-");
  });

  test("a service's, a function's, a site's and a cloud app's p95 chart", () => {
    expect(
      inLanguage((t: Translator): string => {
        return formatTelemetryDuration(250, t);
      }),
    ).toEqual({
      en: "250 ms",
      de: "250 ms",
      ar: "250 ملي ث",
      fa: "۲۵۰ میلی‌ثانیه",
    });
    expect(formatTelemetryDuration(2340, translators["en"]!)).toBe(
      "2.34\u00A0s",
    );
    expect(formatTelemetryDuration(2340, translators["de"]!)).toBe(
      "2,34\u00A0Sek.",
    );
    expectPersian(formatTelemetryDuration(2340, translators["fa"]!));
    expect(formatTelemetryDuration(0.25, translators["en"]!)).toBe(
      "250\u00A0µs",
    );
    expectPersian(formatTelemetryDuration(0.25, translators["fa"]!));
    expect(formatTelemetryDuration(null, translators["fa"]!)).toBe("—");
  });

  test("a service's runtime charts and a site's vitals", () => {
    expect(formatRuntimeValue(12.5, "percent", translators["en"]!)).toBe(
      "12.5%",
    );
    expect(formatRuntimeValue(12.5, "percent", translators["de"]!)).toBe(
      "12,5\u00a0%",
    );
    expectPersian(formatRuntimeValue(12.5, "percent", translators["fa"]!));
    expect(formatRuntimeValue(1536, "bytes", translators["en"]!)).toBe(
      "1.5 KiB",
    );
    expect(formatRuntimeValue(1536, "bytes", translators["de"]!)).toBe(
      "1,5 KiB",
    );
    expectPersian(formatRuntimeValue(2500, "count", translators["fa"]!));
    expectPersian(formatRuntimeValue(42, "milliseconds", translators["fa"]!));

    const lcp: { value: number; unit: string; thresholds: never } = {
      value: 2500,
      unit: "ms",
      thresholds: undefined as never,
    };
    expect(formatVital(lcp, translators["en"]!)).toBe("2.50\u00A0s");
    expectPersian(formatVital(lcp, translators["fa"]!));
    expect(
      formatVital(
        { value: 0.1, unit: "", thresholds: undefined as never },
        translators["de"]!,
      ),
    ).toBe("0,100");
  });

  test("a queue's p95 processing chart", () => {
    expect(
      inLanguage((t: Translator): string => {
        return formatMessageQueueDurationMsInLanguage(12.3, t);
      }),
    ).toEqual({
      en: "12 ms",
      de: "12 ms",
      ar: "12 ملي ث",
      fa: "۱۲ میلی‌ثانیه",
    });
    expect(
      formatMessageQueueDurationMsInLanguage(1250, translators["en"]!),
    ).toBe("1.25\u00A0s");
    expectPersian(
      formatMessageQueueDurationMsInLanguage(1250, translators["fa"]!),
    );
    expectPersian(
      formatMessageQueueDurationMsInLanguage(0.85, translators["fa"]!),
    );
  });

  test("a database's p95 query latency: the tile and the chart under it read alike", () => {
    expect(
      inLanguage((t: Translator): string => {
        return formatDatabaseLatencyMs(42, t);
      }),
    ).toEqual({
      en: "42 ms",
      de: "42 ms",
      ar: "42 ملي ث",
      fa: "۴۲ میلی‌ثانیه",
    });
    expect(formatDatabaseLatencyMs(5)).toBe("5.0\u00A0ms");
    expect(formatDatabaseLatencyMs(1250)).toBe("1.25\u00A0s");
    expect(formatDatabaseLatencyMs(null)).toBe("—");
    expectPersian(formatDatabaseLatencyMs(1250, translators["fa"]!));
  });

  test("the Meraki uplinks' latency and loss axis", () => {
    const noBreakSpace: string = String.fromCharCode(0xa0);

    expect(
      inLanguage((t: Translator): string => {
        return formatMerakiLatency(21.6, t).split(noBreakSpace).join(" ");
      }),
    ).toEqual({
      en: "22 ms",
      de: "22 ms",
      ar: "22 ملي ث",
      fa: "۲۲ میلی‌ثانیه",
    });
    expect(formatMerakiLoss(0.25)).toBe("0.3%");
    expect(formatMerakiLoss(12.4)).toBe("12%");
    expect(formatMerakiLoss(0.04)).toBe("<0.1%");
    expect(formatMerakiLoss(0.25, "de")).toBe("0,3\u00a0%");
    expectPersian(formatMerakiLoss(0.25, "fa"));
    expectPersian(formatMerakiLoss(0.04, "fa"));
    expect(formatMerakiLoss(0, "fa")).toBe("۰٪");
  });

  test("a service map edge's latency chart, from a second up too", () => {
    expect(formatTopologyDuration(1500)).toBe("1.50s");
    expect(formatTopologyDuration(1500, translators["en"]!)).toBe("1.50s");
    expect(formatTopologyDuration(1500, translators["de"]!)).toBe(
      "1,50\u00A0Sek.",
    );
    expectPersian(formatTopologyDuration(1500, translators["fa"]!));
    expectPersian(formatTopologyDuration(42, translators["fa"]!));
  });
});

describe("a database's and a queue's engine charts (#8283)", () => {
  test("a catalog metric's ticks: German decimal comma, Persian digits, English as before", () => {
    const ticks: Array<[number, string, string, string]> = [
      // value, unit, English, German
      [0.25, "connections", "0.25", "0,25"],
      [2500, "rollbacks", "2.5k", "2,5k"],
      [12, "%", "12%", "12\u00a0%"],
      [5 * 1024 ** 3, "bytes", "5\u00A0GiB", "5\u00A0GiB"],
      [1536, "bytes", "1.5\u00A0KiB", "1,5\u00A0KiB"],
      [0.85, "fraction", "85%", "85\u00a0%"],
      [90, "s", "1.5\u00A0min", "1,5\u00A0Min."],
    ];

    for (const [value, unit, english, german] of ticks) {
      expect(formatDatabaseMetricAxisValue(value, unit)).toBe(english);
      expect(
        formatDatabaseMetricAxisValue(value, unit, translators["en"]!),
      ).toBe(english);
      expect(
        withoutIsolateMarks(
          formatDatabaseMetricAxisValue(value, unit, translators["de"]!),
        ),
      ).toBe(german);
      expect(
        formatDatabaseMetricAxisValue(value, unit, translators["fa"]!),
      ).not.toMatch(LATIN_DIGIT);
      // Arabic writes Latin digits, the figure as English does.
      expect(
        formatDatabaseMetricAxisValue(value, unit, translators["ar"]!),
      ).toMatch(LATIN_DIGIT);
    }
  });

  test("a duration tick in the words the p95 tile uses", () => {
    expect(
      inLanguage((t: Translator): string => {
        return formatDatabaseMetricAxisValue(250, "ms", t);
      }),
    ).toEqual({
      en: "250 ms",
      de: "250 ms",
      ar: "250 ملي ث",
      fa: "۲۵۰ میلی‌ثانیه",
    });
    expect(
      inLanguage((t: Translator): string => {
        return formatDatabaseMetricAxisValue(0.012, "s", t);
      }),
    ).toEqual({
      en: "12 ms",
      de: "12 ms",
      ar: "12 ملي ث",
      fa: "۱۲ میلی‌ثانیه",
    });
    // A tick in thousands keeps its letter, as every count on the chart does.
    expect(formatDatabaseMetricAxisValue(2500, "ms")).toBe("2.5k\u00A0ms");
    expect(
      spaced(formatDatabaseMetricAxisValue(2500, "ms", translators["fa"]!)),
    ).toBe("۲٫۵k میلی‌ثانیه");
  });

  test("a metric outside the catalog: the shared formatter in the reader's language", () => {
    expect(
      formatDatabaseMetricUnitAxisValue(1.5e6, "By", {
        translator: translators["de"]!,
      }),
    ).toBe("1,5 MB");
    expect(
      formatDatabaseMetricUnitAxisValue(3, "{connection}", {
        translator: translators["fa"]!,
      }),
    ).toBe("۳");
    expect(
      formatDatabaseMetricUnitAxisValue(2.5, "1", {
        isRate: true,
        translator: translators["de"]!,
      }),
    ).toBe("2,5/s");
    expect(formatDatabaseMetricUnitAxisValue(2.5, "1", { isRate: true })).toBe(
      "2.5/s",
    );
  });

  test("a tile in the reader's digits, its unit word kept", () => {
    expect(formatDatabaseMetricValue(1, "databases", "gauge")).toBe(
      "1 database",
    );
    expect(
      formatDatabaseMetricValue(
        2500,
        "connections",
        "gauge",
        translators["fa"]!,
      ),
    ).toBe("۲٫۵k connections");
    expect(
      formatDatabaseMetricValue(12.5, "commits", "counter", translators["de"]!),
    ).toBe("12,5 commits/s");
    expect(
      formatDatabaseMetricValue(1024, "bytes", "counter", translators["de"]!),
    ).toBe("1,0\u00A0KiB/s");
    expect(
      spaced(formatDatabaseMetricValue(42, "ms", "gauge", translators["fa"]!)),
    ).toBe("۴۲ میلی‌ثانیه");
    expect(formatDatabaseMetricValue(42, "ms", "gauge")).toBe("42\u00A0ms");
  });

  test("the Overview's counts, sizes, durations and shares", () => {
    expect(formatDatabaseCount(2500)).toBe("2.5k");
    expect(formatDatabaseCount(2500, translators["de"]!)).toBe("2,5k");
    expect(formatDatabaseCount(2500, translators["fa"]!)).toBe("۲٫۵k");
    expect(formatDatabaseCount(null, translators["fa"]!)).toBe("—");
    expect(formatDatabaseBytes(1048576, translators["de"]!)).toBe(
      "1,0\u00A0MiB",
    );
    expect(formatDatabaseFraction(0.042, translators["de"]!)).toBe(
      "4,2\u00a0%",
    );
    expect(formatDatabaseErrorRate(2.5)).toBe("2.5%");
    expect(formatDatabaseErrorRate(2.5, translators["fa"]!)).toBe("۲٫۵٪");
    expect(formatDatabaseErrorRate(null, translators["fa"]!)).toBe("—");
    expect(formatDatabaseSeconds(5)).toBe("5.0\u00A0s");
    expect(formatDatabaseSeconds(5, translators["de"]!)).toBe("5,0\u00A0Sek.");
    expect(formatDatabaseSeconds(150, translators["de"]!)).toBe(
      "2,5\u00A0Min.",
    );
    expect(formatDatabaseSeconds(7200, translators["de"]!)).toBe("2\u00A0Std.");
    expectPersian(formatDatabaseSeconds(86400 * 3, translators["fa"]!));
    expect(formatDatabaseSeconds(7200)).toBe("2\u00A0h");
  });

  test("a broker metric's chart and a queue's error share", () => {
    expect(
      formatMessageQueueMetricAxisValue(
        2500,
        { unit: "messages" },
        translators["fa"]!,
      ),
    ).toBe("۲٫۵k");
    expect(formatMessageQueueMetricAxisValue(2500, { unit: "messages" })).toBe(
      "2.5k",
    );
    expect(formatMessageQueueErrorRate(4)).toBe("4.0%");
    expect(formatMessageQueueErrorRate(4, translators["de"]!)).toBe(
      "4,0\u00a0%",
    );
    expect(formatMessageQueueErrorRate(4, translators["fa"]!)).toBe("۴٫۰٪");
  });
});

describe("a count and a size on a chart", () => {
  test("the logs and traces histograms and the logs analytics chart", () => {
    expect(formatChartCount(42)).toBe("42");
    expect(formatChartCount(1500)).toBe("1.5K");
    expect(formatChartCount(12000)).toBe("12K");
    expect(formatChartCount(1200000)).toBe("1.2M");
    expect(formatChartCount(1500, "de")).toBe("1,5K");
    expect(formatChartCount(1500, "fa")).toBe("۱٫۵K");
    expect(formatChartCount(42, "fa")).toBe("۴۲");
    expect(formatChartCount(1500, "ar")).toBe("1.5K");
  });

  test("a trace chart's count, in the page's digits", () => {
    expect(formatTraceCount(1500)).toBe("1.5K");
    setDateDisplayLanguage("fa");
    expect(formatTraceCount(1500)).toBe("۱٫۵K");
    expect(formatTraceCount(2_000_000)).toBe("۲٫۰M");
    expect(formatTraceCount(42)).toBe("۴۲");
    setDateDisplayLanguage("de");
    expect(formatTraceCount(1500)).toBe("1,5K");
  });

  test("OpenStack's chart sizes, in the page's digits", () => {
    expect(formatOpenStackChartBytes(6 * 1024 ** 4)).toBe("6.0 TiB");
    expect(formatOpenStackChartBytes(6 * 1024 ** 4, { language: "de" })).toBe(
      "6,0 TiB",
    );
    setDateDisplayLanguage("fa");
    expect(formatOpenStackChartBytes(6 * 1024 ** 4)).toBe("۶٫۰ TiB");
  });
});

describe("the value axis is as wide as its widest tick, in every language", () => {
  test("a Persian duration axis grows to its words and fits under the cap", () => {
    const values: Array<number> = [0, 120, 480, 950];

    for (const language of LANGUAGES) {
      const formatter: (value: number) => string = (value: number): string => {
        return formatTraceDuration(value, translators[language]!);
      };
      const width: number = getYAxisWidthForValuesInPx({
        values: values,
        formatter: formatter,
        minWidthInPx: 56,
      });
      const widest: number = Math.max(
        ...[0, 250, 500, 750, 950, 1000].map((value: number): number => {
          return getTickTextLength(formatter(value));
        }),
      );

      expect(width).toBeGreaterThanOrEqual(56);
      expect(width).toBeLessThanOrEqual(Y_AXIS_MAX_WIDTH_IN_PX);
      // Every tick the axis can draw fits the width it was given.
      expect(width).toBeGreaterThanOrEqual(Math.ceil(widest * 6.2 + 12));
    }

    // English keeps the trace chart's 56 px; Persian grows to its words.
    expect(
      getYAxisWidthForValuesInPx({
        values: values,
        formatter: (value: number): string => {
          return formatTraceDuration(value, translators["en"]!);
        },
        minWidthInPx: 56,
      }),
    ).toBe(56);
    expect(
      getYAxisWidthForValuesInPx({
        values: values,
        formatter: (value: number): string => {
          return formatTraceDuration(value, translators["fa"]!);
        },
        minWidthInPx: 56,
      }),
    ).toBeGreaterThan(56);
  });

  test("a mid-axis tick in another unit is measured too: 500 ms under a 1.5 s top", () => {
    const formatter: (value: number) => string = (value: number): string => {
      return formatTraceDuration(value, translators["fa"]!);
    };
    const width: number = getYAxisWidthForValuesInPx({
      values: [0, 1500],
      formatter: formatter,
      minWidthInPx: 56,
    });

    expect(width).toBeGreaterThanOrEqual(
      Math.ceil(getTickTextLength(formatter(750)) * 6.2 + 12),
    );
  });

  test("a count axis in German and Persian stays at its width: the letter keeps it short", () => {
    for (const language of ["en", "de", "fa", "ar"]) {
      expect(
        getYAxisWidthForValuesInPx({
          values: getChartRowValues(
            [
              { time: "a", info: 1200, error: 300 },
              { time: "b", info: 4500, error: 900 },
            ],
            ["info", "error"],
            { isStacked: true },
          ),
          formatter: (value: number): string => {
            return formatChartCount(value, language);
          },
          minWidthInPx: 48,
        }),
      ).toBe(48);
    }
  });
});

/*
 * THE RESOURCE PAGES' OWN CHARTS (#8428).
 *
 * A metric query's yAxisValueFormatter is a page's shared formatter, which
 * writes English ("1.5 GB", "512 MiB"): the metric chart writes what it
 * returns in the reader's digits, its unit kept. The pages' own rate and
 * availability charts hand ValueFormatter the page's language, and their
 * availability axis words "Up" and "Down" in it.
 */
describe("the resource pages' charts", () => {
  test("a page's own byte figure, as the metric chart draws it", () => {
    const kubernetes: string = KubernetesResourceUtils.formatBytesForChart(
      1.5 * 1024 * 1024 * 1024,
    );
    const proxmox: string = formatProxmoxBytes(512 * 1024 * 1024);

    for (const english of [kubernetes, proxmox]) {
      expect(writeFigureInLanguage(english, "en")).toBe(english);
      expect(writeFigureInLanguage(english, "fa")).not.toMatch(LATIN_DIGIT);
      expect(writeFigureInLanguage(english, "ar")).toBe(english);
    }

    expect(writeFigureInLanguage(kubernetes, "de")).toBe(
      kubernetes.replace(".", ","),
    );
  });

  test("a network chart's rate in the page's digits", () => {
    expect(
      ValueFormatter.formatValue(1500000, "By/s", { language: "en" }),
    ).toBe("1.5 MB/s");
    expect(
      ValueFormatter.formatValue(1500000, "By/s", { language: "de" }),
    ).toBe("1,5 MB/s");
    expect(
      ValueFormatter.formatValue(1500000, "By/s", { language: "fa" }),
    ).not.toMatch(LATIN_DIGIT);
  });

  test("Up and Down are worded in every language the Dashboard ships", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const locale: Record<string, string> = readDashboardLocale(language);

      expect({
        language,
        up: typeof locale["Up"],
        down: typeof locale["Down"],
      }).toEqual({ language, up: "string", down: "string" });
    }

    expect(translators["fa"]!.translateText("Up")).not.toBe("Up");
    expect(translators["de"]!.translateText("Down")).not.toBe("Down");
  });
});
