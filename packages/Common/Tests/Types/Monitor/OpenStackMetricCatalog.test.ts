import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import Dictionary from "../../../Types/Dictionary";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MonitorStepOpenStackMonitor, {
  MonitorStepOpenStackMonitorUtil,
  OPENSTACK_REGION_ATTRIBUTE,
  alignOpenStackSeriesLabels,
  getOpenStackFilterAttributes,
  getOpenStackGroupByKeysForMetric,
} from "../../../Types/Monitor/MonitorStepOpenStackMonitor";
import MonitorType from "../../../Types/Monitor/MonitorType";
import {
  OpenStackMetricDefinition,
  getAllOpenStackMetricCategories,
  getAllOpenStackMetrics,
  getOpenStackMetricById,
  getOpenStackMetricByMetricName,
  getOpenStackMetricsByCategory,
} from "../../../Types/Monitor/OpenStackMetricCatalog";
import { OpenStackServiceType } from "../../../Types/OpenStack/OpenStackResourceKind";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import PlatformMetricUnitUtil from "../../../Utils/Monitor/PlatformMetricUnitUtil";
import {
  OPENSTACK_API_UP_METRIC_NAMES,
  OPENSTACK_REGION_ATTRIBUTE as SCAN_REGION_ATTRIBUTE,
  OPENSTACK_SNAPSHOT_METRIC_NAMES,
} from "../../../Server/Utils/Telemetry/OpenStackSnapshotScan";
import { OPENSTACK_API_UP_METRIC_BY_SERVICE } from "../../../Types/Monitor/OpenStackAlertTemplates";
import {
  OPENSTACK_EXPORTER_IMAGE,
  OPENSTACK_EXPORTER_SERIES,
  OPENSTACK_RECEIVER_SERIES,
} from "./Utils/OpenStackExporterSeries";

/*
 * THE SERIES A PERSON CAN WATCH, IN PLAIN WORDS.
 *
 * The catalogue is what a monitor's metric picker offers and where a chart gets a
 * name and a unit. Everything it says about a series is checked against what the
 * exporter the agent pins really says (Utils/OpenStackExporterSeries), because a
 * label spelled wrongly filters a query down to nothing and nobody is told.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");

function readRepoFile(...parts: Array<string>): string {
  return fs.readFileSync(path.join(REPO_ROOT, ...parts), "utf8");
}

const COMPOSE: string = readRepoFile(
  "agents",
  "OpenStackAgent",
  "docker-compose.yml",
);
const COLLECTOR_CONFIG: string = readRepoFile(
  "agents",
  "OpenStackAgent",
  "otel-collector-config.yaml",
);
const DOCS: string = readRepoFile(
  "packages",
  "App",
  "FeatureSet",
  "Docs",
  "Content",
  "en",
  "monitor",
  "openstack-monitor.md",
);

const DISABLED_METRICS: Array<string> = Array.from(
  COMPOSE.matchAll(/^\s*- --disable-metric=(\S+)\s*$/gm),
).map((match: RegExpMatchArray): string => {
  return match[1]!;
});

const METRICS: Array<OpenStackMetricDefinition> = getAllOpenStackMetrics();

type MetricCase = [string, OpenStackMetricDefinition];

const METRIC_CASES: Array<MetricCase> = METRICS.map(
  (metric: OpenStackMetricDefinition): MetricCase => {
    return [metric.metricName, metric];
  },
);

function metricNames(): Array<string> {
  return METRICS.map((metric: OpenStackMetricDefinition): string => {
    return metric.metricName;
  });
}

/*
 * A status series' value is a numeric code rather than a quantity, an `_up` series'
 * is 0 or 1, and Placement's resource series change unit with their resourcetype.
 */
const NO_UNIT_SERIES: ReadonlyArray<string> = [
  "up",
  "openstack_identity_up",
  "openstack_nova_up",
  "openstack_neutron_up",
  "openstack_cinder_up",
  "openstack_glance_up",
  "openstack_placement_up",
  "openstack_nova_agent_state",
  "openstack_neutron_agent_state",
  "openstack_cinder_agent_state",
  "openstack_nova_server_status",
  "openstack_neutron_network",
  "openstack_neutron_vpn_service",
  "openstack_neutron_vpn_siteconnection",
  "openstack_neutron_l3_agent_of_router",
  "openstack_cinder_volume_status",
  "openstack_placement_resource_total",
  "openstack_placement_resource_reserved",
  "openstack_placement_resource_usage",
  "openstack_placement_resource_provider_allocations",
];

describe("OpenStackMetricCatalog", () => {
  describe("every series the agent's exporter has, and nothing else", () => {
    test("the exporter it was checked against is the one the agent pins", () => {
      expect(COMPOSE).toContain(`image: ${OPENSTACK_EXPORTER_IMAGE}`);
    });

    test("names every series the exporter has", () => {
      const missing: Array<string> = Object.keys(
        OPENSTACK_EXPORTER_SERIES,
      ).filter((name: string): boolean => {
        return !metricNames().includes(name);
      });

      expect(missing).toEqual([]);
    });

    test("names nothing the exporter does not have, but the collection's own two and what only the probe sends", () => {
      const extra: Array<string> = METRICS.filter(
        (metric: OpenStackMetricDefinition): boolean => {
          return !OPENSTACK_EXPORTER_SERIES[metric.metricName];
        },
      ).filter((metric: OpenStackMetricDefinition): boolean => {
        return metric.onlyFromProbe !== true;
      }).map((metric: OpenStackMetricDefinition): string => {
        return metric.metricName;
      });

      expect(extra.sort()).toEqual([...OPENSTACK_RECEIVER_SERIES].sort());
    });

    test("what only the probe sends is marked as such, and is no series of the exporter's", () => {
      const onlyFromProbe: Array<OpenStackMetricDefinition> = METRICS.filter(
        (metric: OpenStackMetricDefinition): boolean => {
          return metric.onlyFromProbe === true;
        },
      );

      expect(
        onlyFromProbe
          .map((metric: OpenStackMetricDefinition): string => {
            return metric.metricName;
          })
          .sort(),
      ).toEqual(["openstack_cinder_backup_gb", "openstack_cinder_snapshot_gb"]);

      for (const metric of onlyFromProbe) {
        expect(OPENSTACK_EXPORTER_SERIES[metric.metricName]).toBeUndefined();
        expect(metric.description).toContain("Only a probe sends this");
      }
    });

    test("a label only the probe sends is never one of the exporter's", () => {
      const marked: Array<OpenStackMetricDefinition> = METRICS.filter(
        (metric: OpenStackMetricDefinition): boolean => {
          return (metric.probeOnlyAttributes || []).length > 0;
        },
      );

      expect(
        marked
          .map((metric: OpenStackMetricDefinition): string => {
            return metric.metricName;
          })
          .sort(),
      ).toEqual([
        "openstack_cinder_volume_gb",
        "openstack_glance_image_bytes",
        "openstack_neutron_floating_ip",
        "openstack_nova_server_status",
      ]);

      for (const metric of marked) {
        for (const label of metric.probeOnlyAttributes || []) {
          expect(metric.identityAttributes).not.toContain(label);
          expect(
            OPENSTACK_EXPORTER_SERIES[metric.metricName]!.labels,
          ).not.toContain(label);
        }
      }
    });

    test.each(
      METRIC_CASES.filter((metricCase: MetricCase): boolean => {
        return (
          !OPENSTACK_RECEIVER_SERIES.includes(metricCase[0]) &&
          metricCase[1].onlyFromProbe !== true
        );
      }),
    )(
      "%s has the exporter's exact labels, from its own service's job",
      (name: string, metric: OpenStackMetricDefinition) => {
        expect([...metric.identityAttributes].sort()).toEqual(
          [...OPENSTACK_EXPORTER_SERIES[name]!.labels].sort(),
        );
        expect(metric.service).toBe(OPENSTACK_EXPORTER_SERIES[name]!.service);
      },
    );

    test("says what the real labels are where newer sources differ", () => {
      const runningVms: OpenStackMetricDefinition =
        getOpenStackMetricByMetricName("openstack_nova_running_vms")!;
      const floatingIp: OpenStackMetricDefinition =
        getOpenStackMetricByMetricName("openstack_neutron_floating_ip")!;

      expect(runningVms.identityAttributes).not.toContain("tenant_id");
      expect(floatingIp.identityAttributes).not.toContain("port_id");
      expect(floatingIp.identityAttributes).not.toContain("fixed_ip_address");
    });

    test("every series the product's own scan reads is here", () => {
      const unknown: Array<string> = Array.from(
        OPENSTACK_SNAPSHOT_METRIC_NAMES,
      ).filter((name: string): boolean => {
        return !getOpenStackMetricByMetricName(name);
      });

      /*
       * The pinned exporter revision has no snapshot size series, so the scan's Snapshot
       * rows only fill for a cloud a probe collects: the catalogue marks it so.
       */
      expect(unknown).toEqual([]);
      expect(
        getOpenStackMetricByMetricName("openstack_cinder_snapshot_gb")
          ?.onlyFromProbe,
      ).toBe(true);
    });
  });

  describe("a default aggregation that never adds up scrapes", () => {
    test.each(METRIC_CASES)(
      "%s reads Min or Max, never Sum",
      (_name: string, metric: OpenStackMetricDefinition) => {
        expect([
          MetricsAggregationType.Min,
          MetricsAggregationType.Max,
        ]).toContain(metric.defaultAggregation);
      },
    );

    test.each(
      METRIC_CASES.filter((metricCase: MetricCase): boolean => {
        return (
          metricCase[0] === "up" ||
          metricCase[0] === "scrape_samples_scraped" ||
          metricCase[0].endsWith("_up") ||
          metricCase[0].endsWith("_agent_state")
        );
      }),
    )(
      "%s reads Min, so any one down reads 0",
      (_name: string, metric: OpenStackMetricDefinition) => {
        expect(metric.defaultAggregation).toBe(MetricsAggregationType.Min);
      },
    );

    test.each(
      METRIC_CASES.filter((metricCase: MetricCase): boolean => {
        return (
          metricCase[0].endsWith("_info") ||
          metricCase[0].endsWith("_generation") ||
          [
            "openstack_nova_flavor",
            "openstack_nova_server_status",
            "openstack_neutron_network",
            "openstack_neutron_subnet",
            "openstack_neutron_router",
            "openstack_neutron_floating_ip",
            "openstack_neutron_port",
          ].includes(metricCase[0])
        );
      }),
    )(
      "%s, an info series or a lifetime counter, reads Max",
      (_name: string, metric: OpenStackMetricDefinition) => {
        expect(metric.defaultAggregation).toBe(MetricsAggregationType.Max);
      },
    );

    test.each(METRIC_CASES)(
      "%s never tells anyone to add it up",
      (_name: string, metric: OpenStackMetricDefinition) => {
        expect(metric.description.toLowerCase()).not.toMatch(/\bsum\b/);
      },
    );
  });

  describe("in plain words, with its unit", () => {
    test.each(METRIC_CASES)(
      "%s has a name a person can read and a sentence about it",
      (_name: string, metric: OpenStackMetricDefinition) => {
        expect(metric.friendlyName).not.toContain("_");
        expect(metric.friendlyName.length).toBeGreaterThan(0);
        expect(metric.description.endsWith(".")).toBe(true);
        expect(metric.description.length).toBeGreaterThan(10);
      },
    );

    test.each(METRIC_CASES)(
      "%s says its unit, or has none because its value is not a quantity",
      (name: string, metric: OpenStackMetricDefinition) => {
        if (NO_UNIT_SERIES.includes(name)) {
          expect(metric.unit).toBeUndefined();
          return;
        }

        expect(metric.unit).toBeDefined();

        if (name.endsWith("_gb") || name.endsWith("_gigabytes")) {
          expect(metric.unit).toBe("GiB");
        }

        if (name.endsWith("_bytes")) {
          expect(metric.unit).toBe("bytes");
        }
      },
    );

    test("names are unique, ids are the metric's own, and each category holds some", () => {
      expect(
        new Set(
          METRICS.map((metric: OpenStackMetricDefinition): string => {
            return metric.friendlyName;
          }),
        ).size,
      ).toBe(METRICS.length);

      for (const metric of METRICS) {
        expect(metric.id).toBe(metric.metricName.replace(/_/g, "-"));
        expect(getOpenStackMetricById(metric.id)).toBe(metric);
      }

      for (const category of getAllOpenStackMetricCategories()) {
        expect(getOpenStackMetricsByCategory(category).length).toBeGreaterThan(
          0,
        );
      }

      expect(
        getAllOpenStackMetricCategories().flatMap((category: string) => {
          return getOpenStackMetricsByCategory(
            category as OpenStackMetricDefinition["category"],
          );
        }).length,
      ).toBe(METRICS.length);
    });

    test("says a status series' value is a code, not an amount", () => {
      for (const name of [
        "openstack_nova_server_status",
        "openstack_neutron_network",
        "openstack_cinder_volume_status",
      ]) {
        expect(getOpenStackMetricByMetricName(name)!.description).toContain(
          "numeric code",
        );
      }
    });

    test("a monitor's units come from it", () => {
      expect(
        PlatformMetricUnitUtil.getPlatformForMonitorType(MonitorType.OpenStack),
      ).toBe("openstack");
      expect(
        PlatformMetricUnitUtil.getCatalogUnit({
          platform: "openstack",
          metricName: "openstack_cinder_pool_capacity_total_gb",
        }),
      ).toBe("GiB");
      expect(
        PlatformMetricUnitUtil.getMetricUnit({
          platform: "openstack",
          metricName: "openstack_cinder_volumes",
          declaredUnit: undefined,
        }),
      ).toBeUndefined();
    });
  });

  describe("what the agent leaves out, and how to turn it on", () => {
    test("the agent names what it leaves out, instead of turning every slow metric off", () => {
      expect(DISABLED_METRICS.length).toBeGreaterThan(0);
      expect(COMPOSE).not.toMatch(/^\s*- --disable-slow-metrics\s*$/m);
    });

    test.each(DISABLED_METRICS)(
      "the agent's --disable-metric=%s names a series here, marked off by that line",
      (disabled: string) => {
        const [service, ...head] = disabled.split("-");
        const metricName: string = `openstack_${service}_${head.join("-")}`;

        expect(getOpenStackMetricByMetricName(metricName)?.offByDefault).toBe(
          disabled,
        );
      },
    );

    test.each(
      METRIC_CASES.filter((metricCase: MetricCase): boolean => {
        return Boolean(metricCase[1].offByDefault);
      }),
    )(
      "%s, off by default, names the line the agent has and says to delete it",
      (_name: string, metric: OpenStackMetricDefinition) => {
        expect(DISABLED_METRICS).toContain(metric.offByDefault);
        expect(metric.description).toContain(
          `--disable-metric=${metric.offByDefault}`,
        );
        expect(metric.description).not.toContain("--disable-slow-metrics");
      },
    );

    test.each([
      ["openstack_nova_limits_memory_used", "nova-limits_vcpus_max"],
      ["openstack_nova_quota_ram", "nova-quota_cores"],
      ["openstack_nova_server_local_gb", "nova-server_local_gb"],
      ["openstack_neutron_quota_router", "neutron-quota_network"],
      ["openstack_neutron_subnets_free", "neutron-subnets_total"],
      ["openstack_cinder_limits_backup_used_gb", "cinder-limits_volume_max_gb"],
      [
        "openstack_cinder_volume_type_quota_gigabytes",
        "cinder-limits_volume_max_gb",
      ],
      ["openstack_neutron_ports", "neutron-ports"],
      ["openstack_nova_security_groups", "nova-security_groups"],
    ])(
      "%s stays off through --disable-metric=%s",
      (name: string, disabled: string) => {
        expect(getOpenStackMetricByMetricName(name)?.offByDefault).toBe(
          disabled,
        );
      },
    );

    test.each([
      "openstack_glance_image_bytes",
      "openstack_glance_image_created_at",
    ])("%s is on by default now, so its page has it", (name: string) => {
      const metric: OpenStackMetricDefinition =
        getOpenStackMetricByMetricName(name)!;

      expect(metric.offByDefault).toBeUndefined();
      expect(metric.description).not.toMatch(/off by default/i);
    });
  });

  describe("agrees with the rest of the product", () => {
    test("the region attribute is the one the scan reads and the agent stamps", () => {
      expect(OPENSTACK_REGION_ATTRIBUTE).toBe(SCAN_REGION_ATTRIBUTE);
      expect(COLLECTOR_CONFIG).toContain(
        `attributes["${OPENSTACK_REGION_ATTRIBUTE}"]`,
      );
    });

    test("each API's up series is the one the scan reads", () => {
      for (const [metricName, service] of OPENSTACK_API_UP_METRIC_NAMES) {
        expect(OPENSTACK_API_UP_METRIC_BY_SERVICE[service]).toBe(metricName);
        expect(getOpenStackMetricByMetricName(metricName)?.service).toBe(
          service,
        );
      }
    });

    test("every service has a scrape job under the name the series say", () => {
      for (const service of Object.values(OpenStackServiceType)) {
        expect(COLLECTOR_CONFIG).toContain(`openstack_service: ${service}`);
      }
    });

    test.each(METRIC_CASES)(
      "the docs' metric tables list %s",
      (name: string) => {
        expect(DOCS).toContain(`| \`${name}\` |`);
      },
    );
  });
});

describe("MonitorStepOpenStackMonitor", () => {
  test("a new monitor reads a window holding three collections of anything", () => {
    const monitor: MonitorStepOpenStackMonitor =
      MonitorStepOpenStackMonitorUtil.getDefault();

    expect(monitor.cloudIdentifier).toBe("");
    expect(monitor.resourceFilters).toEqual({});
    expect(monitor.rollingTime).toBe(RollingTime.Past15Minutes);
  });

  test("survives a trip through JSON", () => {
    const monitor: MonitorStepOpenStackMonitor = {
      ...MonitorStepOpenStackMonitorUtil.getDefault(),
      cloudIdentifier: "prod",
      resourceFilters: { regionName: "RegionOne", projectId: "abc" },
    };

    expect(
      MonitorStepOpenStackMonitorUtil.fromJSON(
        MonitorStepOpenStackMonitorUtil.toJSON(monitor),
      ),
    ).toEqual(monitor);
  });

  describe("each filter is equality on the label it maps to on that series", () => {
    function attributesFor(
      metricName: string,
      resourceFilters: MonitorStepOpenStackMonitor["resourceFilters"],
    ): Dictionary<string> {
      return getOpenStackFilterAttributes({
        resourceFilters,
        seriesLabels:
          getOpenStackMetricByMetricName(metricName)!.identityAttributes,
      });
    }

    test.each([
      ["openstack_nova_server_status", "availability_zone"],
      ["openstack_neutron_agent_state", "availability_zone"],
      ["openstack_nova_vcpus_used", "availability_zone"],
      ["openstack_cinder_volume_gb", "availability_zone"],
      ["openstack_nova_agent_state", "zone"],
      ["openstack_cinder_agent_state", "zone"],
    ])("availability zone on %s reads %s", (metric: string, label: string) => {
      expect(attributesFor(metric, { availabilityZone: "az1" })).toEqual({
        [label]: "az1",
      });
    });

    test.each([
      ["openstack_nova_agent_state", "hostname"],
      ["openstack_neutron_agent_state", "hostname"],
      ["openstack_cinder_agent_state", "hostname"],
      ["openstack_placement_resource_usage", "hostname"],
      ["openstack_nova_vcpus_used", "hostname"],
      ["openstack_nova_server_status", "hypervisor_hostname"],
    ])("hypervisor on %s reads %s", (metric: string, label: string) => {
      expect(attributesFor(metric, { hypervisorName: "compute-01" })).toEqual({
        [label]: "compute-01",
      });
    });

    test.each([
      ["openstack_nova_server_status", "tenant_id"],
      ["openstack_cinder_volume_gb", "tenant_id"],
      ["openstack_nova_limits_vcpus_used", "tenant_id"],
      ["openstack_neutron_network", "tenant_id"],
      ["openstack_neutron_floating_ip", "project_id"],
      ["openstack_neutron_router", "project_id"],
      ["openstack_neutron_network_ip_availabilities_used", "project_id"],
    ])("project on %s reads %s", (metric: string, label: string) => {
      expect(attributesFor(metric, { projectId: "abc" })).toEqual({
        [label]: "abc",
      });
    });

    test("service reads the worker's binary", () => {
      expect(
        attributesFor("openstack_nova_agent_state", {
          serviceName: "nova-compute",
        }),
      ).toEqual({ service: "nova-compute" });
    });

    test("the region is on every series", () => {
      for (const metric of METRICS) {
        expect(
          getOpenStackFilterAttributes({
            resourceFilters: { regionName: "RegionOne" },
            seriesLabels: metric.identityAttributes,
          }),
        ).toEqual({ [OPENSTACK_REGION_ATTRIBUTE]: "RegionOne" });
      }
    });

    test("a filter never empties a series that does not carry its label", () => {
      expect(
        attributesFor("openstack_nova_up", {
          availabilityZone: "az1",
          hypervisorName: "compute-01",
          serviceName: "nova-compute",
          projectId: "abc",
        }),
      ).toEqual({});
    });

    test("every label a filter can read is one the exporter has somewhere", () => {
      const labels: Set<string> = new Set<string>(
        METRICS.flatMap((metric: OpenStackMetricDefinition) => {
          return [...metric.identityAttributes];
        }),
      );

      for (const label of [
        "availability_zone",
        "zone",
        "hostname",
        "hypervisor_hostname",
        "service",
        "tenant_id",
        "project_id",
      ]) {
        expect(labels.has(label)).toBe(true);
      }
    });

    test("a series the catalogue does not know takes each filter's first label", () => {
      expect(
        getOpenStackFilterAttributes({
          resourceFilters: {
            regionName: "RegionOne",
            availabilityZone: "az1",
            hypervisorName: "compute-01",
            serviceName: "nova-compute",
            projectId: "abc",
          },
          seriesLabels: undefined,
        }),
      ).toEqual({
        [OPENSTACK_REGION_ATTRIBUTE]: "RegionOne",
        availability_zone: "az1",
        hostname: "compute-01",
        service: "nova-compute",
        tenant_id: "abc",
      });
    });

    test("no filters, no attributes", () => {
      expect(
        getOpenStackFilterAttributes({
          resourceFilters: undefined,
          seriesLabels: [],
        }),
      ).toEqual({});
    });
  });

  describe("a network's series lines up with its address series", () => {
    const KEYS: Array<string> = [
      OPENSTACK_REGION_ATTRIBUTE,
      "network_id",
      "network_name",
    ];

    test("it is read by its own labels", () => {
      expect(
        getOpenStackGroupByKeysForMetric({
          metricName: "openstack_neutron_network",
          groupByAttributeKeys: KEYS,
        }),
      ).toEqual([OPENSTACK_REGION_ATTRIBUTE, "id", "name"]);
    });

    test("any other series is read by the keys as they are", () => {
      expect(
        getOpenStackGroupByKeysForMetric({
          metricName: "openstack_neutron_network_ip_availabilities_used",
          groupByAttributeKeys: KEYS,
        }),
      ).toBe(KEYS);
    });

    test("its rows then carry the keys the others group by", () => {
      const result: AggregatedResult = {
        data: [
          {
            timestamp: new Date(),
            value: 1,
            attributes: {
              [OPENSTACK_REGION_ATTRIBUTE]: "RegionOne",
              id: "27b8fbff",
              name: "public",
            },
          } as never,
        ],
      };

      expect(
        (
          alignOpenStackSeriesLabels({
            metricName: "openstack_neutron_network",
            aggregatedResult: result,
          }).data[0] as unknown as { attributes: Dictionary<string> }
        ).attributes,
      ).toEqual({
        [OPENSTACK_REGION_ATTRIBUTE]: "RegionOne",
        id: "27b8fbff",
        name: "public",
        network_id: "27b8fbff",
        network_name: "public",
      });
    });

    test("any other series' rows are left alone", () => {
      const result: AggregatedResult = {
        data: [
          { timestamp: new Date(), value: 1, attributes: { id: "x" } } as never,
        ],
      };

      expect(
        alignOpenStackSeriesLabels({
          metricName: "openstack_neutron_router",
          aggregatedResult: result,
        }),
      ).toBe(result);
      expect(
        (result.data[0] as unknown as { attributes: Dictionary<string> })
          .attributes,
      ).toEqual({ id: "x" });
    });
  });
});
