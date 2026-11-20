"use strict";

/**
 * The Time Zone Data workflow (issue #9999): is OneUptime's time zone data
 * as new as IANA's latest tz database release?
 *
 * British Columbia moved to permanent UTC-7 in tzdata 2026b (April 2026),
 * and OneUptime still carried 2024b in November, an hour off for everyone
 * there; nothing said its copies of the tz database had fallen behind.
 * Scripts/TimeZoneData/CheckTimeZoneData.js reads IANA's latest release
 * and the one each copy carries, and ReportTimeZoneData.js keeps one issue
 * that lists every copy behind:
 *
 *   - releases order by year, then letters (2026f after 2026b, 2027a after
 *     2026z), and IANA's release and its date are read from its version
 *     file and NEWS;
 *   - a copy behind is "behind" for the grace period after IANA published
 *     the release, then "overdue", which fails the run, as does a copy
 *     that could not be read;
 *   - the issue opens on the first day a copy is behind, is rewritten while
 *     one is, and closes once every copy is current; only an issue with
 *     exactly its title counts;
 *   - the copies read are every Node.js base image the Dockerfile
 *     templates build from, the moment-timezone the Common lockfile pins,
 *     and docker-compose.base.yml's ClickHouse - not its Postgres, which
 *     cuts nothing in a zone (a status page's days reach it as instants,
 *     #10039).
 *
 * And the workflow around them: weekly and by hand, the report on main
 * only and the only job that may write issues. Nothing here reaches the
 * network or Docker.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const yaml = require("js-yaml");
const {
  GRACE_DAYS,
  assess,
  compareReleases,
  composeImage,
  issueBody,
  momentTimezoneVersionFromLockfile,
  nodeImagesFromDockerfiles,
  parseRelease,
  readIanaRelease,
  sourcesToRead,
} = require("../../Scripts/TimeZoneData/CheckTimeZoneData.js");
const {
  ISSUE_LABELS,
  ISSUE_TITLE,
  findOpenIssue,
  issueAction,
  reportTimeZoneData,
} = require("../../Scripts/TimeZoneData/ReportTimeZoneData.js");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOW = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "time-zone-data.yml",
);

const NEWS = [
  "News for the tz database",
  "",
  "Release 2026f - 2026-10-27 23:16:49 -0700",
  "",
  "  Briefly:",
  "    Cuba will not fall back 2026-11-01; stays on -04 through 2027-11-07.",
  "",
  "Release 2026e - 2026-09-29 10:01:02 -0700",
  "",
  "Release 2026b - 2026-04-22 12:00:00 -0700",
  "",
  "    British Columbia moved to permanent -07 on 2026-03-09.",
].join("\n");

const LATEST = {
  version: "2026f",
  date: "2026-10-27",
  published: "2026-10-28T06:16:49.000Z",
};

function source(name, release) {
  return {
    name: name,
    role: `${name}'s role`,
    where: `${name}'s place`,
    update: `update ${name}`,
    release: release,
    error: release ? null : "docker: not found",
  };
}

function checkOf(sources, now) {
  return assess({
    latest: LATEST,
    sources: sources,
    now: now,
    graceDays: GRACE_DAYS,
  });
}

// A fake gh: answers `issue list` with `issues`, records every call.
function fakeGh(issues) {
  const calls = [];
  const gh = (args) => {
    calls.push(args);

    if (args[0] === "issue" && args[1] === "list") {
      return JSON.stringify(issues);
    }

    return "";
  };

  return { gh, calls };
}

describe("tz database releases", () => {
  test("read as a year and letters, and nothing else", () => {
    expect(parseRelease("2026f")).toEqual({ year: 2026, letters: "f" });
    expect(parseRelease(" 2024b\n")).toEqual({ year: 2024, letters: "b" });
    expect(parseRelease("2026")).toBeNull();
    expect(parseRelease("f")).toBeNull();
    expect(parseRelease("")).toBeNull();
    expect(parseRelease(null)).toBeNull();
    expect(parseRelease("2026F")).toBeNull();
  });

  test.each([
    ["2026b", "2026f", -1],
    ["2026f", "2026b", 1],
    ["2026f", "2026f", 0],
    ["2025z", "2026a", -1],
    ["2027a", "2026z", 1],
    ["2024b", "2026b", -1],
    // A release past z, should one come: longer letters are later.
    ["2026z", "2026aa", -1],
  ])("%s against %s is %i", (a, b, expected) => {
    expect(compareReleases(a, b)).toBe(expected);
  });

  test("a value that is not a release is refused, not ordered", () => {
    expect(() => {
      return compareReleases("2026f", "latest");
    }).toThrow("Not a tz database release: latest");
  });

  test("IANA's latest release is its version file's, dated by its NEWS line", () => {
    expect(readIanaRelease("2026f\n", NEWS)).toEqual(LATEST);
    expect(readIanaRelease("2026b", NEWS)).toEqual({
      version: "2026b",
      date: "2026-04-22",
      published: "2026-04-22T19:00:00.000Z",
    });
  });

  test("a version file that names no release, or no NEWS line for it, is an error", () => {
    expect(() => {
      return readIanaRelease("<html>", NEWS);
    }).toThrow("IANA's version file does not name a release");
    expect(() => {
      return readIanaRelease("2027a", NEWS);
    }).toThrow("IANA's NEWS has no line for release 2027a.");
  });
});

describe("what the check reads", () => {
  test("moment-timezone's version is the one packages/Common's lockfile installs", () => {
    const lockfile = fs.readFileSync(
      path.join(REPO_ROOT, "packages", "Common", "package-lock.json"),
      "utf8",
    );
    const packageJson = JSON.parse(
      fs.readFileSync(
        path.join(REPO_ROOT, "packages", "Common", "package.json"),
        "utf8",
      ),
    );

    const version = momentTimezoneVersionFromLockfile(lockfile);

    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(packageJson.dependencies["moment-timezone"]).toBe(`^${version}`);
    expect(() => {
      return momentTimezoneVersionFromLockfile('{"packages": {}}');
    }).toThrow("no moment-timezone");
  });

  test("the Node.js images are every FROM of a node image, once each", () => {
    expect(
      nodeImagesFromDockerfiles([
        "FROM public.ecr.aws/docker/library/node:26-alpine3.24 AS base\nRUN x\nFROM public.ecr.aws/docker/library/node:26-alpine3.24 AS runtime",
        "# FROM node:1 in a comment is not one\nFROM public.ecr.aws/docker/library/node:26-bookworm-slim",
        "FROM nginx:1.30.7-alpine3.24 AS base",
        "from --platform=linux/amd64 public.ecr.aws/docker/library/node:26-trixie-slim",
      ]),
    ).toEqual([
      "public.ecr.aws/docker/library/node:26-alpine3.24",
      "public.ecr.aws/docker/library/node:26-bookworm-slim",
      "public.ecr.aws/docker/library/node:26-trixie-slim",
    ]);
  });

  test("a Compose service's image is read from its own block", () => {
    const compose = [
      "services:",
      "  clickhouse:",
      "    # a comment",
      "    image: clickhouse/clickhouse-server:26.7.38.18",
      "  postgres:",
      '    image: "postgres:15"',
      "  valkey:",
      "    restart: always",
      "  other:",
      "    image: other:1",
    ].join("\n");

    expect(composeImage(compose, "clickhouse")).toBe(
      "clickhouse/clickhouse-server:26.7.38.18",
    );
    expect(composeImage(compose, "postgres")).toBe("postgres:15");
    expect(() => {
      return composeImage(compose, "valkey");
    }).toThrow("docker-compose.base.yml's valkey names no image.");
    expect(() => {
      return composeImage(compose, "missing");
    }).toThrow("no service missing");
  });

  test("the copies are moment-timezone, every Node.js base image, and Compose's ClickHouse - not its Postgres", () => {
    const sources = sourcesToRead();
    const names = sources.map((candidate) => {
      return candidate.name;
    });
    const compose = fs.readFileSync(
      path.join(REPO_ROOT, "docker-compose.base.yml"),
      "utf8",
    );

    expect(names[0]).toMatch(/^moment-timezone \d+\.\d+\.\d+$/);
    expect(names).toContain(
      `ClickHouse ${composeImage(compose, "clickhouse").split(":").pop()}`,
    );
    /*
     * Postgres cuts no day in a zone: a status page's days reach it as
     * instants worked out with moment's data (#10039), so its zoneinfo is no
     * copy to keep current.
     */
    expect(
      names.some((name) => {
        return name.startsWith("Postgres");
      }),
    ).toBe(false);

    // Every image the App, Probe, Runner and Nginx images start from.
    for (const template of [
      "packages/App/Dockerfile.tpl",
      "packages/Probe/Dockerfile.tpl",
      "packages/Runner/Dockerfile.tpl",
      "packages/Nginx/Dockerfile.tpl",
    ]) {
      for (const image of nodeImagesFromDockerfiles([
        fs.readFileSync(path.join(REPO_ROOT, template), "utf8"),
      ])) {
        expect(names).toContain(`Node.js in ${image}`);
      }
    }

    for (const candidate of sources) {
      expect(typeof candidate.read).toBe("function");
      expect(candidate.role).toBeTruthy();
      expect(candidate.where).toBeTruthy();
      expect(candidate.update).toBeTruthy();
    }
  });

  test("ClickHouse is the patch the Helm chart pins too", () => {
    const compose = fs.readFileSync(
      path.join(REPO_ROOT, "docker-compose.base.yml"),
      "utf8",
    );
    const values = yaml.load(
      fs.readFileSync(
        path.join(REPO_ROOT, "HelmChart", "Public", "oneuptime", "values.yaml"),
        "utf8",
      ),
    );
    const tag = composeImage(compose, "clickhouse").split(":").pop();

    // A patch, not a line: the line's early builds lack 2026b (#9999).
    expect(tag).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(values.clickhouse.image.tag).toBe(tag);
    expect(values.clickhouseOperator.altinity.image.tag).toBe(tag);
    expect(values.clickhouseOperator.altinity.keeper.image.tag).toBe(
      `${tag}-alpine`,
    );
  });
});

describe("each copy against IANA's latest release", () => {
  test("a copy with the latest release is current, and nothing fails", () => {
    const check = checkOf(
      [source("moment-timezone", "2026f"), source("Postgres", "2026f")],
      "2026-12-30T00:00:00.000Z",
    );

    expect(
      check.sources.map((candidate) => {
        return candidate.status;
      }),
    ).toEqual(["current", "current"]);
    expect(check.lagging).toBe(0);
    expect(check.fails).toBe(false);
  });

  test("a copy behind is behind, not failing, for the grace period after the release", () => {
    const check = checkOf(
      [source("moment-timezone", "2026f"), source("Node.js", "2026e")],
      "2026-11-19T12:00:00.000Z",
    );

    expect(check.sources[1].status).toBe("behind");
    expect(check.lagging).toBe(1);
    expect(check.fails).toBe(false);
    expect(check.failsFrom).toBe("2026-11-27T06:16:49.000Z");
  });

  test("a copy still behind after the grace period is overdue, and fails the run", () => {
    const check = checkOf(
      [source("Node.js", "2026e"), source("ClickHouse", "2025a")],
      "2026-11-28T00:00:00.000Z",
    );

    expect(
      check.sources.map((candidate) => {
        return candidate.status;
      }),
    ).toEqual(["overdue", "overdue"]);
    expect(check.fails).toBe(true);
  });

  test("a copy that could not be read fails the run at once", () => {
    const check = checkOf(
      [source("moment-timezone", "2026f"), source("ClickHouse", null)],
      "2026-11-19T12:00:00.000Z",
    );

    expect(check.sources[1].status).toBe("unread");
    expect(check.lagging).toBe(0);
    expect(check.fails).toBe(true);
  });

  test("a copy newer than IANA's release (read before the version file moved) is current", () => {
    expect(
      checkOf([source("moment-timezone", "2027a")], "2026-11-19T12:00:00.000Z")
        .sources[0].status,
    ).toBe("current");
  });

  test("the grace period is a month: long enough for upstream to ship a release", () => {
    expect(GRACE_DAYS).toBe(30);
  });
});

describe("the issue's text", () => {
  const check = checkOf(
    [
      source("moment-timezone 0.6.6", "2026f"),
      {
        ...source("Node.js in node:26-alpine3.24", "2026e"),
        update: "wait for Node.js",
        where: "the Dockerfile.tpl FROM lines",
      },
      {
        ...source("Node.js in node:26-bookworm-slim", "2026e"),
        update: "wait for Node.js",
        where: "the Dockerfile.tpl FROM lines",
      },
      source("ClickHouse 26.7.38.18", "2026e"),
      source("Postgres 15", null),
    ],
    "2026-11-19T12:00:00.000Z",
  );
  const body = issueBody(check);

  test("names IANA's latest release, its date, and how many copies are older", () => {
    expect(body).toContain(
      "IANA's latest time zone database release is **2026f**, of 2026-10-27. 3 of the 5 copies",
    );
  });

  test("has a row for every copy, with its release and status", () => {
    expect(body).toContain(
      "| moment-timezone 0.6.6 | moment-timezone 0.6.6's role | 2026f | Current |",
    );
    expect(body).toContain(
      "| ClickHouse 26.7.38.18 | ClickHouse 26.7.38.18's role | 2026e | Behind |",
    );
    expect(body).toContain(
      "| Postgres 15 | Postgres 15's role | ? | Could not be read |",
    );
  });

  test("says how to update each copy that is not current, once per way", () => {
    expect(body).toContain(
      "- **Node.js in node:26-alpine3.24**, **Node.js in node:26-bookworm-slim** (the Dockerfile.tpl FROM lines): wait for Node.js",
    );
    expect(body).toContain(
      "- **ClickHouse 26.7.38.18** (ClickHouse 26.7.38.18's place): update ClickHouse 26.7.38.18",
    );
    expect(body).not.toContain("update moment-timezone 0.6.6");
  });

  test("says when the workflow starts to fail, and names the tests that pin British Columbia", () => {
    expect(body).toContain("fails from 2026-11-27 (30 days after the release)");
    expect(body).toContain("TimezoneBritishColumbia.test.ts");
    expect(body).toContain("BritishColumbiaZoneClickhouse.test.ts");
    expect(body).toContain(
      "MonitorStatusTimelineBritishColumbiaPostgres.test.ts",
    );
  });
});

describe("the one issue", () => {
  const behind = checkOf(
    [source("moment-timezone", "2026f"), source("Node.js", "2026e")],
    "2026-11-19T12:00:00.000Z",
  );
  const current = checkOf(
    [source("moment-timezone", "2026f"), source("Node.js", "2026f")],
    "2026-12-19T12:00:00.000Z",
  );
  const unread = checkOf(
    [source("moment-timezone", "2026f"), source("ClickHouse", null)],
    "2026-11-19T12:00:00.000Z",
  );

  test.each([
    [null, behind, "create"],
    [42, behind, "update"],
    [null, unread, "create"],
    [42, current, "close"],
    [null, current, "nothing"],
  ])("open issue %p: %#", (openIssue, check, action) => {
    expect(issueAction(openIssue, check)).toBe(action);
  });

  test("only an open issue with exactly its title counts", () => {
    expect(
      findOpenIssue(
        fakeGh([
          { number: 7, title: `Re: ${ISSUE_TITLE}` },
          { number: 8, title: ISSUE_TITLE },
        ]).gh,
      ),
    ).toBe(8);
    expect(
      findOpenIssue(fakeGh([{ number: 7, title: `${ISSUE_TITLE}?` }]).gh),
    ).toBeNull();
    expect(findOpenIssue(fakeGh([]).gh)).toBeNull();
  });

  test("a copy behind and no issue: it opens one, labelled as a follow-up bug", () => {
    const { gh, calls } = fakeGh([]);
    const bodyFile = path.join(os.tmpdir(), "issue.md");

    expect(reportTimeZoneData({ check: behind, gh, bodyFile })).toEqual({
      action: "create",
      openIssue: null,
    });
    expect(calls[1]).toEqual([
      "issue",
      "create",
      "--title",
      ISSUE_TITLE,
      "--body-file",
      bodyFile,
      "--label",
      "follow-up",
      "--label",
      "bug",
    ]);
    expect(ISSUE_LABELS).toEqual(["follow-up", "bug"]);
  });

  test("an issue open and a copy still behind: it rewrites the text", () => {
    const { gh, calls } = fakeGh([{ number: 12, title: ISSUE_TITLE }]);

    reportTimeZoneData({ check: behind, gh, bodyFile: "issue.md" });

    expect(calls[1]).toEqual([
      "issue",
      "edit",
      "12",
      "--body-file",
      "issue.md",
    ]);
  });

  test("every copy current and an issue open: it closes it, saying so", () => {
    const { gh, calls } = fakeGh([{ number: 12, title: ISSUE_TITLE }]);

    reportTimeZoneData({ check: current, gh, bodyFile: "issue.md" });

    expect(calls[1].slice(0, 3)).toEqual(["issue", "close", "12"]);
    expect(calls[1][4]).toContain("carries 2026f, IANA's latest release");
  });

  test("every copy current and no issue: nothing is written", () => {
    const { gh, calls } = fakeGh([]);

    reportTimeZoneData({ check: current, gh, bodyFile: "issue.md" });

    expect(calls).toHaveLength(1);
  });
});

describe("the workflow", () => {
  const workflow = yaml.load(fs.readFileSync(WORKFLOW, "utf8"));
  const on = workflow.on || workflow[true];

  test("runs weekly, by hand, and for a pull request that changes the check", () => {
    expect(on.schedule).toHaveLength(1);
    expect(on.schedule[0].cron).toMatch(/^\d+ \d+ \* \* \d$/);
    expect(on).toHaveProperty("workflow_dispatch");
    expect(on.pull_request.paths).toEqual(
      expect.arrayContaining([
        ".github/workflows/time-zone-data.yml",
        "Scripts/TimeZoneData/**",
      ]),
    );
    expect(on).not.toHaveProperty("push");
  });

  test("reads the repository and nothing more, but in the report job", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.check.permissions).toBeUndefined();
    expect(workflow.jobs.report.permissions).toEqual({
      contents: "read",
      issues: "write",
    });
  });

  test("runs the check, keeps its output for the report, and reports on main only", () => {
    const checkSteps = JSON.stringify(workflow.jobs.check.steps);

    expect(checkSteps).toContain("Scripts/TimeZoneData/CheckTimeZoneData.js");
    expect(checkSteps).toContain("time-zone-data-check");
    expect(workflow.jobs.report.needs).toBe("check");
    expect(workflow.jobs.report.if).toContain(
      "github.ref == 'refs/heads/main'",
    );
    expect(workflow.jobs.report.if).toContain(
      "github.event_name != 'pull_request'",
    );
    expect(workflow.jobs.report.if).toContain("!cancelled()");
    expect(JSON.stringify(workflow.jobs.report.steps)).toContain(
      "Scripts/TimeZoneData/ReportTimeZoneData.js",
    );
  });

  test("pulls the images people pull, not a mirror's copy of the tag", () => {
    expect(JSON.stringify(workflow.jobs.check.steps)).not.toContain(
      "docker-hub-mirror",
    );
  });
});
