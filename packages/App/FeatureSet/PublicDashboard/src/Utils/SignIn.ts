import API from "./API";
import { PUBLIC_DASHBOARD_API_URL } from "./Config";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import {
  DASHBOARD_PRIVATE_USER_API_ROUTE,
  DashboardPrivateUserApiRoutes,
  DashboardSignInMethods,
} from "Common/Types/Dashboard/DashboardPrivateUserSignIn";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { IDENTITY_URL } from "Common/UI/Config";

/*
 * A dashboard's public link signs its private users in (#10250), on the
 * host it is served from, through the routes of
 * Common/Types/Dashboard/DashboardPrivateUserSignIn: each call here posts
 * JSON to one of them and hands back the server's answer, or throws it -
 * the page says what went wrong in the reader's words
 * (API.getFriendlyMessage). The session itself is kept in HttpOnly cookies
 * the server sets: nothing here sees or keeps a token.
 *
 * Single sign-on starts on OneUptime's own address, where the identity
 * providers send people back to (getSamlSignInUrl, getOidcSignInUrl).
 */
export default class PublicDashboardSignIn {
  public static getRouteUrl(route: string, dashboardId: ObjectID): URL {
    return URL.fromString(PUBLIC_DASHBOARD_API_URL.toString()).addRoute(
      `${DASHBOARD_PRIVATE_USER_API_ROUTE}${route}/${dashboardId.toString()}`,
    );
  }

  private static async post(data: {
    route: string;
    dashboardId: ObjectID;
    body?: JSONObject | undefined;
  }): Promise<JSONObject> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: PublicDashboardSignIn.getRouteUrl(data.route, data.dashboardId),
        data: data.body || {},
        options: {
          /*
           * A sign-in's own answers are never a session to renew: a wrong
           * password's 400 and a refresh's 401 are said on the page.
           */
          skipAuthRefresh: true,
        },
      });

    if (response.isFailure()) {
      throw response;
    }

    return (response.data as JSONObject) || {};
  }

  // Signs in with a password, and answers who signed in.
  public static async signIn(data: {
    dashboardId: ObjectID;
    email: string;
    password: string;
  }): Promise<string> {
    const answer: JSONObject = await PublicDashboardSignIn.post({
      route: DashboardPrivateUserApiRoutes.login,
      dashboardId: data.dashboardId,
      body: {
        data: {
          email: data.email,
          password: data.password,
        },
      },
    });

    return (answer["email"] as string) || data.email;
  }

  // Ends this browser's session on the dashboard. Never throws.
  public static async signOut(dashboardId: ObjectID): Promise<void> {
    try {
      await PublicDashboardSignIn.post({
        route: DashboardPrivateUserApiRoutes.logout,
        dashboardId,
      });
    } catch {
      // The server clears the cookies whatever else happens.
    }
  }

  // Emails the address a link to choose a password, if it is a private user.
  public static async forgotPassword(data: {
    dashboardId: ObjectID;
    email: string;
  }): Promise<void> {
    await PublicDashboardSignIn.post({
      route: DashboardPrivateUserApiRoutes.forgotPassword,
      dashboardId: data.dashboardId,
      body: {
        data: {
          email: data.email,
        },
      },
    });
  }

  // Sets a new password from a reset link's token.
  public static async resetPassword(data: {
    dashboardId: ObjectID;
    token: string;
    password: string;
  }): Promise<void> {
    await PublicDashboardSignIn.post({
      route: DashboardPrivateUserApiRoutes.resetPassword,
      dashboardId: data.dashboardId,
      body: {
        data: {
          resetPasswordToken: data.token,
          password: data.password,
        },
      },
    });
  }

  // Exchanges the code single sign-on handed back for a session on this host.
  public static async exchangeLoginCode(data: {
    dashboardId: ObjectID;
    loginCode: string;
  }): Promise<void> {
    await PublicDashboardSignIn.post({
      route: DashboardPrivateUserApiRoutes.exchangeLoginCode,
      dashboardId: data.dashboardId,
      body: {
        loginCode: data.loginCode,
      },
    });
  }

  // What the sign-in page offers: a password, and the providers that are on.
  public static async getSignInMethods(
    dashboardId: ObjectID,
  ): Promise<DashboardSignInMethods> {
    const answer: JSONObject = await PublicDashboardSignIn.post({
      route: DashboardPrivateUserApiRoutes.signInMethods,
      dashboardId,
    });

    return {
      isPasswordSignInAllowed: answer["isPasswordSignInAllowed"] !== false,
      samlProviders: Array.isArray(answer["samlProviders"])
        ? (answer[
            "samlProviders"
          ] as unknown as DashboardSignInMethods["samlProviders"])
        : [],
      oidcProviders: Array.isArray(answer["oidcProviders"])
        ? (answer[
            "oidcProviders"
          ] as unknown as DashboardSignInMethods["oidcProviders"])
        : [],
    };
  }

  // Where a SAML provider's sign-in starts: OneUptime's own address.
  public static getSamlSignInUrl(data: {
    dashboardId: ObjectID;
    providerId: string;
  }): URL {
    return URL.fromString(IDENTITY_URL.toString()).addRoute(
      `/dashboard-sso/${data.dashboardId.toString()}/${data.providerId}`,
    );
  }

  /*
   * Where an OIDC provider's sign-in starts: OneUptime's own address, so the
   * state cookie it sets is on the host the provider sends the visitor back
   * to.
   */
  public static getOidcSignInUrl(data: {
    dashboardId: ObjectID;
    providerId: string;
  }): URL {
    return URL.fromString(IDENTITY_URL.toString()).addRoute(
      `/dashboard-oidc/${data.dashboardId.toString()}/${data.providerId}`,
    );
  }
}
