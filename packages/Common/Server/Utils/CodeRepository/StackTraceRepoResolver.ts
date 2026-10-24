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
import {
  isAsciiLetterCode,
  isDigitCode,
  isWordCode,
} from "../../../Utils/RegExpCharacterClasses";

const WINDOWS_DRIVE_RE: RegExp = /^[A-Za-z]:\//;
const FILE_EXTENSION_RE: RegExp = /\.[A-Za-z0-9]+$/;

export interface ResolvableRepository {
  id: string;
  name: string;
  organizationName: string;
  repositoryName: string;
  mainBranchName: string;
  gitHubAppInstallationId: string | null;
  /*
   * Where it is hosted (CodeRepositoryType), which decides how its tree is
   * read. Absent: GitHub, through gitHubAppInstallationId.
   */
  repositoryHostedAt?: string | undefined;
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
 *
 * Found exactly as the global pattern
 *   ((?:[A-Za-z]:)?[\w.\-/\\@+~]+\.[A-Za-z][A-Za-z0-9]{0,9}):\d+
 * found them (group 1 of each match, left to right), in time in line with
 * the line's length. That pattern was tried again from every character of a
 * run of path characters, each try reading on to the end of the run - a
 * stack trace is whatever an application sent, and a long run with no
 * ":<line>" after its extension took time that grows with the square of its
 * length. Here each run is read a fixed number of times: a ":" cannot be a
 * path character, so every start in a run reaches the same end, and the
 * run's first start that can work is the only one to ask.
 */
const DOT: number = 0x2e;
const COLON: number = 0x3a;

// The path characters other than \w and ".": - / \ @ + ~
const OTHER_PATH_CODES: ReadonlySet<number> = new Set<number>([
  0x2d, 0x2f, 0x5c, 0x40, 0x2b, 0x7e,
]);

type IsPathCodeFunction = (code: number) => boolean;

// A path character, as [\w.\-/\\@+~] matches it.
const isPathCode: IsPathCodeFunction = (code: number): boolean => {
  return isWordCode(code) || code === DOT || OTHER_PATH_CODES.has(code);
};

// The longest extension: [A-Za-z][A-Za-z0-9]{0,9}.
const MAX_EXTENSION_LENGTH: number = 10;

type LocationEndFunction = (
  line: string,
  firstDot: number,
  runEnd: number,
) => number;

/*
 * Where ".<extension>:<digits>" ends, for a run of path characters that ends
 * at `runEnd` - the extension runs from its last "." to the run's end, and a
 * ":" and a digit follow - or -1. The "." may be no earlier than `firstDot`,
 * so the path before it is not empty.
 */
const locationEnd: LocationEndFunction = (
  line: string,
  firstDot: number,
  runEnd: number,
): number => {
  if (
    line.charCodeAt(runEnd) !== COLON ||
    !isDigitCode(line.charCodeAt(runEnd + 1))
  ) {
    return -1;
  }

  // The extension holds no ".", so it starts after the run's last one.
  let dot: number = runEnd - 1;
  const earliestDot: number = Math.max(
    firstDot,
    runEnd - 1 - MAX_EXTENSION_LENGTH,
  );

  while (dot >= earliestDot && line.charCodeAt(dot) !== DOT) {
    dot--;
  }

  if (dot < earliestDot || dot === runEnd - 1) {
    return -1;
  }

  if (!isAsciiLetterCode(line.charCodeAt(dot + 1))) {
    return -1;
  }

  for (let index: number = dot + 2; index < runEnd; index++) {
    const code: number = line.charCodeAt(index);

    if (!isAsciiLetterCode(code) && !isDigitCode(code)) {
      return -1;
    }
  }

  let end: number = runEnd + 1;

  while (end < line.length && isDigitCode(line.charCodeAt(end))) {
    end++;
  }

  return end;
};

type PathRunEndFunction = (line: string, from: number) => number;

const pathRunEnd: PathRunEndFunction = (line: string, from: number): number => {
  let index: number = from;

  while (index < line.length && isPathCode(line.charCodeAt(index))) {
    index++;
  }

  return index;
};

export type FindPathsWithLineNumberFunction = (line: string) => Array<string>;

export const findPathsWithLineNumber: FindPathsWithLineNumberFunction = (
  line: string,
): Array<string> => {
  const paths: Array<string> = [];
  let position: number = 0;

  while (position < line.length) {
    let start: number = position;

    while (start < line.length && !isPathCode(line.charCodeAt(start))) {
      start++;
    }

    if (start >= line.length) {
      break;
    }

    const runEnd: number = pathRunEnd(line, start);

    // From the run's first character, with no drive letter.
    if (start < runEnd - 1) {
      const end: number = locationEnd(line, start + 1, runEnd);

      if (end !== -1) {
        paths.push(line.slice(start, runEnd));
        position = end;
        continue;
      }
    }

    /*
     * From its last character, as a drive letter ("C:"): the path is the run
     * after the ":". No other start in the run can work.
     */
    const driveLetter: number = runEnd - 1;

    if (
      isAsciiLetterCode(line.charCodeAt(driveLetter)) &&
      line.charCodeAt(runEnd) === COLON &&
      isPathCode(line.charCodeAt(runEnd + 1))
    ) {
      const pathEnd: number = pathRunEnd(line, runEnd + 1);
      const end: number = locationEnd(line, runEnd + 2, pathEnd);

      if (end !== -1) {
        paths.push(line.slice(driveLetter, pathEnd));
        position = end;
        continue;
      }
    }

    position = runEnd;
  }

  return paths;
};

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

      for (const path of findPathsWithLineNumber(line)) {
        rawPaths.push(path);
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

/*
 * Where one candidate path (already normalized: relative, forward slashes)
 * sits in a repository's tree: the tree paths that end with its longest
 * matching suffix, and how many segments matched. Null when not even its
 * file name is in the tree. Exported for the profile frames' source links
 * (SourceLocator), which match one file at a time.
 */
export type MatchPathInTreeFunction = (
  candidatePath: string,
  treePaths: Array<string>,
) => {
  matchedTreePaths: Array<string>;
  matchedSegmentCount: number;
  isStrongMatch: boolean;
  isUniqueBasename: boolean;
} | null;

export const matchPathInTree: MatchPathInTreeFunction = (
  candidatePath: string,
  treePaths: Array<string>,
): {
  matchedTreePaths: Array<string>;
  matchedSegmentCount: number;
  isStrongMatch: boolean;
  isUniqueBasename: boolean;
} | null => {
  const state: RepositoryMatchState = buildRepositoryMatchState(
    {
      id: "",
      name: "",
      organizationName: "",
      repositoryName: "",
      mainBranchName: "",
      gitHubAppInstallationId: null,
    },
    treePaths,
  );
  const match: CandidateSuffixMatch | null = matchCandidateAgainstRepository(
    candidatePath,
    state,
  );

  if (!match) {
    return null;
  }

  const segments: Array<string> = candidatePath.split("/");
  const basename: string = segments[segments.length - 1] || "";

  return {
    matchedTreePaths: match.matchedTreePaths,
    matchedSegmentCount: match.matchedSegmentCount,
    isStrongMatch: match.isStrongMatch,
    isUniqueBasename: (state.basenameCounts.get(basename) || 0) === 1,
  };
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
    return await createRepositoryResolver({
      repositories: data.repositories,
      getTreePaths: data.getTreePaths,
    }).resolve({
      stackTrace: data.stackTrace,
      serviceName: data.serviceName,
    });
  };

/*
 * The same resolution, for many stack traces and service names against the
 * same repositories: each repository's tree is fetched and indexed once, the
 * first time a stack trace needs it, rather than once per stack trace. What
 * the services a repository serves are is worked out this way
 * (CodeAgentTelemetryScope), reading every service's facts in turn.
 */
export interface RepositoryResolver {
  resolve(data: {
    stackTrace: string | null;
    serviceName: string | null;
  }): Promise<RepoResolution | null>;
}

export type CreateRepositoryResolverFunction = (data: {
  repositories: Array<ResolvableRepository>;
  getTreePaths: (repo: ResolvableRepository) => Promise<Array<string>>;
}) => RepositoryResolver;

export const createRepositoryResolver: CreateRepositoryResolverFunction =
  (data: {
    repositories: Array<ResolvableRepository>;
    getTreePaths: (repo: ResolvableRepository) => Promise<Array<string>>;
  }): RepositoryResolver => {
    let indexedTrees: Promise<Array<RepositoryMatchState>> | null = null;

    /*
     * Every repository's tree, indexed - fetched on the first stack trace
     * that has a candidate path, and kept. A repository whose tree fetch
     * fails is left out; the others are still tried.
     */
    const getIndexedTrees: () => Promise<
      Array<RepositoryMatchState>
    > = (): Promise<Array<RepositoryMatchState>> => {
      if (!indexedTrees) {
        indexedTrees = Promise.all(
          data.repositories.map(
            async (
              repository: ResolvableRepository,
            ): Promise<RepositoryMatchState | null> => {
              try {
                const treePaths: Array<string> =
                  await data.getTreePaths(repository);
                return buildRepositoryMatchState(repository, treePaths);
              } catch {
                return null;
              }
            },
          ),
        ).then(
          (
            fetched: Array<RepositoryMatchState | null>,
          ): Array<RepositoryMatchState> => {
            return fetched.filter(
              (
                state: RepositoryMatchState | null,
              ): state is RepositoryMatchState => {
                return state !== null;
              },
            );
          },
        );
      }

      return indexedTrees;
    };

    return {
      resolve: async (facts: {
        stackTrace: string | null;
        serviceName: string | null;
      }): Promise<RepoResolution | null> => {
        // Method 1 — stack trace vs. repository trees.
        if (facts.stackTrace && data.repositories.length > 0) {
          const candidatePaths: Array<string> =
            extractCandidatePathsFromStackTrace(facts.stackTrace);

          // No candidates → no reason to fetch any tree.
          if (candidatePaths.length > 0) {
            /*
             * A fresh list of matches for each stack trace over the same
             * indexes: matching reads the indexes and writes only the
             * matches.
             */
            const states: Array<RepositoryMatchState> = (
              await getIndexedTrees()
            ).map((state: RepositoryMatchState): RepositoryMatchState => {
              return { ...state, matches: [] };
            });

            const resolution: RepoResolution | null = resolveViaStackTrace(
              candidatePaths,
              states,
            );

            if (resolution) {
              return resolution;
            }
          }
        }

        return resolveWithoutStackTrace({
          serviceName: facts.serviceName,
          repositories: data.repositories,
        });
      },
    };
  };

type ResolveWithoutStackTraceFunction = (data: {
  serviceName: string | null;
  repositories: Array<ResolvableRepository>;
}) => RepoResolution | null;

// Methods 2 and 3, for facts no stack trace resolved.
const resolveWithoutStackTrace: ResolveWithoutStackTraceFunction = (data: {
  serviceName: string | null;
  repositories: Array<ResolvableRepository>;
}): RepoResolution | null => {
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
  const onlyRepository: ResolvableRepository | undefined = data.repositories[0];

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
