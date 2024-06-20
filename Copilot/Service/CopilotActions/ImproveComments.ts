import CopilotActionType from "Common/Types/Copilot/CopilotActionType";
import CopilotActionBase, { CopilotActionPrompt } from "./CopilotActionsBase";

export default class ImproveComments extends CopilotActionBase {
  public constructor() {
    super({
      copilotActionType: CopilotActionType.IMPROVE_COMMENTS,
    });
  }

  protected override async _getPrompt(): Promise<CopilotActionPrompt> {
    const prompt: string = `Please improve the comments in this code. 
          Please only comment code that is hard to understand. 
          If you do not find any code that is hard to understand, then please do not add any comments.
    Please only reply with code and nothing else. 
    
    Here is the code: 
    
    {{code}}
                `;

    return {
      prompt: prompt,
    };
  }
}
