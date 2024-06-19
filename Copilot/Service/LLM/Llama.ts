import URL from "Common/Types/API/URL";
import { GetLlamaServerUrl } from "../../Config";
import LlmBase from "./LLMBase";
import API from "Common/Utils/API";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import BadRequestException from "Common/Types/Exception/BadRequestException";

export default class Llama extends LlmBase {
  public static override async getResponse(data: {
    input: string;
  }): Promise<string> {
    const serverUrl: URL = GetLlamaServerUrl();

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post(serverUrl.addRoute("/prompt"), {
        prompt: data.input,
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    const result: JSONObject = response.data;

    if (
      result["response"] &&
      (result["response"] as JSONObject)["generated_text"]
    ) {
      const arrayOfGeneratedText: JSONArray = (
        result["response"] as JSONObject
      )["generated_text"] as JSONArray;

      // get last item

      const lastItem: JSONObject = arrayOfGeneratedText[
        arrayOfGeneratedText.length - 1
      ] as JSONObject;

      if (lastItem["content"]) {
        return lastItem["content"] as string;
      }
    }

    throw new BadRequestException("Failed to get response from Llama server");
  }
}
