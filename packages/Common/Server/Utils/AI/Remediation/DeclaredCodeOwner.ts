import CodeRepositoryService, {
  Service as CodeRepositoryServiceClass,
} from "../../../Services/CodeRepositoryService";
import { ResolvableRepository } from "../../CodeRepository/StackTraceRepoResolver";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import Dictionary from "../../../../Types/Dictionary";
import ObjectID from "../../../../Types/ObjectID";
import {
  DeclaredCode,
  DeclaredCodeOwnerReason,
  isDeclaredCodePath,
  isPathNamedAfter,
} from "../../../../Utils/AiRemediation/DeclaredCodeChange";

/*
 * WHICH CONNECTED REPOSITORY HOLDS THE CODE THAT DECLARES A CLOUD RESOURCE.
 *
 * A fix to a resource declared as code lasts only once the code says the
 * same (Utils/AiRemediation/DeclaredCodeChange). The pull request goes to
 * a repository connected to Code; which one, OneUptime works out from
 * what it can read, strongest first:
 *
 *   1. a tag of the resource names the repository - teams tag what
 *      Terraform makes with its repository (default_tags), and a URL in any
 *      tag counts as well;
 *   2. a file or folder of code of the right kind named after the resource
 *      or its CloudFormation stack ("stacks/web.yaml", "services/web/");
 *   3. code of the right kind at all: .tf files for Terraform, templates or
 *      cdk.json for CloudFormation, .bicep files for Bicep;
 *   4. the project's only repository AI can work in.
 *
 * Only repositories AI can work in are read (CodeRepositoryService
 * .getResolvableRepositories: a repository a foreign installation holds is
 * never read), each by its file tree alone, at most
 * DECLARED_CODE_MAX_PROBED_REPOSITORIES of them. A person confirms the
 * repository before anything is opened, and may pick another.
 */

// The most repositories whose trees are read for one resource.
export const DECLARED_CODE_MAX_PROBED_REPOSITORIES: number = 25;

// How many of a repository's paths that named the resource are kept.
const MAX_MATCHED_PATHS: number = 3;

// Tag keys that name the repository a resource's code is in, compared lowercased.
const REPOSITORY_TAG_KEYS: ReadonlyArray<string> = [
  "repository",
  "repo",
  "git-repo",
  "git_repo",
  "gitrepo",
  "git-repository",
  "git_repository",
  "source-repo",
  "source_repo",
  "source-repository",
  "source",
  "code-repository",
  "iac-repo",
  "iac-repository",
  "terraform-repo",
  "tf-repo",
  "github-repo",
  "github_repository",
  "gitlab-repo",
  "git-url",
  "git_url",
  "vcs-url",
];

// Hosts whose URL in any tag names a repository.
const REPOSITORY_HOSTS: ReadonlyArray<string> = [
  "github.com/",
  "gitlab.com/",
  "bitbucket.org/",
  "dev.azure.com/",
  "codeberg.org/",
];

// Repository names that say they hold infrastructure, as one word of the name.
const INFRASTRUCTURE_NAME_WORDS: ReadonlyArray<string> = [
  "infra",
  "infrastructure",
  "terraform",
  "tf",
  "iac",
  "cloudformation",
  "cfn",
  "cdk",
  "bicep",
  "pulumi",
  "platform",
  "ops",
  "deploy",
  "deployment",
  "deployments",
];

export interface DeclaredCodeOwnerCandidate {
  repository: ResolvableRepository;
  reason: DeclaredCodeOwnerReason;
  matchedPaths: Array<string>;
  score: number;
}

// "acme/infra", or the repository's own name.
export function getRepositoryFullName(
  repository: Pick<
    ResolvableRepository,
    "name" | "organizationName" | "repositoryName"
  >,
): string {
  return repository.organizationName && repository.repositoryName
    ? `${repository.organizationName}/${repository.repositoryName}`
    : repository.repositoryName || repository.name;
}

// A tag value as a repository's "organization/name", lowercased, or "".
function readRepositoryPath(value: string): string {
  let text: string = value.trim().toLowerCase();

  for (const prefix of ["https://", "http://", "ssh://", "git@"]) {
    if (text.startsWith(prefix)) {
      text = text.slice(prefix.length);
    }
  }

  // git@github.com:acme/infra.git
  text = text.split(":").join("/");

  if (text.endsWith(".git")) {
    text = text.slice(0, -4);
  }

  while (text.endsWith("/")) {
    text = text.slice(0, -1);
  }

  return text;
}

// Whether a tag names this repository, by its "organization/name" or its name.
function isNamedByTags(
  repository: ResolvableRepository,
  tags: Dictionary<string>,
): boolean {
  const fullName: string = getRepositoryFullName(repository).toLowerCase();
  const name: string = (
    repository.repositoryName || repository.name
  ).toLowerCase();

  for (const key of Object.keys(tags)) {
    const value: unknown = tags[key];

    if (typeof value !== "string" || !value.trim()) {
      continue;
    }

    const path: string = readRepositoryPath(value);
    const isRepositoryKey: boolean = REPOSITORY_TAG_KEYS.includes(
      key.trim().toLowerCase(),
    );
    const isRepositoryUrl: boolean = REPOSITORY_HOSTS.some(
      (host: string): boolean => {
        return path.includes(host);
      },
    );

    if (!isRepositoryKey && !isRepositoryUrl) {
      continue;
    }

    if (
      fullName.includes("/") &&
      (path === fullName || path.endsWith(`/${fullName}`))
    ) {
      return true;
    }

    // A bare name only from a key that is for repositories.
    if (isRepositoryKey && name && path === name) {
      return true;
    }
  }

  return false;
}

// Whether the repository's name says it holds infrastructure.
function isInfrastructureName(repository: ResolvableRepository): boolean {
  const words: Array<string> = (repository.repositoryName || repository.name)
    .toLowerCase()
    .split("-")
    .join("_")
    .split(".")
    .join("_")
    .split("_");

  return words.some((word: string): boolean => {
    return INFRASTRUCTURE_NAME_WORDS.includes(word);
  });
}

export default class DeclaredCodeOwner {
  /*
   * Every repository, ranked: the strongest evidence first, then a name
   * that says infrastructure, then by name. A tree that cannot be read
   * counts as no evidence. `getTreePaths` reads one repository's paths
   * (CodeRepositoryService.getRepositoryTreePaths, or a test's host).
   */
  public static async rank(data: {
    declaredCode: DeclaredCode;
    resource: { name: string; tags: Dictionary<string> };
    repositories: Array<ResolvableRepository>;
    getTreePaths: (repository: ResolvableRepository) => Promise<Array<string>>;
  }): Promise<Array<DeclaredCodeOwnerCandidate>> {
    const names: Array<string> = [
      data.declaredCode.stackName || "",
      data.resource.name,
    ].filter((name: string, index: number, all: Array<string>): boolean => {
      return name.trim().length > 0 && all.indexOf(name) === index;
    });

    // The likeliest first, so the probing limit leaves out the least likely.
    const ordered: Array<ResolvableRepository> = [...data.repositories].sort(
      (left: ResolvableRepository, right: ResolvableRepository): number => {
        return (
          Number(isInfrastructureName(right)) -
            Number(isInfrastructureName(left)) ||
          getRepositoryFullName(left).localeCompare(
            getRepositoryFullName(right),
          )
        );
      },
    );

    const candidates: Array<DeclaredCodeOwnerCandidate> = [];

    for (const [index, repository] of ordered.entries()) {
      const nameBonus: number = isInfrastructureName(repository) ? 5 : 0;

      if (isNamedByTags(repository, data.resource.tags)) {
        candidates.push({
          repository,
          reason: DeclaredCodeOwnerReason.NamedByTag,
          matchedPaths: [],
          score: 100 + nameBonus,
        });
        continue;
      }

      let paths: Array<string> = [];

      if (index < DECLARED_CODE_MAX_PROBED_REPOSITORIES) {
        try {
          paths = await data.getTreePaths(repository);
        } catch (error) {
          logger.debug(
            `DeclaredCodeOwner: the tree of repository ${repository.id} could not be read: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      const codePaths: Array<string> = paths.filter((path: string): boolean => {
        return isDeclaredCodePath(path, data.declaredCode.kind);
      });
      const matchedPaths: Array<string> = codePaths.filter(
        (path: string): boolean => {
          return names.some((name: string): boolean => {
            return isPathNamedAfter(path, name);
          });
        },
      );

      if (matchedPaths.length > 0) {
        candidates.push({
          repository,
          reason: DeclaredCodeOwnerReason.HasNamedFile,
          matchedPaths: matchedPaths.slice(0, MAX_MATCHED_PATHS),
          score: 60 + nameBonus,
        });
      } else if (codePaths.length > 0) {
        candidates.push({
          repository,
          reason: DeclaredCodeOwnerReason.HasCodeOfKind,
          matchedPaths: [],
          score: 40 + nameBonus,
        });
      } else {
        candidates.push({
          repository,
          reason: DeclaredCodeOwnerReason.NoEvidence,
          matchedPaths: [],
          score: nameBonus,
        });
      }
    }

    // The only repository: as likely as code of the right kind, when nothing says more.
    if (
      candidates.length === 1 &&
      candidates[0]!.reason === DeclaredCodeOwnerReason.NoEvidence
    ) {
      candidates[0]!.reason = DeclaredCodeOwnerReason.OnlyRepository;
      candidates[0]!.score = 20;
    }

    return candidates.sort(
      (
        left: DeclaredCodeOwnerCandidate,
        right: DeclaredCodeOwnerCandidate,
      ): number => {
        return (
          right.score - left.score ||
          getRepositoryFullName(left.repository).localeCompare(
            getRepositoryFullName(right.repository),
          )
        );
      },
    );
  }

  // The best candidate: one with evidence, never a repository nothing points to.
  public static getBest(
    candidates: Array<DeclaredCodeOwnerCandidate>,
  ): DeclaredCodeOwnerCandidate | null {
    const first: DeclaredCodeOwnerCandidate | undefined = candidates[0];

    return first && first.reason !== DeclaredCodeOwnerReason.NoEvidence
      ? first
      : null;
  }

  // The project's repositories AI can work in, ranked for this resource.
  @CaptureSpan()
  public static async findCandidates(data: {
    projectId: ObjectID;
    declaredCode: DeclaredCode;
    resource: { name: string; tags: Dictionary<string> };
  }): Promise<Array<DeclaredCodeOwnerCandidate>> {
    const repositories: Array<ResolvableRepository> =
      await CodeRepositoryService.getResolvableRepositories(data.projectId);

    return await DeclaredCodeOwner.rank({
      declaredCode: data.declaredCode,
      resource: data.resource,
      repositories,
      getTreePaths: (
        repository: ResolvableRepository,
      ): Promise<Array<string>> => {
        return CodeRepositoryServiceClass.getRepositoryTreePaths(repository);
      },
    });
  }
}
