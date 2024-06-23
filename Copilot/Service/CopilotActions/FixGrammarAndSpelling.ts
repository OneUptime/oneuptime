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
      acceptFileExtentions: [".ts", ".js", ".tsx", ".jsx", '.md'],
    });
  }

  public override async isNoOperation(data: {
    vars: CopilotActionVars;
    result: CopilotActionRunResult;
  }): Promise<boolean> {
    if (data.result.code.includes("--all-good--")) {
      return true;
    }

    if (data.result.code.includes("does not contain") && data.result.code.includes("spelling mistakes")) {
      return true;
    }

    if (data.result.code.includes("does not contain") && data.result.code.includes("grammar")) {
      return true;
    }

    return false;
  }

  protected override async _getPrompt(): Promise<CopilotActionPrompt> {
    const prompt: string = `Please fix grammar and spelling in this file. 

    If you think the file is good and has no grammar or spelling mistakes, please reply with the following text:
    --all-good--
    
    Here is the file content: 
    
    {{code}}
                `;

    const systemPrompt: string = `You are an expert programmer. Here are your instructions:
- You will follow the instructions given by the user strictly.
- You will not deviate from the instructions given by the user.
- You will not change the code unnecessarily. For example you will not change the code structure, logic, quotes around strings, or functionality.`;

    return {
      prompt: prompt,
      systemPrompt: systemPrompt,
    };
  }
}
