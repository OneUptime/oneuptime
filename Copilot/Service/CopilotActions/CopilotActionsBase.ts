import NotImplementedException from "Common/Types/Exception/NotImplementedException";
import LlmType from "../../Types/LLmType";
import CopilotActionType from "Common/Types/Copilot/CopilotActionType";
import BadDataException from "Common/Types/Exception/BadDataException";
import LLM from "../LLM/LLM";
import { GetLlmType } from "../../Config";

export interface CopilotActionRunResult {
  result: string;
}

export interface CopilotActionPrompt {
  prompt: string;
}

export interface CopilotActionVars {
  code: string;
}

export default class CopilotActionBase {
  public llmType: LlmType = LlmType.Llama;
  public copilotActionType: CopilotActionType =
    CopilotActionType.IMPROVE_COMMENTS; // temp value which will be overridden in the constructor

  public constructor(data: { copilotActionType: CopilotActionType }) {
    this.llmType = GetLlmType();
    this.copilotActionType = data.copilotActionType;
  }

  private async onAfterExecute(data: {
    result: CopilotActionRunResult;
    vars: CopilotActionVars;
  }): Promise<CopilotActionRunResult> {
    // do nothing
    return data.result;
  }

  public async execute(data: {
    vars: CopilotActionVars;
  }): Promise<CopilotActionRunResult> {
    const prompt: CopilotActionPrompt = await this.getPrompt({
      vars: data.vars,
    });

    const result: CopilotActionRunResult = await LLM.getResponse(prompt);

    return await this.onAfterExecute({
      result: result,
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

    for (const [key, value] of Object.entries(vars)) {
      filledPrompt = filledPrompt.replace(new RegExp(`{{${key}}}`, "g"), value);
    }

    // check if there any unfilled vars and if there are then throw an error.

    if (filledPrompt.match(/{{.*}}/) !== null) {
      throw new BadDataException(
        `There are some unfilled vars in the prompt: ${filledPrompt}`,
      );
    }

    return {
      prompt: filledPrompt,
    };
  }
}
