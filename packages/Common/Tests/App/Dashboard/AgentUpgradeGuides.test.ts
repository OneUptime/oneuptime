import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  AGENT_KINDS,
  AgentKind,
  AgentLatestVersionSource,
  HOST_COLLECTOR_VERSION,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AgentVersion/AgentKind";
import {
  AgentUpgradeGuide,
  AgentUpgradeMethod,
  AgentUpgradeStep,
  getAgentUpgradeGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AgentVersion/AgentUpgradeGuides";
import {
  SetupGuideContent,
  SetupGuideOption,
  SetupGuideStep,
  SetupGuideStepVariant,
  SetupGuideTopic,
  getSetupGuideCodeBlocks,
  getSetupGuideMarkdown,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import {
  KUBERNETES_AGENT_HELM_NAMESPACE,
  KUBERNETES_AGENT_HELM_RELEASE,
  KUBERNETES_PLATFORMS,
  KubernetesPlatform,
  getKubernetesAgentChartUpgradeCommand,
  getKubernetesAgentChartUpgradeFallbackCommand,
  getKubernetesSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/DocumentationMarkdown";
import {
  DOCKER_AGENT_CONTAINER_NAME,
  DOCKER_AGENT_IMAGE,
  DOCKER_AI_AGENT_CONTAINER_NAME,
  DOCKER_AI_AGENT_IMAGE,
  DOCKER_INSTALL_METHODS,
  DockerInstallMethod,
  getDockerAgentUpgradeCommand,
  getDockerSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/Utils/DocumentationMarkdown";
import {
  PODMAN_AGENT_CONTAINER_NAME,
  PODMAN_AGENT_IMAGE,
  PODMAN_AI_AGENT_CONTAINER_NAME,
  PODMAN_AI_AGENT_IMAGE,
  PODMAN_INSTALL_METHODS,
  PodmanInstallMethod,
  getPodmanAgentUpgradeCommand,
  getPodmanSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/Utils/DocumentationMarkdown";
import {
  DOCKER_SWARM_AGENT_COMPOSE_UPGRADE_COMMAND,
  DOCKER_SWARM_AGENT_FILES,
  DOCKER_SWARM_INSTALL_METHODS,
  DockerSwarmInstallMethod,
  getDockerSwarmAgentDownloadCommand,
  getDockerSwarmAgentInstallScriptCommand,
  getDockerSwarmSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/Utils/DocumentationMarkdown";
import {
  DATABASE_AGENT_INSTALL_DIRECTORY,
  DATABASE_AGENT_RECREATE_COMMAND,
  getDatabaseAgentDownloadCommand,
  getDatabaseAgentSetupGuide,
  getDatabaseAgentUpgradeCommand,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DocumentationMarkdown";
import {
  DATABASE_AGENT_ENGINES,
  DatabaseAgentEngine,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseAgentConfigs";
import {
  RUNNER_CONTAINER_NAME,
  RUNNER_IMAGE,
  getRunnerUpgradeCommand,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerImage";
import {
  PROXMOX_AGENT_INSTALL_DIR,
  PROXMOX_AGENT_RAW_URL,
  PROXMOX_AGENT_RECREATE_COMMAND,
  PROXMOX_CONNECT_METHODS,
  ProxmoxConnectMethod,
  getProxmoxAgentDownloadCommand,
  getProxmoxAgentUpgradeCommand,
  getProxmoxSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/Utils/DocumentationMarkdown";
import {
  CEPH_AGENT_INSTALL_DIR,
  CEPH_AGENT_RAW_URL,
  CEPH_AGENT_RECREATE_COMMAND,
  CEPH_INSTALL_METHODS,
  CephInstallMethod,
  getCephAgentDownloadCommand,
  getCephAgentUpgradeCommand,
  getCephSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/Utils/DocumentationMarkdown";
import {
  VMWARE_AGENT_INSTALL_DIR,
  VMWARE_AGENT_RAW_URL,
  VMWARE_AGENT_RECREATE_COMMAND,
  VMWARE_INSTALL_METHODS,
  VMwareInstallMethod,
  getVMwareAgentDownloadCommand,
  getVMwareAgentUpgradeCommand,
  getVMwareNativeUpgradeCommand,
  getVMwareSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Utils/DocumentationMarkdown";
import {
  STORAGE_ARRAY_AGENT_FILES,
  STORAGE_ARRAY_AGENT_INSTALL_DIR,
  STORAGE_ARRAY_AGENT_RAW_URL,
  STORAGE_ARRAY_AGENT_RECREATE_COMMAND,
  STORAGE_ARRAY_PLATFORMS,
  StorageArrayPlatform,
  getStorageArrayAgentDownloadCommand,
  getStorageArrayAgentUpgradeCommand,
  getStorageArraySetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/Utils/DocumentationMarkdown";
import {
  HOST_COLLECTOR_METHODS,
  HOST_COLLECTOR_UPGRADE_TOPIC_TITLE,
  HOST_INSTALL_METHODS,
  HostCollectorMethod,
  HostInstallMethod,
  getHostCollectorMethodsForOsType,
  getHostCollectorUpgradeCommand,
  getHostSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/Utils/DocumentationMarkdown";
import {
  COMPOSE_DIRECTORY_COMMENT,
  getResourceAiAgentInstall,
  getResourceAiAgentServiceName,
  getResourceAiAgentUpgradeCommand,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentInstall";
import AiResourceType, {
  ALL_AI_RESOURCE_TYPES,
} from "../../../Types/ResourceAiAgent/AiResourceType";

/*
 * The dialog beside an outdated agent version says how to upgrade THAT kind
 * of agent. Its commands are never written twice: each comes from the setup
 * guide that installs the agent, and these tests hold every command the
 * dialog shows to a code block the guide itself shows, for every way of
 * installing - so an edit to a guide reaches the dialog, and a dialog can
 * never tell someone to run a command the guide does not.
 */

const URL: string = "https://oneuptime.example.com";
const KEY: string = "tik_secret_123";

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const EN_LOCALE: Record<string, string> = JSON.parse(
  fs.readFileSync(
    path.join(
      REPO_ROOT,
      "packages/App/FeatureSet/Dashboard/src/Locales/en.json",
    ),
    "utf8",
  ),
) as Record<string, string>;

function guideFor(
  kind: AgentKind,
  context?: Parameters<typeof getAgentUpgradeGuide>[1],
): AgentUpgradeGuide {
  const guide: AgentUpgradeGuide | null = getAgentUpgradeGuide(kind, context);
  expect(guide).not.toBeNull();
  return guide as AgentUpgradeGuide;
}

function methodLabelled(
  guide: AgentUpgradeGuide,
  label: string,
): AgentUpgradeMethod {
  const method: AgentUpgradeMethod | undefined = guide.methods.find(
    (candidate: AgentUpgradeMethod): boolean => {
      return candidate.label === label;
    },
  );
  expect(method).toBeDefined();
  return method as AgentUpgradeMethod;
}

function codesOf(method: AgentUpgradeMethod): Array<string> {
  return method.steps
    .map((step: AgentUpgradeStep): string | undefined => {
      return step.code;
    })
    .filter((code: string | undefined): code is string => {
      return Boolean(code);
    });
}

// Every command a method shows is one of the guide's own code blocks.
function expectCommandsFromGuide(
  method: AgentUpgradeMethod,
  guide: SetupGuideContent,
): void {
  const blocks: Array<string> = getSetupGuideCodeBlocks(guide).map(
    (block: string): string => {
      return block.trim();
    },
  );
  const codes: Array<string> = codesOf(method);
  expect(codes.length).toBeGreaterThan(0);
  for (const code of codes) {
    expect(blocks).toContain(code.trim());
  }
}

function upgradeTopicOf(
  guide: SetupGuideContent,
  title: string = "Upgrade or uninstall the agent",
): SetupGuideTopic {
  const topic: SetupGuideTopic | undefined = (guide.advanced || []).find(
    (candidate: SetupGuideTopic): boolean => {
      return candidate.title === title;
    },
  );
  expect(topic).toBeDefined();
  return topic as SetupGuideTopic;
}

function labelsOf(guide: AgentUpgradeGuide): Array<string> {
  return guide.methods.map((method: AgentUpgradeMethod): string => {
    return method.label;
  });
}

// The code blocks of a topic's markdown, trimmed, in order.
function topicCodeBlocks(topic: SetupGuideTopic): Array<string> {
  return getSetupGuideCodeBlocks({
    steps: [],
    advanced: [topic],
  }).map((block: string): string => {
    return block.trim();
  });
}

describe("which kinds have an upgrade guide", () => {
  test("every kind OneUptime releases has one; no other kind does", () => {
    for (const kind of Object.values(AgentKind)) {
      const hasNewest: boolean =
        AGENT_KINDS[kind].latestVersionSource !== AgentLatestVersionSource.None;
      expect({ kind, hasGuide: getAgentUpgradeGuide(kind) !== null }).toEqual({
        kind,
        hasGuide: hasNewest,
      });
    }
  });

  test("every guide has a way with at least one command to copy", () => {
    for (const kind of Object.values(AgentKind)) {
      const guide: AgentUpgradeGuide | null = getAgentUpgradeGuide(kind);
      if (!guide) {
        continue;
      }
      expect(guide.methods.length).toBeGreaterThan(0);
      for (const method of guide.methods) {
        expect(method.steps.length).toBeGreaterThan(0);
      }
      expect(codesOf(guide.methods[0]!).length).toBeGreaterThan(0);
    }
  });

  test("every title, description, label and note is an English key the locales carry", () => {
    const contexts: Array<Parameters<typeof getAgentUpgradeGuide>[1]> = [
      {},
      { databaseEngine: "postgresql", databaseRunsInKubernetes: true },
      { hostOsType: "linux" },
      { hostOsType: "windows" },
      { hostOsType: "darwin" },
    ];
    for (const kind of Object.values(AgentKind)) {
      for (const context of contexts) {
        const guide: AgentUpgradeGuide | null = getAgentUpgradeGuide(
          kind,
          context,
        );
        for (const method of guide?.methods || []) {
          const texts: Array<string> = [method.label];
          if (method.note) {
            texts.push(method.note);
          }
          for (const step of method.steps) {
            texts.push(step.title);
            if (step.description) {
              texts.push(step.description);
            }
          }
          for (const text of texts) {
            expect({ kind, text, inLocale: EN_LOCALE[text] === text }).toEqual({
              kind,
              text,
              inLocale: true,
            });
          }
        }
      }
    }
  });
});

/*
 * Where a step needs the setup guide (a command only the guide can fill in,
 * with a key picked there), the dialog links to it when the page passes the
 * guide's route. App/Tests/Dashboard/AgentVersionDisplayGuard.test.ts holds
 * every page drawing one of these kinds to passing setupGuideRoute, with the
 * same list: change both together.
 */
describe("the kinds whose upgrade needs the setup guide", () => {
  const NEEDS_SETUP_GUIDE: Array<AgentKind> = [
    AgentKind.DockerAgent,
    AgentKind.PodmanAgent,
    AgentKind.DatabaseAgent,
    AgentKind.HostCollector,
  ];

  test("are exactly these, in every context", () => {
    const contexts: Array<Parameters<typeof getAgentUpgradeGuide>[1]> = [
      {},
      { databaseEngine: "postgresql", databaseRunsInKubernetes: true },
      { hostOsType: "windows" },
    ];
    const needing: Set<AgentKind> = new Set();
    for (const kind of Object.values(AgentKind)) {
      for (const context of contexts) {
        for (const method of getAgentUpgradeGuide(kind, context)?.methods ||
          []) {
          for (const step of method.steps) {
            if (step.needsSetupGuide) {
              needing.add(kind);
            }
          }
        }
      }
    }
    expect([...needing].sort()).toEqual([...NEEDS_SETUP_GUIDE].sort());
  });
});

/*
 * The words of a shell command line, continuations joined: what the shell
 * hands each command in it. `&&` and `>` stay words of their own, so a
 * command's flags are told apart from the next command's.
 */
function shellWords(command: string): Array<string> {
  return command
    .replace(/\\\n/g, " ")
    .split(/\s+/)
    .filter((word: string): boolean => {
      return word.length > 0;
    });
}

// Every `helm upgrade` in a command, as the words up to the next command.
function helmUpgrades(command: string): Array<Array<string>> {
  const upgrades: Array<Array<string>> = [];
  for (const line of command.replace(/\\\n/g, " ").split("\n")) {
    const words: Array<string> = shellWords(line);
    words.forEach((word: string, index: number) => {
      if (word === "helm" && words[index + 1] === "upgrade") {
        const end: number = words.findIndex(
          (candidate: string, at: number): boolean => {
            return at > index && (candidate === "&&" || candidate === ";");
          },
        );
        upgrades.push(words.slice(index, end < 0 ? words.length : end));
      }
    });
  }
  return upgrades;
}

/*
 * `helm upgrade --reuse-values` renders the new chart with the previous
 * release's values, the old chart's defaults included (Helm replaces the new
 * chart's values.yaml with them), so a default the new chart changed — the
 * eBPF image a cluster was found still running — never applies. Helm 3.14+
 * has --reset-then-reuse-values, which keeps only the values the release was
 * given; an older Helm gets the same from `helm get values` (without --all)
 * passed back with -f.
 */
describe("Kubernetes agent: upgrade the Helm release", () => {
  const guide: AgentUpgradeGuide = guideFor(AgentKind.KubernetesAgent);

  test("a tab for Helm 3.14 or later first, and one for older Helm", () => {
    expect(labelsOf(guide)).toEqual([
      "Helm 3.14 or later",
      "Helm 3.13 or earlier",
    ]);
    for (const method of guide.methods) {
      expect(method.steps).toHaveLength(1);
      expect(method.steps[0]!.title).toBe("Upgrade the Helm release");
    }
  });

  test("Helm 3.14 or later: the chart upgrade that keeps the release's values and takes the new chart's defaults", () => {
    expect(codesOf(guide.methods[0]!)).toEqual([
      getKubernetesAgentChartUpgradeCommand(),
    ]);
    expect(getKubernetesAgentChartUpgradeCommand()).toBe(
      [
        "helm repo update",
        `helm upgrade ${KUBERNETES_AGENT_HELM_RELEASE} oneuptime/kubernetes-agent \\`,
        `  --namespace ${KUBERNETES_AGENT_HELM_NAMESPACE} \\`,
        "  --reset-then-reuse-values",
      ].join("\n"),
    );
    expect(guide.methods[0]!.steps[0]!.description).toContain(
      "--reset-then-reuse-values keeps the values you set",
    );
  });

  test("older Helm: the release's own values saved, then passed back with -f", () => {
    expect(codesOf(guide.methods[1]!)).toEqual([
      getKubernetesAgentChartUpgradeFallbackCommand(),
    ]);
    expect(getKubernetesAgentChartUpgradeFallbackCommand()).toBe(
      [
        "helm repo update",
        `helm get values ${KUBERNETES_AGENT_HELM_RELEASE} --namespace ${KUBERNETES_AGENT_HELM_NAMESPACE} -o yaml > values.yaml && \\`,
        `  helm upgrade ${KUBERNETES_AGENT_HELM_RELEASE} oneuptime/kubernetes-agent \\`,
        `  --namespace ${KUBERNETES_AGENT_HELM_NAMESPACE} -f values.yaml`,
      ].join("\n"),
    );

    const words: Array<string> = shellWords(
      getKubernetesAgentChartUpgradeFallbackCommand(),
    );
    const getValues: number = words.indexOf("get");
    /*
     * The values the release was given, as YAML (the default table output
     * has a header -f cannot read), never --all, which would pin every
     * default of the old chart again.
     */
    expect(words.slice(getValues - 1, getValues + 6)).toEqual([
      "helm",
      "get",
      "values",
      KUBERNETES_AGENT_HELM_RELEASE,
      "--namespace",
      KUBERNETES_AGENT_HELM_NAMESPACE,
      "-o",
    ]);
    expect(words).not.toContain("--all");
    expect(words).not.toContain("-a");
    // The upgrade runs only when the values were saved: an empty file would drop every setting.
    expect(words[words.indexOf("values.yaml") + 1]).toBe("&&");
    const upgrades: Array<Array<string>> = helmUpgrades(
      getKubernetesAgentChartUpgradeFallbackCommand(),
    );
    expect(upgrades).toHaveLength(1);
    expect(upgrades[0]!.slice(-2)).toEqual(["-f", "values.yaml"]);
  });

  test("no tab recommends --reuse-values, and each says why not", () => {
    for (const method of guide.methods) {
      for (const code of codesOf(method)) {
        const upgrades: Array<Array<string>> = helmUpgrades(code);
        expect(upgrades).toHaveLength(1);
        expect(upgrades[0]).not.toContain("--reuse-values");
        expect(upgrades[0]!.slice(0, 4)).toEqual([
          "helm",
          "upgrade",
          KUBERNETES_AGENT_HELM_RELEASE,
          "oneuptime/kubernetes-agent",
        ]);
        // Either Helm's flag or the saved values: something keeps the release's settings.
        expect(
          upgrades[0]!.includes("--reset-then-reuse-values") ||
            upgrades[0]!.includes("-f"),
        ).toBe(true);
      }
      expect(method.note).toBe(
        "Not --reuse-values: it also keeps the old chart's defaults, so the new chart's defaults (a newer eBPF image among them) never apply.",
      );
    }
  });

  // Harness guard: the parser does see a --reuse-values upgrade where there is one.
  test("the command parser finds --reuse-values in a command that has it", () => {
    expect(
      helmUpgrades(
        "helm repo update\nhelm upgrade r oneuptime/kubernetes-agent \\\n  --reuse-values",
      )[0],
    ).toContain("--reuse-values");
    expect(
      helmUpgrades("helm upgrade r c --reset-then-reuse-values")[0],
    ).not.toContain("--reuse-values");
  });

  test.each(
    KUBERNETES_PLATFORMS.map((option: SetupGuideOption<KubernetesPlatform>) => {
      return [option.key];
    }),
  )(
    "both are the commands the %s guide's upgrade topic shows",
    (platform: string) => {
      const setupGuide: SetupGuideContent = getKubernetesSetupGuide({
        oneuptimeUrl: URL,
        apiKey: KEY,
        platform: platform as KubernetesPlatform,
      });
      for (const method of guide.methods) {
        expectCommandsFromGuide(method, setupGuide);
      }
      const topic: SetupGuideTopic = upgradeTopicOf(setupGuide);
      expect(topicCodeBlocks(topic)).toEqual(
        expect.arrayContaining([
          getKubernetesAgentChartUpgradeCommand(),
          getKubernetesAgentChartUpgradeFallbackCommand(),
        ]),
      );
      expect(topic.markdown).toContain("Don't use `--reuse-values`");
      // No command in the guide, upgrade topic or not, is a --reuse-values upgrade.
      for (const block of getSetupGuideCodeBlocks(setupGuide)) {
        for (const upgrade of helmUpgrades(block)) {
          expect({ block, upgrade }).toEqual({
            block,
            upgrade: upgrade.filter((word: string): boolean => {
              return word !== "--reuse-values";
            }),
          });
        }
      }
    },
  );
});

describe("Docker agent: a tab per install method", () => {
  const guide: AgentUpgradeGuide = guideFor(AgentKind.DockerAgent);

  test("the tabs are the setup guide's own install methods, in its order", () => {
    expect(
      guide.methods.map((method: AgentUpgradeMethod): string => {
        return method.label;
      }),
    ).toEqual(
      DOCKER_INSTALL_METHODS.map(
        (option: SetupGuideOption<DockerInstallMethod>): string => {
          return option.label;
        },
      ),
    );
  });

  test.each(
    DOCKER_INSTALL_METHODS.map(
      (option: SetupGuideOption<DockerInstallMethod>) => {
        return [option.key, option.label];
      },
    ),
  )(
    "%s: every command is in that method's guide and its upgrade topic",
    (key: string, label: string) => {
      const setupGuide: SetupGuideContent = getDockerSetupGuide({
        oneuptimeUrl: URL,
        apiKey: KEY,
        method: key as DockerInstallMethod,
      });
      const method: AgentUpgradeMethod = methodLabelled(guide, label);
      expectCommandsFromGuide(method, setupGuide);
      expect(codesOf(method)).toEqual([
        getDockerAgentUpgradeCommand(key as DockerInstallMethod),
      ]);
      expect(upgradeTopicOf(setupGuide).markdown).toContain(
        getDockerAgentUpgradeCommand(key as DockerInstallMethod),
      );
    },
  );

  test("the CLI pulls the images the guide runs and removes the containers it names, then starts them from the guide", () => {
    const cli: AgentUpgradeMethod = methodLabelled(guide, "Docker CLI");
    expect(codesOf(cli)).toEqual([
      `docker pull ${DOCKER_AGENT_IMAGE}\ndocker pull ${DOCKER_AI_AGENT_IMAGE}\ndocker rm -f ${DOCKER_AGENT_CONTAINER_NAME} ${DOCKER_AI_AGENT_CONTAINER_NAME}`,
    ]);
    expect(cli.steps[cli.steps.length - 1]!.needsSetupGuide).toBe(true);
  });

  test("Compose recreates in place, with nothing to start by hand", () => {
    const compose: AgentUpgradeMethod = methodLabelled(guide, "Docker Compose");
    expect(codesOf(compose)).toEqual([
      "docker compose pull\ndocker compose up -d",
    ]);
    expect(
      compose.steps.some((step: AgentUpgradeStep): boolean => {
        return Boolean(step.needsSetupGuide);
      }),
    ).toBe(false);
  });
});

describe("Podman agent: a tab per install method", () => {
  const guide: AgentUpgradeGuide = guideFor(AgentKind.PodmanAgent);

  test("the tabs are the setup guide's own install methods, in its order", () => {
    expect(
      guide.methods.map((method: AgentUpgradeMethod): string => {
        return method.label;
      }),
    ).toEqual(
      PODMAN_INSTALL_METHODS.map(
        (option: SetupGuideOption<PodmanInstallMethod>): string => {
          return option.label;
        },
      ),
    );
  });

  test.each(
    PODMAN_INSTALL_METHODS.map(
      (option: SetupGuideOption<PodmanInstallMethod>) => {
        return [option.key, option.label];
      },
    ),
  )(
    "%s: every command is in that method's guide and its upgrade topic",
    (key: string, label: string) => {
      const setupGuide: SetupGuideContent = getPodmanSetupGuide({
        oneuptimeUrl: URL,
        apiKey: KEY,
        method: key as PodmanInstallMethod,
      });
      const method: AgentUpgradeMethod = methodLabelled(guide, label);
      expectCommandsFromGuide(method, setupGuide);
      expect(upgradeTopicOf(setupGuide).markdown).toContain(
        getPodmanAgentUpgradeCommand(key as PodmanInstallMethod),
      );
    },
  );

  test("the CLI pulls the Podman images and removes the Podman containers", () => {
    expect(codesOf(methodLabelled(guide, "Podman CLI"))).toEqual([
      `podman pull ${PODMAN_AGENT_IMAGE}\npodman pull ${PODMAN_AI_AGENT_IMAGE}\npodman rm -f ${PODMAN_AGENT_CONTAINER_NAME} ${PODMAN_AI_AGENT_CONTAINER_NAME}`,
    ]);
    expect(codesOf(methodLabelled(guide, "Podman Compose"))).toEqual([
      "podman compose pull\npodman compose up -d",
    ]);
  });
});

describe("Docker Swarm agent: the install script again, or the files again", () => {
  const guide: AgentUpgradeGuide = guideFor(AgentKind.DockerSwarmAgent);

  test("the tabs are the setup guide's own install methods, in its order", () => {
    expect(
      guide.methods.map((method: AgentUpgradeMethod): string => {
        return method.label;
      }),
    ).toEqual(
      DOCKER_SWARM_INSTALL_METHODS.map(
        (option: SetupGuideOption<DockerSwarmInstallMethod>): string => {
          return option.label;
        },
      ),
    );
  });

  test.each(
    DOCKER_SWARM_INSTALL_METHODS.map(
      (option: SetupGuideOption<DockerSwarmInstallMethod>) => {
        return [option.key, option.label];
      },
    ),
  )(
    "%s: every command is in that method's guide",
    (key: string, label: string) => {
      expectCommandsFromGuide(
        methodLabelled(guide, label),
        getDockerSwarmSetupGuide({
          oneuptimeUrl: URL,
          apiKey: KEY,
          method: key as DockerSwarmInstallMethod,
        }),
      );
    },
  );

  test("the script tab runs the install script, which fetches the latest files", () => {
    expect(codesOf(methodLabelled(guide, "Install script"))).toEqual([
      getDockerSwarmAgentInstallScriptCommand(),
    ]);
  });

  test("the Compose tab downloads every agent file before pulling: the pin lives in the files", () => {
    const compose: Array<string> = codesOf(
      methodLabelled(guide, "Docker Compose"),
    );
    expect(compose).toEqual([
      getDockerSwarmAgentDownloadCommand(),
      DOCKER_SWARM_AGENT_COMPOSE_UPGRADE_COMMAND,
    ]);
    for (const file of DOCKER_SWARM_AGENT_FILES) {
      expect(compose[0]).toContain(`-o ${file}`);
    }
  });
});

describe("Database agent", () => {
  test("without the engine it offers the install script alone, with a note for another folder", () => {
    const guide: AgentUpgradeGuide = guideFor(AgentKind.DatabaseAgent);
    expect(
      guide.methods.map((method: AgentUpgradeMethod): string => {
        return method.label;
      }),
    ).toEqual(["Install script"]);
    const script: AgentUpgradeMethod = guide.methods[0]!;
    expect(codesOf(script)).toEqual([getDatabaseAgentUpgradeCommand()]);
    expect(script.note).toContain("INSTALL_DIR");
    expect(script.noteValues).toEqual({
      directory: DATABASE_AGENT_INSTALL_DIRECTORY,
    });
  });

  test.each(
    DATABASE_AGENT_ENGINES.map((engine: string) => {
      return [engine];
    }),
  )(
    "%s: the script and the engine's Compose files are the setup guide's",
    (engine: string) => {
      const guide: AgentUpgradeGuide = guideFor(AgentKind.DatabaseAgent, {
        databaseEngine: engine as DatabaseAgentEngine,
      });
      const setupGuide: SetupGuideContent = getDatabaseAgentSetupGuide({
        oneuptimeUrl: URL,
        apiKey: KEY,
        engine: engine as DatabaseAgentEngine,
      });

      expect(
        guide.methods.map((method: AgentUpgradeMethod): string => {
          return method.label;
        }),
      ).toEqual(["Install script", "Docker Compose"]);

      expectCommandsFromGuide(
        methodLabelled(guide, "Install script"),
        setupGuide,
      );

      const compose: AgentUpgradeMethod = methodLabelled(
        guide,
        "Docker Compose",
      );
      expect(codesOf(compose)).toEqual([
        getDatabaseAgentDownloadCommand(engine as DatabaseAgentEngine),
        DATABASE_AGENT_RECREATE_COMMAND,
      ]);
      // The download is the guide's own Compose step; the recreate is what its upgrade topic says.
      expect(
        getSetupGuideCodeBlocks(setupGuide).map((block: string) => {
          return block.trim();
        }),
      ).toContain(
        getDatabaseAgentDownloadCommand(engine as DatabaseAgentEngine),
      );
      expect(getSetupGuideMarkdown(setupGuide)).toContain(
        `\`${DATABASE_AGENT_RECREATE_COMMAND}\``,
      );
      expect(
        getDatabaseAgentDownloadCommand(engine as DatabaseAgentEngine),
      ).toContain(`/configs/${engine}.yaml -o otel-collector-config.yaml`);
    },
  );

  test("a database in Kubernetes also gets the Deployment tab, which sends the reader to the guide", () => {
    const guide: AgentUpgradeGuide = guideFor(AgentKind.DatabaseAgent, {
      databaseEngine: "postgresql",
      databaseRunsInKubernetes: true,
    });
    expect(
      guide.methods.map((method: AgentUpgradeMethod): string => {
        return method.label;
      }),
    ).toEqual(["Install script", "Docker Compose", "Kubernetes"]);
    const kubernetes: AgentUpgradeMethod = methodLabelled(guide, "Kubernetes");
    expect(kubernetes.steps).toHaveLength(1);
    expect(kubernetes.steps[0]!.needsSetupGuide).toBe(true);

    // The guide's Kubernetes tab exists for such a database.
    const setupGuide: SetupGuideContent = getDatabaseAgentSetupGuide({
      oneuptimeUrl: URL,
      apiKey: KEY,
      engine: "postgresql",
      database: {
        id: "0000000d-0000-4000-8000-000000000001",
        dbSystem: "postgresql",
        serverAddress: "orders-db",
        serverPort: 5432,
        kubernetesNamespace: "shop",
        isKubernetes: true,
      },
    });
    expect(getSetupGuideMarkdown(setupGuide)).toContain("### Kubernetes");
  });

  test("the upgrade topic still says to run the install script again", () => {
    const setupGuide: SetupGuideContent = getDatabaseAgentSetupGuide({
      oneuptimeUrl: URL,
      apiKey: KEY,
      engine: "mysql",
    });
    expect(upgradeTopicOf(setupGuide).markdown).toContain(
      getDatabaseAgentUpgradeCommand(),
    );
  });
});

describe("Runner: the image again, then the setup command on the same page", () => {
  const guide: AgentUpgradeGuide = guideFor(AgentKind.Runner);

  test("pulls the image the setup command runs and removes the container it names", () => {
    expect(guide.methods).toHaveLength(1);
    expect(codesOf(guide.methods[0]!)).toEqual([getRunnerUpgradeCommand()]);
    expect(getRunnerUpgradeCommand()).toBe(
      `docker pull ${RUNNER_IMAGE}\ndocker rm -f ${RUNNER_CONTAINER_NAME}`,
    );
  });

  test("the setup command runs that image under that name", () => {
    const source: string = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "packages/App/FeatureSet/Dashboard/src/Components/Runner/InstallInstructions.tsx",
      ),
      "utf8",
    );
    expect(source).toContain("docker run --name ${RUNNER_CONTAINER_NAME}");
    expect(source).toContain("-d ${RUNNER_IMAGE}`");
    expect(RUNNER_IMAGE).toBe("oneuptime/runner:release");
    expect(RUNNER_CONTAINER_NAME).toBe("oneuptime-runner");
  });

  test("the second step points at the Setup Instructions on the page, not a guide", () => {
    const last: AgentUpgradeStep =
      guide.methods[0]!.steps[guide.methods[0]!.steps.length - 1]!;
    expect(last.code).toBeUndefined();
    expect(last.needsSetupGuide).toBeFalsy();
    expect(last.description).toContain("Setup Instructions");
  });
});

/*
 * A resource's AI agent (oneuptime/resource-ai-agent), drawn on every
 * resource's AI agent page: its compose service pulled and recreated, as
 * the page's install instructions started it.
 */
describe("Resource AI agent: its compose service pulled and recreated", () => {
  test("without the resource, every service of the docker-compose.yml it sits in", () => {
    const guide: AgentUpgradeGuide = guideFor(AgentKind.ResourceAiAgent);
    expect(
      guide.methods.map((method: AgentUpgradeMethod) => {
        return method.label;
      }),
    ).toEqual(["Docker Compose"]);
    expect(codesOf(guide.methods[0]!)).toEqual([
      `${COMPOSE_DIRECTORY_COMMENT}\ndocker compose pull\ndocker compose up -d`,
    ]);
  });

  test.each(ALL_AI_RESOURCE_TYPES)(
    "%s: pulls and recreates exactly the service the install instructions start",
    (resourceType: AiResourceType) => {
      const guide: AgentUpgradeGuide = guideFor(AgentKind.ResourceAiAgent, {
        resourceType,
      });
      const compose: AgentUpgradeMethod =
        guide.methods[guide.methods.length - 1]!;
      const service: string = getResourceAiAgentServiceName(resourceType);
      const code: string = codesOf(compose)[0]!;

      expect(code).toBe(getResourceAiAgentUpgradeCommand(resourceType));
      expect(code).toContain(`compose pull ${service}`);
      // The same start the install instructions give, from the same place.
      const start: string = getResourceAiAgentInstall({
        resourceType,
        resourceId: "id",
      }).startCommand;
      expect(code.endsWith(start.split("\n").pop()!)).toBe(true);
      expect(code.split("\n")[0]).toBe(start.split("\n")[0]);
    },
  );

  test("Podman hosts use Podman Compose", () => {
    const guide: AgentUpgradeGuide = guideFor(AgentKind.ResourceAiAgent, {
      resourceType: AiResourceType.PodmanHost,
    });
    const compose: AgentUpgradeMethod =
      guide.methods[guide.methods.length - 1]!;
    expect(compose.label).toBe("Podman Compose");
    expect(codesOf(compose)[0]).toContain("podman compose pull");
  });

  test.each([AiResourceType.DockerHost, AiResourceType.PodmanHost])(
    "%s: the collector's install script, which starts the agent as a container, comes first",
    (resourceType: AiResourceType) => {
      const guide: AgentUpgradeGuide = guideFor(AgentKind.ResourceAiAgent, {
        resourceType,
      });
      expect(guide.methods[0]!.label).toBe("Install script");
      expect(guide.methods[0]!.steps[0]!.title).toBe(
        "Run the install script again",
      );
      expect(guide.methods).toHaveLength(2);
    },
  );

  test("a resource whose collector's compose file ships the agent has the Compose way only", () => {
    const guide: AgentUpgradeGuide = guideFor(AgentKind.ResourceAiAgent, {
      resourceType: AiResourceType.ProxmoxCluster,
    });
    expect(guide.methods).toHaveLength(1);
    expect(codesOf(guide.methods[0]!)[0]).toContain(
      "cd /opt/oneuptime-proxmox-agent",
    );
  });
});

/*
 * The Proxmox, Ceph and VMware agents: the stock collector and a config,
 * pinned in the docker-compose.yml beside it. Their install scripts reuse
 * the .env they find (nothing is asked again), download both files and
 * recreate the containers, so running one again is the upgrade. A Docker
 * Compose install takes both files again itself (the pin and the version
 * stamp live in them), then the images pulled and the containers recreated,
 * because the collector reads its config only when it starts. The VMware
 * agent also installs without Docker, as a systemd service: its tab is
 * covered below.
 */
describe.each([
  {
    name: "Proxmox",
    kind: AgentKind.ProxmoxAgent,
    agentDir: "ProxmoxAgent",
    installDir: PROXMOX_AGENT_INSTALL_DIR,
    rawUrl: PROXMOX_AGENT_RAW_URL,
    methods: PROXMOX_CONNECT_METHODS.filter(
      (option: SetupGuideOption<ProxmoxConnectMethod>): boolean => {
        return option.key !== "native-push";
      },
    ) as Array<SetupGuideOption<string>>,
    upgrade: getProxmoxAgentUpgradeCommand(),
    download: getProxmoxAgentDownloadCommand(),
    recreate: PROXMOX_AGENT_RECREATE_COMMAND,
    setupGuide: (method: string): SetupGuideContent => {
      return getProxmoxSetupGuide({
        oneuptimeUrl: URL,
        apiKey: KEY,
        hasApiKey: true,
        method: method as ProxmoxConnectMethod,
      });
    },
  },
  {
    name: "Ceph",
    kind: AgentKind.CephAgent,
    agentDir: "CephAgent",
    installDir: CEPH_AGENT_INSTALL_DIR,
    rawUrl: CEPH_AGENT_RAW_URL,
    methods: CEPH_INSTALL_METHODS as Array<SetupGuideOption<string>>,
    upgrade: getCephAgentUpgradeCommand(),
    download: getCephAgentDownloadCommand(),
    recreate: CEPH_AGENT_RECREATE_COMMAND,
    setupGuide: (method: string): SetupGuideContent => {
      return getCephSetupGuide({
        oneuptimeUrl: URL,
        apiKey: KEY,
        hasApiKey: true,
        method: method as CephInstallMethod,
      });
    },
  },
  {
    name: "VMware",
    kind: AgentKind.VMwareAgent,
    agentDir: "VMwareAgent",
    installDir: VMWARE_AGENT_INSTALL_DIR,
    rawUrl: VMWARE_AGENT_RAW_URL,
    methods: VMWARE_INSTALL_METHODS as Array<SetupGuideOption<string>>,
    upgrade: getVMwareAgentUpgradeCommand(),
    download: getVMwareAgentDownloadCommand(),
    recreate: VMWARE_AGENT_RECREATE_COMMAND,
    withoutDocker: getVMwareNativeUpgradeCommand(),
    setupGuide: (method: string): SetupGuideContent => {
      return getVMwareSetupGuide({
        oneuptimeUrl: URL,
        apiKey: KEY,
        hasApiKey: true,
        method: method as VMwareInstallMethod,
      });
    },
  },
])(
  "$name agent: the install script again, or the files again",
  (agent: {
    name: string;
    kind: AgentKind;
    agentDir: string;
    installDir: string;
    rawUrl: string;
    methods: Array<SetupGuideOption<string>>;
    upgrade: string;
    download: string;
    recreate: string;
    withoutDocker?: string;
    setupGuide: (method: string) => SetupGuideContent;
  }) => {
    const guide: AgentUpgradeGuide = guideFor(agent.kind);

    test("the tabs are the setup guide's agent install methods, in its order", () => {
      expect(labelsOf(guide)).toEqual(
        agent.methods.map((option: SetupGuideOption<string>): string => {
          return option.label;
        }),
      );
      expect(labelsOf(guide)).toEqual([
        "Install script",
        "Docker Compose",
        ...(agent.withoutDocker ? ["Without Docker"] : []),
      ]);
    });

    test.each(
      agent.methods.map((option: SetupGuideOption<string>) => {
        return [option.key, option.label];
      }),
    )(
      "%s: every command is that guide's own upgrade block",
      (key: string, label: string) => {
        const setupGuide: SetupGuideContent = agent.setupGuide(key);
        const method: AgentUpgradeMethod = methodLabelled(guide, label);
        expectCommandsFromGuide(method, setupGuide);
        expect(topicCodeBlocks(upgradeTopicOf(setupGuide))).toEqual(
          expect.arrayContaining(codesOf(method)),
        );
      },
    );

    test("the script tab runs the install script with nothing in its environment: it reuses the .env", () => {
      const script: AgentUpgradeMethod = methodLabelled(
        guide,
        "Install script",
      );
      expect(
        script.steps.map((step: AgentUpgradeStep) => {
          return step.title;
        }),
      ).toEqual(["Run the install script again"]);
      expect(script.steps[0]!.description).toBe(
        "Run it on the machine the agent runs on. It reuses your .env without asking anything again, downloads the latest files and recreates the agent.",
      );
      expect(codesOf(script)).toEqual([agent.upgrade]);
      expect(agent.upgrade).toBe(
        `curl -sSL ${agent.rawUrl}/install.sh -o install.sh\nbash install.sh`,
      );
      // A key or URL on the command would override what .env holds.
      expect(agent.upgrade).not.toContain("ONEUPTIME_");
      // Nothing here needs a key, so nothing sends the reader to the guide.
      expect(
        guide.methods.some((method: AgentUpgradeMethod): boolean => {
          return method.steps.some((step: AgentUpgradeStep): boolean => {
            return Boolean(step.needsSetupGuide);
          });
        }),
      ).toBe(false);
    });

    test("the install script reuses the .env, installs where the guide says and recreates the containers it starts", () => {
      const script: string = fs.readFileSync(
        path.join(REPO_ROOT, "agents", agent.agentDir, "install.sh"),
        "utf8",
      );
      expect(script).toContain("reusing it.");
      expect(script).toContain(
        'printf -v "$name" \'%s\' "$(dotenv_get "$name" "$ENV_FILE")"',
      );
      expect(script).toMatch(/^docker compose up -d --force-recreate$/m);
      expect(script).toContain(
        `INSTALL_DIR="\${INSTALL_DIR:-${agent.installDir}}"`,
      );
      expect(script).toContain(`REPO_BASE="${agent.rawUrl}"`);
    });

    test("the Compose tab downloads both files from the agent's folder of the repository, then pulls and recreates", () => {
      const compose: AgentUpgradeMethod = methodLabelled(
        guide,
        "Docker Compose",
      );
      expect(
        compose.steps.map((step: AgentUpgradeStep) => {
          return step.title;
        }),
      ).toEqual([
        "Download the latest files",
        "Pull the latest images and recreate the agent",
      ]);
      expect(codesOf(compose)).toEqual([agent.download, agent.recreate]);
      expect(agent.download).toBe(
        [
          `curl -fsSLO ${agent.rawUrl}/docker-compose.yml`,
          `curl -fsSLO ${agent.rawUrl}/otel-collector-config.yaml`,
        ].join("\n"),
      );
      expect(agent.recreate).toBe(
        "docker compose pull\ndocker compose up -d --force-recreate",
      );
      // The same files the guide's own Compose install downloads.
      expect(
        getSetupGuideMarkdown(agent.setupGuide("docker-compose")),
      ).toContain(agent.download);
    });

    test("no command enters the install directory: the script finds it, a Compose install runs where it is", () => {
      for (const method of guide.methods) {
        // Without Docker the files are installed there by name.
        if (method.label === "Without Docker") {
          continue;
        }
        for (const code of codesOf(method)) {
          expect(code).not.toContain("cd ");
          expect(code).not.toContain(agent.installDir);
        }
      }
    });
  },
);

/*
 * The VMware agent without Docker is the collector release the agent pins,
 * run by systemd: the install's own commands again — the release, the
 * latest config and unit; .env stays — then a restart are the upgrade. The
 * tab shows the guide's own block, which needs no key and no folder.
 */
describe("VMware agent without Docker: the release and files again, then a restart", () => {
  const guide: AgentUpgradeGuide = guideFor(AgentKind.VMwareAgent);
  const method: AgentUpgradeMethod = methodLabelled(guide, "Without Docker");

  test("one step: the guide's own upgrade, run on the agent's machine", () => {
    expect(
      method.steps.map((step: AgentUpgradeStep): string => {
        return step.title;
      }),
    ).toEqual(["Install the new release"]);
    expect(method.steps[0]!.description).toBe(
      "Run this on the machine the agent runs on. It installs the collector release and the files this OneUptime pins over the old ones, then restarts the agent. Your .env stays; re-apply any change you made to otel-collector-config.yaml.",
    );
    expect(codesOf(method)).toEqual([getVMwareNativeUpgradeCommand()]);
    expect(method.steps[0]!.needsSetupGuide).toBeFalsy();
    expect(method.steps[0]!.language).toBeUndefined();
    expect(method.note).toBeUndefined();
  });

  test("the command is the setup guide's upgrade block, and needs nothing filled in", () => {
    const setupGuide: SetupGuideContent = getVMwareSetupGuide({
      oneuptimeUrl: URL,
      apiKey: KEY,
      hasApiKey: true,
      method: "linux-service",
    });
    expectCommandsFromGuide(method, setupGuide);
    expect(topicCodeBlocks(upgradeTopicOf(setupGuide))).toContain(
      getVMwareNativeUpgradeCommand(),
    );
    const command: string = getVMwareNativeUpgradeCommand();
    expect(command).not.toContain("ONEUPTIME_");
    expect(command).not.toContain(KEY);
    expect(command).not.toMatch(/docker/i);
    expect(command).toMatch(/\nsudo systemctl restart oneuptime-vmware-agent$/);
  });

  test("only the VMware agent has the tab: Proxmox and Ceph install with Docker alone", () => {
    for (const kind of [AgentKind.ProxmoxAgent, AgentKind.CephAgent]) {
      expect(labelsOf(guideFor(kind))).not.toContain("Without Docker");
    }
  });
});

test("a Proxmox cluster on the native push runs no agent, so its guide has nothing to upgrade", () => {
  const markdown: string = getSetupGuideMarkdown(
    getProxmoxSetupGuide({
      oneuptimeUrl: URL,
      apiKey: KEY,
      hasApiKey: true,
      method: "native-push",
    }),
  );
  expect(markdown).not.toContain("Upgrade or uninstall the agent");
  expect(markdown).not.toContain("docker compose");
});

/*
 * The Storage Array agent's install script, like the VMware agent's, reuses
 * the .env it finds and recreates the containers, so running it again is
 * the upgrade (it keeps a file the reader edited as <file>.bak.<timestamp>).
 * One agent reads one array, so a second array's agent lives in a folder of
 * its own: the script tab says how to point the script there. A Docker
 * Compose install takes the compose file and all three collector configs
 * again itself. The guide asks which array it is for, so every platform's
 * guide shows the same upgrade.
 */
describe("Storage Array agent: the install script again, or every file again", () => {
  const guide: AgentUpgradeGuide = guideFor(AgentKind.StorageArrayAgent);

  const PLATFORMS: Array<StorageArrayPlatform> = STORAGE_ARRAY_PLATFORMS.map(
    (option: SetupGuideOption<StorageArrayPlatform>): StorageArrayPlatform => {
      return option.key;
    },
  );

  function setupGuideFor(platform: StorageArrayPlatform): SetupGuideContent {
    return getStorageArraySetupGuide({
      oneuptimeUrl: URL,
      apiKey: KEY,
      hasApiKey: true,
      platform: platform,
    });
  }

  test("the tabs are the setup guide's own install tabs, in its order", () => {
    const install: SetupGuideStep | undefined = setupGuideFor(
      "flasharray",
    ).steps.find((step: SetupGuideStep): boolean => {
      return step.title === "Install the agent";
    });
    expect(labelsOf(guide)).toEqual(
      (install?.variants || []).map(
        (variant: SetupGuideStepVariant): string => {
          return variant.label;
        },
      ),
    );
    expect(labelsOf(guide)).toEqual(["Install script", "Docker Compose"]);
  });

  test.each(
    PLATFORMS.map((platform: StorageArrayPlatform) => {
      return [platform];
    }),
  )(
    "the %s guide: every command is the guide's own upgrade block",
    (platform: string) => {
      const setupGuide: SetupGuideContent = setupGuideFor(
        platform as StorageArrayPlatform,
      );
      for (const method of guide.methods) {
        expectCommandsFromGuide(method, setupGuide);
        expect(topicCodeBlocks(upgradeTopicOf(setupGuide))).toEqual(
          expect.arrayContaining(codesOf(method)),
        );
      }
    },
  );

  test("the script tab runs the install script with nothing in its environment: it reuses the .env", () => {
    const script: AgentUpgradeMethod = methodLabelled(guide, "Install script");
    expect(
      script.steps.map((step: AgentUpgradeStep) => {
        return step.title;
      }),
    ).toEqual(["Run the install script again"]);
    expect(codesOf(script)).toEqual([getStorageArrayAgentUpgradeCommand()]);
    expect(getStorageArrayAgentUpgradeCommand()).toBe(
      `curl -sSL ${STORAGE_ARRAY_AGENT_RAW_URL}/install.sh -o install.sh\nbash install.sh`,
    );
    /*
     * A key, a URL, a name or a config on the command would override what
     * .env holds - the install guide's own command carries the platform.
     */
    expect(getStorageArrayAgentUpgradeCommand()).not.toContain("ONEUPTIME_");
    expect(getStorageArrayAgentUpgradeCommand()).not.toContain(
      "STORAGE_ARRAY_",
    );
    // Nothing here needs a key, so nothing sends the reader to the guide.
    expect(
      guide.methods.some((method: AgentUpgradeMethod): boolean => {
        return method.steps.some((step: AgentUpgradeStep): boolean => {
          return Boolean(step.needsSetupGuide);
        });
      }),
    ).toBe(false);
  });

  test("the script tab says how to upgrade an agent in a folder of its own", () => {
    const script: AgentUpgradeMethod = methodLabelled(guide, "Install script");
    expect(script.note).toBe(
      "Installed it outside {{directory}}? Run the script with INSTALL_DIR set to that folder: INSTALL_DIR=<folder> bash install.sh.",
    );
    expect(script.noteValues).toEqual({
      directory: STORAGE_ARRAY_AGENT_INSTALL_DIR,
    });
    // The setup guide installs a second array's agent the same way.
    expect(getSetupGuideMarkdown(setupGuideFor("flasharray"))).toContain(
      `INSTALL_DIR=${STORAGE_ARRAY_AGENT_INSTALL_DIR}-fa02 bash install.sh`,
    );
  });

  test("the install script reuses the .env, keeps an edited file and recreates the containers it starts", () => {
    const script: string = fs.readFileSync(
      path.join(REPO_ROOT, "agents/StorageArrayAgent/install.sh"),
      "utf8",
    );
    expect(script).toContain("reusing it.");
    expect(script).toContain('backup="$INSTALL_DIR/$file.bak.');
    expect(script).toMatch(
      /^if ! docker compose up -d --force-recreate; then$/m,
    );
    expect(script).toContain(
      `INSTALL_DIR="\${INSTALL_DIR:-${STORAGE_ARRAY_AGENT_INSTALL_DIR}}"`,
    );
  });

  test("the Compose tab downloads the compose file and every config, then pulls and recreates", () => {
    const compose: AgentUpgradeMethod = methodLabelled(guide, "Docker Compose");
    expect(codesOf(compose)).toEqual([
      getStorageArrayAgentDownloadCommand(),
      STORAGE_ARRAY_AGENT_RECREATE_COMMAND,
    ]);
    expect(
      compose.steps.map((step: AgentUpgradeStep) => {
        return step.title;
      }),
    ).toEqual([
      "Download the latest files",
      "Pull the latest images and recreate the agent",
    ]);
    expect(getStorageArrayAgentDownloadCommand()).toBe(
      STORAGE_ARRAY_AGENT_FILES.map((file: string): string => {
        return `curl -fsSLO ${STORAGE_ARRAY_AGENT_RAW_URL}/${file}`;
      }).join("\n"),
    );
    expect(STORAGE_ARRAY_AGENT_FILES).toEqual([
      "docker-compose.yml",
      "otel-collector-config.yaml",
      "otel-collector-config.flasharray-exporter.yaml",
      "otel-collector-config.flashblade.yaml",
    ]);
    expect(STORAGE_ARRAY_AGENT_RECREATE_COMMAND).toBe(
      "docker compose pull\ndocker compose up -d --force-recreate",
    );
    // The same files the guide's own Compose install downloads.
    for (const platform of PLATFORMS) {
      expect(getSetupGuideMarkdown(setupGuideFor(platform))).toContain(
        `mkdir oneuptime-storage-array-agent && cd oneuptime-storage-array-agent\n${getStorageArrayAgentDownloadCommand()}`,
      );
    }
  });

  test("the Compose tab names every config the reader may have edited", () => {
    const download: AgentUpgradeStep = methodLabelled(guide, "Docker Compose")
      .steps[0]!;
    expect(download.description).toBe(
      "Run this in the agent's folder. It keeps your .env; re-apply any change you made to docker-compose.yml or otel-collector-config*.yaml.",
    );
    for (const file of STORAGE_ARRAY_AGENT_FILES) {
      if (file !== "docker-compose.yml") {
        expect(file).toMatch(/^otel-collector-config.*\.yaml$/);
      }
    }
  });
});

/*
 * A host's collector: the upstream otelcol-contrib installed one of six
 * ways, running the host guide's config.yaml, which stamps the release it is
 * for. The upgrade saves that config again from the guide (it holds the
 * ingestion key) and installs the new release over the old, per install
 * method; the tabs are the methods the host's OS can have.
 */
describe("Host collector: the config again, then the new release, per install method", () => {
  const LABELS: Record<string, string> = {};
  for (const option of HOST_INSTALL_METHODS) {
    LABELS[option.key] = option.label;
  }

  function labelsFor(methods: Array<HostCollectorMethod>): Array<string> {
    return methods.map((method: HostCollectorMethod): string => {
      return LABELS[method] as string;
    });
  }

  test("an unknown OS gets every method that installs a collector, labelled and ordered like the guide's picker", () => {
    const guide: AgentUpgradeGuide = guideFor(AgentKind.HostCollector);
    expect(labelsOf(guide)).toEqual(
      HOST_INSTALL_METHODS.filter(
        (option: SetupGuideOption<HostInstallMethod>): boolean => {
          return option.key !== "kubernetes";
        },
      ).map((option: SetupGuideOption<HostInstallMethod>): string => {
        return option.label;
      }),
    );
    expect(labelsOf(guide)).toEqual(labelsFor([...HOST_COLLECTOR_METHODS]));
  });

  test.each([
    ["linux", ["docker", "linux-deb", "linux-rpm", "linux-tarball"]],
    ["Linux", ["docker", "linux-deb", "linux-rpm", "linux-tarball"]],
    ["windows", ["windows"]],
    ["darwin", ["macos"]],
    ["freebsd", [...HOST_COLLECTOR_METHODS]],
    ["", [...HOST_COLLECTOR_METHODS]],
  ])("os.type %p offers %p", (osType: string, methods: Array<string>) => {
    expect(getHostCollectorMethodsForOsType(osType)).toEqual(methods);
    expect(
      labelsOf(guideFor(AgentKind.HostCollector, { hostOsType: osType })),
    ).toEqual(labelsFor(methods as Array<HostCollectorMethod>));
  });

  test.each(
    HOST_COLLECTOR_METHODS.map((method: string) => {
      return [method];
    }),
  )(
    "%s: the config from the guide first, then the guide's own upgrade command",
    (key: string) => {
      const method: AgentUpgradeMethod = methodLabelled(
        guideFor(AgentKind.HostCollector),
        LABELS[key] as string,
      );
      expect(method.steps).toHaveLength(2);

      const [config, install] = method.steps as [
        AgentUpgradeStep,
        AgentUpgradeStep,
      ];
      expect(config.title).toBe("Save the new config");
      expect(config.needsSetupGuide).toBe(true);
      expect(config.code).toBeUndefined();

      expect(install.title).toBe("Install the new release");
      expect(install.code).toBe(
        getHostCollectorUpgradeCommand(key as HostCollectorMethod),
      );
      expect(install.language).toBe(key === "windows" ? "powershell" : "bash");

      const setupGuide: SetupGuideContent = getHostSetupGuide({
        oneuptimeUrl: URL,
        apiKey: KEY,
        method: key as HostCollectorMethod,
      });
      expectCommandsFromGuide(method, setupGuide);
      expect(
        topicCodeBlocks(
          upgradeTopicOf(setupGuide, HOST_COLLECTOR_UPGRADE_TOPIC_TITLE),
        ),
      ).toEqual([install.code]);
    },
  );

  test("the Kubernetes option installs the Kubernetes agent, so it has no collector upgrade", () => {
    expect(HOST_COLLECTOR_METHODS).not.toContain("kubernetes");
  });
});

/*
 * What each host upgrade command does, against the install it upgrades: the
 * pinned release, over the same paths, the new config put where the install
 * put it, and the collector restarted on both.
 */
describe("the host upgrade commands", () => {
  function installOf(method: HostCollectorMethod): string {
    return getHostSetupGuide({
      oneuptimeUrl: URL,
      apiKey: KEY,
      method: method,
    })
      .steps.map((step: { markdown?: string | undefined }): string => {
        return step.markdown || "";
      })
      .join("\n");
  }

  test.each(
    HOST_COLLECTOR_METHODS.map((method: string) => {
      return [method];
    }),
  )("%s installs the pinned release", (method: string) => {
    const upgrade: string = getHostCollectorUpgradeCommand(
      method as HostCollectorMethod,
    );
    expect(upgrade).toContain(HOST_COLLECTOR_VERSION);
    expect(upgrade).not.toContain("latest");
  });

  test("Docker removes the container the install named, then runs the install's own docker run", () => {
    const upgrade: string = getHostCollectorUpgradeCommand("docker");
    const [remove, ...run] = upgrade.split("\n");
    expect(remove).toBe("docker rm -f otel-collector");
    expect(installOf("docker")).toContain(run.join("\n"));
    expect(run.join("\n")).toContain("--name otel-collector");
  });

  test("Debian keeps the installed config without a prompt, then replaces it and restarts", () => {
    const upgrade: string = getHostCollectorUpgradeCommand("linux-deb");
    expect(upgrade).toContain(
      "sudo dpkg -i --force-confold /tmp/otelcol-contrib.deb",
    );
    expect(upgrade).toContain(
      "sudo install -m 0644 config.yaml /etc/otelcol-contrib/config.yaml",
    );
    expect(upgrade).toContain("sudo systemctl restart otelcol-contrib");
  });

  test("RHEL upgrades the package in place, then replaces the config and restarts", () => {
    const upgrade: string = getHostCollectorUpgradeCommand("linux-rpm");
    expect(upgrade).toContain("sudo rpm -Uvh /tmp/otelcol-contrib.rpm");
    expect(upgrade).toContain(
      "sudo install -m 0644 config.yaml /etc/otelcol-contrib/config.yaml",
    );
    expect(upgrade).toContain("sudo systemctl restart otelcol-contrib");
  });

  test.each([
    [
      "linux-tarball",
      "sudo systemctl stop otelcol-contrib",
      "sudo tar -xzf /tmp/otelcol.tar.gz -C /opt/otelcol-contrib",
      "sudo systemctl start otelcol-contrib",
    ],
    [
      "macos",
      "sudo launchctl unload /Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist",
      "sudo tar -xzf /tmp/otelcol-contrib.tar.gz -C /usr/local/otelcol-contrib",
      "sudo launchctl load -w /Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist",
    ],
    [
      "windows",
      "Stop-Service otelcol-contrib",
      "tar -xf $tar -C $dest",
      "Start-Service otelcol-contrib",
    ],
  ])(
    "%s stops the collector before its binary is replaced, and starts it after",
    (method: string, stop: string, replace: string, start: string) => {
      const upgrade: string = getHostCollectorUpgradeCommand(
        method as HostCollectorMethod,
      );
      const stopAt: number = upgrade.indexOf(stop);
      const replaceAt: number = upgrade.indexOf(replace);
      const startAt: number = upgrade.indexOf(start);
      expect(stopAt).toBeGreaterThan(-1);
      expect(replaceAt).toBeGreaterThan(stopAt);
      expect(startAt).toBeGreaterThan(replaceAt);
      // The binary goes where the install unpacked it.
      expect(installOf(method as HostCollectorMethod)).toContain(replace);
    },
  );

  test.each([
    ["linux-deb", "/etc/otelcol-contrib/config.yaml"],
    ["linux-rpm", "/etc/otelcol-contrib/config.yaml"],
    ["linux-tarball", "/opt/otelcol-contrib/config.yaml"],
    ["macos", "/etc/otelcol-contrib/config.yaml"],
  ])(
    "%s puts the new config where the install put the first one",
    (method: string, destination: string) => {
      const line: string = `sudo install -m 0644 config.yaml ${destination}`;
      expect(
        getHostCollectorUpgradeCommand(method as HostCollectorMethod),
      ).toContain(line);
      expect(installOf(method as HostCollectorMethod)).toContain(line);
    },
  );

  test("Windows copies the new config next to the binary, as the install does", () => {
    const line: string = 'Copy-Item config.yaml "$dest\\config.yaml" -Force';
    expect(getHostCollectorUpgradeCommand("windows")).toContain(line);
    expect(installOf("windows")).toContain(line);
  });
});
