import { execFileSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { describe, expect, it } from "@jest/globals";

/*
 * No private key is ever committed.
 *
 * The license signing key is the one secret the Enterprise license rests on,
 * and ee/ is copied whole into the public Enterprise image. So:
 *
 *   - no file in the repository holds a real PEM private key (a BEGIN ...
 *     PRIVATE KEY block with an actual base64 body), except explicit test
 *     fixtures (a Tests/ directory or a *.test.* file);
 *   - nothing under ee/ outside ee/Tests even mentions the private key marker,
 *     placeholder or not;
 *   - .gitignore keeps key files written under ee/ out of the repository.
 *
 * Placeholders such as "-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END ..."
 * in form hints and docs are not keys, and are not flagged.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

// Built from parts so this file never holds the literal marker itself.
const MARKER_WORDS: string = ["PRIVATE", "KEY"].join(" ");
const PEM_DASHES: string = "-----";

const PRIVATE_KEY_BLOCK: RegExp = new RegExp(
  `${PEM_DASHES}BEGIN ((?:[A-Z0-9]+ )*)${MARKER_WORDS}${PEM_DASHES}([\\s\\S]*?)${PEM_DASHES}END`,
  "g",
);

const PRIVATE_KEY_MARKER: RegExp = new RegExp(
  `${PEM_DASHES}BEGIN (?:[A-Z0-9]+ )*${MARKER_WORDS}${PEM_DASHES}`,
);

// What may sit between the markers once a PEM is quoted or escaped in source.
const QUOTING_NOISE: RegExp = /\\n|\\r|["'`+,;\s]/g;
const BASE64_BODY: RegExp = /^[A-Za-z0-9+/=]+$/;

// A real Ed25519 PKCS#8 body is 64 base64 characters; RSA ones are far longer.
const MINIMUM_KEY_BODY_LENGTH: number = 60;

const SKIPPED_EXTENSIONS: ReadonlySet<string> = new Set<string>([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".pdf",
  ".zip",
  ".gz",
  ".tgz",
  ".mp4",
  ".mp3",
  ".wasm",
  ".lock",
]);

const MAXIMUM_SCANNED_FILE_SIZE_IN_BYTES: number = 5 * 1024 * 1024;

const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>([
  "node_modules",
  ".git",
  "build",
  "dist",
  "coverage",
]);

// Every body in `text` that is a real key rather than a placeholder.
const findPrivateKeyBodies: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  const bodies: Array<string> = [];
  const pattern: RegExp = new RegExp(PRIVATE_KEY_BLOCK.source, "g");
  let match: RegExpExecArray | null = pattern.exec(text);

  while (match) {
    const body: string = (match[2] || "").replace(QUOTING_NOISE, "");

    if (body.length >= MINIMUM_KEY_BODY_LENGTH && BASE64_BODY.test(body)) {
      bodies.push(body);
    }

    match = pattern.exec(text);
  }

  return bodies;
};

const isTestFixture: (relativePath: string) => boolean = (
  relativePath: string,
): boolean => {
  const normalized: string = relativePath.split(path.sep).join("/");

  return (
    normalized.split("/").includes("Tests") ||
    (/\.test\.[cm]?[jt]sx?$/).test(normalized) ||
    normalized.split("/").includes("__fixtures__")
  );
};

/*
 * The committed files (git ls-files), or - when git is unavailable - every
 * file on disk outside the skipped directories.
 */
const listRepositoryFiles: () => Array<string> = (): Array<string> => {
  try {
    const output: string = execFileSync("git", ["ls-files", "-z"], {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });

    return output.split("\0").filter((file: string): boolean => {
      return file.length > 0;
    });
  } catch {
    const files: Array<string> = [];
    const walk: (directory: string) => void = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!SKIPPED_DIRECTORIES.has(entry.name)) {
            walk(path.join(directory, entry.name));
          }
          continue;
        }

        if (entry.isFile()) {
          files.push(
            path.relative(REPOSITORY_ROOT, path.join(directory, entry.name)),
          );
        }
      }
    };

    walk(REPOSITORY_ROOT);
    return files;
  }
};

const readTextFile: (relativePath: string) => string | null = (
  relativePath: string,
): string | null => {
  if (SKIPPED_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) {
    return null;
  }

  const absolutePath: string = path.join(REPOSITORY_ROOT, relativePath);

  let stat: fs.Stats;

  try {
    stat = fs.lstatSync(absolutePath);
  } catch {
    // Listed by git but deleted in the working tree.
    return null;
  }

  if (!stat.isFile() || stat.size > MAXIMUM_SCANNED_FILE_SIZE_IN_BYTES) {
    return null;
  }

  return fs.readFileSync(absolutePath, "utf8");
};

describe("the private-key detector itself", () => {
  const realKeyPem: string = crypto
    .generateKeyPairSync("ed25519")
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString();

  it("finds a real key", () => {
    expect(findPrivateKeyBodies(`const key = \`${realKeyPem}\`;`)).toHaveLength(
      1,
    );
  });

  it("finds a real key written as an escaped one-line string", () => {
    const escaped: string = JSON.stringify(realKeyPem);

    expect(findPrivateKeyBodies(`key: ${escaped}`)).toHaveLength(1);
  });

  it("finds a real RSA key", () => {
    const rsaPem: string = crypto
      .generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ type: "pkcs1", format: "pem" })
      .toString();

    expect(findPrivateKeyBodies(rsaPem)).toHaveLength(1);
  });

  it.each([
    `"${PEM_DASHES}BEGIN ${MARKER_WORDS}${PEM_DASHES}\\nMIIE...\\n${PEM_DASHES}END ${MARKER_WORDS}${PEM_DASHES}"`,
    `#     ${PEM_DASHES}BEGIN RSA ${MARKER_WORDS}${PEM_DASHES}\n#     ...\n#     ${PEM_DASHES}END RSA ${MARKER_WORDS}${PEM_DASHES}`,
    `placeholder: "${PEM_DASHES}BEGIN OPENSSH ${MARKER_WORDS}${PEM_DASHES}",`,
    `the entire key including \`${PEM_DASHES}BEGIN ${MARKER_WORDS}${PEM_DASHES}\` and \`${PEM_DASHES}END ${MARKER_WORDS}${PEM_DASHES}\``,
  ])("does not flag the placeholder %s", (placeholder: string) => {
    expect(findPrivateKeyBodies(placeholder)).toEqual([]);
  });

  it("does not flag a public key", () => {
    const publicPem: string = crypto
      .generateKeyPairSync("ed25519")
      .publicKey.export({ type: "spki", format: "pem" })
      .toString();

    expect(findPrivateKeyBodies(publicPem)).toEqual([]);
  });

  it("treats Tests directories and test files as fixtures, and nothing else", () => {
    expect(isTestFixture("packages/Common/Tests/Server/Foo.test.ts")).toBe(true);
    expect(isTestFixture("ee/Tests/Server/License/Keys.ts")).toBe(true);
    expect(isTestFixture("packages/App/Foo.test.tsx")).toBe(true);
    expect(isTestFixture("ee/Server/License/TrustedLicenseKeys.ts")).toBe(false);
    expect(isTestFixture("ee/keys/license.pem")).toBe(false);
    expect(isTestFixture("packages/App/Testsuite/Key.ts")).toBe(false);
  });
});

describe("the repository", () => {
  const files: Array<string> = listRepositoryFiles();

  it("is scanned at all", () => {
    expect(files.length).toBeGreaterThan(1000);
    expect(files).toContain(path.join("ee", "package.json"));
  });

  it("holds no real private key outside explicit test fixtures", () => {
    const offenders: Array<string> = [];

    for (const file of files) {
      if (isTestFixture(file)) {
        continue;
      }

      const text: string | null = readTextFile(file);

      if (text === null || !text.includes(MARKER_WORDS)) {
        continue;
      }

      if (findPrivateKeyBodies(text).length > 0) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });

  /*
   * Stricter for ee/: everything outside ee/Tests is copied into the public
   * Enterprise image, so not even a placeholder marker belongs there.
   */
  it("has no private key marker anywhere in ee/ outside ee/Tests", () => {
    const offenders: Array<string> = [];

    for (const file of files) {
      const normalized: string = file.split(path.sep).join("/");

      if (!normalized.startsWith("ee/") || normalized.startsWith("ee/Tests/")) {
        continue;
      }

      const text: string | null = readTextFile(file);

      if (text !== null && PRIVATE_KEY_MARKER.test(text)) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("has no key files committed under ee/", () => {
    const keyFiles: Array<string> = files.filter((file: string): boolean => {
      const normalized: string = file.split(path.sep).join("/");

      return (
        normalized.startsWith("ee/") &&
        (normalized.endsWith(".pem") ||
          normalized.endsWith(".key") ||
          normalized.split("/").includes("keys"))
      );
    });

    expect(keyFiles).toEqual([]);
  });

  it("ignores key files written under ee/", () => {
    const gitignore: Array<string> = fs
      .readFileSync(path.join(REPOSITORY_ROOT, ".gitignore"), "utf8")
      .split("\n")
      .map((line: string): string => {
        return line.trim();
      });

    expect(gitignore).toContain("ee/**/*.pem");
    expect(gitignore).toContain("ee/keys/");
    expect(gitignore).toContain("ee/**/keys/");
  });
});
