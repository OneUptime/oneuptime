import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import {
  STORAGE_ARRAY_AGENT_FILES,
  STORAGE_ARRAY_PLATFORMS,
  StorageArrayPlatform,
  getStorageArrayEnvFile,
  getStorageArrayInstallScriptCommand,
  getStorageArrayPlatformForSystem,
  getStorageArraySetupGuide,
  resolveStorageArrayPlatform,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/Utils/DocumentationMarkdown";
import {
  POWERSCALE_COLLECTOR_CONFIG,
  POWERSCALE_EXAMPLE_NODES,
  getPowerScaleNodeLines,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/Utils/PowerScaleSetupGuide";
import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideOption,
  SetupGuideStep,
  SetupGuideTopic,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import StorageSystem from "../../../Types/StorageArray/StorageSystem";

/*
 * THE SETUP GUIDE FOR A DELL POWERSCALE CLUSTER (#11003).
 *
 * The picker's fourth option. Its steps are PowerScale's own - SNMP on the
 * cluster, every node's address, the community or SNMPv3 user - and the
 * topics every platform shares are the shared guide's, word for word, so a
 * translation of one is a translation of both. Held here to what the agent
 * ships: the install script's questions and the .env it writes, the polls
 * the collector config has, the files OneUptime serves.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");
const AGENT_DIR: string = path.join(
  REPOSITORY_ROOT,
  "agents/StorageArrayAgent",
);
const URL: string = "https://oneuptime.example.com";
const KEY: string = "a-real-ingestion-key";

// A node slot's address: POWERSCALE_NODE_1 to POWERSCALE_NODE_252.
const NODE_SLOT_VARIABLE: RegExp = /^POWERSCALE_NODE_\d+$/;

function readAgentFile(file: string): string {
  return fs.readFileSync(path.join(AGENT_DIR, file), "utf8");
}

function guide(
  overrides: {
    apiKey?: string;
    hasApiKey?: boolean;
    arrayName?: string;
    platform?: StorageArrayPlatform;
  } = {},
): SetupGuideContent {
  const apiKey: string = overrides.apiKey ?? KEY;
  return getStorageArraySetupGuide({
    oneuptimeUrl: URL,
    apiKey,
    hasApiKey:
      overrides.hasApiKey ?? apiKey !== SETUP_GUIDE_API_KEY_PLACEHOLDER,
    platform: overrides.platform ?? "powerscale",
    arrayName: overrides.arrayName,
  });
}

// Every piece of text the guide shows, in one string.
function allText(content: SetupGuideContent): string {
  const parts: Array<string> = [...(content.prerequisites || [])];
  for (const step of content.steps) {
    parts.push(step.title, step.description || "", step.markdown || "");
    for (const variant of step.variants || []) {
      parts.push(variant.label, variant.markdown);
    }
  }
  for (const topic of [
    ...(content.advanced || []),
    ...(content.troubleshooting || []),
  ]) {
    parts.push(topic.title, topic.summary || "", topic.markdown);
  }
  return parts.join("\n");
}

function step(content: SetupGuideContent, title: string): SetupGuideStep {
  const found: SetupGuideStep | undefined = content.steps.find(
    (candidate: SetupGuideStep): boolean => {
      return candidate.title === title;
    },
  );
  expect(found).toBeDefined();
  return found as SetupGuideStep;
}

function variant(content: SetupGuideContent, label: string): string {
  const install: SetupGuideStep = step(content, "Install the agent");
  const found: string | undefined = install.variants?.find(
    (candidate: { label: string }): boolean => {
      return candidate.label === label;
    },
  )?.markdown;
  expect(found).toBeDefined();
  return found as string;
}

function topic(
  topics: Array<SetupGuideTopic> | undefined,
  title: string,
): SetupGuideTopic {
  const found: SetupGuideTopic | undefined = (topics || []).find(
    (candidate: SetupGuideTopic): boolean => {
      return candidate.title === title;
    },
  );
  expect(found).toBeDefined();
  return found as SetupGuideTopic;
}

// A code block's lines, by the fence's language.
function codeBlocks(markdown: string, language: string): Array<string> {
  const blocks: Array<string> = [];
  const fence: RegExp = new RegExp(
    `\`\`\`${language}\\n([\\s\\S]*?)\\n\`\`\``,
    "g",
  );
  for (const match of markdown.matchAll(fence)) {
    blocks.push(match[1]!);
  }
  return blocks;
}

describe("the PowerScale option", () => {
  test("is the picker's last, after Pure Storage's, and says how the agent reads the cluster", () => {
    const option: SetupGuideOption<StorageArrayPlatform> | undefined =
      STORAGE_ARRAY_PLATFORMS[STORAGE_ARRAY_PLATFORMS.length - 1];
    expect(option).toMatchObject({
      key: "powerscale",
      label: "PowerScale",
      description:
        "The agent polls the cluster's nodes over SNMP. Nothing runs next to it.",
    });
    expect(option!.badge).toBeUndefined();
  });

  test("is where a PowerScale array's own Documentation tab opens, and the picker's word for it", () => {
    expect(getStorageArrayPlatformForSystem(StorageSystem.DellPowerScale)).toBe(
      "powerscale",
    );
    expect(resolveStorageArrayPlatform("powerscale")).toBe("powerscale");
  });

  test("downloads its collector config with the others, from this OneUptime", () => {
    expect(STORAGE_ARRAY_AGENT_FILES).toContain(POWERSCALE_COLLECTOR_CONFIG);
    expect(
      fs.existsSync(path.join(AGENT_DIR, POWERSCALE_COLLECTOR_CONFIG)),
    ).toBe(true);
  });
});

describe("the PowerScale guide", () => {
  test("turns SNMP on, then installs the agent, then checks it runs", () => {
    expect(
      guide().steps.map((candidate: SetupGuideStep): string => {
        return candidate.title;
      }),
    ).toEqual([
      "Turn on SNMP on the cluster",
      "Install the agent",
      "Verify the installation",
    ]);
  });

  test("turns on SNMP v2c with a community of the reader's own, or SNMPv3, with Dell's own commands", () => {
    const markdown: string = step(guide(), "Turn on SNMP on the cluster")
      .markdown as string;
    expect(codeBlocks(markdown, "bash")).toEqual([
      "isi snmp settings modify --service yes\nisi snmp settings modify --snmp-v1-v2c-access yes -c '<read-only-community>'",
      "isi snmp settings modify --service yes\nisi snmp settings modify --snmp-v3-access yes -u '<read-only-user>' --snmp-v3-password '<authentication-password>' --snmp-v3-priv-password '<privacy-password>'",
    ]);
    // OneFS's default community is named, so the reader replaces it.
    expect(markdown).toContain("`I$ilonpublic`");
    expect(markdown).toContain("`isi snmp settings view`");
    expect(markdown).toContain("UDP 161");
    expect(markdown).toContain("`isi network interfaces list`");
  });

  test("installs with the PowerScale config, the reader's URL and key, and the cluster's name when it is known", () => {
    const script: string = variant(
      guide({ arrayName: "ps-prod" }),
      "Install script",
    );
    const command: string = getStorageArrayInstallScriptCommand({
      oneuptimeUrl: URL,
      apiKey: KEY,
      hasApiKey: true,
      platform: "powerscale",
      arrayName: "ps-prod",
    });
    expect(command).toContain(
      `STORAGE_ARRAY_COLLECTOR_CONFIG=${POWERSCALE_COLLECTOR_CONFIG}`,
    );
    expect(command).toContain("STORAGE_ARRAY_NAME=ps-prod");
    expect(command).toContain(`ONEUPTIME_TELEMETRY_INGESTION_KEY=${KEY}`);
    expect(codeBlocks(script, "bash")).toEqual([command]);
    expect(script).toContain("It registers the array as **`ps-prod`**");
  });

  test("says what install.sh asks a PowerScale for, in the order it asks", () => {
    const script: string = variant(
      guide({ apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER, hasApiKey: false }),
      "Install script",
    );
    const asks: Array<string> = script
      .split("\n")
      .filter((line: string): boolean => {
        return line.startsWith("- ");
      });
    expect(asks).toHaveLength(4);
    expect(asks[0]).toContain("**OneUptime URL**");
    expect(asks[1]).toContain("**array name**");
    expect(asks[2]).toContain("**every node's address**");
    expect(asks[3]).toContain("**SNMP version**");

    // install.sh's own prompts, in the same order.
    const install: string = readAgentFile("install.sh");
    const nodes: number = install.indexOf(
      "Every node's address, separated by commas",
    );
    const version: number = install.indexOf(
      "SNMP version the cluster answers, 2c or 3",
    );
    const community: number = install.indexOf(
      "Read-only SNMP community of the PowerScale cluster",
    );
    expect(nodes).toBeGreaterThan(0);
    expect(version).toBeGreaterThan(nodes);
    expect(community).toBeGreaterThan(version);
  });

  test("names the variables install.sh reads for other SNMPv3 protocols and security levels", () => {
    const script: string = variant(guide(), "Install script");
    const install: string = readAgentFile("install.sh");
    for (const name of [
      "POWERSCALE_SNMP_AUTH_PROTOCOL",
      "POWERSCALE_SNMP_PRIVACY_PROTOCOL",
      "POWERSCALE_SNMP_SECURITY_LEVEL",
      "POWERSCALE_NODES",
    ]) {
      expect(script).toContain(`\`${name}`);
      expect(install).toContain(`\${${name}`);
    }
    expect(install).toContain("auth_priv | auth_no_priv | no_auth_no_priv");
  });

  test("writes the .env a Docker Compose install needs: every variable install.sh writes for a PowerScale", () => {
    const compose: string = variant(guide(), "Docker Compose");
    const env: string = getStorageArrayEnvFile({
      oneuptimeUrl: URL,
      apiKey: KEY,
      platform: "powerscale",
      arrayName: "ps-prod",
    });
    expect(compose).toContain(
      getStorageArrayEnvFile({
        oneuptimeUrl: URL,
        apiKey: KEY,
        platform: "powerscale",
        arrayName: "my-storage-array",
      }),
    );
    const names: Array<string> = env.split("\n").map((line: string): string => {
      return line.split("=")[0]!;
    });
    expect(names).toEqual([
      "ONEUPTIME_URL",
      "ONEUPTIME_TELEMETRY_INGESTION_KEY",
      "STORAGE_ARRAY_NAME",
      "STORAGE_SYSTEM",
      "STORAGE_ARRAY_COLLECTOR_CONFIG",
      "COMPOSE_PROFILES",
      "POWERSCALE_ENDPOINT",
      "POWERSCALE_SNMP_VERSION",
      "POWERSCALE_SNMP_COMMUNITY",
      "POWERSCALE_NODES",
      "POWERSCALE_SNMP_RECEIVERS",
      "POWERSCALE_NODE_1",
      "POWERSCALE_NODE_2",
      "POWERSCALE_NODE_3",
    ]);
    expect(env).toContain("STORAGE_SYSTEM=dell.powerscale");
    expect(env).toContain(
      `STORAGE_ARRAY_COLLECTOR_CONFIG=${POWERSCALE_COLLECTOR_CONFIG}`,
    );
    // Every variable install.sh writes for a PowerScale is one the reader can set.
    const install: string = readAgentFile("install.sh");
    const extras: RegExpMatchArray | null = install.match(
      /PLATFORM_EXTRA_VARIABLES="(POWERSCALE_[^"$]+)/,
    );
    expect(extras).not.toBeNull();
    const topicText: string = topic(
      guide().advanced,
      "Environment variables",
    ).markdown;
    for (const name of extras![1]!.trim().split(/\s+/)) {
      expect({ name, documented: topicText.includes(`\`${name}\``) }).toEqual({
        name,
        documented: true,
      });
    }
  });

  test("polls exactly the receivers the shipped config has, one per node, as install.sh writes them", () => {
    const lines: Array<string> = getPowerScaleNodeLines(
      POWERSCALE_EXAMPLE_NODES,
    );
    expect(lines).toEqual([
      "POWERSCALE_NODES=10.20.0.11,10.20.0.12,10.20.0.13",
      // Quoted for Compose: the list holds spaces.
      "POWERSCALE_SNMP_RECEIVERS='[snmp/cluster, snmp/quotas, snmp/node-1, snmp/node-2, snmp/node-3]'",
      "POWERSCALE_NODE_1=10.20.0.11",
      "POWERSCALE_NODE_2=10.20.0.12",
      "POWERSCALE_NODE_3=10.20.0.13",
    ]);
    const config: { receivers: Record<string, unknown> } = yaml.load(
      readAgentFile(POWERSCALE_COLLECTOR_CONFIG),
    ) as { receivers: Record<string, unknown> };
    for (const receiver of [
      "snmp/cluster",
      "snmp/quotas",
      "snmp/node-1",
      "snmp/node-2",
      "snmp/node-3",
    ]) {
      expect(config.receivers).toHaveProperty([receiver]);
    }
    // The format install.sh writes the receiver list in.
    expect(readAgentFile("install.sh")).toContain(
      'receivers="$receivers, snmp/node-$count"',
    );
  });

  test("documents every variable the PowerScale config reads", () => {
    const table: string = topic(
      guide().advanced,
      "Environment variables",
    ).markdown;
    const config: string = readAgentFile(POWERSCALE_COLLECTOR_CONFIG);
    const variables: Set<string> = new Set(
      Array.from(config.matchAll(/\$\{env:([A-Z0-9_]+)/g)).map(
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      ),
    );
    expect(variables.size).toBeGreaterThan(10);
    for (const variable of variables) {
      const documented: boolean = NODE_SLOT_VARIABLE.test(variable)
        ? table.includes("`POWERSCALE_NODE_<n>`")
        : table.includes(`\`${variable}\``);
      expect({ variable, documented }).toEqual({ variable, documented: true });
    }
  });

  test("says how the agent polls, the intervals the config ships, and where the whole config is", () => {
    const polls: string = topic(
      guide().advanced,
      "How the agent polls the cluster",
    ).markdown;
    const config: {
      receivers: Record<string, { collection_interval?: string }>;
    } = yaml.load(readAgentFile(POWERSCALE_COLLECTOR_CONFIG)) as {
      receivers: Record<string, { collection_interval?: string }>;
    };
    expect(config.receivers["snmp/cluster"]!.collection_interval).toBe("60s");
    expect(config.receivers["snmp/quotas"]!.collection_interval).toBe("300s");
    expect(config.receivers["snmp/node"]!.collection_interval).toBe("60s");
    expect(polls).toContain("every 60 seconds (`snmp/cluster`)");
    expect(polls).toContain("every 5 minutes (`snmp/quotas`)");
    expect(polls).toContain("every 60 seconds (`snmp/node-<n>`)");
    expect(polls).toContain("`scrape_endpoint: <poll>`");
    expect(polls).toContain(
      `/opt/oneuptime-storage-array-agent/${POWERSCALE_COLLECTOR_CONFIG}`,
    );
  });

  test("reads in a PowerScale's words: no API token, no Pure Storage step, no exporter", () => {
    const text: string = allText(guide());
    for (const word of [
      "API token",
      "FlashArray",
      "FlashBlade",
      "Purity",
      "pureadmin",
      "purefa",
      "exporter service",
      "STORAGE_ARRAY_INSECURE_SKIP_VERIFY",
      "fa-prod-01",
    ]) {
      expect({ word, found: text.includes(word) }).toEqual({
        word,
        found: false,
      });
    }
    expect(text).toContain("SmartConnect");
  });

  test("shares the topics every platform has with the Pure Storage guide, word for word", () => {
    const powerscale: SetupGuideContent = guide({ arrayName: "ps-prod" });
    const flasharray: SetupGuideContent = guide({
      arrayName: "ps-prod",
      platform: "flasharray",
    });
    for (const title of [
      "Tag the array with project labels",
      "Run as a systemd service",
    ]) {
      expect(topic(powerscale.advanced, title)).toEqual(
        topic(flasharray.advanced, title),
      );
    }
    for (const title of [
      'Array shows as "Disconnected"',
      "Array appears under the wrong name",
    ]) {
      expect(topic(powerscale.troubleshooting, title)).toEqual(
        topic(flasharray.troubleshooting, title),
      );
    }
    expect(step(powerscale, "Verify the installation")).toEqual(
      step(flasharray, "Verify the installation"),
    );
    expect(powerscale.links).toEqual(flasharray.links);
  });

  test("upgrades with the same commands, and says how to stop the cluster answering when it is uninstalled", () => {
    const upgrade: string = topic(
      guide().advanced,
      "Upgrade or uninstall the agent",
    ).markdown;
    expect(upgrade).toContain(
      `install/storage-array-agent/${POWERSCALE_COLLECTOR_CONFIG}`,
    );
    expect(upgrade).toContain("turn SNMP off on the cluster");
    expect(upgrade).not.toContain("API token");
  });

  test("troubleshoots a node that does not answer, with snmpget through the diagnostic script", () => {
    const troubleshooting: Array<SetupGuideTopic> =
      guide().troubleshooting || [];
    expect(troubleshooting[0]!.title).toBe("Run the diagnostic script first");
    expect(troubleshooting[0]!.markdown).toContain("`snmpget`");
    expect(troubleshooting[0]!.markdown).toContain(
      "install/storage-array-agent/troubleshoot.sh",
    );
    const node: string = topic(
      troubleshooting,
      "A node does not answer SNMP",
    ).markdown;
    expect(node).toContain("`request timeout`");
    expect(node).toContain("`POWERSCALE_NODES`");
    // troubleshoot.sh probes each node as the guide says.
    expect(readAgentFile("troubleshoot.sh")).toContain(
      "snmpget -t 5 -r 1 -Oqv",
    );
  });

  test("leaves the key placeholder for the reader to fill in until a key is picked", () => {
    const compose: string = variant(
      guide({ apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER, hasApiKey: false }),
      "Docker Compose",
    );
    expect(compose).toContain(
      `ONEUPTIME_TELEMETRY_INGESTION_KEY=${SETUP_GUIDE_API_KEY_PLACEHOLDER}`,
    );
    expect(compose).toContain(
      `Pick an ingestion key in step 1 to fill in \`${SETUP_GUIDE_API_KEY_PLACEHOLDER}\`.`,
    );
    const script: string = variant(
      guide({ apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER, hasApiKey: false }),
      "Install script",
    );
    expect(script).not.toContain(SETUP_GUIDE_API_KEY_PLACEHOLDER);
  });

  test("names the cluster as the reader's when the array is known, and suggests one when it is not", () => {
    expect(
      variant(guide({ arrayName: "ps-prod" }), "Docker Compose"),
    ).toContain("This installs the agent for **`ps-prod`**");
    expect(variant(guide(), "Docker Compose")).toContain(
      "Replace `my-storage-array` with a name for this cluster, such as `ps-prod`.",
    );
  });
});
