import { describe, expect, test } from "@jest/globals";
import { ResolvableRepository } from "../../../../../Server/Utils/CodeRepository/StackTraceRepoResolver";
import {
  TelemetryLeakRepositoryGroup,
  TelemetryLeakToPlace,
  chooseRepositoryOfFiles,
  chooseTelemetryLeakRepositories,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryLeakRepositories";
import { DataSecurityTelemetryFixRepositoryChoice } from "../../../../../Types/DataSecurity/DataSecurityApiTypes";
import { SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID } from "../../../../../Types/DataSecurity/DataSecurityCheckCatalog";
import {
  TelemetryLeakPlace,
  TelemetryLeakSignal,
} from "../../../../../Types/DataSecurity/TelemetryLeakFix";

/*
 * WHICH REPOSITORY A RUM APPLICATION'S LEAKS ARE FIXED IN (#10933).
 *
 * As a service's: the original files its records' stacks resolve to,
 * matched against every repository's tree; a leak that names none goes
 * where the others are. Where none of its leaks names a file, the files
 * its newest release's source maps name decide - the repository whose tree
 * holds the most of them, and the folder they share - before a repository
 * named like the application, or the only one. Two trees that hold as many
 * decide nothing, and a person picks.
 */

function repository(id: string, name: string): ResolvableRepository {
  return {
    id,
    name,
    organizationName: "acme",
    repositoryName: name,
    mainBranchName: "main",
    gitHubAppInstallationId: null,
  };
}

const MONOREPO: ResolvableRepository = repository(
  "c0de0000-0000-4000-8000-000000000011",
  "platform",
);
const STOREFRONT: ResolvableRepository = repository(
  "c0de0000-0000-4000-8000-000000000012",
  "storefront-web",
);
const API: ResolvableRepository = repository(
  "c0de0000-0000-4000-8000-000000000013",
  "api",
);

const TREES: Record<string, Array<string>> = {
  [MONOREPO.id]: [
    "apps/web/src/checkout/payment.js",
    "apps/web/src/session.js",
    "apps/web/src/api/client.js",
    "services/orders/src/index.js",
  ],
  [STOREFRONT.id]: ["README.md"],
  [API.id]: ["src/index.js", "src/session.js"],
};

// What the application's newest release's source maps name.
const APP_FILES: Array<string> = [
  "src/checkout/payment.js",
  "src/session.js",
  "src/api/client.js",
];

function leak(
  places: Array<TelemetryLeakPlace>,
  signal: TelemetryLeakSignal = TelemetryLeakSignal.RumLogs,
): TelemetryLeakToPlace {
  return {
    issueId: "a9000000-0000-4000-8000-000000000101",
    dataStoreId: "a9000000-0000-4000-8000-000000000201",
    checkId: SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
    signal,
    dataTypeId: "email-address",
    dataTypeName: "Email address",
    isSecret: false,
    location:
      signal === TelemetryLeakSignal.RumSessions
        ? "sessions.identifiedUserLabel"
        : "logs.attributes.user.email",
    isMaskedByScrubRule: false,
    places,
  };
}

const SESSION: TelemetryLeakToPlace = leak(
  [{ recorderCall: "identify", page: "/account", recordCount: 2 }],
  TelemetryLeakSignal.RumSessions,
);

async function choose(data: {
  leaks: Array<TelemetryLeakToPlace>;
  repositories: Array<ResolvableRepository>;
  appFiles?: Array<string>;
  serviceName?: string;
}): Promise<Array<TelemetryLeakRepositoryGroup>> {
  return await chooseTelemetryLeakRepositories({
    leaks: data.leaks,
    serviceName: data.serviceName ?? "storefront-web",
    repositories: data.repositories,
    getTreePaths: async (
      each: ResolvableRepository,
    ): Promise<Array<string>> => {
      return TREES[each.id] || [];
    },
    // Production Review keeps no folder for an application.
    getServiceFolder: async (): Promise<string | null> => {
      return null;
    },
    ...(data.appFiles ? { appFiles: data.appFiles } : {}),
  });
}

describe("the repository of an application's files", () => {
  test("the tree holding the most of them, and the folder they sit under there", () => {
    expect(
      chooseRepositoryOfFiles({
        files: APP_FILES,
        trees: [MONOREPO, STOREFRONT, API].map((each: ResolvableRepository) => {
          return { id: each.id, tree: TREES[each.id]! };
        }),
      }),
    ).toEqual({ id: MONOREPO.id, folder: "apps/web" });
  });

  test("two trees that hold as many decide nothing; nor do trees that hold none, or can't be read", () => {
    expect(
      chooseRepositoryOfFiles({
        files: ["src/session.js"],
        trees: [
          { id: MONOREPO.id, tree: TREES[MONOREPO.id]! },
          { id: API.id, tree: TREES[API.id]! },
        ],
      }),
    ).toBeNull();
    expect(
      chooseRepositoryOfFiles({
        files: ["src/nowhere.js"],
        trees: [{ id: API.id, tree: TREES[API.id]! }],
      }),
    ).toBeNull();
    expect(
      chooseRepositoryOfFiles({
        files: APP_FILES,
        trees: [{ id: MONOREPO.id, tree: null }],
      }),
    ).toBeNull();
  });

  test("files at a tree's root sit under no folder", () => {
    expect(
      chooseRepositoryOfFiles({
        files: ["src/index.js", "src/session.js"],
        trees: [{ id: API.id, tree: TREES[API.id]! }],
      }),
    ).toEqual({ id: API.id, folder: null });
  });

  test("a file two paths of one tree end with is no evidence", () => {
    expect(
      chooseRepositoryOfFiles({
        files: ["index.js"],
        trees: [
          {
            id: MONOREPO.id,
            tree: ["apps/web/index.js", "services/orders/index.js"],
          },
        ],
      }),
    ).toBeNull();
  });
});

describe("an application's leaks, put in repositories", () => {
  test("by the original files its records' stacks resolve to; its session's leak goes with them", async () => {
    const groups: Array<TelemetryLeakRepositoryGroup> = await choose({
      leaks: [
        leak([
          {
            filePath: "src/checkout/payment.js",
            lineNumber: 8,
            page: "/checkout",
            recordCount: 3,
          },
        ]),
        SESSION,
      ],
      repositories: [MONOREPO, STOREFRONT, API],
      appFiles: APP_FILES,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      repository: { id: MONOREPO.id },
      choice: DataSecurityTelemetryFixRepositoryChoice.StackTrace,
      folder: "apps/web",
    });
    expect(groups[0]!.leaks).toHaveLength(2);
    expect(groups[0]!.leaks[0]!.places[0]!.filePath).toBe(
      "apps/web/src/checkout/payment.js",
    );
  });

  test("none of its leaks names a file: where its source maps' files are, before a repository named like it", async () => {
    const groups: Array<TelemetryLeakRepositoryGroup> = await choose({
      leaks: [leak([{ page: "/checkout", recordCount: 3 }]), SESSION],
      repositories: [MONOREPO, STOREFRONT, API],
      appFiles: APP_FILES,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      repository: { id: MONOREPO.id },
      choice: DataSecurityTelemetryFixRepositoryChoice.SourceMaps,
      folder: "apps/web",
    });
  });

  test("with no source map uploaded, the repository named like what its code calls it", async () => {
    const groups: Array<TelemetryLeakRepositoryGroup> = await choose({
      leaks: [SESSION],
      repositories: [MONOREPO, STOREFRONT, API],
    });

    expect(groups[0]).toMatchObject({
      repository: { id: STOREFRONT.id },
      choice: DataSecurityTelemetryFixRepositoryChoice.NameMatch,
    });
  });

  test("source maps whose files no tree holds decide nothing, and the name still does", async () => {
    const groups: Array<TelemetryLeakRepositoryGroup> = await choose({
      leaks: [SESSION],
      repositories: [MONOREPO, STOREFRONT, API],
      appFiles: ["src/nowhere.js"],
    });

    expect(groups[0]).toMatchObject({
      repository: { id: STOREFRONT.id },
      choice: DataSecurityTelemetryFixRepositoryChoice.NameMatch,
    });
  });

  test("nothing decides: one group with no repository, and a person picks", async () => {
    const groups: Array<TelemetryLeakRepositoryGroup> = await choose({
      leaks: [SESSION],
      repositories: [MONOREPO, API],
      appFiles: ["src/session.js"],
      serviceName: "storefront",
    });

    expect(groups).toEqual([
      expect.objectContaining({ repository: null, choice: null }),
    ]);
  });
});
