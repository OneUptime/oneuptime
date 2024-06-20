import NotImplementedException from "Common/Types/Exception/NotImplementedException";
import LlmType from "../../Types/LLmType";
import CopilotActionType from "Common/Types/Copilot/CopilotActionType";

export interface CopilotActionRunResult { 
    result: string
}


export interface CopilotActionPrompt { 
    prompt: string
}

export default class CopilotActionBase {
    

    public llmType: LlmType = LlmType.Llama;

    public constructor(data: {
        llmType: LlmType
        copilotActionType: CopilotActionType
    }){
        this.llmType = data.llmType;
    }
    
    public async run(): Promise<CopilotActionRunResult> {
        throw new NotImplementedException();
    }

    public  async getPrompt(data: {
        vars: {
            code: string; 
        }
      }): Promise<CopilotActionPrompt> {
        let prompt: string = "";
    
        if (this.copilotActionType === CopilotActionType.IMPROVE_COMMENTS) {
          prompt = `Please improve the comments in this code. 
          Please only comment code that is hard to understand. 
          If you do not find any code that is hard to understand, then please do not add any comments.
    Please only reply with code and nothing else. 
    
    Here is the code: 
    
    {{code}}
                `;
        }
    
        if (data.copilotActionType === CopilotActionType.FIX_GRAMMAR_AND_SPELLING) {
          prompt = `Please fix the grammar and spelling in this code:
                {{code}}
                `;
        }
    
        return PromptsUtil.fillVarsInPrompt(prompt, data.vars);
      }
    
      private fillVarsInPrompt(
        prompt: string,
        vars: Dictionary<string>,
      ): string {
        let filledPrompt: string = prompt;
    
        for (const [key, value] of Object.entries(vars)) {
          filledPrompt = filledPrompt.replace(new RegExp(`{{${key}}}`, "g"), value);
        }
    
        // check if there any unfilled vars and if there are then throw an error.
    
        if (filledPrompt.match(/{{.*}}/) !== null) {
          throw new BadDataException(
            `There are some unfilled vars in the prompt: ${filledPrompt}`,
          );
        }
    
        return filledPrompt;
      }
}