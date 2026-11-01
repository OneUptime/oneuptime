import CloudAccount from "../../../../Models/DatabaseModels/CloudAccount";
import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import Dictionary from "../../../../Types/Dictionary";
import ObjectID from "../../../../Types/ObjectID";
import { getManagedCloudPlatformLabel } from "../../../../Types/Cloud/CloudPlatform";
import { isCloudResourceKindResource } from "../../../../Types/Cloud/CloudResourceKind";
import { getCloudResourceTypeLabel } from "../../../../Types/Cloud/CloudResourceCatalog";
import AlertService from "../../../Services/AlertService";
import CloudAccountService from "../../../Services/CloudAccountService";
import CloudResourceService from "../../../Services/CloudResourceService";
import IncidentService from "../../../Services/IncidentService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import LinkedAffectedResources, {
  LinkedAffectedResource,
  LinkedAffectedResourceType,
} from "../../AffectedResources/LinkedAffectedResources";
import logger from "../../Logger";
import { untrustedLine } from "../SRE/UntrustedText";
import CloudAiTargets from "../ResourceAccess/CloudAiTargets";
import { escapeUntrustedContext } from "./RemediationPlanRunner";

/*
 * WHAT A CLOUD ROUND IS ABOUT, IN ITS ACCOUNT.
 *
 * A fix round on an AWS account, an Azure subscription or a Google Cloud
 * project used to be told only the account: "AWS account prod". Which of
 * its hundreds of resources the incident is about, the model had to work
 * out from the root cause analysis - and an incident linked to an ECS
 * service named it nowhere. The round's context now lists what the
 * incident or alert is linked to in this account, as the account's
 * inventory has it:
 *
 *   - a Cloud resource (Cloud's): its name, type and region, the id a
 *     change names it by, and the code that declares it, if any (a change
 *     to it is only ever proposed, CloudAiTargets);
 *   - a Cloud environment (App Platforms'): a platform in a region where
 *     apps run (ECS on Fargate, Cloud Run, Container Apps, ...), which is
 *     no one resource: the change names the service the incident's
 *     services run as, found in the inventory.
 *
 * Names, types and tags were written in the customer's cloud: they reach
 * the prompt as data, on one line each, inside the untrusted frame. At most
 * MAX_LISTED cloud rows, of this account only.
 */

const MAX_LISTED: number = 10;
const MAX_NAME_CHARS: number = 160;
const MAX_ID_CHARS: number = 600;

interface CloudAccountIdentity {
  provider: string;
  accountId: string;
}

export default class CloudRoundContext {
  /*
   * The lines of the round's context about what the subject is linked to
   * in the account `cloudAccountId` names. No lines when it is linked to
   * nothing there, or the links cannot be read.
   */
  public static async describeLinkedCloudResources(data: {
    projectId: ObjectID;
    cloudAccountId: ObjectID;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
  }): Promise<Array<string>> {
    try {
      if (!data.incidentId && !data.alertId) {
        return [];
      }

      const account: CloudAccountIdentity | null =
        await CloudRoundContext.readAccount(data);

      if (!account) {
        return [];
      }

      const linked: Array<LinkedAffectedResource> = data.incidentId
        ? await LinkedAffectedResources.readForIncident({
            service: IncidentService,
            projectId: data.projectId,
            incidentId: data.incidentId,
          })
        : await LinkedAffectedResources.readForAlert({
            service: AlertService,
            projectId: data.projectId,
            alertId: data.alertId!,
          });

      const cloudIds: Array<string> = linked
        .filter((resource: LinkedAffectedResource): boolean => {
          return (
            resource.type === LinkedAffectedResourceType.CloudResource &&
            ObjectID.isValidUUID(resource.id)
          );
        })
        .map((resource: LinkedAffectedResource): string => {
          return resource.id;
        });

      if (cloudIds.length === 0) {
        return [];
      }

      const rows: Array<CloudResource> = await CloudResourceService.findBy({
        query: {
          projectId: data.projectId,
          _id: QueryHelper.any(
            cloudIds.map((id: string): ObjectID => {
              return new ObjectID(id);
            }),
          ),
        },
        select: {
          _id: true,
          name: true,
          cloudProvider: true,
          cloudAccountId: true,
          cloudResourceKind: true,
          cloudResourceType: true,
          cloudPlatform: true,
          cloudRegion: true,
          providerResourceId: true,
          cloudTags: true,
        },
        limit: cloudIds.length,
        skip: 0,
        props: { isRoot: true },
      });

      const inAccount: Array<CloudResource> = rows
        .filter((row: CloudResource): boolean => {
          return (
            (row.cloudProvider || "").trim() === account.provider &&
            (row.cloudAccountId || "").trim().toLowerCase() ===
              account.accountId.toLowerCase()
          );
        })
        .slice(0, MAX_LISTED);

      if (inAccount.length === 0) {
        return [];
      }

      return CloudRoundContext.describe(inAccount);
    } catch (error) {
      logger.error(
        `CloudRoundContext: could not read what the round is linked to: ${error}`,
      );
      return [];
    }
  }

  // The lines for rows already read (pure).
  public static describe(rows: Array<CloudResource>): Array<string> {
    const lines: Array<string> = [
      "",
      "# What this signal is linked to in this account",
      "Start from these: they are what the incident or alert is about. Change something else in the account only when the evidence points there, and say why.",
      '<untrusted_context source="linked_cloud_resources">',
    ];

    for (const row of rows) {
      lines.push(CloudRoundContext.describeRow(row));
    }

    lines.push("</untrusted_context>");

    return lines;
  }

  private static describeRow(row: CloudResource): string {
    const name: string = untrustedLine(row.name || "", MAX_NAME_CHARS);
    const region: string = untrustedLine(row.cloudRegion || "", 64);

    if (!isCloudResourceKindResource(row.cloudResourceKind)) {
      const platform: string =
        untrustedLine(getManagedCloudPlatformLabel(row.cloudPlatform), 64) ||
        "an app platform";

      return escapeUntrustedContext(
        `- Cloud environment ${JSON.stringify(name)} (App Platforms: ${platform}${
          region ? ` in ${region}` : ""
        }): where the signal's services run. It is not one resource, so a change never names it: find the service running there - its ECS service, Cloud Run service, Container App or App Service - with query_cloud_resource or query_telemetry_resources, and change that service by its id.`,
      );
    }

    const type: string = untrustedLine(
      getCloudResourceTypeLabel(row.cloudProvider, row.cloudResourceType),
      120,
    );
    const id: string = untrustedLine(
      row.providerResourceId || "",
      MAX_ID_CHARS,
    );
    const tags: Dictionary<string> =
      row.cloudTags && typeof row.cloudTags === "object" ? row.cloudTags : {};
    const managedAsCode: string | null = CloudAiTargets.getManagedAsCode(tags);

    return escapeUntrustedContext(
      `- Cloud resource ${JSON.stringify(name)} (${type || "resource"}${
        region ? `, ${region}` : ""
      })${id ? `: ${id}` : ""}${
        managedAsCode
          ? ` - declared as code by ${untrustedLine(managedAsCode, 200)}, so a change to it is only proposed, never made on its own, and the next apply may put it back`
          : ""
      }`,
    );
  }

  private static async readAccount(data: {
    projectId: ObjectID;
    cloudAccountId: ObjectID;
  }): Promise<CloudAccountIdentity | null> {
    const account: CloudAccount | null = await CloudAccountService.findOneBy({
      query: {
        _id: data.cloudAccountId.toString(),
        projectId: data.projectId,
      },
      select: { _id: true, provider: true, accountId: true },
      props: { isRoot: true },
    });

    if (!account || !account.provider || !account.accountId) {
      return null;
    }

    return {
      provider: account.provider.toString(),
      accountId: account.accountId.trim(),
    };
  }
}
