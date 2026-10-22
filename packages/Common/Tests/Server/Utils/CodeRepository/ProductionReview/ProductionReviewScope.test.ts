import ProductionReviewScope, {
  ProductionReviewScopeResult,
} from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewScope";
import { readChangedCode } from "../../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewDiff";
import CodeAgentTelemetryScope, {
  CodeAgentScopedService,
  RepositoryServicesGap,
} from "../../../../../Server/Utils/AI/CodeFix/CodeAgentTelemetryScope";
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
