import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  AGENT_KINDS,
  AgentKind,
  AgentLatestVersionSource,
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
  getKubernetesSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/DocumentationMarkdown";
import {
  DOCKER_AGENT_CONTAINER_NAME,
  DOCKER_AGENT_IMAGE,
  DOCKER_INSTALL_METHODS,
  DockerInstallMethod,
  getDockerAgentUpgradeCommand,
  getDockerSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/Utils/DocumentationMarkdown";
import {
  PODMAN_AGENT_CONTAINER_NAME,
  PODMAN_AGENT_IMAGE,
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

function upgradeTopicOf(guide: SetupGuideContent): SetupGuideTopic {
  const topic: SetupGuideTopic | undefined = (guide.advanced || []).find(
    (candidate: SetupGuideTopic): boolean => {
      return candidate.title === "Upgrade or uninstall the agent";
    },
  );
  expect(topic).toBeDefined();
  return topic as SetupGuideTopic;
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

describe("Kubernetes agent: upgrade the Helm release", () => {
  test("one step, the chart upgrade that keeps the release's values", () => {
    const guide: AgentUpgradeGuide = guideFor(AgentKind.KubernetesAgent);
    expect(guide.methods).toHaveLength(1);
    expect(codesOf(guide.methods[0]!)).toEqual([
      getKubernetesAgentChartUpgradeCommand(),
    ]);
    expect(getKubernetesAgentChartUpgradeCommand()).toBe(
      [
        "helm repo update",
        `helm upgrade ${KUBERNETES_AGENT_HELM_RELEASE} oneuptime/kubernetes-agent \\`,
        `  --namespace ${KUBERNETES_AGENT_HELM_NAMESPACE} \\`,
        "  --reuse-values",
      ].join("\n"),
    );
  });

  test.each(
    KUBERNETES_PLATFORMS.map((option: SetupGuideOption<KubernetesPlatform>) => {
      return [option.key];
    }),
  )("is the command the %s guide's upgrade topic shows", (platform: string) => {
    const setupGuide: SetupGuideContent = getKubernetesSetupGuide({
      oneuptimeUrl: URL,
      apiKey: KEY,
      platform: platform as KubernetesPlatform,
    });
    expectCommandsFromGuide(
      guideFor(AgentKind.KubernetesAgent).methods[0]!,
      setupGuide,
    );
    expect(upgradeTopicOf(setupGuide).markdown).toContain(
      getKubernetesAgentChartUpgradeCommand(),
    );
  });
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

  test("the CLI pulls the image the guide runs and removes the container it names, then starts it from the guide", () => {
    const cli: AgentUpgradeMethod = methodLabelled(guide, "Docker CLI");
    expect(codesOf(cli)).toEqual([
      `docker pull ${DOCKER_AGENT_IMAGE}\ndocker rm -f ${DOCKER_AGENT_CONTAINER_NAME}`,
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

  test("the CLI pulls the Podman image and removes the Podman container", () => {
    expect(codesOf(methodLabelled(guide, "Podman CLI"))).toEqual([
      `podman pull ${PODMAN_AGENT_IMAGE}\npodman rm -f ${PODMAN_AGENT_CONTAINER_NAME}`,
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
