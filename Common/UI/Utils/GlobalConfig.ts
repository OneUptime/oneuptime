import URL from "../../Types/API/URL";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import { JSONObject } from "../../Types/JSON";
import API from "../../Utils/API";
import { APP_API_URL } from "../Config";

export interface GlobalConfigVars {
  disableUserProjectCreation: boolean;
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

      GlobalConfigUtil.cache = {
        disableUserProjectCreation: Boolean(data["disableUserProjectCreation"]),
      };

      return GlobalConfigUtil.cache;
    })();

    try {
      return await GlobalConfigUtil.fetchPromise;
    } finally {
      GlobalConfigUtil.fetchPromise = null;
    }
  }

  public static clearCache(): void {
    GlobalConfigUtil.cache = null;
  }
}
