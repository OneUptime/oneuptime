import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  SAMPLE_PROJECT_CREATE_ROUTE,
  SAMPLE_PROJECT_DELETE_ROUTE,
  SampleProjectCreateAnswer,
} from "Common/Types/SampleProject/SampleProject";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The Dashboard's two calls for a sample project (issue #6808,
 * Common/Server/API/SampleProjectAPI). Each answers what happened, or the
 * sentence the server gave for why not, for the button to show.
 */

export type SampleProjectResult<T> =
  | { isSuccess: true; value: T }
  | { isSuccess: false; error: string };

const toUrl: (route: string) => URL = (route: string): URL => {
  return URL.fromString(APP_API_URL.toString()).addRoute(route);
};

const toError: (
  response: HTTPResponse<JSONObject> | HTTPErrorResponse | unknown,
) => string = (
  response: HTTPResponse<JSONObject> | HTTPErrorResponse | unknown,
): string => {
  return API.getFriendlyMessage(response);
};

// Makes the person's sample, or finds the one they have.
export const createSampleProject: () => Promise<
  SampleProjectResult<SampleProjectCreateAnswer>
> = async (): Promise<SampleProjectResult<SampleProjectCreateAnswer>> => {
  try {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: toUrl(SAMPLE_PROJECT_CREATE_ROUTE),
        data: {},
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse || !response.isSuccess()) {
      return { isSuccess: false, error: toError(response) };
    }

    const projectId: unknown = response.data["projectId"];

    if (typeof projectId !== "string" || !projectId) {
      return { isSuccess: false, error: toError(response) };
    }

    return {
      isSuccess: true,
      value: {
        projectId: projectId,
        isNew: response.data["isNew"] === true,
      },
    };
  } catch (err) {
    return { isSuccess: false, error: toError(err) };
  }
};

// Deletes the sample: the request names it in its project header.
export const deleteSampleProject: (
  projectId: ObjectID,
) => Promise<SampleProjectResult<true>> = async (
  projectId: ObjectID,
): Promise<SampleProjectResult<true>> => {
  try {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: toUrl(SAMPLE_PROJECT_DELETE_ROUTE),
        data: {},
        headers: {
          ...ModelAPI.getCommonHeaders(),
          tenantid: projectId.toString(),
        },
      });

    if (response instanceof HTTPErrorResponse || !response.isSuccess()) {
      return { isSuccess: false, error: toError(response) };
    }

    return { isSuccess: true, value: true };
  } catch (err) {
    return { isSuccess: false, error: toError(err) };
  }
};
