import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, RenderResult } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import NtpMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/NtpMonitorView";
import PortMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/PortMonitorView";
import ProbeMessageLine, {
  PROBE_MESSAGE_LINE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/ProbeMessageLine";
import { SUMMARY_ERROR_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SummaryErrorFacts";
import WebsiteMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/WebsiteMonitorView";
import Hostname from "../../../Types/API/Hostname";
import NtpMonitorResponse from "../../../Types/Monitor/NtpMonitor/NtpMonitorResponse";
import ObjectID from "../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import { NO_BREAK_SPACE } from "../../../Types/NoBreakSpaces";
import {
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

const IPV6_DETAIL: string = "connect EADDRNOTAVAIL 2001:db8::7:443 - Local (:::0)";

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

describe.each(LANGUAGES)("a Website check's Error, in %s", (language: Language) => {
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
});

describe.each(LANGUAGES)("an NTP check's Error, in %s", (language: Language) => {
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
});

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

describe.each(LANGUAGES)("a Port check's Error, in %s", (language: Language) => {
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
});

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
