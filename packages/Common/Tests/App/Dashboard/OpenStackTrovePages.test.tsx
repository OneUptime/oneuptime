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
import { OPENSTACK_DATABASE_INSTANCE_STUCK_MINUTES } from "../../../Types/OpenStack/OpenStackHealthRules";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import OpenStackCloudDatabaseInstanceDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/DatabaseInstanceDetail";
import OpenStackCloudDatabaseInstances from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/DatabaseInstances";
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
 * Trove's pages, rendered for real over the real tables and part cards with only the network replaced, on
 * what a real DevStack recorded (services-trove). What a running database's volume reads is made up, because
 * no runner has got one to ACTIVE, and so are a probe's words for why one failed: a test says so where it does.
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

const FOLDER: string = path.join(OPENSTACK_FIXTURES_FOLDER, "services-trove");

let nextId: number = 1;

function id(): string {
  return `8d1b2a3d-4e5f-4a6b-8c7d-${String(nextId++).padStart(12, "0")}`;
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
      diskCapacityBytes: entry.diskCapacityBytes,
      diskAllocatedBytes: entry.diskAllocatedBytes,
      stateChangedAt,
      facts: entry.facts,
      lastSeenAt: new Date(),
    };
  });
}

function instanceId(rows: Array<Row>, name: string): string {
  return rows.find((row: Row): boolean => {
    return (
      row["kind"] === OpenStackResourceKind.DatabaseInstance &&
      row["name"] === name
    );
  })!["externalId"] as string;
}

const GIB: number = 1024 * 1024 * 1024;

beforeEach(() => {
  resetServer();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Databases", () => {
  test("lists a real cloud's databases, each status in Trove's word, with what it runs", async () => {
    server.rows = recorded("instance-error");

    await renderPage(OpenStackCloudDatabaseInstances, "/databases");
    await settle();

    expect(await screen.findByText("ou-db-ok")).toBeInTheDocument();
    expect(tableRow("ou-db-ok")).toHaveTextContent("ERROR");
    expect(tableRow("ou-db-ok")).toHaveTextContent("mysql 8.4");
    expect(tableRow("ou-db-no-host")).toHaveTextContent("1.0 GiB");
  });

  test("an empty list on a cloud that doesn't run Trove says so, and is no error", async () => {
    server.rows = [];

    await renderPage(OpenStackCloudDatabaseInstances, "/databases");

    expect(
      await screen.findByText("This cloud doesn't run this service"),
    ).toBeInTheDocument();
  });

  test("an empty list with Trove up has nothing to explain: it can really have none", async () => {
    server.rows = recorded("baseline");

    await renderPage(OpenStackCloudDatabaseInstances, "/databases");

    expect(
      await screen.findByText("No databases reported yet"),
    ).toBeInTheDocument();
  });

  test("a credential Trove refuses is told so, and not that its API is down", async () => {
    server.rows = recorded("access-check", "exporter/reader");

    await renderPage(OpenStackCloudDatabaseInstances, "/databases");

    expect(
      await screen.findByText("This credential has never read this service"),
    ).toBeInTheDocument();
    expect(screen.queryByText("This service's API isn't answering")).toBeNull();
  });

  test("an API that has read up before and stopped is down, recorded", async () => {
    server.rows = recorded("api-down").map((row: Row): Row => {
      return {
        ...row,
        facts: {
          ...(row["facts"] as Record<string, unknown>),
          vouchedAt: minutesAgo(30).toISOString(),
        },
      };
    });

    await renderPage(OpenStackCloudDatabaseInstances, "/databases");

    expect(
      await screen.findByText("This service's API isn't answering"),
    ).toBeInTheDocument();
  });
});

describe("a database's page", () => {
  test("one in error, on what a real cloud said: why it matters, and what the agent can't say", async () => {
    server.rows = recorded("instance-error");
    const failed: string = instanceId(server.rows, "ou-db-no-host");

    await renderPage(
      OpenStackCloudDatabaseInstanceDetail,
      partPath("databases", failed),
    );

    expect(
      await screen.findByTestId("openstack-database-instance-explanation"),
    ).toHaveTextContent(/Trove gave up on this database/);
    expect(attentionRowsOf("openstack-database-instance-attention")).toEqual([
      "This database: In ERROR",
    ]);
    expect(
      screen.getByTestId("openstack-database-instance-why-not-known"),
    ).toHaveTextContent(/openstack database instance show/);
    expect(
      screen.getByTestId("openstack-database-instance-details-datastore"),
    ).toHaveTextContent("mysql 8.4");
  });

  test("what its volume reads while it isn't running is no reading, however it looks", async () => {
    server.rows = recorded("instance-building");
    const building: string = instanceId(server.rows, "ou-db-ok");

    await renderPage(
      OpenStackCloudDatabaseInstanceDetail,
      partPath("databases", building),
    );
    await screen.findByTestId("openstack-database-instance-details");

    expect(
      tile("openstack-database-instance-tiles", "Volume used"),
    ).toHaveTextContent("—");
    expect(attentionRowsOf("openstack-database-instance-attention")).toEqual(
      [],
    );
  });

  test("one still building is on its way until the line, and stuck past it", async () => {
    server.rows = recorded(
      "instance-building",
      "exporter",
      minutesAgo(OPENSTACK_DATABASE_INSTANCE_STUCK_MINUTES + 30),
    );
    const stuck: string = instanceId(server.rows, "ou-db-ok");

    await renderPage(
      OpenStackCloudDatabaseInstanceDetail,
      partPath("databases", stuck),
    );

    expect(
      await screen.findByTestId("openstack-database-instance-explanation"),
    ).toHaveTextContent(/check that trove-taskmanager is running/);
    expect(attentionRowsOf("openstack-database-instance-attention")).toEqual([
      "This database: BUILD for 90m",
    ]);
  });

  test("a volume nearly full, made up because no runner got one running, says how full and what to do", async () => {
    const rows: Array<Row> = recorded("instance-building");
    const running: string = instanceId(rows, "ou-db-ok");
    server.rows = rows.map((row: Row): Row => {
      return row["externalId"] === running
        ? {
            ...row,
            status: "ACTIVE",
            diskCapacityBytes: 10 * GIB,
            diskAllocatedBytes: 9 * GIB,
          }
        : row;
    });

    await renderPage(
      OpenStackCloudDatabaseInstanceDetail,
      partPath("databases", running),
    );

    expect(
      await screen.findByTestId("openstack-database-instance-explanation"),
    ).toHaveTextContent(/stops taking writes/);
    expect(attentionRowsOf("openstack-database-instance-attention")).toEqual([
      "This database: 90% full",
    ]);
    expect(
      tile("openstack-database-instance-tiles", "Volume used"),
    ).toHaveTextContent("90%");
  });

  test("a probe's word for why it failed, made up from what Trove's mgmt API recorded, stands in for asking", async () => {
    const rows: Array<Row> = recorded("instance-error");
    const failed: string = instanceId(rows, "ou-db-no-host");
    server.rows = rows.map((row: Row): Row => {
      return row["externalId"] === failed
        ? {
            ...row,
            facts: {
              ...(row["facts"] as Record<string, unknown>),
              faultMessage: "Flavor's disk is too small for requested image.",
              taskDescription: "Build error: Server.",
            },
          }
        : row;
    });

    await renderPage(
      OpenStackCloudDatabaseInstanceDetail,
      partPath("databases", failed),
    );

    expect(
      await screen.findByTestId("openstack-database-instance-details-fault"),
    ).toHaveTextContent("Flavor's disk is too small");
    expect(
      screen.getByTestId("openstack-database-instance-details-task"),
    ).toHaveTextContent("Build error: Server.");
    expect(
      screen.queryByTestId("openstack-database-instance-why-not-known"),
    ).toBeNull();
  });

  test("its alerts are the three that watch every database", async () => {
    server.rows = recorded("instance-error");
    const failed: string = instanceId(server.rows, "ou-db-ok");

    await renderPage(
      OpenStackCloudDatabaseInstanceDetail,
      partPath("databases", failed),
    );

    expect(
      await screen.findByTestId("openstack-database-instance-alerts"),
    ).toHaveTextContent(
      /Database Instance in Error[\s\S]*Database Instance Stuck[\s\S]*Database Volume Nearly Full/,
    );
  });

  test("one that has gone says so, rather than a blank page", async () => {
    server.rows = recorded("instance-error");

    await renderPage(
      OpenStackCloudDatabaseInstanceDetail,
      partPath("databases", "not-a-database"),
    );

    expect(
      await screen.findByTestId("openstack-database-instance-not-reported"),
    ).toHaveTextContent(/not in this cloud's inventory/);
  });
});
