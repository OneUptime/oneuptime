import SSLMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/SSLMonitorCriteria";
import EvaluateOverTime from "../../../../../Server/Utils/Monitor/Criteria/EvaluateOverTime";
import PreviousCheckComparison, {
  PreviousCheckReads,
} from "../../../../../Server/Utils/Monitor/Criteria/PreviousCheckComparison";
import { CheckWindowJudgement } from "../../../../../Server/Utils/Monitor/Criteria/CheckWindowCounts";
import MonitorMetricUtil from "../../../../../Server/Utils/Monitor/MonitorMetricUtil";
import GlobalConfigService from "../../../../../Server/Services/GlobalConfigService";
import MetricService, {
  MonitorPreviousCheckRow,
} from "../../../../../Server/Services/MetricService";
import TelemetryUtil from "../../../../../Server/Utils/Telemetry/Telemetry";
import logger from "../../../../../Server/Utils/Logger";
import AggregationType from "../../../../../Types/BaseDatabase/AggregationType";
import { JSONObject } from "../../../../../Types/JSON";
import {
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil,
  EvaluateOverTimeType,
  FilterType,
  PreviousCheckChangeType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import MonitorMetricType from "../../../../../Types/Monitor/MonitorMetricType";
import { MONITOR_STEP_ID_ATTRIBUTE } from "../../../../../Types/Monitor/MonitorStepSeries";
import MonitorType from "../../../../../Types/Monitor/MonitorType";
import SslCertificateExpiry from "../../../../../Types/Monitor/SSLMonitor/SslCertificateExpiry";
import SslMonitorResponse from "../../../../../Types/Monitor/SSLMonitor/SslMonitorResponse";
import ObjectID from "../../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../../Types/Probe/ProbeMonitorResponse";
import MonitorMetricTypeUtil from "../../../../../Utils/Monitor/MonitorMetricType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * AN SSL CERTIFICATE'S DAYS LEFT, COMPARED WITH THE PREVIOUS CHECK (#10905).
 *
 * Each check that reads a certificate's expiry writes its days left as a
 * series, read the way Expires In Days reads it, so the filter is offered a
 * window and Previous Check: "the days left dropped by more than one" is a
 * certificate replaced by one that expires sooner, "they rose" a renewal.
 */

const NOW: Date = new Date("2026-11-24T12:00:00.000Z");
const DAY: number = 24 * 60 * 60 * 1000;
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROBE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const STEP_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

// A certificate that expires this many days (and hours) from NOW.
function certificate(days: number, hours: number = 0): SslMonitorResponse {
  return {
    expiresAt: new Date(NOW.getTime() + days * DAY + hours * 60 * 60 * 1000),
  } as SslMonitorResponse;
}

function sslCheck(
  sslResponse: SslMonitorResponse | undefined,
): ProbeMonitorResponse {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    monitorStepId: STEP_ID,
    probeId: PROBE_ID,
    failureCause: "",
    isOnline: true,
    responseTimeInMs: 40,
    sslResponse: sslResponse,
    monitoredAt: NOW,
  } as ProbeMonitorResponse;
}

const daysLeft: (filterType: FilterType, value: number) => CriteriaFilter = (
  filterType: FilterType,
  value: number,
): CriteriaFilter => {
  return { checkOn: CheckOn.ExpiresInDays, filterType: filterType, value };
};

describe("an SSL certificate's days left (#10905)", () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe("SslCertificateExpiry.getDaysLeft, the one reading of it", () => {
    test("whole days, rounded down; negative once expired; none without an expiry", () => {
      expect(
        SslCertificateExpiry.getDaysLeft({
          sslResponse: certificate(14, 20),
          at: NOW,
        }),
      ).toBe(14);
      expect(
        SslCertificateExpiry.getDaysLeft({
          sslResponse: certificate(0, 5),
          at: NOW,
        }),
      ).toBe(0);
      expect(
        SslCertificateExpiry.getDaysLeft({
          sslResponse: certificate(-2, -3),
          at: NOW,
        }),
      ).toBe(-2);
      expect(
        SslCertificateExpiry.getDaysLeft({ sslResponse: {} as SslMonitorResponse, at: NOW }),
      ).toBeNull();
      expect(
        SslCertificateExpiry.getDaysLeft({ sslResponse: undefined, at: NOW }),
      ).toBeNull();
    });

    test("an expiry read back as text, as a stored check holds it, reads the same", () => {
      expect(
        SslCertificateExpiry.getDaysLeft({
          sslResponse: {
            expiresAt: new Date(NOW.getTime() + 30 * DAY).toISOString(),
          } as unknown as SslMonitorResponse,
          at: NOW,
        }),
      ).toBe(30);
    });
  });

  describe("the series each check writes", () => {
    let rows: Array<JSONObject> = [];

    beforeEach(() => {
      rows = [];
      jest
        .spyOn(GlobalConfigService, "findOneBy")
        .mockResolvedValue(null as never);
      jest
        .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(MetricService, "insertJsonRows")
        .mockImplementation(async (written: Array<JSONObject>): Promise<void> => {
          rows.push(...written);
        });
    });

    async function save(sslResponse: SslMonitorResponse | undefined): Promise<
      Array<JSONObject>
    > {
      await MonitorMetricUtil.saveMonitorMetrics({
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
        dataToProcess: sslCheck(sslResponse),
        probeName: undefined,
        monitorName: "Shop certificate",
        monitorStepId: STEP_ID,
      });

      return rows.filter((row: JSONObject): boolean => {
        return row["name"] === MonitorMetricType.SslCertificateExpiresInDays;
      });
    }

    test("one row a check: the days left, under the probe and the step", async () => {
      const written: Array<JSONObject> = await save(certificate(29, 23));

      expect(written).toHaveLength(1);
      expect(written[0]!["value"]).toBe(29);
      expect(written[0]!["attributes"]).toMatchObject({
        probeId: PROBE_ID.toString(),
        [MONITOR_STEP_ID_ATTRIBUTE]: STEP_ID.toString(),
      });
    });

    test("an expired certificate writes its negative days; a check with no expiry writes none, never a 0", async () => {
      expect((await save(certificate(-3)))[0]!["value"]).toBe(-3);

      rows = [];
      expect(await save(undefined)).toEqual([]);

      rows = [];
      expect(await save({} as SslMonitorResponse)).toEqual([]);
    });
  });

  describe("what reads the series", () => {
    test("Expires In Days reads it, judged by its fewest days in a chart's bucket", () => {
      expect(
        MonitorMetricTypeUtil.getMonitorMetricTypeByCriteriaFilterOrNull(
          daysLeft(FilterType.LessThan, 14),
        ),
      ).toBe(MonitorMetricType.SslCertificateExpiresInDays);
      expect(
        MonitorMetricTypeUtil.getAggregationTypeByMonitorMetricType(
          MonitorMetricType.SslCertificateExpiresInDays,
        ),
      ).toBe(AggregationType.Min);

      // Expires In Hours still writes nothing.
      expect(
        MonitorMetricTypeUtil.getMonitorMetricTypeByCriteriaFilterOrNull({
          checkOn: CheckOn.ExpiresInHours,
          filterType: FilterType.LessThan,
          value: 48,
        }),
      ).toBeNull();
    });

    test("an SSL monitor charts it on its Metrics tab, named as the filter", () => {
      expect(
        MonitorMetricTypeUtil.getMonitorMetricTypesByMonitorType(
          MonitorType.SSLCertificate,
        ),
      ).toEqual([
        MonitorMetricType.IsOnline,
        MonitorMetricType.ResponseTime,
        MonitorMetricType.SslCertificateExpiresInDays,
      ]);
      expect(
        MonitorMetricTypeUtil.getTitleByMonitorMetricType(
          MonitorMetricType.SslCertificateExpiresInDays,
          MonitorType.SSLCertificate,
        ),
      ).toBe("Expires In Days");
      expect(
        MonitorMetricTypeUtil.getDescriptionByMonitorMetricType(
          MonitorMetricType.SslCertificateExpiresInDays,
          MonitorType.SSLCertificate,
        ),
      ).toContain("whole days");

      // A DNS monitor's charts are unchanged.
      expect(
        MonitorMetricTypeUtil.getMonitorMetricTypesByMonitorType(MonitorType.DNS),
      ).toEqual([MonitorMetricType.IsOnline, MonitorMetricType.ResponseTime]);
    });

    test("the filter is offered a window, a count and Previous Check on an SSL monitor", () => {
      expect(
        CriteriaFilterUtil.isEvaluateOverTimeFilter(
          CheckOn.ExpiresInDays,
          MonitorType.SSLCertificate,
        ),
      ).toBe(true);
      expect(
        CriteriaFilterUtil.canCountChecks(
          CheckOn.ExpiresInDays,
          MonitorType.SSLCertificate,
        ),
      ).toBe(true);

      const offered: Array<EvaluateOverTimeType> =
        CriteriaFilterUtil.getEvaluateOverTimeTypeByCriteriaFilter(
          daysLeft(FilterType.LessThan, 14),
          MonitorType.SSLCertificate,
        );
      expect(offered).toEqual(
        expect.arrayContaining([
          EvaluateOverTimeType.PreviousCheck,
          EvaluateOverTimeType.MunimumValue,
          EvaluateOverTimeType.Count,
        ]),
      );

      // A value compared by a change, never a yes or no.
      expect(
        CriteriaFilterUtil.comparesValueWithPreviousCheck(
          {
            ...daysLeft(FilterType.LessThan, 0),
            evaluateOverTime: true,
            evaluateOverTimeOptions: {
              timeValueInMinutes: 60,
              evaluateOverTimeType: EvaluateOverTimeType.PreviousCheck,
            },
          },
          MonitorType.SSLCertificate,
        ),
      ).toBe(true);
    });
  });

  describe("SSLMonitorCriteria: Expires In Days on this check and over a window", () => {
    async function judge(
      filter: CriteriaFilter,
      sslResponse: SslMonitorResponse | undefined,
    ): Promise<string | null> {
      return SSLMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: sslCheck(sslResponse),
        criteriaFilter: filter,
      });
    }

    test("0 is a threshold: a certificate past its expiry is less than 0 days, one on its last day at least 0", async () => {
      expect(await judge(daysLeft(FilterType.LessThan, 0), certificate(-2))).toBeTruthy();
      expect(await judge(daysLeft(FilterType.LessThan, 0), certificate(5))).toBeNull();
      expect(
        await judge(daysLeft(FilterType.GreaterThanOrEqualTo, 0), certificate(0, 5)),
      ).toBeTruthy();

      // Expires In Hours too.
      expect(
        await judge(
          { checkOn: CheckOn.ExpiresInHours, filterType: FilterType.LessThan, value: 0 },
          certificate(-1),
        ),
      ).toBeTruthy();
    });

    test("a threshold that is no number, or a check with no expiry, matches nothing", async () => {
      expect(
        await judge(
          { checkOn: CheckOn.ExpiresInDays, filterType: FilterType.LessThan, value: "soon" },
          certificate(1),
        ),
      ).toBeNull();
      expect(await judge(daysLeft(FilterType.LessThan, 14), undefined)).toBeNull();
    });

    test("over a window, the window's days are judged, not this check's", async () => {
      const overTime: jest.SpiedFunction<
        typeof EvaluateOverTime.getOverTimeValueForCriteriaFilter
      > = jest.spyOn(EvaluateOverTime, "getOverTimeValueForCriteriaFilter");

      // The fewest days left over the last day: 5, though this check reads 30.
      overTime.mockResolvedValue({ earlyReturn: null, value: 5 });
      expect(await judge(daysLeft(FilterType.LessThan, 7), certificate(30))).toBeTruthy();

      // Every check of the window: 10 and 12 are both under 14; 10 and 20 are not.
      overTime.mockResolvedValue({ earlyReturn: null, value: [10, 12] });
      expect(await judge(daysLeft(FilterType.LessThan, 14), certificate(30))).toBeTruthy();
      overTime.mockResolvedValue({ earlyReturn: null, value: [10, 20] });
      expect(await judge(daysLeft(FilterType.LessThan, 14), certificate(30))).toBeNull();

      // A window that cannot be judged yet decides, never this check alone.
      overTime.mockResolvedValue({ earlyReturn: { result: null }, value: undefined });
      expect(await judge(daysLeft(FilterType.GreaterThan, 7), certificate(30))).toBeNull();
    });
  });

  describe("compared with the previous check", () => {
    const DROPPED_BY_MORE_THAN_ONE: CriteriaFilter = {
      ...daysLeft(FilterType.LessThan, 0),
      value: undefined,
      evaluateOverTime: true,
      evaluateOverTimeOptions: {
        timeValueInMinutes: 60,
        evaluateOverTimeType: EvaluateOverTimeType.PreviousCheck,
        changeType: PreviousCheckChangeType.Amount,
        changeValue: 1,
      },
    };

    const RENEWED: CriteriaFilter = {
      ...daysLeft(FilterType.GreaterThan, 0),
      value: undefined,
      evaluateOverTime: true,
      evaluateOverTimeOptions: {
        timeValueInMinutes: 60,
        evaluateOverTimeType: EvaluateOverTimeType.PreviousCheck,
        changeType: PreviousCheckChangeType.Amount,
        changeValue: 0,
      },
    };

    async function compare(input: {
      filter: CriteriaFilter;
      previous: number | null;
      now: SslMonitorResponse;
    }): Promise<CheckWindowJudgement> {
      jest
        .spyOn(MetricService, "readPreviousMonitorChecks")
        .mockResolvedValue(
          (input.previous === null
            ? []
            : [
                {
                  group: { probeId: PROBE_ID.toString() },
                  value: input.previous,
                  at: new Date(NOW.getTime() - 5 * 60 * 1000),
                },
              ]) as Array<MonitorPreviousCheckRow>,
        );

      jest.spyOn(logger, "error").mockImplementation(() => {
        return undefined as never;
      });

      return PreviousCheckComparison.judgeFilter({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        monitorStepId: STEP_ID,
        stepScope: {
          monitorStepId: STEP_ID.toString(),
          readsRowsWithoutStep: true,
        },
        monitorType: MonitorType.SSLCertificate,
        probeId: PROBE_ID,
        criteriaFilter: input.filter,
        checkWrittenAt: NOW,
        reads: new PreviousCheckReads(),
        isMetOnThisCheck: async (): Promise<boolean> => {
          return false;
        },
        judgeThisCheck: (thisCheck: CriteriaFilter): Promise<string | null> => {
          return SSLMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
            dataToProcess: sslCheck(input.now),
            criteriaFilter: thisCheck,
          });
        },
      });
    }

    test("a certificate replaced by one that expires sooner: 30 days, then 27", async () => {
      const judgement: CheckWindowJudgement = await compare({
        filter: DROPPED_BY_MORE_THAN_ONE,
        previous: 30,
        now: certificate(27),
      });

      expect(judgement.rootCause).toBeTruthy();
      expect(judgement.message).toContain("read 30");
      expect(judgement.message).toContain("less than 29");
    });

    test("the days left dropping by one, as each day does, is no match: 30, then 29", async () => {
      const judgement: CheckWindowJudgement = await compare({
        filter: DROPPED_BY_MORE_THAN_ONE,
        previous: 30,
        now: certificate(29),
      });

      expect(judgement.rootCause).toBeNull();
    });

    test("down to its last day and past it: 1 day, then expired - a threshold of 0", async () => {
      expect(
        (
          await compare({
            filter: DROPPED_BY_MORE_THAN_ONE,
            previous: 1,
            now: certificate(-1),
          })
        ).rootCause,
      ).toBeTruthy();
    });

    test("a renewal: 3 days, then 90 - and none while the days only fall", async () => {
      expect(
        (await compare({ filter: RENEWED, previous: 3, now: certificate(90) }))
          .rootCause,
      ).toBeTruthy();
      expect(
        (await compare({ filter: RENEWED, previous: 30, now: certificate(29) }))
          .rootCause,
      ).toBeNull();
    });

    test("the first check has no previous one: If No Data decides, as for any window", async () => {
      const judgement: CheckWindowJudgement = await compare({
        filter: DROPPED_BY_MORE_THAN_ONE,
        previous: null,
        now: certificate(27),
      });

      expect(judgement.rootCause).toBeNull();
      expect(judgement.message).toContain("has no previous check");
    });
  });
});
