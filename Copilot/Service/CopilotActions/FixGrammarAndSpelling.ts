import CopilotActionType from "Common/Types/Copilot/CopilotActionType";
import CopilotActionBase, {
  CopilotActionPrompt,
  CopilotActionRunResult,
  CopilotActionVars,
} from "./CopilotActionsBase";
import CodeRepositoryUtil from "../../Utils/CodeRepository";

export default class FixGrammarAndSpelling extends CopilotActionBase {
  public constructor() {
    super({
      copilotActionType: CopilotActionType.FIX_GRAMMAR_AND_SPELLING,
      acceptFileExtentions: [
        ...CodeRepositoryUtil.getCodeFileExtentions(),
        ...CodeRepositoryUtil.getReadmeFileExtentions(),
      ],
    });
  }

  public override async filterNoOperation(data: {
    vars: CopilotActionVars;
    result: CopilotActionRunResult;
  }): Promise<CopilotActionRunResult> {

    const finalResult: CopilotActionRunResult = {
      files: {},
    };
    
    for(const filePath in data.result.files) {
      if(data.result.files[filePath]?.fileContent.includes("--all-good--")) {
        continue; 
      }

      if(data.result.files[filePath]?.fileContent.includes("does not contain") && data.result.files[filePath]?.fileContent.includes("spelling mistakes")) {
        continue; 
      }

      if(data.result.files[filePath]?.fileContent.includes("does not contain") && data.result.files[filePath]?.fileContent.includes("grammar")) {
        continue; 
      }

      finalResult.files[filePath] = data.result.files[filePath]!;
    }

    return finalResult;
  }

  protected override async _getPrompt(): Promise<CopilotActionPrompt> {
    const prompt: string = `Please fix grammar and spelling in this file. 

    If you think the file is good and has no grammar or spelling mistakes, please reply with the following text:
    --all-good--
    
    Here is the file content. This is in {{fileLanguage}}: 
    
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
