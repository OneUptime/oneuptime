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
  getInboundEmailRecipientAddresses,
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
 *
 * Mail on the inbound domain is for an Incoming Email monitor
 * (monitor-{key}@, or a custom name) or for a workflow's Incoming Email
 * trigger (workflow-{key}@). Each address the email was delivered to is
 * queued as a job of its own, and the queue worker decides whether a monitor
 * or a workflow really owns it.
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
       * Work out which addresses on the inbound domain the mail was
       * delivered to: a monitor's generated monitor-{secretKey}@ address or
       * custom name, or a workflow's workflow-{secretKey}@ address. The
       * envelope says when the provider gives one - it is the only way to
       * know about a Bcc or a forwarding rule - and otherwise everyone in To
       * and Cc counts. Which monitor or workflow (if any) owns each address
       * is decided by the queue worker.
       */
      const recipients: Array<IncomingEmailRecipient> =
        IncomingEmailMonitorAddress.parseRecipients({
          emailAddresses: getInboundEmailRecipientAddresses(parsedEmail),
          inboundDomain: provider.getInboundDomain(),
        });

      if (recipients.length === 0) {
        logger.error(
          `Email is not addressed to a monitor or workflow address: ${parsedEmail.to}`,
          getLogAttributesFromRequest(req as any),
        );
        throw new BadDataException(
          "Invalid recipient. The email was not sent to the address of a monitor or a workflow on the inbound email domain.",
        );
      }

      for (const recipient of recipients) {
        logger.debug(
          `Email is addressed to a ${recipient.kind.toLowerCase()} address`,
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
          workflowSecretKey:
            recipient.kind === IncomingEmailRecipientKind.Workflow
              ? recipient.secretKey
              : undefined,
          emailFrom: parsedEmail.from,
          emailTo: parsedEmail.to,
          emailToAddresses: parsedEmail.toAddresses,
          emailCcAddresses: parsedEmail.ccAddresses,
          emailSubject: parsedEmail.subject,
          emailBody: parsedEmail.body,
          emailBodyHtml: parsedEmail.bodyHtml,
          emailHeaders: parsedEmail.headers,
          attachments: parsedEmail.attachments,
        });
      }

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
