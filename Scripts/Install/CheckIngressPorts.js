// Says so when TRUSTED_PROXY_HOPS counts a proxy in front of OneUptime while
// the ingress, moved off ports 80 and 443 for that proxy, is still published
// on every address of the server.

const fs = require("fs");
const { readSettings } = require("./ReplacePlaceholderSecrets");
const { warn: warnLine, listed } = require("./StartOutput");

/*
 * WHY
 *
 * OneUptime takes each visitor's address from X-Forwarded-For, counting
 * TRUSTED_PROXY_HOPS entries in from the right (Common/Server/Utils/ClientIp).
 * With 2, that is the entry a proxy of the operator's own wrote in front of
 * OneUptime's ingress - the visitor's address only while that proxy is the
 * one way in. Behind a proxy on the same server, the Docker Compose guide
 * moves the ingress off ports 80 and 443 and publishes it on 127.0.0.1 alone
 * (ONEUPTIME_HTTP_PORT=127.0.0.1:8080). A port written as a number alone
 * (ONEUPTIME_HTTP_PORT=8080) is published on every address of the server
 * instead, as the guide had it before, and stays so on an upgrade.
 *
 * So `npm start` says so when TRUSTED_PROXY_HOPS counts a proxy (2 or more)
 * and ONEUPTIME_HTTP_PORT or STATUS_PAGE_HTTPS_PORT is a port number alone
 * other than its default (80, 443): the ingress was moved for a proxy on
 * this server, and is still published on every address. Nothing is said for
 *
 *   - a port written with an address (127.0.0.1:8080, or 0.0.0.0:8080 where
 *     a firewall lets only the proxy in): it says where it is published;
 *   - ports 80 and 443: OneUptime itself is the way in there, or a proxy on
 *     another machine is, which the guide keeps the only way in with a
 *     firewall that this server cannot see.
 *
 * It only reads config.env, after ReplacePlaceholderSecrets.js may have
 * written it, and never stops `npm start`: anything it cannot read is
 * passed over in silence, and it always exits 0.
 */

// The ingress's port settings, with the port each publishes by default.
const INGRESS_PORT_SETTINGS = [
  { setting: "ONEUPTIME_HTTP_PORT", defaultPort: "80" },
  { setting: "STATUS_PAGE_HTTPS_PORT", defaultPort: "443" },
];

const HOPS_SETTING = "TRUSTED_PROXY_HOPS";

// A port number alone: Docker publishes it on every address of the server.
const PORT_NUMBER_ALONE = /^\d{1,5}$/;

// Where the Docker Compose guide says how to put a proxy in front.
const REVERSE_PROXY_DOCS_URL =
  "https://oneuptime.com/docs/installation/docker-compose#use-your-own-reverse-proxy";

/*
 * TRUSTED_PROXY_HOPS as OneUptime reads it (Common/Server/EnvironmentConfig):
 * empty is 1, and so is anything that is not a whole number of 0 or more.
 */
const trustedProxyHopsOf = (value) => {
  const text = typeof value === "string" ? value.trim() : "";

  if (!text) {
    return 1;
  }

  const hops = Number(text);

  return Number.isInteger(hops) && hops >= 0 ? hops : 1;
};

/*
 * Pure: config.env's settings in (readSettings), the ingress ports a proxy
 * on this server has around it out - each port setting that is a port number
 * alone other than its default, while TRUSTED_PROXY_HOPS counts a proxy -
 * with the value that would publish it on the loopback address alone.
 */
const ingressPortsAroundProxy = (settings) => {
  if (trustedProxyHopsOf(settings.get(HOPS_SETTING)) < 2) {
    return [];
  }

  const found = [];

  for (const { setting, defaultPort } of INGRESS_PORT_SETTINGS) {
    const value = (settings.get(setting) || "").trim();

    if (PORT_NUMBER_ALONE.test(value) && value !== defaultPort) {
      found.push({
        setting: setting,
        value: value,
        loopbackValue: `127.0.0.1:${value}`,
      });
    }
  }

  return found;
};

// The warning printed for the ports ingressPortsAroundProxy found.
const describeIngressPortsAroundProxy = (hops, ports) => {
  const current = ports.map((port) => {
    return `${port.setting}=${port.value}`;
  });
  const loopback = ports.map((port) => {
    return `${port.setting}=${port.loopbackValue}`;
  });
  const one = ports.length === 1;

  return warnLine(
    `config.env sets ${HOPS_SETTING}=${hops}, so OneUptime takes each visitor's address from what your proxy writes, ` +
      "which holds only while that proxy is the one way in. " +
      `${listed(current)} ${one ? "publishes" : "publish"} OneUptime on every address of this server, around the proxy. ` +
      `With the proxy on this server, publish ${one ? "it" : "them"} on the loopback address only: set ${listed(loopback)} in config.env, then run npm start. ` +
      `If a firewall already lets only your proxy reach ${one ? "this port" : "these ports"}, write the address ${one ? "it is" : "they are"} published on instead, ` +
      `such as ${ports[0].setting}=0.0.0.0:${ports[0].value}, and this warning stops. See ${REVERSE_PROXY_DOCS_URL}`,
  );
};

/*
 * Reads config.env and prints the warning when it applies. Never throws:
 * a config.env that is missing or cannot be read says nothing. `options`
 * replaces the file system and the output for the tests. Returns the ports
 * it warned about.
 */
const init = (options = {}) => {
  const path = options.path || "./config.env";
  const fileSystem = options.fileSystem || fs;
  const warn = options.warn || console.error;

  try {
    if (!fileSystem.existsSync(path)) {
      return [];
    }

    const settings = readSettings(fileSystem.readFileSync(path, "utf8"));
    const ports = ingressPortsAroundProxy(settings);

    if (ports.length > 0) {
      warn(
        describeIngressPortsAroundProxy(
          trustedProxyHopsOf(settings.get(HOPS_SETTING)),
          ports,
        ),
      );
    }

    return ports;
  } catch {
    return [];
  }
};

/*
 * Run as a script (`node ./Scripts/Install/CheckIngressPorts.js` from the
 * repository root) by `npm start`, as a step of the start script after
 * ReplacePlaceholderSecrets.js; `npm run update` ends with `npm run start`.
 * Requiring it, as the tests do, only exports the functions.
 */
if (require.main === module) {
  init();
}

module.exports = {
  INGRESS_PORT_SETTINGS,
  HOPS_SETTING,
  REVERSE_PROXY_DOCS_URL,
  trustedProxyHopsOf,
  ingressPortsAroundProxy,
  describeIngressPortsAroundProxy,
  init,
};
