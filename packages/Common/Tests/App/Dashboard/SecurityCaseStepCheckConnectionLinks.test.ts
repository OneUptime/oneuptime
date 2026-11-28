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
  ConnectionsAccess,
  NO_CONNECTIONS_ACCESS,
  StepCheckLinkAccess,
  StepCheckLinkTarget,
  getStepCheckLinkTarget,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponseChecks";
import { getResponseLinkRoute } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponseLinks";
import {
  SECURITY_EVENT_CONNECTION_QUERY_PARAM,
  getSecurityEventConnectionsRoute,
  isSecurityEventConnectionIdInLink,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventConnectionsRoutes";
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
  CHECK_ACCOUNT_CHANGES_OPEN_SECURITY_EVENT_CONNECTIONS,
  STEP_CHECK_OPEN_BLOCKLIST,
} from "../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";

/*
 * A STEP'S LINE LINKS TO THE CONNECTION IT MEANS: the AWS connection under
 * Cloud > Connect (#11039), and the Google Workspace one under Security
 * Events > Connections (#11376) - link kinds the card routes, on the
 * connection's form when the link names one, through the Dashboard's
 * RouteUtil and PageMap, never an address of the server's. The card draws
 * each only for a reader who may see its page, worded by what they may do
 * there: Edit Connection for one who may change it, the page for one who
 * may only see it, nothing for anyone else.
 */

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const CONNECTION_ID: string = "5d0c2a7e-0000-4000-8000-00000000c0de";
const CONNECT_PAGE: string = `/dashboard/${PROJECT_ID}/cloud/connect`;
const SECURITY_CONNECTIONS_PAGE: string = `/dashboard/${PROJECT_ID}/security-events/connections`;

const EDITS_ALL: ConnectionsAccess = { mayRead: true, mayUpdate: true };
const SEES_ALL: ConnectionsAccess = { mayRead: true, mayUpdate: false };

// What a reader may do on Cloud > Connect alone.
function onCloudConnect(access: ConnectionsAccess): StepCheckLinkAccess {
  return {
    cloudConnections: access,
    securityEventConnections: NO_CONNECTIONS_ACCESS,
  };
}

// What a reader may do on Security Events > Connections alone.
function onSecurityConnections(access: ConnectionsAccess): StepCheckLinkAccess {
  return {
    cloudConnections: NO_CONNECTIONS_ACCESS,
    securityEventConnections: access,
  };
}

const EDITS: StepCheckLinkAccess = onCloudConnect(EDITS_ALL);
const SEES: StepCheckLinkAccess = onCloudConnect(SEES_ALL);
const NEITHER: StepCheckLinkAccess = onCloudConnect(NO_CONNECTIONS_ACCESS);

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

// ---------- Security Events > Connections (#11376) ----------

const TO_SECURITY_CONNECTION: ResponseLink = {
  kind: ResponseLinkKind.OpenSecurityEventConnection,
  connectionId: CONNECTION_ID,
};
const TO_SECURITY_CONNECTIONS: ResponseLink = {
  kind: ResponseLinkKind.OpenSecurityEventConnection,
};

describe("the Google Workspace line's link, as stored and read back (#11376)", () => {
  test("names a connection by its id, and only an id; anything else is Security Events > Connections itself", () => {
    expect(
      readResponseLink({
        kind: "OpenSecurityEventConnection",
        connectionId: CONNECTION_ID.toUpperCase(),
      }),
    ).toEqual(TO_SECURITY_CONNECTION);

    for (const connectionId of [
      undefined,
      "",
      "google",
      "../../admin",
      `${CONNECTION_ID}?x=1`,
      42,
    ]) {
      expect({
        connectionId,
        link: readResponseLink({
          kind: "OpenSecurityEventConnection",
          connectionId,
        }),
      }).toEqual({ connectionId, link: TO_SECURITY_CONNECTIONS });
    }
  });

  test("Security Events > Connections, on the connection's form when it names one - a route of the Dashboard's own", () => {
    expect(getResponseLinkRoute(TO_SECURITY_CONNECTION)?.toString()).toBe(
      `${SECURITY_CONNECTIONS_PAGE}?${SECURITY_EVENT_CONNECTION_QUERY_PARAM}=${CONNECTION_ID}`,
    );
    expect(getResponseLinkRoute(TO_SECURITY_CONNECTIONS)?.toString()).toBe(
      SECURITY_CONNECTIONS_PAGE,
    );
    expect(
      getSecurityEventConnectionsRoute("https://evil.example.com").toString(),
    ).toBe(SECURITY_CONNECTIONS_PAGE);
    expect(SECURITY_EVENT_CONNECTION_QUERY_PARAM).toBe("connection");
    expect(isSecurityEventConnectionIdInLink(CONNECTION_ID)).toBe(true);
    expect(isSecurityEventConnectionIdInLink(`${CONNECTION_ID} `)).toBe(false);
    expect(isSecurityEventConnectionIdInLink(null)).toBe(false);
  });
});

describe("what the card draws, by what the reader may do on Security Events > Connections (#11376)", () => {
  test("one who may change connections - a Security Admin: Edit Connection, to its form", () => {
    expect(
      where(
        getStepCheckLinkTarget(
          TO_SECURITY_CONNECTION,
          onSecurityConnections(EDITS_ALL),
        ),
      ),
    ).toEqual({
      route: `${SECURITY_CONNECTIONS_PAGE}?connection=${CONNECTION_ID}`,
      url: undefined,
      title: CHECK_ACCOUNT_CHANGES_EDIT_CONNECTION,
      values: {},
    });
  });

  test("one who may only see them - a Security Member: Open Security Event Connections, to the page", () => {
    for (const link of [TO_SECURITY_CONNECTION, TO_SECURITY_CONNECTIONS]) {
      expect(
        where(getStepCheckLinkTarget(link, onSecurityConnections(SEES_ALL))),
      ).toEqual({
        route: SECURITY_CONNECTIONS_PAGE,
        url: undefined,
        title: CHECK_ACCOUNT_CHANGES_OPEN_SECURITY_EVENT_CONNECTIONS,
        values: {},
      });
    }
  });

  test("a link that names no connection is the page, even for one who may change them", () => {
    expect(
      where(
        getStepCheckLinkTarget(
          TO_SECURITY_CONNECTIONS,
          onSecurityConnections(EDITS_ALL),
        ),
      ),
    ).toMatchObject({
      route: SECURITY_CONNECTIONS_PAGE,
      title: CHECK_ACCOUNT_CHANGES_OPEN_SECURITY_EVENT_CONNECTIONS,
    });
  });

  test("one who may not see Security Events > Connections gets nothing - whatever they may do on Cloud > Connect", () => {
    for (const access of [
      onSecurityConnections(NO_CONNECTIONS_ACCESS),
      onCloudConnect(EDITS_ALL),
    ]) {
      expect(getStepCheckLinkTarget(TO_SECURITY_CONNECTION, access)).toBeNull();
    }

    expect(getStepCheckLinkTarget(TO_SECURITY_CONNECTION)).toBeNull();
  });

  test("each page's link by its own access: Cloud > Connect's never by what the reader may do on Security Events'", () => {
    expect(
      getStepCheckLinkTarget(TO_CONNECTION, onSecurityConnections(EDITS_ALL)),
    ).toBeNull();
    expect(
      where(
        getStepCheckLinkTarget(TO_CONNECTION, {
          cloudConnections: SEES_ALL,
          securityEventConnections: EDITS_ALL,
        }),
      ),
    ).toMatchObject({
      route: CONNECT_PAGE,
      title: CHECK_ACCOUNT_CHANGES_OPEN_CLOUD_CONNECTIONS,
    });
  });
});
