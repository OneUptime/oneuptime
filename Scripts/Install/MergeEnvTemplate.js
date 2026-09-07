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

const keyOf = (line) => {
  return line.split("=")[0];
};

const init = () => {
  const tempate = fs.readFileSync("./config.example.env", "utf8");
  const env = fs.readFileSync("./config.env", "utf8");

  const linesInTemplate = tempate.split("\n");
  const linesInEnv = env.split("\n");

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

  if (carriedOver.length > 0) {
    console.log(
      `Kept ${carriedOver.length} renamed setting(s) at their existing values: ${carriedOver.join(", ")}.`,
    );
  }

  // write the file back to disk and exit.
  fs.writeFileSync("./config.env", linesInEnv.join("\n"));
};

init();
