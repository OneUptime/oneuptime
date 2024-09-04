import CopilotActionTypePriority from "Common/Models/DatabaseModels/CopilotActionTypePriority";
import CopilotActionType from "Common/Types/Copilot/CopilotActionType";
import CopilotActionUtil from "./CopilotAction";
import { ActionDictionary } from "../Service/CopilotActions/Index";

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
}
