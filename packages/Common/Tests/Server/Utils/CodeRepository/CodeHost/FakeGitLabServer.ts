import { ChildProcess, spawn } from "child_process";
import fs from "fs";
import http from "http";
import { AddressInfo } from "net";
import os from "os";
import path from "path";
import {
  CodeHostHttpRequest,
  CodeHostHttpResponse,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostHttp";
import { FakeGitLab, FakeGitLabOptions, fakeGitLab } from "./FakeGitLab";
import { getGitHttpBackendPath, runGit } from "./LocalGitHttpServer";

/*
 * A GITLAB, ON 127.0.0.1, WITH REAL GIT BEHIND IT - FOR TESTS.
 *
 * The fake GitLab API (FakeGitLab: project access tokens, merge requests,
 * GitLab's rules for both) answers /api/v4, and each project is a real bare
 * repository served over smart HTTP by git's own http-backend, signed in to
 * the way GitLab signs in Git over HTTPS: HTTP Basic, any username, and a
 * token as the password. A token is taken for a project only while GitLab
 * would take it there - the connection's personal access token for every
 * project, a project access token for its own project alone, never once
 * revoked or past its expiry - and pushes only with a role and scope that
 * may (FakeGitLab.canPush).
 *
 * Only for tests: it binds 127.0.0.1, which OneUptime's egress guard refuses
 * on every installation, so a test reaches it through the unguarded
 * transport (CodeHostHttp.createUnguardedTransportForTests) and with the
 * Runner's Git guard stubbed.
 */

export interface FakeGitLabServer {
  // http://127.0.0.1:<port>
  origin: string;
  gitLab: FakeGitLab;
  // The project's clone address: http://127.0.0.1:<port>/acme/backend/checkout.git
  cloneUrlOf: (projectPath: string) => string;
  // The refs a project's bare repository holds now: "refs/heads/main" -> sha.
  readRefs: (projectPath: string) => Record<string, string>;
  // Every Git request, as "<METHOD> <path> <signed in as: token|none>".
  gitRequests: Array<{
    method: string;
    path: string;
    token: string | null;
    status: number;
  }>;
  close: () => Promise<void>;
}

const PROJECTS: Array<{ id: string; path: string }> = [
  { id: "4217", path: "acme/backend/checkout" },
  { id: "4218", path: "acme/backend/billing" },
];

export async function startFakeGitLabServer(
  options: Omit<FakeGitLabOptions, "projects" | "branchesOf">,
): Promise<FakeGitLabServer> {
  const root: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-fake-gitlab-"),
  );
  const repositoryRoot: string = path.join(root, "repos");

  for (const project of PROJECTS) {
    const barePath: string = path.join(repositoryRoot, `${project.path}.git`);
    const seedPath: string = path.join(root, `seed-${project.id}`);

    fs.mkdirSync(path.dirname(barePath), { recursive: true });
    runGit(["init", "--bare", "--initial-branch=main", barePath], root);
    runGit(["config", "http.receivepack", "true"], barePath);
    runGit(["clone", barePath, seedPath], root);
    fs.mkdirSync(path.join(seedPath, "src"));
    fs.writeFileSync(
      path.join(seedPath, "src", "index.ts"),
      `export const project: string = "${project.path}";\n`,
    );
    runGit(["add", "-A"], seedPath);
    runGit(["commit", "-m", "Initial commit"], seedPath);
    runGit(["push", "origin", "HEAD:refs/heads/main"], seedPath);
  }

  const readRefs: (projectPath: string) => Record<string, string> = (
    projectPath: string,
  ): Record<string, string> => {
    const refs: Record<string, string> = {};
    const output: string = runGit(
      ["for-each-ref", "--format=%(refname) %(objectname)"],
      path.join(repositoryRoot, `${projectPath}.git`),
    ).trim();

    for (const line of output.split("\n")) {
      const [name, sha] = line.split(" ");

      if (name && sha) {
        refs[name] = sha;
      }
    }

    return refs;
  };

  const gitLab: FakeGitLab = fakeGitLab({
    ...options,
    projects: PROJECTS.map((project: { id: string; path: string }) => {
      return { ...project, branches: [] };
    }),
    branchesOf: (projectId: string): Array<string> => {
      const project: { id: string; path: string } | undefined = PROJECTS.find(
        (candidate: { id: string; path: string }): boolean => {
          return candidate.id === projectId;
        },
      );

      return project
        ? Object.keys(readRefs(project.path)).map((ref: string): string => {
            return ref.substring("refs/heads/".length);
          })
        : [];
    },
  });

  const backend: string = getGitHttpBackendPath();
  const gitRequests: FakeGitLabServer["gitRequests"] = [];

  const server: http.Server = http.createServer(
    (request: http.IncomingMessage, response: http.ServerResponse): void => {
      const url: URL = new URL(request.url || "/", "http://127.0.0.1");
      const chunks: Array<Buffer> = [];

      request.on("data", (chunk: Buffer): void => {
        chunks.push(chunk);
      });

      request.on("end", (): void => {
        const body: Buffer = Buffer.concat(chunks);

        if (url.pathname.startsWith("/api/v4/")) {
          void answerApi({
            gitLab,
            request,
            url,
            body,
            response,
          });
          return;
        }

        answerGit({
          gitLab,
          backend,
          repositoryRoot,
          request,
          url,
          body,
          response,
          root,
          gitRequests,
        });
      });
    },
  );

  await new Promise<void>((resolve: () => void): void => {
    server.listen(0, "127.0.0.1", (): void => {
      resolve();
    });
  });

  const origin: string = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    origin,
    gitLab,
    cloneUrlOf: (projectPath: string): string => {
      return `${origin}/${projectPath}.git`;
    },
    readRefs,
    gitRequests,
    close: async (): Promise<void> => {
      await new Promise<void>((resolve: () => void): void => {
        server.close((): void => {
          resolve();
        });
        // Git and the API client keep their connections alive.
        server.closeAllConnections();
      });
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

// The API: handed to the fake's own rules, as a transport would hand it.
async function answerApi(data: {
  gitLab: FakeGitLab;
  request: http.IncomingMessage;
  url: URL;
  body: Buffer;
  response: http.ServerResponse;
}): Promise<void> {
  const asked: CodeHostHttpRequest = {
    method: (data.request.method || "GET") as CodeHostHttpRequest["method"],
    url: `https://gitlab.example.com${data.url.pathname}${data.url.search}`,
    headers: {
      "PRIVATE-TOKEN": String(data.request.headers["private-token"] || ""),
    },
    ...(data.body.length > 0 ? { body: data.body.toString("utf8") } : {}),
    timeoutInMs: 1000,
  };

  const answer: CodeHostHttpResponse = await data.gitLab.transport(asked);

  data.response.writeHead(answer.statusCode, {
    "Content-Type": "application/json",
  });
  data.response.end(answer.bodyText);
}

// Git over HTTP: signed in to as GitLab signs Git in, then git http-backend.
function answerGit(data: {
  gitLab: FakeGitLab;
  backend: string;
  repositoryRoot: string;
  request: http.IncomingMessage;
  url: URL;
  body: Buffer;
  response: http.ServerResponse;
  root: string;
  gitRequests: FakeGitLabServer["gitRequests"];
}): void {
  const marker: number = data.url.pathname.indexOf(".git/");
  const projectPath: string =
    marker > 0 ? data.url.pathname.substring(1, marker) : "";
  const authorization: string = String(
    data.request.headers["authorization"] || "",
  );
  const token: string | null = authorization.startsWith("Basic ")
    ? Buffer.from(authorization.substring("Basic ".length), "base64")
        .toString("utf8")
        .split(":")
        .slice(1)
        .join(":")
    : null;
  const isPush: boolean =
    data.url.searchParams.get("service") === "git-receive-pack" ||
    data.url.pathname.endsWith("/git-receive-pack");

  const refuse: (status: number) => void = (status: number): void => {
    data.gitRequests.push({
      method: data.request.method || "GET",
      path: data.url.pathname,
      token,
      status,
    });

    if (status === 401) {
      data.response.setHeader("WWW-Authenticate", 'Basic realm="GitLab"');
    }

    data.response.writeHead(status, { "Content-Type": "text/plain" });
    data.response.end(
      status === 401
        ? "HTTP Basic: Access denied\n"
        : "You are not allowed to push code to this project.\n",
    );
  };

  if (
    !projectPath ||
    !token ||
    !data.gitLab.isTokenGoodFor(token, projectPath)
  ) {
    refuse(401);
    return;
  }

  if (isPush && !data.gitLab.canPush(token, projectPath)) {
    refuse(403);
    return;
  }

  data.gitRequests.push({
    method: data.request.method || "GET",
    path: data.url.pathname,
    token,
    status: 200,
  });

  const child: ChildProcess = spawn(data.backend, [], {
    env: {
      PATH: process.env["PATH"] || "/usr/bin:/bin",
      GIT_PROJECT_ROOT: data.repositoryRoot,
      GIT_HTTP_EXPORT_ALL: "1",
      GIT_CONFIG_NOSYSTEM: "1",
      HOME: data.root,
      PATH_INFO: data.url.pathname,
      QUERY_STRING: data.url.search.startsWith("?")
        ? data.url.search.substring(1)
        : data.url.search,
      REQUEST_METHOD: data.request.method || "GET",
      CONTENT_TYPE: String(data.request.headers["content-type"] || ""),
      HTTP_CONTENT_ENCODING: String(
        data.request.headers["content-encoding"] || "",
      ),
      GIT_PROTOCOL: String(data.request.headers["git-protocol"] || ""),
      REMOTE_USER: "git",
      REMOTE_ADDR: "127.0.0.1",
    },
  });

  const output: Array<Buffer> = [];

  child.stdout!.on("data", (chunk: Buffer): void => {
    output.push(chunk);
  });

  child.on("close", (): void => {
    const answer: Buffer = Buffer.concat(output);
    let headerEnd: number = answer.indexOf("\r\n\r\n");
    let separatorLength: number = 4;

    if (headerEnd < 0) {
      headerEnd = answer.indexOf("\n\n");
      separatorLength = 2;
    }

    if (headerEnd < 0) {
      data.response.writeHead(500);
      data.response.end();
      return;
    }

    const headers: Record<string, string> = {};
    let status: number = 200;

    for (const line of answer
      .subarray(0, headerEnd)
      .toString("latin1")
      .split(/\r?\n/)) {
      const colon: number = line.indexOf(":");

      if (colon <= 0) {
        continue;
      }

      const name: string = line.substring(0, colon).trim();
      const value: string = line.substring(colon + 1).trim();

      if (name.toLowerCase() === "status") {
        status = parseInt(value, 10) || 200;
      } else {
        headers[name] = value;
      }
    }

    data.response.writeHead(status, headers);
    data.response.end(answer.subarray(headerEnd + separatorLength));
  });

  child.stdin!.end(data.body);
}
