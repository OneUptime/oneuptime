import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import markdownSlugify from "../../../Server/Types/MarkdownSlugify";
import {
  DEFAULT_VMWARE_INSTALL_METHOD,
  VMWARE_AGENT_COLLECTOR_CONFIG,
  VMWARE_AGENT_COMPOSE_FILE,
  VMWARE_AGENT_CONTAINER,
  VMWARE_AGENT_INSTALL_DIR,
  VMWARE_AGENT_RAW_URL,
  VMWARE_AGENT_SOURCE_URL,
  VMWARE_AI_AGENT_CONTAINER,
  VMWARE_EXAMPLE_VCENTER_NAME,
  VMWARE_INSTALL_METHODS,
  VMWARE_AGENT_RECREATE_COMMAND,
  VMwareInstallMethod,
  getVMwareAgentDownloadCommand,
  getVMwareAgentUpgradeCommand,
  getVMwareEnvFile,
  getVMwareInstallScriptCommand,
  getVMwareSetupGuide,
  resolveVMwareInstallMethod,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Utils/DocumentationMarkdown";
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
 * The VMware agent guide asks how to install the agent — the install script
 * or Docker Compose — and shows only that path. These tests pin, for both:
 *
 *   - the reader's URL and key in every command and file that needs them,
 *     and never a placeholder key in the install script's environment (the
 *     script would write it into .env as the key);
 *   - the read-only vSphere user, propagated from the vCenter root (without
 *     propagation the inventory is silently empty);
 *   - the .env quoting rule Docker Compose actually applies — vSphere
 *     passwords routinely contain `$` and `#`;
 *   - that the compose file and collector config the guide shows ARE the
 *     shipped files, and every variable, file, container and script it
 *     names exists in agents/VMwareAgent.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const AGENT_DIR: string = path.join(REPO_ROOT, "agents", "VMwareAgent");
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

const METHOD_KEYS: Array<VMwareInstallMethod> = VMWARE_INSTALL_METHODS.map(
  (option: SetupGuideOption<VMwareInstallMethod>): VMwareInstallMethod => {
    return option.key;
  },
);

interface GuideOverrides {
  oneuptimeUrl?: string;
  apiKey?: string;
  hasApiKey?: boolean;
  vcenterName?: string;
}

const guideFor: (
  method: VMwareInstallMethod,
  overrides?: GuideOverrides,
) => SetupGuideContent = (
  method: VMwareInstallMethod,
  overrides?: GuideOverrides,
): SetupGuideContent => {
  const apiKey: string = overrides?.apiKey ?? KEY;
  return getVMwareSetupGuide({
    oneuptimeUrl: overrides?.oneuptimeUrl ?? URL,
    apiKey: apiKey,
    hasApiKey:
      overrides?.hasApiKey ?? apiKey !== SETUP_GUIDE_API_KEY_PLACEHOLDER,
    method: method,
    vcenterName: overrides?.vcenterName,
  });
};

const noKeyGuideFor: (method: VMwareInstallMethod) => SetupGuideContent = (
  method: VMwareInstallMethod,
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

describe("the install method picker", () => {
  test("offers the install script first, then Docker Compose", () => {
    expect(METHOD_KEYS).toEqual(["install-script", "docker-compose"]);
    expect(DEFAULT_VMWARE_INSTALL_METHOD).toBe("install-script");
    expect(
      VMWARE_INSTALL_METHODS.map(
        (option: SetupGuideOption<VMwareInstallMethod>): string => {
          return option.label;
        },
      ),
    ).toEqual(["Install script", "Docker Compose"]);
  });

  test("recommends only the install script", () => {
    expect(VMWARE_INSTALL_METHODS[0]!.badge).toBe("Recommended");
    expect(VMWARE_INSTALL_METHODS[1]!.badge).toBeUndefined();
  });

  test("every method has a one-line description", () => {
    for (const option of VMWARE_INSTALL_METHODS) {
      expect((option.description || "").length).toBeGreaterThan(0);
      expect(option.description).not.toContain("\n");
    }
    // The E2E specs pick the other option by /^Docker Compose/.
    expect(VMWARE_INSTALL_METHODS[0]!.description).not.toContain(
      "Docker Compose",
    );
  });

  test("an unknown or missing method resolves to the install script", () => {
    for (const value of [undefined, null, "", "ova", "Docker Compose"]) {
      expect(resolveVMwareInstallMethod(value)).toBe("install-script");
    }
    expect(resolveVMwareInstallMethod("docker-compose")).toBe("docker-compose");
  });
});

describe.each(METHOD_KEYS)("the %s guide", (method: VMwareInstallMethod) => {
  const guide: SetupGuideContent = guideFor(method);
  const markdown: string = getSetupGuideMarkdown(guide);

  test("is three steps after the key: read-only user, install, verify", () => {
    expect(
      guide.steps.map((step: SetupGuideStep): string => {
        return step.title;
      }),
    ).toEqual([
      "Create a read-only vSphere user",
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

  test("lists what must be in place first", () => {
    const prerequisites: string = (guide.prerequisites || []).join("\n");
    expect(guide.prerequisites!.length).toBeGreaterThanOrEqual(2);
    expect(guide.prerequisites!.length).toBeLessThanOrEqual(4);
    expect(prerequisites).toContain("Docker Engine 20.10+");
    expect(prerequisites).toContain("TCP 443");
    expect(prerequisites).toContain("**7.0 or later**");
    expect(prerequisites).toContain("One agent per vCenter Server");
  });

  test("the user step offers the vSphere Client, govc and a standalone host as tabs", () => {
    const user: SetupGuideStep = stepTitled(
      guide,
      "Create a read-only vSphere user",
    );
    expect(
      (user.variants || []).map((variant: SetupGuideStepVariant): string => {
        return variant.label;
      }),
    ).toEqual(["vSphere Client", "govc", "Standalone ESXi"]);
  });

  test("the verify step checks the collector and waits for one collection", () => {
    const verify: string =
      stepTitled(guide, "Verify the installation").markdown || "";
    expect(verify).toContain("docker compose ps");
    expect(verify).toContain(
      `docker compose logs -f ${VMWARE_AGENT_CONTAINER}`,
    );
    expect(verify).toContain(
      "Everything is ready. Begin running and processing data.",
    );
    expect(verify).toContain(
      "nothing is sent until the first full inventory walk completes",
    );
    expect(verify).toContain(VMWARE_AI_AGENT_CONTAINER);
    expect(verify.includes(`cd ${VMWARE_AGENT_INSTALL_DIR}`)).toBe(
      method === "install-script",
    );
  });

  test("keeps configuration options out of the first-run steps", () => {
    const steps: string = stepsText(guide);
    for (const advanced of [
      "syslog",
      "oneuptime.label.",
      "docker compose pull",
      "docker compose down",
      "max_query_metrics",
      "send_batch_size",
    ]) {
      expect(steps).not.toContain(advanced);
    }
  });

  test("has Advanced topics for settings, files, data, power state, syslog, labels, AI and upgrades", () => {
    expect(topicTitles(guide.advanced)).toEqual([
      "Environment variables",
      "The agent's configuration files",
      "What the agent collects",
      "How VM power state is worked out",
      "Ship ESXi syslog",
      "Tag the vCenter with project labels",
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
      'vCenter shows as "Disconnected"',
      "No vCenter appears, or no metrics",
      "vCenter rejects the login",
      "x509 or other TLS errors",
      "Hosts appear but no VMs, datastores or clusters",
      "Every VM shows as powered off",
      "Collections are slow on a large inventory",
      "vCenter appears under the wrong name",
    ]);
  });

  test("the diagnostic script is the agent's own, run against this install", () => {
    const script: string = topicTitled(
      guide.troubleshooting,
      "Run the diagnostic script first",
    ).markdown;
    expect(script).toContain(
      `curl -sSL ${VMWARE_AGENT_RAW_URL}/troubleshoot.sh -o troubleshoot.sh`,
    );
    if (method === "install-script") {
      expect(script).toContain("\nbash troubleshoot.sh\n");
    } else {
      expect(script).toContain('bash troubleshoot.sh -d "$PWD"');
    }
  });

  test("tests reachability from the agent's own network namespace", () => {
    expect(
      topicTitled(guide.troubleshooting, "No vCenter appears, or no metrics")
        .markdown,
    ).toContain(
      codeBlock(
        "bash",
        `docker run --rm --network container:${VMWARE_AGENT_CONTAINER} curlimages/curl -sk https://<vcenter-host>/sdk/vimServiceVersions.xml`,
      ),
    );
  });

  test("gives the Docker Compose .env quoting rule", () => {
    const login: string = topicTitled(
      guide.troubleshooting,
      "vCenter rejects the login",
    ).markdown;
    expect(login).toContain(
      "a password containing `$`, `#`, spaces or quotes must be **single-quoted**",
    );
    expect(login).toContain("`VCENTER_PASSWORD='p@ss$word'`");
    expect(login).toContain("every `$` written as `$$`");
    // One backslash, as the reader types it.
    expect(login).toContain('`"` / `\\` escaped with a backslash');
    expect(login).toContain("`DOMAIN\\user`");
    expect(markdown).not.toContain("DOMAIN\\\\user");
  });

  test("the environment table carries the reader's URL and the quoting rule", () => {
    const table: string = topicTitled(
      guide.advanced,
      "Environment variables",
    ).markdown;
    expect(table).toContain(`(e.g. \`${URL}\`)`);
    expect(table).toContain("single-quote it in `.env`");
  });

  test("shows the shipped compose file and collector config verbatim", () => {
    const files: string = topicTitled(
      guide.advanced,
      "The agent's configuration files",
    ).markdown;
    expect(files).toContain(codeBlock("yaml", VMWARE_AGENT_COMPOSE_FILE));
    expect(files).toContain(codeBlock("yaml", VMWARE_AGENT_COLLECTOR_CONFIG));
  });

  test("commands in the agent's folder run where this method installs it", () => {
    const composeCommand: RegExp = /^docker compose /m;
    let checked: number = 0;
    for (const block of getSetupGuideCodeBlocks({
      steps: [],
      advanced: guide.advanced,
    })) {
      if (composeCommand.test(block)) {
        expect(block.startsWith(`cd ${VMWARE_AGENT_INSTALL_DIR}\n`)).toBe(
          method === "install-script",
        );
        checked++;
      }
    }
    // Syslog, labels and uninstall, plus the pull and recreate of a Compose upgrade.
    expect(checked).toBeGreaterThanOrEqual(
      method === "install-script" ? 3 : 4,
    );
    if (method === "docker-compose") {
      expect(markdown).not.toContain(VMWARE_AGENT_INSTALL_DIR);
    }
  });

  test("the AI agent topic stays read-only and protects the vCenter appliance", () => {
    const ai: string = topicTitled(
      guide.advanced,
      "OneUptime AI agent",
    ).markdown;
    expect(ai).toContain("ONEUPTIME_AI_ALLOW_WRITES=true");
    expect(ai).toContain(
      "`ONEUPTIME_AI_VCENTER_USERNAME` / `ONEUPTIME_AI_VCENTER_PASSWORD`",
    );
    expect(ai).toContain("`ONEUPTIME_AI_PROTECTED_TARGETS`");
    expect(ai).toContain(
      `docker exec ${VMWARE_AI_AGENT_CONTAINER} wget -qO- http://127.0.0.1:3877/status`,
    );
    expect(ai).toContain("(/docs/ai/infrastructure-ai-agents#vmware-vcenter)");
  });

  /*
   * The collector image is pinned in docker-compose.yml and the config
   * stamps the pin as the agent's version, so pulling alone never moves the
   * agent forward. The install script reuses the .env it finds, so running
   * it again is the upgrade; a Compose install downloads both files again
   * and recreates the agent. The dialog beside an outdated version shows
   * the same blocks (AgentUpgradeGuides.test.ts).
   */
  test("the upgrade topic refreshes the pinned files the way this method can", () => {
    const upgrade: string = topicTitled(
      guide.advanced,
      "Upgrade or uninstall the agent",
    ).markdown;
    if (method === "install-script") {
      expect(upgrade).toContain("re-run the install script");
      expect(upgrade).toContain(
        codeBlock("bash", getVMwareAgentUpgradeCommand()),
      );
      expect(upgrade).toContain("reuses every value in your existing `.env`");
      expect(upgrade).not.toContain("curl -fsSLO");
    } else {
      expect(upgrade).toContain(
        "Download `docker-compose.yml` and `otel-collector-config.yaml` again",
      );
      expect(upgrade).toContain(
        codeBlock("bash", getVMwareAgentDownloadCommand()),
      );
      expect(upgrade).toContain(codeBlock("bash", VMWARE_AGENT_RECREATE_COMMAND));
      expect(
        upgrade.indexOf(getVMwareAgentDownloadCommand()),
      ).toBeLessThan(upgrade.indexOf(VMWARE_AGENT_RECREATE_COMMAND));
      expect(upgrade).toContain("pulling alone does not move the agent forward");
      expect(upgrade).not.toContain("install script");
    }
    expect(upgrade).toContain("**Agent Version**");
  });

  test("links to the VMware agent and monitor documentation", () => {
    expect(guide.links).toEqual([
      { title: "VMware agent documentation", url: "/docs/telemetry/vmware" },
      {
        title: "VMware monitors and alerts",
        url: "/docs/monitor/vmware-monitor",
      },
    ]);
  });

  test("every documentation link points at a page, and anchor, that exists", () => {
    const links: Array<string> = Array.from(
      markdown.matchAll(/\]\((\/docs\/[^)\s]+)\)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });
    expect(links.length).toBeGreaterThanOrEqual(3);
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

describe("the read-only vSphere user", () => {
  const user: SetupGuideStep = stepTitled(
    guideFor("install-script"),
    "Create a read-only vSphere user",
  );

  test("the vSphere Client tab grants Read-Only on the vCenter root, propagated", () => {
    const client: string = variantTitled(user, "vSphere Client").markdown;
    expect(client).toContain(
      "*Menu → Administration → Single Sign On → Users and Groups*",
    );
    expect(client).toContain("`oneuptime@vsphere.local`");
    expect(client).toContain("set the role to **Read-Only**");
    expect(client).toContain("tick **Propagate to children**");
    expect(client).toContain("Propagation is the part people miss.");
  });

  test("the govc tab creates the user and propagates the role from /", () => {
    expect(variantTitled(user, "govc").markdown).toContain(
      codeBlock(
        "bash",
        [
          "govc sso.user.create -p 'a-strong-password' -R ReadOnly oneuptime",
          "govc permissions.set -principal oneuptime@vsphere.local -role ReadOnly -propagate=true /",
        ].join("\n"),
      ),
    );
  });

  test("the standalone ESXi tab uses the Host Client and the host as the endpoint", () => {
    const esxi: string = variantTitled(user, "Standalone ESXi").markdown;
    expect(esxi).toContain(
      "*Host → Manage → Security & Users → Users* in the ESXi Host Client",
    );
    expect(esxi).toContain("*Host → Manage → Security & Users → Permissions*");
    expect(esxi).toContain("`https://esxi01.example.com`");
  });
});

describe("the install script", () => {
  test("carries the reader's URL and key on the command line", () => {
    expect(
      getVMwareInstallScriptCommand({
        oneuptimeUrl: URL,
        apiKey: KEY,
        hasApiKey: true,
      }),
    ).toBe(
      [
        "curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/VMwareAgent/install.sh -o install.sh",
        `ONEUPTIME_URL=${URL} ONEUPTIME_TELEMETRY_INGESTION_KEY=${KEY} bash install.sh`,
      ].join("\n"),
    );
    expect(installStep(guideFor("install-script"))).toContain(
      codeBlock(
        "bash",
        getVMwareInstallScriptCommand({
          oneuptimeUrl: URL,
          apiKey: KEY,
          hasApiKey: true,
        }),
      ),
    );
  });

  test("quotes values the shell would otherwise change", () => {
    expect(
      getVMwareInstallScriptCommand({
        oneuptimeUrl: URL,
        apiKey: "a$b",
        hasApiKey: true,
      }),
    ).toContain("ONEUPTIME_TELEMETRY_INGESTION_KEY='a$b' bash install.sh");
  });

  test("never puts the placeholder key into the script's environment", () => {
    for (const hasApiKey of [false, true]) {
      const command: string = getVMwareInstallScriptCommand({
        oneuptimeUrl: URL,
        apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
        hasApiKey: hasApiKey,
      });
      expect(command).not.toContain("ONEUPTIME_");
      expect(command.split("\n")[1]).toBe("bash install.sh");
    }
  });

  test("leaves the URL to the prompt while the dashboard does not know it", () => {
    const command: string = getVMwareInstallScriptCommand({
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

  test("says what the script asks for, where it installs, and how it quotes", () => {
    const install: string = installStep(guideFor("install-script"));
    expect(install).toContain(
      "The command already carries your OneUptime URL and ingestion key.",
    );
    for (const prompt of [
      "**vCenter name**",
      "**vCenter endpoint**",
      "**The read-only user and its password**",
      "**TLS verification**",
      "**collection interval**",
      "**OneUptime AI agent**",
    ]) {
      expect(install).toContain(prompt);
    }
    expect(install).toContain(
      `It installs to \`${VMWARE_AGENT_INSTALL_DIR}\`, writes a \`0600\` \`.env\` file`,
    );
    expect(install).toContain(
      "a password containing `$`, `#`, spaces or quotes works exactly as typed",
    );
    expect(install).toContain(
      "re-running the script reuses everything in an existing `.env`",
    );
  });

  test("shows none of the Docker Compose instructions", () => {
    const guide: SetupGuideContent = guideFor("install-script");
    const markdown: string = getSetupGuideMarkdown(guide);
    expect(markdown).not.toContain("curl -fsSLO");
    expect(markdown).not.toContain("mkdir oneuptime-vmware-agent");
    expect(markdown).not.toContain("chmod 600 .env");
    expect(() => {
      return envFileOf(guide);
    }).toThrow("The guide has no .env block");
  });
});

describe("the Docker Compose install", () => {
  const guide: SetupGuideContent = guideFor("docker-compose");
  const install: string = installStep(guide);

  test("downloads the two files, writes .env, makes it private, then starts the agent", () => {
    const download: number = install.indexOf(
      `curl -fsSLO ${VMWARE_AGENT_RAW_URL}/docker-compose.yml`,
    );
    const config: number = install.indexOf(
      `curl -fsSLO ${VMWARE_AGENT_RAW_URL}/otel-collector-config.yaml`,
    );
    const env: number = install.indexOf("ONEUPTIME_URL=");
    const start: number = install.indexOf(
      codeBlock("bash", "chmod 600 .env\ndocker compose up -d"),
    );
    expect(download).toBeGreaterThan(-1);
    expect(config).toBeGreaterThan(download);
    expect(env).toBeGreaterThan(config);
    expect(start).toBeGreaterThan(env);
    expect(install).toContain(
      `[VMwareAgent directory](${VMWARE_AGENT_SOURCE_URL})`,
    );
  });

  test("the .env file carries the reader's URL and key, and a single-quoted password", () => {
    const expected: string = [
      `ONEUPTIME_URL=${URL}`,
      `ONEUPTIME_TELEMETRY_INGESTION_KEY=${KEY}`,
      `VMWARE_VCENTER_NAME=${VMWARE_EXAMPLE_VCENTER_NAME}`,
      "VCENTER_ENDPOINT=https://vcsa.example.com",
      "VCENTER_USERNAME=oneuptime@vsphere.local",
      "VCENTER_PASSWORD='a-strong-password'",
      "VCENTER_INSECURE_SKIP_VERIFY=true",
      "VCENTER_COLLECTION_INTERVAL=2m",
    ].join("\n");
    expect(envFileOf(guide)).toBe(expected);
    expect(
      getVMwareEnvFile({
        oneuptimeUrl: URL,
        apiKey: KEY,
        vcenterName: VMWARE_EXAMPLE_VCENTER_NAME,
      }),
    ).toBe(expected);
    expect(install).toContain("Keep the password in single quotes");
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
    // The shipped compose file, shown verbatim, mentions install.sh itself.
    const prose: string = getSetupGuideMarkdown({
      ...guide,
      advanced: (guide.advanced || []).filter(
        (topic: SetupGuideTopic): boolean => {
          return topic.title !== "The agent's configuration files";
        },
      ),
    });
    expect(prose).not.toContain("install.sh");
    expect(prose).not.toContain("install script");
    expect(getSetupGuideMarkdown(guide)).not.toContain(
      VMWARE_AGENT_INSTALL_DIR,
    );
  });

  test("renders what the skipped E2E spec reads off the page", () => {
    /*
     * VMwareProduct.spec.ts picks Docker Compose after creating a key, then
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
    expect(withKey).toContain("VMWARE_VCENTER_NAME=my-vcenter");
    expect(withKey).toContain("docker compose up -d");
    expect(withKey).not.toContain("<YOUR_API_KEY>");
    expect(
      withKey.match(
        /ONEUPTIME_TELEMETRY_INGESTION_KEY=([0-9a-fA-F-]{36})/,
      )?.[1],
    ).toBe(UUID_KEY);

    const byDefault: string = getSetupGuideMarkdown(
      guideFor(DEFAULT_VMWARE_INSTALL_METHOD, {
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

describe("the vCenter name", () => {
  test("a product page suggests a name and says to replace it", () => {
    expect(installStep(guideFor("docker-compose"))).toContain(
      `Replace \`${VMWARE_EXAMPLE_VCENTER_NAME}\` with a name for this vCenter`,
    );
  });

  test("a vCenter's own tab writes its name into .env and says to keep it", () => {
    const guide: SetupGuideContent = guideFor("docker-compose", {
      vcenterName: "vcenter-prod",
    });
    expect(envFileOf(guide)).toContain("VMWARE_VCENTER_NAME=vcenter-prod");
    expect(installStep(guide)).toContain(
      "This installs the agent for **`vcenter-prod`**",
    );
    expect(installStep(guide)).not.toContain("Replace `");
    expect(
      topicTitled(guide.troubleshooting, "vCenter appears under the wrong name")
        .markdown,
    ).toContain("This vCenter is **`vcenter-prod`**.");
  });

  test("the install script is told to enter a known name exactly", () => {
    const install: string = installStep(
      guideFor("install-script", { vcenterName: "vcenter-prod" }),
    );
    expect(install).toContain("enter **`vcenter-prod`** exactly");
    expect(install).not.toContain("VMWARE_VCENTER_NAME=");
  });

  test("a name the .env file would misread is quoted, and a blank one is unknown", () => {
    expect(
      envFileOf(guideFor("docker-compose", { vcenterName: "prod $vc" })),
    ).toContain("VMWARE_VCENTER_NAME='prod $vc'");
    expect(
      envFileOf(guideFor("docker-compose", { vcenterName: "   " })),
    ).toContain(`VMWARE_VCENTER_NAME=${VMWARE_EXAMPLE_VCENTER_NAME}`);
  });
});

describe("drift guards against agents/VMwareAgent", () => {
  test("the compose file is the shipped file, byte for byte", () => {
    expect(VMWARE_AGENT_COMPOSE_FILE).toBe(readAgentFile("docker-compose.yml"));
  });

  test("the collector config is the shipped file, byte for byte", () => {
    expect(VMWARE_AGENT_COLLECTOR_CONFIG).toBe(
      readAgentFile("otel-collector-config.yaml"),
    );
  });

  test("the batch settings the guide explains are the config's", () => {
    const config: Record<string, any> = yaml.load(
      VMWARE_AGENT_COLLECTOR_CONFIG,
    ) as Record<string, any>;
    expect(config["processors"]["batch"]["send_batch_size"]).toBe(8192);
    expect(
      config["processors"]["batch"]["send_batch_max_size"],
    ).toBeUndefined();
    expect(config["receivers"]["vcenter"]["max_query_metrics"]).toBe(256);
    expect(config["processors"]["memory_limiter"]["limit_mib"]).toBe(512);
    expect(config["processors"]["resource"]["attributes"][0]).toEqual({
      key: "vmware.vcenter.name",
      value: "${env:VMWARE_VCENTER_NAME}",
      action: "upsert",
    });
  });

  test("the environment table documents exactly what the collector reads", () => {
    const collector: Map<string, string | null> = composeVariables(
      VMWARE_AGENT_CONTAINER,
    );
    for (const method of METHOD_KEYS) {
      expect(Array.from(envTableRows(guideFor(method)).keys()).sort()).toEqual(
        Array.from(collector.keys()).sort(),
      );
    }
  });

  test("the defaults the table gives are the compose file's", () => {
    const collector: Map<string, string | null> = composeVariables(
      VMWARE_AGENT_CONTAINER,
    );
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
    expect(checked).toBe(3);
  });

  test("the .env block sets exactly the variables the collector reads", () => {
    const names: Array<string> = envFileOf(guideFor("docker-compose"))
      .split("\n")
      .map((line: string): string => {
        return line.split("=")[0]!;
      });
    expect(names.sort()).toEqual(
      Array.from(composeVariables(VMWARE_AGENT_CONTAINER).keys()).sort(),
    );
  });

  test("the AI agent variables the guide names are the AI agent's", () => {
    const aiVariables: Map<string, string | null> = composeVariables(
      VMWARE_AI_AGENT_CONTAINER,
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
    for (const name of Array.from(
      envTableRows(guideFor("install-script")).keys(),
    )) {
      expect(script).toMatch(new RegExp(`^${name}=`, "m"));
    }
    expect(script).toContain(
      'VCENTER_PASSWORD=$(compose_env_quote "$VCENTER_PASSWORD")',
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

  /*
   * A re-run is the upgrade, and a new config file alone does not make
   * Compose recreate a running container: the script forces it, so the
   * collector starts on the new config and reports its new version.
   */
  test("the install script recreates the containers it starts", () => {
    expect(readAgentFile("install.sh")).toMatch(
      /^docker compose up -d --force-recreate$/m,
    );
  });

  test("the config reports the pin the compose file runs", () => {
    const image: string = composeFile()["services"]["oneuptime-vmware-agent"][
      "image"
    ];
    expect(image).toMatch(/^otel\/opentelemetry-collector-contrib:\d+\.\d+\.\d+$/);
    const pin: string = image.split(":")[1] as string;
    expect(VMWARE_AGENT_COLLECTOR_CONFIG).toContain(
      `      - key: oneuptime.agent.version\n        value: "${pin}"\n        action: upsert\n`,
    );
  });

  test("the install script installs where the guide says and asks what it says", () => {
    const script: string = readAgentFile("install.sh");
    expect(script).toContain(
      `INSTALL_DIR="\${INSTALL_DIR:-${VMWARE_AGENT_INSTALL_DIR}}"`,
    );
    expect(script).toContain(`REPO_BASE="${VMWARE_AGENT_RAW_URL}"`);
    expect(script).toContain('read -rsp "vSphere password: "');
    expect(script).toContain("Skip TLS certificate verification for vCenter?");
    expect(script).toContain("Collection interval");
    expect(script).toContain("Also let it apply fixes");
    expect(script).toContain('chmod 600 "$ENV_FILE"');
    expect(script).toContain("reusing it.");
  });

  test("every file the guide downloads exists in the agent's directory", () => {
    const files: Set<string> = new Set();
    for (const method of METHOD_KEYS) {
      const markdown: string = getSetupGuideMarkdown(guideFor(method));
      for (const match of markdown.matchAll(
        /https:\/\/raw\.githubusercontent\.com\/OneUptime\/oneuptime\/master\/agents\/([A-Za-z]+)\/([A-Za-z0-9._-]+)/g,
      )) {
        expect(match[1]).toBe("VMwareAgent");
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
      [VMWARE_AGENT_CONTAINER, VMWARE_AI_AGENT_CONTAINER].sort(),
    );
  });

  test("the lines the syslog topic uncomments are in the shipped files", () => {
    expect(VMWARE_AGENT_COMPOSE_FILE).toContain("    # ports:\n");
    expect(VMWARE_AGENT_COMPOSE_FILE).toContain('    #   - "5514:5514/udp"\n');
    expect(VMWARE_AGENT_COLLECTOR_CONFIG).toContain("  # syslog/tcp:\n");
    expect(VMWARE_AGENT_COLLECTOR_CONFIG).toContain("  # syslog/udp:\n");
    expect(VMWARE_AGENT_COLLECTOR_CONFIG).toContain("    # logs:\n");
  });

  test("the diagnostic script takes -d and defaults to the install directory", () => {
    const script: string = readAgentFile("troubleshoot.sh");
    expect(script).toContain('-d|--dir)      DIR="${2:-}"; shift 2 ;;');
    expect(script).toContain(`DIR="${VMWARE_AGENT_INSTALL_DIR}"`);
  });
});
