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
import { OpenStackResourceBufferEntry } from "../../../Server/Utils/Telemetry/OpenStackSnapshotScan";
import { OPENSTACK_LOAD_BALANCER_STUCK_MINUTES } from "../../../Types/OpenStack/OpenStackHealthRules";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import OpenStackCloudAmphoraDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/AmphoraDetail";
import OpenStackCloudLoadBalancerDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/LoadBalancerDetail";
import OpenStackCloudLoadBalancerPoolDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/LoadBalancerPoolDetail";
import OpenStackCloudLoadBalancers from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/LoadBalancers";
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
} from "./OpenStackPartHarness";

/*
 * Octavia's pages, rendered for real over the real tables and part cards with only the network replaced,
 * on what a real DevStack recorded (services-octavia). The three scenes written into the rows (two
 * masters, an amphora in error, a certificate near its end) are used as the recording has them.
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

const FOLDER: string = path.join(OPENSTACK_FIXTURES_FOLDER, "services-octavia");

let nextId: number = 1;

function id(): string {
  return `7d1b2a3d-4e5f-4a6b-8c7d-${String(nextId++).padStart(12, "0")}`;
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
      availabilityZone: entry.availabilityZone,
      openStackProjectId: entry.openStackProjectId,
      status: entry.status,
      stateChangedAt,
      facts: entry.facts,
      lastSeenAt: new Date(),
    };
  });
}

function idOf(
  rows: Array<Row>,
  kind: OpenStackResourceKind,
  name: string,
): string {
  return rows.find((row: Row): boolean => {
    return row["kind"] === kind && row["name"] === name;
  })!["externalId"] as string;
}

function amphoraIdWhere(rows: Array<Row>, fact: string, value: string): string {
  return rows.find((row: Row): boolean => {
    return (
      row["kind"] === OpenStackResourceKind.Amphora &&
      (row["facts"] as Record<string, unknown>)[fact] === value
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

describe("Load Balancers", () => {
  test("lists a real cloud's load balancers, pools and amphorae, each status in Octavia's word", async () => {
    server.rows = recorded("lb-error");

    await renderPage(OpenStackCloudLoadBalancers, "/load-balancers");
    await settle();

    expect(await screen.findByText("ou-lb-failed")).toBeInTheDocument();
    expect(tableRow("ou-lb-failed")).toHaveTextContent("ERROR");
    expect(tableRow("ou-lb-failed")).toHaveTextContent("OFFLINE");
    // The plain one's name is also the link on its pool and its amphora, so it is found by its address.
    expect(screen.getByText("10.77.0.124").closest("tr")).toHaveTextContent(
      "ACTIVE",
    );
    expect(screen.getByText("10.77.0.124").closest("tr")).toHaveTextContent(
      "ONLINE",
    );
    expect(screen.getByText("10.77.0.91").closest("tr")).toHaveTextContent(
      "ovn",
    );
    expect(tableRow("ou-lb-pool")).toHaveTextContent("HTTP");
  });

  test("a pool with every member down reads ERROR beside ACTIVE, which provisioning alone would hide", async () => {
    server.rows = recorded("pool-members-down");

    await renderPage(OpenStackCloudLoadBalancers, "/load-balancers");
    await settle();

    expect(await screen.findByText("ou-lb-pool")).toBeInTheDocument();
    expect(tableRow("ou-lb-pool")).toHaveTextContent("ACTIVE");
    expect(tableRow("ou-lb-pool")).toHaveTextContent("ERROR");
    expect(tableRow("ou-lb-ovn-pool")).not.toHaveTextContent("ERROR");
  });

  test("an empty list on a cloud that doesn't run Octavia says so, and is no error", async () => {
    server.rows = [];

    await renderPage(OpenStackCloudLoadBalancers, "/load-balancers");

    expect(
      (await screen.findAllByText("This cloud doesn't run this service"))
        .length,
    ).toBeGreaterThan(0);
  });

  test("an empty list with Octavia up is what a credential that sees none gets, so it says that", async () => {
    server.rows = recorded("access-check", "exporter/monitoring-role");

    await renderPage(OpenStackCloudLoadBalancers, "/load-balancers");

    expect(
      await screen.findByText("No load balancers reported yet"),
    ).toBeInTheDocument();
  });
});

describe("a load balancer's page", () => {
  test("one in ERROR, on what a real cloud said: why it matters, and what nothing here reads", async () => {
    server.rows = recorded("lb-error");
    const failed: string = idOf(
      server.rows,
      OpenStackResourceKind.LoadBalancer,
      "ou-lb-failed",
    );

    await renderPage(
      OpenStackCloudLoadBalancerDetail,
      partPath("load-balancers", failed),
    );

    expect(
      await screen.findByTestId("openstack-load-balancer-explanation"),
    ).toHaveTextContent(/retries none of these by itself/);
    expect(attentionRowsOf("openstack-load-balancer-attention")).toEqual([
      "This load balancer: In ERROR",
    ]);
    expect(
      screen.getByTestId("openstack-load-balancer-why-not-known"),
    ).toHaveTextContent(/octavia-worker's log/);
    expect(
      screen.getByTestId("openstack-load-balancer-details-operating-status"),
    ).toHaveTextContent("OFFLINE");
    expect(
      screen.getByTestId("openstack-load-balancer-details-provisioning-status"),
    ).toHaveTextContent("ERROR");
  });

  test("a healthy one needs nothing, and lists its pool and its amphora", async () => {
    server.rows = recorded("baseline");
    const ok: string = idOf(
      server.rows,
      OpenStackResourceKind.LoadBalancer,
      "ou-lb",
    );

    await renderPage(
      OpenStackCloudLoadBalancerDetail,
      partPath("load-balancers", ok),
    );
    await screen.findByTestId("openstack-load-balancer-details");

    expect(
      screen.queryByTestId("openstack-load-balancer-explanation"),
    ).toBeNull();
    expect(attentionRowsOf("openstack-load-balancer-attention")).toEqual([]);
    expect(
      await screen.findByTestId("openstack-load-balancer-details-pools"),
    ).toHaveTextContent("ou-lb-pool");
    expect(
      screen.getByTestId("openstack-load-balancer-details-amphorae"),
    ).toHaveTextContent("STANDALONE");
    expect(
      screen.getByTestId("openstack-load-balancer-details-vip"),
    ).toHaveTextContent("10.77.0.124");
  });

  test("one on the OVN provider has no amphorae to list, and does not claim to", async () => {
    server.rows = recorded("ovn-provider");
    const ovn: string = idOf(
      server.rows,
      OpenStackResourceKind.LoadBalancer,
      "ou-lb-ovn",
    );

    await renderPage(
      OpenStackCloudLoadBalancerDetail,
      partPath("load-balancers", ovn),
    );
    await screen.findByTestId("openstack-load-balancer-details-pools");

    expect(
      screen.queryByTestId("openstack-load-balancer-details-amphorae"),
    ).toBeNull();
    expect(
      screen.getByTestId("openstack-load-balancer-details-provider"),
    ).toHaveTextContent("ovn");
  });

  test("an active-standby pair lists its MASTER and its BACKUP", async () => {
    server.rows = recorded("active-standby");
    const pair: string = idOf(
      server.rows,
      OpenStackResourceKind.LoadBalancer,
      "ou-lb-ha",
    );

    await renderPage(
      OpenStackCloudLoadBalancerDetail,
      partPath("load-balancers", pair),
    );

    const amphorae: HTMLElement = await screen.findByTestId(
      "openstack-load-balancer-details-amphorae",
    );
    expect(amphorae).toHaveTextContent("MASTER");
    expect(amphorae).toHaveTextContent("BACKUP");
    expect(attentionRowsOf("openstack-load-balancer-attention")).toEqual([]);
  });

  test("a pair with two masters says so from its own amphorae, as Needs attention does", async () => {
    server.rows = recorded("two-masters");
    const pair: string = idOf(
      server.rows,
      OpenStackResourceKind.LoadBalancer,
      "ou-lb-ha",
    );

    await renderPage(
      OpenStackCloudLoadBalancerDetail,
      partPath("load-balancers", pair),
    );

    expect(
      await screen.findByTestId("openstack-load-balancer-explanation"),
    ).toHaveTextContent(/both say they are the MASTER/);
    expect(attentionRowsOf("openstack-load-balancer-attention")).toEqual([
      "This load balancer: 2 amphorae say they are the MASTER",
    ]);
  });

  test("one pending is on its way until the line, and past it says for how long", async () => {
    server.rows = recorded(
      "pending-update",
      "exporter",
      minutesAgo(OPENSTACK_LOAD_BALANCER_STUCK_MINUTES - 10),
    );
    const pending: string = idOf(
      server.rows,
      OpenStackResourceKind.LoadBalancer,
      "ou-lb",
    );

    await renderPage(
      OpenStackCloudLoadBalancerDetail,
      partPath("load-balancers", pending),
    );
    await screen.findByTestId("openstack-load-balancer-details");
    expect(attentionRowsOf("openstack-load-balancer-attention")).toEqual([]);

    cleanup();
    server.rows = recorded(
      "pending-update",
      "exporter",
      minutesAgo(OPENSTACK_LOAD_BALANCER_STUCK_MINUTES + 30),
    );
    await renderPage(
      OpenStackCloudLoadBalancerDetail,
      partPath("load-balancers", pending),
    );

    expect(
      await screen.findByTestId("openstack-load-balancer-explanation"),
    ).toHaveTextContent(/waiting on Octavia's worker/);
    expect(attentionRowsOf("openstack-load-balancer-attention")).toEqual([
      "This load balancer: PENDING_UPDATE for 90m",
    ]);
  });

  test("its alerts are the three that watch every load balancer", async () => {
    server.rows = recorded("baseline");
    const ok: string = idOf(
      server.rows,
      OpenStackResourceKind.LoadBalancer,
      "ou-lb",
    );

    await renderPage(
      OpenStackCloudLoadBalancerDetail,
      partPath("load-balancers", ok),
    );

    expect(
      await screen.findByTestId("openstack-load-balancer-alerts"),
    ).toHaveTextContent(
      /Load Balancer in Error[\s\S]*Load Balancer Stuck Pending[\s\S]*Load Balancer With Two Masters/,
    );
  });

  test("one that has gone says so, rather than a blank page", async () => {
    server.rows = recorded("baseline");

    await renderPage(
      OpenStackCloudLoadBalancerDetail,
      partPath("load-balancers", "not-a-load-balancer"),
    );

    expect(
      await screen.findByTestId("openstack-load-balancer-not-reported"),
    ).toHaveTextContent(/not in this cloud's inventory/);
  });
});

describe("a pool's page", () => {
  test("every member down: ACTIVE in provisioning and ERROR in operating, and what nothing here reads", async () => {
    server.rows = recorded("pool-members-down");
    const pool: string = idOf(
      server.rows,
      OpenStackResourceKind.LoadBalancerPool,
      "ou-lb-pool",
    );

    await renderPage(
      OpenStackCloudLoadBalancerPoolDetail,
      partPath("load-balancer-pools", pool),
    );

    expect(
      await screen.findByTestId("openstack-load-balancer-pool-explanation"),
    ).toHaveTextContent(/Every member of this pool fails its health check/);
    expect(attentionRowsOf("openstack-load-balancer-pool-attention")).toEqual([
      "This pool: No member is healthy: every one fails its health check",
    ]);
    expect(
      screen.getByTestId("openstack-load-balancer-pool-members-note"),
    ).toHaveTextContent(
      /isn't collected: the exporter has no series for members/,
    );
    expect(
      screen.getByTestId(
        "openstack-load-balancer-pool-details-provisioning-status",
      ),
    ).toHaveTextContent("ACTIVE");
    expect(
      screen.getByTestId(
        "openstack-load-balancer-pool-details-operating-status",
      ),
    ).toHaveTextContent("ERROR");
  });

  test("a healthy pool needs nothing, and links the load balancer it is behind", async () => {
    server.rows = recorded("baseline");
    const pool: string = idOf(
      server.rows,
      OpenStackResourceKind.LoadBalancerPool,
      "ou-lb-pool",
    );

    await renderPage(
      OpenStackCloudLoadBalancerPoolDetail,
      partPath("load-balancer-pools", pool),
    );
    await screen.findByTestId("openstack-load-balancer-pool-details");

    expect(attentionRowsOf("openstack-load-balancer-pool-attention")).toEqual(
      [],
    );
    expect(
      screen.getByTestId("openstack-load-balancer-pool-details-load-balancers"),
    ).toHaveTextContent("27c8eb38-e43d-4f03-82b9-e6f4e714fa38");
  });
});

describe("an amphora's page", () => {
  test("one in ERROR is critical, with its role and the instance it runs in", async () => {
    server.rows = recorded("amphora-error");
    const failed: string = amphoraIdWhere(server.rows, "role", "BACKUP");

    await renderPage(OpenStackCloudAmphoraDetail, partPath("amphorae", failed));

    expect(
      await screen.findByTestId("openstack-amphora-explanation"),
    ).toHaveTextContent(/could not replace this amphora/);
    expect(attentionRowsOf("openstack-amphora-attention")).toEqual([
      "This amphora: In ERROR",
    ]);
    expect(
      screen.getByTestId("openstack-amphora-details-instance"),
    ).toHaveTextContent("2b4ead68-c377-4d7a-94d6-24c88f1d716d");
    expect(
      screen.getByTestId("openstack-amphora-details-role"),
    ).toHaveTextContent("BACKUP");
  });

  test("a certificate with 21 days left needs nothing, since Octavia renews at 14", async () => {
    server.rows = recorded("amphora-near-expiry");
    const near: string = amphoraIdWhere(
      server.rows,
      "certExpiresAt",
      "2026-11-26T06:06:07Z",
    );

    await renderPage(OpenStackCloudAmphoraDetail, partPath("amphorae", near));
    await screen.findByTestId("openstack-amphora-details");

    expect(attentionRowsOf("openstack-amphora-attention")).toEqual([]);
    expect(
      screen.getByTestId("openstack-amphora-details-certificate"),
    ).toHaveTextContent("2026-11-26T06:06:07Z");
  });

  test("and the same row 10 days from its end is a warning that says how many days", async () => {
    const rows: Array<Row> = recorded("amphora-near-expiry");
    const near: string = amphoraIdWhere(
      rows,
      "certExpiresAt",
      "2026-11-26T06:06:07Z",
    );
    server.rows = rows.map((row: Row): Row => {
      return row["externalId"] === near
        ? {
            ...row,
            facts: {
              ...(row["facts"] as object),
              certExpiresAt: new Date(
                Date.now() + 10.5 * 24 * 60 * 60 * 1000,
              ).toISOString(),
            },
          }
        : row;
    });

    await renderPage(OpenStackCloudAmphoraDetail, partPath("amphorae", near));

    expect(
      await screen.findByTestId("openstack-amphora-explanation"),
    ).toHaveTextContent(/nearly at its end/);
    expect(attentionRowsOf("openstack-amphora-attention")).toEqual([
      "This amphora: Its certificate expires in 10 days",
    ]);
  });

  test("and one past its end is critical, and says for how long", async () => {
    const rows: Array<Row> = recorded("amphora-near-expiry");
    const near: string = amphoraIdWhere(
      rows,
      "certExpiresAt",
      "2026-11-26T06:06:07Z",
    );
    server.rows = rows.map((row: Row): Row => {
      return row["externalId"] === near
        ? {
            ...row,
            facts: {
              ...(row["facts"] as object),
              certExpiresAt: new Date(
                Date.now() - 2.5 * 24 * 60 * 60 * 1000,
              ).toISOString(),
            },
          }
        : row;
    });

    await renderPage(OpenStackCloudAmphoraDetail, partPath("amphorae", near));

    expect(
      await screen.findByTestId("openstack-amphora-explanation"),
    ).toHaveTextContent(/nearly at its end, or past it/);
    expect(attentionRowsOf("openstack-amphora-attention")).toEqual([
      "This amphora: Its certificate expired 3 days ago",
    ]);
  });

  test("one that has gone says so, rather than a blank page", async () => {
    server.rows = recorded("baseline");

    await renderPage(
      OpenStackCloudAmphoraDetail,
      partPath("amphorae", "not-an-amphora"),
    );

    expect(
      await screen.findByTestId("openstack-amphora-not-reported"),
    ).toHaveTextContent(/not in this cloud's inventory/);
  });
});
