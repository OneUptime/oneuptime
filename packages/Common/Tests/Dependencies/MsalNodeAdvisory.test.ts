import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import http from "http";
import type { AddressInfo } from "net";
import path from "path";
import {
  AffectedRange,
  isInAffectedRange,
  isVersionAtLeast,
  LockedCopy,
  lockedCopies,
  PackageJson,
  PackageLock,
  readPackageJson,
  readPackageLock,
  resolvedCopy,
} from "../Helpers/PackageLock";
import { getNativeRequire } from "../Helpers/RealBotbuilder";

/*
 * @AZURE/IDENTITY RUNS ON A FIXED MSAL NODE: GHSA-xcx6-jx8p-x3h5.
 *
 * "MSAL Node authorization code flow may disclose parameters to an
 * attacker-controlled endpoint": @azure/msal-node from 5.0.0-beta.0 up to
 * 7.1.0 is affected. It reaches Common through tedious (the SQL Server
 * driver under mssql), which requires @azure/identity - and @azure/identity
 * 4.14.0, the newest, still asks for msal-node ^6.0.0, with no fixed 6.x
 * (Azure/azure-sdk-for-js#40441 asks for the move to 7).
 *
 * MSAL Node 7's two breaking changes are both in acquireTokenInteractive's
 * browser loopback (its v7 migration guide), which @azure/identity reaches
 * only for InteractiveBrowserCredential and which tedious never uses. So
 * package.json overrides @azure/identity's msal-node with ^7.1.0, scoped to
 * @azure/identity: botbuilder's own msal-node 2.x is outside the advisory's
 * range and keeps its version. Common's and Probe's audit exceptions for the
 * advisory are gone (Scripts/Security/npm-audit-exceptions.json); Probe holds
 * its own lock the same way (Probe/Tests/Build/MsalNodeAdvisory.test.ts).
 *
 * These hold the lock to that, and run @azure/identity on the msal-node it
 * gets: a managed identity token from a fake App Service identity endpoint,
 * through MSAL Node's ManagedIdentityApplication.
 */

const COMMON_DIRECTORY: string = path.resolve(__dirname, "..", "..");
const FIXED_IN: string = "7.1.0";

const lock: PackageLock = readPackageLock(COMMON_DIRECTORY);
const packageJson: PackageJson = readPackageJson(COMMON_DIRECTORY);

// The advisory's range: >= 5.0.0-beta.0, < 7.1.0 (its betas included).
const AFFECTED: AffectedRange = { introduced: "5.0.0-beta.0", fixed: FIXED_IN };

describe("Common's @azure/msal-node", () => {
  test(`every @azure/identity in the lock loads msal-node ${FIXED_IN} or later`, () => {
    const identities: Array<LockedCopy> = lockedCopies(lock, "@azure/identity");

    expect(identities.length).toBeGreaterThan(0);

    for (const identity of identities) {
      const msal: LockedCopy | undefined = resolvedCopy(
        lock,
        identity.path,
        "@azure/msal-node",
      );

      expect({ identity: identity.path, msal: msal?.version }).toEqual({
        identity: identity.path,
        msal: expect.any(String),
      });
      expect(isVersionAtLeast(msal!.version, FIXED_IN)).toBe(true);
    }
  });

  test("no copy of msal-node in the lock is in the advisory's range", () => {
    const copies: Array<LockedCopy> = lockedCopies(lock, "@azure/msal-node");

    expect(copies.length).toBeGreaterThan(0);
    expect(
      copies.filter((copy: LockedCopy): boolean => {
        return isInAffectedRange(copy.version, AFFECTED);
      }),
    ).toEqual([]);
  });

  test("botbuilder keeps its own msal-node 2, outside the range: the override is scoped to @azure/identity", () => {
    const botbuilderMsal: LockedCopy | undefined = resolvedCopy(
      lock,
      "node_modules/botbuilder",
      "@azure/msal-node",
    );

    expect(botbuilderMsal?.version.startsWith("2.")).toBe(true);
    expect(
      (packageJson.overrides?.["@azure/identity"] as Record<string, string>)?.[
        "@azure/msal-node"
      ],
    ).toBe(`^${FIXED_IN}`);
    expect(packageJson.overrides).not.toHaveProperty("@azure/msal-node");
  });

  test("@azure/identity still asks for msal-node 6, so the override is still needed", () => {
    /*
     * When an @azure/identity release asks for ^7.1.0 itself, update to it and
     * drop the "@azure/identity" override from package.json (and Probe's).
     */
    for (const identity of lockedCopies(lock, "@azure/identity")) {
      expect({
        identity: identity.version,
        asksFor:
          lock.packages[identity.path]?.dependencies?.["@azure/msal-node"],
      }).toEqual({ identity: identity.version, asksFor: "^6.0.0" });
    }
  });
});

describe("@azure/identity on that msal-node", () => {
  const nativeRequire: NodeJS.Require = getNativeRequire(__filename);

  /*
   * @azure/identity (and so tedious and mssql) is loaded with Node's own
   * require: Common's jest maps @azure/* to a stub. It runs in Node's own
   * realm, so it reads Node's own environment - not this realm's copy of it.
   */
  const realProcess: NodeJS.Process = process.getBuiltinModule("process");

  const tokenRequests: Array<{ url: string; header: string | undefined }> = [];
  let server: http.Server;
  let identityEndpoint: string = "";

  beforeAll(async () => {
    server = http.createServer(
      (request: http.IncomingMessage, response: http.ServerResponse) => {
        tokenRequests.push({
          url: request.url || "",
          header: request.headers["x-identity-header"] as string | undefined,
        });
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            access_token: "token-from-the-fake-identity-endpoint",
            expires_on: String(Math.floor(Date.now() / 1000) + 3600),
            resource: "https://database.windows.net",
            token_type: "Bearer",
          }),
        );
      },
    );

    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    identityEndpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/msi/token`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
  });

  test("the @azure/identity tedious loads gets msal-node 7.1 or later", () => {
    const tediousDirectory: string = path.dirname(
      nativeRequire.resolve("tedious/package.json"),
    );
    const identityPackage: string = nativeRequire.resolve(
      "@azure/identity/package.json",
      { paths: [tediousDirectory] },
    );
    const msalPackage: string = nativeRequire.resolve(
      "@azure/msal-node/package.json",
      { paths: [path.dirname(identityPackage)] },
    );

    expect(
      isVersionAtLeast(
        String((nativeRequire(msalPackage) as PackageJson).version),
        FIXED_IN,
      ),
    ).toBe(true);
  });

  test("tedious and mssql, which load @azure/identity as they load, load", () => {
    expect(
      typeof (nativeRequire("tedious") as { Connection: unknown }).Connection,
    ).toBe("function");
    expect(
      typeof (nativeRequire("mssql") as { ConnectionPool: unknown })
        .ConnectionPool,
    ).toBe("function");
  });

  test("the credentials tedious makes for Microsoft Entra ID can be made", () => {
    const identity: Record<string, new (...args: Array<unknown>) => unknown> =
      nativeRequire("@azure/identity") as Record<
        string,
        new (...args: Array<unknown>) => unknown
      >;

    expect(() => {
      return new identity["ClientSecretCredential"]!(
        "00000000-0000-0000-0000-000000000001",
        "client-id",
        "client-secret",
      );
    }).not.toThrow();
    expect(() => {
      return new identity["ManagedIdentityCredential"]!();
    }).not.toThrow();
    expect(() => {
      return new identity["DefaultAzureCredential"]!();
    }).not.toThrow();
  });

  test("a managed identity token comes through MSAL Node 7, from a fake App Service identity endpoint", async () => {
    const previous: {
      endpoint: string | undefined;
      header: string | undefined;
    } = {
      endpoint: realProcess.env["IDENTITY_ENDPOINT"],
      header: realProcess.env["IDENTITY_HEADER"],
    };

    realProcess.env["IDENTITY_ENDPOINT"] = identityEndpoint;
    realProcess.env["IDENTITY_HEADER"] = "identity-header-secret";

    try {
      const identity: {
        ManagedIdentityCredential: new () => {
          getToken: (scope: string) => Promise<{
            token: string;
            expiresOnTimestamp: number;
          }>;
        };
      } = nativeRequire("@azure/identity") as {
        ManagedIdentityCredential: new () => {
          getToken: (scope: string) => Promise<{
            token: string;
            expiresOnTimestamp: number;
          }>;
        };
      };

      const token: { token: string; expiresOnTimestamp: number } =
        await new identity.ManagedIdentityCredential().getToken(
          "https://database.windows.net/.default",
        );

      expect(token.token).toBe("token-from-the-fake-identity-endpoint");
      expect(token.expiresOnTimestamp).toBeGreaterThan(Date.now());
      expect(tokenRequests).toHaveLength(1);
      expect(tokenRequests[0]!.header).toBe("identity-header-secret");

      const requested: URL = new URL(tokenRequests[0]!.url, identityEndpoint);

      expect(requested.pathname).toBe("/msi/token");
      expect(requested.searchParams.get("resource")).toBe(
        "https://database.windows.net",
      );
    } finally {
      for (const [name, value] of [
        ["IDENTITY_ENDPOINT", previous.endpoint],
        ["IDENTITY_HEADER", previous.header],
      ] as Array<[string, string | undefined]>) {
        if (value === undefined) {
          delete realProcess.env[name];
        } else {
          realProcess.env[name] = value;
        }
      }
    }
  });
});
