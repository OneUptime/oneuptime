import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { ManagedIdentityCredential } from "@azure/identity";
import http from "http";
import type { AddressInfo } from "net";
import path from "path";
import {
  isVersionAtLeast,
  LockedCopy,
  lockedCopies,
  PackageJson,
  PackageLock,
  readPackageJson,
  readPackageLock,
  resolvedCopy,
} from "Common/Tests/Helpers/PackageLock";

/*
 * THE PROBE'S @AZURE/IDENTITY RUNS ON A FIXED MSAL NODE: GHSA-xcx6-jx8p-x3h5.
 *
 * The Probe's SQL Server monitors (SqlMonitor, DatabaseMonitor) use mssql,
 * whose driver, tedious, requires @azure/identity - and @azure/identity
 * 4.14.0, the newest, still asks for @azure/msal-node ^6.0.0, every 6.x of
 * which the advisory covers (>= 5.0.0-beta.0, < 7.1.0). MSAL Node 7's
 * breaking changes are both in acquireTokenInteractive's browser loopback,
 * which tedious never uses, so package.json overrides @azure/identity's
 * msal-node with ^7.1.0, as Common's does (Common's
 * Tests/Dependencies/MsalNodeAdvisory.test.ts has the whole story), and the
 * Probe's audit exception is gone.
 *
 * These hold the Probe's lock to it and run the Probe's @azure/identity on
 * the msal-node it gets: a managed identity token from a fake App Service
 * identity endpoint.
 */

const PROBE_DIRECTORY: string = path.resolve(__dirname, "..", "..");
const FIXED_IN: string = "7.1.0";

const lock: PackageLock = readPackageLock(PROBE_DIRECTORY);
const packageJson: PackageJson = readPackageJson(PROBE_DIRECTORY);

describe("the Probe's @azure/msal-node", () => {
  test(`every @azure/identity in the lock loads msal-node ${FIXED_IN} or later`, () => {
    const identities: Array<LockedCopy> = lockedCopies(lock, "@azure/identity");

    expect(identities.length).toBeGreaterThan(0);

    for (const identity of identities) {
      const msal: LockedCopy | undefined = resolvedCopy(
        lock,
        identity.path,
        "@azure/msal-node",
      );

      expect(msal).toBeDefined();
      expect(isVersionAtLeast(msal!.version, FIXED_IN)).toBe(true);
    }
  });

  test("no copy of msal-node in the lock is in the advisory's range", () => {
    expect(
      lockedCopies(lock, "@azure/msal-node").filter(
        (copy: LockedCopy): boolean => {
          return (
            isVersionAtLeast(copy.version, "5.0.0") &&
            !isVersionAtLeast(copy.version, FIXED_IN)
          );
        },
      ),
    ).toEqual([]);
  });

  test("the override says so, scoped to @azure/identity", () => {
    expect(
      (packageJson.overrides?.["@azure/identity"] as Record<string, string>)?.[
        "@azure/msal-node"
      ],
    ).toBe(`^${FIXED_IN}`);
  });

  test("@azure/identity still asks for msal-node 6, so the override is still needed", () => {
    // When an @azure/identity release asks for ^7.1.0 itself, drop the override.
    for (const identity of lockedCopies(lock, "@azure/identity")) {
      expect(
        lock.packages[identity.path]?.dependencies?.["@azure/msal-node"],
      ).toBe("^6.0.0");
    }
  });
});

describe("the Probe's @azure/identity on that msal-node", () => {
  const tokenRequests: Array<{ url: string; header: string | undefined }> =
    [];
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
            access_token: "probe-token-from-the-fake-identity-endpoint",
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

  test("the msal-node @azure/identity loads is 7.1 or later", () => {
    const identityDirectory: string = path.dirname(
      require.resolve("@azure/identity/package.json"),
    );
    const msalPackage: string = require.resolve(
      "@azure/msal-node/package.json",
      { paths: [identityDirectory] },
    );

    expect(
      isVersionAtLeast(
        String((require(msalPackage) as PackageJson).version),
        FIXED_IN,
      ),
    ).toBe(true);
  });

  test("a managed identity token comes through MSAL Node 7, from a fake App Service identity endpoint", async () => {
    const previous: {
      endpoint: string | undefined;
      header: string | undefined;
    } = {
      endpoint: process.env["IDENTITY_ENDPOINT"],
      header: process.env["IDENTITY_HEADER"],
    };

    process.env["IDENTITY_ENDPOINT"] = identityEndpoint;
    process.env["IDENTITY_HEADER"] = "probe-identity-header";

    try {
      const token: { token: string; expiresOnTimestamp: number } | null =
        await new ManagedIdentityCredential().getToken(
          "https://database.windows.net/.default",
        );

      expect(token?.token).toBe("probe-token-from-the-fake-identity-endpoint");
      expect(tokenRequests).toHaveLength(1);
      expect(tokenRequests[0]!.header).toBe("probe-identity-header");
      expect(
        new URL(tokenRequests[0]!.url, identityEndpoint).searchParams.get(
          "resource",
        ),
      ).toBe("https://database.windows.net");
    } finally {
      for (const [name, value] of [
        ["IDENTITY_ENDPOINT", previous.endpoint],
        ["IDENTITY_HEADER", previous.header],
      ] as Array<[string, string | undefined]>) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    }
  });
});
