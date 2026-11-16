import {
  CodeHostHttpRequest,
  CodeHostHttpResponse,
  CodeHostTransport,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostHttp";

/*
 * A GITLAB SERVER'S API, FAKED AT THE TRANSPORT, WITH THE RULES THAT MATTER
 * FOR THE TOKENS ONEUPTIME MAKES FOR A CODE FIX (issue #8912).
 *
 * What it holds to, as GitLab's API documents it (docs.gitlab.com, project
 * access tokens, merge requests):
 *
 *   - every API call signs in with a PRIVATE-TOKEN header: the connection's
 *     personal access token, or a project access token it made;
 *   - POST /projects/:id/access_tokens makes a project access token only for
 *     a personal access token whose user has the Maintainer role or more in
 *     the project and the api scope; otherwise 403. On a plan with no project
 *     access tokens (GitLab.com Free) it answers 404. It never makes one
 *     with a higher role than its maker's (400). It answers 201 with the
 *     token, once, and its id;
 *   - a project access token reaches its own project alone - any other
 *     answers 404 - and calls the API only with the api (or read_api)
 *     scope: one with write_repository alone gets 403 insufficient_scope;
 *   - DELETE /projects/:id/access_tokens/:token_id revokes one of the
 *     project's tokens (204), and answers 404 for one it has not;
 *   - POST /projects/:id/merge_requests opens a merge request as the token's
 *     user, 409 when an open one has the same source branch;
 *     GET /projects/:id/merge_requests lists the open ones by branch.
 *
 * A token that is revoked, or whose expiry date has come (midnight UTC at
 * the start of it), is refused (401) like any token GitLab does not know.
 * Every request is kept, so a test reads what OneUptime sent.
 */

export const GITLAB_API_BASE: string = "https://gitlab.example.com/api/v4";

export interface FakeGitLabProject {
  id: string;
  path: string;
  // The branches it has: a merge request's source must be one of them.
  branches: Array<string>;
}

export interface FakeGitLabMintedToken {
  id: number;
  token: string;
  projectId: string;
  scopes: Array<string>;
  accessLevel: number;
  expiresAt: string;
  name: string;
  description: string;
  revoked: boolean;
  // The bot user GitLab makes for it.
  botUserId: number;
}

export interface FakeGitLabMergeRequest {
  iid: number;
  id: number;
  projectId: string;
  sourceBranch: string;
  targetBranch: string;
  title: string;
  description: string;
  // Who opened it: the user of the token that asked.
  authorUserId: number;
}

export interface FakeGitLabOptions {
  // The connection's personal access token.
  connectionToken: string;
  // Its user's role in every project: 40 is Maintainer, 30 Developer.
  connectionAccessLevel?: number | undefined;
  // Its scopes.
  connectionScopes?: Array<string> | undefined;
  // A plan with no project access tokens (GitLab.com Free): 404.
  hasProjectAccessTokens?: boolean | undefined;
  // Answer every mint with this server error instead (503: unavailable).
  mintFailsWithStatus?: number | undefined;
  // Answer every revocation with this status instead (500).
  revokeFailsWithStatus?: number | undefined;
  projects?: Array<FakeGitLabProject> | undefined;
  // What "now" is for a token's expiry.
  now?: (() => Date) | undefined;
}

export interface FakeGitLab {
  transport: CodeHostTransport;
  requests: Array<CodeHostHttpRequest>;
  minted: Array<FakeGitLabMintedToken>;
  mergeRequests: Array<FakeGitLabMergeRequest>;
  // Whether GitLab takes this token for this project now (Git and the API).
  isTokenGoodFor: (token: string, projectId: string) => boolean;
  // Whether this token may push to this project now.
  canPush: (token: string, projectId: string) => boolean;
  connectionUserId: number;
}

export const DEFAULT_PROJECTS: Array<FakeGitLabProject> = [
  { id: "4217", path: "acme/backend/checkout", branches: ["main"] },
  { id: "4218", path: "acme/backend/billing", branches: ["main"] },
];

type Answer = { status: number; json?: unknown };

export function fakeGitLab(options: FakeGitLabOptions): FakeGitLab {
  const requests: Array<CodeHostHttpRequest> = [];
  const minted: Array<FakeGitLabMintedToken> = [];
  const mergeRequests: Array<FakeGitLabMergeRequest> = [];
  const projects: Array<FakeGitLabProject> =
    options.projects || DEFAULT_PROJECTS.map(cloneProject);
  const connectionUserId: number = 1;
  const connectionAccessLevel: number = options.connectionAccessLevel ?? 40;
  const connectionScopes: Array<string> = options.connectionScopes || [
    "api",
    "write_repository",
  ];
  const now: () => Date =
    options.now ||
    ((): Date => {
      return new Date();
    });
  let nextTokenId: number = 900;
  let nextMergeRequestId: number = 5000;

  const findProject: (idOrPath: string) => FakeGitLabProject | undefined = (
    idOrPath: string,
  ): FakeGitLabProject | undefined => {
    return projects.find((project: FakeGitLabProject): boolean => {
      return project.id === idOrPath || project.path === idOrPath;
    });
  };

  const findMinted: (token: string) => FakeGitLabMintedToken | undefined = (
    token: string,
  ): FakeGitLabMintedToken | undefined => {
    return minted.find((candidate: FakeGitLabMintedToken): boolean => {
      return candidate.token === token;
    });
  };

  const isLive: (token: FakeGitLabMintedToken) => boolean = (
    token: FakeGitLabMintedToken,
  ): boolean => {
    // GitLab ends a token at midnight UTC at the start of its expiry date.
    return (
      !token.revoked &&
      now().getTime() < new Date(`${token.expiresAt}T00:00:00.000Z`).getTime()
    );
  };

  const isTokenGoodFor: (token: string, projectId: string) => boolean = (
    token: string,
    projectId: string,
  ): boolean => {
    if (token === options.connectionToken) {
      return Boolean(findProject(projectId));
    }

    const projectToken: FakeGitLabMintedToken | undefined = findMinted(token);

    return Boolean(
      projectToken &&
        isLive(projectToken) &&
        projectToken.projectId === findProject(projectId)?.id,
    );
  };

  const canPush: (token: string, projectId: string) => boolean = (
    token: string,
    projectId: string,
  ): boolean => {
    if (!isTokenGoodFor(token, projectId)) {
      return false;
    }

    if (token === options.connectionToken) {
      return connectionAccessLevel >= 30;
    }

    const projectToken: FakeGitLabMintedToken = findMinted(token)!;

    return (
      projectToken.accessLevel >= 30 &&
      (projectToken.scopes.includes("write_repository") ||
        projectToken.scopes.includes("api"))
    );
  };

  const answer: (request: CodeHostHttpRequest) => Answer = (
    request: CodeHostHttpRequest,
  ): Answer => {
    const url: URL = new URL(request.url);
    const path: string = url.pathname.startsWith("/api/v4")
      ? url.pathname.substring("/api/v4".length)
      : url.pathname;
    const token: string = request.headers["PRIVATE-TOKEN"] || "";
    const isConnectionToken: boolean = token === options.connectionToken;
    const projectToken: FakeGitLabMintedToken | undefined = findMinted(token);

    if (!isConnectionToken && !(projectToken && isLive(projectToken))) {
      return { status: 401, json: { message: "401 Unauthorized" } };
    }

    // A project access token calls the API only with the api scope.
    if (
      projectToken &&
      !projectToken.scopes.includes("api") &&
      !projectToken.scopes.includes("read_api")
    ) {
      return {
        status: 403,
        json: {
          error: "insufficient_scope",
          error_description:
            "The request requires higher privileges than provided by the access token.",
        },
      };
    }

    if (request.method === "GET" && path === "/user") {
      return isConnectionToken
        ? {
            status: 200,
            json: { id: connectionUserId, username: "alice", name: "Alice" },
          }
        : {
            status: 200,
            json: {
              id: projectToken!.botUserId,
              username: `project_${projectToken!.projectId}_bot`,
              name: projectToken!.name,
            },
          };
    }

    const projectMatch: RegExpMatchArray | null = path.match(
      /^\/projects\/([^/]+)(\/.*)?$/,
    );

    if (!projectMatch) {
      return { status: 404, json: { message: "404 Not Found" } };
    }

    const project: FakeGitLabProject | undefined = findProject(
      decodeURIComponent(projectMatch[1]!),
    );
    const rest: string = projectMatch[2] || "";

    // A project access token reaches its own project alone.
    if (!project || (projectToken && projectToken.projectId !== project.id)) {
      return { status: 404, json: { message: "404 Project Not Found" } };
    }

    if (request.method === "POST" && rest === "/access_tokens") {
      if (options.mintFailsWithStatus) {
        return {
          status: options.mintFailsWithStatus,
          json: { message: `${options.mintFailsWithStatus}` },
        };
      }

      if (!isConnectionToken) {
        return {
          status: 400,
          json: {
            message:
              "400 Bad request - You must use a personal access token with this endpoint.",
          },
        };
      }

      if (options.hasProjectAccessTokens === false) {
        return { status: 404, json: { message: "404 Not Found" } };
      }

      if (connectionAccessLevel < 40 || !connectionScopes.includes("api")) {
        return { status: 403, json: { message: "403 Forbidden" } };
      }

      const body: Record<string, unknown> = JSON.parse(request.body || "{}");
      const accessLevel: number = Number(body["access_level"] ?? 40);

      if (accessLevel > connectionAccessLevel) {
        return {
          status: 400,
          json: {
            message:
              "400 Bad request - Access level of the token can't be greater than the access level of the user who created the token",
          },
        };
      }

      if (
        typeof body["name"] !== "string" ||
        !Array.isArray(body["scopes"]) ||
        typeof body["expires_at"] !== "string"
      ) {
        return {
          status: 400,
          json: { error: "name, scopes and expires_at are required" },
        };
      }

      const id: number = nextTokenId++;
      const made: FakeGitLabMintedToken = {
        id,
        token: `glpat-project-token-${id}`,
        projectId: project.id,
        scopes: (body["scopes"] as Array<string>).slice(),
        accessLevel,
        expiresAt: body["expires_at"] as string,
        name: body["name"] as string,
        description: String(body["description"] || ""),
        revoked: false,
        botUserId: 7000 + id,
      };

      minted.push(made);

      return {
        status: 201,
        json: {
          id: made.id,
          name: made.name,
          description: made.description,
          revoked: false,
          active: true,
          created_at: now().toISOString(),
          scopes: made.scopes,
          user_id: made.botUserId,
          expires_at: made.expiresAt,
          access_level: made.accessLevel,
          token: made.token,
        },
      };
    }

    const revokeMatch: RegExpMatchArray | null = rest.match(
      /^\/access_tokens\/(\d+)$/,
    );

    if (request.method === "DELETE" && revokeMatch) {
      if (options.revokeFailsWithStatus) {
        return {
          status: options.revokeFailsWithStatus,
          json: { message: `${options.revokeFailsWithStatus}` },
        };
      }

      const target: FakeGitLabMintedToken | undefined = minted.find(
        (candidate: FakeGitLabMintedToken): boolean => {
          return (
            candidate.id === Number(revokeMatch[1]) &&
            candidate.projectId === project.id &&
            !candidate.revoked
          );
        },
      );

      if (!target) {
        return { status: 404, json: { message: "404 Not Found" } };
      }

      target.revoked = true;

      return { status: 204 };
    }

    if (request.method === "POST" && rest === "/merge_requests") {
      const body: Record<string, unknown> = JSON.parse(request.body || "{}");
      const sourceBranch: string = String(body["source_branch"] || "");
      const targetBranch: string = String(body["target_branch"] || "");

      if (
        !project.branches.includes(sourceBranch) ||
        !project.branches.includes(targetBranch)
      ) {
        return {
          status: 422,
          json: { message: ["Source branch does not exist"] },
        };
      }

      const open: FakeGitLabMergeRequest | undefined = mergeRequests.find(
        (candidate: FakeGitLabMergeRequest): boolean => {
          return (
            candidate.projectId === project.id &&
            candidate.sourceBranch === sourceBranch
          );
        },
      );

      if (open) {
        return {
          status: 409,
          json: {
            message: [
              `Another open merge request already exists for this source branch: !${open.iid}`,
            ],
          },
        };
      }

      const mergeRequest: FakeGitLabMergeRequest = {
        iid:
          mergeRequests.filter((candidate: FakeGitLabMergeRequest) => {
            return candidate.projectId === project.id;
          }).length + 1,
        id: nextMergeRequestId++,
        projectId: project.id,
        sourceBranch,
        targetBranch,
        title: String(body["title"] || ""),
        description: String(body["description"] || ""),
        authorUserId: isConnectionToken
          ? connectionUserId
          : projectToken!.botUserId,
      };

      mergeRequests.push(mergeRequest);

      return { status: 201, json: toMergeRequestJson(mergeRequest, project) };
    }

    if (request.method === "GET" && rest === "/merge_requests") {
      return {
        status: 200,
        json: mergeRequests
          .filter((candidate: FakeGitLabMergeRequest): boolean => {
            return (
              candidate.projectId === project.id &&
              (!url.searchParams.get("source_branch") ||
                candidate.sourceBranch ===
                  url.searchParams.get("source_branch")) &&
              (!url.searchParams.get("target_branch") ||
                candidate.targetBranch ===
                  url.searchParams.get("target_branch"))
            );
          })
          .map((candidate: FakeGitLabMergeRequest): unknown => {
            return toMergeRequestJson(candidate, project);
          }),
      };
    }

    return { status: 404, json: { message: "404 Not Found" } };
  };

  const transport: CodeHostTransport = async (
    request: CodeHostHttpRequest,
  ): Promise<CodeHostHttpResponse> => {
    requests.push(request);

    const answered: Answer = answer(request);
    const text: string =
      answered.json === undefined ? "" : JSON.stringify(answered.json);

    return {
      statusCode: answered.status,
      bodyText: text,
      bodyJson: answered.json,
      headers: {},
    };
  };

  return {
    transport,
    requests,
    minted,
    mergeRequests,
    isTokenGoodFor,
    canPush,
    connectionUserId,
  };
}

function cloneProject(project: FakeGitLabProject): FakeGitLabProject {
  return { ...project, branches: project.branches.slice() };
}

function toMergeRequestJson(
  mergeRequest: FakeGitLabMergeRequest,
  project: FakeGitLabProject,
): Record<string, unknown> {
  return {
    id: mergeRequest.id,
    iid: mergeRequest.iid,
    project_id: Number(project.id),
    source_project_id: Number(project.id),
    target_project_id: Number(project.id),
    title: mergeRequest.title,
    description: mergeRequest.description,
    state: "opened",
    source_branch: mergeRequest.sourceBranch,
    target_branch: mergeRequest.targetBranch,
    author: { id: mergeRequest.authorUserId, username: "author" },
    web_url: `https://gitlab.example.com/${project.path}/-/merge_requests/${mergeRequest.iid}`,
  };
}
