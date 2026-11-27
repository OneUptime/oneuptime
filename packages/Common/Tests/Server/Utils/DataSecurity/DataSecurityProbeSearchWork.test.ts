import { describe, expect, test } from "@jest/globals";
import { DATA_OBSERVABILITY_KINDS } from "../../../../Server/Utils/DataObservability/DataObservabilityEngines";
import {
  buildProbeScanOptions,
  DataSecurityProbeStoreWork,
  getDatabaseEngineOfKind,
  getProbeClaimableKinds,
  getProbeEngineOfKind,
  PROBE_SCANNABLE_KINDS,
  readProbePosture,
  readProbeScanResult,
  readProbeStoreWork,
  SEARCH_PROBE_ENGINE,
} from "../../../../Server/Utils/DataSecurity/DataSecurityProbeScan";
import {
  ContentScanOptions,
  ContentScanResult,
} from "../../../../Server/Utils/DataSecurity/DataSecurityScanTypes";
import {
  DataStoreKind,
  PROBE_SCANNABLE_DATABASE_KINDS,
} from "../../../../Types/DataSecurity/DataStoreKind";
import {
  DataStorePostureFacts,
  DataStorePostureReadFrom,
} from "../../../../Types/DataSecurity/DataStorePosture";
import { JSONObject } from "../../../../Types/JSON";

/*
 * A SEARCH CLUSTER A PROBE SCANS (#11140): THE WORK IT IS HANDED, AND WHAT
 * THE SERVER KEEPS OF ITS ANSWER.
 *
 * A probe from before search clusters refuses work of an engine it does not
 * know and leaves the store claimed, so a search cluster is handed only to a
 * probe that declares it reads one (ProbeCapability.DataSecuritySearchScan),
 * as the "search" engine of its kind. The probe asks the cluster how exposed
 * it is from inside the customer's network, and the server reads that the
 * way it reads every result: without trusting it. A probe never says the
 * internet reaches a cluster, nor that anyone on it reads one.
 */

const READ_AT: Date = new Date("2026-11-27T10:00:00.000Z");

function work(overrides: JSONObject = {}): JSONObject {
  return {
    dataStoreId: "c5a1f9e2-0000-4000-8000-000000000001",
    kind: DataStoreKind.Elasticsearch,
    engine: SEARCH_PROBE_ENGINE,
    probeConnectionVariable: "SEARCH_URL",
    limits: { maxRowsPerTable: 50, maxTables: 20, maxBytesTotal: 1000 },
    exclusions: ["logs-*"],
    customDataTypes: [],
    disabledDataTypeIds: [],
    allowedValues: [],
    fingerprintKey: "key",
    findNamesAndAddresses: false,
    ...overrides,
  };
}

describe("the engine a probe samples a store with", () => {
  test("a database's driver, or a search cluster's HTTP API", () => {
    expect(getProbeEngineOfKind(DataStoreKind.PostgreSql)).toBe("postgresql");
    expect(getProbeEngineOfKind(DataStoreKind.MySql)).toBe("mysql");
    expect(getProbeEngineOfKind(DataStoreKind.SqlServer)).toBe("sqlserver");
    expect(getProbeEngineOfKind(DataStoreKind.Elasticsearch)).toBe("search");
    expect(getProbeEngineOfKind(DataStoreKind.OpenSearch)).toBe("search");
    expect(getProbeEngineOfKind(DataStoreKind.MongoDb)).toBeNull();
    expect(getProbeEngineOfKind(undefined)).toBeNull();
  });

  test("a search cluster is no database to Data Observability", () => {
    expect(getDatabaseEngineOfKind(DataStoreKind.Elasticsearch)).toBeNull();
    expect(getDatabaseEngineOfKind(DataStoreKind.OpenSearch)).toBeNull();
    expect(DATA_OBSERVABILITY_KINDS).not.toContain(DataStoreKind.Elasticsearch);
    expect(DATA_OBSERVABILITY_KINDS).not.toContain(DataStoreKind.OpenSearch);

    for (const kind of PROBE_SCANNABLE_DATABASE_KINDS) {
      expect(DATA_OBSERVABILITY_KINDS).toContain(kind);
    }
  });
});

describe("getProbeClaimableKinds", () => {
  test("a probe that reads search clusters is handed every kind a probe samples", () => {
    expect(getProbeClaimableKinds({ readsSearchClusters: true })).toEqual(
      PROBE_SCANNABLE_KINDS,
    );
    expect(PROBE_SCANNABLE_KINDS).toContain(DataStoreKind.Elasticsearch);
  });

  test("one from before them, only the databases", () => {
    expect(getProbeClaimableKinds({ readsSearchClusters: false })).toEqual(
      PROBE_SCANNABLE_DATABASE_KINDS,
    );
  });
});

describe("readProbeStoreWork", () => {
  test("reads a search cluster's work, and the options it scans with", () => {
    const read: DataSecurityProbeStoreWork | null = readProbeStoreWork(work());

    expect(read?.engine).toBe("search");
    expect(read?.kind).toBe(DataStoreKind.Elasticsearch);

    const options: ContentScanOptions = buildProbeScanOptions(read!, READ_AT);

    expect(options.limits.maxRowsPerTable).toBe(50);
    expect(options.limits.maxTables).toBe(20);
    expect(options.exclusions).toEqual(["logs-*"]);
  });

  test("reads OpenSearch's too", () => {
    expect(
      readProbeStoreWork(work({ kind: DataStoreKind.OpenSearch }))?.engine,
    ).toBe("search");
  });

  test("refuses the search engine for a kind that is no search cluster, and an engine no probe knows", () => {
    expect(
      readProbeStoreWork(work({ kind: DataStoreKind.PostgreSql })),
    ).toBeNull();
    expect(readProbeStoreWork(work({ kind: "" }))).toBeNull();
    expect(readProbeStoreWork(work({ engine: "mongodb" }))).toBeNull();
    expect(readProbeStoreWork(work({ engine: 7 }))).toBeNull();
  });

  test("still reads a database's work as before", () => {
    expect(
      readProbeStoreWork(work({ kind: DataStoreKind.MySql, engine: "mysql" }))
        ?.engine,
    ).toBe("mysql");
  });
});

describe("readProbePosture", () => {
  test("keeps what the probe saw of credentials and TLS, from inside the network, as of when the server heard", () => {
    expect(
      readProbePosture(
        {
          readAt: "2020-01-01T00:00:00.000Z",
          readFrom: "internet",
          anonymousRead: false,
          anonymousWrite: false,
          publicRead: false,
          publicWrite: false,
          encryptionInTransitEnforced: true,
          minimumTlsVersion: null,
          unknowableFacts: [
            "publicNetworkAccess",
            "openToAllAddresses",
            "minimumTlsVersion",
          ],
        },
        READ_AT,
      ),
    ).toEqual({
      posture: {
        readAt: READ_AT.toISOString(),
        readFrom: DataStorePostureReadFrom.Network,
        anonymousRead: false,
        anonymousWrite: false,
        publicRead: false,
        publicWrite: false,
        publicNetworkAccess: null,
        openToAllAddresses: null,
        encryptionInTransitEnforced: true,
        minimumTlsVersion: null,
        unknowableFacts: [
          "publicNetworkAccess",
          "openToAllAddresses",
          "minimumTlsVersion",
        ],
      },
    });
  });

  test("never lets a probe say the internet reaches the cluster, or that anyone on it reads it", () => {
    const posture: DataStorePostureFacts = readProbePosture(
      {
        anonymousRead: true,
        anonymousWrite: true,
        publicRead: true,
        publicWrite: true,
        publicNetworkAccess: true,
        openToAllAddresses: true,
      },
      READ_AT,
    ).posture!;

    expect(posture.publicNetworkAccess).toBeNull();
    expect(posture.openToAllAddresses).toBeNull();
    expect(posture.publicRead).toBeNull();
    expect(posture.publicWrite).toBeNull();
    expect(posture.anonymousRead).toBe(true);
    expect(posture.anonymousWrite).toBe(true);
    expect(posture.readFrom).toBe(DataStorePostureReadFrom.Network);
  });

  test("says unknowable only of a fact it holds as null, and only of the facts a probe may", () => {
    const posture: DataStorePostureFacts = readProbePosture(
      {
        anonymousRead: true,
        anonymousWrite: null,
        unknowableFacts: [
          "anonymousWrite",
          "publicRead",
          "anonymousRead",
          "encryptedAtRest",
          42,
        ],
      },
      READ_AT,
    ).posture!;

    expect(posture.unknowableFacts).toEqual([
      "publicNetworkAccess",
      "openToAllAddresses",
      "anonymousWrite",
      "publicRead",
    ]);
  });

  test("reads only true, false and null; a TLS version never", () => {
    const posture: DataStorePostureFacts = readProbePosture(
      {
        anonymousRead: "yes",
        encryptionInTransitEnforced: 1,
        minimumTlsVersion: "1.0",
      },
      READ_AT,
    ).posture!;

    expect(posture.anonymousRead).toBeUndefined();
    expect(posture.encryptionInTransitEnforced).toBeUndefined();
    expect(posture.minimumTlsVersion).toBeUndefined();
  });

  test("no posture is no posture", () => {
    expect(readProbePosture(undefined, READ_AT)).toEqual({});
    expect(readProbePosture([], READ_AT)).toEqual({});
    expect(readProbePosture("open", READ_AT)).toEqual({});
  });
});

describe("readProbeScanResult and a probe's posture", () => {
  const sent: JSONObject = {
    locations: [],
    readLog: ["customers"],
    objectsRead: 1,
    rowsRead: 3,
    bytesRead: 100,
    warnings: [],
    fingerprints: {},
    plaintextPasswordFields: [],
    isComplete: true,
    posture: { anonymousRead: false, anonymousWrite: false },
  };

  test("is read for a store whose endpoint a scan checks", () => {
    const result: ContentScanResult | null = readProbeScanResult(
      sent,
      (): boolean => {
        return true;
      },
      undefined,
      { readAt: READ_AT },
    );

    expect(result?.posture?.anonymousRead).toBe(false);
    expect(result?.posture?.readAt).toBe(READ_AT.toISOString());
  });

  test("is left out for any other store, whatever the probe sent", () => {
    const result: ContentScanResult | null = readProbeScanResult(
      sent,
      (): boolean => {
        return true;
      },
    );

    expect(result?.posture).toBeUndefined();
    expect(result?.objectsRead).toBe(1);
  });
});
