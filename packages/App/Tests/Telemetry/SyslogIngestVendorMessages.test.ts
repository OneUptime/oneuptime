import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Syslog posted to /syslog/v1/logs (the path a relay, a log shipper or a
 * server uses), read by the same vendor parsers as the syslog a probe
 * hears. What differs here is who can be sending: this endpoint is also
 * where servers send their syslog, and there is no sender address to go by.
 *
 * What this suite holds:
 *
 *   - an ordinary line is stored exactly as it was before the parsers;
 *   - a vendor's line gets the vendor's fields and the event it is;
 *   - a message that names one network device of the project is that
 *     device's log, and one that names none, or several, is nobody's;
 *   - a server's sshd line is not a network event; an access point's is;
 *   - nothing the parsers or the device lookup do can lose a message.
 *
 * The queue and the response stack are replaced wholesale (they pull in
 * BullMQ and Express at import time); the databases are stubbed at their
 * services.
 */

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: jest.fn(),
    },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

import SyslogIngestService from "../../FeatureSet/Telemetry/Services/SyslogIngestService";
import LogPipelineService, {
  LoadedPipeline,
} from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import { compileFilter } from "../../FeatureSet/Telemetry/Utils/LogFilterEvaluator";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import LogService from "Common/Server/Services/LogService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import { ExpressRequest } from "Common/Server/Utils/Express";
import SyslogDeviceMatcher from "Common/Server/Utils/Syslog/SyslogDeviceMatcher";
import TelemetryFanInWriter from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import {
  ALL_SYSLOG_VENDOR_SAMPLES,
  SyslogVendorSample,
} from "Common/Tests/Helpers/SyslogVendorSamples";
import { JSONObject } from "Common/Types/JSON";
import LogPipelineProcessorType from "Common/Types/Log/LogPipelineProcessorType";
import LogSeverity from "Common/Types/Log/LogSeverity";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { SyslogParserId } from "Common/Utils/Syslog/SyslogVendorParser";

type MockedFn = jest.Mock;

const PROJECT: ObjectID = ObjectID.generate();
const SWITCH: ObjectID = ObjectID.generate();
const ACCESS_POINT: ObjectID = ObjectID.generate();
const ROUTER: ObjectID = ObjectID.generate();

interface DeviceFields {
  id: ObjectID;
  name: string;
  hostname: string;
  macAddress?: string;
  vendor?: string;
  sysName?: string;
}

function device(fields: DeviceFields): NetworkDevice {
  const value: NetworkDevice = new NetworkDevice(fields.id);

  value.projectId = PROJECT;
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

let projectDevices: Array<NetworkDevice> = [];
let submittedRows: Array<JSONObject> = [];
let findDevices: MockedFn;
let loadPipelines: MockedFn;

const serviceIds: Record<string, ObjectID> = {};

function serviceIdFor(serviceName: string): ObjectID {
  serviceIds[serviceName] = serviceIds[serviceName] || ObjectID.generate();

  return serviceIds[serviceName] as ObjectID;
}

beforeEach(() => {
  SyslogDeviceMatcher.clearCaches();

  projectDevices = [
    device({
      id: SWITCH,
      name: "Core Switch",
      hostname: "10.0.0.2",
      sysName: "core-sw1",
    }),
    device({
      id: ACCESS_POINT,
      name: "Lobby AP",
      hostname: "192.168.100.5",
      macAddress: "d8:b3:70:fb:fc:dd",
      sysName: "ap-lobby",
    }),
    device({
      id: ROUTER,
      name: "Branch Router",
      hostname: "10.9.0.1",
      vendor: "MikroTik",
      sysName: "branch-rtr-01",
    }),
  ];
  submittedRows = [];

  findDevices = jest
    .spyOn(NetworkDeviceService, "findBy")
    .mockImplementation((async (): Promise<Array<NetworkDevice>> => {
      return projectDevices;
    }) as never) as unknown as MockedFn;

  jest
    .spyOn(OTelIngestService, "telemetryServiceFromName")
    .mockImplementation((async (data: {
      serviceName: string;
    }): Promise<TelemetryServiceMetadata> => {
      return {
        serviceName: data.serviceName,
        primaryEntityId: serviceIdFor(data.serviceName),
        primaryEntityType: ServiceType.OpenTelemetry,
        dataRententionInDays: 30,
        serviceRetentionConfig: null,
        serviceRetentionInDays: 30,
        projectRetentionConfig: null,
        projectRetentionInDays: 15,
      };
    }) as never);

  jest.spyOn(TelemetryFanInWriter, "submit").mockImplementation((async (
    service: unknown,
    rows: Array<JSONObject>,
  ): Promise<{ flushed: Promise<void> }> => {
    expect(service).toBe(LogService);
    submittedRows.push(...rows);

    return { flushed: Promise.resolve() };
  }) as never);

  loadPipelines = jest
    .spyOn(LogPipelineService, "loadPipelines")
    .mockResolvedValue([] as never) as unknown as MockedFn;

  jest
    .spyOn(LogDropFilterService, "loadDropFilters")
    .mockResolvedValue([] as never);
  jest
    .spyOn(LogScrubRuleService, "loadScrubRules")
    .mockResolvedValue([] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  SyslogDeviceMatcher.clearCaches();
});

async function ingest(
  messages: Array<string>,
  headers: Record<string, string> = {},
): Promise<void> {
  await SyslogIngestService.processSyslogFromQueue({
    projectId: PROJECT,
    body: { messages: messages },
    headers: headers,
    query: {},
  } as unknown as ExpressRequest);
}

function attributesOf(row: JSONObject | undefined): Record<string, unknown> {
  return ((row || {})["attributes"] || {}) as Record<string, unknown>;
}

function onlyRow(): JSONObject {
  expect(submittedRows).toHaveLength(1);

  return submittedRows[0] as JSONObject;
}

async function attributesOfLine(
  line: string,
): Promise<Record<string, unknown>> {
  submittedRows = [];

  await ingest([line]);

  return attributesOf(onlyRow());
}

describe("an ordinary line", () => {
  test("is stored exactly as it was before the vendor parsers", async () => {
    const line: string =
      '<165>1 2026-10-13T10:11:09.003Z web-01 nginx 4711 ID47 [meta sequenceId="9"] GET /health 200';

    await ingest([line]);

    const row: JSONObject = onlyRow();
    const serviceId: ObjectID = serviceIdFor("nginx");

    expect(row["body"]).toBe("GET /health 200");
    expect(row["severityText"]).toBe(LogSeverity.Information);
    expect(row["primaryEntityId"]).toBe(serviceId.toString());
    expect(attributesOf(row)).toEqual({
      "oneuptime.service.id": serviceId.toString(),
      "oneuptime.service.name": "nginx",
      "syslog.raw": line,
      "syslog.hostname": "web-01",
      "syslog.appName": "nginx",
      "syslog.processId": "4711",
      "syslog.messageId": "ID47",
      "syslog.version": 1,
      "syslog.priority": 165,
      "syslog.severity.code": 5,
      "syslog.severity.name": "notice",
      "syslog.facility.code": 20,
      "syslog.facility.name": "local4",
      "syslog.structured.raw": '[meta sequenceId="9"]',
      "syslog.structured.meta.sequenceId": "9",
    });
    expect((row["attributeKeys"] as Array<string>).slice().sort()).toEqual(
      Object.keys(attributesOf(row)).sort(),
    );
  });

  test("that names no host does not make ingest read the project's devices", async () => {
    await ingest(["<134>just some text", "no priority, and no host either"]);

    expect(submittedRows).toHaveLength(2);
    expect(findDevices).not.toHaveBeenCalled();
  });
});

describe("a vendor's line", () => {
  test("gets the vendor's fields and the event it is, with the line itself untouched", async () => {
    const line: string =
      "<187>Oct 13 10:11:09 edge-sw9 45: %LINK-3-UPDOWN: Interface GigabitEthernet0/1, changed state to down";

    await ingest([line]);

    const row: JSONObject = onlyRow();
    const attributes: Record<string, unknown> = attributesOf(row);

    expect(row["body"]).toBe(
      "%LINK-3-UPDOWN: Interface GigabitEthernet0/1, changed state to down",
    );
    expect(attributes["syslog.raw"]).toBe(line);
    expect(attributes).toMatchObject({
      "syslog.vendor": "Cisco",
      "syslog.parser": "cisco",
      "cisco.facility": "LINK",
      "cisco.mnemonic": "UPDOWN",
      "event.domain": "network",
      "event.name": "interface.down",
      "network.interface.name": "GigabitEthernet0/1",
    });
    // No device of the project is called edge-sw9: it is nobody's log.
    expect(Object.keys(attributes)).not.toContain("networkDevice.id");
    expect(Object.keys(attributes)).not.toContain("networkDevice.name");
    expect(Object.keys(attributes)).not.toContain("syslog.matchedBy");
  });

  /*
   * Every sample line of every parser, posted here: the parser that reads
   * it for a probe reads it for this endpoint too. (A format with no mark
   * of its own needs its device's maker, which only a device gives: those
   * samples are read in the suite of the device lookup below.)
   */
  const selfDescribing: Array<SyslogVendorSample> =
    ALL_SYSLOG_VENDOR_SAMPLES.filter((sample: SyslogVendorSample): boolean => {
      return !sample.deviceVendor;
    });

  test("the sample lines that describe themselves are most of the corpus", () => {
    expect(selfDescribing.length).toBeGreaterThan(150);
  });

  test.each(
    selfDescribing.map(
      (sample: SyslogVendorSample): [string, SyslogVendorSample] => {
        return [sample.name, sample];
      },
    ),
  )("%s", async (_name: string, sample: SyslogVendorSample) => {
    // No devices: nothing can be matched, so only the parsers speak.
    projectDevices = [];

    const attributes: Record<string, unknown> = await attributesOfLine(
      sample.line,
    );

    expect(attributes["syslog.parser"]).toBe(
      sample.expect.parserId === null ? undefined : sample.expect.parserId,
    );
    expect(attributes["event.name"]).toBe(
      sample.expect.eventName === null ? undefined : sample.expect.eventName,
    );

    // A network vendor's event is a network event wherever it came from.
    expect(attributes["event.domain"]).toBe(
      sample.expect.eventName === null ||
        sample.expect.parserId === SyslogParserId.Linux
        ? undefined
        : "network",
    );

    if (sample.expect.attributes) {
      const expected: Record<string, unknown> = {
        ...sample.expect.attributes,
      };

      delete expected["event.domain"];

      expect(attributes).toMatchObject(expected);
    }

    for (const key of sample.expect.absent || []) {
      expect(Object.keys(attributes)).not.toContain(key);
    }
  });
});

describe("a message that names a network device of the project", () => {
  test("by the host name in its header: it is that device's log, and says how it was matched", async () => {
    const attributes: Record<string, unknown> = await attributesOfLine(
      "<187>Oct 13 10:11:09 core-sw1 45: %LINK-3-UPDOWN: Interface GigabitEthernet0/1, changed state to down",
    );

    expect(attributes["networkDevice.id"]).toBe(SWITCH.toString());
    expect(attributes["networkDevice.name"]).toBe("Core Switch");
    expect(attributes["syslog.matchedBy"]).toBe("hostname");
    expect(attributes["event.name"]).toBe("interface.down");
  });

  test("by the device's own name, whatever its case", async () => {
    const attributes: Record<string, unknown> = await attributesOfLine(
      "<134>Oct 13 10:11:09 CORE-SW1 dhcpd: DHCPACK on 10.0.0.77",
    );

    expect(attributes["networkDevice.id"]).toBe(SWITCH.toString());
  });

  test("by the MAC address a controller gives for the device it manages", async () => {
    const attributes: Record<string, unknown> = await attributesOfLine(
      "<12>Oct 13 10:11:09 udm-pro CEF:0|Ubiquiti|UniFi Network|9.3.33|3|Device Offline|5|UNIFIdeviceName=Somewhere Else UNIFIdeviceMac=D8-B3-70-FB-FC-DD msg=An AP went offline.",
    );

    expect(attributes["networkDevice.id"]).toBe(ACCESS_POINT.toString());
    expect(attributes["networkDevice.name"]).toBe("Lobby AP");
    expect(attributes["syslog.matchedBy"]).toBe("mac-address");
    expect(attributes["event.name"]).toBe("device.offline");
  });

  test("a name two devices share names neither: the log is nobody's", async () => {
    projectDevices.push(
      device({
        id: ObjectID.generate(),
        name: "Second Core",
        hostname: "10.0.0.3",
        sysName: "core-sw1",
      }),
    );

    const attributes: Record<string, unknown> = await attributesOfLine(
      "<187>Oct 13 10:11:09 core-sw1 45: %LINK-3-UPDOWN: Interface GigabitEthernet0/1, changed state to down",
    );

    expect(Object.keys(attributes)).not.toContain("networkDevice.id");
    // It is still read.
    expect(attributes["event.name"]).toBe("interface.down");
  });

  test("a format with no mark of its own is read with its maker's parser once its device is known", async () => {
    const attributes: Record<string, unknown> = await attributesOfLine(
      "<27>Oct  2 17:36:35 branch-rtr-01 login failure for user guest from 192.168.88.17 via ssh",
    );

    expect(attributes["networkDevice.id"]).toBe(ROUTER.toString());
    expect(attributes["syslog.vendor"]).toBe("MikroTik");
    expect(attributes["event.name"]).toBe("auth.login_failed");
    expect(attributes["event.domain"]).toBe("network");
    expect(attributes["user.name"]).toBe("guest");
  });

  test("...and is left alone when the host it names is no device", async () => {
    const attributes: Record<string, unknown> = await attributesOfLine(
      "<27>Oct  2 17:36:35 some-server login failure for user guest from 192.168.88.17 via ssh",
    );

    expect(Object.keys(attributes)).not.toContain("syslog.vendor");
    expect(Object.keys(attributes)).not.toContain("event.name");
  });

  test("the project's devices are read once for a batch, not once a message", async () => {
    const batch: Array<string> = [];

    for (let index: number = 0; index < 60; index++) {
      batch.push(
        `<187>Oct 13 10:11:09 core-sw1 ${index}: %LINK-3-UPDOWN: Interface GigabitEthernet0/${index}, changed state to down`,
      );
    }

    await ingest(batch);

    expect(submittedRows).toHaveLength(60);
    expect(findDevices).toHaveBeenCalledTimes(1);

    for (const row of submittedRows) {
      expect(attributesOf(row)["networkDevice.id"]).toBe(SWITCH.toString());
    }
  });

  test("a lookup that fails loses no message: it is stored without a device", async () => {
    findDevices.mockRejectedValue(new Error("database is down") as never);

    const attributes: Record<string, unknown> = await attributesOfLine(
      "<187>Oct 13 10:11:09 core-sw1 45: %LINK-3-UPDOWN: Interface GigabitEthernet0/1, changed state to down",
    );

    expect(Object.keys(attributes)).not.toContain("networkDevice.id");
    expect(attributes["event.name"]).toBe("interface.down");
  });

  test("the telemetry service stays the one this endpoint always chose: the header's, the tag's, the host's", async () => {
    await ingest(
      [
        "<187>Oct 13 10:11:09 core-sw1 45: %LINK-3-UPDOWN: Interface GigabitEthernet0/1, changed state to down",
      ],
      { "x-oneuptime-service-name": "campus-network" },
    );

    const attributes: Record<string, unknown> = attributesOf(onlyRow());

    expect(attributes["oneuptime.service.name"]).toBe("campus-network");
    expect(attributes["networkDevice.id"]).toBe(SWITCH.toString());
  });
});

describe("which device an event is about, in words", () => {
  const LINK_DOWN_FROM: (host: string) => string = (host: string): string => {
    return `<187>Oct 13 10:11:09 ${host} 45: %LINK-3-UPDOWN: Interface GigabitEthernet0/1, changed state to down`;
  };

  test("is the device's name in OneUptime, when the message names one", async () => {
    const attributes: Record<string, unknown> = await attributesOfLine(
      LINK_DOWN_FROM("core-sw1"),
    );

    expect(attributes["event.device"]).toBe("Core Switch");
    expect(attributes["event.kind"]).toBe("problem");
    expect(attributes["event.category"]).toBe("interface");
  });

  test("else the name the sender gives itself", async () => {
    expect(
      (await attributesOfLine(LINK_DOWN_FROM("edge-sw9")))["event.device"],
    ).toBe("edge-sw9");
  });

  test("and is left out when the line names nobody: there is no address to fall back to here", async () => {
    const attributes: Record<string, unknown> = await attributesOfLine(
      "<187>%LINK-3-UPDOWN: Interface GigabitEthernet0/1, changed state to down",
    );

    expect(attributes["event.name"]).toBe("interface.down");
    expect(Object.keys(attributes)).not.toContain("event.device");
  });

  test("a log that is no network event says nothing of it", async () => {
    for (const line of [
      "<134>Oct 13 10:11:09 web-01 nginx: GET /health 200",
      // An event's name, without being a network event.
      "<38>Oct 13 10:11:09 web-01 sshd[4321]: Failed password for root from 192.0.2.10 port 51234 ssh2",
    ]) {
      expect(Object.keys(await attributesOfLine(line))).not.toContain(
        "event.device",
      );
    }
  });
});

describe("a line a server writes as well as an access point", () => {
  const SSHD_FAILED: string =
    "sshd[4321]: Failed password for root from 192.0.2.10 port 51234 ssh2";

  test("from a host that is no network device: it keeps its fields and the event's name, and is not a network event", async () => {
    const attributes: Record<string, unknown> = await attributesOfLine(
      `<38>Oct 13 10:11:09 web-01 ${SSHD_FAILED}`,
    );

    expect(attributes["syslog.parser"]).toBe("linux");
    expect(attributes["event.name"]).toBe("auth.login_failed");
    expect(attributes["user.name"]).toBe("root");
    expect(attributes["client.address"]).toBe("192.0.2.10");
    expect(Object.keys(attributes)).not.toContain("event.domain");
    expect(Object.keys(attributes)).not.toContain("networkDevice.id");
  });

  test("from a network device: it is a network event of that device", async () => {
    const attributes: Record<string, unknown> = await attributesOfLine(
      `<38>Oct 13 10:11:09 ap-lobby ${SSHD_FAILED}`,
    );

    expect(attributes["networkDevice.id"]).toBe(ACCESS_POINT.toString());
    expect(attributes["event.name"]).toBe("auth.login_failed");
    expect(attributes["event.domain"]).toBe("network");
  });
});

describe("a line without a priority", () => {
  test("takes the severity its vendor's format states", async () => {
    await ingest([
      "system,error,critical login failure for user guest from 192.168.88.17 via ssh",
    ]);

    const row: JSONObject = onlyRow();

    expect(row["severityText"]).toBe(LogSeverity.Error);
    expect(row["severityNumber"]).toBe(19);
    // Nothing is invented about a priority the line never had.
    expect(Object.keys(attributesOf(row))).not.toContain(
      "syslog.severity.code",
    );
    expect(Object.keys(attributesOf(row))).not.toContain("syslog.priority");
    expect(attributesOf(row)["event.name"]).toBe("auth.login_failed");
  });

  test("with nothing to say about its severity stays unspecified, as before", async () => {
    await ingest(["the fan sounds odd"]);

    expect(onlyRow()["severityText"]).toBe(LogSeverity.Unspecified);
    expect(onlyRow()["severityNumber"]).toBe(0);
  });

  test("a line WITH a priority keeps it, whatever its vendor's format says", async () => {
    await ingest([
      "<190>%LINK-3-UPDOWN: Interface GigabitEthernet0/1, changed state to down",
    ]);

    expect(onlyRow()["severityText"]).toBe(LogSeverity.Information);
  });
});

describe("nothing a line says can make it a device's log", () => {
  test("pairs named like what ingest sets land under the vendor's prefix", async () => {
    const attributes: Record<string, unknown> = await attributesOfLine(
      `<30>log_type="Event" log_component="IPSec" log_subtype="System" status="Terminated" networkDevice.id="${SWITCH.toString()}" networkDevice.name="Core Switch" syslog.matchedBy="hostname" syslog.raw="forged" oneuptime.service.name="forged"`,
    );

    expect(Object.keys(attributes)).not.toContain("networkDevice.id");
    expect(Object.keys(attributes)).not.toContain("networkDevice.name");
    expect(Object.keys(attributes)).not.toContain("syslog.matchedBy");
    expect(attributes["oneuptime.service.name"]).toBe("Syslog");
    expect(String(attributes["syslog.raw"])).toContain("log_component");
    expect(attributes["sophos.networkDevice.id"]).toBe(SWITCH.toString());
  });
});

describe("an event a project names in a pipeline", () => {
  function categoryPipeline(): Array<LoadedPipeline> {
    return [
      {
        pipeline: { name: "ups" },
        compiledFilter: compileFilter(""),
        processors: [
          {
            name: "name the event",
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
        ],
      },
    ] as unknown as Array<LoadedPipeline>;
  }

  test("is a network event on the log of a network device", async () => {
    loadPipelines.mockResolvedValue(categoryPipeline() as never);

    const row: JSONObject = await (async (): Promise<JSONObject> => {
      await ingest([
        "<132>Oct 13 10:11:09 core-sw1 upsd: UPS rack-1 is on battery",
      ]);

      return onlyRow();
    })();

    expect(attributesOf(row)["event.name"]).toBe("ups.on_battery");
    expect(attributesOf(row)["event.domain"]).toBe("network");
    expect((row["attributeKeys"] as Array<string>).slice().sort()).toEqual(
      Object.keys(attributesOf(row)).sort(),
    );
  });

  test("on any other host's log it is left as the pipeline wrote it: other products file things under the same key", async () => {
    loadPipelines.mockResolvedValue(categoryPipeline() as never);

    const attributes: Record<string, unknown> = await attributesOfLine(
      "<132>Oct 13 10:11:09 web-01 upsd: UPS rack-1 is on battery",
    );

    expect(attributes["event.name"]).toBe("ups.on_battery");
    expect(Object.keys(attributes)).not.toContain("event.domain");
  });
});
