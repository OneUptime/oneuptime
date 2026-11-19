import ProjectReferencesService from "./ProjectReferencesService";
import CloudResourceService from "./CloudResourceService";
import DatabaseServerService from "./DatabaseServerService";
import DockerHostService from "./DockerHostService";
import KubernetesClusterService from "./KubernetesClusterService";
import PodmanHostService from "./PodmanHostService";
import ServiceService from "./ServiceService";
import Model from "../../Models/DatabaseModels/DataSecurityComplianceSetting";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { isComplianceFramework } from "../../Types/DataSecurity/ComplianceFramework";
import { isRequirementOf } from "../../Types/DataSecurity/ComplianceRequirementCatalog";
import {
  DataStoreResourceKind,
  isDataStoreResourceKind,
} from "../../Types/DataSecurity/DataStoreResource";

/*
 * What a resource turned off of a compliance framework (#9555,
 * Types/DataSecurity/ComplianceScope). A setting names a resource of the
 * project, one of the frameworks Data Security scores and, when it is about
 * one requirement, a requirement that framework has; and there is one per
 * resource, framework and requirement, which is changed rather than made
 * twice. Compliance is worked out when it is read, so nothing is queued.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  // The requirement a setting names, trimmed: "" for its whole framework.
  public static readRequirement(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
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

    if (!isComplianceFramework(data.framework)) {
      throw new BadDataException(
        "Choose one of the frameworks Data Security scores.",
      );
    }

    const requirement: string = Service.readRequirement(data.requirement);

    if (requirement && !isRequirementOf(data.framework, requirement)) {
      throw new BadDataException(
        `${requirement} is not a requirement of ${data.framework}. Choose one of its requirements, or none for the whole framework.`,
      );
    }

    // Stored as the catalog names it, or empty for the whole framework.
    data.requirement = requirement || (null as unknown as string);

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
      select: { _id: true, requirement: true },
      skip: 0,
      limit: 1000,
      props: { isRoot: true },
    });

    if (
      existing.some((row: Model): boolean => {
        return Service.readRequirement(row.requirement) === requirement;
      })
    ) {
      throw new BadDataException(
        "This resource already has a setting for this. Change that setting instead.",
      );
    }

    return { createBy, carryForward: undefined };
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
