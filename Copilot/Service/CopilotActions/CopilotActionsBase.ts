import NotImplementedException from "Common/Types/Exception/NotImplementedException";
import LlmType from "../../Types/LlmType";
import CopilotActionType from "Common/Types/Copilot/CopilotActionType";
import BadDataException from "Common/Types/Exception/BadDataException";
import LLM from "../LLM/LLM";
import { GetLlmType } from "../../Config";
import Text from "Common/Types/Text";

export interface CopilotActionRunResult {
  code: string;
}

export interface CopilotActionPrompt {
  prompt: string;
  systemPrompt: string;
}

export interface CopilotActionVars {
  code: string;
  filePath: string;
  fileCommitHash: string;
}

export default class CopilotActionBase {
  public llmType: LlmType = LlmType.Llama;
  public copilotActionType: CopilotActionType =
    CopilotActionType.IMPROVE_COMMENTS; // temp value which will be overridden in the constructor

  public constructor(data: { copilotActionType: CopilotActionType }) {
    this.llmType = GetLlmType();
    this.copilotActionType = data.copilotActionType;
  }

  public async onBeforeExecute(data: {
    vars: CopilotActionVars;
  }): Promise<CopilotActionVars> {
    return data.vars;
  }

  private async onAfterExecute(data: {
    result: CopilotActionRunResult;
    vars: CopilotActionVars;
  }): Promise<CopilotActionRunResult> {
    // do nothing
    return data.result;
  }

  public async getBranchName(): Promise<string> {
    const randomText: string = Text.generateRandomText(5);
    const bracnhName: string = `${Text.pascalCaseToDashes(this.copilotActionType).toLowerCase()}-${randomText}`;
    // replace -- with - in the branch name
    return Text.replaceAll(bracnhName, "--", "-");
  }

  public async getPullRequestTitle(data: {
    vars: CopilotActionVars;
  }): Promise<string> {
    return `OneUptime Copilot: ${this.copilotActionType} on ${data.vars.filePath}`;
  }

  public async getPullRequestBody(data: {
    vars: CopilotActionVars;
  }): Promise<string> {
    return `OneUptime Copilot: ${this.copilotActionType} on ${data.vars.filePath}
    
${await this.getDefaultPullRequestBody()}
    `;
  }

  public async getDefaultPullRequestBody(): Promise<string> {
    return `
    
#### Warning
OneUptime Copilot is an AI tool that improves your code. Please do not rely on it completely. Always review the changes before merging. 

#### Feedback
If you have  any feedback or suggestions, please let us know. We would love to hear from you. Please contact us at copilot@oneuptime.com.

    `;
  }

  public async getCommitMessage(data: {
    vars: CopilotActionVars;
  }): Promise<string> {
    return `OneUptime Copilot: ${this.copilotActionType} on ${data.vars.filePath}`;
  }

  public async cleanup(
    actionResult: CopilotActionRunResult,
  ): Promise<CopilotActionRunResult> {
    // this code contains text as well. The code is in betwen ```<type> and ```. Please extract the code and return it.
    // for example code can be in the format of
    // ```python
    // print("Hello World")
    // ```

    // so the code to be extracted is print("Hello World")

    // the code can be in multiple lines as well.

    if (!actionResult.code) {
      return actionResult;
    }

    if (!actionResult.code.includes("```")) {
      return actionResult;
    }

    const extractedCode: string =
      actionResult.code.match(/```.*\n([\s\S]*?)```/)?.[1] ?? "";

    return {
      code: extractedCode,
    };
  }

  public async isNoOperation(_data: {
    vars: CopilotActionVars;
    result: CopilotActionRunResult;
  }): Promise<boolean> {
    return false;
  }

  public async execute(data: {
    vars: CopilotActionVars;
  }): Promise<CopilotActionRunResult | null> {
    const prompt: CopilotActionPrompt = await this.getPrompt({
      vars: data.vars,
    });

    const result: CopilotActionRunResult = await LLM.getResponse(prompt);

    if (await this.isNoOperation({ vars: data.vars, result: result })) {
      return null;
    }

    const cleanedResult: CopilotActionRunResult = await this.cleanup(result);

    return await this.onAfterExecute({
      result: cleanedResult,
      vars: data.vars,
    });
  }

  protected async _getPrompt(): Promise<CopilotActionPrompt> {
    throw new NotImplementedException();
  }

  public async getPrompt(data: {
    vars: CopilotActionVars;
  }): Promise<CopilotActionPrompt> {
    const prompt: CopilotActionPrompt = await this._getPrompt();

    return this.fillVarsInPrompt({
      prompt: prompt,
      vars: data.vars,
    });
  }

  private fillVarsInPrompt(data: {
    prompt: CopilotActionPrompt;
    vars: CopilotActionVars;
  }): CopilotActionPrompt {
    const { prompt, vars } = data;

    let filledPrompt: string = prompt.prompt;
    let filledSystemPrompt: string = prompt.systemPrompt;

    for (const [key, value] of Object.entries(vars)) {
      filledPrompt = filledPrompt.replace(new RegExp(`{{${key}}}`, "g"), value);
      filledSystemPrompt = filledSystemPrompt.replace(
        new RegExp(`{{${key}}}`, "g"),
        value,
      );
    }

    // check if there any unfilled vars and if there are then throw an error.

    if (filledPrompt.match(/{{.*}}/) !== null) {
      throw new BadDataException(
        `There are some unfilled vars in the prompt: ${filledPrompt}`,
      );
    }

    if (filledSystemPrompt.match(/{{.*}}/) !== null) {
      throw new BadDataException(
        `There are some unfilled vars in the system prompt: ${filledSystemPrompt}`,
      );
    }

    return {
      prompt: filledPrompt,
      systemPrompt: filledSystemPrompt,
    };
  }
}
