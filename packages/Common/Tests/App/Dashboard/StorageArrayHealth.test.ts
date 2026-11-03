import { describe, expect, test } from "@jest/globals";
import StorageArrayResource from "../../../Models/DatabaseModels/StorageArrayResource";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import StorageSystem from "../../../Types/StorageArray/StorageSystem";
import {
  StorageArrayAlertTemplate,
  getStorageArrayAlertTemplateById,
} from "../../../Types/Monitor/StorageArrayAlertTemplates";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
  ResourceAttentionText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";
import {
  FILE_SYSTEM_NEAR_FULL_AVAILABLE_RATIO,
  FLASHARRAY_LATENCY_WARNING_USEC,
  FLASHBLADE_READ_LATENCY_WARNING_USEC,
  STORAGE_ARRAY_ATTENTION_KEY,
  STORAGE_ARRAY_CAPACITY_CRITICAL_PERCENT,
  STORAGE_ARRAY_CAPACITY_WARNING_PERCENT,
  STORAGE_ARRAY_REPLICATION_LAG_WARNING_MS,
  StorageArrayAssessment,
  assessStorageArray,
  assessStorageArrayPart,
  formatStorageArrayLag,
  formatStorageArrayLatency,
  formatStorageArrayPercent,
  getStorageArrayAttentionItems,
  getStorageArrayHealth,
  getStorageArrayStatusWord,
  getStorageArrayTopologyHealth,
  isStorageArrayIssueAbout,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/Utils/StorageArrayHealth";

/*
 * What on a storage array needs someone, and how bad it is
 * (Pages/StorageArray/Utils/StorageArrayHealth): one set of rules for the
 * array's Overview, a part's page, the lists and the Topology, each line
 * the one its alert template fires at.
 */

let rowNumber: number = 0;

function part(
  kind: string,
  fields: Partial<{
    externalId: string;
    name: string;
    status: string;
    statusDetail: string;
    replicationLagMs: number;
  }> = {},
): StorageArrayResource {
  rowNumber++;
  return Object.assign(new StorageArrayResource(), {
    kind: kind,
    externalId: fields.externalId || `${kind.toLowerCase()}-${rowNumber}`,
    name:
      fields.name || fields.externalId || `${kind.toLowerCase()}-${rowNumber}`,
    metricsUpdatedAt: new Date(),
    ...fields,
  });
}

function texts(reasons: Array<ResourceAttentionText>): Array<string> {
  return reasons.map((reason: ResourceAttentionText): string => {
    return reason.text;
  });
}

function stepOf(template: StorageArrayAlertTemplate): MonitorStep {
  return template.getMonitorStep({
    arrayIdentifier: "pure-prod",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "pure-prod",
  });
}

// The value a template's first (firing) criteria instance compares with.
function firingLineOf(id: string): unknown {
  const template: StorageArrayAlertTemplate | undefined =
    getStorageArrayAlertTemplateById(id);
  expect(template).toBeDefined();
  const instances: Array<MonitorCriteriaInstance> =
    stepOf(template!).data?.monitorCriteria.data
      ?.monitorCriteriaInstanceArray || [];
  return instances[0]?.data?.filters?.[0]?.value;
}

function severityOf(id: string): string | undefined {
  return getStorageArrayAlertTemplateById(id)?.severity;
}

describe("each line is its alert template's", () => {
  test("the array's capacity: a warning past 80%, critical past 90%", () => {
    expect(firingLineOf("purefa-capacity-high")).toBe(
      STORAGE_ARRAY_CAPACITY_WARNING_PERCENT,
    );
    expect(firingLineOf("purefa-capacity-critical")).toBe(
      STORAGE_ARRAY_CAPACITY_CRITICAL_PERCENT,
    );
    expect(firingLineOf("purefb-capacity-high")).toBe(
      STORAGE_ARRAY_CAPACITY_WARNING_PERCENT,
    );
    expect(firingLineOf("purefb-capacity-critical")).toBe(
      STORAGE_ARRAY_CAPACITY_CRITICAL_PERCENT,
    );
    expect(severityOf("purefa-capacity-critical")).toBe("Critical");
    expect(severityOf("purefa-capacity-high")).toBe("Warning");
  });

  test("latency: 5 ms on a FlashArray, reads and writes; 10 ms reads on a FlashBlade", () => {
    expect(firingLineOf("purefa-read-latency-high")).toBe(
      FLASHARRAY_LATENCY_WARNING_USEC,
    );
    expect(firingLineOf("purefa-write-latency-high")).toBe(
      FLASHARRAY_LATENCY_WARNING_USEC,
    );
    expect(firingLineOf("purefb-read-latency-high")).toBe(
      FLASHBLADE_READ_LATENCY_WARNING_USEC,
    );
    expect(severityOf("purefb-read-latency-high")).toBe("Warning");
  });

  test("a replica link more than a minute behind, a file system with less than 10% left: warnings", () => {
    expect(firingLineOf("purefa-replica-link-lag")).toBe(
      STORAGE_ARRAY_REPLICATION_LAG_WARNING_MS,
    );
    expect(firingLineOf("purefb-file-system-near-full")).toBe(
      FILE_SYSTEM_NEAR_FULL_AVAILABLE_RATIO,
    );
    expect(severityOf("purefa-replica-link-lag")).toBe("Warning");
    expect(severityOf("purefb-file-system-near-full")).toBe("Warning");
  });

  test("a failed part and a failed drive are critical, a degraded one and a host that lost a path warnings", () => {
    expect(severityOf("purefa-hardware-critical")).toBe("Critical");
    expect(severityOf("purefa-drive-failed")).toBe("Critical");
    expect(severityOf("purefa-hardware-degraded")).toBe("Warning");
    expect(severityOf("purefa-host-connectivity-critical")).toBe("Warning");
  });
});

describe("a part the array reports a status for", () => {
  test.each([
    ["critical", "Critical", "Reports critical"],
    ["failed", "Failed", "Reports failed"],
    ["missing", "Missing", "Reports missing"],
    ["unhealthy", "Unhealthy", "Reports unhealthy"],
  ])(
    "%s is critical, in red, with why",
    (status: string, label: string, reason: string) => {
      const assessment: StorageArrayAssessment = assessStorageArrayPart(
        part("Hardware", { status: status }),
      );
      expect(assessment.severity).toBe(ResourceAttentionSeverity.Critical);
      expect(assessment.status).toEqual({
        label: label,
        values: undefined,
        tone: "danger",
      });
      expect(texts(assessment.reasons)).toEqual([reason]);
    },
  );

  test.each([
    ["degraded", "Degraded"],
    ["unknown", "Unknown"],
    ["unrecognized", "Unrecognized"],
    ["not ready", "Not Ready"],
  ])("%s needs a look, in amber", (status: string, label: string) => {
    const assessment: StorageArrayAssessment = assessStorageArrayPart(
      part("Drive", { status: status }),
    );
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(assessment.status.label).toBe(label);
    expect(assessment.status.tone).toBe("warning");
    expect(assessment.reasons).toHaveLength(1);
  });

  test.each([
    ["ok", "OK"],
    ["healthy", "Healthy"],
    ["ready", "Ready"],
    ["enabled", "Enabled"],
  ])(
    "%s is fine, in green, with nothing to say",
    (status: string, label: string) => {
      const assessment: StorageArrayAssessment = assessStorageArrayPart(
        part("Controller", { status: status }),
      );
      expect(assessment.severity).toBeNull();
      expect(assessment.status).toEqual({
        label: label,
        values: undefined,
        tone: "positive",
      });
      expect(assessment.reasons).toEqual([]);
    },
  );

  test("the expected states between - not installed, off, unused - are grey and never a problem", () => {
    for (const status of [
      "not_installed",
      "device_off",
      "unused",
      "disabled",
    ]) {
      const assessment: StorageArrayAssessment = assessStorageArrayPart(
        part("Hardware", { status: status }),
      );
      expect(assessment.severity).toBeNull();
      expect(assessment.status.tone).toBe("neutral");
    }
    expect(
      assessStorageArrayPart(part("Hardware", { status: "not_installed" }))
        .status.label,
    ).toBe("Not Installed");
  });

  test("a word the rules do not know is drawn as the array writes it, in grey", () => {
    const assessment: StorageArrayAssessment = assessStorageArrayPart(
      part("NetworkInterface", { status: "link_flapping" }),
    );
    expect(assessment.severity).toBeNull();
    expect(assessment.status).toEqual({
      label: "{{status}}",
      values: { status: "Link Flapping" },
      tone: "neutral",
    });
    // A replica link's words are Pure's, as its tooltip names them.
    expect(getStorageArrayStatusWord("replicating")).toEqual({
      label: "{{status}}",
      values: { status: "Replicating" },
    });
  });
});

describe("a host, as the array sees it", () => {
  test("on both controllers: Redundant paths, in green", () => {
    const assessment: StorageArrayAssessment = assessStorageArrayPart(
      part("Host", { status: "healthy", statusDetail: "Redundant" }),
    );
    expect(assessment.severity).toBeNull();
    expect(assessment.status).toEqual({
      label: "Redundant paths",
      tone: "positive",
    });
  });

  test.each([
    ["Single Controller", "Reaches the array through one controller only"],
    ["Uneven", "Its paths to the two controllers are uneven"],
    ["None", "No path to the array"],
    ["", "No longer reaches the array through both controllers"],
  ])(
    "critical (%s) is the Host Lost Redundant Paths alert's warning, with why",
    (detail: string, reason: string) => {
      const assessment: StorageArrayAssessment = assessStorageArrayPart(
        part("Host", { status: "critical", statusDetail: detail }),
      );
      expect(assessment.severity).toBe(ResourceAttentionSeverity.Warning);
      expect(assessment.status).toEqual({
        label: "Lost redundant paths",
        tone: "warning",
      });
      expect(texts(assessment.reasons)).toEqual([reason]);
    },
  );

  test("with no volume connected: Unused, in grey", () => {
    const assessment: StorageArrayAssessment = assessStorageArrayPart(
      part("Host", { status: "unused" }),
    );
    expect(assessment.severity).toBeNull();
    expect(assessment.status.label).toBe("Unused");
    expect(assessment.status.tone).toBe("neutral");
  });
});

describe("a pod's replica link", () => {
  test("replicating and caught up: Replicating, in green", () => {
    const assessment: StorageArrayAssessment = assessStorageArrayPart(
      part("Pod", { status: "replicating", replicationLagMs: 4200 }),
    );
    expect(assessment.severity).toBeNull();
    expect(assessment.status).toEqual({
      label: "{{status}}",
      values: { status: "Replicating" },
      tone: "positive",
    });
  });

  test("a minute behind is the line, not past it", () => {
    expect(
      assessStorageArrayPart(
        part("Pod", {
          status: "replicating",
          replicationLagMs: STORAGE_ARRAY_REPLICATION_LAG_WARNING_MS,
        }),
      ).severity,
    ).toBeNull();
  });

  test("more than a minute behind: a warning, in amber, with how far", () => {
    const assessment: StorageArrayAssessment = assessStorageArrayPart(
      part("Pod", { status: "replicating", replicationLagMs: 61000 }),
    );
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(assessment.status.values).toEqual({ status: "Replicating" });
    expect(assessment.status.tone).toBe("warning");
    expect(assessment.reasons).toEqual([
      { text: "Replication {{lag}} behind", values: { lag: "1 min 1 s" } },
    ]);
  });

  test("unhealthy and behind: critical, both reasons, the link's first", () => {
    const assessment: StorageArrayAssessment = assessStorageArrayPart(
      part("Pod", { status: "unhealthy", replicationLagMs: 180000 }),
    );
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(assessment.status.tone).toBe("danger");
    expect(texts(assessment.reasons)).toEqual([
      "Reports unhealthy",
      "Replication {{lag}} behind",
    ]);
  });
});

describe("a FlashBlade file system", () => {
  test("with less than 10% of its size left: Near full, in amber, with how much is used", () => {
    const assessment: StorageArrayAssessment = assessStorageArrayPart(
      part("FileSystem"),
      { availableRatio: 0.08 },
    );
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(assessment.status).toEqual({ label: "Near full", tone: "warning" });
    expect(assessment.reasons).toEqual([
      {
        text: "{{percent}} of its provisioned size used",
        values: { percent: "92%" },
      },
    ]);
  });

  test("at 10% left, or with no reading: Available", () => {
    for (const ratio of [FILE_SYSTEM_NEAR_FULL_AVAILABLE_RATIO, null]) {
      const assessment: StorageArrayAssessment = assessStorageArrayPart(
        part("FileSystem"),
        { availableRatio: ratio },
      );
      expect(assessment.severity).toBeNull();
      expect(assessment.status.label).toBe("Available");
    }
  });

  test("a volume and a bucket have no rule of their own: Available", () => {
    expect(assessStorageArrayPart(part("Volume")).status).toEqual({
      label: "Available",
      tone: "positive",
    });
    expect(assessStorageArrayPart(part("Bucket")).severity).toBeNull();
  });
});

describe("the array itself", () => {
  test("calm: OK, nothing to say", () => {
    const assessment: StorageArrayAssessment = assessStorageArray({
      storageSystem: StorageSystem.PureStorageFlashArray,
      criticalAlertCount: 0,
      warningAlertCount: 0,
      capacityUsedPercent: 62,
      readLatencyUsec: 400,
      writeLatencyUsec: 600,
    });
    expect(assessment.severity).toBeNull();
    expect(assessment.status).toEqual({ label: "OK", tone: "positive" });
    expect(assessment.reasons).toEqual([]);
  });

  test("its own open alerts, counted by severity, the critical first", () => {
    const assessment: StorageArrayAssessment = assessStorageArray({
      criticalAlertCount: 1,
      warningAlertCount: 3,
    });
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(assessment.reasons).toEqual([
      {
        text: "{{count}} critical alerts open",
        plural: { one: "{{count}} critical alert open", count: 1 },
      },
      {
        text: "{{count}} warning alerts open",
        plural: { one: "{{count}} warning alert open", count: 3 },
      },
    ]);
  });

  test("past 80% of its usable capacity a warning, past 90% critical; 80% itself is the line", () => {
    expect(assessStorageArray({ capacityUsedPercent: 80 }).severity).toBeNull();
    const warning: StorageArrayAssessment = assessStorageArray({
      capacityUsedPercent: 84.26,
    });
    expect(warning.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(warning.reasons).toEqual([
      {
        text: "{{percent}} of usable capacity used",
        values: { percent: "84.3%" },
      },
    ]);
    expect(assessStorageArray({ capacityUsedPercent: 92 }).severity).toBe(
      ResourceAttentionSeverity.Critical,
    );
  });

  test("a FlashArray slower than 5 ms reads or writes needs a look", () => {
    const assessment: StorageArrayAssessment = assessStorageArray({
      storageSystem: StorageSystem.PureStorageFlashArray,
      readLatencyUsec: 6100,
      writeLatencyUsec: 5400,
    });
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(assessment.reasons).toEqual([
      { text: "Read latency {{latency}}", values: { latency: "6.1 ms" } },
      { text: "Write latency {{latency}}", values: { latency: "5.4 ms" } },
    ]);
  });

  test("a FlashBlade's line is 10 ms, on reads only", () => {
    expect(
      assessStorageArray({
        storageSystem: StorageSystem.PureStorageFlashBlade,
        readLatencyUsec: 8000,
        writeLatencyUsec: 20000,
      }).severity,
    ).toBeNull();
    expect(
      texts(
        assessStorageArray({
          storageSystem: StorageSystem.PureStorageFlashBlade,
          readLatencyUsec: 12000,
        }).reasons,
      ),
    ).toEqual(["Read latency {{latency}}"]);
  });

  test("the most urgent first: capacity past 90% before a warning alert", () => {
    const assessment: StorageArrayAssessment = assessStorageArray({
      warningAlertCount: 1,
      capacityUsedPercent: 95,
    });
    expect(texts(assessment.reasons)).toEqual([
      "{{percent}} of usable capacity used",
      "{{count}} warning alerts open",
    ]);
  });
});

describe("Needs attention", () => {
  const routeFor: (row: {
    kind?: string;
    externalId?: string;
  }) => Route = (row: { kind?: string; externalId?: string }): Route => {
    return new Route(`/array/${row.kind}/${row.externalId}`);
  };

  test("the array's own row first, then each part with why, the most urgent first; a fine part is left out", () => {
    const items: Array<ResourceAttentionItem> = getStorageArrayAttentionItems({
      arrayName: "pure-prod",
      array: {
        storageSystem: StorageSystem.PureStorageFlashArray,
        warningAlertCount: 2,
      },
      parts: [
        part("Host", {
          externalId: "esx-07",
          status: "critical",
          statusDetail: "Single Controller",
        }),
        part("Drive", { externalId: "CH0.BAY4", status: "failed" }),
        part("Hardware", { externalId: "CH0.PWR1", status: "degraded" }),
        part("Pod", {
          externalId: "dr-pod",
          status: "replicating",
          replicationLagMs: 95000,
        }),
        part("Controller", { externalId: "CT0", status: "ready" }),
      ],
      routeFor: routeFor,
    });

    expect(
      items.map((item: ResourceAttentionItem): [string, string] => {
        return [item.key, item.severity];
      }),
    ).toEqual([
      ["Drive:CH0.BAY4", "critical"],
      [STORAGE_ARRAY_ATTENTION_KEY, "warning"],
      ["Hardware:CH0.PWR1", "warning"],
      ["Host:esx-07", "warning"],
      ["Pod:dr-pod", "warning"],
    ]);

    const array: ResourceAttentionItem = items[1]!;
    expect(array.kind).toBe("Storage Array");
    expect(array.name).toBe("pure-prod");
    expect(array.route).toBeUndefined();

    const drive: ResourceAttentionItem = items[0]!;
    expect(drive.kind).toBe("Drive");
    expect(drive.route?.toString()).toBe("/array/Drive/CH0.BAY4");
    expect(texts(drive.reasons)).toEqual(["Reports failed"]);
  });

  test("one physical part is one row: a failed drive and its bay, a controller and its chassis entry", () => {
    const items: Array<ResourceAttentionItem> = getStorageArrayAttentionItems({
      arrayName: "pure-prod",
      array: {},
      parts: [
        // The bay first, as the inventory may list it.
        part("Hardware", { externalId: "CH0.BAY3", status: "critical" }),
        part("Drive", { externalId: "CH0.BAY3", status: "failed" }),
        part("Hardware", { externalId: "CT1", status: "degraded" }),
        part("Controller", { externalId: "CT1", status: "not ready" }),
        // A fine controller row beside a degraded chassis entry: one row.
        part("Controller", { externalId: "CT0", status: "ready" }),
        part("Hardware", { externalId: "CT0", status: "degraded" }),
        // A degraded drive in a bay the array calls critical.
        part("Drive", { externalId: "CH0.BAY5", status: "degraded" }),
        part("Hardware", { externalId: "CH0.BAY5", status: "critical" }),
      ],
      routeFor: routeFor,
    });

    expect(
      items.map((item: ResourceAttentionItem): [string, string, string] => {
        return [item.key, item.kind, item.severity];
      }),
    ).toEqual([
      ["Drive:CH0.BAY3", "Drive", "critical"],
      ["Drive:CH0.BAY5", "Drive", "critical"],
      ["Hardware:CT0", "Hardware Component", "warning"],
      ["Controller:CT1", "Controller", "warning"],
    ]);
    /*
     * The specific kind says why; the bay's "Reports critical" says nothing
     * the drive's "Reports failed" does not, nor the chassis entry's
     * "Reports degraded" anything the controller's "Reports not ready" does
     * not.
     */
    expect(texts(items[0]!.reasons)).toEqual(["Reports failed"]);
    expect(items[0]!.route?.toString()).toBe("/array/Drive/CH0.BAY3");
    expect(texts(items[3]!.reasons)).toEqual(["Reports not ready"]);
    // A more urgent row's reason joins: the drive is critical for its bay's.
    expect(texts(items[1]!.reasons)).toEqual([
      "Reports degraded",
      "Reports critical",
    ]);
    expect(items[1]!.route?.toString()).toBe("/array/Drive/CH0.BAY5");
  });

  test("the array's health is the worst of what it lists", () => {
    expect(getStorageArrayHealth([])).toBe("Healthy");
    expect(
      getStorageArrayHealth(
        getStorageArrayAttentionItems({
          arrayName: "pure-prod",
          array: { capacityUsedPercent: 85 },
          parts: [],
        }),
      ),
    ).toBe("Degraded");
    expect(
      getStorageArrayHealth(
        getStorageArrayAttentionItems({
          arrayName: "pure-prod",
          array: {},
          parts: [part("Hardware", { status: "critical" })],
        }),
      ),
    ).toBe("Unhealthy");
  });

  test("a file system its latest reading says is nearly full, by its name", () => {
    const items: Array<ResourceAttentionItem> = getStorageArrayAttentionItems({
      arrayName: "blade-01",
      array: { storageSystem: StorageSystem.PureStorageFlashBlade },
      parts: [
        part("FileSystem", { externalId: "home" }),
        part("FileSystem", { externalId: "scratch" }),
      ],
      readingsFor: (row: { name?: string }) => {
        return { availableRatio: row.name === "scratch" ? 0.03 : 0.5 };
      },
    });
    expect(
      items.map((item: ResourceAttentionItem): string => {
        return item.key;
      }),
    ).toEqual(["FileSystem:scratch"]);
  });

  test("the Topology colours by the same rules", () => {
    expect(
      getStorageArrayTopologyHealth(
        assessStorageArrayPart(part("Drive", { status: "failed" })),
      ),
    ).toBe("critical");
    expect(
      getStorageArrayTopologyHealth(
        assessStorageArrayPart(part("Host", { status: "critical" })),
      ),
    ).toBe("warning");
    expect(
      getStorageArrayTopologyHealth(assessStorageArrayPart(part("Volume"))),
    ).toBe("healthy");
  });
});

describe("an open incident or alert about a part", () => {
  function record(labels: Record<string, string>): {
    seriesLabels: Record<string, string>;
  } {
    return { seriesLabels: labels };
  }

  test("is the host's by its host label, the pod's by local_pod, a component's by component_name or name", () => {
    expect(
      isStorageArrayIssueAbout(
        record({ host: "esx-07" }) as never,
        part("Host", { externalId: "esx-07" }),
      ),
    ).toBe(true);
    expect(
      isStorageArrayIssueAbout(
        record({ host: "esx-08" }) as never,
        part("Host", { externalId: "esx-07" }),
      ),
    ).toBe(false);
    expect(
      isStorageArrayIssueAbout(
        record({ local_pod: "dr-pod" }) as never,
        part("Pod", { externalId: "dr-pod" }),
      ),
    ).toBe(true);
    expect(
      isStorageArrayIssueAbout(
        record({ component_name: "CH0.BAY4" }) as never,
        part("Drive", { externalId: "CH0.BAY4" }),
      ),
    ).toBe(true);
    expect(
      isStorageArrayIssueAbout(
        record({ name: "scratch" }) as never,
        part("FileSystem", { externalId: "scratch" }),
      ),
    ).toBe(true);
  });

  test("an alert of the array's own, or about its capacity, names no part", () => {
    expect(
      isStorageArrayIssueAbout(
        record({ summary: "Controller CT0 failed" }) as never,
        part("Controller", { externalId: "CT0" }),
      ),
    ).toBe(false);
    expect(
      isStorageArrayIssueAbout(
        record({}) as never,
        part("Volume", { externalId: "vol1" }),
      ),
    ).toBe(false);
  });
});

describe("the figures in the reasons", () => {
  test("a lag, a latency and a share as people read them", () => {
    expect(formatStorageArrayLag(850)).toBe("850 ms");
    expect(formatStorageArrayLag(4200)).toBe("4.2 s");
    expect(formatStorageArrayLag(60000)).toBe("1 min");
    expect(formatStorageArrayLag(125000)).toBe("2 min 5 s");
    // Whole seconds first: never "1 min 60 s".
    expect(formatStorageArrayLag(119600)).toBe("2 min");
    // An hour or more in hours and minutes, not "125 min 0 s".
    expect(formatStorageArrayLag(3600000)).toBe("1 h");
    expect(formatStorageArrayLag(7500000)).toBe("2 h 5 min");
    expect(formatStorageArrayLatency(850)).toBe("850 µs");
    expect(formatStorageArrayLatency(6140)).toBe("6.1 ms");
    expect(formatStorageArrayPercent(91)).toBe("91%");
    expect(formatStorageArrayPercent(84.26)).toBe("84.3%");
  });
});
