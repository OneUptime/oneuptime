import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ProbeSyslogIngestService, {
  DEFAULT_SERVICE_NAME,
  MAX_BUFFERED_MESSAGE_AGE_IN_MS,
  MAX_DEVICE_CLOCK_SKEW_IN_MS,
  ProbeSyslogIngestResult,
  ReadProbeSyslogMessage,
  ResolvedLogTime,
} from "../../FeatureSet/Telemetry/Services/ProbeSyslogIngestService";
import LogPipelineService, {
  LoadedPipeline,
} from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import LogDropFilterService, {
  LoadedLogDropFilter,
} from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import { compileFilter } from "../../FeatureSet/Telemetry/Utils/LogFilterEvaluator";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Probe from "Common/Models/DatabaseModels/Probe";
import LogService from "Common/Server/Services/LogService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import ProbeService from "Common/Server/Services/ProbeService";
import NetworkDeviceHydrationUtil from "Common/Server/Utils/Monitor/NetworkDeviceHydrationUtil";
import NetworkFlowDeviceMatcher from "Common/Server/Utils/NetworkFlow/NetworkFlowDeviceMatcher";
import SyslogDeviceMatcher from "Common/Server/Utils/Syslog/SyslogDeviceMatcher";
import {
  ALL_SYSLOG_VENDOR_SAMPLES,
  SyslogVendorSample,
} from "Common/Tests/Helpers/SyslogVendorSamples";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import LogPipelineProcessorType from "Common/Types/Log/LogPipelineProcessorType";
import LogSeverity from "Common/Types/Log/LogSeverity";
import ObjectID from "Common/Types/ObjectID";
import SyslogMessage from "Common/Types/Syslog/SyslogMessage";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  ParsedSyslogMessage,
  SyslogHeaderFormat,
  parseSyslogMessage,
} from "Common/Utils/Syslog/SyslogMessageParser";

/*
 * The syslog a probe forwards, end to end: from the JSON a probe posts to
 * the log rows written, through the real header reader, the real vendor
 * parsers, the real device matcher and the real pipeline engine. Only the
 * databases are stubbed: which devices a probe polls, which devices a
 * project has, the telemetry service a log is filed under, the project's
 * drop filters, scrub rules and pipelines, and the insert.
 *
 * What this suite holds:
 *
 *   - a vendor's line becomes a log of its device, with the vendor's fields
 *     and the event it is - for every sample line of every parser;
 *   - a message from an address that is no device is kept for the project
 *     of the probe that heard it, and dropped when there is none;
 *   - a controller's message about a device it manages is that device's;
 *   - nothing a line says can change where it came from;
 *   - drop filters, scrub rules and pipelines see what the parsers read,
 *     and a pipeline can name an event of the project's own;
 *   - a device whose clock is off does not hide its logs in the past.
 */

type MockedFn = jest.Mock;

const NOW: Date = new Date("2026-10-13T10:11:12.000Z");
const RECEIVED_AT: Date = new Date(NOW.getTime() - 2000);
const DEVICE_TIME: Date = new Date(NOW.getTime() - 3000);

const PROJECT: ObjectID = ObjectID.generate();
const OTHER_PROJECT: ObjectID = ObjectID.generate();
const PROBE: ObjectID = ObjectID.generate();

const SWITCH: ObjectID = ObjectID.generate();
const CONSOLE: ObjectID = ObjectID.generate();
const ACCESS_POINT: ObjectID = ObjectID.generate();
const ROUTER: ObjectID = ObjectID.generate();

const SWITCH_ADDRESS: string = "10.0.0.2";
const CONSOLE_ADDRESS: string = "192.168.100.1";
const STRANGER_ADDRESS: string = "203.0.113.77";

interface DeviceFields {
  id: ObjectID;
  projectId?: ObjectID;
  name: string;
  hostname: string;
  macAddress?: string;
  vendor?: string;
  sysName?: string;
}

function device(fields: DeviceFields): NetworkDevice {
  const value: NetworkDevice = new NetworkDevice(fields.id);

  value.projectId = fields.projectId || PROJECT;
  value.name = fields.name;
  value.hostname = fields.hostname;

  if (fields.macAddress) {
    value.macAddress = fields.macAddress;
  }

  if (fields.vendor) {
    value.vendor = fields.vendor;
  }

  if (fields.sysName) {
    value.sysName = fields.sysName;
  }

  return value;
}

const SWITCH_DEVICE: NetworkDevice = device({
  id: SWITCH,
  name: "Core Switch",
  hostname: SWITCH_ADDRESS,
  sysName: "core-sw1",
});

const CONSOLE_DEVICE: NetworkDevice = device({
  id: CONSOLE,
  name: "Office UDM Pro",
  hostname: CONSOLE_ADDRESS,
});

const ACCESS_POINT_DEVICE: NetworkDevice = device({
  id: ACCESS_POINT,
  name: "Lobby AP",
  hostname: "192.168.100.5",
  macAddress: "d8:b3:70:fb:fc:dd",
});

const ROUTER_DEVICE: NetworkDevice = device({
  id: ROUTER,
  name: "Branch Router",
  hostname: "10.9.0.1",
  vendor: "MikroTik",
  sysName: "branch-rtr-01",
});

let projectDevices: Array<NetworkDevice> = [];
// Which devices the probe polls at each address.
let probeDevicesByAddress: Record<string, Array<NetworkDevice>> = {};
let probeProjectId: ObjectID | null = PROJECT;

let insertedRows: Array<JSONObject> = [];
let insertJsonRows: MockedFn;
let telemetryServiceFromName: MockedFn;
let loadPipelines: MockedFn;
let loadDropFilters: MockedFn;
let loadScrubRules: MockedFn;

const serviceIds: Record<string, ObjectID> = {};

function serviceIdFor(projectId: ObjectID, serviceName: string): ObjectID {
  const key: string = `${projectId.toString()}:${serviceName}`;

  serviceIds[key] = serviceIds[key] || ObjectID.generate();

  return serviceIds[key] as ObjectID;
}

beforeEach(() => {
  SyslogDeviceMatcher.clearCaches();
  NetworkFlowDeviceMatcher.clearCaches();

  projectDevices = [
    SWITCH_DEVICE,
    CONSOLE_DEVICE,
    ACCESS_POINT_DEVICE,
    ROUTER_DEVICE,
  ];
  probeDevicesByAddress = {
    [SWITCH_ADDRESS]: [SWITCH_DEVICE],
    [CONSOLE_ADDRESS]: [CONSOLE_DEVICE],
    "10.9.0.1": [ROUTER_DEVICE],
  };
  probeProjectId = PROJECT;
  insertedRows = [];

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

  jest
    .spyOn(ProbeService, "findOneById")
    .mockImplementation((async (): Promise<Probe | null> => {
      const probe: Probe = new Probe(PROBE);

      if (probeProjectId) {
        probe.projectId = probeProjectId;
      }

      return probe;
    }) as never);

  jest
    .spyOn(NetworkDeviceHydrationUtil, "findDevicesByProbeAndSource")
    .mockImplementation((async (data: {
      sourceIpAddress: string;
    }): Promise<Array<NetworkDevice>> => {
      return probeDevicesByAddress[data.sourceIpAddress] || [];
    }) as never);

  jest.spyOn(NetworkDeviceService, "findBy").mockImplementation((async (data: {
    query: { projectId: ObjectID };
  }): Promise<Array<NetworkDevice>> => {
    return projectDevices.filter((candidate: NetworkDevice): boolean => {
      return (
        candidate.projectId?.toString() === data.query.projectId.toString()
      );
    });
  }) as never);

  telemetryServiceFromName = jest
    .spyOn(OTelIngestService, "telemetryServiceFromName")
    .mockImplementation((async (data: {
      serviceName: string;
      projectId: ObjectID;
    }): Promise<TelemetryServiceMetadata> => {
      return {
        serviceName: data.serviceName,
        primaryEntityId: serviceIdFor(data.projectId, data.serviceName),
        primaryEntityType: ServiceType.OpenTelemetry,
        dataRententionInDays: 30,
        serviceRetentionConfig: null,
        serviceRetentionInDays: 30,
        projectRetentionConfig: null,
        projectRetentionInDays: 15,
      };
    }) as never) as unknown as MockedFn;

  insertJsonRows = jest
    .spyOn(LogService, "insertJsonRows")
    .mockImplementation((async (rows: Array<JSONObject>): Promise<void> => {
      insertedRows.push(...rows);
    }) as never) as unknown as MockedFn;

  loadPipelines = jest
    .spyOn(LogPipelineService, "loadPipelines")
    .mockResolvedValue([] as never) as unknown as MockedFn;

  loadDropFilters = jest
    .spyOn(LogDropFilterService, "loadDropFilters")
    .mockResolvedValue([] as never) as unknown as MockedFn;

  loadScrubRules = jest
    .spyOn(LogScrubRuleService, "loadScrubRules")
    .mockResolvedValue([] as never) as unknown as MockedFn;
});

afterEach(() => {
  jest.restoreAllMocks();
  SyslogDeviceMatcher.clearCaches();
  NetworkFlowDeviceMatcher.clearCaches();
});

// The JSON a probe posts for a line it heard, with the line itself.
function fromProbe(
  line: string,
  sourceIpAddress: string,
  overrides?: JSONObject,
): JSONObject {
  const parsed: ParsedSyslogMessage | null = parseSyslogMessage(line);

  return {
    sourceIpAddress: sourceIpAddress,
    facility: parsed?.facility ?? 1,
    severity: parsed?.severity ?? 5,
    timestamp: DEVICE_TIME.toISOString(),
    hostname: parsed?.hostname,
    appName: parsed?.appName,
    message: parsed?.message || line,
    receivedAt: RECEIVED_AT.toISOString(),
    raw: line,
    ...(overrides || {}),
  } as JSONObject;
}

async function ingest(
  messages: Array<JSONObject>,
): Promise<ProbeSyslogIngestResult> {
  return ProbeSyslogIngestService.processSyslogMessages(PROBE, messages);
}

function attributesOf(row: JSONObject | undefined): Record<string, unknown> {
  return ((row || {})["attributes"] || {}) as Record<string, unknown>;
}

function onlyRow(): JSONObject {
  expect(insertedRows).toHaveLength(1);

  return insertedRows[0] as JSONObject;
}

type ProcessorSpec = {
  processorType: string;
  configuration: JSONObject;
};

function pipelineWith(
  processors: Array<ProcessorSpec>,
  filterQuery?: string,
): Array<LoadedPipeline> {
  return [
    {
      pipeline: { name: "network-pipeline" },
      compiledFilter: compileFilter(filterQuery || ""),
      processors: processors.map((processor: ProcessorSpec) => {
        return {
          name: "processor",
          processorType: processor.processorType,
          configuration: processor.configuration,
        };
      }),
    },
  ] as unknown as Array<LoadedPipeline>;
}

const CISCO_LINK_DOWN: string =
  "<187>Oct 13 10:11:09 core-sw1 45: Oct 13 10:11:09.123 UTC: %LINK-3-UPDOWN: Interface GigabitEthernet0/1, changed state to down";

// The same event from a switch that calls itself a name no device has.
const STRANGER_LINK_DOWN: string =
  "<187>Oct 13 10:11:09 unknown-sw 45: %LINK-3-UPDOWN: Interface GigabitEthernet0/1, changed state to down";

describe("a vendor's line from a device the probe polls", () => {
  test("becomes a log of that device, with the vendor's fields and the event it is", async () => {
    const result: ProbeSyslogIngestResult = await ingest([
      fromProbe(CISCO_LINK_DOWN, SWITCH_ADDRESS),
    ]);

    expect(result).toEqual({
      written: 1,
      keptUnmatched: 0,
      droppedUnmatched: 0,
      malformed: 0,
      droppedByFilter: 0,
    });

    const row: JSONObject = onlyRow();
    const serviceId: ObjectID = serviceIdFor(PROJECT, "Core Switch");

    expect(row["projectId"]).toBe(PROJECT.toString());
    expect(row["primaryEntityId"]).toBe(serviceId.toString());
    // The body is the message as the header reader leaves it: nothing rewritten.
    expect(row["body"]).toBe(
      "Oct 13 10:11:09.123 UTC: %LINK-3-UPDOWN: Interface GigabitEthernet0/1, changed state to down",
    );
    expect(row["severityText"]).toBe(LogSeverity.Error);
    expect(row["severityNumber"]).toBe(19);
    // The device stamped it a second earlier; it is stored when it was heard.
    expect(row["time"]).toBe(OneUptimeDate.toClickhouseDateTime64(RECEIVED_AT));

    expect(attributesOf(row)).toEqual({
      "oneuptime.service.id": serviceId.toString(),
      "oneuptime.service.name": "Core Switch",
      "syslog.sourceIp": SWITCH_ADDRESS,
      "syslog.facility.code": 23,
      "syslog.facility.name": "local7",
      "syslog.severity.code": 3,
      "syslog.severity.name": "error",
      "syslog.hostname": "core-sw1",
      "syslog.appName": "45",
      "probe.id": PROBE.toString(),
      "networkDevice.id": SWITCH.toString(),
      "networkDevice.name": "Core Switch",
      "syslog.vendor": "Cisco",
      "syslog.parser": "cisco",
      "cisco.facility": "LINK",
      "cisco.severity": "3",
      "cisco.mnemonic": "UPDOWN",
      "event.domain": "network",
      "event.name": "interface.down",
      "event.message": "Interface GigabitEthernet0/1, changed state to down",
      "network.interface.name": "GigabitEthernet0/1",
    });

    expect((row["attributeKeys"] as Array<string>).slice().sort()).toEqual(
      Object.keys(attributesOf(row)).sort(),
    );
  });

  test("is filed under a telemetry service named after the device, in the device's project", async () => {
    await ingest([fromProbe(CISCO_LINK_DOWN, SWITCH_ADDRESS)]);

    expect(telemetryServiceFromName).toHaveBeenCalledTimes(1);
    expect(telemetryServiceFromName).toHaveBeenCalledWith({
      serviceName: "Core Switch",
      projectId: PROJECT,
    });
  });

  test("a device with no name is filed under the shared service", async () => {
    const nameless: NetworkDevice = device({
      id: ObjectID.generate(),
      name: "",
      hostname: "10.0.0.50",
    });

    projectDevices.push(nameless);
    probeDevicesByAddress["10.0.0.50"] = [nameless];

    await ingest([fromProbe(CISCO_LINK_DOWN, "10.0.0.50")]);

    expect(telemetryServiceFromName).toHaveBeenCalledWith({
      serviceName: DEFAULT_SERVICE_NAME,
      projectId: PROJECT,
    });
    expect(attributesOf(onlyRow())["networkDevice.id"]).toBe(
      nameless.id?.toString(),
    );
    expect(Object.keys(attributesOf(onlyRow()))).not.toContain(
      "networkDevice.name",
    );
  });

  test("a line no parser knows is stored as it always was, with nothing added", async () => {
    await ingest([
      fromProbe(
        "<134>Oct 13 10:11:09 core-sw1 dhcpd: DHCPACK on 10.0.0.77 to 00:11:22:33:44:55",
        SWITCH_ADDRESS,
      ),
    ]);

    const serviceId: ObjectID = serviceIdFor(PROJECT, "Core Switch");

    expect(onlyRow()["body"]).toBe("DHCPACK on 10.0.0.77 to 00:11:22:33:44:55");
    expect(attributesOf(onlyRow())).toEqual({
      "oneuptime.service.id": serviceId.toString(),
      "oneuptime.service.name": "Core Switch",
      "syslog.sourceIp": SWITCH_ADDRESS,
      "syslog.facility.code": 16,
      "syslog.facility.name": "local0",
      "syslog.severity.code": 6,
      "syslog.severity.name": "informational",
      "syslog.hostname": "core-sw1",
      "syslog.appName": "dhcpd",
      "probe.id": PROBE.toString(),
      "networkDevice.id": SWITCH.toString(),
      "networkDevice.name": "Core Switch",
    });
  });
});

describe("every vendor's sample line, through ingest", () => {
  /*
   * Each line arrives from a device the probe polls, whose Vendor is what
   * its sample says (nothing, for most). What is stored must be what the
   * parser suites expect of the line - proof that ingest hands the parsers
   * the same text they are tested on.
   */
  test.each(
    ALL_SYSLOG_VENDOR_SAMPLES.map(
      (sample: SyslogVendorSample): [string, SyslogVendorSample] => {
        return [sample.name, sample];
      },
    ),
  )("%s", async (_name: string, sample: SyslogVendorSample) => {
    const sender: NetworkDevice = device({
      id: ObjectID.generate(),
      name: "Sender",
      hostname: "10.77.0.1",
      ...(sample.deviceVendor ? { vendor: sample.deviceVendor } : {}),
    });

    // Alone in its project: nothing a line names can move it elsewhere.
    projectDevices = [sender];
    probeDevicesByAddress = { "10.77.0.1": [sender] };

    await ingest([fromProbe(sample.line, "10.77.0.1")]);

    const attributes: Record<string, unknown> = attributesOf(onlyRow());

    expect(attributes["networkDevice.id"]).toBe(sender.id?.toString());
    expect(attributes["event.name"]).toBe(
      sample.expect.eventName === null ? undefined : sample.expect.eventName,
    );
    expect(attributes["event.domain"]).toBe(
      sample.expect.eventName === null ? undefined : "network",
    );
    expect(attributes["syslog.parser"]).toBe(
      sample.expect.parserId === null ? undefined : sample.expect.parserId,
    );

    if (sample.expect.attributes) {
      expect(attributes).toMatchObject(sample.expect.attributes);
    }

    for (const key of sample.expect.absent || []) {
      expect(Object.keys(attributes)).not.toContain(key);
    }
  });
});

describe("a probe older than the raw line", () => {
  // It sends what it read itself: host, tag and message, and no `raw`.
  function fromOldProbe(fields: JSONObject): JSONObject {
    return {
      sourceIpAddress: SWITCH_ADDRESS,
      facility: 23,
      severity: 3,
      timestamp: DEVICE_TIME.toISOString(),
      receivedAt: RECEIVED_AT.toISOString(),
      ...fields,
    } as JSONObject;
  }

  test("its messages are still read: a key=value firewall line", async () => {
    await ingest([
      fromOldProbe({
        hostname: "fw-hq",
        message:
          'device_name="SFW" log_type="Event" log_component="IPSec" log_subtype="System" con_name="HQ-Branch1" status="Terminated" message="IPSec Connection HQ-Branch1 terminated."',
      }),
    ]);

    const attributes: Record<string, unknown> = attributesOf(onlyRow());

    expect(attributes["event.name"]).toBe("vpn.tunnel_down");
    expect(attributes["vpn.tunnel.name"]).toBe("HQ-Branch1");
    expect(attributes["sophos.con_name"]).toBe("HQ-Branch1");
    expect(attributes["syslog.hostname"]).toBe("fw-hq");
  });

  test("a tag the old probe split off is put back for the parsers that need it", async () => {
    await ingest([
      fromOldProbe({
        hostname: "ap-lobby",
        appName: "sshd",
        message: "Failed password for root from 192.0.2.10 port 51234 ssh2",
      }),
    ]);

    const attributes: Record<string, unknown> = attributesOf(onlyRow());

    expect(attributes["event.name"]).toBe("auth.login_failed");
    expect(attributes["user.name"]).toBe("root");
    // The body is what the probe sent as the message.
    expect(onlyRow()["body"]).toBe(
      "Failed password for root from 192.0.2.10 port 51234 ssh2",
    );
  });

  test("a Cisco message it could not find a header in is read from the message", async () => {
    await ingest([
      fromOldProbe({
        message:
          "45: *Mar  1 00:01:02.123: %LINK-3-UPDOWN: Interface GigabitEthernet0/1, changed state to down",
      }),
    ]);

    expect(attributesOf(onlyRow())["event.name"]).toBe("interface.down");
  });
});

describe("a message from an address that is no device", () => {
  test("is kept for the project of the probe that heard it, marked as from no device yet", async () => {
    const result: ProbeSyslogIngestResult = await ingest([
      fromProbe(STRANGER_LINK_DOWN, STRANGER_ADDRESS),
    ]);

    expect(result).toMatchObject({
      written: 1,
      keptUnmatched: 1,
      droppedUnmatched: 0,
    });

    const row: JSONObject = onlyRow();
    const serviceId: ObjectID = serviceIdFor(PROJECT, DEFAULT_SERVICE_NAME);

    expect(row["projectId"]).toBe(PROJECT.toString());
    expect(row["primaryEntityId"]).toBe(serviceId.toString());
    expect(telemetryServiceFromName).toHaveBeenCalledWith({
      serviceName: "network-devices",
      projectId: PROJECT,
    });

    const attributes: Record<string, unknown> = attributesOf(row);

    expect(attributes["syslog.unmatched"]).toBe(true);
    expect(attributes["syslog.sourceIp"]).toBe(STRANGER_ADDRESS);
    expect(Object.keys(attributes)).not.toContain("networkDevice.id");
    expect(Object.keys(attributes)).not.toContain("networkDevice.name");
    // It is still read: the vendor, and the event it is.
    expect(attributes["syslog.vendor"]).toBe("Cisco");
    expect(attributes["event.name"]).toBe("interface.down");
  });

  test("text with no priority that no parser knows is not kept: an open port hears more than syslog", async () => {
    const result: ProbeSyslogIngestResult = await ingest([
      fromProbe("GET / HTTP/1.1", STRANGER_ADDRESS),
      fromProbe("hello from a port scanner", STRANGER_ADDRESS),
    ]);

    expect(result).toMatchObject({
      written: 0,
      keptUnmatched: 0,
      droppedUnmatched: 2,
    });
    expect(insertJsonRows).not.toHaveBeenCalled();
  });

  test("...but a line with no priority in a vendor's format is kept: RouterOS sends its default format that way", async () => {
    const result: ProbeSyslogIngestResult = await ingest([
      fromProbe(
        "system,error,critical login failure for user guest from 192.168.88.17 via ssh",
        STRANGER_ADDRESS,
      ),
    ]);

    expect(result).toMatchObject({ written: 1, keptUnmatched: 1 });
    expect(attributesOf(onlyRow())["syslog.unmatched"]).toBe(true);
    expect(attributesOf(onlyRow())["syslog.vendor"]).toBe("MikroTik");
  });

  test("...and so is any line with a priority, whoever wrote it", async () => {
    const result: ProbeSyslogIngestResult = await ingest([
      fromProbe("<13>something no parser knows", STRANGER_ADDRESS),
    ]);

    expect(result).toMatchObject({ written: 1, keptUnmatched: 1 });
  });

  test("from a device, text with no priority is kept like anything else the device sends", async () => {
    const result: ProbeSyslogIngestResult = await ingest([
      fromProbe("the fan sounds odd", SWITCH_ADDRESS),
    ]);

    expect(result).toMatchObject({ written: 1, droppedUnmatched: 0 });
  });

  test("is dropped on a global probe, which has no project to keep it for", async () => {
    probeProjectId = null;

    const result: ProbeSyslogIngestResult = await ingest([
      fromProbe(CISCO_LINK_DOWN, STRANGER_ADDRESS),
    ]);

    expect(result).toMatchObject({
      written: 0,
      keptUnmatched: 0,
      droppedUnmatched: 1,
    });
    expect(insertJsonRows).not.toHaveBeenCalled();
    expect(telemetryServiceFromName).not.toHaveBeenCalled();
  });

  test("a device behind NAT is found by the host name it sends, and the log says how", async () => {
    await ingest([
      fromProbe(
        "<187>Oct 13 10:11:09 core-sw1 45: %LINK-3-UPDOWN: Interface GigabitEthernet0/1, changed state to down",
        STRANGER_ADDRESS,
      ),
    ]);

    const attributes: Record<string, unknown> = attributesOf(onlyRow());

    expect(attributes["networkDevice.id"]).toBe(SWITCH.toString());
    expect(attributes["networkDevice.name"]).toBe("Core Switch");
    expect(attributes["syslog.matchedBy"]).toBe("hostname");
    expect(attributes["syslog.sourceIp"]).toBe(STRANGER_ADDRESS);
    expect(Object.keys(attributes)).not.toContain("syslog.unmatched");
    expect(telemetryServiceFromName).toHaveBeenCalledWith({
      serviceName: "Core Switch",
      projectId: PROJECT,
    });
  });

  test("a log matched by the address it came from does not say how: that is the ordinary case", async () => {
    await ingest([fromProbe(CISCO_LINK_DOWN, SWITCH_ADDRESS)]);

    expect(Object.keys(attributesOf(onlyRow()))).not.toContain(
      "syslog.matchedBy",
    );
  });
});

describe("a controller's message about a device it manages", () => {
  const UNIFI_DEVICE_OFFLINE: string =
    "<12>Oct 13 10:11:09 udm-pro CEF:0|Ubiquiti|UniFi Network|9.3.33|3|Device Offline|5|UNIFIcategory=System UNIFIsubCategory=Devices UNIFIhost=Office UDM Pro UNIFIdeviceName=Lobby AP UNIFIdeviceIp=192.168.100.5 UNIFIdeviceMac=d8:b3:70:fb:fc:dd msg=Lobby AP went offline.";

  test("is the managed device's log, with the controller recorded as its relay", async () => {
    await ingest([fromProbe(UNIFI_DEVICE_OFFLINE, CONSOLE_ADDRESS)]);

    const row: JSONObject = onlyRow();
    const attributes: Record<string, unknown> = attributesOf(row);

    expect(row["primaryEntityId"]).toBe(
      serviceIdFor(PROJECT, "Lobby AP").toString(),
    );
    expect(attributes["networkDevice.id"]).toBe(ACCESS_POINT.toString());
    expect(attributes["networkDevice.name"]).toBe("Lobby AP");
    expect(attributes["syslog.matchedBy"]).toBe("mac-address");
    expect(attributes["syslog.relay.id"]).toBe(CONSOLE.toString());
    expect(attributes["syslog.relay.name"]).toBe("Office UDM Pro");
    expect(attributes["syslog.sourceIp"]).toBe(CONSOLE_ADDRESS);
    expect(attributes["event.name"]).toBe("device.offline");
    expect(attributes["event.message"]).toBe("Lobby AP went offline.");
    expect(attributes["cef.UNIFIdeviceMac"]).toBe("d8:b3:70:fb:fc:dd");
  });

  test("a message about the controller itself stays the controller's, with no relay", async () => {
    await ingest([
      fromProbe(
        "<14>Oct 13 10:11:09 udm-pro CEF:0|Ubiquiti|UniFi Network|9.3.33|544|Admin Accessed UniFi Network|1|UNIFIhost=Office UDM Pro UNIFIadmin=Craig src=105.5.138.59 msg=Craig accessed UniFi Network.",
        CONSOLE_ADDRESS,
      ),
    ]);

    const attributes: Record<string, unknown> = attributesOf(onlyRow());

    expect(attributes["networkDevice.id"]).toBe(CONSOLE.toString());
    expect(Object.keys(attributes)).not.toContain("syslog.relay.id");
    expect(Object.keys(attributes)).not.toContain("syslog.matchedBy");
    expect(attributes["event.name"]).toBe("auth.login_success");
  });

  test("a managed device the project does not have stays the controller's log", async () => {
    await ingest([
      fromProbe(
        "<12>Oct 13 10:11:09 udm-pro CEF:0|Ubiquiti|UniFi Network|9.3.33|3|Device Offline|5|UNIFIdeviceName=Garage AP UNIFIdeviceMac=00:11:22:33:44:55 msg=Garage AP went offline.",
        CONSOLE_ADDRESS,
      ),
    ]);

    const attributes: Record<string, unknown> = attributesOf(onlyRow());

    expect(attributes["networkDevice.id"]).toBe(CONSOLE.toString());
    expect(attributes["event.name"]).toBe("device.offline");
    expect(Object.keys(attributes)).not.toContain("syslog.relay.id");
  });
});

describe("a global probe, where one address can be a device in several projects", () => {
  test("each project's device gets its own log, in its project, through its own rules", async () => {
    const theirSwitch: NetworkDevice = device({
      id: ObjectID.generate(),
      projectId: OTHER_PROJECT,
      name: "Their Switch",
      hostname: SWITCH_ADDRESS,
    });

    probeProjectId = null;
    projectDevices.push(theirSwitch);
    probeDevicesByAddress[SWITCH_ADDRESS] = [SWITCH_DEVICE, theirSwitch];

    const result: ProbeSyslogIngestResult = await ingest([
      fromProbe(CISCO_LINK_DOWN, SWITCH_ADDRESS),
    ]);

    expect(result.written).toBe(2);
    expect(
      insertedRows.map((row: JSONObject): unknown => {
        return row["projectId"];
      }),
    ).toEqual([PROJECT.toString(), OTHER_PROJECT.toString()]);
    expect(attributesOf(insertedRows[0])["networkDevice.name"]).toBe(
      "Core Switch",
    );
    expect(attributesOf(insertedRows[1])["networkDevice.name"]).toBe(
      "Their Switch",
    );
    expect(insertedRows[0]?.["_id"]).not.toBe(insertedRows[1]?.["_id"]);

    for (const projectId of [PROJECT, OTHER_PROJECT]) {
      expect(loadPipelines).toHaveBeenCalledWith(projectId);
      expect(loadDropFilters).toHaveBeenCalledWith(projectId);
      expect(loadScrubRules).toHaveBeenCalledWith(projectId);
    }
  });
});

describe("a format with no mark of its own", () => {
  const ROUTEROS_SYSLOG_FORMAT: string =
    "<27>Oct  2 17:36:35 MikroTik login failure for user guest from 192.168.88.17 via ssh";

  test("is read with its maker's parser when the device it came from is that maker's", async () => {
    await ingest([fromProbe(ROUTEROS_SYSLOG_FORMAT, "10.9.0.1")]);

    const attributes: Record<string, unknown> = attributesOf(onlyRow());

    expect(attributes["networkDevice.id"]).toBe(ROUTER.toString());
    expect(attributes["syslog.vendor"]).toBe("MikroTik");
    expect(attributes["event.name"]).toBe("auth.login_failed");
    expect(attributes["user.name"]).toBe("guest");
  });

  test("is left alone from a device whose maker is not known", async () => {
    await ingest([fromProbe(ROUTEROS_SYSLOG_FORMAT, SWITCH_ADDRESS)]);

    const attributes: Record<string, unknown> = attributesOf(onlyRow());

    expect(attributes["networkDevice.id"]).toBe(SWITCH.toString());
    expect(Object.keys(attributes)).not.toContain("syslog.vendor");
    expect(Object.keys(attributes)).not.toContain("event.name");
  });
});

describe("a line without a priority", () => {
  test("takes the severity its vendor's format states: a RouterOS login failure is an error", async () => {
    await ingest([
      fromProbe(
        "system,error,critical login failure for user guest from 192.168.88.17 via ssh",
        "10.9.0.1",
      ),
    ]);

    const row: JSONObject = onlyRow();
    const attributes: Record<string, unknown> = attributesOf(row);

    expect(row["severityText"]).toBe(LogSeverity.Error);
    expect(attributes["syslog.severity.code"]).toBe(3);
    expect(attributes["syslog.severity.name"]).toBe("error");
    // What a relay assumes for a facility nobody gave: user.
    expect(attributes["syslog.facility.code"]).toBe(1);
    expect(attributes["syslog.facility.name"]).toBe("user");
    expect(attributes["event.name"]).toBe("auth.login_failed");
    expect(attributes["mikrotik.topics"]).toBe("system,error,critical");
  });

  test("with nothing to say about its severity is a notice", async () => {
    await ingest([fromProbe("the fan sounds odd", SWITCH_ADDRESS)]);

    const row: JSONObject = onlyRow();

    expect(row["severityText"]).toBe(LogSeverity.Information);
    expect(attributesOf(row)["syslog.severity.code"]).toBe(5);
    expect(attributesOf(row)["syslog.severity.name"]).toBe("notice");
  });

  test("a line WITH a priority keeps it, whatever its vendor's format says", async () => {
    // Priority 190 is local7.informational; the mnemonic says 3.
    await ingest([
      fromProbe(
        "<190>%LINK-3-UPDOWN: Interface GigabitEthernet0/1, changed state to down",
        SWITCH_ADDRESS,
      ),
    ]);

    expect(onlyRow()["severityText"]).toBe(LogSeverity.Information);
    expect(attributesOf(onlyRow())["syslog.severity.code"]).toBe(6);
  });
});

describe("RFC 5424 structured data", () => {
  test("is kept, as the HTTP syslog path keeps it", async () => {
    await ingest([
      fromProbe(
        '<165>1 2026-10-13T10:11:09.003Z core-sw1 evntslog 4711 ID47 [exampleSDID@32473 iut="3" eventSource="Application"][meta sequenceId="9"] An application event',
        SWITCH_ADDRESS,
      ),
    ]);

    const attributes: Record<string, unknown> = attributesOf(onlyRow());

    expect(onlyRow()["body"]).toBe("An application event");
    expect(attributes["syslog.processId"]).toBe("4711");
    expect(attributes["syslog.messageId"]).toBe("ID47");
    expect(attributes["syslog.structured.raw"]).toBe(
      '[exampleSDID@32473 iut="3" eventSource="Application"][meta sequenceId="9"]',
    );
    expect(attributes["syslog.structured.exampleSDID_32473.iut"]).toBe("3");
    expect(attributes["syslog.structured.exampleSDID_32473.eventSource"]).toBe(
      "Application",
    );
    expect(attributes["syslog.structured.meta.sequenceId"]).toBe("9");
  });
});

describe("nothing a line says can change where it came from", () => {
  test("pairs named like what ingest sets are stored under the vendor's prefix, and ingest's values stand", async () => {
    await ingest([
      fromProbe(
        `<30>log_type="Event" log_component="IPSec" log_subtype="System" status="Terminated" networkDevice.id="${ACCESS_POINT.toString()}" networkDevice.name="Lobby AP" syslog.sourceIp="1.2.3.4" probe.id="forged" oneuptime.service.name="forged" syslog.unmatched="true" syslog.relay.id="forged"`,
        SWITCH_ADDRESS,
      ),
    ]);

    const attributes: Record<string, unknown> = attributesOf(onlyRow());

    expect(attributes["networkDevice.id"]).toBe(SWITCH.toString());
    expect(attributes["networkDevice.name"]).toBe("Core Switch");
    expect(attributes["syslog.sourceIp"]).toBe(SWITCH_ADDRESS);
    expect(attributes["probe.id"]).toBe(PROBE.toString());
    expect(attributes["oneuptime.service.name"]).toBe("Core Switch");
    expect(Object.keys(attributes)).not.toContain("syslog.unmatched");
    expect(Object.keys(attributes)).not.toContain("syslog.relay.id");
    // What the line said is there, where it cannot be mistaken for ingest's.
    expect(attributes["sophos.networkDevice.id"]).toBe(ACCESS_POINT.toString());
    expect(attributes["sophos.syslog.sourceIp"]).toBe("1.2.3.4");
  });

  test("a CEF pair cannot either", async () => {
    await ingest([
      fromProbe(
        "<134>CEF:0|Example|Thing|1|1|Name|5|networkDevice.id=forged syslog.sourceIp=1.2.3.4 probe.id=forged",
        SWITCH_ADDRESS,
      ),
    ]);

    const attributes: Record<string, unknown> = attributesOf(onlyRow());

    expect(attributes["networkDevice.id"]).toBe(SWITCH.toString());
    expect(attributes["syslog.sourceIp"]).toBe(SWITCH_ADDRESS);
    expect(attributes["probe.id"]).toBe(PROBE.toString());
    expect(attributes["cef.networkDevice.id"]).toBe("forged");
  });
});

describe("drop filters, scrub rules and pipelines", () => {
  test("a drop filter can use what the parsers read: the row is not written", async () => {
    const dropFilters: Array<LoadedLogDropFilter> = [
      {
        compiledFilter: compileFilter(
          "attributes.event.name = 'wireless.client_connected'",
        ),
      },
    ] as unknown as Array<LoadedLogDropFilter>;

    loadDropFilters.mockResolvedValue(dropFilters as never);

    const shouldDrop: MockedFn = jest
      .spyOn(LogDropFilterService, "shouldDropLog")
      .mockImplementation(((row: JSONObject): boolean => {
        return attributesOf(row)["event.name"] === "wireless.client_connected";
      }) as never) as unknown as MockedFn;

    const result: ProbeSyslogIngestResult = await ingest([
      fromProbe(
        "<30>Oct 13 10:11:09 ap-lobby hostapd: wlan0: STA 00:11:22:33:44:55 IEEE 802.11: associated",
        SWITCH_ADDRESS,
      ),
      fromProbe(CISCO_LINK_DOWN, SWITCH_ADDRESS),
    ]);

    expect(shouldDrop).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ written: 1, droppedByFilter: 1 });
    expect(attributesOf(onlyRow())["event.name"]).toBe("interface.down");
  });

  test("scrub rules run on the row the parsers filled", async () => {
    loadScrubRules.mockResolvedValue([{ name: "rule" }] as never);

    const scrub: MockedFn = jest
      .spyOn(LogScrubRuleService, "scrubLog")
      .mockImplementation(((row: JSONObject): JSONObject => {
        return {
          ...row,
          attributes: { ...attributesOf(row), "user.name": "[REDACTED]" },
        } as JSONObject;
      }) as never) as unknown as MockedFn;

    await ingest([
      fromProbe(
        "<38>Oct 13 10:11:09 ap-lobby sshd[4321]: Failed password for root from 192.0.2.10 port 51234 ssh2",
        SWITCH_ADDRESS,
      ),
    ]);

    expect(scrub).toHaveBeenCalledTimes(1);
    // The rule saw the attribute the parser extracted.
    expect(
      attributesOf(scrub.mock.calls[0]?.[0] as JSONObject)["user.name"],
    ).toBe("root");
    expect(attributesOf(onlyRow())["user.name"]).toBe("[REDACTED]");
  });

  test("a pipeline's filter can match on the event a parser found", async () => {
    loadPipelines.mockResolvedValue(
      pipelineWith(
        [
          {
            processorType: LogPipelineProcessorType.AttributeRemapper,
            configuration: {
              sourceKey: "network.interface.name",
              targetKey: "port",
              preserveSource: true,
              overrideOnConflict: true,
            },
          },
        ],
        "attributes.event.name = 'interface.down'",
      ) as never,
    );

    await ingest([
      fromProbe(CISCO_LINK_DOWN, SWITCH_ADDRESS),
      fromProbe(
        "<189>Oct 13 10:11:10 core-sw1 46: %LINK-3-UPDOWN: Interface GigabitEthernet0/1, changed state to up",
        SWITCH_ADDRESS,
      ),
    ]);

    expect(attributesOf(insertedRows[0])["port"]).toBe("GigabitEthernet0/1");
    expect(Object.keys(attributesOf(insertedRows[1]))).not.toContain("port");
  });

  test("a project names an event of its own in a pipeline, and it becomes a network event", async () => {
    // A UPS no parser knows: a grok pattern reads it, a category names it.
    loadPipelines.mockResolvedValue(
      pipelineWith([
        {
          processorType: LogPipelineProcessorType.GrokParser,
          configuration: {
            source: "body",
            pattern: "UPS %{NOTSPACE:ups_name} is on battery",
            targetPrefix: "ups",
          },
        },
        {
          processorType: LogPipelineProcessorType.CategoryProcessor,
          configuration: {
            targetKey: "event.name",
            categories: [
              {
                name: "ups.on_battery",
                filterQuery: "body LIKE 'is on battery'",
              },
            ],
          },
        },
      ]) as never,
    );

    await ingest([
      fromProbe(
        "<132>Oct 13 10:11:09 ups-rack-1 upsd: UPS rack-1 is on battery",
        SWITCH_ADDRESS,
      ),
    ]);

    const row: JSONObject = onlyRow();
    const attributes: Record<string, unknown> = attributesOf(row);

    expect(attributes["ups.ups_name"]).toBe("rack-1");
    expect(attributes["event.name"]).toBe("ups.on_battery");
    expect(attributes["event.domain"]).toBe("network");
    expect((row["attributeKeys"] as Array<string>).slice().sort()).toEqual(
      Object.keys(attributes).sort(),
    );
  });

  test("a category that is not an event's name is left as the pipeline wrote it", async () => {
    loadPipelines.mockResolvedValue(
      pipelineWith([
        {
          processorType: LogPipelineProcessorType.CategoryProcessor,
          configuration: {
            targetKey: "event.name",
            categories: [{ name: "Battery Problem", filterQuery: "" }],
          },
        },
      ]) as never,
    );

    await ingest([fromProbe("<132>UPS rack-1 is on battery", SWITCH_ADDRESS)]);

    const attributes: Record<string, unknown> = attributesOf(onlyRow());

    expect(attributes["event.name"]).toBe("Battery Problem");
    expect(Object.keys(attributes)).not.toContain("event.domain");
  });

  test("a pipeline can rename a built-in event, and it stays a network event", async () => {
    loadPipelines.mockResolvedValue(
      pipelineWith([
        {
          processorType: LogPipelineProcessorType.CategoryProcessor,
          configuration: {
            targetKey: "event.name",
            categories: [
              {
                name: "uplink.down",
                filterQuery:
                  "attributes.network.interface.name = 'GigabitEthernet0/1'",
              },
            ],
          },
        },
      ]) as never,
    );

    await ingest([fromProbe(CISCO_LINK_DOWN, SWITCH_ADDRESS)]);

    expect(attributesOf(onlyRow())["event.name"]).toBe("uplink.down");
    expect(attributesOf(onlyRow())["event.domain"]).toBe("network");
  });

  test("the Key=Value Parser the docs used to ask for changes nothing: the fields are already there", async () => {
    const line: string =
      '<30>device_name="SFW" log_type="Event" log_component="IPSec" log_subtype="System" con_name="HQ-Branch1" status="Terminated" message="IPSec Connection HQ-Branch1 terminated."';

    await ingest([fromProbe(line, SWITCH_ADDRESS)]);

    const withoutPipeline: Record<string, unknown> = attributesOf(onlyRow());

    insertedRows = [];
    loadPipelines.mockResolvedValue(
      pipelineWith(
        [
          {
            processorType: LogPipelineProcessorType.KeyValueParser,
            configuration: { source: "body", targetPrefix: "sophos" },
          },
        ],
        "body LIKE 'log_component='",
      ) as never,
    );

    await ingest([fromProbe(line, SWITCH_ADDRESS)]);

    // The same keys with the same values: a monitor built on either reads the other.
    expect(attributesOf(onlyRow())).toEqual(withoutPipeline);
    expect(withoutPipeline["sophos.con_name"]).toBe("HQ-Branch1");
  });

  test("rules that cannot be loaded never stop a log from being stored", async () => {
    loadPipelines.mockRejectedValue(new Error("database is down") as never);

    const result: ProbeSyslogIngestResult = await ingest([
      fromProbe(CISCO_LINK_DOWN, SWITCH_ADDRESS),
    ]);

    expect(result.written).toBe(1);
    expect(attributesOf(onlyRow())["event.name"]).toBe("interface.down");
  });
});

describe("a batch", () => {
  test("asks for each project's rules, and each device's telemetry service, once", async () => {
    const batch: Array<JSONObject> = [];

    for (let index: number = 0; index < 40; index++) {
      batch.push(
        fromProbe(
          `<187>%LINK-3-UPDOWN: Interface GigabitEthernet0/${index}, changed state to down`,
          index % 2 === 0 ? SWITCH_ADDRESS : "10.9.0.1",
        ),
      );
    }

    const result: ProbeSyslogIngestResult = await ingest(batch);

    expect(result.written).toBe(40);
    expect(telemetryServiceFromName).toHaveBeenCalledTimes(2);
    expect(loadPipelines).toHaveBeenCalledTimes(1);
    expect(loadDropFilters).toHaveBeenCalledTimes(1);
    expect(loadScrubRules).toHaveBeenCalledTimes(1);
    // One insert for the whole batch.
    expect(insertJsonRows).toHaveBeenCalledTimes(1);
  });

  test("skips what it cannot read and stores the rest", async () => {
    const result: ProbeSyslogIngestResult = await ingest([
      null as unknown as JSONObject,
      "a string" as unknown as JSONObject,
      [] as unknown as JSONObject,
      {} as JSONObject,
      { sourceIpAddress: SWITCH_ADDRESS, facility: 1, severity: 5 },
      { sourceIpAddress: "", facility: 1, severity: 5, message: "no source" },
      {
        sourceIpAddress: SWITCH_ADDRESS,
        facility: "x",
        severity: 5,
        message: "bad facility",
      },
      fromProbe(CISCO_LINK_DOWN, SWITCH_ADDRESS),
    ]);

    expect(result).toMatchObject({ written: 1, malformed: 7 });
    expect(attributesOf(onlyRow())["event.name"]).toBe("interface.down");
  });

  test("one message that fails does not take the others with it", async () => {
    telemetryServiceFromName.mockImplementationOnce(
      (async (): Promise<never> => {
        throw new Error("could not resolve the service");
      }) as never,
    );

    const result: ProbeSyslogIngestResult = await ingest([
      fromProbe(CISCO_LINK_DOWN, SWITCH_ADDRESS),
      fromProbe(CISCO_LINK_DOWN, SWITCH_ADDRESS),
    ]);

    expect(result.written).toBe(1);
  });

  test("with nothing to store inserts nothing", async () => {
    probeProjectId = null;

    await ingest([fromProbe(CISCO_LINK_DOWN, STRANGER_ADDRESS)]);
    await ingest([]);

    expect(insertJsonRows).not.toHaveBeenCalled();
  });

  test("a probe whose row cannot be read still has its devices' logs stored", async () => {
    (ProbeService.findOneById as unknown as MockedFn).mockRejectedValue(
      new Error("database is down") as never,
    );

    const result: ProbeSyslogIngestResult = await ingest([
      fromProbe(CISCO_LINK_DOWN, SWITCH_ADDRESS),
      // And a stranger's is dropped: there is no project known to keep it for.
      fromProbe(STRANGER_LINK_DOWN, STRANGER_ADDRESS),
    ]);

    expect(result).toMatchObject({ written: 1, droppedUnmatched: 1 });
  });

  test("a flapping interface writes every event with the same device, event and interface", async () => {
    const batch: Array<JSONObject> = [];

    for (let index: number = 0; index < 50; index++) {
      batch.push(
        fromProbe(
          `<187>Oct 13 10:11:09 core-sw1 ${index}: %LINK-3-UPDOWN: Interface GigabitEthernet0/1, changed state to ${index % 2 === 0 ? "down" : "up"}`,
          SWITCH_ADDRESS,
        ),
      );
    }

    await ingest(batch);

    expect(insertedRows).toHaveLength(50);

    const downs: Array<JSONObject> = insertedRows.filter(
      (row: JSONObject): boolean => {
        return attributesOf(row)["event.name"] === "interface.down";
      },
    );

    expect(downs).toHaveLength(25);
    // What a monitor groups by is identical on every one of them.
    expect(
      new Set(
        downs.map((row: JSONObject): string => {
          return [
            attributesOf(row)["networkDevice.name"],
            attributesOf(row)["network.interface.name"],
          ].join("|");
        }),
      ),
    ).toEqual(new Set(["Core Switch|GigabitEthernet0/1"]));
  });
});

describe("the time a log is stored under", () => {
  function resolve(data: {
    deviceOffsetMs: number;
    receivedOffsetMs?: number;
    headerFormat: SyslogHeaderFormat | null;
  }): ResolvedLogTime {
    const receivedAt: Date = new Date(
      NOW.getTime() + (data.receivedOffsetMs ?? -2000),
    );

    return ProbeSyslogIngestService.resolveLogTime({
      timestamp: new Date(NOW.getTime() + data.deviceOffsetMs),
      receivedAt: receivedAt,
      headerFormat: data.headerFormat,
      now: NOW,
    });
  }

  const HOUR: number = 60 * 60 * 1000;
  const RECEIVED: number = NOW.getTime() - 2000;

  const EVERY_FORMAT: Array<SyslogHeaderFormat | null> = [
    SyslogHeaderFormat.Rfc3164,
    SyslogHeaderFormat.Rfc5424,
    SyslogHeaderFormat.None,
    // A probe too old to say which header it read.
    null,
  ];

  test("is the time the probe received it, when the device's clock agrees with the probe's to within five minutes", () => {
    for (const headerFormat of EVERY_FORMAT) {
      for (const offset of [
        -3000,
        -2000 - MAX_DEVICE_CLOCK_SKEW_IN_MS,
        -2000 + MAX_DEVICE_CLOCK_SKEW_IN_MS,
        -4 * 60 * 1000,
        4 * 60 * 1000,
      ]) {
        const resolved: ResolvedLogTime = resolve({
          deviceOffsetMs: offset,
          headerFormat,
        });

        expect({
          headerFormat,
          offset,
          time: resolved.time.getTime(),
          deviceTime: resolved.deviceTime,
        }).toEqual({
          headerFormat,
          offset,
          time: RECEIVED,
          deviceTime: null,
        });
      }
    }
  });

  test("a link that goes down and comes back within one second of the device's clock is stored in the order it arrived", () => {
    // Both lines carry "10:11:09"; the probe heard them 300 ms apart.
    const deviceSecond: Date = new Date(NOW.getTime() - 3000);

    const down: ResolvedLogTime = ProbeSyslogIngestService.resolveLogTime({
      timestamp: deviceSecond,
      receivedAt: new Date(NOW.getTime() - 2600),
      headerFormat: SyslogHeaderFormat.Rfc3164,
      now: NOW,
    });
    const up: ResolvedLogTime = ProbeSyslogIngestService.resolveLogTime({
      timestamp: deviceSecond,
      receivedAt: new Date(NOW.getTime() - 2300),
      headerFormat: SyslogHeaderFormat.Rfc3164,
      now: NOW,
    });

    expect(up.time.getTime()).toBeGreaterThan(down.time.getTime());
    expect(up.time.getTime() - down.time.getTime()).toBe(300);
  });

  test("a device four minutes behind is stored where a monitor's last five minutes will still find it", () => {
    const resolved: ResolvedLogTime = resolve({
      deviceOffsetMs: -4 * 60 * 1000 - 50 * 1000,
      headerFormat: SyslogHeaderFormat.Rfc3164,
    });

    // At its own time it would leave a five-minute window ten seconds later.
    expect(NOW.getTime() - resolved.time.getTime()).toBe(2000);
  });

  test("a time with no zone that is hours off is a device in another time zone: the probe's receive time is used, and the device's kept beside it", () => {
    for (const headerFormat of [
      SyslogHeaderFormat.Rfc3164,
      SyslogHeaderFormat.None,
      null,
    ]) {
      for (const offset of [2 * HOUR, -2 * HOUR, -400 * 24 * HOUR]) {
        const resolved: ResolvedLogTime = resolve({
          deviceOffsetMs: offset,
          headerFormat,
        });

        expect({
          headerFormat,
          offset,
          time: resolved.time.getTime(),
          deviceTime: resolved.deviceTime?.getTime(),
        }).toEqual({
          headerFormat,
          offset,
          time: RECEIVED,
          deviceTime: NOW.getTime() + offset,
        });
      }
    }
  });

  test("an old time that names its zone is believed: a sender that buffered while its link was down", () => {
    for (const offset of [
      -2000 - MAX_DEVICE_CLOCK_SKEW_IN_MS - 1,
      -HOUR,
      -3 * 24 * HOUR,
      -2000 - MAX_BUFFERED_MESSAGE_AGE_IN_MS,
    ]) {
      const resolved: ResolvedLogTime = resolve({
        deviceOffsetMs: offset,
        headerFormat: SyslogHeaderFormat.Rfc5424,
      });

      expect({ offset, time: resolved.time.getTime() }).toEqual({
        offset,
        time: NOW.getTime() + offset,
      });
      expect(resolved.deviceTime).toBeNull();
    }
  });

  test("...but not when it is older than a buffer can be, or in the future", () => {
    for (const offset of [
      -2000 - MAX_BUFFERED_MESSAGE_AGE_IN_MS - 1,
      -20000 * 24 * HOUR,
      -2000 + MAX_DEVICE_CLOCK_SKEW_IN_MS + 1,
      3 * HOUR,
    ]) {
      const resolved: ResolvedLogTime = resolve({
        deviceOffsetMs: offset,
        headerFormat: SyslogHeaderFormat.Rfc5424,
      });

      expect({
        offset,
        time: resolved.time.getTime(),
        deviceTime: resolved.deviceTime?.getTime(),
      }).toEqual({
        offset,
        time: RECEIVED,
        deviceTime: NOW.getTime() + offset,
      });
    }
  });

  test("when the probe's clock is off, the server's is what a device is held against", () => {
    // The probe says three hours ago; the device agrees with the server.
    const agrees: ResolvedLogTime = resolve({
      deviceOffsetMs: -1000,
      receivedOffsetMs: -3 * HOUR,
      headerFormat: SyslogHeaderFormat.Rfc3164,
    });

    expect(agrees.time.getTime()).toBe(NOW.getTime());
    expect(agrees.deviceTime).toBeNull();

    // The device agrees with neither.
    const disagrees: ResolvedLogTime = resolve({
      deviceOffsetMs: 2 * HOUR,
      receivedOffsetMs: -3 * HOUR,
      headerFormat: SyslogHeaderFormat.Rfc3164,
    });

    expect(disagrees.time.getTime()).toBe(NOW.getTime());
    expect(disagrees.deviceTime?.getTime()).toBe(NOW.getTime() + 2 * HOUR);
  });

  test("a message with no time of its own is stored at the time it was received", () => {
    const receivedAt: Date = new Date(NOW.getTime() - 2000);

    expect(
      ProbeSyslogIngestService.resolveLogTime({
        timestamp: receivedAt,
        receivedAt: receivedAt,
        headerFormat: SyslogHeaderFormat.None,
        now: NOW,
      }),
    ).toEqual({ time: receivedAt, deviceTime: null });

    // ...or now, when the probe's clock cannot be believed either.
    const longAgo: Date = new Date(NOW.getTime() - 5 * HOUR);

    expect(
      ProbeSyslogIngestService.resolveLogTime({
        timestamp: longAgo,
        receivedAt: longAgo,
        headerFormat: SyslogHeaderFormat.None,
        now: NOW,
      }),
    ).toEqual({ time: NOW, deviceTime: null });
  });

  test("no time is ever in the future of the server, or older than a buffer can be", () => {
    for (const headerFormat of EVERY_FORMAT) {
      for (const deviceOffsetMs of [
        -400 * 24 * HOUR,
        -8 * 24 * HOUR,
        -HOUR,
        -1,
        0,
        1,
        HOUR,
        400 * 24 * HOUR,
      ]) {
        for (const receivedOffsetMs of [-9 * HOUR, -2000, 0, 2000, 9 * HOUR]) {
          const time: number = resolve({
            deviceOffsetMs,
            receivedOffsetMs,
            headerFormat,
          }).time.getTime();

          expect(time - NOW.getTime()).toBeLessThanOrEqual(
            MAX_DEVICE_CLOCK_SKEW_IN_MS,
          );
          expect(NOW.getTime() - time).toBeLessThanOrEqual(
            MAX_BUFFERED_MESSAGE_AGE_IN_MS + MAX_DEVICE_CLOCK_SKEW_IN_MS,
          );
        }
      }
    }
  });

  test("a device two hours behind is stored where a monitor's last five minutes can see it", async () => {
    const twoHoursAgo: Date = new Date(NOW.getTime() - 2 * HOUR);

    await ingest([
      fromProbe(CISCO_LINK_DOWN, SWITCH_ADDRESS, {
        timestamp: twoHoursAgo.toISOString(),
      }),
    ]);

    const row: JSONObject = onlyRow();

    expect(row["time"]).toBe(OneUptimeDate.toClickhouseDateTime64(RECEIVED_AT));
    expect(attributesOf(row)["syslog.deviceTime"]).toBe(
      twoHoursAgo.toISOString(),
    );
  });

  test("a device whose clock is right says nothing about its time", async () => {
    await ingest([fromProbe(CISCO_LINK_DOWN, SWITCH_ADDRESS)]);

    expect(Object.keys(attributesOf(onlyRow()))).not.toContain(
      "syslog.deviceTime",
    );
  });

  test("a flap heard in one batch is stored down first, then up, though the device stamped both the same second", async () => {
    const deviceSecond: string = new Date(NOW.getTime() - 3000).toISOString();

    await ingest([
      fromProbe(CISCO_LINK_DOWN, SWITCH_ADDRESS, {
        timestamp: deviceSecond,
        receivedAt: new Date(NOW.getTime() - 2600).toISOString(),
      }),
      fromProbe(
        "<189>Oct 13 10:11:09 core-sw1 46: %LINK-3-UPDOWN: Interface GigabitEthernet0/1, changed state to up",
        SWITCH_ADDRESS,
        {
          timestamp: deviceSecond,
          receivedAt: new Date(NOW.getTime() - 2300).toISOString(),
        },
      ),
    ]);

    expect(
      insertedRows.map((row: JSONObject) => {
        return [attributesOf(row)["event.name"], row["time"]];
      }),
    ).toEqual([
      [
        "interface.down",
        OneUptimeDate.toClickhouseDateTime64(new Date(NOW.getTime() - 2600)),
      ],
      [
        "interface.up",
        OneUptimeDate.toClickhouseDateTime64(new Date(NOW.getTime() - 2300)),
      ],
    ]);
    expect(
      String(insertedRows[1]?.["time"]) > String(insertedRows[0]?.["time"]),
    ).toBe(true);
  });
});

describe("deserializeSyslogMessage", () => {
  test("rebuilds the message a probe posted", () => {
    const message: SyslogMessage | null =
      ProbeSyslogIngestService.deserializeSyslogMessage({
        sourceIpAddress: " 10.0.0.2 ",
        facility: 23,
        severity: "3",
        timestamp: DEVICE_TIME.toISOString(),
        hostname: " core-sw1 ",
        appName: "45",
        message: "text",
        receivedAt: RECEIVED_AT.toISOString(),
        raw: "<187>text",
      });

    expect(message).toEqual({
      sourceIpAddress: "10.0.0.2",
      facility: 23,
      severity: 3,
      timestamp: DEVICE_TIME,
      hostname: "core-sw1",
      appName: "45",
      message: "text",
      receivedAt: RECEIVED_AT,
      raw: "<187>text",
    });
  });

  test("a missing or unreadable time falls back: the timestamp to the receive time, the receive time to now", () => {
    const message: SyslogMessage | null =
      ProbeSyslogIngestService.deserializeSyslogMessage({
        sourceIpAddress: "10.0.0.2",
        facility: 1,
        severity: 5,
        message: "text",
        timestamp: "not a date",
      });

    expect(message?.receivedAt).toEqual(NOW);
    expect(message?.timestamp).toEqual(NOW);
  });

  test("blank host and tag are absent, and a blank raw line is not kept", () => {
    const message: SyslogMessage | null =
      ProbeSyslogIngestService.deserializeSyslogMessage({
        sourceIpAddress: "10.0.0.2",
        facility: 1,
        severity: 5,
        message: "",
        hostname: "  ",
        appName: 12,
        raw: "   ",
      });

    expect(message?.hostname).toBeUndefined();
    expect(message?.appName).toBeUndefined();
    expect(Object.keys(message || {})).not.toContain("raw");
    // An empty message is still a message.
    expect(message?.message).toBe("");
  });

  test("cuts a raw line no datagram could carry", () => {
    const message: SyslogMessage | null =
      ProbeSyslogIngestService.deserializeSyslogMessage({
        sourceIpAddress: "10.0.0.2",
        facility: 1,
        severity: 5,
        message: "text",
        raw: "x".repeat(200_000),
      });

    expect(message?.raw).toHaveLength(65536);
  });

  test("refuses what is not a message", () => {
    for (const value of [
      null,
      undefined,
      [],
      {},
      { sourceIpAddress: "10.0.0.2", facility: 1, severity: 5 },
      { sourceIpAddress: "10.0.0.2", facility: 1, severity: 5, message: 12 },
      { sourceIpAddress: 12, facility: 1, severity: 5, message: "text" },
      { sourceIpAddress: "10.0.0.2", severity: 5, message: "text" },
      {
        sourceIpAddress: "10.0.0.2",
        facility: null,
        severity: 5,
        message: "t",
      },
      { sourceIpAddress: "10.0.0.2", facility: 1, severity: "x", message: "t" },
    ]) {
      expect({
        value,
        message: ProbeSyslogIngestService.deserializeSyslogMessage(
          value as unknown as JSONObject,
        ),
      }).toEqual({ value, message: null });
    }
  });
});

describe("readMessage", () => {
  function message(overrides: Partial<SyslogMessage>): SyslogMessage {
    return {
      sourceIpAddress: SWITCH_ADDRESS,
      facility: 23,
      severity: 3,
      timestamp: DEVICE_TIME,
      message: "as the probe read it",
      receivedAt: RECEIVED_AT,
      ...overrides,
    };
  }

  test("reads the raw line with the reader every syslog path shares", () => {
    const read: ReadProbeSyslogMessage = ProbeSyslogIngestService.readMessage(
      message({
        hostname: "wrong-host",
        appName: "wrong-app",
        raw: '<165>1 2026-10-13T10:11:09.003Z core-sw1 evntslog 4711 ID47 [meta sequenceId="9"] An application event',
      }),
    );

    expect(read).toEqual({
      sourceIpAddress: SWITCH_ADDRESS,
      facility: 20,
      severity: 5,
      hasPriority: true,
      // The probe's reading of the time stands.
      timestamp: DEVICE_TIME,
      receivedAt: RECEIVED_AT,
      headerFormat: SyslogHeaderFormat.Rfc5424,
      hostname: "core-sw1",
      appName: "evntslog",
      procId: "4711",
      msgId: "ID47",
      structuredDataRaw: '[meta sequenceId="9"]',
      structuredData: { meta: { sequenceId: "9" } },
      message: "An application event",
      content: undefined,
    });
  });

  test("a raw line without a priority is given what a relay assumes for it", () => {
    const read: ReadProbeSyslogMessage = ProbeSyslogIngestService.readMessage(
      message({
        facility: 9,
        severity: 0,
        raw: "interface,info ether1 link down",
      }),
    );

    expect(read.hasPriority).toBe(false);
    expect(read.facility).toBe(1);
    expect(read.severity).toBe(5);
    expect(read.headerFormat).toBe(SyslogHeaderFormat.None);
    expect(read.message).toBe("interface,info ether1 link down");
  });

  test("keeps the text after the header for the vendor parsers, tag and all", () => {
    const read: ReadProbeSyslogMessage = ProbeSyslogIngestService.readMessage(
      message({
        raw: "<14>Jan  7 20:22:55 10.1.1.5 00076 ports: port 3 is now on-line",
      }),
    );

    expect(read.hostname).toBe("10.1.1.5");
    expect(read.message).toBe("ports: port 3 is now on-line");
    expect(read.content).toBe("00076 ports: port 3 is now on-line");
    expect(read.headerFormat).toBe(SyslogHeaderFormat.Rfc3164);
  });

  test("without a raw line, uses what the probe read, and puts a tag back in front of its message", () => {
    expect(
      ProbeSyslogIngestService.readMessage(
        message({ hostname: "ap-lobby", appName: "sshd" }),
      ),
    ).toEqual({
      sourceIpAddress: SWITCH_ADDRESS,
      facility: 23,
      severity: 3,
      hasPriority: true,
      timestamp: DEVICE_TIME,
      receivedAt: RECEIVED_AT,
      headerFormat: null,
      hostname: "ap-lobby",
      appName: "sshd",
      message: "as the probe read it",
      content: "sshd: as the probe read it",
    });

    expect(
      Object.keys(ProbeSyslogIngestService.readMessage(message({}))),
    ).not.toContain("content");
  });
});
