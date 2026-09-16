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

// The engine's sweep lock would otherwise pull the Redis client in.
jest.mock("../../../Server/Infrastructure/Semaphore", () => {
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

import {
  AUTO_IMPORT_SCAN_BUILDER_SELECT,
  AUTO_IMPORT_SCAN_CREDENTIAL_SELECT,
} from "../../../Server/Services/NetworkDeviceAutoImportRuleEngineService";
import NetworkDeviceDiscoveryScan from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
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

const ENGINE_SOURCE: string = fs.readFileSync(
  path.join(
    REPO_ROOT,
    "Common",
    "Server",
    "Services",
    "NetworkDeviceAutoImportRuleEngineService.ts",
  ),
  "utf8",
);

/*
 * The property names an interface in DiscoveredDeviceBuilder.ts declares,
 * INCLUDING the ones it inherits through `extends` from another interface in
 * the same file.
 *
 * Read from source because an interface does not exist at runtime, and the
 * inheritance is followed because that is exactly how the naming choice
 * reaches DiscoveredDeviceScanSource: `useShortDeviceNames` is declared on
 * DiscoveredHostNaming, not on the scan source itself. A parser that read
 * only the scan source's own braces would never see it, and the pin below
 * would pass on a select that forgot it.
 *
 * Comments are stripped first — the interfaces carry long block comments, and
 * a sentence like "ON only when exactly `true`:" must not read as a property.
 */
function extractInterfaceProperties(
  source: string,
  interfaceName: string,
): Array<string> {
  const withoutComments: string = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  const match: RegExpMatchArray | null = withoutComments.match(
    new RegExp(
      `export\\s+interface\\s+${interfaceName}\\b(?:\\s+extends\\s+([\\w\\s,]+?))?\\s*\\{([^}]*)\\}`,
    ),
  );

  if (!match) {
    throw new Error(
      `interface ${interfaceName} not found in DiscoveredDeviceBuilder.ts`,
    );
  }

  const ownProperties: Array<string> = Array.from(
    match[2]!.matchAll(/^\s*(\w+)\??\s*:/gm),
  ).map((propertyMatch: RegExpMatchArray) => {
    return propertyMatch[1]!;
  });

  const inheritedProperties: Array<string> = (match[1] || "")
    .split(",")
    .map((name: string) => {
      return name.trim();
    })
    .filter((name: string) => {
      return Boolean(name);
    })
    .flatMap((parentName: string) => {
      return extractInterfaceProperties(source, parentName);
    });

  return Array.from(new Set([...inheritedProperties, ...ownProperties]));
}

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
        /*
         * The ordered credential list, and the reason the other nine are no
         * longer sufficient on their own. A scan tries several credential
         * sets, the probe stamps each discovered host with the id of the one
         * that answered it, and the builder resolves THAT set out of this
         * column. Selecting the flattened columns but not this one would
         * still produce a device with credentials — the first config's,
         * mirrored — so the drop is invisible: every host imports carrying
         * the wrong community string and polls red forever.
         */
        "snmpConfigs",
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
    /*
     * The newest entry, named explicitly: the two lockstep tests below both
     * compare EXTRACTED names against the engine's keys, so a regex that
     * stopped matching `snmpConfigs: true` would make them agree vacuously
     * instead of failing.
     */
    expect(selected).toContain("snmpConfigs");
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

/*
 * AUTO_IMPORT_SCAN_BUILDER_SELECT is what the engine ACTUALLY reads a scan
 * with: the credentials above plus the scan's naming choice (issue #3678).
 *
 * The naming column is the same silent-drop hazard as a credential. The
 * builder turns short names on only when `useShortDeviceNames === true`, so a
 * scan read without that column arrives with it undefined — "off" — and every
 * host of a scan that asked for "wb-0660-kds01" is auto-imported as
 * "wb-0660-kds01.wbhq.com". No error, no log line, and on the one import path
 * nobody reviews. These pin the select against the builder's own declared
 * input, and pin the engine to reading scans through it.
 */
describe("AUTO_IMPORT_SCAN_BUILDER_SELECT", () => {
  // Guard against the interface parser rotting into a vacuous pass.
  test("the builder's scan source is extractable from its source, inherited naming included", () => {
    const properties: Array<string> = extractInterfaceProperties(
      BUILDER_SOURCE,
      "DiscoveredDeviceScanSource",
    );

    expect(properties).toContain("probeId");
    expect(properties).toContain("snmpConfigs");
    expect(properties).toContain("snmpV3PrivKey");
    /*
     * Declared on DiscoveredHostNaming and inherited, so this is the assertion
     * that proves `extends` is being followed rather than ignored.
     */
    expect(properties).toContain("useShortDeviceNames");
    // Comment prose must never parse as a property.
    expect(properties).not.toContain("ON");
  });

  test("selects the credential columns plus the naming choice, and nothing else", () => {
    expect(Object.keys(AUTO_IMPORT_SCAN_BUILDER_SELECT).sort()).toEqual(
      [
        ...Object.keys(AUTO_IMPORT_SCAN_CREDENTIAL_SELECT),
        "useShortDeviceNames",
      ].sort(),
    );

    for (const key of Object.keys(AUTO_IMPORT_SCAN_BUILDER_SELECT)) {
      expect({
        key: key,
        selected: AUTO_IMPORT_SCAN_BUILDER_SELECT[key],
      }).toEqual({ key: key, selected: true });
    }
  });

  /*
   * The pin proper. Any name listed in this failure is a scan column the
   * builder reads (it is on DiscoveredDeviceScanSource) that the engine does
   * not select — a device built from that scan gets undefined for it.
   */
  test("covers every scan column the device builder reads", () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();

    const scanSourceColumns: Array<string> = extractInterfaceProperties(
      BUILDER_SOURCE,
      "DiscoveredDeviceScanSource",
    ).filter((property: string) => {
      return scan.isTableColumn(property);
    });

    // Not vacuous: the credentials and the naming choice are all real columns.
    expect(scanSourceColumns).toContain("snmpConfigs");
    expect(scanSourceColumns).toContain("useShortDeviceNames");

    const builderColumnsMissingFromEngineSelect: Array<string> =
      scanSourceColumns.filter((column: string) => {
        return !(column in AUTO_IMPORT_SCAN_BUILDER_SELECT);
      });

    expect(builderColumnsMissingFromEngineSelect).toEqual([]);
  });

  /*
   * And the reverse: every key selected is a real column of the scan model.
   * A misspelt key ("useShortDeviceName") would select nothing, and TypeORM
   * would not say so — the select would simply carry a column that does not
   * exist while the real one arrived undefined.
   */
  test("selects only real columns of the scan model", () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();

    const selectKeysThatAreNotScanColumns: Array<string> = Object.keys(
      AUTO_IMPORT_SCAN_BUILDER_SELECT,
    ).filter((key: string) => {
      return !scan.isTableColumn(key);
    });

    expect(selectKeysThatAreNotScanColumns).toEqual([]);
  });

  /*
   * The credential select stays exactly what the probe sweeps with. The
   * naming choice is not a sweep input, so it belongs to the builder select
   * only; leaking it into the credential select would break the claim-endpoint
   * lockstep above and hand the probe a column it has no use for.
   */
  test("leaves the naming choice out of the credential select", () => {
    expect("useShortDeviceNames" in AUTO_IMPORT_SCAN_CREDENTIAL_SELECT).toBe(
      false,
    );
  });

  /*
   * Both engine reads — the automatic path's (processCompletedScan) and Run
   * Now's per-scan re-read (dry run included) — spread the BUILDER select. A
   * read that spread the credential select instead would still compile and
   * still import devices that poll; it would only import them under the wrong
   * name, which is the failure no other test on the credential side can see.
   * The engine suite pins the same thing behaviourally, per path.
   */
  test("the engine reads scans through the builder select on both paths", () => {
    const builderSelectSpreads: number = Array.from(
      ENGINE_SOURCE.matchAll(/\.\.\.AUTO_IMPORT_SCAN_BUILDER_SELECT\b/g),
    ).length;

    const credentialSelectSpreads: number = Array.from(
      ENGINE_SOURCE.matchAll(/\.\.\.AUTO_IMPORT_SCAN_CREDENTIAL_SELECT\b/g),
    ).length;

    expect(builderSelectSpreads).toBe(2);
    // Only inside the builder select's own definition.
    expect(credentialSelectSpreads).toBe(1);
  });
});
