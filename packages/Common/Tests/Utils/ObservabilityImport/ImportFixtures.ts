import fs from "fs";
import path from "path";
import zlib from "zlib";

/*
 * The real exports the import is tested against (issue #7697), each as its
 * tool wrote it, kept in Tests/Fixtures/ObservabilityImport:
 *
 *   grafana-node-exporter-full.json.gz      Grafana's "Node Exporter Full"
 *   grafana-node-exporter-full-old.json.gz  its old version (graph and
 *                                           singlestat panels, schema 14)
 *     from github.com/rfmoz/grafana-dashboards (Apache-2.0)
 *   grafana-k8s-views-namespaces.json.gz    "Kubernetes / Views / ..." with
 *   grafana-k8s-views-pods.json.gz          All and multi-value variables
 *     from github.com/dotdc/grafana-dashboards-kubernetes (Apache-2.0)
 *   prometheus-rule-node-exporter.yaml      a PrometheusRule resource
 *     from github.com/prometheus-operator/kube-prometheus (Apache-2.0)
 *   datadog-dashboard-*.json, datadog-monitor-*.json
 *     Datadog's integration assets, from github.com/DataDog/integrations-core
 *     (BSD-3-Clause): the NGINX, Redis, Postgres and Vault (legacy)
 *     dashboards; NGINX's and Postgres' anomaly monitors and the Kubernetes
 *     Cluster Autoscaler's forecast (issue #10325); the Cisco ACI,
 *     FoundationDB, Squid, iboss, Zscaler Private Access and SNMP log
 *     monitors (issue #10324)
 *
 * The other files there are written for these tests, in the shapes the
 * tools document: they hold what no public export of a free licence does.
 */

const FIXTURES: string = path.resolve(
  __dirname,
  "../../Fixtures/ObservabilityImport",
);

export const readFixture: (name: string) => string = (name: string): string => {
  const file: string = path.join(FIXTURES, name);
  const bytes: Buffer = fs.readFileSync(file);

  return name.endsWith(".gz")
    ? zlib.gunzipSync(bytes).toString("utf8")
    : bytes.toString("utf8");
};
