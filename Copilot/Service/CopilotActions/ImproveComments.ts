import CopilotActionType from "Common/Types/Copilot/CopilotActionType";
import CopilotActionBase, {
  CopilotActionPrompt,
  CopilotActionRunResult,
  CopilotActionVars,
} from "./CopilotActionsBase";

export default class ImproveComments extends CopilotActionBase {
  public constructor() {
    super({
      copilotActionType: CopilotActionType.IMPROVE_COMMENTS,
      acceptFileExtentions: [".ts", ".js", ".tsx", ".jsx"],
    });
  }

  public override async isNoOperation(data: {
    vars: CopilotActionVars;
    result: CopilotActionRunResult;
  }): Promise<boolean> {
    if (data.result.code.includes("--all-good--")) {
      return true;
    }

    return false;
  }

  protected override async _getPrompt(): Promise<CopilotActionPrompt> {
    const prompt: string = `Please improve the comments in this code. Please only comment code that is hard to understand. 

    If you think the code is already well commented, please reply with the following text:
    --all-good--
    
    Here is the code: 
    
    {{code}}
                `;

    const systemPrompt: string = `You are an expert programmer.`;

    return {
      prompt: prompt,
      systemPrompt: systemPrompt,
    };
  }
}
