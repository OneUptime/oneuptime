import fs from "fs";
import path from "path";

/*
 * The ENCRYPTION_SECRET configurations a self-hosted installation can be
 * running with that leave it equal to a value this repository ships - and so
 * known to everybody - plus one an operator chose.
 *
 * EnvironmentConfig reads ENCRYPTION_SECRET once, when it loads. A suite that
 * wants to see an installation configured one of these ways sets it with
 * setEncryptionSecret, calls jest.resetModules(), and imports the modules it
 * tests afresh; restoreEncryptionSecret puts the environment back.
 */

export interface ShippedEncryptionSecret {
  // How the installation got there, for test names.
  label: string;
  // The value of ENCRYPTION_SECRET, or undefined for "not set at all".
  value: string | undefined;
}

/* <repo>/packages/Common/Tests/Server/TestingUtils -> <repo> */
const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");

const EXAMPLE_ENV_LINE_PREFIX: string = "ENCRYPTION_SECRET=";

/*
 * The value config.example.env ships for ENCRYPTION_SECRET. The README's
 * Docker Compose install is `cp config.example.env config.env`, and
 * docker-compose.base.yml passes the variable through as it is, so this is
 * the value an installation runs with unless its operator edits it.
 */
export function readExampleEnvEncryptionSecret(): string {
  const example: string = fs.readFileSync(
    path.join(REPO_ROOT, "config.example.env"),
    "utf8",
  );

  for (const line of example.split("\n")) {
    if (line.startsWith(EXAMPLE_ENV_LINE_PREFIX)) {
      return line.slice(EXAMPLE_ENV_LINE_PREFIX.length).trim();
    }
  }

  throw new Error("config.example.env sets no ENCRYPTION_SECRET");
}

export const SHIPPED_ENCRYPTION_SECRETS: Array<ShippedEncryptionSecret> = [
  { label: "unset, so the code falls back to \"secret\"", value: undefined },
  { label: "set to an empty string by compose", value: "" },
  { label: "blank", value: "   " },
  { label: "the code's fallback \"secret\"", value: "secret" },
  { label: "\"secret\" padded with spaces", value: " secret " },
  {
    label: "the placeholder config.example.env ships",
    value: "please-change-this-to-random-value",
  },
  {
    label: "the shipped placeholder padded with spaces",
    value: " please-change-this-to-random-value ",
  },
  {
    label: "the shipped placeholder with something appended",
    value: "please-change-this-to-random-value-2",
  },
  { label: "the placeholder's prefix alone", value: "please-change-this" },
  {
    label: "whatever config.example.env ships today",
    value: readExampleEnvEncryptionSecret(),
  },
];

// A secret an operator generated, as the Docker Compose guide tells them to.
export const OPERATOR_ENCRYPTION_SECRET: string =
  "6f1d0c9b8a7e6d5c4b3a29180f7e6d5c4b3a29180f7e6d5c4b3a29180f7e6d5c";

const originalEncryptionSecret: string | undefined =
  process.env["ENCRYPTION_SECRET"];

export function setEncryptionSecret(value: string | undefined): void {
  if (value === undefined) {
    delete process.env["ENCRYPTION_SECRET"];
  } else {
    process.env["ENCRYPTION_SECRET"] = value;
  }
}

export function restoreEncryptionSecret(): void {
  setEncryptionSecret(originalEncryptionSecret);
}
