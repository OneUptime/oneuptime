import { describe, expect, test } from "@jest/globals";
import { formatCloudSeconds } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudHeadlineTiles";
import { formatReviewDuration } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeProductionReviewCopy";
import { formatTraceListDuration } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTraceListComponent";
import { formatLatencyUsec as formatWidgetLatencyUsec } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/StorageArrayWidgetData";
import { formatDurationMsInLanguage as formatTraceDurationMsInLanguage } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/TraceChartData";
import { formatLlmDuration } from "../../../../App/FeatureSet/Dashboard/src/Components/LlmConversations/LlmConversationFormat";
import { formatMessageQueueDurationMsInLanguage } from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueOverviewPresentation";
import {
  describePingResult,
  formatRoundTrip,
  PingResultSummary,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceDiagnosticsViewModel";
import { formatLatencyInLanguage as formatMerakiLatency } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkTraffic/Meraki/MerakiTrafficRows";
import { getOpenStackCheckDurationText } from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/Checks/OpenStackChecksView";
import { formatCloudTopologySeconds } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/Builders/CloudAccountTopology";
import { formatDuration as formatConnectorTestDuration } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/ConnectorTestReportView";
import { formatDurationMsInLanguage as formatTelemetryDurationMs } from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryFormat";
import { formatDurationMs as formatTopologyDurationMs } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyMeta";
import { formatAppServiceCpuTime } from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/CloudAppPlatformResource";
import { formatDatabaseMetricAxisValue } from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerPresentation";
import StorageArrayResourceUtils from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/Utils/StorageArrayResourceUtils";
import {
  formatBreadcrumbOffset,
  formatBreadcrumbSpan,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/BreadcrumbTimelinePresentation";
import { formatEvidenceDuration } from "../../../../App/FeatureSet/Dashboard/src/Utils/InvestigationEvidenceFormat";
import { formatReplayMilliseconds } from "../../../../App/FeatureSet/Dashboard/src/Utils/ReplayCorrelation";
import { NetworkDeviceDiagnosticPingResult } from "../../../Types/NetworkDevice/NetworkDeviceDiagnosticResult";
import { Translator } from "../../../Types/Translator";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * THE DASHBOARD'S DURATIONS, OUTSIDE THE MONITOR SUMMARIES, IN THE READER'S
 * LANGUAGE (#7418).
 *
 * Outside the monitor summaries the Dashboard wrote its durations by hand:
 * a trace's p95 `${ms.toFixed(1)} ms`, a database's and a queue's latency,
 * a review's p99, an LLM call, a ping's round trip, an OpenStack check, a
 * storage array's latency, a breadcrumb's offset. A Persian reader read
 * Latin digits, an English decimal point and the Latin unit on the wrong
 * side of the figure; a German one "1.5 ms" where German writes "1,5 ms".
 * Each is the Dashboard's formatMilliseconds now. Per area, in English
 * (exactly as before, a figure of a thousand or more aside, which gains its
 * separator), German, Arabic and Persian. A chart's value axis keeps the
 * Latin figures and short "ms" every chart's axis writes, in any language.
 */

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

const ZWNJ: string = "\u{200C}";

// The unit each language words "{{value}} ms" with.
const UNIT: Record<string, string> = {
  en: "ms",
  de: "ms",
  ar: "ملي ث",
  fa: `میلی${ZWNJ}ثانیه`,
};

const LATIN_DIGIT: RegExp = /[0-9]/;
const LATIN_MS_AFTER_A_FIGURE: RegExp = /[0-9\u{06F0}-\u{06F9}]\s?ms\b/u;

const translators: Record<string, Translator> = Object.fromEntries(
  LANGUAGES.map((language: string): [string, Translator] => {
    return [language, dashboardTranslator(language)];
  }),
);

// What a language writes: the figure as it writes it, then its unit.
interface Expected {
  en: string;
  de: string;
  ar: string;
  fa: string;
}

const milliseconds: (figures: Expected) => Expected = (
  figures: Expected,
): Expected => {
  return {
    en: `${figures.en} ${UNIT["en"]}`,
    de: `${figures.de} ${UNIT["de"]}`,
    ar: `${figures.ar} ${UNIT["ar"]}`,
    fa: `${figures.fa} ${UNIT["fa"]}`,
  };
};

// Each language's text from `write`, its isolating marks left out.
const inEachLanguage: (
  write: (translator: Translator) => string | undefined,
) => Expected = (
  write: (translator: Translator) => string | undefined,
): Expected => {
  const text: (language: string) => string = (language: string): string => {
    return withoutIsolateMarks(write(translators[language]!) || "");
  };

  return { en: text("en"), de: text("de"), ar: text("ar"), fa: text("fa") };
};

// A Persian duration: Persian digits and unit, no Latin "ms" after a figure.
const expectPersian: (text: string) => void = (text: string): void => {
  expect(text).toContain(UNIT["fa"]!);
  expect(LATIN_DIGIT.test(text)).toBe(false);
  expect(LATIN_MS_AFTER_A_FIGURE.test(text)).toBe(false);
};

// 5.0, 42, 2.35, 1,234: as each language writes them.
const FIVE_TENTHS: Expected = { en: "5.0", de: "5,0", ar: "5.0", fa: "۵٫۰" };
const FORTY_TWO: Expected = { en: "42", de: "42", ar: "42", fa: "۴۲" };

describe("traces", () => {
  test("a trace widget's table cell: one decimal under ten, whole from ten up", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return formatTraceDurationMsInLanguage(5, t);
      }),
    ).toEqual(milliseconds(FIVE_TENTHS));
    expect(
      inEachLanguage((t: Translator): string => {
        return formatTraceDurationMsInLanguage(42.4, t);
      }),
    ).toEqual(milliseconds(FORTY_TWO));
    expectPersian(formatTraceDurationMsInLanguage(42.4, translators["fa"]!));
  });

  test("a span in the trace list widget, from nanoseconds", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return formatTraceListDuration(12_345_678, t);
      }),
    ).toEqual(milliseconds({ en: "12.3", de: "12,3", ar: "12.3", fa: "۱۲٫۳" }));
    // The other units are as short as they were.
    expect(formatTraceListDuration(500, translators["fa"]!)).toBe("500ns");
  });

  // A chart's value axis and tooltip write it as the tiles beside them do (#8349).
  test("a chart's value axis writes the reader's words too", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return formatTraceDurationMsInLanguage(42.4, t);
      }),
    ).toEqual(milliseconds(FORTY_TWO));
    expect(formatTraceDurationMsInLanguage(5, translators["en"]!)).toBe(
      "5.0 ms",
    );
  });
});

describe("databases and queues", () => {
  test("a queue's p95 processing time", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return formatMessageQueueDurationMsInLanguage(5, t);
      }),
    ).toEqual(milliseconds(FIVE_TENTHS));
    expect(
      inEachLanguage((t: Translator): string => {
        return formatMessageQueueDurationMsInLanguage(42, t);
      }),
    ).toEqual(milliseconds(FORTY_TWO));
    expect(
      formatMessageQueueDurationMsInLanguage(null, translators["fa"]!),
    ).toBe("—");
  });

  // A chart's axis writes the reader's words, as the tiles beside it do (#8349).
  test("a chart's axis: the reader's words, English with no translator", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return formatDatabaseMetricAxisValue(0.042, "s", t);
      }),
    ).toEqual(milliseconds(FORTY_TWO));
    expect(formatDatabaseMetricAxisValue(0.0042, "s")).toBe("4.2 ms");
  });
});

describe("telemetry and topology", () => {
  test("a service's, a function's or a site's p95 tile", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return formatTelemetryDurationMs(5, t);
      }),
    ).toEqual(milliseconds(FIVE_TENTHS));
    expect(formatTelemetryDurationMs(5, translators["en"]!)).toBe("5.0 ms");
  });

  test("a topology call's average", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return formatTopologyDurationMs(42.4, t);
      }),
    ).toEqual(milliseconds(FORTY_TWO));
    // No translator: English, as a chart's axis writes it.
    expect(formatTopologyDurationMs(42.4)).toBe("42 ms");
  });

  test("a cloud account's topology card, from seconds", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return formatCloudTopologySeconds(0.23, t);
      }),
    ).toEqual(milliseconds({ en: "230", de: "230", ar: "230", fa: "۲۳۰" }));
  });

  test("how long an investigation's step took", () => {
    expect(
      inEachLanguage((t: Translator): string | undefined => {
        return formatEvidenceDuration(340, t);
      }),
    ).toEqual(milliseconds({ en: "340", de: "340", ar: "340", fa: "۳۴۰" }));
  });
});

describe("code and AI", () => {
  test("a production review's p99", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return formatReviewDuration(840.4, t);
      }),
    ).toEqual(milliseconds({ en: "840", de: "840", ar: "840", fa: "۸۴۰" }));
  });

  test("an LLM call, and no call at all", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return formatLlmDuration(850, t);
      }),
    ).toEqual(milliseconds({ en: "850", de: "850", ar: "850", fa: "۸۵۰" }));
    expect(
      inEachLanguage((t: Translator): string => {
        return formatLlmDuration(0, t);
      }),
    ).toEqual(milliseconds({ en: "0", de: "0", ar: "0", fa: "۰" }));
    // A second or more is as it was.
    expect(formatLlmDuration(2300, translators["en"]!)).toBe("2.3 s");
  });
});

describe("infrastructure", () => {
  test("an OpenStack check's step", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return getOpenStackCheckDurationText(412, t);
      }),
    ).toEqual(milliseconds({ en: "412", de: "412", ar: "412", fa: "۴۱۲" }));
  });

  test("a storage array's latency, from microseconds, on its pages and its widget", () => {
    const expected: Expected = milliseconds({
      en: "2.35",
      de: "2,35",
      ar: "2.35",
      fa: "۲٫۳۵",
    });

    expect(
      inEachLanguage((t: Translator): string => {
        return StorageArrayResourceUtils.formatLatencyUsec(2350, t);
      }),
    ).toEqual(expected);
    expect(
      inEachLanguage((t: Translator): string => {
        return formatWidgetLatencyUsec(2350, t);
      }),
    ).toEqual(expected);
    // A thousand or more gains its separator.
    expect(
      StorageArrayResourceUtils.formatLatencyUsec(
        1_234_000,
        translators["en"]!,
      ),
    ).toBe("1,234 ms");
  });

  test("a ping's round trips, to a tenth", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return formatRoundTrip(12.44, t);
      }),
    ).toEqual(milliseconds({ en: "12.4", de: "12,4", ar: "12.4", fa: "۱۲٫۴" }));

    const ping: NetworkDeviceDiagnosticPingResult = {
      isOnline: true,
      failureCause: "",
      pingResponse: {
        packetsSent: 5,
        packetsReceived: 5,
        packetLossPercent: 0,
        minRoundTripTimeInMs: 10.24,
        maxRoundTripTimeInMs: 20.06,
        avgRoundTripTimeInMs: 12.44,
        jitterInMs: 1.2,
      },
    } as unknown as NetworkDeviceDiagnosticPingResult;
    const persian: PingResultSummary = describePingResult(
      ping,
      undefined,
      translators["fa"]!,
    );

    for (const row of persian.rows.slice(0, 3)) {
      expectPersian(withoutIsolateMarks(row.value));
    }
  });

  test("a Meraki uplink's latency row, its unit kept beside its figure", () => {
    const noBreakSpace: string = String.fromCharCode(0xa0);

    expect(
      inEachLanguage((t: Translator): string => {
        return formatMerakiLatency(24, t).split(noBreakSpace).join(" ");
      }),
    ).toEqual(milliseconds({ en: "24", de: "24", ar: "24", fa: "۲۴" }));
    expect(formatMerakiLatency(1.2, translators["en"]!)).toBe(
      `1.2${noBreakSpace}ms`,
    );
  });
});

describe("the others: breadcrumbs, replays, cloud tiles, connectors, App Service", () => {
  const EXCEPTION_AT: Date = new Date("2026-11-15T10:00:00.000Z");

  test("a breadcrumb's offset from the exception, before and after it, signed", () => {
    const before: Date = new Date(EXCEPTION_AT.getTime() - 880);
    const after: Date = new Date(EXCEPTION_AT.getTime() + 880);

    expect(
      inEachLanguage((t: Translator): string => {
        return formatBreadcrumbOffset(before, EXCEPTION_AT, t) || "";
      }),
    ).toEqual(
      milliseconds({
        en: "-880",
        de: "-880",
        ar: "\u{200E}-880",
        fa: "\u{200E}\u{2212}۸۸۰",
      }),
    );
    expect(
      inEachLanguage((t: Translator): string => {
        return formatBreadcrumbOffset(after, EXCEPTION_AT, t) || "";
      }),
    ).toEqual(
      milliseconds({
        en: "+880",
        de: "+880",
        ar: "\u{200E}+880",
        fa: "\u{200E}+۸۸۰",
      }),
    );
  });

  test("the span of time the breadcrumbs cover", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return formatBreadcrumbSpan(880, t);
      }),
    ).toEqual(milliseconds({ en: "880", de: "880", ar: "880", fa: "۸۸۰" }));
  });

  test("a replay's missing gap, in the sentence's language", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return formatReplayMilliseconds(420, t);
      }),
    ).toEqual(milliseconds({ en: "420", de: "420", ar: "420", fa: "۴۲۰" }));
    // The panel's own English sentences keep it English.
    expect(formatReplayMilliseconds(-420)).toBe("-420 ms");
  });

  test("a cloud headline tile, from seconds", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return formatCloudSeconds(0.23, t);
      }),
    ).toEqual(milliseconds({ en: "230", de: "230", ar: "230", fa: "۲۳۰" }));
  });

  test("a connector test's step", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return formatConnectorTestDuration(820.4, t);
      }),
    ).toEqual(milliseconds({ en: "820", de: "820", ar: "820", fa: "۸۲۰" }));
  });

  test("an App Service's CPU time under a minute", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return formatAppServiceCpuTime(0.45, t.language, t);
      }),
    ).toEqual(milliseconds({ en: "450", de: "450", ar: "450", fa: "۴۵۰" }));
    // Without a translator, English, as before.
    expect(formatAppServiceCpuTime(0.004)).toBe("4.0 ms");
  });
});

describe("negative control: what the Dashboard wrote by hand reads wrong", () => {
  test("a hand-built `${x} ms` keeps Latin digits and the Latin unit in Persian", () => {
    const handBuilt: string = `${(12.44).toFixed(1)} ms`;

    expect(LATIN_MS_AFTER_A_FIGURE.test(handBuilt)).toBe(true);
    expect(() => {
      expectPersian(handBuilt);
    }).toThrow();
    expect(() => {
      expectPersian(formatRoundTrip(12.44, translators["fa"]!));
    }).not.toThrow();
  });
});
