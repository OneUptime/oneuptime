import {
  KubernetesNodeBenchmarkBlock,
  NODE_BENCHMARK_BLOCK_VERSION,
  NODE_BENCHMARK_ERROR_MAX_LENGTH,
  NODE_BENCHMARK_FOR_PROVIDER,
  NODE_BENCHMARK_MESSAGE_MAX_LENGTH,
  NodeBenchmarkFamily,
  NodeBenchmarkTarget,
  getNodeBenchmarkFamily,
  getNodeBenchmarkRequirement,
  isNodeBenchmarkName,
  isNodeBenchmarkPod,
  isNodeBenchmarkRequirement,
  readNodeBenchmarkMessage,
  readNodeBenchmarkRequirement,
  sortCheckIds,
  toNodeBenchmarkBlock,
} from "../../../Types/Kubernetes/KubernetesNodeBenchmark";
import {
  CONTROL_PLANE_CIS_1_12,
  KUBE_BENCH_COULD_NOT_FINISH,
  WORKER_AKS_1_8,
  WORKER_CIS_1_12,
  WORKER_EKS_1_8_0,
  WORKER_GKE_1_9_0,
  WORKER_K3S_CIS_1_9,
} from "./Compliance/KubeBenchFixtures";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT KUBE-BENCH FOUND ON A NODE, AS ITS POD SAYS IT (#9873).
 *
 * The chart's kube-bench container writes each check's number by its result
 * as its termination message, and the inventory reads it into a block of the
 * pod's spec. The fixtures are what kube-bench v0.16.0 and the chart's own
 * jq program wrote on a real kind cluster, for the generic benchmark on a
 * control plane node and a worker, and for each managed platform's.
 */

const FINISHED_AT: string = "2026-11-19T22:41:07Z";

function read(message: string): KubernetesNodeBenchmarkBlock {
  const block: KubernetesNodeBenchmarkBlock | null = readNodeBenchmarkMessage(
    message,
    FINISHED_AT,
  );

  if (!block) {
    throw new Error("The message was refused");
  }

  return block;
}

describe("reading what kube-bench wrote on real nodes", () => {
  test("a control plane node's generic benchmark: every target it found running, each check by its result", () => {
    const block: KubernetesNodeBenchmarkBlock = read(CONTROL_PLANE_CIS_1_12);

    expect(block.version).toBe(NODE_BENCHMARK_BLOCK_VERSION);
    expect(block.benchmark).toBe("cis-1.12");
    expect(block.targets).toEqual([
      NodeBenchmarkTarget.Master,
      NodeBenchmarkTarget.Etcd,
      NodeBenchmarkTarget.ControlPlane,
      NodeBenchmarkTarget.Node,
    ]);
    expect(block.pass).toHaveLength(53);
    expect(block.fail).toEqual([
      "1.1.12",
      "1.2.5",
      "1.2.15",
      "1.2.16",
      "1.2.17",
      "1.2.18",
      "1.2.19",
      "1.2.30",
      "1.3.2",
      "1.4.1",
      "4.1.1",
      "4.1.9",
    ]);
    expect(block.warn).toEqual([]);
    expect(block.manual).toHaveLength(32);
    expect(block.manual).toContain("3.2.1");
    expect(block.finishedAt).toBe("2026-11-19T22:41:07.000Z");
    expect(block.error).toBeUndefined();
  });

  test("a worker's generic benchmark: the node target alone, as kube-bench found no API server there", () => {
    const block: KubernetesNodeBenchmarkBlock = read(WORKER_CIS_1_12);

    expect(block.targets).toEqual([NodeBenchmarkTarget.Node]);
    expect(block.pass).toEqual([
      "4.1.2",
      "4.1.5",
      "4.1.6",
      "4.1.10",
      "4.2.1",
      "4.2.2",
      "4.2.3",
      "4.2.6",
      "4.2.10",
      "4.3.1",
    ]);
    expect(block.fail).toEqual(["4.1.1", "4.1.9"]);
    expect(block.manual).toEqual([
      "4.1.3",
      "4.1.4",
      "4.1.7",
      "4.1.8",
      "4.2.4",
      "4.2.5",
      "4.2.7",
      "4.2.8",
      "4.2.9",
      "4.2.11",
      "4.2.12",
      "4.2.13",
      "4.2.14",
    ]);
  });

  test("each managed platform's benchmark: its worker node section, numbered its own way", () => {
    const eks: KubernetesNodeBenchmarkBlock = read(WORKER_EKS_1_8_0);
    const gke: KubernetesNodeBenchmarkBlock = read(WORKER_GKE_1_9_0);
    const aks: KubernetesNodeBenchmarkBlock = read(WORKER_AKS_1_8);

    expect([eks.benchmark, eks.pass.length, eks.fail]).toEqual([
      "eks-1.8.0",
      11,
      ["3.2.4", "3.2.9"],
    ]);
    expect([gke.benchmark, gke.pass, gke.fail]).toEqual([
      "gke-1.9.0",
      ["3.1.3", "3.1.4"],
      ["3.1.1", "3.1.2"],
    ]);
    expect([aks.benchmark, aks.pass.length, aks.fail]).toEqual([
      "aks-1.8",
      10,
      ["3.2.4", "3.2.7", "3.2.9"],
    ]);

    for (const block of [eks, gke, aks]) {
      expect(block.targets).toEqual([NodeBenchmarkTarget.Node]);
      expect(block.manual).toEqual([]);
    }
  });

  test("a benchmark the page does not score is still read, and its checks kube-bench skipped kept apart", () => {
    const block: KubernetesNodeBenchmarkBlock = read(WORKER_K3S_CIS_1_9);

    expect(block.benchmark).toBe("k3s-cis-1.9");
    expect(block.warn).toEqual(["4.1.1", "4.1.2", "4.1.9", "4.1.10", "4.2.7"]);
    expect(getNodeBenchmarkFamily(block.benchmark)).toBeNull();
  });

  test("a run kube-bench could not finish keeps why, and no result", () => {
    const block: KubernetesNodeBenchmarkBlock = read(
      KUBE_BENCH_COULD_NOT_FINISH,
    );

    expect(block.benchmark).toBe("cis-1.12");
    expect(block.error).toBe(
      "error looking for file /etc/systemd/system/kubelet.service.d/10-kubeadm.conf: stat /etc/systemd/system/kubelet.service.d/10-kubeadm.conf: permission denied exit status 1",
    );
    expect(block.error!.length).toBeLessThanOrEqual(
      NODE_BENCHMARK_ERROR_MAX_LENGTH,
    );
    expect([block.pass, block.fail, block.warn, block.manual]).toEqual([
      [],
      [],
      [],
      [],
    ]);
  });
});

describe("refusing what is not the chart's message", () => {
  test("not JSON, another container's message, another version, or no benchmark", () => {
    for (const message of [
      "",
      "Completed",
      "panic: runtime error",
      '{"benchmark":"cis-1.12","pass":"1.1.1"}',
      '{"oneuptimeNodeBenchmark":2,"benchmark":"cis-1.12","pass":"1.1.1"}',
      '{"oneuptimeNodeBenchmark":"1","benchmark":"cis-1.12","pass":"1.1.1"}',
      '{"oneuptimeNodeBenchmark":1,"pass":"1.1.1"}',
      '{"oneuptimeNodeBenchmark":1,"benchmark":"CIS 1.12","pass":"1.1.1"}',
      '{"oneuptimeNodeBenchmark":1,"benchmark":"cis","pass":"1.1.1"}',
      '[{"oneuptimeNodeBenchmark":1}]',
    ]) {
      expect([message, readNodeBenchmarkMessage(message)]).toEqual([
        message,
        null,
      ]);
    }
  });

  test("a message longer than the kubelet keeps is refused, never read in part", () => {
    const long: string = JSON.stringify({
      oneuptimeNodeBenchmark: 1,
      benchmark: "cis-1.12",
      pass: Array.from({ length: 900 }, (_value: unknown, index: number) => {
        return `4.2.${index}`;
      }).join(" "),
    });

    expect(long.length).toBeGreaterThan(NODE_BENCHMARK_MESSAGE_MAX_LENGTH);
    expect(readNodeBenchmarkMessage(long)).toBeNull();
  });

  test("a run that reported nothing, and gave no reason, says nothing", () => {
    expect(
      readNodeBenchmarkMessage(
        '{"oneuptimeNodeBenchmark":1,"benchmark":"cis-1.12","targets":"node","pass":"","fail":"","warn":"","manual":""}',
      ),
    ).toBeNull();
  });

  test("keeps only check numbers: a forged or broken entry is dropped, never shown", () => {
    const block: KubernetesNodeBenchmarkBlock = read(
      JSON.stringify({
        oneuptimeNodeBenchmark: 1,
        benchmark: "cis-1.12",
        targets: "node policies managedservices /etc master",
        pass: "4.2.1 ../etc/passwd <script>alert(1)</script> 4.2.x 4..2 4.2.1",
        fail: "4.1.1 4.1.1",
        warn: "",
        manual: "",
      }),
    );

    expect(block.pass).toEqual(["4.2.1"]);
    expect(block.fail).toEqual(["4.1.1"]);
    // Only the targets the page scores, in kube-bench's order.
    expect(block.targets).toEqual([
      NodeBenchmarkTarget.Master,
      NodeBenchmarkTarget.Node,
    ]);
  });

  test("a check said both passing and failing reads failing, and a scored one is never also manual", () => {
    const block: KubernetesNodeBenchmarkBlock = read(
      JSON.stringify({
        oneuptimeNodeBenchmark: 1,
        benchmark: "cis-1.12",
        targets: "node",
        pass: "4.2.1 4.2.2 4.2.3",
        fail: "4.2.1",
        warn: "4.2.2",
        manual: "4.2.3 4.2.4",
      }),
    );

    expect(block.fail).toEqual(["4.2.1"]);
    expect(block.warn).toEqual(["4.2.2"]);
    expect(block.pass).toEqual(["4.2.3"]);
    expect(block.manual).toEqual(["4.2.4"]);
  });

  test("an error is one line, keeps its end where a log says what stopped it, and takes the place of any result", () => {
    const block: KubernetesNodeBenchmarkBlock = read(
      JSON.stringify({
        oneuptimeNodeBenchmark: 1,
        benchmark: "eks-1.8.0",
        error: `${"x".repeat(600)} first line\n\n   second\tline exit status 1`,
        pass: "3.2.1",
      }),
    );

    expect(
      block.error!.endsWith("x first line second line exit status 1"),
    ).toBe(true);
    expect(block.error).toHaveLength(NODE_BENCHMARK_ERROR_MAX_LENGTH);
    expect(block.pass).toEqual([]);
  });

  test("a time it cannot read is left out", () => {
    expect(
      readNodeBenchmarkMessage(WORKER_CIS_1_12, "yesterday")?.finishedAt,
    ).toBeUndefined();
    expect(
      readNodeBenchmarkMessage(WORKER_CIS_1_12)?.finishedAt,
    ).toBeUndefined();
  });
});

describe("a stored block, read back", () => {
  test("reads back as it was stored", () => {
    const block: KubernetesNodeBenchmarkBlock = read(CONTROL_PLANE_CIS_1_12);

    expect(toNodeBenchmarkBlock(JSON.parse(JSON.stringify(block)))).toEqual(
      block,
    );
  });

  test("another version, or a block that is not one, reads as none", () => {
    const block: KubernetesNodeBenchmarkBlock = read(WORKER_CIS_1_12);

    expect(toNodeBenchmarkBlock({ ...block, version: 2 })).toBeNull();
    expect(toNodeBenchmarkBlock(null)).toBeNull();
    expect(toNodeBenchmarkBlock("cis-1.12")).toBeNull();
    expect(toNodeBenchmarkBlock([block])).toBeNull();
  });

  test("a tampered list keeps only the check numbers in it", () => {
    expect(
      toNodeBenchmarkBlock({
        version: NODE_BENCHMARK_BLOCK_VERSION,
        benchmark: "cis-1.12",
        targets: ["node", 4],
        pass: ["4.2.1", { id: "4.2.2" }, 7, "4.2.10", "4.2.9"],
        fail: "not a list",
        warn: [],
        manual: [],
      }),
    ).toEqual({
      version: NODE_BENCHMARK_BLOCK_VERSION,
      benchmark: "cis-1.12",
      targets: [NodeBenchmarkTarget.Node],
      pass: ["4.2.1", "4.2.9", "4.2.10"],
      fail: [],
      warn: [],
      manual: [],
    });
  });
});

describe("telling the chart's kube-bench pods", () => {
  test("by their component label alone", () => {
    expect(isNodeBenchmarkPod({ component: "node-benchmark" })).toBe(true);
    expect(isNodeBenchmarkPod({ component: "log-collector" })).toBe(false);
    expect(isNodeBenchmarkPod({ app: "kube-bench" })).toBe(false);
    expect(isNodeBenchmarkPod(null)).toBe(false);
    expect(isNodeBenchmarkPod(undefined)).toBe(false);
  });
});

describe("benchmarks, their families, and the requirements their checks are scored under", () => {
  test("the generic benchmark and each managed platform's are families; the others are not scored", () => {
    expect(
      [
        "cis-1.12",
        "cis-1.11",
        "cis-1.10",
        "eks-1.8.0",
        "gke-1.9.0",
        "aks-1.8",
        "k3s-cis-1.9",
        "rke2-cis-1.9",
        "rh-1.9",
        "ack-1.0",
      ].map((benchmark: string) => {
        return [benchmark, getNodeBenchmarkFamily(benchmark)];
      }),
    ).toEqual([
      ["cis-1.12", NodeBenchmarkFamily.Cis],
      ["cis-1.11", NodeBenchmarkFamily.Cis],
      ["cis-1.10", NodeBenchmarkFamily.Cis],
      ["eks-1.8.0", NodeBenchmarkFamily.Eks],
      ["gke-1.9.0", NodeBenchmarkFamily.Gke],
      ["aks-1.8", NodeBenchmarkFamily.Aks],
      ["k3s-cis-1.9", null],
      ["rke2-cis-1.9", null],
      ["rh-1.9", null],
      ["ack-1.0", null],
    ]);
  });

  test("a managed platform's check is named with its platform, so 3.2.1 is never the generic benchmark's", () => {
    expect(getNodeBenchmarkRequirement(NodeBenchmarkFamily.Cis, "4.2.1")).toBe(
      "4.2.1",
    );
    expect(getNodeBenchmarkRequirement(NodeBenchmarkFamily.Eks, "3.2.1")).toBe(
      "EKS 3.2.1",
    );
    expect(getNodeBenchmarkRequirement(NodeBenchmarkFamily.Gke, "3.1.1")).toBe(
      "GKE 3.1.1",
    );
    expect(getNodeBenchmarkRequirement(NodeBenchmarkFamily.Aks, "3.2.9")).toBe(
      "AKS 3.2.9",
    );
  });

  test("a requirement names its family and check back", () => {
    expect(readNodeBenchmarkRequirement("1.2.15")).toEqual({
      family: NodeBenchmarkFamily.Cis,
      checkId: "1.2.15",
    });
    expect(readNodeBenchmarkRequirement("2.1")).toEqual({
      family: NodeBenchmarkFamily.Cis,
      checkId: "2.1",
    });
    expect(readNodeBenchmarkRequirement("EKS 3.2.1")).toEqual({
      family: NodeBenchmarkFamily.Eks,
      checkId: "3.2.1",
    });

    // Section 5 is the API's; a platform's own checks are its section 3.
    for (const requirement of [
      "5.1.1",
      "EKS 4.1.1",
      "GKE 5.1.1",
      "3",
      // A group's number is no check's: etcd's checks have two parts, the rest three.
      "4.1",
      "1.2",
      "2.1.1",
      "EKS 3.2",
      "4.1.1.1",
      "Privileged Containers",
      "",
    ]) {
      expect([requirement, isNodeBenchmarkRequirement(requirement)]).toEqual([
        requirement,
        false,
      ]);
    }
  });

  test("each managed platform's cluster is pointed at its newest benchmark", () => {
    expect(NODE_BENCHMARK_FOR_PROVIDER).toEqual({
      EKS: "eks-1.8.0",
      GKE: "gke-1.9.0",
      AKS: "aks-1.8",
    });
  });

  test("a benchmark's name as kube-bench names its configuration", () => {
    expect(isNodeBenchmarkName("cis-1.12")).toBe(true);
    expect(isNodeBenchmarkName("eks-stig-kubernetes-v1r6")).toBe(true);
    expect(isNodeBenchmarkName("../cfg")).toBe(false);
    expect(isNodeBenchmarkName("cis 1.12")).toBe(false);
    expect(isNodeBenchmarkName(12)).toBe(false);
  });

  test("check numbers sort as numbers, each once", () => {
    expect(sortCheckIds(["1.2.10", "1.2.9", "2.1", "1.10.1", "1.2.9"])).toEqual(
      ["1.2.9", "1.2.10", "1.10.1", "2.1"],
    );
  });
});
