"use strict";

/**
 * Every deployment path runs the bundled ClickHouse's logger at one level.
 *
 * The ClickHouse image logs at trace: every query, every merge and every
 * Keeper step goes to the server's log files and again into system.text_log
 * - about 250 MB of log text and over a million text_log rows an hour on a
 * compose install with a few dozen projects, and a share of the server's CPU
 * at idle. Helm has always run it at warning, on both of its paths (the
 * built-in StatefulSet's clickhouse.configuration and the Altinity
 * operator's clickhouseOperator.altinity.settings); compose ran the image's
 * trace until Clickhouse/config.d/logger.xml.
 *
 * Held here: the compose drop-in mounts where ClickHouse reads it and sets
 * only the logger level; the three paths name the same level; and that
 * level still writes warnings and errors, which is all the Admin Health page
 * reads from system.text_log (App/API/AdminHealthProbes.ts).
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { parseXml, childrenNamed, childText } = require("./Utils/Xml.js");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DROP_IN = "Clickhouse/config.d/logger.xml";
const DROP_IN_MOUNT = `./${DROP_IN}:/etc/clickhouse-server/config.d/logger.xml`;

// ClickHouse's levels, most to least verbose (Poco's, as ClickHouse names them).
const LEVELS = [
  "test",
  "trace",
  "debug",
  "information",
  "notice",
  "warning",
  "error",
  "critical",
  "fatal",
  "none",
];

// The levels the Admin Health page reads text_log rows of.
const READ_BY_ADMIN_HEALTH = ["fatal", "critical", "error", "warning"];

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

// ${CLICKHOUSE_USER}-style placeholders are not XML names: make them so.
function substituteEnvPlaceholders(xml) {
  return xml.replace(/\$\{([A-Za-z0-9_]+)\}/g, "envsubst_$1");
}

function loggerLevelOf(root) {
  expect(root.name).toBe("clickhouse");

  const loggers = childrenNamed(root, "logger");

  expect(loggers).toHaveLength(1);

  return childText(loggers[0], "level");
}

function composeLevel() {
  return loggerLevelOf(parseXml(read(DROP_IN), DROP_IN));
}

function helmValues() {
  return yaml.load(read("HelmChart/Public/oneuptime/values.yaml"));
}

function builtInHelmLevel() {
  return loggerLevelOf(
    parseXml(
      substituteEnvPlaceholders(helmValues().clickhouse.configuration),
      "values.yaml -> clickhouse.configuration",
    ),
  );
}

function operatorHelmLevel() {
  return helmValues().clickhouseOperator.altinity.settings["logger/level"];
}

describe("Clickhouse/config.d/logger.xml", () => {
  test("is mounted where ClickHouse reads config.d, by the compose service", () => {
    const compose = yaml.load(read("docker-compose.base.yml"));

    expect(compose.services.clickhouse.volumes).toContain(DROP_IN_MOUNT);
    expect(fs.statSync(path.join(REPO_ROOT, DROP_IN)).isFile()).toBe(true);
  });

  test("sets the logger's level and nothing else", () => {
    const root = parseXml(read(DROP_IN), DROP_IN);

    expect(
      root.children.map((child) => {
        return child.name;
      }),
    ).toEqual(["logger"]);
    expect(
      childrenNamed(root, "logger")[0].children.map((child) => {
        return child.name;
      }),
    ).toEqual(["level"]);
    expect(LEVELS).toContain(composeLevel());
  });

  test("is no more verbose than warning: the image's trace is gone", () => {
    expect(LEVELS.indexOf(composeLevel())).toBeGreaterThanOrEqual(
      LEVELS.indexOf("warning"),
    );
  });

  test("still writes everything the Admin Health page reads from text_log", () => {
    const level = LEVELS.indexOf(composeLevel());

    for (const readLevel of READ_BY_ADMIN_HEALTH) {
      expect({
        level: composeLevel(),
        writes: readLevel,
        written: LEVELS.indexOf(readLevel) >= level,
      }).toEqual({
        level: composeLevel(),
        writes: readLevel,
        written: true,
      });
    }

    // The page's query still names exactly those levels.
    expect(read("packages/App/API/AdminHealthProbes.ts")).toContain(
      "level IN ('Fatal','Critical','Error','Warning')",
    );
  });
});

describe("one logger level on every path", () => {
  test("compose, Helm's built-in ClickHouse and the Altinity operator agree", () => {
    expect({
      compose: composeLevel(),
      helmBuiltIn: builtInHelmLevel(),
      helmOperator: operatorHelmLevel(),
    }).toEqual({
      compose: "warning",
      helmBuiltIn: "warning",
      helmOperator: "warning",
    });
  });
});
