import { execFileSync, spawn, ChildProcess } from "child_process";
import fs from "fs";
import http from "http";
import { AddressInfo } from "net";
import os from "os";
import path from "path";

/*
 * A REAL GIT SERVER, ON 127.0.0.1, FOR TESTS.
 *
 * A bare repository served over smart HTTP by git's own http-backend (the
 * CGI program every Git server wraps), behind HTTP Basic authentication,
 * as a self-hosted Git server answers: what a plain Git repository's
 * connection, branch picker and Runner clone and push talk to, without a
 * fake protocol in between. The repository starts with a main branch (HEAD)
 * and a feature/login branch; tests push more.
 *
 * Only for tests: it binds 127.0.0.1, which OneUptime's egress guard
 * refuses on every installation, so a test reaches it through the
 * unguarded transport (CodeHostHttp.createUnguardedTransportForTests) or
 * with the guard stubbed - never the production one.
 */

// One request the server answered, with the headers a test asks about.
export interface LocalGitHttpRequest {
  method: string;
  // "<path>?<query>"
  path: string;
  /*
   * The scheme of the Authorization header the request carried - "Basic",
   * "Negotiate", "NTLM" - or null for a request that carried none.
   */
  authorizationScheme: string | null;
  // Whether it carried exactly the server's username and password, as Basic.
  isSignedIn: boolean;
  userAgent: string;
}

/*
 * What a server behind Windows authentication offers before Basic: Azure
 * DevOps Server (TFS) on IIS takes a personal access token over Basic, but
 * its 401 offers these first, and left to itself git (libcurl) answers the
 * strongest one it supports - never Basic.
 */
export const WINDOWS_AUTHENTICATION_CHALLENGES: Array<string> = [
  "Bearer",
  "Negotiate",
  "NTLM",
  'Basic realm="tfs.example.com"',
];

export interface LocalGitHttpServer {
  // http://127.0.0.1:<port>
  origin: string;
  // http://127.0.0.1:<port>/team/app.git
  cloneUrl: string;
  username: string;
  password: string;
  // The bare repository on disk.
  barePath: string;
  // Every request the server answered, as "<METHOD> <path>?<query>".
  requests: Array<string>;
  // Every request the server answered, with its sign-in and user agent.
  requestLog: Array<LocalGitHttpRequest>;
  // The refs the bare repository holds now: "refs/heads/main" -> sha.
  readRefs: () => Record<string, string>;
  close: () => Promise<void>;
}

// git, with nothing of the machine's own configuration, as a CI box runs it.
export function runGit(args: Array<string>, cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"] || "/usr/bin:/bin",
      HOME: cwd,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
}

export function getGitHttpBackendPath(): string {
  const execPath: string = runGit(["--exec-path"], os.tmpdir()).trim();

  return path.join(execPath, "git-http-backend");
}

// Whether this machine can run the server (git and its http-backend).
export function canRunLocalGitHttpServer(): boolean {
  try {
    return fs.existsSync(getGitHttpBackendPath());
  } catch {
    return false;
  }
}

export async function startLocalGitHttpServer(options?: {
  username?: string | undefined;
  password?: string | undefined;
  /*
   * The WWW-Authenticate challenges a request that is not signed in is
   * answered with, in order: Basic alone by default, as most Git servers
   * answer; WINDOWS_AUTHENTICATION_CHALLENGES as Azure DevOps Server does.
   * Only Basic with the username and password signs in, either way.
   */
  challenges?: Array<string> | undefined;
}): Promise<LocalGitHttpServer> {
  const username: string = options?.username || "deploy";
  const password: string = options?.password || "s3cret-token-0001";
  const challenges: Array<string> =
    options?.challenges && options.challenges.length > 0
      ? options.challenges
      : ['Basic realm="git"'];
  const root: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-git-server-"),
  );
  const projectRoot: string = path.join(root, "repos");
  const barePath: string = path.join(projectRoot, "team", "app.git");
  const workPath: string = path.join(root, "seed");

  fs.mkdirSync(path.dirname(barePath), { recursive: true });
  runGit(["init", "--bare", "--initial-branch=main", barePath], root);
  runGit(["config", "http.receivepack", "true"], barePath);

  runGit(["clone", barePath, workPath], root);
  fs.writeFileSync(path.join(workPath, "README.md"), "# app\n");
  fs.mkdirSync(path.join(workPath, "src"));
  fs.writeFileSync(
    path.join(workPath, "src", "index.ts"),
    "export const answer: number = 41;\n",
  );
  runGit(["add", "-A"], workPath);
  runGit(["commit", "-m", "Initial commit"], workPath);
  runGit(["push", "origin", "HEAD:refs/heads/main"], workPath);
  runGit(["checkout", "-b", "feature/login"], workPath);
  fs.writeFileSync(path.join(workPath, "LOGIN.md"), "login\n");
  runGit(["add", "-A"], workPath);
  runGit(["commit", "-m", "Login"], workPath);
  runGit(["push", "origin", "feature/login"], workPath);

  const backend: string = getGitHttpBackendPath();
  const expected: string = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  const requests: Array<string> = [];
  const requestLog: Array<LocalGitHttpRequest> = [];

  const server: http.Server = http.createServer(
    (request: http.IncomingMessage, response: http.ServerResponse): void => {
      const url: URL = new URL(request.url || "/", "http://127.0.0.1");
      const authorization: string = String(
        request.headers["authorization"] || "",
      );
      const space: number = authorization.indexOf(" ");

      requests.push(`${request.method} ${url.pathname}${url.search}`);
      requestLog.push({
        method: request.method || "GET",
        path: `${url.pathname}${url.search}`,
        authorizationScheme: authorization
          ? space > 0
            ? authorization.substring(0, space)
            : authorization
          : null,
        isSignedIn: authorization === expected,
        userAgent: String(request.headers["user-agent"] || ""),
      });

      if (authorization !== expected) {
        response.setHeader("WWW-Authenticate", challenges);
        response.writeHead(401, {
          "Content-Type": "text/plain",
        });
        response.end("Authentication required\n");
        return;
      }

      const child: ChildProcess = spawn(backend, [], {
        env: {
          PATH: process.env["PATH"] || "/usr/bin:/bin",
          GIT_PROJECT_ROOT: projectRoot,
          GIT_HTTP_EXPORT_ALL: "1",
          GIT_CONFIG_NOSYSTEM: "1",
          HOME: root,
          PATH_INFO: url.pathname,
          QUERY_STRING: url.search.startsWith("?")
            ? url.search.substring(1)
            : url.search,
          REQUEST_METHOD: request.method || "GET",
          CONTENT_TYPE: String(request.headers["content-type"] || ""),
          HTTP_CONTENT_ENCODING: String(
            request.headers["content-encoding"] || "",
          ),
          GIT_PROTOCOL: String(request.headers["git-protocol"] || ""),
          REMOTE_USER: username,
          REMOTE_ADDR: "127.0.0.1",
        },
      });

      const chunks: Array<Buffer> = [];

      child.stdout!.on("data", (chunk: Buffer): void => {
        chunks.push(chunk);
      });

      child.on("close", (): void => {
        const output: Buffer = Buffer.concat(chunks);
        let headerEnd: number = output.indexOf("\r\n\r\n");
        let separatorLength: number = 4;

        if (headerEnd < 0) {
          headerEnd = output.indexOf("\n\n");
          separatorLength = 2;
        }

        if (headerEnd < 0) {
          response.writeHead(500);
          response.end();
          return;
        }

        const headers: Record<string, string> = {};
        let status: number = 200;

        for (const line of output
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

        response.writeHead(status, headers);
        response.end(output.subarray(headerEnd + separatorLength));
      });

      request.pipe(child.stdin!);
    },
  );

  await new Promise<void>((resolve: () => void): void => {
    server.listen(0, "127.0.0.1", (): void => {
      resolve();
    });
  });

  const port: number = (server.address() as AddressInfo).port;
  const origin: string = `http://127.0.0.1:${port}`;

  return {
    origin,
    cloneUrl: `${origin}/team/app.git`,
    username,
    password,
    barePath,
    requests,
    requestLog,
    readRefs: (): Record<string, string> => {
      const refs: Record<string, string> = {};

      for (const line of runGit(
        ["for-each-ref", "--format=%(refname) %(objectname)"],
        barePath,
      )
        .trim()
        .split("\n")) {
        const [name, sha] = line.split(" ");

        if (name && sha) {
          refs[name] = sha;
        }
      }

      return refs;
    },
    close: async (): Promise<void> => {
      await new Promise<void>((resolve: () => void): void => {
        server.close((): void => {
          resolve();
        });
      });
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
