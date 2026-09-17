import {
  VMwareMetricCategory,
  VMwareMetricDefinition,
  getAllVMwareMetricCategories,
  getAllVMwareMetrics,
  getVMwareMetricById,
  getVMwareMetricByMetricName,
  getVMwareMetricsByCategory,
} from "../../../Types/Monitor/VMwareMetricCatalog";
import { VMwareResourceScope } from "../../../Types/Monitor/MonitorStepVMwareMonitor";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import { describe, expect, test } from "@jest/globals";

describe("VMwareMetricCatalog", () => {
  const allMetrics: Array<VMwareMetricDefinition> = getAllVMwareMetrics();
  const allCategories: Array<VMwareMetricCategory> =
    getAllVMwareMetricCategories();
  const validAggregations: Array<string> = Object.values(AggregationType);
  const validScopes: Array<string> = Object.values(VMwareResourceScope);

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

  test("every metric uses a valid resource scope", () => {
    for (const metric of allMetrics) {
      expect(validScopes).toContain(metric.defaultResourceScope);
    }
  });

  test("metric ids are unique", () => {
    const ids: Array<string> = allMetrics.map((m: VMwareMetricDefinition) => {
      return m.id;
    });
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("metric names are unique", () => {
    const names: Array<string> = allMetrics.map((m: VMwareMetricDefinition) => {
      return m.metricName;
    });
    expect(new Set(names).size).toBe(names.length);
  });

  test("every metric name follows the vcenter receiver naming scheme", () => {
    for (const metric of allMetrics) {
      /*
       * The OTel vcenter receiver names every metric `vcenter.<object>.*`.
       * A pve_-style or k8s.-style name here would mean a metric was
       * copied from another catalog and would never match a series.
       */
      expect(metric.metricName).toMatch(
        /^vcenter\.(datacenter|cluster|host|vm|datastore|resource_pool)\./,
      );
      expect(metric.id).toMatch(/^vcenter-/);
    }
  });

  test("every metric's scope agrees with the object named in its metric name", () => {
    /*
     * `defaultResourceScope` tells the picker (and the worker) which
     * identity attribute a series carries. The receiver encodes the same
     * fact in the metric name's second segment, so the two must agree — a
     * host metric scoped to VirtualMachine would group by an attribute the
     * series does not have.
     */
    const scopeBySegment: Record<string, VMwareResourceScope> = {
      datacenter: VMwareResourceScope.Datacenter,
      cluster: VMwareResourceScope.Cluster,
      host: VMwareResourceScope.Host,
      vm: VMwareResourceScope.VirtualMachine,
      datastore: VMwareResourceScope.Datastore,
      resource_pool: VMwareResourceScope.ResourcePool,
    };

    for (const metric of allMetrics) {
      const segment: string = metric.metricName.split(".")[1]!;
      expect(metric.defaultResourceScope).toBe(scopeBySegment[segment]);
    }
  });

  test("every metric declares a unit in OTel / UCUM spelling", () => {
    /*
     * The vcenter receiver ships real unit metadata, so the catalog
     * repeats it verbatim rather than in the informal "count"/"ratio"
     * spelling the older catalogs used. MetricValueFormatter's informal
     * aliases are therefore never needed for VMware, and a unit outside
     * this set is a typo.
     */
    const allowedUnits: Set<string> = new Set<string>([
      "MHz",
      "%",
      "MiBy",
      "KiBy",
      "By",
      "By/s",
      "ms",
      "us",
      "{KiBy/s}",
      "{packets/s}",
      "{errors/s}",
      "{operations/s}",
      "{congestions/s}",
      "{shares}",
      "{hosts}",
      "{virtual_machines}",
      "{virtual_machine_templates}",
      "{clusters}",
      "{datastores}",
    ]);

    for (const metric of allMetrics) {
      expect(metric.unit).toBeDefined();
      expect(allowedUnits.has(metric.unit!)).toBe(true);
    }
  });

  test("utilization and readiness metrics are percentages averaged over the window", () => {
    for (const metric of allMetrics) {
      if (
        metric.metricName.endsWith(".utilization") ||
        metric.metricName.endsWith(".readiness") ||
        metric.metricName.endsWith(".hit_rate")
      ) {
        expect(metric.unit).toBe("%");
        expect(metric.defaultAggregation).toBe(AggregationType.Avg);
      }
    }
  });

  test("capacity and limit metrics default to Max, never Sum", () => {
    /*
     * A capacity re-emits on every collection; summing it across the
     * collections in a minute would report (capacity × collections).
     */
    for (const metric of allMetrics) {
      if (
        metric.metricName.endsWith(".limit") ||
        metric.metricName.endsWith(".capacity") ||
        metric.metricName.endsWith(".effective") ||
        metric.metricName.endsWith(".shares")
      ) {
        expect(metric.defaultAggregation).toBe(AggregationType.Max);
      }
    }
  });

  test("count metrics that fan out over an attribute default to Sum", () => {
    /*
     * These are the counts the receiver splits across attribute values
     * (status × power_state, effective). Their natural reading is the
     * total across the fan-out, which is a Sum over the grouped series.
     */
    for (const metricName of [
      "vcenter.datacenter.cluster.count",
      "vcenter.datacenter.host.count",
      "vcenter.datacenter.vm.count",
      "vcenter.cluster.host.count",
      "vcenter.cluster.vm.count",
    ]) {
      expect(getVMwareMetricByMetricName(metricName)?.defaultAggregation).toBe(
        AggregationType.Sum,
      );
    }
  });

  test("every metric description names the datapoint attributes its series carries", () => {
    /*
     * The receiver's metadata.yaml is the source of truth for which
     * datapoint attributes each metric fans out over. A user reading the
     * picker must be told, because filtering `disk_state = used` is the
     * only way to make `vcenter.datastore.disk.usage` mean anything.
     */
    const attributesByMetric: Record<string, Array<string>> = {
      "vcenter.datacenter.cluster.count": ["status"],
      "vcenter.datacenter.disk.space": ["disk_state"],
      "vcenter.datacenter.host.count": ["status", "power_state"],
      "vcenter.datacenter.vm.count": ["status", "power_state"],
      "vcenter.cluster.host.count": ["effective"],
      "vcenter.cluster.vm.count": ["power_state"],
      "vcenter.cluster.vsan.latency.avg": ["type"],
      "vcenter.cluster.vsan.operations": ["type"],
      "vcenter.cluster.vsan.throughput": ["direction"],
      "vcenter.host.cpu.reserved": ["cpu_reservation_type"],
      "vcenter.host.disk.latency.avg": ["direction", "object"],
      "vcenter.host.disk.latency.max": ["object"],
      "vcenter.host.disk.throughput": ["direction", "object"],
      "vcenter.host.network.packet.drop.rate": ["direction", "object"],
      "vcenter.host.network.packet.error.rate": ["direction", "object"],
      "vcenter.host.network.packet.rate": ["direction", "object"],
      "vcenter.host.network.throughput": ["direction", "object"],
      "vcenter.host.network.usage": ["object"],
      "vcenter.host.vsan.latency.avg": ["type"],
      "vcenter.host.vsan.operations": ["type"],
      "vcenter.host.vsan.throughput": ["direction"],
      "vcenter.vm.cpu.time": ["cpu_state", "object"],
      "vcenter.vm.disk.latency.avg": ["direction", "disk_type", "object"],
      "vcenter.vm.disk.latency.max": ["object"],
      "vcenter.vm.disk.throughput": ["direction", "object"],
      "vcenter.vm.disk.usage": ["disk_state"],
      "vcenter.vm.network.broadcast.packet.rate": ["direction", "object"],
      "vcenter.vm.network.multicast.packet.rate": ["direction", "object"],
      "vcenter.vm.network.packet.drop.rate": ["direction", "object"],
      "vcenter.vm.network.packet.rate": ["direction", "object"],
      "vcenter.vm.network.throughput": ["direction", "object"],
      "vcenter.vm.network.usage": ["object"],
      "vcenter.vm.vsan.latency.avg": ["type"],
      "vcenter.vm.vsan.operations": ["type"],
      "vcenter.vm.vsan.throughput": ["direction"],
      "vcenter.datastore.disk.usage": ["disk_state"],
      "vcenter.resource_pool.memory.granted": ["type"],
      "vcenter.resource_pool.memory.usage": ["type"],
    };

    for (const metricName of Object.keys(attributesByMetric)) {
      const metric: VMwareMetricDefinition | undefined =
        getVMwareMetricByMetricName(metricName);
      expect(metric).toBeDefined();

      for (const attribute of attributesByMetric[metricName]!) {
        expect(metric!.description).toContain(`\`${attribute}\``);
      }
    }
  });

  test("metrics disabled by default upstream say so", () => {
    /*
     * These are `enabled: false` in the receiver's metadata.yaml. They are
     * catalogued so the picker documents them, but a user choosing one
     * must be told it needs enabling in the agent config — otherwise the
     * monitor silently never sees data.
     */
    for (const metricName of [
      "vcenter.host.memory.active",
      "vcenter.host.memory.ballooned",
      "vcenter.host.memory.granted",
      "vcenter.vm.cpu.time",
      "vcenter.vm.memory.granted",
      "vcenter.vm.network.broadcast.packet.rate",
      "vcenter.vm.network.multicast.packet.rate",
    ]) {
      const metric: VMwareMetricDefinition | undefined =
        getVMwareMetricByMetricName(metricName);
      expect(metric).toBeDefined();
      expect(metric!.description).toMatch(/disabled by default/i);
    }

    /*
     * vcenter.host.memory.capacity is also off upstream but the OneUptime
     * agent config turns it on (it is the denominator for host memory
     * percentages), so its wording must not tell the user to go and
     * enable it themselves.
     */
    const capacity: VMwareMetricDefinition | undefined =
      getVMwareMetricByMetricName("vcenter.host.memory.capacity");
    expect(capacity).toBeDefined();
    expect(capacity!.description).toMatch(/agent config enables it/i);
  });

  test("every metric category is a declared category", () => {
    for (const metric of allMetrics) {
      expect(allCategories).toContain(metric.category);
    }
  });

  test("declared categories are unique and non-empty", () => {
    expect(allCategories.length).toBeGreaterThan(0);
    expect(new Set(allCategories).size).toBe(allCategories.length);
    expect([...allCategories].sort()).toEqual(
      [
        "Datacenter",
        "Cluster",
        "Host",
        "Virtual Machine",
        "Datastore",
        "Resource Pool",
        "vSAN",
      ].sort(),
    );
  });

  test("every declared category has at least one metric", () => {
    for (const category of allCategories) {
      expect(getVMwareMetricsByCategory(category).length).toBeGreaterThan(0);
    }
  });

  test("getVMwareMetricsByCategory returns only metrics of that category", () => {
    for (const category of allCategories) {
      for (const metric of getVMwareMetricsByCategory(category)) {
        expect(metric.category).toBe(category);
      }
    }
  });

  test("vSAN metrics live in the vSAN category regardless of object", () => {
    for (const metric of allMetrics) {
      if (metric.metricName.includes(".vsan.")) {
        expect(metric.category).toBe("vSAN");
      } else {
        expect(metric.category).not.toBe("vSAN");
      }
    }
  });

  test("getVMwareMetricById round-trips every metric", () => {
    for (const metric of allMetrics) {
      expect(getVMwareMetricById(metric.id)).toEqual(metric);
    }
  });

  test("getVMwareMetricById returns undefined for an unknown id", () => {
    expect(getVMwareMetricById("does-not-exist")).toBeUndefined();
    expect(getVMwareMetricById("")).toBeUndefined();
  });

  test("getVMwareMetricByMetricName round-trips every metric", () => {
    for (const metric of allMetrics) {
      expect(getVMwareMetricByMetricName(metric.metricName)).toEqual(metric);
    }
  });

  test("getVMwareMetricByMetricName returns undefined for an unknown name", () => {
    expect(getVMwareMetricByMetricName("nope.nope.nope")).toBeUndefined();
    expect(getVMwareMetricByMetricName("pve_up")).toBeUndefined();
  });

  test("known metrics are present", () => {
    /*
     * The complete metric set of the vcenter receiver (metadata.yaml),
     * enabled and disabled alike. Exhaustive both ways so a receiver
     * upgrade that adds or renames a metric shows up here.
     */
    const receiverMetrics: Array<string> = [
      "vcenter.cluster.cpu.effective",
      "vcenter.cluster.cpu.limit",
      "vcenter.cluster.host.count",
      "vcenter.cluster.memory.effective",
      "vcenter.cluster.memory.limit",
      "vcenter.cluster.vm.count",
      "vcenter.cluster.vm_template.count",
      "vcenter.cluster.vsan.congestions",
      "vcenter.cluster.vsan.latency.avg",
      "vcenter.cluster.vsan.operations",
      "vcenter.cluster.vsan.throughput",
      "vcenter.datacenter.cluster.count",
      "vcenter.datacenter.cpu.limit",
      "vcenter.datacenter.datastore.count",
      "vcenter.datacenter.disk.space",
      "vcenter.datacenter.host.count",
      "vcenter.datacenter.memory.limit",
      "vcenter.datacenter.vm.count",
      "vcenter.datastore.disk.usage",
      "vcenter.datastore.disk.utilization",
      "vcenter.host.cpu.capacity",
      "vcenter.host.cpu.reserved",
      "vcenter.host.cpu.usage",
      "vcenter.host.cpu.utilization",
      "vcenter.host.disk.latency.avg",
      "vcenter.host.disk.latency.max",
      "vcenter.host.disk.throughput",
      "vcenter.host.memory.active",
      "vcenter.host.memory.ballooned",
      "vcenter.host.memory.capacity",
      "vcenter.host.memory.granted",
      "vcenter.host.memory.usage",
      "vcenter.host.memory.utilization",
      "vcenter.host.network.packet.drop.rate",
      "vcenter.host.network.packet.error.rate",
      "vcenter.host.network.packet.rate",
      "vcenter.host.network.throughput",
      "vcenter.host.network.usage",
      "vcenter.host.vsan.cache.hit_rate",
      "vcenter.host.vsan.congestions",
      "vcenter.host.vsan.latency.avg",
      "vcenter.host.vsan.operations",
      "vcenter.host.vsan.throughput",
      "vcenter.resource_pool.cpu.shares",
      "vcenter.resource_pool.cpu.usage",
      "vcenter.resource_pool.memory.ballooned",
      "vcenter.resource_pool.memory.granted",
      "vcenter.resource_pool.memory.shares",
      "vcenter.resource_pool.memory.swapped",
      "vcenter.resource_pool.memory.usage",
      "vcenter.vm.cpu.readiness",
      "vcenter.vm.cpu.time",
      "vcenter.vm.cpu.usage",
      "vcenter.vm.cpu.utilization",
      "vcenter.vm.disk.latency.avg",
      "vcenter.vm.disk.latency.max",
      "vcenter.vm.disk.throughput",
      "vcenter.vm.disk.usage",
      "vcenter.vm.disk.utilization",
      "vcenter.vm.memory.ballooned",
      "vcenter.vm.memory.granted",
      "vcenter.vm.memory.swapped",
      "vcenter.vm.memory.swapped_ssd",
      "vcenter.vm.memory.usage",
      "vcenter.vm.memory.utilization",
      "vcenter.vm.network.broadcast.packet.rate",
      "vcenter.vm.network.multicast.packet.rate",
      "vcenter.vm.network.packet.drop.rate",
      "vcenter.vm.network.packet.rate",
      "vcenter.vm.network.throughput",
      "vcenter.vm.network.usage",
      "vcenter.vm.vsan.latency.avg",
      "vcenter.vm.vsan.operations",
      "vcenter.vm.vsan.throughput",
    ];

    for (const metricName of receiverMetrics) {
      expect(getVMwareMetricByMetricName(metricName)).toBeDefined();
    }

    expect(
      allMetrics
        .map((m: VMwareMetricDefinition) => {
          return m.metricName;
        })
        .sort(),
    ).toEqual([...receiverMetrics].sort());
  });

  test("every metric the inventory snapshot scan reads is catalogued", () => {
    /*
     * The columns of VMwareResource are derived from these metrics (design
     * spec §3). A metric the ingest scan folds but the picker cannot
     * name would leave the dashboard unable to chart what it stores.
     */
    for (const metricName of [
      "vcenter.host.cpu.utilization",
      "vcenter.host.cpu.usage",
      "vcenter.host.cpu.capacity",
      "vcenter.host.memory.usage",
      "vcenter.host.memory.capacity",
      "vcenter.host.memory.utilization",
      "vcenter.vm.cpu.utilization",
      "vcenter.vm.cpu.usage",
      "vcenter.vm.cpu.readiness",
      "vcenter.vm.memory.usage",
      "vcenter.vm.memory.utilization",
      "vcenter.vm.memory.ballooned",
      "vcenter.vm.memory.swapped",
      "vcenter.vm.disk.usage",
      "vcenter.vm.disk.utilization",
      "vcenter.datastore.disk.usage",
      "vcenter.datastore.disk.utilization",
      "vcenter.cluster.cpu.limit",
      "vcenter.cluster.cpu.effective",
      "vcenter.cluster.memory.limit",
      "vcenter.cluster.memory.effective",
      "vcenter.cluster.host.count",
      "vcenter.cluster.vm.count",
      "vcenter.cluster.vm_template.count",
      "vcenter.datacenter.cpu.limit",
      "vcenter.datacenter.memory.limit",
      "vcenter.datacenter.disk.space",
      "vcenter.datacenter.host.count",
      "vcenter.datacenter.vm.count",
      "vcenter.datacenter.datastore.count",
      "vcenter.datacenter.cluster.count",
      "vcenter.resource_pool.cpu.usage",
      "vcenter.resource_pool.memory.usage",
      "vcenter.resource_pool.memory.ballooned",
      "vcenter.resource_pool.memory.swapped",
    ]) {
      expect(getVMwareMetricByMetricName(metricName)).toBeDefined();
    }
  });
});
