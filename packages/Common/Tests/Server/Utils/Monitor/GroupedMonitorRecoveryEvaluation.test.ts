/*
 * The evaluator's import chain pulls the native isolated-vm addon
 * (MonitorCriteriaEvaluator → VMAPI → VMRunner). Nothing under test here
 * touches the sandbox, so stub the module out before anything imports it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import { SeriesBehindStatusReader } from "../../../../Server/Utils/Monitor/GroupedMonitorRecovery";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import AggregateModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../../Types/JSON";
import MetricAliasData from "../../../../Types/Metrics/MetricAliasData";
import MetricFormulaConfigData from "../../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../../../Types/Metrics/MetricQueryConfigData";
import MetricQueryData from "../../../../Types/Metrics/MetricQueryData";
import MetricsViewConfig from "../../../../Types/Metrics/MetricsViewConfig";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import { getHostAlertTemplateById } from "../../../../Types/Monitor/HostAlertTemplates";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary, {
  MonitorEvaluationCriteriaResult,
} from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import RollingTime from "../../../../Types/RollingTime/RollingTime";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse, {
  PerSeriesCriteriaMatch,
} from "../../../../Types/Probe/ProbeApiIngestResponse";
import MetricFormulaEvaluator from "../../../../Utils/Metrics/MetricFormulaEvaluator";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * A GROUPED MONITOR KEEPS THE RECOVERY MARGIN (issue #10061), through the
 * real criteria evaluator.
 *
 * A Host monitor from High Filesystem Usage groups its query by mount and
 * device, fires above 90% and recovers at or below 81%. On a host with disks
 * at 70%, 96% and 14%, the full disk dropping to 89% used to bring the
 * monitor back online: no disk was above 90%, and the 70% and 14% disks met
 * the recovery criteria. Each check below is run through
 * MonitorCriteriaEvaluator.processMonitorStep - what the worker calls - and
 * its verdict is applied the way MonitorResource applies it: the first
 * match's status, the status kept while the series behind it wait, the
 * default status otherwise, and the series behind the status kept for the
 * next check.
 */

const ONLINE: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OFFLINE: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const DEGRADED: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const T0: number = Date.UTC(2026, 10, 22, 9, 0, 0, 0);

// What MonitorResource keeps between checks, in memory.
class MemorySeriesBehindStatus implements SeriesBehindStatusReader {
  public series: Set<string> = new Set<string>();
  public reads: number = 0;

  public getSeries(): Promise<ReadonlySet<string>> {
    this.reads++;
    return Promise.resolve(new Set<string>(this.series));
  }
}

interface Disk {
  mountpoint: string;
  device: string;
}

const ROOT: Disk = { mountpoint: "/", device: "/dev/sda1" };
const DATA: Disk = { mountpoint: "/data", device: "/dev/sdb1" };
const BOOT: Disk = { mountpoint: "/boot", device: "/dev/sda2" };
const NEW_DISK: Disk = { mountpoint: "/scratch", device: "/dev/sdc1" };

function fingerprintOf(disk: Disk): string {
  return MetricSeriesFingerprint.computeFingerprint({
    mountpoint: disk.mountpoint,
    device: disk.device,
  });
}

function filesystemStep(): MonitorStep {
  return getHostAlertTemplateById("host-high-filesystem")!.getMonitorStep({
    hostIdentifier: "web-01",
    onlineMonitorStatusId: ONLINE,
    offlineMonitorStatusId: OFFLINE,
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "web-01",
  });
}

function criteriaOf(step: MonitorStep): Array<MonitorCriteriaInstance> {
  return step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;
}

function criteriaIdNamed(
  step: MonitorStep,
  role: "offline" | "online",
): string {
  const instance: MonitorCriteriaInstance | undefined = criteriaOf(step).find(
    (criteria: MonitorCriteriaInstance): boolean => {
      return (
        criteria.data!.monitorStatusId!.toString() ===
        (role === "offline" ? OFFLINE : ONLINE).toString()
      );
    },
  );

  return instance!.data!.id.toString();
}

function monitorFor(step: MonitorStep, monitorType: MonitorType): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = ObjectID.generate().toString();
  monitor.projectId = ObjectID.generate();
  monitor.monitorType = monitorType;
  monitor.name = "web-01";
  monitor.currentMonitorStatusId = ONLINE;

  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: ONLINE,
  };
  monitor.monitorSteps = monitorSteps;

  return monitor;
}

function queryResult(
  values: Array<number>,
  labels: JSONObject,
): AggregatedResult {
  return {
    data: values.map((value: number, index: number): AggregateModel => {
      return {
        timestamp: new Date(T0 + index * 60_000),
        value: value,
        attributes: { ...labels },
      } as unknown as AggregateModel;
    }),
  };
}

// A series' query results followed by its formula results, as the worker writes them.
function seriesResults(input: {
  metricViewConfig: MetricsViewConfig;
  queryValues: Array<Array<number>>;
  labels: JSONObject;
}): Array<AggregatedResult> {
  const queryResults: Array<AggregatedResult> = input.queryValues.map(
    (values: Array<number>): AggregatedResult => {
      return queryResult(values, input.labels);
    },
  );

  const formulaResults: Array<AggregatedResult> = (
    input.metricViewConfig.formulaConfigs || []
  ).map((formula: MetricFormulaConfigData): AggregatedResult => {
    return MetricFormulaEvaluator.evaluateFormula({
      formula: formula.metricFormulaData.metricFormula,
      queryConfigs: input.metricViewConfig.queryConfigs,
      formulaConfigs: [],
      results: queryResults,
    });
  });

  return [...queryResults, ...formulaResults];
}

interface SeriesValues {
  labels: JSONObject;
  // One array of per-minute values per query, in query order.
  queryValues: Array<Array<number>>;
}

function checkOf(input: {
  monitor: Monitor;
  step: MonitorStep;
  series: Array<SeriesValues>;
}): MetricMonitorResponse {
  const metricViewConfig: MetricsViewConfig = MonitorStep.getMetricsViewConfig(
    input.step,
  )!;

  const grouped: boolean = MonitorStep.isJudgedPerSeries(input.step);

  const seriesBreakdown: Array<MetricSeriesResult> = input.series.map(
    (series: SeriesValues): MetricSeriesResult => {
      return {
        fingerprint: MetricSeriesFingerprint.computeFingerprint(series.labels),
        labels: series.labels,
        aggregatedResults: seriesResults({
          metricViewConfig: metricViewConfig,
          queryValues: series.queryValues,
          labels: series.labels,
        }),
      };
    },
  );

  // Ungrouped, the one series is the fullest disk's (the query's Max).
  const fullest: SeriesValues | undefined = [...input.series].sort(
    (a: SeriesValues, b: SeriesValues): number => {
      return (
        Math.max(...(b.queryValues[0] || [0])) -
        Math.max(...(a.queryValues[0] || [0]))
      );
    },
  )[0];

  return {
    monitorId: input.monitor.id!,
    projectId: input.monitor.projectId!,
    metricViewConfig: metricViewConfig,
    metricResult: grouped
      ? seriesBreakdown.flatMap((series: MetricSeriesResult) => {
          return series.aggregatedResults;
        })
      : fullest
        ? seriesResults({
            metricViewConfig: metricViewConfig,
            queryValues: fullest.queryValues,
            labels: {},
          })
        : metricViewConfig.queryConfigs.map((): AggregatedResult => {
            return { data: [] };
          }),
    ...(grouped ? { seriesBreakdown: seriesBreakdown } : {}),
  };
}

// Disks at these fractions full, as the filesystem template reads them.
function disksAt(disks: Array<[Disk, number]>): Array<SeriesValues> {
  return disks.map(([disk, percent]: [Disk, number]): SeriesValues => {
    return {
      labels: { mountpoint: disk.mountpoint, device: disk.device },
      queryValues: [[percent / 100]],
    };
  });
}

interface Checked {
  response: ProbeApiIngestResponse;
  summary: MonitorEvaluationSummary;
}

/*
 * One monitor, checked again and again: the evaluator's verdict applied the
 * way MonitorResource applies it.
 */
class Monitoring {
  public readonly monitor: Monitor;
  public readonly step: MonitorStep;
  public readonly memory: MemorySeriesBehindStatus | undefined;

  public constructor(input: {
    step: MonitorStep;
    monitorType?: MonitorType | undefined;
    // Without it, nothing is kept between checks.
    withMemory?: boolean | undefined;
  }) {
    this.step = input.step;
    this.monitor = monitorFor(
      input.step,
      input.monitorType || MonitorType.Host,
    );
    this.memory =
      input.withMemory === false ? undefined : new MemorySeriesBehindStatus();
  }

  public get status(): string {
    return this.monitor.currentMonitorStatusId!.toString();
  }

  public async check(series: Array<SeriesValues>): Promise<Checked> {
    const summary: MonitorEvaluationSummary = {
      evaluatedAt: new Date(T0),
      criteriaResults: [],
      events: [],
    };

    const response: ProbeApiIngestResponse =
      await MonitorCriteriaEvaluator.processMonitorStep({
        dataToProcess: checkOf({
          monitor: this.monitor,
          step: this.step,
          series: series,
        }),
        monitorStep: this.step,
        monitor: this.monitor,
        probeApiIngestResponse: {
          monitorId: this.monitor.id!,
          rootCause: null,
        },
        evaluationSummary: summary,
        seriesBehindStatus: this.memory,
      });

    const hasData: boolean = series.some((one: SeriesValues): boolean => {
      return one.queryValues.some((values: Array<number>): boolean => {
        return values.length > 0;
      });
    });

    let isBackOnDefaultStatus: boolean = false;

    if (response.criteriaMetId) {
      const matched: MonitorCriteriaInstance = criteriaOf(this.step).find(
        (criteria: MonitorCriteriaInstance): boolean => {
          return criteria.data!.id.toString() === response.criteriaMetId;
        },
      )!;

      if (matched.data!.changeMonitorStatus && matched.data!.monitorStatusId) {
        this.monitor.currentMonitorStatusId = matched.data!.monitorStatusId;
      }
    } else if ((response.seriesKeepingStatus || []).length > 0) {
      // The status is kept.
    } else if (hasData) {
      this.monitor.currentMonitorStatusId = ONLINE;
      isBackOnDefaultStatus = true;
    }

    if (this.memory && response.seriesBehindStatus !== undefined) {
      this.memory.series = new Set<string>(
        isBackOnDefaultStatus ? [] : response.seriesBehindStatus,
      );
    }

    return { response, summary };
  }
}

function resultOf(
  summary: MonitorEvaluationSummary,
  criteriaId: string,
): MonitorEvaluationCriteriaResult {
  return summary.criteriaResults.find(
    (result: MonitorEvaluationCriteriaResult): boolean => {
      return result.criteriaId === criteriaId;
    },
  )!;
}

function fingerprints(
  matches: Array<PerSeriesCriteriaMatch> | undefined,
): Array<string> {
  return (matches || []).map((match: PerSeriesCriteriaMatch): string => {
    return match.fingerprint;
  });
}

describe("#10061: disks at 70%, 96% and 14%, firing above 90%, recovering at or below 81%", () => {
  test("the 96% disk takes the monitor offline, and only that disk is behind the status", async () => {
    const monitoring: Monitoring = new Monitoring({ step: filesystemStep() });

    const { response } = await monitoring.check(
      disksAt([
        [ROOT, 70],
        [DATA, 96],
        [BOOT, 14],
      ]),
    );

    expect(response.criteriaMetId).toBe(
      criteriaIdNamed(monitoring.step, "offline"),
    );
    expect(fingerprints(response.perSeriesMatches)).toEqual([
      fingerprintOf(DATA),
    ]);
    expect(monitoring.status).toBe(OFFLINE.toString());
    expect(Array.from(monitoring.memory!.series)).toEqual([
      fingerprintOf(DATA),
    ]);
  });

  test("when the 96% disk drops to 89% the monitor stays down, and the recovery criteria says which disk it waits for", async () => {
    const monitoring: Monitoring = new Monitoring({ step: filesystemStep() });

    await monitoring.check(
      disksAt([
        [ROOT, 70],
        [DATA, 96],
        [BOOT, 14],
      ]),
    );

    const { response, summary } = await monitoring.check(
      disksAt([
        [ROOT, 70],
        [DATA, 89],
        [BOOT, 14],
      ]),
    );

    expect(response.criteriaMetId).toBeUndefined();
    expect(response.matchedCriteria).toEqual([]);
    expect(
      (response.seriesKeepingStatus || []).map(
        (series: { fingerprint: string }): string => {
          return series.fingerprint;
        },
      ),
    ).toEqual([fingerprintOf(DATA)]);
    expect(response.seriesKeepingStatus![0]!.labels).toEqual({
      mountpoint: "/data",
      device: "/dev/sdb1",
    });
    expect(monitoring.status).toBe(OFFLINE.toString());

    const healthy: MonitorEvaluationCriteriaResult = resultOf(
      summary,
      criteriaIdNamed(monitoring.step, "online"),
    );

    expect(healthy.met).toBe(false);
    expect(healthy.message).toContain("Mount: /data | Device: /dev/sdb1");
    expect(healthy.message).toContain("has not met this one since");

    // The criteria that opened the disk's records ran, and matched no disk.
    expect(response.evaluatedCriteriaIds).toContain(
      criteriaIdNamed(monitoring.step, "offline"),
    );
  });

  test("it comes back once the full disk is at 81%, and nothing is behind the status any more", async () => {
    const monitoring: Monitoring = new Monitoring({ step: filesystemStep() });

    for (const percent of [96, 89, 85, 82]) {
      await monitoring.check(
        disksAt([
          [ROOT, 70],
          [DATA, percent],
          [BOOT, 14],
        ]),
      );

      expect(monitoring.status).toBe(OFFLINE.toString());
    }

    const { response } = await monitoring.check(
      disksAt([
        [ROOT, 70],
        [DATA, 81],
        [BOOT, 14],
      ]),
    );

    expect(response.criteriaMetId).toBe(
      criteriaIdNamed(monitoring.step, "online"),
    );
    expect(response.seriesKeepingStatus).toBeUndefined();
    expect(response.seriesBehindStatus).toEqual([]);
    expect(monitoring.status).toBe(ONLINE.toString());
  });

  test("with every disk in the margin, the full one still keeps the monitor down", async () => {
    const monitoring: Monitoring = new Monitoring({ step: filesystemStep() });

    await monitoring.check(
      disksAt([
        [ROOT, 85],
        [DATA, 96],
      ]),
    );

    const { response } = await monitoring.check(
      disksAt([
        [ROOT, 85],
        [DATA, 89],
      ]),
    );

    expect(response.criteriaMetId).toBeUndefined();
    expect(response.seriesKeepingStatus).toHaveLength(1);
    expect(monitoring.status).toBe(OFFLINE.toString());
  });

  test("a disk that sits at 85% but never breached does not hold the monitor down once the full disk recovers", async () => {
    const monitoring: Monitoring = new Monitoring({ step: filesystemStep() });

    await monitoring.check(
      disksAt([
        [ROOT, 85],
        [DATA, 96],
      ]),
    );

    const { response } = await monitoring.check(
      disksAt([
        [ROOT, 85],
        [DATA, 40],
      ]),
    );

    expect(response.criteriaMetId).toBe(
      criteriaIdNamed(monitoring.step, "online"),
    );
    expect(monitoring.status).toBe(ONLINE.toString());
  });

  test("without what is behind the status - a Redis that was flushed - the recovery criteria matches on any disk, as before", async () => {
    const monitoring: Monitoring = new Monitoring({
      step: filesystemStep(),
      withMemory: false,
    });

    await monitoring.check(
      disksAt([
        [ROOT, 70],
        [DATA, 96],
        [BOOT, 14],
      ]),
    );

    const { response } = await monitoring.check(
      disksAt([
        [ROOT, 70],
        [DATA, 89],
        [BOOT, 14],
      ]),
    );

    expect(response.criteriaMetId).toBe(
      criteriaIdNamed(monitoring.step, "online"),
    );
  });

  test("a disk hovering around 90% does not make the status flap", async () => {
    const random: SeededRandom = seededRandom(10061);
    const monitoring: Monitoring = new Monitoring({ step: filesystemStep() });

    await monitoring.check(
      disksAt([
        [ROOT, 70],
        [DATA, 96],
        [BOOT, 14],
      ]),
    );

    const statuses: Set<string> = new Set<string>();

    for (let check: number = 0; check < 60; check++) {
      // 88.0% to 91.9%: either side of the 90% line, never down to 81%.
      const fullDisk: number = 88 + random(40) / 10;

      await monitoring.check(
        disksAt([
          [ROOT, 70],
          [DATA, fullDisk],
          [BOOT, 14],
        ]),
      );

      statuses.add(monitoring.status);
    }

    expect(Array.from(statuses)).toEqual([OFFLINE.toString()]);
  });

  test("the evaluation summary keeps each disk for the Overview's Series card (#10062)", async () => {
    const monitoring: Monitoring = new Monitoring({ step: filesystemStep() });

    await monitoring.check(
      disksAt([
        [ROOT, 70],
        [DATA, 96],
        [BOOT, 14],
      ]),
    );

    const { summary } = await monitoring.check(
      disksAt([
        [ROOT, 70],
        [DATA, 89],
        [BOOT, 14],
      ]),
    );

    expect(summary.series?.count).toBe(3);

    const rows: Array<{
      fingerprint: string;
      value?: number | undefined;
      unit?: string | undefined;
      metCriteriaIds: Array<string>;
      isKeepingStatus?: boolean | undefined;
    }> = summary.series!.rows;

    // The disk that keeps the status first, at the formula's 89%.
    expect(rows[0]!.fingerprint).toBe(fingerprintOf(DATA));
    expect(rows[0]!.isKeepingStatus).toBe(true);
    expect(rows[0]!.value).toBeCloseTo(89, 6);
    expect(rows[0]!.unit).toBe("%");
    expect(rows[0]!.metCriteriaIds).toEqual([]);

    // The others met the recovery criteria, which waited for the full disk.
    for (const other of rows.slice(1)) {
      expect(other.metCriteriaIds).toEqual([
        criteriaIdNamed(monitoring.step, "online"),
      ]);
      expect(other.isKeepingStatus).toBeUndefined();
    }
  });

  test("the series behind the status are read only while the monitor is not at its default status", async () => {
    const monitoring: Monitoring = new Monitoring({ step: filesystemStep() });

    const { response } = await monitoring.check(
      disksAt([
        [ROOT, 70],
        [DATA, 40],
      ]),
    );

    expect(monitoring.memory!.reads).toBe(0);
    // Nothing to write on a healthy check at the default status.
    expect(response.seriesBehindStatus).toBeUndefined();

    await monitoring.check(
      disksAt([
        [ROOT, 70],
        [DATA, 96],
      ]),
    );

    expect(monitoring.memory!.reads).toBe(0);

    await monitoring.check(
      disksAt([
        [ROOT, 70],
        [DATA, 89],
      ]),
    );

    expect(monitoring.memory!.reads).toBe(1);
  });
});

describe("#10061: series that appear, disappear, or send nothing", () => {
  test("the full disk unmounted while it holds the status: the monitor comes back, as the disk's incident resolves", async () => {
    const monitoring: Monitoring = new Monitoring({ step: filesystemStep() });

    await monitoring.check(
      disksAt([
        [ROOT, 70],
        [DATA, 96],
      ]),
    );
    await monitoring.check(
      disksAt([
        [ROOT, 70],
        [DATA, 89],
      ]),
    );

    expect(monitoring.status).toBe(OFFLINE.toString());

    const { response } = await monitoring.check(disksAt([[ROOT, 70]]));

    expect(response.criteriaMetId).toBe(
      criteriaIdNamed(monitoring.step, "online"),
    );
    expect(monitoring.status).toBe(ONLINE.toString());
  });

  test("a new disk in the margin does not hold the status; a new disk that breaches does", async () => {
    const monitoring: Monitoring = new Monitoring({ step: filesystemStep() });

    await monitoring.check(
      disksAt([
        [ROOT, 70],
        [DATA, 96],
      ]),
    );

    // A new disk appears at 85%, the full one recovers.
    const quiet: Checked = await monitoring.check(
      disksAt([
        [ROOT, 70],
        [DATA, 50],
        [NEW_DISK, 85],
      ]),
    );

    expect(quiet.response.criteriaMetId).toBe(
      criteriaIdNamed(monitoring.step, "online"),
    );
    expect(monitoring.status).toBe(ONLINE.toString());

    // Then breaches, and drops into the margin: now it holds the status.
    await monitoring.check(
      disksAt([
        [ROOT, 70],
        [DATA, 50],
        [NEW_DISK, 95],
      ]),
    );

    const held: Checked = await monitoring.check(
      disksAt([
        [ROOT, 70],
        [DATA, 50],
        [NEW_DISK, 88],
      ]),
    );

    expect(held.response.criteriaMetId).toBeUndefined();
    expect(held.response.seriesKeepingStatus![0]!.fingerprint).toBe(
      fingerprintOf(NEW_DISK),
    );
    expect(monitoring.status).toBe(OFFLINE.toString());
  });

  test("a check with no data at all keeps what is behind the status, so the margin holds when data comes back", async () => {
    const monitoring: Monitoring = new Monitoring({ step: filesystemStep() });

    await monitoring.check(
      disksAt([
        [ROOT, 70],
        [DATA, 96],
      ]),
    );

    const silent: Checked = await monitoring.check([]);

    expect(silent.response.criteriaMetId).toBeUndefined();
    expect(silent.response.seriesKeepingStatus).toBeUndefined();
    expect(silent.response.seriesBehindStatus).toEqual([fingerprintOf(DATA)]);
    // MonitorResource keeps an infrastructure monitor's status on silence.
    expect(monitoring.status).toBe(OFFLINE.toString());

    const back: Checked = await monitoring.check(
      disksAt([
        [ROOT, 70],
        [DATA, 89],
      ]),
    );

    expect(back.response.criteriaMetId).toBeUndefined();
    expect(back.response.seriesKeepingStatus).toHaveLength(1);
    expect(monitoring.status).toBe(OFFLINE.toString());
  });
});

describe("#10061: an ungrouped monitor behaves exactly as before", () => {
  function ungroupedFilesystemStep(): MonitorStep {
    const step: MonitorStep = filesystemStep();

    for (const queryConfig of MonitorStep.getMetricsViewConfig(step)!
      .queryConfigs) {
      queryConfig.metricQueryData.groupByAttributeKeys = [];
    }

    return step;
  }

  test("between 81% and 90% no criteria matches, nothing is held and nothing is read or written", async () => {
    const monitoring: Monitoring = new Monitoring({
      step: ungroupedFilesystemStep(),
    });

    const fired: Checked = await monitoring.check(
      disksAt([
        [ROOT, 70],
        [DATA, 96],
      ]),
    );

    expect(fired.response.criteriaMetId).toBe(
      criteriaIdNamed(monitoring.step, "offline"),
    );
    expect(fired.response.matchedCriteria).toBeUndefined();
    expect(fired.response.perSeriesMatches).toBeUndefined();

    const margin: Checked = await monitoring.check(
      disksAt([
        [ROOT, 70],
        [DATA, 89],
      ]),
    );

    expect(margin.response.criteriaMetId).toBeUndefined();
    expect(margin.response.seriesKeepingStatus).toBeUndefined();
    expect(margin.response.seriesBehindStatus).toBeUndefined();
    expect(margin.response.matchedCriteria).toBeUndefined();
    expect(monitoring.memory!.reads).toBe(0);

    // No series of its own: no Series card on its Overview.
    expect(margin.summary.series).toBeUndefined();

    // As before: no criteria matched, so the monitor goes to its default status.
    expect(monitoring.status).toBe(ONLINE.toString());
  });

  test("criteria after the first match are still not evaluated", async () => {
    const monitoring: Monitoring = new Monitoring({
      step: ungroupedFilesystemStep(),
    });

    const { summary } = await monitoring.check(
      disksAt([
        [ROOT, 70],
        [DATA, 96],
      ]),
    );

    const healthy: MonitorEvaluationCriteriaResult = resultOf(
      summary,
      criteriaIdNamed(monitoring.step, "online"),
    );

    expect(healthy.skipped).toBe(true);
    expect(healthy.skipCause).toBe("earlier-criterion-matched");
  });
});

/*
 * Criteria written by hand, on a Metrics monitor grouped by host: a critical
 * band that opens an incident, a status-only warning band, and a healthy
 * criteria with a margin of its own.
 */
describe("#10061: criteria written by hand", () => {
  const HOST_KEY: string = "host.name";

  function threshold(input: {
    filterType: FilterType;
    value: number;
  }): CriteriaFilter {
    return {
      checkOn: CheckOn.MetricValue,
      filterType: input.filterType,
      value: input.value,
      metricMonitorOptions: {
        metricAlias: "cpu",
        metricAggregationType: EvaluateOverTimeType.AnyValue,
      },
    };
  }

  function handWritten(data: {
    name: string;
    statusId: ObjectID;
    filter: CriteriaFilter;
    opensIncident?: boolean | undefined;
  }): MonitorCriteriaInstance {
    const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
    instance.data = {
      id: ObjectID.generate().toString(),
      name: data.name,
      description: "",
      monitorStatusId: data.statusId,
      changeMonitorStatus: true,
      filterCondition: FilterCondition.All,
      filters: [data.filter],
      createIncidents: data.opensIncident === true,
      incidents: data.opensIncident
        ? [
            {
              id: ObjectID.generate().toString(),
              title: `${data.name} on {{host.name}}`,
              description: "",
              incidentSeverityId: ObjectID.generate(),
              autoResolveIncident: true,
              onCallPolicyIds: [],
            },
          ]
        : [],
      alerts: [],
      createAlerts: false,
    };
    return instance;
  }

  function cpuStep(order: "problems first" | "healthy first"): MonitorStep {
    const critical: MonitorCriteriaInstance = handWritten({
      name: "Critical",
      statusId: OFFLINE,
      filter: threshold({ filterType: FilterType.GreaterThan, value: 95 }),
      opensIncident: true,
    });
    const warning: MonitorCriteriaInstance = handWritten({
      name: "Warning",
      statusId: DEGRADED,
      filter: threshold({ filterType: FilterType.GreaterThan, value: 80 }),
    });
    const healthy: MonitorCriteriaInstance = handWritten({
      name: "Healthy",
      statusId: ONLINE,
      filter: threshold({
        filterType: FilterType.LessThanOrEqualTo,
        value: 72,
      }),
    });

    const criteria: MonitorCriteria = new MonitorCriteria();
    criteria.data = {
      monitorCriteriaInstanceArray:
        order === "problems first"
          ? [critical, warning, healthy]
          : [healthy, critical, warning],
    };

    const metricAliasData: MetricAliasData = {
      metricVariable: "cpu",
      title: "CPU",
      description: undefined,
      legend: undefined,
      legendUnit: "%",
    };

    const queryConfig: MetricQueryConfigData = {
      metricAliasData: metricAliasData,
      metricQueryData: {
        filterData: { metricName: "system.cpu.utilization" },
        groupByAttributeKeys: [HOST_KEY],
      } as unknown as MetricQueryData,
    };

    const step: MonitorStep = new MonitorStep();
    step.data = {
      id: ObjectID.generate().toString(),
      monitorCriteria: criteria,
    } as unknown as MonitorStep["data"];
    step.data!.metricMonitor = {
      metricViewConfig: { queryConfigs: [queryConfig], formulaConfigs: [] },
      rollingTime: RollingTime.Past1Minute,
    };

    return step;
  }

  function hostsAt(hosts: Array<[string, number]>): Array<SeriesValues> {
    return hosts.map(([host, value]: [string, number]): SeriesValues => {
      return { labels: { [HOST_KEY]: host }, queryValues: [[value]] };
    });
  }

  test("critical, then warning, then held in the warning band's margin, then healthy", async () => {
    const monitoring: Monitoring = new Monitoring({
      step: cpuStep("problems first"),
      monitorType: MonitorType.Metrics,
    });

    await monitoring.check(
      hostsAt([
        ["web-1", 97],
        ["web-2", 30],
      ]),
    );
    expect(monitoring.status).toBe(OFFLINE.toString());

    // 85%: no longer critical, still in the warning band.
    await monitoring.check(
      hostsAt([
        ["web-1", 85],
        ["web-2", 30],
      ]),
    );
    expect(monitoring.status).toBe(DEGRADED.toString());

    // 75%: under the warning band, over the healthy line: held.
    const held: Checked = await monitoring.check(
      hostsAt([
        ["web-1", 75],
        ["web-2", 30],
      ]),
    );
    expect(held.response.criteriaMetId).toBeUndefined();
    expect(monitoring.status).toBe(DEGRADED.toString());

    await monitoring.check(
      hostsAt([
        ["web-1", 70],
        ["web-2", 30],
      ]),
    );
    expect(monitoring.status).toBe(ONLINE.toString());
  });

  test("a healthy criteria listed first no longer wins while a host breaches", async () => {
    const monitoring: Monitoring = new Monitoring({
      step: cpuStep("healthy first"),
      monitorType: MonitorType.Metrics,
    });

    const { response } = await monitoring.check(
      hostsAt([
        ["web-1", 97],
        ["web-2", 30],
      ]),
    );

    const critical: MonitorCriteriaInstance = criteriaOf(monitoring.step)[1]!;

    expect(response.criteriaMetId).toBe(critical.data!.id.toString());
    expect(monitoring.status).toBe(OFFLINE.toString());

    // The critical host still opens its own incident.
    expect(fingerprints(response.perSeriesMatches)).toEqual([
      MetricSeriesFingerprint.computeFingerprint({ [HOST_KEY]: "web-1" }),
    ]);
  });

  test("a host that only ever met the healthy criteria never holds anything", async () => {
    const monitoring: Monitoring = new Monitoring({
      step: cpuStep("problems first"),
      monitorType: MonitorType.Metrics,
    });

    const { response } = await monitoring.check(
      hostsAt([
        ["web-1", 75],
        ["web-2", 30],
      ]),
    );

    // web-1 sits in the margin but never breached: nothing waits.
    expect(response.criteriaMetId).toBe(
      criteriaOf(monitoring.step)[2]!.data!.id.toString(),
    );
    expect(monitoring.status).toBe(ONLINE.toString());
  });
});
