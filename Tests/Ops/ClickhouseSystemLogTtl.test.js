"use strict";

/**
 * ClickHouse writes its own observability tables (system.query_log,
 * system.trace_log, …) forever unless a <ttl> is configured — the stock
 * config.xml ships every one of them commented out. The Helm path has capped
 * six of them at 6 hours (and removed processors_profile_log, which had reached
 * 536 GiB) since that incident; the docker-compose path had no cap at all.
 *
 * Clickhouse/config.d/system-log-ttl.xml closes that gap. These tests exist so
 * the two deployment paths can never silently drift apart again: the retention
 * settings are read out of BOTH HelmChart/Public/oneuptime/values.yaml and the
 * new drop-in, by parsing them, and compared table by table.
 *
 * They also pin the TTL *column*. Both files carried
 * `event_date + INTERVAL 6 HOUR DELETE`, which does not mean what it reads as:
 * event_date is a Date, so the interval is added to midnight of that day and
 * every row expires at 06:00 on its own date. See EXPECTED_TTL below.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const yaml = require("js-yaml");
const { parseXml, childText, XmlParseError } = require("./Utils/Xml.js");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DROP_IN_PATH = path.join(
  REPO_ROOT,
  "Clickhouse",
  "config.d",
  "system-log-ttl.xml",
);
const HELM_VALUES_PATH = path.join(
  REPO_ROOT,
  "HelmChart",
  "Public",
  "oneuptime",
  "values.yaml",
);
const COMPOSE_PATH = path.join(REPO_ROOT, "docker-compose.base.yml");

const DROP_IN_HOST_PATH = "./Clickhouse/config.d/system-log-ttl.xml";
const DROP_IN_CONTAINER_PATH =
  "/etc/clickhouse-server/config.d/system-log-ttl.xml";

/**
 * The retention expression both deployment paths must carry, verbatim.
 *
 * `event_time` — NOT `event_date` — is the entire point of the "never keys a
 * TTL off a Date column" test below, and both files shipped the wrong one for a
 * long time. Each of these six system tables has both columns: `event_date` is
 * a `Date` (day precision) and `event_time` is a `DateTime` (second precision;
 * see App/API/AdminHealth.ts, which reads `event_time` off system.query_log).
 * Adding an hour interval to a `Date` coerces it to midnight of that day, so
 * `event_date + INTERVAL 6 HOUR` expires every row at 06:00 on the row's OWN
 * date — a row flushed at 23:00 is born seventeen hours past its expiry and is
 * eligible for deletion on arrival. In steady state that discards nearly
 * everything written after 06:00, which is not the advertised 6 hour cap.
 */
const TTL_COLUMN = "event_time";
const EXPECTED_TTL = `${TTL_COLUMN} + INTERVAL 6 HOUR DELETE`;

/**
 * Date-precision columns. Adding whole DAYS to one of these is fine — the stock
 * Clickhouse/config.xml does it for asynchronous_insert_log and blob_storage_log
 * — but anything shorter than a day is swallowed by the coercion to midnight.
 */
const DATE_ONLY_COLUMNS = ["event_date"];

/** Interval units that a Date cannot express, so they must use a DateTime. */
const SUB_DAY_INTERVAL_UNITS = [
  "HOUR",
  "HOURS",
  "MINUTE",
  "MINUTES",
  "SECOND",
  "SECONDS",
];

const DROP_IN_LABEL =
  "docker-compose drop-in (Clickhouse/config.d/system-log-ttl.xml)";
const HELM_LABEL = "Helm (values.yaml -> clickhouse.configuration)";

/**
 * The tables that must stay capped no matter what. Set equality between the two
 * sources (below) stops them diverging; this list stops BOTH of them quietly
 * dropping a cap at the same time. Adding a seventh table to both files is fine.
 */
const TABLES_THAT_MUST_STAY_CAPPED = [
  "query_log",
  "trace_log",
  "text_log",
  "part_log",
  "metric_log",
  "asynchronous_metric_log",
];

/** Tables that must stay disabled outright (remove="1"), not merely capped. */
const TABLES_THAT_MUST_STAY_REMOVED = ["processors_profile_log"];

/**
 * The Helm `clickhouse.configuration` block is an envsubst template, so it is
 * not valid XML as written (`<${CLICKHOUSE_USER}>` is not a legal element name).
 * Rewrite the placeholders into legal names before parsing. This only touches
 * the <users> section; none of the system-log elements contain placeholders.
 */
function substituteEnvPlaceholders(xml) {
  return xml.replace(/\$\{([A-Za-z0-9_]+)\}/g, "envsubst_$1");
}

/**
 * Reads the system-log retention settings out of a parsed <clickhouse> root.
 * ClickHouse names every system-log table `<something_log>` at the top level of
 * the config, so that is the selector — it picks up new tables automatically
 * rather than needing this test updated.
 *
 * @returns {Map<string, object>} table name -> retention settings
 */
function readSystemLogSettings(root, sourceLabel) {
  expect(root.name).toBe("clickhouse");

  const settings = new Map();

  for (const child of root.children) {
    if (!child.name.endsWith("_log")) {
      continue;
    }
    if (settings.has(child.name)) {
      throw new Error(
        `${sourceLabel} declares <${child.name}> more than once; the last one silently wins in ClickHouse`,
      );
    }
    settings.set(child.name, {
      source: sourceLabel,
      removed: child.attributes.remove === "1",
      database: childText(child, "database"),
      table: childText(child, "table"),
      partitionBy: childText(child, "partition_by"),
      ttl: childText(child, "ttl"),
      flushIntervalMilliseconds: childText(
        child,
        "flush_interval_milliseconds",
      ),
      hasEngine: childText(child, "engine") !== undefined,
    });
  }

  return settings;
}

function sortedNames(settings) {
  return Array.from(settings.keys()).sort();
}

let dropInSource = null;
let dropInError = null;
let dropInSettings = new Map();
let helmSettings;
let composeDocument;

/** Parsed root of the drop-in; rethrows whatever stopped it loading. */
function dropInRoot() {
  if (dropInError !== null) {
    throw dropInError;
  }
  return parseXml(dropInSource, "Clickhouse/config.d/system-log-ttl.xml");
}

/**
 * Fails when a source parsed no system-log tables.
 *
 * Nearly every assertion in this file lives inside `for (const … of settings)`.
 * A loop over an empty Map executes its body zero times, so those tests report
 * PASS while asserting precisely nothing — which is what happened while an
 * unreadable drop-in was quietly swallowed into `new Map()`. Guarding the size
 * is what makes the caps, engine and shared-TTL tests load-bearing.
 */
function assertNonEmpty(settings, label) {
  const minimum =
    TABLES_THAT_MUST_STAY_CAPPED.length + TABLES_THAT_MUST_STAY_REMOVED.length;
  if (settings.size < minimum) {
    throw new Error(
      `${label} yielded ${settings.size} system-log tables, expected at least ${minimum}. ` +
        `Every assertion that loops over them would otherwise pass vacuously.`,
    );
  }
}

/**
 * The drop-in's parsed settings. Always read them through this rather than
 * touching `dropInSettings` directly: it rethrows a parse failure and refuses
 * to hand back an empty collection, so no loop below can silently no-op.
 */
function dropInTables() {
  if (dropInError !== null) {
    throw dropInError;
  }
  assertNonEmpty(dropInSettings, DROP_IN_LABEL);
  return dropInSettings;
}

/** As dropInTables(), for the Helm side. */
function helmTables() {
  assertNonEmpty(helmSettings, HELM_LABEL);
  return helmSettings;
}

beforeAll(() => {
  // A read error is fatal and must NOT be swallowed. This used to be inside the
  // try/catch below, which left an empty Map behind — and since the cap, engine
  // and shared-TTL assertions are all loops, a missing or unreadable drop-in
  // turned the entire file green. Let ENOENT/EACCES throw out of beforeAll so
  // every test in the file fails loudly with the real reason instead.
  dropInSource = fs.readFileSync(DROP_IN_PATH, "utf8");

  // A *parse* error is still captured rather than thrown, but only so the
  // "exists and is well-formed XML" test can report the parser's line/message
  // instead of every test dying with the same stack. It stays fatal everywhere
  // else: dropInTables() rethrows it before any loop gets to run.
  try {
    dropInSettings = readSystemLogSettings(dropInRoot(), DROP_IN_LABEL);
  } catch (error) {
    dropInError = error;
    dropInSettings = new Map();
  }

  const helmValues = yaml.load(fs.readFileSync(HELM_VALUES_PATH, "utf8"));
  helmSettings = readSystemLogSettings(
    parseXml(
      substituteEnvPlaceholders(helmValues.clickhouse.configuration),
      "values.yaml -> clickhouse.configuration",
    ),
    HELM_LABEL,
  );

  composeDocument = yaml.load(fs.readFileSync(COMPOSE_PATH, "utf8"));
});

describe("Clickhouse/config.d/system-log-ttl.xml", () => {
  test("exists and is well-formed XML", () => {
    expect(
      dropInError === null
        ? "Clickhouse/config.d/system-log-ttl.xml parses"
        : `Clickhouse/config.d/system-log-ttl.xml could not be parsed: ${dropInError.message}`,
    ).toBe("Clickhouse/config.d/system-log-ttl.xml parses");
    expect(fs.existsSync(DROP_IN_PATH)).toBe(true);
  });

  test("is rooted at <clickhouse> so config.d merging picks it up", () => {
    expect(dropInRoot().name).toBe("clickhouse");
  });

  test("the vacuity guard fires instead of passing when nothing parsed", () => {
    // Proves assertNonEmpty() is load-bearing. Without it, an unreadable or
    // gutted drop-in would leave an empty Map and every `for … of` assertion in
    // this file would report PASS having checked nothing at all.
    expect(() => {
      return assertNonEmpty(new Map(), "a source that parsed nothing");
    }).toThrow(/yielded 0 system-log tables/);
    expect(() => {
      return assertNonEmpty(
        new Map([["query_log", {}]]),
        "a source that parsed one table",
      );
    }).toThrow(/yielded 1 system-log tables/);
    // And the real collections do satisfy it.
    expect(dropInTables().size).toBeGreaterThanOrEqual(7);
    expect(helmTables().size).toBeGreaterThanOrEqual(7);
  });

  test("caps every system log it declares at exactly 6 hours", () => {
    for (const [table, entry] of dropInTables()) {
      if (entry.removed) {
        continue;
      }
      expect(`${table}: ${entry.ttl}`).toBe(`${table}: ${EXPECTED_TTL}`);
    }
  });

  test("keeps the six known-expensive tables capped", () => {
    for (const table of TABLES_THAT_MUST_STAY_CAPPED) {
      const entry = dropInTables().get(table);
      expect(
        entry === undefined
          ? `system.${table} has no retention block at all`
          : `system.${table} ttl=${entry.ttl}`,
      ).toBe(`system.${table} ttl=${EXPECTED_TTL}`);
      expect(entry.removed).toBe(false);
      expect(entry.database).toBe("system");
      expect(entry.table).toBe(table);
    }
  });

  test("keeps processors_profile_log disabled outright rather than capped", () => {
    for (const table of TABLES_THAT_MUST_STAY_REMOVED) {
      const entry = dropInTables().get(table);
      expect(entry).toBeDefined();
      expect(entry.removed).toBe(true);
      // A removed element must not also try to configure the table.
      expect(entry.ttl).toBeUndefined();
      expect(entry.partitionBy).toBeUndefined();
    }
  });

  test("never pairs <engine> with <partition_by> (ClickHouse 25.7+ BAD_ARGUMENTS crash-loop)", () => {
    for (const [table, entry] of dropInTables()) {
      if (entry.hasEngine && entry.partitionBy !== undefined) {
        throw new Error(
          `<${table}> declares both <engine> and <partition_by>. ClickHouse 25.7+ rejects that ` +
            `("If 'engine' is specified … partition_by doesn't make sense", BAD_ARGUMENTS) and the ` +
            `server crash-loops on boot. Put the retention inside the engine expression instead.`,
        );
      }
    }
  });

  test("rejects malformed XML (the parser is not a regex)", () => {
    expect(() => {
      return parseXml("<clickhouse><query_log></clickhouse>", "broken.xml");
    }).toThrow(XmlParseError);
    expect(() => {
      return parseXml("<clickhouse/><extra/>", "broken.xml");
    }).toThrow(XmlParseError);
    expect(() => {
      return parseXml("<clickhouse><a remove=1/></clickhouse>", "broken.xml");
    }).toThrow(XmlParseError);
  });
});

describe("docker-compose and Helm system-log retention stay in lockstep", () => {
  test("both paths cap exactly the same set of system-log tables", () => {
    const compose = dropInTables();
    const helm = helmTables();
    const composeNames = sortedNames(compose);
    const helmNames = sortedNames(helm);

    const missingFromCompose = helmNames.filter((table) => {
      return !compose.has(table);
    });
    const missingFromHelm = composeNames.filter((table) => {
      return !helm.has(table);
    });

    expect(
      [
        missingFromCompose.length > 0
          ? `Capped in Helm (values.yaml -> clickhouse.configuration) but NOT in Clickhouse/config.d/system-log-ttl.xml: ${missingFromCompose.join(", ")}`
          : null,
        missingFromHelm.length > 0
          ? `Capped in Clickhouse/config.d/system-log-ttl.xml but NOT in Helm (values.yaml -> clickhouse.configuration): ${missingFromHelm.join(", ")}`
          : null,
      ]
        .filter(Boolean)
        .join(" | "),
    ).toBe("");
  });

  test.each(TABLES_THAT_MUST_STAY_CAPPED.concat(TABLES_THAT_MUST_STAY_REMOVED))(
    "system.%s is configured identically in both paths",
    (table) => {
      const composeEntry = dropInTables().get(table);
      const helmEntry = helmTables().get(table);

      expect(composeEntry).toBeDefined();
      expect(helmEntry).toBeDefined();

      // `source` differs by construction; everything else — database, table,
      // partition_by, ttl, flush interval, remove="1" — must match exactly.
      const normalise = (entry) => {
        const copy = Object.assign({}, entry);
        delete copy.source;
        return copy;
      };

      expect(normalise(composeEntry)).toEqual(normalise(helmEntry));
    },
  );

  test("the shared TTL really is 6 hours from a DateTime column in both files, not just equal to each other", () => {
    for (const settings of [dropInTables(), helmTables()]) {
      for (const [table, entry] of settings) {
        if (entry.removed) {
          continue;
        }
        // The column is captured, not hard-coded into the pattern: pinning only
        // the "6 HOUR" half is what let `event_date + INTERVAL 6 HOUR DELETE`
        // sit in both files looking correct while retaining almost nothing.
        const match = /^(\w+) \+ INTERVAL (\d+) (\w+) DELETE$/.exec(
          entry.ttl || "",
        );
        expect(
          match === null
            ? `${entry.source} system.${table} ttl="${entry.ttl}" is not a "<column> + INTERVAL n UNIT DELETE" expression`
            : `${entry.source} system.${table} ${match[1]} ${match[2]} ${match[3]}`,
        ).toBe(`${entry.source} system.${table} ${TTL_COLUMN} 6 HOUR`);
      }
    }
  });

  test("never combines a Date column with a sub-day interval", () => {
    // The precise invariant, rather than a blanket ban on event_date: adding
    // DAYS to a Date is perfectly sound (the stock Clickhouse/config.xml does
    // exactly that for asynchronous_insert_log and blob_storage_log). It is
    // sub-day units that are the trap, because the Date silently becomes
    // midnight and the whole interval is swallowed by the truncation.
    for (const settings of [dropInTables(), helmTables()]) {
      for (const [table, entry] of settings) {
        if (entry.removed) {
          continue;
        }
        const match = /^(\w+) \+ INTERVAL \d+ (\w+)/.exec(String(entry.ttl));
        expect(
          match === null
            ? `${entry.source} system.${table} ttl="${entry.ttl}" is not a "<column> + INTERVAL n UNIT" expression`
            : "parsed",
        ).toBe("parsed");

        const column = match[1];
        const unit = match[2].toUpperCase();
        const trapped =
          DATE_ONLY_COLUMNS.includes(column) &&
          SUB_DAY_INTERVAL_UNITS.includes(unit);

        expect(
          trapped
            ? `${entry.source} system.${table} ttl="${entry.ttl}" adds a sub-day interval to ` +
                `${column}, a Date. The Date is coerced to midnight, so every row expires at a ` +
                `fixed clock time on its OWN date rather than that far after it was written — a ` +
                `row flushed at 23:00 is already expired on arrival, and in steady state almost ` +
                `nothing survives a merge. Use ${TTL_COLUMN} (DateTime) for sub-day intervals.`
            : `${entry.source} system.${table} ttl unit ${unit} is safe for column ${column}`,
        ).toBe(
          `${entry.source} system.${table} ttl unit ${unit} is safe for column ${column}`,
        );
      }
    }
  });
});

describe("docker-compose.base.yml clickhouse service", () => {
  test("mounts the drop-in at the config.d path ClickHouse reads", () => {
    const volumes = composeDocument.services.clickhouse.volumes;
    expect(volumes).toContain(`${DROP_IN_HOST_PATH}:${DROP_IN_CONTAINER_PATH}`);
  });

  test("the mounted host file actually exists (docker would silently create a directory otherwise)", () => {
    const volumes = composeDocument.services.clickhouse.volumes;
    const mount = volumes.find((volume) => {
      return volume.endsWith(`:${DROP_IN_CONTAINER_PATH}`);
    });
    expect(mount).toBeDefined();

    const hostPath = mount.slice(
      0,
      mount.length - DROP_IN_CONTAINER_PATH.length - 1,
    );
    expect(fs.existsSync(path.join(REPO_ROOT, hostPath))).toBe(true);
    expect(fs.statSync(path.join(REPO_ROOT, hostPath)).isFile()).toBe(true);
  });

  test("does not disturb the existing cluster and users.d drop-ins", () => {
    const volumes = composeDocument.services.clickhouse.volumes;
    expect(volumes).toContain("clickhouse:/var/lib/clickhouse/");
    expect(volumes).toContain(
      "./Clickhouse/config.d/cluster.xml:/etc/clickhouse-server/config.d/cluster.xml",
    );
    expect(volumes).toContain(
      "./Clickhouse/users.d/distributed-insert-tuning.xml:/etc/clickhouse-server/users.d/distributed-insert-tuning.xml",
    );
  });

  test("mounts every Clickhouse/config.d file the repo ships", () => {
    const volumes = composeDocument.services.clickhouse.volumes;
    const mountedTargets = new Set(
      volumes.map((volume) => {
        return volume.split(":")[1];
      }),
    );

    const shippedFiles = fs
      .readdirSync(path.join(REPO_ROOT, "Clickhouse", "config.d"))
      .filter((name) => {
        return name.endsWith(".xml");
      });

    for (const name of shippedFiles) {
      expect(
        mountedTargets.has(`/etc/clickhouse-server/config.d/${name}`)
          ? name
          : `${name} is in Clickhouse/config.d but is not mounted by the clickhouse service in docker-compose.base.yml, so it does nothing`,
      ).toBe(name);
    }
  });
});

describe("external validators", () => {
  const xmllint = (() => {
    try {
      execFileSync("xmllint", ["--version"], { stdio: "ignore" });
      return true;
    } catch (error) {
      return false;
    }
  })();

  // Cross-checks our own parser against libxml2 where it is available (it ships
  // with macOS and most Linux images). Skipped rather than failed when absent.
  const maybe = xmllint ? test : test.skip;

  maybe("xmllint agrees the drop-in is well-formed", () => {
    execFileSync("xmllint", ["--noout", DROP_IN_PATH], { stdio: "pipe" });
  });
});
