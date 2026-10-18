import { afterEach, describe, expect, it, jest } from "@jest/globals";
import fs from "fs";
import yaml from "js-yaml";
import path from "path";
import { readPushNotificationRelayServerEnabled } from "../../Server/EnvironmentConfig";

/*
 * PUSH_NOTIFICATION_RELAY_SERVER_ENABLED: whether a server relays mobile
 * pushes for other OneUptime servers - answers the push relay's routes,
 * which send with its EXPO_ACCESS_TOKEN what another server asks. On
 * OneUptime's cloud (BILLING_ENABLED) unless turned off; anywhere else only
 * when set to true. An EXPO_ACCESS_TOKEN does not make a server a relay.
 *
 * EnvironmentConfig reads process.env at module load, so the cases that
 * check the setting as the server reads it set the environment, reset the
 * module registry and import afresh.
 */

interface EnvironmentConfigShape {
  PushNotificationRelayServerEnabled: boolean;
  IsBillingEnabled: boolean;
  ExpoAccessToken: string | undefined;
}

/* <repo>/packages/Common/Tests/Server -> <repo> */
const REPO_ROOT: string = path.resolve(__dirname, "../../../..");

const VARIABLE: string = "PUSH_NOTIFICATION_RELAY_SERVER_ENABLED";

const MANAGED_KEYS: Array<string> = [
  VARIABLE,
  "BILLING_ENABLED",
  "EXPO_ACCESS_TOKEN",
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

afterEach(() => {
  process.env = { ...originalEnv };
  jest.resetModules();
});

function readRepoFile(...segments: Array<string>): string {
  return fs.readFileSync(path.join(REPO_ROOT, ...segments), "utf8");
}

// The line `NAME=value` of config.example.env, or null when it has none.
function exampleEnvLine(name: string): string | null {
  const lines: Array<string> = readRepoFile("config.example.env").split("\n");
  const prefix: string = `${name}=`;

  return (
    lines.find((line: string): boolean => {
      return line.startsWith(prefix);
    }) || null
  );
}

describe("readPushNotificationRelayServerEnabled", () => {
  it("unset or empty: a relay only where billing is on (OneUptime's cloud)", () => {
    for (const value of [undefined, "", "   ", "\t"]) {
      expect(
        readPushNotificationRelayServerEnabled({
          value: value,
          isBillingEnabled: true,
        }),
      ).toBe(true);
      expect(
        readPushNotificationRelayServerEnabled({
          value: value,
          isBillingEnabled: false,
        }),
      ).toBe(false);
    }
  });

  it("true: a relay, with billing on or off", () => {
    for (const isBillingEnabled of [true, false]) {
      expect(
        readPushNotificationRelayServerEnabled({
          value: "true",
          isBillingEnabled: isBillingEnabled,
        }),
      ).toBe(true);
      expect(
        readPushNotificationRelayServerEnabled({
          value: "  true ",
          isBillingEnabled: isBillingEnabled,
        }),
      ).toBe(true);
    }
  });

  it("anything else that is set: not a relay, with billing on or off", () => {
    for (const value of [
      "false",
      "FALSE",
      "TRUE",
      "True",
      "yes",
      "1",
      "on",
      "enabled",
      "0",
      "no",
      "truee",
      "true,false",
    ]) {
      for (const isBillingEnabled of [true, false]) {
        expect(
          readPushNotificationRelayServerEnabled({
            value: value,
            isBillingEnabled: isBillingEnabled,
          }),
        ).toBe(false);
      }
    }
  });
});

describe("PushNotificationRelayServerEnabled, as the server reads its environment", () => {
  it("a self-hosted server with an Expo access token for its own pushes is not a relay", async () => {
    const config: EnvironmentConfigShape = await load({
      BILLING_ENABLED: "false",
      EXPO_ACCESS_TOKEN: "expo-token",
    });

    expect(config.ExpoAccessToken).toBe("expo-token");
    expect(config.PushNotificationRelayServerEnabled).toBe(false);
  });

  it("a self-hosted server with nothing set is not a relay", async () => {
    const config: EnvironmentConfigShape = await load({});

    expect(config.IsBillingEnabled).toBe(false);
    expect(config.PushNotificationRelayServerEnabled).toBe(false);
  });

  it("a self-hosted server whose operator set it to true is a relay", async () => {
    const config: EnvironmentConfigShape = await load({
      BILLING_ENABLED: "false",
      EXPO_ACCESS_TOKEN: "expo-token",
      [VARIABLE]: "true",
    });

    expect(config.PushNotificationRelayServerEnabled).toBe(true);
  });

  it("OneUptime's cloud is a relay without being told", async () => {
    const config: EnvironmentConfigShape = await load({
      BILLING_ENABLED: "true",
      EXPO_ACCESS_TOKEN: "expo-token",
    });

    expect(config.PushNotificationRelayServerEnabled).toBe(true);
  });

  it("OneUptime's cloud is a relay with the setting empty, as the chart and config.env write it unset", async () => {
    const config: EnvironmentConfigShape = await load({
      BILLING_ENABLED: "true",
      [VARIABLE]: "",
    });

    expect(config.PushNotificationRelayServerEnabled).toBe(true);
  });

  it("OneUptime's cloud set to false is not a relay", async () => {
    const config: EnvironmentConfigShape = await load({
      BILLING_ENABLED: "true",
      [VARIABLE]: "false",
    });

    expect(config.PushNotificationRelayServerEnabled).toBe(false);
  });
});

/*
 * What ships. A stock self-hosted install (config.example.env, the chart's
 * values.yaml) leaves the setting empty, so it is no relay and OneUptime's
 * cloud, which runs with BILLING_ENABLED, stays one with no deploy change.
 * A shipped "false" would turn the cloud's relay off for every self-hosted
 * server that sends through it.
 */
describe("the shipped defaults", () => {
  it("config.example.env ships it empty", () => {
    expect(exampleEnvLine(VARIABLE)).toBe(`${VARIABLE}=`);
  });

  it("config.example.env ships billing off, so a stock install is no relay", () => {
    expect(exampleEnvLine("BILLING_ENABLED")).toBe("BILLING_ENABLED=false");
    expect(
      readPushNotificationRelayServerEnabled({
        value: "",
        isBillingEnabled: false,
      }),
    ).toBe(false);
  });

  it("docker-compose passes it to the app from config.env", () => {
    const compose: Array<string> = readRepoFile("docker-compose.base.yml")
      .split("\n")
      .map((line: string): string => {
        return line.trim();
      });

    expect(compose).toContain(`${VARIABLE}: \${${VARIABLE}}`);
  });

  it("the Helm chart ships it unset, beside the relay address", () => {
    const values: { pushNotification?: Record<string, unknown> } = yaml.load(
      readRepoFile("HelmChart", "Public", "oneuptime", "values.yaml"),
    ) as { pushNotification?: Record<string, unknown> };

    expect(values.pushNotification).toEqual({
      relayUrl: "https://oneuptime.com/api/notification/push-relay/send",
      relayServerEnabled: null,
    });
  });
});
