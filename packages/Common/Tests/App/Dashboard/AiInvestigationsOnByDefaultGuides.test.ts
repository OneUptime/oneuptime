import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import markdownSlugify from "../../../Server/Types/MarkdownSlugify";
import {
  KUBERNETES_AGENT_HELM_RELEASE,
  KUBERNETES_AI_INVESTIGATION_INSTALL_FLAG,
  KUBERNETES_AI_INVESTIGATION_OPT_OUT_FLAG,
  KUBERNETES_PLATFORMS,
  KubernetesPlatform,
  getKubernetesPlatformInstallFlags,
  getKubernetesSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/DocumentationMarkdown";
import {
  CEPH_INSTALL_METHODS,
  CephInstallMethod,
  getCephSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/Utils/DocumentationMarkdown";
import {
  PROXMOX_CONNECT_METHODS,
  ProxmoxConnectMethod,
  getProxmoxSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/Utils/DocumentationMarkdown";
import {
  VMWARE_INSTALL_METHODS,
  VMwareInstallMethod,
  getVMwareSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Utils/DocumentationMarkdown";
import {
  DOCKER_SWARM_INSTALL_METHODS,
  DockerSwarmInstallMethod,
  getDockerSwarmSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/Utils/DocumentationMarkdown";
import {
  DatabaseDocumentationTarget,
  getDatabaseAgentSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DocumentationMarkdown";
import {
  DATABASE_AGENT_ENGINES,
  DatabaseAgentEngine,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseAgentConfigs";
import {
  HOST_AI_AGENT_INSTALL_COMMAND,
  HOST_AI_AGENT_TOPIC_TITLE,
  HOST_INSTALL_METHODS,
  HostInstallMethod,
  NATIVE_LINUX_INSTALL_METHODS,
  getHostSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/Utils/DocumentationMarkdown";
import {
  SetupGuideContent,
  SetupGuideOption,
  SetupGuideStep,
  SetupGuideTopic,
  getSetupGuideMarkdown,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import HostCommandPolicy from "../../../Utils/AiRemediation/Resource/HostCommandPolicy";
import { ResourceCommandTier } from "../../../Types/ResourceAiAgent/ResourceAiAccess";

/*
 * Every setup guide that installs an AI agent says that AI investigations
 * are on by default — true since every resource's isAiInvestigationEnabled
 * column defaults to true, as a cluster's "Investigate with kubectl" does:
 *
 *   - the Kubernetes guide spells the chart's default out in the install
 *     command (--set aiAgent.enabled=true), says what it does, and names
 *     the value that turns it off;
 *   - the Ceph, Proxmox, VMware and Docker Swarm guides say it where they
 *     verify the install, next to the AI agent container they list;
 *   - the database guide says it for the engines the AI agent has
 *     diagnostics for, and only for those;
 *   - the host guide offers the Host AI agent, with its own installer, on
 *     Linux only.
 *
 * A guide with no AI agent (Proxmox's native push, the VMware agent
 * installed without Docker) claims nothing.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const URL: string = "https://oneuptime.example.com";
const KEY: string = "tik_secret_123";

const ON_BY_DEFAULT: string =
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on";

function keysOf<T extends string>(
  options: Array<SetupGuideOption<T>>,
): Array<T> {
  return options.map((option: SetupGuideOption<T>): T => {
    return option.key;
  });
}

function stepTitled(guide: SetupGuideContent, title: string): string {
  const step: SetupGuideStep | undefined = guide.steps.find(
    (candidate: SetupGuideStep): boolean => {
      return candidate.title === title;
    },
  );

  if (!step) {
    throw new Error(`No step titled "${title}"`);
  }

  return step.markdown || "";
}

function lastStep(guide: SetupGuideContent): SetupGuideStep {
  return guide.steps[guide.steps.length - 1]!;
}

function stepsText(guide: SetupGuideContent): string {
  return guide.steps
    .map((step: SetupGuideStep): string => {
      return [
        step.title,
        step.description || "",
        step.markdown || "",
        ...(step.variants || []).map(
          (variant: { markdown: string }): string => {
            return variant.markdown;
          },
        ),
      ].join("\n");
    })
    .join("\n");
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("the Kubernetes guide", () => {
  const platforms: Array<KubernetesPlatform> = keysOf(KUBERNETES_PLATFORMS);

  test("the flags it shows are the chart's aiAgent.enabled, on and off", () => {
    expect(KUBERNETES_AI_INVESTIGATION_INSTALL_FLAG).toBe(
      "--set aiAgent.enabled=true",
    );
    expect(KUBERNETES_AI_INVESTIGATION_OPT_OUT_FLAG).toBe(
      "--set aiAgent.enabled=false",
    );
  });

  /*
   * The flag restates the chart's default: an install with it is the same
   * install as one without it, and the schema takes the value.
   */
  test("restates the chart's default, which the schema accepts", () => {
    const chart: string = path.join(
      REPO_ROOT,
      "HelmChart/Public/kubernetes-agent",
    );
    const values: { aiAgent: { enabled: unknown } } = yaml.load(
      fs.readFileSync(path.join(chart, "values.yaml"), "utf8"),
    ) as { aiAgent: { enabled: unknown } };
    const schema: {
      properties: {
        aiAgent: { properties: { enabled: { type: string } } };
      };
    } = JSON.parse(
      fs.readFileSync(path.join(chart, "values.schema.json"), "utf8"),
    );

    expect(values.aiAgent.enabled).toBe(true);
    expect(schema.properties.aiAgent.properties.enabled.type).toBe("boolean");
  });

  describe.each(platforms)("on %s", (platform: KubernetesPlatform) => {
    const guide: SetupGuideContent = getKubernetesSetupGuide({
      oneuptimeUrl: URL,
      apiKey: KEY,
      platform: platform,
    });
    const install: string = stepTitled(guide, "Install the agent");
    const command: string = install.match(/helm install [\s\S]*?(?=\n```)/)![0];

    test("the install command turns AI investigations on, once", () => {
      expect(count(command, KUBERNETES_AI_INVESTIGATION_INSTALL_FLAG)).toBe(1);
      expect(command).not.toContain(KUBERNETES_AI_INVESTIGATION_OPT_OUT_FLAG);
    });

    test("right after the connection values, before the platform's own flags", () => {
      const lines: Array<string> = command.split("\n").map((line: string) => {
        return line.replace(/\s*\\$/, "").trim();
      });
      const clusterNameAt: number = lines.findIndex((line: string) => {
        return line.startsWith("--set clusterName=");
      });

      expect(lines[clusterNameAt + 1]).toBe(
        KUBERNETES_AI_INVESTIGATION_INSTALL_FLAG,
      );
      for (const flag of getKubernetesPlatformInstallFlags(platform)) {
        expect(lines.indexOf(flag)).toBeGreaterThan(clusterNameAt + 1);
      }
      // Still one command: every line but the last continues it.
      expect(command.trimEnd().endsWith("\\")).toBe(false);
      expect(
        command
          .split("\n")
          .slice(0, -1)
          .every((line: string): boolean => {
            return line.endsWith(" \\");
          }),
      ).toBe(true);
    });

    test("the install step says what the flag does", () => {
      expect(install).toContain(
        `\`${KUBERNETES_AI_INVESTIGATION_INSTALL_FLAG}\` turns **AI investigations** on, as the chart does by default: OneUptime AI investigates incidents and alerts on this cluster with read-only kubectl, through the Kubernetes AI agent.`,
      );
    });

    test("the verify step names the value that turns it off", () => {
      const verify: string = stepTitled(guide, "Verify the installation");

      expect(verify).toContain(
        `Install with \`${KUBERNETES_AI_INVESTIGATION_OPT_OUT_FLAG}\` instead of \`${KUBERNETES_AI_INVESTIGATION_INSTALL_FLAG}\`.`,
      );
      expect(verify).toContain(`\`${KUBERNETES_AGENT_HELM_RELEASE}-ai-agent\``);
    });
  });

  test("a cluster's own guide carries the flag too", () => {
    const command: string = getSetupGuideMarkdown(
      getKubernetesSetupGuide({
        oneuptimeUrl: URL,
        apiKey: KEY,
        platform: "standard",
        clusterName: "prod-east",
      }),
    );

    expect(command).toContain(
      `--set clusterName="prod-east" \\\n  ${KUBERNETES_AI_INVESTIGATION_INSTALL_FLAG}`,
    );
  });
});

describe.each<[string, () => Array<[string, SetupGuideContent]>, string]>([
  [
    "Ceph",
    (): Array<[string, SetupGuideContent]> => {
      return keysOf(CEPH_INSTALL_METHODS).map(
        (method: CephInstallMethod): [string, SetupGuideContent] => {
          return [
            method,
            getCephSetupGuide({
              oneuptimeUrl: URL,
              apiKey: KEY,
              hasApiKey: true,
              method: method,
            }),
          ];
        },
      );
    },
    "with read-only `ceph` commands",
  ],
  [
    "Proxmox",
    (): Array<[string, SetupGuideContent]> => {
      return keysOf(PROXMOX_CONNECT_METHODS)
        .filter((method: ProxmoxConnectMethod): boolean => {
          return method !== "native-push";
        })
        .map((method: ProxmoxConnectMethod): [string, SetupGuideContent] => {
          return [
            method,
            getProxmoxSetupGuide({
              oneuptimeUrl: URL,
              apiKey: KEY,
              hasApiKey: true,
              method: method,
            }),
          ];
        });
    },
    "with read-only `pvesh` requests",
  ],
  [
    "VMware",
    (): Array<[string, SetupGuideContent]> => {
      return keysOf(VMWARE_INSTALL_METHODS)
        .filter((method: VMwareInstallMethod): boolean => {
          return method !== "linux-service";
        })
        .map((method: VMwareInstallMethod): [string, SetupGuideContent] => {
          return [
            method,
            getVMwareSetupGuide({
              oneuptimeUrl: URL,
              apiKey: KEY,
              hasApiKey: true,
              method: method,
            }),
          ];
        });
    },
    "with read-only `govc` commands",
  ],
  [
    "Docker Swarm",
    (): Array<[string, SetupGuideContent]> => {
      return keysOf(DOCKER_SWARM_INSTALL_METHODS).map(
        (method: DockerSwarmInstallMethod): [string, SetupGuideContent] => {
          return [
            method,
            getDockerSwarmSetupGuide({
              oneuptimeUrl: URL,
              apiKey: KEY,
              method: method,
            }),
          ];
        },
      );
    },
    "with read-only docker commands such as `docker node ls`",
  ],
])(
  "the %s guide",
  (
    _name: string,
    guides: () => Array<[string, SetupGuideContent]>,
    commands: string,
  ) => {
    test.each(guides())(
      "%s: the verify step says AI investigations are on, with what the agent runs",
      (_method: string, guide: SetupGuideContent) => {
        const verify: SetupGuideStep = lastStep(guide);

        expect(verify.title).toMatch(/^Verify/);
        expect(count(verify.markdown || "", ON_BY_DEFAULT)).toBe(1);
        expect(verify.markdown).toContain(commands);
        expect(verify.markdown).toContain(
          "changes nothing unless you allow fixes",
        );
        // Said once, where the install is checked — not in every step.
        expect(count(stepsText(guide), "AI investigations are on")).toBe(1);
      },
    );
  },
);

describe("the Proxmox native push", () => {
  // It runs no OneUptime AI agent, so it promises no AI investigations.
  test("claims no AI investigations: there is no AI agent to run them", () => {
    const guide: SetupGuideContent = getProxmoxSetupGuide({
      oneuptimeUrl: URL,
      apiKey: KEY,
      hasApiKey: true,
      method: "native-push",
    });

    expect(getSetupGuideMarkdown(guide)).not.toContain(
      "AI investigations are on",
    );
  });
});

describe("the VMware agent without Docker", () => {
  /*
   * The AI agent ships only as a container image, so the install without
   * Docker runs the collector alone and promises no AI investigations; it
   * says why, and points at running the AI agent with Docker elsewhere.
   */
  const guide: SetupGuideContent = getVMwareSetupGuide({
    oneuptimeUrl: URL,
    apiKey: KEY,
    hasApiKey: true,
    method: "linux-service",
  });

  test("claims no AI investigations: there is no AI agent to run them", () => {
    expect(getSetupGuideMarkdown(guide)).not.toContain(
      "AI investigations are on",
    );
    expect(lastStep(guide).markdown).not.toContain(ON_BY_DEFAULT);
  });

  test("says in its install step why there is no AI agent", () => {
    expect(stepTitled(guide, "Install the agent")).toContain(
      "the OneUptime AI agent ships only as a container image",
    );
  });
});

describe("the database guide", () => {
  const WITH_DIAGNOSTICS: Array<DatabaseAgentEngine> = [
    "postgresql",
    "mysql",
    "redis",
    "mongodb",
  ];

  test.each([...DATABASE_AGENT_ENGINES])(
    "%s: says AI investigations are on only where the AI agent has diagnostics",
    (engine: DatabaseAgentEngine) => {
      const guide: SetupGuideContent = getDatabaseAgentSetupGuide({
        oneuptimeUrl: URL,
        apiKey: KEY,
        engine: engine,
      });
      const verify: string = stepTitled(guide, "Verify the installation");
      const hasDiagnostics: boolean = WITH_DIAGNOSTICS.includes(engine);

      expect(count(verify, ON_BY_DEFAULT)).toBe(hasDiagnostics ? 1 : 0);
      expect(
        getSetupGuideMarkdown(guide).includes("AI investigations are on"),
      ).toBe(hasDiagnostics);

      if (hasDiagnostics) {
        expect(verify).toContain(
          "with the install script or Docker Compose, the OneUptime AI agent runs beside the collector",
        );
        expect(verify).toContain("read this database's diagnostics");
        expect(verify).toContain("changes nothing unless you allow fixes");
        // It points at the Advanced topic that lists the agent's files.
        expect(
          (guide.advanced || []).some((topic: SetupGuideTopic): boolean => {
            return topic.title === "The files the agent runs";
          }),
        ).toBe(true);
      }
    },
  );

  test("a database's own guide says it too", () => {
    const database: DatabaseDocumentationTarget = {
      id: "42b6aaae-7558-42fe-999b-395bbfc79d63",
      name: "orders-db",
      dbSystem: "postgresql",
      serverAddress: "orders-db.example.com",
      serverPort: 5432,
    };
    const guide: SetupGuideContent = getDatabaseAgentSetupGuide({
      oneuptimeUrl: URL,
      apiKey: KEY,
      engine: "postgresql",
      database: database,
    });

    expect(stepTitled(guide, "Verify the installation")).toContain(
      ON_BY_DEFAULT,
    );
  });
});

describe("the host guide", () => {
  const methods: Array<HostInstallMethod> = keysOf(HOST_INSTALL_METHODS);

  function aiAgentTopic(
    method: HostInstallMethod,
  ): SetupGuideTopic | undefined {
    return (
      getHostSetupGuide({ oneuptimeUrl: URL, apiKey: KEY, method: method })
        .advanced || []
    ).find((topic: SetupGuideTopic): boolean => {
      return topic.title === HOST_AI_AGENT_TOPIC_TITLE;
    });
  }

  test.each(methods)(
    "%s: offers the Host AI agent only where it runs, on Linux",
    (method: HostInstallMethod) => {
      const isLinux: boolean =
        NATIVE_LINUX_INSTALL_METHODS.includes(method) || method === "docker";

      expect(Boolean(aiAgentTopic(method))).toBe(isLinux);
    },
  );

  test.each(
    methods.filter((method: HostInstallMethod): boolean => {
      return Boolean(aiAgentTopic(method));
    }),
  )(
    "%s: the topic says AI investigations are on by default, and how to add the agent",
    (method: HostInstallMethod) => {
      const topic: SetupGuideTopic = aiAgentTopic(method)!;

      expect(topic.summary).toContain("AI investigations are on by default.");
      // Summaries render as plain text.
      expect(topic.summary).not.toMatch(/[`*[\]]/);
      expect(topic.markdown).toMatch(
        /^\*\*AI investigations are on by default\*\* for every host/,
      );
      expect(topic.markdown).toContain(
        `\`\`\`bash\n${HOST_AI_AGENT_INSTALL_COMMAND}\n\`\`\``,
      );
      expect(topic.markdown).toContain(
        "changes nothing unless you allow fixes",
      );
      expect(topic.markdown).toContain("not rootless Docker");
      expect(topic.markdown.includes("add it on Linux hosts only")).toBe(
        method === "docker",
      );
    },
  );

  test("the installer it runs is the Host AI agent's, and asks what the topic says", () => {
    expect(HOST_AI_AGENT_INSTALL_COMMAND).toBe(
      "curl -fsSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/HostAIAgent/install.sh -o install.sh\nsudo bash install.sh",
    );

    const installer: string = fs.readFileSync(
      path.join(REPO_ROOT, "agents/HostAIAgent/install.sh"),
      "utf8",
    );

    // URL, ingestion key, host name (empty: the hostname).
    expect(installer).toContain('ask ONEUPTIME_URL "OneUptime URL');
    expect(installer).toContain(
      'ask ONEUPTIME_TELEMETRY_INGESTION_KEY "OneUptime Telemetry Ingestion Key: "',
    );
    expect(installer).toContain("leave empty to use the hostname");
    // It refuses a rootless engine and needs the Compose plugin.
    expect(installer).toContain("grep -q rootless");
    expect(installer).toContain("docker compose version");
  });

  test("every command the topic names is one the host policy runs as a read", () => {
    for (const argv of [
      ["systemctl", "status", "nginx.service", "--no-pager", "-n", "50"],
      ["df", "-h"],
      ["free", "-m"],
      ["ps", "aux"],
    ]) {
      expect({
        command: argv.join(" "),
        tier: HostCommandPolicy.evaluateArgv(argv).tier,
      }).toEqual({ command: argv.join(" "), tier: ResourceCommandTier.Read });
    }
  });

  test("its link lands on the Hosts section of the infrastructure AI agents page", () => {
    const topic: SetupGuideTopic = aiAgentTopic("linux-deb")!;
    const link: RegExpMatchArray | null = topic.markdown.match(
      /\]\(\/docs\/ai\/infrastructure-ai-agents#([^)]+)\)/,
    );
    const page: string = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "packages/App/FeatureSet/Docs/Content/en/ai/infrastructure-ai-agents.md",
      ),
      "utf8",
    );
    const anchors: Array<string> = (page.match(/^#{1,6} .+$/gm) || []).map(
      (heading: string): string => {
        return markdownSlugify(heading.replace(/^#{1,6} /, ""));
      },
    );

    expect(link).not.toBeNull();
    expect(anchors).toContain(link![1]);
  });
});
