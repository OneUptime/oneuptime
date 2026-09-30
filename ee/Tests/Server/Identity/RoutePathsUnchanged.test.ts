import { describe, expect, jest, test } from "@jest/globals";
import IdentityArea, {
  IDENTITY_ROUTERS,
  IdentityRouterEntry,
} from "../../../Server/Identity/Index";
import EnterpriseModule, { ENTERPRISE_AREAS } from "../../../Server/Index";
import SCIMMiddleware from "../../../Server/Identity/Middleware/SCIMAuthorization";
import LicensedFeatureGate from "../../../Server/Identity/Middleware/LicensedFeatureGate";
import EnterpriseArea from "../../../Server/Types/EnterpriseArea";
import {
  SSO_ROUTERS,
  SsoRouterEntry,
} from "App/FeatureSet/Identity/SsoRouters";
import { EnterpriseServerModuleShape } from "Common/Server/Enterprise/EnterpriseServerModule";
import type { ExpressRouter } from "Common/Server/Utils/Express";

/*
 * The SCIM routes are configured INSIDE customers' identity providers: the
 * SCIM base URLs are pasted into Okta, Entra ID, Google Workspace and the
 * like, and nginx forwards /identity/... to them. Changing one silently
 * breaks provisioning for every customer that uses it, with nothing on our
 * side to notice.
 *
 * PINNED_ROUTES is the full (method, path) list of the two SCIM routers as
 * they were registered in packages/App/FeatureSet/Identity/API/*.ts at commit
 * 2eeec4a847, read from the live routers' stacks (not from the source text)
 * before they moved to ee/. The order is the registration order, which is
 * also Express's match order. Changing this list is changing a public
 * contract: it needs a migration plan for every configured identity
 * provider, not just an updated test.
 *
 * Single sign-on (SAML and OIDC) is core and served in every edition; its
 * routes are pinned next to the code, by
 * packages/App/Tests/FeatureSet/Identity/SsoRoutePathsUnchanged.test.ts. This
 * suite also checks the Enterprise Edition declares none of them.
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
  test("are the routers core mounts, in the same order", () => {
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

  test("the Identity area hands core all 26 SCIM routes, in mount order", () => {
    const routers: Array<ExpressRouter> =
      IdentityArea.getIdentityRouters!() as Array<ExpressRouter>;

    expect(routers).toHaveLength(2);
    expect(routers.flatMap(getRoutes)).toEqual(
      PINNED_ROUTES.flatMap((pinned: { routes: Array<PinnedRoute> }) => {
        return pinned.routes;
      }),
    );
    expect(routers.flatMap(getRoutes)).toHaveLength(26);
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
    "every %s route runs the SCIM license gate, then the SCIM bearer-token check, before its handler",
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
        expect(layer.route!.stack.length).toBeGreaterThanOrEqual(3);
        /*
         * The license gate first (see IdentityLicenseGates.test.ts): while
         * the license does not cover SCIM, every SCIM call is refused before
         * the bearer token is even looked up.
         */
        expect({
          path: layer.route!.path,
          firstHandler: layer.route!.stack[0]!.handle,
          secondHandler: layer.route!.stack[1]!.handle,
        }).toEqual({
          path: layer.route!.path,
          firstHandler: LicensedFeatureGate.forScim,
          secondHandler: SCIMMiddleware.isAuthorizedSCIMRequest,
        });
      }
    },
  );

  test("the SCIM base paths the configuration screens print are all served", () => {
    const served: Array<string> = IDENTITY_ROUTERS.flatMap(
      (entry: IdentityRouterEntry) => {
        return getRoutes(entry.router).map((route: PinnedRoute) => {
          return `${route[0]} ${route[1]}`;
        });
      },
    );

    /*
     * The SCIM base URLs the Dashboard tells admins to paste into their
     * identity provider (ee/Dashboard/Identity), which the provider extends
     * with the resource it calls.
     */
    expect(served).toEqual(
      expect.arrayContaining([
        "GET /scim/v2/:projectScimId/ServiceProviderConfig",
        "GET /scim/v2/:projectScimId/Users",
        "GET /status-page-scim/v2/:statusPageScimId/ServiceProviderConfig",
        "GET /status-page-scim/v2/:statusPageScimId/Users",
      ]),
    );
  });

  test("every route is under a SCIM base path: the Enterprise Edition serves no single sign-on route", () => {
    for (const entry of IDENTITY_ROUTERS) {
      for (const route of getRoutes(entry.router)) {
        expect({
          router: entry.name,
          route: route.join(" "),
          isScim:
            route[1].startsWith("/scim/v2/") ||
            route[1].startsWith("/status-page-scim/v2/"),
        }).toEqual({
          router: entry.name,
          route: route.join(" "),
          isScim: true,
        });
      }
    }
  });

  test("no ee identity router declares a (method, path) that a core SSO router serves", () => {
    const coreSsoRoutes: Set<string> = new Set(
      SSO_ROUTERS.flatMap((entry: SsoRouterEntry): Array<string> => {
        return getRoutes(entry.router).map((route: PinnedRoute): string => {
          return route.join(" ");
        });
      }),
    );

    // The core SSO routes this compares against are really there (20 of them).
    expect(coreSsoRoutes.size).toBe(20);

    for (const entry of IDENTITY_ROUTERS) {
      for (const route of getRoutes(entry.router)) {
        expect(coreSsoRoutes.has(route.join(" "))).toBe(false);
      }
    }

    // And none of the core SSO routers is handed over by ee as well.
    const eeRouters: Array<ExpressRouter> =
      EnterpriseModule.getIdentityRouters();

    for (const entry of SSO_ROUTERS) {
      expect(eeRouters).not.toContain(entry.router);
    }
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
