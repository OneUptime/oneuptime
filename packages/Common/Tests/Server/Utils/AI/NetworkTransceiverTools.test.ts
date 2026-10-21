/*
 * Toolbox/Index MUST be imported before any individual tool module: the
 * toolbox sits in an import cycle (tool -> service -> ... -> AIToolbox), and
 * production always enters through Index.
 */
import AIToolbox from "../../../../Server/Utils/AI/Toolbox/Index";
import { QueryNetworkTransceiversTool } from "../../../../Server/Utils/AI/Toolbox/TransceiverTools";
import {
  ObservabilityTool,
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import NetworkTransceiverContext, {
  MAX_TRANSCEIVERS_IN_CONTEXT,
} from "../../../../Server/Utils/AI/SRE/NetworkTransceiverContext";
import MonitorService from "../../../../Server/Services/MonitorService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import { AIResourceType } from "../../../../Types/AI/AIResourceContext";
import { JSONObject } from "../../../../Types/JSON";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import {
  NetworkDeviceTransceiver,
  TransceiverHealth,
  TransceiverMibSource,
  TransceiverThresholds,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpTransceiver";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * What OneUptime AI learns about a network device's optics - the evidence
 * the customer asked for: "the transceiver is suddenly no longer detected",
 * "the RX optical power has slowly been decreasing over the past few
 * weeks". The investigation context and the query_network_transceivers
 * tool word it all through TransceiverHealthUtil, so the AI says what the
 * device page and the alerts say.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const DEVICE_ID: string = "22222222-2222-4222-8222-222222222222";

const LR_RX: TransceiverThresholds = {
  lowAlarm: -18.4,
  lowWarning: -14.4,
  highWarning: 0.5,
  highAlarm: 2.5,
};

const ctx: ToolContext = {
  projectId: PROJECT_ID,
  props: { isRoot: true },
};

// An optic whose received power slid from -3.8 to -6.3 dBm over 25 days.
const FADING: NetworkDeviceTransceiver = {
  interfaceIndex: 49,
  interfaceName: "Te1/1/1",
  interfaceAlias: "Uplink to core",
  isPresent: true,
  vendor: "FLEXOPTIX",
  partNumber: "P.1396.10",
  serialNumber: "F7A2B91",
  type: "SFP+ 10GBASE-LR",
  wavelengthNm: 1310,
  source: TransceiverMibSource.CiscoEntitySensor,
  measurements: {
    rxPower: { readings: [{ value: -6.3 }], thresholds: LR_RX },
    temperature: { readings: [{ value: 38.5 }] },
  },
  health: TransceiverHealth.Healthy,
  firstSeenAt: "2026-08-01T00:00:00.000Z",
  lastSeenAt: "2026-10-09T10:00:00.000Z",
  rxPowerHistory: {
    firstDay: "2026-09-14",
    dailyAverageDbm: Array.from({ length: 26 }, (_v: unknown, i: number) => {
      return Math.round((-3.8 - i * 0.1) * 100) / 100;
    }),
    lastDaySamples: 40,
  },
};

const PULLED: NetworkDeviceTransceiver = {
  interfaceIndex: 50,
  interfaceName: "Te1/1/2",
  isPresent: false,
  vendor: "FS",
  partNumber: "SFP-10GSR-85",
  serialNumber: "C2203041",
  measurements: {},
  health: TransceiverHealth.NotDetected,
  missingSince: "2026-10-09T09:40:00.000Z",
  missingPolls: 4,
  lastSeenAt: "2026-10-09T09:35:00.000Z",
};

function healthyOptic(index: number): NetworkDeviceTransceiver {
  return {
    interfaceIndex: 100 + index,
    interfaceName: `Gi1/0/${index}`,
    isPresent: true,
    measurements: { rxPower: { readings: [{ value: -5 }], thresholds: LR_RX } },
    health: TransceiverHealth.Healthy,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("NetworkTransceiverContext.toRow", () => {
  test("a fading optic: who it is, its readings against the thresholds, and a month of received power", () => {
    const row: JSONObject = NetworkTransceiverContext.toRow(FADING);

    expect(row).toMatchObject({
      port: "Te1/1/1",
      portAlias: "Uplink to core",
      health: TransceiverHealth.Healthy,
      detected: true,
      optic: "FLEXOPTIX P.1396.10, serial F7A2B91",
      type: "SFP+ 10GBASE-LR",
      wavelengthNm: 1310,
      readFrom: TransceiverMibSource.CiscoEntitySensor,
      firstSeenAt: "2026-08-01T00:00:00.000Z",
      rxPowerBestDayDbm: -3.8,
      rxPowerBestDay: "2026-09-14",
      rxPowerDropFromBestDayDb: 2.5,
    });
    expect(row["readings"]).toEqual([
      "RX Power -6.30 dBm - device thresholds: low alarm -18.40 dBm, low warning -14.40 dBm, high warning 0.50 dBm, high alarm 2.50 dBm",
      "Temperature 38.5 °C - the device reports no thresholds",
    ]);

    const days: Array<string> = row["rxPowerDailyAverageDbm"] as Array<string>;
    expect(days).toHaveLength(26);
    expect(days[0]).toBe("2026-09-14 -3.80");
    expect(days[25]).toBe("2026-10-09 -6.30");
    expect(row["issues"]).toBeUndefined();
  });

  test("a pulled optic: since when, for how many polls, what it was", () => {
    const row: JSONObject = NetworkTransceiverContext.toRow(PULLED);

    expect(row).toMatchObject({
      port: "Te1/1/2",
      health: TransceiverHealth.NotDetected,
      detected: false,
      optic: "FS SFP-10GSR-85, serial C2203041",
      missingSince: "2026-10-09T09:40:00.000Z",
      missingForPolls: 4,
      lastSeenAt: "2026-10-09T09:35:00.000Z",
      issues: ["Not detected since 2026-10-09T09:40:00.000Z"],
    });
    expect(row["readings"]).toBeUndefined();
    expect(row["firstSeenAt"]).toBeUndefined();
  });

  test("a port with no name is named by its index; lanes are named", () => {
    const row: JSONObject = NetworkTransceiverContext.toRow({
      interfaceIndex: 7,
      isPresent: true,
      measurements: {
        rxPower: {
          readings: [
            { value: -2.1, lane: 1 },
            { value: -19.6, lane: 2 },
          ],
          thresholds: LR_RX,
        },
      },
      health: TransceiverHealth.Alarm,
    });

    expect(row["port"]).toBe("ifIndex 7");
    expect(row["readings"]).toEqual([
      "RX Power -2.10 dBm (lane 1), -19.60 dBm (lane 2) - device thresholds: low alarm -18.40 dBm, low warning -14.40 dBm, high warning 0.50 dBm, high alarm 2.50 dBm",
    ]);
    expect(row["issues"]).toEqual([
      "RX Power -19.60 dBm on lane 2 is below the low alarm threshold of -18.40 dBm",
    ]);
  });
});

describe("NetworkTransceiverContext.pickRelevant", () => {
  const many: Array<NetworkDeviceTransceiver> = [
    ...Array.from({ length: 20 }, (_v: unknown, i: number) => {
      return healthyOptic(i + 1);
    }),
    FADING,
    PULLED,
  ];

  test("the port the alert is about comes first, then problems, then the rest", () => {
    const picked: Array<NetworkDeviceTransceiver> =
      NetworkTransceiverContext.pickRelevant({
        transceivers: many,
        seriesLabels: { interfaceName: "Te1/1/1" },
      });

    expect(picked).toHaveLength(MAX_TRANSCEIVERS_IN_CONTEXT);
    expect(picked[0]!.interfaceName).toBe("Te1/1/1");
    expect(picked[1]!.interfaceName).toBe("Te1/1/2");
  });

  test("a port named in the alert's text is the focus too, by name or alias", () => {
    expect(
      NetworkTransceiverContext.pickRelevant({
        transceivers: many,
        focusText:
          "Interface Gi1/0/17 is down on core-switch-1 (since 10:02 UTC)",
      })[0]!.interfaceName,
    ).toBe("Gi1/0/17");
    expect(
      NetworkTransceiverContext.pickRelevant({
        transceivers: many,
        focusText: "Packet loss on the UPLINK TO CORE",
      })[0]!.interfaceName,
    ).toBe("Te1/1/1");
  });

  test("a port is named as a whole word, never as the start of a longer one", () => {
    const text: string = "interface gi1/0/17 is down; te1/1/1/2 flapped";

    expect(NetworkTransceiverContext.mentionsPort(text, "gi1/0/17")).toBe(true);
    expect(NetworkTransceiverContext.mentionsPort(text, "gi1/0/1")).toBe(false);
    expect(NetworkTransceiverContext.mentionsPort(text, "te1/1/1")).toBe(false);
    expect(
      NetworkTransceiverContext.mentionsPort("down: et49/1.", "et49/1"),
    ).toBe(true);
    expect(
      NetworkTransceiverContext.mentionsPort("(gi1/0/1) is down", "gi1/0/1"),
    ).toBe(true);
    expect(NetworkTransceiverContext.mentionsPort("xgi1/0/1", "gi1/0/1")).toBe(
      false,
    );
  });

  test("without a focus, problems lead", () => {
    expect(
      NetworkTransceiverContext.pickRelevant({ transceivers: many })[0]!
        .interfaceName,
    ).toBe("Te1/1/2");
  });
});

describe("NetworkTransceiverContext.renderSection", () => {
  test("a summary per device, a row per optic, and how to read the rest", () => {
    const section: string = NetworkTransceiverContext.renderSection({
      devices: [
        {
          name: "core-switch-1",
          transceivers: [
            ...Array.from({ length: 14 }, (_v: unknown, i: number) => {
              return healthyOptic(i + 1);
            }),
            FADING,
            PULLED,
          ],
        },
      ],
    });

    expect(section).toContain(
      "## Transceivers (SFP, SFP+, QSFP optics) of the affected network device",
    );
    expect(section).toContain("### core-switch-1");
    expect(section).toContain(
      "16 transceiver(s): 1 not detected, 0 past an alarm threshold, 0 past a warning threshold, 15 healthy.",
    );
    expect(section).toContain('"port":"Te1/1/2"');
    expect(section).toContain('"rxPowerDropFromBestDayDb":2.5');
    expect(section).toContain(
      `- ${16 - MAX_TRANSCEIVERS_IN_CONTEXT} more transceiver(s) not listed; read them with query_network_transceivers.`,
    );
  });

  test("nothing to say, nothing said", () => {
    expect(
      NetworkTransceiverContext.renderSection({
        devices: [{ name: "access-1", transceivers: [] }],
      }),
    ).toBe("");
    expect(NetworkTransceiverContext.renderSection({ devices: [] })).toBe("");
  });

  test("the summary counts optics without thresholds and in disabled ports", () => {
    const section: string = NetworkTransceiverContext.renderSection({
      devices: [
        {
          transceivers: [
            { ...healthyOptic(1), health: TransceiverHealth.NotJudged },
            { ...healthyOptic(2), health: TransceiverHealth.PortDisabled },
          ],
        },
      ],
    });

    expect(section).toContain("### Network device");
    expect(section).toContain(
      "2 transceiver(s): 0 not detected, 0 past an alarm threshold, 0 past a warning threshold, 0 healthy, 1 without thresholds to judge by, 1 in disabled ports.",
    );
  });
});

describe("NetworkTransceiverContext.buildContextSection", () => {
  function deviceMonitor(networkDeviceId: string | undefined): Monitor {
    const step: MonitorStep = new MonitorStep();
    step.data = {
      ...step.data,
      networkDeviceMonitor:
        networkDeviceId === undefined
          ? undefined
          : {
              networkDeviceId: networkDeviceId,
              monitorInterfaces: true,
              oids: [],
            },
    } as MonitorStep["data"];

    const steps: MonitorSteps = new MonitorSteps();
    steps.data = {
      monitorStepsInstanceArray: [step],
      defaultMonitorStatusId: undefined,
    };

    const monitor: Monitor = new Monitor();
    monitor.id = ObjectID.generate();
    monitor.monitorSteps = steps;
    return monitor;
  }

  function storedDevice(
    snapshot: Array<NetworkDeviceTransceiver> | undefined,
  ): NetworkDevice {
    const device: NetworkDevice = new NetworkDevice();
    device.id = new ObjectID(DEVICE_ID);
    device.name = "core-switch-1";
    if (snapshot) {
      device.transceiverSnapshot = snapshot;
    }
    return device;
  }

  test("an alert from a Network Device monitor gets its device's optics", async () => {
    const monitorFind: jest.SpyInstance = jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([deviceMonitor(DEVICE_ID)]);
    const deviceFind: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockResolvedValue([storedDevice([FADING, PULLED])]);
    const monitorId: ObjectID = ObjectID.generate();

    const section: string = await NetworkTransceiverContext.buildContextSection(
      {
        projectId: PROJECT_ID,
        monitorIds: [monitorId],
        focusText: "Transceiver no longer detected in Te1/1/2",
      },
    );

    expect(section).toContain("### core-switch-1");
    expect(section).toContain('"detected":false');

    // Both reads are pinned to the project, and only Network Device monitors count.
    const monitorQuery: JSONObject = monitorFind.mock.calls[0]![0]
      .query as JSONObject;
    expect(monitorQuery["projectId"]).toBe(PROJECT_ID);
    expect(monitorQuery["monitorType"]).toBe(MonitorType.NetworkDevice);

    const deviceQuery: JSONObject = deviceFind.mock.calls[0]![0]
      .query as JSONObject;
    expect(deviceQuery["projectId"]).toBe(PROJECT_ID);
    expect(
      (deviceFind.mock.calls[0]![0].select as JSONObject)[
        "transceiverSnapshot"
      ],
    ).toBe(true);
  });

  test("no monitors, no queries", async () => {
    const monitorFind: jest.SpyInstance = jest.spyOn(MonitorService, "findBy");

    await expect(
      NetworkTransceiverContext.buildContextSection({
        projectId: PROJECT_ID,
        monitorIds: [],
      }),
    ).resolves.toBe("");
    expect(monitorFind).not.toHaveBeenCalled();
  });

  test("a monitor that watches no device, or a device with no optics, adds nothing", async () => {
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([deviceMonitor(undefined)]);
    const deviceFind: jest.SpyInstance = jest.spyOn(
      NetworkDeviceService,
      "findBy",
    );

    await expect(
      NetworkTransceiverContext.buildContextSection({
        projectId: PROJECT_ID,
        monitorIds: [ObjectID.generate()],
      }),
    ).resolves.toBe("");
    expect(deviceFind).not.toHaveBeenCalled();

    jest.restoreAllMocks();
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([deviceMonitor(DEVICE_ID)]);
    jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockResolvedValue([storedDevice(undefined)]);

    await expect(
      NetworkTransceiverContext.buildContextSection({
        projectId: PROJECT_ID,
        monitorIds: [ObjectID.generate()],
      }),
    ).resolves.toBe("");
  });
});

describe("query_network_transceivers", () => {
  function mockDevice(device: NetworkDevice | null): jest.SpyInstance {
    return jest
      .spyOn(NetworkDeviceService, "findOneBy")
      .mockResolvedValue(device);
  }

  function deviceWith(
    snapshot: Array<NetworkDeviceTransceiver> | undefined,
  ): NetworkDevice {
    const device: NetworkDevice = new NetworkDevice();
    device.id = new ObjectID(DEVICE_ID);
    device.name = "core-switch-1";
    if (snapshot) {
      device.transceiverSnapshot = snapshot;
    }
    return device;
  }

  test("is offered by the toolbox, read-only, with a device id it requires", () => {
    const tool: ObservabilityTool | undefined = AIToolbox.getTools().find(
      (candidate: ObservabilityTool) => {
        return candidate.name === "query_network_transceivers";
      },
    );

    expect(tool).toBe(QueryNetworkTransceiversTool);
    expect(tool!.inputSchema["required"]).toEqual(["networkDeviceId"]);
    expect(tool!.requiredPermissions).toEqual(
      new NetworkDevice().getReadPermissions(),
    );
    expect(tool!.isMutation).toBeFalsy();
  });

  test("lists every optic, problems first, citing the device", async () => {
    const find: jest.SpyInstance = mockDevice(
      deviceWith([healthyOptic(1), FADING, PULLED]),
    );

    const result: ToolExecutionResult =
      await QueryNetworkTransceiversTool.execute(
        { networkDeviceId: DEVICE_ID },
        ctx,
      );

    expect(result.rowCount).toBe(3);
    const lines: Array<string> = result.dataForLlm.split("\n");
    expect(lines[0]).toContain("port=Te1/1/2");
    expect(lines[0]).toContain("health=notDetected");
    expect(result.dataForLlm).toContain("rxPowerDropFromBestDayDb=2.5");
    expect(result.dataForLlm).toContain(
      "Readings are from the device's last poll",
    );
    expect(result.citationLabel).toBe("core-switch-1 transceivers");
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.TelemetryResourceView,
      params: {
        resourceType: AIResourceType.NetworkDevice,
        resourceId: DEVICE_ID,
      },
    });

    // The id is an untrusted model argument: the read is pinned to the tenant.
    const query: JSONObject = find.mock.calls[0]![0].query as JSONObject;
    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["_id"]).toBe(DEVICE_ID);
  });

  test("narrows to one port by name or alias, or to problems only", async () => {
    mockDevice(deviceWith([healthyOptic(1), FADING, PULLED]));

    const byAlias: ToolExecutionResult =
      await QueryNetworkTransceiversTool.execute(
        { networkDeviceId: DEVICE_ID, interfaceName: "uplink to core" },
        ctx,
      );
    expect(byAlias.rowCount).toBe(1);
    expect(byAlias.dataForLlm).toContain("port=Te1/1/1");

    const problems: ToolExecutionResult =
      await QueryNetworkTransceiversTool.execute(
        { networkDeviceId: DEVICE_ID, problemsOnly: true },
        ctx,
      );
    expect(problems.rowCount).toBe(1);
    expect(problems.dataForLlm).toContain("port=Te1/1/2");

    const none: ToolExecutionResult =
      await QueryNetworkTransceiversTool.execute(
        { networkDeviceId: DEVICE_ID, interfaceName: "Gi9/9/9" },
        ctx,
      );
    expect(none.rowCount).toBe(0);
    expect(none.dataForLlm).toContain("No transceiver matches the filters.");
  });

  test("a device that reports no optics says why there may be none", async () => {
    mockDevice(deviceWith(undefined));

    const result: ToolExecutionResult =
      await QueryNetworkTransceiversTool.execute(
        { networkDeviceId: DEVICE_ID },
        ctx,
      );

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toContain("This device reports no transceivers");
    expect(result.dataForLlm).toContain("ENTITY-SENSOR-MIB");
  });

  test("refuses an id that is not a UUID, and a device it cannot see", async () => {
    const find: jest.SpyInstance = mockDevice(null);

    await expect(
      QueryNetworkTransceiversTool.execute(
        { networkDeviceId: "core-switch-1" },
        ctx,
      ),
    ).rejects.toThrow("networkDeviceId must be a valid OneUptime UUID");
    expect(find).not.toHaveBeenCalled();

    await expect(
      QueryNetworkTransceiversTool.execute({ networkDeviceId: DEVICE_ID }, ctx),
    ).rejects.toThrow("Network device not found");
  });
});
