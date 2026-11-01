import ProxmoxResource from "Common/Models/DatabaseModels/ProxmoxResource";
import {
  composedValue,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import {
  InfrastructureResource,
  ResourceColumn,
} from "../Infrastructure/ResourceTable";
import { PROXMOX_METRIC_DESCRIPTIONS } from "../MetricDescriptions/ProxmoxMetricDescriptions";
import { formatRelativeTime } from "../Home/HomeRelativeTime";
import {
  ProxmoxGuestBackup,
  getProxmoxGuestBackup,
  getProxmoxGuestKind,
  getProxmoxStorageTypeLabel,
  summarizeProxmoxGuests,
  ProxmoxGuestSummary,
} from "../../Pages/Proxmox/Utils/ProxmoxPartFacts";
import {
  formatBytes,
  toInfrastructureResource,
} from "../../Pages/Proxmox/Utils/ProxmoxResourceUtils";

/*
 * The columns of the Proxmox lists - a cluster's nodes, guests and storage,
 * and a node's own guests and storage tabs - so a guest reads the same in
 * every list: its kind as a word ("VM", "Container") and its last backup.
 * A column only some clusters fill (HA, a storage's type) shows when a row
 * has a value for it; a guest's tags and what a storage holds are on their
 * own pages, where there is room for them.
 *
 * Each row carries what its cells need in additionalAttributes (the
 * ResourceTable contract); the words are looked up in the reader's language
 * here, where a translator is at hand.
 */

const BACKUP_FAILED: string = translationKey("Failed {{time}}");
const BACKUP_OK: string = translationKey("Backed up {{time}}");
const BACKUP_IN_JOB: string = translationKey("In a backup job");
const BACKUP_NOT_IN_JOB: string = translationKey("In no backup job");
const STORAGE_SHARED: string = translationKey("Shared");
const STORAGE_LOCAL: string = translationKey("Local");

const NO_VALUE: string = "-";

// One guest's backup, in a cell: how its last one went and when, or its job coverage.
export function formatProxmoxBackupCell(data: {
  backup: ProxmoxGuestBackup;
  translator: Translator;
  now: Date;
}): string {
  const when: (date: Date) => ReturnType<typeof composedValue> = (
    date: Date,
  ): ReturnType<typeof composedValue> => {
    return composedValue((sentence: Translator): string => {
      return formatRelativeTime({
        date: date,
        now: data.now,
        language: sentence.language,
      });
    });
  };

  const backup: ProxmoxGuestBackup = data.backup;
  if (backup.state === "failed" && backup.lastBackupAt) {
    return data.translator.translateTemplate(BACKUP_FAILED, {
      time: when(backup.lastBackupAt),
    });
  }
  if (backup.state === "ok" && backup.lastBackupAt) {
    return data.translator.translateTemplate(BACKUP_OK, {
      time: when(backup.lastBackupAt),
    });
  }
  if (backup.state === "no-result") {
    return data.translator.translateText(BACKUP_IN_JOB) || BACKUP_IN_JOB;
  }
  if (backup.state === "not-in-job") {
    return (
      data.translator.translateText(BACKUP_NOT_IN_JOB) || BACKUP_NOT_IN_JOB
    );
  }
  return NO_VALUE;
}

/*
 * A row of a Proxmox list: the shared view-model, plus what the Proxmox
 * columns read. Words stay English here (a column looks them up).
 */
export function toProxmoxListResource(
  row: ProxmoxResource,
): InfrastructureResource {
  const resource: InfrastructureResource = toInfrastructureResource(row);
  const attributes: Record<string, string> = resource.additionalAttributes;

  if (row.kind === "Guest") {
    attributes["guestKind"] = getProxmoxGuestKind(row);
  }

  if (row.kind === "Storage") {
    if (row.storageType) {
      attributes["storageType"] = row.storageType;
    }
    if (row.isShared !== null && row.isShared !== undefined) {
      attributes["shared"] = row.isShared ? "true" : "false";
    }
  }

  return resource;
}

function hasAttribute(
  resources: Array<InfrastructureResource>,
  key: string,
): boolean {
  return resources.some((resource: InfrastructureResource): boolean => {
    return Boolean(resource.additionalAttributes[key]);
  });
}

export function getProxmoxGuestColumns(data: {
  rows: Array<ProxmoxResource>;
  resources: Array<InfrastructureResource>;
  translator: Translator;
  now: Date;
}): Array<ResourceColumn> {
  const tx: (text: string) => string = (text: string): string => {
    return data.translator.translateText(text) || text;
  };

  const backups: Map<string, ProxmoxGuestBackup> = new Map();
  for (const row of data.rows) {
    if (row.kind === "Guest" && row.externalId) {
      backups.set(row.externalId, getProxmoxGuestBackup(row));
    }
  }

  const columns: Array<ResourceColumn> = [
    {
      title: "VMID",
      key: "vmid",
    },
    {
      title: "Type",
      key: "guestKind",
      getValue: (resource: InfrastructureResource): string => {
        const kind: string = resource.additionalAttributes["guestKind"] || "";
        return kind ? tx(kind) : NO_VALUE;
      },
    },
  ];

  if (hasAttribute(data.resources, "haState")) {
    columns.push({
      title: "HA State",
      key: "haState",
      description: PROXMOX_METRIC_DESCRIPTIONS.guestsTableHaState,
      getValue: (resource: InfrastructureResource): string => {
        return resource.additionalAttributes["haState"] || NO_VALUE;
      },
    });
  }

  columns.push({
    title: "Backup",
    key: "backup",
    description: PROXMOX_METRIC_DESCRIPTIONS.guestsTableBackup,
    getValue: (resource: InfrastructureResource): string => {
      const backup: ProxmoxGuestBackup | undefined = backups.get(
        resource.additionalAttributes["externalId"] || "",
      );
      if (!backup) {
        return NO_VALUE;
      }
      return formatProxmoxBackupCell({
        backup: backup,
        translator: data.translator,
        now: data.now,
      });
    },
  });

  return columns;
}

export function getProxmoxStorageColumns(data: {
  resources: Array<InfrastructureResource>;
  translator: Translator;
}): Array<ResourceColumn> {
  const tx: (text: string) => string = (text: string): string => {
    return data.translator.translateText(text) || text;
  };

  const columns: Array<ResourceColumn> = [];

  if (hasAttribute(data.resources, "storageType")) {
    columns.push({
      title: "Type",
      key: "storageType",
      getValue: (resource: InfrastructureResource): string => {
        const type: string = resource.additionalAttributes["storageType"] || "";
        return type ? tx(getProxmoxStorageTypeLabel(type)) : NO_VALUE;
      },
    });
  }

  if (hasAttribute(data.resources, "shared")) {
    columns.push({
      title: "Shared",
      key: "shared",
      description: PROXMOX_METRIC_DESCRIPTIONS.storageShared,
      getValue: (resource: InfrastructureResource): string => {
        const shared: string = resource.additionalAttributes["shared"] || "";
        if (!shared) {
          return NO_VALUE;
        }
        return tx(shared === "true" ? STORAGE_SHARED : STORAGE_LOCAL);
      },
    });
  }

  columns.push({
    title: "Used / Total",
    key: "diskBytes",
    description: PROXMOX_METRIC_DESCRIPTIONS.storageTableUsage,
    getValue: (resource: InfrastructureResource): string => {
      const usedRaw: string = resource.additionalAttributes["diskBytes"] || "";
      const totalRaw: string =
        resource.additionalAttributes["maxDiskBytes"] || "";
      if (!usedRaw || !totalRaw) {
        return "N/A";
      }
      const used: number = Number(usedRaw);
      const total: number = Number(totalRaw);
      if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) {
        return "N/A";
      }
      const pct: number = (used / total) * 100;
      return `${formatBytes(used)} / ${formatBytes(total)} (${pct.toFixed(1)}%)`;
    },
  });

  return columns;
}

// A node's guests in its list: "12/14 running", templates left out.
export function getProxmoxNodeColumns(data: {
  rows: Array<ProxmoxResource>;
  translator: Translator;
}): Array<ResourceColumn> {
  const guestsByNode: Map<string, Array<ProxmoxResource>> = new Map();
  for (const row of data.rows) {
    if (row.kind !== "Guest" || !row.parentNodeName) {
      continue;
    }
    const list: Array<ProxmoxResource> =
      guestsByNode.get(row.parentNodeName) || [];
    list.push(row);
    guestsByNode.set(row.parentNodeName, list);
  }

  if (guestsByNode.size === 0) {
    return [];
  }

  return [
    {
      title: "Guests",
      key: "guests",
      description: PROXMOX_METRIC_DESCRIPTIONS.nodesTableGuests,
      getValue: (resource: InfrastructureResource): string => {
        const externalId: string =
          resource.additionalAttributes["externalId"] || "";
        const nodeName: string = externalId.startsWith("node/")
          ? externalId.substring("node/".length)
          : resource.name;
        const summary: ProxmoxGuestSummary = summarizeProxmoxGuests(
          guestsByNode.get(nodeName) || [],
        );
        if (summary.total === 0) {
          return NO_VALUE;
        }
        return data.translator.translatePlural(
          {
            one: "{{running}}/{{count}} running",
            other: "{{running}}/{{count}} running",
          },
          summary.total,
          { running: String(summary.running) },
        );
      },
    },
  ];
}
