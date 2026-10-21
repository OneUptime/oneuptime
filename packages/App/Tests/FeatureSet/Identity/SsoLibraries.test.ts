import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import { createRequire } from "module";
import path from "path";

/*
 * Single sign-on's libraries belong to App (core), which serves SAML and OIDC
 * in every edition, so App's package.json declares them as runtime
 * dependencies: the Community image installs App's dependencies and nothing
 * from ee/.
 *
 * App's lock keeps xml-crypto at exactly 6.1.2, the version ee had locked.
 * The XML Signature Wrapping defences in FeatureSet/Identity/Utils/SSO.ts
 * (#2949, #2981, #2988) and their regression tests (SSO.test.ts,
 * SSORealWorldPayloads.test.ts) depend on how this version canonicalizes and
 * resolves signature references, so a change of version must be a deliberate
 * one, reviewed against them - never a silent drift inside the ^6.1.2 range.
 *
 * OIDC.test.ts and OidcEgressGuard.test.ts override openid-client's
 * process-wide defaults, which only works while the OIDC utility and its
 * tests load the same copy of the library.
 */

const APP_DIR: string = path.resolve(__dirname, "..", "..", "..");

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  version?: string;
}

interface PackageLock {
  packages: Record<string, PackageJson>;
}

const readJson: <T>(...parts: Array<string>) => T = <T>(
  ...parts: Array<string>
): T => {
  return JSON.parse(fs.readFileSync(path.join(APP_DIR, ...parts), "utf8")) as T;
};

const appPackageJson: PackageJson = readJson<PackageJson>("package.json");
const appPackageLock: PackageLock = readJson<PackageLock>("package-lock.json");

const lockedVersionOf: (name: string) => string | undefined = (
  name: string,
): string | undefined => {
  return appPackageLock.packages[`node_modules/${name}`]?.version;
};

const installedVersionOf: (name: string) => string | undefined = (
  name: string,
): string | undefined => {
  return readJson<PackageJson>("node_modules", name, "package.json").version;
};

// The ranges ee declared before single sign-on moved back to core.
const SINGLE_SIGN_ON_LIBRARIES: Record<string, string> = {
  "openid-client": "^5.7.1",
  "xml-crypto": "^6.1.2",
  "@xmldom/xmldom": "^0.9.10",
};

describe("single sign-on's libraries are App's", () => {
  test.each(Object.entries(SINGLE_SIGN_ON_LIBRARIES))(
    "App declares %s %s as a runtime dependency",
    (name: string, range: string) => {
      expect(appPackageJson.dependencies?.[name]).toBe(range);
      expect(appPackageJson.devDependencies?.[name]).toBeUndefined();
    },
  );

  test("the lock keeps xml-crypto at exactly 6.1.2", () => {
    expect(lockedVersionOf("xml-crypto")).toBe("6.1.2");
  });

  test("the lock keeps openid-client on 5.x and @xmldom/xmldom on 0.9.x, the APIs the code is written against", () => {
    expect(lockedVersionOf("openid-client")).toMatch(/^5\.\d+\.\d+$/);
    expect(lockedVersionOf("@xmldom/xmldom")).toMatch(/^0\.9\.\d+$/);
  });

  test.each(Object.keys(SINGLE_SIGN_ON_LIBRARIES))(
    "the installed %s is the locked one",
    (name: string) => {
      expect(installedVersionOf(name)).toBe(lockedVersionOf(name));
    },
  );

  test("the OIDC utility and its tests load the same openid-client", () => {
    const fromUtility: string = createRequire(
      path.join(APP_DIR, "FeatureSet", "Identity", "Utils", "OIDC.ts"),
    ).resolve("openid-client");
    const fromTests: string = createRequire(
      path.join(__dirname, "OIDC.test.ts"),
    ).resolve("openid-client");

    expect(fromTests).toBe(fromUtility);
    // Resolution returns real paths; node_modules may be a link (a mirrored checkout).
    expect(
      fromUtility.startsWith(
        fs.realpathSync(path.join(APP_DIR, "node_modules")),
      ),
    ).toBe(true);
  });
});
