import ProductType from "../../../Types/MeteredPlan/ProductType";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import {
  TelemetryUsageAmount,
  TelemetryUsageResourceSummary,
} from "../../../Types/Telemetry/TelemetryUsage";
import {
  getInlineSeparator,
  PluralTemplate,
  Translator,
} from "../../../Types/Translator";
import { translationKey } from "../../Utils/TranslateTemplate";
import { ChartColorValue } from "../Charts/ChartLibrary/Utils/ChartColors";

/*
 * What the usage pages call things, in English, each looked up where it is
 * drawn (Project Settings > Telemetry & APM > Usage, and the Admin
 * Dashboard's Telemetry Usage): the signals, the sizes, the costs, the
 * retention. React-free, so a plain test reads it.
 */

export const TELEMETRY_USAGE_SIGNAL_TITLES: Record<string, string> = {
  [ProductType.Logs]: translationKey("Logs"),
  [ProductType.Metrics]: translationKey("Metrics"),
  [ProductType.Traces]: translationKey("Traces"),
  [ProductType.Profiles]: translationKey("Profiles"),
  [ProductType.SessionReplay]: translationKey("Session Replays"),
  [ProductType.SecurityEvents]: translationKey("Security Events"),
};

/*
 * What a signal counts besides its name says, in its tile's (i): traces
 * count the exceptions recorded with them, as billing counts them.
 */
export const TELEMETRY_USAGE_SIGNAL_TOOLTIPS: Record<string, string> = {
  [ProductType.Traces]: translationKey(
    "Spans, and the exceptions recorded with them.",
  ),
  [ProductType.Profiles]: translationKey(
    "Profiles, and the samples recorded with them.",
  ),
};

// One colour per signal, the same on every chart and every day.
export const TELEMETRY_USAGE_SIGNAL_COLORS: Record<string, ChartColorValue> = {
  [ProductType.Logs]: "indigo",
  [ProductType.Metrics]: "emerald",
  [ProductType.Traces]: "amber",
  [ProductType.Profiles]: "cyan",
  [ProductType.SessionReplay]: "pink",
  [ProductType.SecurityEvents]: "rose",
};

export const getTelemetryUsageSignalTitle: (
  productType: ProductType | string,
  translator: Translator,
) => string = (
  productType: ProductType | string,
  translator: Translator,
): string => {
  const title: string =
    TELEMETRY_USAGE_SIGNAL_TITLES[productType] || productType.toString();

  return translator.translateText(title) || title;
};

const GB_TEMPLATE: string = translationKey("{{size}} GB");
const MB_TEMPLATE: string = translationKey("{{size}} MB");
const KB_TEMPLATE: string = translationKey("{{size}} KB");

/*
 * A usage in GB as people read it: "12.4 GB", "350 MB", "18 KB". A small
 * install sends megabytes a day, which "0.00 GB" would hide; the table still
 * sorts by the GB underneath.
 */
export const formatTelemetryUsageSize: (
  gigabytes: number,
  translator: Translator,
) => string = (gigabytes: number, translator: Translator): string => {
  const value: number = Number.isFinite(gigabytes) ? Math.max(0, gigabytes) : 0;

  if (value === 0 || value >= 1) {
    return translator.translateTemplate(GB_TEMPLATE, {
      size: translator.formatNumber(Math.round(value * 100) / 100),
    });
  }

  const megabytes: number = value * 1024;

  if (megabytes >= 1) {
    return translator.translateTemplate(MB_TEMPLATE, {
      size: translator.formatNumber(Math.round(megabytes * 10) / 10),
    });
  }

  return translator.translateTemplate(KB_TEMPLATE, {
    size: translator.formatNumber(
      Math.max(0.1, Math.round(megabytes * 1024 * 10) / 10),
    ),
  });
};

const COST_TEMPLATE: string = translationKey("{{amount}} USD");

// What usage cost, to the cent: "4.25 USD".
export const formatTelemetryUsageCost: (
  costInUSD: number,
  translator: Translator,
) => string = (costInUSD: number, translator: Translator): string => {
  const value: number = Number.isFinite(costInUSD) ? Math.max(0, costInUSD) : 0;

  return translator.translateTemplate(COST_TEMPLATE, {
    amount: translator.formatNumber(Math.round(value * 100) / 100),
  });
};

// A size, and what it cost beside it where the reader may see that.
export const formatTelemetryUsageAmount: (
  amount: TelemetryUsageAmount,
  translator: Translator,
) => string = (
  amount: TelemetryUsageAmount,
  translator: Translator,
): string => {
  const size: string = formatTelemetryUsageSize(
    amount.dataIngestedInGB,
    translator,
  );

  if (amount.totalCostInUSD === undefined) {
    return size;
  }

  return [
    size,
    formatTelemetryUsageCost(amount.totalCostInUSD, translator),
  ].join(getInlineSeparator(translator.language));
};

export const TELEMETRY_USAGE_RETENTION_DAYS: PluralTemplate = {
  one: "{{count}} day",
  other: "{{count}} days",
};

const SESSION_REPLAY_RETENTION: string = translationKey(
  "Session replays: {{days}}",
);

/*
 * How long a resource's telemetry is kept, and its session replays apart
 * where it recorded any: "15 days", "30 days · Session replays: 7 days".
 */
export const formatTelemetryUsageRetention: (
  resource: Pick<
    TelemetryUsageResourceSummary,
    "retentionInDays" | "sessionReplayRetentionInDays"
  >,
  translator: Translator,
) => string = (
  resource: Pick<
    TelemetryUsageResourceSummary,
    "retentionInDays" | "sessionReplayRetentionInDays"
  >,
  translator: Translator,
): string => {
  const parts: Array<string> = [];

  if (resource.retentionInDays) {
    parts.push(
      translator.translatePlural(
        TELEMETRY_USAGE_RETENTION_DAYS,
        resource.retentionInDays,
      ),
    );
  }

  if (resource.sessionReplayRetentionInDays) {
    const days: string = translator.translatePlural(
      TELEMETRY_USAGE_RETENTION_DAYS,
      resource.sessionReplayRetentionInDays,
    );

    parts.push(
      resource.retentionInDays
        ? translator.translateTemplate(SESSION_REPLAY_RETENTION, { days })
        : days,
    );
  }

  return parts.join(getInlineSeparator(translator.language));
};

/*
 * What kind of resource sent the usage, as the reader's language names it:
 * the same names the telemetry explorers' scope chips use
 * (Utils/Telemetry/TelemetryEntityNames).
 */
export const TELEMETRY_USAGE_RESOURCE_TYPE_LABELS: Record<string, string> = {
  [ServiceType.OpenTelemetry]: translationKey("Service"),
  [ServiceType.RealUserMonitor]: translationKey("RUM Application"),
  [ServiceType.Host]: translationKey("Host"),
  [ServiceType.DockerHost]: translationKey("Docker Host"),
  [ServiceType.PodmanHost]: translationKey("Podman Host"),
  [ServiceType.KubernetesCluster]: translationKey("Kubernetes Cluster"),
  [ServiceType.ProxmoxCluster]: translationKey("Proxmox Cluster"),
  [ServiceType.OpenStackCloud]: translationKey("OpenStack Cloud"),
  [ServiceType.CephCluster]: translationKey("Ceph Cluster"),
  [ServiceType.StorageArray]: translationKey("Storage Array"),
  [ServiceType.DockerSwarmCluster]: translationKey("Docker Swarm Cluster"),
  [ServiceType.VMwareVCenter]: translationKey("vCenter"),
  [ServiceType.IoTDevice]: translationKey("IoT Fleet"),
  [ServiceType.ServerlessFunction]: translationKey("Serverless Function"),
  [ServiceType.CloudResource]: translationKey("Cloud Resource"),
  [ServiceType.DatabaseServer]: translationKey("Database"),
  [ServiceType.NetworkDevice]: translationKey("Network Device"),
  [ServiceType.Unknown]: translationKey("Service"),
};

export const getTelemetryUsageResourceTypeLabel: (
  primaryEntityType: ServiceType | string | null | undefined,
  translator: Translator,
) => string = (
  primaryEntityType: ServiceType | string | null | undefined,
  translator: Translator,
): string => {
  const label: string =
    TELEMETRY_USAGE_RESOURCE_TYPE_LABELS[
      primaryEntityType || ServiceType.OpenTelemetry
    ] || TELEMETRY_USAGE_RESOURCE_TYPE_LABELS[ServiceType.OpenTelemetry]!;

  return translator.translateText(label) || label;
};

export const UNATTRIBUTED_TELEMETRY_NAME: string = translationKey(
  "Unknown Service",
);

/*
 * What a resource is called on the usage pages: its name, the unattributed
 * bucket's ("Unknown Service": telemetry that named no service, its id the
 * project's), or - for one that is gone, or whose kind the reader may not
 * read - its kind and the start of its id.
 */
export const getTelemetryUsageResourceName: (
  resource: Pick<
    TelemetryUsageResourceSummary,
    "primaryEntityId" | "primaryEntityType" | "name"
  >,
  projectId: string,
  translator: Translator,
) => string = (
  resource: Pick<
    TelemetryUsageResourceSummary,
    "primaryEntityId" | "primaryEntityType" | "name"
  >,
  projectId: string,
  translator: Translator,
): string => {
  if (resource.name) {
    return resource.name;
  }

  if (
    resource.primaryEntityType === ServiceType.Unknown ||
    resource.primaryEntityId === projectId
  ) {
    return translator.translateTerm(UNATTRIBUTED_TELEMETRY_NAME);
  }

  return translator.translateTemplate(
    translationKey("{{type}} {{id}}"),
    {
      type: getTelemetryUsageResourceTypeLabel(
        resource.primaryEntityType,
        translator,
      ),
      id: resource.primaryEntityId.slice(0, 8),
    },
  );
};
