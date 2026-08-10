import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import CaptureSpan from "./CaptureSpan";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import MetricTypeService from "../../Services/MetricTypeService";
import Service from "../../../Models/DatabaseModels/Service";
import Dictionary from "../../../Types/Dictionary";
import GlobalCache from "../../Infrastructure/GlobalCache";
import logger from "../Logger";
import crypto from "crypto";

export type AttributeType = string | number | boolean | null;

/*
 * Shares the namespace used by the OTLP maintenance fences so the metric
 * catalog is throttled by the same machinery, with the same TTL, as every
 * other per-batch reconcile on the ingest path.
 */
const METRIC_TYPE_FENCE_NAMESPACE: string = "otel-maintenance-fence";
const METRIC_TYPE_FENCE_TTL_SECONDS: number = 5 * 60; // 5 minutes

export default class TelemetryUtil {
  /*
   * Reconcile the metric catalog: one MetricType row per (project, metric
   * name), carrying its description/unit/counter-semantics and the set of
   * services that emit it.
   *
   * This runs on the ingest hot path, once per distinct metric name per batch,
   * and it used to be the only per-batch Postgres writer with no fence, no
   * cache and no dedup of any kind. It had two separate defects that together
   * made it write on EVERY batch, forever:
   *
   *  1. Rows are created with `description || ""`, so the stored value is `""`
   *     whenever OTLP omits the field — but the INCOMING value is `undefined`
   *     for the same case (protobuf omits unset scalars). `"" !== undefined`
   *     is true, so the "has anything changed?" check answered yes on every
   *     batch for every metric without a description or unit. The counter
   *     semantics below already had the correct `!== undefined` guard;
   *     description and unit were simply left behind.
   *  2. The write shipped the whole `services` array, which routes through
   *     `save()` — a multi-round-trip transaction holding the row's write lock
   *     — and deletes any association not present in the current batch.
   *
   * Both are fixed here. Absent now means "unknown", not "clear", and the two
   * kinds of change are tracked separately so a scalar edit takes a single
   * auto-committed UPDATE and an association takes an additive insert.
   *
   * A fence in front of the whole thing removes the SELECT as well as the
   * write in the steady state. The fence key includes the batch's service set:
   * `servicesInMap` holds only the services in THIS batch, so keying on the
   * name alone would let a batch from service A satisfy the fence and suppress
   * the association that a concurrent batch from service B still needs.
   */
  @CaptureSpan()
  public static async indexMetricNameServiceNameMap(data: {
    projectId: ObjectID;
    metricNameServiceNameMap: Dictionary<MetricType>;
  }): Promise<void> {
    for (const metricName of Object.keys(data.metricNameServiceNameMap)) {
      const metricTypeInMap: MetricType =
        data.metricNameServiceNameMap[metricName]!;

      // check if services are same as the ones in the map
      const servicesInMap: Array<ObjectID> =
        metricTypeInMap?.services?.map((service: Service) => {
          return service.id!;
        }) || [];

      const fenceKey: string = TelemetryUtil.buildMetricTypeFenceKey({
        projectId: data.projectId,
        metricName: metricName,
        serviceIds: servicesInMap,
      });

      if (
        !(await TelemetryUtil.shouldIndexMetricType(
          fenceKey,
          TelemetryUtil.fingerprintMetricTypeScalars(metricTypeInMap),
        ))
      ) {
        continue;
      }

      try {
        await TelemetryUtil.reconcileMetricType({
          projectId: data.projectId,
          metricName: metricName,
          metricTypeInMap: metricTypeInMap,
          servicesInMap: servicesInMap,
        });
      } catch (err) {
        /*
         * Per-metric isolation. This loop used to let any failure escape and
         * abort indexing for every REMAINING metric name in the batch — and
         * the only caller just logs, so a single bad row silently stopped the
         * whole catalog from converging.
         */
        await TelemetryUtil.clearMetricTypeFence(fenceKey);

        logger.warn(
          `TelemetryUtil.indexMetricNameServiceNameMap: failed to reconcile metric "${metricName}": ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  private static async reconcileMetricType(data: {
    projectId: ObjectID;
    metricName: string;
    metricTypeInMap: MetricType;
    servicesInMap: Array<ObjectID>;
  }): Promise<void> {
    const { projectId, metricName, metricTypeInMap, servicesInMap } = data;

    const metricType: MetricType | null = await MetricTypeService.findOneBy({
      query: {
        projectId: projectId,
        name: metricName,
      },
      select: {
        services: true,
        name: true,
        description: true,
        unit: true,
        isMonotonic: true,
        aggregationTemporality: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (metricType) {
      await TelemetryUtil.updateExistingMetricType({
        metricType,
        metricTypeInMap,
        servicesInMap,
      });
      return;
    }

    try {
      await TelemetryUtil.createMetricType({
        projectId,
        metricName,
        metricTypeInMap,
        servicesInMap,
      });
    } catch (err) {
      /*
       * Uniqueness on (projectId, name) is enforced in application code by a
       * countBy, not by a database constraint, so two workers can both decide
       * to create the same metric. Re-find to disambiguate: a row now means a
       * concurrent worker won (harmless — reconcile against it); no row means
       * the insert itself was invalid and must surface.
       */
      const winner: MetricType | null = await MetricTypeService.findOneBy({
        query: { projectId: projectId, name: metricName },
        select: {
          services: true,
          name: true,
          description: true,
          unit: true,
          isMonotonic: true,
          aggregationTemporality: true,
        },
        props: { isRoot: true },
      });

      if (!winner) {
        throw err;
      }

      logger.debug(
        `TelemetryUtil: create raced for metric "${metricName}" (concurrent insert); reconciling against the winning row.`,
      );

      await TelemetryUtil.updateExistingMetricType({
        metricType: winner,
        metricTypeInMap,
        servicesInMap,
      });
    }
  }

  private static async updateExistingMetricType(data: {
    metricType: MetricType;
    metricTypeInMap: MetricType;
    servicesInMap: Array<ObjectID>;
  }): Promise<void> {
    const { metricType, metricTypeInMap, servicesInMap } = data;

    if (!metricType.services) {
      metricType.services = [];
    }

    const existingServiceIds: Set<string> = new Set<string>(
      metricType.services.map((service: Service) => {
        return service.id!.toString();
      }),
    );

    /*
     * Two flags, not one. A scalar edit and a new association need completely
     * different statements, and conflating them is what forced every scalar
     * edit through the relation-writing `save()` path.
     */
    let scalarsChanged: boolean = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scalarUpdate: any = {};

    /*
     * An absent incoming value means "this producer didn't say", not "clear
     * the stored value" — the same rule the counter-semantics block below has
     * always used. Without the truthiness guard, a stored `""` compared
     * against an incoming `undefined` reported a change on every single batch.
     */
    if (
      metricTypeInMap.description &&
      (metricType.description ?? "") !== metricTypeInMap.description
    ) {
      scalarsChanged = true;
      scalarUpdate.description = metricTypeInMap.description;
    }

    if (
      metricTypeInMap.unit &&
      (metricType.unit ?? "") !== metricTypeInMap.unit
    ) {
      scalarsChanged = true;
      scalarUpdate.unit = metricTypeInMap.unit;
    }

    /*
     * Counter semantics (isMonotonic / aggregationTemporality) are only
     * known on OTel metric ingest paths — other callers (monitor
     * metrics, heartbeat metrics) never set them, so an undefined
     * incoming value means "unknown", not "clear the stored value".
     */
    if (
      metricTypeInMap.isMonotonic !== undefined &&
      metricType.isMonotonic !== metricTypeInMap.isMonotonic
    ) {
      scalarsChanged = true;
      scalarUpdate.isMonotonic = metricTypeInMap.isMonotonic;
    }

    if (
      metricTypeInMap.aggregationTemporality !== undefined &&
      metricType.aggregationTemporality !==
        metricTypeInMap.aggregationTemporality
    ) {
      scalarsChanged = true;
      scalarUpdate.aggregationTemporality =
        metricTypeInMap.aggregationTemporality;
    }

    const servicesToAttach: Array<ObjectID> = servicesInMap.filter(
      (serviceId: ObjectID) => {
        return !existingServiceIds.has(serviceId.toString());
      },
    );

    if (scalarsChanged) {
      /*
       * One auto-committed UPDATE. Deliberately NOT updateOneById: with
       * `services` absent from the payload that path still opens a transaction
       * and bumps `version`, and MetricType declares no update workflow, no
       * realtime events and no audit log, so the full pipeline buys nothing
       * here. Nothing in the codebase uses TypeORM optimistic locking, so the
       * skipped version bump has no consumer.
       */
      await MetricTypeService.updateColumnsByIdWithoutHooks({
        id: metricType.id!,
        data: scalarUpdate,
      });
    }

    if (servicesToAttach.length > 0) {
      await MetricTypeService.attachServices({
        metricTypeId: metricType.id!,
        serviceIds: servicesToAttach,
      });
    }
  }

  private static async createMetricType(data: {
    projectId: ObjectID;
    metricName: string;
    metricTypeInMap: MetricType;
    servicesInMap: Array<ObjectID>;
  }): Promise<void> {
    const metricType: MetricType = new MetricType();
    metricType.name = data.metricName;
    metricType.description = data.metricTypeInMap.description || "";
    metricType.unit = data.metricTypeInMap.unit || "";
    if (data.metricTypeInMap.isMonotonic !== undefined) {
      metricType.isMonotonic = data.metricTypeInMap.isMonotonic;
    }
    if (data.metricTypeInMap.aggregationTemporality !== undefined) {
      metricType.aggregationTemporality =
        data.metricTypeInMap.aggregationTemporality;
    }
    metricType.projectId = data.projectId;
    metricType.services = [];

    for (const serviceId of data.servicesInMap) {
      const service: Service = new Service();
      service.id = serviceId;
      metricType.services!.push(service);
    }

    /*
     * Creates stay on the ORM path: a raw INSERT would bypass tenant stamping,
     * slug generation and the uniqueness check. Creates are also rare — this
     * runs once per metric name in a project's lifetime.
     */
    await MetricTypeService.create({
      data: metricType,
      props: {
        isRoot: true,
      },
    });
  }

  private static buildMetricTypeFenceKey(data: {
    projectId: ObjectID;
    metricName: string;
    serviceIds: Array<ObjectID>;
  }): string {
    const services: string = data.serviceIds
      .map((serviceId: ObjectID) => {
        return serviceId.toString();
      })
      .sort()
      .join(",");

    return `metric-type:${data.projectId.toString()}:${
      data.metricName
    }:${crypto.createHash("sha1").update(services).digest("hex")}`;
  }

  private static fingerprintMetricTypeScalars(metricType: MetricType): string {
    return crypto
      .createHash("sha1")
      .update(
        JSON.stringify({
          description: metricType.description ?? null,
          unit: metricType.unit ?? null,
          isMonotonic: metricType.isMonotonic ?? null,
          aggregationTemporality: metricType.aggregationTemporality ?? null,
        }),
      )
      .digest("hex");
  }

  /*
   * Compare-and-claim rather than plain set-if-absent: a metric whose
   * description or unit genuinely changed must be written promptly, not wait
   * out the window. Atomic, so concurrent workers cannot all pass the gate the
   * way a read-then-write lets them.
   */
  private static async shouldIndexMetricType(
    fenceKey: string,
    fingerprint: string,
  ): Promise<boolean> {
    try {
      return await GlobalCache.setStringIfChanged(
        METRIC_TYPE_FENCE_NAMESPACE,
        fenceKey,
        fingerprint,
        {
          expiresInSeconds: GlobalCache.withJitter(
            METRIC_TYPE_FENCE_TTL_SECONDS,
          ),
        },
      );
    } catch {
      // If the cache is down, default to running the reconcile.
      return true;
    }
  }

  private static async clearMetricTypeFence(fenceKey: string): Promise<void> {
    try {
      await GlobalCache.deleteKey(METRIC_TYPE_FENCE_NAMESPACE, fenceKey);
    } catch {
      // Best effort — losing the release costs one window of staleness.
    }
  }

  public static getAttributesForServiceIdAndServiceName(data: {
    serviceId: ObjectID;
    serviceName: string;
  }): Dictionary<AttributeType> {
    // get attributes for service id and service name
    return {
      "oneuptime.service.id": data.serviceId.toString(),
      "oneuptime.service.name": data.serviceName,
    };
  }

  /*
   * Cross-cutting resource stamps. Spread alongside the service stamp on
   * every analytics row so a single ClickHouse query can find "all
   * telemetry from host X" / "from docker host Y" / "from cluster Z"
   * regardless of which Service the row primarily belongs to. Without
   * these, host context would only be queryable as the raw OTel
   * `resource.host.name` string with no stable id link.
   */
  public static getAttributesForHostIdAndHostName(data: {
    hostId: ObjectID;
    hostName: string;
  }): Dictionary<AttributeType> {
    return {
      "oneuptime.host.id": data.hostId.toString(),
      "oneuptime.host.name": data.hostName,
    };
  }

  public static getAttributesForDockerHostIdAndHostName(data: {
    dockerHostId: ObjectID;
    hostName: string;
  }): Dictionary<AttributeType> {
    return {
      "oneuptime.docker.host.id": data.dockerHostId.toString(),
      "oneuptime.docker.host.name": data.hostName,
    };
  }

  public static getAttributesForPodmanHostIdAndHostName(data: {
    podmanHostId: ObjectID;
    hostName: string;
  }): Dictionary<AttributeType> {
    return {
      "oneuptime.podman.host.id": data.podmanHostId.toString(),
      "oneuptime.podman.host.name": data.hostName,
    };
  }

  public static getAttributesForKubernetesClusterIdAndName(data: {
    kubernetesClusterId: ObjectID;
    clusterName: string;
  }): Dictionary<AttributeType> {
    return {
      "oneuptime.kubernetes.cluster.id": data.kubernetesClusterId.toString(),
      "oneuptime.kubernetes.cluster.name": data.clusterName,
    };
  }

  public static getAttributes(data: {
    prefixKeysWithString: string;
    items: JSONArray;
  }): Dictionary<AttributeType | Array<AttributeType>> {
    const { items } = data;
    let { prefixKeysWithString } = data;

    if (prefixKeysWithString) {
      prefixKeysWithString = `${prefixKeysWithString}.`;
    }

    const finalObj: Dictionary<AttributeType | Array<AttributeType>> = {};
    const attributes: JSONArray = items;

    if (!attributes) {
      return finalObj;
    }

    for (const attribute of attributes) {
      if (!attribute["key"] || typeof attribute["key"] !== "string") {
        continue;
      }

      const keyWithPrefix: string = `${prefixKeysWithString}${attribute["key"]}`;

      const value:
        | AttributeType
        | Dictionary<AttributeType | Array<AttributeType>>
        | Array<AttributeType>
        | null = this.getAttributeValues(keyWithPrefix, attribute["value"]);

      if (value === null) {
        finalObj[keyWithPrefix] = null;
        continue;
      }

      if (Array.isArray(value)) {
        finalObj[keyWithPrefix] = value;
        continue;
      }

      if (typeof value === "object") {
        for (const [nestedKey, nestedValue] of Object.entries(
          value as Dictionary<AttributeType | Array<AttributeType>>,
        )) {
          finalObj[nestedKey] = nestedValue as
            | AttributeType
            | Array<AttributeType>;
        }

        continue;
      }

      finalObj[keyWithPrefix] = value as AttributeType;
    }

    return finalObj;
  }

  public static getAttributeValues(
    prefixKeysWithString: string,
    value: JSONValue,
  ):
    | AttributeType
    | Dictionary<AttributeType | Array<AttributeType>>
    | Array<AttributeType>
    | null {
    let finalObj:
      | Dictionary<AttributeType | Array<AttributeType>>
      | AttributeType
      | Array<AttributeType>
      | null = null;
    const jsonValue: JSONObject = value as JSONObject;

    if (jsonValue && typeof jsonValue === "object") {
      // Handle both camelCase (JSON encoding) and snake_case (protobuf via protobufjs)
      if (
        Object.prototype.hasOwnProperty.call(jsonValue, "stringValue") ||
        Object.prototype.hasOwnProperty.call(jsonValue, "string_value")
      ) {
        const stringValue: JSONValue =
          jsonValue["stringValue"] ?? jsonValue["string_value"];
        finalObj =
          stringValue !== undefined && stringValue !== null
            ? (stringValue as string)
            : "";
      } else if (
        Object.prototype.hasOwnProperty.call(jsonValue, "intValue") ||
        Object.prototype.hasOwnProperty.call(jsonValue, "int_value")
      ) {
        const intValue: JSONValue =
          jsonValue["intValue"] ?? jsonValue["int_value"];
        if (intValue !== undefined && intValue !== null) {
          finalObj = intValue as number;
        }
      } else if (
        Object.prototype.hasOwnProperty.call(jsonValue, "doubleValue") ||
        Object.prototype.hasOwnProperty.call(jsonValue, "double_value")
      ) {
        const doubleValue: JSONValue =
          jsonValue["doubleValue"] ?? jsonValue["double_value"];
        if (doubleValue !== undefined && doubleValue !== null) {
          finalObj = doubleValue as number;
        }
      } else if (
        Object.prototype.hasOwnProperty.call(jsonValue, "boolValue") ||
        Object.prototype.hasOwnProperty.call(jsonValue, "bool_value")
      ) {
        finalObj = (jsonValue["boolValue"] ??
          jsonValue["bool_value"]) as boolean;
      } else if (
        (jsonValue["arrayValue"] &&
          (jsonValue["arrayValue"] as JSONObject)["values"]) ||
        (jsonValue["array_value"] &&
          (jsonValue["array_value"] as JSONObject)["values"])
      ) {
        const arrayVal: JSONObject = (jsonValue["arrayValue"] ||
          jsonValue["array_value"]) as JSONObject;
        const values: JSONArray = arrayVal["values"] as JSONArray;
        finalObj = values.map((v: JSONObject) => {
          return this.getAttributeValues(
            prefixKeysWithString,
            v,
          ) as AttributeType;
        }) as Array<AttributeType>;
      } else if (
        jsonValue["mapValue"] &&
        (jsonValue["mapValue"] as JSONObject)["fields"]
      ) {
        const fields: JSONObject = (jsonValue["mapValue"] as JSONObject)[
          "fields"
        ] as JSONObject;

        const flattenedFields: Dictionary<
          AttributeType | Array<AttributeType>
        > = {};
        for (const key in fields) {
          const nestedPrefix: string = `${prefixKeysWithString}.${key}`;
          const nestedValue:
            | AttributeType
            | Dictionary<AttributeType | Array<AttributeType>>
            | Array<AttributeType>
            | null = this.getAttributeValues(nestedPrefix, fields[key]);

          if (nestedValue === null) {
            flattenedFields[nestedPrefix] = null;
            continue;
          }

          if (Array.isArray(nestedValue)) {
            flattenedFields[nestedPrefix] = nestedValue;
            continue;
          }

          if (typeof nestedValue === "object") {
            for (const [nestedKey, nestedEntry] of Object.entries(
              nestedValue as Dictionary<AttributeType | Array<AttributeType>>,
            )) {
              flattenedFields[nestedKey] = nestedEntry as
                | AttributeType
                | Array<AttributeType>;
            }

            continue;
          }

          flattenedFields[nestedPrefix] = nestedValue as AttributeType;
        }

        finalObj = flattenedFields;
      } else if (
        (jsonValue["kvlistValue"] &&
          (jsonValue["kvlistValue"] as JSONObject)["values"]) ||
        (jsonValue["kvlist_value"] &&
          (jsonValue["kvlist_value"] as JSONObject)["values"])
      ) {
        const kvlistVal: JSONObject = (jsonValue["kvlistValue"] ||
          jsonValue["kvlist_value"]) as JSONObject;
        const values: JSONArray = kvlistVal["values"] as JSONArray;
        finalObj = this.getAttributes({
          prefixKeysWithString,
          items: values,
        });
      } else if ("nullValue" in jsonValue || "null_value" in jsonValue) {
        finalObj = null;
      }
    }

    return finalObj;
  }

  public static getAttributeKeys(
    attributes:
      | Dictionary<AttributeType | Array<AttributeType> | JSONObject>
      | JSONObject
      | undefined,
  ): Array<string> {
    if (!attributes || typeof attributes !== "object") {
      return [];
    }

    return Object.keys(attributes).sort();
  }
}
