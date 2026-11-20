// Points the bundled probes at the address and port the ingress is published
// on, when config.env moves the ingress off port 80 or onto one address.

const fs = require("fs");
const { assignedKeyOf, readSettings } = require("./ReplacePlaceholderSecrets");
const { ok, listed } = require("./StartOutput");

/*
 * WHY
 *
 * The bundled probes use the host's network, so they reach OneUptime the way
 * anything on the server does: through the ingress, at
 * GLOBAL_PROBE_1_ONEUPTIME_URL and GLOBAL_PROBE_2_ONEUPTIME_URL, which
 * config.example.env ships as http://localhost - port 80. Moving the ingress
 * (ONEUPTIME_HTTP_PORT=8080, because port 80 was taken, or 127.0.0.1:8080
 * behind a proxy of one's own) left them calling port 80: the probe
 * registered nowhere and showed Disconnected, and monitors never ran (issues
 * #1834, #2035, and the Docker Compose guide's troubleshooting said to set
 * them by hand). The bundled global Runner reaches the app on OneUptime's own
 * network (http://app:APP_PORT), so where the ingress listens is nothing to
 * it.
 *
 * So `npm start`, before Compose starts anything, moves each of them that
 * calls this server over plain HTTP (localhost, 127.0.0.1 or [::1]) on
 * another port than the ingress's, or at a name that does not reach it
 * there (localhost, with the ingress on 10.0.0.5:80 or [::1]:80), to the
 * ingress's address, and says so. A URL for anything else - a domain name,
 * https, another server, a path - is the operator's own choice and is left
 * exactly as it is, as is every other line of config.env. A second run
 * changes nothing.
 *
 * Never stops `npm start`: a config.env it cannot read or write is passed
 * over (the probe then says it is disconnected, as before), and it always
 * exits 0.
 */

// The URL settings of the services that reach OneUptime over the host's network.
const BUNDLED_URL_SETTINGS = [
  "GLOBAL_PROBE_1_ONEUPTIME_URL",
  "GLOBAL_PROBE_2_ONEUPTIME_URL",
];

const INGRESS_PORT_SETTING = "ONEUPTIME_HTTP_PORT";

const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"];

const PORT_NUMBER = /^\d{1,5}$/;
// http://<loopback>[:port][/] and nothing more: the shape config.example.env ships.
const LOOPBACK_URL =
  /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::(\d{1,5}))?\/?$/i;

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
 * Where ONEUPTIME_HTTP_PORT publishes the ingress, as Compose publishes it:
 * a port alone ("8080"), or an address and a port ("127.0.0.1:8080",
 * "[::1]:8080", "::1:8080", "10.0.0.5:8080"). Compose takes what follows
 * the last ":" for the port, and what comes before it, without brackets,
 * for the address. { address, port }: the address in brackets when it is an
 * IPv6 address, as a URL writes one ("[::1]", "[::]"), and "" for none;
 * null when the setting is neither. Tests/Scripts/status-check.sh reads it
 * the same way.
 */
const publishedIngressOf = (value) => {
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

  const bare =
    address.startsWith("[") && address.endsWith("]")
      ? address.slice(1, -1)
      : address;

  return {
    address: bare.indexOf(":") !== -1 ? `[${bare}]` : bare,
    port: Number(port),
  };
};

/*
 * The address this server reaches the ingress at, from where it is
 * published (publishedIngressOf): localhost for a port alone, which Docker
 * publishes on every address, IPv4 and IPv6, and for 0.0.0.0, every IPv4
 * address, which localhost names everywhere as 127.0.0.1; IPv6's loopback
 * address for ::, which Docker publishes on IPv6 alone, where localhost may
 * be 127.0.0.1 alone (Ubuntu's /etc/hosts gives ::1 another name); and the
 * address itself otherwise.
 */
const connectableAddressOf = (address) => {
  if (address === "" || address === "0.0.0.0") {
    return "localhost";
  }

  if (address === "[::]") {
    return "[::1]";
  }

  return address;
};

// ":8080", or nothing for port 80, as a web address writes its port.
const portSuffixOf = (port) => {
  return port === 80 ? "" : `:${port}`;
};

/*
 * The address the ingress answers at on this server, as a URL the bundled
 * services can call, from ONEUPTIME_HTTP_PORT: a port alone ("8080") or an
 * address and a port ("127.0.0.1:8080"). Where it is published on every
 * address of the server, and on 127.0.0.1, that is http://localhost, which
 * the ingress serves OneUptime under; elsewhere the address itself
 * (connectableAddressOf), as localhost need not reach it. { url, port,
 * address }, address as publishedIngressOf says it, or null when the
 * setting is neither.
 */
const ingressUrlOf = (value) => {
  const published = publishedIngressOf(value);

  if (!published) {
    return null;
  }

  const hostname =
    published.address === "127.0.0.1"
      ? "localhost"
      : connectableAddressOf(published.address);

  return {
    url: `http://${hostname}${portSuffixOf(published.port)}`,
    port: published.port,
    address: published.address,
  };
};

/*
 * Where an install script asks OneUptime on this server (npm run doctor,
 * backup.sh's report): { url, host, port }. `url` connects where
 * ONEUPTIME_HTTP_PORT publishes the ingress (http://127.0.0.1:8080,
 * http://[::1]:8080, http://10.0.0.5:8080; connectableAddressOf); `host` is
 * the Host header to send with it: localhost and the port, the name the
 * ingress serves OneUptime under whatever address it listens on. By the
 * address it listens on, the ingress serves a status page's custom domain
 * instead (#10024). null when the setting is neither a port nor an address
 * and a port.
 */
const ingressRequestOf = (value) => {
  const published = publishedIngressOf(value);

  if (!published) {
    return null;
  }

  const port = portSuffixOf(published.port);

  return {
    url: `http://${connectableAddressOf(published.address)}${port}`,
    host: `localhost${port}`,
    port: published.port,
  };
};

/*
 * Whether a loopback name reaches the ingress where it is published: any of
 * them on every address; localhost and 127.0.0.1 on 0.0.0.0 and on
 * 127.0.0.1, which localhost names everywhere; [::1] alone on :: and on
 * ::1; none on an address of the server's own, such as 10.0.0.5.
 */
const reachesIngress = (hostname, address) => {
  if (address === "") {
    return true;
  }

  if (address === "0.0.0.0" || address === "127.0.0.1") {
    return hostname === "localhost" || hostname === "127.0.0.1";
  }

  if (address === "[::]" || address === "[::1]") {
    return hostname === "[::1]";
  }

  return false;
};

/*
 * Pure: the URL setting's value, and the ingress (ingressUrlOf), in; the
 * URL it should be, or null when it stays as it is: a loopback URL on the
 * ingress's port, at a name that reaches it there. One that keeps the port
 * but names an address the ingress is not published on (localhost, with the
 * ingress on 10.0.0.5:80 or [::1]:80) is moved too: the probe there called
 * nothing and showed Disconnected.
 */
const followedUrl = (value, ingress) => {
  const match = LOOPBACK_URL.exec(String(value || "").trim());

  if (!match || !ingress) {
    return null;
  }

  const hostname = match[1].toLowerCase();
  const port = match[2] ? Number(match[2]) : 80;

  if (port === ingress.port && reachesIngress(hostname, ingress.address)) {
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
 * probe" or "the bundled probes".
 */
const movedServicesOf = (moved) => {
  return `the bundled ${moved.length === 1 ? "probe" : "probes"}`;
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
  publishedIngressOf,
  connectableAddressOf,
  ingressUrlOf,
  ingressRequestOf,
  followedUrl,
  followIngressPort,
  describeMoved,
  init,
};
