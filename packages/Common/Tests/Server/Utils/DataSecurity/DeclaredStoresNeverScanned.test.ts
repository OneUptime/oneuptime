import {
  TELEMETRY_SAMPLE_SOURCES,
  TelemetrySampleSource,
  getTelemetrySource,
} from "../../../../Server/Utils/DataSecurity/Telemetry/TelemetryDataScanner";
import {
  DECLARED_DATA_STORE_KINDS,
  DataStoreKind,
  DataStoreProvider,
  isDeclaredDataStoreKind,
} from "../../../../Types/DataSecurity/DataStoreKind";
import {
  DataStoreContentScanStop,
  getDataStoreContentScanStop,
  getDataStoreScanNowRefusalSentence,
} from "../../../../Utils/DataSecurity/DataStoreContentScanSchedule";
import { escapeRegExp } from "../../../../Utils/RegExpEscape";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * NO DATA SECURITY SCAN READS A STORE ONEUPTIME DECLARES (#10398).
 *
 * Security Events, Network Flows and Security Events' address vault hold
 * IP addresses by design, and are declared, not scanned. So:
 *
 *   - the hourly telemetry scan reads none of them: no source of it is of
 *     a declared kind;
 *   - no content scan claims or starts on one: whatever its switches and
 *     whatever probe it is given, something stops it, and Scan Now is
 *     refused, saying why;
 *   - declaring them reads none of what they hold: the declarer asks the
 *     security events and network flows tables only whether a row exists
 *     (existsBy, SELECT 1 ... LIMIT 1), and never reaches the vault, which
 *     only Security Events' scans and ingest's writer may
 *     (SecurityAddressVaultGuard).
 *
 * The last is read from the declarer's source, comments left out.
 */

const DECLARER: string = path.resolve(
  __dirname,
  "../../../../Server/Utils/DataSecurity/DeclaredDataStores.ts",
);

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:])\/\/[^\n]*/g;

function declarerCode(): string {
  return fs
    .readFileSync(DECLARER, "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, "$1");
}

// Every method the declarer calls on a service it names: "existsBy" of "SecurityEventService.existsBy(".
function methodsCalledOn(code: string, service: string): Array<string> {
  const called: Set<string> = new Set();
  const pattern: RegExp = new RegExp(
    `\\b${escapeRegExp(service)}\\s*\\.\\s*(\\w+)`,
    "g",
  );

  for (const match of code.matchAll(pattern)) {
    called.add(match[1]!);
  }

  return [...called].sort();
}

describe("the telemetry scan", () => {
  test.each([...TELEMETRY_SAMPLE_SOURCES])(
    "reads no declared store through its %s source",
    (source: TelemetrySampleSource) => {
      const kind: DataStoreKind = getTelemetrySource(source).kind;

      expect([source, isDeclaredDataStoreKind(kind)]).toEqual([source, false]);
    },
  );
});

describe("a content scan", () => {
  test.each([...DECLARED_DATA_STORE_KINDS])(
    "never runs on %s, whatever its switches or probe say",
    (kind: DataStoreKind) => {
      for (const isContentScanEnabled of [true, false, undefined]) {
        for (const scanProbeId of [undefined, "a-probe"]) {
          const stop: DataStoreContentScanStop | null =
            getDataStoreContentScanStop({
              store: {
                kind,
                provider: DataStoreProvider.OneUptime,
                isContentScanEnabled,
                isArchived: false,
                scanProbeId,
                probeConnectionVariable: scanProbeId ? "DB_URL" : undefined,
              },
              scanProbe: scanProbeId
                ? { projectId: "p", isGlobalProbe: false }
                : undefined,
              projectSetting: {
                isContentScanEnabled: true,
                isTelemetryScanEnabled: true,
              },
            });

          expect([kind, isContentScanEnabled, scanProbeId, stop]).toEqual([
            kind,
            isContentScanEnabled,
            scanProbeId,
            expect.any(String),
          ]);
        }
      }
    },
  );

  test.each([...DECLARED_DATA_STORE_KINDS])(
    "Scan Now on %s is refused, saying why",
    (kind: DataStoreKind) => {
      const refusal: string | null = getDataStoreScanNowRefusalSentence({
        store: {
          kind,
          provider: DataStoreProvider.OneUptime,
          isContentScanEnabled: false,
          isArchived: false,
        },
        scanProbe: undefined,
        projectSetting: null,
      });

      expect(refusal).toEqual(expect.any(String));
      expect((refusal || "").length).toBeGreaterThan(10);
    },
  );
});

describe("declaring them", () => {
  test("asks the security events and network flows tables only whether a row exists", () => {
    const code: string = declarerCode();

    expect(methodsCalledOn(code, "SecurityEventService")).toEqual(["existsBy"]);
    expect(methodsCalledOn(code, "NetworkFlowService")).toEqual(["existsBy"]);
  });

  test("never reaches Security Events' address vault", () => {
    const code: string = declarerCode();

    for (const link of [
      "SecurityAddressVaultService",
      "AddressVault/SecurityAddressVaultLookup",
      "AddressVault/SecurityAddressVaultWriter",
      'Models/AnalyticsModels/SecurityAddressVault"',
      "SecurityAddressVaultV1",
      "AnalyticsTableName",
    ]) {
      expect([link, code.includes(link)]).toEqual([link, false]);
    }

    // How long it keeps addresses is a number of its own file, not the vault's model.
    expect(code).toContain("getFixedDeclaredRetentionInDays");
  });

  test("reads the guard's own list of what may reach the vault", () => {
    // The guard holds every file that may; the declarer is none of them.
    const guard: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../SecurityEvent/AddressVault/SecurityAddressVaultGuard.test.ts",
      ),
      "utf8",
    );

    expect(guard).toContain("SecurityAddressVaultLookup.ts");
    expect(guard).not.toContain("DeclaredDataStores");
  });
});
