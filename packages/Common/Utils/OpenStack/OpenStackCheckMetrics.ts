import { JSONArray, JSONObject } from "../../Types/JSON";
import { OPENSTACK_REGION_ATTRIBUTE } from "../../Types/Monitor/MonitorStepOpenStackMonitor";
import {
  OpenStackApiCheckResult,
  OpenStackApiServiceResult,
  OpenStackCertificateResult,
  OpenStackLifecyclePhase,
  OpenStackLifecyclePhaseVerdict,
  OpenStackLifecycleRecords,
  OpenStackLifecycleRegionRecord,
  OpenStackLifecycleRun,
  OpenStackLifecycleStepResult,
  isOpenStackLifecycleVerdictCurrent,
} from "../../Types/OpenStack/OpenStackCheck";

/*
 * WHAT THE CHECKS SAY AS SERIES: THE NAMES #5750 BUILDS SLOS AND STATUS PAGES ON, SO NEVER RENAMED.
 *
 * Built on the server from what a probe reported, not by the probe. So it is one path whichever
 * check reported, a value is what these rules made of a bounded report and not whatever a probe
 * sent, and the lifecycle check's verdict can go out with every API check.
 *
 * Why with every API check. A lifecycle run reports every 30 minutes, and an alert reads a window
 * of at least three collections, so read as they arrive it would take an hour and a half to open an
 * incident, and as long to close one. So what the newest run found is said again each minute, by
 * each API check, for as long as it is the newest:
 *
 *   openstack_check_lifecycle_success{...} at any moment reads whether the last run to finish
 *   passed. So its average over a month is how much of the month a user could have booted.
 *
 * An incident opens within minutes of a failed run and closes within minutes of a good one, by the
 * rules every other template goes by. A verdict older than two and a half intervals is no longer
 * said, because silence is not recovery: an open incident stays open, and a run that never reported
 * is not read as one that passed. The API checks stop too if the probe dies, for the same result.
 */

export enum OpenStackCheckMetric {
  // 1 when Keystone issued a token, 0 when not. One series per region, all saying the same.
  TokenSuccess = "openstack_check_token_success",
  TokenDuration = "openstack_check_token_duration_seconds",
  // 1 when a service answered its read, or refused this credential: its API is working.
  ApiSuccess = "openstack_check_api_success",
  ApiDuration = "openstack_check_api_duration_seconds",
  // Days until an endpoint's certificate expires, negative once it has.
  CertificateExpiry = "openstack_check_certificate_expiry_days",
  // 1 when the last finished run of a region passed every step, 0 when one failed.
  LifecycleSuccess = "openstack_check_lifecycle_success",
  // 1 or 0 for what each phase last came to: boot, floating_ip, volume, cleanup, credential.
  LifecyclePhaseSuccess = "openstack_check_lifecycle_phase_success",
  // 1 or 0 for each step of the last finished run.
  LifecycleStepSuccess = "openstack_check_lifecycle_step_success",
  // How long each step of the last finished run took.
  LifecycleStepDuration = "openstack_check_lifecycle_step_duration_seconds",
  LifecycleRunDuration = "openstack_check_lifecycle_run_duration_seconds",
  // How long ago the last finished run finished.
  LifecycleRunAge = "openstack_check_lifecycle_run_age_seconds",
  // What the last run could not delete, and what the janitor removed at its start.
  LifecycleLeftovers = "openstack_check_lifecycle_leftovers",
  LifecycleJanitorRemoved = "openstack_check_lifecycle_janitor_removed",
  // 1 while this check's credential is one it refuses to write with, so no run has a verdict.
  LifecycleRefused = "openstack_check_lifecycle_refused",
}

export const OPENSTACK_CHECK_API_METRICS: ReadonlySet<string> = new Set<string>(
  [
    OpenStackCheckMetric.TokenSuccess,
    OpenStackCheckMetric.TokenDuration,
    OpenStackCheckMetric.ApiSuccess,
    OpenStackCheckMetric.ApiDuration,
    OpenStackCheckMetric.CertificateExpiry,
  ],
);

export const OPENSTACK_CHECK_LIFECYCLE_METRICS: ReadonlySet<string> =
  new Set<string>([
    OpenStackCheckMetric.LifecycleSuccess,
    OpenStackCheckMetric.LifecyclePhaseSuccess,
    OpenStackCheckMetric.LifecycleStepSuccess,
    OpenStackCheckMetric.LifecycleStepDuration,
    OpenStackCheckMetric.LifecycleRunDuration,
    OpenStackCheckMetric.LifecycleRunAge,
    OpenStackCheckMetric.LifecycleLeftovers,
    OpenStackCheckMetric.LifecycleJanitorRemoved,
    OpenStackCheckMetric.LifecycleRefused,
  ]);

// What every check's series goes under, so a page can ask for them by their one prefix.
export const OPENSTACK_CHECK_METRIC_PREFIX: string = "openstack_check_";

/*
 * Stamped on every resource these go out under, so ingest can tell them from a collection. A check
 * of a cloud whose agent has stopped should not read as that cloud reporting.
 */
export const OPENSTACK_CHECK_RESOURCE_ATTRIBUTE: string =
  "openstack.check.source";
export const OPENSTACK_CHECK_RESOURCE_VALUE: string = "probe";

// Whether a resource's attributes, as OTLP has them, are of a check rather than a collection.
export function isOpenStackCheckResource(attributes: unknown): boolean {
  if (!Array.isArray(attributes)) {
    return false;
  }

  return attributes.some((attribute: unknown): boolean => {
    const item: JSONObject | null =
      attribute && typeof attribute === "object"
        ? (attribute as JSONObject)
        : null;

    return (
      item?.["key"] === OPENSTACK_CHECK_RESOURCE_ATTRIBUTE &&
      (item["value"] as JSONObject | undefined)?.["stringValue"] ===
        OPENSTACK_CHECK_RESOURCE_VALUE
    );
  });
}

const SCOPE_NAME: string = "oneuptime-probe-openstack-checks";

const MS_PER_DAY: number = 24 * 60 * 60_000;

interface Point {
  metric: OpenStackCheckMetric;
  value: number;
  labels: Record<string, string | number>;
  description: string;
  unit: string;
}

const DESCRIPTIONS: Readonly<
  Record<OpenStackCheckMetric, { description: string; unit: string }>
> = {
  [OpenStackCheckMetric.TokenSuccess]: {
    description: "Whether Keystone issued this check a token (1) or not (0)",
    unit: "1",
  },
  [OpenStackCheckMetric.TokenDuration]: {
    description: "How long Keystone took to issue this check a token",
    unit: "s",
  },
  [OpenStackCheckMetric.ApiSuccess]: {
    description:
      "Whether a service in the catalog answered this check's read (1) or not (0)",
    unit: "1",
  },
  [OpenStackCheckMetric.ApiDuration]: {
    description: "How long a service in the catalog took to answer",
    unit: "s",
  },
  [OpenStackCheckMetric.CertificateExpiry]: {
    description: "Days until an endpoint's certificate expires",
    unit: "d",
  },
  [OpenStackCheckMetric.LifecycleSuccess]: {
    description:
      "Whether the last lifecycle run to finish passed every step (1) or not (0)",
    unit: "1",
  },
  [OpenStackCheckMetric.LifecyclePhaseSuccess]: {
    description: "What each phase of the lifecycle check last came to",
    unit: "1",
  },
  [OpenStackCheckMetric.LifecycleStepSuccess]: {
    description: "Whether each step of the last lifecycle run passed",
    unit: "1",
  },
  [OpenStackCheckMetric.LifecycleStepDuration]: {
    description: "How long each step of the last lifecycle run took",
    unit: "s",
  },
  [OpenStackCheckMetric.LifecycleRunDuration]: {
    description: "How long the last lifecycle run took, from start to finish",
    unit: "s",
  },
  [OpenStackCheckMetric.LifecycleRunAge]: {
    description: "How long ago the last lifecycle run finished",
    unit: "s",
  },
  [OpenStackCheckMetric.LifecycleLeftovers]: {
    description: "What the last lifecycle run could not delete",
    unit: "1",
  },
  [OpenStackCheckMetric.LifecycleJanitorRemoved]: {
    description:
      "What the janitor removed at the start of the last lifecycle run",
    unit: "1",
  },
  [OpenStackCheckMetric.LifecycleRefused]: {
    description:
      "Whether the lifecycle check is refusing its credential, so no run has a verdict",
    unit: "1",
  },
};

function point(
  metric: OpenStackCheckMetric,
  value: number,
  labels: Record<string, string | number>,
): Point {
  return {
    metric: metric,
    value: value,
    labels: labels,
    ...DESCRIPTIONS[metric],
  };
}

function seconds(milliseconds: number): number {
  return Math.round(Math.max(0, milliseconds)) / 1000;
}

/*
 * The API checks' series. A service that was not checked says nothing: its plain-HTTP URL was never
 * sent a token, so nothing is known of it, and a 0 would page someone about a choice they made.
 */
export function getOpenStackApiCheckPoints(data: {
  result: OpenStackApiCheckResult;
  now: number;
}): Array<Point> {
  const { result } = data;
  const points: Array<Point> = [];
  const regions: ReadonlyArray<string> = result.regionNames;
  const isTokenFine: boolean = result.token.status === "Passed";

  for (const regionName of regions) {
    const region: Record<string, string> = {
      [OPENSTACK_REGION_ATTRIBUTE]: regionName,
    };

    points.push(
      point(OpenStackCheckMetric.TokenSuccess, isTokenFine ? 1 : 0, region),
    );

    // A wait for something not asked says nothing of how fast Keystone is.
    if (result.token.status !== "BackingOff") {
      points.push(
        point(
          OpenStackCheckMetric.TokenDuration,
          seconds(result.token.durationInMs),
          region,
        ),
      );
    }
  }

  for (const service of result.services as Array<OpenStackApiServiceResult>) {
    if (service.outcome === "NotChecked") {
      continue;
    }

    const labels: Record<string, string | number> = {
      [OPENSTACK_REGION_ATTRIBUTE]: service.regionName,
      service_type: service.serviceType,
      service_name: service.serviceName,
    };

    points.push(
      point(
        OpenStackCheckMetric.ApiSuccess,
        service.outcome === "Failing" ? 0 : 1,
        { ...labels, outcome: service.outcome },
      ),
    );
    points.push(
      point(
        OpenStackCheckMetric.ApiDuration,
        seconds(service.durationInMs),
        labels,
      ),
    );
  }

  for (const certificate of result.certificates as Array<OpenStackCertificateResult>) {
    const validTo: number = Date.parse(certificate.validTo);

    if (Number.isNaN(validTo)) {
      continue;
    }

    const days: number =
      Math.round(((validTo - data.now) / MS_PER_DAY) * 100) / 100;

    // Each region it serves says so, so a monitor narrowed to a region finds it.
    const regionNames: ReadonlyArray<string> =
      certificate.regionNames.length > 0 ? certificate.regionNames : regions;

    for (const regionName of regionNames) {
      points.push(
        point(OpenStackCheckMetric.CertificateExpiry, days, {
          [OPENSTACK_REGION_ATTRIBUTE]: regionName,
          host: certificate.host,
          port: certificate.port,
        }),
      );
    }
  }

  return points;
}

/*
 * What the newest finished run of each region said, as of now. See the top of this file for why it
 * is said again and again.
 */
export function getOpenStackLifecycleCheckPoints(data: {
  records: OpenStackLifecycleRecords;
  intervalInMinutes: number;
  now: number;
}): Array<Point> {
  const points: Array<Point> = [];

  for (const regionName of Object.keys(data.records)) {
    // A region a probe could say nothing about is no series: see OpenStackLifecycleCheck.
    if (!regionName) {
      continue;
    }

    const record: OpenStackLifecycleRegionRecord = data.records[
      regionName
    ] as OpenStackLifecycleRegionRecord;

    const region: Record<string, string> = {
      [OPENSTACK_REGION_ATTRIBUTE]: regionName,
    };

    const isRefused: boolean = record.lastAttempt?.status === "Refused";

    points.push(
      point(OpenStackCheckMetric.LifecycleRefused, isRefused ? 1 : 0, region),
    );

    const run: OpenStackLifecycleRun | undefined = record.lastVerdict;

    if (
      !run ||
      isRefused ||
      !isOpenStackLifecycleVerdictCurrent({
        finishedAt: run.finishedAt,
        intervalInMinutes: data.intervalInMinutes,
        now: data.now,
      })
    ) {
      continue;
    }

    points.push(
      point(
        OpenStackCheckMetric.LifecycleSuccess,
        run.status === "Succeeded" ? 1 : 0,
        region,
      ),
    );

    for (const phase of Object.keys(
      record.phaseVerdicts,
    ) as Array<OpenStackLifecyclePhase>) {
      const verdict: OpenStackLifecyclePhaseVerdict | undefined =
        record.phaseVerdicts[phase];

      if (verdict === "Passed" || verdict === "Failed") {
        points.push(
          point(
            OpenStackCheckMetric.LifecyclePhaseSuccess,
            verdict === "Passed" ? 1 : 0,
            { ...region, phase: phase },
          ),
        );
      }
    }

    for (const step of run.steps as Array<OpenStackLifecycleStepResult>) {
      const labels: Record<string, string> = { ...region, step: step.step };

      points.push(
        point(
          OpenStackCheckMetric.LifecycleStepSuccess,
          step.status === "Passed" ? 1 : 0,
          labels,
        ),
      );

      // A step that failed took as long as it took to fail, which says nothing about how slow it is.
      if (step.status === "Passed") {
        points.push(
          point(
            OpenStackCheckMetric.LifecycleStepDuration,
            seconds(step.durationInMs),
            labels,
          ),
        );
      }
    }

    const startedAt: number = Date.parse(run.startedAt);
    const finishedAt: number = Date.parse(run.finishedAt);

    if (!Number.isNaN(startedAt) && !Number.isNaN(finishedAt)) {
      points.push(
        point(
          OpenStackCheckMetric.LifecycleRunDuration,
          seconds(finishedAt - startedAt),
          region,
        ),
        point(
          OpenStackCheckMetric.LifecycleRunAge,
          seconds(data.now - finishedAt),
          region,
        ),
      );
    }

    points.push(
      point(OpenStackCheckMetric.LifecycleLeftovers, run.leftoverCount, region),
      point(
        OpenStackCheckMetric.LifecycleJanitorRemoved,
        run.janitor?.removed.length || 0,
        region,
      ),
    );
  }

  return points;
}

/*
 * As OTLP, the shape the rest of a cloud's series arrive in: one resource, with region and what
 * each is about on its datapoints. The server stamps which cloud it is (OpenStackProbeMetrics).
 */
export function toOpenStackCheckResourceMetrics(data: {
  points: ReadonlyArray<Point>;
  now: number;
  scopeVersion: string;
}): JSONArray {
  if (data.points.length === 0) {
    return [];
  }

  const byMetric: Map<OpenStackCheckMetric, Array<Point>> = new Map();

  for (const item of data.points) {
    const list: Array<Point> | undefined = byMetric.get(item.metric);

    if (list) {
      list.push(item);
    } else {
      byMetric.set(item.metric, [item]);
    }
  }

  const timeUnixNano: string = `${Math.round(data.now)}000000`;
  const metrics: JSONArray = [];

  for (const [metric, points] of byMetric) {
    const first: Point = points[0] as Point;

    metrics.push({
      name: metric,
      description: first.description,
      unit: first.unit,
      gauge: {
        dataPoints: points.map((item: Point): JSONObject => {
          return {
            timeUnixNano: timeUnixNano,
            asDouble: item.value,
            attributes: Object.keys(item.labels).map(
              (key: string): JSONObject => {
                return {
                  key: key,
                  value: { stringValue: String(item.labels[key]) },
                };
              },
            ),
          };
        }),
      },
    });
  }

  return [
    {
      resource: {
        attributes: [
          {
            key: OPENSTACK_CHECK_RESOURCE_ATTRIBUTE,
            value: { stringValue: OPENSTACK_CHECK_RESOURCE_VALUE },
          },
        ],
      },
      scopeMetrics: [
        {
          scope: { name: SCOPE_NAME, version: data.scopeVersion },
          metrics: metrics,
        },
      ],
    },
  ];
}
