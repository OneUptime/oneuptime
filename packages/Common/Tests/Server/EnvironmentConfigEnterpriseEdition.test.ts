import { afterEach, describe, expect, it, jest } from "@jest/globals";
import fs from "fs";
import path from "path";
import type URL from "../../Types/API/URL";

/*
 * The environment variables behind the Community / Enterprise split:
 * ONEUPTIME_EDITION, ONEUPTIME_EE_DIR, ALLOW_BILLING_WITHOUT_ENTERPRISE and
 * ENTERPRISE_LICENSE_SERVER_URL (which the two license-server endpoint URLs
 * derive from).
 *
 * EnvironmentConfig reads process.env at module load, so every case here
 * sets the environment, resets the module registry and imports afresh.
 */

type OneUptimeEditionSetting = "auto" | "community" | "enterprise";

interface EnvironmentConfigShape {
  OneUptimeEdition: OneUptimeEditionSetting | null;
  ONEUPTIME_EDITION_SETTINGS: ReadonlyArray<OneUptimeEditionSetting>;
  parseOneUptimeEdition: (
    rawValue: string | undefined,
  ) => OneUptimeEditionSetting | null;
  OneUptimeEnterpriseDirectory: string | undefined;
  AllowBillingWithoutEnterprise: boolean;
  IsEnterpriseEdition: boolean;
  DEFAULT_ENTERPRISE_LICENSE_SERVER_URL: string;
  resolveEnterpriseLicenseServerUrl: (
    rawValue: string | undefined,
    allowInsecure: boolean,
  ) => string;
  EnterpriseLicenseServerUrl: URL;
  EnterpriseLicenseValidationUrl: URL;
  EnterpriseLicenseUserCountReportUrl: URL;
}

const MANAGED_KEYS: Array<string> = [
  "ONEUPTIME_EDITION",
  "ONEUPTIME_EE_DIR",
  "ALLOW_BILLING_WITHOUT_ENTERPRISE",
  "ENTERPRISE_LICENSE_SERVER_URL",
  "IS_ENTERPRISE_EDITION",
  "ENVIRONMENT",
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

describe("ONEUPTIME_EDITION", () => {
  it("defaults to auto when unset", async () => {
    const config: EnvironmentConfigShape = await load({});

    expect(config.OneUptimeEdition).toBe("auto");
  });

  it("reads a blank value as auto", async () => {
    const config: EnvironmentConfigShape = await load({
      ONEUPTIME_EDITION: "   ",
    });

    expect(config.OneUptimeEdition).toBe("auto");
  });

  it.each([
    "auto",
    "community",
    "enterprise",
  ] as Array<OneUptimeEditionSetting>)(
    "accepts %s",
    async (edition: OneUptimeEditionSetting) => {
      const config: EnvironmentConfigShape = await load({
        ONEUPTIME_EDITION: edition,
      });

      expect(config.OneUptimeEdition).toBe(edition);
    },
  );

  it("is case- and whitespace-insensitive", async () => {
    const config: EnvironmentConfigShape = await load({
      ONEUPTIME_EDITION: "  Enterprise \n",
    });

    expect(config.OneUptimeEdition).toBe("enterprise");
  });

  it.each(["enterprize", "ce", "ee", "true", "1", "communityedition"])(
    "reports an unrecognised value (%s) as null so the loader can refuse to boot",
    async (rawValue: string) => {
      const config: EnvironmentConfigShape = await load({
        ONEUPTIME_EDITION: rawValue,
      });

      expect(config.OneUptimeEdition).toBeNull();
    },
  );

  it("lists exactly the three settings", async () => {
    const config: EnvironmentConfigShape = await load({});

    expect([...config.ONEUPTIME_EDITION_SETTINGS]).toEqual([
      "auto",
      "community",
      "enterprise",
    ]);
  });

  it("parseOneUptimeEdition is a pure function of its argument", async () => {
    const config: EnvironmentConfigShape = await load({
      ONEUPTIME_EDITION: "community",
    });

    expect(config.parseOneUptimeEdition(undefined)).toBe("auto");
    expect(config.parseOneUptimeEdition("")).toBe("auto");
    expect(config.parseOneUptimeEdition("COMMUNITY")).toBe("community");
    expect(config.parseOneUptimeEdition("nope")).toBeNull();
  });

  it("does not change what IS_ENTERPRISE_EDITION means", async () => {
    const enterprise: EnvironmentConfigShape = await load({
      IS_ENTERPRISE_EDITION: "true",
      ONEUPTIME_EDITION: "community",
    });

    expect(enterprise.IsEnterpriseEdition).toBe(true);
    expect(enterprise.OneUptimeEdition).toBe("community");

    const community: EnvironmentConfigShape = await load({
      ONEUPTIME_EDITION: "enterprise",
    });

    expect(community.IsEnterpriseEdition).toBe(false);
  });
});

describe("ONEUPTIME_EE_DIR", () => {
  it("is undefined when unset or blank", async () => {
    expect((await load({})).OneUptimeEnterpriseDirectory).toBeUndefined();
    expect(
      (await load({ ONEUPTIME_EE_DIR: "  " })).OneUptimeEnterpriseDirectory,
    ).toBeUndefined();
  });

  it("is the trimmed path when set", async () => {
    const config: EnvironmentConfigShape = await load({
      ONEUPTIME_EE_DIR: " /opt/fixtures/ee \n",
    });

    expect(config.OneUptimeEnterpriseDirectory).toBe("/opt/fixtures/ee");
  });
});

describe("ALLOW_BILLING_WITHOUT_ENTERPRISE", () => {
  it("is off unless exactly true", async () => {
    expect((await load({})).AllowBillingWithoutEnterprise).toBe(false);
    expect(
      (await load({ ALLOW_BILLING_WITHOUT_ENTERPRISE: "1" }))
        .AllowBillingWithoutEnterprise,
    ).toBe(false);
    expect(
      (await load({ ALLOW_BILLING_WITHOUT_ENTERPRISE: "TRUE" }))
        .AllowBillingWithoutEnterprise,
    ).toBe(false);
    expect(
      (await load({ ALLOW_BILLING_WITHOUT_ENTERPRISE: "true" }))
        .AllowBillingWithoutEnterprise,
    ).toBe(true);
  });
});

describe("ENTERPRISE_LICENSE_SERVER_URL", () => {
  it("defaults to oneuptime.com and keeps the historical endpoint URLs byte-identical", async () => {
    const config: EnvironmentConfigShape = await load({});

    expect(config.DEFAULT_ENTERPRISE_LICENSE_SERVER_URL).toBe(
      "https://oneuptime.com",
    );
    // The URL type renders a bare origin with its root path.
    expect(config.EnterpriseLicenseServerUrl.toString()).toBe(
      "https://oneuptime.com/",
    );
    expect(config.EnterpriseLicenseValidationUrl.toString()).toBe(
      "https://oneuptime.com/api/enterprise-license/validate",
    );
    expect(config.EnterpriseLicenseUserCountReportUrl.toString()).toBe(
      "https://oneuptime.com/api/enterprise-license/report-user-count",
    );
  });

  it("derives both endpoints from an https override", async () => {
    const config: EnvironmentConfigShape = await load({
      ENTERPRISE_LICENSE_SERVER_URL: "https://licenses.staging.example.com/",
      ENVIRONMENT: "production",
    });

    expect(config.EnterpriseLicenseServerUrl.toString()).toBe(
      "https://licenses.staging.example.com/",
    );
    expect(config.EnterpriseLicenseValidationUrl.toString()).toBe(
      "https://licenses.staging.example.com/api/enterprise-license/validate",
    );
    expect(config.EnterpriseLicenseUserCountReportUrl.toString()).toBe(
      "https://licenses.staging.example.com/api/enterprise-license/report-user-count",
    );
  });

  it("keeps a path prefix on the override", async () => {
    const config: EnvironmentConfigShape = await load({
      ENTERPRISE_LICENSE_SERVER_URL: "https://relay.example.com/oneuptime//",
      ENVIRONMENT: "production",
    });

    expect(config.EnterpriseLicenseValidationUrl.toString()).toBe(
      "https://relay.example.com/oneuptime/api/enterprise-license/validate",
    );
  });

  it("refuses plain http in production (the license key would travel in the clear)", async () => {
    const config: EnvironmentConfigShape = await load({
      ENTERPRISE_LICENSE_SERVER_URL: "http://licenses.example.com",
      ENVIRONMENT: "production",
    });

    expect(config.EnterpriseLicenseValidationUrl.toString()).toBe(
      "https://oneuptime.com/api/enterprise-license/validate",
    );
  });

  it.each(["development", "test"])(
    "allows plain http in %s",
    async (environment: string) => {
      const config: EnvironmentConfigShape = await load({
        ENTERPRISE_LICENSE_SERVER_URL: "http://localhost:3002",
        ENVIRONMENT: environment,
      });

      expect(config.EnterpriseLicenseValidationUrl.toString()).toBe(
        "http://localhost:3002/api/enterprise-license/validate",
      );
    },
  );

  it("resolveEnterpriseLicenseServerUrl falls back to the default for unusable values", async () => {
    const config: EnvironmentConfigShape = await load({});
    const resolve: EnvironmentConfigShape["resolveEnterpriseLicenseServerUrl"] =
      config.resolveEnterpriseLicenseServerUrl;

    expect(resolve(undefined, false)).toBe("https://oneuptime.com");
    expect(resolve("", true)).toBe("https://oneuptime.com");
    expect(resolve("   ", true)).toBe("https://oneuptime.com");
    expect(resolve("licenses.example.com", true)).toBe("https://oneuptime.com");
    expect(resolve("ftp://licenses.example.com", true)).toBe(
      "https://oneuptime.com",
    );
    expect(resolve("javascript:alert(1)", true)).toBe("https://oneuptime.com");
    expect(resolve("http://licenses.example.com", false)).toBe(
      "https://oneuptime.com",
    );
    expect(resolve("https://", true)).toBe("https://oneuptime.com");
  });

  it("resolveEnterpriseLicenseServerUrl keeps usable values, minus trailing slashes", async () => {
    const config: EnvironmentConfigShape = await load({});
    const resolve: EnvironmentConfigShape["resolveEnterpriseLicenseServerUrl"] =
      config.resolveEnterpriseLicenseServerUrl;

    expect(resolve("https://licenses.example.com", false)).toBe(
      "https://licenses.example.com",
    );
    expect(resolve(" HTTPS://Licenses.Example.com/// ", false)).toBe(
      "HTTPS://Licenses.Example.com",
    );
    expect(resolve("http://localhost:3002/", true)).toBe(
      "http://localhost:3002",
    );
  });
});

describe("EnvironmentConfig import hygiene", () => {
  it("EnvironmentConfig never imports the enterprise module (no import cycle)", () => {
    const source: string = fs.readFileSync(
      path.join(__dirname, "../../Server/EnvironmentConfig.ts"),
      "utf8",
    );

    expect(source).not.toContain("./Enterprise/");
  });
});
