import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import {
  DEFAULT_DOCKER_INSTALL_METHOD,
  DOCKER_AGENT_CONTAINER_NAME,
  DOCKER_AGENT_IMAGE,
  DOCKER_AI_AGENT_CONTAINER_NAME,
  DOCKER_AI_AGENT_IMAGE,
  DOCKER_DEFAULT_API_VERSION,
  DOCKER_DEFAULT_HOST_NAME,
  DOCKER_EXAMPLE_HOST_NAME,
  DOCKER_INSTALL_METHODS,
  DockerInstallMethod,
  DOCKER_AI_AGENT_TOPIC_TITLE,
  getDockerAiAgentComposeService,
  getDockerAiAgentRunCommand,
  getDockerComposeFile,
  getDockerRunCommand,
  getDockerSetupGuide,
  resolveDockerInstallMethod,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/Utils/DocumentationMarkdown";
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
 * The Docker agent guide asks how the agent is run — one `docker run`
 * command or Docker Compose — and shows only that way's steps. These tests
 * pin, for both ways:
 *
 *   - the reader's URL and key in every command and file that needs them;
 *   - only the chosen way's commands on screen;
 *   - the OneUptime AI agent started with the collector — AI investigations
 *     are on by default, as with agents/DockerAgent's own install.sh and
 *     docker-compose.yml — with how to install without it;
 *   - configuration, fixes, upgrades and the log driver folded under
 *     Advanced, known problems under Troubleshooting;
 *   - that every image, container name, mount and variable the guide uses
 *     is the one agents/DockerAgent really ships — the guide is copied by
 *     hand from those files, so it drifts unless something checks it.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const AGENT_DIR: string = path.join(REPO_ROOT, "agents", "DockerAgent");
const DOCS_DIR: string = path.join(
  REPO_ROOT,
  "packages/App/FeatureSet/Docs/Content/en",
);

const URL: string = "https://oneuptime.example.com";
const KEY: string = "tik_secret_123";

const METHODS: Array<DockerInstallMethod> = DOCKER_INSTALL_METHODS.map(
  (option: SetupGuideOption<DockerInstallMethod>): DockerInstallMethod => {
    return option.key;
  },
);

const readAgentFile: (name: string) => string = (name: string): string => {
  return fs.readFileSync(path.join(AGENT_DIR, name), "utf8");
};

const guideFor: (
  method: DockerInstallMethod,
  overrides?: { apiKey?: string; hostName?: string },
) => SetupGuideContent = (
  method: DockerInstallMethod,
  overrides?: { apiKey?: string; hostName?: string },
): SetupGuideContent => {
  return getDockerSetupGuide({
    oneuptimeUrl: URL,
    apiKey: overrides?.apiKey ?? KEY,
    method: method,
    hostName: overrides?.hostName,
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

// Every line of every code block, trimmed — what a reader can run.
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

// The code block that starts the given container with `docker run`.
const runCommandFor: (markdown: string, containerName: string) => string = (
  markdown: string,
  containerName: string,
): string => {
  const block: RegExpMatchArray | undefined = Array.from(
    markdown.matchAll(/```bash\n(docker run -d[\s\S]*?)```/g),
  ).find((match: RegExpMatchArray): boolean => {
    return (match[1] || "").includes(`--name ${containerName} `);
  });
  if (!block) {
    throw new Error(`No docker run command for ${containerName}`);
  }
  return block[1]!.trim();
};

interface RunFlags {
  name: string | undefined;
  volumes: Array<string>;
  envNames: Array<string>;
  flags: Array<string>;
  image: string;
}

// The flags of a `docker run` command, however its lines are wrapped.
const parseRunCommand: (command: string) => RunFlags = (
  command: string,
): RunFlags => {
  const words: Array<string> = command
    .replace(/\\\n/g, " ")
    .split(/\s+/)
    .filter((word: string): boolean => {
      return word.length > 0;
    });
  const result: RunFlags = {
    name: undefined,
    volumes: [],
    envNames: [],
    flags: [],
    image: words[words.length - 1]!.replace(/"/g, ""),
  };
  for (let index: number = 0; index < words.length; index++) {
    const word: string = words[index]!;
    const next: string = (words[index + 1] || "").replace(/"/g, "");
    if (word === "--name") {
      result.name = next;
    } else if (word === "-v") {
      result.volumes.push(next);
    } else if (word === "-e") {
      result.envNames.push(next.split("=")[0]!);
    } else if (word.startsWith("--")) {
      result.flags.push(word);
    }
  }
  return result;
};

type ComposeService = Record<string, unknown>;

const composeServices: (source: string) => Record<string, ComposeService> = (
  source: string,
): Record<string, ComposeService> => {
  const parsed: { services: Record<string, ComposeService> } = yaml.load(
    source,
  ) as { services: Record<string, ComposeService> };
  return parsed.services;
};

const envNamesOf: (service: ComposeService) => Array<string> = (
  service: ComposeService,
): Array<string> => {
  return (service["environment"] as Array<string>).map(
    (entry: string): string => {
      return entry.split("=")[0]!;
    },
  );
};

const repoCompose: Record<string, ComposeService> = composeServices(
  readAgentFile("docker-compose.yml"),
);
const repoCollector: ComposeService = repoCompose[DOCKER_AGENT_CONTAINER_NAME]!;
const repoAiAgent: ComposeService =
  repoCompose[DOCKER_AI_AGENT_CONTAINER_NAME]!;

describe("the install method picker", () => {
  test("offers the Docker CLI first, then Docker Compose", () => {
    expect(METHODS).toEqual(["docker-cli", "docker-compose"]);
    expect(DEFAULT_DOCKER_INSTALL_METHOD).toBe("docker-cli");
    expect(
      DOCKER_INSTALL_METHODS.map(
        (option: SetupGuideOption<DockerInstallMethod>): string => {
          return option.label;
        },
      ),
    ).toEqual(["Docker CLI", "Docker Compose"]);
  });

  test("every method has a plain one-line description and no badge", () => {
    for (const option of DOCKER_INSTALL_METHODS) {
      expect((option.description || "").length).toBeGreaterThan(0);
      expect(option.description).not.toContain("\n");
      // Rendered as plain text in the picker.
      expect(option.description).not.toMatch(/[`*[\]]/);
      expect(option.badge).toBeUndefined();
    }
  });

  test("only the Compose option's name mentions Compose", () => {
    // A radio is named by its label and description together.
    const named: Array<string> = DOCKER_INSTALL_METHODS.filter(
      (option: SetupGuideOption<DockerInstallMethod>): boolean => {
        return `${option.label} ${option.description}`
          .toLowerCase()
          .includes("compose");
      },
    ).map((option: SetupGuideOption<DockerInstallMethod>): string => {
      return option.key;
    });
    expect(named).toEqual(["docker-compose"]);
  });

  test("an unknown or missing method resolves to the Docker CLI", () => {
    for (const value of [undefined, null, "", "podman", "Docker-Compose"]) {
      expect(resolveDockerInstallMethod(value)).toBe("docker-cli");
    }
    expect(resolveDockerInstallMethod("docker-compose")).toBe("docker-compose");
  });
});

describe.each(METHODS)("the %s guide", (method: DockerInstallMethod) => {
  const guide: SetupGuideContent = guideFor(method);
  const markdown: string = getSetupGuideMarkdown(guide);
  const isCli: boolean = method === "docker-cli";

  test("is a short list of steps after the key, ending with a check", () => {
    expect(titles(guide.steps)).toEqual(
      isCli
        ? ["Run the agent", "Verify the agent is running"]
        : [
            "Create docker-compose.yml",
            "Start the agent",
            "Verify the agent is running",
          ],
    );
  });

  test("every step has a one-sentence plain description", () => {
    for (const step of guide.steps) {
      expect(step.description).toBeTruthy();
      expect(step.description).not.toContain("\n");
      // Step descriptions render as plain text.
      expect(step.description).not.toMatch(/[`*[\]]/);
    }
  });

  test("every URL and key in the guide is the reader's", () => {
    const lines: Array<string> = codeLines(guide);
    const urlLines: Array<string> = lines.filter((line: string): boolean => {
      return line.includes("ONEUPTIME_URL=");
    });
    const keyLines: Array<string> = lines.filter((line: string): boolean => {
      return line.includes("ONEUPTIME_SERVICE_TOKEN=");
    });
    expect(urlLines.length).toBeGreaterThan(0);
    expect(keyLines.length).toBeGreaterThan(0);
    for (const line of urlLines) {
      expect(line).toMatch(
        new RegExp(`ONEUPTIME_URL="?${URL.replace(/\./g, "\\.")}"?( \\\\)?$`),
      );
    }
    for (const line of keyLines) {
      expect(line).toMatch(
        new RegExp(`ONEUPTIME_SERVICE_TOKEN="?${KEY}"?( \\\\)?$`),
      );
    }
    expect(markdown).not.toContain(SETUP_GUIDE_API_KEY_PLACEHOLDER);
  });

  test("the install step starts the agent with the reader's URL and key", () => {
    const install: string = guide.steps[0]!.markdown || "";
    if (isCli) {
      expect(install).toContain(
        getDockerRunCommand({
          oneuptimeUrl: URL,
          apiKey: KEY,
          hostName: DOCKER_EXAMPLE_HOST_NAME,
        }),
      );
      expect(install).toContain(`-e ONEUPTIME_URL="${URL}"`);
      expect(install).toContain(`-e ONEUPTIME_SERVICE_TOKEN="${KEY}"`);
    } else {
      expect(install).toContain(
        getDockerComposeFile({
          oneuptimeUrl: URL,
          apiKey: KEY,
          hostName: DOCKER_EXAMPLE_HOST_NAME,
        }),
      );
      expect(install).toContain(`- ONEUPTIME_URL=${URL}`);
      expect(install).toContain(`- ONEUPTIME_SERVICE_TOKEN=${KEY}`);
      expect(guide.steps[1]!.markdown).toContain("docker compose up -d");
    }
  });

  test("shows only this method's commands", () => {
    const lines: Array<string> = codeLines(guide);
    if (isCli) {
      expect(markdown).toContain(`--name ${DOCKER_AGENT_CONTAINER_NAME}`);
      expect(markdown).not.toContain(`  ${DOCKER_AGENT_CONTAINER_NAME}:\n`);
      expect(markdown).not.toContain('user: "0:0"');
      expect(lines).not.toContain("docker compose up -d");
      expect(markdown).not.toContain("docker compose pull");
      expect(markdown).not.toContain("docker compose down");
      expect(markdown).not.toContain("environment:` list");
    } else {
      expect(markdown).toContain(`  ${DOCKER_AGENT_CONTAINER_NAME}:\n`);
      expect(markdown).not.toContain(`--name ${DOCKER_AGENT_CONTAINER_NAME}`);
      expect(markdown).not.toContain("--user 0:0");
      expect(markdown).not.toContain(
        `docker rm -f ${DOCKER_AGENT_CONTAINER_NAME}`,
      );
      expect(markdown).not.toContain(`docker pull ${DOCKER_AGENT_IMAGE}`);
      expect(markdown).not.toContain("-e DOCKER_API_VERSION");
      expect(markdown).not.toContain("-e ONEUPTIME_AI_ALLOW_WRITES");
    }
  });

  test("keeps configuration and optional extras out of the first-run steps", () => {
    const steps: string = stepsText(guide);
    for (const advanced of [
      "DOCKER_API_VERSION",
      // Fixes are opt-in: their switches stay under Advanced.
      "ONEUPTIME_AI_ALLOW_WRITES",
      "ONEUPTIME_AI_WRITE_TARGETS",
      "ONEUPTIME_AI_PROTECTED_TARGETS",
      "daemon.json",
      "docker pull",
      "docker rm",
      "docker compose pull",
      "docker compose down",
      "enterprise-release",
    ]) {
      expect(steps).not.toContain(advanced);
    }
  });

  test("the verify step checks the container and the collector's ready line", () => {
    const verify: string = guide.steps[guide.steps.length - 1]!.markdown || "";
    expect(verify).toContain(
      `docker ps --filter name=${DOCKER_AGENT_CONTAINER_NAME}`,
    );
    expect(verify).toContain(`docker logs -f ${DOCKER_AGENT_CONTAINER_NAME}`);
    expect(verify).toContain(
      "```output\nEverything is ready. Begin running and processing data.\n```",
    );
    expect(verify).toContain("appears automatically in the **Docker** section");
  });

  test("lists the prerequisites a first install needs", () => {
    const prerequisites: Array<string> = guide.prerequisites || [];
    expect(prerequisites.length).toBeGreaterThanOrEqual(2);
    expect(prerequisites.length).toBeLessThanOrEqual(4);
    expect(prerequisites).toContain("Docker Engine 20.10+");
    expect(prerequisites.join("\n")).toContain("/var/run/docker.sock");
    expect(prerequisites.join("\n")).toContain("`json-file` log driver");
    expect(prerequisites.join("\n").includes("Docker Compose v2")).toBe(!isCli);
  });

  test("has Advanced topics for settings, logs, the AI agent, images, upgrades and data", () => {
    expect(titles(guide.advanced)).toEqual([
      "Environment variables",
      "Collect logs from every container (json-file log driver)",
      DOCKER_AI_AGENT_TOPIC_TITLE,
      "Pin the image version",
      "Upgrade or uninstall the agent",
      "What the agent collects",
    ]);
  });

  test("every Advanced topic has a plain one-line summary", () => {
    for (const topic of guide.advanced || []) {
      expect(topic.summary).toBeTruthy();
      // Summaries render as plain text, so no markdown.
      expect(topic.summary).not.toMatch(/[`*[\]]/);
      expect(topic.summary).not.toContain("\n");
    }
  });

  test("Troubleshooting is titled by symptom", () => {
    expect(titles(guide.troubleshooting)).toEqual([
      "Docker socket permission denied",
      'Agent restarts with "client version is too new"',
      'Host shows as "Disconnected"',
      "No metrics appearing",
      "No container logs",
      "Logs are ingested but missing from the host's page",
      `Host shows up as "${DOCKER_DEFAULT_HOST_NAME}" or a container ID`,
    ]);
  });

  test("every reference to an Advanced topic names one that exists", () => {
    const references: Array<string> = Array.from(
      markdown.matchAll(/see \*\*([^*]+)\*\* under Advanced/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });
    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) {
      expect(titles(guide.advanced)).toContain(reference);
    }
  });

  test("links to the Docker agent and monitor docs, which exist", () => {
    expect(guide.links).toEqual([
      {
        title: "Docker agent documentation",
        url: "/docs/telemetry/docker-host",
      },
      { title: "Docker monitors", url: "/docs/monitor/docker-monitor" },
    ]);
  });

  test("every docs link in the guide points at a page that exists", () => {
    const links: Array<string> = Array.from(
      markdown.matchAll(/\]\((\/docs\/[^)#\s]+)(?:#[^)\s]*)?\)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });
    for (const link of guide.links || []) {
      links.push(link.url);
    }
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

  test("never runs a command inside the agent, whose image has no shell", () => {
    /*
     * The agent is the scratch-based otel/opentelemetry-collector-contrib
     * image plus a config file: `docker exec oneuptime-docker-agent ls` fails
     * with "executable file not found". Checks inside it run in a throwaway
     * container that borrows its mounts instead.
     */
    expect(markdown).not.toContain("docker exec");
    expect(markdown).toContain(
      `docker run --rm --volumes-from ${DOCKER_AGENT_CONTAINER_NAME} alpine:3.19`,
    );
  });

  test("greps the agent's logs with stderr included", () => {
    // The collector logs to stderr; without 2>&1 a grep sees nothing.
    const greps: Array<string> = codeLines(guide)
      .concat(
        Array.from(markdown.matchAll(/`(docker logs [^`]*)`/g)).map(
          (match: RegExpMatchArray): string => {
            return match[1]!;
          },
        ),
      )
      .filter((line: string): boolean => {
        return line.startsWith("docker logs ") && line.includes("| grep");
      });
    expect(greps.length).toBeGreaterThan(0);
    for (const line of greps) {
      expect(line).toContain(" 2>&1 | grep");
    }
  });

  /*
   * AI investigations are on by default, as with agents/DockerAgent's own
   * install.sh and docker-compose.yml: the install step starts the AI agent
   * beside the collector, with the same URL, key and host name.
   */
  test("the install step starts the AI agent beside the collector, the way this method runs things", () => {
    const install: string = guide.steps[0]!.markdown || "";
    const values: { oneuptimeUrl: string; apiKey: string; hostName: string } = {
      oneuptimeUrl: URL,
      apiKey: KEY,
      hostName: DOCKER_EXAMPLE_HOST_NAME,
    };

    expect(install).toContain(DOCKER_AI_AGENT_IMAGE);
    expect(install).toContain("ONEUPTIME_AI_AGENT_RESOURCE_TYPE=docker");
    if (isCli) {
      const collector: number = install.indexOf(getDockerRunCommand(values));
      const aiAgent: number = install.indexOf(
        getDockerAiAgentRunCommand(values),
      );
      expect(collector).toBeGreaterThan(-1);
      // After the collector, in a code block of its own.
      expect(aiAgent).toBeGreaterThan(collector);
      expect(install).toContain(
        `\`\`\`bash\n${getDockerAiAgentRunCommand(values)}\n\`\`\``,
      );
      expect(install).toContain(`--name ${DOCKER_AI_AGENT_CONTAINER_NAME}`);
      expect(getDockerAiAgentRunCommand(values)).toContain(
        `-e DOCKER_HOST_NAME="${DOCKER_EXAMPLE_HOST_NAME}"`,
      );
    } else {
      const services: Record<string, ComposeService> = composeServices(
        getDockerComposeFile(values),
      );
      expect(Object.keys(services)).toEqual([
        DOCKER_AGENT_CONTAINER_NAME,
        DOCKER_AI_AGENT_CONTAINER_NAME,
      ]);
      expect(
        services[DOCKER_AI_AGENT_CONTAINER_NAME]!["environment"],
      ).toContain(`DOCKER_HOST_NAME=${DOCKER_EXAMPLE_HOST_NAME}`);
      expect(install).toContain(getDockerAiAgentComposeService(values));
      // `docker compose up -d` in the next step starts both.
      expect(guide.steps[1]!.markdown).toContain("docker compose up -d");
    }
  });

  test("the install step says AI investigations are on by default, and how to install without them", () => {
    const install: string = guide.steps[0]!.markdown || "";
    expect(install).toContain("**AI investigations are on by default**");
    expect(install).toContain("read-only `docker` commands");
    expect(install).toContain("changes nothing unless you allow fixes");
    expect(install).toContain(
      `see **${DOCKER_AI_AGENT_TOPIC_TITLE}** under Advanced`,
    );
    expect(install).toContain(
      isCli
        ? "Skip this command to run the collector without AI investigations."
        : `Delete the \`${DOCKER_AI_AGENT_CONTAINER_NAME}\` service to run the collector without AI investigations.`,
    );
  });

  test("the AI agent topic says how to allow fixes and how to leave it out, the way this method runs things", () => {
    expect(DOCKER_AI_AGENT_TOPIC_TITLE).toBe("The OneUptime AI agent");
    const topic: SetupGuideTopic = topicTitled(
      guide.advanced,
      DOCKER_AI_AGENT_TOPIC_TITLE,
    );
    expect(topic.summary).toContain("On by default");
    expect(topic.markdown).toContain(`\`${DOCKER_AI_AGENT_CONTAINER_NAME}\``);
    expect(topic.markdown).toContain("**AI investigations are on by default**");
    expect(topic.markdown).toContain("**AI → AI agent**");
    expect(topic.markdown).toContain("**What AI may do**");
    expect(topic.markdown).toContain("**Overview**");
    if (isCli) {
      expect(topic.markdown).toContain("-e ONEUPTIME_AI_ALLOW_WRITES=true");
      expect(topic.markdown).toContain(
        `\`docker rm -f ${DOCKER_AI_AGENT_CONTAINER_NAME}\``,
      );
    } else {
      expect(topic.markdown).toContain("- ONEUPTIME_AI_ALLOW_WRITES=true");
      expect(topic.markdown).toContain(
        "`docker compose up -d --remove-orphans`",
      );
    }
  });

  test("the verify step says where the AI agent shows up", () => {
    const verify: string = guide.steps[guide.steps.length - 1]!.markdown || "";
    expect(verify).toContain("**AI → AI agent**");
    expect(verify).toContain("**Overview**");
  });

  test("upgrades and uninstalls the way this method installed", () => {
    const topic: string = topicTitled(
      guide.advanced,
      "Upgrade or uninstall the agent",
    ).markdown;
    if (isCli) {
      expect(topic).toContain(
        `docker pull ${DOCKER_AGENT_IMAGE}\ndocker rm -f ${DOCKER_AGENT_CONTAINER_NAME}`,
      );
      // The AI agent is part of the install, so it upgrades with it.
      expect(topic).toContain(
        `docker pull ${DOCKER_AI_AGENT_IMAGE}\ndocker rm -f ${DOCKER_AI_AGENT_CONTAINER_NAME}`,
      );
      expect(topic).toContain("run both `docker run` commands from step 2");
      expect(topic).toContain(`docker rm -f ${DOCKER_AI_AGENT_CONTAINER_NAME}`);
    } else {
      expect(topic).toContain("docker compose pull\ndocker compose up -d");
      expect(topic).toContain("docker compose down");
    }
  });

  test("the API version fix sets the variable where this method keeps it", () => {
    const topic: string = topicTitled(
      guide.troubleshooting,
      'Agent restarts with "client version is too new"',
    ).markdown;
    expect(topic).toContain(
      "docker version --format '{{ .Server.APIVersion }}'",
    );
    expect(topic).toContain(
      isCli ? "-e DOCKER_API_VERSION=1.41" : "- DOCKER_API_VERSION=1.41",
    );
    expect(topic).toContain(
      isCli ? "`-e DOCKER_API_VERSION=`" : "`- DOCKER_API_VERSION=`",
    );
  });
});

describe("the host name", () => {
  test("a product page suggests a name and says to replace it", () => {
    for (const method of METHODS) {
      const guide: SetupGuideContent = guideFor(method);
      const install: string = guide.steps[0]!.markdown || "";
      expect(install).toContain(
        `Replace \`${DOCKER_EXAMPLE_HOST_NAME}\` with a name for this host`,
      );
      expect(install).toContain("a new name registers a new host");
      expect(install).toContain(
        method === "docker-cli"
          ? `-e DOCKER_HOST_NAME="${DOCKER_EXAMPLE_HOST_NAME}"`
          : `- DOCKER_HOST_NAME=${DOCKER_EXAMPLE_HOST_NAME}`,
      );
    }
  });

  test("a host's own tab installs for that host everywhere", () => {
    for (const method of METHODS) {
      const guide: SetupGuideContent = guideFor(method, {
        hostName: "prod-docker-01",
      });
      const markdown: string = getSetupGuideMarkdown(guide);
      const install: string = guide.steps[0]!.markdown || "";
      expect(install).toContain(
        "This installs the agent for **`prod-docker-01`**",
      );
      expect(install).not.toContain("Replace `");
      expect(markdown).not.toContain(DOCKER_EXAMPLE_HOST_NAME);
      // The collector and the AI agent report the same host.
      const hostLines: Array<string> = codeLines(guide).filter(
        (line: string): boolean => {
          return line.includes("DOCKER_HOST_NAME=") && !line.includes("grep");
        },
      );
      expect(hostLines).toHaveLength(2);
      for (const line of hostLines) {
        expect(line).toMatch(/DOCKER_HOST_NAME="?prod-docker-01"?( \\)?$/);
      }
    }
  });

  test("a blank name, or one that is not a plain word, counts as unknown", () => {
    for (const hostName of ["  ", "web host", "web$(id)", 'a"b']) {
      const install: string =
        guideFor("docker-cli", { hostName: hostName }).steps[0]!.markdown || "";
      expect(install).toContain(
        `-e DOCKER_HOST_NAME="${DOCKER_EXAMPLE_HOST_NAME}"`,
      );
      expect(install).toContain(`Replace \`${DOCKER_EXAMPLE_HOST_NAME}\``);
    }
  });
});

describe("before a key is picked", () => {
  test.each(METHODS)(
    "the %s install step shows the placeholder and says where to pick a key",
    (method: DockerInstallMethod) => {
      const guide: SetupGuideContent = guideFor(method, {
        apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
      });
      const install: string = guide.steps[0]!.markdown || "";
      expect(install).toContain(SETUP_GUIDE_API_KEY_PLACEHOLDER);
      expect(install).toContain(
        `Pick an ingestion key in step 1 to fill in \`${SETUP_GUIDE_API_KEY_PLACEHOLDER}\`.`,
      );
    },
  );

  test("the note goes away once a key is picked", () => {
    for (const method of METHODS) {
      expect(getSetupGuideMarkdown(guideFor(method))).not.toContain(
        "Pick an ingestion key in step 1",
      );
    }
  });

  test("no install script is involved, so nothing can store the placeholder", () => {
    for (const method of METHODS) {
      const markdown: string = getSetupGuideMarkdown(
        guideFor(method, { apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER }),
      );
      expect(markdown).not.toContain("install.sh");
    }
  });
});

/*
 * The guide is written by hand from agents/DockerAgent. Each check below
 * reads the agent's real file, so renaming an image, a container, a mount
 * or a variable there fails here instead of leaving the in-app guide wrong.
 */
describe("the guide matches agents/DockerAgent", () => {
  const cliMarkdown: string = getSetupGuideMarkdown(guideFor("docker-cli"));
  const composeMarkdown: string = getSetupGuideMarkdown(
    guideFor("docker-compose"),
  );
  const installScript: string = readAgentFile("install.sh");
  const readme: string = readAgentFile("README.md");
  const dockerfile: string = readAgentFile("Dockerfile.tpl");
  const collectorConfig: Record<string, any> = yaml.load(
    readAgentFile("otel-collector-config.yaml"),
  ) as Record<string, any>;

  // The collector's `docker run` in install.sh, up to its image.
  const installRun: RunFlags = parseRunCommand(
    installScript
      .match(
        /docker run -d \\\n\s+--name oneuptime-docker-agent[\s\S]*?"\$IMAGE"/,
      )![0]
      .replace(/"\$IMAGE"/, "$IMAGE"),
  );

  test("the images and container names are the agent's", () => {
    expect(repoCollector["image"]).toBe(DOCKER_AGENT_IMAGE);
    expect(repoCollector["container_name"]).toBe(DOCKER_AGENT_CONTAINER_NAME);
    expect(repoAiAgent["image"]).toBe(DOCKER_AI_AGENT_IMAGE);
    expect(repoAiAgent["container_name"]).toBe(DOCKER_AI_AGENT_CONTAINER_NAME);
    expect(installScript).toContain(
      `IMAGE="\${ONEUPTIME_DOCKER_AGENT_IMAGE:-${DOCKER_AGENT_IMAGE}}"`,
    );
    expect(installScript).toContain(
      `AI_IMAGE="\${ONEUPTIME_AI_AGENT_IMAGE:-${DOCKER_AI_AGENT_IMAGE}}"`,
    );
    expect(installRun.name).toBe(DOCKER_AGENT_CONTAINER_NAME);
  });

  test("the docker run command mounts and sets what the agent's installer does", () => {
    const guideRun: RunFlags = parseRunCommand(
      runCommandFor(cliMarkdown, DOCKER_AGENT_CONTAINER_NAME),
    );
    expect(guideRun.name).toBe(DOCKER_AGENT_CONTAINER_NAME);
    expect(guideRun.image).toBe(DOCKER_AGENT_IMAGE);
    expect(guideRun.volumes).toEqual(installRun.volumes);
    expect(guideRun.volumes).toEqual(repoCollector["volumes"]);
    expect(guideRun.envNames).toEqual(installRun.envNames);
    expect(guideRun.flags).toEqual(
      expect.arrayContaining(["--user", "--restart"]),
    );
    expect(runCommandFor(cliMarkdown, DOCKER_AGENT_CONTAINER_NAME)).toContain(
      "--user 0:0",
    );
  });

  test("the docker run command matches the README's quick start", () => {
    const quickStart: string = readme.match(
      /## Quick Start — `docker run`\n\n```bash\n([\s\S]*?)```/,
    )![1]!;
    const readmeRun: RunFlags = parseRunCommand(quickStart);
    const guideRun: RunFlags = parseRunCommand(
      runCommandFor(cliMarkdown, DOCKER_AGENT_CONTAINER_NAME),
    );
    expect(guideRun).toEqual(readmeRun);
  });

  test("the compose file is the agent's collector service, with the reader's values", () => {
    const composeBlock: string = composeMarkdown.match(
      /```yaml\n(services:\n {2}oneuptime-docker-agent:[\s\S]*?)```/,
    )![1]!;
    const service: ComposeService =
      composeServices(composeBlock)[DOCKER_AGENT_CONTAINER_NAME]!;

    for (const key of [
      "image",
      "container_name",
      "user",
      "restart",
      "volumes",
      "logging",
    ]) {
      expect({ key: key, value: service[key] }).toEqual({
        key: key,
        value: repoCollector[key],
      });
    }

    const repoEnv: Array<string> = envNamesOf(repoCollector);
    for (const name of envNamesOf(service)) {
      expect(repoEnv).toContain(name);
    }
    expect(service["environment"]).toEqual([
      `ONEUPTIME_URL=${URL}`,
      `ONEUPTIME_SERVICE_TOKEN=${KEY}`,
      `DOCKER_HOST_NAME=${DOCKER_EXAMPLE_HOST_NAME}`,
    ]);
  });

  test("the environment variable table lists exactly the collector's variables", () => {
    const table: string = topicTitled(
      guideFor("docker-cli").advanced,
      "Environment variables",
    ).markdown;
    const names: Array<string> = Array.from(
      table.matchAll(/^\| `([A-Z_]+)` \|/gm),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });
    expect(names).toEqual(envNamesOf(repoCollector));
  });

  test("the defaults the guide quotes are the image's and the compose file's", () => {
    expect(dockerfile).toContain(
      `ENV DOCKER_HOST_NAME=${DOCKER_DEFAULT_HOST_NAME}`,
    );
    expect(dockerfile).toContain(
      `ENV DOCKER_API_VERSION=${DOCKER_DEFAULT_API_VERSION}`,
    );
    expect(repoCollector["environment"]).toContain(
      `DOCKER_HOST_NAME=\${DOCKER_HOST_NAME:-${DOCKER_DEFAULT_HOST_NAME}}`,
    );
    expect(repoCollector["environment"]).toContain(
      `DOCKER_API_VERSION=\${DOCKER_API_VERSION-${DOCKER_DEFAULT_API_VERSION}}`,
    );
  });

  test("every file the collector reads is inside a directory the guide mounts", () => {
    const receivers: Record<string, any> = collectorConfig["receivers"];
    expect(receivers["docker_stats"]["endpoint"]).toBe(
      "unix:///var/run/docker.sock",
    );
    const mountedPaths: Array<string> = parseRunCommand(
      runCommandFor(cliMarkdown, DOCKER_AGENT_CONTAINER_NAME),
    ).volumes.map((volume: string): string => {
      return volume.split(":")[1]!;
    });
    expect(mountedPaths).toContain("/var/run/docker.sock");
    const logPaths: Array<string> = receivers["filelog"]["include"];
    expect(logPaths).toEqual(["/var/lib/docker/containers/*/*-json.log"]);
    for (const logPath of logPaths) {
      expect(
        mountedPaths.some((mounted: string): boolean => {
          return logPath.startsWith(`${mounted}/`);
        }),
      ).toBe(true);
      expect(cliMarkdown).toContain(logPath);
      expect(composeMarkdown).toContain(logPath);
    }
  });

  test("the AI agent's docker run is the README's", () => {
    const readmeCommand: string = readme.match(
      /Without the installer:\n\n```bash\n([\s\S]*?)```/,
    )![1]!;
    const guideCommand: string = runCommandFor(
      cliMarkdown,
      DOCKER_AI_AGENT_CONTAINER_NAME,
    );
    expect(parseRunCommand(guideCommand)).toEqual(
      parseRunCommand(readmeCommand),
    );
    expect(guideCommand).toContain("--read-only --tmpfs /tmp");
  });

  test("the AI agent's compose service is a part of the agent's own", () => {
    // The install step's docker-compose.yml, with both services.
    const file: string = composeMarkdown.match(
      /```yaml\n(services:\n[\s\S]*?)```/,
    )![1]!;
    const service: ComposeService =
      composeServices(file)[DOCKER_AI_AGENT_CONTAINER_NAME]!;

    for (const key of Object.keys(service)) {
      if (key === "environment") {
        continue;
      }
      expect({ key: key, value: service[key] }).toEqual({
        key: key,
        value: repoAiAgent[key],
      });
    }
    const repoEnv: Array<string> = envNamesOf(repoAiAgent);
    for (const name of envNamesOf(service)) {
      expect(repoEnv).toContain(name);
    }
    expect(service["environment"]).toContain(
      "ONEUPTIME_AI_AGENT_RESOURCE_TYPE=docker",
    );
    expect(repoAiAgent["environment"]).toContain(
      "ONEUPTIME_AI_AGENT_RESOURCE_TYPE=docker",
    );
  });

  test("every AI agent setting the guide names is one the agent reads", () => {
    const aiEnv: Array<string> = envNamesOf(repoAiAgent);
    for (const markdown of [cliMarkdown, composeMarkdown]) {
      for (const match of markdown.matchAll(/ONEUPTIME_AI_[A-Z_]+/g)) {
        expect(aiEnv).toContain(match[0]);
      }
    }
  });

  test("the image tags are the README's", () => {
    const tags: Array<string> = Array.from(
      topicTitled(
        guideFor("docker-cli").advanced,
        "Pin the image version",
      ).markdown.matchAll(/^\| `([^`]+)` \|/gm),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });
    expect(tags.length).toBe(4);
    for (const tag of tags) {
      expect(readme).toContain(`| \`${tag}\``);
    }
  });

  test("the commands for log drivers and API versions are the README's", () => {
    for (const command of [
      "docker inspect <container> --format '{{.HostConfig.LogConfig.Type}}'",
      "docker info --format '{{.LoggingDriver}}'",
      "docker version --format '{{ .Server.APIVersion }}'",
      'docker logs oneuptime-docker-agent 2>&1 | grep -E "Started watching file|no files match"',
      "docker run --rm --volumes-from oneuptime-docker-agent alpine:3.19 \\\n  sh -c 'ls /var/lib/docker/containers/*/*-json.log 2>&1 | head'",
      "docker compose up -d --force-recreate <service>",
      "docker inspect oneuptime-docker-agent --format '{{range .Config.Env}}{{println .}}{{end}}' | grep DOCKER_HOST_NAME",
    ]) {
      expect(readme).toContain(command);
      expect(cliMarkdown).toContain(command);
      expect(composeMarkdown).toContain(command);
    }
    expect(readme).toContain(
      'Error: cannot start pipelines: failed to start "docker_stats" receiver:\nError response from daemon: client version 1.44 is too new.\nMaximum supported API version is 1.41',
    );
  });

  test("the log driver examples are the README's", () => {
    const topic: string = topicTitled(
      guideFor("docker-compose").advanced,
      "Collect logs from every container (json-file log driver)",
    ).markdown;
    for (const block of Array.from(
      topic.matchAll(/```(?:yaml|json)\n([\s\S]*?)```/g),
    )) {
      expect(readme).toContain(block[1]!.trim());
    }
  });

  test("the docs page shows the same ready line", () => {
    expect(
      fs.readFileSync(path.join(DOCS_DIR, "telemetry/docker-host.md"), "utf8"),
    ).toContain("Everything is ready. Begin running and processing data.");
  });
});
