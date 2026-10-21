jest.mock("isolated-vm", () => {
  return {};
});

import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import PerEntityCriteriaFanOut, {
  FanOutEntity,
} from "../../../../Server/Utils/Monitor/PerEntityCriteriaFanOut";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import SnmpInterface from "../../../../Types/Monitor/SnmpMonitor/SnmpInterface";
import {
  NetworkDeviceTransceiver,
  TransceiverHealth,
  TransceiverReadingKind,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpTransceiver";
import ObjectID from "../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import { PerSeriesCriteriaMatch } from "../../../../Types/Probe/ProbeApiIngestResponse";
import { describe, expect, it } from "@jest/globals";

/*
 * "*" on a transceiver criteria raises one alert per port, like the
 * interface criteria - but it fans out over the ports that have (or had)
 * an optic, not every port of the switch, so the per-criteria cap is never
 * spent on 48 copper ports before it reaches the uplinks.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

function copperPort(index: number): SnmpInterface {
  return {
    interfaceIndex: index,
    name: `Gi1/0/${index}`,
    isOperationallyUp: true,
    isAdministrativelyUp: true,
    utilizationPercent: 5,
  };
}

function uplink(index: number, alias?: string): SnmpInterface {
  return {
    interfaceIndex: 1000 + index,
    name: `Te1/1/${index}`,
    ...(alias ? { alias: alias } : {}),
    isOperationallyUp: true,
    isAdministrativelyUp: true,
    utilizationPercent: 40,
  };
}

function optic(input: {
  index: number;
  alias?: string | undefined;
  isPresent?: boolean | undefined;
  rxPowerDbm?: number | undefined;
  missingPolls?: number | undefined;
}): NetworkDeviceTransceiver {
  const isPresent: boolean = input.isPresent ?? true;

  return {
    interfaceIndex: 1000 + input.index,
    interfaceName: `Te1/1/${input.index}`,
    ...(input.alias ? { interfaceAlias: input.alias } : {}),
    isPresent: isPresent,
    vendor: "FLEXOPTIX",
    serialNumber: `F${input.index}`,
    measurements: isPresent
      ? {
          [TransceiverReadingKind.RxPower]: {
            readings: [{ value: input.rxPowerDbm ?? -4 }],
            thresholds: {
              lowAlarm: -18.4,
              lowWarning: -14.4,
              highWarning: 0.5,
              highAlarm: 2.5,
            },
          },
        }
      : {},
    health: isPresent
      ? (input.rxPowerDbm ?? -4) <= -18.4
        ? TransceiverHealth.Alarm
        : TransceiverHealth.Healthy
      : TransceiverHealth.NotDetected,
    ...(isPresent
      ? {}
      : {
          missingPolls: input.missingPolls ?? 2,
          missingSince: "2026-10-09T10:00:00.000Z",
        }),
  };
}

function devicePoll(input: {
  interfaces: Array<SnmpInterface>;
  transceivers?: Array<NetworkDeviceTransceiver> | undefined;
}): DataToProcess {
  const response: ProbeMonitorResponse = {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    monitorStepId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    failureCause: "",
    isOnline: true,
    monitoredAt: new Date("2026-10-09T10:05:00.000Z"),
    snmpResponse: {
      isOnline: true,
      responseTimeInMs: 12,
      failureCause: "",
      oidResponses: [],
      interfaces: input.interfaces,
      ...(input.transceivers ? { transceivers: input.transceivers } : {}),
    },
  };

  return response as DataToProcess;
}

function criteriaWith(filters: Array<CriteriaFilter>): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: "criteria-optics",
    name: "Transceiver not detected",
    description: "",
    monitorStatusId: undefined,
    filterCondition: FilterCondition.All,
    filters: filters,
    incidents: [],
    alerts: [],
    createAlerts: true,
    createIncidents: true,
  } as unknown as MonitorCriteriaInstance["data"];
  return instance;
}

const NOT_DETECTED_EVERY_PORT: CriteriaFilter = {
  checkOn: CheckOn.SnmpTransceiverNotDetected,
  filterType: FilterType.True,
  value: undefined,
  snmpMonitorOptions: { interfaceName: "*" },
};

function deviceMonitor(): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  monitor.projectId = PROJECT_ID;
  monitor.monitorType = MonitorType.NetworkDevice;
  monitor.name = "core-switch-1";
  return monitor;
}

type CollectPerSeriesMatches = (input: {
  dataToProcess: DataToProcess;
  monitor: Monitor;
  monitorStep: MonitorStep;
  criteriaInstance: MonitorCriteriaInstance;
}) => Promise<Array<PerSeriesCriteriaMatch>>;

const collectPerSeriesMatches: CollectPerSeriesMatches = (
  MonitorCriteriaEvaluator as unknown as {
    collectPerSeriesMatches: CollectPerSeriesMatches;
  }
).collectPerSeriesMatches.bind(MonitorCriteriaEvaluator);

async function collect(input: {
  filters: Array<CriteriaFilter>;
  dataToProcess: DataToProcess;
}): Promise<Array<PerSeriesCriteriaMatch>> {
  return collectPerSeriesMatches({
    dataToProcess: input.dataToProcess,
    monitor: deviceMonitor(),
    monitorStep: new MonitorStep(),
    criteriaInstance: criteriaWith(input.filters),
  });
}

// A 48-port access switch with four SFP+ uplinks.
const ACCESS_SWITCH_PORTS: Array<SnmpInterface> = [
  ...Array.from({ length: 48 }, (_v: unknown, i: number) => {
    return copperPort(i + 1);
  }),
  uplink(1, "Uplink to core-a"),
  uplink(2, "Uplink to core-b"),
  uplink(3),
  uplink(4),
];

describe("PerEntityCriteriaFanOut - transceivers", () => {
  it("raises one alert per port whose optic is gone, each its own series", async () => {
    const matches: Array<PerSeriesCriteriaMatch> = await collect({
      filters: [NOT_DETECTED_EVERY_PORT],
      dataToProcess: devicePoll({
        interfaces: ACCESS_SWITCH_PORTS,
        transceivers: [
          optic({ index: 1, alias: "Uplink to core-a", isPresent: false }),
          optic({ index: 2, alias: "Uplink to core-b" }),
          optic({ index: 3, isPresent: false }),
          optic({ index: 4 }),
        ],
      }),
    });

    expect(
      matches.map((match: PerSeriesCriteriaMatch) => {
        return match.labels;
      }),
    ).toEqual([
      { interfaceName: "Te1/1/1", interfaceAlias: "Uplink to core-a" },
      { interfaceName: "Te1/1/3" },
    ]);
    expect(matches[0]!.fingerprint).not.toBe(matches[1]!.fingerprint);
    expect(matches[0]!.rootCause).toContain(
      "Transceiver no longer detected in Te1/1/1 (Uplink to core-a)",
    );
    expect(matches[0]!.rootCause).not.toContain("Te1/1/3");
  });

  it("fans out over the optics' ports only, not all 52 ports of the switch", () => {
    const entities: Array<FanOutEntity> =
      PerEntityCriteriaFanOut.getSnmpInterfaceEntities({
        criteriaInstance: criteriaWith([NOT_DETECTED_EVERY_PORT]),
        dataToProcess: devicePoll({
          interfaces: ACCESS_SWITCH_PORTS,
          transceivers: [optic({ index: 1 }), optic({ index: 2 })],
        }),
      });

    expect(
      entities.map((entity: FanOutEntity) => {
        return entity.labels["interfaceName"];
      }),
    ).toEqual(["Te1/1/1", "Te1/1/2"]);
  });

  it("an interface CheckOn in the same criteria keeps every port", () => {
    const criteria: MonitorCriteriaInstance = criteriaWith([
      NOT_DETECTED_EVERY_PORT,
      {
        checkOn: CheckOn.SnmpInterfaceIsDown,
        filterType: FilterType.True,
        value: undefined,
        snmpMonitorOptions: { interfaceName: "*" },
      },
    ]);

    expect(PerEntityCriteriaFanOut.isOnlyTransceiverFanOut(criteria)).toBe(
      false,
    );
    expect(
      PerEntityCriteriaFanOut.getSnmpInterfaceEntities({
        criteriaInstance: criteria,
        dataToProcess: devicePoll({
          interfaces: ACCESS_SWITCH_PORTS,
          transceivers: [optic({ index: 1 })],
        }),
      }),
    ).toHaveLength(52);
  });

  it("only '*' filters decide which list is fanned out over", () => {
    // A transceiver "*" next to an interface filter scoped to one port.
    const criteria: MonitorCriteriaInstance = criteriaWith([
      NOT_DETECTED_EVERY_PORT,
      {
        checkOn: CheckOn.SnmpInterfaceUtilizationPercent,
        filterType: FilterType.GreaterThan,
        value: 90,
        snmpMonitorOptions: { interfaceName: "Te1/1/1" },
      },
    ]);

    expect(PerEntityCriteriaFanOut.isOnlyTransceiverFanOut(criteria)).toBe(
      true,
    );
    expect(
      PerEntityCriteriaFanOut.isOnlyTransceiverFanOut(
        criteriaWith([
          {
            ...NOT_DETECTED_EVERY_PORT,
            snmpMonitorOptions: { interfaceName: "Te1/1/1" },
          },
        ]),
      ),
    ).toBe(false);
  });

  it("narrows a transceiver '*' to the port, and leaves scoped filters alone", () => {
    const scoped: CriteriaFilter = {
      checkOn: CheckOn.SnmpTransceiverRxPowerDrop,
      filterType: FilterType.GreaterThanOrEqualTo,
      value: 2,
      snmpMonitorOptions: { interfaceName: "Te1/1/2" },
    };
    const entities: Array<FanOutEntity> =
      PerEntityCriteriaFanOut.getSnmpInterfaceEntities({
        criteriaInstance: criteriaWith([NOT_DETECTED_EVERY_PORT, scoped]),
        dataToProcess: devicePoll({
          interfaces: ACCESS_SWITCH_PORTS,
          transceivers: [optic({ index: 1 })],
        }),
      });

    expect(entities).toHaveLength(1);
    expect(
      entities[0]!.narrowFilter(NOT_DETECTED_EVERY_PORT).snmpMonitorOptions
        ?.interfaceName,
    ).toBe("Te1/1/1");
    expect(entities[0]!.narrowFilter(scoped)).toBe(scoped);
  });

  it("is configured by a transceiver '*' alone", () => {
    expect(
      PerEntityCriteriaFanOut.isSnmpInterfaceFanOutConfigured(
        criteriaWith([NOT_DETECTED_EVERY_PORT]),
      ),
    ).toBe(true);
    expect(
      PerEntityCriteriaFanOut.isSnmpInterfaceFanOutConfigured(
        criteriaWith([
          {
            ...NOT_DETECTED_EVERY_PORT,
            snmpMonitorOptions: {},
          },
        ]),
      ),
    ).toBe(false);
  });

  it("a poll that read no transceivers fans out over nothing", () => {
    expect(
      PerEntityCriteriaFanOut.getSnmpInterfaceEntities({
        criteriaInstance: criteriaWith([NOT_DETECTED_EVERY_PORT]),
        dataToProcess: devicePoll({ interfaces: ACCESS_SWITCH_PORTS }),
      }),
    ).toEqual([]);
  });

  it("raises one alert per optic past its alarm threshold", async () => {
    const matches: Array<PerSeriesCriteriaMatch> = await collect({
      filters: [
        {
          checkOn: CheckOn.SnmpTransceiverPastAlarmThreshold,
          filterType: FilterType.True,
          value: undefined,
          snmpMonitorOptions: { interfaceName: "*" },
        },
      ],
      dataToProcess: devicePoll({
        interfaces: ACCESS_SWITCH_PORTS,
        transceivers: [
          optic({ index: 1, rxPowerDbm: -21 }),
          optic({ index: 2, rxPowerDbm: -3 }),
          optic({ index: 3, rxPowerDbm: -19.5 }),
        ],
      }),
    });

    expect(
      matches.map((match: PerSeriesCriteriaMatch) => {
        return match.labels["interfaceName"];
      }),
    ).toEqual(["Te1/1/1", "Te1/1/3"]);
    expect(matches[1]!.rootCause).toContain(
      "RX Power -19.50 dBm is below the low alarm threshold of -18.40 dBm",
    );
  });
});
