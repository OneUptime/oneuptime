import { JSONObject } from "../JSON";

/*
 * ============================================================
 * OTLP kvlistValue parsing helpers
 * ============================================================
 */

/**
 * Extract a value from an OTLP kvlistValue by key.
 * Returns the string/int value or nested kvlistValue as JSONObject.
 */
export function getKvValue(
  kvList: JSONObject | undefined,
  key: string,
): string | JSONObject | null {
  if (!kvList) {
    return null;
  }
  const values: Array<JSONObject> | undefined = kvList["values"] as
    | Array<JSONObject>
    | undefined;
  if (!values) {
    return null;
  }
  for (const entry of values) {
    if (entry["key"] === key) {
      const val: JSONObject | undefined = entry["value"] as
        | JSONObject
        | undefined;
      if (!val) {
        return null;
      }
      // Handle both camelCase (JSON encoding) and snake_case (protobuf via protobufjs)
      if (val["stringValue"] !== undefined) {
        return val["stringValue"] as string;
      }
      if (val["string_value"] !== undefined) {
        return val["string_value"] as string;
      }
      if (val["intValue"] !== undefined) {
        return String(val["intValue"]);
      }
      if (val["int_value"] !== undefined) {
        return String(val["int_value"]);
      }
      if (val["boolValue"] !== undefined) {
        return String(val["boolValue"]);
      }
      if (val["bool_value"] !== undefined) {
        return String(val["bool_value"]);
      }
      if (val["kvlistValue"]) {
        return val["kvlistValue"] as JSONObject;
      }
      if (val["kvlist_value"]) {
        return val["kvlist_value"] as JSONObject;
      }
      if (val["arrayValue"]) {
        return val["arrayValue"] as JSONObject;
      }
      if (val["array_value"]) {
        return val["array_value"] as JSONObject;
      }
      return null;
    }
  }
  return null;
}

/**
 * Extract a string value from an OTLP kvlistValue by key.
 */
export function getKvStringValue(
  kvList: JSONObject | undefined,
  key: string,
): string {
  const val: string | JSONObject | null = getKvValue(kvList, key);
  if (typeof val === "string") {
    return val;
  }
  return "";
}

/**
 * Extract a nested kvlist value (parent → child).
 */
export function getNestedKvValue(
  kvList: JSONObject | undefined,
  parentKey: string,
  childKey: string,
): string {
  const parent: string | JSONObject | null = getKvValue(kvList, parentKey);
  if (!parent || typeof parent === "string") {
    return "";
  }
  return getKvStringValue(parent, childKey);
}

/**
 * Convert a kvlistValue to a flat Record<string, string> (for labels, annotations, env).
 */
export function getKvListAsRecord(
  kvList: JSONObject | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!kvList) {
    return result;
  }
  const values: Array<JSONObject> | undefined = kvList["values"] as
    | Array<JSONObject>
    | undefined;
  if (!values) {
    return result;
  }
  for (const entry of values) {
    const key: string = (entry["key"] as string) || "";
    const val: JSONObject | undefined = entry["value"] as
      | JSONObject
      | undefined;
    if (key && val) {
      if (val["stringValue"] !== undefined) {
        result[key] = val["stringValue"] as string;
      } else if (val["string_value"] !== undefined) {
        result[key] = val["string_value"] as string;
      } else if (val["intValue"] !== undefined) {
        result[key] = String(val["intValue"]);
      } else if (val["int_value"] !== undefined) {
        result[key] = String(val["int_value"]);
      } else if (val["boolValue"] !== undefined) {
        result[key] = String(val["boolValue"]);
      } else if (val["bool_value"] !== undefined) {
        result[key] = String(val["bool_value"]);
      }
    }
  }
  return result;
}

/**
 * Convert an OTLP arrayValue to an array of JSONObjects (kvlistValues).
 */
export function getArrayValues(
  arrayValue: JSONObject | undefined,
): Array<JSONObject> {
  if (!arrayValue) {
    return [];
  }
  const values: Array<JSONObject> | undefined = arrayValue["values"] as
    | Array<JSONObject>
    | undefined;
  if (!values) {
    return [];
  }
  return values
    .map((item: JSONObject) => {
      if (item["kvlistValue"]) {
        return item["kvlistValue"] as JSONObject;
      }
      if (item["kvlist_value"]) {
        return item["kvlist_value"] as JSONObject;
      }
      if (item["stringValue"]) {
        return item as JSONObject;
      }
      if (item["string_value"]) {
        return item as JSONObject;
      }
      return null;
    })
    .filter(Boolean) as Array<JSONObject>;
}

/**
 * Recursively convert an OTLP value wrapper to a plain JavaScript value.
 * Handles stringValue, intValue, boolValue, kvlistValue, and arrayValue.
 */
function convertOtlpValue(valueWrapper: JSONObject): unknown {
  // Handle both camelCase (JSON encoding) and snake_case (protobuf via protobufjs)
  if (valueWrapper["stringValue"] !== undefined) {
    return valueWrapper["stringValue"];
  }
  if (valueWrapper["string_value"] !== undefined) {
    return valueWrapper["string_value"];
  }
  if (valueWrapper["intValue"] !== undefined) {
    return Number(valueWrapper["intValue"]);
  }
  if (valueWrapper["int_value"] !== undefined) {
    return Number(valueWrapper["int_value"]);
  }
  if (valueWrapper["boolValue"] !== undefined) {
    return valueWrapper["boolValue"];
  }
  if (valueWrapper["bool_value"] !== undefined) {
    return valueWrapper["bool_value"];
  }
  if (valueWrapper["doubleValue"] !== undefined) {
    return Number(valueWrapper["doubleValue"]);
  }
  if (valueWrapper["double_value"] !== undefined) {
    return Number(valueWrapper["double_value"]);
  }
  if (valueWrapper["kvlistValue"]) {
    return kvListToPlainObject(valueWrapper["kvlistValue"] as JSONObject);
  }
  if (valueWrapper["kvlist_value"]) {
    return kvListToPlainObject(valueWrapper["kvlist_value"] as JSONObject);
  }
  if (valueWrapper["arrayValue"]) {
    return convertOtlpArray(valueWrapper["arrayValue"] as JSONObject);
  }
  if (valueWrapper["array_value"]) {
    return convertOtlpArray(valueWrapper["array_value"] as JSONObject);
  }
  return null;
}

/**
 * Convert an OTLP arrayValue to a plain JavaScript array.
 */
function convertOtlpArray(arrayValue: JSONObject): Array<unknown> {
  const values: Array<JSONObject> | undefined = arrayValue["values"] as
    | Array<JSONObject>
    | undefined;
  if (!values) {
    return [];
  }
  return values.map((item: JSONObject) => {
    // Each item in arrayValue.values is a value wrapper
    return convertOtlpValue(item);
  });
}

/**
 * Convert an OTLP kvlistValue (nested key-value structure) to a plain
 * JavaScript object. This preserves the full original K8s manifest structure.
 */
export function kvListToPlainObject(
  kvList: JSONObject | undefined,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (!kvList) {
    return result;
  }
  const values: Array<JSONObject> | undefined = kvList["values"] as
    | Array<JSONObject>
    | undefined;
  if (!values) {
    return result;
  }
  for (const entry of values) {
    const key: string = (entry["key"] as string) || "";
    const val: JSONObject | undefined = entry["value"] as
      | JSONObject
      | undefined;
    if (key && val) {
      result[key] = convertOtlpValue(val);
    }
  }
  return result;
}

/*
 * ============================================================
 * TypeScript interfaces for parsed K8s objects
 * ============================================================
 */

export interface KubernetesObjectMetadata {
  name: string;
  namespace: string;
  uid: string;
  creationTimestamp: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  ownerReferences: Array<{
    kind: string;
    name: string;
    uid: string;
  }>;
}

export interface KubernetesContainerEnvVar {
  name: string;
  value: string; // Direct value, or description like "<Secret: my-secret/key>"
}

export interface KubernetesContainerPort {
  name: string;
  containerPort: number;
  protocol: string;
}

export interface KubernetesContainerSpec {
  name: string;
  image: string;
  command: Array<string>;
  args: Array<string>;
  env: Array<KubernetesContainerEnvVar>;
  ports: Array<KubernetesContainerPort>;
  resources: {
    requests: Record<string, string>;
    limits: Record<string, string>;
  };
  volumeMounts: Array<{
    name: string;
    mountPath: string;
    readOnly: boolean;
  }>;
}

export interface KubernetesCondition {
  type: string;
  status: string;
  reason: string;
  message: string;
  lastTransitionTime: string;
}

export interface KubernetesContainerStatus {
  name: string;
  ready: boolean;
  restartCount: number;
  state: string;
  reason: string;
  image: string;
}

export interface KubernetesPodObject {
  metadata: KubernetesObjectMetadata;
  spec: {
    containers: Array<KubernetesContainerSpec>;
    initContainers: Array<KubernetesContainerSpec>;
    serviceAccountName: string;
    nodeName: string;
    nodeSelector: Record<string, string>;
    tolerations: Array<{
      key: string;
      operator: string;
      value: string;
      effect: string;
    }>;
    volumes: Array<{
      name: string;
      type: string;
      source: string;
    }>;
  };
  status: {
    phase: string;
    podIP: string;
    hostIP: string;
    qosClass: string;
    conditions: Array<KubernetesCondition>;
    containerStatuses: Array<KubernetesContainerStatus>;
    initContainerStatuses: Array<KubernetesContainerStatus>;
  };
}

export interface KubernetesNodeObject {
  metadata: KubernetesObjectMetadata;
  status: {
    conditions: Array<KubernetesCondition>;
    nodeInfo: {
      osImage: string;
      kernelVersion: string;
      containerRuntimeVersion: string;
      kubeletVersion: string;
      architecture: string;
      operatingSystem: string;
    };
    allocatable: Record<string, string>;
    capacity: Record<string, string>;
    addresses: Array<{ type: string; address: string }>;
  };
}

export interface KubernetesDeploymentObject {
  metadata: KubernetesObjectMetadata;
  spec: {
    replicas: number;
    strategy: string;
    selector: Record<string, string>;
  };
  status: {
    replicas: number;
    readyReplicas: number;
    availableReplicas: number;
    unavailableReplicas: number;
    conditions: Array<KubernetesCondition>;
  };
}

export interface KubernetesStatefulSetObject {
  metadata: KubernetesObjectMetadata;
  spec: {
    replicas: number;
    serviceName: string;
    podManagementPolicy: string;
    updateStrategy: string;
  };
  status: {
    replicas: number;
    readyReplicas: number;
    currentReplicas: number;
  };
}

export interface KubernetesDaemonSetObject {
  metadata: KubernetesObjectMetadata;
  spec: {
    updateStrategy: string;
  };
  status: {
    desiredNumberScheduled: number;
    currentNumberScheduled: number;
    numberReady: number;
    numberMisscheduled: number;
    numberAvailable: number;
  };
}

export interface KubernetesJobObject {
  metadata: KubernetesObjectMetadata;
  spec: {
    completions: number;
    parallelism: number;
    backoffLimit: number;
  };
  status: {
    active: number;
    succeeded: number;
    failed: number;
    startTime: string;
    completionTime: string;
    conditions: Array<KubernetesCondition>;
  };
}

export interface KubernetesCronJobObject {
  metadata: KubernetesObjectMetadata;
  spec: {
    schedule: string;
    suspend: boolean;
    concurrencyPolicy: string;
    successfulJobsHistoryLimit: number;
    failedJobsHistoryLimit: number;
  };
  status: {
    lastScheduleTime: string;
    activeCount: number;
  };
}

export interface KubernetesNamespaceObject {
  metadata: KubernetesObjectMetadata;
  status: {
    phase: string;
  };
}

export interface KubernetesPVCObject {
  metadata: KubernetesObjectMetadata;
  spec: {
    accessModes: Array<string>;
    storageClassName: string;
    volumeName: string;
    resources: {
      requests: {
        storage: string;
      };
    };
  };
  status: {
    phase: string; // Bound, Pending, Lost
    capacity: {
      storage: string;
    };
  };
}

export interface KubernetesPVObject {
  metadata: KubernetesObjectMetadata;
  spec: {
    capacity: {
      storage: string;
    };
    accessModes: Array<string>;
    storageClassName: string;
    persistentVolumeReclaimPolicy: string;
    claimRef: {
      name: string;
      namespace: string;
    };
  };
  status: {
    phase: string; // Available, Bound, Released, Failed
  };
}

export interface KubernetesHPAMetricSpec {
  type: string;
  resourceName: string;
  targetType: string;
  targetValue: string;
}

export interface KubernetesHPACondition {
  type: string;
  status: string;
  reason: string;
  message: string;
  lastTransitionTime: string;
}

export interface KubernetesHPAObject {
  metadata: KubernetesObjectMetadata;
  spec: {
    minReplicas: number;
    maxReplicas: number;
    scaleTargetRef: {
      kind: string;
      name: string;
    };
    metrics: Array<KubernetesHPAMetricSpec>;
  };
  status: {
    currentReplicas: number;
    desiredReplicas: number;
    conditions: Array<KubernetesHPACondition>;
  };
}

export interface KubernetesVPAContainerRecommendation {
  containerName: string;
  target: Record<string, string>;
  lowerBound: Record<string, string>;
  upperBound: Record<string, string>;
}

export interface KubernetesVPAObject {
  metadata: KubernetesObjectMetadata;
  spec: {
    targetRef: {
      kind: string;
      name: string;
    };
    updatePolicy: {
      updateMode: string;
    };
    resourcePolicy: string;
  };
  status: {
    recommendation: {
      containerRecommendations: Array<KubernetesVPAContainerRecommendation>;
    };
  };
}

/*
 * ============================================================
 * Parsers
 * ============================================================
 */

function parseMetadata(kvList: JSONObject): KubernetesObjectMetadata {
  const labelsKvList: string | JSONObject | null = getKvValue(kvList, "labels");
  const annotationsKvList: string | JSONObject | null = getKvValue(
    kvList,
    "annotations",
  );
  const ownerRefsArrayValue: string | JSONObject | null = getKvValue(
    kvList,
    "ownerReferences",
  );

  const ownerReferences: Array<{
    kind: string;
    name: string;
    uid: string;
  }> = [];
  if (ownerRefsArrayValue && typeof ownerRefsArrayValue !== "string") {
    const refs: Array<JSONObject> = getArrayValues(ownerRefsArrayValue);
    for (const ref of refs) {
      ownerReferences.push({
        kind: getKvStringValue(ref, "kind"),
        name: getKvStringValue(ref, "name"),
        uid: getKvStringValue(ref, "uid"),
      });
    }
  }

  return {
    name: getKvStringValue(kvList, "name"),
    namespace: getKvStringValue(kvList, "namespace"),
    uid: getKvStringValue(kvList, "uid"),
    creationTimestamp: getKvStringValue(kvList, "creationTimestamp"),
    labels:
      labelsKvList && typeof labelsKvList !== "string"
        ? getKvListAsRecord(labelsKvList)
        : {},
    annotations:
      annotationsKvList && typeof annotationsKvList !== "string"
        ? getKvListAsRecord(annotationsKvList)
        : {},
    ownerReferences,
  };
}

function parseContainerEnv(
  envArrayValue: JSONObject | null,
): Array<KubernetesContainerEnvVar> {
  if (!envArrayValue || typeof envArrayValue === "string") {
    return [];
  }
  const envItems: Array<JSONObject> = getArrayValues(envArrayValue);
  const result: Array<KubernetesContainerEnvVar> = [];

  for (const envKvList of envItems) {
    const name: string = getKvStringValue(envKvList, "name");
    const directValue: string = getKvStringValue(envKvList, "value");

    if (directValue) {
      result.push({ name, value: directValue });
    } else {
      // Check for valueFrom (secretKeyRef, configMapKeyRef, fieldRef)
      const valueFrom: string | JSONObject | null = getKvValue(
        envKvList,
        "valueFrom",
      );
      if (valueFrom && typeof valueFrom !== "string") {
        const secretRef: string | JSONObject | null = getKvValue(
          valueFrom,
          "secretKeyRef",
        );
        const configMapRef: string | JSONObject | null = getKvValue(
          valueFrom,
          "configMapKeyRef",
        );
        const fieldRef: string | JSONObject | null = getKvValue(
          valueFrom,
          "fieldRef",
        );

        if (secretRef && typeof secretRef !== "string") {
          const secretName: string = getKvStringValue(secretRef, "name");
          const secretKey: string = getKvStringValue(secretRef, "key");
          result.push({
            name,
            value: `<Secret: ${secretName}/${secretKey}>`,
          });
        } else if (configMapRef && typeof configMapRef !== "string") {
          const cmName: string = getKvStringValue(configMapRef, "name");
          const cmKey: string = getKvStringValue(configMapRef, "key");
          result.push({
            name,
            value: `<ConfigMap: ${cmName}/${cmKey}>`,
          });
        } else if (fieldRef && typeof fieldRef !== "string") {
          const fieldPath: string = getKvStringValue(fieldRef, "fieldPath");
          result.push({ name, value: `<FieldRef: ${fieldPath}>` });
        } else {
          result.push({ name, value: "<from valueFrom>" });
        }
      } else {
        result.push({ name, value: directValue || "" });
      }
    }
  }
  return result;
}

function parseContainerSpec(kvList: JSONObject): KubernetesContainerSpec {
  const portsArrayValue: string | JSONObject | null = getKvValue(
    kvList,
    "ports",
  );
  const ports: Array<KubernetesContainerPort> = [];
  if (portsArrayValue && typeof portsArrayValue !== "string") {
    const portItems: Array<JSONObject> = getArrayValues(portsArrayValue);
    for (const portKv of portItems) {
      ports.push({
        name: getKvStringValue(portKv, "name"),
        containerPort: parseInt(getKvStringValue(portKv, "containerPort")) || 0,
        protocol: getKvStringValue(portKv, "protocol") || "TCP",
      });
    }
  }

  const envArrayValue: string | JSONObject | null = getKvValue(kvList, "env");
  const env: Array<KubernetesContainerEnvVar> = parseContainerEnv(
    envArrayValue as JSONObject | null,
  );

  const volumeMountsArray: string | JSONObject | null = getKvValue(
    kvList,
    "volumeMounts",
  );
  const volumeMounts: Array<{
    name: string;
    mountPath: string;
    readOnly: boolean;
  }> = [];
  if (volumeMountsArray && typeof volumeMountsArray !== "string") {
    const mountItems: Array<JSONObject> = getArrayValues(volumeMountsArray);
    for (const mountKv of mountItems) {
      volumeMounts.push({
        name: getKvStringValue(mountKv, "name"),
        mountPath: getKvStringValue(mountKv, "mountPath"),
        readOnly: getKvStringValue(mountKv, "readOnly") === "true",
      });
    }
  }

  const resourcesKv: string | JSONObject | null = getKvValue(
    kvList,
    "resources",
  );
  let requests: Record<string, string> = {};
  let limits: Record<string, string> = {};
  if (resourcesKv && typeof resourcesKv !== "string") {
    const reqKv: string | JSONObject | null = getKvValue(
      resourcesKv,
      "requests",
    );
    const limKv: string | JSONObject | null = getKvValue(resourcesKv, "limits");
    if (reqKv && typeof reqKv !== "string") {
      requests = getKvListAsRecord(reqKv);
    }
    if (limKv && typeof limKv !== "string") {
      limits = getKvListAsRecord(limKv);
    }
  }

  const commandArray: string | JSONObject | null = getKvValue(
    kvList,
    "command",
  );
  const command: Array<string> = [];
  if (commandArray && typeof commandArray !== "string") {
    const cmdValues: Array<JSONObject> =
      (commandArray["values"] as Array<JSONObject>) || [];
    for (const v of cmdValues) {
      if (v["stringValue"]) {
        command.push(v["stringValue"] as string);
      }
    }
  }

  const argsArray: string | JSONObject | null = getKvValue(kvList, "args");
  const args: Array<string> = [];
  if (argsArray && typeof argsArray !== "string") {
    const argValues: Array<JSONObject> =
      (argsArray["values"] as Array<JSONObject>) || [];
    for (const v of argValues) {
      if (v["stringValue"]) {
        args.push(v["stringValue"] as string);
      }
    }
  }

  return {
    name: getKvStringValue(kvList, "name"),
    image: getKvStringValue(kvList, "image"),
    command,
    args,
    env,
    ports,
    resources: { requests, limits },
    volumeMounts,
  };
}

function parseConditions(
  conditionsArrayValue: JSONObject | null,
): Array<KubernetesCondition> {
  if (!conditionsArrayValue) {
    return [];
  }
  const items: Array<JSONObject> = getArrayValues(conditionsArrayValue);
  return items.map((kvList: JSONObject) => {
    return {
      type: getKvStringValue(kvList, "type"),
      status: getKvStringValue(kvList, "status"),
      reason: getKvStringValue(kvList, "reason"),
      message: getKvStringValue(kvList, "message"),
      lastTransitionTime: getKvStringValue(kvList, "lastTransitionTime"),
    };
  });
}

function parseContainerStatuses(
  statusesArrayValue: JSONObject | null,
): Array<KubernetesContainerStatus> {
  if (!statusesArrayValue) {
    return [];
  }
  const items: Array<JSONObject> = getArrayValues(statusesArrayValue);
  return items.map((kvList: JSONObject) => {
    // state is a kvlist with one key (running/waiting/terminated)
    const stateKv: string | JSONObject | null = getKvValue(kvList, "state");
    let state: string = "Unknown";
    let reason: string = "";
    if (stateKv && typeof stateKv !== "string") {
      const stateValues: Array<JSONObject> | undefined = stateKv["values"] as
        | Array<JSONObject>
        | undefined;
      if (stateValues && stateValues.length > 0 && stateValues[0]) {
        state = (stateValues[0]["key"] as string) || "Unknown";
        // Extract reason from the state's nested kvlist value (e.g., waiting -> { reason: "CrashLoopBackOff" })
        const stateDetail: JSONObject | undefined = stateValues[0]["value"] as
          | JSONObject
          | undefined;
        if (stateDetail && stateDetail["kvlistValue"]) {
          reason = getKvStringValue(
            stateDetail["kvlistValue"] as JSONObject,
            "reason",
          );
        }
      }
    }

    return {
      name: getKvStringValue(kvList, "name"),
      ready: getKvStringValue(kvList, "ready") === "true",
      restartCount: parseInt(getKvStringValue(kvList, "restartCount")) || 0,
      state,
      reason,
      image: getKvStringValue(kvList, "image"),
    };
  });
}

/**
 * Parse a raw OTLP log body into a Pod object.
 * The body format: { kvlistValue: { values: [{ key: "type", value: ... }, { key: "object", value: { kvlistValue: ... } }] } }
 */
export function parsePodObject(
  objectKvList: JSONObject,
): KubernetesPodObject | null {
  try {
    const metadataKv: string | JSONObject | null = getKvValue(
      objectKvList,
      "metadata",
    );
    if (!metadataKv || typeof metadataKv === "string") {
      return null;
    }
    const metadata: KubernetesObjectMetadata = parseMetadata(metadataKv);

    const specKv: string | JSONObject | null = getKvValue(objectKvList, "spec");
    const statusKv: string | JSONObject | null = getKvValue(
      objectKvList,
      "status",
    );

    // Parse containers
    const containers: Array<KubernetesContainerSpec> = [];
    const initContainers: Array<KubernetesContainerSpec> = [];

    if (specKv && typeof specKv !== "string") {
      const containersArray: string | JSONObject | null = getKvValue(
        specKv,
        "containers",
      );
      if (containersArray && typeof containersArray !== "string") {
        const containerItems: Array<JSONObject> =
          getArrayValues(containersArray);
        for (const cKv of containerItems) {
          containers.push(parseContainerSpec(cKv));
        }
      }

      const initContainersArray: string | JSONObject | null = getKvValue(
        specKv,
        "initContainers",
      );
      if (initContainersArray && typeof initContainersArray !== "string") {
        const initItems: Array<JSONObject> =
          getArrayValues(initContainersArray);
        for (const cKv of initItems) {
          initContainers.push(parseContainerSpec(cKv));
        }
      }
    }

    // Parse volumes
    const volumes: Array<{ name: string; type: string; source: string }> = [];
    if (specKv && typeof specKv !== "string") {
      const volumesArray: string | JSONObject | null = getKvValue(
        specKv,
        "volumes",
      );
      if (volumesArray && typeof volumesArray !== "string") {
        const volItems: Array<JSONObject> = getArrayValues(volumesArray);
        for (const volKv of volItems) {
          const name: string = getKvStringValue(volKv, "name");
          // Volume type is one of: configMap, secret, emptyDir, hostPath, persistentVolumeClaim, etc.
          const volValues: Array<JSONObject> | undefined = volKv["values"] as
            | Array<JSONObject>
            | undefined;
          let volType: string = "unknown";
          let volSource: string = "";
          if (volValues) {
            for (const v of volValues) {
              const k: string = (v["key"] as string) || "";
              if (k !== "name") {
                volType = k;
                const innerVal: JSONObject | undefined = v["value"] as
                  | JSONObject
                  | undefined;
                if (innerVal && innerVal["kvlistValue"]) {
                  const innerKv: JSONObject = innerVal[
                    "kvlistValue"
                  ] as JSONObject;
                  volSource =
                    getKvStringValue(innerKv, "name") ||
                    getKvStringValue(innerKv, "path") ||
                    getKvStringValue(innerKv, "claimName") ||
                    volType;
                }
                break;
              }
            }
          }
          volumes.push({ name, type: volType, source: volSource });
        }
      }
    }

    // Parse tolerations
    const tolerations: Array<{
      key: string;
      operator: string;
      value: string;
      effect: string;
    }> = [];
    if (specKv && typeof specKv !== "string") {
      const tolArray: string | JSONObject | null = getKvValue(
        specKv,
        "tolerations",
      );
      if (tolArray && typeof tolArray !== "string") {
        const tolItems: Array<JSONObject> = getArrayValues(tolArray);
        for (const tolKv of tolItems) {
          tolerations.push({
            key: getKvStringValue(tolKv, "key"),
            operator: getKvStringValue(tolKv, "operator"),
            value: getKvStringValue(tolKv, "value"),
            effect: getKvStringValue(tolKv, "effect"),
          });
        }
      }
    }

    // Parse nodeSelector
    let nodeSelector: Record<string, string> = {};
    if (specKv && typeof specKv !== "string") {
      const nsKv: string | JSONObject | null = getKvValue(
        specKv,
        "nodeSelector",
      );
      if (nsKv && typeof nsKv !== "string") {
        nodeSelector = getKvListAsRecord(nsKv);
      }
    }

    // Parse status
    let phase: string = "";
    let podIP: string = "";
    let hostIP: string = "";
    let qosClass: string = "";
    let conditions: Array<KubernetesCondition> = [];
    let containerStatuses: Array<KubernetesContainerStatus> = [];
    let initContainerStatuses: Array<KubernetesContainerStatus> = [];

    if (statusKv && typeof statusKv !== "string") {
      phase = getKvStringValue(statusKv, "phase");
      podIP = getKvStringValue(statusKv, "podIP");
      hostIP = getKvStringValue(statusKv, "hostIP");
      qosClass = getKvStringValue(statusKv, "qosClass");

      const condArray: string | JSONObject | null = getKvValue(
        statusKv,
        "conditions",
      );
      conditions = parseConditions(condArray as JSONObject | null);

      const csArray: string | JSONObject | null = getKvValue(
        statusKv,
        "containerStatuses",
      );
      containerStatuses = parseContainerStatuses(csArray as JSONObject | null);

      const icsArray: string | JSONObject | null = getKvValue(
        statusKv,
        "initContainerStatuses",
      );
      initContainerStatuses = parseContainerStatuses(
        icsArray as JSONObject | null,
      );
    }

    return {
      metadata,
      spec: {
        containers,
        initContainers,
        serviceAccountName: specKv
          ? getKvStringValue(specKv as JSONObject, "serviceAccountName")
          : "",
        nodeName: specKv
          ? getKvStringValue(specKv as JSONObject, "nodeName")
          : "",
        nodeSelector,
        tolerations,
        volumes,
      },
      status: {
        phase,
        podIP,
        hostIP,
        qosClass,
        conditions,
        containerStatuses,
        initContainerStatuses,
      },
    };
  } catch {
    return null;
  }
}

export function parseNodeObject(
  objectKvList: JSONObject,
): KubernetesNodeObject | null {
  try {
    const metadataKv: string | JSONObject | null = getKvValue(
      objectKvList,
      "metadata",
    );
    if (!metadataKv || typeof metadataKv === "string") {
      return null;
    }

    const statusKv: string | JSONObject | null = getKvValue(
      objectKvList,
      "status",
    );

    let conditions: Array<KubernetesCondition> = [];
    let nodeInfo: KubernetesNodeObject["status"]["nodeInfo"] = {
      osImage: "",
      kernelVersion: "",
      containerRuntimeVersion: "",
      kubeletVersion: "",
      architecture: "",
      operatingSystem: "",
    };
    let allocatable: Record<string, string> = {};
    let capacity: Record<string, string> = {};
    let addresses: Array<{ type: string; address: string }> = [];

    if (statusKv && typeof statusKv !== "string") {
      const condArray: string | JSONObject | null = getKvValue(
        statusKv,
        "conditions",
      );
      conditions = parseConditions(condArray as JSONObject | null);

      const nodeInfoKv: string | JSONObject | null = getKvValue(
        statusKv,
        "nodeInfo",
      );
      if (nodeInfoKv && typeof nodeInfoKv !== "string") {
        nodeInfo = {
          osImage: getKvStringValue(nodeInfoKv, "osImage"),
          kernelVersion: getKvStringValue(nodeInfoKv, "kernelVersion"),
          containerRuntimeVersion: getKvStringValue(
            nodeInfoKv,
            "containerRuntimeVersion",
          ),
          kubeletVersion: getKvStringValue(nodeInfoKv, "kubeletVersion"),
          architecture: getKvStringValue(nodeInfoKv, "architecture"),
          operatingSystem: getKvStringValue(nodeInfoKv, "operatingSystem"),
        };
      }

      const allocKv: string | JSONObject | null = getKvValue(
        statusKv,
        "allocatable",
      );
      if (allocKv && typeof allocKv !== "string") {
        allocatable = getKvListAsRecord(allocKv);
      }

      const capKv: string | JSONObject | null = getKvValue(
        statusKv,
        "capacity",
      );
      if (capKv && typeof capKv !== "string") {
        capacity = getKvListAsRecord(capKv);
      }

      const addrArray: string | JSONObject | null = getKvValue(
        statusKv,
        "addresses",
      );
      if (addrArray && typeof addrArray !== "string") {
        const addrItems: Array<JSONObject> = getArrayValues(addrArray);
        addresses = addrItems.map((a: JSONObject) => {
          return {
            type: getKvStringValue(a, "type"),
            address: getKvStringValue(a, "address"),
          };
        });
      }
    }

    return {
      metadata: parseMetadata(metadataKv),
      status: {
        conditions,
        nodeInfo,
        allocatable,
        capacity,
        addresses,
      },
    };
  } catch {
    return null;
  }
}

export function parseDeploymentObject(
  objectKvList: JSONObject,
): KubernetesDeploymentObject | null {
  try {
    const metadataKv: string | JSONObject | null = getKvValue(
      objectKvList,
      "metadata",
    );
    if (!metadataKv || typeof metadataKv === "string") {
      return null;
    }

    const specKv: string | JSONObject | null = getKvValue(objectKvList, "spec");
    const statusKv: string | JSONObject | null = getKvValue(
      objectKvList,
      "status",
    );

    let replicas: number = 0;
    let strategy: string = "";
    let selector: Record<string, string> = {};
    if (specKv && typeof specKv !== "string") {
      replicas = parseInt(getKvStringValue(specKv, "replicas")) || 0;
      const strategyKv: string | JSONObject | null = getKvValue(
        specKv,
        "strategy",
      );
      if (strategyKv && typeof strategyKv !== "string") {
        strategy = getKvStringValue(strategyKv, "type");
      }
      const selectorKv: string | JSONObject | null = getKvValue(
        specKv,
        "selector",
      );
      if (selectorKv && typeof selectorKv !== "string") {
        const matchLabelsKv: string | JSONObject | null = getKvValue(
          selectorKv,
          "matchLabels",
        );
        if (matchLabelsKv && typeof matchLabelsKv !== "string") {
          selector = getKvListAsRecord(matchLabelsKv);
        }
      }
    }

    let statusReplicas: number = 0;
    let readyReplicas: number = 0;
    let availableReplicas: number = 0;
    let unavailableReplicas: number = 0;
    let conditions: Array<KubernetesCondition> = [];
    if (statusKv && typeof statusKv !== "string") {
      statusReplicas = parseInt(getKvStringValue(statusKv, "replicas")) || 0;
      readyReplicas =
        parseInt(getKvStringValue(statusKv, "readyReplicas")) || 0;
      availableReplicas =
        parseInt(getKvStringValue(statusKv, "availableReplicas")) || 0;
      unavailableReplicas =
        parseInt(getKvStringValue(statusKv, "unavailableReplicas")) || 0;
      const condArray: string | JSONObject | null = getKvValue(
        statusKv,
        "conditions",
      );
      conditions = parseConditions(condArray as JSONObject | null);
    }

    return {
      metadata: parseMetadata(metadataKv),
      spec: { replicas, strategy, selector },
      status: {
        replicas: statusReplicas,
        readyReplicas,
        availableReplicas,
        unavailableReplicas,
        conditions,
      },
    };
  } catch {
    return null;
  }
}

export function parseStatefulSetObject(
  objectKvList: JSONObject,
): KubernetesStatefulSetObject | null {
  try {
    const metadataKv: string | JSONObject | null = getKvValue(
      objectKvList,
      "metadata",
    );
    if (!metadataKv || typeof metadataKv === "string") {
      return null;
    }

    const specKv: string | JSONObject | null = getKvValue(objectKvList, "spec");
    const statusKv: string | JSONObject | null = getKvValue(
      objectKvList,
      "status",
    );

    let replicas: number = 0;
    let serviceName: string = "";
    let podManagementPolicy: string = "";
    let updateStrategy: string = "";
    if (specKv && typeof specKv !== "string") {
      replicas = parseInt(getKvStringValue(specKv, "replicas")) || 0;
      serviceName = getKvStringValue(specKv, "serviceName");
      podManagementPolicy = getKvStringValue(specKv, "podManagementPolicy");
      const usKv: string | JSONObject | null = getKvValue(
        specKv,
        "updateStrategy",
      );
      if (usKv && typeof usKv !== "string") {
        updateStrategy = getKvStringValue(usKv, "type");
      }
    }

    return {
      metadata: parseMetadata(metadataKv),
      spec: { replicas, serviceName, podManagementPolicy, updateStrategy },
      status: {
        replicas: statusKv
          ? parseInt(getKvStringValue(statusKv as JSONObject, "replicas")) || 0
          : 0,
        readyReplicas: statusKv
          ? parseInt(
              getKvStringValue(statusKv as JSONObject, "readyReplicas"),
            ) || 0
          : 0,
        currentReplicas: statusKv
          ? parseInt(
              getKvStringValue(statusKv as JSONObject, "currentReplicas"),
            ) || 0
          : 0,
      },
    };
  } catch {
    return null;
  }
}

export function parseDaemonSetObject(
  objectKvList: JSONObject,
): KubernetesDaemonSetObject | null {
  try {
    const metadataKv: string | JSONObject | null = getKvValue(
      objectKvList,
      "metadata",
    );
    if (!metadataKv || typeof metadataKv === "string") {
      return null;
    }

    const specKv: string | JSONObject | null = getKvValue(objectKvList, "spec");
    const statusKv: string | JSONObject | null = getKvValue(
      objectKvList,
      "status",
    );

    let updateStrategy: string = "";
    if (specKv && typeof specKv !== "string") {
      const usKv: string | JSONObject | null = getKvValue(
        specKv,
        "updateStrategy",
      );
      if (usKv && typeof usKv !== "string") {
        updateStrategy = getKvStringValue(usKv, "type");
      }
    }

    return {
      metadata: parseMetadata(metadataKv),
      spec: { updateStrategy },
      status: {
        desiredNumberScheduled: statusKv
          ? parseInt(
              getKvStringValue(
                statusKv as JSONObject,
                "desiredNumberScheduled",
              ),
            ) || 0
          : 0,
        currentNumberScheduled: statusKv
          ? parseInt(
              getKvStringValue(
                statusKv as JSONObject,
                "currentNumberScheduled",
              ),
            ) || 0
          : 0,
        numberReady: statusKv
          ? parseInt(getKvStringValue(statusKv as JSONObject, "numberReady")) ||
            0
          : 0,
        numberMisscheduled: statusKv
          ? parseInt(
              getKvStringValue(statusKv as JSONObject, "numberMisscheduled"),
            ) || 0
          : 0,
        numberAvailable: statusKv
          ? parseInt(
              getKvStringValue(statusKv as JSONObject, "numberAvailable"),
            ) || 0
          : 0,
      },
    };
  } catch {
    return null;
  }
}

export function parseJobObject(
  objectKvList: JSONObject,
): KubernetesJobObject | null {
  try {
    const metadataKv: string | JSONObject | null = getKvValue(
      objectKvList,
      "metadata",
    );
    if (!metadataKv || typeof metadataKv === "string") {
      return null;
    }

    const specKv: string | JSONObject | null = getKvValue(objectKvList, "spec");
    const statusKv: string | JSONObject | null = getKvValue(
      objectKvList,
      "status",
    );

    return {
      metadata: parseMetadata(metadataKv),
      spec: {
        completions: specKv
          ? parseInt(getKvStringValue(specKv as JSONObject, "completions")) || 0
          : 0,
        parallelism: specKv
          ? parseInt(getKvStringValue(specKv as JSONObject, "parallelism")) || 0
          : 0,
        backoffLimit: specKv
          ? parseInt(getKvStringValue(specKv as JSONObject, "backoffLimit")) ||
            0
          : 0,
      },
      status: {
        active: statusKv
          ? parseInt(getKvStringValue(statusKv as JSONObject, "active")) || 0
          : 0,
        succeeded: statusKv
          ? parseInt(getKvStringValue(statusKv as JSONObject, "succeeded")) || 0
          : 0,
        failed: statusKv
          ? parseInt(getKvStringValue(statusKv as JSONObject, "failed")) || 0
          : 0,
        startTime: statusKv
          ? getKvStringValue(statusKv as JSONObject, "startTime")
          : "",
        completionTime: statusKv
          ? getKvStringValue(statusKv as JSONObject, "completionTime")
          : "",
        conditions: statusKv
          ? parseConditions(
              getKvValue(
                statusKv as JSONObject,
                "conditions",
              ) as JSONObject | null,
            )
          : [],
      },
    };
  } catch {
    return null;
  }
}

export function parseCronJobObject(
  objectKvList: JSONObject,
): KubernetesCronJobObject | null {
  try {
    const metadataKv: string | JSONObject | null = getKvValue(
      objectKvList,
      "metadata",
    );
    if (!metadataKv || typeof metadataKv === "string") {
      return null;
    }

    const specKv: string | JSONObject | null = getKvValue(objectKvList, "spec");
    const statusKv: string | JSONObject | null = getKvValue(
      objectKvList,
      "status",
    );

    return {
      metadata: parseMetadata(metadataKv),
      spec: {
        schedule: specKv
          ? getKvStringValue(specKv as JSONObject, "schedule")
          : "",
        suspend: specKv
          ? getKvStringValue(specKv as JSONObject, "suspend") === "true"
          : false,
        concurrencyPolicy: specKv
          ? getKvStringValue(specKv as JSONObject, "concurrencyPolicy")
          : "",
        successfulJobsHistoryLimit: specKv
          ? parseInt(
              getKvStringValue(
                specKv as JSONObject,
                "successfulJobsHistoryLimit",
              ),
            ) || 0
          : 0,
        failedJobsHistoryLimit: specKv
          ? parseInt(
              getKvStringValue(specKv as JSONObject, "failedJobsHistoryLimit"),
            ) || 0
          : 0,
      },
      status: {
        lastScheduleTime: statusKv
          ? getKvStringValue(statusKv as JSONObject, "lastScheduleTime")
          : "",
        activeCount: statusKv
          ? parseInt(getKvStringValue(statusKv as JSONObject, "active")) || 0
          : 0,
      },
    };
  } catch {
    return null;
  }
}

export function parseNamespaceObject(
  objectKvList: JSONObject,
): KubernetesNamespaceObject | null {
  try {
    const metadataKv: string | JSONObject | null = getKvValue(
      objectKvList,
      "metadata",
    );
    if (!metadataKv || typeof metadataKv === "string") {
      return null;
    }

    const statusKv: string | JSONObject | null = getKvValue(
      objectKvList,
      "status",
    );

    return {
      metadata: parseMetadata(metadataKv),
      status: {
        phase: statusKv
          ? getKvStringValue(statusKv as JSONObject, "phase")
          : "",
      },
    };
  } catch {
    return null;
  }
}

export function parsePVCObject(
  objectKvList: JSONObject,
): KubernetesPVCObject | null {
  try {
    const metadataKv: string | JSONObject | null = getKvValue(
      objectKvList,
      "metadata",
    );
    if (!metadataKv || typeof metadataKv === "string") {
      return null;
    }

    const metadata: KubernetesObjectMetadata = parseMetadata(metadataKv);
    if (!metadata.name) {
      return null;
    }

    const specKv: string | JSONObject | null = getKvValue(objectKvList, "spec");
    const statusKv: string | JSONObject | null = getKvValue(
      objectKvList,
      "status",
    );

    // Parse spec
    const accessModes: Array<string> = [];
    let storageClassName: string = "";
    let volumeName: string = "";
    let requestsStorage: string = "";

    if (specKv && typeof specKv !== "string") {
      storageClassName = getKvStringValue(specKv, "storageClassName");
      volumeName = getKvStringValue(specKv, "volumeName");

      const accessModesArray: string | JSONObject | null = getKvValue(
        specKv,
        "accessModes",
      );
      if (accessModesArray && typeof accessModesArray !== "string") {
        const modeValues: Array<JSONObject> =
          (accessModesArray["values"] as Array<JSONObject>) || [];
        for (const v of modeValues) {
          if (v["stringValue"]) {
            accessModes.push(v["stringValue"] as string);
          }
        }
      }

      const resourcesKv: string | JSONObject | null = getKvValue(
        specKv,
        "resources",
      );
      if (resourcesKv && typeof resourcesKv !== "string") {
        requestsStorage = getNestedKvValue(resourcesKv, "requests", "storage");
      }
    }

    // Parse status
    let phase: string = "";
    let capacityStorage: string = "";

    if (statusKv && typeof statusKv !== "string") {
      phase = getKvStringValue(statusKv, "phase");
      capacityStorage = getNestedKvValue(statusKv, "capacity", "storage");
    }

    return {
      metadata,
      spec: {
        accessModes,
        storageClassName,
        volumeName,
        resources: {
          requests: {
            storage: requestsStorage,
          },
        },
      },
      status: {
        phase,
        capacity: {
          storage: capacityStorage,
        },
      },
    };
  } catch {
    return null;
  }
}

export function parsePVObject(
  objectKvList: JSONObject,
): KubernetesPVObject | null {
  try {
    const metadataKv: string | JSONObject | null = getKvValue(
      objectKvList,
      "metadata",
    );
    if (!metadataKv || typeof metadataKv === "string") {
      return null;
    }

    const metadata: KubernetesObjectMetadata = parseMetadata(metadataKv);
    if (!metadata.name) {
      return null;
    }

    const specKv: string | JSONObject | null = getKvValue(objectKvList, "spec");
    const statusKv: string | JSONObject | null = getKvValue(
      objectKvList,
      "status",
    );

    // Parse spec
    let capacityStorage: string = "";
    const accessModes: Array<string> = [];
    let storageClassName: string = "";
    let persistentVolumeReclaimPolicy: string = "";
    let claimRefName: string = "";
    let claimRefNamespace: string = "";

    if (specKv && typeof specKv !== "string") {
      capacityStorage = getNestedKvValue(specKv, "capacity", "storage");
      storageClassName = getKvStringValue(specKv, "storageClassName");
      persistentVolumeReclaimPolicy = getKvStringValue(
        specKv,
        "persistentVolumeReclaimPolicy",
      );

      const accessModesArray: string | JSONObject | null = getKvValue(
        specKv,
        "accessModes",
      );
      if (accessModesArray && typeof accessModesArray !== "string") {
        const modeValues: Array<JSONObject> =
          (accessModesArray["values"] as Array<JSONObject>) || [];
        for (const v of modeValues) {
          if (v["stringValue"]) {
            accessModes.push(v["stringValue"] as string);
          }
        }
      }

      const claimRefKv: string | JSONObject | null = getKvValue(
        specKv,
        "claimRef",
      );
      if (claimRefKv && typeof claimRefKv !== "string") {
        claimRefName = getKvStringValue(claimRefKv, "name");
        claimRefNamespace = getKvStringValue(claimRefKv, "namespace");
      }
    }

    // Parse status
    let phase: string = "";
    if (statusKv && typeof statusKv !== "string") {
      phase = getKvStringValue(statusKv, "phase");
    }

    return {
      metadata,
      spec: {
        capacity: {
          storage: capacityStorage,
        },
        accessModes,
        storageClassName,
        persistentVolumeReclaimPolicy,
        claimRef: {
          name: claimRefName,
          namespace: claimRefNamespace,
        },
      },
      status: {
        phase,
      },
    };
  } catch {
    return null;
  }
}

export function parseHPAObject(
  objectKvList: JSONObject,
): KubernetesHPAObject | null {
  try {
    const metadataKv: string | JSONObject | null = getKvValue(
      objectKvList,
      "metadata",
    );
    if (!metadataKv || typeof metadataKv === "string") {
      return null;
    }

    const specKv: string | JSONObject | null = getKvValue(objectKvList, "spec");
    const statusKv: string | JSONObject | null = getKvValue(
      objectKvList,
      "status",
    );

    let minReplicas: number = 0;
    let maxReplicas: number = 0;
    let scaleTargetRef: { kind: string; name: string } = {
      kind: "",
      name: "",
    };
    const metrics: Array<KubernetesHPAMetricSpec> = [];
    if (specKv && typeof specKv !== "string") {
      minReplicas = parseInt(getKvStringValue(specKv, "minReplicas")) || 0;
      maxReplicas = parseInt(getKvStringValue(specKv, "maxReplicas")) || 0;
      const targetRefKv: string | JSONObject | null = getKvValue(
        specKv,
        "scaleTargetRef",
      );
      if (targetRefKv && typeof targetRefKv !== "string") {
        scaleTargetRef = {
          kind: getKvStringValue(targetRefKv, "kind"),
          name: getKvStringValue(targetRefKv, "name"),
        };
      }
      const metricsArrayKv: string | JSONObject | null = getKvValue(
        specKv,
        "metrics",
      );
      if (metricsArrayKv && typeof metricsArrayKv !== "string") {
        const metricsItems: Array<JSONObject> = getArrayValues(metricsArrayKv);
        for (const metricKv of metricsItems) {
          const metricType: string = getKvStringValue(metricKv, "type");
          let resourceName: string = "";
          let targetType: string = "";
          let targetValue: string = "";
          const resourceKv: string | JSONObject | null = getKvValue(
            metricKv,
            "resource",
          );
          if (resourceKv && typeof resourceKv !== "string") {
            resourceName = getKvStringValue(resourceKv, "name");
            const targetKv: string | JSONObject | null = getKvValue(
              resourceKv,
              "target",
            );
            if (targetKv && typeof targetKv !== "string") {
              targetType = getKvStringValue(targetKv, "type");
              targetValue =
                getKvStringValue(targetKv, "averageUtilization") ||
                getKvStringValue(targetKv, "averageValue") ||
                getKvStringValue(targetKv, "value");
            }
          }
          metrics.push({
            type: metricType,
            resourceName,
            targetType,
            targetValue,
          });
        }
      }
    }

    let currentReplicas: number = 0;
    let desiredReplicas: number = 0;
    let conditions: Array<KubernetesHPACondition> = [];
    if (statusKv && typeof statusKv !== "string") {
      currentReplicas =
        parseInt(getKvStringValue(statusKv, "currentReplicas")) || 0;
      desiredReplicas =
        parseInt(getKvStringValue(statusKv, "desiredReplicas")) || 0;
      const condArray: string | JSONObject | null = getKvValue(
        statusKv,
        "conditions",
      );
      if (condArray && typeof condArray !== "string") {
        const condItems: Array<JSONObject> = getArrayValues(condArray);
        conditions = condItems.map(
          (condKv: JSONObject): KubernetesHPACondition => {
            return {
              type: getKvStringValue(condKv, "type"),
              status: getKvStringValue(condKv, "status"),
              reason: getKvStringValue(condKv, "reason"),
              message: getKvStringValue(condKv, "message"),
              lastTransitionTime: getKvStringValue(
                condKv,
                "lastTransitionTime",
              ),
            };
          },
        );
      }
    }

    return {
      metadata: parseMetadata(metadataKv),
      spec: { minReplicas, maxReplicas, scaleTargetRef, metrics },
      status: { currentReplicas, desiredReplicas, conditions },
    };
  } catch {
    return null;
  }
}

export function parseVPAObject(
  objectKvList: JSONObject,
): KubernetesVPAObject | null {
  try {
    const metadataKv: string | JSONObject | null = getKvValue(
      objectKvList,
      "metadata",
    );
    if (!metadataKv || typeof metadataKv === "string") {
      return null;
    }

    const specKv: string | JSONObject | null = getKvValue(objectKvList, "spec");
    const statusKv: string | JSONObject | null = getKvValue(
      objectKvList,
      "status",
    );

    let targetRef: { kind: string; name: string } = { kind: "", name: "" };
    let updatePolicy: { updateMode: string } = { updateMode: "" };
    let resourcePolicy: string = "";
    if (specKv && typeof specKv !== "string") {
      const targetRefKv: string | JSONObject | null = getKvValue(
        specKv,
        "targetRef",
      );
      if (targetRefKv && typeof targetRefKv !== "string") {
        targetRef = {
          kind: getKvStringValue(targetRefKv, "kind"),
          name: getKvStringValue(targetRefKv, "name"),
        };
      }
      const updatePolicyKv: string | JSONObject | null = getKvValue(
        specKv,
        "updatePolicy",
      );
      if (updatePolicyKv && typeof updatePolicyKv !== "string") {
        updatePolicy = {
          updateMode: getKvStringValue(updatePolicyKv, "updateMode"),
        };
      }
      resourcePolicy = getKvStringValue(specKv, "resourcePolicy");
    }

    const containerRecommendations: Array<KubernetesVPAContainerRecommendation> =
      [];
    if (statusKv && typeof statusKv !== "string") {
      const recommendationKv: string | JSONObject | null = getKvValue(
        statusKv,
        "recommendation",
      );
      if (recommendationKv && typeof recommendationKv !== "string") {
        const containerRecsArrayKv: string | JSONObject | null = getKvValue(
          recommendationKv,
          "containerRecommendations",
        );
        if (containerRecsArrayKv && typeof containerRecsArrayKv !== "string") {
          const recItems: Array<JSONObject> =
            getArrayValues(containerRecsArrayKv);
          for (const recKv of recItems) {
            const targetKv: string | JSONObject | null = getKvValue(
              recKv,
              "target",
            );
            const lowerBoundKv: string | JSONObject | null = getKvValue(
              recKv,
              "lowerBound",
            );
            const upperBoundKv: string | JSONObject | null = getKvValue(
              recKv,
              "upperBound",
            );
            containerRecommendations.push({
              containerName: getKvStringValue(recKv, "containerName"),
              target:
                targetKv && typeof targetKv !== "string"
                  ? getKvListAsRecord(targetKv)
                  : {},
              lowerBound:
                lowerBoundKv && typeof lowerBoundKv !== "string"
                  ? getKvListAsRecord(lowerBoundKv)
                  : {},
              upperBound:
                upperBoundKv && typeof upperBoundKv !== "string"
                  ? getKvListAsRecord(upperBoundKv)
                  : {},
            });
          }
        }
      }
    }

    return {
      metadata: parseMetadata(metadataKv),
      spec: { targetRef, updatePolicy, resourcePolicy },
      status: {
        recommendation: { containerRecommendations },
      },
    };
  } catch {
    return null;
  }
}

/**
 * Extract the K8s object from a raw OTLP log body string.
 * For k8sobjects pull mode, the body is:
 * { kvlistValue: { values: [{ key: "type", value: ... }, { key: "object", value: { kvlistValue: ... } }] } }
 * OR for some modes, the object may be at the top level.
 */
export function extractObjectFromLogBody(
  bodyString: string,
): JSONObject | null {
  try {
    const bodyObj: JSONObject = JSON.parse(bodyString) as JSONObject;
    // Handle both camelCase (JSON encoding) and snake_case (protobuf via protobufjs)
    const topKvList: JSONObject | undefined = (bodyObj["kvlistValue"] ||
      bodyObj["kvlist_value"]) as JSONObject | undefined;
    if (!topKvList) {
      return null;
    }

    // Try to get the "object" key (used in watch mode)
    const objectVal: string | JSONObject | null = getKvValue(
      topKvList,
      "object",
    );
    if (objectVal && typeof objectVal !== "string") {
      return objectVal;
    }

    /*
     * If no "object" key, the kvlist might BE the object (pull mode)
     * Check if it has typical K8s fields
     */
    const kind: string | JSONObject | null = getKvValue(topKvList, "kind");
    if (kind) {
      return topKvList;
    }

    // Also check "metadata" as a fallback for objects without "kind"
    const metadata: string | JSONObject | null = getKvValue(
      topKvList,
      "metadata",
    );
    if (metadata && typeof metadata !== "string") {
      return topKvList;
    }

    return null;
  } catch {
    return null;
  }
}
