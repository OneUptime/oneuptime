/*
 * Is OneUptime's time zone data as new as IANA's latest tz database release?
 *
 *   node Scripts/TimeZoneData/CheckTimeZoneData.js [--output <directory>]
 *
 * OneUptime computes and shows times with four copies of the tz database,
 * each updated on its own schedule (issue #9999: British Columbia moved to
 * permanent UTC-7 in tzdata 2026b, and OneUptime still carried 2024b seven
 * months later):
 *
 *   - moment-timezone's bundled data (packages/Common), which works out
 *     every rotation, handoff, restriction, maintenance window, report and
 *     summary, on the server and in the browser bundles;
 *   - the ICU inside Node.js in each image's base (the Dockerfile.tpl FROM
 *     lines), which writes dates in the reader's language on the server;
 *   - ClickHouse's built-in data, which cuts charts' days in the reader's
 *     zone (docker-compose.base.yml's image, as the Helm chart pins too);
 *   - the zoneinfo in the Postgres image, which cuts a status page's uptime
 *     days in the visitor's zone (docker-compose.base.yml's image).
 *
 * It reads IANA's latest release (data.iana.org), the release each copy
 * carries (moment's from the npm package the lockfile pins, the others by
 * running the images), and writes check.json and issue.md to --output
 * (default output/time-zone-data). It exits 1 when a copy has been behind
 * for longer than GRACE_DAYS since IANA published the release it lacks, or
 * could not be read; upstream projects need a few weeks to ship a release,
 * and the issue ReportTimeZoneData.js keeps lists every copy behind from
 * the first day.
 *
 * Plain CommonJS with no dependencies: the Time Zone Data workflow runs it
 * on a bare runner. Its pure functions are exported for
 * Tests/Ops/TimeZoneData.test.js.
 */
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPOSITORY = path.resolve(__dirname, "..", "..");

// How long a copy may lag IANA's latest release before the check fails.
const GRACE_DAYS = 30;

const IANA_VERSION_URL = "https://data.iana.org/time-zones/tzdb/version";
const IANA_NEWS_URL = "https://data.iana.org/time-zones/tzdb/NEWS";

const DAY_MS = 24 * 60 * 60 * 1000;

const RELEASE = /^(\d{4})([a-z]+)$/;

// A release ("2026f") as its year and letters, or null.
function parseRelease(version) {
  const match = RELEASE.exec(String(version || "").trim());

  if (!match) {
    return null;
  }

  return { year: Number(match[1]), letters: match[2] };
}

/*
 * -1, 0 or 1 as release `a` is older than, the same as or newer than `b`.
 * Releases are a year and letters: 2026f after 2026b, 2027a after 2026z.
 */
function compareReleases(a, b) {
  const left = parseRelease(a);
  const right = parseRelease(b);

  if (!left || !right) {
    throw new Error(`Not a tz database release: ${!left ? a : b}`);
  }

  if (left.year !== right.year) {
    return left.year < right.year ? -1 : 1;
  }

  if (left.letters.length !== right.letters.length) {
    return left.letters.length < right.letters.length ? -1 : 1;
  }

  if (left.letters === right.letters) {
    return 0;
  }

  return left.letters < right.letters ? -1 : 1;
}

/*
 * IANA's latest release and the day it was published, from the tzdb
 * directory's `version` file and the first "Release" line of its NEWS:
 * "Release 2026f - 2026-10-27 23:16:49 -0700".
 */
function readIanaRelease(versionText, newsText) {
  const version = String(versionText || "").trim();

  if (!parseRelease(version)) {
    throw new Error(`IANA's version file does not name a release: ${version}`);
  }

  const line = new RegExp(
    `^Release ${version} - (\\d{4}-\\d{2}-\\d{2})(?: (\\d{2}:\\d{2}:\\d{2}) ([+-]\\d{4}))?`,
    "m",
  ).exec(String(newsText || ""));

  if (!line) {
    throw new Error(`IANA's NEWS has no line for release ${version}.`);
  }

  const zone = line[3] ? `${line[3].slice(0, 3)}:${line[3].slice(3)}` : "Z";
  const published = new Date(`${line[1]}T${line[2] || "00:00:00"}${zone}`);

  // The day as IANA dates it, and the instant, for the grace period.
  return {
    version: version,
    date: line[1],
    published: published.toISOString(),
  };
}

// The moment-timezone version packages/Common's lockfile installs.
function momentTimezoneVersionFromLockfile(lockfileText) {
  const lockfile = JSON.parse(lockfileText);
  const entry = (lockfile.packages || {})["node_modules/moment-timezone"];

  if (!entry || !entry.version) {
    throw new Error(
      "packages/Common/package-lock.json has no moment-timezone.",
    );
  }

  return entry.version;
}

const NODE_FROM = /^\s*FROM\s+(?:--platform=\S+\s+)?(\S*\/node:[^\s@]+)/gim;

// Every Node.js base image the Dockerfile templates build from.
function nodeImagesFromDockerfiles(dockerfileTexts) {
  const images = new Set();

  for (const text of dockerfileTexts) {
    for (const match of String(text).matchAll(NODE_FROM)) {
      images.add(match[1]);
    }
  }

  return [...images].sort();
}

// The image a Compose service runs: "clickhouse" -> its `image:`.
function composeImage(composeText, service) {
  const lines = String(composeText).split("\n");
  const start = lines.findIndex((line) => {
    return new RegExp(`^  ${service}:\\s*$`).test(line);
  });

  if (start === -1) {
    throw new Error(`docker-compose.base.yml has no service ${service}.`);
  }

  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index];

    if (/^  \S/.test(line)) {
      break;
    }

    const image = /^\s{4}image:\s*["']?([^\s"']+)/.exec(line);

    if (image) {
      return image[1];
    }
  }

  throw new Error(`docker-compose.base.yml's ${service} names no image.`);
}

// "# version 2026f", the first line of zoneinfo's tzdata.zi -> "2026f".
function releaseFromTzdataZi(firstLine) {
  const match = /^#\s*version\s+(\S+)/.exec(String(firstLine || "").trim());

  return match ? match[1] : null;
}

/*
 * Each copy against IANA's latest: "current", "behind" (still within the
 * grace period) or "overdue" (behind for longer), or "unread" when the check
 * could not read it.
 */
function assess(data) {
  const now = new Date(data.now).getTime();
  const published = new Date(data.latest.published).getTime();
  const overdueAfter = published + data.graceDays * DAY_MS;

  const sources = data.sources.map((source) => {
    if (!source.release || !parseRelease(source.release)) {
      return { ...source, status: "unread" };
    }

    if (compareReleases(source.release, data.latest.version) >= 0) {
      return { ...source, status: "current" };
    }

    return { ...source, status: now > overdueAfter ? "overdue" : "behind" };
  });

  const lagging = sources.filter((source) => {
    return source.status === "behind" || source.status === "overdue";
  });

  return {
    latest: data.latest,
    graceDays: data.graceDays,
    failsFrom: new Date(overdueAfter).toISOString(),
    sources: sources,
    lagging: lagging.length,
    fails: sources.some((source) => {
      return source.status === "overdue" || source.status === "unread";
    }),
  };
}

const STATUS_WORDS = {
  current: "Current",
  behind: "Behind",
  overdue: "Behind for too long",
  unread: "Could not be read",
};

// The issue's text: every copy, its release, and how to bring it up to date.
function issueBody(check) {
  const lines = [
    `IANA's latest time zone database release is **${check.latest.version}**, of ${check.latest.date}. ${check.lagging} of the ${check.sources.length} copies of the tz database OneUptime computes and shows times with ${check.lagging === 1 ? "is" : "are"} older.`,
    "",
    "| Copy | What it does | Release | Status |",
    "| --- | --- | --- | --- |",
  ];

  for (const source of check.sources) {
    lines.push(
      `| ${source.name} | ${source.role} | ${source.release || "?"} | ${STATUS_WORDS[source.status]} |`,
    );
  }

  lines.push("");
  lines.push(
    `A copy behind IANA's latest release computes or shows times wrong wherever that release changed a zone's rules (see the release notes: https://www.iana.org/time-zones). The Time Zone Data workflow fails from ${check.failsFrom.slice(0, 10)} (${check.graceDays} days after the release) while a copy is still behind, and closes this issue once every copy is current.`,
  );

  const lagging = check.sources.filter((source) => {
    return source.status !== "current";
  });

  if (lagging.length > 0) {
    lines.push("");
    lines.push("### How to update them");
    lines.push("");

    // One line per way to update: the Node.js images share theirs.
    const byUpdate = new Map();

    for (const source of lagging) {
      byUpdate.set(source.update, [
        ...(byUpdate.get(source.update) || []),
        source,
      ]);
    }

    for (const [update, sources] of byUpdate) {
      const names = sources
        .map((source) => {
          return `**${source.name}**`;
        })
        .join(", ");

      lines.push(`- ${names} (${sources[0].where}): ${update}`);
    }
  }

  lines.push("");
  lines.push(
    "The tests that pin British Columbia's 2026b change in each copy (issue #9999): `packages/Common/Tests/Types/TimezoneBritishColumbia.test.ts`, `packages/App/Tests/Telemetry/BritishColumbiaZoneClickhouse.test.ts` and `packages/Common/Tests/Server/Services/MonitorStatusTimelineBritishColumbiaPostgres.test.ts`.",
  );

  return `${lines.join("\n")}\n`;
}

// ---- Reading the copies: the network and Docker, run by main() only.

function run(command, args, options = {}) {
  return childProcess
    .execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10 * 60 * 1000,
      ...options,
    })
    .trim();
}

async function fetchText(url) {
  const response = await fetch(url, { redirect: "follow" });

  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}.`);
  }

  return await response.text();
}

// The tz release a moment-timezone version bundles, from its npm package.
function momentDataRelease(version) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "moment-tz-"));

  try {
    const tarball = run(
      "npm",
      [
        "pack",
        `moment-timezone@${version}`,
        "--silent",
        "--pack-destination",
        directory,
      ],
      { cwd: directory },
    )
      .split("\n")
      .pop();

    run(
      "tar",
      [
        "-xzf",
        path.join(directory, tarball),
        "-C",
        directory,
        "package/data/packed/latest.json",
      ],
      { cwd: directory },
    );

    const data = JSON.parse(
      fs.readFileSync(
        path.join(directory, "package", "data", "packed", "latest.json"),
        "utf8",
      ),
    );

    return data.version;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function dockerRun(image, entrypoint, args) {
  return run("docker", [
    "run",
    "--rm",
    "--pull",
    "always",
    "--entrypoint",
    entrypoint,
    image,
    ...args,
  ]);
}

function dockerfileTemplates() {
  const found = [];

  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) {
        continue;
      }

      const full = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name === "Dockerfile.tpl") {
        found.push(full);
      }
    }
  };

  walk(REPOSITORY);

  return found.sort();
}

// What to read, and how to read it.
function sourcesToRead() {
  const lockfile = fs.readFileSync(
    path.join(REPOSITORY, "packages", "Common", "package-lock.json"),
    "utf8",
  );
  const compose = fs.readFileSync(
    path.join(REPOSITORY, "docker-compose.base.yml"),
    "utf8",
  );
  const momentVersion = momentTimezoneVersionFromLockfile(lockfile);
  const nodeImages = nodeImagesFromDockerfiles(
    dockerfileTemplates().map((file) => {
      return fs.readFileSync(file, "utf8");
    }),
  );
  const clickhouseImage = composeImage(compose, "clickhouse");
  const postgresImage = composeImage(compose, "postgres");

  return [
    {
      name: `moment-timezone ${momentVersion}`,
      role: "Every rotation, handoff, restriction, maintenance window, report and summary, on the server and in the browser",
      where: "packages/Common/package.json",
      update:
        "bump moment-timezone to the first release whose changelog says it carries the new release (https://github.com/moment/moment-timezone/blob/develop/changelog.md), in packages/Common/package.json and the lockfile of every package that links Common.",
      read: () => {
        return momentDataRelease(momentVersion);
      },
    },
    ...nodeImages.map((image) => {
      return {
        name: `Node.js in ${image}`,
        role: "Dates written in the reader's language on the server (Intl)",
        where: "the Dockerfile.tpl FROM lines",
        update:
          'wait for a Node.js release of this major line with the new tz data (its changelog says "update timezone"); the images take it when they are next built, as they float on the major line.',
        read: () => {
          return dockerRun(image, "node", ["-p", "process.versions.tz"]);
        },
      };
    }),
    {
      name: `ClickHouse ${clickhouseImage.split(":").pop()}`,
      role: "Charts' days, weeks and months in the reader's zone",
      where: "docker-compose.base.yml, HelmChart/Public/oneuptime/values.yaml",
      update:
        "move the pin to a ClickHouse patch whose TZDATA_VERSION (SELECT value FROM system.build_options WHERE name = 'TZDATA_VERSION') is the new release, in docker-compose.base.yml, the Helm chart's clickhouse and clickhouseOperator images, .github/workflows/test.app.yaml and .oss-scanner/Dockerfile.",
      read: () => {
        return dockerRun(clickhouseImage, "clickhouse", [
          "local",
          "-q",
          "SELECT value FROM system.build_options WHERE name = 'TZDATA_VERSION'",
        ]);
      },
    },
    {
      name: `Postgres ${postgresImage.split(":").pop()}`,
      role: "A status page's uptime days in the visitor's zone",
      where: "docker-compose.base.yml",
      update:
        "wait for the postgres image to be rebuilt with Debian's new tzdata package (it is, within weeks); people running OneUptime pull it with their next upgrade.",
      read: () => {
        return releaseFromTzdataZi(
          dockerRun(postgresImage, "sh", [
            "-c",
            "head -n 1 /usr/share/zoneinfo/tzdata.zi",
          ]),
        );
      },
    },
  ];
}

async function main() {
  const outputIndex = process.argv.indexOf("--output");
  const output =
    outputIndex !== -1 && process.argv[outputIndex + 1]
      ? path.resolve(process.argv[outputIndex + 1])
      : path.join(REPOSITORY, "output", "time-zone-data");

  const latest = readIanaRelease(
    await fetchText(IANA_VERSION_URL),
    await fetchText(IANA_NEWS_URL),
  );

  const sources = sourcesToRead().map((source) => {
    let release = null;
    let error = null;

    try {
      release = String(source.read() || "").trim() || null;
    } catch (caught) {
      error = String((caught && caught.message) || caught).slice(0, 500);
    }

    const { read, ...rest } = source;

    return { ...rest, release: release, error: error };
  });

  const check = assess({
    latest: latest,
    sources: sources,
    now: new Date().toISOString(),
    graceDays: GRACE_DAYS,
  });

  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(
    path.join(output, "check.json"),
    `${JSON.stringify(check, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(output, "issue.md"), issueBody(check));

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, issueBody(check));
  }

  for (const source of check.sources) {
    console.log(
      `${STATUS_WORDS[source.status].padEnd(19)} ${source.release || "?"}  ${source.name}${source.error ? ` (${source.error})` : ""}`,
    );
  }

  console.log(`IANA's latest release: ${latest.version} (${latest.date}).`);

  if (check.fails) {
    console.error(
      `A copy of the tz database is behind ${latest.version} for more than ${GRACE_DAYS} days, or could not be read: see ${path.join(output, "issue.md")}.`,
    );
    process.exitCode = 1;
  }
}

module.exports = {
  GRACE_DAYS,
  assess,
  compareReleases,
  composeImage,
  issueBody,
  momentTimezoneVersionFromLockfile,
  nodeImagesFromDockerfiles,
  parseRelease,
  readIanaRelease,
  releaseFromTzdataZi,
  sourcesToRead,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
