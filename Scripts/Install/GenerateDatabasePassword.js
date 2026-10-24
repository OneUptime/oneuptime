// Gives a new Docker Compose install a random DATABASE_PASSWORD and
// ENCRYPTION_SECRET before PostgreSQL creates its database, in place of the
// placeholders from config.example.env.

const crypto = require("crypto");
const fs = require("fs");
const { spawnSync } = require("child_process");
const { ok, warn } = require("./StartOutput");

/*
 * WHY
 *
 * config.example.env ships DATABASE_PASSWORD as a placeholder
 * ("please-change-this-to-random-value") that is public in this repository,
 * and the README's quick start copies that file. The bundled PostgreSQL takes
 * POSTGRES_PASSWORD (DATABASE_PASSWORD, docker-compose.base.yml) only when it
 * creates its database, so whatever DATABASE_PASSWORD holds at the first start
 * stays the password of its superuser.
 *
 * So `npm start` runs this first: it is the first command of the start
 * script in package.json, and `npm run update` ends with `npm run start`. It
 * is part of that script rather than a prestart hook because npm skips pre-
 * and post-scripts when ignore-scripts is set, as many hardened servers do.
 * A DATABASE_PASSWORD still at a placeholder gets a random value, but only
 * while the bundled PostgreSQL has not created its database yet. Once it has,
 * the database keeps the password it was created with and changing
 * config.env alone would lock OneUptime out of it, so this then only says how
 * to change both.
 *
 * ENCRYPTION_SECRET is the same kind of setting: everything OneUptime
 * encrypts in the database (integration tokens, SMTP passwords, calendar feed
 * tokens) is encrypted with it, so a new value makes what was encrypted with
 * the old one unreadable. It too can be given a random value safely only
 * before PostgreSQL has created its database - nothing can have been
 * encrypted with it yet - and only then is it: on a new install, with the
 * same check. Until this did so, a newcomer had to run the README's sed
 * loop (GNU sed only) to replace it, and an install that skipped the loop
 * ran on a key that is public in this repository. Once the database exists
 * it is left as it is, and nothing is said here: the App says it at every
 * start (EnvironmentConfig.EncryptionSecretWarning), and changing it is no
 * longer a fix.
 *
 * Nothing here stops a start: a check that cannot tell (no Docker, Compose
 * failing) changes nothing, and the script always exits 0.
 */

const SETTING = "DATABASE_PASSWORD";
const HOST_SETTING = "DATABASE_HOST";
const ENCRYPTION_SECRET_SETTING = "ENCRYPTION_SECRET";

// The compose service that runs the bundled PostgreSQL (docker-compose.yml),
// which is also the DATABASE_HOST config.example.env ships.
const BUNDLED_DATABASE_SERVICE = "postgres";

/*
 * A value this repository ships: "secret", which OneUptime's code once fell
 * back to, or anything holding the placeholder text config.example.env uses.
 * The same rule as the other shipped secrets. An empty value is left alone:
 * an operator who blanked it meant to.
 */
const SHIPPED_FALLBACK = "secret";
const PLACEHOLDER_MARK = "please-change-this";

const DATABASE_STATE = Object.freeze({
  CREATED: "created",
  NOT_CREATED: "not-created",
  UNKNOWN: "unknown",
});

// The page that shows how to change the password of a database that exists.
const CHANGE_PASSWORD_DOCS_URL =
  "https://oneuptime.com/docs/installation/docker-compose#change-the-database-password";

/*
 * Asks the bundled PostgreSQL's own data directory, through Compose, whether
 * a database is there: a non-empty PG_VERSION is the test the postgres
 * image's entrypoint makes before it creates one, and with it skips
 * POSTGRES_PASSWORD. Compose resolves the project, its volume and any
 * override files exactly as `npm start` does, and `run` publishes no port and
 * starts no other service.
 */
const DATABASE_STATE_MARK = "oneuptime-database:";
const DATABASE_STATE_SCRIPT =
  'if [ -s "$PGDATA/PG_VERSION" ]; then echo oneuptime-database:created; ' +
  "else echo oneuptime-database:not-created; fi";
const DATABASE_STATE_COMMAND = [
  "compose",
  "run",
  "--rm",
  "--no-deps",
  "-T",
  "--entrypoint",
  "sh",
  BUNDLED_DATABASE_SERVICE,
  "-c",
  DATABASE_STATE_SCRIPT,
];

// A first start may pull the PostgreSQL image here.
const DATABASE_STATE_TIMEOUT_MS = 10 * 60 * 1000;

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

const isShippedValue = (value) => {
  if (typeof value !== "string") {
    return false;
  }

  const trimmed = value.trim();

  return trimmed === SHIPPED_FALLBACK || trimmed.includes(PLACEHOLDER_MARK);
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

// 256 bits from the CSPRNG as 64 hex characters: safe unquoted in config.env,
// in the postgresql:// URL backup.sh builds, and in a sed replacement.
const generatePassword = () => {
  return crypto.randomBytes(32).toString("hex");
};

/*
 * Pure: config.env's contents in, the contents with every `setting` line
 * that holds a shipped value set to `value` out. Every other line, and each
 * line's ending, comes back exactly as it was, so a second run changes
 * nothing.
 */
const replaceShippedValue = (contents, setting, value) => {
  let replaced = false;

  const lines = contents.split("\n").map((line) => {
    if (assignedKeyOf(line) !== setting) {
      return line;
    }

    const lineEnding = line.endsWith("\r") ? "\r" : "";
    const body = lineEnding ? line.slice(0, -1) : line;

    if (!isShippedValue(unquotedValueOf(body))) {
      return line;
    }

    replaced = true;
    return `${body.slice(0, body.indexOf("=") + 1)}${value}${lineEnding}`;
  });

  return { contents: lines.join("\n"), replaced };
};

// The same, for DATABASE_PASSWORD.
const replaceDatabasePassword = (contents, password) => {
  return replaceShippedValue(contents, SETTING, password);
};

/*
 * Pure: what to do, from config.env's settings and (only asked for when it
 * matters) the state of the bundled database.
 *
 *   "nothing"          the password is not a shipped value.
 *   "generate"         a shipped value, the bundled PostgreSQL, no database
 *                      yet: give it a random value now.
 *   "warn-created"     a shipped value the bundled database was created with.
 *   "warn-external"    a shipped value for a database OneUptime does not run.
 *   "warn-unknown"     a shipped value, and the check could not tell.
 */
const decide = (settings, databaseState) => {
  if (!isShippedValue(settings.get(SETTING))) {
    return "nothing";
  }

  if ((settings.get(HOST_SETTING) || "").trim() !== BUNDLED_DATABASE_SERVICE) {
    return "warn-external";
  }

  if (databaseState === DATABASE_STATE.NOT_CREATED) {
    return "generate";
  }

  if (databaseState === DATABASE_STATE.CREATED) {
    return "warn-created";
  }

  return "warn-unknown";
};

/*
 * Pure: whether ENCRYPTION_SECRET gets a random value - "generate" - or is
 * left as it is - "nothing": a shipped value, the bundled PostgreSQL, and no
 * database yet, so nothing can have been encrypted with it.
 */
const decideEncryptionSecret = (settings, databaseState) => {
  if (
    isShippedValue(settings.get(ENCRYPTION_SECRET_SETTING)) &&
    (settings.get(HOST_SETTING) || "").trim() === BUNDLED_DATABASE_SERVICE &&
    databaseState === DATABASE_STATE.NOT_CREATED
  ) {
    return "generate";
  }

  return "nothing";
};

const needsDatabaseState = (settings) => {
  return (
    (isShippedValue(settings.get(SETTING)) ||
      isShippedValue(settings.get(ENCRYPTION_SECRET_SETTING))) &&
    (settings.get(HOST_SETTING) || "").trim() === BUNDLED_DATABASE_SERVICE
  );
};

// The state of the bundled database, from what the check printed.
const parseDatabaseState = (result) => {
  if (!result || result.error || result.status !== 0) {
    return DATABASE_STATE.UNKNOWN;
  }

  const answer = String(result.stdout || "")
    .split("\n")
    .map((line) => {
      return line.trim();
    })
    .find((line) => {
      return line.startsWith(DATABASE_STATE_MARK);
    });

  if (answer === `${DATABASE_STATE_MARK}${DATABASE_STATE.CREATED}`) {
    return DATABASE_STATE.CREATED;
  }

  if (answer === `${DATABASE_STATE_MARK}${DATABASE_STATE.NOT_CREATED}`) {
    return DATABASE_STATE.NOT_CREATED;
  }

  return DATABASE_STATE.UNKNOWN;
};

/*
 * Only the answer is read from stdout. Compose's own progress - pulling the
 * PostgreSQL image on a first start - goes to the terminal as `npm start`
 * would show it.
 */
const runDockerCommand = (args, options) => {
  return spawnSync("docker", args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    timeout: DATABASE_STATE_TIMEOUT_MS,
  });
};

/*
 * Whether the bundled PostgreSQL has created its database. Compose gets
 * config.env's settings the way `npm start` exports them, so it picks the
 * same project (COMPOSE_PROJECT_NAME) and the same volume.
 */
const bundledDatabaseState = (settings, options = {}) => {
  const runDocker = options.runDocker || runDockerCommand;
  const env = Object.assign(
    {},
    options.env || process.env,
    Object.fromEntries(settings),
  );

  try {
    return parseDatabaseState(
      runDocker(DATABASE_STATE_COMMAND, { cwd: options.cwd, env }),
    );
  } catch (_error) {
    return DATABASE_STATE.UNKNOWN;
  }
};

/*
 * What a start says, as a line of the list `npm start` prints first
 * (Scripts/Install/StartOutput.js). The new values are never printed.
 */
const MESSAGES = {
  generate: ok(
    `Gave ${SETTING} its own random value in config.env, before PostgreSQL creates its database.`,
  ),
  "warn-created": warn(
    `${SETTING} in config.env is still the placeholder from config.example.env, which is public, ` +
      "and PostgreSQL was created with it. " +
      `PostgreSQL keeps the password it was created with: change it there and in config.env together, as ${CHANGE_PASSWORD_DOCS_URL} shows.`,
  ),
  "warn-external": warn(
    `${SETTING} in config.env is still the placeholder from config.example.env, which is public. ` +
      `Give the database at ${HOST_SETTING} a long random password, and set ${SETTING} to it.`,
  ),
  "warn-unknown": warn(
    `${SETTING} in config.env is still the placeholder from config.example.env, which is public, ` +
      "and Docker could not say whether PostgreSQL has created its database yet, so it was left as it is. " +
      `Before the first start, set ${SETTING} to a long random value; after it, see ${CHANGE_PASSWORD_DOCS_URL}`,
  ),
};

/*
 * What a start says when it gave ENCRYPTION_SECRET a value: with
 * DATABASE_PASSWORD's, or alone (an install whose operator set the
 * password).
 */
const ENCRYPTION_SECRET_MESSAGES = {
  "with-password": ok(
    `Gave ${SETTING} and ${ENCRYPTION_SECRET_SETTING} their own random values in config.env, before PostgreSQL creates its database.`,
  ),
  alone: ok(
    `Gave ${ENCRYPTION_SECRET_SETTING} its own random value in config.env, before OneUptime stores anything encrypted with it.`,
  ),
};

/*
 * Reads ./config.env, and writes it back only to set new values. Returns
 * what it decided for DATABASE_PASSWORD (ENCRYPTION_SECRET follows the same
 * check: decideEncryptionSecret). Every effect is passed in, so tests run it
 * without Docker.
 */
const run = (options = {}) => {
  const cwd = options.cwd || process.cwd();
  const path = `${cwd}/config.env`;
  const log = options.log || console.log;
  const warn = options.warn || console.warn;

  if (!fs.existsSync(path)) {
    return "nothing";
  }

  const contents = fs.readFileSync(path, "utf8");
  const settings = readSettings(contents);
  const databaseState = needsDatabaseState(settings)
    ? bundledDatabaseState(settings, {
        cwd,
        env: options.env,
        runDocker: options.runDocker,
      })
    : DATABASE_STATE.UNKNOWN;
  const decision = decide(settings, databaseState);
  const encryptionSecretDecision = decideEncryptionSecret(
    settings,
    databaseState,
  );
  const makeValue = options.generatePassword || generatePassword;
  let updated = contents;

  if (decision === "generate") {
    updated = replaceDatabasePassword(updated, makeValue()).contents;
  }

  if (encryptionSecretDecision === "generate") {
    updated = replaceShippedValue(
      updated,
      ENCRYPTION_SECRET_SETTING,
      makeValue(),
    ).contents;
  }

  if (updated !== contents) {
    fs.writeFileSync(path, updated);
  }

  if (decision === "generate") {
    log(
      encryptionSecretDecision === "generate"
        ? ENCRYPTION_SECRET_MESSAGES["with-password"]
        : MESSAGES.generate,
    );
  } else if (encryptionSecretDecision === "generate") {
    log(ENCRYPTION_SECRET_MESSAGES.alone);
  }

  if (decision !== "nothing" && decision !== "generate") {
    warn(MESSAGES[decision]);
  }

  return decision;
};

/*
 * Run as a script (`node ./Scripts/Install/GenerateDatabasePassword.js` from
 * the repository root, by `npm start` before it starts Compose). Requiring
 * it, as the tests do, only exports the functions.
 */
if (require.main === module) {
  try {
    run();
  } catch (error) {
    console.warn(
      `Could not check ${SETTING} in config.env: ${error && error.message ? error.message : error}`,
    );
  }
}

module.exports = {
  SETTING,
  HOST_SETTING,
  ENCRYPTION_SECRET_SETTING,
  BUNDLED_DATABASE_SERVICE,
  SHIPPED_FALLBACK,
  PLACEHOLDER_MARK,
  DATABASE_STATE,
  DATABASE_STATE_COMMAND,
  DATABASE_STATE_SCRIPT,
  CHANGE_PASSWORD_DOCS_URL,
  MESSAGES,
  ENCRYPTION_SECRET_MESSAGES,
  isShippedValue,
  readSettings,
  generatePassword,
  replaceShippedValue,
  replaceDatabasePassword,
  decide,
  decideEncryptionSecret,
  needsDatabaseState,
  parseDatabaseState,
  bundledDatabaseState,
  run,
};
