import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  RenderResult,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import EventEvaluationDetails from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventEvaluationDetails";
import CustomMonitorSummaryView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/CustomMonitorSummaryView";
import DatabaseMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/DatabaseMonitorView";
import DnsMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/DnsMonitorView";
import DnssecMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/DnssecMonitorView";
import DomainMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/DomainMonitorView";
import HttpTimingsView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/HttpTimingsView";
import NetworkPathView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/NetworkPathView";
import NtpMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/NtpMonitorView";
import PingMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/PingMonitorView";
import PortMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/PortMonitorView";
import PortTimingsView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/PortTimingsView";
import ProbeAttemptsView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/ProbeAttemptsView";
import SnmpMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SnmpMonitorView";
import SqlMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SqlMonitorView";
import {
  SUMMARY_FACT_TEST_ID,
  TIMING_ROW_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SummaryFacts";
import WebsiteMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/WebsiteMonitorView";
import TracerouteHopsTable from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/TracerouteHopsTable";
import Hostname from "../../../Types/API/Hostname";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import CustomCodeMonitorResponse from "../../../Types/Monitor/CustomCodeMonitor/CustomCodeMonitorResponse";
import DatabaseMonitorResponse from "../../../Types/Monitor/DatabaseMonitor/DatabaseMonitorResponse";
import DnsMonitorResponse from "../../../Types/Monitor/DnsMonitor/DnsMonitorResponse";
import DnssecMonitorResponse from "../../../Types/Monitor/DnssecMonitor/DnssecMonitorResponse";
import DomainMonitorResponse from "../../../Types/Monitor/DomainMonitor/DomainMonitorResponse";
import MonitorEvaluationDetails, {
  MonitorEvaluationDetailsVersion,
} from "../../../Types/Monitor/MonitorEvaluationDetails";
import MonitorType from "../../../Types/Monitor/MonitorType";
import NetworkPathTrace, {
  TraceRouteHop,
} from "../../../Types/Monitor/NetworkMonitor/NetworkPathTrace";
import NtpMonitorResponse from "../../../Types/Monitor/NtpMonitor/NtpMonitorResponse";
import SnmpMonitorResponse from "../../../Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import SqlMonitorResponse from "../../../Types/Monitor/SqlMonitor/SqlMonitorResponse";
import ObjectID from "../../../Types/ObjectID";
import ProbeAttempt from "../../../Types/Probe/ProbeAttempt";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import { drawLine, getDrawnText } from "../../Helpers/BidiLayout";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * EVERY MONITOR SUMMARY'S DURATIONS, IN THE READER'S LANGUAGE (#7224).
 *
 * Each monitor type's summary - the monitor's Summary card, Test Monitor's
 * result, Monitoring Logs' View Summary - wrote its Response Time, a ping's
 * jitter and round trips, a port's and a request's phases, a script's or a
 * query's execution time and an NTP server's delays as `x + " ms"`. On an
 * Arabic or Persian page that English read "ms 411", and Persian kept its
 * Latin digits beside the card's Persian date. Each is the Dashboard's
 * formatMilliseconds now: the "{{value}} ms" key, worded by each language,
 * with the figure written the reader's way.
 *
 * Each view below is drawn in English (exactly as before, "412 ms"), in
 * German (its own separators), in Arabic (an Arabic unit, the figure read
 * first from the right) and in Persian (Persian digits and a Persian unit).
 */

type Language = "en" | "de" | "ar" | "fa";

const LANGUAGES: Array<Language> = ["en", "de", "ar", "fa"];

const ZWNJ: string = "\u{200C}";
const LRM: string = "\u{200E}";

// Each language's unit, after the figure, as its "{{value}} ms" words it.
const UNIT: Record<Language, string> = {
  en: "ms",
  de: "ms",
  ar: "ملي ث",
  fa: `میلی${ZWNJ}ثانیه`,
};

const LATIN_DIGIT: RegExp = /[0-9]/;
const LATIN_LETTER: RegExp = /[A-Za-z]/;

/*
 * A figure's last digit, in any digits, then Latin "ms": a duration written
 * by hand ("412 ms", "۴۱۲ ms", "1,234ms").
 */
const FIGURE_THEN_LATIN_MS: RegExp = /[0-9\u{06F0}-\u{06F9}]\s?ms(?![A-Za-z])/u;

const MONITORED_AT: Date = new Date(Date.UTC(2026, 10, 12, 9, 30));

const instances: Partial<Record<Language, i18n>> = {};

beforeAll(async () => {
  for (const language of LANGUAGES) {
    const instance: i18n = createInstance();
    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        [language]: { translation: readDashboardLocale(language) },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

const inLanguage: (
  language: Language,
  element: React.ReactElement,
) => React.ReactElement = (
  language: Language,
  element: React.ReactElement,
): React.ReactElement => {
  return (
    <I18nextProvider i18n={instances[language]!}>{element}</I18nextProvider>
  );
};

const textOf: (element: Element | null | undefined) => string = (
  element: Element | null | undefined,
): string => {
  return withoutIsolateMarks(element?.textContent || "").trim();
};

// A summary fact's value, found by its title as the language words it.
const factValue: (
  container: HTMLElement,
  language: Language,
  title: string,
) => string = (
  container: HTMLElement,
  language: Language,
  title: string,
): string => {
  const worded: string = readDashboardLocale(language)[title] || title;
  const card: Element | undefined = Array.from(
    container.querySelectorAll(`[data-testid="${SUMMARY_FACT_TEST_ID}"]`),
  ).find((candidate: Element): boolean => {
    return textOf(candidate.firstElementChild) === worded;
  });

  if (!card) {
    throw new Error(`No "${title}" fact in ${language}`);
  }

  return textOf(card.lastElementChild);
};

// A phase breakdown's rows (a request's, a connection's): label and time.
const phaseRows: (container: HTMLElement) => Array<[string, string]> = (
  container: HTMLElement,
): Array<[string, string]> => {
  return Array.from(
    container.querySelectorAll(`[data-testid="${TIMING_ROW_TEST_ID}"]`),
  ).map((row: Element): [string, string] => {
    return [textOf(row.children[0]), textOf(row.children[2])];
  });
};

const probeResponse: (
  overrides: Partial<ProbeMonitorResponse>,
) => ProbeMonitorResponse = (
  overrides: Partial<ProbeMonitorResponse>,
): ProbeMonitorResponse => {
  return {
    projectId: new ObjectID("11111111-1111-4111-8111-111111111111"),
    monitorId: new ObjectID("22222222-2222-4222-8222-222222222222"),
    monitorStepId: new ObjectID("33333333-3333-4333-8333-333333333333"),
    probeId: new ObjectID("44444444-4444-4444-8444-444444444444"),
    isOnline: true,
    monitoredAt: MONITORED_AT,
    ...overrides,
  } as ProbeMonitorResponse;
};

/*
 * One view's durations: how to draw it, what to read off it, and each
 * figure as each language writes it. The expected text is each figure,
 * then the language's unit.
 */
interface DurationCase {
  name: string;
  draw: () => React.ReactElement;
  // Opens what a reader opens first (a fold), when the view has one.
  open?: (result: RenderResult) => void;
  read: (container: HTMLElement, language: Language) => Array<string>;
  figures: Record<Language, Array<string>>;
}

const ATTEMPTS: Array<ProbeAttempt> = [1, 2].map(
  (attemptNumber: number): ProbeAttempt => {
    return {
      attemptNumber: attemptNumber,
      attemptedAt: new Date(Date.UTC(2026, 10, 12, 9, 30, attemptNumber)),
      responseReceivedAt: new Date(
        Date.UTC(2026, 10, 12, 9, 30, attemptNumber + 1),
      ),
      responseTimeInMs: attemptNumber === 1 ? 30000 : 1234.4,
      responseCode: attemptNumber === 2 ? 200 : undefined,
      isOnline: attemptNumber === 2,
      failureCause: attemptNumber === 2 ? undefined : "Timed out",
    };
  },
);

const NTP_REPLY: NtpMonitorResponse = {
  isOnline: true,
  isSynchronized: true,
  responseTimeInMs: 18.4,
  failureCause: "",
  serverAddress: "192.0.2.10",
  port: 123,
  version: 4,
  leapIndicator: 0,
  stratum: 2,
  referenceId: "192.0.2.1",
  rootDelayInMs: 12.5,
  rootDispersionInMs: 3.25,
  serverTime: "2026-11-12T09:30:00.004Z",
  clockOffsetInMs: 0.0421,
  roundTripDelayInMs: 17.2,
};

const HOPS: Array<TraceRouteHop> = [
  {
    hopNumber: 1,
    address: "192.0.2.1",
    hostName: "gateway.example",
    roundTripTimeInMS: 0.512,
    isTimeout: false,
  },
  {
    hopNumber: 2,
    address: "198.51.100.7",
    hostName: undefined,
    roundTripTimeInMS: 1234.25,
    isTimeout: false,
  },
];

const EVALUATION: MonitorEvaluationDetails = {
  version: MonitorEvaluationDetailsVersion,
  monitorType: MonitorType.API,
  evaluatedAt: MONITORED_AT,
  criteriaId: "criteria-1",
  criteriaName: "Payments degraded",
  filterCondition: FilterCondition.All,
  filters: [],
  probeName: "US West",
  response: { statusCode: 503, responseTimeInMs: 1234.5, isOnline: true },
} as MonitorEvaluationDetails;

const CASES: Array<DurationCase> = [
  {
    name: "a website's Response Time and its request's phases",
    draw: (): React.ReactElement => {
      return (
        <WebsiteMonitorView
          probeMonitorResponse={probeResponse({
            responseTimeInMs: 411.6,
            responseCode: 200,
            httpTimings: {
              dnsLookupInMs: 12.3,
              tcpConnectInMs: 31.2749,
              tlsHandshakeInMs: 45,
              timeToFirstByteInMs: 1234.5,
              downloadInMs: 8.125,
            },
          })}
        />
      );
    },
    read: (container: HTMLElement, language: Language): Array<string> => {
      return [
        factValue(container, language, "Response Time (in ms)"),
        ...phaseRows(container).map((row: [string, string]): string => {
          return row[1];
        }),
      ];
    },
    figures: {
      en: ["412", "12.3", "31.27", "45", "1,234.5", "8.13"],
      de: ["412", "12,3", "31,27", "45", "1.234,5", "8,13"],
      ar: ["412", "12.3", "31.27", "45", "1,234.5", "8.13"],
      fa: ["۴۱۲", "۱۲٫۳", "۳۱٫۲۷", "۴۵", "۱٬۲۳۴٫۵", "۸٫۱۳"],
    },
  },
  {
    name: "a ping's Response Time, jitter and round trips",
    draw: (): React.ReactElement => {
      return (
        <PingMonitorView
          probeMonitorResponse={probeResponse({
            responseTimeInMs: 23.6,
            pingResponse: {
              packetsSent: 4,
              packetsReceived: 3,
              packetLossPercent: 25,
              jitterInMs: 1.25,
              minRoundTripTimeInMs: 20.125,
              maxRoundTripTimeInMs: 1500.5,
            },
          })}
        />
      );
    },
    read: (container: HTMLElement, language: Language): Array<string> => {
      return [
        factValue(container, language, "Response Time (in ms)"),
        factValue(container, language, "Jitter"),
        factValue(container, language, "Min RTT"),
        factValue(container, language, "Max RTT"),
      ];
    },
    figures: {
      en: ["24", "1.25", "20.125", "1,500.5"],
      de: ["24", "1,25", "20,125", "1.500,5"],
      ar: ["24", "1.25", "20.125", "1,500.5"],
      fa: ["۲۴", "۱٫۲۵", "۲۰٫۱۲۵", "۱٬۵۰۰٫۵"],
    },
  },
  {
    name: "a port's connection time and its phases",
    draw: (): React.ReactElement => {
      return (
        <PortMonitorView
          probeMonitorResponse={probeResponse({
            responseTimeInMs: 45.678,
            portTimings: { dnsLookupInMs: 3.456, tcpConnectInMs: 42.2 },
          })}
        />
      );
    },
    read: (container: HTMLElement, language: Language): Array<string> => {
      return [
        factValue(container, language, "Total Connection Time (DNS + TCP)"),
        ...phaseRows(container).map((row: [string, string]): string => {
          return row[1];
        }),
      ];
    },
    figures: {
      en: ["45.68", "3.46", "42.2"],
      de: ["45,68", "3,46", "42,2"],
      ar: ["45.68", "3.46", "42.2"],
      fa: ["۴۵٫۶۸", "۳٫۴۶", "۴۲٫۲"],
    },
  },
  {
    name: "a port's phases on their own (PortTimingsView)",
    draw: (): React.ReactElement => {
      return (
        <PortTimingsView
          portTimings={{
            dnsLookupInMs: 1234.567,
            tcpConnectInMs: 0.5,
            totalConnectionInMs: 1300,
          }}
        />
      );
    },
    read: (container: HTMLElement): Array<string> => {
      return phaseRows(container).map((row: [string, string]): string => {
        return row[1];
      });
    },
    figures: {
      en: ["1,234.57", "0.5"],
      de: ["1.234,57", "0,5"],
      ar: ["1,234.57", "0.5"],
      fa: ["۱٬۲۳۴٫۵۷", "۰٫۵"],
    },
  },
  {
    name: "a request's phases on their own (HttpTimingsView)",
    draw: (): React.ReactElement => {
      return (
        <HttpTimingsView
          httpTimings={{ timeToFirstByteInMs: 250, downloadInMs: 2000.004 }}
        />
      );
    },
    read: (container: HTMLElement): Array<string> => {
      return phaseRows(container).map((row: [string, string]): string => {
        return row[1];
      });
    },
    figures: {
      en: ["250", "2,000"],
      de: ["250", "2.000"],
      ar: ["250", "2,000"],
      fa: ["۲۵۰", "۲٬۰۰۰"],
    },
  },
  {
    name: "a custom code monitor's Execution Time",
    draw: (): React.ReactElement => {
      return (
        <CustomMonitorSummaryView
          customCodeMonitorResponse={
            { executionTimeInMS: 1234.4 } as CustomCodeMonitorResponse
          }
          monitoredAt={MONITORED_AT}
          probeName="London Probe"
        />
      );
    },
    read: (container: HTMLElement, language: Language): Array<string> => {
      return [factValue(container, language, "Execution Time (in ms)")];
    },
    figures: {
      en: ["1,234"],
      de: ["1.234"],
      ar: ["1,234"],
      fa: ["۱٬۲۳۴"],
    },
  },
  {
    name: "a database's Response Time",
    draw: (): React.ReactElement => {
      return (
        <DatabaseMonitorView
          probeMonitorResponse={probeResponse({
            databaseMonitorResponse: {
              isOnline: true,
              responseTimeInMs: 87.4,
            } as DatabaseMonitorResponse,
          })}
        />
      );
    },
    read: (container: HTMLElement, language: Language): Array<string> => {
      return [factValue(container, language, "Response Time")];
    },
    figures: { en: ["87"], de: ["87"], ar: ["87"], fa: ["۸۷"] },
  },
  {
    name: "an SNMP device's Response Time",
    draw: (): React.ReactElement => {
      return (
        <SnmpMonitorView
          probeMonitorResponse={probeResponse({
            snmpResponse: {
              responseTimeInMs: 1999.6,
            } as SnmpMonitorResponse,
          })}
        />
      );
    },
    read: (container: HTMLElement, language: Language): Array<string> => {
      return [factValue(container, language, "Response Time")];
    },
    figures: {
      en: ["2,000"],
      de: ["2.000"],
      ar: ["2,000"],
      fa: ["۲٬۰۰۰"],
    },
  },
  {
    name: "a DNSSEC check's Response Time",
    draw: (): React.ReactElement => {
      return (
        <DnssecMonitorView
          probeMonitorResponse={probeResponse({
            dnssecResponse: {
              responseTimeInMs: 140.2,
            } as DnssecMonitorResponse,
          })}
        />
      );
    },
    read: (container: HTMLElement, language: Language): Array<string> => {
      return [factValue(container, language, "Response Time")];
    },
    figures: { en: ["140"], de: ["140"], ar: ["140"], fa: ["۱۴۰"] },
  },
  {
    name: "a DNS check's Response Time",
    draw: (): React.ReactElement => {
      return (
        <DnsMonitorView
          probeMonitorResponse={probeResponse({
            dnsResponse: { responseTimeInMs: 33.3 } as DnsMonitorResponse,
          })}
        />
      );
    },
    read: (container: HTMLElement, language: Language): Array<string> => {
      return [factValue(container, language, "Response Time")];
    },
    figures: { en: ["33"], de: ["33"], ar: ["33"], fa: ["۳۳"] },
  },
  {
    name: "a domain's Response Time",
    draw: (): React.ReactElement => {
      return (
        <DomainMonitorView
          probeMonitorResponse={probeResponse({
            domainResponse: {
              responseTimeInMs: 911.9,
            } as DomainMonitorResponse,
          })}
        />
      );
    },
    read: (container: HTMLElement, language: Language): Array<string> => {
      return [factValue(container, language, "Response Time")];
    },
    figures: { en: ["912"], de: ["912"], ar: ["912"], fa: ["۹۱۲"] },
  },
  {
    name: "a SQL query's Execution Time",
    draw: (): React.ReactElement => {
      return (
        <SqlMonitorView
          probeMonitorResponse={probeResponse({
            sqlQueryMonitorResponse: {
              responseTimeInMs: 7.2,
            } as SqlMonitorResponse,
          })}
        />
      );
    },
    read: (container: HTMLElement, language: Language): Array<string> => {
      return [factValue(container, language, "Execution Time")];
    },
    figures: { en: ["7"], de: ["7"], ar: ["7"], fa: ["۷"] },
  },
  {
    name: "an NTP server's Response Time and delays",
    draw: (): React.ReactElement => {
      return (
        <NtpMonitorView
          probeMonitorResponse={probeResponse({
            monitorDestination: new Hostname("time.example.com"),
            responseTimeInMs: 18.4,
            ntpResponse: NTP_REPLY,
          })}
        />
      );
    },
    read: (container: HTMLElement, language: Language): Array<string> => {
      return [
        factValue(container, language, "Response Time"),
        factValue(container, language, "Root Dispersion"),
        factValue(container, language, "Root Delay"),
      ];
    },
    figures: {
      en: ["18.4", "3.25", "12.5"],
      de: ["18,4", "3,25", "12,5"],
      ar: ["18.4", "3.25", "12.5"],
      fa: ["۱۸٫۴", "۳٫۲۵", "۱۲٫۵"],
    },
  },
  {
    name: "a probe's Retry Attempts",
    draw: (): React.ReactElement => {
      return <ProbeAttemptsView attempts={ATTEMPTS} />;
    },
    read: (container: HTMLElement): Array<string> => {
      return Array.from(
        container.querySelectorAll('[data-testid="probe-attempt-line"]'),
      ).map((line: Element): string => {
        return textOf(line.querySelectorAll("bdi")[2]);
      });
    },
    figures: {
      en: ["30,000", "1,234"],
      de: ["30.000", "1.234"],
      ar: ["30,000", "1,234"],
      fa: ["۳۰٬۰۰۰", "۱٬۲۳۴"],
    },
  },
  {
    name: "a network check's traceroute hops",
    draw: (): React.ReactElement => {
      return <TracerouteHopsTable hops={HOPS} />;
    },
    read: (container: HTMLElement): Array<string> => {
      return Array.from(container.querySelectorAll("tbody tr")).map(
        (row: Element): string => {
          return textOf(row.children[2]);
        },
      );
    },
    figures: {
      en: ["0.512", "1,234.25"],
      de: ["0,512", "1.234,25"],
      ar: ["0.512", "1,234.25"],
      fa: ["۰٫۵۱۲", "۱٬۲۳۴٫۲۵"],
    },
  },
  {
    name: "an incident's or alert's evaluation (EventEvaluationDetails)",
    draw: (): React.ReactElement => {
      return <EventEvaluationDetails details={EVALUATION} />;
    },
    open: (result: RenderResult): void => {
      fireEvent.click(result.getByTestId("evaluation-details-toggle"));
    },
    read: (container: HTMLElement): Array<string> => {
      return [
        textOf(
          container.querySelector(
            '[data-testid="evaluation-facts-response-time"]',
          )?.lastElementChild,
        ),
      ];
    },
    figures: {
      en: ["1,234.5"],
      de: ["1.234,5"],
      ar: ["1,234.5"],
      fa: ["۱٬۲۳۴٫۵"],
    },
  },
];

// Draws a case in a language, opened as a reader opens it.
const drawCase: (
  durationCase: DurationCase,
  language: Language,
) => HTMLElement = (
  durationCase: DurationCase,
  language: Language,
): HTMLElement => {
  const result: RenderResult = render(
    inLanguage(language, durationCase.draw()),
  );

  durationCase.open?.(result);

  return result.container;
};

// How a page read from the right draws `text`, from left to right.
const drawnFromTheRight: (text: string) => string = (text: string): string => {
  return getDrawnText(drawLine(text, "rtl"));
};

// Each case under its name.
const NAMED_CASES: Array<[string, DurationCase]> = CASES.map(
  (durationCase: DurationCase): [string, DurationCase] => {
    return [durationCase.name, durationCase];
  },
);

describe.each(NAMED_CASES)(
  "%s",
  (_name: string, durationCase: DurationCase) => {
    test("in English, exactly as before: the figure, then 'ms'", () => {
      const container: HTMLElement = drawCase(durationCase, "en");

      expect(durationCase.read(container, "en")).toEqual(
        durationCase.figures.en.map((figure: string): string => {
          return `${figure} ms`;
        }),
      );
    });

    test("in German: German separators, then 'ms'", () => {
      const container: HTMLElement = drawCase(durationCase, "de");

      expect(durationCase.read(container, "de")).toEqual(
        durationCase.figures.de.map((figure: string): string => {
          return `${figure} ms`;
        }),
      );
    });

    test("in Persian: Persian digits, then the Persian unit, nothing Latin", () => {
      const container: HTMLElement = drawCase(durationCase, "fa");
      const durations: Array<string> = durationCase.read(container, "fa");

      expect(durations).toEqual(
        durationCase.figures.fa.map((figure: string): string => {
          return `${figure} ${UNIT.fa}`;
        }),
      );

      durations.forEach((duration: string, index: number) => {
        expect(duration).not.toMatch(LATIN_DIGIT);
        expect(duration).not.toMatch(LATIN_LETTER);
        // Read from the right, the figure comes first.
        expect(
          drawnFromTheRight(duration).endsWith(durationCase.figures.fa[index]!),
        ).toBe(true);
      });

      expect(textOf(container)).not.toMatch(FIGURE_THEN_LATIN_MS);
    });

    test("in Arabic: the Arabic unit, never 'ms 411'", () => {
      const container: HTMLElement = drawCase(durationCase, "ar");
      const durations: Array<string> = durationCase.read(container, "ar");

      expect(durations).toEqual(
        durationCase.figures.ar.map((figure: string): string => {
          return `${figure} ${UNIT.ar}`;
        }),
      );

      durations.forEach((duration: string, index: number) => {
        expect(duration).not.toMatch(LATIN_LETTER);
        expect(
          drawnFromTheRight(duration).endsWith(durationCase.figures.ar[index]!),
        ).toBe(true);
      });

      expect(textOf(container)).not.toMatch(FIGURE_THEN_LATIN_MS);
    });
  },
);

describe("what sits beside the durations", () => {
  test("a ping's Packet Loss: the share and the pair in the reader's digits", () => {
    const draw: (language: Language) => string = (
      language: Language,
    ): string => {
      const container: HTMLElement = drawCase(CASES[1]!, language);
      const value: string = factValue(container, language, "Packet Loss");

      cleanup();

      return value;
    };

    expect(draw("en")).toBe("25% (3/4 received)");
    expect(draw("fa")).toBe(`۲۵٪ (۳/۴ دریافت${ZWNJ}شده)`);
    expect(draw("fa")).not.toMatch(LATIN_DIGIT);
    // Arabic's percent sign as Intl writes it, held left to right by its marks.
    expect(draw("ar")).toBe(`25${LRM}%${LRM} (استُلم 3/4)`);
  });

  test("a port's phases are named in the reader's language", () => {
    const labels: (language: Language) => Array<string> = (
      language: Language,
    ): Array<string> => {
      const container: HTMLElement = drawCase(CASES[3]!, language);
      const names: Array<string> = phaseRows(container).map(
        (row: [string, string]): string => {
          return row[0];
        },
      );

      cleanup();

      return names;
    };

    expect(labels("en")).toEqual(["DNS Lookup", "TCP Connect"]);
    expect(labels("ar")).toEqual(["البحث في DNS", "اتصال TCP"]);
    expect(labels("de")).toEqual([
      readDashboardLocale("de")["DNS Lookup"],
      readDashboardLocale("de")["TCP Connect"],
    ]);
  });

  test("an NTP server's clock offset: the duration inside the language's sentence", () => {
    const offset: (language: Language) => string = (
      language: Language,
    ): string => {
      const container: HTMLElement = drawCase(CASES[12]!, language);
      const value: string = factValue(container, language, "Clock Offset");

      cleanup();

      return value;
    };

    expect(offset("en")).toBe("0.042 ms ahead of the probe");
    expect(offset("de")).toBe("0,042 ms vor der Sonde");
    expect(offset("ar")).toBe(`متقدم على المسبار بمقدار 0.042 ${UNIT.ar}`);
    expect(offset("fa")).toBe(`۰٫۰۴۲ ${UNIT.fa} جلوتر از پراب`);
  });

  /*
   * A DNS lookup's time is part of a whole sentence, worded with its unit
   * by each language: Arabic and Persian word it, Persian in its own
   * digits; German has it in English for now, so its figure is written as
   * English writes it.
   */
  test("a network path's DNS lookup: the sentence's own unit, the figure in the sentence's digits", () => {
    const trace: NetworkPathTrace = {
      dnsLookup: {
        hostName: "example.com",
        resolvedAddresses: ["93.184.216.34"],
        resolvedInMS: 1234,
        isSuccess: true,
        errorMessage: undefined,
      },
      timestamp: MONITORED_AT,
    };
    const sentence: (language: Language) => string = (
      language: Language,
    ): string => {
      const result: RenderResult = render(
        inLanguage(language, <NetworkPathView networkPathTrace={trace} />),
      );
      const text: string = textOf(
        result.container.querySelector("div.mb-3.text-sm"),
      );

      cleanup();

      return text;
    };

    expect(sentence("en")).toBe(
      "DNS: example.com resolved to 93.184.216.34 in 1,234 ms",
    );
    expect(sentence("ar")).toBe(
      `DNS: حُل example.com إلى 93.184.216.34 خلال 1,234 ${UNIT.ar}`,
    );
    expect(sentence("fa")).toBe(
      `DNS: نام example.com در ۱٬۲۳۴ ${UNIT.fa} به 93.184.216.34 حل شد`,
    );
    expect(sentence("de")).toBe(
      "DNS: example.com resolved to 93.184.216.34 in 1,234 ms",
    );
  });
});

describe("negative control: the English the summaries wrote", () => {
  test("is drawn 'ms 412' from the right, and the scan above sees it", () => {
    expect(drawnFromTheRight("412 ms")).toBe("ms 412");
    expect("Response Time 412 ms").toMatch(FIGURE_THEN_LATIN_MS);
    expect("زمان پاسخ ۴۱۲ ms").toMatch(FIGURE_THEN_LATIN_MS);
    expect(`زمان پاسخ ۴۱۲ ${UNIT.fa}`).not.toMatch(FIGURE_THEN_LATIN_MS);
    expect("Response Time (in ms)").not.toMatch(FIGURE_THEN_LATIN_MS);
  });
});
