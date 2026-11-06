/*
 * The Cloud product page's recommended monitors (/product/cloud).
 *
 * What the page says of them comes from the product's own catalog
 * (Common/Types/Monitor/CloudAlertTemplates.ts) instead of being typed into
 * the template, so it cannot drift from what a cloud resource's and an
 * account's Recommendations offer: how many there are, for how many kinds
 * of resource, per cloud, and - in the picture of an account's
 * Recommendations - each one's real name and severity. A template added or
 * renamed shows on the page the next time it renders; one removed fails
 * Tests/CloudRecommendedMonitors until the picture names another.
 */
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import { getCloudResourceTypeDisplayName } from "Common/Types/Cloud/CloudResourceCatalog";
import {
  CloudAlertTemplate,
  CloudAlertTemplateSeverity,
  getAllCloudAlertTemplates,
  getCloudAlertTemplate,
  getCloudResourceTypesWithAlertTemplates,
} from "Common/Types/Monitor/CloudAlertTemplates";

export interface CloudRecommendedMonitorsByCloud {
  provider: CloudProvider;
  // The cloud as the page names it: "AWS", "Azure", "Google Cloud".
  name: string;
  monitorCount: number;
  resourceTypeCount: number;
}

// One row of the picture: one monitor for the resources of one type.
export interface CloudRecommendedMonitorRow {
  templateId: string;
  // The type as the product names it: "EC2 Instance", "ACM Certificate".
  resourceTypeLabel: string;
  name: string;
  severity: CloudAlertTemplateSeverity;
  // How many of the account's resources of the type have it, of how many.
  createdCount: number;
  resourceCount: number;
}

export interface CloudRecommendedMonitorsContent {
  monitorCount: number;
  resourceTypeCount: number;
  byCloud: Array<CloudRecommendedMonitorsByCloud>;
  // "38 for AWS, 37 for Azure and 8 for Google Cloud".
  byCloudSummary: string;
  rows: Array<CloudRecommendedMonitorRow>;
}

// "a, b and c": the clouds in one line, the way the page writes a list.
export function joinWithAnd(items: Array<string>): string {
  if (items.length <= 1) {
    return items.join("");
  }

  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const CLOUD_NAMES: ReadonlyArray<{ provider: CloudProvider; name: string }> = [
  { provider: CloudProvider.AWS, name: "AWS" },
  { provider: CloudProvider.Azure, name: "Azure" },
  { provider: CloudProvider.GCP, name: "Google Cloud" },
];

/*
 * The picture of an account's Recommendations: a monitor of each kind the
 * page names, on the resources of one made-up account. The counts are the
 * picture's; the names and severities are the catalog's.
 */
const PICTURED_ROWS: ReadonlyArray<{
  templateId: string;
  createdCount: number;
  resourceCount: number;
}> = [
  {
    templateId: "cloud-aws-ec2-status-check-failed",
    createdCount: 12,
    resourceCount: 12,
  },
  {
    templateId: "cloud-aws-rds-connections-near-limit",
    createdCount: 0,
    resourceCount: 3,
  },
  {
    templateId: "cloud-aws-lambda-errors",
    createdCount: 7,
    resourceCount: 9,
  },
  {
    templateId: "cloud-aws-acm-certificate-expiring",
    createdCount: 0,
    resourceCount: 4,
  },
];

function getTemplate(id: string): CloudAlertTemplate {
  const template: CloudAlertTemplate | undefined = getCloudAlertTemplate(id);

  if (!template) {
    throw new Error(
      `The Cloud page pictures a monitor the catalog has not: ${id}`,
    );
  }

  return template;
}

export function getCloudRecommendedMonitorsContent(): CloudRecommendedMonitorsContent {
  const templates: Array<CloudAlertTemplate> = getAllCloudAlertTemplates();
  const byCloud: Array<CloudRecommendedMonitorsByCloud> = CLOUD_NAMES.map(
    (cloud: {
      provider: CloudProvider;
      name: string;
    }): CloudRecommendedMonitorsByCloud => {
      return {
        provider: cloud.provider,
        name: cloud.name,
        monitorCount: templates.filter(
          (template: CloudAlertTemplate): boolean => {
            return template.provider === cloud.provider;
          },
        ).length,
        resourceTypeCount: getCloudResourceTypesWithAlertTemplates(
          cloud.provider,
        ).length,
      };
    },
  );

  return {
    monitorCount: templates.length,
    resourceTypeCount: getCloudResourceTypesWithAlertTemplates().length,
    byCloud: byCloud,
    byCloudSummary: joinWithAnd(
      byCloud.map((cloud: CloudRecommendedMonitorsByCloud): string => {
        return `${cloud.monitorCount} for ${cloud.name}`;
      }),
    ),
    rows: PICTURED_ROWS.map(
      (row: {
        templateId: string;
        createdCount: number;
        resourceCount: number;
      }): CloudRecommendedMonitorRow => {
        const template: CloudAlertTemplate = getTemplate(row.templateId);

        return {
          templateId: template.id,
          resourceTypeLabel: getCloudResourceTypeDisplayName(
            template.provider,
            template.resourceTypes[0],
          ),
          name: template.name,
          severity: template.severity,
          createdCount: row.createdCount,
          resourceCount: row.resourceCount,
        };
      },
    ),
  };
}
