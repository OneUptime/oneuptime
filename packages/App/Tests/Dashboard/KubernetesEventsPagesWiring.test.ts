import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Where the Dashboard reads Kubernetes Events, and how (issue #5179).
 *
 * The pages used to each build their own query for Event logs - the newest
 * 500 of the whole project, every cluster and every type - and pick their
 * cluster's and their object's Events out afterwards: on a busy cluster the
 * warnings were never among them. Every read now goes through one builder,
 * buildKubernetesEventsAttributes, which always names the cluster and lets
 * the server filter by type, object and namespace. This guard keeps it the
 * only one, and keeps every Kubernetes detail page on the Events tab that
 * says how many warnings there are.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const MODEL_FILE: string = path.join(
  DASHBOARD_SRC,
  "Components",
  "Kubernetes",
  "KubernetesEventsModel.ts",
);

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /\/\/.*$/gm;

function code(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, " ");
}

function sourceFiles(directory: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      found.push(full);
    }
  }

  return found;
}

// What only a query for Kubernetes Event records says.
const EVENT_RECORD_MARKERS: Array<string> = [
  '"k8s.resource.name": "events"',
  "'k8s.resource.name': 'events'",
  "KUBERNETES_EVENTS_RESOURCE_NAME",
];

describe("every Kubernetes Events read is one cluster's, filtered on the server", () => {
  test("only KubernetesEventsModel builds a query for Event records", () => {
    const offenders: Array<string> = sourceFiles(DASHBOARD_SRC)
      .filter((file: string): boolean => {
        return file !== MODEL_FILE;
      })
      .filter((file: string): boolean => {
        const text: string = code(file);
        return EVENT_RECORD_MARKERS.some((marker: string): boolean => {
          return text.includes(marker);
        });
      })
      .map((file: string): string => {
        return path.relative(DASHBOARD_SRC, file);
      });

    expect(offenders).toEqual([]);
  });

  test("the builder always names the cluster", () => {
    const text: string = code(MODEL_FILE);
    const builder: string = text.slice(
      text.indexOf("export function buildKubernetesEventsAttributes"),
    );

    expect(builder).toContain(
      "[KUBERNETES_CLUSTER_NAME_ATTRIBUTE]: data.clusterIdentifier",
    );
  });

  test("the old project-wide readers are gone", () => {
    const fetcher: string = code(
      path.join(
        DASHBOARD_SRC,
        "Pages",
        "Kubernetes",
        "Utils",
        "KubernetesObjectFetcher.ts",
      ),
    );

    expect(fetcher).not.toContain("fetchK8sEventsForResource");
    expect(fetcher).toContain("fetchKubernetesEvents(");
  });
});

/*
 * Each detail page, the scope its Events tab reads: an object's own Events,
 * a workload's and what it runs, or a namespace's every Event.
 */
const DETAIL_PAGES: Array<{ page: string; scope: string; kind: string }> = [
  { page: "NodeDetail", scope: "object", kind: '"Node"' },
  { page: "PodDetail", scope: "object", kind: '"Pod"' },
  { page: "HPADetail", scope: "object", kind: '"HorizontalPodAutoscaler"' },
  { page: "VPADetail", scope: "object", kind: '"VerticalPodAutoscaler"' },
  { page: "PVCDetail", scope: "object", kind: '"PersistentVolumeClaim"' },
  { page: "PVDetail", scope: "object", kind: '"PersistentVolume"' },
  {
    page: "DeploymentDetail",
    scope: "workload",
    kind: "KubernetesWorkloadKind.Deployment",
  },
  {
    page: "StatefulSetDetail",
    scope: "workload",
    kind: "KubernetesWorkloadKind.StatefulSet",
  },
  {
    page: "DaemonSetDetail",
    scope: "workload",
    kind: "KubernetesWorkloadKind.DaemonSet",
  },
  { page: "JobDetail", scope: "workload", kind: "KubernetesWorkloadKind.Job" },
  {
    page: "CronJobDetail",
    scope: "workload",
    kind: "KubernetesWorkloadKind.CronJob",
  },
  { page: "NamespaceDetail", scope: "namespace", kind: "" },
];

describe("every Kubernetes detail page's Events tab says how many warnings there are", () => {
  test.each(DETAIL_PAGES)(
    "$page reads its Events as it opens, scoped to its $scope",
    (data: { page: string; scope: string; kind: string }) => {
      const text: string = code(
        path.join(
          DASHBOARD_SRC,
          "Pages",
          "Kubernetes",
          "View",
          `${data.page}.tsx`,
        ),
      );

      expect(text).toContain("useKubernetesEventsTab({");
      expect(text).toContain(`kind: "${data.scope}"`);
      if (data.kind) {
        expect(text).toContain(data.kind);
      }
      // The tab is the hook's: one Events tab, with its badge.
      expect(text).toContain("eventsTab,");
      expect(text).not.toContain("<KubernetesEventsTab");
      // Called before the page's first early return, as hooks must be.
      expect(text.indexOf("useKubernetesEventsTab({")).toBeLessThan(
        text.indexOf("if (isLoading) {"),
      );
    },
  );

  test("every page that drew an Events tab is in the list", () => {
    const pages: Array<string> = fs
      .readdirSync(path.join(DASHBOARD_SRC, "Pages", "Kubernetes", "View"))
      .filter((file: string): boolean => {
        return (
          file.endsWith(".tsx") &&
          code(
            path.join(DASHBOARD_SRC, "Pages", "Kubernetes", "View", file),
          ).includes("useKubernetesEventsTab")
        );
      })
      .map((file: string): string => {
        return file.replace(".tsx", "");
      })
      .sort();

    expect(pages).toEqual(
      DETAIL_PAGES.map((entry: { page: string }): string => {
        return entry.page;
      }).sort(),
    );
  });
});
