import { describe, expect, jest, test } from "@jest/globals";
import IdentityArea, {
  IDENTITY_ROUTERS,
  IdentityRouterEntry,
} from "../../../Server/Identity/Index";
import EnterpriseModule, { ENTERPRISE_AREAS } from "../../../Server/Index";
import SCIMMiddleware from "../../../Server/Identity/Middleware/SCIMAuthorization";
import EnterpriseArea from "../../../Server/Types/EnterpriseArea";
import { EnterpriseServerModuleShape } from "Common/Server/Enterprise/EnterpriseServerModule";
import type { ExpressRouter } from "Common/Server/Utils/Express";

/*
 * The identity routes are configured INSIDE customers' identity providers:
 * the SAML ACS URLs, the OIDC redirect URIs and the SCIM base URLs are pasted
 * into Okta, Entra ID, Google Workspace and the like, and nginx forwards
 * /identity/... to them. Changing one silently breaks sign-in or
 * provisioning for every customer that uses it, with nothing on our side to
 * notice.
 *
 * PINNED_ROUTES is the full (method, path) list of the eight routers as they
 * were registered in packages/App/FeatureSet/Identity/API/*.ts at commit
 * 2eeec4a847, read from the live routers' stacks (not from the source text)
 * before they moved to ee/. The order is the registration order, which is
 * also Express's match order. Changing this list is changing a public
 * contract: it needs a migration plan for every configured identity
 * provider, not just an updated test.
 *
 * RunCron is captured so importing the assembled module never reaches Redis.
 */
jest.mock("App/FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

type PinnedRoute = [method: string, path: string];

const PINNED_ROUTES: Array<{ name: string; routes: Array<PinnedRoute> }> = [
  {
    name: "SSO",
    routes: [
      ["GET", "/service-provider-login"],
      ["GET", "/sso/:projectId/:projectSsoId"],
      ["GET", "/idp-login/:projectId/:projectSsoId"],
      ["POST", "/idp-login/:projectId/:projectSsoId"],
    ],
  },
  {
    name: "OIDC",
    routes: [
      ["GET", "/service-provider-login-oidc"],
      ["GET", "/oidc/:projectId/:projectOidcId"],
      ["GET", "/oidc-callback/:projectId/:projectOidcId"],
    ],
  },
  {
    name: "GlobalSSO",
    routes: [
      ["GET", "/global-sso/service-provider-login"],
      ["GET", "/global-sso/:globalSsoId"],
      ["GET", "/global-idp-login/:globalSsoId"],
      ["POST", "/global-idp-login/:globalSsoId"],
    ],
  },
  {
    name: "GlobalOIDC",
    routes: [
      ["GET", "/global-oidc/service-provider-login"],
      ["GET", "/global-oidc/:globalOidcId"],
      ["GET", "/global-oidc-callback/:globalOidcId"],
    ],
  },
  {
    name: "SCIM",
    routes: [
      ["GET", "/scim/v2/:projectScimId/ServiceProviderConfig"],
      ["GET", "/scim/v2/:projectScimId/Schemas"],
      ["GET", "/scim/v2/:projectScimId/ResourceTypes"],
      ["POST", "/scim/v2/:projectScimId/Bulk"],
      ["GET", "/scim/v2/:projectScimId/Users"],
      ["GET", "/scim/v2/:projectScimId/Users/:userId"],
      ["PUT", "/scim/v2/:projectScimId/Users/:userId"],
      ["PATCH", "/scim/v2/:projectScimId/Users/:userId"],
      ["GET", "/scim/v2/:projectScimId/Groups"],
      ["GET", "/scim/v2/:projectScimId/Groups/:groupId"],
      ["POST", "/scim/v2/:projectScimId/Groups"],
      ["PUT", "/scim/v2/:projectScimId/Groups/:groupId"],
      ["DELETE", "/scim/v2/:projectScimId/Groups/:groupId"],
      ["PATCH", "/scim/v2/:projectScimId/Groups/:groupId"],
      ["POST", "/scim/v2/:projectScimId/Users"],
      ["DELETE", "/scim/v2/:projectScimId/Users/:userId"],
    ],
  },
  {
    name: "StatusPageSCIM",
    routes: [
      ["GET", "/status-page-scim/v2/:statusPageScimId/ServiceProviderConfig"],
      ["GET", "/status-page-scim/v2/:statusPageScimId/Schemas"],
      ["GET", "/status-page-scim/v2/:statusPageScimId/ResourceTypes"],
      ["POST", "/status-page-scim/v2/:statusPageScimId/Bulk"],
      ["GET", "/status-page-scim/v2/:statusPageScimId/Users"],
      ["GET", "/status-page-scim/v2/:statusPageScimId/Users/:userId"],
      ["POST", "/status-page-scim/v2/:statusPageScimId/Users"],
      ["PUT", "/status-page-scim/v2/:statusPageScimId/Users/:userId"],
      ["PATCH", "/status-page-scim/v2/:statusPageScimId/Users/:userId"],
      ["DELETE", "/status-page-scim/v2/:statusPageScimId/Users/:userId"],
    ],
  },
  {
    name: "StatusPageSSO",
    routes: [
      ["GET", "/status-page-sso/:statusPageId/:statusPageSsoId"],
      ["POST", "/status-page-idp-login/:statusPageId/:statusPageSsoId"],
    ],
  },
  {
    name: "StatusPageOIDC",
    routes: [
      ["GET", "/status-page-oidc/:statusPageId/:statusPageOidcId"],
      ["GET", "/status-page-oidc-callback/:statusPageId/:statusPageOidcId"],
    ],
  },
];

// Express 4 keeps these on each stack layer; its typings leave them out.
interface RouteLayer {
  route?:
    | {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ handle: unknown }>;
      }
    | undefined;
}

const getLayers: (router: ExpressRouter) => Array<RouteLayer> = (
  router: ExpressRouter,
): Array<RouteLayer> => {
  return (router as unknown as { stack: Array<RouteLayer> }).stack;
};

const getRoutes: (router: ExpressRouter) => Array<PinnedRoute> = (
  router: ExpressRouter,
): Array<PinnedRoute> => {
  const routes: Array<PinnedRoute> = [];

  for (const layer of getLayers(router)) {
    if (!layer.route) {
      continue;
    }

    for (const method of Object.keys(layer.route.methods)) {
      routes.push([method.toUpperCase(), layer.route.path]);
    }
  }

  return routes;
};

const SCIM_ROUTER_NAMES: Array<string> = ["SCIM", "StatusPageSCIM"];

describe("ee identity routers", () => {
  test("are the eight routers core used to mount, in the same order", () => {
    expect(
      IDENTITY_ROUTERS.map((entry: IdentityRouterEntry) => {
        return entry.name;
      }),
    ).toEqual(
      PINNED_ROUTES.map((pinned: { name: string }) => {
        return pinned.name;
      }),
    );
  });

  test.each(PINNED_ROUTES)(
    "$name serves exactly its pinned routes, byte for byte and in order",
    (pinned: { name: string; routes: Array<PinnedRoute> }) => {
      const entry: IdentityRouterEntry | undefined = IDENTITY_ROUTERS.find(
        (candidate: IdentityRouterEntry) => {
          return candidate.name === pinned.name;
        },
      );

      expect(entry).toBeDefined();
      expect(getRoutes(entry!.router)).toEqual(pinned.routes);
    },
  );

  test("the Identity area hands core all 44 routes, in mount order", () => {
    const routers: Array<ExpressRouter> =
      IdentityArea.getIdentityRouters!() as Array<ExpressRouter>;

    expect(routers).toHaveLength(8);
    expect(routers.flatMap(getRoutes)).toEqual(
      PINNED_ROUTES.flatMap((pinned: { routes: Array<PinnedRoute> }) => {
        return pinned.routes;
      }),
    );
    expect(routers.flatMap(getRoutes)).toHaveLength(44);
  });

  test("returns the same router instances on every call (core mounts them once)", () => {
    expect(IdentityArea.getIdentityRouters!()).toEqual(
      IdentityArea.getIdentityRouters!(),
    );

    const first: Array<ExpressRouter> =
      IdentityArea.getIdentityRouters!() as Array<ExpressRouter>;
    const second: Array<ExpressRouter> =
      IdentityArea.getIdentityRouters!() as Array<ExpressRouter>;

    first.forEach((router: ExpressRouter, index: number) => {
      expect(router).toBe(second[index]);
    });
  });

  test.each(PINNED_ROUTES)(
    "$name has only routes: no router.use() layer that could shadow a core route",
    (pinned: { name: string }) => {
      const entry: IdentityRouterEntry = IDENTITY_ROUTERS.find(
        (candidate: IdentityRouterEntry) => {
          return candidate.name === pinned.name;
        },
      ) as IdentityRouterEntry;

      expect(
        EnterpriseServerModuleShape.findLayersWithoutRoute(entry.router),
      ).toEqual([]);
    },
  );

  test.each(SCIM_ROUTER_NAMES)(
    "every %s route runs the SCIM bearer-token check before its handler",
    (name: string) => {
      const entry: IdentityRouterEntry = IDENTITY_ROUTERS.find(
        (candidate: IdentityRouterEntry) => {
          return candidate.name === name;
        },
      ) as IdentityRouterEntry;

      const layers: Array<RouteLayer> = getLayers(entry.router);

      expect(layers.length).toBeGreaterThan(0);

      for (const layer of layers) {
        expect(layer.route).toBeDefined();
        expect(layer.route!.stack.length).toBeGreaterThanOrEqual(2);
        expect({
          path: layer.route!.path,
          firstHandler: layer.route!.stack[0]!.handle,
        }).toEqual({
          path: layer.route!.path,
          firstHandler: SCIMMiddleware.isAuthorizedSCIMRequest,
        });
      }
    },
  );

  test("the SAML ACS, OIDC redirect and SCIM base paths the configuration screens print are all served", () => {
    const served: Array<string> = IDENTITY_ROUTERS.flatMap(
      (entry: IdentityRouterEntry) => {
        return getRoutes(entry.router).map((route: PinnedRoute) => {
          return `${route[0]} ${route[1]}`;
        });
      },
    );

    /*
     * The URLs the Dashboard and Admin Dashboard tell admins to paste into
     * their identity provider (ee/Dashboard/SSO, ee/AdminDashboard/GlobalSSO).
     */
    expect(served).toEqual(
      expect.arrayContaining([
        "POST /idp-login/:projectId/:projectSsoId",
        "GET /oidc-callback/:projectId/:projectOidcId",
        "POST /global-idp-login/:globalSsoId",
        "GET /global-oidc-callback/:globalOidcId",
        "POST /status-page-idp-login/:statusPageId/:statusPageSsoId",
        "GET /status-page-oidc-callback/:statusPageId/:statusPageOidcId",
        "GET /scim/v2/:projectScimId/ServiceProviderConfig",
        "GET /status-page-scim/v2/:statusPageScimId/ServiceProviderConfig",
      ]),
    );
  });
});

describe("the assembled enterprise module", () => {
  test("includes the Identity area", () => {
    expect(
      ENTERPRISE_AREAS.map((area: EnterpriseArea) => {
        return area.name;
      }),
    ).toContain("Identity");
  });

  test("hands core the identity routers as one block, in order", () => {
    const all: Array<ExpressRouter> = EnterpriseModule.getIdentityRouters();
    const identity: Array<ExpressRouter> = IDENTITY_ROUTERS.map(
      (entry: IdentityRouterEntry) => {
        return entry.router;
      },
    );
    const start: number = all.indexOf(identity[0]!);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(all.slice(start, start + identity.length)).toEqual(identity);
  });
});
