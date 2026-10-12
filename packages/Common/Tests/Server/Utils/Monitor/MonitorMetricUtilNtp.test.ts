import MetricType from "../../../../Models/DatabaseModels/MetricType";
import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
import MetricService from "../../../../Server/Services/MetricService";
import MonitorMetricUtil from "../../../../Server/Utils/Monitor/MonitorMetricUtil";
import TelemetryUtil from "../../../../Server/Utils/Telemetry/Telemetry";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import MonitorMetricType from "../../../../Types/Monitor/MonitorMetricType";
import NtpMonitorResponse from "../../../../Types/Monitor/NtpMonitor/NtpMonitorResponse";
import ObjectID from "../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * What an NTP check writes to the charts. Only a server that answered has a
 * clock, a stratum and a synchronized state, so a check without a reply
 * writes none of the four time series - a gap, not a zero offset that would
 * read as a perfect clock.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROBE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const NTP_SERIES: Array<MonitorMetricType> = [
  MonitorMetricType.NtpClockOffset,
  MonitorMetricType.NtpStratum,
  MonitorMetricType.NtpIsSynchronized,
  MonitorMetricType.NtpRootDispersion,
];

function answered(
  overrides: Partial<NtpMonitorResponse> = {},
): NtpMonitorResponse {
  return {
    isOnline: true,
    isSynchronized: true,
    responseTimeInMs: 18,
    failureCause: "",
    stratum: 2,
    leapIndicator: 0,
    rootDelayInMs: 12.5,
    rootDispersionInMs: 3.25,
    clockOffsetInMs: -42.5,
    ...overrides,
  };
}

function probeResponse(ntpResponse: NtpMonitorResponse): ProbeMonitorResponse {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    monitorStepId: ObjectID.generate(),
    probeId: PROBE_ID,
    isOnline: ntpResponse.isOnline,
    responseTimeInMs: ntpResponse.isOnline
      ? ntpResponse.responseTimeInMs
      : undefined,
    failureCause: ntpResponse.failureCause,
    monitoredAt: new Date("2026-08-07T12:00:00.000Z"),
    ntpResponse: ntpResponse,
  };
}

describe("MonitorMetricUtil NTP series", () => {
  let insertedRows: Array<JSONObject>;
  let indexedMaps: Array<Dictionary<MetricType>>;

  beforeEach(() => {
    insertedRows = [];
    indexedMaps = [];

    jest
      .spyOn(GlobalConfigService, "findOneBy")
      .mockResolvedValue(null as never);
    jest
      .spyOn(MetricService, "insertJsonRows")
      .mockImplementation(async (rows: Array<JSONObject>): Promise<void> => {
        insertedRows.push(...rows);
      });
    jest
      .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
      .mockImplementation(
        async (data: {
          projectId: ObjectID;
          metricNameServiceNameMap: Dictionary<MetricType>;
        }): Promise<void> => {
          indexedMaps.push(data.metricNameServiceNameMap);
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function save(ntpResponse: NtpMonitorResponse): Promise<void> {
    await MonitorMetricUtil.saveMonitorMetrics({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      dataToProcess: probeResponse(ntpResponse),
      monitorName: "GPS clock",
      probeName: "London Probe",
    });
  }

  function valueOf(name: MonitorMetricType): unknown {
    return insertedRows.find((row: JSONObject) => {
      return row["name"] === name;
    })?.["value"];
  }

  test("an answering server writes all four time series", async () => {
    await save(answered());

    expect(
      NTP_SERIES.map((series: MonitorMetricType) => {
        return valueOf(series);
      }),
    ).toEqual([42.5, 2, 1, 3.25]);
  });

  test("the offset is stored as how far off the clock is, whichever way", async () => {
    await save(answered({ clockOffsetInMs: 1500 }));
    expect(valueOf(MonitorMetricType.NtpClockOffset)).toBe(1500);
  });

  test("availability and response time go to the shared series", async () => {
    await save(answered());

    expect(valueOf(MonitorMetricType.IsOnline)).toBe(1);
    expect(valueOf(MonitorMetricType.ResponseTime)).toBe(18);
  });

  test("an unsynchronized answer records 0 for synchronized", async () => {
    await save(answered({ isSynchronized: false, stratum: 16 }));

    expect(valueOf(MonitorMetricType.NtpIsSynchronized)).toBe(0);
    expect(valueOf(MonitorMetricType.NtpStratum)).toBe(16);
  });

  test("a kiss-o'-death records stratum 16 and no offset or dispersion", async () => {
    await save(
      answered({
        isSynchronized: false,
        stratum: 0,
        kissCode: "RATE",
        clockOffsetInMs: undefined,
        rootDispersionInMs: undefined,
      }),
    );

    expect(valueOf(MonitorMetricType.NtpStratum)).toBe(16);
    expect(valueOf(MonitorMetricType.NtpIsSynchronized)).toBe(0);
    expect(valueOf(MonitorMetricType.NtpClockOffset)).toBeUndefined();
    expect(valueOf(MonitorMetricType.NtpRootDispersion)).toBeUndefined();
  });

  test("a server that did not answer writes none of the time series", async () => {
    await save({
      isOnline: false,
      isSynchronized: false,
      responseTimeInMs: 0,
      failureCause: "No NTP reply from 192.0.2.10:123 within 5 seconds.",
      isTimeout: true,
    });

    for (const series of NTP_SERIES) {
      expect({ series, value: valueOf(series) }).toEqual({
        series,
        value: undefined,
      });
    }

    expect(valueOf(MonitorMetricType.IsOnline)).toBe(0);
  });

  test("every row carries the monitor and the probe it came from", async () => {
    await save(answered());

    for (const series of NTP_SERIES) {
      const row: JSONObject | undefined = insertedRows.find(
        (candidate: JSONObject) => {
          return candidate["name"] === series;
        },
      );

      expect(row?.["primaryEntityId"]).toBe(MONITOR_ID.toString());
      expect(row?.["attributes"]).toEqual(
        expect.objectContaining({
          monitorId: MONITOR_ID.toString(),
          probeId: PROBE_ID.toString(),
          monitorName: "GPS clock",
          probeName: "London Probe",
        }),
      );
    }
  });

  test("registers the series with their units", async () => {
    await save(answered());

    const metricMap: Dictionary<MetricType> = indexedMaps[0]!;

    expect(metricMap[MonitorMetricType.NtpClockOffset]?.unit).toBe("ms");
    expect(metricMap[MonitorMetricType.NtpRootDispersion]?.unit).toBe("ms");
    expect(metricMap[MonitorMetricType.NtpStratum]?.unit).toBe("");
    expect(metricMap[MonitorMetricType.NtpIsSynchronized]?.unit).toBe("");
  });
});
