import DatabaseConfig from "../../../../Server/DatabaseConfig";
import AlertService from "../../../../Server/Services/AlertService";
import CephClusterService from "../../../../Server/Services/CephClusterService";
import DatabaseServerService from "../../../../Server/Services/DatabaseServerService";
import DockerHostService from "../../../../Server/Services/DockerHostService";
import DockerSwarmClusterService from "../../../../Server/Services/DockerSwarmClusterService";
import HostService from "../../../../Server/Services/HostService";
import IncidentService from "../../../../Server/Services/IncidentService";
import KubernetesClusterService from "../../../../Server/Services/KubernetesClusterService";
import MonitorService from "../../../../Server/Services/MonitorService";
import PodmanHostService from "../../../../Server/Services/PodmanHostService";
import ProxmoxClusterService from "../../../../Server/Services/ProxmoxClusterService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import ServiceService from "../../../../Server/Services/ServiceService";
import VMwareVCenterService from "../../../../Server/Services/VMwareVCenterService";
import LinkedAffectedResources, {
  LINKED_AFFECTED_RESOURCE_RELATIONS,
  LinkedAffectedResource,
  LinkedAffectedResourceRelation,
  LinkedAffectedResourceType,
} from "../../../../Server/Utils/AffectedResources/LinkedAffectedResources";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import URL from "../../../../Types/API/URL";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { getSloDashboardUrl } from "../../../../Utils/Slo/SloAffectedResourceMarkdown";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * LinkedAffectedResources is what every server-side "Resources Affected"
 * text is built from - feed items, owner and on-call emails, workspace
 * summaries. It used to be monitor names only, while the dashboard's
 * Affected Resources cards listed every relation, so an SLO burn-rate
 * alert's on-call email said "No resources identified" beside a card that
 * named the SLO.
 */

const DASHBOARD: string = "https://oneuptime.example/dashboard";
const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-dddd-4aaa-8bbb-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-dddd-4aaa-8bbb-000000000009",
);
const RECORD_ID: ObjectID = new ObjectID(
  "0193c0de-dddd-4aaa-8bbb-000000000002",
);
const OTHER_RECORD_ID: ObjectID = new ObjectID(
  "0193c0de-dddd-4aaa-8bbb-000000000003",
);

const MONITOR_ID: string = "0193c0de-dddd-4aaa-8bbb-0000000000a1";
const HOST_ID: string = "0193c0de-dddd-4aaa-8bbb-0000000000b1";
const OTHER_HOST_ID: string = "0193c0de-dddd-4aaa-8bbb-0000000000b2";
const CLUSTER_ID: string = "0193c0de-dddd-4aaa-8bbb-0000000000d1";
const SERVICE_ID: string = "0193c0de-dddd-4aaa-8bbb-0000000000e1";
const SLO_ID: string = "0193c0de-dddd-4aaa-8bbb-0000000000c1";
const SITE_ID: string = "0193c0de-dddd-4aaa-8bbb-0000000000f1";

function row(
  id: string | undefined,
  name: string,
  projectId: ObjectID = PROJECT_ID,
): JSONObject {
  const value: JSONObject = {
    name: name,
    projectId: projectId as unknown as JSONObject,
  };

  if (id !== undefined) {
    value["_id"] = id;
  }

  return value;
}

function resource(
  type: LinkedAffectedResourceType,
  id: string,
  name: string,
): LinkedAffectedResource {
  return { type, id, name };
}

beforeEach(() => {
  /*
   * For the services' own link builders. A fresh URL per call: URL.addRoute
   * mutates, so a shared one would hide a missing copy.
   */
  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockImplementation(async (): Promise<URL> => {
      return URL.fromString(DASHBOARD);
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the relation table", () => {
  test("covers the categories the dashboard's Affected Resources cards render, in their order", () => {
    const displaySource: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesDisplay.tsx",
      ),
      { encoding: "utf8" },
    );

    const propsBlock: string = displaySource.slice(
      displaySource.indexOf("export interface ComponentProps {"),
      displaySource.indexOf("hideMonitors?:"),
    );

    const displayedColumns: Array<string> = Array.from(
      propsBlock.matchAll(/^\s+(\w+)\?: Array<\w+> \| undefined;$/gm),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    // Sanity: the parse found the lists, not nothing.
    expect(displayedColumns).toContain("serviceLevelObjectives");

    // An alert's singular `monitor` is the same category as `monitors`.
    expect(
      LINKED_AFFECTED_RESOURCE_RELATIONS.map(
        (relation: LinkedAffectedResourceRelation): string => {
          return relation.column;
        },
      ).filter((column: string): boolean => {
        return column !== "monitor";
      }),
    ).toEqual(displayedColumns);
  });

  test("an incident is read for everything but network sites, with SLOs last", () => {
    expect(
      LinkedAffectedResources.getRelations(new Incident()).map(
        (relation: LinkedAffectedResourceRelation): string => {
          return relation.column;
        },
      ),
    ).toEqual([
      "monitors",
      "hosts",
      "kubernetesClusters",
      "dockerHosts",
      "podmanHosts",
      "proxmoxClusters",
      "vmwareVCenters",
      "cephClusters",
      "dockerSwarmClusters",
      "iotFleets",
      "databaseServers",
      "services",
      "serviceLevelObjectives",
    ]);
  });

  test("an alert is read for its single monitor and its SLOs", () => {
    const columns: Array<string> = LinkedAffectedResources.getRelations(
      new Alert(),
    ).map((relation: LinkedAffectedResourceRelation): string => {
      return relation.column;
    });

    expect(columns[0]).toBe("monitor");
    expect(columns).not.toContain("monitors");
    expect(columns).not.toContain("networkSites");
    expect(columns).toContain("hosts");
    expect(columns[columns.length - 1]).toBe("serviceLevelObjectives");
  });

  test("a scheduled maintenance event is read for its network sites and has no SLOs", () => {
    const columns: Array<string> = LinkedAffectedResources.getRelations(
      new ScheduledMaintenance(),
    ).map((relation: LinkedAffectedResourceRelation): string => {
      return relation.column;
    });

    expect(columns[0]).toBe("monitors");
    expect(columns).toContain("networkSites");
    expect(columns).not.toContain("serviceLevelObjectives");
  });
});

describe("dashboard links match each resource's own link", () => {
  const PROJECT: ObjectID = PROJECT_ID;
  const ID: ObjectID = new ObjectID(HOST_ID);

  type LinkBuilder = () => Promise<URL>;

  const CANONICAL: Array<[LinkedAffectedResourceType, LinkBuilder]> = [
    [
      LinkedAffectedResourceType.Monitor,
      (): Promise<URL> => {
        return MonitorService.getMonitorLinkInDashboard(PROJECT, ID);
      },
    ],
    [
      LinkedAffectedResourceType.Host,
      (): Promise<URL> => {
        return HostService.getHostLinkInDashboard(PROJECT, ID);
      },
    ],
    [
      LinkedAffectedResourceType.KubernetesCluster,
      (): Promise<URL> => {
        return KubernetesClusterService.getKubernetesClusterLinkInDashboard(
          PROJECT,
          ID,
        );
      },
    ],
    [
      LinkedAffectedResourceType.DockerHost,
      (): Promise<URL> => {
        return DockerHostService.getDockerHostLinkInDashboard(PROJECT, ID);
      },
    ],
    [
      LinkedAffectedResourceType.PodmanHost,
      (): Promise<URL> => {
        return PodmanHostService.getPodmanHostLinkInDashboard(PROJECT, ID);
      },
    ],
    [
      LinkedAffectedResourceType.ProxmoxCluster,
      (): Promise<URL> => {
        return ProxmoxClusterService.getProxmoxClusterLinkInDashboard(
          PROJECT,
          ID,
        );
      },
    ],
    [
      LinkedAffectedResourceType.VMwareVCenter,
      (): Promise<URL> => {
        return VMwareVCenterService.getVMwareVCenterLinkInDashboard(
          PROJECT,
          ID,
        );
      },
    ],
    [
      LinkedAffectedResourceType.CephCluster,
      (): Promise<URL> => {
        return CephClusterService.getCephClusterLinkInDashboard(PROJECT, ID);
      },
    ],
    [
      LinkedAffectedResourceType.DockerSwarmCluster,
      (): Promise<URL> => {
        return DockerSwarmClusterService.getDockerSwarmClusterLinkInDashboard(
          PROJECT,
          ID,
        );
      },
    ],
    [
      LinkedAffectedResourceType.DatabaseServer,
      (): Promise<URL> => {
        return DatabaseServerService.getDatabaseServerLinkInDashboard(
          PROJECT,
          ID,
        );
      },
    ],
    [
      LinkedAffectedResourceType.Service,
      (): Promise<URL> => {
        return ServiceService.getServiceLinkInDashboard(PROJECT, ID);
      },
    ],
    [
      LinkedAffectedResourceType.ServiceLevelObjective,
      async (): Promise<URL> => {
        return getSloDashboardUrl({
          dashboardUrl: URL.fromString(DASHBOARD),
          projectId: PROJECT,
          sloId: ID,
        });
      },
    ],
  ];

  test.each(CANONICAL)(
    "%s",
    async (type: LinkedAffectedResourceType, canonical: LinkBuilder) => {
      expect(
        LinkedAffectedResources.getDashboardUrl({
          dashboardUrl: URL.fromString(DASHBOARD),
          projectId: PROJECT,
          resource: resource(type, ID.toString(), "x"),
        }).toString(),
      ).toBe((await canonical()).toString());
    },
  );

  /*
   * No server-side link helper exists for these two; the routes are the
   * dashboard's IOT_FLEET_VIEW and NETWORK_SITE_VIEW.
   */
  test.each([
    [LinkedAffectedResourceType.IoTFleet, "iot"],
    [LinkedAffectedResourceType.NetworkSite, "network-sites/view"],
  ])("%s", (type: LinkedAffectedResourceType, route: string) => {
    expect(
      LinkedAffectedResources.getDashboardUrl({
        dashboardUrl: URL.fromString(DASHBOARD),
        projectId: PROJECT,
        resource: resource(type, ID.toString(), "x"),
      }).toString(),
    ).toBe(`${DASHBOARD}/${PROJECT.toString()}/${route}/${ID.toString()}`);
  });

  test("does not mutate the caller's dashboard URL", () => {
    const dashboardUrl: URL = URL.fromString(DASHBOARD);

    LinkedAffectedResources.getDashboardUrl({
      dashboardUrl,
      projectId: PROJECT,
      resource: resource(LinkedAffectedResourceType.Host, HOST_ID, "x"),
    });

    expect(dashboardUrl.toString()).toBe(DASHBOARD);
  });
});

describe("collect", () => {
  test("lists every relation in display order, whatever order the records come in", () => {
    const resources: Array<LinkedAffectedResource> =
      LinkedAffectedResources.collect({
        projectId: PROJECT_ID,
        records: [
          {
            projectId: PROJECT_ID,
            serviceLevelObjectives: [row(SLO_ID, "Checkout")],
          },
          {
            projectId: PROJECT_ID,
            services: [row(SERVICE_ID, "checkout-api")],
          },
          { projectId: PROJECT_ID, hosts: [row(HOST_ID, "web-01")] },
          {
            projectId: PROJECT_ID,
            kubernetesClusters: [row(CLUSTER_ID, "prod-eu")],
          },
          {
            projectId: PROJECT_ID,
            monitors: [row(MONITOR_ID, "checkout-web")],
          },
        ],
      });

    expect(resources).toEqual([
      resource(LinkedAffectedResourceType.Monitor, MONITOR_ID, "checkout-web"),
      resource(LinkedAffectedResourceType.Host, HOST_ID, "web-01"),
      resource(
        LinkedAffectedResourceType.KubernetesCluster,
        CLUSTER_ID,
        "prod-eu",
      ),
      resource(LinkedAffectedResourceType.Service, SERVICE_ID, "checkout-api"),
      resource(
        LinkedAffectedResourceType.ServiceLevelObjective,
        SLO_ID,
        "Checkout",
      ),
    ]);
  });

  test("reads an alert's singular monitor", () => {
    expect(
      LinkedAffectedResources.collect({
        projectId: PROJECT_ID,
        records: [{ projectId: PROJECT_ID, monitor: row(MONITOR_ID, "api") }],
      }),
    ).toEqual([
      resource(LinkedAffectedResourceType.Monitor, MONITOR_ID, "api"),
    ]);
  });

  test("an alert without a monitor has none", () => {
    expect(
      LinkedAffectedResources.collect({
        projectId: PROJECT_ID,
        records: [{ projectId: PROJECT_ID, monitor: null }],
      }),
    ).toEqual([]);
  });

  test("leaves out another project's resource, linked before the write guard", () => {
    const resources: Array<LinkedAffectedResource> =
      LinkedAffectedResources.collect({
        projectId: PROJECT_ID,
        records: [
          {
            projectId: PROJECT_ID,
            hosts: [
              row(OTHER_HOST_ID, "db-of-another-project", OTHER_PROJECT_ID),
              row(HOST_ID, "web-01"),
            ],
          },
        ],
      });

    expect(resources).toEqual([
      resource(LinkedAffectedResourceType.Host, HOST_ID, "web-01"),
    ]);
  });

  test("leaves out a resource read without its project", () => {
    expect(
      LinkedAffectedResources.collect({
        projectId: PROJECT_ID,
        records: [
          { projectId: PROJECT_ID, hosts: [{ _id: HOST_ID, name: "web-01" }] },
        ],
      }),
    ).toEqual([]);
  });

  test("leaves out a record of another project entirely", () => {
    expect(
      LinkedAffectedResources.collect({
        projectId: PROJECT_ID,
        records: [
          {
            projectId: OTHER_PROJECT_ID,
            hosts: [row(HOST_ID, "web-01")],
          },
        ],
      }),
    ).toEqual([]);
  });

  test("the project comparison ignores case and padding", () => {
    expect(
      LinkedAffectedResources.collect({
        projectId: PROJECT_ID,
        records: [
          {
            projectId: ` ${PROJECT_ID.toString().toUpperCase()} `,
            hosts: [
              {
                _id: HOST_ID,
                name: "web-01",
                projectId: PROJECT_ID.toString().toUpperCase(),
              },
            ],
          },
        ],
      }),
    ).toEqual([resource(LinkedAffectedResourceType.Host, HOST_ID, "web-01")]);
  });

  test("a row without an id cannot be linked and is skipped", () => {
    expect(
      LinkedAffectedResources.collect({
        projectId: PROJECT_ID,
        records: [
          {
            projectId: PROJECT_ID,
            hosts: [row(undefined, "unsaved"), null],
          },
        ],
      }),
    ).toEqual([]);
  });

  test("the same resource on several records is listed once", () => {
    expect(
      LinkedAffectedResources.collect({
        projectId: PROJECT_ID,
        records: [
          { projectId: PROJECT_ID, hosts: [row(HOST_ID, "web-01")] },
          { projectId: PROJECT_ID, hosts: [row(HOST_ID, "web-01")] },
          null,
          undefined,
        ],
      }),
    ).toEqual([resource(LinkedAffectedResourceType.Host, HOST_ID, "web-01")]);
  });

  test("a monitor and a host that share an id are still two resources", () => {
    expect(
      LinkedAffectedResources.collect({
        projectId: PROJECT_ID,
        records: [
          {
            projectId: PROJECT_ID,
            monitors: [row(HOST_ID, "web-01 ping")],
            hosts: [row(HOST_ID, "web-01")],
          },
        ],
      }),
    ).toHaveLength(2);
  });
});

describe("reading a record's relations", () => {
  /*
   * Answers each per-relation read from `fixture`, the way the database
   * would: one row per matching record, carrying only the relation that was
   * selected.
   */
  function answerFrom(
    service: { findAllBy: unknown },
    fixture: Array<JSONObject>,
  ): jest.SpyInstance {
    return jest
      .spyOn(service as typeof IncidentService, "findAllBy")
      .mockImplementation((async (findAllBy: {
        select: JSONObject;
      }): Promise<Array<JSONObject>> => {
        const column: string = Object.keys(findAllBy.select).find(
          (key: string): boolean => {
            return key !== "_id" && key !== "projectId";
          },
        )!;

        return fixture.map((record: JSONObject): JSONObject => {
          return {
            _id: record["_id"],
            projectId: record["projectId"],
            [column]: record[column],
          };
        });
      }) as never);
  }

  test("reads each relation separately, as root, scoped to the record's project", async () => {
    const findAllBy: jest.SpyInstance = answerFrom(IncidentService, [
      {
        _id: RECORD_ID.toString(),
        projectId: PROJECT_ID as unknown as JSONObject,
        monitors: [row(MONITOR_ID, "checkout-web")],
        hosts: [row(HOST_ID, "web-01")],
        serviceLevelObjectives: [row(SLO_ID, "Checkout")],
      },
    ]);

    const resources: Array<LinkedAffectedResource> =
      await LinkedAffectedResources.readForIncident({
        service: IncidentService,
        projectId: PROJECT_ID,
        incidentId: RECORD_ID,
      });

    expect(resources).toEqual([
      resource(LinkedAffectedResourceType.Monitor, MONITOR_ID, "checkout-web"),
      resource(LinkedAffectedResourceType.Host, HOST_ID, "web-01"),
      resource(
        LinkedAffectedResourceType.ServiceLevelObjective,
        SLO_ID,
        "Checkout",
      ),
    ]);

    expect(findAllBy).toHaveBeenCalledTimes(
      LinkedAffectedResources.getRelations(new Incident()).length,
    );

    for (const call of findAllBy.mock.calls) {
      const args: {
        query: JSONObject;
        select: JSONObject;
        props: JSONObject;
      } = call[0];

      expect(args.props).toEqual({ isRoot: true });
      expect(args.query["projectId"]).toBe(PROJECT_ID);
      expect(JSON.stringify(args.query["_id"])).toContain(RECORD_ID.toString());

      // One relation per read, with the related row's project to check it against.
      const relationKeys: Array<string> = Object.keys(args.select).filter(
        (key: string): boolean => {
          return key !== "_id" && key !== "projectId";
        },
      );

      expect(relationKeys).toHaveLength(1);
      expect(args.select[relationKeys[0]!]).toEqual({
        _id: true,
        name: true,
        projectId: true,
      });
      expect(args.select["projectId"]).toBe(true);
    }
  });

  test("an SLO burn-rate alert with no monitor reads as its SLO", async () => {
    answerFrom(AlertService, [
      {
        _id: RECORD_ID.toString(),
        projectId: PROJECT_ID as unknown as JSONObject,
        monitor: null,
        serviceLevelObjectives: [row(SLO_ID, "Checkout availability")],
      },
    ]);

    const resources: Array<LinkedAffectedResource> =
      await LinkedAffectedResources.readForAlert({
        service: AlertService,
        projectId: PROJECT_ID,
        alertId: RECORD_ID,
      });

    expect(
      LinkedAffectedResources.getText({
        resources,
        fallback: "No resources identified",
      }),
    ).toBe("Checkout availability");
  });

  test("merges and de-duplicates across several records", async () => {
    answerFrom(AlertService, [
      {
        _id: RECORD_ID.toString(),
        projectId: PROJECT_ID as unknown as JSONObject,
        monitor: row(MONITOR_ID, "checkout-web"),
        hosts: [row(HOST_ID, "web-01")],
      },
      {
        _id: OTHER_RECORD_ID.toString(),
        projectId: PROJECT_ID as unknown as JSONObject,
        monitor: row(MONITOR_ID, "checkout-web"),
        hosts: [row(OTHER_HOST_ID, "web-02")],
      },
    ]);

    const resources: Array<LinkedAffectedResource> =
      await LinkedAffectedResources.readForAlerts({
        service: AlertService,
        projectId: PROJECT_ID,
        alertIds: [RECORD_ID, OTHER_RECORD_ID, RECORD_ID],
      });

    expect(resources).toEqual([
      resource(LinkedAffectedResourceType.Monitor, MONITOR_ID, "checkout-web"),
      resource(LinkedAffectedResourceType.Host, HOST_ID, "web-01"),
      resource(LinkedAffectedResourceType.Host, OTHER_HOST_ID, "web-02"),
    ]);
  });

  test("reads a scheduled maintenance event's network sites", async () => {
    answerFrom(ScheduledMaintenanceService, [
      {
        _id: RECORD_ID.toString(),
        projectId: PROJECT_ID as unknown as JSONObject,
        networkSites: [row(SITE_ID, "London DC")],
      },
    ]);

    expect(
      await LinkedAffectedResources.readForScheduledMaintenance({
        service: ScheduledMaintenanceService,
        projectId: PROJECT_ID,
        scheduledMaintenanceId: RECORD_ID,
      }),
    ).toEqual([
      resource(LinkedAffectedResourceType.NetworkSite, SITE_ID, "London DC"),
    ]);
  });

  test("no records, no reads", async () => {
    const findAllBy: jest.SpyInstance = answerFrom(IncidentService, []);

    expect(
      await LinkedAffectedResources.readForIncidents({
        service: IncidentService,
        projectId: PROJECT_ID,
        incidentIds: [],
      }),
    ).toEqual([]);
    expect(findAllBy).not.toHaveBeenCalled();
  });
});

describe("plain-text names", () => {
  const RESOURCES: Array<LinkedAffectedResource> = [
    resource(LinkedAffectedResourceType.Monitor, MONITOR_ID, "checkout-web"),
    resource(LinkedAffectedResourceType.Host, HOST_ID, "web-01"),
    resource(
      LinkedAffectedResourceType.ServiceLevelObjective,
      SLO_ID,
      "Checkout availability",
    ),
  ];

  test("names every resource, comma separated", () => {
    expect(
      LinkedAffectedResources.getText({
        resources: RESOURCES,
        fallback: "None",
      }),
    ).toBe("checkout-web, web-01, Checkout availability");
  });

  test("falls back when nothing is linked", () => {
    expect(
      LinkedAffectedResources.getText({
        resources: [],
        fallback: "No resources identified",
      }),
    ).toBe("No resources identified");
  });

  test("a series summary takes the monitor's place, the rest still follow", () => {
    expect(
      LinkedAffectedResources.getNames({
        resources: RESOURCES,
        seriesSummary: "Pod: checkout-7d9f-2xk | Namespace: shop",
      }),
    ).toEqual([
      "Pod: checkout-7d9f-2xk | Namespace: shop",
      "web-01",
      "Checkout availability",
    ]);
  });

  test("an empty series summary keeps the monitor", () => {
    expect(
      LinkedAffectedResources.getNames({
        resources: RESOURCES,
        seriesSummary: "  ",
      }),
    ).toEqual(["checkout-web", "web-01", "Checkout availability"]);
  });

  test("a name shared by two resources is printed once, and blanks are skipped", () => {
    expect(
      LinkedAffectedResources.getNames({
        resources: [
          resource(LinkedAffectedResourceType.Monitor, MONITOR_ID, "web-01"),
          resource(LinkedAffectedResourceType.Host, HOST_ID, " web-01 "),
          resource(LinkedAffectedResourceType.Service, SERVICE_ID, ""),
        ],
      }),
    ).toEqual(["web-01"]);
  });

  test("the text is not escaped here - the email templates escape it", () => {
    expect(
      LinkedAffectedResources.getText({
        resources: [
          resource(LinkedAffectedResourceType.Host, HOST_ID, "<b>web</b>"),
        ],
        fallback: "None",
      }),
    ).toBe("<b>web</b>");
  });
});

describe("feed markdown", () => {
  function getMarkdownLines(
    resources: Array<LinkedAffectedResource>,
  ): Array<string> {
    return LinkedAffectedResources.getMarkdownLines({
      dashboardUrl: URL.fromString(DASHBOARD),
      projectId: PROJECT_ID,
      resources,
    });
  }

  test("keeps the monitor bullet, labels the rest, and ends with the SLO", () => {
    expect(
      getMarkdownLines([
        resource(
          LinkedAffectedResourceType.ServiceLevelObjective,
          SLO_ID,
          "Checkout availability",
        ),
        resource(
          LinkedAffectedResourceType.Monitor,
          MONITOR_ID,
          "checkout-web",
        ),
        resource(LinkedAffectedResourceType.Host, HOST_ID, "web-01"),
        resource(
          LinkedAffectedResourceType.KubernetesCluster,
          CLUSTER_ID,
          "prod-eu",
        ),
      ]),
    ).toEqual([
      `- [checkout-web](${DASHBOARD}/${PROJECT_ID.toString()}/monitors/${MONITOR_ID})`,
      `- [Host web\\-01](${DASHBOARD}/${PROJECT_ID.toString()}/host/${HOST_ID})`,
      `- [Kubernetes Cluster prod\\-eu](${DASHBOARD}/${PROJECT_ID.toString()}/kubernetes/${CLUSTER_ID})`,
      `- [SLO Checkout availability](${DASHBOARD}/${PROJECT_ID.toString()}/slos/${SLO_ID})`,
    ]);
  });

  test("the monitor bullet is the one the created feeds always printed", async () => {
    const [line]: Array<string> = getMarkdownLines([
      resource(LinkedAffectedResourceType.Monitor, MONITOR_ID, "checkout-web"),
    ]);

    expect(line).toBe(
      `- [checkout-web](${(
        await MonitorService.getMonitorLinkInDashboard(
          PROJECT_ID,
          new ObjectID(MONITOR_ID),
        )
      ).toString()})`,
    );
  });

  test("a hostile host name cannot re-point its link, add an image or start a heading", () => {
    const [line]: Array<string> = getMarkdownLines([
      resource(
        LinkedAffectedResourceType.Host,
        HOST_ID,
        "web](https://evil.example) ![p](https://tracker.example/p.gif)\n# owned",
      ),
    ]);

    expect(line).not.toContain("](https://evil.example)");
    expect(line).not.toContain("![p](");
    expect(line).not.toContain("\n");
    expect(line).toBe(
      `- [Host web\\]\\(https://evil.example\\) \\!\\[p\\]\\(https://tracker.example/p.gif\\) \\# owned](${DASHBOARD}/${PROJECT_ID.toString()}/host/${HOST_ID})`,
    );
  });

  test("a hostile SLO name is escaped as the SLO helper always has", () => {
    const [line]: Array<string> = getMarkdownLines([
      resource(
        LinkedAffectedResourceType.ServiceLevelObjective,
        SLO_ID,
        "x](https://evil.example)",
      ),
    ]);

    expect(line).not.toContain("](https://evil.example)");
  });

  test("a nameless resource is still linked, by its kind", () => {
    expect(
      getMarkdownLines([
        resource(LinkedAffectedResourceType.Service, SERVICE_ID, ""),
      ]),
    ).toEqual([
      `- [Service](${DASHBOARD}/${PROJECT_ID.toString()}/service/${SERVICE_ID})`,
    ]);
  });

  test("nothing linked, no lines", () => {
    expect(getMarkdownLines([])).toEqual([]);
  });
});
