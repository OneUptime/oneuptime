import fs from "fs";
import path from "path";

/*
 * The ONEUPTIME_SECRET configurations a self-hosted installation can be
 * running with that leave its cluster key equal to a value this repository
 * ships - and so known to everybody - and some an operator chose.
 *
 * EnvironmentConfig reads ONEUPTIME_SECRET once, when it loads. A suite that
 * wants to see an installation configured one of these ways sets it with
 * setClusterKey and loads the modules it tests afresh (jest.isolateModules or
 * jest.resetModules); restoreClusterKey puts the environment back.
 */

export interface ClusterKeyConfiguration {
  // How the installation got there, for test names.
  label: string;
  // The value of ONEUPTIME_SECRET, or undefined for "not set at all".
  value: string | undefined;
}

/* <repo>/packages/Common/Tests/Server/TestingUtils -> <repo> */
const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");

const EXAMPLE_ENV_LINE_PREFIX: string = "ONEUPTIME_SECRET=";

/*
 * The value config.example.env ships for ONEUPTIME_SECRET. The README's
 * Docker Compose install is `cp config.example.env config.env`, and
 * docker-compose.base.yml passes the variable through as it is, so this is
 * the value an installation runs with unless something replaces it.
 */
export function readExampleEnvClusterKey(): string {
  const example: string = fs.readFileSync(
    path.join(REPO_ROOT, "config.example.env"),
    "utf8",
  );

  for (const line of example.split("\n")) {
    if (line.startsWith(EXAMPLE_ENV_LINE_PREFIX)) {
      return line.slice(EXAMPLE_ENV_LINE_PREFIX.length).trim();
    }
  }

  throw new Error("config.example.env sets no ONEUPTIME_SECRET");
}

/*
 * Every placeholder value config.example.env ships for any setting: a shipped
 * value is refused as a cluster key whichever setting it was copied from.
 */
export function readExampleEnvPlaceholders(): Array<string> {
  const example: string = fs.readFileSync(
    path.join(REPO_ROOT, "config.example.env"),
    "utf8",
  );

  const placeholders: Set<string> = new Set<string>();

  for (const line of example.split("\n")) {
    if (line.trim().startsWith("#") || !line.includes("=")) {
      continue;
    }

    const value: string = line.slice(line.indexOf("=") + 1).trim();

    if (value.includes("please-change-this")) {
      placeholders.add(value);
    }
  }

  return Array.from(placeholders);
}

export const SHIPPED_CLUSTER_KEYS: Array<ClusterKeyConfiguration> = [
  { label: 'unset, which the code used to read as "secret"', value: undefined },
  { label: "set to an empty string by compose", value: "" },
  { label: "blank", value: "   " },
  { label: 'the code\'s old fallback "secret"', value: "secret" },
  { label: '"secret" padded with spaces', value: " secret " },
  { label: '"secret" with a trailing line break', value: "secret\n" },
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
    label: "a global probe's placeholder copied across",
    value: "probe-1-please-change-this-to-random-value",
  },
  {
    label: "whatever config.example.env ships today",
    value: readExampleEnvClusterKey(),
  },
];

/*
 * Keys an operator chose: what the Docker Compose guide generates, what the
 * Helm chart generates, and the shapes people type - special characters
 * (which travel URI-encoded), whitespace they left in, non-ASCII, a long one,
 * and ones that merely start or end like a shipped value.
 */
export const OPERATOR_CLUSTER_KEYS: Array<ClusterKeyConfiguration> = [
  {
    label: "64 hex characters, as openssl rand -hex 32 makes",
    value: "3b9f1c7e5a2d48f6b0e9c3a7d1f5b8e2c6a4d0f9e3b7c1a5d8f2e6b0c4a9d3f7",
  },
  {
    label: "32 letters and digits, as the Helm chart makes",
    value: "Q7dVk2LmX9pR4tWz8NcB1sHf6JyG3uAe",
  },
  {
    label: "special characters that travel URI-encoded",
    value: "p@ss/w0rd?&=+%#;: with spaces",
  },
  { label: "padded with spaces", value: "  my-own-cluster-key-1234  " },
  { label: "non-ASCII", value: "clé-du-cluster-ä-ø-漢字-🔑" },
  { label: "a 1,000 character key", value: "k".repeat(1000) },
  { label: "one that starts like the old fallback", value: "secretive-key-99" },
  { label: "one that ends like the old fallback", value: "my-top-secret" },
  {
    label: "characters that travel as they are: ' ( ) ! * ~",
    value: "it's-(my)-key!*~Q7dVk2LmX9pR4tWz8NcB1sHf",
  },
];

const originalClusterKey: string | undefined = process.env["ONEUPTIME_SECRET"];

export function setClusterKey(value: string | undefined): void {
  if (value === undefined) {
    delete process.env["ONEUPTIME_SECRET"];
  } else {
    process.env["ONEUPTIME_SECRET"] = value;
  }
}

export function restoreClusterKey(): void {
  setClusterKey(originalClusterKey);
}
