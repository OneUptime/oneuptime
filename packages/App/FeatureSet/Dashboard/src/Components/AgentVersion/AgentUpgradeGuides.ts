import { AgentKind } from "./AgentKind";
import {
  DATABASE_AGENT_INSTALL_DIRECTORY,
  DATABASE_AGENT_RECREATE_COMMAND,
  getDatabaseAgentDownloadCommand,
  getDatabaseAgentUpgradeCommand,
} from "../../Pages/Database/Utils/DocumentationMarkdown";
import { DatabaseAgentEngine } from "../../Pages/Database/Utils/DatabaseAgentConfigs";
import { getDockerAgentUpgradeCommand } from "../../Pages/Docker/Utils/DocumentationMarkdown";
import {
  DOCKER_SWARM_AGENT_COMPOSE_UPGRADE_COMMAND,
  getDockerSwarmAgentDownloadCommand,
  getDockerSwarmAgentInstallScriptCommand,
} from "../../Pages/DockerSwarm/Utils/DocumentationMarkdown";
import {
  HostCollectorMethod,
  getHostCollectorCommandLanguage,
  getHostCollectorMethodsForOsType,
  getHostCollectorUpgradeCommand,
} from "../../Pages/Host/Utils/DocumentationMarkdown";
import {
  getKubernetesAgentChartUpgradeCommand,
  getKubernetesAgentChartUpgradeFallbackCommand,
} from "../../Pages/Kubernetes/Utils/DocumentationMarkdown";
import { getPodmanAgentUpgradeCommand } from "../../Pages/Podman/Utils/DocumentationMarkdown";
import {
  PROXMOX_AGENT_RECREATE_COMMAND,
  getProxmoxAgentDownloadCommand,
  getProxmoxAgentUpgradeCommand,
} from "../../Pages/Proxmox/Utils/DocumentationMarkdown";
import {
  CEPH_AGENT_RECREATE_COMMAND,
  getCephAgentDownloadCommand,
  getCephAgentUpgradeCommand,
} from "../../Pages/Ceph/Utils/DocumentationMarkdown";
import {
  VMWARE_AGENT_RECREATE_COMMAND,
  getVMwareAgentDownloadCommand,
  getVMwareAgentUpgradeCommand,
} from "../../Pages/VMware/Utils/DocumentationMarkdown";
import {
  STORAGE_ARRAY_AGENT_INSTALL_DIR,
  STORAGE_ARRAY_AGENT_RECREATE_COMMAND,
  getStorageArrayAgentDownloadCommand,
  getStorageArrayAgentUpgradeCommand,
} from "../../Pages/StorageArray/Utils/DocumentationMarkdown";
import { getRunnerUpgradeCommand } from "../Runner/RunnerImage";
import {
  doesInstallScriptStartResourceAiAgent,
  getResourceAiAgentUpgradeCommand,
} from "../ResourceAiAgent/ResourceAiAgentInstall";
import AiResourceType from "Common/Types/ResourceAiAgent/AiResourceType";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * How to upgrade each kind of agent, as the dialog beside an outdated agent
 * version shows it (AgentUpgradeModal).
 *
 * The commands are never written here. Each comes from the setup guide that
 * installs the agent - the same function that guide's "Upgrade or uninstall
 * the agent" topic calls - so the dialog and the guide always say the same
 * thing (AgentUpgradeGuides.test.ts checks every command against the
 * guide's own code blocks). What is written here is the dialog's wording:
 * a few short steps, the command each one runs, and where the guide is
 * needed (to start a CLI-run agent again with a key picked there).
 *
 * Titles and descriptions are English keys, translated where they are
 * drawn. A kind OneUptime does not release has no guide: its version is
 * never called outdated, so the dialog never opens for it.
 */

export interface AgentUpgradeStep {
  title: string;
  description?: string | undefined;
  // Values for {{placeholders}} in the description.
  values?: Record<string, string> | undefined;
  // One command (or a few lines of them), shown with a copy button.
  code?: string | undefined;
  // The code's language; bash when unset (PowerShell on Windows).
  language?: "bash" | "powershell" | undefined;
  /*
   * The step needs the resource's setup guide (the docker run command is
   * filled in there with a key the reader picks): a link to it is drawn
   * under the step when the page passes the guide's route.
   */
  needsSetupGuide?: boolean | undefined;
}

/*
 * One way the agent may have been installed - a tab when there are several,
 * labelled like the setup guide's own install methods.
 */
export interface AgentUpgradeMethod {
  label: string;
  steps: Array<AgentUpgradeStep>;
  // A line under the steps, for a case the steps do not cover.
  note?: string | undefined;
  // Values for {{placeholders}} in the note.
  noteValues?: Record<string, string> | undefined;
}

export interface AgentUpgradeGuide {
  methods: Array<AgentUpgradeMethod>;
}

export interface AgentUpgradeGuideContext {
  /*
   * The Database agent's config is per engine: its Docker Compose upgrade
   * downloads that engine's file, so it is offered only when the engine is
   * known.
   */
  databaseEngine?: DatabaseAgentEngine | null | undefined;
  // The database runs in Kubernetes, where the guide offers a Deployment.
  databaseRunsInKubernetes?: boolean | undefined;
  /*
   * The resource a resource AI agent serves: its compose service, and
   * whether its collector's install script starts it.
   */
  resourceType?: AiResourceType | null | undefined;
  /*
   * The os.type a host reports: its collector upgrade offers only the
   * install methods that OS can have (every one when it is unknown).
   */
  hostOsType?: string | null | undefined;
}

// ---- shared wording --------------------------------------------------------

const START_AGAIN_FROM_GUIDE: string = translationKey(
  "Run the command from the setup guide again. It is filled in with this host's name and the ingestion key you pick there.",
);

const PULL_AND_RECREATE: string = translationKey(
  "Pull the latest images and recreate the agent",
);

const DOWNLOAD_LATEST_FILES: string = translationKey(
  "Download the latest files",
);

const COLLECTOR_READS_CONFIG_AT_START: string = translationKey(
  "The collector reads its config only when it starts.",
);

const COMPOSE_FOLDER_DOWNLOAD: string = translationKey(
  "Run this in the agent's folder. It keeps your .env; re-apply any change you made to docker-compose.yml or otel-collector-config.yaml.",
);

const SCRIPT_REUSES_ENV: string = translationKey(
  "Run it on the machine the agent runs on. It reuses your .env without asking anything again, downloads the latest files and recreates the agent.",
);

const OUTSIDE_INSTALL_DIRECTORY: string = translationKey(
  "Installed it outside {{directory}}? Run the script with INSTALL_DIR set to that folder: INSTALL_DIR=<folder> bash install.sh.",
);

// ---- per kind ------------------------------------------------------------------

/*
 * The Kubernetes agent: a Helm release, upgraded so that it keeps the
 * values it was given and takes every other value from the new chart.
 * --reset-then-reuse-values does that from Helm 3.14; an older Helm gets it
 * by passing the release's own values back with -f. Never --reuse-values,
 * which keeps the old chart's defaults too, so the new chart's (a newer eBPF
 * image among them) never apply: both tabs say so, since it is the upgrade
 * many readers already know.
 */
const KUBERNETES_NOT_REUSE_VALUES: string = translationKey(
  "Not --reuse-values: it also keeps the old chart's defaults, so the new chart's defaults (a newer eBPF image among them) never apply.",
);

function getKubernetesAgentGuide(): AgentUpgradeGuide {
  return {
    methods: [
      {
        label: translationKey("Helm 3.14 or later"),
        steps: [
          {
            title: translationKey("Upgrade the Helm release"),
            description: translationKey(
              "Run this with kubectl pointed at the cluster. --reset-then-reuse-values keeps the values you set (the cluster name, the preset and any flags you added) and takes every other value from the new chart.",
            ),
            code: getKubernetesAgentChartUpgradeCommand(),
          },
        ],
        note: KUBERNETES_NOT_REUSE_VALUES,
      },
      {
        label: translationKey("Helm 3.13 or earlier"),
        steps: [
          {
            title: translationKey("Upgrade the Helm release"),
            description: translationKey(
              "Run this with kubectl pointed at the cluster. It saves the values you set to values.yaml and upgrades with them, so every other value comes from the new chart.",
            ),
            code: getKubernetesAgentChartUpgradeFallbackCommand(),
          },
        ],
        note: KUBERNETES_NOT_REUSE_VALUES,
      },
    ],
  };
}

interface ContainerAgentWording {
  cliLabel: string; // "Docker CLI"
  composeLabel: string; // "Docker Compose"
  upgradeCommand: (method: "cli" | "compose") => string;
}

/*
 * The Docker and Podman agents: one container, started with the CLI or with
 * Compose. With the CLI the container is removed and started again from the
 * guide's run command; Compose recreates it in place.
 */
function getContainerAgentGuide(
  wording: ContainerAgentWording,
): AgentUpgradeGuide {
  return {
    methods: [
      {
        label: wording.cliLabel,
        steps: [
          {
            title: translationKey(
              "Pull the new image and remove the running agent",
            ),
            description: translationKey("Run this on the host."),
            code: wording.upgradeCommand("cli"),
          },
          {
            title: translationKey("Start the agent again"),
            description: START_AGAIN_FROM_GUIDE,
            needsSetupGuide: true,
          },
        ],
      },
      {
        label: wording.composeLabel,
        steps: [
          {
            title: PULL_AND_RECREATE,
            description: translationKey(
              "Run this in the folder that holds docker-compose.yml.",
            ),
            code: wording.upgradeCommand("compose"),
          },
        ],
      },
    ],
  };
}

function getDockerSwarmAgentGuide(): AgentUpgradeGuide {
  return {
    methods: [
      {
        label: translationKey("Install script"),
        steps: [
          {
            title: translationKey("Run the install script again"),
            description: translationKey(
              "Run it on the manager node the agent runs on, and answer with the same OneUptime URL, ingestion key and cluster name. It downloads the latest files, pulls the images and restarts the agent.",
            ),
            code: getDockerSwarmAgentInstallScriptCommand(),
          },
        ],
      },
      {
        label: translationKey("Docker Compose"),
        steps: [
          {
            title: DOWNLOAD_LATEST_FILES,
            description: translationKey(
              "Run this in the agent's folder, then re-apply any change you made to docker-compose.yml.",
            ),
            code: getDockerSwarmAgentDownloadCommand(),
          },
          {
            title: PULL_AND_RECREATE,
            code: DOCKER_SWARM_AGENT_COMPOSE_UPGRADE_COMMAND,
          },
        ],
      },
    ],
  };
}

interface InstallScriptAgentCommands {
  // The install script with nothing in its environment: it reuses the .env.
  upgrade: string;
  // A Docker Compose install's two files, again.
  download: string;
  // Then the images pulled and the containers recreated.
  recreate: string;
}

/*
 * The Proxmox, Ceph and VMware agents: the stock collector plus a config,
 * pinned in the docker-compose.yml beside it. Their install scripts reuse
 * the .env they find (nothing is asked again), download both files and
 * recreate the containers, so running one again is the upgrade (the
 * Proxmox and Ceph scripts also keep a file the reader edited as
 * <file>.bak.<timestamp>, and pull the images). A Docker Compose install
 * takes both files itself, then pulls the images and recreates the
 * containers, because the collector reads its config only when it starts.
 */
function getInstallScriptAgentGuide(
  commands: InstallScriptAgentCommands,
): AgentUpgradeGuide {
  return {
    methods: [
      {
        label: translationKey("Install script"),
        steps: [
          {
            title: translationKey("Run the install script again"),
            description: SCRIPT_REUSES_ENV,
            code: commands.upgrade,
          },
        ],
      },
      {
        label: translationKey("Docker Compose"),
        steps: [
          {
            title: DOWNLOAD_LATEST_FILES,
            description: COMPOSE_FOLDER_DOWNLOAD,
            code: commands.download,
          },
          {
            title: PULL_AND_RECREATE,
            description: COLLECTOR_READS_CONFIG_AT_START,
            code: commands.recreate,
          },
        ],
      },
    ],
  };
}

/*
 * The Storage Array agent's install script, like the VMware agent's, reuses
 * the .env it finds (and keeps a file the reader edited as
 * <file>.bak.<timestamp>), so running it again is the upgrade. One agent
 * reads one array, so another array's agent lives in a folder of its own,
 * which the script is pointed at with INSTALL_DIR. A Docker Compose install
 * takes the compose file and all three collector configs itself.
 */
function getStorageArrayAgentGuide(): AgentUpgradeGuide {
  return {
    methods: [
      {
        label: translationKey("Install script"),
        steps: [
          {
            title: translationKey("Run the install script again"),
            description: SCRIPT_REUSES_ENV,
            code: getStorageArrayAgentUpgradeCommand(),
          },
        ],
        note: OUTSIDE_INSTALL_DIRECTORY,
        noteValues: { directory: STORAGE_ARRAY_AGENT_INSTALL_DIR },
      },
      {
        label: translationKey("Docker Compose"),
        steps: [
          {
            title: DOWNLOAD_LATEST_FILES,
            description: translationKey(
              "Run this in the agent's folder. It keeps your .env; re-apply any change you made to docker-compose.yml or otel-collector-config*.yaml.",
            ),
            code: getStorageArrayAgentDownloadCommand(),
          },
          {
            title: PULL_AND_RECREATE,
            description: COLLECTOR_READS_CONFIG_AT_START,
            code: STORAGE_ARRAY_AGENT_RECREATE_COMMAND,
          },
        ],
      },
    ],
  };
}

// The host guide's install methods, labelled as its picker labels them.
const HOST_COLLECTOR_METHOD_LABELS: Record<HostCollectorMethod, string> = {
  docker: translationKey("Docker"),
  "linux-deb": translationKey("Debian / Ubuntu"),
  "linux-rpm": translationKey("RHEL / Fedora"),
  "linux-tarball": translationKey("Linux Tarball"),
  macos: translationKey("macOS"),
  windows: translationKey("Windows"),
};

/*
 * A host's collector: the upstream otelcol-contrib, installed one of six
 * ways, with the host guide's config.yaml. That config stamps the release
 * it is for, so an upgrade saves it again from the setup guide (it holds
 * the ingestion key, which only the guide fills in) and then installs the
 * new release over the old one. A tab per install method the host's OS can
 * have.
 */
function getHostCollectorGuide(
  context: AgentUpgradeGuideContext,
): AgentUpgradeGuide {
  return {
    methods: getHostCollectorMethodsForOsType(context.hostOsType).map(
      (method: HostCollectorMethod): AgentUpgradeMethod => {
        return {
          label: HOST_COLLECTOR_METHOD_LABELS[method],
          steps: [
            {
              title: translationKey("Save the new config"),
              description: translationKey(
                "Copy config.yaml from the setup guide again, with the ingestion key you pick there: it reports the new version. Copy across any change you made to yours.",
              ),
              needsSetupGuide: true,
            },
            {
              title: translationKey("Install the new release"),
              description: translationKey(
                "Run this in the folder that holds the new config.yaml.",
              ),
              code: getHostCollectorUpgradeCommand(method),
              language: getHostCollectorCommandLanguage(method),
            },
          ],
        };
      },
    ),
  };
}

function getDatabaseAgentGuide(
  context: AgentUpgradeGuideContext,
): AgentUpgradeGuide {
  const methods: Array<AgentUpgradeMethod> = [
    {
      label: translationKey("Install script"),
      steps: [
        {
          title: translationKey("Run the install script again"),
          description: translationKey(
            "Run it on the machine the agent runs on. It keeps your .env and replaces docker-compose.yml and otel-collector-config.yaml with the current ones; a file you edited is kept next to the new one as <file>.bak.<timestamp>.",
          ),
          code: getDatabaseAgentUpgradeCommand(),
        },
      ],
      note: OUTSIDE_INSTALL_DIRECTORY,
      noteValues: { directory: DATABASE_AGENT_INSTALL_DIRECTORY },
    },
  ];

  if (context.databaseEngine) {
    methods.push({
      label: translationKey("Docker Compose"),
      steps: [
        {
          title: DOWNLOAD_LATEST_FILES,
          description: translationKey(
            "Run this in the agent's folder. Your .env stays as it is.",
          ),
          code: getDatabaseAgentDownloadCommand(context.databaseEngine),
        },
        {
          title: translationKey("Recreate the agent"),
          description: COLLECTOR_READS_CONFIG_AT_START,
          code: DATABASE_AGENT_RECREATE_COMMAND,
        },
      ],
    });
  }

  if (context.databaseRunsInKubernetes) {
    methods.push({
      label: translationKey("Kubernetes"),
      steps: [
        {
          title: translationKey("Apply the current manifest"),
          description: translationKey(
            "Copy the Deployment from the setup guide and apply it again with kubectl apply -f. It carries the current collector version and config.",
          ),
          needsSetupGuide: true,
        },
      ],
    });
  }

  return { methods: methods };
}

function getRunnerGuide(): AgentUpgradeGuide {
  return {
    methods: [
      {
        label: translationKey("Docker"),
        steps: [
          {
            title: translationKey(
              "Pull the new image and remove the running Runner",
            ),
            description: translationKey(
              "Run this on the host the Runner runs on.",
            ),
            code: getRunnerUpgradeCommand(),
          },
          {
            title: translationKey("Start the Runner again"),
            description: translationKey(
              "Run the docker run command under Setup Instructions on this page. It starts the Runner on the new image with the same ID and key.",
            ),
          },
        ],
      },
    ],
  };
}

/*
 * A resource's AI agent: its compose service pulled and recreated, from the
 * directory of its docker-compose.yml (ResourceAiAgentInstall, the install
 * instructions on the resource's AI agent page). On a Docker or Podman
 * host, whose collector's install script starts it as a plain container,
 * running that script again comes first.
 */
function getResourceAiAgentGuide(
  context: AgentUpgradeGuideContext,
): AgentUpgradeGuide {
  const resourceType: AiResourceType | null = context.resourceType || null;
  const methods: Array<AgentUpgradeMethod> = [];

  if (resourceType && doesInstallScriptStartResourceAiAgent(resourceType)) {
    methods.push({
      label: translationKey("Install script"),
      steps: [
        {
          title: translationKey("Run the install script again"),
          description: translationKey(
            "Run it on the host with the same settings. It pulls the agent's newest image and starts the agent again.",
          ),
        },
      ],
    });
  }

  methods.push({
    label:
      resourceType === AiResourceType.PodmanHost
        ? translationKey("Podman Compose")
        : translationKey("Docker Compose"),
    steps: [
      {
        title: PULL_AND_RECREATE,
        description: translationKey(
          "Run this where the agent's docker-compose.yml is.",
        ),
        code: getResourceAiAgentUpgradeCommand(resourceType),
      },
    ],
  });

  return { methods: methods };
}

/*
 * The upgrade guide for a kind of agent, or null for a kind OneUptime does
 * not release (its version is never outdated, so nothing asks for one).
 */
export function getAgentUpgradeGuide(
  kind: AgentKind,
  context: AgentUpgradeGuideContext = {},
): AgentUpgradeGuide | null {
  switch (kind) {
    case AgentKind.KubernetesAgent:
      return getKubernetesAgentGuide();
    case AgentKind.DockerAgent:
      return getContainerAgentGuide({
        cliLabel: translationKey("Docker CLI"),
        composeLabel: translationKey("Docker Compose"),
        upgradeCommand: (method: "cli" | "compose"): string => {
          return getDockerAgentUpgradeCommand(
            method === "cli" ? "docker-cli" : "docker-compose",
          );
        },
      });
    case AgentKind.PodmanAgent:
      return getContainerAgentGuide({
        cliLabel: translationKey("Podman CLI"),
        composeLabel: translationKey("Podman Compose"),
        upgradeCommand: (method: "cli" | "compose"): string => {
          return getPodmanAgentUpgradeCommand(
            method === "cli" ? "podman-cli" : "podman-compose",
          );
        },
      });
    case AgentKind.DockerSwarmAgent:
      return getDockerSwarmAgentGuide();
    case AgentKind.DatabaseAgent:
      return getDatabaseAgentGuide(context);
    case AgentKind.Runner:
      return getRunnerGuide();
    case AgentKind.ResourceAiAgent:
      return getResourceAiAgentGuide(context);
    case AgentKind.HostCollector:
      return getHostCollectorGuide(context);
    case AgentKind.ProxmoxAgent:
      return getInstallScriptAgentGuide({
        upgrade: getProxmoxAgentUpgradeCommand(),
        download: getProxmoxAgentDownloadCommand(),
        recreate: PROXMOX_AGENT_RECREATE_COMMAND,
      });
    case AgentKind.CephAgent:
      return getInstallScriptAgentGuide({
        upgrade: getCephAgentUpgradeCommand(),
        download: getCephAgentDownloadCommand(),
        recreate: CEPH_AGENT_RECREATE_COMMAND,
      });
    case AgentKind.VMwareAgent:
      return getInstallScriptAgentGuide({
        upgrade: getVMwareAgentUpgradeCommand(),
        download: getVMwareAgentDownloadCommand(),
        recreate: VMWARE_AGENT_RECREATE_COMMAND,
      });
    case AgentKind.StorageArrayAgent:
      return getStorageArrayAgentGuide();
    default:
      return null;
  }
}
