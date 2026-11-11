import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  WELCOME_CHECKLIST_BROWSER_STATE_ROUTE,
  WELCOME_CHECKLIST_ROUTE,
  WelcomeChecklistAnswer,
  parseWelcomeChecklistAnswer,
} from "Common/Types/WelcomeChecklist/WelcomeChecklistAnswer";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * Home's reads and writes of the Welcome checklist (issue #6803): one GET
 * for the whole card, and POSTs that each answer with the card as it now
 * stands. A read that fails answers null: the card is a help, and Home
 * draws nothing rather than a broken one.
 */

const toUrl: (route: string) => URL = (route: string): URL => {
  return URL.fromString(APP_API_URL.toString()).addRoute(route);
};

const toAnswer: (
  response: HTTPResponse<JSONObject> | HTTPErrorResponse,
) => WelcomeChecklistAnswer | null = (
  response: HTTPResponse<JSONObject> | HTTPErrorResponse,
): WelcomeChecklistAnswer | null => {
  if (response instanceof HTTPErrorResponse || !response.isSuccess()) {
    return null;
  }

  return parseWelcomeChecklistAnswer(response.data);
};

export const fetchWelcomeChecklist: () => Promise<WelcomeChecklistAnswer | null> =
  async (): Promise<WelcomeChecklistAnswer | null> => {
    try {
      return toAnswer(
        await API.get<JSONObject>({
          url: toUrl(WELCOME_CHECKLIST_ROUTE),
          headers: ModelAPI.getCommonHeaders(),
        }),
      );
    } catch {
      return null;
    }
  };

export const postWelcomeChecklist: (
  route: string,
  data?: JSONObject,
) => Promise<WelcomeChecklistAnswer | null> = async (
  route: string,
  data?: JSONObject,
): Promise<WelcomeChecklistAnswer | null> => {
  try {
    return toAnswer(
      await API.post<JSONObject>({
        url: toUrl(route),
        data: data || {},
        headers: ModelAPI.getCommonHeaders(),
      }),
    );
  } catch {
    return null;
  }
};

/*
 * THE CHECKLIST BEFORE THIS ONE kept two things in each browser, per
 * project: that it was dismissed, and that it was finished. They are read
 * once, sent to the server - which keeps them for everyone (a finish) or
 * for this person (a dismissal) - and forgotten here once it has them.
 */
export const LEGACY_DISMISSED_KEY_PREFIX: string = "getting-started-dismissed-";
export const LEGACY_COMPLETE_KEY_PREFIX: string = "getting-started-complete-";

export interface LegacyBrowserState {
  wasDismissed: boolean;
  wasFinished: boolean;
}

export const readLegacyBrowserState: (
  projectId: ObjectID | string,
) => LegacyBrowserState = (
  projectId: ObjectID | string,
): LegacyBrowserState => {
  try {
    return {
      wasDismissed: Boolean(
        LocalStorage.getItem(
          `${LEGACY_DISMISSED_KEY_PREFIX}${projectId.toString()}`,
        ),
      ),
      wasFinished: Boolean(
        LocalStorage.getItem(
          `${LEGACY_COMPLETE_KEY_PREFIX}${projectId.toString()}`,
        ),
      ),
    };
  } catch {
    return { wasDismissed: false, wasFinished: false };
  }
};

export const forgetLegacyBrowserState: (
  projectId: ObjectID | string,
) => void = (projectId: ObjectID | string): void => {
  try {
    LocalStorage.removeItem(
      `${LEGACY_DISMISSED_KEY_PREFIX}${projectId.toString()}`,
    );
    LocalStorage.removeItem(
      `${LEGACY_COMPLETE_KEY_PREFIX}${projectId.toString()}`,
    );
  } catch {
    // Sent again next time: the server keeps it once either way.
  }
};

/*
 * Sends what this browser remembered, when it remembered anything, and
 * answers with the card as the server now has it; null when there was
 * nothing to send, or it could not be sent (and is sent again next time).
 */
export const sendLegacyBrowserState: (
  projectId: ObjectID | string,
) => Promise<WelcomeChecklistAnswer | null> = async (
  projectId: ObjectID | string,
): Promise<WelcomeChecklistAnswer | null> => {
  const legacy: LegacyBrowserState = readLegacyBrowserState(projectId);

  if (!legacy.wasDismissed && !legacy.wasFinished) {
    return null;
  }

  const answer: WelcomeChecklistAnswer | null = await postWelcomeChecklist(
    WELCOME_CHECKLIST_BROWSER_STATE_ROUTE,
    {
      wasDismissed: legacy.wasDismissed,
      wasFinished: legacy.wasFinished,
    },
  );

  if (answer) {
    forgetLegacyBrowserState(projectId);
  }

  return answer;
};
