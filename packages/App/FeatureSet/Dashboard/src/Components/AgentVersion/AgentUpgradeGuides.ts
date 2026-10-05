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
import { getKubernetesAgentChartUpgradeCommand } from "../../Pages/Kubernetes/Utils/DocumentationMarkdown";
import { getPodmanAgentUpgradeCommand } from "../../Pages/Podman/Utils/DocumentationMarkdown";
import { getRunnerUpgradeCommand } from "../Runner/RunnerImage";
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

// ---- per kind ------------------------------------------------------------------

function getKubernetesAgentGuide(): AgentUpgradeGuide {
  return {
    methods: [
      {
        label: translationKey("Helm"),
        steps: [
          {
            title: translationKey("Upgrade the Helm release"),
            description: translationKey(
              "Run this with kubectl pointed at the cluster. --reuse-values keeps your settings: the cluster name, the preset and any flags you added.",
            ),
            code: getKubernetesAgentChartUpgradeCommand(),
          },
        ],
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
      note: translationKey(
        "Installed it outside {{directory}}? Run the script with INSTALL_DIR set to that folder: INSTALL_DIR=<folder> bash install.sh.",
      ),
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
          description: translationKey(
            "The collector reads its config only when it starts.",
          ),
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
    default:
      return null;
  }
}
