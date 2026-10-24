// Points the bundled probes and Runner at the port the ingress is published
// on, when config.env moves the ingress off port 80.

const fs = require("fs");
const { readSettings } = require("./ReplacePlaceholderSecrets");
const { ok, listed } = require("./StartOutput");

/*
 * WHY
 *
 * The bundled probes and the shared Runner use the host's network, so they
 * reach OneUptime the way anything on the server does: through the ingress,
 * at GLOBAL_PROBE_1_ONEUPTIME_URL, GLOBAL_PROBE_2_ONEUPTIME_URL and
 * ONEUPTIME_RUNNER_ONEUPTIME_URL, which config.example.env ships as
 * http://localhost - port 80. Moving the ingress (ONEUPTIME_HTTP_PORT=8080,
 * because port 80 was taken, or 127.0.0.1:8080 behind a proxy of one's own)
 * left them calling port 80: the probe registered nowhere and showed
 * Disconnected, and monitors never ran (issues #1834, #2035, and the Docker
 * Compose guide's troubleshooting said to set the three by hand).
 *
 * So `npm start`, before Compose starts anything, moves each of the three
 * that calls this server over plain HTTP (localhost, 127.0.0.1 or [::1]) on
 * another port than the ingress's to the ingress's address, and says so. A
 * URL for anything else - a domain name, https, another server, a path - is
 * the operator's own choice and is left exactly as it is, as is every other
 * line of config.env. A second run changes nothing.
 *
 * Never stops `npm start`: a config.env it cannot read or write is passed
 * over (the probe then says it is disconnected, as before), and it always
 * exits 0.
 */

// The URL settings of the services that reach OneUptime over the host's network.
const BUNDLED_URL_SETTINGS = [
  "GLOBAL_PROBE_1_ONEUPTIME_URL",
  "GLOBAL_PROBE_2_ONEUPTIME_URL",
  "ONEUPTIME_RUNNER_ONEUPTIME_URL",
];

const INGRESS_PORT_SETTING = "ONEUPTIME_HTTP_PORT";

const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"];
const EVERY_ADDRESS = ["", "0.0.0.0", "::", "[::]"];

const PORT_NUMBER = /^\d{1,5}$/;
// http://<loopback>[:port][/] and nothing more: the shape config.example.env ships.
const LOOPBACK_URL =
  /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::(\d{1,5}))?\/?$/i;

const isCommentLine = (line) => {
  const trimmed = line.trim();
  return trimmed.startsWith("#") || trimmed.startsWith("//");
};

const assignedKeyOf = (line) => {
  if (isCommentLine(line) || line.indexOf("=") === -1) {
    return null;
  }

  return line.split("=")[0].trim();
};

const unquotedValueOf = (line) => {
  const value = line.slice(line.indexOf("=") + 1).trim();

  if (
    value.length >= 2 &&
    (value[0] === '"' || value[0] === "'") &&
    value[value.length - 1] === value[0]
  ) {
    return value.slice(1, -1).trim();
  }

  return value;
};

/*
 * The address the ingress answers at on this server, as a URL the bundled
 * services can call, from ONEUPTIME_HTTP_PORT: a port alone ("8080") or an
 * address and a port ("127.0.0.1:8080"). Every address of the server and
 * its loopback address are http://localhost; another address is itself.
 * { url, port }, or null when the setting is neither.
 */
const ingressUrlOf = (value) => {
  const text = String(value === undefined ? "80" : value).trim() || "80";
  let address = "";
  let port = text;

  if (!PORT_NUMBER.test(text)) {
    const colon = text.lastIndexOf(":");

    if (colon === -1 || !PORT_NUMBER.test(text.slice(colon + 1))) {
      return null;
    }

    address = text.slice(0, colon);
    port = text.slice(colon + 1);
  }

  const number = Number(port);
  const hostname =
    EVERY_ADDRESS.indexOf(address) !== -1 || address === "127.0.0.1"
      ? "localhost"
      : address;

  return {
    url: `http://${hostname}${number === 80 ? "" : `:${number}`}`,
    port: number,
  };
};

/*
 * Pure: the URL setting's value, and the ingress (ingressUrlOf), in; the
 * URL it should be, or null when it stays as it is.
 */
const followedUrl = (value, ingress) => {
  const match = LOOPBACK_URL.exec(String(value || "").trim());

  if (!match || !ingress) {
    return null;
  }

  const port = match[2] ? Number(match[2]) : 80;

  if (port === ingress.port) {
    return null;
  }

  return ingress.url;
};

/*
 * Pure: config.env's contents in; the contents with each bundled service's
 * URL moved to the ingress, and the settings it moved, out. Every other
 * line, and each line's ending, comes back exactly as it was.
 */
const followIngressPort = (contents) => {
  const settings = readSettings(contents);
  const ingress = ingressUrlOf(settings.get(INGRESS_PORT_SETTING));
  const moved = [];

  const lines = contents.split("\n").map((line) => {
    const key = assignedKeyOf(line);

    if (!key || BUNDLED_URL_SETTINGS.indexOf(key) === -1) {
      return line;
    }

    const lineEnding = line.endsWith("\r") ? "\r" : "";
    const body = lineEnding ? line.slice(0, -1) : line;
    const url = followedUrl(unquotedValueOf(body), ingress);

    if (!url) {
      return line;
    }

    if (moved.indexOf(key) === -1) {
      moved.push(key);
    }

    return `${body.slice(0, body.indexOf("=") + 1)}${url}${lineEnding}`;
  });

  return {
    contents: lines.join("\n"),
    moved: moved,
    url: ingress ? ingress.url : null,
  };
};

/*
 * What the moved settings belong to, as the line names it: "the bundled
 * probe", "the bundled probes", "the bundled Runner", "the bundled probe and
 * Runner"...
 */
const movedServicesOf = (moved) => {
  const probes = moved.filter((key) => {
    return key.indexOf("_PROBE_") !== -1;
  }).length;
  const hasRunner = moved.some((key) => {
    return key.indexOf("_RUNNER_") !== -1;
  });
  const names = [];

  if (probes > 0) {
    names.push(probes === 1 ? "probe" : "probes");
  }

  if (hasRunner) {
    names.push("Runner");
  }

  return `the bundled ${listed(names)}`;
};

// The line printed when followIngressPort moved something.
const describeMoved = (moved, url) => {
  return ok(
    `Pointed ${movedServicesOf(moved)} at the ingress: ${listed(moved)} ${moved.length === 1 ? "is" : "are"} now ${url} in config.env.`,
  );
};

/*
 * Moves the URLs in config.env. Never throws; `options` replaces the file
 * system and the output for the tests. Returns the settings it moved.
 */
const init = (options) => {
  const given = options || {};
  const path = given.path || "./config.env";
  const fileSystem = given.fileSystem || fs;
  const log = given.log || console.log;

  try {
    if (!fileSystem.existsSync(path)) {
      return [];
    }

    const result = followIngressPort(fileSystem.readFileSync(path, "utf8"));

    if (result.moved.length === 0) {
      return [];
    }

    fileSystem.writeFileSync(path, result.contents);
    log(describeMoved(result.moved, result.url));

    return result.moved;
  } catch (_error) {
    return [];
  }
};

/*
 * Run as a script (`node ./Scripts/Install/FollowIngressPort.js` from the
 * repository root) by `npm start`, before Compose starts anything; `npm run
 * update` ends with `npm run start`. Requiring it, as the tests do, only
 * exports the functions.
 */
if (require.main === module) {
  init();
}

module.exports = {
  BUNDLED_URL_SETTINGS,
  INGRESS_PORT_SETTING,
  LOOPBACK_HOSTNAMES,
  ingressUrlOf,
  followedUrl,
  followIngressPort,
  describeMoved,
  init,
};
