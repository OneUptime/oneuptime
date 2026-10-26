// Checks this server before `npm start` starts OneUptime, and says what to
// fix in the words of the setting to change. Creates config.env from
// config.example.env the first time.

const dns = require("dns");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { readSettings } = require("./ReplacePlaceholderSecrets");
const { HEADING, ok, warn, stop, listed } = require("./StartOutput");

/*
 * WHY
 *
 * A newcomer's first `npm start` used to fail late and in someone else's
 * words: Compose's "Bind for 0.0.0.0:80 failed: port is already allocated", a
 * "permission denied" from the Docker socket, a probe that started and then
 * could not listen, a page that says "Status Page ID not found" because HOST
 * was not the address they opened, a sign-in that failed because HOST had no
 * port. These checks run first and say, in one line each, what is wrong and
 * which setting fixes it (Scripts/Install/StartOutput.js marks them):
 *
 *   - config.env: created from config.example.env when it is missing, so a
 *     fresh clone starts with `npm start` alone.
 *   - Docker: installed, running and usable by this user, with the Compose v2
 *     plugin (the `docker compose` command).
 *   - Memory and disk: what Docker has, against what OneUptime needs.
 *   - Ports: every port the stack publishes, as Compose renders it (overrides
 *     and --services included), is free or held by this install's own
 *     containers.
 *   - HOST, HTTP_PROTOCOL and PROVISION_SSL: the shapes that break sign-in or
 *     certificates, and HOST's DNS.
 *
 * Only what would certainly stop OneUptime stops `npm start` (marked ✗): no
 * Docker, a Docker this user cannot use, no Compose v2, a port another
 * program holds, a HOST no browser can open. The rest is said and OneUptime
 * starts. A check that cannot tell says nothing. ONEUPTIME_SKIP_PREFLIGHT=true
 * skips every check, and a fault of this script's own never stops a start.
 *
 * It is the first command of the start script in package.json (not a
 * prestart hook: npm skips those when ignore-scripts is set), and
 * `npm run update` ends with `npm run start`. CommonJS with no dependencies
 * and no syntax newer than Node.js 12 (a distribution's packaged Node.js),
 * as the other install scripts.
 */

const SKIP_SETTING = "ONEUPTIME_SKIP_PREFLIGHT";

const CONFIG_FILE = "config.env";
const CONFIG_TEMPLATE = "config.example.env";

// The Docker Compose guide, for what a line cannot say in full.
const DOCS_URL = "https://oneuptime.com/docs/installation/docker-compose";
const DOCKER_INSTALL_URL = "https://docs.docker.com/engine/install/";
const COMPOSE_INSTALL_URL = "https://docs.docker.com/compose/install/linux/";

/*
 * The guide's minimum is 8 GB. An 8 GB server reports a little less to
 * Docker (what its kernel keeps), so the line is drawn under that.
 */
const MINIMUM_MEMORY_GB = 8;
const MINIMUM_MEMORY_BYTES = 7 * 1000 * 1000 * 1000;

/*
 * OneUptime's images take about 15 GB where Docker keeps its data
 * (oneuptime/app, probe, runner and nginx with PostgreSQL, ClickHouse and
 * Valkey: 14.3 GB for 14.0.87), and its databases grow with what it stores.
 */
const IMAGES_SIZE_GB = 15;
const MINIMUM_FREE_DISK_BYTES = 20 * 1000 * 1000 * 1000;

// Docker Engine 20.10 is the oldest the compose files and the guide assume.
const MINIMUM_DOCKER_VERSION = [20, 10];

const DOCKER_TIMEOUT_MS = 30 * 1000;
const PORT_TIMEOUT_MS = 1000;
const DNS_TIMEOUT_MS = 3000;

/*
 * The ports the stack publishes, by the service and the port inside it (the
 * ingress), or by the service alone (a service on the host's network, which
 * listens on the host port its PORT setting names): the setting that moves
 * each, an example value, and what it is for.
 */
const PUBLISHED_PORTS = [
  {
    service: "ingress",
    target: 7849,
    setting: "ONEUPTIME_HTTP_PORT",
    example: "8080",
    purpose: "OneUptime's ingress needs it",
  },
  {
    service: "ingress",
    target: 7850,
    setting: "STATUS_PAGE_HTTPS_PORT",
    example: "8443",
    purpose: "OneUptime's ingress serves HTTPS on it",
  },
  {
    service: "postgres",
    target: 5432,
    setting: null,
    example: null,
    purpose: "OneUptime publishes PostgreSQL there for npm run backup",
  },
  {
    service: "probe-1",
    setting: "GLOBAL_PROBE_1_PORT",
    example: "3884",
    purpose: "the bundled probe listens on it",
  },
  {
    service: "probe-2",
    setting: "GLOBAL_PROBE_2_PORT",
    example: "3885",
    purpose: "the second bundled probe listens on it",
  },
];

// Addresses that mean "every address of this server" or "this computer".
const EVERY_ADDRESS = ["", "0.0.0.0", "::", "[::]"];
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"];

const IPV4_ADDRESS = /^\d{1,3}(\.\d{1,3}){3}$/;
const PORT_NUMBER = /^\d{1,5}$/;
// A version's leading numbers: "29.8.1", "v2.29.7-desktop.1" -> [29, 8, 1].
const VERSION_NUMBERS = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/;

const isTruthy = (value) => {
  return (
    ["1", "true", "yes", "on"].indexOf(
      String(value || "")
        .trim()
        .toLowerCase(),
    ) !== -1
  );
};

const GIGABYTE = 1000 * 1000 * 1000;

// Bytes as people read a server's size: "16 GB", "7.8 GB", "120 GB".
const gigabytes = (bytes) => {
  const value = bytes / GIGABYTE;

  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} GB`;
};

const versionNumbers = (text) => {
  const match = VERSION_NUMBERS.exec(String(text || "").trim());

  if (!match) {
    return null;
  }

  return [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)];
};

// Whether version `a` ([major, minor]) is older than `b`.
const isOlderThan = (a, b) => {
  if (a[0] !== b[0]) {
    return a[0] < b[0];
  }

  return a[1] < b[1];
};

/*
 * ONEUPTIME_HTTP_PORT and its kind as Compose publishes them: a port alone
 * ("8080"), or an address and a port ("127.0.0.1:8080", "[::1]:8080").
 * { address, port }, address "" for a port alone; null when it is neither.
 */
const parsePortSetting = (value) => {
  const text = String(value || "").trim();

  if (PORT_NUMBER.test(text)) {
    return { address: "", port: Number(text) };
  }

  const colon = text.lastIndexOf(":");

  if (colon === -1 || !PORT_NUMBER.test(text.slice(colon + 1))) {
    return null;
  }

  return { address: text.slice(0, colon), port: Number(text.slice(colon + 1)) };
};

/*
 * HOST without a port, and its port: "oneuptime.example.com:8080" ->
 * { hostname: "oneuptime.example.com", port: 8080 }; "[::1]:8080" keeps the
 * brackets in its hostname.
 */
const splitHost = (host) => {
  const text = String(host || "").trim();
  const bracketed = text.startsWith("[");
  const colon = text.lastIndexOf(":");

  if (
    colon > 0 &&
    (!bracketed || text.charAt(colon - 1) === "]") &&
    PORT_NUMBER.test(text.slice(colon + 1)) &&
    (bracketed || text.indexOf(":") === colon)
  ) {
    return {
      hostname: text.slice(0, colon),
      port: Number(text.slice(colon + 1)),
    };
  }

  return { hostname: text, port: null };
};

const isLoopbackHost = (hostname) => {
  return LOOPBACK_HOSTS.indexOf(String(hostname).toLowerCase()) !== -1;
};

const isIpAddress = (hostname) => {
  return IPV4_ADDRESS.test(hostname) || String(hostname).indexOf(":") !== -1;
};

/*
 * This server's first address on a network other than its own loopback, to
 * show as an example HOST, or null.
 */
const exampleAddress = (interfaces) => {
  const names = Object.keys(interfaces || {});

  for (const name of names) {
    for (const entry of interfaces[name] || []) {
      const family = String(entry.family);

      if (!entry.internal && (family === "IPv4" || family === "4")) {
        return entry.address;
      }
    }
  }

  return null;
};

/*
 * HOST written as people would type it: what is left of "http://x.com/" once
 * the scheme, the path and any whitespace are gone.
 */
const cleanedHost = (host) => {
  let text = String(host || "").trim();
  const scheme = text.indexOf("://");

  if (scheme !== -1) {
    text = text.slice(scheme + 3);
  }

  const slash = text.search(/[/?#]/);

  if (slash !== -1) {
    text = text.slice(0, slash);
  }

  return text.replace(/\s+/g, "");
};

/*
 * Pure: config.env's settings in, what to say about HOST, HTTP_PROTOCOL and
 * PROVISION_SSL out, as [{ level, message }]. `interfaces` are this
 * server's network interfaces, for an example address.
 */
const hostFindings = (settings, interfaces) => {
  const findings = [];
  const host = String(settings.get("HOST") || "").trim();
  const protocol = String(settings.get("HTTP_PROTOCOL") || "").trim();
  const provisionSsl =
    String(settings.get("PROVISION_SSL") || "").trim() === "true";
  const example = exampleAddress(interfaces);
  const exampleHost = example || "oneuptime.example.com";

  if (!host) {
    findings.push({
      level: "stop",
      message: `HOST in config.env is empty. Set it to the domain name or IP address people will use to reach OneUptime, without http://, such as HOST=${exampleHost}.`,
    });
    return findings;
  }

  const cleaned = cleanedHost(host);

  if (cleaned !== host) {
    findings.push({
      level: "stop",
      message: `HOST in config.env is ${host}. Write the address alone, without http:// or a path: HOST=${cleaned || exampleHost}. HTTP_PROTOCOL says whether people use http or https.`,
    });
    return findings;
  }

  const { hostname, port } = splitHost(host);

  if (EVERY_ADDRESS.indexOf(hostname) !== -1) {
    findings.push({
      level: "stop",
      message: `HOST in config.env is ${host}, an address servers listen on rather than one people open. Set it to this server's domain name or IP address, such as HOST=${exampleHost}${port ? `:${port}` : ""}.`,
    });
    return findings;
  }

  if (protocol !== "http" && protocol !== "https") {
    findings.push({
      level: "warn",
      message: `HTTP_PROTOCOL in config.env is ${protocol || "empty"}, which OneUptime reads as http. It takes http or https, in lowercase: set HTTP_PROTOCOL=https once people reach OneUptime over HTTPS, and HTTP_PROTOCOL=http until then.`,
    });
  }

  if (isLoopbackHost(hostname)) {
    findings.push({
      level: "warn",
      message: `HOST is ${host}, so only this computer can open OneUptime. To open it from other computers, set HOST in config.env to this server's domain name or IP address${example ? `, such as HOST=${example}` : ""}, then run npm start again.`,
    });
  }

  if (provisionSsl && (isLoopbackHost(hostname) || isIpAddress(hostname))) {
    findings.push({
      level: "warn",
      message: `PROVISION_SSL=true, but HOST is ${host}: Let's Encrypt issues certificates for domain names only. Set HOST to a domain name that points at this server, or PROVISION_SSL=false.`,
    });
  }

  if (provisionSsl && protocol === "http") {
    findings.push({
      level: "warn",
      message:
        "PROVISION_SSL=true, but HTTP_PROTOCOL=http: set HTTP_PROTOCOL=https too, so OneUptime's links, sign-in and status pages use the certificate.",
    });
  }

  /*
   * The ingress on another port than 80, published on every address (no
   * proxy of the operator's own in front: TRUSTED_PROXY_HOPS below 2), while
   * HOST has no port: people open http://<host>:<port>, but every address
   * OneUptime's pages call is built from HOST, on port 80.
   */
  const ingress = parsePortSetting(settings.get("ONEUPTIME_HTTP_PORT"));
  const hops = Number(String(settings.get("TRUSTED_PROXY_HOPS") || "1").trim());

  if (
    ingress &&
    ingress.port !== 80 &&
    EVERY_ADDRESS.indexOf(ingress.address) !== -1 &&
    !(hops >= 2) &&
    port === null
  ) {
    findings.push({
      level: "warn",
      message: `OneUptime's ingress is on port ${ingress.port} (ONEUPTIME_HTTP_PORT=${settings.get("ONEUPTIME_HTTP_PORT")}), but HOST has no port, so its pages call port 80 and signing in fails. If people open it at http://${hostname}:${ingress.port}, set HOST=${hostname}:${ingress.port}. If a proxy of yours on port 80 or 443 is in front of it, see ${DOCS_URL}#use-your-own-reverse-proxy.`,
    });
  }

  return findings;
};

/*
 * What a failed docker call means: "not-installed", "permission",
 * "not-running" or "other", from spawnSync's result.
 */
const dockerFailureOf = (result) => {
  const error = result && result.error;

  if (error && error.code === "ENOENT") {
    return "not-installed";
  }

  if (error && error.code === "ETIMEDOUT") {
    return "not-running";
  }

  const text =
    `${(result && result.stderr) || ""}\n${(result && result.stdout) || ""}`.toLowerCase();

  if (text.indexOf("permission denied") !== -1) {
    return "permission";
  }

  if (
    text.indexOf("cannot connect to the docker daemon") !== -1 ||
    text.indexOf("is the docker daemon running") !== -1 ||
    text.indexOf("error during connect") !== -1
  ) {
    return "not-running";
  }

  return "other";
};

// The first line a failed command printed, for a failure that has no reason of ours.
const firstLineOf = (result) => {
  const text = `${(result && result.stderr) || ""}\n${(result && result.stdout) || ""}`;
  const lines = text
    .split("\n")
    .map((entry) => {
      return entry.trim();
    })
    .filter(Boolean);

  if (lines.length > 0) {
    return lines[0];
  }

  return result && result.error ? String(result.error.message) : "no answer";
};

const DOCKER_MESSAGES = {
  "not-installed": `Docker is not installed. Install Docker Engine with its Compose plugin (${DOCKER_INSTALL_URL}), then run npm start again.`,
  permission:
    "Docker is installed, but your user cannot use it. Add your user to the docker group with sudo usermod -aG docker $USER, sign out and back in, then run npm start again.",
  "not-running":
    "Docker is installed but not running. Start it, with sudo systemctl start docker or by opening Docker Desktop, then run npm start again.",
};

/*
 * Docker, its Compose plugin, and what Docker has: { findings, docker },
 * where docker is { version, memoryBytes, rootDirectory } once Docker
 * answers, and null when it does not.
 */
const dockerFindings = (runCommand) => {
  const findings = [];
  const info = runCommand("docker", [
    "info",
    "--format",
    "{{.ServerVersion}}|{{.MemTotal}}|{{.DockerRootDir}}",
  ]);

  if (!info || info.error || info.status !== 0) {
    const failure = dockerFailureOf(info);

    findings.push({
      level: "stop",
      message:
        DOCKER_MESSAGES[failure] ||
        `Docker did not answer (${firstLineOf(info)}). Check that it runs with docker info, then run npm start again.`,
    });

    return { findings, docker: null };
  }

  const fields = String(info.stdout || "")
    .trim()
    .split("|");
  const docker = {
    version: fields[0] || "",
    memoryBytes: Number(fields[1]) || 0,
    rootDirectory: fields[2] || "",
  };

  const compose = runCommand("docker", ["compose", "version", "--short"]);
  const composeVersion =
    compose && !compose.error && compose.status === 0
      ? String(compose.stdout || "").trim()
      : "";
  const composeNumbers = versionNumbers(composeVersion);

  if (!composeNumbers || composeNumbers[0] < 2) {
    findings.push({
      level: "stop",
      message: `Docker Compose v2 is missing: Docker cannot run the docker compose command. Install the Docker Compose plugin (${COMPOSE_INSTALL_URL}), then run npm start again. The older docker-compose command is not enough.`,
    });
    return { findings, docker };
  }

  const dockerNumbers = versionNumbers(docker.version);

  if (dockerNumbers && isOlderThan(dockerNumbers, MINIMUM_DOCKER_VERSION)) {
    findings.push({
      level: "warn",
      message: `Docker ${docker.version} is older than OneUptime is tested with (${MINIMUM_DOCKER_VERSION.join(".")} and later). Update Docker if anything fails to start.`,
    });
  } else {
    findings.push({
      level: "ok",
      message: `Docker ${docker.version} with Docker Compose ${composeVersion.replace(/^v/, "")}.`,
    });
  }

  return { findings, docker };
};

/*
 * The space free on the file system at `directory`, in bytes, from
 * `df -Pk` (POSIX output, 1024-byte blocks), or null when it cannot tell:
 * Docker Desktop keeps its data inside a virtual machine, at a path this
 * computer does not have.
 */
const freeDiskBytes = (runCommand, directory) => {
  if (!directory) {
    return null;
  }

  const result = runCommand("df", ["-Pk", directory]);

  if (!result || result.error || result.status !== 0) {
    return null;
  }

  const lines = String(result.stdout || "")
    .trim()
    .split("\n");
  const fields = (lines[lines.length - 1] || "").trim().split(/\s+/);
  const available = Number(fields[3]);

  return Number.isFinite(available) && fields.length >= 4
    ? available * 1024
    : null;
};

// Pure: what to say about Docker's memory and free disk space.
const resourceFindings = (memoryBytes, freeBytes, rootDirectory) => {
  const findings = [];

  if (memoryBytes > 0) {
    if (memoryBytes < MINIMUM_MEMORY_BYTES) {
      findings.push({
        level: "warn",
        message: `Docker has ${gigabytes(memoryBytes)} of memory. OneUptime needs at least ${MINIMUM_MEMORY_GB} GB, and without it may run slowly or stop.`,
      });
    } else {
      findings.push({
        level: "ok",
        message: `${gigabytes(memoryBytes)} of memory.`,
      });
    }
  }

  if (freeBytes !== null && freeBytes !== undefined) {
    if (freeBytes < MINIMUM_FREE_DISK_BYTES) {
      findings.push({
        level: "warn",
        message: `Only ${gigabytes(freeBytes)} free at ${rootDirectory}, where Docker keeps its images and data. OneUptime's images take about ${IMAGES_SIZE_GB} GB and its databases grow with your data: free up space, or OneUptime may stop when the disk fills.`,
      });
    } else {
      findings.push({
        level: "ok",
        message: `${gigabytes(freeBytes)} free for Docker's images and data.`,
      });
    }
  }

  return findings;
};

/*
 * The services `npm start` starts: those `--services` names (npm sets
 * npm_config_services for it) and every service they depend on, or all of
 * them.
 */
const servicesToStart = (config, requested) => {
  const services = (config && config.services) || {};
  const all = Object.keys(services);
  const names = String(requested || "")
    .split(/[\s,]+/)
    .filter(Boolean);

  if (names.length === 0) {
    return all;
  }

  const wanted = [];
  const visit = (name) => {
    if (wanted.indexOf(name) !== -1 || !services[name]) {
      return;
    }

    wanted.push(name);

    const dependsOn = services[name].depends_on || {};
    const dependencies = Array.isArray(dependsOn)
      ? dependsOn
      : Object.keys(dependsOn);

    for (const dependency of dependencies) {
      visit(dependency);
    }
  };

  for (const name of names) {
    visit(name);
  }

  return wanted;
};

/*
 * Pure: the ports the rendered compose config (`docker compose config
 * --format json`) publishes on this server for `services`, each
 * { service, address, port, entry } with the PUBLISHED_PORTS entry it is.
 */
const publishedPortsOf = (config, services) => {
  const found = [];
  const rendered = (config && config.services) || {};

  for (const name of services) {
    const service = rendered[name];

    if (!service) {
      continue;
    }

    if (service.network_mode === "host") {
      const entry = PUBLISHED_PORTS.find((candidate) => {
        return candidate.service === name && candidate.target === undefined;
      });
      const port = Number(service.environment && service.environment.PORT);

      if (entry && port) {
        found.push({ service: name, address: "", port: port, entry: entry });
      }

      continue;
    }

    for (const published of service.ports || []) {
      const port = Number(published.published);

      if (!port) {
        continue;
      }

      const entry = PUBLISHED_PORTS.find((candidate) => {
        return (
          candidate.service === name &&
          (candidate.target === undefined ||
            candidate.target === Number(published.target))
        );
      }) || {
        service: name,
        setting: null,
        example: null,
        purpose: `the ${name} service publishes it`,
      };

      found.push({
        service: name,
        address: published.host_ip || "",
        port: port,
        entry: entry,
      });
    }
  }

  return found;
};

/*
 * The services of this install that run now, and the ports they publish,
 * from `docker compose ps --format json`: one JSON object a line (Compose
 * 2.21 and later) or one JSON array (earlier).
 */
const runningServicesOf = (output) => {
  const text = String(output || "").trim();
  let containers = [];

  if (!text) {
    return { services: [], ports: [] };
  }

  try {
    const parsed = JSON.parse(text);
    containers = Array.isArray(parsed) ? parsed : [parsed];
  } catch (_error) {
    containers = text
      .split("\n")
      .map((entry) => {
        try {
          return JSON.parse(entry);
        } catch (_lineError) {
          return null;
        }
      })
      .filter(Boolean);
  }

  const services = [];
  const ports = [];

  for (const container of containers) {
    if (String(container.State || "").toLowerCase() !== "running") {
      continue;
    }

    if (container.Service) {
      services.push(container.Service);
    }

    for (const publisher of container.Publishers || []) {
      if (publisher.PublishedPort) {
        ports.push(Number(publisher.PublishedPort));
      }
    }
  }

  return { services, ports };
};

// Whether something accepts connections at host:port: true, false, or null when it cannot tell.
const defaultIsPortInUse = (host, port) => {
  return new Promise((resolve) => {
    let settled = false;
    const socket = net.connect({ host: host, port: port });
    const finish = (answer) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolve(answer);
    };

    socket.setTimeout(PORT_TIMEOUT_MS);
    socket.once("connect", () => {
      finish(true);
    });
    socket.once("timeout", () => {
      finish(null);
    });
    socket.once("error", (error) => {
      finish(error && error.code === "ECONNREFUSED" ? false : null);
    });
  });
};

// The addresses to try for a port published on `address`.
const addressesToTry = (address) => {
  const text = String(address || "").trim();

  if (EVERY_ADDRESS.indexOf(text) !== -1) {
    return ["127.0.0.1", "::1"];
  }

  return [text.replace(/^\[(.*)\]$/, "$1")];
};

// The message for a port another program holds.
const portInUseMessage = (published, holders) => {
  const where =
    published.address && EVERY_ADDRESS.indexOf(published.address) === -1
      ? `Port ${published.port} of ${published.address}`
      : `Port ${published.port}`;
  const holder =
    holders.length === 0
      ? "another program"
      : `${holders.length === 1 ? "the container" : "the containers"} ${listed(holders)}`;
  const that =
    holders.length === 0
      ? "that program"
      : holders.length === 1
        ? "that container"
        : "those containers";
  const entry = published.entry;
  const fix = entry.setting
    ? `Stop ${that}, or set ${entry.setting} in config.env to a free port, such as ${entry.setting}=${entry.example}.`
    : `Stop ${that}, then run npm start again.`;

  return `${where} is already in use by ${holder}, and ${entry.purpose}. ${fix}`;
};

/*
 * Every port the stack publishes is free, or held by this install's own
 * running containers. Needs Docker: Compose renders the files with
 * config.env's settings, overrides and --services as `npm start` will.
 */
const portFindings = async (options) => {
  const runCommand = options.runCommand;
  const isPortInUse = options.isPortInUse || defaultIsPortInUse;
  const env = options.env;
  const findings = [];

  const rendered = runCommand(
    "docker",
    ["compose", "config", "--format", "json"],
    {
      env: env,
    },
  );

  if (!rendered || rendered.error || rendered.status !== 0) {
    // Compose itself says what is wrong with the files when it starts them.
    return findings;
  }

  let config;

  try {
    config = JSON.parse(String(rendered.stdout || ""));
  } catch (_error) {
    return findings;
  }

  const services = servicesToStart(config, env.npm_config_services);
  const published = publishedPortsOf(config, services);

  if (published.length === 0) {
    return findings;
  }

  const running = runCommand("docker", ["compose", "ps", "--format", "json"], {
    env: env,
  });
  const ours =
    running && !running.error && running.status === 0
      ? runningServicesOf(running.stdout)
      : { services: [], ports: [] };

  const checks = published.map((port) => {
    const isOurs =
      ours.services.indexOf(port.service) !== -1 &&
      (ours.ports.indexOf(port.port) !== -1 ||
        (config.services[port.service] || {}).network_mode === "host");

    if (isOurs) {
      return Promise.resolve({ port: port, inUse: false, isOurs: true });
    }

    return Promise.all(
      addressesToTry(port.address).map((address) => {
        return isPortInUse(address, port.port);
      }),
    ).then((answers) => {
      return {
        port: port,
        inUse: answers.indexOf(true) !== -1,
        isOurs: false,
      };
    });
  });

  const results = await Promise.all(checks);
  const busy = results.filter((result) => {
    return result.inUse;
  });

  for (const result of busy) {
    const holders = runCommand("docker", [
      "ps",
      "--filter",
      `publish=${result.port.port}`,
      "--format",
      "{{.Names}}",
    ]);
    const names =
      holders && !holders.error && holders.status === 0
        ? String(holders.stdout || "")
            .trim()
            .split("\n")
            .filter(Boolean)
        : [];

    findings.push({
      level: "stop",
      message: portInUseMessage(result.port, names),
    });
  }

  if (busy.length === 0) {
    const numbers = [];

    for (const result of results) {
      if (numbers.indexOf(result.port.port) === -1) {
        numbers.push(result.port.port);
      }
    }

    numbers.sort((a, b) => {
      return a - b;
    });

    const anyOurs = results.some((result) => {
      return result.isOurs;
    });

    findings.push({
      level: "ok",
      message: `${numbers.length === 1 ? "Port" : "Ports"} ${listed(numbers)} ${numbers.length === 1 ? "is" : "are"} free${anyOurs ? " or used by this OneUptime" : ""}.`,
    });
  }

  return findings;
};

// Whether HOST's name resolves: null when it does or when this cannot tell.
const defaultLookup = (hostname) => {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(null);
    }, DNS_TIMEOUT_MS);

    dns.lookup(hostname, (error) => {
      clearTimeout(timer);
      resolve(error && error.code === "ENOTFOUND" ? "not-found" : null);
    });
  });
};

// A HOST that is a domain name which does not resolve.
const dnsFindings = async (settings, lookup) => {
  const host = String(settings.get("HOST") || "").trim();

  if (!host || cleanedHost(host) !== host) {
    return [];
  }

  const hostname = splitHost(host).hostname;

  if (
    isLoopbackHost(hostname) ||
    isIpAddress(hostname) ||
    EVERY_ADDRESS.indexOf(hostname) !== -1 ||
    hostname.indexOf(".") === -1
  ) {
    return [];
  }

  const answer = await (lookup || defaultLookup)(hostname);

  if (answer !== "not-found") {
    return [];
  }

  const provisionSsl =
    String(settings.get("PROVISION_SSL") || "").trim() === "true";

  return [
    {
      level: "warn",
      message: `HOST is ${host}, and ${hostname} does not resolve yet. People cannot open OneUptime by that name until a DNS record points it at this server${provisionSsl ? ", and Let's Encrypt cannot issue its certificate" : ""}.`,
    },
  ];
};

const defaultRunCommand = (command, args, options) => {
  return spawnSync(command, args, {
    cwd: (options && options.cwd) || process.cwd(),
    env: (options && options.env) || process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: DOCKER_TIMEOUT_MS,
  });
};

/*
 * config.env, created from config.example.env when it is missing or holds
 * no setting at all (an empty file `touch` made): { finding, settings }.
 */
const prepareConfig = (cwd) => {
  const configPath = path.join(cwd, CONFIG_FILE);
  const templatePath = path.join(cwd, CONFIG_TEMPLATE);
  const exists = fs.existsSync(configPath);
  const settings = exists
    ? readSettings(fs.readFileSync(configPath, "utf8"))
    : new Map();

  if (exists && settings.size > 0) {
    return { finding: null, settings: settings };
  }

  if (!fs.existsSync(templatePath)) {
    return {
      finding: {
        level: "stop",
        message: `${CONFIG_FILE} and ${CONFIG_TEMPLATE} are both missing. Run npm start in the oneuptime folder that git clone made.`,
      },
      settings: settings,
    };
  }

  fs.copyFileSync(templatePath, configPath);

  return {
    finding: {
      level: "ok",
      message: exists
        ? `${CONFIG_FILE} held no settings, so it now holds ${CONFIG_TEMPLATE}'s. Your settings live there.`
        : `Created ${CONFIG_FILE} from ${CONFIG_TEMPLATE}. Your settings live there.`,
    },
    settings: readSettings(fs.readFileSync(configPath, "utf8")),
  };
};

const lineOf = (finding) => {
  if (finding.level === "ok") {
    return ok(finding.message);
  }

  if (finding.level === "stop") {
    return stop(finding.message);
  }

  return warn(finding.message);
};

/*
 * Runs every check and prints what it found, a line at a time. Returns the
 * exit code: 1 when something stops OneUptime from starting, 0 otherwise.
 * Every effect is passed in, so the tests run it without Docker, a network
 * or a terminal: cwd, env, log, runCommand (spawnSync's signature),
 * isPortInUse, lookupHost, interfaces.
 */
const run = async (options) => {
  const given = options || {};
  const cwd = given.cwd || process.cwd();
  const env = given.env || process.env;
  const log = given.log || console.log;
  const interfaces =
    given.interfaces === undefined ? os.networkInterfaces() : given.interfaces;
  const runInCwd = (command, args, commandOptions) => {
    return (given.runCommand || defaultRunCommand)(
      command,
      args,
      Object.assign({ cwd: cwd }, commandOptions || {}),
    );
  };

  if (isTruthy(env[SKIP_SETTING])) {
    log(
      `Not checking this server before OneUptime starts: ${SKIP_SETTING} is set.`,
    );
    return 0;
  }

  const findings = [];
  const report = (list) => {
    for (const finding of list) {
      findings.push(finding);
      log(lineOf(finding));
    }
  };

  log(HEADING);

  const config = prepareConfig(cwd);

  if (config.finding) {
    report([config.finding]);
  }

  const settings = config.settings;
  // Compose gets config.env's settings over the shell's, as npm start exports them.
  const composeEnv = Object.assign({}, env, Object.fromEntries(settings));

  const docker = dockerFindings(runInCwd);
  report(docker.findings);

  const dockerWorks =
    docker.docker !== null &&
    !docker.findings.some((finding) => {
      return finding.level === "stop";
    });

  if (docker.docker) {
    report(
      resourceFindings(
        docker.docker.memoryBytes,
        freeDiskBytes(runInCwd, docker.docker.rootDirectory),
        docker.docker.rootDirectory,
      ),
    );
  }

  if (dockerWorks && settings.size > 0) {
    report(
      await portFindings({
        runCommand: runInCwd,
        isPortInUse: given.isPortInUse,
        env: composeEnv,
      }),
    );
  }

  if (settings.size > 0) {
    report(hostFindings(settings, interfaces));
    report(await dnsFindings(settings, given.lookupHost));
  }

  const stops = findings.filter((finding) => {
    return finding.level === "stop";
  });

  if (stops.length > 0) {
    log(
      [
        "",
        `OneUptime did not start. Fix what is marked ✗, then run npm start again. The Docker Compose guide has more: ${DOCS_URL}`,
        `To start without these checks, run ${SKIP_SETTING}=true npm start.`,
      ].join("\n"),
    );
  }

  return stops.length > 0 ? 1 : 0;
};

/*
 * Run as a script (`node ./Scripts/Install/Preflight.js` from the repository
 * root) by `npm start`. Requiring it, as the tests do, only exports the
 * functions. A fault of its own is said and never stops the start.
 */
if (require.main === module) {
  run()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.log(
        warn(
          `Could not check this server (${error && error.message ? error.message : error}). Starting OneUptime anyway.`,
        ),
      );
      process.exitCode = 0;
    });
}

module.exports = {
  SKIP_SETTING,
  CONFIG_FILE,
  CONFIG_TEMPLATE,
  DOCS_URL,
  MINIMUM_MEMORY_BYTES,
  MINIMUM_FREE_DISK_BYTES,
  MINIMUM_DOCKER_VERSION,
  PUBLISHED_PORTS,
  DOCKER_MESSAGES,
  isTruthy,
  gigabytes,
  versionNumbers,
  parsePortSetting,
  splitHost,
  cleanedHost,
  exampleAddress,
  hostFindings,
  dockerFailureOf,
  dockerFindings,
  freeDiskBytes,
  resourceFindings,
  servicesToStart,
  publishedPortsOf,
  runningServicesOf,
  addressesToTry,
  portInUseMessage,
  portFindings,
  dnsFindings,
  prepareConfig,
  defaultIsPortInUse,
  run,
};
