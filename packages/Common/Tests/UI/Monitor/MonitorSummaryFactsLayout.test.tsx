import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import ServerMonitorResponse from "../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import IncomingEmailMonitorRequest from "../../../Types/Monitor/IncomingEmailMonitor/IncomingEmailMonitorRequest";
import SummaryInfo from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SummaryInfo";
import {
  SUMMARY_FACTS_CLASS_NAME,
  SUMMARY_FACTS_IN_THREES_CLASS_NAME,
  SUMMARY_FACT_CARD_CLASS_NAME,
  SUMMARY_FACT_VALUE_CLASS_NAME,
  SUMMARY_TABLE_FRAME_CLASS_NAME,
  SUMMARY_VIEW_CLASS_NAME,
  SUMMARY_WIDE_FACT_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SummaryFacts";

/*
 * Every monitor type's summary lays its facts out the one way (SummaryFacts):
 * a grid that follows the summary's own width - two to a row, four once the
 * summary is 64rem wide - not a flex row of quarter- and fifth-width cards
 * that squeezed every value in the overview's two-thirds card at 1280 and
 * ran wider than a phone at 390, so the Monitor Summary card scrolled
 * sideways. Rendered here through SummaryInfo, as the overview, Test
 * Monitor, Monitoring Logs and the incident and alert pages render them.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const MONITORED_AT: Date = new Date("2026-09-21T12:00:00.000Z");

function probeResponse(extra: Record<string, unknown>): ProbeMonitorResponse {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    probeId: new ObjectID("44444444-4444-4444-8444-444444444444"),
    isOnline: false,
    monitoredAt: MONITORED_AT,
    responseTimeInMs: 412.6,
    failureCause: "Connection refused by 203.0.113.10:443",
    requestFailedDetails: {
      failedPhase: "Connect",
      errorCode: "ECONNREFUSED",
      errorDescription:
        "The server refused the connection. It is running, but nothing listens on that port.",
    },
    ...extra,
  } as unknown as ProbeMonitorResponse;
}

interface Scenario {
  name: string;
  monitorType: MonitorType;
  props: Partial<React.ComponentProps<typeof SummaryInfo>>;
  // A value the summary shows, to know it drew its facts.
  shows: string;
}

const LONG_URL: string =
  "https://checkout.payments.eu-west-1.internal.acme-commerce.example/api/v2/health/dependencies?include=db,cache,queue";

const SCENARIOS: Array<Scenario> = [
  {
    name: "Website",
    monitorType: MonitorType.Website,
    props: {
      probeMonitorResponses: [
        probeResponse({
          monitorDestination: LONG_URL,
          responseCode: 503,
          httpTimings: {
            dnsLookupInMs: 12,
            tcpConnectInMs: 30,
            tlsHandshakeInMs: 48,
            timeToFirstByteInMs: 280,
            downloadInMs: 40,
          },
        }),
      ],
    },
    shows: "503",
  },
  {
    name: "API",
    monitorType: MonitorType.API,
    props: {
      probeMonitorResponses: [
        probeResponse({ monitorDestination: LONG_URL, responseCode: 200 }),
      ],
    },
    shows: "200",
  },
  {
    name: "Ping",
    monitorType: MonitorType.Ping,
    props: {
      probeMonitorResponses: [
        probeResponse({
          monitorDestination: "orders-db.internal.acme.example",
          pingResponse: {
            packetLossPercent: 20,
            packetsReceived: 4,
            packetsSent: 5,
            jitterInMs: 3.2,
            minRoundTripTimeInMs: 11,
            maxRoundTripTimeInMs: 19,
          },
        }),
      ],
    },
    shows: "Jitter",
  },
  {
    name: "Port",
    monitorType: MonitorType.Port,
    props: {
      probeMonitorResponses: [
        probeResponse({
          monitorDestination: "orders-db.internal.acme.example",
          monitorDestinationPort: 5432,
        }),
      ],
    },
    shows: "Total Connection Time (DNS + TCP)",
  },
  {
    name: "SSL Certificate",
    monitorType: MonitorType.SSLCertificate,
    props: {
      probeMonitorResponses: [
        probeResponse({
          monitorDestination: LONG_URL,
          sslResponse: {
            isValidCertificate: false,
            isSelfSigned: false,
            certificateValidationErrorCode: "CERT_HAS_EXPIRED",
            certificateValidationError: "certificate has expired",
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            expiresAt: new Date("2026-09-01T00:00:00.000Z"),
            commonName: "checkout.acme-commerce.example",
            organization: "Acme Commerce",
            organizationalUnit: "Payments",
            country: "DE",
            state: "Berlin",
            locality: "Berlin",
            issuer: "CN=R11, O=Let's Encrypt, C=US",
            serialNumber: "04A1B2C3D4E5F60718293A4B5C6D7E8F9A0B",
            fingerprint:
              "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01",
            fingerprint256:
              "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89",
          },
        }),
      ],
    },
    shows: "certificate has expired",
  },
  {
    name: "DNS",
    monitorType: MonitorType.DNS,
    props: {
      probeMonitorResponses: [
        probeResponse({
          dnsResponse: {
            responseTimeInMs: 22,
            isDnssecValid: true,
            records: [
              {
                type: "TXT",
                value:
                  "v=spf1 include:_spf.google.com include:mailgun.org include:sendgrid.net include:amazonses.com -all",
                ttl: 300,
              },
            ],
          },
        }),
      ],
    },
    shows: "DNS Records",
  },
  {
    name: "Domain",
    monitorType: MonitorType.Domain,
    props: {
      probeMonitorResponses: [
        probeResponse({
          domainResponse: {
            responseTimeInMs: 410,
            registrar:
              "Example Registrar, LLC (registrar of record since 2009)",
            expiresDate: "2027-03-01T00:00:00.000Z",
            createdDate: "2009-03-01T00:00:00.000Z",
            dnssec: "unsigned",
            lookupMethod: "RDAP",
            nameServers: ["ns-1234.awsdns-12.org", "ns-567.awsdns-34.net"],
            domainStatus: ["clientTransferProhibited"],
          },
        }),
      ],
    },
    shows: "Lookup Method",
  },
  {
    name: "SQL Query",
    monitorType: MonitorType.SQLQuery,
    props: {
      probeMonitorResponses: [
        probeResponse({
          sqlQueryMonitorResponse: {
            responseTimeInMs: 88,
            rowCount: 1,
            scalarValue: "PostgreSQL 16.3 on x86_64-pc-linux-gnu",
            isRowsCapped: false,
            firstRow: { version: "PostgreSQL 16.3 on x86_64-pc-linux-gnu" },
          },
        }),
      ],
    },
    shows: "Row Count",
  },
  {
    name: "DNSSEC",
    monitorType: MonitorType.DNSSEC,
    props: {
      probeMonitorResponses: [
        probeResponse({
          dnssecResponse: {
            responseTimeInMs: 140,
            isChainValid: false,
            isZoneSigned: true,
            isParentDsPresent: true,
            resolverConsensusAd: false,
            isNameserverConsistent: true,
            daysUntilSignatureExpiry: 3,
            earliestSignatureExpiration: "2026-09-24T00:00:00.000Z",
            resolverChecks: [
              {
                resolver: "2001:4860:4860::8888 (Google Public DNS, IPv6)",
                adFlag: false,
                servfailWhenValidating: true,
                error: "SERVFAIL while validating the DS record",
              },
            ],
            nameserverChecks: [],
          },
        }),
      ],
    },
    shows: "Resolver Checks",
  },
  {
    name: "NTP",
    monitorType: MonitorType.NTP,
    props: {
      probeMonitorResponses: [
        probeResponse({
          monitorDestination: "time.acme.example",
          ntpResponse: {
            isOnline: true,
            isSynchronized: true,
            port: 123,
            stratum: 2,
            clockOffsetInMs: 4.2,
            referenceId: "192.0.2.15",
            responseTimeInMs: 18,
            rootDispersionInMs: 21,
            rootDelayInMs: 9,
            leapIndicator: 0,
            serverTime: "2026-09-21T12:00:00.004Z",
          },
        }),
      ],
    },
    shows: "Clock Offset",
  },
  {
    name: "Database Health",
    monitorType: MonitorType.Database,
    props: {
      probeMonitorResponses: [
        probeResponse({
          databaseMonitorResponse: {
            isOnline: true,
            responseTimeInMs: 21,
            failureCause: "",
            metrics: {},
            collectedGroups: [],
            unavailableGroups: [],
            engineVersion:
              "PostgreSQL 16.3 (Debian 16.3-1.pgdg120+1) on x86_64-pc-linux-gnu, compiled by gcc (Debian 12.2.0-14) 12.2.0, 64-bit",
            connectionError: null,
          },
        }),
      ],
    },
    shows: "Metric Groups Collected",
  },
  {
    name: "Custom JavaScript Code",
    monitorType: MonitorType.CustomJavaScriptCode,
    props: {
      probeMonitorResponses: [
        probeResponse({
          customCodeMonitorResponse: {
            executionTimeInMS: 812,
            scriptError: "TypeError: Cannot read properties of undefined",
            result: { orders: 12 },
            logMessages: ["fetched orders"],
          },
        }),
      ],
    },
    shows: "Execution Time (in ms)",
  },
  {
    name: "Synthetic",
    monitorType: MonitorType.SyntheticMonitor,
    props: {
      probeMonitorResponses: [
        probeResponse({
          syntheticMonitorResponse: [
            {
              executionTimeInMS: 2300,
              browserType: "Chromium",
              screenSizeType: "Desktop",
              scriptError: undefined,
              result: { checkedOut: true },
              logMessages: [],
              screenshots: {},
            },
          ],
        }),
      ],
    },
    shows: "Execution Time (in ms)",
  },
  {
    name: "External Status Page",
    monitorType: MonitorType.ExternalStatusPage,
    props: {
      probeMonitorResponses: [
        probeResponse({
          externalStatusPageResponse: {
            isOnline: true,
            responseTimeInMs: 300,
            provider: "Atlassian Statuspage",
            overallStatus: "degraded_performance",
            activeIncidentCount: 1,
            componentStatuses: [],
          },
        }),
      ],
    },
    shows: "Overall Status",
  },
  {
    name: "SNMP (Network Device)",
    monitorType: MonitorType.NetworkDevice,
    props: {
      probeMonitorResponses: [
        probeResponse({
          snmpResponse: {
            isOnline: true,
            responseTimeInMs: 31,
            failureCause: "",
            oidResponses: [
              {
                oid: "1.3.6.1.2.1.1.1.0",
                name: "sysDescr",
                value:
                  "Cisco IOS Software, C3750E Software (C3750E-UNIVERSALK9-M), Version 15.2(4)E10, RELEASE SOFTWARE (fc2)",
                type: "OctetString",
              },
            ],
          },
        }),
      ],
    },
    shows: "OID Responses",
  },
];

afterEach(() => {
  cleanup();
});

function renderScenario(scenario: Scenario): HTMLElement {
  const { container } = render(
    <SummaryInfo
      monitorType={scenario.monitorType}
      probeName="Frankfurt"
      {...scenario.props}
    />,
  );

  return container;
}

// Every stat card the summary drew (InfoCard's root).
function factCards(container: HTMLElement): Array<HTMLElement> {
  return Array.from(container.querySelectorAll("div.rounded-xl")).filter(
    (element: Element): boolean => {
      return element.className.includes("border-gray-100");
    },
  ) as Array<HTMLElement>;
}

// An element's classes, an svg's too (its className is not a string).
function classesOf(element: Element): Array<string> {
  return (element.getAttribute("class") || "").split(/\s+/).filter(Boolean);
}

const FACT_GRIDS: Array<string> = [
  SUMMARY_FACTS_CLASS_NAME,
  SUMMARY_FACTS_IN_THREES_CLASS_NAME,
];

// The quarter- and fifth-width cards, and the flex rows that spaced them.
const FRACTION_WIDTH: RegExp = /^w-\d\/\d$/;
const VIEWPORT_GRID: RegExp = /^(sm|md|lg|xl|2xl):grid-cols-/;

function expectLaidOutByItsOwnWidth(container: HTMLElement): void {
  const cards: Array<HTMLElement> = factCards(container);

  expect(cards.length).toBeGreaterThan(0);

  for (const card of cards) {
    // Each card is a cell of a facts grid, never of a spaced flex row.
    const row: HTMLElement | null = card.parentElement;

    expect({
      card: card.textContent,
      inFactsGrid: FACT_GRIDS.includes(row?.className || ""),
      rowSpacedX: classesOf(row!).some((name: string): boolean => {
        return name.startsWith("space-x-");
      }),
    }).toEqual({
      card: card.textContent,
      inFactsGrid: true,
      rowSpacedX: false,
    });

    expect(card).toHaveClass(...SUMMARY_FACT_CARD_CLASS_NAME.split(" "));
  }

  for (const element of Array.from(container.querySelectorAll("*"))) {
    const classes: Array<string> = classesOf(element);

    expect({
      element: element.tagName,
      fractions: classes.filter((name: string): boolean => {
        return FRACTION_WIDTH.test(name);
      }),
      viewportGrid: classes.filter((name: string): boolean => {
        return VIEWPORT_GRID.test(name);
      }),
    }).toEqual({
      element: element.tagName,
      fractions: [],
      viewportGrid: [],
    });
  }

  // The view is the container its facts follow.
  const view: Element | null = cards[0]!.closest(
    "[class*='container-type:inline-size']",
  );
  expect(view).not.toBeNull();
  expect(view!.className).toBe(SUMMARY_VIEW_CLASS_NAME);
}

describe("every monitor type's summary lays its facts out by its own width", () => {
  test.each(SCENARIOS)("$name", (scenario: Scenario) => {
    const container: HTMLElement = renderScenario(scenario);

    expect(container.textContent).toContain(scenario.shows);
    expectLaidOutByItsOwnWidth(container);
  });

  test("Incoming Request: its three facts are a grid, not a row wider than the card", () => {
    const { container } = render(
      <SummaryInfo
        monitorType={MonitorType.IncomingRequest}
        incomingMonitorRequest={
          {
            projectId: PROJECT_ID,
            monitorId: MONITOR_ID,
            incomingRequestReceivedAt: MONITORED_AT,
            requestMethod: "POST",
            requestHeaders: { "content-type": "application/json" },
            checkedAt: MONITORED_AT,
          } as unknown as IncomingMonitorRequest
        }
        incomingRequestMonitorHeartbeatCheckedAt={MONITORED_AT}
      />,
    );

    expect(container.textContent).toContain("Monitor Status Check At");
    expect(factCards(container)).toHaveLength(3);
    expectLaidOutByItsOwnWidth(container);
  });

  test("Incoming Email", () => {
    const { container } = render(
      <SummaryInfo
        monitorType={MonitorType.IncomingEmail}
        incomingEmailMonitorRequest={
          {
            projectId: PROJECT_ID,
            monitorId: MONITOR_ID,
            emailFrom: "payroll-notifications@payroll.acme-commerce.example",
            emailSubject:
              "Payroll run for September completed with 0 errors and 2 warnings",
            emailReceivedAt: MONITORED_AT,
            checkedAt: MONITORED_AT,
          } as unknown as IncomingEmailMonitorRequest
        }
        incomingEmailMonitorHeartbeatCheckedAt={MONITORED_AT}
      />,
    );

    expect(container.textContent).toContain("Last Email Received At");
    expectLaidOutByItsOwnWidth(container);
  });

  test("Server: the facts, and its CPU, memory and disks once opened", () => {
    const { container } = render(
      <SummaryInfo
        monitorType={MonitorType.Server}
        serverMonitorResponse={
          {
            projectId: PROJECT_ID,
            monitorId: MONITOR_ID,
            hostname: "orders-db-primary.eu-west-1.internal.acme.example",
            requestReceivedAt: MONITORED_AT,
            basicInfrastructureMetrics: {
              cpuMetrics: { percentUsed: 37.1234, cores: 8 },
              memoryMetrics: {
                total: 34359738368,
                free: 13743895347,
                used: 20615843021,
                percentFree: 40,
                percentUsed: 60,
              },
              diskMetrics: [
                {
                  diskPath: "/var/lib/postgresql/data",
                  total: 536870912000,
                  free: 214748364800,
                  used: 322122547200,
                  percentFree: 40,
                  percentUsed: 60,
                },
              ],
            },
          } as unknown as ServerMonitorResponse
        }
      />,
    );

    expectLaidOutByItsOwnWidth(container);

    fireEvent.click(screen.getByText("Show More Details"));

    expect(container.textContent).toContain("CPU Cores");
    expect(container.textContent).toContain("Memory % Free");
    expect(container.textContent).toContain("Disk /var/lib/postgresql/data");
    expectLaidOutByItsOwnWidth(container);

    // A disk's three facts belong together.
    const totalSize: HTMLElement = screen
      .getByText("Total Size (GB)")
      .closest("div.rounded-xl") as HTMLElement;
    expect(totalSize.parentElement?.className).toBe(
      SUMMARY_FACTS_IN_THREES_CLASS_NAME,
    );
  });

  test("Server: an agent that reports CPU, memory and disks but no processes can still open them", () => {
    render(
      <SummaryInfo
        monitorType={MonitorType.Server}
        serverMonitorResponse={
          {
            projectId: PROJECT_ID,
            monitorId: MONITOR_ID,
            hostname: "build-runner-7",
            requestReceivedAt: MONITORED_AT,
            basicInfrastructureMetrics: {
              cpuMetrics: { percentUsed: 12, cores: 4 },
            },
          } as unknown as ServerMonitorResponse
        }
      />,
    );

    fireEvent.click(screen.getByText("Show More Details"));

    expect(screen.getByText("CPU % Used")).toBeInTheDocument();
    expect(screen.getByText("Hide Details")).toBeInTheDocument();
  });

  test("Telemetry monitors", () => {
    const { container } = render(
      <SummaryInfo
        monitorType={MonitorType.Logs}
        telemetryMonitorSummary={{
          lastCheckedAt: MONITORED_AT,
          nextCheckAt: new Date("2026-09-21T12:01:00.000Z"),
        }}
      />,
    );

    expect(container.textContent).toContain("Next Check At");
    expectLaidOutByItsOwnWidth(container);
  });
});

describe("what a fact is drawn with", () => {
  test("a fact that reads as a sentence takes the whole row", () => {
    renderScenario(SCENARIOS[0]!);

    for (const title of ["URL", "Error", "Error Details"]) {
      expect(screen.getByText(title).closest("div.rounded-xl")).toHaveClass(
        SUMMARY_WIDE_FACT_CLASS_NAME,
      );
    }

    for (const title of ["Probe", "Response Status Code", "Failed At"]) {
      expect(screen.getByText(title).closest("div.rounded-xl")).not.toHaveClass(
        SUMMARY_WIDE_FACT_CLASS_NAME,
      );
    }
  });

  test("a value breaks rather than run out of its card, a size smaller in a narrow summary", () => {
    renderScenario(SCENARIOS[0]!);

    const url: HTMLElement = screen.getByText(LONG_URL);

    expect(url).toHaveClass(...SUMMARY_FACT_VALUE_CLASS_NAME.split(" "));
    expect(url).toHaveClass("break-words", "text-sm");
  });

  test("why a check failed comes right after what it found, before where its time went", () => {
    const container: HTMLElement = renderScenario(SCENARIOS[0]!);
    const text: string = container.textContent || "";

    expect(text.indexOf("Connection refused by 203.0.113.10:443")).toBeLessThan(
      text.indexOf("Request Phase Breakdown"),
    );
    expect(text.indexOf("Monitored At")).toBeLessThan(
      text.indexOf("Connection refused by 203.0.113.10:443"),
    );
  });

  test("an SSL certificate's long values are whole, never cut short with an ellipsis", () => {
    renderScenario(SCENARIOS[4]!);

    fireEvent.click(screen.getByText("Show More Details"));

    for (const title of ["Issuer", "Serial Number", "Fingerprint 256"]) {
      const card: HTMLElement = screen
        .getByText(title)
        .closest("div.rounded-xl") as HTMLElement;

      expect(card).toHaveClass(SUMMARY_WIDE_FACT_CLASS_NAME);
      expect(card.innerHTML).not.toContain("truncate");
    }
  });

  test("what a certificate does not say is left out of its details, not a card of '-' each", () => {
    render(
      <SummaryInfo
        monitorType={MonitorType.SSLCertificate}
        probeName="Frankfurt"
        probeMonitorResponses={[
          probeResponse({
            monitorDestination: "https://shop.acme-commerce.example",
            sslResponse: {
              isValidCertificate: true,
              isSelfSigned: false,
              commonName: "shop.acme-commerce.example",
              organization: "Acme Commerce",
              issuer: "R11 (Let's Encrypt)",
              serialNumber: "  ",
            },
          }),
        ]}
      />,
    );

    fireEvent.click(screen.getByText("Show More Details"));

    const details: HTMLElement = screen.getByTestId("ssl-certificate-details");

    expect(details).toHaveTextContent("shop.acme-commerce.example");
    expect(details).toHaveTextContent("R11 (Let's Encrypt)");

    for (const title of [
      "Organizational Unit",
      "Country",
      "State",
      "Locality",
      "Serial Number",
      "Fingerprint",
      "Fingerprint 256",
    ]) {
      expect({ title, shown: details.textContent?.includes(title) }).toEqual({
        title,
        shown: false,
      });
    }
  });

  test("a fact card takes less padding while the summary is narrow", () => {
    renderScenario(SCENARIOS[0]!);

    const card: HTMLElement = screen
      .getByText("Response Status Code")
      .closest("div.rounded-xl") as HTMLElement;

    expect(card).toHaveClass("p-4", "[@container(min-width:32rem)]:p-5");
    expect(card).not.toHaveClass("p-5");
  });

  test("every table sits in a frame that scrolls rather than clips, and its values break", () => {
    for (const scenario of SCENARIOS) {
      const container: HTMLElement = renderScenario(scenario);

      for (const table of Array.from(container.querySelectorAll("table"))) {
        const frame: HTMLElement = table.parentElement as HTMLElement;

        expect({ scenario: scenario.name, frame: frame.className }).toEqual({
          scenario: scenario.name,
          frame: SUMMARY_TABLE_FRAME_CLASS_NAME,
        });
        expect(frame.className).not.toContain("overflow-hidden");
      }

      cleanup();
    }

    const container: HTMLElement = renderScenario(SCENARIOS[5]!);
    const value: HTMLElement = Array.from(
      container.querySelectorAll("td"),
    ).find((cell: HTMLTableCellElement): boolean => {
      return (cell.textContent || "").startsWith("v=spf1");
    }) as HTMLElement;

    expect(value).toHaveClass("[overflow-wrap:anywhere]");
  });

  test("the status words are the reader's, not the code's", () => {
    renderScenario(SCENARIOS[2]!);

    expect(screen.getByText("Offline")).toBeInTheDocument();
  });

  /*
   * The probe asks whether a validating resolver set the AD flag, which an
   * unsigned zone never gets: so the card says it was not validated, and
   * never calls such a zone "Invalid".
   */
  test("DNSSEC says whether the answer was validated, not that an unsigned zone is invalid", () => {
    const dns: Scenario = SCENARIOS.find((scenario: Scenario): boolean => {
      return scenario.name === "DNS";
    })!;

    const cases: Array<{ isDnssecValid: boolean | undefined; word: string }> = [
      { isDnssecValid: true, word: "Validated" },
      { isDnssecValid: false, word: "Not validated" },
      { isDnssecValid: undefined, word: "Unknown" },
    ];

    for (const entry of cases) {
      renderScenario({
        ...dns,
        props: {
          probeMonitorResponses: [
            probeResponse({
              dnsResponse: {
                responseTimeInMs: 22,
                isDnssecValid: entry.isDnssecValid,
                records: [],
              },
            }),
          ],
        },
      });

      expect(screen.getByText(entry.word)).toBeInTheDocument();
      expect(screen.queryByText("Invalid")).toBeNull();
      cleanup();
    }
  });
});
