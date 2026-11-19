import { describe, expect, test } from "@jest/globals";
import ProxmoxResource from "../../../Models/DatabaseModels/ProxmoxResource";
import StorageArrayResource from "../../../Models/DatabaseModels/StorageArrayResource";
import {
  DEFAULT_STORAGE_USAGE_THRESHOLDS,
  StorageUsage,
  StorageUsageLevel,
} from "../../../Utils/Storage/StorageUsage";
import {
  CEPH_OSD_FULL_PERCENT,
  CEPH_OSD_NEARFULL_PERCENT,
  CEPH_OSD_USAGE_THRESHOLDS,
  CEPH_POOL_FULL_PERCENT,
  CEPH_POOL_NEARFULL_PERCENT,
  CEPH_POOL_USAGE_THRESHOLDS,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/Utils/CephHealth";
import {
  getCephOsdStorageUsage,
  getCephPoolStorageUsage,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/Utils/CephPartFacts";
import {
  PROXMOX_STORAGE_FULL_PERCENT,
  PROXMOX_STORAGE_NEAR_FULL_PERCENT,
  PROXMOX_STORAGE_USAGE_THRESHOLDS,
  ProxmoxAssessment,
  assessProxmoxGuest,
  assessProxmoxNode,
  getProxmoxAttentionItems,
  getProxmoxDiskUsage,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/Utils/ProxmoxHealth";
import {
  VMWARE_DATASTORE_CRITICAL_PERCENT,
  VMWARE_DATASTORE_USAGE_THRESHOLDS,
  VMWARE_DATASTORE_WARNING_PERCENT,
  getVMwareVCenterStorageUsage,
  getVMwareVmStorageUsage,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Utils/VMwareHealth";
import {
  OPENSTACK_DATABASE_VOLUME_USAGE_THRESHOLDS,
  OPENSTACK_DATABASE_VOLUME_WARNING_PERCENT,
  OPENSTACK_STORAGE_POOL_CRITICAL_PERCENT,
  OPENSTACK_STORAGE_POOL_USAGE_THRESHOLDS,
  OPENSTACK_STORAGE_POOL_WARNING_PERCENT,
  getOpenStackDatabaseVolumeUsage,
  getOpenStackStoragePoolUsage,
  isOpenStackDatabaseVolumeNearlyFull,
} from "../../../Types/OpenStack/OpenStackHealthRules";
import {
  FILE_SYSTEM_NEAR_FULL_AVAILABLE_RATIO,
  STORAGE_ARRAY_CAPACITY_CRITICAL_PERCENT,
  STORAGE_ARRAY_CAPACITY_USAGE_THRESHOLDS,
  STORAGE_ARRAY_CAPACITY_WARNING_PERCENT,
  StorageArrayAssessment,
  assessStorageArrayPart,
  getStorageArrayBucketNoUsageText,
  getStorageArrayBucketUsage,
  getStorageArrayCapacityUsage,
  getStorageArrayFileSystemUsage,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/Utils/StorageArrayHealth";
import {
  CLOUD_DISK_USAGE_INSIDE_GUEST,
  CLOUD_STORAGE_FULL_PERCENT,
  CLOUD_STORAGE_HIGH_PERCENT,
  CLOUD_STORAGE_NOT_REPORTED,
  CLOUD_STORAGE_USAGE_THRESHOLDS,
  CloudResourceStorage,
  getCloudDatabaseStorageUsage,
  getCloudResourceStorage,
} from "../../../Types/Cloud/CloudResourceHealth";
import { ResourceAttentionSeverity } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";

/*
 * HOW FULL EACH PRODUCT'S STORES ARE, ONE READING, EACH AT ITS OWN LINES
 * (#9646, #9647, #9648).
 *
 * Every list and page reads a store through the shared reading
 * (StorageUsage) at the lines its product's rules and alerts already use:
 * Ceph's nearfull and full ratios, Proxmox's and OpenStack's 85% and 95%,
 * VMware's and a storage array's 80% and 90%, the cloud storage rule's 90%
 * and 95%. Each line is defined once, beside its product's rules, and the
 * bar, the tiles and Needs attention all read it.
 */

const GIB: number = 1024 * 1024 * 1024;

type Fields<T> = { [Key in keyof T]?: T[Key] | undefined };

function proxmox(fields: Fields<ProxmoxResource>): ProxmoxResource {
  return Object.assign(new ProxmoxResource(), fields);
}

function storageArrayPart(
  fields: Fields<StorageArrayResource>,
): StorageArrayResource {
  return Object.assign(new StorageArrayResource(), fields);
}

function levelOf(usage: StorageUsage | null): StorageUsageLevel | null {
  return usage ? usage.level : null;
}

describe("Ceph", () => {
  test("an OSD's and a pool's lines are Ceph's own ratios, only past them", () => {
    expect(CEPH_OSD_USAGE_THRESHOLDS).toEqual({
      warningPercent: CEPH_OSD_NEARFULL_PERCENT,
      criticalPercent: CEPH_OSD_FULL_PERCENT,
      isPastLineOnly: true,
    });
    expect(CEPH_POOL_USAGE_THRESHOLDS).toEqual({
      warningPercent: CEPH_POOL_NEARFULL_PERCENT,
      criticalPercent: CEPH_POOL_FULL_PERCENT,
      isPastLineOnly: true,
    });
  });

  test("an OSD's disk: what it uses of its size, amber past nearfull, red past full", () => {
    const at: (usedPercent: number) => StorageUsageLevel | null = (
      usedPercent: number,
    ): StorageUsageLevel | null => {
      return levelOf(
        getCephOsdStorageUsage({ usedBytes: usedPercent, totalBytes: 100 }),
      );
    };

    expect(at(40)).toBe(StorageUsageLevel.Normal);
    expect(at(85)).toBe(StorageUsageLevel.Normal);
    expect(at(86)).toBe(StorageUsageLevel.Warning);
    expect(at(95)).toBe(StorageUsageLevel.Warning);
    expect(at(96)).toBe(StorageUsageLevel.Critical);
    expect(
      getCephOsdStorageUsage({ usedBytes: 500 * GIB, totalBytes: 2000 * GIB }),
    ).toMatchObject({ used: 500 * GIB, free: 1500 * GIB, usedPercent: 25 });
  });

  test("an OSD that sent no size has no reading", () => {
    expect(getCephOsdStorageUsage({ usedBytes: 1, totalBytes: null })).toBe(
      null,
    );
    expect(getCephOsdStorageUsage({ usedBytes: null, totalBytes: 100 })).toBe(
      null,
    );
  });

  /*
   * Ceph counts STORED and MAX AVAIL once, before replication; its USED is
   * raw, every copy counted. A 3-replica pool storing 300 with 700 more
   * writable is 30% full, as the Pool Near Full alert reads it.
   */
  test("a pool: STORED of STORED + MAX AVAIL, the Pool Near Full alert's percent", () => {
    const usage: StorageUsage | null = getCephPoolStorageUsage({
      storedBytes: 300,
      maxAvailBytes: 700,
    });

    expect(usage).toMatchObject({
      capacity: 1000,
      used: 300,
      free: 700,
      usedPercent: 30,
      level: StorageUsageLevel.Normal,
    });
    expect(
      levelOf(getCephPoolStorageUsage({ storedBytes: 97, maxAvailBytes: 3 })),
    ).toBe(StorageUsageLevel.Critical);
    expect(
      levelOf(getCephPoolStorageUsage({ storedBytes: 90, maxAvailBytes: 10 })),
    ).toBe(StorageUsageLevel.Warning);
  });

  test("a pool that reported neither, or nothing at all, has no reading", () => {
    expect(
      getCephPoolStorageUsage({ storedBytes: null, maxAvailBytes: 700 }),
    ).toBe(null);
    expect(getCephPoolStorageUsage({ storedBytes: 0, maxAvailBytes: 0 })).toBe(
      null,
    );
  });
});

describe("Proxmox", () => {
  test("a node's and a container's root disk read at a storage's lines", () => {
    expect(PROXMOX_STORAGE_USAGE_THRESHOLDS).toEqual({
      warningPercent: PROXMOX_STORAGE_NEAR_FULL_PERCENT,
      criticalPercent: PROXMOX_STORAGE_FULL_PERCENT,
      isPastLineOnly: true,
    });

    const node: ProxmoxResource = proxmox({
      kind: "Node",
      latestDiskBytes: 30 * GIB,
      maxDiskBytes: 120 * GIB,
    });
    expect(getProxmoxDiskUsage(node)).toMatchObject({
      used: 30 * GIB,
      free: 90 * GIB,
      usedPercent: 25,
      level: StorageUsageLevel.Normal,
    });
  });

  /*
   * Proxmox reports a QEMU VM's root image as 0 used: it cannot see inside
   * the guest. That is no reading, never 0%. A stopped container's 0 and a
   * template's disk are no reading either.
   */
  test("a VM's 0, a template and a storage have no root-disk reading", () => {
    expect(
      getProxmoxDiskUsage(
        proxmox({
          kind: "Guest",
          guestType: "qemu",
          latestDiskBytes: 0,
          maxDiskBytes: 32 * GIB,
        }),
      ),
    ).toBe(null);
    expect(
      getProxmoxDiskUsage(
        proxmox({
          kind: "Guest",
          guestType: "lxc",
          isTemplate: true,
          latestDiskBytes: 2 * GIB,
          maxDiskBytes: 8 * GIB,
        }),
      ),
    ).toBe(null);
    expect(
      getProxmoxDiskUsage(
        proxmox({
          kind: "Storage",
          latestDiskBytes: 2 * GIB,
          maxDiskBytes: 8 * GIB,
        }),
      ),
    ).toBe(null);
  });

  test("a container's root disk past 85% needs a look, past 95% is critical", () => {
    const container: (usedGib: number) => ProxmoxAssessment = (
      usedGib: number,
    ): ProxmoxAssessment => {
      return assessProxmoxGuest(
        proxmox({
          kind: "Guest",
          guestType: "lxc",
          isUp: true,
          latestDiskBytes: usedGib * GIB,
          maxDiskBytes: 100 * GIB,
        }),
      );
    };

    expect(container(85).severity).toBe(null);
    expect(container(90)).toEqual({
      severity: ResourceAttentionSeverity.Warning,
      reasons: [
        { text: "Root disk {{percent}} full", values: { percent: "90%" } },
      ],
    });
    expect(container(97).severity).toBe(ResourceAttentionSeverity.Critical);
  });

  test("a node's root filesystem past the lines is under Needs attention, with the node", () => {
    const node: ProxmoxResource = proxmox({
      kind: "Node",
      externalId: "node/pve1",
      name: "pve1",
      isUp: true,
      latestDiskBytes: 97 * GIB,
      maxDiskBytes: 100 * GIB,
    });

    expect(assessProxmoxNode(node)).toEqual({
      severity: ResourceAttentionSeverity.Critical,
      reasons: [
        { text: "Root disk {{percent}} full", values: { percent: "97%" } },
      ],
    });
    expect(
      getProxmoxAttentionItems({
        rows: [node],
        routeFor: () => {
          return undefined;
        },
      }).map((item: { key: string; severity: ResourceAttentionSeverity }) => {
        return [item.key, item.severity];
      }),
    ).toEqual([["Node:node/pve1", ResourceAttentionSeverity.Critical]]);
  });

  test("an offline node's last disk reading is not judged: Offline says it", () => {
    expect(
      assessProxmoxNode(
        proxmox({
          kind: "Node",
          isUp: false,
          latestDiskBytes: 99 * GIB,
          maxDiskBytes: 100 * GIB,
        }),
      ),
    ).toEqual({
      severity: ResourceAttentionSeverity.Critical,
      reasons: [{ text: "Offline" }],
    });
  });
});

describe("VMware", () => {
  test("a datastore and the vCenter's total read at the datastore levels, only past them", () => {
    expect(VMWARE_DATASTORE_USAGE_THRESHOLDS).toEqual({
      warningPercent: VMWARE_DATASTORE_WARNING_PERCENT,
      criticalPercent: VMWARE_DATASTORE_CRITICAL_PERCENT,
      isPastLineOnly: true,
    });
    expect(
      getVMwareVCenterStorageUsage({
        datastoreUsedBytes: "9100000000000",
        datastoreCapacityBytes: "10000000000000",
      }),
    ).toMatchObject({ usedPercent: 91, level: StorageUsageLevel.Critical });
    expect(
      getVMwareVCenterStorageUsage({
        datastoreUsedBytes: 10,
        datastoreCapacityBytes: null,
      }),
    ).toBe(null);
  });

  /*
   * A thick-provisioned disk takes all of its datastore space from the
   * start: a full bar is how such a VM always reads, never a problem.
   */
  test("a VM's storage bar stays calm at any level", () => {
    const full: StorageUsage | null = getVMwareVmStorageUsage({
      usedBytes: 100 * GIB,
      provisionedBytes: 100 * GIB,
    });

    expect(full).toMatchObject({
      usedPercent: 100,
      level: StorageUsageLevel.Normal,
    });
    expect(
      getVMwareVmStorageUsage({ usedBytes: null, provisionedBytes: 100 }),
    ).toBe(null);
  });
});

describe("OpenStack", () => {
  test("a pool reads what its backend says is taken of its capacity, at 85% and 95% past the line", () => {
    expect(OPENSTACK_STORAGE_POOL_USAGE_THRESHOLDS).toEqual({
      warningPercent: OPENSTACK_STORAGE_POOL_WARNING_PERCENT,
      criticalPercent: OPENSTACK_STORAGE_POOL_CRITICAL_PERCENT,
      isPastLineOnly: true,
    });
    expect(
      getOpenStackStoragePoolUsage({
        allocatedBytes: 900 * GIB,
        capacityBytes: 1000 * GIB,
      }),
    ).toMatchObject({ free: 100 * GIB, level: StorageUsageLevel.Warning });
    expect(
      levelOf(
        getOpenStackStoragePoolUsage({
          allocatedBytes: 85,
          capacityBytes: 100,
        }),
      ),
    ).toBe(StorageUsageLevel.Normal);
  });

  test("a database's volume is nearly full at Trove's line, as its rule reads it", () => {
    expect(OPENSTACK_DATABASE_VOLUME_USAGE_THRESHOLDS).toEqual({
      warningPercent: OPENSTACK_DATABASE_VOLUME_WARNING_PERCENT,
      criticalPercent: OPENSTACK_STORAGE_POOL_CRITICAL_PERCENT,
    });

    const at85: StorageUsage | null = getOpenStackDatabaseVolumeUsage({
      usedBytes: 85,
      sizeBytes: 100,
    });
    expect(at85?.level).toBe(StorageUsageLevel.Warning);
    expect(
      isOpenStackDatabaseVolumeNearlyFull({ usedBytes: 85, sizeBytes: 100 }),
    ).toBe(true);
  });

  test("an instance that isn't running says 0, recorded: no reading", () => {
    expect(
      getOpenStackDatabaseVolumeUsage({ usedBytes: 0, sizeBytes: 10 * GIB }),
    ).toBe(null);
  });
});

describe("storage arrays", () => {
  test("the array and a bucket turn at Pure's own 80% and 90%", () => {
    expect(STORAGE_ARRAY_CAPACITY_USAGE_THRESHOLDS).toEqual({
      warningPercent: STORAGE_ARRAY_CAPACITY_WARNING_PERCENT,
      criticalPercent: STORAGE_ARRAY_CAPACITY_CRITICAL_PERCENT,
    });
    expect(STORAGE_ARRAY_CAPACITY_USAGE_THRESHOLDS).toEqual(
      DEFAULT_STORAGE_USAGE_THRESHOLDS,
    );
  });

  test("the array reads its own percent, with its capacity's amounts when it has one", () => {
    expect(
      getStorageArrayCapacityUsage({
        capacityBytes: 100 * GIB,
        usedBytes: 49 * GIB,
        capacityUsedPercent: 50,
      }),
    ).toMatchObject({
      capacity: 100 * GIB,
      used: 50 * GIB,
      usedPercent: 50,
    });
    expect(
      getStorageArrayCapacityUsage({
        capacityBytes: null,
        usedBytes: null,
        capacityUsedPercent: 85,
      }),
    ).toMatchObject({
      capacity: 100,
      used: 85,
      level: StorageUsageLevel.Warning,
    });
    expect(
      getStorageArrayCapacityUsage({
        capacityBytes: 100 * GIB,
        usedBytes: 30 * GIB,
        capacityUsedPercent: null,
      })?.usedPercent,
    ).toBe(30);
  });

  /*
   * What clients stored (its virtual space, before data reduction), against
   * its quota: never less full than the bucket is.
   */
  test("a bucket reads what it stores against its quota", () => {
    const bucket: StorageArrayResource = storageArrayPart({
      kind: "Bucket",
      capacityBytes: 100 * GIB,
      usedBytes: 20 * GIB,
      details: { virtualBytes: 92 * GIB },
    });

    expect(getStorageArrayBucketUsage(bucket)).toMatchObject({
      used: 92 * GIB,
      free: 8 * GIB,
      level: StorageUsageLevel.Critical,
    });
  });

  test("a bucket with no quota, or no size yet, says which in words", () => {
    const noQuota: StorageArrayResource = storageArrayPart({
      kind: "Bucket",
      capacityBytes: 0,
      details: { virtualBytes: 5 },
    });
    const notReported: StorageArrayResource = storageArrayPart({
      kind: "Bucket",
      capacityBytes: 100,
      details: {},
    });

    expect(getStorageArrayBucketUsage(noQuota)).toBe(null);
    expect(getStorageArrayBucketNoUsageText(noQuota)).toBe("No quota");
    expect(getStorageArrayBucketUsage(notReported)).toBe(null);
    expect(getStorageArrayBucketNoUsageText(notReported)).toBe("Not reported");
  });

  test("a bucket nearly at its quota needs a look, and almost out of it is critical", () => {
    const bucket: (stored: number) => StorageArrayAssessment = (
      stored: number,
    ): StorageArrayAssessment => {
      return assessStorageArrayPart(
        storageArrayPart({
          kind: "Bucket",
          name: "logs",
          capacityBytes: 100,
          details: { virtualBytes: stored },
        }),
      );
    };

    expect(bucket(70).severity).toBe(null);
    expect(bucket(85)).toMatchObject({
      severity: ResourceAttentionSeverity.Warning,
      status: { label: "Near full", tone: "warning" },
      reasons: [
        { text: "{{percent}} of its quota used", values: { percent: "85%" } },
      ],
    });
    expect(bucket(95)).toMatchObject({
      severity: ResourceAttentionSeverity.Critical,
      status: { tone: "danger" },
    });
  });

  test("a file system reads its provisioned size and the share still available, amber past 90% and never red", () => {
    const at: (availableRatio: number) => StorageUsage | null = (
      availableRatio: number,
    ): StorageUsage | null => {
      return getStorageArrayFileSystemUsage({
        provisionedBytes: 10 * GIB,
        availableRatio: availableRatio,
      });
    };

    expect(at(0.25)).toMatchObject({
      used: 7.5 * GIB,
      free: 2.5 * GIB,
      level: StorageUsageLevel.Normal,
    });
    expect(at(FILE_SYSTEM_NEAR_FULL_AVAILABLE_RATIO)?.level).toBe(
      StorageUsageLevel.Normal,
    );
    expect(at(0.05)?.level).toBe(StorageUsageLevel.Warning);
    expect(at(0)?.level).toBe(StorageUsageLevel.Warning);
    expect(
      getStorageArrayFileSystemUsage({
        provisionedBytes: 10 * GIB,
        availableRatio: null,
      }),
    ).toBe(null);
  });
});

describe("cloud stores", () => {
  test("the storage rule's lines, at them", () => {
    expect(CLOUD_STORAGE_USAGE_THRESHOLDS).toEqual({
      warningPercent: CLOUD_STORAGE_HIGH_PERCENT,
      criticalPercent: CLOUD_STORAGE_FULL_PERCENT,
    });
  });

  test("an RDS database: what is free of what was allocated", () => {
    const storage: CloudResourceStorage | null = getCloudResourceStorage({
      type: "AWS::RDS::DBInstance",
      properties: { Engine: "postgres", AllocatedStorage: 100 },
      readings: {
        "aws/rds/freestoragespace": {
          value: 8 * GIB,
          time: "2026-11-19T10:00:00.000Z",
        },
      },
    });

    expect(storage?.capacityBytes).toBe(100 * GIB);
    expect(storage?.usage).toMatchObject({
      used: 92 * GIB,
      free: 8 * GIB,
      usedPercent: 92,
      level: StorageUsageLevel.Warning,
    });
    expect(storage?.noUsageText).toBeUndefined();
    // The same reading its rule judges.
    expect(
      getCloudDatabaseStorageUsage({ freeBytes: 4 * GIB, allocatedGib: 100 })
        ?.level,
    ).toBe(StorageUsageLevel.Critical);
  });

  test("an RDS database with no free-space reading yet says its size and Not reported", () => {
    expect(
      getCloudResourceStorage({
        type: "AWS::RDS::DBInstance",
        properties: { AllocatedStorage: "20" },
        readings: {},
      }),
    ).toEqual({
      usage: null,
      capacityBytes: 20 * GIB,
      noUsageText: CLOUD_STORAGE_NOT_REPORTED,
    });
  });

  test("an Aurora instance keeps its data in its cluster's volume: nothing to fill", () => {
    expect(
      getCloudResourceStorage({
        type: "AWS::RDS::DBInstance",
        properties: { Engine: "aurora-postgresql", AllocatedStorage: 1 },
        readings: {},
      }),
    ).toBe(null);
  });

  /*
   * How much of a disk is used is known only inside the machine it is
   * attached to: its page says its size, and says so.
   */
  test.each([
    ["AWS::EC2::Volume", { Size: 100, VolumeType: "gp3" }],
    ["Microsoft.Compute/disks", { diskSizeGB: 100, skuName: "Premium_LRS" }],
  ])(
    "a %s says its size and that its use is known only in its guest",
    (type: string, properties: Record<string, unknown>) => {
      expect(
        getCloudResourceStorage({ type, properties, readings: {} }),
      ).toEqual({
        usage: null,
        capacityBytes: 100 * GIB,
        noUsageText: CLOUD_DISK_USAGE_INSIDE_GUEST,
      });
    },
  );

  test("a store whose size its cloud did not give, and any other type, have nothing to draw", () => {
    expect(
      getCloudResourceStorage({
        type: "AWS::EC2::Volume",
        properties: {},
        readings: {},
      }),
    ).toBe(null);
    expect(
      getCloudResourceStorage({
        type: "AWS::S3::Bucket",
        properties: { Size: 100 },
        readings: {},
      }),
    ).toBe(null);
  });
});
