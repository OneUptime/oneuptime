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
  KUBERNETES_COMPLIANCE_OBJECT_KINDS,
  isClusterScopedComplianceObjectKind,
  isKubernetesAcceptanceInForce,
  isKubernetesComplianceFramework,
  isKubernetesComplianceObjectKind,
  isKubernetesNamespaceName,
  isKubernetesObjectName,
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
 *
 * And one Kubernetes object's failing finding can be accepted (#9874): a
 * setting that names the object - its kind, its name and, when a namespace
 * holds it, its namespace - for one control or the whole framework. It says
 * why, always: an accepted finding without a reason is refused. It may
 * expire, and then fails again. One setting per framework, control and
 * object.
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

  // The kind or the name of the object a setting accepts a finding of (#9874), trimmed.
  public static readObjectPart(value: unknown): string {
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

  /*
   * When an accepted finding fails again (#9874), as it is stored: a date,
   * none for an empty one. A value that is no date is refused in words.
   */
  public static readExpiry(value: unknown): Date | null {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    const expiresAt: Date =
      value instanceof Date ? value : new Date(value as string);

    if (
      Number.isNaN(expiresAt.getTime()) ||
      (typeof value !== "string" && !(value instanceof Date))
    ) {
      throw new BadDataException(
        "Write the expiry as a date and time, or leave it empty to keep the finding accepted until it is revoked.",
      );
    }

    return expiresAt;
  }

  // A reason in a write, read as it is stored; a write without one is left alone.
  private static normalizeNote(data: { note?: unknown }): void {
    if (data.note === undefined) {
      return;
    }

    data.note = Service.readNote(data.note);
  }

  // An expiry in a write, read as it is stored; a write without one is left alone.
  private static normalizeExpiry(data: { expiresAt?: unknown }): void {
    if (data.expiresAt === undefined) {
      return;
    }

    data.expiresAt = Service.readExpiry(data.expiresAt);
  }

  // An expiry set now must be one still to come.
  private static assertExpiryToCome(expiresAt: Date | null): void {
    if (
      expiresAt &&
      !isKubernetesAcceptanceInForce(expiresAt, OneUptimeDate.getCurrentDate())
    ) {
      throw new BadDataException(
        "Choose an expiry still to come, or none to keep the finding accepted until it is revoked.",
      );
    }
  }

  /*
   * The object an accepted finding names (#9874), checked and stored as a
   * finding names it: a kind a finding can name, a name Kubernetes allows,
   * the namespace a namespaced object is in - none for a ClusterRole or a
   * ClusterRoleBinding, and its own name for a Namespace.
   */
  private static checkAcceptedObject(data: Model, namespace: string): string {
    const objectKind: string = Service.readObjectPart(data.objectKind);
    const objectName: string = Service.readObjectPart(data.objectName);

    if (!isKubernetesComplianceObjectKind(objectKind)) {
      throw new BadDataException(
        `${objectKind || "That"} is not a kind of object a finding names. Choose one of ${KUBERNETES_COMPLIANCE_OBJECT_KINDS.join(", ")}.`,
      );
    }

    if (!isKubernetesObjectName(objectName)) {
      throw new BadDataException(
        "Name the object as Kubernetes does: at most 253 characters, with no slash or space.",
      );
    }

    data.objectKind = objectKind;
    data.objectName = objectName;

    if (isClusterScopedComplianceObjectKind(objectKind)) {
      if (namespace) {
        throw new BadDataException(
          `A ${objectKind} belongs to no namespace. Leave the namespace empty.`,
        );
      }

      return "";
    }

    if (objectKind === "Namespace") {
      if (namespace && namespace !== objectName) {
        throw new BadDataException(
          "A namespace's finding is the namespace's own. Name the namespace itself, or leave the namespace empty.",
        );
      }

      if (!isKubernetesNamespaceName(objectName)) {
        throw new BadDataException(
          `${objectName} is not a namespace's name. Write it as Kubernetes does: lowercase letters, digits and hyphens, at most 63 characters.`,
        );
      }

      return objectName;
    }

    if (!namespace) {
      throw new BadDataException(
        `Choose the namespace the ${objectKind} is in.`,
      );
    }

    return namespace;
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
    let namespace: string = Service.readNamespace(data.namespace);
    // A setting that names one object accepts that object's finding (#9874).
    const isAcceptance: boolean = Boolean(
      Service.readObjectPart(data.objectKind) ||
        Service.readObjectPart(data.objectName),
    );

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

      if (isAcceptance) {
        namespace = Service.checkAcceptedObject(data, namespace);
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

      if (isAcceptance) {
        throw new BadDataException(
          "Only a Kubernetes cluster's own frameworks accept one object's finding. Leave the object empty.",
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

    if (!isAcceptance) {
      data.objectKind = null as unknown as string;
      data.objectName = null as unknown as string;
    }

    Service.normalizeNote(data as unknown as { note?: unknown });
    Service.normalizeExpiry(data as unknown as { expiresAt?: unknown });

    if (isAcceptance) {
      // Accepted, it says why; made revoked, there is nothing to explain yet.
      if (data.isEnabled !== true && !data.note) {
        throw new BadDataException(
          "Say why this finding is accepted. The reason is kept with it, for whoever reviews it.",
        );
      }

      Service.assertExpiryToCome(data.expiresAt || null);
    } else if (data.expiresAt) {
      throw new BadDataException(
        "Only an accepted finding expires. Leave the expiry empty.",
      );
    }

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
      select: {
        _id: true,
        requirement: true,
        namespace: true,
        objectKind: true,
        objectName: true,
      },
      skip: 0,
      limit: 1000,
      props: { isRoot: true },
    });
    const objectKind: string = Service.readObjectPart(data.objectKind);
    const objectName: string = Service.readObjectPart(data.objectName);

    if (
      existing.some((row: Model): boolean => {
        return (
          Service.readRequirement(row.requirement) === requirement &&
          Service.readNamespace(row.namespace) === namespace &&
          Service.readObjectPart(row.objectKind) === objectKind &&
          Service.readObjectPart(row.objectName) === objectName
        );
      })
    ) {
      throw new BadDataException(
        isAcceptance
          ? "This finding already has an acceptance for this. Change that one instead."
          : "This resource already has a setting for this. Change that setting instead.",
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
    Service.normalizeExpiry(
      onUpdate.updateBy.data as unknown as { expiresAt?: unknown },
    );

    return onUpdate;
  }

  /*
   * Who turned it off, and when (#9629), written once the create passed
   * every permission check: no caller may write either. A setting made off
   * - how the Dashboard turns a framework off for the first time, and how
   * it accepts a finding (#9874) - is turned off by whoever made it. One
   * made on is turned off by nobody.
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
   *
   * An accepted finding (#9874) is accepted again by whoever turns it off
   * once it has expired: an expired acceptance accepts nothing. Accepted, it
   * keeps a reason, and only it may expire, at a date still to come.
   *
   * Each is decided on the rows the update writes, read in its own query,
   * window and project and the update held to them
   * (findRowsAndHoldUpdateToThem, UpdateChecksReadHeldRows): never on a row
   * of another project, or one the caller may not change, that the query
   * also names.
   */
  @CaptureSpan()
  protected override async onUpdatePermitted(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    await super.onUpdatePermitted(updateBy);

    const data: {
      isEnabled?: unknown;
      note?: unknown;
      expiresAt?: unknown;
      turnedOffAt?: Date | null;
      turnedOffByUserId?: ObjectID | null;
    } = updateBy.data as unknown as {
      isEnabled?: unknown;
      note?: unknown;
      expiresAt?: unknown;
      turnedOffAt?: Date | null;
      turnedOffByUserId?: ObjectID | null;
    };
    const isEnabled: unknown = data.isEnabled;
    const writesExpiry: boolean =
      data.expiresAt !== undefined && data.expiresAt !== null;
    const clearsNote: boolean = data.note !== undefined && !data.note;

    if (isEnabled === true) {
      data.turnedOffAt = null;
      data.turnedOffByUserId = null;
    }

    if (isEnabled !== false && !writesExpiry && !clearsNote) {
      return;
    }

    const current: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        isEnabled: true,
        objectName: true,
        note: true,
        expiresAt: true,
      },
    );
    const now: Date = OneUptimeDate.getCurrentDate();
    const isAcceptance: (row: Model) => boolean = (row: Model): boolean => {
      return Boolean(Service.readObjectPart(row.objectName));
    };

    if (writesExpiry) {
      if (
        current.some((row: Model): boolean => {
          return !isAcceptance(row);
        })
      ) {
        throw new BadDataException(
          "Only an accepted finding expires. Leave the expiry empty.",
        );
      }

      Service.assertExpiryToCome(data.expiresAt as Date);
    }

    // An acceptance that stays accepted keeps its reason.
    const staysAccepted: (row: Model) => boolean = (row: Model): boolean => {
      return (
        isAcceptance(row) &&
        (isEnabled === false || (isEnabled !== true && row.isEnabled !== true))
      );
    };

    if (clearsNote && current.some(staysAccepted)) {
      throw new BadDataException(
        "An accepted finding keeps its reason. Write why it is accepted, or revoke it.",
      );
    }

    if (isEnabled !== false) {
      return;
    }

    if (
      !data.note &&
      current.some((row: Model): boolean => {
        return isAcceptance(row) && !Service.readNote(row.note);
      })
    ) {
      throw new BadDataException(
        "Say why this finding is accepted. The reason is kept with it, for whoever reviews it.",
      );
    }

    // Off already, and - an acceptance - not expired: who and when stay.
    if (
      current.length > 0 &&
      current.every((row: Model): boolean => {
        return (
          row.isEnabled !== true &&
          (!isAcceptance(row) ||
            isKubernetesAcceptanceInForce(row.expiresAt, now))
        );
      })
    ) {
      return;
    }

    data.turnedOffAt = now;
    data.turnedOffByUserId = updateBy.props.userId || null;
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
