import Alert from "Common/Models/DatabaseModels/Alert";
import Incident from "Common/Models/DatabaseModels/Incident";
import ChangeEvent from "Common/Models/AnalyticsModels/ChangeEvent";
import Query from "Common/Types/BaseDatabase/Query";
import ObjectID from "Common/Types/ObjectID";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  DictionaryFilterOperator,
  detectOperatorFromValue,
} from "Common/UI/Components/Dictionary/DictionaryFilterOperator";

/** Query fragments; [] suppresses a source, whereas [{}] is project-wide. */
export interface EventOverlayScope {
  incidentQueries: Array<Query<Incident>>;
  alertQueries: Array<Query<Alert>>;
  changeEventQueries: Array<Query<ChangeEvent>>;
}

/*
 * Memberships expand into separate exact queries because nested relation
 * operators are not serialized by the database API. Bound that expansion.
 */
export const EVENT_OVERLAY_SCOPE_QUERY_LIMIT: number = 50;

type ScopeQuery = { [key: string]: string | ScopeQuery };
type Attributes = Record<string, unknown>;

interface ResourceMapping {
  relation: string;
  ids: Array<string>;
  names?: Array<string> | undefined;
  nameColumn?: string | undefined;
}

function attributeAliases(...keys: Array<string>): Array<string> {
  return keys.flatMap((key: string): Array<string> => {
    return [key, `resource.${key}`];
  });
}

const RESOURCE_MAPPINGS: Array<ResourceMapping> = [
  { relation: "monitors", ids: ["monitorId", "monitorIds"] },
  {
    relation: "serviceLevelObjectives",
    ids: ["sloId", "serviceLevelObjectiveId", "serviceLevelObjectiveIds"],
  },
  {
    relation: "hosts",
    ids: ["hostId", "hostIds", ...attributeAliases("oneuptime.host.id")],
    names: attributeAliases("host.name", "oneuptime.host.name"),
    nameColumn: "hostIdentifier",
  },
  {
    relation: "dockerHosts",
    ids: [
      "dockerHostId",
      "dockerHostIds",
      ...attributeAliases("oneuptime.docker.host.id"),
    ],
    names: attributeAliases("oneuptime.docker.host.name"),
    nameColumn: "hostIdentifier",
  },
  {
    relation: "podmanHosts",
    ids: [
      "podmanHostId",
      "podmanHostIds",
      ...attributeAliases("oneuptime.podman.host.id"),
    ],
    names: attributeAliases("oneuptime.podman.host.name"),
    nameColumn: "hostIdentifier",
  },
  {
    relation: "kubernetesClusters",
    ids: [
      "kubernetesClusterId",
      "kubernetesClusterIds",
      ...attributeAliases("oneuptime.kubernetes.cluster.id"),
    ],
    names: attributeAliases(
      "k8s.cluster.name",
      "oneuptime.kubernetes.cluster.name",
    ),
    nameColumn: "clusterIdentifier",
  },
  {
    relation: "kubernetesResources",
    ids: ["kubernetesResourceId", "kubernetesResourceIds"],
  },
  {
    relation: "kubernetesContainers",
    ids: ["kubernetesContainerId", "kubernetesContainerIds"],
  },
  {
    relation: "dockerResources",
    ids: ["dockerResourceId", "dockerResourceIds"],
  },
  {
    relation: "podmanResources",
    ids: ["podmanResourceId", "podmanResourceIds"],
  },
  {
    relation: "proxmoxClusters",
    ids: ["proxmoxClusterId", "proxmoxClusterIds"],
    names: attributeAliases("proxmox.cluster.name"),
    nameColumn: "name",
  },
  {
    relation: "vmwareVCenters",
    ids: ["vmwareVCenterId", "vmwareVCenterIds"],
    names: attributeAliases("vmware.vcenter.name"),
    nameColumn: "name",
  },
  {
    relation: "cephClusters",
    ids: ["cephClusterId", "cephClusterIds"],
    names: attributeAliases("ceph.cluster.name"),
    nameColumn: "name",
  },
  {
    relation: "dockerSwarmClusters",
    ids: ["dockerSwarmClusterId", "dockerSwarmClusterIds"],
    names: attributeAliases("docker.swarm.cluster.name"),
    nameColumn: "name",
  },
  {
    relation: "iotFleets",
    ids: ["iotFleetId", "iotFleetIds"],
    names: attributeAliases("iot.fleet.name"),
    nameColumn: "name",
  },
  /*
   * Ingest stamps both attributes on DB receiver batches (the Database
   * Agent / an OTel Collector DB receiver). The stamped name is the row's
   * display name, e.g. "PostgreSQL db.prod:5432".
   */
  {
    relation: "databaseServers",
    ids: [
      "databaseServerId",
      "databaseServerIds",
      ...attributeAliases("oneuptime.database.server.id"),
    ],
    names: attributeAliases("oneuptime.database.server.name"),
    nameColumn: "name",
  },
  {
    relation: "services",
    ids: [
      "serviceId",
      "serviceIds",
      "services",
      ...attributeAliases("oneuptime.service.id"),
    ],
    names: attributeAliases("service.name", "oneuptime.service.name"),
    nameColumn: "name",
  },
];

const PRIMARY_TYPE_RELATIONS: Partial<Record<ServiceType, string>> = {
  [ServiceType.Monitor]: "monitors",
  [ServiceType.ServiceLevelObjective]: "serviceLevelObjectives",
  [ServiceType.Host]: "hosts",
  [ServiceType.DockerHost]: "dockerHosts",
  [ServiceType.PodmanHost]: "podmanHosts",
  [ServiceType.KubernetesCluster]: "kubernetesClusters",
  [ServiceType.ProxmoxCluster]: "proxmoxClusters",
  [ServiceType.VMwareVCenter]: "vmwareVCenters",
  [ServiceType.CephCluster]: "cephClusters",
  [ServiceType.DockerSwarmCluster]: "dockerSwarmClusters",
  // The telemetry discriminator is historical: its id is the owning fleet.
  [ServiceType.IoTDevice]: "iotFleets",
  [ServiceType.DatabaseServer]: "databaseServers",
  [ServiceType.OpenTelemetry]: "services",
};

const UNSUPPORTED_RESOURCE_KEYS: ReadonlyArray<string> = [
  "entityId",
  "entityIds",
  "entityKeys",
  "entityScope",
  "monitorGroupId",
  "networkDeviceId",
  "networkDeviceIds",
  "serverlessFunctionId",
  "serverlessFunctionIds",
  "cloudResourceId",
  "cloudResourceIds",
  "rumApplicationId",
  "rumApplicationIds",
  "realUserMonitorId",
  "iotDeviceId",
  "iotDeviceIds",
  ...attributeAliases(
    "faas.id",
    "faas.name",
    "cloud.resource_id",
    "cloud.platform",
    "cloud.provider",
    "cloud.account.id",
    "cloud.region",
    "device.id",
    "process.pid",
    "process.start_time",
    "rum.application.id",
    "oneuptime.rum.application.id",
  ),
];

const KUBERNETES_KINDS: Record<string, string> = {
  node: "Node",
  pod: "Pod",
  deployment: "Deployment",
  statefulset: "StatefulSet",
  daemonset: "DaemonSet",
  job: "Job",
  cronjob: "CronJob",
  replicaset: "ReplicaSet",
  namespace: "Namespace",
  service: "Service",
  persistentvolume: "PersistentVolume",
  persistentvolumeclaim: "PersistentVolumeClaim",
};

function exactValues(
  value: unknown,
  allowIdSearch: boolean = false,
): Array<string> | null {
  if (value instanceof ObjectID) {
    return [value.toString()];
  }

  if (Array.isArray(value)) {
    const values: Array<string> = [];
    for (const item of value) {
      const parsed: Array<string> | null = exactValues(item);
      if (!parsed || parsed.length !== 1) {
        return null;
      }
      values.push(parsed[0]!);
    }
    return Array.from(new Set(values)).sort();
  }

  const detected: ReturnType<typeof detectOperatorFromValue> =
    detectOperatorFromValue(value);
  let values: Array<string>;
  if (detected.operator === DictionaryFilterOperator.EqualTo) {
    values = [detected.rawValue];
  } else if (detected.operator === DictionaryFilterOperator.IsAnyOf) {
    values = detected.rawValues || [];
  } else if (
    allowIdSearch &&
    detected.operator === DictionaryFilterOperator.Contains &&
    ObjectID.isValidUUID(detected.rawValue)
  ) {
    /*
     * Operational incident/SLO metrics encode an array of ids as a string.
     * Their Search(UUID) filter identifies one whole id, never a name search.
     */
    values = [detected.rawValue];
  } else {
    return null;
  }

  if (
    values.some((item: string): boolean => {
      return item.trim().length === 0;
    })
  ) {
    return null;
  }

  return Array.from(new Set(values)).sort();
}

function sortedQuery(query: ScopeQuery): ScopeQuery {
  const result: ScopeQuery = {};
  for (const key of Object.keys(query).sort()) {
    const value: string | ScopeQuery = query[key]!;
    result[key] = typeof value === "string" ? value : sortedQuery(value);
  }
  return result;
}

function dedupeQueries(queries: Array<ScopeQuery>): Array<ScopeQuery> {
  const byKey: Map<string, ScopeQuery> = new Map();
  for (const query of queries) {
    const sorted: ScopeQuery = sortedQuery(query);
    byKey.set(JSON.stringify(sorted), sorted);
  }
  // A genuinely unscoped chart already includes all the other branches.
  if (byKey.has("{}")) {
    return [{}];
  }
  if (byKey.size > EVENT_OVERLAY_SCOPE_QUERY_LIMIT) {
    return [];
  }
  return Array.from(byKey.keys())
    .sort()
    .map((key: string): ScopeQuery => {
      return byKey.get(key)!;
    });
}

function addPredicate(
  queries: Array<ScopeQuery>,
  path: Array<string>,
  values: Array<string>,
): Array<ScopeQuery> {
  if (queries.length * values.length > EVENT_OVERLAY_SCOPE_QUERY_LIMIT) {
    return [];
  }
  const next: Array<ScopeQuery> = [];
  for (const query of queries) {
    for (const value of values) {
      const copy: ScopeQuery = JSON.parse(JSON.stringify(query)) as ScopeQuery;
      let cursor: ScopeQuery = copy;
      for (const key of path.slice(0, -1)) {
        if (!cursor[key]) {
          cursor[key] = {};
        }
        cursor = cursor[key] as ScopeQuery;
      }
      const leaf: string = path[path.length - 1]!;
      if (cursor[leaf] !== undefined && cursor[leaf] !== value) {
        continue;
      }
      cursor[leaf] = value;
      next.push(copy);
    }
  }
  return dedupeQueries(next);
}

function hasAny(attributes: Attributes, keys: ReadonlyArray<string>): boolean {
  return keys.some((key: string): boolean => {
    return Object.prototype.hasOwnProperty.call(attributes, key);
  });
}

function nestParentScopes(queries: Array<ScopeQuery>): Array<ScopeQuery> {
  for (const query of queries) {
    for (const [parent, children, parentRelation] of [
      [
        "kubernetesClusters",
        ["kubernetesResources", "kubernetesContainers"],
        "kubernetesCluster",
      ],
      ["dockerHosts", ["dockerResources"], "dockerHost"],
      ["podmanHosts", ["podmanResources"], "podmanHost"],
    ] as Array<[string, Array<string>, string]>) {
      const parentScope: string | ScopeQuery | undefined = query[parent];
      if (!parentScope || typeof parentScope === "string") {
        continue;
      }
      let hasChild: boolean = false;
      for (const child of children) {
        const childScope: string | ScopeQuery | undefined = query[child];
        if (childScope && typeof childScope !== "string") {
          childScope[parentRelation] = parentScope;
          hasChild = true;
        }
      }
      if (hasChild) {
        /*
         * Match the child's own parent. A separately attached parent could
         * belong to another affected resource on a multi-resource incident.
         */
        delete query[parent];
      }
    }
  }
  return queries;
}

function buildQueryScope(config: MetricQueryConfigData): EventOverlayScope {
  if (
    config.eventScope !== undefined &&
    (!config.eventScope || Object.keys(config.eventScope).length === 0)
  ) {
    return { incidentQueries: [], alertQueries: [], changeEventQueries: [] };
  }
  const filterData: Attributes = (config.metricQueryData?.filterData ||
    {}) as Attributes;
  const attributes: Attributes = {
    ...((filterData["attributes"] || {}) as Attributes),
    ...(config.eventScope || {}),
  };
  /*
   * Support callers that already hold an analytics/entity scope. These fields
   * are not normally present in MetricView's attribute-only query grammar.
   */
  for (const key of [
    "primaryEntityId",
    "primaryEntityType",
    ...UNSUPPORTED_RESOURCE_KEYS,
  ]) {
    if (Object.prototype.hasOwnProperty.call(filterData, key)) {
      attributes[key] = filterData[key];
    }
  }

  /*
   * Explicit event scope survives resource-row navigation and takes priority
   * over presentation attributes, including polymorphic analytics ids.
   */
  Object.assign(attributes, config.eventScope || {});

  let incidentQueries: Array<ScopeQuery> = [{}];
  let alertQueries: Array<ScopeQuery> = [{}];
  let changeEventQueries: Array<ScopeQuery> = [{}];
  const consumedKeys: Set<string> = new Set();
  let isScoped: boolean = false;

  const apply: (
    key: string,
    incidentPath: Array<string> | null,
    alertPath: Array<string> | null,
    isId?: boolean,
    changePath?: Array<string>,
  ) => void = (
    key: string,
    incidentPath: Array<string> | null,
    alertPath: Array<string> | null,
    isId: boolean = false,
    changePath: Array<string> = ["attributes", key],
  ): void => {
    if (!Object.prototype.hasOwnProperty.call(attributes, key)) {
      return;
    }
    isScoped = true;
    consumedKeys.add(key);
    const values: Array<string> | null = exactValues(attributes[key], isId);
    if (
      !values ||
      (isId &&
        values.some((value: string): boolean => {
          return !ObjectID.isValidUUID(value);
        }))
    ) {
      incidentQueries = [];
      alertQueries = [];
      changeEventQueries = [];
      return;
    }
    incidentQueries = incidentPath
      ? addPredicate(incidentQueries, incidentPath, values)
      : [];
    alertQueries = alertPath
      ? addPredicate(alertQueries, alertPath, values)
      : [];
    changeEventQueries = addPredicate(changeEventQueries, changePath, values);
  };

  const runtimeKey: string | undefined = attributeAliases(
    "container.runtime",
  ).find((key: string): boolean => {
    return Object.prototype.hasOwnProperty.call(attributes, key);
  });
  const runtimes: Array<string> | null = runtimeKey
    ? exactValues(attributes[runtimeKey])
    : null;
  const runtime: string | undefined =
    runtimes?.length === 1 ? runtimes[0] : undefined;
  const runtimeRelation: string | undefined =
    runtime === "docker"
      ? "dockerHosts"
      : runtime === "podman"
        ? "podmanHosts"
        : undefined;

  for (const mapping of RESOURCE_MAPPINGS) {
    for (const key of mapping.ids) {
      apply(
        key,
        [mapping.relation, "_id"],
        mapping.relation === "monitors"
          ? ["monitorId"]
          : [mapping.relation, "_id"],
        true,
        mapping.relation === "services" ? ["primaryEntityId"] : undefined,
      );
    }
    for (const key of mapping.names || []) {
      const relation: string =
        mapping.relation === "hosts" && runtimeRelation
          ? runtimeRelation
          : mapping.relation;
      apply(
        key,
        [relation, mapping.nameColumn!],
        [relation, mapping.nameColumn!],
      );
    }
  }

  /*
   * OTel host.id is the reported machine ID, distinct from the database UUID
   * and from hostIdentifier (which stores the canonical host.name).
   */
  for (const key of attributeAliases("host.id")) {
    apply(key, ["hosts", "hostId"], ["hosts", "hostId"]);
  }

  for (const key of ["incidentId", "incidentIds"]) {
    apply(key, ["_id"], null, true);
  }
  for (const key of ["alertId", "alertIds"]) {
    apply(key, null, ["_id"], true);
  }
  for (const key of attributeAliases("service.namespace")) {
    apply(
      key,
      ["services", "serviceNamespace"],
      ["services", "serviceNamespace"],
    );
  }

  if (
    Object.prototype.hasOwnProperty.call(attributes, "primaryEntityId") ||
    Object.prototype.hasOwnProperty.call(attributes, "primaryEntityType")
  ) {
    isScoped = true;
    consumedKeys.add("primaryEntityId");
    consumedKeys.add("primaryEntityType");
    const types: Array<string> | null = exactValues(
      attributes["primaryEntityType"],
    );
    const ids: Array<string> | null = exactValues(
      attributes["primaryEntityId"],
    );
    const type: ServiceType | undefined =
      types?.length === 1 ? (types[0] as ServiceType) : undefined;
    const relation: string | undefined = type
      ? PRIMARY_TYPE_RELATIONS[type]
      : undefined;
    if (
      !ids ||
      ids.length === 0 ||
      ids.some((id: string): boolean => {
        return !ObjectID.isValidUUID(id);
      }) ||
      (!relation && type !== ServiceType.Incident && type !== ServiceType.Alert)
    ) {
      incidentQueries = [];
      alertQueries = [];
      changeEventQueries = [];
    } else {
      incidentQueries =
        type === ServiceType.Alert
          ? []
          : addPredicate(
              incidentQueries,
              type === ServiceType.Incident ? ["_id"] : [relation!, "_id"],
              ids,
            );
      alertQueries =
        type === ServiceType.Incident
          ? []
          : addPredicate(
              alertQueries,
              type === ServiceType.Alert
                ? ["_id"]
                : type === ServiceType.Monitor
                  ? ["monitorId"]
                  : [relation!, "_id"],
              ids,
            );
      changeEventQueries =
        type === ServiceType.OpenTelemetry
          ? addPredicate(changeEventQueries, ["primaryEntityId"], ids)
          : [];
    }
  }

  const clusterKeys: Array<string> = attributeAliases(
    "k8s.cluster.name",
    "oneuptime.kubernetes.cluster.name",
  );
  const hasKubernetesCluster: boolean = hasAny(attributes, [
    ...clusterKeys,
    "kubernetesClusterId",
    "kubernetesClusterIds",
  ]);
  for (const [kindKey, kind] of Object.entries(KUBERNETES_KINDS)) {
    for (const key of attributeAliases(`k8s.${kindKey}.name`)) {
      if (!Object.prototype.hasOwnProperty.call(attributes, key)) {
        continue;
      }
      if (
        kindKey === "pod" &&
        hasAny(
          attributes,
          attributeAliases("k8s.container.name", "container.name"),
        )
      ) {
        apply(
          key,
          ["kubernetesContainers", "podName"],
          ["kubernetesContainers", "podName"],
        );
        continue;
      }
      /*
       * A namespace accompanying a workload constrains that workload's
       * namespace; it must not require a separate Namespace incident link.
       */
      const hasWorkload: boolean =
        Object.keys(KUBERNETES_KINDS).some((other: string): boolean => {
          return (
            other !== "namespace" &&
            hasAny(attributes, attributeAliases(`k8s.${other}.name`))
          );
        }) ||
        hasAny(
          attributes,
          attributeAliases("k8s.container.name", "container.name"),
        );
      if (kindKey === "namespace" && hasWorkload) {
        const relation: string = hasAny(
          attributes,
          attributeAliases("k8s.container.name", "container.name"),
        )
          ? "kubernetesContainers"
          : "kubernetesResources";
        apply(
          key,
          [
            relation,
            relation === "kubernetesContainers"
              ? "podNamespaceKey"
              : "namespaceKey",
          ],
          [
            relation,
            relation === "kubernetesContainers"
              ? "podNamespaceKey"
              : "namespaceKey",
          ],
        );
        continue;
      }
      apply(
        key,
        ["kubernetesResources", "name"],
        ["kubernetesResources", "name"],
      );
      incidentQueries = addPredicate(
        incidentQueries,
        ["kubernetesResources", "kind"],
        [kind],
      );
      alertQueries = addPredicate(
        alertQueries,
        ["kubernetesResources", "kind"],
        [kind],
      );
    }
  }
  for (const key of attributeAliases("k8s.container.name")) {
    apply(
      key,
      ["kubernetesContainers", "name"],
      ["kubernetesContainers", "name"],
    );
  }
  for (const key of attributeAliases("k8s.pod.uid")) {
    apply(key, ["kubernetesResources", "uid"], ["kubernetesResources", "uid"]);
  }

  /*
   * Container names are reused on unrelated hosts. Keep the parent scope and
   * require the matching runtime before choosing the Docker/Podman relation.
   */
  for (const key of attributeAliases("container.name", "container.id")) {
    if (!Object.prototype.hasOwnProperty.call(attributes, key)) {
      continue;
    }
    if (hasKubernetesCluster) {
      const path: Array<string> = key.endsWith(".id")
        ? ["seriesLabels", key]
        : ["kubernetesContainers", "name"];
      apply(key, path, path);
      continue;
    }
    const relation: string | undefined =
      runtime === "docker"
        ? "dockerResources"
        : runtime === "podman"
          ? "podmanResources"
          : undefined;
    apply(
      key,
      relation
        ? [relation, key.endsWith(".id") ? "containerId" : "name"]
        : null,
      relation
        ? [relation, key.endsWith(".id") ? "containerId" : "name"]
        : null,
    );
    if (relation) {
      incidentQueries = addPredicate(
        incidentQueries,
        [relation, "kind"],
        ["Container"],
      );
      alertQueries = addPredicate(
        alertQueries,
        [relation, "kind"],
        ["Container"],
      );
    }
  }

  /*
   * These children have no Incident/Alert relation of their own. Their parent
   * link plus the recorded breaching-series identity supplies the exact scope.
   */
  const childKeys: Array<string> = [
    ...(hasAny(
      attributes,
      attributeAliases("proxmox.cluster.name", "iot.fleet.name"),
    )
      ? ["id", "device.id"]
      : []),
    ...(hasAny(attributes, attributeAliases("ceph.cluster.name"))
      ? ["ceph_daemon", "pool_id", "pool_name"]
      : []),
    ...attributeAliases(
      "vcenter.host.name",
      "vcenter.cluster.name",
      "vcenter.vm.id",
      "vcenter.vm.name",
      "vcenter.vm_template.id",
      "vcenter.vm_template.name",
      "vcenter.datastore.name",
      "vcenter.datacenter.name",
      "vcenter.resource_pool.name",
      "vcenter.resource_pool.inventory_path",
      "container.image.name",
      "service.instance.id",
    ),
  ];
  for (const key of childKeys) {
    apply(key, ["seriesLabels", key], ["seriesLabels", key]);
  }

  if (runtimeKey) {
    consumedKeys.add(runtimeKey);
    if (
      !isScoped ||
      !runtimes ||
      runtimes.length === 0 ||
      (!runtimeRelation && !hasKubernetesCluster)
    ) {
      incidentQueries = [];
      alertQueries = [];
    }
    isScoped = true;
    changeEventQueries = runtimes
      ? addPredicate(changeEventQueries, ["attributes", runtimeKey], runtimes)
      : [];
  }

  for (const key of UNSUPPORTED_RESOURCE_KEYS) {
    if (
      !consumedKeys.has(key) &&
      Object.prototype.hasOwnProperty.call(attributes, key)
    ) {
      isScoped = true;
      consumedKeys.add(key);
      incidentQueries = [];
      alertQueries = [];
      const values: Array<string> | null =
        key === "entityScope" ? null : exactValues(attributes[key]);
      changeEventQueries = values
        ? addPredicate(changeEventQueries, ["attributes", key], values)
        : [];
    }
  }

  if (
    config.eventScope !== undefined &&
    (!isScoped ||
      Object.keys(config.eventScope).some((key: string): boolean => {
        return !consumedKeys.has(key);
      }))
  ) {
    /*
     * Metadata declares a resource context even when its natural identity is
     * not supported here. Do not reinterpret that context as the whole project
     * or silently drop a child identity while keeping only its parent scope.
     */
    return { incidentQueries: [], alertQueries: [], changeEventQueries: [] };
  }

  /*
   * Empty/malformed resource scope is deliberately not converted back into
   * project-wide markers. Only charts with no resource filter are unscoped.
   */
  return {
    incidentQueries: dedupeQueries(nestParentScopes(incidentQueries)) as Array<
      Query<Incident>
    >,
    alertQueries: dedupeQueries(nestParentScopes(alertQueries)) as Array<
      Query<Alert>
    >,
    changeEventQueries: dedupeQueries(changeEventQueries) as Array<
      Query<ChangeEvent>
    >,
  };
}

export function getEventOverlayScope(
  queryConfigs: Array<MetricQueryConfigData> | undefined,
): EventOverlayScope {
  if (!queryConfigs || queryConfigs.length === 0) {
    return {
      incidentQueries: [{}],
      alertQueries: [{}],
      changeEventQueries: [{}],
    };
  }
  const scopes: Array<EventOverlayScope> = [];
  for (const config of queryConfigs) {
    const scope: EventOverlayScope = buildQueryScope(config);
    const metricName: unknown = config.metricQueryData?.filterData?.metricName;
    const hasMetricName: boolean =
      typeof metricName === "string"
        ? metricName.trim().length > 0
        : Boolean(metricName);
    const isUnscoped: boolean =
      scope.incidentQueries.length === 1 &&
      scope.alertQueries.length === 1 &&
      scope.changeEventQueries.length === 1 &&
      Object.keys(scope.incidentQueries[0]!).length === 0 &&
      Object.keys(scope.alertQueries[0]!).length === 0 &&
      Object.keys(scope.changeEventQueries[0]!).length === 0;

    /*
     * Adding an unfinished query in Explorer must not widen an existing
     * resource's events. Scope-only consumers (such as log error details)
     * still work without a metric name when they supply resource identity.
     */
    if (!hasMetricName && config.eventScope === undefined && isUnscoped) {
      continue;
    }
    scopes.push(scope);
  }
  return {
    incidentQueries: dedupeQueries(
      scopes.flatMap((scope: EventOverlayScope): Array<ScopeQuery> => {
        return scope.incidentQueries as Array<ScopeQuery>;
      }),
    ) as Array<Query<Incident>>,
    alertQueries: dedupeQueries(
      scopes.flatMap((scope: EventOverlayScope): Array<ScopeQuery> => {
        return scope.alertQueries as Array<ScopeQuery>;
      }),
    ) as Array<Query<Alert>>,
    changeEventQueries: dedupeQueries(
      scopes.flatMap((scope: EventOverlayScope): Array<ScopeQuery> => {
        return scope.changeEventQueries as Array<ScopeQuery>;
      }),
    ) as Array<Query<ChangeEvent>>,
  };
}
