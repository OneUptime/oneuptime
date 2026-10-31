import { describe, expect, test } from "@jest/globals";
import {
  INSTALL_SCRIPT_READ_FIRST_NOTE,
  getAgentFileDownloadCommand,
  getAgentFileDownloadToCommand,
  getInstallScriptDownloadCommand,
  getTroubleshootScriptDownloadCommand,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/AgentInstallCommands";
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

  return all;
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
    for (const surface of surfaces) {
      expect({
        surface: surface.name,
        github: surface.text.includes("raw.githubusercontent.com"),
      }).toEqual({ surface: surface.name, github: false });
      expect({
        surface: surface.name,
        tree: surface.text.includes("github.com/OneUptime/oneuptime/tree"),
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
        for (const match of block.matchAll(INSTALL_COMMAND_URL)) {
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
        // The Kubernetes agent's script is in the docs and its chart's notes.
        return entry.name !== InstallScriptName.KubernetesAgent;
      })
        .map((entry: InstallScriptEntry): string => {
          return entry.name;
        })
        .sort(),
    );
  });
});
