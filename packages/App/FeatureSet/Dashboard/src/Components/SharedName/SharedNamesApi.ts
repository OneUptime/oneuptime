import { APP_API_URL } from "Common/UI/Config";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import {
  SharedNameKind,
  SharedNamesAnswer,
  getSharedNamesRoute,
  readSharedNamesAnswer,
} from "Common/Types/Database/SharedNames";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * Which records of a kind share a name in the current project, as the
 * server finds them for this reader (#9746, Common/Types/Database
 * /SharedNames). A refusal or a failure is thrown, for the list to mark
 * nothing: the marks only help, and the list works without them.
 */
export default class SharedNamesApi {
  public static async read(kind: SharedNameKind): Promise<SharedNamesAnswer> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.get<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          getSharedNamesRoute(kind),
        ),
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    return readSharedNamesAnswer(response.data);
  }
}
