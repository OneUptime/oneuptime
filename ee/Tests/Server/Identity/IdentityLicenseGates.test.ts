import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  IDENTITY_ROUTERS,
  IdentityRouterEntry,
} from "../../../Server/Identity/Index";
import LicensedFeatureGate, {
  SCIM_UNAVAILABLE_MESSAGE,
} from "../../../Server/Identity/Middleware/LicensedFeatureGate";
import SCIMMiddleware from "../../../Server/Identity/Middleware/SCIMAuthorization";
import {
  SSO_ROUTERS,
  SsoRouterEntry,
} from "App/FeatureSet/Identity/SsoRouters";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature from "Common/Server/Enterprise/EnterpriseFeature";
import EditionEnforcement from "Common/Server/Utils/EditionEnforcement";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  RequestHandler,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import { JSONObject } from "Common/Types/JSON";
import FakeEnterpriseModule, {
  createEditionStateCases,
  createLicenseSnapshot,
  createLicenseSnapshotWithStatus,
  EditionStateCase,
  installFakeEnterpriseModule,
  installFakeEnterpriseModuleWithFeatures,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";

/*
 * Every enterprise identity route - SCIM provisioning, for projects and
 * status pages - answers only while SCIM is ACTIVE
 * (EnterpriseEdition.isFeatureActive). When a self-hosted license lapses,
 * SCIM stops - the Community Edition behaviour - and resumes on renewal,
 * with no restart.
 *
 * The routers are mounted once at boot and may not have router.use() layers
 * (ModuleShape.test.ts), so the check is a per-request gate that must be the
 * FIRST handler of every route, before the SCIM bearer-token check. This
 * suite:
 *
 *   1. enumerates every route the live identity routers register and requires
 *      the SCIM gate as its first handler - with a negative control proving
 *      the enumeration catches a route without it (missing, or not first);
 *   2. runs each route's gate with SCIM stopped and requires the SCIM error
 *      body (403), and with SCIM active requires it to hand on untouched;
 *   3. checks the gate agrees with core's EditionEnforcement (the SCIM Push
 *      Groups team locks) in every state;
 *   4. checks single sign-on stays out of it: SAML and OIDC are core, served
 *      in every edition (packages/App/FeatureSet/Identity/SsoRouters.ts), and
 *      no core SSO route carries a license gate, whatever ee has loaded.
 *
 * Billing and the edition are pinned in every test (CI's config.env sets
 * BILLING_ENABLED=true).
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

// Express 4 keeps these on each stack layer; its typings leave them out.
interface RouteLayer {
  route?:
    | {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ handle: RequestHandler }>;
      }
    | undefined;
}

interface IdentityRoute {
  router: string;
  method: string;
  path: string;
  handlers: Array<RequestHandler>;
}

const getLayers: (router: ExpressRouter) => Array<RouteLayer> = (
  router: ExpressRouter,
): Array<RouteLayer> => {
  return (router as unknown as { stack: Array<RouteLayer> }).stack;
};

const getRoutes: (
  name: string,
  router: ExpressRouter,
) => Array<IdentityRoute> = (
  name: string,
  router: ExpressRouter,
): Array<IdentityRoute> => {
  const routes: Array<IdentityRoute> = [];

  for (const layer of getLayers(router)) {
    if (!layer.route) {
      continue;
    }

    for (const method of Object.keys(layer.route.methods)) {
      routes.push({
        router: name,
        method: method.toUpperCase(),
        path: layer.route.path,
        handlers: layer.route.stack.map(
          (entry: { handle: RequestHandler }): RequestHandler => {
            return entry.handle;
          },
        ),
      });
    }
  }

  return routes;
};

const ALL_ROUTES: Array<IdentityRoute> = IDENTITY_ROUTERS.flatMap(
  (entry: IdentityRouterEntry): Array<IdentityRoute> => {
    return getRoutes(entry.name, entry.router);
  },
);

// Every route of the core single sign-on routers.
const CORE_SSO_ROUTES: Array<IdentityRoute> = SSO_ROUTERS.flatMap(
  (entry: SsoRouterEntry): Array<IdentityRoute> => {
    return getRoutes(entry.name, entry.router);
  },
);

const describeRoute: (route: IdentityRoute) => string = (
  route: IdentityRoute,
): string => {
  return `${route.router}: ${route.method} ${route.path}`;
};

/*
 * The enumeration check: every route whose first handler is not the SCIM
 * license gate. Empty means every route is gated.
 */
const findRoutesWithoutGate: (routes: Array<IdentityRoute>) => Array<string> = (
  routes: Array<IdentityRoute>,
): Array<string> => {
  return routes
    .filter((route: IdentityRoute): boolean => {
      return (
        LicensedFeatureGate.getGatedFeature(route.handlers[0]) !==
        EnterpriseFeature.SCIM
      );
    })
    .map(describeRoute);
};

/*
 * The coexistence check: every route with a license gate ANYWHERE in its
 * handler stack. Empty means nothing in front of (or behind) the route's own
 * handler asks the license.
 */
const findRoutesWithAnyGate: (routes: Array<IdentityRoute>) => Array<string> = (
  routes: Array<IdentityRoute>,
): Array<string> => {
  return routes
    .filter((route: IdentityRoute): boolean => {
      return route.handlers.some((handler: RequestHandler): boolean => {
        return (
          LicensedFeatureGate.getGatedFeature(handler) !== null ||
          handler === LicensedFeatureGate.forScim
        );
      });
    })
    .map(describeRoute);
};

/*
 * ---------------------------------------------------------------------------
 * A fake request and response, recording only what Express itself would do.
 * ---------------------------------------------------------------------------
 */

const PARAM_VALUE: string = "6570b1d3-e2f4-4a5c-8d7e-8f9012345678";

const buildRequest: (route: IdentityRoute) => ExpressRequest = (
  route: IdentityRoute,
): ExpressRequest => {
  const params: Record<string, string> = {};

  for (const match of route.path.matchAll(/:([A-Za-z]+)/g)) {
    params[match[1]!] = PARAM_VALUE;
  }

  return {
    method: route.method,
    path: route.path,
    params,
    query: {},
    body: {},
    cookies: {},
    headers: {},
  } as unknown as ExpressRequest;
};

interface RecordedResponse {
  status: number;
  body: unknown;
  hasResponded: boolean;
}

interface FakeResponse {
  recorded: RecordedResponse;
  express: ExpressResponse;
}

const buildResponse: () => FakeResponse = (): FakeResponse => {
  const recorded: RecordedResponse = {
    status: 200,
    body: undefined,
    hasResponded: false,
  };

  const response: Record<string, unknown> = {};

  response["status"] = (code: number): unknown => {
    recorded.status = code;
    return response;
  };
  response["send"] = (body: unknown): unknown => {
    recorded.body = body;
    recorded.hasResponded = true;
    return response;
  };
  response["json"] = (body: unknown): unknown => {
    recorded.body = body;
    recorded.hasResponded = true;
    return response;
  };

  return { recorded, express: response as unknown as ExpressResponse };
};

interface GateOutcome {
  // True when the gate handed the request on to the route's next handler.
  handedOn: boolean;
  nextError: unknown;
  response: RecordedResponse;
}

// Runs a route's FIRST handler only - the gate. The real handler never runs.
const runFirstHandler: (route: IdentityRoute) => Promise<GateOutcome> = async (
  route: IdentityRoute,
): Promise<GateOutcome> => {
  const fakeResponse: FakeResponse = buildResponse();
  let handedOn: boolean = false;
  let nextError: unknown = undefined;

  const next: NextFunction = ((err?: unknown): void => {
    handedOn = true;
    nextError = err;
  }) as NextFunction;

  // A gate is synchronous; Promise.resolve also settles an async handler.
  const returned: unknown = route.handlers[0]!(
    buildRequest(route),
    fakeResponse.express,
    next,
  );
  await Promise.resolve(returned);

  return { handedOn, nextError, response: fakeResponse.recorded };
};

const SCIM_ERROR_BODY: JSONObject = {
  schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
  status: "403",
  detail: SCIM_UNAVAILABLE_MESSAGE,
};

const findRoute: (
  router: string,
  method: string,
  path: string,
) => IdentityRoute = (
  router: string,
  method: string,
  path: string,
): IdentityRoute => {
  const route: IdentityRoute | undefined = ALL_ROUTES.find(
    (candidate: IdentityRoute): boolean => {
      return (
        candidate.router === router &&
        candidate.method === method &&
        candidate.path === path
      );
    },
  );

  expect(route).toBeDefined();

  return route!;
};

// A license that covers everything except `feature`.
const installLicenseWithout: (feature: EnterpriseFeature) => void = (
  feature: EnterpriseFeature,
): void => {
  installFakeEnterpriseModule({
    snapshot: createLicenseSnapshot({
      features: [
        EnterpriseFeature.SCIM,
        EnterpriseFeature.AuditLogs,
        EnterpriseFeature.TeamCompliance,
        EnterpriseFeature.InstanceHealth,
      ].filter((candidate: EnterpriseFeature): boolean => {
        return candidate !== feature;
      }),
    }),
  });
};

beforeEach(() => {
  setTestBillingEnabled(false);
  uninstallEnterpriseModule();
  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "info").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("every SCIM route starts with the SCIM license gate, then the bearer check", () => {
  test("the enumeration sees all 26 routes of the two SCIM routers", () => {
    expect(
      IDENTITY_ROUTERS.map((entry: IdentityRouterEntry): string => {
        return entry.name;
      }),
    ).toEqual(["SCIM", "StatusPageSCIM"]);
    expect(ALL_ROUTES).toHaveLength(26);
    expect(
      ALL_ROUTES.filter((route: IdentityRoute): boolean => {
        return route.router === "SCIM";
      }),
    ).toHaveLength(16);
    expect(
      ALL_ROUTES.filter((route: IdentityRoute): boolean => {
        return route.router === "StatusPageSCIM";
      }),
    ).toHaveLength(10);
  });

  test("no route is missing its gate", () => {
    expect(findRoutesWithoutGate(ALL_ROUTES)).toEqual([]);
  });

  test.each(ALL_ROUTES.map(describeRoute))("%s", (label: string) => {
    const route: IdentityRoute = ALL_ROUTES.find(
      (candidate: IdentityRoute): boolean => {
        return describeRoute(candidate) === label;
      },
    )!;

    // The gate, the bearer check, then at least the route's own handler.
    expect(route.handlers.length).toBeGreaterThanOrEqual(3);
    expect(LicensedFeatureGate.getGatedFeature(route.handlers[0])).toBe(
      EnterpriseFeature.SCIM,
    );

    // The license gate runs before the bearer-token check, so a lapsed license answers first.
    expect(route.handlers[0]).toBe(LicensedFeatureGate.forScim);
    expect(route.handlers[1]).toBe(SCIMMiddleware.isAuthorizedSCIMRequest);

    // Only the first handler is a gate: the route's own handlers are not.
    for (const handler of route.handlers.slice(1)) {
      expect(LicensedFeatureGate.getGatedFeature(handler)).toBeNull();
    }
  });

  describe("negative control: the enumeration catches a route without its gate", () => {
    const handler: RequestHandler = (
      _req: ExpressRequest,
      res: ExpressResponse,
    ): void => {
      res.send("the real handler ran");
    };

    const buildControlRouter: () => ExpressRouter = (): ExpressRouter => {
      const router: ExpressRouter = Express.getRouter();

      router.get("/gated", LicensedFeatureGate.forScim, handler);
      router.get("/ungated", handler);
      router.post("/gate-not-first", handler, LicensedFeatureGate.forScim);

      return router;
    };

    test("statically: every ungated or late-gated route is reported", () => {
      expect(
        findRoutesWithoutGate(getRoutes("Control", buildControlRouter())),
      ).toEqual(["Control: GET /ungated", "Control: POST /gate-not-first"]);
    });

    test("behaviourally: with SCIM stopped, the ungated route reaches its handler while the gated one refuses", async () => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("expired"),
      });

      const routes: Array<IdentityRoute> = getRoutes(
        "Control",
        buildControlRouter(),
      );

      const gated: GateOutcome = await runFirstHandler(routes[0]!);
      const ungated: GateOutcome = await runFirstHandler(routes[1]!);

      expect(gated.handedOn).toBe(false);
      expect(gated.response.status).toBe(403);
      expect(ungated.response.body).toBe("the real handler ran");
      expect(ungated.response.status).toBe(200);
    });

    test("a plain function is not mistaken for a gate", () => {
      expect(LicensedFeatureGate.getGatedFeature(handler)).toBeNull();
      expect(LicensedFeatureGate.getGatedFeature(undefined)).toBeNull();
      expect(LicensedFeatureGate.getGatedFeature("forScim")).toBeNull();
      expect(
        LicensedFeatureGate.getGatedFeature(
          SCIMMiddleware.isAuthorizedSCIMRequest,
        ),
      ).toBeNull();
    });
  });
});

describe("with SCIM stopped, every SCIM route refuses with a SCIM error body", () => {
  test.each(ALL_ROUTES.map(describeRoute))(
    "%s (license expired past grace)",
    async (label: string) => {
      const route: IdentityRoute = ALL_ROUTES.find(
        (candidate: IdentityRoute): boolean => {
          return describeRoute(candidate) === label;
        },
      )!;

      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("expired"),
      });

      const outcome: GateOutcome = await runFirstHandler(route);

      expect(outcome.handedOn).toBe(false);
      expect(outcome.response.hasResponded).toBe(true);
      expect(outcome.response.status).toBe(403);
      expect(outcome.response.body).toEqual(SCIM_ERROR_BODY);
    },
  );

  test("the message names the lapsed license and says nothing was changed", () => {
    expect(SCIM_UNAVAILABLE_MESSAGE).toContain(
      "SCIM provisioning is unavailable because this OneUptime installation's Enterprise license has lapsed",
    );
    expect(SCIM_UNAVAILABLE_MESSAGE).toContain("Nothing was changed.");
    expect(SCIM_UNAVAILABLE_MESSAGE).toContain("renews the license");
  });

  test("a license without SCIM stops every SCIM route", async () => {
    installLicenseWithout(EnterpriseFeature.SCIM);

    for (const route of ALL_ROUTES) {
      const outcome: GateOutcome = await runFirstHandler(route);

      expect({
        route: describeRoute(route),
        handedOn: outcome.handedOn,
        status: outcome.response.status,
      }).toEqual({ route: describeRoute(route), handedOn: false, status: 403 });
    }
  });

  test("a license with SCIM alone serves every SCIM route (the other features do not matter)", async () => {
    installFakeEnterpriseModuleWithFeatures([EnterpriseFeature.SCIM]);

    for (const route of ALL_ROUTES) {
      expect({
        route: describeRoute(route),
        handedOn: (await runFirstHandler(route)).handedOn,
      }).toEqual({ route: describeRoute(route), handedOn: true });
    }
  });

  test("a license without audit logs still serves SCIM (each feature is gated on its own)", async () => {
    installLicenseWithout(EnterpriseFeature.AuditLogs);

    for (const route of ALL_ROUTES) {
      expect((await runFirstHandler(route)).handedOn).toBe(true);
    }
  });
});

describe("with SCIM active, every gate hands the request on untouched", () => {
  const activeStates: Array<EditionStateCase> =
    createEditionStateCases().filter((state: EditionStateCase): boolean => {
      return state.isActive;
    });

  test("the active states include the trial, grace, legacy and unknown license states", () => {
    expect(activeStates.length).toBeGreaterThanOrEqual(10);
  });

  test.each(
    activeStates.map((state: EditionStateCase): [string, EditionStateCase] => {
      return [state.label, state];
    }),
  )("%s", async (_label: string, state: EditionStateCase) => {
    state.apply();

    for (const route of ALL_ROUTES) {
      const outcome: GateOutcome = await runFirstHandler(route);

      expect({
        route: describeRoute(route),
        handedOn: outcome.handedOn,
        nextError: outcome.nextError,
        hasResponded: outcome.response.hasResponded,
      }).toEqual({
        route: describeRoute(route),
        handedOn: true,
        nextError: undefined,
        hasResponded: false,
      });
    }
  });

  test("an error while deciding lets the request through (never refuses because the license could not be read)", async () => {
    installFakeEnterpriseModule();
    const error: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {
        return undefined;
      });
    jest.spyOn(EnterpriseEdition, "isFeatureActive").mockImplementation(() => {
      throw new Error("facade exploded");
    });

    for (const route of ALL_ROUTES) {
      expect((await runFirstHandler(route)).handedOn).toBe(true);
    }

    expect(error).toHaveBeenCalled();
  });
});

describe("the gate agrees with core's EditionEnforcement in every state", () => {
  test.each(
    createEditionStateCases().map(
      (state: EditionStateCase): [string, EditionStateCase] => {
        return [state.label, state];
      },
    ),
  )("%s", async (_label: string, state: EditionStateCase) => {
    state.apply();

    for (const route of ALL_ROUTES) {
      const outcome: GateOutcome = await runFirstHandler(route);

      // SCIM answers exactly when core applies the Push Groups team locks.
      expect({
        route: describeRoute(route),
        handedOn: outcome.handedOn,
      }).toEqual({
        route: describeRoute(route),
        handedOn: EditionEnforcement.areScimTeamLocksEnforced(),
      });
    }

    expect(EditionEnforcement.areScimTeamLocksEnforced()).toBe(state.isActive);
  });
});

describe("a license change applies to the next request, with the same mounted routers", () => {
  test("lapse refuses, renewal serves again, a new lapse refuses again", async () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("valid"),
    });
    const samples: Array<IdentityRoute> = [
      findRoute("SCIM", "GET", "/scim/v2/:projectScimId/Users"),
      findRoute("SCIM", "PATCH", "/scim/v2/:projectScimId/Groups/:groupId"),
      findRoute(
        "StatusPageSCIM",
        "POST",
        "/status-page-scim/v2/:statusPageScimId/Users",
      ),
      findRoute(
        "StatusPageSCIM",
        "GET",
        "/status-page-scim/v2/:statusPageScimId/ServiceProviderConfig",
      ),
    ];

    const handedOn: () => Promise<Array<boolean>> = async (): Promise<
      Array<boolean>
    > => {
      const results: Array<boolean> = [];

      for (const route of samples) {
        results.push((await runFirstHandler(route)).handedOn);
      }

      return results;
    };

    expect(await handedOn()).toEqual([true, true, true, true]);

    fake.setSnapshot(createLicenseSnapshotWithStatus("missing"));
    expect(await handedOn()).toEqual([false, false, false, false]);

    fake.setSnapshot(createLicenseSnapshotWithStatus("grace"));
    expect(await handedOn()).toEqual([true, true, true, true]);

    fake.setSnapshot(createLicenseSnapshotWithStatus("invalid"));
    expect(await handedOn()).toEqual([false, false, false, false]);
  });
});

describe("single sign-on is core and never license-gated, with the Enterprise Edition loaded", () => {
  test("the core SSO routers are all there: 20 routes across 7 routers", () => {
    expect(SSO_ROUTERS).toHaveLength(7);
    expect(CORE_SSO_ROUTES).toHaveLength(20);
  });

  test("no core SSO route has a license gate anywhere in its handler stack", () => {
    expect(findRoutesWithAnyGate(CORE_SSO_ROUTES)).toEqual([]);
  });

  test.each(CORE_SSO_ROUTES.map(describeRoute))(
    "%s is its own handler alone",
    (label: string) => {
      const route: IdentityRoute = CORE_SSO_ROUTES.find(
        (candidate: IdentityRoute): boolean => {
          return describeRoute(candidate) === label;
        },
      )!;

      expect(route.handlers).toHaveLength(1);
      expect(LicensedFeatureGate.getGatedFeature(route.handlers[0])).toBeNull();
    },
  );

  test("negative control: the coexistence check reports an SSO route that carries a gate", () => {
    const handler: RequestHandler = (
      _req: ExpressRequest,
      res: ExpressResponse,
    ): void => {
      res.send("sso");
    };
    const router: ExpressRouter = Express.getRouter();

    router.get("/sso/:projectId/:projectSsoId", handler);
    router.get(
      "/global-sso/:globalSsoId",
      LicensedFeatureGate.forScim,
      handler,
    );
    router.post("/idp-login/:projectId/:projectSsoId", handler);
    router.post(
      "/global-idp-login/:globalSsoId",
      handler,
      LicensedFeatureGate.forScim,
    );

    expect(findRoutesWithAnyGate(getRoutes("Control", router))).toEqual([
      "Control: GET /global-sso/:globalSsoId",
      "Control: POST /global-idp-login/:globalSsoId",
    ]);
  });

  test("the ee identity routers are SCIM only: none serves a path a core SSO router serves", () => {
    const corePaths: Set<string> = new Set(
      CORE_SSO_ROUTES.map((route: IdentityRoute): string => {
        return `${route.method} ${route.path}`;
      }),
    );

    for (const route of ALL_ROUTES) {
      expect(corePaths.has(`${route.method} ${route.path}`)).toBe(false);
      expect(
        route.path.startsWith("/scim/v2/") ||
          route.path.startsWith("/status-page-scim/v2/"),
      ).toBe(true);
    }
  });

  test.each(
    createEditionStateCases().map(
      (state: EditionStateCase): [string, EditionStateCase] => {
        return [state.label, state];
      },
    ),
  )(
    "%s: the core SSO routes stay ungated while the SCIM gate follows the license",
    async (_label: string, state: EditionStateCase) => {
      state.apply();

      expect(findRoutesWithAnyGate(CORE_SSO_ROUTES)).toEqual([]);

      for (const route of ALL_ROUTES) {
        expect((await runFirstHandler(route)).handedOn).toBe(state.isActive);
      }
    },
  );
});
