"use strict";

/**
 * config.example.env opens on what a self-hoster needs, and keeps every
 * config.env that was made from it working (#6827).
 *
 * The file is copied to config.env on every install, so it is the first thing
 * a self-hoster reads. It used to open on HOST and then run on for 1,068
 * lines and 278 settings, with one line in the middle saying the rest could
 * be ignored. Now it opens on a part short enough to read:
 *
 *   - START HERE: HOST, the one setting that must change;
 *   - email, SMS and phone calls, which are set in the Admin Dashboard at
 *     /admin/setup (#6824) and not in this file;
 *   - HTTPS;
 *   - the secrets npm start fills in;
 *
 * then "Change these only if you need to" (ports, a proxy of your own, custom
 * domains, the version, backups, update checks, the AI provider), and
 * everything else under one ADVANCED banner, grouped, with OneUptime Cloud's
 * and the tests' settings last.
 *
 * Regrouping moved settings and changed none: no name is renamed or removed
 * and no default changes, so a config.env made from an older copy keeps
 * working. Fixtures/config.env.14.0.108 holds every setting of the file as
 * 14.0.108 shipped it, before the regrouping; these tests hold the template
 * to it and run `npm run update`'s merge over it.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  RENAMED_FROM,
  mergeEnvTemplate,
} = require("../../Scripts/Install/MergeEnvTemplate");
const {
  GENERATED_SECRETS,
  PLACEHOLDER_MARK,
} = require("../../Scripts/Install/ReplacePlaceholderSecrets");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TEMPLATE_PATH = "config.example.env";
const FIXTURE_PATH = "Tests/Ops/Fixtures/config.env.14.0.108";
const GUIDE_URL = "https://oneuptime.com/docs/installation/self-hosting-guide";
const GUIDE_PAGE =
  "packages/App/FeatureSet/Docs/Content/en/installation/self-hosting-guide.md";
const ASSIGNMENT = /^([A-Z_][A-Z0-9_]*)=(.*)$/;

// The headings the file is read by, in the order it has them.
const START_HERE = "# START HERE: the one setting you must change";
const EMAIL_SECTION =
  "# Email, SMS and phone calls: set in the Admin Dashboard, not in this file";
const HTTPS_SECTION = "# HTTPS";
const SECRETS_SECTION = "# Secrets: npm start fills these in";
const SOMETIMES_SECTION = "# Change these only if you need to";
const ADVANCED_BANNER = "# ADVANCED: everything below works as it is.";
const CLOUD_GROUP =
  "# --- OneUptime Cloud only: billing, plans, analytics and marketplaces ---";
const TESTS_GROUP = "# --- Development and tests only ---";

// The opening part, up to "Change these only if you need to", stays this short.
const OPENING_LINE_BUDGET = 90;

// Where the settings of the opening and sometimes-changed parts are read.
const READERS = [
  "docker-compose.base.yml",
  "docker-compose.yml",
  "backup.sh",
  "restore.sh",
];

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

// [{ key, value, line }] for every KEY=value line that is not a comment.
function assignmentsOf(text) {
  return text.split("\n").flatMap((line, index) => {
    const match = ASSIGNMENT.exec(line);

    return match ? [{ key: match[1], value: match[2], line: index }] : [];
  });
}

function keysOf(text) {
  return assignmentsOf(text).map((assignment) => {
    return assignment.key;
  });
}

const TEMPLATE = read(TEMPLATE_PATH);
const LINES = TEMPLATE.split("\n");
const FIXTURE = read(FIXTURE_PATH);

function lineOf(heading) {
  return LINES.indexOf(heading);
}

// The KEY=value lines between two headings.
function keysBetween(from, to) {
  return assignmentsOf(TEMPLATE)
    .filter((assignment) => {
      return assignment.line > lineOf(from) && assignment.line < lineOf(to);
    })
    .map((assignment) => {
      return assignment.key;
    });
}

describe("config.example.env opens on what a self-hoster needs", () => {
  test("the parts come in the order a self-hoster needs them", () => {
    const order = [
      START_HERE,
      EMAIL_SECTION,
      HTTPS_SECTION,
      SECRETS_SECTION,
      SOMETIMES_SECTION,
      ADVANCED_BANNER,
      CLOUD_GROUP,
      TESTS_GROUP,
    ].map(lineOf);

    expect(
      order.every((line) => {
        return line > 0;
      }),
    ).toBe(true);
    expect(
      [...order].sort((a, b) => {
        return a - b;
      }),
    ).toEqual(order);
    // Each heading is there once.
    for (const heading of [START_HERE, SOMETIMES_SECTION, ADVANCED_BANNER]) {
      expect(
        LINES.filter((line) => {
          return line === heading;
        }),
      ).toHaveLength(1);
    }
  });

  test("it is still a file bash reads, and it opens by saying where the guide is", () => {
    expect(LINES[0]).toBe("#!/usr/bin/env bash");
    expect(TEMPLATE.slice(0, TEMPLATE.indexOf(START_HERE))).toContain(
      GUIDE_URL,
    );
    // The guide it names is a docs page.
    expect(fs.existsSync(path.join(REPO_ROOT, GUIDE_PAGE))).toBe(true);
    expect(read("packages/App/FeatureSet/Docs/Utils/Nav.ts")).toContain(
      'url: "/docs/installation/self-hosting-guide"',
    );
  });

  test("HOST is the first setting, alone under START HERE, and ships as localhost", () => {
    expect(assignmentsOf(TEMPLATE)[0]).toEqual(
      expect.objectContaining({ key: "HOST", value: "localhost" }),
    );
    expect(keysBetween(START_HERE, EMAIL_SECTION)).toEqual(["HOST"]);
  });

  test("email, SMS and calls are not settings of this file: the section sends people to /admin/setup and its tests", () => {
    const section = LINES.slice(
      lineOf(EMAIL_SECTION),
      lineOf(HTTPS_SECTION),
    ).join("\n");
    const routeMap = read(
      "packages/App/FeatureSet/AdminDashboard/src/Utils/RouteMap.ts",
    );
    const testSends = read(
      "packages/Common/Types/ServerSetup/ServerTestSend.ts",
    );

    expect(keysBetween(EMAIL_SECTION, HTTPS_SECTION)).toEqual([]);
    expect(section).toContain("<HOST>/admin/setup");
    expect(routeMap).toContain(
      "[PageMap.SERVER_SETUP]: new Route(`/admin/setup`),",
    );
    // The buttons it names are the ones the Admin Dashboard draws.
    for (const button of [
      "Send test email",
      "Send test SMS",
      "Make test call",
    ]) {
      expect(section).toContain(`"${button}"`);
      expect(testSends).toContain(`translationKey("${button}")`);
    }
  });

  test("HTTPS holds the two settings that turn it on, off by default", () => {
    const https = keysBetween(HTTPS_SECTION, SECRETS_SECTION);

    expect(https.slice(0, 2)).toEqual(["PROVISION_SSL", "HTTP_PROTOCOL"]);
    expect(https).toEqual(
      expect.arrayContaining([
        "HSTS_MAX_AGE_SECONDS",
        "LETS_ENCRYPT_NOTIFICATION_EMAIL",
      ]),
    );
    expect(TEMPLATE).toMatch(/^PROVISION_SSL=false$/m);
    expect(TEMPLATE).toMatch(/^HTTP_PROTOCOL=http$/m);
  });

  test("the secrets part holds only placeholders, each one npm start replaces", () => {
    const secrets = assignmentsOf(TEMPLATE).filter((assignment) => {
      return (
        assignment.line > lineOf(SECRETS_SECTION) &&
        assignment.line < lineOf(SOMETIMES_SECTION)
      );
    });

    expect(secrets.length).toBeGreaterThanOrEqual(8);
    for (const secret of secrets) {
      expect({
        key: secret.key,
        placeholder: secret.value.includes(PLACEHOLDER_MARK),
      }).toEqual({
        key: secret.key,
        placeholder: true,
      });
    }
    // npm start's generated secrets that live here are among them.
    expect(
      secrets.map((secret) => {
        return secret.key;
      }),
    ).toEqual(
      expect.arrayContaining(
        GENERATED_SECRETS.filter((key) => {
          return key !== "GLOBAL_RUNNER_KEY";
        }),
      ),
    );
  });

  test(`the opening part, up to "Change these only if you need to", is short enough to read: at most ${OPENING_LINE_BUDGET} lines`, () => {
    expect(lineOf(SOMETIMES_SECTION)).toBeLessThanOrEqual(OPENING_LINE_BUDGET);
    // ...and it is a small share of a file that keeps every setting.
    expect(LINES.length).toBeGreaterThan(OPENING_LINE_BUDGET * 10);
  });

  test("every setting above ADVANCED is one Docker Compose or the backup scripts read", () => {
    const readers = READERS.map(read).join("\n");
    const unread = keysBetween(LINES[0], ADVANCED_BANNER).filter((key) => {
      return !new RegExp(`\\b${key}\\b`).test(readers);
    });

    expect(keysBetween(LINES[0], ADVANCED_BANNER).length).toBeGreaterThan(40);
    expect(unread).toEqual([]);
  });

  test("OneUptime Cloud's settings are under ADVANCED, in their own group", () => {
    const cloud = keysBetween(CLOUD_GROUP, TESTS_GROUP);

    for (const key of [
      "BILLING_ENABLED",
      "SUBSCRIPTION_PLAN_BASIC",
      "AWS_MARKETPLACE_ACCESS_KEY_ID",
      "GOOGLE_TAG_MANAGER_ENABLED",
      "MARKETING_WEBHOOK_URL",
    ]) {
      expect({ key, cloud: cloud.includes(key) }).toEqual({ key, cloud: true });
    }
    const testsOnly = assignmentsOf(TEMPLATE)
      .filter((assignment) => {
        return assignment.line > lineOf(TESTS_GROUP);
      })
      .map((assignment) => {
        return assignment.key;
      });

    expect(testsOnly).toEqual(
      expect.arrayContaining([
        "E2E_TEST_IS_USER_REGISTERED",
        "E2E_TESTS_FAILED_WEBHOOK_URL",
      ]),
    );
  });

  test("every setting is set once", () => {
    const keys = keysOf(TEMPLATE);
    const twice = keys.filter((key, index) => {
      return keys.indexOf(key) !== index;
    });

    expect(twice).toEqual([]);
  });
});

describe("a config.env made from an older copy keeps working", () => {
  const before = assignmentsOf(FIXTURE);
  const now = new Map(
    assignmentsOf(TEMPLATE).map((assignment) => {
      return [assignment.key, assignment.value];
    }),
  );

  test("the fixture is the file as 14.0.108 shipped it: 278 settings, HOST first", () => {
    expect(before).toHaveLength(278);
    expect(before[0]).toEqual(
      expect.objectContaining({ key: "HOST", value: "localhost" }),
    );
  });

  test("every name it holds is still in the template, or renamed with its old name kept", () => {
    const renamedFrom = new Set(Object.values(RENAMED_FROM));
    const gone = before
      .map((assignment) => {
        return assignment.key;
      })
      .filter((key) => {
        return !now.has(key) && !renamedFrom.has(key);
      });

    expect(gone).toEqual([]);
  });

  test("npm run update's merge keeps every line of it, in its order, and adds only names the template gained", () => {
    const merged = mergeEnvTemplate(TEMPLATE, FIXTURE);
    const mergedLines = merged.contents.split("\n");
    const fixtureLines = FIXTURE.replace(/\n$/, "").split("\n");

    expect(mergedLines.slice(0, fixtureLines.length)).toEqual(fixtureLines);

    const added = keysOf(mergedLines.slice(fixtureLines.length).join("\n"));
    const known = new Set(keysOf(FIXTURE));

    for (const key of added) {
      expect({ key, new: !known.has(key) }).toEqual({ key, new: true });
    }
    expect(merged.carriedOver).toEqual([]);
    expect(merged.imageTagChanges).toEqual([]);
  });

  test("regrouping changed no default: what the template held then, it holds now", () => {
    /*
     * A default that changes on purpose later is a change of its own, made
     * with an upgrade note: list it here, with the release that changed it.
     */
    const changedOnPurpose = {};
    const changed = before.filter((assignment) => {
      return (
        now.has(assignment.key) &&
        now.get(assignment.key) !== assignment.value &&
        changedOnPurpose[assignment.key] === undefined
      );
    });

    expect(changed).toEqual([]);
  });

  test("bash reads the template as it reads config.env, and a setting that names another finds it set", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "oneuptime-config-"),
    );

    try {
      fs.copyFileSync(
        path.join(REPO_ROOT, TEMPLATE_PATH),
        path.join(directory, "config.env"),
      );
      const run = spawnSync(
        "bash",
        [
          "-c",
          'set -a; . ./config.env; printf "%s|%s|%s" "$HOST" "$DATABASE_BACKUP_PASSWORD" "$DATABASE_PASSWORD"',
        ],
        { cwd: directory, encoding: "utf8" },
      );

      expect(run.stderr).toBe("");
      expect(run.status).toBe(0);

      const [host, backupPassword, password] = run.stdout.split("|");

      expect(host).toBe("localhost");
      expect(password).toContain(PLACEHOLDER_MARK);
      expect(backupPassword).toBe(password);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
