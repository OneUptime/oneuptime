import { APP_API_URL } from "../Config";
import API from "./API/API";
import ModelAPI from "./ModelAPI/ModelAPI";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import URL from "../../Types/API/URL";
import {
  DuplicateNamesAnswer,
  readDuplicateNamesAnswer,
  readUniqueNameCheckAnswer,
  UNIQUE_NAME_CHECK_PARAMS,
  UNIQUE_NAME_CHECK_ROUTE,
  UNIQUE_NAME_DUPLICATES_ROUTE,
  UniqueNameCheckAnswer,
} from "../../Types/Database/RequiredUniqueNames";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";

/*
 * WHAT THE SERVER SAYS OF NAMES THAT REPEAT IN THE CURRENT PROJECT (#10761,
 * Types/Database/RequiredUniqueNames): whether a name a form holds is
 * another record's, and the names the project holds more than once. A
 * refusal or a failure is thrown, for the caller to say nothing: a form's
 * warning only helps, and the form works without it.
 */
export default class UniqueNamesApi {
  public static async check(data: {
    // The kind, by its table: "Monitor".
    tableName: string;
    name: string;
    // The record a form edits, which may hold its own name.
    exceptId?: ObjectID | null | undefined;
  }): Promise<UniqueNameCheckAnswer> {
    const url: URL = URL.fromString(APP_API_URL.toString())
      .addRoute(UNIQUE_NAME_CHECK_ROUTE)
      .addQueryParam(UNIQUE_NAME_CHECK_PARAMS.tableName, data.tableName, true)
      .addQueryParam(UNIQUE_NAME_CHECK_PARAMS.name, data.name, true);

    if (data.exceptId) {
      url.addQueryParam(
        UNIQUE_NAME_CHECK_PARAMS.exceptId,
        data.exceptId.toString(),
        true,
      );
    }

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.get<JSONObject>({
        url: url,
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    return readUniqueNameCheckAnswer(response.data);
  }

  public static async readDuplicates(): Promise<DuplicateNamesAnswer> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.get<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          UNIQUE_NAME_DUPLICATES_ROUTE,
        ),
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    return readDuplicateNamesAnswer(response.data);
  }
}
