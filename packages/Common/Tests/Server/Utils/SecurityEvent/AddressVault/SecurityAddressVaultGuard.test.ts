import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { escapeRegExp } from "../../../../../Utils/RegExpEscape";

/*
 * GUARD: ONLY SECURITY EVENTS' SCANS AND THE INGEST WRITER REACH THE
 * ADDRESS VAULT (#10395).
 *
 * The vault holds the IP address behind each token an IP Address Hash rule
 * left in the logs and traces Security Events reads. Its whole promise is
 * that nobody reading telemetry sees those addresses: no API, explorer,
 * export, Data Security scan or AI tool may read it - only Security Events'
 * scans, server side, and only ingest's writer writes it.
 *
 * So the vault is reached through a chain of exactly four modules, and this
 * reads every file of code in the repository (tests aside) for each link:
 *
 *   - its table name, "SecurityAddressVaultV1", is spelt only where table
 *     names are (AnalyticsTableName), so no raw query can name it;
 *   - AnalyticsTableName.SecurityAddressVault is read only by its model;
 *   - the model is imported only by its service;
 *   - the service is imported only by the services registry (so boot
 *     creates the table: its generic reads are refused,
 *     SecurityAddressVaultService.test.ts), the writer and the lookup;
 *   - the lookup is imported only by the trace scan and the log scan;
 *   - the writer is imported only by the ingest services that scrub logs
 *     and traces.
 *
 * A file that needs the vault for something else fails here, and its
 * review is the decision. Each link is also checked to hold the files it
 * names, so the guard cannot pass by reading nothing.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../../../..");

// Where code lives: every package, the enterprise edition, the scripts.
const SCANNED_ROOTS: Array<string> = [
  path.join(REPOSITORY_ROOT, "packages"),
  path.join(REPOSITORY_ROOT, "ee"),
  path.join(REPOSITORY_ROOT, "Scripts"),
];

const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>([
  "node_modules",
  "build",
  "dist",
  "coverage",
  "playwright-report",
  "test-results",
  // Tests may read and write the vault: they are not a way in.
  "Tests",
  "tests",
  "__tests__",
]);

const CODE_FILE: RegExp = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const TEST_FILE: RegExp = /\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const DECLARATION_FILE: RegExp = /\.d\.ts$/;

function codeFiles(): Array<string> {
  const files: Array<string> = [];

  const walk: (directory: string) => void = (directory: string): void => {
    if (!fs.existsSync(directory)) {
      return;
    }

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) {
        continue;
      }

      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          walk(full);
        }

        continue;
      }

      if (
        entry.isFile() &&
        CODE_FILE.test(entry.name) &&
        !TEST_FILE.test(entry.name) &&
        !DECLARATION_FILE.test(entry.name)
      ) {
        files.push(full);
      }
    }
  };

  for (const root of SCANNED_ROOTS) {
    walk(root);
  }

  return files;
}

function relative(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

// An import (or export ... from, or require) of a module whose path ends so.
function importsModule(source: string, moduleEnding: string): boolean {
  const pattern: RegExp = new RegExp(
    `(?:from\\s+|require\\(\\s*|import\\(\\s*|import\\s+)["'][^"']*${escapeRegExp(moduleEnding)}["']`,
  );

  return pattern.test(source);
}

// The enum member that names the vault's table, however it is spaced.
const TABLE_NAME_MEMBER: RegExp =
  /AnalyticsTableName\s*\.\s*SecurityAddressVault\b/;

interface Link {
  what: string;
  // Whether a file's source makes this link.
  makes: (source: string) => boolean;
  // The only files that may, repository-relative.
  allowed: ReadonlyArray<string>;
}

const LINKS: ReadonlyArray<Link> = [
  {
    what: 'the vault\'s table name, "SecurityAddressVaultV1"',
    makes: (source: string): boolean => {
      return source.includes("SecurityAddressVaultV1");
    },
    allowed: ["packages/Common/Types/AnalyticsDatabase/AnalyticsTableName.ts"],
  },
  {
    what: "AnalyticsTableName.SecurityAddressVault",
    makes: (source: string): boolean => {
      return TABLE_NAME_MEMBER.test(source);
    },
    allowed: ["packages/Common/Models/AnalyticsModels/SecurityAddressVault.ts"],
  },
  {
    what: "the vault's model",
    makes: (source: string): boolean => {
      return importsModule(
        source,
        "Models/AnalyticsModels/SecurityAddressVault",
      );
    },
    allowed: ["packages/Common/Server/Services/SecurityAddressVaultService.ts"],
  },
  {
    what: "the vault's service",
    makes: (source: string): boolean => {
      return (
        importsModule(source, "Services/SecurityAddressVaultService") ||
        importsModule(source, "./SecurityAddressVaultService")
      );
    },
    allowed: [
      "packages/Common/Server/Services/Index.ts",
      "packages/Common/Server/Utils/SecurityEvent/AddressVault/SecurityAddressVaultLookup.ts",
      "packages/Common/Server/Utils/SecurityEvent/AddressVault/SecurityAddressVaultWriter.ts",
    ],
  },
  {
    what: "the vault's lookup, which reads it",
    makes: (source: string): boolean => {
      return importsModule(source, "AddressVault/SecurityAddressVaultLookup");
    },
    allowed: [
      "packages/Common/Server/Utils/SecurityEvent/LogScan/SecurityLogScanner.ts",
      "packages/Common/Server/Utils/SecurityEvent/TelemetryScan/TraceSecurityScan.ts",
    ],
  },
  {
    what: "the vault's writer, which writes it",
    makes: (source: string): boolean => {
      return importsModule(source, "AddressVault/SecurityAddressVaultWriter");
    },
    allowed: [
      "packages/App/FeatureSet/Telemetry/Services/FluentLogsIngestService.ts",
      "packages/App/FeatureSet/Telemetry/Services/OtelLogsIngestService.ts",
      "packages/App/FeatureSet/Telemetry/Services/OtelTracesIngestService.ts",
      "packages/App/FeatureSet/Telemetry/Services/ProbeSyslogIngestService.ts",
      "packages/App/FeatureSet/Telemetry/Services/SyslogIngestService.ts",
    ],
  },
];

describe("the address vault is reached through its chain of modules only", () => {
  const files: Array<string> = codeFiles();
  const sources: Map<string, string> = new Map<string, string>();

  for (const file of files) {
    sources.set(relative(file), fs.readFileSync(file, "utf8"));
  }

  test("the walk read the repository's code", () => {
    // The server's code, the ingest services and the browser's all read.
    expect(files.length).toBeGreaterThan(5000);
    expect(
      sources.has(
        "packages/App/FeatureSet/Telemetry/Services/OtelTracesIngestService.ts",
      ),
    ).toBe(true);
    expect(
      sources.has("packages/Common/Server/Utils/AI/Toolbox/LogTools.ts"),
    ).toBe(true);
    expect(sources.has("packages/Common/Server/API/BaseAnalyticsAPI.ts")).toBe(
      true,
    );
  });

  test("the matcher knows an import when it sees one, and nothing else", () => {
    const link: Link = LINKS[4]!;

    expect(
      link.makes(
        'import SecurityAddressVaultLookup from "../AddressVault/SecurityAddressVaultLookup";',
      ),
    ).toBe(true);
    expect(
      link.makes(
        'const lookup = require("Common/Server/Utils/SecurityEvent/AddressVault/SecurityAddressVaultLookup");',
      ),
    ).toBe(true);
    expect(
      link.makes(
        'export { default } from "../AddressVault/SecurityAddressVaultLookup";',
      ),
    ).toBe(true);
    expect(
      link.makes(
        "// See AddressVault/SecurityAddressVaultLookup.ts for how a token is named.",
      ),
    ).toBe(false);
  });

  test.each(
    LINKS.map((link: Link): [string, Link] => {
      return [link.what, link];
    }),
  )("%s: only where it is allowed", (_what: string, link: Link) => {
    const making: Array<string> = [];

    for (const [file, source] of sources.entries()) {
      if (link.makes(source)) {
        making.push(file);
      }
    }

    // Nothing else makes the link, and every allowed file still does.
    expect(making.sort()).toEqual([...link.allowed].sort());
  });
});
