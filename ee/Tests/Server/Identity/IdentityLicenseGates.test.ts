import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  IDENTITY_ROUTERS,
  IdentityRouterEntry,
} from "../../../Server/Identity/Index";
import LicensedFeatureGate, {
  MESSAGE_VIEW,
  MOBILE_SSO_UNAVAILABLE_ERROR,
  SCIM_UNAVAILABLE_MESSAGE,
  SSO_UNAVAILABLE_MESSAGE,
  SSO_UNAVAILABLE_TITLE,
} from "../../../Server/Identity/Middleware/LicensedFeatureGate";
import SCIMMiddleware from "../../../Server/Identity/Middleware/SCIMAuthorization";
import {
  MOBILE_SSO_CALLBACK_URL,
  getMobileSsoIntentCookieName,
} from "../../../Server/Identity/Utils/MobileSso";
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
import JSONWebToken from "Common/Server/Utils/JsonWebToken";
import logger from "Common/Server/Utils/Logger";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import FakeEnterpriseModule, {
  createEditionStateCases,
  createLicenseSnapshot,
  createLicenseSnapshotWithStatus,
  EditionStateCase,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";

/*
 * Every enterprise identity route answers only while its feature is ACTIVE
 * (EnterpriseEdition.isFeatureActive): SSO for the SAML/OIDC routers (project,
 * instance-wide and status page, including the mobile flows), SCIM for the two
 * SCIM routers. When a self-hosted license lapses, SSO and SCIM stop - the
 * Community Edition behaviour - and resume on renewal, with no restart.
 *
 * The routers are mounted once at boot and may not have router.use() layers
 * (ModuleShape.test.ts), so the check is a per-request gate that must be the
 * FIRST handler of every route. This suite:
 *
 *   1. enumerates every route the live identity routers register and requires
 *      the gate for the right feature as its first handler - with a negative
 *      control proving the enumeration catches a route without it (missing,
 *      wrong feature, or not first);
 *   2. runs each route's gate with the feature stopped and requires the
 *      refusal its route family answers with (message page, 402 JSON, SCIM
 *      error), and with the feature active requires it to hand on untouched;
 *   3. checks the mobile flows end on the app's failure deep link;
 *   4. checks the gates agree with core's EditionEnforcement in every state,
 *      which is the other half of "SSO is enforced iff SSO is served"
 *      (packages/App/Tests/FeatureSet/Identity/SsoEnforcementRoutesInvariant).
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

type GateFamily = "sso-json" | "sso-page" | "scim";

const SCIM_ROUTER_NAMES: ReadonlyArray<string> = ["SCIM", "StatusPageSCIM"];

const STATUS_PAGE_ROUTER_NAMES: ReadonlyArray<string> = [
  "StatusPageSSO",
  "StatusPageOIDC",
];

// The JSON discovery routes sign-in pages call; every other SSO route is a browser flow.
const SSO_JSON_PATHS: ReadonlyArray<string> = [
  "/service-provider-login",
  "/service-provider-login-oidc",
  "/global-sso/service-provider-login",
  "/global-oidc/service-provider-login",
];

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

const featureOf: (routerName: string) => EnterpriseFeature = (
  routerName: string,
): EnterpriseFeature => {
  return SCIM_ROUTER_NAMES.includes(routerName)
    ? EnterpriseFeature.SCIM
    : EnterpriseFeature.SSO;
};

const familyOf: (route: IdentityRoute) => GateFamily = (
  route: IdentityRoute,
): GateFamily => {
  if (SCIM_ROUTER_NAMES.includes(route.router)) {
    return "scim";
  }

  return SSO_JSON_PATHS.includes(route.path) ? "sso-json" : "sso-page";
};

const describeRoute: (route: IdentityRoute) => string = (
  route: IdentityRoute,
): string => {
  return `${route.router}: ${route.method} ${route.path}`;
};

/*
 * The enumeration check: every route whose first handler is not the license
 * gate for `feature`. Empty means every route is gated.
 */
const findRoutesWithoutGate: (
  routes: Array<IdentityRoute>,
  expectedFeature: (route: IdentityRoute) => EnterpriseFeature,
) => Array<string> = (
  routes: Array<IdentityRoute>,
  expectedFeature: (route: IdentityRoute) => EnterpriseFeature,
): Array<string> => {
  return routes
    .filter((route: IdentityRoute): boolean => {
      return (
        LicensedFeatureGate.getGatedFeature(route.handlers[0]) !==
        expectedFeature(route)
      );
    })
    .map(describeRoute);
};

/*
 * ---------------------------------------------------------------------------
 * A fake request and response, recording only what Express itself would do.
 * ---------------------------------------------------------------------------
 */

const PARAM_VALUE: string = "6570b1d3-e2f4-4a5c-8d7e-8f9012345678";

interface FakeRequestData {
  query?: Record<string, string> | undefined;
  body?: JSONObject | undefined;
  cookies?: Record<string, string> | undefined;
}

const buildRequest: (
  route: IdentityRoute,
  data?: FakeRequestData,
) => ExpressRequest = (
  route: IdentityRoute,
  data?: FakeRequestData,
): ExpressRequest => {
  const params: Record<string, string> = {};

  for (const match of route.path.matchAll(/:([A-Za-z]+)/g)) {
    params[match[1]!] = PARAM_VALUE;
  }

  return {
    method: route.method,
    path: route.path,
    params,
    query: data?.query || {},
    body: data?.body || {},
    cookies: data?.cookies || {},
    headers: {},
  } as unknown as ExpressRequest;
};

interface RecordedResponse {
  status: number;
  body: unknown;
  redirectedTo: string | null;
  rendered: { view: string; vars: JSONObject } | null;
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
    redirectedTo: null,
    rendered: null,
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
  response["redirect"] = (url: string): void => {
    recorded.redirectedTo = url;
    recorded.hasResponded = true;
  };
  response["render"] = (view: string, vars: JSONObject): void => {
    recorded.rendered = { view, vars };
    recorded.hasResponded = true;
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
const runFirstHandler: (
  route: IdentityRoute,
  data?: FakeRequestData,
) => Promise<GateOutcome> = async (
  route: IdentityRoute,
  data?: FakeRequestData,
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
    buildRequest(route, data),
    fakeResponse.express,
    next,
  );
  await Promise.resolve(returned);

  return { handedOn, nextError, response: fakeResponse.recorded };
};

const deepLinkParams: (url: string | null) => URLSearchParams = (
  url: string | null,
): URLSearchParams => {
  expect(url).not.toBeNull();
  expect(url!.startsWith(`${MOBILE_SSO_CALLBACK_URL}?`)).toBe(true);

  return new URLSearchParams(url!.slice(url!.indexOf("?") + 1));
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
        EnterpriseFeature.SSO,
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

describe("every identity route starts with the license gate for its feature", () => {
  test("the enumeration sees all 46 routes of the nine routers", () => {
    expect(IDENTITY_ROUTERS).toHaveLength(9);
    expect(ALL_ROUTES).toHaveLength(46);

    const families: Record<GateFamily, number> = {
      "sso-json": 0,
      "sso-page": 0,
      scim: 0,
    };

    for (const route of ALL_ROUTES) {
      families[familyOf(route)]++;
    }

    expect(families).toEqual({ "sso-json": 4, "sso-page": 16, scim: 26 });
  });

  test("no route is missing its gate", () => {
    expect(
      findRoutesWithoutGate(ALL_ROUTES, (route: IdentityRoute) => {
        return featureOf(route.router);
      }),
    ).toEqual([]);
  });

  test.each(ALL_ROUTES.map(describeRoute))("%s", (label: string) => {
    const route: IdentityRoute = ALL_ROUTES.find(
      (candidate: IdentityRoute): boolean => {
        return describeRoute(candidate) === label;
      },
    )!;

    // The gate, then at least the route's own handler.
    expect(route.handlers.length).toBeGreaterThanOrEqual(2);
    expect(LicensedFeatureGate.getGatedFeature(route.handlers[0])).toBe(
      featureOf(route.router),
    );

    if (familyOf(route) === "sso-json") {
      expect(route.handlers[0]).toBe(LicensedFeatureGate.forSsoJson);
    }

    if (familyOf(route) === "scim") {
      // The license gate runs before the bearer-token check, so a lapsed license answers first.
      expect(route.handlers[0]).toBe(LicensedFeatureGate.forScim);
      expect(route.handlers[1]).toBe(SCIMMiddleware.isAuthorizedSCIMRequest);
    }

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

      router.get("/gated", LicensedFeatureGate.forSsoJson, handler);
      router.get("/ungated", handler);
      router.get("/wrong-feature", LicensedFeatureGate.forScim, handler);
      router.post("/gate-not-first", handler, LicensedFeatureGate.forSsoJson);

      return router;
    };

    test("statically: every ungated, wrongly gated or late-gated route is reported", () => {
      expect(
        findRoutesWithoutGate(
          getRoutes("Control", buildControlRouter()),
          (): EnterpriseFeature => {
            return EnterpriseFeature.SSO;
          },
        ),
      ).toEqual([
        "Control: GET /ungated",
        "Control: GET /wrong-feature",
        "Control: POST /gate-not-first",
      ]);
    });

    test("behaviourally: with SSO stopped, the ungated route reaches its handler while the gated one refuses", async () => {
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
      expect(gated.response.status).toBe(402);
      expect(ungated.response.body).toBe("the real handler ran");
      expect(ungated.response.status).toBe(200);
    });

    test("a plain function is not mistaken for a gate", () => {
      expect(LicensedFeatureGate.getGatedFeature(handler)).toBeNull();
      expect(LicensedFeatureGate.getGatedFeature(undefined)).toBeNull();
      expect(
        LicensedFeatureGate.getGatedFeature(
          SCIMMiddleware.isAuthorizedSCIMRequest,
        ),
      ).toBeNull();
    });
  });
});

describe("with the feature stopped, every route refuses the way its family answers", () => {
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
      expect(outcome.response.redirectedTo).toBeNull();

      switch (familyOf(route)) {
        case "sso-json":
          expect(outcome.response.status).toBe(402);
          expect(outcome.response.body).toEqual({
            message: SSO_UNAVAILABLE_MESSAGE,
          });
          break;
        case "sso-page":
          expect(outcome.response.status).toBe(402);
          expect(outcome.response.rendered).toEqual({
            view: MESSAGE_VIEW,
            vars: expect.objectContaining({
              title: SSO_UNAVAILABLE_TITLE,
              message: SSO_UNAVAILABLE_MESSAGE,
            }),
          });
          break;
        case "scim":
          expect(outcome.response.status).toBe(403);
          expect(outcome.response.body).toEqual({
            schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
            status: "403",
            detail: SCIM_UNAVAILABLE_MESSAGE,
          });
          break;
      }
    },
  );

  test("the messages name the lapsed license and what to do", () => {
    expect(SSO_UNAVAILABLE_MESSAGE).toContain(
      "Single sign-on is unavailable because this OneUptime installation's Enterprise license has lapsed",
    );
    expect(SSO_UNAVAILABLE_MESSAGE).toContain("Sign in with your password");
    expect(SSO_UNAVAILABLE_MESSAGE).toContain("renew the license");
    expect(SCIM_UNAVAILABLE_MESSAGE).toContain("Enterprise license has lapsed");
  });

  test("each feature is gated on its own: a license without SCIM stops SCIM routes only", async () => {
    installLicenseWithout(EnterpriseFeature.SCIM);

    for (const route of ALL_ROUTES) {
      const outcome: GateOutcome = await runFirstHandler(route);

      expect({
        route: describeRoute(route),
        handedOn: outcome.handedOn,
      }).toEqual({
        route: describeRoute(route),
        handedOn: familyOf(route) !== "scim",
      });
    }
  });

  test("each feature is gated on its own: a license without SSO stops SSO routes only", async () => {
    installLicenseWithout(EnterpriseFeature.SSO);

    for (const route of ALL_ROUTES) {
      const outcome: GateOutcome = await runFirstHandler(route);

      expect({
        route: describeRoute(route),
        handedOn: outcome.handedOn,
      }).toEqual({
        route: describeRoute(route),
        handedOn: familyOf(route) === "scim",
      });
    }
  });
});

describe("with the feature active, every gate hands the request on untouched", () => {
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
      const outcome: GateOutcome = await runFirstHandler(route, {
        query: { mobile: "true" },
      });

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

describe("the gates agree with core's EditionEnforcement in every state", () => {
  test.each(
    createEditionStateCases().map(
      (state: EditionStateCase): [string, EditionStateCase] => {
        return [state.label, state];
      },
    ),
  )("%s", async (_label: string, state: EditionStateCase) => {
    state.apply();

    const ssoRoutes: Array<IdentityRoute> = ALL_ROUTES.filter(
      (route: IdentityRoute): boolean => {
        return familyOf(route) !== "scim";
      },
    );
    const scimRoutes: Array<IdentityRoute> = ALL_ROUTES.filter(
      (route: IdentityRoute): boolean => {
        return familyOf(route) === "scim";
      },
    );

    for (const route of ssoRoutes) {
      const outcome: GateOutcome = await runFirstHandler(route);

      // Served exactly when core enforces SSO requirements and lists providers.
      expect({
        route: describeRoute(route),
        handedOn: outcome.handedOn,
      }).toEqual({
        route: describeRoute(route),
        handedOn: EditionEnforcement.isSsoEnforced(),
      });
      expect(outcome.handedOn).toBe(EditionEnforcement.areSsoRoutesServed());
    }

    for (const route of scimRoutes) {
      const outcome: GateOutcome = await runFirstHandler(route);

      // SCIM answers exactly when core applies the Push Groups team locks.
      expect(outcome.handedOn).toBe(
        EditionEnforcement.areScimTeamLocksEnforced(),
      );
    }

    expect(EditionEnforcement.isSsoEnforced()).toBe(state.isActive);
  });
});

describe("a license change applies to the next request, with the same mounted routers", () => {
  test("lapse refuses, renewal serves again, a new lapse refuses again", async () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("valid"),
    });
    const samples: Array<IdentityRoute> = [
      findRoute("SSO", "POST", "/idp-login/:projectId/:projectSsoId"),
      findRoute("GlobalOIDC", "GET", "/global-oidc/service-provider-login"),
      findRoute("SCIM", "GET", "/scim/v2/:projectScimId/Users"),
      findRoute(
        "StatusPageSCIM",
        "POST",
        "/status-page-scim/v2/:statusPageScimId/Users",
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

describe("mobile SSO flows end on the app's failure deep link", () => {
  const PROVIDER_ID: ObjectID = new ObjectID(PARAM_VALUE);

  beforeEach(() => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("expired"),
    });
  });

  const expectMobileRefusal: (outcome: GateOutcome) => void = (
    outcome: GateOutcome,
  ): void => {
    expect(outcome.handedOn).toBe(false);
    expect(outcome.response.rendered).toBeNull();

    const params: URLSearchParams = deepLinkParams(
      outcome.response.redirectedTo,
    );

    expect(params.get("error")).toBe(MOBILE_SSO_UNAVAILABLE_ERROR);
    expect(params.get("errorDescription")).toBe(SSO_UNAVAILABLE_MESSAGE);
    expect(params.get("accessToken")).toBeNull();
  };

  test.each([
    ["SSO", "/sso/:projectId/:projectSsoId"],
    ["OIDC", "/oidc/:projectId/:projectOidcId"],
    ["GlobalSSO", "/global-sso/:globalSsoId"],
    ["GlobalOIDC", "/global-oidc/:globalOidcId"],
  ])(
    "%s: the SP-initiated start with mobile=true",
    async (router: string, path: string) => {
      expectMobileRefusal(
        await runFirstHandler(findRoute(router, "GET", path), {
          query: { mobile: "true" },
        }),
      );
    },
  );

  test.each([
    ["SSO", "POST", "/idp-login/:projectId/:projectSsoId"],
    ["SSO", "GET", "/idp-login/:projectId/:projectSsoId"],
    ["GlobalSSO", "POST", "/global-idp-login/:globalSsoId"],
  ])(
    "%s: the SAML callback %s %s with RelayState=mobile in the body",
    async (router: string, method: string, path: string) => {
      expectMobileRefusal(
        await runFirstHandler(findRoute(router, method, path), {
          body: { SAMLResponse: "PHNhbWw+", RelayState: "mobile" },
        }),
      );
    },
  );

  test("the project SAML callback with RelayState=mobile in the query", async () => {
    expectMobileRefusal(
      await runFirstHandler(
        findRoute("SSO", "GET", "/idp-login/:projectId/:projectSsoId"),
        { query: { RelayState: "mobile" } },
      ),
    );
  });

  test.each([
    ["GlobalSSO", "POST", "/global-idp-login/:globalSsoId"],
    ["GlobalOIDC", "GET", "/global-oidc-callback/:globalOidcId"],
  ])(
    "%s: the callback %s %s recognised by the provider's mobile intent cookie",
    async (router: string, method: string, path: string) => {
      expectMobileRefusal(
        await runFirstHandler(findRoute(router, method, path), {
          cookies: { [getMobileSsoIntentCookieName(PROVIDER_ID)]: "true" },
        }),
      );
    },
  );

  test("the project OIDC callback recognised by the isMobile flag in its signed state cookie", async () => {
    const stateCookie: string = JSONWebToken.signJsonPayload(
      { state: "s", nonce: "n", codeVerifier: "v", isMobile: true },
      600,
    );

    expectMobileRefusal(
      await runFirstHandler(
        findRoute("OIDC", "GET", "/oidc-callback/:projectId/:projectOidcId"),
        { cookies: { [`oidc-state-${PARAM_VALUE}`]: stateCookie } },
      ),
    );
  });

  test("a project OIDC callback whose state cookie says web, or cannot be verified, renders the page", async () => {
    const route: IdentityRoute = findRoute(
      "OIDC",
      "GET",
      "/oidc-callback/:projectId/:projectOidcId",
    );
    const webState: string = JSONWebToken.signJsonPayload(
      { state: "s", nonce: "n", codeVerifier: "v", isMobile: false },
      600,
    );

    for (const cookie of [webState, "not-a-signed-token"]) {
      const outcome: GateOutcome = await runFirstHandler(route, {
        cookies: { [`oidc-state-${PARAM_VALUE}`]: cookie },
      });

      expect(outcome.response.redirectedTo).toBeNull();
      expect(outcome.response.rendered?.view).toBe(MESSAGE_VIEW);
    }
  });

  test("an intent cookie for another provider does not make a web login mobile", async () => {
    const outcome: GateOutcome = await runFirstHandler(
      findRoute("GlobalSSO", "POST", "/global-idp-login/:globalSsoId"),
      {
        cookies: {
          [getMobileSsoIntentCookieName(
            new ObjectID("11111111-1111-4111-8111-111111111111"),
          )]: "true",
        },
      },
    );

    expect(outcome.response.redirectedTo).toBeNull();
    expect(outcome.response.rendered?.view).toBe(MESSAGE_VIEW);
  });

  test.each(STATUS_PAGE_ROUTER_NAMES)(
    "%s has no mobile flow: mobile=true still renders the page",
    async (router: string) => {
      for (const route of ALL_ROUTES.filter((candidate: IdentityRoute) => {
        return candidate.router === router;
      })) {
        const outcome: GateOutcome = await runFirstHandler(route, {
          query: { mobile: "true" },
          body: { RelayState: "mobile" },
        });

        expect(outcome.response.redirectedTo).toBeNull();
        expect(outcome.response.rendered?.view).toBe(MESSAGE_VIEW);
      }
    },
  );

  test("the JSON discovery routes answer 402 JSON even for the app (it reads that as no SSO offered)", async () => {
    for (const route of ALL_ROUTES.filter((candidate: IdentityRoute) => {
      return familyOf(candidate) === "sso-json";
    })) {
      const outcome: GateOutcome = await runFirstHandler(route, {
        query: { mobile: "true" },
      });

      expect(outcome.response.redirectedTo).toBeNull();
      expect(outcome.response.status).toBe(402);
    }
  });
});
