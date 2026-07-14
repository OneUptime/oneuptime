import {
  RepoResolution,
  ResolvableRepository,
  extractCandidatePathsFromStackTrace,
  resolveRepositoryForExceptionFix,
} from "../../../Server/Utils/CodeRepository/StackTraceRepoResolver";
import { describe, expect, test } from "@jest/globals";

/*
 * The stack-trace repo resolver replaces the manual service → repository
 * mapping table for the AI exception-fix pipeline. It must be deterministic
 * and explainable: stack-trace suffix matching first (never guessing on
 * ambiguity), then exact name match, then the only connected repository.
 */

function repo(
  id: string,
  repositoryName: string,
  data?: { name?: string; organizationName?: string },
): ResolvableRepository {
  return {
    id,
    name: data?.name || repositoryName,
    repositoryName,
    organizationName: data?.organizationName || "acme",
    mainBranchName: "master",
    gitHubAppInstallationId: null,
  };
}

type GetTreePathsFunction = (
  repository: ResolvableRepository,
) => Promise<Array<string>>;

// Tree fetcher backed by a plain map — throws for repos with no entry.
function treesByRepoId(trees: {
  [repoId: string]: Array<string>;
}): GetTreePathsFunction {
  return (repository: ResolvableRepository): Promise<Array<string>> => {
    const paths: Array<string> | undefined = trees[repository.id];

    if (!paths) {
      return Promise.reject(
        new Error(`Tree fetch failed for ${repository.id}`),
      );
    }

    return Promise.resolve(paths);
  };
}

describe("extractCandidatePathsFromStackTrace", () => {
  test("parses Node frames with and without a function name", () => {
    const stackTrace: string = [
      "Error: boom",
      "    at charge (/app/src/billing/charge.ts:10:5)",
      "    at /app/src/server.js:5:1",
      "    at processTicksAndRejections (node:internal/process/task_queues:95:5)",
    ].join("\n");

    expect(extractCandidatePathsFromStackTrace(stackTrace)).toEqual([
      "src/billing/charge.ts",
      "src/server.js",
    ]);
  });

  test("parses Python traceback frames", () => {
    const stackTrace: string = [
      "Traceback (most recent call last):",
      '  File "/usr/src/app/billing/tasks.py", line 12, in charge',
      '    raise ValueError("boom")',
      "ValueError: boom",
    ].join("\n");

    expect(extractCandidatePathsFromStackTrace(stackTrace)).toEqual([
      "billing/tasks.py",
    ]);
  });

  test("parses Java frames as basenames only", () => {
    const stackTrace: string = [
      "java.lang.NullPointerException: boom",
      "\tat com.acme.billing.Charge.run(Charge.java:42)",
      "\tat java.base/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1128)",
    ].join("\n");

    expect(extractCandidatePathsFromStackTrace(stackTrace)).toEqual([
      "Charge.java",
      "ThreadPoolExecutor.java",
    ]);
  });

  test("parses Ruby frames and skips gem frames", () => {
    const stackTrace: string = [
      "worker.rb:10:in `perform': boom (RuntimeError)",
      "\tfrom /app/lib/worker.rb:10:in `perform'",
      "\tfrom /usr/local/bundle/gems/sidekiq-7.0.0/lib/sidekiq/processor.rb:15:in `process'",
    ].join("\n");

    expect(extractCandidatePathsFromStackTrace(stackTrace)).toEqual([
      "worker.rb",
      "lib/worker.rb",
    ]);
  });

  test("parses Go frames", () => {
    const stackTrace: string = [
      "goroutine 1 [running]:",
      "main.charge(...)",
      "\t/app/pkg/pay/charge.go:88 +0x1b",
      "main.main()",
      "\t/app/cmd/api/main.go:12 +0x20",
    ].join("\n");

    expect(extractCandidatePathsFromStackTrace(stackTrace)).toEqual([
      "pkg/pay/charge.go",
      "cmd/api/main.go",
    ]);
  });

  test("strips container prefixes and Windows drive letters", () => {
    const stackTrace: string = [
      '  File "/var/task/handler.py", line 3, in run',
      "    at run (/home/deploy/current/src/x.ts:1:1)",
      "    at boot (C:\\app\\src\\billing\\charge.ts:10:5)",
    ].join("\n");

    expect(extractCandidatePathsFromStackTrace(stackTrace)).toEqual([
      "handler.py",
      "current/src/x.ts",
      "src/billing/charge.ts",
    ]);
  });

  test("skips dependency frames across ecosystems", () => {
    const stackTrace: string = [
      "    at handle (/app/node_modules/express/lib/router/index.js:284:7)",
      '  File "/usr/lib/python3/dist-packages/foo/bar.py", line 3, in x',
      '  File "/app/.venv/lib/python3.11/site-packages/django/core/handlers.py", line 1, in y',
      "\tfrom /srv/gems/rails-7.0.0/lib/rails.rb:1:in `boot'",
      "\t/go/src/project/vendor/github.com/pkg/errors/errors.go:12 +0x1b",
    ].join("\n");

    expect(extractCandidatePathsFromStackTrace(stackTrace)).toEqual([]);
  });

  test("de-dupes preserving first-seen order and caps at 10 paths", () => {
    const lines: Array<string> = ["Error: boom"];

    for (let i: number = 0; i < 15; i++) {
      lines.push(`    at fn (/app/src/file${i}.ts:1:1)`);
      // Duplicate of the very first frame, must not repeat or displace order.
      lines.push("    at fn (/app/src/file0.ts:9:9)");
    }

    const candidates: Array<string> = extractCandidatePathsFromStackTrace(
      lines.join("\n"),
    );

    expect(candidates).toHaveLength(10);
    expect(candidates[0]).toBe("src/file0.ts");
    expect(candidates[9]).toBe("src/file9.ts");
    expect(new Set(candidates).size).toBe(10);
  });
});

describe("resolveRepositoryForExceptionFix", () => {
  const nodeStack: string = [
    "Error: boom",
    "    at charge (/app/src/billing/charge.ts:10:5)",
  ].join("\n");

  test("strong suffix match (>= 2 segments) picks the right repository", async () => {
    const resolution: RepoResolution | null =
      await resolveRepositoryForExceptionFix({
        stackTrace: nodeStack,
        serviceName: null,
        repositories: [repo("r1", "checkout"), repo("r2", "infra")],
        getTreePaths: treesByRepoId({
          r1: ["src/billing/charge.ts", "src/server.ts", "README.md"],
          r2: ["main.tf", "modules/vpc/main.tf"],
        }),
      });

    expect(resolution).not.toBeNull();
    expect(resolution!.method).toBe("stack-trace");
    expect(resolution!.codeRepositoryId).toBe("r1");
    expect(resolution!.organizationName).toBe("acme");
    expect(resolution!.repositoryName).toBe("checkout");
    expect(resolution!.servicePathInRepository).toBeNull();
    expect(resolution!.evidence).toBe(
      "Matched src/billing/charge.ts in acme/checkout",
    );
  });

  test("derives servicePathInRepository for a monorepo subdirectory", async () => {
    const resolution: RepoResolution | null =
      await resolveRepositoryForExceptionFix({
        stackTrace: nodeStack,
        serviceName: null,
        repositories: [repo("r1", "platform"), repo("r2", "infra")],
        getTreePaths: treesByRepoId({
          r1: [
            "services/checkout/src/billing/charge.ts",
            "services/billing/src/invoice.ts",
          ],
          r2: ["main.tf"],
        }),
      });

    expect(resolution).not.toBeNull();
    expect(resolution!.codeRepositoryId).toBe("r1");
    expect(resolution!.method).toBe("stack-trace");
    expect(resolution!.servicePathInRepository).toBe("services/checkout");
  });

  test("disagreeing prefixes fall back to the deepest common prefix", async () => {
    const stackTrace: string = [
      "Error: boom",
      "    at charge (/app/src/billing/charge.ts:10:5)",
      "    at notify (/app/lib/notify.ts:2:2)",
    ].join("\n");

    const resolution: RepoResolution | null =
      await resolveRepositoryForExceptionFix({
        stackTrace,
        serviceName: null,
        repositories: [repo("r1", "platform"), repo("r2", "infra")],
        getTreePaths: treesByRepoId({
          r1: [
            "services/checkout/src/billing/charge.ts",
            "services/billing/lib/notify.ts",
          ],
          r2: ["main.tf"],
        }),
      });

    expect(resolution).not.toBeNull();
    expect(resolution!.codeRepositoryId).toBe("r1");
    expect(resolution!.servicePathInRepository).toBe("services");
  });

  test("a root-level match and a nested match share no prefix", async () => {
    const stackTrace: string = [
      "Error: boom",
      "    at charge (/app/src/billing/charge.ts:10:5)",
      "    at notify (/app/lib/notify.ts:2:2)",
    ].join("\n");

    const resolution: RepoResolution | null =
      await resolveRepositoryForExceptionFix({
        stackTrace,
        serviceName: null,
        repositories: [repo("r1", "platform"), repo("r2", "infra")],
        getTreePaths: treesByRepoId({
          r1: ["src/billing/charge.ts", "services/notifications/lib/notify.ts"],
          r2: ["main.tf"],
        }),
      });

    expect(resolution).not.toBeNull();
    expect(resolution!.codeRepositoryId).toBe("r1");
    expect(resolution!.servicePathInRepository).toBeNull();
  });

  test("basename-only match counts when unique across and within repos", async () => {
    const javaStack: string = [
      "java.lang.NullPointerException: boom",
      "\tat com.acme.billing.Charge.run(Charge.java:42)",
    ].join("\n");

    const resolution: RepoResolution | null =
      await resolveRepositoryForExceptionFix({
        stackTrace: javaStack,
        serviceName: null,
        repositories: [repo("r1", "billing-java"), repo("r2", "infra")],
        getTreePaths: treesByRepoId({
          r1: ["src/main/java/com/acme/Charge.java", "pom.xml"],
          r2: ["main.tf"],
        }),
      });

    expect(resolution).not.toBeNull();
    expect(resolution!.method).toBe("stack-trace");
    expect(resolution!.codeRepositoryId).toBe("r1");
    expect(resolution!.servicePathInRepository).toBe("src/main/java/com/acme");
    expect(resolution!.evidence).toBe(
      "Matched Charge.java in acme/billing-java",
    );
  });

  test("basename present in two repositories never matches", async () => {
    const resolution: RepoResolution | null =
      await resolveRepositoryForExceptionFix({
        stackTrace: "    at fn (charge.ts:10:5)",
        serviceName: null,
        repositories: [repo("r1", "checkout"), repo("r2", "billing")],
        getTreePaths: treesByRepoId({
          r1: ["src/charge.ts"],
          r2: ["lib/charge.ts"],
        }),
      });

    expect(resolution).toBeNull();
  });

  test("basename occurring twice within one repository never matches", async () => {
    const resolution: RepoResolution | null =
      await resolveRepositoryForExceptionFix({
        stackTrace: "    at fn (charge.ts:10:5)",
        serviceName: null,
        repositories: [repo("r1", "checkout"), repo("r2", "infra")],
        getTreePaths: treesByRepoId({
          r1: ["src/charge.ts", "legacy/charge.ts"],
          r2: ["main.tf"],
        }),
      });

    expect(resolution).toBeNull();
  });

  test("more matched candidate paths beat fewer", async () => {
    const stackTrace: string = [
      "Error: boom",
      "    at a (/app/src/a.ts:1:1)",
      "    at b (/app/lib/b.ts:2:2)",
    ].join("\n");

    const resolution: RepoResolution | null =
      await resolveRepositoryForExceptionFix({
        stackTrace,
        serviceName: null,
        repositories: [repo("r1", "full"), repo("r2", "partial")],
        getTreePaths: treesByRepoId({
          r1: ["src/a.ts", "lib/b.ts"],
          r2: ["src/a.ts"],
        }),
      });

    expect(resolution).not.toBeNull();
    expect(resolution!.codeRepositoryId).toBe("r1");
    expect(resolution!.method).toBe("stack-trace");
  });

  test("deeper matched suffixes break a matched-count tie", async () => {
    const resolution: RepoResolution | null =
      await resolveRepositoryForExceptionFix({
        stackTrace: nodeStack, // candidate: src/billing/charge.ts
        serviceName: null,
        repositories: [repo("r1", "deep"), repo("r2", "shallow")],
        getTreePaths: treesByRepoId({
          // Full 3-segment suffix.
          r1: ["services/x/src/billing/charge.ts"],
          // Only billing/charge.ts (2 segments) matches here.
          r2: ["legacy/billing/charge.ts"],
        }),
      });

    expect(resolution).not.toBeNull();
    expect(resolution!.codeRepositoryId).toBe("r1");
  });

  test("a tie between repositories falls through instead of guessing", async () => {
    const resolution: RepoResolution | null =
      await resolveRepositoryForExceptionFix({
        stackTrace: nodeStack,
        serviceName: "Checkout Service",
        repositories: [
          repo("r1", "checkout-service"),
          repo("r2", "checkout-fork"),
        ],
        getTreePaths: treesByRepoId({
          r1: ["src/billing/charge.ts"],
          r2: ["src/billing/charge.ts"],
        }),
      });

    // Stack-trace method must refuse; exact name match resolves instead.
    expect(resolution).not.toBeNull();
    expect(resolution!.method).toBe("name-match");
    expect(resolution!.codeRepositoryId).toBe("r1");
    expect(resolution!.servicePathInRepository).toBeNull();
    expect(resolution!.evidence).toContain("checkout-service");
  });

  test("a repository whose tree fetch throws is skipped, others still tried", async () => {
    const resolution: RepoResolution | null =
      await resolveRepositoryForExceptionFix({
        stackTrace: nodeStack,
        serviceName: null,
        repositories: [repo("r1", "broken"), repo("r2", "checkout")],
        // r1 has no tree entry, so its fetch rejects.
        getTreePaths: treesByRepoId({
          r2: ["src/billing/charge.ts"],
        }),
      });

    expect(resolution).not.toBeNull();
    expect(resolution!.method).toBe("stack-trace");
    expect(resolution!.codeRepositoryId).toBe("r2");
  });

  test("getTreePaths is called at most once per repository", async () => {
    const callCounts: { [repoId: string]: number } = {};

    const stackTrace: string = [
      "Error: boom",
      "    at a (/app/src/a.ts:1:1)",
      "    at b (/app/lib/b.ts:2:2)",
    ].join("\n");

    await resolveRepositoryForExceptionFix({
      stackTrace,
      serviceName: null,
      repositories: [repo("r1", "checkout"), repo("r2", "infra")],
      getTreePaths: (
        repository: ResolvableRepository,
      ): Promise<Array<string>> => {
        callCounts[repository.id] = (callCounts[repository.id] || 0) + 1;
        return Promise.resolve(["src/a.ts", "lib/b.ts"]);
      },
    });

    expect(callCounts["r1"]).toBe(1);
    expect(callCounts["r2"]).toBe(1);
  });

  test("no candidate paths means no tree fetches at all", async () => {
    let fetchCount: number = 0;

    const resolution: RepoResolution | null =
      await resolveRepositoryForExceptionFix({
        stackTrace: "Error: boom", // no frames
        serviceName: null,
        repositories: [repo("r1", "checkout")],
        getTreePaths: (): Promise<Array<string>> => {
          fetchCount++;
          return Promise.resolve([]);
        },
      });

    expect(fetchCount).toBe(0);
    expect(resolution).not.toBeNull();
    expect(resolution!.method).toBe("only-repository");
  });

  test("name-match fallback accepts only an exact (score 3) match", async () => {
    const resolution: RepoResolution | null =
      await resolveRepositoryForExceptionFix({
        stackTrace: null,
        serviceName: "Checkout Service",
        repositories: [repo("r1", "checkout-service"), repo("r2", "infra")],
        getTreePaths: treesByRepoId({}),
      });

    expect(resolution).not.toBeNull();
    expect(resolution!.method).toBe("name-match");
    expect(resolution!.codeRepositoryId).toBe("r1");
    expect(resolution!.servicePathInRepository).toBeNull();
    expect(resolution!.evidence).toBe(
      'Service name matches the repository name "checkout-service"',
    );
  });

  test("a containment-only (score 2) name match is rejected", async () => {
    const resolution: RepoResolution | null =
      await resolveRepositoryForExceptionFix({
        stackTrace: null,
        serviceName: "billing",
        repositories: [
          repo("r1", "acme-billing-monorepo"),
          repo("r2", "infra"),
        ],
        getTreePaths: treesByRepoId({}),
      });

    expect(resolution).toBeNull();
  });

  test("two exact name matches are ambiguous and rejected", async () => {
    const resolution: RepoResolution | null =
      await resolveRepositoryForExceptionFix({
        stackTrace: null,
        serviceName: "Checkout Service",
        repositories: [
          repo("r1", "checkout-service"),
          repo("r2", "CheckoutService"),
        ],
        getTreePaths: treesByRepoId({}),
      });

    expect(resolution).toBeNull();
  });

  test("a single connected repository resolves as only-repository", async () => {
    const resolution: RepoResolution | null =
      await resolveRepositoryForExceptionFix({
        stackTrace: null,
        serviceName: null,
        repositories: [repo("r1", "checkout")],
        getTreePaths: treesByRepoId({}),
      });

    expect(resolution).not.toBeNull();
    expect(resolution!.method).toBe("only-repository");
    expect(resolution!.codeRepositoryId).toBe("r1");
    expect(resolution!.servicePathInRepository).toBeNull();
    expect(resolution!.evidence).toBe(
      "Only repository connected to this project",
    );
  });

  test("nothing resolves when every method misses", async () => {
    const resolution: RepoResolution | null =
      await resolveRepositoryForExceptionFix({
        stackTrace: nodeStack,
        serviceName: "unrelated",
        repositories: [repo("r1", "alpha"), repo("r2", "beta")],
        getTreePaths: treesByRepoId({
          r1: ["main.tf"],
          r2: ["docs/readme.md"],
        }),
      });

    expect(resolution).toBeNull();
  });
});
