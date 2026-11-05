import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, configure, screen, within } from "@testing-library/react";
import React from "react";
import OpenStackResource from "../../../Models/DatabaseModels/OpenStackResource";
import { OPENSTACK_DEPENDENCIES } from "../../../Types/OpenStack/OpenStackControlPlane";
import CloudControlPlane from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/ControlPlane";
import CloudControlPlaneDependency from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/ControlPlaneDependency";
import {
  RecordedReading,
  RecordedScene,
  StoredMetricRow,
  foldIntoInventory,
  readClusterScene,
  rowsOfReading,
} from "../../Types/Monitor/Utils/OpenStackControlPlaneScenes";
import { Row, renderPage, resetServer, server } from "./OpenStackPartHarness";

/*
 * The Control Plane pages, rendered for real over rows the real scan made of what real clusters
 * said (OpenStackControlPlaneScenes), with only the network replaced. The line that matters:
 * what nobody names says so, and never reads as healthy.
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

let nextId: number = 1;

function rowsOfScene(sceneName: string): Array<Row> {
  const scene: RecordedScene = readClusterScene(sceneName);
  const now: number = Date.now();

  return foldIntoInventory(
    scene.readings.flatMap(
      (reading: RecordedReading, index: number): Array<StoredMetricRow> => {
        return rowsOfReading({
          scene,
          reading,
          time: new Date(now - (scene.readings.length - index) * 60000),
        });
      },
    ),
  ).map((row: OpenStackResource): Row => {
    return {
      _id: `6c1b2a3d-4e5f-4a6b-8c7d-${String(nextId++).padStart(12, "0")}`,
      kind: row.kind,
      name: row.name,
      externalId: row.externalId,
      regionName: row.regionName,
      status: row.status,
      facts: row.facts,
      lastSeenAt: row.lastSeenAt,
    } as Row;
  });
}

function cardItems(): Array<HTMLElement> {
  return screen.getAllByTestId("openstack-control-plane-card-item");
}

function itemOf(dependency: string): HTMLElement {
  return cardItems().find((item: HTMLElement): boolean => {
    return item.getAttribute("data-dependency") === dependency;
  })!;
}

function stateOf(dependency: string): string | null {
  return itemOf(dependency).getAttribute("data-state");
}

beforeEach(() => {
  resetServer();
});

afterEach(() => {
  cleanup();
});

describe("the Control Plane page's card", () => {
  test("a cloud whose agent names nothing says not watched on every line, and never healthy", async () => {
    server.rows = [];

    await renderPage(CloudControlPlane, "/control-plane");

    expect(cardItems()).toHaveLength(OPENSTACK_DEPENDENCIES.length);

    for (const dependency of OPENSTACK_DEPENDENCIES) {
      expect(stateOf(dependency)).toBe("NotWatched");
      expect(
        within(itemOf(dependency)).getByTestId("openstack-control-plane-state"),
      ).toHaveTextContent("Not watched");
      expect(
        within(itemOf(dependency)).getByTestId(
          "openstack-control-plane-card-line",
        ).textContent,
      ).toMatch(/Name its targets in OPENSTACK_\w+_TARGETS/);
    }
  });

  test("one dependency named reads as it is, and says nothing of the others", async () => {
    server.rows = rowsOfScene("rabbitmq-healthy");

    await renderPage(CloudControlPlane, "/control-plane");

    expect(stateOf("rabbitmq")).toBe("Fine");
    expect(
      within(itemOf("rabbitmq")).getByTestId("openstack-control-plane-state"),
    ).toHaveTextContent("Answering");
    expect(stateOf("mariadb")).toBe("NotWatched");
    expect(stateOf("network")).toBe("NotWatched");
  });

  test("a RabbitMQ with every node stopped reads as down, in one line", async () => {
    server.rows = rowsOfScene("rabbitmq-cluster-down");

    await renderPage(CloudControlPlane, "/control-plane");

    expect(stateOf("rabbitmq")).toBe("Broken");
    expect(
      within(itemOf("rabbitmq")).getByTestId(
        "openstack-control-plane-card-line",
      ),
    ).toHaveTextContent("Every node is down");
  });
});

describe("a dependency's own page", () => {
  test("says what its failure takes down, one line per machine, and where to go deeper", async () => {
    server.rows = rowsOfScene("mariadb-node-down");

    await renderPage(CloudControlPlaneDependency, "/control-plane/mariadb");

    expect(
      screen.getByTestId("openstack-control-plane-dependency"),
    ).toHaveAttribute("data-dependency", "mariadb");
    expect(
      screen.getByTestId("openstack-control-plane-takes-down"),
    ).toHaveTextContent("Every API keeps its state in MariaDB");
    expect(
      screen.getAllByTestId("openstack-control-plane-machine"),
    ).toHaveLength(3);
    expect(
      screen.getByTestId("openstack-control-plane-deeper"),
    ).toHaveTextContent("Databases");
  });

  test("what nobody named says so, and how to name it", async () => {
    server.rows = rowsOfScene("rabbitmq-healthy");

    await renderPage(CloudControlPlaneDependency, "/control-plane/libvirt");

    expect(
      screen.getByTestId("openstack-control-plane-not-watched"),
    ).toHaveTextContent("OPENSTACK_LIBVIRT_HEALTH_TARGETS");
    expect(
      screen.queryByTestId("openstack-control-plane-machine"),
    ).not.toBeInTheDocument();
  });
});
