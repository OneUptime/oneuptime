import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * A TEST PAGE SENT FROM AN ANSWER, KEPT ON THE ANSWER (#7249): its run is
 * recorded on the answer that offered it (POST /ai-chat/message-test-page),
 * so the line under the answer says what became of it after a reload, on
 * another device, and the model reads it in the next turn.
 */

export const ANSWER_TEST_PAGE_ROUTE: string = "/ai-chat/message-test-page";

export async function recordAnswerTestPage(data: {
  messageId: string;
  executionLogId: string;
}): Promise<void> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString() + ANSWER_TEST_PAGE_ROUTE),
      data: {
        messageId: data.messageId,
        executionLogId: data.executionLogId,
      },
      headers: ModelAPI.getCommonHeaders(),
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }
}
