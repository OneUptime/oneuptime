import OpenAI from "openai";
import { GetOpenAIAPIKey, GetOpenAIModel } from "../../Config";
import LlmBase, { CopilotPromptResult } from "./LLMBase";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import { CopilotActionPrompt } from "../CopilotActions/Types";

export default class Llama extends LlmBase {
  public static openai: OpenAI | null = null;

  public static override async getResponse(
    data: CopilotActionPrompt,
  ): Promise<CopilotPromptResult> {
    if (!GetOpenAIAPIKey() || !GetOpenAIModel()) {
      throw new BadRequestException("OpenAI API Key or Model is not set");
    }

    if (!this.openai) {
      this.openai = new OpenAI({
        apiKey: GetOpenAIAPIKey() as string,
      });
    }

    const chatCompletion: OpenAI.Chat.Completions.ChatCompletion =
      await this.openai.chat.completions.create({
        messages: data.messages,
        model: GetOpenAIModel()!,
      });

    if (
      chatCompletion.choices.length > 0 &&
      chatCompletion.choices[0]?.message?.content
    ) {
      const response: string = chatCompletion.choices[0]!.message.content;
      return {
        output: response,
      };
    }

    throw new BadRequestException("Failed to get response from OpenAI server");
  }
}
