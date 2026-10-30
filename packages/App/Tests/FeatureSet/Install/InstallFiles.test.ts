import {
  createInstallFilesRouter,
  getNotFoundText,
  getServedVersion,
} from "../../../FeatureSet/Install/API/InstallFiles";
import { InstallFilesRoot } from "../../../FeatureSet/Install/Config";
import {
  DashboardFallbackRoutePrefixesToSkip,
  StatusPageDomainFallbackRoutePrefixesToSkip,
  shouldSkipDashboardFallbackRoute,
  shouldSkipStatusPageDomainFallbackRoute,
} from "../../../FeatureSet/Frontend/RouteReservations";
import {
  INSTALL_SCRIPTS,
  INSTALL_SCRIPTS_ROUTE,
  InstallScriptEntry,
} from "Common/Types/InstallScripts/InstallScripts";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";

/*
 * GET /install/<name> and /install/<name>/<file>: the agents' install
 * scripts and the files they download, served by every OneUptime from its
 * own image, so an install command never names GitHub and always installs
 * the release the reader runs.
 *
 * The router is mounted on a real Express app (the one the server
 * resolves, Common's) and asked over real HTTP with the raw paths a client
 * can send, and it serves this repository's own files - the image holds
 * the same folders at /usr/src (packages/App/Dockerfile.tpl), so what is
 * served here byte for byte is what a customer pipes into a shell.
 */

const APP_DIR: string = path.join(__dirname, "..", "..", "..");
const PACKAGES_DIR: string = path.join(APP_DIR, "..");
const REPO_ROOT: string = path.join(PACKAGES_DIR, "..");

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const express: any = require(
  path.join(PACKAGES_DIR, "Common", "node_modules", "express"),
);
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

const VERSION: string = "14.0.98";

// The first line of a script bash or sh runs: #!/bin/bash, #!/bin/sh.
const SHEBANG: RegExp = /^#!(?:\/usr\/bin\/env |\/bin\/)(?:ba)?sh\n/;

// What answers a request the router hands on: it never should.
const FELL_THROUGH: number = 418;

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

function buildApp(options: { root: string; version: string }): any {
  const app: any = express();

  app.use("/install", createInstallFilesRouter(options));

  app.use((_req: any, res: any): void => {
    res.status(FELL_THROUGH).send("fell through");
  });

  return app;
}

/*
 * The path is sent exactly as written: no client-side normalisation of
 * dot segments or percent-escapes, as `curl --path-as-is` would send it.
 */
function request(
  app: any,
  requestPath: string,
  method: string = "GET",
  headers: Record<string, string> = {},
): Promise<Reply> {
  return new Promise(
    (resolve: (reply: Reply) => void, reject: (error: Error) => void): void => {
      const server: http.Server = app.listen(0, "127.0.0.1", (): void => {
        const address: any = server.address();
        const outgoing: http.ClientRequest = http.request(
          {
            host: "127.0.0.1",
            port: address.port,
            path: requestPath,
            method: method,
            headers: headers,
          },
          (res: http.IncomingMessage): void => {
            const chunks: Array<Buffer> = [];

            res.on("data", (chunk: Buffer): void => {
              chunks.push(chunk);
            });
            res.on("end", (): void => {
              server.close();
              resolve({
                status: res.statusCode || 0,
                headers: res.headers,
                body: Buffer.concat(chunks),
              });
            });
          },
        );

        outgoing.on("error", (error: Error): void => {
          server.close();
          reject(error);
        });
        outgoing.end();
      });
    },
  );
}

function repositoryFile(entry: InstallScriptEntry, file: string): Buffer {
  return fs.readFileSync(path.join(REPO_ROOT, entry.sourceDirectory, file));
}

function entryNamed(name: string): InstallScriptEntry {
  const found: InstallScriptEntry | undefined = INSTALL_SCRIPTS.find(
    (entry: InstallScriptEntry): boolean => {
      return entry.name === name;
    },
  );

  if (!found) {
    throw new Error(`no entry ${name}`);
  }

  return found;
}

function expectServedHeaders(reply: Reply, fileName: string): void {
  expect(reply.headers["content-type"]).toBe("text/plain; charset=utf-8");
  expect(reply.headers["cache-control"]).toBe("no-store");
  expect(reply.headers["x-content-type-options"]).toBe("nosniff");
  expect(reply.headers["content-disposition"]).toBe(
    `inline; filename="${fileName}"`,
  );
  expect(reply.headers["x-oneuptime-version"]).toBe(VERSION);
}

const SCRIPT_ENTRIES: Array<InstallScriptEntry> = INSTALL_SCRIPTS.filter(
  (entry: InstallScriptEntry): boolean => {
    return Boolean(entry.script);
  },
);

const EVERY_FILE: Array<[string, string]> = INSTALL_SCRIPTS.flatMap(
  (entry: InstallScriptEntry): Array<[string, string]> => {
    return entry.files.map((file: string): [string, string] => {
      return [entry.name, file];
    });
  },
);

describe("every agent's install script, from this OneUptime's own files", () => {
  const app: any = buildApp({ root: REPO_ROOT, version: VERSION });

  test.each(
    SCRIPT_ENTRIES.map((entry: InstallScriptEntry): [string] => {
      return [entry.name];
    }),
  )("/install/%s is its install.sh, byte for byte", async (name: string) => {
    const entry: InstallScriptEntry = entryNamed(name);
    const reply: Reply = await request(app, `/install/${name}`);

    expect(reply.status).toBe(200);
    expect(reply.body.equals(repositoryFile(entry, "install.sh"))).toBe(true);
    expectServedHeaders(reply, "install.sh");
    // A shell script, as the command pipes it to bash or sh.
    expect(reply.body.toString("utf8")).toMatch(SHEBANG);
  });

  test.each(EVERY_FILE)(
    "/install/%s/%s is the file, byte for byte",
    async (name: string, file: string) => {
      const entry: InstallScriptEntry = entryNamed(name);
      const reply: Reply = await request(app, `/install/${name}/${file}`);

      expect(reply.status).toBe(200);
      expect(reply.body.equals(repositoryFile(entry, file))).toBe(true);
      expectServedHeaders(reply, path.posix.basename(file));
    },
  );

  test("a trailing slash names the same script, as a browser may add one", async () => {
    const reply: Reply = await request(app, "/install/proxmox-agent/");

    expect(reply.status).toBe(200);
    expect(
      reply.body.equals(
        repositoryFile(entryNamed("proxmox-agent"), "install.sh"),
      ),
    ).toBe(true);
  });

  test("HEAD answers like GET, without the body", async () => {
    const reply: Reply = await request(app, "/install/proxmox-agent", "HEAD");

    expect(reply.status).toBe(200);
    expect(reply.body.length).toBe(0);
    expectServedHeaders(reply, "install.sh");
    expect(Number(reply.headers["content-length"])).toBe(
      repositoryFile(entryNamed("proxmox-agent"), "install.sh").length,
    );
  });

  test("the Kubernetes agent installs with Helm: no script, but its diagnostic script", async () => {
    const script: Reply = await request(app, "/install/kubernetes-agent");

    expect(script.status).toBe(404);

    const troubleshoot: Reply = await request(
      app,
      "/install/kubernetes-agent/troubleshoot.sh",
    );

    expect(troubleshoot.status).toBe(200);
    expect(
      troubleshoot.body.equals(
        fs.readFileSync(
          path.join(
            REPO_ROOT,
            "HelmChart",
            "Public",
            "kubernetes-agent",
            "troubleshoot.sh",
          ),
        ),
      ),
    ).toBe(true);
  });

  test("a script is served as written, whatever the request says: no address, header or query reaches it", async () => {
    const expected: Buffer = repositoryFile(
      entryNamed("vmware-agent"),
      "install.sh",
    );

    for (const [requestPath, headers] of [
      ["/install/vmware-agent?ONEUPTIME_URL=https://evil.example", {}],
      ["/install/vmware-agent", { Host: "evil.example" }],
      [
        "/install/vmware-agent",
        {
          "X-Forwarded-Host": "evil.example",
          "X-Forwarded-Proto": "http",
          Cookie: "a=b",
        },
      ],
    ] as Array<[string, Record<string, string>]>) {
      const reply: Reply = await request(app, requestPath, "GET", headers);

      expect(reply.status).toBe(200);
      expect(reply.body.equals(expected)).toBe(true);
      expect(reply.body.toString("utf8")).not.toContain("evil.example");
    }
  });
});

describe("what the router refuses", () => {
  const app: any = buildApp({ root: REPO_ROOT, version: VERSION });

  test.each([
    ["/install/proxmox"],
    ["/install/Proxmox-Agent"],
    ["/install/ProxmoxAgent"],
    ["/install/cli"],
    ["/install/proxmox-agent.sh"],
    ["/install/proxmox-agent/README.md"],
    ["/install/proxmox-agent/.env"],
    ["/install/proxmox-agent/systemd"],
    ["/install/proxmox-agent/otel-collector-config.yml"],
    ["/install/host-ai-agent/otel-collector-config.yaml"],
    ["/install/database-agent/configs"],
    ["/install/database-agent/configs/"],
    ["/install"],
    ["/install/"],
  ])("%s is no script or file: 404, as text", async (requestPath: string) => {
    const reply: Reply = await request(app, requestPath);

    expect(reply.status).toBe(404);
    expect(reply.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(reply.headers["cache-control"]).toBe("no-store");
    expect(reply.body.toString("utf8")).toBe(getNotFoundText());
  });

  test.each([
    ["/install/proxmox-agent/../../../../etc/passwd"],
    ["/install/proxmox-agent/..%2f..%2f..%2f..%2fetc%2fpasswd"],
    ["/install/proxmox-agent/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd"],
    ["/install/proxmox-agent/%2E%2E%2F%2E%2E%2Fpackage.json"],
    ["/install/proxmox-agent/..\\..\\package.json"],
    ["/install/proxmox-agent/%2fetc%2fpasswd"],
    ["/install/proxmox-agent//etc/passwd"],
    ["/install/proxmox-agent/systemd/../../../package.json"],
    ["/install/proxmox-agent/./docker-compose.yml"],
    ["/install/proxmox-agent/systemd/../docker-compose.yml"],
    ["/install/..%2f..%2fpackage.json"],
    ["/install/%2e%2e/package.json"],
    ["/install/../package.json"],
    ["/install/database-agent/configs/../../ProxmoxAgent/install.sh"],
  ])(
    "%s reads nothing outside the list: 404 or never reaches the router",
    async (requestPath: string) => {
      const reply: Reply = await request(app, requestPath);

      /*
       * Express may route a dot segment outside /install altogether (it
       * then falls through to the stand-in, never to a file); under
       * /install it is no listed file.
       */
      expect([404, FELL_THROUGH]).toContain(reply.status);
      expect(reply.body.toString("utf8")).not.toContain("root:");
      expect(reply.body.toString("utf8")).not.toContain('"name"');
    },
  );

  test("nothing of the request is written back", async () => {
    const reply: Reply = await request(
      app,
      "/install/%3Cscript%3Ealert(1)%3C%2Fscript%3E/x",
    );

    expect(reply.status).toBe(404);
    expect(reply.body.toString("utf8")).not.toContain("script>");
    expect(reply.body.toString("utf8")).not.toContain("alert");
  });

  test("the not-found text lists every install script, and only those", () => {
    const text: string = getNotFoundText();

    for (const entry of INSTALL_SCRIPTS) {
      expect(text.includes(`${INSTALL_SCRIPTS_ROUTE}/${entry.name} `)).toBe(
        Boolean(entry.script),
      );
    }
  });
});

describe("a folder that holds more than the list", () => {
  let root: string = "";

  beforeAll(() => {
    /*
     * An image folder with files that must never be served: a secret
     * beside the agent's files, a dotfile, the folder's README, and one
     * listed file missing.
     */
    root = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-install-files-"));

    for (const entry of INSTALL_SCRIPTS) {
      for (const file of entry.files) {
        const target: string = path.join(root, entry.sourceDirectory, file);

        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(
          path.join(REPO_ROOT, entry.sourceDirectory, file),
          target,
        );
      }
    }

    fs.writeFileSync(path.join(root, "secret.txt"), "TOP-SECRET-ROOT\n");
    fs.writeFileSync(
      path.join(root, "agents", "ProxmoxAgent", ".env"),
      "PVE_API_TOKEN_SECRET=TOP-SECRET-ENV\n",
    );
    fs.writeFileSync(
      path.join(root, "agents", "ProxmoxAgent", "README.md"),
      "TOP-SECRET-README\n",
    );
    fs.rmSync(path.join(root, "agents", "CephAgent", "docker-compose.yml"));
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("only listed files are served from it", async () => {
    const app: any = buildApp({ root: root, version: VERSION });

    for (const requestPath of [
      "/install/proxmox-agent/.env",
      "/install/proxmox-agent/README.md",
      "/install/proxmox-agent/../../secret.txt",
      "/install/proxmox-agent/..%2f..%2fsecret.txt",
      "/install/proxmox-agent/%2e%2e%2f%2e%2e%2fsecret.txt",
      "/install/secret.txt",
    ]) {
      const reply: Reply = await request(app, requestPath);

      expect(reply.body.toString("utf8")).not.toContain("TOP-SECRET");
    }

    const listed: Reply = await request(app, "/install/proxmox-agent");

    expect(listed.status).toBe(200);
  });

  test("a listed file the image lacks is a server error, not a 404 the scripts would read as an older OneUptime", async () => {
    const app: any = buildApp({ root: root, version: VERSION });
    const reply: Reply = await request(
      app,
      "/install/ceph-agent/docker-compose.yml",
    );

    expect(reply.status).toBe(500);
    expect(reply.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(reply.headers["cache-control"]).toBe("no-store");
    // It says which address, never where on disk.
    expect(reply.body.toString("utf8")).toContain(
      "/install/ceph-agent/docker-compose.yml",
    );
    expect(reply.body.toString("utf8")).not.toContain(root);

    // The entry's other files are still served.
    const other: Reply = await request(
      app,
      "/install/ceph-agent/otel-collector-config.yaml",
    );

    expect(other.status).toBe(200);
  });
});

describe("the release the files are from", () => {
  test("X-OneUptime-Version names it", async () => {
    const reply: Reply = await request(
      buildApp({ root: REPO_ROOT, version: "14.0.99-test" }),
      "/install/ceph-agent",
    );

    expect(reply.headers["x-oneuptime-version"]).toBe("14.0.99-test");
  });

  test.each([[""], ["unknown"], ["   "]])(
    "a version of %p is no version: the header is left out",
    async (version: string) => {
      const reply: Reply = await request(
        buildApp({ root: REPO_ROOT, version: version }),
        "/install/ceph-agent",
      );

      expect(reply.status).toBe(200);
      expect(reply.headers["x-oneuptime-version"]).toBeUndefined();
    },
  );

  test("getServedVersion keeps a real one and drops the rest", () => {
    expect(getServedVersion(" 14.0.98 ")).toBe("14.0.98");
    expect(getServedVersion("unknown")).toBe("");
    expect(getServedVersion(null)).toBe("");
    expect(getServedVersion(undefined)).toBe("");
  });
});

describe("where the App mounts it", () => {
  const index: string = fs.readFileSync(
    path.join(APP_DIR, "FeatureSet", "Install", "Index.ts"),
    "utf8",
  );
  const appIndex: string = fs.readFileSync(
    path.join(APP_DIR, "Index.ts"),
    "utf8",
  );

  test("at /install, from the image's /usr/src, with the image's release", () => {
    expect(INSTALL_SCRIPTS_ROUTE).toBe("/install");
    expect(index).toContain('app.use(\n      "/install",');
    expect(index).toContain("root: InstallFilesRoot,");
    expect(index).toContain("version: AppVersion,");
    expect(InstallFilesRoot).toBe("/usr/src");
  });

  test("its feature set starts after the frontends' fallbacks and before the default 404", () => {
    const frontend: number = appIndex.indexOf("await FrontendRoutes.init()");
    const install: number = appIndex.indexOf("await InstallRoutes.init()");
    const defaults: number = appIndex.indexOf("App.addDefaultRoutes()");

    expect(frontend).toBeGreaterThan(-1);
    expect(install).toBeGreaterThan(frontend);
    expect(defaults).toBeGreaterThan(install);
  });

  test("so /install is reserved against both fallbacks, and /install.sh (the marketing site's) is not", () => {
    expect(DashboardFallbackRoutePrefixesToSkip).toContain("/install");
    expect(StatusPageDomainFallbackRoutePrefixesToSkip).toContain("/install");

    for (const requestPath of [
      "/install",
      "/install/proxmox-agent",
      "/install/database-agent/configs/mysql.yaml",
    ]) {
      expect(shouldSkipDashboardFallbackRoute(requestPath)).toBe(true);
      expect(shouldSkipStatusPageDomainFallbackRoute(requestPath)).toBe(true);
    }

    expect(shouldSkipDashboardFallbackRoute("/install.sh")).toBe(false);
    expect(shouldSkipDashboardFallbackRoute("/installation")).toBe(false);
  });
});
