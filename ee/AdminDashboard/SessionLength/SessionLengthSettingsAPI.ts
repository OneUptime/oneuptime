import AdminModelAPI from "@oneuptime/admin-dashboard/Utils/ModelAPI";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  readSessionLengthSettings,
  SESSION_LENGTH_SETTING_COLUMNS,
  SessionLengthSettingColumn,
  SessionLengthSettings,
} from "Common/Types/UserSession/SessionLength";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";

/*
 * The Session Length page's calls: the setting as GlobalConfig holds it,
 * one column written at a time (each pick saves the moment it is made, as
 * every other GlobalConfig setting does, through the Admin Dashboard's model
 * API), and the preview the page asks before a change that signs people
 * out (ee/Server/SessionLength/API/SessionLengthAPI.ts).
 */

// Where the server says what a change would do to the people signed in now.
export const SESSION_LENGTH_PREVIEW_PATH: string = "/session-length/preview";

export interface SessionLengthPreview {
  // How many people the change signs out at once.
  peopleSignedOut: number;
  // Whether the master admin asking is one of them.
  includesYou: boolean;
}

const SELECT: Record<SessionLengthSettingColumn, true> = {
  sessionLengthInMinutes: true,
  sessionIdleTimeoutInMinutes: true,
  useSeparateSsoSessionLengths: true,
  ssoSessionLengthInMinutes: true,
  ssoSessionIdleTimeoutInMinutes: true,
};

// The setting, read as the server reads it (a value no write could set is the default).
export const fetchSessionLengthSettings: () => Promise<SessionLengthSettings> =
  async (): Promise<SessionLengthSettings> => {
    const config: GlobalConfig | null =
      await AdminModelAPI.getItem<GlobalConfig>({
        modelType: GlobalConfig,
        id: ObjectID.getZeroObjectID(),
        select: SELECT,
      });

    return readSessionLengthSettings(
      config as unknown as Partial<
        Record<SessionLengthSettingColumn, unknown>
      > | null,
    );
  };

// Writes one column of the setting; throws with the server's reason when refused.
export const saveSessionLengthSetting: (
  column: SessionLengthSettingColumn,
  value: number | boolean | null,
) => Promise<void> = async (
  column: SessionLengthSettingColumn,
  value: number | boolean | null,
): Promise<void> => {
  await AdminModelAPI.updateById<GlobalConfig>({
    modelType: GlobalConfig,
    id: ObjectID.getZeroObjectID(),
    data: {
      [column]: value,
    },
  });
};

// The setting as the preview route takes it: every column, null for the default.
export const toPreviewBody: (settings: SessionLengthSettings) => JSONObject = (
  settings: SessionLengthSettings,
): JSONObject => {
  const body: JSONObject = {};

  for (const column of SESSION_LENGTH_SETTING_COLUMNS) {
    body[column] = settings[column];
  }

  return body;
};

/*
 * Who `settings` would sign out at once if they were saved now. Throws when
 * the server cannot say.
 */
export const previewSessionLengthSettings: (
  settings: SessionLengthSettings,
) => Promise<SessionLengthPreview> = async (
  settings: SessionLengthSettings,
): Promise<SessionLengthPreview> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        SESSION_LENGTH_PREVIEW_PATH,
      ),
      data: toPreviewBody(settings),
    });

  if (response instanceof HTTPErrorResponse || !response.isSuccess()) {
    throw new Error(API.getFriendlyMessage(response));
  }

  const data: JSONObject = (response.data as JSONObject) || {};
  const peopleSignedOut: unknown = data["peopleSignedOut"];

  return {
    peopleSignedOut:
      typeof peopleSignedOut === "number" &&
      Number.isInteger(peopleSignedOut) &&
      peopleSignedOut > 0
        ? peopleSignedOut
        : 0,
    includesYou: data["includesYou"] === true,
  };
};
