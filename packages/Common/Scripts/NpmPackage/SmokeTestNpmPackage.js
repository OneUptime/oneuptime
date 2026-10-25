#!/usr/bin/env node
"use strict";

/*
 * Installs @oneuptime/common the way a customer does, and uses it.
 *
 * It takes the package the release publishes - Scripts/NPM/PublishAllPackages.sh
 * runs `npm run build-npm-package` and publishes build/npm/package, so this
 * builds that directory and packs it with `npm pack`, the tarball `npm
 * publish` uploads - and installs the tarball into a new, empty project
 * outside the repository, with @types/node beside it as a TypeScript project
 * has. Then it checks that:
 *   - the install brings the package's dependencies and nothing else of
 *     ours, and the package holds what it runs and nothing else
 *     (BuildNpmPackage's verifyPackage, on the installed copy);
 *   - require() loads the package root and every module it exports, each on
 *     its own;
 *   - import loads them too, and hands out the very values require() does;
 *   - a module left out, Server/ and UI/ are not exported, either way;
 *   - the API client calls a stand-in OneUptime API on 127.0.0.1, both ways;
 *   - JSON serialisation, IDs, dates and the data models work, both ways;
 *   - TypeScript resolves the types of every module it exports, and checks
 *     a typed use of the root and of a few modules, with skipLibCheck off,
 *     in each module mode a project uses: CommonJS and ES modules under
 *     nodenext, bundler, and the older node10.
 *
 * Until this package was built, what npm published as @oneuptime/common
 * could not be loaded at all: its main, index.js, did not exist.
 *
 * Usage:
 *   node Scripts/NpmPackage/SmokeTestNpmPackage.js                  build and pack the package, then test it
 *   node Scripts/NpmPackage/SmokeTestNpmPackage.js --tarball <tgz>  test a tarball packed before
 *   add --keep to leave the project behind for a look
 *
 * It needs Node.js, npm, the registry (for the package's dependencies) and
 * packages/Common's own dependencies installed (TypeScript, and the build).
 * CI runs it on each Node.js line the package supports
 * (.github/workflows/test.common.yaml).
 */

const childProcess = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const Build = require("./BuildNpmPackage");

const PACKAGE_NAME = "@oneuptime/common";

const API_KEY = "smoke-test-api-key-0123456789";

const INCIDENT_ID = "4b6c4d6a-2a8b-4c5e-9f1a-0d3e2c1b0a99";

/*
 * What require("@oneuptime/common") hands out, by typeof: classes are
 * functions, the two enums objects. BuildNpmPackage's ROOT_EXPORTS lists them
 * (the types-only ones are not here: they do not exist when it runs).
 */
const ROOT_VALUES = {
  API: "function",
  URL: "function",
  Route: "function",
  Hostname: "function",
  Protocol: "object",
  HTTPMethod: "object",
  HTTPResponse: "function",
  HTTPErrorResponse: "function",
  ObjectID: "function",
  OneUptimeDate: "function",
  JSONFunctions: "function",
  Exception: "function",
  BadDataException: "function",
};

// The modules every check below names, by path: present in every build.
const CORE_MODULES = [
  "Types/ObjectID",
  "Types/Date",
  "Types/JSON",
  "Types/JSONFunctions",
  "Types/API/URL",
  "Types/Monitor/MonitorType",
  "Utils/API",
  "Models/DatabaseModels/Index",
  "Models/DatabaseModels/Incident",
  "Models/AnalyticsModels/Index",
];

/**
 * This process's environment without what would let npm or Node.js see past
 * the new project: what an outer `npm run` passes down (npm_config_*, such
 * as dry-run or prefix), NODE_PATH and NODE_OPTIONS.
 * @returns {Record<string, string>} the environment
 */
function cleanEnvironment() {
  const environment = {};

  for (const [key, value] of Object.entries(process.env)) {
    const name = key.toUpperCase();

    if (
      name.startsWith("NPM_") ||
      name === "NODE_PATH" ||
      name === "NODE_OPTIONS" ||
      name === "INIT_CWD"
    ) {
      continue;
    }

    environment[key] = value;
  }

  return environment;
}

/**
 * Runs a command to the end, without blocking this process (the stand-in API
 * answers while a child calls it).
 * @param {string} command - the program
 * @param {Array<string>} args - its arguments
 * @param {{ cwd: string, timeoutMs?: number }} options - where, and for how long at most
 * @returns {Promise<{ status: number, stdout: string, stderr: string }>} how it ended
 */
function run(command, args, options) {
  return new Promise((resolve) => {
    childProcess.execFile(
      command,
      args,
      {
        cwd: options.cwd,
        env: cleanEnvironment(),
        maxBuffer: 256 * 1024 * 1024,
        timeout: options.timeoutMs || 600000,
      },
      (error, stdout, stderr) => {
        let status = 0;

        if (error) {
          status = typeof error.code === "number" ? error.code : 1;
        }

        resolve({
          status,
          stdout: String(stdout),
          stderr: String(stderr) || (error && !stderr ? String(error) : ""),
        });
      },
    );
  });
}

/**
 * The last line of a child's output that is JSON: what a check script
 * reports, read past anything a module printed before it.
 * @param {string} stdout - what it printed
 * @returns {any} the report
 */
function lastJsonLine(stdout) {
  const lines = stdout.trim().split("\n").reverse();

  for (const line of lines) {
    try {
      return JSON.parse(line);
    } catch {
      // Not the report; look further up.
    }
  }

  throw new Error(`printed no report:\n${stdout}`);
}

/**
 * Builds the package (BuildNpmPackage.js) and packs it as `npm publish`
 * would.
 * @param {string} destination - the directory for the tarball
 * @returns {Promise<string>} the tarball
 */
async function buildAndPack(destination) {
  const built = await run(
    process.execPath,
    ["--max-old-space-size=8192", path.join(__dirname, "BuildNpmPackage.js")],
    { cwd: Build.COMMON_ROOT, timeoutMs: 1800000 },
  );

  process.stdout.write(built.stdout);

  if (built.status !== 0) {
    throw new Error(`The build failed:\n${built.stderr}`);
  }

  fs.mkdirSync(destination, { recursive: true });

  const packed = await run(
    "npm",
    [
      "pack",
      Build.PACKAGE_DIRECTORY,
      "--json",
      "--pack-destination",
      destination,
    ],
    { cwd: Build.COMMON_ROOT },
  );

  if (packed.status !== 0) {
    throw new Error(`npm pack failed:\n${packed.stderr}`);
  }

  const [summary] = JSON.parse(packed.stdout);

  return path.join(destination, summary.filename);
}

/**
 * The module ids an installed package publishes: every .js file under its
 * public directories, and each public file it has.
 * @param {string} installed - the installed package
 * @returns {Array<string>} the ids, sorted
 */
function publishedModules(installed) {
  const ids = [];

  for (const directory of Build.PUBLIC_DIRECTORIES) {
    const walk = (current) => {
      if (!fs.existsSync(current)) {
        return;
      }

      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);

        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith(".js")) {
          ids.push(
            path
              .relative(installed, full)
              .split(path.sep)
              .join("/")
              .slice(0, -".js".length),
          );
        }
      }
    };

    walk(path.join(installed, directory));
  }

  for (const file of Build.PUBLIC_FILES) {
    if (fs.existsSync(path.join(installed, `${file}.js`))) {
      ids.push(file);
    }
  }

  return ids.sort();
}

// The check scripts the new project runs. Each prints one JSON line last.

const REQUIRE_EVERY_MODULE = `"use strict";
const fs = require("fs");
const path = require("path");
const ids = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const root = path.dirname(require.resolve("${PACKAGE_NAME}/package.json"));
const failures = [];
const started = Date.now();
for (const id of ids) {
  // Each module loads as if it came first: the package's own files are
  // dropped from require's cache before each one (its dependencies stay).
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(root + path.sep)) {
      delete require.cache[key];
    }
  }
  try {
    const loaded = require("${PACKAGE_NAME}/" + id);
    if (loaded === null || typeof loaded !== "object") {
      failures.push(id + ": exported " + typeof loaded);
    }
  } catch (error) {
    failures.push(id + ": " + String(error && error.message).split("\\n")[0]);
  }
}
console.log(JSON.stringify({ loaded: ids.length - failures.length, failures, ms: Date.now() - started }));
`;

const REQUIRE_ROOT = `"use strict";
const started = Date.now();
const root = require("${PACKAGE_NAME}");
const ms = Date.now() - started;
const exported = {};
for (const [name, value] of Object.entries(root)) {
  exported[name] = typeof value;
}
console.log(JSON.stringify({ exported, ms }));
`;

const IMPORT_EVERY_MODULE = `import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ids = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const failures = [];
const started = Date.now();
const names = (object) => Object.keys(object).filter((name) => name !== "default" && name !== "__esModule").sort();
for (const id of ["", ...ids]) {
  const specifier = id ? "${PACKAGE_NAME}/" + id : "${PACKAGE_NAME}";
  try {
    const imported = await import(specifier);
    const required = require(specifier);
    if (Object.prototype.hasOwnProperty.call(required, "default") && imported.default !== required.default) {
      failures.push(specifier + ": its default is not the one require() gives");
    }
    if (!Object.prototype.hasOwnProperty.call(required, "default") && "default" in imported) {
      failures.push(specifier + ": has a default require() does not");
    }
    if (JSON.stringify(names(imported)) !== JSON.stringify(names(required))) {
      failures.push(specifier + ": exports " + names(imported).join(",") + " where require() gives " + names(required).join(","));
    }
    for (const name of names(required)) {
      if (imported[name] !== required[name]) {
        failures.push(specifier + ": its " + name + " is not the one require() gives");
      }
    }
  } catch (error) {
    failures.push(specifier + ": " + String(error && error.message).split("\\n")[0]);
  }
}
console.log(JSON.stringify({ loaded: ids.length + 1 - failures.length, failures, ms: Date.now() - started }));
`;

const NOT_EXPORTED = `import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const specifiers = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const results = {};
for (const specifier of specifiers) {
  const codes = [];
  try {
    require(specifier);
    codes.push("loaded");
  } catch (error) {
    codes.push(error.code || String(error.message));
  }
  try {
    await import(specifier);
    codes.push("loaded");
  } catch (error) {
    codes.push(error.code || String(error.message));
  }
  results[specifier] = codes;
}
console.log(JSON.stringify(results));
`;

// The same use of the package, from CommonJS and from an ES module.
function apiAndModelsScript(kind, baseUrl) {
  const imports =
    kind === "require"
      ? `const { API, URL, HTTPErrorResponse, HTTPResponse, ObjectID, OneUptimeDate, JSONFunctions } = require("${PACKAGE_NAME}");
const DatabaseModels = require("${PACKAGE_NAME}/Models/DatabaseModels/Index").default;
const AnalyticsModels = require("${PACKAGE_NAME}/Models/AnalyticsModels/Index").default;
const Incident = require("${PACKAGE_NAME}/Models/DatabaseModels/Incident").default;
const MonitorType = require("${PACKAGE_NAME}/Types/Monitor/MonitorType").default;
const DeepObjectID = require("${PACKAGE_NAME}/Types/ObjectID").default;
const main = async () => {`
      : `import { API, URL, HTTPErrorResponse, HTTPResponse, ObjectID, OneUptimeDate, JSONFunctions } from "${PACKAGE_NAME}";
import DatabaseModels from "${PACKAGE_NAME}/Models/DatabaseModels/Index";
import AnalyticsModels from "${PACKAGE_NAME}/Models/AnalyticsModels/Index";
import Incident from "${PACKAGE_NAME}/Models/DatabaseModels/Incident";
import MonitorType from "${PACKAGE_NAME}/Types/Monitor/MonitorType";
import DeepObjectID from "${PACKAGE_NAME}/Types/ObjectID";
const main = async () => {`;

  return `${imports}
  const report = {};
  const listed = await API.post({
    url: URL.fromString("${baseUrl}/api/incident/get-list"),
    headers: { APIKey: "${API_KEY}" },
    data: { query: {}, select: { title: true }, limit: 10 },
  });
  report.listed = {
    isResponse: listed instanceof HTTPResponse,
    isError: listed instanceof HTTPErrorResponse,
    statusCode: listed.statusCode,
    data: listed.data,
  };
  const refused = await API.post({
    url: URL.fromString("${baseUrl}/api/not-a-resource/get-list"),
    headers: { APIKey: "${API_KEY}" },
    data: { query: {} },
  });
  report.refused = {
    isError: refused instanceof HTTPErrorResponse,
    statusCode: refused.statusCode,
    message: refused.message,
  };
  const id = new ObjectID("${INCIDENT_ID}");
  const serialized = JSONFunctions.serialize({ id, at: OneUptimeDate.fromString("2026-10-25T10:00:00.000Z") });
  const deserialized = JSONFunctions.deserialize(serialized);
  report.json = {
    serialized,
    idIsObjectID: deserialized.id instanceof ObjectID,
    idIsDeepObjectID: deserialized.id instanceof DeepObjectID,
    id: String(deserialized.id),
    atIsDate: deserialized.at instanceof Date,
    at: deserialized.at instanceof Date ? deserialized.at.toISOString() : null,
  };
  const incident = new Incident();
  incident.title = "Database is slow";
  report.models = {
    databaseModels: DatabaseModels.length,
    allClasses: DatabaseModels.every((model) => typeof model === "function"),
    hasIncident: DatabaseModels.includes(Incident),
    analyticsModels: AnalyticsModels.length,
    tableName: incident.tableName,
    title: incident.title,
    website: MonitorType.Website,
  };
  console.log(JSON.stringify(report));
};
main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
`;
}

// A typed use of the package, held to its real types.
const TYPED_USE = `import ObjectID from "${PACKAGE_NAME}/Types/ObjectID";
import OneUptimeDate from "${PACKAGE_NAME}/Types/Date";
import { JSONObject, ObjectType } from "${PACKAGE_NAME}/Types/JSON";
import MonitorType from "${PACKAGE_NAME}/Types/Monitor/MonitorType";
import Incident from "${PACKAGE_NAME}/Models/DatabaseModels/Incident";
import DatabaseModels from "${PACKAGE_NAME}/Models/DatabaseModels/Index";
import { AppApiRoute } from "${PACKAGE_NAME}/ServiceRoute";
import {
  API,
  BadDataException,
  Dictionary,
  HTTPErrorResponse,
  HTTPResponse,
  JSONArray,
  Route,
  URL,
} from "${PACKAGE_NAME}";

const id: ObjectID = new ObjectID("${INCIDENT_ID}");
const now: Date = OneUptimeDate.getCurrentDate();
const json: JSONObject = { _type: ObjectType.ObjectID, value: id.toString() };
const list: JSONArray = [json];
const type: MonitorType = MonitorType.Website;
const incident: Incident = new Incident();
incident.title = "Database is slow";
const models: number = DatabaseModels.length;
const route: Route = AppApiRoute;
const headers: Dictionary<string> = { APIKey: "${API_KEY}" };
const problem: BadDataException = new BadDataException("Not a monitor");

// @ts-expect-error A Dictionary<string> holds strings: the types are real, not any.
const notStrings: Dictionary<string> = { APIKey: 1 };

// @ts-expect-error ObjectID takes a string.
const notAnId: ObjectID = new ObjectID(42);

export async function listIncidents(): Promise<JSONObject> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post({
    url: URL.fromString("https://oneuptime.com/api/incident/get-list"),
    headers,
    data: { query: {}, select: { title: true }, limit: 10 },
  });

  if (response instanceof HTTPErrorResponse) {
    throw new Error(response.message);
  }

  return response.data;
}

export const used: Array<unknown> = [now, list, type, incident, models, route, problem, notStrings, notAnId];
`;

/*
 * The module modes a TypeScript project uses, and the file name each gives
 * its sources: nodenext reads .cts as CommonJS and .mts as an ES module.
 */
const TYPESCRIPT_MODES = [
  {
    name: "nodenext, CommonJS",
    directory: "types-nodenext-cjs",
    extension: ".cts",
    options: { module: "nodenext", moduleResolution: "nodenext" },
  },
  {
    name: "nodenext, ES module",
    directory: "types-nodenext-esm",
    extension: ".mts",
    options: { module: "nodenext", moduleResolution: "nodenext" },
  },
  {
    name: "bundler",
    directory: "types-bundler",
    extension: ".ts",
    options: { module: "esnext", moduleResolution: "bundler" },
  },
  {
    name: "node10, CommonJS",
    directory: "types-node10",
    extension: ".ts",
    options: {
      module: "commonjs",
      moduleResolution: "node10",
      esModuleInterop: true,
      ignoreDeprecations: "5.0",
    },
  },
];

/**
 * A stand-in OneUptime API on 127.0.0.1: incident get-list answers one
 * incident, anything else 404. It writes down every request.
 * @returns {Promise<{ url: string, requests: Array<object>, close: () => Promise<void> }>} the server
 */
function startStandInApi() {
  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = [];

    request.on("data", (chunk) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");

      requests.push({
        method: request.method,
        url: request.url,
        apiKey: request.headers["apikey"],
        // The media type: axios adds ";charset=UTF-8".
        contentType: String(request.headers["content-type"])
          .split(";")[0]
          .trim(),
        body: body ? JSON.parse(body) : null,
      });

      if (
        request.method === "POST" &&
        request.url === "/api/incident/get-list"
      ) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            data: [{ _id: INCIDENT_ID, title: "Database is slow" }],
            count: 1,
          }),
        );
        return;
      }

      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Not found" }));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        requests,
        close: () => {
          return new Promise((done) => {
            server.close(() => {
              done();
            });
          });
        },
      });
    });
  });
}

/**
 * What the use of the API, JSON and the models must have printed, one way.
 * @param {object} report - what the script printed
 * @returns {Array<string>} what is wrong
 */
function apiAndModelsProblems(report) {
  const problems = [];
  const expect = (what, actual, expected) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      problems.push(
        `${what}: ${JSON.stringify(actual)}, not ${JSON.stringify(expected)}`,
      );
    }
  };

  expect("the list call", report.listed, {
    isResponse: true,
    isError: false,
    statusCode: 200,
    data: { data: [{ _id: INCIDENT_ID, title: "Database is slow" }], count: 1 },
  });
  expect("the refused call", report.refused && report.refused.isError, true);
  expect(
    "the refused call's status",
    report.refused && report.refused.statusCode,
    404,
  );
  expect("the serialized ID and date", report.json && report.json.serialized, {
    id: { _type: "ObjectID", value: INCIDENT_ID },
    at: { _type: "DateTime", value: "2026-10-25T10:00:00.000Z" },
  });
  expect(
    "the deserialized ID and date",
    report.json && {
      idIsObjectID: report.json.idIsObjectID,
      idIsDeepObjectID: report.json.idIsDeepObjectID,
      id: report.json.id,
      atIsDate: report.json.atIsDate,
      at: report.json.at,
    },
    {
      idIsObjectID: true,
      idIsDeepObjectID: true,
      id: INCIDENT_ID,
      atIsDate: true,
      at: "2026-10-25T10:00:00.000Z",
    },
  );
  expect(
    "the models",
    report.models && {
      allClasses: report.models.allClasses,
      hasIncident: report.models.hasIncident,
      tableName: report.models.tableName,
      title: report.models.title,
      website: report.models.website,
    },
    {
      allClasses: true,
      hasIncident: true,
      tableName: "Incident",
      title: "Database is slow",
      website: "Website",
    },
  );

  if (!report.models || report.models.databaseModels < 100) {
    problems.push(
      `the database models: ${report.models && report.models.databaseModels}, expected hundreds`,
    );
  }

  if (!report.models || report.models.analyticsModels < 10) {
    problems.push(
      `the analytics models: ${report.models && report.models.analyticsModels}, expected dozens`,
    );
  }

  return problems;
}

async function main() {
  const args = process.argv.slice(2);
  const keep = args.includes("--keep");
  const tarballIndex = args.indexOf("--tarball");
  const scratch = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-common-smoke-"),
  );
  const project = path.join(scratch, "project");
  const results = [];
  const check = async (name, body) => {
    const started = Date.now();
    let problems;

    try {
      problems = await body();
    } catch (error) {
      problems = [String((error && error.stack) || error)];
    }

    const seconds = ((Date.now() - started) / 1000).toFixed(1);

    results.push({ name, problems });
    console.log(
      `${problems.length === 0 ? "ok  " : "FAIL"} ${name} (${seconds} s)`,
    );

    for (const problem of problems.slice(0, 40)) {
      console.log(`       ${problem}`);
    }

    if (problems.length > 40) {
      console.log(`       ... and ${problems.length - 40} more`);
    }

    return problems.length === 0;
  };

  try {
    const tarball =
      tarballIndex === -1
        ? await buildAndPack(path.join(scratch, "pack"))
        : path.resolve(args[tarballIndex + 1]);
    const tsc = require.resolve("typescript/bin/tsc", {
      paths: [Build.COMMON_ROOT],
    });
    const ts = require(
      require.resolve("typescript", { paths: [Build.COMMON_ROOT] }),
    );
    const commonManifest = JSON.parse(
      fs.readFileSync(path.join(Build.COMMON_ROOT, "package.json"), "utf8"),
    );
    const installed = path.join(project, "node_modules", PACKAGE_NAME);

    console.log(`Testing ${tarball} on Node.js ${process.version}`);

    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(
      path.join(project, "package.json"),
      `${JSON.stringify(
        {
          name: "oneuptime-common-smoke-test",
          version: "1.0.0",
          private: true,
        },
        null,
        2,
      )}\n`,
    );

    const installs = await check(
      "it installs into a new project, with its dependencies and nothing else of ours",
      async () => {
        const installedPackage = await run(
          "npm",
          [
            "install",
            tarball,
            `@types/node@${commonManifest.devDependencies["@types/node"]}`,
            "--no-audit",
            "--no-fund",
            "--loglevel=error",
          ],
          { cwd: project },
        );

        if (installedPackage.status !== 0) {
          return [`npm install failed:\n${installedPackage.stderr}`];
        }

        const problems = [];
        const manifest = JSON.parse(
          fs.readFileSync(path.join(installed, "package.json"), "utf8"),
        );
        const ours = fs.readdirSync(
          path.join(project, "node_modules", "@oneuptime"),
        );

        if (JSON.stringify(ours) !== JSON.stringify(["common"])) {
          problems.push(`node_modules/@oneuptime holds ${ours.join(", ")}`);
        }

        for (const name of Object.keys(manifest.dependencies || {})) {
          if (
            !fs.existsSync(
              path.join(project, "node_modules", name, "package.json"),
            )
          ) {
            problems.push(`its dependency ${name} was not installed`);
          }
        }

        for (const field of [
          "scripts",
          "devDependencies",
          "peerDependencies",
          "optionalDependencies",
          "bundleDependencies",
        ]) {
          if (manifest[field] !== undefined) {
            problems.push(`its manifest has ${field}`);
          }
        }

        if (
          JSON.stringify(manifest.engines) !==
          JSON.stringify({ node: Build.NODE_ENGINE })
        ) {
          problems.push(`its engines are ${JSON.stringify(manifest.engines)}`);
        }

        return problems;
      },
    );

    if (!installs) {
      throw new Error("Nothing else can be checked without the install.");
    }

    const manifest = JSON.parse(
      fs.readFileSync(path.join(installed, "package.json"), "utf8"),
    );
    const modules = publishedModules(installed);
    const leftOut = Object.entries(manifest.exports)
      .filter(([, target]) => {
        return target === null;
      })
      .map(([subpath]) => {
        return subpath.slice(2);
      });
    const modulesFile = path.join(scratch, "modules.json");

    fs.writeFileSync(modulesFile, JSON.stringify(modules));

    await check(
      "it holds what it runs and nothing else, and names nothing it lacks",
      async () => {
        const problems = Build.verifyPackage(ts, installed);

        for (const id of CORE_MODULES) {
          if (!modules.includes(id)) {
            problems.push(`${id} is not in the package`);
          }
        }

        if (modules.length < 1000) {
          problems.push(
            `it publishes ${modules.length} modules, expected thousands`,
          );
        }

        return problems;
      },
    );

    await check("require() loads the package root", async () => {
      const script = path.join(project, "require-root.cjs");
      fs.writeFileSync(script, REQUIRE_ROOT);

      const loaded = await run(process.execPath, [script], { cwd: project });

      if (loaded.status !== 0) {
        return [loaded.stderr];
      }

      const report = lastJsonLine(loaded.stdout);

      console.log(`       the root loads in ${report.ms} ms`);

      return JSON.stringify(report.exported) === JSON.stringify(ROOT_VALUES)
        ? []
        : [
            `the root exports ${JSON.stringify(report.exported)}, not ${JSON.stringify(ROOT_VALUES)}`,
          ];
    });

    await check(
      `require() loads every module it exports (${modules.length}), each on its own`,
      async () => {
        const script = path.join(project, "require-every-module.cjs");
        fs.writeFileSync(script, REQUIRE_EVERY_MODULE);

        const loaded = await run(process.execPath, [script, modulesFile], {
          cwd: project,
        });

        if (loaded.status !== 0) {
          return [loaded.stderr];
        }

        return lastJsonLine(loaded.stdout).failures;
      },
    );

    await check(
      "import loads the root and every module, and hands out what require() does",
      async () => {
        const script = path.join(project, "import-every-module.mjs");
        fs.writeFileSync(script, IMPORT_EVERY_MODULE);

        const loaded = await run(process.execPath, [script, modulesFile], {
          cwd: project,
        });

        if (loaded.status !== 0) {
          return [loaded.stderr];
        }

        return lastJsonLine(loaded.stdout).failures;
      },
    );

    await check(
      `a module left out (${leftOut.length}), Server/ and UI/ are not exported, either way`,
      async () => {
        const specifiers = [
          ...leftOut.map((id) => {
            return `${PACKAGE_NAME}/${id}`;
          }),
          `${PACKAGE_NAME}/Server/Utils/Logger`,
          `${PACKAGE_NAME}/UI/Components/Dropdown/Dropdown`,
          `${PACKAGE_NAME}/Types/ObjectID.js`,
        ];
        const listFile = path.join(scratch, "not-exported.json");
        const script = path.join(project, "not-exported.mjs");

        fs.writeFileSync(listFile, JSON.stringify(specifiers));
        fs.writeFileSync(script, NOT_EXPORTED);

        const loaded = await run(process.execPath, [script, listFile], {
          cwd: project,
        });

        if (loaded.status !== 0) {
          return [loaded.stderr];
        }

        const problems = [];
        const report = lastJsonLine(loaded.stdout);

        for (const specifier of specifiers) {
          const codes = report[specifier] || [];
          const expected = specifier.endsWith(".js")
            ? ["MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND"]
            : [
                "ERR_PACKAGE_PATH_NOT_EXPORTED",
                "ERR_PACKAGE_PATH_NOT_EXPORTED",
              ];

          if (JSON.stringify(codes) !== JSON.stringify(expected)) {
            problems.push(
              `${specifier}: ${codes.join(", ")}, not ${expected.join(", ")}`,
            );
          }
        }

        return problems;
      },
    );

    for (const kind of ["require", "import"]) {
      await check(
        `${kind}: the API client calls an API, and JSON, IDs, dates and the data models work`,
        async () => {
          const api = await startStandInApi();

          try {
            const script = path.join(
              project,
              kind === "require" ? "use.cjs" : "use.mjs",
            );
            fs.writeFileSync(script, apiAndModelsScript(kind, api.url));

            const used = await run(process.execPath, [script], {
              cwd: project,
            });

            if (used.status !== 0) {
              return [used.stderr];
            }

            const problems = apiAndModelsProblems(lastJsonLine(used.stdout));
            const expectedRequests = [
              {
                method: "POST",
                url: "/api/incident/get-list",
                apiKey: API_KEY,
                contentType: "application/json",
                body: { query: {}, select: { title: true }, limit: 10 },
              },
              {
                method: "POST",
                url: "/api/not-a-resource/get-list",
                apiKey: API_KEY,
                contentType: "application/json",
                body: { query: {} },
              },
            ];

            if (
              JSON.stringify(api.requests) !== JSON.stringify(expectedRequests)
            ) {
              problems.push(
                `the API got ${JSON.stringify(api.requests)}, not ${JSON.stringify(expectedRequests)}`,
              );
            }

            return problems;
          } finally {
            await api.close();
          }
        },
      );
    }

    for (const mode of TYPESCRIPT_MODES) {
      await check(
        `TypeScript (${mode.name}, skipLibCheck off): the types of every module resolve, and a typed use checks`,
        async () => {
          const directory = path.join(project, mode.directory);
          const everyModule = [
            `${PACKAGE_NAME}`,
            ...modules.map((id) => {
              return `${PACKAGE_NAME}/${id}`;
            }),
          ]
            .map((specifier, index) => {
              return `import type * as Module${index} from ${JSON.stringify(specifier)};`;
            })
            .join("\n");
          const files = [
            `every-module${mode.extension}`,
            `use${mode.extension}`,
          ];

          fs.mkdirSync(directory, { recursive: true });
          fs.writeFileSync(
            path.join(directory, files[0]),
            `${everyModule}\nexport {};\n`,
          );
          fs.writeFileSync(path.join(directory, files[1]), TYPED_USE);
          fs.writeFileSync(
            path.join(directory, "tsconfig.json"),
            `${JSON.stringify(
              {
                compilerOptions: {
                  ...mode.options,
                  target: "es2022",
                  strict: true,
                  noEmit: true,
                  skipLibCheck: false,
                  types: ["node"],
                },
                files,
              },
              null,
              2,
            )}\n`,
          );

          const checked = await run(
            process.execPath,
            ["--max-old-space-size=8192", tsc, "-p", "tsconfig.json"],
            { cwd: directory },
          );

          return checked.status === 0
            ? []
            : `${checked.stdout}${checked.stderr}`
                .trim()
                .split("\n")
                .filter((line) => {
                  return line.length > 0;
                });
        },
      );
    }
  } catch (error) {
    results.push({ name: "setup", problems: [String(error.message)] });
    console.log(`FAIL ${String(error.message)}`);
  } finally {
    if (keep) {
      console.log(`The project is in ${project}`);
    } else {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }

  const failed = results.filter((result) => {
    return result.problems.length > 0;
  });

  console.log(
    failed.length === 0
      ? `${PACKAGE_NAME}: all ${results.length} checks passed.`
      : `${PACKAGE_NAME}: ${failed.length} of ${results.length} checks failed.`,
  );

  return failed.length === 0 ? 0 : 1;
}

module.exports = {
  PACKAGE_NAME,
  ROOT_VALUES,
  CORE_MODULES,
  TYPESCRIPT_MODES,
  publishedModules,
  apiAndModelsProblems,
  lastJsonLine,
};

if (require.main === module) {
  main().then((status) => {
    process.exit(status);
  });
}
