import XcpNgResource from "Common/Models/DatabaseModels/XcpNgResource";
import { EMPTY_VALUE_MARK } from "Common/Types/EmptyValueMark";
import XcpNgResourceKind from "Common/Types/XcpNg/XcpNgResourceKind";
import {
  composedValue,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import { formatStorageBytes } from "Common/Utils/Storage/StorageUsage";
import { formatReaderFigure } from "Common/Types/DateLanguage";
import {
  InfrastructureResource,
  ResourceColumn,
  ResourceColumnTone,
  ResourceStatusReason,
  ResourceStorageUsageColumns,
} from "../Infrastructure/ResourceTable";
import { formatRelativeTime } from "../Home/HomeRelativeTime";
import { ResourcePartStatus } from "../ResourcePart/ResourcePartTypes";
import { XCP_NG_METRIC_DESCRIPTIONS } from "../MetricDescriptions/XcpNgMetricDescriptions";
import { XCP_NG_PAGE_DESCRIPTIONS } from "./XcpNgPageDescriptions";
import {
  getXcpNgAllocationPercent,
  getXcpNgStorageUsage,
  isXcpNgControlDomain,
  isXcpNgStorageOverAllocated,
} from "../../Pages/XcpNg/Utils/XcpNgHealth";
import {
  XcpNgVmMemory,
  XcpNgVmSummary,
  getXcpNgContentTypeWord,
  getXcpNgHostStatus,
  getXcpNgStorageTypeLabel,
  getXcpNgVmMemory,
  getXcpNgVmStatus,
  parseXcpNgTags,
  summarizeXcpNgVms,
} from "../../Pages/XcpNg/Utils/XcpNgPartFacts";
import {
  formatXcpNgUptime,
  formatXcpNgWatts,
  getXcpNgDisplayName,
  isXcpNgReadingFresh,
  toXcpNgDate,
  toXcpNgNumber,
} from "../../Pages/XcpNg/Utils/XcpNgResourceUtils";

/*
 * THE COLUMNS OF AN XCP-NG POOL'S LISTS - its hosts, its VMs, its storage
 * repositories, and a host's own VMs and storage - so a part reads the same
 * in every list.
 *
 * Each row carries what its cells need in additionalAttributes (the
 * ResourceTable contract); the words are looked up in the reader's language
 * here, where a translator is at hand.
 *
 *   - A host's state is Xen Orchestra's (Running, Halted, Unknown); a
 *     disabled one says so in grey under it, a choice someone made.
 *   - A VM's state is Running, Halted, Paused or Suspended; a halted or
 *     paused VM is amber only when it ran in the last day. Its memory is in
 *     use only while its guest tools report what is free; otherwise the
 *     list shows what it was given, with no bar (the column's (i) says why).
 *     Its age is its uptime, or when it was last seen running.
 *   - A storage repository is local to its host or shared by the pool, one
 *     column; how full it is reads as the shared bar, and what is allocated
 *     on it against its size, amber past its size.
 *
 * A reading older than 15 minutes is no reading of now: a list draws no CPU
 * or memory for it (XCP_NG_METRIC_STALE_MS).
 */

const REASON_DISABLED: string = translationKey("Disabled: starts no new VMs");
const REASON_CONTROL_DOMAIN: string = translationKey("Control domain");
const AGE_LAST_RUNNING: string = translationKey("Last running {{time}}");
const SHARED_WORD: string = translationKey("Shared");
const NOT_MEASURED: string = translationKey("Not measured");
const OVER_PROVISIONED: string = translationKey(
  "{{allocated}} ({{percent}}): over-provisioned",
);
const VMS_RUNNING: { one: string; other: string } = {
  one: "{{running}}/{{count}} running",
  other: "{{running}}/{{count}} running",
};

/*
 * The Used and Free columns of the storage list (ResourceTable): how full
 * each repository is as a bar, and what is left.
 */
export const XCP_NG_STORAGE_USAGE_COLUMNS: ResourceStorageUsageColumns = {
  usedDescription: XCP_NG_METRIC_DESCRIPTIONS.storageTableUsed,
  freeDescription: XCP_NG_PAGE_DESCRIPTIONS.storageFree,
};

export const XCP_NG_HOST_COLUMN_DESCRIPTIONS: {
  status: string;
  cpu: string;
  memory: string;
  age: string;
} = {
  status: XCP_NG_METRIC_DESCRIPTIONS.hostsTableStatus,
  cpu: XCP_NG_METRIC_DESCRIPTIONS.hostsTableCpu,
  memory: XCP_NG_METRIC_DESCRIPTIONS.hostsTableMemory,
  age: XCP_NG_METRIC_DESCRIPTIONS.hostsTableUptime,
};

export const XCP_NG_VM_COLUMN_DESCRIPTIONS: {
  status: string;
  cpu: string;
  memory: string;
  age: string;
} = {
  status: XCP_NG_METRIC_DESCRIPTIONS.vmsTableStatus,
  cpu: XCP_NG_METRIC_DESCRIPTIONS.vmsTableCpu,
  memory: XCP_NG_METRIC_DESCRIPTIONS.vmsTableMemory,
  age: XCP_NG_METRIC_DESCRIPTIONS.vmsTableUptime,
};

const NO_VALUE: string = EMPTY_VALUE_MARK;

function hasAttribute(
  resources: Array<InfrastructureResource>,
  key: string,
): boolean {
  return resources.some((resource: InfrastructureResource): boolean => {
    return Boolean(resource.additionalAttributes[key]);
  });
}

// A row's state, worded and coloured by the pool's own rules.
function applyStatus(
  resource: InfrastructureResource,
  status: ResourcePartStatus | null,
): void {
  if (!status) {
    resource.status = "";
    return;
  }
  // The English word: the filter and the sort read it.
  resource.status = status.label;
  resource.statusText = status.values
    ? { text: status.label, values: status.values }
    : { text: status.label };
  resource.statusTone = status.tone;
}

/*
 * A row of an XCP-ng list: the shared view-model, worded for the reader.
 * `now` decides whether a reading is fresh enough to draw, and how long ago
 * a stopped VM last ran.
 */
export function toXcpNgListResource(
  row: XcpNgResource,
  data: { now: Date; translator: Translator },
): InfrastructureResource {
  const isFresh: boolean = isXcpNgReadingFresh(row, data.now);
  const isRunning: boolean = row.isUp === true;
  const cpu: number | null =
    isFresh && isRunning ? toXcpNgNumber(row.latestCpuPercent) : null;

  const attributes: Record<string, string> = {
    externalId: row.externalId || "",
  };

  const resource: InfrastructureResource = {
    name: getXcpNgDisplayName(row),
    namespace: "",
    cpuUtilization: cpu,
    memoryUsageBytes: null,
    memoryLimitBytes: null,
    status: "",
    age: "",
    additionalAttributes: attributes,
  };

  if (row.kind === XcpNgResourceKind.Host) {
    applyStatus(resource, getXcpNgHostStatus(row));
    if (row.isEnabled === false) {
      const reasons: Array<ResourceStatusReason> = [{ text: REASON_DISABLED }];
      resource.statusReasons = reasons;
    }
    const used: number | null = toXcpNgNumber(row.latestMemoryBytes);
    const total: number | null = toXcpNgNumber(row.maxMemoryBytes);
    if (isFresh && isRunning && used !== null) {
      resource.memoryUsageBytes = used;
      resource.memoryLimitBytes = total !== null && total > 0 ? total : null;
    }
    resource.age = isRunning
      ? formatXcpNgUptime(row.uptimeSeconds, data.translator)
      : "";
    const threads: number | null = toXcpNgNumber(row.cpuCount);
    const vcpus: number | null = toXcpNgNumber(row.runningVcpuCount);
    if (vcpus !== null && threads !== null && threads > 0) {
      attributes["vcpus"] = `${Math.round(vcpus)}/${Math.round(threads)}`;
    } else if (threads !== null && threads > 0) {
      attributes["threads"] = String(Math.round(threads));
    }
    const watts: number | null = toXcpNgNumber(row.powerWatts);
    if (watts !== null && isRunning) {
      attributes["power"] = String(watts);
    }
    return resource;
  }

  if (row.kind === XcpNgResourceKind.VM) {
    resource.namespace = row.parentHostName || "";
    applyStatus(resource, getXcpNgVmStatus(row, data.now));
    if (isXcpNgControlDomain(row)) {
      resource.statusReasons = [{ text: REASON_CONTROL_DOMAIN }];
    }
    const memory: XcpNgVmMemory = getXcpNgVmMemory(row);
    if (isRunning && isFresh && memory.inUseBytes !== null) {
      resource.memoryUsageBytes = memory.inUseBytes;
      resource.memoryLimitBytes = memory.givenBytes;
    } else if (memory.givenBytes !== null) {
      // What it was given, drawn plain: nothing says what it uses.
      resource.memoryUsageBytes = memory.givenBytes;
      resource.memoryLimitBytes = null;
    }
    if (isRunning) {
      resource.age = formatXcpNgUptime(row.uptimeSeconds, data.translator);
    } else {
      const lastRunningAt: Date | null = toXcpNgDate(row.lastRunningAt);
      if (lastRunningAt) {
        resource.age = data.translator.translateTemplate(AGE_LAST_RUNNING, {
          time: composedValue((sentence: Translator): string => {
            return formatRelativeTime({
              date: lastRunningAt,
              now: data.now,
              language: sentence.language,
            });
          }),
        });
      }
    }
    const vcpus: number | null = toXcpNgNumber(row.cpuCount);
    if (vcpus !== null && vcpus > 0) {
      attributes["vcpus"] = String(Math.round(vcpus));
    }
    const tags: Array<string> = parseXcpNgTags(row.tags);
    if (tags.length > 0) {
      attributes["tags"] = tags.join(", ");
    }
    return resource;
  }

  if (row.kind === XcpNgResourceKind.StorageRepository) {
    /*
     * Local to its host, or shared by the pool: one column, whose filter
     * picks a host or "Shared".
     */
    resource.namespace =
      row.isShared === true
        ? data.translator.translateText(SHARED_WORD) || SHARED_WORD
        : row.parentHostName || "";
    resource.storageUsage = {
      usage: getXcpNgStorageUsage(row),
      noUsageText: NOT_MEASURED,
    };
    const size: number | null = toXcpNgNumber(row.maxDiskBytes);
    if (size !== null && size > 0) {
      attributes["size"] = String(size);
    }
    const allocated: number | null = toXcpNgNumber(row.virtualAllocationBytes);
    if (allocated !== null && allocated > 0) {
      attributes["allocated"] = String(allocated);
    }
    if (row.srType) {
      attributes["srType"] = row.srType;
    }
    if (row.contentType) {
      attributes["contentType"] = row.contentType;
    }
    return resource;
  }

  return resource;
}

/*
 * A host's columns: the vCPUs its VMs run on its threads, the VMs it runs,
 * and its power draw where a host reports one.
 */
export function getXcpNgHostColumns(data: {
  rows: Array<XcpNgResource>;
  resources: Array<InfrastructureResource>;
  translator: Translator;
}): Array<ResourceColumn> {
  const vmsByHost: Map<string, Array<XcpNgResource>> = new Map();
  for (const row of data.rows) {
    if (row.kind !== XcpNgResourceKind.VM || !row.parentHostExternalId) {
      continue;
    }
    const list: Array<XcpNgResource> =
      vmsByHost.get(row.parentHostExternalId) || [];
    list.push(row);
    vmsByHost.set(row.parentHostExternalId, list);
  }

  const columns: Array<ResourceColumn> = [];

  if (
    hasAttribute(data.resources, "vcpus") ||
    hasAttribute(data.resources, "threads")
  ) {
    columns.push({
      title: "vCPUs/Threads",
      key: "vcpus",
      description: XCP_NG_PAGE_DESCRIPTIONS.hostsTableVcpus,
      isCount: true,
      getValue: (resource: InfrastructureResource): string => {
        return (
          resource.additionalAttributes["vcpus"] ||
          resource.additionalAttributes["threads"] ||
          NO_VALUE
        );
      },
    });
  }

  if (vmsByHost.size > 0) {
    columns.push({
      title: "VMs",
      key: "vms",
      description: XCP_NG_PAGE_DESCRIPTIONS.hostVms,
      getValue: (resource: InfrastructureResource): string => {
        const summary: XcpNgVmSummary = summarizeXcpNgVms(
          vmsByHost.get(resource.additionalAttributes["externalId"] || "") ||
            [],
        );
        if (summary.total === 0) {
          return NO_VALUE;
        }
        return data.translator.translatePlural(VMS_RUNNING, summary.total, {
          // In the reader's digits, as the count beside it is.
          running: data.translator.formatNumber(summary.running),
        });
      },
    });
  }

  if (hasAttribute(data.resources, "power")) {
    columns.push({
      title: "Power",
      key: "power",
      description: XCP_NG_PAGE_DESCRIPTIONS.hostsTablePower,
      foldInto: "cpuUtilization",
      showTitleWhenFolded: true,
      getValue: (resource: InfrastructureResource): string => {
        const watts: number | null = toXcpNgNumber(
          resource.additionalAttributes["power"],
        );
        return watts === null ? NO_VALUE : formatXcpNgWatts(watts);
      },
    });
  }

  return columns;
}

// A VM's columns: its vCPUs, and its tags where a VM has some.
export function getXcpNgVmColumns(data: {
  resources: Array<InfrastructureResource>;
}): Array<ResourceColumn> {
  const columns: Array<ResourceColumn> = [];

  if (hasAttribute(data.resources, "vcpus")) {
    columns.push({
      title: "vCPUs",
      key: "vcpus",
      description: XCP_NG_PAGE_DESCRIPTIONS.vmVcpus,
      isCount: true,
      getValue: (resource: InfrastructureResource): string => {
        return resource.additionalAttributes["vcpus"] || NO_VALUE;
      },
    });
  }

  if (hasAttribute(data.resources, "tags")) {
    columns.push({
      title: "Tags",
      key: "tags",
      description: XCP_NG_PAGE_DESCRIPTIONS.vmTags,
      foldInto: "name",
      // Tags are names: drawn whole, as Xen Orchestra writes them.
      isName: true,
      getValue: (resource: InfrastructureResource): string => {
        return resource.additionalAttributes["tags"] || NO_VALUE;
      },
    });
  }

  return columns;
}

/*
 * A storage repository's columns, after the Used and Free bars: its size,
 * what is allocated on it against that size (amber, and saying so, past
 * it), how it stores disks, what it holds, and how many virtual disks it
 * holds.
 */
export function getXcpNgStorageColumns(data: {
  rows: Array<XcpNgResource>;
  resources: Array<InfrastructureResource>;
  translator: Translator;
  /*
   * The count of virtual disks on each, read from the VDI rows among
   * `rows`; left out where the page reads none (a host's own storage).
   */
  showVirtualDisks?: boolean | undefined;
}): Array<ResourceColumn> {
  const tx: (text: string) => string = (text: string): string => {
    return data.translator.translateText(text) || text;
  };

  const disksBySr: Map<string, number> = new Map();
  const repositoriesById: Map<string, XcpNgResource> = new Map();
  for (const row of data.rows) {
    if (row.kind === XcpNgResourceKind.VDI && row.storageRepositoryExternalId) {
      disksBySr.set(
        row.storageRepositoryExternalId,
        (disksBySr.get(row.storageRepositoryExternalId) || 0) + 1,
      );
    } else if (
      row.kind === XcpNgResourceKind.StorageRepository &&
      row.externalId
    ) {
      repositoriesById.set(row.externalId, row);
    }
  }

  const repositoryOf: (
    resource: InfrastructureResource,
  ) => XcpNgResource | undefined = (
    resource: InfrastructureResource,
  ): XcpNgResource | undefined => {
    return repositoriesById.get(
      resource.additionalAttributes["externalId"] || "",
    );
  };

  const columns: Array<ResourceColumn> = [
    {
      title: "Size",
      key: "size",
      foldInto: "storageUsage",
      showTitleWhenFolded: true,
      getValue: (resource: InfrastructureResource): string => {
        const size: number | null = toXcpNgNumber(
          resource.additionalAttributes["size"],
        );
        if (size === null || size <= 0) {
          return NO_VALUE;
        }
        return formatStorageBytes(size, data.translator.language);
      },
    },
  ];

  if (hasAttribute(data.resources, "allocated")) {
    columns.push({
      title: "Allocated",
      key: "allocated",
      description: XCP_NG_PAGE_DESCRIPTIONS.storageTableAllocated,
      getValue: (resource: InfrastructureResource): string => {
        const row: XcpNgResource | undefined = repositoryOf(resource);
        const allocated: number | null = toXcpNgNumber(
          resource.additionalAttributes["allocated"],
        );
        if (!row || allocated === null) {
          return NO_VALUE;
        }
        const written: string = formatStorageBytes(
          allocated,
          data.translator.language,
        );
        const percent: number | null = getXcpNgAllocationPercent(row);
        if (percent === null) {
          return written;
        }
        const percentWritten: string = formatReaderFigure(Math.round(percent), {
          decimals: 0,
          isPercent: true,
          language: data.translator.language,
        });
        if (isXcpNgStorageOverAllocated(row)) {
          return data.translator.translateTemplate(OVER_PROVISIONED, {
            allocated: written,
            percent: percentWritten,
          });
        }
        // An aside in brackets, no sentence: "1.2 TiB (60%)".
        return `${written} (${percentWritten})`;
      },
      getTone: (
        resource: InfrastructureResource,
      ): ResourceColumnTone | undefined => {
        const row: XcpNgResource | undefined = repositoryOf(resource);
        return row && isXcpNgStorageOverAllocated(row) ? "warning" : undefined;
      },
    });
  }

  if (hasAttribute(data.resources, "srType")) {
    columns.push({
      title: "Type",
      key: "srType",
      description: XCP_NG_PAGE_DESCRIPTIONS.storageType,
      getValue: (resource: InfrastructureResource): string => {
        const type: string = resource.additionalAttributes["srType"] || "";
        // A storage technology's name, the same in every language.
        return type ? getXcpNgStorageTypeLabel(type) : NO_VALUE;
      },
    });
  }

  if (hasAttribute(data.resources, "contentType")) {
    columns.push({
      title: "Content",
      key: "contentType",
      description: XCP_NG_PAGE_DESCRIPTIONS.storageContent,
      getValue: (resource: InfrastructureResource): string => {
        const content: string =
          resource.additionalAttributes["contentType"] || "";
        return content ? tx(getXcpNgContentTypeWord(content)) : NO_VALUE;
      },
    });
  }

  if (data.showVirtualDisks === false) {
    return columns;
  }

  columns.push({
    title: "Virtual Disks",
    key: "virtualDisks",
    description: XCP_NG_PAGE_DESCRIPTIONS.storageVirtualDisks,
    isCount: true,
    getValue: (resource: InfrastructureResource): string => {
      const count: number | undefined = disksBySr.get(
        resource.additionalAttributes["externalId"] || "",
      );
      return count === undefined ? "0" : String(count);
    },
  });

  return columns;
}
