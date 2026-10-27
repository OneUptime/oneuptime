"use strict";

/**
 * Scripts/Install/WithConfig.sh: runs a command with config.env's settings in
 * its environment, each value as written.
 *
 * `npm start`, `npm run update`, `npm run logs` and the other root scripts
 * that wrap Docker Compose used to run `export $(grep -v '^#' config.env |
 * xargs)` first, and so did backup.sh and restore.sh. That splits every value
 * at its spaces and lets the shell expand what is left (#5229's follow-ups):
 * config.example.env's own GLOBAL_PROBE_1_DESCRIPTION reached the probe as
 * "Global", a value like "EU probe (Frankfurt)" stopped `npm start` with "bad
 * variable name", and a value holding a * became the folder's file names.
 *
 * These tests run the loader itself under every POSIX shell on the machine
 * (sh, dash, bash and BusyBox's, the ones Debian, Ubuntu, RHEL and Alpine
 * servers have), print the environment it hands the command, and hold it to
 * ReplacePlaceholderSecrets.js's readSettings - the reading every other step
 * of `npm start` gives config.env.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  readSettings,
} = require("../../Scripts/Install/ReplacePlaceholderSecrets");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const LOADER = path.join(REPO_ROOT, "Scripts", "Install", "WithConfig.sh");
const LOADER_STEP = "sh ./Scripts/Install/WithConfig.sh ";
const ROOT_PACKAGE = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
);
const TEMPLATE = fs.readFileSync(
  path.join(REPO_ROOT, "config.example.env"),
  "utf8",
);

// A shell this machine can run the loader with, by the command that runs it.
const SHELLS = [
  ["sh", ["sh"]],
  ["dash", ["dash"]],
  ["bash", ["bash"]],
  ["busybox sh", ["busybox", "sh"]],
].filter(([, command]) => {
  return (
    spawnSync(command[0], [...command.slice(1), "-c", "exit 0"], {
      encoding: "utf8",
    }).status === 0
  );
});

/*
 * Runs the loader in a throwaway directory holding `config` as config.env
 * (none when null), with the shell `shell`, the environment `env` adds and
 * the command `command`. By default the command prints its environment, one
 * NUL-separated NAME=value at a time.
 */
function withConfig({ config, env, command, shell, files }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-with-"));

  try {
    if (config !== null && config !== undefined) {
      fs.writeFileSync(path.join(directory, "config.env"), config);
    }
    for (const file of files || []) {
      fs.writeFileSync(path.join(directory, file), "");
    }

    const runner = shell || ["sh"];
    const result = spawnSync(
      runner[0],
      [...runner.slice(1), LOADER, ...(command || ["env", "-0"])],
      {
        cwd: directory,
        encoding: "utf8",
        env: Object.assign({ PATH: process.env.PATH }, env || {}),
      },
    );

    return {
      status: result.status,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

// `env -0`'s output as a Map.
function environmentOf(stdout) {
  const environment = new Map();

  for (const entry of stdout.split("\0")) {
    if (!entry) {
      continue;
    }
    const at = entry.indexOf("=");
    environment.set(entry.slice(0, at), entry.slice(at + 1));
  }

  return environment;
}

const TRICKY = [
  "# a comment",
  "   # an indented comment",
  "// a comment the other scripts skip too",
  "",
  "PLAIN=value",
  "SPACES=Global probe to monitor oneuptime resources",
  'QUOTED="Global probe to monitor oneuptime resources"',
  "SINGLE='EU probe (Frankfurt)'",
  "DOLLAR=pa$word${DATABASE_PASSWORD}$(touch pwned)`touch pwned`",
  "STAR=*",
  "HASH=abc # stays",
  "EQUALS=a=b=c",
  "  PADDED  =  padded value  ",
  "EMPTY=",
  "BACKSLASH=a\\nb\\\\c",
  "TWICE=first",
  "TWICE=second",
  "MISMATCHED=\"half'",
  'INNER=" spaced inside "',
  "SEMICOLON=a; touch pwned",
  "NO_NEWLINE_AT_THE_END=last",
].join("\n");

describe("the loader reads config.env as written, in every shell", () => {
  test("this machine has a POSIX sh to try it with", () => {
    expect(SHELLS.map(([name]) => name)).toContain("sh");
  });

  describe.each(SHELLS)("%s", (_name, shell) => {
    test("every value as readSettings reads it: spaces, quotes, $, *, #, = and \\ kept, nothing run", () => {
      const run = withConfig({ config: TRICKY, shell, files: ["a-file"] });
      const environment = environmentOf(run.stdout);
      const expected = readSettings(TRICKY);

      expect(run.status).toBe(0);
      for (const [name, value] of expected) {
        expect({ name, value: environment.get(name) }).toEqual({ name, value });
      }
      expect(environment.get("SPACES")).toBe(
        "Global probe to monitor oneuptime resources",
      );
      expect(environment.get("QUOTED")).toBe(
        "Global probe to monitor oneuptime resources",
      );
      expect(environment.get("SINGLE")).toBe("EU probe (Frankfurt)");
      expect(environment.get("STAR")).toBe("*");
      expect(environment.get("DOLLAR")).toBe(
        "pa$word${DATABASE_PASSWORD}$(touch pwned)`touch pwned`",
      );
      expect(environment.get("PADDED")).toBe("padded value");
      expect(environment.get("TWICE")).toBe("second");
      expect(environment.get("INNER")).toBe("spaced inside");
      expect(environment.get("MISMATCHED")).toBe("\"half'");
      expect(environment.get("NO_NEWLINE_AT_THE_END")).toBe("last");
      // Comments set nothing.
      expect([...environment.keys()].some((key) => key.includes("#"))).toBe(
        false,
      );
    });

    test("no value is run as a command", () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-"));

      try {
        fs.writeFileSync(path.join(directory, "config.env"), TRICKY);
        const result = spawnSync(
          shell[0],
          [...shell.slice(1), LOADER, "true"],
          {
            cwd: directory,
            encoding: "utf8",
            env: { PATH: process.env.PATH },
          },
        );

        expect(result.status).toBe(0);
        expect(fs.existsSync(path.join(directory, "pwned"))).toBe(false);
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });

    test("Windows line endings are read as line endings", () => {
      const run = withConfig({
        config: "HOST=oneuptime.example.com\r\nPORT_SETTING=8080\r\n",
        shell,
      });
      const environment = environmentOf(run.stdout);

      expect(environment.get("HOST")).toBe("oneuptime.example.com");
      expect(environment.get("PORT_SETTING")).toBe("8080");
    });

    test("an export before the name is allowed", () => {
      const run = withConfig({ config: "export EXPORTED=yes\n", shell });

      expect(environmentOf(run.stdout).get("EXPORTED")).toBe("yes");
    });

    test("a line that is not a setting is skipped with a warning, and the command still runs", () => {
      const run = withConfig({
        config: "BAD NAME=x\n1DIGIT=x\nGOOD=yes\nno equals sign\n",
        shell,
      });
      const environment = environmentOf(run.stdout);

      expect(run.status).toBe(0);
      expect(environment.get("GOOD")).toBe("yes");
      expect(environment.has("1DIGIT")).toBe(false);
      expect(run.stderr).toContain(
        './config.env line 1: "BAD NAME" is not a setting name, so the line was skipped.',
      );
      expect(run.stderr).toContain(
        './config.env line 2: "1DIGIT" is not a setting name, so the line was skipped.',
      );
    });
  });
});

describe("what the command gets", () => {
  test("config.env's values replace the environment's, as the export did (zsh sets a HOST of its own)", () => {
    const run = withConfig({
      config: "HOST=oneuptime.example.com\n",
      env: { HOST: "my-laptop", KEPT: "from the environment" },
    });
    const environment = environmentOf(run.stdout);

    expect(environment.get("HOST")).toBe("oneuptime.example.com");
    expect(environment.get("KEPT")).toBe("from the environment");
  });

  test("without a config.env, the command runs with the environment as it is", () => {
    const run = withConfig({ config: null, env: { KEPT: "yes" } });

    expect(run.status).toBe(0);
    expect(environmentOf(run.stdout).get("KEPT")).toBe("yes");
    expect(run.stderr).toBe("");
  });

  test("ONEUPTIME_CONFIG_FILE names another file", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-"));

    try {
      fs.writeFileSync(path.join(directory, "other.env"), "FROM_OTHER=yes\n");
      const result = spawnSync("sh", [LOADER, "env", "-0"], {
        cwd: directory,
        encoding: "utf8",
        env: { PATH: process.env.PATH, ONEUPTIME_CONFIG_FILE: "./other.env" },
      });

      expect(environmentOf(result.stdout).get("FROM_OTHER")).toBe("yes");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("the command's arguments arrive as given, and its exit status is the loader's", () => {
    const echo = withConfig({
      config: "PLAIN=value\n",
      command: ["sh", "-c", 'printf "%s|" "$@"', "sh", "two words", "*", ""],
      files: ["a-file"],
    });
    const failing = withConfig({
      config: "PLAIN=value\n",
      command: ["sh", "-c", "exit 3"],
    });

    expect(echo.stdout).toBe("two words|*||");
    expect(failing.status).toBe(3);
  });

  test("with no command it says how to use it, and fails", () => {
    const run = withConfig({ config: "PLAIN=value\n", command: [] });

    expect(run.status).toBe(64);
    expect(run.stderr).toContain(
      "Usage: sh Scripts/Install/WithConfig.sh <command> [arguments...]",
    );
  });

  test("a setting with the name the loader keeps its own line in is set as written too", () => {
    const run = withConfig({
      config: "_wc_line=mine\n_wc_name=mine too\nAFTER=yes\n",
    });
    const environment = environmentOf(run.stdout);

    expect(environment.get("AFTER")).toBe("yes");
    // The loader's own variables are not exported on their own.
    expect(environment.has("_wc_value")).toBe(false);
  });
});

describe("config.example.env, through the loader", () => {
  test("every setting reaches Compose exactly as readSettings reads it", () => {
    const run = withConfig({ config: TEMPLATE });
    const environment = environmentOf(run.stdout);
    const expected = readSettings(TEMPLATE);

    expect(run.status).toBe(0);
    expect(run.stderr).toBe("");
    for (const [name, value] of expected) {
      expect({ name, value: environment.get(name) }).toEqual({ name, value });
    }
  });

  test("the bundled probes' descriptions arrive whole: the export cut them to 'Global'", () => {
    const environment = environmentOf(withConfig({ config: TEMPLATE }).stdout);

    expect(environment.get("GLOBAL_PROBE_1_DESCRIPTION")).toBe(
      "Global probe to monitor oneuptime resources",
    );
    expect(environment.get("GLOBAL_PROBE_1_NAME")).toBe("Probe-1");
  });
});

describe("every root script that reads config.env reads it through the loader", () => {
  const readsConfig = Object.entries(ROOT_PACKAGE.scripts).filter(
    ([, command]) => {
      return command.includes("config.env") || command.includes(LOADER_STEP);
    },
  );

  test("none exports config.env with xargs any more", () => {
    for (const [name, command] of Object.entries(ROOT_PACKAGE.scripts)) {
      expect({ name, xargs: command.includes("xargs") }).toEqual({
        name,
        xargs: false,
      });
    }
  });

  test("npm start, update, ps, logs, stop, exec and pull run Compose through it", () => {
    for (const name of [
      "start",
      "update",
      "ps",
      "logs",
      "follow-logs",
      "save-logs",
      "write-logs",
      "stop",
      "exec",
      "pull",
      "run-probes",
    ]) {
      expect({
        name,
        throughLoader: ROOT_PACKAGE.scripts[name].includes(
          `${LOADER_STEP}docker compose `,
        ),
      }).toEqual({ name, throughLoader: true });
    }
    expect(readsConfig.length).toBeGreaterThanOrEqual(11);
  });

  test("backup.sh and restore.sh run themselves again through it", () => {
    for (const script of ["backup.sh", "restore.sh"]) {
      // The script without its comments, which may tell what it used to do.
      const code = fs
        .readFileSync(path.join(REPO_ROOT, script), "utf8")
        .split("\n")
        .filter((line) => {
          return !line.trim().startsWith("#");
        })
        .join("\n");

      expect(code).not.toContain("xargs");
      expect(code).toContain(
        'ONEUPTIME_WITH_CONFIG=1 exec sh ./Scripts/Install/WithConfig.sh bash "$0" "$@"',
      );
    }
  });

  test("the loader parses under sh -n and every shell here", () => {
    for (const [, shell] of SHELLS) {
      const result = spawnSync(shell[0], [...shell.slice(1), "-n", LOADER], {
        encoding: "utf8",
      });

      expect({ shell: shell.join(" "), stderr: result.stderr }).toEqual({
        shell: shell.join(" "),
        stderr: "",
      });
    }
  });
});
