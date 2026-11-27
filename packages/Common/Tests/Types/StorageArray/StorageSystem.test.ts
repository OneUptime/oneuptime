import StorageSystem from "../../../Types/StorageArray/StorageSystem";
import StorageSystemUtil from "../../../Types/StorageArray/StorageSystemUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * StorageSystem is the vocabulary of the `storage.system` resource attribute
 * and of StorageArray.storageSystem. Ingest normalizes whatever an agent
 * stamped through StorageSystemUtil.normalize, the metrics scan detects the
 * platform from the metric prefix (fromMetricName), and every platform page,
 * catalog filter and alert template keys on the canonical value — so the
 * canonical strings and the alias table are pinned here.
 */

const FLASHARRAY_ALIASES: Array<string> = [
  "purestorage.flasharray",
  "purestorage_flasharray",
  "purestorage-flasharray",
  "pure.flasharray",
  "pure_flasharray",
  "pure-flasharray",
  "everpure.flasharray",
  "everpure_flasharray",
  "purefa",
  "flasharray",
];

const FLASHBLADE_ALIASES: Array<string> = [
  "purestorage.flashblade",
  "purestorage_flashblade",
  "purestorage-flashblade",
  "pure.flashblade",
  "pure_flashblade",
  "pure-flashblade",
  "everpure.flashblade",
  "everpure_flashblade",
  "purefb",
  "flashblade",
];

const POWERSTORE_ALIASES: Array<string> = [
  "dell.powerstore",
  "dell_powerstore",
  "dell-powerstore",
  "dellemc.powerstore",
  "dellemc_powerstore",
  "dellemc-powerstore",
  "emc.powerstore",
  "powerstore",
];

// What an ONTAP agent may stamp (#11001), Amazon FSx for NetApp ONTAP's too.
const ONTAP_ALIASES: Array<string> = [
  "netapp.ontap",
  "netapp_ontap",
  "netapp-ontap",
  "netapp.cdot",
  "netapp.fas",
  "netapp.aff",
  "netapp.fsx",
  "aws.fsx_ontap",
  "ontap",
];

describe("StorageSystem enum", () => {
  test("carries exactly the shipped platforms with vendor.product values", () => {
    expect(Object.entries(StorageSystem)).toEqual([
      ["PureStorageFlashArray", "purestorage.flasharray"],
      ["PureStorageFlashBlade", "purestorage.flashblade"],
      ["DellPowerStore", "dell.powerstore"],
      ["NetAppOntap", "netapp.ontap"],
      ["DellPowerScale", "dell.powerscale"],
    ]);
  });

  test("getAllSystems lists every enum value in declaration order", () => {
    expect(StorageSystemUtil.getAllSystems()).toEqual([
      StorageSystem.PureStorageFlashArray,
      StorageSystem.PureStorageFlashBlade,
      StorageSystem.DellPowerStore,
      StorageSystem.NetAppOntap,
      StorageSystem.DellPowerScale,
    ]);
  });

  test("canonical values follow the db.system.name style (vendor.product, lowercase)", () => {
    for (const system of StorageSystemUtil.getAllSystems()) {
      expect(system).toMatch(/^[a-z0-9]+\.[a-z0-9_]+$/);
    }
  });
});

describe("StorageSystemUtil.isKnownSystem", () => {
  test.each(StorageSystemUtil.getAllSystems())(
    "%s is known",
    (system: StorageSystem) => {
      expect(StorageSystemUtil.isKnownSystem(system)).toBe(true);
    },
  );

  test.each([
    ["an alias", "purefa"],
    ["an upper-case canonical value", "PURESTORAGE.FLASHARRAY"],
    ["a padded canonical value", " purestorage.flasharray "],
    ["another platform", "hitachi.vsp"],
    ["the empty string", ""],
  ])(
    "%s is not known (only normalized values are)",
    (_: string, value: string) => {
      expect(StorageSystemUtil.isKnownSystem(value)).toBe(false);
    },
  );

  test("null and undefined are not known", () => {
    expect(StorageSystemUtil.isKnownSystem(null)).toBe(false);
    expect(StorageSystemUtil.isKnownSystem(undefined)).toBe(false);
  });
});

describe("StorageSystemUtil.normalize", () => {
  test.each(FLASHARRAY_ALIASES)(
    "FlashArray alias %p normalizes to purestorage.flasharray",
    (alias: string) => {
      expect(StorageSystemUtil.normalize(alias)).toBe(
        StorageSystem.PureStorageFlashArray,
      );
    },
  );

  test.each(FLASHBLADE_ALIASES)(
    "FlashBlade alias %p normalizes to purestorage.flashblade",
    (alias: string) => {
      expect(StorageSystemUtil.normalize(alias)).toBe(
        StorageSystem.PureStorageFlashBlade,
      );
    },
  );

  test.each(POWERSTORE_ALIASES)(
    "PowerStore alias %p normalizes to dell.powerstore",
    (alias: string) => {
      expect(StorageSystemUtil.normalize(alias)).toBe(
        StorageSystem.DellPowerStore,
      );
    },
  );

  test.each(ONTAP_ALIASES)(
    "ONTAP alias %p normalizes to netapp.ontap",
    (alias: string) => {
      expect(StorageSystemUtil.normalize(alias)).toBe(
        StorageSystem.NetAppOntap,
      );
      expect(StorageSystemUtil.normalize(alias.toUpperCase())).toBe(
        StorageSystem.NetAppOntap,
      );
    },
  );

  test.each([
    ["PureFA", StorageSystem.PureStorageFlashArray],
    ["  purefa  ", StorageSystem.PureStorageFlashArray],
    ["\tEverPure.FlashArray\n", StorageSystem.PureStorageFlashArray],
    ["PURESTORAGE.FLASHBLADE", StorageSystem.PureStorageFlashBlade],
    [" FlashBlade ", StorageSystem.PureStorageFlashBlade],
    ["Pure-FlashBlade", StorageSystem.PureStorageFlashBlade],
    [" Dell.PowerStore ", StorageSystem.DellPowerStore],
    ["DELLEMC-POWERSTORE", StorageSystem.DellPowerStore],
  ])(
    "ignores case and surrounding whitespace: %p -> %p",
    (raw: string, expected: string) => {
      expect(StorageSystemUtil.normalize(raw)).toBe(expected);
    },
  );

  test("the canonical values are fixed points", () => {
    for (const system of StorageSystemUtil.getAllSystems()) {
      expect(StorageSystemUtil.normalize(system)).toBe(system);
      expect(
        StorageSystemUtil.normalize(StorageSystemUtil.normalize(system)),
      ).toBe(system);
    }
  });

  test.each([
    ["Hitachi.VSP", "hitachi.vsp"],
    ["Dell.PowerMax", "dell.powermax"],
    ["hpe_alletra-9000", "hpe_alletra-9000"],
    ["  IBM.FlashSystem  ", "ibm.flashsystem"],
    ["x", "x"],
    ["7", "7"],
  ])(
    "keeps an unknown but well-formed platform, lowercased: %p -> %p",
    (raw: string, expected: string) => {
      /*
       * An array of a platform OneUptime has no extractor for is still
       * discovered and shown under the name its agent stamped.
       */
      expect(StorageSystemUtil.normalize(raw)).toBe(expected);
    },
  );

  test("accepts a 64-character platform and rejects a 65-character one", () => {
    const sixtyFour: string = "a".repeat(64);
    expect(StorageSystemUtil.normalize(sixtyFour)).toBe(sixtyFour);
    expect(StorageSystemUtil.normalize("a".repeat(65))).toBeNull();
  });

  test.each([
    ["the empty string", ""],
    ["whitespace only", "   "],
    ["an inner space", "pure storage"],
    ["a slash", "pure/flasharray"],
    ["a colon", "pure:fa"],
    ["a leading dot", ".flasharray"],
    ["a leading dash", "-flasharray"],
    ["a leading underscore", "_flasharray"],
    ["punctuation", "!!!"],
    ["a non-ASCII letter", "pürefa"],
    ["a quote", "pure'fa"],
  ])("returns null for %s", (_: string, raw: string) => {
    expect(StorageSystemUtil.normalize(raw)).toBeNull();
  });

  test("returns null for null and undefined", () => {
    expect(StorageSystemUtil.normalize(null)).toBeNull();
    expect(StorageSystemUtil.normalize(undefined)).toBeNull();
  });

  test("no alias belongs to two platforms", () => {
    const all: Array<string> = [
      ...FLASHARRAY_ALIASES,
      ...FLASHBLADE_ALIASES,
      ...POWERSTORE_ALIASES,
      ...ONTAP_ALIASES,
    ];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("StorageSystemUtil.fromMetricName", () => {
  test.each([
    ["purefa_info", StorageSystem.PureStorageFlashArray],
    ["purefa_alerts_open", StorageSystem.PureStorageFlashArray],
    [
      "purefa_volume_performance_latency_usec",
      StorageSystem.PureStorageFlashArray,
    ],
    ["purefb_info", StorageSystem.PureStorageFlashBlade],
    ["purefb_hardware_health", StorageSystem.PureStorageFlashBlade],
    ["purefb_buckets_object_count", StorageSystem.PureStorageFlashBlade],
    ["powerstore_cluster", StorageSystem.DellPowerStore],
    ["powerstore_volume_logical_used", StorageSystem.DellPowerStore],
    ["powerstore_metricFcPort_avg_read_iops", StorageSystem.DellPowerStore],
    ["netapp_volume_size_used", StorageSystem.NetAppOntap],
    ["netapp_metadata_component_status", StorageSystem.NetAppOntap],
  ])("%s belongs to %s", (metricName: string, expected: StorageSystem) => {
    expect(StorageSystemUtil.fromMetricName(metricName)).toBe(expected);
  });

  test.each([
    ["the bare prefix without its underscore", "purefa"],
    ["an upper-case prefix", "PUREFA_info"],
    ["a Ceph metric", "ceph_health_status"],
    ["a dotted OTel metric", "vcenter.host.cpu.usage"],
    ["a prefix in the middle", "my_purefa_info"],
    // What Harvest serves without the agent's global_prefix.
    ["an unprefixed Harvest series", "volume_size_used"],
    ["the empty string", ""],
  ])("returns null for %s", (_: string, metricName: string) => {
    expect(StorageSystemUtil.fromMetricName(metricName)).toBeNull();
  });

  test("returns null for null and undefined", () => {
    expect(StorageSystemUtil.fromMetricName(null)).toBeNull();
    expect(StorageSystemUtil.fromMetricName(undefined)).toBeNull();
  });

  test("every system's prefix maps back to that system", () => {
    for (const system of StorageSystemUtil.getAllSystems()) {
      const prefix: string = StorageSystemUtil.getMetricPrefix(system);
      expect(prefix.endsWith("_")).toBe(true);
      expect(StorageSystemUtil.fromMetricName(`${prefix}anything`)).toBe(
        system,
      );
    }
  });

  test("getMetricPrefix is purefa_ / purefb_ / powerstore_", () => {
    expect(
      StorageSystemUtil.getMetricPrefix(StorageSystem.PureStorageFlashArray),
    ).toBe("purefa_");
    expect(
      StorageSystemUtil.getMetricPrefix(StorageSystem.PureStorageFlashBlade),
    ).toBe("purefb_");
    expect(
      StorageSystemUtil.getMetricPrefix(StorageSystem.DellPowerStore),
    ).toBe("powerstore_");
  });
});

describe("StorageSystemUtil display helpers", () => {
  test("display, short and vendor names of NetApp ONTAP", () => {
    expect(StorageSystemUtil.getDisplayName(StorageSystem.NetAppOntap)).toBe(
      "NetApp ONTAP",
    );
    expect(StorageSystemUtil.getShortName(StorageSystem.NetAppOntap)).toBe(
      "ONTAP",
    );
    expect(StorageSystemUtil.getVendorName(StorageSystem.NetAppOntap)).toBe(
      "NetApp",
    );
    expect(StorageSystemUtil.getMetricPrefix(StorageSystem.NetAppOntap)).toBe(
      "netapp_",
    );
  });

  test("display, short and vendor names of Dell PowerScale", () => {
    expect(StorageSystemUtil.getDisplayName(StorageSystem.DellPowerScale)).toBe(
      "Dell PowerScale",
    );
    expect(StorageSystemUtil.getShortName(StorageSystem.DellPowerScale)).toBe(
      "PowerScale",
    );
    expect(StorageSystemUtil.getVendorName(StorageSystem.DellPowerScale)).toBe(
      "Dell",
    );
    expect(StorageSystemUtil.getMetricPrefix(StorageSystem.DellPowerScale)).toBe(
      "powerscale_",
    );
  });

  test("display, short and vendor names of the launch platforms", () => {
    expect(
      StorageSystemUtil.getDisplayName(StorageSystem.PureStorageFlashArray),
    ).toBe("Pure Storage FlashArray");
    expect(
      StorageSystemUtil.getDisplayName(StorageSystem.PureStorageFlashBlade),
    ).toBe("Pure Storage FlashBlade");
    expect(
      StorageSystemUtil.getShortName(StorageSystem.PureStorageFlashArray),
    ).toBe("FlashArray");
    expect(
      StorageSystemUtil.getShortName(StorageSystem.PureStorageFlashBlade),
    ).toBe("FlashBlade");
    expect(StorageSystemUtil.getDisplayName(StorageSystem.DellPowerStore)).toBe(
      "Dell PowerStore",
    );
    expect(StorageSystemUtil.getShortName(StorageSystem.DellPowerStore)).toBe(
      "PowerStore",
    );
    expect(StorageSystemUtil.getVendorName(StorageSystem.DellPowerStore)).toBe(
      "Dell",
    );
    for (const system of [
      StorageSystem.PureStorageFlashArray,
      StorageSystem.PureStorageFlashBlade,
    ]) {
      // Product names are unchanged by the Everpure rename.
      expect(StorageSystemUtil.getVendorName(system)).toBe("Pure Storage");
    }
    for (const system of StorageSystemUtil.getAllSystems()) {
      expect(StorageSystemUtil.getDisplayName(system)).toContain(
        StorageSystemUtil.getShortName(system),
      );
    }
  });

  test("an unknown platform is shown under its own value", () => {
    expect(StorageSystemUtil.getDisplayName("hitachi.vsp")).toBe("hitachi.vsp");
    expect(StorageSystemUtil.getShortName("hitachi.vsp")).toBe("hitachi.vsp");
    expect(StorageSystemUtil.getVendorName("hitachi.vsp")).toBe("Unknown");
  });

  test("a missing platform reads Unknown, never an empty string", () => {
    for (const value of [null, undefined, ""]) {
      expect(StorageSystemUtil.getDisplayName(value)).toBe("Unknown");
      expect(StorageSystemUtil.getShortName(value)).toBe("Unknown");
      expect(StorageSystemUtil.getVendorName(value)).toBe("Unknown");
    }
  });

  test("isFlashArray / isFlashBlade match only their own canonical value", () => {
    expect(
      StorageSystemUtil.isFlashArray(StorageSystem.PureStorageFlashArray),
    ).toBe(true);
    expect(
      StorageSystemUtil.isFlashArray(StorageSystem.PureStorageFlashBlade),
    ).toBe(false);
    expect(
      StorageSystemUtil.isFlashBlade(StorageSystem.PureStorageFlashBlade),
    ).toBe(true);
    expect(
      StorageSystemUtil.isFlashBlade(StorageSystem.PureStorageFlashArray),
    ).toBe(false);

    for (const value of [
      null,
      undefined,
      "",
      "purefa",
      "hitachi.vsp",
      StorageSystem.DellPowerStore,
      StorageSystem.NetAppOntap,
    ]) {
      expect(StorageSystemUtil.isFlashArray(value)).toBe(false);
      expect(StorageSystemUtil.isFlashBlade(value)).toBe(false);
    }
  });
});
