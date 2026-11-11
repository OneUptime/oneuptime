import URL from "../../Types/API/URL";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import { JSONObject } from "../../Types/JSON";
import API from "../../Utils/API";
import { APP_API_URL } from "../Config";

export interface GlobalConfigVars {
  disableUserProjectCreation: boolean;
  // Push notifications turned off for the whole server (PushNotificationsTurnedOff).
  disablePushNotifications: boolean;
  /*
   * False while the server is known not to be able to send email: its email
   * is not set up, or has never managed to send (Types/ServerSending/
   * ServerSendingStatus). The sign-in pages, the invite dialogs, Home and
   * Create Monitor then say so, instead of promising an email. Read as true
   * from an answer that does not say false - an older server's, or one that
   * was refused - so nothing claims the server cannot send when it may.
   */
  canSendEmail: boolean;
}

export default class GlobalConfigUtil {
  private static cache: GlobalConfigVars | null = null;
  private static fetchPromise: Promise<GlobalConfigVars> | null = null;

  public static async fetchVars(): Promise<GlobalConfigVars> {
    if (GlobalConfigUtil.cache) {
      return GlobalConfigUtil.cache;
    }

    if (GlobalConfigUtil.fetchPromise) {
      return GlobalConfigUtil.fetchPromise;
    }

    GlobalConfigUtil.fetchPromise = (async (): Promise<GlobalConfigVars> => {
      const apiUrl: URL = URL.fromURL(APP_API_URL).addRoute(
        "/global-config/vars",
      );

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.get<JSONObject>({ url: apiUrl });

      const data: JSONObject =
        response instanceof HTTPErrorResponse
          ? {}
          : (response.data as JSONObject);

      GlobalConfigUtil.cache = GlobalConfigUtil.readVars(data);

      return GlobalConfigUtil.cache;
    })();

    try {
      return await GlobalConfigUtil.fetchPromise;
    } finally {
      GlobalConfigUtil.fetchPromise = null;
    }
  }

  // The vars in an answer: booleans only, each from its own field.
  public static readVars(data: JSONObject | null | undefined): GlobalConfigVars {
    return {
      disableUserProjectCreation: Boolean(data?.["disableUserProjectCreation"]),
      disablePushNotifications: Boolean(data?.["disablePushNotifications"]),
      canSendEmail: data?.["canSendEmail"] !== false,
    };
  }

  public static clearCache(): void {
    GlobalConfigUtil.cache = null;
  }
}
