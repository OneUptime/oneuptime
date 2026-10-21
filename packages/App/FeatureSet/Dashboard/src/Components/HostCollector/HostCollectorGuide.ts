import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideOption,
  SetupGuideTopic,
  codeBlock,
  resolveSetupGuideOption,
} from "../SetupGuide/SetupGuide";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  HOST_COLLECTOR_PINNED_VERSION,
  HostCollectorOsType,
} from "Common/Types/HostCollector/HostCollector";
import {
  HostCollectorLabel,
  getHostCollectorInstallCommand,
  getHostCollectorInstallCommandLanguage,
  getHostCollectorServiceCommands,
  getHostCollectorUninstallCommand,
} from "Common/Utils/HostCollector/HostCollectorInstallCommand";

/*
 * Adding a host, the way OneUptime does it by default: one command on the
 * host. The command installs the OpenTelemetry Collector and the OpAMP
 * supervisor that keeps it on the config OneUptime sends, so there is no
 * config.yaml to write - the host shows up under Hosts and reports.
 *
 * The guide asks what the host runs (Linux, Windows or macOS), takes the
 * ingestion key from the guide's first step, and shows that system's
 * command. A Kubernetes cluster's nodes are not added here: the Kubernetes
 * agent monitors them, and the guide says so in one line under the choices
 * (AddHostGuide). The manual way - installing the collector and writing its
 * config.yaml yourself - stays on the Documentation page, one click away.
 *
 * Pure, like every guide (SetupGuide.ts): the AddHostGuide component draws
 * it, and tests read it without rendering anything.
 */

export type HostAddOption = "linux" | "windows" | "darwin";

export const HOST_ADD_OPTIONS: Array<SetupGuideOption<HostAddOption>> = [
  {
    key: "linux",
    label: "Linux",
    description:
      "Ubuntu, Debian, RHEL, Rocky, Amazon Linux and other systemd hosts.",
  },
  {
    key: "windows",
    label: "Windows",
    description: "Windows 10, Windows Server 2019 and later.",
  },
  {
    key: "darwin",
    label: "macOS",
    description: "Apple silicon and Intel Macs.",
  },
];

export const DEFAULT_HOST_ADD_OPTION: HostAddOption = "linux";

export function resolveHostAddOption(
  option: string | null | undefined,
): HostAddOption {
  return (
    resolveSetupGuideOption(HOST_ADD_OPTIONS, option) || DEFAULT_HOST_ADD_OPTION
  );
}

// The option a host's own system opens the guide on.
export function getHostAddOptionForOsType(
  osType: HostCollectorOsType | null | undefined,
): HostAddOption {
  if (osType === HostCollectorOsType.Windows) {
    return "windows";
  }
  if (osType === HostCollectorOsType.MacOS) {
    return "darwin";
  }
  return "linux";
}

/*
 * The systems the guide offers for a host. One whose system OneUptime
 * already knows - a host's own page, installing again or handing over its
 * collector - gets only that system's command: asking what it runs would
 * offer two commands that cannot work there.
 */
export function getHostAddOptions(
  osType?: HostCollectorOsType | null | undefined,
): Array<SetupGuideOption<HostAddOption>> {
  if (!osType || osType === HostCollectorOsType.Any) {
    return HOST_ADD_OPTIONS;
  }

  const option: HostAddOption = getHostAddOptionForOsType(osType);

  return HOST_ADD_OPTIONS.filter(
    (item: SetupGuideOption<HostAddOption>): boolean => {
      return item.key === option;
    },
  );
}

function getOsType(option: HostAddOption): HostCollectorOsType {
  if (option === "windows") {
    return HostCollectorOsType.Windows;
  }
  if (option === "darwin") {
    return HostCollectorOsType.MacOS;
  }
  return HostCollectorOsType.Linux;
}

export interface HostAddGuideOptions {
  oneuptimeUrl: string;
  apiKey: string;
  option: HostAddOption;
  labels?: Array<HostCollectorLabel> | undefined;
  /*
   * For a host that already reports through a collector installed by hand:
   * the command stops that one, so the host does not report twice.
   */
  replaceExisting?: boolean | undefined;
  /*
   * Leave out "Install the collector yourself": the page shows the manual
   * guide itself (Hosts > Documentation, a host set up by hand), or the
   * host's collector is OneUptime's already (installing it again).
   */
  hideManualInstallTopic?: boolean | undefined;
}

// The one command for this guide's system, filled in.
export function getHostAddCommand(options: HostAddGuideOptions): string {
  return getHostCollectorInstallCommand({
    osType: getOsType(options.option),
    oneuptimeUrl: options.oneuptimeUrl,
    ingestionKey: options.apiKey,
    labels: options.labels,
    replaceExisting: options.replaceExisting,
  });
}

// English translation keys: the guide card shows them in the reader's language.
function getRunStepDescription(options: HostAddGuideOptions): string {
  if (options.replaceExisting) {
    return options.option === "windows"
      ? translationKey(
          "In PowerShell, run as administrator. It also stops the collector installed by hand (otelcol-contrib), so the host does not report twice.",
        )
      : translationKey(
          "As a user who can use sudo. It also stops the collector installed by hand (otelcol-contrib), so the host does not report twice.",
        );
  }
  if (options.option === "windows") {
    return translationKey(
      "In PowerShell, run as administrator. It takes about a minute.",
    );
  }
  return translationKey("As a user who can use sudo. It takes about a minute.");
}

/*
 * Under the command while no key is picked, which holds the placeholder
 * (SETUP_GUIDE_API_KEY_PLACEHOLDER) where the key goes. A translation key,
 * so the placeholder is written out in it.
 */
export const HOST_ADD_PLACEHOLDER_NOTE: string = translationKey(
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.",
);

function getLabelFlag(option: HostAddOption): string {
  return option === "windows"
    ? "-Label 'env=production','team=payments'"
    : "--label env=production --label team=payments";
}

function getAdvancedTopics(
  options: HostAddGuideOptions,
): Array<SetupGuideTopic> {
  const option: HostAddOption = options.option;
  const isWindows: boolean = option === "windows";
  const osType: HostCollectorOsType = getOsType(option);

  const whatItInstalls: string = isWindows
    ? `It downloads the OpenTelemetry Collector (\`otelcol-contrib\`) and the OpAMP supervisor (\`opampsupervisor\`) ${HOST_COLLECTOR_PINNED_VERSION} from the OpenTelemetry Collector releases, checks each against its published SHA-256, and runs them as the Windows service \`oneuptime-collector\`, as LocalSystem, so it can read every event log and Windows service. Its files are in \`C:\\Program Files\\OneUptime Collector\` and \`C:\\ProgramData\\OneUptime Collector\`, which only SYSTEM and Administrators can read.`
    : `It downloads the OpenTelemetry Collector (\`otelcol-contrib\`) and the OpAMP supervisor (\`opampsupervisor\`) ${HOST_COLLECTOR_PINNED_VERSION} from the OpenTelemetry Collector releases, checks each against its published SHA-256, and runs them as the service \`oneuptime-collector\`.${
        option === "linux"
          ? " On Linux it runs as the unprivileged user `oneuptime-collector`, in the `systemd-journal` and `adm` groups, so it reads the journal and the logs in `/var/log`. Its files are in `/opt/oneuptime-collector`, `/etc/oneuptime-collector` and `/var/lib/oneuptime-collector`."
          : " On macOS it runs as root, as launchd daemons do. Its files are in `/usr/local/oneuptime-collector`."
      }`;

  return [
    {
      title: "Label the host",
      summary: "Labels pick which Collector Config a host runs.",
      markdown: `Add labels to the command, and the host gets them when it connects:

${codeBlock(isWindows ? "powershell" : "bash", getLabelFlag(option))}

\`env=production\` becomes the label \`env:production\`. A Collector Config can be for hosts with a label, so the same command with different labels gives each group of hosts its own config. You can also label hosts on the Hosts page, or with label rules.`,
    },
    {
      title: "Choose what it collects",
      summary: "OneUptime's default, or a Collector Config of yours.",
      markdown: `The host runs OneUptime's default config for its system: CPU, memory, disks, network and processes, ${
        osType === HostCollectorOsType.Linux
          ? "the journal and systemd units"
          : osType === HostCollectorOsType.Windows
            ? "the System, Application and Security event logs and Windows services"
            : "and the system's log files"
      }. To collect something else on some or all hosts, create a Collector Config under **Hosts → Collector Configs**: OneUptime sends it to every host it applies to, and each host shows which config and version it runs. A config that does not start on a host is rolled back there to the last one that worked.`,
    },
    {
      title: "What the command installs",
      summary: "The OpenTelemetry Collector and the OpAMP supervisor.",
      markdown: `${whatItInstalls}

The supervisor asks OneUptime for the host's config every 30 seconds, with the ingestion key, and runs the collector with it. Nothing else on the host changes. Run the command again to change labels or move to a newer release.`,
    },
    {
      title: "No direct internet access",
      summary: "A proxy, or your own copy of the releases.",
      markdown: `Add ${
        isWindows
          ? "`-Proxy 'http://proxy:3128'`"
          : "`--proxy http://proxy:3128`"
      } to send the downloads and all of the collector's traffic through a proxy. To download from a mirror of the OpenTelemetry Collector releases (the same folder layout as GitHub's), add ${
        isWindows
          ? "`-DownloadUrl 'https://mirror.example.com/releases/download'`"
          : "`--download-url https://mirror.example.com/releases/download`"
      }.`,
    },
    {
      title: "Uninstall",
      summary: "Remove the collector and everything the command installed.",
      markdown: `${codeBlock(
        isWindows ? "powershell" : "bash",
        getHostCollectorUninstallCommand({
          osType: osType,
          oneuptimeUrl: options.oneuptimeUrl,
        }),
      )}

The host stays in OneUptime with its history; archive or delete it there.`,
    },
    ...(options.hideManualInstallTopic
      ? []
      : [
          {
            title: "Install the collector yourself",
            summary: "Write and keep config.yaml on the host instead.",
            markdown:
              "Prefer to install the OpenTelemetry Collector and edit its `config.yaml` on the host yourself? The manual guide on the **Documentation** page shows how, for Docker, Debian and Ubuntu, RHEL and Fedora, a release tarball, macOS and Windows. Such a host's config is yours to change; OneUptime does not send it one.",
          },
        ]),
  ];
}

function getTroubleshootingTopics(
  options: HostAddGuideOptions,
): Array<SetupGuideTopic> {
  const osType: HostCollectorOsType = getOsType(options.option);
  const logs: string = codeBlock(
    getHostCollectorInstallCommandLanguage(osType),
    getHostCollectorServiceCommands(osType).logs,
  );

  return [
    {
      title: "The command says OneUptime refused the key",
      markdown:
        "HTTP 401: the key is wrong, has expired or was deleted. HTTP 422: it is disabled, a browser key, or pinned to one service. Pick an enabled server key in step 1 and run the command again: it replaces the key on the host.",
    },
    {
      title: "The host does not appear",
      markdown: `Check that the host can reach \`${options.oneuptimeUrl}\` over HTTPS, then read the collector's log:

${logs}`,
    },
    {
      title: "The host says its config failed",
      markdown:
        "Open the host and its **Collector** page: it shows why the config did not start. The host keeps running the last config that worked, and OneUptime does not send it the failed one again until the config changes, or you choose **Try again**.",
    },
  ];
}

/*
 * The guide for one option, filled in with the reader's OneUptime URL and
 * ingestion key. The guide's last step - waiting for the host to connect -
 * is live, so the component adds it.
 */
export function getHostAddGuide(
  options: HostAddGuideOptions,
): SetupGuideContent {
  const command: string = getHostAddCommand(options);

  return {
    keyStep: {
      description:
        "The host sends its data and asks for its config with this key. Pick an existing key or create a new one: the command below updates to use it.",
      // The command below carries the URL and the key: only the picker.
      hideValues: true,
    },
    // One long line per command: read whole, on a phone too.
    wrapLongLines: true,
    steps: [
      {
        title: "Run this command on the host",
        description: getRunStepDescription(options),
        markdown: codeBlock(
          getHostCollectorInstallCommandLanguage(getOsType(options.option)),
          command,
        ),
        note:
          options.apiKey === SETUP_GUIDE_API_KEY_PLACEHOLDER
            ? HOST_ADD_PLACEHOLDER_NOTE
            : undefined,
      },
    ],
    advanced: getAdvancedTopics(options),
    troubleshooting: getTroubleshootingTopics(options),
    links: [
      {
        title: "Hosts documentation",
        url: "/docs/telemetry/hosts",
      },
    ],
  };
}
