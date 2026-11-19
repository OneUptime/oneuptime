import {
  ASK_AI_RATINGS_ROUTE,
  ASK_AI_SOURCE_OF_NO_PRODUCT_TITLES,
  AskAiProjectRatings,
  getAskAiSourceTitle,
  readAskAiProjectRatings,
} from "Common/Types/AI/AskAiRatings";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import Permission from "Common/Types/Permission";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "Common/UI/Utils/PermissionGate";

/*
 * ASK AI'S ANSWERS, AS THIS PROJECT RATED THEM (#7365), for Settings > AI >
 * AI Results' Ask AI Answers card (AskAiRatingsCard).
 *
 * The project's owners and admins read how its Ask AI answers were rated in
 * the last 90 days, and what the answers rated down drew on - which
 * products' data, the docs, or nothing (Types/AI/AskAiRatings). Never a
 * question or an answer: each conversation is private to the person who had
 * it, and the server reads only the thumbs and the names of the tools each
 * answer ran.
 */

// Who reads it: as the server asks (AIChatAPI's ASK_AI_RATINGS_PERMISSIONS).
export const ASK_AI_RATINGS_READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
];

export const mayReadAskAiRatings: () => boolean = (): boolean => {
  return PermissionGate.holdsAnyOf(ASK_AI_RATINGS_READERS);
};

// A source's name and the words for what is no product (Types/AI/AskAiRatings).
export { ASK_AI_SOURCE_OF_NO_PRODUCT_TITLES, getAskAiSourceTitle };

// GET /ai-chat/ratings, for the project the Dashboard is on.
export const fetchAskAiRatings: () => Promise<AskAiProjectRatings> =
  async (): Promise<AskAiProjectRatings> => {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.get<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          ASK_AI_RATINGS_ROUTE,
        ),
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    const ratings: AskAiProjectRatings | null = readAskAiProjectRatings(
      response.data,
    );

    if (!ratings) {
      throw new Error(
        "The server's answer about Ask AI's ratings could not be read.",
      );
    }

    return ratings;
  };
