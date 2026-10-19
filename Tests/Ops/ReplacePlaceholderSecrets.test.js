"use strict";

/**
 * Scripts/Install/ReplacePlaceholderSecrets.js: config.env gets a random
 * ONEUPTIME_SECRET in place of the placeholder config.example.env ships.
 *
 * OneUptime's own services prove a call comes from one of them with the
 * cluster key (ONEUPTIME_SECRET), and OneUptime refuses a value its repository
 * ships from every caller (Common/Server/EnvironmentConfig.isShippedSecretValue,
 * Common/Server/Middleware/ClusterKeyAuthorization). The app's processes cope
 * on their own - they derive a key of the installation's own - but the
 * bundled Runner cannot, so with Docker Compose the shared key has to come
 * from config.env, which every container reads. The README's install copies
 * config.example.env as it is and runs `npm start`, and `npm run update`
 * merges new settings in with their placeholder values, so both give each
 * shared key a random value when it still holds a placeholder:
 *
 *   - `npm start` runs the script as a step of the start script (not a
 *     prestart hook, which npm skips under ignore-scripts);
 *   - `npm run update` runs it through prerun -> Scripts/Install/configure.sh,
 *     right after the template merge.
 *
 * The shared keys are ONEUPTIME_SECRET (the cluster key), REGISTER_PROBE_KEY,
 * GLOBAL_PROBE_1_KEY, GLOBAL_PROBE_2_KEY and ONEUPTIME_RUNNER_KEY: nothing
 * stored depends on them in a way a fresh value breaks (a probe or the Runner
 * re-registers under its new key), and every container that needs one reads
 * the same file. The datastore passwords and ENCRYPTION_SECRET are the
 * operator's to set (PostgreSQL takes its password once, and a new
 * ENCRYPTION_SECRET makes what is encrypted unreadable).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT_PATH = path.join(
  REPO_ROOT,
  "Scripts",
  "Install",
  "ReplacePlaceholderSecrets.js",
);
const CONFIG_EXAMPLE_PATH = path.join(REPO_ROOT, "config.example.env");
const TEMPLATE = fs.readFileSync(CONFIG_EXAMPLE_PATH, "utf8");

const {
  GENERATED_SECRETS,
  SHIPPED_FALLBACK,
  PLACEHOLDER_MARK,
  isPlaceholderValue,
  replacePlaceholderSecrets,
  describeReplacedSecrets,
  describeUnchangedConfig,
  init,
} = require(SCRIPT_PATH);

const HEX_256_BITS = /^[0-9a-f]{64}$/;
const PLACEHOLDER = "please-change-this-to-random-value";

const workspaces = [];

afterAll(() => {
  for (const dir of workspaces) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "replace-placeholders-"));
  workspaces.push(dir);
  return dir;
}

// The value of the last KEY= line, as `export $(grep -v '^#' config.env | xargs)` would leave it.
function valueOf(contents, key) {
  const lines = contents.split("\n").filter((line) => {
    return line.startsWith(`${key}=`);
  });

  if (lines.length === 0) {
    return undefined;
  }

  return lines[lines.length - 1].slice(key.length + 1).replace(/\r$/, "");
}

/**
 * Runs the real script against a throwaway config.env, from a directory shaped
 * like the repository root, the way the start script and configure.sh run it.
 */
function runScript(dir, configEnvContents) {
  fs.mkdirSync(path.join(dir, "Scripts", "Install"), { recursive: true });
  fs.copyFileSync(
    SCRIPT_PATH,
    path.join(dir, "Scripts", "Install", "ReplacePlaceholderSecrets.js"),
  );

  if (configEnvContents !== undefined) {
    fs.writeFileSync(path.join(dir, "config.env"), configEnvContents);
  }

  const stdout = execFileSync(
    process.execPath,
    ["./Scripts/Install/ReplacePlaceholderSecrets.js"],
    { cwd: dir, stdio: "pipe", encoding: "utf8" },
  );

  const configPath = path.join(dir, "config.env");

  return {
    stdout,
    contents: fs.existsSync(configPath)
      ? fs.readFileSync(configPath, "utf8")
      : undefined,
  };
}

let counter = 0;

function fakeSecret() {
  counter++;
  return `generated-${counter}`;
}

describe("the secrets it may set", () => {
  test("is the cluster key, the probe keys and the Runner key", () => {
    expect(GENERATED_SECRETS).toEqual([
      "ONEUPTIME_SECRET",
      "REGISTER_PROBE_KEY",
      "GLOBAL_PROBE_1_KEY",
      "GLOBAL_PROBE_2_KEY",
      "ONEUPTIME_RUNNER_KEY",
    ]);
  });

  test("uses the same rule as the server for what counts as shipped", () => {
    const environmentConfig = fs.readFileSync(
      path.join(REPO_ROOT, "packages/Common/Server/EnvironmentConfig.ts"),
      "utf8",
    );

    expect(environmentConfig).toContain(
      `export const ShippedSecretFallback: string = "${SHIPPED_FALLBACK}";`,
    );
    expect(environmentConfig).toContain(
      `export const ShippedSecretPlaceholderMark: string = "${PLACEHOLDER_MARK}";`,
    );
  });

  test("treats every placeholder config.example.env ships as one", () => {
    const placeholders = TEMPLATE.split("\n")
      .filter((line) => {
        return !line.trim().startsWith("#") && line.includes("=");
      })
      .map((line) => {
        return line.slice(line.indexOf("=") + 1).trim();
      })
      .filter((value) => {
        return value.includes("change-this");
      });

    expect(placeholders.length).toBeGreaterThan(0);

    for (const placeholder of placeholders) {
      expect(isPlaceholderValue(placeholder)).toBe(true);
    }

    expect(valueOf(TEMPLATE, "ONEUPTIME_SECRET")).toBe(PLACEHOLDER);
  });

  test.each([
    ["the old fallback", "secret", true],
    ["the placeholder", PLACEHOLDER, true],
    ["a placeholder with something appended", `${PLACEHOLDER}-2`, true],
    [
      "a probe's placeholder",
      "probe-1-please-change-this-to-random-value",
      true,
    ],
    ["an operator's value", "3b9f1c7e5a2d48f6b0e9c3a7d1f5b8e2", false],
    ["one that starts like the fallback", "secretive", false],
    ["an empty value", "", false],
  ])("%s: %p", (_label, value, expected) => {
    expect(isPlaceholderValue(value)).toBe(expected);
  });
});

describe("replacePlaceholderSecrets", () => {
  test("gives each placeholder shared key a new value, and leaves every other line as it was", () => {
    let counter = 0;
    const result = replacePlaceholderSecrets(TEMPLATE, () => {
      counter++;
      return `the-new-value-${counter}`;
    });

    expect(result.replaced).toEqual([
      "ONEUPTIME_SECRET",
      "REGISTER_PROBE_KEY",
      "GLOBAL_PROBE_1_KEY",
      "GLOBAL_PROBE_2_KEY",
      "ONEUPTIME_RUNNER_KEY",
    ]);

    // Each got a value of its own; no two share one.
    const values = result.replaced.map((key) => {
      return valueOf(result.contents, key);
    });
    expect(new Set(values).size).toBe(values.length);

    const before = TEMPLATE.split("\n");
    const after = result.contents.split("\n");

    expect(after.length).toBe(before.length);

    const changedKeys = before
      .map((line, index) => {
        return [line, after[index]];
      })
      .filter(([was, now]) => {
        return was !== now;
      })
      .map(([was]) => {
        return was.slice(0, was.indexOf("="));
      });

    // Only the five shared keys changed, each once.
    expect(changedKeys).toEqual([
      "ONEUPTIME_SECRET",
      "REGISTER_PROBE_KEY",
      "GLOBAL_PROBE_1_KEY",
      "GLOBAL_PROBE_2_KEY",
      "ONEUPTIME_RUNNER_KEY",
    ]);
  });

  test("gives a placeholder ONEUPTIME_SECRET a new value", () => {
    const result = replacePlaceholderSecrets(TEMPLATE, () => {
      return "the-new-cluster-key";
    });

    expect(result.replaced).toContain("ONEUPTIME_SECRET");
    expect(valueOf(result.contents, "ONEUPTIME_SECRET")).toBe(
      "the-new-cluster-key",
    );
  });

  test("gives the probe and Runner keys a new value", () => {
    let counter = 0;
    const result = replacePlaceholderSecrets(TEMPLATE, () => {
      counter++;
      return `fresh-${counter}`;
    });

    for (const key of [
      "REGISTER_PROBE_KEY",
      "GLOBAL_PROBE_1_KEY",
      "GLOBAL_PROBE_2_KEY",
      "ONEUPTIME_RUNNER_KEY",
    ]) {
      expect(result.replaced).toContain(key);
      expect(valueOf(result.contents, key)).not.toBe(valueOf(TEMPLATE, key));
      expect(isPlaceholderValue(valueOf(result.contents, key))).toBe(false);
    }
  });

  test("leaves the datastore passwords and ENCRYPTION_SECRET for the operator to set", () => {
    const result = replacePlaceholderSecrets(TEMPLATE, fakeSecret);

    for (const key of [
      "ENCRYPTION_SECRET",
      "DATABASE_PASSWORD",
      "CLICKHOUSE_PASSWORD",
      "VALKEY_PASSWORD",
    ]) {
      expect(valueOf(result.contents, key)).toBe(valueOf(TEMPLATE, key));
    }
  });

  test.each([
    ["an operator's key", "ONEUPTIME_SECRET=3b9f1c7e5a2d48f6b0e9c3a7d1f5b8e2"],
    ["an empty value", "ONEUPTIME_SECRET="],
    ["a commented-out placeholder", `# ONEUPTIME_SECRET=${PLACEHOLDER}`],
    [
      "a different setting with the same prefix",
      `ONEUPTIME_SECRET_X=${PLACEHOLDER}`,
    ],
  ])("leaves %s alone", (_label, line) => {
    const contents = `HOST=localhost\n${line}\nAPP_TAG=release\n`;
    const result = replacePlaceholderSecrets(contents, fakeSecret);

    expect(result.contents).toBe(contents);
    expect(result.replaced).toEqual([]);
  });

  test.each([
    ["the old fallback", "ONEUPTIME_SECRET=secret"],
    ["a quoted placeholder", `ONEUPTIME_SECRET="${PLACEHOLDER}"`],
    ["a single-quoted placeholder", `ONEUPTIME_SECRET='${PLACEHOLDER}'`],
    ["a padded placeholder", `ONEUPTIME_SECRET=  ${PLACEHOLDER}  `],
    ["spaces around the name", ` ONEUPTIME_SECRET =${PLACEHOLDER}`],
  ])("replaces %s", (_label, line) => {
    const result = replacePlaceholderSecrets(`${line}\n`, () => {
      return "fresh";
    });

    expect(result.replaced).toEqual(["ONEUPTIME_SECRET"]);
    expect(result.contents).toBe(
      `${line.slice(0, line.indexOf("=") + 1)}fresh\n`,
    );
  });

  test("keeps Windows line endings", () => {
    const contents = `HOST=localhost\r\nONEUPTIME_SECRET=${PLACEHOLDER}\r\nAPP_TAG=release\r\n`;
    const result = replacePlaceholderSecrets(contents, () => {
      return "fresh";
    });

    expect(result.contents).toBe(
      "HOST=localhost\r\nONEUPTIME_SECRET=fresh\r\nAPP_TAG=release\r\n",
    );
  });

  test("gives every assignment of the name the same value, so whichever the shell reads last, the containers agree", () => {
    const result = replacePlaceholderSecrets(
      `ONEUPTIME_SECRET=${PLACEHOLDER}\nHOST=x\nONEUPTIME_SECRET=secret\n`,
      fakeSecret,
    );
    const values = result.contents
      .split("\n")
      .filter((line) => {
        return line.startsWith("ONEUPTIME_SECRET=");
      })
      .map((line) => {
        return line.slice("ONEUPTIME_SECRET=".length);
      });

    expect(values).toHaveLength(2);
    expect(values[0]).toBe(values[1]);
    expect(result.replaced).toEqual(["ONEUPTIME_SECRET"]);
  });

  test("a second run changes nothing", () => {
    const first = replacePlaceholderSecrets(TEMPLATE);
    const second = replacePlaceholderSecrets(first.contents);

    expect(second.contents).toBe(first.contents);
    expect(second.replaced).toEqual([]);
  });

  test("the value it makes is 256 bits from the CSPRNG, different every time", () => {
    const values = new Set();

    for (let run = 0; run < 20; run++) {
      const value = valueOf(
        replacePlaceholderSecrets(`ONEUPTIME_SECRET=${PLACEHOLDER}\n`).contents,
        "ONEUPTIME_SECRET",
      );

      expect(value).toMatch(HEX_256_BITS);
      values.add(value);
    }

    expect(values.size).toBe(20);
  });

  test("says what it did, listing the keys it set", () => {
    expect(
      describeReplacedSecrets(["ONEUPTIME_SECRET", "REGISTER_PROBE_KEY"]),
    ).toBe(
      "config.env: ONEUPTIME_SECRET, REGISTER_PROBE_KEY still held the placeholder from config.example.env, so each was set to a new random value. These are the keys OneUptime's own services, probes and the bundled Runner present to each other; OneUptime refuses the public placeholder for every one of them, and each container reads its value from config.env.",
    );
  });
});

const GENERATED_KEY_LINE =
  /^(ONEUPTIME_SECRET|REGISTER_PROBE_KEY|GLOBAL_PROBE_1_KEY|GLOBAL_PROBE_2_KEY|ONEUPTIME_RUNNER_KEY)=.*$/gm;

describe("the script, run the way npm start and configure.sh run it", () => {
  test("a config.env copied from config.example.env gets random shared keys and nothing else changes", () => {
    const run = runScript(workspace(), TEMPLATE);

    for (const key of GENERATED_SECRETS) {
      expect(valueOf(run.contents, key)).toMatch(HEX_256_BITS);
    }

    // Everything but the generated keys' lines is byte-for-byte unchanged.
    expect(run.contents.replace(GENERATED_KEY_LINE, "")).toBe(
      TEMPLATE.replace(GENERATED_KEY_LINE, ""),
    );
    expect(run.stdout).toContain(
      "still held the placeholder from config.example.env",
    );
  });

  test("a second start keeps the value it made, and prints nothing", () => {
    const dir = workspace();
    const first = runScript(dir, TEMPLATE);
    const second = runScript(dir);

    expect(second.contents).toBe(first.contents);
    expect(second.stdout).toBe("");
  });

  test("a config.env whose operator set the key is not written at all", () => {
    const dir = workspace();
    const contents = "ONEUPTIME_SECRET=my-own-key\nHOST=localhost\n";
    const configPath = path.join(dir, "config.env");

    runScript(dir, contents);
    const modifiedBefore = fs.statSync(configPath).mtimeMs;
    const run = runScript(dir);

    expect(run.contents).toBe(contents);
    expect(run.stdout).toBe("");
    expect(fs.statSync(configPath).mtimeMs).toBe(modifiedBefore);
  });

  test("without a config.env it does nothing, and creates none", () => {
    const dir = workspace();
    const run = runScript(dir);

    expect(run.contents).toBeUndefined();
    expect(run.stdout).toBe("");
    expect(fs.existsSync(path.join(dir, "config.env"))).toBe(false);
  });

  /*
   * `npm start` exports config.env with
   * `export $(grep -v '^#' config.env | xargs)` before `docker compose up`,
   * so what matters is the value that export produces.
   */
  test("the exported ONEUPTIME_SECRET is the new value, quoted placeholder or not", () => {
    for (const line of [
      `ONEUPTIME_SECRET=${PLACEHOLDER}`,
      `ONEUPTIME_SECRET="${PLACEHOLDER}"`,
    ]) {
      const dir = workspace();
      runScript(dir, `HOST=localhost\n${line}\n`);

      const exported = spawnSync(
        "bash",
        [
          "-c",
          "export $(grep -v '^#' config.env | xargs) && printf '%s' \"$ONEUPTIME_SECRET\"",
        ],
        { cwd: dir, encoding: "utf8" },
      );

      expect(exported.status).toBe(0);
      expect(exported.stdout).toMatch(HEX_256_BITS);
    }
  });

  test("requiring the script only exports functions: it reads and writes no files", () => {
    const dir = workspace();
    fs.writeFileSync(
      path.join(dir, "config.env"),
      `ONEUPTIME_SECRET=${PLACEHOLDER}\n`,
    );

    const required = spawnSync(
      process.execPath,
      ["-e", `require(${JSON.stringify(SCRIPT_PATH)})`],
      { cwd: dir, encoding: "utf8" },
    );

    expect(required.status).toBe(0);
    expect(fs.readFileSync(path.join(dir, "config.env"), "utf8")).toBe(
      `ONEUPTIME_SECRET=${PLACEHOLDER}\n`,
    );
  });
});

/*
 * A config.env it cannot read or write never stops a start: OneUptime's own
 * services do not need the new value, only the bundled Runner does, so the
 * script says what to set and leaves the file as it was.
 */
describe("a config.env it cannot read or write", () => {
  // A stand-in file system holding one config.env, whose reads or writes fail on demand.
  function fileSystemWith(contents, failure) {
    const fileSystem = {
      contents: contents,
      writes: 0,
      existsSync: () => {
        return true;
      },
      readFileSync: () => {
        if (failure === "read") {
          throw Object.assign(new Error("EACCES: permission denied"), {
            code: "EACCES",
          });
        }
        return fileSystem.contents;
      },
      writeFileSync: (_path, newContents) => {
        fileSystem.writes++;
        if (failure === "write") {
          throw Object.assign(new Error("EROFS: read-only file system"), {
            code: "EROFS",
          });
        }
        fileSystem.contents = newContents;
      },
    };
    return fileSystem;
  }

  function output() {
    const lines = { logged: [], warned: [] };
    return {
      lines: lines,
      log: (line) => {
        lines.logged.push(line);
      },
      warn: (line) => {
        lines.warned.push(line);
      },
    };
  }

  test("one it cannot write is left as it was, and the script says what to set instead of throwing", () => {
    const contents = `HOST=localhost\nONEUPTIME_SECRET=${PLACEHOLDER}\n`;
    const fileSystem = fileSystemWith(contents, "write");
    const out = output();

    expect(
      init({ fileSystem: fileSystem, log: out.log, warn: out.warn }),
    ).toEqual([]);
    expect(fileSystem.writes).toBe(1);
    expect(fileSystem.contents).toBe(contents);
    expect(out.lines.logged).toEqual([]);
    expect(out.lines.warned).toEqual([
      describeUnchangedConfig(
        "written",
        new Error("EROFS: read-only file system"),
      ),
    ]);
  });

  test("one it cannot read is not written at all, and the script says so instead of throwing", () => {
    const fileSystem = fileSystemWith("", "read");
    const out = output();

    expect(
      init({ fileSystem: fileSystem, log: out.log, warn: out.warn }),
    ).toEqual([]);
    expect(fileSystem.writes).toBe(0);
    expect(out.lines.logged).toEqual([]);
    expect(out.lines.warned).toEqual([
      describeUnchangedConfig("read", new Error("EACCES: permission denied")),
    ]);
  });

  test("one it can write gets the new value, and the script says what it did", () => {
    const fileSystem = fileSystemWith(`ONEUPTIME_SECRET=${PLACEHOLDER}\n`);
    const out = output();

    expect(
      init({ fileSystem: fileSystem, log: out.log, warn: out.warn }),
    ).toEqual(["ONEUPTIME_SECRET"]);
    expect(valueOf(fileSystem.contents, "ONEUPTIME_SECRET")).toMatch(
      HEX_256_BITS,
    );
    expect(out.lines.logged).toEqual([
      describeReplacedSecrets(["ONEUPTIME_SECRET"]),
    ]);
    expect(out.lines.warned).toEqual([]);
  });

  test("the message names the file, the reason, and what the probes and Runner need", () => {
    expect(
      describeUnchangedConfig(
        "written",
        new Error("EROFS: read-only file system"),
      ),
    ).toBe(
      "config.env could not be written (EROFS: read-only file system), so its placeholder secrets were not given random values. OneUptime starts anyway, but the bundled probes and Runner do not register while REGISTER_PROBE_KEY, GLOBAL_PROBE_1_KEY, GLOBAL_PROBE_2_KEY, ONEUPTIME_SECRET or ONEUPTIME_RUNNER_KEY still holds the placeholder from config.example.env: set each to a long random value (openssl rand -hex 32 makes one).",
    );
  });

  test("the real script exits 0 when config.env is not a file it can read, so npm start goes on", () => {
    const dir = workspace();
    fs.mkdirSync(path.join(dir, "Scripts", "Install"), { recursive: true });
    fs.copyFileSync(
      SCRIPT_PATH,
      path.join(dir, "Scripts", "Install", "ReplacePlaceholderSecrets.js"),
    );
    // A directory where config.env belongs: it exists, and reading it fails.
    fs.mkdirSync(path.join(dir, "config.env"));

    const run = spawnSync(
      process.execPath,
      ["./Scripts/Install/ReplacePlaceholderSecrets.js"],
      { cwd: dir, encoding: "utf8" },
    );

    expect(run.status).toBe(0);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain("config.env could not be read (");
    expect(run.stderr).toContain(
      "so its placeholder secrets were not given random values. OneUptime starts anyway",
    );
    expect(fs.statSync(path.join(dir, "config.env")).isDirectory()).toBe(true);
  });
});

describe("where it runs", () => {
  test("npm start runs it as a step of the start script, not a prestart hook ignore-scripts would skip", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
    );

    // Not a prestart hook: npm skips pre/post scripts under ignore-scripts.
    expect(packageJson.scripts.prestart).toBeUndefined();
    expect(packageJson.scripts.start).toContain(
      "node ./Scripts/Install/ReplacePlaceholderSecrets.js",
    );
    expect(packageJson.scripts.start).toContain("docker compose up");
    // npm run update ends in npm run start, so it runs there too.
    expect(packageJson.scripts.update).toContain("npm run start");
  });

  test("configure.sh (npm run update, npm run dev) runs it right after the template merge, before config.env is read", () => {
    const configure = fs.readFileSync(
      path.join(REPO_ROOT, "Scripts", "Install", "configure.sh"),
      "utf8",
    );
    const merge = configure.indexOf(
      "node ./Scripts/Install/MergeEnvTemplate.js",
    );
    const replace = configure.indexOf(
      "node ./Scripts/Install/ReplacePlaceholderSecrets.js",
    );
    const read = configure.indexOf("source config.env");

    expect(merge).toBeGreaterThan(-1);
    expect(replace).toBeGreaterThan(merge);
    expect(read).toBeGreaterThan(replace);
  });

  /*
   * The point of setting it in config.env: the app and the bundled Runner
   * both take ONEUPTIME_SECRET from it, so they share the new value.
   */
  test("Docker Compose hands the app and the bundled Runner the same ONEUPTIME_SECRET from config.env", () => {
    const compose = yaml.load(
      fs.readFileSync(path.join(REPO_ROOT, "docker-compose.base.yml"), "utf8"),
    );

    for (const service of ["app", "runner"]) {
      expect(compose.services[service].environment.ONEUPTIME_SECRET).toBe(
        "${ONEUPTIME_SECRET}",
      );
    }
  });
});
