import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Every Kubernetes detail page's Metrics tab (and the container Logs tab)
 * used to describe its data as "over the last 6 hours". The charts are an
 * EmbeddedMetricCard with its own range picker, which ResourceMetricsTab
 * seeds with nothing - so they open on the past hour and follow whatever
 * the viewer picks. The card text now says so, and these pins keep the text
 * tied to the default it describes.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function read(relativePath: string): string {
  return fs.readFileSync(
    path.join(DASHBOARD_SRC, ...relativePath.split("/")),
    "utf8",
  );
}

const DETAIL_PAGES_WITH_METRICS_TAB: Array<string> = [
  "NodeDetail",
  "PodDetail",
  "DeploymentDetail",
  "StatefulSetDetail",
  "DaemonSetDetail",
  "JobDetail",
  "CronJobDetail",
  "NamespaceDetail",
  "ContainerDetail",
];

const SIX_HOURS: RegExp = /6 hours/;
const PAST_HOUR_DEFAULT: string =
  "over the selected time range (the past hour by default).";

describe("Kubernetes detail Metrics tabs describe the window they show", () => {
  test.each(DETAIL_PAGES_WITH_METRICS_TAB)(
    "%s no longer claims a 6-hour window",
    (page: string) => {
      expect(read(`Pages/Kubernetes/View/${page}.tsx`)).not.toMatch(SIX_HOURS);
    },
  );

  test.each(DETAIL_PAGES_WITH_METRICS_TAB)(
    "%s says its metrics follow the selected range, past hour by default",
    (page: string) => {
      const source: string = read(`Pages/Kubernetes/View/${page}.tsx`);

      expect(source).toContain(PAST_HOUR_DEFAULT);
      expect(source).toContain("<KubernetesMetricsTab");
    },
  );

  test("the container Logs tab says the same about its window", () => {
    expect(read("Pages/Kubernetes/View/ContainerDetail.tsx")).toContain(
      '"Logs for this container in the selected time range (the past hour by default)."',
    );
  });

  test("the words match the code: no default range is passed, and the card opens on the past hour", () => {
    const metricsTab: string = read(
      "Components/Infrastructure/ResourceMetricsTab.tsx",
    );
    const card: string = read("Components/Metrics/EmbeddedMetricCard.tsx");
    const logsViewer: string = read("Components/Logs/LogsViewer.tsx");

    expect(metricsTab).toContain("<EmbeddedMetricCard");
    expect(metricsTab).not.toContain("defaultTimeRange");
    expect(card).toContain(
      "props.defaultTimeRange || { range: TimeRange.PAST_ONE_HOUR }",
    );
    // The card draws a range picker, so "selected time range" is real.
    expect(card).toContain("<RangeStartAndEndDateView");
    expect(logsViewer).toContain("{ range: TimeRange.PAST_ONE_HOUR }");
  });
});
