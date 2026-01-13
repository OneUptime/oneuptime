import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import BadDataException from "Common/Types/Exception/BadDataException";
import logger from "Common/Server/Utils/Logger";
import InboundEmailProviderFactory from "Common/Server/Services/InboundEmail/InboundEmailProviderFactory";
import InboundEmailProvider, {
  ParsedInboundEmail,
} from "Common/Server/Services/InboundEmail/InboundEmailProvider";
import { JSONObject } from "Common/Types/JSON";
import ProbeIngestQueueService from "../Services/Queue/ProbeIngestQueueService";

const router: ExpressRouter = Express.getRouter();

// Main webhook endpoint for inbound emails
router.post(
  "/incoming-email/webhook",
  async (req: ExpressRequest, res: ExpressResponse) => {
    try {
      logger.debug("Received incoming email webhook");

      // Check if inbound email is configured
      if (!InboundEmailProviderFactory.isConfigured()) {
        logger.error("Inbound email is not configured");
        throw new BadDataException(
          "Inbound email is not configured. Please set the INBOUND_EMAIL_DOMAIN environment variable.",
        );
      }

      const provider: InboundEmailProvider =
        InboundEmailProviderFactory.getProvider();

      // Validate the webhook request
      const isValid: boolean = await provider.validateWebhook({
        headers: req.headers as Record<string, string>,
        body: req.body as JSONObject,
        rawBody: (req as ExpressRequest & { rawBody?: string }).rawBody,
      });

      if (!isValid) {
        logger.error("Invalid webhook signature");
        throw new BadDataException("Invalid webhook signature");
      }

      // Parse the inbound email
      const parsedEmail: ParsedInboundEmail = await provider.parseInboundEmail(
        req.body as JSONObject,
      );

      logger.debug(`Parsed email from: ${parsedEmail.from}`);
      logger.debug(`Parsed email to: ${parsedEmail.to}`);
      logger.debug(`Parsed email subject: ${parsedEmail.subject}`);

      // Extract secret key from the "to" address
      const secretKey: string | null = provider.extractSecretKeyFromEmail(
        parsedEmail.to,
      );

      if (!secretKey) {
        logger.error(
          `Could not extract secret key from email: ${parsedEmail.to}`,
        );
        throw new BadDataException(
          "Invalid monitor email address. Could not extract secret key.",
        );
      }

      logger.debug(`Extracted secret key: ${secretKey}`);

      // Queue the email for async processing using the unified ProbeIngest queue
      await ProbeIngestQueueService.addIncomingEmailJob({
        secretKey: secretKey,
        emailFrom: parsedEmail.from,
        emailTo: parsedEmail.to,
        emailSubject: parsedEmail.subject,
        emailBody: parsedEmail.textBody,
        emailBodyHtml: parsedEmail.htmlBody,
        emailHeaders: parsedEmail.headers,
        attachments: parsedEmail.attachments,
      });

      logger.debug("Email queued for processing");

      // Return 202 Accepted immediately
      return Response.sendJsonObjectResponse(req, res, {
        status: "accepted",
        message: "Email queued for processing",
      });
    } catch (error) {
      logger.error("Error processing incoming email webhook:");
      logger.error(error);

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
