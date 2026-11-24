import { describe, expect, test } from "@jest/globals";
import { ResolvableRepository } from "../../../../../Server/Utils/CodeRepository/StackTraceRepoResolver";
import {
  TelemetryLeakRepositoryGroup,
  TelemetryLeakToPlace,
  chooseTelemetryLeakRepositories,
  getTelemetryLeakStackTrace,
  toRepositoryPath,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryLeakRepositories";
import { DataSecurityTelemetryFixRepositoryChoice } from "../../../../../Types/DataSecurity/DataSecurityApiTypes";
import { SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID } from "../../../../../Types/DataSecurity/DataSecurityCheckCatalog";
import {
  TelemetryLeakPlace,
  TelemetryLeakSignal,
} from "../../../../../Types/DataSecurity/TelemetryLeakFix";

/*
 * WHICH REPOSITORY, AND WHICH FOLDER OF IT, A SERVICE'S LEAKS ARE FIXED IN
 * (#10367).
 *
 * From the facts of what is fixed, as every fix finds its repository: the
 * files each leak's records name, matched against every repository's tree;
 * a leak whose records name no file goes where the service's other leaks
 * are; else the repository named like the service, or the only one; else a
 * person picks. Leaks in two repositories make two fixes. The folder is the
 * one the matched files share, else the one Production Review keeps.
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
  "c0de0000-0000-4000-8000-000000000001",
  "platform",
);
const PAYMENTS: ResolvableRepository = repository(
  "c0de0000-0000-4000-8000-000000000002",
  "payments-api",
);
const CHECKOUT: ResolvableRepository = repository(
  "c0de0000-0000-4000-8000-000000000003",
  "checkout",
);

const TREES: Record<string, Array<string>> = {
  [MONOREPO.id]: [
    "services/checkout/package.json",
    "services/checkout/src/signup.js",
    "services/checkout/src/telemetry.js",
    "services/orders/src/index.js",
  ],
  [PAYMENTS.id]: ["src/payments.js", "src/index.js"],
  [CHECKOUT.id]: ["README.md"],
};

function leak(
  places: Array<TelemetryLeakPlace>,
  location: string = "attributes.user.email",
): TelemetryLeakToPlace {
  return {
    issueId: "15000000-0000-4000-8000-000000000101",
    dataStoreId: "51000000-0000-4000-8000-000000000101",
    checkId: SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
    signal: TelemetryLeakSignal.Spans,
    dataTypeId: "email-address",
    dataTypeName: "Email address",
    isSecret: false,
    location,
    key: "user.email",
    isMaskedByScrubRule: false,
    places,
  };
}

async function choose(data: {
  leaks: Array<TelemetryLeakToPlace>;
  repositories: Array<ResolvableRepository>;
  serviceName?: string;
  serviceFolder?: string | null;
  unreadable?: Array<string>;
}): Promise<Array<TelemetryLeakRepositoryGroup>> {
  return await chooseTelemetryLeakRepositories({
    leaks: data.leaks,
    serviceName: data.serviceName ?? "checkout",
    repositories: data.repositories,
    getTreePaths: async (
      each: ResolvableRepository,
    ): Promise<Array<string>> => {
      if ((data.unreadable || []).includes(each.id)) {
        throw new Error("Not reachable.");
      }

      return TREES[each.id] || [];
    },
    getServiceFolder: async (): Promise<string | null> => {
      return data.serviceFolder ?? null;
    },
  });
}

describe("a leak's places as a stack trace", () => {
  test("each file it names, with its line, its exception's frames included, once each", () => {
    expect(
      getTelemetryLeakStackTrace({
        places: [
          {
            filePath: "src/signup.js",
            lineNumber: 12,
            functionName: "signUp",
            recordCount: 2,
          },
          {
            filePath: "src/signup.js",
            lineNumber: 12,
            functionName: "signUp",
            recordCount: 1,
          },
          {
            filePath: "src/payments.js",
            frames: [{ filePath: "src/index.js" }],
            recordCount: 1,
          },
        ],
      }),
    ).toBe(
      [
        "    at signUp (src/signup.js:12)",
        "    at (src/payments.js:1)",
        "    at (src/index.js:1)",
      ].join("\n"),
    );
    expect(
      getTelemetryLeakStackTrace({
        places: [
          { template: "User <Email address> signed up", recordCount: 1 },
        ],
      }),
    ).toBeNull();
  });
});

describe("a file named as the repository holds it", () => {
  test("the one tree path its longest suffix matches", () => {
    expect(
      toRepositoryPath({
        filePath: "src/signup.js",
        tree: TREES[MONOREPO.id]!,
        folder: null,
      }),
    ).toBe("services/checkout/src/signup.js");
  });

  test("of several, the one under the service's folder; else, and with no tree, as it was", () => {
    const tree: Array<string> = [
      "services/checkout/src/index.js",
      "services/orders/src/index.js",
    ];

    expect(
      toRepositoryPath({
        filePath: "src/index.js",
        tree,
        folder: "services/orders",
      }),
    ).toBe("services/orders/src/index.js");
    expect(
      toRepositoryPath({ filePath: "src/index.js", tree, folder: null }),
    ).toBe("src/index.js");
    expect(
      toRepositoryPath({ filePath: "src/index.js", tree: null, folder: null }),
    ).toBe("src/index.js");
  });
});

describe("the repository", () => {
  test("from the files the records name: the repository whose tree holds them, its files as it holds them, its folder theirs", async () => {
    const groups: Array<TelemetryLeakRepositoryGroup> = await choose({
      leaks: [
        leak([{ filePath: "src/signup.js", lineNumber: 12, recordCount: 2 }]),
      ],
      repositories: [MONOREPO, PAYMENTS, CHECKOUT],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]!.repository?.id).toBe(MONOREPO.id);
    expect(groups[0]!.choice).toBe(
      DataSecurityTelemetryFixRepositoryChoice.StackTrace,
    );
    expect(groups[0]!.folder).toBe("services/checkout");
    expect(groups[0]!.leaks[0]!.places[0]!.filePath).toBe(
      "services/checkout/src/signup.js",
    );
  });

  test("a leak whose records name no file goes where the service's other leaks are", async () => {
    const groups: Array<TelemetryLeakRepositoryGroup> = await choose({
      leaks: [
        leak([{ filePath: "src/signup.js", lineNumber: 12, recordCount: 2 }]),
        leak(
          [
            {
              template: "Password reset sent to <Email address>",
              recordCount: 3,
            },
          ],
          "body",
        ),
      ],
      repositories: [MONOREPO, PAYMENTS],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]!.repository?.id).toBe(MONOREPO.id);
    expect(groups[0]!.leaks).toHaveLength(2);
  });

  test("with no file named anywhere: the repository named like the service", async () => {
    const groups: Array<TelemetryLeakRepositoryGroup> = await choose({
      leaks: [
        leak([{ template: "User <Email address> signed up", recordCount: 1 }]),
      ],
      repositories: [MONOREPO, PAYMENTS, CHECKOUT],
      serviceFolder: null,
    });

    expect(groups[0]!.repository?.id).toBe(CHECKOUT.id);
    expect(groups[0]!.choice).toBe(
      DataSecurityTelemetryFixRepositoryChoice.NameMatch,
    );
  });

  test("with no file and no name: the project's only repository, in the folder Production Review keeps", async () => {
    const groups: Array<TelemetryLeakRepositoryGroup> = await choose({
      leaks: [leak([{ spanName: "POST /signup", recordCount: 1 }])],
      repositories: [MONOREPO],
      serviceFolder: "services/checkout",
    });

    expect(groups[0]!.repository?.id).toBe(MONOREPO.id);
    expect(groups[0]!.choice).toBe(
      DataSecurityTelemetryFixRepositoryChoice.OnlyRepository,
    );
    expect(groups[0]!.folder).toBe("services/checkout");
  });

  test("nothing decides: no repository, and a person picks", async () => {
    const groups: Array<TelemetryLeakRepositoryGroup> = await choose({
      leaks: [leak([{ spanName: "POST /signup", recordCount: 1 }])],
      repositories: [MONOREPO, PAYMENTS],
    });

    expect(groups).toEqual([
      expect.objectContaining({ repository: null, choice: null, folder: null }),
    ]);
  });

  test("no repository connected at all: one group with none", async () => {
    const groups: Array<TelemetryLeakRepositoryGroup> = await choose({
      leaks: [leak([{ filePath: "src/signup.js", recordCount: 1 }])],
      repositories: [],
    });

    expect(groups).toEqual([
      expect.objectContaining({ repository: null, choice: null }),
    ]);
  });

  test("leaks written in two repositories make two fixes: one pull request per service and repository", async () => {
    const groups: Array<TelemetryLeakRepositoryGroup> = await choose({
      leaks: [
        leak([{ filePath: "src/signup.js", lineNumber: 12, recordCount: 2 }]),
        leak([{ filePath: "src/payments.js", lineNumber: 21, recordCount: 1 }]),
      ],
      repositories: [MONOREPO, PAYMENTS],
    });

    expect(
      groups
        .map((group: TelemetryLeakRepositoryGroup): string => {
          return group.repository?.id || "";
        })
        .sort(),
    ).toEqual([MONOREPO.id, PAYMENTS.id].sort());
  });

  test("a repository whose files cannot be read is not matched by them", async () => {
    const groups: Array<TelemetryLeakRepositoryGroup> = await choose({
      leaks: [
        leak([{ filePath: "src/signup.js", lineNumber: 12, recordCount: 2 }]),
      ],
      repositories: [MONOREPO, PAYMENTS],
      unreadable: [MONOREPO.id],
    });

    expect(groups[0]!.repository).toBeNull();
  });

  test("no leak, no fix", async () => {
    expect(await choose({ leaks: [], repositories: [MONOREPO] })).toEqual([]);
  });
});
