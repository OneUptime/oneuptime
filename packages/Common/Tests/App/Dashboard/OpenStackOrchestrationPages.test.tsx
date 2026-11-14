import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  configure,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import * as React from "react";
import path from "path";
import { OpenStackResourceBufferEntry } from "../../../Server/Utils/Telemetry/OpenStackSnapshotScan";
import ObjectID from "../../../Types/ObjectID";
import { OpenStackContainerClusterLink } from "../../../Types/OpenStack/OpenStackLinks";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import { OpenStackPlacementOfKubernetesCluster } from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/Part/OpenStackPlacementOfHost";
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
      name: entry.name ?? undefined,
      externalId: entry.externalId,
      regionName: entry.regionName ?? undefined,
      openStackProjectId: entry.openStackProjectId ?? undefined,
      status: entry.status ?? undefined,
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
    server.rows = recorded("access-check", "exporter/monitoring-role").filter(
      (row: Row): boolean => {
        return row["kind"] === OpenStackResourceKind.Api;
      },
    );

    await renderPage(OpenStackCloudStacks, "/stacks");

    expect(
      await screen.findByText("No stacks reported yet"),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        /Only the Full view credential sees every project/,
      ),
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
    ).toHaveTextContent("a01a07259d8441afa457d94ba7e4425f");
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
    const stack: string = stackId(server.rows, "ou-cluster-real-b4a265chwfks");

    await renderPage(OpenStackCloudStackDetail, partPath("stacks", stack));

    expect(
      await screen.findByTestId(
        `openstack-stack-details-belongs-to-${clusterId(server.rows, "ou-cluster-real")}`,
      ),
    ).toHaveTextContent("ou-cluster-real");
  });

  describe("what it owns", () => {
    const INSTANCE: string = "e399fef2-3750-4e72-a4fc-77fb490f552d";
    const VOLUME: string = "1571c7fb-5c19-482e-8eaf-7cdb024af2ef";

    const stackOwning: (facts: Record<string, unknown>) => Row = (
      facts: Record<string, unknown>,
    ): Row => {
      return {
        kind: OpenStackResourceKind.Stack,
        externalId: "owner",
        name: "owner",
        regionName: "RegionOne",
        status: "CREATE_COMPLETE",
        facts,
      } as Row;
    };

    test("is listed by name, each a step away, where a probe read it", async () => {
      server.rows = [
        stackOwning({
          ownedInstanceIds: [INSTANCE],
          ownedInstanceCount: 1,
          ownedVolumeIds: [VOLUME],
          ownedVolumeCount: 1,
        }),
        {
          kind: OpenStackResourceKind.Instance,
          externalId: INSTANCE,
          name: "owner-server-x",
        } as Row,
        {
          kind: OpenStackResourceKind.Volume,
          externalId: VOLUME,
          name: "owner-volume-y",
        } as Row,
      ];

      await renderPage(OpenStackCloudStackDetail, partPath("stacks", "owner"));

      const card: HTMLElement = await screen.findByTestId(
        "openstack-stack-owns",
      );
      expect(card).toHaveTextContent("owner-server-x");
      expect(card).toHaveTextContent("owner-volume-y");
      expect(
        within(card).getByRole("link", { name: "owner-server-x" }),
      ).toHaveAttribute(
        "href",
        expect.stringContaining(`/instances/${INSTANCE}`),
      );
      expect(
        within(card).getByRole("link", { name: "owner-volume-y" }),
      ).toHaveAttribute("href", expect.stringContaining(`/volumes/${VOLUME}`));
      expect(
        screen.queryByTestId("openstack-stack-owns-not-known"),
      ).not.toBeInTheDocument();
    });

    test("something gone since goes by its ID, and it doesn't pretend to know it", async () => {
      server.rows = [
        stackOwning({
          ownedInstanceIds: [INSTANCE],
          ownedInstanceCount: 1,
          ownedVolumeIds: [],
          ownedVolumeCount: 0,
        }),
      ];
      await renderPage(OpenStackCloudStackDetail, partPath("stacks", "owner"));
      expect(
        await screen.findByTestId("openstack-stack-owns"),
      ).toHaveTextContent(INSTANCE);
    });

    test("more than a label has room for says how many more", async () => {
      server.rows = [
        stackOwning({
          ownedInstanceIds: [INSTANCE],
          ownedInstanceCount: 40,
          ownedVolumeIds: [],
          ownedVolumeCount: 2,
        }),
      ];
      await renderPage(OpenStackCloudStackDetail, partPath("stacks", "owner"));
      const more: HTMLElement = await screen.findByTestId(
        "openstack-stack-owns-more",
      );
      expect(more).toHaveTextContent("41");

      /*
       * The last row of the ruled list, padded as its rows are (#6956): a
       * line after the list sat in the card's bottom padding under a list
       * bled to the card's edges, and left a card's padding more under it.
       */
      const items: Array<HTMLElement> = screen.getAllByTestId(
        "openstack-stack-owns-item",
      );
      expect(more.tagName).toBe("LI");
      expect(more.parentElement).toBe(items[0]!.parentElement);
      expect(more.parentElement!.lastElementChild).toBe(more);
    });

    test("owning nothing says so, which is not the same as nobody having read it", async () => {
      server.rows = [
        stackOwning({
          ownedInstanceIds: [],
          ownedInstanceCount: 0,
          ownedVolumeIds: [],
          ownedVolumeCount: 0,
        }),
      ];
      await renderPage(OpenStackCloudStackDetail, partPath("stacks", "owner"));
      expect(
        await screen.findByTestId("openstack-stack-owns-nothing"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("openstack-stack-owns-not-known"),
      ).not.toBeInTheDocument();
    });

    test("nobody having read it says what to run, on what a real cloud said", async () => {
      server.rows = recorded("heat-baseline");
      await renderPage(
        OpenStackCloudStackDetail,
        partPath("stacks", stackId(server.rows, "ou-stack-ok")),
      );
      expect(
        await screen.findByTestId("openstack-stack-owns-not-known"),
      ).toHaveTextContent("openstack stack resource list");
      expect(
        screen.queryByTestId("openstack-stack-owns"),
      ).not.toBeInTheDocument();
    });
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

    expect(await screen.findByText("ou-cluster-times-out")).toBeInTheDocument();
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
    ).toHaveTextContent("ou-cluster-real-b4a265chwfks");
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
    ).toHaveTextContent("417c7b6f-4f5a-40f0-a9b6-5f9c0891ede5");
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
        openStackProjectId: "ae798f87fdb743ddb30bc5a46ac15507",
        facts: {
          ...(cluster!["facts"] as Record<string, unknown>),
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
    ).toHaveTextContent("ae798f87fdb743ddb30bc5a46ac15507");
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
      partPath("kubernetes-clusters", "11111111-2222-4333-8444-555555555555"),
    );

    await screen.findByTestId("openstack-container-cluster-details");
    expect(
      screen.queryByTestId("openstack-container-cluster-explanation"),
    ).toBeNull();
    expect(attentionRowsOf("openstack-container-cluster-attention")).toEqual(
      [],
    );
  });

  describe("with OneUptime's Kubernetes agent on it", () => {
    const LINK: OpenStackContainerClusterLink = {
      openStackCloudId: "71000000-0000-4000-8000-000000000001",
      cloudName: "devstack",
      regionName: "RegionOne",
      externalId: "x",
      name: "ou-cluster-real",
      status: "CREATE_FAILED",
      kubernetesClusterId: "76000000-0000-4000-8000-000000000002",
      kubernetesClusterName: "from-magnum",
      nodeCount: 2,
    };

    test("names its Kubernetes cluster, one step away, and how many of its nodes are here", async () => {
      server.rows = recorded("access-check", "exporter/admin");
      server.magnumLink = LINK;

      await renderPage(
        OpenStackCloudContainerClusterDetail,
        partPath(
          "kubernetes-clusters",
          clusterId(server.rows, "ou-cluster-real"),
        ),
      );

      const card: HTMLElement = await screen.findByTestId(
        "openstack-container-cluster-links",
      );
      expect(card).toHaveTextContent("from-magnum");
      expect(card).toHaveTextContent("2 nodes");
      expect(
        within(card).getByRole("link", { name: "from-magnum" }),
      ).toHaveAttribute(
        "href",
        expect.stringContaining(`/kubernetes/${LINK.kubernetesClusterId}`),
      );
    });

    test("without one says nothing of one, and the read that said so was made", async () => {
      server.rows = recorded("access-check", "exporter/admin");

      await renderPage(
        OpenStackCloudContainerClusterDetail,
        partPath(
          "kubernetes-clusters",
          clusterId(server.rows, "ou-cluster-real"),
        ),
      );

      await screen.findByTestId("openstack-container-cluster-overview");
      await settle();
      expect(
        screen.queryByTestId("openstack-container-cluster-links"),
      ).not.toBeInTheDocument();
      expect(
        server.postCalls.filter((call: { path: string }): boolean => {
          return call.path.includes("kubernetes-cluster-of-magnum-cluster");
        }).length,
      ).toBe(1);
    });

    test("a read of it that failed leaves the page as it was, because it is one more thing to know", async () => {
      server.rows = recorded("access-check", "exporter/admin");
      server.failPosts.add("kubernetes-cluster-of-magnum-cluster");

      await renderPage(
        OpenStackCloudContainerClusterDetail,
        partPath(
          "kubernetes-clusters",
          clusterId(server.rows, "ou-cluster-real"),
        ),
      );

      expect(
        await screen.findByTestId("openstack-container-cluster-details-stack"),
      ).toHaveTextContent("ou-cluster-real-b4a265chwfks");
      await settle();
      expect(
        screen.queryByTestId("openstack-container-cluster-links"),
      ).not.toBeInTheDocument();
    });

    test("the Kubernetes cluster's page names it, and the cloud, and leads back", async () => {
      server.magnumLink = LINK;

      render(
        <MemoryRouter>
          <OpenStackPlacementOfKubernetesCluster
            clusterId={new ObjectID(LINK.kubernetesClusterId)}
          />
        </MemoryRouter>,
      );

      const card: HTMLElement = await screen.findByTestId(
        "kubernetes-cluster-openstack-placement",
      );
      expect(card).toHaveTextContent("spec.providerID");
      expect(
        within(card).getByTestId("openstack-placement-cloud"),
      ).toHaveTextContent("devstack");
      expect(
        within(card).getByTestId("openstack-placement-magnum-cluster"),
      ).toHaveTextContent("ou-cluster-real");
      expect(
        within(card).getByTestId("openstack-placement-magnum-status"),
      ).toHaveTextContent("CREATE_FAILED");
    });

    test("a Kubernetes cluster on no Magnum cluster's servers has no card at all", async () => {
      const { container } = render(
        <MemoryRouter>
          <OpenStackPlacementOfKubernetesCluster
            clusterId={new ObjectID(LINK.kubernetesClusterId)}
          />
        </MemoryRouter>,
      );
      await settle();
      expect(container).toBeEmptyDOMElement();
    });
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
    ).toHaveTextContent(
      /Kubernetes Cluster Failed[\s\S]*Kubernetes Cluster Stuck/,
    );
  });
});
