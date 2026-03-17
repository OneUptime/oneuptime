import {
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BadDataException from "../../Types/Exception/BadDataException";
import GlobalConfig from "../../Models/DatabaseModels/GlobalConfig";
import GlobalConfigService from "../Services/GlobalConfigService";
import ObjectID from "../../Types/ObjectID";
import crypto from "crypto";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export default class WhatsAppAuthorization {
  @CaptureSpan()
  public static async isAuthorizedWhatsAppRequest(
    req: OneUptimeRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    logger.debug("Starting WhatsApp webhook signature verification");

    const signature: string | undefined = req.headers[
      "x-hub-signature-256"
    ] as string | undefined;

    if (!signature) {
      logger.error(
        "WhatsApp webhook request missing X-Hub-Signature-256 header.",
      );
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException(
          "Missing X-Hub-Signature-256 header.",
        ),
      );
    }

    const globalConfig: GlobalConfig | null =
      await GlobalConfigService.findOneBy({
        query: {
          _id: ObjectID.getZeroObjectID().toString(),
        },
        props: {
          isRoot: true,
        },
        select: {
          metaWhatsAppAppSecret: true,
        },
      });

    const appSecret: string | undefined =
      globalConfig?.metaWhatsAppAppSecret?.trim() || undefined;

    if (!appSecret) {
      logger.error(
        "Meta WhatsApp App Secret is not configured. Cannot verify webhook signature.",
      );
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException(
          "Meta WhatsApp App Secret is not configured.",
        ),
      );
    }

    const rawBody: string = req.rawBody || "";

    const expectedSignature: string = `sha256=${crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;

    if (
      !crypto.timingSafeEqual(
        Buffer.from(expectedSignature) as Uint8Array,
        Buffer.from(signature) as Uint8Array,
      )
    ) {
      logger.error("WhatsApp webhook signature verification failed.");
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException(
          "WhatsApp webhook signature verification failed.",
        ),
      );
    }

    logger.debug("WhatsApp webhook signature verified successfully");
    next();
  }
}
