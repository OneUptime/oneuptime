import CopilotActionType from "Common/Types/Copilot/CopilotActionType";
import CopilotActionBase, {
  CopilotActionPrompt,
  CopilotActionRunResult,
  CopilotActionVars,
} from "./CopilotActionsBase";

export default class FixGrammarAndSpelling extends CopilotActionBase {
  public constructor() {
    super({
      copilotActionType: CopilotActionType.FIX_GRAMMAR_AND_SPELLING,
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
    const prompt: string = `Please fix grammar and spelling in this code. 

    If you think the code is good and has no grammar or spelling mistakes, please reply with the following text:
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
