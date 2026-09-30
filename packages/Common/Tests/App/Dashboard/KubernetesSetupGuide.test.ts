import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import {
  DEFAULT_KUBERNETES_PLATFORM,
  KUBERNETES_AGENT_HELM_NAMESPACE,
  KUBERNETES_AGENT_HELM_RELEASE,
  KUBERNETES_EXAMPLE_CLUSTER_NAME,
  KUBERNETES_PLATFORMS,
  KubernetesPlatform,
  getKubernetesAgentPreset,
  getKubernetesAgentUpgradeCommand,
  getKubernetesPlatformInstallFlags,
  getKubernetesSetupGuide,
  resolveKubernetesPlatform,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/DocumentationMarkdown";
import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideOption,
  SetupGuideStep,
  SetupGuideTopic,
  getSetupGuideCodeBlocks,
  getSetupGuideMarkdown,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";

/*
 * The Kubernetes agent guide asks where the cluster runs, then shows only
 * that platform's steps. These tests pin, for every platform:
 *
 *   - the right preset and flags in the install command (Autopilot and
 *     Fargate reject hostPath and privileged pods);
 *   - the platform's own way of connecting kubectl;
 *   - the pods a healthy install of that preset really runs;
 *   - that the advanced options stay out of the first-run steps;
 *   - that every chart value the guide sets exists in the chart — the old
 *     guide told people to `--set namespaceFilters.include=...`, which the
 *     chart's schema rejects, so the install failed.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const CHART_DIR: string = path.join(
  REPO_ROOT,
  "HelmChart",
  "Public",
  "kubernetes-agent",
);

const URL: string = "https://oneuptime.example.com";
const KEY: string = "tik_secret_123";

const PLATFORM_KEYS: Array<KubernetesPlatform> = KUBERNETES_PLATFORMS.map(
  (option: SetupGuideOption<KubernetesPlatform>): KubernetesPlatform => {
    return option.key;
  },
);

const RESTRICTED: Array<KubernetesPlatform> = ["gke-autopilot", "eks-fargate"];

const guideFor: (
  platform: KubernetesPlatform,
  overrides?: { clusterName?: string; apiKey?: string },
) => SetupGuideContent = (
  platform: KubernetesPlatform,
  overrides?: { clusterName?: string; apiKey?: string },
): SetupGuideContent => {
  return getKubernetesSetupGuide({
    oneuptimeUrl: URL,
    apiKey: overrides?.apiKey ?? KEY,
    platform: platform,
    clusterName: overrides?.clusterName,
  });
};

const stepTitled: (
  guide: SetupGuideContent,
  title: string,
) => SetupGuideStep = (
  guide: SetupGuideContent,
  title: string,
): SetupGuideStep => {
  const step: SetupGuideStep | undefined = guide.steps.find(
    (candidate: SetupGuideStep): boolean => {
      return candidate.title === title;
    },
  );
  if (!step) {
    throw new Error(`No step titled "${title}"`);
  }
  return step;
};

const topicTitles: (
  topics: Array<SetupGuideTopic> | undefined,
) => Array<string> = (
  topics: Array<SetupGuideTopic> | undefined,
): Array<string> => {
  return (topics || []).map((topic: SetupGuideTopic): string => {
    return topic.title;
  });
};

const installCommand: (guide: SetupGuideContent) => string = (
  guide: SetupGuideContent,
): string => {
  const markdown: string =
    stepTitled(guide, "Install the agent").markdown || "";
  const match: RegExpMatchArray | null = markdown.match(
    /helm install [\s\S]*?(?=\n```)/,
  );
  if (!match) {
    throw new Error("The install step has no helm install command");
  }
  return match[0];
};

describe("the platform picker", () => {
  test("offers the six places a cluster runs, standard first", () => {
    expect(PLATFORM_KEYS).toEqual([
      "standard",
      "eks",
      "gke",
      "aks",
      "gke-autopilot",
      "eks-fargate",
    ]);
    expect(DEFAULT_KUBERNETES_PLATFORM).toBe("standard");
  });

  test("every platform has a label and a one-line description", () => {
    for (const option of KUBERNETES_PLATFORMS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect((option.description || "").length).toBeGreaterThan(0);
      expect(option.description).not.toContain("\n");
    }
  });

  test("an unknown or missing platform resolves to standard", () => {
    for (const value of [undefined, null, "", "openshift", "EKS"]) {
      expect(resolveKubernetesPlatform(value)).toBe("standard");
    }
    expect(resolveKubernetesPlatform("gke-autopilot")).toBe("gke-autopilot");
  });

  test("maps each platform to the chart's preset", () => {
    expect(getKubernetesAgentPreset("standard")).toBe("standard");
    expect(getKubernetesAgentPreset("eks")).toBe("standard");
    expect(getKubernetesAgentPreset("gke")).toBe("standard");
    expect(getKubernetesAgentPreset("aks")).toBe("standard");
    expect(getKubernetesAgentPreset("gke-autopilot")).toBe("gke-autopilot");
    expect(getKubernetesAgentPreset("eks-fargate")).toBe("eks-fargate");
  });

  test("every preset the guide uses is one the chart documents", () => {
    const values: string = fs.readFileSync(
      path.join(CHART_DIR, "values.yaml"),
      "utf8",
    );
    for (const platform of PLATFORM_KEYS) {
      expect(values).toContain(`#   ${getKubernetesAgentPreset(platform)}`);
    }
  });
});

describe.each(PLATFORM_KEYS)("the %s guide", (platform: KubernetesPlatform) => {
  const guide: SetupGuideContent = guideFor(platform);
  const markdown: string = getSetupGuideMarkdown(guide);
  const isRestricted: boolean = RESTRICTED.includes(platform);

  test("is three short steps after the key: connect, install, verify", () => {
    expect(guide.steps).toHaveLength(3);
    expect(guide.steps[0]!.title).toMatch(/kubectl/);
    expect(guide.steps[1]!.title).toBe("Install the agent");
    expect(guide.steps[2]!.title).toBe("Verify the installation");
  });

  test("the install command installs the shared release into the shared namespace", () => {
    const command: string = installCommand(guide);
    expect(command).toMatch(
      new RegExp(
        `^helm install ${KUBERNETES_AGENT_HELM_RELEASE} oneuptime/kubernetes-agent \\\\\n  --namespace ${KUBERNETES_AGENT_HELM_NAMESPACE} \\\\\n  --create-namespace`,
      ),
    );
  });

  test("the install command carries the URL, the key and the cluster name", () => {
    const command: string = installCommand(guide);
    expect(command).toContain(`--set oneuptime.url="${URL}"`);
    expect(command).toContain(`--set oneuptime.apiKey="${KEY}"`);
    expect(command).toContain(
      `--set clusterName="${KUBERNETES_EXAMPLE_CLUSTER_NAME}"`,
    );
  });

  test("the install step adds the Helm repository first", () => {
    const install: string =
      stepTitled(guide, "Install the agent").markdown || "";
    const repoAdd: number = install.indexOf(
      "helm repo add oneuptime https://helm-chart.oneuptime.com",
    );
    expect(repoAdd).toBeGreaterThan(-1);
    expect(install.indexOf("helm repo update")).toBeGreaterThan(repoAdd);
    expect(install.indexOf("helm install")).toBeGreaterThan(repoAdd);
  });

  test("uses the preset and the eBPF switch only where the platform needs them", () => {
    const command: string = installCommand(guide);
    if (isRestricted) {
      expect(command).toContain(`--set preset=${platform}`);
      expect(command).toContain("--set ebpf.enabled=false");
      expect(getKubernetesPlatformInstallFlags(platform)).toEqual([
        `--set preset=${platform}`,
        "--set ebpf.enabled=false",
      ]);
    } else {
      expect(command).not.toContain("preset=");
      expect(command).not.toContain("ebpf.enabled");
      expect(getKubernetesPlatformInstallFlags(platform)).toEqual([]);
    }
  });

  test("the verify step lists the pods and says how long to wait", () => {
    const verify: string =
      stepTitled(guide, "Verify the installation").markdown || "";
    expect(verify).toContain(
      `kubectl get pods -n ${KUBERNETES_AGENT_HELM_NAMESPACE}`,
    );
    expect(verify).toContain("```output\nNAME ");
    expect(verify).toContain("appears automatically");
  });

  test("the verify step introduces the Kubernetes AI agent pod it lists", () => {
    const verify: string =
      stepTitled(guide, "Verify the installation").markdown || "";
    expect(verify).toContain(`${KUBERNETES_AGENT_HELM_RELEASE}-ai-agent-`);
    expect(verify).toContain(
      "**Kubernetes AI agent (on by default, read-only).**",
    );
    expect(verify).toContain(`\`${KUBERNETES_AGENT_HELM_RELEASE}-ai-agent\``);
    expect(verify).toContain("read-only kubectl");
    expect(verify).toContain("can change nothing");
    expect(verify).toContain("**AI → Agent**");
    expect(verify).toContain("`--set aiAgent.enabled=false`");
  });

  test("keeps configuration options out of the first-run steps", () => {
    const steps: string = guide.steps
      .map((step: SetupGuideStep): string => {
        return `${step.markdown || ""}${step.description || ""}`;
      })
      .join("\n");
    for (const advanced of [
      "namespaceFilters",
      "cost.enabled",
      "controlPlane.enabled",
      "logs.mode",
      "ebpf.features",
      "helm upgrade",
      "helm uninstall",
    ]) {
      expect(steps).not.toContain(advanced);
    }
  });

  test("has Advanced topics for namespaces, logs, cost, eBPF, labels and upgrades", () => {
    const titles: Array<string> = topicTitles(guide.advanced);
    for (const title of [
      "Monitor only some namespaces",
      "Control pod log collection",
      "Track what workloads cost",
      "Application traces (eBPF)",
      "Tag the cluster with project labels",
      "Upgrade or uninstall the agent",
      "What the agent collects",
    ]) {
      expect(titles).toContain(title);
    }
  });

  test("offers control plane metrics only on self-managed clusters", () => {
    expect(
      topicTitles(guide.advanced).includes("Collect control plane metrics"),
    ).toBe(platform === "standard");
  });

  test("filters namespaces with the rules the chart accepts", () => {
    expect(markdown).toContain("namespaceFilters.rules=");
    expect(markdown).not.toMatch(/namespaceFilters\.(include|exclude)/);
  });

  test("every topic has a plain one-line summary", () => {
    for (const topic of guide.advanced || []) {
      expect(topic.summary).toBeTruthy();
      // Summaries render as plain text, so no markdown.
      expect(topic.summary).not.toMatch(/[`*[\]]/);
      expect(topic.summary).not.toContain("\n");
    }
  });

  test("troubleshooting covers disconnects, missing metrics and the AI agent", () => {
    const titles: Array<string> = topicTitles(guide.troubleshooting);
    expect(titles).toContain('Cluster shows as "Disconnected"');
    expect(titles).toContain("No metrics appearing");
    expect(titles).toContain('AI → Agent shows "Offline" or "Not installed"');
  });

  test("troubleshooting matches how this platform collects logs and traces", () => {
    const titles: Array<string> = topicTitles(guide.troubleshooting);
    expect(titles.includes("No pod logs appearing")).toBe(isRestricted);
    expect(titles.includes("eBPF pods crash or fail to start")).toBe(
      !isRestricted,
    );
    expect(titles.includes("No application traces")).toBe(!isRestricted);
    expect(
      titles.includes("Install fails with a hostPath or Pod Security error"),
    ).toBe(!isRestricted);
    expect(titles.includes("Agent pods stay Pending")).toBe(
      platform === "eks-fargate",
    );
  });

  test("links to the full Kubernetes agent documentation", () => {
    expect(guide.links).toEqual([
      {
        title: "Kubernetes agent documentation",
        url: "/docs/telemetry/kubernetes-agent",
      },
    ]);
    expect(
      fs.existsSync(
        path.join(
          REPO_ROOT,
          "packages/App/FeatureSet/Docs/Content/en/telemetry/kubernetes-agent.md",
        ),
      ),
    ).toBe(true);
  });

  test("every helm command targets the shared release and namespace", () => {
    const pattern: RegExp =
      /helm (install|upgrade|uninstall) (\S+) (?:oneuptime\/kubernetes-agent[\s\\]+)?--namespace (\S+)/g;
    const found: Array<string> = [];
    for (const match of markdown.matchAll(pattern)) {
      found.push(match[0]);
      expect(match[2]).toBe(KUBERNETES_AGENT_HELM_RELEASE);
      expect(match[3]).toBe(KUBERNETES_AGENT_HELM_NAMESPACE);
    }
    expect(found.length).toBeGreaterThan(3);
  });
});

describe("connecting kubectl", () => {
  const connect: (platform: KubernetesPlatform) => string = (
    platform: KubernetesPlatform,
  ): string => {
    return guideFor(platform).steps[0]!.markdown || "";
  };

  test("standard clusters check the current context", () => {
    expect(connect("standard")).toContain("kubectl config current-context");
    expect(connect("standard")).toContain("kubectl config use-context");
  });

  test("EKS and EKS Fargate use aws eks update-kubeconfig", () => {
    for (const platform of [
      "eks",
      "eks-fargate",
    ] as Array<KubernetesPlatform>) {
      expect(connect(platform)).toContain(
        "aws eks update-kubeconfig --region <region> --name <cluster-name>",
      );
    }
  });

  test("GKE and GKE Autopilot use gcloud get-credentials", () => {
    for (const platform of [
      "gke",
      "gke-autopilot",
    ] as Array<KubernetesPlatform>) {
      expect(connect(platform)).toContain(
        "gcloud container clusters get-credentials <cluster-name>",
      );
    }
  });

  test("AKS uses az aks get-credentials", () => {
    expect(connect("aks")).toContain(
      "az aks get-credentials --resource-group <resource-group> --name <cluster-name>",
    );
  });

  test("every platform checks the connection with kubectl get nodes", () => {
    for (const platform of PLATFORM_KEYS) {
      expect(connect(platform)).toContain("kubectl get nodes");
    }
  });

  test("EKS Fargate gives the agent's namespace a Fargate profile", () => {
    expect(connect("eks-fargate")).toContain("eksctl create fargateprofile");
    expect(connect("eks-fargate")).toContain(
      `--namespace ${KUBERNETES_AGENT_HELM_NAMESPACE}`,
    );
    expect(connect("eks")).not.toContain("fargateprofile");
  });

  test("the prerequisites name the platform's CLI", () => {
    const prerequisites: (platform: KubernetesPlatform) => string = (
      platform: KubernetesPlatform,
    ): string => {
      return (guideFor(platform).prerequisites || []).join("\n");
    };
    expect(prerequisites("eks")).toContain("AWS CLI");
    expect(prerequisites("eks-fargate")).toContain("eksctl");
    expect(prerequisites("gke")).toContain("gcloud");
    expect(prerequisites("gke-autopilot")).toContain("gcloud");
    expect(prerequisites("aks")).toContain("Azure CLI");
    expect(prerequisites("standard")).not.toMatch(/AWS|gcloud|Azure/);
    for (const platform of PLATFORM_KEYS) {
      expect(prerequisites(platform)).toContain("v1.23");
      expect(prerequisites(platform)).toContain("`helm` (v3)");
    }
  });
});

describe("the pods each preset runs", () => {
  const listing: (platform: KubernetesPlatform) => string = (
    platform: KubernetesPlatform,
  ): string => {
    const verify: string =
      stepTitled(guideFor(platform), "Verify the installation").markdown || "";
    const match: RegExpMatchArray | null = verify.match(
      /```output\n([\s\S]*?)```/,
    );
    return match ? match[1]! : "";
  };

  const podNames: (platform: KubernetesPlatform) => Array<string> = (
    platform: KubernetesPlatform,
  ): Array<string> => {
    return listing(platform)
      .split("\n")
      .slice(1)
      .filter((line: string): boolean => {
        return line.trim().length > 0;
      })
      .map((line: string): string => {
        return line.split(/\s+/)[0]!;
      });
  };

  const release: string = KUBERNETES_AGENT_HELM_RELEASE;

  test("standard clusters run a log collector and an eBPF pod on every node", () => {
    for (const platform of [
      "standard",
      "eks",
      "gke",
      "aks",
    ] as Array<KubernetesPlatform>) {
      expect(podNames(platform)).toEqual([
        `${release}-xxxxxxxxxx-xxxxx`,
        `${release}-ai-agent-xxxxxxxxxx-xxxxx`,
        `${release}-ebpf-xxxxx`,
        `${release}-logs-xxxxx`,
      ]);
    }
  });

  test("GKE Autopilot reads logs from a Deployment and still runs the node collector", () => {
    expect(podNames("gke-autopilot")).toEqual([
      `${release}-xxxxxxxxxx-xxxxx`,
      `${release}-ai-agent-xxxxxxxxxx-xxxxx`,
      `${release}-logs-yyyyyyyyyy-yyyyy`,
      `${release}-logs-xxxxx`,
    ]);
  });

  test("EKS Fargate runs Deployments only", () => {
    const names: Array<string> = podNames("eks-fargate");
    expect(names).toEqual([
      `${release}-xxxxxxxxxx-xxxxx`,
      `${release}-ai-agent-xxxxxxxxxx-xxxxx`,
      `${release}-logs-yyyyyyyyyy-yyyyy`,
    ]);
    /*
     * Deployment pods carry a ReplicaSet hash before the pod suffix; a
     * DaemonSet pod (which Fargate never schedules) has the suffix alone.
     */
    for (const name of names) {
      expect(name).toMatch(/-[a-z]{10}-[a-z]{5}$/);
    }
  });

  test("no preset that turns eBPF off lists an eBPF pod", () => {
    for (const platform of RESTRICTED) {
      expect(listing(platform)).not.toContain("-ebpf-");
    }
  });

  test("every listing has the kubectl header and aligned columns", () => {
    for (const platform of PLATFORM_KEYS) {
      const lines: Array<string> = listing(platform).trimEnd().split("\n");
      expect(lines[0]).toMatch(/^NAME\s+READY\s+STATUS\s+RESTARTS\s+AGE$/);
      const readyColumn: number = lines[0]!.indexOf("READY");
      for (const line of lines.slice(1)) {
        expect(line.indexOf("1/1")).toBe(readyColumn);
      }
    }
  });
});

describe("the cluster name", () => {
  test("a product page suggests a name and says to replace it", () => {
    const install: string =
      stepTitled(guideFor("standard"), "Install the agent").markdown || "";
    expect(install).toContain(
      `Replace \`${KUBERNETES_EXAMPLE_CLUSTER_NAME}\` with a name for this cluster`,
    );
    expect(install).toContain("a new name registers a new cluster");
  });

  test("a cluster's own tab installs for that cluster and says to keep the name", () => {
    const guide: SetupGuideContent = guideFor("gke", {
      clusterName: "prod-eu-west-1",
    });
    const install: string =
      stepTitled(guide, "Install the agent").markdown || "";
    expect(installCommand(guide)).toContain(
      '--set clusterName="prod-eu-west-1"',
    );
    expect(install).toContain(
      "This installs the agent for **`prod-eu-west-1`**",
    );
    expect(install).not.toContain("Replace `");
    expect(getSetupGuideMarkdown(guide)).toContain(
      "this guide installs **`prod-eu-west-1`**",
    );
  });

  test("a blank name counts as unknown", () => {
    const guide: SetupGuideContent = guideFor("standard", {
      clusterName: "  ",
    });
    expect(installCommand(guide)).toContain(
      `--set clusterName="${KUBERNETES_EXAMPLE_CLUSTER_NAME}"`,
    );
  });
});

describe("before a key is picked", () => {
  test("the command shows the placeholder and the step says where to pick one", () => {
    const guide: SetupGuideContent = guideFor("standard", {
      apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
    });
    const install: string =
      stepTitled(guide, "Install the agent").markdown || "";
    expect(install).toContain(
      `--set oneuptime.apiKey="${SETUP_GUIDE_API_KEY_PLACEHOLDER}"`,
    );
    expect(install).toContain("Pick an ingestion key in step 1");
  });

  test("the note goes away once a key is picked", () => {
    const install: string =
      stepTitled(guideFor("standard"), "Install the agent").markdown || "";
    expect(install).not.toContain("Pick an ingestion key in step 1");
  });
});

describe("configuration changes", () => {
  test("reuse the installed values", () => {
    expect(getKubernetesAgentUpgradeCommand(["--set logs.enabled=false"])).toBe(
      [
        `helm upgrade ${KUBERNETES_AGENT_HELM_RELEASE} oneuptime/kubernetes-agent`,
        `  --namespace ${KUBERNETES_AGENT_HELM_NAMESPACE}`,
        "  --reuse-values",
        "  --set logs.enabled=false",
      ].join(" \\\n"),
    );
  });

  test("the eBPF topic explains the off switch on platforms that cannot run it", () => {
    for (const platform of RESTRICTED) {
      const topic: SetupGuideTopic | undefined = guideFor(
        platform,
      ).advanced?.find((candidate: SetupGuideTopic): boolean => {
        return candidate.title === "Application traces (eBPF)";
      });
      expect(topic?.markdown).toContain("ebpf.enabled=false");
      expect(topic?.markdown).toContain("OpenTelemetry SDK");
      expect(topic?.markdown).not.toContain("ebpf.features");
    }
  });

  test("Fargate's uninstall also removes the Fargate profile", () => {
    const fargate: string = getSetupGuideMarkdown(guideFor("eks-fargate"));
    expect(fargate).toContain("eksctl delete fargateprofile");
    expect(getSetupGuideMarkdown(guideFor("eks"))).not.toContain(
      "eksctl delete fargateprofile",
    );
  });

  test("Fargate's pending-pods fix recreates the pods after adding a profile", () => {
    const pending: SetupGuideTopic | undefined = guideFor(
      "eks-fargate",
    ).troubleshooting?.find((topic: SetupGuideTopic): boolean => {
      return topic.title === "Agent pods stay Pending";
    });
    expect(pending?.markdown).toContain("eksctl create fargateprofile");
    expect(pending?.markdown).toContain(
      `kubectl rollout restart deployment -n ${KUBERNETES_AGENT_HELM_NAMESPACE}`,
    );
  });
});

/*
 * Every value the guide sets must be a value the chart has. A typo, or a
 * value the chart renamed, is not a harmless doc bug: Helm installs happily
 * past an unknown `--set` (the value is ignored) unless the schema forbids
 * it, in which case the whole install fails.
 */
describe("every chart value the guide sets exists in the chart", () => {
  const values: Record<string, unknown> = yaml.load(
    fs.readFileSync(path.join(CHART_DIR, "values.yaml"), "utf8"),
  ) as Record<string, unknown>;
  const schema: Record<string, any> = JSON.parse(
    fs.readFileSync(path.join(CHART_DIR, "values.schema.json"), "utf8"),
  );

  interface SetFlag {
    kind: "--set" | "--set-json";
    key: string;
    value: string;
  }

  const allFlags: Array<SetFlag> = [];
  for (const platform of PLATFORM_KEYS) {
    for (const block of getSetupGuideCodeBlocks(guideFor(platform))) {
      for (const match of block.matchAll(
        /(--set-json|--set) (?:'([^'=]+)=([^']*)'|"?([A-Za-z0-9_.]+)=([^\s\\"]*)"?)/g,
      )) {
        allFlags.push({
          kind: match[1] as "--set" | "--set-json",
          key: (match[2] || match[4])!,
          value: (match[3] ?? match[5] ?? "").replace(/^"|"$/g, ""),
        });
      }
    }
  }

  const hasPath: (keyPath: string) => boolean = (keyPath: string): boolean => {
    let node: unknown = values;
    for (const part of keyPath.split(".")) {
      if (node === null || typeof node !== "object" || Array.isArray(node)) {
        return false;
      }
      const record: Record<string, unknown> = node as Record<string, unknown>;
      // A map the chart leaves empty (labels: {}) takes any key.
      if (Object.keys(record).length === 0) {
        return true;
      }
      if (!(part in record)) {
        return false;
      }
      node = record[part];
    }
    return true;
  };

  test("the guide sets values at all (harness guard)", () => {
    const keys: Array<string> = allFlags.map((flag: SetFlag): string => {
      return flag.key;
    });
    for (const expected of [
      "oneuptime.url",
      "oneuptime.apiKey",
      "clusterName",
      "preset",
      "ebpf.enabled",
      "namespaceFilters.rules",
      "filters.logs.minSeverity",
      "logs.enabled",
      "logs.mode",
      "controlPlane.enabled",
      "cost.enabled",
      "oneuptime.labels.team",
    ]) {
      expect(keys).toContain(expected);
    }
  });

  test("each key is a key of the chart's values.yaml", () => {
    const missing: Array<string> = allFlags
      .filter((flag: SetFlag): boolean => {
        return !hasPath(flag.key);
      })
      .map((flag: SetFlag): string => {
        return flag.key;
      });
    expect(missing).toEqual([]);
  });

  test("each --set-json value is JSON the schema accepts", () => {
    const ruleSchema: Record<string, any> =
      schema["properties"]["namespaceFilters"]["properties"]["rules"]["items"];
    const actions: Array<string> = ruleSchema["properties"]["action"]["enum"];
    const scopes: Array<string> =
      ruleSchema["properties"]["scopes"]["items"]["enum"];

    const jsonFlags: Array<SetFlag> = allFlags.filter((flag: SetFlag) => {
      return flag.kind === "--set-json";
    });
    expect(jsonFlags.length).toBeGreaterThan(0);

    for (const flag of jsonFlags) {
      const parsed: unknown = JSON.parse(flag.value);
      if (flag.key !== "namespaceFilters.rules") {
        continue;
      }
      expect(Array.isArray(parsed)).toBe(true);
      for (const rule of parsed as Array<Record<string, unknown>>) {
        expect(Object.keys(rule).sort()).toEqual([
          "action",
          "namespaces",
          "scopes",
        ]);
        expect(actions).toContain(rule["action"]);
        for (const scope of rule["scopes"] as Array<string>) {
          expect(scopes).toContain(scope);
        }
        expect((rule["namespaces"] as Array<string>).length).toBeGreaterThan(0);
      }
    }
  });

  // The schema node for a dotted values path, when the schema describes it.
  const schemaFor: (keyPath: string) => Record<string, any> | undefined = (
    keyPath: string,
  ): Record<string, any> | undefined => {
    let node: Record<string, any> | undefined = schema;
    for (const part of keyPath.split(".")) {
      node = node?.["properties"]?.[part];
      if (!node) {
        return undefined;
      }
    }
    return node;
  };

  test("each --set value is one the schema allows", () => {
    const checked: Array<string> = [];
    for (const flag of allFlags) {
      if (flag.kind !== "--set") {
        continue;
      }
      const node: Record<string, any> | undefined = schemaFor(flag.key);
      if (!node) {
        continue;
      }
      if (Array.isArray(node["enum"])) {
        expect({
          key: flag.key,
          allowed: node["enum"].includes(flag.value),
        }).toEqual({
          key: flag.key,
          allowed: true,
        });
        checked.push(flag.key);
      }
      if (node["type"] === "boolean") {
        expect(["true", "false"]).toContain(flag.value);
        checked.push(flag.key);
      }
    }
    // Harness guard: the enum and boolean values were actually checked.
    for (const key of [
      "preset",
      "logs.mode",
      "filters.logs.minSeverity",
      "ebpf.enabled",
      "logs.enabled",
    ]) {
      expect(checked).toContain(key);
    }
  });
});
