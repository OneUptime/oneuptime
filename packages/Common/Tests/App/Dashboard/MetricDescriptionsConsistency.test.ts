import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { CEPH_METRIC_DESCRIPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/CephMetricDescriptions";
import {
  CLOUD_INSTANCE_METRIC_DESCRIPTIONS,
  CLOUD_METRIC_DESCRIPTIONS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/CloudMetricDescriptions";
import { CONTAINER_HOST_METRIC_DESCRIPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/ContainerHostMetricDescriptions";
import {
  DOCKER_SWARM_INSIGHTS_CHART_DESCRIPTIONS,
  DOCKER_SWARM_METRIC_DESCRIPTIONS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/DockerSwarmMetricDescriptions";
import { HOST_METRIC_DESCRIPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/HostMetricDescriptions";
import { KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/KubernetesClusterMetricDescriptions";
import { PROXMOX_METRIC_DESCRIPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/ProxmoxMetricDescriptions";
import { VMWARE_METRIC_DESCRIPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/VMwareMetricDescriptions";

/*
 * The same idea, explained the same way on every resource page.
 *
 * MetricDescriptionsCatalog.test.ts holds each text to the shape rules; the
 * per-resource tests hold each text to its own page's code. This file reads
 * every family side by side, so a customer who meets "p95", "the last 5
 * minutes of the selected range" or "100% is one core" on one page reads
 * the same words - and the same caveats - on the next.
 *
 * Only wording is pinned here. Whether a sentence is TRUE for its page is
 * the job of that family's own test, which reads the page's code.
 */

const DESCRIPTIONS_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "MetricDescriptions",
);

type Entry = { where: string; text: string };

function loadEveryText(): Array<Entry> {
  const entries: Array<Entry> = [];

  for (const file of fs.readdirSync(DESCRIPTIONS_DIR).sort()) {
    if (!file.endsWith(".ts") || file.endsWith(".d.ts")) {
      continue;
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const module: Record<string, unknown> = require(
      path.join(DESCRIPTIONS_DIR, file),
    ) as Record<string, unknown>;

    for (const [exportName, value] of Object.entries(module)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        continue;
      }

      for (const [key, text] of Object.entries(
        value as Record<string, unknown>,
      )) {
        if (typeof text === "string") {
          entries.push({ where: `${exportName}.${key}`, text });
        }
      }
    }
  }

  return entries;
}

const EVERY_TEXT: Array<Entry> = loadEveryText();

function offenders(check: (text: string) => boolean): Array<string> {
  return EVERY_TEXT.filter((entry: Entry): boolean => {
    return check(entry.text);
  }).map((entry: Entry): string => {
    return entry.where;
  });
}

const SLOT_OR_BUCKET: RegExp = /\b(time slots?|slots?|buckets?)\b/i;
const LAST_FIVE_MINUTES_OF_RANGE: RegExp =
  /last 5 minutes of the (selected )?range/;
const OFTEN_WHOLE_RANGE: RegExp = /often the whole range(?! on ranges over)/;
const P95_TOKEN: RegExp = /\bp95\b/;
const PERCENTILE_TOKEN: RegExp = /\bp(\d{2})\b/g;
const RECLAIM: RegExp = /reclaim/i;
const ALLOCATABLE_EXPLAINED: RegExp =
  /hand out to pods|left for pods|pods can use/;

/*
 * The fleet-wide overview tiles that average only the last 5 minutes fall
 * back to the whole range when no interval STARTS in that window - usual
 * past 12 hours, whose intervals are 15 minutes or wider. The one text
 * exempt here names a 5-minute figure used only while the page loads.
 */
const LOADING_ONLY_FIVE_MINUTE_FALLBACK: Array<string> = [
  "VMWARE_METRIC_DESCRIPTIONS.overviewDatastores",
];

describe("metric descriptions read the same across resource types", () => {
  test("the catalog found every family", () => {
    expect(EVERY_TEXT.length).toBeGreaterThan(400);
  });

  test("an interval is called an interval, never a time slot or a bucket", () => {
    expect(
      offenders((text: string): boolean => {
        return SLOT_OR_BUCKET.test(text);
      }),
    ).toEqual([]);
  });

  test("every 5-minute tile says it is usually the whole range past 12 hours", () => {
    const missing: Array<string> = EVERY_TEXT.filter(
      (entry: Entry): boolean => {
        return (
          LAST_FIVE_MINUTES_OF_RANGE.test(entry.text) &&
          !entry.text.includes("12 hours") &&
          !LOADING_ONLY_FIVE_MINUTE_FALLBACK.includes(entry.where)
        );
      },
    ).map((entry: Entry): string => {
      return entry.where;
    });

    expect(missing).toEqual([]);
  });

  test("the whole-range fallback names its threshold wherever it says 'often'", () => {
    expect(
      offenders((text: string): boolean => {
        return OFTEN_WHOLE_RANGE.test(text);
      }),
    ).toEqual([]);
  });

  test("the fallback wording is shared by the Kubernetes, Proxmox, VMware and container host tiles", () => {
    const canonical: string =
      "(often the whole range on ranges over 12 hours or without recent data)";

    for (const text of [
      KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS.cpu,
      KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS.memory,
      PROXMOX_METRIC_DESCRIPTIONS.clusterMemory,
      VMWARE_METRIC_DESCRIPTIONS.overviewHostCpu,
      VMWARE_METRIC_DESCRIPTIONS.overviewHostMemory,
      VMWARE_METRIC_DESCRIPTIONS.overviewVmCpuReady,
      CONTAINER_HOST_METRIC_DESCRIPTIONS.avgCpu,
      CONTAINER_HOST_METRIC_DESCRIPTIONS.peakMemory,
    ]) {
      expect(text).toContain(canonical);
    }

    // The Host tiles say the same with "usually", pinned by their own test.
    expect(HOST_METRIC_DESCRIPTIONS.cpu).toContain("12 hours");
    expect(HOST_METRIC_DESCRIPTIONS.cpu).toContain("no recent data");
  });

  test("every percentile is introduced the same way: 'pNN means the NNth percentile'", () => {
    const unexplained: Array<string> = [];

    for (const entry of EVERY_TEXT) {
      for (const match of entry.text.matchAll(PERCENTILE_TOKEN)) {
        const rank: string = match[1]!;

        if (!entry.text.includes(`p${rank} means the ${rank}th percentile`)) {
          unexplained.push(`${entry.where}: p${rank}`);
        }
      }
    }

    expect(unexplained).toEqual([]);
  });

  test("every tile that averages per-interval p95s says each interval counts the same", () => {
    expect(
      offenders((text: string): boolean => {
        return (
          P95_TOKEN.test(text) &&
          text.includes("then averaged over the selected range") &&
          !text.includes("so quiet and busy intervals count equally")
        );
      }),
    ).toEqual([]);
  });

  test("an agent that disconnects after 15 minutes of silence, checked every 5, says 15 to 20", () => {
    for (const text of [
      KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS.agentStatus,
      PROXMOX_METRIC_DESCRIPTIONS.agentStatus,
      VMWARE_METRIC_DESCRIPTIONS.overviewAgentStatus,
    ]) {
      expect(text).toContain("15 to 20 minutes after data stops arriving");
    }
  });

  test("docker_stats container memory leaves out the same cache on the host and Swarm pages", () => {
    for (const text of [
      CONTAINER_HOST_METRIC_DESCRIPTIONS.containerMemory,
      DOCKER_SWARM_METRIC_DESCRIPTIONS.taskMemory,
      DOCKER_SWARM_METRIC_DESCRIPTIONS.taskMemoryColumn,
      DOCKER_SWARM_INSIGHTS_CHART_DESCRIPTIONS.taskMemory,
    ]) {
      expect(text.toLowerCase()).toContain(
        "file cache the system has not used recently",
      );
    }

    // Only inactive cache is subtracted, so nothing claims all of it is.
    expect(
      offenders((text: string): boolean => {
        return RECLAIM.test(text);
      }),
    ).toEqual([]);
  });

  test("docker_stats CPU states its scale in the same words on every page", () => {
    for (const text of [
      CONTAINER_HOST_METRIC_DESCRIPTIONS.avgCpu,
      CONTAINER_HOST_METRIC_DESCRIPTIONS.containerCpu,
      DOCKER_SWARM_INSIGHTS_CHART_DESCRIPTIONS.clusterCpu,
      DOCKER_SWARM_INSIGHTS_CHART_DESCRIPTIONS.topTasksCpu,
    ]) {
      expect(text).toContain("100% is one full CPU core");
    }

    for (const text of [
      CLOUD_METRIC_DESCRIPTIONS.cpu,
      CLOUD_INSTANCE_METRIC_DESCRIPTIONS.cpu,
    ]) {
      expect(text).toContain(
        "100% is one full CPU core or all the CPU the task was given",
      );
    }
  });

  test("no text weighs data against a picker", () => {
    expect(
      offenders((text: string): boolean => {
        return text.includes("not the time range picker");
      }),
    ).toEqual([]);
  });

  test("every Kubernetes text that divides by allocatable says what allocatable is", () => {
    expect(
      offenders((text: string): boolean => {
        return (
          text.includes("allocatable") && !ALLOCATABLE_EXPLAINED.test(text)
        );
      }),
    ).toEqual([]);
  });

  test("Ceph titles that abbreviate say what the letters stand for", () => {
    expect(CEPH_METRIC_DESCRIPTIONS.clientIops).toContain(
      "operations per second (IOPS)",
    );
    expect(CEPH_METRIC_DESCRIPTIONS.pgStates).toContain(
      "Placement groups (the chunks Ceph splits each pool into)",
    );
    expect(CEPH_METRIC_DESCRIPTIONS.osdStates).toContain(
      "Every OSD (a daemon that stores data, usually one per disk)",
    );
  });
});
