import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import BadDataException from "Common/Types/Exception/BadDataException";
import logger, {
  getLogAttributesFromRequest,
} from "Common/Server/Utils/Logger";
import InboundEmailProviderFactory from "Common/Server/Services/InboundEmail/InboundEmailProviderFactory";
import InboundEmailProvider, {
  ParsedInboundEmail,
} from "Common/Server/Services/InboundEmail/InboundEmailProvider";
import { JSONObject } from "Common/Types/JSON";
import TelemetryQueueService from "../../Services/Queue/TelemetryQueueService";
import MultipartFormDataMiddleware from "Common/Server/Middleware/MultipartFormData";
import IncomingEmailMonitorAddress, {
  IncomingEmailRecipient,
  IncomingEmailRecipientKind,
} from "Common/Utils/Monitor/IncomingEmailMonitorAddress";

const router: ExpressRouter = Express.getRouter();

/*
 * Webhook endpoint for SendGrid inbound emails
 * SendGrid sends data as multipart/form-data
 * The webhook secret must be passed as the last path segment: /incoming-email/sendgrid/:secret
 */
router.post(
  "/incoming-email/sendgrid/:secret",
  MultipartFormDataMiddleware,
  async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      logger.debug(
        "Received incoming email webhook",
        getLogAttributesFromRequest(req as any),
      );

      // Log raw body for debugging
      logger.debug(
        `Request body keys: ${Object.keys(req.body || {}).join(", ")}`,
        getLogAttributesFromRequest(req as any),
      );

      // Check if inbound email is configured
      if (!InboundEmailProviderFactory.isConfigured()) {
        logger.error(
          "Inbound email is not configured",
          getLogAttributesFromRequest(req as any),
        );
        throw new BadDataException(
          "Inbound email is not configured. Please set the INBOUND_EMAIL_DOMAIN environment variable.",
        );
      }

      const provider: InboundEmailProvider =
        InboundEmailProviderFactory.getProvider();

      // Get the secret from the URL path if provided
      const pathSecret: string = req.params["secret"] || "";

      // Validate the webhook request (secret from path takes precedence)
      const isValid: boolean = await provider.validateWebhook({
        headers: req.headers as Record<string, string>,
        body: req.body as JSONObject,
        pathSecret: pathSecret,
      });

      if (!isValid) {
        logger.error(
          "Invalid webhook signature",
          getLogAttributesFromRequest(req as any),
        );
        throw new BadDataException("Invalid webhook signature");
      }

      // Parse the inbound email
      const parsedEmail: ParsedInboundEmail = await provider.parseInboundEmail(
        req.body as JSONObject,
      );

      logger.debug(
        `Parsed email from: ${parsedEmail.from}`,
        getLogAttributesFromRequest(req as any),
      );
      logger.debug(
        `Parsed email to: ${parsedEmail.to}`,
        getLogAttributesFromRequest(req as any),
      );
      logger.debug(
        `Parsed email subject: ${parsedEmail.subject}`,
        getLogAttributesFromRequest(req as any),
      );

      /*
       * Work out which monitor address the mail was sent to: a generated
       * monitor-{secretKey}@ address, or a custom name. Which monitor (if
       * any) owns it is decided by the queue worker.
       */
      const recipient: IncomingEmailRecipient | null =
        IncomingEmailMonitorAddress.parseRecipient({
          emailAddress: parsedEmail.to,
          inboundDomain: provider.getInboundDomain(),
        });

      if (!recipient) {
        logger.error(
          `Email is not addressed to a monitor address: ${parsedEmail.to}`,
          getLogAttributesFromRequest(req as any),
        );
        throw new BadDataException(
          "Invalid monitor email address. The email was not sent to a monitor's address on the inbound email domain.",
        );
      }

      logger.debug(
        `Email is addressed to a ${recipient.kind.toLowerCase()} monitor address`,
        getLogAttributesFromRequest(req as any),
      );

      // Queue the email for async processing using the unified Telemetry queue
      await TelemetryQueueService.addIncomingEmailJob({
        secretKey:
          recipient.kind === IncomingEmailRecipientKind.Generated
            ? recipient.secretKey
            : undefined,
        customLocalPart:
          recipient.kind === IncomingEmailRecipientKind.Custom
            ? recipient.localPart
            : undefined,
        emailFrom: parsedEmail.from,
        emailTo: parsedEmail.to,
        emailSubject: parsedEmail.subject,
        emailBody: parsedEmail.body,
        emailBodyHtml: parsedEmail.bodyHtml,
        emailHeaders: parsedEmail.headers,
        attachments: parsedEmail.attachments,
      });

      logger.debug(
        "Email queued for processing",
        getLogAttributesFromRequest(req as any),
      );

      // Return 202 Accepted immediately
      return Response.sendJsonObjectResponse(req, res, {
        status: "accepted",
        message: "Email queued for processing",
      });
    } catch (error) {
      logger.error(
        "Error processing incoming email webhook:",
        getLogAttributesFromRequest(req as any),
      );
      logger.error(error, getLogAttributesFromRequest(req as any));

      if (error instanceof BadDataException) {
        return Response.sendErrorResponse(req, res, error);
      }

      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Failed to process incoming email"),
      );
    }
  },
);

export default router;
