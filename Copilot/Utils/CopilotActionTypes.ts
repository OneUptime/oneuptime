import CopilotActionTypePriority from "Common/Models/DatabaseModels/CopilotActionTypePriority";
import CopilotActionType, {CopilotActionTypeUtil as ActionTypeUtil, CopilotActionTypeData} from "Common/Types/Copilot/CopilotActionType";
import CopilotActionUtil from "./CopilotAction";
import { ActionDictionary } from "../Service/CopilotActions/Index";
import logger from "Common/Server/Utils/Logger";

export default class CopilotActionTypeUtil {
  private static isActionEnabled(actionType: CopilotActionType): boolean {
    return Boolean(ActionDictionary[actionType]); // if action is not in dictionary then it is not enabled
  }

  public static async getEnabledActionTypesBasedOnPriority(): Promise<
    Array<CopilotActionTypePriority>
  > {
    // if there are no actions then, get actions based on priority
    const actionTypes: Array<CopilotActionTypePriority> =
      await CopilotActionUtil.getActionTypesBasedOnPriority();

    const enabledActions: Array<CopilotActionTypePriority> = [];

    for (const actionType of actionTypes) {
      if (this.isActionEnabled(actionType.actionType!)) {
        enabledActions.push(actionType);
      }
    }

    return enabledActions;
  }

  public static getItemsInQueueByPriority(priority: number): number {
    // so if the priority is 1, then there will be 5 items in queue. If the priority is 5, then there will be 1 item in queue.
    const itemsInQueue: number = 6;
    return itemsInQueue - priority;
  }

  public static printEnabledAndDisabledActionTypes(): void {
    const allActionTypes: Array<CopilotActionTypeData> = ActionTypeUtil.getAllCopilotActionTypes(); 

    // log all the actions from these actions that are in Action dictionary
    const enabledActionTypesData: Array<CopilotActionTypeData> = allActionTypes.filter(
      (actionTypeData: CopilotActionTypeData) => {
        return this.isActionEnabled(actionTypeData.type);
      },
    );

    const disabledActionTypesData: Array<CopilotActionTypeData> = allActionTypes.filter(
      (actionTypeData: CopilotActionTypeData) => {
        return !this.isActionEnabled(actionTypeData.type);
      },
    );

    logger.info("--------------------");
    logger.info("Copilot will fix the following issues:");
    for (const actionTypeData of enabledActionTypesData) {
      logger.info(`- ${actionTypeData.type}`);
    }

    logger.info("--------------------");
    logger.info("Copilot will not fix the following issues at this time (but we will in the future update of the software. We're working on this and they will be launched soon):");

    for (const disabledTypesData of disabledActionTypesData) {
      logger.info(`- ${disabledTypesData.type}`);
    }

    logger.info("--------------------");
  }
}
