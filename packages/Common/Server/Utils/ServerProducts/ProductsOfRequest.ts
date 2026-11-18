import { ExpressRequest } from "../Express";
import ProductKey from "../../../Types/Product/ProductKey";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import { WorkspaceChannelRecordType } from "../../../Types/Workspace/WorkspaceChannelLink";

/*
 * THE PRODUCTS A REQUEST ACTS ON, READ FROM THE REQUEST ALONE (#9489).
 *
 * A route whose product depends on what it is asked about - investigating
 * an incident or an alert, a record's own chat channel, a resource's AI
 * agent - names its products with ServerProductRoutes.refuseWhileOffFor and
 * one of these. Each reads only the request (its body, its path): never a
 * record, so the answer is the same before anything is read, and a request
 * that names nothing this knows names no product - its handler says what is
 * wrong with it, as it always did.
 *
 * Pure.
 */

// What a request carries, of all an Express request has.
type RequestParts = Pick<ExpressRequest, "body" | "params">;

const readText: (value: unknown) => string = (value: unknown): string => {
  return typeof value === "string" ? value.trim() : "";
};

const readBody: (req: RequestParts) => Record<string, unknown> = (
  req: RequestParts,
): Record<string, unknown> => {
  const body: unknown = req.body;

  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
};

/*
 * The products of the record types a record's own chat channel is for
 * (WorkspaceChannelMembers): an incident's and its episode's, an alert's and
 * its episode's, a scheduled maintenance event's.
 */
export const PRODUCT_OF_WORKSPACE_CHANNEL_RECORD_TYPE: Readonly<
  Record<WorkspaceChannelRecordType, ProductKey>
> = {
  [WorkspaceChannelRecordType.Incident]: ProductKey.Incidents,
  [WorkspaceChannelRecordType.IncidentEpisode]: ProductKey.Incidents,
  [WorkspaceChannelRecordType.Alert]: ProductKey.Alerts,
  [WorkspaceChannelRecordType.AlertEpisode]: ProductKey.Alerts,
  [WorkspaceChannelRecordType.ScheduledMaintenance]:
    ProductKey.ScheduledMaintenance,
};

/*
 * The product of each kind of resource a resource AI agent serves
 * (ResourceAiAccess): the product its records are of.
 */
export const PRODUCT_OF_AI_RESOURCE_TYPE: Readonly<
  Record<AiResourceType, ProductKey>
> = {
  [AiResourceType.DockerHost]: ProductKey.Docker,
  [AiResourceType.PodmanHost]: ProductKey.Podman,
  [AiResourceType.DockerSwarmCluster]: ProductKey.DockerSwarm,
  [AiResourceType.ProxmoxCluster]: ProductKey.Proxmox,
  [AiResourceType.VMwareVCenter]: ProductKey.VMware,
  [AiResourceType.CephCluster]: ProductKey.Ceph,
  [AiResourceType.DatabaseServer]: ProductKey.Databases,
  [AiResourceType.Host]: ProductKey.Hosts,
  [AiResourceType.AwsAccount]: ProductKey.Cloud,
  [AiResourceType.AzureSubscription]: ProductKey.Cloud,
  [AiResourceType.GoogleCloudProject]: ProductKey.Cloud,
  [AiResourceType.OpenStackCloud]: ProductKey.OpenStack,
};

export default class ProductsOfRequest {
  /*
   * The incident or the alert a request is about: its body's subjectType
   * ("incident" or "alert"), or the id it names (incidentId, alertId) - an
   * investigation, its conversation, a fix's Try again, Page now.
   */
  public static incidentOrAlert(req: RequestParts): Array<ProductKey> {
    const body: Record<string, unknown> = readBody(req);
    const subjectType: string = readText(body["subjectType"]);

    if (subjectType === "incident") {
      return [ProductKey.Incidents];
    }

    if (subjectType === "alert") {
      return [ProductKey.Alerts];
    }

    const products: Array<ProductKey> = [];

    if (readText(body["incidentId"])) {
      products.push(ProductKey.Incidents);
    }

    if (readText(body["alertId"])) {
      products.push(ProductKey.Alerts);
    }

    return products;
  }

  // The product of the record type in the path (:recordType).
  public static workspaceChannelRecord(req: RequestParts): Array<ProductKey> {
    const recordType: string = readText(req.params?.["recordType"]);

    return Object.prototype.hasOwnProperty.call(
      PRODUCT_OF_WORKSPACE_CHANNEL_RECORD_TYPE,
      recordType,
    )
      ? [
          PRODUCT_OF_WORKSPACE_CHANNEL_RECORD_TYPE[
            recordType as WorkspaceChannelRecordType
          ],
        ]
      : [];
  }

  // The product of the resource type in the body (resourceType).
  public static aiResource(req: RequestParts): Array<ProductKey> {
    const resourceType: string = readText(readBody(req)["resourceType"]);

    return Object.prototype.hasOwnProperty.call(
      PRODUCT_OF_AI_RESOURCE_TYPE,
      resourceType,
    )
      ? [PRODUCT_OF_AI_RESOURCE_TYPE[resourceType as AiResourceType]]
      : [];
  }

  // The table in the path (:ruleType): a rule's, which is its product's.
  public static ruleTable(req: RequestParts): string | null {
    return readText(req.params?.["ruleType"]) || null;
  }
}
