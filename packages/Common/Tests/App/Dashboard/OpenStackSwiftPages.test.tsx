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
import {
  OpenStackResourceKind,
  OpenStackServiceType,
} from "../../../Types/OpenStack/OpenStackResourceKind";
import OpenStackCloudServiceDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/ServiceDetail";
import OpenStackCloudObjectContainerDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/ObjectContainerDetail";
import OpenStackCloudObjectContainers from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/ObjectContainers";
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
 * Swift's pages, rendered for real over the real tables and part cards with only the network replaced, on what a
 * real DevStack recorded (services-designate-barbican-swift).
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
  "services-designate-barbican-swift",
);

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
      openStackProjectId: entry.openStackProjectId,
      status: entry.status,
      diskAllocatedBytes: entry.diskAllocatedBytes,
      facts: entry.facts,
      lastSeenAt: new Date(),
    };
  });
}

const CONTAINER: string = "RegionOne/ou-container-admin";

beforeEach(() => {
  resetServer();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Object Storage", () => {
  test("lists a real cloud's containers, and says plainly they're one project's", async () => {
    server.rows = recorded("swift-baseline");

    await renderPage(OpenStackCloudObjectContainers, "/object-containers");
    await settle();

    expect(await screen.findByText("ou-container-admin")).toBeInTheDocument();
    expect(
      screen.getByText(/this is never the whole cloud's/),
    ).toBeInTheDocument();
  });

  test("an empty list on a cloud that doesn't run Swift says so, and is no error", async () => {
    server.rows = [];

    await renderPage(OpenStackCloudObjectContainers, "/object-containers");

    expect(
      await screen.findByText("This cloud doesn't run this service"),
    ).toBeInTheDocument();
  });

  test("a credential Swift refuses is told so, and not that its API is down", async () => {
    server.rows = recorded("access-check", "exporter/reader");

    await renderPage(OpenStackCloudObjectContainers, "/object-containers");

    expect(
      await screen.findByText("This credential has never read this service"),
    ).toBeInTheDocument();
    expect(screen.queryByText("This service's API isn't answering")).toBeNull();
  });
});

describe("Swift's API page", () => {
  const API: string = "RegionOne/object-store";

  function apiRow(facts: Record<string, unknown>): Row {
    return {
      _id: id(),
      kind: OpenStackResourceKind.Api,
      name: OpenStackServiceType.ObjectStore,
      externalId: API,
      regionName: "RegionOne",
      status: "up",
      facts: { vouchedAt: new Date().toISOString(), ...facts },
      lastSeenAt: new Date(),
    };
  }

  test("says nothing of storage servers nobody named: no trace of them", async () => {
    server.rows = [apiRow({ reconServers: 0 })];

    await renderPage(OpenStackCloudServiceDetail, partPath("services", API));

    await screen.findByTestId("openstack-service-overview");
    await settle();
    expect(screen.queryByTestId("openstack-service-tiles")).toBeNull();
  });

  test("where someone named them, what they add up to, and what needs someone", async () => {
    server.rows = [
      apiRow({
        reconServers: 3,
        reconServersNotAnswering: 1,
        reconRingsDiffering: 0,
      }),
    ];

    await renderPage(OpenStackCloudServiceDetail, partPath("services", API));

    expect(
      await screen.findByTestId("openstack-service-tiles"),
    ).toBeInTheDocument();
    expect(
      tile("openstack-service-tiles", "Storage servers read"),
    ).toHaveTextContent("3");
    await settle();
    expect(attentionRowsOf("openstack-service-attention")).toEqual([
      "This API: 1 of Swift's storage servers aren't answering",
    ]);
  });
});

describe("a container's page", () => {
  test("says how much it holds, as Swift said", async () => {
    server.rows = recorded("swift-object-down");

    await renderPage(
      OpenStackCloudObjectContainerDetail,
      partPath("object-containers", CONTAINER),
    );

    expect(
      await screen.findByTestId("openstack-object-container-tiles"),
    ).toBeInTheDocument();
    expect(tile("openstack-object-container-tiles", "Holds")).toHaveTextContent(
      "2.0 KiB",
    );
    expect(
      tile("openstack-object-container-tiles", "Objects"),
    ).toHaveTextContent("1");
    expect(attentionRowsOf("openstack-object-container-attention")).toEqual([]);
  });

  test("its alert is the one that watches every container", async () => {
    server.rows = recorded("swift-baseline");

    await renderPage(
      OpenStackCloudObjectContainerDetail,
      partPath("object-containers", CONTAINER),
    );

    expect(
      await screen.findByTestId("openstack-object-container-alerts"),
    ).toHaveTextContent(/Object Container Growth Forecast/);
  });

  test("one that has gone says so, rather than a blank page", async () => {
    server.rows = recorded("swift-baseline");

    await renderPage(
      OpenStackCloudObjectContainerDetail,
      partPath("object-containers", "not-a-container"),
    );

    expect(
      await screen.findByTestId("openstack-object-container-not-reported"),
    ).toHaveTextContent(/not in this cloud's inventory/);
  });
});
