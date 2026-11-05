import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorService from "../../../../Server/Services/MonitorService";
import OpenStackMonitorDependencies, {
  getCloudOfOpenStackMonitor,
  getOpenStackTemplateOfMonitors,
} from "../../../../Server/Utils/OpenStack/OpenStackMonitorDependencies";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import {
  OpenStackAlertTemplate,
  getAllOpenStackAlertTemplates,
  getOpenStackAlertTemplateById,
} from "../../../../Types/Monitor/OpenStackAlertTemplates";
import {
  getAllOpenStackControlPlaneAlertTemplates,
  getOpenStackTemplateChildren,
  getOpenStackTemplateParents,
} from "../../../../Types/Monitor/OpenStackControlPlaneAlertTemplates";
import {
  OPENSTACK_DATABASE_CONNECTION_LOST_TEMPLATE_ID,
  OPENSTACK_RABBITMQ_CONNECTION_LOST_TEMPLATE_ID,
  OpenStackLogAlertTemplate,
  getAllOpenStackLogAlertTemplates,
} from "../../../../Types/Monitor/OpenStackLogAlertTemplates";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * One failure, one incident, without anyone having to set it up: a monitor made from one of
 * OpenStack's templates is linked to its cloud's others through the product's own monitor
 * dependencies, whichever order they were made in.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const CLOUD: string = "production";

function monitorOf(templateId: string, cloud: string = CLOUD): Monitor {
  const template: OpenStackAlertTemplate | OpenStackLogAlertTemplate =
    getOpenStackAlertTemplateById(templateId) ||
    getAllOpenStackLogAlertTemplates().find(
      (log: OpenStackLogAlertTemplate): boolean => {
        return log.id === templateId;
      },
    )!;

  const step: MonitorStep = template.getMonitorStep({
    cloudIdentifier: cloud,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: cloud,
  });

  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: ObjectID.generate(),
  };

  const monitor: Monitor = new Monitor();
  monitor.id = ObjectID.generate();
  monitor.projectId = PROJECT_ID;
  monitor.monitorType = step.data?.logMonitor
    ? MonitorType.Logs
    : MonitorType.OpenStack;
  monitor.monitorSteps = monitorSteps;

  return monitor;
}

// The links written, by the monitor they were written on.
function linksWritten(
  update: jest.SpiedFunction<never>,
): Map<string, Array<string>> {
  const links: Map<string, Array<string>> = new Map();

  for (const call of update.mock.calls as unknown as Array<
    [{ id: ObjectID; data: { dependsOnMonitors: Array<Monitor> } }]
  >) {
    links.set(
      call[0].id.toString(),
      call[0].data.dependsOnMonitors.map((parent: Monitor): string => {
        return parent.id!.toString();
      }),
    );
  }

  return links;
}

describe("which template a monitor was made from", () => {
  test.each(
    getAllOpenStackAlertTemplates().map(
      (template: OpenStackAlertTemplate): [string] => {
        return [template.id];
      },
    ),
  )("%s is told from every other", (id: string) => {
    const monitor: Monitor = monitorOf(id);

    expect(
      Array.from(
        getOpenStackTemplateOfMonitors({
          cloud: CLOUD,
          monitors: [monitor],
        }).keys(),
      ),
    ).toEqual([id]);
  });

  test("a Logs monitor on the cloud's logs is told too, and says which cloud", () => {
    const monitor: Monitor = monitorOf(
      OPENSTACK_RABBITMQ_CONNECTION_LOST_TEMPLATE_ID,
    );

    expect(getCloudOfOpenStackMonitor(monitor)).toBe(CLOUD);
    expect(
      Array.from(
        getOpenStackTemplateOfMonitors({
          cloud: CLOUD,
          monitors: [monitor],
        }).keys(),
      ),
    ).toEqual([OPENSTACK_RABBITMQ_CONNECTION_LOST_TEMPLATE_ID]);
  });

  test("a monitor someone wrote themselves is no template's", () => {
    const monitor: Monitor = monitorOf("openstack-rabbitmq-down");
    monitor.monitorSteps!.data!.monitorStepsInstanceArray[0]!.data!.openstackMonitor!.metricViewConfig.queryConfigs[0]!.metricQueryData.filterData.metricName =
      "something_else";

    expect(
      getOpenStackTemplateOfMonitors({
        cloud: CLOUD,
        monitors: [monitor],
      }).size,
    ).toBe(0);
  });
});

describe("who waits for whom", () => {
  test("only what reads the whole of a dependency is waited for", () => {
    const parents: Set<string> = new Set<string>(
      getAllOpenStackAlertTemplates()
        .map((template: OpenStackAlertTemplate): string => {
          return template.id;
        })
        .concat(
          getAllOpenStackLogAlertTemplates().map(
            (template: OpenStackLogAlertTemplate): string => {
              return template.id;
            },
          ),
        )
        .flatMap((id: string): Array<string> => {
          return getOpenStackTemplateParents(id);
        }),
    );

    /*
     * A parent about one machine would quiet its child's alerts about every other machine
     * for as long as that one machine stayed down. Each of these reads a whole region, but for
     * the two on one machine's switch, which OpenStackDependencySuppression holds to the agents
     * that live on it, and libvirt, which it holds to a nova-compute that says it disabled itself.
     */
    for (const parent of parents) {
      if (
        parent === "openstack-ovn-controller-not-running" ||
        parent === "openstack-ovs-service-down"
      ) {
        expect(getOpenStackTemplateChildren(parent)).toEqual([
          "openstack-network-agent-down",
        ]);
        continue;
      }

      if (parent === "openstack-libvirt-service-down") {
        expect(getOpenStackTemplateChildren(parent)).toEqual([
          "openstack-compute-service-disabled",
        ]);
        continue;
      }

      const template: OpenStackAlertTemplate =
        getOpenStackAlertTemplateById(parent)!;
      const step: MonitorStep = template.getMonitorStep({
        cloudIdentifier: CLOUD,
        onlineMonitorStatusId: ObjectID.generate(),
        offlineMonitorStatusId: ObjectID.generate(),
        defaultIncidentSeverityId: ObjectID.generate(),
        defaultAlertSeverityId: ObjectID.generate(),
        monitorName: CLOUD,
      });

      // A database's leader is that whole database's.
      expect({
        parent,
        groups: MonitorStep.getGroupByAttributeKeys(step),
      }).toEqual({
        parent,
        groups:
          parent === "openstack-ovn-database-without-leader"
            ? ["openstack.region.name", "database"]
            : ["openstack.region.name"],
      });
    }
    expect(parents.size).toBeGreaterThan(0);
  });

  test("a stopped RabbitMQ holds back every worker's alert, and the logs that say the same", () => {
    for (const child of [
      "openstack-compute-service-down",
      "openstack-scheduler-or-conductor-down",
      "openstack-every-scheduler-or-conductor-down",
      "openstack-network-agent-down",
      "openstack-block-storage-service-down",
      "openstack-rabbitmq-node-down",
      OPENSTACK_RABBITMQ_CONNECTION_LOST_TEMPLATE_ID,
    ]) {
      expect(getOpenStackTemplateParents(child)).toContain(
        "openstack-rabbitmq-down",
      );
    }
  });

  test("a stopped MariaDB holds back every API's and every worker's alert, and the logs that say the same", () => {
    for (const child of [
      "openstack-identity-api-down",
      "openstack-compute-api-down",
      "openstack-network-api-down",
      "openstack-block-storage-api-down",
      "openstack-image-api-down",
      "openstack-placement-api-down",
      "openstack-compute-service-down",
      "openstack-galera-node-not-ready",
      OPENSTACK_DATABASE_CONNECTION_LOST_TEMPLATE_ID,
    ]) {
      expect(getOpenStackTemplateParents(child)).toContain(
        "openstack-mariadb-cluster-down",
      );
    }
  });

  test("nothing waits for itself, and no waiting goes round in a circle", () => {
    for (const template of getAllOpenStackAlertTemplates()) {
      const parents: Array<string> = getOpenStackTemplateParents(template.id);

      expect(parents).not.toContain(template.id);

      for (const parent of parents) {
        expect(getOpenStackTemplateParents(parent)).not.toContain(template.id);
      }
    }
  });

  test("what waits reads a longer window than what it waits for, so the parent speaks first", () => {
    const windowOf: (id: string) => string = (id: string): string => {
      const step: MonitorStep = getOpenStackAlertTemplateById(
        id,
      )!.getMonitorStep({
        cloudIdentifier: CLOUD,
        onlineMonitorStatusId: ObjectID.generate(),
        offlineMonitorStatusId: ObjectID.generate(),
        defaultIncidentSeverityId: ObjectID.generate(),
        defaultAlertSeverityId: ObjectID.generate(),
        monitorName: CLOUD,
      });
      return step.data!.openstackMonitor!.rollingTime;
    };
    const longer: Record<string, ReadonlyArray<string>> = {
      "Past 5 Minutes": ["Past 10 Minutes", "Past 15 Minutes"],
    };

    for (const template of getAllOpenStackControlPlaneAlertTemplates()) {
      for (const child of getOpenStackTemplateChildren(template.id)) {
        if (getOpenStackAlertTemplateById(child)) {
          /*
           * HAProxy's exporter is inside it, so its own series go with it. What reads them
           * cannot fire while it is down, whatever its window, and has nothing to outlast.
           */
          if (
            template.id === "openstack-haproxy-down" &&
            child.startsWith("openstack-haproxy-")
          ) {
            continue;
          }

          expect({
            child,
            isLonger: longer[windowOf(template.id)]?.includes(windowOf(child)),
          }).toEqual({ child, isLonger: true });
        }
      }
    }
  });
});

describe("linking a new monitor", () => {
  let update: jest.SpiedFunction<never>;
  let find: jest.SpiedFunction<never>;
  let others: Array<Monitor>;

  beforeEach(() => {
    others = [];
    find = jest.spyOn(MonitorService, "findBy").mockImplementation((() => {
      return Promise.resolve(others);
    }) as never) as unknown as jest.SpiedFunction<never>;
    update = jest
      .spyOn(MonitorService, "updateOneById")
      .mockResolvedValue(
        undefined as never,
      ) as unknown as jest.SpiedFunction<never>;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function link(monitor: Monitor): Promise<void> {
    await OpenStackMonitorDependencies.linkMonitor({
      monitorId: monitor.id!,
      projectId: PROJECT_ID,
      monitorType: monitor.monitorType,
      monitor,
    });
  }

  test("a worker's monitor made after its parents waits for them", async () => {
    const rabbit: Monitor = monitorOf("openstack-rabbitmq-down");
    const database: Monitor = monitorOf("openstack-mariadb-cluster-down");
    const memcached: Monitor = monitorOf("openstack-memcached-cluster-down");
    others = [rabbit, database, memcached];

    const worker: Monitor = monitorOf("openstack-compute-service-down");
    await link(worker);

    expect(linksWritten(update)).toEqual(
      new Map([
        [
          worker.id!.toString(),
          [rabbit.id!.toString(), database.id!.toString()],
        ],
      ]),
    );
  });

  test("a parent made after its children has them wait for it, keeping what they wait for already", async () => {
    const existingParent: Monitor = monitorOf("openstack-mariadb-cluster-down");
    const worker: Monitor = monitorOf("openstack-compute-service-down");
    worker.dependsOnMonitors = [existingParent];
    const log: Monitor = monitorOf(
      OPENSTACK_RABBITMQ_CONNECTION_LOST_TEMPLATE_ID,
    );
    others = [existingParent, worker, log];

    const rabbit: Monitor = monitorOf("openstack-rabbitmq-down");
    await link(rabbit);

    expect(linksWritten(update)).toEqual(
      new Map([
        [
          worker.id!.toString(),
          [existingParent.id!.toString(), rabbit.id!.toString()],
        ],
        [log.id!.toString(), [rabbit.id!.toString()]],
      ]),
    );
  });

  test("another cloud's monitors have nothing to do with it", async () => {
    others = [monitorOf("openstack-rabbitmq-down", "another-cloud")];

    await link(monitorOf("openstack-compute-service-down"));

    expect(update).not.toHaveBeenCalled();
  });

  test("a monitor that waits for nothing and has nothing waiting reads nothing else", async () => {
    await link(monitorOf("openstack-memcached-evictions-high"));

    expect(find).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  test("any other monitor costs no query at all", async () => {
    const monitor: Monitor = new Monitor();
    monitor.id = ObjectID.generate();
    monitor.monitorType = MonitorType.Website;

    await link(monitor);

    const logs: Monitor = new Monitor();
    logs.id = ObjectID.generate();
    logs.monitorType = MonitorType.Logs;

    await link(logs);

    expect(find).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  test("a failed read leaves the monitor made, and unlinked", async () => {
    find.mockImplementation((() => {
      return Promise.reject(new Error("no database"));
    }) as never);

    await expect(
      link(monitorOf("openstack-compute-service-down")),
    ).resolves.toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });
});
