import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import {
  HELP_AND_SUPPORT_SETTINGS_ROUTE,
  HelpChoice,
  HelpItem,
} from "Common/Types/HelpAndSupport/HelpAndSupport";
import {
  HelpAndSupportAnswer,
  parseHelpAndSupportAnswer,
} from "Common/Types/HelpAndSupport/HelpAndSupportAnswer";
import { JSONObject } from "Common/Types/JSON";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import { translateText } from "Common/UI/Utils/TranslateTemplate";

/*
 * Admin Dashboard > Settings > Help and Support, over HTTP (#10864-#10866):
 * GET and POST /global-config/help-and-support (Types/HelpAndSupport/
 * HelpAndSupportAnswer). A refusal throws, with the server's words for the
 * page to show.
 */

const helpAndSupportUrl: () => URL = (): URL => {
  return URL.fromURL(APP_API_URL).addRoute(
    new Route(HELP_AND_SUPPORT_SETTINGS_ROUTE),
  );
};

const readAnswer: (
  response: HTTPResponse<JSONObject> | HTTPErrorResponse,
) => HelpAndSupportAnswer = (
  response: HTTPResponse<JSONObject> | HTTPErrorResponse,
): HelpAndSupportAnswer => {
  if (response instanceof HTTPErrorResponse || !response.isSuccess()) {
    throw response;
  }

  const answer: HelpAndSupportAnswer | null = parseHelpAndSupportAnswer(
    response.data,
  );

  if (!answer) {
    throw new Error(
      translateText(
        "The server did not answer with its help and support settings.",
      ) as string,
    );
  }

  return answer;
};

export const fetchHelpAndSupport: () => Promise<HelpAndSupportAnswer> =
  async (): Promise<HelpAndSupportAnswer> => {
    return readAnswer(
      await API.fetch<JSONObject>({
        method: HTTPMethod.GET,
        url: helpAndSupportUrl(),
      }),
    );
  };

// One place, changed: its choice, and the address, link or words it needs.
export const postHelpItemChange: (data: {
  item: HelpItem;
  choice: HelpChoice;
  value: string | null;
}) => Promise<HelpAndSupportAnswer> = async (data: {
  item: HelpItem;
  choice: HelpChoice;
  value: string | null;
}): Promise<HelpAndSupportAnswer> => {
  return readAnswer(
    await API.post<JSONObject>({
      url: helpAndSupportUrl(),
      data: {
        item: data.item,
        choice: data.choice,
        ...(data.value !== null ? { value: data.value } : {}),
      },
    }),
  );
};
