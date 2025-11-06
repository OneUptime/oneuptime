import BaseAPI from "Common/UI/Utils/API/API";
import { IDENTITY_URL } from "Common/UI/Config";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import { Logger } from "Common/UI/Utils/Logger";

const registerDashboardAuthRefresh = (): void => {
  const refreshSession = async (): Promise<boolean> => {
    try {
      const response = await BaseAPI.post<JSONObject>({
        url: URL.fromURL(IDENTITY_URL).addRoute("/refresh-session"),
        options: {
          skipAuthRefresh: true,
        },
      });

      if (response instanceof HTTPErrorResponse) {
        Logger.warn(
          `Dashboard session refresh failed with status ${response.statusCode}.`,
        );
        return false;
      }

      return response.isSuccess();
    } catch (err) {
      Logger.error("Dashboard session refresh request failed.");
      Logger.error(err as Error);
      return false;
    }
  };

  BaseAPI.setRefreshSessionHandler(refreshSession);

  BaseAPI.setRefreshFailureHandler(() => {
    Logger.warn("Dashboard session refresh failed. Logging out user.");
  });
};

registerDashboardAuthRefresh();

export default BaseAPI;
