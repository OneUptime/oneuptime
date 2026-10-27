import { describe, expect, test } from "@jest/globals";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import {
  SECURITY_TELEMETRY_SIGNAL_ATTRIBUTE,
  SecurityTelemetrySignal,
} from "../../../../Types/SecurityEvent/SecurityTelemetrySource";
import {
  FLOW_ATTRIBUTES,
  FlowPairRow,
  FlowWindow,
  LARGE_TRANSFER_MIN_BYTES,
  NETWORK_SWEEP_MIN_HOSTS,
  NetworkSweepRow,
  PORT_SCAN_MIN_PORTS,
  PortScanRow,
  SWEEP_IGNORED_PORTS,
  buildLargeTransferEvent,
  buildNetworkSweepEvent,
  buildPortScanEvent,
  buildThreatIntelTrafficEvent,
  formatBytes,
  getProtocolName,
  isOutboundPair,
  selectThreatIntelCandidates,
} from "../../../../Utils/SecurityEvent/TelemetryScan/FlowSignals";

/*
 * What network flows say about an attack, read from the rows the database
 * already summed per address or pair for one window of arrivals. Each
 * threshold is where ordinary traffic stops, and is pinned on both sides.
 */

const WINDOW: FlowWindow = {
  from: new Date("2026-10-27T10:00:00.000Z"),
  to: new Date("2026-10-27T10:05:00.000Z"),
};

const BASE: {
  flows: number;
  bytes: number;
  packets: number;
  firstSeen: Date;
  lastSeen: Date;
  deviceId: string;
} = {
  flows: 400,
  bytes: 64000,
  packets: 800,
  firstSeen: new Date("2026-10-27T10:00:12.000Z"),
  lastSeen: new Date("2026-10-27T10:04:40.000Z"),
  deviceId: "0192f1a0-0000-7000-8000-00000000d001",
};

function portScan(overrides: Partial<PortScanRow> = {}): PortScanRow {
  return {
    ...BASE,
    srcIp: "198.51.100.23",
    dstIp: "10.0.0.9",
    ports: 120,
    samplePorts: [443, 22, 80, 3306, 8080],
    ...overrides,
  };
}

function sweep(overrides: Partial<NetworkSweepRow> = {}): NetworkSweepRow {
  return {
    ...BASE,
    srcIp: "10.0.0.5",
    dstPort: 22,
    hosts: 64,
    sampleHosts: ["10.0.1.9", "10.0.1.2"],
    ...overrides,
  };
}

function pair(overrides: Partial<FlowPairRow> = {}): FlowPairRow {
  return {
    ...BASE,
    srcIp: "10.0.0.5",
    dstIp: "203.0.113.50",
    dstPort: 443,
    protocol: 6,
    ...overrides,
  };
}

function signalOf(event: NormalizedSecurityEvent): unknown {
  return event.attributes[SECURITY_TELEMETRY_SIGNAL_ATTRIBUTE];
}

describe("a port scan", () => {
  test("is one address reaching many service ports of one host", () => {
    const event: NormalizedSecurityEvent = buildPortScanEvent(
      portScan(),
      WINDOW,
    )!;

    expect(event.className).toBe("Network Activity");
    expect(event.message).toBe(
      "Port scan: 198.51.100.23 reached 120 ports on 10.0.0.9",
    );
    expect(event.principalIp).toBe("198.51.100.23");
    expect(event.targetIp).toBe("10.0.0.9");
    expect(event.severityName).toBe(OcsfSeverity.Medium);
    expect(event.productName).toBe("OneUptime Network Flows");
    expect(signalOf(event)).toBe(SecurityTelemetrySignal.PortScan);
    // The sample is the ports in order, not the order they arrived in.
    expect(event.attributes[FLOW_ATTRIBUTES.samplePorts]).toBe(
      "22,80,443,3306,8080",
    );
    expect(event.attributes[FLOW_ATTRIBUTES.distinctPorts]).toBe("120");
    expect(event.attributes[FLOW_ATTRIBUTES.deviceId]).toBe(BASE.deviceId);
    expect(event.time).toEqual(BASE.firstSeen);
    expect(event.mitreTechniques).toEqual(["T1046"]);
  });

  test("starts at the threshold", () => {
    expect(
      buildPortScanEvent(portScan({ ports: PORT_SCAN_MIN_PORTS }), WINDOW),
    ).not.toBeNull();
    expect(
      buildPortScanEvent(portScan({ ports: PORT_SCAN_MIN_PORTS - 1 }), WINDOW),
    ).toBeNull();
  });

  test("is one event a pair a window, whatever reads it twice", () => {
    expect(buildPortScanEvent(portScan(), WINDOW)!.eventUid).toBe(
      buildPortScanEvent(portScan({ ports: 300 }), WINDOW)!.eventUid,
    );
    expect(buildPortScanEvent(portScan(), WINDOW)!.eventUid).toBe(
      "flow:port-scan:198.51.100.23:10.0.0.9:2026-10-27T10:00:00.000Z",
    );
  });
});

describe("a network sweep", () => {
  test("is one address reaching one service port on many hosts", () => {
    const event: NormalizedSecurityEvent = buildNetworkSweepEvent(
      sweep(),
      WINDOW,
    )!;

    expect(event.message).toBe(
      "Network sweep: 10.0.0.5 reached port 22 on 64 hosts",
    );
    expect(event.principalIp).toBe("10.0.0.5");
    expect(event.targetPort).toBe(22);
    expect(event.attributes[FLOW_ATTRIBUTES.sampleHosts]).toBe(
      "10.0.1.2,10.0.1.9",
    );
    expect(signalOf(event)).toBe(SecurityTelemetrySignal.NetworkSweep);
  });

  test("starts at the threshold", () => {
    expect(
      buildNetworkSweepEvent(sweep({ hosts: NETWORK_SWEEP_MIN_HOSTS }), WINDOW),
    ).not.toBeNull();
    expect(
      buildNetworkSweepEvent(
        sweep({ hosts: NETWORK_SWEEP_MIN_HOSTS - 1 }),
        WINDOW,
      ),
    ).toBeNull();
  });

  test("never counts the ports clients reach many hosts on every day", () => {
    for (const port of SWEEP_IGNORED_PORTS) {
      expect(
        buildNetworkSweepEvent(sweep({ dstPort: port, hosts: 5000 }), WINDOW),
      ).toBeNull();
    }
  });
});

describe("a large transfer out", () => {
  test("is a private address sending a lot to a public one", () => {
    const event: NormalizedSecurityEvent = buildLargeTransferEvent(
      pair({ bytes: 1.5 * 1024 * 1024 * 1024 }),
      WINDOW,
    )!;

    expect(event.message).toBe(
      "Large transfer out: 10.0.0.5 sent 1.5 GB to 203.0.113.50 on port 443",
    );
    expect(event.severityName).toBe(OcsfSeverity.Low);
    expect(event.attributes[FLOW_ATTRIBUTES.protocol]).toBe("tcp");
    expect(signalOf(event)).toBe(
      SecurityTelemetrySignal.LargeOutboundTransfer,
    );
  });

  test("is only the way data leaves a network", () => {
    const bytes: number = LARGE_TRANSFER_MIN_BYTES;

    expect(buildLargeTransferEvent(pair({ bytes }), WINDOW)).not.toBeNull();
    // Coming in.
    expect(
      buildLargeTransferEvent(
        pair({ bytes, srcIp: "203.0.113.50", dstIp: "10.0.0.5" }),
        WINDOW,
      ),
    ).toBeNull();
    // Between two private addresses: a backup to the next rack.
    expect(
      buildLargeTransferEvent(
        pair({ bytes, dstIp: "192.168.1.20" }),
        WINDOW,
      ),
    ).toBeNull();
    expect(
      buildLargeTransferEvent(pair({ bytes: bytes - 1 }), WINDOW),
    ).toBeNull();
  });

  test("which pairs are outbound", () => {
    expect(isOutboundPair("10.1.2.3", "8.8.8.8")).toBe(true);
    expect(isOutboundPair("172.16.4.4", "2001:4860:4860::8888")).toBe(true);
    expect(isOutboundPair("8.8.8.8", "10.1.2.3")).toBe(false);
    expect(isOutboundPair("not an address", "8.8.8.8")).toBe(false);
  });
});

describe("traffic with a known-bad address", () => {
  test("says which side the address was on", () => {
    const outbound: NormalizedSecurityEvent = buildThreatIntelTrafficEvent(
      pair({ bytes: 2048 }),
      WINDOW,
      "203.0.113.50",
    )!;
    const inbound: NormalizedSecurityEvent = buildThreatIntelTrafficEvent(
      pair({ srcIp: "203.0.113.50", dstIp: "10.0.0.5", dstPort: 22 }),
      WINDOW,
      "203.0.113.50",
    )!;

    expect(outbound.message).toBe(
      "Traffic to a known-bad address: 10.0.0.5 → 203.0.113.50:443 (2.0 KB)",
    );
    expect(inbound.message).toBe(
      "Traffic from a known-bad address: 203.0.113.50 → 10.0.0.5:22 (62.5 KB)",
    );
    expect(outbound.severityName).toBe(OcsfSeverity.High);
    expect(outbound.attributes[FLOW_ATTRIBUTES.indicator]).toBe(
      "203.0.113.50",
    );
    // The enrichment every stored event goes through reads the observables.
    expect(outbound.observables).toContain("203.0.113.50");
    expect(signalOf(outbound)).toBe(
      SecurityTelemetrySignal.ThreatIntelTraffic,
    );
  });

  test("is no event when the known address is not in the pair", () => {
    expect(
      buildThreatIntelTrafficEvent(pair(), WINDOW, "198.51.100.1"),
    ).toBeNull();
    expect(buildThreatIntelTrafficEvent(pair(), WINDOW, "")).toBeNull();
  });

  test("only public addresses are asked about, each once, up to the limit", () => {
    expect(
      selectThreatIntelCandidates(
        [
          "10.0.0.5",
          "203.0.113.50",
          "203.0.113.50",
          "127.0.0.1",
          "198.51.100.9",
          "",
          "8.8.8.8",
        ],
        2,
      ),
    ).toEqual(["203.0.113.50", "198.51.100.9"]);
  });
});

describe("how a message says the traffic", () => {
  test("amounts of data", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
    expect(formatBytes(250 * 1024 * 1024)).toBe("250 MB");
    expect(formatBytes(5 * 1024 ** 5)).toBe("5120 TB");
  });

  test("protocols", () => {
    expect(getProtocolName(6)).toBe("tcp");
    expect(getProtocolName(17)).toBe("udp");
    expect(getProtocolName(1)).toBe("icmp");
    expect(getProtocolName(47)).toBe("47");
    expect(getProtocolName(0)).toBe("");
  });
});
