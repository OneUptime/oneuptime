import { IDENTITY_URL } from "../../Config";
import Dictionary from "../../../Types/Dictionary";
import URL from "../../../Types/API/URL";
import API from "../../../Utils/API";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import JWTToken from "../JWT";
import ObjectID from "../../../Types/ObjectID";

const ACCESS_TOKEN_HEADER: string = "access_token";
const REFRESH_THRESHOLD_MS: number = 5 * 60 * 1000; // 5 minutes

export type SessionRefreshScope = "dashboard" | "admin" | "statusPage";

export type SessionRefreshOptions = {
  scope: SessionRefreshScope;
  statusPageId?: ObjectID | null;
};

export default class TokenRefresher {
  private static inFlightRefresh: Promise<void> | null = null;
  public static async handleAccessTokenHeader(
    headers: Dictionary<string>,
    options: SessionRefreshOptions | null,
  ): Promise<void> {
    if (!options) {
      return;
    }

    const rawHeaderValue: string | undefined = this.extractHeader(
      headers,
      ACCESS_TOKEN_HEADER,
    );

    if (!rawHeaderValue) {
      return;
    }

    const token: string = rawHeaderValue.trim();

    if (!token || token.length === 0) {
      return;
    }

    let expiry: number | null = null;

    try {
      const decoded: JSONObject = JWTToken.decodeToken(token);
      if (decoded && typeof decoded["exp"] === "number") {
        expiry = Math.floor(decoded["exp"] as number) * 1000; // seconds to ms
      }
    } catch (error) {
      // If token cannot be decoded just ignore refresh, backend will handle expiry
      return;
    }

    if (!expiry) {
      return;
    }

    if (!this.shouldRefresh(expiry)) {
      return;
    }

    await this.refreshTokens(options);
  }

  private static extractHeader(
    headers: Dictionary<string>,
    headerName: string,
  ): string | undefined {
    const normalizedHeaderName: string = headerName.toLowerCase();
    for (const key of Object.keys(headers || {})) {
      if (key.toLowerCase() === normalizedHeaderName) {
        return headers[key] as string;
      }
    }

    return undefined;
  }

  private static shouldRefresh(expiry: number): boolean {
    const now: number = Date.now();

    if (expiry <= now) {
      return true;
    }

    const remainingMs: number = expiry - now;
    if (remainingMs <= REFRESH_THRESHOLD_MS) {
      return true;
    }

    return false;
  }

  private static async refreshTokens(
    options: SessionRefreshOptions,
  ): Promise<void> {
    if (this.inFlightRefresh) {
      await this.inFlightRefresh;
      return;
    }

    const refreshUrl: URL | null = this.getRefreshUrl(options);

    if (!refreshUrl) {
      return;
    }

    this.inFlightRefresh = (async () => {
      try {
        const response:
          | HTTPResponse<JSONObject>
          | HTTPErrorResponse = await API.post({
          url: refreshUrl,
        });

        if (response instanceof HTTPErrorResponse) {
          // Let existing error handler manage authentication failures
          return;
        }
      } catch (error) {
        // Swallow refresh errors; subsequent API calls will surface auth issues
        return;
      } finally {
        this.inFlightRefresh = null;
      }
    })();

    await this.inFlightRefresh;
  }

  private static getRefreshUrl(
    options: SessionRefreshOptions,
  ): URL | null {
    switch (options.scope) {
      case "statusPage": {
        if (!options.statusPageId) {
          return null;
        }

        return URL.fromString(IDENTITY_URL.toString())
          .addRoute("/status-page/refresh-token")
          .addRoute(`/${options.statusPageId.toString()}`);
      }
      case "admin":
      case "dashboard":
      default: {
        return URL.fromString(IDENTITY_URL.toString()).addRoute(
          "/refresh-token",
        );
      }
    }
  }
}
