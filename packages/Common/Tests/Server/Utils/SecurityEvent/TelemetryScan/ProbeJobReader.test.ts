import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { FindOperator } from "typeorm";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import MonitorProbe from "../../../../../Models/DatabaseModels/MonitorProbe";
import NetworkDevice from "../../../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiscoveryScan from "../../../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import MonitorProbeService from "../../../../../Server/Services/MonitorProbeService";
import MonitorService from "../../../../../Server/Services/MonitorService";
import NetworkDeviceDiscoveryScanService from "../../../../../Server/Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceService from "../../../../../Server/Services/NetworkDeviceService";
import { DnsResolutionCache } from "../../../../../Server/Utils/Monitor/DnsResolutionCache";
import ProbeJobReader, {
  MAX_PROBE_JOB_NAMES_RESOLVED,
} from "../../../../../Server/Utils/SecurityEvent/TelemetryScan/ProbeJobReader";
import URL from "../../../../../Types/API/URL";
import { JSONObject } from "../../../../../Types/JSON";
import MonitorStep from "../../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../../Types/Monitor/MonitorType";
import { NetworkDeviceMonitoringMethod } from "../../../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import ObjectID from "../../../../../Types/ObjectID";
import { DiscoveryScanStatus } from "../../../../../Utils/NetworkDiscovery/DiscoveryScanStatus";
import {
  PROBE_JOB_MONITOR_TYPES,
  ProbeJob,
  ProbeWork,
} from "../../../../../Utils/SecurityEvent/TelemetryScan/ProbeJob";

/*
 * What a probe is set to do in a project, read for a window of its flows
 * (#10429): the devices it polls as the poll claim hands them out, its
 * discovery scans that swept in the window, and the monitors it checks -
 * read as OneUptime, in bounded reads.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-00000000c301",
);
const PROBE_ID: ObjectID = new ObjectID("0192f1a0-0000-7000-8000-00000000c302");

const WINDOW: { from: Date; to: Date } = {
  from: new Date("2026-11-21T10:00:00.000Z"),
  to: new Date("2026-11-21T10:05:00.000Z"),
};

const UDP: number = 17;
const TCP: number = 6;

interface FindInput {
  query: JSONObject;
  select: JSONObject;
  limit: number;
  props: JSONObject;
}

function anyOf(filter: unknown): Array<string> {
  const parameters: Record<string, unknown> | undefined =
    filter instanceof FindOperator
      ? (filter.objectLiteralParameters as Record<string, unknown>)
      : undefined;
  const value: unknown = parameters ? Object.values(parameters)[0] : undefined;

  return Array.isArray(value) ? value.map(String) : [];
}

function device(
  hostname: string,
  monitoringMethod?: NetworkDeviceMonitoringMethod,
): NetworkDevice {
  const model: NetworkDevice = new NetworkDevice();
  model.hostname = hostname;
  model.snmpPort = 161;

  if (monitoringMethod) {
    model.monitoringMethod = monitoringMethod;
  }

  return model;
}

function websiteMonitor(url: string): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.id = ObjectID.generate();
  monitor.monitorType = MonitorType.Website;

  const step: MonitorStep = new MonitorStep();
  step.setMonitorDestination(URL.fromString(url));

  const steps: MonitorSteps = new MonitorSteps();
  steps.data!.monitorStepsInstanceArray = [step];
  monitor.monitorSteps = steps;

  return monitor;
}

function stand(data: {
  devices?: Array<NetworkDevice>;
  scans?: Array<NetworkDeviceDiscoveryScan>;
  monitors?: Array<Monitor>;
}): {
  devices: jest.SpiedFunction<typeof NetworkDeviceService.findAllBy>;
  scans: jest.SpiedFunction<typeof NetworkDeviceDiscoveryScanService.findBy>;
  assignments: jest.SpiedFunction<typeof MonitorProbeService.findAllBy>;
  monitors: jest.SpiedFunction<typeof MonitorService.findBy>;
} {
  const monitors: Array<Monitor> = data.monitors || [];

  return {
    devices: jest
      .spyOn(NetworkDeviceService, "findAllBy")
      .mockResolvedValue(data.devices || []),
    scans: jest
      .spyOn(NetworkDeviceDiscoveryScanService, "findBy")
      .mockResolvedValue(data.scans || []),
    assignments: jest.spyOn(MonitorProbeService, "findAllBy").mockResolvedValue(
      monitors.map((monitor: Monitor): MonitorProbe => {
        const assignment: MonitorProbe = new MonitorProbe();
        assignment.monitorId = monitor.id!;
        return assignment;
      }),
    ),
    monitors: jest.spyOn(MonitorService, "findBy").mockImplementation((async (
      input: FindInput,
    ) => {
      const ids: Array<string> = anyOf(input.query["_id"]);

      return monitors.filter((monitor: Monitor): boolean => {
        return ids.includes(monitor.id!.toString());
      });
    }) as never),
  };
}

function resolveTo(
  answers: Record<string, Array<string>>,
): jest.Mock<(hostname: string) => Promise<Array<string>>> {
  const resolver: jest.Mock<(hostname: string) => Promise<Array<string>>> =
    jest.fn(async (hostname: string): Promise<Array<string>> => {
      return answers[hostname] || [];
    });

  ProbeJobReader.setDnsCacheForTests(new DnsResolutionCache({ resolver }));

  return resolver;
}

async function read(probeIds: Array<ObjectID> = [PROBE_ID]): Promise<ProbeJob> {
  return ProbeJobReader.read({
    projectId: PROJECT_ID,
    probeIds,
    window: WINDOW,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the devices a probe polls", () => {
  test("read as the poll claim hands them out: the project's, the probe's, polling on, with an address", async () => {
    resolveTo({});
    const reads: ReturnType<typeof stand> = stand({
      devices: [device("10.0.0.1")],
    });

    const job: ProbeJob = await read();
    const input: FindInput = reads.devices.mock.calls[0]![0] as never;

    expect(input.query["projectId"]).toEqual(PROJECT_ID);
    expect(anyOf(input.query["probeId"])).toEqual([PROBE_ID.toString()]);
    expect(input.query["isPollingEnabled"]).toBe(true);
    expect(input.query["hostname"]).toBeInstanceOf(FindOperator);
    expect(input.props).toEqual({ isRoot: true });
    expect(
      job.findWork({
        dstIp: "10.0.0.1",
        dstName: "",
        dstPort: 161,
        protocol: UDP,
      }),
    ).toBe(ProbeWork.DevicePolling);
  });

  test("a device a monitor reports for is not polled, so is no work of the probe's", async () => {
    resolveTo({});
    stand({
      devices: [device("10.0.0.2", NetworkDeviceMonitoringMethod.Monitor)],
    });

    const job: ProbeJob = await read();

    expect(job.isEmpty()).toBe(true);
  });

  test("a device polled by its DNS name: by what OneUptime resolves it to", async () => {
    const resolver: ReturnType<typeof resolveTo> = resolveTo({
      "core-sw-01.corp.example.com": ["10.0.5.1"],
    });
    stand({ devices: [device("core-sw-01.corp.example.com")] });

    const job: ProbeJob = await read();

    expect(resolver).toHaveBeenCalledWith("core-sw-01.corp.example.com");
    expect(
      job.findWork({
        dstIp: "10.0.5.1",
        dstName: "",
        dstPort: 161,
        protocol: UDP,
      }),
    ).toBe(ProbeWork.DevicePolling);
  });

  test("at most so many names are resolved", async () => {
    const resolver: ReturnType<typeof resolveTo> = resolveTo({});
    stand({
      devices: Array.from(
        { length: MAX_PROBE_JOB_NAMES_RESOLVED + 20 },
        (_: unknown, index: number): NetworkDevice => {
          return device(`device-${index}.corp.example.com`);
        },
      ),
    });

    await read();

    expect(resolver).toHaveBeenCalledTimes(MAX_PROBE_JOB_NAMES_RESOLVED);
  });
});

describe("the probe's discovery scans", () => {
  function scanOf(
    data: Partial<NetworkDeviceDiscoveryScan>,
  ): NetworkDeviceDiscoveryScan {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
    scan.cidr = "10.20.0.0/24";
    scan.snmpPort = 161;
    Object.assign(scan, data);
    return scan;
  }

  test("only those that swept while the window's flows were sent", async () => {
    resolveTo({});
    const reads: ReturnType<typeof stand> = stand({
      scans: [
        scanOf({
          status: DiscoveryScanStatus.InProgress,
          startedAt: new Date("2026-11-21T09:58:00.000Z"),
        }),
        scanOf({
          cidr: "10.30.0.0/24",
          status: DiscoveryScanStatus.Completed,
          startedAt: new Date("2026-11-21T04:00:00.000Z"),
          completedAt: new Date("2026-11-21T04:20:00.000Z"),
        }),
      ],
    });

    const job: ProbeJob = await read();
    const input: FindInput = reads.scans.mock.calls[0]![0] as never;

    expect(anyOf(input.query["probeId"])).toEqual([PROBE_ID.toString()]);
    expect(input.select["snmpConfigs"]).toBe(true);
    expect(input.select["isNetbiosLookupEnabled"]).toBe(true);
    expect(
      job.findWork({
        dstIp: "10.20.0.7",
        dstName: "",
        dstPort: 161,
        protocol: UDP,
      }),
    ).toBe(ProbeWork.Discovery);
    expect(
      job.findWork({
        dstIp: "10.30.0.7",
        dstName: "",
        dstPort: 161,
        protocol: UDP,
      }),
    ).toBeNull();
  });
});

describe("the monitors a probe checks", () => {
  test("enabled for the probe, checked actively, of a type told by a host and a port", async () => {
    resolveTo({ "app.example.com": ["198.51.100.5"] });
    const reads: ReturnType<typeof stand> = stand({
      monitors: [websiteMonitor("https://app.example.com:8443/health")],
    });

    const job: ProbeJob = await read();
    const assignment: FindInput = reads.assignments.mock.calls[0]![0] as never;
    const monitors: FindInput = reads.monitors.mock.calls[0]![0] as never;

    expect(assignment.query["projectId"]).toEqual(PROJECT_ID);
    expect(assignment.query["isEnabled"]).toBe(true);
    expect(anyOf(assignment.query["probeId"])).toEqual([PROBE_ID.toString()]);

    expect(monitors.query["projectId"]).toEqual(PROJECT_ID);
    expect(monitors.query["disableActiveMonitoring"]).toBe(false);
    expect(monitors.query["isArchived"]).toBe(false);
    expect(anyOf(monitors.query["monitorType"]).sort()).toEqual(
      [...PROBE_JOB_MONITOR_TYPES].map(String).sort(),
    );

    expect(
      job.findWork({
        dstIp: "198.51.100.5",
        dstName: "",
        dstPort: 8443,
        protocol: TCP,
      }),
    ).toBe(ProbeWork.Monitor);
  });

  test("many monitors are read a page at a time, by their ids", async () => {
    resolveTo({});
    const reads: ReturnType<typeof stand> = stand({
      monitors: Array.from({ length: 1200 }, (): Monitor => {
        return websiteMonitor("https://203.0.113.9/");
      }),
    });

    await read();

    expect(reads.monitors).toHaveBeenCalledTimes(3);
  });

  test("probes that share an address: their work read together", async () => {
    resolveTo({});
    const other: ObjectID = new ObjectID(
      "0192f1a0-0000-7000-8000-00000000c303",
    );
    const reads: ReturnType<typeof stand> = stand({});

    await read([PROBE_ID, other]);

    expect(
      anyOf(
        (reads.devices.mock.calls[0]![0] as never as FindInput).query[
          "probeId"
        ],
      ),
    ).toEqual([PROBE_ID.toString(), other.toString()]);
  });

  test("no probe: no reads, and no work", async () => {
    resolveTo({});
    const reads: ReturnType<typeof stand> = stand({});

    const job: ProbeJob = await read([]);

    expect(job.isEmpty()).toBe(true);
    expect(reads.devices).not.toHaveBeenCalled();
    expect(reads.monitors).not.toHaveBeenCalled();
  });
});
