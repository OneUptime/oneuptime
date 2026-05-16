import UserMiddleware from "../Middleware/UserAuthorization";
import UserWebhookService, {
  Service as UserWebhookServiceType,
} from "../Services/UserWebhookService";
import WebhookService from "../Services/WebhookService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import UserWebhook from "../../Models/DatabaseModels/UserWebhook";

export default class UserWebhookAPI extends BaseAPI<
  UserWebhook,
  UserWebhookServiceType
> {
  public constructor() {
    super(UserWebhook, UserWebhookService);

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/test`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          req = req as OneUptimeRequest;

          if (!req.body["itemId"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid item ID"),
            );
          }

          const item: UserWebhook | null = await this.service.findOneById({
            id: req.body["itemId"],
            props: {
              isRoot: true,
            },
            select: {
              userId: true,
              projectId: true,
              webhookUrl: true,
              secret: true,
              name: true,
            },
          });

          if (!item) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Item not found"),
            );
          }

          if (
            item.userId?.toString() !==
            (req as OneUptimeRequest)?.userAuthorization?.userId?.toString()
          ) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid user ID"),
            );
          }

          const payload: JSONObject = {
            eventType: "test",
            timestamp: new Date().toISOString(),
            projectId: item.projectId?.toString() || "",
            userId: item.userId?.toString() || "",
            message:
              "This is a OneUptime test webhook. Your endpoint is reachable.",
          };

          const sendResult: {
            ok: boolean;
            statusCode?: number | undefined;
            message: string;
          } = await this.deliverTestWebhook({
            url: item.webhookUrl!,
            secret: item.secret || undefined,
            payload,
            projectId: item.projectId!.toString(),
            userId: item.userId!.toString(),
          });

          return Response.sendJsonObjectResponse(req, res, {
            ok: sendResult.ok,
            responseStatusCode: sendResult.statusCode || null,
            statusMessage: sendResult.message,
          });
        } catch (err) {
          return next(err);
        }
      },
    );
  }

  private async deliverTestWebhook(input: {
    url: string;
    secret?: string | undefined;
    payload: JSONObject;
    projectId: string;
    userId: string;
  }): Promise<{
    ok: boolean;
    statusCode?: number | undefined;
    message: string;
  }> {
    try {
      const response: { isFailure?: () => boolean; statusCode?: number } =
        (await WebhookService.sendWebhook(
          {
            url: input.url,
            eventType: "test",
            payload: input.payload,
            secret: input.secret,
          },
          {
            projectId: new ObjectID(input.projectId),
            userId: new ObjectID(input.userId),
          },
        )) as { isFailure?: () => boolean; statusCode?: number };

      if (
        response &&
        typeof response.isFailure === "function" &&
        response.isFailure()
      ) {
        return {
          ok: false,
          statusCode: response.statusCode,
          message: `Test webhook dispatch failed (status ${response.statusCode}). Check the Webhook Logs for details.`,
        };
      }

      return {
        ok: true,
        statusCode: response?.statusCode,
        message:
          "Test webhook dispatched. Check the Webhook Logs and your endpoint for the delivered request.",
      };
    } catch (err) {
      const message: string =
        err instanceof Error && err.message
          ? err.message
          : "Unknown error sending test webhook.";
      return { ok: false, message };
    }
  }
}
