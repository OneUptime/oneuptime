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
import { describeFirstCheck } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/WebsiteDown/WebsiteDownSetup";
import CustomMonitorSummaryView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/CustomMonitorSummaryView";
import DatabaseMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/DatabaseMonitorView";
import DnsMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/DnsMonitorView";
import DnssecMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/DnssecMonitorView";
import DomainMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/DomainMonitorView";
import { getFailureCause } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/ExternalStatusPageMonitorView";
import NtpMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/NtpMonitorView";
import PingMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/PingMonitorView";
import PortMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/PortMonitorView";
import ProbeAttemptsView, {
  PROBE_ATTEMPT_FAILURE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/ProbeAttemptsView";
import { PROBE_MESSAGE_LINE_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/ProbeMessageLine";
import ServerMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/ServerMonitorView";
import SnmpMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SnmpMonitorView";
import SqlMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SqlMonitorView";
import SSLCertificateMonitorView, {
  getSslCheckError,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SSLCertificateMonitorView";
import {
  SUMMARY_ERROR_DETAILS_TEST_ID,
  SUMMARY_ERROR_FACTS_TEST_ID,
  SUMMARY_ERROR_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SummaryErrorFacts";
import { SUMMARY_FACT_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SummaryFacts";
import WebsiteMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/WebsiteMonitorView";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import CustomCodeMonitorResponse from "../../../Types/Monitor/CustomCodeMonitor/CustomCodeMonitorResponse";
import ExternalStatusPageProviderType from "../../../Types/Monitor/ExternalStatusPageProviderType";
import MonitorEvaluationDetails, {
  MonitorEvaluationDetailsVersion,
} from "../../../Types/Monitor/MonitorEvaluationDetails";
import MonitorType from "../../../Types/Monitor/MonitorType";
import NtpMonitorResponse from "../../../Types/Monitor/NtpMonitor/NtpMonitorResponse";
import CertificateRevocationStatus from "../../../Types/Monitor/SSLMonitor/CertificateRevocationStatus";
import SslMonitorResponse from "../../../Types/Monitor/SSLMonitor/SslMonitorResponse";
import ServerMonitorResponse from "../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import ObjectID from "../../../Types/ObjectID";
import ProbeAttempt from "../../../Types/Probe/ProbeAttempt";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import { RequestFailedPhase } from "../../../Types/Probe/RequestFailedDetails";
import { writeProbeTimeoutFailureCause } from "../../../Utils/Monitor/ProbeFailureReading";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A FAILED CHECK'S ERROR, IN THE READER'S LANGUAGE (#7422, #7424).
 *
 * A monitor's summary (its Summary card, Test Monitor's result, Monitoring
 * Logs' View Summary) showed why a check failed as the probe stored it, in
 * English: "Request was tried 3 times and it timed out." on a German page,
 * its full stop and brackets at the wrong end on an Arabic or Persian one,
 * and the request's phase under "Failed At", which most languages read as
 * a time ("Fehlgeschlagen am", "失败时间").
 *
 * Drawn now: the probe's timeout sentence in the reader's language, its
 * count in the reader's digits; the phase under Failed Phase in the
 * reader's word; every other message as written, in a line of its own
 * direction. The probe still stores the same English, which criteria
 * compare.
 */

type Language = "en" | "de" | "ar" | "fa";

const LANGUAGES: Array<Language> = ["en", "de", "ar", "fa"];

const RIGHT_TO_LEFT: ReadonlySet<Language> = new Set<Language>(["ar", "fa"]);

const TIMEOUT: string = writeProbeTimeoutFailureCause(3);

// The timeout sentence as each language words it, three tries.
const TIMEOUT_SENTENCE: Record<Language, string> = {
  en: "Request was tried 3 times and it timed out.",
  de: "Die Anfrage wurde 3-mal versucht und hat das Zeitlimit überschritten.",
  ar: "عدد محاولات الطلب: 3، وانتهت مهلته.",
  fa: "درخواست ۳ بار امتحان شد و مهلت آن تمام شد.",
};

const NETWORK_ERROR: string = "connect ECONNREFUSED 203.0.113.7:443";

const ERROR_DETAILS: string =
  "The server did not answer within the timeout (30 seconds).";

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

const textOf: (element: Element | null | undefined) => string = (
  element: Element | null | undefined,
): string => {
  return withoutIsolateMarks(element?.textContent || "").trim();
};

const wordOf: (language: Language, text: string) => string = (
  language: Language,
  text: string,
): string => {
  return readDashboardLocale(language)[text] || text;
};

// A summary fact's card, found by its title as the language words it.
const factCard: (
  container: HTMLElement,
  language: Language,
  title: string,
) => Element = (
  container: HTMLElement,
  language: Language,
  title: string,
): Element => {
  const worded: string = wordOf(language, title);
  const card: Element | undefined = Array.from(
    container.querySelectorAll(`[data-testid="${SUMMARY_FACT_TEST_ID}"]`),
  ).find((candidate: Element): boolean => {
    return textOf(candidate.firstElementChild) === worded;
  });

  if (!card) {
    throw new Error(`No "${title}" fact in ${language}`);
  }

  return card;
};

const factValue: (
  container: HTMLElement,
  language: Language,
  title: string,
) => string = (
  container: HTMLElement,
  language: Language,
  title: string,
): string => {
  return textOf(factCard(container, language, title).lastElementChild);
};

// The direction a message's line is given: none when it reads as the page.
const expectedDirection: (language: Language) => string | null = (
  language: Language,
): string | null => {
  return RIGHT_TO_LEFT.has(language) ? "ltr" : null;
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
    isOnline: false,
    monitoredAt: MONITORED_AT,
    ...overrides,
  } as ProbeMonitorResponse;
};

const timedOutRequest: ProbeMonitorResponse = probeResponse({
  monitorDestination: "https://shop.example.com/health" as never,
  failureCause: TIMEOUT,
  requestFailedDetails: {
    failedPhase: RequestFailedPhase.RequestTimeout,
    errorCode: "ETIMEDOUT",
    errorDescription: ERROR_DETAILS,
  },
});

describe.each(LANGUAGES)(
  "a request that timed out, in %s",
  (language: Language) => {
    test("Error: the probe's timeout sentence in the reader's language and digits", () => {
      const { getByTestId } = renderIn(
        language,
        <WebsiteMonitorView probeMonitorResponse={timedOutRequest} />,
      );

      expect(textOf(getByTestId(SUMMARY_ERROR_TEST_ID))).toBe(
        TIMEOUT_SENTENCE[language],
      );
      // In the language of the page: no direction of its own.
      expect(getByTestId(SUMMARY_ERROR_TEST_ID)).not.toHaveAttribute("dir");
    });

    test("Failed Phase: the phase in the reader's word, under a name no language reads as a time", () => {
      const { container, getByTestId } = renderIn(
        language,
        <WebsiteMonitorView probeMonitorResponse={timedOutRequest} />,
      );

      expect(factValue(container, language, "Failed Phase")).toBe(
        wordOf(language, RequestFailedPhase.RequestTimeout),
      );
      expect(
        Array.from(
          getByTestId(SUMMARY_ERROR_FACTS_TEST_ID).querySelectorAll(
            `[data-testid="${SUMMARY_FACT_TEST_ID}"]`,
          ),
        ).map((card: Element): string => {
          return textOf(card.firstElementChild);
        }),
      ).toEqual(
        ["Error", "Failed Phase", "Error Code", "Error Details"].map(
          (title: string): string => {
            return wordOf(language, title);
          },
        ),
      );
      expect(readDashboardLocale(language)["Failed At"]).toBeUndefined();
    });

    test("Error Details: as written, in a line of its own direction", () => {
      const { getByTestId } = renderIn(
        language,
        <WebsiteMonitorView probeMonitorResponse={timedOutRequest} />,
      );
      const details: HTMLElement = getByTestId(SUMMARY_ERROR_DETAILS_TEST_ID);

      expect(textOf(details)).toBe(ERROR_DETAILS);
      expect(details.getAttribute("dir")).toBe(expectedDirection(language));
      expect(details.className.split(" ")).toEqual(
        expect.arrayContaining(["block", "break-words"]),
      );
      expect(details.className.split(" ")).not.toContain("break-all");
    });

    test("a network's error: as written, in a line of its own direction", () => {
      const { getByTestId } = renderIn(
        language,
        <WebsiteMonitorView
          probeMonitorResponse={probeResponse({ failureCause: NETWORK_ERROR })}
        />,
      );

      expect(textOf(getByTestId(SUMMARY_ERROR_TEST_ID))).toBe(NETWORK_ERROR);
      expect(getByTestId(SUMMARY_ERROR_TEST_ID).getAttribute("dir")).toBe(
        expectedDirection(language),
      );
    });
  },
);

describe("one try", () => {
  test.each([
    ["en", "Request was tried once and it timed out."],
    [
      "de",
      "Die Anfrage wurde einmal versucht und hat das Zeitlimit überschritten.",
    ],
  ] as Array<[Language, string]>)(
    "in %s: the one form",
    (language: Language, sentence: string) => {
      const { getByTestId } = renderIn(
        language,
        <WebsiteMonitorView
          probeMonitorResponse={probeResponse({
            failureCause: writeProbeTimeoutFailureCause(1),
          })}
        />,
      );

      expect(textOf(getByTestId(SUMMARY_ERROR_TEST_ID))).toBe(sentence);
    },
  );
});

describe("a phase the probe did not name", () => {
  test("is drawn as written", () => {
    const { container } = renderIn(
      "de",
      <WebsiteMonitorView
        probeMonitorResponse={probeResponse({
          failureCause: NETWORK_ERROR,
          requestFailedDetails: {
            failedPhase: "QUIC Handshake" as RequestFailedPhase,
            errorCode: "ECONNREFUSED",
            errorDescription: "",
          },
        })}
      />,
    );

    expect(factValue(container, "de", "Failed Phase")).toBe("QUIC Handshake");
    expect(factValue(container, "de", "Error Details")).toBe("-");
  });
});

interface ErrorView {
  name: string;
  draw: (failureCause: string) => React.ReactElement;
}

const ERROR_VIEWS: Array<ErrorView> = [
  {
    name: "a ping",
    draw: (failureCause: string): React.ReactElement => {
      return (
        <PingMonitorView
          probeMonitorResponse={probeResponse({ failureCause })}
        />
      );
    },
  },
  {
    name: "a port",
    draw: (failureCause: string): React.ReactElement => {
      return (
        <PortMonitorView
          probeMonitorResponse={probeResponse({ failureCause })}
        />
      );
    },
  },
  {
    name: "an SNMP device",
    draw: (failureCause: string): React.ReactElement => {
      return (
        <SnmpMonitorView
          probeMonitorResponse={probeResponse({ failureCause })}
        />
      );
    },
  },
  {
    name: "a DNS name",
    draw: (failureCause: string): React.ReactElement => {
      return (
        <DnsMonitorView
          probeMonitorResponse={probeResponse({ failureCause })}
        />
      );
    },
  },
  {
    name: "a DNSSEC zone",
    draw: (failureCause: string): React.ReactElement => {
      return (
        <DnssecMonitorView
          probeMonitorResponse={probeResponse({ failureCause })}
        />
      );
    },
  },
  {
    name: "a domain",
    draw: (failureCause: string): React.ReactElement => {
      return (
        <DomainMonitorView
          probeMonitorResponse={probeResponse({ failureCause })}
        />
      );
    },
  },
  {
    name: "an NTP server that did not answer",
    draw: (failureCause: string): React.ReactElement => {
      return (
        <NtpMonitorView
          probeMonitorResponse={probeResponse({ failureCause })}
        />
      );
    },
  },
  {
    name: "a SQL query",
    draw: (failureCause: string): React.ReactElement => {
      return (
        <SqlMonitorView
          probeMonitorResponse={probeResponse({ failureCause })}
        />
      );
    },
  },
  {
    name: "a database",
    draw: (failureCause: string): React.ReactElement => {
      return (
        <DatabaseMonitorView
          probeMonitorResponse={probeResponse({ failureCause })}
        />
      );
    },
  },
  {
    name: "an SSL certificate check that reached no certificate",
    draw: (failureCause: string): React.ReactElement => {
      return (
        <SSLCertificateMonitorView
          probeMonitorResponse={probeResponse({
            failureCause,
            sslResponse: {
              isValidCertificate: false,
              certificateValidationError: "",
            },
          })}
        />
      );
    },
  },
  {
    name: "a server",
    draw: (failureCause: string): React.ReactElement => {
      return (
        <ServerMonitorView
          serverMonitorResponse={
            {
              projectId: new ObjectID("11111111-1111-4111-8111-111111111111"),
              monitorId: new ObjectID("22222222-2222-4222-8222-222222222222"),
              hostname: "build-runner-7",
              requestReceivedAt: MONITORED_AT,
              failureCause: failureCause,
            } as unknown as ServerMonitorResponse
          }
        />
      );
    },
  },
];

describe.each(ERROR_VIEWS)("$name: the Error", (view: ErrorView) => {
  test.each(LANGUAGES)(
    "in %s: the timeout sentence in the reader's language",
    (language: Language) => {
      const { container } = renderIn(language, view.draw(TIMEOUT));

      expect(factValue(container, language, "Error")).toBe(
        TIMEOUT_SENTENCE[language],
      );
    },
  );

  test.each(LANGUAGES)(
    "in %s: a network's error as written, in its own direction",
    (language: Language) => {
      const { container } = renderIn(language, view.draw(NETWORK_ERROR));
      const line: Element = factCard(
        container,
        language,
        "Error",
      ).lastElementChild!.querySelector(
        `[data-testid="${PROBE_MESSAGE_LINE_TEST_ID}"], [data-testid="${SUMMARY_ERROR_TEST_ID}"]`,
      )!;

      expect(textOf(line)).toBe(NETWORK_ERROR);
      expect(line.getAttribute("dir")).toBe(expectedDirection(language));
    },
  );
});

describe("an NTP server's stratum, in the reader's digits", () => {
  const answered: (stratum: number) => ProbeMonitorResponse = (
    stratum: number,
  ): ProbeMonitorResponse => {
    return probeResponse({
      isOnline: true,
      monitorDestination: "time.example.com" as never,
      ntpResponse: {
        isOnline: true,
        isSynchronized: stratum < 16,
        responseTimeInMs: 18.4,
        failureCause: "",
        serverAddress: "192.0.2.10",
        port: 123,
        version: 4,
        leapIndicator: 0,
        stratum: stratum,
      } as NtpMonitorResponse,
    });
  };

  test.each([
    ["en", 3, "3 (secondary server)"],
    ["en", 16, "16 (not synchronized)"],
    ["ar", 3, "3 (خادم ثانوي)"],
    ["fa", 3, "۳ (سرور ثانویه)"],
    ["fa", 16, "۱۶ (همگام‌نشده)"],
  ] as Array<[Language, number, string]>)(
    "in %s, stratum %i: %s",
    (language: Language, stratum: number, drawn: string) => {
      const { container } = renderIn(
        language,
        <NtpMonitorView probeMonitorResponse={answered(stratum)} />,
      );

      expect(factValue(container, language, "Stratum")).toBe(drawn);
    },
  );
});

describe("a retried check's attempts", () => {
  const attempts: (failureCause: string) => Array<ProbeAttempt> = (
    failureCause: string,
  ): Array<ProbeAttempt> => {
    return [
      {
        attemptNumber: 1,
        attemptedAt: new Date(Date.UTC(2026, 10, 12, 9, 30, 1)),
        responseReceivedAt: new Date(Date.UTC(2026, 10, 12, 9, 30, 2)),
        responseTimeInMs: 1000,
        isOnline: false,
        failureCause: failureCause,
      },
      {
        attemptNumber: 2,
        attemptedAt: new Date(Date.UTC(2026, 10, 12, 9, 30, 3)),
        responseReceivedAt: new Date(Date.UTC(2026, 10, 12, 9, 30, 4)),
        responseTimeInMs: 120,
        responseCode: 200,
        isOnline: true,
      },
    ];
  };

  test.each(LANGUAGES)(
    "in %s: an attempt's error as written, in its own direction, indented from where the page's lines start",
    (language: Language) => {
      const { getByTestId } = renderIn(
        language,
        <ProbeAttemptsView attempts={attempts(NETWORK_ERROR)} />,
      );
      const failure: HTMLElement = getByTestId(PROBE_ATTEMPT_FAILURE_TEST_ID);
      const indent: Array<string> = (
        failure.parentElement?.className || ""
      ).split(" ");

      expect(textOf(failure)).toBe(NETWORK_ERROR);
      expect(failure.getAttribute("dir")).toBe(expectedDirection(language));
      expect(indent).toContain("ms-4");
      expect(indent).not.toContain("ml-4");
      expect(indent).not.toContain("break-all");
    },
  );

  test("the timeout sentence on an attempt reads in German", () => {
    const { getByTestId } = renderIn(
      "de",
      <ProbeAttemptsView attempts={attempts(TIMEOUT)} />,
    );

    expect(textOf(getByTestId(PROBE_ATTEMPT_FAILURE_TEST_ID))).toBe(
      TIMEOUT_SENTENCE.de,
    );
  });
});

describe("an external status page check's Error (getFailureCause)", () => {
  const PROVIDERS: Array<string | undefined> = [
    ...Object.values(ExternalStatusPageProviderType),
    undefined,
  ];

  test.each(PROVIDERS)(
    "the timeout sentence reads in the reader's language whichever provider was read: %s",
    (provider: string | undefined) => {
      for (const language of LANGUAGES) {
        expect(
          getFailureCause({
            translator: dashboardTranslator(language),
            failureCause: TIMEOUT,
            provider: provider,
          }),
        ).toBe(TIMEOUT_SENTENCE[language]);
      }
    },
  );

  test("any other cause is drawn as written", () => {
    expect(
      getFailureCause({
        translator: dashboardTranslator("de"),
        failureCause: NETWORK_ERROR,
        provider: ExternalStatusPageProviderType.AtlassianStatuspage,
      }),
    ).toBe(NETWORK_ERROR);
  });
});

describe("an incident's or alert's evaluation", () => {
  const evaluation: MonitorEvaluationDetails = {
    version: MonitorEvaluationDetailsVersion,
    monitorType: MonitorType.Website,
    evaluatedAt: MONITORED_AT,
    criteriaId: "criteria-1",
    criteriaName: "Website is down",
    filterCondition: FilterCondition.All,
    filters: [],
    probeName: "US West",
    response: { isOnline: false, failureCause: TIMEOUT },
  } as MonitorEvaluationDetails;

  test.each(LANGUAGES)(
    "in %s: the failure in the reader's language",
    (language: Language) => {
      const { getByTestId } = renderIn(
        language,
        <EventEvaluationDetails details={evaluation} />,
      );

      expect(textOf(getByTestId("evaluation-facts-failure"))).toContain(
        TIMEOUT_SENTENCE[language],
      );
    },
  );
});

describe("the website-down setup's first check", () => {
  test.each([
    [
      "en",
      "example.com did not answer from 1 location: Request was tried 3 times and it timed out.",
    ],
    ["de", TIMEOUT_SENTENCE.de],
    ["fa", TIMEOUT_SENTENCE.fa],
  ] as Array<[Language, string]>)(
    "in %s: why, in the sentence's language",
    (language: Language, reason: string) => {
      const text: string = describeFirstCheck({
        translator: dashboardTranslator(language),
        host: "example.com",
        locationCount: 1,
        answers: [{ isOnline: false, failureCause: TIMEOUT }],
      }).text;

      expect(text).toContain(reason);

      if (language !== "en") {
        expect(text).not.toContain("Request was tried");
      }
    },
  );
});

/*
 * An SSL check's summary drew the certificate's problem (the TLS
 * library's English) as plain text, and never said why a check that
 * reached no certificate failed - a refused or timed-out connection, the
 * probe's timeout sentence - though the probe stores it.
 */
const sslResponse: (
  failureCause: string,
  certificate: Partial<SslMonitorResponse>,
) => ProbeMonitorResponse = (
  failureCause: string,
  certificate: Partial<SslMonitorResponse>,
): ProbeMonitorResponse => {
  return probeResponse({
    monitorDestination: "https://shop.example.com" as never,
    failureCause: failureCause,
    sslResponse: {
      isValidCertificate: false,
      isSelfSigned: false,
      certificateValidationError: "",
      certificateValidationErrorCode: "",
      ...certificate,
    } as SslMonitorResponse,
  });
};

const CERTIFICATE_EXPIRED: string = "certificate has expired";

const factTitles: (container: HTMLElement) => Array<string> = (
  container: HTMLElement,
): Array<string> => {
  return Array.from(
    container.querySelectorAll(`[data-testid="${SUMMARY_FACT_TEST_ID}"]`),
  ).map((card: Element): string => {
    return textOf(card.firstElementChild);
  });
};

describe("an SSL check's Certificate Problem and Error", () => {
  test.each(LANGUAGES)(
    "in %s: a certificate that failed validation says so once, as written, in its own direction",
    (language: Language) => {
      const { container } = renderIn(
        language,
        <SSLCertificateMonitorView
          probeMonitorResponse={sslResponse(CERTIFICATE_EXPIRED, {
            certificateValidationError: CERTIFICATE_EXPIRED,
            certificateValidationErrorCode: "CERT_HAS_EXPIRED",
          })}
        />,
      );
      const line: Element = factCard(
        container,
        language,
        "Certificate Problem",
      ).querySelector(`[data-testid="${PROBE_MESSAGE_LINE_TEST_ID}"]`)!;

      expect(textOf(line)).toBe(CERTIFICATE_EXPIRED);
      expect(line.getAttribute("dir")).toBe(expectedDirection(language));
      // The same problem is not said again as the check's Error.
      expect(factTitles(container)).not.toContain(wordOf(language, "Error"));
    },
  );

  test.each(LANGUAGES)(
    "in %s: a check that timed out says why, in the reader's language",
    (language: Language) => {
      const { container } = renderIn(
        language,
        <SSLCertificateMonitorView
          probeMonitorResponse={sslResponse(TIMEOUT, {})}
        />,
      );

      expect(factValue(container, language, "Error")).toBe(
        TIMEOUT_SENTENCE[language],
      );
      expect(factTitles(container)).not.toContain(
        wordOf(language, "Certificate Problem"),
      );
    },
  );

  test("a connection that failed after the certificate did shows both, each once", () => {
    const { container } = renderIn(
      "de",
      <SSLCertificateMonitorView
        probeMonitorResponse={sslResponse(NETWORK_ERROR, {
          certificateValidationError: CERTIFICATE_EXPIRED,
          certificateValidationErrorCode: "CERT_HAS_EXPIRED",
        })}
      />,
    );

    expect(factValue(container, "de", "Certificate Problem")).toBe(
      CERTIFICATE_EXPIRED,
    );
    expect(factValue(container, "de", "Error")).toBe(NETWORK_ERROR);
  });

  test("a valid certificate shows neither", () => {
    const { container } = renderIn(
      "en",
      <SSLCertificateMonitorView
        probeMonitorResponse={sslResponse("", {
          isValidCertificate: true,
        })}
      />,
    );

    expect(factTitles(container)).not.toContain("Error");
    expect(factTitles(container)).not.toContain("Certificate Problem");
  });

  test.each(LANGUAGES)(
    "in %s: the Revocation Check Problem under Show More Details reads in its own direction",
    (language: Language) => {
      const problem: string =
        "The issuer's OCSP responder did not answer (timeout).";
      const { container, getByRole } = renderIn(
        language,
        <SSLCertificateMonitorView
          probeMonitorResponse={sslResponse("", {
            isValidCertificate: true,
            revocationStatus: CertificateRevocationStatus.Unknown,
            revocationCheckError: problem,
          })}
        />,
      );

      fireEvent.click(getByRole("button"));

      const line: Element = factCard(
        container,
        language,
        "Revocation Check Problem",
      ).querySelector(`[data-testid="${PROBE_MESSAGE_LINE_TEST_ID}"]`)!;

      expect(textOf(line)).toBe(problem);
      expect(line.getAttribute("dir")).toBe(expectedDirection(language));
    },
  );
});

describe("getSslCheckError", () => {
  test.each([
    ["a timeout, no certificate problem", TIMEOUT, "", TIMEOUT],
    [
      "a failure cause that is the certificate problem",
      CERTIFICATE_EXPIRED,
      CERTIFICATE_EXPIRED,
      "",
    ],
    [
      "the same problem with space round it",
      ` ${CERTIFICATE_EXPIRED}\n`,
      CERTIFICATE_EXPIRED,
      "",
    ],
    [
      "a connection failure after a certificate problem",
      NETWORK_ERROR,
      CERTIFICATE_EXPIRED,
      NETWORK_ERROR,
    ],
    ["no failure", "", "", ""],
  ])(
    "%s",
    (
      _name: string,
      failureCause: string,
      certificateValidationError: string,
      expected: string,
    ) => {
      expect(
        getSslCheckError({
          failureCause: failureCause,
          certificateValidationError: certificateValidationError,
        }),
      ).toBe(expected);
    },
  );

  test("an older response with neither field shows nothing", () => {
    expect(
      getSslCheckError({
        failureCause: undefined,
        certificateValidationError: undefined,
      }),
    ).toBe("");
  });
});

describe("a custom code script's error", () => {
  const SCRIPT_ERROR: string =
    "TypeError: Cannot read properties of undefined (reading 'status').";

  const run: CustomCodeMonitorResponse = {
    result: undefined,
    logMessages: [],
    capturedMetrics: [],
    executionTimeInMS: 412,
    scriptError: SCRIPT_ERROR,
    totalAttempts: 2,
    retryAttempts: [
      { attemptNumber: 1, executionTimeInMS: 400, scriptError: SCRIPT_ERROR },
      { attemptNumber: 2, executionTimeInMS: 412, scriptError: SCRIPT_ERROR },
    ],
  };

  test.each(LANGUAGES)(
    "in %s: the Error as written, in its own direction",
    (language: Language) => {
      const { container } = renderIn(
        language,
        <CustomMonitorSummaryView
          customCodeMonitorResponse={run}
          monitoredAt={MONITORED_AT}
          probeName="US West"
        />,
      );
      const line: Element = factCard(
        container,
        language,
        "Error",
      ).querySelector(`[data-testid="${PROBE_MESSAGE_LINE_TEST_ID}"]`)!;

      expect(textOf(line)).toBe(SCRIPT_ERROR);
      expect(line.getAttribute("dir")).toBe(expectedDirection(language));
    },
  );

  test.each(LANGUAGES)(
    "in %s: each attempt's error in its own direction, indented from where the page's lines start",
    (language: Language) => {
      const { getAllByTestId, getByRole } = renderIn(
        language,
        <CustomMonitorSummaryView
          customCodeMonitorResponse={run}
          monitoredAt={MONITORED_AT}
          probeName="US West"
        />,
      );

      fireEvent.click(getByRole("button"));

      const failures: Array<HTMLElement> = getAllByTestId(
        "custom-monitor-attempt-error",
      );

      expect(failures).toHaveLength(2);

      for (const failure of failures) {
        const indent: Array<string> = (
          failure.parentElement?.className || ""
        ).split(" ");

        expect(textOf(failure)).toBe(SCRIPT_ERROR);
        expect(failure.getAttribute("dir")).toBe(expectedDirection(language));
        expect(indent).toContain("ms-4");
        expect(indent).not.toContain("ml-4");
        expect(indent).not.toContain("break-all");
      }
    },
  );
});
