import crypto, { KeyObject } from "crypto";
import fs from "fs";
import path from "path";
import LicenseToken from "../Server/License/LicenseToken";

/*
 * Generates the Ed25519 key pair OneUptime signs Enterprise licenses with.
 *
 *   npm run generate-license-signing-key -- \
 *     --out /secure/place/license-signing-key.pem
 *
 * (run from ee/, with packages/App installed). What it does, and what it
 * deliberately does not:
 *
 *   - writes the PRIVATE key (PKCS#8 PEM) to --out, creating the file with
 *     mode 0600 and refusing to overwrite anything that already exists;
 *   - refuses any --out inside this repository. The whole ee/ directory is
 *     copied into the public Enterprise image, so a key written "just here for
 *     a moment" would ship to every customer;
 *   - prints only the kid (the key's RFC 7638 thumbprint), the PUBLIC key and
 *     the TrustedLicenseKeys.ts entry to paste. The private key is never
 *     printed.
 *
 * The key ceremony order matters (see TrustedLicenseKeys.ts): release a build
 * that trusts the new public key, deploy it to the license server, and only
 * then give the license server the private key.
 */

export interface GeneratedLicenseSigningKey {
  kid: string;
  publicKeyPem: string;
  // Where the private key was written.
  privateKeyPath: string;
}

export class LicenseSigningKeyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "LicenseSigningKeyError";
  }
}

const USAGE: string =
  "Usage: GenerateLicenseSigningKey.ts --out <path outside the repository>";

// The repository this script lives in: ee/Scripts -> the repository root.
export const getRepositoryRoot: () => string = (): string => {
  return path.resolve(__dirname, "..", "..");
};

/*
 * The real location of `target`, resolving symlinks on the part of the path
 * that already exists (the file itself does not exist yet). Without this a
 * symlinked directory inside /tmp could point back into the repository.
 */
const resolveRealPath: (target: string) => string = (
  target: string,
): string => {
  const absolute: string = path.resolve(target);
  const missingParts: Array<string> = [];
  let existing: string = absolute;

  while (!fs.existsSync(existing)) {
    const parent: string = path.dirname(existing);

    if (parent === existing) {
      break;
    }

    missingParts.unshift(path.basename(existing));
    existing = parent;
  }

  const realExisting: string = fs.existsSync(existing)
    ? fs.realpathSync(existing)
    : existing;

  return path.join(realExisting, ...missingParts);
};

const isInside: (child: string, parent: string) => boolean = (
  child: string,
  parent: string,
): boolean => {
  const relative: string = path.relative(parent, child);

  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
};

/*
 * The absolute path the private key will be written to. Throws when it is
 * inside the repository (symlinks resolved).
 */
export const resolvePrivateKeyPath: (data: {
  outputPath: string;
  repositoryRoot: string;
}) => string = (data: {
  outputPath: string;
  repositoryRoot: string;
}): string => {
  if (!data.outputPath || !data.outputPath.trim()) {
    throw new LicenseSigningKeyError(USAGE);
  }

  const outputPath: string = resolveRealPath(data.outputPath.trim());
  const repositoryRoot: string = resolveRealPath(data.repositoryRoot);

  if (isInside(outputPath, repositoryRoot)) {
    throw new LicenseSigningKeyError(
      `Refusing to write a private key inside the repository (${repositoryRoot}). ` +
        "Everything under ee/ is copied into the public Enterprise image. " +
        "Write it somewhere outside the repository, then move it into your secret store.",
    );
  }

  return outputPath;
};

export const formatTrustedKeySnippet: (data: {
  kid: string;
  publicKeyPem: string;
}) => string = (data: { kid: string; publicKeyPem: string }): string => {
  const pem: string = data.publicKeyPem.trim();

  return [
    "  {",
    `    kid: "${data.kid}",`,
    "    publicKeyPem:",
    ...pem
      .split("\n")
      .map((line: string, index: number, lines: Array<string>): string => {
        const isLast: boolean = index === lines.length - 1;
        return `      "${line}\\n"${isLast ? "," : " +"}`;
      }),
    "  },",
  ].join("\n");
};

/*
 * Generates the key pair and writes the private key. The file is created with
 * flag "wx" (fail if it exists) and mode 0600 - the mode applies only to a
 * newly created file, which "wx" guarantees this is.
 */
export const generateLicenseSigningKey: (data: {
  outputPath: string;
  repositoryRoot?: string | undefined;
}) => GeneratedLicenseSigningKey = (data: {
  outputPath: string;
  repositoryRoot?: string | undefined;
}): GeneratedLicenseSigningKey => {
  const privateKeyPath: string = resolvePrivateKeyPath({
    outputPath: data.outputPath,
    repositoryRoot: data.repositoryRoot || getRepositoryRoot(),
  });

  const { publicKey, privateKey }: { publicKey: KeyObject; privateKey: KeyObject } =
    crypto.generateKeyPairSync("ed25519");

  const privateKeyPem: string = privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();
  const publicKeyPem: string = publicKey
    .export({ type: "spki", format: "pem" })
    .toString();

  try {
    fs.writeFileSync(privateKeyPath, privateKeyPem, {
      flag: "wx",
      mode: 0o600,
    });
  } catch (err) {
    const code: unknown = (err as NodeJS.ErrnoException).code;

    if (code === "EEXIST") {
      throw new LicenseSigningKeyError(
        `${privateKeyPath} already exists. Refusing to overwrite a key; choose a new path.`,
      );
    }

    throw err;
  }

  return {
    kid: LicenseToken.computeKeyId(publicKey),
    publicKeyPem,
    privateKeyPath,
  };
};

// Everything the script prints. Never the private key.
export const formatReport: (result: GeneratedLicenseSigningKey) => string = (
  result: GeneratedLicenseSigningKey,
): string => {
  return [
    `Private key written to ${result.privateKeyPath} (mode 0600). It is not printed here.`,
    "",
    `kid: ${result.kid}`,
    "",
    "Public key:",
    result.publicKeyPem.trim(),
    "",
    "Add this entry to PRODUCTION_TRUSTED_LICENSE_KEYS in ee/Server/License/TrustedLicenseKeys.ts:",
    formatTrustedKeySnippet({
      kid: result.kid,
      publicKeyPem: result.publicKeyPem,
    }),
    "",
    "Then: release a build that trusts this key, deploy it to the license server, and only then",
    "give the license server the private key (ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY).",
  ].join("\n");
};

export const parseArguments: (argv: Array<string>) => { outputPath: string } = (
  argv: Array<string>,
): { outputPath: string } => {
  for (let index: number = 0; index < argv.length; index++) {
    const argument: string = argv[index] as string;

    if (argument === "--out") {
      return { outputPath: argv[index + 1] || "" };
    }

    if (argument.startsWith("--out=")) {
      return { outputPath: argument.slice("--out=".length) };
    }
  }

  throw new LicenseSigningKeyError(USAGE);
};

/*
 * The command line entry point. Returns the exit code; output goes through
 * the given writers so the tests can capture it.
 */
export const main: (data: {
  argv: Array<string>;
  writeOut: (text: string) => void;
  writeError: (text: string) => void;
  repositoryRoot?: string | undefined;
}) => number = (data: {
  argv: Array<string>;
  writeOut: (text: string) => void;
  writeError: (text: string) => void;
  repositoryRoot?: string | undefined;
}): number => {
  try {
    const { outputPath }: { outputPath: string } = parseArguments(data.argv);
    const result: GeneratedLicenseSigningKey = generateLicenseSigningKey({
      outputPath,
      repositoryRoot: data.repositoryRoot,
    });

    data.writeOut(`${formatReport(result)}\n`);
    return 0;
  } catch (err) {
    data.writeError(
      `${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }
};

if (require.main === module) {
  process.exitCode = main({
    argv: process.argv.slice(2),
    writeOut: (text: string): void => {
      process.stdout.write(text);
    },
    writeError: (text: string): void => {
      process.stderr.write(text);
    },
  });
}
