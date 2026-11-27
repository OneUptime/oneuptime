import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  CLOUD_CONNECT_CONNECTION_QUERY_PARAM,
  getCloudConnectRoute,
  isCloudConnectionIdInLink,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudConnectRoutes";
import {
  CloudConnectionsAccess,
  StepCheckLinkTarget,
  getStepCheckLinkTarget,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponseChecks";
import { getResponseLinkRoute } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponseLinks";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import {
  ResponseLink,
  ResponseLinkKind,
  readResponseLink,
} from "../../../Types/SecurityCase/SecurityCaseResponseLink";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  CHECK_ACCOUNT_CHANGES_EDIT_CONNECTION,
  CHECK_ACCOUNT_CHANGES_OPEN_CLOUD_CONNECTIONS,
  STEP_CHECK_OPEN_BLOCKLIST,
} from "../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";

/*
 * A STEP'S LINE LINKS TO THE AWS CONNECTION IT MEANS (#11039): a link kind
 * the card routes - Cloud > Connect, on the connection's form when the link
 * names one - through the Dashboard's RouteUtil and PageMap, never an
 * address of the server's. The card draws it only for a reader who may see
 * Cloud > Connect, worded by what they may do there.
 */

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const CONNECTION_ID: string = "5d0c2a7e-0000-4000-8000-00000000c0de";
const CONNECT_PAGE: string = `/dashboard/${PROJECT_ID}/cloud/connect`;

const EDITS: CloudConnectionsAccess = { mayRead: true, mayUpdate: true };
const SEES: CloudConnectionsAccess = { mayRead: true, mayUpdate: false };
const NEITHER: CloudConnectionsAccess = { mayRead: false, mayUpdate: false };

const TO_CONNECTION: ResponseLink = {
  kind: ResponseLinkKind.OpenCloudConnection,
  connectionId: CONNECTION_ID,
};
const TO_PAGE: ResponseLink = { kind: ResponseLinkKind.OpenCloudConnection };

beforeEach(() => {
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  jest.restoreAllMocks();
});

function where(target: StepCheckLinkTarget | null): unknown {
  return target
    ? {
        route: target.route?.toString(),
        url: target.url?.toString(),
        title: target.title,
        values: target.values,
      }
    : null;
}

describe("the link as stored, read back", () => {
  test("names a connection by its id, and only an id; anything else is Cloud > Connect itself", () => {
    expect(
      readResponseLink({
        kind: "OpenCloudConnection",
        connectionId: CONNECTION_ID.toUpperCase(),
      }),
    ).toEqual(TO_CONNECTION);

    for (const connectionId of [
      undefined,
      "",
      "aws",
      "../../admin",
      `${CONNECTION_ID}?x=1`,
      42,
    ]) {
      expect({
        connectionId,
        link: readResponseLink({ kind: "OpenCloudConnection", connectionId }),
      }).toEqual({ connectionId, link: TO_PAGE });
    }
  });
});

describe("where it opens", () => {
  test("Cloud > Connect, on the connection's form when it names one", () => {
    expect(getResponseLinkRoute(TO_CONNECTION)?.toString()).toBe(
      `${CONNECT_PAGE}?${CLOUD_CONNECT_CONNECTION_QUERY_PARAM}=${CONNECTION_ID}`,
    );
    expect(getResponseLinkRoute(TO_PAGE)?.toString()).toBe(CONNECT_PAGE);
  });

  test("a route of the Dashboard's own, never an address the link carried", () => {
    const route: Route = getCloudConnectRoute("https://evil.example.com");

    expect(route.toString()).toBe(CONNECT_PAGE);
    expect(getCloudConnectRoute(undefined).toString()).toBe(CONNECT_PAGE);
    expect(isCloudConnectionIdInLink(CONNECTION_ID)).toBe(true);
    expect(isCloudConnectionIdInLink("")).toBe(false);
    expect(isCloudConnectionIdInLink(null)).toBe(false);
    expect(isCloudConnectionIdInLink(`${CONNECTION_ID} `)).toBe(false);
  });
});

describe("what the card draws, by what the reader may do on Cloud > Connect", () => {
  test("one who may change connections: Edit Connection, to its form", () => {
    expect(where(getStepCheckLinkTarget(TO_CONNECTION, EDITS))).toEqual({
      route: `${CONNECT_PAGE}?connection=${CONNECTION_ID}`,
      url: undefined,
      title: CHECK_ACCOUNT_CHANGES_EDIT_CONNECTION,
      values: {},
    });
  });

  test("one who may only see them: Open Cloud Connections, to the page", () => {
    expect(where(getStepCheckLinkTarget(TO_CONNECTION, SEES))).toEqual({
      route: CONNECT_PAGE,
      url: undefined,
      title: CHECK_ACCOUNT_CHANGES_OPEN_CLOUD_CONNECTIONS,
      values: {},
    });
  });

  test("a link that names no connection is the page, whoever reads it", () => {
    for (const access of [EDITS, SEES]) {
      expect(where(getStepCheckLinkTarget(TO_PAGE, access))).toEqual({
        route: CONNECT_PAGE,
        url: undefined,
        title: CHECK_ACCOUNT_CHANGES_OPEN_CLOUD_CONNECTIONS,
        values: {},
      });
    }
  });

  test("one who may not see Cloud > Connect gets nothing - nor a card that did not say who reads it", () => {
    for (const link of [TO_CONNECTION, TO_PAGE]) {
      expect(getStepCheckLinkTarget(link, NEITHER)).toBeNull();
      expect(getStepCheckLinkTarget(link)).toBeNull();
    }
  });

  test("the other links are drawn as they were, whatever the reader may do on Cloud > Connect", () => {
    for (const access of [EDITS, NEITHER]) {
      expect(
        getStepCheckLinkTarget(
          { kind: ResponseLinkKind.OpenBlocklist, value: "203.0.113.7" },
          access,
        )?.title,
      ).toBe(STEP_CHECK_OPEN_BLOCKLIST);
    }
  });
});
