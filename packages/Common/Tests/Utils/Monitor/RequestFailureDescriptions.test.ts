import { describe, expect, test } from "@jest/globals";
import { createTranslator, Translator } from "../../../Types/Translator";
import {
  getRequestFailureDescriptionText,
  readRequestFailureDescription,
  REQUEST_FAILURE_DESCRIPTIONS,
  RequestFailureDescription,
  RequestFailureDescriptionReading,
  writeRequestFailureDescription,
} from "../../../Utils/Monitor/RequestFailureDescriptions";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * WHAT A FAILED REQUEST MEANS, IN THE READER'S LANGUAGE (#8001).
 *
 * A Website or API summary's Error Details, and the root cause's "- Error
 * Description:", are a fixed English explanation of OneUptime's own ("DNS
 * resolution failed. ...", "Connection refused. ..."), written by hand in
 * API.getRequestFailedDetails, the Port check and the NTP check, and drawn
 * in English in every language. Every one is written from one table now,
 * word for word as before (criteria, root causes and logs compare it), read
 * back only on an exact match, and drawn in the reader's language.
 */

// Each explanation as the probe wrote it by hand before the table.
const WRITTEN_BY_HAND: Record<RequestFailureDescription, string> = {
  [RequestFailureDescription.InvalidTarget]:
    "The monitor's target is not a valid HTTP or HTTPS destination, so no request was attempted. {{message}}",
  [RequestFailureDescription.TargetUnreachable]:
    "The probe could not obtain a usable network address for this host, so no connection was attempted and the target was never contacted. Either DNS did not answer, answered with no records, or returned an address this probe is not allowed to dial. Check that the hostname resolves publicly and that its authoritative nameservers are healthy. If this monitor targets an internal host, run it from a self-hosted probe with PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true.",
  [RequestFailureDescription.ProbeCouldNotConnect]:
    "The probe could not open the connection from its own side, so the request was never sent and the server was never contacted. The failure is on the probe, not on the server.",
  [RequestFailureDescription.ProbeCouldNotConnectOverIPv6]:
    "The probe could not open the IPv6 connection from its own side, so the request was never sent and the server was never contacted. The failure is on the probe, not on the server.",
  [RequestFailureDescription.ProbeCannotSendIPv6]:
    "The probe cannot send IPv6 traffic, so the request was never sent and the server was never contacted. The failure is on the probe, not on the server.",
  [RequestFailureDescription.NoIPv6Route]:
    "There was no IPv6 route to the server. Most likely the probe has no IPv6 route rather than the server being down.",
  [RequestFailureDescription.NetworkUnreachable]:
    "Network unreachable. There is no route to the network where the server resides. This is typically a routing or connectivity issue.",
  [RequestFailureDescription.DnsResolutionFailed]:
    "DNS resolution failed. The hostname could not be resolved to an IP address. Please verify the hostname is correct and that DNS is working properly.",
  [RequestFailureDescription.ConnectionRefused]:
    "Connection refused. The server actively refused the connection. This usually means no service is listening on the specified port, or a firewall is blocking the connection.",
  [RequestFailureDescription.ConnectionReset]:
    "Connection reset. The connection was forcibly closed by the server or a network device. This can happen due to server restarts, load balancer timeouts, or network issues.",
  [RequestFailureDescription.ConnectionAborted]:
    "Connection aborted. The request was aborted, possibly due to a timeout or the connection being closed unexpectedly.",
  [RequestFailureDescription.RequestTimedOut]:
    "Request timed out. The server did not respond within the allowed time. This could be due to network latency, server overload, or the server being unresponsive.",
  [RequestFailureDescription.CertificateRevoked]:
    "SSL certificate has been revoked. The certificate's issuer has withdrawn it, so browsers refuse it even though it has not expired. Install a new certificate on the server.",
  [RequestFailureDescription.CertificateExpired]:
    "SSL certificate has expired. The server's SSL certificate is no longer valid. The certificate needs to be renewed.",
  [RequestFailureDescription.SelfSignedCertificate]:
    "Self-signed certificate detected. The server is using a self-signed SSL certificate that is not trusted by default. Consider using a certificate from a trusted Certificate Authority.",
  [RequestFailureDescription.CertificateUnknownAuthority]:
    "SSL certificate signed by unknown authority. The certificate chain could not be verified against known Certificate Authorities.",
  [RequestFailureDescription.TlsHandshakeFailed]:
    "TLS/SSL handshake failed. There was an error establishing a secure connection to the server. This could be due to certificate issues, protocol mismatches, or the server not supporting HTTPS.",
  [RequestFailureDescription.NetworkError]:
    "Network error occurred. Unable to reach the server due to network connectivity issues. Please check your network connection and ensure the server is accessible.",
  [RequestFailureDescription.HostUnreachable]:
    "Host unreachable. The network path to the server could not be found. This may be due to routing issues or the host being offline.",
  [RequestFailureDescription.HttpStatus]:
    "Server responded with HTTP status {{status}}.",
  [RequestFailureDescription.HttpServerError]:
    "Server responded with HTTP status {{status}}. This indicates a server-side error.",
  [RequestFailureDescription.HttpNotFound]:
    "Server responded with HTTP status {{status}}. The requested resource was not found.",
  [RequestFailureDescription.HttpForbidden]:
    "Server responded with HTTP status {{status}}. Access to the resource is forbidden.",
  [RequestFailureDescription.HttpUnauthorized]:
    "Server responded with HTTP status {{status}}. Authentication is required or has failed.",
  [RequestFailureDescription.HttpBadRequest]:
    "Server responded with HTTP status {{status}}. The request was malformed or invalid.",
  [RequestFailureDescription.HttpClientError]:
    "Server responded with HTTP status {{status}}. This indicates a client-side error.",
  [RequestFailureDescription.NoResponse]:
    "No response received from the server. The request was sent but no response was returned. This could indicate the server is down, unreachable, or the request timed out.",
  [RequestFailureDescription.RequestFailed]: "Request failed: {{message}}",
  [RequestFailureDescription.PortProbeCouldNotConnect]:
    "The probe could not open the TCP connection from its own side, so the destination port was never contacted. The failure is on the probe, not on the destination.",
  [RequestFailureDescription.PortProbeCouldNotConnectOverIPv6]:
    "The probe could not open the IPv6 connection from its own side, so the TCP connection was never attempted and the destination port was never contacted. The failure is on the probe, not on the destination.",
  [RequestFailureDescription.PortProbeCannotSendIPv6]:
    "The probe cannot send IPv6 traffic, so the TCP connection was never attempted and the destination port was never contacted. The failure is on the probe, not on the destination.",
  [RequestFailureDescription.PortNoIPv6Route]:
    "There was no IPv6 route for the TCP connection. Most likely the probe has no IPv6 route rather than the destination being down.",
  [RequestFailureDescription.PortDnsResolutionFailed]:
    "DNS resolution failed before a TCP connection could be attempted.",
  [RequestFailureDescription.PortConnectionTimedOut]:
    "The DNS and TCP connection attempt did not finish before the deadline.",
  [RequestFailureDescription.PortTcpConnectionFailed]:
    "TCP connection establishment failed before the port could be reached.",
  [RequestFailureDescription.PortNetworkError]:
    "The port check failed because of a network error.",
  [RequestFailureDescription.NtpLookupTimedOut]:
    "The DNS lookup of the NTP server did not finish before the timeout.",
  [RequestFailureDescription.NtpNoReply]:
    "The request was sent, but no NTP reply came back before the timeout. A firewall dropping UDP port 123, a server that is down, or a server that only answers some networks all look like this.",
  [RequestFailureDescription.NtpNameDidNotResolve]:
    "The NTP server's name did not resolve to an address, so no request was sent.",
  [RequestFailureDescription.NtpPortUnreachable]:
    "The host is reachable, but answered that no service listens on this UDP port: the NTP daemon is stopped, or listens on another port.",
  [RequestFailureDescription.NtpProbeCouldNotSend]:
    "The probe could not send the request from its own side, so the NTP server was never contacted. The failure is on the probe, not on the server.",
  [RequestFailureDescription.NtpNetworkError]:
    "The NTP check failed because of a network error.",
};

// The HTTP status sentence as API.getRequestFailedDetails built it by hand.
const httpStatusByHand: (status: number) => string = (
  status: number,
): string => {
  let description: string = `Server responded with HTTP status ${status}.`;

  if (status >= 500) {
    description += " This indicates a server-side error.";
  } else if (status === 404) {
    description += " The requested resource was not found.";
  } else if (status === 403) {
    description += " Access to the resource is forbidden.";
  } else if (status === 401) {
    description += " Authentication is required or has failed.";
  } else if (status === 400) {
    description += " The request was malformed or invalid.";
  } else if (status >= 400) {
    description += " This indicates a client-side error.";
  }

  return description;
};

const DESCRIPTIONS: Array<RequestFailureDescription> = Object.values(
  RequestFailureDescription,
);

const FIXED: Array<RequestFailureDescription> = DESCRIPTIONS.filter(
  (description: RequestFailureDescription): boolean => {
    return !REQUEST_FAILURE_DESCRIPTIONS[description].includes("{{");
  },
);

const WITH_STATUS: Array<RequestFailureDescription> = DESCRIPTIONS.filter(
  (description: RequestFailureDescription): boolean => {
    return REQUEST_FAILURE_DESCRIPTIONS[description].includes("{{status}}");
  },
);

const WITH_MESSAGE: Array<RequestFailureDescription> = DESCRIPTIONS.filter(
  (description: RequestFailureDescription): boolean => {
    return REQUEST_FAILURE_DESCRIPTIONS[description].includes("{{message}}");
  },
);

const RAW_MESSAGE: string =
  "Invalid URL: htp://shop.example.com (ERR_INVALID_URL)";

const LANGUAGES_SHOWN: Array<string> = ["de", "fr", "ru", "zh-CN", "ar", "fa"];

describe("the table", () => {
  test("holds every explanation the probe wrote by hand, word for word", () => {
    expect(REQUEST_FAILURE_DESCRIPTIONS).toEqual(WRITTEN_BY_HAND);
  });

  test("each explanation is a key of its own", () => {
    const englishes: Array<string> = Object.values(
      REQUEST_FAILURE_DESCRIPTIONS,
    );

    expect(new Set(englishes).size).toBe(englishes.length);
  });

  test("the explanations with a value carry exactly one", () => {
    expect(WITH_STATUS).toHaveLength(7);
    expect(WITH_MESSAGE).toEqual([
      RequestFailureDescription.InvalidTarget,
      RequestFailureDescription.RequestFailed,
    ]);

    for (const description of [...WITH_STATUS, ...WITH_MESSAGE]) {
      expect(
        placeholdersOf(REQUEST_FAILURE_DESCRIPTIONS[description]),
      ).toHaveLength(1);
    }
  });

  test("every explanation is in the Dashboard's English, as the extractor finds it", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const description of DESCRIPTIONS) {
      const key: string = REQUEST_FAILURE_DESCRIPTIONS[description];

      expect({ description, english: english[key] }).toEqual({
        description,
        english: key,
      });
    }
  });
});

describe("the explanation the probe stores", () => {
  test.each(FIXED)(
    "%s: word for word the English it always wrote",
    (id: RequestFailureDescription) => {
      expect(writeRequestFailureDescription(id)).toBe(WRITTEN_BY_HAND[id]);
    },
  );

  test.each([
    100, 200, 204, 301, 302, 304, 399, 400, 401, 402, 403, 404, 405, 418, 429,
    451, 499, 500, 502, 503, 504, 599,
  ])(
    "an HTTP %i: the sentence API.getRequestFailedDetails built by hand",
    (status: number) => {
      const id: RequestFailureDescription =
        status >= 500
          ? RequestFailureDescription.HttpServerError
          : status === 404
            ? RequestFailureDescription.HttpNotFound
            : status === 403
              ? RequestFailureDescription.HttpForbidden
              : status === 401
                ? RequestFailureDescription.HttpUnauthorized
                : status === 400
                  ? RequestFailureDescription.HttpBadRequest
                  : status >= 400
                    ? RequestFailureDescription.HttpClientError
                    : RequestFailureDescription.HttpStatus;

      expect(writeRequestFailureDescription(id, { status: status })).toBe(
        httpStatusByHand(status),
      );
    },
  );

  test.each([
    RAW_MESSAGE,
    "Unknown error",
    "",
    "a $& and $1 in it, {{message}} and {{status}} too",
    "line one\nline two",
  ])("a message is put in as it came: %j", (message: string) => {
    expect(
      writeRequestFailureDescription(RequestFailureDescription.InvalidTarget, {
        message: message,
      }),
    ).toBe(
      `The monitor's target is not a valid HTTP or HTTPS destination, so no request was attempted. ${message}`,
    );
    expect(
      writeRequestFailureDescription(RequestFailureDescription.RequestFailed, {
        message: message,
      }),
    ).toBe(`Request failed: ${message}`);
  });
});

describe("an explanation, read back", () => {
  test.each(FIXED)(
    "%s is read back to itself",
    (id: RequestFailureDescription) => {
      expect(
        readRequestFailureDescription(writeRequestFailureDescription(id)),
      ).toEqual({ description: id, values: {} });
    },
  );

  test.each([200, 301, 400, 401, 403, 404, 418, 500, 503, 599])(
    "an HTTP %i is read back with its status",
    (status: number) => {
      const reading: RequestFailureDescriptionReading | null =
        readRequestFailureDescription(httpStatusByHand(status));

      expect(reading?.values).toEqual({ status: String(status) });
      expect(
        writeRequestFailureDescription(reading!.description, reading!.values),
      ).toBe(httpStatusByHand(status));
    },
  );

  test("a message is read back as it came", () => {
    expect(
      readRequestFailureDescription(
        writeRequestFailureDescription(
          RequestFailureDescription.InvalidTarget,
          { message: RAW_MESSAGE },
        ),
      ),
    ).toEqual({
      description: RequestFailureDescription.InvalidTarget,
      values: { message: RAW_MESSAGE },
    });
    expect(
      readRequestFailureDescription("Request failed: Network Error."),
    ).toEqual({
      description: RequestFailureDescription.RequestFailed,
      values: { message: "Network Error." },
    });
  });

  test("space round it is left out", () => {
    expect(
      readRequestFailureDescription(
        `\n  ${WRITTEN_BY_HAND[RequestFailureDescription.ConnectionRefused]}\t `,
      )?.description,
    ).toBe(RequestFailureDescription.ConnectionRefused);
  });

  const DNS: string =
    WRITTEN_BY_HAND[RequestFailureDescription.DnsResolutionFailed];

  test.each([
    ["nothing", ""],
    ["no text", undefined],
    ["no full stop", DNS.slice(0, -1)],
    ["lower case", DNS.toLowerCase()],
    ["a word changed", DNS.replace("properly", "correctly")],
    ["two spaces", DNS.replace(". The", ".  The")],
    ["inside a longer message", `Probe said: ${DNS}`],
    ["followed by more", `${DNS} Retried 3 times.`],
    ["only its first sentence", "DNS resolution failed."],
    ["a server's own message", "connect ECONNREFUSED 203.0.113.7:443"],
    ["the status with no number", "Server responded with HTTP status ."],
    ["the status as a word", "Server responded with HTTP status five hundred."],
    ["a two-digit status", "Server responded with HTTP status 50."],
    ["a four-digit status", "Server responded with HTTP status 5000."],
    ["a status of 0", "Server responded with HTTP status 0."],
    ["a status of 600", "Server responded with HTTP status 600."],
    ["Persian digits", "Server responded with HTTP status ۵۰۳."],
    [
      "a status and a message",
      "Server responded with HTTP status 503 (Bad Gateway).",
    ],
    [
      "the status sentence with another ending",
      "Server responded with HTTP status 503. The server is tired.",
    ],
    ["no message", "Request failed: "],
    ["only space for a message", "Request failed:    \t"],
    [
      "the invalid target with no message",
      "The monitor's target is not a valid HTTP or HTTPS destination, so no request was attempted.",
    ],
  ] as Array<[string, string | undefined]>)(
    "%s stays as written",
    (_name: string, text: string | undefined) => {
      expect(readRequestFailureDescription(text)).toBeNull();
    },
  );

  test("in time that grows with the text, on a long near miss", () => {
    const long: string = `Server responded with HTTP status ${"5".repeat(400000)}. This indicates a server-side error.`;
    const read: FastestRun<RequestFailureDescriptionReading | null> =
      fastestRun({
        run: (): RequestFailureDescriptionReading | null => {
          return readRequestFailureDescription(long);
        },
        limitInMs: 2000,
      });

    expect(read.result).toBeNull();
    expect(read.inMs).toBeLessThan(2000);
  });

  test("in time that grows with the text, on a long message", () => {
    const message: string = "x ".repeat(200000);
    const read: FastestRun<RequestFailureDescriptionReading | null> =
      fastestRun({
        run: (): RequestFailureDescriptionReading | null => {
          return readRequestFailureDescription(`Request failed: ${message}`);
        },
        limitInMs: 2000,
      });

    expect(read.result?.values.message).toBe(message.trim());
    expect(read.inMs).toBeLessThan(2000);
  });
});

describe("an explanation, as a summary draws it", () => {
  const CONNECTION_REFUSED: string =
    WRITTEN_BY_HAND[RequestFailureDescription.ConnectionRefused];

  test("in English: as stored", () => {
    for (const id of DESCRIPTIONS) {
      const stored: string = writeRequestFailureDescription(id, {
        status: 503,
        message: RAW_MESSAGE,
      });

      expect(
        getRequestFailureDescriptionText({
          translator: dashboardTranslator("en"),
          description: stored,
          options: { setsValuesApart: true },
        }),
      ).toBe(stored);
    }
  });

  test("in German: the German explanation", () => {
    expect(
      getRequestFailureDescriptionText({
        translator: dashboardTranslator("de"),
        description: CONNECTION_REFUSED,
      }),
    ).toBe(
      "Verbindung abgelehnt. Der Server hat die Verbindung aktiv abgelehnt. Meist lauscht kein Dienst auf dem angegebenen Port, oder eine Firewall blockiert die Verbindung.",
    );
  });

  test("in Persian: the Persian explanation", () => {
    expect(
      getRequestFailureDescriptionText({
        translator: dashboardTranslator("fa"),
        description: CONNECTION_REFUSED,
      }),
    ).toBe(readDashboardLocale("fa")[CONNECTION_REFUSED]);
  });

  test.each(LANGUAGES_SHOWN)(
    "in %s: the HTTP status as the server sent it, in Latin digits",
    (language: string) => {
      const text: string = getRequestFailureDescriptionText({
        translator: dashboardTranslator(language),
        description: httpStatusByHand(503),
        options: { setsValuesApart: true },
      });

      expect(withoutIsolateMarks(text)).toContain("503");
      expect(text).not.toContain("Server responded");
    },
  );

  test("in Persian: the message kept as written, set apart from the Persian words", () => {
    const stored: string = writeRequestFailureDescription(
      RequestFailureDescription.InvalidTarget,
      { message: RAW_MESSAGE },
    );
    const text: string = getRequestFailureDescriptionText({
      translator: dashboardTranslator("fa"),
      description: stored,
      options: { setsValuesApart: true },
    });

    expect(text).toContain(isolated(RAW_MESSAGE));
    expect(text).not.toContain("The monitor's target");
  });

  test("in German: an English message is not set apart in a sentence read the same way", () => {
    const text: string = getRequestFailureDescriptionText({
      translator: dashboardTranslator("de"),
      description: "Request failed: Network Error.",
      options: { setsValuesApart: true },
    });

    expect(text).toBe("Anfrage fehlgeschlagen: Network Error.");
  });

  test("not drawn on the page: no isolate's marks", () => {
    const text: string = getRequestFailureDescriptionText({
      translator: dashboardTranslator("fa"),
      description: `Request failed: ${RAW_MESSAGE}`,
    });

    expect(text).toBe(withoutIsolateMarks(text));
    expect(text).toContain(RAW_MESSAGE);
  });

  test("a language that does not word it yet: as stored", () => {
    const german: Record<string, string> = readDashboardLocale("de");
    const withoutIt: Translator = createTranslator(
      (text: string): string | undefined => {
        return text === CONNECTION_REFUSED ? undefined : german[text];
      },
      "de",
    );

    expect(
      getRequestFailureDescriptionText({
        translator: withoutIt,
        description: ` ${CONNECTION_REFUSED} `,
      }),
    ).toBe(CONNECTION_REFUSED);
  });

  test("any other text: as written, trimmed", () => {
    expect(
      getRequestFailureDescriptionText({
        translator: dashboardTranslator("de"),
        description:
          "  The server did not answer within the timeout (30 seconds).\n",
      }),
    ).toBe("The server did not answer within the timeout (30 seconds).");
    expect(
      getRequestFailureDescriptionText({
        translator: dashboardTranslator("de"),
        description: undefined,
      }),
    ).toBe("");
  });
});

describe("every Dashboard language words every explanation", () => {
  // The explanations a language leaves as the English, or empty.
  const unworded: (words: Record<string, string>) => Array<string> = (
    words: Record<string, string>,
  ): Array<string> => {
    return DESCRIPTIONS.map((id: RequestFailureDescription): string => {
      return REQUEST_FAILURE_DESCRIPTIONS[id];
    }).filter((key: string): boolean => {
      const value: string | undefined = words[key];

      return !value || !value.trim() || value === key;
    });
  };

  test.each(LANGUAGES_SHOWN)(
    "%s words each one, keeping its placeholder",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      expect(unworded(words)).toEqual([]);

      for (const id of DESCRIPTIONS) {
        const key: string = REQUEST_FAILURE_DESCRIPTIONS[id];

        expect({ id, placeholders: placeholdersOf(words[key] || "") }).toEqual({
          id,
          placeholders: placeholdersOf(key),
        });
      }
    },
  );

  test("in all 17 of them, as the toolchain counts it", () => {
    const missing: Array<string> = [];

    for (const language of DASHBOARD_LANGUAGES) {
      for (const id of DESCRIPTIONS) {
        if (
          !isWordedInDashboardLocale(REQUEST_FAILURE_DESCRIPTIONS[id], language)
        ) {
          missing.push(`${language}: ${id}`);
        }
      }
    }

    expect(DASHBOARD_LANGUAGES).toHaveLength(17);
    expect(missing).toEqual([]);
  });

  test("each keeps the probe's setting as written", () => {
    const key: string =
      REQUEST_FAILURE_DESCRIPTIONS[RequestFailureDescription.TargetUnreachable];

    for (const language of DASHBOARD_LANGUAGES) {
      expect({
        language,
        keeps: readDashboardLocale(language)[key]?.includes(
          "PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true",
        ),
      }).toEqual({ language, keeps: true });
    }
  });

  test("negative control: a language that left one in English is caught", () => {
    const german: Record<string, string> = readDashboardLocale("de");
    const key: string =
      REQUEST_FAILURE_DESCRIPTIONS[
        RequestFailureDescription.CertificateExpired
      ];

    expect(unworded({ ...german, [key]: key })).toEqual([key]);
    expect(unworded({ ...german, [key]: " " })).toEqual([key]);
  });
});
