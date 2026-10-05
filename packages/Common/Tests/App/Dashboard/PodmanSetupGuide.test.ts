import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import {
  DEFAULT_PODMAN_INSTALL_METHOD,
  PODMAN_AGENT_CONTAINER_NAME,
  PODMAN_AGENT_IMAGE,
  PODMAN_AI_AGENT_CONTAINER_NAME,
  PODMAN_AI_AGENT_IMAGE,
  PODMAN_DEFAULT_API_VERSION,
  PODMAN_DEFAULT_HOST_NAME,
  PODMAN_EXAMPLE_HOST_NAME,
  PODMAN_INSTALL_METHODS,
  PODMAN_SOCKET_PATH,
  PODMAN_STORAGE_PATH,
  PODMAN_AI_AGENT_TOPIC_TITLE,
  PodmanInstallMethod,
  getPodmanAiAgentComposeService,
  getPodmanAiAgentRunCommand,
  getPodmanComposeFile,
  getPodmanRunCommand,
  getPodmanSetupGuide,
  resolvePodmanInstallMethod,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/Utils/DocumentationMarkdown";
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
 * The Podman agent guide asks how the agent is run — one `podman run`
 * command or `podman compose` — and shows only that way's steps. These tests
 * pin, for both ways:
 *
 *   - the reader's URL and key in every command and file that needs them;
 *   - only the chosen way's commands on screen;
 *   - the OneUptime AI agent started with the collector — AI investigations
 *     are on by default, as with agents/PodmanAgent's own install.sh and
 *     docker-compose.yml — with how to install without it;
 *   - the log driver requirement (rootful Podman logs to journald, which the
 *     agent cannot read) surfaced before the reader has to wonder where the
 *     logs are;
 *   - that every image, container name, mount and variable the guide uses
 *     is the one agents/PodmanAgent really ships. The old guide asked for
 *     "Podman Engine 20.10+" (a Docker Engine version; the agent needs
 *     Podman 4.0+), mounted /var/lib/containers where the agent's own files
 *     mount /var/lib/containers/storage, and saved the compose file under a
 *     name `podman compose` does not look for when Docker Compose is its
 *     provider.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const AGENT_DIR: string = path.join(REPO_ROOT, "agents", "PodmanAgent");
const DOCS_DIR: string = path.join(
  REPO_ROOT,
  "packages/App/FeatureSet/Docs/Content/en",
);

const URL: string = "https://oneuptime.example.com";
const KEY: string = "tik_secret_123";

const LOG_DRIVER_TOPIC: string =
  "Collect logs from every container (k8s-file log driver)";

const METHODS: Array<PodmanInstallMethod> = PODMAN_INSTALL_METHODS.map(
  (option: SetupGuideOption<PodmanInstallMethod>): PodmanInstallMethod => {
    return option.key;
  },
);

const readAgentFile: (name: string) => string = (name: string): string => {
  return fs.readFileSync(path.join(AGENT_DIR, name), "utf8");
};

const guideFor: (
  method: PodmanInstallMethod,
  overrides?: { apiKey?: string; hostName?: string },
) => SetupGuideContent = (
  method: PodmanInstallMethod,
  overrides?: { apiKey?: string; hostName?: string },
): SetupGuideContent => {
  return getPodmanSetupGuide({
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

// The code block that starts the given container with `podman run`.
const runCommandFor: (markdown: string, containerName: string) => string = (
  markdown: string,
  containerName: string,
): string => {
  const block: RegExpMatchArray | undefined = Array.from(
    markdown.matchAll(/```bash\n(podman run -d[\s\S]*?)```/g),
  ).find((match: RegExpMatchArray): boolean => {
    return (match[1] || "").includes(`--name ${containerName} `);
  });
  if (!block) {
    throw new Error(`No podman run command for ${containerName}`);
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

// The flags of a `podman run` command, however its lines are wrapped.
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
const repoCollector: ComposeService = repoCompose[PODMAN_AGENT_CONTAINER_NAME]!;
const repoAiAgent: ComposeService =
  repoCompose[PODMAN_AI_AGENT_CONTAINER_NAME]!;

describe("the install method picker", () => {
  test("offers the Podman CLI first, then Podman Compose", () => {
    expect(METHODS).toEqual(["podman-cli", "podman-compose"]);
    expect(DEFAULT_PODMAN_INSTALL_METHOD).toBe("podman-cli");
    expect(
      PODMAN_INSTALL_METHODS.map(
        (option: SetupGuideOption<PodmanInstallMethod>): string => {
          return option.label;
        },
      ),
    ).toEqual(["Podman CLI", "Podman Compose"]);
  });

  test("every method has a plain one-line description and no badge", () => {
    for (const option of PODMAN_INSTALL_METHODS) {
      expect((option.description || "").length).toBeGreaterThan(0);
      expect(option.description).not.toContain("\n");
      expect(option.description).not.toMatch(/[`*[\]]/);
      expect(option.badge).toBeUndefined();
    }
  });

  test("only the Compose option's name mentions Compose", () => {
    const named: Array<string> = PODMAN_INSTALL_METHODS.filter(
      (option: SetupGuideOption<PodmanInstallMethod>): boolean => {
        return `${option.label} ${option.description}`
          .toLowerCase()
          .includes("compose");
      },
    ).map((option: SetupGuideOption<PodmanInstallMethod>): string => {
      return option.key;
    });
    expect(named).toEqual(["podman-compose"]);
  });

  test("an unknown or missing method resolves to the Podman CLI", () => {
    for (const value of [undefined, null, "", "docker-cli", "Podman-Compose"]) {
      expect(resolvePodmanInstallMethod(value)).toBe("podman-cli");
    }
    expect(resolvePodmanInstallMethod("podman-compose")).toBe("podman-compose");
  });
});

describe.each(METHODS)("the %s guide", (method: PodmanInstallMethod) => {
  const guide: SetupGuideContent = guideFor(method);
  const markdown: string = getSetupGuideMarkdown(guide);
  const isCli: boolean = method === "podman-cli";

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
    const values: { oneuptimeUrl: string; apiKey: string; hostName: string } = {
      oneuptimeUrl: URL,
      apiKey: KEY,
      hostName: PODMAN_EXAMPLE_HOST_NAME,
    };
    if (isCli) {
      expect(install).toContain(getPodmanRunCommand(values));
      expect(install).toContain(`-e ONEUPTIME_URL="${URL}"`);
      expect(install).toContain(`-e ONEUPTIME_SERVICE_TOKEN="${KEY}"`);
    } else {
      expect(install).toContain(getPodmanComposeFile(values));
      expect(install).toContain(`- ONEUPTIME_URL=${URL}`);
      expect(install).toContain(`- ONEUPTIME_SERVICE_TOKEN=${KEY}`);
      expect(guide.steps[1]!.markdown).toContain("podman compose up -d");
    }
  });

  test("mounts the socket and the container storage the agent's files mount", () => {
    const install: string = guide.steps[0]!.markdown || "";
    const mounts: Array<string> = [
      `${PODMAN_SOCKET_PATH}:${PODMAN_SOCKET_PATH}:ro`,
      `${PODMAN_STORAGE_PATH}:${PODMAN_STORAGE_PATH}:ro`,
    ];
    for (const mount of mounts) {
      expect(install).toContain(isCli ? `-v ${mount}` : `- ${mount}`);
    }
    // The parent directory the old guide mounted.
    expect(markdown).not.toContain("/var/lib/containers:/var/lib/containers");
  });

  test("shows only this method's commands", () => {
    const lines: Array<string> = codeLines(guide);
    if (isCli) {
      expect(markdown).toContain(`--name ${PODMAN_AGENT_CONTAINER_NAME}`);
      expect(markdown).not.toContain(`  ${PODMAN_AGENT_CONTAINER_NAME}:\n`);
      expect(markdown).not.toContain('user: "0:0"');
      expect(lines).not.toContain("podman compose up -d");
      expect(markdown).not.toContain("podman compose pull");
      expect(markdown).not.toContain("podman compose down");
      expect(markdown).not.toContain("environment:` list");
      expect(markdown).not.toContain("compose provider");
    } else {
      expect(markdown).toContain(`  ${PODMAN_AGENT_CONTAINER_NAME}:\n`);
      expect(markdown).not.toContain(`--name ${PODMAN_AGENT_CONTAINER_NAME}`);
      expect(markdown).not.toContain("--user 0:0");
      expect(markdown).not.toContain(
        `podman rm -f ${PODMAN_AGENT_CONTAINER_NAME}`,
      );
      expect(markdown).not.toContain(`podman pull ${PODMAN_AGENT_IMAGE}`);
      expect(markdown).not.toContain("-e DOCKER_API_VERSION");
      expect(markdown).not.toContain("-e ONEUPTIME_AI_ALLOW_WRITES");
    }
  });

  test("never uses Docker's own commands for the Podman host", () => {
    for (const line of codeLines(guide)) {
      expect(line).not.toMatch(/^docker /);
    }
    expect(markdown).not.toContain("/var/run/docker.sock");
    expect(markdown).not.toContain("podman-compose.yml");
  });

  test("keeps configuration and optional extras out of the first-run steps", () => {
    const steps: string = stepsText(guide);
    for (const advanced of [
      "DOCKER_API_VERSION",
      // Fixes are opt-in: their switches stay under Advanced.
      "ONEUPTIME_AI_ALLOW_WRITES",
      "ONEUPTIME_AI_WRITE_TARGETS",
      "ONEUPTIME_AI_PROTECTED_TARGETS",
      "containers.conf",
      "podman pull",
      "podman rm",
      "podman compose pull",
      "podman compose down",
      "enterprise-release",
    ]) {
      expect(steps).not.toContain(advanced);
    }
  });

  test("the verify step checks the container and the collector's ready line", () => {
    const verify: string = guide.steps[guide.steps.length - 1]!.markdown || "";
    expect(verify).toContain(
      `podman ps --filter name=${PODMAN_AGENT_CONTAINER_NAME}`,
    );
    expect(verify).toContain(`podman logs -f ${PODMAN_AGENT_CONTAINER_NAME}`);
    expect(verify).toContain(
      "```output\nEverything is ready. Begin running and processing data.\n```",
    );
    expect(verify).toContain("appears automatically in the **Podman** section");
  });

  test("warns about the journald log driver before the reader wonders where the logs are", () => {
    const prerequisites: string = (guide.prerequisites || []).join("\n");
    expect(prerequisites).toContain("`k8s-file` log driver");
    expect(prerequisites).toContain("`journald`");

    const verify: string = guide.steps[guide.steps.length - 1]!.markdown || "";
    expect(verify).toContain("**Metrics but no logs?**");
    expect(verify).toContain("`--log-driver k8s-file`");
    expect(verify).toContain(`see **${LOG_DRIVER_TOPIC}** under Advanced`);

    expect(titles(guide.troubleshooting)).toContain("No container logs");
  });

  test("lists the prerequisites a first install needs", () => {
    const prerequisites: Array<string> = guide.prerequisites || [];
    expect(prerequisites.length).toBeGreaterThanOrEqual(2);
    expect(prerequisites.length).toBeLessThanOrEqual(4);
    expect(prerequisites[0]).toBe("Podman 4.0+");
    expect(prerequisites.join("\n")).toContain(PODMAN_SOCKET_PATH);
    expect(prerequisites.join("\n")).toContain(
      "`sudo systemctl enable --now podman.socket`",
    );
    expect(prerequisites.join("\n")).not.toContain("20.10");
    expect(prerequisites.join("\n").includes("compose provider")).toBe(!isCli);
  });

  test("has Advanced topics for settings, logs, the AI agent, images, upgrades and data", () => {
    expect(titles(guide.advanced)).toEqual([
      "Environment variables",
      LOG_DRIVER_TOPIC,
      PODMAN_AI_AGENT_TOPIC_TITLE,
      "Pin the image version",
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
      "Podman socket permission denied",
      'Agent restarts with "client version is too new"',
      'Host shows as "Disconnected"',
      "No metrics appearing",
      "No container logs",
      "Logs are ingested but missing from the host's page",
      `Host shows up as "${PODMAN_DEFAULT_HOST_NAME}" or a container ID`,
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

  test("links to the Podman agent and monitor docs", () => {
    expect(guide.links).toEqual([
      {
        title: "Podman agent documentation",
        url: "/docs/telemetry/podman-host",
      },
      { title: "Podman monitors", url: "/docs/monitor/podman-monitor" },
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

  test("never runs a command inside the agent, whose image has no shell", () => {
    expect(markdown).not.toContain("podman exec");
    expect(markdown).toContain(
      `podman run --rm --volumes-from ${PODMAN_AGENT_CONTAINER_NAME} alpine:3.19`,
    );
  });

  test("greps the agent's logs with stderr included", () => {
    const greps: Array<string> = codeLines(guide)
      .concat(
        Array.from(markdown.matchAll(/`(podman logs [^`]*)`/g)).map(
          (match: RegExpMatchArray): string => {
            return match[1]!;
          },
        ),
      )
      .filter((line: string): boolean => {
        return line.startsWith("podman logs ") && line.includes("| grep");
      });
    expect(greps.length).toBeGreaterThan(0);
    for (const line of greps) {
      expect(line).toContain(" 2>&1 | grep");
    }
  });

  /*
   * AI investigations are on by default, as with agents/PodmanAgent's own
   * install.sh and docker-compose.yml: the install step starts the AI agent
   * beside the collector, with the same URL, key and host name.
   */
  test("the install step starts the AI agent beside the collector, the way this method runs things", () => {
    const install: string = guide.steps[0]!.markdown || "";
    const values: { oneuptimeUrl: string; apiKey: string; hostName: string } = {
      oneuptimeUrl: URL,
      apiKey: KEY,
      hostName: PODMAN_EXAMPLE_HOST_NAME,
    };

    expect(install).toContain(PODMAN_AI_AGENT_IMAGE);
    expect(install).toContain("ONEUPTIME_AI_AGENT_RESOURCE_TYPE=podman");
    if (isCli) {
      const collector: number = install.indexOf(getPodmanRunCommand(values));
      const aiAgent: number = install.indexOf(
        getPodmanAiAgentRunCommand(values),
      );
      expect(collector).toBeGreaterThan(-1);
      // After the collector, in a code block of its own.
      expect(aiAgent).toBeGreaterThan(collector);
      expect(install).toContain(
        `\`\`\`bash\n${getPodmanAiAgentRunCommand(values)}\n\`\`\``,
      );
      expect(install).toContain(`--name ${PODMAN_AI_AGENT_CONTAINER_NAME}`);
      expect(getPodmanAiAgentRunCommand(values)).toContain(
        `-e PODMAN_HOST_NAME="${PODMAN_EXAMPLE_HOST_NAME}"`,
      );
    } else {
      const services: Record<string, ComposeService> = composeServices(
        getPodmanComposeFile(values),
      );
      expect(Object.keys(services)).toEqual([
        PODMAN_AGENT_CONTAINER_NAME,
        PODMAN_AI_AGENT_CONTAINER_NAME,
      ]);
      expect(
        services[PODMAN_AI_AGENT_CONTAINER_NAME]!["environment"],
      ).toContain(`PODMAN_HOST_NAME=${PODMAN_EXAMPLE_HOST_NAME}`);
      expect(install).toContain(getPodmanAiAgentComposeService(values));
      // `podman compose up -d` in the next step starts both.
      expect(guide.steps[1]!.markdown).toContain("podman compose up -d");
    }
  });

  test("the install step says AI investigations are on by default, and how to install without them", () => {
    const install: string = guide.steps[0]!.markdown || "";
    expect(install).toContain("**AI investigations are on by default**");
    expect(install).toContain("read-only `docker` commands");
    expect(install).toContain("Podman's Docker-compatible socket");
    expect(install).toContain("changes nothing unless you allow fixes");
    expect(install).toContain(
      `see **${PODMAN_AI_AGENT_TOPIC_TITLE}** under Advanced`,
    );
    expect(install).toContain(
      isCli
        ? "Skip this command to run the collector without AI investigations."
        : `Delete the \`${PODMAN_AI_AGENT_CONTAINER_NAME}\` service to run the collector without AI investigations.`,
    );
  });

  test("the AI agent topic says how to allow fixes and how to leave it out, the way this method runs things", () => {
    expect(PODMAN_AI_AGENT_TOPIC_TITLE).toBe("The OneUptime AI agent");
    const topic: SetupGuideTopic = topicTitled(
      guide.advanced,
      PODMAN_AI_AGENT_TOPIC_TITLE,
    );
    expect(topic.summary).toContain("On by default");
    expect(topic.markdown).toContain(`\`${PODMAN_AI_AGENT_CONTAINER_NAME}\``);
    expect(topic.markdown).toContain("**AI investigations are on by default**");
    expect(topic.markdown).toContain("**AI → AI agent**");
    expect(topic.markdown).toContain("**What AI may do**");
    expect(topic.markdown).toContain("**Overview**");
    if (isCli) {
      expect(topic.markdown).toContain("-e ONEUPTIME_AI_ALLOW_WRITES=true");
      expect(topic.markdown).toContain(
        `\`podman rm -f ${PODMAN_AI_AGENT_CONTAINER_NAME}\``,
      );
    } else {
      expect(topic.markdown).toContain("- ONEUPTIME_AI_ALLOW_WRITES=true");
      expect(topic.markdown).toContain(
        "`podman compose up -d --remove-orphans`",
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
      /*
       * The AI agent is part of the install, so the one upgrade command
       * pulls and removes both, and says it only once.
       */
      expect(topic).toContain(
        `podman pull ${PODMAN_AGENT_IMAGE}\npodman pull ${PODMAN_AI_AGENT_IMAGE}\npodman rm -f ${PODMAN_AGENT_CONTAINER_NAME} ${PODMAN_AI_AGENT_CONTAINER_NAME}`,
      );
      expect(topic.split(`podman pull ${PODMAN_AI_AGENT_IMAGE}`)).toHaveLength(
        2,
      );
      expect(topic).toContain("run both `podman run` commands from step 2");
      expect(topic).toContain(`podman rm -f ${PODMAN_AI_AGENT_CONTAINER_NAME}`);
    } else {
      expect(topic).toContain("podman compose pull\npodman compose up -d");
      expect(topic).toContain("podman compose down");
    }
  });

  test("the API version fix asks the socket and sets the variable where this method keeps it", () => {
    const topic: string = topicTitled(
      guide.troubleshooting,
      'Agent restarts with "client version is too new"',
    ).markdown;
    expect(topic).toContain(
      `curl -s -o /dev/null -D - --unix-socket ${PODMAN_SOCKET_PATH} http://localhost/_ping | grep -i '^api-version'`,
    );
    expect(topic).toContain(
      isCli ? "-e DOCKER_API_VERSION=1.41" : "- DOCKER_API_VERSION=1.41",
    );
    expect(topic).toContain(
      isCli ? "`-e DOCKER_API_VERSION=`" : "`- DOCKER_API_VERSION=`",
    );
  });

  test("the socket topic turns the socket on and points rootless readers at theirs", () => {
    const topic: string = topicTitled(
      guide.troubleshooting,
      "Podman socket permission denied",
    ).markdown;
    expect(topic).toContain("sudo systemctl enable --now podman.socket");
    expect(topic).toContain("/run/user/<uid>/podman/podman.sock");
    expect(topic).toContain("systemctl --user enable --now podman.socket");
    expect(topic).toContain(isCli ? "`--user 0:0`" : '`user: "0:0"`');
  });
});

describe("the host name", () => {
  test("a product page suggests a name and says to replace it", () => {
    for (const method of METHODS) {
      const install: string = guideFor(method).steps[0]!.markdown || "";
      expect(install).toContain(
        `Replace \`${PODMAN_EXAMPLE_HOST_NAME}\` with a name for this host`,
      );
      expect(install).toContain("a new name registers a new host");
      expect(install).toContain(
        method === "podman-cli"
          ? `-e PODMAN_HOST_NAME="${PODMAN_EXAMPLE_HOST_NAME}"`
          : `- PODMAN_HOST_NAME=${PODMAN_EXAMPLE_HOST_NAME}`,
      );
    }
  });

  test("a host's own tab installs for that host everywhere", () => {
    for (const method of METHODS) {
      const guide: SetupGuideContent = guideFor(method, {
        hostName: "prod-podman-01",
      });
      const install: string = guide.steps[0]!.markdown || "";
      expect(install).toContain(
        "This installs the agent for **`prod-podman-01`**",
      );
      expect(install).not.toContain("Replace `");
      expect(getSetupGuideMarkdown(guide)).not.toContain(
        PODMAN_EXAMPLE_HOST_NAME,
      );
      const hostLines: Array<string> = codeLines(guide).filter(
        (line: string): boolean => {
          return line.includes("PODMAN_HOST_NAME=") && !line.includes("grep");
        },
      );
      expect(hostLines).toHaveLength(2);
      for (const line of hostLines) {
        expect(line).toMatch(/PODMAN_HOST_NAME="?prod-podman-01"?( \\)?$/);
      }
    }
  });

  test("a blank name, or one that is not a plain word, counts as unknown", () => {
    for (const hostName of ["", "  ", "web host", "web$(id)"]) {
      const install: string =
        guideFor("podman-cli", { hostName: hostName }).steps[0]!.markdown || "";
      expect(install).toContain(
        `-e PODMAN_HOST_NAME="${PODMAN_EXAMPLE_HOST_NAME}"`,
      );
    }
  });
});

describe("before a key is picked", () => {
  test.each(METHODS)(
    "the %s install step shows the placeholder and says where to pick a key",
    (method: PodmanInstallMethod) => {
      const install: string =
        guideFor(method, { apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER }).steps[0]!
          .markdown || "";
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
      expect(
        getSetupGuideMarkdown(
          guideFor(method, { apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER }),
        ),
      ).not.toContain("install.sh");
    }
  });
});

/*
 * The guide is written by hand from agents/PodmanAgent. Each check below
 * reads the agent's real file, so renaming an image, a container, a mount
 * or a variable there fails here instead of leaving the in-app guide wrong.
 */
describe("the guide matches agents/PodmanAgent", () => {
  const cliMarkdown: string = getSetupGuideMarkdown(guideFor("podman-cli"));
  const composeMarkdown: string = getSetupGuideMarkdown(
    guideFor("podman-compose"),
  );
  const installScript: string = readAgentFile("install.sh");
  const readme: string = readAgentFile("README.md");
  const dockerfile: string = readAgentFile("Dockerfile.tpl");
  const collectorConfig: Record<string, any> = yaml.load(
    readAgentFile("otel-collector-config.yaml"),
  ) as Record<string, any>;

  const installRun: RunFlags = parseRunCommand(
    installScript.match(
      /podman run -d \\\n\s+--name oneuptime-podman-agent[\s\S]*?"\$IMAGE"/,
    )![0],
  );

  test("the images and container names are the agent's", () => {
    expect(repoCollector["image"]).toBe(PODMAN_AGENT_IMAGE);
    expect(repoCollector["container_name"]).toBe(PODMAN_AGENT_CONTAINER_NAME);
    expect(repoAiAgent["image"]).toBe(PODMAN_AI_AGENT_IMAGE);
    expect(repoAiAgent["container_name"]).toBe(PODMAN_AI_AGENT_CONTAINER_NAME);
    expect(installScript).toContain(
      `IMAGE="\${ONEUPTIME_PODMAN_AGENT_IMAGE:-${PODMAN_AGENT_IMAGE}}"`,
    );
    expect(installScript).toContain(
      `AI_IMAGE="\${ONEUPTIME_AI_AGENT_IMAGE:-${PODMAN_AI_AGENT_IMAGE}}"`,
    );
    expect(installRun.name).toBe(PODMAN_AGENT_CONTAINER_NAME);
  });

  test("the podman run command mounts and sets what the agent's installer does", () => {
    const guideRun: RunFlags = parseRunCommand(
      runCommandFor(cliMarkdown, PODMAN_AGENT_CONTAINER_NAME),
    );
    expect(guideRun.name).toBe(PODMAN_AGENT_CONTAINER_NAME);
    expect(guideRun.image).toBe(PODMAN_AGENT_IMAGE);
    expect(guideRun.volumes).toEqual(installRun.volumes);
    expect(guideRun.volumes).toEqual(repoCollector["volumes"]);
    expect(guideRun.envNames).toEqual(installRun.envNames);
    expect(runCommandFor(cliMarkdown, PODMAN_AGENT_CONTAINER_NAME)).toContain(
      "--user 0:0",
    );
  });

  test("the podman run command matches the README's quick start", () => {
    const quickStart: string = readme.match(
      /## Quick Start — `podman run`\n\n```bash\n([\s\S]*?)```/,
    )![1]!;
    expect(
      parseRunCommand(runCommandFor(cliMarkdown, PODMAN_AGENT_CONTAINER_NAME)),
    ).toEqual(parseRunCommand(quickStart));
  });

  test("the compose file is the agent's collector service, with the reader's values", () => {
    const composeBlock: string = composeMarkdown.match(
      /```yaml\n(services:\n {2}oneuptime-podman-agent:[\s\S]*?)```/,
    )![1]!;
    const service: ComposeService =
      composeServices(composeBlock)[PODMAN_AGENT_CONTAINER_NAME]!;

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
      `PODMAN_HOST_NAME=${PODMAN_EXAMPLE_HOST_NAME}`,
    ]);
  });

  test("the compose file is saved under the name the agent's own compose file has", () => {
    expect(fs.existsSync(path.join(AGENT_DIR, "docker-compose.yml"))).toBe(
      true,
    );
    const create: SetupGuideStep = guideFor("podman-compose").steps[0]!;
    expect(create.title).toBe("Create docker-compose.yml");
    expect(create.description).toContain("Save this as docker-compose.yml");
  });

  test("every file the collector reads is inside a directory the guide mounts", () => {
    const receivers: Record<string, any> = collectorConfig["receivers"];
    expect(receivers["docker_stats"]["endpoint"]).toBe(
      `unix://${PODMAN_SOCKET_PATH}`,
    );
    const mountedPaths: Array<string> = parseRunCommand(
      runCommandFor(cliMarkdown, PODMAN_AGENT_CONTAINER_NAME),
    ).volumes.map((volume: string): string => {
      return volume.split(":")[1]!;
    });
    expect(mountedPaths).toContain(PODMAN_SOCKET_PATH);
    const logPaths: Array<string> = receivers["filelog"]["include"];
    expect(logPaths.length).toBeGreaterThan(0);
    for (const logPath of logPaths) {
      expect(
        mountedPaths.some((mounted: string): boolean => {
          return logPath.startsWith(`${mounted}/`);
        }),
      ).toBe(true);
      expect(cliMarkdown).toContain(logPath);
    }
  });

  test("the environment variable table lists exactly the collector's variables", () => {
    const table: string = topicTitled(
      guideFor("podman-cli").advanced,
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
      `ENV PODMAN_HOST_NAME=${PODMAN_DEFAULT_HOST_NAME}`,
    );
    expect(dockerfile).toContain(
      `ENV DOCKER_API_VERSION=${PODMAN_DEFAULT_API_VERSION}`,
    );
    expect(repoCollector["environment"]).toContain(
      `PODMAN_HOST_NAME=\${PODMAN_HOST_NAME:-${PODMAN_DEFAULT_HOST_NAME}}`,
    );
    expect(repoCollector["environment"]).toContain(
      `DOCKER_API_VERSION=\${DOCKER_API_VERSION-${PODMAN_DEFAULT_API_VERSION}}`,
    );
  });

  test("the prerequisites are the README's", () => {
    expect(readme).toContain("- Podman 4.0+");
    expect(readme).toContain("sudo systemctl enable --now podman.socket");
    expect(readme).toContain("systemctl --user enable --now podman.socket");
    expect(readme).toContain("**`k8s-file`**");
    expect(readme).toContain("**`journald`**");
  });

  test("the AI agent's podman run is the README's", () => {
    const readmeCommand: string = readme.match(
      /Without the installer:\n\n```bash\n([\s\S]*?)```/,
    )![1]!;
    const guideCommand: string = runCommandFor(
      cliMarkdown,
      PODMAN_AI_AGENT_CONTAINER_NAME,
    );
    expect(parseRunCommand(guideCommand)).toEqual(
      parseRunCommand(readmeCommand),
    );
  });

  test("the AI agent's compose service is a part of the agent's own", () => {
    // The install step's docker-compose.yml, with both services.
    const file: string = composeMarkdown.match(
      /```yaml\n(services:\n[\s\S]*?)```/,
    )![1]!;
    const service: ComposeService =
      composeServices(file)[PODMAN_AI_AGENT_CONTAINER_NAME]!;

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
    expect(repoAiAgent["environment"]).toContain(
      "ONEUPTIME_AI_AGENT_RESOURCE_TYPE=podman",
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
        guideFor("podman-cli").advanced,
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
      "podman inspect <container> --format '{{.HostConfig.LogConfig.Type}}'",
      "podman info --format '{{.Host.LogDriver}}'",
      "podman run --log-driver k8s-file --log-opt max-size=100m ... <image>",
      "curl -s -o /dev/null -D - --unix-socket /run/podman/podman.sock http://localhost/_ping | grep -i '^api-version'",
      'podman logs oneuptime-podman-agent 2>&1 | grep -E "Started watching file|no files match"',
      "podman run --rm --volumes-from oneuptime-podman-agent alpine:3.19 \\\n  sh -c 'ls /var/lib/containers/storage/overlay-containers/*/userdata/ctr.log 2>&1 | head'",
      "podman compose up -d --force-recreate <service>",
      "podman inspect oneuptime-podman-agent --format '{{range .Config.Env}}{{println .}}{{end}}' | grep PODMAN_HOST_NAME",
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
      guideFor("podman-compose").advanced,
      LOG_DRIVER_TOPIC,
    ).markdown;
    const blocks: Array<RegExpMatchArray> = Array.from(
      topic.matchAll(/```(?:yaml|toml)\n([\s\S]*?)```/g),
    );
    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      expect(readme).toContain(block[1]!.trim());
    }
  });

  test("the docs page shows the same ready line and the rootless socket path", () => {
    const docsPage: string = fs.readFileSync(
      path.join(DOCS_DIR, "telemetry/podman-host.md"),
      "utf8",
    );
    expect(docsPage).toContain(
      "Everything is ready. Begin running and processing data.",
    );
    expect(docsPage).toContain("/run/user/<uid>/podman/podman.sock");
  });
});
