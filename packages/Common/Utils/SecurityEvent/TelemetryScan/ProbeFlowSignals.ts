import { JSONObject } from "../../../Types/JSON";
import OneUptimeProbeKind from "../../../Types/Probe/OneUptimeProbeKind";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import {
  SecurityTelemetrySignal,
  SecurityTelemetrySourceKind,
} from "../../../Types/SecurityEvent/SecurityTelemetrySource";
import {
  FLOW_ATTRIBUTES,
  FlowEventStamp,
  FlowWindow,
  NETWORK_ACTIVITY_CLASS_UID,
  NETWORK_SWEEP_MIN_HOSTS,
  NetworkSweepRow,
  PORT_SCAN_MIN_PORTS,
  PortScanRow,
  buildNetworkSweepEvent,
  buildPortScanEvent,
  getFlowEventTime,
  getFlowWindowAttributes,
  getFlowWindowKey,
} from "./FlowSignals";
import { PROBE_WORKS, ProbeJob, ProbeWork } from "./ProbeJob";
import { buildTelemetrySecurityEvent } from "./TelemetrySecurityEvent";

/*
 * ONEUPTIME'S OWN PROBES IN THE PROJECT'S NETWORK FLOWS (#10429).
 *
 * A flow scan's port scan or network sweep whose source is one of
 * OneUptime's own probes (Server/Utils/Probe/OneUptimeProbeAddresses) is
 * read again, destination by destination, and each destination held to
 * what the probe is set to do (ProbeJob): a host on the sweep's port, or a
 * port of the scanned host, is the probe's own work only when every flow
 * the probe sent it is.
 *
 *   - What is the probe's own work is SET ASIDE, never dropped: one
 *     Informational event of its own signal (OneUptimeProbeTraffic) naming
 *     the probe and the work, which no rule for a scan or a sweep reads.
 *     Its port or host is an attribute, not the event's target, so no rule
 *     counting distinct ports or hosts per address counts it either.
 *     Security Events counts it as OneUptime's own probes' on the Network
 *     flows source.
 *   - What is left is counted as anyone's traffic is: when it is a port
 *     scan or a network sweep by itself (PORT_SCAN_MIN_PORTS,
 *     NETWORK_SWEEP_MIN_HOSTS), it is one, Medium as ever, naming the probe
 *     whose address it came from and saying it was beyond the probe's work.
 *     A compromised probe scanning past its job, or another machine sending
 *     from a probe's address, is still reported.
 *   - Fail toward a person: a destination the read did not reach, the last
 *     one a cut read may have reached only part of, and a probe whose work
 *     could not be read are all counted as beyond its work.
 *
 * Pure: the scan reads the rows, the destinations and the job, and hands
 * them here.
 */

export const PROBE_FLOW_ATTRIBUTES: {
  probeId: string;
  probeName: string;
  probeKind: string;
  traffic: string;
  pattern: string;
  work: string;
  ownWorkCount: string;
  otherCount: string;
  destinationPort: string;
  destinationAddress: string;
} = {
  probeId: "oneuptime.probe.id",
  probeName: "oneuptime.probe.name",
  probeKind: "oneuptime.probe.kind",
  traffic: "oneuptime.probe.traffic",
  pattern: "oneuptime.probe.pattern",
  work: "oneuptime.probe.work",
  ownWorkCount: "oneuptime.probe.own_work_count",
  otherCount: "oneuptime.probe.other_count",
  /*
   * Where set-aside traffic went: the swept port, or the scanned host. Kept
   * here, not as the event's target, so no rule that counts distinct ports
   * or hosts per address ever counts OneUptime's own work - the library's
   * Port scan and Network sweep for any source's Network Activity events
   * among them - since those counts leave out an event with no target.
   */
  destinationPort: "oneuptime.probe.destination_port",
  destinationAddress: "oneuptime.probe.destination_address",
};

// How a probe's flagged traffic was read.
export enum ProbeFlowTraffic {
  // What the probe is set to do, and too little else to be a scan: set aside.
  OwnWork = "own-work",
  // Enough beyond what the probe is set to do to be a scan by itself: reported.
  BeyondOwnWork = "beyond-own-work",
  // What the probe is set to do could not be read: reported, as anyone's is.
  WorkUnread = "work-unread",
}

// Which pattern the flagged traffic made.
export enum ProbeFlowPattern {
  PortScan = "port-scan",
  NetworkSweep = "network-sweep",
}

// Which of OneUptime's own probes a flow's source address is.
export interface ProbeFlowIdentity {
  kind: OneUptimeProbeKind;
  // Empty for OneUptime Cloud's probe addresses, which are no one probe.
  probeId: string;
  name: string;
}

// One host a sweep's source reached on its port, by the protocol it used.
export interface ProbeSweepDestination {
  dstIp: string;
  dstName: string;
  protocol: number;
}

// One port a scan's source reached on its host, by the protocol it used.
export interface ProbeScanDestination {
  dstPort: number;
  dstName: string;
  protocol: number;
}

// A flagged row, held to what the probe is set to do.
export interface ProbeTrafficSplit {
  // Hosts (a sweep) or ports (a scan) every flow of which is the probe's work.
  ownWork: number;
  // The kinds of work among them, in PROBE_WORKS order.
  works: Array<ProbeWork>;
  // Hosts or ports with a flow that is not, with those the read did not reach.
  other: number;
  // Some of those it read, sorted, at most SAMPLE_SIZE.
  sampleOther: Array<string>;
}

const SAMPLE_SIZE: number = 10;

const WORK_WORDS: Record<ProbeWork, string> = {
  [ProbeWork.DevicePolling]: "device polling",
  [ProbeWork.Discovery]: "network discovery",
  [ProbeWork.Monitor]: "monitors",
};

interface Tally {
  isOwn: boolean;
  works: Set<ProbeWork>;
}

// "a", "a and b", "a, b and c".
function joinWords(words: Array<string>): string {
  if (words.length <= 1) {
    return words[0] || "";
  }

  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

export function describeProbeWorks(works: Array<ProbeWork>): string {
  return joinWords(
    PROBE_WORKS.filter((work: ProbeWork): boolean => {
      return works.includes(work);
    }).map((work: ProbeWork): string => {
      return WORK_WORDS[work];
    }),
  );
}

// How a message names the probe: `probe "Office"`, `OneUptime probe "US East"`, `OneUptime Cloud`.
export function describeProbe(probe: ProbeFlowIdentity): string {
  const name: string = probe.name.trim();

  switch (probe.kind) {
    case OneUptimeProbeKind.OneUptimeCloud:
      return "OneUptime Cloud";
    case OneUptimeProbeKind.Global:
      return name ? `OneUptime probe "${name}"` : "a OneUptime probe";
    default:
      return name ? `probe "${name}"` : "one of your probes";
  }
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/*
 * The destinations read, tallied by key: one is the probe's own work while
 * every flow of it is. The last a cut read reached may have flows it did not
 * read, so it is not.
 */
function tally<T>(data: {
  destinations: Array<T>;
  keyOf: (destination: T) => string;
  workOf: (destination: T) => ProbeWork | null;
  isCut: boolean;
}): Map<string, Tally> {
  const tallies: Map<string, Tally> = new Map();
  let lastKey: string = "";

  for (const destination of data.destinations) {
    const key: string = data.keyOf(destination);
    const work: ProbeWork | null = data.workOf(destination);
    const entry: Tally = tallies.get(key) || {
      isOwn: true,
      works: new Set<ProbeWork>(),
    };

    if (work) {
      entry.works.add(work);
    } else {
      entry.isOwn = false;
    }

    tallies.set(key, entry);
    lastKey = key;
  }

  if (data.isCut && lastKey) {
    tallies.get(lastKey)!.isOwn = false;
  }

  return tallies;
}

function toSplit(data: {
  tallies: Map<string, Tally>;
  total: number;
  sort: (a: string, b: string) => number;
}): ProbeTrafficSplit {
  const works: Set<ProbeWork> = new Set();
  const other: Array<string> = [];
  let ownWork: number = 0;

  for (const [key, entry] of data.tallies) {
    if (entry.isOwn) {
      ownWork++;

      for (const work of entry.works) {
        works.add(work);
      }
    } else {
      other.push(key);
    }
  }

  // What the read did not reach is counted as beyond the probe's work.
  const unread: number = Math.max(0, data.total - data.tallies.size);

  return {
    ownWork,
    works: PROBE_WORKS.filter((work: ProbeWork): boolean => {
      return works.has(work);
    }),
    other: other.length + unread,
    sampleOther: other.sort(data.sort).slice(0, SAMPLE_SIZE),
  };
}

/*
 * A sweep's hosts held to the probe's work: each host the source reached on
 * the sweep's port, by every protocol it used there.
 */
export function splitProbeSweep(data: {
  row: NetworkSweepRow;
  destinations: Array<ProbeSweepDestination>;
  // The read stopped at its limit: there may be more than it returned.
  isCut: boolean;
  job: ProbeJob;
}): ProbeTrafficSplit {
  return toSplit({
    tallies: tally({
      destinations: data.destinations,
      keyOf: (destination: ProbeSweepDestination): string => {
        return destination.dstIp;
      },
      workOf: (destination: ProbeSweepDestination): ProbeWork | null => {
        return data.job.findWork({
          dstIp: destination.dstIp,
          dstName: destination.dstName,
          dstPort: data.row.dstPort,
          protocol: destination.protocol,
        });
      },
      isCut: data.isCut,
    }),
    total: data.row.hosts,
    sort: (a: string, b: string): number => {
      return a < b ? -1 : a > b ? 1 : 0;
    },
  });
}

/*
 * A port scan's ports held to the probe's work: each port of the scanned
 * host the source reached, by every protocol it used there.
 */
export function splitProbePortScan(data: {
  row: PortScanRow;
  destinations: Array<ProbeScanDestination>;
  isCut: boolean;
  job: ProbeJob;
}): ProbeTrafficSplit {
  return toSplit({
    tallies: tally({
      destinations: data.destinations,
      keyOf: (destination: ProbeScanDestination): string => {
        return String(destination.dstPort);
      },
      workOf: (destination: ProbeScanDestination): ProbeWork | null => {
        return data.job.findWork({
          dstIp: data.row.dstIp,
          dstName: destination.dstName,
          dstPort: destination.dstPort,
          protocol: destination.protocol,
        });
      },
      isCut: data.isCut,
    }),
    total: data.row.ports,
    sort: (a: string, b: string): number => {
      return Number(a) - Number(b);
    },
  });
}

function probeAttributes(data: {
  probe: ProbeFlowIdentity;
  traffic: ProbeFlowTraffic;
  pattern: ProbeFlowPattern;
  split: ProbeTrafficSplit | null;
}): JSONObject {
  const attributes: JSONObject = {
    [PROBE_FLOW_ATTRIBUTES.probeKind]: data.probe.kind,
    [PROBE_FLOW_ATTRIBUTES.traffic]: data.traffic,
    [PROBE_FLOW_ATTRIBUTES.pattern]: data.pattern,
  };

  if (data.probe.probeId) {
    attributes[PROBE_FLOW_ATTRIBUTES.probeId] = data.probe.probeId;
  }

  if (data.probe.name.trim()) {
    attributes[PROBE_FLOW_ATTRIBUTES.probeName] = data.probe.name.trim();
  }

  if (data.split) {
    attributes[PROBE_FLOW_ATTRIBUTES.ownWorkCount] = String(data.split.ownWork);
    attributes[PROBE_FLOW_ATTRIBUTES.otherCount] = String(data.split.other);

    if (data.split.works.length > 0) {
      attributes[PROBE_FLOW_ATTRIBUTES.work] = data.split.works.join(",");
    }
  }

  return attributes;
}

/*
 * A network sweep from one of OneUptime's own probes' addresses: set aside
 * as the probe's own work, or reported for what is beyond it, or - its work
 * unread (split null) - reported as anyone's sweep is. Null for a row that
 * is no sweep at all.
 */
export function buildProbeNetworkSweepEvent(data: {
  row: NetworkSweepRow;
  window: FlowWindow;
  probe: ProbeFlowIdentity;
  split: ProbeTrafficSplit | null;
}): NormalizedSecurityEvent | null {
  const { row, window, probe, split } = data;
  const who: string = `${row.srcIp} (${describeProbe(probe)})`;
  /*
   * What is beyond a probe's work came from its address, which may be
   * shared - a NAT's, or another machine's sending from it - so a report
   * says whose address it is, never that the probe sent it.
   */
  const whose: string = `${row.srcIp}, an address of ${describeProbe(probe)},`;

  if (!split) {
    return buildNetworkSweepEvent(row, window, {
      message: `Network sweep: ${whose} reached port ${row.dstPort} on ${row.hosts} hosts. What the probe is set to check could not be read.`,
      attributes: probeAttributes({
        probe,
        traffic: ProbeFlowTraffic.WorkUnread,
        pattern: ProbeFlowPattern.NetworkSweep,
        split: null,
      }),
    });
  }

  if (split.other >= NETWORK_SWEEP_MIN_HOSTS) {
    const stamp: FlowEventStamp = {
      message: `Network sweep: ${whose} reached port ${row.dstPort} on ${split.other} hosts the probe is not set to check${
        split.ownWork > 0
          ? `, besides ${plural(split.ownWork, "host", "hosts")} of its ${describeProbeWorks(split.works)}`
          : ""
      }`,
      attributes: probeAttributes({
        probe,
        traffic: ProbeFlowTraffic.BeyondOwnWork,
        pattern: ProbeFlowPattern.NetworkSweep,
        split,
      }),
    };

    return buildNetworkSweepEvent(
      { ...row, hosts: split.other, sampleHosts: split.sampleOther },
      window,
      stamp,
    );
  }

  if (row.hosts < NETWORK_SWEEP_MIN_HOSTS || !row.srcIp) {
    return null;
  }

  const sample: Array<string> = [...row.sampleHosts]
    .filter(Boolean)
    .sort()
    .slice(0, SAMPLE_SIZE);

  return buildTelemetrySecurityEvent({
    kind: SecurityTelemetrySourceKind.NetworkFlows,
    signal: SecurityTelemetrySignal.OneUptimeProbeTraffic,
    time: getFlowEventTime(row, window),
    eventUid: `flow:${SecurityTelemetrySignal.OneUptimeProbeTraffic}:${ProbeFlowPattern.NetworkSweep}:${row.srcIp}:${row.dstPort}:${getFlowWindowKey(window)}`,
    classUid: NETWORK_ACTIVITY_CLASS_UID,
    activityName: "Traffic",
    statusName: "",
    severity: OcsfSeverity.Informational,
    message: `OneUptime's own probe traffic: ${who} reached port ${row.dstPort} on ${row.hosts} hosts, ${
      split.other === 0
        ? `all of them its ${describeProbeWorks(split.works)}`
        : `${split.ownWork} of them its ${describeProbeWorks(split.works)} and ${plural(split.other, "other", "others")}, too few to be a sweep`
    }`,
    principalIp: row.srcIp,
    // No target port: see PROBE_FLOW_ATTRIBUTES.destinationPort.
    attributes: {
      ...getFlowWindowAttributes(window, row),
      [FLOW_ATTRIBUTES.distinctHosts]: String(row.hosts),
      [FLOW_ATTRIBUTES.sampleHosts]: sample.join(","),
      [PROBE_FLOW_ATTRIBUTES.destinationPort]: String(row.dstPort),
      ...probeAttributes({
        probe,
        traffic: ProbeFlowTraffic.OwnWork,
        pattern: ProbeFlowPattern.NetworkSweep,
        split,
      }),
    },
  });
}

/*
 * A port scan from one of OneUptime's own probes' addresses, the same way:
 * set aside, reported for what is beyond the probe's work, or reported as
 * anyone's scan is when its work could not be read.
 */
export function buildProbePortScanEvent(data: {
  row: PortScanRow;
  window: FlowWindow;
  probe: ProbeFlowIdentity;
  split: ProbeTrafficSplit | null;
}): NormalizedSecurityEvent | null {
  const { row, window, probe, split } = data;
  const who: string = `${row.srcIp} (${describeProbe(probe)})`;
  /*
   * What is beyond a probe's work came from its address, which may be
   * shared - a NAT's, or another machine's sending from it - so a report
   * says whose address it is, never that the probe sent it.
   */
  const whose: string = `${row.srcIp}, an address of ${describeProbe(probe)},`;

  if (!split) {
    return buildPortScanEvent(row, window, {
      message: `Port scan: ${whose} reached ${row.ports} ports on ${row.dstIp}. What the probe is set to check could not be read.`,
      attributes: probeAttributes({
        probe,
        traffic: ProbeFlowTraffic.WorkUnread,
        pattern: ProbeFlowPattern.PortScan,
        split: null,
      }),
    });
  }

  if (split.other >= PORT_SCAN_MIN_PORTS) {
    return buildPortScanEvent(
      {
        ...row,
        ports: split.other,
        samplePorts: split.sampleOther.map(Number),
      },
      window,
      {
        message: `Port scan: ${whose} reached ${split.other} ports on ${row.dstIp} the probe is not set to check${
          split.ownWork > 0
            ? `, besides ${plural(split.ownWork, "port", "ports")} of its ${describeProbeWorks(split.works)}`
            : ""
        }`,
        attributes: probeAttributes({
          probe,
          traffic: ProbeFlowTraffic.BeyondOwnWork,
          pattern: ProbeFlowPattern.PortScan,
          split,
        }),
      },
    );
  }

  if (row.ports < PORT_SCAN_MIN_PORTS || !row.srcIp || !row.dstIp) {
    return null;
  }

  const sample: Array<number> = [...row.samplePorts]
    .filter((port: number): boolean => {
      return port > 0;
    })
    .sort((a: number, b: number): number => {
      return a - b;
    })
    .slice(0, SAMPLE_SIZE);

  return buildTelemetrySecurityEvent({
    kind: SecurityTelemetrySourceKind.NetworkFlows,
    signal: SecurityTelemetrySignal.OneUptimeProbeTraffic,
    time: getFlowEventTime(row, window),
    eventUid: `flow:${SecurityTelemetrySignal.OneUptimeProbeTraffic}:${ProbeFlowPattern.PortScan}:${row.srcIp}:${row.dstIp}:${getFlowWindowKey(window)}`,
    classUid: NETWORK_ACTIVITY_CLASS_UID,
    activityName: "Traffic",
    statusName: "",
    severity: OcsfSeverity.Informational,
    message: `OneUptime's own probe traffic: ${who} reached ${row.ports} ports on ${row.dstIp}, ${
      split.other === 0
        ? `all of them its ${describeProbeWorks(split.works)}`
        : `${split.ownWork} of them its ${describeProbeWorks(split.works)} and ${plural(split.other, "other", "others")}, too few to be a scan`
    }`,
    principalIp: row.srcIp,
    // No target host: see PROBE_FLOW_ATTRIBUTES.destinationAddress.
    extraObservables: [row.dstIp],
    attributes: {
      ...getFlowWindowAttributes(window, row),
      [FLOW_ATTRIBUTES.distinctPorts]: String(row.ports),
      [FLOW_ATTRIBUTES.samplePorts]: sample.join(","),
      [PROBE_FLOW_ATTRIBUTES.destinationAddress]: row.dstIp,
      ...probeAttributes({
        probe,
        traffic: ProbeFlowTraffic.OwnWork,
        pattern: ProbeFlowPattern.PortScan,
        split,
      }),
    },
  });
}
