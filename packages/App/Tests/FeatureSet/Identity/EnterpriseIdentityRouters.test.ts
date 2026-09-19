import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import IdentityFeatureSet from "../../../FeatureSet/Identity/Index";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import Express, {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "Common/Server/Utils/Express";
import FakeEnterpriseModule, {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import { createServer, Server } from "http";
import { AddressInfo } from "net";

/*
 * SAML, OIDC and SCIM are served by the Enterprise Edition module (ee/). The
 * core Identity feature set mounts whatever identity routers the loaded
 * module hands it, at the same two prefixes and in the same position the
 * eight core routers used to have, and none at all on the Community Edition.
 *
 * This suite never needs ee/ (core CI runs with it deleted): the Enterprise
 * side is FakeEnterpriseModule with small routers, and the three core routers
 * are replaced by probes so each one's position can be observed from outside.
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
 * them in decides who answers.
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

const PREFIXES: Array<string> = ["", "/api/identity"];

let server: Server | null = null;
let baseUrl: string = "";

const makeEnterpriseRouter: (
  routes: Array<[path: string, answer: string]>,
) => ExpressRouter = (
  routes: Array<[path: string, answer: string]>,
): ExpressRouter => {
  const router: ExpressRouter = Express.getRouter();

  for (const [path, answer] of routes) {
    router.get(path, (_req: ExpressRequest, res: ExpressResponse) => {
      res.send(answer);
    });
  }

  return router;
};

const startIdentity: () => Promise<void> = async (): Promise<void> => {
  Express.setupExpress();
  await IdentityFeatureSet.init();

  const app: ExpressApplication = Express.getExpressApp();

  server = createServer(app);
  await new Promise<void>((resolve: () => void) => {
    server!.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
};

const get: (path: string) => Promise<{ status: number; body: string }> = async (
  path: string,
): Promise<{ status: number; body: string }> => {
  const response: globalThis.Response = await fetch(`${baseUrl}${path}`);

  return { status: response.status, body: await response.text() };
};

beforeEach(() => {
  setTestBillingEnabled(false);
  uninstallEnterpriseModule();
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve: () => void) => {
      server!.close(() => {
        resolve();
      });
    });
    server = null;
  }

  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
});

describe("Identity feature set on the Community Edition", () => {
  test.each([false, true])(
    "serves no SAML, OIDC or SCIM route (billing=%s)",
    async (billing: boolean) => {
      setTestBillingEnabled(billing);
      await startIdentity();

      expect(EnterpriseEdition.isLoaded()).toBe(false);

      for (const prefix of PREFIXES) {
        for (const path of [
          "/sso/project-id/sso-id",
          "/idp-login/project-id/sso-id",
          "/oidc-callback/project-id/oidc-id",
          "/global-sso/service-provider-login",
          "/global-oidc-callback/oidc-id",
          "/scim/v2/scim-id/ServiceProviderConfig",
          "/status-page-scim/v2/scim-id/Users",
          "/status-page-sso/page-id/sso-id",
          "/status-page-oidc-callback/page-id/oidc-id",
        ]) {
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

    for (const prefix of PREFIXES) {
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
});

describe("Identity feature set with the Enterprise Edition loaded", () => {
  test.each([false, true])(
    "mounts every router the module hands over, at both prefixes (billing=%s)",
    async (billing: boolean) => {
      setTestBillingEnabled(billing);
      installFakeEnterpriseModule({
        identityRouters: [
          makeEnterpriseRouter([["/sso/:projectId/:projectSsoId", "ee:sso"]]),
          makeEnterpriseRouter([
            ["/scim/v2/:projectScimId/ServiceProviderConfig", "ee:scim"],
          ]),
        ],
      });
      await startIdentity();

      for (const prefix of PREFIXES) {
        expect(await get(`${prefix}/sso/project-id/sso-id`)).toEqual({
          status: 200,
          body: "ee:sso",
        });
        expect(
          await get(`${prefix}/scim/v2/scim-id/ServiceProviderConfig`),
        ).toEqual({
          status: 200,
          body: "ee:scim",
        });
      }
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

    for (const prefix of PREFIXES) {
      expect((await get(`${prefix}/probe/authentication`)).body).toBe(
        "core:authentication",
      );
      expect((await get(`${prefix}/shadow-probe`)).body).toBe("core:reseller");
    }
  });

  test("mounts them before the status page authentication router", async () => {
    installFakeEnterpriseModule({
      identityRouters: [
        makeEnterpriseRouter([["/status-page/probe", "ee:first"]]),
      ],
    });
    await startIdentity();

    for (const prefix of PREFIXES) {
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

  test("a module with no identity routers leaves only the core routes", async () => {
    installFakeEnterpriseModule({ identityRouters: [] });
    await startIdentity();

    expect((await get("/sso/project-id/sso-id")).status).toBe(404);
    expect((await get("/probe/authentication")).body).toBe(
      "core:authentication",
    );
  });
});
