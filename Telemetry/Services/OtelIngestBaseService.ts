import { ExpressRequest } from "Common/Server/Utils/Express";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import KubernetesClusterService from "Common/Server/Services/KubernetesClusterService";
import logger from "Common/Server/Utils/Logger";

export default abstract class OtelIngestBaseService {
  @CaptureSpan()
  protected static getServiceNameFromAttributes(
    req: ExpressRequest,
    attributes: JSONArray,
  ): string {
    for (const attribute of attributes) {
      if (
        attribute["key"] === "service.name" &&
        attribute["value"] &&
        (attribute["value"] as JSONObject)["stringValue"]
      ) {
        if (
          typeof (attribute["value"] as JSONObject)["stringValue"] === "string"
        ) {
          return (attribute["value"] as JSONObject)["stringValue"] as string;
        }
      }
    }

    const serviceName: string = req.headers[
      "x-oneuptime-service-name"
    ] as string;

    if (serviceName) {
      return serviceName;
    }

    return "Unknown Service";
  }

  @CaptureSpan()
  protected static getClusterNameFromAttributes(
    attributes: JSONArray,
  ): string | null {
    for (const attribute of attributes) {
      if (
        attribute["key"] === "k8s.cluster.name" &&
        attribute["value"] &&
        (attribute["value"] as JSONObject)["stringValue"]
      ) {
        const value = (attribute["value"] as JSONObject)["stringValue"];
        if (typeof value === "string" && value.trim()) {
          return value.trim();
        }
      }
    }
    return null;
  }

  @CaptureSpan()
  protected static async autoDiscoverKubernetesCluster(data: {
    projectId: ObjectID;
    attributes: JSONArray;
  }): Promise<void> {
    try {
      const clusterName: string | null = this.getClusterNameFromAttributes(
        data.attributes,
      );

      if (!clusterName) {
        return;
      }

      const cluster =
        await KubernetesClusterService.findOrCreateByClusterIdentifier({
          projectId: data.projectId,
          clusterIdentifier: clusterName,
        });

      if (cluster._id) {
        await KubernetesClusterService.updateLastSeen(
          new ObjectID(cluster._id.toString()),
        );
      }
    } catch (err) {
      logger.error(
        "Error auto-discovering Kubernetes cluster: " + (err as Error).message,
      );
    }
  }

  @CaptureSpan()
  protected static getServiceNameFromHeaders(
    req: ExpressRequest,
    defaultName: string = "Unknown Service",
  ): string {
    const headerValue: string | string[] | undefined =
      req.headers["x-oneuptime-service-name"];

    if (typeof headerValue === "string" && headerValue.trim()) {
      return headerValue.trim();
    }

    if (Array.isArray(headerValue) && headerValue.length > 0) {
      const value: string = headerValue.find((item: string) => {
        return item && item.trim();
      }) as string;

      if (value && value.trim()) {
        return value.trim();
      }
    }

    return defaultName;
  }
}
