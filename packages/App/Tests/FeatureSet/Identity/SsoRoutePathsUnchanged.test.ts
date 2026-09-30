import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import IdentityFeatureSet from "../../../FeatureSet/Identity/Index";
import {
  SSO_ROUTERS,
  SsoRouterEntry,
} from "../../../FeatureSet/Identity/SsoRouters";
import ProjectSsoSignInConfirmation, {
  ProjectSsoKind,
} from "../../../FeatureSet/Identity/Utils/ProjectSsoSignInConfirmation";
import { EnterpriseServerModuleShape } from "Common/Server/Enterprise/EnterpriseServerModule";
import Express, {
  ExpressApplication,
  ExpressRouter,
} from "Common/Server/Utils/Express";
import FakeEnterpriseModule, {
  createEditionStateCases,
  EditionStateCase,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";

/*
 * The single sign-on routes are configured INSIDE customers' identity
 * providers: the SAML ACS URLs and the OIDC redirect URIs are pasted into
 * Okta, Entra ID, Google Workspace and the like, and nginx forwards
 * /identity/... to them. Changing one silently breaks sign-in for every
 * customer that uses it, with nothing on our side to notice.
 *
 * PINNED_ROUTES is the full (method, path) list of the seven SSO routers: the
 * six that were registered in packages/App/FeatureSet/Identity/API/*.ts at
 * commit 2eeec4a847, read from the live routers' stacks (not from the source
 * text) before they moved to ee/ and back, plus the confirmation page added
 * while they were in ee/. The order is the registration order, which is also
 * Express's match order. Changing this list is changing a public contract: it
 * needs a migration plan for every configured identity provider, not just an
 * updated test. (The SCIM routes are the Enterprise Edition's and are pinned
 * by ee/Tests/Server/Identity/RoutePathsUnchanged.test.ts.)
 *
 * Every SSO route is served in every edition, so each one is its own handler
 * alone: nothing - no license gate - runs in front of it.
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

// The other core identity routers, as markers whose mount position can be read.
jest.mock("../../../FeatureSet/Identity/API/Authentication", () => {
  return { __esModule: true, default: { coreRouter: "authentication" } };
});
jest.mock("../../../FeatureSet/Identity/API/Reseller", () => {
  return { __esModule: true, default: { coreRouter: "reseller" } };
});
jest.mock("../../../FeatureSet/Identity/API/StatusPageAuthentication", () => {
  return { __esModule: true, default: { coreRouter: "status-page" } };
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
  /*
   * Added while the routers were in ee/, so not from the commit above. Nobody
   * pastes this one into an identity provider, but it is written into
   * confirmation emails that are already sitting in inboxes, so it is just as
   * fixed once shipped.
   */
  {
    name: "ProjectSsoSignInConfirmation",
    routes: [
      ["GET", "/sso-sign-in-confirmation/:kind/:projectId/:providerId"],
      ["POST", "/sso-sign-in-confirmation/:kind/:projectId/:providerId"],
    ],
  },
];

const ALL_PINNED: Array<PinnedRoute> = PINNED_ROUTES.flatMap(
  (pinned: { routes: Array<PinnedRoute> }): Array<PinnedRoute> => {
    return pinned.routes;
  },
);

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

const findEntry: (name: string) => SsoRouterEntry = (
  name: string,
): SsoRouterEntry => {
  const entry: SsoRouterEntry | undefined = SSO_ROUTERS.find(
    (candidate: SsoRouterEntry): boolean => {
      return candidate.name === name;
    },
  );

  expect(entry).toBeDefined();

  return entry!;
};

/*
 * A path the product builds (`/idp-login/${projectId}/${providerId}`), as a
 * route shape: its first segment and how many parameters follow.
 */
interface PathShape {
  head: string;
  parameters: number;
}

const shapeOfRoute: (route: string) => PathShape = (
  route: string,
): PathShape => {
  const segments: Array<string> = route.split("/").filter(Boolean);

  return {
    head: segments[0]!,
    parameters: segments.slice(1).filter((segment: string): boolean => {
      return segment.startsWith(":");
    }).length,
  };
};

// Whether some pinned route has the shape (and so would serve the built path).
const isServed: (shape: PathShape, method: string) => boolean = (
  shape: PathShape,
  method: string,
): boolean => {
  return ALL_PINNED.some((route: PinnedRoute): boolean => {
    const pinned: PathShape = shapeOfRoute(route[1]);
    const segments: Array<string> = route[1].split("/").filter(Boolean);

    return (
      route[0] === method &&
      pinned.head === shape.head &&
      pinned.parameters === shape.parameters &&
      // Only parameters after the head: no second static segment to match.
      segments.length === shape.parameters + 1
    );
  });
};

// Every `/<head>/${...}/${...}` path built in `source`, for the given heads.
const findBuiltPaths: (
  source: string,
  heads: ReadonlyArray<string>,
) => Array<PathShape> = (
  source: string,
  heads: ReadonlyArray<string>,
): Array<PathShape> => {
  const shapes: Array<PathShape> = [];
  const pattern: RegExp = new RegExp(
    `/(${heads.join("|")})((?:/\\$\\{[^}]*\\})+)`,
    "g",
  );

  for (const match of source.matchAll(pattern)) {
    shapes.push({
      head: match[1]!,
      parameters: match[2]!.split("${").length - 1,
    });
  }

  return shapes;
};

const APP_DIR: string = path.join(__dirname, "..", "..", "..");

const readAppFile: (...parts: Array<string>) => string = (
  ...parts: Array<string>
): string => {
  return fs.readFileSync(path.join(APP_DIR, ...parts), "utf8");
};

describe("core SSO routers", () => {
  test("are the seven SSO routers, in mount order", () => {
    expect(
      SSO_ROUTERS.map((entry: SsoRouterEntry): string => {
        return entry.name;
      }),
    ).toEqual(
      PINNED_ROUTES.map((pinned: { name: string }): string => {
        return pinned.name;
      }),
    );
  });

  test.each(PINNED_ROUTES)(
    "$name serves exactly its pinned routes, byte for byte and in order",
    (pinned: { name: string; routes: Array<PinnedRoute> }) => {
      expect(getRoutes(findEntry(pinned.name).router)).toEqual(pinned.routes);
    },
  );

  test("together serve all 20 SSO routes, in mount order", () => {
    const served: Array<PinnedRoute> = SSO_ROUTERS.flatMap(
      (entry: SsoRouterEntry): Array<PinnedRoute> => {
        return getRoutes(entry.router);
      },
    );

    expect(served).toEqual(ALL_PINNED);
    expect(served).toHaveLength(20);
  });

  test("each is a distinct router, and no (method, path) is served twice", () => {
    expect(
      new Set(
        SSO_ROUTERS.map((entry: SsoRouterEntry): ExpressRouter => {
          return entry.router;
        }),
      ).size,
    ).toBe(7);
    expect(
      new Set(
        ALL_PINNED.map((route: PinnedRoute): string => {
          return route.join(" ");
        }),
      ).size,
    ).toBe(ALL_PINNED.length);
  });

  test.each(PINNED_ROUTES)(
    "$name has only routes: no router.use() layer that could run for other routes",
    (pinned: { name: string }) => {
      expect(
        EnterpriseServerModuleShape.findLayersWithoutRoute(
          findEntry(pinned.name).router,
        ),
      ).toEqual([]);
    },
  );

  test.each(
    ALL_PINNED.map((route: PinnedRoute): string => {
      return route.join(" ");
    }),
  )(
    "%s is served by its own handler alone: nothing (no license gate) runs in front of it",
    (label: string) => {
      const [method, routePath] = label.split(" ") as [string, string];
      const layer: RouteLayer | undefined = SSO_ROUTERS.flatMap(
        (entry: SsoRouterEntry): Array<RouteLayer> => {
          return getLayers(entry.router);
        },
      ).find((candidate: RouteLayer): boolean => {
        return (
          candidate.route?.path === routePath &&
          Boolean(candidate.route.methods[method.toLowerCase()])
        );
      });

      expect(layer?.route).toBeDefined();
      expect(layer!.route!.stack).toHaveLength(1);
      expect(typeof layer!.route!.stack[0]!.handle).toBe("function");
    },
  );

  test("the service-provider discovery routes come before the parameter routes that would swallow them", () => {
    const served: Array<string> = ALL_PINNED.map(
      (route: PinnedRoute): string => {
        return route.join(" ");
      },
    );

    expect(
      served.indexOf("GET /global-sso/service-provider-login"),
    ).toBeLessThan(served.indexOf("GET /global-sso/:globalSsoId"));
    expect(
      served.indexOf("GET /global-oidc/service-provider-login"),
    ).toBeLessThan(served.indexOf("GET /global-oidc/:globalOidcId"));
  });

  test("no SSO path is under a SCIM base path (those are the Enterprise Edition's)", () => {
    for (const route of ALL_PINNED) {
      expect(route[1].startsWith("/scim/")).toBe(false);
      expect(route[1].startsWith("/status-page-scim/")).toBe(false);
    }
  });
});

describe("the URLs the product hands out are all served", () => {
  const SIGN_IN_HEADS: ReadonlyArray<string> = [
    "idp-login",
    "oidc-callback",
    "global-idp-login",
    "global-oidc-callback",
    "status-page-idp-login",
    "status-page-oidc-callback",
    "global-sso",
    "global-oidc",
  ];

  /*
   * What the configuration screens tell admins to paste into their identity
   * provider (ACS URL, redirect URI) and the "test sign-in" links they show.
   */
  const SCREENS: Array<{ file: Array<string>; prints: Array<PathShape> }> = [
    {
      file: ["FeatureSet", "Dashboard", "src", "Pages", "Settings", "SSO.tsx"],
      prints: [{ head: "idp-login", parameters: 2 }],
    },
    {
      file: ["FeatureSet", "Dashboard", "src", "Pages", "Settings", "OIDC.tsx"],
      prints: [{ head: "oidc-callback", parameters: 2 }],
    },
    {
      file: [
        "FeatureSet",
        "Dashboard",
        "src",
        "Pages",
        "StatusPages",
        "View",
        "SSO.tsx",
      ],
      prints: [{ head: "status-page-idp-login", parameters: 2 }],
    },
    {
      file: [
        "FeatureSet",
        "Dashboard",
        "src",
        "Pages",
        "StatusPages",
        "View",
        "OIDC.tsx",
      ],
      prints: [{ head: "status-page-oidc-callback", parameters: 2 }],
    },
    {
      file: [
        "FeatureSet",
        "AdminDashboard",
        "src",
        "Pages",
        "Settings",
        "GlobalSSO",
        "View.tsx",
      ],
      prints: [
        { head: "global-idp-login", parameters: 1 },
        { head: "global-sso", parameters: 1 },
      ],
    },
    {
      file: [
        "FeatureSet",
        "AdminDashboard",
        "src",
        "Pages",
        "Settings",
        "GlobalOIDC",
        "View.tsx",
      ],
      prints: [
        { head: "global-oidc-callback", parameters: 1 },
        { head: "global-oidc", parameters: 1 },
      ],
    },
  ];

  test.each(
    SCREENS.map(
      (screen: {
        file: Array<string>;
        prints: Array<PathShape>;
      }): [string, Array<PathShape>] => {
        return [screen.file.join("/"), screen.prints];
      },
    ),
  )(
    "%s prints sign-in URLs that core serves",
    (file: string, prints: Array<PathShape>) => {
      const built: Array<PathShape> = findBuiltPaths(
        readAppFile(...file.split("/")),
        SIGN_IN_HEADS,
      );

      // The screen still prints what it always printed...
      expect(built).toEqual(expect.arrayContaining(prints));

      // ...and every sign-in path it builds is a route core serves.
      for (const shape of built) {
        expect({
          shape,
          served: isServed(shape, "GET") || isServed(shape, "POST"),
        }).toEqual({ shape, served: true });
      }
    },
  );

  /*
   * What the routers themselves hand an identity provider: the ACS URL in a
   * SAML AuthnRequest and the redirect URI of an OIDC authorization request,
   * both built as `${HttpProtocol}${Host}/identity/<path>`.
   */
  test.each([
    ["SSO.ts", { head: "idp-login", parameters: 2 }, "POST"],
    ["OIDC.ts", { head: "oidc-callback", parameters: 2 }, "GET"],
    ["GlobalSSO.ts", { head: "global-idp-login", parameters: 1 }, "POST"],
    ["GlobalOIDC.ts", { head: "global-oidc-callback", parameters: 1 }, "GET"],
    [
      "StatusPageSSO.ts",
      { head: "status-page-idp-login", parameters: 2 },
      "POST",
    ],
    [
      "StatusPageOIDC.ts",
      { head: "status-page-oidc-callback", parameters: 2 },
      "GET",
    ],
  ] as Array<[string, PathShape, string]>)(
    "%s sends identity providers back to a route it serves",
    (file: string, callback: PathShape, method: string) => {
      const source: string = readAppFile("FeatureSet", "Identity", "API", file);
      const identityPaths: Array<PathShape> = [
        ...source.matchAll(/\/identity(\/[^`"'\s]*)/g),
      ].flatMap((match: RegExpMatchArray): Array<PathShape> => {
        return findBuiltPaths(match[1]!, [callback.head]);
      });

      expect(identityPaths).toContainEqual(callback);
      expect(isServed(callback, method)).toBe(true);
    },
  );

  test.each([ProjectSsoKind.SAML, ProjectSsoKind.OIDC])(
    "the %s confirmation email links to a served page, which continues to a served sign-in",
    (kind: ProjectSsoKind) => {
      const ids: {
        kind: ProjectSsoKind;
        projectId: string;
        providerId: string;
      } = {
        kind,
        projectId: "11111111-1111-4111-8111-111111111111",
        providerId: "22222222-2222-4222-8222-222222222222",
      };
      const confirmation: string =
        ProjectSsoSignInConfirmation.getConfirmationRoute(ids).toString();
      const signIn: string =
        ProjectSsoSignInConfirmation.getSignInStartRoute(ids).toString();

      // nginx forwards /identity/ to the identity routers mounted at "/".
      expect(confirmation).toBe(
        `/identity/sso-sign-in-confirmation/${kind}/${ids.projectId}/${ids.providerId}`,
      );
      expect(signIn).toBe(
        `/identity/${kind === ProjectSsoKind.SAML ? "sso" : "oidc"}/${ids.projectId}/${ids.providerId}`,
      );

      expect(ALL_PINNED).toContainEqual([
        "GET",
        "/sso-sign-in-confirmation/:kind/:projectId/:providerId",
      ]);
      expect(ALL_PINNED).toContainEqual([
        "POST",
        "/sso-sign-in-confirmation/:kind/:projectId/:providerId",
      ]);
      expect(ALL_PINNED).toContainEqual(
        kind === ProjectSsoKind.SAML
          ? ["GET", "/sso/:projectId/:projectSsoId"]
          : ["GET", "/oidc/:projectId/:projectOidcId"],
      );
    },
  );
});

describe("the Identity feature set mounts the SSO routers", () => {
  type MountRecord = { paths: unknown; router: unknown };

  const mounted: Array<MountRecord> = [];

  const EE_SCIM_ROUTER: { eeRouter: string } = { eeRouter: "scim" };

  beforeEach(() => {
    mounted.length = 0;
    setTestBillingEnabled(false);
    uninstallEnterpriseModule();

    jest.spyOn(Express, "getExpressApp").mockReturnValue({
      use: (paths: unknown, router: unknown): void => {
        mounted.push({ paths, router });
      },
    } as unknown as ExpressApplication);
  });

  afterEach(() => {
    uninstallEnterpriseModule();
    setTestBillingEnabled(false);
    jest.restoreAllMocks();
  });

  const IDENTITY_PREFIXES: Array<string> = ["/api/identity", "/"];

  const SSO_MOUNTS: () => Array<MountRecord> = (): Array<MountRecord> => {
    return SSO_ROUTERS.map((entry: SsoRouterEntry): MountRecord => {
      return { paths: IDENTITY_PREFIXES, router: entry.router };
    });
  };

  test.each(
    createEditionStateCases().map(
      (state: EditionStateCase): [string, EditionStateCase] => {
        return [state.label, state];
      },
    ),
  )(
    "at /api/identity and /, after authentication and reseller, before ee's routers and status page authentication (%s)",
    async (_label: string, state: EditionStateCase) => {
      const fake: FakeEnterpriseModule | null = state.apply();

      if (fake) {
        fake.identityRouters = [EE_SCIM_ROUTER as unknown as ExpressRouter];
      }

      await IdentityFeatureSet.init();

      expect(mounted).toEqual([
        { paths: IDENTITY_PREFIXES, router: { coreRouter: "authentication" } },
        { paths: IDENTITY_PREFIXES, router: { coreRouter: "reseller" } },
        ...SSO_MOUNTS(),
        ...(state.isLoaded
          ? [{ paths: IDENTITY_PREFIXES, router: EE_SCIM_ROUTER }]
          : []),
        {
          paths: ["/api/identity/status-page", "/status-page"],
          router: { coreRouter: "status-page" },
        },
      ]);

      // The very same router instances, not copies.
      SSO_ROUTERS.forEach((entry: SsoRouterEntry, index: number): void => {
        expect(mounted[2 + index]!.router).toBe(entry.router);
      });
    },
  );

  test("the Community Edition mounts the SSO routers and nothing from ee/", async () => {
    await IdentityFeatureSet.init();

    expect(
      mounted.map((record: MountRecord): unknown => {
        return record.router;
      }),
    ).toEqual([
      { coreRouter: "authentication" },
      { coreRouter: "reseller" },
      ...SSO_ROUTERS.map((entry: SsoRouterEntry): ExpressRouter => {
        return entry.router;
      }),
      { coreRouter: "status-page" },
    ]);
  });
});
