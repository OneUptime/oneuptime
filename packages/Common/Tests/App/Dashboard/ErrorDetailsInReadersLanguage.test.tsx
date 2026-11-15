import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, RenderResult } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import PortMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/PortMonitorView";
import ProbeMessageLine from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/ProbeMessageLine";
import { SUMMARY_ERROR_DETAILS_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SummaryErrorFacts";
import WebsiteMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/WebsiteMonitorView";
import ObjectID from "../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import { RequestFailedPhase } from "../../../Types/Probe/RequestFailedDetails";
import {
  getProbeMessageText,
  writeProbeTimeoutFailureCause,
} from "../../../Utils/Monitor/ProbeFailureReading";
import {
  REQUEST_FAILURE_DESCRIPTIONS,
  RequestFailureDescription,
  writeRequestFailureDescription,
} from "../../../Utils/Monitor/RequestFailureDescriptions";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A FAILED REQUEST'S ERROR DETAILS, IN THE READER'S LANGUAGE (#8001).
 *
 * A Website, API or Port summary's Error Details said what the failure
 * means in OneUptime's own fixed English ("Connection refused. The server
 * actively refused the connection. ..."), on every page. It reads in the
 * reader's language now, any message that came with it kept as written
 * and set apart; any other text - a newer probe's - stays as written, in a
 * line of its own direction.
 */

type Language = "en" | "de" | "ar" | "fa";

const LANGUAGES: Array<Language> = ["en", "de", "ar", "fa"];

const CONNECTION_REFUSED: string = writeRequestFailureDescription(
  RequestFailureDescription.ConnectionRefused,
);

const RAW_MESSAGE: string = "Invalid URL: htp://shop.example.com";

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

const probeResponse: (
  errorDescription: string,
  overrides?: Partial<ProbeMonitorResponse>,
) => ProbeMonitorResponse = (
  errorDescription: string,
  overrides: Partial<ProbeMonitorResponse> = {},
): ProbeMonitorResponse => {
  return {
    projectId: new ObjectID("11111111-1111-4111-8111-111111111111"),
    monitorId: new ObjectID("22222222-2222-4222-8222-222222222222"),
    monitorStepId: new ObjectID("33333333-3333-4333-8333-333333333333"),
    probeId: new ObjectID("44444444-4444-4444-8444-444444444444"),
    isOnline: false,
    monitoredAt: new Date(Date.UTC(2026, 10, 15, 9, 30)),
    monitorDestination: "https://shop.example.com/health" as never,
    failureCause: "connect ECONNREFUSED 203.0.113.7:443",
    requestFailedDetails: {
      failedPhase: RequestFailedPhase.TCPConnection,
      errorCode: "ECONNREFUSED",
      errorDescription: errorDescription,
    },
    ...overrides,
  } as ProbeMonitorResponse;
};

const wordOf: (language: Language, text: string) => string = (
  language: Language,
  text: string,
): string => {
  return readDashboardLocale(language)[text] || text;
};

describe.each(LANGUAGES)(
  "a Website check's Error Details, in %s",
  (language: Language) => {
    test("the explanation in the reader's language, read the page's way", () => {
      const { getByTestId } = renderIn(
        language,
        <WebsiteMonitorView
          probeMonitorResponse={probeResponse(CONNECTION_REFUSED)}
        />,
      );
      const details: HTMLElement = getByTestId(SUMMARY_ERROR_DETAILS_TEST_ID);

      expect(details.textContent).toBe(wordOf(language, CONNECTION_REFUSED));
      // In the page's language: no direction of its own.
      expect(details).not.toHaveAttribute("dir");
    });

    test("an HTTP status as the server sent it", () => {
      const stored: string = writeRequestFailureDescription(
        RequestFailureDescription.HttpServerError,
        { status: 503 },
      );
      const { getByTestId } = renderIn(
        language,
        <WebsiteMonitorView probeMonitorResponse={probeResponse(stored)} />,
      );
      const text: string = withoutIsolateMarks(
        getByTestId(SUMMARY_ERROR_DETAILS_TEST_ID).textContent || "",
      );

      expect(text).toBe(
        wordOf(
          language,
          REQUEST_FAILURE_DESCRIPTIONS[
            RequestFailureDescription.HttpServerError
          ],
        ).replace("{{status}}", "503"),
      );
    });
  },
);

describe("an explanation that came with a message", () => {
  const stored: string = writeRequestFailureDescription(
    RequestFailureDescription.InvalidTarget,
    { message: RAW_MESSAGE },
  );

  test.each(["ar", "fa"] as Array<Language>)(
    "in %s: the message kept as written, set apart from the reader's words",
    (language: Language) => {
      const { getByTestId } = renderIn(
        language,
        <WebsiteMonitorView probeMonitorResponse={probeResponse(stored)} />,
      );
      const details: HTMLElement = getByTestId(SUMMARY_ERROR_DETAILS_TEST_ID);

      expect(details.textContent).toContain(isolated(RAW_MESSAGE));
      expect(details.textContent).not.toContain("The monitor's target");
      expect(details).not.toHaveAttribute("dir");
    },
  );

  test("in English: as stored, nothing set apart", () => {
    const { getByTestId } = renderIn(
      "en",
      <WebsiteMonitorView probeMonitorResponse={probeResponse(stored)} />,
    );

    expect(getByTestId(SUMMARY_ERROR_DETAILS_TEST_ID).textContent).toBe(stored);
  });
});

describe("a newer probe's Error Details, no explanation of the table's", () => {
  const NEWER: string = "The QUIC handshake did not finish (0-RTT rejected).";

  test.each(LANGUAGES)("in %s: as written", (language: Language) => {
    const { getByTestId } = renderIn(
      language,
      <WebsiteMonitorView probeMonitorResponse={probeResponse(NEWER)} />,
    );
    const details: HTMLElement = getByTestId(SUMMARY_ERROR_DETAILS_TEST_ID);

    expect(details.textContent).toBe(NEWER);
    expect(details.getAttribute("dir")).toBe(
      language === "ar" || language === "fa" ? "ltr" : null,
    );
  });
});

describe("a Port check's Error Details", () => {
  const stored: string = writeRequestFailureDescription(
    RequestFailureDescription.PortTcpConnectionFailed,
  );

  test.each(["de", "fa"] as Array<Language>)(
    "in %s: the explanation in the reader's language",
    (language: Language) => {
      const { getByTestId } = renderIn(
        language,
        <PortMonitorView
          probeMonitorResponse={probeResponse(stored, {
            monitorDestination: "db.example.com" as never,
          })}
        />,
      );

      expect(getByTestId(SUMMARY_ERROR_DETAILS_TEST_ID).textContent).toBe(
        wordOf(language, stored),
      );
    },
  );
});

describe("a probe's message, as a summary draws it (getProbeMessageText)", () => {
  test("the timeout sentence still reads in the reader's language", () => {
    expect(
      getProbeMessageText({
        translator: dashboardTranslator("de"),
        message: writeProbeTimeoutFailureCause(3),
      }),
    ).toBe(
      "Die Anfrage wurde 3-mal versucht und hat das Zeitlimit überschritten.",
    );
  });

  test("an explanation reads in the reader's language, its message set apart", () => {
    const text: string = getProbeMessageText({
      translator: dashboardTranslator("fa"),
      message: ` Request failed: ${RAW_MESSAGE}\n`,
    });

    expect(text).toContain(isolated(RAW_MESSAGE));
    expect(text).not.toContain("Request failed");
  });

  test("any other message: as written, trimmed", () => {
    expect(
      getProbeMessageText({
        translator: dashboardTranslator("fa"),
        message: "  connect ECONNREFUSED 203.0.113.7:443 ",
      }),
    ).toBe("connect ECONNREFUSED 203.0.113.7:443");
    expect(
      getProbeMessageText({
        translator: dashboardTranslator("fa"),
        message: undefined,
      }),
    ).toBe("");
  });

  test("ProbeMessageLine draws an explanation wherever a summary shows one", () => {
    const { container } = renderIn(
      "de",
      <ProbeMessageLine message={CONNECTION_REFUSED} />,
    );

    expect(container.textContent).toBe(wordOf("de", CONNECTION_REFUSED));
  });
});
