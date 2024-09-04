import CopilotActionType from "../../Types/Copilot/CopilotActionType";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import Model from "Common/Models/DatabaseModels/CopilotActionTypePriority";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    // check if the action exits witht he same name exists in the same repo.

    const actionType: CopilotActionType | undefined = createBy.data.actionType;
    const codeRepositoryId: ObjectID | undefined =
      createBy.data.codeRepositoryId;

    if (!actionType) {
      throw new BadDataException("ActionType is required");
    }

    if (!codeRepositoryId) {
      throw new BadDataException("CodeRepositoryId is required");
    }

    const existingItem: Model | null = await this.findOneBy({
      query: {
        actionType,
        codeRepositoryId,
      },
      props: {
        isRoot: true,
      },
    });

    if (existingItem) {
      throw new BadDataException(
        "Action Type already exists for this repository.",
      );
    }

    // check if the priority is in between 1 and 5.

    const priority: number | undefined = createBy.data.priority;

    if (!priority) {
      throw new BadDataException("Priority is required");
    }

    if (priority < 1 || priority > 5) {
      throw new BadDataException("Priority must be between 1 and 5");
    }

    return {
      createBy: createBy,
      carryForward: null,
    };
  }
}

export default new Service();
