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
import DnssecMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/DnssecMonitorView";
import DomainMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/DomainMonitorView";
import HttpTimingsView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/HttpTimingsView";
import PingMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/PingMonitorView";
import PortMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/PortMonitorView";
import ScreenshotGroup from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/ScreenshotGroup";
import ServerMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/ServerMonitorView";
import SnmpInterfacesView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SnmpInterfacesView";
import SnmpMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SnmpMonitorView";
import SqlMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SqlMonitorView";
import SummaryInfo from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SummaryInfo";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import { MonitorSummaryProbeState } from "../../../Utils/Monitor/MonitorSummaryProbeUtil";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
  readDashboardSameAsEnglish,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A MONITOR SUMMARY'S LABELS AND LINES, IN THE READER'S LANGUAGE (#8002).
 *
 * The monitor summaries (the monitor's Summary card, Test Monitor's result,
 * Monitoring Logs' View Summary) put a failed check's reason in the
 * reader's language (#7422, #7424), and the labels round it - Request Phase
 * Breakdown, Waiting (TTFB), Resolver Checks, Packet Loss, the probe
 * disabled and not reported lines - read English in 11 to 14 languages: the
 * locale files held the English as their value. Each reads in every
 * Dashboard language now, its placeholders and its technical names (DNS,
 * TCP, TTFB, RTT, RRSIG, SOA, SERVFAIL, OID, GB) kept.
 */

const KEYS: ReadonlyArray<string> = [
  // The summary's lines.
  "{{probe}} is disabled for this monitor, so it is not collecting any data. Enable it under Probes.",
  "This probe is disabled for this monitor, so it is not collecting any data. Enable it under Probes.",
  "{{probe}} has not reported a result yet. Results usually appear within a few minutes of its next check.",
  "This probe has not reported a result yet. Results usually appear within a few minutes of its next check.",
  "No probes are monitoring this resource. Add one under Probes to start collecting data.",
  "The latest criteria evaluation came from {{probe}}. Pick it above to see why it passed or failed.",
  "Probe results are unavailable. {{error}}",
  "No report from the server agent yet. Install the agent to start sending data; setup instructions are under Documentation.",
  "This monitor alerts on a registered Network Device. Live polling data — reachability, interfaces, inventory, and health charts — lives on the device's page under Network Devices. Criteria on this monitor are evaluated every time the device is polled and every time it sends a matching trap.",
  // A request's and a connection's timing.
  "Request Phase Breakdown",
  "Where this check spent its time, from DNS lookup to the last byte.",
  "DNS Lookup",
  "TCP Connect",
  "Waiting (TTFB)",
  "Connection Phase Breakdown",
  "Time spent resolving the target and establishing the TCP connection.",
  "Total Connection Time (DNS + TCP)",
  // DNSSEC.
  "Resolver",
  "Resolver Checks",
  "Nameserver",
  "Nameserver Consistency",
  "RRSIG Expires",
  "SOA Serial",
  "AD Flag",
  "SERVFAIL on validate",
  // A domain.
  "Domain Status Codes",
  "Lookup Method",
  "Name Server",
  "Name Servers",
  // A ping.
  "Packet Loss",
  "Jitter",
  "Min RTT",
  "Max RTT",
  // SQL and a database.
  "Yes (result capped)",
  "Rows Truncated",
  "Execution Time",
  "First Row",
  "Metric Groups Collected",
  "Some metrics were not collected",
  "The database answered, so the monitor stays online. These groups are missing from this check, and their charts have a gap here.",
  "Which grants each metric group needs, for every platform",
  "Not available on this engine",
  "{{count}} groups unavailable",
  "{{count}} groups unavailable_one",
  // SNMP and a server.
  "OID Responses",
  "Network Interfaces ({{count}})",
  "Errors/s",
  "Interface walk failed:",
  "Live interface inventory from the last check. Bandwidth and utilization are averaged between checks.",
  "Total Size (GB)",
  "% Free",
  "% Used",
  // Screenshots.
  "Screenshots:",
];

// The technical names a language keeps as written.
const TECHNICAL_NAMES: ReadonlyArray<string> = [
  "DNS",
  "TCP",
  "TTFB",
  "RTT",
  "RRSIG",
  "SOA",
  "SERVFAIL",
  "OID",
  "GB",
];

const CJK_ONE_FORM_LANGUAGES: ReadonlyArray<string> = [
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
];

describe("every Dashboard language words the summaries' labels", () => {
  test("every key is one the Dashboard's English holds", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    expect(
      KEYS.filter((key: string): boolean => {
        return english[key] === undefined;
      }),
    ).toEqual([]);
  });

  test("in all 17 languages, as the toolchain counts it", () => {
    const missing: Array<string> = [];

    for (const language of DASHBOARD_LANGUAGES) {
      for (const key of KEYS) {
        if (!isWordedInDashboardLocale(key, language)) {
          missing.push(`${language}: ${key}`);
        }
      }
    }

    expect(DASHBOARD_LANGUAGES).toHaveLength(17);
    expect(missing).toEqual([]);
  });

  test("each keeps its placeholders", () => {
    const changed: Array<string> = [];

    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const key of KEYS) {
        const english: string = readDashboardLocale("en")[key]!;

        if (
          placeholdersOf(words[key] || "").join() !==
          placeholdersOf(english).join()
        ) {
          changed.push(`${language}: ${key}`);
        }
      }
    }

    expect(changed).toEqual([]);
  });

  test("each keeps the technical names its English gives", () => {
    const lost: Array<string> = [];

    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const key of KEYS) {
        for (const name of TECHNICAL_NAMES) {
          if (
            new RegExp(`\\b${name}\\b`).test(key) &&
            !(words[key] || "").includes(name)
          ) {
            lost.push(`${language}: ${name} in ${key}`);
          }
        }
      }
    }

    expect(lost).toEqual([]);
  });

  test("a language that writes no one form still holds one", () => {
    for (const language of CJK_ONE_FORM_LANGUAGES) {
      expect(
        readDashboardLocale(language)["{{count}} groups unavailable_one"],
      ).toBeDefined();
    }
  });

  test("negative control: a language that left one in English, or empty, is caught", () => {
    // The keys German left as the English, but for the ones it keeps on purpose.
    const counted: (words: Record<string, string>) => Array<string> = (
      words: Record<string, string>,
    ): Array<string> => {
      const english: Record<string, string> = readDashboardLocale("en");
      const kept: ReadonlyArray<string> = readDashboardSameAsEnglish("de");

      return KEYS.filter((key: string): boolean => {
        const value: string | undefined = words[key];

        return (
          !value ||
          !value.trim() ||
          (value === english[key] && !kept.includes(english[key]!))
        );
      });
    };
    const german: Record<string, string> = readDashboardLocale("de");

    expect(counted(german)).toEqual([]);
    expect(counted({ ...german, "Packet Loss": "Packet Loss" })).toEqual([
      "Packet Loss",
    ]);
    expect(counted({ ...german, "Resolver Checks": " " })).toEqual([
      "Resolver Checks",
    ]);
    expect(isWordedInDashboardLocale("Packet Loss", "de")).toBe(true);
    // Before #8002, the Danish file held the English.
    expect(readDashboardLocale("da")["Packet Loss"]).not.toBe("Packet Loss");
  });
});

/*
 * One summary of each group, drawn in German and in Persian: the labels
 * read in the reader's words, not the English.
 */

type Language = "de" | "fa";

const SOFT_HYPHENS: RegExp = /\u00AD/g;

const LANGUAGES: Array<Language> = ["de", "fa"];

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
    monitoredAt: new Date(Date.UTC(2026, 10, 15, 9, 30)),
    ...overrides,
  } as ProbeMonitorResponse;
};

interface SummaryGroup {
  name: string;
  draw: () => React.ReactElement;
  // The keys it draws, each read in the reader's words.
  labels: Array<string>;
  values?: Record<string, string> | undefined;
  // Opens the fold the labels are under, when they are under one.
  open?: ((view: RenderResult) => void) | undefined;
}

const GROUPS: Array<SummaryGroup> = [
  {
    name: "a disabled probe's line",
    draw: (): React.ReactElement => {
      return (
        <SummaryInfo
          monitorType={MonitorType.Website}
          probeMonitorResponses={[]}
          probeName="US West"
          probeSummaryState={MonitorSummaryProbeState.SelectedProbeDisabled}
        />
      );
    },
    labels: [
      "{{probe}} is disabled for this monitor, so it is not collecting any data. Enable it under Probes.",
    ],
    values: { probe: "US West" },
  },
  {
    name: "a resource no probe monitors",
    draw: (): React.ReactElement => {
      return (
        <SummaryInfo
          monitorType={MonitorType.Website}
          probeMonitorResponses={[]}
          probeSummaryState={MonitorSummaryProbeState.NoProbesAttached}
        />
      );
    },
    labels: [
      "No probes are monitoring this resource. Add one under Probes to start collecting data.",
    ],
  },
  {
    name: "a probe that has not reported",
    draw: (): React.ReactElement => {
      return (
        <SummaryInfo
          monitorType={MonitorType.Website}
          probeMonitorResponses={[]}
          probeSummaryState={MonitorSummaryProbeState.AwaitingFirstResult}
        />
      );
    },
    labels: [
      "This probe has not reported a result yet. Results usually appear within a few minutes of its next check.",
    ],
  },
  {
    name: "a request's phases",
    draw: (): React.ReactElement => {
      return (
        <HttpTimingsView
          httpTimings={{
            dnsLookupInMs: 12,
            tcpConnectInMs: 31,
            timeToFirstByteInMs: 250,
          }}
        />
      );
    },
    labels: [
      "Request Phase Breakdown",
      "Where this check spent its time, from DNS lookup to the last byte.",
      "DNS Lookup",
      "TCP Connect",
      "Waiting (TTFB)",
    ],
  },
  {
    name: "a port's connection",
    draw: (): React.ReactElement => {
      return (
        <PortMonitorView
          probeMonitorResponse={probeResponse({
            responseTimeInMs: 45,
            portTimings: { dnsLookupInMs: 3, tcpConnectInMs: 42 },
          })}
        />
      );
    },
    labels: [
      "Total Connection Time (DNS + TCP)",
      "Connection Phase Breakdown",
      "Time spent resolving the target and establishing the TCP connection.",
    ],
  },
  {
    name: "a DNSSEC zone's resolvers and nameservers",
    draw: (): React.ReactElement => {
      return (
        <DnssecMonitorView
          probeMonitorResponse={probeResponse({
            dnssecResponse: {
              isOnline: true,
              responseTimeInMs: 140,
              failureCause: "",
              domainName: "example.com",
              isZoneSigned: true,
              dnskeys: [],
              parentDsRecords: [],
              isParentDsPresent: true,
              rrsigs: [],
              resolverChecks: [
                {
                  resolver: "1.1.1.1",
                  adFlag: true,
                  servfailWhenValidating: false,
                },
              ],
              nameserverChecks: [
                {
                  nameServer: "ns1.example.com",
                  soaSerial: "2026111501",
                  rrsigExpiration: "2026-12-01T00:00:00.000Z",
                },
              ],
            } as never,
          })}
        />
      );
    },
    labels: [
      "Resolver Checks",
      "Resolver",
      "AD Flag",
      "SERVFAIL on validate",
      "Nameserver Consistency",
      "Nameserver",
      "SOA Serial",
      "RRSIG Expires",
    ],
  },
  {
    name: "a domain's name servers",
    draw: (): React.ReactElement => {
      return (
        <DomainMonitorView
          probeMonitorResponse={probeResponse({
            domainResponse: {
              isOnline: true,
              responseTimeInMs: 911,
              failureCause: "",
              domainName: "example.com",
              lookupMethod: "RDAP",
              nameServers: ["ns1.example.com", "ns2.example.com"],
              domainStatus: ["clientTransferProhibited"],
            } as never,
          })}
        />
      );
    },
    labels: ["Lookup Method", "Name Servers", "Domain Status Codes"],
  },
  {
    name: "a ping's packets and round trips",
    draw: (): React.ReactElement => {
      return (
        <PingMonitorView
          probeMonitorResponse={probeResponse({
            responseTimeInMs: 23,
            pingResponse: {
              packetsSent: 4,
              packetsReceived: 3,
              packetLossPercent: 25,
              jitterInMs: 1.25,
              minRoundTripTimeInMs: 20,
              maxRoundTripTimeInMs: 30,
            },
          })}
        />
      );
    },
    labels: ["Packet Loss", "Jitter", "Min RTT", "Max RTT"],
  },
  {
    name: "a SQL query's result",
    draw: (): React.ReactElement => {
      return (
        <SqlMonitorView
          probeMonitorResponse={probeResponse({
            sqlQueryMonitorResponse: {
              isOnline: true,
              rowCount: 1000,
              isRowsCapped: true,
              responseTimeInMs: 12,
              rows: [{ id: 1, name: "alpha" }],
            } as never,
          })}
        />
      );
    },
    labels: ["Rows Truncated", "Yes (result capped)", "Execution Time"],
  },
  {
    name: "an SNMP device's OIDs",
    draw: (): React.ReactElement => {
      return (
        <SnmpMonitorView
          probeMonitorResponse={probeResponse({
            snmpResponse: {
              isOnline: true,
              responseTimeInMs: 20,
              oidResponses: [
                { oid: "1.3.6.1.2.1.1.5.0", value: "core-switch-1" },
              ],
            } as never,
          })}
        />
      );
    },
    labels: ["OID Responses"],
  },
  {
    name: "an SNMP device's interfaces",
    draw: (): React.ReactElement => {
      return (
        <SnmpInterfacesView
          interfaces={[
            {
              interfaceIndex: 1,
              name: "eth0",
              isOperationallyUp: true,
              isAdministrativelyUp: true,
            },
          ]}
        />
      );
    },
    labels: ["Network Interfaces ({{count}})", "Errors/s"],
    values: { count: "1" },
  },
  {
    name: "a server's disks",
    draw: (): React.ReactElement => {
      return (
        <ServerMonitorView
          serverMonitorResponse={
            {
              projectId: new ObjectID("11111111-1111-4111-8111-111111111111"),
              monitorId: new ObjectID("22222222-2222-4222-8222-222222222222"),
              hostname: "build-runner-7",
              requestReceivedAt: new Date(Date.UTC(2026, 10, 15, 9, 30)),
              basicInfrastructureMetrics: {
                diskMetrics: [
                  {
                    diskPath: "/",
                    total: 107374182400,
                    used: 42949672960,
                    free: 64424509440,
                    percentUsed: 40,
                    percentFree: 60,
                  },
                ],
              },
            } as never
          }
        />
      );
    },
    labels: ["Total Size (GB)", "% Free", "% Used"],
    open: (view: RenderResult): void => {
      fireEvent.click(view.getByRole("button"));
    },
  },
  {
    name: "a synthetic check's screenshots",
    draw: (): React.ReactElement => {
      return <ScreenshotGroup screenshots={{}} />;
    },
    labels: ["Screenshots:"],
  },
];

const fill: (text: string, values: Record<string, string>) => string = (
  text: string,
  values: Record<string, string>,
): string => {
  return text.replace(/\{\{(\w+)\}\}/g, (match: string, name: string) => {
    return values[name] ?? match;
  });
};

describe.each(GROUPS)("$name", (group: SummaryGroup) => {
  test.each(LANGUAGES)(
    "in %s: each label in the reader's words",
    (language: Language) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const english: Record<string, string> = readDashboardLocale("en");
      const view: RenderResult = render(
        <I18nextProvider i18n={instances[language]!}>
          {group.draw()}
        </I18nextProvider>,
      );

      group.open?.(view);

      // A long title may take soft hyphens where it breaks (InfoCard).
      const text: string = withoutIsolateMarks(
        view.container.textContent || "",
      ).replace(SOFT_HYPHENS, "");

      for (const label of group.labels) {
        const worded: string = fill(words[label]!, group.values || {});
        const written: string = fill(english[label]!, group.values || {});

        expect({ label, drawn: text.includes(worded) }).toEqual({
          label,
          drawn: true,
        });

        if (worded !== written && !worded.includes(written)) {
          expect({ label, english: text.includes(written) }).toEqual({
            label,
            english: false,
          });
        }
      }
    },
  );
});
