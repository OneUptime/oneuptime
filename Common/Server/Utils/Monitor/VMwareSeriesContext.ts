import VMwareSource from "../../../Models/DatabaseModels/VMwareSource";
import VMwareResource from "../../../Models/DatabaseModels/VMwareResource";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import URL from "../../../Types/API/URL";
import VMwareSourceService from "../../Services/VMwareSourceService";
import VMwareResourceService from "../../Services/VMwareResourceService";
import DatabaseConfig from "../../DatabaseConfig";
import logger from "../Logger";

export interface VMwareDisplayContext {
  displayLabels: JSONObject;
  linksMarkdown: string;
}

// Resolve human context only when a notification is being created. Display
// labels never replace stored grouping labels or participate in deduplication.
export default class VMwareSeriesContext {
  public static async resolve(input: {
    projectId: ObjectID;
    seriesLabels: JSONObject | undefined;
  }): Promise<VMwareDisplayContext | null> {
    const labels: JSONObject = input.seriesLabels || {};
    const sourceIdentifier: unknown =
      labels["resource.oneuptime.vmware.source.id"];
    if (typeof sourceIdentifier !== "string" || !sourceIdentifier) {
      return null;
    }
    try {
      const source: VMwareSource | null = await VMwareSourceService.findOneBy({
        query: { projectId: input.projectId, sourceIdentifier },
        select: { _id: true, name: true, sourceIdentifier: true },
        props: { isRoot: true },
      });
      if (!source?.id) {
        return null;
      }
      const dashboard: URL = await DatabaseConfig.getDashboardUrl();
      const sourceUrl: string = URL.fromString(dashboard.toString())
        .addRoute(
          `/${input.projectId.toString()}/vmware/${source.id.toString()}`,
        )
        .toString();
      const displayLabels: JSONObject = {
        "resource.oneuptime.vmware.source.name":
          source.name || sourceIdentifier,
      };
      let linksMarkdown: string = `[Open VMware source](${sourceUrl})`;
      const resourceIdentifier: unknown =
        labels["resource.oneuptime.vmware.resource.id"];
      const resourceType: unknown =
        labels["resource.oneuptime.vmware.resource.type"];
      if (
        typeof resourceIdentifier === "string" &&
        resourceIdentifier &&
        typeof resourceType === "string" &&
        resourceType
      ) {
        const resource: VMwareResource | null =
          await VMwareResourceService.findOneBy({
            query: {
              projectId: input.projectId,
              sourceId: source.id,
              resourceIdentifier,
              resourceType,
            },
            select: { _id: true, name: true },
            props: { isRoot: true },
          });
        if (resource?.id) {
          displayLabels["resource.oneuptime.vmware.resource.name"] =
            resource.name || resourceIdentifier;
          displayLabels["resource.oneuptime.vmware.resource.type"] =
            resourceType;
          linksMarkdown += ` · [Open VMware resource](${sourceUrl}/resources/${resource.id.toString()})`;
        } else {
          // Preserve the original resource identity when inventory is missing.
          Object.assign(displayLabels, labels);
        }
      }
      return { displayLabels, linksMarkdown };
    } catch (error) {
      // Enrichment failure must never prevent the actual alert from being sent.
      logger.warn(
        `VMware notification context could not be resolved: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
