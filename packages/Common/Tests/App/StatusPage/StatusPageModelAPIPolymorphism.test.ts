import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import StatusPageAPI from "../../../../App/FeatureSet/StatusPage/src/Utils/API";
import StatusPageModelAPI from "../../../../App/FeatureSet/StatusPage/src/Utils/ModelAPI";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import DashboardAPI from "../../../UI/Utils/API/API";

/*
 * StatusPageModelAPI is deliberately a ModelAPI subclass instead of a second
 * copy of the model request implementation. The polymorphic boundary is
 * security-sensitive: falling back to DashboardAPI means a public status-page
 * request can inherit a dashboard tenant and, on a 401/405, clear the user's
 * unrelated dashboard session.
 *
 * These tests spy on the status-page and dashboard clients independently.
 * They therefore fail if ModelAPI ever hard-codes DashboardAPI again, even if
 * the request payload and successful response happen to look identical.
 */

const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "019acd10-1111-4111-8111-111111111111",
);
const RESOURCE_ID: string = "019acd10-2222-4222-8222-222222222222";
const DASHBOARD_PROJECT_ID: string = "019acd10-3333-4333-8333-333333333333";

interface StaticSpy {
  mockResolvedValue: (value: unknown) => StaticSpy;
  mockRejectedValue: (value: unknown) => StaticSpy;
  mock: { calls: Array<Array<unknown>> };
}

type FetchArguments = {
  method: HTTPMethod;
  url: URL;
  data?: JSONObject | undefined;
  headers?: Record<string, string> | undefined;
  params?: Record<string, string> | undefined;
};

let statusPageFetchSpy: StaticSpy;
let dashboardFetchSpy: StaticSpy;

const buildResource: () => StatusPageResource = (): StatusPageResource => {
  const resource: StatusPageResource = new StatusPageResource();
  resource._id = RESOURCE_ID;
  resource.statusPageId = STATUS_PAGE_ID;
  resource.displayName = "Checkout API";
  resource.order = 1;
  return resource;
};

const buildListResponse: (
  resource: StatusPageResource,
) => HTTPResponse<JSONArray> = (
  resource: StatusPageResource,
): HTTPResponse<JSONArray> => {
  return new HTTPResponse<JSONArray>(
    200,
    {
      data: [BaseModel.toJSON(resource, StatusPageResource)],
      count: 1,
      skip: 0,
      limit: 25,
    },
    {},
  );
};

const buildModelResponse: (
  resource: StatusPageResource,
) => HTTPResponse<StatusPageResource> = (
  resource: StatusPageResource,
): HTTPResponse<StatusPageResource> => {
  return new HTTPResponse<StatusPageResource>(
    200,
    BaseModel.toJSON(resource, StatusPageResource),
    {},
  );
};

const statusPageFetchArguments: () => FetchArguments = (): FetchArguments => {
  return statusPageFetchSpy.mock.calls[0]![0] as FetchArguments;
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(
    window.history.state,
    "",
    `/status-page/${STATUS_PAGE_ID.toString()}/subscribe/email`,
  );

  /*
   * Keep an unrelated dashboard project in the same tab. This is the browser
   * state from the reported bug and proves that the explicit blank tenant
   * wins over any dashboard context that ModelAPI could otherwise discover.
   */
  window.localStorage.setItem("statusPageId", STATUS_PAGE_ID.toString());
  window.sessionStorage.setItem("current_project_id", DASHBOARD_PROJECT_ID);

  /*
   * Spy on the inherited method on the subclass first. Jest then installs an
   * own spy on StatusPageAPI; the later DashboardAPI spy remains independent.
   */
  statusPageFetchSpy = jest.spyOn(
    StatusPageAPI,
    "fetch",
  ) as unknown as StaticSpy;
  dashboardFetchSpy = jest.spyOn(DashboardAPI, "fetch") as unknown as StaticSpy;

  dashboardFetchSpy.mockRejectedValue(
    new Error("the dashboard API client must not receive this request"),
  );
});

afterEach(() => {
  jest.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(window.history.state, "", "/");
});

describe("StatusPageModelAPI polymorphic API client", () => {
  test("getList dispatches through the status-page client with page-scoped headers", async () => {
    const resource: StatusPageResource = buildResource();
    statusPageFetchSpy.mockResolvedValue(buildListResponse(resource));

    const overrideRequestUrl: URL = URL.fromString(
      `https://status.example.com/api/status-page/resources/${STATUS_PAGE_ID.toString()}`,
    );

    const result: {
      data: Array<StatusPageResource>;
      count: number;
      skip: number;
      limit: number;
    } = await StatusPageModelAPI.getList<StatusPageResource>({
      modelType: StatusPageResource,
      query: { statusPageId: STATUS_PAGE_ID },
      limit: 25,
      skip: 0,
      select: { _id: true, displayName: true },
      sort: { order: SortOrder.Ascending },
      requestOptions: {
        overrideRequestUrl,
        requestHeaders: { "x-status-page-test": "list" },
      },
    });

    expect(statusPageFetchSpy.mock.calls).toHaveLength(1);
    expect(dashboardFetchSpy.mock.calls).toHaveLength(0);

    const request: FetchArguments = statusPageFetchArguments();
    expect(request.method).toBe(HTTPMethod.POST);
    expect(request.url.toString()).toBe(overrideRequestUrl.toString());
    expect(request.params).toEqual({ limit: "25", skip: "0" });
    expect(request.headers).toEqual({
      "status-page-id": STATUS_PAGE_ID.toString(),
      tenantid: "",
      "x-status-page-test": "list",
    });

    expect(result.count).toBe(1);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toBeInstanceOf(StatusPageResource);
    expect(result.data[0]?._id?.toString()).toBe(RESOURCE_ID);
  });

  test("createOrUpdate dispatches through the status-page client with the same isolated headers", async () => {
    const resource: StatusPageResource = buildResource();
    statusPageFetchSpy.mockResolvedValue(buildModelResponse(resource));

    const overrideRequestUrl: URL = URL.fromString(
      `https://status.example.com/api/status-page/subscribe/${STATUS_PAGE_ID.toString()}`,
    );

    const result: {
      data: StatusPageResource;
    } = await StatusPageModelAPI.createOrUpdate<StatusPageResource>({
      model: resource,
      modelType: StatusPageResource,
      formType: FormType.Create,
      miscDataProps: { source: "public-status-page" },
      requestOptions: {
        overrideRequestUrl,
        requestHeaders: { "x-status-page-test": "create" },
      },
    });

    expect(statusPageFetchSpy.mock.calls).toHaveLength(1);
    expect(dashboardFetchSpy.mock.calls).toHaveLength(0);

    const request: FetchArguments = statusPageFetchArguments();
    expect(request.method).toBe(HTTPMethod.POST);
    expect(request.url.toString()).toBe(overrideRequestUrl.toString());
    expect(request.headers).toEqual({
      "status-page-id": STATUS_PAGE_ID.toString(),
      tenantid: "",
      "x-status-page-test": "create",
    });
    expect(request.data?.["miscDataProps"]).toEqual({
      source: "public-status-page",
    });

    expect(result.data).toBeInstanceOf(StatusPageResource);
    expect(result.data._id?.toString()).toBe(RESOURCE_ID);
  });
});
