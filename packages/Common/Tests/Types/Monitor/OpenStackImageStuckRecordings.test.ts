import { describe, expect, test } from "@jest/globals";
import path from "path";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import {
  OPENSTACK_ANCHOR_METRIC_ALIAS,
  OpenStackAlertTemplateArgs,
  getOpenStackAlertTemplateById,
} from "../../../Types/Monitor/OpenStackAlertTemplates";
import ObjectID from "../../../Types/ObjectID";
import { OPENSTACK_IMAGE_STUCK_MINUTES } from "../../../Types/OpenStack/OpenStackHealthRules";
import {
  RecordedSeries,
  readRecordedSeries,
} from "../../Helpers/OpenStackRecordedRows";
import {
  TemplateWalkStep,
  TimedSample,
  TimedSamplesByAlias,
  walkTemplateCriteria,
} from "./Utils/TemplateCriteriaEvaluation";

/*
 * Image Stuck, on what a real Glance said of a real stuck image: ou-image-stuck, made and never
 * uploaded (Tests/Ops/openstack-e2e/estate.sh), beside an image that's fine. A recording is one
 * moment, so a timeline replays it: what was recorded is what each collection says while that
 * image is there, Glance is collected every five minutes, and one that's deleted has no series.
 */

const FIXTURES: string = path.join(__dirname, "../../Fixtures/OpenStack");
const MINUTE_MS: number = 60000;
const COLLECT_EVERY_MINUTES: number = 5;
const FIRST_COLLECTION_MS: number = Date.UTC(2026, 10, 5, 0, 0, 0);

const ARGS: OpenStackAlertTemplateArgs = {
  cloudIdentifier: "devstack",
  onlineMonitorStatusId: ObjectID.generate(),
  offlineMonitorStatusId: ObjectID.generate(),
  defaultIncidentSeverityId: ObjectID.generate(),
  defaultAlertSeverityId: ObjectID.generate(),
  monitorName: "The recording",
};

interface Walked {
  firedAtMs: number | null;
  recoveredAtMs: number | null;
}

// Every five minutes from that minute to that minute, counted from the first collection.
function collectedBetween(
  value: number,
  fromMinute: number,
  toMinute: number,
): Array<TimedSample> {
  const samples: Array<TimedSample> = [];
  for (
    let minute: number = fromMinute;
    minute <= toMinute;
    minute += COLLECT_EVERY_MINUTES
  ) {
    samples.push({ timeMs: FIRST_COLLECTION_MS + minute * MINUTE_MS, value });
  }
  return samples;
}

describe.each(["hibiscus-ovn", "gazpacho-ovs"])(
  "Image Stuck, on what %s really said",
  (release: string) => {
    const recorded: Array<RecordedSeries> = readRecordedSeries(
      path.join(FIXTURES, release, "compute-forced-down", "exporter"),
    );
    const step: MonitorStep = getOpenStackAlertTemplateById(
      "openstack-image-stuck",
    )!.getMonitorStep(ARGS);
    const queries: Array<MetricQueryConfigData> =
      step.data!.openstackMonitor!.metricViewConfig.queryConfigs;

    function imageNamed(name: string): RecordedSeries {
      return recorded.find((series: RecordedSeries): boolean => {
        return (
          series.name === "openstack_glance_image_created_at" &&
          series.labels["name"] === name
        );
      })!;
    }

    // What each of the template's queries reads of one image's real series, through its filter.
    function walk(data: {
      image: RecordedSeries;
      appearsAtMinute: number;
      goesAtMinute: number;
      endMinute: number;
    }): Promise<Array<TemplateWalkStep>> {
      const samplesByAlias: TimedSamplesByAlias = {};

      for (const query of queries) {
        const alias: string = query.metricAliasData!.metricVariable!;
        const filter: MetricQueryConfigData["metricQueryData"]["filterData"] =
          query.metricQueryData.filterData;

        if (alias === OPENSTACK_ANCHOR_METRIC_ALIAS) {
          const up: RecordedSeries = recorded.find(
            (series: RecordedSeries): boolean => {
              return series.name === filter.metricName;
            },
          )!;
          samplesByAlias[alias] = collectedBetween(up.value, 0, data.endMinute);
          continue;
        }

        const wanted: string = (filter.attributes as Record<string, string>)[
          "status"
        ] as string;

        samplesByAlias[alias] =
          data.image.name === filter.metricName &&
          data.image.labels["status"] === wanted
            ? collectedBetween(
                data.image.value,
                data.appearsAtMinute,
                data.goesAtMinute,
              )
            : [];
      }

      return walkTemplateCriteria({
        step,
        viewConfig: step.data!.openstackMonitor!.metricViewConfig,
        samplesByAlias,
        windowMinutes: OPENSTACK_IMAGE_STUCK_MINUTES,
        startMs: FIRST_COLLECTION_MS,
        endMs: FIRST_COLLECTION_MS + data.endMinute * MINUTE_MS,
      });
    }

    function firedAndRecovered(steps: Array<TemplateWalkStep>): Walked {
      let firedAtMs: number | null = null;
      let recoveredAtMs: number | null = null;
      for (const one of steps) {
        if (firedAtMs === null) {
          firedAtMs = one.breached ? one.atMs : null;
        } else if (recoveredAtMs === null) {
          recoveredAtMs = one.healthy ? one.atMs : null;
        }
      }
      return { firedAtMs, recoveredAtMs };
    }

    test("the recording holds a stuck image, in Glance's word, and one that's fine", () => {
      expect(imageNamed("ou-image-stuck").labels["status"]).toBe("queued");
      expect(
        recorded.filter((series: RecordedSeries): boolean => {
          return (
            series.name === "openstack_glance_image_created_at" &&
            series.labels["status"] === "active"
          );
        }).length,
      ).toBeGreaterThan(0);
    });

    function minutesIn(atMs: number | null): number | null {
      return atMs === null ? null : (atMs - FIRST_COLLECTION_MS) / MINUTE_MS;
    }

    test("an image held in queued fires by name within a collection or so of the hour, and goes when it does", async () => {
      const appearsAtMinute: number = 2 * OPENSTACK_IMAGE_STUCK_MINUTES;
      const goesAtMinute: number = 4 * OPENSTACK_IMAGE_STUCK_MINUTES;
      const walked: Walked = firedAndRecovered(
        await walk({
          image: imageNamed("ou-image-stuck"),
          appearsAtMinute,
          goesAtMinute,
          endMinute: 6 * OPENSTACK_IMAGE_STUCK_MINUTES,
        }),
      );

      expect(minutesIn(walked.firedAtMs)).toBeGreaterThanOrEqual(
        appearsAtMinute +
          OPENSTACK_IMAGE_STUCK_MINUTES -
          2 * COLLECT_EVERY_MINUTES,
      );
      expect(minutesIn(walked.firedAtMs)).toBeLessThanOrEqual(
        appearsAtMinute + OPENSTACK_IMAGE_STUCK_MINUTES + COLLECT_EVERY_MINUTES,
      );

      // Uploaded at last, or deleted: its series goes, and a window on nothing's left of it.
      expect(minutesIn(walked.recoveredAtMs)).toBeGreaterThan(goesAtMinute);
      expect(minutesIn(walked.recoveredAtMs)).toBeLessThanOrEqual(
        goesAtMinute + OPENSTACK_IMAGE_STUCK_MINUTES + COLLECT_EVERY_MINUTES,
      );
    });

    test("an image caught in queued by one collection, as an upload is, raises nothing", async () => {
      const steps: Array<TemplateWalkStep> = await walk({
        image: imageNamed("ou-image-stuck"),
        appearsAtMinute: 2 * OPENSTACK_IMAGE_STUCK_MINUTES,
        goesAtMinute: 2 * OPENSTACK_IMAGE_STUCK_MINUTES,
        endMinute: 4 * OPENSTACK_IMAGE_STUCK_MINUTES,
      });

      expect(firedAndRecovered(steps).firedAtMs).toBeNull();
    });

    test("the image beside it, which is active, never does", async () => {
      const active: RecordedSeries = recorded.find(
        (series: RecordedSeries): boolean => {
          return (
            series.name === "openstack_glance_image_created_at" &&
            series.labels["status"] === "active"
          );
        },
      )!;
      const steps: Array<TemplateWalkStep> = await walk({
        image: active,
        appearsAtMinute: 0,
        goesAtMinute: 4 * OPENSTACK_IMAGE_STUCK_MINUTES,
        endMinute: 4 * OPENSTACK_IMAGE_STUCK_MINUTES,
      });

      expect(firedAndRecovered(steps).firedAtMs).toBeNull();
    });
  },
);
