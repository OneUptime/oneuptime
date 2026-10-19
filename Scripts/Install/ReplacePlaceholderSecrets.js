// Gives config.env a random value for every internal secret it still holds
// as a placeholder.

const crypto = require("crypto");
const fs = require("fs");

/*
 * THE SECRETS THIS MAY SET
 *
 * config.example.env ships every secret as a placeholder
 * ("please-change-this-to-random-value"), and the README's Docker Compose
 * install copies it as it is. OneUptime refuses such a value wherever it
 * would let a caller in as one of its own services
 * (Common/Server/EnvironmentConfig.isShippedSecretValue), so an install that
 * kept one has to get a real value from somewhere - and with Docker Compose
 * that is config.env, which every container reads.
 *
 * Only secrets that OneUptime's own containers share, and that nothing stored
 * depends on, are listed: any start may replace their placeholder, and the
 * containers it recreates all get the new value together. That is not true of
 * the datastore passwords - PostgreSQL takes DATABASE_PASSWORD only when it
 * creates its database, and changing ENCRYPTION_SECRET makes what was
 * encrypted with it unreadable - so they are left to the operator (and the
 * Docker Compose guide shows how to set them all before the first start).
 *
 *   - ONEUPTIME_SECRET: the cluster key the app and the bundled Runner
 *     present to each other (Common/Server/Middleware/ClusterKeyAuthorization).
 *   - REGISTER_PROBE_KEY: what a probe presents to register as a global probe
 *     (Telemetry/API/ProbeIngest/Register). The server refuses a shipped value.
 *   - GLOBAL_PROBE_1_KEY, GLOBAL_PROBE_2_KEY: the bundled global probes' own
 *     keys. A probe re-registers with its key on every start, so a fresh value
 *     is picked up with no monitoring gap (Register rekeys the same-named
 *     global probe in place). ProbeService.verifyProbeKey refuses a shipped
 *     value, so a probe left on a placeholder key cannot authenticate.
 *   - ONEUPTIME_RUNNER_KEY: the in-cluster Runner's agent key, which it
 *     presents to register and on every code-fix request. The server refuses
 *     a shipped value (CodeFixAgentAuth, AIAgentAPI).
 */
const GENERATED_SECRETS = [
  "ONEUPTIME_SECRET",
  "REGISTER_PROBE_KEY",
  "GLOBAL_PROBE_1_KEY",
  "GLOBAL_PROBE_2_KEY",
  "ONEUPTIME_RUNNER_KEY",
];

/*
 * A value OneUptime treats as shipped: "secret", which the code used to fall
 * back to, or anything containing the placeholder text config.example.env
 * uses. The same rule as isShippedSecretValue, except that an empty value is
 * left alone here: an operator who blanked a setting meant to.
 */
const SHIPPED_FALLBACK = "secret";
const PLACEHOLDER_MARK = "please-change-this";

const isCommentLine = (line) => {
  const trimmed = line.trim();
  return trimmed.startsWith("#") || trimmed.startsWith("//");
};

// The KEY of a KEY=value line (surrounding whitespace ignored), or null.
const assignedKeyOf = (line) => {
  if (isCommentLine(line) || !line.includes("=")) {
    return null;
  }

  return line.split("=")[0].trim();
};

// The value of a KEY=value line, without surrounding whitespace or quotes.
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

const isPlaceholderValue = (value) => {
  return value === SHIPPED_FALLBACK || value.includes(PLACEHOLDER_MARK);
};

// 256 bits from the CSPRNG, as 64 lowercase hex characters.
const generateSecret = () => {
  return crypto.randomBytes(32).toString("hex");
};

/*
 * Pure: config.env's contents in, the contents with every listed secret that
 * still holds a placeholder set to a random value out, plus the names it set.
 * A name assigned more than once gets one value, so whichever line the shell
 * reads last, the containers agree. Everything else - comments, other
 * settings, a value an operator chose, a blank value, line endings - is
 * returned exactly as it came, so a second run changes nothing.
 */
const replacePlaceholderSecrets = (contents, makeSecret = generateSecret) => {
  const lines = contents.split("\n");
  const newValues = {};
  const replaced = [];

  const replacedLines = lines.map((line) => {
    const key = assignedKeyOf(line);

    if (!key || !GENERATED_SECRETS.includes(key)) {
      return line;
    }

    const lineEnding = line.endsWith("\r") ? "\r" : "";
    const body = lineEnding ? line.slice(0, -1) : line;

    if (!isPlaceholderValue(unquotedValueOf(body))) {
      return line;
    }

    if (!newValues[key]) {
      newValues[key] = makeSecret();
      replaced.push(key);
    }

    return `${body.slice(0, body.indexOf("=") + 1)}${newValues[key]}${lineEnding}`;
  });

  return { contents: replacedLines.join("\n"), replaced };
};

// The line printed when replacePlaceholderSecrets set something.
const describeReplacedSecrets = (replaced) => {
  return (
    `config.env: ${replaced.join(", ")} still held the placeholder from config.example.env, ` +
    "so each was set to a new random value. These are the keys OneUptime's own services, probes " +
    "and the bundled Runner present to each other; OneUptime refuses the public placeholder for " +
    "every one of them, and each container reads its value from config.env."
  );
};

// The line printed when config.env could not be read ("read") or written ("written").
const describeUnchangedConfig = (action, error) => {
  const reason = error && error.message ? error.message : String(error);

  return (
    `config.env could not be ${action} (${reason}), so its placeholder secrets were not given random values. ` +
    "OneUptime starts anyway, but the bundled probes and Runner do not register while REGISTER_PROBE_KEY, " +
    "GLOBAL_PROBE_1_KEY, GLOBAL_PROBE_2_KEY, ONEUPTIME_SECRET or ONEUPTIME_RUNNER_KEY still holds the " +
    "placeholder from config.example.env: set each to a long random value (openssl rand -hex 32 makes one)."
  );
};

/*
 * Sets every listed secret in config.env that still holds a placeholder.
 *
 * Never throws. A config.env it cannot read or write is left as it was and
 * reported: OneUptime's own services do not need the new value (they use a
 * key of the installation's own), only the bundled Runner does, so neither
 * `npm start` nor `npm run update` stops over it. `options` replaces the
 * file system and the output for the tests. Returns the names it set.
 */
const init = (options = {}) => {
  const path = options.path || "./config.env";
  const fileSystem = options.fileSystem || fs;
  const log = options.log || console.log;
  const warn = options.warn || console.error;

  if (!fileSystem.existsSync(path)) {
    return [];
  }

  let result;

  try {
    result = replacePlaceholderSecrets(fileSystem.readFileSync(path, "utf8"));
  } catch (error) {
    warn(describeUnchangedConfig("read", error));
    return [];
  }

  if (result.replaced.length === 0) {
    return [];
  }

  try {
    fileSystem.writeFileSync(path, result.contents);
  } catch (error) {
    warn(describeUnchangedConfig("written", error));
    return [];
  }

  log(describeReplacedSecrets(result.replaced));

  return result.replaced;
};

/*
 * Run as a script (`node ./Scripts/Install/ReplacePlaceholderSecrets.js` from
 * the repository root) by `npm start` (a step of the start script, not a
 * prestart hook: npm skips pre- and post-scripts when ignore-scripts is set,
 * as many hardened servers do, and the placeholder keys must be replaced on
 * every install) and by Scripts/Install/configure.sh, which `npm run update`
 * runs. Requiring it, as the tests do, only exports the functions.
 */
if (require.main === module) {
  init();
}

module.exports = {
  GENERATED_SECRETS,
  SHIPPED_FALLBACK,
  PLACEHOLDER_MARK,
  isPlaceholderValue,
  replacePlaceholderSecrets,
  describeReplacedSecrets,
  describeUnchangedConfig,
  init,
};
