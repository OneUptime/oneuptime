import { afterEach, describe, expect, test } from "@jest/globals";
import {
  SCRAPE_ENDPOINT_LABEL,
  StorageArrayExtractor,
  StorageArrayResourceBufferEntry,
  StorageArraySnapshotBufferEntry,
  emptyStorageArrayResourceEntry,
  getOrCreateStorageArraySnapshot,
  markScrapedEndpoint,
  markStorageArrayKindComplete,
} from "../../../../../Server/Utils/Telemetry/StorageArray/StorageArrayExtractor";
import StorageArrayExtractors from "../../../../../Server/Utils/Telemetry/StorageArray/StorageArrayExtractors";
import FlashArrayExtractor from "../../../../../Server/Utils/Telemetry/StorageArray/PureStorage/FlashArrayExtractor";
import FlashBladeExtractor from "../../../../../Server/Utils/Telemetry/StorageArray/PureStorage/FlashBladeExtractor";
import OntapExtractor from "../../../../../Server/Utils/Telemetry/StorageArray/NetApp/OntapExtractor";
import NetAppOntapPlatform from "../../../../../Types/StorageArray/Platforms/NetApp/ONTAP/OntapPlatform";
import {
  STORAGE_ARRAY_SNAPSHOT_METRIC_NAMES,
  deriveStorageArrayCountsByKind,
  isStorageArraySnapshotMetric,
} from "../../../../../Server/Utils/Telemetry/StorageArraySnapshotScan";
import PureStorageFlashArrayPlatform from "../../../../../Types/StorageArray/Platforms/PureStorage/FlashArray/FlashArrayPlatform";
import PureStorageFlashBladePlatform from "../../../../../Types/StorageArray/Platforms/PureStorage/FlashBlade/FlashBladePlatform";
import { StorageArrayPlatform } from "../../../../../Types/StorageArray/StorageArrayPlatform";
import StorageArrayPlatformRegistry from "../../../../../Types/StorageArray/StorageArrayPlatformRegistry";
import StorageArrayResourceKind from "../../../../../Types/StorageArray/StorageArrayResourceKind";
import StorageSystem from "../../../../../Types/StorageArray/StorageSystem";
import {
  ACME_AGGREGATE_KIND,
  ACME_EXTRACTOR,
  ACME_PLATFORM,
  ACME_STORAGE_SYSTEM,
} from "../../../../Helpers/StorageArray/AcmePlatform";

/*
 * The ingest's per-platform seam (#11000): StorageArrayExtractors picks the
 * extractor that reads a datapoint - by the batch's declared storage.system
 * when that platform reads the metric, else by the metric's prefix - and
 * the helpers every extractor shares mark what a batch is the complete
 * list of. PureStorageIngestGolden pins what the Pure extractors make of
 * real captures; this pins the choosing and the marking.
 */

const FLASHARRAY: string = StorageSystem.PureStorageFlashArray;
const FLASHBLADE: string = StorageSystem.PureStorageFlashBlade;
const ONTAP: string = StorageSystem.NetAppOntap;

afterEach(() => {
  StorageArrayExtractors.unregister(ACME_STORAGE_SYSTEM);
  StorageArrayPlatformRegistry.unregister(ACME_STORAGE_SYSTEM);
});

function resolvedSystem(data: {
  metricName: string;
  declaredStorageSystem?: string | null | undefined;
}): string | null {
  return StorageArrayExtractors.resolve(data)?.platform.storageSystem || null;
}

function emptySnapshot(): StorageArraySnapshotBufferEntry {
  return getOrCreateStorageArraySnapshot(new Map(), "array");
}

function row(
  kind: string,
  externalId: string,
  fromConnectionsOnly?: boolean,
): StorageArrayResourceBufferEntry {
  const entry: StorageArrayResourceBufferEntry = emptyStorageArrayResourceEntry(
    kind,
    externalId,
    new Date(0),
  );
  if (fromConnectionsOnly) {
    entry.fromConnectionsOnly = true;
  }
  return entry;
}

describe("the shipped extractors", () => {
  test("are FlashArray's, FlashBlade's and ONTAP's, one for each shipped platform", () => {
    expect(StorageArrayExtractors.getExtractors()).toEqual([
      FlashArrayExtractor,
      FlashBladeExtractor,
      OntapExtractor,
    ]);
    expect(FlashArrayExtractor.storageSystem).toBe(FLASHARRAY);
    expect(FlashBladeExtractor.storageSystem).toBe(FLASHBLADE);
    expect(OntapExtractor.storageSystem).toBe(ONTAP);
    // Only ONTAP works out what a batch's series say together.
    expect(FlashArrayExtractor.finishBatch).toBeUndefined();
    expect(FlashBladeExtractor.finishBatch).toBeUndefined();
    expect(typeof OntapExtractor.finishBatch).toBe("function");
    for (const platform of StorageArrayPlatformRegistry.getPlatforms()) {
      expect(
        StorageArrayExtractors.getExtractor(platform.storageSystem)
          ?.storageSystem,
      ).toBe(platform.storageSystem);
    }
  });

  test("are found by storage.system only", () => {
    for (const other of [null, undefined, "", "purefa", "hitachi.vsp"]) {
      expect(StorageArrayExtractors.getExtractor(other)).toBeNull();
    }
  });

  test("a second extractor for a platform is refused", () => {
    expect(() => {
      StorageArrayExtractors.register({
        storageSystem: FLASHARRAY,
        extract: (): void => {},
      });
    }).toThrow(
      "A storage array extractor for purestorage.flasharray is already registered",
    );
    expect(StorageArrayExtractors.getExtractors()).toHaveLength(3);
  });
});

describe("the ingest's gate", () => {
  test("takes every series a shipped platform reads, and nothing else", () => {
    const names: Array<string> = [
      ...PureStorageFlashArrayPlatform.snapshotMetricNames,
      ...PureStorageFlashBladePlatform.snapshotMetricNames,
      ...NetAppOntapPlatform.snapshotMetricNames,
    ];
    expect([...STORAGE_ARRAY_SNAPSHOT_METRIC_NAMES].sort()).toEqual(
      [...names].sort(),
    );
    for (const name of names) {
      expect(isStorageArraySnapshotMetric(name)).toBe(true);
    }
    for (const name of [
      // A series a platform charts, but does not read into the inventory.
      "purefa_array_performance_latency_usec",
      "purefa_volume_group_space_bytes",
      "purefa_some_series_purity_adds_later",
      "node_cpu_seconds_total",
      "",
      "acme_volume_used_bytes",
      // Harvest's measurements of itself, and an EMS event (the monitors').
      "netapp_metadata_collector_api_time",
      "netapp_ems_events",
      "netapp_volume_read_latency_histogram",
    ]) {
      expect({ name, read: isStorageArraySnapshotMetric(name) }).toEqual({
        name,
        read: false,
      });
    }
  });

  test("takes a platform's series while it is registered, and lets them pass after", () => {
    StorageArrayPlatformRegistry.register(ACME_PLATFORM);
    expect(isStorageArraySnapshotMetric("acme_volume_used_bytes")).toBe(true);
    // The module-load set is the shipped platforms' alone.
    expect(
      STORAGE_ARRAY_SNAPSHOT_METRIC_NAMES.has("acme_volume_used_bytes"),
    ).toBe(false);
    StorageArrayPlatformRegistry.unregister(ACME_STORAGE_SYSTEM);
    expect(isStorageArraySnapshotMetric("acme_volume_used_bytes")).toBe(false);
  });
});

describe("which extractor reads a datapoint", () => {
  test.each([
    [
      "a FlashArray series an agent declared a FlashArray",
      "purefa_info",
      FLASHARRAY,
      FLASHARRAY,
    ],
    [
      "a FlashBlade series an agent declared a FlashBlade",
      "purefb_info",
      FLASHBLADE,
      FLASHBLADE,
    ],
    // A FlashBlade .env without STORAGE_SYSTEM declares the compose default.
    [
      "a FlashBlade series under the FlashArray default",
      "purefb_info",
      FLASHARRAY,
      FLASHBLADE,
    ],
    [
      "a FlashArray series declared a FlashBlade",
      "purefa_volume_space_bytes",
      FLASHBLADE,
      FLASHARRAY,
    ],
    [
      "a series of an agent that declares nothing",
      "purefa_host_connections_info",
      null,
      FLASHARRAY,
    ],
    [
      "a series declared by an alias",
      "purefb_buckets_space_bytes",
      "Pure-FlashBlade",
      FLASHBLADE,
    ],
    [
      "a series declared a platform OneUptime has no extractor for",
      "purefb_info",
      "hitachi.vsp",
      FLASHBLADE,
    ],
    // Defense in depth: a series no catalog lists still has its platform.
    [
      "a FlashArray series no catalog lists",
      "purefa_some_series_purity_adds_later",
      FLASHARRAY,
      FLASHARRAY,
    ],
    [
      "an ONTAP series an agent declared ONTAP",
      "netapp_volume_size_used",
      ONTAP,
      ONTAP,
    ],
    // An ONTAP .env that lost STORAGE_SYSTEM declares the compose default.
    [
      "an ONTAP series under the FlashArray default",
      "netapp_aggr_space_used",
      FLASHARRAY,
      ONTAP,
    ],
    [
      "an ONTAP series of an agent that declares nothing",
      "netapp_metadata_collector_instances",
      null,
      ONTAP,
    ],
    [
      "a FlashArray series declared ONTAP",
      "purefa_info",
      ONTAP,
      FLASHARRAY,
    ],
  ] as Array<[string, string, string | null, string]>)(
    "%s is the platform's",
    (
      _case: string,
      metricName: string,
      declaredStorageSystem: string | null,
      expected: string,
    ) => {
      expect(resolvedSystem({ metricName, declaredStorageSystem })).toBe(
        expected,
      );
    },
  );

  test("a series no platform's prefix names is read by none", () => {
    for (const metricName of [
      "node_cpu_seconds_total",
      "pure_info",
      "acme_volume_used_bytes",
    ]) {
      for (const declared of [FLASHARRAY, FLASHBLADE, null]) {
        expect(
          StorageArrayExtractors.resolve({
            metricName,
            declaredStorageSystem: declared,
          }),
        ).toBeNull();
      }
    }
  });

  test("a platform without an extractor reads nothing, a declared one included", () => {
    StorageArrayPlatformRegistry.register(ACME_PLATFORM);
    expect(
      resolvedSystem({
        metricName: "acme_volume_used_bytes",
        declaredStorageSystem: ACME_STORAGE_SYSTEM,
      }),
    ).toBeNull();
    expect(resolvedSystem({ metricName: "acme_volume_used_bytes" })).toBeNull();
  });

  test("a registered platform's extractor reads its series, by declaration or prefix", () => {
    StorageArrayPlatformRegistry.register(ACME_PLATFORM);
    StorageArrayExtractors.register(ACME_EXTRACTOR);

    expect(
      StorageArrayExtractors.resolve({
        metricName: "acme_aggregate_used_bytes",
        declaredStorageSystem: "ACME",
      }),
    ).toEqual({ platform: ACME_PLATFORM, extractor: ACME_EXTRACTOR });
    expect(resolvedSystem({ metricName: "acme_info" })).toBe(
      ACME_STORAGE_SYSTEM,
    );
    // Declared Acme, a Pure series is still Pure's.
    expect(
      resolvedSystem({
        metricName: "purefa_info",
        declaredStorageSystem: ACME_STORAGE_SYSTEM,
      }),
    ).toBe(FLASHARRAY);

    StorageArrayExtractors.unregister(ACME_STORAGE_SYSTEM);
    expect(resolvedSystem({ metricName: "acme_info" })).toBeNull();
  });

  test("a declared platform that reads a series of another's prefix reads it", () => {
    // A platform whose agent re-exports one purefa_ series as its own.
    const reader: StorageArrayExtractor = {
      storageSystem: ACME_STORAGE_SYSTEM,
      extract: (): void => {},
    };
    StorageArrayPlatformRegistry.register({
      ...ACME_PLATFORM,
      snapshotMetricNames: [
        ...ACME_PLATFORM.snapshotMetricNames,
        "purefa_info",
      ],
    });
    StorageArrayExtractors.register(reader);

    expect(
      StorageArrayExtractors.resolve({
        metricName: "purefa_info",
        declaredStorageSystem: ACME_STORAGE_SYSTEM,
      })?.extractor,
    ).toBe(reader);
    // Undeclared, the prefix decides.
    expect(resolvedSystem({ metricName: "purefa_info" })).toBe(FLASHARRAY);
  });
});

describe("what a batch is the complete list of (markScrapedEndpoint)", () => {
  function marked(
    endpoint: string | null,
    platform: StorageArrayPlatform,
  ): {
    sawAlerts: boolean;
    completeKinds: Array<string>;
    saw: Array<string>;
  } {
    const snapshot: StorageArraySnapshotBufferEntry = emptySnapshot();
    markScrapedEndpoint(snapshot, endpoint, platform);
    const flags: Record<string, boolean> = {
      sawVolumes: snapshot.sawVolumes,
      sawHosts: snapshot.sawHosts,
      sawPods: snapshot.sawPods,
      sawFileSystems: snapshot.sawFileSystems,
      sawBuckets: snapshot.sawBuckets,
      sawHardware: snapshot.sawHardware,
      sawDrives: snapshot.sawDrives,
      sawControllers: snapshot.sawControllers,
    };
    return {
      sawAlerts: snapshot.sawAlerts,
      completeKinds: Array.from(snapshot.completeKinds).sort(),
      saw: Object.keys(flags)
        .filter((flag: string): boolean => {
          return flags[flag] === true;
        })
        .sort(),
    };
  }

  test.each([
    ["array", { sawAlerts: true, completeKinds: [], saw: [] }],
    [
      "volumes",
      { sawAlerts: false, completeKinds: ["Volume"], saw: ["sawVolumes"] },
    ],
    ["hosts", { sawAlerts: false, completeKinds: ["Host"], saw: ["sawHosts"] }],
    ["pods", { sawAlerts: false, completeKinds: ["Pod"], saw: ["sawPods"] }],
    // Directories have no count of their own, but their list is complete.
    [
      "directories",
      { sawAlerts: false, completeKinds: ["Directory"], saw: [] },
    ],
    [
      "all",
      {
        sawAlerts: true,
        completeKinds: ["Directory", "Host", "Pod", "Volume"],
        saw: ["sawHosts", "sawPods", "sawVolumes"],
      },
    ],
    [
      "metrics",
      {
        sawAlerts: true,
        completeKinds: ["Directory", "Host", "Pod", "Volume"],
        saw: ["sawHosts", "sawPods", "sawVolumes"],
      },
    ],
    // As an operator may have relabelled it.
    [
      " Volumes ",
      { sawAlerts: false, completeKinds: ["Volume"], saw: ["sawVolumes"] },
    ],
    ["filesystems", { sawAlerts: false, completeKinds: [], saw: [] }],
    ["something-else", { sawAlerts: false, completeKinds: [], saw: [] }],
    ["", { sawAlerts: false, completeKinds: [], saw: [] }],
    [null, { sawAlerts: false, completeKinds: [], saw: [] }],
  ] as Array<[string | null, ReturnType<typeof marked>]>)(
    "a FlashArray batch from %p",
    (endpoint: string | null, expected: ReturnType<typeof marked>) => {
      expect(marked(endpoint, PureStorageFlashArrayPlatform)).toEqual(expected);
    },
  );

  test.each([
    ["array", { sawAlerts: true, completeKinds: [], saw: [] }],
    [
      "filesystems",
      {
        sawAlerts: false,
        completeKinds: ["FileSystem"],
        saw: ["sawFileSystems"],
      },
    ],
    [
      "objectstore",
      { sawAlerts: false, completeKinds: ["Bucket"], saw: ["sawBuckets"] },
    ],
    [
      "all",
      {
        sawAlerts: true,
        completeKinds: ["Bucket", "FileSystem"],
        saw: ["sawBuckets", "sawFileSystems"],
      },
    ],
    ["volumes", { sawAlerts: false, completeKinds: [], saw: [] }],
  ] as Array<[string | null, ReturnType<typeof marked>]>)(
    "a FlashBlade batch from %p",
    (endpoint: string | null, expected: ReturnType<typeof marked>) => {
      expect(marked(endpoint, PureStorageFlashBladePlatform)).toEqual(expected);
    },
  );

  test("a platform's own kind is complete with no flag of its own", () => {
    expect(marked("aggregates", ACME_PLATFORM)).toEqual({
      sawAlerts: false,
      completeKinds: [ACME_AGGREGATE_KIND],
      saw: [],
    });
    expect(marked("all", ACME_PLATFORM)).toEqual({
      sawAlerts: true,
      completeKinds: [ACME_AGGREGATE_KIND, StorageArrayResourceKind.Volume],
      saw: ["sawVolumes"],
    });
  });

  test("the endpoint label is scrape_endpoint", () => {
    expect(SCRAPE_ENDPOINT_LABEL).toBe("scrape_endpoint");
  });
});

describe("markStorageArrayKindComplete", () => {
  test.each([
    [StorageArrayResourceKind.Volume, "sawVolumes"],
    [StorageArrayResourceKind.Host, "sawHosts"],
    [StorageArrayResourceKind.Pod, "sawPods"],
    [StorageArrayResourceKind.FileSystem, "sawFileSystems"],
    [StorageArrayResourceKind.Bucket, "sawBuckets"],
    [StorageArrayResourceKind.Hardware, "sawHardware"],
    [StorageArrayResourceKind.Drive, "sawDrives"],
    [StorageArrayResourceKind.Controller, "sawControllers"],
  ] as Array<[string, keyof StorageArraySnapshotBufferEntry]>)(
    "a complete %s list sets %s, as the columns read it",
    (kind: string, flag: keyof StorageArraySnapshotBufferEntry) => {
      const snapshot: StorageArraySnapshotBufferEntry = emptySnapshot();
      markStorageArrayKindComplete(snapshot, kind);
      expect(snapshot[flag]).toBe(true);
      expect(Array.from(snapshot.completeKinds)).toEqual([kind]);
    },
  );

  test("a kind with no column of its own is only complete", () => {
    for (const kind of [
      StorageArrayResourceKind.Directory,
      StorageArrayResourceKind.NetworkInterface,
      ACME_AGGREGATE_KIND,
    ]) {
      const snapshot: StorageArraySnapshotBufferEntry = emptySnapshot();
      markStorageArrayKindComplete(snapshot, kind);
      expect(Array.from(snapshot.completeKinds)).toEqual([kind]);
      expect(snapshot.sawVolumes || snapshot.sawHardware).toBe(false);
    }
  });
});

describe("the counts a batch writes to StorageArray.countsByKind", () => {
  test("nothing, without a batch or a complete list", () => {
    expect(deriveStorageArrayCountsByKind([], undefined)).toBeNull();
    expect(
      deriveStorageArrayCountsByKind(
        [row(StorageArrayResourceKind.Volume, "vol-1")],
        emptySnapshot(),
      ),
    ).toBeNull();
  });

  test("each complete kind's objects, a kind not listed left out", () => {
    const snapshot: StorageArraySnapshotBufferEntry = emptySnapshot();
    markStorageArrayKindComplete(snapshot, StorageArrayResourceKind.Volume);
    markStorageArrayKindComplete(snapshot, ACME_AGGREGATE_KIND);

    expect(
      deriveStorageArrayCountsByKind(
        [
          row(StorageArrayResourceKind.Volume, "vol-1"),
          row(StorageArrayResourceKind.Volume, "vol-2"),
          row(ACME_AGGREGATE_KIND, "aggr-1"),
          // The hosts were not the batch's complete list: no count for them.
          row(StorageArrayResourceKind.Host, "esxi-01"),
        ],
        snapshot,
      ),
    ).toEqual({
      [ACME_AGGREGATE_KIND]: 1,
      [StorageArrayResourceKind.Volume]: 2,
    });
  });

  test("a complete list of none counts 0, so the last object's deletion shows", () => {
    const snapshot: StorageArraySnapshotBufferEntry = emptySnapshot();
    markStorageArrayKindComplete(snapshot, StorageArrayResourceKind.Pod);
    expect(deriveStorageArrayCountsByKind([], snapshot)).toEqual({ Pod: 0 });
  });

  test("a volume known only from a host's connections is no sighting", () => {
    const snapshot: StorageArraySnapshotBufferEntry = emptySnapshot();
    markStorageArrayKindComplete(snapshot, StorageArrayResourceKind.Volume);
    expect(
      deriveStorageArrayCountsByKind(
        [
          row(StorageArrayResourceKind.Volume, "vol-1"),
          row(StorageArrayResourceKind.Volume, "vol-2", true),
        ],
        snapshot,
      ),
    ).toEqual({ Volume: 1 });
  });

  test("the counts are keyed in order, so the same batch writes the same JSON", () => {
    const snapshot: StorageArraySnapshotBufferEntry = emptySnapshot();
    for (const kind of [
      StorageArrayResourceKind.Volume,
      StorageArrayResourceKind.Directory,
      StorageArrayResourceKind.Host,
    ]) {
      markStorageArrayKindComplete(snapshot, kind);
    }
    expect(
      Object.keys(deriveStorageArrayCountsByKind([], snapshot) || {}),
    ).toEqual(["Directory", "Host", "Volume"]);
  });

  test("a kind named like an Object property is counted as data", () => {
    const snapshot: StorageArraySnapshotBufferEntry = emptySnapshot();
    markStorageArrayKindComplete(snapshot, "constructor");
    const counts: Record<string, number> | null =
      deriveStorageArrayCountsByKind([row("constructor", "x")], snapshot);
    expect(Object.prototype.hasOwnProperty.call(counts, "constructor")).toBe(
      true,
    );
    expect(counts?.["constructor"]).toBe(1);
  });
});
