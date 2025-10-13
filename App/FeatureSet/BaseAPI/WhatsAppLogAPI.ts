import BaseAPI from "Common/Server/API/BaseAPI";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import WhatsAppLog from "Common/Models/DatabaseModels/WhatsAppLog";
import WhatsAppLogService, {
  Service as WhatsAppLogServiceType,
} from "Common/Server/Services/WhatsAppLogService";
import CommonAPI from "Common/Server/API/CommonAPI";
import Response from "Common/Server/Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import ObjectID from "Common/Types/ObjectID";
import BadDataException from "Common/Types/Exception/BadDataException";
import WhatsAppStatus from "Common/Types/WhatsAppStatus";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import PartialEntity from "Common/Types/Database/PartialEntity";
import WhatsAppService from "../Notification/Services/WhatsAppService";

export default class WhatsAppLogAPI extends BaseAPI<
  WhatsAppLog,
  WhatsAppLogServiceType
> {
  public constructor() {
    super(WhatsAppLog, WhatsAppLogService);

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/:id/get-status`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const logId: ObjectID = new ObjectID(req.params["id"] as string);

          const log: WhatsAppLog | null = await this.service.findOneById({
            id: logId,
            select: {
              _id: true,
              whatsAppMessageId: true,
            },
            props: {
              isRoot: true,
            },
          });

          if (!log) {
            throw new BadDataException("WhatsApp log not found.");
          }

          if (!log.whatsAppMessageId) {
            throw new BadDataException(
              "WhatsApp message ID not available for this log.",
            );
          }

          const statusResult = await WhatsAppService.getWhatsAppMessageStatus(
            log.whatsAppMessageId,
          );

          const metaStatus: string =
            statusResult.status?.toString() || "unknown";

          const refreshedAt: string =
            OneUptimeDate.getCurrentDate().toISOString();

          const responseMessageId: string | undefined =
            statusResult.id || log.whatsAppMessageId?.toString();

          const statusMessageParts: Array<string> = [
            `Meta status: ${metaStatus}`,
          ];

          if (responseMessageId) {
            statusMessageParts.push(`Message ID: ${responseMessageId}`);
          }

          statusMessageParts.push(`Refreshed at ${refreshedAt}`);

          const statusMessage: string = statusMessageParts.join(" | ");

          const normalizedStatus: string = metaStatus.toLowerCase();

          const updateData: PartialEntity<WhatsAppLog> = {
            statusMessage,
          } as PartialEntity<WhatsAppLog>;

          if (
            ["failed", "undelivered", "error"].includes(normalizedStatus)
          ) {
            updateData.status = WhatsAppStatus.Error;
          } else if (
            ["sent", "delivered", "read", "submitted"].includes(
              normalizedStatus,
            )
          ) {
            updateData.status = WhatsAppStatus.Success;
          }

          const responseBody: JSONObject = {
            metaStatus,
            statusMessage,
            rawResponse: statusResult.rawResponse,
          };

          if (responseMessageId) {
            responseBody["messageId"] = responseMessageId;
          }

          return Response.sendJsonObjectResponse(req, res, responseBody);
        } catch (error) {
          return next(error);
        }
      },
    );
  }
}
