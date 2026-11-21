import { describe, expect, test } from "@jest/globals";
import OneUptimeProbeKind from "../../../../Types/Probe/OneUptimeProbeKind";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
} from "../../../../Types/SecurityEvent/DetectionRuleLibrary";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import {
  SECURITY_TELEMETRY_SIGNAL_ATTRIBUTE,
  SecurityTelemetrySignal,
  isSetAsideSecurityTelemetrySignal,
} from "../../../../Types/SecurityEvent/SecurityTelemetrySource";
import SigmaRule from "../../../../Types/SecurityEvent/SigmaRule";
import SigmaRuleParser from "../../../../Utils/SecurityEvent/Sigma/SigmaRuleParser";
import {
  FLOW_ATTRIBUTES,
  FlowWindow,
  NetworkSweepRow,
  PortScanRow,
} from "../../../../Utils/SecurityEvent/TelemetryScan/FlowSignals";
import {
  PROBE_FLOW_ATTRIBUTES,
  ProbeFlowIdentity,
  ProbeFlowPattern,
  ProbeFlowTraffic,
  ProbeScanDestination,
  ProbeSweepDestination,
  ProbeTrafficSplit,
  buildProbeNetworkSweepEvent,
  buildProbePortScanEvent,
  describeProbe,
  describeProbeWorks,
  splitProbePortScan,
  splitProbeSweep,
} from "../../../../Utils/SecurityEvent/TelemetryScan/ProbeFlowSignals";
import {
  ProbeJob,
  ProbeJobProtocol,
  ProbeWork,
  getDevicePollTarget,
  getDiscoveryScanRange,
} from "../../../../Utils/SecurityEvent/TelemetryScan/ProbeJob";
import { sigmaRuleMatchesEvent } from "../LogParsers/SigmaTestMatcher";

/*
 * ONEUPTIME'S OWN PROBES IN THE PROJECT'S NETWORK FLOWS (#10429): a probe's
 * sweep or scan is set aside only for what is exactly its work, and what is
 * beyond it is reported, naming the probe. The library's sweep and scan
 * rules read what is reported, never what is set aside.
 */

const WINDOW: FlowWindow = {
  from: new Date("2026-11-21T10:00:00.000Z"),
  to: new Date("2026-11-21T10:05:00.000Z"),
};

const UDP: number = 17;
const TCP: number = 6;
const ICMP: number = 1;

const OFFICE: ProbeFlowIdentity = {
  kind: OneUptimeProbeKind.Project,
  probeId: "0192f1a0-0000-7000-8000-0000000c0001",
  name: "Office probe",
};

const BASE: {
  flows: number;
  bytes: number;
  packets: number;
  firstSeen: Date;
  lastSeen: Date;
  deviceId: string;
} = {
  flows: 80,
  bytes: 9000,
  packets: 80,
  firstSeen: new Date("2026-11-21T10:00:30.000Z"),
  lastSeen: new Date("2026-11-21T10:04:30.000Z"),
  deviceId: "",
};

function hostsOf(prefix: string, count: number): Array<string> {
  return Array.from({ length: count }, (_: unknown, index: number): string => {
    return `${prefix}${index + 1}`;
  });
}

function sweep(
  srcIp: string,
  dstPort: number,
  hosts: Array<string>,
): NetworkSweepRow {
  return {
    ...BASE,
    srcIp,
    dstPort,
    hosts: hosts.length,
    sampleHosts: hosts.slice(0, 10),
  };
}

function scan(srcIp: string, dstIp: string, ports: Array<number>): PortScanRow {
  return {
    ...BASE,
    srcIp,
    dstIp,
    ports: ports.length,
    samplePorts: ports.slice(0, 10),
  };
}

function sweepDestinations(
  hosts: Array<string>,
  protocol: number = UDP,
): Array<ProbeSweepDestination> {
  return hosts.map((dstIp: string): ProbeSweepDestination => {
    return { dstIp, dstName: "", protocol };
  });
}

function scanDestinations(
  ports: Array<number>,
  protocol: number = TCP,
): Array<ProbeScanDestination> {
  return ports.map((dstPort: number): ProbeScanDestination => {
    return { dstPort, dstName: "", protocol };
  });
}

// A probe polling these devices.
function pollingJob(devices: Array<string>): ProbeJob {
  const job: ProbeJob = new ProbeJob();

  for (const hostname of devices) {
    job.addTarget(getDevicePollTarget({ hostname, snmpPort: 161 })!);
  }

  return job;
}

function signalOf(event: NormalizedSecurityEvent | null): unknown {
  return event?.attributes[SECURITY_TELEMETRY_SIGNAL_ATTRIBUTE];
}

function rule(title: string): SigmaRule {
  const entry: DetectionRuleLibraryEntry | undefined =
    DETECTION_RULE_LIBRARY.find(
      (candidate: DetectionRuleLibraryEntry): boolean => {
        return candidate.title === title;
      },
    );

  expect(entry).toBeDefined();

  return SigmaRuleParser.parse(entry!.sigmaRuleYaml);
}

const SWEEP_RULE: string = "Network sweep seen in network flows";
const SCAN_RULE: string = "Port scan seen in network flows";

describe("a probe's sweep, host by host", () => {
  const devices: Array<string> = hostsOf("10.0.0.", 40);

  test("polling exactly its devices: every host is its work", () => {
    expect(
      splitProbeSweep({
        row: sweep("10.0.0.250", 161, devices),
        destinations: sweepDestinations(devices),
        isCut: false,
        job: pollingJob(devices),
      }),
    ).toEqual({
      ownWork: 40,
      works: [ProbeWork.DevicePolling],
      other: 0,
      sampleOther: [],
    });
  });

  test("a host the probe does not poll is beyond its work", () => {
    const split: ProbeTrafficSplit = splitProbeSweep({
      row: sweep("10.0.0.250", 161, [...devices, "10.9.9.9"]),
      destinations: sweepDestinations([...devices, "10.9.9.9"]),
      isCut: false,
      job: pollingJob(devices),
    });

    expect(split.ownWork).toBe(40);
    expect(split.other).toBe(1);
    expect(split.sampleOther).toEqual(["10.9.9.9"]);
  });

  test("a host reached by a protocol the probe does not send there is beyond its work, whatever else it was sent", () => {
    const split: ProbeTrafficSplit = splitProbeSweep({
      row: sweep("10.0.0.250", 161, devices),
      destinations: [
        ...sweepDestinations(devices),
        { dstIp: "10.0.0.1", dstName: "", protocol: TCP },
      ],
      isCut: false,
      job: pollingJob(devices),
    });

    expect(split.ownWork).toBe(39);
    expect(split.other).toBe(1);
    expect(split.sampleOther).toEqual(["10.0.0.1"]);
  });

  test("hosts the read did not reach are counted as beyond the probe's work", () => {
    const split: ProbeTrafficSplit = splitProbeSweep({
      // The row counted 60 hosts; the read returned the first 40.
      row: { ...sweep("10.0.0.250", 161, devices), hosts: 60 },
      destinations: sweepDestinations(devices),
      isCut: false,
      job: pollingJob(devices),
    });

    expect(split.ownWork).toBe(40);
    expect(split.other).toBe(20);
  });

  test("a read cut at its limit: the last host it reached may have more, so it is not the probe's", () => {
    const split: ProbeTrafficSplit = splitProbeSweep({
      row: sweep("10.0.0.250", 161, devices),
      destinations: sweepDestinations(devices),
      isCut: true,
      job: pollingJob(devices),
    });

    expect(split.ownWork).toBe(39);
    expect(split.other).toBe(1);
    expect(split.sampleOther).toEqual(["10.0.0.40"]);
  });

  test("the kinds of work, in the order a sentence names them", () => {
    const job: ProbeJob = pollingJob(devices.slice(0, 20));
    job.addRange(getDiscoveryScanRange({ cidr: "10.0.0.0/24" })!);

    expect(
      splitProbeSweep({
        row: sweep("10.0.0.250", 161, devices),
        destinations: sweepDestinations(devices),
        isCut: false,
        job,
      }).works,
    ).toEqual([ProbeWork.DevicePolling, ProbeWork.Discovery]);
  });
});

describe("a probe's port scan, port by port", () => {
  const ports: Array<number> = Array.from(
    { length: 26 },
    (_: unknown, index: number): number => {
      return 8000 + index;
    },
  );

  function portMonitorsJob(host: string, monitored: Array<number>): ProbeJob {
    const job: ProbeJob = new ProbeJob();

    for (const port of monitored) {
      job.addTarget({
        host,
        services: [
          { protocol: ProbeJobProtocol.Tcp, port, work: ProbeWork.Monitor },
        ],
      });
    }

    return job;
  }

  test("checking exactly its Port monitors: every port is its work", () => {
    expect(
      splitProbePortScan({
        row: scan("10.0.0.250", "10.0.0.9", ports),
        destinations: scanDestinations(ports),
        isCut: false,
        job: portMonitorsJob("10.0.0.9", ports),
      }),
    ).toEqual({
      ownWork: 26,
      works: [ProbeWork.Monitor],
      other: 0,
      sampleOther: [],
    });
  });

  test("ports it does not monitor are beyond its work, sampled in port order", () => {
    const split: ProbeTrafficSplit = splitProbePortScan({
      row: scan("10.0.0.250", "10.0.0.9", [...ports, 23, 22]),
      destinations: scanDestinations([...ports, 23, 22]),
      isCut: false,
      job: portMonitorsJob("10.0.0.9", ports),
    });

    expect(split.ownWork).toBe(26);
    expect(split.other).toBe(2);
    expect(split.sampleOther).toEqual(["22", "23"]);
  });

  test("the same ports on another host are not its work", () => {
    expect(
      splitProbePortScan({
        row: scan("10.0.0.250", "10.0.0.10", ports),
        destinations: scanDestinations(ports),
        isCut: false,
        job: portMonitorsJob("10.0.0.9", ports),
      }).ownWork,
    ).toBe(0);
  });
});

describe("a probe's sweep that is exactly its work", () => {
  const devices: Array<string> = hostsOf("10.0.0.", 40);
  const row: NetworkSweepRow = sweep("10.0.0.250", 161, devices);
  const split: ProbeTrafficSplit = splitProbeSweep({
    row,
    destinations: sweepDestinations(devices),
    isCut: false,
    job: pollingJob(devices),
  });
  const event: NormalizedSecurityEvent = buildProbeNetworkSweepEvent({
    row,
    window: WINDOW,
    probe: OFFICE,
    split,
  })!;

  test("is set aside: Informational, OneUptime's own probe traffic, naming the probe and its work", () => {
    expect(signalOf(event)).toBe(SecurityTelemetrySignal.OneUptimeProbeTraffic);
    expect(isSetAsideSecurityTelemetrySignal(signalOf(event))).toBe(true);
    expect(event.severityName).toBe(OcsfSeverity.Informational);
    expect(event.message).toBe(
      `OneUptime's own probe traffic: 10.0.0.250 (probe "Office probe") reached port 161 on 40 hosts, all of them its device polling`,
    );
    expect(event.principalIp).toBe("10.0.0.250");
    /*
     * The swept port is said in an attribute, not as the event's target:
     * no rule counting distinct ports per address counts OneUptime's work.
     */
    expect(event.targetPort).toBe(0);
    expect(event.attributes[PROBE_FLOW_ATTRIBUTES.destinationPort]).toBe("161");
    expect(event.mitreTechniques).toEqual([]);
    expect(event.attributes).toMatchObject({
      [PROBE_FLOW_ATTRIBUTES.probeId]: OFFICE.probeId,
      [PROBE_FLOW_ATTRIBUTES.probeName]: "Office probe",
      [PROBE_FLOW_ATTRIBUTES.probeKind]: OneUptimeProbeKind.Project,
      [PROBE_FLOW_ATTRIBUTES.traffic]: ProbeFlowTraffic.OwnWork,
      [PROBE_FLOW_ATTRIBUTES.pattern]: ProbeFlowPattern.NetworkSweep,
      [PROBE_FLOW_ATTRIBUTES.work]: ProbeWork.DevicePolling,
      [PROBE_FLOW_ATTRIBUTES.ownWorkCount]: "40",
      [PROBE_FLOW_ATTRIBUTES.otherCount]: "0",
      [FLOW_ATTRIBUTES.distinctHosts]: "40",
    });
  });

  test("its own event, never the sweep's: a window read twice stores it once", () => {
    expect(event.eventUid).toBe(
      `flow:oneuptime-probe-traffic:network-sweep:10.0.0.250:161:${WINDOW.from.toISOString()}`,
    );
  });

  test("the library's sweep and scan rules make no finding of it", () => {
    expect(sigmaRuleMatchesEvent(rule(SWEEP_RULE), event)).toBe(false);
    expect(sigmaRuleMatchesEvent(rule(SCAN_RULE), event)).toBe(false);
  });

  test("a few hosts beyond its work, too few to be a sweep, are said, and it is still set aside", () => {
    const withOthers: Array<string> = [...devices, "10.9.9.1", "10.9.9.2"];
    const others: NormalizedSecurityEvent = buildProbeNetworkSweepEvent({
      row: sweep("10.0.0.250", 161, withOthers),
      window: WINDOW,
      probe: OFFICE,
      split: splitProbeSweep({
        row: sweep("10.0.0.250", 161, withOthers),
        destinations: sweepDestinations(withOthers),
        isCut: false,
        job: pollingJob(devices),
      }),
    })!;

    expect(signalOf(others)).toBe(
      SecurityTelemetrySignal.OneUptimeProbeTraffic,
    );
    expect(others.message).toBe(
      `OneUptime's own probe traffic: 10.0.0.250 (probe "Office probe") reached port 161 on 42 hosts, 40 of them its device polling and 2 others, too few to be a sweep`,
    );
    expect(others.attributes[PROBE_FLOW_ATTRIBUTES.otherCount]).toBe("2");
  });
});

describe("a probe's sweep beyond its work", () => {
  const devices: Array<string> = hostsOf("10.0.0.", 40);
  const strangers: Array<string> = hostsOf("10.7.0.", 45);

  test("is a network sweep, Medium, of the hosts beyond its work, naming the probe", () => {
    const row: NetworkSweepRow = sweep("10.0.0.250", 22, strangers);
    const event: NormalizedSecurityEvent = buildProbeNetworkSweepEvent({
      row,
      window: WINDOW,
      probe: OFFICE,
      split: splitProbeSweep({
        row,
        destinations: sweepDestinations(strangers, TCP),
        isCut: false,
        job: pollingJob(devices),
      }),
    })!;

    expect(signalOf(event)).toBe(SecurityTelemetrySignal.NetworkSweep);
    expect(event.severityName).toBe(OcsfSeverity.Medium);
    expect(event.message).toBe(
      `Network sweep: 10.0.0.250 (probe "Office probe") reached port 22 on 45 hosts beyond what it is set to check`,
    );
    expect(event.attributes).toMatchObject({
      [PROBE_FLOW_ATTRIBUTES.probeId]: OFFICE.probeId,
      [PROBE_FLOW_ATTRIBUTES.traffic]: ProbeFlowTraffic.BeyondOwnWork,
      [PROBE_FLOW_ATTRIBUTES.ownWorkCount]: "0",
      [PROBE_FLOW_ATTRIBUTES.otherCount]: "45",
      [FLOW_ATTRIBUTES.distinctHosts]: "45",
    });
    // The same event a sweep from anyone makes: one per source, port and window.
    expect(event.eventUid).toBe(
      `flow:network-sweep:10.0.0.250:22:${WINDOW.from.toISOString()}`,
    );
    expect(sigmaRuleMatchesEvent(rule(SWEEP_RULE), event)).toBe(true);
  });

  test("its work beside it is set aside from the count, and said", () => {
    const mixed: Array<string> = [...devices, ...strangers];
    const row: NetworkSweepRow = sweep("10.0.0.250", 161, mixed);
    const event: NormalizedSecurityEvent = buildProbeNetworkSweepEvent({
      row,
      window: WINDOW,
      probe: OFFICE,
      split: splitProbeSweep({
        row,
        destinations: sweepDestinations(mixed),
        isCut: false,
        job: pollingJob(devices),
      }),
    })!;

    expect(signalOf(event)).toBe(SecurityTelemetrySignal.NetworkSweep);
    expect(event.message).toBe(
      `Network sweep: 10.0.0.250 (probe "Office probe") reached port 161 on 45 hosts beyond what it is set to check, besides 40 hosts of its device polling`,
    );
    expect(event.attributes[FLOW_ATTRIBUTES.sampleHosts]).toBe(
      [...strangers].sort().slice(0, 10).join(","),
    );
  });

  test("a probe whose work could not be read: reported as anyone's sweep, naming it", () => {
    const row: NetworkSweepRow = sweep("10.0.0.250", 161, devices);
    const event: NormalizedSecurityEvent = buildProbeNetworkSweepEvent({
      row,
      window: WINDOW,
      probe: OFFICE,
      split: null,
    })!;

    expect(signalOf(event)).toBe(SecurityTelemetrySignal.NetworkSweep);
    expect(event.severityName).toBe(OcsfSeverity.Medium);
    expect(event.attributes[PROBE_FLOW_ATTRIBUTES.traffic]).toBe(
      ProbeFlowTraffic.WorkUnread,
    );
    expect(event.message).toBe(
      `Network sweep: 10.0.0.250 (probe "Office probe") reached port 161 on 40 hosts. What this probe is set to check could not be read.`,
    );
    expect(sigmaRuleMatchesEvent(rule(SWEEP_RULE), event)).toBe(true);
  });
});

describe("a probe's port scan", () => {
  const ports: Array<number> = Array.from(
    { length: 26 },
    (_: unknown, index: number): number => {
      return 8000 + index;
    },
  );

  test("of exactly its Port monitors is set aside", () => {
    const job: ProbeJob = new ProbeJob();

    for (const port of ports) {
      job.addTarget({
        host: "10.0.0.9",
        services: [
          { protocol: ProbeJobProtocol.Tcp, port, work: ProbeWork.Monitor },
        ],
      });
    }

    const row: PortScanRow = scan("10.0.0.250", "10.0.0.9", ports);
    const event: NormalizedSecurityEvent = buildProbePortScanEvent({
      row,
      window: WINDOW,
      probe: OFFICE,
      split: splitProbePortScan({
        row,
        destinations: scanDestinations(ports),
        isCut: false,
        job,
      }),
    })!;

    expect(signalOf(event)).toBe(SecurityTelemetrySignal.OneUptimeProbeTraffic);
    expect(event.severityName).toBe(OcsfSeverity.Informational);
    expect(event.message).toBe(
      `OneUptime's own probe traffic: 10.0.0.250 (probe "Office probe") reached 26 ports on 10.0.0.9, all of them its monitors`,
    );
    expect(event.eventUid).toBe(
      `flow:oneuptime-probe-traffic:port-scan:10.0.0.250:10.0.0.9:${WINDOW.from.toISOString()}`,
    );
    expect(event.attributes[PROBE_FLOW_ATTRIBUTES.pattern]).toBe(
      ProbeFlowPattern.PortScan,
    );
    expect(sigmaRuleMatchesEvent(rule(SCAN_RULE), event)).toBe(false);
  });

  test("beyond its monitors is a port scan, naming the probe", () => {
    const row: PortScanRow = scan("10.0.0.250", "10.0.0.9", ports);
    const event: NormalizedSecurityEvent = buildProbePortScanEvent({
      row,
      window: WINDOW,
      probe: OFFICE,
      split: splitProbePortScan({
        row,
        destinations: scanDestinations(ports),
        isCut: false,
        job: new ProbeJob(),
      }),
    })!;

    expect(signalOf(event)).toBe(SecurityTelemetrySignal.PortScan);
    expect(event.severityName).toBe(OcsfSeverity.Medium);
    expect(event.message).toBe(
      `Port scan: 10.0.0.250 (probe "Office probe") reached 26 ports on 10.0.0.9 beyond what it is set to check`,
    );
    expect(event.attributes[FLOW_ATTRIBUTES.samplePorts]).toBe(
      ports.slice(0, 10).join(","),
    );
    expect(sigmaRuleMatchesEvent(rule(SCAN_RULE), event)).toBe(true);
  });

  test("whose work could not be read is reported as anyone's", () => {
    const event: NormalizedSecurityEvent = buildProbePortScanEvent({
      row: scan("10.0.0.250", "10.0.0.9", ports),
      window: WINDOW,
      probe: OFFICE,
      split: null,
    })!;

    expect(signalOf(event)).toBe(SecurityTelemetrySignal.PortScan);
    expect(event.attributes[PROBE_FLOW_ATTRIBUTES.traffic]).toBe(
      ProbeFlowTraffic.WorkUnread,
    );
  });
});

describe("a row that is no scan or sweep at all", () => {
  test("makes no event, set aside or not", () => {
    const few: Array<string> = hostsOf("10.0.0.", 5);

    expect(
      buildProbeNetworkSweepEvent({
        row: sweep("10.0.0.250", 161, few),
        window: WINDOW,
        probe: OFFICE,
        split: splitProbeSweep({
          row: sweep("10.0.0.250", 161, few),
          destinations: sweepDestinations(few),
          isCut: false,
          job: pollingJob(few),
        }),
      }),
    ).toBeNull();
  });
});

describe("how the messages name probes and their work", () => {
  test("a project's probe, one of OneUptime's, and OneUptime Cloud's addresses", () => {
    expect(describeProbe(OFFICE)).toBe(`probe "Office probe"`);
    expect(
      describeProbe({
        kind: OneUptimeProbeKind.Global,
        probeId: "x",
        name: "US East",
      }),
    ).toBe(`OneUptime probe "US East"`);
    expect(
      describeProbe({
        kind: OneUptimeProbeKind.OneUptimeCloud,
        probeId: "",
        name: "OneUptime Cloud",
      }),
    ).toBe("OneUptime Cloud");
    expect(
      describeProbe({
        kind: OneUptimeProbeKind.Project,
        probeId: "x",
        name: " ",
      }),
    ).toBe("one of your probes");
  });

  test("the work, in one order, joined as a sentence joins it", () => {
    expect(describeProbeWorks([ProbeWork.Monitor])).toBe("monitors");
    expect(
      describeProbeWorks([ProbeWork.Discovery, ProbeWork.DevicePolling]),
    ).toBe("device polling and network discovery");
    expect(
      describeProbeWorks([
        ProbeWork.Monitor,
        ProbeWork.Discovery,
        ProbeWork.DevicePolling,
      ]),
    ).toBe("device polling, network discovery and monitors");
  });

  test('ICMP to a polled device counts as its polling: NetFlow v5\'s echo request is "port" 2048', () => {
    const devices: Array<string> = hostsOf("10.0.0.", 40);

    expect(
      splitProbeSweep({
        row: sweep("10.0.0.250", 2048, devices),
        destinations: sweepDestinations(devices, ICMP),
        isCut: false,
        job: pollingJob(devices),
      }).ownWork,
    ).toBe(40);
  });
});
