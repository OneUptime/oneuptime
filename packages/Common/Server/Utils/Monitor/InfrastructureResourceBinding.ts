import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { JSONObject } from "../../../Types/JSON";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { canonicalizeEntityValue } from "../../../Utils/Telemetry/EntityKey";
import QueryHelper from "../../Types/Database/QueryHelper";
import CaptureSpan from "../Telemetry/CaptureSpan";
import logger from "../Logger";

/*
 * WHICH RESOURCE AN INFRASTRUCTURE MONITOR WATCHES, BY ITS ID.
 *
 * A step names its host, cluster, vCenter, array or fleet by the value its
 * telemetry is matched on (the host name, the cluster's name...), and the
 * worker filters on that value. A resource's matched value can change: a
 * person renames a Proxmox cluster, a vCenter or a Ceph cluster on its
 * Settings page (the agentless VMware probe then stamps the new name), or
 * edits a host's host name. A step that only held the old value read
 * nothing from then on, and nothing said why. And ingest stores host names
 * trimmed and lowercased, so a Host, Docker or Podman step typed "Web-01"
 * never matched the "web-01" its telemetry carries.
 *
 * So a step also keeps the resource's id (`resourceId`):
 *   - every write of a monitor binds it. A step whose value the write leaves
 *     as it was keeps the resource it is bound to, renamed or not; a new or
 *     changed value is bound to the resource it names (case and spaces
 *     aside); a value that names none has no id. The value a client wrote
 *     is kept as written - Terraform holds a monitor to its config, value
 *     for value - except that a client sending the id back unchanged (the
 *     dashboard) takes the bound resource's current value;
 *   - the worker reads the resource's current value before every
 *     evaluation (by its id, else by its value, case aside), so a rename or
 *     a host name's case keeps the monitor on its resource without anyone
 *     saving it again, and so do incidents' and alerts' resource links
 *     (MonitorResourceContext);
 *   - the BindInfrastructureMonitorSteps data migration binds every stored
 *     monitor once, changing no value.
 *
 * Host names are compared as ingest stores them: trimmed and lowercased
 * (canonicalizeEntityValue), for Host, Docker and Podman monitors alike.
 */

interface ResourceKey {
  // The step's sub-config, and the field naming the resource in it.
  stepKey: string;
  identifierField: string;
  // The resource's column its telemetry is matched on.
  matchColumn: string;
  // host.name: ingest stores it trimmed and lowercased.
  isCanonicalHostName: boolean;
  loadService: () => Promise<ResourceService>;
}

// The part of a DatabaseService this reads.
interface ResourceService {
  findOneBy: (data: unknown) => Promise<BaseModel | null>;
  findOneById: (data: unknown) => Promise<BaseModel | null>;
}

const asService: (module: { default: unknown }) => ResourceService = (module: {
  default: unknown;
}): ResourceService => {
  return module.default as ResourceService;
};

/*
 * Loaded on first use: the resource services import the monitor service,
 * which imports this.
 */
export const RESOURCE_KEYS: Partial<Record<MonitorType, ResourceKey>> = {
  [MonitorType.Host]: {
    stepKey: "hostMonitor",
    identifierField: "hostIdentifier",
    matchColumn: "hostIdentifier",
    isCanonicalHostName: true,
    loadService: async () => {
      return asService(await import("../../Services/HostService"));
    },
  },
  [MonitorType.Docker]: {
    stepKey: "dockerMonitor",
    identifierField: "hostIdentifier",
    matchColumn: "hostIdentifier",
    isCanonicalHostName: true,
    loadService: async () => {
      return asService(await import("../../Services/DockerHostService"));
    },
  },
  [MonitorType.Podman]: {
    stepKey: "podmanMonitor",
    identifierField: "hostIdentifier",
    matchColumn: "hostIdentifier",
    isCanonicalHostName: true,
    loadService: async () => {
      return asService(await import("../../Services/PodmanHostService"));
    },
  },
  [MonitorType.Kubernetes]: {
    stepKey: "kubernetesMonitor",
    identifierField: "clusterIdentifier",
    matchColumn: "clusterIdentifier",
    isCanonicalHostName: false,
    loadService: async () => {
      return asService(await import("../../Services/KubernetesClusterService"));
    },
  },
  [MonitorType.DockerSwarm]: {
    stepKey: "dockerSwarmMonitor",
    identifierField: "clusterIdentifier",
    matchColumn: "name",
    isCanonicalHostName: false,
    loadService: async () => {
      return asService(
        await import("../../Services/DockerSwarmClusterService"),
      );
    },
  },
  [MonitorType.Proxmox]: {
    stepKey: "proxmoxMonitor",
    identifierField: "clusterIdentifier",
    matchColumn: "name",
    isCanonicalHostName: false,
    loadService: async () => {
      return asService(await import("../../Services/ProxmoxClusterService"));
    },
  },
  [MonitorType.VMware]: {
    stepKey: "vmwareMonitor",
    identifierField: "vcenterIdentifier",
    matchColumn: "name",
    isCanonicalHostName: false,
    loadService: async () => {
      return asService(await import("../../Services/VMwareVCenterService"));
    },
  },
  [MonitorType.Ceph]: {
    stepKey: "cephMonitor",
    identifierField: "clusterIdentifier",
    matchColumn: "name",
    isCanonicalHostName: false,
    loadService: async () => {
      return asService(await import("../../Services/CephClusterService"));
    },
  },
  [MonitorType.StorageArray]: {
    stepKey: "storageArrayMonitor",
    identifierField: "arrayIdentifier",
    matchColumn: "name",
    isCanonicalHostName: false,
    loadService: async () => {
      return asService(await import("../../Services/StorageArrayService"));
    },
  },
  [MonitorType.IoTDevice]: {
    stepKey: "iotMonitor",
    identifierField: "fleetIdentifier",
    matchColumn: "name",
    isCanonicalHostName: false,
    loadService: async () => {
      return asService(await import("../../Services/IoTFleetService"));
    },
  },
};

// A step's resource as one side of a write has it.
export interface StepResource {
  identifier: string;
  resourceId?: string | undefined;
}

// What a binding settles for one step.
export interface StepBinding {
  identifier: string;
  resourceId: string | undefined;
}

// The same value, case and the spaces around it aside.
const isSameText: (a: string, b: string) => boolean = (
  a: string,
  b: string,
): boolean => {
  return (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();
};

const readStepResource: (
  key: ResourceKey,
  config: Record<string, unknown> | undefined,
) => StepResource | undefined = (
  key: ResourceKey,
  config: Record<string, unknown> | undefined,
): StepResource | undefined => {
  if (!config) {
    return undefined;
  }

  const identifier: unknown = config[key.identifierField];
  const resourceId: unknown = config["resourceId"];

  return {
    identifier: typeof identifier === "string" ? identifier : "",
    resourceId:
      typeof resourceId === "string" && resourceId ? resourceId : undefined,
  };
};

export default class InfrastructureResourceBinding {
  public static getResourceKey(
    monitorType: MonitorType | undefined,
  ): ResourceKey | undefined {
    return monitorType ? RESOURCE_KEYS[monitorType] : undefined;
  }

  // A step's value as the worker filters on it.
  public static normalize(key: ResourceKey, identifier: string): string {
    return key.isCanonicalHostName
      ? canonicalizeEntityValue(identifier || "")
      : (identifier || "").trim();
  }

  private static toObjectID(value: unknown): ObjectID | null {
    if (typeof value !== "string" || !value) {
      return null;
    }

    try {
      return new ObjectID(value);
    } catch {
      return null;
    }
  }

  private static readMatch(key: ResourceKey, row: BaseModel): string {
    const value: unknown = (row as unknown as Record<string, unknown>)[
      key.matchColumn
    ];

    return typeof value === "string" ? value : "";
  }

  // The project's resource with this id, when it still has a value.
  private static async findById(data: {
    key: ResourceKey;
    service: ResourceService;
    projectId: ObjectID;
    id: ObjectID;
  }): Promise<BaseModel | null> {
    const row: BaseModel | null = await data.service.findOneBy({
      query: { projectId: data.projectId, _id: data.id },
      select: { _id: true, [data.key.matchColumn]: true },
      props: { isRoot: true },
    });

    return row?._id && this.readMatch(data.key, row) ? row : null;
  }

  // The project's resource this value names, case and spaces aside.
  private static async findByValue(data: {
    key: ResourceKey;
    service: ResourceService;
    projectId: ObjectID;
    identifier: string;
  }): Promise<BaseModel | null> {
    const identifier: string = (data.identifier || "").trim();

    if (!identifier) {
      return null;
    }

    const row: BaseModel | null = await data.service.findOneBy({
      query: {
        projectId: data.projectId,
        [data.key.matchColumn]: QueryHelper.findWithSameText(identifier),
      },
      select: { _id: true, [data.key.matchColumn]: true },
      props: { isRoot: true },
    });

    return row?._id && this.readMatch(data.key, row) ? row : null;
  }

  /*
   * The resource a written step is bound to, and the value to keep (see the
   * comment at the top). `stored` is the step the write replaces; a create
   * has none. `keepValue` binds the id and changes no value (the data
   * migration).
   */
  @CaptureSpan()
  public static async bind(data: {
    projectId: ObjectID;
    monitorType: MonitorType;
    written: StepResource;
    stored?: StepResource | undefined;
    keepValue?: boolean | undefined;
  }): Promise<StepBinding> {
    const key: ResourceKey | undefined = this.getResourceKey(data.monitorType);
    const identifier: string = data.written.identifier;

    if (!key || !(identifier || "").trim()) {
      return { identifier, resourceId: data.written.resourceId };
    }

    const service: ResourceService = await key.loadService();

    const isValueKept: boolean = Boolean(
      data.stored && isSameText(data.stored.identifier, identifier),
    );
    const boundId: ObjectID | null = isValueKept
      ? this.toObjectID(data.written.resourceId || data.stored?.resourceId)
      : null;

    if (boundId) {
      const bound: BaseModel | null = await this.findById({
        key,
        service,
        projectId: data.projectId,
        id: boundId,
      });

      if (bound) {
        const current: string = this.readMatch(key, bound);
        const isCurrentAdopted: boolean =
          !data.keepValue &&
          Boolean(data.written.resourceId) &&
          this.normalize(key, current) !== this.normalize(key, identifier);

        return {
          identifier: isCurrentAdopted ? current : identifier,
          resourceId: bound._id!.toString(),
        };
      }
    }

    const matched: BaseModel | null = await this.findByValue({
      key,
      service,
      projectId: data.projectId,
      identifier,
    });

    return {
      identifier,
      resourceId: matched ? matched._id!.toString() : undefined,
    };
  }

  /*
   * Bind every step of a monitor's steps, in place; `storedMonitorSteps` are
   * the steps the write replaces, matched by step id. Returns whether any
   * step changed.
   */
  @CaptureSpan()
  public static async bindMonitorSteps(data: {
    projectId: ObjectID;
    monitorType: MonitorType | undefined;
    monitorSteps: MonitorSteps;
    storedMonitorSteps?: MonitorSteps | undefined;
  }): Promise<boolean> {
    const key: ResourceKey | undefined = this.getResourceKey(data.monitorType);

    if (!key) {
      return false;
    }

    const storedSteps: Array<MonitorStep> =
      data.storedMonitorSteps?.data?.monitorStepsInstanceArray || [];

    let changed: boolean = false;

    for (const step of data.monitorSteps.data?.monitorStepsInstanceArray ||
      []) {
      const stepId: string | undefined = step.data?.id;
      const storedStep: MonitorStep | undefined = stepId
        ? storedSteps.find((stored: MonitorStep): boolean => {
            return stored.data?.id === stepId;
          })
        : undefined;

      changed =
        (await this.bindStepConfig({
          projectId: data.projectId,
          monitorType: data.monitorType!,
          key,
          config: this.configOf(key, step.data),
          stored: readStepResource(key, this.configOf(key, storedStep?.data)),
          keepValue: false,
        })) || changed;
    }

    return changed;
  }

  /*
   * The data migration's path, on the stored JSON: each step is bound as a
   * write that leaves it as it is, and no value changes.
   */
  @CaptureSpan()
  public static async bindMonitorStepsJSON(data: {
    projectId: ObjectID;
    monitorType: MonitorType | undefined;
    monitorStepsJSON: JSONObject;
  }): Promise<boolean> {
    const key: ResourceKey | undefined = this.getResourceKey(data.monitorType);

    if (!key) {
      return false;
    }

    const value: JSONObject | undefined = data.monitorStepsJSON["value"] as
      | JSONObject
      | undefined;
    const steps: Array<JSONObject> = (value?.["monitorStepsInstanceArray"] ||
      []) as Array<JSONObject>;

    let changed: boolean = false;

    for (const step of steps) {
      const config: Record<string, unknown> | undefined = this.configOf(
        key,
        step["value"],
      );

      changed =
        (await this.bindStepConfig({
          projectId: data.projectId,
          monitorType: data.monitorType!,
          key,
          config,
          stored: readStepResource(key, config),
          keepValue: true,
        })) || changed;
    }

    return changed;
  }

  private static configOf(
    key: ResourceKey,
    stepData: unknown,
  ): Record<string, unknown> | undefined {
    if (!stepData || typeof stepData !== "object") {
      return undefined;
    }

    const config: unknown = (stepData as Record<string, unknown>)[key.stepKey];

    return config && typeof config === "object"
      ? (config as Record<string, unknown>)
      : undefined;
  }

  private static async bindStepConfig(data: {
    projectId: ObjectID;
    monitorType: MonitorType;
    key: ResourceKey;
    config: Record<string, unknown> | undefined;
    stored: StepResource | undefined;
    keepValue: boolean;
  }): Promise<boolean> {
    const written: StepResource | undefined = readStepResource(
      data.key,
      data.config,
    );

    if (!data.config || !written || !written.identifier.trim()) {
      return false;
    }

    const binding: StepBinding = await this.bind({
      projectId: data.projectId,
      monitorType: data.monitorType,
      written,
      stored: data.stored,
      keepValue: data.keepValue,
    });

    let changed: boolean = false;

    if (binding.identifier !== written.identifier) {
      data.config[data.key.identifierField] = binding.identifier;
      changed = true;
    }

    if (binding.resourceId !== written.resourceId) {
      if (binding.resourceId) {
        data.config["resourceId"] = binding.resourceId;
      } else {
        delete data.config["resourceId"];
      }
      changed = true;
    }

    return changed;
  }

  /*
   * The value of the resource a step watches now, as the worker filters on
   * it: its bound resource's, else the resource its value names (case
   * aside), else its own value - host names canonical in every case.
   * `byValue: false` skips the lookup by value (a caller that matches
   * values case-insensitively itself). Never throws: a failed read leaves
   * the step on its own value.
   */
  private static async currentValue(data: {
    key: ResourceKey;
    projectId: ObjectID;
    resource: StepResource;
    byValue: boolean;
  }): Promise<string> {
    const own: string = this.normalize(data.key, data.resource.identifier);

    if (!own) {
      return own;
    }

    const resourceId: ObjectID | null = this.toObjectID(
      data.resource.resourceId,
    );

    if (!resourceId && !data.byValue) {
      return own;
    }

    try {
      const service: ResourceService = await data.key.loadService();

      const bound: BaseModel | null = resourceId
        ? await this.findById({
            key: data.key,
            service,
            projectId: data.projectId,
            id: resourceId,
          })
        : null;

      const row: BaseModel | null =
        bound ||
        (data.byValue
          ? await this.findByValue({
              key: data.key,
              service,
              projectId: data.projectId,
              identifier: data.resource.identifier,
            })
          : null);

      return row
        ? this.normalize(data.key, this.readMatch(data.key, row))
        : own;
    } catch (err) {
      logger.warn(
        `InfrastructureResourceBinding: could not read the resource of a ${data.key.stepKey} step: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return own;
    }
  }

  /*
   * The step the worker evaluates: on its resource's current value. A copy;
   * the stored step is left as it is.
   */
  @CaptureSpan()
  public static async resolveForEvaluation(data: {
    projectId: ObjectID;
    monitorType: MonitorType;
    monitorStep: MonitorStep;
    byValue?: boolean | undefined;
  }): Promise<MonitorStep> {
    const key: ResourceKey | undefined = this.getResourceKey(data.monitorType);

    if (!key) {
      return data.monitorStep;
    }

    const resource: StepResource | undefined = readStepResource(
      key,
      this.configOf(key, data.monitorStep.data),
    );

    if (!resource || !resource.identifier.trim()) {
      return data.monitorStep;
    }

    const current: string = await this.currentValue({
      key,
      projectId: data.projectId,
      resource,
      byValue: data.byValue !== false,
    });

    if (current === resource.identifier) {
      return data.monitorStep;
    }

    const copy: MonitorStep = MonitorStep.clone(data.monitorStep);
    const copyConfig: Record<string, unknown> | undefined = this.configOf(
      key,
      copy.data,
    );

    if (copyConfig) {
      copyConfig[key.identifierField] = current;
    }

    return copy;
  }

  /*
   * A monitor's steps on their resources' current values - for what names a
   * monitor's resources by value (MonitorResourceContext). Bound steps only:
   * those callers match values case-insensitively already. The same
   * instance when nothing changed.
   */
  @CaptureSpan()
  public static async resolveMonitorSteps(data: {
    projectId: ObjectID;
    monitorType: MonitorType | undefined;
    monitorSteps: MonitorSteps;
  }): Promise<MonitorSteps> {
    const key: ResourceKey | undefined = this.getResourceKey(data.monitorType);
    const steps: Array<MonitorStep> =
      data.monitorSteps.data?.monitorStepsInstanceArray || [];

    if (!key || steps.length === 0) {
      return data.monitorSteps;
    }

    let changed: boolean = false;
    const resolved: Array<MonitorStep> = [];

    for (const step of steps) {
      const resolvedStep: MonitorStep = await this.resolveForEvaluation({
        projectId: data.projectId,
        monitorType: data.monitorType!,
        monitorStep: step,
        byValue: false,
      });

      changed = changed || resolvedStep !== step;
      resolved.push(resolvedStep);
    }

    if (!changed) {
      return data.monitorSteps;
    }

    const copy: MonitorSteps = new MonitorSteps();
    copy.data = {
      ...data.monitorSteps.data!,
      monitorStepsInstanceArray: resolved,
    };

    return copy;
  }
}
