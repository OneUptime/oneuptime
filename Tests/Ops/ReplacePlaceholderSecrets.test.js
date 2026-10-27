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
 *   - `npm run update` ends with `npm run start`; `npm run dev` runs it through prerun -> Scripts/Install/configure.sh,
 *     right after the template merge.
 *
 * The shared keys are ONEUPTIME_SECRET (the cluster key), REGISTER_PROBE_KEY,
 * GLOBAL_PROBE_1_KEY, GLOBAL_PROBE_2_KEY and GLOBAL_RUNNER_KEY: nothing stored
 * depends on them in a way a fresh value breaks (a probe re-registers under
 * its new key, and the app keeps the global Runner's row from its key on every
 * boot), and every container that needs one reads the same file. So are the passwords of the ClickHouse and the Valkey that
 * Docker Compose runs (CLICKHOUSE_PASSWORD, VALKEY_PASSWORD or the
 * REDIS_PASSWORD it was called before): both take their password from
 * config.env every time their container starts, so a new value reaches them
 * and every container that signs in to them together, ClickHouse's data kept
 * (ComposeDatastorePasswordRuntime.test.js runs that for real). A password for
 * a datastore OneUptime does not run is left as it is, and the operator told.
 * PostgreSQL's password has a step of its own (GenerateDatabasePassword.js:
 * PostgreSQL takes it only when it creates its database), and ENCRYPTION_SECRET
 * is the operator's to set (a new one makes what is encrypted unreadable).
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
  BUNDLED_DATASTORE_PASSWORDS,
  SHIPPED_FALLBACK,
  PLACEHOLDER_MARK,
  isPlaceholderValue,
  readSettings,
  datastorePasswordDecisions,
  replacePlaceholderSecrets,
  describeReplacedSecrets,
  describeExternalDatastorePassword,
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
 * Copies the script, and the module that marks its lines
 * (Scripts/Install/StartOutput.js), into a directory shaped like the
 * repository root.
 */
function copyScript(dir) {
  fs.mkdirSync(path.join(dir, "Scripts", "Install"), { recursive: true });
  fs.copyFileSync(
    SCRIPT_PATH,
    path.join(dir, "Scripts", "Install", "ReplacePlaceholderSecrets.js"),
  );
  fs.copyFileSync(
    path.join(path.dirname(SCRIPT_PATH), "StartOutput.js"),
    path.join(dir, "Scripts", "Install", "StartOutput.js"),
  );
}

/**
 * Runs the real script against a throwaway config.env, from a directory shaped
 * like the repository root, the way the start script and configure.sh run it.
 */
function runScript(dir, configEnvContents) {
  copyScript(dir);

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
  test("is the cluster key, the probe keys and the global Runner's key", () => {
    expect(GENERATED_SECRETS).toEqual([
      "ONEUPTIME_SECRET",
      "REGISTER_PROBE_KEY",
      "GLOBAL_PROBE_1_KEY",
      "GLOBAL_PROBE_2_KEY",
      "GLOBAL_RUNNER_KEY",
    ]);
  });

  /*
   * The shared Runner is gone, and nothing reads its key: the global Runner
   * does the AI code fixes it did. A config.env that still holds the key is
   * left as it is.
   */
  test("leaves ONEUPTIME_RUNNER_KEY alone, which nothing reads any more", () => {
    expect(GENERATED_SECRETS).not.toContain("ONEUPTIME_RUNNER_KEY");
    expect(TEMPLATE).not.toMatch(/^ONEUPTIME_RUNNER_KEY=/m);

    const contents = `ONEUPTIME_RUNNER_KEY=${PLACEHOLDER}\n`;
    const result = replacePlaceholderSecrets(contents, fakeSecret);

    expect(result.contents).toBe(contents);
    expect(result.replaced).toEqual([]);
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
      "CLICKHOUSE_PASSWORD",
      "VALKEY_PASSWORD",
      "GLOBAL_PROBE_1_KEY",
      "GLOBAL_PROBE_2_KEY",
      "GLOBAL_RUNNER_KEY",
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

    // Only the five shared keys and the two bundled datastores' passwords changed, each once.
    expect(changedKeys).toEqual([
      "ONEUPTIME_SECRET",
      "REGISTER_PROBE_KEY",
      "CLICKHOUSE_PASSWORD",
      "VALKEY_PASSWORD",
      "GLOBAL_PROBE_1_KEY",
      "GLOBAL_PROBE_2_KEY",
      "GLOBAL_RUNNER_KEY",
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
      "GLOBAL_RUNNER_KEY",
    ]) {
      expect(result.replaced).toContain(key);
      expect(valueOf(result.contents, key)).not.toBe(valueOf(TEMPLATE, key));
      expect(isPlaceholderValue(valueOf(result.contents, key))).toBe(false);
    }
  });

  test("leaves DATABASE_PASSWORD to its own step and ENCRYPTION_SECRET to the operator", () => {
    const result = replacePlaceholderSecrets(TEMPLATE, fakeSecret);

    for (const key of ["ENCRYPTION_SECRET", "DATABASE_PASSWORD"]) {
      expect(valueOf(result.contents, key)).toBe(valueOf(TEMPLATE, key));
      expect(result.replaced).not.toContain(key);
    }
  });

  test("gives the ClickHouse and Valkey that config.example.env points at a new password each", () => {
    const result = replacePlaceholderSecrets(TEMPLATE);

    expect(valueOf(TEMPLATE, "CLICKHOUSE_HOST")).toBe("clickhouse");
    expect(valueOf(TEMPLATE, "VALKEY_HOST")).toBe("valkey");

    const clickhouse = valueOf(result.contents, "CLICKHOUSE_PASSWORD");
    const valkey = valueOf(result.contents, "VALKEY_PASSWORD");

    expect(clickhouse).toMatch(HEX_256_BITS);
    expect(valkey).toMatch(HEX_256_BITS);
    expect(clickhouse).not.toBe(valkey);
    expect(result.leftForOperator).toEqual([]);
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

  /*
   * One line of the list npm start prints first (StartOutput.js): what it
   * set, never the values.
   */
  test("says what it did, listing the keys it set", () => {
    expect(
      describeReplacedSecrets(["ONEUPTIME_SECRET", "REGISTER_PROBE_KEY"]),
    ).toBe(
      "  ✓ Gave ONEUPTIME_SECRET and REGISTER_PROBE_KEY their own random values in config.env, in place of the public placeholders from config.example.env.",
    );
  });

  test("says what it did for one key", () => {
    expect(describeReplacedSecrets(["GLOBAL_RUNNER_KEY"])).toBe(
      "  ✓ Gave GLOBAL_RUNNER_KEY its own random value in config.env, in place of the public placeholders from config.example.env.",
    );
  });

  test("says what it did for the datastores' passwords, and what else needs the new value", () => {
    expect(
      describeReplacedSecrets(["CLICKHOUSE_PASSWORD", "VALKEY_PASSWORD"]),
    ).toBe(
      "  ✓ Gave CLICKHOUSE_PASSWORD and VALKEY_PASSWORD their own random values in config.env, in place of the public placeholders from config.example.env. The bundled ClickHouse and Valkey take their new passwords as this start recreates them; anything else that signs in to them needs the new value from config.env.",
    );
    expect(describeReplacedSecrets(["REDIS_PASSWORD"])).toBe(
      "  ✓ Gave REDIS_PASSWORD its own random value in config.env, in place of the public placeholders from config.example.env. The bundled Valkey takes its new password as this start recreates it; anything else that signs in to it needs the new value from config.env.",
    );
  });

  test("says both when it set keys and passwords, as a new install's first start does", () => {
    const replaced = replacePlaceholderSecrets(TEMPLATE, fakeSecret).replaced;
    const message = describeReplacedSecrets(replaced);

    expect(message).toContain(
      "ONEUPTIME_SECRET, REGISTER_PROBE_KEY, CLICKHOUSE_PASSWORD, VALKEY_PASSWORD, GLOBAL_PROBE_1_KEY, GLOBAL_PROBE_2_KEY and GLOBAL_RUNNER_KEY their own random values",
    );
    expect(message).toContain(
      "The bundled ClickHouse and Valkey take their new passwords",
    );
    // One line, as every line of the list.
    expect(message.split("\n")).toHaveLength(1);
  });
});

/*
 * The passwords of the datastores Docker Compose runs. Any start may give
 * them a new value, an existing install's too, but only while config.env
 * points at those datastores: a password for one OneUptime does not run
 * belongs to that server.
 */
describe("the passwords of the datastores Docker Compose runs", () => {
  // A config.env with just these lines, and what one run makes of it.
  function run(lines) {
    return replacePlaceholderSecrets(`${lines.join("\n")}\n`, fakeSecret);
  }

  test("are the ClickHouse and the Valkey docker-compose.yml runs, by the names Compose reads", () => {
    expect(
      BUNDLED_DATASTORE_PASSWORDS.map((entry) => {
        return [
          entry.datastore,
          entry.passwordSettings,
          entry.hostSettings,
          entry.bundledHosts,
        ];
      }),
    ).toEqual([
      [
        "ClickHouse",
        ["CLICKHOUSE_PASSWORD"],
        ["CLICKHOUSE_HOST"],
        ["clickhouse"],
      ],
      [
        "Valkey",
        ["VALKEY_PASSWORD", "REDIS_PASSWORD"],
        ["VALKEY_HOST", "REDIS_HOST"],
        ["valkey", "redis"],
      ],
    ]);

    const production = yaml.load(
      fs.readFileSync(path.join(REPO_ROOT, "docker-compose.yml"), "utf8"),
    );
    const base = yaml.load(
      fs.readFileSync(path.join(REPO_ROOT, "docker-compose.base.yml"), "utf8"),
    );

    // The production stack runs both, from the base file's services.
    expect(production.services.clickhouse.extends.service).toBe("clickhouse");
    expect(production.services.valkey.extends.service).toBe("valkey");

    // ClickHouse takes CLICKHOUSE_PASSWORD from the environment it starts with.
    expect(base.services.clickhouse.environment.CLICKHOUSE_PASSWORD).toBe(
      "${CLICKHOUSE_PASSWORD}",
    );

    // Valkey takes it on its command line, from either name, keeps nothing on
    // disk, and answers to "redis" as well.
    expect(base.services.valkey.command).toBe(
      'valkey-server --requirepass "${VALKEY_PASSWORD:-${REDIS_PASSWORD:-}}" --save "" --appendonly no',
    );
    expect(base.services.valkey.networks.oneuptime.aliases).toEqual(["redis"]);

    // Every container that signs in to them reads the same names.
    expect(base["x-common-runtime-variables"].CLICKHOUSE_PASSWORD).toBe(
      "${CLICKHOUSE_PASSWORD}",
    );
    expect(base["x-common-runtime-variables"].VALKEY_PASSWORD).toBe(
      "${VALKEY_PASSWORD:-${REDIS_PASSWORD:-}}",
    );
  });

  test("an existing install's placeholders get new values too, as any start may give them", () => {
    const result = run([
      "CLICKHOUSE_HOST=clickhouse",
      `CLICKHOUSE_PASSWORD=${PLACEHOLDER}`,
      "VALKEY_HOST=valkey",
      `VALKEY_PASSWORD=${PLACEHOLDER}`,
    ]);

    expect(result.replaced).toEqual(["CLICKHOUSE_PASSWORD", "VALKEY_PASSWORD"]);
    expect(
      isPlaceholderValue(valueOf(result.contents, "CLICKHOUSE_PASSWORD")),
    ).toBe(false);
    expect(
      isPlaceholderValue(valueOf(result.contents, "VALKEY_PASSWORD")),
    ).toBe(false);
  });

  test.each([
    ["the old fallback", "secret"],
    ["a quoted placeholder", `"${PLACEHOLDER}"`],
    ["a placeholder with something added", `${PLACEHOLDER}-2`],
  ])("replaces %s", (_label, value) => {
    const result = run([
      "CLICKHOUSE_HOST=clickhouse",
      `CLICKHOUSE_PASSWORD=${value}`,
    ]);

    expect(result.replaced).toEqual(["CLICKHOUSE_PASSWORD"]);
  });

  test.each([
    ["an operator's own password", "3b9f1c7e5a2d48f6b0e9c3a7d1f5b8e2"],
    ["a blank password", ""],
  ])("leaves %s alone, and says nothing", (_label, value) => {
    const contents = `CLICKHOUSE_HOST=clickhouse\nCLICKHOUSE_PASSWORD=${value}\nVALKEY_HOST=valkey\nVALKEY_PASSWORD=${value}\n`;
    const result = replacePlaceholderSecrets(contents, fakeSecret);

    expect(result.contents).toBe(contents);
    expect(result.replaced).toEqual([]);
    expect(result.leftForOperator).toEqual([]);
  });

  test.each([
    ["a quoted host", '"clickhouse"'],
    ["a host in capitals", "ClickHouse"],
    ["a padded host", "  clickhouse "],
  ])("knows the bundled ClickHouse by %s", (_label, host) => {
    const result = run([
      `CLICKHOUSE_HOST=${host}`,
      `CLICKHOUSE_PASSWORD=${PLACEHOLDER}`,
    ]);

    expect(result.replaced).toEqual(["CLICKHOUSE_PASSWORD"]);
  });

  test.each([
    ["a managed ClickHouse", "clickhouse.example.internal"],
    ["an address", "10.0.4.17"],
    ["no host at all", ""],
  ])(
    "leaves a placeholder for %s as it is, and the operator is told",
    (_label, host) => {
      const contents = `CLICKHOUSE_HOST=${host}\nCLICKHOUSE_PASSWORD=${PLACEHOLDER}\n`;
      const result = replacePlaceholderSecrets(contents, fakeSecret);

      expect(result.contents).toBe(contents);
      expect(result.replaced).toEqual([]);
      expect(
        result.leftForOperator.map((entry) => {
          return entry.datastore;
        }),
      ).toEqual(["ClickHouse"]);
    },
  );

  test("leaves a placeholder for a cache OneUptime does not run as it is", () => {
    const contents = `VALKEY_HOST=my-cache.example.internal\nVALKEY_PASSWORD=${PLACEHOLDER}\n`;
    const result = replacePlaceholderSecrets(contents, fakeSecret);

    expect(result.contents).toBe(contents);
    expect(
      result.leftForOperator.map((entry) => {
        return entry.datastore;
      }),
    ).toEqual(["Valkey"]);
  });

  test("the last assignment of the host decides, as the shell's export does", () => {
    const external = run([
      "CLICKHOUSE_HOST=clickhouse",
      `CLICKHOUSE_PASSWORD=${PLACEHOLDER}`,
      "CLICKHOUSE_HOST=clickhouse.example.internal",
    ]);
    expect(external.replaced).toEqual([]);

    const bundled = run([
      "CLICKHOUSE_HOST=clickhouse.example.internal",
      `CLICKHOUSE_PASSWORD=${PLACEHOLDER}`,
      "CLICKHOUSE_HOST=clickhouse",
    ]);
    expect(bundled.replaced).toEqual(["CLICKHOUSE_PASSWORD"]);
  });

  describe("a config.env from before Valkey was called Valkey", () => {
    test("REDIS_HOST=redis and a placeholder REDIS_PASSWORD: the bundled cache, so it gets a new value", () => {
      const result = run(["REDIS_HOST=redis", `REDIS_PASSWORD=${PLACEHOLDER}`]);

      expect(result.replaced).toEqual(["REDIS_PASSWORD"]);
      expect(valueOf(result.contents, "REDIS_PASSWORD")).toMatch(
        /^generated-\d+$/,
      );
    });

    test("an empty VALKEY_PASSWORD falls back to REDIS_PASSWORD, which gets the new value", () => {
      const result = run([
        "VALKEY_HOST=valkey",
        "VALKEY_PASSWORD=",
        `REDIS_PASSWORD=${PLACEHOLDER}`,
      ]);

      expect(result.replaced).toEqual(["REDIS_PASSWORD"]);
      expect(valueOf(result.contents, "VALKEY_PASSWORD")).toBe("");
    });

    test("both names at the placeholder get one value, so whichever Compose reads, Valkey and the app agree", () => {
      const result = run([
        "VALKEY_HOST=valkey",
        `VALKEY_PASSWORD=${PLACEHOLDER}`,
        `REDIS_PASSWORD=${PLACEHOLDER}`,
      ]);

      expect(result.replaced).toEqual(["VALKEY_PASSWORD", "REDIS_PASSWORD"]);
      expect(valueOf(result.contents, "VALKEY_PASSWORD")).toBe(
        valueOf(result.contents, "REDIS_PASSWORD"),
      );
    });

    test("a VALKEY_PASSWORD of the operator's own wins, so a leftover placeholder REDIS_PASSWORD is not touched", () => {
      const contents = `VALKEY_HOST=valkey\nVALKEY_PASSWORD=3b9f1c7e5a2d48f6b0e9c3a7d1f5b8e2\nREDIS_PASSWORD=${PLACEHOLDER}\n`;
      const result = replacePlaceholderSecrets(contents, fakeSecret);

      expect(result.contents).toBe(contents);
      expect(result.replaced).toEqual([]);
    });

    test("an empty VALKEY_HOST falls back to REDIS_HOST to decide whose cache it is", () => {
      const bundled = run([
        "VALKEY_HOST=",
        "REDIS_HOST=redis",
        `VALKEY_PASSWORD=${PLACEHOLDER}`,
      ]);
      expect(bundled.replaced).toEqual(["VALKEY_PASSWORD"]);

      const external = run([
        "VALKEY_HOST=",
        "REDIS_HOST=cache.example.internal",
        `VALKEY_PASSWORD=${PLACEHOLDER}`,
      ]);
      expect(external.replaced).toEqual([]);
      expect(external.leftForOperator).toHaveLength(1);
    });
  });

  test("decides from the settings as npm start exports them", () => {
    const settings = readSettings(
      `# CLICKHOUSE_HOST=elsewhere\nCLICKHOUSE_HOST="clickhouse"\r\nCLICKHOUSE_PASSWORD='${PLACEHOLDER}'\n`,
    );

    expect(settings.get("CLICKHOUSE_HOST")).toBe("clickhouse");
    expect(settings.get("CLICKHOUSE_PASSWORD")).toBe(PLACEHOLDER);
    expect(
      datastorePasswordDecisions(settings).map((decision) => {
        return [decision.entry.datastore, decision.decision];
      }),
    ).toEqual([
      ["ClickHouse", "generate"],
      ["Valkey", "nothing"],
    ]);
  });

  test("the warning names the setting and the host, and says what to do", () => {
    const [clickhouse, valkey] = BUNDLED_DATASTORE_PASSWORDS;

    expect(describeExternalDatastorePassword(clickhouse)).toBe(
      "  ! CLICKHOUSE_PASSWORD in config.env is still the placeholder from config.example.env, which is public, and CLICKHOUSE_HOST points at a ClickHouse that Docker Compose does not run, so it was left as it is. Give that ClickHouse a long random password, and set CLICKHOUSE_PASSWORD to it.",
    );
    expect(describeExternalDatastorePassword(valkey)).toBe(
      "  ! VALKEY_PASSWORD in config.env is still the placeholder from config.example.env, which is public, and VALKEY_HOST points at a Valkey that Docker Compose does not run, so it was left as it is. Give that Valkey a long random password, and set VALKEY_PASSWORD to it.",
    );
  });
});

const GENERATED_KEY_LINE =
  /^(ONEUPTIME_SECRET|REGISTER_PROBE_KEY|GLOBAL_PROBE_1_KEY|GLOBAL_PROBE_2_KEY|GLOBAL_RUNNER_KEY|CLICKHOUSE_PASSWORD|VALKEY_PASSWORD)=.*$/gm;

describe("the script, run the way npm start and configure.sh run it", () => {
  test("a config.env copied from config.example.env gets random shared keys and datastore passwords, and nothing else changes", () => {
    const run = runScript(workspace(), TEMPLATE);

    for (const key of [
      ...GENERATED_SECRETS,
      "CLICKHOUSE_PASSWORD",
      "VALKEY_PASSWORD",
    ]) {
      expect(valueOf(run.contents, key)).toMatch(HEX_256_BITS);
    }

    // PostgreSQL's password is GenerateDatabasePassword.js's to set.
    expect(valueOf(run.contents, "DATABASE_PASSWORD")).toBe(PLACEHOLDER);

    // Everything but the generated keys' lines is byte-for-byte unchanged.
    expect(run.contents.replace(GENERATED_KEY_LINE, "")).toBe(
      TEMPLATE.replace(GENERATED_KEY_LINE, ""),
    );
    expect(run.stdout).toContain(
      "in place of the public placeholders from config.example.env",
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

  test("a placeholder for a datastore OneUptime does not run is left, and the operator told on every start", () => {
    const dir = workspace();
    const contents = `CLICKHOUSE_HOST=clickhouse.example.internal\nCLICKHOUSE_PASSWORD=${PLACEHOLDER}\n`;
    const configPath = path.join(dir, "config.env");

    for (const pass of [1, 2]) {
      copyScript(dir);

      if (pass === 1) {
        fs.writeFileSync(configPath, contents);
      }

      const started = spawnSync(
        process.execPath,
        ["./Scripts/Install/ReplacePlaceholderSecrets.js"],
        { cwd: dir, encoding: "utf8" },
      );

      expect(started.status).toBe(0);
      expect(started.stdout).toBe("");
      expect(started.stderr).toBe(
        `${describeExternalDatastorePassword(BUNDLED_DATASTORE_PASSWORDS[0])}\n`,
      );
      expect(fs.readFileSync(configPath, "utf8")).toBe(contents);
    }
  });

  test("without a config.env it does nothing, and creates none", () => {
    const dir = workspace();
    const run = runScript(dir);

    expect(run.contents).toBeUndefined();
    expect(run.stdout).toBe("");
    expect(fs.existsSync(path.join(dir, "config.env"))).toBe(false);
  });

  /*
   * `npm start` starts Compose through Scripts/Install/WithConfig.sh, which
   * gives it config.env's settings, so what matters is the value that loader
   * produces.
   */
  test("the ONEUPTIME_SECRET Compose gets is the new value, quoted placeholder or not", () => {
    for (const line of [
      `ONEUPTIME_SECRET=${PLACEHOLDER}`,
      `ONEUPTIME_SECRET="${PLACEHOLDER}"`,
    ]) {
      const dir = workspace();
      runScript(dir, `HOST=localhost\n${line}\n`);

      const exported = spawnSync(
        "sh",
        [
          path.join(REPO_ROOT, "Scripts", "Install", "WithConfig.sh"),
          "sh",
          "-c",
          "printf '%s' \"$ONEUPTIME_SECRET\"",
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
 * services do not need the new value, only the bundled probes and global
 * Runner do, so the script says what to set and leaves the file as it was.
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

  test("the message names the file, the reason, and what the probes and global Runner need", () => {
    expect(
      describeUnchangedConfig(
        "written",
        new Error("EROFS: read-only file system"),
      ),
    ).toBe(
      "  ! config.env could not be written (EROFS: read-only file system), so its placeholder secrets were not given random values. OneUptime starts anyway, but the bundled probes and global Runner do not register while REGISTER_PROBE_KEY, GLOBAL_PROBE_1_KEY, GLOBAL_PROBE_2_KEY or GLOBAL_RUNNER_KEY still holds the placeholder from config.example.env: set each to a long random value (openssl rand -hex 32 makes one).",
    );
  });

  test("the real script exits 0 when config.env is not a file it can read, so npm start goes on", () => {
    const dir = workspace();
    copyScript(dir);
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

  test("configure.sh (npm run dev) runs it right after the template merge, before config.env is read", () => {
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
   * What `npm start` hands Compose once the script has run: the values it
   * made, for the datastores and for everything that signs in to them, read
   * by Compose itself from the exported config.env.
   */
  test("Compose renders the new datastore passwords for the datastores and the app alike", () => {
    const { hasDockerCompose, renderCompose } = require("./Utils/ComposePorts");

    if (!hasDockerCompose()) {
      // Ops Config Test runs on a runner with Docker; a laptop without it skips.
      expect(process.env.CI).toBeFalsy();
      return;
    }

    const run = runScript(workspace(), TEMPLATE);
    const exported = readSettings(run.contents);
    const rendered = renderCompose(
      ["docker-compose.yml"],
      Object.fromEntries(exported),
    );
    const clickhousePassword = exported.get("CLICKHOUSE_PASSWORD");
    const valkeyPassword = exported.get("VALKEY_PASSWORD");

    expect(clickhousePassword).toMatch(HEX_256_BITS);
    expect(valkeyPassword).toMatch(HEX_256_BITS);
    expect(rendered.services.clickhouse.environment.CLICKHOUSE_PASSWORD).toBe(
      clickhousePassword,
    );
    expect(rendered.services.app.environment.CLICKHOUSE_PASSWORD).toBe(
      clickhousePassword,
    );
    expect(rendered.services.valkey.command).toContain(valkeyPassword);
    expect(rendered.services.app.environment.VALKEY_PASSWORD).toBe(
      valkeyPassword,
    );
    expect(rendered.services.app.environment.REDIS_PASSWORD).toBe(
      valkeyPassword,
    );
  });

  /*
   * The point of setting them in config.env: every container that presents
   * or checks one of these keys takes it from there, so they share the new
   * value. The app keeps the global Runner's row from GLOBAL_RUNNER_KEY, which
   * the bundled global Runner presents as its ONEUPTIME_RUNNER_KEY; the
   * global Runner holds no ONEUPTIME_SECRET. The shared Runner, and the key
   * the app let it register with, are gone.
   */
  test("Docker Compose hands the app and the bundled global Runner the same GLOBAL_RUNNER_KEY from config.env, and the global Runner no ONEUPTIME_SECRET", () => {
    const compose = yaml.load(
      fs.readFileSync(path.join(REPO_ROOT, "docker-compose.base.yml"), "utf8"),
    );
    const globalRunner = compose.services["global-runner"];

    expect(compose.services.app.environment.GLOBAL_RUNNER_KEY).toBe(
      "${GLOBAL_RUNNER_KEY}",
    );
    expect(globalRunner.environment.ONEUPTIME_RUNNER_KEY).toBe(
      "${GLOBAL_RUNNER_KEY}",
    );

    expect(compose.services.app.environment.ONEUPTIME_SECRET).toBe(
      "${ONEUPTIME_SECRET}",
    );
    expect(globalRunner.environment).not.toHaveProperty("ONEUPTIME_SECRET");

    expect(compose.services).not.toHaveProperty("runner");
    expect(compose.services.app.environment).not.toHaveProperty(
      "ONEUPTIME_RUNNER_KEY",
    );
  });
});
