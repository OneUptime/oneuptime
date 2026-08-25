/*
 * The auto-import rule engine reads a completed scan's SNMP credentials
 * through AUTO_IMPORT_SCAN_CREDENTIAL_SELECT and copies them onto every
 * device it creates via DiscoveredDeviceBuilder. The probe claim endpoint
 * (App/FeatureSet/Telemetry/API/ProbeIngest/DiscoveryScan.ts) selects the
 * same credential columns for the same reason: an unselected column arrives
 * undefined and is silently NOT copied/used — no error anywhere, just a
 * device (or a sweep) that can never authenticate.
 *
 * That failure mode is exactly the kind that drifts in: someone adds a
 * credential column to the scan model, wires it into ONE of the three
 * consumers, and the other two quietly drop it. So this suite pins the list
 * in BOTH directions against the claim endpoint's select and against the
 * builder — read from source with fs, the
 * DiscoveryScanClaimHookFreeSafety.test.ts technique, because the select
 * literal in a route handler is not importable. If an assertion here fails,
 * its variable name says which side is missing which key; add the key to
 * that side rather than relaxing the pin.
 */

/*
 * The engine's import closure reaches DatabaseService (and through it
 * PasswordHash) via the three collaborating services. None of them is called
 * here — this suite only wants the exported select constant — so the service
 * MODULES are stubbed out before the engine is imported, keeping the suite
 * Postgres-free and immune to the local-only PasswordHash ts-jest compile
 * failure.
 */
jest.mock("../../../Server/Services/NetworkDeviceService", () => {
  return {
    __esModule: true,
    default: {},
  };
});

jest.mock("../../../Server/Services/NetworkDeviceDiscoveryScanService", () => {
  return {
    __esModule: true,
    default: {},
  };
});

jest.mock("../../../Server/Services/NetworkDeviceAutoImportRuleService", () => {
  return {
    __esModule: true,
    default: {},
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    },
  };
});

import { AUTO_IMPORT_SCAN_CREDENTIAL_SELECT } from "../../../Server/Services/NetworkDeviceAutoImportRuleEngineService";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

const REPO_ROOT: string = path.join(__dirname, "..", "..", "..", "..");

const CLAIM_ENDPOINT_SOURCE: string = fs.readFileSync(
  path.join(
    REPO_ROOT,
    "App",
    "FeatureSet",
    "Telemetry",
    "API",
    "ProbeIngest",
    "DiscoveryScan.ts",
  ),
  "utf8",
);

const BUILDER_SOURCE: string = fs.readFileSync(
  path.join(
    REPO_ROOT,
    "Common",
    "Utils",
    "NetworkDiscovery",
    "DiscoveredDeviceBuilder.ts",
  ),
  "utf8",
);

/*
 * Every `snmp*: true` in the claim endpoint is a select entry — the file's
 * only other snmp mention is the `snmpReachable !== false` responder count,
 * which this shape can never match.
 */
function extractSelectedSnmpColumns(source: string): Array<string> {
  return Array.from(source.matchAll(/\b(snmp\w+)\s*:\s*true\b/g)).map(
    (match: RegExpMatchArray) => {
      return match[1]!;
    },
  );
}

describe("AUTO_IMPORT_SCAN_CREDENTIAL_SELECT", () => {
  test("carries exactly the credential columns an import copies", () => {
    expect(Object.keys(AUTO_IMPORT_SCAN_CREDENTIAL_SELECT).sort()).toEqual(
      [
        "probeId",
        "snmpVersion",
        "snmpCommunityString",
        "snmpPort",
        "snmpV3SecurityLevel",
        "snmpV3Username",
        "snmpV3AuthProtocol",
        "snmpV3AuthKey",
        "snmpV3PrivProtocol",
        "snmpV3PrivKey",
      ].sort(),
    );
  });

  // Guard against the extraction regex rotting into a vacuous pass.
  test("the claim endpoint's select is extractable from its source", () => {
    const selected: Array<string> = extractSelectedSnmpColumns(
      CLAIM_ENDPOINT_SOURCE,
    );

    expect(selected).toContain("snmpVersion");
    expect(selected).toContain("snmpV3PrivKey");
    // The responder-count read is not a select entry and must not match.
    expect(selected).not.toContain("snmpReachable");
  });

  /*
   * Direction one: a credential column the probe sweeps WITH but the engine
   * does not select would import devices that poll with less than the scan
   * used — a v3 scan importing v2c-shaped devices, say. Any name listed in
   * this failure is selected by the claim endpoint and missing from
   * AUTO_IMPORT_SCAN_CREDENTIAL_SELECT.
   */
  test("every snmp column the probe claim endpoint selects is in the engine's select", () => {
    const snmpColumnsSelectedByClaimEndpointButMissingFromEngineSelect: Array<string> =
      extractSelectedSnmpColumns(CLAIM_ENDPOINT_SOURCE).filter(
        (column: string) => {
          return !(column in AUTO_IMPORT_SCAN_CREDENTIAL_SELECT);
        },
      );

    expect(
      snmpColumnsSelectedByClaimEndpointButMissingFromEngineSelect,
    ).toEqual([]);
  });

  /*
   * Direction two: a credential column the engine copies onto devices but
   * the probe never receives would mean sweeps and imports disagree about
   * what the credentials ARE. Any name listed in this failure is a key of
   * AUTO_IMPORT_SCAN_CREDENTIAL_SELECT missing from the claim endpoint's
   * select.
   */
  test("every snmp key of the engine's select is selected by the probe claim endpoint", () => {
    const claimSelectedColumns: Array<string> = extractSelectedSnmpColumns(
      CLAIM_ENDPOINT_SOURCE,
    );

    const engineSnmpKeysMissingFromClaimEndpointSelect: Array<string> =
      Object.keys(AUTO_IMPORT_SCAN_CREDENTIAL_SELECT)
        .filter((key: string) => {
          return key.startsWith("snmp");
        })
        .filter((key: string) => {
          return !claimSelectedColumns.includes(key);
        });

    expect(engineSnmpKeysMissingFromClaimEndpointSelect).toEqual([]);
  });

  /*
   * And the last hop: selecting a credential the builder never copies is the
   * same silent drop one module later. Every key of the select must appear
   * in DiscoveredDeviceBuilder.ts — the copy is a same-named field access,
   * so a plain occurrence check is a faithful pin. Any name listed in this
   * failure is selected by the engine and never mentioned by the builder.
   */
  test("every key of the engine's select is copied by the device builder", () => {
    const engineSelectKeysNeverMentionedByBuilder: Array<string> = Object.keys(
      AUTO_IMPORT_SCAN_CREDENTIAL_SELECT,
    ).filter((key: string) => {
      return !BUILDER_SOURCE.includes(key);
    });

    expect(engineSelectKeysNeverMentionedByBuilder).toEqual([]);
  });
});
