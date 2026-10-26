import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import MonitorType from "Common/Types/Monitor/MonitorType";
import {
  KUBERNETES_CLUSTER_NAME_LOG_ATTRIBUTE,
  buildKubernetesWarningEventsLogMonitor,
} from "Common/Types/Monitor/KubernetesEventAlertTemplates";
import MonitorRecommendationCatalog from "Common/Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  KUBERNETES_WARNING_EVENTS_RECOMMENDATION_ID,
  KubernetesWarningEventsMonitorLike,
  findKubernetesWarningEventsMonitors,
  isKubernetesWarningEventsFilter,
  isKubernetesWarningEventsMonitor,
} from "../../FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesWarningEventsAlert";
import { KUBERNETES_CLUSTER_NAME_ATTRIBUTE } from "../../FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesEventsModel";
import RecommendationFilterUtil from "../../FeatureSet/Dashboard/src/Components/Recommendations/RecommendationFilterUtil";

/*
 * Follow-up of #5201: a cluster's Events page ends with whether its warnings
 * raise alerts - the monitor that alerts on them, or the cluster's Warning
 * Events recommendation to turn on.
 */

const CLUSTER: string = "aks-prod-westeurope";

function logsMonitor(
  attributes: Record<string, unknown>,
  extra: Partial<KubernetesWarningEventsMonitorLike> = {},
): KubernetesWarningEventsMonitorLike & { name: string } {
  return {
    name: "Warnings",
    monitorType: MonitorType.Logs,
    monitorSteps: {
      data: {
        monitorStepsInstanceArray: [{ data: { logMonitor: { attributes } } }],
      },
    },
    ...extra,
  };
}

describe("which monitors alert on a cluster's warning events", () => {
  test("the Warning Events recommendation's own monitor does", () => {
    expect(
      isKubernetesWarningEventsMonitor(
        logsMonitor(buildKubernetesWarningEventsLogMonitor(CLUSTER).attributes),
        CLUSTER,
      ),
    ).toBe(true);
  });

  test("so does one built from the docs' recipe, narrower or grouped otherwise", () => {
    expect(
      isKubernetesWarningEventsMonitor(
        logsMonitor({
          "resource.k8s.cluster.name": CLUSTER,
          "k8s.event.type": "Warning",
          "k8s.event.reason": "OOMKilling",
        }),
        CLUSTER,
      ),
    ).toBe(true);
  });

  test("another cluster's does not", () => {
    expect(
      isKubernetesWarningEventsMonitor(
        logsMonitor(
          buildKubernetesWarningEventsLogMonitor("eks-staging").attributes,
        ),
        CLUSTER,
      ),
    ).toBe(false);
  });

  test("one over Normal events, or over every event, does not", () => {
    expect(
      isKubernetesWarningEventsFilter(
        { "resource.k8s.cluster.name": CLUSTER, "k8s.event.type": "Normal" },
        CLUSTER,
      ),
    ).toBe(false);
    expect(
      isKubernetesWarningEventsFilter(
        { "resource.k8s.cluster.name": CLUSTER },
        CLUSTER,
      ),
    ).toBe(false);
    expect(isKubernetesWarningEventsFilter(undefined, CLUSTER)).toBe(false);
    expect(
      isKubernetesWarningEventsFilter(
        buildKubernetesWarningEventsLogMonitor(CLUSTER).attributes,
        "",
      ),
    ).toBe(false);
  });

  test("a monitor that is turned off does not: its warnings reach nobody", () => {
    expect(
      isKubernetesWarningEventsMonitor(
        logsMonitor(buildKubernetesWarningEventsLogMonitor(CLUSTER).attributes, {
          disableActiveMonitoring: true,
        }),
        CLUSTER,
      ),
    ).toBe(false);
  });

  test("a monitor of another type does not, whatever its steps say", () => {
    expect(
      isKubernetesWarningEventsMonitor(
        logsMonitor(buildKubernetesWarningEventsLogMonitor(CLUSTER).attributes, {
          monitorType: MonitorType.Kubernetes,
        }),
        CLUSTER,
      ),
    ).toBe(false);
  });

  test("any step of a monitor can be the one", () => {
    const monitor: KubernetesWarningEventsMonitorLike = {
      monitorType: MonitorType.Logs,
      monitorSteps: {
        data: {
          monitorStepsInstanceArray: [
            { data: { logMonitor: { attributes: { "service.name": "api" } } } },
            {
              data: {
                logMonitor: {
                  attributes:
                    buildKubernetesWarningEventsLogMonitor(CLUSTER).attributes,
                },
              },
            },
          ],
        },
      },
    };

    expect(isKubernetesWarningEventsMonitor(monitor, CLUSTER)).toBe(true);
    expect(
      isKubernetesWarningEventsMonitor({ monitorType: MonitorType.Logs }, CLUSTER),
    ).toBe(false);
  });

  test("finds every one of them, in the order they were read", () => {
    const first: KubernetesWarningEventsMonitorLike & { name: string } =
      logsMonitor(buildKubernetesWarningEventsLogMonitor(CLUSTER).attributes);
    const unrelated: KubernetesWarningEventsMonitorLike & { name: string } =
      logsMonitor({ "service.name": "api" });
    const second: KubernetesWarningEventsMonitorLike & { name: string } =
      logsMonitor({
        "resource.k8s.cluster.name": CLUSTER,
        "k8s.event.type": "Warning",
      });

    expect(
      findKubernetesWarningEventsMonitors([first, unrelated, second], CLUSTER),
    ).toEqual([first, second]);
    expect(findKubernetesWarningEventsMonitors([], CLUSTER)).toEqual([]);
  });
});

describe("the line's links", () => {
  test("Turn on selects the Warning Events recommendation on the cluster's Recommendations", () => {
    expect(KUBERNETES_WARNING_EVENTS_RECOMMENDATION_ID).toBe(
      "Kubernetes:k8s-warning-events",
    );
    expect(
      MonitorRecommendationCatalog.getRecommendationById(
        KUBERNETES_WARNING_EVENTS_RECOMMENDATION_ID,
      )?.name,
    ).toBe("Warning Events");
    /*
     * The ?select= value Recommendations reads back to the same id, once the
     * browser has decoded the address, as Navigation reads it.
     */
    const search: URLSearchParams = new URLSearchParams(
      `select=${RecommendationFilterUtil.toSelectionQuery([
        KUBERNETES_WARNING_EVENTS_RECOMMENDATION_ID,
      ])}`,
    );
    expect([
      ...RecommendationFilterUtil.parseSelectionQuery(search.get("select")),
    ]).toEqual([KUBERNETES_WARNING_EVENTS_RECOMMENDATION_ID]);
  });

  test("the alert filters on the attribute the Events views read the cluster by", () => {
    expect(KUBERNETES_CLUSTER_NAME_LOG_ATTRIBUTE).toBe(
      KUBERNETES_CLUSTER_NAME_ATTRIBUTE,
    );
  });
});

/*
 * Held in the source: the line reads the Logs monitors once, says nothing
 * until it knows, and is drawn last on the cluster's Events page.
 */
describe("the Events page draws the line", () => {
  const DASHBOARD_SRC: string = path.join(
    __dirname,
    "..",
    "..",
    "FeatureSet",
    "Dashboard",
    "src",
  );

  function code(relative: string): string {
    return fs
      .readFileSync(path.join(DASHBOARD_SRC, relative), "utf8")
      .replace(/\s+/g, " ");
  }

  test("last in the Events card, once the cluster's identifier is known", () => {
    const page: string = code("Pages/Kubernetes/View/Events.tsx");

    expect(page).toContain(
      'import KubernetesWarningEventsAlertLine from "../../../Components/Kubernetes/KubernetesWarningEventsAlertLine";',
    );
    expect(page).toContain(
      "{clusterIdentifier ? ( <KubernetesWarningEventsAlertLine clusterId={modelId} clusterIdentifier={clusterIdentifier} /> ) : ( <></> )} </Card>",
    );
  });

  test("the line reads the project's Logs monitors, with their steps", () => {
    const line: string = code(
      "Components/Kubernetes/KubernetesWarningEventsAlertLine.tsx",
    );

    expect(line).toContain("modelType: Monitor,");
    expect(line).toContain("query: { monitorType: MonitorType.Logs },");
    expect(line).toContain("monitorSteps: true,");
    expect(line).toContain("disableActiveMonitoring: true,");
    // Nothing until it knows, and nothing when it cannot.
    expect(line).toContain("if (!alertingMonitors) { return <></>; }");
  });

  test("the line's words are looked up whole", () => {
    const line: string = code(
      "Components/Kubernetes/KubernetesWarningEventsAlertLine.tsx",
    );

    for (const sentence of [
      'translator.translateText( "Get an alert when Kubernetes reports a warning.", )',
      'translator.translateText("Turn on warning alerts")',
      'template="Warnings raise alerts through {{monitor}}."',
      'template="Warnings raise alerts through {{monitor}} and {{others}}."',
    ]) {
      expect(line).toContain(sentence);
    }
  });
});
