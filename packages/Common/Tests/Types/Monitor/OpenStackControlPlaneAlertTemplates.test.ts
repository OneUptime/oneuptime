import { describe, expect, test } from "@jest/globals";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import {
  CriteriaFilter,
  FilterType,
  NoDataPolicy,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepOpenStackMonitor, {
  OPENSTACK_REGION_ATTRIBUTE,
} from "../../../Types/Monitor/MonitorStepOpenStackMonitor";
import {
  OPENSTACK_ANCHOR_METRIC_ALIAS,
  OpenStackAlertTemplate,
  getAllOpenStackAlertTemplates,
  getOpenStackAlertTemplateById,
} from "../../../Types/Monitor/OpenStackAlertTemplates";
import {
  getAllOpenStackControlPlaneAlertTemplates,
  getOpenStackControlPlaneTemplateIds,
  getOpenStackTemplateChildren,
  getOpenStackTemplateParents,
} from "../../../Types/Monitor/OpenStackControlPlaneAlertTemplates";
import { getAllOpenStackLogAlertTemplates } from "../../../Types/Monitor/OpenStackLogAlertTemplates";
import { getOpenStackMetricByMetricName } from "../../../Types/Monitor/OpenStackMetricCatalog";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../../Types/RollingTime/RollingTimeUtil";
import ObjectID from "../../../Types/ObjectID";
import {
  OPENSTACK_DEPENDENCIES,
  OPENSTACK_NETWORK_FACTS,
  OpenStackDependency,
} from "../../../Types/OpenStack/OpenStackControlPlane";

/*
 * The rules every template on what a cloud stands on keeps. What each really reads as, on what
 * real clusters said, is OpenStackControlPlaneReplay.test.ts in the App's tests.
 */

const COLLECTION_SECONDS: number = 60;
const MAX_SUMMARY_LENGTH: number = 80;

const TEMPLATES: Array<OpenStackAlertTemplate> =
  getAllOpenStackControlPlaneAlertTemplates();

const CASES: Array<[string, OpenStackAlertTemplate]> = TEMPLATES.map(
  (template: OpenStackAlertTemplate): [string, OpenStackAlertTemplate] => {
    return [template.id, template];
  },
);

const ARGS: {
  cloudIdentifier: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
} = {
  cloudIdentifier: "production",
  onlineMonitorStatusId: ObjectID.generate(),
  offlineMonitorStatusId: ObjectID.generate(),
  defaultIncidentSeverityId: ObjectID.generate(),
  defaultAlertSeverityId: ObjectID.generate(),
  monitorName: "Under the cloud",
};

function stepOf(template: OpenStackAlertTemplate): MonitorStep {
  return template.getMonitorStep(ARGS);
}

function configOf(
  template: OpenStackAlertTemplate,
): MonitorStepOpenStackMonitor {
  return stepOf(template).data!.openstackMonitor!;
}

function queriesOf(
  template: OpenStackAlertTemplate,
): Array<MetricQueryConfigData> {
  return configOf(template).metricViewConfig.queryConfigs;
}

function aliasOf(query: MetricQueryConfigData): string {
  return query.metricAliasData!.metricVariable!;
}

function criteriaOf(
  template: OpenStackAlertTemplate,
): [MonitorCriteriaInstance, MonitorCriteriaInstance] {
  return stepOf(template).data!.monitorCriteria.data!
    .monitorCriteriaInstanceArray as [
    MonitorCriteriaInstance,
    MonitorCriteriaInstance,
  ];
}

function filtersOf(instance: MonitorCriteriaInstance): Array<CriteriaFilter> {
  return instance.data!.filters;
}

function secondsOf(rollingTime: RollingTime): number {
  const window: { startValue: Date; endValue: Date } =
    RollingTimeUtil.convertToStartAndEndDate(rollingTime) as never;

  return (
    (new Date(window.endValue).getTime() -
      new Date(window.startValue).getTime()) /
    1000
  );
}

describe("what a cloud stands on: the rules every template keeps", () => {
  test("every dependency has templates, and the catalogue offers each of them", () => {
    for (const dependency of OPENSTACK_DEPENDENCIES) {
      expect(
        getOpenStackControlPlaneTemplateIds(dependency).length,
      ).toBeGreaterThan(0);
    }

    expect(
      new Set(
        TEMPLATES.map((one: OpenStackAlertTemplate) => {
          return one.id;
        }),
      ).size,
    ).toBe(TEMPLATES.length);

    for (const template of TEMPLATES) {
      expect(getOpenStackAlertTemplateById(template.id)).toBe(template);
    }
  });

  test("everything the issue asks for is here, or says why not", () => {
    const names: Array<string> = TEMPLATES.map(
      (template: OpenStackAlertTemplate): string => {
        return template.name;
      },
    );

    expect(names).toEqual(
      expect.arrayContaining([
        "RabbitMQ Node Down",
        "RabbitMQ Partition Detected",
        "RabbitMQ Memory Alarm",
        "RabbitMQ Disk Alarm",
        "RabbitMQ File Descriptors High",
        "RabbitMQ Messages Unacknowledged",
        "RabbitMQ Queue Without Consumers",
        "MariaDB Cluster Down",
        "Galera Node Out of Sync",
        "Galera Node Not Ready",
        "Galera Cluster Size Dropped",
        "MariaDB Too Many Connections",
        "MariaDB Slow Queries",
        "Memcached Cluster Down",
        "Memcached No Connections",
        "Memcached Evictions High",
        "HAProxy Backend Down",
        "HAProxy Server Down",
        "API 5xx Rate High",
        // "API 401 Rate High" in the issue: HAProxy counts by class and no finer.
        "API 4xx Rate High",
        "OVN Controller Not Running",
        "Northbound or Southbound Database Without a Leader",
        "Geneve Transmit Errors",
        "Open vSwitch Service Down",
        "Network Exporter Target Down",
        "libvirt Service Down",
        "libvirt Exporter Target Down",
      ]),
    );

    /*
     * "Fernet Key Rotation Out of Step" in the issue is Token Validation Failing: with its keys
     * swapped a real Keystone writes what it writes for any refusal, so no line tells them apart.
     */
    expect(
      getAllOpenStackLogAlertTemplates().find(
        (template: { name: string; description: string }): boolean => {
          return template.name === "Token Validation Failing";
        },
      )!.description,
    ).toContain("Fernet keys differ");
  });

  test.each(CASES)(
    "%s never adds up collections",
    (_id: string, template: OpenStackAlertTemplate) => {
      for (const query of queriesOf(template)) {
        expect(query.metricQueryData.filterData.aggegationType).not.toBe(
          MetricsAggregationType.Sum,
        );
      }
    },
  );

  test.each(CASES)(
    "%s reads a window of at least three collections",
    (_id: string, template: OpenStackAlertTemplate) => {
      expect(secondsOf(configOf(template).rollingTime)).toBeGreaterThanOrEqual(
        3 * COLLECTION_SECONDS,
      );
    },
  );

  test.each(CASES)(
    "%s is about a region, and keeps its window from reading as silent",
    (_id: string, template: OpenStackAlertTemplate) => {
      for (const query of queriesOf(template)) {
        expect(query.metricQueryData.groupByAttributeKeys![0]).toBe(
          OPENSTACK_REGION_ATTRIBUTE,
        );
      }

      expect(queriesOf(template).map(aliasOf)).toContain(
        OPENSTACK_ANCHOR_METRIC_ALIAS,
      );
    },
  );

  test.each(CASES)(
    "%s reads only series the catalogue knows, and judges no anchor",
    (_id: string, template: OpenStackAlertTemplate) => {
      for (const query of queriesOf(template)) {
        const metricName: string = query.metricQueryData.filterData
          .metricName as string;

        expect(getOpenStackMetricByMetricName(metricName)).toBeDefined();
      }

      for (const instance of criteriaOf(template)) {
        for (const filter of filtersOf(instance)) {
          expect(filter.metricMonitorOptions?.metricAlias).not.toBe(
            OPENSTACK_ANCHOR_METRIC_ALIAS,
          );
        }
      }
    },
  );

  test.each(CASES)(
    "%s counts a series that goes away as recovered",
    (_id: string, template: OpenStackAlertTemplate) => {
      const [, recovery] = criteriaOf(template);

      for (const filter of filtersOf(recovery)) {
        expect(filter.metricMonitorOptions?.onNoDataPolicy).toBe(
          filter.filterType === FilterType.GreaterThanOrEqualTo
            ? NoDataPolicy.Trigger
            : NoDataPolicy.TreatAsZero,
        );
      }

      expect(recovery.data!.createIncidents).toBeFalsy();
      expect(recovery.data!.changeMonitorStatus).toBe(true);
    },
  );

  test.each(CASES)(
    "%s has a one-line summary with no metric names",
    (_id: string, template: OpenStackAlertTemplate) => {
      const summary: string = template.summary;

      expect(summary.length).toBeLessThanOrEqual(MAX_SUMMARY_LENGTH);
      expect(summary.endsWith(".")).toBe(true);
      expect(summary).not.toMatch(/\b[a-z][a-z0-9]*_[a-z0-9_]+\b/);
      expect(summary).not.toContain("`");
    },
  );

  test.each(CASES)(
    "%s says what to check next, and that it resolves on its own",
    (_id: string, template: OpenStackAlertTemplate) => {
      const [firing] = criteriaOf(template);

      expect(template.description).toMatch(/\bCheck\b/);
      expect(firing.data!.incidents[0]!.description).toMatch(/\b[Cc]heck\b/);
      expect(firing.data!.incidents[0]!.description).toMatch(
        /resolves on its own/,
      );
      expect(firing.data!.incidents[0]!.title).toContain("[OpenStack]");
      expect(firing.data!.incidents[0]!.title).toContain(ARGS.monitorName);
      expect(firing.data!.alerts[0]!.title).toBe(
        firing.data!.incidents[0]!.title,
      );
    },
  );

  test("only what goes away leaving no trace is held to the machines it was seen on", () => {
    const held: Record<string, string> = {};

    for (const template of TEMPLATES) {
      const fact: string | undefined = configOf(template).onlyWhereSeen;

      if (fact) {
        held[template.id] = fact;
      }
    }

    expect(held).toEqual({
      "openstack-ovn-controller-not-running":
        OPENSTACK_NETWORK_FACTS.OvnControllerSeenAt,
      "openstack-ovs-service-down": OPENSTACK_NETWORK_FACTS.OvsSeenAt,
      "openstack-ovs-database-not-read":
        OPENSTACK_NETWORK_FACTS.OvsDatabaseSeenAt,
    });
  });
});

describe("one failure, one incident: who waits for whom", () => {
  const ALL_IDS: Array<string> = [
    ...getAllOpenStackAlertTemplates().map(
      (template: OpenStackAlertTemplate): string => {
        return template.id;
      },
    ),
    ...getAllOpenStackLogAlertTemplates().map(
      (template: { id: string }): string => {
        return template.id;
      },
    ),
  ];

  const PARENTS: Array<string> = TEMPLATES.map(
    (template: OpenStackAlertTemplate): string => {
      return template.id;
    },
  ).filter((id: string): boolean => {
    return getOpenStackTemplateChildren(id).length > 0;
  });

  test("the parents are what a whole failure reads as", () => {
    expect(PARENTS.sort()).toEqual([
      "openstack-haproxy-down",
      "openstack-mariadb-cluster-down",
      "openstack-ovn-controller-not-running",
      "openstack-ovn-database-without-leader",
      "openstack-ovs-service-down",
      "openstack-rabbitmq-down",
    ]);
  });

  test.each(
    PARENTS.map((id: string): [string] => {
      return [id];
    }),
  )("%s names only templates there are, and no cycle", (id: string) => {
    for (const child of getOpenStackTemplateChildren(id)) {
      expect(ALL_IDS).toContain(child);
      expect(getOpenStackTemplateParents(child)).toContain(id);
      expect(getOpenStackTemplateChildren(child)).not.toContain(id);
    }
  });

  test("libvirt going has nothing wait for it: nova-compute disables itself, so nothing else fires", () => {
    for (const id of getOpenStackControlPlaneTemplateIds(
      OpenStackDependency.Libvirt,
    )) {
      expect(getOpenStackTemplateChildren(id)).toEqual([]);
    }
  });
});
