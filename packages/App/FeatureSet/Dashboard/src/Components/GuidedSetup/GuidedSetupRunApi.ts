import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import {
  GuidedSetupKey,
  GuidedSetupRunAnswer,
  GuidedSetupRunChange,
  getGuidedSetupRunForgetRoute,
  getGuidedSetupRunRoute,
  parseGuidedSetupRunAnswer,
} from "Common/Types/GuidedSetup/GuidedSetupRun";
import { JSONObject } from "Common/Types/JSON";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * A GUIDED SETUP'S RUN ON THE SERVER (#7253), over HTTP: the caller's run for
 * one setup, in the project of the `tenantid` header
 * (Common/Types/GuidedSetup/GuidedSetupRun.ts says what each route does).
 *
 * Each call answers the run as the server now keeps it, or throws when the
 * server could not answer: GuidedSetupRunStore then goes on with what this
 * browser kept, and sends it again later.
 */

export interface GuidedSetupRunRemote {
  fetch: (setup: GuidedSetupKey) => Promise<GuidedSetupRunAnswer>;
  save: (
    setup: GuidedSetupKey,
    change: GuidedSetupRunChange,
  ) => Promise<GuidedSetupRunAnswer>;
  forget: (setup: GuidedSetupKey) => Promise<GuidedSetupRunAnswer>;
}

const toUrl: (route: string) => URL = (route: string): URL => {
  return URL.fromString(APP_API_URL.toString()).addRoute(route);
};

const toAnswer: (
  response: HTTPResponse<JSONObject> | HTTPErrorResponse,
) => GuidedSetupRunAnswer = (
  response: HTTPResponse<JSONObject> | HTTPErrorResponse,
): GuidedSetupRunAnswer => {
  if (response instanceof HTTPErrorResponse || !response.isSuccess()) {
    throw response;
  }

  const answer: GuidedSetupRunAnswer | null = parseGuidedSetupRunAnswer(
    response.data,
  );

  if (!answer) {
    throw new Error("The guided setup's run could not be read.");
  }

  return answer;
};

const GuidedSetupRunApi: GuidedSetupRunRemote = {
  fetch: async (setup: GuidedSetupKey): Promise<GuidedSetupRunAnswer> => {
    return toAnswer(
      await API.get<JSONObject>({
        url: toUrl(getGuidedSetupRunRoute(setup)),
        headers: ModelAPI.getCommonHeaders(),
      }),
    );
  },

  save: async (
    setup: GuidedSetupKey,
    change: GuidedSetupRunChange,
  ): Promise<GuidedSetupRunAnswer> => {
    return toAnswer(
      await API.post<JSONObject>({
        url: toUrl(getGuidedSetupRunRoute(setup)),
        data: {
          values: change.values,
          resources: JSON.parse(JSON.stringify(change.resources)) as JSONObject,
        },
        headers: ModelAPI.getCommonHeaders(),
      }),
    );
  },

  forget: async (setup: GuidedSetupKey): Promise<GuidedSetupRunAnswer> => {
    return toAnswer(
      await API.post<JSONObject>({
        url: toUrl(getGuidedSetupRunForgetRoute(setup)),
        data: {},
        headers: ModelAPI.getCommonHeaders(),
      }),
    );
  },
};

export default GuidedSetupRunApi;
