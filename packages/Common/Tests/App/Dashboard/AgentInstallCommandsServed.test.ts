import { describe, expect, test } from "@jest/globals";
import {
  INSTALL_SCRIPT_READ_FIRST_NOTE,
  getAgentFileDownloadCommand,
  getAgentFileDownloadToCommand,
  getInstallScriptDownloadCommand,
  getInstallScriptRunCommand,
  getTroubleshootScriptDownloadCommand,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/AgentInstallCommands";
import { joinContinuedLines } from "./InstallCommandLines";
import {
  SETUP_GUIDE_URL_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideOption,
  getSetupGuideCodeBlocks,
  getSetupGuideMarkdown,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import {
  PROXMOX_CONNECT_METHODS,
  ProxmoxConnectMethod,
  getProxmoxSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/Utils/DocumentationMarkdown";
import {
  CEPH_INSTALL_METHODS,
  CephInstallMethod,
  getCephSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/Utils/DocumentationMarkdown";
import {
  VMWARE_INSTALL_METHODS,
  VMwareInstallMethod,
  getVMwareSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Utils/DocumentationMarkdown";
import {
  STORAGE_ARRAY_PLATFORMS,
  StorageArrayPlatform,
  getStorageArraySetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/Utils/DocumentationMarkdown";
import { getDatabaseAgentSetupGuide } from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DocumentationMarkdown";
import {
  DATABASE_AGENT_ENGINES,
  DatabaseAgentEngine,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseAgentConfigs";
import {
  DOCKER_SWARM_INSTALL_METHODS,
  DockerSwarmInstallMethod,
  getDockerSwarmSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/Utils/DocumentationMarkdown";
import {
  HOST_COLLECTOR_METHODS,
  HostCollectorMethod,
  getHostSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/Utils/DocumentationMarkdown";
import {
  ResourceConnectionGuide,
  ResourceConnectionGuideStep,
  getCephClusterConnectionGuide,
  getDockerSwarmClusterConnectionGuide,
  getProxmoxClusterConnectionGuide,
  getStorageArrayConnectionGuide,
  getVMwareVCenterConnectionGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceConnection/ResourceConnectionGuides";
import {
  AgentUpgradeGuide,
  getAgentUpgradeGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AgentVersion/AgentUpgradeGuides";
import { AgentKind } from "../../../../App/FeatureSet/Dashboard/src/Components/AgentVersion/AgentKind";
import { getResourceAiAgentInstall } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentInstall";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  INSTALL_SCRIPTS,
  InstallScriptEntry,
  InstallScriptName,
  getInstallScriptEntry,
} from "../../../Types/InstallScripts/InstallScripts";
import { escapeRegExp } from "../../../Utils/RegExpEscape";
import {
  DeveloperDocsGuide,
  getDeveloperDocsGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsGuides";
import {
  DeveloperDocsPageType,
  DeveloperDocsScope,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsPages";
import { getDeveloperDocsResource } from "../../../../App/FeatureSet/Dashboard/src/Components/DeveloperDocs/DeveloperDocsResources";
import Incident from "../../../Models/DatabaseModels/Incident";

/*
 * Every agent install command the Dashboard shows downloads from the
 * OneUptime the reader uses - the setup guides, the upgrade dialog, the
 * "how do I connect this?" card and the AI agent page - never from GitHub.
 * Every OneUptime serves its agents' install scripts and files for its own
 * release (Common/Types/InstallScripts), so a self-hosted install hands out
 * its own agents, on its own host.
 *
 * Held here across every guide, every install method and four kinds of
 * address: OneUptime Cloud, a self-hosted domain with a port, an address
 * over plain HTTP, and one under a path prefix.
 */

const KEY: string = "tik_secret_123";

const READER_URLS: Array<string> = [
  "https://oneuptime.com",
  "https://oneuptime.acme.internal:8443",
  "http://10.0.0.5",
  "https://tools.acme.com/oneuptime",
];

// Every address of an agent's install script or file a command names.
const SERVED_ADDRESS: RegExp =
  /(\S*?)\/install\/([a-z-]+)(?:\/([A-Za-z0-9._/-]+))?(?=[\s'")]|$)/g;

// The URL an install command hands the script it runs.
const INSTALL_COMMAND_URL: RegExp =
  /(?:^|\s)ONEUPTIME_URL=(\S+)[^\n]*\binstall\.sh$/gm;

// A value a command line hands its command: NAME=value, starting a word.
const COMMAND_LINE_VALUE: RegExp = /(?:^|\s)[A-Z][A-Z0-9_]*=/g;

// A line that runs a downloaded install script.
const RUNS_INSTALL_SCRIPT: RegExp = /(?:^|\s)(?:ba)?sh install\.sh(?:\s|$)/;

/*
 * The most characters a line of an install command may take on OneUptime
 * Cloud: the code block beside the side menu holds about 95 at 1280 pixels
 * wide, and a few are left for a longer key or address.
 */
const INSTALL_COMMAND_LINE_MAX_LENGTH: number = 90;

// A key as the key picker hands it to the guides (a uuid), for the widths.
const UUID_KEY: string = "94245962-5a3e-46a1-ac4c-7d9c1e43e7dc";

// How many NAME=value words a line hands its command.
function valuesOn(line: string): number {
  return (line.match(COMMAND_LINE_VALUE) || []).length;
}

interface Commands {
  name: string;
  oneuptimeUrl: string;
  // The code blocks or commands a reader copies.
  blocks: Array<string>;
  // Everything the reader reads, prose included.
  text: string;
}

function guideCommands(
  name: string,
  oneuptimeUrl: string,
  guide: SetupGuideContent,
): Commands {
  return {
    name,
    oneuptimeUrl,
    blocks: getSetupGuideCodeBlocks(guide),
    text: getSetupGuideMarkdown(guide),
  };
}

function connectionCommands(
  name: string,
  oneuptimeUrl: string,
  guide: ResourceConnectionGuide,
): Commands {
  const steps: Array<ResourceConnectionGuideStep> = [
    ...guide.setupSteps,
    ...guide.troubleshootingSteps,
  ];
  const blocks: Array<string> = steps
    .map((step: ResourceConnectionGuideStep): string => {
      return step.code || "";
    })
    .filter((code: string): boolean => {
      return code.length > 0;
    });

  return { name, oneuptimeUrl, blocks, text: blocks.join("\n") };
}

function upgradeCommands(
  name: string,
  oneuptimeUrl: string,
  guide: AgentUpgradeGuide | null,
): Commands {
  const blocks: Array<string> = [];

  for (const method of guide?.methods || []) {
    for (const step of method.steps) {
      if (step.code) {
        blocks.push(step.code);
      }
    }
  }

  return { name, oneuptimeUrl, blocks, text: blocks.join("\n") };
}

function keysOf<TKey extends string>(
  options: ReadonlyArray<SetupGuideOption<TKey>>,
): Array<TKey> {
  return options.map((option: SetupGuideOption<TKey>): TKey => {
    return option.key;
  });
}

// Every command surface, for one reader's OneUptime.
function everyCommand(oneuptimeUrl: string): Array<Commands> {
  const all: Array<Commands> = [];

  for (const method of keysOf<ProxmoxConnectMethod>(PROXMOX_CONNECT_METHODS)) {
    all.push(
      guideCommands(
        `Proxmox guide (${method})`,
        oneuptimeUrl,
        getProxmoxSetupGuide({
          oneuptimeUrl,
          apiKey: KEY,
          hasApiKey: true,
          method,
        }),
      ),
    );
  }

  for (const method of keysOf<CephInstallMethod>(CEPH_INSTALL_METHODS)) {
    all.push(
      guideCommands(
        `Ceph guide (${method})`,
        oneuptimeUrl,
        getCephSetupGuide({
          oneuptimeUrl,
          apiKey: KEY,
          hasApiKey: true,
          method,
        }),
      ),
    );
  }

  for (const method of keysOf<VMwareInstallMethod>(VMWARE_INSTALL_METHODS)) {
    all.push(
      guideCommands(
        `VMware guide (${method})`,
        oneuptimeUrl,
        getVMwareSetupGuide({
          oneuptimeUrl,
          apiKey: KEY,
          hasApiKey: true,
          method,
        }),
      ),
    );
  }

  for (const platform of keysOf<StorageArrayPlatform>(
    STORAGE_ARRAY_PLATFORMS,
  )) {
    all.push(
      guideCommands(
        `Storage Array guide (${platform})`,
        oneuptimeUrl,
        getStorageArraySetupGuide({
          oneuptimeUrl,
          apiKey: KEY,
          hasApiKey: true,
          platform,
        }),
      ),
    );
  }

  for (const engine of DATABASE_AGENT_ENGINES) {
    all.push(
      guideCommands(
        `Database guide (${engine})`,
        oneuptimeUrl,
        getDatabaseAgentSetupGuide({
          oneuptimeUrl,
          apiKey: KEY,
          hasApiKey: true,
          engine: engine as DatabaseAgentEngine,
          database: {
            id: "3c1e9a52-1f2b-4c3d-9e8f-0a1b2c3d4e5f",
            dbSystem: engine,
            endpoints: ["db.data.svc.cluster.local:5432@prod"],
            kubernetesNamespace: "data",
            isKubernetes: true,
          },
        }),
      ),
    );
  }

  for (const method of keysOf<DockerSwarmInstallMethod>(
    DOCKER_SWARM_INSTALL_METHODS,
  )) {
    all.push(
      guideCommands(
        `Docker Swarm guide (${method})`,
        oneuptimeUrl,
        getDockerSwarmSetupGuide({ oneuptimeUrl, apiKey: KEY, method }),
      ),
    );
  }

  for (const method of HOST_COLLECTOR_METHODS as ReadonlyArray<HostCollectorMethod>) {
    all.push(
      guideCommands(
        `Host guide (${method})`,
        oneuptimeUrl,
        getHostSetupGuide({ oneuptimeUrl, apiKey: KEY, method }),
      ),
    );
  }

  all.push(
    connectionCommands(
      "Docker Swarm card",
      oneuptimeUrl,
      getDockerSwarmClusterConnectionGuide("prod-swarm", oneuptimeUrl),
    ),
    connectionCommands(
      "Proxmox card",
      oneuptimeUrl,
      getProxmoxClusterConnectionGuide("pve-prod", oneuptimeUrl),
    ),
    connectionCommands(
      "Ceph card",
      oneuptimeUrl,
      getCephClusterConnectionGuide("ceph-prod", oneuptimeUrl),
    ),
    connectionCommands(
      "Storage Array card",
      oneuptimeUrl,
      getStorageArrayConnectionGuide("fa-prod-01", oneuptimeUrl),
    ),
    connectionCommands(
      "VMware card",
      oneuptimeUrl,
      getVMwareVCenterConnectionGuide("vcsa-prod", oneuptimeUrl),
    ),
  );

  for (const kind of Object.values(AgentKind)) {
    all.push(
      upgradeCommands(
        `upgrade dialog (${kind})`,
        oneuptimeUrl,
        getAgentUpgradeGuide(kind, {
          oneuptimeUrl,
          databaseEngine: "postgresql",
          databaseRunsInKubernetes: true,
        }),
      ),
    );
  }

  const hostAgent: string | null = getResourceAiAgentInstall({
    resourceType: AiResourceType.Host,
    resourceId: "3c1e9a52-1f2b-4c3d-9e8f-0a1b2c3d4e5f",
    oneuptimeUrl,
  }).installerCommand;

  all.push({
    name: "Host AI agent page",
    oneuptimeUrl,
    blocks: hostAgent ? [hostAgent] : [],
    text: hostAgent || "",
  });

  // Developer > CLI, whose first step installs the CLI with /install/cli.
  all.push(
    developerCliCommands(
      "Developer > CLI page (Incidents)",
      oneuptimeUrl,
      getDeveloperDocsGuide(DeveloperDocsPageType.Cli, {
        resource: getDeveloperDocsResource(Incident),
        scope: DeveloperDocsScope.List,
        oneuptimeUrl,
        platformVersion: "14.0.101",
        apiKeysUrl: "/dashboard/settings/api-keys",
      }),
    ),
  );

  return all;
}

const CODE_FENCE: string = "```";

// A Developer page's code blocks, and everything it says.
function developerCliCommands(
  name: string,
  oneuptimeUrl: string,
  guide: DeveloperDocsGuide,
): Commands {
  const markdown: Array<string> = [];

  for (const step of guide.steps) {
    markdown.push(step.markdown || "");

    for (const variant of step.variants || []) {
      markdown.push(variant.markdown);
    }
  }

  const blocks: Array<string> = [];

  for (const text of markdown) {
    const parts: Array<string> = text.split(CODE_FENCE);

    for (let index: number = 1; index < parts.length; index += 2) {
      const part: string = parts[index] || "";

      blocks.push(part.slice(part.indexOf("\n") + 1).trimEnd());
    }
  }

  return { name, oneuptimeUrl, blocks, text: markdown.join("\n") };
}

describe("the commands that download an agent's files", () => {
  test("an install script, from the reader's OneUptime, failing on an error page", () => {
    expect(
      getInstallScriptDownloadCommand(
        "https://oneuptime.com",
        InstallScriptName.ProxmoxAgent,
      ),
    ).toBe(
      "curl -fsSL https://oneuptime.com/install/proxmox-agent -o install.sh",
    );
  });

  test("one of its files, under its own name or another", () => {
    expect(
      getAgentFileDownloadCommand(
        "https://oneuptime.com/",
        InstallScriptName.CephAgent,
        "docker-compose.yml",
      ),
    ).toBe(
      "curl -fsSLO https://oneuptime.com/install/ceph-agent/docker-compose.yml",
    );
    expect(
      getAgentFileDownloadToCommand(
        "http://10.0.0.5",
        InstallScriptName.DatabaseAgent,
        "configs/mysql.yaml",
        "otel-collector-config.yaml",
      ),
    ).toBe(
      "curl -fsSL http://10.0.0.5/install/database-agent/configs/mysql.yaml -o otel-collector-config.yaml",
    );
    expect(
      getTroubleshootScriptDownloadCommand(
        "https://tools.acme.com/oneuptime",
        InstallScriptName.KubernetesAgent,
      ),
    ).toBe(
      "curl -fsSL https://tools.acme.com/oneuptime/install/kubernetes-agent/troubleshoot.sh -o troubleshoot.sh",
    );
  });

  test("a placeholder address is quoted, so a pasted command never reads it as a redirection", () => {
    expect(
      getInstallScriptDownloadCommand(
        SETUP_GUIDE_URL_PLACEHOLDER,
        InstallScriptName.VMwareAgent,
      ),
    ).toBe(
      `curl -fsSL '${SETUP_GUIDE_URL_PLACEHOLDER}/install/vmware-agent' -o install.sh`,
    );
  });

  test("with no address configured, every surface quotes the placeholder wherever a command downloads from it", () => {
    const address: string = `${SETUP_GUIDE_URL_PLACEHOLDER}/install/`;
    let downloads: number = 0;

    for (const surface of everyCommand(SETUP_GUIDE_URL_PLACEHOLDER)) {
      for (const block of surface.blocks) {
        let at: number = block.indexOf(address);

        while (at !== -1) {
          downloads++;
          // A bare <...> would be read as a redirection by the shell.
          expect({
            surface: surface.name,
            quoted: block.charAt(at - 1),
          }).toEqual({ surface: surface.name, quoted: "'" });
          at = block.indexOf(address, at + address.length);
        }
      }
    }

    // The guides, the cards, the upgrade dialogs and the AI agent page.
    expect(downloads).toBeGreaterThan(40);
  });

  test("a run line of two values or more puts each on a line of its own, as one command", () => {
    expect(getInstallScriptRunCommand([], "bash install.sh")).toBe(
      "bash install.sh",
    );
    expect(
      getInstallScriptRunCommand(
        ["ONEUPTIME_URL='https://oneuptime.acme.com'"],
        "sh install.sh",
      ),
    ).toBe("ONEUPTIME_URL='https://oneuptime.acme.com' sh install.sh");
    expect(
      getInstallScriptRunCommand(
        [
          "ONEUPTIME_URL=https://oneuptime.com",
          `ONEUPTIME_TELEMETRY_INGESTION_KEY=${UUID_KEY}`,
          "STORAGE_ARRAY_NAME='Prod Array #1'",
        ],
        "bash install.sh",
      ),
    ).toBe(
      [
        "ONEUPTIME_URL=https://oneuptime.com \\",
        `  ONEUPTIME_TELEMETRY_INGESTION_KEY=${UUID_KEY} \\`,
        "  STORAGE_ARRAY_NAME='Prod Array #1' \\",
        "  bash install.sh",
      ].join("\n"),
    );
  });

  test("the note says the script is a file to read before it runs", () => {
    expect(INSTALL_SCRIPT_READ_FIRST_NOTE).toBe(
      "The first line downloads the script as install.sh, so you can read it before you run it.",
    );
  });
});

describe.each(READER_URLS)("on %s", (oneuptimeUrl: string) => {
  const surfaces: Array<Commands> = everyCommand(oneuptimeUrl);

  test("every surface was read", () => {
    expect(surfaces.length).toBeGreaterThan(40);
  });

  test("no command or sentence sends anyone to GitHub for an agent's files", () => {
    /*
     * Any mention of either, with the dots matched as dots: a pattern, not a
     * substring test of an address (CodeQL's incomplete URL substring
     * sanitization, 14.0.100's first gate).
     */
    const rawGitHub: RegExp = /\braw\.githubusercontent\.com\b/;
    const repositoryTree: RegExp =
      /\bgithub\.com\/OneUptime\/oneuptime\/tree\b/;

    for (const surface of surfaces) {
      expect({
        surface: surface.name,
        github: rawGitHub.test(surface.text),
      }).toEqual({ surface: surface.name, github: false });
      expect({
        surface: surface.name,
        tree: repositoryTree.test(surface.text),
      }).toEqual({ surface: surface.name, tree: false });
    }
  });

  test("every address of an agent's file is on the reader's OneUptime, and is a file it serves", () => {
    let addresses: number = 0;

    for (const surface of surfaces) {
      for (const block of surface.blocks) {
        for (const match of block.matchAll(SERVED_ADDRESS)) {
          addresses++;
          const base: string = (match[1] || "").replace(/^'/, "");
          const entry: InstallScriptEntry | null = getInstallScriptEntry(
            match[2],
          );
          const file: string | null = match[3] || entry?.script || null;

          expect({ surface: surface.name, base }).toEqual({
            surface: surface.name,
            base: oneuptimeUrl,
          });
          expect({ surface: surface.name, entry: Boolean(entry) }).toEqual({
            surface: surface.name,
            entry: true,
          });
          expect({
            surface: surface.name,
            file,
            served: Boolean(file && entry?.files.includes(file)),
          }).toEqual({ surface: surface.name, file, served: true });
        }
      }
    }

    expect(addresses).toBeGreaterThan(50);
  });

  test("every download is curl -f: an error page is never saved as a script or a config", () => {
    const download: RegExp = new RegExp(
      `curl (-\\S+) '?${escapeRegExp(oneuptimeUrl)}/install/`,
      "g",
    );

    for (const surface of surfaces) {
      for (const block of surface.blocks) {
        for (const match of block.matchAll(download)) {
          expect({ surface: surface.name, flags: match[1] }).toEqual({
            surface: surface.name,
            flags: expect.stringContaining("f"),
          });
        }
      }
    }
  });

  test("ONEUPTIME_URL on a command line is the address the script came from", () => {
    let commands: number = 0;

    for (const surface of surfaces) {
      for (const block of surface.blocks) {
        // As a shell reads it: a long run line goes on over several.
        for (const match of joinContinuedLines(block).matchAll(
          INSTALL_COMMAND_URL,
        )) {
          commands++;
          expect({ surface: surface.name, url: match[1] }).toEqual({
            surface: surface.name,
            url: oneuptimeUrl,
          });
        }
      }
    }

    // The guides with a key picked, and (off OneUptime Cloud) the Swarm script's default.
    expect(commands).toBeGreaterThan(10);
  });
});

/*
 * A run line handing its script two values or more - the URL, the key, the
 * platform, a database's identity - ran past the code block on one line:
 * the key and "bash install.sh" sat behind a sideways scroll at 1280
 * pixels, and a self-hosted address hid even the start of the key. Each
 * value is on a line of its own instead, every line but the last ending in
 * a backslash, so the whole command reads where it is shown.
 */
describe("every run line reads whole where it is shown", () => {
  const surfaces: Array<Commands> = everyCommand("https://oneuptime.com");

  test("a line that runs an install script hands it one value at most", () => {
    let runLines: number = 0;

    for (const surface of surfaces) {
      for (const block of surface.blocks) {
        for (const line of block.split("\n")) {
          if (!RUNS_INSTALL_SCRIPT.test(line)) {
            continue;
          }
          runLines++;
          expect({
            surface: surface.name,
            line,
            isOneValueAtMost: valuesOn(line) <= 1,
          }).toEqual({ surface: surface.name, line, isOneValueAtMost: true });
        }
      }
    }

    // The guides, their upgrade topics and the upgrade dialogs.
    expect(runLines).toBeGreaterThan(30);
  });

  test("a line that goes on over the next hands its command exactly one value", () => {
    let continued: number = 0;

    for (const surface of surfaces) {
      for (const block of surface.blocks) {
        if (!RUNS_INSTALL_SCRIPT.test(joinContinuedLines(block))) {
          continue;
        }

        const lines: Array<string> = block.split("\n");

        for (let index: number = 0; index < lines.length - 1; index++) {
          const line: string = lines[index]!;

          if (!line.endsWith(" \\") || !lines[index + 1]!.startsWith("  ")) {
            continue;
          }
          continued++;
          expect({
            surface: surface.name,
            line,
            values: valuesOn(line),
          }).toEqual({ surface: surface.name, line, values: 1 });
        }
      }
    }

    // The guides with a key picked: Proxmox, Ceph, VMware, the arrays, the databases.
    expect(continued).toBeGreaterThan(20);
  });

  test("on OneUptime Cloud, with a key picked, no line of an install command is wider than the code block at 1280 pixels", () => {
    const cloud: string = "https://oneuptime.com";
    const guides: Array<Commands> = [
      guideCommands(
        "Proxmox guide",
        cloud,
        getProxmoxSetupGuide({
          oneuptimeUrl: cloud,
          apiKey: UUID_KEY,
          hasApiKey: true,
          method: "install-script",
        }),
      ),
      guideCommands(
        "Ceph guide",
        cloud,
        getCephSetupGuide({
          oneuptimeUrl: cloud,
          apiKey: UUID_KEY,
          hasApiKey: true,
          method: "install-script",
        }),
      ),
      guideCommands(
        "VMware guide",
        cloud,
        getVMwareSetupGuide({
          oneuptimeUrl: cloud,
          apiKey: UUID_KEY,
          hasApiKey: true,
          method: "install-script",
        }),
      ),
      ...keysOf<StorageArrayPlatform>(STORAGE_ARRAY_PLATFORMS).map(
        (platform: StorageArrayPlatform): Commands => {
          return guideCommands(
            `Storage Array guide (${platform})`,
            cloud,
            getStorageArraySetupGuide({
              oneuptimeUrl: cloud,
              apiKey: UUID_KEY,
              hasApiKey: true,
              platform,
              arrayName: "fa-prod-01",
            }),
          );
        },
      ),
      ...DATABASE_AGENT_ENGINES.map((engine: string): Commands => {
        return guideCommands(
          `Database guide (${engine})`,
          cloud,
          getDatabaseAgentSetupGuide({
            oneuptimeUrl: cloud,
            apiKey: UUID_KEY,
            hasApiKey: true,
            engine: engine as DatabaseAgentEngine,
            database: {
              id: "3c1e9a52-1f2b-4c3d-9e8f-0a1b2c3d4e5f",
              dbSystem: engine,
              serverAddress: "db.prod.internal",
              serverPort: 5432,
            },
          }),
        );
      }),
    ];
    let lines: number = 0;

    for (const guide of guides) {
      for (const block of guide.blocks) {
        const blockLines: Array<string> = block.split("\n");
        // From the line that downloads the script to the line that runs it.
        const start: number = blockLines.findIndex((line: string): boolean => {
          return line.endsWith(" -o install.sh");
        });
        const end: number = blockLines.findIndex((line: string): boolean => {
          return RUNS_INSTALL_SCRIPT.test(line);
        });

        if (start === -1 || end < start) {
          continue;
        }

        for (const line of blockLines.slice(start, end + 1)) {
          lines++;
          expect({
            guide: guide.name,
            line,
            fits: line.length <= INSTALL_COMMAND_LINE_MAX_LENGTH,
          }).toEqual({ guide: guide.name, line, fits: true });
        }
      }
    }

    expect(lines).toBeGreaterThan(40);
  });
});

describe("the served list covers every agent the Dashboard installs with a script", () => {
  test("each guide's install script is a served entry with a script", () => {
    const named: Set<string> = new Set();

    for (const surface of everyCommand("https://oneuptime.com")) {
      for (const block of surface.blocks) {
        for (const match of block.matchAll(SERVED_ADDRESS)) {
          named.add(match[2]!);
        }
      }
    }

    expect([...named].sort()).toEqual(
      INSTALL_SCRIPTS.filter((entry: InstallScriptEntry): boolean => {
        /*
         * The Kubernetes agent's script is in the docs and its chart's
         * notes. The Docker and Podman agents' guides start the agent's
         * image (docker run, podman run or a Compose file they show); their
         * scripts are in the docs and the agents' READMEs. The air-gapped
         * image bundle's script is no agent: it carries a release into a
         * network with no internet, on a machine that may have no
         * OneUptime yet, so the docs' Air-Gapped Installation page hands it
         * out (from OneUptime Cloud), never a Dashboard guide.
         */
        return ![
          InstallScriptName.KubernetesAgent,
          InstallScriptName.DockerAgent,
          InstallScriptName.PodmanAgent,
          InstallScriptName.AirGapped,
        ].includes(entry.name);
      })
        .map((entry: InstallScriptEntry): string => {
          return entry.name;
        })
        .sort(),
    );
  });
});
