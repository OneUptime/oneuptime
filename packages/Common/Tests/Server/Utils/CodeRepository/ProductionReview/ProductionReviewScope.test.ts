import ProductionReviewScope, {
  findRumApplicationsOfRepository,
  ProductionReviewRumApplication,
  ProductionReviewScopeResult,
  RumApplicationFacts,
  SERVER_ONLY_EXTENSIONS,
} from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewScope";
import { readChangedCode } from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewDiff";
import CodeAgentTelemetryScope, {
  CodeAgentScopedService,
  RepositoryServicesGap,
} from "../../../../../Server/Utils/AI/CodeFix/CodeAgentTelemetryScope";
import { ResolvableRepository } from "../../../../../Server/Utils/CodeRepository/StackTraceRepoResolver";
import CodeRepositoryService from "../../../../../Server/Services/CodeRepositoryService";
import RumApplicationService from "../../../../../Server/Services/RumApplicationService";
import RumApplication from "../../../../../Models/DatabaseModels/RumApplication";
import ObjectID from "../../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * What of production a pull request's review may read: the services its
 * repository serves - worked out by the same resolver that scopes the code
 * agent's production tools, never more - and, among them, the services the
 * change touches, by where each service's code lives in the repository.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5d6e7f80-1111-4222-8333-444455556666",
);
const REPOSITORY_ID: ObjectID = new ObjectID(
  "5d6e7f80-2222-4222-8333-444455556666",
);

function service(
  id: string,
  pathInRepository: string | null,
): CodeAgentScopedService {
  return {
    id,
    name: `service-${id}`,
    method: pathInRepository ? "stack-trace" : "name-match",
    evidence: "",
    pathInRepository,
  };
}

const BILLING: CodeAgentScopedService = service("billing", "services/billing");
const CHECKOUT: CodeAgentScopedService = service(
  "checkout",
  "services/checkout",
);
const CHECKOUT_API: CodeAgentScopedService = service(
  "checkout-api",
  "services/checkout/api",
);
const MONOLITH: CodeAgentScopedService = service("monolith", null);

function changedFiles(
  ...paths: Array<string>
): ReturnType<typeof readChangedCode> {
  return readChangedCode({
    files: paths.map((path: string) => {
      return { filename: path, status: "modified", patch: null };
    }),
  });
}

describe("ProductionReviewScope.getTouchedServices", () => {
  test("a change under a service's path is that service's", () => {
    expect(
      ProductionReviewScope.getTouchedServices({
        services: [BILLING, CHECKOUT, MONOLITH],
        changed: changedFiles("services/billing/src/charge.ts"),
      }),
    ).toEqual([BILLING]);
  });

  test("the deepest path holding a file wins", () => {
    expect(
      ProductionReviewScope.getTouchedServices({
        services: [CHECKOUT, CHECKOUT_API],
        changed: changedFiles("services/checkout/api/routes.ts"),
      }),
    ).toEqual([CHECKOUT_API]);
  });

  test("a change under no known path belongs to the services whose path is not known", () => {
    expect(
      ProductionReviewScope.getTouchedServices({
        services: [BILLING, MONOLITH],
        changed: changedFiles("libs/shared/money.ts"),
      }),
    ).toEqual([MONOLITH]);
  });

  test("a path is a whole segment: services/billing-v2 is not services/billing", () => {
    expect(
      ProductionReviewScope.getTouchedServices({
        services: [BILLING],
        changed: changedFiles("services/billing-v2/src/a.ts"),
      }),
    ).toEqual([]);
  });

  test("a renamed file belongs where it came from too", () => {
    const changed: ReturnType<typeof readChangedCode> = readChangedCode({
      files: [
        {
          filename: "libs/moved/charge.ts",
          previousFilename: "services/billing/src/charge.ts",
          status: "renamed",
          patch: null,
        },
      ],
    });

    expect(
      ProductionReviewScope.getTouchedServices({
        services: [BILLING],
        changed,
      }),
    ).toEqual([BILLING]);
  });

  test("the most touched service comes first", () => {
    expect(
      ProductionReviewScope.getTouchedServices({
        services: [BILLING, CHECKOUT],
        changed: changedFiles(
          "services/billing/a.ts",
          "services/checkout/a.ts",
          "services/checkout/b.ts",
        ),
      }),
    ).toEqual([CHECKOUT, BILLING]);
  });
});

describe("ProductionReviewScope.get", () => {
  beforeEach(() => {
    ProductionReviewScope.clearCache();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    ProductionReviewScope.clearCache();
  });

  test("asks the code agent's scope for the repository's services, with no run's subject", async () => {
    const find: jest.SpyInstance = jest
      .spyOn(CodeAgentTelemetryScope, "findRepositoryServices")
      .mockResolvedValue({
        repository: {
          id: REPOSITORY_ID.toString(),
          name: "checkout",
          organizationName: "acme",
          repositoryName: "checkout",
          mainBranchName: "main",
          gitHubAppInstallationId: "42",
        },
        services: [BILLING],
        gap: null,
      });

    const scope: ProductionReviewScopeResult = await ProductionReviewScope.get({
      projectId: PROJECT_ID,
      codeRepositoryId: REPOSITORY_ID,
    });

    expect(scope.services).toEqual([BILLING]);
    expect(scope.gap).toBeNull();
    expect(find).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      codeRepositoryId: REPOSITORY_ID,
    });
  });

  test("is worked out once for a while, per repository", async () => {
    const find: jest.SpyInstance = jest
      .spyOn(CodeAgentTelemetryScope, "findRepositoryServices")
      .mockResolvedValue({
        repository: null,
        services: [],
        gap: RepositoryServicesGap.RepositoryNotConnected,
      });

    await ProductionReviewScope.get({
      projectId: PROJECT_ID,
      codeRepositoryId: REPOSITORY_ID,
    });
    const again: ProductionReviewScopeResult = await ProductionReviewScope.get({
      projectId: PROJECT_ID,
      codeRepositoryId: REPOSITORY_ID,
    });

    expect(find).toHaveBeenCalledTimes(1);
    expect(again.gap).toBe(RepositoryServicesGap.RepositoryNotConnected);

    await ProductionReviewScope.get({
      projectId: PROJECT_ID,
      codeRepositoryId: new ObjectID("5d6e7f80-3333-4222-8333-444455556666"),
    });

    expect(find).toHaveBeenCalledTimes(2);
  });
});

/*
 * THE RUM APPLICATIONS A REPOSITORY IS THE FRONT END OF (#11395): an
 * application whose App Identifier - the service.name its browser or
 * mobile SDK sends - names a service the repository serves, or the
 * repository itself, or every one when the repository is the project's
 * only one; and, of them, those whose front end a changed file may be. A
 * file is a back end's only when it surely is.
 */
describe("the RUM applications a repository is the front end of (#11395)", () => {
  function repository(
    id: string,
    repositoryName: string,
  ): ResolvableRepository {
    return {
      id,
      name: repositoryName,
      organizationName: "acme",
      repositoryName,
      mainBranchName: "main",
      gitHubAppInstallationId: "42",
    };
  }

  const WEB: ResolvableRepository = repository(
    "5d6e7f80-2222-4222-8333-444455556666",
    "storefront-web",
  );
  const API: ResolvableRepository = repository(
    "5d6e7f80-3333-4222-8333-444455556666",
    "checkout-api",
  );

  function application(
    id: string,
    appIdentifier: string,
    name: string = appIdentifier,
  ): RumApplicationFacts {
    return { id, name, appIdentifier };
  }

  const STOREFRONT: RumApplicationFacts = application(
    "7C8D9E0F-1A2B-4C3D-8E4F-5A6B7C8D9E0F",
    "storefront-web",
    "Storefront",
  );
  const BACKOFFICE: RumApplicationFacts = application(
    "7c8d9e0f-1a2b-4c3d-8e4f-000000000002",
    "backoffice-ui",
  );

  describe("findRumApplicationsOfRepository", () => {
    test("an App Identifier that names the repository: the repository is its front end, its folder not known", async () => {
      expect(
        await findRumApplicationsOfRepository({
          codeRepositoryId: WEB.id,
          repositories: [WEB, API],
          applications: [STOREFRONT, BACKOFFICE],
          services: [],
        }),
      ).toEqual([
        {
          id: STOREFRONT.id.toLowerCase(),
          name: "Storefront",
          pathInRepository: null,
        },
      ]);
    });

    test("another repository's application is not this one's", async () => {
      expect(
        await findRumApplicationsOfRepository({
          codeRepositoryId: API.id,
          repositories: [WEB, API],
          applications: [STOREFRONT],
          services: [],
        }),
      ).toEqual([]);
    });

    test("an App Identifier that names a service the repository serves: its folder is the service's", async () => {
      const sourceMaps: CodeAgentScopedService = {
        ...service("storefront-web-service", "apps/storefront"),
        name: "Storefront-Web",
      };

      expect(
        await findRumApplicationsOfRepository({
          codeRepositoryId: API.id,
          repositories: [WEB, API],
          applications: [STOREFRONT],
          services: [BILLING, sourceMaps],
        }),
      ).toEqual([
        {
          id: STOREFRONT.id.toLowerCase(),
          name: "Storefront",
          pathInRepository: "apps/storefront",
        },
      ]);
    });

    test("the project's only repository is every application's front end", async () => {
      expect(
        (
          await findRumApplicationsOfRepository({
            codeRepositoryId: API.id,
            repositories: [API],
            applications: [STOREFRONT, BACKOFFICE],
            services: [],
          })
        ).map((each: ProductionReviewRumApplication): string => {
          return each.id;
        }),
      ).toEqual([STOREFRONT.id.toLowerCase(), BACKOFFICE.id]);
    });

    test("an App Identifier that names no repository exactly, of several, names none", async () => {
      expect(
        await findRumApplicationsOfRepository({
          codeRepositoryId: WEB.id,
          repositories: [WEB, API],
          applications: [
            application("7c8d9e0f-0000-4000-8000-000000000003", "storefront"),
          ],
          services: [],
        }),
      ).toEqual([]);
    });

    test("with no App Identifier, its name is what the repository is named like", async () => {
      expect(
        await findRumApplicationsOfRepository({
          codeRepositoryId: WEB.id,
          repositories: [WEB, API],
          applications: [
            application(
              "7c8d9e0f-0000-4000-8000-000000000004",
              "",
              "Storefront Web",
            ),
          ],
          services: [],
        }),
      ).toEqual([
        {
          id: "7c8d9e0f-0000-4000-8000-000000000004",
          name: "Storefront Web",
          pathInRepository: null,
        },
      ]);
    });

    test("each application once, its name one line", async () => {
      const found: Array<ProductionReviewRumApplication> =
        await findRumApplicationsOfRepository({
          codeRepositoryId: WEB.id,
          repositories: [WEB],
          applications: [{ ...STOREFRONT, name: "Store\nfront" }, STOREFRONT],
          services: [],
        });

      expect(found).toHaveLength(1);
      expect(found[0]!.name).toBe("Store front");
    });
  });

  describe("ProductionReviewScope.getFrontEndApplications", () => {
    const UNPLACED: ProductionReviewRumApplication = {
      id: "app-unplaced",
      name: "storefront-web",
      pathInRepository: null,
    };
    const PLACED: ProductionReviewRumApplication = {
      id: "app-placed",
      name: "backoffice-ui",
      pathInRepository: "apps/backoffice",
    };
    const DEEPER: ProductionReviewRumApplication = {
      id: "app-deeper",
      name: "backoffice-admin",
      pathInRepository: "apps/backoffice/admin",
    };

    test("a file under an application's known folder is that application's, the deepest folder first", () => {
      expect(
        ProductionReviewScope.getFrontEndApplications({
          path: "apps/backoffice/src/login.ts",
          applications: [UNPLACED, PLACED, DEEPER],
        }),
      ).toEqual([PLACED]);
      expect(
        ProductionReviewScope.getFrontEndApplications({
          path: "apps/backoffice/admin/users.tsx",
          applications: [UNPLACED, PLACED, DEEPER],
        }),
      ).toEqual([DEEPER]);
    });

    test("a file under no known folder may be each application's whose folder is not known: never guessed away", () => {
      expect(
        ProductionReviewScope.getFrontEndApplications({
          path: "src/checkout/payment.js",
          applications: [UNPLACED, PLACED],
        }),
      ).toEqual([UNPLACED]);
      expect(
        ProductionReviewScope.getFrontEndApplications({
          path: "src/checkout/payment.js",
          applications: [PLACED],
        }),
      ).toEqual([]);
    });

    test("a folder is a whole segment: apps/backoffice-v2 is not apps/backoffice", () => {
      expect(
        ProductionReviewScope.getFrontEndApplications({
          path: "apps/backoffice-v2/src/a.ts",
          applications: [PLACED],
        }),
      ).toEqual([]);
    });

    test.each([
      "py",
      "rb",
      "php",
      "go",
      "ex",
      "exs",
      "erl",
      "pl",
      "jl",
      "hs",
      "clj",
      "groovy",
    ])(
      "a .%s file only a server runs is no front end's, whatever its folder",
      (extension: string) => {
        expect(SERVER_ONLY_EXTENSIONS.has(extension)).toBe(true);
        expect(
          ProductionReviewScope.getFrontEndApplications({
            path: `apps/backoffice/server/app.${extension}`,
            applications: [UNPLACED, PLACED],
          }),
        ).toEqual([]);
        expect(
          ProductionReviewScope.mayBeFrontEnd(
            `apps/backoffice/server/app.${extension}`,
          ),
        ).toBe(false);
      },
    );

    test.each([
      "web/src/session.ts",
      "web/src/Session.tsx",
      "web/src/session.js",
      "web/src/App.vue",
      "web/src/Session.svelte",
      "ios/Session.swift",
      "android/app/src/main/java/Session.kt",
      "android/app/src/main/java/Session.java",
      "ios/Session.m",
      "mobile/lib/session.dart",
      "maui/Session.cs",
      "WEB/SRC/SESSION.TS",
    ])("%s may be a browser's or a mobile app's code", (path: string) => {
      expect(ProductionReviewScope.mayBeFrontEnd(path)).toBe(true);
      expect(
        ProductionReviewScope.getFrontEndApplications({
          path,
          applications: [UNPLACED],
        }),
      ).toEqual([UNPLACED]);
    });

    test("a server's language is told by its extension in any letter case", () => {
      expect(ProductionReviewScope.mayBeFrontEnd("api/app.PY")).toBe(false);
    });
  });

  describe("ProductionReviewScope.getRumApplications", () => {
    let applicationReads: jest.SpyInstance;
    let repositoryReads: jest.SpyInstance;

    function row(facts: RumApplicationFacts): RumApplication {
      const made: RumApplication = new RumApplication();

      made.id = new ObjectID(facts.id);
      made.name = facts.name;
      made.appIdentifier = facts.appIdentifier;

      return made;
    }

    beforeEach(() => {
      ProductionReviewScope.clearCache();
      applicationReads = jest
        .spyOn(RumApplicationService, "findBy")
        .mockResolvedValue([row(STOREFRONT), row(BACKOFFICE)]);
      repositoryReads = jest
        .spyOn(CodeRepositoryService, "getResolvableRepositories")
        .mockResolvedValue([WEB, API]);
    });

    afterEach(() => {
      jest.restoreAllMocks();
      ProductionReviewScope.clearCache();
    });

    test("reads the project's applications as OneUptime, and keeps those the repository is the front end of", async () => {
      const found: Array<ProductionReviewRumApplication> =
        await ProductionReviewScope.getRumApplications({
          projectId: PROJECT_ID,
          codeRepositoryId: new ObjectID(WEB.id),
          services: [],
        });

      expect(found).toEqual([
        {
          id: STOREFRONT.id.toLowerCase(),
          name: "Storefront",
          pathInRepository: null,
        },
      ]);
      expect(applicationReads.mock.calls[0]![0]).toMatchObject({
        query: { projectId: PROJECT_ID },
        select: { _id: true, name: true, appIdentifier: true },
        props: { isRoot: true },
      });
      expect(repositoryReads).toHaveBeenCalledWith(PROJECT_ID);
    });

    test("is worked out once for a while, per repository", async () => {
      for (let index: number = 0; index < 3; index++) {
        await ProductionReviewScope.getRumApplications({
          projectId: PROJECT_ID,
          codeRepositoryId: new ObjectID(WEB.id),
          services: [],
        });
      }

      expect(applicationReads).toHaveBeenCalledTimes(1);

      await ProductionReviewScope.getRumApplications({
        projectId: PROJECT_ID,
        codeRepositoryId: new ObjectID(API.id),
        services: [],
      });

      expect(applicationReads).toHaveBeenCalledTimes(2);
    });

    test("a project with no RUM application reads no repository", async () => {
      applicationReads.mockResolvedValue([]);

      expect(
        await ProductionReviewScope.getRumApplications({
          projectId: PROJECT_ID,
          codeRepositoryId: new ObjectID(WEB.id),
          services: [],
        }),
      ).toEqual([]);
      expect(repositoryReads).not.toHaveBeenCalled();
    });

    test("never fails: none when they cannot be read, and asked again on the next review", async () => {
      applicationReads.mockRejectedValueOnce(new Error("Postgres is away"));

      expect(
        await ProductionReviewScope.getRumApplications({
          projectId: PROJECT_ID,
          codeRepositoryId: new ObjectID(WEB.id),
          services: [],
        }),
      ).toEqual([]);
      expect(
        await ProductionReviewScope.getRumApplications({
          projectId: PROJECT_ID,
          codeRepositoryId: new ObjectID(WEB.id),
          services: [],
        }),
      ).toHaveLength(1);
      expect(applicationReads).toHaveBeenCalledTimes(2);
    });
  });
});
