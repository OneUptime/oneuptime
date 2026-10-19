import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import BadDataException from "Common/Types/Exception/BadDataException";
import ForbiddenException from "Common/Types/Exception/ForbiddenException";
import ServiceUnavailableException from "Common/Types/Exception/ServiceUnavailableException";
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

export const INBOUND_EMAIL_NOT_CONFIGURED_MESSAGE: string =
  "Inbound email is not configured. Please set the INBOUND_EMAIL_DOMAIN environment variable.";

export const INBOUND_EMAIL_NO_WEBHOOK_SECRET_MESSAGE: string =
  "Incoming email is not ready on this server: set INBOUND_EMAIL_WEBHOOK_SECRET to a long random value of its own.";

export const INBOUND_EMAIL_WRONG_WEBHOOK_SECRET_MESSAGE: string =
  "The webhook URL does not end with this server's INBOUND_EMAIL_WEBHOOK_SECRET.";

/*
 * Who may deliver an email, decided from the address a request was posted to
 * before its body is read, so a request that cannot prove it comes from the
 * mail provider is refused without parsing a byte of what it sent:
 *
 *   - incoming email off (no INBOUND_EMAIL_DOMAIN): 400, as it always was;
 *   - no webhook secret the installation may use (unset, blank, or a value
 *     the repository or the setup guide publishes): 503 for every delivery,
 *     as nothing could tell the provider's from anybody else's. SendGrid
 *     retries a 5xx for up to three days, so the mail sent while an operator
 *     sets the secret arrives once it is set; the app says what to set when
 *     it starts (EnvironmentConfig.InboundEmailWebhookSecretWarning);
 *   - an address that does not end with the installation's secret: 403.
 */
const refuseUnlessFromMailProvider: (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void> = async (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!InboundEmailProviderFactory.isConfigured()) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException(INBOUND_EMAIL_NOT_CONFIGURED_MESSAGE),
      );
    }

    const provider: InboundEmailProvider =
      InboundEmailProviderFactory.getProvider();

    if (!provider.hasWebhookSecret()) {
      return Response.sendErrorResponse(
        req,
        res,
        new ServiceUnavailableException(
          INBOUND_EMAIL_NO_WEBHOOK_SECRET_MESSAGE,
        ),
      );
    }

    const isFromProvider: boolean = await provider.validateWebhook({
      headers: req.headers as Record<string, string>,
      pathSecret: req.params["secret"] || "",
    });

    if (!isFromProvider) {
      return Response.sendErrorResponse(
        req,
        res,
        new ForbiddenException(INBOUND_EMAIL_WRONG_WEBHOOK_SECRET_MESSAGE),
      );
    }

    return next();
  } catch (err) {
    return next(err);
  }
};

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
 *
 * Only a request refuseUnlessFromMailProvider lets through has its body read.
 */
router.post(
  "/incoming-email/sendgrid/:secret",
  refuseUnlessFromMailProvider,
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

      const provider: InboundEmailProvider =
        InboundEmailProviderFactory.getProvider();

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
