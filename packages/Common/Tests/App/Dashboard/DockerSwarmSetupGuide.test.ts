import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import {
  DEFAULT_DOCKER_SWARM_INSTALL_METHOD,
  DOCKER_SWARM_AGENT_DEFAULT_URL,
  DOCKER_SWARM_AGENT_FILES,
  DOCKER_SWARM_AGENT_INSTALL_DIR,
  DOCKER_SWARM_AGENT_INSTALL_NAME,
  DOCKER_SWARM_AI_AGENT_CONTAINER_NAME,
  DOCKER_SWARM_COLLECTOR_CONTAINER_NAME,
  DOCKER_SWARM_DEFAULT_API_VERSION,
  DOCKER_SWARM_DEFAULT_CLUSTER_NAME,
  DOCKER_SWARM_DEFAULT_INVENTORY_INTERVAL_SECONDS,
  DOCKER_SWARM_EXAMPLE_CLUSTER_NAME,
  DOCKER_SWARM_INSTALL_METHODS,
  DOCKER_SWARM_INVENTORY_CONTAINER_NAME,
  DockerSwarmInstallMethod,
  getDockerSwarmAgentFileUrl,
  getDockerSwarmAgentInstallScriptCommand,
  getDockerSwarmEnvFile,
  DOCKER_SWARM_NODE_NAME_COMMAND,
  getDockerSwarmSetupGuide,
  resolveDockerSwarmInstallMethod,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/Utils/DocumentationMarkdown";
import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SETUP_GUIDE_URL_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideOption,
  SetupGuideStep,
  SetupGuideTopic,
  codeBlock,
  getSetupGuideCodeBlocks,
  getSetupGuideMarkdown,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import DOCKER_SWARM_CLUSTER_SHOWCASE from "../../../../App/FeatureSet/Dashboard/src/Components/DockerSwarm/DockerSwarmClusterShowcase";
import { INSTALL_SCRIPT_READ_FIRST_NOTE } from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/AgentInstallCommands";
import { getInstallScriptEntry } from "../../../Types/InstallScripts/InstallScripts";

/*
 * The Docker Swarm agent guide asks how the agent is installed — the
 * install script, or the same files by hand with Docker Compose — and shows
 * only that way's steps. These tests pin, for both ways:
 *
 *   - that the agent runs on a manager node, said before anything else;
 *   - that the install script, which always prompts, is handed only the
 *     reader's URL, as the answer Enter takes, never the key — and that the
 *     Compose .env is; and that the script and its files come from the
 *     reader's own OneUptime, never GitHub;
 *   - what the (skipped, but kept truthful) E2E spec reads off the page;
 *   - that every file, URL, container name and variable the guide uses is
 *     the one agents/DockerSwarmAgent really ships.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const AGENT_DIR: string = path.join(REPO_ROOT, "agents", "DockerSwarmAgent");
const DOCS_DIR: string = path.join(
  REPO_ROOT,
  "packages/App/FeatureSet/Docs/Content/en",
);
const E2E_SPEC: string = path.join(
  REPO_ROOT,
  "packages/E2E/Tests/Dashboard/DockerSwarmProduct.spec.ts",
);

const URL: string = "https://oneuptime.example.com";
const KEY: string = "tik_secret_123";

// A line of a .env file that sets the URL (not a command that passes it on).
const ENV_LINE_PATTERN: RegExp = /^ONEUPTIME_URL=\S+$/m;

// An address of this OneUptime's Swarm agent files: the script, or one file.
const SERVED_FILE_PATTERN: RegExp =
  /https:\/\/oneuptime\.example\.com\/install\/docker-swarm-agent(?:\/([A-Za-z0-9._/-]+))?/g;
// Ingestion keys are UUIDs; the E2E spec matches the key by that shape.
const UUID_KEY: string = "0f8fad5b-d9cb-469f-a165-70867728950e";

// The swarm disconnect sweep: 15 minutes of time OneUptime was receiving.
const SWARM_DISCONNECT_AFTER_15_MINUTES: RegExp =
  /markDisconnectedClusters[\s\S]*?ReceivingCoverage\.getSilenceCutoff\(\{\s*silenceInMinutes: 15,/;

const METHODS: Array<DockerSwarmInstallMethod> =
  DOCKER_SWARM_INSTALL_METHODS.map(
    (
      option: SetupGuideOption<DockerSwarmInstallMethod>,
    ): DockerSwarmInstallMethod => {
      return option.key;
    },
  );

const readAgentFile: (name: string) => string = (name: string): string => {
  return fs.readFileSync(path.join(AGENT_DIR, name), "utf8");
};

const guideFor: (
  method: DockerSwarmInstallMethod,
  overrides?: { apiKey?: string; clusterName?: string },
) => SetupGuideContent = (
  method: DockerSwarmInstallMethod,
  overrides?: { apiKey?: string; clusterName?: string },
): SetupGuideContent => {
  return getDockerSwarmSetupGuide({
    oneuptimeUrl: URL,
    apiKey: overrides?.apiKey ?? KEY,
    method: method,
    clusterName: overrides?.clusterName,
  });
};

const titles: (items: Array<{ title: string }> | undefined) => Array<string> = (
  items: Array<{ title: string }> | undefined,
): Array<string> => {
  return (items || []).map((item: { title: string }): string => {
    return item.title;
  });
};

const topicTitled: (
  topics: Array<SetupGuideTopic> | undefined,
  title: string,
) => SetupGuideTopic = (
  topics: Array<SetupGuideTopic> | undefined,
  title: string,
): SetupGuideTopic => {
  const topic: SetupGuideTopic | undefined = (topics || []).find(
    (candidate: SetupGuideTopic): boolean => {
      return candidate.title === title;
    },
  );
  if (!topic) {
    throw new Error(`No topic titled "${title}"`);
  }
  return topic;
};

const stepsText: (guide: SetupGuideContent) => string = (
  guide: SetupGuideContent,
): string => {
  return guide.steps
    .map((step: SetupGuideStep): string => {
      return `${step.title}\n${step.description || ""}\n${step.markdown || ""}`;
    })
    .join("\n");
};

const codeLines: (guide: SetupGuideContent) => Array<string> = (
  guide: SetupGuideContent,
): Array<string> => {
  return getSetupGuideCodeBlocks(guide).flatMap(
    (block: string): Array<string> => {
      return block.split("\n").map((line: string): string => {
        return line.trim();
      });
    },
  );
};

type ComposeService = Record<string, unknown>;

const repoCompose: Record<string, ComposeService> = (
  yaml.load(readAgentFile("docker-compose.yml")) as {
    services: Record<string, ComposeService>;
  }
).services;

const envNamesOf: (service: ComposeService) => Array<string> = (
  service: ComposeService,
): Array<string> => {
  return (service["environment"] as Array<string>).map(
    (entry: string): string => {
      return entry.split("=")[0]!;
    },
  );
};

/*
 * The script and its files come from the reader's own OneUptime, which
 * serves them for its release; the URL in the script's environment is the
 * answer Enter takes at its URL question.
 */
const SERVED: string = `${URL}/install/docker-swarm-agent`;
const INSTALL_COMMAND: string = `curl -fsSL ${SERVED} -o install.sh\nONEUPTIME_URL=${URL} sh install.sh`;

describe("the install method picker", () => {
  test("offers the install script first, then Docker Compose", () => {
    expect(METHODS).toEqual(["install-script", "docker-compose"]);
    expect(DEFAULT_DOCKER_SWARM_INSTALL_METHOD).toBe("install-script");
    expect(
      DOCKER_SWARM_INSTALL_METHODS.map(
        (option: SetupGuideOption<DockerSwarmInstallMethod>): string => {
          return option.label;
        },
      ),
    ).toEqual(["Install script", "Docker Compose"]);
  });

  test("every method has a plain one-line description and no badge", () => {
    for (const option of DOCKER_SWARM_INSTALL_METHODS) {
      expect((option.description || "").length).toBeGreaterThan(0);
      expect(option.description).not.toContain("\n");
      expect(option.description).not.toMatch(/[`*[\]]/);
      expect(option.badge).toBeUndefined();
    }
  });

  test("only one option's accessible name matches the E2E spec's radio lookup", () => {
    // getByRole("radio", { name: /Docker Compose/ }) must find exactly one.
    const named: Array<string> = DOCKER_SWARM_INSTALL_METHODS.filter(
      (option: SetupGuideOption<DockerSwarmInstallMethod>): boolean => {
        return `${option.label} ${option.description}`.includes(
          "Docker Compose",
        );
      },
    ).map((option: SetupGuideOption<DockerSwarmInstallMethod>): string => {
      return option.key;
    });
    expect(named).toEqual(["docker-compose"]);
  });

  test("an unknown or missing method resolves to the install script", () => {
    for (const value of [undefined, null, "", "helm", "Docker-Compose"]) {
      expect(resolveDockerSwarmInstallMethod(value)).toBe("install-script");
    }
    expect(resolveDockerSwarmInstallMethod("docker-compose")).toBe(
      "docker-compose",
    );
  });
});

describe.each(METHODS)("the %s guide", (method: DockerSwarmInstallMethod) => {
  const guide: SetupGuideContent = guideFor(method);
  const markdown: string = getSetupGuideMarkdown(guide);
  const isScript: boolean = method === "install-script";

  test("is a short list of steps after the key, ending with a check", () => {
    expect(titles(guide.steps)).toEqual(
      isScript
        ? [
            "Run the install script on a manager node",
            "Verify the installation",
          ]
        : [
            "Download the agent's files",
            "Configure and start the agent",
            "Verify the installation",
          ],
    );
  });

  test("every step has a one-sentence plain description", () => {
    for (const step of guide.steps) {
      expect(step.description).toBeTruthy();
      expect(step.description).not.toContain("\n");
      expect(step.description).not.toMatch(/[`*[\]]/);
    }
  });

  test("says up front that it runs on a manager node", () => {
    const prerequisites: Array<string> = guide.prerequisites || [];
    expect(prerequisites).toHaveLength(2);
    expect(prerequisites[0]).toContain("**manager** node");
    expect(prerequisites[0]).toContain("manager-only API endpoints");
    expect(prerequisites[1]).toBe(
      "Docker Engine 20.10+ with the Docker Compose v2 plugin",
    );
    expect(`${guide.steps[0]!.title} ${guide.steps[0]!.description}`).toMatch(
      /manager node/,
    );
  });

  test("the key step says where the key goes for this method", () => {
    expect(guide.keyStep?.description).toContain(
      isScript ? "the install script asks for it" : "the .env file below",
    );
    // The agent takes the base URL, which step 1 shows by default.
    expect(guide.keyStep?.endpointValue).toBeUndefined();
  });

  test("shows only this method's commands", () => {
    if (isScript) {
      expect(markdown).toContain(INSTALL_COMMAND);
      // No .env to write: the script asks (Enter takes the URL the command sets).
      expect(markdown).not.toMatch(ENV_LINE_PATTERN);
      expect(markdown).not.toContain("ONEUPTIME_SERVICE_TOKEN=");
      expect(markdown).not.toContain("DOCKER_SWARM_CLUSTER_NAME=");
      // No agent file downloaded by hand: the script downloads them.
      expect(markdown).not.toContain("-o docker-compose.yml");
      expect(markdown).not.toContain("-o otel-collector-config.yaml");
      expect(markdown).not.toContain("# In the agent's folder");
      expect(markdown).not.toContain("delete the `");
    } else {
      expect(markdown).not.toContain("sh install.sh");
      expect(markdown).not.toContain(`cd ${DOCKER_SWARM_AGENT_INSTALL_DIR}`);
      expect(markdown).not.toContain(DOCKER_SWARM_AGENT_INSTALL_DIR);
      expect(markdown).toContain(
        `\`${DOCKER_SWARM_AI_AGENT_CONTAINER_NAME}\` service from docker-compose.yml`,
      );
    }
  });

  test("keeps configuration and optional extras out of the first-run steps", () => {
    const steps: string = stepsText(guide);
    for (const advanced of [
      "DOCKER_API_VERSION",
      "DOCKER_INVENTORY_INTERVAL_SECONDS",
      "ONEUPTIME_AI_",
      "--no-ai-agent",
      "node.role == manager",
      "docker compose pull",
      "docker compose down",
      "troubleshoot.sh",
    ]) {
      expect(steps).not.toContain(advanced);
    }
  });

  test("no copy-paste block follows logs before a later command", () => {
    /*
     * \`logs -f\` blocks until interrupted, so any command after it in the
     * same block never runs when the block is pasted as a whole.
     */
    for (const block of getSetupGuideCodeBlocks(guide)) {
      const lines: Array<string> = block.trimEnd().split("\n");
      lines.slice(0, -1).forEach((line: string): void => {
        expect(line).not.toMatch(/ logs -f /);
      });
    }
  });

  test("the verify step lists the three containers and how long to wait", () => {
    const verify: string = guide.steps[guide.steps.length - 1]!.markdown || "";
    expect(verify).toContain(
      `docker compose ps\ndocker compose logs --tail 50 ${DOCKER_SWARM_COLLECTOR_CONTAINER_NAME} ${DOCKER_SWARM_INVENTORY_CONTAINER_NAME}`,
    );
    expect(verify).toContain(
      isScript
        ? `cd ${DOCKER_SWARM_AGENT_INSTALL_DIR}\ndocker compose ps`
        : "# In the agent's folder\ndocker compose ps",
    );
    for (const container of [
      DOCKER_SWARM_COLLECTOR_CONTAINER_NAME,
      DOCKER_SWARM_INVENTORY_CONTAINER_NAME,
      DOCKER_SWARM_AI_AGENT_CONTAINER_NAME,
    ]) {
      expect(verify).toContain(`\`${container}\``);
    }
    expect(verify).toContain("appears in the **Docker Swarm** section");
    expect(verify).toContain("first inventory snapshot (≤ 5 minutes)");
    expect(verify).toContain(
      "**OneUptime AI agent (on by default, read-only).**",
    );
  });

  test("has Advanced topics for placement, settings, the AI agent, internals, upgrades and data", () => {
    expect(titles(guide.advanced)).toEqual([
      "Where to run the agent",
      "Environment variables",
      "The OneUptime AI agent",
      "How the agent works",
      "Upgrade or uninstall the agent",
      "What the agent collects",
    ]);
  });

  test("every Advanced topic has a plain one-line summary", () => {
    for (const topic of guide.advanced || []) {
      expect(topic.summary).toBeTruthy();
      expect(topic.summary).not.toMatch(/[`*[\]]/);
      expect(topic.summary).not.toContain("\n");
    }
  });

  test("Troubleshooting is titled by symptom", () => {
    expect(titles(guide.troubleshooting)).toEqual([
      "Cluster never appears",
      "No inventory appears",
      'Status flaps to "Disconnected"',
      'Collector exits with "client version is too new"',
      "Cluster appears under the wrong name",
    ]);
  });

  test("every reference to an Advanced topic names one that exists", () => {
    const references: Array<string> = Array.from(
      markdown.matchAll(/see \*\*([^*]+)\*\* (?:under Advanced|above)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });
    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) {
      expect(titles(guide.advanced)).toContain(reference);
    }
  });

  test("links to the Docker Swarm agent and monitor docs", () => {
    expect(guide.links).toEqual([
      {
        title: "Docker Swarm agent documentation",
        url: "/docs/telemetry/docker-swarm",
      },
      {
        title: "Docker Swarm monitors",
        url: "/docs/monitor/docker-swarm-monitor",
      },
    ]);
  });

  test("every docs link in the guide points at a page that exists", () => {
    const links: Array<string> = Array.from(
      markdown.matchAll(/\]\((\/docs\/[^)#\s]+)(?:#[^)\s]*)?\)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });
    expect(links.length).toBeGreaterThan(2);
    for (const link of links) {
      expect({
        link: link,
        exists: fs.existsSync(
          path.join(DOCS_DIR, `${link.replace(/^\/docs\//, "")}.md`),
        ),
      }).toEqual({ link: link, exists: true });
    }
  });

  test("every agent file the guide downloads is one this OneUptime serves, and exists in the repository", () => {
    expect(markdown).not.toContain("githubusercontent");
    const served: Array<string> = Array.from(
      markdown.matchAll(SERVED_FILE_PATTERN),
    ).map((match: RegExpMatchArray): string => {
      // The address alone is the install script.
      return match[1] || "install.sh";
    });
    expect(served.length).toBeGreaterThan(0);
    for (const file of served) {
      expect(
        getInstallScriptEntry(DOCKER_SWARM_AGENT_INSTALL_NAME)?.files,
      ).toContain(file);
      expect({
        file: file,
        exists: fs.existsSync(path.join(AGENT_DIR, file)),
      }).toEqual({ file: file, exists: true });
    }

    const treeUrls: Array<string> = Array.from(
      markdown.matchAll(
        /https:\/\/github\.com\/OneUptime\/oneuptime\/tree\/master\/([^)\s]+)/g,
      ),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });
    for (const directory of treeUrls) {
      expect(fs.statSync(path.join(REPO_ROOT, directory)).isDirectory()).toBe(
        true,
      );
    }
  });

  test("sends the reader's .env changes to the right place", () => {
    const envTopic: string = topicTitled(
      guide.advanced,
      "Environment variables",
    ).markdown;
    expect(envTopic).toContain(
      isScript
        ? `\`${DOCKER_SWARM_AGENT_INSTALL_DIR}/.env\``
        : "the `.env` next to docker-compose.yml",
    );
    const apiVersion: string = topicTitled(
      guide.troubleshooting,
      'Collector exits with "client version is too new"',
    ).markdown;
    expect(apiVersion).toContain(
      "docker version --format '{{ .Server.APIVersion }}'",
    );
    // Negotiated unless pinned: older files pinned 1.44, so new files, unpinned.
    expect(apiVersion).toContain("older agent files pinned `1.44`");
    expect(apiVersion).toContain(
      isScript
        ? "Run the install script again"
        : "Download the agent's files again (step 2)",
    );
    expect(apiVersion).toContain("`DOCKER_API_VERSION=`");
    expect(apiVersion).toContain("`DOCKER_API_VERSION=1.41`");
    expect(apiVersion).toContain("on every node the collector runs on");
  });

  /*
   * Swarm labels a task with its node's ID only, so a Docker Compose install
   * adds the node's name to .env itself - the install script writes it.
   */
  test("tells a Docker Compose install to add the node's name to .env, which the install script writes itself", () => {
    const configure: string = guide.steps
      .map((step: SetupGuideStep): string => {
        return step.markdown || "";
      })
      .join("\n");
    const envTopic: string = topicTitled(
      guide.advanced,
      "Environment variables",
    ).markdown;

    expect(envTopic).toContain("`DOCKER_SWARM_NODE_NAME`");

    if (isScript) {
      expect(configure).not.toContain(DOCKER_SWARM_NODE_NAME_COMMAND);
      expect(envTopic).toContain(
        "The install script sets it to the node's hostname",
      );
    } else {
      expect(configure).toContain(
        `\`\`\`bash\n${DOCKER_SWARM_NODE_NAME_COMMAND}\n\`\`\``,
      );
      // After the .env it appends to, before the agent starts.
      expect(configure.indexOf(DOCKER_SWARM_NODE_NAME_COMMAND)).toBeGreaterThan(
        configure.indexOf("DOCKER_SWARM_CLUSTER_NAME="),
      );
      expect(configure.indexOf(DOCKER_SWARM_NODE_NAME_COMMAND)).toBeLessThan(
        configure.indexOf("docker compose up -d"),
      );
    }

    expect(DOCKER_SWARM_NODE_NAME_COMMAND).toBe(
      `echo "DOCKER_SWARM_NODE_NAME=$(docker info --format '{{.Name}}')" >> .env`,
    );
    expect(readAgentFile("install.sh")).toContain(
      `DOCKER_SWARM_NODE_NAME="$(docker info --format '{{.Name}}' 2>/dev/null || true)"`,
    );
  });

  test("the diagnostic script looks in the folder this method installed to", () => {
    const topic: string = topicTitled(
      guide.troubleshooting,
      "Cluster never appears",
    ).markdown;
    expect(topic).toContain(
      `curl -fsSL ${SERVED}/troubleshoot.sh -o troubleshoot.sh`,
    );
    if (isScript) {
      expect(topic).toContain("bash troubleshoot.sh\n```");
    } else {
      expect(topic).toContain('bash troubleshoot.sh -d "$PWD"');
    }
    expect(topic).toContain("`Exporting failed`");
  });

  test("upgrades by fetching the agent's files again, not only its images", () => {
    const topic: string = topicTitled(
      guide.advanced,
      "Upgrade or uninstall the agent",
    ).markdown;
    if (isScript) {
      expect(topic).toContain(INSTALL_COMMAND);
      expect(topic).toContain("ONEUPTIME_AI_ALLOW_WRITES=true sh install.sh");
      expect(topic).toContain("`--no-ai-agent` again");
      expect(topic).toContain(
        `cd ${DOCKER_SWARM_AGENT_INSTALL_DIR}\ndocker compose down`,
      );
    } else {
      expect(topic).toContain("Download the three files again");
      expect(topic).toContain(
        "docker compose pull\ndocker compose up -d --force-recreate",
      );
      expect(topic).toContain("docker compose down");
    }
  });

  test("leaves the AI agent out the way this method can", () => {
    const topic: string = topicTitled(
      guide.advanced,
      "The OneUptime AI agent",
    ).markdown;
    expect(topic).toContain("**AI → AI agent**");
    expect(topic).toContain("must run on a manager node");
    expect(topic).toContain(
      isScript
        ? "`sh install.sh --no-ai-agent`"
        : `delete the \`${DOCKER_SWARM_AI_AGENT_CONTAINER_NAME}\` service`,
    );
  });
});

describe("the install script", () => {
  const install: SetupGuideStep = guideFor("install-script").steps[0]!;

  test("is the download-and-run command, with the reader's URL as the answer Enter takes, even with a key picked", () => {
    expect(install.markdown).toContain(
      `\`\`\`bash\n${INSTALL_COMMAND}\n\`\`\``,
    );
    for (const apiKey of [KEY, SETUP_GUIDE_API_KEY_PLACEHOLDER]) {
      const markdown: string = getSetupGuideMarkdown(
        guideFor("install-script", { apiKey: apiKey }),
      );
      // The script always prompts for the key and the cluster name...
      expect(markdown).not.toMatch(
        /(ONEUPTIME_SERVICE_TOKEN|DOCKER_SWARM_CLUSTER_NAME)=\S* +(ba)?sh install\.sh/,
      );
      // ...and neither the key nor the placeholder is on the page at all.
      expect(markdown).not.toContain(apiKey);
    }
  });

  test("the script and the URL it offers are the reader's own OneUptime: Cloud, a custom domain, a path, plain HTTP", () => {
    for (const oneuptimeUrl of [
      "https://oneuptime.com",
      "https://oneuptime.acme.internal:8443",
      "http://10.0.0.5",
      "https://tools.acme.com/oneuptime/",
    ]) {
      const base: string = oneuptimeUrl.replace(/\/+$/, "");
      // The question's own answer is OneUptime Cloud: only another is named.
      const run: string =
        oneuptimeUrl === DOCKER_SWARM_AGENT_DEFAULT_URL
          ? "sh install.sh"
          : `ONEUPTIME_URL=${oneuptimeUrl} sh install.sh`;

      expect(getDockerSwarmAgentInstallScriptCommand(oneuptimeUrl)).toBe(
        `curl -fsSL ${base}/install/docker-swarm-agent -o install.sh\n${run}`,
      );
    }
    // A OneUptime that does not know its own host leaves the URL to the question.
    expect(
      getDockerSwarmAgentInstallScriptCommand(SETUP_GUIDE_URL_PLACEHOLDER),
    ).toBe(
      `curl -fsSL '${SETUP_GUIDE_URL_PLACEHOLDER}/install/docker-swarm-agent' -o install.sh\nsh install.sh`,
    );
  });

  /*
   * The note is about the command's first line, so it sits right under the
   * command - the step's markdown is the command alone - and what to answer
   * comes after it, as the step's details.
   */
  test("says the script can be read before it runs, right under the command", () => {
    expect(install.note).toBe(INSTALL_SCRIPT_READ_FIRST_NOTE);
    expect(install.markdown).toBe(codeBlock("bash", INSTALL_COMMAND));
    expect(install.details).toBeTruthy();
    expect(install.details).not.toContain("```");
    expect(getSetupGuideMarkdown(guideFor("install-script"))).toContain(
      `${install.markdown}\n\n${INSTALL_SCRIPT_READ_FIRST_NOTE}\n\n${install.details!.trim()}`,
    );
    expect(
      guideFor("docker-compose").steps.map(
        (step: SetupGuideStep): string | undefined => {
          return step.note;
        },
      ),
    ).not.toContain(INSTALL_SCRIPT_READ_FIRST_NOTE);
  });

  test("says it asks for the URL and the key shown in step 1", () => {
    expect(install.description).toContain(
      "It asks for your OneUptime URL, the ingestion key and a cluster name",
    );
    expect(install.details).toContain(
      "When it asks, enter the OneUptime URL and the ingestion key shown in step 1",
    );
    expect(install.details).toContain(
      `puts the agent in \`${DOCKER_SWARM_AGENT_INSTALL_DIR}\``,
    );
  });

  test("names the cluster a known cluster's tab installs for", () => {
    const known: string =
      guideFor("install-script", { clusterName: "prod-swarm-eu" }).steps[0]!
        .details || "";
    expect(known).toContain(
      "and **`prod-swarm-eu`** as the cluster name — exactly",
    );
    expect(install.details).toContain(
      "a name for the cluster, such as `prod-swarm`",
    );
  });
});

describe("the Docker Compose .env", () => {
  const envBlock: (guide: SetupGuideContent) => string = (
    guide: SetupGuideContent,
  ): string => {
    const markdown: string = guide.steps[1]!.markdown || "";
    return markdown.match(/```bash\n(ONEUPTIME_URL=[\s\S]*?)\n```/)![1]!;
  };

  test("carries the reader's URL, key and a suggested cluster name", () => {
    const guide: SetupGuideContent = guideFor("docker-compose");
    expect(envBlock(guide)).toBe(
      [
        `ONEUPTIME_URL=${URL}`,
        `ONEUPTIME_SERVICE_TOKEN=${KEY}`,
        `DOCKER_SWARM_CLUSTER_NAME=${DOCKER_SWARM_EXAMPLE_CLUSTER_NAME}`,
      ].join("\n"),
    );
    expect(envBlock(guide)).toBe(
      getDockerSwarmEnvFile({
        oneuptimeUrl: URL,
        apiKey: KEY,
        clusterName: DOCKER_SWARM_EXAMPLE_CLUSTER_NAME,
      }),
    );
    expect(guide.steps[1]!.markdown).toContain(
      `Replace \`${DOCKER_SWARM_EXAMPLE_CLUSTER_NAME}\` with a name for this cluster`,
    );
    expect(guide.steps[1]!.markdown).toContain(
      "```bash\ndocker compose up -d\n```",
    );
  });

  test("a cluster's own tab fills in its name and says to keep it", () => {
    const guide: SetupGuideContent = guideFor("docker-compose", {
      clusterName: "  prod-swarm-eu ",
    });
    expect(envBlock(guide)).toContain(
      "DOCKER_SWARM_CLUSTER_NAME=prod-swarm-eu",
    );
    expect(guide.steps[1]!.markdown).toContain(
      "This installs the agent for **`prod-swarm-eu`**",
    );
    expect(guide.steps[1]!.markdown).not.toContain("Replace `");
    expect(getSetupGuideMarkdown(guide)).not.toContain(
      DOCKER_SWARM_EXAMPLE_CLUSTER_NAME,
    );
  });

  test("a blank name, or one that would break the file, counts as unknown", () => {
    for (const clusterName of ["", "   ", "two\nlines", "tick`name"]) {
      expect(
        envBlock(guideFor("docker-compose", { clusterName: clusterName })),
      ).toContain(
        `DOCKER_SWARM_CLUSTER_NAME=${DOCKER_SWARM_EXAMPLE_CLUSTER_NAME}`,
      );
    }
  });

  test("shows the placeholder, and where to pick a key, until a key is picked", () => {
    const guide: SetupGuideContent = guideFor("docker-compose", {
      apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
    });
    expect(envBlock(guide)).toContain(
      `ONEUPTIME_SERVICE_TOKEN=${SETUP_GUIDE_API_KEY_PLACEHOLDER}`,
    );
    expect(guide.steps[1]!.markdown).toContain(
      `Pick an ingestion key in step 1 to fill in \`${SETUP_GUIDE_API_KEY_PLACEHOLDER}\`.`,
    );
    expect(getSetupGuideMarkdown(guideFor("docker-compose"))).not.toContain(
      "Pick an ingestion key in step 1",
    );
  });

  test("downloads exactly the files install.sh does, from the same place", () => {
    const download: Array<string> = codeLines(guideFor("docker-compose")).slice(
      0,
      DOCKER_SWARM_AGENT_FILES.length + 1,
    );
    expect(download).toEqual([
      ...DOCKER_SWARM_AGENT_FILES.map((fileName: string): string => {
        return `curl -fsSL ${getDockerSwarmAgentFileUrl(URL, fileName)} -o ${fileName}`;
      }),
      "chmod +x inventory-snapshot.sh",
    ]);
  });
});

describe("what the E2E spec reads off the page", () => {
  const spec: string = fs.readFileSync(E2E_SPEC, "utf8");

  test("the Compose .env has every line the spec looks for", () => {
    const markdown: string = getSetupGuideMarkdown(
      getDockerSwarmSetupGuide({
        oneuptimeUrl: "http://localhost",
        apiKey: UUID_KEY,
        method: "docker-compose",
      }),
    );
    expect(markdown).toMatch(/ONEUPTIME_SERVICE_TOKEN=([0-9a-fA-F-]{36})/);
    expect(
      markdown.match(/ONEUPTIME_SERVICE_TOKEN=([0-9a-fA-F-]{36})/)![1],
    ).toBe(UUID_KEY);
    expect(markdown).toMatch(/ONEUPTIME_URL=http/);
    expect(markdown).toContain("DOCKER_SWARM_CLUSTER_NAME=my-swarm");
    expect(markdown).toContain("docker compose up -d");
    expect(markdown).not.toContain(SETUP_GUIDE_API_KEY_PLACEHOLDER);
  });

  test("the default option does not show them, so the spec picks Docker Compose first", () => {
    const markdown: string = getSetupGuideMarkdown(
      getDockerSwarmSetupGuide({
        oneuptimeUrl: "http://localhost",
        apiKey: UUID_KEY,
        method: DEFAULT_DOCKER_SWARM_INSTALL_METHOD,
      }),
    );
    expect(markdown).not.toMatch(/ONEUPTIME_SERVICE_TOKEN=/);

    const pick: string =
      'await page.getByRole("radio", { name: /Docker Compose/ }).click();';
    expect(spec.split(pick).length - 1).toBe(2);
    // Each pick comes before the spec polls the page for the key.
    const specTests: Array<string> = spec.split(/\n {2}test\(/).slice(1);
    expect(specTests).toHaveLength(2);
    for (const specTest of specTests) {
      expect(specTest.indexOf(pick)).toBeGreaterThan(-1);
      expect(specTest.indexOf(pick)).toBeLessThan(
        specTest.indexOf(".toMatch(serviceTokenEnvLineRegex)"),
      );
    }
  });

  test("the spec opens the guide from the empty list's showcase, and stays skipped", () => {
    expect(spec).toContain(
      'test.describe.skip("Docker Swarm Product Onboarding"',
    );
    // Whitespace squashed, so Prettier can reflow the page.
    const clusters: string = fs
      .readFileSync(
        path.join(
          REPO_ROOT,
          "packages/App/FeatureSet/Dashboard/src/Pages/DockerSwarm/Clusters.tsx",
        ),
        "utf8",
      )
      .replace(/\s+/g, " ");
    const onboarding: string = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "packages/App/FeatureSet/Dashboard/src/Components/DockerSwarm/DockerSwarmClusterOnboarding.tsx",
      ),
      "utf8",
    );

    /*
     * The empty list shows its showcase (Components/ResourceShowcase), not
     * the guide. The showcase's button is the list's Add button: it opens
     * the Add dialog, which holds the guide.
     */
    expect(clusters).toContain(
      "<ResourceShowcaseCard showcase={DOCKER_SWARM_CLUSTER_SHOWCASE} addButton={{ title: DOCKER_SWARM_CLUSTER_ONBOARDING.addTitle, onClick: () => { setIsAddClusterOpen(true); }, }}",
    );
    expect(clusters).toContain(
      "{isAddClusterOpen && ( <AddResourceModal onboarding={DOCKER_SWARM_CLUSTER_ONBOARDING}",
    );
    expect(clusters).not.toContain("<AddResourceGuide");
    expect(onboarding).toContain(
      'addTitle: translationKey("Add Docker Swarm Cluster")',
    );
    expect(onboarding).not.toContain("firstRunTitle");

    /*
     * The spec waits for the showcase and its title, clicks its button and
     * reads the guide in the dialog it opens - not the title the empty
     * list's guide had.
     */
    expect(spec).toContain('page.getByTestId("resource-showcase")');
    expect(spec).toContain(`"${DOCKER_SWARM_CLUSTER_SHOWCASE.title}"`);
    expect(spec.split('"resource-showcase-add-button"').length - 1).toBe(2);
    expect(spec.split('name: "Add Docker Swarm Cluster"').length - 1).toBe(2);
    expect(spec).not.toContain("Getting Started with Docker Swarm Monitoring");
  });
});

/*
 * The guide is written by hand from agents/DockerSwarmAgent. Each check
 * below reads the agent's real file, so moving a file, renaming a container
 * or a variable, or changing how the installer behaves fails here instead
 * of leaving the in-app guide wrong.
 */
describe("the guide matches agents/DockerSwarmAgent", () => {
  const installScript: string = readAgentFile("install.sh");
  const troubleshootScript: string = readAgentFile("troubleshoot.sh");
  const readme: string = readAgentFile("README.md");
  const inventoryScript: string = readAgentFile("inventory-snapshot.sh");
  const composeSource: string = readAgentFile("docker-compose.yml");
  const collectorConfig: Record<string, any> = yaml.load(
    readAgentFile("otel-collector-config.yaml"),
  ) as Record<string, any>;
  const scriptMarkdown: string = getSetupGuideMarkdown(
    guideFor("install-script"),
  );
  const composeMarkdown: string = getSetupGuideMarkdown(
    guideFor("docker-compose"),
  );

  test("the installer downloads from where the guide does into the guide's folder", () => {
    // The OneUptime the agent reports to: the guide's URL.
    expect(installScript).toContain(
      `AGENT_FILES_PATH="install/${DOCKER_SWARM_AGENT_INSTALL_NAME}"`,
    );
    expect(getDockerSwarmAgentFileUrl(URL, "docker-compose.yml")).toBe(
      `${SERVED}/docker-compose.yml`,
    );
    expect(installScript).toContain(
      `INSTALL_DIR="\${INSTALL_DIR:-${DOCKER_SWARM_AGENT_INSTALL_DIR}}"`,
    );
    const downloaded: Array<string> = Array.from(
      installScript.matchAll(/^fetch_agent_file (\S+) (\S+)$/gm),
    ).map((match: RegExpMatchArray): string => {
      expect(match[2]).toBe(match[1]);
      return match[1]!;
    });
    expect(downloaded).toEqual(DOCKER_SWARM_AGENT_FILES);
    for (const file of [
      ...DOCKER_SWARM_AGENT_FILES,
      "install.sh",
      "troubleshoot.sh",
    ]) {
      expect(fs.existsSync(path.join(AGENT_DIR, file))).toBe(true);
    }
  });

  test("the installer always prompts, which is why only the URL is pre-filled for it, as the answer Enter takes", () => {
    /*
     * The prompts are unconditional: no `if [ -z "$ONEUPTIME_URL" ]` guard
     * skips them. A URL set before running the script is what Enter takes
     * at the question; without one, Enter takes OneUptime Cloud.
     */
    expect(installScript).toContain(
      `ONEUPTIME_URL_DEFAULT="\${ONEUPTIME_URL:-${DOCKER_SWARM_AGENT_DEFAULT_URL}}"\nprintf "OneUptime URL [%s]: " "\${ONEUPTIME_URL_DEFAULT}"\nread -r ONEUPTIME_URL\nONEUPTIME_URL="\${ONEUPTIME_URL:-\${ONEUPTIME_URL_DEFAULT}}"\n`,
    );
    expect(DOCKER_SWARM_AGENT_DEFAULT_URL).toBe("https://oneuptime.com");
    expect(installScript).toContain(
      'printf "OneUptime Telemetry Ingestion Key: "\nread -r ONEUPTIME_SERVICE_TOKEN\n',
    );
    expect(installScript).not.toMatch(
      /if \[ -z "\$\{?(ONEUPTIME_URL|ONEUPTIME_SERVICE_TOKEN)\}?" \]; then\s+(read|printf)/,
    );
    expect(installScript).toContain(
      `DOCKER_SWARM_CLUSTER_NAME="\${DOCKER_SWARM_CLUSTER_NAME:-${DOCKER_SWARM_EXAMPLE_CLUSTER_NAME}}"`,
    );
  });

  test("on OneUptime Cloud the command names no URL: Enter already takes it", () => {
    expect(
      getDockerSwarmAgentInstallScriptCommand(DOCKER_SWARM_AGENT_DEFAULT_URL),
    ).toBe(
      "curl -fsSL https://oneuptime.com/install/docker-swarm-agent -o install.sh\nsh install.sh",
    );
    // Any other OneUptime is named, so Enter takes it instead.
    expect(getDockerSwarmAgentInstallScriptCommand(URL)).toBe(INSTALL_COMMAND);
  });

  test("the installer has the --no-ai-agent switch the guide mentions", () => {
    expect(installScript).toContain("--no-ai-agent) INSTALL_AI_AGENT=false ;;");
    // A re-run writes ONEUPTIME_AI_ALLOW_WRITES from its own environment.
    expect(installScript).toContain(
      "ONEUPTIME_AI_ALLOW_WRITES=${ONEUPTIME_AI_ALLOW_WRITES}",
    );
    expect(installScript).toContain("cat > .env <<EOF");
  });

  test("the .env lines are the ones the installer writes first, and the compose file reads", () => {
    const envNames: Array<string> = getDockerSwarmEnvFile({
      oneuptimeUrl: URL,
      apiKey: KEY,
      clusterName: DOCKER_SWARM_EXAMPLE_CLUSTER_NAME,
    })
      .split("\n")
      .map((line: string): string => {
        return line.split("=")[0]!;
      });
    expect(envNames).toEqual([
      "ONEUPTIME_URL",
      "ONEUPTIME_SERVICE_TOKEN",
      "DOCKER_SWARM_CLUSTER_NAME",
    ]);
    const written: string = installScript.match(
      /cat > \.env <<EOF\n([\s\S]*?)\nEOF/,
    )![1]!;
    expect(
      written
        .split("\n")
        .slice(0, 3)
        .map((line: string): string => {
          return line.split("=")[0]!;
        }),
    ).toEqual(envNames);
    for (const name of envNames) {
      expect(composeSource).toContain(`\${${name}`);
    }
  });

  test("the container names are the compose file's", () => {
    expect(Object.keys(repoCompose)).toEqual([
      DOCKER_SWARM_COLLECTOR_CONTAINER_NAME,
      DOCKER_SWARM_INVENTORY_CONTAINER_NAME,
      DOCKER_SWARM_AI_AGENT_CONTAINER_NAME,
    ]);
    for (const [name, service] of Object.entries(repoCompose)) {
      expect(service["container_name"]).toBe(name);
    }
    expect(troubleshootScript).toContain(
      `AGENT_CONTAINER="${DOCKER_SWARM_COLLECTOR_CONTAINER_NAME}"`,
    );
    expect(troubleshootScript).toContain(
      `INVENTORY_CONTAINER="${DOCKER_SWARM_INVENTORY_CONTAINER_NAME}"`,
    );
  });

  test("the environment variable table lists the collector's and the poller's settings", () => {
    const table: string = topicTitled(
      guideFor("docker-compose").advanced,
      "Environment variables",
    ).markdown;
    const names: Array<string> = Array.from(
      table.matchAll(/^\| `([A-Z_]+)` \|/gm),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });
    const settings: Set<string> = new Set<string>([
      ...envNamesOf(repoCompose[DOCKER_SWARM_COLLECTOR_CONTAINER_NAME]!),
      ...envNamesOf(repoCompose[DOCKER_SWARM_INVENTORY_CONTAINER_NAME]!),
    ]);
    // Pinned with the collector image, not a setting.
    settings.delete("APP_VERSION");
    expect([...names].sort()).toEqual([...settings].sort());
  });

  test("the defaults the guide quotes are the compose file's", () => {
    const collectorEnv: Array<string> = repoCompose[
      DOCKER_SWARM_COLLECTOR_CONTAINER_NAME
    ]!["environment"] as Array<string>;
    const inventoryEnv: Array<string> = repoCompose[
      DOCKER_SWARM_INVENTORY_CONTAINER_NAME
    ]!["environment"] as Array<string>;
    expect(collectorEnv).toContain(
      `DOCKER_SWARM_CLUSTER_NAME=\${DOCKER_SWARM_CLUSTER_NAME:-${DOCKER_SWARM_DEFAULT_CLUSTER_NAME}}`,
    );
    // Empty: the collector negotiates the version with the daemon.
    expect(DOCKER_SWARM_DEFAULT_API_VERSION).toBe("");
    expect(collectorEnv).toContain(
      `DOCKER_API_VERSION=\${DOCKER_API_VERSION:-${DOCKER_SWARM_DEFAULT_API_VERSION}}`,
    );
    expect(collectorEnv).toContain(
      "DOCKER_SWARM_NODE_NAME=${DOCKER_SWARM_NODE_NAME:-}",
    );
    expect(inventoryEnv).toContain(
      `DOCKER_INVENTORY_INTERVAL_SECONDS=\${DOCKER_INVENTORY_INTERVAL_SECONDS:-${DOCKER_SWARM_DEFAULT_INVENTORY_INTERVAL_SECONDS}}`,
    );
  });

  test("the collector stamps the cluster name, and each task's service and node, as the guide describes", () => {
    const attributes: Array<Record<string, string>> =
      collectorConfig["processors"]["resource"]["attributes"];
    const keys: Array<string> = attributes.map(
      (attribute: Record<string, string>): string => {
        return attribute["key"]!;
      },
    );
    expect(keys).toContain("docker.swarm.cluster.name");
    expect(keys).not.toContain("host.name");
    expect(keys).not.toContain("container.runtime");

    const labels: Record<string, string> =
      collectorConfig["receivers"]["docker_stats"][
        "container_labels_to_metric_labels"
      ];
    const collects: string = topicTitled(
      guideFor("install-script").advanced,
      "What the agent collects",
    ).markdown;
    for (const attribute of [
      ...Object.values(labels),
      "docker.swarm.node.name",
      "docker.swarm.cluster.name",
    ]) {
      expect(collects).toContain(`\`${attribute}\``);
    }
    // The receiver's container.runtime, which the guide used to deny.
    expect(collects).toContain("`container.runtime=docker`");
    expect(collects).not.toContain("stamps **only**");
    expect(
      attributes.find((attribute: Record<string, string>): boolean => {
        return attribute["key"] === "docker.swarm.cluster.name";
      })!["value"],
    ).toBe("${env:DOCKER_SWARM_CLUSTER_NAME}");
  });

  test("how-it-works describes the images and API calls the agent really uses", () => {
    const howItWorks: string = topicTitled(
      guideFor("install-script").advanced,
      "How the agent works",
    ).markdown;
    expect(
      String(repoCompose[DOCKER_SWARM_COLLECTOR_CONTAINER_NAME]!["image"]),
    ).toMatch(/^otel\/opentelemetry-collector-contrib:/);
    expect(
      String(repoCompose[DOCKER_SWARM_INVENTORY_CONTAINER_NAME]!["image"]),
    ).toMatch(/^alpine:/);
    expect(composeSource).toContain("apk add --no-cache curl jq");
    const endpoints: Array<string> = Array.from(
      howItWorks.matchAll(/`(\/[a-z]+)`/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });
    expect(endpoints).toEqual([
      "/nodes",
      "/services",
      "/tasks",
      "/networks",
      "/secrets",
      "/configs",
      "/volumes",
    ]);
    for (const endpoint of endpoints) {
      expect(inventoryScript).toMatch(
        new RegExp(`fetch "${endpoint}(\\?[^"]*)?"`),
      );
    }
    expect(howItWorks).toContain("com.docker.stack.namespace");
    expect(inventoryScript).toContain("com.docker.stack.namespace");
    // The poller calls the API over the socket; it runs no docker CLI.
    expect(howItWorks).not.toMatch(/docker (node|service|task)\//);
    expect(inventoryScript).toContain("--unix-socket");
  });

  test("the stack placement block is the one the compose file carries", () => {
    expect(composeSource).toContain(
      "#   deploy:\n    #     placement:\n    #       constraints: [node.role == manager]",
    );
    expect(scriptMarkdown).toContain(
      "    deploy:\n      placement:\n        constraints: [node.role == manager]",
    );
  });

  test("every AI agent setting the guide names is one the agent reads", () => {
    const aiEnv: Array<string> = envNamesOf(
      repoCompose[DOCKER_SWARM_AI_AGENT_CONTAINER_NAME]!,
    );
    for (const markdown of [scriptMarkdown, composeMarkdown]) {
      for (const match of markdown.matchAll(/ONEUPTIME_AI_[A-Z_]+/g)) {
        expect(aiEnv).toContain(match[0]);
      }
    }
  });

  test("the diagnostic script takes the folder flag the guide uses", () => {
    expect(troubleshootScript).toContain("-d|--dir)");
    expect(troubleshootScript).toContain(
      `DIR="${DOCKER_SWARM_AGENT_INSTALL_DIR}"`,
    );
    expect(troubleshootScript).toContain("/otlp/v1/validate");
  });

  test("the troubleshooting facts are the README's and the product's", () => {
    expect(readme).toContain(
      'Error: cannot start pipelines: failed to start "docker_stats" receiver:\nError response from daemon: client version 1.44 is too new.\nMaximum supported API version is 1.41',
    );
    expect(readme).toContain(
      "docker version --format '{{ .Server.APIVersion }}'",
    );
    expect(readme).toContain("`failed to emit ...`");
    expect(inventoryScript).toContain("failed to emit");
    // "marked disconnected after 15 minutes without telemetry".
    const service: string = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "packages/Common/Server/Services/DockerSwarmClusterService.ts",
      ),
      "utf8",
    );
    // 15 minutes of time OneUptime was receiving (issue #2825).
    expect(service).toMatch(SWARM_DISCONNECT_AFTER_15_MINUTES);
    for (const markdown of [scriptMarkdown, composeMarkdown]) {
      expect(markdown).toContain("marked disconnected after 15 minutes");
    }
  });
});
