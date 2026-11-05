import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { mergeOpenStackLifecycleRuns } from "../../../Server/Utils/OpenStack/OpenStackCheckStore";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import { OPENSTACK_REGION_ATTRIBUTE } from "../../../Types/Monitor/MonitorStepOpenStackMonitor";
import {
  OpenStackAlertTemplate,
  OpenStackAlertTemplateArgs,
  getOpenStackAlertTemplateById,
} from "../../../Types/Monitor/OpenStackAlertTemplates";
import ObjectID from "../../../Types/ObjectID";
import {
  OpenStackApiCheckResult,
  OpenStackApiServiceResult,
  OpenStackCheckRemovedResource,
  OpenStackLifecycleRecords,
  OpenStackLifecycleRun,
  OpenStackLifecycleStep,
  OpenStackLifecycleStepResult,
} from "../../../Types/OpenStack/OpenStackCheck";
import {
  OpenStackCheckFindings,
  getOpenStackCheckFindings,
  openStackCheckFindingsToMarkdown,
} from "../../../Utils/OpenStack/OpenStackCheckFindings";
import {
  OpenStackCheckMetric,
  getOpenStackApiCheckPoints,
  getOpenStackLifecycleCheckPoints,
} from "../../../Utils/OpenStack/OpenStackCheckMetrics";
import { parseOpenStackCheckName } from "../../../Utils/OpenStack/OpenStackCheckName";
import {
  TemplateWalkStep,
  TimedSample,
  TimedSamplesByAlias,
  walkTemplateCriteria,
} from "../../Types/Monitor/Utils/TemplateCriteriaEvaluation";

/*
 * THE ISSUE'S DONE-WHEN, ON WHAT A REAL CLOUD SAID (Tests/Ops/openstack-e2e/checks-record.sh).
 *
 * A real DevStack, a credential that can do nothing else, the probe's own check code from Node:
 * nova-scheduler stopped and started, a run killed part way, credentials that reach too far.
 *
 * Everything from a run's report on is the real code: the merge a report goes through, the series
 * the heartbeat says, the template, the evaluator, and what the incident is written with.
 *
 * WHERE THIS STOPS. No OneUptime stack ran in the rig, so nothing was ingested, stored in ClickHouse
 * or raised as an incident: this hands the evaluator the series as the worker would hand them over.
 * And a rig does not wait half an hour between runs, so the runs' outcomes are real, and when they
 * finished is moved onto the 30-minute schedule a check keeps.
 */

const FIXTURES: string = path.resolve(__dirname, "../../Fixtures/OpenStack");
const RELEASES: ReadonlyArray<string> = fs
  .readdirSync(FIXTURES)
  .filter((release: string): boolean => {
    return fs.existsSync(path.join(FIXTURES, release, "checks", "verdict.txt"));
  });

const REGION: string = "RegionOne";
const INTERVAL_IN_MINUTES: number = 30;
const MINUTE: number = 60_000;
const WINDOW_MINUTES: number = 5;
const START_MS: number = Date.UTC(2026, 10, 5, 0, 0, 0);

const ARGS: OpenStackAlertTemplateArgs = {
  cloudIdentifier: "devstack",
  onlineMonitorStatusId: ObjectID.generate(),
  offlineMonitorStatusId: ObjectID.generate(),
  defaultIncidentSeverityId: ObjectID.generate(),
  defaultAlertSeverityId: ObjectID.generate(),
  monitorName: "The rig",
};

function readScene(
  release: string,
  scene: string,
): Array<OpenStackLifecycleRun> {
  return JSON.parse(
    fs.readFileSync(
      path.join(FIXTURES, release, "checks", scene, "report.json"),
      "utf8",
    ),
  ) as Array<OpenStackLifecycleRun>;
}

function runOf(release: string, scene: string): OpenStackLifecycleRun {
  const run: OpenStackLifecycleRun | undefined = readScene(release, scene).find(
    (one: OpenStackLifecycleRun): boolean => {
      return one.regionName === REGION;
    },
  );

  expect(run).toBeDefined();

  return run as OpenStackLifecycleRun;
}

// A real run, as though it had finished at this minute of the schedule.
function finishedAt(
  run: OpenStackLifecycleRun,
  minute: number,
): OpenStackLifecycleRun {
  const finished: number = START_MS + minute * MINUTE;
  const took: number = Date.parse(run.finishedAt) - Date.parse(run.startedAt);

  return {
    ...run,
    startedAt: new Date(finished - took).toISOString(),
    finishedAt: new Date(finished).toISOString(),
  };
}

interface Timeline {
  healthyAt: number;
  failedAt: number;
  recoveredAt: number;
  endsAt: number;
  runs: Array<OpenStackLifecycleRun>;
}

function timelineOf(
  release: string,
  broken: string = "scheduler-stopped",
  mended: string = "scheduler-started",
): Timeline {
  const healthyAt: number = 0;
  const failedAt: number = INTERVAL_IN_MINUTES;
  const recoveredAt: number = 2 * INTERVAL_IN_MINUTES;

  return {
    healthyAt,
    failedAt,
    recoveredAt,
    endsAt: 3 * INTERVAL_IN_MINUTES - 1,
    runs: [
      finishedAt(runOf(release, "healthy"), healthyAt),
      finishedAt(runOf(release, broken), failedAt),
      finishedAt(runOf(release, mended), recoveredAt),
    ],
  };
}

// What the row says at a minute: every report merged, in order, as the store merges them.
function recordsAt(
  timeline: Timeline,
  minute: number,
): OpenStackLifecycleRecords {
  let records: OpenStackLifecycleRecords = {};

  for (const run of timeline.runs) {
    if (Date.parse(run.finishedAt) <= START_MS + minute * MINUTE) {
      records = mergeOpenStackLifecycleRuns({ records, runs: [run] });
    }
  }

  return records;
}

// The heartbeat: each minute's API check says what the last run came to.
function samplesOf(
  query: MetricQueryConfigData,
  timeline: Timeline,
): Array<TimedSample> {
  const filter: MetricQueryConfigData["metricQueryData"]["filterData"] =
    query.metricQueryData.filterData;
  const wanted: Record<string, unknown> =
    (filter.attributes as Record<string, unknown> | undefined) || {};
  const samples: Array<TimedSample> = [];

  for (let minute: number = 0; minute <= timeline.endsAt; minute++) {
    const timeMs: number = START_MS + minute * MINUTE;

    for (const point of getOpenStackLifecycleCheckPoints({
      records: recordsAt(timeline, minute),
      intervalInMinutes: INTERVAL_IN_MINUTES,
      now: timeMs,
    })) {
      if (
        point.metric === filter.metricName &&
        Object.entries(wanted).every(
          ([key, value]: [string, unknown]): boolean => {
            return String(point.labels[key]) === String(value);
          },
        )
      ) {
        samples.push({ timeMs, value: point.value });
      }
    }
  }

  return samples;
}

async function walk(
  templateId: string,
  timeline: Timeline,
): Promise<Array<TemplateWalkStep>> {
  const template: OpenStackAlertTemplate = getOpenStackAlertTemplateById(
    templateId,
  ) as OpenStackAlertTemplate;
  const step: MonitorStep = template.getMonitorStep(ARGS);
  const viewConfig: NonNullable<MonitorStep["data"]> = step.data as NonNullable<
    MonitorStep["data"]
  >;
  const queries: Array<MetricQueryConfigData> =
    viewConfig.openstackMonitor!.metricViewConfig.queryConfigs;
  const samplesByAlias: TimedSamplesByAlias = {};

  for (const query of queries) {
    samplesByAlias[query.metricAliasData?.metricVariable || ""] = samplesOf(
      query,
      timeline,
    );
  }

  return await walkTemplateCriteria({
    step,
    viewConfig: viewConfig.openstackMonitor!.metricViewConfig,
    samplesByAlias,
    windowMinutes: WINDOW_MINUTES,
    startMs: START_MS + WINDOW_MINUTES * MINUTE,
    endMs: START_MS + timeline.endsAt * MINUTE,
  });
}

function minuteOf(step: TemplateWalkStep): number {
  return (step.atMs - START_MS) / MINUTE;
}

function stepNamed(
  run: OpenStackLifecycleRun,
  name: OpenStackLifecycleStep,
): OpenStackLifecycleStepResult | undefined {
  return run.steps.find((step: OpenStackLifecycleStepResult): boolean => {
    return step.step === name;
  });
}

describe.each(RELEASES as Array<string>)(
  "%s: the issue's done-when",
  (release: string) => {
    test("the rig held everything it set out to", () => {
      const verdict: string = fs.readFileSync(
        path.join(FIXTURES, release, "checks", "verdict.txt"),
        "utf8",
      );

      expect(verdict).not.toContain("MISSED");
      expect(verdict).toContain("HELD");
    });

    test("nova-scheduler stopped fails at the wait for ACTIVE, and says what Nova said", () => {
      const run: OpenStackLifecycleRun = runOf(release, "scheduler-stopped");

      expect(run.status).toBe("Failed");
      expect(run.failedStep).toBe(OpenStackLifecycleStep.ServerActive);
      expect(run.fault?.source).toBe("nova");
      expect(run.fault?.message).toBeTruthy();
      // It got as far as it should have, and cleared up after itself.
      expect(stepNamed(run, OpenStackLifecycleStep.ServerCreate)?.status).toBe(
        "Passed",
      );
      expect(stepNamed(run, OpenStackLifecycleStep.ServerDelete)?.status).toBe(
        "Passed",
      );
      expect(run.leftoverCount).toBe(0);
    });

    test("the incident names the step, and Nova's words", () => {
      const run: OpenStackLifecycleRun = runOf(release, "scheduler-stopped");
      const findings: OpenStackCheckFindings | null = getOpenStackCheckFindings(
        {
          labels: { [OPENSTACK_REGION_ATTRIBUTE]: REGION },
          metricNames: [OpenStackCheckMetric.LifecyclePhaseSuccess],
          lifecycleRecords: mergeOpenStackLifecycleRuns({
            records: {},
            runs: [run],
          }),
        },
      );

      expect(findings).not.toBeNull();

      const markdown: string = openStackCheckFindingsToMarkdown(
        findings as OpenStackCheckFindings,
      ).toString();

      expect(markdown).toContain("Wait for ACTIVE");
      expect(markdown).toContain("Nova said");
      expect(markdown).toContain(REGION);
      // In its words, as far as text from outside is left as it is.
      expect(markdown).toContain(
        (run.fault?.message as string).split(" ").slice(0, 2).join(" "),
      );
    });

    test("Instance Boot Failing opens on the failed run and closes on the next good one", async () => {
      const timeline: Timeline = timelineOf(release);
      const steps: Array<TemplateWalkStep> = await walk(
        "openstack-instance-boot-failing",
        timeline,
      );

      const fired: TemplateWalkStep | undefined = steps.find(
        (step: TemplateWalkStep): boolean => {
          return step.breached;
        },
      );

      expect(fired).toBeDefined();
      expect(minuteOf(fired as TemplateWalkStep)).toBeGreaterThanOrEqual(
        timeline.failedAt,
      );
      expect(minuteOf(fired as TemplateWalkStep)).toBeLessThanOrEqual(
        timeline.failedAt + WINDOW_MINUTES + 1,
      );

      const recovered: TemplateWalkStep | undefined = steps.find(
        (step: TemplateWalkStep): boolean => {
          return step.healthy && step.atMs > (fired as TemplateWalkStep).atMs;
        },
      );

      expect(recovered).toBeDefined();
      expect(minuteOf(recovered as TemplateWalkStep)).toBeGreaterThan(
        timeline.recoveredAt,
      );
      expect(minuteOf(recovered as TemplateWalkStep)).toBeLessThanOrEqual(
        timeline.recoveredAt + WINDOW_MINUTES + 1,
      );

      // Between them it stays open: the same incident, not one a run.
      for (const step of steps) {
        const minute: number = minuteOf(step);

        if (
          minute >= minuteOf(fired as TemplateWalkStep) &&
          minute <= timeline.recoveredAt
        ) {
          expect({ minute, breached: step.breached }).toEqual({
            minute,
            breached: true,
          });
        }
      }

      // And nothing fires on a healthy cloud before it, or again after it.
      for (const step of steps) {
        const minute: number = minuteOf(step);

        if (
          minute < timeline.failedAt ||
          minute >= minuteOf(recovered as TemplateWalkStep)
        ) {
          expect({ minute, breached: step.breached }).toEqual({
            minute,
            breached: false,
          });
        }
      }
    });

    test.each([
      {
        scene: "volume-stopped",
        fires: "openstack-volume-attach-failing",
        step: "Create a volume",
        says: "Cinder said",
      },
      {
        scene: "gateway-removed",
        fires: "openstack-floating-ip-unreachable",
        step: "Attach a floating IP",
        says: "Neutron said",
      },
    ])(
      "$scene opens its own template, names the step and who said what, and the boot's stays quiet",
      async (data: {
        scene: string;
        fires: string;
        step: string;
        says: string;
      }) => {
        const timeline: Timeline = timelineOf(release, data.scene, "recovered");
        const fired: Array<TemplateWalkStep> = await walk(data.fires, timeline);
        const boot: Array<TemplateWalkStep> = await walk(
          "openstack-instance-boot-failing",
          timeline,
        );

        expect(
          fired.some((step: TemplateWalkStep): boolean => {
            return step.breached;
          }),
        ).toBe(true);
        expect(
          boot.some((step: TemplateWalkStep): boolean => {
            return step.breached;
          }),
        ).toBe(false);

        const markdown: string = openStackCheckFindingsToMarkdown(
          getOpenStackCheckFindings({
            labels: { [OPENSTACK_REGION_ATTRIBUTE]: REGION },
            metricNames: [OpenStackCheckMetric.LifecyclePhaseSuccess],
            lifecycleRecords: mergeOpenStackLifecycleRuns({
              records: {},
              runs: [runOf(release, data.scene)],
            }),
          }) as OpenStackCheckFindings,
        ).toString();

        expect(markdown).toContain(data.step);
        expect(markdown).toContain(data.says);
      },
    );

    test("a healthy cloud's API check says all is well, and a refusal by policy is an answer", () => {
      const result: OpenStackApiCheckResult = JSON.parse(
        fs.readFileSync(
          path.join(FIXTURES, release, "checks", "api-healthy", "report.json"),
          "utf8",
        ),
      ) as OpenStackApiCheckResult;

      expect(result.token.status).toBe("Passed");
      expect(
        result.services.filter(
          (service: OpenStackApiServiceResult): boolean => {
            return service.outcome === "Failing";
          },
        ),
      ).toEqual([]);

      const points: ReturnType<typeof getOpenStackApiCheckPoints> =
        getOpenStackApiCheckPoints({ result: result, now: START_MS });

      for (const point of points) {
        if (
          point.metric === OpenStackCheckMetric.TokenSuccess ||
          point.metric === OpenStackCheckMetric.ApiSuccess
        ) {
          expect({ metric: point.metric, value: point.value }).toEqual({
            metric: point.metric,
            value: 1,
          });
        }
      }

      // It went over the real transport only on the entry with TLS, and read a real certificate there.
      if (release === "hibiscus-ovn") {
        expect(result.certificates.length).toBeGreaterThan(0);
        expect(
          points.some((point: { metric: string; value: number }): boolean => {
            return (
              point.metric === OpenStackCheckMetric.CertificateExpiry &&
              point.value > 30
            );
          }),
        ).toBe(true);
      }
    });

    test("a run a dead one might still be is skipped, and touches nothing", () => {
      const skipped: OpenStackLifecycleRun = runOf(
        release,
        "killed-next-at-once",
      );

      expect(skipped.status).toBe("Skipped");
      expect(skipped.writeCount).toBe(0);
    });

    test("an interval on, a run goes ahead and leaves what is not yet old enough", () => {
      const run: OpenStackLifecycleRun = runOf(
        release,
        "killed-an-interval-on",
      );

      expect(run.status).toBe("Succeeded");
      expect(run.janitor?.removed).toEqual([]);
      expect(run.janitor?.remainingCount).toBeGreaterThan(0);
    });

    test("past two intervals the janitor removes what the killed run left, and only that", () => {
      const run: OpenStackLifecycleRun = runOf(
        release,
        "killed-two-intervals-on",
      );

      expect(run.status).toBe("Succeeded");
      expect(run.janitor?.removed.length).toBeGreaterThan(0);

      for (const removed of run.janitor
        ?.removed as Array<OpenStackCheckRemovedResource>) {
        expect(parseOpenStackCheckName(removed.name)).not.toBeNull();
        // Named for this check, and never what merely looks like it.
        expect(removed.name).not.toContain("20200101000000");
        expect(removed.ageInMinutes).toBeGreaterThan(2 * INTERVAL_IN_MINUTES);
      }
    });

    test.each([
      "refused-scoped-elsewhere",
      "refused-admin",
      "refused-unrestricted",
    ])("%s: refused, with nothing written", (scene: string) => {
      const run: OpenStackLifecycleRun = readScene(release, scene)[0]!;

      expect(run.status).toBe("Refused");
      expect(run.writeCount).toBe(0);
      expect(run.message).toBeTruthy();

      const requests: Array<{ method: string }> = fs
        .readFileSync(
          path.join(FIXTURES, release, "checks", scene, "requests.jsonl"),
          "utf8",
        )
        .split("\n")
        .filter(Boolean)
        .map((line: string): { method: string } => {
          return JSON.parse(line) as { method: string };
        });

      // The login is the one POST there is.
      expect(
        requests.filter((request: { method: string }): boolean => {
          return request.method !== "GET" && request.method !== "POST";
        }),
      ).toEqual([]);
      expect(
        requests.filter((request: { method: string }): boolean => {
          return request.method === "POST";
        }).length,
      ).toBeLessThanOrEqual(1);
    });

    test("the check's credential could write only in its own project", () => {
      const attempts: Array<{ write: string; status: number; wrote: boolean }> =
        (
          JSON.parse(
            fs.readFileSync(
              path.join(FIXTURES, release, "checks", "writes.json"),
              "utf8",
            ),
          ) as {
            writes: Array<{ write: string; status: number; wrote: boolean }>;
          }
        ).writes;

      expect(attempts.length).toBeGreaterThan(0);

      for (const attempt of attempts) {
        // Asked, and refused: a refused connection would prove nothing.
        expect({ write: attempt.write, wrote: attempt.wrote }).toEqual({
          write: attempt.write,
          wrote: false,
        });
        expect(attempt.status).toBeGreaterThanOrEqual(400);
      }
    });
  },
);
