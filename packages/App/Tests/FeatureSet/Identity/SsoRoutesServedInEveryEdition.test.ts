import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import {
  SSO_ROUTERS,
  SsoRouterEntry,
} from "../../../FeatureSet/Identity/SsoRouters";
import {
  ExpectedSsoAnswer,
  expectEverySsoProbeAnswered,
  IdentityServer,
  PROVIDER_ID,
  readDeepLink,
  sendProbe,
  SSO_ROUTE_PROBES,
  SsoAnswer,
  SsoProbe,
  startIdentityServer,
  stubRenderedViews,
  stubSsoDatabaseReads,
} from "./SsoRouteProbes";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import { EnterpriseLicenseSnapshot } from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
import FakeEnterpriseModule, {
  createEditionStateCases,
  createLicenseSnapshotWithStatus,
  EditionStateCase,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";

/*
 * Single sign-on is part of every edition. The real core Identity feature set,
 * booted in every edition, license and billing state - the Community Edition
 * (no ee/), the Enterprise Edition with a valid, grace, trial, legacy,
 * expired, missing, invalid, SSO-less or unknown license, and OneUptime Cloud
 * (billing on) - serves every SAML and OIDC route at both prefixes and each
 * one answers with its OWN handler's answer, identical in every state. No
 * request reads the license, and no answer is a license refusal (402), a
 * Forbidden (403), a 404 or the retired error=sso_unavailable deep link.
 *
 * The requests and their answers are SsoRouteProbes.SSO_ROUTE_PROBES: each one
 * is turned away by the route's own code before any database read, so the
 * suite needs no Postgres. The three other core identity routers
 * (authentication, reseller, status page authentication) are replaced by
 * empty ones; an Enterprise state gets a stand-in SCIM router, which is all
 * the Enterprise Edition adds to identity.
 *
 * Billing is pinned in every state (CI's config.env sets BILLING_ENABLED=true).
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

jest.mock("../../../FeatureSet/Identity/API/Authentication", () => {
  const express: typeof import("Common/Server/Utils/Express") =
    jest.requireActual(
      "Common/Server/Utils/Express",
    ) as typeof import("Common/Server/Utils/Express");

  return { __esModule: true, default: express.default.getRouter() };
});

jest.mock("../../../FeatureSet/Identity/API/Reseller", () => {
  const express: typeof import("Common/Server/Utils/Express") =
    jest.requireActual(
      "Common/Server/Utils/Express",
    ) as typeof import("Common/Server/Utils/Express");

  return { __esModule: true, default: express.default.getRouter() };
});

jest.mock("../../../FeatureSet/Identity/API/StatusPageAuthentication", () => {
  const express: typeof import("Common/Server/Utils/Express") =
    jest.requireActual(
      "Common/Server/Utils/Express",
    ) as typeof import("Common/Server/Utils/Express");

  return { __esModule: true, default: express.default.getRouter() };
});

const SCIM_PATH: string = `/scim/v2/${PROVIDER_ID}/ServiceProviderConfig`;
const STATUS_PAGE_SCIM_PATH: string = `/status-page-scim/v2/${PROVIDER_ID}/Users`;

// What the Enterprise Edition adds to identity: SCIM. A stand-in answering its own name.
const buildScimStandIn: () => ExpressRouter = (): ExpressRouter => {
  const router: ExpressRouter = Express.getRouter();

  for (const path of [
    "/scim/v2/:projectScimId/ServiceProviderConfig",
    "/status-page-scim/v2/:statusPageScimId/Users",
  ]) {
    router.get(path, (_req: ExpressRequest, res: ExpressResponse): void => {
      res.send("ee:scim");
    });
  }

  return router;
};

const EDITION_STATES: Array<EditionStateCase> = createEditionStateCases();

let server: IdentityServer | null = null;
let licenseReads: Array<jest.SpyInstance> = [];

// Boots the Identity feature set in `state`, the way the App boots: routers are mounted once.
const bootIn: (
  state: EditionStateCase,
) => Promise<FakeEnterpriseModule | null> = async (
  state: EditionStateCase,
): Promise<FakeEnterpriseModule | null> => {
  const fake: FakeEnterpriseModule | null = state.apply();

  if (fake) {
    fake.identityRouters = [buildScimStandIn()];
  }

  server = await startIdentityServer();

  return fake;
};

// Every way a request could ask the license, so a test can require that none did.
const watchLicenseReads: (fake: FakeEnterpriseModule | null) => void = (
  fake: FakeEnterpriseModule | null,
): void => {
  licenseReads = [
    jest.spyOn(EnterpriseEdition, "isFeatureActive"),
    jest.spyOn(EnterpriseEdition, "isFeatureAvailableSync"),
    jest.spyOn(EnterpriseEdition, "isFeatureAvailable"),
    jest.spyOn(EnterpriseEdition, "getLicenseSnapshot"),
  ];

  if (fake) {
    licenseReads.push(
      jest.spyOn(fake.licensing, "getCachedSnapshot"),
      jest.spyOn(fake.licensing, "getSnapshot"),
    );
  }
};

const expectNoLicenseRead: () => void = (): void => {
  for (const spy of licenseReads) {
    expect(spy).not.toHaveBeenCalled();
  }
};

const get: (path: string) => Promise<{ status: number; body: string }> = async (
  path: string,
): Promise<{ status: number; body: string }> => {
  const response: globalThis.Response = await fetch(
    `${server!.baseUrl}${path}`,
  );

  return { status: response.status, body: await response.text() };
};

beforeAll(() => {
  // Every 400 below is logged as an error by Response.sendErrorResponse.
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "warn").mockImplementation((): void => {
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

  for (const spy of licenseReads) {
    spy.mockRestore();
  }

  licenseReads = [];
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe("the SSO probes", () => {
  test("reach every route of every core SSO router", () => {
    const probed: Set<string> = new Set(
      SSO_ROUTE_PROBES.map((probe: SsoProbe): string => {
        return `${probe.router} ${probe.method} ${probe.route}`;
      }),
    );

    for (const entry of SSO_ROUTERS) {
      const layers: Array<{
        route?: { path: string; methods: Record<string, boolean> };
      }> = (
        entry.router as unknown as {
          stack: Array<{
            route?: { path: string; methods: Record<string, boolean> };
          }>;
        }
      ).stack;

      for (const layer of layers) {
        for (const method of Object.keys(layer.route!.methods)) {
          expect(probed).toContain(
            `${entry.name} ${method.toUpperCase()} ${layer.route!.path}`,
          );
        }
      }
    }
  });

  test("name only routers that exist", () => {
    const names: Array<string> = SSO_ROUTERS.map(
      (entry: SsoRouterEntry): string => {
        return entry.name;
      },
    );

    for (const probe of SSO_ROUTE_PROBES) {
      expect(names).toContain(probe.router);
    }
  });

  test("pin the handlers' own answers: none is a license refusal, a Forbidden or a 404", () => {
    for (const probe of SSO_ROUTE_PROBES) {
      const expected: ExpectedSsoAnswer = probe.expected;

      expect([402, 403, 404]).not.toContain(expected.status);
      expect(expected.deepLink?.["error"]).not.toBe("sso_unavailable");
    }
  });

  test("include mobile logins that end on the app's failure deep link", () => {
    expect(
      SSO_ROUTE_PROBES.filter((probe: SsoProbe): boolean => {
        return probe.expected.status === 302;
      }).length,
    ).toBeGreaterThanOrEqual(4);
  });
});

describe("every SSO route answers with its own handler, identically, in every state", () => {
  test("the states include the Community Edition, lapsed and unknown licenses, and the Cloud", () => {
    expect(
      EDITION_STATES.filter((state: EditionStateCase): boolean => {
        return !state.isLoaded;
      }).length,
    ).toBe(2);
    expect(
      EDITION_STATES.filter((state: EditionStateCase): boolean => {
        return state.isLoaded && !state.isActive;
      }).length,
    ).toBeGreaterThanOrEqual(4);
    expect(
      EDITION_STATES.filter((state: EditionStateCase): boolean => {
        return state.billing;
      }).length,
    ).toBeGreaterThanOrEqual(EDITION_STATES.length / 2);
  });

  test.each(
    EDITION_STATES.map(
      (state: EditionStateCase): [string, EditionStateCase] => {
        return [state.label, state];
      },
    ),
  )("%s", async (_label: string, state: EditionStateCase) => {
    const fake: FakeEnterpriseModule | null = await bootIn(state);

    watchLicenseReads(fake);

    await expectEverySsoProbeAnswered(server!.baseUrl);

    expectNoLicenseRead();

    // SCIM is the Enterprise Edition's: served only when ee/ is loaded.
    for (const prefix of ["", "/api/identity"]) {
      for (const path of [SCIM_PATH, STATUS_PAGE_SCIM_PATH]) {
        expect({
          path: `${prefix}${path}`,
          status: (await get(`${prefix}${path}`)).status,
        }).toEqual({
          path: `${prefix}${path}`,
          status: state.isLoaded ? 200 : 404,
        });
      }
    }
  });
});

describe("a license that changes while the server runs changes no SSO answer", () => {
  test("valid, expired, missing, invalid, grace and unknown: the same answers, with no re-mount", async () => {
    setTestBillingEnabled(false);

    const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("valid"),
      identityRouters: [buildScimStandIn()],
    });

    server = await startIdentityServer();

    const snapshots: Array<EnterpriseLicenseSnapshot | null> = [
      createLicenseSnapshotWithStatus("valid"),
      createLicenseSnapshotWithStatus("expired"),
      createLicenseSnapshotWithStatus("missing"),
      createLicenseSnapshotWithStatus("invalid"),
      createLicenseSnapshotWithStatus("grace"),
      null,
      createLicenseSnapshotWithStatus("expired"),
    ];

    for (const snapshot of snapshots) {
      fake.setSnapshot(snapshot);

      await expectEverySsoProbeAnswered(server.baseUrl);
    }
  });

  test("a mobile login that the lapse used to end on error=sso_unavailable now reaches its handler", async () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("expired"),
    });

    server = await startIdentityServer();

    const answer: SsoAnswer = await sendProbe(server.baseUrl, "", {
      label: "Global SSO start from the mobile app, license expired",
      router: "GlobalSSO",
      method: "GET",
      route: "/global-sso/:globalSsoId",
      path: `/global-sso/${PROVIDER_ID}?mobile=true`,
      expected: { status: 400 },
    });

    expect(readDeepLink(answer.location)).toBeNull();
    expect(answer.status).toBe(400);
    expect(answer.body).toEqual({ message: "Global SSO Config not found" });
  });
});

describe("without the Enterprise Edition", () => {
  test.each([false, true])(
    "SCIM is not served, SSO is (billing=%s)",
    async (billing: boolean) => {
      setTestBillingEnabled(billing);
      uninstallEnterpriseModule();

      server = await startIdentityServer();

      expect(EnterpriseEdition.isLoaded()).toBe(false);

      for (const prefix of ["", "/api/identity"]) {
        expect((await get(`${prefix}${SCIM_PATH}`)).status).toBe(404);
        expect((await get(`${prefix}${STATUS_PAGE_SCIM_PATH}`)).status).toBe(
          404,
        );
      }

      await expectEverySsoProbeAnswered(server.baseUrl);
    },
  );
});
