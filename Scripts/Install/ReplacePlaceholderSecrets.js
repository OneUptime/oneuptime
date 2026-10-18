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
 * the others - PostgreSQL takes DATABASE_PASSWORD only when it creates its
 * database, and changing ENCRYPTION_SECRET makes what was encrypted with it
 * unreadable - so they are left to the operator (and the Docker Compose guide
 * shows how to set them all before the first start).
 *
 *   - ONEUPTIME_SECRET: the cluster key the app and the bundled Runner
 *     present to each other (Common/Server/Middleware/ClusterKeyAuthorization).
 */
const GENERATED_SECRETS = ["ONEUPTIME_SECRET"];

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
    "so it was set to a new random value. OneUptime's own services, the bundled Runner among them, " +
    "use it to call each other; nothing else needs it."
  );
};

const init = () => {
  const path = "./config.env";

  if (!fs.existsSync(path)) {
    return;
  }

  const result = replacePlaceholderSecrets(fs.readFileSync(path, "utf8"));

  if (result.replaced.length === 0) {
    return;
  }

  fs.writeFileSync(path, result.contents);
  console.log(describeReplacedSecrets(result.replaced));
};

/*
 * Run as a script (`node ./Scripts/Install/ReplacePlaceholderSecrets.js` from
 * the repository root) by `npm start` (its prestart) and by
 * Scripts/Install/configure.sh, which `npm run update` runs. Requiring it,
 * as the tests do, only exports the pure functions.
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
};
