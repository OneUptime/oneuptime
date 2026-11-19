import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import ProjectOidcService from "Common/Server/Services/ProjectOidcService";
import ProjectSSOService from "Common/Server/Services/ProjectSsoService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserService from "Common/Server/Services/UserService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import ProjectOIDC from "Common/Models/DatabaseModels/ProjectOidc";
import ProjectSSO from "Common/Models/DatabaseModels/ProjectSso";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import ObjectID from "Common/Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * SINGLE SIGN-ON BY EMAIL: NO PROVIDERS IS ONE ANSWER (#9745).
 *
 * The sign-in page's "Sign in with SSO" asks GET /service-provider-login
 * (SAML) and /service-provider-login-oidc (OIDC) which providers sign an
 * address in, with no one signed in. Both answered 400 "No SSO config found
 * for this user" when no account had the address, or its account was in no
 * project, and 200 with an empty list when its projects had no SSO - so
 * anyone could ask which addresses have a OneUptime account. Every "nothing
 * to offer" is now the empty list, which the page and the mobile app have
 * always read as "no single sign-on for this address".
 *
 * Still told apart, and left for a follow-up: an address in a project with
 * SSO on, whose providers are the answer.
 * ---------------------------------------------------------------------------
 */

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

jest.mock("Common/Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      ...(actual["default"] as Record<string, unknown>),
      getRouter: (): MockIdentityRouter => {
        return mockRouter;
      },
    },
  };
});

// Importing the routers registers their handlers on the mock router above.
import "../../../FeatureSet/Identity/API/SSO";
import "../../../FeatureSet/Identity/API/OIDC";

const EMAIL: string = "grace@example.com";
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

interface Answer {
  kind: "list" | "error";
  data?: Array<unknown> | undefined;
  count?: unknown;
  modelType?: unknown;
  message?: string | undefined;
}

let sendEntityArrayResponse: jest.SpyInstance;
let sendErrorResponse: jest.SpyInstance;

const ask: (route: string) => Promise<Answer> = async (
  route: string,
): Promise<Answer> => {
  const handler: RouteHandler = mockRouter.match("get", route);
  const req: ExpressRequest = buildRequest(undefined);
  (req as unknown as { query: Record<string, string> }).query = {
    email: EMAIL,
  };
  const res: ExpressResponse = buildResponse();

  let passedOn: unknown = null;

  await handler(req, res, ((err?: unknown): void => {
    passedOn = err || null;
  }) as unknown as NextFunction);

  expect(passedOn).toBeNull();

  if (sendEntityArrayResponse.mock.calls.length > 0) {
    const call: Array<unknown> = sendEntityArrayResponse.mock.calls[0]!;

    return {
      kind: "list",
      data: call[2] as Array<unknown>,
      count: call[3],
      modelType: call[4],
    };
  }

  expect(sendErrorResponse).toHaveBeenCalledTimes(1);

  return {
    kind: "error",
    message: (sendErrorResponse.mock.calls[0]![2] as Error).message,
  };
};

const accountAtAddress: () => User = (): User => {
  const user: User = new User(USER_ID);
  user._id = USER_ID.toString();

  return user;
};

const membershipOf: (projectId: ObjectID) => TeamMember = (
  projectId: ObjectID,
): TeamMember => {
  const membership: TeamMember = new TeamMember();
  membership.projectId = projectId;

  return membership;
};

beforeEach(() => {
  sendEntityArrayResponse = jest
    .spyOn(Response, "sendEntityArrayResponse")
    .mockImplementation((() => {}) as never);
  sendErrorResponse = jest
    .spyOn(Response, "sendErrorResponse")
    .mockImplementation((() => {}) as never);

  jest.spyOn(UserService, "findOneBy").mockResolvedValue(null);
  jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([]);
  jest.spyOn(ProjectSSOService, "findBy").mockResolvedValue([]);
  jest.spyOn(ProjectOidcService, "findBy").mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each([
  ["SAML", "/service-provider-login", ProjectSSO],
  ["OIDC", "/service-provider-login-oidc", ProjectOIDC],
])(
  "GET %s discovery for an address",
  (_kind: string, route: string, modelType: unknown) => {
    const EMPTY: Answer = {
      kind: "list",
      data: [],
      count: 0,
      modelType: modelType,
    };

    it("with no account: the empty list, never a refusal (the regression)", async () => {
      expect(await ask(route)).toEqual(EMPTY);
      expect(sendErrorResponse).not.toHaveBeenCalled();
    });

    it("with an account in no project: the same empty list", async () => {
      jest
        .spyOn(UserService, "findOneBy")
        .mockResolvedValue(accountAtAddress());

      expect(await ask(route)).toEqual(EMPTY);
    });

    it("with an account whose projects have no single sign-on: the same empty list", async () => {
      jest
        .spyOn(UserService, "findOneBy")
        .mockResolvedValue(accountAtAddress());
      jest
        .spyOn(TeamMemberService, "findBy")
        .mockResolvedValue([membershipOf(PROJECT_ID)]);

      expect(await ask(route)).toEqual(EMPTY);
    });

    it("never says 'No SSO config found' or 'No OIDC config found' to anyone", async () => {
      await ask(route);

      for (const call of sendErrorResponse.mock.calls) {
        expect((call[2] as Error).message).not.toMatch(/config found/i);
      }
    });
  },
);

describe("an address in a project with single sign-on on", () => {
  it("is offered its providers, as before", async () => {
    const provider: ProjectSSO = new ProjectSSO();
    provider._id = ObjectID.generate().toString();
    provider.name = "Okta";
    provider.projectId = PROJECT_ID;

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(accountAtAddress());
    jest
      .spyOn(TeamMemberService, "findBy")
      .mockResolvedValue([membershipOf(PROJECT_ID)]);
    jest.spyOn(ProjectSSOService, "findBy").mockResolvedValue([provider]);

    const answer: Answer = await ask("/service-provider-login");

    expect(answer.kind).toBe("list");
    expect(answer.data).toEqual([provider]);
    expect(answer.count).toBe(1);
  });
});
