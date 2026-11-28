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
import {
  SharedNamesAnswer,
  getSharedNamesRouteOfTable,
  readSharedNamesAnswer,
} from "../../Types/Database/SharedNames";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";

/*
 * WHAT THE SERVER SAYS OF NAMES THAT REPEAT IN THE CURRENT PROJECT (#10761,
 * Types/Database/RequiredUniqueNames): whether a name a form holds is
 * another record's, the names the project holds more than once, and - for
 * a list of a kind Require Unique Names holds - which of its records share
 * a name (#11021, Types/Database/SharedNames). A refusal or a failure is
 * thrown, for the caller to say nothing: a form's warning and a list's
 * marks only help, and both work without them.
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

  /*
   * The records of a kind Require Unique Names holds, by its table's name
   * ("Monitor"), that share a name with another the reader may read, and
   * when each was made: GET /shared-names/Monitor.
   */
  public static async readSharedNames(
    tableName: string,
  ): Promise<SharedNamesAnswer> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.get<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          getSharedNamesRouteOfTable(tableName),
        ),
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    return readSharedNamesAnswer(response.data);
  }
}
