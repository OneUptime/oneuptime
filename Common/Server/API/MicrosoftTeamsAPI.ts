import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import {
  AppApiClientUrl,
  DashboardClientUrl,
  MicrosoftTeamsAppClientId,
  MicrosoftTeamsAppClientSecret,
} from "../EnvironmentConfig";
import URL from "../../Types/API/URL";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import API from "../../Utils/API";
import WorkspaceProjectAuthTokenService from "../Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../Services/WorkspaceUserAuthTokenService";
import ObjectID from "../../Types/ObjectID";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";

export default class MicrosoftTeamsAPI {
  public getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    // Project-level OAuth callback
    router.get(
      "/microsoft-teams/auth/:projectId/:userId",
      async (req: ExpressRequest, res: ExpressResponse) => {
        if (!MicrosoftTeamsAppClientId) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Microsoft Teams App Client ID is not set"),
          );
        }

        if (!MicrosoftTeamsAppClientSecret) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException(
              "Microsoft Teams App Client Secret is not set",
            ),
          );
        }

        const projectId: string | undefined =
          req.params["projectId"]?.toString();
        const userId: string | undefined = req.params["userId"]?.toString();

        if (!projectId) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Invalid ProjectID in request"),
          );
        }

        if (!userId) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Invalid UserID in request"),
          );
        }

        const error: string | undefined = req.query["error"]?.toString();
        const integrationPageUrl: URL = URL.fromString(
          DashboardClientUrl.toString() +
            `/${projectId.toString()}/settings/microsoft-teams-integration`,
        );

        if (error) {
          return Response.redirect(
            req,
            res,
            integrationPageUrl.addQueryParam("error", error),
          );
        }

        const code: string | undefined = req.query["code"]?.toString();
        const tenant: string | undefined = req.query["tenant"]?.toString();

        if (!code) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Invalid request"),
          );
        }

        const tenantSegment: string = tenant || "common";
        const redirectUri: URL = URL.fromString(
          `${AppApiClientUrl.toString()}/microsoft-teams/auth/${projectId}/${userId}`,
        );

        const tokenEndpoint: URL = URL.fromString(
          `https://login.microsoftonline.com/${tenantSegment}/oauth2/v2.0/token`,
        );

        const requestBody: JSONObject = {
          client_id: MicrosoftTeamsAppClientId,
          client_secret: MicrosoftTeamsAppClientSecret,
          code: code,
          grant_type: "authorization_code",
          redirect_uri: redirectUri.toString(),
        };

        const tokenResp: HTTPErrorResponse | HTTPResponse<JSONObject> =
          await API.post(tokenEndpoint, requestBody, {
            "Content-Type": "application/x-www-form-urlencoded",
          });

        if (tokenResp instanceof HTTPErrorResponse) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException(
              tokenResp.message || "Failed to exchange code for token",
            ),
          );
        }

        const tokenJson: JSONObject = tokenResp.data;
        const accessToken: string = (tokenJson["access_token"] as string) || "";
        const idToken: string | undefined = tokenJson["id_token"] as string | undefined;

        const tenantId: string | undefined = ((): string | undefined => {
          try {
            if (!idToken) {
              return undefined;
            }
            const payload: JSONObject = JSON.parse(
              Buffer.from(idToken.split(".")?.[1] || "", "base64").toString(
                "utf8",
              ),
            );
            return (payload["tid"] as string) || undefined;
          } catch {
            return undefined;
          }
        })();

        await WorkspaceProjectAuthTokenService.refreshAuthToken({
          projectId: new ObjectID(projectId),
          workspaceType: WorkspaceType.MicrosoftTeams,
          authToken: accessToken,
          workspaceProjectId: tenantId || "microsoft-teams",
          miscData: {
            tenantId: tenantId || "",
          },
        });

        await WorkspaceUserAuthTokenService.refreshAuthToken({
          projectId: new ObjectID(projectId),
          userId: new ObjectID(userId),
          workspaceType: WorkspaceType.MicrosoftTeams,
          authToken: accessToken,
          workspaceUserId: "",
          miscData: {},
        });

        return Response.redirect(req, res, integrationPageUrl);
      },
    );

    return router;
  }
}
