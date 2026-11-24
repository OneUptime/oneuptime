// Checks this server before `npm start` starts OneUptime, and says what to
// fix in the words of the setting to change. Creates config.env from
// config.example.env the first time.

const dns = require("dns");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const url = require("url");
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
 *     containers, and the ingress's are not left to Docker to pick
 *     (ONEUPTIME_HTTP_PORT=127.0.0.1: names no port).
 *   - HOST, HTTP_PROTOCOL and PROVISION_SSL: the shapes that break sign-in or
 *     certificates, an IPv6 HOST without brackets, a name with a character
 *     no domain name has, and HOST's DNS.
 *
 * Only what would certainly stop OneUptime stops `npm start` (marked ✗): no
 * Docker, a Docker this user cannot use, no Compose v2, a port another
 * program holds, an ingress port Docker would pick, so that nothing here
 * could find it, a HOST no browser can open (such as 2001:db8::1, which a web
 * address writes as [2001:db8::1]) or the app stops at (such as
 * oneuptime,example.com). The rest is said and OneUptime starts. A check
 * that cannot tell says nothing. ONEUPTIME_SKIP_PREFLIGHT=true skips every
 * check, and a fault of this script's own never stops a start.
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
    setting: "DATABASE_PUBLISHED_PORT",
    example: "5401",
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

/*
 * What the README's quick start writes into HOST until the reader puts their
 * own address in its place (Tests/Ops/ReadmeQuickStart.test.js).
 */
const HOST_PLACEHOLDER = "<your-address>";

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

/*
 * Whether config.env's PROVISION_SSL is on, as OneUptime reads it: only
 * "true", in lower case. The app orders HOST's certificate then
 * (Common/Server/EnvironmentConfig's ProvisionSsl), and the ingress serves
 * HOST over HTTPS (Nginx/run.sh); "yes", "1" or "TRUE" leave both off.
 */
const provisionsSsl = (settings) => {
  return String(settings.get("PROVISION_SSL") || "").trim() === "true";
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

// An IPv4 address, or an IPv6 address with or without brackets.
const isIpAddress = (hostname) => {
  return IPV4_ADDRESS.test(hostname) || String(hostname).indexOf(":") !== -1;
};

/*
 * HOST'S SHAPE: AN IPv6 ADDRESS GOES IN BRACKETS
 *
 * HOST is a domain name or an IPv4 address, with or without ":port", or an
 * IPv6 address in brackets, with or without ":port" after them:
 * HOST=[2001:db8::1], HOST=[2001:db8::1]:8080. A web address writes an IPv6
 * host so (RFC 3986), a browser shows it so and names it so in the Host of
 * every request, and so the ingress names its primary server by it and the
 * app builds every link from it.
 *
 * Without brackets it never worked (#8022): nginx answers 400 to a Host of
 * 2001:db8::1 and never takes a request for a server of that name, so every
 * request fell to the status pages; and the app's links read
 * http://2001:db8::1/..., which no browser opens. Nor can the brackets be put
 * in for the person: 2001:db8::1:8080 is an IPv6 address of its own, and also
 * 2001:db8::1 with port 8080, and only they know which they meant. So the
 * start stops and shows the line to write, both lines when it can be read
 * either way.
 *
 * The rest of the shape, from the same rule: brackets hold an IPv6 address
 * and nothing else, closed, with nothing after them but ":port"; only an IPv6
 * address has two colons; a port is a number from 1 to 65535, after an
 * address. The app refuses most other HOSTs as it starts ("Hostname ... is
 * not in valid format", "Port is not in valid format"), and builds no link
 * that opens from the rest (":8080" is http://:8080/...).
 *
 * And a name is a domain name, by the rule the app reads HOST by as it starts
 * (HOST_REGEX in packages/Common/Types/API/Hostname.ts): the letters a to z,
 * digits, '-' and '_', in parts of 1 to 63 characters between single dots
 * that neither start nor end with '-', and one final dot at most. An IPv4
 * address is such a name too. A name the rule refuses got past npm start,
 * and every service then stopped as it started, with "Hostname
 * oneuptime,example.com is not in valid format" in logs only `npm run doctor`
 * showed, while npm start waited for a status check that never answered
 * (#8877). HOST_NAME is that rule, and Tests/Ops/HelmHost.test.js holds the
 * app's copy, this one and the Helm chart's (oneuptime.validateHost) to one
 * another.
 */

const HOST_NAME =
  /^[a-zA-Z0-9_](?:[a-zA-Z0-9_-]{0,61}[a-zA-Z0-9_])?(?:\.[a-zA-Z0-9_](?:[a-zA-Z0-9_-]{0,61}[a-zA-Z0-9_])?)*\.?$/;
// What a part of a name between its dots may hold, one character at a time.
const NAME_CHARACTER = /^[a-zA-Z0-9_-]$/;
const MAX_NAME_PART_LENGTH = 63;
// A character beyond ASCII: a letter of a name DNS keeps in its xn-- form.
const BEYOND_ASCII = /[^\u0000-\u007f]/;

/*
 * An IPv6 address by the rule the app reads HOST's brackets by as it starts
 * (isIPv6 in packages/Common/Types/IP/IP.ts, which Hostname asks): every
 * text form of RFC 4291, an IPv4 address at the end included
 * (::ffff:192.0.2.1, 64:ff9b::192.0.2.1, 1:2:3:4:5:6:192.0.2.1,
 * 2001:db8::1:192.0.2.1), the forms Node's net.isIPv6 takes. The app's rule
 * once took an IPv4 address only after "::", "::ffff:" or up to four groups
 * and "::", and this copy held HOST to it (#8877) until the app took them
 * all (#8927). Tests/Ops/HelmHost.test.js holds this copy to the app's and
 * the chart's.
 */
const IPV6_ADDRESS =
  /^(?:(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,7}:|(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,5}(?::[0-9a-fA-F]{1,4}){1,2}|(?:[0-9a-fA-F]{1,4}:){1,4}(?::[0-9a-fA-F]{1,4}){1,3}|(?:[0-9a-fA-F]{1,4}:){1,3}(?::[0-9a-fA-F]{1,4}){1,4}|(?:[0-9a-fA-F]{1,4}:){1,2}(?::[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:(?::[0-9a-fA-F]{1,4}){1,6}|:(?:(?::[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(?::[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|(?:(?:[0-9a-fA-F]{1,4}:){6}|::(?:[0-9a-fA-F]{1,4}:){0,5}|[0-9a-fA-F]{1,4}::(?:[0-9a-fA-F]{1,4}:){0,4}|(?:[0-9a-fA-F]{1,4}:){2}:(?:[0-9a-fA-F]{1,4}:){0,3}|(?:[0-9a-fA-F]{1,4}:){3}:(?:[0-9a-fA-F]{1,4}:){0,2}|(?:[0-9a-fA-F]{1,4}:){4}:(?:[0-9a-fA-F]{1,4}:)?|(?:[0-9a-fA-F]{1,4}:){5}:)(?:(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9]))$/i;

// An IPv6 address, written as a web address can hold one: hex digits, colons and dots, no zone.
const isIpv6Address = (text) => {
  return /^[0-9A-Fa-f:.]+$/.test(text) && IPV6_ADDRESS.test(text);
};

const isPort = (text) => {
  return PORT_NUMBER.test(text) && Number(text) >= 1 && Number(text) <= 65535;
};

const colonsIn = (text) => {
  return (String(text).match(/:/g) || []).length;
};

/*
 * The ways to read an IPv6 HOST written without brackets, each { host, port }
 * as HOST is written then: the whole as the address ({ host: "[2001:db8::1]" });
 * and, when its last group is a number and the rest is an address, the rest
 * with that port ({ host: "[2001:db8::1]:8080", port: "8080" }).
 * Empty when it is no IPv6 address either way.
 */
const bracketedReadingsOf = (text) => {
  const readings = [];

  if (isIpv6Address(text)) {
    readings.push({ host: `[${text}]`, port: null });
  }

  const colon = text.lastIndexOf(":");
  const address = text.slice(0, colon);
  const port = text.slice(colon + 1);

  if (colon > 0 && isPort(port) && isIpv6Address(address)) {
    readings.push({ host: `[${address}]:${port}`, port: port });
  }

  return readings;
};

/*
 * The HOST lines to write for a HOST written as `text` (without a scheme, a
 * path or spaces): "HOST=[2001:db8::1]", or both readings of one that has
 * two. `text` itself when it is not an IPv6 address without brackets.
 */
const hostLinesFor = (text) => {
  const readings =
    !text.startsWith("[") && colonsIn(text) >= 2
      ? bracketedReadingsOf(text)
      : [];

  if (readings.length === 0) {
    return `HOST=${text}`;
  }

  return readings
    .map((reading) => {
      return reading.port && readings.length > 1
        ? `HOST=${reading.host} if ${reading.port} is the port people open it on`
        : `HOST=${reading.host}`;
    })
    .join(", or ");
};

/*
 * Quoted, as a character or a part of a name reads in a sentence: "," for
 * one, "," and "!" for two, ",", "!" and "?" for more.
 */
const quotedList = (items) => {
  const quoted = items.map((item) => {
    return `"${item}"`;
  });

  if (quoted.length <= 1) {
    return quoted.join("");
  }

  return `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
};

/*
 * Pure: why `name`, HOST without its port, is no domain name the app takes,
 * as the end of a sentence, or null when HOST_NAME takes it. The first
 * reason only: the characters no name has, then an empty part, then a part
 * that starts or ends with '-', then one longer than 63 characters.
 */
const nameProblemOf = (name) => {
  if (HOST_NAME.test(name)) {
    return null;
  }

  const strangers = [];

  for (const character of Array.from(name)) {
    if (
      character !== "." &&
      !NAME_CHARACTER.test(character) &&
      strangers.indexOf(character) === -1
    ) {
      strangers.push(character);
    }
  }

  if (strangers.length > 0) {
    return `a domain name has the letters a to z, digits, hyphens and dots only, and ${quotedList(strangers)} ${strangers.length === 1 ? "is" : "are"} none of them`;
  }

  if (name.charAt(0) === ".") {
    return "it starts with a dot";
  }

  if (name.indexOf("..") !== -1) {
    return "it has two dots in a row";
  }

  // Its parts, without the one final dot a name may end with.
  const parts = name.replace(/\.$/, "").split(".");

  for (const part of parts) {
    if (part.charAt(0) === "-" || part.charAt(part.length - 1) === "-") {
      return `no part of a domain name starts or ends with a hyphen, and "${part}" does`;
    }
  }

  for (const part of parts) {
    if (part.length > MAX_NAME_PART_LENGTH) {
      return `a part of a domain name between its dots is ${MAX_NAME_PART_LENGTH} characters at most, and "${part}" has ${part.length}`;
    }
  }

  return "it is not one by the rule the app reads HOST by";
};

/*
 * A name with letters beyond ASCII (bücher.example) in the ASCII form DNS
 * writes it in (xn--bcher-kva.example), which is what a browser asks for; or
 * null when it has no such letters or no such form. url.domainToASCII is in
 * Node.js 12.
 */
const asciiNameOf = (name) => {
  if (!BEYOND_ASCII.test(name)) {
    return null;
  }

  let ascii = "";

  try {
    ascii = url.domainToASCII(name);
  } catch (error) {
    ascii = "";
  }

  return ascii && HOST_NAME.test(ascii) ? ascii : null;
};

/*
 * Pure: what is wrong with the shape of HOST (a value with no scheme, path or
 * spaces left), as a stop finding, or null when it is a name or an IPv4
 * address, or an IPv6 address in brackets, each with or without a port.
 */
const hostShapeFinding = (host) => {
  const fromLine = `HOST in config.env is ${host}`;

  if (host.startsWith("[")) {
    const match = /^\[([^\]]*)\](?::([^:]*))?$/.exec(host);

    if (match && isIpv6Address(match[1])) {
      if (match[2] === undefined || isPort(match[2])) {
        return null;
      }

      return {
        level: "stop",
        message: `${fromLine}, but ${match[2] ? `${match[2]} is not a port` : "no port follows its last colon"}. A port is a number from 1 to 65535, such as HOST=[${match[1]}]:8080; without one, write HOST=[${match[1]}].`,
      };
    }

    return {
      level: "stop",
      message: `${fromLine}. Brackets hold an IPv6 address and nothing else, with any port after the closing one, such as HOST=[2001:db8::1] or HOST=[2001:db8::1]:8080. A domain name or an IPv4 address goes without them.`,
    };
  }

  const colons = colonsIn(host);

  if (colons >= 2) {
    const readings = bracketedReadingsOf(host);

    if (readings.length === 0) {
      return {
        level: "stop",
        message: `${fromLine}, which is not an address: a domain name or an IPv4 address has one colon at most, before its port, and an IPv6 address goes in brackets, such as HOST=[2001:db8::1].`,
      };
    }

    const what =
      readings.length === 1 && readings[0].port
        ? "an IPv6 address and a port, without the brackets a web address needs around the address"
        : "an IPv6 address without the brackets a web address needs around one";

    return {
      level: "stop",
      message: `${fromLine}, ${what}, so no browser can open OneUptime at it. Write ${hostLinesFor(host)}.`,
    };
  }

  // One colon at most from here: the name, and the port after the colon.
  const colon = host.indexOf(":");
  const name = colon === -1 ? host : host.slice(0, colon);
  const port = colon === -1 ? null : host.slice(colon + 1);

  if (port !== null && !name) {
    return {
      level: "stop",
      message: `${fromLine}, a port with no address before it. Write the domain name or IP address people open OneUptime at before the colon, such as HOST=oneuptime.example.com:${isPort(port) ? port : "8080"}.`,
    };
  }

  if (port !== null && !isPort(port)) {
    return {
      level: "stop",
      message: `${fromLine}, but ${port ? `${port} is not a port` : "no port follows its colon"}. A port is a number from 1 to 65535, such as HOST=${name}:8080; without one, write HOST=${name}.`,
    };
  }

  const problem = nameProblemOf(name);

  if (!problem) {
    return null;
  }

  const ascii = asciiNameOf(name);

  if (ascii) {
    return {
      level: "stop",
      message: `${fromLine}, a domain name with letters beyond a to z, which OneUptime takes only in the ASCII form DNS writes it in. Write HOST=${ascii}${port === null ? "" : `:${port}`}.`,
    };
  }

  return {
    level: "stop",
    message: `${port === null ? `${fromLine}, which` : `${fromLine}, and ${name}`} is not a domain name: ${problem}.`,
  };
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
  const provisionSsl = provisionsSsl(settings);
  const example = exampleAddress(interfaces);
  const exampleHost = example || "oneuptime.example.com";

  if (!host) {
    findings.push({
      level: "stop",
      message: `HOST in config.env is empty. Set it to the domain name or IP address people will use to reach OneUptime, without http://, such as HOST=${exampleHost}.`,
    });
    return findings;
  }

  /*
   * The README's quick start sets HOST with a line the reader edits first
   * (HOST=<your-address>, HOST_PLACEHOLDER): a HOST with a < or a > in it is
   * that line run as it was copied. No address has either character.
   */
  if (/[<>]/.test(host)) {
    findings.push({
      level: "stop",
      message: `HOST in config.env is ${host}, which is not an address yet. Replace it with the domain name or IP address people will use to reach OneUptime, without http://, such as HOST=${exampleHost}.`,
    });
    return findings;
  }

  const cleaned = cleanedHost(host);

  if (cleaned !== host) {
    findings.push({
      level: "stop",
      message: `HOST in config.env is ${host}. Write the address alone, without http:// or a path: ${hostLinesFor(cleaned || exampleHost)}. HTTP_PROTOCOL says whether people use http or https.`,
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

  const shape = hostShapeFinding(host);

  if (shape) {
    findings.push(shape);
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
 * A PORT DOCKER PICKS
 *
 * ONEUPTIME_HTTP_PORT and STATUS_PAGE_HTTPS_PORT say where Compose publishes
 * the ingress, and everything on this server looks for it there: npm
 * start's status check, the doctor, backup.sh's report and the bundled
 * probes (FollowIngressPort.js). Left empty, each is its default port, 80
 * or 443 (docker-compose.base.yml's ${ONEUPTIME_HTTP_PORT:-80}). Before that
 * default, an empty one had Docker publish the ingress on a port it picked
 * as it started the container, and nothing here knew which: npm start waited
 * five minutes at port 80, ended with "Maximum retries reached", and the
 * probes showed Disconnected (#10170). An address with no port after it
 * (127.0.0.1:) or port 0 still has Docker pick, and no default can fill
 * those in, so they stop the start with the line to write.
 */
const PICKED_PORT_SETTINGS = [
  {
    setting: "ONEUPTIME_HTTP_PORT",
    defaultPort: 80,
    what: "OneUptime's ingress",
  },
  {
    setting: "STATUS_PAGE_HTTPS_PORT",
    defaultPort: 443,
    what: "OneUptime's HTTPS",
  },
];

/*
 * Pure: config.env's settings in, a stop finding for each of those settings
 * that leaves its port to Docker out. Read as Compose reads it: the port
 * after the last ":", and an IP address before it, IPv6's with or without
 * brackets. An address Compose cannot read ("::") is Compose's to say.
 */
const pickedPortFindings = (settings) => {
  const findings = [];

  for (const entry of PICKED_PORT_SETTINGS) {
    const value = String(settings.get(entry.setting) || "").trim();
    const colon = value.lastIndexOf(":");
    const port = value.slice(colon + 1);
    const bare = value.slice(0, Math.max(colon, 0)).replace(/^\[(.*)\]$/, "$1");
    const namesNoPort = colon !== -1 && port === "";
    const isPortZero = PORT_NUMBER.test(port) && Number(port) === 0;

    if (
      !value ||
      !(namesNoPort || isPortZero) ||
      (bare !== "" && !IPV4_ADDRESS.test(bare) && !isIpv6Address(bare))
    ) {
      continue;
    }

    const address = isIpv6Address(bare) ? `[${bare}]:` : bare ? `${bare}:` : "";

    findings.push({
      level: "stop",
      message: `${entry.setting} in config.env is ${value}, which leaves the port to Docker: it would publish ${entry.what} on a port it picks as it starts, and nothing on this server would know which. Name the port, such as ${entry.setting}=${address}${entry.defaultPort}.`,
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

  /*
   * A HOST whose shape stops the start (hostShapeFinding) is said there, with
   * the line to write: a name that is not one, such as oneuptime,example.com,
   * would only be said again here as a name that "does not resolve yet".
   */
  if (!host || cleanedHost(host) !== host || hostShapeFinding(host)) {
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

  const provisionSsl = provisionsSsl(settings);

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
    report(pickedPortFindings(settings));
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
  HOST_PLACEHOLDER,
  MINIMUM_MEMORY_BYTES,
  MINIMUM_FREE_DISK_BYTES,
  MINIMUM_DOCKER_VERSION,
  PUBLISHED_PORTS,
  DOCKER_MESSAGES,
  PICKED_PORT_SETTINGS,
  isTruthy,
  provisionsSsl,
  gigabytes,
  versionNumbers,
  parsePortSetting,
  splitHost,
  cleanedHost,
  isIpAddress,
  bracketedReadingsOf,
  HOST_NAME,
  IPV6_ADDRESS,
  nameProblemOf,
  asciiNameOf,
  hostShapeFinding,
  exampleAddress,
  hostFindings,
  pickedPortFindings,
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
