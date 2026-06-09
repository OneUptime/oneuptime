import { ExpressRequest } from "Common/Server/Utils/Express";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import KubernetesClusterService from "Common/Server/Services/KubernetesClusterService";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import DockerHostService from "Common/Server/Services/DockerHostService";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import HostService from "Common/Server/Services/HostService";
import Host from "Common/Models/DatabaseModels/Host";
import ServerlessFunctionService from "Common/Server/Services/ServerlessFunctionService";
import ServerlessFunction from "Common/Models/DatabaseModels/ServerlessFunction";
import CloudResourceService from "Common/Server/Services/CloudResourceService";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import RumApplicationService from "Common/Server/Services/RumApplicationService";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import ServerlessFunctionInstanceService from "Common/Server/Services/ServerlessFunctionInstanceService";
import CloudResourceInstanceService from "Common/Server/Services/CloudResourceInstanceService";
import RumApplicationClientService from "Common/Server/Services/RumApplicationClientService";
import LabelService from "Common/Server/Services/LabelService";
import { extractOneuptimeLabelNames } from "Common/Server/Utils/Telemetry/OneuptimeLabel";
import logger from "Common/Server/Utils/Logger";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import ServiceType from "Common/Types/Telemetry/ServiceType";

export default abstract class OtelIngestBaseService {
  private static readonly DOCKER_CONTAINER_NAME_CACHE_NAMESPACE: string =
    "docker-container-name";
  private static readonly DOCKER_CONTAINER_NAME_CACHE_EXPIRY_SECONDS: number =
    24 * 60 * 60; // 1 day

  /*
   * Per-resource Postgres maintenance (updateLastSeen, label promotion)
   * runs on every ingest batch even when nothing has changed. With 100
   * concurrent telemetry workers and many resources per batch, those
   * UPDATEs dominate Postgres pool occupancy and starve dashboard auth
   * queries. Fence each (scope, id) pair behind a short Redis TTL so
   * we only re-run the maintenance work once per window. Race-safe is
   * not required — two workers re-running updateLastSeen at the same
   * instant is harmless; we just want to drop the steady-state cost.
   */
  private static readonly MAINTENANCE_FENCE_NAMESPACE: string =
    "otel-maintenance-fence";
  private static readonly MAINTENANCE_FENCE_TTL_SECONDS: number = 5 * 60; // 5 minutes

  protected static async shouldRunMaintenance(
    scope: string,
    id: string,
  ): Promise<boolean> {
    try {
      const key: string = `${scope}:${id}`;
      const seen: string | null = await GlobalCache.getString(
        this.MAINTENANCE_FENCE_NAMESPACE,
        key,
      );
      if (seen) {
        return false;
      }
      await GlobalCache.setString(this.MAINTENANCE_FENCE_NAMESPACE, key, "1", {
        expiresInSeconds: this.MAINTENANCE_FENCE_TTL_SECONDS,
      });
      return true;
    } catch {
      // If the cache is down, default to running the maintenance.
      return true;
    }
  }

  /*
   * Resolves a real (user-facing) service name from OTel resource
   * attributes. Returns null when the batch is host- / docker-host-
   * level telemetry that should be routed to the matching Host or
   * DockerHost record via `serviceId` instead of synthesising a
   * phantom Service row. The caller (OTelIngestService.resolveTelemetryResource)
   * is responsible for that routing decision and picks the right
   * `ServiceType` discriminator for the analytics row.
   *
   * Returns null for batches with no signal at all (no service.name,
   * no docker container, no host / k8s / docker resource signal) too —
   * the caller tags those with the projectId under ServiceType.Unknown
   * rather than synthesising a shared "Unknown Service" Service row.
   */
  @CaptureSpan()
  protected static async getServiceNameFromAttributes(
    req: ExpressRequest,
    attributes: JSONArray,
  ): Promise<string | null> {
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

    /*
     * Docker-aware fallback: when telemetry arrives from a OneUptime Docker
     * Agent (container.runtime == "docker"), there is no explicit
     * service.name. Synthesize a per-container service name so each
     * container shows up as its own service in the OneUptime UI instead of
     * every Docker log collapsing into "Unknown Service". A container
     * name is a meaningful logical service (e.g. "oneuptime-postgres")
     * and is intentionally still backed by a Service row. Batches that
     * only carry container.id with no resolvable name fall through to
     * null and get routed to the DockerHost record instead.
     */
    if (this.isDockerRuntime(attributes)) {
      const dockerServiceName: string | null = await this.getDockerServiceName(
        req,
        attributes,
      );
      if (dockerServiceName) {
        return dockerServiceName;
      }
    }

    /*
     * Host-level telemetry (OTel hostmetrics receiver, infrastructure
     * agent over OTLP, eBPF profiler) without an explicit service.name
     * used to be folded into a synthetic `host/<name>` Service row,
     * which duplicated the Host record we already create via
     * `autoDiscoverHost`. Return null here so the caller routes the
     * batch through the resource's own id in `resolveTelemetryResource`
     * — Host id when `autoDiscoverHost` accepted the batch, otherwise
     * DockerHost / KubernetesCluster id.
     *
     * Phantom-host gating still lives in `autoDiscoverHost` — if the
     * batch only carries application-SDK-detected host.name (no
     * os.type / container.runtime), no Host row is created. K8s
     * batches (k8s.pod.name / k8s.node.name / k8s.cluster.name) are
     * also rejected by `autoDiscoverHost` so they route via the
     * KubernetesCluster id instead.
     */
    const hostName: string | null = this.getHostNameFromAttributes(attributes);
    if (hostName && this.hasHostResourceSignal(attributes)) {
      return null;
    }

    /*
     * No service.name, no header, no docker container name, no host
     * resource signal. Return null so the caller routes this batch to
     * the projectId-backed ServiceType.Unknown bucket instead of a
     * synthesised "Unknown Service" Service row.
     */
    return null;
  }

  /*
   * One-stop resolver used by every OTel / syslog / fluent ingest
   * path. Takes the already-discovered Host / DockerHost /
   * KubernetesCluster ids for this batch and dispatches:
   *
   *   1. Explicit service.name / x-oneuptime-service-name header
   *      / docker container name  →  ServiceType.OpenTelemetry,
   *      serviceId = Service._id (created on first contact via
   *      `telemetryServiceFromName`).
   *   2. Else if a Host was auto-discovered for this batch →
   *      ServiceType.Host, serviceId = Host._id. Avoids the old
   *      `host/<name>` phantom-Service duplication.
   *   3. Else if a DockerHost was discovered →
   *      ServiceType.DockerHost, serviceId = DockerHost._id.
   *      Catches docker batches that carry only container.id but
   *      no resolvable container name.
   *   4. Else if a KubernetesCluster was discovered →
   *      ServiceType.KubernetesCluster, serviceId = Cluster._id.
   *      Rare in practice — most k8s batches also carry host.name
   *      and route via #2.
   *   5. Fallback: no Service row at all. serviceId = projectId,
   *      ServiceType.Unknown. The read side groups these under a
   *      synthetic "Unknown Service" bucket. No oneuptime.label.*
   *      promotion happens here — there is no owning resource, which
   *      is what stops label-less telemetry from collapsing into one
   *      row that accumulates every label.
   */
  @CaptureSpan()
  protected static async resolveTelemetryResource(data: {
    req: ExpressRequest;
    attributes: JSONArray;
    projectId: ObjectID;
    hostId?: ObjectID | null;
    dockerHostId?: ObjectID | null;
    kubernetesClusterId?: ObjectID | null;
    serverlessFunctionId?: ObjectID | null;
    cloudResourceId?: ObjectID | null;
    rumApplicationId?: ObjectID | null;
  }): Promise<TelemetryServiceMetadata> {
    const serviceName: string | null = await this.getServiceNameFromAttributes(
      data.req,
      data.attributes,
    );

    if (serviceName !== null) {
      return await OTelIngestService.telemetryServiceFromName({
        serviceName,
        projectId: data.projectId,
        resourceAttributes: data.attributes,
      });
    }

    const hostName: string | null = this.getHostNameFromAttributes(
      data.attributes,
    );

    if (data.hostId) {
      return await OTelIngestService.buildResourceMetadataForNonService({
        serviceName: hostName ? `host/${hostName}` : "Host",
        resourceId: data.hostId,
        serviceType: ServiceType.Host,
        projectId: data.projectId,
      });
    }

    if (data.dockerHostId) {
      return await OTelIngestService.buildResourceMetadataForNonService({
        serviceName: hostName ? `docker-host/${hostName}` : "Docker Host",
        resourceId: data.dockerHostId,
        serviceType: ServiceType.DockerHost,
        projectId: data.projectId,
      });
    }

    if (data.kubernetesClusterId) {
      const clusterName: string | null = this.getClusterNameFromAttributes(
        data.attributes,
      );
      return await OTelIngestService.buildResourceMetadataForNonService({
        serviceName: clusterName ? `k8s/${clusterName}` : "Kubernetes Cluster",
        resourceId: data.kubernetesClusterId,
        serviceType: ServiceType.KubernetesCluster,
        projectId: data.projectId,
      });
    }

    if (data.serverlessFunctionId) {
      const faasName: string | null =
        this.getStringAttribute(data.attributes, "faas.name") ||
        this.getStringAttribute(data.attributes, "service.name");
      return await OTelIngestService.buildResourceMetadataForNonService({
        serviceName: faasName
          ? `serverless/${faasName}`
          : "Serverless Function",
        resourceId: data.serverlessFunctionId,
        serviceType: ServiceType.ServerlessFunction,
        projectId: data.projectId,
      });
    }

    if (data.cloudResourceId) {
      const resourceName: string | null =
        this.getStringAttribute(data.attributes, "service.name") ||
        this.getStringAttribute(data.attributes, "host.name");
      return await OTelIngestService.buildResourceMetadataForNonService({
        serviceName: resourceName
          ? `cloud/${resourceName}`
          : "Cloud Resource",
        resourceId: data.cloudResourceId,
        serviceType: ServiceType.CloudResource,
        projectId: data.projectId,
      });
    }

    if (data.rumApplicationId) {
      const appName: string | null = this.getStringAttribute(
        data.attributes,
        "service.name",
      );
      return await OTelIngestService.buildResourceMetadataForNonService({
        serviceName: appName ? `rum/${appName}` : "RUM Application",
        resourceId: data.rumApplicationId,
        serviceType: ServiceType.RealUserMonitor,
        projectId: data.projectId,
      });
    }

    /*
     * Truly nameless telemetry: no service.name, no docker container,
     * and no host / docker / k8s resource was discovered for this
     * batch. Tag it with the projectId in the serviceId slot under
     * ServiceType.Unknown and create no Service row. Crucially we go
     * through buildResourceMetadataForNonService (not
     * telemetryServiceFromName), so no oneuptime.label.* attributes are
     * promoted — that is what prevents every label-less source from
     * collapsing into a single "Unknown Service" row that accumulates
     * all labels. Retention falls back to the project default.
     */
    return await OTelIngestService.buildResourceMetadataForNonService({
      serviceName: "Unknown Service",
      resourceId: data.projectId,
      serviceType: ServiceType.Unknown,
      projectId: data.projectId,
    });
  }

  @CaptureSpan()
  private static async getDockerServiceName(
    req: ExpressRequest,
    attributes: JSONArray,
  ): Promise<string | null> {
    const containerName: string | null = this.getStringAttribute(
      attributes,
      "container.name",
    );
    const containerId: string | null = this.getStringAttribute(
      attributes,
      "container.id",
    );

    /*
     * docker_stats metric batches carry both container.id and
     * container.name as resource attributes, while filelog-originated log
     * batches only carry container.id (the filelog receiver has no way to
     * query the Docker API for names). Cache the id -> name mapping off
     * the metrics path so later log batches for the same container can
     * resolve to a proper service name.
     */
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
              expiresInSeconds: this.DOCKER_CONTAINER_NAME_CACHE_EXPIRY_SECONDS,
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
      return this.normalizeDockerContainerName(containerName);
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
            return this.normalizeDockerContainerName(cached);
          }
        }
      } catch (err) {
        logger.error(
          "Error reading Docker container name cache: " +
            (err as Error).message,
        );
      }
    }

    /*
     * No resolvable container identity. Used to synthesise
     * `docker/<hostName>/<shortId>` / `docker/<hostName>` / `docker/<shortId>`
     * service rows, which created a duplicate alongside the DockerHost
     * record `autoDiscoverDockerHost` had just upserted from the same
     * batch. The caller now routes the batch through the DockerHost id
     * with ServiceType.DockerHost.
     */
    return null;
  }

  /**
   * Strip Docker Compose's replica index suffix (e.g. "-1", "-2") from a
   * container name so that multiple replicas of the same service — and the
   * same service running on different hosts — roll up into a single
   * OneUptime telemetry service.
   *
   * Docker Compose names containers as "{project}-{service}-{index}" (or
   * "{project}_{service}_{index}" with the legacy separator), so the
   * trailing "-N" or "_N" is always the replica index. We only strip it
   * when the prefix still looks like a valid service identifier, to avoid
   * mangling container names that legitimately end in a digit.
   *
   * Examples:
   *   oneuptime-postgres-1   -> oneuptime-postgres
   *   oneuptime-probe-1-2    -> oneuptime-probe-1   (only the last "-2")
   *   my-app_3               -> my-app
   *   redis                  -> redis               (unchanged)
   */
  private static normalizeDockerContainerName(name: string): string {
    const trimmed: string = name.trim();
    if (!trimmed) {
      return trimmed;
    }

    /*
     * Docker Compose's "/" prefix on the raw inspect output (e.g. "/oneuptime-app-1")
     * is already stripped by the docker_stats receiver, but handle it defensively.
     */
    const withoutSlash: string = trimmed.startsWith("/")
      ? trimmed.substring(1)
      : trimmed;

    const match: RegExpMatchArray | null =
      withoutSlash.match(/^(.+)[-_](\d+)$/);

    if (!match || !match[1]) {
      return withoutSlash;
    }

    return match[1];
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
  }): Promise<ObjectID | null> {
    try {
      const clusterName: string | null = this.getClusterNameFromAttributes(
        data.attributes,
      );

      if (!clusterName) {
        return null;
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
        const clusterId: ObjectID = new ObjectID(clusterIdStr);
        /*
         * Skip the per-batch UPDATE + label upsert when we've already
         * run it for this cluster in the current fence window. With
         * 100 telemetry workers each touching the same handful of
         * clusters, this is the single biggest Postgres write hot
         * spot on the ingest path; the staleness on `lastSeenAt` is
         * bounded by the TTL.
         */
        if (await this.shouldRunMaintenance("k8s-cluster", clusterIdStr)) {
          const agentVersion: string | null = this.getStringAttribute(
            data.attributes,
            "oneuptime.agent.version",
          );
          await KubernetesClusterService.updateLastSeen(clusterId, {
            agentVersion: agentVersion || undefined,
          });
          await this.promoteOneuptimeLabelsToCluster({
            projectId: data.projectId,
            kubernetesClusterId: clusterId,
            attributes: data.attributes,
          });
        }
        return clusterId;
      }

      return null;
    } catch (err) {
      logger.error(
        "Error auto-discovering Kubernetes cluster: " + (err as Error).message,
      );
      return null;
    }
  }

  /*
   * Promote `oneuptime.label.<dim>=<val>` resource attributes into
   * project labels and attach them to the discovered Kubernetes
   * cluster. Mirrors the host/service label promotion. Throttled
   * per-cluster inside `attachLabels` so steady-state ingest with
   * unchanged labels costs one in-memory cache lookup.
   */
  @CaptureSpan()
  protected static async promoteOneuptimeLabelsToCluster(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    attributes: JSONArray;
  }): Promise<void> {
    try {
      const labelNames: Array<string> = extractOneuptimeLabelNames(
        data.attributes,
      );
      if (labelNames.length === 0) {
        return;
      }
      const labelIds: Array<ObjectID> =
        await LabelService.findOrCreateLabelsByNames({
          projectId: data.projectId,
          labelNames,
        });
      if (labelIds.length === 0) {
        return;
      }
      await KubernetesClusterService.attachLabels({
        kubernetesClusterId: data.kubernetesClusterId,
        labelIds,
      });
    } catch (err) {
      logger.warn(
        `Kubernetes cluster label promotion failed for ${data.kubernetesClusterId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private static readonly SERVERLESS_FUNCTION_ID_CACHE_NAMESPACE: string =
    "serverless-function-id";
  private static readonly SERVERLESS_FUNCTION_ID_CACHE_EXPIRY_SECONDS: number =
    24 * 60 * 60; // 1 day

  /*
   * cloud.platform values that denote a Function-as-a-Service runtime.
   * An explicit faas.name, or a cloud.platform in this set, routes the
   * batch to a ServerlessFunction resource.
   */
  private static readonly SERVERLESS_CLOUD_PLATFORMS: ReadonlySet<string> =
    new Set([
      "aws_lambda",
      "gcp_cloud_functions",
      "azure_functions",
      "tencent_cloud_scf",
      "alibaba_cloud_fc",
    ]);

  /*
   * Auto-discover a Serverless / FaaS function from OTel resource
   * attributes. Gated on an explicit faas.name, or a cloud.platform in the
   * FaaS set (falling back to service.name as the function identity). Runs
   * on every ingest path so the function's telemetry tabs (which filter by
   * resource.faas.name) work even when service.name is also set — the
   * discriminator choice happens in resolveTelemetryResource.
   */
  @CaptureSpan()
  protected static async autoDiscoverServerless(data: {
    projectId: ObjectID;
    attributes: JSONArray;
  }): Promise<ObjectID | null> {
    try {
      const faasName: string | null = this.getStringAttribute(
        data.attributes,
        "faas.name",
      );
      const cloudPlatform: string | null = this.getStringAttribute(
        data.attributes,
        "cloud.platform",
      );
      const isFaasPlatform: boolean = cloudPlatform
        ? this.SERVERLESS_CLOUD_PLATFORMS.has(cloudPlatform)
        : false;

      // Identity: prefer faas.name; on a FaaS platform fall back to service.name.
      let functionIdentifier: string | null = faasName;
      if (!functionIdentifier && isFaasPlatform) {
        functionIdentifier = this.getStringAttribute(
          data.attributes,
          "service.name",
        );
      }

      // Gate: need a function identity AND a FaaS signal (faas.name or platform).
      if (!functionIdentifier || (!faasName && !isFaasPlatform)) {
        return null;
      }

      const cacheKey: string = `${data.projectId.toString()}:${functionIdentifier}`;
      let functionIdStr: string | null = await GlobalCache.getString(
        this.SERVERLESS_FUNCTION_ID_CACHE_NAMESPACE,
        cacheKey,
      );

      if (!functionIdStr) {
        const serverlessFunction: ServerlessFunction =
          await ServerlessFunctionService.findOrCreateByFunctionIdentifier({
            projectId: data.projectId,
            functionIdentifier,
          });

        if (serverlessFunction._id) {
          functionIdStr = serverlessFunction._id.toString();
          await GlobalCache.setString(
            this.SERVERLESS_FUNCTION_ID_CACHE_NAMESPACE,
            cacheKey,
            functionIdStr,
            {
              expiresInSeconds:
                this.SERVERLESS_FUNCTION_ID_CACHE_EXPIRY_SECONDS,
            },
          );
        }
      }

      if (functionIdStr) {
        const functionId: ObjectID = new ObjectID(functionIdStr);
        if (
          await this.shouldRunMaintenance("serverless-function", functionIdStr)
        ) {
          const agentVersion: string | null = this.getStringAttribute(
            data.attributes,
            "oneuptime.agent.version",
          );
          await ServerlessFunctionService.updateLastSeen(functionId, {
            agentVersion: agentVersion || undefined,
            cloudPlatform: cloudPlatform || undefined,
            cloudProvider:
              this.getStringAttribute(data.attributes, "cloud.provider") ||
              undefined,
            cloudRegion:
              this.getStringAttribute(data.attributes, "cloud.region") ||
              undefined,
            cloudAccountId:
              this.getStringAttribute(data.attributes, "cloud.account.id") ||
              undefined,
            functionVersion:
              this.getStringAttribute(data.attributes, "faas.version") ||
              undefined,
            runtimeName:
              this.getStringAttribute(
                data.attributes,
                "process.runtime.name",
              ) || undefined,
            runtimeVersion:
              this.getStringAttribute(
                data.attributes,
                "process.runtime.version",
              ) || undefined,
          });
          await this.promoteOneuptimeLabelsToServerlessFunction({
            projectId: data.projectId,
            serverlessFunctionId: functionId,
            attributes: data.attributes,
          });
        }

        // Live inventory: record this function instance (faas.instance).
        const faasInstance: string | null = this.getStringAttribute(
          data.attributes,
          "faas.instance",
        );
        if (
          faasInstance &&
          (await this.shouldRunMaintenance(
            "serverless-fn-instance",
            `${functionIdStr}:${faasInstance}`,
          ))
        ) {
          await ServerlessFunctionInstanceService.recordInstance({
            projectId: data.projectId,
            serverlessFunctionId: functionId,
            instanceName: faasInstance,
          });
        }
        return functionId;
      }

      return null;
    } catch (err) {
      logger.error(
        "Error auto-discovering Serverless function: " + (err as Error).message,
      );
      return null;
    }
  }

  @CaptureSpan()
  protected static async promoteOneuptimeLabelsToServerlessFunction(data: {
    projectId: ObjectID;
    serverlessFunctionId: ObjectID;
    attributes: JSONArray;
  }): Promise<void> {
    try {
      const labelNames: Array<string> = extractOneuptimeLabelNames(
        data.attributes,
      );
      if (labelNames.length === 0) {
        return;
      }
      const labelIds: Array<ObjectID> =
        await LabelService.findOrCreateLabelsByNames({
          projectId: data.projectId,
          labelNames,
        });
      if (labelIds.length === 0) {
        return;
      }
      await ServerlessFunctionService.attachLabels({
        serverlessFunctionId: data.serverlessFunctionId,
        labelIds,
      });
    } catch (err) {
      logger.warn(
        `Serverless function label promotion failed for ${data.serverlessFunctionId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private static readonly CLOUD_RESOURCE_ID_CACHE_NAMESPACE: string =
    "cloud-resource-id";
  private static readonly CLOUD_RESOURCE_ID_CACHE_EXPIRY_SECONDS: number =
    24 * 60 * 60; // 1 day

  /*
   * cloud.platform values that denote managed compute (containers / PaaS that
   * are neither plain Docker, Kubernetes, a raw VM, nor FaaS). Raw VM
   * platforms (aws_ec2, gcp_compute_engine, azure_vm) are intentionally
   * excluded so they remain Hosts; k8s platforms route via k8s.* attributes.
   */
  private static readonly CLOUD_COMPUTE_PLATFORMS: ReadonlySet<string> =
    new Set([
      "aws_ecs",
      "aws_elastic_beanstalk",
      "aws_app_runner",
      "gcp_cloud_run",
      "gcp_app_engine",
      "azure_container_apps",
      "azure_container_instances",
      "azure_app_service",
    ]);

  /*
   * Auto-discover a managed cloud-compute resource from OTel resource
   * attributes. Gated on cloud.platform being in the managed-compute set;
   * identity is service.name (falling back to host.name). Runs on every
   * ingest path so the resource's telemetry tabs work even when service.name
   * is also set — the discriminator choice happens in resolveTelemetryResource.
   */
  @CaptureSpan()
  protected static async autoDiscoverCloudResource(data: {
    projectId: ObjectID;
    attributes: JSONArray;
  }): Promise<ObjectID | null> {
    try {
      const cloudPlatform: string | null = this.getStringAttribute(
        data.attributes,
        "cloud.platform",
      );
      if (!cloudPlatform || !this.CLOUD_COMPUTE_PLATFORMS.has(cloudPlatform)) {
        return null;
      }

      const resourceIdentifier: string | null =
        this.getStringAttribute(data.attributes, "service.name") ||
        this.getStringAttribute(data.attributes, "host.name");

      if (!resourceIdentifier) {
        return null;
      }

      const cacheKey: string = `${data.projectId.toString()}:${resourceIdentifier}`;
      let resourceIdStr: string | null = await GlobalCache.getString(
        this.CLOUD_RESOURCE_ID_CACHE_NAMESPACE,
        cacheKey,
      );

      if (!resourceIdStr) {
        const cloudResource: CloudResource =
          await CloudResourceService.findOrCreateByResourceIdentifier({
            projectId: data.projectId,
            resourceIdentifier,
          });
        if (cloudResource._id) {
          resourceIdStr = cloudResource._id.toString();
          await GlobalCache.setString(
            this.CLOUD_RESOURCE_ID_CACHE_NAMESPACE,
            cacheKey,
            resourceIdStr,
            { expiresInSeconds: this.CLOUD_RESOURCE_ID_CACHE_EXPIRY_SECONDS },
          );
        }
      }

      if (resourceIdStr) {
        const cloudResourceId: ObjectID = new ObjectID(resourceIdStr);
        if (await this.shouldRunMaintenance("cloud-resource", resourceIdStr)) {
          const agentVersion: string | null = this.getStringAttribute(
            data.attributes,
            "oneuptime.agent.version",
          );
          await CloudResourceService.updateLastSeen(cloudResourceId, {
            agentVersion: agentVersion || undefined,
            cloudPlatform: cloudPlatform || undefined,
            cloudProvider:
              this.getStringAttribute(data.attributes, "cloud.provider") ||
              undefined,
            cloudRegion:
              this.getStringAttribute(data.attributes, "cloud.region") ||
              undefined,
            cloudAccountId:
              this.getStringAttribute(data.attributes, "cloud.account.id") ||
              undefined,
            runtimeName:
              this.getStringAttribute(
                data.attributes,
                "process.runtime.name",
              ) || undefined,
            runtimeVersion:
              this.getStringAttribute(
                data.attributes,
                "process.runtime.version",
              ) || undefined,
          });
          await this.promoteOneuptimeLabelsToCloudResource({
            projectId: data.projectId,
            cloudResourceId,
            attributes: data.attributes,
          });
        }

        // Live inventory: record this instance / task (service.instance.id).
        const instanceName: string | null = this.getStringAttribute(
          data.attributes,
          "service.instance.id",
        );
        if (
          instanceName &&
          (await this.shouldRunMaintenance(
            "cloud-resource-instance",
            `${resourceIdStr}:${instanceName}`,
          ))
        ) {
          await CloudResourceInstanceService.recordInstance({
            projectId: data.projectId,
            cloudResourceId,
            instanceName,
          });
        }
        return cloudResourceId;
      }

      return null;
    } catch (err) {
      logger.error(
        "Error auto-discovering Cloud resource: " + (err as Error).message,
      );
      return null;
    }
  }

  @CaptureSpan()
  protected static async promoteOneuptimeLabelsToCloudResource(data: {
    projectId: ObjectID;
    cloudResourceId: ObjectID;
    attributes: JSONArray;
  }): Promise<void> {
    try {
      const labelNames: Array<string> = extractOneuptimeLabelNames(
        data.attributes,
      );
      if (labelNames.length === 0) {
        return;
      }
      const labelIds: Array<ObjectID> =
        await LabelService.findOrCreateLabelsByNames({
          projectId: data.projectId,
          labelNames,
        });
      if (labelIds.length === 0) {
        return;
      }
      await CloudResourceService.attachLabels({
        cloudResourceId: data.cloudResourceId,
        labelIds,
      });
    } catch (err) {
      logger.warn(
        `Cloud resource label promotion failed for ${data.cloudResourceId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private static readonly RUM_APPLICATION_ID_CACHE_NAMESPACE: string =
    "rum-application-id";
  private static readonly RUM_APPLICATION_ID_CACHE_EXPIRY_SECONDS: number =
    24 * 60 * 60; // 1 day

  /*
   * Classify a batch as browser- or mobile-RUM from its resource
   * attributes, or null when it's not client-side telemetry. Backend
   * services never set browser.* / device.*, so this is a clean signal.
   */
  protected static getRumClientType(attributes: JSONArray): string | null {
    const hasBrowser: boolean = Boolean(
      this.getStringAttribute(attributes, "browser.platform") ||
        this.getStringAttribute(attributes, "browser.language") ||
        this.getStringArrayAttribute(attributes, "browser.brands").length > 0,
    );
    if (hasBrowser) {
      return "browser";
    }
    const hasDevice: boolean = Boolean(
      this.getStringAttribute(attributes, "device.id") ||
        this.getStringAttribute(attributes, "device.model.identifier") ||
        this.getStringAttribute(attributes, "device.manufacturer"),
    );
    if (hasDevice) {
      return "mobile";
    }
    return null;
  }

  /*
   * Auto-discover a Browser / Mobile RUM application from OTel resource
   * attributes. Gated on a browser.* / device.* client signal; identity is
   * the application (service.name), NEVER the per-end-user device. Runs on
   * every ingest path so the app's telemetry tabs work even when service.name
   * is also a backend service — the discriminator choice happens in
   * resolveTelemetryResource.
   */
  @CaptureSpan()
  protected static async autoDiscoverRum(data: {
    projectId: ObjectID;
    attributes: JSONArray;
  }): Promise<ObjectID | null> {
    try {
      const clientType: string | null = this.getRumClientType(data.attributes);
      if (!clientType) {
        return null;
      }

      const appIdentifier: string | null = this.getStringAttribute(
        data.attributes,
        "service.name",
      );
      if (!appIdentifier) {
        return null;
      }

      const cacheKey: string = `${data.projectId.toString()}:${appIdentifier}`;
      let appIdStr: string | null = await GlobalCache.getString(
        this.RUM_APPLICATION_ID_CACHE_NAMESPACE,
        cacheKey,
      );

      if (!appIdStr) {
        const rumApplication: RumApplication =
          await RumApplicationService.findOrCreateByAppIdentifier({
            projectId: data.projectId,
            appIdentifier,
          });
        if (rumApplication._id) {
          appIdStr = rumApplication._id.toString();
          await GlobalCache.setString(
            this.RUM_APPLICATION_ID_CACHE_NAMESPACE,
            cacheKey,
            appIdStr,
            { expiresInSeconds: this.RUM_APPLICATION_ID_CACHE_EXPIRY_SECONDS },
          );
        }
      }

      if (appIdStr) {
        const rumApplicationId: ObjectID = new ObjectID(appIdStr);
        if (await this.shouldRunMaintenance("rum-application", appIdStr)) {
          const agentVersion: string | null =
            this.getStringAttribute(data.attributes, "telemetry.sdk.version") ||
            this.getStringAttribute(data.attributes, "oneuptime.agent.version");
          await RumApplicationService.updateLastSeen(rumApplicationId, {
            agentVersion: agentVersion || undefined,
            clientType: clientType || undefined,
          });
          await this.promoteOneuptimeLabelsToRumApplication({
            projectId: data.projectId,
            rumApplicationId,
            attributes: data.attributes,
          });
        }

        // Live inventory: record this client platform (coarse, not per-device).
        const clientName: string | null =
          this.getStringAttribute(data.attributes, "browser.platform") ||
          this.getStringAttribute(data.attributes, "device.model.identifier");
        if (
          clientName &&
          (await this.shouldRunMaintenance(
            "rum-client",
            `${appIdStr}:${clientName}`,
          ))
        ) {
          await RumApplicationClientService.recordClient({
            projectId: data.projectId,
            rumApplicationId,
            clientName,
            clientType: clientType || undefined,
          });
        }
        return rumApplicationId;
      }

      return null;
    } catch (err) {
      logger.error(
        "Error auto-discovering RUM application: " + (err as Error).message,
      );
      return null;
    }
  }

  @CaptureSpan()
  protected static async promoteOneuptimeLabelsToRumApplication(data: {
    projectId: ObjectID;
    rumApplicationId: ObjectID;
    attributes: JSONArray;
  }): Promise<void> {
    try {
      const labelNames: Array<string> = extractOneuptimeLabelNames(
        data.attributes,
      );
      if (labelNames.length === 0) {
        return;
      }
      const labelIds: Array<ObjectID> =
        await LabelService.findOrCreateLabelsByNames({
          projectId: data.projectId,
          labelNames,
        });
      if (labelIds.length === 0) {
        return;
      }
      await RumApplicationService.attachLabels({
        rumApplicationId: data.rumApplicationId,
        labelIds,
      });
    } catch (err) {
      logger.warn(
        `RUM application label promotion failed for ${data.rumApplicationId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  @CaptureSpan()
  protected static getHostNameFromAttributes(
    attributes: JSONArray,
  ): string | null {
    /*
     * Fall back to k8s.node.name when host.name is absent. The OTel
     * eBPF profiler (and any DaemonSet-style collector relying on the
     * k8sattributes processor for resource detection) labels its
     * resource with k8s.node.name instead of host.name, which left
     * every profile from a k8s node collapsing into "Unknown Service"
     * because the host-name service-name fallback in
     * getServiceNameFromAttributes missed entirely. A k8s node IS a
     * host, so reusing the same synthesised "host/{name}" identity
     * keeps profiles, metrics, logs and traces from the same node
     * grouped together.
     */
    return (
      this.getStringAttribute(attributes, "host.name") ||
      this.getStringAttribute(attributes, "k8s.node.name")
    );
  }

  /**
   * Canonical form of the OTel `host.name` resource attribute when it is
   * used as host identity: trimmed + lower-cased.
   *
   * host.name casing is not stable across batches. Windows in particular
   * surfaces the computer name upper-cased (COMPUTERNAME-style, e.g.
   * PRIMARY01) from some resource detectors and lower-cased from others,
   * so the same physical host arrives as both `PRIMARY01` and `primary01`.
   * This mirrors QueryHelper.findWithSameText — the comparison the Host
   * unique guard already uses — so identity stays consistent end to end.
   */
  public static canonicalizeHostName(hostName: string): string {
    return hostName.trim().toLowerCase();
  }

  /**
   * Canonicalize the `host.name` resource attribute, in place, across a
   * batch of OTel resource envelopes (resourceMetrics / resourceLogs /
   * resourceSpans — each element carries `resource.attributes`).
   *
   * Run once at the top of each pillar's ingest so that BOTH the host
   * identity we resolve (HostService.findOrCreateByHostIdentifier) AND the
   * `resource.host.name` attribute we persist on every analytics row use
   * the same casing. That keeps the host-detail pages' query
   * (`resource.host.name = host.hostIdentifier`) matching via ClickHouse's
   * fast case-sensitive Map subscript rather than forcing a slower
   * case-insensitive scan (see the StatementGenerator map-filter notes).
   */
  public static normalizeHostNameAttributesInPlace(
    resourceEnvelopes: JSONArray,
  ): void {
    if (!resourceEnvelopes || !Array.isArray(resourceEnvelopes)) {
      return;
    }

    for (const envelope of resourceEnvelopes) {
      const attributes: JSONArray | undefined = (
        (envelope as JSONObject)?.["resource"] as JSONObject | undefined
      )?.["attributes"] as JSONArray | undefined;

      if (!attributes || !Array.isArray(attributes)) {
        continue;
      }

      for (const attribute of attributes) {
        const attr: JSONObject = attribute as JSONObject;
        if (attr["key"] !== "host.name" || !attr["value"]) {
          continue;
        }

        const value: JSONObject = attr["value"] as JSONObject;
        const stringValue: JSONValue = value["stringValue"];
        if (typeof stringValue === "string" && stringValue.length > 0) {
          value["stringValue"] = this.canonicalizeHostName(stringValue);
        }
      }
    }
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

  /**
   * Read an OTel attribute that may be either a single string or an
   * array of strings, returning the values as a list. Used for
   * attributes like host.ip whose schema is "array of IP addresses".
   * Falls back to a single stringValue if the attribute uses that
   * shape (some SDKs flatten single-element arrays to a string).
   */
  @CaptureSpan()
  protected static getStringArrayAttribute(
    attributes: JSONArray,
    key: string,
  ): Array<string> {
    for (const attribute of attributes) {
      if (attribute["key"] !== key || !attribute["value"]) {
        continue;
      }
      const value: JSONObject = attribute["value"] as JSONObject;

      const arrayValue: JSONObject | undefined = value["arrayValue"] as
        | JSONObject
        | undefined;
      if (arrayValue && Array.isArray(arrayValue["values"])) {
        const out: Array<string> = [];
        for (const v of arrayValue["values"] as JSONArray) {
          const sv: JSONValue = (v as JSONObject)["stringValue"];
          if (typeof sv === "string" && sv.trim()) {
            out.push(sv.trim());
          }
        }
        if (out.length > 0) {
          return out;
        }
      }

      const stringValue: JSONValue = value["stringValue"];
      if (typeof stringValue === "string" && stringValue.trim()) {
        return [stringValue.trim()];
      }
    }
    return [];
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

  /*
   * True when resource attributes carry a strong "this is a real host"
   * signal — os.type (set by the OTel system resourcedetector via
   * native OS calls, which app SDKs typically don't include), a
   * container runtime, or a k8s cluster name. Used to gate the
   * synthesized "host/{hostName}" service name so application SDKs
   * auto-detecting hostname inside a pod don't create phantom
   * per-pod services.
   */
  @CaptureSpan()
  protected static hasHostResourceSignal(attributes: JSONArray): boolean {
    return Boolean(
      this.getStringAttribute(attributes, "os.type") ||
        this.getStringAttribute(attributes, "container.runtime") ||
        this.getClusterNameFromAttributes(attributes),
    );
  }

  private static readonly DOCKER_HOST_ID_CACHE_NAMESPACE: string =
    "docker-host-id";
  private static readonly DOCKER_HOST_ID_CACHE_EXPIRY_SECONDS: number =
    24 * 60 * 60; // 1 day

  @CaptureSpan()
  protected static async autoDiscoverDockerHost(data: {
    projectId: ObjectID;
    attributes: JSONArray;
  }): Promise<ObjectID | null> {
    try {
      if (!this.isDockerRuntime(data.attributes)) {
        return null;
      }

      const hostName: string | null = this.getHostNameFromAttributes(
        data.attributes,
      );

      if (!hostName) {
        return null;
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
        const dockerHostId: ObjectID = new ObjectID(hostIdStr);
        /*
         * Same fence rationale as the Kubernetes path — skip the
         * per-batch maintenance UPDATE + label upsert when we
         * already ran it within the fence window.
         */
        if (await this.shouldRunMaintenance("docker-host", hostIdStr)) {
          const agentVersion: string | null = this.getStringAttribute(
            data.attributes,
            "oneuptime.agent.version",
          );
          await DockerHostService.updateLastSeen(dockerHostId, {
            osType: osType || undefined,
            osVersion: osVersion || undefined,
            agentVersion: agentVersion || undefined,
          });
          await this.promoteOneuptimeLabelsToDockerHost({
            projectId: data.projectId,
            dockerHostId,
            attributes: data.attributes,
          });
        }
        return dockerHostId;
      }

      return null;
    } catch (err) {
      logger.error(
        "Error auto-discovering Docker host: " + (err as Error).message,
      );
      return null;
    }
  }

  /*
   * Promote `oneuptime.label.<dim>=<val>` resource attributes into
   * project labels and attach them to the discovered Docker host.
   * Mirrors the host/service label promotion. Throttled per-host
   * inside `attachLabels` so steady-state ingest with unchanged
   * labels costs one in-memory cache lookup.
   */
  @CaptureSpan()
  protected static async promoteOneuptimeLabelsToDockerHost(data: {
    projectId: ObjectID;
    dockerHostId: ObjectID;
    attributes: JSONArray;
  }): Promise<void> {
    try {
      const labelNames: Array<string> = extractOneuptimeLabelNames(
        data.attributes,
      );
      if (labelNames.length === 0) {
        return;
      }
      const labelIds: Array<ObjectID> =
        await LabelService.findOrCreateLabelsByNames({
          projectId: data.projectId,
          labelNames,
        });
      if (labelIds.length === 0) {
        return;
      }
      await DockerHostService.attachLabels({
        dockerHostId: data.dockerHostId,
        labelIds,
      });
    } catch (err) {
      logger.warn(
        `Docker host label promotion failed for ${data.dockerHostId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private static readonly HOST_ID_CACHE_NAMESPACE: string = "host-id";
  private static readonly HOST_ID_CACHE_EXPIRY_SECONDS: number = 24 * 60 * 60; // 1 day

  /**
   * Auto-discover a Host (generic OTel host) from resource attributes.
   *
   * Phantom-host gate: only register a row when the batch carries a
   * strong signal that this is real host telemetry, not an application
   * SDK auto-detecting hostname inside a pod and not a Kubernetes node
   * or pod (those have their own KubernetesCluster home). Requires:
   *
   *   1. Explicit `host.name` resource attribute. The k8s.node.name
   *      fallback used by `getHostNameFromAttributes` for service-name
   *      synthesis is NOT accepted here — kubeletstats labels pod and
   *      node metrics with k8s.node.name only, which would otherwise
   *      flood the Hosts list with k8s node names.
   *   2. No `k8s.pod.name` / `k8s.node.name` / `k8s.cluster.name`
   *      resource attribute. If any of these is set the batch is
   *      Kubernetes telemetry and belongs in the KubernetesCluster
   *      record; routing happens in `resolveTelemetryResource` via the
   *      kubernetesClusterId path.
   *   3. The same batch did not already resolve to a DockerHost or
   *      KubernetesCluster row. Docker hosts and K8s clusters/nodes have
   *      their own dedicated tables; we don't want a duplicate Host row
   *      pointing back at them via dockerHostId / kubernetesClusterId.
   *   4. One of:
   *        - os.type resource attribute (set by the resourcedetection
   *          system detector via native OS calls — app SDKs typically
   *          don't include it)
   *        - container.runtime resource attribute (non-Docker container
   *          host — Docker is already excluded by gate (3))
   *        - hasInfraSignal=true (caller saw system.* / process.*
   *          metrics that only a host agent emits)
   *
   * Notably we DO NOT accept host.id or host.arch alone — both are
   * commonly auto-detected by application SDKs from inside a container,
   * so trusting them would flood the Hosts list with pod-name rows.
   * They are still captured into the Host record if present, just not
   * sufficient to create a row by themselves.
   */
  @CaptureSpan()
  protected static async autoDiscoverHost(data: {
    projectId: ObjectID;
    attributes: JSONArray;
    hasInfraSignal?: boolean;
    dockerHostId?: ObjectID | null;
    kubernetesClusterId?: ObjectID | null;
    cpuCores?: number | undefined;
    totalMemoryBytes?: number | undefined;
    processCount?: number | undefined;
  }): Promise<ObjectID | null> {
    try {
      /*
       * Docker hosts and Kubernetes clusters/nodes live in their own tables.
       * If this batch already resolved to one, do not also create a Host row.
       */
      if (data.dockerHostId || data.kubernetesClusterId) {
        return null;
      }

      const hostName: string | null = this.getStringAttribute(
        data.attributes,
        "host.name",
      );

      if (!hostName) {
        return null;
      }

      const k8sPodName: string | null = this.getStringAttribute(
        data.attributes,
        "k8s.pod.name",
      );
      const k8sNodeName: string | null = this.getStringAttribute(
        data.attributes,
        "k8s.node.name",
      );
      const k8sClusterName: string | null = this.getClusterNameFromAttributes(
        data.attributes,
      );

      if (k8sPodName || k8sNodeName || k8sClusterName) {
        return null;
      }

      /*
       * Managed / serverless compute (ECS, Fargate, Cloud Run, App Engine,
       * Lambda, …) is owned by the CloudResource / ServerlessFunction tables,
       * not Host. Skip so we don't also create a phantom Host row for those
       * platforms. Raw VM platforms (aws_ec2, gcp_compute_engine, azure_vm)
       * are intentionally NOT in these sets, so VMs still become Hosts.
       */
      const hostCloudPlatform: string | null = this.getStringAttribute(
        data.attributes,
        "cloud.platform",
      );
      if (
        hostCloudPlatform &&
        (this.SERVERLESS_CLOUD_PLATFORMS.has(hostCloudPlatform) ||
          this.CLOUD_COMPUTE_PLATFORMS.has(hostCloudPlatform))
      ) {
        return null;
      }

      const hostIdAttr: string | null = this.getStringAttribute(
        data.attributes,
        "host.id",
      );
      const hostArch: string | null = this.getStringAttribute(
        data.attributes,
        "host.arch",
      );
      const hostType: string | null = this.getStringAttribute(
        data.attributes,
        "host.type",
      );
      const ipAddresses: Array<string> = this.getStringArrayAttribute(
        data.attributes,
        "host.ip",
      );
      const hostIpJoined: string | null =
        ipAddresses.length > 0 ? ipAddresses.join(", ") : null;
      const osType: string | null = this.getStringAttribute(
        data.attributes,
        "os.type",
      );
      const osVersion: string | null =
        this.getStringAttribute(data.attributes, "os.description") ||
        this.getStringAttribute(data.attributes, "os.version");
      const containerRuntime: string | null = this.getStringAttribute(
        data.attributes,
        "container.runtime",
      );

      const hasResourceSignal: boolean = Boolean(osType || containerRuntime);

      if (!hasResourceSignal && !data.hasInfraSignal) {
        return null;
      }

      const cacheKey: string = `${data.projectId.toString()}:${hostName}`;
      let hostIdStr: string | null = await GlobalCache.getString(
        this.HOST_ID_CACHE_NAMESPACE,
        cacheKey,
      );

      if (!hostIdStr) {
        const host: Host = await HostService.findOrCreateByHostIdentifier({
          projectId: data.projectId,
          hostIdentifier: hostName,
        });

        if (host._id) {
          hostIdStr = host._id.toString();
          await GlobalCache.setString(
            this.HOST_ID_CACHE_NAMESPACE,
            cacheKey,
            hostIdStr,
            { expiresInSeconds: this.HOST_ID_CACHE_EXPIRY_SECONDS },
          );
        }
      }

      if (hostIdStr) {
        /*
         * Same fence rationale as the K8s / Docker paths — bound the
         * per-batch updateLastSeen UPDATE to one Postgres write per
         * (host, fence-window). Host's update includes infra stats
         * (cpu/memory/process counts) but those are sampled over
         * minutes, so a 5-minute stale window is acceptable.
         */
        if (await this.shouldRunMaintenance("host", hostIdStr)) {
          const agentVersion: string | null = this.getStringAttribute(
            data.attributes,
            "oneuptime.agent.version",
          );
          const deploymentEnvironment: string | null =
            this.getStringAttribute(
              data.attributes,
              "deployment.environment.name",
            ) ||
            this.getStringAttribute(data.attributes, "deployment.environment");
          const runtimeName: string | null = this.getStringAttribute(
            data.attributes,
            "process.runtime.name",
          );
          const runtimeVersion: string | null = this.getStringAttribute(
            data.attributes,
            "process.runtime.version",
          );
          const cloudProvider: string | null = this.getStringAttribute(
            data.attributes,
            "cloud.provider",
          );
          const cloudPlatform: string | null = this.getStringAttribute(
            data.attributes,
            "cloud.platform",
          );
          const cloudRegion: string | null = this.getStringAttribute(
            data.attributes,
            "cloud.region",
          );
          const cloudAccountId: string | null = this.getStringAttribute(
            data.attributes,
            "cloud.account.id",
          );
          await HostService.updateLastSeen(new ObjectID(hostIdStr), {
            osType: osType || undefined,
            osVersion: osVersion || undefined,
            hostId: hostIdAttr || undefined,
            hostArch: hostArch || undefined,
            hostType: hostType || undefined,
            hostIpAddresses: hostIpJoined || undefined,
            cpuCores: data.cpuCores,
            totalMemoryBytes: data.totalMemoryBytes,
            processCount: data.processCount,
            containerRuntime: containerRuntime || undefined,
            dockerHostId: data.dockerHostId || undefined,
            kubernetesClusterId: data.kubernetesClusterId || undefined,
            agentVersion: agentVersion || undefined,
            deploymentEnvironment: deploymentEnvironment || undefined,
            runtimeName: runtimeName || undefined,
            runtimeVersion: runtimeVersion || undefined,
            cloudProvider: cloudProvider || undefined,
            cloudPlatform: cloudPlatform || undefined,
            cloudRegion: cloudRegion || undefined,
            cloudAccountId: cloudAccountId || undefined,
          });
        }
        return new ObjectID(hostIdStr);
      }

      return null;
    } catch (err) {
      logger.error("Error auto-discovering Host: " + (err as Error).message);
      return null;
    }
  }

  /**
   * Pre-scan a resourceMetric's scopeMetrics to detect host-level
   * infrastructure signals and capture stats that the Host row caches
   * (cpuCores, totalMemoryBytes, processCount). Returning a single
   * struct lets the caller pass everything through to autoDiscoverHost
   * + HostService.updateLastSeen in one DB write per batch.
   *
   * O(metrics) per resource — same magnitude as the existing inner
   * loops; no datapoint walk beyond the small set we care about.
   */
  protected static scanHostInfraStatsFromMetrics(
    scopeMetrics: JSONArray | undefined,
  ): {
    hasInfraSignal: boolean;
    cpuCores?: number;
    totalMemoryBytes?: number;
    processCount?: number;
  } {
    const result: {
      hasInfraSignal: boolean;
      cpuCores?: number;
      totalMemoryBytes?: number;
      processCount?: number;
    } = {
      hasInfraSignal: false,
    };

    if (!scopeMetrics || !Array.isArray(scopeMetrics)) {
      return result;
    }

    for (const scopeMetric of scopeMetrics) {
      const metrics: JSONArray | undefined = (scopeMetric as JSONObject)?.[
        "metrics"
      ] as JSONArray | undefined;
      if (!metrics || !Array.isArray(metrics)) {
        continue;
      }

      for (const metric of metrics) {
        const m: JSONObject = metric as JSONObject;
        const name: string = ((m["name"] as string) || "").toLowerCase();

        if (name.startsWith("system.") || name.startsWith("process.")) {
          result.hasInfraSignal = true;
        }

        if (name === "system.cpu.logical.count") {
          const v: number | null = this.firstDatapointNumber(m);
          if (v !== null) {
            result.cpuCores = Math.round(v);
          }
          continue;
        }

        if (name === "system.memory.usage") {
          const v: number | null = this.sumDatapointNumbers(m);
          if (v !== null) {
            result.totalMemoryBytes = Math.round(v);
          }
          continue;
        }

        if (name === "system.processes.count") {
          /*
           * `system.processes.count` is partitioned by
           * `process.status` (running, sleeping, idle, …), so each
           * datapoint is one status's count. Summing across statuses
           * gives the canonical total — what `top` / `ps -e` show.
           * `firstDatapointNumber` would only return one status.
           */
          const v: number | null = this.sumDatapointNumbers(m);
          if (v !== null) {
            result.processCount = Math.round(v);
          }
          continue;
        }
      }
    }

    return result;
  }

  private static datapointValue(dp: JSONObject): number | null {
    const asInt: JSONValue = dp["asInt"];
    if (typeof asInt === "string" || typeof asInt === "number") {
      const n: number = Number(asInt);
      if (Number.isFinite(n)) {
        return n;
      }
    }
    const asDouble: JSONValue = dp["asDouble"];
    if (typeof asDouble === "string" || typeof asDouble === "number") {
      const n: number = Number(asDouble);
      if (Number.isFinite(n)) {
        return n;
      }
    }
    return null;
  }

  private static metricDataPoints(metric: JSONObject): JSONArray | null {
    const wrapper: JSONObject | undefined =
      (metric["sum"] as JSONObject | undefined) ||
      (metric["gauge"] as JSONObject | undefined);
    const points: JSONArray | undefined = wrapper?.["dataPoints"] as
      | JSONArray
      | undefined;
    if (!points || !Array.isArray(points)) {
      return null;
    }
    return points;
  }

  private static firstDatapointNumber(metric: JSONObject): number | null {
    const points: JSONArray | null = this.metricDataPoints(metric);
    if (!points) {
      return null;
    }
    for (const dp of points) {
      const v: number | null = this.datapointValue(dp as JSONObject);
      if (v !== null) {
        return v;
      }
    }
    return null;
  }

  private static sumDatapointNumbers(metric: JSONObject): number | null {
    const points: JSONArray | null = this.metricDataPoints(metric);
    if (!points) {
      return null;
    }
    let sum: number = 0;
    let any: boolean = false;
    for (const dp of points) {
      const v: number | null = this.datapointValue(dp as JSONObject);
      if (v !== null) {
        sum += v;
        any = true;
      }
    }
    return any ? sum : null;
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
