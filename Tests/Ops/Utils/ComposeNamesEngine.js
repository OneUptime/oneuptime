"use strict";

/*
 * A stand-in Docker engine and Compose, for the install-script suites of the
 * agents whose containers are named from .env (#11168, #11434). One machine:
 * every directory of a test's scratch directory shares its containers
 * ($STUB_DIR/containers.json), as every install shares one engine.
 *
 * As Docker and Compose do:
 *   - a directory's project is COMPOSE_PROJECT_NAME (the shell's, else its
 *     .env's), else its name, lower case, a-z 0-9 _ - only, no leading _ or -;
 *     so two directories of one name are one project;
 *   - `compose up` runs each service of the compose file (-f, or
 *     docker-compose.yml) whose profiles are active (--profile, or
 *     COMPOSE_PROFILES from the shell, else .env), under its container_name,
 *     with ${VAR:-default} read from the shell, else .env; a service with no
 *     container_name is <project>-<service>-1. A name another project's
 *     container holds is refused, with Docker's own message, and nothing
 *     changes. The project's containers of those services are recreated;
 *   - `compose ps -a -q [service]`, `compose rm -sf <service>`, `compose down`;
 *   - `ps -a --filter label=com.docker.compose.project=<p>` with the working
 *     directory's label;
 *   - `inspect -f <format> <name, id or id prefix>`: .Name, .State, .Config.Env
 *     and .Config.User; an unknown container is an error;
 *   - `logs`, `exec` and `run` answer from files a test writes
 *     ($STUB_DIR/logs.<container>, exec.out, run.out).
 * Every call is logged to $STUB_DIR/docker.log as "<cwd> | <args>", and what
 * each `compose up` sees of the *_CONTAINER_NAME variables in its own
 * environment, as "compose up sees: ...". $STUB_DIR/up.fail and pull.fail
 * make those fail.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function engineScript() {
  const yamlPath = require.resolve("js-yaml");
  return `#!/usr/bin/env node
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const yaml = require(${JSON.stringify(yamlPath)});

const STUB = process.env.STUB_DIR;
const REGISTRY = path.join(STUB, "containers.json");
const args = process.argv.slice(2);
fs.appendFileSync(path.join(STUB, "docker.log"), process.cwd() + " | " + args.join(" ") + "\\n");

function load() {
  try { return JSON.parse(fs.readFileSync(REGISTRY, "utf8")); } catch { return []; }
}
function save(containers) {
  fs.writeFileSync(REGISTRY, JSON.stringify(containers, null, 2));
}
function idOf(name, dir) {
  return crypto.createHash("sha256").update(name + "|" + dir).digest("hex").slice(0, 12);
}
// A .env as Compose reads it: the last of a name wins, quotes taken off.
function dotenv(dir) {
  const values = {};
  let text = "";
  try { text = fs.readFileSync(path.join(dir, ".env"), "utf8"); } catch { return values; }
  for (const line of text.split("\\n")) {
    const match = /^\\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2];
    if (value.startsWith("'")) value = value.slice(1, value.lastIndexOf("'"));
    else if (value.startsWith('"')) value = value.slice(1, value.lastIndexOf('"')).replace(/\\\\(["\\\\])/g, "$1").replace(/\\$\\$/g, "$");
    else value = value.replace(/\\s+#.*$/, "").trim();
    values[match[1]] = value;
  }
  return values;
}
function variable(dir, name) {
  if (process.env[name] !== undefined && process.env[name] !== "") return process.env[name];
  return dotenv(dir)[name];
}
function projectOf(dir) {
  const name = variable(dir, "COMPOSE_PROJECT_NAME") || path.basename(dir);
  return name.toLowerCase().replace(/[^a-z0-9_-]/g, "").replace(/^[-_]+/, "");
}
function interpolate(dir, value) {
  return String(value).replace(/\\$\\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\\}/g, (match, name, fallback) => {
    const given = variable(dir, name);
    return given !== undefined && given !== "" ? given : (fallback || "");
  });
}
function composeFiles(dir, flags) {
  const files = flags.files.length > 0 ? flags.files : ["docker-compose.yml"];
  return files.map((file) => path.resolve(dir, file));
}
function servicesOf(dir, flags) {
  const services = {};
  for (const file of composeFiles(dir, flags)) {
    const parsed = yaml.load(fs.readFileSync(file, "utf8")) || {};
    Object.assign(services, parsed.services || {});
  }
  return services;
}
function activeProfiles(dir, flags) {
  const fromEnv = variable(dir, "COMPOSE_PROFILES") || "";
  return new Set([...flags.profiles, ...fromEnv.split(",").map((p) => p.trim()).filter(Boolean)]);
}
function containerNameOf(dir, project, service, definition) {
  return definition.container_name
    ? interpolate(dir, definition.container_name)
    : project + "-" + service + "-1";
}
function find(containers, target) {
  return containers.find((c) => c.name === target || c.name === target.replace(/^\\//, "") || c.id === target || (target.length >= 4 && c.id.startsWith(target)));
}
function fail(message, code = 1) {
  process.stderr.write(message + "\\n");
  process.exit(code);
}

if (args[0] === "info") process.exit(0);

if (args[0] === "compose") {
  const flags = { files: [], profiles: [] };
  let i = 1;
  while (i < args.length) {
    if (args[i] === "-f") { flags.files.push(args[i + 1]); i += 2; }
    else if (args[i] === "--profile") { flags.profiles.push(args[i + 1]); i += 2; }
    else break;
  }
  const command = args[i];
  const rest = args.slice(i + 1);
  const dir = process.cwd();
  if (command === "version") { console.log("Docker Compose version v5.7.1"); process.exit(0); }
  if (command === "pull") process.exit(fs.existsSync(path.join(STUB, "pull.fail")) ? 1 : 0);
  const project = projectOf(dir);
  const containers = load();
  if (command === "up") {
    const seen = Object.keys(process.env).filter((name) => /_CONTAINER_NAME$/.test(name)).sort().map((name) => name + "=" + process.env[name]);
    fs.appendFileSync(path.join(STUB, "docker.log"), "compose up sees: " + seen.join(" ") + "\\n");
    if (fs.existsSync(path.join(STUB, "up.fail"))) process.exit(1);
    const services = servicesOf(dir, flags);
    const profiles = activeProfiles(dir, flags);
    const wanted = Object.entries(services).filter(([, definition]) => {
      const own = (definition && definition.profiles) || [];
      return own.length === 0 || own.some((profile) => profiles.has(profile));
    });
    const next = [];
    for (const [service, definition] of wanted) {
      const name = containerNameOf(dir, project, service, definition || {});
      const holder = containers.find((c) => c.name === name && c.project !== project);
      if (holder) {
        fail('Error response from daemon: Conflict. The container name "/' + name + '" is already in use by container "' + holder.id + '". You have to remove (or rename) that container to be able to reuse that name.');
      }
      next.push({ name, dir, project, service, id: idOf(name, dir), env: (definition && definition.environment) || [] });
    }
    const replaced = new Set(next.map((c) => c.service));
    save([...containers.filter((c) => !(c.project === project && replaced.has(c.service))), ...next]);
    process.exit(0);
  }
  if (command === "ps") {
    const quiet = rest.includes("-q");
    const service = rest.filter((arg) => !arg.startsWith("-"))[0];
    if (!quiet && fs.existsSync(path.join(STUB, "compose-ps"))) {
      process.stdout.write(fs.readFileSync(path.join(STUB, "compose-ps"), "utf8"));
      process.exit(0);
    }
    for (const c of containers.filter((c) => c.project === project && (!service || c.service === service))) {
      console.log(quiet ? c.id : c.name);
    }
    process.exit(0);
  }
  if (command === "rm") {
    const service = rest.filter((arg) => !arg.startsWith("-"))[0];
    save(containers.filter((c) => !(c.project === project && c.service === service)));
    process.exit(0);
  }
  if (command === "down") {
    save(containers.filter((c) => c.project !== project));
    process.exit(0);
  }
  if (command === "logs") process.exit(0);
  process.exit(0);
}

if (args[0] === "ps") {
  const filter = args.find((arg) => arg.startsWith("label=com.docker.compose.project="));
  const containers = load();
  if (filter) {
    const wanted = filter.slice("label=com.docker.compose.project=".length);
    for (const c of containers.filter((c) => c.project === wanted)) console.log(c.dir);
  } else {
    for (const c of containers) console.log(c.name);
  }
  process.exit(0);
}

if (args[0] === "inspect") {
  const format = args[args.indexOf("-f") + 1] || "";
  const target = args[args.length - 1];
  const container = find(load(), target);
  if (!container) fail("Error: No such object: " + target);
  if (format.includes(".Config.Env")) {
    const own = path.join(STUB, "env." + container.name);
    if (fs.existsSync(own)) process.stdout.write(fs.readFileSync(own, "utf8"));
    process.exit(0);
  }
  if (format.includes(".Config.User")) { console.log(""); process.exit(0); }
  if (format.includes(".State.Status") && format.includes("restarting")) { console.log("running restarting=false restarts=0"); process.exit(0); }
  if (format.includes(".State.Status")) { console.log("running"); process.exit(0); }
  if (format.includes(".Name")) { console.log("/" + container.name); process.exit(0); }
  process.exit(0);
}

if (args[0] === "logs") {
  const target = args[args.length - 1];
  const file = path.join(STUB, "logs." + target);
  if (fs.existsSync(file)) process.stdout.write(fs.readFileSync(file, "utf8"));
  process.exit(0);
}

if (args[0] === "exec" || args[0] === "run") {
  const file = path.join(STUB, args[0] + ".out");
  if (fs.existsSync(file)) process.stdout.write(fs.readFileSync(file, "utf8"));
  process.exit(0);
}

process.exit(0);
`;
}

function registryFile(stubDir) {
  return path.join(stubDir, "containers.json");
}

// The machine's containers: [{ name, dir, project, service, id }].
function containersOn(stubDir) {
  try {
    return JSON.parse(fs.readFileSync(registryFile(stubDir), "utf8"));
  } catch {
    return [];
  }
}

// name -> the directory that runs it.
function namesOn(stubDir) {
  return Object.fromEntries(
    containersOn(stubDir).map((container) => {
      return [container.name, container.dir];
    }),
  );
}

// A directory's project, as the stand-in (and Compose) names it.
function projectOf(dir) {
  return path
    .basename(dir)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/^[-_]+/, "");
}

/*
 * What `docker compose up -d` in `dir` left, by hand: its containers, one a
 * service, under the names given (service -> name). The others of its
 * project go.
 */
function runContainersAs(stubDir, dir, names, project = projectOf(dir)) {
  const kept = containersOn(stubDir).filter((container) => {
    return container.project !== project;
  });
  for (const [service, name] of Object.entries(names)) {
    kept.push({
      name,
      dir,
      project,
      service,
      id: crypto
        .createHash("sha256")
        .update(`${name}|${dir}`)
        .digest("hex")
        .slice(0, 12),
      env: [],
    });
  }
  fs.writeFileSync(registryFile(stubDir), JSON.stringify(kept, null, 2));
}

module.exports = {
  containersOn,
  engineScript,
  namesOn,
  projectOf,
  runContainersAs,
};
