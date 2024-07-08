import URL from "Common/Types/API/URL";
import { GetLlamaServerUrl, GetRepositorySecretKey } from "../../Config";
import LlmBase, { CopilotPromptResult } from "./LLMBase";
import API from "Common/Utils/API";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import Sleep from "Common/Types/Sleep";
import logger from "CommonServer/Utils/Logger";
import {
  CopilotActionPrompt,
  Prompt,
} from "../CopilotActions/CopilotActionsBase";
import ErrorGettingResponseFromLLM from "../../Exceptions/ErrorGettingResponseFromLLM";
import BadOperationException from "Common/Types/Exception/BadOperationException";
import OneUptimeDate from "Common/Types/Date";
import LLMTimeoutException from "../../Exceptions/LLMTimeoutException";

enum LlamaPromptStatus {
  Processed = "processed",
  NotFound = "not found",
  Pending = "pending",
}

export default class Llama extends LlmBase {
  public static override async getResponse(
    data: CopilotActionPrompt,
  ): Promise<CopilotPromptResult> {
    const serverUrl: URL = GetLlamaServerUrl();

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post(
        URL.fromString(serverUrl.toString()).addRoute("/prompt/"),
        {
          messages: data.messages.map((message: Prompt) => {
            return {
              content: message.content,
              role: message.role,
            };
          }),
          secretkey: GetRepositorySecretKey(),
        },
        {},
        {
          retries: 3,
          exponentialBackoff: true,
        },
      );

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    const result: JSONObject = response.data;

    const idOfPrompt: string = result["id"] as string;

    if (result["error"] && typeof result["error"] === "string") {
      throw new BadOperationException(result["error"]);
    }

    // now check this prompt status.

    let promptStatus: LlamaPromptStatus = LlamaPromptStatus.Pending;
    let promptResult: JSONObject | null = null;

    const currentDate: Date = OneUptimeDate.getCurrentDate();
    const timeoutInMinutes: number = data.timeoutInMinutes || 5;

    while (promptStatus === LlamaPromptStatus.Pending) {
      const timeNow: Date = OneUptimeDate.getCurrentDate();

      if (
        OneUptimeDate.getDifferenceInMinutes(timeNow, currentDate) >
        timeoutInMinutes
      ) {
        throw new LLMTimeoutException(
          `Timeout of ${timeoutInMinutes} minutes exceeded. Skipping the prompt.`,
        );
      }

      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post(
          URL.fromString(serverUrl.toString()).addRoute(`/prompt-result/`),
          {
            id: idOfPrompt,
            secretkey: GetRepositorySecretKey(),
          },
          {},
          {
            retries: 3,
            exponentialBackoff: true,
          },
        );

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      if (
        response.data["error"] &&
        typeof response.data["error"] === "string"
      ) {
        throw new BadOperationException(response.data["error"]);
      }

      const result: JSONObject = response.data;

      promptStatus = result["status"] as LlamaPromptStatus;

      if (promptStatus === LlamaPromptStatus.Processed) {
        logger.debug("Prompt is processed");
        promptResult = result;
      } else if (promptStatus === LlamaPromptStatus.NotFound) {
        throw new ErrorGettingResponseFromLLM("Error processing prompt");
      } else if (promptStatus === LlamaPromptStatus.Pending) {
        logger.debug("Prompt is still pending. Waiting for 1 second");
        await Sleep.sleep(1000);
      }
    }

    if (!promptResult) {
      throw new BadRequestException("Failed to get response from Llama server");
    }

    if (
      promptResult["output"] &&
      (promptResult["output"] as JSONArray).length > 0
    ) {
      promptResult = (promptResult["output"] as JSONArray)[0] as JSONObject;
    }

    if (promptResult && (promptResult as JSONObject)["generated_text"]) {
      const arrayOfGeneratedText: JSONArray = (promptResult as JSONObject)[
        "generated_text"
      ] as JSONArray;

      // get last item

      const lastItem: JSONObject = arrayOfGeneratedText[
        arrayOfGeneratedText.length - 1
      ] as JSONObject;

      if (lastItem["content"]) {
        return {
          output: lastItem["content"] as string,
        };
      }
    }

    throw new BadRequestException("Failed to get response from Llama server");
  }
}
