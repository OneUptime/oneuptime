import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import ObjectID from "../../Types/ObjectID";
import Model from "Common/Models/DatabaseModels/CopilotCodeRepository";
import {
  CopilotActionTypeData,
  CopilotActionTypeUtil,
} from "../../Types/Copilot/CopilotActionType";
import CopilotActionTypePriority from "../../Models/DatabaseModels/CopilotActionTypePriority";
import CopilotActionTypePriorityService from "./CopilotActionTypePriorityService";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    createBy.data.secretToken = ObjectID.generate();

    return {
      carryForward: null,
      createBy: createBy,
    };
  }

  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    // add all the actions.

    const repo: Model = createdItem;

    const defaultCopilotActionTypes: Array<CopilotActionTypeData> =
      CopilotActionTypeUtil.getAllCopilotActionTypes();

    for (const defaultAction of defaultCopilotActionTypes) {
      const copilotActionTypePriority: CopilotActionTypePriority =
        new CopilotActionTypePriority();
      copilotActionTypePriority.projectId = repo.projectId!;
      copilotActionTypePriority.actionType = defaultAction.type;
      copilotActionTypePriority.priority = defaultAction.defaultPriority;
      copilotActionTypePriority.codeRepositoryId = repo.id!;

      await CopilotActionTypePriorityService.create({
        data: copilotActionTypePriority,
        props: {
          isRoot: true,
        },
      });
    }

    return createdItem;
  }
}

export default new Service();
