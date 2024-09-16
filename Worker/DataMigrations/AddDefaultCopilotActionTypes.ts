import DataMigrationBase from "./DataMigrationBase";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import CopilotCodeRepository from "Common/Models/DatabaseModels/CopilotCodeRepository";
import CopilotCodeRepositoryService from "Common/Server/Services/CopilotCodeRepositoryService";
import {
  CopilotActionTypeData,
  CopilotActionTypeUtil,
} from "Common/Types/Copilot/CopilotActionType";
import CopilotActionTypePriority from "Common/Models/DatabaseModels/CopilotActionTypePriority";
import CopilotActionTypePriorityService from "Common/Server/Services/CopilotActionTypePriorityService";

export default class AddDefaultCopilotActionTypes extends DataMigrationBase {
  public constructor() {
    super("AddDefaultCopilotActionTypes");
  }

  public override async migrate(): Promise<void> {
    // get all the users with email isVerified true.

    const repositories: Array<CopilotCodeRepository> =
      await CopilotCodeRepositoryService.findBy({
        query: {},
        select: {
          _id: true,
          projectId: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: {
          isRoot: true,
        },
      });

    for (const repo of repositories) {
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
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
