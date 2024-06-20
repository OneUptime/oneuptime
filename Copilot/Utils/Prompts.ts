import CopilotEventType from "Common/Types/Copilot/CopilotEventType";
import Dictionary from "Common/Types/Dictionary";
import BadDataException from "Common/Types/Exception/BadDataException";

export default class PromptsUtil {
  public static async getPrompt(data: {
    copilotEventType: CopilotEventType;
    vars: Dictionary<string>;
  }): Promise<string> {
    let prompt: string = "";

    if (data.copilotEventType === CopilotEventType.IMPROVE_COMMENTS) {
      prompt = `Please improve the comments in this code. 
      Please only comment code that is hard to understand. 
      If you do not find any code that is hard to understand, then please do not add any comments.
Please only reply with code and nothing else. 

Here is the code: 

{{code}}
            `;
    }

    if (data.copilotEventType === CopilotEventType.FIX_GRAMMAR_AND_SPELLING) {
      prompt = `Please fix the grammar and spelling in this code:
            {{code}}
            `;
    }

    return PromptsUtil.fillVarsInPrompt(prompt, data.vars);
  }

  private static fillVarsInPrompt(
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
