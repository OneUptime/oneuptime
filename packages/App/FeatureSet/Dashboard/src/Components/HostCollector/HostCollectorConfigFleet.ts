import type Host from "Common/Models/DatabaseModels/Host";
import type Query from "Common/Types/BaseDatabase/Query";
import Includes from "Common/Types/BaseDatabase/Includes";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import ObjectID from "Common/Types/ObjectID";
import {
  HostCollectorConfigStatus,
  HostCollectorOsType,
} from "Common/Types/HostCollector/HostCollector";
import { HostCollectorConfigChoiceReason } from "Common/Utils/HostCollector/HostCollectorConfigResolution";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * What Hosts > Configuration > Collector Configs says about the hosts a
 * config reaches, and how a host comes to run one:
 *
 *   - the three places a host's config comes from, in the order the server
 *     tries them (HostCollectorConfigResolution): a config picked for the
 *     host, the first config of the list that applies to it, OneUptime's
 *     default for its system;
 *   - how many hosts run each config, and on how many it did not start -
 *     counted by the server, so a fleet of any size is counted right;
 *   - what each of OneUptime's defaults collects, in a few words.
 *
 * React-free: App tests read it.
 */

/*
 * One step of how a host gets its config: English translation keys, and the
 * reason the server gives when a host's config comes from this step.
 */
export interface HostCollectorConfigOrderStep {
  reason: HostCollectorConfigChoiceReason;
  title: string;
  description: string;
}

// The title over the steps, across the top of the list.
export const HOST_COLLECTOR_CONFIG_ORDER_TITLE: string = translationKey(
  "How a host gets its config",
);

/*
 * The steps, in the order the server tries them. Picking a config for one
 * host is rare, but it comes first: a host with one runs it whatever the
 * list says.
 */
export const HOST_COLLECTOR_CONFIG_ORDER_STEPS: ReadonlyArray<HostCollectorConfigOrderStep> =
  [
    {
      reason: HostCollectorConfigChoiceReason.Pinned,
      title: translationKey("Picked for the host"),
      description: translationKey(
        "A config someone picked on the host's Collector page.",
      ),
    },
    {
      reason: HostCollectorConfigChoiceReason.Matched,
      title: translationKey("The first config that applies"),
      description: translationKey(
        "Checked from the top of this list, by the host's system and labels.",
      ),
    },
    {
      reason: HostCollectorConfigChoiceReason.Default,
      title: translationKey("OneUptime's default"),
      description: translationKey(
        "For the host's system, when no config applies.",
      ),
    },
  ];

/*
 * What a card or a row says about the hosts a config reaches. A plural is
 * keyed by its "other" sentence; en.json holds the "one" under "_one".
 */
export const HOST_COUNT_TEMPLATE: PluralTemplate = {
  one: "{{count}} host",
  other: "{{count}} hosts",
};

// Beside it, in red: on how many of them the config did not start.
export const FAILED_COUNT_TEMPLATE: PluralTemplate = {
  one: "{{count}} failed",
  other: "{{count}} failed",
};

// What the card of OneUptime's defaults, under the list, says of them.
export const HOST_COLLECTOR_DEFAULTS_DESCRIPTION: string = translationKey(
  "When no config above applies to a host, it runs the default for its system. The defaults follow OneUptime's releases.",
);

/*
 * What each of OneUptime's defaults collects, in a few words. "Host
 * metrics" is CPU, memory, disks, filesystems, network and processes: what
 * a config for any system reads (HostCollectorDefaultConfig).
 */
export const HOST_COLLECTOR_DEFAULT_SUMMARIES: Record<
  HostCollectorOsType,
  string
> = {
  [HostCollectorOsType.Linux]: translationKey(
    "Host metrics, the journal and systemd units",
  ),
  [HostCollectorOsType.Windows]: translationKey(
    "Host metrics, event logs and Windows services",
  ),
  [HostCollectorOsType.MacOS]: translationKey(
    "Host metrics and the install and Wi-Fi logs",
  ),
  [HostCollectorOsType.Any]: translationKey("Host metrics"),
};

/*
 * The os.type values a host of each system reports, as
 * getHostCollectorOsType reads them: OpenTelemetry says "darwin" for macOS,
 * and "macos" is read the same.
 */
export const HOST_OS_TYPE_VALUES: Record<HostCollectorOsType, Array<string>> = {
  [HostCollectorOsType.Linux]: ["linux"],
  [HostCollectorOsType.Windows]: ["windows"],
  [HostCollectorOsType.MacOS]: ["darwin", "macos"],
  [HostCollectorOsType.Any]: [],
};

// How many hosts run a config, and on how many of them it did not start.
export interface HostCollectorHostCount {
  hosts: number;
  failed: number;
}

/*
 * The hosts that run a config: the ones the server sends it to, picked or
 * automatic. An archived host is out of the fleet. The config's own Hosts
 * list reads the same hosts.
 */
export function getHostsRunningConfigQuery(data: {
  projectId: ObjectID;
  configId: ObjectID;
}): Query<Host> {
  return {
    projectId: data.projectId,
    collectorConfigId: data.configId,
    isArchived: false,
  };
}

/*
 * Those of them the config did not start on: each went back to the last
 * config that worked there, and says why on its Collector page.
 */
export function getHostsFailingConfigQuery(data: {
  projectId: ObjectID;
  configId: ObjectID;
}): Query<Host> {
  return {
    ...getHostsRunningConfigQuery(data),
    collectorConfigStatus: HostCollectorConfigStatus.Failed,
  };
}

/*
 * The hosts that run OneUptime's default for a system: OneUptime manages
 * their collector (it registered), and no config applies to them. A host
 * set up by hand runs a config.yaml of its own, so it is not one of them.
 */
export function getHostsOnDefaultQuery(data: {
  projectId: ObjectID;
  osType: HostCollectorOsType;
}): Query<Host> {
  return {
    projectId: data.projectId,
    isArchived: false,
    collectorInstanceUid: new NotNull(),
    collectorConfigId: new IsNull(),
    osType: new Includes(HOST_OS_TYPE_VALUES[data.osType]),
  };
}

/*
 * The Hosts tab's badge on a config's page: red when the config did not
 * start on one of them, so that is seen before the tab is opened.
 */
export function hasHostCollectorConfigFailures(
  count: HostCollectorHostCount | undefined,
): boolean {
  return Boolean(count && count.failed > 0);
}
