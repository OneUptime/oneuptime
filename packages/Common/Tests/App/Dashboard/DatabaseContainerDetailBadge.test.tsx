import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * "Open database" on the Docker and Podman container pages, rendered for
 * real. `docker compose up` runs project "shop"'s "db" service as the
 * container "shop-db-1", and container discovery names its database
 * "shop-db" — from the Compose labels on the container's inventory row.
 * The page must find it: it reads the row's labels (and its image when no
 * recent metric carried one) and asks for the name discovery gave.
 */

const HOST_ID: string = "d0c4e000-0000-4000-8000-000000000001";
const DATABASE_ID: string = "84858d6c-1111-4aaa-8bbb-000000000001";

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getAnalyticsListMock: MockFunction = getJestMockFunction();

// The arrow wrappers are load bearing: jest.mock is hoisted above the mocks.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getAnalyticsListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Components/Tabs/Tabs", () => {
  return {
    __esModule: true,
    default: () => {
      return <div data-testid="tabs" />;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCard",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div />;
      },
    };
  },
);

import DockerHostContainerDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/View/ContainerDetail";
import PodmanHostContainerDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/View/ContainerDetail";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import DockerResource from "../../../Models/DatabaseModels/DockerResource";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import PodmanResource from "../../../Models/DatabaseModels/PodmanResource";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/test/docker/test"),
  currentProject: null,
  hasPaymentMethod: true,
};

interface ListArgs {
  modelType: unknown;
  query: Record<string, unknown>;
}

interface PlatformCase {
  platform: "docker" | "podman";
  Page: React.FunctionComponent<PageComponentProps>;
  hostModel: unknown;
  resourceModel: unknown;
  hostColumn: string;
  labels: Record<string, string>;
}

const CASES: Array<[string, PlatformCase]> = [
  [
    "Docker",
    {
      platform: "docker",
      Page: DockerHostContainerDetail,
      hostModel: DockerHost,
      resourceModel: DockerResource,
      hostColumn: "dockerHostId",
      labels: {
        "com.docker.compose.project": "shop",
        "com.docker.compose.service": "db",
      },
    },
  ],
  [
    "Podman",
    {
      platform: "podman",
      Page: PodmanHostContainerDetail,
      hostModel: PodmanHost,
      resourceModel: PodmanResource,
      hostColumn: "podmanHostId",
      labels: {
        "io.podman.compose.project": "shop",
        "io.podman.compose.service": "db",
      },
    },
  ],
];

function database(): DatabaseServer {
  const row: DatabaseServer = new DatabaseServer();
  row._id = DATABASE_ID;
  row.name = "shop-db";
  row.dbSystem = "postgresql";
  row.workloadName = "shop-db";
  return row;
}

function listCalls(modelType: unknown): Array<ListArgs> {
  return getListMock.mock.calls
    .map((call: Array<unknown>): ListArgs => {
      return call[0] as ListArgs;
    })
    .filter((args: ListArgs): boolean => {
      return args.modelType === modelType;
    });
}

beforeEach(() => {
  getItemMock.mockReset();
  getListMock.mockReset();
  getAnalyticsListMock.mockReset();
  getItemMock.mockResolvedValue({
    hostIdentifier: "host-1",
    name: "host-1",
  });
});

afterEach(() => {
  cleanup();
});

describe("'Open database' on a Compose container's page", () => {
  test.each(CASES)(
    "%s: the Compose labels on the inventory row find the database",
    async (_label: string, data: PlatformCase) => {
      goTo(
        `/dashboard/${PROJECT_ID}/${data.platform}/${HOST_ID}/containers/shop-db-1`,
      );
      // No container.cpu.utilization point in the last ten minutes.
      getAnalyticsListMock.mockResolvedValue({ data: [], count: 0 });
      getListMock.mockImplementation(async (args: unknown) => {
        const list: ListArgs = args as ListArgs;
        if (list.modelType === DatabaseServer) {
          return { data: [database()], count: 1 };
        }
        return {
          data: [{ labels: data.labels, imageName: "postgres:16" }],
          count: 1,
        };
      });

      render(
        <MemoryRouter>
          <data.Page {...PAGE_PROPS} />
        </MemoryRouter>,
      );

      expect(
        await screen.findByTestId("database-server-workload-badge"),
      ).toHaveTextContent(
        "This container runs the PostgreSQL database shop-db",
      );
      expect(
        screen.getByRole("link", { name: /Open database/ }),
      ).toHaveAttribute(
        "href",
        `/dashboard/${PROJECT_ID}/databases/${DATABASE_ID}`,
      );

      const inventory: Array<ListArgs> = listCalls(data.resourceModel);
      expect(inventory).toHaveLength(1);
      expect(
        (inventory[0]!.query[data.hostColumn] as ObjectID).toString(),
      ).toBe(HOST_ID);
      expect((inventory[0]!.query["name"] as Includes).values).toEqual([
        "shop-db-1",
        "/shop-db-1",
      ]);

      const lookups: Array<ListArgs> = listCalls(DatabaseServer);
      expect(lookups).toHaveLength(1);
      expect((lookups[0]!.query[data.hostColumn] as ObjectID).toString()).toBe(
        HOST_ID,
      );
      expect((lookups[0]!.query["workloadName"] as Includes).values).toEqual([
        "shop-db",
        "shop-db-1",
      ]);
      expect(getItemMock.mock.calls[0]![0]).toEqual(
        expect.objectContaining({ modelType: data.hostModel }),
      );
    },
  );
});
