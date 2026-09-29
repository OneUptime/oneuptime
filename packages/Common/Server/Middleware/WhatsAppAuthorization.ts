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
import logger, { getLogAttributesFromRequest } from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * Meta sends the digest as "sha256=" followed by the 64 hex characters of a
 * SHA-256 HMAC. The header is attacker-controlled and the endpoint is
 * unauthenticated by design - the signature IS the authentication - so the
 * shape has to be checked before the value reaches crypto.timingSafeEqual,
 * which throws RangeError on a length mismatch rather than returning false.
 * Without the guard, any unauthenticated request carrying a signature header
 * of some other length threw out of the middleware instead of getting the
 * intended 400.
 */
const SIGNATURE_PREFIX: string = "sha256=";
const HEX_DIGEST_REGEX: RegExp = /^[a-f0-9]{64}$/i;

export default class WhatsAppAuthorization {
  @CaptureSpan()
  public static async isAuthorizedWhatsAppRequest(
    req: OneUptimeRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    logger.debug(
      "Starting WhatsApp webhook signature verification",
      getLogAttributesFromRequest(req),
    );

    const signature: string | undefined = req.headers["x-hub-signature-256"] as
      | string
      | undefined;

    if (!signature) {
      logger.error(
        "WhatsApp webhook request missing X-Hub-Signature-256 header.",
        getLogAttributesFromRequest(req),
      );
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Missing X-Hub-Signature-256 header."),
      );
    }

    /*
     * Checked up front, before the config lookup: a request whose signature
     * cannot possibly verify should not cost a database round trip.
     */
    const providedDigest: string = signature.startsWith(SIGNATURE_PREFIX)
      ? signature.slice(SIGNATURE_PREFIX.length)
      : "";

    if (!HEX_DIGEST_REGEX.test(providedDigest)) {
      logger.error(
        "WhatsApp webhook request has a malformed X-Hub-Signature-256 header.",
        getLogAttributesFromRequest(req),
      );
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("WhatsApp webhook signature verification failed."),
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
        getLogAttributesFromRequest(req),
      );
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Meta WhatsApp App Secret is not configured."),
      );
    }

    const rawBody: string = req.rawBody || "";

    const expectedDigest: string = crypto
      .createHmac("sha256", appSecret)
      .update(rawBody)
      .digest("hex");

    /*
     * Both sides are decoded from 64 validated hex characters, so both
     * buffers are 32 bytes and timingSafeEqual cannot throw here.
     */
    if (
      !crypto.timingSafeEqual(
        Buffer.from(expectedDigest, "hex") as Uint8Array,
        Buffer.from(providedDigest, "hex") as Uint8Array,
      )
    ) {
      logger.error(
        "WhatsApp webhook signature verification failed.",
        getLogAttributesFromRequest(req),
      );
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("WhatsApp webhook signature verification failed."),
      );
    }

    logger.debug(
      "WhatsApp webhook signature verified successfully",
      getLogAttributesFromRequest(req),
    );
    next();
  }
}
