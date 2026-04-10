import { ExpressRequest } from "Common/Server/Utils/Express";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import KubernetesClusterService from "Common/Server/Services/KubernetesClusterService";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import DockerHostService from "Common/Server/Services/DockerHostService";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import logger from "Common/Server/Utils/Logger";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";

export default abstract class OtelIngestBaseService {
  private static readonly DOCKER_CONTAINER_NAME_CACHE_NAMESPACE: string =
    "docker-container-name";
  private static readonly DOCKER_CONTAINER_NAME_CACHE_EXPIRY_SECONDS: number =
    24 * 60 * 60; // 1 day

  @CaptureSpan()
  protected static async getServiceNameFromAttributes(
    req: ExpressRequest,
    attributes: JSONArray,
  ): Promise<string> {
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

    // Docker-aware fallback: when telemetry arrives from a OneUptime Docker
    // Agent (container.runtime == "docker"), there is no explicit
    // service.name. Synthesize a per-container service name so each
    // container shows up as its own service in the OneUptime UI instead of
    // every Docker log collapsing into "Unknown Service".
    if (this.isDockerRuntime(attributes)) {
      const dockerServiceName: string | null =
        await this.getDockerServiceName(req, attributes);
      if (dockerServiceName) {
        return dockerServiceName;
      }
    }

    return "Unknown Service";
  }

  @CaptureSpan()
  private static async getDockerServiceName(
    req: ExpressRequest,
    attributes: JSONArray,
  ): Promise<string | null> {
    const hostName: string | null = this.getHostNameFromAttributes(attributes);
    const containerName: string | null = this.getStringAttribute(
      attributes,
      "container.name",
    );
    const containerId: string | null = this.getStringAttribute(
      attributes,
      "container.id",
    );

    // docker_stats metric batches carry both container.id and
    // container.name as resource attributes, while filelog-originated log
    // batches only carry container.id (the filelog receiver has no way to
    // query the Docker API for names). Cache the id -> name mapping off
    // the metrics path so later log batches for the same container can
    // resolve to a proper service name.
    if (containerId && containerName) {
      try {
        const projectId: ObjectID | undefined = (
          req as ExpressRequest & { projectId?: ObjectID }
        ).projectId;
        if (projectId) {
          await GlobalCache.setString(
            this.DOCKER_CONTAINER_NAME_CACHE_NAMESPACE,
            `${projectId.toString()}:${containerId}`,
            containerName,
            {
              expiresInSeconds:
                this.DOCKER_CONTAINER_NAME_CACHE_EXPIRY_SECONDS,
            },
          );
        }
      } catch (err) {
        logger.error(
          "Error caching Docker container name: " + (err as Error).message,
        );
      }
    }

    if (containerName) {
      return containerName;
    }

    // Logs path: try the id -> name cache populated by the metrics path.
    if (containerId) {
      try {
        const projectId: ObjectID | undefined = (
          req as ExpressRequest & { projectId?: ObjectID }
        ).projectId;
        if (projectId) {
          const cached: string | null = await GlobalCache.getString(
            this.DOCKER_CONTAINER_NAME_CACHE_NAMESPACE,
            `${projectId.toString()}:${containerId}`,
          );
          if (cached) {
            return cached;
          }
        }
      } catch (err) {
        logger.error(
          "Error reading Docker container name cache: " +
            (err as Error).message,
        );
      }

      // No cache hit yet (metrics scrape every 30s so the first few log
      // batches for a newly-started container can race ahead of the cache
      // fill). Fall back to a stable synthetic name derived from the host
      // and the short container id so logs are still grouped per container.
      const shortId: string = containerId.substring(0, 12);
      if (hostName) {
        return `docker/${hostName}/${shortId}`;
      }
      return `docker/${shortId}`;
    }

    // No container identity at all — group by host so at least docker logs
    // from the same host stick together.
    if (hostName) {
      return `docker/${hostName}`;
    }

    return null;
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
  private static readonly CLUSTER_ID_CACHE_EXPIRY_SECONDS: number =
    24 * 60 * 60; // 1 day

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
  protected static getHostNameFromAttributes(
    attributes: JSONArray,
  ): string | null {
    return this.getStringAttribute(attributes, "host.name");
  }

  @CaptureSpan()
  protected static getStringAttribute(
    attributes: JSONArray,
    key: string,
  ): string | null {
    for (const attribute of attributes) {
      if (
        attribute["key"] === key &&
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

  @CaptureSpan()
  protected static isDockerRuntime(attributes: JSONArray): boolean {
    for (const attribute of attributes) {
      if (
        attribute["key"] === "container.runtime" &&
        attribute["value"] &&
        (attribute["value"] as JSONObject)["stringValue"] === "docker"
      ) {
        return true;
      }
    }
    return false;
  }

  private static readonly DOCKER_HOST_ID_CACHE_NAMESPACE: string =
    "docker-host-id";
  private static readonly DOCKER_HOST_ID_CACHE_EXPIRY_SECONDS: number =
    24 * 60 * 60; // 1 day

  @CaptureSpan()
  protected static async autoDiscoverDockerHost(data: {
    projectId: ObjectID;
    attributes: JSONArray;
  }): Promise<void> {
    try {
      if (!this.isDockerRuntime(data.attributes)) {
        return;
      }

      const hostName: string | null = this.getHostNameFromAttributes(
        data.attributes,
      );

      if (!hostName) {
        return;
      }

      const osType: string | null = this.getStringAttribute(
        data.attributes,
        "os.type",
      );
      const osVersion: string | null =
        this.getStringAttribute(data.attributes, "os.description") ||
        this.getStringAttribute(data.attributes, "os.version");

      const cacheKey: string = `${data.projectId.toString()}:${hostName}`;
      let hostIdStr: string | null = await GlobalCache.getString(
        this.DOCKER_HOST_ID_CACHE_NAMESPACE,
        cacheKey,
      );

      if (!hostIdStr) {
        const host: DockerHost =
          await DockerHostService.findOrCreateByHostIdentifier({
            projectId: data.projectId,
            hostIdentifier: hostName,
          });

        if (host._id) {
          hostIdStr = host._id.toString();
          await GlobalCache.setString(
            this.DOCKER_HOST_ID_CACHE_NAMESPACE,
            cacheKey,
            hostIdStr,
            { expiresInSeconds: this.DOCKER_HOST_ID_CACHE_EXPIRY_SECONDS },
          );
        }
      }

      if (hostIdStr) {
        await DockerHostService.updateLastSeen(new ObjectID(hostIdStr), {
          osType: osType || undefined,
          osVersion: osVersion || undefined,
        });
      }
    } catch (err) {
      logger.error(
        "Error auto-discovering Docker host: " + (err as Error).message,
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
