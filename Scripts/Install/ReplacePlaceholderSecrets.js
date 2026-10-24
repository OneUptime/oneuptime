// Gives config.env a random value for every internal secret it still holds
// as a placeholder.

const crypto = require("crypto");
const fs = require("fs");
const { ok, warn: warnLine, listed } = require("./StartOutput");

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
 * depends on, are set here: any start may replace their placeholder, and the
 * containers it recreates all get the new value together. That is not true of
 * PostgreSQL's password - PostgreSQL takes DATABASE_PASSWORD only when it
 * creates its database, so GenerateDatabasePassword.js, a step of the start
 * script before this one, sets it before that and only then - nor of
 * ENCRYPTION_SECRET, whose change makes what was encrypted with it
 * unreadable, so the same step sets it on a new install only.
 *
 *   - ONEUPTIME_SECRET: the cluster key OneUptime's own services present
 *     to each other (Common/Server/Middleware/ClusterKeyAuthorization). The
 *     bundled Runner of this release does not hold it.
 *   - REGISTER_PROBE_KEY: what a probe presents to register as a global probe
 *     (Telemetry/API/ProbeIngest/Register). The server refuses a shipped value.
 *   - GLOBAL_PROBE_1_KEY, GLOBAL_PROBE_2_KEY: the bundled global probes' own
 *     keys. A probe re-registers with its key on every start, so a fresh value
 *     is picked up with no monitoring gap (Register rekeys the same-named
 *     global probe in place). ProbeService.verifyProbeKey refuses a shipped
 *     value, so a probe left on a placeholder key cannot authenticate.
 *   - ONEUPTIME_RUNNER_KEY: the in-cluster Runner's agent key, which it
 *     presents to register and on every code-fix request, and which the app
 *     is given too, to let the Runner register with it. The server refuses a
 *     shipped value (SharedRunnerKeyAuthorization, CodeFixAgentAuth,
 *     AIAgentAPI).
 *   - GLOBAL_RUNNER_KEY: the bundled global Runner's key. The app keeps the
 *     global Runner's row from it on every boot and the global-runner service
 *     presents it on every request, so both pick up a fresh value together;
 *     a shipped value keeps the global Runner off (SeedBundledGlobalRunner)
 *     and never authenticates (RunnerService.findByIdAndKey).
 *   - CLICKHOUSE_PASSWORD and VALKEY_PASSWORD, below: the passwords of the
 *     ClickHouse and Valkey that Docker Compose runs.
 */
const GENERATED_SECRETS = [
  "ONEUPTIME_SECRET",
  "REGISTER_PROBE_KEY",
  "GLOBAL_PROBE_1_KEY",
  "GLOBAL_PROBE_2_KEY",
  "ONEUPTIME_RUNNER_KEY",
  "GLOBAL_RUNNER_KEY",
];

/*
 * THE PASSWORDS OF THE DATASTORES DOCKER COMPOSE RUNS
 *
 * The ClickHouse and the Valkey that docker-compose.yml runs take their
 * password from config.env every time their container starts, not only when
 * their data is created: the clickhouse-server image writes CLICKHOUSE_PASSWORD
 * into the server's users config at each start, outside the data volume, and
 * Valkey is started with --requirepass and keeps nothing on disk. The start
 * that writes a new value recreates them and every container that signs in
 * to them together, so any start may replace a placeholder - an existing
 * install's too - and ClickHouse keeps its data.
 *
 * That holds only while config.env points at those services. A password for
 * a ClickHouse or a cache OneUptime does not run (CLICKHOUSE_HOST,
 * VALKEY_HOST) belongs to that server, so it is left as it is and the
 * operator is told.
 *
 * Valkey was called Redis: REDIS_PASSWORD and REDIS_HOST are its older names,
 * which Compose falls back to (`${VALKEY_PASSWORD:-${REDIS_PASSWORD:-}}`), so
 * every name of the password that holds a placeholder gets the one new value.
 */
const BUNDLED_DATASTORE_PASSWORDS = [
  {
    datastore: "ClickHouse",
    passwordSettings: ["CLICKHOUSE_PASSWORD"],
    hostSettings: ["CLICKHOUSE_HOST"],
    bundledHosts: ["clickhouse"],
  },
  {
    datastore: "Valkey",
    passwordSettings: ["VALKEY_PASSWORD", "REDIS_PASSWORD"],
    hostSettings: ["VALKEY_HOST", "REDIS_HOST"],
    // The compose service, and the network alias it answers to as well.
    bundledHosts: ["valkey", "redis"],
  },
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

/*
 * config.env's settings, as `npm start` exports them: comments skipped,
 * surrounding quotes removed, and the last assignment of a name wins.
 */
const readSettings = (contents) => {
  const settings = new Map();

  for (const rawLine of contents.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const key = assignedKeyOf(line);

    if (key) {
      settings.set(key, unquotedValueOf(line));
    }
  }

  return settings;
};

/*
 * The value Compose uses for a setting known by several names: the first
 * name that is set and not empty, as `${NEW:-${OLD}}` reads them.
 */
const effectiveValue = (settings, names) => {
  for (const name of names) {
    const value = settings.get(name);

    if (value) {
      return value;
    }
  }

  return "";
};

// Whether config.env points this datastore at the service Docker Compose runs.
const isBundledDatastore = (settings, entry) => {
  return entry.bundledHosts.includes(
    effectiveValue(settings, entry.hostSettings).toLowerCase(),
  );
};

/*
 * What to do with each datastore's password, from config.env's settings:
 *
 *   - "generate": it is a placeholder and config.env points at the datastore
 *     Docker Compose runs, so every name of it that holds a placeholder gets
 *     one new value;
 *   - "external": it is a placeholder, but for a datastore OneUptime does not
 *     run, so it is left as it is and the operator is told;
 *   - nothing at all when the password is the operator's own, or empty.
 */
const datastorePasswordDecisions = (settings) => {
  return BUNDLED_DATASTORE_PASSWORDS.map((entry) => {
    const password = effectiveValue(settings, entry.passwordSettings);

    if (!password || !isPlaceholderValue(password)) {
      return { entry: entry, decision: "nothing" };
    }

    return {
      entry: entry,
      decision: isBundledDatastore(settings, entry) ? "generate" : "external",
    };
  });
};

// 256 bits from the CSPRNG, as 64 lowercase hex characters.
const generateSecret = () => {
  return crypto.randomBytes(32).toString("hex");
};

/*
 * Pure: config.env's contents in, the contents with every listed secret that
 * still holds a placeholder set to a random value out, plus the names it set
 * and the datastore passwords it left for the operator (a placeholder for a
 * datastore OneUptime does not run). A name assigned more than once gets one
 * value, and so do all the names of one datastore's password, so whichever
 * line the shell reads last, the containers agree. Everything else -
 * comments, other settings, a value an operator chose, a blank value, line
 * endings - is returned exactly as it came, so a second run changes nothing.
 */
const replacePlaceholderSecrets = (contents, makeSecret = generateSecret) => {
  const decisions = datastorePasswordDecisions(readSettings(contents));

  // Each setting this run may set, with the group whose one value it takes.
  const groupOf = {};

  for (const key of GENERATED_SECRETS) {
    groupOf[key] = key;
  }

  for (const { entry, decision } of decisions) {
    if (decision === "generate") {
      for (const name of entry.passwordSettings) {
        groupOf[name] = entry.datastore;
      }
    }
  }

  const lines = contents.split("\n");
  const newValues = {};
  const replaced = [];

  const replacedLines = lines.map((line) => {
    const key = assignedKeyOf(line);

    if (!key || !groupOf[key]) {
      return line;
    }

    const lineEnding = line.endsWith("\r") ? "\r" : "";
    const body = lineEnding ? line.slice(0, -1) : line;

    if (!isPlaceholderValue(unquotedValueOf(body))) {
      return line;
    }

    const group = groupOf[key];

    if (!newValues[group]) {
      newValues[group] = makeSecret();
    }

    if (!replaced.includes(key)) {
      replaced.push(key);
    }

    return `${body.slice(0, body.indexOf("=") + 1)}${newValues[group]}${lineEnding}`;
  });

  const leftForOperator = decisions
    .filter(({ decision }) => {
      return decision === "external";
    })
    .map(({ entry }) => {
      return entry;
    });

  return {
    contents: replacedLines.join("\n"),
    replaced: replaced,
    leftForOperator: leftForOperator,
  };
};

// The datastore whose password `name` is, or null for a key.
const datastoreOf = (name) => {
  const entry = BUNDLED_DATASTORE_PASSWORDS.find((candidate) => {
    return candidate.passwordSettings.includes(name);
  });

  return entry ? entry.datastore : null;
};

/*
 * The line printed when replacePlaceholderSecrets set something, as a line
 * of the list `npm start` prints first (Scripts/Install/StartOutput.js).
 */
const describeReplacedSecrets = (replaced) => {
  const datastores = [];

  for (const name of replaced) {
    const datastore = datastoreOf(name);

    if (datastore && !datastores.includes(datastore)) {
      datastores.push(datastore);
    }
  }

  let message =
    `Gave ${listed(replaced)} ${replaced.length === 1 ? "its own random value" : "their own random values"} in config.env, ` +
    "in place of the public placeholders from config.example.env.";

  if (datastores.length > 0) {
    const one = datastores.length === 1;

    message +=
      ` The bundled ${listed(datastores)} ${one ? "takes its new password" : "take their new passwords"} as this start recreates ${one ? "it" : "them"}; ` +
      `anything else that signs in to ${one ? "it" : "them"} needs the new value from config.env.`;
  }

  return ok(message);
};

/*
 * The line printed for a datastore password that is a placeholder, for a
 * datastore OneUptime does not run.
 */
const describeExternalDatastorePassword = (entry) => {
  const setting = entry.passwordSettings[0];
  const host = entry.hostSettings[0];

  return warnLine(
    `${setting} in config.env is still the placeholder from config.example.env, which is public, ` +
      `and ${host} points at a ${entry.datastore} that Docker Compose does not run, so it was left as it is. ` +
      `Give that ${entry.datastore} a long random password, and set ${setting} to it.`,
  );
};

// The line printed when config.env could not be read ("read") or written ("written").
const describeUnchangedConfig = (action, error) => {
  const reason = error && error.message ? error.message : String(error);

  return warnLine(
    `config.env could not be ${action} (${reason}), so its placeholder secrets were not given random values. ` +
      "OneUptime starts anyway, but the bundled probes and Runners do not register while REGISTER_PROBE_KEY, " +
      "GLOBAL_PROBE_1_KEY, GLOBAL_PROBE_2_KEY, ONEUPTIME_RUNNER_KEY or GLOBAL_RUNNER_KEY still holds the " +
      "placeholder from config.example.env: set each to a long random value (openssl rand -hex 32 makes one).",
  );
};

/*
 * Sets every listed secret in config.env that still holds a placeholder.
 *
 * Never throws. A config.env it cannot read or write is left as it was and
 * reported: OneUptime's own services do not need the new value (they use a
 * key of the installation's own), only the bundled probes and Runner do, so
 * neither `npm start` nor `npm run update` stops over it. `options` replaces the
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

  for (const entry of result.leftForOperator) {
    warn(describeExternalDatastorePassword(entry));
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
  BUNDLED_DATASTORE_PASSWORDS,
  SHIPPED_FALLBACK,
  PLACEHOLDER_MARK,
  isPlaceholderValue,
  readSettings,
  datastorePasswordDecisions,
  replacePlaceholderSecrets,
  describeReplacedSecrets,
  describeExternalDatastorePassword,
  describeUnchangedConfig,
  init,
};
