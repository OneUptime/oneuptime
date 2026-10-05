import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import {
  DEFAULT_STORAGE_ARRAY_PLATFORM,
  STORAGE_ARRAY_AGENT_CONTAINER,
  STORAGE_ARRAY_AGENT_FILES,
  STORAGE_ARRAY_AGENT_INSTALL_DIR,
  STORAGE_ARRAY_AGENT_RAW_URL,
  STORAGE_ARRAY_AGENT_SOURCE_URL,
  STORAGE_ARRAY_COLLECTOR_CONFIGS,
  STORAGE_ARRAY_EXAMPLE_NAME,
  STORAGE_ARRAY_FA_EXPORTER_SERVICE,
  STORAGE_ARRAY_FB_EXPORTER_SERVICE,
  STORAGE_ARRAY_PLATFORMS,
  STORAGE_ARRAY_PLATFORM_SETTINGS,
  STORAGE_ARRAY_READ_ONLY_USER,
  STORAGE_ARRAY_SYSLOG_PORT,
  StorageArrayPlatform,
  getStorageArrayEnvFile,
  getStorageArrayInstallScriptCommand,
  getStorageArrayPlatformForSystem,
  getStorageArraySetupGuide,
  resolveStorageArrayPlatform,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/Utils/DocumentationMarkdown";
import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SETUP_GUIDE_URL_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideOption,
  SetupGuideStep,
  SetupGuideStepVariant,
  SetupGuideTopic,
  getSetupGuideCodeBlocks,
  getSetupGuideMarkdown,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import StorageSystem from "../../../Types/StorageArray/StorageSystem";

/*
 * The Storage Array Agent guide asks which array it is for — a FlashArray
 * serving its metrics itself, an older FlashArray read through Pure's
 * exporter, or a FlashBlade — and shows only that path; the install script
 * and Docker Compose are tabs of the install step. These tests pin, for
 * every platform:
 *
 *   - the reader's URL and key in every command and file that needs them,
 *     and never a placeholder key in the install script's environment (the
 *     script would write it into .env as the key);
 *   - that each platform shows only its own variables, config and exporter;
 *   - that the collector config the guide shows IS the shipped file, and
 *     every variable, file, container, profile and script it names exists
 *     in agents/StorageArrayAgent — the guide is how most people install
 *     the agent, so a drift there is a broken install, not a doc typo.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const AGENT_DIR: string = path.join(REPO_ROOT, "agents", "StorageArrayAgent");

const URL: string = "https://oneuptime.example.com";
const KEY: string = "tik_secret_123";

const PLATFORMS: Array<StorageArrayPlatform> = STORAGE_ARRAY_PLATFORMS.map(
  (option: SetupGuideOption<StorageArrayPlatform>): StorageArrayPlatform => {
    return option.key;
  },
);

interface GuideOverrides {
  oneuptimeUrl?: string;
  apiKey?: string;
  hasApiKey?: boolean;
  arrayName?: string;
}

const guideFor: (
  platform: StorageArrayPlatform,
  overrides?: GuideOverrides,
) => SetupGuideContent = (
  platform: StorageArrayPlatform,
  overrides?: GuideOverrides,
): SetupGuideContent => {
  const apiKey: string = overrides?.apiKey ?? KEY;
  return getStorageArraySetupGuide({
    oneuptimeUrl: overrides?.oneuptimeUrl ?? URL,
    apiKey: apiKey,
    hasApiKey:
      overrides?.hasApiKey ?? apiKey !== SETUP_GUIDE_API_KEY_PLACEHOLDER,
    platform: platform,
    arrayName: overrides?.arrayName,
  });
};

const noKeyGuideFor: (platform: StorageArrayPlatform) => SetupGuideContent = (
  platform: StorageArrayPlatform,
): SetupGuideContent => {
  return guideFor(platform, {
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

const variantOf: (
  guide: SetupGuideContent,
  label: string,
) => SetupGuideStepVariant = (
  guide: SetupGuideContent,
  label: string,
): SetupGuideStepVariant => {
  const variant: SetupGuideStepVariant | undefined = (
    stepTitled(guide, "Install the agent").variants || []
  ).find((candidate: SetupGuideStepVariant): boolean => {
    return candidate.label === label;
  });
  if (!variant) {
    throw new Error(`No install tab labelled "${label}"`);
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

const envVariablesOf: (envFile: string) => Map<string, string> = (
  envFile: string,
): Map<string, string> => {
  const variables: Map<string, string> = new Map();
  for (const line of envFile.split("\n")) {
    const index: number = line.indexOf("=");
    variables.set(line.slice(0, index), line.slice(index + 1));
  }
  return variables;
};

const readAgentFile: (name: string) => string = (name: string): string => {
  return fs.readFileSync(path.join(AGENT_DIR, name), "utf8");
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

// `${env:NAME}` placeholders a collector config reads.
const collectorVariables: (config: string) => Set<string> = (
  config: string,
): Set<string> => {
  const variables: Set<string> = new Set();
  for (const match of config.matchAll(/\$\{env:([A-Z0-9_]+)\}/g)) {
    variables.add(match[1]!);
  }
  return variables;
};

const compose: () => Record<string, any> = (): Record<string, any> => {
  return yaml.load(readAgentFile("docker-compose.yml")) as Record<string, any>;
};

describe("the platform picker", () => {
  test("offers the native FlashArray endpoint first, then the older FlashArray, then FlashBlade", () => {
    expect(PLATFORMS).toEqual([
      "flasharray",
      "flasharray-exporter",
      "flashblade",
    ]);
  });

  test("recommends only the native FlashArray endpoint", () => {
    const recommended: Array<string> = STORAGE_ARRAY_PLATFORMS.filter(
      (option: SetupGuideOption<StorageArrayPlatform>): boolean => {
        return Boolean(option.badge);
      },
    ).map((option: SetupGuideOption<StorageArrayPlatform>): string => {
      return option.key;
    });
    expect(recommended).toEqual(["flasharray"]);
  });

  test("every platform has a one-line description", () => {
    for (const option of STORAGE_ARRAY_PLATFORMS) {
      expect(option.description).toBeTruthy();
      expect(option.description).not.toContain("\n");
    }
  });

  /*
   * The release the agent's README and the docs lead with: Pure documents
   * the native endpoint for 6.7.0 and later.
   */
  test("the native option names the Purity//FA release that serves metrics itself", () => {
    expect(STORAGE_ARRAY_PLATFORMS[0]!.description).toContain(
      "Purity//FA 6.7 or later",
    );
  });

  test("an unknown or missing platform resolves to the native FlashArray", () => {
    expect(DEFAULT_STORAGE_ARRAY_PLATFORM).toBe("flasharray");
    expect(resolveStorageArrayPlatform(undefined)).toBe("flasharray");
    expect(resolveStorageArrayPlatform(null)).toBe("flasharray");
    expect(resolveStorageArrayPlatform("netapp")).toBe("flasharray");
    expect(resolveStorageArrayPlatform("flashblade")).toBe("flashblade");
    expect(resolveStorageArrayPlatform("flasharray-exporter")).toBe(
      "flasharray-exporter",
    );
  });

  test("an array's own tab opens on its platform", () => {
    expect(
      getStorageArrayPlatformForSystem(StorageSystem.PureStorageFlashBlade),
    ).toBe("flashblade");
    expect(
      getStorageArrayPlatformForSystem(StorageSystem.PureStorageFlashArray),
    ).toBe("flasharray");
    expect(getStorageArrayPlatformForSystem(undefined)).toBeUndefined();
    expect(getStorageArrayPlatformForSystem("netapp.ontap")).toBeUndefined();
  });

  test("every platform is one shipped config, one storage.system value and one compose profile", () => {
    expect(STORAGE_ARRAY_PLATFORM_SETTINGS["flasharray"]).toMatchObject({
      storageSystem: StorageSystem.PureStorageFlashArray,
      collectorConfigFile: "otel-collector-config.yaml",
      composeProfile: "",
      exporterService: null,
    });
    expect(
      STORAGE_ARRAY_PLATFORM_SETTINGS["flasharray-exporter"],
    ).toMatchObject({
      storageSystem: StorageSystem.PureStorageFlashArray,
      collectorConfigFile: "otel-collector-config.flasharray-exporter.yaml",
      composeProfile: "flasharray-exporter",
      exporterService: STORAGE_ARRAY_FA_EXPORTER_SERVICE,
    });
    expect(STORAGE_ARRAY_PLATFORM_SETTINGS["flashblade"]).toMatchObject({
      storageSystem: StorageSystem.PureStorageFlashBlade,
      collectorConfigFile: "otel-collector-config.flashblade.yaml",
      composeProfile: "flashblade",
      exporterService: STORAGE_ARRAY_FB_EXPORTER_SERVICE,
    });
  });
});

describe.each(PLATFORMS)("the %s guide", (platform: StorageArrayPlatform) => {
  const guide: SetupGuideContent = guideFor(platform);

  test("starts with the read-only user, then (native only) the endpoint check, install and verify", () => {
    const titles: Array<string> = guide.steps.map(
      (step: SetupGuideStep): string => {
        return step.title;
      },
    );
    expect(titles).toEqual(
      platform === "flasharray"
        ? [
            "Create a read-only user and API token",
            "Check the array serves its own metrics",
            "Install the agent",
            "Verify the installation",
          ]
        : [
            "Create a read-only user and API token",
            "Install the agent",
            "Verify the installation",
          ],
    );
  });

  test("every step has a plain one-sentence description", () => {
    for (const step of guide.steps) {
      expect(step.description).toBeTruthy();
      expect(step.description).not.toContain("\n");
      expect(step.description).not.toContain("`");
    }
  });

  test("the install step offers the install script and Docker Compose as tabs", () => {
    expect(
      (stepTitled(guide, "Install the agent").variants || []).map(
        (variant: SetupGuideStepVariant): string => {
          return variant.label;
        },
      ),
    ).toEqual(["Install script", "Docker Compose"]);
  });

  test("lists what must be in place first", () => {
    const prerequisites: string = (guide.prerequisites || []).join("\n");
    expect(prerequisites).toContain("Docker Engine 20.10+");
    expect(prerequisites).toContain("Docker Compose v2");
    expect(prerequisites).toContain("TCP 443");
    expect(prerequisites).toContain("administrator account");
    // Only the exporter platforms pull Pure's image.
    expect(prerequisites.includes("quay.io")).toBe(platform !== "flasharray");
  });

  test("the read-only user gets the readonly role and a token without an expiry", () => {
    const step: SetupGuideStep = stepTitled(
      guide,
      "Create a read-only user and API token",
    );
    const text: string = [
      step.markdown || "",
      ...(step.variants || []).map((variant: SetupGuideStepVariant) => {
        return variant.markdown;
      }),
    ].join("\n");
    expect(text).toContain("readonly");
    expect(text).toContain("without an expiry");
    if (platform === "flashblade") {
      expect(text).toContain("`T-`");
      expect(text).toContain("Purity//FB");
    } else {
      expect(text).toContain(
        `pureadmin create --role readonly ${STORAGE_ARRAY_READ_ONLY_USER}`,
      );
      expect(text).toContain(
        `pureadmin create --api-token ${STORAGE_ARRAY_READ_ONLY_USER}`,
      );
      expect(text).toContain("Settings → Users and Policies");
    }
  });

  test("the verify step checks the collector container and its ready line", () => {
    const step: string =
      stepTitled(guide, "Verify the installation").markdown || "";
    expect(step).toContain(
      `docker ps --filter name=${STORAGE_ARRAY_AGENT_CONTAINER}`,
    );
    expect(step).toContain(`docker logs -f ${STORAGE_ARRAY_AGENT_CONTAINER}`);
    expect(step).toContain(
      "Everything is ready. Begin running and processing data.",
    );
    const exporter: string | null =
      STORAGE_ARRAY_PLATFORM_SETTINGS[platform].exporterService;
    if (exporter) {
      expect(step).toContain(exporter);
    }
  });

  test("has Advanced topics for settings, config, syslog, labels, data, several arrays, systemd and upgrades", () => {
    expect(topicTitles(guide.advanced)).toEqual([
      "Environment variables",
      "How the agent scrapes, and its collector config",
      "Ship the array's syslog",
      "Tag the array with project labels",
      "What the agent collects",
      "Monitor several arrays",
      "Run as a systemd service",
      "Upgrade or uninstall the agent",
    ]);
    for (const topic of guide.advanced || []) {
      expect(topic.summary).toBeTruthy();
      expect(topic.summary).not.toContain("\n");
    }
  });

  test("troubleshooting starts with the diagnostic script and covers the known problems", () => {
    const titles: Array<string> = topicTitles(guide.troubleshooting);
    expect(titles[0]).toBe("Run the diagnostic script first");
    for (const title of [
      "No array appears in OneUptime",
      "The array refuses the API token",
      "x509 or TLS errors",
      "The exporter does not resolve",
      'Array shows as "Disconnected"',
      "Array appears under the wrong name",
    ]) {
      expect(titles).toContain(title);
    }
    // Only a FlashArray can answer 404 for a missing native endpoint.
    expect(titles.includes("The FlashArray answers 404")).toBe(
      platform !== "flashblade",
    );
  });

  test("shows its own shipped collector config verbatim", () => {
    const topic: string = topicTitled(
      guide.advanced,
      "How the agent scrapes, and its collector config",
    ).markdown;
    expect(topic).toContain(
      `This is the full \`${STORAGE_ARRAY_PLATFORM_SETTINGS[platform].collectorConfigFile}\``,
    );
    expect(topic).toContain(STORAGE_ARRAY_COLLECTOR_CONFIGS[platform]);
    for (const other of PLATFORMS) {
      if (other !== platform) {
        expect(topic).not.toContain(STORAGE_ARRAY_COLLECTOR_CONFIGS[other]);
      }
    }
  });

  test("the environment table carries the reader's URL", () => {
    expect(envTableRows(guide).get("ONEUPTIME_URL")?.description).toContain(
      URL,
    );
  });

  test("links to the storage array agent and monitor documentation", () => {
    expect(guide.links).toEqual([
      {
        title: "Storage Array Agent documentation",
        url: "/docs/telemetry/storage-arrays",
      },
      {
        title: "Storage array monitors and alerts",
        url: "/docs/monitor/storage-array-monitor",
      },
    ]);
  });
});

describe("the native FlashArray endpoint check", () => {
  const step: string =
    stepTitled(guideFor("flasharray"), "Check the array serves its own metrics")
      .markdown || "";

  test("asks the array for purefa_info with the read-only token", () => {
    expect(step).toContain(
      "curl -k 'https://<array>/metrics/array?namespace=purefa'",
    );
    expect(step).toContain("Authorization: Bearer <read-only-api-token>");
    expect(step).toContain("grep purefa_info");
  });

  test("says what a 404 means and where to go instead", () => {
    expect(step).toContain("**404**");
    expect(step).toContain("**FlashArray, older Purity**");
    // Pure's documented release, and the one its exporter's notice names.
    expect(step).toContain("6.7.0 and later");
    expect(step).toContain("6.6.11");
  });
});

describe("the install script", () => {
  test.each(PLATFORMS)(
    "carries the reader's URL, key and the %s config on the command line",
    (platform: StorageArrayPlatform) => {
      const command: string = getStorageArrayInstallScriptCommand({
        oneuptimeUrl: URL,
        apiKey: KEY,
        hasApiKey: true,
        platform: platform,
      });
      expect(command.split("\n")).toEqual([
        `curl -sSL ${STORAGE_ARRAY_AGENT_RAW_URL}/install.sh -o install.sh`,
        `ONEUPTIME_URL=${URL} ONEUPTIME_TELEMETRY_INGESTION_KEY=${KEY} STORAGE_ARRAY_COLLECTOR_CONFIG=${STORAGE_ARRAY_PLATFORM_SETTINGS[platform].collectorConfigFile} bash install.sh`,
      ]);
    },
  );

  test("is the command the install step shows", () => {
    for (const platform of PLATFORMS) {
      const variant: string = variantOf(
        guideFor(platform),
        "Install script",
      ).markdown;
      expect(variant).toContain(
        getStorageArrayInstallScriptCommand({
          oneuptimeUrl: URL,
          apiKey: KEY,
          hasApiKey: true,
          platform: platform,
        }),
      );
    }
  });

  test("an array's own tab also passes its name, quoted when the shell would change it", () => {
    expect(
      getStorageArrayInstallScriptCommand({
        oneuptimeUrl: URL,
        apiKey: KEY,
        hasApiKey: true,
        platform: "flasharray",
        arrayName: "fa-prod-01",
      }),
    ).toContain(" STORAGE_ARRAY_NAME=fa-prod-01 ");
    expect(
      getStorageArrayInstallScriptCommand({
        oneuptimeUrl: URL,
        apiKey: KEY,
        hasApiKey: true,
        platform: "flasharray",
        arrayName: "Prod Array #1",
      }),
    ).toContain(" STORAGE_ARRAY_NAME='Prod Array #1' ");
  });

  test("never puts the placeholder key into the script's environment", () => {
    for (const platform of PLATFORMS) {
      const command: string = getStorageArrayInstallScriptCommand({
        oneuptimeUrl: URL,
        apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
        hasApiKey: false,
        platform: platform,
      });
      expect(command).not.toContain(SETUP_GUIDE_API_KEY_PLACEHOLDER);
      expect(command).not.toContain("ONEUPTIME_URL=");
      expect(command.split("\n")[1]).toBe(
        `STORAGE_ARRAY_COLLECTOR_CONFIG=${STORAGE_ARRAY_PLATFORM_SETTINGS[platform].collectorConfigFile} bash install.sh`,
      );
    }
  });

  test("leaves the URL to the prompt while the dashboard does not know it", () => {
    const command: string = getStorageArrayInstallScriptCommand({
      oneuptimeUrl: SETUP_GUIDE_URL_PLACEHOLDER,
      apiKey: KEY,
      hasApiKey: true,
      platform: "flashblade",
    });
    expect(command).not.toContain("ONEUPTIME_URL=");
    expect(command).toContain(`ONEUPTIME_TELEMETRY_INGESTION_KEY=${KEY}`);
  });

  test("before a key is picked, the guide says the script asks for the URL and key", () => {
    const variant: string = variantOf(
      noKeyGuideFor("flasharray"),
      "Install script",
    ).markdown;
    expect(variant).toContain("**OneUptime URL** and **ingestion key**");
  });

  test("with a key, the guide says the command already carries it", () => {
    const variant: string = variantOf(
      guideFor("flasharray"),
      "Install script",
    ).markdown;
    expect(variant).toContain(
      "already carries your OneUptime URL, ingestion key and the platform",
    );
    expect(variant).not.toContain("**OneUptime URL** and **ingestion key**");
  });

  test("says what the script asks for, where it installs, and how it runs", () => {
    const variant: string = variantOf(
      guideFor("flasharray"),
      "Install script",
    ).markdown;
    expect(variant).toContain("**array name**");
    expect(variant).toContain("**management address**");
    expect(variant).toContain("**API token**");
    expect(variant).toContain("verify the array's certificate");
    expect(variant).toContain(STORAGE_ARRAY_AGENT_INSTALL_DIR);
    // The exporters never verify the certificate, so the script does not ask.
    expect(
      variantOf(guideFor("flashblade"), "Install script").markdown,
    ).not.toContain("verify the array's certificate");
  });

  test("on an array's own tab it does not ask for a name it already has", () => {
    const variant: string = variantOf(
      guideFor("flasharray", { arrayName: "fa-prod-01" }),
      "Install script",
    ).markdown;
    expect(variant).not.toContain("**array name**");
    expect(variant).toContain("**`fa-prod-01`**");
  });
});

describe("the Docker Compose install", () => {
  test.each(PLATFORMS)(
    "the %s tab downloads the compose file and every config, writes .env, then starts the agent",
    (platform: StorageArrayPlatform) => {
      const variant: string = variantOf(
        guideFor(platform),
        "Docker Compose",
      ).markdown;
      for (const file of STORAGE_ARRAY_AGENT_FILES) {
        expect(variant).toContain(
          `curl -fsSLO ${STORAGE_ARRAY_AGENT_RAW_URL}/${file}`,
        );
      }
      expect(variant).toContain(STORAGE_ARRAY_AGENT_SOURCE_URL);
      expect(variant).toContain("docker compose up -d");
      expect(variant).toContain("chmod 600 .env");
    },
  );

  test.each(PLATFORMS)(
    "the %s .env file carries the reader's URL and key and the platform's settings",
    (platform: StorageArrayPlatform) => {
      const variables: Map<string, string> = envVariablesOf(
        envFileOf(guideFor(platform)),
      );
      const settings: (typeof STORAGE_ARRAY_PLATFORM_SETTINGS)[StorageArrayPlatform] =
        STORAGE_ARRAY_PLATFORM_SETTINGS[platform];

      expect(variables.get("ONEUPTIME_URL")).toBe(URL);
      expect(variables.get("ONEUPTIME_TELEMETRY_INGESTION_KEY")).toBe(KEY);
      expect(variables.get("STORAGE_ARRAY_NAME")).toBe(
        STORAGE_ARRAY_EXAMPLE_NAME,
      );
      expect(variables.get("STORAGE_SYSTEM")).toBe(settings.storageSystem);
      expect(variables.get("STORAGE_ARRAY_COLLECTOR_CONFIG")).toBe(
        settings.collectorConfigFile,
      );
      expect(variables.get("COMPOSE_PROFILES")).toBe(settings.composeProfile);
      expect(variables.has(settings.endpointVariable)).toBe(true);
      expect(variables.get(settings.tokenVariable)).toBe(
        "<read-only-api-token>",
      );
      // The other platform's address and token never appear.
      const otherEndpoint: string =
        settings.endpointVariable === "PURE_FA_ENDPOINT"
          ? "PURE_FB_ENDPOINT"
          : "PURE_FA_ENDPOINT";
      expect(variables.has(otherEndpoint)).toBe(false);
      // Only the native endpoint verifies (or not) the certificate.
      expect(variables.has("STORAGE_ARRAY_INSECURE_SKIP_VERIFY")).toBe(
        platform === "flasharray",
      );
    },
  );

  test("the exporter platforms say the profile starts the exporter", () => {
    expect(
      variantOf(guideFor("flasharray-exporter"), "Docker Compose").markdown,
    ).toContain(
      `\`COMPOSE_PROFILES=flasharray-exporter\` starts \`${STORAGE_ARRAY_FA_EXPORTER_SERVICE}\``,
    );
    expect(
      variantOf(guideFor("flashblade"), "Docker Compose").markdown,
    ).toContain(
      `\`COMPOSE_PROFILES=flashblade\` starts \`${STORAGE_ARRAY_FB_EXPORTER_SERVICE}\``,
    );
  });

  test("shows the placeholder, and where to pick a key, until one is picked", () => {
    const guide: SetupGuideContent = noKeyGuideFor("flasharray");
    expect(
      envVariablesOf(envFileOf(guide)).get("ONEUPTIME_TELEMETRY_INGESTION_KEY"),
    ).toBe(SETUP_GUIDE_API_KEY_PLACEHOLDER);
    expect(variantOf(guide, "Docker Compose").markdown).toContain(
      `Pick an ingestion key in step 1 to fill in \`${SETUP_GUIDE_API_KEY_PLACEHOLDER}\`.`,
    );
  });

  test("the .env file builder quotes a name the .env file would misread", () => {
    expect(
      getStorageArrayEnvFile({
        oneuptimeUrl: URL,
        apiKey: KEY,
        platform: "flashblade",
        arrayName: "FB #2",
      }),
    ).toContain("STORAGE_ARRAY_NAME='FB #2'");
  });
});

describe("the array name", () => {
  test("a product page suggests a name and says to replace it", () => {
    const variant: string = variantOf(
      guideFor("flasharray"),
      "Docker Compose",
    ).markdown;
    expect(variant).toContain(`Replace \`${STORAGE_ARRAY_EXAMPLE_NAME}\``);
  });

  test("an array's own tab writes its name into .env and says to keep it", () => {
    const guide: SetupGuideContent = guideFor("flashblade", {
      arrayName: "fb-prod-01",
    });
    expect(envVariablesOf(envFileOf(guide)).get("STORAGE_ARRAY_NAME")).toBe(
      "fb-prod-01",
    );
    expect(variantOf(guide, "Docker Compose").markdown).toContain(
      "This installs the agent for **`fb-prod-01`**",
    );
    expect(
      topicTitled(guide.troubleshooting, "Array appears under the wrong name")
        .markdown,
    ).toContain("This array is **`fb-prod-01`**.");
  });

  test("a blank name counts as unknown", () => {
    const guide: SetupGuideContent = guideFor("flasharray", {
      arrayName: "   ",
    });
    expect(envVariablesOf(envFileOf(guide)).get("STORAGE_ARRAY_NAME")).toBe(
      STORAGE_ARRAY_EXAMPLE_NAME,
    );
  });
});

describe("the whole guide reads as one document", () => {
  test.each(PLATFORMS)(
    "the %s guide renders to markdown with every step numbered after the key",
    (platform: StorageArrayPlatform) => {
      const markdown: string = getSetupGuideMarkdown(guideFor(platform));
      expect(markdown).toContain(
        "## Step 2: Create a read-only user and API token",
      );
      expect(markdown).toContain("## Before you start");
      expect(markdown).not.toContain("undefined");
    },
  );
});

describe("drift guards against agents/StorageArrayAgent", () => {
  test.each(PLATFORMS)(
    "the %s collector config is the shipped file, byte for byte",
    (platform: StorageArrayPlatform) => {
      expect(STORAGE_ARRAY_COLLECTOR_CONFIGS[platform]).toBe(
        readAgentFile(
          STORAGE_ARRAY_PLATFORM_SETTINGS[platform].collectorConfigFile,
        ),
      );
    },
  );

  test.each(PLATFORMS)(
    "the %s config stamps storage.array.name and storage.system and drops service.name",
    (platform: StorageArrayPlatform) => {
      const config: Record<string, any> = yaml.load(
        STORAGE_ARRAY_COLLECTOR_CONFIGS[platform],
      ) as Record<string, any>;
      const attributes: Array<Record<string, string>> =
        config["processors"]["resource"]["attributes"];
      const byKey: Map<string, Record<string, string>> = new Map(
        attributes.map((attribute: Record<string, string>) => {
          return [attribute["key"]!, attribute];
        }),
      );
      expect(byKey.get("storage.array.name")).toMatchObject({
        value: "${env:STORAGE_ARRAY_NAME}",
        action: "upsert",
      });
      expect(byKey.get("storage.system")).toMatchObject({
        value: "${env:STORAGE_SYSTEM}",
        action: "upsert",
      });
      expect(byKey.get("service.name")).toMatchObject({ action: "delete" });
      expect(byKey.get("service.instance.id")).toMatchObject({
        action: "delete",
      });
      // A scrape is never split across exports.
      expect(config["processors"]["batch"]["send_batch_max_size"]).toBe(
        undefined,
      );
      // Every scrape job labels its endpoint.
      for (const job of config["receivers"]["prometheus"]["config"][
        "scrape_configs"
      ]) {
        expect(
          job["static_configs"][0]["labels"]["scrape_endpoint"],
        ).toBeTruthy();
      }
    },
  );

  test("the scrape intervals the guide describes are the configs'", () => {
    const intervals: (platform: StorageArrayPlatform) => Map<string, string> = (
      platform: StorageArrayPlatform,
    ): Map<string, string> => {
      const config: Record<string, any> = yaml.load(
        STORAGE_ARRAY_COLLECTOR_CONFIGS[platform],
      ) as Record<string, any>;
      const map: Map<string, string> = new Map();
      for (const job of config["receivers"]["prometheus"]["config"][
        "scrape_configs"
      ]) {
        map.set(
          job["static_configs"][0]["labels"]["scrape_endpoint"],
          job["scrape_interval"],
        );
      }
      return map;
    };

    expect(intervals("flasharray")).toEqual(
      new Map([
        ["array", "60s"],
        ["volumes", "120s"],
        ["hosts", "120s"],
        ["pods", "120s"],
        ["directories", "30m"],
      ]),
    );
    expect(intervals("flashblade")).toEqual(
      new Map([
        ["array", "60s"],
        ["filesystems", "300s"],
        ["objectstore", "300s"],
      ]),
    );

    const flashArrayTopic: string = topicTitled(
      guideFor("flasharray").advanced,
      "How the agent scrapes, and its collector config",
    ).markdown;
    expect(flashArrayTopic).toContain("`/metrics/array` every 60 seconds");
    expect(flashArrayTopic).toContain(
      "`/metrics/volumes`, `/metrics/hosts` and `/metrics/pods` every 2 minutes",
    );
    expect(flashArrayTopic).toContain(
      "`/metrics/directories` every 30 minutes",
    );

    const flashBladeTopic: string = topicTitled(
      guideFor("flashblade").advanced,
      "How the agent scrapes, and its collector config",
    ).markdown;
    expect(flashBladeTopic).toContain(
      "`/metrics/filesystems` and `/metrics/objectstore` every 5 minutes",
    );
  });

  test("the environment table documents exactly what the collectors and compose file read", () => {
    const read: Set<string> = new Set<string>(["COMPOSE_PROFILES"]);
    for (const platform of PLATFORMS) {
      for (const variable of collectorVariables(
        STORAGE_ARRAY_COLLECTOR_CONFIGS[platform],
      )) {
        read.add(variable);
      }
    }
    for (const match of readAgentFile("docker-compose.yml").matchAll(
      /\$\{([A-Z0-9_]+)(?::-[^}]*)?\}/g,
    )) {
      read.add(match[1]!);
    }

    expect(new Set(envTableRows(guideFor("flasharray")).keys())).toEqual(read);
  });

  test("the defaults the table gives are the compose file's", () => {
    const composeSource: string = readAgentFile("docker-compose.yml");
    const rows: Map<string, { required: string; description: string }> =
      envTableRows(guideFor("flasharray"));

    expect(composeSource).toContain(
      "STORAGE_SYSTEM=${STORAGE_SYSTEM:-purestorage.flasharray}",
    );
    expect(rows.get("STORAGE_SYSTEM")?.description).toContain(
      "(default: `purestorage.flasharray`)",
    );
    expect(composeSource).toContain(
      "STORAGE_ARRAY_INSECURE_SKIP_VERIFY=${STORAGE_ARRAY_INSECURE_SKIP_VERIFY:-true}",
    );
    expect(
      rows.get("STORAGE_ARRAY_INSECURE_SKIP_VERIFY")?.description,
    ).toContain("(default: `true`)");
    expect(composeSource).toContain(
      "${STORAGE_ARRAY_COLLECTOR_CONFIG:-otel-collector-config.yaml}",
    );
  });

  test("every .env block sets only variables the agent reads", () => {
    const read: Set<string> = new Set(
      envTableRows(guideFor("flasharray")).keys(),
    );
    for (const platform of PLATFORMS) {
      for (const variable of envVariablesOf(
        envFileOf(guideFor(platform)),
      ).keys()) {
        expect({ platform, variable, read: read.has(variable) }).toEqual({
          platform,
          variable,
          read: true,
        });
      }
    }
  });

  test("the install script honours every variable the guide presets", () => {
    const install: string = readAgentFile("install.sh");
    for (const variable of [
      "ONEUPTIME_URL",
      "ONEUPTIME_TELEMETRY_INGESTION_KEY",
      "STORAGE_ARRAY_NAME",
      "STORAGE_ARRAY_COLLECTOR_CONFIG",
    ]) {
      // A preset value skips the prompt (`if` or a re-asking `while`).
      expect(install).toMatch(
        new RegExp(`(if|while) \\[ -z "\\$${variable}" \\]`),
      );
    }
    // The config decides the platform and the compose profile.
    for (const platform of PLATFORMS) {
      const settings: (typeof STORAGE_ARRAY_PLATFORM_SETTINGS)[StorageArrayPlatform] =
        STORAGE_ARRAY_PLATFORM_SETTINGS[platform];
      expect(install).toContain(`${settings.collectorConfigFile})`);
      expect(install).toContain(`STORAGE_SYSTEM="${settings.storageSystem}"`);
      expect(install).toContain(
        `COMPOSE_PROFILES="${settings.composeProfile}"`,
      );
    }
  });

  test("the install script installs where the guide says", () => {
    expect(readAgentFile("install.sh")).toContain(
      `INSTALL_DIR="\${INSTALL_DIR:-${STORAGE_ARRAY_AGENT_INSTALL_DIR}}"`,
    );
  });

  test("every file the guide downloads or names exists in the agent's directory", () => {
    for (const file of [
      ...STORAGE_ARRAY_AGENT_FILES,
      "install.sh",
      "troubleshoot.sh",
      "systemd/oneuptime-storage-array-agent.service",
    ]) {
      expect({
        file,
        exists: fs.existsSync(path.join(AGENT_DIR, file)),
      }).toEqual({ file, exists: true });
    }
  });

  test("the containers, services and profiles the guide names are the compose file's", () => {
    const services: Record<string, any> = compose()["services"];
    expect(services[STORAGE_ARRAY_AGENT_CONTAINER]["container_name"]).toBe(
      STORAGE_ARRAY_AGENT_CONTAINER,
    );
    expect(services[STORAGE_ARRAY_FA_EXPORTER_SERVICE]["profiles"]).toEqual([
      "flasharray-exporter",
    ]);
    expect(services[STORAGE_ARRAY_FB_EXPORTER_SERVICE]["profiles"]).toEqual([
      "flashblade",
    ]);
    // The exporter configs scrape those services on the compose network.
    expect(STORAGE_ARRAY_COLLECTOR_CONFIGS["flasharray-exporter"]).toContain(
      `${STORAGE_ARRAY_FA_EXPORTER_SERVICE}:9490`,
    );
    expect(STORAGE_ARRAY_COLLECTOR_CONFIGS["flashblade"]).toContain(
      `${STORAGE_ARRAY_FB_EXPORTER_SERVICE}:9491`,
    );
  });

  test("the lines the syslog topic uncomments are in the shipped files", () => {
    for (const platform of PLATFORMS) {
      const config: string = STORAGE_ARRAY_COLLECTOR_CONFIGS[platform];
      expect(config).toContain("# syslog/tcp:");
      expect(config).toContain("# syslog/udp:");
      expect(config).toContain("# logs:");
      expect(config).toContain(`0.0.0.0:${STORAGE_ARRAY_SYSLOG_PORT}`);
    }
    const composeSource: string = readAgentFile("docker-compose.yml");
    expect(composeSource).toContain(
      `#   - "${STORAGE_ARRAY_SYSLOG_PORT}:${STORAGE_ARRAY_SYSLOG_PORT}/tcp"`,
    );
    expect(composeSource).toContain(
      `#   - "${STORAGE_ARRAY_SYSLOG_PORT}:${STORAGE_ARRAY_SYSLOG_PORT}/udp"`,
    );
  });

  test("the diagnostic script takes -d and defaults to the install directory", () => {
    const script: string = readAgentFile("troubleshoot.sh");
    expect(script).toContain(`DIR="${STORAGE_ARRAY_AGENT_INSTALL_DIR}"`);
    expect(script).toContain("-d|--dir)");
  });

  test("the systemd unit the guide installs is the shipped one", () => {
    const unit: string = readAgentFile(
      "systemd/oneuptime-storage-array-agent.service",
    );
    expect(unit).toContain(STORAGE_ARRAY_AGENT_INSTALL_DIR);
    const topic: string = topicTitled(
      guideFor("flasharray").advanced,
      "Run as a systemd service",
    ).markdown;
    expect(topic).toContain(
      "sudo systemctl enable --now oneuptime-storage-array-agent",
    );
  });
});
