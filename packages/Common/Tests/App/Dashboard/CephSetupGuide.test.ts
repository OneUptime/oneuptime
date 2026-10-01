import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import markdownSlugify from "../../../Server/Types/MarkdownSlugify";
import {
  CEPH_AGENT_COLLECTOR_CONFIG,
  CEPH_AGENT_CONTAINER,
  CEPH_AGENT_INSTALL_DIR,
  CEPH_AGENT_RAW_URL,
  CEPH_AGENT_SOURCE_URL,
  CEPH_AI_AGENT_CONTAINER,
  CEPH_EXAMPLE_CLUSTER_NAME,
  CEPH_EXAMPLE_MGR_ENDPOINTS,
  CEPH_INSTALL_METHODS,
  CephInstallMethod,
  DEFAULT_CEPH_INSTALL_METHOD,
  getCephInstallScriptCommand,
  getCephSetupGuide,
  resolveCephInstallMethod,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/Utils/DocumentationMarkdown";
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

/*
 * The Ceph agent guide asks how to install the agent — the install script
 * or Docker Compose — and shows only that path. These tests pin, for both:
 *
 *   - the reader's URL and key in every command and file that needs them,
 *     and never a placeholder key in the install script's environment (the
 *     script would write it into .env as the key);
 *   - that each method shows only its own instructions;
 *   - that the collector config the guide shows IS the shipped file, and
 *     every variable, file, container and script it names exists in
 *     agents/CephAgent — the guide is how most people install the agent,
 *     so a drift there is a broken install, not a doc typo.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const AGENT_DIR: string = path.join(REPO_ROOT, "agents", "CephAgent");
const DOCS_DIR: string = path.join(
  REPO_ROOT,
  "packages",
  "App",
  "FeatureSet",
  "Docs",
  "Content",
  "en",
);

const URL: string = "https://oneuptime.example.com";
const KEY: string = "tik_secret_123";

// What ObjectID.generate() mints: the E2E spec greps the page for one.
const UUID_KEY: string = "0f8fad5b-d9cb-469f-a165-70867728950e";

const METHOD_KEYS: Array<CephInstallMethod> = CEPH_INSTALL_METHODS.map(
  (option: SetupGuideOption<CephInstallMethod>): CephInstallMethod => {
    return option.key;
  },
);

interface GuideOverrides {
  oneuptimeUrl?: string;
  apiKey?: string;
  hasApiKey?: boolean;
  clusterName?: string;
}

const guideFor: (
  method: CephInstallMethod,
  overrides?: GuideOverrides,
) => SetupGuideContent = (
  method: CephInstallMethod,
  overrides?: GuideOverrides,
): SetupGuideContent => {
  const apiKey: string = overrides?.apiKey ?? KEY;
  return getCephSetupGuide({
    oneuptimeUrl: overrides?.oneuptimeUrl ?? URL,
    apiKey: apiKey,
    hasApiKey:
      overrides?.hasApiKey ?? apiKey !== SETUP_GUIDE_API_KEY_PLACEHOLDER,
    method: method,
    clusterName: overrides?.clusterName,
  });
};

const noKeyGuideFor: (method: CephInstallMethod) => SetupGuideContent = (
  method: CephInstallMethod,
): SetupGuideContent => {
  return guideFor(method, {
    apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
    hasApiKey: false,
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

const topicTitles: (
  topics: Array<SetupGuideTopic> | undefined,
) => Array<string> = (
  topics: Array<SetupGuideTopic> | undefined,
): Array<string> => {
  return (topics || []).map((topic: SetupGuideTopic): string => {
    return topic.title;
  });
};

// Everything a step shows: its markdown and every tab.
const stepText: (step: SetupGuideStep) => string = (
  step: SetupGuideStep,
): string => {
  return [
    step.description || "",
    step.markdown || "",
    ...(step.variants || []).map(
      (variant: { label: string; markdown: string }): string => {
        return variant.markdown;
      },
    ),
  ].join("\n");
};

const stepsText: (guide: SetupGuideContent) => string = (
  guide: SetupGuideContent,
): string => {
  return guide.steps.map(stepText).join("\n");
};

const installStep: (guide: SetupGuideContent) => string = (
  guide: SetupGuideContent,
): string => {
  return stepTitled(guide, "Install the agent").markdown || "";
};

// The .env block of the Docker Compose install.
const envFileOf: (guide: SetupGuideContent) => string = (
  guide: SetupGuideContent,
): string => {
  const block: string | undefined = getSetupGuideCodeBlocks(guide).find(
    (candidate: string): boolean => {
      return candidate.startsWith("ONEUPTIME_URL=");
    },
  );
  if (!block) {
    throw new Error("The guide has no .env block");
  }
  return block.trimEnd();
};

const readAgentFile: (name: string) => string = (name: string): string => {
  return fs.readFileSync(path.join(AGENT_DIR, name), "utf8");
};

// Variables a compose service reads from .env: `${NAME}` and `${NAME:-x}`.
const composeVariables: (serviceName: string) => Map<string, string | null> = (
  serviceName: string,
): Map<string, string | null> => {
  const compose: Record<string, any> = yaml.load(
    readAgentFile("docker-compose.yml"),
  ) as Record<string, any>;
  const environment: Array<string> =
    compose["services"][serviceName]["environment"];
  const variables: Map<string, string | null> = new Map();
  for (const entry of environment) {
    for (const match of entry.matchAll(/\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/g)) {
      variables.set(match[1]!, match[2] ?? null);
    }
  }
  return variables;
};

// The rows of the guide's environment variable table.
const envTableRows: (
  guide: SetupGuideContent,
) => Map<string, { required: string; description: string }> = (
  guide: SetupGuideContent,
): Map<string, { required: string; description: string }> => {
  const markdown: string = topicTitled(
    guide.advanced,
    "Environment variables",
  ).markdown;
  const rows: Map<string, { required: string; description: string }> =
    new Map();
  for (const match of markdown.matchAll(
    /^\| `([A-Z0-9_]+)` \| ([^|]+) \| (.*) \|$/gm,
  )) {
    rows.set(match[1]!, {
      required: match[2]!.trim(),
      description: match[3]!,
    });
  }
  return rows;
};

describe("the install method picker", () => {
  test("offers the install script first, then Docker Compose", () => {
    expect(METHOD_KEYS).toEqual(["install-script", "docker-compose"]);
    expect(DEFAULT_CEPH_INSTALL_METHOD).toBe("install-script");
    expect(
      CEPH_INSTALL_METHODS.map(
        (option: SetupGuideOption<CephInstallMethod>): string => {
          return option.label;
        },
      ),
    ).toEqual(["Install script", "Docker Compose"]);
  });

  test("recommends only the install script", () => {
    expect(CEPH_INSTALL_METHODS[0]!.badge).toBe("Recommended");
    expect(CEPH_INSTALL_METHODS[1]!.badge).toBeUndefined();
  });

  test("every method has a one-line description", () => {
    for (const option of CEPH_INSTALL_METHODS) {
      expect((option.description || "").length).toBeGreaterThan(0);
      expect(option.description).not.toContain("\n");
    }
  });

  test("only the Docker Compose option's name mentions Docker Compose", () => {
    /*
     * A radio's accessible name is its label plus its description, and the
     * E2E specs pick this option by /^Docker Compose/.
     */
    expect(CEPH_INSTALL_METHODS[0]!.description).not.toContain(
      "Docker Compose",
    );
  });

  test("an unknown or missing method resolves to the install script", () => {
    for (const value of [undefined, null, "", "helm", "DOCKER-COMPOSE"]) {
      expect(resolveCephInstallMethod(value)).toBe("install-script");
    }
    expect(resolveCephInstallMethod("docker-compose")).toBe("docker-compose");
  });
});

describe.each(METHOD_KEYS)("the %s guide", (method: CephInstallMethod) => {
  const guide: SetupGuideContent = guideFor(method);
  const markdown: string = getSetupGuideMarkdown(guide);

  test("is three steps after the key: enable the module, install, verify", () => {
    expect(
      guide.steps.map((step: SetupGuideStep): string => {
        return step.title;
      }),
    ).toEqual([
      "Enable the mgr prometheus module",
      "Install the agent",
      "Verify the installation",
    ]);
  });

  test("every step has a plain one-sentence description", () => {
    for (const step of guide.steps) {
      expect(step.description).toBeTruthy();
      // Descriptions render as plain text, so no markdown.
      expect(step.description).not.toMatch(/[`*[\]]/);
      expect(step.description).not.toContain("\n");
    }
  });

  test("enables the mgr prometheus module and lists every mgr", () => {
    const enable: string =
      stepTitled(guide, "Enable the mgr prometheus module").markdown || "";
    expect(enable).toContain(
      codeBlock("bash", "ceph mgr module enable prometheus"),
    );
    expect(enable).toContain("ceph mgr stat");
    expect(enable).toContain("ceph orch ps --daemon-type mgr");
    expect(enable).toContain("Only the **active** mgr returns metrics");
  });

  test("lists what must be in place first", () => {
    const prerequisites: string = (guide.prerequisites || []).join("\n");
    expect(guide.prerequisites!.length).toBeGreaterThanOrEqual(2);
    expect(guide.prerequisites!.length).toBeLessThanOrEqual(4);
    expect(prerequisites).toContain("Docker Engine 20.10+");
    expect(prerequisites).toContain("Docker Compose v2");
    expect(prerequisites).toContain("port 9283");
    expect(prerequisites).toContain("`ceph` CLI");
  });

  test("the verify step checks the collector container and its ready line", () => {
    const verify: string =
      stepTitled(guide, "Verify the installation").markdown || "";
    expect(verify).toContain(`docker ps --filter name=${CEPH_AGENT_CONTAINER}`);
    expect(verify).toContain(`docker logs -f ${CEPH_AGENT_CONTAINER}`);
    expect(verify).toContain(
      "Everything is ready. Begin running and processing data.",
    );
    expect(verify).toContain("appears automatically in the **Ceph** section");
    expect(verify).toContain(CEPH_AI_AGENT_CONTAINER);
  });

  test("keeps configuration options out of the first-run steps", () => {
    const steps: string = stepsText(guide);
    for (const advanced of [
      "filelog",
      "oneuptime.label.",
      "docker compose pull",
      "docker compose down",
      "ceph auth get-or-create",
      "honor_labels",
    ]) {
      expect(steps).not.toContain(advanced);
    }
  });

  test("has Advanced topics for settings, config, logs, labels, data, AI and upgrades", () => {
    expect(topicTitles(guide.advanced)).toEqual([
      "Environment variables",
      "How the agent scrapes, and its collector config",
      "Ship the Ceph cluster log",
      "Tag the cluster with project labels",
      "What the agent collects",
      "OneUptime AI agent",
      "Upgrade or uninstall the agent",
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

  test("troubleshooting starts with the diagnostic script and covers the known problems", () => {
    expect(topicTitles(guide.troubleshooting)).toEqual([
      "Run the diagnostic script first",
      "No cluster appears in OneUptime",
      'Cluster shows as "Disconnected"',
      "Metrics stop after a mgr failover",
      "Scrape errors for standby mgrs in the collector logs",
      "Cluster appears under the wrong name",
    ]);
  });

  test("the diagnostic script is the agent's own, run against this install", () => {
    const script: string = topicTitled(
      guide.troubleshooting,
      "Run the diagnostic script first",
    ).markdown;
    expect(script).toContain(
      `curl -sSL ${CEPH_AGENT_RAW_URL}/troubleshoot.sh -o troubleshoot.sh`,
    );
    expect(script).toContain("GET /otlp/v1/validate");
    if (method === "install-script") {
      expect(script).toContain("\nbash troubleshoot.sh\n");
    } else {
      expect(script).toContain('bash troubleshoot.sh -d "$PWD"');
    }
  });

  test("greps the collector's logs on stderr too", () => {
    /*
     * The collector logs to stderr, and `docker logs` keeps the streams
     * apart, so a bare `| grep` would never see an error line.
     */
    const disconnected: string = topicTitled(
      guide.troubleshooting,
      'Cluster shows as "Disconnected"',
    ).markdown;
    expect(disconnected).toContain(
      `docker logs ${CEPH_AGENT_CONTAINER} 2>&1 | grep -i error`,
    );
    expect(markdown).not.toMatch(/docker logs \S+ \| grep/);
  });

  test("the environment table carries the reader's URL", () => {
    expect(
      topicTitled(guide.advanced, "Environment variables").markdown,
    ).toContain(`(e.g. \`${URL}\`)`);
  });

  test("shows the shipped collector config verbatim", () => {
    expect(
      topicTitled(
        guide.advanced,
        "How the agent scrapes, and its collector config",
      ).markdown,
    ).toContain(codeBlock("yaml", CEPH_AGENT_COLLECTOR_CONFIG));
  });

  test("commands in the agent's folder run where this method installs it", () => {
    const upgrade: string = topicTitled(
      guide.advanced,
      "Upgrade or uninstall the agent",
    ).markdown;
    if (method === "install-script") {
      expect(upgrade).toContain(
        codeBlock(
          "bash",
          `cd ${CEPH_AGENT_INSTALL_DIR}\ndocker compose pull\ndocker compose up -d`,
        ),
      );
      expect(upgrade).toContain(
        codeBlock("bash", `cd ${CEPH_AGENT_INSTALL_DIR}\ndocker compose down`),
      );
      // Every Compose command outside the steps first enters the folder.
      const composeCommand: RegExp = /^docker compose /m;
      for (const block of getSetupGuideCodeBlocks({
        steps: [],
        advanced: guide.advanced,
      })) {
        if (composeCommand.test(block)) {
          expect(block.startsWith(`cd ${CEPH_AGENT_INSTALL_DIR}\n`)).toBe(true);
        }
      }
    } else {
      expect(upgrade).toContain(
        codeBlock("bash", "docker compose pull\ndocker compose up -d"),
      );
      expect(upgrade).toContain("the one with `docker-compose.yml`");
      expect(markdown).not.toContain(CEPH_AGENT_INSTALL_DIR);
    }
  });

  test("the AI agent topic sets up its own read-only Ceph client", () => {
    const ai: string = topicTitled(
      guide.advanced,
      "OneUptime AI agent",
    ).markdown;
    expect(ai).toContain(
      "ceph auth get-or-create client.oneuptime-ai mon 'allow r' mgr 'allow r' osd 'allow r' -o ceph/ceph.client.oneuptime-ai.keyring",
    );
    expect(ai).toContain("ceph config generate-minimal-conf > ceph/ceph.conf");
    expect(ai).toContain(
      "sudo chown 1000:1000 ceph/ceph.client.oneuptime-ai.keyring",
    );
    expect(ai).toContain("**Never put the admin keyring there.**");
    expect(ai).toContain("ONEUPTIME_AI_ALLOW_WRITES=true");
    expect(ai).toContain(
      `docker exec ${CEPH_AI_AGENT_CONTAINER} wget -qO- http://127.0.0.1:3877/status`,
    );
    expect(ai).toContain("(/docs/ai/infrastructure-ai-agents#ceph-clusters)");
    expect(ai.includes("The install script offers to create them")).toBe(
      method === "install-script",
    );
  });

  test("links to the Ceph agent and monitor documentation", () => {
    expect(guide.links).toEqual([
      { title: "Ceph agent documentation", url: "/docs/telemetry/ceph" },
      { title: "Ceph monitors and alerts", url: "/docs/monitor/ceph-monitor" },
    ]);
  });

  test("every documentation link points at a page, and anchor, that exists", () => {
    const links: Array<string> = [
      ...(guide.links || []).map((link: { url: string }): string => {
        return link.url;
      }),
      ...Array.from(markdown.matchAll(/\]\((\/docs\/[^)\s]+)\)/g)).map(
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      ),
    ];
    expect(links.length).toBeGreaterThan(2);
    for (const link of links) {
      const parts: Array<string> = link.replace(/^\/docs\//, "").split("#");
      const anchor: string | undefined = parts[1];
      const file: string = path.join(DOCS_DIR, `${parts[0]}.md`);
      expect({ link, exists: fs.existsSync(file) }).toEqual({
        link,
        exists: true,
      });
      if (anchor) {
        const headings: Array<string> = Array.from(
          fs.readFileSync(file, "utf8").matchAll(/^#+ (.+)$/gm),
        ).map((match: RegExpMatchArray): string => {
          return markdownSlugify(match[1]!);
        });
        expect(headings).toContain(anchor);
      }
    }
  });
});

describe("the install script", () => {
  test("carries the reader's URL and key on the command line", () => {
    expect(
      getCephInstallScriptCommand({
        oneuptimeUrl: URL,
        apiKey: KEY,
        hasApiKey: true,
      }),
    ).toBe(
      [
        "curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/CephAgent/install.sh -o install.sh",
        `ONEUPTIME_URL=${URL} ONEUPTIME_TELEMETRY_INGESTION_KEY=${KEY} bash install.sh`,
      ].join("\n"),
    );
  });

  test("is the command the install step shows", () => {
    expect(installStep(guideFor("install-script"))).toContain(
      codeBlock(
        "bash",
        getCephInstallScriptCommand({
          oneuptimeUrl: URL,
          apiKey: KEY,
          hasApiKey: true,
        }),
      ),
    );
  });

  test("quotes values the shell would otherwise change", () => {
    const command: string = getCephInstallScriptCommand({
      oneuptimeUrl: "https://oneuptime.example.com/a b",
      apiKey: "it's$key",
      hasApiKey: true,
    });
    expect(command).toContain(
      "ONEUPTIME_URL='https://oneuptime.example.com/a b'",
    );
    expect(command).toContain(
      "ONEUPTIME_TELEMETRY_INGESTION_KEY='it'\\''s$key'",
    );
  });

  test("prefills nothing but the URL and the key", () => {
    const command: string = getCephInstallScriptCommand({
      oneuptimeUrl: URL,
      apiKey: KEY,
      hasApiKey: true,
    });
    const assignments: Array<string> = Array.from(
      command.matchAll(/\b([A-Z_]+)=/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });
    expect(assignments).toEqual([
      "ONEUPTIME_URL",
      "ONEUPTIME_TELEMETRY_INGESTION_KEY",
    ]);
  });

  test("never puts the placeholder key into the script's environment", () => {
    for (const hasApiKey of [false, true]) {
      const command: string = getCephInstallScriptCommand({
        oneuptimeUrl: URL,
        apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
        hasApiKey: hasApiKey,
      });
      expect(command).not.toContain("ONEUPTIME_");
      expect(command).not.toContain(SETUP_GUIDE_API_KEY_PLACEHOLDER);
      expect(command.split("\n")[1]).toBe("bash install.sh");
    }
  });

  test("leaves the URL to the prompt while the dashboard does not know it", () => {
    const command: string = getCephInstallScriptCommand({
      oneuptimeUrl: SETUP_GUIDE_URL_PLACEHOLDER,
      apiKey: KEY,
      hasApiKey: true,
    });
    expect(command).not.toContain("ONEUPTIME_URL");
    expect(command).toContain(
      `ONEUPTIME_TELEMETRY_INGESTION_KEY=${KEY} bash install.sh`,
    );
  });

  test("before a key is picked, the guide says the script asks for the URL and key", () => {
    const guide: SetupGuideContent = noKeyGuideFor("install-script");
    const install: string = installStep(guide);
    expect(install).toContain(
      "The script asks for your OneUptime URL and ingestion key, both shown in step 1",
    );
    expect(install).not.toContain("already carries");
    // Nothing in this guide holds the key, so the placeholder never shows.
    expect(getSetupGuideMarkdown(guide)).not.toContain(
      SETUP_GUIDE_API_KEY_PLACEHOLDER,
    );
  });

  test("with a key, the guide says the command already carries it", () => {
    const install: string = installStep(guideFor("install-script"));
    expect(install).toContain(
      "The command already carries your OneUptime URL and ingestion key.",
    );
    expect(install).not.toContain("both shown in step 1");
  });

  test("says what the script asks for, where it installs, and how it runs", () => {
    const install: string = installStep(guideFor("install-script"));
    expect(install).toContain("**Cluster name**");
    expect(install).toContain(
      "**Mgr endpoints** — every mgr from the previous step as comma-separated `host:port`",
    );
    expect(install).toContain("The script adds the square brackets.");
    expect(install).toContain("**OneUptime AI agent**");
    expect(install).toContain(
      `It installs to \`${CEPH_AGENT_INSTALL_DIR}\` and starts the agent with Docker Compose.`,
    );
  });

  test("shows none of the Docker Compose instructions", () => {
    const guide: SetupGuideContent = guideFor("install-script");
    const markdown: string = getSetupGuideMarkdown(guide);
    expect(markdown).not.toContain("curl -fsSLO");
    expect(markdown).not.toContain("mkdir oneuptime-ceph-agent");
    expect(markdown).not.toContain(
      `CEPH_CLUSTER_NAME=${CEPH_EXAMPLE_CLUSTER_NAME}`,
    );
    // No .env file to write: the script writes it.
    expect(() => {
      return envFileOf(guide);
    }).toThrow("The guide has no .env block");
    expect(stepsText(guide)).not.toContain("CEPH_MGR_ENDPOINTS=");
  });
});

describe("the Docker Compose install", () => {
  const guide: SetupGuideContent = guideFor("docker-compose");
  const install: string = installStep(guide);

  test("downloads the two files, writes .env, then starts the agent", () => {
    const download: number = install.indexOf(
      `curl -fsSLO ${CEPH_AGENT_RAW_URL}/docker-compose.yml`,
    );
    const config: number = install.indexOf(
      `curl -fsSLO ${CEPH_AGENT_RAW_URL}/otel-collector-config.yaml`,
    );
    const env: number = install.indexOf("ONEUPTIME_URL=");
    const start: number = install.indexOf("docker compose up -d");
    expect(download).toBeGreaterThan(-1);
    expect(config).toBeGreaterThan(download);
    expect(env).toBeGreaterThan(config);
    expect(start).toBeGreaterThan(env);
    expect(install).toContain(
      `[CephAgent directory](${CEPH_AGENT_SOURCE_URL})`,
    );
  });

  test("the .env file carries the reader's URL and key", () => {
    expect(envFileOf(guide)).toBe(
      [
        `ONEUPTIME_URL=${URL}`,
        `ONEUPTIME_TELEMETRY_INGESTION_KEY=${KEY}`,
        `CEPH_CLUSTER_NAME=${CEPH_EXAMPLE_CLUSTER_NAME}`,
        `CEPH_MGR_ENDPOINTS=${CEPH_EXAMPLE_MGR_ENDPOINTS}`,
      ].join("\n"),
    );
  });

  test("says to list every mgr in brackets", () => {
    expect(install).toContain(
      "List **every** mgr daemon in `CEPH_MGR_ENDPOINTS`, comma-separated and wrapped in square brackets",
    );
  });

  test("shows the placeholder, and where to pick a key, until one is picked", () => {
    const noKey: SetupGuideContent = noKeyGuideFor("docker-compose");
    expect(envFileOf(noKey)).toContain(
      `ONEUPTIME_TELEMETRY_INGESTION_KEY=${SETUP_GUIDE_API_KEY_PLACEHOLDER}`,
    );
    expect(installStep(noKey)).toContain("Pick an ingestion key in step 1");
    expect(install).not.toContain("Pick an ingestion key in step 1");
    expect(getSetupGuideMarkdown(guide)).not.toContain(
      SETUP_GUIDE_API_KEY_PLACEHOLDER,
    );
  });

  test("shows none of the install script's instructions", () => {
    const markdown: string = getSetupGuideMarkdown(guide);
    expect(markdown).not.toContain("install.sh");
    expect(markdown).not.toContain("install script");
    expect(markdown).not.toContain(CEPH_AGENT_INSTALL_DIR);
  });

  test("renders what the skipped E2E spec reads off the page", () => {
    /*
     * CephProduct.spec.ts picks Docker Compose after creating a key, then
     * reads the page for these; the install script (the default) must
     * still carry the key for the spec that reads it back out.
     */
    const withKey: string = getSetupGuideMarkdown(
      guideFor("docker-compose", {
        oneuptimeUrl: "http://localhost",
        apiKey: UUID_KEY,
      }),
    );
    expect(withKey).toMatch(/ONEUPTIME_URL=http/);
    expect(withKey).toContain("CEPH_CLUSTER_NAME=my-ceph-cluster");
    expect(withKey).toContain("docker compose up -d");
    expect(withKey).not.toContain("<YOUR_API_KEY>");
    expect(
      withKey.match(
        /ONEUPTIME_TELEMETRY_INGESTION_KEY=([0-9a-fA-F-]{36})/,
      )?.[1],
    ).toBe(UUID_KEY);

    const byDefault: string = getSetupGuideMarkdown(
      guideFor(DEFAULT_CEPH_INSTALL_METHOD, {
        oneuptimeUrl: "http://localhost",
        apiKey: UUID_KEY,
      }),
    );
    expect(
      byDefault.match(
        /ONEUPTIME_TELEMETRY_INGESTION_KEY=([0-9a-fA-F-]{36})/,
      )?.[1],
    ).toBe(UUID_KEY);
  });
});

describe("the cluster name", () => {
  test("a product page suggests a name and says to replace it", () => {
    const install: string = installStep(guideFor("docker-compose"));
    expect(install).toContain(
      `Replace \`${CEPH_EXAMPLE_CLUSTER_NAME}\` with a name for this cluster`,
    );
    expect(install).toContain("a new name registers a new cluster");
  });

  test("a cluster's own tab writes its name into .env and says to keep it", () => {
    const guide: SetupGuideContent = guideFor("docker-compose", {
      clusterName: "ceph-prod-eu",
    });
    expect(envFileOf(guide)).toContain("CEPH_CLUSTER_NAME=ceph-prod-eu");
    expect(installStep(guide)).toContain(
      "This installs the agent for **`ceph-prod-eu`**",
    );
    expect(installStep(guide)).not.toContain("Replace `");
    expect(
      topicTitled(guide.troubleshooting, "Cluster appears under the wrong name")
        .markdown,
    ).toContain("This cluster is **`ceph-prod-eu`**.");
  });

  test("the install script is told to enter a known name exactly", () => {
    const install: string = installStep(
      guideFor("install-script", { clusterName: "ceph-prod-eu" }),
    );
    expect(install).toContain("enter **`ceph-prod-eu`** exactly");
    // Only the URL and the key are ever prefilled.
    expect(install).not.toContain("CEPH_CLUSTER_NAME=");
  });

  test("a name the .env file would misread is quoted", () => {
    expect(
      envFileOf(guideFor("docker-compose", { clusterName: "prod ceph" })),
    ).toContain("CEPH_CLUSTER_NAME='prod ceph'");
  });

  test("a blank name counts as unknown", () => {
    expect(
      envFileOf(guideFor("docker-compose", { clusterName: "  " })),
    ).toContain(`CEPH_CLUSTER_NAME=${CEPH_EXAMPLE_CLUSTER_NAME}`);
  });
});

describe("drift guards against agents/CephAgent", () => {
  test("the collector config is the shipped file, byte for byte", () => {
    expect(CEPH_AGENT_COLLECTOR_CONFIG).toBe(
      readAgentFile("otel-collector-config.yaml"),
    );
  });

  test("the scrape behaviour the guide describes is the config's", () => {
    const config: Record<string, any> = yaml.load(
      CEPH_AGENT_COLLECTOR_CONFIG,
    ) as Record<string, any>;
    const job: Record<string, any> =
      config["receivers"]["prometheus"]["config"]["scrape_configs"][0];
    expect(job["honor_labels"]).toBe(true);
    expect(job["scrape_interval"]).toBe("30s");
    expect(job["static_configs"][0]["targets"]).toBe(
      "${env:CEPH_MGR_ENDPOINTS}",
    );
    expect(config["processors"]["resource"]["attributes"][0]).toEqual({
      key: "ceph.cluster.name",
      value: "${env:CEPH_CLUSTER_NAME}",
      action: "upsert",
    });
  });

  test("the environment table documents exactly what the collector reads", () => {
    const collector: Map<string, string | null> =
      composeVariables(CEPH_AGENT_CONTAINER);
    for (const method of METHOD_KEYS) {
      const rows: Map<string, { required: string; description: string }> =
        envTableRows(guideFor(method));
      expect(Array.from(rows.keys()).sort()).toEqual(
        Array.from(collector.keys()).sort(),
      );
    }
  });

  test("the defaults the table gives are the compose file's", () => {
    const collector: Map<string, string | null> =
      composeVariables(CEPH_AGENT_CONTAINER);
    const rows: Map<string, { required: string; description: string }> =
      envTableRows(guideFor("docker-compose"));
    let checked: number = 0;
    for (const [name, row] of rows) {
      const stated: RegExpMatchArray | null = row.description.match(
        /\(default: `([^`]+)`\)/,
      );
      if (stated) {
        expect({ name, default: collector.get(name) }).toEqual({
          name,
          default: stated[1],
        });
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  test("the .env block sets only variables the collector reads", () => {
    const collector: Map<string, string | null> =
      composeVariables(CEPH_AGENT_CONTAINER);
    const names: Array<string> = envFileOf(guideFor("docker-compose"))
      .split("\n")
      .map((line: string): string => {
        return line.split("=")[0]!;
      });
    expect(names.length).toBe(4);
    for (const name of names) {
      expect(collector.has(name)).toBe(true);
    }
  });

  test("the install script writes every required variable to .env", () => {
    const script: string = readAgentFile("install.sh");
    const rows: Map<string, { required: string; description: string }> =
      envTableRows(guideFor("install-script"));
    for (const [name, row] of rows) {
      if (row.required === "Yes") {
        expect(script).toMatch(new RegExp(`^${name}=\\$${name}$`, "m"));
      }
    }
  });

  test("the install script honours a preset URL and key, which prefilling relies on", () => {
    const script: string = readAgentFile("install.sh");
    for (const name of ["ONEUPTIME_URL", "ONEUPTIME_TELEMETRY_INGESTION_KEY"]) {
      expect(script).toMatch(
        new RegExp(`if \\[ -z "\\$${name}" \\]; then\\s*\\n\\s*read -rp`),
      );
    }
  });

  test("the install script installs where the guide says and adds the brackets", () => {
    const script: string = readAgentFile("install.sh");
    expect(script).toContain(
      `INSTALL_DIR="\${INSTALL_DIR:-${CEPH_AGENT_INSTALL_DIR}}"`,
    );
    expect(script).toContain(`REPO_BASE="${CEPH_AGENT_RAW_URL}"`);
    expect(script).toContain('CEPH_MGR_ENDPOINTS="[$CEPH_MGR_ENDPOINTS]"');
    expect(script).toContain("[ceph]");
  });

  test("every file the guide downloads exists in the agent's directory", () => {
    const files: Set<string> = new Set();
    for (const method of METHOD_KEYS) {
      const markdown: string = getSetupGuideMarkdown(guideFor(method));
      for (const match of markdown.matchAll(
        /https:\/\/raw\.githubusercontent\.com\/OneUptime\/oneuptime\/master\/agents\/([A-Za-z]+)\/([A-Za-z0-9._-]+)/g,
      )) {
        expect(match[1]).toBe("CephAgent");
        files.add(match[2]!);
      }
    }
    expect(Array.from(files).sort()).toEqual([
      "docker-compose.yml",
      "install.sh",
      "otel-collector-config.yaml",
      "troubleshoot.sh",
    ]);
    for (const file of files) {
      expect(fs.existsSync(path.join(AGENT_DIR, file))).toBe(true);
    }
    expect(CEPH_AGENT_SOURCE_URL).toMatch(/\/tree\/master\/agents\/CephAgent$/);
  });

  test("the containers the guide names are the compose file's", () => {
    const compose: Record<string, any> = yaml.load(
      readAgentFile("docker-compose.yml"),
    ) as Record<string, any>;
    const containers: Array<string> = Object.values(
      compose["services"] as Record<string, Record<string, string>>,
    ).map((service: Record<string, string>): string => {
      return service["container_name"]!;
    });
    expect(containers).toContain(CEPH_AGENT_CONTAINER);
    expect(containers).toContain(CEPH_AI_AGENT_CONTAINER);
  });

  test("the AI agent's client, keyring folder and status port are the compose file's", () => {
    const compose: string = readAgentFile("docker-compose.yml");
    expect(compose).toContain("CEPH_CLIENT_ID=${CEPH_CLIENT_ID:-oneuptime-ai}");
    expect(compose).toContain("- ./ceph:/etc/ceph:ro");
    expect(compose).toContain("http://127.0.0.1:3877/status/live");
  });

  test("the lines the cluster-log topic uncomments are in the shipped files", () => {
    expect(readAgentFile("docker-compose.yml")).toContain(
      "# - /var/log/ceph:/var/log/ceph:ro",
    );
    expect(CEPH_AGENT_COLLECTOR_CONFIG).toContain("  # filelog:\n");
    expect(CEPH_AGENT_COLLECTOR_CONFIG).toContain("    # logs:\n");
  });

  test("the diagnostic script takes -d and defaults to the install directory", () => {
    const script: string = readAgentFile("troubleshoot.sh");
    expect(script).toContain('-d|--dir)      DIR="${2:-}"; shift 2 ;;');
    expect(script).toContain(`DIR="${CEPH_AGENT_INSTALL_DIR}"`);
  });
});
