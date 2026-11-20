// Says what is wrong with this OneUptime, and the fix for each: `npm run doctor`.

const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");
const tls = require("tls");
const { spawnSync } = require("child_process");
const {
  GENERATED_SECRETS,
  datastorePasswordDecisions,
  isPlaceholderValue,
  readSettings,
} = require("./ReplacePlaceholderSecrets");
const { ingressRequestOf } = require("./FollowIngressPort");
const {
  CONFIG_FILE,
  dockerFindings,
  freeDiskBytes,
  hostFindings,
  isIpAddress,
  pickedPortFindings,
  provisionsSsl,
  resourceFindings,
  splitHost,
} = require("./Preflight");
const { MARKS, listed } = require("./StartOutput");

/*
 * WHY
 *
 * When a self-hosted OneUptime does not behave, the person running it had to
 * work out which of its services is unhappy and why (#405: "so many
 * containers that I honestly don't know where to get the logs from"). This
 * command says it in one short list, worst first, each line with what is
 * wrong, why it matters and the exact fix, and ends with one line:
 * "Everything looks right." or "3 things to fix." (#6826).
 *
 * WHAT IT CHECKS
 *
 * What only this host can see:
 *
 *   - config.env: HOST, HTTP_PROTOCOL and PROVISION_SSL in shapes that
 *     break sign-in or certificates, and an ingress port left to Docker to
 *     pick (Preflight's own checks), a secret still at the placeholder
 *     config.example.env ships, and HTTP/2 turned off for HOST
 *     (NGINX_HTTP2=off), which is meant to last only until an upgrade.
 *   - Docker, and every service of this install: running and healthy, or
 *     which one is not, with the last lines of its log.
 *   - OneUptime answers at the ingress on this server.
 *   - HOST reaches this OneUptime from outside the containers: it asks HOST
 *     for a proof the server signed, so another server at that address is
 *     told apart.
 *   - A proxy in front passes on the host name and the scheme the browser
 *     used: the server says how that request reached it.
 *   - The certificate, when PROVISION_SSL is on: issued, for which name,
 *     expiring when; when not, the reason from the app's log.
 *   - Free disk where Docker keeps its images and volumes.
 *
 * What the server sees of itself, asked of the ingress with the cluster key
 * from config.env (ONEUPTIME_SECRET), never of HOST, so the key does not
 * leave this server: PostgreSQL, ClickHouse and Valkey answer, migrations,
 * ClickHouse's disks, the queues, the version and the server setup
 * checklist - email, HTTPS, sign-ups, SMS and calls, probes, backups and
 * update checks (Common/Types/InstallationHealth). It asks with a POST to
 * /api/admin/health/doctor, the key in the clusterkey header, URI-encoded,
 * as every request that presents the cluster key does; the POST changes
 * nothing.
 * The Admin Dashboard's OneUptime Health page shows the same answer in
 * every edition, and on Kubernetes HelmChart/Public/diagnose.sh prints it.
 *
 * The server's answer also says which products it switches off for every
 * project, and what SERVER_PRODUCTS held that it did not know (#7481).
 *
 * HOW IT ANSWERS
 *
 *   ✗  something required fails: OneUptime, or part of it, does not work
 *   !  worth a look; OneUptime works without it
 *   •  worth knowing, and no fault: products an admin switched off, or
 *      HTTP/2 turned off until an upgrade (a reminder)
 *
 * Exit codes, so scripts can use it: 0 when nothing is marked ✗, 1 when
 * something is, 2 when the doctor itself failed.
 *
 *   npm run doctor               the list
 *   npm run doctor -- --logs     and recent errors from every service
 *   npm run doctor -- --all      and what passed, marked ✓
 *
 * `npm start` ends with `--after-start`: the configuration checks and the
 * server's answer (its preflight checked Docker and the disk, and the
 * status check has just seen every service answer), said only when
 * something needs attention, and never a failed start. Of the notes it
 * says only the reminders: a setting that restarts and upgrades keep until
 * someone sets it back, said at the start that follows each upgrade.
 *
 * CommonJS with no dependencies and no syntax newer than Node.js 12, as the
 * other install scripts. Every effect is passed in to run(), so the tests
 * run it without Docker, a network or a terminal.
 */

const DOCS_URL = "https://oneuptime.com/docs/installation/docker-compose";
const GUIDES_ORIGIN = "https://oneuptime.com";

const DOCTOR_PATH = "/api/admin/health/doctor";
const READY_PATH = "/status/ready";

const REQUEST_TIMEOUT_MS = 10 * 1000;
const TLS_TIMEOUT_MS = 5 * 1000;
const COMMAND_TIMEOUT_MS = 30 * 1000;

// How many lines of a service's log a finding shows.
const LOG_LINES = 12;
// How far back --logs reads each service's log, and how many errors it shows.
const ERROR_SCAN_LINES = 500;
const ERRORS_PER_SERVICE = 5;

// A certificate that expires sooner than this is worth a look.
const CERTIFICATE_WARN_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

// Below this, the disk Docker keeps everything on is something to fix.
const MINIMUM_FREE_DISK_TO_RUN_BYTES = 2 * 1000 * 1000 * 1000;

// A line of a log that reports an error, for --logs.
const ERROR_LINE = /\b(error|fatal|exception|panic|failed|unhandled)\b/i;

/*
 * Every entry of the Docker Compose guide's troubleshooting list, and what
 * the doctor says about it: detected, partly, or not, and why. A test reads
 * the guide's list against this, so a new entry needs an answer here.
 */
const TROUBLESHOOTING_COVERAGE = {
  "npm start stops before it starts OneUptime":
    "Not after the fact: npm start's own checks (Preflight.js) stop it and say why before anything runs. The doctor repeats their config.env and Docker checks.",
  'Docker says "permission denied" when you run npm start':
    "Detected: Docker is installed, but your user cannot use it.",
  "The ingress cannot start because port 80 or 443 is in use":
    "Detected: the ingress service has no container or stopped, with the last lines of its log, which name the port.",
  'npm start ends with "Maximum retries reached"':
    "Detected: every service that is not running or healthy, with its log, and whether OneUptime answers at the ingress.",
  'The browser says "OneUptime is not set up for this address"':
    "Partly: HOST left at localhost or at a listening address, whether HOST reaches this OneUptime, and whether a proxy in front passes on the host name, from the doctor's own request through it. Not the address someone typed, which only their browser knows.",
  "Some pages load, but live updates or uploads fail":
    "Partly, as above: which address people open is known only to their browsers.",
  'Signing up or signing in fails with "Page not found"':
    "Detected: HOST without the ingress's port, whether HOST reaches this OneUptime, and whether a proxy in front passes on the host name the browser asked for, from the doctor's own request to HOST through it.",
  "The browser warns about the certificate after you set PROVISION_SSL":
    "Detected: the certificate HOST presents, and the app's CoreSSL lines when it is not issued.",
  "The bundled probe shows Disconnected after you moved the ingress port":
    "Detected: probe-1 not running, and the server's probe check (no global probe reporting).",
};

/*
 * A finding: { level: "fix" | "warn" | "note" | "ok", message, fix,
 * details }. `fix` is the exact fix, on the line under it; `details` are
 * lines shown under that (a service's log). A note is a fact worth knowing
 * that is no fault - a product an admin switched off: always shown, after
 * what needs attention, and never counted.
 */
const finding = (level, message, fix, details) => {
  return {
    level: level,
    message: message,
    fix: fix || null,
    details: details || [],
  };
};

/*
 * A note that `npm start` says too (isReminder): a setting meant to be set
 * back, which restarts and upgrades keep until someone does. npm start
 * says no other note, so it is said at the start after each upgrade, when
 * it is likeliest to be time to set it back.
 */
const reminder = (message) => {
  return Object.assign(finding("note", message), { isReminder: true });
};

/*
 * NGINX_HTTP2 as the ingress reads it (Nginx/envsubst-on-templates.sh):
 * without its whitespace, wherever it is, and in lower case. "off" for off,
 * false, no and 0; "on" for on, true, yes, 1 and nothing (Compose hands the
 * ingress "on" for an empty one: ${NGINX_HTTP2:-on}); "unknown" for
 * anything else, which the ingress reads as on, with a warning in its log.
 * The ingress's tr removes the ASCII spaces of [:space:], and so does this.
 */
const http2SettingOf = (value) => {
  const text = String(value === undefined || value === null ? "" : value)
    .replace(/[ \t\n\v\f\r]/g, "")
    .toLowerCase();

  if (["", "on", "true", "yes", "1"].indexOf(text) !== -1) {
    return "on";
  }

  if (["off", "false", "no", "0"].indexOf(text) !== -1) {
    return "off";
  }

  return "unknown";
};

/*
 * Pure: HTTP/2 for HOST, from config.env (#9973). NGINX_HTTP2=off turns it
 * off on the ingress, for when nginx fixes a vulnerability in HTTP/2 and
 * OneUptime cannot be upgraded yet (#9846, the hardening guide's "Turn
 * HTTP/2 off until you can upgrade"). It lasts through restarts and
 * upgrades until it is set back, and OTLP over gRPC to HOST is refused
 * meanwhile: exporters fail their TLS handshake with "no application
 * protocol". Easy to leave off after the upgrade that fixes the advisory,
 * so while it is off the doctor reminds of it, and so does npm start. No
 * fault: it is what the setting is for.
 *
 * Only with PROVISION_SSL, as the ingress reads it, and a HOST to name the
 * certificate by (run.sh's PRIMARY_DOMAIN, HOST without its port):
 * otherwise the ingress serves no HTTPS for HOST and speaks HTTP/1.1 alone,
 * so the setting changes nothing (its log says so). And a value it reads as
 * neither on nor off (NGINX_HTTP2=disabled) keeps HTTP/2 on, which whoever
 * wrote it did not mean, so it is worth a look.
 */
const http2Findings = (settings) => {
  const host = splitHost(String(settings.get("HOST") || "").trim()).hostname;

  if (!provisionsSsl(settings) || !host) {
    return [];
  }

  const value = String(settings.get("NGINX_HTTP2") || "").trim();
  const setting = http2SettingOf(value);

  if (setting === "off") {
    return [
      reminder(
        `HTTP/2 is off for ${host} (NGINX_HTTP2=${value} in ${CONFIG_FILE}), so OTLP over gRPC to it is refused. Restarts and upgrades keep it off: once OneUptime's ingress runs a fixed nginx, set NGINX_HTTP2=on and run npm start.`,
      ),
    ];
  }

  if (setting === "unknown") {
    return [
      finding(
        "warn",
        `NGINX_HTTP2 in ${CONFIG_FILE} is ${value}, which the ingress reads as neither on nor off, so HTTP/2 stays on for ${host}.`,
        "To turn it off, set NGINX_HTTP2=off, then run npm start. To keep it on, set NGINX_HTTP2=on.",
      ),
    ];
  }

  return [];
};

const FROM_PREFLIGHT_LEVEL = { stop: "fix", warn: "warn", ok: "ok" };

const fromPreflight = (list) => {
  return list.map((entry) => {
    return finding(FROM_PREFLIGHT_LEVEL[entry.level] || "warn", entry.message);
  });
};

/*
 * Pure: config.env's settings in, what to say about them out. Preflight's
 * checks of HOST, HTTP_PROTOCOL and PROVISION_SSL and of the ingress's
 * ports, every generated secret that still holds config.example.env's
 * placeholder, and HTTP/2 turned off for HOST.
 */
const configFindings = (settings, interfaces) => {
  const findings = fromPreflight(
    pickedPortFindings(settings).concat(hostFindings(settings, interfaces)),
  );

  const isPlaceholder = (name) => {
    const value = settings.get(name);
    return typeof value === "string" && isPlaceholderValue(value.trim());
  };

  // What npm start gives a value of its own on any start.
  const placeholders = GENERATED_SECRETS.filter(isPlaceholder);

  for (const decision of datastorePasswordDecisions(settings)) {
    if (decision.decision === "generate") {
      for (const name of decision.entry.passwordSettings) {
        if (isPlaceholder(name) && placeholders.indexOf(name) === -1) {
          placeholders.push(name);
        }
      }
    }
  }

  if (placeholders.length > 0) {
    findings.push(
      finding(
        "fix",
        `${placeholders.join(", ")} in ${CONFIG_FILE} ${placeholders.length === 1 ? "is" : "are"} still the placeholder config.example.env ships, which everybody knows.`,
        "Run npm start: it gives each its own random value and restarts OneUptime with it.",
      ),
    );
  }

  /*
   * PostgreSQL keeps the password it was created with, so npm start leaves
   * DATABASE_PASSWORD alone once the database exists: the guide changes it
   * in both places.
   */
  if (isPlaceholder("DATABASE_PASSWORD")) {
    findings.push(
      finding(
        "warn",
        `DATABASE_PASSWORD in ${CONFIG_FILE} is still the placeholder config.example.env ships, which everybody knows.`,
        `Change it in PostgreSQL and in ${CONFIG_FILE} together: ${DOCS_URL}#change-the-database-password`,
      ),
    );
  }

  return findings.concat(http2Findings(settings));
};

/*
 * The containers of this install, from `docker compose ps --all --format
 * json`: one JSON object a line (Compose 2.21 and later) or one array.
 */
const containersOf = (output) => {
  const text = String(output || "").trim();

  if (!text) {
    return [];
  }

  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (_error) {
    return text
      .split("\n")
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (_lineError) {
          return null;
        }
      })
      .filter(Boolean);
  }
};

/*
 * A log's lines without Compose's "service-1  | " prefix and without the
 * blank ones: what a finding shows under it.
 */
const logLinesOf = (output, limit) => {
  const lines = String(output || "")
    .split("\n")
    .map((line) => {
      const bar = line.indexOf(" | ");
      return (bar !== -1 && bar < 60 ? line.slice(bar + 3) : line).trimEnd();
    })
    .filter((line) => {
      return line.trim().length > 0;
    });

  return lines.slice(-limit);
};

/*
 * Pure: every service of the install (`docker compose config --services`)
 * against its container, and the last lines of the log of each that is not
 * running well (from `logsOf(service)`).
 */
const serviceFindings = (services, containers, logsOf) => {
  const findings = [];
  const healthy = [];

  for (const service of services) {
    const container = containers.find((entry) => {
      return entry.Service === service;
    });
    const logFix = `Read the lines above. For more, run npm run logs --services=${service}.`;

    if (!container) {
      findings.push(
        finding(
          "fix",
          `The ${service} service is not running: it has no container.`,
          "Run npm start to start every service.",
        ),
      );
      continue;
    }

    const state = String(container.State || "").toLowerCase();
    const health = String(container.Health || "").toLowerCase();

    if (state === "restarting") {
      findings.push(
        finding(
          "fix",
          `The ${service} service keeps restarting, so it never stays up. Its last lines:`,
          logFix,
          logsOf(service),
        ),
      );
    } else if (state !== "running") {
      const exitCode = Number(container.ExitCode);
      const how =
        Number.isFinite(exitCode) && state === "exited"
          ? ` (exit code ${exitCode})`
          : state
            ? ` (${state})`
            : "";

      findings.push(
        finding(
          "fix",
          `The ${service} service stopped${how}. Its last lines:`,
          `${logFix} Then run npm start to start it again.`,
          logsOf(service),
        ),
      );
    } else if (health === "unhealthy") {
      findings.push(
        finding(
          "fix",
          `The ${service} service runs, but fails its health check. Its last lines:`,
          logFix,
          logsOf(service),
        ),
      );
    } else if (health === "starting") {
      findings.push(
        finding(
          "warn",
          `The ${service} service is still starting.`,
          "Wait a minute, then run npm run doctor again.",
        ),
      );
    } else {
      healthy.push(service);
    }
  }

  if (healthy.length > 0 && healthy.length === services.length) {
    findings.push(
      finding("ok", `Every service is running: ${healthy.join(", ")}.`),
    );
  }

  return findings;
};

/*
 * Pure: the recent errors of every service, from `docker compose logs`
 * (each line "service-1  | ..."), the last few of each, with the service
 * named. For --logs.
 */
const recentErrorsOf = (output) => {
  const byService = new Map();

  for (const rawLine of String(output || "").split("\n")) {
    const bar = rawLine.indexOf(" | ");

    if (bar === -1 || bar > 60) {
      continue;
    }

    const service = rawLine.slice(0, bar).trim().replace(/-\d+$/, "");
    const line = rawLine.slice(bar + 3).trimEnd();

    if (!service || !ERROR_LINE.test(line)) {
      continue;
    }

    if (!byService.has(service)) {
      byService.set(service, []);
    }

    byService.get(service).push(line);
  }

  const errors = [];

  for (const entry of byService.entries()) {
    errors.push({
      service: entry[0],
      lines: entry[1].slice(-ERRORS_PER_SERVICE),
    });
  }

  return errors;
};

// The address the server is opened at, from HOST and HTTP_PROTOCOL.
const publicUrlOf = (settings) => {
  const host = String(settings.get("HOST") || "").trim();

  if (!host) {
    return null;
  }

  const protocol =
    String(settings.get("HTTP_PROTOCOL") || "").trim() === "https"
      ? "https"
      : "http";

  return `${protocol}://${host}`;
};

const isLoopbackOrEmpty = (host) => {
  const hostname = splitHost(host).hostname.toLowerCase();

  return (
    !hostname ||
    ["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0", "::", "[::]"].indexOf(
      hostname,
    ) !== -1
  );
};

// What came back, in a few words: "HTTP 502", "connection refused".
const answerOf = (response) => {
  if (!response) {
    return "no answer";
  }

  if (response.error) {
    const words = {
      ECONNREFUSED: "connection refused",
      ENOTFOUND: "the name does not resolve",
      EAI_AGAIN: "the name does not resolve",
      ETIMEDOUT: "no answer in time",
      ECONNRESET: "the connection was closed",
      EHOSTUNREACH: "the host cannot be reached",
    };

    return words[response.error] || response.error;
  }

  return `HTTP ${response.status}`;
};

/*
 * Pure: whether OneUptime answers at the ingress on this server, from the
 * answer to GET <ingress>/status/ready.
 */
const ingressFindings = (ingressUrl, response) => {
  if (response && response.status === 200) {
    return [finding("ok", `OneUptime answers at ${ingressUrl}.`)];
  }

  return [
    finding(
      "fix",
      `OneUptime does not answer at ${ingressUrl} on this server (${answerOf(response)}), so nobody can use it.`,
      "Check the services above. While OneUptime starts, this takes a few minutes; then run npm run doctor again.",
    ),
  ];
};

// The fix line of a finding the server answered: its fix and where to make it.
const serverFixOf = (entry, publicUrl) => {
  const where = entry.adminPath
    ? `${publicUrl || ""}${entry.adminPath}`
    : entry.guidePath
      ? `${GUIDES_ORIGIN}${entry.guidePath}`
      : null;

  if (String(entry.id || "").indexOf("setup-") === 0 && where) {
    return entry.adminPath ? `Set it up at ${where}` : `See ${where}`;
  }

  if (entry.fixSentence && where) {
    return `${entry.fixSentence} ${where}`;
  }

  return entry.fixSentence || where;
};

/*
 * Pure: what to say about the server's own answer to POST
 * /api/admin/health/doctor: each of its findings, or why it did not answer.
 */
const serverFindings = (response, publicUrl) => {
  if (!response || response.error) {
    // The ingress check says OneUptime does not answer.
    return [];
  }

  if (response.status === 404) {
    return [
      finding(
        "warn",
        "This version of OneUptime cannot tell the doctor how its databases, migrations, queues and setup are.",
        "Update OneUptime with npm run update, then run npm run doctor again.",
      ),
    ];
  }

  if (response.status === 400 || response.status === 401) {
    return [
      finding(
        "warn",
        `OneUptime did not accept ONEUPTIME_SECRET from ${CONFIG_FILE}, so it runs with another one and the doctor cannot ask it how it is.`,
        `Run npm start, so OneUptime runs with the settings in ${CONFIG_FILE}.`,
      ),
    ];
  }

  if (response.status !== 200 || !response.json) {
    return [
      finding(
        "warn",
        `OneUptime could not say how its databases, migrations, queues and setup are (${answerOf(response)}).`,
        "Read the app's log with npm run logs --services=app.",
      ),
    ];
  }

  const answer = response.json;
  const findings = [];

  for (const entry of Array.isArray(answer.findings) ? answer.findings : []) {
    if (
      !entry ||
      !entry.sentence ||
      (entry.level !== "fix" && entry.level !== "warn")
    ) {
      continue;
    }

    findings.push(
      finding(
        entry.level,
        `${entry.title ? `${entry.title}: ` : ""}${entry.sentence}`,
        serverFixOf(entry, publicUrl),
      ),
    );
  }

  if (findings.length === 0) {
    findings.push(
      finding(
        "ok",
        "PostgreSQL, ClickHouse and Valkey answer, migrations are complete, the queues are moving and the server is set up.",
      ),
    );
  }

  const version = answer.version || {};

  if (version.current && !version.isUpdateAvailable) {
    findings.push(
      finding(
        "ok",
        version.latest
          ? `OneUptime ${version.current}, the latest release.`
          : `OneUptime ${version.current}.`,
      ),
    );
  }

  return findings;
};

// Where the products to run are chosen, and what SERVER_PRODUCTS takes.
const PRODUCTS_GUIDE = `${DOCS_URL}#run-only-what-you-need`;
const PRODUCTS_ADMIN_PATH = "/admin/settings/products";

// How many products a line names before "and N more".
const PRODUCTS_NAMED = 6;

// "Logs", "Logs and Traces", "Logs, Metrics and Traces", "A, B, C, D, E, F and 3 more".
const productList = (products) => {
  const titles = products.map((entry) => {
    return String(entry.title || entry.product || "");
  });

  if (titles.length > PRODUCTS_NAMED) {
    return `${titles.slice(0, PRODUCTS_NAMED).join(", ")} and ${titles.length - PRODUCTS_NAMED} more`;
  }

  return listed(titles);
};

/*
 * Pure: which products the server switches off (#7481), from the server's
 * answer (`products`, Common's InstallationHealthUtil.getProducts), so that
 * "where did Logs go?" is answered on the command line too. A product an
 * admin switched off is a choice, not a fault: notes, shown whenever there
 * are any and never counted. Only what SERVER_PRODUCTS got wrong, while it
 * is what applies, is worth a look. An older server says nothing of them.
 */
const productsFindings = (products, publicUrl) => {
  if (!products || typeof products !== "object") {
    return [];
  }

  const findings = [];
  const switchedOff = Array.isArray(products.switchedOff)
    ? products.switchedOff
    : [];
  const offByIngestion = Array.isArray(products.offByIngestion)
    ? products.offByIngestion
    : [];
  const unknownNames = Array.isArray(products.unknownNames)
    ? products.unknownNames.filter((name) => {
        return typeof name === "string" && name;
      })
    : [];
  const isSaved = products.source === "saved";

  if (switchedOff.length === 0) {
    findings.push(finding("ok", "Products: every product is switched on."));
  } else {
    const count = `${products.onCount} of ${products.switchableCount} on`;
    const where = isSaved
      ? `set in the Admin Dashboard${publicUrl ? ` at ${publicUrl}${PRODUCTS_ADMIN_PATH}` : ""}`
      : `set by SERVER_PRODUCTS in ${CONFIG_FILE}`;

    findings.push(
      finding(
        "note",
        products.presetTitle
          ? `Products: ${products.presetTitle} (${count}), ${where}.`
          : `Products: ${count}, ${where}. Switched off: ${productList(switchedOff)}.`,
      ),
    );
  }

  // Once an admin saved the page, SERVER_PRODUCTS no longer applies.
  if (!isSaved && unknownNames.length > 0) {
    findings.push(
      finding(
        "warn",
        `SERVER_PRODUCTS in ${CONFIG_FILE} names what OneUptime does not know, so it left ${unknownNames.length === 1 ? "it" : "them"} out: ${unknownNames.join(", ")}.`,
        `Use everything, monitoring-and-status-pages, incident-response, or product keys such as monitors,incidents,status-pages, then run npm start. See ${PRODUCTS_GUIDE}`,
      ),
    );
  }

  if (products.isTelemetryIngestionStopped && offByIngestion.length > 0) {
    findings.push(
      finding(
        "note",
        `Telemetry ingestion is stopped (DISABLE_TELEMETRY_INGESTION=true), so ${productList(offByIngestion)} ${offByIngestion.length === 1 ? "is" : "are"} off for every project.`,
      ),
    );
  }

  if (products.shouldSuggestStoppingIngestion) {
    findings.push(
      finding(
        "note",
        `Every telemetry product is switched off, but telemetry ingestion still runs. You can also stop it to save memory: set DISABLE_TELEMETRY_INGESTION=true in ${CONFIG_FILE}, then run npm start.`,
      ),
    );
  }

  return findings;
};

/*
 * Pure: whether HOST reaches this OneUptime, from the answer to GET
 * <HOST>/status-page-api/custom-domain-readiness/<proof>, a proof only this
 * installation accepts.
 */
const addressFindings = (publicUrl, response) => {
  if (response && response.status === 200) {
    return [finding("ok", `${publicUrl} reaches this OneUptime.`)];
  }

  if (response && !response.error) {
    return [
      finding(
        "fix",
        `${publicUrl} answers (${answerOf(response)}), but not as this OneUptime, so people who open it do not reach this server.`,
        "Point HOST's DNS record at this server. If a proxy is in front, have it pass every request on to OneUptime, with the host name the browser asked for.",
      ),
    ];
  }

  return [
    finding(
      "warn",
      `This server could not open ${publicUrl} (${answerOf(response)}).`,
      "If people can open it from elsewhere, nothing is wrong: some networks do not let a server reach its own public address. If they cannot, point HOST's DNS record at this server and open ports 80 and 443 in its firewall.",
    ),
  ];
};

/*
 * The host names OneUptime's ingress serves the whole application on
 * besides HOST (server_name in Nginx/default.conf.template): a request that
 * names one of them still reaches the dashboard, and any other name is
 * served as a status page's custom domain.
 */
const INGRESS_OWN_NAMES = ["localhost", "ingress"];

// A host name as two can be compared: lower case, no brackets, no trailing dot.
const comparableHostname = (hostname) => {
  let text = String(hostname || "")
    .trim()
    .toLowerCase();

  if (text.startsWith("[") && text.endsWith("]")) {
    text = text.slice(1, -1);
  }

  return text.endsWith(".") ? text.slice(0, -1) : text;
};

const PROXY_GUIDE = `${DOCS_URL}#use-your-own-reverse-proxy`;

/*
 * Pure: whether whatever stands in front of OneUptime - a reverse proxy, a
 * load balancer, a CDN - passes on what the browser asked for (#7050), from
 * the answer to the proof request addressFindings reads: the app says the
 * host name the request reached it with and whether it took it for HTTPS
 * (`request`, CustomDomainServerReadiness.answerTo). Nothing to say when the
 * request did not reach this OneUptime (addressFindings says so), or when
 * the server is older and does not say.
 *
 *   - The host name. OneUptime's ingress routes by it: HOST, localhost and
 *     ingress reach the application, and any other name is served as a
 *     status page's custom domain. A proxy that sends its upstream's name
 *     instead of the browser's (Nginx's default) sends HOST's visitors
 *     there: "OneUptime is not set up for this address", sign-in "Page not
 *     found". The app reads the Host header alone, never X-Forwarded-Host.
 *   - The scheme. A proxy that ends TLS and sends no X-Forwarded-Proto makes
 *     the app take HTTPS visitors for plain HTTP: links it writes for status
 *     pages start with http://, the sign-in cookies of status pages and
 *     dashboards on custom domains are not kept on HTTPS, and Twilio's calls
 *     to incoming call policies fail their signature check.
 *
 * Who a visitor is (X-Forwarded-For) is the Health page's "Visitors share an
 * address" card, which reads it from real sign-ins: one request from this
 * server cannot tell a proxy that drops it from no proxy at all.
 */
const proxyFindings = (publicUrl, host, response) => {
  const seen =
    response && response.status === 200 && response.json
      ? response.json.request
      : null;

  if (!seen || typeof seen !== "object") {
    return [];
  }

  const findings = [];
  const expected = comparableHostname(splitHost(host).hostname);
  const reached =
    typeof seen.host === "string" ? comparableHostname(seen.host) : "";
  const hostFix =
    "Have the proxy pass on the Host header the browser sent: Caddy and Traefik do unless told otherwise, Nginx with proxy_set_header Host $host; and Apache with ProxyPreserveHost On. A cloud load balancer passes it on.";

  if (reached !== expected) {
    const as = reached ? `as ${reached}` : "with no host name it could read";

    findings.push(
      INGRESS_OWN_NAMES.indexOf(reached) !== -1
        ? finding(
            "warn",
            `A proxy in front of OneUptime changes the host name: a request to ${publicUrl} reached OneUptime ${as}. The dashboard still opens, but status pages and dashboards on their own domains cannot be served through this proxy.`,
            `${hostFix} See ${PROXY_GUIDE}`,
          )
        : finding(
            "fix",
            `A proxy in front of OneUptime changes the host name: a request to ${publicUrl} reached OneUptime ${as}, so people who open ${publicUrl} get "OneUptime is not set up for this address", and signing in fails.`,
            `${hostFix} See ${PROXY_GUIDE}`,
          ),
    );
  }

  if (publicUrl.indexOf("https:") === 0 && seen.isHttps === false) {
    findings.push(
      finding(
        "warn",
        `A proxy in front of OneUptime drops X-Forwarded-Proto: OneUptime took an HTTPS request to ${publicUrl} for plain HTTP. Links it writes for status pages start with http://, the sign-in cookies of status pages and dashboards on custom domains are not kept on HTTPS, and Twilio's calls to incoming call policies are refused.`,
        `Have the proxy send X-Forwarded-Proto: https. Caddy, Traefik and cloud load balancers send it; in Nginx add proxy_set_header X-Forwarded-Proto $scheme; See ${PROXY_GUIDE}`,
      ),
    );
  }

  if (findings.length === 0) {
    findings.push(
      finding(
        "ok",
        `Requests to ${publicUrl} reach OneUptime with their host name${publicUrl.indexOf("https:") === 0 ? " and as HTTPS" : ""}.`,
      ),
    );
  }

  return findings;
};

/*
 * Pure: the certificate HOST presents on port 443, when PROVISION_SSL is
 * on. `certificate` is { authorized, authorizationError, subject, issuer,
 * validTo, altNames } or { error }; `sslLog` the app's last CoreSSL lines.
 */
const certificateFindings = (hostname, certificate, now, sslLog) => {
  const logFix =
    "Check that HOST's DNS record points at this server and port 80 is open to the internet, so Let's Encrypt can check the domain.";

  if (!certificate || certificate.error) {
    return [
      finding(
        "fix",
        `PROVISION_SSL=true, but ${hostname} does not answer over HTTPS on port 443 (${answerOf(certificate)}).`,
        logFix,
        sslLog,
      ),
    ];
  }

  const validTo = new Date(certificate.validTo);

  if (!certificate.authorized) {
    return [
      finding(
        "fix",
        `The certificate for ${hostname} is not issued yet: browsers warn about the one the ingress serves now (${certificate.authorizationError || "not trusted"}).${sslLog.length > 0 ? " The app's last lines about it:" : ""}`,
        logFix,
        sslLog,
      ),
    ];
  }

  if (Number.isNaN(validTo.getTime())) {
    return [];
  }

  const daysLeft = Math.floor((validTo.getTime() - now.getTime()) / DAY_MS);
  const when = validTo.toISOString().slice(0, 10);

  if (daysLeft < 0) {
    return [
      finding(
        "fix",
        `The certificate for ${hostname} expired on ${when}.`,
        logFix,
        sslLog,
      ),
    ];
  }

  if (daysLeft < CERTIFICATE_WARN_DAYS) {
    return [
      finding(
        "warn",
        `The certificate for ${hostname} expires on ${when}, in ${daysLeft} days, and has not been renewed yet.`,
        logFix,
        sslLog,
      ),
    ];
  }

  return [
    finding(
      "ok",
      `The certificate for ${hostname}${certificate.issuer ? `, from ${certificate.issuer},` : ""} is valid until ${when}.`,
    ),
  ];
};

// Pure: free disk where Docker keeps its images and volumes.
const diskFindings = (freeBytes, rootDirectory) => {
  if (
    freeBytes !== null &&
    freeBytes !== undefined &&
    freeBytes < MINIMUM_FREE_DISK_TO_RUN_BYTES
  ) {
    return [
      finding(
        "fix",
        `The disk at ${rootDirectory}, where Docker keeps OneUptime's images and databases, is nearly full: ${Math.round(freeBytes / (1000 * 1000))} MB free. The databases stop when it fills.`,
        "Free up space: docker system prune removes images no container uses.",
      ),
    ];
  }

  return fromPreflight(resourceFindings(0, freeBytes, rootDirectory));
};

// "1 thing to fix.", "3 things to fix, and 2 worth a look.", "Everything looks right."
const summaryOf = (findings) => {
  const toFix = findings.filter((entry) => {
    return entry.level === "fix";
  }).length;
  const toWarn = findings.filter((entry) => {
    return entry.level === "warn";
  }).length;
  const things = (count) => {
    return `${count} ${count === 1 ? "thing" : "things"}`;
  };

  if (toFix > 0 && toWarn > 0) {
    return `${things(toFix)} to fix, and ${toWarn} worth a look.`;
  }

  if (toFix > 0) {
    return `${things(toFix)} to fix.`;
  }

  if (toWarn > 0) {
    return `Nothing to fix. ${things(toWarn)} worth a look.`;
  }

  return "Everything looks right.";
};

// The mark of a note: neither a fault nor a pass.
const NOTE_MARK = "•";

// A finding's lines: the mark and what is wrong, then its details and its fix, indented.
const linesOf = (entry) => {
  const mark =
    entry.level === "fix"
      ? MARKS.stop
      : entry.level === "ok"
        ? MARKS.ok
        : entry.level === "note"
          ? NOTE_MARK
          : MARKS.warn;
  const lines = [`  ${mark} ${entry.message}`];

  for (const detail of entry.details) {
    lines.push(`        ${detail}`);
  }

  if (entry.fix) {
    lines.push(`      Fix: ${entry.fix}`);
  }

  return lines;
};

const defaultRunCommand = (command, args, options) => {
  return spawnSync(command, args, {
    cwd: (options && options.cwd) || process.cwd(),
    env: (options && options.env) || process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
};

/*
 * Asks a URL, with a GET unless options.method names another method, which
 * sends an empty body (Content-Length: 0): { status, body, json } or
 * { error } (an error code). It never follows a redirect and accepts any
 * certificate: the certificate check says what is wrong with one.
 */
const defaultRequest = (url, options) => {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (answer) => {
      if (!settled) {
        settled = true;
        resolve(answer);
      }
    };

    let request;

    try {
      const client = url.indexOf("https:") === 0 ? https : http;
      const method = (options && options.method) || "GET";
      const headers = Object.assign({}, (options && options.headers) || {});

      if (method !== "GET") {
        headers["Content-Length"] = "0";
      }

      request = client.request(
        url,
        {
          method: method,
          headers: headers,
          rejectUnauthorized: false,
          timeout: REQUEST_TIMEOUT_MS,
        },
        (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            if (body.length < 4 * 1024 * 1024) {
              body += chunk;
            }
          });
          response.on("end", () => {
            let json = null;

            try {
              json = JSON.parse(body);
            } catch (_error) {
              json = null;
            }

            finish({ status: response.statusCode, body: body, json: json });
          });
        },
      );
    } catch (error) {
      finish({ error: (error && error.code) || "EINVAL" });
      return;
    }

    request.on("timeout", () => {
      request.destroy();
      finish({ error: "ETIMEDOUT" });
    });
    request.on("error", (error) => {
      finish({ error: (error && error.code) || "ERROR" });
    });
    request.end();
  });
};

const nameOf = (entity) => {
  if (!entity) {
    return "";
  }

  return entity.O || entity.CN || "";
};

// The certificate a host presents, for certificateFindings.
const defaultCertificate = (hostname, port) => {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (answer) => {
      if (!settled) {
        settled = true;
        resolve(answer);
      }
    };

    const socket = tls.connect(
      {
        host: hostname,
        port: port,
        servername: hostname,
        rejectUnauthorized: false,
        timeout: TLS_TIMEOUT_MS,
      },
      () => {
        const certificate = socket.getPeerCertificate() || {};

        finish({
          authorized: socket.authorized,
          authorizationError: socket.authorizationError
            ? String(socket.authorizationError)
            : null,
          subject: nameOf(certificate.subject),
          issuer: nameOf(certificate.issuer),
          validTo: certificate.valid_to || null,
          altNames: certificate.subjectaltname || "",
        });
        socket.end();
      },
    );

    socket.on("timeout", () => {
      socket.destroy();
      finish({ error: "ETIMEDOUT" });
    });
    socket.on("error", (error) => {
      finish({ error: (error && error.code) || "ERROR" });
    });
  });
};

const succeeded = (result) => {
  return Boolean(result) && !result.error && result.status === 0;
};

/*
 * Runs every check and prints what it found. Returns the exit code: 1 when
 * something is marked ✗, 0 otherwise (always 0 after `npm start`).
 * Options, every effect passed in: cwd, env, log, argv, runCommand
 * (spawnSync's signature), request(url, { method, headers }),
 * certificate(hostname, port), interfaces, now.
 */
const run = async (options) => {
  const given = options || {};
  const cwd = given.cwd || process.cwd();
  const env = given.env || process.env;
  const log = given.log || console.log;
  const argv = given.argv || process.argv.slice(2);
  const request = given.request || defaultRequest;
  const certificate = given.certificate || defaultCertificate;
  const now = given.now || new Date();
  const interfaces =
    given.interfaces === undefined ? os.networkInterfaces() : given.interfaces;

  const afterStart = argv.indexOf("--after-start") !== -1;
  const showAll = argv.indexOf("--all") !== -1;
  const showLogs = argv.indexOf("--logs") !== -1;

  const findings = [];
  const add = (list) => {
    for (const entry of list) {
      findings.push(entry);
    }
  };

  const configPath = path.join(cwd, CONFIG_FILE);

  if (!fs.existsSync(configPath)) {
    log(
      linesOf(
        finding(
          "fix",
          `${CONFIG_FILE} is missing, so this folder holds no OneUptime to check.`,
          "Run npm run doctor in the oneuptime folder that npm start ran in.",
        ),
      ).join("\n"),
    );
    return afterStart ? 0 : 1;
  }

  const settings = readSettings(fs.readFileSync(configPath, "utf8"));
  // Compose gets config.env's settings over the shell's, as npm start exports them.
  const composeEnv = Object.assign({}, env, Object.fromEntries(settings));
  const runInCwd = (command, args) => {
    return (given.runCommand || defaultRunCommand)(command, args, {
      cwd: cwd,
      env: composeEnv,
    });
  };
  const logsOf = (service, lines) => {
    const result = runInCwd("docker", [
      "compose",
      "logs",
      "--no-color",
      "--tail",
      String(lines || LOG_LINES),
      service,
    ]);

    return succeeded(result)
      ? logLinesOf(result.stdout, lines || LOG_LINES)
      : [];
  };

  add(configFindings(settings, interfaces));

  /*
   * Docker, and every service of this install. Not after `npm start`: its
   * preflight checked Docker and the disk, and the status check has just
   * seen every service answer.
   */
  const docker = afterStart
    ? { findings: [], docker: null }
    : dockerFindings(runInCwd);
  add(fromPreflight(docker.findings));

  const dockerWorks =
    docker.docker !== null &&
    !docker.findings.some((entry) => {
      return entry.level === "stop";
    });

  if (dockerWorks) {
    const services = runInCwd("docker", ["compose", "config", "--services"]);
    const containers = runInCwd("docker", [
      "compose",
      "ps",
      "--all",
      "--format",
      "json",
    ]);

    if (succeeded(services) && succeeded(containers)) {
      add(
        serviceFindings(
          String(services.stdout || "")
            .split("\n")
            .map((line) => {
              return line.trim();
            })
            .filter(Boolean),
          containersOf(containers.stdout),
          (service) => {
            return logsOf(service);
          },
        ),
      );
    }

    add(
      diskFindings(
        freeDiskBytes(runInCwd, docker.docker.rootDirectory),
        docker.docker.rootDirectory,
      ),
    );
  }

  /*
   * OneUptime at the ingress, then what the server says of itself: asked
   * where ONEUPTIME_HTTP_PORT publishes the ingress, under localhost, the
   * name it serves OneUptime under whatever address it listens on (#10024).
   */
  const ingress = ingressRequestOf(settings.get("ONEUPTIME_HTTP_PORT"));
  const ingressUrl = ingress ? ingress.url : "http://localhost";
  const ingressHost = ingress ? ingress.host : "localhost";
  const ready = await request(`${ingressUrl}${READY_PATH}`, {
    headers: { Host: ingressHost },
  });
  add(ingressFindings(ingressUrl, ready));

  /*
   * No address is built from a HOST the configuration check above stops on
   * (an IPv6 address without brackets, a placeholder, a listening address):
   * its fix is said there, and http://2001:db8::1 is no address to open or
   * to send people to.
   */
  const hostIsAnAddress = !hostFindings(settings, interfaces).some((entry) => {
    return entry.level === "stop";
  });
  const publicUrl = hostIsAnAddress ? publicUrlOf(settings) : null;
  const secret = String(settings.get("ONEUPTIME_SECRET") || "").trim();
  let addressProof = null;

  if (ready && ready.status === 200 && secret && !isPlaceholderValue(secret)) {
    /*
     * A POST, as every request that presents the cluster key, and the key
     * URI-encoded, as the app presents its own and compares what it is sent
     * (ClusterKeyAuthorization.getClusterKey): a key with + / = @ & % or a
     * letter beyond ASCII is accepted too, and Node's http can send it.
     */
    const answer = await request(`${ingressUrl}${DOCTOR_PATH}`, {
      method: "POST",
      headers: { Host: ingressHost, clusterkey: encodeURIComponent(secret) },
    });

    add(serverFindings(answer, publicUrl));

    if (answer && answer.status === 200 && answer.json) {
      addressProof = answer.json.addressProof || null;
      // Which products the server switches off (#7481).
      add(productsFindings(answer.json.products, publicUrl));
    }
  }

  // HOST, from outside the containers, and its certificate.
  const host = String(settings.get("HOST") || "").trim();

  if (addressProof && publicUrl && !isLoopbackOrEmpty(host)) {
    const reached = await request(
      `${publicUrl}/status-page-api/custom-domain-readiness/${addressProof}`,
      {},
    );

    add(addressFindings(publicUrl, reached));
    // And whether a proxy in front passed on the host name and the scheme.
    add(proxyFindings(publicUrl, host, reached));
  }

  const hostname = splitHost(host).hostname;

  /*
   * Not for an IP address, IPv4 or IPv6: Let's Encrypt certifies domain
   * names only, so CoreSSL orders nothing for one, and the configuration
   * check says so. Asked of [2001:db8::1], the TLS connection went to the
   * resolver with the brackets on and came back "the name does not resolve".
   * And only for PROVISION_SSL=true, as the app and the ingress read it: with
   * yes or 1 neither serves HOST over HTTPS, and there is no certificate to
   * check.
   */
  if (
    provisionsSsl(settings) &&
    hostIsAnAddress &&
    hostname &&
    !isLoopbackOrEmpty(host) &&
    !isIpAddress(hostname)
  ) {
    const presented = await certificate(hostname, 443);
    const sslLog =
      dockerWorks && (!presented || presented.error || !presented.authorized)
        ? (() => {
            const result = runInCwd("docker", [
              "compose",
              "logs",
              "--no-color",
              "--tail",
              "2000",
              "app",
            ]);

            return succeeded(result)
              ? logLinesOf(result.stdout, 2000)
                  .filter((line) => {
                    return line.indexOf("CoreSSL") !== -1;
                  })
                  .slice(-3)
              : [];
          })()
        : [];

    add(certificateFindings(hostname, presented, now, sslLog));
  }

  /*
   * What to print: what needs attention, worst first, then what is worth
   * knowing (after `npm start`, which says only what needs attention, only
   * the reminders), and what passed when asked.
   */
  const ofLevel = (level) => {
    return findings.filter((entry) => {
      return entry.level === level;
    });
  };
  const problems = ofLevel("fix").concat(ofLevel("warn"));
  const notes = ofLevel("note").filter((entry) => {
    return !afterStart || entry.isReminder === true;
  });
  const shown = problems.concat(notes).concat(showAll ? ofLevel("ok") : []);
  const summary = summaryOf(findings);

  if (afterStart) {
    if (problems.length === 0) {
      log(`${MARKS.ok} ${summary}`);

      for (const entry of notes) {
        log(linesOf(entry).join("\n"));
      }

      return 0;
    }

    log("What needs attention on this server:");
  } else {
    log("Checking this OneUptime:");
  }

  for (const entry of shown) {
    log(linesOf(entry).join("\n"));
  }

  if (showLogs && dockerWorks) {
    const result = runInCwd("docker", [
      "compose",
      "logs",
      "--no-color",
      "--tail",
      String(ERROR_SCAN_LINES),
    ]);
    const errors = succeeded(result) ? recentErrorsOf(result.stdout) : [];

    log("");

    if (errors.length === 0) {
      log(
        `No errors in the last ${ERROR_SCAN_LINES} lines of any service's log.`,
      );
    } else {
      log("Recent errors, by service:");

      for (const entry of errors) {
        log(`  ${entry.service}`);

        for (const line of entry.lines) {
          log(`    ${line}`);
        }
      }
    }
  }

  log("");
  log(summary);

  if (afterStart) {
    log("Run npm run doctor at any time to check again.");
    return 0;
  }

  if (problems.length > 0) {
    log(`The Docker Compose guide has more: ${DOCS_URL}#troubleshooting`);
  }

  return problems.some((entry) => {
    return entry.level === "fix";
  })
    ? 1
    : 0;
};

/*
 * Run as a script (`node ./Scripts/Install/Doctor.js` from the repository
 * root) by `npm run doctor` and at the end of `npm start`. Requiring it, as
 * the tests do, only exports the functions.
 */
if (require.main === module) {
  run()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.log(
        `The doctor could not finish (${error && error.message ? error.message : error}).`,
      );
      process.exitCode = process.argv.indexOf("--after-start") !== -1 ? 0 : 2;
    });
}

module.exports = {
  DOCTOR_PATH,
  READY_PATH,
  LOG_LINES,
  CERTIFICATE_WARN_DAYS,
  TROUBLESHOOTING_COVERAGE,
  MINIMUM_FREE_DISK_TO_RUN_BYTES,
  finding,
  reminder,
  http2SettingOf,
  http2Findings,
  configFindings,
  containersOf,
  logLinesOf,
  serviceFindings,
  recentErrorsOf,
  publicUrlOf,
  ingressFindings,
  serverFixOf,
  serverFindings,
  productsFindings,
  addressFindings,
  proxyFindings,
  certificateFindings,
  diskFindings,
  summaryOf,
  linesOf,
  defaultRequest,
  defaultCertificate,
  run,
};
