import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import MonitorProbe from "../../../../../Models/DatabaseModels/MonitorProbe";
import NetworkDevice from "../../../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiscoveryScan from "../../../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import { Results } from "../../../../../Server/Services/AnalyticsDatabaseService";
import MonitorProbeService from "../../../../../Server/Services/MonitorProbeService";
import MonitorService from "../../../../../Server/Services/MonitorService";
import NetworkDeviceDiscoveryScanService from "../../../../../Server/Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceService from "../../../../../Server/Services/NetworkDeviceService";
import NetworkFlowService from "../../../../../Server/Services/NetworkFlowService";
import ThreatIntelIndicatorService from "../../../../../Server/Services/ThreatIntelIndicatorService";
import { Statement } from "../../../../../Server/Utils/AnalyticsDatabase/Statement";
import logger from "../../../../../Server/Utils/Logger";
import { DnsResolutionCache } from "../../../../../Server/Utils/Monitor/DnsResolutionCache";
import OneUptimeProbeAddresses, {
  OneUptimeProbe,
  OneUptimeProbeAddressSource,
} from "../../../../../Server/Utils/Probe/OneUptimeProbeAddresses";
import FlowSecurityScan from "../../../../../Server/Utils/SecurityEvent/TelemetryScan/FlowSecurityScan";
import ProbeJobReader from "../../../../../Server/Utils/SecurityEvent/TelemetryScan/ProbeJobReader";
import { TelemetryScanWindow } from "../../../../../Server/Utils/SecurityEvent/TelemetryScan/TelemetryScanStatements";
import { TelemetryWindowRead } from "../../../../../Server/Utils/SecurityEvent/TelemetryScan/TelemetryScanTypes";
import IP from "../../../../../Types/IP/IP";
import Includes from "../../../../../Types/BaseDatabase/Includes";
import { JSONObject } from "../../../../../Types/JSON";
import MonitorStep from "../../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../../Types/ObjectID";
import Port from "../../../../../Types/Port";
import OneUptimeProbeKind from "../../../../../Types/Probe/OneUptimeProbeKind";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
} from "../../../../../Types/SecurityEvent/DetectionRuleLibrary";
import NormalizedSecurityEvent from "../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../../Types/SecurityEvent/OcsfSeverity";
import {
  SECURITY_TELEMETRY_SIGNAL_ATTRIBUTE,
  SecurityTelemetrySignal,
} from "../../../../../Types/SecurityEvent/SecurityTelemetrySource";
import SigmaRule from "../../../../../Types/SecurityEvent/SigmaRule";
import { DiscoveryScanStatus } from "../../../../../Utils/NetworkDiscovery/DiscoveryScanStatus";
import SigmaRuleParser from "../../../../../Utils/SecurityEvent/Sigma/SigmaRuleParser";
import {
  EPHEMERAL_PORT_START,
  NETWORK_SWEEP_MIN_HOSTS,
  PORT_SCAN_MIN_PORTS,
  SWEEP_IGNORED_PORTS,
} from "../../../../../Utils/SecurityEvent/TelemetryScan/FlowSignals";
import {
  PROBE_FLOW_ATTRIBUTES,
  ProbeFlowTraffic,
} from "../../../../../Utils/SecurityEvent/TelemetryScan/ProbeFlowSignals";
import { readStatementValues } from "../../../../Helpers/StatementEcho";
import { sigmaRuleMatchesEvent } from "../../../../Utils/SecurityEvent/LogParsers/SigmaTestMatcher";

/*
 * SECURITY EVENTS AND ONEUPTIME'S OWN PROBES (#10429), a window of the
 * project's network flows read whole: the flows are summed the way each
 * statement asks, OneUptime's own probes and what each is set to do are
 * stood in for, and the window's events come out as the scan stores them.
 *
 *   - a probe doing exactly its SNMP polling, discovery and port monitoring
 *     raises no sweep or scan: its traffic is set aside, Informational and
 *     named, and the library's rules make no finding of it;
 *   - the same probe scanning beyond its work, and another address in its
 *     network, still raise one - and the rules find them;
 *   - fail toward a person: a probe that was not checking in, or whose work
 *     cannot be read, is reported as anyone's.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-00000000c101",
);
const OFFICE_ID: string = "0192f1a0-0000-7000-8000-00000000c102";
const US_EAST_ID: string = "0192f1a0-0000-7000-8000-00000000c103";

const WINDOW: TelemetryScanWindow = {
  projectId: PROJECT_ID,
  arrivedAfter: new Date("2026-11-21T10:00:00.000Z"),
  arrivedUntil: new Date("2026-11-21T10:05:00.000Z"),
  happenedAfter: new Date("2026-11-21T09:00:00.000Z"),
};

// The probe's address on its LAN, as its heartbeat lists it.
const OFFICE_ADDRESS: string = "10.0.0.250";
// Another machine on the probe's network.
const NEIGHBOUR_ADDRESS: string = "10.0.0.251";

const UDP: number = 17;
const TCP: number = 6;
const ICMP: number = 1;

interface Flow {
  srcIp: string;
  dstIp: string;
  dstPort: number;
  protocol: number;
  dstName?: string;
}

function hostsOf(prefix: string, count: number): Array<string> {
  return Array.from({ length: count }, (_: unknown, index: number): string => {
    return `${prefix}${index + 1}`;
  });
}

const DEVICES: Array<string> = hostsOf("10.0.0.", 40);
const SCANNED_RANGE_HOSTS: Array<string> = hostsOf("10.20.0.", 35);
const MONITORED_PORTS: Array<number> = Array.from(
  { length: 26 },
  (_: unknown, index: number): number => {
    return 8000 + index;
  },
);

// A probe polling its devices: an echo request (NetFlow v5's "port" 2048), then SNMP.
function polling(srcIp: string, devices: Array<string>): Array<Flow> {
  return devices.flatMap((dstIp: string): Array<Flow> => {
    return [
      { srcIp, dstIp, dstPort: 2048, protocol: ICMP },
      { srcIp, dstIp, dstPort: 161, protocol: UDP },
    ];
  });
}

// A discovery sweep: ICMP to each address, SNMP and NBSTAT to those that answered.
function discovery(srcIp: string, hosts: Array<string>): Array<Flow> {
  return hosts.flatMap((dstIp: string): Array<Flow> => {
    return [
      { srcIp, dstIp, dstPort: 2048, protocol: ICMP },
      { srcIp, dstIp, dstPort: 161, protocol: UDP },
      { srcIp, dstIp, dstPort: 137, protocol: UDP },
    ];
  });
}

function portChecks(
  srcIp: string,
  dstIp: string,
  ports: Array<number>,
): Array<Flow> {
  return ports.map((dstPort: number): Flow => {
    return { srcIp, dstIp, dstPort, protocol: TCP };
  });
}

function sshSweep(srcIp: string, hosts: Array<string>): Array<Flow> {
  return hosts.map((dstIp: string): Flow => {
    return { srcIp, dstIp, dstPort: 22, protocol: TCP };
  });
}

// ---------- ClickHouse, summing the window's flows as each statement asks ----------

function answer(rows: Array<JSONObject>): Results {
  return {
    json: (): Promise<unknown> => {
      return Promise.resolve({ data: rows });
    },
  } as unknown as Results;
}

function isServicePort(port: number): boolean {
  return port > 0 && port < EPHEMERAL_PORT_START;
}

// The source addresses a statement is held to, and how.
function sourceFilterOf(statement: Statement): {
  addresses: Array<string>;
  only: boolean;
} | null {
  const only: boolean = statement.query.includes(" AND srcIp IN (");
  const excluded: boolean = statement.query.includes(" AND srcIp NOT IN (");

  if (!only && !excluded) {
    return null;
  }

  const list: unknown = readStatementValues(statement).find(
    (value: unknown): boolean => {
      return value instanceof Includes || Array.isArray(value);
    },
  );
  const addresses: Array<string> = (
    list instanceof Includes ? list.values : (list as Array<unknown>)
  ).map(String);

  return { addresses, only };
}

function heldTo(
  flow: Flow,
  filter: { addresses: Array<string>; only: boolean } | null,
): boolean {
  if (!filter) {
    return true;
  }

  return filter.only
    ? filter.addresses.includes(flow.srcIp)
    : !filter.addresses.includes(flow.srcIp);
}

const SUMS: JSONObject = {
  flows: "1",
  bytes: "120",
  packets: "1",
  firstSeen: "2026-11-21 10:00:30.000000000",
  lastSeen: "2026-11-21 10:04:30.000000000",
  deviceId: "",
};

function groupBy<K extends string>(
  flows: Array<Flow>,
  keyOf: (flow: Flow) => K,
): Map<K, Array<Flow>> {
  const groups: Map<K, Array<Flow>> = new Map();

  for (const flow of flows) {
    const key: K = keyOf(flow);
    groups.set(key, [...(groups.get(key) || []), flow]);
  }

  return groups;
}

function distinct<T>(values: Array<T>): Array<T> {
  return Array.from(new Set(values));
}

interface Reads {
  statements: Array<Statement>;
}

function standFlows(
  flows: Array<Flow>,
  options?: { failDestinations?: boolean },
): Reads {
  const reads: Reads = { statements: [] };

  jest.spyOn(NetworkFlowService, "executeQuery").mockImplementation((async (
    statement: Statement,
  ): Promise<Results> => {
    reads.statements.push(statement);

    const query: string = statement.query;
    const values: Array<unknown> = readStatementValues(statement);

    if (query.includes("GROUP BY dstIp, protocol")) {
      if (options?.failDestinations) {
        throw new Error("The read timed out.");
      }

      // A sweep's hosts, read again: by the bound source and port.
      const rows: Array<JSONObject> = [];

      for (const [key, group] of groupBy(
        flows.filter((flow: Flow): boolean => {
          return values.includes(flow.srcIp) && values.includes(flow.dstPort);
        }),
        (flow: Flow): string => {
          return `${flow.dstIp}|${flow.protocol}`;
        },
      )) {
        rows.push({
          dstIp: key.split("|")[0]!,
          protocol: Number(key.split("|")[1]),
          dstName: group[0]!.dstName || "",
          flows: String(group.length),
        });
      }

      return answer(
        rows.sort((a: JSONObject, b: JSONObject): number => {
          return String(a["dstIp"]).localeCompare(String(b["dstIp"]));
        }),
      );
    }

    if (query.includes("GROUP BY dstPort, protocol")) {
      if (options?.failDestinations) {
        throw new Error("The read timed out.");
      }

      // A scan's ports, read again: by the bound source and host.
      const rows: Array<JSONObject> = [];

      for (const [key, group] of groupBy(
        flows.filter((flow: Flow): boolean => {
          return (
            values.includes(flow.srcIp) &&
            values.includes(flow.dstIp) &&
            isServicePort(flow.dstPort)
          );
        }),
        (flow: Flow): string => {
          return `${flow.dstPort}|${flow.protocol}`;
        },
      )) {
        rows.push({
          dstPort: Number(key.split("|")[0]),
          protocol: Number(key.split("|")[1]),
          dstName: group[0]!.dstName || "",
          flows: String(group.length),
        });
      }

      return answer(rows);
    }

    const filter: { addresses: Array<string>; only: boolean } | null =
      sourceFilterOf(statement);

    if (query.includes("AS ports")) {
      const rows: Array<JSONObject> = [];

      for (const [key, group] of groupBy(
        flows.filter((flow: Flow): boolean => {
          return heldTo(flow, filter);
        }),
        (flow: Flow): string => {
          return `${flow.srcIp}|${flow.dstIp}`;
        },
      )) {
        const ports: Array<number> = distinct(
          group
            .map((flow: Flow): number => {
              return flow.dstPort;
            })
            .filter(isServicePort),
        );

        if (ports.length >= PORT_SCAN_MIN_PORTS) {
          rows.push({
            srcIp: key.split("|")[0]!,
            dstIp: key.split("|")[1]!,
            ports: String(ports.length),
            samplePorts: ports.slice(0, 10),
            ...SUMS,
          });
        }
      }

      return answer(rows);
    }

    if (query.includes("AS hosts")) {
      const rows: Array<JSONObject> = [];

      for (const [key, group] of groupBy(
        flows.filter((flow: Flow): boolean => {
          return (
            heldTo(flow, filter) &&
            isServicePort(flow.dstPort) &&
            !SWEEP_IGNORED_PORTS.includes(flow.dstPort)
          );
        }),
        (flow: Flow): string => {
          return `${flow.srcIp}|${flow.dstPort}`;
        },
      )) {
        const hosts: Array<string> = distinct(
          group.map((flow: Flow): string => {
            return flow.dstIp;
          }),
        );

        if (hosts.length >= NETWORK_SWEEP_MIN_HOSTS) {
          rows.push({
            srcIp: key.split("|")[0]!,
            dstPort: Number(key.split("|")[1]),
            hosts: String(hosts.length),
            sampleHosts: hosts.slice(0, 10),
            ...SUMS,
          });
        }
      }

      return answer(rows);
    }

    // Large transfers: none of these flows moves a gigabyte.
    return answer([]);
  }) as never);

  return reads;
}

// ---------- OneUptime's own probes, and what each is set to do ----------

function probe(data: {
  kind?: OneUptimeProbeKind;
  probeId: string;
  name: string;
  addresses: Array<string>;
  lastAlive?: Date | null;
}): OneUptimeProbe {
  return {
    kind: data.kind || OneUptimeProbeKind.Project,
    probeId: data.probeId,
    name: data.name,
    lastAlive:
      data.lastAlive === undefined
        ? new Date("2026-11-21T10:04:00.000Z")
        : data.lastAlive,
    addresses: data.addresses.map((value: string) => {
      return { value, source: OneUptimeProbeAddressSource.Interface };
    }),
  };
}

const OFFICE: OneUptimeProbe = probe({
  probeId: OFFICE_ID,
  name: "Office probe",
  addresses: [OFFICE_ADDRESS],
});

function standProbes(data: {
  own?: Array<OneUptimeProbe>;
  global?: Array<OneUptimeProbe>;
  cloud?: OneUptimeProbe | null;
}): void {
  jest
    .spyOn(OneUptimeProbeAddresses, "readProjectProbes")
    .mockResolvedValue({ probes: data.own || [], isComplete: true });
  jest
    .spyOn(OneUptimeProbeAddresses, "readGlobalProbes")
    .mockResolvedValue({ probes: data.global || [], isComplete: true });
  jest
    .spyOn(OneUptimeProbeAddresses, "getOneUptimeCloud")
    .mockReturnValue(data.cloud || null);
}

// The values a QueryHelper.any filter holds.
function anyOf(filter: unknown): Array<string> {
  const parameters: Record<string, unknown> | undefined =
    filter instanceof FindOperator
      ? (filter.objectLiteralParameters as Record<string, unknown>)
      : undefined;
  const value: unknown = parameters ? Object.values(parameters)[0] : undefined;

  return Array.isArray(value) ? value.map(String) : [];
}

// The probe ids a job read asks for.
function probeIdsOf(query: unknown): Array<string> {
  return anyOf((query as JSONObject)["probeId"]);
}

function portMonitor(host: string, port: number): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.id = ObjectID.generate();
  monitor.monitorType = MonitorType.Port;

  const step: MonitorStep = new MonitorStep();
  step.setMonitorDestination(new IP(host));
  step.setPort(new Port(port));

  const steps: MonitorSteps = new MonitorSteps();
  steps.data!.monitorStepsInstanceArray = [step];
  monitor.monitorSteps = steps;

  return monitor;
}

interface Work {
  devices?: Array<string>;
  discovery?: Array<NetworkDeviceDiscoveryScan>;
  monitors?: Array<Monitor>;
}

function standWork(
  byProbe: Record<string, Work>,
  options?: { fail?: boolean },
): void {
  jest
    .spyOn(NetworkDeviceService, "findAllBy")
    .mockImplementation((async (input: {
      query: unknown;
    }): Promise<Array<NetworkDevice>> => {
      if (options?.fail) {
        throw new Error("The database is down.");
      }

      return probeIdsOf(input.query).flatMap(
        (id: string): Array<NetworkDevice> => {
          return (byProbe[id]?.devices || []).map((hostname: string) => {
            const device: NetworkDevice = new NetworkDevice();
            device.hostname = hostname;
            device.snmpPort = 161;
            return device;
          });
        },
      );
    }) as never);

  jest
    .spyOn(NetworkDeviceDiscoveryScanService, "findBy")
    .mockImplementation((async (input: { query: unknown }) => {
      return probeIdsOf(input.query).flatMap(
        (id: string): Array<NetworkDeviceDiscoveryScan> => {
          return byProbe[id]?.discovery || [];
        },
      );
    }) as never);

  const assignments: Map<string, Monitor> = new Map();

  jest
    .spyOn(MonitorProbeService, "findAllBy")
    .mockImplementation((async (input: {
      query: unknown;
    }): Promise<Array<MonitorProbe>> => {
      return probeIdsOf(input.query).flatMap(
        (id: string): Array<MonitorProbe> => {
          return (byProbe[id]?.monitors || []).map((monitor: Monitor) => {
            assignments.set(monitor.id!.toString(), monitor);
            const assignment: MonitorProbe = new MonitorProbe();
            assignment.monitorId = monitor.id!;
            return assignment;
          });
        },
      );
    }) as never);

  jest.spyOn(MonitorService, "findBy").mockImplementation((async (input: {
    query: JSONObject;
  }): Promise<Array<Monitor>> => {
    return anyOf(input.query["_id"])
      .map((id: string): Monitor | undefined => {
        return assignments.get(id);
      })
      .filter(Boolean) as Array<Monitor>;
  }) as never);
}

function scanOf(data: {
  cidr: string;
  isNetbiosLookupEnabled?: boolean;
}): NetworkDeviceDiscoveryScan {
  const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
  scan.cidr = data.cidr;
  scan.status = DiscoveryScanStatus.InProgress;
  scan.startedAt = new Date("2026-11-21T09:58:00.000Z");
  scan.snmpPort = 161;
  scan.isNetbiosLookupEnabled = Boolean(data.isNetbiosLookupEnabled);
  return scan;
}

// ---------- What comes out ----------

async function readWindow(): Promise<TelemetryWindowRead> {
  return FlowSecurityScan.readWindow({ window: WINDOW });
}

function signalOf(event: NormalizedSecurityEvent): unknown {
  return event.attributes[SECURITY_TELEMETRY_SIGNAL_ATTRIBUTE];
}

// The port a set-aside sweep reached, as its attributes say it.
function sweptPortOf(event: NormalizedSecurityEvent): number {
  return Number(event.attributes[PROBE_FLOW_ATTRIBUTES.destinationPort]);
}

function eventsOf(
  read: TelemetryWindowRead,
  signal: SecurityTelemetrySignal,
): Array<NormalizedSecurityEvent> {
  return read.events.filter((event: NormalizedSecurityEvent): boolean => {
    return signalOf(event) === signal;
  });
}

function rule(title: string): SigmaRule {
  const entry: DetectionRuleLibraryEntry | undefined =
    DETECTION_RULE_LIBRARY.find(
      (candidate: DetectionRuleLibraryEntry): boolean => {
        return candidate.title === title;
      },
    );

  return SigmaRuleParser.parse(entry!.sigmaRuleYaml);
}

// What the library's sweep and scan rules would find in the window.
function findings(read: TelemetryWindowRead): Array<string> {
  const rules: Array<[string, SigmaRule]> = [
    ["sweep", rule("Network sweep seen in network flows")],
    ["scan", rule("Port scan seen in network flows")],
  ];

  return read.events.flatMap(
    (event: NormalizedSecurityEvent): Array<string> => {
      return rules
        .filter(([, sigma]: [string, SigmaRule]): boolean => {
          return sigmaRuleMatchesEvent(sigma, event);
        })
        .map(([name]: [string, SigmaRule]): string => {
          return `${name} from ${event.principalIp}`;
        });
    },
  );
}

beforeEach(() => {
  // The failures below are logged as warnings: kept out of the test's output.
  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
  jest
    .spyOn(ThreatIntelIndicatorService, "hasIndicatorsForProject")
    .mockResolvedValue(false);
  ProbeJobReader.setDnsCacheForTests(
    new DnsResolutionCache({
      resolver: async (): Promise<Array<string>> => {
        return [];
      },
    }),
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a probe doing exactly its work raises no sweep or scan", () => {
  test("SNMP polling of 40 devices: set aside, Informational, naming the probe - and the sweep rule makes no finding", async () => {
    standFlows(polling(OFFICE_ADDRESS, DEVICES));
    standProbes({ own: [OFFICE] });
    standWork({ [OFFICE_ID]: { devices: DEVICES } });

    const read: TelemetryWindowRead = await readWindow();

    expect(eventsOf(read, SecurityTelemetrySignal.NetworkSweep)).toEqual([]);
    expect(eventsOf(read, SecurityTelemetrySignal.PortScan)).toEqual([]);

    // Port 161, and the echo requests NetFlow v5 writes as "port" 2048.
    const setAside: Array<NormalizedSecurityEvent> = eventsOf(
      read,
      SecurityTelemetrySignal.OneUptimeProbeTraffic,
    );

    expect(setAside.map(sweptPortOf).sort()).toEqual([161, 2048]);

    for (const event of setAside) {
      expect(event.severityName).toBe(OcsfSeverity.Informational);
      expect(event.principalIp).toBe(OFFICE_ADDRESS);
      expect(event.attributes).toMatchObject({
        [PROBE_FLOW_ATTRIBUTES.probeId]: OFFICE_ID,
        [PROBE_FLOW_ATTRIBUTES.probeName]: "Office probe",
        [PROBE_FLOW_ATTRIBUTES.traffic]: ProbeFlowTraffic.OwnWork,
        [PROBE_FLOW_ATTRIBUTES.work]: "device-polling",
        [PROBE_FLOW_ATTRIBUTES.ownWorkCount]: "40",
        [PROBE_FLOW_ATTRIBUTES.otherCount]: "0",
      });
    }

    expect(findings(read)).toEqual([]);
  });

  test("a discovery scan's sweep of its range, SNMP and NBSTAT: set aside", async () => {
    standFlows(discovery(OFFICE_ADDRESS, SCANNED_RANGE_HOSTS));
    standProbes({ own: [OFFICE] });
    standWork({
      [OFFICE_ID]: {
        discovery: [
          scanOf({ cidr: "10.20.0.0/24", isNetbiosLookupEnabled: true }),
        ],
      },
    });

    const read: TelemetryWindowRead = await readWindow();

    expect(
      eventsOf(read, SecurityTelemetrySignal.OneUptimeProbeTraffic)
        .map(sweptPortOf)
        .sort((a: number, b: number): number => {
          return a - b;
        }),
    ).toEqual([137, 161, 2048]);
    expect(eventsOf(read, SecurityTelemetrySignal.NetworkSweep)).toEqual([]);
    expect(findings(read)).toEqual([]);
  });

  test("26 Port monitors on one host: set aside, and the scan rule makes no finding", async () => {
    standFlows(portChecks(OFFICE_ADDRESS, "10.0.0.9", MONITORED_PORTS));
    standProbes({ own: [OFFICE] });
    standWork({
      [OFFICE_ID]: {
        monitors: MONITORED_PORTS.map((port: number): Monitor => {
          return portMonitor("10.0.0.9", port);
        }),
      },
    });

    const read: TelemetryWindowRead = await readWindow();
    const setAside: Array<NormalizedSecurityEvent> = eventsOf(
      read,
      SecurityTelemetrySignal.OneUptimeProbeTraffic,
    );

    expect(setAside).toHaveLength(1);
    expect(
      setAside[0]!.attributes[PROBE_FLOW_ATTRIBUTES.destinationAddress],
    ).toBe("10.0.0.9");
    // Still found by the host, for an analyst correlating on it.
    expect(setAside[0]!.observables).toContain("10.0.0.9");
    expect(setAside[0]!.attributes[PROBE_FLOW_ATTRIBUTES.work]).toBe("monitor");
    expect(eventsOf(read, SecurityTelemetrySignal.PortScan)).toEqual([]);
    expect(findings(read)).toEqual([]);
  });

  test("all three at once, read once each", async () => {
    standFlows([
      ...polling(OFFICE_ADDRESS, DEVICES),
      ...discovery(OFFICE_ADDRESS, SCANNED_RANGE_HOSTS),
      ...portChecks(OFFICE_ADDRESS, "10.0.0.9", MONITORED_PORTS),
    ]);
    standProbes({ own: [OFFICE] });
    standWork({
      [OFFICE_ID]: {
        devices: DEVICES,
        discovery: [
          scanOf({ cidr: "10.20.0.0/24", isNetbiosLookupEnabled: true }),
        ],
        monitors: MONITORED_PORTS.map((port: number): Monitor => {
          return portMonitor("10.0.0.9", port);
        }),
      },
    });

    const read: TelemetryWindowRead = await readWindow();

    expect(
      read.events.every((event: NormalizedSecurityEvent): boolean => {
        return (
          signalOf(event) === SecurityTelemetrySignal.OneUptimeProbeTraffic
        );
      }),
    ).toBe(true);
    expect(findings(read)).toEqual([]);
    // What the probe is set to do is read once for the window.
    expect(NetworkDeviceService.findAllBy).toHaveBeenCalledTimes(1);
  });
});

describe("what is beyond a probe's work is still reported", () => {
  test("the probe sweeping SSH on 45 hosts it is not set to check: a network sweep naming it, and a finding", async () => {
    const strangers: Array<string> = hostsOf("10.7.0.", 45);
    standFlows([
      ...polling(OFFICE_ADDRESS, DEVICES),
      ...sshSweep(OFFICE_ADDRESS, strangers),
    ]);
    standProbes({ own: [OFFICE] });
    standWork({ [OFFICE_ID]: { devices: DEVICES } });

    const read: TelemetryWindowRead = await readWindow();
    const sweeps: Array<NormalizedSecurityEvent> = eventsOf(
      read,
      SecurityTelemetrySignal.NetworkSweep,
    );

    expect(sweeps).toHaveLength(1);
    expect(sweeps[0]!.severityName).toBe(OcsfSeverity.Medium);
    expect(sweeps[0]!.targetPort).toBe(22);
    expect(sweeps[0]!.message).toBe(
      `Network sweep: ${OFFICE_ADDRESS} (probe "Office probe") reached port 22 on 45 hosts beyond what it is set to check`,
    );
    expect(sweeps[0]!.attributes[PROBE_FLOW_ATTRIBUTES.traffic]).toBe(
      ProbeFlowTraffic.BeyondOwnWork,
    );
    expect(findings(read)).toEqual([`sweep from ${OFFICE_ADDRESS}`]);
  });

  test("the probe polling its devices and 35 more on 161: a sweep of the 35, its own polling set from the count", async () => {
    const extra: Array<string> = hostsOf("10.9.0.", 35);
    standFlows(polling(OFFICE_ADDRESS, [...DEVICES, ...extra]));
    standProbes({ own: [OFFICE] });
    standWork({ [OFFICE_ID]: { devices: DEVICES } });

    const read: TelemetryWindowRead = await readWindow();
    const sweeps: Array<NormalizedSecurityEvent> = eventsOf(
      read,
      SecurityTelemetrySignal.NetworkSweep,
    );

    expect(
      sweeps
        .map((event: NormalizedSecurityEvent): string => {
          return `${event.targetPort}: ${event.attributes["network.distinct_hosts"]}`;
        })
        .sort(),
    ).toEqual(["161: 35", "2048: 35"]);
    expect(findings(read)).toEqual([
      `sweep from ${OFFICE_ADDRESS}`,
      `sweep from ${OFFICE_ADDRESS}`,
    ]);
  });

  test("another address in the probe's network doing the probe's exact polling: a sweep, and a finding", async () => {
    standFlows([
      ...polling(OFFICE_ADDRESS, DEVICES),
      ...polling(NEIGHBOUR_ADDRESS, DEVICES),
    ]);
    standProbes({ own: [OFFICE] });
    standWork({ [OFFICE_ID]: { devices: DEVICES } });

    const read: TelemetryWindowRead = await readWindow();
    const sweeps: Array<NormalizedSecurityEvent> = eventsOf(
      read,
      SecurityTelemetrySignal.NetworkSweep,
    );

    expect(
      sweeps
        .map((event: NormalizedSecurityEvent): string => {
          return `${event.principalIp}:${event.targetPort}`;
        })
        .sort(),
    ).toEqual([`${NEIGHBOUR_ADDRESS}:161`, `${NEIGHBOUR_ADDRESS}:2048`]);

    // Its sweep is anyone's: it names no probe.
    const onSnmp: NormalizedSecurityEvent = sweeps.find(
      (event: NormalizedSecurityEvent): boolean => {
        return event.targetPort === 161;
      },
    )!;

    expect(onSnmp.attributes[PROBE_FLOW_ATTRIBUTES.probeId]).toBeUndefined();
    expect(onSnmp.message).toBe(
      `Network sweep: ${NEIGHBOUR_ADDRESS} reached port 161 on 40 hosts`,
    );
    // The probe's own polling is still set aside beside it.
    expect(
      eventsOf(read, SecurityTelemetrySignal.OneUptimeProbeTraffic),
    ).toHaveLength(2);
    expect(findings(read)).toEqual([
      `sweep from ${NEIGHBOUR_ADDRESS}`,
      `sweep from ${NEIGHBOUR_ADDRESS}`,
    ]);
  });

  test("the probe scanning a host's ports it does not monitor: a port scan naming it", async () => {
    standFlows(portChecks(OFFICE_ADDRESS, "10.0.0.9", MONITORED_PORTS));
    standProbes({ own: [OFFICE] });
    standWork({ [OFFICE_ID]: { devices: DEVICES } });

    const read: TelemetryWindowRead = await readWindow();
    const scans: Array<NormalizedSecurityEvent> = eventsOf(
      read,
      SecurityTelemetrySignal.PortScan,
    );

    expect(scans).toHaveLength(1);
    expect(scans[0]!.attributes[PROBE_FLOW_ATTRIBUTES.probeId]).toBe(OFFICE_ID);
    expect(findings(read)).toEqual([`scan from ${OFFICE_ADDRESS}`]);
  });

  test("the probe's discovery sweep outside its scan's range: a sweep", async () => {
    standFlows(discovery(OFFICE_ADDRESS, hostsOf("10.21.0.", 35)));
    standProbes({ own: [OFFICE] });
    standWork({
      [OFFICE_ID]: { discovery: [scanOf({ cidr: "10.20.0.0/24" })] },
    });

    const read: TelemetryWindowRead = await readWindow();

    expect(eventsOf(read, SecurityTelemetrySignal.NetworkSweep).length).toBe(3);
    expect(
      eventsOf(read, SecurityTelemetrySignal.OneUptimeProbeTraffic),
    ).toEqual([]);
  });

  test("a discovery scan that finished long ago excuses nothing", async () => {
    const finished: NetworkDeviceDiscoveryScan = scanOf({
      cidr: "10.20.0.0/24",
    });
    finished.status = DiscoveryScanStatus.Completed;
    finished.startedAt = new Date("2026-11-21T06:00:00.000Z");
    finished.completedAt = new Date("2026-11-21T06:30:00.000Z");

    standFlows(discovery(OFFICE_ADDRESS, SCANNED_RANGE_HOSTS));
    standProbes({ own: [OFFICE] });
    standWork({ [OFFICE_ID]: { discovery: [finished] } });

    const read: TelemetryWindowRead = await readWindow();

    expect(eventsOf(read, SecurityTelemetrySignal.NetworkSweep).length).toBe(3);
  });
});

describe("fail toward a person", () => {
  test("a probe that was not checking in: its address is anyone's", async () => {
    standFlows(polling(OFFICE_ADDRESS, DEVICES));
    standProbes({
      own: [
        probe({
          probeId: OFFICE_ID,
          name: "Office probe",
          addresses: [OFFICE_ADDRESS],
          lastAlive: new Date("2026-11-21T07:00:00.000Z"),
        }),
      ],
    });
    standWork({ [OFFICE_ID]: { devices: DEVICES } });

    const read: TelemetryWindowRead = await readWindow();
    const sweeps: Array<NormalizedSecurityEvent> = eventsOf(
      read,
      SecurityTelemetrySignal.NetworkSweep,
    );

    expect(sweeps).toHaveLength(2);
    expect(
      sweeps[0]!.attributes[PROBE_FLOW_ATTRIBUTES.probeId],
    ).toBeUndefined();
    expect(NetworkDeviceService.findAllBy).not.toHaveBeenCalled();
  });

  test("a probe whose work cannot be read: its sweeps are reported, naming it", async () => {
    standFlows(polling(OFFICE_ADDRESS, DEVICES));
    standProbes({ own: [OFFICE] });
    standWork({ [OFFICE_ID]: { devices: DEVICES } }, { fail: true });

    const read: TelemetryWindowRead = await readWindow();
    const sweeps: Array<NormalizedSecurityEvent> = eventsOf(
      read,
      SecurityTelemetrySignal.NetworkSweep,
    );

    expect(sweeps).toHaveLength(2);
    expect(sweeps[0]!.attributes[PROBE_FLOW_ATTRIBUTES.traffic]).toBe(
      ProbeFlowTraffic.WorkUnread,
    );
    expect(findings(read)).toHaveLength(2);
  });

  test("a probe's flows that cannot be read again: reported, naming it", async () => {
    standFlows(polling(OFFICE_ADDRESS, DEVICES), { failDestinations: true });
    standProbes({ own: [OFFICE] });
    standWork({ [OFFICE_ID]: { devices: DEVICES } });

    const read: TelemetryWindowRead = await readWindow();

    expect(eventsOf(read, SecurityTelemetrySignal.NetworkSweep)).toHaveLength(
      2,
    );
    expect(
      eventsOf(read, SecurityTelemetrySignal.OneUptimeProbeTraffic),
    ).toEqual([]);
  });

  test("probes that cannot be read at all set nothing aside", async () => {
    standFlows(polling(OFFICE_ADDRESS, DEVICES));
    jest
      .spyOn(OneUptimeProbeAddresses, "readProjectProbes")
      .mockRejectedValue(new Error("The database is down."));
    jest
      .spyOn(OneUptimeProbeAddresses, "readGlobalProbes")
      .mockResolvedValue({ probes: [], isComplete: true });

    const read: TelemetryWindowRead = await readWindow();

    expect(eventsOf(read, SecurityTelemetrySignal.NetworkSweep)).toHaveLength(
      2,
    );
  });

  test("a probe set to do nothing: its sweep is beyond its work, with nothing read again", async () => {
    const reads: Reads = standFlows(polling(OFFICE_ADDRESS, DEVICES));
    standProbes({ own: [OFFICE] });
    standWork({});

    const read: TelemetryWindowRead = await readWindow();

    expect(eventsOf(read, SecurityTelemetrySignal.NetworkSweep)).toHaveLength(
      2,
    );
    expect(
      reads.statements.some((statement: Statement): boolean => {
        return statement.query.includes("GROUP BY dstIp, protocol");
      }),
    ).toBe(false);
  });
});

describe("how the window is read", () => {
  test("everyone's scans and sweeps are read without the probes' addresses, and the probes' apart", async () => {
    const reads: Reads = standFlows([]);
    standProbes({ own: [OFFICE] });
    standWork({});

    await readWindow();

    const held: Array<{ addresses: Array<string>; only: boolean } | null> =
      reads.statements
        .filter((statement: Statement): boolean => {
          return (
            statement.query.includes("AS ports") ||
            statement.query.includes("AS hosts")
          );
        })
        .map(sourceFilterOf);

    expect(held).toEqual([
      { addresses: [OFFICE_ADDRESS], only: false },
      { addresses: [OFFICE_ADDRESS], only: false },
      { addresses: [OFFICE_ADDRESS], only: true },
      { addresses: [OFFICE_ADDRESS], only: true },
    ]);
  });

  test("a project with none of OneUptime's probes reads as it always did", async () => {
    const reads: Reads = standFlows(polling(NEIGHBOUR_ADDRESS, DEVICES));
    standProbes({});

    const read: TelemetryWindowRead = await readWindow();

    expect(
      reads.statements.map((statement: Statement): unknown => {
        return sourceFilterOf(statement);
      }),
    ).toEqual([null, null, null]);
    expect(eventsOf(read, SecurityTelemetrySignal.NetworkSweep)).toHaveLength(
      2,
    );
  });

  test("the rows read again count as rows read", async () => {
    standFlows(polling(OFFICE_ADDRESS, DEVICES));
    standProbes({ own: [OFFICE] });
    standWork({ [OFFICE_ID]: { devices: DEVICES } });

    const read: TelemetryWindowRead = await readWindow();

    // Two sweep rows of the probe's, and 40 hosts read again for each.
    expect(read.recordsRead).toBe(2 + 80);
  });
});

describe("OneUptime's own probes", () => {
  test("a global probe's Port monitors of the project's host are set aside", async () => {
    standFlows(portChecks("34.1.2.3", "203.0.113.9", MONITORED_PORTS));
    standProbes({
      global: [
        probe({
          kind: OneUptimeProbeKind.Global,
          probeId: US_EAST_ID,
          name: "US East",
          addresses: ["34.1.2.3"],
        }),
      ],
    });
    standWork({
      [US_EAST_ID]: {
        monitors: MONITORED_PORTS.map((port: number): Monitor => {
          return portMonitor("203.0.113.9", port);
        }),
      },
    });

    const read: TelemetryWindowRead = await readWindow();
    const setAside: Array<NormalizedSecurityEvent> = eventsOf(
      read,
      SecurityTelemetrySignal.OneUptimeProbeTraffic,
    );

    expect(setAside).toHaveLength(1);
    expect(setAside[0]!.message).toContain(`(OneUptime probe "US East")`);
    expect(findings(read)).toEqual([]);
  });

  test("an address in OneUptime Cloud's ranges, checking the project's monitors on a global probe: set aside", async () => {
    standFlows(portChecks("35.205.11.131", "203.0.113.9", MONITORED_PORTS));
    standProbes({
      global: [
        probe({
          kind: OneUptimeProbeKind.Global,
          probeId: US_EAST_ID,
          name: "US East",
          addresses: ["34.1.2.3"],
        }),
      ],
      cloud: {
        kind: OneUptimeProbeKind.OneUptimeCloud,
        probeId: "",
        name: "OneUptime Cloud",
        lastAlive: null,
        addresses: [
          {
            value: "35.205.11.0/24",
            source: OneUptimeProbeAddressSource.Setting,
          },
        ],
      },
    });
    standWork({
      [US_EAST_ID]: {
        monitors: MONITORED_PORTS.map((port: number): Monitor => {
          return portMonitor("203.0.113.9", port);
        }),
      },
    });

    const read: TelemetryWindowRead = await readWindow();
    const setAside: Array<NormalizedSecurityEvent> = eventsOf(
      read,
      SecurityTelemetrySignal.OneUptimeProbeTraffic,
    );

    expect(setAside).toHaveLength(1);
    expect(setAside[0]!.message).toContain("(OneUptime Cloud)");
    expect(setAside[0]!.attributes[PROBE_FLOW_ATTRIBUTES.probeKind]).toBe(
      OneUptimeProbeKind.OneUptimeCloud,
    );
    expect(findings(read)).toEqual([]);
  });

  test("an address in OneUptime Cloud's ranges scanning beyond the project's monitors: a port scan", async () => {
    standFlows(portChecks("35.205.11.131", "203.0.113.10", MONITORED_PORTS));
    standProbes({
      cloud: {
        kind: OneUptimeProbeKind.OneUptimeCloud,
        probeId: "",
        name: "OneUptime Cloud",
        lastAlive: null,
        addresses: [
          {
            value: "35.205.11.0/24",
            source: OneUptimeProbeAddressSource.Setting,
          },
        ],
      },
    });
    standWork({});

    const read: TelemetryWindowRead = await readWindow();

    expect(eventsOf(read, SecurityTelemetrySignal.PortScan)).toHaveLength(1);
    expect(findings(read)).toEqual(["scan from 35.205.11.131"]);
  });
});
