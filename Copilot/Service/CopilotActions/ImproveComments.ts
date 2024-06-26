import CopilotActionType from "Common/Types/Copilot/CopilotActionType";
import CopilotActionBase, {
  CopilotActionPrompt,
  CopilotActionRunResult,
  CopilotProcess,
} from "./CopilotActionsBase";
import CodeRepositoryUtil from "../../Utils/CodeRepository";

export default class ImproveComments extends CopilotActionBase {
  public constructor() {
    super({
      copilotActionType: CopilotActionType.IMPROVE_COMMENTS,
      acceptFileExtentions: CodeRepositoryUtil.getCodeFileExtentions(),
    });
  }

  public override onAfterExecute(
    data: CopilotProcess,
  ): Promise<CopilotProcess> {
    return Promise.resolve(data);
  }

  public override async filterNoOperation(
    data: CopilotProcess,
  ): Promise<CopilotProcess> {
    const finalResult: CopilotActionRunResult = {
      files: {},
    };

    for (const filePath in data.result.files) {
      if (data.result.files[filePath]?.fileContent.includes("--all-good--")) {
        continue;
      }

      finalResult.files[filePath] = data.result.files[filePath]!;
    }

    return {
      ...data,
      result: finalResult,
    };
  }

  protected override async _getPrompt(
    _data: CopilotProcess,
  ): Promise<CopilotActionPrompt> {
    const prompt: string = `Please improve the comments in this code. Please only comment code that is hard to understand. 

    If you think the code is already well commented, please reply with the following text:
    --all-good--
    
    Here is the code. This is in {{fileLanguage}}: 
    
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
