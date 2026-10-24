"use strict";

/**
 * `npm run update` and its first step, Scripts/Install/Update.js.
 *
 * It used to start with `npm run prerun`, a developer's setup
 * (Scripts/Install/configure.sh) that asked for the sudo password, installed
 * gomplate and ts-node machine-wide and rendered every Dockerfile.tpl - none of
 * which an install that pulls released images needs. It now does, as the
 * user who runs it, the two things an update needs - `git pull --ff-only` on
 * the branch the install follows, and the config.env merge - then pulls the
 * images and runs npm start, as before.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  pullRepository,
  mergeConfig,
  run,
} = require("../../Scripts/Install/Update");
const {
  readSettings,
} = require("../../Scripts/Install/ReplacePlaceholderSecrets");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ROOT_PACKAGE = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
);
const TEMPLATE = fs.readFileSync(
  path.join(REPO_ROOT, "config.example.env"),
  "utf8",
);
const INSTALL_STEP_IN_SCRIPT = /node (\.\/Scripts\/Install\/[\w.-]+\.js)/g;

// A git stub for pullRepository: answers by the first argument.
function gitAnswering(answers) {
  const calls = [];
  const runGit = (args, options) => {
    calls.push({ args: args, inherit: Boolean(options && options.inherit) });
    const answer = answers[args[0]];

    return answer === undefined ? { status: 0, stdout: "" } : answer;
  };

  return { calls, runGit };
}

function logger() {
  const lines = [];

  return {
    lines,
    log: (line) => {
      lines.push(line);
    },
  };
}

describe("pulling the branch the install follows", () => {
  test("on a branch: git pull --ff-only, with git's own output on the terminal", () => {
    const git = gitAnswering({
      "symbolic-ref": { status: 0, stdout: "release\n" },
    });
    const out = logger();

    expect(
      pullRepository({ cwd: "/x", log: out.log, runGit: git.runGit }),
    ).toBe("pulled");
    expect(
      git.calls.map((call) => {
        return call.args.join(" ");
      }),
    ).toEqual([
      "rev-parse --is-inside-work-tree",
      "symbolic-ref --quiet --short HEAD",
      "pull --ff-only",
    ]);
    expect(git.calls[2].inherit).toBe(true);
    expect(out.lines).toEqual(["  ✓ Pulled the latest release."]);
  });

  test("at a fixed commit (a pinned release tag): nothing is pulled, and how to update is said", () => {
    const git = gitAnswering({ "symbolic-ref": { status: 1, stdout: "" } });
    const out = logger();

    expect(
      pullRepository({ cwd: "/x", log: out.log, runGit: git.runGit }),
    ).toBe("detached");
    expect(
      git.calls.some((call) => {
        return call.args[0] === "pull";
      }),
    ).toBe(false);
    expect(out.lines[0]).toContain(
      "This checkout is at a fixed commit, not on a branch, so it was not pulled.",
    );
    expect(out.lines[0]).toContain("git checkout release");
  });

  test("not a git checkout: nothing is pulled, and the rest goes on", () => {
    const git = gitAnswering({ "rev-parse": { status: 128, stdout: "" } });
    const out = logger();

    expect(
      pullRepository({ cwd: "/x", log: out.log, runGit: git.runGit }),
    ).toBe("not-a-checkout");
    expect(git.calls).toHaveLength(1);
    expect(out.lines[0]).toContain("This folder is not a git checkout");
  });

  test("a pull that cannot fast-forward stops the update, saying why and what to do", () => {
    const git = gitAnswering({
      "symbolic-ref": { status: 0, stdout: "release\n" },
      pull: { status: 128, stdout: "" },
    });
    const out = logger();

    expect(
      pullRepository({ cwd: "/x", log: out.log, runGit: git.runGit }),
    ).toBe("failed");
    expect(out.lines[0]).toBe(
      "  ✗ git pull could not bring release up to date, so nothing was updated or restarted. Files changed in this folder by hand are the usual reason (git status shows them): put them in docker-compose.override.yml or config.env instead, then run npm run update again.",
    );
  });

  test("git missing altogether reads as not a checkout", () => {
    const out = logger();

    expect(
      pullRepository({
        cwd: "/x",
        log: out.log,
        runGit: () => {
          return { error: new Error("spawn git ENOENT"), status: null };
        },
      }),
    ).toBe("not-a-checkout");
  });
});

describe("merging config.env", () => {
  function workspace(config) {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "oneuptime-update-"),
    );

    fs.writeFileSync(path.join(directory, "config.example.env"), TEMPLATE);

    if (config !== null) {
      fs.writeFileSync(path.join(directory, "config.env"), config);
    }

    return directory;
  }

  test("adds what config.example.env gained, with its defaults, and keeps the operator's values", () => {
    const directory = workspace(
      "HOST=oneuptime.example.com\nDATABASE_PASSWORD=mine\n",
    );
    const out = logger();

    try {
      expect(mergeConfig({ cwd: directory, log: out.log })).toBe(true);

      const settings = readSettings(
        fs.readFileSync(path.join(directory, "config.env"), "utf8"),
      );

      expect(settings.get("HOST")).toBe("oneuptime.example.com");
      expect(settings.get("DATABASE_PASSWORD")).toBe("mine");
      expect(settings.get("ONEUPTIME_HTTP_PORT")).toBe("80");
      expect(out.lines).toContain(
        "  ✓ Added the settings config.example.env gained to config.env, with their defaults. Your own values stay.",
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("a config.env with every setting is not written, and nothing is said", () => {
    const directory = workspace(TEMPLATE);
    const out = logger();

    try {
      const before = fs.statSync(path.join(directory, "config.env")).mtimeMs;

      expect(mergeConfig({ cwd: directory, log: out.log })).toBe(false);
      expect(fs.statSync(path.join(directory, "config.env")).mtimeMs).toBe(
        before,
      );
      expect(out.lines).toEqual([]);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("without config.env there is nothing to merge: npm start makes it", () => {
    const directory = workspace(null);

    try {
      expect(mergeConfig({ cwd: directory, log: () => {} })).toBe(false);
      expect(fs.existsSync(path.join(directory, "config.env"))).toBe(false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("an Enterprise install's tag follows, as the merge has always done", () => {
    const directory = workspace(
      "APP_TAG=release\nIS_ENTERPRISE_EDITION=true\n",
    );
    const out = logger();

    try {
      mergeConfig({ cwd: directory, log: out.log });

      expect(
        readSettings(
          fs.readFileSync(path.join(directory, "config.env"), "utf8"),
        ).get("APP_TAG"),
      ).toBe("enterprise-release");
      expect(out.lines.join("\n")).toContain("enterprise-release");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("run stops before the merge when the pull failed", () => {
    const merged = [];
    const code = run({
      cwd: "/nonexistent",
      log: () => {},
      runGit: gitAnswering({
        "symbolic-ref": { status: 0, stdout: "release\n" },
        pull: { status: 1 },
      }).runGit,
      fileSystem: {
        existsSync: () => {
          merged.push("asked");
          return true;
        },
      },
    });

    expect(code).toBe(1);
    expect(merged).toEqual([]);
  });
});

describe("npm run update", () => {
  test("pulls, merges and starts, as the user who runs it: no sudo, no developer setup", () => {
    const update = ROOT_PACKAGE.scripts.update;

    expect(update).toBe(
      "node ./Scripts/Install/Update.js && export $(grep -v '^#' config.env | xargs) && docker compose pull && npm run start",
    );
    expect(update).not.toContain("prerun");
    expect(update).not.toContain("configure.sh");
    expect(update).not.toContain("sudo");
  });

  test("the developer's setup keeps configure.sh, which npm run dev runs", () => {
    expect(ROOT_PACKAGE.scripts.prerun).toContain(
      "Scripts/Install/configure.sh",
    );
    expect(ROOT_PACKAGE.scripts.dev).toContain("npm run prerun");
  });

  /*
   * npm itself runs the root package's update script in a throwaway copy:
   * the install steps, a config.env from an older release (a setting
   * missing), and `git`, `docker` and `sudo` on PATH that record their calls.
   */
  test("in order: the pull, the merge, the images, then npm start - and nothing as root", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "oneuptime-npm-update-"),
    );
    const calls = path.join(directory, "calls.log");

    try {
      fs.mkdirSync(path.join(directory, "Scripts", "Install"), {
        recursive: true,
      });
      for (const command of [
        ROOT_PACKAGE.scripts.update,
        ROOT_PACKAGE.scripts.start,
      ]) {
        for (const match of command.matchAll(INSTALL_STEP_IN_SCRIPT)) {
          fs.copyFileSync(
            path.join(REPO_ROOT, match[1]),
            path.join(directory, match[1]),
          );
        }
      }
      for (const file of ["StartOutput.js", "MergeEnvTemplate.js"]) {
        fs.copyFileSync(
          path.join(REPO_ROOT, "Scripts", "Install", file),
          path.join(directory, "Scripts", "Install", file),
        );
      }
      fs.writeFileSync(path.join(directory, "config.example.env"), TEMPLATE);
      fs.writeFileSync(
        path.join(directory, "config.env"),
        TEMPLATE.split("\n")
          .filter((line) => {
            return !line.startsWith("HSTS_MAX_AGE_SECONDS=");
          })
          .join("\n"),
      );
      fs.writeFileSync(
        path.join(directory, "package.json"),
        JSON.stringify({
          name: "npm-update-wiring",
          version: "1.0.0",
          private: true,
          scripts: {
            update: ROOT_PACKAGE.scripts.update,
            start: ROOT_PACKAGE.scripts.start,
            "status-check": "echo status-check >> calls.log",
          },
        }),
      );
      fs.mkdirSync(path.join(directory, "bin"));
      fs.writeFileSync(
        path.join(directory, "bin", "git"),
        [
          "#!/bin/sh",
          `echo "git $*" >> "${calls}"`,
          'case "$1" in',
          "  symbolic-ref) echo release ;;",
          "esac",
          "exit 0",
          "",
        ].join("\n"),
        { mode: 0o755 },
      );
      fs.writeFileSync(
        path.join(directory, "bin", "docker"),
        [
          "#!/bin/sh",
          `echo "docker $*" >> "${calls}"`,
          'case "$*" in',
          '  "compose run "*) echo oneuptime-database:created ;;',
          "esac",
          "exit 0",
          "",
        ].join("\n"),
        { mode: 0o755 },
      );
      fs.writeFileSync(
        path.join(directory, "bin", "sudo"),
        `#!/bin/sh\necho "sudo $*" >> "${calls}"\nexit 1\n`,
        { mode: 0o755 },
      );

      const env = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (!key.toLowerCase().startsWith("npm_")) {
          env[key] = value;
        }
      }
      env.PATH = `${path.join(directory, "bin")}${path.delimiter}${process.env.PATH}`;
      env.npm_config_update_notifier = "false";
      // The checks of the server have suites of their own (Preflight.test.js).
      env.ONEUPTIME_SKIP_PREFLIGHT = "true";

      const result = spawnSync("npm", ["run", "update"], {
        cwd: directory,
        env,
        encoding: "utf8",
        timeout: 120 * 1000,
      });
      const recorded = fs.readFileSync(calls, "utf8").trim().split("\n");
      const output = `${result.stdout || ""}${result.stderr || ""}`;

      expect({ status: result.status, output }).toEqual({
        status: 0,
        output: expect.any(String),
      });
      expect(recorded.slice(0, 4)).toEqual([
        "git rev-parse --is-inside-work-tree",
        "git symbolic-ref --quiet --short HEAD",
        "git pull --ff-only",
        "docker compose pull",
      ]);
      expect(recorded.slice(-2)).toEqual([
        "docker compose up --remove-orphans -d",
        "status-check",
      ]);
      expect(
        recorded.filter((call) => {
          return call.startsWith("sudo");
        }),
      ).toEqual([]);
      expect(output).toContain("  ✓ Pulled the latest release.");
      expect(
        readSettings(
          fs.readFileSync(path.join(directory, "config.env"), "utf8"),
        ).get("HSTS_MAX_AGE_SECONDS"),
      ).toBe("31536000");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("as a script, a failed pull exits 1, so npm run update stops before pulling images", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "oneuptime-update-script-"),
    );

    try {
      fs.mkdirSync(path.join(directory, "Scripts", "Install"), {
        recursive: true,
      });
      for (const file of [
        "Update.js",
        "StartOutput.js",
        "MergeEnvTemplate.js",
      ]) {
        fs.copyFileSync(
          path.join(REPO_ROOT, "Scripts", "Install", file),
          path.join(directory, "Scripts", "Install", file),
        );
      }
      fs.mkdirSync(path.join(directory, "bin"));
      fs.writeFileSync(
        path.join(directory, "bin", "git"),
        [
          "#!/bin/sh",
          'case "$1" in',
          "  symbolic-ref) echo release ;;",
          "  pull) echo 'fatal: Not possible to fast-forward, aborting.' >&2; exit 128 ;;",
          "esac",
          "exit 0",
          "",
        ].join("\n"),
        { mode: 0o755 },
      );

      const result = spawnSync(
        process.execPath,
        ["./Scripts/Install/Update.js"],
        {
          cwd: directory,
          env: Object.assign({}, process.env, {
            PATH: `${path.join(directory, "bin")}${path.delimiter}${process.env.PATH}`,
          }),
          encoding: "utf8",
        },
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        "  ✗ git pull could not bring release up to date",
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
