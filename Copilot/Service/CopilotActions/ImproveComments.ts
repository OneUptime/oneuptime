import CopilotActionType from "Common/Types/Copilot/CopilotActionType";
import CopilotActionBase, {
  CopilotActionPrompt,
  CopilotProcess,
  PromptRole,
} from "./CopilotActionsBase";
import CodeRepositoryUtil from "../../Utils/CodeRepository";
import ServiceLanguage from "Common/Types/ServiceCatalog/ServiceLanguage";
import { CopilotPromptResult } from "../LLM/LLMBase";
import CodeRepositoryFile from "CommonServer/Utils/CodeRepository/CodeRepositoryFile";

export default class ImproveComments extends CopilotActionBase {
  public isRequirementsMet: boolean = false;

  public constructor() {
    super();
    this.copilotActionType = CopilotActionType.IMPROVE_COMMENTS;
    this.acceptFileExtentions = CodeRepositoryUtil.getCodeFileExtentions();
  }

  public override isActionComplete(_data: CopilotProcess): Promise<boolean> {
    return Promise.resolve(this.isRequirementsMet);
  }

  public override async onExecutionStep(
    data: CopilotProcess,
  ): Promise<CopilotProcess> {
    // Action Prompt

    debugger;

    const codeParts: string[] = await this.splitInputCode({
      copilotProcess: data,
      itemSize: 500
    });

    let newContent: string = "";

    let isWellCommented = true;
    let didPassFileValidation = false; 

    for (const codePart of codeParts) {

      const actionPrompt: CopilotActionPrompt = await this.getPrompt(data, codePart);

      const copilotResult: CopilotPromptResult =
        await this.askCopilot(actionPrompt);

      const newCodePart: string = await this.cleanup({
        inputCode: codePart,
        outputCode: copilotResult.output as string,
      });

      if (!await this.isFileAlreadyWellCommented(newCodePart)) {
        isWellCommented = false;
      }

      const validationPrompt: CopilotActionPrompt =
        await this.getValidationPrompt({
          oldCode: codePart,
          newCode: newCodePart,
        });

      const validationResponse: CopilotPromptResult =
        await this.askCopilot(validationPrompt);

      const didPassValidation: boolean =
        await this.didPassValidation(validationResponse);

      if (!didPassValidation) {
        newContent = codePart;
        break;
      } else {
        didPassFileValidation = true;
        newContent += newCodePart + '\n';
      }
    }

    if (isWellCommented) {
      this.isRequirementsMet = true;
      return data;
    }

    newContent = newContent.trim();

    if (didPassFileValidation) {
      // add to result.
      data.result.files[data.input.currentFilePath] = {
        ...data.input.files[data.input.currentFilePath],
        fileContent: newContent,
      } as CodeRepositoryFile;

      this.isRequirementsMet = true;
      return data;
    }

    return data;
  }

  public async didPassValidation(data: CopilotPromptResult): Promise<boolean> {
    const validationResponse: string = data.output as string;
    if (validationResponse === "--no--") {
      return true;
    }

    return false;
  }

  public async isFileAlreadyWellCommented(content: string): Promise<boolean> {
    if (content.includes("--all-good--")) {
      return true;
    }

    return false;
  }

  public async getValidationPrompt(data: {
    oldCode: string;
    newCode: string;
  }): Promise<CopilotActionPrompt> {
    const oldCode: string = data.oldCode;
    const newCode: string = data.newCode;

    const prompt: string = `
        I've asked to improve comments in the code. 

        This is the old code: 

        ${oldCode}

        ---- 
        This is the new code: 

        ${newCode}

        Was anything changed in the code except comments? If yes, please reply with the following text: 
        --yes--

        If the code was NOT changed EXCEPT comments, please reply with the following text:
        --no--
      `;

    const systemPrompt: string = await this.getSystemPrompt();

    return {
      messages: [
        {
          content: systemPrompt,
          role: PromptRole.System,
        },
        {
          content: prompt,
          role: PromptRole.User,
        },
      ],
    };
  }



  public override async getPrompt(
    data: CopilotProcess,
    inputCode: string,
  ): Promise<CopilotActionPrompt> {
    const fileLanguage: ServiceLanguage = data.input.files[
      data.input.currentFilePath
    ]?.fileLanguage as ServiceLanguage;

    const prompt: string = `Please improve the comments in this code. Please only comment code that is hard to understand. 

    If you think the code is already well commented, please reply with the following text:
    --all-good--
    
    Here is the code. This is in ${fileLanguage}: 
    
    ${inputCode}
                `;

    const systemPrompt: string = await this.getSystemPrompt();

    return {
      messages: [
        {
          content: systemPrompt,
          role: PromptRole.System,
        },
        {
          content: prompt,
          role: PromptRole.User,
        },
      ],
    };
  }

  public async getSystemPrompt(): Promise<string> {
    const systemPrompt: string = `You are an expert programmer. Here are your instructions:
- You will follow the instructions given by the user strictly.
- You will not deviate from the instructions given by the user.
- You will not change the code. You will only improve the comments.`;

    return systemPrompt;
  }

  public async cleanup(data: {
    inputCode: string;
    outputCode: string;
  }): Promise<string> {
    // this code contains text as well. The code is in betwen ```<type> and ```. Please extract the code and return it.
    // for example code can be in the format of
    // ```python
    // print("Hello World")
    // ```

    // so the code to be extracted is print("Hello World")

    // the code can be in multiple lines as well.

    let extractedCode: string = data.outputCode; // this is the code in the file

    if (extractedCode.includes("```")) {
      extractedCode = extractedCode.match(/```.*\n([\s\S]*?)```/)?.[1] ?? "";
    }

    // get first line of input code.

    return extractedCode;
  }
}
