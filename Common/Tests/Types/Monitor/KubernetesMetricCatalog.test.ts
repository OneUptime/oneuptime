import {
  KubernetesMetricCategory,
  KubernetesMetricDefinition,
  getAllKubernetesMetricCategories,
  getAllKubernetesMetrics,
  getKubernetesMetricById,
  getKubernetesMetricByMetricName,
  getKubernetesMetricsByCategory,
} from "../../../Types/Monitor/KubernetesMetricCatalog";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import { describe, expect, test } from "@jest/globals";

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
});
