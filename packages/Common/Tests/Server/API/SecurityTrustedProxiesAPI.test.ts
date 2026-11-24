import { mockRouter } from "./Helpers";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

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
import "../../../Server/API/SecurityTrustedProxiesAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
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

let readLoadBalancers: jest.SpiedFunction<typeof SecurityOwnLoadBalancers.read>;

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
  readLoadBalancers = jest
    .spyOn(SecurityOwnLoadBalancers, "read")
    .mockResolvedValue({ loadBalancers: [GATEWAY], isComplete: true });
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
      new NotAuthorizedException("You do not have permission to read cloud resources."),
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

    expect(readAutomaticTrustedProxies(sent as never).areLoadBalancersComplete).toBe(
      false,
    );
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
    readLoadBalancers.mockResolvedValue({ loadBalancers: [], isComplete: true });

    const { sent } = await ask();

    expect(sent).toEqual({
      edges: [],
      loadBalancers: [],
      areLoadBalancersRead: true,
      areLoadBalancersComplete: true,
    });
  });
});
