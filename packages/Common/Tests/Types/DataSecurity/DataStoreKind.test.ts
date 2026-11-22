import { describe, expect, test } from "@jest/globals";
import IconProp from "../../../Types/Icon/IconProp";
import {
  DATA_STORE_KINDS,
  DATABASE_ENGINE_STORE_KINDS,
  DECLARED_DATA_STORE_KINDS,
  DataStoreFamily,
  DataStoreKind,
  DataStoreKindInfo,
  DataStoreProvider,
  getDataStoreKindForCloudResourceType,
  getDataStoreKindInfo,
  isDataStoreKind,
  isDeclaredDataStoreKind,
  PROBE_SCANNABLE_DATA_STORE_KINDS,
  TELEMETRY_DATA_STORE_KINDS,
  WORKER_CLAIMED_DATA_STORE_KINDS,
} from "../../../Types/DataSecurity/DataStoreKind";
import { declaredDataStoreKey } from "../../../Types/DataSecurity/DataStoreKey";

/*
 * EVERY KIND OF DATA STORE, AND HOW EACH IS FOUND.
 */

describe("the kinds of data store", () => {
  test("describe every kind once", () => {
    const kinds: Array<DataStoreKind> = DATA_STORE_KINDS.map(
      (info: DataStoreKindInfo) => {
        return info.kind;
      },
    );

    expect(new Set(kinds).size).toBe(kinds.length);
    expect([...kinds].sort()).toEqual([...Object.values(DataStoreKind)].sort());
  });

  test("are found by their value, and nothing else is", () => {
    for (const info of DATA_STORE_KINDS) {
      expect(getDataStoreKindInfo(info.kind)).toBe(info);
      expect(isDataStoreKind(info.kind)).toBe(true);
    }

    expect(getDataStoreKindInfo("Floppy Disk")).toBeUndefined();
    expect(getDataStoreKindInfo(null)).toBeUndefined();
    expect(getDataStoreKindInfo(undefined)).toBeUndefined();
    expect(getDataStoreKindInfo("")).toBeUndefined();
    expect(isDataStoreKind("Floppy Disk")).toBe(false);
    expect(isDataStoreKind(42)).toBe(false);
  });

  test("map each cloud inventory type to one kind of its own provider", () => {
    const types: Array<string> = [];

    for (const info of DATA_STORE_KINDS) {
      if (!info.cloudResourceType) {
        expect([
          info.kind,
          [DataStoreProvider.SelfManaged, DataStoreProvider.OneUptime],
        ]).toEqual([info.kind, expect.arrayContaining([info.provider])]);
        continue;
      }

      types.push(info.cloudResourceType);
      expect(getDataStoreKindForCloudResourceType(info.cloudResourceType)).toBe(
        info.kind,
      );

      if (info.provider === DataStoreProvider.Aws) {
        expect(info.cloudResourceType.startsWith("AWS::")).toBe(true);
      } else if (info.provider === DataStoreProvider.Azure) {
        expect(info.cloudResourceType.startsWith("Microsoft.")).toBe(true);
      } else {
        expect(info.provider).toBe(DataStoreProvider.Gcp);
      }
    }

    expect(new Set(types).size).toBe(types.length);
    expect(getDataStoreKindForCloudResourceType("AWS::S3::Bucket")).toBe(
      DataStoreKind.AwsS3Bucket,
    );
    expect(
      getDataStoreKindForCloudResourceType("AWS::EC2::Instance"),
    ).toBeUndefined();
  });

  test("give object storage a folder, telemetry and OneUptime's security records their own icons and the rest a database", () => {
    for (const info of DATA_STORE_KINDS) {
      if (info.family === DataStoreFamily.ObjectStorage) {
        expect(info.icon).toBe(IconProp.Folder);
      } else if (
        info.family !== DataStoreFamily.Telemetry &&
        info.family !== DataStoreFamily.SecurityRecords
      ) {
        expect(info.icon).toBe(IconProp.Database);
      }
    }

    expect(getDataStoreKindInfo(DataStoreKind.TelemetryTraces)?.icon).toBe(
      IconProp.Waterfall,
    );
    expect(getDataStoreKindInfo(DataStoreKind.SecurityEvents)?.icon).toBe(
      IconProp.ShieldCheck,
    );
    expect(getDataStoreKindInfo(DataStoreKind.NetworkFlows)?.icon).toBe(
      IconProp.Globe,
    );
    expect(getDataStoreKindInfo(DataStoreKind.SecurityAddressVault)?.icon).toBe(
      IconProp.Lock,
    );
  });

  test("can scan the content of buckets, the readers' databases and all telemetry", () => {
    const scannable: Array<DataStoreKind> = DATA_STORE_KINDS.filter(
      (info: DataStoreKindInfo) => {
        return info.contentScannable;
      },
    ).map((info: DataStoreKindInfo) => {
      return info.kind;
    });

    expect(scannable).toEqual(
      expect.arrayContaining([
        DataStoreKind.AwsS3Bucket,
        DataStoreKind.AzureStorageAccount,
        DataStoreKind.GcpStorageBucket,
        DataStoreKind.PostgreSql,
        ...TELEMETRY_DATA_STORE_KINDS,
      ]),
    );
    expect(scannable).not.toContain(DataStoreKind.AwsRdsSnapshot);
  });
});

describe("TELEMETRY_DATA_STORE_KINDS", () => {
  test("are exactly OneUptime's telemetry kinds", () => {
    expect(
      DATA_STORE_KINDS.filter((info: DataStoreKindInfo) => {
        return info.family === DataStoreFamily.Telemetry;
      }).map((info: DataStoreKindInfo) => {
        return info.kind;
      }),
    ).toEqual(TELEMETRY_DATA_STORE_KINDS);

    for (const kind of TELEMETRY_DATA_STORE_KINDS) {
      expect(getDataStoreKindInfo(kind)?.provider).toBe(
        DataStoreProvider.OneUptime,
      );
    }
  });
});

/*
 * The stores OneUptime declares (#10398): what they hold is known by
 * design, so none is ever scanned - not by the workers, not by a probe,
 * not by the telemetry scan - and none is told apart from the others but
 * by its kind.
 */
describe("DECLARED_DATA_STORE_KINDS", () => {
  test("are exactly the kinds marked declared: OneUptime's security records", () => {
    expect(
      DATA_STORE_KINDS.filter((info: DataStoreKindInfo) => {
        return info.isDeclared;
      }).map((info: DataStoreKindInfo) => {
        return info.kind;
      }),
    ).toEqual([...DECLARED_DATA_STORE_KINDS]);
    expect([...DECLARED_DATA_STORE_KINDS]).toEqual([
      DataStoreKind.SecurityEvents,
      DataStoreKind.NetworkFlows,
      DataStoreKind.SecurityAddressVault,
    ]);
    expect(
      DATA_STORE_KINDS.filter((info: DataStoreKindInfo) => {
        return info.family === DataStoreFamily.SecurityRecords;
      }).map((info: DataStoreKindInfo) => {
        return info.kind;
      }),
    ).toEqual([...DECLARED_DATA_STORE_KINDS]);
  });

  test.each([...DECLARED_DATA_STORE_KINDS])(
    "%s is OneUptime's, found in no cloud, and nothing scans its content",
    (kind: DataStoreKind) => {
      const info: DataStoreKindInfo = getDataStoreKindInfo(kind)!;

      expect(info.provider).toBe(DataStoreProvider.OneUptime);
      expect(info.cloudResourceType).toBeUndefined();
      expect(info.contentScannable).toBe(false);
      expect(isDeclaredDataStoreKind(kind)).toBe(true);
      expect(TELEMETRY_DATA_STORE_KINDS).not.toContain(kind);
      expect(WORKER_CLAIMED_DATA_STORE_KINDS).not.toContain(kind);
      expect(PROBE_SCANNABLE_DATA_STORE_KINDS).not.toContain(kind);
      expect(Object.values(DATABASE_ENGINE_STORE_KINDS)).not.toContain(kind);
      expect(declaredDataStoreKey(kind).startsWith("oneuptime:")).toBe(true);
    },
  );

  test("no other kind is declared", () => {
    for (const info of DATA_STORE_KINDS) {
      expect([info.kind, isDeclaredDataStoreKind(info.kind)]).toEqual([
        info.kind,
        DECLARED_DATA_STORE_KINDS.includes(info.kind),
      ]);
    }

    expect(isDeclaredDataStoreKind(undefined)).toBe(false);
    expect(isDeclaredDataStoreKind(null)).toBe(false);
    expect(isDeclaredDataStoreKind("Security events")).toBe(false);
  });

  test("each is keyed by its kind alone, one per project", () => {
    expect(declaredDataStoreKey(DataStoreKind.SecurityEvents)).toBe(
      "oneuptime:security-events",
    );
    expect(declaredDataStoreKey(DataStoreKind.NetworkFlows)).toBe(
      "oneuptime:network-flows",
    );
    expect(declaredDataStoreKey(DataStoreKind.SecurityAddressVault)).toBe(
      "oneuptime:security-address-vault",
    );
  });
});

describe("DATABASE_ENGINE_STORE_KINDS", () => {
  test("map every engine the Database product monitors to a store it runs itself", () => {
    for (const [engine, kind] of Object.entries(DATABASE_ENGINE_STORE_KINDS)) {
      expect(engine).toBe(engine.toLowerCase());
      expect([engine, getDataStoreKindInfo(kind)?.provider]).toEqual([
        engine,
        DataStoreProvider.SelfManaged,
      ]);
    }

    expect(DATABASE_ENGINE_STORE_KINDS["postgres"]).toBe(
      DataStoreKind.PostgreSql,
    );
    expect(DATABASE_ENGINE_STORE_KINDS["mariadb"]).toBe(DataStoreKind.MySql);
  });
});
