import FixedWindowRateLimiter, {
  RateLimitDecision,
} from "../Utils/FixedWindowRateLimiter";
import {
  RESELLER_INQUIRY_INBOX_VARIABLE,
  RESELLER_INQUIRY_PATH,
  ResellerInquiryField,
  ResellerInquiryInbox,
  ResellerInquiryParseResult,
  buildResellerInquiryEmail,
  getConfiguredResellerInquiryInbox,
  parseResellerInquiry,
} from "../Utils/ResellerInquiry";
import EmptyResponseData from "Common/Types/API/EmptyResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
} from "Common/Server/Utils/Express";
import MailService from "Common/Server/Services/MailService";
import resolveClientIp from "Common/Server/Utils/ClientIp";
import logger from "Common/Server/Utils/Logger";
import SameOriginRequest from "Common/Server/Utils/SameOriginRequest";

/*
 * POST /resellers/contact: THE RESELLERS PAGE'S FORM, SENT AS ONE EMAIL.
 *
 * Anyone can call this - there is no session on the marketing site - so,
 * in this order:
 *
 *  1. A request a browser sent from another site's page is refused
 *     (SameOriginRequest): the page's own posts come from this site.
 *  2. The body must be JSON. A plain HTML form on another site can post a
 *     urlencoded body without a preflight; a JSON one it cannot.
 *  3. Each sender (by address, ClientIp) gets PER_SENDER_LIMIT requests an
 *     hour, the refused ones included.
 *  4. The answers are checked and cleaned (ResellerInquiry.ts). A form a
 *     program filled in (the honeypot) is answered as sent, and not sent.
 *  5. All senders together get OVERALL_LIMIT emails an hour, so a flood
 *     from many addresses still sends no more than that.
 *  6. One email goes to the one configured inbox (RESELLER_INQUIRY_EMAIL,
 *     else sales@oneuptime.com) through the Notification service, as every
 *     other email does (MailService).
 *
 * Every answer is JSON - { sent, message, field? } - and never cached. The
 * page shows the message, and points at the field to fix. Nothing about an
 * inquiry is logged or kept: the email is its only record.
 */

export const PER_SENDER_LIMIT: number = 5;
export const OVERALL_LIMIT: number = 20;
export const RATE_LIMIT_WINDOW_IN_MS: number = 60 * 60 * 1000;

// How many senders are counted at once (FixedWindowRateLimiter.maxKeys).
export const MAX_COUNTED_SENDERS: number = 10000;

// How long to wait for the Notification service to take the email.
export const MAIL_TIMEOUT_IN_MS: number = 15000;

// Requests whose address cannot be told share one count.
export const UNKNOWN_SENDER: string = "unknown";

const OVERALL_KEY: string = "all";

export const SENT_MESSAGE: string =
  "Thanks. We got your message and will reply by email.";

export const FOREIGN_PAGE_MESSAGE: string =
  "Please send this form from the Resellers page of our website.";

export const NOT_JSON_MESSAGE: string = "Please send the form as JSON.";

export const TOO_MANY_FROM_SENDER_MESSAGE: string =
  "You have sent several messages in a short time. Please try again later.";

export const TOO_MANY_OVERALL_MESSAGE: string =
  "We are getting more messages than usual. Please try again later.";

export const NOT_SENT_MESSAGE: string =
  "We could not send your message just now. Please try again in a few minutes.";

export interface ResellerInquiryAnswer {
  sent: boolean;
  message: string;
  field?: ResellerInquiryField;
}

export type SendResellerInquiryEmail = (
  mail: EmailMessage,
) => Promise<HTTPResponse<EmptyResponseData> | HTTPErrorResponse>;

export interface ResellerInquiryHandlerOptions {
  // Where every inquiry goes.
  inbox: Email;
  sendMail: SendResellerInquiryEmail;
  perSender: FixedWindowRateLimiter;
  overall: FixedWindowRateLimiter;
  // SameOriginRequest.getInstanceOrigin(): this site's own origin.
  instanceOrigin: string | null;
  // The sender's address; ClientIp's reading unless a test sets one.
  clientIpOf?: ((req: ExpressRequest) => string | undefined) | undefined;
}

const answer: (
  res: ExpressResponse,
  status: number,
  body: ResellerInquiryAnswer,
  retryAfterSeconds?: number,
) => void = (
  res: ExpressResponse,
  status: number,
  body: ResellerInquiryAnswer,
  retryAfterSeconds?: number,
): void => {
  res.setHeader("Cache-Control", "no-store");

  if (retryAfterSeconds) {
    res.setHeader("Retry-After", String(retryAfterSeconds));
  }

  res.status(status).json(body);
};

export const createResellerInquiryHandler: (
  options: ResellerInquiryHandlerOptions,
) => (req: ExpressRequest, res: ExpressResponse) => Promise<void> = (
  options: ResellerInquiryHandlerOptions,
): ((req: ExpressRequest, res: ExpressResponse) => Promise<void>) => {
  const clientIpOf: (req: ExpressRequest) => string | undefined =
    options.clientIpOf ||
    ((req: ExpressRequest): string | undefined => {
      return resolveClientIp(req);
    });

  return async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    if (
      SameOriginRequest.isForeignPageRequest({
        headers: req.headers,
        instanceOrigin: options.instanceOrigin,
      })
    ) {
      return answer(res, 403, { sent: false, message: FOREIGN_PAGE_MESSAGE });
    }

    if (!SameOriginRequest.isJsonContentType(req.headers["content-type"])) {
      return answer(res, 415, { sent: false, message: NOT_JSON_MESSAGE });
    }

    const sender: RateLimitDecision = options.perSender.consume(
      clientIpOf(req) || UNKNOWN_SENDER,
    );

    if (!sender.allowed) {
      return answer(
        res,
        429,
        { sent: false, message: TOO_MANY_FROM_SENDER_MESSAGE },
        sender.retryAfterSeconds,
      );
    }

    const parsed: ResellerInquiryParseResult = parseResellerInquiry(req.body);

    if (parsed.kind === "trap") {
      logger.info(
        "Reseller inquiry: a form filled in by a program was answered and not sent.",
      );
      return answer(res, 200, { sent: true, message: SENT_MESSAGE });
    }

    if (parsed.kind === "invalid") {
      const body: ResellerInquiryAnswer = {
        sent: false,
        message: parsed.message,
      };

      if (parsed.field) {
        body.field = parsed.field;
      }

      return answer(res, 400, body);
    }

    const overall: RateLimitDecision = options.overall.consume(OVERALL_KEY);

    if (!overall.allowed) {
      logger.warn(
        `Reseller inquiry: more than ${OVERALL_LIMIT} inquiries this hour; refusing until the hour is up.`,
      );
      return answer(
        res,
        429,
        { sent: false, message: TOO_MANY_OVERALL_MESSAGE },
        overall.retryAfterSeconds,
      );
    }

    try {
      const sent: HTTPResponse<EmptyResponseData> | HTTPErrorResponse =
        await options.sendMail(
          buildResellerInquiryEmail(parsed.inquiry, options.inbox),
        );

      if (sent instanceof HTTPErrorResponse) {
        logger.error(
          `Reseller inquiry: the Notification service did not send the email (status ${sent.statusCode}).`,
        );
        return answer(res, 502, { sent: false, message: NOT_SENT_MESSAGE });
      }
    } catch (err) {
      logger.error("Reseller inquiry: the email could not be sent.");
      logger.error(err);
      return answer(res, 502, { sent: false, message: NOT_SENT_MESSAGE });
    }

    return answer(res, 200, { sent: true, message: SENT_MESSAGE });
  };
};

/*
 * The production settings: the configured inbox, the limits above, this
 * site's origin, and Common's MailService, which hands the email to the
 * Notification service with the cluster key, as every service's email is.
 */
export const createDefaultResellerInquiryOptions: () => ResellerInquiryHandlerOptions =
  (): ResellerInquiryHandlerOptions => {
    const configured: ResellerInquiryInbox =
      getConfiguredResellerInquiryInbox();

    if (configured.ignoredValue) {
      logger.warn(
        `${RESELLER_INQUIRY_INBOX_VARIABLE} is not an email address, so reseller inquiries go to ${configured.inbox.toString()}.`,
      );
    }

    return {
      inbox: configured.inbox,
      sendMail: async (
        mail: EmailMessage,
      ): Promise<HTTPResponse<EmptyResponseData> | HTTPErrorResponse> => {
        return await MailService.sendMail(mail, {
          timeoutInMs: MAIL_TIMEOUT_IN_MS,
        });
      },
      perSender: new FixedWindowRateLimiter({
        limit: PER_SENDER_LIMIT,
        windowInMs: RATE_LIMIT_WINDOW_IN_MS,
        maxKeys: MAX_COUNTED_SENDERS,
      }),
      overall: new FixedWindowRateLimiter({
        limit: OVERALL_LIMIT,
        windowInMs: RATE_LIMIT_WINDOW_IN_MS,
        maxKeys: 1,
      }),
      instanceOrigin: SameOriginRequest.getInstanceOrigin(),
    };
  };

export const registerResellerInquiryRoute: (
  app: ExpressApplication,
  options: ResellerInquiryHandlerOptions,
) => void = (
  app: ExpressApplication,
  options: ResellerInquiryHandlerOptions,
): void => {
  app.post(RESELLER_INQUIRY_PATH, createResellerInquiryHandler(options));
};
