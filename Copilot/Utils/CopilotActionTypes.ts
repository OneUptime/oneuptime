import CopilotActionTypePriority from "Common/Models/DatabaseModels/CopilotActionTypePriority";
import CopilotActionType from "Common/Types/Copilot/CopilotActionType";
import CopilotActionUtil from "./CopilotAction";

export default class CopilotActionTypeUtil {
    private static isActionEnabled(actionType: CopilotActionType): boolean {
        if (actionType === CopilotActionType.ADD_COMMENTS) {
            return true;
        }

        if (actionType === CopilotActionType.IMPROVE_COMMENTS) {
            return true;
        }

        if (actionType === CopilotActionType.ADD_LOGS) {
            return true;
        }

        if (actionType === CopilotActionType.IMPROVE_LOGS) {
            return true;
        }

        // readme
        if (actionType === CopilotActionType.ADD_README) {
            return true;
        }

        if (actionType === CopilotActionType.IMPROVE_README) {
            return true;
        }

        return false;
    }

    public static async getEnabledActionTypesBasedOnPriority(

    ): Promise<Array<CopilotActionType>> {

        // if there are no actions then, get actions based on priority
        const actionTypes: Array<CopilotActionTypePriority> = await CopilotActionUtil.getActionTypesBasedOnPriority();

        const enabledActions: Array<CopilotActionType> = [];

        for (const actionType of actionTypes) {
            if (this.isActionEnabled(actionType.actionType!)) {
                enabledActions.push(actionType.actionType!);
            }
        }

        return enabledActions;
    }
}