import crypto, { KeyObject } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import {
  formatReport,
  formatTrustedKeySnippet,
  generateLicenseSigningKey,
  GeneratedLicenseSigningKey,
  getRepositoryRoot,
  LicenseSigningKeyError,
  main,
  parseArguments,
  resolvePrivateKeyPath,
} from "../../../Scripts/GenerateLicenseSigningKey";
import LicenseToken, {
  classifyLicenseToken,
  LicenseTokenClassification,
  resolveTrustedLicenseKeys,
} from "../../../Server/License/LicenseToken";
import { TrustedLicenseKey } from "../../../Server/License/TrustedLicenseKeys";
import {
  ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
  ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
} from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
import { claimsFor } from "./Helpers/LicenseTestKit";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * The license signing key generator. The key it makes is the one thing that
 * turns "unverified" licenses into verified ones, so it is held to:
 *
 *   - the private key lands only where it was asked to, created fresh (never
 *     overwriting) with mode 0600, and never inside this repository - ee/ is
 *     copied into the public Enterprise image;
 *   - it prints the kid, the public key and the TrustedLicenseKeys entry, and
 *     never the private key;
 *   - what it prints actually works: pasted into TrustedLicenseKeys, it makes
 *     tokens signed with the written key verify.
 *
 * Every key here goes to a temporary directory outside the repository.
 */

// Built from parts so this file never holds the literal marker.
const PRIVATE_KEY_MARKER: string = ["PRIVATE", "KEY"].join(" ");

let temporaryDirectory: string;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-license-key-test-"),
  );
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

const keyPath: (name?: string) => string = (name?: string): string => {
  return path.join(temporaryDirectory, name || "license-signing-key.pem");
};

// The snippet is TypeScript for an object literal; it is also valid JS.
const evaluateSnippet: (snippet: string) => TrustedLicenseKey = (
  snippet: string,
): TrustedLicenseKey => {
  const expression: string = snippet.trim().replace(/,$/, "");

  return new Function(`return (${expression});`)() as TrustedLicenseKey;
};

describe("GenerateLicenseSigningKey - the key it writes", () => {
  it("writes an Ed25519 private key that matches the printed public key and kid", () => {
    const result: GeneratedLicenseSigningKey = generateLicenseSigningKey({
      outputPath: keyPath(),
    });

    const privateKey: KeyObject = crypto.createPrivateKey(
      fs.readFileSync(result.privateKeyPath, "utf8"),
    );

    expect(privateKey.asymmetricKeyType).toBe("ed25519");
    expect(
      crypto
        .createPublicKey(privateKey.export({ type: "pkcs8", format: "pem" }))
        .export({ type: "spki", format: "pem" })
        .toString(),
    ).toBe(result.publicKeyPem);
    expect(result.kid).toBe(LicenseToken.computeKeyId(privateKey));
    expect(result.kid).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("creates the file readable by its owner only", () => {
    const result: GeneratedLicenseSigningKey = generateLicenseSigningKey({
      outputPath: keyPath(),
    });

    expect(fs.statSync(result.privateKeyPath).mode & 0o777).toBe(0o600);
  });

  it("returns the real, absolute path it wrote to", () => {
    const result: GeneratedLicenseSigningKey = generateLicenseSigningKey({
      outputPath: keyPath(),
    });

    expect(path.isAbsolute(result.privateKeyPath)).toBe(true);
    expect(fs.existsSync(result.privateKeyPath)).toBe(true);
  });

  it("makes a new key every time", () => {
    const first: GeneratedLicenseSigningKey = generateLicenseSigningKey({
      outputPath: keyPath("first.pem"),
    });
    const second: GeneratedLicenseSigningKey = generateLicenseSigningKey({
      outputPath: keyPath("second.pem"),
    });

    expect(first.kid).not.toBe(second.kid);
  });

  /*
   * The mode only applies to a file that is created; "wx" makes sure it is.
   * Overwriting would also destroy a key that may already be signing.
   */
  it("refuses to overwrite an existing file, and leaves it untouched", () => {
    fs.writeFileSync(keyPath(), "the key that is already signing");

    expect(() => {
      generateLicenseSigningKey({ outputPath: keyPath() });
    }).toThrow(LicenseSigningKeyError);
    expect(fs.readFileSync(keyPath(), "utf8")).toBe(
      "the key that is already signing",
    );
  });

  it("fails when the directory does not exist rather than creating it", () => {
    expect(() => {
      generateLicenseSigningKey({
        outputPath: path.join(temporaryDirectory, "missing", "key.pem"),
      });
    }).toThrow();
    expect(fs.existsSync(path.join(temporaryDirectory, "missing"))).toBe(false);
  });
});

describe("GenerateLicenseSigningKey - never inside the repository", () => {
  it("finds the repository root from its own location", () => {
    expect(
      fs.existsSync(path.join(getRepositoryRoot(), "ee", "package.json")),
    ).toBe(true);
    expect(fs.existsSync(path.join(getRepositoryRoot(), "packages"))).toBe(
      true,
    );
  });

  it.each([
    ["ee/", ["ee", "license-signing-key.pem"]],
    ["ee/keys/", ["ee", "keys", "license-signing-key.pem"]],
    ["the repository root", ["license-signing-key.pem"]],
    ["a new directory in the repository", ["not-yet-created", "key.pem"]],
  ])(
    "refuses a path in %s and writes nothing",
    (_label: string, parts: Array<string>) => {
      const target: string = path.join(getRepositoryRoot(), ...parts);

      expect(() => {
        generateLicenseSigningKey({ outputPath: target });
      }).toThrow(/inside the repository/);
      expect(fs.existsSync(target)).toBe(false);
    },
  );

  it("refuses a relative path that resolves into the repository", () => {
    const relative: string = path.relative(
      process.cwd(),
      path.join(getRepositoryRoot(), "ee", "key.pem"),
    );

    expect(() => {
      resolvePrivateKeyPath({
        outputPath: relative,
        repositoryRoot: getRepositoryRoot(),
      });
    }).toThrow(LicenseSigningKeyError);
  });

  it("refuses a path that reaches the repository through a symlink", () => {
    const fakeRepository: string = path.join(temporaryDirectory, "repo");
    fs.mkdirSync(path.join(fakeRepository, "ee"), { recursive: true });
    const link: string = path.join(temporaryDirectory, "innocent-looking");
    fs.symlinkSync(path.join(fakeRepository, "ee"), link);

    expect(() => {
      generateLicenseSigningKey({
        outputPath: path.join(link, "key.pem"),
        repositoryRoot: fakeRepository,
      });
    }).toThrow(/inside the repository/);
    expect(fs.existsSync(path.join(fakeRepository, "ee", "key.pem"))).toBe(
      false,
    );
  });

  it("accepts a sibling directory whose name merely starts like the repository's", () => {
    const fakeRepository: string = path.join(temporaryDirectory, "repo");
    const sibling: string = path.join(temporaryDirectory, "repo-keys");
    fs.mkdirSync(fakeRepository);
    fs.mkdirSync(sibling);

    expect(
      resolvePrivateKeyPath({
        outputPath: path.join(sibling, "key.pem"),
        repositoryRoot: fakeRepository,
      }),
    ).toBe(path.join(fs.realpathSync(sibling), "key.pem"));
  });

  it("refuses an empty path", () => {
    expect(() => {
      resolvePrivateKeyPath({
        outputPath: "  ",
        repositoryRoot: getRepositoryRoot(),
      });
    }).toThrow(LicenseSigningKeyError);
  });
});

describe("GenerateLicenseSigningKey - what it prints", () => {
  it("never prints the private key", () => {
    const result: GeneratedLicenseSigningKey = generateLicenseSigningKey({
      outputPath: keyPath(),
    });
    const report: string = formatReport(result);
    const privatePem: string = fs.readFileSync(result.privateKeyPath, "utf8");
    const privateBody: string = privatePem
      .split("\n")
      .filter((line: string): boolean => {
        return line.length > 0 && !line.startsWith("-----");
      })
      .join("");

    expect(report).not.toContain(PRIVATE_KEY_MARKER);
    expect(report.replace(/\s/g, "")).not.toContain(privateBody);
    expect(report).toContain(result.kid);
    expect(report).toContain(result.publicKeyPem.trim());
    expect(report).toContain(result.privateKeyPath);
  });

  /*
   * The whole point: paste the printed entry into TrustedLicenseKeys and
   * tokens signed with the written key verify.
   */
  it("prints a TrustedLicenseKeys entry that makes the written key's tokens verify", () => {
    const result: GeneratedLicenseSigningKey = generateLicenseSigningKey({
      outputPath: keyPath(),
    });
    const entry: TrustedLicenseKey = evaluateSnippet(
      formatTrustedKeySnippet({
        kid: result.kid,
        publicKeyPem: result.publicKeyPem,
      }),
    );

    expect(entry.kid).toBe(result.kid);
    expect(entry.publicKeyPem).toBe(result.publicKeyPem);
    expect(resolveTrustedLicenseKeys([entry]).problems).toEqual([]);

    const token: string = LicenseToken.sign(
      claimsFor(),
      crypto.createPrivateKey(fs.readFileSync(result.privateKeyPath, "utf8")),
    );
    const classification: LicenseTokenClassification = classifyLicenseToken({
      token,
      storedColumns: {},
      now: new Date(),
      trustedKeys: [entry],
      localInstanceId: null,
      graceDays: ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
      trialDays: ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
      acceptUnverified: false,
    });

    expect(classification.verification).toBe("verified");
    expect(classification.status).toBe("valid");
  });

  it("puts the entry in the report exactly as formatTrustedKeySnippet makes it", () => {
    const result: GeneratedLicenseSigningKey = generateLicenseSigningKey({
      outputPath: keyPath(),
    });

    expect(formatReport(result)).toContain(
      formatTrustedKeySnippet({
        kid: result.kid,
        publicKeyPem: result.publicKeyPem,
      }),
    );
  });
});

describe("GenerateLicenseSigningKey - the command line", () => {
  type Captured = { out: string; error: string };

  const run: (argv: Array<string>) => { code: number } & Captured = (
    argv: Array<string>,
  ): { code: number } & Captured => {
    const captured: Captured = { out: "", error: "" };
    const code: number = main({
      argv,
      writeOut: (text: string): void => {
        captured.out += text;
      },
      writeError: (text: string): void => {
        captured.error += text;
      },
    });

    return { code, ...captured };
  };

  it("writes the key and prints the report with --out <path>", () => {
    const result: { code: number } & Captured = run(["--out", keyPath()]);

    expect(result.code).toBe(0);
    expect(result.error).toBe("");
    expect(result.out).toContain("kid: ");
    expect(result.out).not.toContain(PRIVATE_KEY_MARKER);
    expect(fs.existsSync(keyPath())).toBe(true);
  });

  it("accepts --out=<path>", () => {
    expect(run([`--out=${keyPath()}`]).code).toBe(0);
  });

  it("fails with the usage when --out is missing", () => {
    const result: { code: number } & Captured = run([]);

    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.error).toContain("--out");
  });

  it("fails, writing nothing, for a path inside the repository", () => {
    const target: string = path.join(getRepositoryRoot(), "ee", "leak.pem");
    const result: { code: number } & Captured = run(["--out", target]);

    expect(result.code).toBe(1);
    expect(result.error).toContain("inside the repository");
    expect(fs.existsSync(target)).toBe(false);
  });

  it("parses the arguments it documents", () => {
    expect(parseArguments(["--out", "/a/b.pem"]).outputPath).toBe("/a/b.pem");
    expect(parseArguments(["--out=/a/b.pem"]).outputPath).toBe("/a/b.pem");
    expect(() => {
      parseArguments(["/a/b.pem"]);
    }).toThrow(LicenseSigningKeyError);
  });
});
