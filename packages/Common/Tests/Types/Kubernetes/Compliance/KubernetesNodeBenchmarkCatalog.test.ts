import { NodeBenchmarkFamily } from "../../../../Types/Kubernetes/KubernetesNodeBenchmark";
import {
  NODE_BENCHMARK_FIX_TEMPLATES,
  NodeBenchmarkControlInfo,
  findNodeBenchmarkControlInfo,
  getNamedNodeBenchmarkChecks,
  getNodeBenchmarkControlInfo,
  getNodeBenchmarkSection,
  getNodeBenchmarkSections,
} from "../../../../Types/Kubernetes/Compliance/KubernetesNodeBenchmarkCatalog";
import {
  KubernetesComplianceControlInfo,
  KubernetesComplianceFramework,
  findKubernetesComplianceControl,
} from "../../../../Types/Kubernetes/Compliance/KubernetesComplianceCatalog";
import {
  CONTROL_PLANE_CIS_1_12,
  WORKER_AKS_1_8,
  WORKER_CIS_1_12,
  WORKER_EKS_1_8_0,
  WORKER_GKE_1_9_0,
  getAutomatedChecks,
} from "./KubeBenchFixtures";
import { describe, expect, test } from "@jest/globals";

/*
 * THE CIS BENCHMARKS' NODE AND CONTROL PLANE CONTROLS, IN ONEUPTIME'S WORDS (#9873).
 *
 * Every check kube-bench v0.16.0 scores - marks automated - for the
 * benchmarks the chart runs has a short title of OneUptime's own and a fix
 * with what to set or run drawn as code; none is the benchmark's text,
 * which CIS licenses for non-commercial use. The fixtures are what it scored
 * on a real kind cluster.
 */

const FAMILY_FIXTURES: ReadonlyArray<{
  family: NodeBenchmarkFamily;
  messages: ReadonlyArray<string>;
}> = [
  {
    family: NodeBenchmarkFamily.Cis,
    messages: [CONTROL_PLANE_CIS_1_12, WORKER_CIS_1_12],
  },
  { family: NodeBenchmarkFamily.Eks, messages: [WORKER_EKS_1_8_0] },
  { family: NodeBenchmarkFamily.Gke, messages: [WORKER_GKE_1_9_0] },
  { family: NodeBenchmarkFamily.Aks, messages: [WORKER_AKS_1_8] },
];

function placeholders(template: string): Array<string> {
  return Array.from(template.matchAll(/\{\{(\w+)\}\}/g))
    .map((match: RegExpMatchArray): string => {
      return match[1] || "";
    })
    .sort();
}

describe("every check kube-bench scores on a real node is named", () => {
  test("each family's catalog names exactly the checks kube-bench v0.16.0 scored", () => {
    for (const { family, messages } of FAMILY_FIXTURES) {
      const scored: Array<string> = Array.from(
        new Set(messages.flatMap(getAutomatedChecks)),
      );

      expect([family, [...scored].sort()]).toEqual([
        family,
        [...getNamedNodeBenchmarkChecks(family)].sort(),
      ]);
    }
  });

  test("the generic benchmark's control plane node scored all 65 of its automated controls", () => {
    expect(getAutomatedChecks(CONTROL_PLANE_CIS_1_12)).toHaveLength(65);
    expect(getNamedNodeBenchmarkChecks(NodeBenchmarkFamily.Cis)).toHaveLength(
      65,
    );
  });

  test("a check no catalog names is still scored, by its number, as kube-bench's", () => {
    const info: NodeBenchmarkControlInfo = getNodeBenchmarkControlInfo(
      NodeBenchmarkFamily.Cis,
      "4.2.99",
    );

    expect(info.title).toBe("Checked by kube-bench");
    expect(info.requirement).toBe("4.2.99");
    expect(info.fix.template).toBe("");
  });
});

describe("each control's words", () => {
  test("a short title of OneUptime's own, never the benchmark's recommendation", () => {
    for (const family of Object.values(NodeBenchmarkFamily)) {
      for (const checkId of getNamedNodeBenchmarkChecks(family)) {
        const info: NodeBenchmarkControlInfo = getNodeBenchmarkControlInfo(
          family,
          checkId,
        );

        expect([info.requirement, info.title.length > 0]).toEqual([
          info.requirement,
          true,
        ]);
        expect(info.title.length).toBeLessThanOrEqual(70);
        expect(info.title).not.toMatch(/^Ensure|\((Automated|Manual)\)/);
        expect(info.title).not.toMatch(/\.$/);
      }
    }
  });

  test("a fix is one of the catalog's sentences, with every slot it names filled with code", () => {
    for (const family of Object.values(NodeBenchmarkFamily)) {
      for (const checkId of getNamedNodeBenchmarkChecks(family)) {
        const info: NodeBenchmarkControlInfo = getNodeBenchmarkControlInfo(
          family,
          checkId,
        );

        expect(NODE_BENCHMARK_FIX_TEMPLATES).toContain(info.fix.template);
        expect([info.requirement, placeholders(info.fix.template)]).toEqual([
          info.requirement,
          Object.keys(info.fix.slots).sort(),
        ]);

        for (const value of Object.values(info.fix.slots)) {
          expect(value.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  test("every fix sentence is a sentence", () => {
    for (const template of NODE_BENCHMARK_FIX_TEMPLATES) {
      expect(template).toMatch(/^[A-Z{].*\.$/);
    }
  });

  test("a managed platform's check says what the generic benchmark's says where it checks the same thing", () => {
    const pairs: Array<[NodeBenchmarkFamily, string, string]> = [
      [NodeBenchmarkFamily.Eks, "3.2.1", "4.2.1"],
      [NodeBenchmarkFamily.Eks, "3.2.2", "4.2.2"],
      [NodeBenchmarkFamily.Aks, "3.2.3", "4.2.3"],
      [NodeBenchmarkFamily.Aks, "3.2.6", "4.2.6"],
      [NodeBenchmarkFamily.Eks, "3.2.8", "4.2.10"],
      [NodeBenchmarkFamily.Gke, "3.1.2", "4.1.6"],
    ];

    for (const [family, managed, generic] of pairs) {
      expect(getNodeBenchmarkControlInfo(family, managed).title).toBe(
        getNodeBenchmarkControlInfo(NodeBenchmarkFamily.Cis, generic).title,
      );
    }
  });

  test("and keeps its own paths: a platform's nodes keep the kubelet's files elsewhere", () => {
    expect(
      getNodeBenchmarkControlInfo(NodeBenchmarkFamily.Eks, "3.1.3").fix.slots,
    ).toEqual({ setting: "chmod 644 /etc/kubernetes/kubelet/config.json" });
    expect(
      getNodeBenchmarkControlInfo(NodeBenchmarkFamily.Gke, "3.1.3").fix.slots,
    ).toEqual({ setting: "chmod 644 /home/kubernetes/kubelet-config.yaml" });
    expect(
      getNodeBenchmarkControlInfo(NodeBenchmarkFamily.Aks, "3.1.3").fix.slots,
    ).toEqual({ setting: "chmod 644 /etc/default/kubeletconfig.json" });
    expect(
      getNodeBenchmarkControlInfo(NodeBenchmarkFamily.Cis, "4.1.9").fix.slots,
    ).toEqual({ setting: "chmod 600 /var/lib/kubelet/config.yaml" });
  });

  test("a flag the API server must have, add or leave out, as code", () => {
    expect(
      getNodeBenchmarkControlInfo(NodeBenchmarkFamily.Cis, "1.2.15").fix,
    ).toEqual({
      template:
        "Set {{setting}} in the API server's manifest on each control plane node.",
      slots: { setting: "--profiling=false" },
    });
    expect(
      getNodeBenchmarkControlInfo(NodeBenchmarkFamily.Cis, "1.2.14").fix,
    ).toEqual({
      template:
        "Add {{value}} to the API server's {{flag}} on each control plane node.",
      slots: { value: "NodeRestriction", flag: "--enable-admission-plugins" },
    });
    expect(
      getNodeBenchmarkControlInfo(NodeBenchmarkFamily.Cis, "1.2.6").fix,
    ).toEqual({
      template:
        "Leave {{value}} out of the API server's {{flag}} on each control plane node.",
      slots: { value: "AlwaysAllow", flag: "--authorization-mode" },
    });
  });
});

describe("sections", () => {
  test("each check is in its benchmark's section, and the control plane's are said to be", () => {
    expect(getNodeBenchmarkSection(NodeBenchmarkFamily.Cis, "1.2.15")?.id).toBe(
      "1.2",
    );
    expect(getNodeBenchmarkSection(NodeBenchmarkFamily.Cis, "2.1")?.id).toBe(
      "2",
    );
    expect(getNodeBenchmarkSection(NodeBenchmarkFamily.Cis, "4.2.1")?.id).toBe(
      "4.2",
    );
    expect(getNodeBenchmarkSection(NodeBenchmarkFamily.Eks, "3.2.1")?.id).toBe(
      "3.2",
    );
    expect(
      getNodeBenchmarkControlInfo(NodeBenchmarkFamily.Cis, "1.1.12")
        .isControlPlane,
    ).toBe(true);
    expect(
      getNodeBenchmarkControlInfo(NodeBenchmarkFamily.Cis, "4.1.1")
        .isControlPlane,
    ).toBe(false);
    expect(
      getNodeBenchmarkControlInfo(NodeBenchmarkFamily.Eks, "3.1.1")
        .isControlPlane,
    ).toBe(false);
  });

  test("each section says what its controls look at, and a control says its section's", () => {
    for (const family of Object.values(NodeBenchmarkFamily)) {
      for (const section of getNodeBenchmarkSections(family)) {
        expect(section.description).toMatch(/\.$/);
      }

      for (const checkId of getNamedNodeBenchmarkChecks(family)) {
        expect(getNodeBenchmarkControlInfo(family, checkId).description).toBe(
          getNodeBenchmarkSection(family, checkId)?.description,
        );
      }
    }
  });
});

describe("a node control as every other control reads", () => {
  test("found by its requirement in the CIS framework, as a numbered control read on the nodes", () => {
    const generic: KubernetesComplianceControlInfo | undefined =
      findKubernetesComplianceControl(
        KubernetesComplianceFramework.CisKubernetes,
        "1.2.16",
      );
    const eks: KubernetesComplianceControlInfo | undefined =
      findKubernetesComplianceControl(
        KubernetesComplianceFramework.CisKubernetes,
        "EKS 3.2.4",
      );

    expect(generic).toEqual({
      framework: KubernetesComplianceFramework.CisKubernetes,
      requirement: "1.2.16",
      isNumbered: true,
      title: "API server: audit log",
      description:
        "The API server's flags, as it runs on each control plane node.",
      fix: "Set {{setting}} in the API server's manifest on each control plane node.",
      fixSlots: { setting: "--audit-log-path=<file>" },
      isNodeControl: true,
    });
    expect(eks?.title).toBe("Kubelet: read-only port closed");
    expect(eks?.fixSlots).toEqual({ setting: "readOnlyPort: 0" });
    expect(findNodeBenchmarkControlInfo("5.1.1")).toBeNull();
    expect(
      findKubernetesComplianceControl(
        KubernetesComplianceFramework.PssBaseline,
        "1.2.16",
      ),
    ).toBeUndefined();
  });

  test("the API's controls keep their own words: 5.x is never a node control", () => {
    const control: KubernetesComplianceControlInfo | undefined =
      findKubernetesComplianceControl(
        KubernetesComplianceFramework.CisKubernetes,
        "5.1.10",
      );

    expect(control?.isNodeControl).toBeUndefined();
    expect(control?.title).toBe("Least access to the nodes/proxy subresource");
  });
});
