import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  NETWORK_DEVICE_METRIC_DESCRIPTIONS,
  NetworkDeviceMetric,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/NetworkDeviceMetricDescriptions";
import {
  NETWORK_SITE_METRIC_DESCRIPTIONS,
  NetworkSiteMetric,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/NetworkSiteMetricDescriptions";
import { summarizeLatencySeries } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceDiagnosticsViewModel";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import { AggregationIntervalUtil } from "../../../Types/BaseDatabase/AggregationIntervalUtil";
import OneUptimeDate from "../../../Types/Date";
import DeviceReachabilityUtil, {
  NetworkDeviceReachability,
} from "../../../Utils/NetworkDevice/DeviceReachabilityUtil";
import SiteUptimeUtil, {
  SiteStatusTimelineRow,
  SiteUptimeMeasurement,
} from "../../../Utils/NetworkSite/SiteUptimeUtil";
import NetworkDeviceMonitoringMethod from "../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import {
  expectReadableDescriptionRecord,
  expectTitleExplained,
} from "./MetricDescriptionRules";

/*
 * The (i) texts on the network device and network site pages.
 *
 * The readability rules are shared with every other resource type. What is
 * pinned here on top of them is ACCURACY: each text makes a claim about how
 * its number is computed — a window, a denominator, a cap, a rule — and each
 * claim is checked against the code that computes it, by running that code
 * where it lives in Common and by reading the constant where it does not.
 * Change the computation and the matching test here fails, which is the
 * prompt to change the words.
 */

const PACKAGES_ROOT: string = path.join(__dirname, "..", "..", "..", "..");
const DASHBOARD_SRC: string = path.join(
  PACKAGES_ROOT,
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);

function readFrom(root: string, ...parts: Array<string>): string {
  return fs
    .readFileSync(path.join(root, ...parts), "utf8")
    .replace(/\s+/g, " ");
}

function readDashboard(...parts: Array<string>): string {
  return readFrom(DASHBOARD_SRC, ...parts);
}

const DEVICE: Record<NetworkDeviceMetric, string> =
  NETWORK_DEVICE_METRIC_DESCRIPTIONS;
const SITE: Record<NetworkSiteMetric, string> =
  NETWORK_SITE_METRIC_DESCRIPTIONS;

const MS_PER_DAY: number = 24 * 60 * 60 * 1000;

describe("the network description records read as short, finished sentences", () => {
  test("NETWORK_DEVICE_METRIC_DESCRIPTIONS", () => {
    expectReadableDescriptionRecord(
      DEVICE,
      "NETWORK_DEVICE_METRIC_DESCRIPTIONS",
    );
  });

  test("NETWORK_SITE_METRIC_DESCRIPTIONS", () => {
    expectReadableDescriptionRecord(SITE, "NETWORK_SITE_METRIC_DESCRIPTIONS");
  });

  test("no text is shared between the device and the site records", () => {
    const deviceTexts: Set<string> = new Set<string>(Object.values(DEVICE));

    for (const [key, text] of Object.entries(SITE)) {
      expect({ key, reused: deviceTexts.has(text) }).toEqual({
        key,
        reused: false,
      });
    }
  });

  test("every text stays well inside a small tooltip (aim: 260 characters)", () => {
    for (const [key, text] of [
      ...Object.entries(DEVICE),
      ...Object.entries(SITE),
    ]) {
      expect({ key, length: text.length <= 260 }).toEqual({
        key,
        length: true,
      });
    }
  });

  test("no text leaks an internal metric name or OID", () => {
    for (const [key, text] of [
      ...Object.entries(DEVICE),
      ...Object.entries(SITE),
    ]) {
      expect({ key, text }).not.toEqual({
        key,
        text: expect.stringMatching(
          /oneuptime\.|isReachable|sysUpTime|ifHighSpeed|\d+\.\d+\.\d+\.\d+\.\d+/,
        ),
      });
    }
  });

  test.each([
    ["Reachability", DEVICE.reachability],
    ["Round-trip time, past hour", DEVICE.latencyTrend],
    ["Packet loss (1h max)", DEVICE.packetLossPeak],
    ["Average RTT", DEVICE.pingAverageRtt],
    ["Min / Max RTT", DEVICE.pingMinMaxRtt],
    ["RTT", DEVICE.tracerouteRtt],
    ["Uptime (24h)", SITE.uptime24h],
    ["Uptime (30d)", SITE.uptime30d],
  ])("the %s title is explained by its text", (title: string, text: string) => {
    expectTitleExplained(title, text);
  });

  test("jargon is explained where it is used", () => {
    // RTT is never left as three letters.
    for (const text of [
      DEVICE.pingAverageRtt,
      DEVICE.tracerouteRtt,
      DEVICE.pingMinMaxRtt,
    ]) {
      expect(text.toLowerCase()).toContain("round");
    }

    expect(DEVICE.pingJitter).toContain("varied");
    expect(DEVICE.fleetEndpoints).toContain("ARP and MAC forwarding tables");
    expect(SITE.endpoints).toContain("ARP and MAC forwarding tables");
    expect(DEVICE.interfaceUtilization).toContain("percentage of link speed");
    expect(DEVICE.flowCount).toContain("Each record sums up one conversation");
  });
});

describe("device status texts match DeviceReachabilityUtil", () => {
  test("a monitor-backed device is up unless its monitor reports it OFFLINE (a Degraded monitor still reads up)", () => {
    const degraded: NetworkDeviceReachability =
      DeviceReachabilityUtil.getStatus({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        monitorStatusIsOffline: false,
      });
    const offline: NetworkDeviceReachability = DeviceReachabilityUtil.getStatus(
      {
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        monitorStatusIsOffline: true,
      },
    );

    expect(degraded).toBe(NetworkDeviceReachability.Up);
    expect(offline).toBe(NetworkDeviceReachability.Down);

    expect(DEVICE.reachability).toContain("reports it offline");
    expect(DEVICE.devicesUp).toContain("does not report it offline");
    expect(DEVICE.devicesDown).toContain("reports it offline");
  });

  test("never polled is Pending, and Pending is named in the texts that show it", () => {
    expect(
      DeviceReachabilityUtil.getStatus({
        monitoringMethod: NetworkDeviceMonitoringMethod.Probe,
      }),
    ).toBe(NetworkDeviceReachability.Pending);

    expect(DEVICE.reachability).toContain("Pending means no result yet");
    expect(DEVICE.deviceStatus).toContain("Pending means no result yet");
    expect(DEVICE.devicesPending).toContain("never polled");
    expect(DEVICE.fleetDevices).toContain("pending");
  });

  test("the probe's check is a ping plus an SNMP walk, and either answer is enough", () => {
    expect(
      DeviceReachabilityUtil.getStatus({
        monitoringMethod: NetworkDeviceMonitoringMethod.Probe,
        isReachable: true,
        isSnmpReachable: false,
        lastPolledAt: OneUptimeDate.getCurrentDate(),
        lastSeenAt: OneUptimeDate.getCurrentDate(),
      }),
    ).toBe(NetworkDeviceReachability.Up);

    expect(DEVICE.reachability).toContain("ping, plus an SNMP walk");
    expect(DEVICE.devicesDown).toContain("neither ping nor the SNMP walk");
  });

  test("the strip's three status counts partition the fleet, and the texts say so", () => {
    const service: string = readFrom(
      PACKAGES_ROOT,
      "Common",
      "Server",
      "Services",
      "NetworkDeviceService.ts",
    );

    expect(service).toContain(
      'COUNT(*) FILTER (WHERE "NetworkDevice"."isReachable" = true)',
    );
    expect(service).toContain(
      'COUNT(*) FILTER (WHERE "NetworkDevice"."isReachable" = false)',
    );
    expect(service).toContain(
      'COUNT(*) FILTER (WHERE "NetworkDevice"."isReachable" IS NULL)',
    );
    expect(DEVICE.devicesPending).toContain(
      "Up, Down and Pending together add up to every device in the project",
    );
  });

  test("Monitor Status is whatever a watching monitor last stamped, which can disagree with Reachability", () => {
    const siteService: string = readFrom(
      PACKAGES_ROOT,
      "Common",
      "Server",
      "Services",
      "NetworkSiteService.ts",
    );

    /*
     * Every device a monitor references gets the stamp, but only a
     * monitor-backed device has its reachability moved by it — a Probe
     * device's Reachability stays the poll's, so the two can differ.
     */
    expect(siteService).toContain(
      "const stamp: PartialEntity<NetworkDevice> = { currentMonitorStatusId: data.monitorStatusId, };",
    );
    expect(siteService).toContain(
      "monitorBackedIsReachable !== undefined && NetworkDeviceMonitoringMethodUtil.isMonitorBacked( device.monitoringMethod, )",
    );

    // A Probe device answering its poll is Up whatever a monitor stamped.
    expect(
      DeviceReachabilityUtil.getStatus({
        monitoringMethod: NetworkDeviceMonitoringMethod.Probe,
        isReachable: true,
        monitorStatusIsOffline: true,
      }),
    ).toBe(NetworkDeviceReachability.Up);

    expect(DEVICE.monitorStatus).toContain("can differ from Reachability");
    expect(DEVICE.monitorStatus).toContain(
      "Not monitored means no monitor has reported yet",
    );
  });

  test("the strip counts the project, not the filtered list", () => {
    const cards: string = readDashboard(
      "Components",
      "NetworkDevice",
      "DeviceSummaryCards.tsx",
    );

    // No filter is handed to the summary endpoint.
    expect(cards).toContain("await fetchDeviceSummary()");

    for (const text of [DEVICE.devicesUp, DEVICE.devicesDown]) {
      expect(text).toContain(
        "Counts the whole project, whatever filters are set below",
      );
    }
    expect(SITE.unhealthySites).toContain(
      "Counts the whole project, whatever filters are set below",
    );
  });
});

describe("interface texts match how the walk computes them", () => {
  const rateUtil: string = readFrom(
    PACKAGES_ROOT,
    "Common",
    "Server",
    "Utils",
    "Monitor",
    "SnmpInterfaceRateUtil.ts",
  );
  const inventoryUtil: string = readFrom(
    PACKAGES_ROOT,
    "Common",
    "Server",
    "Utils",
    "Monitor",
    "NetworkInventoryUtil.ts",
  );

  test("rates, utilization and errors are averages between the last two walks", () => {
    expect(rateUtil).toContain("(inOctetsDelta * 8) / elapsedSeconds");
    expect(rateUtil).toContain(
      "((inErrorsDelta || 0) + (outErrorsDelta || 0)) / elapsedSeconds",
    );

    for (const text of [
      DEVICE.interfaceInOutRate,
      DEVICE.interfaceUtilization,
      DEVICE.interfaceErrorsPerSecond,
      DEVICE.interfacesPreview,
    ]) {
      expect(text).toContain("between the last two SNMP walks");
    }

    expect(DEVICE.interfaceErrorsPerSecond).toContain("Inbound plus outbound");
  });

  test("utilization is the BUSIER direction over link speed, never the sum", () => {
    expect(rateUtil).toContain("const busiestDirectionBps: number = Math.max(");
    expect(rateUtil).toContain(
      "(busiestDirectionBps / currentInterface.speedInBitsPerSecond) * 100",
    );

    expect(DEVICE.interfaceUtilization).toContain("busier direction");
    expect(DEVICE.interfacesPreview).toContain("busier direction");
    expect(DEVICE.interfaceSpeed).toContain(
      "what Utilization is measured against",
    );
  });

  test("a counter that went backwards gives no rate, which the dash is for", () => {
    expect(rateUtil).toContain("return delta >= 0 ? delta : undefined;");
    expect(DEVICE.interfaceInOutRate).toContain("counter reset");
  });

  test("up is enabled-with-link and down is enabled-without-link; switched-off ports are in neither", () => {
    expect(inventoryUtil).toContain(
      "return walked.isAdministrativelyUp && walked.isOperationallyUp;",
    );
    expect(inventoryUtil).toContain(
      "return walked.isAdministrativelyUp && !walked.isOperationallyUp;",
    );

    expect(DEVICE.interfacesUp).toContain("enabled and have a working link");
    expect(DEVICE.interfacesDown).toContain("enabled but have no link");
    expect(DEVICE.interfacesDown).toContain(
      "Ports an administrator switched off are not counted",
    );
    expect(DEVICE.heroInterfaces).toContain("count in neither");
    expect(DEVICE.deviceInterfacesUpDown).toContain("count in neither");
    expect(DEVICE.interfaceStatus).toContain("Disabled means an administrator");
  });

  test("counts come from the last SUCCESSFUL walk (a failed walk keeps them)", () => {
    expect(inventoryUtil).toContain(
      "A failed walk in snmp mode, by contrast, leaves them alone",
    );

    for (const text of [
      DEVICE.heroInterfaces,
      DEVICE.totalInterfaces,
      DEVICE.interfacesUp,
      DEVICE.interfacesDown,
      DEVICE.deviceInterfacesUpDown,
      DEVICE.totalInterfacesDown,
      DEVICE.fleetInterfacesDown,
    ]) {
      expect(text).toContain("last successful SNMP walk");
    }
  });

  test("the fleet-wide down count is a SUM of ports, so it says ports, not devices", () => {
    const service: string = readFrom(
      PACKAGES_ROOT,
      "Common",
      "Server",
      "Services",
      "NetworkDeviceService.ts",
    );

    expect(service).toContain(
      'COALESCE(SUM("NetworkDevice"."interfacesDown"), 0)',
    );
    expect(DEVICE.totalInterfacesDown).toContain("counts ports, not devices");
    expect(DEVICE.totalInterfacesDown).toContain("adds three");
    expect(DEVICE.fleetInterfacesDown).toContain("adds three");
  });

  test("muted interfaces stay in the inventory counts but out of metrics and criteria", () => {
    expect(inventoryUtil).toContain(
      "Prune the in-flight response to monitored interfaces only",
    );
    expect(DEVICE.interfacesMonitored).toContain("not charted or alerted on");
    expect(DEVICE.totalInterfaces).toContain("muted interfaces");
    expect(DEVICE.interfacesUp).toContain("Muted interfaces are counted too");
  });

  test("the preview names its row cap and the order it ranks ports in", () => {
    const preview: string = readDashboard(
      "Components",
      "NetworkDevice",
      "DeviceInterfacesPreview.tsx",
    );
    const ranking: string = readDashboard(
      "Components",
      "NetworkDevice",
      "InterfaceAttentionUtil.ts",
    );

    expect(preview).toContain("const PREVIEW_ROW_COUNT: number = 6;");
    expect(DEVICE.interfacesPreview).toContain("Up to six ports");

    // Down, then errored, then busiest — in that order.
    const downBand: number = ranking.indexOf("return 3_000_000;");
    const errorBand: number = ranking.indexOf("return 2_000_000 +");
    expect(downBand).toBeGreaterThan(-1);
    expect(errorBand).toBeGreaterThan(downBand);
    expect(DEVICE.interfacesPreview).toContain(
      "down ones first, then ports with errors, then the busiest",
    );
  });

  test("hardware uptime is the SNMP agent's sysUpTime, which wraps after ~497 days", () => {
    const snmp: string = readFrom(
      PACKAGES_ROOT,
      "Probe",
      "Utils",
      "Monitors",
      "MonitorTypes",
      "SnmpMonitor.ts",
    );

    expect(snmp).toContain('sysUpTime: "1.3.6.1.2.1.1.3.0"');
    expect(inventoryUtil).toContain(
      "now.getTime() - systemInfo.sysUpTimeSeconds * 1000",
    );

    // 2^32 hundredths of a second, in days.
    expect(Math.round(2 ** 32 / 100 / 86400)).toBe(497);
    expect(DEVICE.hardwareUptime).toContain("497 days");
    expect(DEVICE.hardwareUptime).toContain("restarts with the SNMP agent");
  });
});

describe("latency and ping texts match what is fetched", () => {
  const trend: string = readDashboard(
    "Components",
    "NetworkDevice",
    "DeviceLatencyTrend.tsx",
  );

  test("the trend is fixed to the past hour, whatever else the page shows", () => {
    expect(trend).toContain("range: TimeRange.PAST_ONE_HOUR");
    expect(DEVICE.latencyTrend).toContain("over the past hour");
    expect(DEVICE.packetLossPeak).toContain("of the past hour");
  });

  test("an hour is bucketed per minute, so max is the slowest MINUTE, not the slowest ping", () => {
    const now: Date = OneUptimeDate.getCurrentDate();

    expect(
      AggregationIntervalUtil.getAggregationIntervalForWindow({
        startDate: new Date(now.getTime() - 60 * 60 * 1000),
        endDate: now,
      }),
    ).toBe(AggregationInterval.Minute);

    // RTT is averaged per bucket, loss is the worst per bucket.
    expect(trend).toContain("aggegationType: AggregationType.Avg");
    expect(trend).toContain("aggegationType: AggregationType.Max");

    expect(DEVICE.latencyTrend).toContain("averaged per minute");
    expect(DEVICE.latencyTrend).toContain(
      "the slowest minute rather than the slowest single ping",
    );
    expect(DEVICE.packetLossPeak).toContain("in any one minute");
  });

  test("'now' is the latest minute WITH A REPLY: a poll no ping answered writes no RTT point", () => {
    const ping: string = readFrom(
      PACKAGES_ROOT,
      "Probe",
      "Utils",
      "Monitors",
      "MonitorTypes",
      "PingMonitor.ts",
    );
    const metricUtil: string = readFrom(
      PACKAGES_ROOT,
      "Common",
      "Server",
      "Utils",
      "Monitor",
      "NetworkDeviceMetricUtil.ts",
    );

    // No replies -> no average RTT...
    expect(ping).toContain(
      "(times.length > 0 ? times.reduce((sum: number, time: number) => { return sum + time; }, 0) / times.length : undefined);",
    );
    // ...and an undefined value is never written as a point.
    expect(metricUtil).toContain(
      "if (metric.value === undefined || metric.value === null) { return; }",
    );
    expect(metricUtil).toContain(
      "value: data.pingResponse.avgRoundTripTimeInMs,",
    );

    // The summary's "now" is simply the last point there is.
    const summary: ReturnType<typeof summarizeLatencySeries> =
      summarizeLatencySeries([
        { time: "2026-09-24T10:00:00.000Z", value: 12 },
        { time: "2026-09-24T10:05:00.000Z", value: 30 },
      ]);

    expect(summary?.latest).toBe(30);
    expect(summary?.max).toBe(30);
    expect(summary?.avg).toBe(21);

    expect(DEVICE.latencyTrend).toContain(
      "Now is the latest minute with a reply",
    );
    expect(DEVICE.latencyTrend).not.toContain("Now is the latest minute,");
  });

  test("jitter is the standard deviation the ping reports", () => {
    const ping: string = readFrom(
      PACKAGES_ROOT,
      "Probe",
      "Utils",
      "Monitors",
      "MonitorTypes",
      "PingMonitor.ts",
    );

    expect(ping).toContain(
      "let jitter: number | undefined = parseStat(res.stddev);",
    );
    expect(DEVICE.pingJitter).toContain("standard deviation");
  });

  test("the loss row's bracket is received out of sent, as the text says", () => {
    const viewModel: string = readDashboard(
      "Components",
      "NetworkDevice",
      "DeviceDiagnosticsViewModel.ts",
    );

    expect(viewModel).toContain(
      "(${result.pingResponse.packetsReceived}/${ result.pingResponse.packetsSent } received)",
    );
    expect(DEVICE.pingPacketLoss).toContain(
      "how many replies came back out of the pings sent",
    );
  });

  test("a traceroute hop's RTT is the FIRST reply on its line", () => {
    const pathMonitor: string = readFrom(
      PACKAGES_ROOT,
      "Probe",
      "Utils",
      "Monitors",
      "MonitorTypes",
      "NetworkPathMonitor.ts",
    );

    // A non-global match returns the first "N ms" on the hop's line.
    expect(pathMonitor).toContain("trimmedLine.match(/(\\d+\\.?\\d*)\\s*ms/)");
    expect(DEVICE.tracerouteRtt).toContain("from the first reply the hop sent");
  });
});

describe("flow texts match the top-talkers query", () => {
  const flowApi: string = readFrom(
    PACKAGES_ROOT,
    "App",
    "FeatureSet",
    "BaseAPI",
    "API",
    "NetworkDeviceFlow.ts",
  );

  test("the top tables are capped at ten rows", () => {
    expect(flowApi).toContain("const TOP_LIMIT: number = 10;");

    for (const text of [
      DEVICE.flowTopSources,
      DEVICE.flowTopDestinations,
      DEVICE.flowTopConversations,
      DEVICE.flowTopProtocolsPorts,
    ]) {
      expect(text).toContain("The 10 ");
      expect(text).toContain("Bytes and Packets are");
    }
  });

  test("records count by when the flow STARTED", () => {
    expect(flowApi).toContain("AND flowStartAt >= ${startSql}");
    expect(flowApi).toContain(
      "toStartOfInterval(flowStartAt, INTERVAL ${bucketSeconds} second)",
    );
    expect(DEVICE.flowTotalTraffic).toContain("flows that started in");
    expect(DEVICE.flowPackets).toContain("flows that started in");
    expect(DEVICE.flowBandwidth).toContain("started in that slice");
  });

  test("the Flows count is records by start time too, not by when they arrived", () => {
    // The three totals come from one statement over the same WHERE clause.
    expect(flowApi).toContain(
      "sum(octets) AS totalOctets, sum(packets) AS totalPackets, count() AS totalFlows FROM ${tableRef} ${whereClause}",
    );
    expect(DEVICE.flowCount).toContain(
      "records this device exported for flows that started in the selected range",
    );
    expect(DEVICE.flowCount).not.toContain("arrived");
  });

  test("conversations are directional pairs", () => {
    expect(flowApi).toContain("GROUP BY srcIp, dstIp");
    expect(DEVICE.flowTopConversations).toContain(
      "counting each direction separately",
    );
  });

  test("protocol/port pairs key on the DESTINATION port", () => {
    expect(flowApi).toContain("GROUP BY protocol, dstPort");
    expect(DEVICE.flowTopProtocolsPorts).toContain("destination port");
  });

  test("sampled exports are not scaled up, and the text admits it", () => {
    // A plain sum of what was exported; the sampling rate is never applied.
    expect(flowApi).toContain("sum(octets) AS totalOctets");
    expect(flowApi).not.toContain("samplingInterval");
    expect(DEVICE.flowTotalTraffic).toContain("it is not scaled up");
  });

  test("the bandwidth chart fills empty slices with zero before Min / Avg / Max", () => {
    const talkers: string = readDashboard(
      "Components",
      "NetworkDevice",
      "FlowTopTalkers.tsx",
    );

    expect(talkers).toContain("series={fillFlowSeriesGaps(");
    expect(talkers).toContain("(point.octets * 8) / 1_000_000 / bucketSeconds");
    expect(DEVICE.flowBandwidth).toContain(
      "slices with no records count as zero",
    );
  });
});

describe("Network Overview texts match the overview endpoint", () => {
  const summaryApi: string = readFrom(
    PACKAGES_ROOT,
    "App",
    "FeatureSet",
    "BaseAPI",
    "API",
    "NetworkSummary.ts",
  );

  test("only the six biggest vendors are listed, and devices with no vendor are Unknown", () => {
    expect(summaryApi).toContain("const VENDOR_LIST_LIMIT: number = 6;");
    expect(summaryApi).toContain(
      'const UNKNOWN_VENDOR_LABEL: string = "Unknown";',
    );
    expect(DEVICE.fleetByVendor).toContain("six most common vendors");
    expect(DEVICE.fleetByVendor).toContain("grouped as Unknown");
    expect(DEVICE.fleetByVendor).toContain("relative to the largest vendor");
  });

  test("the endpoint count is every endpoint row, with no recency filter", () => {
    expect(summaryApi).toContain(
      "NetworkEndpointService.countBy({ query: { projectId: projectId, }, props: props, })",
    );
    expect(DEVICE.fleetEndpoints).toContain("including ones not seen recently");
    expect(SITE.endpoints).toContain("including ones not seen recently");
  });

  test("a site with no rollup is 'no data', not unhealthy", () => {
    expect(summaryApi).toContain("sitesWithNoData += statusCount.siteCount;");
    expect(DEVICE.fleetSites).toContain(
      "sites with no data yet are not counted as unhealthy",
    );
    expect(SITE.sitesWithoutData).toContain("not counted as unhealthy");
  });
});

describe("site texts match SiteUptimeUtil and the rollup", () => {
  function row(
    startsAt: Date,
    endsAt: Date | null,
    isOperationalState: boolean,
  ): SiteStatusTimelineRow {
    return {
      monitorStatusId: isOperationalState ? "operational" : "degraded",
      startsAt: startsAt,
      endsAt: endsAt,
      priority: isOperationalState ? 1 : 2,
      isOperationalState: isOperationalState,
    };
  }

  const END: Date = new Date("2026-09-24T12:00:00.000Z");

  test("any non-operational status is downtime — Degraded as well as Offline", () => {
    const measurement: SiteUptimeMeasurement = SiteUptimeUtil.measureUptime(
      [row(new Date(END.getTime() - MS_PER_DAY), null, false)],
      new Date(END.getTime() - 2 * MS_PER_DAY),
      END,
    );

    expect(measurement.uptimePercent).toBeCloseTo(50, 5);

    for (const text of [SITE.uptime24h, SITE.uptimeWindow]) {
      expect(text).toContain(
        "non-operational status such as Degraded or Offline",
      );
    }
    expect(SITE.uptime30d).toContain("non-operational status");
  });

  test("one full day down in thirty costs about 3.3 points", () => {
    const measurement: SiteUptimeMeasurement = SiteUptimeUtil.measureUptime(
      [
        row(new Date(END.getTime() - 30 * MS_PER_DAY), null, true),
        row(
          new Date(END.getTime() - 2 * MS_PER_DAY),
          new Date(END.getTime() - MS_PER_DAY),
          false,
        ),
      ],
      new Date(END.getTime() - 30 * MS_PER_DAY),
      END,
    );

    expect(100 - measurement.uptimePercent).toBeCloseTo(3.33, 1);
    expect(SITE.uptime30d).toContain("about 3.3 points");
  });

  test("time before the first rollup counts as UP in the totals", () => {
    // A site first rolled up (healthy) a day ago, measured over 30 days.
    const measurement: SiteUptimeMeasurement = SiteUptimeUtil.measureUptime(
      [row(new Date(END.getTime() - MS_PER_DAY), null, true)],
      new Date(END.getTime() - 30 * MS_PER_DAY),
      END,
    );

    expect(measurement.measuredInMs).toBe(30 * MS_PER_DAY);
    expect(measurement.uptimePercent).toBe(100);

    expect(SITE.uptime24h).toContain(
      "time before the site's first health rollup counts as up",
    );
    expect(SITE.uptime30d).toContain(
      "time before the first rollup counts as up",
    );
    expect(SITE.uptimeWindow).toContain(
      "Time before the first rollup counts as up",
    );
  });

  test("...while the daily strip leaves those days blank, which its legend says", () => {
    const entries: ReturnType<typeof SiteUptimeUtil.calculateDailyUptime> =
      SiteUptimeUtil.calculateDailyUptime({
        rows: [row(new Date(END.getTime() - MS_PER_DAY), null, true)],
        days: 3,
        endDate: END,
      });

    expect(entries[0]!.uptimePercent).toBeNull();
    expect(entries[0]!.hasTimelineCoverage).toBe(false);
    expect(entries[2]!.uptimePercent).toBe(100);

    expect(SITE.dailyUptime).toContain(
      "a hollow outline is a day before the site's first health rollup",
    );
  });

  test("maintenance leaves the period entirely, so a fully maintained window has nothing to measure", () => {
    const measurement: SiteUptimeMeasurement = SiteUptimeUtil.measureUptime(
      [row(new Date(END.getTime() - 2 * MS_PER_DAY), null, false)],
      new Date(END.getTime() - MS_PER_DAY),
      END,
      [{ startsAt: new Date(END.getTime() - 2 * MS_PER_DAY), endsAt: null }],
    );

    expect(measurement.measuredInMs).toBe(0);
    expect(SITE.uptime24h).toContain("Scheduled maintenance is left out");
    expect(SITE.uptime30d).toContain("scheduled maintenance left out");
    expect(SITE.uptimeWindow).toContain(
      "leaving out scheduled maintenance on the site or its parents",
    );
  });

  test("the legend's colour thresholds are the strip's own", () => {
    const strip: string = readDashboard(
      "Components",
      "NetworkSite",
      "SiteDailyUptimeStrip.tsx",
    );

    expect(strip).toContain(
      "const DEFAULT_GOOD_THRESHOLD_PERCENT: number = 99.9;",
    );
    expect(strip).toContain("if (entry.uptimePercent >= 95) {");
    expect(SITE.dailyUptime).toContain("Green is 99.9% uptime or better");
    expect(SITE.dailyUptime).toContain("amber 95% or better");
  });

  test("the red threshold on the uptime cards is the page's own", () => {
    const timeline: string = readDashboard(
      "Pages",
      "NetworkSite",
      "View",
      "StatusTimeline.tsx",
    );

    expect(timeline).toContain("uptime !== undefined && uptime < 99");
    expect(SITE.uptimeWindow).toContain("red means below 99%");
  });

  test("the hero's windows are 24 hours and 30 days", () => {
    const hero: string = readDashboard(
      "Components",
      "NetworkSite",
      "SiteStatusHero.tsx",
    );

    expect(hero).toContain("const UPTIME_WINDOW_DAYS: number = 30;");
    expect(hero).toContain("const DAILY_UPTIME_WINDOW_DAYS: number = 1;");
    expect(SITE.uptime24h).toContain("last 24 hours");
    expect(SITE.uptime30d).toContain("last 30 days");
  });

  test("health rolls up the whole subtree; the hero's Devices and Endpoints are the site's own", () => {
    const siteService: string = readFrom(
      PACKAGES_ROOT,
      "Common",
      "Server",
      "Services",
      "NetworkSiteService.ts",
    );
    const hero: string = readDashboard(
      "Components",
      "NetworkSite",
      "SiteStatusHero.tsx",
    );

    expect(siteService).toContain(
      "...(await this.getDescendantSiteIds(site.id, site.projectId)),",
    );
    expect(SITE.health).toContain("at every site beneath it");
    expect(SITE.childSiteStatus).toContain("at every site beneath it");

    // The hero reads devices and endpoints by siteId — no subtree.
    expect(hero).toContain(
      "siteId: props.modelId.toString(), isArchived: false,",
    );
    expect(hero).toContain(
      "modelType: NetworkEndpoint, query: { siteId: props.modelId.toString(), },",
    );
    expect(SITE.devices).toContain("not counting those in child sites");
    expect(SITE.endpoints).toContain("devices assigned to this site");

    // Child Sites is one level: parentSiteId, not the materialized path.
    expect(hero).toContain("parentSiteId: props.modelId.toString(),");
    expect(SITE.childSites).toContain("one level down");
  });

  test("the rollup rule is worst-of by default, with a threshold option in Settings", () => {
    const settings: string = readDashboard(
      "Pages",
      "NetworkSite",
      "View",
      "Settings.tsx",
    );

    expect(settings).toContain("healthRollupPolicy");
    expect(SITE.health).toContain("the worst device status by default");
    expect(SITE.health).toContain("share-of-devices-down rule set in Settings");
  });
});
