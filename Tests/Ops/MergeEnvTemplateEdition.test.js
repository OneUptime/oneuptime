"use strict";

/**
 * Scripts/Install/MergeEnvTemplate.js and the edition split.
 *
 * Before the split, a Docker Compose Enterprise install was APP_TAG=release
 * plus IS_ENTERPRISE_EDITION=true. APP_TAG=release is now the Community image,
 * and `npm run update` (prerun -> Scripts/Install/configure.sh -> this merge,
 * then `docker compose pull`) keeps APP_TAG as it is. Left alone, the upgrade
 * pulls the Community image, and the App refuses to start with
 * IS_ENTERPRISE_EDITION=true (packages/App/Utils/EnterpriseLoader.ts) because
 * running on would silently stop enforcing "Require SSO", SSO, SCIM and audit
 * logging.
 *
 * So while config.env still asks for the Enterprise Edition, the merge moves
 * APP_TAG to the matching enterprise- tag and prints why. This suite pins the
 * pure function that decides it, the full merge, and the real script run the
 * way configure.sh runs it.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT_PATH = path.join(
  REPO_ROOT,
  "Scripts",
  "Install",
  "MergeEnvTemplate.js",
);
const CONFIG_EXAMPLE_PATH = path.join(REPO_ROOT, "config.example.env");

const {
  ENTERPRISE_TAG_PREFIX,
  pinEnterpriseImageTag,
  describeEnterpriseImageTagChanges,
  mergeEnvTemplate,
} = require(SCRIPT_PATH);

const TEMPLATE = fs.readFileSync(CONFIG_EXAMPLE_PATH, "utf8");

const workspaces = [];

afterAll(() => {
  for (const dir of workspaces) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "merge-env-edition-"));
  workspaces.push(dir);
  return dir;
}

/**
 * Runs the real script against a throwaway config.env, from a directory shaped
 * like the repository root (the script resolves both files against the working
 * directory, exactly as configure.sh runs it).
 */
function runScript(dir, configEnvContents) {
  fs.mkdirSync(path.join(dir, "Scripts", "Install"), { recursive: true });
  fs.copyFileSync(
    SCRIPT_PATH,
    path.join(dir, "Scripts", "Install", "MergeEnvTemplate.js"),
  );
  fs.copyFileSync(CONFIG_EXAMPLE_PATH, path.join(dir, "config.example.env"));

  if (configEnvContents !== undefined) {
    fs.writeFileSync(path.join(dir, "config.env"), configEnvContents);
  }

  const stdout = execFileSync(
    process.execPath,
    ["./Scripts/Install/MergeEnvTemplate.js"],
    { cwd: dir, stdio: "pipe", encoding: "utf8" },
  );

  return {
    stdout,
    contents: fs.readFileSync(path.join(dir, "config.env"), "utf8"),
  };
}

function pin(lines) {
  return pinEnterpriseImageTag(lines);
}

function valueOf(contents, key) {
  const line = contents
    .split("\n")
    .filter((candidate) => {
      return !candidate.startsWith("#") && candidate.split("=")[0] === key;
    })
    .pop();

  return line === undefined ? undefined : line.slice(line.indexOf("=") + 1);
}

describe("pinEnterpriseImageTag", () => {
  test.each([
    ["release", "enterprise-release"],
    ["13.0.7", "enterprise-13.0.7"],
    ["test", "enterprise-test"],
    ["13.1.0-amd64", "enterprise-13.1.0-amd64"],
  ])("IS_ENTERPRISE_EDITION=true moves APP_TAG=%s to %s", (from, to) => {
    const result = pin([`APP_TAG=${from}`, "IS_ENTERPRISE_EDITION=true"]);

    expect(result.lines).toEqual([
      `APP_TAG=${to}`,
      "IS_ENTERPRISE_EDITION=true",
    ]);
    expect(result.changes).toEqual([{ from, to }]);
  });

  test("the prefix is exactly the one the published Enterprise tags carry", () => {
    expect(ENTERPRISE_TAG_PREFIX).toBe("enterprise-");
  });

  test.each(["enterprise-release", "enterprise-13.0.7", "Enterprise-release"])(
    "an APP_TAG that is already %s is left alone",
    (tag) => {
      const lines = [`APP_TAG=${tag}`, "IS_ENTERPRISE_EDITION=true"];
      const result = pin(lines);

      expect(result.lines).toEqual(lines);
      expect(result.changes).toEqual([]);
    },
  );

  /*
   * Negative controls: only the exact value the App treats as a request
   * ("true") moves the tag. Anything else runs the Community image fine, so
   * the tag the operator chose must stay.
   */
  test.each([
    ["false", "IS_ENTERPRISE_EDITION=false"],
    ["empty", "IS_ENTERPRISE_EDITION="],
    ["TRUE (the App reads exactly true)", "IS_ENTERPRISE_EDITION=TRUE"],
    ["1", "IS_ENTERPRISE_EDITION=1"],
    ["yes", "IS_ENTERPRISE_EDITION=yes"],
    ["commented out", "# IS_ENTERPRISE_EDITION=true"],
    ["commented out without a space", "#IS_ENTERPRISE_EDITION=true"],
    ["a longer key", "IS_ENTERPRISE_EDITION_OLD=true"],
  ])("IS_ENTERPRISE_EDITION %s leaves APP_TAG alone", (_label, flagLine) => {
    const lines = ["APP_TAG=release", flagLine];
    const result = pin(lines);

    expect(result.lines).toEqual(lines);
    expect(result.changes).toEqual([]);
  });

  test("IS_ENTERPRISE_EDITION unset leaves APP_TAG alone", () => {
    const lines = ["APP_TAG=release", "HOST=localhost"];

    expect(pin(lines)).toEqual({ lines, changes: [] });
  });

  test("the last IS_ENTERPRISE_EDITION wins, as it does when config.env is exported", () => {
    expect(
      pin([
        "IS_ENTERPRISE_EDITION=true",
        "APP_TAG=release",
        "IS_ENTERPRISE_EDITION=false",
      ]).changes,
    ).toEqual([]);

    expect(
      pin([
        "IS_ENTERPRISE_EDITION=false",
        "APP_TAG=release",
        "IS_ENTERPRISE_EDITION=true",
      ]).lines,
    ).toEqual([
      "IS_ENTERPRISE_EDITION=false",
      "APP_TAG=enterprise-release",
      "IS_ENTERPRISE_EDITION=true",
    ]);
  });

  test("reads a quoted IS_ENTERPRISE_EDITION and keeps a quoted APP_TAG quoted", () => {
    expect(
      pin(['APP_TAG="release"', 'IS_ENTERPRISE_EDITION="true"']).lines,
    ).toEqual(['APP_TAG="enterprise-release"', 'IS_ENTERPRISE_EDITION="true"']);
    expect(
      pin(["APP_TAG='13.0.7'", "IS_ENTERPRISE_EDITION='true'"]).lines,
    ).toEqual(["APP_TAG='enterprise-13.0.7'", "IS_ENTERPRISE_EDITION='true'"]);
  });

  test("tolerates whitespace around the key and value", () => {
    expect(
      pin(["APP_TAG = release", " IS_ENTERPRISE_EDITION = true "]).lines,
    ).toEqual([
      "APP_TAG = enterprise-release",
      " IS_ENTERPRISE_EDITION = true ",
    ]);
  });

  test("an empty APP_TAG is not turned into a bare enterprise- tag", () => {
    const lines = ["APP_TAG=", "IS_ENTERPRISE_EDITION=true"];

    expect(pin(lines)).toEqual({ lines, changes: [] });
  });

  test("comments and every other line are returned byte-identical", () => {
    const lines = [
      "# What image should we pull from docker hub.",
      "#   release              the Community Edition (Apache-2.0).",
      "# APP_TAG=release",
      "HOST=oneuptime.example.com",
      "",
      "APP_TAG=release",
      "IS_ENTERPRISE_EDITION=true",
      "VALKEY_PASSWORD=a-real-production-secret",
      "SOMETHING_WITH_EQUALS=a=b=c",
    ];

    const result = pin(lines);

    expect(result.lines).toEqual([
      ...lines.slice(0, 5),
      "APP_TAG=enterprise-release",
      ...lines.slice(6),
    ]);
  });

  test("never mutates its input", () => {
    const lines = ["APP_TAG=release", "IS_ENTERPRISE_EDITION=true"];
    const copy = [...lines];

    pin(lines);

    expect(lines).toEqual(copy);
  });

  test("is idempotent: a second run changes nothing", () => {
    const first = pin([
      "APP_TAG=release",
      "IS_ENTERPRISE_EDITION=true",
      'OTHER="x"',
    ]);
    const second = pin(first.lines);

    expect(second.lines).toEqual(first.lines);
    expect(second.changes).toEqual([]);
  });
});

describe("describeEnterpriseImageTagChanges", () => {
  const notice = describeEnterpriseImageTagChanges([
    { from: "release", to: "enterprise-release" },
  ]);

  test("says what changed and why", () => {
    expect(notice).toContain("IS_ENTERPRISE_EDITION=true");
    expect(notice).toContain("from release to enterprise-release");
    expect(notice).toContain("refuses to start");
    expect(notice).toContain("SSO, SCIM and audit logging");
  });

  test("says how to opt out", () => {
    expect(notice).toContain(
      "set IS_ENTERPRISE_EDITION=false and APP_TAG=release",
    );
  });

  test("is honest about the Enterprise license it moves the install onto", () => {
    expect(notice).toContain("ee/LICENSE");
    expect(notice).toContain("production use requires a subscription");
    expect(notice).toContain("14-day trial for evaluation");
  });
});

describe("mergeEnvTemplate", () => {
  test("a pre-split Enterprise config.env ends up on the Enterprise image", () => {
    const merged = mergeEnvTemplate(
      TEMPLATE,
      "HOST=oneuptime.example.com\nAPP_TAG=release\nIS_ENTERPRISE_EDITION=true\n",
    );

    expect(valueOf(merged.contents, "APP_TAG")).toBe("enterprise-release");
    expect(merged.imageTagChanges).toEqual([
      { from: "release", to: "enterprise-release" },
    ]);
  });

  test("an APP_TAG appended from the template is moved too", () => {
    const merged = mergeEnvTemplate(TEMPLATE, "IS_ENTERPRISE_EDITION=true\n");

    expect(valueOf(merged.contents, "APP_TAG")).toBe("enterprise-release");
  });

  test("a Community config.env keeps APP_TAG=release", () => {
    const merged = mergeEnvTemplate(TEMPLATE, "APP_TAG=release\n");

    // IS_ENTERPRISE_EDITION is appended from the template, as false.
    expect(valueOf(merged.contents, "IS_ENTERPRISE_EDITION")).toBe("false");
    expect(valueOf(merged.contents, "APP_TAG")).toBe("release");
    expect(merged.imageTagChanges).toEqual([]);
  });

  test("a fresh install from the template itself stays on the Community image", () => {
    const merged = mergeEnvTemplate(TEMPLATE, TEMPLATE);

    expect(merged.contents).toBe(TEMPLATE);
    expect(merged.imageTagChanges).toEqual([]);
  });

  test("the rename carry-over still works alongside it", () => {
    const merged = mergeEnvTemplate(
      TEMPLATE,
      "REDIS_PASSWORD=a-real-production-secret\nAPP_TAG=13.0.7\nIS_ENTERPRISE_EDITION=true\n",
    );

    expect(merged.carriedOver).toContain(
      "REDIS_PASSWORD (kept in place of VALKEY_PASSWORD)",
    );
    expect(valueOf(merged.contents, "VALKEY_PASSWORD")).toBeUndefined();
    expect(valueOf(merged.contents, "APP_TAG")).toBe("enterprise-13.0.7");
  });

  test("is idempotent over the whole merge", () => {
    const first = mergeEnvTemplate(
      TEMPLATE,
      "APP_TAG=release\nIS_ENTERPRISE_EDITION=true\n",
    );
    const second = mergeEnvTemplate(TEMPLATE, first.contents);

    expect(second.contents).toBe(first.contents);
    expect(second.imageTagChanges).toEqual([]);
  });
});

describe("the script, run the way configure.sh runs it", () => {
  const PRE_SPLIT_ENTERPRISE_CONFIG = [
    "# my install",
    "HOST=oneuptime.example.com",
    "APP_TAG=release",
    "IS_ENTERPRISE_EDITION=true",
    "",
  ].join("\n");

  test("rewrites APP_TAG, keeps everything else and prints the notice", () => {
    const run = runScript(workspace(), PRE_SPLIT_ENTERPRISE_CONFIG);

    expect(valueOf(run.contents, "APP_TAG")).toBe("enterprise-release");
    expect(
      run.contents.startsWith("# my install\nHOST=oneuptime.example.com\n"),
    ).toBe(true);
    expect(run.contents).toContain("\nIS_ENTERPRISE_EDITION=true\n");
    expect(run.stdout).toContain("from release to enterprise-release");
    expect(run.stdout).toContain("IS_ENTERPRISE_EDITION=false");
  });

  test("a second run changes nothing and prints nothing about the edition", () => {
    const dir = workspace();
    const first = runScript(dir, PRE_SPLIT_ENTERPRISE_CONFIG);
    const second = runScript(dir);

    expect(second.contents).toBe(first.contents);
    expect(second.stdout).not.toContain("APP_TAG was changed");
  });

  test("a Community config.env is not touched and gets no notice", () => {
    const run = runScript(
      workspace(),
      "APP_TAG=release\nIS_ENTERPRISE_EDITION=false\n",
    );

    expect(valueOf(run.contents, "APP_TAG")).toBe("release");
    expect(run.stdout).not.toContain("APP_TAG was changed");
  });

  /*
   * `npm run update` exports config.env with
   * `export $(grep -v '^#' config.env | xargs)` before `docker compose pull`,
   * so what matters is the value that export produces.
   */
  test("the exported APP_TAG is the Enterprise tag, quoted or not", () => {
    for (const appTagLine of ["APP_TAG=release", 'APP_TAG="release"']) {
      const dir = workspace();
      runScript(dir, `${appTagLine}\nIS_ENTERPRISE_EDITION=true\n`);

      const exported = spawnSync(
        "bash",
        [
          "-c",
          "export $(grep -v '^#' config.env | xargs) && printf '%s' \"$APP_TAG\"",
        ],
        { cwd: dir, encoding: "utf8" },
      );

      expect(exported.status).toBe(0);
      expect(exported.stdout).toBe("enterprise-release");
    }
  });

  test("requiring the script only exports functions: it reads and writes no files", () => {
    const dir = workspace();
    const required = spawnSync(
      process.execPath,
      ["-e", `require(${JSON.stringify(SCRIPT_PATH)})`],
      { cwd: dir, encoding: "utf8" },
    );

    expect(required.status).toBe(0);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  /*
   * Negative control for the check above: run as a script from the same kind
   * of empty directory, it does try to read config.example.env.
   */
  test("run as a script, it does read the files (so the check above is meaningful)", () => {
    const dir = workspace();
    const run = spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: dir,
      encoding: "utf8",
    });

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("config.example.env");
  });
});
