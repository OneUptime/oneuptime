import Includes from "../../../Types/BaseDatabase/Includes";
import {
  getManagedDeviceSeriesNames,
  getManagedDeviceSeriesQuery,
  getMonitorConnectionReads,
  getMonitorManagedDeviceConnectionIds,
  mayMonitorAlertOnManagedDevice,
} from "../../../Types/DeviceManagement/ManagedDeviceAlertScope";
import {
  ManagedDeviceCheckInDevice,
  ManagedDeviceCheckInReading,
  getManagedDeviceCheckInReadings,
} from "../../../Types/DeviceManagement/ManagedDeviceCheckIn";
import {
  ManagedDeviceAlertTemplate,
  getManagedDeviceAlertTemplatesFor,
} from "../../../Types/Monitor/ManagedDeviceAlertTemplates";
import DeviceManagementProvider, {
  DEVICE_MANAGEMENT_PROVIDERS,
} from "../../../Types/DeviceManagement/DeviceManagementProvider";
import { ManagedDevicePlatform } from "../../../Types/DeviceManagement/ManagedDevicePlatform";
import { JSONObject } from "../../../Types/JSON";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * Which alerts are about one managed device (#10007): the ones whose series
 * names a name the device's readings carry, raised by a monitor of its own
 * connection, or of no connection in particular - never another
 * connection's, though one of its devices may share the name.
 */

const AS_OF: Date = new Date("2026-11-19T12:00:00.000Z");
const CONNECTION: string = "55555555-5555-4555-8555-555555555555";
const OTHER_CONNECTION: string = "66666666-6666-4666-8666-666666666666";

function stepsOf(steps: Array<MonitorStep>): MonitorSteps {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: steps,
    defaultMonitorStatusId: ObjectID.generate(),
  };
  return monitorSteps;
}

function templateSteps(
  provider: DeviceManagementProvider,
  connectionId: string,
): Array<MonitorStep> {
  return getManagedDeviceAlertTemplatesFor(provider).map(
    (template: ManagedDeviceAlertTemplate): MonitorStep => {
      return template.getMonitorStep({
        deviceManagementConnectionId: connectionId,
        onlineMonitorStatusId: ObjectID.generate(),
        offlineMonitorStatusId: ObjectID.generate(),
        defaultIncidentSeverityId: ObjectID.generate(),
        defaultAlertSeverityId: ObjectID.generate(),
        monitorName: template.name,
      });
    },
  );
}

describe("getManagedDeviceSeriesNames", () => {
  test("a device's own name, and its name told apart by its serial number", () => {
    expect(
      getManagedDeviceSeriesNames({
        deviceName: "iPhone",
        serialNumber: "F2LXK1ABCD",
        providerDeviceId: "0f7c8c6b",
      }),
    ).toEqual(["iPhone", "iPhone (F2LXK1ABCD)"]);
  });

  test("by the service's ID when it has no serial number to tell it apart by", () => {
    expect(
      getManagedDeviceSeriesNames({
        deviceName: "Kiosk",
        serialNumber: "unknown",
        providerDeviceId: "35-8C4F2A9B1D7E",
      }),
    ).toEqual(["Kiosk", "Kiosk (35-8C4F2A9B1D7E)"]);
  });

  test("a device named by its serial number has that name alone, and one with none has none", () => {
    expect(
      getManagedDeviceSeriesNames({
        deviceName: "",
        serialNumber: "R9KT30ABC12",
        providerDeviceId: "x",
      }),
    ).toEqual(["R9KT30ABC12"]);
    expect(getManagedDeviceSeriesNames({})).toEqual([]);
  });

  test("are the very names a read's readings carry the device by, shared or not", () => {
    const twin: (serial: string) => ManagedDeviceCheckInDevice = (
      serial: string,
    ): ManagedDeviceCheckInDevice => {
      return {
        providerDeviceId: `id-${serial}`,
        deviceName: "iPhone",
        serialNumber: serial,
        platform: ManagedDevicePlatform.IOS,
        lastCheckInAt: new Date(AS_OF.getTime() - 60 * 1000),
      };
    };

    // Alone in its connection, then with a twin: both names are among its own.
    for (const devices of [
      [twin("F2LXK1AAAA")],
      [twin("F2LXK1AAAA"), twin("F2LXK1BBBB")],
    ]) {
      const readings: Array<ManagedDeviceCheckInReading> =
        getManagedDeviceCheckInReadings({
          devices,
          hostNames: new Set<string>(),
          asOf: AS_OF,
          provider: "intune",
        });

      expect(getManagedDeviceSeriesNames(devices[0]!)).toContain(
        readings[0]!.deviceName,
      );
    }
  });
});

describe("which monitors may alert on a device", () => {
  test.each(DEVICE_MANAGEMENT_PROVIDERS)(
    "every %s template reads its own connection, and is the device's",
    (provider: DeviceManagementProvider) => {
      const steps: MonitorSteps = stepsOf(templateSteps(provider, CONNECTION));

      expect(getMonitorManagedDeviceConnectionIds(steps)).toEqual([CONNECTION]);
      expect(
        mayMonitorAlertOnManagedDevice({
          monitorSteps: steps,
          connectionId: CONNECTION,
        }),
      ).toBe(true);
      expect(
        mayMonitorAlertOnManagedDevice({
          monitorSteps: steps,
          connectionId: OTHER_CONNECTION,
        }),
      ).toBe(false);
    },
  );

  test("a monitor of no connection in particular may be about any device", () => {
    const step: MonitorStep = templateSteps(
      DeviceManagementProvider.Esper,
      CONNECTION,
    )[1]!;
    const attributes: Record<string, unknown> = step.data!.metricMonitor!
      .metricViewConfig.queryConfigs[0]!.metricQueryData.filterData
      .attributes as Record<string, unknown>;
    delete attributes["oneuptime.managed_device.connection.id"];

    expect(
      mayMonitorAlertOnManagedDevice({
        monitorSteps: stepsOf([step]),
        connectionId: OTHER_CONNECTION,
      }),
    ).toBe(true);
    expect(
      mayMonitorAlertOnManagedDevice({
        monitorSteps: undefined,
        connectionId: CONNECTION,
      }),
    ).toBe(true);
  });

  test("a monitor written for a list of connections reads each, however it was stored", () => {
    const step: MonitorStep = templateSteps(
      DeviceManagementProvider.Soti,
      CONNECTION,
    )[1]!;
    const attributes: Record<string, unknown> = step.data!.metricMonitor!
      .metricViewConfig.queryConfigs[0]!.metricQueryData.filterData
      .attributes as Record<string, unknown>;

    attributes["oneuptime.managed_device.connection.id"] = new Includes([
      CONNECTION,
      OTHER_CONNECTION,
    ]);
    expect(
      getMonitorManagedDeviceConnectionIds(stepsOf([step])).sort(),
    ).toEqual([CONNECTION, OTHER_CONNECTION].sort());

    // As a JSON column hands it back.
    attributes["oneuptime.managed_device.connection.id"] = {
      _type: "Includes",
      value: [OTHER_CONNECTION],
    } as unknown as JSONObject;
    expect(
      mayMonitorAlertOnManagedDevice({
        monitorSteps: stepsOf([step]),
        connectionId: CONNECTION,
      }),
    ).toBe(false);
  });
});

/*
 * What a monitor reads of one connection (#10286): a connection turned off
 * resolves what its own reading's monitors opened, and one deleted turns
 * off every monitor that read it alone. A monitor that reads anything else
 * besides is never one of them.
 */
describe("what a monitor reads of a connection", () => {
  function templateStep(templateId: string, connectionId: string): MonitorStep {
    const index: number = getManagedDeviceAlertTemplatesFor(
      DeviceManagementProvider.Esper,
    ).findIndex((template: ManagedDeviceAlertTemplate): boolean => {
      return template.id === templateId;
    });

    expect(index).toBeGreaterThanOrEqual(0);

    return templateSteps(DeviceManagementProvider.Esper, connectionId)[index]!;
  }

  test.each(DEVICE_MANAGEMENT_PROVIDERS)(
    "each %s template reads its connection alone: Connection Stopped Reading its own reading, the others its devices'",
    (provider: DeviceManagementProvider) => {
      const templates: Array<ManagedDeviceAlertTemplate> =
        getManagedDeviceAlertTemplatesFor(provider);

      templateSteps(provider, CONNECTION).forEach(
        (step: MonitorStep, index: number) => {
          const isConnectionTemplate: boolean = templates[index]!.id.endsWith(
            "-connection-stopped-reading",
          );

          expect({
            id: templates[index]!.id,
            reads: getMonitorConnectionReads({
              monitorSteps: stepsOf([step]),
              connectionId: CONNECTION,
            }),
          }).toEqual({
            id: templates[index]!.id,
            reads: {
              readsThisConnectionAlone: true,
              readsConnectionReading: isConnectionTemplate,
              readsDeviceReadings: !isConnectionTemplate,
            },
          });

          // Of another connection, it reads nothing.
          expect(
            getMonitorConnectionReads({
              monitorSteps: stepsOf([step]),
              connectionId: OTHER_CONNECTION,
            }),
          ).toEqual({
            readsThisConnectionAlone: false,
            readsConnectionReading: false,
            readsDeviceReadings: false,
          });
        },
      );
    },
  );

  test("a monitor of every template reads both, and the connection alone", () => {
    expect(
      getMonitorConnectionReads({
        monitorSteps: stepsOf(
          templateSteps(DeviceManagementProvider.Esper, CONNECTION),
        ),
        connectionId: CONNECTION,
      }),
    ).toEqual({
      readsThisConnectionAlone: true,
      readsConnectionReading: true,
      readsDeviceReadings: true,
    });
  });

  test("a step of another connection beside it: it reads more than this one", () => {
    expect(
      getMonitorConnectionReads({
        monitorSteps: stepsOf([
          templateStep("esper-connection-stopped-reading", CONNECTION),
          templateStep("esper-connection-stopped-reading", OTHER_CONNECTION),
        ]),
        connectionId: CONNECTION,
      }),
    ).toEqual({
      readsThisConnectionAlone: false,
      readsConnectionReading: true,
      readsDeviceReadings: false,
    });
  });

  test("a query of a list of connections, however it was stored, reads more than this one", () => {
    for (const value of [
      new Includes([CONNECTION, OTHER_CONNECTION]),
      { _type: "Includes", value: [CONNECTION, OTHER_CONNECTION] },
    ]) {
      const step: MonitorStep = templateStep("esper-low-battery", CONNECTION);
      (
        step.data!.metricMonitor!.metricViewConfig.queryConfigs[0]!
          .metricQueryData.filterData.attributes as Record<string, unknown>
      )["oneuptime.managed_device.connection.id"] = value;

      expect(
        getMonitorConnectionReads({
          monitorSteps: stepsOf([step]),
          connectionId: CONNECTION,
        }),
      ).toEqual({
        readsThisConnectionAlone: false,
        readsConnectionReading: false,
        readsDeviceReadings: true,
      });
    }

    // A list of this connection alone is this connection alone.
    const alone: MonitorStep = templateStep("esper-low-battery", CONNECTION);
    (
      alone.data!.metricMonitor!.metricViewConfig.queryConfigs[0]!
        .metricQueryData.filterData.attributes as Record<string, unknown>
    )["oneuptime.managed_device.connection.id"] = new Includes([CONNECTION]);

    expect(
      getMonitorConnectionReads({
        monitorSteps: stepsOf([alone]),
        connectionId: CONNECTION,
      }).readsThisConnectionAlone,
    ).toBe(true);
  });

  test("a query of another metric, of no connection, or a step with no query, reads more than this connection", () => {
    const otherMetric: MonitorStep = templateStep(
      "esper-low-battery",
      CONNECTION,
    );
    const ownQuery: {
      metricQueryData: { filterData: { metricName: string } };
    } = otherMetric.data!.metricMonitor!.metricViewConfig.queryConfigs[0]! as {
      metricQueryData: { filterData: { metricName: string } };
    };
    otherMetric.data!.metricMonitor!.metricViewConfig.queryConfigs.push({
      ...JSON.parse(JSON.stringify(ownQuery)),
      metricQueryData: {
        filterData: {
          metricName: "system.cpu.utilization",
          attributes: { "oneuptime.managed_device.connection.id": CONNECTION },
        },
      },
    });

    const noConnection: MonitorStep = templateStep(
      "esper-low-battery",
      CONNECTION,
    );
    delete (
      noConnection.data!.metricMonitor!.metricViewConfig.queryConfigs[0]!
        .metricQueryData.filterData.attributes as Record<string, unknown>
    )["oneuptime.managed_device.connection.id"];

    const noQuery: MonitorStep = MonitorStep.getDefaultMonitorStep({
      monitorName: "Ping",
      monitorType: MonitorType.Ping,
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
    });

    expect(
      getMonitorConnectionReads({
        monitorSteps: stepsOf([otherMetric]),
        connectionId: CONNECTION,
      }).readsThisConnectionAlone,
    ).toBe(false);
    expect(
      getMonitorConnectionReads({
        monitorSteps: stepsOf([noConnection]),
        connectionId: CONNECTION,
      }),
    ).toEqual({
      readsThisConnectionAlone: false,
      readsConnectionReading: false,
      readsDeviceReadings: false,
    });
    expect(
      getMonitorConnectionReads({
        monitorSteps: stepsOf([
          templateStep("esper-low-battery", CONNECTION),
          noQuery,
        ]),
        connectionId: CONNECTION,
      }).readsThisConnectionAlone,
    ).toBe(false);
  });

  test("no steps read nothing", () => {
    for (const monitorSteps of [undefined, null, stepsOf([])]) {
      expect(
        getMonitorConnectionReads({ monitorSteps, connectionId: CONNECTION }),
      ).toEqual({
        readsThisConnectionAlone: false,
        readsConnectionReading: false,
        readsDeviceReadings: false,
      });
    }
  });
});

describe("getManagedDeviceSeriesQuery", () => {
  test("names the device by any of its names, under the key its series carry", () => {
    const query: JSONObject = getManagedDeviceSeriesQuery([
      "iPhone",
      "iPhone (F2LXK1ABCD)",
    ]);
    const names: unknown = query["oneuptime.managed_device.name"];

    expect(names).toBeInstanceOf(Includes);
    expect((names as Includes).values).toEqual([
      "iPhone",
      "iPhone (F2LXK1ABCD)",
    ]);
  });
});
