// This script merges config.env.tpl to config.env

const fs = require("fs");

/*
 * Settings that have been RENAMED, as newName -> the name they used to have.
 *
 * Without this, renaming a setting in config.example.env silently destroys the
 * running install. The merge below appends any template key the user's
 * config.env lacks, TAKING THE TEMPLATE'S VALUE -- so on the first
 * `npm run update` after a rename, VALKEY_PASSWORD would be appended as
 * `please-change-this-to-random-value`, that placeholder would outrank the real
 * REDIS_PASSWORD still in the file, and the instance would come back up with a
 * cache password published in this repository.
 *
 * So: a renamed key whose OLD name is still set is left alone entirely. The
 * user's config.env keeps the one copy of the secret it already has, and
 * docker-compose.base.yml resolves the new name to it via
 * `${VALKEY_PASSWORD:-${REDIS_PASSWORD}}`. Nothing is rewritten, so rolling back
 * to an older OneUptime release still works.
 */
const RENAMED_FROM = {
  VALKEY_HOST: "REDIS_HOST",
  VALKEY_PORT: "REDIS_PORT",
  VALKEY_DB: "REDIS_DB",
  VALKEY_USERNAME: "REDIS_USERNAME",
  VALKEY_PASSWORD: "REDIS_PASSWORD",
  VALKEY_IP_FAMILY: "REDIS_IP_FAMILY",
  VALKEY_TLS_CA: "REDIS_TLS_CA",
  VALKEY_TLS_CERT: "REDIS_TLS_CERT",
  VALKEY_TLS_KEY: "REDIS_TLS_KEY",
  VALKEY_TLS_SENTINEL_MODE: "REDIS_TLS_SENTINEL_MODE",
};

/*
 * The Enterprise Edition is the image APP_TAG pulls (enterprise-release,
 * enterprise-13.1.0, ...), not IS_ENTERPRISE_EDITION. Before the edition split
 * a Docker Compose Enterprise install was APP_TAG=release plus
 * IS_ENTERPRISE_EDITION=true, and APP_TAG=release is now the Community image:
 * `npm run update` would pull it, and the App refuses to start with
 * IS_ENTERPRISE_EDITION=true rather than silently stop enforcing "Require SSO",
 * SSO, SCIM and audit logging (packages/App/Utils/EnterpriseLoader.ts).
 *
 * So while config.env still asks for the Enterprise Edition, the merge moves
 * APP_TAG to the Enterprise image of the same release (release ->
 * enterprise-release, 13.0.7 -> enterprise-13.0.7) and says so. Setting
 * IS_ENTERPRISE_EDITION=false opts out. The value is read the way the App reads
 * it (exactly "true"), and the last assignment wins, as it does when
 * `npm run update` exports config.env.
 */
const ENTERPRISE_TAG_PREFIX = "enterprise-";

const keyOf = (line) => {
  return line.split("=")[0];
};

const isCommentLine = (line) => {
  const trimmed = line.trim();
  return trimmed.startsWith("#") || trimmed.startsWith("//");
};

// The KEY of a KEY=value line (surrounding whitespace ignored), or null.
const assignedKeyOf = (line) => {
  if (isCommentLine(line) || !line.includes("=")) {
    return null;
  }

  return keyOf(line).trim();
};

// The value of a KEY=value line, without surrounding whitespace or quotes.
const unquotedValueOf = (line) => {
  const value = line.slice(line.indexOf("=") + 1).trim();

  if (
    value.length >= 2 &&
    (value[0] === '"' || value[0] === "'") &&
    value[value.length - 1] === value[0]
  ) {
    return value.slice(1, -1);
  }

  return value;
};

/*
 * Pure: config.env's lines in, the lines with every APP_TAG moved to its
 * enterprise- tag out, plus what changed. Nothing changes unless
 * IS_ENTERPRISE_EDITION is "true"; an empty APP_TAG and one that already
 * starts with "enterprise-" are left alone, so a second run changes nothing.
 * Comments and every other line are returned untouched.
 */
const pinEnterpriseImageTag = (lines) => {
  let isEnterpriseEditionRequested = false;

  for (const line of lines) {
    if (assignedKeyOf(line) === "IS_ENTERPRISE_EDITION") {
      isEnterpriseEditionRequested = unquotedValueOf(line) === "true";
    }
  }

  const changes = [];

  if (!isEnterpriseEditionRequested) {
    return { lines: [...lines], changes };
  }

  const pinnedLines = lines.map((line) => {
    if (assignedKeyOf(line) !== "APP_TAG") {
      return line;
    }

    const tag = unquotedValueOf(line);

    if (!tag || tag.toLowerCase().startsWith(ENTERPRISE_TAG_PREFIX)) {
      return line;
    }

    // Insert the prefix in front of the value, inside any opening quote.
    const valueStart = line.indexOf("=") + 1;
    const rawValue = line.slice(valueStart);
    const leadingWhitespace = rawValue.length - rawValue.trimStart().length;
    const opening = rawValue[leadingWhitespace];
    const insertAt =
      valueStart +
      leadingWhitespace +
      (opening === '"' || opening === "'" ? 1 : 0);

    changes.push({ from: tag, to: `${ENTERPRISE_TAG_PREFIX}${tag}` });

    return `${line.slice(0, insertAt)}${ENTERPRISE_TAG_PREFIX}${line.slice(insertAt)}`;
  });

  return { lines: pinnedLines, changes };
};

// The notice printed when pinEnterpriseImageTag changed APP_TAG.
const describeEnterpriseImageTagChanges = (changes) => {
  const changed = changes
    .map((change) => {
      return `${change.from} to ${change.to}`;
    })
    .join(", ");

  return (
    `IS_ENTERPRISE_EDITION=true in config.env, so APP_TAG was changed from ${changed} to keep the Enterprise Edition. ` +
    "The image APP_TAG pulls now decides the edition, and the Community image (APP_TAG=release) refuses to start with " +
    "IS_ENTERPRISE_EDITION=true rather than silently stop enforcing SSO, SCIM and audit logging. " +
    "The Enterprise Edition is licensed under the OneUptime Enterprise License (ee/LICENSE): production use requires " +
    "a subscription, and an unlicensed install runs a 14-day trial for evaluation. " +
    "To run the Community Edition instead, set IS_ENTERPRISE_EDITION=false and APP_TAG=release in config.env."
  );
};

/*
 * Pure: the template's and config.env's contents in, the merged config.env
 * out, plus what the merge carried over or changed. init() below does the
 * file I/O.
 */
const mergeEnvTemplate = (templateContents, envContents) => {
  const linesInTemplate = templateContents.split("\n");
  const linesInEnv = envContents.split("\n");

  const hasKey = (key) => {
    return linesInEnv.some((envLine) => {
      return envLine.split("=").length > 0 && keyOf(envLine) === key;
    });
  };

  const carriedOver = [];

  for (const line of linesInTemplate) {
    // this is a comment, ignore.
    if (line.startsWith("//")) {
      continue;
    }

    // comment. Ignore.
    if (line.startsWith("#")) {
      continue;
    }

    // if the line is present in template but is not present in env file then add it to the env file. We assume, values in template file are default values.
    if (line.split("=").length > 0) {
      const key = keyOf(line);

      if (hasKey(key)) {
        continue;
      }

      /*
       * The key is missing under its new name but present under its old one:
       * the user already has a value, and it is not ours to overwrite with a
       * template default.
       */
      const oldName = RENAMED_FROM[key];

      if (oldName && hasKey(oldName)) {
        carriedOver.push(`${oldName} (kept in place of ${key})`);
        continue;
      }

      linesInEnv.push(line);
    }
  }

  /*
   * After the merge, so an APP_TAG the merge just appended from the template
   * is moved to the Enterprise image too.
   */
  const pinned = pinEnterpriseImageTag(linesInEnv);

  return {
    contents: pinned.lines.join("\n"),
    carriedOver,
    imageTagChanges: pinned.changes,
  };
};

const init = () => {
  const tempate = fs.readFileSync("./config.example.env", "utf8");
  const env = fs.readFileSync("./config.env", "utf8");

  const merged = mergeEnvTemplate(tempate, env);

  if (merged.carriedOver.length > 0) {
    console.log(
      `Kept ${merged.carriedOver.length} renamed setting(s) at their existing values: ${merged.carriedOver.join(", ")}.`,
    );
  }

  if (merged.imageTagChanges.length > 0) {
    console.log(describeEnterpriseImageTagChanges(merged.imageTagChanges));
  }

  // write the file back to disk and exit.
  fs.writeFileSync("./config.env", merged.contents);
};

/*
 * Run as a script (`node ./Scripts/Install/MergeEnvTemplate.js` from the
 * repository root, by Scripts/Install/configure.sh and
 * packages/Home/Scripts/Install.sh). Requiring it, as the tests do, only
 * exports the pure functions.
 */
if (require.main === module) {
  init();
}

module.exports = {
  RENAMED_FROM,
  ENTERPRISE_TAG_PREFIX,
  pinEnterpriseImageTag,
  describeEnterpriseImageTagChanges,
  mergeEnvTemplate,
};
