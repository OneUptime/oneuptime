import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseService from "./DatabaseService";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import Model from "Common/Models/DatabaseModels/ApiKeyPermission";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.data.apiKeyId) {
      throw new BadDataException("API Key ID is required to create permission");
    }

    if (!createBy.data.projectId) {
      throw new BadDataException("Project Id is required to create permission");
    }

    if (!createBy.data.permission) {
      throw new BadDataException("Permission is required to create permission");
    }

    // check if this permission is already assigned to this team and if yes then throw error.

    const isBlockPermission: boolean = createBy.data.isBlockPermission || false;

    const existingPermission: Model | null = await this.findOneBy({
      query: {
        apiKeyId: createBy.data.apiKeyId,
        projectId: createBy.data.projectId,
        permission: createBy.data.permission,
        isBlockPermission: isBlockPermission,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (existingPermission) {
      throw new BadDataException(
        "This permission is already assigned to this API Key",
      );
    }

    if (createBy.data.labels && createBy.data.labels.length > 0) {
      // check if the

      const existingPermission: Model | null = await this.findOneBy({
        query: {
          apiKeyId: createBy.data.apiKeyId,
          projectId: createBy.data.projectId,
          permission: createBy.data.permission,
          isBlockPermission: !isBlockPermission,
        },
        select: {
          _id: true,
          isBlockPermission: true,
          labels: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (existingPermission && (existingPermission.labels?.length || 0) > 0) {
        // if the permission in another block has labels, this permission cannot have labels.

        const blockName: string = existingPermission.isBlockPermission
          ? "block"
          : "allow";

        throw new BadDataException(
          `Restriction labels are already assigned to this permission in the ${blockName} permission list. To assign restriction labels to this permission, remove the restriction labels from the ${blockName} permission`,
        );
      }
    }

    return { createBy, carryForward: null };
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    if (updateBy.data.labels && updateBy.data.labels.length > 0) {
      const existingPermissions: Array<Model> = await this.findBy({
        query: updateBy.query,
        select: {
          _id: true,
          labels: true,
          isBlockPermission: true,
          projectId: true,
          apiKeyId: true,
          permission: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      for (const alreadySavedPermission of existingPermissions) {
        // check if the

        const isBlockPermission: boolean =
          alreadySavedPermission.isBlockPermission || false;

        const existingPermission: Model | null = await this.findOneBy({
          query: {
            apiKeyId: alreadySavedPermission.apiKeyId!,
            projectId: alreadySavedPermission.projectId!,
            permission: alreadySavedPermission.permission!,
            isBlockPermission: !isBlockPermission,
          },
          select: {
            _id: true,
            isBlockPermission: true,
            labels: true,
            permission: true,
          },
          props: {
            isRoot: true,
          },
        });

        if (
          existingPermission &&
          (existingPermission.labels?.length || 0) > 0
        ) {
          // if the permission in another block has labels, this permission cannot have labels.

          const blockName: string = existingPermission.isBlockPermission
            ? "block"
            : "allow";

          throw new BadDataException(
            `Restriction labels are already assigned to ${existingPermission.permission} in the ${blockName} permission list. To assign restriction labels to this permission, remove the restriction labels from the ${blockName} list.`,
          );
        }
      }
    }

    return { updateBy, carryForward: null };
  }
}

export default new Service();
