import React, { FunctionComponent, ReactElement } from "react";
import XcpNgResource from "Common/Models/DatabaseModels/XcpNgResource";
import IconProp from "Common/Types/Icon/IconProp";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { formatStorageBytes } from "Common/Utils/Storage/StorageUsage";
import ResourcePartHero from "../../ResourcePart/ResourcePartHero";
import {
  ResourcePartAccent,
  ResourcePartAttention,
  ResourcePartChip,
  ResourcePartStatus,
} from "../../ResourcePart/ResourcePartTypes";
import { XCP_NG_METRIC_DESCRIPTIONS } from "../../MetricDescriptions/XcpNgMetricDescriptions";
import {
  XCP_NG_PART_ICONS,
  XcpNgPartKind,
} from "../../../Pages/XcpNg/Utils/XcpNgHealth";
import {
  XcpNgVmSummary,
  getXcpNgContentTypeWord,
  getXcpNgPartBadges,
  getXcpNgPartStatus,
  getXcpNgStorageTypeLabel,
  parseXcpNgTags,
} from "../../../Pages/XcpNg/Utils/XcpNgPartFacts";
import {
  formatXcpNgUptime,
  getXcpNgDisplayName,
  toXcpNgDate,
  toXcpNgNumber,
} from "../../../Pages/XcpNg/Utils/XcpNgResourceUtils";
import { XcpNgPartRoutes } from "./XcpNgPartRoutes";

/*
 * The top of an XCP-ng host's, VM's or storage repository's page, above its
 * tabs: which one it is, its state as Xen Orchestra reports it, where it
 * sits in the pool (each place one step away), its size and the facts an
 * XCP-ng admin looks for first - a host disabled for maintenance, a VM's
 * vCPUs and tags, a repository's type and whether it is shared. The shared
 * ResourcePartHero draws it; a state that says something is wrong opens
 * what its Needs attention card lists.
 */

export interface ComponentProps {
  kind: XcpNgPartKind;
  // The part's inventory row; null while it has not reported.
  row: XcpNgResource | null;
  externalId: string;
  poolName: string;
  routes: XcpNgPartRoutes;
  // A host's VMs, for its "running" chip.
  vmSummary?: XcpNgVmSummary | undefined;
  // A storage repository's virtual disks, for its count chip.
  virtualDiskCount?: number | undefined;
  /*
   * What its Needs attention card lists (getXcpNgPartAttention), which a
   * Halted, Unknown or nearly full state opens.
   */
  attention?: ResourcePartAttention | undefined;
  now: Date;
}

const STATUS_DESCRIPTIONS: Record<XcpNgPartKind, string> = {
  Host: XCP_NG_METRIC_DESCRIPTIONS.hostStatus,
  VM: XCP_NG_METRIC_DESCRIPTIONS.vmStatus,
  StorageRepository: XCP_NG_METRIC_DESCRIPTIONS.storageRepositoryUsed,
};

const ACCENTS: Record<XcpNgPartKind, ResourcePartAccent> = {
  Host: "violet",
  VM: "sky",
  StorageRepository: "emerald",
};

const XcpNgPartHero: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const row: XcpNgResource | null = props.row;
  const name: string = getXcpNgDisplayName(row, props.externalId);

  const partStatus: ResourcePartStatus | null = row
    ? getXcpNgPartStatus(row, props.now)
    : null;
  const status: ResourcePartStatus | undefined = partStatus
    ? { ...partStatus, description: STATUS_DESCRIPTIONS[props.kind] }
    : undefined;

  const chips: Array<ResourcePartChip> = [];

  const memory: number | null = toXcpNgNumber(row?.maxMemoryBytes);
  const isRunning: boolean = row?.isUp === true;
  const uptime: string = isRunning
    ? formatXcpNgUptime(row?.uptimeSeconds, translator)
    : "";

  const pushMemory: () => void = (): void => {
    if (memory !== null && memory > 0) {
      chips.push({
        key: "memory",
        icon: IconProp.SquareStack,
        label: translator.translateTemplate("{{size}} memory", {
          size: formatStorageBytes(memory, translator.language),
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

  const linkClassName: string =
    "font-medium text-gray-700 hover:text-indigo-600 hover:underline";
  const poolLink: ReactElement = (
    <Link to={props.routes.poolRoute} className={linkClassName}>
      {props.poolName}
    </Link>
  );
  const hostName: string = row?.parentHostName || "";
  const hostLink: ReactElement | null =
    hostName && row?.parentHostExternalId ? (
      <Link
        to={props.routes.getPartRoute("Host", row.parentHostExternalId)}
        className={linkClassName}
      >
        {hostName}
      </Link>
    ) : null;

  let location: ReactElement;

  if (props.kind === "Host") {
    location = (
      <TranslatedSentence
        template="Host of pool {{pool}}"
        slots={{ pool: poolLink }}
      />
    );
    const threads: number | null = toXcpNgNumber(row?.cpuCount);
    if (threads !== null && threads > 0) {
      chips.push({
        key: "threads",
        icon: IconProp.CPUChip,
        label: translator.translatePlural(
          { one: "{{count}} CPU thread", other: "{{count}} CPU threads" },
          threads,
        ),
      });
    }
    pushMemory();
    if (props.vmSummary && props.vmSummary.total > 0) {
      chips.push({
        key: "vms",
        icon: IconProp.Cube,
        label: translator.translatePlural(
          {
            one: "{{running}}/{{count}} VM running",
            other: "{{running}}/{{count}} VMs running",
          },
          props.vmSummary.total,
          // In the reader's digits, as the count beside it is.
          { running: translator.formatNumber(props.vmSummary.running) },
        ),
      });
    }
    pushUptime();
  } else if (props.kind === "VM") {
    location = hostLink ? (
      isRunning ? (
        <TranslatedSentence
          template="On host {{host}} of pool {{pool}}"
          slots={{ host: hostLink, pool: poolLink }}
        />
      ) : (
        <TranslatedSentence
          template="Last ran on host {{host}} of pool {{pool}}"
          slots={{ host: hostLink, pool: poolLink }}
        />
      )
    ) : (
      <TranslatedSentence
        template="VM of pool {{pool}}"
        slots={{ pool: poolLink }}
      />
    );
    const vcpus: number | null = toXcpNgNumber(row?.cpuCount);
    if (vcpus !== null && vcpus > 0) {
      chips.push({
        key: "vcpus",
        icon: IconProp.CPUChip,
        label: translator.translatePlural(
          { one: "{{count}} vCPU", other: "{{count}} vCPUs" },
          vcpus,
        ),
      });
    }
    pushMemory();
    pushUptime();
  } else {
    location =
      row?.isShared === true || !hostLink ? (
        <TranslatedSentence
          template="Storage repository of pool {{pool}}"
          slots={{ pool: poolLink }}
        />
      ) : (
        <TranslatedSentence
          template="Storage repository of host {{host}} in pool {{pool}}"
          slots={{ host: hostLink, pool: poolLink }}
        />
      );
    if (row?.srType) {
      chips.push({
        key: "type",
        icon: IconProp.Database,
        // A storage technology's name, the same in every language.
        label: getXcpNgStorageTypeLabel(row.srType),
      });
    }
    if (row?.contentType) {
      chips.push({
        key: "content",
        icon: IconProp.Folder,
        label: tx(getXcpNgContentTypeWord(row.contentType)),
      });
    }
    const size: number | null = toXcpNgNumber(row?.maxDiskBytes);
    if (size !== null && size > 0) {
      chips.push({
        key: "size",
        icon: IconProp.SquareStack,
        label: translator.translateTemplate("{{size}} total", {
          size: formatStorageBytes(size, translator.language),
        }),
      });
    }
    if (props.virtualDiskCount !== undefined && props.virtualDiskCount > 0) {
      chips.push({
        key: "disks",
        icon: IconProp.Disc,
        label: translator.translatePlural(
          { one: "{{count}} virtual disk", other: "{{count}} virtual disks" },
          props.virtualDiskCount,
        ),
      });
    }
  }

  return (
    <ResourcePartHero
      testId={`xcp-ng-${props.kind === "StorageRepository" ? "sr" : props.kind.toLowerCase()}-hero`}
      icon={XCP_NG_PART_ICONS[props.kind]}
      accent={ACCENTS[props.kind]}
      name={name}
      status={status}
      badges={row ? getXcpNgPartBadges(row) : []}
      location={location}
      lastReportAt={toXcpNgDate(row?.lastSeenAt)}
      chips={chips}
      tags={props.kind === "VM" ? parseXcpNgTags(row?.tags) : []}
      attention={props.attention}
    />
  );
};

export default XcpNgPartHero;
