import NetworkFlowDeviceMatcher, {
  FlowDeviceMatch,
  FlowExporterAttribution,
  FlowProbe,
} from "../../../../Server/Utils/NetworkFlow/NetworkFlowDeviceMatcher";
import NetworkDeviceHydrationUtil from "../../../../Server/Utils/Monitor/NetworkDeviceHydrationUtil";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import ProbeService from "../../../../Server/Services/ProbeService";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import Probe from "../../../../Models/DatabaseModels/Probe";
import ObjectID from "../../../../Types/ObjectID";
import { MockFunction } from "../../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Whose flows an exporter's are: this probe's devices first (by hostname,
 * Other Addresses or DNS - the trap and syslog rule), then, on a project's
 * own probe, any device of the project; else the project's bucket, or -
 * on a global probe - nobody. And the caching that keeps that cheap on a
 * path every exporter hits every few seconds.
 */

const PROJECT: ObjectID = ObjectID.generate();
const PROBE: ObjectID = ObjectID.generate();
const ROUTER: ObjectID = ObjectID.generate();
const OTHER_PROBE_DEVICE: ObjectID = ObjectID.generate();
const LOOPBACK_DEVICE: ObjectID = ObjectID.generate();

const PROJECT_PROBE: FlowProbe = { id: PROBE, projectId: PROJECT };
const GLOBAL_PROBE: FlowProbe = { id: PROBE, projectId: null };

function device(
  id: ObjectID,
  hostname: string,
  otherAddresses?: string,
): NetworkDevice {
  const value: NetworkDevice = new NetworkDevice(id);
  value.projectId = PROJECT;
  value.hostname = hostname;

  if (otherAddresses) {
    value.otherAddresses = otherAddresses;
  }

  return value;
}

let probeDevices: MockFunction;
let projectDevices: MockFunction;

beforeEach(() => {
  NetworkFlowDeviceMatcher.clearCaches();

  probeDevices = jest
    .spyOn(NetworkDeviceHydrationUtil, "findDevicesByProbeAndSource")
    .mockResolvedValue([] as never) as unknown as MockFunction;

  projectDevices = jest
    .spyOn(NetworkDeviceService, "findBy")
    .mockResolvedValue([
      device(OTHER_PROBE_DEVICE, "10.0.0.7"),
      device(LOOPBACK_DEVICE, "core-router.example.com", "10.255.0.1, 2001:db8::1"),
      device(ObjectID.generate(), ""),
    ] as never) as unknown as MockFunction;
});

afterEach(() => {
  jest.restoreAllMocks();
  NetworkFlowDeviceMatcher.clearCaches();
});

function ids(matches: Array<FlowDeviceMatch>): Array<string> {
  return matches.map((match: FlowDeviceMatch): string => {
    return match.networkDeviceId.toString();
  });
}

describe("NetworkFlowDeviceMatcher.findDevices", () => {
  test("this probe's devices win, and the project is not read at all", async () => {
    probeDevices.mockResolvedValue([device(ROUTER, "10.0.0.1")] as never);

    const matches: Array<FlowDeviceMatch> =
      await NetworkFlowDeviceMatcher.findDevices(PROJECT_PROBE, "10.0.0.1");

    expect(ids(matches)).toEqual([ROUTER.toString()]);
    expect(probeDevices).toHaveBeenCalledWith({
      probeId: PROBE,
      sourceIpAddress: "10.0.0.1",
    });
    expect(projectDevices).not.toHaveBeenCalled();
  });

  test("on a project's own probe, a device another of its probes polls is found by hostname", async () => {
    const matches: Array<FlowDeviceMatch> =
      await NetworkFlowDeviceMatcher.findDevices(PROJECT_PROBE, "10.0.0.7");

    expect(ids(matches)).toEqual([OTHER_PROBE_DEVICE.toString()]);
  });

  test("...and by its Other Addresses, in any spelling", async () => {
    expect(
      ids(
        await NetworkFlowDeviceMatcher.findDevices(PROJECT_PROBE, "10.255.0.1"),
      ),
    ).toEqual([LOOPBACK_DEVICE.toString()]);

    expect(
      ids(
        await NetworkFlowDeviceMatcher.findDevices(
          PROJECT_PROBE,
          "2001:DB8:0:0::1",
        ),
      ),
    ).toEqual([LOOPBACK_DEVICE.toString()]);
  });

  test("an address no device has matches nobody", async () => {
    expect(
      await NetworkFlowDeviceMatcher.findDevices(PROJECT_PROBE, "10.9.9.9"),
    ).toEqual([]);
  });

  test("a global probe never looks across a project - it has none", async () => {
    expect(
      await NetworkFlowDeviceMatcher.findDevices(GLOBAL_PROBE, "10.0.0.7"),
    ).toEqual([]);
    expect(projectDevices).not.toHaveBeenCalled();
  });

  test("the project is read once for every exporter it is asked about, within the cache's life", async () => {
    await NetworkFlowDeviceMatcher.findDevices(PROJECT_PROBE, "10.9.9.1");
    await NetworkFlowDeviceMatcher.findDevices(PROJECT_PROBE, "10.9.9.2");
    await NetworkFlowDeviceMatcher.findDevices(PROJECT_PROBE, "10.9.9.3");

    expect(projectDevices).toHaveBeenCalledTimes(1);
    expect(
      (projectDevices.mock.calls[0]![0] as { query: { projectId: ObjectID } })
        .query.projectId,
    ).toBe(PROJECT);
  });

  test("each exporter's answer is cached: a second batch asks nothing", async () => {
    probeDevices.mockResolvedValue([device(ROUTER, "10.0.0.1")] as never);

    await NetworkFlowDeviceMatcher.findDevices(PROJECT_PROBE, "10.0.0.1");
    await NetworkFlowDeviceMatcher.findDevices(PROJECT_PROBE, "10.0.0.1");

    expect(probeDevices).toHaveBeenCalledTimes(1);
  });
});

describe("NetworkFlowDeviceMatcher.attribute", () => {
  test("an exporter that is a device goes to the device", async () => {
    probeDevices.mockResolvedValue([device(ROUTER, "10.0.0.1")] as never);

    const attribution: FlowExporterAttribution =
      await NetworkFlowDeviceMatcher.attribute(PROJECT_PROBE, "10.0.0.1");

    expect(ids(attribution.devices)).toEqual([ROUTER.toString()]);
    expect(attribution.unmatchedProjectId).toBeNull();
  });

  test("one that is nobody's goes to the project of the probe that received it", async () => {
    const attribution: FlowExporterAttribution =
      await NetworkFlowDeviceMatcher.attribute(PROJECT_PROBE, "10.9.9.9");

    expect(attribution.devices).toEqual([]);
    expect(attribution.unmatchedProjectId).toBe(PROJECT);
  });

  test("on a global probe, one that is nobody's goes nowhere", async () => {
    const attribution: FlowExporterAttribution =
      await NetworkFlowDeviceMatcher.attribute(GLOBAL_PROBE, "10.9.9.9");

    expect(attribution.unmatchedProjectId).toBeNull();
  });
});

describe("NetworkFlowDeviceMatcher.getProbe", () => {
  test("reads the probe once, and says whose it is", async () => {
    const probe: Probe = new Probe(PROBE);
    probe.projectId = PROJECT;

    const findOne: MockFunction = jest
      .spyOn(ProbeService, "findOneById")
      .mockResolvedValue(probe as never) as unknown as MockFunction;

    expect(await NetworkFlowDeviceMatcher.getProbe(PROBE)).toEqual({
      id: PROBE,
      projectId: PROJECT,
    });
    await NetworkFlowDeviceMatcher.getProbe(PROBE);

    expect(findOne).toHaveBeenCalledTimes(1);
  });

  test("a global probe has no project; an unknown probe is null", async () => {
    jest
      .spyOn(ProbeService, "findOneById")
      .mockResolvedValueOnce(new Probe(PROBE) as never)
      .mockResolvedValueOnce(null as never);

    expect(await NetworkFlowDeviceMatcher.getProbe(PROBE)).toEqual({
      id: PROBE,
      projectId: null,
    });

    const unknown: ObjectID = ObjectID.generate();
    expect(await NetworkFlowDeviceMatcher.getProbe(unknown)).toBeNull();
  });
});
