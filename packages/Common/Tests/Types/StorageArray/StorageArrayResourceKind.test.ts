import StorageArrayResourceKind from "../../../Types/StorageArray/StorageArrayResourceKind";
import StorageArrayResourceKindUtil from "../../../Types/StorageArray/StorageArrayResourceKindUtil";
import StorageSystem from "../../../Types/StorageArray/StorageSystem";
import StorageSystemUtil from "../../../Types/StorageArray/StorageSystemUtil";
import StorageArrayPlatformRegistry from "../../../Types/StorageArray/StorageArrayPlatformRegistry";
import { StorageArrayKindDefinition } from "../../../Types/StorageArray/StorageArrayPlatform";
import StorageArrayPlatformRegistry from "../../../Types/StorageArray/StorageArrayPlatformRegistry";
import { OntapKind } from "../../../Types/StorageArray/Platforms/NetApp/NetApp";
import { describe, expect, test } from "@jest/globals";

/*
 * StorageArrayResource.kind is a plain ShortText column, written by the
 * snapshot scan and keyed on by the inventory pages, the stale cleanup and
 * the unique (projectId, storageArrayId, kind, externalId) index. A renamed
 * value orphans every row written under the old one, so the strings are
 * pinned, together with which platform reports which kind.
 */

const FLASHARRAY_KINDS: Array<StorageArrayResourceKind> = [
  StorageArrayResourceKind.Volume,
  StorageArrayResourceKind.Host,
  StorageArrayResourceKind.Pod,
  StorageArrayResourceKind.Hardware,
  StorageArrayResourceKind.Drive,
  StorageArrayResourceKind.Controller,
  StorageArrayResourceKind.NetworkInterface,
  StorageArrayResourceKind.Directory,
];

const FLASHBLADE_KINDS: Array<StorageArrayResourceKind> = [
  StorageArrayResourceKind.Hardware,
  StorageArrayResourceKind.FileSystem,
  StorageArrayResourceKind.Bucket,
];

// Dell PowerStore's: three of its own (Appliance, VolumeGroup, NasServer).
const POWERSTORE_KINDS: Array<string> = [
  "Appliance",
  StorageArrayResourceKind.Volume,
  "VolumeGroup",
  StorageArrayResourceKind.FileSystem,
  "NasServer",
  StorageArrayResourceKind.Hardware,
  StorageArrayResourceKind.Drive,
  StorageArrayResourceKind.NetworkInterface,
];

// The shared kinds ONTAP has, and the four only it has (#11001).
const ONTAP_KINDS: Array<string> = [
  StorageArrayResourceKind.Volume,
  OntapKind.Aggregate,
  OntapKind.Svm,
  OntapKind.Lun,
  OntapKind.SnapMirror,
  StorageArrayResourceKind.Controller,
  StorageArrayResourceKind.Drive,
  StorageArrayResourceKind.Hardware,
  StorageArrayResourceKind.NetworkInterface,
];

describe("StorageArrayResourceKind enum", () => {
  test("has exactly the ten kinds, PascalCase singular, value === key", () => {
    const entries: Array<[string, string]> = Object.entries(
      StorageArrayResourceKind,
    );

    expect(
      entries.map(([key]: [string, string]) => {
        return key;
      }),
    ).toEqual([
      "Volume",
      "Host",
      "Pod",
      "Hardware",
      "Drive",
      "Controller",
      "NetworkInterface",
      "Directory",
      "FileSystem",
      "Bucket",
    ]);

    for (const [key, value] of entries) {
      expect(value).toBe(key);
      expect(value).toMatch(/^[A-Z][A-Za-z]+$/);
      // Singular, like CephResource's Osd / Pool.
      expect(value.endsWith("s")).toBe(false);
    }
  });

  test("every kind fits the ShortText kind column", () => {
    for (const kind of StorageArrayResourceKindUtil.getAllKinds()) {
      expect(kind.length).toBeLessThanOrEqual(100);
    }
  });

  test("getAllKinds lists every enum value", () => {
    expect(StorageArrayResourceKindUtil.getAllKinds()).toEqual(
      Object.values(StorageArrayResourceKind),
    );
  });
});

describe("StorageArrayResourceKindUtil.getKindsForSystem", () => {
  test("a FlashArray reports volumes, hosts, pods, hardware, drives, controllers, interfaces and directories", () => {
    expect(
      StorageArrayResourceKindUtil.getKindsForSystem(
        StorageSystem.PureStorageFlashArray,
      ),
    ).toEqual(FLASHARRAY_KINDS);
  });

  test("a FlashBlade reports hardware, file systems and buckets", () => {
    expect(
      StorageArrayResourceKindUtil.getKindsForSystem(
        StorageSystem.PureStorageFlashBlade,
      ),
    ).toEqual(FLASHBLADE_KINDS);
  });

  test("an ONTAP cluster reports its volumes and hardware, and its aggregates, SVMs, LUNs and SnapMirror relationships", () => {
    expect(
      StorageArrayResourceKindUtil.getKindsForSystem(StorageSystem.NetAppOntap),
    ).toEqual(ONTAP_KINDS);
  });

  test("a PowerStore reports appliances, volumes, volume groups, file systems, NAS servers, hardware, drives and ports", () => {
    expect(
      StorageArrayResourceKindUtil.getKindsForSystem(
        StorageSystem.DellPowerStore,
      ),
    ).toEqual(POWERSTORE_KINDS);
  });

  test("every known platform reports at least one kind, and every kind belongs to a platform", () => {
    const covered: Set<StorageArrayResourceKind> = new Set();
    for (const system of StorageSystemUtil.getAllSystems()) {
      const kinds: Array<string> =
        StorageArrayResourceKindUtil.getKindsForSystem(system);
      expect(kinds.length).toBeGreaterThan(0);
      expect(new Set(kinds).size).toBe(kinds.length);
      for (const kind of kinds) {
        covered.add(kind);
        if (
          !(
            StorageArrayResourceKindUtil.getAllKinds() as Array<string>
          ).includes(kind)
        ) {
          expect({
            system,
            kind,
            defined: Boolean(
              StorageArrayPlatformRegistry.getKindDefinition(kind, system),
            ),
          }).toEqual({ system, kind, defined: true });
        }
      }
    }
    /*
     * Every shared kind, and each kind a platform defines for itself (a
     * PowerStore's appliances), which no other platform reports.
     */
    const own: Array<string> = StorageArrayPlatformRegistry.getPlatforms()
      .flatMap(
        (platform: {
          kindDefinitions?:
            | ReadonlyArray<StorageArrayKindDefinition>
            | undefined;
        }) => {
          return [...(platform.kindDefinitions || [])];
        },
      )
      .map((definition: StorageArrayKindDefinition): string => {
        return definition.kind;
      });
    expect([...covered].sort()).toEqual(
      [...StorageArrayResourceKindUtil.getAllKinds(), ...own].sort(),
    );
  });

  test.each([
    ["null", null],
    ["undefined", undefined],
    ["the empty string", ""],
    ["an unknown platform", "hitachi.vsp"],
    ["an alias (only canonical values are keyed)", "purefa"],
  ])("%s reports no kinds", (_: string, system: string | null | undefined) => {
    expect(StorageArrayResourceKindUtil.getKindsForSystem(system)).toEqual([]);
  });

  test.each(["constructor", "toString", "hasOwnProperty", "__proto__"])(
    "a prototype key %p is an unknown platform, not Object.prototype's member",
    (system: string) => {
      /*
       * REGRESSION: `constructor` is a well-formed `storage.system` value
       * (StorageSystemUtil.normalize keeps it), and a plain object lookup
       * returned Object's constructor function — a "list" that crashes the
       * first page calling .map on it.
       */
      const kinds: Array<StorageArrayResourceKind> =
        StorageArrayResourceKindUtil.getKindsForSystem(system);
      expect(Array.isArray(kinds)).toBe(true);
      expect(kinds).toEqual([]);
      expect(
        StorageArrayResourceKindUtil.isKindForSystem(
          StorageArrayResourceKind.Volume,
          system,
        ),
      ).toBe(false);
    },
  );
});

describe("StorageArrayResourceKindUtil.isKindForSystem", () => {
  test.each(StorageArrayResourceKindUtil.getAllKinds())(
    "%s is reported by exactly the platforms that list it",
    (kind: StorageArrayResourceKind) => {
      expect(
        StorageArrayResourceKindUtil.isKindForSystem(
          kind,
          StorageSystem.PureStorageFlashArray,
        ),
      ).toBe(FLASHARRAY_KINDS.includes(kind));
      expect(
        StorageArrayResourceKindUtil.isKindForSystem(
          kind,
          StorageSystem.PureStorageFlashBlade,
        ),
      ).toBe(FLASHBLADE_KINDS.includes(kind));
      expect(StorageArrayResourceKindUtil.isKindForSystem(kind, null)).toBe(
        false,
      );
    },
  );

  test("hardware is the one kind both platforms share", () => {
    const shared: Array<StorageArrayResourceKind> = FLASHARRAY_KINDS.filter(
      (kind: StorageArrayResourceKind) => {
        return FLASHBLADE_KINDS.includes(kind);
      },
    );
    expect(shared).toEqual([StorageArrayResourceKind.Hardware]);
  });
});

describe("StorageArrayResourceKindUtil labels", () => {
  test.each([
    [StorageArrayResourceKind.Volume, "Volume", "Volumes"],
    [StorageArrayResourceKind.Host, "Host", "Hosts"],
    [StorageArrayResourceKind.Pod, "Pod", "Pods"],
    [
      StorageArrayResourceKind.Hardware,
      "Hardware Component",
      "Hardware Components",
    ],
    [StorageArrayResourceKind.Drive, "Drive", "Drives"],
    [StorageArrayResourceKind.Controller, "Controller", "Controllers"],
    [
      StorageArrayResourceKind.NetworkInterface,
      "Network Interface",
      "Network Interfaces",
    ],
    [StorageArrayResourceKind.Directory, "Directory", "Directories"],
    [StorageArrayResourceKind.FileSystem, "File System", "File Systems"],
    [StorageArrayResourceKind.Bucket, "Bucket", "Buckets"],
  ])(
    "%s reads %p / %p",
    (kind: StorageArrayResourceKind, singular: string, plural: string) => {
      expect(StorageArrayResourceKindUtil.getSingularLabel(kind)).toBe(
        singular,
      );
      expect(StorageArrayResourceKindUtil.getPluralLabel(kind)).toBe(plural);
    },
  );

  test("singular and plural labels are distinct for every kind", () => {
    for (const kind of StorageArrayResourceKindUtil.getAllKinds()) {
      expect(StorageArrayResourceKindUtil.getSingularLabel(kind)).not.toBe(
        StorageArrayResourceKindUtil.getPluralLabel(kind),
      );
    }
  });

  test("a kind this build does not know is shown raw instead of crashing", () => {
    // The column is plain text; a newer build may have written a new kind.
    const future: StorageArrayResourceKind =
      "QuotaPolicy" as StorageArrayResourceKind;
    expect(StorageArrayResourceKindUtil.getSingularLabel(future)).toBe(
      "QuotaPolicy",
    );
    expect(StorageArrayResourceKindUtil.getPluralLabel(future)).toBe(
      "QuotaPolicy",
    );
    const prototypeKey: StorageArrayResourceKind =
      "constructor" as StorageArrayResourceKind;
    expect(StorageArrayResourceKindUtil.getSingularLabel(prototypeKey)).toBe(
      "constructor",
    );
  });
});
