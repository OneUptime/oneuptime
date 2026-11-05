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
import { OPENSTACK_GNOCCHI_BACKLOG_WARNING_MEASURES } from "../../../Types/OpenStack/OpenStackHealthRules";
import {
  OpenStackResourceKind,
  OpenStackServiceType,
} from "../../../Types/OpenStack/OpenStackResourceKind";
import OpenStackCloudServiceDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/ServiceDetail";
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
  tile,
} from "./OpenStackPartHarness";

/*
 * Gnocchi's API page, rendered for real over the real part cards with only the network replaced, on what a real
 * DevStack recorded (services-gnocchi). A backlog past the line is made up, and says so where it is.
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

const FOLDER: string = path.join(OPENSTACK_FIXTURES_FOLDER, "services-gnocchi");

let nextId: number = 1;

function id(): string {
  return `8d1b2a3d-4e5f-4a6b-8c7d-${String(nextId++).padStart(12, "0")}`;
}

function recorded(scene: string, exporter: string = "exporter"): Array<Row> {
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
      status: entry.status,
      facts: entry.facts,
      lastSeenAt: new Date(),
    };
  });
}

function apiOf(rows: Array<Row>): string {
  return rows.find((row: Row): boolean => {
    return (
      row["kind"] === OpenStackResourceKind.Api &&
      row["name"] === OpenStackServiceType.Metric
    );
  })!["externalId"] as string;
}

async function renderApi(rows: Array<Row>): Promise<void> {
  server.rows = rows;
  await renderPage(
    OpenStackCloudServiceDetail,
    partPath("services", apiOf(rows)),
  );
}

beforeEach(() => {
  resetServer();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Gnocchi's API page", () => {
  test("says how much is waiting and how many processors it has, as it was recorded", async () => {
    await renderApi(recorded("backlog-growing-more"));

    expect(
      await screen.findByTestId("openstack-service-tiles"),
    ).toBeInTheDocument();
    expect(
      tile("openstack-service-tiles", "Measures waiting"),
    ).toHaveTextContent("10");
    expect(
      tile("openstack-service-tiles", "Metrics waiting"),
    ).toHaveTextContent("5");
    expect(tile("openstack-service-tiles", "Processors")).toHaveTextContent(
      "0",
    );
  });

  test("no processors needs someone, though its API reads up", async () => {
    await renderApi(recorded("metricd-stopped"));

    await screen.findByTestId("openstack-service-tiles");
    await settle();
    expect(attentionRowsOf("openstack-service-attention")).toEqual([
      "This API: Nothing is processing Gnocchi's measures",
    ]);
  });

  test("a backlog past the line needs someone too, made up because no runner got near it", async () => {
    const rows: Array<Row> = recorded("baseline").map((row: Row): Row => {
      return row["name"] === OpenStackServiceType.Metric
        ? {
            ...row,
            facts: {
              ...(row["facts"] as Record<string, unknown>),
              measuresToProcess: OPENSTACK_GNOCCHI_BACKLOG_WARNING_MEASURES + 1,
            },
          }
        : row;
    });

    await renderApi(rows);

    await screen.findByTestId("openstack-service-tiles");
    await settle();
    expect(attentionRowsOf("openstack-service-attention")).toEqual([
      "This API: 10,001 measures are waiting on gnocchi-metricd",
    ]);
  });

  test("one with nothing wrong says nothing needs anyone", async () => {
    await renderApi(recorded("baseline"));

    await screen.findByTestId("openstack-service-tiles");
    await settle();
    expect(attentionRowsOf("openstack-service-attention")).toEqual([]);
  });

  test("a credential it refuses is told so, and not that it is down", async () => {
    await renderApi(recorded("access-check", "exporter/reader"));

    expect(
      await screen.findByTestId("openstack-service-closed"),
    ).toHaveTextContent(/never had an answer from Gnocchi/);
  });

  test("its alerts are the two only it has, beside its API's", async () => {
    await renderApi(recorded("baseline"));

    expect(
      await screen.findByTestId("openstack-service-alerts"),
    ).toHaveTextContent(
      /Metrics API Down[\s\S]*Gnocchi No Processors[\s\S]*Gnocchi Backlog Growing/,
    );
  });
});
