import { afterEach, describe, expect, it, jest } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the app says at boot about the secrets an installation may still hold
 * at a value the repository ships, beside the cluster key's warning:
 *
 *   - RegisterProbeKeyWarning: REGISTER_PROBE_KEY unset, blank, "secret" or a
 *     config.example.env placeholder. OneUptime refuses every global probe's
 *     registration then, and the probe says so only in its own log, so the
 *     server says it too, with what to set.
 *   - DatastorePasswordWarning: DATABASE_PASSWORD, CLICKHOUSE_PASSWORD or
 *     VALKEY_PASSWORD (or the REDIS_PASSWORD it was called before) still a
 *     value the repository ships. The app cannot change a datastore's
 *     password, so it names the settings and says where each is changed. A
 *     blank password is an operator's own choice, never named.
 *
 * EnvironmentConfig reads process.env at module load, so every case sets the
 * environment, resets the module registry and imports afresh.
 */

interface EnvironmentConfigShape {
  RegisterProbeKeyWarning: string | null;
  IsRegisterProbeKeyShipped: boolean;
  ShippedDatastorePasswordSettings: Array<string>;
  DatastorePasswordWarning: string | null;
  ChangeDatabasePasswordDocsUrl: string;
  describeShippedDatastorePasswords: (
    settings: Array<string>,
  ) => string | null;
}

/* <repo>/Common/Tests/Server -> <repo> */
const REPO_ROOT: string = path.resolve(__dirname, "../../../..");

const MANAGED_KEYS: Array<string> = [
  "REGISTER_PROBE_KEY",
  "DATABASE_PASSWORD",
  "CLICKHOUSE_PASSWORD",
  "VALKEY_PASSWORD",
  "REDIS_PASSWORD",
];

// Long random values of an operator's own.
const OPERATORS_VALUE: string =
  "8f2a6c1e9b4d7f3a0c5e8b2d6f9a1c4e7b0d3f6a9c2e5b8d";
const OTHER_OPERATORS_VALUE: string = "c7e1a9f3b5d2486e0a1c3e5f7b9d2a4c";

const SHIPPED_VALUES: Array<[string, string]> = [
  ["the old fallback", "secret"],
  ["the placeholder", "please-change-this-to-random-value"],
  ["a probe's placeholder", "probe-1-please-change-this-to-random-value"],
  ["a padded placeholder", "  please-change-this-to-random-value "],
];

const originalEnv: NodeJS.ProcessEnv = { ...process.env };

async function load(
  overrides: Record<string, string | undefined>,
): Promise<EnvironmentConfigShape> {
  for (const key of MANAGED_KEYS) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  jest.resetModules();

  return (await import(
    "../../Server/EnvironmentConfig"
  )) as unknown as EnvironmentConfigShape;
}

// The value config.example.env ships for `name`.
function shippedExampleValue(name: string): string {
  const line: string | undefined = fs
    .readFileSync(path.join(REPO_ROOT, "config.example.env"), "utf8")
    .split("\n")
    .find((candidate: string): boolean => {
      return candidate.startsWith(`${name}=`);
    });

  expect(line).toBeDefined();

  return line!.slice(name.length + 1).trim();
}

afterEach(() => {
  process.env = { ...originalEnv };
  jest.resetModules();
});

describe("RegisterProbeKeyWarning", () => {
  it.each([
    ["unset", undefined],
    ["blank", "   "],
    ...SHIPPED_VALUES,
  ])(
    "is said when REGISTER_PROBE_KEY is %s",
    async (_label: string, value: string | undefined) => {
      const config: EnvironmentConfigShape = await load({
        REGISTER_PROBE_KEY: value,
      });

      expect(config.IsRegisterProbeKeyShipped).toBe(true);
      expect(config.RegisterProbeKeyWarning).toEqual(expect.any(String));
    },
  );

  it("is said for the value config.example.env ships", async () => {
    const config: EnvironmentConfigShape = await load({
      REGISTER_PROBE_KEY: shippedExampleValue("REGISTER_PROBE_KEY"),
    });

    expect(config.RegisterProbeKeyWarning).not.toBeNull();
  });

  it.each([
    ["a long random value", OPERATORS_VALUE],
    ["one that only starts like the old fallback", "secretive-probe-key-42"],
  ])(
    "is not said when REGISTER_PROBE_KEY is %s",
    async (_label: string, value: string) => {
      const config: EnvironmentConfigShape = await load({
        REGISTER_PROBE_KEY: value,
      });

      expect(config.IsRegisterProbeKeyShipped).toBe(false);
      expect(config.RegisterProbeKeyWarning).toBeNull();
    },
  );

  it("names the setting, what OneUptime refuses, and where a value comes from, never echoing one", async () => {
    const config: EnvironmentConfigShape = await load({
      REGISTER_PROBE_KEY: "please-change-this-to-random-value-7",
    });
    const warning: string = config.RegisterProbeKeyWarning || "";

    expect(warning).toContain("REGISTER_PROBE_KEY");
    expect(warning).toContain("no probe can register as a global probe");
    expect(warning).toContain("long random value");
    expect(warning).toContain("npm start and npm run update");
    expect(warning).toContain("registerProbeKey");
    // The configured value is never in the log line.
    expect(warning).not.toContain("please-change-this-to-random-value-7");
  });
});

describe("DatastorePasswordWarning", () => {
  it("is not said when every password is the operator's own", async () => {
    const config: EnvironmentConfigShape = await load({
      DATABASE_PASSWORD: OPERATORS_VALUE,
      CLICKHOUSE_PASSWORD: OTHER_OPERATORS_VALUE,
      VALKEY_PASSWORD: `${OPERATORS_VALUE}x`,
    });

    expect(config.ShippedDatastorePasswordSettings).toEqual([]);
    expect(config.DatastorePasswordWarning).toBeNull();
  });

  it("names every password still at the value config.example.env ships, in one line", async () => {
    const config: EnvironmentConfigShape = await load({
      DATABASE_PASSWORD: shippedExampleValue("DATABASE_PASSWORD"),
      CLICKHOUSE_PASSWORD: shippedExampleValue("CLICKHOUSE_PASSWORD"),
      VALKEY_PASSWORD: shippedExampleValue("VALKEY_PASSWORD"),
    });

    expect(config.ShippedDatastorePasswordSettings).toEqual([
      "DATABASE_PASSWORD",
      "CLICKHOUSE_PASSWORD",
      "VALKEY_PASSWORD",
    ]);
    expect(config.DatastorePasswordWarning).toContain(
      "DATABASE_PASSWORD, CLICKHOUSE_PASSWORD and VALKEY_PASSWORD still hold a value shipped in the OneUptime repository",
    );
  });

  it.each(SHIPPED_VALUES)(
    "names a password that is %s, and only that one",
    async (_label: string, value: string) => {
      const config: EnvironmentConfigShape = await load({
        DATABASE_PASSWORD: OPERATORS_VALUE,
        CLICKHOUSE_PASSWORD: value,
        VALKEY_PASSWORD: OTHER_OPERATORS_VALUE,
      });

      expect(config.ShippedDatastorePasswordSettings).toEqual([
        "CLICKHOUSE_PASSWORD",
      ]);
      expect(config.DatastorePasswordWarning).toContain(
        "CLICKHOUSE_PASSWORD still holds a value shipped",
      );
    },
  );

  it.each([
    ["unset", undefined],
    ["blank", ""],
    ["spaces", "   "],
  ])(
    "never names a password that is %s: no password is an operator's own choice",
    async (_label: string, value: string | undefined) => {
      const config: EnvironmentConfigShape = await load({
        DATABASE_PASSWORD: value,
        CLICKHOUSE_PASSWORD: value,
        VALKEY_PASSWORD: value,
      });

      expect(config.ShippedDatastorePasswordSettings).toEqual([]);
      expect(config.DatastorePasswordWarning).toBeNull();
    },
  );

  it("reads the cache password the way the app connects with it: VALKEY_PASSWORD, or REDIS_PASSWORD from before the rename", async () => {
    const legacy: EnvironmentConfigShape = await load({
      DATABASE_PASSWORD: OPERATORS_VALUE,
      CLICKHOUSE_PASSWORD: OPERATORS_VALUE,
      VALKEY_PASSWORD: "",
      REDIS_PASSWORD: "please-change-this-to-random-value",
    });
    expect(legacy.ShippedDatastorePasswordSettings).toEqual([
      "VALKEY_PASSWORD",
    ]);

    // VALKEY_PASSWORD wins when both are set, as it does for the connection.
    const renamed: EnvironmentConfigShape = await load({
      DATABASE_PASSWORD: OPERATORS_VALUE,
      CLICKHOUSE_PASSWORD: OPERATORS_VALUE,
      VALKEY_PASSWORD: OTHER_OPERATORS_VALUE,
      REDIS_PASSWORD: "please-change-this-to-random-value",
    });
    expect(renamed.ShippedDatastorePasswordSettings).toEqual([]);
  });

  it("says where each is changed, and never echoes a value", async () => {
    const config: EnvironmentConfigShape = await load({
      DATABASE_PASSWORD: "please-change-this-to-random-value-db",
      CLICKHOUSE_PASSWORD: OPERATORS_VALUE,
      VALKEY_PASSWORD: OPERATORS_VALUE,
    });
    const warning: string = config.DatastorePasswordWarning || "";

    expect(warning).toContain("npm start and npm run update");
    expect(warning).toContain(config.ChangeDatabasePasswordDocsUrl);
    expect(warning).toContain("long random password");
    expect(warning).not.toContain("please-change-this-to-random-value-db");
    expect(warning).not.toContain(OPERATORS_VALUE);
  });

  it("links to the Docker Compose guide's own section, the address npm start's warning uses", async () => {
    const config: EnvironmentConfigShape = await load({});
    const url: URL = new URL(config.ChangeDatabasePasswordDocsUrl);

    expect(url.origin).toBe("https://oneuptime.com");
    expect(url.pathname).toBe("/docs/installation/docker-compose");
    expect(url.hash).toBe("#change-the-database-password");

    // The guide has that section, under that heading.
    const guide: string = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "packages/App/FeatureSet/Docs/Content/en/installation/docker-compose.md",
      ),
      "utf8",
    );
    expect(guide.split("\n")).toContain("### Change the database password");

    // npm start's own warning points at the same address.
    const step: string = fs.readFileSync(
      path.join(REPO_ROOT, "Scripts/Install/GenerateDatabasePassword.js"),
      "utf8",
    );
    expect(step).toContain(`"${config.ChangeDatabasePasswordDocsUrl}"`);
  });

  it("joins one, two and three names the way a sentence does", async () => {
    const config: EnvironmentConfigShape = await load({});

    expect(config.describeShippedDatastorePasswords([])).toBeNull();
    expect(
      config.describeShippedDatastorePasswords(["VALKEY_PASSWORD"]),
    ).toMatch(/^VALKEY_PASSWORD still holds /);
    expect(
      config.describeShippedDatastorePasswords([
        "DATABASE_PASSWORD",
        "VALKEY_PASSWORD",
      ]),
    ).toMatch(/^DATABASE_PASSWORD and VALKEY_PASSWORD still hold /);
  });
});
