import { afterEach, describe, expect, it, jest } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * INBOUND_EMAIL_WEBHOOK_SECRET as EnvironmentConfig reads it.
 *
 *   - InboundEmailWebhookSecret is the secret the inbound email webhook
 *     compares a delivery's address with: the value as the operator set it,
 *     whitespace around it ignored, or undefined when there is none the
 *     installation may use - unset, blank, a value the repository ships, or
 *     a placeholder the setup guide prints, whatever its case.
 *   - InboundEmailWebhookSecretWarning is said once at boot while incoming
 *     email is on (INBOUND_EMAIL_DOMAIN) with no such secret: every delivery
 *     is refused then, and SendGrid tells no one. It names the setting, says
 *     what happens and what to set, and never echoes a value.
 *
 * EnvironmentConfig reads process.env at module load, so every case sets the
 * environment, resets the module registry and imports afresh.
 */

interface EnvironmentConfigShape {
  InboundEmailDomain: string | undefined;
  InboundEmailWebhookSecret: string | undefined;
  InboundEmailWebhookSecretWarning: string | null;
  InboundEmailSetupDocsUrl: string;
  PublishedInboundEmailWebhookSecrets: ReadonlyArray<string>;
  getUsableInboundEmailWebhookSecret: (
    value: string | null | undefined,
  ) => string | undefined;
}

/* <repo>/Common/Tests/Server -> <repo> */
const REPO_ROOT: string = path.resolve(__dirname, "../../../..");

const DOMAIN: string = "inbound.oneuptime.example";

const MANAGED_KEYS: Array<string> = [
  "INBOUND_EMAIL_PROVIDER",
  "INBOUND_EMAIL_DOMAIN",
  "INBOUND_EMAIL_WEBHOOK_SECRET",
];

// A long random value of an operator's own.
const OPERATORS_SECRET: string =
  "6f1c9a2e8b4d7f30a5c1e9b2d6f8a0c4e7b1d3f5a9c2e6b8";

const NO_SECRET_OF_ITS_OWN: Array<[string, string | undefined]> = [
  ["unset", undefined],
  ["empty", ""],
  ["blank", " \t "],
  ["the value the code used to fall back to", "secret"],
  ["a config.example.env placeholder", "please-change-this-to-random-value"],
  [
    "a partly edited config.example.env placeholder",
    "please-change-this-to-random-value-7",
  ],
  ["the guide's URL placeholder", "YOUR_SECRET"],
  ["the guide's URL placeholder, lowercased", "your_secret"],
  ["the guide's example", "your-secret"],
  ["the guide's example, in capitals", "YOUR-SECRET"],
  ["the guide's config placeholder", "replace-with-a-strong-random-secret"],
  [
    "the guide's config placeholder, padded and in other case",
    "  Replace-With-A-Strong-Random-Secret \n",
  ],
];

const originalEnv: NodeJS.ProcessEnv = { ...process.env };

async function load(
  overrides: Record<string, string | undefined>,
): Promise<EnvironmentConfigShape> {
  for (const key of MANAGED_KEYS) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
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

describe("getUsableInboundEmailWebhookSecret", () => {
  it.each(NO_SECRET_OF_ITS_OWN)(
    "has no secret when the value is %s",
    async (_label: string, value: string | undefined) => {
      const config: EnvironmentConfigShape = await load({});

      expect(config.getUsableInboundEmailWebhookSecret(value)).toBeUndefined();
    },
  );

  it("has no secret for null", async () => {
    const config: EnvironmentConfigShape = await load({});

    expect(config.getUsableInboundEmailWebhookSecret(null)).toBeUndefined();
  });

  it.each([
    ["a long random value", OPERATORS_SECRET, OPERATORS_SECRET],
    ["one padded with whitespace", `\t${OPERATORS_SECRET}  `, OPERATORS_SECRET],
    [
      "one that only contains a placeholder",
      "my-your-secret-7d1e9a",
      "my-your-secret-7d1e9a",
    ],
    [
      "one that only starts like the old fallback",
      "secretive-hook-4b8e",
      "secretive-hook-4b8e",
    ],
    ["a short value of the operator's own", "x7", "x7"],
  ])(
    "keeps %s, as the operator set it",
    async (_label: string, value: string, expected: string) => {
      const config: EnvironmentConfigShape = await load({});

      expect(config.getUsableInboundEmailWebhookSecret(value)).toBe(expected);
    },
  );

  it("lists the guide's placeholders lowercased, so any case of them is one", async () => {
    const config: EnvironmentConfigShape = await load({});

    for (const placeholder of config.PublishedInboundEmailWebhookSecrets) {
      expect(placeholder).toBe(placeholder.toLowerCase());
      expect(
        config.getUsableInboundEmailWebhookSecret(placeholder.toUpperCase()),
      ).toBeUndefined();
    }
  });
});

describe("InboundEmailWebhookSecret", () => {
  it.each(NO_SECRET_OF_ITS_OWN)(
    "is undefined when INBOUND_EMAIL_WEBHOOK_SECRET is %s",
    async (_label: string, value: string | undefined) => {
      const config: EnvironmentConfigShape = await load({
        INBOUND_EMAIL_DOMAIN: DOMAIN,
        INBOUND_EMAIL_WEBHOOK_SECRET: value,
      });

      expect(config.InboundEmailWebhookSecret).toBeUndefined();
    },
  );

  it("is the operator's value, whitespace around it ignored", async () => {
    const config: EnvironmentConfigShape = await load({
      INBOUND_EMAIL_DOMAIN: DOMAIN,
      INBOUND_EMAIL_WEBHOOK_SECRET: ` ${OPERATORS_SECRET}\n`,
    });

    expect(config.InboundEmailWebhookSecret).toBe(OPERATORS_SECRET);
  });

  it("is undefined for the value config.example.env ships", async () => {
    const config: EnvironmentConfigShape = await load({
      INBOUND_EMAIL_DOMAIN: DOMAIN,
      INBOUND_EMAIL_WEBHOOK_SECRET: shippedExampleValue(
        "INBOUND_EMAIL_WEBHOOK_SECRET",
      ),
    });

    expect(config.InboundEmailWebhookSecret).toBeUndefined();
  });
});

describe("InboundEmailWebhookSecretWarning", () => {
  it.each(NO_SECRET_OF_ITS_OWN)(
    "is said while incoming email is on and INBOUND_EMAIL_WEBHOOK_SECRET is %s",
    async (_label: string, value: string | undefined) => {
      const config: EnvironmentConfigShape = await load({
        INBOUND_EMAIL_DOMAIN: DOMAIN,
        INBOUND_EMAIL_WEBHOOK_SECRET: value,
      });

      expect(config.InboundEmailWebhookSecretWarning).toEqual(
        expect.any(String),
      );
    },
  );

  it("is said for what config.example.env ships, once a domain is set", async () => {
    const config: EnvironmentConfigShape = await load({
      INBOUND_EMAIL_DOMAIN: DOMAIN,
      INBOUND_EMAIL_WEBHOOK_SECRET: shippedExampleValue(
        "INBOUND_EMAIL_WEBHOOK_SECRET",
      ),
    });

    expect(config.InboundEmailWebhookSecretWarning).not.toBeNull();
  });

  it.each([
    ["no secret", undefined],
    ["a placeholder", "YOUR_SECRET"],
    ["a secret of the operator's own", OPERATORS_SECRET],
  ])(
    "is not said while incoming email is off, with %s",
    async (_label: string, value: string | undefined) => {
      const config: EnvironmentConfigShape = await load({
        INBOUND_EMAIL_WEBHOOK_SECRET: value,
      });

      expect(config.InboundEmailDomain).toBeUndefined();
      expect(config.InboundEmailWebhookSecretWarning).toBeNull();
    },
  );

  it("is not said for config.example.env as it ships: incoming email is off", async () => {
    const config: EnvironmentConfigShape = await load({
      INBOUND_EMAIL_DOMAIN: shippedExampleValue("INBOUND_EMAIL_DOMAIN"),
      INBOUND_EMAIL_WEBHOOK_SECRET: shippedExampleValue(
        "INBOUND_EMAIL_WEBHOOK_SECRET",
      ),
    });

    expect(config.InboundEmailWebhookSecretWarning).toBeNull();
  });

  it("is not said once there is a secret of the operator's own", async () => {
    const config: EnvironmentConfigShape = await load({
      INBOUND_EMAIL_DOMAIN: DOMAIN,
      INBOUND_EMAIL_WEBHOOK_SECRET: OPERATORS_SECRET,
    });

    expect(config.InboundEmailWebhookSecretWarning).toBeNull();
  });

  it("names the settings, what is refused, where to set the secret, and the guide", async () => {
    const config: EnvironmentConfigShape = await load({
      INBOUND_EMAIL_DOMAIN: DOMAIN,
    });
    const warning: string = config.InboundEmailWebhookSecretWarning || "";

    for (const part of [
      "INBOUND_EMAIL_DOMAIN",
      "INBOUND_EMAIL_WEBHOOK_SECRET",
      "refuses every email",
      "Incoming Email monitor",
      "workflow",
      "503",
      "three days",
      "long random value",
      "Destination URL",
      "/incoming-email/sendgrid/",
      "config.env",
      "npm start",
      "inboundEmail.webhookSecret",
      config.InboundEmailSetupDocsUrl,
    ]) {
      expect(warning).toContain(part);
    }
  });

  it("never echoes a value it was given", async () => {
    for (const value of [
      "please-change-this-to-random-value-7",
      "Replace-With-A-Strong-Random-Secret",
    ]) {
      const config: EnvironmentConfigShape = await load({
        INBOUND_EMAIL_DOMAIN: DOMAIN,
        INBOUND_EMAIL_WEBHOOK_SECRET: value,
      });

      expect(config.InboundEmailWebhookSecretWarning).not.toContain(value);
    }
  });

  it("points at the step of the guide that sets the secret", async () => {
    const config: EnvironmentConfigShape = await load({});

    expect(config.InboundEmailSetupDocsUrl).toBe(
      "https://oneuptime.com/docs/self-hosted/sendgrid-inbound-email#configure-oneuptime",
    );
  });
});
