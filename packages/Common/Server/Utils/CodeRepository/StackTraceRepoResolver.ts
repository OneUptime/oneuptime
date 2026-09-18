/*
 * Resolves which connected code repository an exception's code lives in — and
 * at which subdirectory — at runtime from the exception's stack trace,
 * replacing a manual service → repository mapping table. The tree fetcher is
 * injected, so the resolution logic stays pure: deterministic, explainable,
 * and unit-testable.
 *
 * Resolution order (first hit wins):
 *   1. "stack-trace"     — file paths parsed from the stack trace, matched
 *                          against each repository's tree by longest suffix.
 *   2. "name-match"      — exact service-name ↔ repository-name match via the
 *                          ServiceRepoLinkSuggester (score 3 only, unique).
 *   3. "only-repository" — the project has exactly one connected repository.
 */

import {
  ServiceRepoLinkSuggestion,
  SuggestableRepository,
  computeLinkSuggestions,
} from "./ServiceRepoLinkSuggester";

const WINDOWS_DRIVE_RE: RegExp = /^[A-Za-z]:\//;
const FILE_EXTENSION_RE: RegExp = /\.[A-Za-z0-9]+$/;

export interface ResolvableRepository {
  id: string;
  name: string;
  organizationName: string;
  repositoryName: string;
  mainBranchName: string;
  gitHubAppInstallationId: string | null;
}

export interface RepoResolution {
  codeRepositoryId: string;
  organizationName: string;
  repositoryName: string;
  servicePathInRepository: string | null;
  method: "stack-trace" | "name-match" | "only-repository";
  evidence: string; // human-readable, e.g. 'Matched src/billing/charge.ts in acme/checkout'
}

// Stack top is most relevant — anything past this is noise.
const MAX_CANDIDATE_PATHS: number = 10;

// A suffix match of at least this many path segments is "strong".
const STRONG_MATCH_MIN_SEGMENTS: number = 2;

// Only exact-name suggestions (score 3) are trusted for the name-match fallback.
const EXACT_NAME_MATCH_SCORE: number = 3;

/*
 * Leading absolute segments that are container/deploy noise rather than
 * repository structure. Only the first matching pattern is stripped — the
 * suffix ladder takes care of any remaining non-repository segments.
 */
const CONTAINER_PREFIX_PATTERNS: Array<RegExp> = [
  /^\/usr\/src\/app\//,
  /^\/var\/task\//,
  /^\/app\//,
  /^\/home\/[^/]+\//,
];

// Frames inside dependency directories never point at first-party code.
const DEPENDENCY_FRAME_MARKERS: Array<string> = [
  "/node_modules/",
  "/site-packages/",
  "/dist-packages/",
  "/vendor/",
  "/gems/",
];

/*
 * `/app/src/x.ts:12` — a path whose basename has an extension, followed by a
 * line number. Covers Node (`at fn (/app/src/x.ts:1:2)`, `at /app/src/x.js:1:2`),
 * Ruby (`from /app/lib/x.rb:1`), Go (`\t/app/pkg/x.go:12 +0x1b`) and Java
 * (`at com.acme.X.method(X.java:12)` — the opening parenthesis is not a path
 * character, so only the reliable basename `X.java` is captured).
 */
const PATH_WITH_LINE_REGEX: RegExp =
  /((?:[A-Za-z]:)?[\w.\-/\\@+~]+\.[A-Za-z][A-Za-z0-9]{0,9}):\d+/g;

// Python traceback frames: `File "/app/src/x.py", line 1`.
const PYTHON_FRAME_REGEX: RegExp = /File\s+"([^"]+)"\s*,\s*line\s+\d+/g;

/*
 * Normalizes one raw path plucked from a stack frame into a relative,
 * forward-slash path — or null when the frame is dependency/runtime noise.
 *
 * Exported because a runtime path from a stack frame (`/app/src/billing.ts`)
 * is not a repository path (`src/billing.ts`): anything that hands a frame's
 * file to a repository API must strip the container prefix first, or every
 * lookup 404s.
 */
export type NormalizeCandidatePathFunction = (rawPath: string) => string | null;

export const normalizeCandidatePath: NormalizeCandidatePathFunction = (
  rawPath: string,
): string | null => {
  let path: string = rawPath.trim().replace(/\\/g, "/");

  // `<anonymous>`, `<frozen importlib._bootstrap>` and friends are not files.
  if (path.includes("<") || path.includes(">")) {
    return null;
  }

  // Windows drive letters are absolute-root noise: C:/app/x.ts → /app/x.ts.
  if (WINDOWS_DRIVE_RE.test(path)) {
    path = path.slice(2);
  }

  path = path.replace(/\/{2,}/g, "/");

  // Guarantee a leading slash so the markers match at the very start too.
  const probe: string = path.startsWith("/") ? path : `/${path}`;

  for (const marker of DEPENDENCY_FRAME_MARKERS) {
    if (probe.includes(marker)) {
      return null;
    }
  }

  let relative: string = probe;

  for (const pattern of CONTAINER_PREFIX_PATTERNS) {
    if (pattern.test(relative)) {
      relative = relative.replace(pattern, "");
      break;
    }
  }

  relative = relative.replace(/^\/+/, "").replace(/^(\.\/)+/, "");

  // Real source files have a basename with an extension.
  if (!relative || !FILE_EXTENSION_RE.test(relative)) {
    return null;
  }

  return relative;
};

export type ExtractCandidatePathsFromStackTraceFunction = (
  stackTrace: string,
) => Array<string>;

export const extractCandidatePathsFromStackTrace: ExtractCandidatePathsFromStackTraceFunction =
  (stackTrace: string): Array<string> => {
    const candidates: Array<string> = [];
    const seen: Set<string> = new Set();

    const lines: Array<string> = stackTrace.split(/\r?\n/);

    for (const line of lines) {
      const rawPaths: Array<string> = [];

      for (const match of line.matchAll(PYTHON_FRAME_REGEX)) {
        if (match[1]) {
          rawPaths.push(match[1]);
        }
      }

      for (const match of line.matchAll(PATH_WITH_LINE_REGEX)) {
        if (match[1]) {
          rawPaths.push(match[1]);
        }
      }

      for (const rawPath of rawPaths) {
        const normalized: string | null = normalizeCandidatePath(rawPath);

        if (!normalized || seen.has(normalized)) {
          continue;
        }

        seen.add(normalized);
        candidates.push(normalized);

        if (candidates.length >= MAX_CANDIDATE_PATHS) {
          return candidates;
        }
      }
    }

    return candidates;
  };

// One candidate path matched against one repository's tree.
interface CandidateSuffixMatch {
  candidatePath: string;
  matchedSuffix: string;
  matchedSegmentCount: number;
  matchedTreePaths: Array<string>;
  isStrongMatch: boolean;
}

interface RepositoryMatchState {
  repository: ResolvableRepository;
  basenameCounts: Map<string, number>;
  treePathsByBasename: Map<string, Array<string>>;
  matches: Array<CandidateSuffixMatch>;
}

type BuildRepositoryMatchStateFunction = (
  repository: ResolvableRepository,
  treePaths: Array<string>,
) => RepositoryMatchState;

const buildRepositoryMatchState: BuildRepositoryMatchStateFunction = (
  repository: ResolvableRepository,
  treePaths: Array<string>,
): RepositoryMatchState => {
  const basenameCounts: Map<string, number> = new Map();
  const treePathsByBasename: Map<string, Array<string>> = new Map();

  for (const treePath of treePaths) {
    const lastSlashIndex: number = treePath.lastIndexOf("/");
    const basename: string =
      lastSlashIndex === -1 ? treePath : treePath.slice(lastSlashIndex + 1);

    basenameCounts.set(basename, (basenameCounts.get(basename) || 0) + 1);

    const existing: Array<string> | undefined =
      treePathsByBasename.get(basename);

    if (existing) {
      existing.push(treePath);
    } else {
      treePathsByBasename.set(basename, [treePath]);
    }
  }

  return {
    repository,
    basenameCounts,
    treePathsByBasename,
    matches: [],
  };
};

/*
 * Finds the longest suffix of the candidate path present in the repository
 * tree: `src/billing/charge.ts` is tried in full, then `billing/charge.ts`,
 * then `charge.ts`. Every ladder entry shares the candidate's basename, so
 * only tree paths with that basename need checking.
 */
type MatchCandidateAgainstRepositoryFunction = (
  candidatePath: string,
  state: RepositoryMatchState,
) => CandidateSuffixMatch | null;

const matchCandidateAgainstRepository: MatchCandidateAgainstRepositoryFunction =
  (
    candidatePath: string,
    state: RepositoryMatchState,
  ): CandidateSuffixMatch | null => {
    const segments: Array<string> = candidatePath.split("/");
    const basename: string | undefined = segments[segments.length - 1];

    if (!basename) {
      return null;
    }

    const treePaths: Array<string> =
      state.treePathsByBasename.get(basename) || [];

    if (treePaths.length === 0) {
      return null;
    }

    for (let start: number = 0; start < segments.length; start++) {
      const suffix: string = segments.slice(start).join("/");

      const matchedTreePaths: Array<string> = treePaths.filter(
        (treePath: string) => {
          return treePath === suffix || treePath.endsWith(`/${suffix}`);
        },
      );

      if (matchedTreePaths.length > 0) {
        const matchedSegmentCount: number = segments.length - start;

        return {
          candidatePath,
          matchedSuffix: suffix,
          matchedSegmentCount,
          matchedTreePaths,
          isStrongMatch: matchedSegmentCount >= STRONG_MATCH_MIN_SEGMENTS,
        };
      }
    }

    return null;
  };

type TotalMatchedSegmentDepthFunction = (state: RepositoryMatchState) => number;

const totalMatchedSegmentDepth: TotalMatchedSegmentDepthFunction = (
  state: RepositoryMatchState,
): number => {
  return state.matches.reduce((sum: number, match: CandidateSuffixMatch) => {
    return sum + match.matchedSegmentCount;
  }, 0);
};

/*
 * The tree-path prefix shared by every matched file, by whole segments:
 * tree `services/checkout/src/billing/charge.ts` matched by suffix
 * `src/billing/charge.ts` contributes prefix `services/checkout`. Root
 * matches contribute the empty prefix. Null when nothing is common.
 */
type DeepestCommonPrefixFunction = (prefixes: Array<string>) => string | null;

const deepestCommonPrefix: DeepestCommonPrefixFunction = (
  prefixes: Array<string>,
): string | null => {
  let common: Array<string> | null = null;

  for (const prefix of prefixes) {
    const segments: Array<string> = prefix === "" ? [] : prefix.split("/");

    if (common === null) {
      common = segments;
      continue;
    }

    let sharedLength: number = 0;

    while (
      sharedLength < common.length &&
      sharedLength < segments.length &&
      common[sharedLength] === segments[sharedLength]
    ) {
      sharedLength++;
    }

    common = common.slice(0, sharedLength);
  }

  if (!common || common.length === 0) {
    return null;
  }

  return common.join("/");
};

type ResolveViaStackTraceFunction = (
  candidatePaths: Array<string>,
  states: Array<RepositoryMatchState>,
) => RepoResolution | null;

const resolveViaStackTrace: ResolveViaStackTraceFunction = (
  candidatePaths: Array<string>,
  states: Array<RepositoryMatchState>,
): RepoResolution | null => {
  for (const state of states) {
    for (const candidatePath of candidatePaths) {
      const match: CandidateSuffixMatch | null =
        matchCandidateAgainstRepository(candidatePath, state);

      if (match) {
        state.matches.push(match);
      }
    }
  }

  /*
   * Basename-only matches are weak evidence: they count only when the
   * basename exists in exactly one repository AND exactly once in its tree.
   * This needs cross-repository counts, so it runs after all matching.
   */
  for (const state of states) {
    state.matches = state.matches.filter((match: CandidateSuffixMatch) => {
      if (match.isStrongMatch) {
        return true;
      }

      const basename: string = match.matchedSuffix;

      if ((state.basenameCounts.get(basename) || 0) !== 1) {
        return false;
      }

      const existsElsewhere: boolean = states.some(
        (other: RepositoryMatchState) => {
          return (
            other !== state && (other.basenameCounts.get(basename) || 0) > 0
          );
        },
      );

      return !existsElsewhere;
    });
  }

  const scored: Array<RepositoryMatchState> = states.filter(
    (state: RepositoryMatchState) => {
      return state.matches.length > 0;
    },
  );

  scored.sort((a: RepositoryMatchState, b: RepositoryMatchState) => {
    if (b.matches.length !== a.matches.length) {
      return b.matches.length - a.matches.length;
    }
    return totalMatchedSegmentDepth(b) - totalMatchedSegmentDepth(a);
  });

  const winner: RepositoryMatchState | undefined = scored[0];

  if (!winner) {
    return null;
  }

  const runnerUp: RepositoryMatchState | undefined = scored[1];

  // Ambiguity must not guess — a tied score falls through to the next method.
  if (
    runnerUp &&
    runnerUp.matches.length === winner.matches.length &&
    totalMatchedSegmentDepth(runnerUp) === totalMatchedSegmentDepth(winner)
  ) {
    return null;
  }

  const prefixes: Array<string> = [];

  for (const match of winner.matches) {
    for (const treePath of match.matchedTreePaths) {
      prefixes.push(
        treePath === match.matchedSuffix
          ? ""
          : treePath.slice(0, treePath.length - match.matchedSuffix.length - 1),
      );
    }
  }

  const matchedSuffixes: Array<string> = [];

  for (const match of winner.matches) {
    if (!matchedSuffixes.includes(match.matchedSuffix)) {
      matchedSuffixes.push(match.matchedSuffix);
    }
  }

  return {
    codeRepositoryId: winner.repository.id,
    organizationName: winner.repository.organizationName,
    repositoryName: winner.repository.repositoryName,
    servicePathInRepository: deepestCommonPrefix(prefixes),
    method: "stack-trace",
    evidence: `Matched ${matchedSuffixes.join(", ")} in ${
      winner.repository.organizationName
    }/${winner.repository.repositoryName}`,
  };
};

export type ResolveRepositoryForExceptionFixFunction = (data: {
  stackTrace: string | null;
  serviceName: string | null;
  repositories: Array<ResolvableRepository>;
  getTreePaths: (repo: ResolvableRepository) => Promise<Array<string>>;
}) => Promise<RepoResolution | null>;

export const resolveRepositoryForExceptionFix: ResolveRepositoryForExceptionFixFunction =
  async (data: {
    stackTrace: string | null;
    serviceName: string | null;
    repositories: Array<ResolvableRepository>;
    getTreePaths: (repo: ResolvableRepository) => Promise<Array<string>>;
  }): Promise<RepoResolution | null> => {
    // Method 1 — stack trace vs. repository trees.
    if (data.stackTrace && data.repositories.length > 0) {
      const candidatePaths: Array<string> = extractCandidatePathsFromStackTrace(
        data.stackTrace,
      );

      // No candidates → no reason to fetch any tree.
      if (candidatePaths.length > 0) {
        const fetched: Array<RepositoryMatchState | null> = await Promise.all(
          data.repositories.map(
            async (
              repository: ResolvableRepository,
            ): Promise<RepositoryMatchState | null> => {
              try {
                const treePaths: Array<string> =
                  await data.getTreePaths(repository);
                return buildRepositoryMatchState(repository, treePaths);
              } catch {
                // A repository whose tree fetch fails is skipped; the others are still tried.
                return null;
              }
            },
          ),
        );

        const states: Array<RepositoryMatchState> = fetched.filter(
          (
            state: RepositoryMatchState | null,
          ): state is RepositoryMatchState => {
            return state !== null;
          },
        );

        const resolution: RepoResolution | null = resolveViaStackTrace(
          candidatePaths,
          states,
        );

        if (resolution) {
          return resolution;
        }
      }
    }

    // Method 2 — exact service-name match (score 3, unique) via the suggester.
    if (data.serviceName) {
      const suggestions: Array<ServiceRepoLinkSuggestion> =
        computeLinkSuggestions({
          services: [{ id: "exception-service", name: data.serviceName }],
          repositories: data.repositories.map(
            (repository: ResolvableRepository): SuggestableRepository => {
              return {
                id: repository.id,
                name: repository.name,
                repositoryName: repository.repositoryName,
                organizationName: repository.organizationName,
              };
            },
          ),
          existingLinks: [],
        });

      const exactMatches: Array<ServiceRepoLinkSuggestion> = suggestions.filter(
        (suggestion: ServiceRepoLinkSuggestion) => {
          return suggestion.score === EXACT_NAME_MATCH_SCORE;
        },
      );

      const exactMatch: ServiceRepoLinkSuggestion | undefined = exactMatches[0];

      if (exactMatches.length === 1 && exactMatch) {
        const repository: ResolvableRepository | undefined =
          data.repositories.find((candidate: ResolvableRepository) => {
            return candidate.id === exactMatch.codeRepositoryId;
          });

        if (repository) {
          return {
            codeRepositoryId: repository.id,
            organizationName: repository.organizationName,
            repositoryName: repository.repositoryName,
            servicePathInRepository: null,
            method: "name-match",
            evidence: exactMatch.reason,
          };
        }
      }
    }

    // Method 3 — a single connected repository is unambiguous by definition.
    const onlyRepository: ResolvableRepository | undefined =
      data.repositories[0];

    if (data.repositories.length === 1 && onlyRepository) {
      return {
        codeRepositoryId: onlyRepository.id,
        organizationName: onlyRepository.organizationName,
        repositoryName: onlyRepository.repositoryName,
        servicePathInRepository: null,
        method: "only-repository",
        evidence: "Only repository connected to this project",
      };
    }

    return null;
  };
