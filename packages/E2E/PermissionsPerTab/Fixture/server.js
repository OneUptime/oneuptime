/*
 * Offline fixture server for two projects open in two tabs (#5306's
 * follow-up): the Dashboard's real Labels and Danger Zone pages
 * (Fixture.js), whose requests go through the Dashboard's own API client
 * (Common/UI/Utils/API) to this server, as JSON over the wire.
 *
 * This server plays the API's part in it, as Common/Server/Middleware/
 * UserAuthorization does: every answer about a project carries the
 * signed-in person's permission snapshot in that project, and its hash, in
 * the `project-permissions` and `project-permissions-hash` headers - unless
 * the request's own `project-permissions-hash` says the browser already has
 * that snapshot - and the person's global snapshot the same way. The
 * person is Project Owner in one project and Viewer in the other.
 *
 * Driven from the spec:
 *   POST /__fixture/hold?project=<id>     hold every answer about that
 *                                         project until it is released
 *   POST /__fixture/release?project=<id>  send the answers held for it
 *   POST /__fixture/reset                 forget the requests and the holds
 *   GET  /__fixture/requests              every API request, with the
 *                                         project it named and the hashes it
 *                                         sent, and what was answered
 *
 * An API request this server does not answer is recorded as unexpected
 * (GET /__fixture/requests lists them) and answered 404.
 */
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createConfig } = require("../../../Common/UI/esbuild-config.js");
const esbuild = require("../../../Common/node_modules/esbuild");
const { PERSON, PROJECTS, labelsOf, projectOf } = require("./Projects.js");

const repository = path.resolve(__dirname, "../../../..");
const common = path.join(repository, "packages/Common");
const dashboard = path.join(repository, "packages/App/FeatureSet/Dashboard");
const output = path.join(
  repository,
  "output/playwright/permissions-per-tab-ui/fixture",
);
const port = Number(process.env.PERMISSIONS_PER_TAB_FIXTURE_PORT || 4487);

const config = createConfig({
  serviceName: "permissions-per-tab-fixture",
  publicPath: "/dist/",
  entryPoint: path.join(__dirname, "Fixture.js"),
  outdir: output,
  additionalAlias: {
    Common: common,
    react: path.join(common, "node_modules/react"),
    "react-dom": path.join(common, "node_modules/react-dom"),
    // English always: the page's language is not what is under test.
    "i18next-browser-languagedetector": path.join(
      common,
      "Tests/__mocks__/i18next-browser-languagedetector.js",
    ),
  },
});
config.target = "es2022";
config.loader[".js"] = "jsx";
config.sourcemap = false;
config.minify = false;
config.logLevel = "warning";
config.nodePaths = [
  path.join(common, "node_modules"),
  path.join(dashboard, "node_modules"),
];

const tailwind = path.join(
  common,
  "Server/Static/Vendor/tailwind/tailwind-3.4.5.js",
);
// The Dashboard's own font, so the pages are laid out as they are drawn.
const font = path.join(
  common,
  "Server/Static/Vendor/fonts/InterVariable.woff2",
);

/*
 * What the Dashboard's server puts in env.js. HOST is this server, so the
 * API client's requests come here.
 */
const environment = {
  HOST: `127.0.0.1:${port}`,
  HTTP_PROTOCOL: "http",
  BILLING_ENABLED: "false",
  IS_ENTERPRISE_EDITION: "false",
  VERSION: "1.0.0",
  NODE_ENV: "development",
};

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Permissions per tab</title><script>window.process={env:${JSON.stringify(environment)}};window.global=window;</script><script src="/tailwind.js"></script><script>tailwind.config={darkMode:"class",theme:{extend:{fontFamily:{display:["Inter","sans-serif"],body:["Inter","sans-serif"]}}}};</script><style>@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:block;src:url('/fonts/InterVariable.woff2') format('woff2');}body{margin:0;background:var(--ou-background-primary,#f8fafc)}*{box-sizing:border-box;font-family:Inter,ui-sans-serif,system-ui,sans-serif}</style></head><body><div id="root"></div><script type="module" src="/dist/Fixture.js"></script></body></html>`;

// --- The permission headers, as Server/Middleware/UserAuthorization writes them.

const objectId = (id) => {
  return { _type: "ObjectID", value: id };
};

// The person's snapshot in a project, serialized as the server sends it.
const projectSnapshot = (project) => {
  return JSON.stringify({
    _type: "UserTenantAccessPermission",
    projectId: objectId(project.id),
    permissions: project.permissions.map((permission) => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  });
};

const globalSnapshot = () => {
  return JSON.stringify({
    _type: "UserGlobalAccessPermission",
    globalPermissions: PERSON.globalPermissions,
    projectIds: PROJECTS.map((project) => {
      return objectId(project.id);
    }),
  });
};

const hashOf = (value) => {
  return crypto.createHash("sha256").update(value).digest("hex");
};

// --- What the spec steers.

const requests = [];
const unexpected = [];
// Held answers, by project: the resolvers of the requests waiting.
const holds = new Map();

const isHeld = (projectId) => {
  return holds.has(projectId);
};

const waitWhileHeld = async (projectId) => {
  while (isHeld(projectId)) {
    await new Promise((resolve) => {
      holds.get(projectId).push(resolve);
    });
  }
};

const release = (projectId) => {
  const waiting = holds.get(projectId) || [];
  holds.delete(projectId);

  for (const resolve of waiting) {
    resolve();
  }
};

const readBody = (request) => {
  return new Promise((resolve) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
};

const header = (request, name) => {
  const value = request.headers[name];
  return typeof value === "string" ? value.trim() : "";
};

const sendJson = (response, status, body, headers) => {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    ...(headers || {}),
  });
  response.end(JSON.stringify(body));
};

// The serialized label rows of a project, as the API's list answers carry them.
const labelRows = (project) => {
  return labelsOf(project).map((label) => {
    return {
      _id: label.id,
      projectId: objectId(project.id),
      name: label.name,
      description: label.description,
      color: { _type: "Color", value: label.color },
      isArchived: false,
    };
  });
};

// What the API answers, by model and operation. Null for what it does not model.
const answerFor = (route, project, body) => {
  if (route === "label/get-list") {
    const isArchivedQuery = Boolean(
      body && body.query && body.query.isArchived === true,
    );
    const rows = isArchivedQuery ? [] : labelRows(project);
    return { data: rows, count: rows.length, skip: 0, limit: 10 };
  }

  if (route === "label/count") {
    const isArchivedQuery = Boolean(
      body && body.query && body.query.isArchived === true,
    );
    return { count: isArchivedQuery ? 0 : labelsOf(project).length };
  }

  if (route === "table-view/get-list") {
    return { data: [], count: 0, skip: 0, limit: 10 };
  }

  if (route.startsWith("project/") && route.endsWith("/get-item")) {
    return {
      data: { _id: project.id, name: project.name },
    };
  }

  return null;
};

const answerApi = async (request, response, url) => {
  const route = url.pathname.replace(/^\/api\//, "");
  const tenantId = header(request, "tenantid").toLowerCase();
  const sentProjectHash = header(request, "project-permissions-hash");
  const sentGlobalHash = header(request, "global-permissions-hash");
  const body = await readBody(request);
  const project = projectOf(tenantId);

  const record = {
    method: request.method,
    route: route,
    tenantId: tenantId,
    projectHash: sentProjectHash,
    globalHash: sentGlobalHash,
    projectHashMatched: false,
    sentProjectSnapshot: false,
  };
  requests.push(record);

  if (tenantId) {
    await waitWhileHeld(tenantId);
  }

  const answer = project ? answerFor(route, project, body) : null;

  if (!answer) {
    unexpected.push(`${request.method} ${url.pathname} (${tenantId})`);
    sendJson(response, 404, {
      message: `The fixture does not answer ${url.pathname}`,
    });
    return;
  }

  const headers = {};

  const globalValue = globalSnapshot();
  const globalHash = hashOf(globalValue);

  if (sentGlobalHash !== globalHash) {
    headers["global-permissions"] = globalValue;
    headers["global-permissions-hash"] = globalHash;
  }

  const projectValue = projectSnapshot(project);
  const projectHash = hashOf(projectValue);

  record.projectHashMatched = sentProjectHash === projectHash;

  if (!record.projectHashMatched) {
    headers["project-permissions"] = projectValue;
    headers["project-permissions-hash"] = projectHash;
    record.sentProjectSnapshot = true;
  }

  sendJson(response, 200, answer, headers);
};

async function main() {
  fs.mkdirSync(output, { recursive: true });
  await esbuild.build(config);

  if (process.argv.includes("--build-only")) {
    return;
  }

  const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    response.setHeader("Cache-Control", "no-store");

    if (url.pathname === "/ready") {
      response.end("ready");
      return;
    }

    // A browser asks for it on its own; the pages have none.
    if (url.pathname === "/favicon.ico") {
      response.writeHead(204).end();
      return;
    }

    if (url.pathname === "/__fixture/requests") {
      sendJson(response, 200, {
        requests: requests,
        unexpected: unexpected,
        hashes: Object.fromEntries(
          PROJECTS.map((project) => {
            return [project.id, hashOf(projectSnapshot(project))];
          }),
        ),
      });
      return;
    }

    if (url.pathname === "/__fixture/hold") {
      const projectId = (url.searchParams.get("project") || "").toLowerCase();
      if (!holds.has(projectId)) {
        holds.set(projectId, []);
      }
      sendJson(response, 200, { held: projectId });
      return;
    }

    if (url.pathname === "/__fixture/release") {
      release((url.searchParams.get("project") || "").toLowerCase());
      sendJson(response, 200, { released: true });
      return;
    }

    if (url.pathname === "/__fixture/reset") {
      requests.length = 0;
      unexpected.length = 0;
      for (const projectId of [...holds.keys()]) {
        release(projectId);
      }
      sendJson(response, 200, { reset: true });
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      void answerApi(request, response, url);
      return;
    }

    if (url.pathname === "/tailwind.js") {
      response.setHeader("Content-Type", "application/javascript");
      fs.createReadStream(tailwind).pipe(response);
      return;
    }

    if (url.pathname === "/fonts/InterVariable.woff2") {
      response.setHeader("Content-Type", "font/woff2");
      fs.createReadStream(font).pipe(response);
      return;
    }

    if (url.pathname.startsWith("/dist/")) {
      const file = path.resolve(output, url.pathname.slice(6));
      if (!file.startsWith(output + path.sep) || !fs.existsSync(file)) {
        response.writeHead(404).end();
        return;
      }
      response.setHeader(
        "Content-Type",
        file.endsWith(".css") ? "text/css" : "application/javascript",
      );
      fs.createReadStream(file).pipe(response);
      return;
    }

    if (url.pathname.startsWith("/dashboard/")) {
      response.setHeader("Content-Type", "text/html");
      response.end(html);
      return;
    }

    /*
     * Live updates, the service worker and the rest are not part of this
     * fixture: they are recorded, so a spec sees anything the pages asked
     * for that it does not model.
     */
    unexpected.push(`${request.method} ${url.pathname}`);
    response.writeHead(404).end("Not part of the fixture");
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(
      `Permissions per tab fixture ready at http://127.0.0.1:${port}/dashboard/${PROJECTS[0].id}/settings/labels`,
    );
  });
  process.on("SIGTERM", () => {
    return server.close();
  });
  process.on("SIGINT", () => {
    return server.close();
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
