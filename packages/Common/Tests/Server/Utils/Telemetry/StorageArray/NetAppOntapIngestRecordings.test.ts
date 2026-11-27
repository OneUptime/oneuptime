import { describe, expect, test } from "@jest/globals";
import {
  NETAPP_RECORDING_TIME_MS,
  NetAppCollectorProcessing,
  NetAppIngestOutcome,
  NetAppRecording,
  ingestNetAppRecording,
  ingestNetAppSeries,
  readNetAppCollectorProcessing,
  readNetAppRecording,
  rowOf,
  rowsOf,
  whatTheAgentSends,
} from "../../../../Helpers/StorageArray/NetAppHarvestRecordings";
import { CapturedSeries } from "../../../../Helpers/StorageArray/OpenMetricsCapture";
import { StorageArrayResourceBufferEntry } from "../../../../../Server/Utils/Telemetry/StorageArraySnapshotScan";
import StorageArrayStatusUtil from "../../../../../Types/StorageArray/StorageArrayStatusUtil";
import StorageArrayPlatformRegistry from "../../../../../Types/StorageArray/StorageArrayPlatformRegistry";
import NetAppOntapPlatform from "../../../../../Types/StorageArray/Platforms/NetApp/ONTAP/OntapPlatform";
import {
  ONTAP_FSX_OS_NAME,
  ONTAP_OS_NAME,
  OntapKind,
} from "../../../../../Types/StorageArray/Platforms/NetApp/NetApp";
import {
  ONTAP_KIND_SOURCES,
  getNodeProblems,
  getSensorStatus,
  isFsxClusterName,
  parseDiskPlace,
  parseOntapVersion,
} from "../../../../../Server/Utils/Telemetry/StorageArray/NetApp/OntapExtractor";
import StorageArrayResourceKind from "../../../../../Types/StorageArray/StorageArrayResourceKind";
import { StorageArrayManagedDeployment } from "../../../../../Types/StorageArray/StorageArrayPlatform";

/*
 * WHAT AN ONTAP CLUSTER BECOMES IN ONEUPTIME, FROM WHAT NETAPP HARVEST
 * REALLY SERVED (#11001).
 *
 * Tests/Fixtures/NetAppHarvest/26.11.0 is the real Harvest 26.11.0's own
 * /metrics, recorded with the agent's shipped files against a stand-in
 * ONTAP 9.16.1 cluster and a stand-in Amazon FSx file system (its README
 * says exactly what was not real: every value, the FSx answers, the EMS
 * wording). Each recording goes through what the agent's collector does to
 * it (read from the shipped otel-collector-config.netapp-ontap.yaml) and
 * then the scan, as OtelMetricsIngestService runs it, and what reaches
 * Postgres is held to the scenario the stand-in played: the cluster's
 * identity and capacity, its open problems, and every node, aggregate,
 * SVM, volume, LUN, SnapMirror relationship, disk, shelf part, sensor and
 * port with its state.
 */

const TIB: number = 1024 * 1024 * 1024 * 1024;

const ONTAP: NetAppIngestOutcome = ingestNetAppRecording("ontap.prom");
const FSX: NetAppIngestOutcome = ingestNetAppRecording("fsx.prom");

function namesOf(rows: Array<StorageArrayResourceBufferEntry>): Array<string> {
  return rows
    .map((row: StorageArrayResourceBufferEntry): string => {
      return row.name || row.externalId;
    })
    .sort();
}

function sent(file: NetAppRecording): Array<CapturedSeries> {
  return whatTheAgentSends(readNetAppRecording(file));
}

describe("what the agent's collector sends of Harvest's scrape", () => {
  const processing: NetAppCollectorProcessing = readNetAppCollectorProcessing();

  test("it reads the shipped config's drop rules, job label and schedules", () => {
    expect(processing.jobLabels).toEqual({ scrape_endpoint: "harvest" });
    expect(processing.dropped.length).toBeGreaterThanOrEqual(2);
    expect(processing.scheduleSeconds.get("hourly")).toBe(3600);
    expect(processing.scheduleSeconds.get("daily")).toBe(86400);
    expect(processing.scheduleSeconds.get("5min")).toBe(300);
    expect(processing.scheduleSeconds.get("weekly")).toBe(604800);
  });

  test("Harvest's measurements of itself and each disk partition's performance stay behind", () => {
    const raw: Array<string> = whatTheAgentSends("").map(
      (series: CapturedSeries): string => {
        return series.name;
      },
    );
    expect(raw).toEqual([]);
    const names: Set<string> = new Set(
      sent("ontap.prom").map((series: CapturedSeries): string => {
        return series.name;
      }),
    );
    for (const gone of [
      "netapp_metadata_collector_api_time",
      "netapp_metadata_collector_poll_time",
      "netapp_poller_memory",
      "netapp_aggr_disk_busy",
      "netapp_raid_disk_busy",
      "netapp_plex_disk_busy",
      "netapp_node_disk_busy",
      "netapp_aggr_disk_max_busy",
    ]) {
      expect({ gone, sent: names.has(gone) }).toEqual({ gone, sent: false });
    }
    // What says which objects Harvest read stays.
    for (const kept of [
      "netapp_metadata_collector_instances",
      "netapp_metadata_component_status",
      "netapp_metadata_target_status",
      "netapp_cluster_new_status",
      "netapp_shelf_psu_status",
    ]) {
      expect({ kept, sent: names.has(kept) }).toEqual({ kept, sent: true });
    }
  });

  test("a relationship on a schedule gets its seconds, a synchronous one none", () => {
    const schedules: Array<[string, number]> = sent("ontap.prom")
      .filter((series: CapturedSeries): boolean => {
        return series.name === "netapp_snapmirror_schedule_seconds";
      })
      .map((series: CapturedSeries): [string, number] => {
        return [series.labels["destination_location"] || "", series.value];
      })
      .sort();
    expect(schedules).toEqual([
      ["svm_dr:vol_erp_dr", 3600],
      ["svm_dr:vol_home_dr", 86400],
      ["svm_dr:vol_web_dr", 3600],
    ]);
  });

  test("every series the scan reads is an ONTAP one, and the scrape's own series are not read", () => {
    expect(ONTAP.readSeries.length).toBeGreaterThan(60);
    for (const name of ONTAP.readSeries) {
      expect(name.startsWith("netapp_")).toBe(true);
    }
    for (const notRead of [
      "up",
      "scrape_duration_seconds",
      "netapp_ems_events",
    ]) {
      expect(ONTAP.readSeries).not.toContain(notRead);
    }
  });

  test("the EMS events: raised for one poll, a cleared bookend exported once as 0, then gone", () => {
    const events: (file: NetAppRecording) => Array<[string, number]> = (
      file: NetAppRecording,
    ): Array<[string, number]> => {
      return sent(file)
        .filter((series: CapturedSeries): boolean => {
          return series.name === "netapp_ems_events";
        })
        .map((series: CapturedSeries): [string, number] => {
          return [series.labels["message"] || "", series.value];
        })
        .sort();
    };
    expect(events("ontap.prom")).toEqual([
      ["disk.outOfService", 1],
      ["monitor.fan.failed", 1],
    ]);
    expect(events("ontap-ems-cleared.prom")).toEqual([
      ["monitor.fan.failed", 0],
    ]);
    expect(events("ontap-ems-after.prom")).toEqual([]);
    expect(events("fsx.prom")).toEqual([]);
  });
});

describe("an ONTAP cluster", () => {
  test("is named, versioned and identified by its own series", () => {
    expect(ONTAP.extras.storageSystem).toBe("netapp.ontap");
    expect(ONTAP.extras.reportedName).toBe("ontap-prod-01");
    expect(ONTAP.extras.systemId).toBe("9f2c1a4e-0b7d-11ee-9d3a-00a098d7c5f1");
    expect(ONTAP.extras.osName).toBe(ONTAP_OS_NAME);
    expect(ONTAP.extras.osVersion).toBe("9.16.1P3");
  });

  test("its capacity is its two data aggregates', summed, and its data reduction theirs", () => {
    const aggregates: Array<StorageArrayResourceBufferEntry> = rowsOf(
      ONTAP,
      OntapKind.Aggregate,
    );
    const capacity: number = aggregates.reduce(
      (sum: number, row: StorageArrayResourceBufferEntry): number => {
        return sum + (row.capacityBytes || 0);
      },
      0,
    );
    expect(ONTAP.extras.capacityBytes).toBe(capacity);
    expect((ONTAP.extras.capacityBytes as number) / TIB).toBeCloseTo(92, 0);
    expect(ONTAP.extras.capacityUsedPercent).toBeCloseTo(87.5, 1);
    expect(ONTAP.extras.dataReductionRatio).toBeCloseTo(2.6, 2);
  });

  test("its open problems are ONTAP's: a broken disk, a shelf fault, a port down and a system health alert", () => {
    expect(Array.from(ONTAP.snapshot!.openAlertKeys).sort()).toEqual([
      "netapp_health_disk_alerts|1.0.7",
      "netapp_health_network_ethernet_port_alerts|ontap-prod-01-01|e0c",
      "netapp_health_shelf_alerts|1.0|power",
      "netapp_health_support_alerts|ontap-prod-01-02|DualPathToDiskShelf_Alert|Shelf ID 1.0",
    ]);
    expect(ONTAP.extras.openAlertCount).toBe(4);
    expect(ONTAP.extras.criticalAlertCount).toBe(3);
    expect(ONTAP.extras.warningAlertCount).toBe(1);
    expect(ONTAP.snapshot!.sawAlerts).toBe(true);
  });

  test("every kind is counted, each once Harvest listed all of its objects", () => {
    expect(ONTAP.countsByKind).toEqual({
      [OntapKind.Aggregate]: 2,
      [StorageArrayResourceKind.Controller]: 2,
      [StorageArrayResourceKind.Drive]: 12,
      [StorageArrayResourceKind.Hardware]: 35,
      [OntapKind.Lun]: 2,
      [StorageArrayResourceKind.NetworkInterface]: 11,
      [OntapKind.SnapMirror]: 4,
      [OntapKind.Svm]: 4,
      [StorageArrayResourceKind.Volume]: 8,
    });
    expect(ONTAP.extras.volumeCount).toBe(8);
    expect(ONTAP.extras.hardwareComponentCount).toBe(35);
  });

  test("its nodes: model, release, HA partner, CPU, and the failed fan of -02", () => {
    const first: StorageArrayResourceBufferEntry = rowOf(
      ONTAP,
      StorageArrayResourceKind.Controller,
      "ontap-prod-01-01",
    )!;
    const second: StorageArrayResourceBufferEntry = rowOf(
      ONTAP,
      StorageArrayResourceKind.Controller,
      "ontap-prod-01-02",
    )!;
    expect(first).toMatchObject({
      status: "healthy",
      model: "AFF-A400",
      firmwareVersion: "9.16.1P3",
      componentType: "Node",
    });
    expect(first.details).toMatchObject({
      haPartner: "ontap-prod-01-02",
      cpuBusyPercent: 35,
      failedFans: 0,
      failedPowerSupplies: 0,
    });
    expect(first.statusDetail).toBeNull();
    expect((first.details["uptimeSeconds"] as number) / 86400).toBeCloseTo(
      120,
      0,
    );
    expect(second).toMatchObject({
      status: "degraded",
      statusDetail: "Fan 2 is not operating within the recommended RPM range.",
    });
    expect(second.details).toMatchObject({
      haPartner: "ontap-prod-01-01",
      cpuBusyPercent: 62,
      failedFans: 1,
      statusReason: "Fan 2 is not operating within the recommended RPM range.",
    });
  });

  test("its aggregates, without the root aggregates Harvest leaves out", () => {
    expect(namesOf(rowsOf(ONTAP, OntapKind.Aggregate))).toEqual([
      "aggr1_n01",
      "aggr1_n02",
    ]);
    const full: StorageArrayResourceBufferEntry = rowOf(
      ONTAP,
      OntapKind.Aggregate,
      "aggr1_n02",
    )!;
    expect(full).toMatchObject({
      status: "online",
      componentType: "SSD",
      groupName: "ontap-prod-01-02",
    });
    expect((full.usedBytes! / full.capacityBytes!) * 100).toBeCloseTo(93, 0);
    expect(full.dataReductionRatio).toBeCloseTo(2.6, 2);
    expect(full.readLatencyUsec).toBeGreaterThan(0);
    expect(full.readIops).toBeGreaterThan(0);
    expect(full.details["availableBytes"]).toBeGreaterThan(0);
  });

  test("its SVMs, without the ones ONTAP keeps for itself; a stopped one says so", () => {
    expect(namesOf(rowsOf(ONTAP, OntapKind.Svm))).toEqual([
      "svm_dr",
      "svm_nas",
      "svm_san",
      "svm_test",
    ]);
    expect(rowOf(ONTAP, OntapKind.Svm, "svm_test")!.status).toBe("stopped");
    expect(rowOf(ONTAP, OntapKind.Svm, "svm_nas")).toMatchObject({
      status: "running",
      componentType: "data",
    });
    expect(rowOf(ONTAP, OntapKind.Svm, "svm_nas")!.details["protocols"]).toBe(
      "NFS, SMB",
    );
    expect(
      rowOf(ONTAP, OntapKind.Svm, "svm_san")!.readLatencyUsec,
    ).toBeGreaterThan(0);
  });

  test("its volumes, each named in its SVM, with its aggregate, state, fill and latency", () => {
    expect(
      rowsOf(ONTAP, StorageArrayResourceKind.Volume).map(
        (row: StorageArrayResourceBufferEntry): string => {
          return row.externalId;
        },
      ),
    ).toEqual([
      "svm_dr:vol_erp_dr",
      "svm_dr:vol_home_dr",
      "svm_dr:vol_web_dr",
      "svm_nas:svm_nas_root",
      "svm_nas:vol_home",
      "svm_nas:vol_logs",
      "svm_nas:vol_projects",
      "svm_san:vol_db",
    ]);
    const projects: StorageArrayResourceBufferEntry = rowOf(
      ONTAP,
      StorageArrayResourceKind.Volume,
      "svm_nas:vol_projects",
    )!;
    expect(projects).toMatchObject({
      name: "vol_projects",
      groupName: "svm_nas",
      status: "online",
      componentType: "RW",
      readLatencyUsec: 7500,
    });
    expect(projects.details).toMatchObject({
      aggregate: "aggr1_n02",
      usedPercent: 96,
    });
    expect((projects.capacityBytes as number) / TIB).toBeCloseTo(19, 0);
    expect(
      rowOf(ONTAP, StorageArrayResourceKind.Volume, "svm_nas:vol_logs")!.status,
    ).toBe("offline");
    expect(
      rowOf(ONTAP, StorageArrayResourceKind.Volume, "svm_dr:vol_web_dr")!
        .componentType,
    ).toBe("DP");
  });

  test("its LUNs, by SVM, volume and name, and the offline one", () => {
    expect(
      rowsOf(ONTAP, OntapKind.Lun).map(
        (row: StorageArrayResourceBufferEntry): [string, string | null] => {
          return [row.externalId, row.status];
        },
      ),
    ).toEqual([
      ["svm_san:/vol/vol_db/lun_db01", "online"],
      ["svm_san:/vol/vol_db/lun_db02", "offline"],
    ]);
    const lun: StorageArrayResourceBufferEntry = rowOf(
      ONTAP,
      OntapKind.Lun,
      "svm_san:/vol/vol_db/lun_db01",
    )!;
    expect(lun).toMatchObject({
      name: "/vol/vol_db/lun_db01",
      groupName: "svm_san",
    });
    expect(lun.details).toMatchObject({ lun: "lun_db01", volume: "vol_db" });
    expect(lun.readIops).toBeGreaterThan(0);
    expect((lun.capacityBytes as number) / TIB).toBeCloseTo(2, 1);
  });

  test("its SnapMirror relationships: lag, schedule, and why one is unhealthy", () => {
    const relationships: Array<
      [string | null, string | null, number | null, unknown]
    > = rowsOf(ONTAP, OntapKind.SnapMirror)
      .map(
        (
          row: StorageArrayResourceBufferEntry,
        ): [string | null, string | null, number | null, unknown] => {
          return [
            row.name,
            row.status,
            row.replicationLagMs,
            row.details["scheduleSeconds"],
          ];
        },
      )
      .sort(
        (
          a: [string | null, ...Array<unknown>],
          b: [string | null, ...Array<unknown>],
        ): number => {
          return String(a[0]).localeCompare(String(b[0]));
        },
      );
    expect(relationships).toEqual([
      ["svm_dr:vol_db_sync", "healthy", 0, undefined],
      ["svm_dr:vol_erp_dr", "unhealthy", 11404000, 3600],
      ["svm_dr:vol_home_dr", "healthy", 21761000, 86400],
      ["svm_dr:vol_web_dr", "healthy", 1512000, 3600],
    ]);
    const failed: StorageArrayResourceBufferEntry = rowsOf(
      ONTAP,
      OntapKind.SnapMirror,
    ).find((row: StorageArrayResourceBufferEntry): boolean => {
      return row.name === "svm_dr:vol_erp_dr";
    })!;
    expect(failed.statusDetail).toBe("Transfer failed.");
    expect(failed.details).toMatchObject({
      statusReason: "Transfer failed.",
      source: "svm_erp:vol_erp",
      sourceCluster: "ontap-edge-01",
      schedule: "hourly",
    });
  });

  test("its disks: in shelf 1.0, one broken with ONTAP's reason, one spare", () => {
    const disks: Array<StorageArrayResourceBufferEntry> = rowsOf(
      ONTAP,
      StorageArrayResourceKind.Drive,
    );
    expect(disks).toHaveLength(12);
    for (const disk of disks) {
      expect(disk.groupName).toBe("1.0");
      expect(disk.model).toBe("X4011WBORA3T8NTF");
      expect(disk.componentType).toBe("SSD");
    }
    const broken: StorageArrayResourceBufferEntry = rowOf(
      ONTAP,
      StorageArrayResourceKind.Drive,
      "1.0.7",
    )!;
    expect(broken).toMatchObject({ status: "broken", statusDetail: "Failed" });
    expect(broken.details).toMatchObject({
      shelfBay: "1.0 / 7",
      ownerNode: "ontap-prod-01-01",
      statusReason: "Failed",
    });
    expect(rowOf(ONTAP, StorageArrayResourceKind.Drive, "1.0.11")!.status).toBe(
      "spare",
    );
  });

  test("its shelf and every part of it, PSU 2 in error", () => {
    const hardware: Array<StorageArrayResourceBufferEntry> = rowsOf(
      ONTAP,
      StorageArrayResourceKind.Hardware,
    );
    const shelfParts: Array<[string, string | null, string | null]> = hardware
      .filter((row: StorageArrayResourceBufferEntry): boolean => {
        return row.groupName === "1.0" || row.externalId === "1.0";
      })
      .map(
        (
          row: StorageArrayResourceBufferEntry,
        ): [string, string | null, string | null] => {
          return [row.externalId, row.componentType, row.status];
        },
      );
    expect(shelfParts).toEqual([
      ["1.0", "Shelf", "online"],
      ["1.0 Current 1", "Current Sensor", "normal"],
      ["1.0 Fan 1", "Fan", "normal"],
      ["1.0 Fan 2", "Fan", "normal"],
      ["1.0 Fan 3", "Fan", "normal"],
      ["1.0 Fan 4", "Fan", "normal"],
      ["1.0 Module A", "Module", "normal"],
      ["1.0 Module B", "Module", "normal"],
      ["1.0 PSU 1", "Power Supply", "normal"],
      ["1.0 PSU 2", "Power Supply", "error"],
      ["1.0 Temperature 1", "Temperature Sensor", "normal"],
      ["1.0 Temperature 2", "Temperature Sensor", "normal"],
      ["1.0 Temperature 3", "Temperature Sensor", "normal"],
      ["1.0 Temperature 4", "Temperature Sensor", "normal"],
      ["1.0 Voltage 1", "Voltage Sensor", "normal"],
    ]);
    expect(
      rowOf(ONTAP, StorageArrayResourceKind.Hardware, "1.0"),
    ).toMatchObject({
      model: "NS224",
    });
    expect(
      rowOf(ONTAP, StorageArrayResourceKind.Hardware, "1.0")!.details,
    ).toMatchObject({ moduleType: "NSM100", diskCount: 12 });
    expect(
      rowOf(ONTAP, StorageArrayResourceKind.Hardware, "1.0 Temperature 2")!
        .temperatureCelsius,
    ).toBe(31);
  });

  test("its nodes' sensors: a fan below its critical threshold is critical, with its reading", () => {
    const sensors: Array<StorageArrayResourceBufferEntry> = rowsOf(
      ONTAP,
      StorageArrayResourceKind.Hardware,
    ).filter((row: StorageArrayResourceBufferEntry): boolean => {
      return row.componentType === "Sensor";
    });
    expect(sensors).toHaveLength(20);
    const fan: StorageArrayResourceBufferEntry = rowOf(
      ONTAP,
      StorageArrayResourceKind.Hardware,
      "ontap-prod-01-02 System Fan 2",
    )!;
    expect(fan).toMatchObject({
      status: "critical",
      groupName: "ontap-prod-01-02",
    });
    expect(fan.details).toMatchObject({
      sensorType: "fan",
      reading: "1200 RPM",
      thresholdState: "crit_low",
      statusReason: "crit_low, 1200 RPM",
    });
    for (const sensor of sensors) {
      if (sensor !== fan) {
        expect({ sensor: sensor.externalId, status: sensor.status }).toEqual({
          sensor: sensor.externalId,
          status: "normal",
        });
      }
    }
  });

  test("its ports: e0c down, the rest up at their speed, FC 0d losing its link", () => {
    const ports: Array<[string, string | null, string | null]> = rowsOf(
      ONTAP,
      StorageArrayResourceKind.NetworkInterface,
    ).map(
      (
        row: StorageArrayResourceBufferEntry,
      ): [string, string | null, string | null] => {
        return [row.externalId, row.componentType, row.status];
      },
    );
    expect(ports).toEqual([
      ["ontap-prod-01-01:0c", "Fibre Channel", "online"],
      ["ontap-prod-01-01:0d", "Fibre Channel", "online"],
      ["ontap-prod-01-01:e0a", "Ethernet", "up"],
      ["ontap-prod-01-01:e0b", "Ethernet", "up"],
      ["ontap-prod-01-01:e0c", "Ethernet", "down"],
      ["ontap-prod-01-01:e0M", "Ethernet", "up"],
      ["ontap-prod-01-02:0c", "Fibre Channel", "online"],
      ["ontap-prod-01-02:0d", "Fibre Channel", "online"],
      ["ontap-prod-01-02:e0a", "Ethernet", "up"],
      ["ontap-prod-01-02:e0b", "Ethernet", "up"],
      ["ontap-prod-01-02:e0M", "Ethernet", "up"],
    ]);
    const e0a: StorageArrayResourceBufferEntry = rowOf(
      ONTAP,
      StorageArrayResourceKind.NetworkInterface,
      "ontap-prod-01-01:e0a",
    )!;
    // 25 Gb/s in bytes per second, and traffic both ways.
    expect(e0a.details["speedBytesPerSec"]).toBe(3125000000);
    expect(e0a.details["receivedBytesPerSec"]).toBeGreaterThan(0);
    expect(e0a.details["transmittedBytesPerSec"]).toBeGreaterThan(0);
    const fc: StorageArrayResourceBufferEntry = rowOf(
      ONTAP,
      StorageArrayResourceKind.NetworkInterface,
      "ontap-prod-01-01:0d",
    )!;
    expect(fc.details["linkFailures"]).toBeGreaterThan(0);
    expect(fc.details["errorsPerSec"]).toBeGreaterThan(0);
  });

  test("every state the rows carry is a word the status lists know", () => {
    const words: Set<string> = new Set();
    for (const outcome of [ONTAP, FSX]) {
      for (const row of outcome.rows) {
        if (row.status) {
          words.add(row.status);
        }
      }
    }
    /*
     * A port that is down is no problem by itself - nothing may be cabled
     * to it, as on a PowerStore - so its word is in no list: ONTAP's health
     * monitor raises the ones that are (Ethernet Port Down).
     */
    const NEUTRAL: Array<string> = ["down"];
    for (const word of words) {
      expect({
        word,
        known:
          NEUTRAL.includes(word) ||
          StorageArrayStatusUtil.isCritical(word) ||
          StorageArrayStatusUtil.isWarning(word) ||
          StorageArrayStatusUtil.isHealthy(word),
      }).toEqual({ word, known: true });
    }
    expect({
      problem:
        StorageArrayStatusUtil.isCritical("down") ||
        StorageArrayStatusUtil.isWarning("down"),
    }).toEqual({ problem: false });
    // And the troubles of the day read as troubles.
    for (const word of [
      "broken",
      "error",
      "critical",
      "offline",
      "unhealthy",
    ]) {
      expect({
        word,
        critical: StorageArrayStatusUtil.isCritical(word),
      }).toEqual({
        word,
        critical: true,
      });
    }
    for (const word of ["degraded", "stopped"]) {
      expect({ word, warning: StorageArrayStatusUtil.isWarning(word) }).toEqual(
        {
          word,
          warning: true,
        },
      );
    }
  });

  test("the polls after the EMS events clear read the same inventory", () => {
    for (const file of [
      "ontap-ems-cleared.prom",
      "ontap-ems-after.prom",
    ] as Array<NetAppRecording>) {
      const later: NetAppIngestOutcome = ingestNetAppRecording(file);
      expect({ file, counts: later.countsByKind }).toEqual({
        file,
        counts: ONTAP.countsByKind,
      });
      expect(later.extras.openAlertCount).toBe(4);
    }
  });
});

describe("an Amazon FSx for NetApp ONTAP file system", () => {
  test("reads as FSx, by its file system's name", () => {
    expect(FSX.extras.reportedName).toBe("FsxId0a1b2c3d4e5f6a7b8");
    expect(FSX.extras.osName).toBe(ONTAP_FSX_OS_NAME);
    expect(FSX.extras.osVersion).toBe("9.15.1P7");
    expect(isFsxClusterName("FsxId0a1b2c3d4e5f6a7b8")).toBe(true);
    expect(isFsxClusterName("ontap-prod-01")).toBe(false);
    expect(isFsxClusterName("FsxId0a1b2c3d4e5f6a7b")).toBe(false);
  });

  test("counts what it has, 0 of what AWS runs for it, and has no hardware rows", () => {
    expect(FSX.countsByKind).toEqual({
      [OntapKind.Aggregate]: 1,
      [StorageArrayResourceKind.Controller]: 2,
      [StorageArrayResourceKind.Drive]: 0,
      [StorageArrayResourceKind.Hardware]: 0,
      [OntapKind.Lun]: 0,
      [StorageArrayResourceKind.NetworkInterface]: 2,
      [OntapKind.SnapMirror]: 0,
      [OntapKind.Svm]: 2,
      [StorageArrayResourceKind.Volume]: 3,
    });
    expect(rowsOf(FSX, StorageArrayResourceKind.Drive)).toEqual([]);
    expect(rowsOf(FSX, StorageArrayResourceKind.Hardware)).toEqual([]);
    expect(namesOf(rowsOf(FSX, OntapKind.Svm))).toEqual(["fsx", "svm_files"]);
    expect(FSX.extras.openAlertCount).toBe(0);
    expect(FSX.extras.capacityUsedPercent).toBeCloseTo(40, 1);
  });

  test("its Hardware tab leaves out the tables it has no parts for, and says why", () => {
    const deployment: StorageArrayManagedDeployment | null =
      StorageArrayPlatformRegistry.getManagedDeployment(
        "netapp.ontap",
        FSX.extras.osName as string,
      );
    expect(deployment?.kinds).toEqual([
      StorageArrayResourceKind.Drive,
      StorageArrayResourceKind.Hardware,
    ]);
    expect(deployment?.note).toContain("AWS");
    expect(
      StorageArrayPlatformRegistry.getManagedDeployment(
        "netapp.ontap",
        ONTAP.extras.osName as string,
      ),
    ).toBeNull();
  });

  test("a cluster that is not FSx keeps a kind Harvest could not read uncounted", () => {
    // The FSx scrape, its cluster renamed: the refused disks are now unread.
    const renamed: Array<CapturedSeries> = sent("fsx.prom").map(
      (series: CapturedSeries): CapturedSeries => {
        return series.labels["cluster"]
          ? {
              ...series,
              labels: { ...series.labels, cluster: "ontap-dr-02" },
            }
          : series;
      },
    );
    const outcome: NetAppIngestOutcome = ingestNetAppSeries(renamed, {
      timeMs: NETAPP_RECORDING_TIME_MS["fsx.prom"],
    });
    expect(outcome.extras.osName).toBe(ONTAP_OS_NAME);
    expect(
      outcome.countsByKind![StorageArrayResourceKind.Drive],
    ).toBeUndefined();
    expect(
      outcome.countsByKind![StorageArrayResourceKind.Hardware],
    ).toBeUndefined();
    expect(
      outcome.countsByKind![StorageArrayResourceKind.NetworkInterface],
    ).toBeUndefined();
    expect(outcome.countsByKind![StorageArrayResourceKind.Volume]).toBe(3);
  });
});

describe("a batch that is not the whole scrape", () => {
  test("volumes without Harvest's word that it listed them count nothing", () => {
    const volumesOnly: Array<CapturedSeries> = sent("ontap.prom").filter(
      (series: CapturedSeries): boolean => {
        return series.name.startsWith("netapp_volume_");
      },
    );
    const outcome: NetAppIngestOutcome = ingestNetAppSeries(volumesOnly, {
      timeMs: NETAPP_RECORDING_TIME_MS["ontap.prom"],
    });
    expect(rowsOf(outcome, StorageArrayResourceKind.Volume)).toHaveLength(8);
    // No count at all: the array's counts stay as they were.
    expect(outcome.countsByKind).toBeNull();
  });

  test("Harvest just started: an object it has not polled yet is not a list of nothing", () => {
    const beforeVolumes: Array<CapturedSeries> = sent("ontap.prom").filter(
      (series: CapturedSeries): boolean => {
        return !(
          series.name.startsWith("netapp_volume_") ||
          (series.name === "netapp_metadata_collector_instances" &&
            series.labels["object"] === "Volume")
        );
      },
    );
    const outcome: NetAppIngestOutcome = ingestNetAppSeries(beforeVolumes, {
      timeMs: NETAPP_RECORDING_TIME_MS["ontap.prom"],
    });
    expect(
      outcome.countsByKind![StorageArrayResourceKind.Volume],
    ).toBeUndefined();
    expect(outcome.countsByKind![OntapKind.Aggregate]).toBe(2);
  });

  test("a volume deleted since the last scrape leaves the count", () => {
    const withoutLogs: Array<CapturedSeries> = sent("ontap.prom").filter(
      (series: CapturedSeries): boolean => {
        return !(
          series.name.startsWith("netapp_volume_") &&
          series.labels["volume"] === "vol_logs"
        );
      },
    );
    const outcome: NetAppIngestOutcome = ingestNetAppSeries(withoutLogs, {
      timeMs: NETAPP_RECORDING_TIME_MS["ontap.prom"],
    });
    expect(outcome.countsByKind![StorageArrayResourceKind.Volume]).toBe(7);
  });

  test("a scrape whose agent declared no platform, or another one, is still ONTAP's", () => {
    for (const declared of [null, "", "purestorage.flasharray"]) {
      const outcome: NetAppIngestOutcome = ingestNetAppRecording("ontap.prom", {
        declaredStorageSystem: declared,
      });
      expect({ declared, system: outcome.extras.storageSystem }).toEqual({
        declared,
        system: "netapp.ontap",
      });
      expect(outcome.countsByKind).toEqual(ONTAP.countsByKind);
    }
  });
});

describe("the extractor's readers", () => {
  test("an ONTAP release from Harvest's version label", () => {
    expect(
      parseOntapVersion(
        "NetApp Release 9.16.1P3: Thu Mar 13 08:24:36 UTC 2025",
      ),
    ).toBe("9.16.1P3");
    expect(parseOntapVersion("NetApp Release 9.12.1")).toBe("9.12.1");
    expect(parseOntapVersion("9.15.1P7")).toBe("9.15.1P7");
    expect(parseOntapVersion("")).toBeNull();
    expect(parseOntapVersion(null)).toBeNull();
    expect(parseOntapVersion("unknown")).toBeNull();
  });

  test("a node's problems among the messages Harvest joins", () => {
    expect(
      getNodeProblems(
        "There are no failed fans.; There are no failed power supplies.; normal",
      ),
    ).toBeNull();
    expect(
      getNodeProblems(
        "Fan 2 is not operating within the recommended RPM range.; There are no failed power supplies.; normal",
      ),
    ).toBe("Fan 2 is not operating within the recommended RPM range.");
    expect(
      getNodeProblems(
        "There are no failed fans.; PSU 1 failed.; over_temperature",
      ),
    ).toBe("PSU 1 failed.; over_temperature");
    expect(getNodeProblems(null)).toBeNull();
    expect(getNodeProblems("")).toBeNull();
  });

  test("a sensor's threshold state as one word, however ONTAP spells it", () => {
    for (const [state, word] of [
      ["normal", "normal"],
      ["NORMAL", "normal"],
      ["crit_low", "critical"],
      ["crit-high", "critical"],
      ["critical_high", "critical"],
      // The shared word, never an alert's severity "warning".
      ["warn_low", "degraded"],
      ["warning-high", "degraded"],
      ["failed", "failed"],
      ["ignored", "ignored"],
    ]) {
      expect({ state, word: getSensorStatus(state!) }).toEqual({ state, word });
    }
  });

  test("a disk's shelf and bay from its name", () => {
    expect(parseDiskPlace("1.0.7")).toEqual({ shelf: "1.0", bay: "7" });
    expect(parseDiskPlace("2.10.23")).toEqual({ shelf: "2.10", bay: "23" });
    expect(parseDiskPlace("1.0.7.P2")).toEqual({ shelf: "1.0", bay: "7" });
    expect(parseDiskPlace("NET-1.1")).toBeNull();
  });

  test("the kinds it completes are the ones the platform says its exporter completes", () => {
    expect(
      ONTAP_KIND_SOURCES.map(
        ([kind]: [string, ReadonlyArray<string>]): string => {
          return kind;
        },
      ).sort(),
    ).toEqual([...(NetAppOntapPlatform.exporterCompletedKinds || [])].sort());
  });
});
