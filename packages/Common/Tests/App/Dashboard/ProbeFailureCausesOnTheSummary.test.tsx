import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, RenderResult } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import NetworkPathView, {
  NETWORK_PATH_VERDICT_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/NetworkPathView";
import NtpMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/NtpMonitorView";
import PingMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/PingMonitorView";
import ProbeAttemptsView, {
  PROBE_ATTEMPT_FAILURE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/ProbeAttemptsView";
import PortMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/PortMonitorView";
import ProbeMessageLine, {
  PROBE_MESSAGE_LINE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/ProbeMessageLine";
import { SUMMARY_ERROR_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SummaryErrorFacts";
import WebsiteMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/WebsiteMonitorView";
import Hostname from "../../../Types/API/Hostname";
import NetworkPathTrace from "../../../Types/Monitor/NetworkMonitor/NetworkPathTrace";
import NtpMonitorResponse from "../../../Types/Monitor/NtpMonitor/NtpMonitorResponse";
import NtpMonitorUtil from "../../../Types/Monitor/NtpMonitor/NtpMonitorUtil";
import ProbeAttempt from "../../../Types/Probe/ProbeAttempt";
import ObjectID from "../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import { NO_BREAK_SPACE } from "../../../Types/NoBreakSpaces";
import {
  NTP_KISS_CODE_MEANINGS,
  PROBE_FAILURE_CAUSES,
  ProbeFailureCause,
  writeProbeFailureCause,
} from "../../../Utils/Monitor/ProbeFailureCauses";
import ProbeNetworkFailureUtil, {
  ProbeNetworkFailureKind,
} from "../../../Utils/ProbeNetworkFailureUtil";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A CHECK'S ERROR, WITH THE VALUES THE PROBE FOUND, IN THE READER'S
 * LANGUAGE (#8267).
 *
 * The summary's Error drew the probe's own sentences with values in them
 * in English on every page: an NTP server that did not answer in time, a
 * probe that cannot send IPv6 traffic, a connect whose every attempt
 * failed. Drawn through the real summaries now, in German, Spanish, Arabic
 * and Persian they read in the reader's language, every host, address,
 * code and the operating system's own words kept as written - set apart
 * on a page read from the right - and the timeout and the count in the
 * reader's digits. English reads exactly as stored.
 */

type Language = "en" | "de" | "es" | "ar" | "fa";

const LANGUAGES: Array<Language> = ["en", "de", "es", "ar", "fa"];

const RIGHT_TO_LEFT: ReadonlyArray<Language> = ["ar", "fa"];

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

const renderIn: (
  language: Language,
  element: React.ReactElement,
) => RenderResult = (
  language: Language,
  element: React.ReactElement,
): RenderResult => {
  return render(
    <I18nextProvider i18n={instances[language]!}>{element}</I18nextProvider>,
  );
};

// The reader's wording of a cause, its placeholders filled.
const wording: (
  language: Language,
  cause: ProbeFailureCause,
  values: Record<string, string>,
) => string = (
  language: Language,
  cause: ProbeFailureCause,
  values: Record<string, string>,
): string => {
  let text: string = readDashboardLocale(language)[
    PROBE_FAILURE_CAUSES[cause]
  ] as string;

  for (const name of Object.keys(values)) {
    text = text.split(`{{${name}}}`).join(values[name] as string);
  }

  return text;
};

// The line's text, its isolates' marks left out and each no-break space plain.
const plain: (text: string | null) => string = (
  text: string | null,
): string => {
  return withoutIsolateMarks(text || "")
    .split(NO_BREAK_SPACE)
    .join(" ");
};

const response: (
  overrides: Partial<ProbeMonitorResponse>,
) => ProbeMonitorResponse = (
  overrides: Partial<ProbeMonitorResponse>,
): ProbeMonitorResponse => {
  return {
    projectId: new ObjectID("11111111-1111-4111-8111-111111111111"),
    monitorId: new ObjectID("22222222-2222-4222-8222-222222222222"),
    monitorStepId: new ObjectID("33333333-3333-4333-8333-333333333333"),
    probeId: new ObjectID("44444444-4444-4444-8444-444444444444"),
    isOnline: false,
    monitoredAt: new Date(Date.UTC(2026, 10, 15, 9, 30)),
    ...overrides,
  } as ProbeMonitorResponse;
};

const IPV6_DETAIL: string =
  "connect EADDRNOTAVAIL 2001:db8::7:443 - Local (:::0)";

// What a Website check against an IPv6-only host stores on a probe with no IPv6.
const IPV6_CAUSE: string = ProbeNetworkFailureUtil.describe({
  host: "2001:db8::7",
  failure: {
    kind: ProbeNetworkFailureKind.NoSourceAddress,
    isCertain: true,
    isCauseAmbiguous: true,
    detail: IPV6_DETAIL,
  },
});

// What an NTP check stores when the server never answers, after 4 tries.
const NTP_CAUSE: string = writeProbeFailureCause(ProbeFailureCause.TriedTimes, {
  cause: writeProbeFailureCause(ProbeFailureCause.NtpNoReply, {
    target: "192.0.2.10:123",
    timeoutInMs: 5000,
  }),
  count: 4,
});

// What a Port check stores when every address it tried refused.
const PORT_ATTEMPTS: string =
  "Error: connect ECONNREFUSED ::1:5432; Error: connect ECONNREFUSED 127.0.0.1:5432";
const PORT_CAUSE: string = writeProbeFailureCause(
  ProbeFailureCause.AllConnectionAttemptsFailedWithAttempts,
  { error: "AggregateError", attempts: PORT_ATTEMPTS },
);

const NTP_SILENT: NtpMonitorResponse = {
  isOnline: false,
  isSynchronized: false,
  responseTimeInMs: 0,
  failureCause: NTP_CAUSE,
  isTimeout: true,
  serverAddress: "192.0.2.10",
  port: 123,
} as NtpMonitorResponse;

describe("what the causes are, as the probe stores them", () => {
  test("the English the checks wrote by hand, byte for byte", () => {
    expect(IPV6_CAUSE).toBe(
      `This probe could not open an IPv6 connection from its own side (${IPV6_DETAIL}), so 2001:db8::7 was never contacted. This usually means the probe has no usable IPv6 address or route (less often, that it has run out of local ports); this says nothing about whether 2001:db8::7 is up. Monitor IPv6 destinations from a probe that has IPv6 connectivity.`,
    );
    expect(NTP_CAUSE).toBe(
      "No NTP reply from 192.0.2.10:123 within 5 seconds. Tried 4 times.",
    );
    expect(PORT_CAUSE).toBe(
      `Request failed with AggregateError (all connection attempts failed). AggregateError. Attempts: ${PORT_ATTEMPTS}`,
    );
  });
});

describe.each(LANGUAGES)(
  "a Website check's Error, in %s",
  (language: Language) => {
    test("the probe-side sentence in the reader's words, the host and the OS's words as written", () => {
      const { getByTestId } = renderIn(
        language,
        <WebsiteMonitorView
          probeMonitorResponse={response({
            monitorDestination: "https://[2001:db8::7]/health" as never,
            failureCause: IPV6_CAUSE,
          })}
        />,
      );
      const line: HTMLElement = getByTestId(SUMMARY_ERROR_TEST_ID);

      if (language === "en") {
        expect(line.textContent).toBe(IPV6_CAUSE);

        return;
      }

      expect(plain(line.textContent)).toBe(
        wording(language, ProbeFailureCause.ProbeCouldNotOpenIPv6Connection, {
          detail: IPV6_DETAIL,
          host: "2001:db8::7",
        }),
      );
      // In the page's own language: drawn the page's way.
      expect(line).not.toHaveAttribute("dir");

      if (RIGHT_TO_LEFT.includes(language)) {
        expect(line.textContent).toContain(isolated("2001:db8::7"));
        expect(line.textContent).toContain(isolated(IPV6_DETAIL));
      }
    });
  },
);

describe.each(LANGUAGES)(
  "an NTP check's Error, in %s",
  (language: Language) => {
    test("no reply in the reader's words, the timeout and the count in their digits", () => {
      const { getByTestId } = renderIn(
        language,
        <NtpMonitorView
          probeMonitorResponse={response({
            monitorDestination: new Hostname("time.example.com"),
            failureCause: NTP_CAUSE,
            ntpResponse: NTP_SILENT,
          })}
        />,
      );
      const line: HTMLElement = getByTestId(PROBE_MESSAGE_LINE_TEST_ID);
      const text: string = plain(line.textContent);

      if (language === "en") {
        expect(line.textContent).toBe(NTP_CAUSE);

        return;
      }

      expect(text).toContain("192.0.2.10:123");
      expect(text).not.toContain("No NTP reply");
      expect(text).not.toContain("Tried 4 times");
      expect(text).not.toContain("seconds");
      expect(text).toContain(language === "fa" ? "۴" : "4");
      expect(text).toContain(language === "fa" ? "۵" : "5");
    });
  },
);

describe("an NTP check's Error, word for word", () => {
  test("German", () => {
    const { getByTestId } = renderIn(
      "de",
      <NtpMonitorView
        probeMonitorResponse={response({
          monitorDestination: new Hostname("time.example.com"),
          failureCause: NTP_CAUSE,
          ntpResponse: NTP_SILENT,
        })}
      />,
    );

    expect(plain(getByTestId(PROBE_MESSAGE_LINE_TEST_ID).textContent)).toBe(
      "Innerhalb von 5 Sek. kam keine NTP-Antwort von 192.0.2.10:123. 4-mal versucht.",
    );
  });

  test("Persian", () => {
    const { getByTestId } = renderIn(
      "fa",
      <NtpMonitorView
        probeMonitorResponse={response({
          monitorDestination: new Hostname("time.example.com"),
          failureCause: NTP_CAUSE,
          ntpResponse: NTP_SILENT,
        })}
      />,
    );
    const line: HTMLElement = getByTestId(PROBE_MESSAGE_LINE_TEST_ID);

    expect(line.textContent).toContain(isolated("192.0.2.10:123"));
    expect(plain(line.textContent)).toBe(
      "در ۵ ثانیه هیچ پاسخ NTP از 192.0.2.10:123 نیامد. ۴ بار امتحان شد.",
    );
  });
});

describe.each(LANGUAGES)(
  "a Port check's Error, in %s",
  (language: Language) => {
    test("the AggregateError sentence in the reader's words, every attempt as the runtime wrote it", () => {
      const { getByTestId } = renderIn(
        language,
        <PortMonitorView
          probeMonitorResponse={response({
            monitorDestination: "db.example.com" as never,
            failureCause: PORT_CAUSE,
          })}
        />,
      );
      const line: HTMLElement = getByTestId(SUMMARY_ERROR_TEST_ID);

      if (language === "en") {
        expect(line.textContent).toBe(PORT_CAUSE);

        return;
      }

      expect(plain(line.textContent)).toBe(
        wording(
          language,
          ProbeFailureCause.AllConnectionAttemptsFailedWithAttempts,
          { error: "AggregateError", attempts: PORT_ATTEMPTS },
        ),
      );
      expect(plain(line.textContent)).not.toContain("all connection attempts");
    });
  },
);

describe("a cause no probe writes today, or one edited", () => {
  test.each(LANGUAGES)(
    "in %s: as written, in a line of its own direction",
    (language: Language) => {
      const newer: string =
        "No NTP reply from 192.0.2.10:123 within 5 seconds, then a reset.";
      const { getByTestId } = renderIn(
        language,
        <ProbeMessageLine message={newer} />,
      );
      const line: HTMLElement = getByTestId(PROBE_MESSAGE_LINE_TEST_ID);

      expect(line.textContent).toBe(newer);
      expect(line.getAttribute("dir")).toBe(
        RIGHT_TO_LEFT.includes(language) ? "ltr" : null,
      );
    },
  );
});

/*
 * #8656: an NTP server that answered but is not synchronized, the Ping
 * check's own messages, a traceroute that could not run, and a Website
 * attempt the server answered with an error.
 */
const MONITOR_ID: string = "22222222-2222-4222-8222-222222222222";

const KISS_CAUSE: string = NtpMonitorUtil.describeWhyNotSynchronized(
  { isSynchronized: false, stratum: 0, kissCode: "DENY" },
  true,
);

const PING_CAUSE: string = `Error: ${writeProbeFailureCause(
  ProbeFailureCause.PingUnableToReachHost,
  {
    host: "192.0.2.10",
    cause: writeProbeFailureCause(ProbeFailureCause.PingNoEchoReply, {
      host: "192.0.2.10",
      count: 5,
    }),
    monitorId: MONITOR_ID,
  },
)}`;

const TRACEROUTE_CAUSE: string = writeProbeFailureCause(
  ProbeFailureCause.TracerouteCouldNotRun,
  {
    clause: writeProbeFailureCause(ProbeFailureCause.ClauseCannotSendIPv6, {
      detail: "connect: Cannot assign requested address",
    }),
  },
);

describe("the other causes, as the checks store them (#8656)", () => {
  test("byte for byte as written by hand", () => {
    expect(KISS_CAUSE).toBe(
      "The server answered with a kiss-o'-death (DENY): the server denies access to this probe.",
    );
    expect(PING_CAUSE).toBe(
      `Error: Unable to reach host 192.0.2.10. No ICMP echo reply from 192.0.2.10 (5 sent) Monitor ID: ${MONITOR_ID}`,
    );
    expect(TRACEROUTE_CAUSE).toBe(
      "Traceroute could not run: this probe cannot send IPv6 traffic (connect: Cannot assign requested address).",
    );
  });
});

describe.each(LANGUAGES)(
  "the other causes on a summary, in %s",
  (language: Language) => {
    test("an NTP server's kiss-o'-death, its code as sent and its meaning in the reader's words", () => {
      const { getByTestId } = renderIn(
        language,
        <NtpMonitorView
          probeMonitorResponse={response({
            monitorDestination: new Hostname("time.example.com"),
            isOnline: true,
            failureCause: KISS_CAUSE,
            ntpResponse: {
              isOnline: true,
              isSynchronized: false,
              responseTimeInMs: 12,
              failureCause: KISS_CAUSE,
              isTimeout: false,
              port: 123,
              stratum: 0,
              kissCode: "DENY",
            } as NtpMonitorResponse,
          })}
        />,
      );
      const text: string = plain(
        getByTestId(PROBE_MESSAGE_LINE_TEST_ID).textContent,
      );

      if (language === "en") {
        expect(text).toBe(KISS_CAUSE);

        return;
      }

      const words: Record<string, string> = readDashboardLocale(language);

      expect(text).toContain("DENY");
      expect(text).toContain(
        words[NTP_KISS_CODE_MEANINGS["DENY"] as string] as string,
      );
      expect(text).not.toContain("denies access");
    });

    test("a Ping check's message, through every sentence it holds", () => {
      const { getByTestId } = renderIn(
        language,
        <PingMonitorView
          probeMonitorResponse={response({
            monitorDestination: "192.0.2.10" as never,
            failureCause: PING_CAUSE,
          })}
        />,
      );
      const text: string = plain(
        getByTestId(SUMMARY_ERROR_TEST_ID).textContent,
      );

      if (language === "en") {
        expect(text).toBe(PING_CAUSE);

        return;
      }

      expect(text).toContain("192.0.2.10");
      expect(text).toContain(MONITOR_ID);
      expect(text).not.toContain("Unable to reach host");
      expect(text).not.toContain("No ICMP echo reply");
      expect(text).toContain(language === "fa" ? "۵" : "5");
    });

    test("a traceroute that could not run, under the network path", () => {
      const { getByTestId } = renderIn(
        language,
        <NetworkPathView
          networkPathTrace={
            {
              timestamp: new Date(Date.UTC(2026, 10, 15, 9, 30)),
              traceRoute: {
                hops: [],
                isComplete: false,
                failureMessage: TRACEROUTE_CAUSE,
              },
            } as unknown as NetworkPathTrace
          }
        />,
      );
      const text: string = plain(
        getByTestId(NETWORK_PATH_VERDICT_TEST_ID).textContent,
      );

      expect(text).toContain("connect: Cannot assign requested address");

      if (language === "en") {
        expect(text).toContain(TRACEROUTE_CAUSE);

        return;
      }

      expect(text).not.toContain("Traceroute could not run");
      expect(text).not.toContain("cannot send IPv6 traffic");
    });

    test("an attempt the server answered with an error", () => {
      const stored: string = writeProbeFailureCause(
        ProbeFailureCause.ServerReturned,
        { status: 503 },
      );
      const { getAllByTestId } = renderIn(
        language,
        <ProbeAttemptsView
          attempts={[
            {
              attemptNumber: 1,
              attemptedAt: new Date(Date.UTC(2026, 10, 15, 9, 30)),
              responseReceivedAt: new Date(Date.UTC(2026, 10, 15, 9, 30)),
              responseTimeInMs: 120,
              responseCode: 503,
              isOnline: true,
              failureCause: stored,
            } as ProbeAttempt,
            {
              attemptNumber: 2,
              attemptedAt: new Date(Date.UTC(2026, 10, 15, 9, 30)),
              responseReceivedAt: new Date(Date.UTC(2026, 10, 15, 9, 30)),
              responseTimeInMs: 110,
              responseCode: 503,
              isOnline: true,
              failureCause: stored,
            } as ProbeAttempt,
          ]}
          totalAttempts={2}
        />,
      );
      const lines: Array<string> = getAllByTestId(
        PROBE_ATTEMPT_FAILURE_TEST_ID,
      ).map((line: HTMLElement): string => {
        return plain(line.textContent);
      });

      expect(lines.length).toBeGreaterThan(0);

      for (const line of lines) {
        expect(line).toBe(
          language === "en"
            ? stored
            : (
                readDashboardLocale(language)[
                  PROBE_FAILURE_CAUSES[ProbeFailureCause.ServerReturned]
                ] as string
              ).replace("{{status}}", "503"),
        );
      }
    });
  },
);
