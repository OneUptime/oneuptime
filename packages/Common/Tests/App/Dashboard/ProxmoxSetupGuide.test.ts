import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import markdownSlugify from "../../../Server/Types/MarkdownSlugify";
import {
  DEFAULT_PROXMOX_CONNECT_METHOD,
  PROXMOX_AGENT_COLLECTOR_CONFIG,
  PROXMOX_AGENT_CONTAINER,
  PROXMOX_AGENT_INSTALL_DIR,
  PROXMOX_AGENT_RAW_URL,
  PROXMOX_AGENT_SOURCE_URL,
  PROXMOX_AI_AGENT_CONTAINER,
  PROXMOX_CONNECT_METHODS,
  PROXMOX_EXAMPLE_CLUSTER_NAME,
  PROXMOX_EXPORTER_CONTAINER,
  PROXMOX_NATIVE_PUSH_PATH,
  PROXMOX_PUSH_HOST_PLACEHOLDER,
  PROXMOX_TOKEN_ID,
  PROXMOX_TOKEN_USER,
  PROXMOX_AGENT_COLLECTOR_IMAGE,
  PROXMOX_AGENT_RECREATE_COMMAND,
  ProxmoxConnectMethod,
  ProxmoxPushTarget,
  getProxmoxAgentDownloadCommand,
  getProxmoxAgentUpgradeCommand,
  getProxmoxInstallScriptCommand,
  getProxmoxPushTarget,
  getProxmoxSetupGuide,
  resolveProxmoxConnectMethod,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/Utils/DocumentationMarkdown";
import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SETUP_GUIDE_URL_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideOption,
  SetupGuideStep,
  SetupGuideStepVariant,
  SetupGuideTopic,
  codeBlock,
  getSetupGuideCodeBlocks,
  getSetupGuideMarkdown,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";

/*
 * The Proxmox guide asks how to connect the cluster — the agent through the
 * install script, the agent through Docker Compose, or Proxmox VE 9's own
 * OpenTelemetry push — and shows only that path. These tests pin:
 *
 *   - the reader's URL and key in every command, file and form field that
 *     needs them, and never a placeholder key in the install script's
 *     environment (the script would write it into .env as the key);
 *   - a read-only token that actually works: a privilege-separated token
 *     only gets what its user also has, so the role goes on both;
 *   - that the native push never mentions installing anything, and says
 *     what it cannot send;
 *   - that the collector config the guide shows IS the shipped file, and
 *     every variable, file, container and script it names exists in
 *     agents/ProxmoxAgent.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const AGENT_DIR: string = path.join(REPO_ROOT, "agents", "ProxmoxAgent");
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

const METHOD_KEYS: Array<ProxmoxConnectMethod> = PROXMOX_CONNECT_METHODS.map(
  (option: SetupGuideOption<ProxmoxConnectMethod>): ProxmoxConnectMethod => {
    return option.key;
  },
);

const AGENT_METHODS: Array<ProxmoxConnectMethod> = [
  "install-script",
  "docker-compose",
];

interface GuideOverrides {
  oneuptimeUrl?: string;
  apiKey?: string;
  hasApiKey?: boolean;
  clusterName?: string;
}

const guideFor: (
  method: ProxmoxConnectMethod,
  overrides?: GuideOverrides,
) => SetupGuideContent = (
  method: ProxmoxConnectMethod,
  overrides?: GuideOverrides,
): SetupGuideContent => {
  const apiKey: string = overrides?.apiKey ?? KEY;
  return getProxmoxSetupGuide({
    oneuptimeUrl: overrides?.oneuptimeUrl ?? URL,
    apiKey: apiKey,
    hasApiKey:
      overrides?.hasApiKey ?? apiKey !== SETUP_GUIDE_API_KEY_PLACEHOLDER,
    method: method,
    clusterName: overrides?.clusterName,
  });
};

const noKeyGuideFor: (method: ProxmoxConnectMethod) => SetupGuideContent = (
  method: ProxmoxConnectMethod,
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

// Everything a step shows: its description, its markdown and every tab.
const stepText: (step: SetupGuideStep) => string = (
  step: SetupGuideStep,
): string => {
  return [
    step.description || "",
    step.markdown || "",
    ...(step.variants || []).map((variant: SetupGuideStepVariant): string => {
      return variant.markdown;
    }),
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

const variantTitled: (
  step: SetupGuideStep,
  label: string,
) => SetupGuideStepVariant = (
  step: SetupGuideStep,
  label: string,
): SetupGuideStepVariant => {
  const variant: SetupGuideStepVariant | undefined = (step.variants || []).find(
    (candidate: SetupGuideStepVariant): boolean => {
      return candidate.label === label;
    },
  );
  if (!variant) {
    throw new Error(`No tab labelled "${label}"`);
  }
  return variant;
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

const composeFile: () => Record<string, any> = (): Record<string, any> => {
  return yaml.load(readAgentFile("docker-compose.yml")) as Record<string, any>;
};

// Variables a compose service reads from .env: `${NAME}` and `${NAME:-x}`.
const composeVariables: (serviceName: string) => Map<string, string | null> = (
  serviceName: string,
): Map<string, string | null> => {
  const environment: Array<string> =
    composeFile()["services"][serviceName]["environment"];
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

describe("the connect method picker", () => {
  test("offers the install script, Docker Compose and the native push, in that order", () => {
    expect(METHOD_KEYS).toEqual([
      "install-script",
      "docker-compose",
      "native-push",
    ]);
    expect(DEFAULT_PROXMOX_CONNECT_METHOD).toBe("install-script");
    expect(
      PROXMOX_CONNECT_METHODS.map(
        (option: SetupGuideOption<ProxmoxConnectMethod>): string => {
          return option.label;
        },
      ),
    ).toEqual([
      "Install script",
      "Docker Compose",
      "Native push (Proxmox VE 9+)",
    ]);
  });

  test("recommends only the install script", () => {
    expect(
      PROXMOX_CONNECT_METHODS.map(
        (
          option: SetupGuideOption<ProxmoxConnectMethod>,
        ): string | undefined => {
          return option.badge;
        },
      ),
    ).toEqual(["Recommended", undefined, undefined]);
  });

  test("every method has a one-line description", () => {
    for (const option of PROXMOX_CONNECT_METHODS) {
      expect((option.description || "").length).toBeGreaterThan(0);
      expect(option.description).not.toContain("\n");
    }
  });

  test("the native push says up front what it leaves out", () => {
    const native: string = PROXMOX_CONNECT_METHODS[2]!.description || "";
    expect(native).toContain("Nothing to install");
    expect(native).toContain("HA");
    expect(native).toContain("backup");
    expect(native).toContain("replication");
  });

  test("only the Docker Compose option's name mentions Docker Compose", () => {
    /*
     * A radio's accessible name is its label plus its description, and the
     * E2E specs pick this option by /^Docker Compose/.
     */
    for (const option of [
      PROXMOX_CONNECT_METHODS[0]!,
      PROXMOX_CONNECT_METHODS[2]!,
    ]) {
      expect(`${option.label} ${option.description}`).not.toContain(
        "Docker Compose",
      );
    }
  });

  test("an unknown or missing method resolves to the install script", () => {
    for (const value of [undefined, null, "", "helm", "NATIVE-PUSH"]) {
      expect(resolveProxmoxConnectMethod(value)).toBe("install-script");
    }
    expect(resolveProxmoxConnectMethod("native-push")).toBe("native-push");
    expect(resolveProxmoxConnectMethod("docker-compose")).toBe(
      "docker-compose",
    );
  });
});

describe.each(METHOD_KEYS)("the %s guide", (method: ProxmoxConnectMethod) => {
  const guide: SetupGuideContent = guideFor(method);
  const markdown: string = getSetupGuideMarkdown(guide);

  test("every step has a plain one-sentence description", () => {
    for (const step of guide.steps) {
      expect(step.description).toBeTruthy();
      // Descriptions render as plain text, so no markdown.
      expect(step.description).not.toMatch(/[`*[\]]/);
      expect(step.description).not.toContain("\n");
    }
  });

  test("has two to four prerequisites", () => {
    expect(guide.prerequisites!.length).toBeGreaterThanOrEqual(2);
    expect(guide.prerequisites!.length).toBeLessThanOrEqual(4);
  });

  test("every Advanced topic has a plain one-line summary", () => {
    expect((guide.advanced || []).length).toBeGreaterThan(0);
    for (const topic of guide.advanced || []) {
      expect(topic.summary).toBeTruthy();
      // Summaries render as plain text, so no markdown.
      expect(topic.summary).not.toMatch(/[`*[\]]/);
      expect(topic.summary).not.toContain("\n");
    }
  });

  test("links to the Proxmox documentation", () => {
    expect(guide.links).toEqual([
      { title: "Proxmox documentation", url: "/docs/telemetry/proxmox" },
      {
        title: "Proxmox monitors and alerts",
        url: "/docs/monitor/proxmox-monitor",
      },
    ]);
  });

  test("every documentation link points at a page, and anchor, that exists", () => {
    const links: Array<string> = Array.from(
      markdown.matchAll(/\]\((\/docs\/[^)\s]+)\)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });
    expect(links.length).toBeGreaterThanOrEqual(2);
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

describe.each(AGENT_METHODS)(
  "the agent guide, %s",
  (method: ProxmoxConnectMethod) => {
    const guide: SetupGuideContent = guideFor(method);
    const markdown: string = getSetupGuideMarkdown(guide);

    test("is three steps after the key: token, install, verify", () => {
      expect(
        guide.steps.map((step: SetupGuideStep): string => {
          return step.title;
        }),
      ).toEqual([
        "Create a read-only API token",
        "Install the agent",
        "Verify the installation",
      ]);
    });

    test("keeps the default key step, which shows the OneUptime URL", () => {
      expect(guide.keyStep).toBeUndefined();
      expect(guide.intro).toBeUndefined();
    });

    test("lists what must be in place first", () => {
      const prerequisites: string = (guide.prerequisites || []).join("\n");
      expect(prerequisites).toContain("Docker Engine 20.10+");
      expect(prerequisites).toContain("Docker Compose v2");
      expect(prerequisites).toContain("port 8006");
      expect(prerequisites).toContain("outside the cluster");
    });

    test("the token step offers the shell and the web UI as tabs", () => {
      const token: SetupGuideStep = stepTitled(
        guide,
        "Create a read-only API token",
      );
      expect(
        (token.variants || []).map((variant: SetupGuideStepVariant): string => {
          return variant.label;
        }),
      ).toEqual(["Shell", "Proxmox web UI"]);
    });

    test("the verify step lists the three containers and the ready line", () => {
      const verify: string =
        stepTitled(guide, "Verify the installation").markdown || "";
      expect(verify).toContain("docker compose ps");
      expect(verify).toContain(
        `docker compose logs -f ${PROXMOX_AGENT_CONTAINER}`,
      );
      for (const container of [
        PROXMOX_AGENT_CONTAINER,
        PROXMOX_EXPORTER_CONTAINER,
        PROXMOX_AI_AGENT_CONTAINER,
      ]) {
        expect(verify).toContain(`\`${container}\``);
      }
      expect(verify).toContain(
        "Everything is ready. Begin running and processing data.",
      );
      expect(verify.includes(`cd ${PROXMOX_AGENT_INSTALL_DIR}`)).toBe(
        method === "install-script",
      );
    });

    test("keeps configuration options out of the first-run steps", () => {
      const steps: string = stepsText(guide);
      for (const advanced of [
        "journald",
        "oneuptime.label.",
        "PVE_EXPORTER_URL",
        "docker compose pull",
        "docker compose down",
        "transform/pve-identity",
      ]) {
        expect(steps).not.toContain(advanced);
      }
    });

    test("has Advanced topics for settings, exporter, data, config, logs, labels, AI and upgrades", () => {
      expect(topicTitles(guide.advanced)).toEqual([
        "Environment variables",
        "Use your own prometheus-pve-exporter",
        "What the agent collects",
        "The collector configuration",
        "Ship Proxmox service logs",
        "Tag the cluster with project labels",
        "OneUptime AI agent",
        "Upgrade or uninstall the agent",
      ]);
    });

    test("troubleshooting starts with the diagnostic script and covers the known problems", () => {
      expect(topicTitles(guide.troubleshooting)).toEqual([
        "Run the diagnostic script first",
        'Cluster shows as "Disconnected"',
        "No metrics appearing",
        "The exporter returns 401 or 595 errors",
        "Only node metrics, no guest metrics",
        "Cluster appears under the wrong name",
      ]);
    });

    test("the diagnostic script is the agent's own, run against this install", () => {
      const script: string = topicTitled(
        guide.troubleshooting,
        "Run the diagnostic script first",
      ).markdown;
      expect(script).toContain(
        `curl -sSL ${PROXMOX_AGENT_RAW_URL}/troubleshoot.sh -o troubleshoot.sh`,
      );
      if (method === "install-script") {
        expect(script).toContain("\nbash troubleshoot.sh\n");
      } else {
        expect(script).toContain('bash troubleshoot.sh -d "$PWD"');
      }
    });

    test("checks the bundled exporter from inside its network namespace", () => {
      expect(
        topicTitled(guide.troubleshooting, "No metrics appearing").markdown,
      ).toContain(
        codeBlock(
          "bash",
          `docker run --rm --network container:${PROXMOX_EXPORTER_CONTAINER} curlimages/curl -s "http://localhost:9221/pve?target=<PVE_HOST>&cluster=1&node=1" | head`,
        ),
      );
    });

    test("the environment table carries the reader's URL", () => {
      expect(
        topicTitled(guide.advanced, "Environment variables").markdown,
      ).toContain(`(e.g. \`${URL}\`)`);
    });

    test("shows the shipped collector config verbatim", () => {
      expect(
        topicTitled(guide.advanced, "The collector configuration").markdown,
      ).toContain(codeBlock("yaml", PROXMOX_AGENT_COLLECTOR_CONFIG));
    });

    /*
     * The collector image is pinned in docker-compose.yml and the config
     * stamps the pin as the agent's version, so pulling alone never moves
     * the agent forward. An install-script install runs the script again:
     * it reuses the .env (nothing is asked again), downloads both files and
     * recreates the agent. A Docker Compose install downloads both files
     * itself and recreates (Compose recreates a container for a new image,
     * never for a new config file). The dialog beside an outdated version
     * shows the same blocks (AgentUpgradeGuides.test.ts).
     */
    test("the upgrade is the install script again, or both pinned files and a recreate", () => {
      const upgrade: string = topicTitled(
        guide.advanced,
        "Upgrade or uninstall the agent",
      ).markdown;

      expect(upgrade).toContain(
        "pulling alone does not move the agent forward",
      );
      // And where the sign that opens these commands sits.
      expect(upgrade).toContain("**Agent Version**");
      // Pulling alone, the old upgrade, is no longer offered.
      expect(upgrade).not.toMatch(
        /docker compose pull\ndocker compose up -d\n/,
      );

      if (method === "install-script") {
        expect(upgrade).toContain(
          codeBlock("bash", getProxmoxAgentUpgradeCommand()),
        );
        expect(upgrade).toContain("Run the install script again.");
        expect(upgrade).toContain(
          "It reuses every value in your existing `.env` (nothing is asked again)",
        );
        expect(upgrade).toContain(
          "a file you edited is kept next to the new one as `<file>.bak.<timestamp>`",
        );
        // Nothing to download or recreate by hand.
        expect(upgrade).not.toContain("curl -fsSLO");
        expect(upgrade).not.toContain("--force-recreate");
        return;
      }

      const download: string = getProxmoxAgentDownloadCommand();
      expect(upgrade).toContain(codeBlock("bash", download));
      expect(upgrade).toContain(
        codeBlock("bash", PROXMOX_AGENT_RECREATE_COMMAND),
      );
      expect(upgrade.indexOf(download)).toBeLessThan(
        upgrade.indexOf(PROXMOX_AGENT_RECREATE_COMMAND),
      );
      expect(download).toBe(
        [
          `curl -fsSLO ${PROXMOX_AGENT_RAW_URL}/docker-compose.yml`,
          `curl -fsSLO ${PROXMOX_AGENT_RAW_URL}/otel-collector-config.yaml`,
        ].join("\n"),
      );
      expect(PROXMOX_AGENT_RECREATE_COMMAND).toBe(
        "docker compose pull\ndocker compose up -d --force-recreate",
      );
      // The .env is kept: nothing here rewrites it.
      expect(upgrade).toContain("your `.env` stays");
      expect(upgrade).not.toContain("install.sh");
    });

    test("commands in the agent's folder run where this method installs it", () => {
      const composeCommand: RegExp = /^docker compose /m;
      for (const block of getSetupGuideCodeBlocks({
        steps: [],
        advanced: guide.advanced,
      })) {
        if (composeCommand.test(block)) {
          expect(block.startsWith(`cd ${PROXMOX_AGENT_INSTALL_DIR}\n`)).toBe(
            method === "install-script",
          );
        }
      }
      if (method === "docker-compose") {
        expect(markdown).not.toContain(PROXMOX_AGENT_INSTALL_DIR);
      }
    });

    test("the AI agent topic reads with the collector's token and stays read-only", () => {
      const ai: string = topicTitled(
        guide.advanced,
        "OneUptime AI agent",
      ).markdown;
      expect(ai).toContain("`PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET`");
      expect(ai).toContain("ONEUPTIME_AI_ALLOW_WRITES=true");
      expect(ai).toContain("ONEUPTIME_AI_PROTECTED_TARGETS");
      expect(ai).toContain(
        `docker exec ${PROXMOX_AI_AGENT_CONTAINER} wget -qO- http://127.0.0.1:3877/status`,
      );
      expect(ai).toContain(
        "(/docs/ai/infrastructure-ai-agents#proxmox-clusters)",
      );
    });

    test("names the alert templates' identity processor", () => {
      expect(
        topicTitled(guide.advanced, "What the agent collects").markdown,
      ).toContain("`pve.scope`");
    });

    test("shows none of the native push instructions", () => {
      expect(markdown).not.toContain("Metric Server");
      expect(markdown).not.toContain(PROXMOX_NATIVE_PUSH_PATH);
      expect(markdown).not.toContain(PROXMOX_PUSH_HOST_PLACEHOLDER);
    });
  },
);

describe("the read-only API token", () => {
  const token: SetupGuideStep = stepTitled(
    guideFor("install-script"),
    "Create a read-only API token",
  );

  test("the shell tab creates the user and token and gives both PVEAuditor on /", () => {
    expect(variantTitled(token, "Shell").markdown).toContain(
      codeBlock(
        "bash",
        [
          `pveum user add ${PROXMOX_TOKEN_USER}`,
          `pveum acl modify / --roles PVEAuditor --users ${PROXMOX_TOKEN_USER}`,
          `pveum user token add ${PROXMOX_TOKEN_USER} oneuptime --privsep 1`,
          `pveum acl modify / --roles PVEAuditor --tokens '${PROXMOX_TOKEN_ID}'`,
        ].join("\n"),
      ),
    );
    expect(PROXMOX_TOKEN_ID).toBe("monitoring@pam!oneuptime");
  });

  test("both tabs explain why the user and the token need the role", () => {
    for (const label of ["Shell", "Proxmox web UI"]) {
      const text: string = variantTitled(token, label).markdown;
      expect(text).toContain("only gets the permissions its user also has");
      expect(text).toContain("`Permission check failed (/, Sys.Audit)`");
    }
  });

  test("the web UI tab grants the role to the token and to its user", () => {
    const ui: string = variantTitled(token, "Proxmox web UI").markdown;
    expect(ui).toContain("*Datacenter → Permissions → API Tokens*");
    expect(ui).toContain("make sure **Privilege Separation** is checked");
    expect(ui).toContain("**API Token Permission** for the token");
    expect(ui).toContain("**User Permission** for its user");
    expect(ui).toContain("the secret is shown only once");
  });

  test("the Docker Compose .env uses the token this step creates", () => {
    expect(envFileOf(guideFor("docker-compose"))).toContain(
      `PVE_API_TOKEN_ID=${PROXMOX_TOKEN_ID}`,
    );
  });
});

describe("the install script", () => {
  test("carries the reader's URL and key on the command line", () => {
    expect(
      getProxmoxInstallScriptCommand({
        oneuptimeUrl: URL,
        apiKey: KEY,
        hasApiKey: true,
      }),
    ).toBe(
      [
        "curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/ProxmoxAgent/install.sh -o install.sh",
        `ONEUPTIME_URL=${URL} ONEUPTIME_TELEMETRY_INGESTION_KEY=${KEY} bash install.sh`,
      ].join("\n"),
    );
    expect(installStep(guideFor("install-script"))).toContain(
      codeBlock(
        "bash",
        getProxmoxInstallScriptCommand({
          oneuptimeUrl: URL,
          apiKey: KEY,
          hasApiKey: true,
        }),
      ),
    );
  });

  test("quotes values the shell would otherwise change", () => {
    const command: string = getProxmoxInstallScriptCommand({
      oneuptimeUrl: URL,
      apiKey: "key with space",
      hasApiKey: true,
    });
    expect(command).toContain(
      "ONEUPTIME_TELEMETRY_INGESTION_KEY='key with space'",
    );
  });

  test("never puts the placeholder key into the script's environment", () => {
    for (const hasApiKey of [false, true]) {
      const command: string = getProxmoxInstallScriptCommand({
        oneuptimeUrl: URL,
        apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
        hasApiKey: hasApiKey,
      });
      expect(command).not.toContain("ONEUPTIME_");
      expect(command.split("\n")[1]).toBe("bash install.sh");
    }
  });

  test("leaves the URL to the prompt while the dashboard does not know it", () => {
    const command: string = getProxmoxInstallScriptCommand({
      oneuptimeUrl: SETUP_GUIDE_URL_PLACEHOLDER,
      apiKey: KEY,
      hasApiKey: true,
    });
    expect(command).not.toContain("ONEUPTIME_URL");
    expect(command).toContain(`ONEUPTIME_TELEMETRY_INGESTION_KEY=${KEY}`);
  });

  test("before a key is picked, says the script asks for the URL and key", () => {
    const guide: SetupGuideContent = noKeyGuideFor("install-script");
    expect(installStep(guide)).toContain(
      "The script asks for your OneUptime URL and ingestion key, both shown in step 1",
    );
    expect(getSetupGuideMarkdown(guide)).not.toContain(
      SETUP_GUIDE_API_KEY_PLACEHOLDER,
    );
  });

  test("says what the script asks for, where it installs, and how it runs", () => {
    const install: string = installStep(guideFor("install-script"));
    expect(install).toContain(
      "The command already carries your OneUptime URL and ingestion key.",
    );
    for (const prompt of [
      "**Cluster name**",
      "**Proxmox VE API host**",
      "**Bundled prometheus-pve-exporter**",
      "**API token**",
      "**OneUptime AI agent**",
    ]) {
      expect(install).toContain(prompt);
    }
    expect(install).toContain(
      `It installs to \`${PROXMOX_AGENT_INSTALL_DIR}\`, writes a \`0600\` \`.env\` file and starts everything with Docker Compose.`,
    );
  });

  /*
   * install.sh reuses the .env it finds, so running it again keeps the
   * answers and is the upgrade: the install step says so where the reader
   * first meets the script.
   */
  test("says that running the script again keeps the answers and is the upgrade", () => {
    expect(installStep(guideFor("install-script"))).toContain(
      "Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.",
    );
  });

  test("the upgrade runs the script with nothing in its environment, which would override the .env", () => {
    expect(getProxmoxAgentUpgradeCommand()).toBe(
      [
        `curl -sSL ${PROXMOX_AGENT_RAW_URL}/install.sh -o install.sh`,
        "bash install.sh",
      ].join("\n"),
    );
    expect(getProxmoxAgentUpgradeCommand()).not.toContain("ONEUPTIME_");
  });

  test("uses your own exporter by answering the script's question", () => {
    expect(
      topicTitled(
        guideFor("install-script").advanced,
        "Use your own prometheus-pve-exporter",
      ).markdown,
    ).toContain("**Run the bundled prometheus-pve-exporter?**, answer **n**");
  });

  test("shows none of the Docker Compose instructions", () => {
    const guide: SetupGuideContent = guideFor("install-script");
    const markdown: string = getSetupGuideMarkdown(guide);
    // The script downloads the files, also to upgrade.
    for (const block of getSetupGuideCodeBlocks(guide)) {
      expect(block).not.toContain("curl -fsSLO");
    }
    expect(markdown).not.toContain("mkdir oneuptime-proxmox-agent");
    expect(markdown).not.toContain("COMPOSE_PROFILES=pve-exporter\n");
    expect(() => {
      return envFileOf(guide);
    }).toThrow("The guide has no .env block");
  });
});

describe("the Docker Compose install", () => {
  const guide: SetupGuideContent = guideFor("docker-compose");
  const install: string = installStep(guide);

  test("downloads the two files, writes .env, then starts the agent", () => {
    const download: number = install.indexOf(
      `curl -fsSLO ${PROXMOX_AGENT_RAW_URL}/docker-compose.yml`,
    );
    const config: number = install.indexOf(
      `curl -fsSLO ${PROXMOX_AGENT_RAW_URL}/otel-collector-config.yaml`,
    );
    const env: number = install.indexOf("ONEUPTIME_URL=");
    const start: number = install.indexOf("docker compose up -d");
    expect(download).toBeGreaterThan(-1);
    expect(config).toBeGreaterThan(download);
    expect(env).toBeGreaterThan(config);
    expect(start).toBeGreaterThan(env);
    expect(install).toContain(
      `[ProxmoxAgent directory](${PROXMOX_AGENT_SOURCE_URL})`,
    );
    expect(install).toContain("`chmod 600 .env`");
  });

  test("the .env file carries the reader's URL and key and starts the bundled exporter", () => {
    expect(envFileOf(guide)).toBe(
      [
        `ONEUPTIME_URL=${URL}`,
        `ONEUPTIME_TELEMETRY_INGESTION_KEY=${KEY}`,
        `PROXMOX_CLUSTER_NAME=${PROXMOX_EXAMPLE_CLUSTER_NAME}`,
        "PVE_HOST=192.168.1.10",
        `PVE_API_TOKEN_ID=${PROXMOX_TOKEN_ID}`,
        "PVE_API_TOKEN_SECRET=your-token-secret",
        "COMPOSE_PROFILES=pve-exporter",
      ].join("\n"),
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

  test("points your own exporter at an address the container can reach", () => {
    const own: string = topicTitled(
      guide.advanced,
      "Use your own prometheus-pve-exporter",
    ).markdown;
    expect(own).toContain(
      codeBlock("bash", "PVE_EXPORTER_URL=your-exporter-host:9221"),
    );
    expect(own).toContain(
      "`localhost` inside the container is the container itself",
    );
    expect(own).toContain("Keep `PVE_API_TOKEN_ID` and `PVE_API_TOKEN_SECRET`");
  });

  test("shows none of the install script's instructions", () => {
    const markdown: string = getSetupGuideMarkdown(guide);
    expect(markdown).not.toContain("install.sh");
    expect(markdown).not.toContain("install script");
    expect(markdown).not.toContain(PROXMOX_AGENT_INSTALL_DIR);
  });

  test("renders what the skipped E2E spec reads off the page", () => {
    /*
     * ProxmoxProduct.spec.ts picks Docker Compose after creating a key, then
     * reads the page for these; the install script (the default) must still
     * carry the key for the spec that reads it back out.
     */
    const withKey: string = getSetupGuideMarkdown(
      guideFor("docker-compose", {
        oneuptimeUrl: "http://localhost",
        apiKey: UUID_KEY,
      }),
    );
    expect(withKey).toMatch(/ONEUPTIME_URL=http/);
    expect(withKey).toContain("PROXMOX_CLUSTER_NAME=my-proxmox-cluster");
    expect(withKey).toContain("docker compose up -d");
    expect(withKey).not.toContain("<YOUR_API_KEY>");
    expect(
      withKey.match(
        /ONEUPTIME_TELEMETRY_INGESTION_KEY=([0-9a-fA-F-]{36})/,
      )?.[1],
    ).toBe(UUID_KEY);

    const byDefault: string = getSetupGuideMarkdown(
      guideFor(DEFAULT_PROXMOX_CONNECT_METHOD, {
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

describe("the native push", () => {
  const guide: SetupGuideContent = guideFor("native-push");
  const markdown: string = getSetupGuideMarkdown(guide);

  test("is two steps after the key: add the metric server, check the cluster", () => {
    expect(
      guide.steps.map((step: SetupGuideStep): string => {
        return step.title;
      }),
    ).toEqual([
      "Add OneUptime as a metric server",
      "Check that the cluster appears",
    ]);
  });

  test("never mentions installing anything", () => {
    for (const install of [
      "install.sh",
      "docker compose",
      "docker-compose",
      "pveum",
      "PVE_API_TOKEN",
      "otel-collector-config",
      "curl ",
    ]) {
      expect(markdown).not.toContain(install);
    }
  });

  test("says what it cannot send before the steps, and not to run both", () => {
    expect(guide.intro).toContain("Proxmox VE 9.0 and later");
    for (const missing of [
      "HA state",
      "start-on-boot",
      "backup coverage",
      "replication",
    ]) {
      expect(guide.intro).toContain(missing);
    }
    expect(guide.intro).toContain("running both reports every resource twice");
  });

  test("the key step shows the OTLP metrics endpoint the push is sent to", () => {
    expect(guide.keyStep).toEqual({
      description:
        "Proxmox VE sends its metrics with this key, in the x-oneuptime-token header. Pick an existing key or create a new one — the settings below update to use it.",
      endpointLabel: "OTLP metrics endpoint",
      endpointValue: `${URL}/otlp/v1/metrics`,
    });
  });

  test("the metric server fields carry the reader's host and key", () => {
    const step: string =
      stepTitled(guide, "Add OneUptime as a metric server").markdown || "";
    expect(step).toContain("| **Server** | `oneuptime.example.com` |");
    expect(step).toContain("| **Port** | `443` |");
    expect(step).toContain("| **Protocol** | `https` |");
    expect(step).toContain("| **Path** | `/otlp/v1/metrics` |");
    expect(step).toContain(
      codeBlock("json", `{"x-oneuptime-token": "${KEY}"}`),
    );
    expect(
      JSON.parse(
        getSetupGuideCodeBlocks(guide).find((block: string): boolean => {
          return block.includes("x-oneuptime-token");
        })!,
      ),
    ).toEqual({ "x-oneuptime-token": KEY });
    expect(
      stepTitled(guide, "Add OneUptime as a metric server").description,
    ).toContain("Datacenter → Metric Server");
  });

  test("shows the placeholder, and where to pick a key, until one is picked", () => {
    const step: string =
      stepTitled(
        noKeyGuideFor("native-push"),
        "Add OneUptime as a metric server",
      ).markdown || "";
    expect(step).toContain(
      `{"x-oneuptime-token": "${SETUP_GUIDE_API_KEY_PLACEHOLDER}"}`,
    );
    expect(step).toContain("Pick an ingestion key in step 1");
  });

  test("follows a self-hosted URL's scheme, port and path", () => {
    const step: string =
      stepTitled(
        guideFor("native-push", {
          oneuptimeUrl: "http://oneuptime.local:8080",
        }),
        "Add OneUptime as a metric server",
      ).markdown || "";
    expect(step).toContain("| **Server** | `oneuptime.local` |");
    expect(step).toContain("| **Port** | `8080` |");
    expect(step).toContain("| **Protocol** | `http` |");
  });

  test("has Advanced topics for silent nodes, the cluster name and what is sent", () => {
    expect(topicTitles(guide.advanced)).toEqual([
      "When a node stops reporting",
      "Which name the cluster registers under",
      "What the native push sends",
    ]);
    const silent: string = topicTitled(
      guide.advanced,
      "When a node stops reporting",
    ).markdown;
    expect(silent).toContain("about 2 minutes after its last report");
    expect(silent).toContain("**Node Offline** fires after about 5 minutes");
    expect(silent).toContain("7–9 minutes");
    expect(silent).toContain("oneuptime.proxmox.inferred=not-reporting");
  });

  test("the templates it names as agent-only are real Proxmox templates", () => {
    const templates: string = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "packages",
        "Common",
        "Types",
        "Monitor",
        "ProxmoxAlertTemplates.ts",
      ),
      "utf8",
    );
    const named: Array<string> = Array.from(
      markdown.matchAll(/\*\*([A-Z][A-Za-z ]+)\*\*/g),
    )
      .map((match: RegExpMatchArray): string => {
        return match[1]!;
      })
      .filter((name: string): boolean => {
        return [
          "Guest Down",
          "HA Resource in Error State",
          "Guest Not Backed Up",
          "Replication Failing",
          "Node Offline",
          "Cluster Quorum at Risk",
        ].includes(name);
      });
    expect(new Set(named).size).toBe(6);
    for (const name of named) {
      expect(templates).toContain(`name: "${name}",`);
    }
  });

  test("troubleshooting covers a silent cluster, an offline node and agent-only alerts", () => {
    expect(topicTitles(guide.troubleshooting)).toEqual([
      'No cluster appears, or it shows as "Disconnected"',
      'A node shows as "Offline"',
      "Guest Down, HA or backup alerts never fire",
    ]);
    expect(
      topicTitled(guide.troubleshooting, 'A node shows as "Offline"').markdown,
    ).toContain("**Remove Node**");
  });

  test("a cluster's own tab says how to keep reporting into it", () => {
    const named: SetupGuideContent = guideFor("native-push", {
      clusterName: "pve-prod",
    });
    expect(
      topicTitled(named.advanced, "Which name the cluster registers under")
        .markdown,
    ).toContain("set `proxmox.cluster.name` to `pve-prod`");
    expect(
      topicTitled(guide.advanced, "Which name the cluster registers under")
        .markdown,
    ).not.toContain("This cluster is");
  });
});

describe("the metric server target", () => {
  const target: (url: string) => ProxmoxPushTarget = (
    url: string,
  ): ProxmoxPushTarget => {
    return getProxmoxPushTarget(url);
  };

  test("https on the default port", () => {
    expect(target("https://oneuptime.com")).toEqual({
      server: "oneuptime.com",
      port: "443",
      protocol: "https",
      path: "/otlp/v1/metrics",
    });
  });

  test("http on the default port", () => {
    expect(target("http://oneuptime.local")).toEqual({
      server: "oneuptime.local",
      port: "80",
      protocol: "http",
      path: "/otlp/v1/metrics",
    });
  });

  test("an explicit port, a path prefix and a trailing slash", () => {
    expect(target("HTTPS://example.com:8443/oneuptime/")).toEqual({
      server: "example.com",
      port: "8443",
      protocol: "https",
      path: "/oneuptime/otlp/v1/metrics",
    });
  });

  test("a URL the dashboard does not know yet", () => {
    expect(target(SETUP_GUIDE_URL_PLACEHOLDER)).toEqual({
      server: PROXMOX_PUSH_HOST_PLACEHOLDER,
      port: "443",
      protocol: "https",
      path: "/otlp/v1/metrics",
    });
  });
});

describe("the cluster name", () => {
  test("a product page suggests a name and says to replace it", () => {
    expect(installStep(guideFor("docker-compose"))).toContain(
      `Replace \`${PROXMOX_EXAMPLE_CLUSTER_NAME}\` with a name for this cluster`,
    );
  });

  test("a cluster's own tab writes its name into .env and says to keep it", () => {
    const guide: SetupGuideContent = guideFor("docker-compose", {
      clusterName: "pve-prod",
    });
    expect(envFileOf(guide)).toContain("PROXMOX_CLUSTER_NAME=pve-prod");
    expect(installStep(guide)).toContain(
      "This installs the agent for **`pve-prod`**",
    );
    expect(
      topicTitled(guide.troubleshooting, "Cluster appears under the wrong name")
        .markdown,
    ).toContain("This cluster is **`pve-prod`**.");
  });

  test("the install script is told to enter a known name exactly", () => {
    const install: string = installStep(
      guideFor("install-script", { clusterName: "pve-prod" }),
    );
    expect(install).toContain("enter **`pve-prod`** exactly");
    expect(install).not.toContain("PROXMOX_CLUSTER_NAME=");
  });

  test("a blank name counts as unknown", () => {
    expect(
      envFileOf(guideFor("docker-compose", { clusterName: " " })),
    ).toContain(`PROXMOX_CLUSTER_NAME=${PROXMOX_EXAMPLE_CLUSTER_NAME}`);
  });
});

describe("drift guards against agents/ProxmoxAgent", () => {
  test("the collector config is the shipped file, byte for byte", () => {
    expect(PROXMOX_AGENT_COLLECTOR_CONFIG).toBe(
      readAgentFile("otel-collector-config.yaml"),
    );
  });

  test("the scrape the guide describes is the config's", () => {
    const config: Record<string, any> = yaml.load(
      PROXMOX_AGENT_COLLECTOR_CONFIG,
    ) as Record<string, any>;
    const job: Record<string, any> =
      config["receivers"]["prometheus"]["config"]["scrape_configs"][0];
    expect(job["metrics_path"]).toBe("/pve");
    expect(job["scrape_interval"]).toBe("30s");
    expect(job["params"]["cluster"]).toEqual(["1"]);
    expect(job["params"]["node"]).toEqual(["1"]);
    expect(config["service"]["pipelines"]["metrics"]["processors"]).toContain(
      "transform/pve-identity",
    );
  });

  test("the environment table documents exactly what the collector and the bundled exporter read", () => {
    const expected: Set<string> = new Set([
      ...Array.from(composeVariables(PROXMOX_AGENT_CONTAINER).keys()),
      ...Array.from(composeVariables("pve-exporter").keys()),
      // Read by Docker Compose itself, to pick the bundled exporter.
      "COMPOSE_PROFILES",
    ]);
    for (const method of AGENT_METHODS) {
      expect(Array.from(envTableRows(guideFor(method)).keys()).sort()).toEqual(
        Array.from(expected).sort(),
      );
    }
  });

  test("the defaults the table gives are the compose file's", () => {
    const variables: Map<string, string | null> = new Map([
      ...Array.from(composeVariables(PROXMOX_AGENT_CONTAINER)),
      ...Array.from(composeVariables("pve-exporter")),
    ]);
    const rows: Map<string, { required: string; description: string }> =
      envTableRows(guideFor("docker-compose"));
    let checked: number = 0;
    for (const [name, row] of rows) {
      const stated: RegExpMatchArray | null =
        row.description.match(/\(default: `([^`]+)`/) ||
        row.description.match(/Defaults to the bundled exporter \(`([^`]+)`\)/);
      if (stated) {
        expect({ name, default: variables.get(name) }).toEqual({
          name,
          default: stated[1],
        });
        checked++;
      }
    }
    expect(checked).toBe(3);
  });

  test("the .env block sets only variables the agent reads", () => {
    const readable: Set<string> = new Set([
      ...Array.from(composeVariables(PROXMOX_AGENT_CONTAINER).keys()),
      ...Array.from(composeVariables("pve-exporter").keys()),
      "COMPOSE_PROFILES",
    ]);
    const names: Array<string> = envFileOf(guideFor("docker-compose"))
      .split("\n")
      .map((line: string): string => {
        return line.split("=")[0]!;
      });
    expect(names.length).toBe(7);
    for (const name of names) {
      expect(readable.has(name)).toBe(true);
    }
  });

  test("the bundled exporter is a compose profile and takes the token id as copied", () => {
    const compose: Record<string, any> = composeFile();
    expect(compose["services"]["pve-exporter"]["profiles"]).toEqual([
      "pve-exporter",
    ]);
    expect(compose["services"]["pve-exporter"]["container_name"]).toBe(
      PROXMOX_EXPORTER_CONTAINER,
    );
    // It splits user@realm!tokenname itself, so .env holds the id whole.
    expect(readAgentFile("docker-compose.yml")).toContain(
      'PVE_USER="$${PVE_API_TOKEN_ID%%!*}" PVE_TOKEN_NAME="$${PVE_API_TOKEN_ID##*!}"',
    );
  });

  /*
   * The agent reports the collector it pins (oneuptime.agent.version), so
   * the compose file must run exactly that collector - never :latest, which
   * would make the reported version a guess - and the journald wrapper the
   * guide builds runs the same one.
   */
  test("runs the pinned collector, and its config reports the pin", () => {
    const image: string =
      composeFile()["services"]["oneuptime-proxmox-agent"]["image"];
    expect(image).toBe(PROXMOX_AGENT_COLLECTOR_IMAGE);
    expect(image).not.toContain(":latest");
    const pin: string = image.split(":")[1] as string;
    expect(PROXMOX_AGENT_COLLECTOR_CONFIG).toContain(
      `      - key: oneuptime.agent.version\n        value: "${pin}"\n        action: upsert\n`,
    );
    const logs: string = topicTitled(
      guideFor("docker-compose").advanced,
      "Ship Proxmox service logs",
    ).markdown;
    expect(logs).toContain(`FROM ${PROXMOX_AGENT_COLLECTOR_IMAGE} AS otelcol`);
    expect(logs).not.toContain("contrib:latest");
  });

  test("the install script recreates the containers, so a re-run starts the new config", () => {
    expect(readAgentFile("install.sh")).toMatch(
      /^docker compose up -d --force-recreate$/m,
    );
  });

  test("the AI agent variables the guide names are the AI agent's", () => {
    const aiVariables: Map<string, string | null> = composeVariables(
      PROXMOX_AI_AGENT_CONTAINER,
    );
    const ai: string = topicTitled(
      guideFor("docker-compose").advanced,
      "OneUptime AI agent",
    ).markdown;
    const named: Array<string> = Array.from(
      ai.matchAll(/`([A-Z][A-Z0-9_]+)(?:=[^`]*)?`/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });
    expect(named.length).toBeGreaterThan(4);
    for (const name of named) {
      expect({ name, read: aiVariables.has(name) }).toEqual({
        name,
        read: true,
      });
    }
  });

  test("the install script writes every variable of the table to .env, quoted for Compose", () => {
    const script: string = readAgentFile("install.sh");
    const rows: Map<string, { required: string; description: string }> =
      envTableRows(guideFor("install-script"));
    expect(rows.size).toBeGreaterThan(5);
    for (const name of rows.keys()) {
      expect(script).toContain(`\n${name}=$(compose_env_quote "$${name}")\n`);
    }
  });

  test("the install script reuses an existing .env instead of asking again", () => {
    const script: string = readAgentFile("install.sh");
    expect(script).toContain("reusing it.");
    expect(script).toContain(
      'printf -v "$name" \'%s\' "$(dotenv_get "$name" "$ENV_FILE")"',
    );
  });

  test("the install script honours a preset URL and key, which prefilling relies on", () => {
    const script: string = readAgentFile("install.sh");
    for (const name of ["ONEUPTIME_URL", "ONEUPTIME_TELEMETRY_INGESTION_KEY"]) {
      expect(script).toMatch(
        new RegExp(`if \\[ -z "\\$${name}" \\]; then\\s*\\n\\s*read -rp`),
      );
    }
  });

  test("the install script installs where the guide says and asks what it says", () => {
    const script: string = readAgentFile("install.sh");
    expect(script).toContain(
      `INSTALL_DIR="\${INSTALL_DIR:-${PROXMOX_AGENT_INSTALL_DIR}}"`,
    );
    expect(script).toContain(`REPO_BASE="${PROXMOX_AGENT_RAW_URL}"`);
    expect(script).toContain("Run the bundled prometheus-pve-exporter? [Y/n]");
    expect(script).toContain('PVE_EXPORTER_URL="pve-exporter:9221"');
    expect(script).toContain("Proxmox VE API host");
    expect(script).toContain("Also let it apply fixes");
  });

  test("every file the guide downloads exists in the agent's directory", () => {
    const files: Set<string> = new Set();
    for (const method of METHOD_KEYS) {
      const markdown: string = getSetupGuideMarkdown(guideFor(method));
      for (const match of markdown.matchAll(
        /https:\/\/raw\.githubusercontent\.com\/OneUptime\/oneuptime\/master\/agents\/([A-Za-z]+)\/([A-Za-z0-9._-]+)/g,
      )) {
        expect(match[1]).toBe("ProxmoxAgent");
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
  });

  test("the containers the guide names are the compose file's", () => {
    const containers: Array<string> = Object.values(
      composeFile()["services"] as Record<string, Record<string, string>>,
    ).map((service: Record<string, string>): string => {
      return service["container_name"]!;
    });
    expect(containers.sort()).toEqual(
      [
        PROXMOX_AGENT_CONTAINER,
        PROXMOX_EXPORTER_CONTAINER,
        PROXMOX_AI_AGENT_CONTAINER,
      ].sort(),
    );
  });

  test("the lines the service-logs topic uncomments are in the shipped files", () => {
    const compose: string = readAgentFile("docker-compose.yml");
    expect(compose).toContain("# - /var/log/journal:/var/log/journal:ro");
    expect(compose).toContain("# - /etc/machine-id:/etc/machine-id:ro");
    expect(PROXMOX_AGENT_COLLECTOR_CONFIG).toContain("  # journald:\n");
    expect(PROXMOX_AGENT_COLLECTOR_CONFIG).toContain("    # logs:\n");
    for (const unit of [
      "pveproxy",
      "pvedaemon",
      "pve-firewall",
      "pve-ha-crm",
      "pve-ha-lrm",
      "pvescheduler",
      "pvestatd",
      "qmeventd",
    ]) {
      expect(PROXMOX_AGENT_COLLECTOR_CONFIG).toContain(`  #     - ${unit}\n`);
    }
  });

  test("the diagnostic script takes -d and defaults to the install directory", () => {
    const script: string = readAgentFile("troubleshoot.sh");
    expect(script).toContain('-d|--dir)      DIR="${2:-}"; shift 2 ;;');
    expect(script).toContain(`DIR="${PROXMOX_AGENT_INSTALL_DIR}"`);
  });
});
