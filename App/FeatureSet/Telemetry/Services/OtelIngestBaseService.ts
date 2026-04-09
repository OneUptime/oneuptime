import { ExpressRequest } from "Common/Server/Utils/Express";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import KubernetesClusterService from "Common/Server/Services/KubernetesClusterService";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import logger from "Common/Server/Utils/Logger";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";

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
        const value: JSONValue = (attribute["value"] as JSONObject)[
          "stringValue"
        ];
        if (typeof value === "string" && value.trim()) {
          return value.trim();
        }
      }
    }
    return null;
  }

  private static readonly CLUSTER_ID_CACHE_NAMESPACE: string = "k8s-cluster-id";
  private static readonly CLUSTER_ID_CACHE_EXPIRY_SECONDS: number = 24 * 60 * 60; // 1 day

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

      const cacheKey: string = `${data.projectId.toString()}:${clusterName}`;
      let clusterIdStr: string | null = await GlobalCache.getString(
        this.CLUSTER_ID_CACHE_NAMESPACE,
        cacheKey,
      );

      if (!clusterIdStr) {
        const cluster: KubernetesCluster =
          await KubernetesClusterService.findOrCreateByClusterIdentifier({
            projectId: data.projectId,
            clusterIdentifier: clusterName,
          });

        if (cluster._id) {
          clusterIdStr = cluster._id.toString();
          await GlobalCache.setString(
            this.CLUSTER_ID_CACHE_NAMESPACE,
            cacheKey,
            clusterIdStr,
            { expiresInSeconds: this.CLUSTER_ID_CACHE_EXPIRY_SECONDS },
          );
        }
      }

      if (clusterIdStr) {
        await KubernetesClusterService.updateLastSeen(
          new ObjectID(clusterIdStr),
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
