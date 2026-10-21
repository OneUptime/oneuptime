import StorageSystem, {
  StorageSystemUtil,
} from "../../../Types/StorageArray/StorageSystem";
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

describe("StorageSystem enum", () => {
  test("carries exactly the two launch platforms with vendor.product values", () => {
    expect(Object.entries(StorageSystem)).toEqual([
      ["PureStorageFlashArray", "purestorage.flasharray"],
      ["PureStorageFlashBlade", "purestorage.flashblade"],
    ]);
  });

  test("getAllSystems lists every enum value in declaration order", () => {
    expect(StorageSystemUtil.getAllSystems()).toEqual([
      StorageSystem.PureStorageFlashArray,
      StorageSystem.PureStorageFlashBlade,
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
    ["another platform", "netapp.ontap"],
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

  test.each([
    ["PureFA", StorageSystem.PureStorageFlashArray],
    ["  purefa  ", StorageSystem.PureStorageFlashArray],
    ["\tEverPure.FlashArray\n", StorageSystem.PureStorageFlashArray],
    ["PURESTORAGE.FLASHBLADE", StorageSystem.PureStorageFlashBlade],
    [" FlashBlade ", StorageSystem.PureStorageFlashBlade],
    ["Pure-FlashBlade", StorageSystem.PureStorageFlashBlade],
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
    ["NetApp.ONTAP", "netapp.ontap"],
    ["dell.powerstore", "dell.powerstore"],
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

  test("no alias belongs to both platforms", () => {
    const shared: Array<string> = FLASHARRAY_ALIASES.filter((alias: string) => {
      return FLASHBLADE_ALIASES.includes(alias);
    });
    expect(shared).toEqual([]);
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
  ])("%s belongs to %s", (metricName: string, expected: StorageSystem) => {
    expect(StorageSystemUtil.fromMetricName(metricName)).toBe(expected);
  });

  test.each([
    ["the bare prefix without its underscore", "purefa"],
    ["an upper-case prefix", "PUREFA_info"],
    ["a Ceph metric", "ceph_health_status"],
    ["a dotted OTel metric", "vcenter.host.cpu.usage"],
    ["a prefix in the middle", "my_purefa_info"],
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

  test("getMetricPrefix is purefa_ / purefb_", () => {
    expect(
      StorageSystemUtil.getMetricPrefix(StorageSystem.PureStorageFlashArray),
    ).toBe("purefa_");
    expect(
      StorageSystemUtil.getMetricPrefix(StorageSystem.PureStorageFlashBlade),
    ).toBe("purefb_");
  });
});

describe("StorageSystemUtil display helpers", () => {
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
    for (const system of StorageSystemUtil.getAllSystems()) {
      // Product names are unchanged by the Everpure rename.
      expect(StorageSystemUtil.getVendorName(system)).toBe("Pure Storage");
      expect(StorageSystemUtil.getDisplayName(system)).toContain(
        StorageSystemUtil.getShortName(system),
      );
    }
  });

  test("an unknown platform is shown under its own value", () => {
    expect(StorageSystemUtil.getDisplayName("netapp.ontap")).toBe(
      "netapp.ontap",
    );
    expect(StorageSystemUtil.getShortName("netapp.ontap")).toBe("netapp.ontap");
    expect(StorageSystemUtil.getVendorName("netapp.ontap")).toBe("Unknown");
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

    for (const value of [null, undefined, "", "purefa", "netapp.ontap"]) {
      expect(StorageSystemUtil.isFlashArray(value)).toBe(false);
      expect(StorageSystemUtil.isFlashBlade(value)).toBe(false);
    }
  });
});
