import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BadRequestException from "../../Types/Exception/BadRequestException";
import logger from "../Utils/Logger";
import ObjectID from "../../Types/ObjectID";
import MicrosoftTeamsAuthAction, {
  MicrosoftTeamsRequest,
} from "../Utils/Workspace/MicrosoftTeams/Actions/Auth";
import MicrosoftTeamsIncidentActions from "../Utils/Workspace/MicrosoftTeams/Actions/Incident";
import MicrosoftTeamsAlertActions from "../Utils/Workspace/MicrosoftTeams/Actions/Alert";
import MicrosoftTeamsScheduledMaintenanceActions from "../Utils/Workspace/MicrosoftTeams/Actions/ScheduledMaintenance";

export default class MicrosoftTeamsAPI {
  public getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    // Microsoft Teams webhook endpoint for handling interactive messages
    router.post(
      "/microsoft-teams/webhook/:projectId",
      async (req: ExpressRequest, res: ExpressResponse) => {
        logger.debug("Microsoft Teams Webhook Request: ");

        const authResult: MicrosoftTeamsRequest = await MicrosoftTeamsAuthAction.isAuthorized({
          req: req,
        });

        logger.debug("Microsoft Teams Webhook Auth Result: ");
        logger.debug(authResult);

        // if Microsoft Teams app uninstall then,
        if (authResult.payloadType === "app_uninstall") {
          logger.debug("Microsoft Teams App Uninstall Request: ");

          // return empty response.
          return Response.sendTextResponse(req, res, "");
        }

        if (authResult.isAuthorized === false) {
          // return empty response if not authorized. Do nothing in this case.
          return Response.sendTextResponse(req, res, "");
        }

        for (const action of authResult.actions || []) {
          if (!action.actionType) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadRequestException("Invalid request"),
            );
          }

          if (
            MicrosoftTeamsIncidentActions.isIncidentAction({
              actionType: action.actionType,
            })
          ) {
            return MicrosoftTeamsIncidentActions.handleIncidentAction({
              microsoftTeamsRequest: {
                ...authResult,
                action: action as any,
              },
              action: action as any,
              req: req,
              res: res,
            });
          }

          if (
            MicrosoftTeamsAlertActions.isAlertAction({
              actionType: action.actionType,
            })
          ) {
            return MicrosoftTeamsAlertActions.handleAlertAction({
              microsoftTeamsRequest: {
                ...authResult,
                action: action as any,
              },
              action: action as any,
              req: req,
              res: res,
            });
          }

          // Handle scheduled maintenance actions using the executeAction method
          if (
            action.actionType === "MarkScheduledMaintenanceAsOngoing" ||
            action.actionType === "MarkScheduledMaintenanceAsComplete"
          ) {
            if (action.scheduledMaintenanceId) {
              await MicrosoftTeamsScheduledMaintenanceActions.executeAction(
                action.actionType,
                new ObjectID(action.scheduledMaintenanceId),
                authResult.userId,
              );
              return Response.sendTextResponse(req, res, "");
            }
          }
        }

        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException("Invalid request"),
        );
      },
    );

    return router;
  }
}
