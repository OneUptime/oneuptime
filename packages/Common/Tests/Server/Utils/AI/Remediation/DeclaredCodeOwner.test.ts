import CodeRepositoryService, {
  Service as CodeRepositoryServiceClass,
} from "../../../../../Server/Services/CodeRepositoryService";
import DeclaredCodeOwner, {
  DECLARED_CODE_MAX_PROBED_REPOSITORIES,
  DeclaredCodeOwnerCandidate,
  getRepositoryFullName,
} from "../../../../../Server/Utils/AI/Remediation/DeclaredCodeOwner";
import { ResolvableRepository } from "../../../../../Server/Utils/CodeRepository/StackTraceRepoResolver";
import Dictionary from "../../../../../Types/Dictionary";
import ObjectID from "../../../../../Types/ObjectID";
import {
  DeclaredCode,
  DeclaredCodeOwnerReason,
  readDeclaredCode,
} from "../../../../../Utils/AiRemediation/DeclaredCodeChange";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";

/*
 * Server/Utils/AI/Remediation/DeclaredCodeOwner - which repository connected
 * to Code holds the code that declares a cloud resource, against a fake
 * repository host: repositories, each with the paths of its file tree (or a
 * tree that cannot be read). For each kind of code - Terraform,
 * CloudFormation, Bicep - the owning repository is found, strongest
 * evidence first: a tag naming it, a file named after the resource or its
 * stack, code of the kind at all, the only repository.
 */

interface FakeRepository {
  repository: ResolvableRepository;
  paths: Array<string> | "unreadable";
}

function repository(
  name: string,
  organizationName: string = "acme",
): ResolvableRepository {
  return {
    id: ObjectID.generate().toString(),
    name,
    organizationName,
    repositoryName: name,
    mainBranchName: "main",
    gitHubAppInstallationId: "12345",
  };
}

// The fake host: each repository's tree, read the way the server reads one.
function host(repositories: Array<FakeRepository>): {
  repositories: Array<ResolvableRepository>;
  getTreePaths: Mock<
    (repository: ResolvableRepository) => Promise<Array<string>>
  >;
} {
  const byId: Map<string, FakeRepository> = new Map(
    repositories.map((fake: FakeRepository): [string, FakeRepository] => {
      return [fake.repository.id, fake];
    }),
  );

  return {
    repositories: repositories.map((fake: FakeRepository) => {
      return fake.repository;
    }),
    getTreePaths: jest.fn(
      async (wanted: ResolvableRepository): Promise<Array<string>> => {
        const fake: FakeRepository | undefined = byId.get(wanted.id);

        if (!fake || fake.paths === "unreadable") {
          throw new Error("OneUptime does not read this repository's files.");
        }

        return fake.paths;
      },
    ),
  };
}

const APP: FakeRepository = {
  repository: repository("checkout-app"),
  paths: ["src/index.ts", "package.json", "Dockerfile"],
};
const TERRAFORM: FakeRepository = {
  repository: repository("platform"),
  paths: [
    "modules/network/main.tf",
    "envs/prod/main.tf",
    "envs/prod/services/web/main.tf",
  ],
};
const TERRAFORM_OTHER: FakeRepository = {
  repository: repository("legacy-terraform"),
  paths: ["main.tf", "variables.tf"],
};
const CLOUDFORMATION: FakeRepository = {
  repository: repository("stacks"),
  paths: ["cloudformation/web-prod.yaml", "cloudformation/db.yaml"],
};
const BICEP: FakeRepository = {
  repository: repository("azure-infra"),
  paths: ["main.bicep", "modules/web-plan.bicep", "modules/db.bicep"],
};

async function rank(data: {
  managedAsCode: string;
  name: string;
  tags?: Dictionary<string>;
  repositories: Array<FakeRepository>;
}): Promise<Array<DeclaredCodeOwnerCandidate>> {
  const fake: ReturnType<typeof host> = host(data.repositories);

  return await DeclaredCodeOwner.rank({
    declaredCode: readDeclaredCode(data.managedAsCode) as DeclaredCode,
    resource: { name: data.name, tags: data.tags || {} },
    repositories: fake.repositories,
    getTreePaths: fake.getTreePaths,
  });
}

function summary(
  candidates: Array<DeclaredCodeOwnerCandidate>,
): Array<[string, DeclaredCodeOwnerReason]> {
  return candidates.map(
    (
      candidate: DeclaredCodeOwnerCandidate,
    ): [string, DeclaredCodeOwnerReason] => {
      return [getRepositoryFullName(candidate.repository), candidate.reason];
    },
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the owning code, for each kind of code", () => {
  test("Terraform: the repository whose Terraform has a folder named after the service", async () => {
    const candidates: Array<DeclaredCodeOwnerCandidate> = await rank({
      managedAsCode: "Terraform",
      name: "web",
      repositories: [APP, TERRAFORM_OTHER, TERRAFORM, CLOUDFORMATION],
    });

    expect(summary(candidates)).toEqual([
      ["acme/platform", DeclaredCodeOwnerReason.HasNamedFile],
      ["acme/legacy-terraform", DeclaredCodeOwnerReason.HasCodeOfKind],
      ["acme/checkout-app", DeclaredCodeOwnerReason.NoEvidence],
      ["acme/stacks", DeclaredCodeOwnerReason.NoEvidence],
    ]);
    expect(candidates[0]!.matchedPaths).toEqual([
      "envs/prod/services/web/main.tf",
    ]);
    expect(DeclaredCodeOwner.getBest(candidates)?.repository.name).toBe(
      "platform",
    );
  });

  test("CloudFormation: the template named after the stack the tags name", async () => {
    const candidates: Array<DeclaredCodeOwnerCandidate> = await rank({
      managedAsCode: 'CloudFormation stack "web-prod"',
      name: "web",
      repositories: [APP, TERRAFORM, CLOUDFORMATION],
    });

    expect(summary(candidates)[0]).toEqual([
      "acme/stacks",
      DeclaredCodeOwnerReason.HasNamedFile,
    ]);
    expect(candidates[0]!.matchedPaths).toEqual([
      "cloudformation/web-prod.yaml",
    ]);
    // Terraform files are no CloudFormation template.
    expect(
      candidates.find((candidate: DeclaredCodeOwnerCandidate): boolean => {
        return candidate.repository.name === "platform";
      })?.reason,
    ).toBe(DeclaredCodeOwnerReason.NoEvidence);
  });

  test("Bicep: the module named after the App Service plan", async () => {
    const candidates: Array<DeclaredCodeOwnerCandidate> = await rank({
      managedAsCode: "Bicep",
      name: "web-plan",
      repositories: [APP, TERRAFORM, BICEP],
    });

    expect(summary(candidates)[0]).toEqual([
      "acme/azure-infra",
      DeclaredCodeOwnerReason.HasNamedFile,
    ]);
    expect(candidates[0]!.matchedPaths).toEqual(["modules/web-plan.bicep"]);
  });
});

describe("what counts as evidence", () => {
  test.each([
    [{ repository: "acme/checkout-app" }],
    [{ Repository: "https://github.com/acme/checkout-app" }],
    [{ "git-repo": "git@github.com:acme/checkout-app.git" }],
    [{ source: "github.com/acme/checkout-app/" }],
    [{ "made-by": "https://github.com/acme/checkout-app" }],
    [{ repo: "checkout-app" }],
  ])(
    "a tag naming the repository is the strongest: %j",
    async (tags: Dictionary<string>) => {
      const candidates: Array<DeclaredCodeOwnerCandidate> = await rank({
        managedAsCode: "Terraform",
        name: "web",
        tags,
        repositories: [APP, TERRAFORM],
      });

      expect(summary(candidates)[0]).toEqual([
        "acme/checkout-app",
        DeclaredCodeOwnerReason.NamedByTag,
      ]);
    },
  );

  test("a bare name in a tag that is not for repositories names nothing", async () => {
    const candidates: Array<DeclaredCodeOwnerCandidate> = await rank({
      managedAsCode: "Terraform",
      name: "web",
      tags: { team: "checkout-app" },
      repositories: [APP, TERRAFORM],
    });

    expect(summary(candidates)[0]![0]).toBe("acme/platform");
  });

  test("a URL of another organization's repository of the same name names nothing", async () => {
    const candidates: Array<DeclaredCodeOwnerCandidate> = await rank({
      managedAsCode: "Terraform",
      name: "web",
      tags: { repository: "https://github.com/someone-else/checkout-app" },
      repositories: [APP, TERRAFORM],
    });

    expect(
      candidates.some((candidate: DeclaredCodeOwnerCandidate): boolean => {
        return candidate.reason === DeclaredCodeOwnerReason.NamedByTag;
      }),
    ).toBe(false);
  });

  test("the only repository is offered as such, and is the best", async () => {
    const candidates: Array<DeclaredCodeOwnerCandidate> = await rank({
      managedAsCode: "Terraform",
      name: "web",
      repositories: [APP],
    });

    expect(summary(candidates)).toEqual([
      ["acme/checkout-app", DeclaredCodeOwnerReason.OnlyRepository],
    ]);
    expect(DeclaredCodeOwner.getBest(candidates)).not.toBeNull();
  });

  test("nothing pointing anywhere: every repository offered, none chosen", async () => {
    const candidates: Array<DeclaredCodeOwnerCandidate> = await rank({
      managedAsCode: "Bicep",
      name: "web-plan",
      repositories: [APP, TERRAFORM],
    });

    expect(
      candidates.every((candidate: DeclaredCodeOwnerCandidate): boolean => {
        return candidate.reason === DeclaredCodeOwnerReason.NoEvidence;
      }),
    ).toBe(true);
    expect(DeclaredCodeOwner.getBest(candidates)).toBeNull();
  });

  test("a tree that cannot be read is no evidence, and the others are read", async () => {
    const candidates: Array<DeclaredCodeOwnerCandidate> = await rank({
      managedAsCode: "Terraform",
      name: "web",
      repositories: [{ ...TERRAFORM, paths: "unreadable" }, TERRAFORM_OTHER],
    });

    expect(summary(candidates)).toEqual([
      ["acme/legacy-terraform", DeclaredCodeOwnerReason.HasCodeOfKind],
      ["acme/platform", DeclaredCodeOwnerReason.NoEvidence],
    ]);
  });

  test("a repository a tag names is not read at all", async () => {
    const fake: ReturnType<typeof host> = host([APP, TERRAFORM]);

    await DeclaredCodeOwner.rank({
      declaredCode: readDeclaredCode("Terraform") as DeclaredCode,
      resource: { name: "web", tags: { repository: "acme/checkout-app" } },
      repositories: fake.repositories,
      getTreePaths: fake.getTreePaths,
    });

    expect(
      fake.getTreePaths.mock.calls.map(
        (call: Array<ResolvableRepository>): string => {
          return call[0]!.name;
        },
      ),
    ).toEqual(["platform"]);
  });

  test(`at most ${DECLARED_CODE_MAX_PROBED_REPOSITORIES} trees are read, names that say infrastructure first`, async () => {
    const many: Array<FakeRepository> = [];

    for (let index: number = 0; index < 40; index++) {
      many.push({
        repository: repository(`service-${String(index).padStart(2, "0")}`),
        paths: ["src/index.ts"],
      });
    }

    const infra: FakeRepository = {
      repository: repository("zz-infra"),
      paths: ["envs/prod/web/main.tf"],
    };
    const fake: ReturnType<typeof host> = host([...many, infra]);
    const candidates: Array<DeclaredCodeOwnerCandidate> =
      await DeclaredCodeOwner.rank({
        declaredCode: readDeclaredCode("Terraform") as DeclaredCode,
        resource: { name: "web", tags: {} },
        repositories: fake.repositories,
        getTreePaths: fake.getTreePaths,
      });

    expect(fake.getTreePaths).toHaveBeenCalledTimes(
      DECLARED_CODE_MAX_PROBED_REPOSITORIES,
    );
    // Its name says infrastructure, so it was read first, past the limit's reach.
    expect(summary(candidates)[0]).toEqual([
      "acme/zz-infra",
      DeclaredCodeOwnerReason.HasNamedFile,
    ]);
    expect(candidates).toHaveLength(41);
  });

  test("between two of the same evidence, a name that says infrastructure first", async () => {
    const candidates: Array<DeclaredCodeOwnerCandidate> = await rank({
      managedAsCode: "Terraform",
      name: "web",
      repositories: [
        { repository: repository("aaa-app"), paths: ["main.tf"] },
        { repository: repository("terraform-live"), paths: ["main.tf"] },
      ],
    });

    expect(summary(candidates)[0]![0]).toBe("acme/terraform-live");
  });
});

describe("getRepositoryFullName", () => {
  test("organization and name, or the name alone", () => {
    expect(getRepositoryFullName(repository("infra"))).toBe("acme/infra");
    expect(
      getRepositoryFullName({
        name: "My infra",
        organizationName: "",
        repositoryName: "",
      }),
    ).toBe("My infra");
  });
});

describe("findCandidates", () => {
  test("reads only the repositories AI can work in, through their own host", async () => {
    const resolvable: SpyInstance<
      typeof CodeRepositoryService.getResolvableRepositories
    > = jest
      .spyOn(CodeRepositoryService, "getResolvableRepositories")
      .mockResolvedValue([TERRAFORM.repository]);
    const tree: SpyInstance<
      typeof CodeRepositoryServiceClass.getRepositoryTreePaths
    > = jest
      .spyOn(CodeRepositoryServiceClass, "getRepositoryTreePaths")
      .mockResolvedValue(TERRAFORM.paths as Array<string>);
    const projectId: ObjectID = ObjectID.generate();

    const candidates: Array<DeclaredCodeOwnerCandidate> =
      await DeclaredCodeOwner.findCandidates({
        projectId,
        declaredCode: readDeclaredCode("Terraform") as DeclaredCode,
        resource: { name: "web", tags: {} },
      });

    expect(resolvable).toHaveBeenCalledWith(projectId);
    expect(tree).toHaveBeenCalledWith(TERRAFORM.repository);
    expect(summary(candidates)).toEqual([
      ["acme/platform", DeclaredCodeOwnerReason.HasNamedFile],
    ]);
  });
});
