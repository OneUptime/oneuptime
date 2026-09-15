import { describe, expect, test } from "@jest/globals";
import { workloadNameForReplica } from "../../FeatureSet/Dashboard/src/Components/Topology/WorkloadNaming";

/*
 * Replica names are read back to the workload they belong to so a fleet can
 * be shown as one row. A false match would merge unrelated resources, so the
 * negative cases matter as much as the positive ones.
 */

describe("workloadNameForReplica", () => {
  test.each([
    // Deployment pods: <deployment>-<ReplicaSet hash>-<pod suffix>.
    ["oneuptime-app-685856b7d7-48xkt", "oneuptime-app"],
    ["oneuptime-probe-one-7c8d9f5b6-bq2zt", "oneuptime-probe-one"],
    ["checkout-6d4f8b9c7d-x2k9p", "checkout"],
    // DaemonSet / Job pods: <name>-<suffix with a digit>.
    ["node-exporter-x2k9p", "node-exporter"],
    ["fluent-bit-9zq4m", "fluent-bit"],
    // StatefulSet pods and numbered hosts.
    ["postgres-2", "postgres"],
    ["web-03", "web"],
    ["kafka_0", "kafka"],
    ["db1", "db"],
  ])("%s → %s", (name: string, workload: string) => {
    expect(workloadNameForReplica(name)).toBe(workload);
  });

  test.each([
    ["api-gateway"], // an ordinary hyphenated name
    ["worker-plant"], // five letters, but no generated digit
    ["build-server"],
    ["ip-10-0-1-23"], // an address spelled as a hostname
    ["10.0.0.12"],
    ["checkout-1-02"],
    ["api-6d4f8b9c7d-aeiou"], // vowels never appear in generated suffixes
    [""],
    ["   "],
  ])("%s is not a replica name", (name: string) => {
    expect(workloadNameForReplica(name)).toBeNull();
  });
});
