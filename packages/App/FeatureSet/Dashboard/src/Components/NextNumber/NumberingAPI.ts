import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import NextNumberUtil, {
  RecordNumbering,
} from "Common/Utils/Project/NextNumber";

/*
 * Where each kind of number stands in the project: the server's numbering
 * route (ProjectAPI, GET /project/:id/numbering), which reads the counters
 * no model API answers. The starts themselves are Project columns, saved
 * through ModelAPI like any other.
 *
 * Throws on failure, so the card can say what went wrong through
 * API.getFriendlyMessage.
 */
export default class NumberingAPI {
  public static getPath(projectId: ObjectID): string {
    return `/project/${projectId.toString()}/numbering`;
  }

  public static async getNumbering(
    projectId: ObjectID,
  ): Promise<Array<RecordNumbering>> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.get<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          NumberingAPI.getPath(projectId),
        ),
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    return NextNumberUtil.parseNumbering(response.data);
  }
}
