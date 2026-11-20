import { JSONObject } from "../../../../Types/JSON";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import MonitorRecommendationCatalog from "../../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendation,
  MonitorRecommendationArgs,
} from "../../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import SeriesDebugHints from "../../../../Types/Monitor/SeriesContext/SeriesDebugHints";
import SeriesLabelDisplay, {
  DisplaySeriesLabel,
} from "../../../../Types/Monitor/SeriesContext/SeriesLabelDisplay";
import SeriesContextEnricher from "../../../../Server/Utils/Monitor/SeriesContextEnricher";
import {
  MANAGED_DEVICE_BATTERY_LEVEL_METRIC_NAME,
  MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME,
  MANAGED_DEVICE_SECURITY_PATCH_AGE_METRIC_NAME,
  MANAGED_DEVICE_STORAGE_USED_METRIC_NAME,
} from "../../../../Types/DeviceManagement/ManagedDeviceCheckIn";

/*
 * End-to-end guard on the thing the recommendations exist for: an alert
 * an SRE can act on without opening anything else.
 *
 * Every monitor on the reporting project's alert list was created from a
 * recommendation, and all forty-nine of its alerts read
 *
 *   "[K8s] Pod CPU Saturating Container Limit (>90%) - oneuptime-test -
 *    Pod CPU Saturating Container Limit"
 *
 * with no pod, no container and no node anywhere in the title. Three
 * separate things had to be true for that, and this file asserts all
 * three across EVERY shipped template rather than for one of them:
 *
 *   1. The template groups by enough to identify the thing that broke.
 *   2. Every key it groups by is one the display layer can name, so the
 *      alert says "Pod", not "resource.k8s.pod.name".
 *   3. Rendering the template's own title through the alert-creation path
 *      actually produces a title carrying that identity.
 *
 * It runs against the CATALOG rather than the individual template
 * modules, so a new resource type is covered the day it is registered.
 */

function buildArgs(): MonitorRecommendationArgs {
  return {
    resourceIdentifier: "test-resource",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Test Monitor",
  };
}

interface TemplateCase {
  recommendationId: string;
  monitorType: MonitorType;
  step: MonitorStep;
  groupByKeys: Array<string>;
}

const ALL_TEMPLATE_CASES: Array<TemplateCase> =
  MonitorRecommendationCatalog.getAllRecommendations().map(
    (recommendation: MonitorRecommendation): TemplateCase => {
      const step: MonitorStep = recommendation.getMonitorStep(buildArgs());

      return {
        recommendationId: recommendation.recommendationId,
        monitorType: recommendation.monitorType,
        step,
        groupByKeys: MonitorStep.getGroupByAttributeKeys(step),
      };
    },
  );

const GROUPED_TEMPLATE_CASES: Array<TemplateCase> = ALL_TEMPLATE_CASES.filter(
  (testCase: TemplateCase) => {
    return testCase.groupByKeys.length > 0;
  },
);

/*
 * Stand-in values for a series. Real label values are opaque strings, so
 * a per-key synthetic value is enough to prove the identity reaches the
 * title - and using the key itself as the seed makes a failure message
 * say exactly which label went missing.
 */
function buildSeriesLabels(groupByKeys: Array<string>): JSONObject {
  const labels: JSONObject = {};

  for (const key of groupByKeys) {
    labels[key] = `value-for-${SeriesLabelDisplay.normalizeKey(key)}`;
  }

  return labels;
}

function getCriteriaInstances(
  step: MonitorStep,
): Array<MonitorCriteriaInstance> {
  return step.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || [];
}

describe("Recommendation templates produce debuggable alerts", () => {
  test("the catalog actually has templates to check", () => {
    // A silently-empty catalog would make every test.each below vacuous.
    expect(ALL_TEMPLATE_CASES.length).toBeGreaterThan(50);
    expect(GROUPED_TEMPLATE_CASES.length).toBeGreaterThan(30);
  });

  /*
   * Every Service metric template thresholds a property of ONE process — a
   * heap, an event loop, a thread pool. Ungrouped, the ClickHouse aggregation
   * collapses every replica into a single number: an Avg template on three
   * JVMs at 95/20/20 reads 45 and stays green while one OOM-kills, and a Max
   * template fires without being able to name the replica that broke. That
   * nameless alert is the exact failure this file exists for.
   *
   * The two request-latency percentiles are the only legitimate exemptions:
   * a p95 is the SLO number for the service as a whole, and splitting it per
   * instance makes it a different alert.
   */
  test("service metric templates identify the replica, not just the service", () => {
    const serviceMetricCases: Array<TemplateCase> = ALL_TEMPLATE_CASES.filter(
      (testCase: TemplateCase) => {
        return (
          testCase.recommendationId.startsWith("Service:") &&
          testCase.monitorType === MonitorType.Metrics
        );
      },
    );

    expect(serviceMetricCases.length).toBeGreaterThan(20);

    expect(
      serviceMetricCases
        .filter((testCase: TemplateCase) => {
          return testCase.groupByKeys.length === 0;
        })
        .map((testCase: TemplateCase) => {
          return testCase.recommendationId;
        })
        .sort(),
    ).toEqual(["Service:service-latency-p95", "Service:service-latency-p99"]);

    for (const testCase of serviceMetricCases) {
      if (testCase.groupByKeys.length === 0) {
        continue;
      }

      expect(testCase.groupByKeys).toEqual(["resource.service.instance.id"]);
    }
  });

  describe("every group-by key is a key the alert can name", () => {
    test.each(GROUPED_TEMPLATE_CASES)(
      "$recommendationId",
      (testCase: TemplateCase) => {
        for (const key of testCase.groupByKeys) {
          /*
           * `getFriendlyLabelName` never fails - it falls back to a
           * prettified form of the raw key. That fallback is the right
           * behaviour for a user's own custom attribute, but for a
           * SHIPPED template it means nobody registered the key, and the
           * alert reads "K8s Pod Name: web-1" instead of "Pod: web-1".
           */
          expect(SeriesLabelDisplay.isKnownLabelKey(key)).toBe(true);

          // ...and the registered name is actually usable in a sentence.
          expect(
            SeriesLabelDisplay.getFriendlyLabelName(key).length,
          ).toBeGreaterThan(0);
        }
      },
    );
  });

  describe("every grouped template's alert title names the resource", () => {
    test.each(GROUPED_TEMPLATE_CASES)(
      "$recommendationId",
      (testCase: TemplateCase) => {
        const seriesLabels: JSONObject = buildSeriesLabels(
          testCase.groupByKeys,
        );

        const criteriaInstances: Array<MonitorCriteriaInstance> =
          getCriteriaInstances(testCase.step);

        const alertTitles: Array<string> = criteriaInstances.flatMap(
          (instance: MonitorCriteriaInstance) => {
            return (instance.data?.alerts || []).map(
              (alert: { title: string }) => {
                return alert.title;
              },
            );
          },
        );

        expect(alertTitles.length).toBeGreaterThan(0);

        for (const title of alertTitles) {
          const enriched: string = SeriesContextEnricher.enrichTitle({
            title,
            seriesLabels,
          });

          /*
           * The single most-identifying label must be in the title. The
           * rest are in the description block and the Affected Resource
           * table; the title only has room for the top few.
           */
          const topLabel: DisplaySeriesLabel =
            SeriesLabelDisplay.getDisplayLabels(seriesLabels)[0]!;

          expect(enriched).toContain(topLabel.value);
          expect(enriched).not.toContain("{{");
        }
      },
    );
  });

  describe("every grouped template's alert description carries the full identity", () => {
    test.each(GROUPED_TEMPLATE_CASES)(
      "$recommendationId",
      (testCase: TemplateCase) => {
        const seriesLabels: JSONObject = buildSeriesLabels(
          testCase.groupByKeys,
        );

        const descriptions: Array<string> = getCriteriaInstances(
          testCase.step,
        ).flatMap((instance: MonitorCriteriaInstance) => {
          return (instance.data?.alerts || []).map(
            (alert: { description: string }) => {
              return alert.description;
            },
          );
        });

        for (const description of descriptions) {
          const enriched: string = SeriesContextEnricher.enrichDescription({
            description,
            seriesLabels,
            monitorType: testCase.monitorType,
          });

          // EVERY label, not just the ones that fit in a title.
          for (const label of SeriesLabelDisplay.getDisplayLabels(
            seriesLabels,
          )) {
            expect(enriched).toContain(label.value);
          }
        }
      },
    );
  });

  describe("incident titles get the same treatment as alert titles", () => {
    test.each(GROUPED_TEMPLATE_CASES)(
      "$recommendationId",
      (testCase: TemplateCase) => {
        const seriesLabels: JSONObject = buildSeriesLabels(
          testCase.groupByKeys,
        );

        const incidentTitles: Array<string> = getCriteriaInstances(
          testCase.step,
        ).flatMap((instance: MonitorCriteriaInstance) => {
          return (instance.data?.incidents || []).map(
            (incident: { title: string }) => {
              return incident.title;
            },
          );
        });

        const topLabel: DisplaySeriesLabel =
          SeriesLabelDisplay.getDisplayLabels(seriesLabels)[0]!;

        for (const title of incidentTitles) {
          expect(
            SeriesContextEnricher.enrichTitle({ title, seriesLabels }),
          ).toContain(topLabel.value);
        }
      },
    );
  });

  describe("infrastructure templates hand the engineer a first command", () => {
    /*
     * The monitor types where a read-only inspection command is both
     * universally correct and genuinely the next thing to run. Metrics /
     * IoT / RUM / Service series identify an application-level entity
     * with no such command, and are deliberately excluded rather than
     * given a guess.
     */
    const TYPES_WITH_COMMANDS: Array<MonitorType> = [
      MonitorType.Kubernetes,
      MonitorType.Docker,
      MonitorType.Podman,
      MonitorType.DockerSwarm,
      MonitorType.Host,
      MonitorType.Proxmox,
      MonitorType.OpenStack,
      MonitorType.VMware,
      MonitorType.Ceph,
    ];

    const CASES: Array<TemplateCase> = GROUPED_TEMPLATE_CASES.filter(
      (testCase: TemplateCase) => {
        return TYPES_WITH_COMMANDS.includes(testCase.monitorType);
      },
    );

    test("there are infrastructure templates to check", () => {
      expect(CASES.length).toBeGreaterThan(20);
    });

    test.each(CASES)("$recommendationId", (testCase: TemplateCase) => {
      const commands: Array<string> = SeriesDebugHints.getDebugCommands({
        monitorType: testCase.monitorType,
        seriesLabels: buildSeriesLabels(testCase.groupByKeys),
      }).map((command: { command: string }) => {
        return command.command;
      });

      expect(commands.length).toBeGreaterThan(0);

      for (const command of commands) {
        // No half-filled interpolation reaches a copy-paste button.
        expect(command).not.toMatch(/\s\s/);
        expect(command.trim()).toBe(command);
      }
    });
  });

  /*
   * Not an infrastructure type, but a series that names one machine: Esper
   * Device Stopped Checking In alerts per device (#9835), and the device's
   * last readings - when it went quiet, its alias and its group - are the
   * first thing to look at. Every Esper connection template gets one.
   */
  describe("a managed device's templates hand the engineer a first command", () => {
    const CASES: Array<TemplateCase> = GROUPED_TEMPLATE_CASES.filter(
      (testCase: TemplateCase) => {
        return testCase.recommendationId.startsWith(
          "DeviceManagementConnection:",
        );
      },
    );

    test("there are managed device templates to check", () => {
      expect(CASES.length).toBeGreaterThan(0);
    });

    test.each(CASES)("$recommendationId", (testCase: TemplateCase) => {
      const commands: Array<string> = SeriesDebugHints.getDebugCommands({
        monitorType: testCase.monitorType,
        seriesLabels: buildSeriesLabels(testCase.groupByKeys),
      }).map((command: { command: string }) => {
        return command.command;
      });

      expect(commands.length).toBeGreaterThan(0);

      for (const command of commands) {
        expect(command.startsWith("oneuptime metric list ")).toBe(true);
        expect(command).not.toMatch(/\s\s/);
        expect(command.trim()).toBe(command);
      }
    });

    /*
     * #10209: a device series is named the same whichever template it is
     * of, so the commands follow the metric the monitor's step reads. A Low
     * Battery alert's first - and only - step lists the device's battery,
     * a Security Patch Out of Date alert's its patch age: never another
     * reading's command, and never the check-ins first.
     */
    const DEVICE_READINGS: Array<string> = [
      MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME,
      MANAGED_DEVICE_BATTERY_LEVEL_METRIC_NAME,
      MANAGED_DEVICE_STORAGE_USED_METRIC_NAME,
      MANAGED_DEVICE_SECURITY_PATCH_AGE_METRIC_NAME,
    ];

    function metricsListedBy(commands: Array<string>): Array<string> {
      return commands.map((command: string): string => {
        const quoted: RegExpMatchArray | null = command.match(
          /^oneuptime metric list --query '(.*)' --sort/,
        );

        expect(quoted).not.toBeNull();

        return (
          JSON.parse(quoted![1]!.split(`'\\''`).join("'")) as { name: string }
        ).name;
      });
    }

    test.each(CASES)(
      "$recommendationId's first step holds only its own reading's command",
      (testCase: TemplateCase) => {
        const ownMetrics: Array<string> = SeriesDebugHints.getMetricNamesOfView(
          MonitorStep.getMetricsViewConfig(testCase.step),
        );
        const commands: Array<string> = SeriesDebugHints.getDebugCommands({
          monitorType: testCase.monitorType,
          seriesLabels: buildSeriesLabels(testCase.groupByKeys),
          metricNames: ownMetrics,
        }).map((command: { command: string }) => {
          return command.command;
        });

        expect(commands).toHaveLength(1);
        expect(ownMetrics).toContain(metricsListedBy(commands)[0]);

        // Of the four a device's readings are, the one its monitor reads.
        if (DEVICE_READINGS.includes(ownMetrics[0]!)) {
          expect(metricsListedBy(commands)).toEqual([ownMetrics[0]]);
        }
      },
    );

    test.each(CASES)(
      "$recommendationId's alert description carries that command alone, as its monitor writes it",
      (testCase: TemplateCase) => {
        const metricNames: Array<string> =
          SeriesDebugHints.getMetricNamesOfView(
            MonitorStep.getMetricsViewConfig(testCase.step),
          );

        for (const instance of getCriteriaInstances(testCase.step)) {
          for (const alert of instance.data?.alerts || []) {
            const enriched: string = SeriesContextEnricher.enrichDescription({
              description: alert.description,
              seriesLabels: buildSeriesLabels(testCase.groupByKeys),
              monitorType: testCase.monitorType,
              metricNames,
            });
            const listed: Array<string> = DEVICE_READINGS.filter(
              (metricName: string): boolean => {
                return enriched.includes(`"name":"${metricName}"`);
              },
            );

            expect(enriched.split("oneuptime metric list").length - 1).toBe(1);
            expect(listed).toEqual(
              DEVICE_READINGS.includes(metricNames[0]!) ? [metricNames[0]] : [],
            );
          }
        }
      },
    );

    test("a device series whose monitor is not known keeps every reading's command, check-ins first", () => {
      const commands: Array<string> = SeriesDebugHints.getDebugCommands({
        monitorType: MonitorType.Metrics,
        seriesLabels: { "oneuptime.managed_device.name": "ESP-ID-AAAAW" },
      }).map((command: { command: string }) => {
        return command.command;
      });

      expect(metricsListedBy(commands)).toEqual(DEVICE_READINGS);
    });
  });

  describe("ungrouped templates stay untouched", () => {
    const UNGROUPED: Array<TemplateCase> = ALL_TEMPLATE_CASES.filter(
      (testCase: TemplateCase) => {
        return testCase.groupByKeys.length === 0;
      },
    );

    test("some templates are legitimately whole-resource", () => {
      /*
       * etcd leadership, API server throttling, scheduler backlog: one
       * value for the cluster. If this ever hits zero, something has
       * started inventing series that do not exist.
       */
      expect(UNGROUPED.length).toBeGreaterThan(0);
    });

    test.each(UNGROUPED)(
      "$recommendationId keeps its title verbatim",
      (testCase: TemplateCase) => {
        for (const instance of getCriteriaInstances(testCase.step)) {
          for (const alert of instance.data?.alerts || []) {
            expect(
              SeriesContextEnricher.enrichTitle({
                title: alert.title,
                seriesLabels: {},
              }),
            ).toBe(alert.title);
          }
        }
      },
    );
  });
});
