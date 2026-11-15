// UX rule: Docs/ux/README.md#in-every-language
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import SloMetricType from "Common/Types/ServiceLevelObjective/SloMetricType";
import { SLO_CURRENT_BURN_RATE_WINDOW_MINUTES } from "Common/Utils/Slo/SloEvaluation";
import SloMetricTypeUtil from "Common/Utils/Slo/SloMetricType";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";
import { SLO_BURN_RATE_CHART_DESCRIPTION } from "../../FeatureSet/Dashboard/src/Components/Slo/SloMetricsQueryConfig";
import {
  asWrittenTokensMissing,
  fullStopsOf,
  numbersMissing,
} from "./DescriptionWordsKept";

/*
 * WHAT A MONITOR'S STORED SERIES SAY THEY ARE, IN THE READER'S LANGUAGE
 * (#8356).
 *
 * When a monitor runs, the server stores each series it writes as a
 * MetricType with a description (Common/Server/Utils/Monitor/
 * MonitorMetricUtil), and the metrics list draws it under the series' name,
 * looked up once (MetricRow). The host, SNMP, HTTP phase, NTP and probe
 * series' descriptions were English literals no locale held, and eight
 * more were glued from a CheckOn value at run time ("Is Online" + " status
 * for monitor"), so they could never be keys. So was the SLO Burn Rate
 * series', which wrote its window into the sentence.
 *
 * Each is written out whole now and marked (translationKey), the file a
 * keys root of the Dashboard's extractor, and worded in every Dashboard
 * language, keeping the names, numbers and units the English gives. The
 * English words stay as they were, so a series a monitor stored before
 * reads in the reader's language too.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");
const MONITOR_METRIC_UTIL: string = path.join(
  REPOSITORY_ROOT,
  "packages/Common/Server/Utils/Monitor/MonitorMetricUtil.ts",
);

const KEYED: RegExp = /translationKey\(\s*("(?:[^"\\]|\\.)+")\s*,?\s*\)/g;
// A description handed as a bare literal, or glued from a criteria's name.
const UNKEYED: RegExp =
  /description\s*(?::|=)\s*(?:"|'|CheckOn\.|[A-Za-z]+\s*\+)/g;

const NAMES: ReadonlyArray<string> = [
  "SNMP",
  "OID",
  "DNS",
  "TCP",
  "TLS",
  "CPU",
  "VM",
  "NTP",
  "Port",
  "ESTABLISHED",
  "LISTEN",
  "ms",
];

function unkeyedIn(source: string): Array<string> {
  return source.match(UNKEYED) || [];
}

const SOURCE: string = fs.readFileSync(MONITOR_METRIC_UTIL, "utf8");

const STORED: Array<string> = Array.from(
  new Set<string>(
    Array.from(SOURCE.matchAll(KEYED), (match: RegExpMatchArray): string => {
      return JSON.parse(match[1] as string) as string;
    }),
  ),
);

const BURN_RATE: string = SloMetricTypeUtil.getDescription(
  SloMetricType.BurnRate,
);

const TEXTS: Array<string> = [...STORED, BURN_RATE];

const english: Record<string, string> = readDashboardLocale("en");

describe("what the server stores as each monitor series' description", () => {
  test("is a key it marks, never a bare literal or a glued criteria name", () => {
    expect(unkeyedIn(SOURCE)).toEqual([]);
    expect(STORED.length).toBeGreaterThan(45);

    for (const text of [
      "Total running processes on the server",
      "SNMP interface operational status (1 up, 0 down)",
      "Is Online status for monitor",
      "CPU Usage (in %) of Server/VM",
      "NTP Is Synchronized status of this time server",
      "Response Status Code for this monitor",
    ]) {
      expect({ text, stored: STORED.includes(text) }).toEqual({
        text,
        stored: true,
      });
    }
  });

  test("a bare or a glued description is caught (control)", () => {
    expect(
      unkeyedIn(
        [
          'metricType.description = CheckOn.IsOnline + " status for monitor";',
          'description: "Host uptime in seconds",',
          'description: translationKey("Host uptime in seconds"),',
          "description: definition.description,",
        ].join("\n"),
      ),
    ).toEqual(["description = CheckOn.", 'description: "']);
  });

  test("the SLO Burn Rate series says its window as the Burn Rate chart does", () => {
    expect(BURN_RATE).toBe(
      SLO_BURN_RATE_CHART_DESCRIPTION.other
        .split("{{count}}")
        .join(String(SLO_CURRENT_BURN_RATE_WINDOW_MINUTES)),
    );
  });

  test("is a key of the Dashboard's English locale", () => {
    expect(
      TEXTS.filter((text: string): boolean => {
        return english[text] === undefined;
      }),
    ).toEqual([]);
  });

  test.each(DASHBOARD_LANGUAGES)(
    "is worded in %s, keeping its names, numbers, units and full stop",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const stops: ReadonlyArray<string> = fullStopsOf(language);
      const broken: Array<{ text: string; lost: Array<string> }> = [];

      for (const text of TEXTS) {
        if (!isWordedInDashboardLocale(text, language)) {
          broken.push({ text, lost: ["its wording"] });
          continue;
        }

        const worded: string = words[text] as string;
        const lost: Array<string> = [
          ...asWrittenTokensMissing(text, worded, NAMES),
          ...numbersMissing(text, worded),
        ];

        if (text.includes("%") && !worded.includes("%")) {
          lost.push("%");
        }

        if (
          text.endsWith(".") &&
          !stops.some((stop: string): boolean => {
            return worded.trimEnd().endsWith(stop);
          })
        ) {
          lost.push("its full stop");
        }

        if (lost.length > 0) {
          broken.push({ text, lost });
        }
      }

      expect({ language, broken }).toEqual({ language, broken: [] });
    },
  );
});
