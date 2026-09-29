import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Log from "../../../Models/AnalyticsModels/Log";
import Incident from "../../../Models/DatabaseModels/Incident";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import Dictionary from "../../../Types/Dictionary";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import DashboardAPI from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * RequestOptions.apiClient picks the client for ONE model request. A public
 * dashboard widget uses it to send its /public-dashboard-api read through the
 * public dashboard's client, so that endpoint's 401 never reaches the
 * dashboard client's refresh-token + User.logout + /accounts/login.
 *
 * Each client's `fetch` is spied independently, and the dashboard spy rejects
 * whenever it must not be used, so a model API that ignores the routed client
 * (or hard-codes the dashboard client again) fails here.
 */

interface StaticSpy {
  mockResolvedValue: (value: unknown) => StaticSpy;
  mockRejectedValue: (value: unknown) => StaticSpy;
  mock: { calls: Array<Array<unknown>> };
}

class RoutedAPI extends DashboardAPI {}

class SubclassDefaultAPI extends DashboardAPI {}

class SubclassModelAPI extends ModelAPI {
  protected static override getApiClient(): typeof DashboardAPI {
    return SubclassDefaultAPI;
  }
}

const VIEWER_PROJECT_ID: string = "019acd20-1111-4111-8111-111111111111";

const OVERRIDE_URL: string =
  "https://dashboards.example.com/public-dashboard-api/resource-list/dashboard-id/incident";

let routedFetchSpy: StaticSpy;
let subclassDefaultFetchSpy: StaticSpy;
let dashboardFetchSpy: StaticSpy;

const listResponse: () => HTTPResponse<JSONArray> =
  (): HTTPResponse<JSONArray> => {
    return new HTTPResponse<JSONArray>(
      200,
      { data: [], count: 0, skip: 0, limit: 10 },
      {},
    );
  };

const countResponse: () => HTTPResponse<JSONObject> =
  (): HTTPResponse<JSONObject> => {
    return new HTTPResponse<JSONObject>(200, { count: 0 }, {});
  };

const requestedUrl: (spy: StaticSpy) => string = (spy: StaticSpy): string => {
  return String((spy.mock.calls[0]![0] as { url: URL }).url);
};

beforeEach(() => {
  /*
   * Spy on the inherited statics of the subclasses first: jest then installs
   * own spies on them, and the later DashboardAPI spy stays independent.
   */
  routedFetchSpy = jest.spyOn(RoutedAPI, "fetch") as unknown as StaticSpy;
  subclassDefaultFetchSpy = jest.spyOn(
    SubclassDefaultAPI,
    "fetch",
  ) as unknown as StaticSpy;
  dashboardFetchSpy = jest.spyOn(DashboardAPI, "fetch") as unknown as StaticSpy;

  routedFetchSpy.mockResolvedValue(listResponse());
  subclassDefaultFetchSpy.mockResolvedValue(listResponse());
  dashboardFetchSpy.mockRejectedValue(
    new Error("the dashboard client must not receive this request"),
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("RequestOptions.apiClient routes a single model request", () => {
  test("ModelAPI.getList sends a routed read through the routed client", async () => {
    await ModelAPI.getList<Incident>({
      modelType: Incident,
      query: {},
      limit: 10,
      skip: 0,
      select: { title: true },
      sort: {},
      requestOptions: {
        overrideRequestUrl: URL.fromString(OVERRIDE_URL),
        apiClient: RoutedAPI,
      },
    });

    expect(routedFetchSpy.mock.calls).toHaveLength(1);
    expect(requestedUrl(routedFetchSpy)).toContain(OVERRIDE_URL);
    expect(dashboardFetchSpy.mock.calls).toHaveLength(0);
  });

  test("ModelAPI.count sends a routed read through the routed client", async () => {
    routedFetchSpy.mockResolvedValue(countResponse());

    await ModelAPI.count<Incident>({
      modelType: Incident,
      query: {},
      requestOptions: {
        overrideRequestUrl: URL.fromString(OVERRIDE_URL),
        apiClient: RoutedAPI,
      },
    });

    expect(routedFetchSpy.mock.calls).toHaveLength(1);
    expect(dashboardFetchSpy.mock.calls).toHaveLength(0);
  });

  test("AnalyticsModelAPI.getList sends a routed read through the routed client", async () => {
    await AnalyticsModelAPI.getList<Log>({
      modelType: Log,
      query: {},
      limit: 10,
      skip: 0,
      select: { body: true },
      sort: {},
      requestOptions: {
        overrideRequestUrl: URL.fromString(OVERRIDE_URL),
        apiClient: RoutedAPI,
      },
    });

    expect(routedFetchSpy.mock.calls).toHaveLength(1);
    expect(requestedUrl(routedFetchSpy)).toContain(OVERRIDE_URL);
    expect(dashboardFetchSpy.mock.calls).toHaveLength(0);
  });

  test("AnalyticsModelAPI.count sends a routed read through the routed client", async () => {
    routedFetchSpy.mockResolvedValue(countResponse());

    await AnalyticsModelAPI.count<Log>(
      Log,
      {},
      {
        overrideRequestUrl: URL.fromString(OVERRIDE_URL),
        apiClient: RoutedAPI,
      },
    );

    expect(routedFetchSpy.mock.calls).toHaveLength(1);
    expect(dashboardFetchSpy.mock.calls).toHaveLength(0);
  });

  test("without a routed client, both model APIs keep the dashboard client", async () => {
    dashboardFetchSpy.mockResolvedValue(listResponse());

    await ModelAPI.getList<Incident>({
      modelType: Incident,
      query: {},
      limit: 10,
      skip: 0,
      select: { title: true },
      sort: {},
    });

    await AnalyticsModelAPI.getList<Log>({
      modelType: Log,
      query: {},
      limit: 10,
      skip: 0,
      select: { body: true },
      sort: {},
      requestOptions: { overrideRequestUrl: URL.fromString(OVERRIDE_URL) },
    });

    expect(dashboardFetchSpy.mock.calls).toHaveLength(2);
    expect(routedFetchSpy.mock.calls).toHaveLength(0);
  });

  /*
   * A ModelAPI subclass (StatusPageModelAPI) changes the DEFAULT client; a
   * request that names its own client still wins, and one that does not keeps
   * the subclass's default rather than falling back to the dashboard client.
   */
  test("a routed client wins over a subclass's default, which still applies otherwise", async () => {
    await SubclassModelAPI.getList<Incident>({
      modelType: Incident,
      query: {},
      limit: 10,
      skip: 0,
      select: { title: true },
      sort: {},
      requestOptions: {
        overrideRequestUrl: URL.fromString(OVERRIDE_URL),
        apiClient: RoutedAPI,
      },
    });

    expect(routedFetchSpy.mock.calls).toHaveLength(1);
    expect(subclassDefaultFetchSpy.mock.calls).toHaveLength(0);

    await SubclassModelAPI.getList<Incident>({
      modelType: Incident,
      query: {},
      limit: 10,
      skip: 0,
      select: { title: true },
      sort: {},
      requestOptions: { overrideRequestUrl: URL.fromString(OVERRIDE_URL) },
    });

    expect(subclassDefaultFetchSpy.mock.calls).toHaveLength(1);
    expect(dashboardFetchSpy.mock.calls).toHaveLength(0);
  });
});

/*
 * A routed request is scoped by its own client, not by the viewer's dashboard
 * project: the public dashboard's client sends an empty tenant, and a
 * remembered (possibly stale or foreign) project would override it and turn
 * the public read into a 405 (tenant not found).
 */
describe("RequestOptions.apiClient and the viewer's dashboard project", () => {
  beforeEach(() => {
    const project: Project = new Project();
    project.id = new ObjectID(VIEWER_PROJECT_ID);

    // ModelAPI reads the id; AnalyticsModelAPI reads the stored project.
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(VIEWER_PROJECT_ID));
    jest.spyOn(ProjectUtil, "getCurrentProject").mockReturnValue(project);
  });

  test("a routed request does not carry the viewer's tenant", () => {
    const modelHeaders: Dictionary<string> = ModelAPI.getCommonHeaders({
      overrideRequestUrl: URL.fromString(OVERRIDE_URL),
      apiClient: RoutedAPI,
    });

    const analyticsHeaders: Dictionary<string> =
      AnalyticsModelAPI.getCommonHeaders({
        overrideRequestUrl: URL.fromString(OVERRIDE_URL),
        apiClient: RoutedAPI,
      });

    expect(modelHeaders["tenantid"]).toBeUndefined();
    expect(analyticsHeaders["tenantid"]).toBeUndefined();
  });

  test("every other request still carries it", () => {
    expect(ModelAPI.getCommonHeaders()["tenantid"]).toBe(VIEWER_PROJECT_ID);
    expect(
      ModelAPI.getCommonHeaders({
        overrideRequestUrl: URL.fromString(OVERRIDE_URL),
      })["tenantid"],
    ).toBe(VIEWER_PROJECT_ID);
    expect(AnalyticsModelAPI.getCommonHeaders()["tenantid"]).toBe(
      VIEWER_PROJECT_ID,
    );
  });
});
