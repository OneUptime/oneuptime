import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { parseYaml } from "Common/Tests/Helpers/Yaml";

/*
 * The Route, Service and DeploymentConfig pages (issue #5477). They compose
 * tables and tabs no node harness renders (packages/E2E/OpenShiftPages draws
 * them in a browser), so what they must keep doing is pinned here by reading
 * the sources, comments stripped and whitespace squashed so Prettier reflows
 * and rationale comments cannot make a test pass or fail.
 */

const REPOSITORY: string = path.join(__dirname, "..", "..", "..", "..");
const DASHBOARD_SRC: string = path.join(
  REPOSITORY,
  "packages",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:])\/\/[^\n]*/g;
const WHITESPACE: RegExp = /\s+/g;

function source(relativePath: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8")
    .replace(BLOCK_COMMENT, "")
    .replace(LINE_COMMENT, "$1")
    .replace(WHITESPACE, " ");
}

const LIST_PAGES: Array<[string, string]> = [
  [
    "Pages/Kubernetes/View/OpenShiftRoutes.tsx",
    "KUBERNETES_CLUSTER_VIEW_ROUTE_DETAIL",
  ],
  [
    "Pages/Kubernetes/View/Services.tsx",
    "KUBERNETES_CLUSTER_VIEW_SERVICE_DETAIL",
  ],
  [
    "Pages/Kubernetes/View/DeploymentConfigs.tsx",
    "KUBERNETES_CLUSTER_VIEW_DEPLOYMENTCONFIG_DETAIL",
  ],
];

const DETAIL_PAGES: Array<string> = [
  "Pages/Kubernetes/View/OpenShiftRouteDetail.tsx",
  "Pages/Kubernetes/View/ServiceDetail.tsx",
  "Pages/Kubernetes/View/DeploymentConfigDetail.tsx",
];

describe("names repeat across namespaces", () => {
  test.each(LIST_PAGES)(
    "%s opens the row's own namespace",
    (page: string, detailPage: string) => {
      const code: string = source(page);

      expect(code).toContain(`PageMap.${detailPage}`);
      expect(code).toContain(
        ".addQueryParams({ namespace: resource.namespace })",
      );
    },
  );

  test.each(DETAIL_PAGES)(
    "%s reads the namespace it was given",
    (page: string) => {
      const code: string = source(page);

      expect(code).toContain('Navigation.getQueryStringByName("namespace")');
      expect(code).toContain("namespace: namespace");
    },
  );

  test("a link to a Service, and back to a Route, carries the namespace", () => {
    expect(source("Pages/Kubernetes/View/OpenShiftRouteDetail.tsx")).toContain(
      "namespace={objectData.metadata.namespace}",
    );
    expect(source("Pages/Kubernetes/View/ServiceDetail.tsx")).toContain(
      "namespace={route.metadata.namespace}",
    );
    /*
     * Every namespaced kind's link carries its namespace now, through the
     * one helper the part pages share (KubernetesPartRoutes).
     */
    const link: string = source(
      "Components/Kubernetes/KubernetesResourceLink.tsx",
    );
    expect(link).toContain("getKubernetesPartRoute(props.modelId, {");
    expect(link).toContain("namespace: props.namespace,");
    expect(source("Pages/Kubernetes/Utils/KubernetesPartRoutes.ts")).toContain(
      "return part.namespace && NAMESPACED_KUBERNETES_KINDS.has(part.kind)",
    );
  });
});

describe("the pages read what ingest stores", () => {
  test("a Route's and a DeploymentConfig's list show the state in the phase column", () => {
    for (const page of [
      "Pages/Kubernetes/View/OpenShiftRoutes.tsx",
      "Pages/Kubernetes/View/DeploymentConfigs.tsx",
    ]) {
      expect(source(page)).toContain('resource.status = row.phase || ""');
    }
  });

  test("a Route has no CPU or memory, and a Service no state either", () => {
    expect(source("Pages/Kubernetes/View/OpenShiftRoutes.tsx")).toContain(
      "showResourceMetrics={false}",
    );

    const services: string = source("Pages/Kubernetes/View/Services.tsx");

    expect(services).toContain("showResourceMetrics={false}");
    expect(services).toContain("showStatus={false}");
  });

  test("a stored row with no spec cannot take a list down", () => {
    for (const [page] of LIST_PAGES) {
      expect(source(page)).toContain("(row.spec || {})");
    }
  });
});

describe("a DeploymentConfig's pods", () => {
  const code: string = source(
    "Pages/Kubernetes/View/DeploymentConfigDetail.tsx",
  );
  const CHART: string = path.join(
    REPOSITORY,
    "HelmChart",
    "Public",
    "kubernetes-agent",
    "templates",
    "_helpers.tpl",
  );

  test("are charted by the label, never by k8s.deployment.name", () => {
    expect(code).toContain(
      "[DEPLOYMENT_CONFIG_POD_ATTRIBUTE]: deploymentConfigName",
    );
    expect(code).not.toContain("resource.k8s.deployment.name");
  });

  test("the attribute is the tag the chart's collectors write", () => {
    const helpers: string = fs.readFileSync(CHART, "utf8");
    const block: string | undefined = helpers
      .split('{{- define "kubernetes-agent.deploymentConfigPodLabel" -}}')[1]
      ?.split("{{- end -}}")[0];
    const labels: Array<{ tag_name: string; key: string; from: string }> =
      parseYaml(block || "") as Array<{
        tag_name: string;
        key: string;
        from: string;
      }>;

    expect(labels).toEqual([
      {
        tag_name: "k8s.pod.label.deploymentconfig",
        key: "deploymentconfig",
        from: "pod",
      },
    ]);
  });

  test("are added up on the list through the API's DeploymentConfig owner", () => {
    expect(source("Pages/Kubernetes/View/DeploymentConfigs.tsx")).toContain(
      "fetchPodMetricsByOwner( modelId, OpenShiftKind.DeploymentConfig, )",
    );
  });

  test("a pod's page shows the DeploymentConfig that owns it, in its namespace", () => {
    const pod: string = source("Pages/Kubernetes/View/PodDetail.tsx");

    expect(pod).toContain("getPodOwnerReferences(podObject.metadata)");
    expect(pod).toContain("namespace={podObject?.metadata.namespace}");
  });
});

describe("the menu and the Overview grow only where these objects are", () => {
  const menu: string = source("Pages/Kubernetes/View/SideMenu.tsx");
  const overview: string = source("Pages/Kubernetes/View/Index.tsx");

  test("the rows are drawn from the inventory's counts", () => {
    expect(menu).toContain("{counts.deploymentConfigs ? (");
    expect(menu).toContain("{counts.routes || counts.services ? (");
  });

  test("the layout hands them to the menu", () => {
    const layout: string = source("Pages/Kubernetes/View/Layout.tsx");

    expect(layout).toContain(
      'deploymentConfigs: readNum("deploymentConfigCount")',
    );
    expect(layout).toContain('routes: readNum("routeCount")');
    expect(layout).toContain('services: readNum("serviceCount")');
  });

  test("the Overview's quick links are added only when there are some", () => {
    expect(overview).toContain("if (deploymentConfigCount > 0) {");
    expect(overview).toContain("if (routeCount > 0) {");
    expect(overview).toContain("if (serviceCount > 0) {");
  });
});

describe("every page has its route", () => {
  const routes: string = source("Routes/KubernetesRoutes.tsx");
  const breadcrumbs: string = source(
    "Utils/Breadcrumbs/KubernetesBreadcrumbs.ts",
  );

  test.each([
    "KUBERNETES_CLUSTER_VIEW_DEPLOYMENTCONFIGS",
    "KUBERNETES_CLUSTER_VIEW_DEPLOYMENTCONFIG_DETAIL",
    "KUBERNETES_CLUSTER_VIEW_ROUTES",
    "KUBERNETES_CLUSTER_VIEW_ROUTE_DETAIL",
    "KUBERNETES_CLUSTER_VIEW_SERVICES",
    "KUBERNETES_CLUSTER_VIEW_SERVICE_DETAIL",
  ])("%s", (page: string) => {
    expect(routes).toContain(`PageMap.${page}`);
    expect(breadcrumbs).toContain(`PageMap.${page}`);
  });
});

describe("an Event's object leads to its page", () => {
  const table: string = source(
    "Components/Kubernetes/KubernetesEventsTable.tsx",
  );

  test("a Route, a Service and a DeploymentConfig have one", () => {
    expect(table).toContain(
      "DeploymentConfig: PageMap.KUBERNETES_CLUSTER_VIEW_DEPLOYMENTCONFIG_DETAIL",
    );
    expect(table).toContain(
      "Route: PageMap.KUBERNETES_CLUSTER_VIEW_ROUTE_DETAIL",
    );
    expect(table).toContain(
      "Service: PageMap.KUBERNETES_CLUSTER_VIEW_SERVICE_DETAIL",
    );
  });

  test("names repeat, so the kinds that do ask for the namespace", () => {
    // Every namespaced kind's page reads it (KubernetesPartRoutes).
    expect(table).toContain(
      "const PAGES_THAT_READ_THE_NAMESPACE: ReadonlySet<string> = NAMESPACED_KUBERNETES_KINDS;",
    );
    expect(table).toContain(
      "data.namespace && PAGES_THAT_READ_THE_NAMESPACE.has(kind)",
    );
    expect(table).toContain("namespace={row.namespace}");
    expect(table).toContain("namespace: row.namespace");
    expect(
      source("Components/Kubernetes/KubernetesRecentWarningsCard.tsx"),
    ).toContain("namespace={warning.namespace}");
  });

  test("a rollout's ReplicationController opens its DeploymentConfig", () => {
    expect(table).toContain(
      'kind = kind === "ReplicaSet" ? "Deployment" : "DeploymentConfig"',
    );
  });
});
