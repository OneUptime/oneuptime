import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * POST /security-trusted-proxies/automatic (#10546): what Security Events
 * trusts as a proxy without being told, for Trusted Proxies to show - the
 * edges the project connected and its own application load balancers.
 *
 * Any signed-in member of the project, and nobody else. The load balancers
 * are read as the caller reads: one who may not read cloud resources, or a
 * read that failed, is told none of them, only that they could not be
 * listed.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

jest.mock("../../../Server/Utils/Logger");

import CommonAPI from "../../../Server/API/CommonAPI";
import { readCheckedText } from "../../../Server/API/SecurityTrustedProxiesAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import logger from "../../../Server/Utils/Logger";
import SecurityLogLineCheckReader from "../../../Server/Utils/SecurityEvent/SecurityLogLineCheck";
import SecurityTrustedProxies from "../../../Server/Utils/SecurityEvent/SecurityTrustedProxies";
import BadDataException from "../../../Types/Exception/BadDataException";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import {
  MAX_CHECKED_TEXT_LENGTH,
  SECURITY_LOG_LINE_CHECK_PATH,
  readSecurityLogLineCheckResult,
} from "../../../Types/SecurityEvent/SecurityLogLineCheck";
import {
  NO_TRUSTED_PROXY_SOURCES,
  TrustedProxySource,
} from "../../../Utils/SecurityEvent/TrustedProxySources";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import SecurityEdgeRanges, {
  CLOUDFLARE_EDGE,
} from "../../../Server/Utils/SecurityBlocklist/SecurityEdgeRanges";
import SecurityOwnLoadBalancers from "../../../Server/Utils/SecurityEvent/SecurityOwnLoadBalancers";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import {
  AUTOMATIC_TRUSTED_PROXIES_PATH,
  readAutomaticTrustedProxies,
} from "../../../Types/SecurityEvent/AutomaticTrustedProxies";
import { OwnLoadBalancerKind } from "../../../Utils/SecurityEvent/OwnLoadBalancers";
import { getJestSpyOn } from "../../Spy";

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

const PROJECT: ObjectID = new ObjectID("10546000-0000-4000-8000-0000000000a1");
const MEMBER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT,
  userId: new ObjectID("10546000-0000-4000-8000-0000000000b1"),
};

const GATEWAY: {
  kind: OwnLoadBalancerKind;
  name: string;
  recordId: string;
  where: string;
  addresses: Array<string>;
} = {
  kind: OwnLoadBalancerKind.AzureApplicationGateway,
  name: "web-agw",
  recordId: "10546000-0000-4000-8000-0000000000c1",
  where: "Azure subscription",
  addresses: ["20.50.1.7"],
};

async function ask(): Promise<{ thrown: unknown; sent: unknown }> {
  let thrown: unknown = undefined;

  await (
    mockRouter.match("POST", AUTOMATIC_TRUSTED_PROXIES_PATH)
      .handlerFunction as RouterFunction
  )(
    { params: {}, query: {}, headers: {} } as unknown as ExpressRequest,
    {} as ExpressResponse,
    ((error: unknown) => {
      thrown = error;
    }) as NextFunction,
  );

  return {
    thrown,
    sent: (Response.sendJsonObjectResponse as unknown as jest.Mock).mock
      .calls[0]?.[2],
  };
}

let readLoadBalancers: ReturnType<typeof getJestSpyOn>;

beforeEach(() => {
  jest.restoreAllMocks();
  (Response.sendJsonObjectResponse as unknown as jest.Mock).mockClear();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(MEMBER as never);
  jest
    .spyOn(CommonAPI, "assertAuthenticatedProjectMember")
    .mockReturnValue(PROJECT as never);
  jest
    .spyOn(SecurityEdgeRanges, "findConnectedEdges")
    .mockResolvedValue([CLOUDFLARE_EDGE] as never);
  jest
    .spyOn(SecurityEdgeRanges, "getRanges")
    .mockResolvedValue(["173.245.48.0/20", "104.16.0.0/13"] as never);
  readLoadBalancers = getJestSpyOn(
    SecurityOwnLoadBalancers,
    "read",
  ).mockResolvedValue({ loadBalancers: [GATEWAY], isComplete: true });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /security-trusted-proxies/automatic", () => {
  test("is at its path, behind the signed-in member's middleware", () => {
    expect(AUTOMATIC_TRUSTED_PROXIES_PATH).toBe(
      "/security-trusted-proxies/automatic",
    );

    const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
      "POST",
      AUTOMATIC_TRUSTED_PROXIES_PATH,
    );

    expect(route.middlewares[0]).toBe(UserMiddleware.getUserMiddleware);
    expect(route.middlewares[1]).toBe(UserMiddleware.requireUserAuthentication);
    // And the gate that refuses it while Security Events is off on the server.
    expect(route.middlewares).toHaveLength(3);
  });

  test("a member is told the connected edges and the load balancers, read as they read", async () => {
    const { thrown, sent } = await ask();

    expect(thrown).toBeUndefined();
    expect(sent).toEqual({
      edges: [{ name: "Cloudflare", rangeCount: 2 }],
      loadBalancers: [
        {
          kind: OwnLoadBalancerKind.AzureApplicationGateway,
          name: "web-agw",
          where: "Azure subscription",
          addresses: ["20.50.1.7"],
        },
      ],
      areLoadBalancersRead: true,
      areLoadBalancersComplete: true,
    });
    expect(readLoadBalancers).toHaveBeenCalledWith({
      projectId: PROJECT,
      props: MEMBER,
    });
    expect(Response.setNoCacheHeaders).toHaveBeenCalled();
  });

  test("never names the cloud resource a load balancer was read from", async () => {
    const { sent } = await ask();

    expect(JSON.stringify(sent)).not.toContain(GATEWAY.recordId);
  });

  test("somebody who is not a member is refused before anything is read", async () => {
    jest
      .spyOn(CommonAPI, "assertAuthenticatedProjectMember")
      .mockImplementation(() => {
        throw new NotAuthorizedException("Not a member.");
      });

    const { thrown, sent } = await ask();

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect(sent).toBeUndefined();
    expect(readLoadBalancers).not.toHaveBeenCalled();
    expect(SecurityEdgeRanges.findConnectedEdges).not.toHaveBeenCalled();
  });

  test("a reader who may not read cloud resources is told none, only that they could not be listed", async () => {
    readLoadBalancers.mockRejectedValue(
      new NotAuthorizedException(
        "You do not have permission to read cloud resources.",
      ),
    );

    const { thrown, sent } = await ask();

    expect(thrown).toBeUndefined();
    expect(sent).toEqual({
      edges: [{ name: "Cloudflare", rangeCount: 2 }],
      loadBalancers: [],
      areLoadBalancersRead: false,
      areLoadBalancersComplete: true,
    });
  });

  test("a read that left some out says so", async () => {
    readLoadBalancers.mockResolvedValue({
      loadBalancers: [GATEWAY],
      isComplete: false,
    });

    const { sent } = await ask();

    expect(
      readAutomaticTrustedProxies(sent as never).areLoadBalancersComplete,
    ).toBe(false);
  });

  test("edges that cannot be read are none, and the rest is still answered", async () => {
    jest
      .spyOn(SecurityEdgeRanges, "findConnectedEdges")
      .mockRejectedValue(new Error("connection refused") as never);

    const { thrown, sent } = await ask();

    expect(thrown).toBeUndefined();
    expect(readAutomaticTrustedProxies(sent as never)).toEqual({
      edges: [],
      loadBalancers: [
        {
          kind: OwnLoadBalancerKind.AzureApplicationGateway,
          name: "web-agw",
          where: "Azure subscription",
          addresses: ["20.50.1.7"],
        },
      ],
      areLoadBalancersRead: true,
      areLoadBalancersComplete: true,
    });
  });

  test("a project with no edge and no load balancer is answered with none", async () => {
    jest
      .spyOn(SecurityEdgeRanges, "findConnectedEdges")
      .mockResolvedValue([] as never);
    readLoadBalancers.mockResolvedValue({
      loadBalancers: [],
      isComplete: true,
    });

    const { sent } = await ask();

    expect(sent).toEqual({
      edges: [],
      loadBalancers: [],
      areLoadBalancersRead: true,
      areLoadBalancersComplete: true,
    });
  });
});

/*
 * POST /security-log-lines/check (#11046): what pasted lines become, read
 * as the scans read the project's logs, with its trusted proxies. A
 * signed-in member who may read security events; the text is read, never
 * stored or logged.
 */
describe("POST /security-log-lines/check", () => {
  const LINE: string = `10.0.0.5 - - [10/Oct/2026:13:55:36 +0000] "GET /?id=1' OR '1'='1 HTTP/1.1" 200 512 "-" "curl/8.0" "198.51.100.7"`;

  function permissionRow(permission: Permission): UserPermission {
    return {
      _type: "UserPermission",
      permission,
      labelIds: [],
      isBlockPermission: false,
    };
  }

  // A member of the project holding `permissions`, as the server reads them.
  function memberWith(
    ...permissions: Array<Permission>
  ): DatabaseCommonInteractionProps {
    const tenantPermission: UserTenantAccessPermission = {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT,
      permissions: [Permission.ProjectUser, ...permissions].map(permissionRow),
    };

    return {
      ...MEMBER,
      userTenantAccessPermission: {
        [PROJECT.toString()]: tenantPermission,
      },
    } as DatabaseCommonInteractionProps;
  }

  async function checkAs(
    props: DatabaseCommonInteractionProps,
    body: unknown,
  ): Promise<{ thrown: unknown; sent: unknown }> {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(props as never);

    let thrown: unknown = undefined;

    await (
      mockRouter.match("POST", SECURITY_LOG_LINE_CHECK_PATH)
        .handlerFunction as RouterFunction
    )(
      { params: {}, query: {}, headers: {}, body } as unknown as ExpressRequest,
      {} as ExpressResponse,
      ((error: unknown) => {
        thrown = error;
      }) as NextFunction,
    );

    return {
      thrown,
      sent: (Response.sendJsonObjectResponse as unknown as jest.Mock).mock
        .calls[0]?.[2],
    };
  }

  let readSources: ReturnType<typeof getJestSpyOn>;

  beforeEach(() => {
    readSources = getJestSpyOn(
      SecurityTrustedProxies,
      "readSources",
    ).mockResolvedValue({
      sources: {
        ...NO_TRUSTED_PROXY_SOURCES,
        readsAccessLogForwardedFor: true,
      },
      isComplete: true,
    });
  });

  test("is at its path, behind the signed-in member's middleware and Security Events' switch", () => {
    expect(SECURITY_LOG_LINE_CHECK_PATH).toBe("/security-log-lines/check");

    const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
      "POST",
      SECURITY_LOG_LINE_CHECK_PATH,
    );

    expect(route.middlewares[0]).toBe(UserMiddleware.getUserMiddleware);
    expect(route.middlewares[1]).toBe(UserMiddleware.requireUserAuthentication);
    expect(route.middlewares).toHaveLength(3);
  });

  test.each([
    Permission.SecurityViewer,
    Permission.SecurityMember,
    Permission.SecurityAdmin,
    Permission.ReadSecurityEvent,
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
  ])(
    "%s, who may read security events, is told what the line becomes with the project's trust",
    async (permission: Permission) => {
      const { thrown, sent } = await checkAs(memberWith(permission), {
        text: LINE,
      });

      expect(thrown).toBeUndefined();
      expect(readSources).toHaveBeenCalledWith(PROJECT);

      const answer: ReturnType<typeof readSecurityLogLineCheckResult> =
        readSecurityLogLineCheckResult(sent as never);

      expect(answer.linesRead).toBe(1);
      expect(answer.events[0]!.principalIp).toBe("198.51.100.7");
      expect(answer.trustedProxies).toEqual([
        {
          address: "10.0.0.5",
          source: TrustedProxySource.Private,
          edgeName: "",
        },
      ]);
      expect(Response.setNoCacheHeaders).toHaveBeenCalled();
    },
  );

  test.each([
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.ReadProject,
    Permission.EditProject,
  ])(
    "%s, who may not read security events, is refused before anything is read",
    async (permission: Permission) => {
      const check: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
        SecurityLogLineCheckReader,
        "check",
      );

      const { thrown, sent } = await checkAs(memberWith(permission), {
        text: LINE,
      });

      expect(thrown).toBeInstanceOf(NotAuthorizedException);
      expect((thrown as Error).message).toBe(
        "Checking a log line takes a role that can read security events.",
      );
      expect(sent).toBeUndefined();
      expect(check).not.toHaveBeenCalled();
      expect(readSources).not.toHaveBeenCalled();
    },
  );

  test("somebody who is not a member is refused", async () => {
    jest
      .spyOn(CommonAPI, "assertAuthenticatedProjectMember")
      .mockImplementation(() => {
        throw new NotAuthorizedException("Not a member.");
      });

    const { thrown, sent } = await checkAs(
      memberWith(Permission.SecurityAdmin),
      { text: LINE },
    );

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect(sent).toBeUndefined();
    expect(readSources).not.toHaveBeenCalled();
  });

  test.each([
    ["no body", undefined],
    ["no text", {}],
    ["text that is not text", { text: 42 }],
    ["a list", ["a line"]],
  ])(
    "%s is a 400 that says what to send",
    async (_what: string, body: unknown) => {
      const { thrown, sent } = await checkAs(
        memberWith(Permission.SecurityAdmin),
        body,
      );

      expect(thrown).toBeInstanceOf(BadDataException);
      expect((thrown as Error).message).toBe(
        "Send the log lines to check as text, one line a line.",
      );
      expect(sent).toBeUndefined();
    },
  );

  test("reads no more of the text than a check reads", () => {
    expect(
      readCheckedText({ text: "x".repeat(MAX_CHECKED_TEXT_LENGTH + 10) }),
    ).toHaveLength(MAX_CHECKED_TEXT_LENGTH);
    expect(readCheckedText({ text: "" })).toBe("");
  });

  test("never logs the line it was sent", async () => {
    const said: Array<string> = [];

    for (const level of ["debug", "info", "warn", "error"]) {
      getJestSpyOn(logger, level).mockImplementation(
        (...args: Array<unknown>): void => {
          said.push(args.map(String).join(" "));
        },
      );
    }

    await checkAs(memberWith(Permission.SecurityAdmin), {
      text: `${LINE}\nsecret-token-in-a-log-line`,
    });

    expect(said.join("\n")).not.toContain("secret-token-in-a-log-line");
  });
});
