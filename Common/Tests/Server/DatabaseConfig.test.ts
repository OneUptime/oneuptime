import DatabaseConfig from "../../Server/DatabaseConfig";
import GlobalConfigService from "../../Server/Services/GlobalConfigService";
import GlobalConfig from "../../Models/DatabaseModels/GlobalConfig";
import BadDataException from "../../Types/Exception/BadDataException";
import { describe, expect, test, jest, afterEach } from "@jest/globals";

describe("DatabaseConfig", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const mockFindOneBy: (value: GlobalConfig | null) => void = (
    value: GlobalConfig | null,
  ): void => {
    jest
      .spyOn(GlobalConfigService, "findOneBy")
      .mockResolvedValue(value as GlobalConfig);
  };

  describe("getFromGlobalConfig", () => {
    test("returns the stored column value when GlobalConfig exists", async () => {
      const globalConfig: GlobalConfig = new GlobalConfig();
      globalConfig.disableSignup = true;
      mockFindOneBy(globalConfig);

      const value: unknown =
        await DatabaseConfig.getFromGlobalConfig("disableSignup");

      expect(value).toBe(true);
    });

    test("throws BadDataException when GlobalConfig is missing and no default is given", async () => {
      mockFindOneBy(null);

      await expect(
        DatabaseConfig.getFromGlobalConfig("disableSignup"),
      ).rejects.toThrow(BadDataException);
      await expect(
        DatabaseConfig.getFromGlobalConfig("disableSignup"),
      ).rejects.toThrow("Global Config not found");
    });

    test("returns the provided default when GlobalConfig is missing", async () => {
      mockFindOneBy(null);

      const value: unknown = await DatabaseConfig.getFromGlobalConfig(
        "disableSignup",
        false,
      );

      expect(value).toBe(false);
    });

    test("treats a false default as a real default (does not throw)", async () => {
      mockFindOneBy(null);

      /*
       * false is a valid, intentional default and must not fall through to the
       * "not found" throw path.
       */
      await expect(
        DatabaseConfig.getFromGlobalConfig("disableSignup", false),
      ).resolves.toBe(false);
    });
  });

  describe("shouldDisableSignup", () => {
    test("returns false when GlobalConfig has not been seeded yet", async () => {
      /*
       * Regression guard: a signup request that races GlobalConfig seeding must
       * not 500. Before the fix this threw "Global Config not found".
       */
      mockFindOneBy(null);

      await expect(DatabaseConfig.shouldDisableSignup()).resolves.toBe(false);
    });

    test("returns true when signup is explicitly disabled", async () => {
      const globalConfig: GlobalConfig = new GlobalConfig();
      globalConfig.disableSignup = true;
      mockFindOneBy(globalConfig);

      await expect(DatabaseConfig.shouldDisableSignup()).resolves.toBe(true);
    });

    test("returns false when signup is not disabled in config", async () => {
      const globalConfig: GlobalConfig = new GlobalConfig();
      globalConfig.disableSignup = false;
      mockFindOneBy(globalConfig);

      await expect(DatabaseConfig.shouldDisableSignup()).resolves.toBeFalsy();
    });
  });

  describe("shouldDisableUserProjectCreation", () => {
    test("returns false when GlobalConfig has not been seeded yet", async () => {
      mockFindOneBy(null);

      await expect(
        DatabaseConfig.shouldDisableUserProjectCreation(),
      ).resolves.toBe(false);
    });

    test("returns true when user project creation is explicitly disabled", async () => {
      const globalConfig: GlobalConfig = new GlobalConfig();
      globalConfig.disableUserProjectCreation = true;
      mockFindOneBy(globalConfig);

      await expect(
        DatabaseConfig.shouldDisableUserProjectCreation(),
      ).resolves.toBe(true);
    });
  });

  describe("getHost / getHttpProtocol", () => {
    const originalHost: string | undefined = process.env["HOST"];
    const originalProtocol: string | undefined = process.env["HTTP_PROTOCOL"];

    afterEach(() => {
      if (originalHost === undefined) {
        delete process.env["HOST"];
      } else {
        process.env["HOST"] = originalHost;
      }
      if (originalProtocol === undefined) {
        delete process.env["HTTP_PROTOCOL"];
      } else {
        process.env["HTTP_PROTOCOL"] = originalProtocol;
      }
    });

    test("getHost falls back to localhost when HOST is unset", async () => {
      delete process.env["HOST"];

      const host: { toString: () => string } = await DatabaseConfig.getHost();

      expect(host.toString()).toBe("localhost");
    });

    test("getHttpProtocol returns https only when explicitly configured", async () => {
      process.env["HTTP_PROTOCOL"] = "https";
      const httpsProtocol: unknown = await DatabaseConfig.getHttpProtocol();
      expect(String(httpsProtocol)).toContain("https");

      process.env["HTTP_PROTOCOL"] = "http";
      const httpProtocol: unknown = await DatabaseConfig.getHttpProtocol();
      expect(String(httpProtocol)).toContain("http");
    });
  });
});
