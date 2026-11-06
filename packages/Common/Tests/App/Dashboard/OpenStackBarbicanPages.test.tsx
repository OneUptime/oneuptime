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
import {
  OpenStackResourceKind,
  OpenStackServiceType,
} from "../../../Types/OpenStack/OpenStackResourceKind";
import OpenStackCloudServiceDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/ServiceDetail";
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
 * Barbican's API page, rendered for real over the real part cards with only the network replaced. Only a probe says
 * anything of Barbican and these are the numbers a probe sends, which OpenStackBarbicanCollection.test.ts holds to
 * what a real Barbican answered: so the row here is written by hand from those.
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

const API: string = "RegionOne/key-manager";

function row(overrides: Row = {}): Row {
  return {
    _id: "8d1b2a3d-4e5f-4a6b-8c7d-000000000001",
    kind: OpenStackResourceKind.Api,
    name: OpenStackServiceType.KeyManager,
    externalId: API,
    regionName: "RegionOne",
    status: "up",
    facts: {
      vouchedAt: new Date().toISOString(),
      secretCount: 2,
      orderCount: 1,
      containerCount: 0,
    },
    lastSeenAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  resetServer();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Barbican's API page", () => {
  test("says how many of each this project holds, as Barbican said", async () => {
    server.rows = [row()];

    await renderPage(OpenStackCloudServiceDetail, partPath("services", API));

    expect(
      await screen.findByTestId("openstack-service-tiles"),
    ).toBeInTheDocument();
    expect(tile("openstack-service-tiles", "Secrets")).toHaveTextContent("2");
    expect(tile("openstack-service-tiles", "Orders")).toHaveTextContent("1");
    expect(tile("openstack-service-tiles", "Containers")).toHaveTextContent(
      "0",
    );
    expect(attentionRowsOf("openstack-service-attention")).toEqual([]);
  });

  test("a count it refused to say reads as nothing, and not as none", async () => {
    server.rows = [row({ facts: { vouchedAt: new Date().toISOString() } })];

    await renderPage(OpenStackCloudServiceDetail, partPath("services", API));

    expect(
      await screen.findByTestId("openstack-service-tiles"),
    ).toBeInTheDocument();
    expect(tile("openstack-service-tiles", "Secrets")).toHaveTextContent("—");
  });

  test("its API down is its API down: a probe tells that from a refusal", async () => {
    server.rows = [row({ status: "down" })];

    await renderPage(OpenStackCloudServiceDetail, partPath("services", API));

    await screen.findByTestId("openstack-service-tiles");
    await settle();
    expect(attentionRowsOf("openstack-service-attention")).toHaveLength(1);
    expect(screen.queryByTestId("openstack-service-closed")).toBeNull();
  });
});
