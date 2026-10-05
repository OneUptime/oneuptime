import slugify from "Common/Server/Types/MarkdownSlugify";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The docs say AI investigations are on by default wherever an AI agent is
 * installed — for a Kubernetes cluster and every other resource — and say
 * where to see it: the Overview's AI agent card.
 *
 *   - The Kubernetes agent install commands spell the chart's default out
 *     (--set aiAgent.enabled=true) in every language the page ships in,
 *     with a note saying what it does and the value that turns it off; the
 *     chart's README does the same.
 *   - The Docker and Podman quick starts install the AI agent beside the
 *     collector, as install.sh and the agents' docker-compose.yml do, so
 *     "on by default" is true for the documented install too.
 *   - Every resource page's AI agent section opens its notes with "AI
 *     investigations are on by default", and says how to stop.
 *   - The AI SRE and Infrastructure AI Agents pages describe the
 *     Overview's AI agent card in the dashboard's words.
 *
 * Markdown is not compiled, so nothing else notices a command losing the
 * flag, a translation falling behind, or the card's words changing.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const CONTENT_DIR: string = path.join(
  REPO_ROOT,
  "packages/App/FeatureSet/Docs/Content",
);
const CHART_DIR: string = path.join(
  REPO_ROOT,
  "HelmChart/Public/kubernetes-agent",
);
const DASHBOARD_DIR: string = path.join(
  REPO_ROOT,
  "packages/App/FeatureSet/Dashboard/src",
);

const ON_FLAG: string = "--set aiAgent.enabled=true";
const OFF_FLAG: string = "--set aiAgent.enabled=false";

/*
 * js-yaml from Common/node_modules, as OpenTelemetryCollectorExampleDocs
 * .test.ts loads it and for the same reason: Common declares js-yaml 4, App
 * declares no YAML parser.
 */
interface JsYamlModule {
  load: (text: string) => unknown;
}

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const yaml: JsYamlModule = require(
  path.join(REPO_ROOT, "packages", "Common", "node_modules", "js-yaml"),
);
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

function read(relativeToContent: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, relativeToContent), "utf8");
}

// The page's anchors, as the docs renderer makes them.
function anchorsOf(markdown: string): Array<string> {
  return (markdown.match(/^#{1,6} .+$/gm) || []).map(
    (heading: string): string => {
      return slugify(heading.replace(/^#{1,6} /, "").trim());
    },
  );
}

// GitHub's anchors, for the chart README (rendered on GitHub and Artifact Hub).
function githubAnchorsOf(markdown: string): Array<string> {
  return (markdown.match(/^#{1,6} .+$/gm) || []).map(
    (heading: string): string => {
      return heading
        .replace(/^#{1,6} /, "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9 _-]/g, "")
        .replace(/ /g, "-");
    },
  );
}

// The body of every fenced bash block that runs `helm install`.
function helmInstallCommands(markdown: string): Array<string> {
  return [...markdown.matchAll(/```bash\n([\s\S]*?)\n```/g)]
    .map((match: RegExpMatchArray): string => {
      return match[1] || "";
    })
    .filter((block: string): boolean => {
      return block.includes("helm install");
    })
    .map((block: string): string => {
      return block.slice(block.indexOf("helm install"));
    });
}

function linesOf(command: string): Array<string> {
  return command.split("\n").map((line: string): string => {
    return line.replace(/\s*\\$/, "").trim();
  });
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function between(text: string, start: string, end: string): string {
  const from: number = text.indexOf(start);
  const to: number = text.indexOf(end, from + start.length);

  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);

  return text.slice(from, to);
}

const KUBERNETES_LANGUAGES: Array<string> = fs
  .readdirSync(CONTENT_DIR)
  .filter((language: string): boolean => {
    return fs.existsSync(
      path.join(CONTENT_DIR, language, "telemetry/kubernetes-agent.md"),
    );
  })
  .sort();

describe("the Kubernetes agent page", () => {
  it("ships in English and every translation", () => {
    expect(KUBERNETES_LANGUAGES).toContain("en");
    expect(KUBERNETES_LANGUAGES.length).toBeGreaterThanOrEqual(17);
  });

  describe.each(KUBERNETES_LANGUAGES)("in %s", (language: string) => {
    const page: string = read(`${language}/telemetry/kubernetes-agent.md`);
    // Step 3 is the third "## " section after the overview: everything up to step 4.
    const install: string = page.slice(
      page.indexOf("helm install"),
      page.indexOf("\n## ", page.lastIndexOf("--set preset=eks-fargate")),
    );
    const commands: Array<string> = helmInstallCommands(install);

    it("installs on standard clusters, GKE Autopilot and EKS Fargate, each with AI investigations on", () => {
      expect(commands).toHaveLength(3);

      for (const command of commands) {
        expect(count(command, ON_FLAG)).toBe(1);
        expect(command).not.toContain(OFF_FLAG);
      }
    });

    it("right after the cluster name, before the preset, in one command", () => {
      for (const command of commands) {
        const lines: Array<string> = linesOf(command);
        const clusterName: number = lines.indexOf(
          '--set clusterName="my-cluster"',
        );

        expect(clusterName).toBeGreaterThan(-1);
        expect(lines[clusterName + 1]).toBe(ON_FLAG);

        const preset: number = lines.findIndex((line: string): boolean => {
          return line.startsWith("--set preset=");
        });
        if (preset > -1) {
          expect(preset).toBe(clusterName + 2);
        }

        // Every line but the last continues the command.
        expect(
          command
            .split("\n")
            .slice(0, -1)
            .every((line: string): boolean => {
              return line.endsWith(" \\");
            }),
        ).toBe(true);
        expect(command.split("\n").pop()!.endsWith("\\")).toBe(false);
      }
    });

    it("the commands are the English page's, character for character", () => {
      const english: Array<string> = helmInstallCommands(
        read("en/telemetry/kubernetes-agent.md"),
      ).slice(0, 3);

      expect(commands).toEqual(english);
    });

    it("says, after the commands and before verifying, that AI investigations are on and how to install without them", () => {
      const lastFence: number = install.lastIndexOf("```");
      const note: string = install.slice(lastFence + 3).trim();

      expect(note).toMatch(/^\*\*[^*]+\*\* `aiAgent\.enabled=true`/);
      expect(note).toContain(`\`${OFF_FLAG}\``);
      expect(note).toContain("`kubectl`");
      // One paragraph, then step 4.
      expect(note).not.toContain("\n\n");
    });

    if (language !== "en") {
      it("in its own language, not the English note", () => {
        const englishInstall: string = read("en/telemetry/kubernetes-agent.md");
        const englishNote: string = englishInstall
          .slice(
            englishInstall.lastIndexOf(
              "```",
              englishInstall.indexOf("## Step 4"),
            ) + 3,
            englishInstall.indexOf("## Step 4"),
          )
          .trim();
        const note: string = install
          .slice(install.lastIndexOf("```") + 3)
          .trim();

        expect(note).not.toBe(englishNote);
        expect(note).not.toContain("AI investigations are on by default");
      });
    }
  });

  it("in English, the note links to the Kubernetes AI agent section on the same page", () => {
    const page: string = read("en/telemetry/kubernetes-agent.md");
    const note: string = between(
      page,
      "**AI investigations are on by default.**",
      "## Step 4",
    );

    expect(note).toContain("[Kubernetes AI agent](#kubernetes-ai-agent)");
    expect(anchorsOf(page)).toContain("kubernetes-ai-agent");
    expect(note).toContain(
      "OneUptime AI investigates it with read-only `kubectl` (`get`, `describe`, `logs`, `events`, `top`) and changes nothing. Fixes stay off until you allow them.",
    );
  });

  it("the flag restates the chart's default", () => {
    const values: { aiAgent: { enabled: unknown } } = yaml.load(
      fs.readFileSync(path.join(CHART_DIR, "values.yaml"), "utf8"),
    ) as { aiAgent: { enabled: unknown } };

    expect(values.aiAgent.enabled).toBe(true);
  });
});

describe("the Kubernetes agent chart's README", () => {
  const readme: string = fs.readFileSync(
    path.join(CHART_DIR, "README.md"),
    "utf8",
  );
  const quickStartAndPresets: string = between(
    readme,
    "## Quick start",
    "## Kubernetes AI agent",
  );

  it("installs with AI investigations on in the quick start and both presets", () => {
    const commands: Array<string> = helmInstallCommands(quickStartAndPresets);

    expect(commands).toHaveLength(3);
    for (const command of commands) {
      const lines: Array<string> = linesOf(command);
      const clusterName: number = lines.findIndex((line: string): boolean => {
        return line.startsWith("--set clusterName=");
      });

      expect(count(command, ON_FLAG)).toBe(1);
      expect(lines[clusterName + 1]).toBe(ON_FLAG);
    }
  });

  it("says what the flag does, and links to the AI agent section", () => {
    const note: string = between(
      quickStartAndPresets,
      "**AI investigations are on by default.**",
      "## Pick a preset",
    );

    expect(note).toContain("the chart's default, spelled out above");
    expect(note).toContain(`\`${OFF_FLAG}\``);
    expect(note).toContain("Fixes stay off until you allow them.");

    const link: RegExpMatchArray | null = note.match(
      /\[Kubernetes AI agent\]\(#([^)]+)\)/,
    );
    expect(link).not.toBeNull();
    expect(githubAnchorsOf(readme)).toContain(link![1]);
  });
});

/*
 * The Docker and Podman quick starts now start the AI agent beside the
 * collector, with the same container the agents' own docker-compose.yml
 * runs: same name, image, user, read-only root, socket and identity.
 */
describe.each<[string, string, string, string, string, string]>([
  [
    "Docker",
    "en/telemetry/docker-host.md",
    "agents/DockerAgent/docker-compose.yml",
    "oneuptime-docker-ai-agent",
    "docker",
    "DOCKER_HOST_NAME",
  ],
  [
    "Podman",
    "en/telemetry/podman-host.md",
    "agents/PodmanAgent/docker-compose.yml",
    "oneuptime-podman-ai-agent",
    "podman",
    "PODMAN_HOST_NAME",
  ],
])(
  "the %s host page",
  (
    _name: string,
    pagePath: string,
    composePath: string,
    service: string,
    resourceType: string,
    hostNameVariable: string,
  ) => {
    const page: string = read(pagePath);
    const quickStart: string = between(page, "## Quick Start", "\n## ");
    const composeSection: string = between(
      page,
      "## Alternative",
      "\n## Environment Variables",
    );
    const repoCompose: {
      services: Record<
        string,
        {
          image: string;
          user: string;
          read_only: boolean;
          volumes: Array<string>;
          environment: Array<string>;
        }
      >;
    } = yaml.load(
      fs.readFileSync(path.join(REPO_ROOT, composePath), "utf8"),
    ) as never;
    const repoService: {
      image: string;
      user: string;
      read_only: boolean;
      volumes: Array<string>;
      environment: Array<string>;
    } = repoCompose.services[service]!;

    it("the quick start is two commands: the collector, then the AI agent", () => {
      const runs: Array<string> = [
        ...quickStart.matchAll(/```bash\n([\s\S]*?)\n```/g),
      ].map((match: RegExpMatchArray): string => {
        return match[1] || "";
      });

      expect(runs).toHaveLength(2);
      expect(runs[0]).not.toContain(service);
      expect(runs[1]).toContain(`--name ${service}`);
      expect(runs[1]).toContain(repoService.image);
      expect(runs[1]).toContain(`--user ${repoService.user}`);
      expect(runs[1]).toContain("--read-only --tmpfs /tmp");
      expect(runs[1]).toContain(`-v ${repoService.volumes[0]}`);
      expect(runs[1]).toContain(
        `-e ONEUPTIME_AI_AGENT_RESOURCE_TYPE=${resourceType}`,
      );
      expect(runs[1]).toContain(`-e ${hostNameVariable}=`);
      expect(repoService.environment).toContain(
        `ONEUPTIME_AI_AGENT_RESOURCE_TYPE=${resourceType}`,
      );
    });

    it("says AI investigations are on by default, and how to install without them", () => {
      expect(quickStart).toContain("**AI investigations are on by default**");
      expect(quickStart).toContain(
        "To install without AI investigations, skip this command.",
      );
      expect(page).not.toContain("Quick Start (One Command)");
    });

    it("the compose file runs the AI agent too, as the agent's own compose file does", () => {
      const services: {
        services: Record<
          string,
          {
            image: string;
            user: string;
            read_only: boolean;
            volumes: Array<string>;
            environment: Array<string>;
          }
        >;
      } = yaml.load(
        composeSection.match(/```yaml\n([\s\S]*?)\n```/)![1]!,
      ) as never;
      const documented: {
        image: string;
        user: string;
        read_only: boolean;
        volumes: Array<string>;
        environment: Array<string>;
      } = services.services[service]!;

      expect(Object.keys(services.services)).toHaveLength(2);
      expect(documented.image).toBe(repoService.image);
      expect(documented.user).toBe(repoService.user);
      expect(documented.read_only).toBe(true);
      expect(documented.volumes).toEqual(repoService.volumes);
      expect(documented.environment).toContain(
        `ONEUPTIME_AI_AGENT_RESOURCE_TYPE=${resourceType}`,
      );
      expect(composeSection).toContain(
        "leave it out to run the collector without AI investigations",
      );
    });

    it("upgrades and uninstalls both containers", () => {
      const upgrading: string = between(
        page,
        "## Upgrading the Agent",
        "\n## ",
      );

      expect(upgrading).toContain("oneuptime/resource-ai-agent:release");
      expect(upgrading).toContain(service);
    });
  },
);

/*
 * Every resource page's AI agent section: the notes open with AI
 * investigations being on by default, where the Overview shows the agent,
 * and how to stop.
 */
describe.each<[string, string, string]>([
  ["Docker host", "en/telemetry/docker-host.md", "host"],
  ["Podman host", "en/telemetry/podman-host.md", "host"],
  ["Docker Swarm", "en/telemetry/docker-swarm.md", "cluster"],
  ["Proxmox", "en/telemetry/proxmox.md", "cluster"],
  ["VMware", "en/telemetry/vmware.md", "vCenter"],
  ["Ceph", "en/telemetry/ceph.md", "cluster"],
  ["Databases", "en/telemetry/databases.md", "database"],
  ["Host", "en/telemetry/host-otel-collector.md", "host"],
])("the %s page", (_name: string, pagePath: string, noun: string) => {
  const page: string = read(pagePath);

  it("says AI investigations are on by default, once, as the first of the AI agent's notes", () => {
    expect(count(page, "- **AI investigations are on by default.**")).toBe(1);

    const at: number = page.indexOf(
      "- **AI investigations are on by default.**",
    );
    // The line before it is the paragraph that introduces the AI agent.
    const before: string = page.slice(0, at).trimEnd();
    expect(before.endsWith("-")).toBe(false);
    expect(before.slice(before.lastIndexOf("\n") + 1)).not.toMatch(/^- /);
  });

  it("says where to see it and how to stop", () => {
    const note: string = page.slice(
      page.indexOf("- **AI investigations are on by default.**"),
    );
    const line: string = note.slice(0, note.indexOf("\n"));

    expect(line).toContain(
      `Once the agent connects, OneUptime AI investigates incidents and alerts on this ${noun} with it`,
    );
    expect(line).toContain(
      `the ${noun}'s **Overview** shows the agent's status`,
    );
    /*
     * Investigation is the agent's own setting (ONEUPTIME_AI_INVESTIGATION),
     * which the AI agent page shows read-only while the agent sets it: the
     * note says where to stop it, and that the page's Change shows how.
     */
    expect(line).toContain(
      "set `ONEUPTIME_AI_INVESTIGATION=false` where the agent runs (**Change** under **What AI may do** on the AI agent page shows how)",
    );
    expect(line).not.toContain("turn investigation off under");
  });
});

describe("the VMware page in Persian", () => {
  it("says it too, in Persian, in the same place", () => {
    const page: string = read("fa/telemetry/vmware.md");
    const english: string = read("en/telemetry/vmware.md");

    expect(page).not.toContain("AI investigations are on by default");
    expect(page).toContain("بررسی‌های هوش مصنوعی به‌طور پیش‌فرض روشن هستند");
    expect(page).toContain("**What AI may do**");
    expect(page).toContain("**Overview**");

    // Same place: the first note under the AI agent paragraph, as in English.
    const noteIndex: (markdown: string) => number = (
      markdown: string,
    ): number => {
      const lines: Array<string> = markdown.split("\n");
      const intro: number = lines.findIndex((line: string): boolean => {
        return line.includes("`oneuptime-vmware-ai-agent` (");
      });
      return lines.findIndex((line: string, index: number): boolean => {
        return index > intro && line.startsWith("- ");
      });
    };
    const persianLines: Array<string> = page.split("\n");
    expect(persianLines[noteIndex(page)]).toContain(
      "بررسی‌های هوش مصنوعی به‌طور پیش‌فرض روشن هستند",
    );
    expect(english.split("\n")[noteIndex(english)]).toContain(
      "**AI investigations are on by default.**",
    );
  });
});

/*
 * The Overview's AI agent card, in the dashboard's own words: its title,
 * the four fixes modes by the names its badges use, and the AI agent page
 * it links to.
 */
describe("the Overview's AI agent card in the docs", () => {
  const card: string = fs.readFileSync(
    path.join(
      DASHBOARD_DIR,
      "Components/AiAccess/AiAgentStatusSummaryCard.tsx",
    ),
    "utf8",
  );
  const summary: string = fs.readFileSync(
    path.join(DASHBOARD_DIR, "Components/AiAccess/AiAgentStatusSummary.ts"),
    "utf8",
  );
  const shortNames: string = fs.readFileSync(
    path.join(
      DASHBOARD_DIR,
      "Components/ResourceAiAgent/ResourceAiAccessSettingsUtil.ts",
    ),
    "utf8",
  );

  it.each<[string, string, string]>([
    [
      "AI SRE",
      "en/ai/ai-sre.md",
      "The cluster's **Overview** ends with an **AI agent** card",
    ],
    [
      "Infrastructure AI Agents",
      "en/ai/infrastructure-ai-agents.md",
      "The resource's **Overview** ends with an **AI agent** card",
    ],
  ])(
    "%s describes it: connection, investigation, the four fixes modes, and the link",
    (_name: string, pagePath: string, opening: string) => {
      const page: string = read(pagePath);
      const paragraph: string = page.slice(
        page.indexOf(opening),
        page.indexOf("\n", page.indexOf(opening)),
      );

      expect(page.indexOf(opening)).toBeGreaterThan(-1);
      expect(paragraph).toContain("whether the agent is connected");
      expect(paragraph).toContain(
        "(**Off**, **Ask for approval**, **Automatic** or **Bypass approval**)",
      );
      expect(paragraph).toContain("what needs attention");
      expect(paragraph).toContain(
        "with a link to the AI agent page, where they are changed",
      );

      // The words the dashboard uses.
      expect(summary).toContain(
        'export const AI_AGENT_STATUS_SUMMARY_TITLE: string = translationKey("AI agent");',
      );
      expect(card).toContain("title={AI_AGENT_STATUS_SUMMARY_TITLE}");
      for (const mode of [
        "Off",
        "Ask for approval",
        "Automatic",
        "Bypass approval",
      ]) {
        expect(shortNames).toContain(`translationKey("${mode}")`);
      }
    },
  );

  it("the cluster page names the switch the cluster's card shows", () => {
    const page: string = read("en/ai/ai-sre.md");
    const paragraph: string = between(
      page,
      "The cluster's **Overview** ends with an **AI agent** card",
      "\n",
    );

    expect(paragraph).toContain("whether **Investigate with kubectl** is on");
  });
});
