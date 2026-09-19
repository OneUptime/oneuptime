// Must stay the first import: the client's URLs are built from HOST on load.
import { DASHBOARD_ORIGIN } from "../../UI/Utils/API/DashboardHost";
import FakeAxiosServer, {
  FakeTransport,
  SentRequest,
  settle,
} from "../../UI/Utils/API/FakeAxiosServer";
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import axios from "axios";
import PublicDashboardAPI from "../../../../App/FeatureSet/PublicDashboard/src/Utils/API";
import { PUBLIC_DASHBOARD_API_URL } from "../../../../App/FeatureSet/PublicDashboard/src/Utils/Config";
import PublicDashboardUtil from "../../../../App/FeatureSet/PublicDashboard/src/Utils/PublicDashboard";
import PublicDashboardWidgetContext from "../../../../App/FeatureSet/PublicDashboard/src/Utils/WidgetContext";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import DashboardIncidentListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardIncidentListComponent";
import DashboardLogStreamComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardLogStreamComponent";
import DashboardResourceList from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/DashboardResourceList";
import {
  getPublicDashboardContext,
  PublicDashboardContext,
  setPublicDashboardContext,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import SloWidgetData from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/SloWidgetData";
import Log from "../../../Models/AnalyticsModels/Log";
import Incident from "../../../Models/DatabaseModels/Incident";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardIncidentListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardIncidentListComponent";
import DashboardLogStreamComponent from "../../../Types/Dashboard/DashboardComponents/DashboardLogStreamComponent";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";
import { SLO_WIDGET_NAME_MATCH_LIMIT } from "../../../Utils/Dashboard/SloWidgetSource";
import { IDENTITY_URL } from "../../../UI/Config";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import {
  CURRENT_PROJECT_ID_STORAGE_KEY,
  LAST_ACCESSED_PROJECT_ID_STORAGE_KEY,
} from "../../../UI/Utils/Project";
import User from "../../../UI/Utils/User";

jest.mock("axios", () => {
  // Keep the real helpers (axios.isAxiosError, AxiosError) and fake only the call.
  return Object.assign(jest.fn(), jest.requireActual("axios"));
});

/*
 * A PUBLIC DASHBOARD WIDGET'S 401 BELONGS TO THE PUBLIC DASHBOARD.
 *
 * The incident/alert/monitor/host/log/... list widgets are shared with the
 * authenticated dashboard and read through ModelAPI / AnalyticsModelAPI. On a
 * public dashboard they are pointed at /public-dashboard-api/resource-list,
 * which answers 401 when the owner unpublishes the dashboard or the
 * master-password cookie lapses. Sent through the DASHBOARD client, that 401:
 * - POSTed /identity/refresh-token (a failed refresh clears every cookie on
 *   the host, the master-password cookie included),
 * - ran the dashboard's User.logout() - which, for a viewer also signed in to
 *   the dashboard on the same host, ended their real session once the
 *   successful refresh replayed into the same 401 - and
 * - force-navigated to /accounts/login, not a page on a public-dashboard
 *   custom domain.
 *
 * These tests register the context the public dashboard page registers
 * (PublicDashboardWidgetContext.build) and run the real widgets, the real
 * ModelAPI / AnalyticsModelAPI and the real BaseAPI / Common API client. A
 * scripted server stands in for axios and answers nothing but the requests
 * each test expects, so a refresh or a replay fails the test. They prove the
 * request goes through the public dashboard's own client: one request, no
 * refresh, no dashboard logout, and the public dashboard's master-password
 * page.
 */

const mockedAxios: FakeTransport = axios as unknown as FakeTransport;

const DASHBOARD_ID: string = "44444444-4444-4444-8444-444444444444";

const COMPONENT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

// The viewer's own dashboard project, remembered by this browser.
const VIEWER_PROJECT_ID: string = "55555555-5555-4555-8555-555555555555";

const PUBLIC_API_URL: string = PUBLIC_DASHBOARD_API_URL.toString();

const RESOURCE_LIST_URL: string = `${PUBLIC_API_URL}/resource-list/${DASHBOARD_ID}`;

const REFRESH_URL: string = URL.fromString(IDENTITY_URL.toString())
  .addRoute("/refresh-token")
  .toString();

const MASTER_PASSWORD_ROUTE: Route = new Route("/master-password");

const NOT_AUTHENTICATED_BODY: JSONObject = {
  message: "Master password required",
};

const EMPTY_LIST_BODY: JSONObject = {
  data: [],
  count: 0,
  skip: 0,
  limit: 10,
};

let server: FakeAxiosServer;

let navigateSpy: jest.SpiedFunction<typeof Navigation.navigate>;

let dashboardLogoutSpy: jest.SpiedFunction<typeof User.logout>;

type SentRequestsFunction = () => Array<string>;

const sentRequests: SentRequestsFunction = (): Array<string> => {
  return server.sent.map((request: SentRequest): string => {
    return `${request.method.toUpperCase()} ${request.url}`;
  });
};

type ReadFunction = () => Promise<unknown>;

const readIncidentList: ReadFunction = async (): Promise<unknown> => {
  return await ModelAPI.getList<Incident>({
    modelType: Incident,
    query: {},
    limit: 10,
    skip: 0,
    select: { title: true },
    sort: {},
    requestOptions: DashboardResourceList.getRequestOptions("incident", {
      componentId: COMPONENT_ID,
      variables: [],
    }),
  });
};

const readLogList: ReadFunction = async (): Promise<unknown> => {
  return await AnalyticsModelAPI.getList<Log>({
    modelType: Log,
    query: {},
    limit: 10,
    skip: 0,
    select: { body: true },
    sort: {},
    requestOptions: DashboardResourceList.getRequestOptions("log", {
      componentId: COMPONENT_ID,
      variables: [],
    }),
  });
};

type WidgetPropsFunction = () => DashboardBaseComponentProps;

const baseWidgetProps: WidgetPropsFunction =
  (): DashboardBaseComponentProps => {
    return {
      componentId: COMPONENT_ID,
      isEditMode: false,
      isSelected: false,
      key: "public-widget",
      onComponentUpdate: (): void => {},
      totalCurrentDashboardWidthInPx: 1200,
      dashboardCanvasTopInPx: 0,
      dashboardCanvasLeftInPx: 0,
      dashboardCanvasWidthInPx: 1200,
      dashboardCanvasHeightInPx: 800,
      dashboardComponentHeightInPx: 450,
      dashboardComponentWidthInPx: 1200,
      dashboardViewConfig: {
        _type: ObjectType.DashboardViewConfig,
        components: [],
        heightInDashboardUnits: 60,
      },
      dashboardStartAndEndDate: {
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(
          new Date("2026-08-10T00:00:00.000Z"),
          new Date("2026-08-10T06:00:00.000Z"),
        ),
      },
      metricTypes: [],
      refreshTick: 0,
    };
  };

type ExpectPublicAuthRedirectFunction = (data: {
  url: string;
  route?: Route | undefined;
}) => void;

/*
 * The whole contract, in one place: the widget's read was the only request
 * (no refresh, no replay), the dashboard session was left alone, the public
 * dashboard's own "logout" ran (it forgets the password was entered), and the
 * viewer is sent to the public dashboard's master-password page - once.
 */
const expectPublicAuthRedirect: ExpectPublicAuthRedirectFunction = (data: {
  url: string;
  route?: Route | undefined;
}): void => {
  expect(sentRequests()).toEqual([`POST ${data.url}`]);
  expect(server.requestsTo(HTTPMethod.POST, REFRESH_URL)).toEqual([]);

  expect(dashboardLogoutSpy).not.toHaveBeenCalled();
  expect(PublicDashboardUtil.isMasterPasswordValidated()).toBe(false);

  expect(navigateSpy).toHaveBeenCalledTimes(1);
  expect(navigateSpy).toHaveBeenCalledWith(
    data.route || MASTER_PASSWORD_ROUTE,
    { forceNavigate: true },
  );
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");

  server = new FakeAxiosServer(mockedAxios);

  PublicDashboardUtil.setDashboardId(new ObjectID(DASHBOARD_ID));
  PublicDashboardUtil.setRequiresMasterPassword(true);
  PublicDashboardUtil.setMasterPasswordValidated(true);

  navigateSpy = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((): void => {});

  // Also keeps the real logout from wiping storage or POSTing /logout.
  dashboardLogoutSpy = jest
    .spyOn(User, "logout")
    .mockImplementation((): void => {});

  // Navigation.getCurrentRoute needs a router; the viewer is on the dashboard.
  jest.spyOn(Navigation, "getCurrentRoute").mockReturnValue(new Route("/"));
});

afterEach(async () => {
  cleanup();
  await settle();

  setPublicDashboardContext(null);
  mockedAxios.mockReset();
  jest.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("public dashboard widget lists: a 401 goes to the master-password page", () => {
  beforeEach(() => {
    setPublicDashboardContext(
      PublicDashboardWidgetContext.build(new ObjectID(DASHBOARD_ID)),
    );
  });

  test("the real incident list widget makes no refresh, keeps the dashboard session and opens the master-password page", async () => {
    server.on(
      HTTPMethod.POST,
      `${RESOURCE_LIST_URL}/incident?limit=10&skip=0`,
      [{ status: 401, data: NOT_AUTHENTICATED_BODY }],
    );

    const component: DashboardIncidentListComponent = {
      _type: ObjectType.DashboardComponent,
      componentId: COMPONENT_ID,
      componentType: DashboardComponentType.IncidentList,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      widthInDashboardUnits: 12,
      heightInDashboardUnits: 5,
      minWidthInDashboardUnits: 6,
      minHeightInDashboardUnits: 3,
      arguments: { title: "Incidents", maxRows: 10 },
    };

    render(
      <DashboardIncidentListComponentElement
        {...baseWidgetProps()}
        component={component}
      />,
    );

    // The widget shows the error in place...
    await screen.findByText(/Master password required/);

    // ...and the page goes to the public dashboard's password prompt.
    await waitFor(() => {
      expect(navigateSpy).toHaveBeenCalled();
    });

    expectPublicAuthRedirect({
      url: `${RESOURCE_LIST_URL}/incident?limit=10&skip=0`,
    });
  });

  test("the real log stream widget (AnalyticsModelAPI) does the same", async () => {
    server.on(HTTPMethod.POST, `${RESOURCE_LIST_URL}/log?limit=10&skip=0`, [
      { status: 401, data: NOT_AUTHENTICATED_BODY },
    ]);

    const component: DashboardLogStreamComponent = {
      _type: ObjectType.DashboardComponent,
      componentId: COMPONENT_ID,
      componentType: DashboardComponentType.LogStream,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      widthInDashboardUnits: 12,
      heightInDashboardUnits: 5,
      minWidthInDashboardUnits: 6,
      minHeightInDashboardUnits: 3,
      arguments: { title: "Logs", maxRows: 10 },
    };

    render(
      <DashboardLogStreamComponentElement
        {...baseWidgetProps()}
        component={component}
      />,
    );

    await screen.findByText(/Master password required/);

    await waitFor(() => {
      expect(navigateSpy).toHaveBeenCalled();
    });

    expectPublicAuthRedirect({
      url: `${RESOURCE_LIST_URL}/log?limit=10&skip=0`,
    });
  });

  test("a ModelAPI list read gets its 401 back", async () => {
    server.on(
      HTTPMethod.POST,
      `${RESOURCE_LIST_URL}/incident?limit=10&skip=0`,
      [{ status: 401, data: NOT_AUTHENTICATED_BODY }],
    );

    await expect(readIncidentList()).rejects.toMatchObject({
      statusCode: 401,
    });

    expectPublicAuthRedirect({
      url: `${RESOURCE_LIST_URL}/incident?limit=10&skip=0`,
    });
  });

  test("an AnalyticsModelAPI list read gets its 401 back", async () => {
    server.on(HTTPMethod.POST, `${RESOURCE_LIST_URL}/log?limit=10&skip=0`, [
      { status: 401, data: NOT_AUTHENTICATED_BODY },
    ]);

    await expect(readLogList()).rejects.toMatchObject({ statusCode: 401 });

    expectPublicAuthRedirect({
      url: `${RESOURCE_LIST_URL}/log?limit=10&skip=0`,
    });
  });

  test("the SLO widget's reads (pinned and by name) do the same", async () => {
    server.on(HTTPMethod.POST, `${RESOURCE_LIST_URL}/slo?limit=1&skip=0`, [
      { status: 401, data: NOT_AUTHENTICATED_BODY },
    ]);

    await expect(
      SloWidgetData.fetchSlo({
        serviceLevelObjectiveId: new ObjectID(
          "22222222-2222-4222-8222-222222222222",
        ),
        componentId: COMPONENT_ID,
      }),
    ).rejects.toMatchObject({ statusCode: 401 });

    expectPublicAuthRedirect({
      url: `${RESOURCE_LIST_URL}/slo?limit=1&skip=0`,
    });

    server.sent.length = 0;
    navigateSpy.mockClear();

    const byNameUrl: string = `${RESOURCE_LIST_URL}/slo?limit=${SLO_WIDGET_NAME_MATCH_LIMIT}&skip=0`;

    server.on(HTTPMethod.POST, byNameUrl, [
      { status: 401, data: NOT_AUTHENTICATED_BODY },
    ]);

    await expect(
      SloWidgetData.fetchSlosByName({
        sloName: "Checkout availability",
        componentId: COMPONENT_ID,
        variables: [],
      }),
    ).rejects.toMatchObject({ statusCode: 401 });

    expectPublicAuthRedirect({ url: byNameUrl });
  });

  /*
   * Before the fix, a viewer who was ALSO signed in to the dashboard on the
   * same host had the refresh succeed, the replay 401 again, and
   * User.logout() end their real dashboard session.
   */
  test("a viewer also signed in to the dashboard keeps their dashboard session", async () => {
    server
      .on(HTTPMethod.POST, `${RESOURCE_LIST_URL}/incident?limit=10&skip=0`, [
        { status: 401, data: NOT_AUTHENTICATED_BODY },
      ])
      .on(HTTPMethod.POST, REFRESH_URL, [{ status: 200 }]);

    await expect(readIncidentList()).rejects.toMatchObject({
      statusCode: 401,
    });

    expectPublicAuthRedirect({
      url: `${RESOURCE_LIST_URL}/incident?limit=10&skip=0`,
    });
  });

  test("the preview of a protected dashboard goes to the preview's master-password page", async () => {
    window.history.replaceState(
      null,
      "",
      `/public-dashboard/${DASHBOARD_ID}/view`,
    );

    server.on(
      HTTPMethod.POST,
      `${RESOURCE_LIST_URL}/incident?limit=10&skip=0`,
      [{ status: 401, data: NOT_AUTHENTICATED_BODY }],
    );

    await expect(readIncidentList()).rejects.toMatchObject({
      statusCode: 401,
    });

    expectPublicAuthRedirect({
      url: `${RESOURCE_LIST_URL}/incident?limit=10&skip=0`,
      route: new Route(`/public-dashboard/${DASHBOARD_ID}/master-password`),
    });
  });

  // The metric and SLO-history reads were already on the public client.
  test("the page's postJSON reads never refresh either", async () => {
    const url: string = `${PUBLIC_API_URL}/metrics-aggregate/${DASHBOARD_ID}`;

    server.on(HTTPMethod.POST, url, [
      { status: 401, data: NOT_AUTHENTICATED_BODY },
    ]);

    const context: PublicDashboardContext | null = getPublicDashboardContext();

    if (!context) {
      throw new Error("The public dashboard context should be set.");
    }

    const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await context.postJSON(`/metrics-aggregate/${DASHBOARD_ID}`, {});

    expect(result).toBeInstanceOf(HTTPErrorResponse);
    expect(result.statusCode).toBe(401);

    expectPublicAuthRedirect({ url });
  });

  /*
   * The public client sends its own, empty, tenant. The viewer's remembered
   * dashboard project must not override it: a stale or foreign one turned a
   * public widget read into a 405 (tenant not found) that the page treats as
   * a login event, while the dashboard's own reads - sent without it - kept
   * succeeding.
   */
  test("list reads carry the public dashboard's headers, not the viewer's dashboard project", async () => {
    window.localStorage.setItem(
      LAST_ACCESSED_PROJECT_ID_STORAGE_KEY,
      JSON.stringify(VIEWER_PROJECT_ID),
    );
    window.sessionStorage.setItem(
      CURRENT_PROJECT_ID_STORAGE_KEY,
      JSON.stringify(VIEWER_PROJECT_ID),
    );

    server
      .on(HTTPMethod.POST, `${RESOURCE_LIST_URL}/incident?limit=10&skip=0`, [
        { status: 200, data: EMPTY_LIST_BODY },
      ])
      .on(HTTPMethod.POST, `${RESOURCE_LIST_URL}/log?limit=10&skip=0`, [
        { status: 200, data: EMPTY_LIST_BODY },
      ]);

    await readIncidentList();
    await readLogList();

    expect(server.sent).toHaveLength(2);

    for (const request of server.sent) {
      expect(request.headers["dashboard-id"]).toBe(DASHBOARD_ID);
      expect(request.headers["tenantid"]).toBe("");
    }

    expect(navigateSpy).not.toHaveBeenCalled();
  });

  test("the page's context routes list reads through the public dashboard's client", () => {
    const context: PublicDashboardContext = PublicDashboardWidgetContext.build(
      new ObjectID(DASHBOARD_ID),
    );

    expect(context.apiClient).toBe(PublicDashboardAPI);
    expect(context.apiUrl.toString()).toBe(PUBLIC_API_URL);

    expect(DashboardResourceList.getRequestOptions("incident")?.apiClient).toBe(
      PublicDashboardAPI,
    );
    expect(
      DashboardResourceList.getRequestOptions("log", {
        componentId: COMPONENT_ID,
        variables: [],
      })?.apiClient,
    ).toBe(PublicDashboardAPI);
  });
});

/*
 * The fix must not reach the authenticated dashboard: without a public
 * context its reads still go through the dashboard client, which still
 * refreshes an expired session, still logs out when that fails, and still
 * scopes the read to the viewer's project.
 */
describe("authenticated dashboard widget lists keep the dashboard client", () => {
  const DASHBOARD_API_URL: string = `${DASHBOARD_ORIGIN}/api`;

  const INCIDENT_LIST_URL: string = `${DASHBOARD_API_URL}/incident/get-list?limit=10&skip=0`;

  const LOG_LIST_URL: string = `${DASHBOARD_API_URL}/logs/get-list?limit=10&skip=0`;

  const readDashboardIncidentList: ReadFunction =
    async (): Promise<unknown> => {
      return await ModelAPI.getList<Incident>({
        modelType: Incident,
        query: {},
        limit: 10,
        skip: 0,
        select: { title: true },
        sort: {},
        requestOptions: DashboardResourceList.getRequestOptions("incident"),
      });
    };

  beforeEach(() => {
    window.sessionStorage.setItem(
      CURRENT_PROJECT_ID_STORAGE_KEY,
      JSON.stringify(VIEWER_PROJECT_ID),
    );
  });

  test("a 401 refreshes the session and replays the read, scoped to the viewer's project", async () => {
    server
      .on(HTTPMethod.POST, INCIDENT_LIST_URL, [
        { status: 401, data: { message: "Session expired" } },
        { status: 200, data: EMPTY_LIST_BODY },
      ])
      .on(HTTPMethod.POST, REFRESH_URL, [{ status: 200 }]);

    await expect(readDashboardIncidentList()).resolves.toMatchObject({
      data: [],
    });

    expect(sentRequests()).toEqual([
      `POST ${INCIDENT_LIST_URL}`,
      `POST ${REFRESH_URL}`,
      `POST ${INCIDENT_LIST_URL}`,
    ]);
    expect(server.sent[0]!.headers["tenantid"]).toBe(VIEWER_PROJECT_ID);
    expect(dashboardLogoutSpy).not.toHaveBeenCalled();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  test("a refused refresh still logs the dashboard user out, for model and analytics reads", async () => {
    server
      .on(HTTPMethod.POST, INCIDENT_LIST_URL, [
        { status: 401, data: { message: "Session expired" } },
      ])
      .on(HTTPMethod.POST, LOG_LIST_URL, [
        { status: 401, data: { message: "Session expired" } },
      ])
      .on(HTTPMethod.POST, REFRESH_URL, [{ status: 401 }, { status: 401 }]);

    await expect(readDashboardIncidentList()).rejects.toMatchObject({
      statusCode: 401,
    });

    expect(server.requestsTo(HTTPMethod.POST, REFRESH_URL)).toHaveLength(1);
    expect(dashboardLogoutSpy).toHaveBeenCalled();
    expect(navigateSpy).toHaveBeenCalledWith(new Route("/accounts/login"), {
      forceNavigate: true,
    });

    dashboardLogoutSpy.mockClear();

    await expect(
      AnalyticsModelAPI.getList<Log>({
        modelType: Log,
        query: {},
        limit: 10,
        skip: 0,
        select: { body: true },
        sort: {},
        requestOptions: DashboardResourceList.getRequestOptions("log"),
      }),
    ).rejects.toMatchObject({ statusCode: 401 });

    expect(server.requestsTo(HTTPMethod.POST, REFRESH_URL)).toHaveLength(2);
    expect(dashboardLogoutSpy).toHaveBeenCalled();
  });
});
