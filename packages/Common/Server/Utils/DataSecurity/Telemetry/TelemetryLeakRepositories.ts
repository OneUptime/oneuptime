import { DataSecurityTelemetryFixRepositoryChoice } from "../../../../Types/DataSecurity/DataSecurityApiTypes";
import {
  TelemetryLeakFixLeak,
  TelemetryLeakFrame,
  TelemetryLeakPlace,
} from "../../../../Types/DataSecurity/TelemetryLeakFix";
import {
  createRepositoryResolver,
  matchPathInTree,
  RepoResolution,
  RepositoryResolver,
  ResolvableRepository,
} from "../../CodeRepository/StackTraceRepoResolver";

/*
 * WHICH REPOSITORY, AND WHICH FOLDER OF IT, A SERVICE'S TELEMETRY LEAKS ARE
 * FIXED IN (#10367).
 *
 * There is no service-to-repository table: a fix finds its repository from
 * the facts of what it fixes, as every fix does (StackTraceRepoResolver):
 *
 *   1. each leak's places - the files and lines its records name, an
 *      exception's own frames - matched against every connected
 *      repository's tree, by the longest suffix;
 *   2. a leak whose records name no file goes where the service's other
 *      leaks are;
 *   3. a RUM application's (#10933): where the files its newest release's
 *      source maps name are - the repository whose tree holds the most of
 *      them;
 *   4. else to the repository named like the service, or the project's
 *      only repository;
 *   5. else nowhere: a person picks.
 *
 * Leaks found in two repositories make two fixes - one pull request per
 * service and repository. The folder is the one the matched files share
 * (a monorepo's subdirectory), else the service's folder Production Review
 * keeps (ProductionReviewScope, handed in as getServiceFolder). A place's
 * file is named as the repository holds it: "/app/src/signup.ts" from a
 * container is "services/checkout/src/signup.ts".
 *
 * Pure: the trees and the folder are read through what the caller hands
 * in, each tree once.
 */

// A leak as it is chosen a repository for: everything but how it is fixed.
export type TelemetryLeakToPlace = Omit<TelemetryLeakFixLeak, "handling">;

export interface TelemetryLeakRepositoryGroup {
  // Null when nothing decides: a person picks.
  repository: ResolvableRepository | null;
  choice: DataSecurityTelemetryFixRepositoryChoice | null;
  // The service's folder in the repository, or null for its root.
  folder: string | null;
  leaks: Array<TelemetryLeakToPlace>;
}

/*
 * A leak's places as a stack trace the resolver reads: each file it names,
 * with its line, the frames of an exception included. Null when it names
 * no file.
 */
export function getTelemetryLeakStackTrace(
  leak: Pick<TelemetryLeakToPlace, "places">,
): string | null {
  const lines: Array<string> = [];

  const add: (frame: TelemetryLeakFrame) => void = (
    frame: TelemetryLeakFrame,
  ): void => {
    const line: string = `    at ${frame.functionName ? `${frame.functionName} ` : ""}(${frame.filePath}:${frame.lineNumber ?? 1})`;

    if (!lines.includes(line)) {
      lines.push(line);
    }
  };

  for (const place of leak.places) {
    if (place.filePath) {
      add({
        filePath: place.filePath,
        functionName: place.functionName,
        lineNumber: place.lineNumber,
      });
    }

    for (const frame of place.frames || []) {
      add(frame);
    }
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

/*
 * The repository whose tree holds the most of an application's files - as
 * its source maps name them - and the folder they sit under there, as a
 * stack's files say a service's (tree apps/web/src/a.js holding src/a.js
 * is under apps/web); null when no tree holds one, or two hold as many.
 */
export function chooseRepositoryOfFiles(data: {
  files: ReadonlyArray<string>;
  trees: ReadonlyArray<{ id: string; tree: ReadonlyArray<string> | null }>;
}): { id: string; folder: string | null } | null {
  const ranked: Array<{ id: string; paths: Array<string> }> = [];

  for (const candidate of data.trees) {
    if (!candidate.tree || candidate.tree.length === 0) {
      continue;
    }

    // The folder each file sits under: its tree path less the part of it the file's path matched.
    const paths: Array<string> = [];

    for (const file of data.files) {
      const match: {
        matchedTreePaths: Array<string>;
        matchedSegmentCount: number;
      } | null = matchPathInTree(file, [...candidate.tree]);

      if (match && match.matchedTreePaths.length === 1) {
        const segments: Array<string> = match.matchedTreePaths[0]!.split("/");

        paths.push(
          segments
            .slice(0, Math.max(0, segments.length - match.matchedSegmentCount))
            .join("/"),
        );
      }
    }

    if (paths.length > 0) {
      ranked.push({ id: candidate.id, paths });
    }
  }

  ranked.sort(
    (
      left: { id: string; paths: Array<string> },
      right: { id: string; paths: Array<string> },
    ): number => {
      return right.paths.length - left.paths.length;
    },
  );

  const best: { id: string; paths: Array<string> } | undefined = ranked[0];

  if (!best || (ranked[1] && ranked[1].paths.length === best.paths.length)) {
    return null;
  }

  return { id: best.id, folder: sharedFolder(best.paths) };
}

// The repository-relative path every one of `paths` sits under, or null.
function sharedFolder(paths: ReadonlyArray<string>): string | null {
  if (paths.length === 0) {
    return null;
  }

  let shared: Array<string> = paths[0]!.split("/");

  for (const path of paths.slice(1)) {
    const parts: Array<string> = path.split("/");
    let length: number = 0;

    while (
      length < shared.length &&
      length < parts.length &&
      shared[length] === parts[length]
    ) {
      length++;
    }

    shared = shared.slice(0, length);
  }

  const folder: string = shared.filter(Boolean).join("/");

  return folder || null;
}

/*
 * A file a record names, as the repository holds it: the one tree path its
 * longest suffix matches - under the folder, when several do - or the path
 * as it was, when the tree does not say.
 */
export function toRepositoryPath(data: {
  filePath: string;
  tree: ReadonlyArray<string> | null;
  folder: string | null;
}): string {
  if (!data.tree) {
    return data.filePath;
  }

  const match: {
    matchedTreePaths: Array<string>;
  } | null = matchPathInTree(data.filePath, [...data.tree]);

  if (!match || match.matchedTreePaths.length === 0) {
    return data.filePath;
  }

  if (match.matchedTreePaths.length === 1) {
    return match.matchedTreePaths[0]!;
  }

  const underFolder: Array<string> = data.folder
    ? match.matchedTreePaths.filter((path: string): boolean => {
        return path.startsWith(`${data.folder}/`);
      })
    : [];

  return underFolder.length === 1 ? underFolder[0]! : data.filePath;
}

// A leak's places, each file named as the repository holds it.
function inRepository(
  leak: TelemetryLeakToPlace,
  tree: ReadonlyArray<string> | null,
  folder: string | null,
): TelemetryLeakToPlace {
  return {
    ...leak,
    places: leak.places.map((place: TelemetryLeakPlace): TelemetryLeakPlace => {
      return {
        ...place,
        ...(place.filePath
          ? {
              filePath: toRepositoryPath({
                filePath: place.filePath,
                tree,
                folder,
              }),
            }
          : {}),
        ...(place.frames
          ? {
              frames: place.frames.map(
                (frame: TelemetryLeakFrame): TelemetryLeakFrame => {
                  return {
                    ...frame,
                    filePath: toRepositoryPath({
                      filePath: frame.filePath,
                      tree,
                      folder,
                    }),
                  };
                },
              ),
            }
          : {}),
      };
    }),
  };
}

const NAME_CHOICES: Readonly<
  Record<RepoResolution["method"], DataSecurityTelemetryFixRepositoryChoice>
> = {
  "stack-trace": DataSecurityTelemetryFixRepositoryChoice.StackTrace,
  "name-match": DataSecurityTelemetryFixRepositoryChoice.NameMatch,
  "only-repository": DataSecurityTelemetryFixRepositoryChoice.OnlyRepository,
};

/*
 * The repositories a service's leaks are fixed in, and the leaks each
 * fixes (see the module comment). Leaks the files of no repository match,
 * with nothing else to decide, are one group with no repository.
 */
export async function chooseTelemetryLeakRepositories(data: {
  leaks: ReadonlyArray<TelemetryLeakToPlace>;
  serviceName: string;
  repositories: ReadonlyArray<ResolvableRepository>;
  getTreePaths: (repository: ResolvableRepository) => Promise<Array<string>>;
  getServiceFolder: (
    repository: ResolvableRepository,
  ) => Promise<string | null>;
  /*
   * A RUM application's own files, as its newest release's source maps
   * name them (#10933): the repository that holds them is where its leaks
   * are fixed, when their records name no file.
   */
  appFiles?: ReadonlyArray<string> | undefined;
}): Promise<Array<TelemetryLeakRepositoryGroup>> {
  if (data.leaks.length === 0) {
    return [];
  }

  if (data.repositories.length === 0) {
    return [
      { repository: null, choice: null, folder: null, leaks: [...data.leaks] },
    ];
  }

  // Each repository's tree once: null where it cannot be read.
  const trees: Map<string, Promise<Array<string> | null>> = new Map();
  const treeOf: (
    repository: ResolvableRepository,
  ) => Promise<Array<string> | null> = (
    repository: ResolvableRepository,
  ): Promise<Array<string> | null> => {
    let tree: Promise<Array<string> | null> | undefined = trees.get(
      repository.id,
    );

    if (!tree) {
      tree = data.getTreePaths(repository).then(
        (paths: Array<string>): Array<string> => {
          return paths;
        },
        (): null => {
          return null;
        },
      );
      trees.set(repository.id, tree);
    }

    return tree;
  };
  const resolver: RepositoryResolver = createRepositoryResolver({
    repositories: [...data.repositories],
    getTreePaths: async (
      repository: ResolvableRepository,
    ): Promise<Array<string>> => {
      const tree: Array<string> | null = await treeOf(repository);

      if (!tree) {
        throw new Error("This repository's files are not read.");
      }

      return tree;
    },
  });
  const byId: Map<string, ResolvableRepository> = new Map(
    data.repositories.map(
      (repository: ResolvableRepository): [string, ResolvableRepository] => {
        return [repository.id, repository];
      },
    ),
  );

  // 1. Each leak by its own files.
  const resolved: Array<RepoResolution | null> = [];

  for (const leak of data.leaks) {
    const stackTrace: string | null = getTelemetryLeakStackTrace(leak);
    const resolution: RepoResolution | null = stackTrace
      ? await resolver.resolve({ stackTrace, serviceName: null })
      : null;

    resolved.push(
      resolution && resolution.method === "stack-trace" ? resolution : null,
    );
  }

  // 2. Where most of the service's leaks are, by their files.
  const counts: Map<string, number> = new Map();

  for (const resolution of resolved) {
    if (resolution) {
      counts.set(
        resolution.codeRepositoryId,
        (counts.get(resolution.codeRepositoryId) || 0) + 1,
      );
    }
  }

  const ranked: Array<[string, number]> = Array.from(counts.entries()).sort(
    (left: [string, number], right: [string, number]): number => {
      return right[1] - left[1];
    },
  );
  const mostLeaks: string | null =
    ranked.length > 0 && (ranked.length === 1 || ranked[0]![1] > ranked[1]![1])
      ? ranked[0]![0]
      : null;

  // 3. A RUM application's: where the files its source maps name are.
  const bySourceMaps: { id: string; folder: string | null } | null =
    mostLeaks === null && data.appFiles && data.appFiles.length > 0
      ? chooseRepositoryOfFiles({
          files: data.appFiles,
          trees: await Promise.all(
            data.repositories.map(
              async (
                repository: ResolvableRepository,
              ): Promise<{ id: string; tree: Array<string> | null }> => {
                return { id: repository.id, tree: await treeOf(repository) };
              },
            ),
          ),
        })
      : null;

  // 4. By the service's name, or the only repository.
  const byName: RepoResolution | null =
    mostLeaks === null && bySourceMaps === null
      ? await resolver.resolve({
          stackTrace: null,
          serviceName: data.serviceName || null,
        })
      : null;

  const fallbackId: string | null =
    mostLeaks || bySourceMaps?.id || byName?.codeRepositoryId || null;
  const fallbackChoice: DataSecurityTelemetryFixRepositoryChoice | null =
    mostLeaks
      ? DataSecurityTelemetryFixRepositoryChoice.ServiceLeaks
      : bySourceMaps
        ? DataSecurityTelemetryFixRepositoryChoice.SourceMaps
        : byName
          ? NAME_CHOICES[byName.method]
          : null;

  const groups: Map<
    string,
    {
      leaks: Array<TelemetryLeakToPlace>;
      byFiles: Array<RepoResolution>;
    }
  > = new Map();

  data.leaks.forEach((leak: TelemetryLeakToPlace, index: number): void => {
    const resolution: RepoResolution | null = resolved[index] || null;
    const key: string = resolution?.codeRepositoryId || fallbackId || "";
    const group: {
      leaks: Array<TelemetryLeakToPlace>;
      byFiles: Array<RepoResolution>;
    } = groups.get(key) || { leaks: [], byFiles: [] };

    group.leaks.push(leak);

    if (resolution) {
      group.byFiles.push(resolution);
    }

    groups.set(key, group);
  });

  const chosen: Array<TelemetryLeakRepositoryGroup> = [];

  for (const [repositoryId, group] of groups) {
    const repository: ResolvableRepository | null =
      byId.get(repositoryId) || null;

    if (!repository) {
      chosen.push({
        repository: null,
        choice: null,
        folder: null,
        leaks: group.leaks,
      });
      continue;
    }

    // The folder the matched files share, else Production Review's folder.
    const matchedFolders: Array<string> = group.byFiles
      .map((resolution: RepoResolution): string => {
        return resolution.servicePathInRepository || "";
      })
      .filter(Boolean);
    let folder: string | null =
      matchedFolders.length === group.byFiles.length
        ? sharedFolder(matchedFolders)
        : null;

    // A RUM application's files, as its source maps name them, where its leaks name none.
    if (
      !folder &&
      group.byFiles.length === 0 &&
      bySourceMaps &&
      bySourceMaps.id === repositoryId
    ) {
      folder = bySourceMaps.folder;
    }

    if (!folder) {
      try {
        folder = await data.getServiceFolder(repository);
      } catch {
        folder = null;
      }
    }

    const tree: Array<string> | null = await treeOf(repository);

    chosen.push({
      repository,
      choice:
        group.byFiles.length > 0
          ? DataSecurityTelemetryFixRepositoryChoice.StackTrace
          : fallbackChoice,
      folder: folder || null,
      leaks: group.leaks.map(
        (leak: TelemetryLeakToPlace): TelemetryLeakToPlace => {
          return inRepository(leak, tree, folder || null);
        },
      ),
    });
  }

  return chosen;
}
