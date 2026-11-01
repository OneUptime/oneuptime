import React, { FunctionComponent, ReactElement } from "react";
import ProxmoxResource from "Common/Models/DatabaseModels/ProxmoxResource";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import ResourcePartHero from "../../ResourcePart/ResourcePartHero";
import {
  ResourcePartAccent,
  ResourcePartBadge,
  ResourcePartChip,
  ResourcePartStatus,
} from "../../ResourcePart/ResourcePartTypes";
import { PROXMOX_METRIC_DESCRIPTIONS } from "../../MetricDescriptions/ProxmoxMetricDescriptions";
import { ProxmoxPartKind } from "../../../Pages/Proxmox/Utils/ProxmoxHealth";
import {
  ProxmoxGuestSummary,
  getProxmoxGuestKind,
  getProxmoxHaBadge,
  getProxmoxLockBadge,
  getProxmoxNodeName,
  getProxmoxPartStatus,
  getProxmoxStorageTypeLabel,
  parseProxmoxTags,
  toProxmoxDate,
  toProxmoxNumber,
} from "../../../Pages/Proxmox/Utils/ProxmoxPartFacts";
import {
  formatBytes,
  formatUptime,
} from "../../../Pages/Proxmox/Utils/ProxmoxResourceUtils";

/*
 * The top of a Proxmox node's, guest's or storage's page, above its tabs:
 * which part it is, whether it is up, where it sits in the cluster (each
 * place one step away), its size and the facts a Proxmox admin looks for
 * first - a guest's VMID and tags, a lock a task holds, its HA state. The
 * shared ResourcePartHero draws it.
 */

export interface ComponentProps {
  kind: ProxmoxPartKind;
  // The part's inventory row; null while it has not reported.
  row: ProxmoxResource | null;
  externalId: string;
  clusterName: string;
  clusterRoute: Route;
  getPartRoute: (kind: ProxmoxPartKind, externalId: string) => Route;
  // A node's guests, for its "running" chip.
  guestSummary?: ProxmoxGuestSummary | undefined;
}

const STATUS_DESCRIPTIONS: Record<ProxmoxPartKind, string> = {
  Node: PROXMOX_METRIC_DESCRIPTIONS.nodeStatus,
  Guest: PROXMOX_METRIC_DESCRIPTIONS.guestStatus,
  Storage: PROXMOX_METRIC_DESCRIPTIONS.storageStatus,
};

const ICONS: Record<ProxmoxPartKind, IconProp> = {
  Node: IconProp.ServerStack,
  Guest: IconProp.Cube,
  Storage: IconProp.Database,
};

const ACCENTS: Record<ProxmoxPartKind, ResourcePartAccent> = {
  Node: "orange",
  Guest: "sky",
  Storage: "emerald",
};

// pve_node_info's `level`: the node's Proxmox VE subscription.
const SUBSCRIPTION_WORDS: Record<string, string> = {
  c: translationKey("Community subscription"),
  b: translationKey("Basic subscription"),
  s: translationKey("Standard subscription"),
  p: translationKey("Premium subscription"),
};
const NO_SUBSCRIPTION: string = translationKey("No subscription");

const ProxmoxPartHero: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const row: ProxmoxResource | null = props.row;
  const slashIndex: number = props.externalId.indexOf("/");
  const idTail: string =
    slashIndex >= 0
      ? props.externalId.substring(props.externalId.lastIndexOf("/") + 1)
      : props.externalId;
  const name: string =
    props.kind === "Node"
      ? getProxmoxNodeName(row, props.externalId) || idTail
      : row?.name || idTail;

  const partStatus: ResourcePartStatus | null = row
    ? getProxmoxPartStatus(row)
    : null;
  const status: ResourcePartStatus | undefined = partStatus
    ? { ...partStatus, description: STATUS_DESCRIPTIONS[props.kind] }
    : undefined;

  const badges: Array<ResourcePartBadge> = [];
  const chips: Array<ResourcePartChip> = [];

  const cores: number | null = toProxmoxNumber(row?.cpuCount);
  const memory: number | null = toProxmoxNumber(row?.maxMemoryBytes);
  const disk: number | null = toProxmoxNumber(row?.maxDiskBytes);
  const uptime: string =
    row && row.isUp !== false ? formatUptime(row.uptimeSeconds) : "";

  const pushCores: () => void = (): void => {
    if (cores !== null && cores > 0) {
      chips.push({
        key: "cores",
        icon: IconProp.CPUChip,
        label: translator.translatePlural(
          { one: "{{count}} core", other: "{{count}} cores" },
          cores,
        ),
      });
    }
  };

  const pushMemory: () => void = (): void => {
    if (memory !== null && memory > 0) {
      chips.push({
        key: "memory",
        icon: IconProp.SquareStack,
        label: translator.translateTemplate("{{size}} memory", {
          size: formatBytes(memory),
        }),
      });
    }
  };

  const pushUptime: () => void = (): void => {
    if (uptime) {
      chips.push({
        key: "uptime",
        icon: IconProp.Clock,
        label: translator.translateTemplate("up {{uptime}}", {
          uptime: uptime,
        }),
      });
    }
  };

  const haBadge: ResourcePartBadge | null = getProxmoxHaBadge(row?.haState);
  if (haBadge) {
    badges.push(haBadge);
  }

  let location: ReactElement | undefined = undefined;
  const clusterLink: ReactElement = (
    <Link
      to={props.clusterRoute}
      className="font-medium text-gray-700 hover:text-indigo-600 hover:underline"
    >
      {props.clusterName}
    </Link>
  );
  const nodeName: string = row?.parentNodeName || "";
  const nodeLink: ReactElement | null = nodeName ? (
    <Link
      to={props.getPartRoute("Node", `node/${nodeName}`)}
      className="font-medium text-gray-700 hover:text-indigo-600 hover:underline"
    >
      {nodeName}
    </Link>
  ) : null;

  if (props.kind === "Node") {
    location = (
      <TranslatedSentence
        template="Node of cluster {{cluster}}"
        slots={{ cluster: clusterLink }}
      />
    );
    pushCores();
    pushMemory();
    if (props.guestSummary && props.guestSummary.total > 0) {
      chips.push({
        key: "guests",
        icon: IconProp.Cube,
        label: translator.translatePlural(
          {
            one: "{{running}}/{{count}} guest running",
            other: "{{running}}/{{count}} guests running",
          },
          props.guestSummary.total,
          // In the reader's digits, as the count beside it is.
          { running: translator.formatNumber(props.guestSummary.running) },
        ),
      });
    }
    pushUptime();
    if (
      row?.subscriptionLevel !== null &&
      row?.subscriptionLevel !== undefined
    ) {
      const level: string = row.subscriptionLevel.trim();
      chips.push({
        key: "subscription",
        icon: IconProp.ShieldCheck,
        label: tx(level ? SUBSCRIPTION_WORDS[level] || level : NO_SUBSCRIPTION),
      });
    }
  } else if (props.kind === "Guest") {
    const lockBadge: ResourcePartBadge | null = row
      ? getProxmoxLockBadge(row.lockState)
      : null;
    if (lockBadge) {
      badges.push(lockBadge);
    }
    location = nodeLink ? (
      <TranslatedSentence
        template="On node {{node}} of cluster {{cluster}}"
        slots={{ node: nodeLink, cluster: clusterLink }}
      />
    ) : (
      <TranslatedSentence
        template="Guest of cluster {{cluster}}"
        slots={{ cluster: clusterLink }}
      />
    );
    const kindWord: string = row ? getProxmoxGuestKind(row) : "";
    if (kindWord) {
      chips.push({
        key: "kind",
        icon: kindWord === "VM" ? IconProp.ComputerDesktop : IconProp.Cube,
        label: tx(kindWord),
      });
    }
    const vmid: number | null = toProxmoxNumber(row?.vmid);
    if (vmid !== null) {
      chips.push({
        key: "vmid",
        icon: IconProp.Hashtag,
        label: translator.translateTemplate("VMID {{vmid}}", {
          vmid: String(vmid),
        }),
      });
    }
    pushCores();
    pushMemory();
    if (disk !== null && disk > 0) {
      chips.push({
        key: "disk",
        icon: IconProp.Database,
        label: translator.translateTemplate("{{size}} disk", {
          size: formatBytes(disk),
        }),
      });
    }
    pushUptime();
  } else {
    location = nodeLink ? (
      <TranslatedSentence
        template="Storage on node {{node}} of cluster {{cluster}}"
        slots={{ node: nodeLink, cluster: clusterLink }}
      />
    ) : (
      <TranslatedSentence
        template="Storage of cluster {{cluster}}"
        slots={{ cluster: clusterLink }}
      />
    );
    if (row?.isShared !== null && row?.isShared !== undefined) {
      badges.push({
        key: "shared",
        label: row.isShared ? "Shared" : "Local",
        tone: "neutral",
      });
    }
    if (row?.storageType) {
      chips.push({
        key: "type",
        icon: IconProp.Database,
        label: tx(getProxmoxStorageTypeLabel(row.storageType)),
      });
    }
    if (disk !== null && disk > 0) {
      chips.push({
        key: "size",
        icon: IconProp.SquareStack,
        label: translator.translateTemplate("{{size}} total", {
          size: formatBytes(disk),
        }),
      });
    }
  }

  return (
    <ResourcePartHero
      testId={`proxmox-${props.kind.toLowerCase()}-hero`}
      icon={ICONS[props.kind]}
      accent={ACCENTS[props.kind]}
      name={name}
      status={status}
      badges={badges}
      location={location}
      lastReportAt={toProxmoxDate(row?.lastSeenAt)}
      chips={chips}
      tags={props.kind === "Guest" ? parseProxmoxTags(row?.tags) : []}
    />
  );
};

export default ProxmoxPartHero;
