import { describe, expect, test } from "@jest/globals";
import {
  DATA_STORE_KINDS,
  DataStoreKind,
  DataStoreKindInfo,
  DataStoreProvider,
} from "../../../Types/DataSecurity/DataStoreKind";
import {
  DATA_STORE_COVERAGE_ITEMS,
  DataStoreCoverageItem,
  DataStoreCoverageKey,
  getDataStoreCoverage,
  takesConnectionString,
} from "../../../Utils/DataSecurity/DataStoreCoverage";

/*
 * WHAT ONEUPTIME CHECKS ON A KIND OF STORE, AND WHAT IT CANNOT (#11140).
 *
 * The form that adds a store, its Settings and its Overview say this from
 * one list, so before anyone sets a store up they know what it will tell
 * them: an Elasticsearch store had a Connection String that did nothing,
 * and an exposure that would never be checked, with nothing saying so.
 * Held here: each kind's lines and what they say is checked, that a line
 * never claims a check that does not run, and which kinds take a
 * connection string at all.
 */

function coverage(
  kind: DataStoreKind,
  data: { isScannedFromProbe?: boolean; isOneUptimeCloud?: boolean } = {},
): Array<DataStoreCoverageItem> {
  return getDataStoreCoverage({
    kind,
    isScannedFromProbe: data.isScannedFromProbe,
    isOneUptimeCloud: data.isOneUptimeCloud ?? false,
  });
}

function shape(items: Array<DataStoreCoverageItem>): Array<string> {
  return items.map((item: DataStoreCoverageItem): string => {
    return `${item.isChecked ? "+" : "-"}${item.key}`;
  });
}

describe("getDataStoreCoverage", () => {
  test.each([
    DataStoreKind.PostgreSql,
    DataStoreKind.MySql,
    DataStoreKind.SqlServer,
  ])(
    "%s: its tables are sampled; who can reach it, and its settings, are not checked",
    (kind: DataStoreKind) => {
      const items: Array<DataStoreCoverageItem> = coverage(kind);

      expect(shape(items)).toEqual(["+content", "-exposure", "-configuration"]);
      expect(items[0]!.label).toBe("Sensitive data in its tables");
      expect(items[1]!.detail).toBe(
        "OneUptime has no way to check this kind of store, so its exposure reads Can't be checked.",
      );
    },
  );

  test.each([DataStoreKind.Elasticsearch, DataStoreKind.OpenSearch])(
    "%s, from inside your network: its indices are sampled and it is asked without credentials; the internet's reach and its settings are not known",
    (kind: DataStoreKind) => {
      for (const where of [
        { isScannedFromProbe: true, isOneUptimeCloud: true },
        { isScannedFromProbe: true, isOneUptimeCloud: false },
        { isScannedFromProbe: false, isOneUptimeCloud: false },
      ]) {
        const items: Array<DataStoreCoverageItem> = coverage(kind, where);

        expect(shape(items)).toEqual([
          "+content",
          "+credentials",
          "-internet",
          "-configuration",
        ]);
        expect(items[0]!.label).toBe("Sensitive data in its indices");
        expect(items[2]!.detail).toBe(
          "Can't be known from inside your network, where the scan runs.",
        );
      }
    },
  );

  test("a search cluster OneUptime Cloud's workers scan is reached over the internet: that is known", () => {
    const items: Array<DataStoreCoverageItem> = coverage(
      DataStoreKind.Elasticsearch,
      { isOneUptimeCloud: true },
    );

    expect(shape(items)).toEqual([
      "+content",
      "+credentials",
      "+internet",
      "-configuration",
    ]);
    expect(items[2]!.detail).toBe(
      "OneUptime's servers reach it over the internet when they scan it.",
    );
  });

  test.each([
    DataStoreKind.MongoDb,
    DataStoreKind.Redis,
    DataStoreKind.Oracle,
    DataStoreKind.Snowflake,
    DataStoreKind.ClickHouse,
    DataStoreKind.Databricks,
    DataStoreKind.Dataverse,
  ])(
    "%s: nothing of it is checked, and it says what adding it still gives",
    (kind: DataStoreKind) => {
      const items: Array<DataStoreCoverageItem> = coverage(kind);

      expect(shape(items)).toEqual([
        "-content",
        "-exposure",
        "-configuration",
        "+tracking",
      ]);
      expect(items[0]!.detail).toBe(
        "OneUptime cannot sample this kind of store's content yet.",
      );
    },
  );

  test("a cloud's bucket: sampled through its connection, read from its cloud's settings", () => {
    expect(shape(coverage(DataStoreKind.AwsS3Bucket))).toEqual([
      "+content",
      "+exposure",
      "+configuration",
    ]);
    expect(coverage(DataStoreKind.GcpBigQueryDataset)[0]!.label).toBe(
      "Sensitive data in its tables",
    );
    expect(coverage(DataStoreKind.AzureStorageAccount)[0]!.label).toBe(
      "Sensitive data in its files",
    );
  });

  test("a cloud's database: read from its cloud's settings, its content not sampled", () => {
    expect(shape(coverage(DataStoreKind.AwsRdsInstance))).toEqual([
      "-content",
      "+exposure",
      "+configuration",
    ]);
  });

  test("a cloud kind no reader reads says so, never that its cloud is read", () => {
    for (const kind of [
      DataStoreKind.AwsAthena,
      DataStoreKind.GcpFirestoreDatabase,
      DataStoreKind.GcpSpannerInstance,
      DataStoreKind.GcpBigtableInstance,
    ]) {
      expect(shape(coverage(kind))).toEqual([
        "-content",
        "-exposure",
        "-configuration",
        "+tracking",
      ]);
    }
  });

  test("a service's telemetry: scanned every hour, held by OneUptime", () => {
    const items: Array<DataStoreCoverageItem> = coverage(
      DataStoreKind.TelemetryLogs,
    );

    expect(shape(items)).toEqual(["+content", "+exposure"]);
    expect(items[1]!.detail).toBe(
      "OneUptime holds it: only your project's members reach it, through OneUptime.",
    );
  });

  test("an unknown kind, or none, has nothing to say", () => {
    expect(
      getDataStoreCoverage({ kind: "Floppy", isOneUptimeCloud: false }),
    ).toEqual([]);
    expect(
      getDataStoreCoverage({ kind: undefined, isOneUptimeCloud: false }),
    ).toEqual([]);
  });

  test("every kind's lines are lines of the catalog, each key once", () => {
    for (const info of DATA_STORE_KINDS) {
      for (const isOneUptimeCloud of [true, false]) {
        const items: Array<DataStoreCoverageItem> = getDataStoreCoverage({
          kind: info.kind,
          isOneUptimeCloud,
        });
        const keys: Array<DataStoreCoverageKey> = items.map(
          (item: DataStoreCoverageItem) => {
            return item.key;
          },
        );

        expect(new Set(keys).size).toBe(keys.length);

        for (const item of items) {
          expect(DATA_STORE_COVERAGE_ITEMS).toContain(item);
        }
      }
    }
  });

  test("no line says content is sampled for a kind nothing samples", () => {
    for (const info of DATA_STORE_KINDS) {
      const content: DataStoreCoverageItem | undefined = getDataStoreCoverage({
        kind: info.kind,
        isOneUptimeCloud: true,
      }).find((item: DataStoreCoverageItem): boolean => {
        return item.key === DataStoreCoverageKey.Content;
      });

      if (content?.isChecked) {
        expect(info.contentScannable).toBe(true);
      }
    }
  });

  test("every line's label and detail are sentences of their own, the detail ending in a full stop", () => {
    for (const item of DATA_STORE_COVERAGE_ITEMS) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.label.endsWith(".")).toBe(false);
      expect(item.detail.endsWith(".")).toBe(true);
      expect(item.detail.length).toBeLessThanOrEqual(150);
    }
  });
});

describe("takesConnectionString", () => {
  test("a store you run that OneUptime's workers sample with one, and no other", () => {
    const taking: Array<DataStoreKind> = DATA_STORE_KINDS.filter(
      (info: DataStoreKindInfo): boolean => {
        return takesConnectionString(info.kind);
      },
    ).map((info: DataStoreKindInfo): DataStoreKind => {
      return info.kind;
    });

    expect(taking).toEqual([
      DataStoreKind.PostgreSql,
      DataStoreKind.MySql,
      DataStoreKind.SqlServer,
      DataStoreKind.Elasticsearch,
      DataStoreKind.OpenSearch,
    ]);

    for (const kind of taking) {
      expect(
        DATA_STORE_KINDS.find((info: DataStoreKindInfo): boolean => {
          return info.kind === kind;
        })?.provider,
      ).toBe(DataStoreProvider.SelfManaged);
    }

    expect(takesConnectionString(undefined)).toBe(false);
    expect(takesConnectionString("Floppy")).toBe(false);
  });
});
