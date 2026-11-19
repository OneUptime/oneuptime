import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import {
  DiscoveryDatabase,
  DiscoveryReads,
  comparableRead,
  stubDiscoveryDatabase,
} from "./SsoDiscoveryDatabase";
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
 * SINGLE SIGN-ON BY EMAIL SAYS NOTHING OF ACCOUNTS (#9745, #9824).
 *
 * The sign-in page's "Sign in with SSO" asks GET /service-provider-login
 * (SAML) and /service-provider-login-oidc (OIDC) which providers sign an
 * address in, with no one signed in.
 *
 *   - #9745: both answered 400 "No SSO config found for this user" when no
 *     account had the address, or its account was in no project. Every
 *     "nothing to offer" became the empty list.
 *   - #9824: an address whose account was a member of, or invited to, a
 *     project with SSO on was still answered with that project's providers
 *     and its name - so anyone could learn that the address has an account,
 *     and which organizations it belongs to.
 *
 * Now the answer is read from the address's domain alone: the providers that
 * list a verified domain of their project with that name
 * (Common/Server/Utils/ProjectSsoDiscovery, SsoDiscoveryByDomain.test.ts). No
 * account, membership or invitation is read at all, so two addresses at one
 * domain get the same answer after the same reads, whoever has an account.
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

const ACME: string = "b0000000-0000-4000-8000-000000000001";
const ACME_DOMAIN: string = "b0000000-0000-4000-8000-0000000000d1";
const OKTA: string = "b0000000-0000-4000-8000-0000000000e1";

/*
 * The people at acme.com, and what each has on this server. None of it may
 * change the answer: the route reads no account to find out.
 */
interface Person {
  email: string;
  // Their account, or null for an address nobody signed up with.
  user: User | null;
  // Their memberships, accepted or not.
  memberships: Array<TeamMember>;
}

const account: (id: string) => User = (id: string): User => {
  const user: User = new User(new ObjectID(id));
  user._id = id;
  return user;
};

const membership: (accepted: boolean) => TeamMember = (
  accepted: boolean,
): TeamMember => {
  const member: TeamMember = new TeamMember();
  member.projectId = new ObjectID(ACME);
  member.hasAcceptedInvitation = accepted;
  return member;
};

const AT_ACME: Array<Person> = [
  {
    email: "grace@acme.com",
    user: account("b0000000-0000-4000-8000-0000000000a1"),
    memberships: [membership(true)],
  },
  {
    email: "ada@acme.com",
    user: account("b0000000-0000-4000-8000-0000000000a2"),
    // Invited, not yet accepted.
    memberships: [membership(false)],
  },
  {
    email: "carol@acme.com",
    user: account("b0000000-0000-4000-8000-0000000000a3"),
    // An account in no project.
    memberships: [],
  },
  {
    email: "nobody@acme.com",
    user: null,
    memberships: [],
  },
];

/*
 * People elsewhere: an Acme member signing in with a personal address, and
 * addresses on a domain nobody verified.
 */
const ELSEWHERE: Array<Person> = [
  {
    email: "grace.personal@gmail.com",
    user: account("b0000000-0000-4000-8000-0000000000b1"),
    memberships: [membership(true)],
  },
  {
    email: "invited@initech.com",
    user: account("b0000000-0000-4000-8000-0000000000b2"),
    memberships: [membership(false)],
  },
  {
    email: "nobody@initech.com",
    user: null,
    memberships: [],
  },
];

const EVERYONE: Array<Person> = [...AT_ACME, ...ELSEWHERE];

const freshDatabase: () => DiscoveryDatabase = (): DiscoveryDatabase => {
  const okta: DiscoveryDatabase["saml"][number] = {
    id: OKTA,
    projectId: ACME,
    projectName: "Acme",
    name: "Okta",
    description: "Sign in with Okta",
    isEnabled: true,
    domainIds: [ACME_DOMAIN],
  };

  return {
    domains: [
      {
        id: ACME_DOMAIN,
        projectId: ACME,
        domain: "acme.com",
        isVerified: true,
      },
    ],
    saml: [okta],
    oidc: [{ ...okta }],
  };
};

interface Answer {
  kind: "list" | "error";
  ids?: Array<string> | undefined;
  count?: unknown;
  modelType?: unknown;
  message?: string | undefined;
}

let reads: DiscoveryReads;
let accountReads: Array<jest.SpyInstance>;
let sendEntityArrayResponse: jest.SpyInstance;
let sendErrorResponse: jest.SpyInstance;

const ask: (route: string, email: string) => Promise<Answer> = async (
  route: string,
  email: string,
): Promise<Answer> => {
  sendEntityArrayResponse.mockClear();
  sendErrorResponse.mockClear();

  const handler: RouteHandler = mockRouter.match("get", route);
  const req: ExpressRequest = buildRequest(undefined);
  (req as unknown as { query: Record<string, string> }).query = {
    email: email,
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
      ids: (call[2] as Array<ProjectSSO | ProjectOIDC>).map(
        (row: ProjectSSO | ProjectOIDC): string => {
          return row._id?.toString() || "";
        },
      ),
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

// Every read the last asks made, written out to compare.
const readsMade: (kindReads: jest.SpyInstance) => Array<unknown> = (
  kindReads: jest.SpyInstance,
): Array<unknown> => {
  return [...reads.domains.mock.calls, ...kindReads.mock.calls].map(
    (call: Array<unknown>): unknown => {
      return comparableRead(call[0]);
    },
  );
};

const personFor: (query: unknown) => Person | undefined = (
  query: unknown,
): Person | undefined => {
  const email: string = String(
    (query as { email?: unknown } | undefined)?.email || "",
  );

  return EVERYONE.find((person: Person): boolean => {
    return person.email === email;
  });
};

beforeEach(() => {
  reads = stubDiscoveryDatabase(freshDatabase());

  sendEntityArrayResponse = jest
    .spyOn(Response, "sendEntityArrayResponse")
    .mockImplementation((() => {}) as never);
  sendErrorResponse = jest
    .spyOn(Response, "sendErrorResponse")
    .mockImplementation((() => {}) as never);

  /*
   * The accounts and memberships above, as the database holds them: a
   * route that read them would find them. None may be read.
   */
  accountReads = [
    jest.spyOn(UserService, "findOneBy").mockImplementation((async (findBy: {
      query: unknown;
    }) => {
      return personFor(findBy.query)?.user || null;
    }) as never),
    jest.spyOn(UserService, "findBy").mockResolvedValue([] as never),
    jest.spyOn(UserService, "findOneById").mockResolvedValue(null as never),
    jest.spyOn(UserService, "countBy").mockResolvedValue(0 as never),
    jest.spyOn(TeamMemberService, "findBy").mockImplementation((async (findBy: {
      query: { userId?: unknown };
    }) => {
      const person: Person | undefined = EVERYONE.find(
        (candidate: Person): boolean => {
          return (
            Boolean(candidate.user) &&
            String(candidate.user!.id) === String(findBy.query.userId)
          );
        },
      );
      return person?.memberships || [];
    }) as never),
    jest.spyOn(TeamMemberService, "findOneBy").mockResolvedValue(null as never),
    jest.spyOn(TeamMemberService, "countBy").mockResolvedValue(0 as never),
  ];
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each([
  ["SAML", "/service-provider-login", ProjectSSO, "saml"],
  ["OIDC", "/service-provider-login-oidc", ProjectOIDC, "oidc"],
])(
  "GET %s discovery for an address",
  (_kind: string, route: string, modelType: unknown, kindKey: string) => {
    const EMPTY: Answer = {
      kind: "list",
      ids: [],
      count: 0,
      modelType: modelType,
    };

    const OFFERED: Answer = {
      kind: "list",
      ids: [OKTA],
      count: 1,
      modelType: modelType,
    };

    const kindReads: () => jest.SpyInstance = (): jest.SpyInstance => {
      return kindKey === "saml" ? reads.saml : reads.oidc;
    };

    it("reads no account, membership or invitation, for anyone", async () => {
      for (const person of EVERYONE) {
        await ask(route, person.email);
      }

      for (const spy of accountReads) {
        expect(spy).not.toHaveBeenCalled();
      }
    });

    it.each(AT_ACME)(
      "$email, at a domain a provider lists, is offered it, whatever account it has",
      async (person: Person) => {
        expect(await ask(route, person.email)).toEqual(OFFERED);
      },
    );

    /*
     * The answer and the reads behind it are the domain's: the same for an
     * address with an account in the project, one only invited, one with an
     * account in no project, and one nobody signed up with.
     */
    it("addresses at one domain get the same answer after the same reads", async () => {
      const answers: Array<Answer> = [];
      const work: Array<Array<unknown>> = [];

      for (const person of AT_ACME) {
        reads.domains.mockClear();
        kindReads().mockClear();

        answers.push(await ask(route, person.email));
        work.push(readsMade(kindReads()));
      }

      for (let index: number = 1; index < AT_ACME.length; index++) {
        expect(answers[index]).toEqual(answers[0]);
        expect(work[index]).toEqual(work[0]);
      }

      // The reads name the domain, never the address.
      expect(JSON.stringify(work[0])).toContain("acme.com");
      for (const person of AT_ACME) {
        expect(JSON.stringify(work[0])).not.toContain(person.email);
      }
    });

    it("addresses at a domain nobody verified get the same empty answer after the same reads", async () => {
      const initech: Array<Person> = ELSEWHERE.filter(
        (person: Person): boolean => {
          return person.email.endsWith("@initech.com");
        },
      );
      const work: Array<Array<unknown>> = [];

      for (const person of initech) {
        reads.domains.mockClear();
        kindReads().mockClear();

        expect(await ask(route, person.email)).toEqual(EMPTY);
        work.push(readsMade(kindReads()));
      }

      expect(work[1]).toEqual(work[0]);
    });

    /*
     * The regression of #9824: Grace's personal address has an account in
     * Acme, which has SSO on. It was answered with Acme's providers and its
     * name; it is now answered as any gmail.com address is.
     */
    it("an account in a project with single sign-on, at another domain: the empty list, as for anyone", async () => {
      expect(await ask(route, "grace.personal@gmail.com")).toEqual(EMPTY);
      expect(await ask(route, "someone.else@gmail.com")).toEqual(EMPTY);
    });

    it.each(ELSEWHERE)(
      "$email, at a domain no provider lists: the empty list, never a refusal",
      async (person: Person) => {
        expect(await ask(route, person.email)).toEqual(EMPTY);
        expect(sendErrorResponse).not.toHaveBeenCalled();
      },
    );

    it("never says 'No SSO config found' or 'No OIDC config found' to anyone", async () => {
      for (const person of EVERYONE) {
        await ask(route, person.email);

        for (const call of sendErrorResponse.mock.calls) {
          expect((call[2] as Error).message).not.toMatch(/config found/i);
        }
      }
    });
  },
);
