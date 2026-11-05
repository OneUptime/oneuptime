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
import { OPENSTACK_SHARE_STUCK_MINUTES } from "../../../Types/OpenStack/OpenStackHealthRules";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import OpenStackCloudShareDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/ShareDetail";
import OpenStackCloudShares from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Shares";
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
 * Manila's pages, rendered for real over the real tables and part cards with only the network replaced,
 * on what a real DevStack recorded (services-manila). A probe's facts are made up here, because no
 * collector sends them yet that a scene recorded through.
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

const FOLDER: string = path.join(OPENSTACK_FIXTURES_FOLDER, "services-manila");

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
      diskCapacityBytes: entry.diskCapacityBytes,
      stateChangedAt,
      facts: entry.facts,
      lastSeenAt: new Date(),
    };
  });
}

function shareId(rows: Array<Row>, name: string): string {
  return rows.find((row: Row): boolean => {
    return row["kind"] === OpenStackResourceKind.Share && row["name"] === name;
  })!["externalId"] as string;
}

beforeEach(() => {
  resetServer();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Shares", () => {
  test("lists a real cloud's shares, each status in Manila's word, with what it holds room for", async () => {
    server.rows = recorded("share-stuck");

    await renderPage(OpenStackCloudShares, "/shares");
    await settle();

    expect(await screen.findByText("ou-share-error")).toBeInTheDocument();
    expect(tableRow("ou-share-error")).toHaveTextContent("error");
    expect(tableRow("ou-share-stuck")).toHaveTextContent("creating");
    expect(tableRow("ou-share-payments")).toHaveTextContent("available");
    expect(tableRow("ou-share-payments")).toHaveTextContent("2.0 GiB");
    expect(tableRow("ou-share-payments")).toHaveTextContent("NFS");
    expect(tableRow("ou-share-payments")).toHaveTextContent("manila-zone-0");
  });

  test("an empty list on a cloud that doesn't run Manila says so, and is no error", async () => {
    server.rows = [];

    await renderPage(OpenStackCloudShares, "/shares");

    expect(
      await screen.findByText("This cloud doesn't run this service"),
    ).toBeInTheDocument();
  });

  test("an empty list with Manila stopped says the API isn't answering", async () => {
    server.rows = recorded("api-down");

    await renderPage(OpenStackCloudShares, "/shares");

    expect(
      await screen.findByText("This service's API isn't answering"),
    ).toBeInTheDocument();
  });

  test("an empty list with Manila up is what the monitoring role gets, so it says that", async () => {
    server.rows = recorded(
      "access-check",
      "exporter/monitoring-role",
    );

    await renderPage(OpenStackCloudShares, "/shares");

    expect(
      await screen.findByText("No shares reported yet"),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        /Only the Full view credential sees every project/,
      ),
    ).toBeInTheDocument();
  });
});

describe("a share's page", () => {
  test("a share in error, on what a real cloud said: why it matters, and what nothing here reads", async () => {
    server.rows = recorded("share-error");
    const failed: string = shareId(server.rows, "ou-share-error");

    await renderPage(OpenStackCloudShareDetail, partPath("shares", failed));

    expect(
      await screen.findByTestId("openstack-share-explanation"),
    ).toHaveTextContent(/stays like this until someone deals with it/);
    expect(attentionRowsOf("openstack-share-attention")).toEqual([
      "This share: In error",
    ]);
    expect(
      screen.getByTestId("openstack-share-why-not-known"),
    ).toHaveTextContent(/openstack share message list/);
    expect(
      screen.getByTestId("openstack-share-details-zone"),
    ).toHaveTextContent("—");
    expect(
      screen.getByTestId("openstack-share-details-type"),
    ).toHaveTextContent("ou-nowhere");
  });

  test("a healthy share needs nothing, and says nothing of why", async () => {
    server.rows = recorded("baseline");
    const ok: string = shareId(server.rows, "ou-share-payments");

    await renderPage(OpenStackCloudShareDetail, partPath("shares", ok));
    await screen.findByTestId("openstack-share-details");

    expect(screen.queryByTestId("openstack-share-explanation")).toBeNull();
    expect(screen.queryByTestId("openstack-share-why-not-known")).toBeNull();
    expect(attentionRowsOf("openstack-share-attention")).toEqual([]);
    expect(tile("openstack-share-tiles", "Size")).toHaveTextContent("2.0 GiB");
    expect(
      screen.getByTestId("openstack-share-details-zone"),
    ).toHaveTextContent("manila-zone-0");
    expect(
      screen.getByTestId("openstack-share-details-protocol"),
    ).toHaveTextContent("NFS");
  });

  test("one still creating is on its way, however slow, until the line", async () => {
    server.rows = recorded(
      "share-stuck",
      "exporter",
      minutesAgo(OPENSTACK_SHARE_STUCK_MINUTES - 10),
    );
    const stuck: string = shareId(server.rows, "ou-share-stuck");

    await renderPage(OpenStackCloudShareDetail, partPath("shares", stuck));
    await screen.findByTestId("openstack-share-details");

    expect(attentionRowsOf("openstack-share-attention")).toEqual([]);
    expect(screen.queryByTestId("openstack-share-explanation")).toBeNull();
  });

  test("and past it says for how long, and where to look", async () => {
    server.rows = recorded(
      "share-stuck",
      "exporter",
      minutesAgo(OPENSTACK_SHARE_STUCK_MINUTES + 30),
    );
    const stuck: string = shareId(server.rows, "ou-share-stuck");

    await renderPage(OpenStackCloudShareDetail, partPath("shares", stuck));

    expect(
      await screen.findByTestId("openstack-share-explanation"),
    ).toHaveTextContent(/Manila has no timeout of its own/);
    expect(attentionRowsOf("openstack-share-attention")).toEqual([
      "This share: creating for 90m",
    ]);
  });

  test("a probe's words, made up, are there when a probe says them, and asked for by nothing", async () => {
    const rows: Array<Row> = recorded("baseline");
    const ok: string = shareId(rows, "ou-share-payments");
    server.rows = rows.map((row: Row): Row => {
      return row["externalId"] === ok
        ? {
            ...row,
            facts: {
              ...(row["facts"] as object),
              backendHost: "compute-01@alpha#fake_pool_for_ALPHA",
              accessRulesStatus: "active",
            },
          }
        : row;
    });

    await renderPage(OpenStackCloudShareDetail, partPath("shares", ok));

    expect(
      await screen.findByTestId("openstack-share-details-backend"),
    ).toHaveTextContent("compute-01@alpha#fake_pool_for_ALPHA");
    expect(
      screen.getByTestId("openstack-share-details-access-rules"),
    ).toHaveTextContent("active");
  });

  test("the agent's rows leave those two out, rather than asking anyone", async () => {
    server.rows = recorded("baseline");
    const ok: string = shareId(server.rows, "ou-share-payments");

    await renderPage(OpenStackCloudShareDetail, partPath("shares", ok));
    await screen.findByTestId("openstack-share-details");

    expect(screen.queryByTestId("openstack-share-details-backend")).toBeNull();
    expect(
      screen.queryByTestId("openstack-share-details-access-rules"),
    ).toBeNull();
  });

  test("its alerts are the two that watch every share", async () => {
    server.rows = recorded("baseline");
    const ok: string = shareId(server.rows, "ou-share-payments");

    await renderPage(OpenStackCloudShareDetail, partPath("shares", ok));

    expect(
      await screen.findByTestId("openstack-share-alerts"),
    ).toHaveTextContent(/Share in Error[\s\S]*Share Stuck/);
  });

  test("one that has gone says so, rather than a blank page", async () => {
    server.rows = recorded("baseline");

    await renderPage(
      OpenStackCloudShareDetail,
      partPath("shares", "not-a-share"),
    );

    expect(
      await screen.findByTestId("openstack-share-not-reported"),
    ).toHaveTextContent(/not in this cloud's inventory/);
  });
});
