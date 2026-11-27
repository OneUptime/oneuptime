import { afterEach, describe, expect, test } from "@jest/globals";
import IconProp from "../../../Types/Icon/IconProp";
import { StorageArrayResourceScope } from "../../../Types/Monitor/MonitorStepStorageArrayMonitor";
import { BUILT_IN_STORAGE_ARRAY_PLATFORMS } from "../../../Types/StorageArray/Platforms/StorageArrayPlatforms";
import PureStorageFlashArrayPlatform from "../../../Types/StorageArray/Platforms/PureStorage/FlashArray/FlashArrayPlatform";
import PureStorageFlashBladePlatform from "../../../Types/StorageArray/Platforms/PureStorage/FlashBlade/FlashBladePlatform";
import DellPowerStorePlatform from "../../../Types/StorageArray/Platforms/Dell/PowerStore/PowerStorePlatform";
import NetAppOntapPlatform from "../../../Types/StorageArray/Platforms/NetApp/ONTAP/OntapPlatform";
import { OntapKind } from "../../../Types/StorageArray/Platforms/NetApp/NetApp";
import DellPowerMaxPlatform from "../../../Types/StorageArray/Platforms/Dell/PowerMax/PowerMaxPlatform";
import StorageArrayProbeCollectors from "../../../Types/StorageArray/Collection/StorageArrayProbeCollectors";
import {
  STORAGE_ARRAY_HARDWARE_KINDS,
  StorageArrayLogAlertTemplateSpec,
  StorageArrayPlatform,
} from "../../../Types/StorageArray/StorageArrayPlatform";
import StorageArrayPlatformRegistry from "../../../Types/StorageArray/StorageArrayPlatformRegistry";
import StorageArrayResourceKind from "../../../Types/StorageArray/StorageArrayResourceKind";
import StorageSystem from "../../../Types/StorageArray/StorageSystem";
import StorageSystemUtil from "../../../Types/StorageArray/StorageSystemUtil";
import { withMeaningKeyAsItsWord } from "../../../Types/MeaningKeys";
import {
  ACME_AGGREGATE_KIND,
  ACME_PLATFORM,
  ACME_STORAGE_SYSTEM,
  acmePlatformWith,
} from "../../Helpers/StorageArray/AcmePlatform";

/*
 * StorageArrayPlatformRegistry is where every reader of a storage platform
 * looks it up (#11000): the shipped platforms in their order, lookups by
 * storage.system and by metric, the words of a platform's own kinds, and
 * what registration refuses. "Every registered platform is well formed"
 * holds each platform, the ones shipped and any added later, to the same
 * rules, so a new platform is checked here without a test of its own.
 */

import DellPowerScalePlatform from "../../../Types/StorageArray/Platforms/Dell/PowerScale/PowerScalePlatform";

const FLASHARRAY: string = StorageSystem.PureStorageFlashArray;
const FLASHBLADE: string = StorageSystem.PureStorageFlashBlade;
const POWERSTORE: string = StorageSystem.DellPowerStore;
const ONTAP: string = StorageSystem.NetAppOntap;
const POWERSCALE: string = StorageSystem.DellPowerScale;

afterEach(() => {
  // Each test that registers a platform leaves the registry as shipped.
  for (const platform of StorageArrayPlatformRegistry.getPlatforms()) {
    if (!BUILT_IN_STORAGE_ARRAY_PLATFORMS.includes(platform)) {
      StorageArrayPlatformRegistry.unregister(platform.storageSystem);
    }
  }
});

function systemsOf(
  platforms: ReadonlyArray<StorageArrayPlatform>,
): Array<string> {
  return platforms.map((platform: StorageArrayPlatform): string => {
    return platform.storageSystem;
  });
}

describe("the shipped platforms", () => {
  test("are Pure Storage's FlashArray and FlashBlade, then Dell's PowerStore, NetApp ONTAP and Dell PowerMax, then Dell's PowerScale, in that order", () => {
    expect(systemsOf(StorageArrayPlatformRegistry.getPlatforms())).toEqual([
      FLASHARRAY,
      FLASHBLADE,
      POWERSTORE,
      ONTAP,
      StorageSystem.DellPowerMax,
      POWERSCALE,
    ]);
    expect(BUILT_IN_STORAGE_ARRAY_PLATFORMS).toEqual([
      PureStorageFlashArrayPlatform,
      PureStorageFlashBladePlatform,
      DellPowerStorePlatform,
      NetAppOntapPlatform,
      DellPowerMaxPlatform,
      DellPowerScalePlatform,
    ]);
  });

  test("the first is the default: what a page reads an array of no known platform as", () => {
    expect(StorageArrayPlatformRegistry.getDefaultPlatform()).toBe(
      PureStorageFlashArrayPlatform,
    );
    for (const unknown of [null, undefined, "", "hitachi.vsp", "Flasharray"]) {
      expect(StorageArrayPlatformRegistry.getPlatformOrDefault(unknown)).toBe(
        PureStorageFlashArrayPlatform,
      );
    }
    expect(StorageArrayPlatformRegistry.getPlatformOrDefault(FLASHBLADE)).toBe(
      PureStorageFlashBladePlatform,
    );
    expect(StorageArrayPlatformRegistry.getPlatformOrDefault(ONTAP)).toBe(
      NetAppOntapPlatform,
    );
  });

  test("each is found by its storage.system exactly, and only by it", () => {
    expect(StorageArrayPlatformRegistry.getPlatform(FLASHARRAY)).toBe(
      PureStorageFlashArrayPlatform,
    );
    expect(StorageArrayPlatformRegistry.getPlatform(FLASHBLADE)).toBe(
      PureStorageFlashBladePlatform,
    );
    expect(StorageArrayPlatformRegistry.getPlatform(POWERSTORE)).toBe(
      DellPowerStorePlatform,
    );
    expect(StorageArrayPlatformRegistry.getPlatform(ONTAP)).toBe(
      NetAppOntapPlatform,
    );
    // An alias is StorageSystemUtil.normalize's to resolve, not a lookup.
    for (const other of [
      null,
      undefined,
      "",
      "purefa",
      "PURESTORAGE.FLASHARRAY",
      " purestorage.flasharray",
      "powerstore",
      "hitachi.vsp",
    ]) {
      expect(StorageArrayPlatformRegistry.getPlatform(other)).toBeNull();
    }
  });

  test("a metric belongs to the platform whose prefix it carries", () => {
    expect(
      StorageArrayPlatformRegistry.getPlatformByMetricName(
        "purefa_volume_space_bytes",
      ),
    ).toBe(PureStorageFlashArrayPlatform);
    expect(
      StorageArrayPlatformRegistry.getPlatformByMetricName(
        "purefb_file_systems_space_bytes",
      ),
    ).toBe(PureStorageFlashBladePlatform);
    expect(
      StorageArrayPlatformRegistry.getPlatformByMetricName(
        "powerstore_volume_logical_used",
      ),
    ).toBe(DellPowerStorePlatform);
    expect(
      StorageArrayPlatformRegistry.getPlatformByMetricName(
        "netapp_volume_size_used",
      ),
    ).toBe(NetAppOntapPlatform);
    // A name no catalog lists still has its platform.
    expect(
      StorageArrayPlatformRegistry.getPlatformByMetricName(
        "purefa_some_series_purity_adds_later",
      ),
    ).toBe(PureStorageFlashArrayPlatform);
    expect(
      StorageArrayPlatformRegistry.getPlatformByMetricName(
        "powerstore_metricReplication_avg_rpo",
      ),
    ).toBe(DellPowerStorePlatform);
    expect(
      StorageArrayPlatformRegistry.getPlatformByMetricName(
        "netapp_some_counter_harvest_adds_later",
      ),
    ).toBe(NetAppOntapPlatform);
    for (const other of [
      null,
      undefined,
      "",
      "pure_volume_space_bytes",
      "node_cpu_seconds_total",
      "PUREFA_INFO",
    ]) {
      expect(
        StorageArrayPlatformRegistry.getPlatformByMetricName(other),
      ).toBeNull();
    }
  });

  test.each([
    ["purefa_volume_space_bytes", StorageArrayResourceKind.Volume],
    // Volume groups are not volumes: their family comes first and has no kind.
    ["purefa_volume_group_space_bytes", null],
    ["purefa_host_performance_latency_usec", StorageArrayResourceKind.Host],
    ["purefa_pod_replica_links_lag_max_msec", StorageArrayResourceKind.Pod],
    // A controller series is a controller, not a hardware component.
    ["purefa_hw_controller_info", StorageArrayResourceKind.Controller],
    ["purefa_hw_component_status", StorageArrayResourceKind.Hardware],
    ["purefa_drive_capacity_bytes", StorageArrayResourceKind.Drive],
    [
      "purefa_network_interface_performance_errors",
      StorageArrayResourceKind.NetworkInterface,
    ],
    ["purefa_directory_space_bytes", StorageArrayResourceKind.Directory],
    ["purefa_array_space_bytes", null],
    ["purefa_info", null],
    ["purefb_file_systems_space_bytes", StorageArrayResourceKind.FileSystem],
    ["purefb_buckets_space_bytes", StorageArrayResourceKind.Bucket],
    ["purefb_hardware_health", StorageArrayResourceKind.Hardware],
    ["purefb_array_space_bytes", null],
    ["node_cpu_seconds_total", null],
    // ONTAP's: its kinds, a node a controller, a disk a drive, a shelf part hardware.
    ["netapp_volume_size_used", StorageArrayResourceKind.Volume],
    ["netapp_aggr_space_used", OntapKind.Aggregate],
    ["netapp_svm_new_status", OntapKind.Svm],
    ["netapp_lun_size", OntapKind.Lun],
    ["netapp_snapmirror_lag_time", OntapKind.SnapMirror],
    ["netapp_node_new_status", StorageArrayResourceKind.Controller],
    ["netapp_disk_new_status", StorageArrayResourceKind.Drive],
    ["netapp_shelf_psu_status", StorageArrayResourceKind.Hardware],
    ["netapp_net_port_status", StorageArrayResourceKind.NetworkInterface],
    ["netapp_cluster_new_status", null],
  ] as Array<[string, string | null]>)(
    "%s is about a %s",
    (metricName: string, kind: string | null) => {
      expect(
        StorageArrayPlatformRegistry.getObjectKindForMetricName(metricName),
      ).toBe(kind);
      // The array's own platform first changes nothing for a Pure series.
      for (const system of [FLASHARRAY, FLASHBLADE, "hitachi.vsp", null]) {
        expect(
          StorageArrayPlatformRegistry.getObjectKindForMetricName(
            metricName,
            system,
          ),
        ).toBe(kind);
      }
    },
  );

  test("only ONTAP has kinds of its own, worded by its definitions", () => {
    for (const kind of [
      ...Object.values(StorageArrayResourceKind),
      "",
      null,
      undefined,
      "constructor",
    ]) {
      expect(StorageArrayPlatformRegistry.getKindDefinition(kind)).toBeNull();
    }
    for (const kind of Object.values(OntapKind)) {
      const definition: ReturnType<
        typeof StorageArrayPlatformRegistry.getKindDefinition
      > = StorageArrayPlatformRegistry.getKindDefinition(kind, ONTAP);
      expect(definition?.kind).toBe(kind);
      expect(NetAppOntapPlatform.kindDefinitions).toContain(definition);
      // Asked without a platform, the only one that has it answers.
      expect(StorageArrayPlatformRegistry.getKindDefinition(kind)).toBe(
        definition,
      );
    }
    // A key of its own, which English reads as Aggregates (MeaningKeys).
    expect(
      StorageArrayPlatformRegistry.getKindDefinition(OntapKind.Aggregate)
        ?.pluralLabel,
    ).toBe("Aggregates (disk aggregates)");
    expect(
      withMeaningKeyAsItsWord(
        StorageArrayPlatformRegistry.getKindDefinition(OntapKind.Aggregate)!
          .pluralLabel,
      ),
    ).toBe("Aggregates");
    expect(
      StorageArrayPlatformRegistry.getKindDefinition(OntapKind.Svm)
        ?.singularLabel,
    ).toBe("SVM");
  });
});

/*
 * What every platform owes the readers that build from it, checked for each
 * one the registry holds - the shipped ones, and any registered later.
 */
describe.each(
  StorageArrayPlatformRegistry.getPlatforms().map(
    (platform: StorageArrayPlatform): [string, StorageArrayPlatform] => {
      return [platform.storageSystem, platform];
    },
  ),
)("%s is well formed", (_system: string, platform: StorageArrayPlatform) => {
  const others: Array<StorageArrayPlatform> =
    StorageArrayPlatformRegistry.getPlatforms().filter(
      (other: StorageArrayPlatform): boolean => {
        return other !== platform;
      },
    );

  test("it could be registered beside the others", () => {
    expect(
      StorageArrayPlatformRegistry.getRegistrationProblem(platform, others),
    ).toBeNull();
  });

  test("it is known by its value and every alias", () => {
    expect(StorageSystemUtil.isKnownSystem(platform.storageSystem)).toBe(true);
    for (const alias of platform.aliases) {
      expect({ alias, system: StorageSystemUtil.normalize(alias) }).toEqual({
        alias,
        system: platform.storageSystem,
      });
      expect(StorageSystemUtil.normalize(alias.toUpperCase())).toBe(
        platform.storageSystem,
      );
    }
    expect(platform.displayName).not.toBe("");
    expect(platform.shortName).not.toBe("");
    expect(platform.vendorName).not.toBe("");
  });

  test("its series carry its prefix, and its metrics are its own", () => {
    const prefix: string = platform.metricPrefix || "";
    for (const name of [
      ...platform.snapshotMetricNames,
      platform.heartbeat.metricName,
      ...platform.metrics.map(
        (metric: StorageArrayPlatform["metrics"][number]): string => {
          return metric.metricName;
        },
      ),
      ...platform.metricFamilies.map(
        (family: StorageArrayPlatform["metricFamilies"][number]): string => {
          return family.prefix;
        },
      ),
    ]) {
      expect({ name, carriesPrefix: name.startsWith(prefix) }).toEqual({
        name,
        carriesPrefix: true,
      });
    }
    for (const metric of platform.metrics) {
      expect(metric.storageSystems).toContain(platform.storageSystem);
      expect(metric.friendlyName).not.toBe("");
      expect(metric.description).not.toBe("");
    }
    expect(new Set(platform.snapshotMetricNames).size).toBe(
      platform.snapshotMetricNames.length,
    );
  });

  test("its heartbeat is a series its agent always sends, and its own template", () => {
    expect(platform.snapshotMetricNames).toContain(
      platform.heartbeat.metricName,
    );
    expect(
      platform.alertTemplates.map(
        (template: StorageArrayPlatform["alertTemplates"][number]): string => {
          return template.id;
        },
      ),
    ).not.toContain(platform.heartbeat.templateId);
  });

  test("each alert template watches a series of its catalog", () => {
    const catalogued: Set<string> = new Set(
      platform.metrics.map(
        (metric: StorageArrayPlatform["metrics"][number]): string => {
          return metric.metricName;
        },
      ),
    );
    for (const template of platform.alertTemplates) {
      expect({
        template: template.id,
        catalogued: catalogued.has(template.metricName),
      }).toEqual({ template: template.id, catalogued: true });
    }
  });

  test("each endpoint it marks complete lists kinds it has, and every kind it counts is listed by one", () => {
    const listed: Set<string> = new Set([
      ...Object.values(platform.scrapeEndpoints).flat(),
      // Or by its exporter's own word (NetApp Harvest's metadata).
      ...(platform.exporterCompletedKinds || []),
    ]);
    for (const kind of listed) {
      expect(platform.kinds).toContain(kind);
    }
    // A count the overview or the list shows is one some endpoint completes.
    for (const kind of [
      ...platform.overview.countChips.map((chip: { kind: string }): string => {
        return chip.kind;
      }),
      ...platform.overview.listCounts,
    ]) {
      expect({ kind, listed: listed.has(kind) }).toEqual({
        kind,
        listed: true,
      });
    }
  });

  test("its hardware tables are of kinds it has, each with a table id of its own", () => {
    const tableIds: Array<string> = platform.hardwareTables.map(
      (table: StorageArrayPlatform["hardwareTables"][number]): string => {
        return table.tableId;
      },
    );
    expect(new Set(tableIds).size).toBe(tableIds.length);
    for (const table of platform.hardwareTables) {
      expect(platform.kinds).toContain(table.kind);
      expect(table.description).not.toBe("");
      expect(table.noItemsMessage).not.toBe("");
    }
    /*
     * A platform's hardware may be a kind of its own (a PowerMax's
     * directors, a PowerScale's nodes): the inventory summary and the
     * snapshot read every platform's hardwareKinds
     * (StorageArrayResourceService.getHardwareKinds).
     */
    if (platform.hardwareKinds) {
      for (const kind of platform.hardwareKinds) {
        expect(platform.kinds).toContain(kind);
      }
    } else {
      for (const kind of STORAGE_ARRAY_HARDWARE_KINDS) {
        expect(
          Object.values(StorageArrayResourceKind) as Array<string>,
        ).toContain(kind);
      }
    }
  });

  test("its part statuses are lowercase words, each in one list", () => {
    const { critical, warning } = platform.componentStatuses;
    for (const status of [...critical, ...warning]) {
      expect(status).toBe(status.trim().toLowerCase());
    }
    for (const status of critical) {
      expect(warning).not.toContain(status);
    }
  });

  test("it names each object by a label, and offers each filter once", () => {
    for (const label of Object.values(platform.objectLabels)) {
      expect(label).toMatch(/^[a-z_][a-z0-9_]*$/);
    }
    const keys: Array<string> = platform.resourceFilters.map(
      (filter: StorageArrayPlatform["resourceFilters"][number]): string => {
        return filter.key;
      },
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("its agent reads it through configs of its own, each with its exporter's profile, or a probe reads its management server", () => {
    /*
     * A platform a probe collects from its management server (a PowerMax,
     * through Unisphere) has no agent config; every other one has at least
     * one.
     */
    expect(platform.agentConfigs.length > 0).toBe(
      !StorageArrayProbeCollectors.isProbeCollected(platform.storageSystem),
    );
    for (const config of platform.agentConfigs) {
      expect(config.collectorConfigFile).toMatch(
        /^otel-collector-config[a-z0-9.-]*\.yaml$/,
      );
      expect(config.endpointVariable).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(config.tokenVariable).toMatch(/^[A-Z][A-Z0-9_]*$/);
      // An exporter sidecar runs under a profile; the native endpoint none.
      expect(config.composeProfile === "").toBe(
        config.exporterService === null,
      );
    }
  });
});

describe("registering a platform at runtime", () => {
  test("adds it after the shipped ones, finds it everywhere, and unregistering takes it away", () => {
    const before: number = StorageArrayPlatformRegistry.getVersion();

    StorageArrayPlatformRegistry.register(ACME_PLATFORM);

    expect(systemsOf(StorageArrayPlatformRegistry.getPlatforms())).toEqual([
      FLASHARRAY,
      FLASHBLADE,
      POWERSTORE,
      ONTAP,
      StorageSystem.DellPowerMax,
      POWERSCALE,
      ACME_STORAGE_SYSTEM,
    ]);
    expect(StorageArrayPlatformRegistry.getVersion()).toBe(before + 1);
    expect(StorageArrayPlatformRegistry.getPlatform(ACME_STORAGE_SYSTEM)).toBe(
      ACME_PLATFORM,
    );
    // The default stays the first shipped platform.
    expect(StorageArrayPlatformRegistry.getDefaultPlatform()).toBe(
      PureStorageFlashArrayPlatform,
    );
    expect(
      StorageArrayPlatformRegistry.getPlatformByMetricName(
        "acme_volume_used_bytes",
      ),
    ).toBe(ACME_PLATFORM);
    expect(StorageSystemUtil.normalize("ACME")).toBe(ACME_STORAGE_SYSTEM);
    expect(StorageSystemUtil.isKnownSystem(ACME_STORAGE_SYSTEM)).toBe(true);
    // Acme's Aggregate is Acme's on an Acme array; ONTAP has one too.
    expect(
      StorageArrayPlatformRegistry.getKindDefinition(
        ACME_AGGREGATE_KIND,
        ACME_STORAGE_SYSTEM,
      ),
    ).toBe(ACME_PLATFORM.kindDefinitions![0]);
    expect(
      StorageArrayPlatformRegistry.getKindDefinition(
        ACME_AGGREGATE_KIND,
        ONTAP,
      ),
    ).not.toBe(ACME_PLATFORM.kindDefinitions![0]);
    expect(
      StorageArrayPlatformRegistry.getObjectKindForMetricName(
        "acme_aggregate_used_bytes",
      ),
    ).toBe(ACME_AGGREGATE_KIND);

    StorageArrayPlatformRegistry.unregister(ACME_STORAGE_SYSTEM);

    expect(systemsOf(StorageArrayPlatformRegistry.getPlatforms())).toEqual([
      FLASHARRAY,
      FLASHBLADE,
      POWERSTORE,
      ONTAP,
      StorageSystem.DellPowerMax,
      POWERSCALE,
    ]);
    expect(StorageArrayPlatformRegistry.getVersion()).toBe(before + 2);
    expect(
      StorageArrayPlatformRegistry.getPlatform(ACME_STORAGE_SYSTEM),
    ).toBeNull();
    expect(StorageSystemUtil.isKnownSystem(ACME_STORAGE_SYSTEM)).toBe(false);
    expect(
      StorageArrayPlatformRegistry.getKindDefinition(
        ACME_AGGREGATE_KIND,
        ACME_STORAGE_SYSTEM,
      ),
    ).not.toBe(ACME_PLATFORM.kindDefinitions![0]);
  });

  test("unregistering a platform it does not hold changes nothing", () => {
    const before: number = StorageArrayPlatformRegistry.getVersion();
    StorageArrayPlatformRegistry.unregister("hitachi.vsp");
    expect(StorageArrayPlatformRegistry.getVersion()).toBe(before);
    expect(StorageArrayPlatformRegistry.getPlatforms()).toEqual(
      BUILT_IN_STORAGE_ARRAY_PLATFORMS,
    );
  });

  test("a series family of the array's own platform wins over an earlier platform's", () => {
    // A platform that reads some purefa_volume_ series as a kind of its own.
    StorageArrayPlatformRegistry.register(
      acmePlatformWith({
        metricFamilies: [
          { prefix: "purefa_volume_", kind: ACME_AGGREGATE_KIND },
        ],
      }),
    );
    expect(
      StorageArrayPlatformRegistry.getObjectKindForMetricName(
        "purefa_volume_space_bytes",
        ACME_STORAGE_SYSTEM,
      ),
    ).toBe(ACME_AGGREGATE_KIND);
    expect(
      StorageArrayPlatformRegistry.getObjectKindForMetricName(
        "purefa_volume_space_bytes",
        FLASHARRAY,
      ),
    ).toBe(StorageArrayResourceKind.Volume);
    expect(
      StorageArrayPlatformRegistry.getObjectKindForMetricName(
        "purefa_volume_space_bytes",
      ),
    ).toBe(StorageArrayResourceKind.Volume);
  });

  test("a platform that would break quietly is refused, and the registry is left as it was", () => {
    const before: number = StorageArrayPlatformRegistry.getVersion();
    expect(() => {
      StorageArrayPlatformRegistry.register(
        acmePlatformWith({ aliases: ["purefa"] }),
      );
    }).toThrow(
      'Storage array platform acme.array cannot be registered: "purefa" already names purestorage.flasharray',
    );
    expect(StorageArrayPlatformRegistry.getVersion()).toBe(before);
    expect(StorageArrayPlatformRegistry.getPlatforms()).toEqual(
      BUILT_IN_STORAGE_ARRAY_PLATFORMS,
    );
  });

  test("registering it twice is refused", () => {
    StorageArrayPlatformRegistry.register(ACME_PLATFORM);
    expect(() => {
      StorageArrayPlatformRegistry.register(ACME_PLATFORM);
    }).toThrow("another platform already has this storage.system");
  });
});

/*
 * A log template as a platform whose alerts arrive in its logs declares one
 * (Dell PowerStore's, read from its syslog).
 */
const ACME_LOG_TEMPLATE: StorageArrayLogAlertTemplateSpec = {
  id: "acme-failure-logged",
  name: "Acme Failure Logged",
  summary: "The array logs a failure: one alert each, until it clears it.",
  description: "Opens an alert for each failure the array logs.",
  category: "Array Alerts",
  severity: "Critical",
  attributes: { "acme.alert.severity": "failure" },
  groupByAttributes: ["acme.alert.id"],
  resolvedByAttributes: { "acme.alert.state": "cleared" },
  windowSeconds: 3600,
  incidentTitle: "Acme array failure",
  incidentDescription: "The array logged a failure.",
  criteriaName: "A failure is logged",
  criteriaDescription: "A line of the array logs a failure.",
  healthyDescription: "No failure is open.",
};

describe("what registration refuses", () => {
  const firstPureMetricId: string =
    PureStorageFlashArrayPlatform.metrics[0]!.id;
  const firstPureTemplateId: string =
    PureStorageFlashArrayPlatform.alertTemplates[0]!.id;

  test("the acme platform itself is accepted", () => {
    expect(
      StorageArrayPlatformRegistry.getRegistrationProblem(ACME_PLATFORM),
    ).toBeNull();
  });

  test("a platform whose alerts arrive in its logs, with a log template, is accepted", () => {
    expect(
      StorageArrayPlatformRegistry.getRegistrationProblem(
        acmePlatformWith({ logAlertTemplates: [ACME_LOG_TEMPLATE] }),
      ),
    ).toBeNull();
  });

  test.each([
    [
      "an upper-case storage.system",
      { storageSystem: "Acme.Array" },
      '"Acme.Array" is not a well-formed storage.system (lowercase vendor.product)',
    ],
    [
      "a storage.system with a space",
      { storageSystem: "acme array" },
      '"acme array" is not a well-formed storage.system (lowercase vendor.product)',
    ],
    [
      "an empty storage.system",
      { storageSystem: "" },
      '"" is not a well-formed storage.system (lowercase vendor.product)',
    ],
    [
      "a storage.system of 65 characters",
      { storageSystem: `acme.${"a".repeat(60)}` },
      `"acme.${"a".repeat(60)}" is not a well-formed storage.system (lowercase vendor.product)`,
    ],
    [
      "a shipped platform's storage.system",
      { storageSystem: FLASHBLADE },
      "another platform already has this storage.system",
    ],
    [
      "an alias another platform answers to",
      { aliases: ["acme", "flashblade"] },
      '"flashblade" already names purestorage.flashblade',
    ],
    [
      "a storage.system another platform has as an alias",
      { storageSystem: "pure.flasharray", aliases: [] },
      '"pure.flasharray" already names purestorage.flasharray',
    ],
    [
      "an alias in capitals",
      { aliases: ["ACME"] },
      'the alias "ACME" is not lowercase and trimmed',
    ],
    [
      "an alias with a space around it",
      { aliases: [" acme"] },
      'the alias " acme" is not lowercase and trimmed',
    ],
    [
      "a metric id a shipped platform uses",
      {
        // The one metric no page or section of Acme's names (#11122).
        metrics: [
          ACME_PLATFORM.metrics[0]!,
          { ...ACME_PLATFORM.metrics[1]!, id: firstPureMetricId },
          ...ACME_PLATFORM.metrics.slice(2),
        ],
      },
      `the metric id ${firstPureMetricId} is taken`,
    ],
    [
      "the same metric id twice",
      {
        metrics: [ACME_PLATFORM.metrics[0]!, ...ACME_PLATFORM.metrics],
      },
      "the metric id acme-volume-used is listed twice",
    ],
    [
      "a template id a shipped platform uses",
      {
        alertTemplates: [
          { ...ACME_PLATFORM.alertTemplates[0]!, id: firstPureTemplateId },
        ],
      },
      `the template id ${firstPureTemplateId} is taken`,
    ],
    [
      "a heartbeat id a shipped platform uses",
      {
        heartbeat: {
          templateId: PureStorageFlashBladePlatform.heartbeat.templateId,
          metricName: "acme_info",
        },
      },
      `the template id ${PureStorageFlashBladePlatform.heartbeat.templateId} is taken`,
    ],
    [
      "a template with its own heartbeat's id",
      {
        alertTemplates: [
          {
            ...ACME_PLATFORM.alertTemplates[0]!,
            id: ACME_PLATFORM.heartbeat.templateId,
          },
        ],
      },
      `the template id ${ACME_PLATFORM.heartbeat.templateId} is taken`,
    ],
    [
      "a log template id a shipped platform's log template uses",
      {
        logAlertTemplates: [
          {
            ...ACME_LOG_TEMPLATE,
            id: DellPowerStorePlatform.logAlertTemplates![0]!.id,
          },
        ],
      },
      `the template id ${DellPowerStorePlatform.logAlertTemplates![0]!.id} is taken`,
    ],
    [
      "a log template with a metric template's id",
      {
        logAlertTemplates: [{ ...ACME_LOG_TEMPLATE, id: firstPureTemplateId }],
      },
      `the template id ${firstPureTemplateId} is taken`,
    ],
    [
      "a log template with its own metric template's id",
      {
        logAlertTemplates: [
          { ...ACME_LOG_TEMPLATE, id: ACME_PLATFORM.alertTemplates[0]!.id },
        ],
      },
      `the template id ${ACME_PLATFORM.alertTemplates[0]!.id} is taken`,
    ],
    [
      "a log template that matches every line",
      { logAlertTemplates: [{ ...ACME_LOG_TEMPLATE, attributes: {} }] },
      "its log template acme-failure-logged matches every line",
    ],
    [
      "a log template grouped by nothing",
      { logAlertTemplates: [{ ...ACME_LOG_TEMPLATE, groupByAttributes: [] }] },
      "its log template acme-failure-logged groups by no attribute it can name",
    ],
    [
      "a log template grouped by a blank attribute",
      {
        logAlertTemplates: [
          { ...ACME_LOG_TEMPLATE, groupByAttributes: ["acme.alert.id", " "] },
        ],
      },
      "its log template acme-failure-logged groups by no attribute it can name",
    ],
    [
      "a log template no line resolves",
      {
        logAlertTemplates: [{ ...ACME_LOG_TEMPLATE, resolvedByAttributes: {} }],
      },
      "its log template acme-failure-logged has no line that resolves it",
    ],
    [
      "a log template that looks back no time",
      { logAlertTemplates: [{ ...ACME_LOG_TEMPLATE, windowSeconds: 0 }] },
      "its log template acme-failure-logged looks back no time",
    ],
    [
      "a log template that looks back part of a second",
      { logAlertTemplates: [{ ...ACME_LOG_TEMPLATE, windowSeconds: 1.5 }] },
      "its log template acme-failure-logged looks back no time",
    ],
    [
      "an agent config key a shipped platform uses",
      {
        agentConfigs: [
          { ...ACME_PLATFORM.agentConfigs[0]!, key: "flashblade" },
        ],
      },
      "the agent config flashblade is taken",
    ],
    [
      "a kind a count could not be stored under",
      {
        kinds: [StorageArrayResourceKind.Volume, "storage-vm"],
      },
      'the kind "storage-vm" is not letters and digits starting with a letter',
    ],
    [
      "a kind listed twice",
      {
        kinds: [
          StorageArrayResourceKind.Volume,
          ACME_AGGREGATE_KIND,
          StorageArrayResourceKind.Volume,
        ],
      },
      "the kind Volume is listed twice",
    ],
    [
      "a kind of its own without words",
      { kindDefinitions: [] },
      "its kind Aggregate has no words: give it a kindDefinition",
    ],
    [
      "words for a kind it does not have",
      {
        kinds: [StorageArrayResourceKind.Volume],
        scrapeEndpoints: { volumes: [StorageArrayResourceKind.Volume] },
        metricFamilies: [
          { prefix: "acme_volume_", kind: StorageArrayResourceKind.Volume },
        ],
      },
      "it defines the kind Aggregate, which is not one of its kinds",
    ],
    [
      "an endpoint that completes a kind it does not have",
      {
        scrapeEndpoints: {
          ...ACME_PLATFORM.scrapeEndpoints,
          hosts: [StorageArrayResourceKind.Host],
        },
      },
      "its hosts endpoint names the kind Host, which is not one of its kinds",
    ],
    [
      "a series family of a kind it does not have",
      {
        metricFamilies: [
          ...ACME_PLATFORM.metricFamilies,
          { prefix: "acme_lun_", kind: "Lun" },
        ],
      },
      "its acme_lun_ series names the kind Lun, which is not one of its kinds",
    ],
    [
      "a count chip of a kind it does not have",
      {
        overview: {
          ...ACME_PLATFORM.overview,
          countChips: [
            { kind: StorageArrayResourceKind.Host, showWhenZero: true },
          ],
        },
      },
      "its overview's counts names the kind Host, which is not one of its kinds",
    ],
    [
      "a list count of a kind it does not have",
      {
        overview: {
          ...ACME_PLATFORM.overview,
          listCounts: [StorageArrayResourceKind.Pod],
        },
      },
      "its list's counts names the kind Pod, which is not one of its kinds",
    ],
    [
      "an inventory tile of a kind it does not have",
      {
        overview: {
          ...ACME_PLATFORM.overview,
          inventoryTile: { kind: StorageArrayResourceKind.FileSystem },
        },
      },
      "its inventory tile names the kind FileSystem, which is not one of its kinds",
    ],
    [
      "top lists of a kind it does not have",
      {
        overview: {
          ...ACME_PLATFORM.overview,
          topKind: StorageArrayResourceKind.Bucket,
        },
      },
      "its top lists names the kind Bucket, which is not one of its kinds",
    ],
    [
      "a hardware table of a kind it does not have",
      {
        hardwareTables: [
          {
            kind: StorageArrayResourceKind.Drive,
            layout: "default",
            tableId: "acme-drives-table",
            description: "Drives.",
            noItemsMessage: "No drives yet.",
          },
        ],
      },
      "its hardware tables names the kind Drive, which is not one of its kinds",
    ],
    [
      "hardware kinds it does not have",
      { hardwareKinds: [StorageArrayResourceKind.Controller] },
      "its hardware kinds names the kind Controller, which is not one of its kinds",
    ],
    [
      "a Resource Usage chart of a metric not in its catalog",
      {
        insightsSections: [
          {
            key: "volumes",
            title: "Volumes",
            description: "Volumes.",
            icon: IconProp.Disc,
            metricIds: ["purefa-volume-read-latency"],
          },
        ],
      },
      "its volumes section charts the metric purefa-volume-read-latency, which is not in its catalog",
    ],
    [
      "an overview chart of a metric not in its catalog",
      {
        overview: {
          ...ACME_PLATFORM.overview,
          goldenCharts: {
            readLatency: "acme-volume-used",
            writeLatency: "acme-volume-used",
            readIops: "acme-volume-used",
            writeIops: "acme-volume-used",
            readBandwidth: "acme-volume-used",
            writeBandwidth: "acme-volume-used",
            capacityUsed: "acme-capacity-used",
            capacityUsedDescription: "Share of the array in use.",
          },
        },
      },
      "its overview charts the metric acme-capacity-used, which is not in its catalog",
    ],
    [
      "an overview panel that draws no line",
      {
        overview: {
          ...ACME_PLATFORM.overview,
          charts: [{ title: "Latency", description: "Latency.", lines: [] }],
        },
      },
      "its overview's Latency chart draws no line",
    ],
    [
      "an overview panel of a metric not in its catalog",
      {
        overview: {
          ...ACME_PLATFORM.overview,
          charts: [
            {
              title: "Latency",
              description: "Latency.",
              lines: [{ metricId: "powerscale-protocol-latency" }],
            },
          ],
        },
      },
      "its overview charts the metric powerscale-protocol-latency, which is not in its catalog",
    ],
  ] as Array<[string, Partial<StorageArrayPlatform>, string]>)(
    "%s",
    (
      _case: string,
      overrides: Partial<StorageArrayPlatform>,
      problem: string,
    ) => {
      expect(
        StorageArrayPlatformRegistry.getRegistrationProblem(
          acmePlatformWith(overrides),
        ),
      ).toBe(problem);
    },
  );

  test("a value of the vendor.product shape with digits, dots, dashes and underscores is fine", () => {
    for (const storageSystem of [
      "hitachi.vsp",
      "dell.powerstore_next",
      "emc.vnx2",
      "dell.unity_xt",
      "hpe.3par-primera",
      "ibm.flashsystem9500",
    ]) {
      expect(
        StorageArrayPlatformRegistry.getRegistrationProblem(
          acmePlatformWith({ storageSystem, aliases: [] }),
        ),
      ).toBeNull();
    }
  });

  test("against no other platform, only its own shape is checked", () => {
    expect(
      StorageArrayPlatformRegistry.getRegistrationProblem(
        acmePlatformWith({
          storageSystem: FLASHARRAY,
          aliases: ["purefa"],
          metrics: [{ ...ACME_PLATFORM.metrics[0]!, id: firstPureMetricId }],
          insightsSections: [],
          kindPages: {},
        }),
        [],
      ),
    ).toBeNull();
  });

  test("an object label of its own is any lowercase label", () => {
    expect(
      StorageArrayPlatformRegistry.getRegistrationProblem(
        acmePlatformWith({
          objectLabels: {
            [StorageArrayResourceScope.Volume]: "volume_name",
            [StorageArrayResourceScope.Host]: "initiator_group",
          },
        }),
      ),
    ).toBeNull();
  });
});
