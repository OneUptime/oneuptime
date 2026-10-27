#!/usr/bin/env node
"use strict";

/*
 * Installs the CLI the way a customer does and runs it.
 *
 * It takes the package npm publishes - the tarball `npm pack` makes, which
 * builds the bundle first (esbuild.config.js) - and installs it globally into
 * an empty prefix, with an empty npm cache and no network, outside the
 * monorepo. Then it runs the installed `oneuptime`: --version, version,
 * --help, the resource list, a login and whoami, and a list, a count and a
 * refused key against a stand-in OneUptime API on 127.0.0.1.
 *
 * #4872 shipped because nothing ever ran that package: every test ran the
 * TypeScript sources inside the monorepo, where "Common/..." resolves, and
 * every CLI published since 10.0.5 died at start with "Cannot find module
 * 'Common/Models/DatabaseModels/Index'".
 *
 * Usage:
 *   node Scripts/SmokeTestPackage.js                  pack this package, then test it
 *   node Scripts/SmokeTestPackage.js --tarball <tgz>  test a tarball packed before
 *   add --keep to leave the install behind for a look
 *
 * It needs nothing but Node.js and npm, so CI runs it on every Node.js line
 * the CLI supports without installing the repository. Tests/PackagedCli
 * runs the same install, and holds the packed CLI to the sources.
 *
 * WINDOWS. It runs there too (#4900's follow-ups). npm is npm.cmd there,
 * which execFile cannot start without a shell (Node.js refuses since
 * CVE-2024-27980), so npm runs as Node.js with npm's own entry point, on
 * every platform (npmCommand). A global install puts the package under
 * <prefix>\node_modules and its command at <prefix>\oneuptime.cmd, not
 * under lib/ and bin/ (globalInstallLayout), and that command is a batch
 * file, run through cmd.exe with each argument quoted for it (cliCommand).
 * Node.js reads the home directory from USERPROFILE there, so the CLI and
 * npm get the empty home as both HOME and USERPROFILE.
 */

const childProcess = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const CLI_ROOT = path.resolve(__dirname, "..");

const PACKAGE_NAME = "@oneuptime/cli";

const COMMAND_NAME = "oneuptime";

const API_KEY = "sk-smoke-test-0123456789";

/**
 * This process's environment without what would let npm or the CLI see past
 * the empty install: settings an outer `npm run` passes down (npm_config_*,
 * such as dry-run or prefix), NODE_PATH and NODE_OPTIONS, and the CLI's own
 * ONEUPTIME_* credentials. An override replaces a variable of the same name
 * in any case: Windows has one Path, whatever its case.
 * @param {Record<string, string>} [overrides] - variables to set
 * @returns {Record<string, string>} the environment
 */
function cleanEnvironment(overrides) {
  const environment = {};
  const overridden = new Set(
    Object.keys(overrides || {}).map((key) => {
      return key.toUpperCase();
    }),
  );

  for (const [key, value] of Object.entries(process.env)) {
    const name = key.toUpperCase();

    if (
      name.startsWith("NPM_") ||
      name.startsWith("ONEUPTIME_") ||
      name === "NODE_PATH" ||
      name === "NODE_OPTIONS" ||
      name === "INIT_CWD" ||
      overridden.has(name)
    ) {
      continue;
    }

    environment[key] = value;
  }

  return { ...environment, ...(overrides || {}) };
}

/**
 * The empty home a run gets: HOME, and USERPROFILE, which Node.js's
 * os.homedir() reads on Windows.
 * @param {string} home - the directory
 * @returns {Record<string, string>} the variables
 */
function homeVariables(home) {
  return { HOME: home, USERPROFILE: home };
}

// npm's entry point, as npm's own command runs it.
const NPM_CLI_SCRIPT = /(^|[\\/])npm-cli\.js$/;

/**
 * How to run npm without a shell: Node.js with npm's entry point, which is
 * what the npm command runs - the npm that `npm run` names in npm_execpath,
 * else the one beside this Node.js (<dir>\node_modules\npm on Windows,
 * <dir>/../lib/node_modules/npm elsewhere). Only when there is none (a
 * version manager's shim) is `npm` run from PATH, through cmd.exe on Windows.
 * @param {{ platform?: string, execPath?: string, env?: Record<string, string | undefined>, exists?: (file: string) => boolean }} [context]
 *   what to look at; this process's by default
 * @returns {{ command: string, args: Array<string>, shell: boolean }} the program, the arguments before npm's own, and whether it needs a shell
 */
function npmCommand(context) {
  const platform = (context && context.platform) || process.platform;
  const execPath = (context && context.execPath) || process.execPath;
  const env = (context && context.env) || process.env;
  const exists = (context && context.exists) || fs.existsSync;
  const paths = platform === "win32" ? path.win32 : path.posix;
  const nodeDirectory = paths.dirname(execPath);
  const candidates = [];

  if (env.npm_execpath && NPM_CLI_SCRIPT.test(env.npm_execpath)) {
    candidates.push(env.npm_execpath);
  }

  candidates.push(
    platform === "win32"
      ? paths.join(nodeDirectory, "node_modules", "npm", "bin", "npm-cli.js")
      : paths.join(
          nodeDirectory,
          "..",
          "lib",
          "node_modules",
          "npm",
          "bin",
          "npm-cli.js",
        ),
  );

  for (const candidate of candidates) {
    if (exists(candidate)) {
      return { command: execPath, args: [candidate], shell: false };
    }
  }

  return platform === "win32"
    ? { command: "npm.cmd", args: [], shell: true }
    : { command: "npm", args: [], shell: false };
}

// What cmd.exe passes to a batch file as it is: no spaces, quotes or operators.
const PLAIN_CMD_ARGUMENT = /^[A-Za-z0-9_.:+@\/\\-]+$/;

/**
 * One argument of a command line cmd.exe runs: as it is when it is plain,
 * else in double quotes. A quote, a % or a line break cannot be passed to a
 * batch file whole, so those are refused rather than passed changed.
 * @param {string} argument - the argument
 * @returns {string} the argument as cmd.exe reads it
 */
function quoteForCmd(argument) {
  const text = String(argument);

  if (/["%\r\n]/.test(text)) {
    throw new Error(
      `${JSON.stringify(text)} cannot be passed through cmd.exe unchanged.`,
    );
  }

  return text !== "" && PLAIN_CMD_ARGUMENT.test(text) ? text : `"${text}"`;
}

/**
 * Where `npm install --global --prefix <prefix>` puts the package and its
 * command: on Windows the package under <prefix>\node_modules and the
 * command at <prefix>\oneuptime.cmd; elsewhere under <prefix>/lib/node_modules
 * and at <prefix>/bin/oneuptime.
 * @param {string} prefix - the --prefix
 * @param {string} [platform] - process.platform by default
 * @returns {{ binary: string, packageDirectory: string }} the command and the package
 */
function globalInstallLayout(prefix, platform) {
  const isWindows = (platform || process.platform) === "win32";
  const paths = isWindows ? path.win32 : path.posix;

  return isWindows
    ? {
        binary: paths.join(prefix, `${COMMAND_NAME}.cmd`),
        packageDirectory: paths.join(
          prefix,
          "node_modules",
          ...PACKAGE_NAME.split("/"),
        ),
      }
    : {
        binary: paths.join(prefix, "bin", COMMAND_NAME),
        packageDirectory: paths.join(
          prefix,
          "lib",
          "node_modules",
          ...PACKAGE_NAME.split("/"),
        ),
      };
}

/**
 * How to run the installed command: the file itself, or on Windows its
 * batch file through cmd.exe, the path and each argument quoted for it.
 * @param {string} binary - the installed command
 * @param {Array<string>} args - its arguments
 * @param {string} [platform] - process.platform by default
 * @returns {{ command: string, args: Array<string>, shell: boolean }} what to run
 */
function cliCommand(binary, args, platform) {
  if ((platform || process.platform) === "win32") {
    return {
      command: `"${binary}"`,
      args: args.map(quoteForCmd),
      shell: true,
    };
  }

  return { command: binary, args: args, shell: false };
}

/**
 * Runs npm (npmCommand) with these arguments, quoted for cmd.exe when it is
 * npm.cmd from PATH.
 * @param {Array<string>} args - npm's arguments
 * @param {{ cwd: string, env: Record<string, string>, timeoutMs?: number }} options - where and how
 * @returns {Promise<{ status: number, stdout: string, stderr: string }>} how it ended
 */
function runNpm(args, options) {
  const npm = npmCommand();

  return run(
    npm.command,
    [...npm.args, ...(npm.shell ? args.map(quoteForCmd) : args)],
    { ...options, shell: npm.shell },
  );
}

/**
 * Runs a command to the end.
 * @param {string} command - the program
 * @param {Array<string>} args - its arguments
 * @param {{ cwd: string, env: Record<string, string>, timeoutMs?: number, shell?: boolean }} options - where and how;
 *   shell runs it through cmd.exe or sh, its arguments quoted by the caller
 * @returns {Promise<{ status: number, stdout: string, stderr: string }>} how it ended
 */
function run(command, args, options) {
  return new Promise((resolve) => {
    childProcess.execFile(
      command,
      args,
      {
        cwd: options.cwd,
        env: options.env,
        maxBuffer: 64 * 1024 * 1024,
        timeout: options.timeoutMs || 120000,
        shell: Boolean(options.shell),
      },
      (error, stdout, stderr) => {
        let status = 0;

        if (error) {
          status = typeof error.code === "number" ? error.code : 1;
        }

        resolve({
          status: status,
          stdout: String(stdout),
          stderr: String(stderr) || (error && !stderr ? String(error) : ""),
        });
      },
    );
  });
}

/**
 * npm pack's --json answer, read past anything a lifecycle script printed
 * before it.
 * @param {string} stdout - what npm pack printed
 * @returns {Array<object>} the packed packages
 */
function readPackJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    const start = stdout.lastIndexOf("\n[\n");

    if (start === -1) {
      throw new Error(`npm pack printed no JSON:\n${stdout}`);
    }

    return JSON.parse(stdout.slice(start + 1));
  }
}

/**
 * Packs this package as npm publish would (prepack builds the bundle).
 * @param {string} destination - the directory for the tarball
 * @returns {Promise<{ tarball: string, name: string, version: string, files: Array<{ path: string, size: number, mode: number }> }>}
 *   the tarball and what npm put in it
 */
async function packCli(destination) {
  fs.mkdirSync(destination, { recursive: true });

  const packed = await runNpm(
    ["pack", "--json", "--pack-destination", destination],
    { cwd: CLI_ROOT, env: cleanEnvironment(), timeoutMs: 300000 },
  );

  if (packed.status !== 0) {
    throw new Error(`npm pack failed:\n${packed.stderr}${packed.stdout}`);
  }

  const [entry] = readPackJson(packed.stdout);

  return {
    tarball: path.join(destination, entry.filename),
    name: entry.name,
    version: entry.version,
    files: entry.files,
  };
}

/**
 * Installs a CLI tarball globally into a new, empty prefix: what
 * `npm install -g @oneuptime/cli` does, with an empty cache and --offline, so
 * the install fails if the package needs anything but itself.
 * @param {string} tarball - the .tgz
 * @param {string} root - an empty directory to install under
 * @returns {Promise<{ root: string, prefix: string, home: string, work: string, binary: string, packageDirectory: string }>}
 *   where everything landed
 */
async function installTarball(tarball, root) {
  const prefix = path.join(root, "prefix");
  const installation = {
    root: root,
    prefix: prefix,
    home: path.join(root, "home"),
    work: path.join(root, "work"),
    ...globalInstallLayout(prefix),
  };
  const cache = path.join(root, "npm-cache");

  for (const directory of [
    installation.prefix,
    installation.home,
    installation.work,
    cache,
  ]) {
    fs.mkdirSync(directory, { recursive: true });
  }

  const installed = await runNpm(
    [
      "install",
      "--global",
      "--prefix",
      installation.prefix,
      "--cache",
      cache,
      "--offline",
      "--no-audit",
      "--no-fund",
      "--no-update-notifier",
      path.resolve(tarball),
    ],
    {
      cwd: installation.work,
      env: cleanEnvironment(homeVariables(installation.home)),
      timeoutMs: 300000,
    },
  );

  if (installed.status !== 0) {
    throw new Error(
      `npm install -g ${path.basename(tarball)} failed. The CLI must install from its tarball alone, with no network: a dependency in its package.json, or anything else npm has to fetch, fails here.\n${installed.stderr}${installed.stdout}`,
    );
  }

  return installation;
}

/**
 * Runs the installed CLI from an empty working directory, with the install's
 * own home (so `login` writes its config there) and no ONEUPTIME_* variables.
 * @param {{ binary: string, home: string, work: string }} installation - from installTarball()
 * @param {Array<string>} args - the CLI's arguments
 * @returns {Promise<{ status: number, stdout: string, stderr: string }>} how it ended
 */
function runCli(installation, args) {
  const cli = cliCommand(installation.binary, args);

  return run(cli.command, cli.args, {
    cwd: installation.work,
    env: cleanEnvironment({
      ...homeVariables(installation.home),
      NO_COLOR: "1",
    }),
    shell: cli.shell,
  });
}

/**
 * A stand-in for a OneUptime API on 127.0.0.1: records each request and
 * answers it with what `respond` returns.
 * @param {(request: { method: string, path: string, headers: object, body: unknown }) => { status?: number, body: unknown }} respond
 *   the answer to a request
 * @returns {Promise<{ url: string, requests: Array<{ method: string, path: string, headers: object, body: unknown }>, close: () => Promise<void> }>}
 *   its address, the requests it has had, and a way to stop it
 */
function startFakeApi(respond) {
  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = [];

    request.on("data", (chunk) => {
      chunks.push(chunk);
    });

    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      let body = null;

      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }

      const recorded = {
        method: request.method,
        path: request.url,
        headers: request.headers,
        body: body,
      };

      requests.push(recorded);

      const answer = respond(recorded);

      response.writeHead(answer.status || 200, {
        "Content-Type": "application/json",
      });
      response.end(JSON.stringify(answer.body));
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        requests: requests,
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
 * The checks every packed CLI must pass, on any Node.js the CLI supports.
 * @param {{ binary: string, home: string, work: string, packageDirectory: string }} installation - from installTarball()
 * @param {string} version - the version the package says it is
 * @returns {Promise<Array<{ name: string, ok: boolean, detail: string }>>} one entry per check
 */
async function smokeTest(installation, version) {
  const results = [];

  async function check(name, body) {
    try {
      const detail = await body();
      results.push({ name: name, ok: true, detail: detail || "" });
    } catch (error) {
      results.push({
        name: name,
        ok: false,
        detail: error && error.message ? error.message : String(error),
      });
    }
  }

  function expectExit(result, status, what) {
    if (result.status !== status) {
      throw new Error(
        `${what} exited ${result.status}, not ${status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
      );
    }
  }

  await check("installs alone, with no package of its own to fetch", () => {
    if (!fs.existsSync(installation.binary)) {
      throw new Error(`npm linked no ${COMMAND_NAME} command`);
    }

    if (
      fs.existsSync(path.join(installation.packageDirectory, "node_modules"))
    ) {
      throw new Error("npm installed dependencies next to the bundle");
    }

    return installation.binary;
  });

  await check("--version prints the package's version", async () => {
    const result = await runCli(installation, ["--version"]);
    expectExit(result, 0, "oneuptime --version");

    if (result.stdout.trim() !== version) {
      throw new Error(`printed "${result.stdout.trim()}", not "${version}"`);
    }

    return result.stdout.trim();
  });

  await check("version prints the package's version", async () => {
    const result = await runCli(installation, ["version"]);
    expectExit(result, 0, "oneuptime version");

    if (result.stdout.trim() !== version) {
      throw new Error(`printed "${result.stdout.trim()}", not "${version}"`);
    }

    return result.stdout.trim();
  });

  await check("--help lists the commands", async () => {
    const result = await runCli(installation, ["--help"]);
    expectExit(result, 0, "oneuptime --help");

    const missing = [
      `Usage: ${COMMAND_NAME}`,
      "login",
      "context",
      "whoami",
      "resources",
      "incident",
      "monitor",
    ].filter((text) => {
      return !result.stdout.includes(text);
    });

    if (missing.length > 0) {
      throw new Error(`the help leaves out: ${missing.join(", ")}`);
    }

    return `${result.stdout.split("\n").length} lines`;
  });

  await check("resources lists the record and telemetry commands", async () => {
    const result = await runCli(installation, [
      "resources",
      "--output",
      "json",
    ]);
    expectExit(result, 0, "oneuptime resources");

    const resources = JSON.parse(result.stdout);
    const byName = new Map(
      resources.map((resource) => {
        return [resource.name, resource];
      }),
    );

    for (const [name, modelType, apiPath] of [
      ["incident", "database", "/incident"],
      ["monitor", "database", "/monitor"],
      ["log", "analytics", "/logs"],
    ]) {
      const resource = byName.get(name);

      if (
        !resource ||
        resource.modelType !== modelType ||
        resource.apiPath !== apiPath
      ) {
        throw new Error(
          `no ${modelType} resource "${name}" at ${apiPath}: ${JSON.stringify(resource)}`,
        );
      }
    }

    return `${resources.length} resources`;
  });

  await check("login saves a context that whoami reads", async () => {
    const login = await runCli(installation, [
      "login",
      API_KEY,
      "https://oneuptime.example.com",
    ]);
    expectExit(login, 0, "oneuptime login");

    const whoami = await runCli(installation, ["whoami"]);
    expectExit(whoami, 0, "oneuptime whoami");

    const expected = [
      "URL:     https://oneuptime.example.com",
      `API Key: ${API_KEY.slice(0, 4)}****${API_KEY.slice(-4)}`,
      "Context: default",
      "",
    ].join("\n");

    if (whoami.stdout !== expected) {
      throw new Error(`whoami printed:\n${whoami.stdout}\nnot:\n${expected}`);
    }

    const config = path.join(installation.home, ".oneuptime", "config.json");

    if (!fs.existsSync(config)) {
      throw new Error(`login wrote no ${config}`);
    }

    return config;
  });

  const rows = [
    { _id: "6b5a3b8e-3d4b-4a8a-9f4b-1c2d3e4f5a6b", title: "Checkout is slow" },
  ];
  const api = await startFakeApi((request) => {
    if (request.headers["apikey"] === "sk-refused") {
      return { status: 401, body: { message: "Invalid API Key" } };
    }

    if (request.path.endsWith("/count")) {
      return { body: { count: 42 } };
    }

    return { body: { data: rows, count: rows.length } };
  });

  try {
    await check(
      "incident list asks the API and prints its answer",
      async () => {
        api.requests.length = 0;
        const result = await runCli(installation, [
          "incident",
          "list",
          "--url",
          api.url,
          "--api-key",
          API_KEY,
          "--output",
          "json",
        ]);
        expectExit(result, 0, "oneuptime incident list");

        const [request] = api.requests;

        if (
          api.requests.length !== 1 ||
          request.method !== "POST" ||
          request.path !== "/api/incident/get-list" ||
          request.headers["apikey"] !== API_KEY
        ) {
          throw new Error(`asked ${JSON.stringify(api.requests)}`);
        }

        const select = request.body && request.body.select;

        if (!select || select._id !== true || select.title !== true) {
          throw new Error(`selected ${JSON.stringify(select)}`);
        }

        if (
          JSON.stringify(JSON.parse(result.stdout)) !== JSON.stringify(rows)
        ) {
          throw new Error(`printed ${result.stdout}`);
        }

        return `${Object.keys(select).length} columns selected`;
      },
    );

    await check(
      "log count asks the telemetry API and prints the count",
      async () => {
        api.requests.length = 0;
        const result = await runCli(installation, [
          "log",
          "count",
          "--url",
          api.url,
          "--api-key",
          API_KEY,
        ]);
        expectExit(result, 0, "oneuptime log count");

        const [request] = api.requests;

        if (
          api.requests.length !== 1 ||
          request.method !== "POST" ||
          request.path !== "/api/logs/count"
        ) {
          throw new Error(`asked ${JSON.stringify(api.requests)}`);
        }

        if (result.stdout.trim() !== "42") {
          throw new Error(`printed "${result.stdout.trim()}"`);
        }

        return result.stdout.trim();
      },
    );

    await check("a refused API key exits 2 with the API's reason", async () => {
      const result = await runCli(installation, [
        "incident",
        "list",
        "--url",
        api.url,
        "--api-key",
        "sk-refused",
      ]);
      expectExit(result, 2, "oneuptime incident list with a refused key");

      if (!result.stderr.includes("Invalid API Key")) {
        throw new Error(`printed no reason: ${result.stderr}`);
      }

      return result.stderr.trim();
    });
  } finally {
    await api.close();
  }

  return results;
}

/**
 * The command line: packs (or takes) a tarball, installs it, runs the checks.
 * @param {Array<string>} argv - the arguments after the script
 * @returns {Promise<number>} the exit code
 */
async function main(argv) {
  const keep = argv.includes("--keep");
  const tarballAt = argv.indexOf("--tarball");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-cli-smoke-"));

  try {
    let tarball;

    if (tarballAt !== -1) {
      if (!argv[tarballAt + 1]) {
        throw new Error("--tarball needs the path of a .tgz");
      }

      tarball = path.resolve(argv[tarballAt + 1]);
    } else {
      tarball = (await packCli(path.join(root, "pack"))).tarball;
    }

    const installation = await installTarball(
      tarball,
      path.join(root, "install"),
    );
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(installation.packageDirectory, "package.json"),
        "utf8",
      ),
    );

    process.stdout.write(
      `${manifest.name}@${manifest.version} from ${path.basename(tarball)} on Node.js ${process.version}\n`,
    );

    const results = await smokeTest(installation, manifest.version);

    for (const result of results) {
      process.stdout.write(
        `${result.ok ? "ok  " : "FAIL"}  ${result.name}${result.detail ? ` - ${result.detail}` : ""}\n`,
      );
    }

    const failed = results.filter((result) => {
      return !result.ok;
    });

    process.stdout.write(
      failed.length === 0
        ? `All ${results.length} checks passed.\n`
        : `${failed.length} of ${results.length} checks failed.\n`,
    );

    return failed.length === 0 ? 0 : 1;
  } finally {
    if (keep) {
      process.stdout.write(`Kept the install in ${root}\n`);
    } else {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
}

module.exports = {
  CLI_ROOT,
  PACKAGE_NAME,
  COMMAND_NAME,
  cleanEnvironment,
  homeVariables,
  npmCommand,
  quoteForCmd,
  globalInstallLayout,
  cliCommand,
  readPackJson,
  packCli,
  installTarball,
  runCli,
  startFakeApi,
  smokeTest,
  main,
};

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
      process.exitCode = 1;
    },
  );
}
