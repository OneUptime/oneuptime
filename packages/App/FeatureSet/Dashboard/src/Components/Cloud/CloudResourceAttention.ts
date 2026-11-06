import Route from "Common/Types/API/Route";
import { Amber500, Gray500, Green, Red } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import {
  CloudHealthAssessment,
  CloudHealthRow,
  CloudHealthSeverity,
  CloudHealthText,
  CloudHealthTone,
  assessCloudResourceHealth,
} from "Common/Types/Cloud/CloudResourceHealth";
import { getCloudResourceTypeDisplayName } from "Common/Types/Cloud/CloudResourceCatalog";
import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
} from "../ResourcePart/ResourceAttention";

/*
 * WHAT NEEDS ATTENTION IN A PROJECT'S CLOUDS, AS ROWS.
 *
 * CloudResourceHealth (Common/Types/Cloud) decides what needs attention on
 * a cloud resource and how bad it is; this turns it into the rows the
 * shared Needs attention card draws (Components/ResourcePart) - on the
 * Cloud Overview, on an account's Overview and, as "This resource", on a
 * resource's own - and gives the lists their status pill's colours.
 *
 * React-free (pages hand in the routes), so App tests can read it.
 */

// How a resource's own page names its row: NeedsAttentionCard's `current`.
export const CLOUD_RESOURCE_ATTENTION_CURRENT: { key: string; label: string } =
  {
    key: "resource",
    label: translationKey("This resource"),
  };

/*
 * The lists' Health filter: the severity the last read stored
 * (CloudResource.healthSeverity), by the words the Status pill says it in.
 */
export const CLOUD_HEALTH_FILTER_OPTIONS: Array<{
  label: string;
  value: string;
}> = [
  {
    label: translationKey("Unhealthy"),
    value: CloudHealthSeverity.Critical,
  },
  { label: translationKey("Degraded"), value: CloudHealthSeverity.Warning },
];

// The pill's colours, the Hosts list's.
export const CLOUD_HEALTH_COLORS: Record<CloudHealthTone, Color> = {
  positive: Green,
  warning: Amber500,
  danger: Red,
  neutral: Gray500,
};

/*
 * What a page selects of a resource for its rules to judge it, with what it
 * names the resource by.
 */
export const CLOUD_RESOURCE_HEALTH_SELECT: {
  _id: true;
  name: true;
  cloudProvider: true;
  cloudResourceType: true;
  cloudRegion: true;
  cloudAccountId: true;
  otelCollectorStatus: true;
  cloudReadings: true;
  cloudReadingsAt: true;
  cloudProperties: true;
  healthSeverity: true;
  lastSeenAt: true;
} = {
  _id: true,
  name: true,
  cloudProvider: true,
  cloudResourceType: true,
  cloudRegion: true,
  cloudAccountId: true,
  otelCollectorStatus: true,
  cloudReadings: true,
  cloudReadingsAt: true,
  cloudProperties: true,
  healthSeverity: true,
  lastSeenAt: true,
};

// A resource as a page reads it: its rules' columns and its identity.
export interface CloudAttentionRow extends CloudHealthRow {
  _id?: string | { toString: () => string } | null | undefined;
  name?: string | null | undefined;
  cloudRegion?: string | null | undefined;
  cloudAccountId?: string | null | undefined;
}

function toSeverity(severity: CloudHealthSeverity): ResourceAttentionSeverity {
  return severity === CloudHealthSeverity.Critical
    ? ResourceAttentionSeverity.Critical
    : ResourceAttentionSeverity.Warning;
}

function idOf(row: CloudAttentionRow): string {
  return row._id ? row._id.toString() : "";
}

/*
 * Where a resource is, under its name: its Region, and the account it is
 * in when the list holds more than one account's.
 */
function placeOf(row: CloudAttentionRow, showAccount: boolean): string {
  const parts: Array<string> = [];

  if (row.cloudRegion) {
    parts.push(row.cloudRegion);
  }

  if (showAccount && row.cloudAccountId) {
    parts.push(row.cloudAccountId);
  }

  return parts.join(" · ");
}

/*
 * Every resource of the list that needs attention, the most urgent first:
 * the critical, then the ones with the most to look at, then by name as
 * people read numbers in names (web-2 before web-10). A resource whose
 * stored severity its fresh readings no longer bear out is left out.
 */
export function getCloudResourceAttentionItems(data: {
  resources: Array<CloudAttentionRow>;
  now: Date;
  getResourceRoute: (resourceId: string) => Route | undefined;
  // Name the account under each resource: the Overview reads every account.
  showAccount?: boolean | undefined;
}): Array<ResourceAttentionItem> {
  const assessed: Array<{
    row: CloudAttentionRow;
    name: string;
    assessment: CloudHealthAssessment;
  }> = [];

  for (const row of data.resources) {
    const assessment: CloudHealthAssessment = assessCloudResourceHealth(row, {
      now: data.now,
    });

    if (!assessment.severity) {
      continue;
    }

    assessed.push({
      row,
      name: (row.name || "").trim(),
      assessment,
    });
  }

  assessed.sort(
    (
      a: { name: string; assessment: CloudHealthAssessment },
      b: { name: string; assessment: CloudHealthAssessment },
    ): number => {
      const aCritical: number =
        a.assessment.severity === CloudHealthSeverity.Critical ? 0 : 1;
      const bCritical: number =
        b.assessment.severity === CloudHealthSeverity.Critical ? 0 : 1;

      if (aCritical !== bCritical) {
        return aCritical - bCritical;
      }

      if (a.assessment.reasons.length !== b.assessment.reasons.length) {
        return b.assessment.reasons.length - a.assessment.reasons.length;
      }

      return a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    },
  );

  return assessed.map(
    (entry: {
      row: CloudAttentionRow;
      name: string;
      assessment: CloudHealthAssessment;
    }): ResourceAttentionItem => {
      const resourceId: string = idOf(entry.row);
      const place: string = placeOf(entry.row, data.showAccount === true);

      return {
        key: resourceId || entry.name,
        /*
         * The type as its cloud's console names it ("Load Balancer",
         * "DB Instance"), the same in every language as the lists show it.
         */
        kind:
          getCloudResourceTypeDisplayName(
            entry.row.cloudProvider || "",
            entry.row.cloudResourceType || "",
          ) || translationKey("Cloud Resource"),
        kindAsWritten: true,
        icon: IconProp.Cloud,
        name: entry.name || resourceId,
        detail: place || undefined,
        severity: toSeverity(entry.assessment.severity!),
        reasons: entry.assessment.reasons,
        route: resourceId ? data.getResourceRoute(resourceId) : undefined,
      };
    },
  );
}

/*
 * The one row a resource's own page shows: "This resource" and why, or
 * nothing when it needs no attention.
 */
export function getCloudResourceOwnAttentionItems(data: {
  resource: CloudAttentionRow;
  now: Date;
}): Array<ResourceAttentionItem> {
  const assessment: CloudHealthAssessment = assessCloudResourceHealth(
    data.resource,
    { now: data.now },
  );

  if (!assessment.severity) {
    return [];
  }

  return [
    {
      key: CLOUD_RESOURCE_ATTENTION_CURRENT.key,
      kind: translationKey("Cloud Resource"),
      icon: IconProp.Cloud,
      name: (data.resource.name || "").trim(),
      severity: toSeverity(assessment.severity),
      reasons: assessment.reasons,
    },
  ];
}

// A resource's first reason and how many more, for one line of a list.
export function getCloudHealthReasonLine(assessment: CloudHealthAssessment): {
  first: CloudHealthText | null;
  more: number;
} {
  return {
    first: assessment.reasons[0] || null,
    more: Math.max(0, assessment.reasons.length - 1),
  };
}
