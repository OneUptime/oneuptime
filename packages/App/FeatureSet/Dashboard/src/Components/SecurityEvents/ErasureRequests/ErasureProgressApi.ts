import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import {
  SECURITY_USER_ERASURE_PROGRESS_PATH,
  SecurityUserErasureProgressLine,
  readProgressLines,
} from "Common/Types/SecurityEvent/SecurityUserErasureProgressLine";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * How far each of the project's open erasure requests has got (#11232), as
 * the server answers it (Server/API/SecurityUserErasureRequestAPI): a line
 * for each, never what the worker keeps. Throws the server's error; the
 * page then says what it said before, without the line.
 */
export async function fetchErasureProgress(): Promise<
  Array<SecurityUserErasureProgressLine>
> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromURL(APP_API_URL).addRoute(
        SECURITY_USER_ERASURE_PROGRESS_PATH,
      ),
      headers: ModelAPI.getCommonHeaders(),
      data: {},
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return readProgressLines(response.data);
}
