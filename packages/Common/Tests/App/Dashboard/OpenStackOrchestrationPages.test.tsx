import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, configure, screen } from "@testing-library/react";
import * as React from "react";
import path from "path";
import {
  OpenStackResourceBufferEntry,
} from "../../../Server/Utils/Telemetry/OpenStackSnapshotScan";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import OpenStackCloudContainerClusterDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/ContainerClusterDetail";
import OpenStackCloudContainerClusters from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/ContainerClusters";
import OpenStackCloudStackDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/StackDetail";
import OpenStackCloudStacks from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Stacks";
import {
  OPENSTACK_FIXTURES_FOLDER,
  readRecordedSeries,
  scanRecordedSeries,
} from "../../Helpers/OpenStackRecordedRows";
import {
  Row,
  attentionRowsOf,
  partPath,
  renderPage,
  resetServer,
  server,
  settle,
  tableRow,
  tile,
} from "./OpenStackPartHarness";

/*
 * The pages of a service a cloud may not run, rendered for real over the real tables and part cards
 * with only the network replaced, on rows from what a real DevStack recorded where one says, and
 * made up where nothing could reach it: a probe's words, and a cluster that came up. A failed stack
 * and a failed cluster each say so by name, and each page says what this cloud's collector can't see.
 */

configure({ asyncUtilTimeout: 30000 });

jest.setTimeout(300000);

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return ["ProjectOwner"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: ["Public", "User", "CurrentUser"] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): { toString: () => string } => {
        return {
          toString: () => {
            return "80000000-0000-4000-8000-000000000001";
          },
        };
      },
      getName: (): string => {
        return "Test User";
      },
      getEmail: (): string => {
        return "test@example.com";
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceMetricsTab",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="resource-metrics-tab" />;
      },
    };
  },
);

const FOLDER: string = path.join(
  OPENSTACK_FIXTURES_FOLDER,
  "services-heat-magnum",
);

let nextId: number = 1;

function id(): string {
  return `6c1b2a3d-4e5f-4a6b-8c7d-${String(nextId++).padStart(12, "0")}`;
}

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60 * 1000);
}

// A scene's rows, as a row's first sighting: as long in its state as the test says.
function recorded(
  scene: string,
  exporter: string = "exporter",
  stateChangedAt: Date = minutesAgo(5),
): Array<Row> {
  return scanRecordedSeries(
    readRecordedSeries(path.join(FOLDER, scene, exporter)),
    Date.now(),
  ).map((entry: OpenStackResourceBufferEntry): Row => {
    return {
      _id: id(),
      kind: entry.kind,
      name: entry.name,
      externalId: entry.externalId,
      regionName: entry.regionName,
      openStackProjectId: entry.openStackProjectId,
      status: entry.status,
      stateChangedAt,
      facts: entry.facts,
      lastSeenAt: new Date(),
    };
  });
}

function stackId(rows: Array<Row>, name: string): string {
  return rows.find((row: Row): boolean => {
    return row["kind"] === OpenStackResourceKind.Stack && row["name"] === name;
  })!["externalId"] as string;
}

function clusterId(rows: Array<Row>, name: string): string {
  return rows.find((row: Row): boolean => {
    return (
      row["kind"] === OpenStackResourceKind.ContainerCluster &&
      row["name"] === name
    );
  })!["externalId"] as string;
}

beforeEach(() => {
  resetServer();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Stacks", () => {
  test("lists a real cloud's stacks, with each status in Heat's word", async () => {
    server.rows = recorded("heat-baseline");

    await renderPage(OpenStackCloudStacks, "/stacks");
    await settle();

    expect(await screen.findByText("ou-stack-failed")).toBeInTheDocument();
    expect(tableRow("ou-stack-failed")).toHaveTextContent("CREATE_FAILED");
    expect(tableRow("ou-stack-ok")).toHaveTextContent("CREATE_COMPLETE");
  });

  test("an empty list on a cloud that doesn't run Heat says so, and is no error", async () => {
    server.rows = [];

    await renderPage(OpenStackCloudStacks, "/stacks");

    expect(
      await screen.findByText("This cloud doesn't run this service"),
    ).toBeInTheDocument();
  });

  test("an empty list with Heat stopped says the API isn't answering", async () => {
    server.rows = recorded("heat-api-down");

    await renderPage(OpenStackCloudStacks, "/stacks");

    expect(
      await screen.findByText("This service's API isn't answering"),
    ).toBeInTheDocument();
  });

  test("an empty list with Heat up is what a limited credential sees too, so it says that", async () => {
    server.rows = recorded(
      "access-check",
      "exporter/monitoring-role",
    ).filter((row: Row): boolean => {
      return row["kind"] === OpenStackResourceKind.Api;
    });

    await renderPage(OpenStackCloudStacks, "/stacks");

    expect(
      await screen.findByText("No stacks reported yet"),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/Only the Full view credential sees every project/),
    ).toBeInTheDocument();
  });
});

describe("a stack's page", () => {
  test("a failed stack, on what a real cloud said: why it matters, and what the agent can't say", async () => {
    server.rows = recorded("heat-baseline");
    const failed: string = stackId(server.rows, "ou-stack-failed");

    await renderPage(OpenStackCloudStackDetail, partPath("stacks", failed));

    expect(
      await screen.findByTestId("openstack-stack-explanation"),
    ).toHaveTextContent(/stays like this until someone updates or deletes it/);
    expect(attentionRowsOf("openstack-stack-attention")).toEqual([
      "This stack: In CREATE_FAILED",
    ]);
    expect(
      screen.getByTestId("openstack-stack-why-not-known"),
    ).toHaveTextContent(/openstack stack failures list/);
    expect(
      screen.getByTestId("openstack-stack-details-project"),
    ).toHaveTextContent("08945d5897854ec2a11d65d907ec6251");
    expect(
      screen.getByTestId("openstack-stack-owns-not-known"),
    ).toHaveTextContent(/openstack stack resource list/);
  });

  test("a healthy stack needs nothing, and says nothing of why", async () => {
    server.rows = recorded("heat-baseline");
    const ok: string = stackId(server.rows, "ou-stack-ok");

    await renderPage(OpenStackCloudStackDetail, partPath("stacks", ok));
    await screen.findByTestId("openstack-stack-details");

    expect(screen.queryByTestId("openstack-stack-explanation")).toBeNull();
    expect(screen.queryByTestId("openstack-stack-why-not-known")).toBeNull();
    expect(attentionRowsOf("openstack-stack-attention")).toEqual([]);
  });

  test("one left in progress past the line says for how long, and what usually did it", async () => {
    server.rows = recorded(
      "heat-engine-restarted",
      "exporter",
      minutesAgo(180),
    );
    const creating: string = stackId(server.rows, "ou-stack-creating");

    await renderPage(OpenStackCloudStackDetail, partPath("stacks", creating));

    expect(
      await screen.findByTestId("openstack-stack-explanation"),
    ).toHaveTextContent(/a restarted engine does not pick it back up/);
    expect(attentionRowsOf("openstack-stack-attention")).toEqual([
      "This stack: CREATE_IN_PROGRESS for 3h",
    ]);
    expect(tile("openstack-stack-tiles", "In state for")).toHaveTextContent(
      "3h",
    );
  });

  test("a probe's word for why it failed is there, and nothing asks for it", async () => {
    server.rows = recorded("heat-baseline").map((row: Row): Row => {
      return row["name"] === "ou-stack-failed"
        ? {
            ...row,
            facts: {
              statusReason:
                'Resource CREATE failed: ResourceInError: resources.server: Went to status ERROR due to "Message: No valid host was found. , Code: 500"',
            },
          }
        : row;
    });
    const failed: string = stackId(server.rows, "ou-stack-failed");

    await renderPage(OpenStackCloudStackDetail, partPath("stacks", failed));

    expect(
      await screen.findByTestId("openstack-stack-details-reason"),
    ).toHaveTextContent(/No valid host was found/);
    expect(screen.queryByTestId("openstack-stack-why-not-known")).toBeNull();
  });

  test("a stack a plain reader sees has no project, and says why", async () => {
    server.rows = recorded("access-check", "exporter/reader");
    const failed: string = stackId(server.rows, "ou-stack-failed");

    await renderPage(OpenStackCloudStackDetail, partPath("stacks", failed));

    expect(
      await screen.findByTestId("openstack-stack-details-project"),
    ).toHaveTextContent("—");
  });

  test("a stack Magnum built names its cluster, on what a real cloud recorded", async () => {
    server.rows = recorded("access-check", "exporter/admin");
    const stack: string = stackId(server.rows, "ou-cluster-real-rfhmez6mgxk3");

    await renderPage(OpenStackCloudStackDetail, partPath("stacks", stack));

    expect(
      await screen.findByTestId(
        `openstack-stack-details-belongs-to-${clusterId(server.rows, "ou-cluster-real")}`,
      ),
    ).toHaveTextContent("ou-cluster-real");
  });

  test("its alerts are the two that watch every stack", async () => {
    server.rows = recorded("heat-baseline");
    const ok: string = stackId(server.rows, "ou-stack-ok");

    await renderPage(OpenStackCloudStackDetail, partPath("stacks", ok));

    expect(
      await screen.findByTestId("openstack-stack-alerts"),
    ).toHaveTextContent(/Stack Failed[\s\S]*Stack Stuck In Progress/);
  });

  test("one that has gone says so, rather than a blank page", async () => {
    server.rows = recorded("heat-baseline");

    await renderPage(
      OpenStackCloudStackDetail,
      partPath("stacks", "not-a-stack"),
    );

    expect(
      await screen.findByTestId("openstack-stack-not-reported"),
    ).toHaveTextContent(/not in this cloud's inventory/);
  });
});

describe("Kubernetes Clusters", () => {
  test("lists a real cloud's clusters, with what each was asked for", async () => {
    server.rows = recorded("magnum-failed");

    await renderPage(OpenStackCloudContainerClusters, "/kubernetes-clusters");

    expect(
      await screen.findByText("ou-cluster-times-out"),
    ).toBeInTheDocument();
    expect(tableRow("ou-cluster-times-out")).toHaveTextContent("CREATE_FAILED");
    expect(tableRow("ou-cluster-times-out")).toHaveTextContent(
      "1 control plane, 1 worker",
    );
    expect(tableRow("ou-cluster-long")).toHaveTextContent("CREATE_IN_PROGRESS");
  });

  test("a cloud that doesn't run Magnum says so", async () => {
    server.rows = [];

    await renderPage(OpenStackCloudContainerClusters, "/kubernetes-clusters");

    expect(
      await screen.findByText("This cloud doesn't run this service"),
    ).toBeInTheDocument();
  });
});

describe("a Kubernetes cluster's page", () => {
  test("a failed one, on what a real cloud said: no project, and what the agent can't say", async () => {
    server.rows = recorded("magnum-failed");
    const failed: string = clusterId(server.rows, "ou-cluster-times-out");

    await renderPage(
      OpenStackCloudContainerClusterDetail,
      partPath("kubernetes-clusters", failed),
    );

    expect(
      await screen.findByTestId("openstack-container-cluster-explanation"),
    ).toHaveTextContent(/usually there/);
    expect(attentionRowsOf("openstack-container-cluster-attention")).toEqual([
      "This cluster: In CREATE_FAILED",
    ]);
    expect(
      screen.getByTestId("openstack-container-cluster-why-not-known"),
    ).toHaveTextContent(/openstack coe cluster show/);
    expect(
      screen.getByTestId("openstack-container-cluster-details-project"),
    ).toHaveTextContent("—");
    expect(
      tile("openstack-container-cluster-tiles", "Worker nodes"),
    ).toHaveTextContent("1");
    expect(
      tile("openstack-container-cluster-tiles", "Control plane nodes"),
    ).toHaveTextContent("1");
  });

  test("its Heat stack is one step away, by name where Heat said it", async () => {
    server.rows = recorded("access-check", "exporter/admin");
    const cluster: string = clusterId(server.rows, "ou-cluster-real");

    await renderPage(
      OpenStackCloudContainerClusterDetail,
      partPath("kubernetes-clusters", cluster),
    );

    expect(
      await screen.findByTestId("openstack-container-cluster-details-stack"),
    ).toHaveTextContent("ou-cluster-real-rfhmez6mgxk3");
  });

  test("with its stack out of this credential's sight, it goes by the stack's ID", async () => {
    server.rows = recorded("magnum-failed");
    const failed: string = clusterId(server.rows, "ou-cluster-times-out");

    await renderPage(
      OpenStackCloudContainerClusterDetail,
      partPath("kubernetes-clusters", failed),
    );

    expect(
      await screen.findByTestId("openstack-container-cluster-details-stack"),
    ).toHaveTextContent("66b02f15-9492-45b2-84aa-a82a4edf21f7");
  });

  test("a probe's own read of it says the rest", async () => {
    const [cluster]: Array<Row> = recorded("magnum-failed").filter(
      (row: Row): boolean => {
        return row["name"] === "ou-cluster-times-out";
      },
    );
    server.rows = [
      {
        ...cluster,
        openStackProjectId: "4d0acfc18c9d4a0b994a7fe34516bf65",
        facts: {
          ...(cluster!["facts"] as object),
          statusReason: "default-master failed, default-worker failed",
          healthStatus: "UNKNOWN",
          clusterTemplateName: "ou-template",
          coeVersion: "v1.18.16",
        },
      } as Row,
    ];

    await renderPage(
      OpenStackCloudContainerClusterDetail,
      partPath("kubernetes-clusters", cluster!["externalId"] as string),
    );

    expect(
      await screen.findByTestId("openstack-container-cluster-details-reason"),
    ).toHaveTextContent("default-master failed, default-worker failed");
    expect(
      screen.getByTestId("openstack-container-cluster-details-template"),
    ).toHaveTextContent("ou-template");
    expect(
      screen.getByTestId("openstack-container-cluster-details-version"),
    ).toHaveTextContent("v1.18.16");
    expect(
      screen.getByTestId("openstack-container-cluster-details-health"),
    ).toHaveTextContent("UNKNOWN");
    expect(
      screen.getByTestId("openstack-container-cluster-details-project"),
    ).toHaveTextContent("4d0acfc18c9d4a0b994a7fe34516bf65");
    expect(
      screen.queryByTestId("openstack-container-cluster-why-not-known"),
    ).toBeNull();
  });

  test("a healthy one, made up because no runner got a cluster that far, needs nothing", async () => {
    server.rows = [
      {
        _id: id(),
        kind: OpenStackResourceKind.ContainerCluster,
        name: "hand-checked",
        externalId: "11111111-2222-4333-8444-555555555555",
        regionName: "RegionOne",
        status: "CREATE_COMPLETE",
        stateChangedAt: minutesAgo(600),
        facts: { nodeCount: 3, masterCount: 1, healthStatus: "HEALTHY" },
        lastSeenAt: new Date(),
      },
    ];

    await renderPage(
      OpenStackCloudContainerClusterDetail,
      partPath(
        "kubernetes-clusters",
        "11111111-2222-4333-8444-555555555555",
      ),
    );

    await screen.findByTestId("openstack-container-cluster-details");
    expect(
      screen.queryByTestId("openstack-container-cluster-explanation"),
    ).toBeNull();
    expect(attentionRowsOf("openstack-container-cluster-attention")).toEqual(
      [],
    );
  });

  test("its alerts are the two that watch every cluster", async () => {
    server.rows = recorded("magnum-failed");
    const failed: string = clusterId(server.rows, "ou-cluster-long");

    await renderPage(
      OpenStackCloudContainerClusterDetail,
      partPath("kubernetes-clusters", failed),
    );

    expect(
      await screen.findByTestId("openstack-container-cluster-alerts"),
    ).toHaveTextContent(/Kubernetes Cluster Failed[\s\S]*Kubernetes Cluster Stuck/);
  });
});
