import {
  KubernetesMetricCategory,
  KubernetesMetricDefinition,
  getAllKubernetesMetricCategories,
  getAllKubernetesMetrics,
  getKubernetesMetricById,
  getKubernetesMetricByMetricName,
  getKubernetesMetricCategoryLabel,
  getKubernetesMetricsByCategory,
} from "../../../Types/Monitor/KubernetesMetricCatalog";
import {
  KUBERNETES_WORKLOAD_KINDS,
  KubernetesResourceScope,
  MonitorStepKubernetesMonitorUtil,
} from "../../../Types/Monitor/MonitorStepKubernetesMonitor";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import MetricValueFormatter from "../../../Utils/Monitor/MetricValueFormatter";
import {
  AGENT_COLLECTOR_IMAGE_TAG,
  AGENT_EMITTED_METRIC_NAMES,
  readAgentChartValues,
} from "./Utils/KubernetesAgentEmittedMetrics";
import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";

describe("KubernetesMetricCatalog", () => {
  const allMetrics: Array<KubernetesMetricDefinition> =
    getAllKubernetesMetrics();
  const allCategories: Array<KubernetesMetricCategory> =
    getAllKubernetesMetricCategories();
  const validAggregations: Array<string> = Object.values(AggregationType);

  test("returns a non-empty catalog", () => {
    expect(Array.isArray(allMetrics)).toBe(true);
    expect(allMetrics.length).toBeGreaterThan(0);
  });

  test("every metric definition has all required non-empty fields", () => {
    for (const metric of allMetrics) {
      expect(typeof metric.id).toBe("string");
      expect(metric.id.length).toBeGreaterThan(0);
      expect(metric.friendlyName.length).toBeGreaterThan(0);
      expect(metric.description.length).toBeGreaterThan(0);
      expect(metric.metricName.length).toBeGreaterThan(0);
      expect(metric.category.length).toBeGreaterThan(0);
    }
  });

  test("every metric uses a valid aggregation type", () => {
    for (const metric of allMetrics) {
      expect(validAggregations).toContain(metric.defaultAggregation);
    }
  });

  test("metric ids are unique", () => {
    const ids: Array<string> = allMetrics.map(
      (m: KubernetesMetricDefinition) => {
        return m.id;
      },
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("metric names are unique", () => {
    const names: Array<string> = allMetrics.map(
      (m: KubernetesMetricDefinition) => {
        return m.metricName;
      },
    );
    expect(new Set(names).size).toBe(names.length);
  });

  test("every metric category is a declared category", () => {
    for (const metric of allMetrics) {
      expect(allCategories).toContain(metric.category);
    }
  });

  test("declared categories are unique and non-empty", () => {
    expect(allCategories.length).toBeGreaterThan(0);
    expect(new Set(allCategories).size).toBe(allCategories.length);
  });

  test("every declared category has at least one metric", () => {
    for (const category of allCategories) {
      expect(getKubernetesMetricsByCategory(category).length).toBeGreaterThan(
        0,
      );
    }
  });

  test("getKubernetesMetricsByCategory returns only metrics of that category", () => {
    for (const category of allCategories) {
      for (const metric of getKubernetesMetricsByCategory(category)) {
        expect(metric.category).toBe(category);
      }
    }
  });

  test("getKubernetesMetricById round-trips every metric", () => {
    for (const metric of allMetrics) {
      expect(getKubernetesMetricById(metric.id)).toEqual(metric);
    }
  });

  test("getKubernetesMetricById returns undefined for an unknown id", () => {
    expect(getKubernetesMetricById("does-not-exist")).toBeUndefined();
    expect(getKubernetesMetricById("")).toBeUndefined();
  });

  test("getKubernetesMetricByMetricName round-trips every metric", () => {
    for (const metric of allMetrics) {
      expect(getKubernetesMetricByMetricName(metric.metricName)).toEqual(
        metric,
      );
    }
  });

  test("getKubernetesMetricByMetricName returns undefined for an unknown name", () => {
    expect(getKubernetesMetricByMetricName("nope.nope.nope")).toBeUndefined();
  });

  test("known metrics are present", () => {
    expect(
      getKubernetesMetricByMetricName("k8s.pod.cpu.utilization"),
    ).toBeDefined();
    expect(
      getKubernetesMetricByMetricName("k8s.pod.memory.usage"),
    ).toBeDefined();
  });

  /*
   * The catalog's `unit` is rendered straight into the metric picker's
   * dropdown label (`${friendlyName} (${unit})`), and its `description`
   * into the help text below it. Both used to claim `k8s.*.cpu.utilization`
   * was a percentage. It is not: kubeletstats emits it as CPU *cores in
   * use* (UsageNanoCores / 1e9) carrying UCUM unit "1". A user who read
   * "(%)" and typed 90 built a monitor comparing 90 against values around
   * 0.18 — a silently dead monitor with no error surfaced anywhere.
   */
  describe("the kubeletstats cores gauges are not labelled as percentages", () => {
    const coresGaugeNamePattern: RegExp = /\.cpu\.utilization$/i;

    const coresGauges: Array<KubernetesMetricDefinition> = allMetrics.filter(
      (m: KubernetesMetricDefinition) => {
        return coresGaugeNamePattern.test(m.metricName);
      },
    );

    test("the catalog still carries both of them", () => {
      expect(coresGauges.length).toBeGreaterThan(0);
    });

    test("no .cpu.utilization entry declares a percent unit", () => {
      for (const metric of coresGauges) {
        expect(metric.unit).not.toBe("%");
        expect(metric.unit).not.toBe("percent");
      }
    });

    test("no .cpu.utilization description calls the value a percentage", () => {
      /*
       * The unit was only half the lie — the description said "CPU usage
       * percentage for pods" too, and a unit-only assertion would miss it.
       * The word may still appear while explaining how to DERIVE one, so
       * the guard is on the claim, not the word.
       */
      for (const metric of coresGauges) {
        expect(metric.description.toLowerCase()).not.toContain(
          "usage percentage",
        );
        expect(metric.description.toLowerCase()).toContain("cores");
      }
    });

    test("both cores gauges are declared in cores", () => {
      expect(
        getKubernetesMetricByMetricName("k8s.pod.cpu.utilization")?.unit,
      ).toBe("cores");
      expect(
        getKubernetesMetricByMetricName("k8s.node.cpu.utilization")?.unit,
      ).toBe("cores");
    });

    test("the friendlyName does not repeat the unit the picker appends", () => {
      /*
       * KubernetesMetricPicker builds its label as
       * `${friendlyName}${unit ? ` (${unit})` : ""}`. A friendlyName of
       * "Pod CPU Usage (Cores)" would render "Pod CPU Usage (Cores) (cores)".
       */
      for (const metric of allMetrics) {
        if (!metric.unit) {
          continue;
        }
        expect(metric.friendlyName.toLowerCase()).not.toContain(
          `(${metric.unit.toLowerCase()})`,
        );
      }
    });
  });

  /*
   * "Node Disk I/O" was wired to `k8s.node.filesystem.available` — free
   * space remaining, not I/O. A user alerting on node disk activity built
   * a "greater than" monitor on headroom, which fires when the disk is
   * EMPTY and stays silent as it fills.
   */
  describe("entries are named for the metric they are actually wired to", () => {
    test("the mislabelled Node Disk I/O entry is gone", () => {
      expect(getKubernetesMetricById("node-disk-io")).toBeUndefined();
    });

    test("it is replaced by an honest free-space entry", () => {
      const entry: KubernetesMetricDefinition | undefined =
        getKubernetesMetricById("node-filesystem-available");

      expect(entry).toBeDefined();
      expect(entry?.metricName).toBe("k8s.node.filesystem.available");
      expect(entry?.friendlyName).toBe("Node Filesystem Available");
      // Headroom alerts ask "how low did it get", not "what was the mean".
      expect(entry?.defaultAggregation).toBe(AggregationType.Min);
    });

    test("no throughput-sounding name points at a level/limit gauge", () => {
      /*
       * The generalised guard: catches the NEXT entry named for one thing
       * and wired to another, rather than just this one.
       */
      const throughputSoundingName: RegExp = /disk i\/o|network|throughput/i;

      for (const metric of allMetrics) {
        if (throughputSoundingName.test(metric.friendlyName)) {
          expect(metric.metricName).not.toMatch(
            /\.(available|capacity|limit|request)$/,
          );
        }
      }
    });
  });

  /*
   * DashboardTemplates documents this trap after being bitten by it: these
   * are per-resource gauges that re-emit on every scrape, so summing across
   * the window multiplies (resources x scrapes) and produces numbers in the
   * hundreds for a tiny cluster. `k8s.pod.phase` is worse still — its value
   * is an enum code (1 = Pending ... 5 = Unknown), so a Sum is an arithmetic
   * total of category labels.
   */
  describe("categorical and cumulative gauges are never summed", () => {
    test("k8s.pod.phase does not default to Sum", () => {
      const phase: KubernetesMetricDefinition | undefined =
        getKubernetesMetricByMetricName("k8s.pod.phase");

      expect(phase).toBeDefined();
      expect(phase?.defaultAggregation).not.toBe(AggregationType.Sum);
      // A phase code is dimensionless; "count" was the wrong dimension.
      expect(phase?.unit).not.toBe("count");
    });

    test("no state/phase/condition gauge defaults to Sum", () => {
      const describesAState: RegExp = /\bphase\b|\bcondition\b|\bstate\b|1 = /i;

      for (const metric of allMetrics) {
        if (describesAState.test(metric.description)) {
          expect(metric.defaultAggregation).not.toBe(AggregationType.Sum);
        }
      }
    });

    test("no cumulative counter defaults to Sum", () => {
      const describesACounter: RegExp = /cumulative/i;

      for (const metric of allMetrics) {
        if (describesACounter.test(metric.description)) {
          expect(metric.defaultAggregation).not.toBe(AggregationType.Sum);
        }
      }
    });
  });

  /*
   * KubernetesMetricDefinition has no field for a datapoint-attribute
   * filter, and KubernetesMonitorStepForm passes none, so every entry
   * queries EVERY series of its metric. "Pod Network Receive" therefore
   * summed receive AND transmit together over a cumulative counter —
   * roughly double the real receive volume, and a chatty transmitter
   * tripping a receive threshold it never crossed.
   */
  describe("no entry promises a filter the definition cannot express", () => {
    test("the undeliverable directional entry is gone", () => {
      expect(getKubernetesMetricById("pod-network-io-receive")).toBeUndefined();
      expect(getKubernetesMetricById("pod-network-io")).toBeDefined();
    });

    test("no friendlyName claims a direction while carrying no filter", () => {
      /*
       * Becomes a real per-entry filter check the moment an optional
       * `attributes` field lands on KubernetesMetricDefinition.
       */
      const hasAttributeFilterField: boolean = allMetrics.some(
        (m: KubernetesMetricDefinition) => {
          return (
            (m as KubernetesMetricDefinition & { attributes?: unknown })
              .attributes !== undefined
          );
        },
      );

      if (hasAttributeFilterField) {
        return;
      }

      for (const metric of allMetrics) {
        expect(metric.friendlyName).not.toMatch(
          /\b(receive|transmit|ingress|egress)\b/i,
        );
      }
    });
  });

  /*
   * The catalog's `unit` is what an incident email prints next to a value
   * in its "Affected Resources" list. An entry that carries a physical
   * quantity without declaring it sends the reader a bare
   * `257760964608` where "258 GB" was meant. These rules are keyed on the
   * metric NAME, so an entry added later is held to them automatically.
   *
   * The one exception on both rules is a kubeletstats `*_utilization`
   * (underscore) metric: usage divided by a limit or request, a 0-1 ratio
   * that renders as a percentage. The dot-spelled `*.cpu.utilization`
   * gauges are NOT ratios — they are misnamed cores gauges — and are held
   * to the cores rule like any other CPU metric.
   */
  describe("physical quantities carry their unit", () => {
    const utilizationRatioName: RegExp = /_utilization$/;
    const byteQuantityName: RegExp = /memory|filesystem|_bytes$/;
    const cpuQuantityName: RegExp = /cpu/;

    const isUtilizationRatio: (metricName: string) => boolean = (
      metricName: string,
    ): boolean => {
      return utilizationRatioName.test(metricName);
    };

    const isByteQuantity: (metricName: string) => boolean = (
      metricName: string,
    ): boolean => {
      return byteQuantityName.test(metricName);
    };

    const isCpuQuantity: (metricName: string) => boolean = (
      metricName: string,
    ): boolean => {
      return cpuQuantityName.test(metricName);
    };

    test("the rules below match real entries (guards the guard)", () => {
      const names: Array<string> = allMetrics.map(
        (m: KubernetesMetricDefinition) => {
          return m.metricName;
        },
      );

      expect(names.filter(isByteQuantity).length).toBeGreaterThanOrEqual(8);
      expect(names.filter(isCpuQuantity).length).toBeGreaterThanOrEqual(6);
      expect(names.filter(isUtilizationRatio).length).toBeGreaterThanOrEqual(2);
    });

    test("every memory / filesystem / *_bytes metric is in bytes", () => {
      for (const metric of allMetrics) {
        if (
          !isByteQuantity(metric.metricName) ||
          isUtilizationRatio(metric.metricName)
        ) {
          continue;
        }

        expect({ metricName: metric.metricName, unit: metric.unit }).toEqual({
          metricName: metric.metricName,
          unit: "bytes",
        });
      }
    });

    test("every CPU usage / allocatable / request / limit metric is in cores", () => {
      for (const metric of allMetrics) {
        if (
          !isCpuQuantity(metric.metricName) ||
          isUtilizationRatio(metric.metricName)
        ) {
          continue;
        }

        expect({ metricName: metric.metricName, unit: metric.unit }).toEqual({
          metricName: metric.metricName,
          unit: "cores",
        });
      }
    });

    test("every *_utilization metric is a ratio, never a percent", () => {
      for (const metric of allMetrics) {
        if (!isUtilizationRatio(metric.metricName)) {
          continue;
        }

        /*
         * "ratio" is what MetricValueFormatter turns into a percentage on a
         * `_utilization` name. "%" would print 0.93 as "0.93%".
         */
        expect({ metricName: metric.metricName, unit: metric.unit }).toEqual({
          metricName: metric.metricName,
          unit: "ratio",
        });
      }
    });
  });

  /*
   * etcd, the API server and the scheduler are scraped as Prometheus
   * metrics and are one cluster-wide signal each, so they get a category
   * of their own and the Cluster scope.
   */
  describe("control-plane metrics", () => {
    test("have a category of their own", () => {
      expect(allCategories).toContain("ControlPlane");
      expect(
        getKubernetesMetricsByCategory("ControlPlane")
          .map((m: KubernetesMetricDefinition) => {
            return m.metricName;
          })
          .sort(),
      ).toEqual([
        "apiserver_current_inflight_requests",
        "etcd_server_has_leader",
        "scheduler_pending_pods",
      ]);
    });

    /*
     * The category value matches the alert templates' "ControlPlane"; the
     * metric picker titles its group with the label, not the identifier.
     */
    test("are titled 'Control Plane' in a picker, other categories as-is", () => {
      expect(getKubernetesMetricCategoryLabel("ControlPlane")).toBe(
        "Control Plane",
      );

      for (const category of allCategories) {
        if (category !== "ControlPlane") {
          expect(getKubernetesMetricCategoryLabel(category)).toBe(category);
        }
      }
    });

    test("are scoped to the whole cluster", () => {
      for (const metric of getKubernetesMetricsByCategory("ControlPlane")) {
        expect(metric.defaultResourceScope).toBe(
          KubernetesResourceScope.Cluster,
        );
      }
    });

    test("etcd leadership is a flag with no unit, watched at its minimum", () => {
      const hasLeader: KubernetesMetricDefinition | undefined =
        getKubernetesMetricByMetricName("etcd_server_has_leader");

      expect(hasLeader?.unit).toBe("");
      expect(hasLeader?.defaultAggregation).toBe(AggregationType.Min);
    });
  });

  /*
   * What the entries the alert templates were missing look like in a
   * notification, through the same formatter the incident email uses.
   */
  describe("the entries the alert templates needed render human-readable", () => {
    function formatFor(metricName: string, value: number): string {
      const entry: KubernetesMetricDefinition | undefined =
        getKubernetesMetricByMetricName(metricName);

      expect(entry).toBeDefined();

      return MetricValueFormatter.format({
        value: value,
        unit: entry!.unit,
        metricName: entry!.metricName,
      });
    }

    test("allocatable memory reads in GB, not as twelve digits", () => {
      expect(formatFor("k8s.node.allocatable_memory", 257760964608)).toBe(
        "258 GB",
      );
      expect(formatFor("k8s.node.allocatable_memory", 8235155456)).toBe(
        "8.24 GB",
      );
    });

    test("allocatable CPU reads in cores", () => {
      expect(formatFor("k8s.node.allocatable_cpu", 31.85)).toBe("31.85 cores");
      expect(formatFor("k8s.node.allocatable_cpu", 4)).toBe("4 cores");
    });

    test("the pod limit utilizations read as a percentage of the limit", () => {
      expect(formatFor("k8s.pod.memory_limit_utilization", 0.93)).toBe(
        "93.00%",
      );
      expect(formatFor("k8s.pod.cpu_limit_utilization", 0.5)).toBe("50.00%");
    });

    test("the control-plane flag and counts stay bare numbers", () => {
      expect(formatFor("etcd_server_has_leader", 0)).toBe("0");
      expect(formatFor("etcd_server_has_leader", 1)).toBe("1");
      expect(formatFor("apiserver_current_inflight_requests", 212)).toBe("212");
      expect(formatFor("scheduler_pending_pods", 3)).toBe("3");
    });
  });

  /*
   * BUG: the Workload entries were named for the Deployment/StatefulSet
   * STATUS fields — `k8s.deployment.available_replicas`,
   * `.desired_replicas`, `.unavailable_replicas`,
   * `k8s.statefulset.ready_replicas` — but the agent's k8s_cluster receiver
   * emits `k8s.deployment.available`, `k8s.deployment.desired` and
   * `k8s.statefulset.ready_pods`, and no "unavailable" series at all. The
   * chart renames none of them (it renames only kubelet CPU), so every one
   * of those entries charted and alerted on a metric that never arrives: an
   * empty chart, and a monitor that is never Met, with no error anywhere.
   */
  describe("every entry names a metric the shipped agent emits", () => {
    test("the agent chart still pins the collector these names were read from", () => {
      /*
       * The receiver half of AGENT_EMITTED_METRIC_NAMES is the receivers'
       * metadata.yaml at this collector version. Bumping the image fails
       * here until that list is re-read — receivers rename metrics between
       * versions.
       */
      const values: Record<string, any> = readAgentChartValues();

      expect(values["image"]["repository"]).toBe(
        "otel/opentelemetry-collector-contrib",
      );
      expect(String(values["image"]["tag"])).toBe(AGENT_COLLECTOR_IMAGE_TAG);
      // The kubeletstats *_utilization names in the list assume this default.
      expect(values["kubeletstats"]["utilizationMetrics"]["enabled"]).toBe(
        true,
      );
    });

    test.each(
      allMetrics.map((m: KubernetesMetricDefinition) => {
        return [m.id, m.metricName];
      }),
    )("%s queries %s, which the agent emits", (_id: string, name: string) => {
      expect(AGENT_EMITTED_METRIC_NAMES.has(name)).toBe(true);
    });

    test("deployment replica entries use the receiver's names", () => {
      expect(getKubernetesMetricById("deployment-available-replicas")).toEqual(
        expect.objectContaining({ metricName: "k8s.deployment.available" }),
      );
      expect(getKubernetesMetricById("deployment-desired-replicas")).toEqual(
        expect.objectContaining({ metricName: "k8s.deployment.desired" }),
      );
    });

    test("the StatefulSet ready entry uses the receiver's name", () => {
      expect(getKubernetesMetricById("statefulset-ready-replicas")).toEqual(
        expect.objectContaining({ metricName: "k8s.statefulset.ready_pods" }),
      );
    });

    test("no entry offers an unavailable-replicas series the receiver does not have", () => {
      expect(
        getKubernetesMetricById("deployment-unavailable-replicas"),
      ).toBeUndefined();

      for (const metric of allMetrics) {
        expect(metric.metricName).not.toMatch(/unavailable/);
      }
    });
  });

  /*
   * A Custom Metric monitor on the running restart count, with the list's
   * Maximum, fires on a container's history and never recovers. The
   * restarts the agent sends with each sample, summed over the window, are
   * the restarts in it - what CrashLoopBackOff Detection reads.
   */
  describe("the restarts since each sample, beside the running count", () => {
    test("offers them summed, beside the running count it keeps at its maximum", () => {
      expect(
        getKubernetesMetricByMetricName("k8s.container.restarts.increase"),
      ).toEqual(
        expect.objectContaining({
          id: "container-restarts-increase",
          friendlyName: "Container Restarts (Increase)",
          category: "Container",
          defaultAggregation: AggregationType.Sum,
          defaultResourceScope: KubernetesResourceScope.Cluster,
          unit: "count",
        }),
      );
      expect(getKubernetesMetricByMetricName("k8s.container.restarts")).toEqual(
        expect.objectContaining({
          friendlyName: "Container Restarts",
          category: "Container",
          defaultAggregation: AggregationType.Max,
        }),
      );
    });

    test("lists it right after the running count in the picker", () => {
      const names: Array<string> = getKubernetesMetricsByCategory(
        "Container",
      ).map((metric: KubernetesMetricDefinition): string => {
        return metric.metricName;
      });

      expect(names.indexOf("k8s.container.restarts.increase")).toBe(
        names.indexOf("k8s.container.restarts") + 1,
      );
    });

    test("says what a sample's value is, what its sum is, and that it can be scoped to a workload", () => {
      const description: string = getKubernetesMetricByMetricName(
        "k8s.container.restarts.increase",
      )!.description;

      expect(description).toBe(
        "Restarts since the agent's previous sample of the container. Their sum over a window is the restarts in it. Carries its pod's workload names, so it can be scoped to a workload.",
      );
      // Read as a count, with no unit to print.
      expect(
        MetricValueFormatter.format({
          value: 3,
          unit: "count",
          metricName: "k8s.container.restarts.increase",
        }),
      ).toBe("3");
    });

    test("is what the shipped chart's cluster collector makes of k8s.container.restarts", () => {
      const config: string = fs.readFileSync(
        path.resolve(
          __dirname,
          "../../../../../HelmChart/Public/kubernetes-agent/templates/configmap-deployment.yaml",
        ),
        "utf8",
      );

      expect(config).toContain(
        '- set(name, "k8s.container.restarts.increase") where name == "k8s.container.restarts"',
      );
      expect(config).toContain(
        "            - k8s.container.restarts.increase\n          match_type: strict\n        initial_value: drop\n",
      );
    });

    /*
     * A Workload scope filters every query on the workload's name
     * (MonitorStepKubernetesMonitorUtil.getWorkloadNameAttributeKey), and
     * the restarts pipeline has no k8sattributes of its own: the increase
     * gets the names in the metrics pipeline, which the restarts pipeline
     * hands it to once it is made.
     */
    test("carries the workload names a Workload scope filters on, from the metrics pipeline it is handed to", () => {
      const config: string = fs.readFileSync(
        path.resolve(
          __dirname,
          "../../../../../HelmChart/Public/kubernetes-agent/templates/configmap-deployment.yaml",
        ),
        "utf8",
      );
      const pipelines: string = config.substring(
        config.indexOf("      pipelines:\n"),
      );
      const restartsPipeline: string = pipelines.substring(
        pipelines.indexOf("        metrics/restarts-increase:\n"),
      );
      const metricsPipeline: string = pipelines.substring(
        pipelines.indexOf("        metrics:\n"),
        pipelines.indexOf("        logs:\n"),
      );

      expect(restartsPipeline).toContain(
        "          exporters:\n            - forward/restarts-increase\n",
      );
      expect(restartsPipeline).not.toContain("- k8sattributes");
      expect(metricsPipeline).toContain("            - k8s_cluster\n");
      expect(metricsPipeline).toContain(
        "            - forward/restarts-increase\n",
      );
      expect(metricsPipeline).toContain("            - k8sattributes\n");

      // Every kind a Workload Kind can name is a name k8sattributes extracts.
      for (const kind of KUBERNETES_WORKLOAD_KINDS) {
        const key: string | null =
          MonitorStepKubernetesMonitorUtil.getWorkloadNameAttributeKey({
            workloadType: kind.value,
            workloadName: "checkout",
          });

        expect(key).toBe(`resource.k8s.${kind.value}.name`);
        expect(config).toContain(`            - k8s.${kind.value}.name\n`);
      }
    });
  });

  /*
   * The same for Jobs: a Custom Metric monitor on the Job's running
   * failed-pod count, with the list's Maximum, fires on a Job's history and
   * stays open until the Job is deleted. The failed pods the agent sends
   * with each sample, summed over the window, are the failures in it - what
   * Job Failures reads.
   */
  describe("the Job failures since each sample, beside the running count", () => {
    test("offers them summed, beside the running count it keeps at its maximum", () => {
      expect(
        getKubernetesMetricByMetricName("k8s.job.failed_pods.increase"),
      ).toEqual(
        expect.objectContaining({
          id: "job-failed-pods-increase",
          friendlyName: "Job Failed Pods (Increase)",
          category: "Workload",
          defaultAggregation: AggregationType.Sum,
          defaultResourceScope: KubernetesResourceScope.Workload,
          unit: "count",
        }),
      );
      expect(getKubernetesMetricByMetricName("k8s.job.failed_pods")).toEqual(
        expect.objectContaining({
          friendlyName: "Job Failed Pods",
          category: "Workload",
          defaultAggregation: AggregationType.Max,
        }),
      );
      expect(getKubernetesMetricById("job-failed-pods-increase")).toBe(
        getKubernetesMetricByMetricName("k8s.job.failed_pods.increase"),
      );
    });

    test("lists it right after the running count in the picker", () => {
      const names: Array<string> = getKubernetesMetricsByCategory(
        "Workload",
      ).map((metric: KubernetesMetricDefinition): string => {
        return metric.metricName;
      });

      expect(names.indexOf("k8s.job.failed_pods.increase")).toBe(
        names.indexOf("k8s.job.failed_pods") + 1,
      );
    });

    test("says what a sample's value is, what its sum is, and that it can be scoped to a Job", () => {
      const description: string = getKubernetesMetricByMetricName(
        "k8s.job.failed_pods.increase",
      )!.description;

      expect(description).toBe(
        "Pods of the Job that failed since the agent's previous sample of it. Their sum over a window is the failures in it. Carries the Job's name and namespace, so it can be scoped to a Job.",
      );
      // A Workload scope of kind Job filters on the Job's own name.
      expect(
        MonitorStepKubernetesMonitorUtil.getWorkloadNameAttributeKey({
          workloadType: "job",
          workloadName: "nightly-export",
        }),
      ).toBe("resource.k8s.job.name");
      // Read as a count, with no unit to print.
      expect(
        MetricValueFormatter.format({
          value: 2,
          unit: "count",
          metricName: "k8s.job.failed_pods.increase",
        }),
      ).toBe("2");
    });

    test("is what the shipped chart's cluster collector makes of k8s.job.failed_pods", () => {
      const config: string = fs.readFileSync(
        path.resolve(
          __dirname,
          "../../../../../HelmChart/Public/kubernetes-agent/templates/configmap-deployment.yaml",
        ),
        "utf8",
      );

      expect(config).toContain(
        '- copy_metric(name="k8s.job.failed_pods.increase", description="Pods of the Job that failed since the agent\'s previous sample of it.") where name == "k8s.job.failed_pods"',
      );
      expect(config).toContain(
        "            - k8s.job.failed_pods.increase\n          match_type: strict\n        initial_value: drop\n",
      );
    });
  });
});
