import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import IP from "../../../Types/IP/IP";
import MonitorType from "../../../Types/Monitor/MonitorType";
import NetworkPathTrace, {
  TraceRoute,
  TraceRouteHop,
} from "../../../Types/Monitor/NetworkMonitor/NetworkPathTrace";
import ObjectID from "../../../Types/ObjectID";
import ProbeAttempt from "../../../Types/Probe/ProbeAttempt";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import ProbeNetworkFailureUtil, {
  ProbeNetworkOperation,
} from "../../../Utils/ProbeNetworkFailureUtil";
import NetworkPathView, {
  NETWORK_PATH_VERDICT_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/NetworkPathView";
import SummaryInfo from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SummaryInfo";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * "Network Path at Time of Failure" under a failed Ping or Port check.
 *
 * The customer's IPv6 Ping monitor ran on a probe with no usable IPv6, so
 * traceroute -6 failed "connect: Cannot assign requested address" before
 * one packet left the probe. The card still said "Route did not reach the
 * destination." in front of that, which reads as the customer's host being
 * off the network. A trace with no hops walked no path, so the card must
 * claim nothing about the route and let the trace's own message say why.
 */

const MONITORED_AT: Date = new Date("2026-09-20T09:15:00.000Z");
const CUSTOMER_ADDRESS: string = "2001:518:2800:9::2";
const MONITOR_ID: string = "22222222-2222-4222-8222-222222222222";

// What NetworkPathMonitor records for the customer's traceroute -6.
const TRACEROUTE_COULD_NOT_RUN: string =
  "Traceroute could not run: this probe cannot send IPv6 traffic (connect: Cannot assign requested address).";

const HOPS: Array<TraceRouteHop> = [
  {
    hopNumber: 1,
    address: "192.168.1.1",
    hostName: "gw.example.com",
    roundTripTimeInMS: 1,
    isTimeout: false,
  },
  {
    hopNumber: 2,
    address: undefined,
    hostName: undefined,
    roundTripTimeInMS: undefined,
    isTimeout: true,
  },
  {
    hopNumber: 3,
    address: "198.51.100.7",
    hostName: undefined,
    roundTripTimeInMS: 14,
    isTimeout: false,
  },
];

/*
 * The line under the hop table: the verdict, then the trace's own message,
 * drawn in an isolate of its own (so getByText, which reads one element's
 * own text, cannot find the whole line).
 */
function verdictText(): string {
  return withoutIsolateMarks(
    screen.getByTestId(NETWORK_PATH_VERDICT_TEST_ID).textContent || "",
  );
}

function buildTraceRoute(overrides: Partial<TraceRoute> = {}): TraceRoute {
  return {
    hops: [],
    destinationAddress: CUSTOMER_ADDRESS,
    destinationHostName: undefined,
    isComplete: false,
    totalHops: 0,
    failedHop: undefined,
    failureMessage: undefined,
    ...overrides,
  };
}

function renderPath(traceRoute: TraceRoute | undefined): HTMLElement {
  const trace: NetworkPathTrace = {
    timestamp: MONITORED_AT,
    traceRoute,
  };

  return render(<NetworkPathView networkPathTrace={trace} />).container;
}

describe("Network path card when traceroute recorded no hops", () => {
  it("shows the customer's IPv6 check without a route verdict on top of the probe's reason", () => {
    // The cause PingMonitor now gives for the customer's ping6 output.
    const probeCause: string | null = ProbeNetworkFailureUtil.describeOutput({
      host: CUSTOMER_ADDRESS,
      output: "ping6: connect: Cannot assign requested address\n",
      operation: ProbeNetworkOperation.PingOrTraceroute,
    });

    expect(probeCause).not.toBeNull();

    const failureCause: string = `Error: ${probeCause} Monitor ID: ${MONITOR_ID}`;

    const response: ProbeMonitorResponse = {
      projectId: new ObjectID("11111111-1111-4111-8111-111111111111"),
      monitorId: new ObjectID(MONITOR_ID),
      monitorStepId: new ObjectID("33333333-3333-4333-8333-333333333333"),
      probeId: new ObjectID("44444444-4444-4444-8444-444444444444"),
      monitorDestination: new IP(CUSTOMER_ADDRESS),
      isOnline: false,
      failureCause,
      monitoredAt: MONITORED_AT,
      networkPathTrace: {
        timestamp: MONITORED_AT,
        traceRoute: buildTraceRoute({
          failureMessage: TRACEROUTE_COULD_NOT_RUN,
        }),
      },
      probeAttempts: [1, 2, 3, 4].map((attemptNumber: number): ProbeAttempt => {
        return {
          attemptNumber,
          attemptedAt: MONITORED_AT,
          responseReceivedAt: MONITORED_AT,
          responseTimeInMs: 13,
          isOnline: false,
          failureCause,
        };
      }),
      totalAttempts: 4,
    };

    render(
      <SummaryInfo
        monitorType={MonitorType.Ping}
        probeMonitorResponses={[response]}
        probeName="Global Probe"
      />,
    );

    expect(
      screen.getByText("Network Path at Time of Failure"),
    ).toBeInTheDocument();
    expect(verdictText()).toBe(
      `No path was recorded. ${TRACEROUTE_COULD_NOT_RUN}`,
    );

    /*
     * The check is still Offline (the probe could not verify the host), but
     * every card shows the probe's own cause verbatim: none of them adds a
     * verdict about the host or its route on top of it.
     */
    expect(screen.getByText("Offline")).toBeInTheDocument();
    expect(screen.getAllByText(failureCause)).toHaveLength(5);

    const pageText: string = document.body.textContent || "";

    expect(pageText).not.toMatch(/did not reach the destination/i);
    expect(pageText).not.toMatch(/Route broke/);
    expect(pageText).not.toContain("Unable to reach host");
    expect(pageText).not.toContain("No ICMP echo reply");
  });

  it("puts the neutral lead-in before an older probe's raw execFile message", () => {
    const container: HTMLElement = renderPath(
      buildTraceRoute({
        failureMessage: `Command failed: traceroute -6 -m 20 -w 3 ${CUSTOMER_ADDRESS}\n\nconnect: Cannot assign requested address\n`,
      }),
    );

    expect(screen.getByText(/^No path was recorded\./)).toHaveTextContent(
      `No path was recorded. Command failed: traceroute -6 -m 20 -w 3 ${CUSTOMER_ADDRESS} connect: Cannot assign requested address`,
    );
    expect(container.textContent).not.toMatch(/did not reach/i);
  });

  it("says no path was recorded when traceroute hit its deadline before any hop", () => {
    renderPath(buildTraceRoute({ failureMessage: "Traceroute timed out" }));

    expect(verdictText()).toBe("No path was recorded. Traceroute timed out");
  });

  it("shows the lead-in alone, and no hop table, when there is no message either", () => {
    renderPath(buildTraceRoute());

    expect(screen.getByText("No path was recorded.")).toBeInTheDocument();
    expect(screen.queryByText("Hop")).not.toBeInTheDocument();
  });

  it("claims nothing about the route even if a hop-less payload says it completed", () => {
    const container: HTMLElement = renderPath(
      buildTraceRoute({ isComplete: true }),
    );

    expect(screen.getByText("No path was recorded.")).toBeInTheDocument();
    expect(container.textContent).not.toContain("Route reached");
  });

  it("renders a stored trace with no hops array instead of throwing", () => {
    renderPath(
      buildTraceRoute({
        hops: undefined as unknown as Array<TraceRouteHop>,
        failureMessage: "Traceroute timed out",
      }),
    );

    expect(verdictText()).toBe("No path was recorded. Traceroute timed out");
  });
});

describe("Network path card when traceroute recorded hops", () => {
  it("says the route reached the destination, under the hop table", () => {
    renderPath(
      buildTraceRoute({
        hops: [HOPS[0]!, HOPS[2]!],
        destinationAddress: "198.51.100.7",
        isComplete: true,
        totalHops: 2,
      }),
    );

    expect(screen.getByText("Hop")).toBeInTheDocument();
    expect(
      screen.getByText("gw.example.com (192.168.1.1)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Route reached the destination."),
    ).toBeInTheDocument();
  });

  it("names the hop the route broke at, with the trace's own message", () => {
    renderPath(
      buildTraceRoute({
        hops: HOPS,
        destinationAddress: "203.0.113.9",
        totalHops: 3,
        failedHop: 2,
        failureMessage: "Hop 2 timed out",
      }),
    );

    expect(screen.getByText("* * *")).toBeInTheDocument();
    expect(verdictText()).toBe("Route broke at hop 2. Hop 2 timed out");
  });

  it("keeps 'did not reach' for a walked route that fell short with no failed hop", () => {
    renderPath(
      buildTraceRoute({
        hops: [HOPS[0]!, HOPS[2]!],
        destinationAddress: "203.0.113.9",
        totalHops: 2,
      }),
    );

    expect(
      screen.getByText("Route did not reach the destination."),
    ).toBeInTheDocument();
  });
});

describe("Network path card without a traceroute", () => {
  it("shows the DNS lookup and no route line at all", () => {
    const container: HTMLElement = render(
      <NetworkPathView
        networkPathTrace={{
          timestamp: MONITORED_AT,
          dnsLookup: {
            hostName: "api.example.com",
            resolvedAddresses: [],
            resolvedInMS: 4,
            isSuccess: false,
            errorMessage: "ENOTFOUND",
          },
        }}
      />,
    ).container;

    expect(
      screen.getByText("Lookup for api.example.com failed — ENOTFOUND"),
    ).toBeInTheDocument();
    expect(container.textContent).not.toContain("No path was recorded");
    expect(container.textContent).not.toMatch(/Route (reached|broke|did not)/);
  });

  it("renders nothing when the probe captured neither", () => {
    const container: HTMLElement = renderPath(undefined);

    expect(container).toBeEmptyDOMElement();
  });
});

/*
 * The card in the reader's language (#7420), rendered with the Dashboard's
 * real locale files: its title, its description, its column headers, its
 * DNS line and its verdict are the reader's words; a hop's number is
 * written in the reader's digits, in the table and in "Route broke at hop
 * 2."; RTT and the DNS label stay as abbreviations. What the probe wrote -
 * the trace's own message, a host and its address - stays as written, read
 * left to right on an Arabic or Persian page.
 */
describe("Network path card in the reader's language", () => {
  const LANGUAGES: Array<string> = ["en", "de", "fa", "ar"];
  const instances: Record<string, i18n> = {};

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

  const BROKEN_ROUTE: TraceRoute = buildTraceRoute({
    hops: HOPS,
    destinationAddress: "203.0.113.9",
    totalHops: 3,
    failedHop: 2,
    failureMessage: "Hop 2 timed out",
  });

  const renderIn: (language: string, traceRoute: TraceRoute) => void = (
    language: string,
    traceRoute: TraceRoute,
  ): void => {
    render(
      <I18nextProvider i18n={instances[language]!}>
        <NetworkPathView
          networkPathTrace={{
            timestamp: MONITORED_AT,
            traceRoute: traceRoute,
            dnsLookup: {
              hostName: "api.example.com",
              resolvedAddresses: ["203.0.113.9"],
              resolvedInMS: 1234,
              isSuccess: true,
              errorMessage: undefined,
            },
          }}
        />
      </I18nextProvider>,
    );
  };

  const verdict: () => HTMLElement = (): HTMLElement => {
    return screen.getByTestId(NETWORK_PATH_VERDICT_TEST_ID);
  };

  const hopNumbers: () => Array<string> = (): Array<string> => {
    return screen
      .getAllByTestId("traceroute-hop-number")
      .map((cell: HTMLElement): string => {
        return cell.textContent || "";
      });
  };

  const headers: () => Array<string> = (): Array<string> => {
    return Array.from(document.querySelectorAll("thead th")).map(
      (cell: Element): string => {
        return withoutIsolateMarks(cell.textContent || "").trim();
      },
    );
  };

  it("English reads as it always did", () => {
    renderIn("en", BROKEN_ROUTE);

    expect(
      screen.getByText("Network Path at Time of Failure"),
    ).toBeInTheDocument();
    expect(withoutIsolateMarks(verdict().textContent || "")).toBe(
      "Route broke at hop 2. Hop 2 timed out",
    );
    expect(hopNumbers()).toEqual(["1", "2", "3"]);
    expect(headers()).toEqual(["Hop", "Host", "RTT"]);
  });

  it("German: the card's words in German, RTT as an abbreviation", () => {
    renderIn("de", BROKEN_ROUTE);

    expect(
      screen.getByText("Netzwerkpfad zum Zeitpunkt des Fehlers"),
    ).toBeInTheDocument();
    expect(withoutIsolateMarks(verdict().textContent || "")).toBe(
      "Die Route brach bei Hop 2 ab. Hop 2 timed out",
    );
    expect(headers()).toEqual(["Hop", "Host", "RTT"]);
    expect(document.body.textContent).toContain(
      "api.example.com wurde in 1.234 ms zu 203.0.113.9 aufgelöst",
    );
  });

  it("Persian: Persian words, the hops' numbers in Persian digits, in the table and the verdict", () => {
    renderIn("fa", BROKEN_ROUTE);

    const persian: Record<string, string> = readDashboardLocale("fa");

    expect(
      screen.getByText(persian["Network Path at Time of Failure"]!),
    ).toBeInTheDocument();
    expect(hopNumbers()).toEqual(["۱", "۲", "۳"]);

    const verdictWords: string = withoutIsolateMarks(
      verdict().textContent || "",
    );

    expect(verdictWords).toBe(
      `${persian["Route broke at hop {{hop}}."]!.replace("{{hop}}", "۲")} Hop 2 timed out`,
    );
    expect(headers()[0]).toBe(persian["Hop"]);
    expect(headers()[1]).toBe(persian["Host"]);
  });

  /*
   * Every sentence the card writes itself, in each of the four shapes it
   * takes: no English sentence of it is left on a German or Persian page
   * (the probe's own message and the hosts are the probe's, not the
   * card's, and stay as written).
   */
  it("German and Persian: none of the card's own English sentences is left", () => {
    const ENGLISH_SENTENCES: Array<string> = [
      "Network Path at Time of Failure",
      "Traceroute captured by the probe when this check failed.",
      "No path was recorded.",
      "Route reached the destination.",
      "Route broke at hop",
      "Route did not reach the destination.",
      "resolved to",
      "Lookup for",
    ];
    const SHAPES: Array<TraceRoute> = [
      BROKEN_ROUTE,
      buildTraceRoute({ failureMessage: "Traceroute timed out" }),
      buildTraceRoute({
        hops: HOPS,
        destinationAddress: "203.0.113.9",
        totalHops: 3,
        isComplete: true,
      }),
      buildTraceRoute({
        hops: HOPS,
        destinationAddress: "203.0.113.9",
        totalHops: 3,
      }),
    ];

    for (const language of ["de", "fa"]) {
      for (const shape of SHAPES) {
        renderIn(language, shape);

        const words: string = withoutIsolateMarks(
          document.body.textContent || "",
        );

        for (const sentence of ENGLISH_SENTENCES) {
          expect({
            language,
            sentence,
            found: words.includes(sentence),
          }).toEqual({ language, sentence, found: false });
        }
        cleanup();
      }
    }
  });

  it("Persian: the DNS line is the Persian sentence, its time in Persian digits", () => {
    renderIn("fa", BROKEN_ROUTE);

    const persian: Record<string, string> = readDashboardLocale("fa");
    const words: string = withoutIsolateMarks(document.body.textContent || "");

    expect(words).toContain(
      persian["{{host}} resolved to {{addresses}} in {{time}} ms"]!.replace(
        "{{host}}",
        "api.example.com",
      )
        .replace("{{addresses}}", "203.0.113.9")
        .replace("{{time}}", "۱٬۲۳۴"),
    );
  });

  it("German and Persian: a failed lookup is the reader's sentence", () => {
    for (const language of ["de", "fa"]) {
      render(
        <I18nextProvider i18n={instances[language]!}>
          <NetworkPathView
            networkPathTrace={{
              timestamp: MONITORED_AT,
              dnsLookup: {
                hostName: "api.example.com",
                resolvedAddresses: [],
                resolvedInMS: 12,
                isSuccess: false,
                errorMessage: undefined,
              },
            }}
          />
        </I18nextProvider>,
      );

      const words: string = withoutIsolateMarks(
        document.body.textContent || "",
      );

      expect(words).toContain(
        readDashboardLocale(language)["Lookup for {{host}} failed"]!.replace(
          "{{host}}",
          "api.example.com",
        ),
      );
      expect(words).not.toContain("Lookup for");
      cleanup();
    }
  });

  it("Arabic and Persian: the probe's own message and each host read left to right", () => {
    for (const language of ["ar", "fa"]) {
      renderIn(language, BROKEN_ROUTE);

      const message: HTMLElement | null = verdict().querySelector("bdi");

      expect(message).toHaveTextContent("Hop 2 timed out");
      expect(message).toHaveAttribute("dir", "ltr");

      const hosts: Array<Element> = Array.from(
        document.querySelectorAll("tbody tr td:nth-child(2) bdi"),
      );

      expect(hosts).toHaveLength(3);
      for (const host of hosts) {
        expect(host).toHaveAttribute("dir", "ltr");
      }
      expect(hosts[0]).toHaveTextContent("gw.example.com (192.168.1.1)");
      cleanup();
    }
  });

  /*
   * On an Arabic or Persian page the hop table starts on the right: each
   * header starts where the page's lines start (text-start, never the row's
   * old text-left, which kept the headers on the left over values drawn
   * from the right), and the gap between columns is on each cell's end.
   */
  it("each header and cell starts where the page's lines start", () => {
    renderIn("fa", BROKEN_ROUTE);

    const headerCells: Array<Element> = Array.from(
      document.querySelectorAll("thead th"),
    );

    expect(headerCells).toHaveLength(3);
    for (const cell of headerCells) {
      expect(cell).toHaveClass("text-start");
      expect(cell).not.toHaveClass("text-left");
      expect(cell).not.toHaveClass("pr-4");
    }
    expect(document.querySelector("thead tr")).not.toHaveClass("text-left");

    const bodyCells: Array<Element> = Array.from(
      document.querySelectorAll("tbody tr:first-child td"),
    );

    expect(bodyCells[0]).toHaveClass("pe-4");
    expect(bodyCells[1]).toHaveClass("pe-4");
    for (const cell of bodyCells) {
      expect(cell).not.toHaveClass("pr-4");
    }
  });

  /*
   * A round trip is a figure with its unit, which a phone must not break
   * between the two ("۴۸٫۲۷" on one line, "میلی‌ثانیه" on the next): the
   * host column gives way instead (break-all).
   */
  it("a hop's round trip stays on one line, in the reader's digits and unit", () => {
    renderIn("fa", BROKEN_ROUTE);

    const times: Array<HTMLElement> =
      screen.getAllByTestId("traceroute-hop-rtt");

    expect(times).toHaveLength(3);
    for (const time of times) {
      expect(time).toHaveClass("whitespace-nowrap");
    }
    expect(times[0]!.textContent).toBe(
      readDashboardLocale("fa")["{{value}} ms"]!.replace("{{value}}", "۱"),
    );
  });
});
