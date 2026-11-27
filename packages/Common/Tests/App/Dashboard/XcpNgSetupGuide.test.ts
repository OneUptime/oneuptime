import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import markdownSlugify from "../../../Server/Types/MarkdownSlugify";
import {
  DEFAULT_XCP_NG_CONNECT_METHOD,
  XCP_NG_AGENT_CA_FILE,
  XCP_NG_AGENT_CONTAINER,
  XCP_NG_AGENT_INSTALL_DIR,
  XCP_NG_AGENT_INSTALL_NAME,
  XCP_NG_AGENT_RECREATE_COMMAND,
  XCP_NG_CONNECT_METHODS,
  XCP_NG_EXAMPLE_XO_ADDRESS,
  XCP_NG_MINIMUM_XEN_ORCHESTRA_VERSION,
  XCP_NG_OPENMETRICS_PATH,
  XCP_NG_PLUGIN_SETTINGS,
  XcpNgConnectMethod,
  getXcpNgAgentDownloadCommand,
  getXcpNgAgentUpgradeCommand,
  getXcpNgInstallScriptCommand,
  getXcpNgSetupGuide,
  resolveXcpNgConnectMethod,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/XcpNg/Utils/DocumentationMarkdown";
import { XCP_NG_AGENT_VERSION } from "../../../../App/FeatureSet/Dashboard/src/Components/AgentVersion/AgentKind";
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
import { INSTALL_SCRIPT_READ_FIRST_NOTE } from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/AgentInstallCommands";
import {
  InstallScriptEntry,
  InstallScriptName,
  getInstallScriptEntry,
} from "../../../Types/InstallScripts/InstallScripts";

/*
 * The XCP-ng guide (#10995) asks how to install the OneUptime XCP-ng Agent -
 * the install script or Docker Compose - and shows only that path. One
 * agent reads one Xen Orchestra, and every pool it manages registers itself,
 * so the guide asks for no pool name. These tests pin:
 *
 *   - the reader's URL and key in the install script's command only once a
 *     real key is picked (the script would write a placeholder into .env as
 *     the key), and the Xen Orchestra's name only when the guide knows it,
 *     quoted for the shell;
 *   - that Xen Orchestra's certificate is always checked: the guide never
 *     offers a way to skip the check, and says what the agent can trust;
 *   - the upgrade, download and recreate commands, here and beside an
 *     outdated agent version;
 *   - that every variable, file, container and script the guide names is
 *     agents/XcpNgAgent's, and every variable docker-compose.yml reads is in
 *     the guide's table and, unless the file defaults it, in its .env.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const AGENT_DIR: string = path.join(REPO_ROOT, "agents", "XcpNgAgent");
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

/*
 * Where this OneUptime serves the agent's install script and files, for its
 * own release: never GitHub.
 */
const SERVED: string = `${URL}/install/xcp-ng-agent`;

// An address of this OneUptime's XCP-ng agent files: the script, or one file.
const SERVED_FILE_PATTERN: RegExp =
  /https:\/\/oneuptime\.example\.com\/install\/xcp-ng-agent(?:\/([A-Za-z0-9._/-]+))?/g;

// The names a pool's own Documentation tab can name its Xen Orchestra with.
const XO_NAMES: Array<string> = ["xo-paris", "Prod XO 01", "Bob's XO"];

/*
 * A word that would turn the certificate check off, or a flag that does: no
 * way through the guide may offer one, as the agent has none (#10995).
 */
const SKIPS_THE_CHECK: RegExp =
  /insecure|skip[\s_-]*verif|no[\s_-]*verify|verify\s*=\s*false|tls_?skip|disable[\s_-]*(?:tls|ssl|verif)|curl\s+-\w*k\b|curl\s+(?:\S+\s+)*--insecure|wget\s+(?:\S+\s+)*--no-check-certificate/i;

const METHOD_KEYS: Array<XcpNgConnectMethod> = XCP_NG_CONNECT_METHODS.map(
  (option: SetupGuideOption<XcpNgConnectMethod>): XcpNgConnectMethod => {
    return option.key;
  },
);

interface GuideOverrides {
  oneuptimeUrl?: string;
  apiKey?: string;
  hasApiKey?: boolean;
  xenOrchestraName?: string;
}

const guideFor: (
  method: XcpNgConnectMethod,
  overrides?: GuideOverrides,
) => SetupGuideContent = (
  method: XcpNgConnectMethod,
  overrides?: GuideOverrides,
): SetupGuideContent => {
  const apiKey: string = overrides?.apiKey ?? KEY;
  return getXcpNgSetupGuide({
    oneuptimeUrl: overrides?.oneuptimeUrl ?? URL,
    apiKey: apiKey,
    hasApiKey:
      overrides?.hasApiKey ?? apiKey !== SETUP_GUIDE_API_KEY_PLACEHOLDER,
    method: method,
    xenOrchestraName: overrides?.xenOrchestraName,
  });
};

const noKeyGuideFor: (
  method: XcpNgConnectMethod,
  overrides?: GuideOverrides,
) => SetupGuideContent = (
  method: XcpNgConnectMethod,
  overrides?: GuideOverrides,
): SetupGuideContent => {
  return guideFor(method, {
    ...overrides,
    apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
    hasApiKey: false,
  });
};

// Every guide a reader can meet: each method, before and after a key, for each Xen Orchestra.
const everyGuide: () => Array<{
  label: string;
  guide: SetupGuideContent;
}> = (): Array<{ label: string; guide: SetupGuideContent }> => {
  const guides: Array<{ label: string; guide: SetupGuideContent }> = [];
  for (const method of METHOD_KEYS) {
    for (const name of [undefined, ...XO_NAMES]) {
      for (const hasKey of [true, false]) {
        const overrides: GuideOverrides = name
          ? { xenOrchestraName: name }
          : {};
        guides.push({
          label: `${method}, ${hasKey ? "with a key" : "before a key"}, ${name || "a new Xen Orchestra"}`,
          guide: hasKey
            ? guideFor(method, overrides)
            : noKeyGuideFor(method, {
                ...overrides,
                oneuptimeUrl: SETUP_GUIDE_URL_PLACEHOLDER,
              }),
        });
      }
    }
  }
  return guides;
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

// The install step's text: its command, then what follows the note under it.
const installStep: (guide: SetupGuideContent) => string = (
  guide: SetupGuideContent,
): string => {
  const step: SetupGuideStep = stepTitled(guide, "Install the agent");
  return [step.markdown || "", step.details || ""].join("\n\n");
};

// Every step's text, without the Advanced and Troubleshooting topics.
const stepsText: (guide: SetupGuideContent) => string = (
  guide: SetupGuideContent,
): string => {
  return guide.steps
    .map((step: SetupGuideStep): string => {
      return [step.description || "", step.markdown || "", step.details || ""]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
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

// The names an .env block sets, in its order.
const envNamesOf: (block: string) => Array<string> = (
  block: string,
): Array<string> => {
  return block.split("\n").map((line: string): string => {
    return line.split("=")[0]!;
  });
};

const readAgentFile: (name: string) => string = (name: string): string => {
  return fs.readFileSync(path.join(AGENT_DIR, name), "utf8");
};

const composeFile: () => Record<string, any> = (): Record<string, any> => {
  return yaml.load(readAgentFile("docker-compose.yml")) as Record<string, any>;
};

/*
 * Variables the compose file's services read from .env: `${NAME}` and
 * `${NAME:-x}` - the collector's, and the XCP-ng AI agent's (#10998), which
 * read the ones they share with the same default.
 */
const composeVariables: () => Map<string, string | null> = (): Map<
  string,
  string | null
> => {
  const variables: Map<string, string | null> = new Map();
  for (const service of Object.values(
    composeFile()["services"] as Record<string, { environment: Array<string> }>,
  )) {
    for (const entry of service.environment) {
      // The outer reference of `${XO_NAME:-${XO_ADDRESS:-}}` is XO_NAME.
      const match: RegExpMatchArray | null = entry.match(
        /^[A-Z0-9_]+=\$\{([A-Z0-9_]+)(?::-(.*))?\}$/,
      );
      if (match) {
        const fallback: string | null = match[2] ?? null;
        if (variables.has(match[1]!)) {
          expect({ name: match[1], fallback }).toEqual({
            name: match[1],
            fallback: variables.get(match[1]!),
          });
        }
        variables.set(match[1]!, fallback);
      }
    }
  }
  return variables;
};

// The variables one service of the compose file reads from .env.
const composeVariablesOf: (service: string) => Array<string> = (
  service: string,
): Array<string> => {
  const environment: Array<string> =
    composeFile()["services"][service]["environment"];
  return environment
    .map((entry: string): string | null => {
      const match: RegExpMatchArray | null = entry.match(
        /^[A-Z0-9_]+=\$\{([A-Z0-9_]+)(?::-.*)?\}$/,
      );
      return match ? match[1]! : null;
    })
    .filter((name: string | null): name is string => {
      return name !== null;
    });
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

// The variables only install.sh reads, to check the certificate the same way on a re-run.
const INSTALL_SCRIPT_ONLY: Array<string> = [
  "XO_URL",
  "XO_TLS_FINGERPRINT",
  "XO_CA_FILE",
];

/*
 * What Docker Compose itself reads from .env: the profiles it starts, the
 * XCP-ng AI agent's when install.sh was given a read token (#10998).
 */
const COMPOSE_ITSELF: Array<string> = ["COMPOSE_PROFILES"];

// The XCP-ng AI agent's service, and the profile that starts it (#10998).
const AI_AGENT_SERVICE: string = "oneuptime-xcp-ng-ai-agent";
const AI_AGENT_PROFILE: string = "xcp-ng-ai-agent";

describe("the connect method picker", () => {
  test("offers the install script and Docker Compose, in that order", () => {
    expect(METHOD_KEYS).toEqual(["install-script", "docker-compose"]);
    expect(DEFAULT_XCP_NG_CONNECT_METHOD).toBe("install-script");
    expect(
      XCP_NG_CONNECT_METHODS.map(
        (option: SetupGuideOption<XcpNgConnectMethod>): string => {
          return option.label;
        },
      ),
    ).toEqual(["Install script", "Docker Compose"]);
  });

  test("recommends only the install script", () => {
    expect(
      XCP_NG_CONNECT_METHODS.map(
        (option: SetupGuideOption<XcpNgConnectMethod>): string | undefined => {
          return option.badge;
        },
      ),
    ).toEqual(["Recommended", undefined]);
  });

  test("every method has a one-line description that says the certificate is part of it", () => {
    for (const option of XCP_NG_CONNECT_METHODS) {
      expect((option.description || "").length).toBeGreaterThan(0);
      expect(option.description).not.toContain("\n");
      expect(option.description).toContain("Xen Orchestra's certificate");
    }
  });

  test("only the Docker Compose option's name mentions Docker Compose", () => {
    // A radio's accessible name is its label plus its description.
    const script: SetupGuideOption<XcpNgConnectMethod> =
      XCP_NG_CONNECT_METHODS[0]!;
    expect(`${script.label} ${script.description}`).not.toContain(
      "Docker Compose",
    );
  });

  test("an unknown or missing method resolves to the install script", () => {
    for (const value of [undefined, null, "", "helm", "DOCKER-COMPOSE"]) {
      expect(resolveXcpNgConnectMethod(value)).toBe("install-script");
    }
    expect(resolveXcpNgConnectMethod("docker-compose")).toBe("docker-compose");
  });
});

describe.each(METHOD_KEYS)("the %s guide", (method: XcpNgConnectMethod) => {
  const guide: SetupGuideContent = guideFor(method);
  const markdown: string = getSetupGuideMarkdown(guide);

  test("is three steps after the key: the plugin, the install, the check", () => {
    expect(
      guide.steps.map((step: SetupGuideStep): string => {
        return step.title;
      }),
    ).toEqual([
      "Turn on Xen Orchestra's OpenMetrics plugin",
      "Install the agent",
      "Verify the installation",
    ]);
    // The default key step, which shows the OneUptime URL the key is sent to.
    expect(guide.keyStep).toBeUndefined();
    expect(guide.needsNoKey).toBeFalsy();
  });

  test("every step has a plain one-sentence description", () => {
    for (const step of guide.steps) {
      expect(step.description).toBeTruthy();
      // Descriptions render as plain text, so no markdown.
      expect(step.description).not.toMatch(/[`*[\]]/);
      expect(step.description).not.toContain("\n");
    }
  });

  test("lists what must be in place first: Xen Orchestra, Docker, and a certificate that names its address", () => {
    const prerequisites: Array<string> = guide.prerequisites || [];
    expect(prerequisites.length).toBeGreaterThanOrEqual(2);
    expect(prerequisites.length).toBeLessThanOrEqual(4);
    expect(prerequisites[0]).toContain(
      `Xen Orchestra ${XCP_NG_MINIMUM_XEN_ORCHESTRA_VERSION} or later`,
    );
    expect(prerequisites[0]).toContain("Premium licence on an XOA");
    expect(prerequisites.join("\n")).toContain(
      "Docker Engine 20.10+ with the Docker Compose v2 plugin",
    );
    expect(prerequisites.join("\n")).toContain(
      "A certificate on Xen Orchestra that names the address the agent connects to.",
    );
    expect(prerequisites.join("\n")).toContain(
      "see **Xen Orchestra's certificate** under Advanced",
    );
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

  test("has Advanced topics for the settings, the certificate, the data, several Xen Orchestras, labels and upgrades", () => {
    expect(topicTitles(guide.advanced)).toEqual([
      "Environment variables",
      "Xen Orchestra's certificate",
      "What the agent collects",
      "Reading several Xen Orchestras",
      "Tag the pools with project labels",
      "Upgrade or uninstall the agent",
    ]);
  });

  test("troubleshooting starts with the diagnostic script and covers the known problems", () => {
    expect(topicTitles(guide.troubleshooting)).toEqual([
      "Run the diagnostic script first",
      'A pool shows as "Disconnected"',
      "Xen Orchestra refuses the secret (401)",
      "The plugin does not answer (404, 500, 502 or 503)",
      "Certificate errors",
      "A pool is missing",
    ]);
  });

  test("links to the XCP-ng documentation and its monitors", () => {
    expect(guide.links).toEqual([
      { title: "XCP-ng documentation", url: "/docs/telemetry/xcp-ng" },
      {
        title: "XCP-ng monitors and alerts",
        url: "/docs/monitor/xcp-ng-monitor",
      },
    ]);
  });

  test("every documentation link points at a page, and anchor, that exists", () => {
    const links: Array<string> = Array.from(
      markdown.matchAll(/\]\((\/docs\/[^)\s]+)\)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });
    // The two links, and the certificate topic's link to the docs' own section.
    expect(links).toContain(
      "/docs/telemetry/xcp-ng#xen-orchestras-certificate",
    );
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

  test("the plugin step names Xen Orchestra's own menus and the path the plugin answers on", () => {
    const plugin: SetupGuideStep = stepTitled(
      guide,
      "Turn on Xen Orchestra's OpenMetrics plugin",
    );
    expect(plugin.markdown).toContain(
      "open *Settings → Plugins* and find **openmetrics**",
    );
    expect(plugin.markdown).toContain("**Prometheus secret**");
    expect(plugin.markdown).toContain(`\`${XCP_NG_OPENMETRICS_PATH}\``);
    expect(plugin.markdown).toContain(
      "only to a request that carries its secret",
    );
    // Troubleshooting sends the reader back to the same place.
    expect(markdown).toContain(`*${XCP_NG_PLUGIN_SETTINGS}*`);
  });

  test("the verify step lists the container and the ready line", () => {
    const verify: string = stepTitled(
      guide,
      "Verify the installation",
    ).markdown!;
    expect(verify).toContain("docker compose ps");
    expect(verify).toContain(
      `docker compose logs -f ${XCP_NG_AGENT_CONTAINER}`,
    );
    expect(verify).toContain(
      "`Everything is ready. Begin running and processing data.`",
    );
    expect(verify).toContain("in the **XCP-ng** section");
  });

  test("commands in the agent's folder run where this method installs it", () => {
    const inTheFolder: RegExp = /^docker compose (?:ps|restart|down)/m;
    const blocks: Array<string> = getSetupGuideCodeBlocks(guide).filter(
      (block: string): boolean => {
        return inTheFolder.test(block);
      },
    );
    // Verify, restart the collector after labels, uninstall.
    expect(blocks.length).toBe(3);
    for (const block of blocks) {
      if (method === "install-script") {
        expect(block.startsWith(`cd ${XCP_NG_AGENT_INSTALL_DIR}\n`)).toBe(true);
      } else {
        expect(block).not.toContain("cd ");
      }
    }
  });

  test("the environment table carries the reader's URL", () => {
    expect(envTableRows(guide).get("ONEUPTIME_URL")!.description).toContain(
      `(e.g. \`${URL}\`)`,
    );
  });

  test("the diagnostic script is the agent's own, from this OneUptime, run against this install", () => {
    const topic: string = topicTitled(
      guide.troubleshooting,
      "Run the diagnostic script first",
    ).markdown;
    expect(topic).toContain(
      `curl -fsSL ${SERVED}/troubleshoot.sh -o troubleshoot.sh`,
    );
    expect(topic).toContain(
      method === "install-script"
        ? "\nbash troubleshoot.sh\n"
        : '\nbash troubleshoot.sh -d "$PWD"    # in the folder with docker-compose.yml\n',
    );
    expect(topic).toContain("It never prints the secret.");
  });

  test("a pool shows as Disconnected after the time OneUptime waits for it", () => {
    const topic: string = topicTitled(
      guide.troubleshooting,
      'A pool shows as "Disconnected"',
    ).markdown;
    expect(topic).toContain(
      "OneUptime marks a pool Disconnected when nothing has been read for it for 15 minutes.",
    );
    expect(topic).toContain("*Settings → Servers*");
    expect(topic).toContain(
      `docker compose logs ${XCP_NG_AGENT_CONTAINER} | grep -i error`,
    );
  });

  test("the refused secret is written as the .env needs it, and applied where this method keeps it", () => {
    const topic: string = topicTitled(
      guide.troubleshooting,
      "Xen Orchestra refuses the secret (401)",
    ).markdown;
    expect(topic).toContain("`server returned HTTP status 401 Unauthorized`");
    expect(topic).toContain("between single quotes, every `$` written as `$$`");
    expect(topic).toContain(
      method === "install-script"
        ? `\`docker compose up -d\` in \`${XCP_NG_AGENT_INSTALL_DIR}\``
        : "`docker compose up -d` in the folder with `docker-compose.yml`",
    );
  });

  test("the certificate errors are the collector's own words", () => {
    const topic: string = topicTitled(
      guide.troubleshooting,
      "Certificate errors",
    ).markdown;
    for (const error of [
      "x509: certificate is not valid for any names",
      "x509: certificate is valid for <names>, not <address>",
      "x509: certificate signed by unknown authority",
    ]) {
      expect(topic).toContain(`\`${error}\``);
    }
    expect(topic).toContain(
      "as **Xen Orchestra's certificate** under Advanced says",
    );
  });

  test("the certificate topic offers a pinned certificate, a CA or this machine's bundle, and never skipping the check", () => {
    const topic: string = topicTitled(
      guide.advanced,
      "Xen Orchestra's certificate",
    ).markdown;
    expect(topic).toContain(
      `against \`${XCP_NG_AGENT_CA_FILE}\` and nothing else`,
    );
    expect(topic).toContain("**Xen Orchestra's own certificate**");
    expect(topic).toContain("(`XO_TLS_FINGERPRINT`)");
    expect(topic).toContain("**The CA that issued it** (`XO_CA_FILE`)");
    expect(topic).toContain("**This machine's CA bundle**");
    expect(topic).toContain(
      "The self-signed certificate Xen Orchestra makes for itself names none",
    );
    expect(topic).toContain("set `XO_TLS_SERVER_NAME` to that name");
    expect(topic).not.toMatch(SKIPS_THE_CHECK);
  });
});

describe("no way through the guide skips Xen Orchestra's certificate check", () => {
  test.each(everyGuide())(
    "$label",
    ({ guide }: { label: string; guide: SetupGuideContent }) => {
      const markdown: string = getSetupGuideMarkdown(guide);
      expect(markdown.match(SKIPS_THE_CHECK)).toBeNull();
      for (const option of XCP_NG_CONNECT_METHODS) {
        expect(`${option.label} ${option.description}`).not.toMatch(
          SKIPS_THE_CHECK,
        );
      }
      // The words the card draws, which are not markdown.
      for (const step of guide.steps) {
        expect(
          `${step.title} ${step.description} ${step.note || ""}`,
        ).not.toMatch(SKIPS_THE_CHECK);
      }
      for (const topic of [
        ...(guide.advanced || []),
        ...(guide.troubleshooting || []),
      ]) {
        expect(`${topic.title} ${topic.summary || ""}`).not.toMatch(
          SKIPS_THE_CHECK,
        );
      }
    },
  );

  test("the check would catch the words and flags that turn a certificate check off", () => {
    for (const text of [
      "insecure_skip_verify: true",
      "set tls skip verify",
      "skip-verify",
      "curl -k https://xo",
      "curl -fsSLk https://xo",
      "curl -fsSL --insecure https://xo",
      "wget --no-check-certificate https://xo",
      "--no-verify",
      "verify = false",
      "disable TLS checks",
    ]) {
      expect({ text, caught: SKIPS_THE_CHECK.test(text) }).toEqual({
        text,
        caught: true,
      });
    }
    for (const text of [
      "curl -fsSL https://oneuptime.example.com/install/xcp-ng-agent -o install.sh",
      "It never turns the check off.",
      "openssl x509 -in xo-ca.pem -noout -fingerprint -sha256",
    ]) {
      expect({ text, caught: SKIPS_THE_CHECK.test(text) }).toEqual({
        text,
        caught: false,
      });
    }
  });
});

describe("the install script", () => {
  test("carries the reader's URL and key on the command line", () => {
    expect(
      getXcpNgInstallScriptCommand({
        oneuptimeUrl: URL,
        apiKey: KEY,
        hasApiKey: true,
      }),
    ).toBe(
      /*
       * One value a line, so the key and the script it runs read without
       * scrolling sideways; a shell joins them into one command.
       */
      [
        `curl -fsSL ${SERVED} -o install.sh`,
        `ONEUPTIME_URL=${URL} \\`,
        `  ONEUPTIME_TELEMETRY_INGESTION_KEY=${KEY} \\`,
        "  bash install.sh",
      ].join("\n"),
    );
    expect(installStep(guideFor("install-script"))).toContain(
      codeBlock(
        "bash",
        getXcpNgInstallScriptCommand({
          oneuptimeUrl: URL,
          apiKey: KEY,
          hasApiKey: true,
        }),
      ),
    );
  });

  test("quotes values the shell would otherwise change", () => {
    const command: string = getXcpNgInstallScriptCommand({
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
      const command: string = getXcpNgInstallScriptCommand({
        oneuptimeUrl: URL,
        apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
        hasApiKey: hasApiKey,
      });
      expect(command).not.toContain("ONEUPTIME_");
      expect(command.split("\n")[1]).toBe("bash install.sh");
    }
    // A key the dashboard has not picked is not the reader's, whatever it reads.
    expect(
      getXcpNgInstallScriptCommand({
        oneuptimeUrl: URL,
        apiKey: KEY,
        hasApiKey: false,
      }),
    ).not.toContain("ONEUPTIME_");
  });

  test("leaves the URL to the prompt while the dashboard does not know it", () => {
    const command: string = getXcpNgInstallScriptCommand({
      oneuptimeUrl: SETUP_GUIDE_URL_PLACEHOLDER,
      apiKey: KEY,
      hasApiKey: true,
    });
    expect(command).not.toContain("ONEUPTIME_URL=");
    expect(command).toContain(`ONEUPTIME_TELEMETRY_INGESTION_KEY=${KEY}`);
  });

  test("names the Xen Orchestra only when the guide knows it, quoted for the shell", () => {
    const expected: Record<string, string> = {
      "xo-paris": "XO_NAME=xo-paris",
      "Prod XO 01": "XO_NAME='Prod XO 01'",
      "Bob's XO": "XO_NAME='Bob'\\''s XO'",
    };
    for (const [name, assignment] of Object.entries(expected)) {
      const command: string = getXcpNgInstallScriptCommand({
        oneuptimeUrl: URL,
        apiKey: KEY,
        hasApiKey: true,
        xenOrchestraName: name,
      });
      expect(command).toContain(`  ${assignment} \\\n  bash install.sh`);
      // Before a key is picked the name is the only value: one line.
      expect(
        getXcpNgInstallScriptCommand({
          oneuptimeUrl: URL,
          apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
          hasApiKey: false,
          xenOrchestraName: name,
        }).split("\n")[1],
      ).toBe(`${assignment} bash install.sh`);
    }
    for (const unknown of [undefined, "", "   "]) {
      expect(
        getXcpNgInstallScriptCommand({
          oneuptimeUrl: URL,
          apiKey: KEY,
          hasApiKey: true,
          xenOrchestraName: unknown,
        }),
      ).not.toContain("XO_NAME");
    }
    // A name is trimmed, as the pool's Settings show it.
    expect(
      getXcpNgInstallScriptCommand({
        oneuptimeUrl: URL,
        apiKey: KEY,
        hasApiKey: true,
        xenOrchestraName: "  xo-paris ",
      }),
    ).toContain("XO_NAME=xo-paris \\");
  });

  test("a pool's own tab says the command names its Xen Orchestra; a product page says how the script names a new one", () => {
    const own: string = installStep(
      guideFor("install-script", { xenOrchestraName: "Prod XO 01" }),
    );
    expect(own).toContain(
      "- **What to call this Xen Orchestra** — the command already names it **`Prod XO 01`**, as this pool's Settings show it.",
    );
    expect(own).toContain("XO_NAME='Prod XO 01'");

    const product: string = installStep(guideFor("install-script"));
    expect(product).toContain(
      "- **What to call this Xen Orchestra** — the name each of its pools shows on its Settings. Press Enter to use its address.",
    );
    expect(product).not.toContain("XO_NAME");
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

  test("says what the script asks for, how it checks the certificate and the secret, and where it installs", () => {
    const install: string = installStep(guideFor("install-script"));
    expect(install).toContain(
      "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:",
    );
    for (const prompt of [
      "**Xen Orchestra's address**",
      "**The OpenMetrics plugin's secret**",
      "**What to call this Xen Orchestra**",
    ]) {
      expect(install).toContain(prompt);
    }
    expect(install).toContain("It is not shown as you type it.");
    expect(install).toContain(
      "answer **y** to trust that certificate and nothing else. It never turns the check off.",
    );
    expect(install).toContain(
      "It then asks the plugin for its metrics with the secret and says which pools Xen Orchestra reports, before it installs anything.",
    );
    expect(install).toContain(
      `It installs to \`${XCP_NG_AGENT_INSTALL_DIR}\`, writes a \`0600\` \`.env\` file and starts the agent with Docker Compose.`,
    );
  });

  test("says that running the script again keeps the answers and is the upgrade", () => {
    expect(installStep(guideFor("install-script"))).toContain(
      "Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.",
    );
  });

  test("the upgrade runs the script with nothing in its environment, which would override the .env", () => {
    expect(getXcpNgAgentUpgradeCommand(URL)).toBe(
      [`curl -fsSL ${SERVED} -o install.sh`, "bash install.sh"].join("\n"),
    );
    expect(getXcpNgAgentUpgradeCommand(URL)).not.toContain("ONEUPTIME_");
    expect(getXcpNgAgentUpgradeCommand(URL)).not.toContain("XO_");
    expect(
      topicTitled(
        guideFor("install-script", { xenOrchestraName: "xo-paris" }).advanced,
        "Upgrade or uninstall the agent",
      ).markdown,
    ).toContain(codeBlock("bash", getXcpNgAgentUpgradeCommand(URL)));
  });

  test("a renewed pinned certificate is trusted again only with its new fingerprint, as install.sh asks", () => {
    const topic: string = topicTitled(
      guideFor("install-script").advanced,
      "Xen Orchestra's certificate",
    ).markdown;
    expect(topic).toContain(
      "Run the install script again: it shows the new fingerprint and stops, changing nothing.",
    );
    expect(topic).toContain(
      "`XO_TLS_FINGERPRINT=<new fingerprint> bash install.sh`",
    );
    const script: string = readAgentFile("install.sh");
    // A pinned certificate that changed stops the script; it never asks to trust it.
    expect(script).toContain(
      "Error: Xen Orchestra's certificate is NOT the one XO_TLS_FINGERPRINT pins.",
    );
    expect(script).toContain(
      "and, if it is Xen Orchestra's, set XO_TLS_FINGERPRINT to it and run this again.",
    );
    // A variable exported in the shell wins over the one in .env.
    expect(script).toContain("Exported variables override it");
  });

  test("the script comes from the reader's own OneUptime, which serves it for its release", () => {
    for (const oneuptimeUrl of [
      "https://oneuptime.com",
      "https://oneuptime.acme.internal:8443",
      "http://10.0.0.5",
      "https://tools.acme.com/oneuptime/",
    ]) {
      const command: string = getXcpNgInstallScriptCommand({
        oneuptimeUrl: oneuptimeUrl,
        apiKey: KEY,
        hasApiKey: true,
      });
      const base: string = oneuptimeUrl.replace(/\/+$/, "");

      expect(command.split("\n")[0]).toBe(
        `curl -fsSL ${base}/install/xcp-ng-agent -o install.sh`,
      );
      // The agent reports to the OneUptime the script came from.
      expect(command).toContain(`ONEUPTIME_URL=${oneuptimeUrl} `);
      expect(command).not.toContain("githubusercontent");
    }
    expect(XCP_NG_AGENT_INSTALL_NAME).toBe(InstallScriptName.XcpNgAgent);
  });

  /*
   * The note is about the command's first line, so it sits right under the
   * command - the step's markdown is the command alone - and what the
   * script asks for comes after it, as the step's details.
   */
  test("the read-first note sits right under the command, before what the script asks for", () => {
    for (const hasKey of [true, false]) {
      const guide: SetupGuideContent = hasKey
        ? guideFor("install-script")
        : noKeyGuideFor("install-script");
      const step: SetupGuideStep = stepTitled(guide, "Install the agent");

      expect(step.note).toBe(INSTALL_SCRIPT_READ_FIRST_NOTE);
      expect(step.markdown).toBe(
        codeBlock(
          "bash",
          getXcpNgInstallScriptCommand({
            oneuptimeUrl: URL,
            apiKey: hasKey ? KEY : SETUP_GUIDE_API_KEY_PLACEHOLDER,
            hasApiKey: hasKey,
          }),
        ),
      );
      expect(step.details).toBeTruthy();
      expect(step.details).not.toContain("```");
      expect(getSetupGuideMarkdown(guide)).toContain(
        `${step.markdown}\n\n${INSTALL_SCRIPT_READ_FIRST_NOTE}\n\n${step.details!.trim()}`,
      );
      expect(step.details).toMatch(
        hasKey
          ? /^The command already carries your OneUptime URL/
          : /^The script asks for your OneUptime URL and ingestion key/,
      );
    }
    expect(
      guideFor("docker-compose").steps.some(
        (candidate: SetupGuideStep): boolean => {
          return candidate.note === INSTALL_SCRIPT_READ_FIRST_NOTE;
        },
      ),
    ).toBe(false);
  });

  test("shows none of the Docker Compose instructions", () => {
    const guide: SetupGuideContent = guideFor("install-script");
    const markdown: string = getSetupGuideMarkdown(guide);
    // The script downloads the files, also to upgrade.
    for (const block of getSetupGuideCodeBlocks(guide)) {
      expect(block).not.toContain("curl -fsSLO");
      expect(block).not.toContain("openssl s_client");
    }
    expect(markdown).not.toContain("mkdir oneuptime-xcp-ng-agent");
    expect(markdown).not.toContain("--force-recreate");
    expect(() => {
      return envFileOf(guide);
    }).toThrow("The guide has no .env block");
  });
});

describe("the Docker Compose install", () => {
  const guide: SetupGuideContent = guideFor("docker-compose");
  const install: string = installStep(guide);

  test("downloads the two files, writes .env and Xen Orchestra's certificate, then starts the agent", () => {
    const download: number = install.indexOf(
      `curl -fsSLO ${SERVED}/docker-compose.yml`,
    );
    const config: number = install.indexOf(
      `curl -fsSLO ${SERVED}/otel-collector-config.yaml`,
    );
    const env: number = install.indexOf("ONEUPTIME_URL=");
    const certificate: number = install.indexOf(
      `| openssl x509 -out ${XCP_NG_AGENT_CA_FILE}`,
    );
    const start: number = install.indexOf("```bash\ndocker compose up -d\n```");
    expect(download).toBeGreaterThan(-1);
    expect(config).toBeGreaterThan(download);
    expect(env).toBeGreaterThan(config);
    expect(certificate).toBeGreaterThan(env);
    expect(start).toBeGreaterThan(certificate);
    expect(install).toContain(
      "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:",
    );
    expect(install).toContain(
      `mkdir oneuptime-xcp-ng-agent && cd oneuptime-xcp-ng-agent\n${getXcpNgAgentDownloadCommand(URL)}`,
    );
    expect(install).not.toContain("github.com");
    expect(install).toContain("`chmod 600 .env`");
  });

  test("the .env file carries the reader's URL and key, Xen Orchestra's address and secret, and a name", () => {
    expect(envFileOf(guide)).toBe(
      [
        `ONEUPTIME_URL=${URL}`,
        `ONEUPTIME_TELEMETRY_INGESTION_KEY=${KEY}`,
        "XO_SCHEME=https",
        `XO_ADDRESS=${XCP_NG_EXAMPLE_XO_ADDRESS}`,
        "XO_OPENMETRICS_SECRET='your-plugin-secret'",
        "XO_NAME='Xen Orchestra'",
      ].join("\n"),
    );
    expect(install).toContain(
      "Put the plugin's secret between single quotes. If it holds a `$`, write each one as `$$`",
    );
  });

  test("a pool's own tab writes the name of its Xen Orchestra into .env, quoted for Compose", () => {
    for (const [name, line] of [
      ["xo-paris", "XO_NAME=xo-paris"],
      ["Prod XO 01", "XO_NAME='Prod XO 01'"],
      ["Bob's XO", "XO_NAME='Bob'\\''s XO'"],
    ] as Array<[string, string]>) {
      const block: string = envFileOf(
        guideFor("docker-compose", { xenOrchestraName: name }),
      );
      expect(block.split("\n").pop()).toBe(line);
    }
  });

  test("the .env never holds XO_URL, nor what only the install script reads", () => {
    for (const { guide: way } of everyGuide().filter(
      (entry: { label: string; guide: SetupGuideContent }): boolean => {
        return entry.label.startsWith("docker-compose");
      },
    )) {
      const names: Array<string> = envNamesOf(envFileOf(way));
      for (const name of INSTALL_SCRIPT_ONLY) {
        expect(names).not.toContain(name);
      }
    }
    // XO_URL is install.sh's: the compose file never reads it.
    expect(composeVariables().has("XO_URL")).toBe(false);
  });

  test("the .env sets every variable docker-compose.yml reads without a default, and only ones it reads", () => {
    const variables: Map<string, string | null> = composeVariables();
    const names: Array<string> = envNamesOf(envFileOf(guide));
    for (const name of names) {
      expect({ name, read: variables.has(name) }).toEqual({ name, read: true });
    }
    for (const [name, fallback] of variables) {
      if (fallback === null) {
        expect({ name, inEnv: names.includes(name) }).toEqual({
          name,
          inEnv: true,
        });
      }
    }
    /*
     * XO_TLS_SERVER_NAME is left out: empty, it is XO_ADDRESS's host. So is
     * what the XCP-ng AI agent alone reads (#10998): it starts only once a
     * read token and its profile are set, and each has a default.
     */
    const aiAgentOnly: Array<string> = composeVariablesOf(AI_AGENT_SERVICE)
      .filter((name: string): boolean => {
        return !composeVariablesOf(XCP_NG_AGENT_CONTAINER).includes(name);
      })
      .sort();
    expect(aiAgentOnly.length).toBeGreaterThan(0);
    for (const name of aiAgentOnly) {
      expect({ name, fallback: variables.get(name) }).not.toEqual({
        name,
        fallback: null,
      });
    }
    expect(
      Array.from(variables.keys())
        .filter((name: string): boolean => {
          return !names.includes(name);
        })
        .sort(),
    ).toEqual(["XO_TLS_SERVER_NAME", ...aiAgentOnly].sort());
  });

  test("shows the placeholder, and where to pick a key, until one is picked", () => {
    const noKey: SetupGuideContent = noKeyGuideFor("docker-compose");
    expect(envFileOf(noKey)).toContain(
      `ONEUPTIME_TELEMETRY_INGESTION_KEY=${SETUP_GUIDE_API_KEY_PLACEHOLDER}`,
    );
    expect(installStep(noKey)).toContain(
      `Pick an ingestion key in step 1 to fill in \`${SETUP_GUIDE_API_KEY_PLACEHOLDER}\`.`,
    );
    expect(installStep(guide)).not.toContain("Pick an ingestion key");
  });

  test("reads Xen Orchestra's certificate into xo-ca.pem and prints its fingerprint to check", () => {
    expect(install).toContain(
      `openssl s_client -connect ${XCP_NG_EXAMPLE_XO_ADDRESS}:443 -servername ${XCP_NG_EXAMPLE_XO_ADDRESS} </dev/null 2>/dev/null \\\n  | openssl x509 -out ${XCP_NG_AGENT_CA_FILE}`,
    );
    expect(install).toContain(
      `openssl x509 -in ${XCP_NG_AGENT_CA_FILE} -noout -fingerprint -sha256`,
    );
    expect(install).toContain(
      `(\`cp /etc/ssl/certs/ca-certificates.crt ${XCP_NG_AGENT_CA_FILE}\`)`,
    );
    // The compose file mounts that very file, and fails without it.
    const volumes: Array<Record<string, any> | string> =
      composeFile()["services"][XCP_NG_AGENT_CONTAINER]["volumes"];
    const mount: Record<string, any> | undefined = volumes.find(
      (volume: Record<string, any> | string): boolean => {
        return (
          typeof volume === "object" &&
          volume["source"] === `./${XCP_NG_AGENT_CA_FILE}`
        );
      },
    ) as Record<string, any> | undefined;
    expect(mount).toBeDefined();
    expect(mount!["read_only"]).toBe(true);
    expect(mount!["bind"]["create_host_path"]).toBe(false);
  });

  test("a renewed certificate is read again and the agent recreated", () => {
    expect(
      topicTitled(guide.advanced, "Xen Orchestra's certificate").markdown,
    ).toContain(
      `When the certificate in \`${XCP_NG_AGENT_CA_FILE}\` is renewed, read it again as in step 3, then run \`docker compose up -d --force-recreate\`.`,
    );
    // Step 3 is the install, counting the key step as step 1.
    expect(guide.steps[1]!.title).toBe("Install the agent");
  });

  test("the upgrade downloads both pinned files, then pulls and recreates the agent", () => {
    const topic: string = topicTitled(
      guide.advanced,
      "Upgrade or uninstall the agent",
    ).markdown;
    expect(getXcpNgAgentDownloadCommand(URL)).toBe(
      [
        `curl -fsSLO ${SERVED}/docker-compose.yml`,
        `curl -fsSLO ${SERVED}/otel-collector-config.yaml`,
      ].join("\n"),
    );
    expect(XCP_NG_AGENT_RECREATE_COMMAND).toBe(
      "docker compose pull\ndocker compose up -d --force-recreate",
    );
    const download: number = topic.indexOf(
      codeBlock("bash", getXcpNgAgentDownloadCommand(URL)),
    );
    const recreate: number = topic.indexOf(
      codeBlock("bash", XCP_NG_AGENT_RECREATE_COMMAND),
    );
    expect(download).toBeGreaterThan(-1);
    expect(recreate).toBeGreaterThan(download);
    expect(topic).toContain(
      `your \`.env\` and \`${XCP_NG_AGENT_CA_FILE}\` stay`,
    );
    expect(topic).not.toContain("install.sh");
  });

  test("shows none of the install script's steps", () => {
    const steps: string = stepsText(guide);
    expect(steps).not.toContain("install.sh");
    expect(steps).not.toContain(XCP_NG_AGENT_INSTALL_DIR);
    expect(
      getSetupGuideCodeBlocks(guide).filter((block: string): boolean => {
        return block.includes("bash install.sh");
      }),
    ).toEqual([
      // Only a second Xen Orchestra's agent, in a folder of its own.
      "INSTALL_DIR=/opt/oneuptime-xcp-ng-agent-lab bash install.sh\n",
    ]);
  });
});

describe("the environment variables table", () => {
  test.each(METHOD_KEYS)(
    "documents every variable docker-compose.yml reads, and the ones only install.sh reads, for %s",
    (method: XcpNgConnectMethod) => {
      const rows: Map<string, { required: string; description: string }> =
        envTableRows(guideFor(method));
      expect(Array.from(rows.keys()).sort()).toEqual(
        [
          ...Array.from(composeVariables().keys()),
          ...INSTALL_SCRIPT_ONLY,
          ...COMPOSE_ITSELF,
        ].sort(),
      );
      // Compose reads its profiles with none set by default.
      expect(rows.get("COMPOSE_PROFILES")!.required).toBe("No");
      expect(rows.get("COMPOSE_PROFILES")!.description).toContain(
        `\`${AI_AGENT_PROFILE}\``,
      );
      for (const name of INSTALL_SCRIPT_ONLY) {
        expect({ name, required: rows.get(name)!.required }).toEqual({
          name,
          required: "Install script",
        });
      }
    },
  );

  test("a variable is required exactly when docker-compose.yml has no default for it", () => {
    const rows: Map<string, { required: string; description: string }> =
      envTableRows(guideFor("docker-compose"));
    for (const [name, fallback] of composeVariables()) {
      expect({ name, required: rows.get(name)!.required }).toEqual({
        name,
        required: fallback === null ? "Yes" : "No",
      });
    }
    // The defaults the table states are the compose file's.
    expect(composeVariables().get("XO_SCHEME")).toBe("https");
    expect(rows.get("XO_SCHEME")!.description).toMatch(/^`https` \(default\)/);
    expect(composeVariables().get("XO_NAME")).toBe("${XO_ADDRESS:-}");
    expect(rows.get("XO_NAME")!.description).toContain(
      "(default: its address)",
    );
  });

  test("the install script writes every variable of the table to .env, quoted for Compose", () => {
    const script: string = readAgentFile("install.sh");
    const rows: Map<string, { required: string; description: string }> =
      envTableRows(guideFor("install-script"));
    // The collector's ten, and the AI agent's eleven (#10998).
    expect(rows.size).toBe(21);
    for (const name of rows.keys()) {
      if (name === "XO_SCHEME") {
        // A validated shape (https or http), so it stays bare.
        expect(script).toContain("\nXO_SCHEME=$XO_SCHEME\n");
        continue;
      }
      if (name === "XO_OPENMETRICS_SECRET") {
        // Also escaped for the collector, which reads the value once more.
        expect(script).toContain(
          '\nXO_OPENMETRICS_SECRET=$(compose_env_quote "$(collector_env_escape "$XO_OPENMETRICS_SECRET")")\n',
        );
        continue;
      }
      expect(script).toContain(`\n${name}=$(compose_env_quote "$${name}")\n`);
    }
  });

  test("says where each method keeps the variables, and where to apply a change", () => {
    expect(
      topicTitled(guideFor("install-script").advanced, "Environment variables")
        .markdown,
    ).toMatch(
      new RegExp(
        `^The install script writes these to \`${XCP_NG_AGENT_INSTALL_DIR}/\\.env\`\\. After changing one, apply it with \`docker compose up -d\` in \`${XCP_NG_AGENT_INSTALL_DIR}\`\\.`,
      ),
    );
    expect(
      topicTitled(guideFor("docker-compose").advanced, "Environment variables")
        .markdown,
    ).toMatch(
      /^The agent reads these from the `\.env` file next to `docker-compose\.yml`\. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose\.yml`\./,
    );
  });
});

describe("drift guards against agents/XcpNgAgent", () => {
  test("every file the guide downloads is one this OneUptime serves from the agent's directory", () => {
    const entry: InstallScriptEntry | null = getInstallScriptEntry(
      InstallScriptName.XcpNgAgent,
    );
    const files: Set<string> = new Set();
    for (const method of METHOD_KEYS) {
      const markdown: string = getSetupGuideMarkdown(guideFor(method));
      expect(markdown).not.toContain("githubusercontent");
      for (const match of markdown.matchAll(SERVED_FILE_PATTERN)) {
        // The address alone is the install script.
        files.add(match[1] || "install.sh");
      }
    }
    expect(Array.from(files).sort()).toEqual([
      "docker-compose.yml",
      "install.sh",
      "otel-collector-config.yaml",
      "troubleshoot.sh",
    ]);
    for (const file of files) {
      expect(entry?.files).toContain(file);
      expect(fs.existsSync(path.join(AGENT_DIR, file))).toBe(true);
    }
  });

  test("the container the guide names is the compose file's collector, and the AI agent starts only under its profile", () => {
    const services: Record<string, Record<string, unknown>> = composeFile()[
      "services"
    ];
    expect(Object.keys(services)).toEqual([
      XCP_NG_AGENT_CONTAINER,
      AI_AGENT_SERVICE,
    ]);
    expect(services[XCP_NG_AGENT_CONTAINER]!["container_name"]).toBe(
      XCP_NG_AGENT_CONTAINER,
    );
    // A plain `docker compose up -d` starts the collector alone.
    expect(services[XCP_NG_AGENT_CONTAINER]!["profiles"]).toBeUndefined();
    expect(services[AI_AGENT_SERVICE]!["profiles"]).toEqual([AI_AGENT_PROFILE]);
  });

  test("runs the pinned collector, and its config reports that version as the agent's", () => {
    const image: string =
      composeFile()["services"][XCP_NG_AGENT_CONTAINER]["image"];
    expect(image).toBe(
      `otel/opentelemetry-collector-contrib:${XCP_NG_AGENT_VERSION}`,
    );
    const config: string = readAgentFile("otel-collector-config.yaml");
    expect(config).toContain(
      `- key: oneuptime.agent.version\n        value: "${XCP_NG_AGENT_VERSION}"\n        action: upsert`,
    );
  });

  test("the labels go in the config's resource processor, next to the agent version", () => {
    const config: Record<string, any> = yaml.load(
      readAgentFile("otel-collector-config.yaml"),
    ) as Record<string, any>;
    const attributes: Array<Record<string, string>> =
      config["processors"]["resource"]["attributes"];
    expect(
      attributes.map((attribute: Record<string, string>): string => {
        return attribute["key"]!;
      }),
    ).toContain("oneuptime.agent.version");
    expect(
      topicTitled(
        guideFor("install-script").advanced,
        "Tag the pools with project labels",
      ).markdown,
    ).toContain(
      "Add them to the `resource` processor in `otel-collector-config.yaml`, next to `oneuptime.agent.version`:",
    );
  });

  test("the counters the guide says become gauges are the ones the config turns into gauges", () => {
    const config: string = readAgentFile("otel-collector-config.yaml");
    const topic: string = topicTitled(
      guideFor("install-script").advanced,
      "What the agent collects",
    ).markdown;
    const converted: Array<string> = Array.from(
      config.matchAll(
        /convert_sum_to_gauge\(\) where metric\.name == "([a-z_]+)"/g,
      ),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });
    // "Xen Orchestra types eight throughput series as counters".
    expect(topic).toContain("eight throughput series as counters");
    expect(converted).toHaveLength(8);
    for (const series of [
      "xcp_host_network_receive_bytes_total",
      "xcp_host_network_transmit_bytes_total",
    ]) {
      expect(topic).toContain(`\`${series}\``);
      expect(converted).toContain(series);
    }
    // The rest are the VM network, network error and disk read and write series.
    expect(
      converted.filter((series: string): boolean => {
        return series.startsWith("xcp_vm_");
      }),
    ).toEqual([
      "xcp_vm_network_receive_bytes_total",
      "xcp_vm_network_transmit_bytes_total",
      "xcp_vm_network_receive_errors_total",
      "xcp_vm_network_transmit_errors_total",
      "xcp_vm_disk_read_bytes_total",
      "xcp_vm_disk_write_bytes_total",
    ]);
  });

  test("the install script installs where the guide says, asks what it says, and fetches its files from this OneUptime", () => {
    const script: string = readAgentFile("install.sh");
    expect(script).toContain(
      `INSTALL_DIR="\${INSTALL_DIR:-${XCP_NG_AGENT_INSTALL_DIR}}"`,
    );
    expect(script).toContain('AGENT_FILES_PATH="install/xcp-ng-agent"');
    expect(script).toContain(
      "Xen Orchestra's address (e.g., https://xo.example.com or https://10.0.0.5:8443): ",
    );
    // The secret is read without an echo.
    expect(script).toContain('read -rsp "OpenMetrics plugin secret');
    expect(script).toContain(
      "What to call this Xen Orchestra in OneUptime [$XO_HOST]: ",
    );
    expect(script).toContain("Trust this certificate, and only it? [y/N]: ");
    // An edited file is kept next to the new one.
    expect(script).toContain(".bak.");
  });

  test("the install script honours a preset URL, key and name, which the command relies on", () => {
    const script: string = readAgentFile("install.sh");
    for (const name of [
      "ONEUPTIME_URL",
      "ONEUPTIME_TELEMETRY_INGESTION_KEY",
      "XO_NAME",
    ]) {
      expect(script).toMatch(
        new RegExp(
          `if \\[ -z "\\$${name}" \\]; then\\s*\\n(?:\\s*if[^\\n]*\\n)?\\s*read -rp`,
        ),
      );
    }
  });

  test("the diagnostic script takes -d and defaults to the install directory", () => {
    const script: string = readAgentFile("troubleshoot.sh");
    expect(script).toContain('-d|--dir)      DIR="${2:-}"; shift 2 ;;');
    expect(script).toContain(`DIR="${XCP_NG_AGENT_INSTALL_DIR}"`);
  });

  test("a second Xen Orchestra's agent installs into a folder of its own", () => {
    const topic: string = topicTitled(
      guideFor("install-script").advanced,
      "Reading several Xen Orchestras",
    ).markdown;
    expect(topic).toContain(
      codeBlock(
        "bash",
        "INSTALL_DIR=/opt/oneuptime-xcp-ng-agent-lab bash install.sh",
      ),
    );
    expect(topic).toContain(
      "with its own `container_name` in its `docker-compose.yml`",
    );
    // install.sh says the same when the name is taken.
    expect(readAgentFile("install.sh")).toContain(
      "give this one its own container_name in $INSTALL_DIR/docker-compose.yml",
    );
  });
});
