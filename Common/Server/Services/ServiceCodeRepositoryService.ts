import BadDataException from "../../Types/Exception/BadDataException";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/ServiceCodeRepository";
import ServiceModel from "../../Models/DatabaseModels/Service";
import CodeRepository from "../../Models/DatabaseModels/CodeRepository";
import ServiceService from "./ServiceService";
import CodeRepositoryService from "./CodeRepositoryService";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import {
  ServiceRepoLinkSuggestion,
  computeLinkSuggestions,
} from "../Utils/CodeRepository/ServiceRepoLinkSuggester";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Deterministic service ↔ repository link suggestions for the project,
   * computed from name similarity (see ServiceRepoLinkSuggester). Queries
   * run with the CALLER's props, so tenant scoping and read permissions are
   * enforced by the model ACLs, not re-implemented here.
   */
  @CaptureSpan()
  public async getSuggestedLinks(
    props: DatabaseCommonInteractionProps,
  ): Promise<Array<ServiceRepoLinkSuggestion>> {
    if (!props.tenantId) {
      throw new BadDataException("Project ID is required");
    }

    const projectId: ObjectID = props.tenantId;

    const [services, repositories, existingLinks]: [
      Array<ServiceModel>,
      Array<CodeRepository>,
      Array<Model>,
    ] = await Promise.all([
      ServiceService.findBy({
        query: {
          projectId,
        },
        select: {
          _id: true,
          name: true,
        },
        sort: {
          name: SortOrder.Ascending,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props,
      }),
      CodeRepositoryService.findBy({
        query: {
          projectId,
        },
        select: {
          _id: true,
          name: true,
          repositoryName: true,
          organizationName: true,
        },
        sort: {
          name: SortOrder.Ascending,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props,
      }),
      this.findBy({
        query: {
          projectId,
        },
        select: {
          _id: true,
          serviceId: true,
          codeRepositoryId: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props,
      }),
    ]);

    return computeLinkSuggestions({
      services: services
        .filter((service: ServiceModel) => {
          return Boolean(service.id && service.name);
        })
        .map((service: ServiceModel) => {
          return {
            id: service.id!.toString(),
            name: service.name!,
          };
        }),
      repositories: repositories
        .filter((repository: CodeRepository) => {
          return Boolean(repository.id);
        })
        .map((repository: CodeRepository) => {
          return {
            id: repository.id!.toString(),
            name: repository.name || "",
            repositoryName: repository.repositoryName || "",
            organizationName: repository.organizationName || "",
          };
        }),
      existingLinks: existingLinks
        .filter((link: Model) => {
          return Boolean(link.serviceId && link.codeRepositoryId);
        })
        .map((link: Model) => {
          return {
            serviceId: link.serviceId!.toString(),
            codeRepositoryId: link.codeRepositoryId!.toString(),
          };
        }),
    });
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.data.serviceId && !createBy.data.service) {
      throw new BadDataException("service is required");
    }

    if (!createBy.data.codeRepository && !createBy.data.codeRepositoryId) {
      throw new BadDataException("codeRepository is required");
    }

    const serviceId: string | ObjectID | undefined =
      createBy.data.serviceId || createBy.data.service?._id;
    const codeRepositoryId: string | ObjectID | undefined =
      createBy.data.codeRepositoryId || createBy.data.codeRepository?._id;

    // check if this code repository is already added to the service for this service.
    const existingCodeRepository: Model | null = await this.findOneBy({
      query: {
        serviceId: serviceId as ObjectID,
        codeRepositoryId: codeRepositoryId as ObjectID,
      },
      props: {
        isRoot: true,
      },
    });

    if (existingCodeRepository) {
      throw new BadDataException(
        "Code Repository already exists for this service",
      );
    }

    return {
      carryForward: null,
      createBy: createBy,
    };
  }
}

export default new Service();
