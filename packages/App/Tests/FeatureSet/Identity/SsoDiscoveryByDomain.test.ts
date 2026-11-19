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
  StoredDomain,
  StoredProvider,
  readRaw,
  stubDiscoveryDatabase,
} from "./SsoDiscoveryDatabase";
import ProjectSsoDiscovery, {
  PROJECT_OIDC_DOMAINS_JOIN,
  PROJECT_SSO_DOMAINS_JOIN,
  ProviderDomainsJoin,
} from "../../../FeatureSet/Identity/Utils/ProjectSsoDiscovery";
import ProjectOIDC from "Common/Models/DatabaseModels/ProjectOidc";
import ProjectSSO from "Common/Models/DatabaseModels/ProjectSso";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import Email from "Common/Types/Email";
import BadDataException from "Common/Types/Exception/BadDataException";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import { getMetadataArgsStorage } from "typeorm";
import type { JoinTableMetadataArgs } from "typeorm/metadata-args/JoinTableMetadataArgs";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * "SIGN IN WITH SSO" FINDS A PROJECT'S PROVIDERS BY THE ADDRESS'S DOMAIN
 * (#9824).
 *
 * GET /service-provider-login (SAML) and /service-provider-login-oidc (OIDC)
 * answer, for an address, the providers that are on and list one of their
 * project's VERIFIED domains with exactly the address's domain
 * (Identity/Utils/ProjectSsoDiscovery). These run both routes against an
 * in-memory stand-in of the domains and providers (SsoDiscoveryDatabase),
 * which answers the reads the way Postgres would.
 *
 * Here: what is offered, and what is not - a domain nobody verified, an
 * unverified one, another domain (a parent or a subdomain included), a
 * provider that is off or lists no domain, a domain of the right name in
 * another project - and an address that is not one. Whether an answer says
 * anything about an account is SsoDiscoverySaysNothingOfAccounts.test.ts.
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

const ACME: string = "a0000000-0000-4000-8000-000000000001";
const GLOBEX: string = "a0000000-0000-4000-8000-000000000002";

const ACME_DOMAIN: string = "a0000000-0000-4000-8000-0000000000d1";
const ACME_SALES_DOMAIN: string = "a0000000-0000-4000-8000-0000000000d2";
const ACME_PENDING_DOMAIN: string = "a0000000-0000-4000-8000-0000000000d3";
// Globex has verified acme.com too: two organizations may both own it.
const GLOBEX_ACME_DOMAIN: string = "a0000000-0000-4000-8000-0000000000d4";

const OKTA: string = "a0000000-0000-4000-8000-0000000000e1";
const ENTRA: string = "a0000000-0000-4000-8000-0000000000e2";
const OFF: string = "a0000000-0000-4000-8000-0000000000e3";
const NO_DOMAINS: string = "a0000000-0000-4000-8000-0000000000e4";
const SALES: string = "a0000000-0000-4000-8000-0000000000e5";
const PENDING: string = "a0000000-0000-4000-8000-0000000000e6";
const GLOBEX_OWN: string = "a0000000-0000-4000-8000-0000000000e7";
const GLOBEX_BORROWING: string = "a0000000-0000-4000-8000-0000000000e8";

interface Answer {
  kind: "list" | "error";
  ids?: Array<string> | undefined;
  data?: Array<unknown> | undefined;
  count?: unknown;
  modelType?: unknown;
  error?: Error | undefined;
}

interface KindCase {
  kind: string;
  route: string;
  modelType: unknown;
  join: ProviderDomainsJoin;
  providers: (database: DiscoveryDatabase) => Array<StoredProvider>;
  reads: (reads: DiscoveryReads) => jest.SpyInstance;
}

const KINDS: Array<KindCase> = [
  {
    kind: "SAML",
    route: "/service-provider-login",
    modelType: ProjectSSO,
    join: PROJECT_SSO_DOMAINS_JOIN,
    providers: (database: DiscoveryDatabase): Array<StoredProvider> => {
      return database.saml;
    },
    reads: (reads: DiscoveryReads): jest.SpyInstance => {
      return reads.saml;
    },
  },
  {
    kind: "OIDC",
    route: "/service-provider-login-oidc",
    modelType: ProjectOIDC,
    join: PROJECT_OIDC_DOMAINS_JOIN,
    providers: (database: DiscoveryDatabase): Array<StoredProvider> => {
      return database.oidc;
    },
    reads: (reads: DiscoveryReads): jest.SpyInstance => {
      return reads.oidc;
    },
  },
];

const domain: (data: Partial<StoredDomain> & { id: string }) => StoredDomain = (
  data: Partial<StoredDomain> & { id: string },
): StoredDomain => {
  return {
    projectId: ACME,
    domain: "acme.com",
    isVerified: true,
    ...data,
  };
};

const provider: (
  data: Partial<StoredProvider> & { id: string },
) => StoredProvider = (
  data: Partial<StoredProvider> & { id: string },
): StoredProvider => {
  return {
    projectId: ACME,
    projectName: "Acme",
    name: "Okta",
    description: "Sign in with Okta",
    isEnabled: true,
    domainIds: [ACME_DOMAIN],
    ...data,
  };
};

/*
 * Acme verified acme.com and sales.acme.com, and has added acme.dev without
 * verifying it. Its providers: Okta and Entra ID serve acme.com, one serves
 * sales.acme.com, one the unverified acme.dev, one is off, one lists no
 * domain. Globex verified acme.com as well, with a provider of its own on
 * it - and one that lists Acme's acme.com row instead, which the project
 * check refuses to save, but which the lookup must not trust either.
 */
const freshDatabase: () => DiscoveryDatabase = (): DiscoveryDatabase => {
  const providers: Array<StoredProvider> = [
    provider({ id: OKTA }),
    provider({
      id: ENTRA,
      name: "Entra ID",
      description: "Use your Acme account",
    }),
    provider({ id: OFF, name: "Old Okta", isEnabled: false }),
    provider({ id: NO_DOMAINS, name: "Keycloak", domainIds: [] }),
    provider({
      id: SALES,
      name: "Sales Okta",
      domainIds: [ACME_SALES_DOMAIN],
    }),
    provider({
      id: PENDING,
      name: "Dev Okta",
      domainIds: [ACME_PENDING_DOMAIN],
    }),
    provider({
      id: GLOBEX_OWN,
      projectId: GLOBEX,
      projectName: "Globex",
      name: "Globex SSO",
      domainIds: [GLOBEX_ACME_DOMAIN],
    }),
    provider({
      id: GLOBEX_BORROWING,
      projectId: GLOBEX,
      projectName: "Globex",
      name: "Borrowed",
      domainIds: [ACME_DOMAIN],
    }),
  ];

  return {
    domains: [
      domain({ id: ACME_DOMAIN }),
      domain({ id: ACME_SALES_DOMAIN, domain: "sales.acme.com" }),
      domain({
        id: ACME_PENDING_DOMAIN,
        domain: "acme.dev",
        isVerified: false,
      }),
      domain({ id: GLOBEX_ACME_DOMAIN, projectId: GLOBEX }),
    ],
    saml: providers,
    oidc: providers.map((stored: StoredProvider): StoredProvider => {
      return { ...stored };
    }),
  };
};

let database: DiscoveryDatabase;
let reads: DiscoveryReads;
let sendEntityArrayResponse: jest.SpyInstance;
let sendErrorResponse: jest.SpyInstance;

const ask: (route: string, email: unknown) => Promise<Answer> = async (
  route: string,
  email: unknown,
): Promise<Answer> => {
  sendEntityArrayResponse.mockClear();
  sendErrorResponse.mockClear();

  const handler: RouteHandler = mockRouter.match("get", route);
  const req: ExpressRequest = buildRequest(undefined);
  (req as unknown as { query: Record<string, unknown> }).query =
    email === undefined ? {} : { email: email };
  const res: ExpressResponse = buildResponse();

  let passedOn: unknown = null;

  await handler(req, res, ((err?: unknown): void => {
    passedOn = err || null;
  }) as unknown as NextFunction);

  if (passedOn) {
    return { kind: "error", error: passedOn as Error };
  }

  if (sendEntityArrayResponse.mock.calls.length > 0) {
    const call: Array<unknown> = sendEntityArrayResponse.mock.calls[0]!;
    const data: Array<ProjectSSO | ProjectOIDC> = call[2] as Array<
      ProjectSSO | ProjectOIDC
    >;

    return {
      kind: "list",
      data: data,
      ids: data.map((row: ProjectSSO | ProjectOIDC): string => {
        return row._id?.toString() || "";
      }),
      count: call[3],
      modelType: call[4],
    };
  }

  expect(sendErrorResponse).toHaveBeenCalledTimes(1);

  return {
    kind: "error",
    error: sendErrorResponse.mock.calls[0]![2] as Error,
  };
};

beforeEach(() => {
  database = freshDatabase();
  reads = stubDiscoveryDatabase(database);

  sendEntityArrayResponse = jest
    .spyOn(Response, "sendEntityArrayResponse")
    .mockImplementation((() => {}) as never);
  sendErrorResponse = jest
    .spyOn(Response, "sendErrorResponse")
    .mockImplementation((() => {}) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(KINDS)("GET $route ($kind)", (kindCase: KindCase) => {
  const offered: (email: string) => Promise<Array<string>> = async (
    email: string,
  ): Promise<Array<string>> => {
    const answer: Answer = await ask(kindCase.route, email);

    expect(answer.kind).toBe("list");
    expect(answer.modelType).toBe(kindCase.modelType);
    expect(answer.count).toBe(answer.ids!.length);

    return answer.ids!;
  };

  describe("offers", () => {
    it("the providers that are on and list the address's verified domain", async () => {
      expect(await offered("grace@acme.com")).toEqual([
        OKTA,
        ENTRA,
        GLOBEX_OWN,
      ]);
    });

    it("each with what the page draws, and nothing more: its id, name, description, project and project name", async () => {
      const answer: Answer = await ask(kindCase.route, "grace@acme.com");
      const okta: ProjectSSO | ProjectOIDC = answer.data![0] as
        | ProjectSSO
        | ProjectOIDC;

      expect(okta).toBeInstanceOf(kindCase.modelType as typeof ProjectSSO);
      expect(okta._id).toBe(OKTA);
      expect(okta.name).toBe("Okta");
      expect(okta.description).toBe("Sign in with Okta");
      expect(okta.projectId?.toString()).toBe(ACME);
      expect(okta.project?.name).toBe("Acme");

      for (const call of kindCase.reads(reads).mock.calls) {
        expect(
          Object.keys(
            (call[0] as { select: Record<string, unknown> }).select,
          ).sort(),
        ).toEqual(["_id", "description", "name", "project", "projectId"]);
        expect(
          (call[0] as { select: { project: Record<string, unknown> } }).select
            .project,
        ).toEqual({ name: true });
      }
    });

    it("whatever case the address is typed in, with space around it", async () => {
      expect(await offered("  Grace@ACME.Com ")).toEqual([
        OKTA,
        ENTRA,
        GLOBEX_OWN,
      ]);
    });

    it("whatever case the domain was saved in", async () => {
      database.domains[0]!.domain = "Acme.COM";

      expect(await offered("grace@acme.com")).toEqual([
        OKTA,
        ENTRA,
        GLOBEX_OWN,
      ]);
    });

    it("by a subdomain verified as a domain of its own", async () => {
      expect(await offered("ada@sales.acme.com")).toEqual([SALES]);
    });

    it("by the domain after the address's last @, a quoted local part's own @ aside", async () => {
      expect(await offered('"ada@sales.acme.com"@acme.com')).toEqual([
        OKTA,
        ENTRA,
        GLOBEX_OWN,
      ]);
    });

    /*
     * Two projects may both prove they own a domain (a company with two
     * OneUptime projects): each one's providers are offered, the projects in
     * the order their domain was added, a project's providers oldest first.
     */
    it("every project's that verified the domain, in the order the domains were added", async () => {
      database.domains = [
        database.domains[3]!,
        ...database.domains.slice(0, 3),
      ];

      expect(await offered("grace@acme.com")).toEqual([
        GLOBEX_OWN,
        OKTA,
        ENTRA,
      ]);

      const domainRead: { sort: Record<string, unknown> } = reads.domains.mock
        .calls[0]![0] as {
        sort: Record<string, unknown>;
      };
      expect(domainRead.sort).toEqual({ createdAt: "ASC" });

      for (const call of kindCase.reads(reads).mock.calls) {
        expect((call[0] as { sort: Record<string, unknown> }).sort).toEqual({
          createdAt: "ASC",
        });
      }
    });
  });

  describe("offers nothing", () => {
    it.each([
      ["for a domain no project verified", "grace@initech.com"],
      ["for a domain a project added but has not verified", "grace@acme.dev"],
      ["for a subdomain of a verified domain", "grace@eu.acme.com"],
      [
        "for a domain that only starts like a verified one",
        "grace@acme.com.evil.io",
      ],
      ["for a domain that only ends like a verified one", "grace@notacme.com"],
      ["for another top-level domain", "grace@acme.co"],
    ])("%s", async (_name: string, email: string) => {
      expect(await offered(email)).toEqual([]);
    });

    it("for a provider of a subdomain, at its parent domain", async () => {
      expect(await offered("grace@acme.com")).not.toContain(SALES);
    });

    it("for a provider that is off", async () => {
      expect(await offered("grace@acme.com")).not.toContain(OFF);

      for (const call of kindCase.reads(reads).mock.calls) {
        expect(
          (call[0] as { query: { isEnabled: unknown } }).query.isEnabled,
        ).toBe(true);
      }
    });

    it("for a provider of the domain's project that lists no domain", async () => {
      expect(await offered("grace@acme.com")).not.toContain(NO_DOMAINS);
    });

    it("for a provider whose only domain is unverified, until it is verified", async () => {
      expect(await offered("grace@acme.dev")).toEqual([]);

      database.domains[2]!.isVerified = true;

      expect(await offered("grace@acme.dev")).toEqual([PENDING]);
    });

    /*
     * Globex's "Borrowed" lists Acme's acme.com row. The project check
     * refuses to save that (SsoProviderDomainsInProject); the lookup does
     * not trust it either: each project's providers are read with that
     * project's own domains.
     */
    it("for a provider that lists a domain of the right name in another project", async () => {
      expect(await offered("grace@acme.com")).not.toContain(GLOBEX_BORROWING);

      // Even with Globex's own acme.com gone.
      database.domains = database.domains.filter(
        (stored: StoredDomain): boolean => {
          return stored.id !== GLOBEX_ACME_DOMAIN;
        },
      );

      expect(await offered("grace@acme.com")).toEqual([OKTA, ENTRA]);
    });

    it("once its domain is deleted from the project", async () => {
      database.domains = database.domains.filter(
        (stored: StoredDomain): boolean => {
          return stored.projectId !== ACME;
        },
      );

      expect(await offered("grace@acme.com")).toEqual([GLOBEX_OWN]);
    });

    it("for an address on an address literal, with nothing read", async () => {
      expect(await offered("grace@[192.168.0.1]")).toEqual([]);
      expect(reads.domains).not.toHaveBeenCalled();
      expect(kindCase.reads(reads)).not.toHaveBeenCalled();
    });

    it("for a domain no project could add, with nothing read", async () => {
      // A top-level domain of digits: an address, but not a Domain.
      expect(await offered("grace@acme.123")).toEqual([]);
      expect(reads.domains).not.toHaveBeenCalled();
    });

    it("and reads no provider when no project verified the domain", async () => {
      expect(await offered("grace@initech.com")).toEqual([]);
      expect(reads.domains).toHaveBeenCalledTimes(1);
      expect(kindCase.reads(reads)).not.toHaveBeenCalled();
    });
  });

  describe("reads", () => {
    it("only verified domains, by their exact name, as OneUptime", async () => {
      await ask(kindCase.route, "grace@acme.com");

      expect(reads.domains).toHaveBeenCalledTimes(1);

      const read: {
        query: { domain: unknown; isVerified: unknown };
        props: unknown;
      } = reads.domains.mock.calls[0]![0] as {
        query: { domain: unknown; isVerified: unknown };
        props: unknown;
      };

      expect(read.query.isVerified).toBe(true);
      expect(read.props).toEqual({ isRoot: true });

      const name: { sql: string; parameters: Record<string, unknown> } =
        readRaw(read.query.domain);

      // An equality: no LIKE, no pattern, so no parent or subdomain matches.
      expect(name.sql).toMatch(/^\(LOWER\(alias\) = :\w+\)$/);
      expect(Object.values(name.parameters)).toEqual(["acme.com"]);
    });

    it("each project's providers in that project, through the provider's own domain list", async () => {
      await ask(kindCase.route, "grace@acme.com");

      const calls: Array<{
        query: { projectId: unknown; _id: unknown };
      }> = kindCase.reads(reads).mock.calls.map((call: Array<unknown>) => {
        return call[0] as { query: { projectId: unknown; _id: unknown } };
      });

      expect(
        calls.map((call: { query: { projectId: unknown } }): string => {
          return String(call.query.projectId);
        }),
      ).toEqual([ACME, GLOBEX]);

      const acmeList: { sql: string; parameters: Record<string, unknown> } =
        readRaw(calls[0]!.query._id);

      expect(acmeList.sql).toContain(
        `FROM "${kindCase.join.joinTableName}" WHERE "${kindCase.join.joinTableName}"."${kindCase.join.relationColumnName}"`,
      );
      expect(
        (Object.values(acmeList.parameters)[0] as Array<unknown>).map(String),
      ).toEqual([ACME_DOMAIN]);

      const globexList: { sql: string; parameters: Record<string, unknown> } =
        readRaw(calls[1]!.query._id);

      expect(
        (Object.values(globexList.parameters)[0] as Array<unknown>).map(String),
      ).toEqual([GLOBEX_ACME_DOMAIN]);
    });
  });

  describe("an address that is not one", () => {
    it("with no email: 400 Email is required, as before", async () => {
      const answer: Answer = await ask(kindCase.route, undefined);

      expect(answer.kind).toBe("error");
      expect(answer.error).toBeInstanceOf(BadRequestException);
      expect(answer.error?.message).toBe("Email is required");
      expect(reads.domains).not.toHaveBeenCalled();
    });

    it.each([
      ["text", "grace"],
      ["two addresses", "grace@acme.com,ada@acme.com"],
      ["a display name", "Grace <grace@acme.com>"],
      ["a list of values", ["grace@acme.com", "ada@acme.com"]],
    ])(
      "given %s: refused as not an email (400), as before, with nothing read",
      async (_name: string, email: unknown) => {
        const answer: Answer = await ask(kindCase.route, email);

        expect(answer.kind).toBe("error");
        expect(answer.error).toBeInstanceOf(BadDataException);
        expect(answer.error?.message).toMatch(/is not in valid format\.$/);
        expect(reads.domains).not.toHaveBeenCalled();
        expect(kindCase.reads(reads)).not.toHaveBeenCalled();
      },
    );
  });
});

describe("ProjectSsoDiscovery.getEmailDomain", () => {
  it.each([
    ["grace@acme.com", "acme.com"],
    ["Grace@ACME.COM", "acme.com"],
    ["grace@sales.eu.acme.com", "sales.eu.acme.com"],
    ['"a@b.com"@acme.com', "acme.com"],
    ["grace@[192.168.0.1]", null],
    ["grace@acme.123", null],
  ])("%s -> %s", (address: string, expected: string | null) => {
    expect(ProjectSsoDiscovery.getEmailDomain(new Email(address))).toBe(
      expected,
    );
  });
});

describe("the join tables the lookup reads", () => {
  it.each([
    [ProjectSSO, PROJECT_SSO_DOMAINS_JOIN],
    [ProjectOIDC, PROJECT_OIDC_DOMAINS_JOIN],
  ])(
    "are the model's own %p.domains",
    (modelType: unknown, join: ProviderDomainsJoin) => {
      const joinTable: JoinTableMetadataArgs | undefined =
        getMetadataArgsStorage().joinTables.find(
          (candidate: JoinTableMetadataArgs): boolean => {
            return (
              candidate.target === modelType &&
              candidate.propertyName === "domains"
            );
          },
        );

      expect(joinTable).toBeDefined();
      expect({
        joinTableName: joinTable!.name,
        ownerColumnName: joinTable!.joinColumns![0]!.name,
        relationColumnName: joinTable!.inverseJoinColumns![0]!.name,
      }).toEqual(join);
    },
  );
});
