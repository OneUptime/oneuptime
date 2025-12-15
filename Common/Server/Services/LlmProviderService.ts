import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/LlmProvider";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import ObjectID from "../../Types/ObjectID";
import UpdateBy from "../Types/Database/UpdateBy";
import QueryHelper from "../Types/Database/QueryHelper";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    // When creating a new LLM provider, set it as default by default
    if (createBy.data.isDefault === undefined) {
      createBy.data.isDefault = true;
    }

    // If this provider is being set as default, unset other defaults in the same project
    if (createBy.data.isDefault && createBy.data.projectId) {
      await this.updateBy({
        query: {
          projectId: createBy.data.projectId,
          isDefault: true,
        },
        data: {
          isDefault: false,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
      });
    }

    return { createBy, carryForward: null };
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    // If setting isDefault to true, we need to unset other defaults in the same project
    if (updateBy.data.isDefault === true) {
      // Get the items being updated to find their project IDs
      const itemsToUpdate: Array<Model> = await this.findBy({
        query: updateBy.query,
        select: {
          _id: true,
          projectId: true,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
      });

      // Collect unique project IDs
      const projectIds: Set<string> = new Set();
      const itemIds: Set<string> = new Set();
      for (const item of itemsToUpdate) {
        if (item.projectId) {
          projectIds.add(item.projectId.toString());
        }
        if (item._id) {
          itemIds.add(item._id);
        }
      }

      // For each project, unset the default on other providers
      for (const projectIdStr of projectIds) {
        const projectId: ObjectID = new ObjectID(projectIdStr);
        await this.updateBy({
          query: {
            projectId: projectId,
            isDefault: true,
            _id: QueryHelper.notInOrNull(Array.from(itemIds)),
          },
          data: {
            isDefault: false,
          },
          props: {
            isRoot: true,
          },
          limit: LIMIT_MAX,
          skip: 0,
        });
      }
    }

    return { updateBy, carryForward: null };
  }

  @CaptureSpan()
  public async getLLMProviderForProject(
    projectId: ObjectID,
  ): Promise<Model | null> {
    // First try to get the default provider for the project
    let provider: Model | null = await this.findOneBy({
      query: {
        projectId: projectId,
        isDefault: true,
      },
      select: {
        llmType: true,
        apiKey: true,
        baseUrl: true,
        modelName: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (provider) {
      return provider;
    }

    // If no default provider, get any global provider for the project.
    provider = await this.findOneBy({
      query: {
        projectId: QueryHelper.isNull(),
        isGlobalLlm: true,
      },
      select: {
        llmType: true,
        apiKey: true,
        baseUrl: true,
        modelName: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (provider) {
      return provider;
    }

    return null;
  }
}

export default new Service();
