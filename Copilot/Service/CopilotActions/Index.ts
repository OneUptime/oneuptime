import CopilotActionType from "Common/Types/Copilot/CopilotActionType";
import ImproveComments from "./ImproveComments";
import Dictionary from "Common/Types/Dictionary";
import CopilotActionBase, {
  CopilotActionRunResult,
  CopilotActionVars,
} from "./CopilotActionsBase";
import BadDataException from "Common/Types/Exception/BadDataException";

const actionDictionary: Dictionary<CopilotActionBase> = {
  [CopilotActionType.IMPROVE_COMMENTS]: new ImproveComments(),
};

export default class CopilotActionService {
  public static async execute(data: {
    copilotActionType: CopilotActionType;
    vars: CopilotActionVars;
  }): Promise<CopilotActionRunResult> {
    if (!actionDictionary[data.copilotActionType]) {
      throw new BadDataException("Invalid CopilotActionType");
    }

    const action: CopilotActionBase = actionDictionary[
      data.copilotActionType
    ] as CopilotActionBase;

    return await action.execute({
      vars: data.vars,
    });
  }
}
