import ProjectReferencesService from "./ProjectReferencesService";
import CloudResourceService from "./CloudResourceService";
import DatabaseServerService from "./DatabaseServerService";
import DockerHostService from "./DockerHostService";
import KubernetesClusterService from "./KubernetesClusterService";
import PodmanHostService from "./PodmanHostService";
import ServiceService from "./ServiceService";
import Model from "../../Models/DatabaseModels/DataSecurityComplianceSetting";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ColumnLength from "../../Types/Database/ColumnLength";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { isComplianceFramework } from "../../Types/DataSecurity/ComplianceFramework";
import { isRequirementOf } from "../../Types/DataSecurity/ComplianceRequirementCatalog";
import {
  DataStoreResourceKind,
  isDataStoreResourceKind,
} from "../../Types/DataSecurity/DataStoreResource";
import { isKubernetesComplianceRequirement } from "../../Types/Kubernetes/Compliance/KubernetesComplianceCatalog";
import {
  isKubernetesComplianceFramework,
  isKubernetesNamespaceName,
} from "../../Types/Kubernetes/Compliance/KubernetesComplianceFramework";

/*
 * What a resource turned off of a compliance framework (#9555,
 * Types/DataSecurity/ComplianceScope). A setting names a resource of the
 * project, one of the frameworks Data Security scores and, when it is about
 * one requirement, a requirement that framework has; and there is one per
 * resource, framework and requirement, which is changed rather than made
 * twice. Compliance is worked out when it is read, so nothing is queued.
 *
 * A Kubernetes cluster's own frameworks - the Pod Security Standards and
 * the CIS Kubernetes Benchmark (#9627) - are set the same way, on a cluster
 * only, for a control they are scored on, and for the whole cluster or one
 * namespace: one setting per framework, control and namespace.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  // The requirement a setting names, trimmed: "" for its whole framework.
  public static readRequirement(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }

  // The namespace a setting names, trimmed: "" for the whole resource.
  public static readNamespace(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }

  /*
   * Why it does not apply (#9629), as it is stored: trimmed, and none for
   * an empty one. Its column holds ColumnLength.LongText characters, so a
   * longer one is refused in words rather than by the database.
   */
  public static readNote(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }

    const note: string = value.trim();

    if (note.length > ColumnLength.LongText) {
      throw new BadDataException(
        `Write the reason in ${ColumnLength.LongText} characters or fewer.`,
      );
    }

    return note || null;
  }

  // A reason in a write, read as it is stored; a write without one is left alone.
  private static normalizeNote(data: { note?: unknown }): void {
    if (data.note === undefined) {
      return;
    }

    data.note = Service.readNote(data.note);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const data: Model = createBy.data;

    if (!isDataStoreResourceKind(data.resourceType)) {
      throw new BadDataException(
        "Choose a resource: a Kubernetes cluster, a Docker or Podman host, a database, a cloud resource or a service.",
      );
    }

    if (!data.resourceId) {
      throw new BadDataException("Choose the resource this setting is for.");
    }

    const framework: unknown = data.framework;
    const requirement: string = Service.readRequirement(data.requirement);
    const namespace: string = Service.readNamespace(data.namespace);

    if (isKubernetesComplianceFramework(framework)) {
      /*
       * A Kubernetes cluster's own frameworks (#9627): on a cluster, for one
       * of their controls, and for the whole cluster or one namespace.
       */
      if (data.resourceType !== DataStoreResourceKind.KubernetesCluster) {
        throw new BadDataException(
          `${framework} scores a Kubernetes cluster. Choose a Kubernetes cluster for this setting.`,
        );
      }

      if (
        requirement &&
        !isKubernetesComplianceRequirement(framework, requirement)
      ) {
        throw new BadDataException(
          `${requirement} is not a control ${framework} is scored on. Choose one of its controls, or none for the whole framework.`,
        );
      }

      if (namespace && !isKubernetesNamespaceName(namespace)) {
        throw new BadDataException(
          `${namespace} is not a namespace's name. Write it as Kubernetes does: lowercase letters, digits and hyphens, at most 63 characters.`,
        );
      }
    } else if (isComplianceFramework(framework)) {
      if (requirement && !isRequirementOf(framework, requirement)) {
        throw new BadDataException(
          `${requirement} is not a requirement of ${framework}. Choose one of its requirements, or none for the whole framework.`,
        );
      }

      if (namespace) {
        throw new BadDataException(
          "Only a Kubernetes cluster's own frameworks can be turned off for one namespace. Leave the namespace empty.",
        );
      }
    } else {
      throw new BadDataException(
        "Choose one of the frameworks the Compliance pages score.",
      );
    }

    // Stored as the catalog names it, or empty for the whole framework.
    data.requirement = requirement || (null as unknown as string);
    // The namespace it is for, or empty for the whole resource.
    data.namespace = namespace || (null as unknown as string);

    Service.normalizeNote(data as unknown as { note?: unknown });

    const projectId: ObjectID | undefined =
      data.projectId || createBy.props.tenantId || undefined;

    if (!projectId) {
      throw new BadDataException("Choose the project this setting is for.");
    }

    if (
      !(await Service.isResourceOfProject({
        kind: data.resourceType,
        id: new ObjectID(data.resourceId.toString()),
        projectId,
      }))
    ) {
      throw new BadDataException(
        "This resource is not in this project. Choose one of the project's resources.",
      );
    }

    const existing: Array<Model> = await this.findBy({
      query: {
        projectId,
        resourceType: data.resourceType,
        resourceId: new ObjectID(data.resourceId.toString()),
        framework: data.framework,
      },
      select: { _id: true, requirement: true, namespace: true },
      skip: 0,
      limit: 1000,
      props: { isRoot: true },
    });

    if (
      existing.some((row: Model): boolean => {
        return (
          Service.readRequirement(row.requirement) === requirement &&
          Service.readNamespace(row.namespace) === namespace
        );
      })
    ) {
      throw new BadDataException(
        "This resource already has a setting for this. Change that setting instead.",
      );
    }

    return { createBy, carryForward: undefined };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const onUpdate: OnUpdate<Model> = await super.onBeforeUpdate(updateBy);

    Service.normalizeNote(
      onUpdate.updateBy.data as unknown as { note?: unknown },
    );

    return onUpdate;
  }

  /*
   * Who turned it off, and when (#9629), written once the create passed
   * every permission check: no caller may write either. A setting made off
   * - how the Dashboard turns a framework off for the first time - is
   * turned off by whoever made it. One made on is turned off by nobody.
   */
  @CaptureSpan()
  protected override async onCreatePermitted(
    onCreate: OnCreate<Model>,
  ): Promise<void> {
    await super.onCreatePermitted(onCreate);

    const data: Model = onCreate.createBy.data;

    if (data.isEnabled === true) {
      return;
    }

    data.turnedOffAt = OneUptimeDate.getCurrentDate();

    if (onCreate.createBy.props.userId) {
      data.turnedOffByUserId = onCreate.createBy.props.userId;
    }
  }

  /*
   * The same for a change: turning it off says who and when, unless it was
   * off already - the same switch saved again keeps when it was turned off
   * - and turning it on again says nobody. A reason written while it is off
   * changes neither.
   */
  @CaptureSpan()
  protected override async onUpdatePermitted(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    await super.onUpdatePermitted(updateBy);

    const isEnabled: unknown = (updateBy.data as { isEnabled?: unknown })
      .isEnabled;
    const stamps: {
      turnedOffAt?: Date | null;
      turnedOffByUserId?: ObjectID | null;
    } = updateBy.data as unknown as {
      turnedOffAt?: Date | null;
      turnedOffByUserId?: ObjectID | null;
    };

    if (isEnabled === true) {
      stamps.turnedOffAt = null;
      stamps.turnedOffByUserId = null;
      return;
    }

    if (isEnabled !== false) {
      return;
    }

    /*
     * Where each row the update writes stands now: the very rows it
     * writes, read in its own query, window and project, and the update
     * held to them (findRowsAndHoldUpdateToThem). So who and when are
     * decided on the rows written - never on a row of another project, or
     * one the caller may not change, that the query also names.
     */
    const current: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      { _id: true, isEnabled: true },
    );

    if (
      current.length > 0 &&
      current.every((row: Model): boolean => {
        return row.isEnabled !== true;
      })
    ) {
      return;
    }

    stamps.turnedOffAt = OneUptimeDate.getCurrentDate();
    stamps.turnedOffByUserId = updateBy.props.userId || null;
  }

  // Whether the record a setting names is the project's own.
  public static async isResourceOfProject(data: {
    kind: DataStoreResourceKind;
    id: ObjectID;
    projectId: ObjectID;
  }): Promise<boolean> {
    const query: { _id: string; projectId: ObjectID } = {
      _id: data.id.toString(),
      projectId: data.projectId,
    };
    const select: { _id: true } = { _id: true };
    const props: { isRoot: true } = { isRoot: true };

    switch (data.kind) {
      case DataStoreResourceKind.KubernetesCluster:
        return Boolean(
          await KubernetesClusterService.findOneBy({ query, select, props }),
        );
      case DataStoreResourceKind.DockerHost:
        return Boolean(
          await DockerHostService.findOneBy({ query, select, props }),
        );
      case DataStoreResourceKind.PodmanHost:
        return Boolean(
          await PodmanHostService.findOneBy({ query, select, props }),
        );
      case DataStoreResourceKind.DatabaseServer:
        return Boolean(
          await DatabaseServerService.findOneBy({ query, select, props }),
        );
      case DataStoreResourceKind.CloudResource:
        return Boolean(
          await CloudResourceService.findOneBy({ query, select, props }),
        );
      case DataStoreResourceKind.Service:
        return Boolean(
          await ServiceService.findOneBy({ query, select, props }),
        );
      default:
        return false;
    }
  }
}

export default new Service();
