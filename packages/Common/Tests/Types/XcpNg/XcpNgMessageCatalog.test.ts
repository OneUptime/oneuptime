import {
  XCP_NG_ALERTING_PRIORITY_MAX,
  XCP_NG_FEED_PRIORITY_MAX,
  XCP_NG_PERFMON_ALARM_PRIORITY,
  XCP_NG_UNKNOWN_MESSAGE_PRIORITY,
  XcpNgMessageAlert,
  XcpNgMessageDefinition,
  getXcpNgMessageAlert,
  getXcpNgMessageDefinition,
  getXcpNgMessageObjectTypeFromClass,
  getXcpNgMessageSeverityNumber,
  isXcpNgAlertingPriority,
  isXcpNgFeedPriority,
  isXcpNgMessageClearable,
  normalizeXcpNgMessagePriority,
} from "../../../Types/XcpNg/XcpNgMessageCatalog";
import { XcpNgScope } from "../../../Types/XcpNg/XcpNgTelemetry";
import { describe, expect, test } from "@jest/globals";

/*
 * XAPI's messages as OneUptime reads them (#10997). The priorities are held
 * to XAPI's own catalog: every addMessage of ocaml/xapi-consts/
 * api_messages.ml (xen-api master, read on 26 November 2026), as recorded
 * below. Xen Orchestra's REST objects drop the priority, so the catalog is
 * the only source a pool read through Xen Orchestra has.
 */

const RECORDED_API_MESSAGES: ReadonlyArray<[string, number]> = [
  ["HA_STATEFILE_LOST", 2],
  ["HA_HEARTBEAT_APPROACHING_TIMEOUT", 5],
  ["HA_STATEFILE_APPROACHING_TIMEOUT", 5],
  ["HA_XAPI_HEALTHCHECK_APPROACHING_TIMEOUT", 5],
  ["HA_NETWORK_BONDING_ERROR", 3],
  ["HA_POOL_OVERCOMMITTED", 3],
  ["HA_POOL_DROP_IN_PLAN_EXISTS_FOR", 3],
  ["HA_PROTECTED_VM_RESTART_FAILED", 2],
  ["HA_HOST_FAILED", 3],
  ["HA_HOST_WAS_FENCED", 4],
  ["METADATA_LUN_HEALTHY", 4],
  ["METADATA_LUN_BROKEN", 3],
  ["IP_CONFIGURED_PIF_CAN_UNPLUG", 3],
  ["VIF_QOS_FAILED", 3],
  ["VBD_QOS_FAILED", 3],
  ["VCPU_QOS_FAILED", 3],
  ["VM_STARTED", 5],
  ["VM_SHUTDOWN", 5],
  ["VM_REBOOTED", 5],
  ["VM_MIGRATED", 5],
  ["VM_SNAPSHOTTED", 5],
  ["VM_SNAPSHOT_REVERTED", 5],
  ["VM_CHECKPOINTED", 5],
  ["VM_SUSPENDED", 5],
  ["VM_RESUMED", 5],
  ["VM_PAUSED", 5],
  ["VM_UNPAUSED", 5],
  ["VM_CRASHED", 2],
  ["VM_CLONED", 5],
  ["VM_SECURE_BOOT_FAILED", 5],
  ["HOST_SYNC_DATA_FAILED", 3],
  ["HOST_CLOCK_SKEW_DETECTED", 3],
  ["HOST_CLOCK_WENT_BACKWARDS", 1],
  ["POOL_MASTER_TRANSITION", 4],
  ["PBD_PLUG_FAILED_ON_SERVER_START", 3],
  ["ALARM", 1],
  ["WLB_CONSULTATION_FAILED", 3],
  ["WLB_OPTIMIZATION_ALERT", 3],
  ["EXTAUTH_INIT_IN_HOST_FAILED", 2],
  ["EXTAUTH_IN_POOL_IS_NON_HOMOGENEOUS", 2],
  ["MULTIPATH_PERIODIC_ALERT", 3],
  ["LICENSE_DOES_NOT_SUPPORT_POOLING", 2],
  ["LICENSE_EXPIRES_SOON", 2],
  ["LICENSE_EXPIRED", 2],
  ["LICENSE_SERVER_CONNECTED", 4],
  ["LICENSE_SERVER_UNAVAILABLE", 3],
  ["GRACE_LICENSE", 3],
  ["LICENSE_NOT_AVAILABLE", 2],
  ["LICENSE_SERVER_UNREACHABLE", 2],
  ["LICENSE_SERVER_VERSION_OBSOLETE", 2],
  ["PVS_PROXY_NO_CACHE_SR_AVAILABLE", 3],
  ["PVS_PROXY_SETUP_FAILED", 3],
  ["PVS_PROXY_NO_SERVER_AVAILABLE", 3],
  ["PVS_PROXY_SR_OUT_OF_SPACE", 3],
  ["VMPP_SNAPSHOT_LOCK_FAILED", 3],
  ["VMPP_SNAPSHOT_SUCCEEDED", 5],
  ["VMPP_SNAPSHOT_FAILED", 3],
  ["VMPP_ARCHIVE_LOCK_FAILED", 3],
  ["VMPP_ARCHIVE_FAILED_0", 3],
  ["VMPP_ARCHIVE_SUCCEEDED", 5],
  ["VMPP_ARCHIVE_TARGET_MOUNT_FAILED", 3],
  ["VMPP_ARCHIVE_TARGET_UNMOUNT_FAILED", 3],
  ["VMPP_LICENSE_ERROR", 3],
  ["VMPP_XAPI_LOGON_FAILURE", 3],
  ["VMPP_SNAPSHOT_MISSED_EVENT", 3],
  ["VMPP_ARCHIVE_MISSED_EVENT", 3],
  ["VMPP_SNAPSHOT_ARCHIVE_ALREADY_EXISTS", 3],
  ["VMSS_SNAPSHOT_LOCK_FAILED", 3],
  ["VMSS_SNAPSHOT_SUCCEEDED", 5],
  ["VMSS_SNAPSHOT_FAILED", 3],
  ["VMSS_LICENSE_ERROR", 3],
  ["VMSS_XAPI_LOGON_FAILURE", 3],
  ["VMSS_SNAPSHOT_MISSED_EVENT", 3],
  ["VDI_CBT_METADATA_INCONSISTENT", 3],
  ["VDI_CBT_SNAPSHOT_FAILED", 3],
  ["VDI_CBT_RESIZE_FAILED", 3],
  ["BOND_STATUS_CHANGED", 3],
  ["HOST_CPU_FEATURES_DOWN", 3],
  ["HOST_CPU_FEATURES_UP", 5],
  ["POOL_CPU_FEATURES_DOWN", 5],
  ["POOL_CPU_FEATURES_UP", 5],
  ["CLUSTER_QUORUM_APPROACHING_LOST", 2],
  ["CLUSTER_HOST_ENABLE_FAILED", 3],
  ["CLUSTER_HOST_FENCING", 2],
  ["CLUSTER_HOST_LEAVING", 3],
  ["CLUSTER_HOST_JOINING", 4],
  ["HOST_SERVER_CERTIFICATE_EXPIRED", 1],
  ["HOST_INTERNAL_CERTIFICATE_EXPIRED", 1],
  ["POOL_CA_CERTIFICATE_EXPIRED", 1],
  ["POOL_PINNED_CERTIFICATE_EXPIRED", 1],
  ["FAILED_LOGIN_ATTEMPTS", 3],
  ["TLS_VERIFICATION_EMERGENCY_DISABLED", 3],
  ["PERIODIC_UPDATE_SYNC_FAILED", 3],
  ["XAPI_STARTUP_BLOCKED_AS_VERSION_HIGHER_THAN_COORDINATOR", 2],
  ["ALL_RUNNING_VMS_IN_ANTI_AFFINITY_GRP_ON_SINGLE_HOST", 3],
  ["SM_GC_NO_SPACE", 3],
];

function definitionOf(
  name: string,
  reportedPriority?: unknown,
): XcpNgMessageDefinition {
  return getXcpNgMessageDefinition({
    name: name,
    reportedPriority: reportedPriority,
  });
}

describe("priorities are XAPI's", () => {
  test("every message api_messages.ml defines, at its priority", () => {
    expect(RECORDED_API_MESSAGES.length).toBe(96);
    for (const [name, priority] of RECORDED_API_MESSAGES) {
      if (name === "ALARM") {
        continue;
      }
      expect({ name, priority: definitionOf(name).priority }).toEqual({
        name,
        priority,
      });
    }
  });

  test("the issue's named messages", () => {
    expect(definitionOf("VM_CRASHED").priority).toBe(2);
    expect(definitionOf("HA_HOST_FAILED").priority).toBe(3);
    expect(definitionOf("HA_STATEFILE_LOST").priority).toBe(2);
    expect(definitionOf("HA_PROTECTED_VM_RESTART_FAILED").priority).toBe(2);
    expect(definitionOf("PBD_PLUG_FAILED_ON_SERVER_START").priority).toBe(3);
    expect(definitionOf("SM_GC_NO_SPACE").priority).toBe(3);
    expect(definitionOf("POOL_MASTER_TRANSITION").priority).toBe(4);
  });

  test("a perfmon ALARM is perfmon's default, 3, not the catalog's 1", () => {
    expect(XCP_NG_PERFMON_ALARM_PRIORITY).toBe(3);
    expect(definitionOf("ALARM").priority).toBe(3);
  });

  test("XAPI's own priority, when the record has one, wins over the name", () => {
    expect(definitionOf("ALARM", 1).priority).toBe(1);
    expect(definitionOf("ALARM", "2").priority).toBe(2);
    expect(definitionOf("VM_CRASHED", 5).priority).toBe(5);
    // Nonsense is not a priority: the name's stands.
    expect(definitionOf("VM_CRASHED", 0).priority).toBe(2);
    expect(definitionOf("VM_CRASHED", 6).priority).toBe(2);
    expect(definitionOf("VM_CRASHED", "two").priority).toBe(2);
    expect(definitionOf("VM_CRASHED", 2.5).priority).toBe(2);
  });

  test("a name the catalog does not know is priority 4: the feed, no alert", () => {
    expect(XCP_NG_UNKNOWN_MESSAGE_PRIORITY).toBe(4);
    const plugin: XcpNgMessageDefinition = definitionOf("ACME_PLUGIN_NOTICE");
    expect(plugin.priority).toBe(4);
    expect(plugin.title).toBe("Acme plugin notice");
    expect(plugin.objectType).toBe("unknown");
    expect(plugin.alert).toBe(XcpNgMessageAlert.None);
    expect(definitionOf("").title).toBe("XAPI message");
  });

  test("certificates expiring grow more severe as the day comes", () => {
    for (const base of [
      "HOST_SERVER_CERTIFICATE_EXPIRING",
      "HOST_INTERNAL_CERTIFICATE_EXPIRING",
      "POOL_CA_CERTIFICATE_EXPIRING",
      "POOL_PINNED_CERTIFICATE_EXPIRING",
    ]) {
      expect(definitionOf(`${base}_30`).priority).toBe(3);
      expect(definitionOf(`${base}_14`).priority).toBe(2);
      expect(definitionOf(`${base}_07`).priority).toBe(1);
      expect(definitionOf(`${base}_21`).priority).toBe(4);
    }
  });

  test("a host's kernel, by its own suffix", () => {
    expect(definitionOf("HOST_KERNEL_ENCOUNTERED_ERROR_BUG").priority).toBe(2);
    expect(
      definitionOf("HOST_KERNEL_ENCOUNTERED_WARNING_SOFTLOCKUP").priority,
    ).toBe(3);
  });

  test("names are read case-insensitively and trimmed", () => {
    expect(definitionOf("  vm_crashed ").priority).toBe(2);
  });
});

describe("which template a message is for", () => {
  test("each named template takes its own message", () => {
    expect(definitionOf("VM_CRASHED").alert).toBe(XcpNgMessageAlert.VmCrashed);
    expect(definitionOf("HA_HOST_FAILED").alert).toBe(
      XcpNgMessageAlert.HaHostFailed,
    );
    expect(definitionOf("HA_STATEFILE_LOST").alert).toBe(
      XcpNgMessageAlert.HaStatefileLost,
    );
    expect(definitionOf("HA_PROTECTED_VM_RESTART_FAILED").alert).toBe(
      XcpNgMessageAlert.HaProtectedVmRestartFailed,
    );
    expect(definitionOf("PBD_PLUG_FAILED_ON_SERVER_START").alert).toBe(
      XcpNgMessageAlert.PbdPlugFailed,
    );
    expect(definitionOf("SM_GC_NO_SPACE").alert).toBe(
      XcpNgMessageAlert.StorageGcNoSpace,
    );
    expect(definitionOf("POOL_MASTER_TRANSITION").alert).toBe(
      XcpNgMessageAlert.PoolMasterChanged,
    );
  });

  test("every other message of priority 1 to 3 is the XAPI Alarm's; 4 and 5 none", () => {
    for (const [name] of RECORDED_API_MESSAGES) {
      const definition: XcpNgMessageDefinition = definitionOf(name);
      const named: boolean = [
        "VM_CRASHED",
        "HA_HOST_FAILED",
        "HA_STATEFILE_LOST",
        "HA_PROTECTED_VM_RESTART_FAILED",
        "PBD_PLUG_FAILED_ON_SERVER_START",
        "SM_GC_NO_SPACE",
        "POOL_MASTER_TRANSITION",
      ].includes(name);
      if (named) {
        continue;
      }
      expect({ name, alert: definition.alert }).toEqual({
        name,
        alert:
          definition.priority <= XCP_NG_ALERTING_PRIORITY_MAX
            ? XcpNgMessageAlert.OtherAlarm
            : XcpNgMessageAlert.None,
      });
    }
  });

  test("a named template keeps its message whatever priority XAPI gives it", () => {
    expect(definitionOf("VM_CRASHED", 5).alert).toBe(
      XcpNgMessageAlert.VmCrashed,
    );
    expect(
      getXcpNgMessageAlert({
        namedAlert: XcpNgMessageAlert.HaHostFailed,
        priority: 4,
      }),
    ).toBe(XcpNgMessageAlert.HaHostFailed);
    expect(getXcpNgMessageAlert({ priority: 1 })).toBe(
      XcpNgMessageAlert.OtherAlarm,
    );
    expect(getXcpNgMessageAlert({ priority: 4 })).toBe(XcpNgMessageAlert.None);
  });

  test("an alert stays open until the message is cleared, but Pool Master Changed's", () => {
    expect(isXcpNgMessageClearable(XcpNgMessageAlert.VmCrashed)).toBe(true);
    expect(isXcpNgMessageClearable(XcpNgMessageAlert.OtherAlarm)).toBe(true);
    expect(isXcpNgMessageClearable(XcpNgMessageAlert.PoolMasterChanged)).toBe(
      false,
    );
    expect(isXcpNgMessageClearable(XcpNgMessageAlert.None)).toBe(false);
  });
});

describe("what lands where", () => {
  test("priority 1 to 3 alert; 1 to 4 reach the feed; 5 stays in Logs", () => {
    expect(XCP_NG_ALERTING_PRIORITY_MAX).toBe(3);
    expect(XCP_NG_FEED_PRIORITY_MAX).toBe(4);
    expect([1, 2, 3, 4, 5].map(isXcpNgAlertingPriority)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
    expect([1, 2, 3, 4, 5].map(isXcpNgFeedPriority)).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);
    expect(isXcpNgFeedPriority(0)).toBe(false);
  });

  test("severity: FATAL, ERROR, WARN, INFO2, INFO", () => {
    expect([1, 2, 3, 4, 5].map(getXcpNgMessageSeverityNumber)).toEqual([
      21, 17, 13, 10, 9,
    ]);
  });

  test("XAPI's classes become the pool's own words", () => {
    expect(getXcpNgMessageObjectTypeFromClass("VM")).toBe(XcpNgScope.VM);
    expect(getXcpNgMessageObjectTypeFromClass("Host")).toBe(XcpNgScope.Host);
    expect(getXcpNgMessageObjectTypeFromClass("SR")).toBe(
      XcpNgScope.StorageRepository,
    );
    expect(getXcpNgMessageObjectTypeFromClass("Pool")).toBe(XcpNgScope.Pool);
    expect(getXcpNgMessageObjectTypeFromClass("VDI")).toBe(XcpNgScope.VDI);
    expect(getXcpNgMessageObjectTypeFromClass("VMSS")).toBe("other");
    expect(getXcpNgMessageObjectTypeFromClass("")).toBe("unknown");
    expect(getXcpNgMessageObjectTypeFromClass(null)).toBe("unknown");
  });

  test("the object each message is raised on", () => {
    expect(definitionOf("VM_CRASHED").objectType).toBe(XcpNgScope.VM);
    expect(definitionOf("HA_HOST_FAILED").objectType).toBe(XcpNgScope.Host);
    expect(definitionOf("SM_GC_NO_SPACE").objectType).toBe(
      XcpNgScope.StorageRepository,
    );
    expect(definitionOf("HA_POOL_OVERCOMMITTED").objectType).toBe(
      XcpNgScope.Pool,
    );
    expect(definitionOf("POOL_MASTER_TRANSITION").objectType).toBe(
      XcpNgScope.Host,
    );
  });

  test("every message has a title a feed line can lead with", () => {
    for (const [name] of RECORDED_API_MESSAGES) {
      const title: string = definitionOf(name).title;
      expect(title.length).toBeGreaterThan(3);
      expect(title).not.toContain("_");
      expect(title.charAt(0)).toBe(title.charAt(0).toUpperCase());
    }
  });

  test("a priority read from anything", () => {
    expect(normalizeXcpNgMessagePriority(" 3 ")).toBe(3);
    expect(normalizeXcpNgMessagePriority(undefined)).toBeNull();
    expect(normalizeXcpNgMessagePriority(null)).toBeNull();
    expect(normalizeXcpNgMessagePriority([2])).toBeNull();
  });
});
