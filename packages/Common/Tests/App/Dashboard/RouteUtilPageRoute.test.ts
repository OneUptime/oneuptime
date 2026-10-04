import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import { RouteUtil } from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A link that opens a page a particular way - On-Call Rules on its alerts
 * tab, say - is the page's address with a query after it. The readiness
 * card, the setup checklist and Team Compliance all build theirs with these
 * two helpers, so what they do with no query, a query the route already has
 * and a value that needs encoding is pinned here.
 */

const PROJECT_ID: string = "5f8c1e2a-0b3d-4c5e-8f7a-9b0c1d2e3f40";
const USER_ID: string = "0a1b2c3d-4e5f-4a6b-8c7d-00000000e0f1";

describe("RouteUtil.addQuery", () => {
  test("no query, or an empty one, leaves the route as it was", () => {
    const route: Route = new Route("/dashboard/p/user-settings/on-call-rules");

    expect(RouteUtil.addQuery(route).toString()).toBe(
      "/dashboard/p/user-settings/on-call-rules",
    );
    expect(RouteUtil.addQuery(route, {}).toString()).toBe(
      "/dashboard/p/user-settings/on-call-rules",
    );
  });

  test("puts the query after the route", () => {
    expect(
      RouteUtil.addQuery(new Route("/dashboard/p/on-call-rules"), {
        type: "alerts",
      }).toString(),
    ).toBe("/dashboard/p/on-call-rules?type=alerts");
  });

  test("encodes the values", () => {
    expect(
      RouteUtil.addQuery(new Route("/dashboard/p"), {
        note: "a b&c",
      }).toString(),
    ).toBe("/dashboard/p?note=a+b%26c");
  });

  test("keeps a query the route already has, and replaces a parameter of the same name", () => {
    expect(
      RouteUtil.addQuery(new Route("/dashboard/p?from=email&type=incidents"), {
        type: "alerts",
      }).toString(),
    ).toBe("/dashboard/p?from=email&type=alerts");
  });

  test("leaves the route it was given alone", () => {
    const route: Route = new Route("/dashboard/p");

    RouteUtil.addQuery(route, { type: "alerts" });

    expect(route.toString()).toBe("/dashboard/p");
  });
});

describe("RouteUtil.getPageRoute", () => {
  beforeEach(() => {
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(PROJECT_ID));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is the page's address in the current project", () => {
    expect(
      RouteUtil.getPageRoute(PageMap.USER_SETTINGS_ON_CALL_RULES).toString(),
    ).toBe(`/dashboard/${PROJECT_ID}/user-settings/on-call-rules`);
  });

  test("opened the way the query says", () => {
    expect(
      RouteUtil.getPageRoute(PageMap.USER_SETTINGS_ON_CALL_RULES, {
        query: { type: "alert-episodes" },
      }).toString(),
    ).toBe(
      `/dashboard/${PROJECT_ID}/user-settings/on-call-rules?type=alert-episodes`,
    );
  });

  test("an empty query opens the page's bare address", () => {
    expect(
      RouteUtil.getPageRoute(PageMap.USER_SETTINGS_ON_CALL_RULES, {
        query: {},
      }).toString(),
    ).toBe(`/dashboard/${PROJECT_ID}/user-settings/on-call-rules`);
  });

  test("for a model's page, the model's", () => {
    expect(
      RouteUtil.getPageRoute(PageMap.USER_VIEW_ON_CALL_RULES, {
        modelId: new ObjectID(USER_ID),
        query: { type: "alerts" },
      }).toString(),
    ).toBe(
      `/dashboard/${PROJECT_ID}/users/${USER_ID}/on-call-rules?type=alerts`,
    );
  });
});
