import HttpMailApi, {
  MailApiAnswer,
  MailApiSendException,
} from "./HttpMailApi";
import InlineImageAttachments, {
  ResendInlineAttachment,
} from "./InlineImageAttachments";
import InlineImageRefusal from "./InlineImageRefusal";
import formatMailbox, { toOneLine } from "./MailboxAddress";
import MailProvider, { MailProviderSendOptions } from "./MailProvider";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";
import BadDataException from "Common/Types/Exception/BadDataException";
import { EmailInlineImage } from "Common/Server/Utils/Mail/EmailInlineImages";
import EmailPlainText from "Common/Server/Utils/Mail/EmailPlainText";
import logger from "Common/Server/Utils/Logger";
import ProductBrandingText from "Common/Server/Utils/ProductBrandingText";
import { randomUUID } from "crypto";

/*
 * SENDS MAIL THROUGH RESEND: POST https://api.resend.com/emails with the API
 * key as a bearer token (https://resend.com/docs/api-reference/emails/send-email).
 *
 * The email is Resend's JSON: from, to, subject, html and text, and each
 * inline image an attachment with the content_id its HTML points at
 * (https://resend.com/docs/dashboard/emails/embed-inline-images). A text
 * part with no words is sent as "", which tells Resend to send the HTML
 * alone rather than write a text part of its own.
 *
 * Two headers Resend asks for: a User-Agent (a request without one is
 * refused before it reaches the API), and an Idempotency-Key, the same on
 * every try of one email, so a retry after a timeout cannot send it twice.
 *
 * What the customer sets up in Resend: a verified domain for the From Email,
 * and an API key that may send. Resend's own resend.dev domain sends only to
 * the account's own address.
 */

export const RESEND_SEND_URL: string = "https://api.resend.com/emails";

const PROVIDER_NAME: string = "Resend";

// The JSON body of a send, as this provider writes it.
export interface ResendSendEmailRequest {
  from: string;
  to: Array<string>;
  subject: string;
  html: string;
  text: string;
  attachments?: Array<ResendInlineAttachment>;
}

// Resend's answer to a refusal: {"name", "statusCode", "message"}.
export interface ResendError {
  name: string;
  message: string;
}

// The quotas Resend refuses with HTTP 429 that no retry this hour gets past.
const RESEND_QUOTA_ERRORS: ReadonlyArray<string> = [
  "daily_quota_exceeded",
  "monthly_quota_exceeded",
];

export default class ResendMailProvider implements MailProvider {
  public static buildRequest(data: {
    mail: EmailMessage;
    emailServer: EmailServer;
    inlineImages: Array<EmailInlineImage>;
  }): ResendSendEmailRequest {
    const html: string = data.mail.body || "";

    return {
      from: formatMailbox({
        name: data.emailServer.fromName,
        address: data.emailServer.fromEmail.toString(),
      }),
      to: [data.mail.toEmail.toString()],
      subject: toOneLine(data.mail.subject || ""),
      html: html,
      text: EmailPlainText.fromHtml(html),
      ...(data.inlineImages.length > 0
        ? {
            attachments: InlineImageAttachments.forResend(data.inlineImages),
          }
        : {}),
    };
  }

  // The User-Agent Resend asks for: the product's own name.
  public static getUserAgent(): string {
    return `${
      ProductBrandingText.getProductName()
        .replace(/[^\x20-\x7e]/g, "")
        .trim() || "OneUptime"
    } Mail`;
  }

  public async send(
    mail: EmailMessage,
    emailServer: EmailServer,
    options?: MailProviderSendOptions | undefined,
  ): Promise<void> {
    const apiKey: string = emailServer.apiKey?.trim() || "";

    if (!apiKey) {
      throw new BadDataException("Resend needs an API Key.").asUserError();
    }

    const inlineImages: Array<EmailInlineImage> = options?.inlineImages || [];
    const bodyText: string = JSON.stringify(
      ResendMailProvider.buildRequest({
        mail: mail,
        emailServer: emailServer,
        inlineImages: inlineImages,
      }),
    );

    // One key for every try of this email.
    const idempotencyKey: string = randomUUID();

    await HttpMailApi.withSendSlot(
      HttpMailApi.getSlotKey({
        providerName: PROVIDER_NAME,
        configId: emailServer.id?.toString(),
        credential: apiKey,
      }),
      async (): Promise<void> => {
        await HttpMailApi.sendWithRetry({
          providerName: PROVIDER_NAME,
          timeoutMs: options?.timeoutMs,
          attempt: async (requestTimeoutMs: number): Promise<void> => {
            const answer: MailApiAnswer = await HttpMailApi.post({
              providerName: PROVIDER_NAME,
              request: {
                url: RESEND_SEND_URL,
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  "Content-Type": "application/json",
                  "User-Agent": ResendMailProvider.getUserAgent(),
                  "Idempotency-Key": idempotencyKey,
                },
                body: bodyText,
              },
              timeoutMs: requestTimeoutMs,
            });

            if (answer.status >= 200 && answer.status < 300) {
              logger.debug(
                `Resend accepted the email (HTTP ${answer.status}).`,
              );
              return;
            }

            throw ResendMailProvider.explainError(answer, {
              fromEmail: emailServer.fromEmail.toString(),
              hadInlineImages: inlineImages.length > 0,
              secrets: [apiKey],
            });
          },
        });
      },
    );
  }

  public static readError(answer: MailApiAnswer): ResendError {
    const body: unknown = HttpMailApi.readJson(answer.bodyText);
    const record: Record<string, unknown> =
      body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const name: unknown = record["name"];
    const message: unknown = record["message"];

    return {
      name: typeof name === "string" ? name.trim() : "",
      message:
        typeof message === "string" && message.trim()
          ? message.trim()
          : !body
            ? (answer.bodyText || "").trim()
            : "",
    };
  }

  public static explainError(
    answer: MailApiAnswer,
    options: {
      fromEmail: string;
      hadInlineImages: boolean;
      secrets: Array<string | undefined>;
    },
  ): MailApiSendException {
    const error: ResendError = ResendMailProvider.readError(answer);
    const said: string = HttpMailApi.scrub(
      [error.name, error.message].filter(Boolean).join(": "),
      options.secrets,
    );
    const words: string = error.message.toLowerCase();
    const status: string = `HTTP ${answer.status}${error.name ? ` ${error.name}` : ""}`;
    const isQuota: boolean = RESEND_QUOTA_ERRORS.includes(error.name);
    const domain: string = options.fromEmail.split("@")[1] || options.fromEmail;

    let meaning: string = `Resend did not send the email (${status}).`;

    if (
      words.includes("testing emails") ||
      words.includes("own email address")
    ) {
      meaning = `Resend's test domain sends only to the account's own address (${status}). Verify a domain of your own in Resend and send from an address at it.`;
    } else if (words.includes("not verified")) {
      meaning = `${domain} is not a verified domain in Resend (${status}). Add and verify it under Domains, then send from an address at it.`;
    } else if (
      answer.status === 401 ||
      error.name === "missing_api_key" ||
      error.name === "invalid_api_key" ||
      words.includes("api key is invalid")
    ) {
      meaning = `Resend did not accept the API key (${status}). Check the Resend API Key.`;
    } else if (
      error.name === "restricted_api_key" ||
      error.name === "suspended_api_key" ||
      (answer.status === 403 && words.includes("api key"))
    ) {
      meaning = `The Resend API key may not send email (${status}). Use a key with sending access.`;
    } else if (isQuota) {
      meaning = `The Resend account has sent all the email its plan allows for now (${status}).`;
    } else if (answer.status === 429) {
      meaning = `Resend is limiting how fast this account sends (${status}).`;
    } else if (answer.status === 413) {
      meaning = `Resend would not take an email this large (${status}).`;
    } else if (answer.status === 422 || answer.status === 400) {
      meaning = `Resend refused the email (${status}).`;
    }

    return new MailApiSendException(
      said ? `${meaning} Resend said: ${said}` : meaning,
      {
        statusCode: answer.status,
        isRetryable: !isQuota && HttpMailApi.isRetryableStatus(answer.status),
        retryAfterSeconds: HttpMailApi.parseRetryAfter(
          answer.headers.get("retry-after"),
        ),
        refusedInlineImages:
          options.hadInlineImages &&
          InlineImageRefusal.isResendRefusal(
            answer.status,
            error.name,
            error.message,
          ),
      },
    );
  }
}
