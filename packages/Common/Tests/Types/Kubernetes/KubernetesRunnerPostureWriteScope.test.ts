import {
  KubernetesRunnerPosture,
  parseKubernetesRunnerPosture,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";

/*
 * The in-cluster Runner reports where AI-composed kubectl writes may land
 * (the namespaces its chart bound write RBAC in; an empty list is
 * cluster-wide) and the namespace its own pod runs in, which it never
 * writes to. The server reads both from Runner.hostInfo.kubernetes, which
 * the Runner itself rewrites on every heartbeat — so the parse is strict
 * about shapes and never invents a value.
 */
describe("parseKubernetesRunnerPosture: the write scope", () => {
  it("parses the write namespaces and the pod namespace", () => {
    const posture: KubernetesRunnerPosture | undefined =
      parseKubernetesRunnerPosture({
        kubernetes: {
          clusterIdentifier: "prod-us",
          inCluster: true,
          allowWrites: true,
          writeNamespaces: ["web", "api"],
          podNamespace: "oneuptime-agent",
        },
      });

    expect(posture?.writeNamespaces).toEqual(["web", "api"]);
    expect(posture?.podNamespace).toBe("oneuptime-agent");
  });

  it("keeps an empty list, which means cluster-wide", () => {
    expect(
      parseKubernetesRunnerPosture({ kubernetes: { writeNamespaces: [] } })
        ?.writeNamespaces,
    ).toEqual([]);
  });

  it("leaves both absent for a Runner that predates them", () => {
    const posture: KubernetesRunnerPosture | undefined =
      parseKubernetesRunnerPosture({
        kubernetes: { clusterIdentifier: "prod-us", inCluster: true },
      });

    expect(posture?.writeNamespaces).toBeUndefined();
    expect(posture?.podNamespace).toBeUndefined();
  });

  it("drops values of the wrong shape rather than coercing them", () => {
    const posture: KubernetesRunnerPosture | undefined =
      parseKubernetesRunnerPosture({
        kubernetes: {
          writeNamespaces: ["web", 42, "", null, { a: 1 }, "api"],
          podNamespace: 7,
        },
      });

    expect(posture?.writeNamespaces).toEqual(["web", "api"]);
    expect(posture?.podNamespace).toBeUndefined();

    const notAList: KubernetesRunnerPosture | undefined =
      parseKubernetesRunnerPosture({
        kubernetes: { writeNamespaces: "web,api", podNamespace: "" },
      });

    expect(notAList?.writeNamespaces).toBeUndefined();
    expect(notAList?.podNamespace).toBeUndefined();
  });
});
