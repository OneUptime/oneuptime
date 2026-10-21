import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  expectEverySsoProbeAnswered,
  IDENTITY_PREFIXES,
  IdentityServer,
  sendProbe,
  SSO_ROUTE_PROBES,
  SsoProbe,
  startIdentityServer,
  stubRenderedViews,
  stubSsoDatabaseReads,
  describeAnswer,
} from "./SsoRouteProbes";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import FakeEnterpriseModule, {
  createEditionStateCases,
  EditionStateCase,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";

/*
 * The core Identity feature set mounts, at "/api/identity" and "/":
 *
 *   1. the authentication and reseller routers,
 *   2. every single sign-on router (SAML and OIDC for projects, the whole
 *      instance and status pages) - in every edition,
 *   3. whatever identity routers the loaded Enterprise Edition module hands
 *      it (SCIM provisioning), and none on the Community Edition,
 *
 * and then the status page authentication router at its own prefixes.
 *
 * This suite never needs ee/ (core CI runs with it deleted): the Enterprise
 * side is FakeEnterpriseModule with small routers, and the authentication,
 * reseller and status page authentication routers are replaced by probes so
 * each one's position can be observed from outside. The SSO routers are the
 * real ones, answering SsoRouteProbes' database-free requests.
 *
 * Billing is pinned (CI's config.env sets BILLING_ENABLED=true) even though
 * mounting does not read it: the identity routes must be the same either way.
 */
jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

/*
 * Each core router answers a probe path with its own name. Some tests give an
 * Enterprise router the same path as a core one, so the order core mounts
 * them in decides who answers. The authentication and reseller probes that
 * share a pattern with an SSO route show those two come before the SSO
 * routers.
 */
jest.mock("../../../FeatureSet/Identity/API/Authentication", () => {
  const express: typeof import("Common/Server/Utils/Express") =
    jest.requireActual(
      "Common/Server/Utils/Express",
    ) as typeof import("Common/Server/Utils/Express");
  const router: ExpressRouter = express.default.getRouter();

  router.get("/probe/authentication", (_req: unknown, res: ExpressResponse) => {
    res.send("core:authentication");
  });

  // Also matches the project OIDC start route, /oidc/:projectId/:projectOidcId.
  router.get(
    "/oidc/authentication-order-probe/:id",
    (_req: unknown, res: ExpressResponse) => {
      res.send("core:authentication");
    },
  );

  return { __esModule: true, default: router };
});

jest.mock("../../../FeatureSet/Identity/API/Reseller", () => {
  const express: typeof import("Common/Server/Utils/Express") =
    jest.requireActual(
      "Common/Server/Utils/Express",
    ) as typeof import("Common/Server/Utils/Express");
  const router: ExpressRouter = express.default.getRouter();

  router.get("/probe/reseller", (_req: unknown, res: ExpressResponse) => {
    res.send("core:reseller");
  });

  router.get("/shadow-probe", (_req: unknown, res: ExpressResponse) => {
    res.send("core:reseller");
  });

  // Also matches the project SAML start route, /sso/:projectId/:projectSsoId.
  router.get(
    "/sso/reseller-order-probe/:id",
    (_req: unknown, res: ExpressResponse) => {
      res.send("core:reseller");
    },
  );

  return { __esModule: true, default: router };
});

jest.mock("../../../FeatureSet/Identity/API/StatusPageAuthentication", () => {
  const express: typeof import("Common/Server/Utils/Express") =
    jest.requireActual(
      "Common/Server/Utils/Express",
    ) as typeof import("Common/Server/Utils/Express");
  const router: ExpressRouter = express.default.getRouter();

  router.get("/probe", (_req: unknown, res: ExpressResponse) => {
    res.send("core:status-page-authentication");
  });

  return { __esModule: true, default: router };
});

const SCIM_ID: string = "33333333-3333-4333-8333-333333333333";
const SCIM_PATHS: Array<string> = [
  `/scim/v2/${SCIM_ID}/ServiceProviderConfig`,
  `/status-page-scim/v2/${SCIM_ID}/Users`,
];

let server: IdentityServer | null = null;

const makeEnterpriseRouter: (
  routes: Array<[path: string, answer: string]>,
  method?: "get" | "post",
) => ExpressRouter = (
  routes: Array<[path: string, answer: string]>,
  method: "get" | "post" = "get",
): ExpressRouter => {
  const router: ExpressRouter = Express.getRouter();

  for (const [path, answer] of routes) {
    router[method](path, (_req: ExpressRequest, res: ExpressResponse) => {
      res.send(answer);
    });
  }

  return router;
};

// What the Enterprise Edition hands core: its SCIM routers.
const makeScimRouters: () => Array<ExpressRouter> =
  (): Array<ExpressRouter> => {
    return [
      makeEnterpriseRouter([
        ["/scim/v2/:projectScimId/ServiceProviderConfig", "ee:scim"],
      ]),
      makeEnterpriseRouter([
        ["/status-page-scim/v2/:statusPageScimId/Users", "ee:status-page-scim"],
      ]),
    ];
  };

const startIdentity: () => Promise<void> = async (): Promise<void> => {
  server = await startIdentityServer();
};

const get: (path: string) => Promise<{ status: number; body: string }> = async (
  path: string,
): Promise<{ status: number; body: string }> => {
  const response: globalThis.Response = await fetch(
    `${server!.baseUrl}${path}`,
  );

  return { status: response.status, body: await response.text() };
};

// One request per SSO router: the first probe of each.
const ONE_PROBE_PER_ROUTER: Array<SsoProbe> = SSO_ROUTE_PROBES.filter(
  (probe: SsoProbe, index: number): boolean => {
    return (
      SSO_ROUTE_PROBES.findIndex((candidate: SsoProbe): boolean => {
        return candidate.router === probe.router;
      }) === index
    );
  },
);

const expectProbesAnswered: (probes: Array<SsoProbe>) => Promise<void> = async (
  probes: Array<SsoProbe>,
): Promise<void> => {
  for (const prefix of IDENTITY_PREFIXES) {
    for (const probe of probes) {
      expect({
        request: `${probe.method} ${prefix}${probe.path}`,
        answer: describeAnswer(await sendProbe(server!.baseUrl, prefix, probe)),
      }).toEqual({
        request: `${probe.method} ${prefix}${probe.path}`,
        answer: probe.expected,
      });
    }
  }
};

beforeAll(() => {
  // The SSO probes' 400s are logged as errors by Response.sendErrorResponse.
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "info").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });
});

beforeEach(() => {
  setTestBillingEnabled(false);
  uninstallEnterpriseModule();
  stubSsoDatabaseReads();
  stubRenderedViews();
});

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }

  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe("Identity feature set on the Community Edition", () => {
  test.each([false, true])(
    "serves every SAML and OIDC route at both prefixes, each with its own handler (billing=%s)",
    async (billing: boolean) => {
      setTestBillingEnabled(billing);
      await startIdentity();

      expect(EnterpriseEdition.isLoaded()).toBe(false);

      await expectEverySsoProbeAnswered(server!.baseUrl);
    },
  );

  test.each([false, true])(
    "serves no SCIM route (billing=%s)",
    async (billing: boolean) => {
      setTestBillingEnabled(billing);
      await startIdentity();

      for (const prefix of IDENTITY_PREFIXES) {
        for (const path of SCIM_PATHS) {
          expect({
            path: `${prefix}${path}`,
            ...(await get(`${prefix}${path}`)),
          }).toMatchObject({ path: `${prefix}${path}`, status: 404 });
        }
      }
    },
  );

  test("still serves the core identity routers at both prefixes", async () => {
    await startIdentity();

    for (const prefix of IDENTITY_PREFIXES) {
      expect(await get(`${prefix}/probe/authentication`)).toEqual({
        status: 200,
        body: "core:authentication",
      });
      expect(await get(`${prefix}/probe/reseller`)).toEqual({
        status: 200,
        body: "core:reseller",
      });
      expect(await get(`${prefix}/status-page/probe`)).toEqual({
        status: 200,
        body: "core:status-page-authentication",
      });
    }
  });

  test("mounts the SSO routers after the authentication and reseller routers", async () => {
    await startIdentity();

    for (const prefix of IDENTITY_PREFIXES) {
      expect(
        (await get(`${prefix}/oidc/authentication-order-probe/1`)).body,
      ).toBe("core:authentication");
      expect((await get(`${prefix}/sso/reseller-order-probe/1`)).body).toBe(
        "core:reseller",
      );
    }
  });
});

describe("Identity feature set with the Enterprise Edition loaded", () => {
  test.each([false, true])(
    "mounts every router the module hands over, at both prefixes, next to the SSO routers (billing=%s)",
    async (billing: boolean) => {
      setTestBillingEnabled(billing);
      installFakeEnterpriseModule({ identityRouters: makeScimRouters() });
      await startIdentity();

      for (const prefix of IDENTITY_PREFIXES) {
        expect(await get(`${prefix}${SCIM_PATHS[0]!}`)).toEqual({
          status: 200,
          body: "ee:scim",
        });
        expect(await get(`${prefix}${SCIM_PATHS[1]!}`)).toEqual({
          status: 200,
          body: "ee:status-page-scim",
        });
      }

      await expectEverySsoProbeAnswered(server!.baseUrl);
    },
  );

  test("mounts them after the core authentication and reseller routers", async () => {
    installFakeEnterpriseModule({
      identityRouters: [
        makeEnterpriseRouter([
          ["/probe/authentication", "ee:shadowed"],
          ["/shadow-probe", "ee:shadowed"],
        ]),
      ],
    });
    await startIdentity();

    for (const prefix of IDENTITY_PREFIXES) {
      expect((await get(`${prefix}/probe/authentication`)).body).toBe(
        "core:authentication",
      );
      expect((await get(`${prefix}/shadow-probe`)).body).toBe("core:reseller");
    }
  });

  test("mounts them after the core SSO routers: a module cannot take over a sign-in route", async () => {
    installFakeEnterpriseModule({
      identityRouters: [
        makeEnterpriseRouter(
          SSO_ROUTE_PROBES.filter((probe: SsoProbe): boolean => {
            return probe.method === "GET";
          }).map((probe: SsoProbe): [string, string] => {
            return [probe.route, "ee:shadowed"];
          }),
        ),
        makeEnterpriseRouter(
          SSO_ROUTE_PROBES.filter((probe: SsoProbe): boolean => {
            return probe.method === "POST";
          }).map((probe: SsoProbe): [string, string] => {
            return [probe.route, "ee:shadowed"];
          }),
          "post",
        ),
      ],
    });
    await startIdentity();

    // Every SSO request still gets the core handler's answer, never "ee:shadowed".
    await expectEverySsoProbeAnswered(server!.baseUrl);
  });

  test("mounts them before the status page authentication router", async () => {
    installFakeEnterpriseModule({
      identityRouters: [
        makeEnterpriseRouter([["/status-page/probe", "ee:first"]]),
      ],
    });
    await startIdentity();

    for (const prefix of IDENTITY_PREFIXES) {
      expect((await get(`${prefix}/status-page/probe`)).body).toBe("ee:first");
    }
  });

  test("keeps the module's router order", async () => {
    installFakeEnterpriseModule({
      identityRouters: [
        makeEnterpriseRouter([["/ordered", "ee:first"]]),
        makeEnterpriseRouter([["/ordered", "ee:second"]]),
      ],
    });
    await startIdentity();

    expect((await get("/ordered")).body).toBe("ee:first");
  });

  test("asks the module for its identity routers once per boot", async () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
      identityRouters: [makeEnterpriseRouter([["/once", "ee:once"]])],
    });
    jest.spyOn(fake, "getIdentityRouters");

    await startIdentity();

    expect(fake.getIdentityRouters).toHaveBeenCalledTimes(1);
    expect((await get("/api/identity/once")).body).toBe("ee:once");
  });

  test("a module with no identity routers leaves the core routes, single sign-on included", async () => {
    installFakeEnterpriseModule({ identityRouters: [] });
    await startIdentity();

    expect((await get("/probe/authentication")).body).toBe(
      "core:authentication",
    );

    for (const path of SCIM_PATHS) {
      expect((await get(path)).status).toBe(404);
    }

    await expectProbesAnswered(ONE_PROBE_PER_ROUTER);
  });
});

describe("the same identity routes in every edition, license and billing state", () => {
  test.each(
    createEditionStateCases().map(
      (state: EditionStateCase): [string, EditionStateCase] => {
        return [state.label, state];
      },
    ),
  )("%s", async (_label: string, state: EditionStateCase) => {
    const fake: FakeEnterpriseModule | null = state.apply();

    if (fake) {
      fake.identityRouters = makeScimRouters();
    }

    await startIdentity();

    // Single sign-on: the same answers everywhere.
    await expectProbesAnswered(ONE_PROBE_PER_ROUTER);

    // SCIM: only where the Enterprise Edition is loaded.
    for (const prefix of IDENTITY_PREFIXES) {
      expect((await get(`${prefix}${SCIM_PATHS[0]!}`)).status).toBe(
        state.isLoaded ? 200 : 404,
      );
    }

    // The other core identity routers, unchanged.
    expect((await get("/api/identity/probe/reseller")).body).toBe(
      "core:reseller",
    );
  });
});
