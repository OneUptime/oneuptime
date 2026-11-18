import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import KubernetesClusterDataSecurity from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/DataSecurity";
import DataSecurityApi from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityApi";
import { RESOURCE_NO_DATA_STORES_DESCRIPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceDataSecurity/ResourceDataSecurityPages";
import { forgetResourceScopes } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceDataSecurity/UseResourceDataScope";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import Project from "../../../Models/DatabaseModels/Project";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { DataSecurityResourceScope } from "../../../Types/DataSecurity/DataSecurityApiTypes";
import DataSecurityIssueStatus from "../../../Types/DataSecurity/DataSecurityIssueStatus";
import { DataStoreResourceKind } from "../../../Types/DataSecurity/DataStoreResource";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

configure({ asyncUtilTimeout: 15000 });

/*
 * A CLUSTER'S DATA SECURITY PAGE (#9547), rendered: the data stores of the
 * databases running on it, read by the ids the server says are the
 * cluster's, and the open issues on exactly those stores - never the
 * project's every store. A cluster with no store says how one arrives.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
        i18n: { language: "en" },
      };
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const ORDERS_STORE: string = "44444444-4444-4444-8444-444444444444";
const CACHE_STORE: string = "55555555-5555-4555-8555-555555555555";

function scopeWith(dataStoreIds: Array<string>): DataSecurityResourceScope {
  return {
    kind: DataStoreResourceKind.KubernetesCluster,
    id: CLUSTER_ID.toString(),
    name: "prod-eu",
    dataStoreIds,
    ownedDataStoreIds: dataStoreIds,
    complianceOwner: null,
    isTruncated: false,
  };
}

let scopeSpy: jest.SpiedFunction<typeof DataSecurityApi.getResourceScope>;
let listSpy: jest.SpiedFunction<typeof ModelAPI.getList>;

function project(): Project {
  const value: Project = new Project();
  value.id = PROJECT_ID;
  return value;
}

beforeEach(() => {
  forgetResourceScopes();
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(CLUSTER_ID);
  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  scopeSpy = jest
    .spyOn(DataSecurityApi, "getResourceScope")
    .mockResolvedValue(scopeWith([ORDERS_STORE, CACHE_STORE]));
  listSpy = jest.spyOn(ModelAPI, "getList").mockImplementation((async () => {
    return { data: [], count: 0, skip: 0, limit: 10 } as ListResult<DataStore>;
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  forgetResourceScopes();
});

async function renderPage(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <KubernetesClusterDataSecurity
          pageRoute={
            RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_DATA_SECURITY] as Route
          }
          currentProject={project()}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  });
}

function queryOf(modelType: unknown): Record<string, unknown> | undefined {
  const call: Array<unknown> | undefined = listSpy.mock.calls.find(
    (each: Array<unknown>): boolean => {
      return (each[0] as { modelType: unknown }).modelType === modelType;
    },
  );

  return call
    ? ((call[0] as { query: Record<string, unknown> }).query as Record<
        string,
        unknown
      >)
    : undefined;
}

function idsOf(value: unknown): Array<string> {
  expect(value).toBeInstanceOf(Includes);

  return (value as Includes).values.map((id: unknown): string => {
    return String(id);
  });
}

describe("a cluster's Data Security page", () => {
  test("lists the cluster's data stores, by the ids the server says are its own", async () => {
    await renderPage();

    await waitFor(() => {
      expect(queryOf(DataStore)).toBeDefined();
    });

    expect(scopeSpy).toHaveBeenCalledWith({
      kind: DataStoreResourceKind.KubernetesCluster,
      id: CLUSTER_ID,
    });

    const stores: Record<string, unknown> = queryOf(DataStore)!;

    expect(stores["projectId"]).toEqual(PROJECT_ID);
    expect(idsOf(stores["_id"]).sort()).toEqual(
      [ORDERS_STORE, CACHE_STORE].sort(),
    );
    expect(screen.getByText("Data Stores")).toBeInTheDocument();
  });

  test("lists the open issues on those stores alone, each naming its store", async () => {
    await renderPage();

    await waitFor(() => {
      expect(queryOf(DataSecurityIssue)).toBeDefined();
    });

    const issues: Record<string, unknown> = queryOf(DataSecurityIssue)!;

    expect(idsOf(issues["dataStoreId"]).sort()).toEqual(
      [ORDERS_STORE, CACHE_STORE].sort(),
    );
    expect(issues["status"]).toBe(DataSecurityIssueStatus.Open);
    expect(screen.getByText("Open Issues")).toBeInTheDocument();
  });

  test("opens Data Security's own list of data stores from its header", async () => {
    const navigateSpy: jest.SpiedFunction<typeof Navigation.navigate> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((() => {}) as never);

    await renderPage();

    await act(async () => {
      fireEvent.click(
        await screen.findByRole("button", { name: /Open in Data Security/ }),
      );
    });

    expect(navigateSpy.mock.calls[0]![0].toString()).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.DATA_SECURITY_STORES] as Route,
      ).toString(),
    );
  });

  test("a cluster with no data store says how one arrives, and reads no store", async () => {
    scopeSpy.mockResolvedValue(scopeWith([]));

    await renderPage();

    expect(
      await screen.findByText("No data stores here yet"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        RESOURCE_NO_DATA_STORES_DESCRIPTIONS[
          DataStoreResourceKind.KubernetesCluster
        ],
      ),
    ).toBeInTheDocument();
    expect(queryOf(DataStore)).toBeUndefined();
    expect(queryOf(DataSecurityIssue)).toBeUndefined();
  });

  test("stores that could not be read are said, and no store is read in their place", async () => {
    scopeSpy.mockRejectedValue(
      new Error("This resource could not be found.") as never,
    );

    await renderPage();

    expect(
      await screen.findByText("This resource could not be found.", {
        exact: false,
      }),
    ).toBeInTheDocument();
    expect(queryOf(DataStore)).toBeUndefined();
  });
});
