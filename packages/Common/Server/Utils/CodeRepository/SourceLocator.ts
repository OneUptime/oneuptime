import CodeRepositoryService from "../../Services/CodeRepositoryService";
import CodeTaskAccess from "../AI/CodeTask/CodeTaskAccess";
import CaptureSpan from "../Telemetry/CaptureSpan";
import logger from "../Logger";
import GitHubUtil from "./GitHub/GitHub";
import CodeHostAccess, {
  CODE_HOST_REPOSITORY_SELECT,
  CodeHostConnectionState,
  CodeHostConnectionSummary,
  CodeHostReader,
} from "./CodeHost/CodeHostAccess";
import {
  matchPathInTree,
  normalizeCandidatePath,
} from "./StackTraceRepoResolver";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import {
  CodeHost,
  CodeHostCapability,
} from "../../../Types/CodeRepository/CodeHost";
import QueryHelper from "../../Types/Database/QueryHelper";
import ObjectID from "../../../Types/ObjectID";

/*
 * WHERE A RUNNING FUNCTION'S FILE LIVES IN THE PROJECT'S CODE.
 *
 * A profile frame names a file as the running process saw it - an absolute
 * path in a container ("/app/src/orders/parser.ts"), a path under a build
 * directory, a Windows path. The project's repositories name it relative to
 * their root ("src/orders/parser.ts"). This finds, for each frame, the
 * repository and path that hold it, and a link to the line on its host
 * (GitHub, GitLab, Forgejo or Gitea):
 *
 *   - only repositories the person may read, that OneUptime reaches and
 *     whose files it reads (CodeHostAccess): through the GitHub App, its
 *     installation still bound to this project - a tree is read with the
 *     App's token, so an unbound row would read another tenant's code - or
 *     through the repository's connection, whose token was not refused. A
 *     Git repository's files are not read, so it gets no link;
 *   - the frame's path is normalized the way stack-trace resolution does it
 *     (container prefixes off; a library's file, under node_modules or
 *     site-packages, is nobody's own code and gets no link), then matched by
 *     its longest suffix in each tree;
 *   - a match is used when it is strong (two or more path segments), or
 *     when it is the file name alone but that name is found once, in one
 *     repository only. Two repositories that match a frame equally well
 *     leave it without a link: a link that might be the wrong file is worse
 *     than none.
 *
 * The trees are cached (GitHubUtil.getRepositoryTreePaths, CodeHostAccess),
 * so a page that asks for the same repositories again calls no host.
 */

export interface SourceFrame {
  fileName: string;
  lineNumber?: number | undefined;
}

export interface SourceLink {
  // The frame as it was asked for.
  fileName: string;
  lineNumber: number;
  repositoryId: string;
  repositoryName: string;
  // The file's path in the repository.
  path: string;
  // The file (and line) on its host, on the repository's main branch.
  url: string;
}

export interface LocatableRepository {
  id: string;
  name: string;
  organizationName: string;
  repositoryName: string;
  mainBranchName: string;
  repositoryUrl?: string | undefined;
  // Where it is hosted (CodeRepositoryType); absent is GitHub.
  repositoryHostedAt?: string | undefined;
}

// A repository whose tree OneUptime reads for the person, and how.
export type LocatableRepositoryWithTree = LocatableRepository & {
  // GitHub: the installation bound to the project, the tree is read with.
  gitHubAppInstallationId?: string | undefined;
  // Any other host: the project, its reader is found in.
  projectId?: string | undefined;
};

// The most repositories whose trees one request reads.
export const MAX_REPOSITORIES_PROBED: number = 10;

// The most frames one request locates.
export const MAX_FRAMES_LOCATED: number = 50;

export default class SourceLocator {
  /*
   * Each frame's file in the repositories, given their trees: pure apart
   * from the injected tree read, so it is tested on fixtures.
   */
  public static async matchFrames(data: {
    frames: Array<SourceFrame>;
    repositories: Array<LocatableRepository>;
    getTreePaths: (repository: LocatableRepository) => Promise<Array<string>>;
  }): Promise<Array<SourceLink>> {
    const frames: Array<SourceFrame> = data.frames.slice(0, MAX_FRAMES_LOCATED);

    const candidates: Array<{ frame: SourceFrame; path: string }> = [];

    for (const frame of frames) {
      const path: string | null = normalizeCandidatePath(frame.fileName || "");

      if (path) {
        candidates.push({ frame, path });
      }
    }

    if (candidates.length === 0 || data.repositories.length === 0) {
      return [];
    }

    const trees: Array<{
      repository: LocatableRepository;
      treePaths: Array<string>;
    }> = [];

    for (const repository of data.repositories.slice(
      0,
      MAX_REPOSITORIES_PROBED,
    )) {
      try {
        trees.push({
          repository,
          treePaths: await data.getTreePaths(repository),
        });
      } catch (error) {
        // A repository whose tree cannot be read is skipped; the rest still count.
        logger.debug(error);
      }
    }

    const links: Array<SourceLink> = [];

    for (const candidate of candidates) {
      const matches: Array<{
        repository: LocatableRepository;
        treePath: string;
        segments: number;
        isStrong: boolean;
        isUniqueBasename: boolean;
      }> = [];

      for (const tree of trees) {
        const match: ReturnType<typeof matchPathInTree> = matchPathInTree(
          candidate.path,
          tree.treePaths,
        );

        if (!match || match.matchedTreePaths.length !== 1) {
          continue;
        }

        matches.push({
          repository: tree.repository,
          treePath: match.matchedTreePaths[0]!,
          segments: match.matchedSegmentCount,
          isStrong: match.isStrongMatch,
          isUniqueBasename: match.isUniqueBasename,
        });
      }

      const best: number = Math.max(
        0,
        ...matches.map((match: { segments: number }): number => {
          return match.segments;
        }),
      );
      const bestMatches: Array<(typeof matches)[number]> = matches.filter(
        (match: { segments: number }): boolean => {
          return match.segments === best;
        },
      );

      // Two repositories as likely as each other: no link.
      if (bestMatches.length !== 1) {
        continue;
      }

      const winner: (typeof matches)[number] = bestMatches[0]!;

      if (
        !winner.isStrong &&
        !(winner.isUniqueBasename && matches.length === 1)
      ) {
        continue;
      }

      const lineNumber: number = Math.max(
        0,
        Math.floor(Number(candidate.frame.lineNumber) || 0),
      );

      links.push({
        fileName: candidate.frame.fileName,
        lineNumber,
        repositoryId: winner.repository.id,
        repositoryName: winner.repository.name,
        path: winner.treePath,
        url: SourceLocator.getFileUrl(
          winner.repository,
          winner.treePath,
          lineNumber,
        ),
      });
    }

    return links;
  }

  /*
   * The file on its host, on the repository's main branch, at its line:
   * GitHub's, GitLab's, Forgejo's or Gitea's page for it.
   */
  public static getFileUrl(
    repository: LocatableRepository,
    path: string,
    lineNumber: number,
  ): string {
    const type: CodeRepositoryType = CodeHost.readType(
      repository.repositoryHostedAt,
    );

    if (type !== CodeRepositoryType.GitHub) {
      return (
        CodeHost.getFileWebUrl({
          type,
          webUrl: repository.repositoryUrl,
          branchName: repository.mainBranchName || "main",
          path,
          lineNumber,
        }) || ""
      );
    }

    let base: string =
      repository.repositoryUrl ||
      `https://github.com/${encodeURIComponent(repository.organizationName)}/${encodeURIComponent(repository.repositoryName)}`;

    while (base.endsWith("/")) {
      base = base.substring(0, base.length - 1);
    }

    const encodedPath: string = path
      .split("/")
      .map((segment: string): string => {
        return encodeURIComponent(segment);
      })
      .join("/");

    const branch: string = encodeURIComponent(
      repository.mainBranchName || "main",
    );

    return `${base}/blob/${branch}/${encodedPath}${lineNumber > 0 ? `#L${lineNumber}` : ""}`;
  }

  /*
   * The repositories a person may read whose files OneUptime reads in this
   * project (CodeHostAccess): the only ones whose trees are read for them.
   */
  @CaptureSpan()
  public static async getLocatableRepositories(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<LocatableRepositoryWithTree>> {
    const readable: Array<CodeRepository> =
      await CodeTaskAccess.listReadableRepositories({
        props: data.props,
        projectId: data.projectId,
      });

    if (readable.length === 0) {
      return [];
    }

    const readableIds: Array<ObjectID> = readable.map(
      (repository: CodeRepository): ObjectID => {
        return repository.id!;
      },
    );

    const summaries: Map<string, CodeHostConnectionSummary> =
      await CodeHostAccess.getConnectionSummaries({
        projectId: data.projectId,
        repositoryIds: readableIds,
      });

    // The installation id is not every reader's to see: it is read as root.
    const rows: Array<CodeRepository> = await CodeRepositoryService.findBy({
      query: {
        _id: QueryHelper.any(readableIds),
        projectId: data.projectId,
      },
      select: { ...CODE_HOST_REPOSITORY_SELECT, name: true },
      limit: readable.length,
      skip: 0,
      props: { isRoot: true },
    });

    return rows
      .filter((repository: CodeRepository): boolean => {
        const summary: CodeHostConnectionSummary | undefined = repository.id
          ? summaries.get(repository.id.toString())
          : undefined;

        return Boolean(
          repository.id &&
            repository.organizationName &&
            repository.repositoryName &&
            summary &&
            summary.state === CodeHostConnectionState.Connected &&
            summary.isReachableFromServer &&
            CodeHost.can(summary.provider, CodeHostCapability.ReadCode),
        );
      })
      .map((repository: CodeRepository): LocatableRepositoryWithTree => {
        const type: CodeRepositoryType = CodeHost.readType(
          repository.repositoryHostedAt,
        );

        const locatable: LocatableRepositoryWithTree = {
          id: repository.id!.toString(),
          name: repository.name || repository.repositoryName || "",
          organizationName: repository.organizationName || "",
          repositoryName: repository.repositoryName || "",
          mainBranchName: repository.mainBranchName || "main",
          repositoryHostedAt: type,
        };

        if (type === CodeRepositoryType.GitHub) {
          locatable.gitHubAppInstallationId =
            repository.gitHubAppInstallationId || "";
        } else {
          locatable.projectId = data.projectId.toString();
        }

        if (repository.repositoryUrl) {
          locatable.repositoryUrl = repository.repositoryUrl.toString();
        }

        return locatable;
      });
  }

  /*
   * A locatable repository's tree: GitHub's through the installation, any
   * other host's through its reader (both cached).
   */
  public static async getTreePaths(
    repository: LocatableRepositoryWithTree,
  ): Promise<Array<string>> {
    if (
      CodeHost.readType(repository.repositoryHostedAt) ===
      CodeRepositoryType.GitHub
    ) {
      return await GitHubUtil.getRepositoryTreePaths({
        installationId: repository.gitHubAppInstallationId || "",
        organizationName: repository.organizationName,
        repositoryName: repository.repositoryName,
        branchName: repository.mainBranchName,
      });
    }

    const reader: CodeHostReader | null = repository.projectId
      ? await CodeHostAccess.getReader({
          projectId: new ObjectID(repository.projectId),
          repositoryId: new ObjectID(repository.id),
        })
      : null;

    if (!reader || !reader.canReadCode) {
      return [];
    }

    return await reader.getTreePaths(repository.mainBranchName);
  }

  /*
   * Each frame's file in the repositories the person may read, with a link
   * to its line. Nothing when no repository is connected.
   */
  @CaptureSpan()
  public static async locate(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    frames: Array<SourceFrame>;
  }): Promise<Array<SourceLink>> {
    const repositories: Array<LocatableRepositoryWithTree> =
      await SourceLocator.getLocatableRepositories({
        projectId: data.projectId,
        props: data.props,
      });

    return await SourceLocator.matchFrames({
      frames: data.frames,
      repositories,
      getTreePaths: (
        repository: LocatableRepository,
      ): Promise<Array<string>> => {
        return SourceLocator.getTreePaths(
          repository as LocatableRepositoryWithTree,
        );
      },
    });
  }
}
