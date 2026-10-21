"use strict";

/**
 * Reading the ports a compose file publishes, and the services that are
 * datastores, for ComposeDataStorePorts.test.js and
 * ComposeDatabaseRuntime.test.js.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const LOOPBACK_ADDRESS = "127.0.0.1";

// docker-compose.yml, docker-compose.base.yml, compose.yaml, docker-compose.e2e-clickhouse.yml ...
const COMPOSE_FILE_NAME = /^(?:docker-)?compose(?:[.-][\w.-]+)?\.ya?ml$/;

// A ${...} interpolation, kept whole while a short-syntax port is split on ":".
const INTERPOLATION = /\$\{[^}]*\}/g;
const INTERPOLATION_TOKEN = /^@@(\d+)@@$/;

/*
 * The services OneUptime runs its own data in, by the names the compose files
 * give them, and the images any compose file could run a datastore from.
 */
const DATA_STORE_SERVICE_NAMES = new Set([
  "postgres",
  "clickhouse",
  "valkey",
  "redis",
]);

const DATA_STORE_IMAGE_NAMES = new Set([
  "postgres",
  "postgresql",
  "clickhouse",
  "clickhouse-server",
  "valkey",
  "redis",
  "redis-stack-server",
  "mysql",
  "mariadb",
  "mongo",
  "mongodb",
  "elasticsearch",
  "opensearch",
  "memcached",
]);

/** Every compose file git tracks, as repository-relative paths, sorted. */
function trackedComposeFiles() {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });

  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr}`);
  }

  return result.stdout
    .split("\0")
    .filter((file) => {
      return COMPOSE_FILE_NAME.test(path.posix.basename(file));
    })
    .sort();
}

function readCompose(relativePath) {
  return yaml.load(fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8"));
}

/** "clickhouse/clickhouse-server:26.7" -> "clickhouse-server". */
function imageName(image) {
  if (typeof image !== "string" || image.trim() === "") {
    return "";
  }

  const withoutDigest = image.split("@")[0];
  const lastSegment = withoutDigest.split("/").pop();

  return lastSegment.split(":")[0].toLowerCase();
}

function isDataStoreService(name, service) {
  const extendsService =
    service && service.extends && typeof service.extends === "object"
      ? service.extends.service
      : undefined;

  return (
    DATA_STORE_SERVICE_NAMES.has(name) ||
    DATA_STORE_SERVICE_NAMES.has(extendsService) ||
    DATA_STORE_IMAGE_NAMES.has(imageName(service && service.image))
  );
}

/**
 * One `ports` entry as { hostIp, hostPort, containerPort }. hostIp is "" when
 * the entry names no address, which Docker publishes on every interface.
 *
 * Short syntax: "[HOST_IP:]HOST_PORT:CONTAINER_PORT[/PROTOCOL]",
 * "HOST_IP::CONTAINER_PORT", "CONTAINER_PORT", an IPv6 address in brackets,
 * and ${...} interpolations anywhere. Long syntax: { target, published,
 * host_ip, protocol, mode }.
 */
function parsePublishedPort(entry) {
  if (typeof entry === "number") {
    return { hostIp: "", hostPort: "", containerPort: String(entry) };
  }

  if (entry && typeof entry === "object") {
    return {
      hostIp: entry.host_ip === undefined ? "" : String(entry.host_ip),
      hostPort: entry.published === undefined ? "" : String(entry.published),
      containerPort: entry.target === undefined ? "" : String(entry.target),
    };
  }

  if (typeof entry !== "string") {
    throw new Error(`Unsupported compose port entry: ${JSON.stringify(entry)}`);
  }

  const withoutProtocol = entry.split("/")[0];
  let hostIp = "";
  let rest = withoutProtocol;

  if (rest.startsWith("[")) {
    const end = rest.indexOf("]");

    if (end === -1 || rest[end + 1] !== ":") {
      throw new Error(`Unsupported compose port entry: ${entry}`);
    }

    hostIp = rest.slice(1, end);
    rest = rest.slice(end + 2);
  }

  const interpolations = [];
  const tokenized = rest.replace(INTERPOLATION, (match) => {
    interpolations.push(match);
    return `@@${interpolations.length - 1}@@`;
  });
  const parts = tokenized.split(":").map((part) => {
    const token = INTERPOLATION_TOKEN.exec(part);
    return token ? interpolations[Number(token[1])] : part;
  });

  if (hostIp) {
    if (parts.length !== 2) {
      throw new Error(`Unsupported compose port entry: ${entry}`);
    }

    return { hostIp, hostPort: parts[0], containerPort: parts[1] };
  }

  if (parts.length === 1) {
    return { hostIp: "", hostPort: "", containerPort: parts[0] };
  }

  if (parts.length === 2) {
    return { hostIp: "", hostPort: parts[0], containerPort: parts[1] };
  }

  if (parts.length === 3) {
    return { hostIp: parts[0], hostPort: parts[1], containerPort: parts[2] };
  }

  throw new Error(`Unsupported compose port entry: ${entry}`);
}

/**
 * Every datastore service of every compose file, with what it publishes:
 * [{ file, service, ports: [{ entry, hostIp, ... }], networkMode }].
 */
function dataStoreServices(files) {
  const found = [];

  for (const file of files) {
    const compose = readCompose(file) || {};

    for (const [name, service] of Object.entries(compose.services || {})) {
      if (!isDataStoreService(name, service || {})) {
        continue;
      }

      found.push({
        file,
        service: name,
        networkMode: service && service.network_mode,
        ports: ((service && service.ports) || []).map((entry) => {
          return Object.assign({ entry }, parsePublishedPort(entry));
        }),
      });
    }
  }

  return found;
}

/** The KEY=value settings of config.example.env, last assignment winning. */
function configExampleSettings() {
  const settings = new Map();

  for (const line of fs
    .readFileSync(path.join(REPO_ROOT, "config.example.env"), "utf8")
    .split("\n")) {
    const trimmed = line.trim();

    if (trimmed === "" || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const key = trimmed.slice(0, trimmed.indexOf("=")).trim();
    let value = trimmed.slice(trimmed.indexOf("=") + 1).trim();

    if (
      value.length >= 2 &&
      (value[0] === '"' || value[0] === "'") &&
      value[value.length - 1] === value[0]
    ) {
      value = value.slice(1, -1);
    }

    settings.set(key, value);
  }

  return settings;
}

/** Whether `docker compose` (the CLI and its plugin, no daemon) runs here. */
function hasDockerCompose() {
  const result = spawnSync("docker", ["compose", "version"], {
    encoding: "utf8",
  });

  return result.status === 0;
}

/**
 * `docker compose config --format json` of the given compose files, with
 * config.example.env's settings as the environment, the way `npm start`
 * exports config.env.
 */
function renderCompose(files, extraEnv) {
  const env = Object.assign(
    {},
    process.env,
    Object.fromEntries(configExampleSettings()),
    extraEnv || {},
  );
  const args = ["compose", "--project-directory", REPO_ROOT];

  for (const file of files) {
    args.push("-f", path.join(REPO_ROOT, file));
  }

  args.push("config", "--format", "json");

  const result = spawnSync("docker", args, {
    cwd: REPO_ROOT,
    env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.status !== 0) {
    throw new Error(
      `docker compose config failed (${result.status}): ${result.stderr}`,
    );
  }

  return JSON.parse(result.stdout);
}

module.exports = {
  REPO_ROOT,
  LOOPBACK_ADDRESS,
  COMPOSE_FILE_NAME,
  DATA_STORE_SERVICE_NAMES,
  DATA_STORE_IMAGE_NAMES,
  trackedComposeFiles,
  readCompose,
  imageName,
  isDataStoreService,
  parsePublishedPort,
  dataStoreServices,
  configExampleSettings,
  hasDockerCompose,
  renderCompose,
};
