import { describe, expect, test } from "@jest/globals";
import Hostname from "../../../../Types/API/Hostname";
import URL from "../../../../Types/API/URL";
import IP from "../../../../Types/IP/IP";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import Port from "../../../../Types/Port";
import { DiscoveryScanStatus } from "../../../../Utils/NetworkDiscovery/DiscoveryScanStatus";
import {
  DISCOVERY_FLOW_GRACE_IN_MINUTES,
  ProbeJob,
  ProbeJobFlow,
  ProbeJobProtocol,
  ProbeJobRange,
  ProbeJobTarget,
  ProbeWork,
  getDevicePollTarget,
  getDiscoveryScanRange,
  getMonitorTargets,
  getProbeJobProtocol,
  isDiscoveryScanInWindow,
  normalizeProbeJobName,
} from "../../../../Utils/SecurityEvent/TelemetryScan/ProbeJob";

/*
 * WHAT A PROBE IS SET TO DO, AS THE NETWORK SEES IT (#10429): Security
 * Events sets a flow aside as the probe's own only when it is exactly that.
 * A destination the probe does not reach, a port or protocol it does not
 * send there, or a discovery range outside its run is not the probe's work.
 */

const TCP: number = 6;
const UDP: number = 17;
const ICMP: number = 1;
const ICMPV6: number = 58;

function flow(overrides: Partial<ProbeJobFlow>): ProbeJobFlow {
  return {
    dstIp: "10.0.0.1",
    dstName: "",
    dstPort: 161,
    protocol: UDP,
    ...overrides,
  };
}

function monitorSteps(
  ...destinations: Array<{
    destination: URL | Hostname | IP;
    port?: number;
  }>
): MonitorSteps {
  const steps: MonitorSteps = new MonitorSteps();

  steps.data!.monitorStepsInstanceArray = destinations.map(
    (item: { destination: URL | Hostname | IP; port?: number }) => {
      const step: MonitorStep = new MonitorStep();
      step.setMonitorDestination(item.destination);

      if (item.port !== undefined) {
        step.setPort(new Port(item.port));
      }

      return step;
    },
  );

  return steps;
}

describe("a flow's protocol", () => {
  test("TCP, UDP and ICMP, for IPv4 and IPv6", () => {
    expect(getProbeJobProtocol(TCP)).toBe(ProbeJobProtocol.Tcp);
    expect(getProbeJobProtocol(UDP)).toBe(ProbeJobProtocol.Udp);
    expect(getProbeJobProtocol(ICMP)).toBe(ProbeJobProtocol.Icmp);
    expect(getProbeJobProtocol(ICMPV6)).toBe(ProbeJobProtocol.Icmp);
  });

  test("a protocol a probe never sends, or none, is no work of one", () => {
    expect(getProbeJobProtocol(0)).toBeNull();
    expect(getProbeJobProtocol(47)).toBeNull();
    expect(getProbeJobProtocol(132)).toBeNull();
  });

  test("a name is keyed without case or the root's dot", () => {
    expect(normalizeProbeJobName(" Core-SW-01.Corp.Example.com. ")).toBe(
      "core-sw-01.corp.example.com",
    );
    expect(normalizeProbeJobName(undefined)).toBe("");
  });
});

describe("device polling", () => {
  const job: ProbeJob = new ProbeJob();
  job.addTarget(getDevicePollTarget({ hostname: "10.0.0.1", snmpPort: 161 })!);
  job.addTarget(getDevicePollTarget({ hostname: "10.0.0.2", snmpPort: 1161 })!);

  test("SNMP on the device's port is the probe's polling", () => {
    expect(job.findWork(flow({ dstIp: "10.0.0.1" }))).toBe(
      ProbeWork.DevicePolling,
    );
    expect(job.findWork(flow({ dstIp: "10.0.0.2", dstPort: 1161 }))).toBe(
      ProbeWork.DevicePolling,
    );
  });

  test("a poll is ping-first: ICMP is the probe's polling, whatever port it carries", () => {
    // NetFlow v5 writes an echo request's type and code as "port" 2048.
    expect(
      job.findWork(flow({ dstIp: "10.0.0.1", dstPort: 2048, protocol: ICMP })),
    ).toBe(ProbeWork.DevicePolling);
    expect(
      job.findWork(flow({ dstIp: "10.0.0.1", dstPort: 0, protocol: ICMP })),
    ).toBe(ProbeWork.DevicePolling);
  });

  test("another port, or SNMP over TCP, on a polled device is not", () => {
    expect(job.findWork(flow({ dstIp: "10.0.0.1", dstPort: 22 }))).toBeNull();
    expect(job.findWork(flow({ dstIp: "10.0.0.2", dstPort: 161 }))).toBeNull();
    expect(
      job.findWork(flow({ dstIp: "10.0.0.1", dstPort: 161, protocol: TCP })),
    ).toBeNull();
  });

  test("a device the probe does not poll is not", () => {
    expect(job.findWork(flow({ dstIp: "10.0.0.3" }))).toBeNull();
  });

  test("a device with no port says is polled on 161", () => {
    expect(
      getDevicePollTarget({ hostname: "10.0.0.9", snmpPort: null })!.services,
    ).toEqual([
      {
        protocol: ProbeJobProtocol.Icmp,
        port: 0,
        work: ProbeWork.DevicePolling,
      },
      {
        protocol: ProbeJobProtocol.Udp,
        port: 161,
        work: ProbeWork.DevicePolling,
      },
    ]);
  });

  test("a device with no address to dial adds nothing", () => {
    expect(getDevicePollTarget({ hostname: "  " })).toBeNull();
    expect(getDevicePollTarget({})).toBeNull();
  });

  test("an address however it is written", () => {
    const ipv6: ProbeJob = new ProbeJob();
    ipv6.addTarget(getDevicePollTarget({ hostname: "2001:DB8::1" })!);

    expect(ipv6.findWork(flow({ dstIp: "2001:db8:0::1" }))).toBe(
      ProbeWork.DevicePolling,
    );
  });
});

describe("a device polled by its DNS name", () => {
  const job: ProbeJob = new ProbeJob();
  job.addTarget(
    getDevicePollTarget({ hostname: "Core-SW-01.corp.example.com" })!,
  );

  test("a flow that names its destination so is the probe's polling", () => {
    expect(
      job.findWork(
        flow({ dstIp: "10.9.9.9", dstName: "core-sw-01.corp.example.com." }),
      ),
    ).toBe(ProbeWork.DevicePolling);
  });

  test("with no name, only the addresses OneUptime resolved it to", () => {
    expect(job.findWork(flow({ dstIp: "10.9.9.9" }))).toBeNull();

    job.addResolvedAddresses("core-sw-01.corp.example.com", ["10.9.9.9"]);

    expect(job.findWork(flow({ dstIp: "10.9.9.9" }))).toBe(
      ProbeWork.DevicePolling,
    );
  });

  test("the names to resolve, each once", () => {
    expect(job.getNames()).toEqual(["core-sw-01.corp.example.com"]);
  });

  test("an address resolved for a name the job does not hold adds nothing", () => {
    const other: ProbeJob = new ProbeJob();
    other.addResolvedAddresses("unknown.example.com", ["10.1.1.1"]);

    expect(other.isEmpty()).toBe(true);
  });
});

describe("discovery", () => {
  const scan: {
    cidr: string;
    snmpPort: number;
    isNetbiosLookupEnabled: boolean;
  } = {
    cidr: "10.20.0.0/24",
    snmpPort: 161,
    isNetbiosLookupEnabled: true,
  };

  test("a scan's range: ICMP to every address, SNMP on its port, NBSTAT when it looks names up", () => {
    const range: ProbeJobRange = getDiscoveryScanRange(scan)!;
    const job: ProbeJob = new ProbeJob();
    job.addRange(range);

    expect(range.target).toBe("10.20.0.0/24");
    expect(
      job.findWork(
        flow({ dstIp: "10.20.0.77", dstPort: 2048, protocol: ICMP }),
      ),
    ).toBe(ProbeWork.Discovery);
    expect(job.findWork(flow({ dstIp: "10.20.0.77" }))).toBe(
      ProbeWork.Discovery,
    );
    expect(job.findWork(flow({ dstIp: "10.20.0.77", dstPort: 137 }))).toBe(
      ProbeWork.Discovery,
    );
  });

  test("outside the range, or a port the scan never sends, is not", () => {
    const job: ProbeJob = new ProbeJob();
    job.addRange(getDiscoveryScanRange(scan)!);

    expect(job.findWork(flow({ dstIp: "10.20.1.77" }))).toBeNull();
    expect(job.findWork(flow({ dstIp: "10.20.0.77", dstPort: 22 }))).toBeNull();
    expect(
      job.findWork(flow({ dstIp: "10.20.0.77", dstPort: 445, protocol: TCP })),
    ).toBeNull();
  });

  test("NBSTAT only when the scan looks NetBIOS names up", () => {
    const job: ProbeJob = new ProbeJob();
    job.addRange(
      getDiscoveryScanRange({ ...scan, isNetbiosLookupEnabled: false })!,
    );

    expect(
      job.findWork(flow({ dstIp: "10.20.0.77", dstPort: 137 })),
    ).toBeNull();
  });

  test("an ICMP scan sends no SNMP", () => {
    const job: ProbeJob = new ProbeJob();
    job.addRange(
      getDiscoveryScanRange({
        cidr: "10.20.0.0/24",
        isSnmpEnabled: false,
      })!,
    );

    expect(job.findWork(flow({ dstIp: "10.20.0.77" }))).toBeNull();
    expect(
      job.findWork(
        flow({ dstIp: "10.20.0.77", dstPort: 2048, protocol: ICMP }),
      ),
    ).toBe(ProbeWork.Discovery);
  });

  test("each of a scan's credential sets, on its own port", () => {
    const job: ProbeJob = new ProbeJob();
    job.addRange(
      getDiscoveryScanRange({
        cidr: "10.20.0.0/24",
        snmpConfigs: [
          { id: "a", snmpVersion: "V2c", snmpPort: 161 },
          { id: "b", snmpVersion: "V2c", snmpPort: 1161 },
        ],
      })!,
    );

    expect(job.findWork(flow({ dstIp: "10.20.0.77" }))).toBe(
      ProbeWork.Discovery,
    );
    expect(job.findWork(flow({ dstIp: "10.20.0.77", dstPort: 1161 }))).toBe(
      ProbeWork.Discovery,
    );
  });

  test("an octet range, address by address", () => {
    const job: ProbeJob = new ProbeJob();
    job.addRange(getDiscoveryScanRange({ cidr: "10.16-22.0-255.51-66" })!);

    expect(job.findWork(flow({ dstIp: "10.17.5.51" }))).toBe(
      ProbeWork.Discovery,
    );
    // Between the range's lowest and highest, but its last octet is outside 51-66.
    expect(job.findWork(flow({ dstIp: "10.17.5.10" }))).toBeNull();
  });

  test("a scan with no range that parses adds nothing", () => {
    expect(getDiscoveryScanRange({ cidr: "" })).toBeNull();
    expect(getDiscoveryScanRange({ cidr: "10.0.0.0/99" })).toBeNull();

    const job: ProbeJob = new ProbeJob();
    job.addRange({ target: "not a range", services: [] });
    expect(job.isEmpty()).toBe(true);
  });

  test("IPv6 is never in a discovery range: discovery sweeps IPv4 only", () => {
    const job: ProbeJob = new ProbeJob();
    job.addRange(getDiscoveryScanRange(scan)!);

    expect(job.findWork(flow({ dstIp: "2001:db8::77" }))).toBeNull();
  });
});

describe("whether a discovery scan swept while a window's flows were sent", () => {
  const window: { from: Date; to: Date } = {
    from: new Date("2026-11-21T10:00:00.000Z"),
    to: new Date("2026-11-21T10:05:00.000Z"),
  };

  test("running, started by the window's end", () => {
    expect(
      isDiscoveryScanInWindow(
        {
          status: DiscoveryScanStatus.InProgress,
          startedAt: new Date("2026-11-21T09:30:00.000Z"),
        },
        window,
      ),
    ).toBe(true);
  });

  test("running, but started after the window: not its flows", () => {
    expect(
      isDiscoveryScanInWindow(
        {
          status: DiscoveryScanStatus.InProgress,
          startedAt: new Date("2026-11-21T10:06:00.000Z"),
        },
        window,
      ),
    ).toBe(false);
  });

  test("ended in the window, or shortly before it", () => {
    expect(
      isDiscoveryScanInWindow(
        {
          status: DiscoveryScanStatus.Completed,
          startedAt: new Date("2026-11-21T09:40:00.000Z"),
          completedAt: new Date("2026-11-21T10:02:00.000Z"),
        },
        window,
      ),
    ).toBe(true);

    expect(
      isDiscoveryScanInWindow(
        {
          status: DiscoveryScanStatus.Failed,
          startedAt: new Date("2026-11-21T09:30:00.000Z"),
          completedAt: new Date(
            window.from.getTime() -
              (DISCOVERY_FLOW_GRACE_IN_MINUTES - 1) * 60 * 1000,
          ),
        },
        window,
      ),
    ).toBe(true);
  });

  test("ended long before the window: it swept nothing in it", () => {
    expect(
      isDiscoveryScanInWindow(
        {
          status: DiscoveryScanStatus.Completed,
          startedAt: new Date("2026-11-21T08:00:00.000Z"),
          completedAt: new Date(
            window.from.getTime() -
              (DISCOVERY_FLOW_GRACE_IN_MINUTES + 1) * 60 * 1000,
          ),
        },
        window,
      ),
    ).toBe(false);
  });

  test("queued again after a run: the last run's times still count", () => {
    expect(
      isDiscoveryScanInWindow(
        {
          status: DiscoveryScanStatus.Pending,
          startedAt: new Date("2026-11-21T09:50:00.000Z"),
          completedAt: new Date("2026-11-21T09:58:00.000Z"),
        },
        window,
      ),
    ).toBe(true);
  });

  test("never run", () => {
    expect(
      isDiscoveryScanInWindow({ status: DiscoveryScanStatus.Pending }, window),
    ).toBe(false);
  });
});

describe("monitors", () => {
  test("a Port monitor: its port over TCP, and nothing else", () => {
    const job: ProbeJob = new ProbeJob();

    for (const target of getMonitorTargets(
      MonitorType.Port,
      monitorSteps(
        { destination: new IP("10.0.0.50"), port: 22 },
        { destination: new Hostname("db.internal"), port: 5432 },
      ),
    )) {
      job.addTarget(target);
    }

    expect(
      job.findWork(flow({ dstIp: "10.0.0.50", dstPort: 22, protocol: TCP })),
    ).toBe(ProbeWork.Monitor);
    expect(
      job.findWork(
        flow({
          dstIp: "10.0.0.60",
          dstName: "db.internal",
          dstPort: 5432,
          protocol: TCP,
        }),
      ),
    ).toBe(ProbeWork.Monitor);
    expect(
      job.findWork(flow({ dstIp: "10.0.0.50", dstPort: 23, protocol: TCP })),
    ).toBeNull();
    expect(
      job.findWork(flow({ dstIp: "10.0.0.50", dstPort: 22, protocol: UDP })),
    ).toBeNull();
  });

  test("a Port monitor with no port reaches nothing", () => {
    expect(
      getMonitorTargets(
        MonitorType.Port,
        monitorSteps({ destination: new IP("10.0.0.50") }),
      ),
    ).toEqual([]);
  });

  test("a Ping or IP monitor: ICMP, and port 80 where ping is blocked", () => {
    const targets: Array<ProbeJobTarget> = [
      ...getMonitorTargets(
        MonitorType.Ping,
        monitorSteps({ destination: new Hostname("router.example.com") }),
      ),
      ...getMonitorTargets(
        MonitorType.IP,
        monitorSteps({ destination: new IP("203.0.113.9") }),
      ),
    ];
    const job: ProbeJob = new ProbeJob();

    for (const target of targets) {
      job.addTarget(target);
    }

    expect(
      job.findWork(
        flow({ dstIp: "203.0.113.9", dstPort: 2048, protocol: ICMP }),
      ),
    ).toBe(ProbeWork.Monitor);
    expect(
      job.findWork(flow({ dstIp: "203.0.113.9", dstPort: 80, protocol: TCP })),
    ).toBe(ProbeWork.Monitor);
    expect(
      job.findWork(flow({ dstIp: "203.0.113.9", dstPort: 22, protocol: TCP })),
    ).toBeNull();
    expect(job.getNames()).toEqual(["router.example.com"]);
  });

  test("a Website, API or SSL Certificate monitor: its URL's host on its URL's port", () => {
    const job: ProbeJob = new ProbeJob();

    for (const [type, url] of [
      [MonitorType.Website, "https://app.example.com:8443/health"],
      [MonitorType.API, "http://10.0.0.70/api"],
      [MonitorType.SSLCertificate, "https://203.0.113.80"],
    ] as Array<[MonitorType, string]>) {
      for (const target of getMonitorTargets(
        type,
        monitorSteps({ destination: URL.fromString(url) }),
      )) {
        job.addTarget(target);
      }
    }

    expect(
      job.findWork(
        flow({
          dstIp: "198.51.100.5",
          dstName: "app.example.com",
          dstPort: 8443,
          protocol: TCP,
        }),
      ),
    ).toBe(ProbeWork.Monitor);
    expect(
      job.findWork(flow({ dstIp: "10.0.0.70", dstPort: 80, protocol: TCP })),
    ).toBe(ProbeWork.Monitor);
    expect(
      job.findWork(
        flow({ dstIp: "203.0.113.80", dstPort: 443, protocol: TCP }),
      ),
    ).toBe(ProbeWork.Monitor);
    // The scheme's port only: the host's other ports are not the monitor's.
    expect(
      job.findWork(flow({ dstIp: "10.0.0.70", dstPort: 443, protocol: TCP })),
    ).toBeNull();
  });

  test("an IPv6 URL host, without its brackets", () => {
    const job: ProbeJob = new ProbeJob();

    for (const target of getMonitorTargets(
      MonitorType.Website,
      monitorSteps({ destination: URL.fromString("https://[2001:db8::80]/") }),
    )) {
      job.addTarget(target);
    }

    expect(
      job.findWork(
        flow({ dstIp: "2001:db8::80", dstPort: 443, protocol: TCP }),
      ),
    ).toBe(ProbeWork.Monitor);
  });

  test("a monitor whose checks are not told by a host and port reaches nothing", () => {
    for (const type of [
      MonitorType.SyntheticMonitor,
      MonitorType.CustomJavaScriptCode,
      MonitorType.Manual,
      MonitorType.IncomingRequest,
    ]) {
      expect(
        getMonitorTargets(
          type,
          monitorSteps({ destination: new IP("10.0.0.50"), port: 22 }),
        ),
      ).toEqual([]);
    }

    expect(getMonitorTargets(MonitorType.Port, undefined)).toEqual([]);
    expect(getMonitorTargets(undefined, undefined)).toEqual([]);
  });
});

describe("probes that share an address", () => {
  test("their jobs together: either may have sent the flow", () => {
    const office: ProbeJob = new ProbeJob();
    office.addTarget(getDevicePollTarget({ hostname: "10.0.0.1" })!);

    const store: ProbeJob = new ProbeJob();
    store.addRange(getDiscoveryScanRange({ cidr: "10.30.0.0/24" })!);

    office.merge(store);

    expect(office.findWork(flow({ dstIp: "10.0.0.1" }))).toBe(
      ProbeWork.DevicePolling,
    );
    expect(office.findWork(flow({ dstIp: "10.30.0.4" }))).toBe(
      ProbeWork.Discovery,
    );
  });

  test("an empty job is no one's work", () => {
    const job: ProbeJob = new ProbeJob();

    expect(job.isEmpty()).toBe(true);
    expect(job.findWork(flow({}))).toBeNull();
  });
});
