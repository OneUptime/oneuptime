import HttpMailApi, {
  MailApiAnswer,
  MailApiSendException,
} from "./HttpMailApi";
import InlineImageAttachments, {
  PostmarkInlineAttachment,
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

/*
 * SENDS MAIL THROUGH POSTMARK: POST https://api.postmarkapp.com/email with
 * the server's API token in X-Postmark-Server-Token
 * (https://postmarkapp.com/developer/api/email-api).
 *
 * The email is Postmark's JSON: From, To, Subject, HtmlBody and TextBody,
 * and each inline image an attachment whose ContentID is "cid:" and the
 * Content-ID the HTML points at - as Postmark's own examples write it. It
 * goes out on the server's default transactional stream ("outbound").
 *
 * What the customer sets up in Postmark: a server, its API token, and a
 * confirmed sender signature for the From Email (or its domain verified).
 * Postmark answers a refusal with an ErrorCode, read here into what to
 * change (https://postmarkapp.com/developer/api/overview#error-codes).
 */

export const POSTMARK_SEND_URL: string = "https://api.postmarkapp.com/email";

const PROVIDER_NAME: string = "Postmark";

// The JSON body of a send, as this provider writes it.
export interface PostmarkSendEmailRequest {
  From: string;
  To: string;
  Subject: string;
  HtmlBody: string;
  TextBody?: string;
  Attachments?: Array<PostmarkInlineAttachment>;
}

// Postmark's answer to a refusal: {"ErrorCode": 300, "Message": "..."}.
export interface PostmarkError {
  errorCode: number | undefined;
  message: string;
}

// The ErrorCodes this provider says more about.
export enum PostmarkErrorCode {
  BadOrMissingServerToken = 10,
  InvalidEmailRequest = 300,
  InvalidJson = 402,
  InactiveRecipient = 406,
  AttachmentTypeNotAllowed = 411,
  AccountPendingApproval = 412,
  AccountNotAllowedToSend = 413,
  MessageStreamNotFound = 1235,
}

export default class PostmarkMailProvider implements MailProvider {
  public static buildRequest(data: {
    mail: EmailMessage;
    emailServer: EmailServer;
    inlineImages: Array<EmailInlineImage>;
  }): PostmarkSendEmailRequest {
    const html: string = data.mail.body || "";
    const text: string = EmailPlainText.fromHtml(html);

    return {
      From: formatMailbox({
        name: data.emailServer.fromName,
        address: data.emailServer.fromEmail.toString(),
      }),
      To: data.mail.toEmail.toString(),
      Subject: toOneLine(data.mail.subject || ""),
      HtmlBody: html,
      ...(text ? { TextBody: text } : {}),
      ...(data.inlineImages.length > 0
        ? {
            Attachments: InlineImageAttachments.forPostmark(data.inlineImages),
          }
        : {}),
    };
  }

  public async send(
    mail: EmailMessage,
    emailServer: EmailServer,
    options?: MailProviderSendOptions | undefined,
  ): Promise<void> {
    const serverToken: string = emailServer.apiKey?.trim() || "";

    if (!serverToken) {
      throw new BadDataException(
        "Postmark needs a Server API Token.",
      ).asUserError();
    }

    const inlineImages: Array<EmailInlineImage> = options?.inlineImages || [];
    const bodyText: string = JSON.stringify(
      PostmarkMailProvider.buildRequest({
        mail: mail,
        emailServer: emailServer,
        inlineImages: inlineImages,
      }),
    );

    await HttpMailApi.withSendSlot(
      HttpMailApi.getSlotKey({
        providerName: PROVIDER_NAME,
        configId: emailServer.id?.toString(),
        credential: serverToken,
      }),
      async (): Promise<void> => {
        await HttpMailApi.sendWithRetry({
          providerName: PROVIDER_NAME,
          timeoutMs: options?.timeoutMs,
          attempt: async (requestTimeoutMs: number): Promise<void> => {
            const answer: MailApiAnswer = await HttpMailApi.post({
              providerName: PROVIDER_NAME,
              request: {
                url: POSTMARK_SEND_URL,
                headers: {
                  Accept: "application/json",
                  "Content-Type": "application/json",
                  "X-Postmark-Server-Token": serverToken,
                },
                body: bodyText,
              },
              timeoutMs: requestTimeoutMs,
            });

            const error: PostmarkError = PostmarkMailProvider.readError(answer);

            // Taken: 200 with ErrorCode 0.
            if (
              answer.status >= 200 &&
              answer.status < 300 &&
              !error.errorCode
            ) {
              logger.debug(
                `Postmark accepted the email (HTTP ${answer.status}).`,
              );
              return;
            }

            throw PostmarkMailProvider.explainError(answer, {
              fromEmail: emailServer.fromEmail.toString(),
              toEmail: mail.toEmail.toString(),
              hadInlineImages: inlineImages.length > 0,
              secrets: [serverToken],
            });
          },
        });
      },
    );
  }

  public static readError(answer: MailApiAnswer): PostmarkError {
    const body: unknown = HttpMailApi.readJson(answer.bodyText);
    const record: Record<string, unknown> =
      body && typeof body === "object" ? (body as Record<string, unknown>) : {};

    const fromBody: unknown = record["ErrorCode"];
    const fromHeader: number = Number(answer.headers.get("x-pm-apierrorcode"));

    const errorCode: number | undefined =
      typeof fromBody === "number" && Number.isFinite(fromBody)
        ? fromBody
        : Number.isFinite(fromHeader) && answer.headers.get("x-pm-apierrorcode")
          ? fromHeader
          : undefined;

    const message: unknown = record["Message"];

    return {
      errorCode: errorCode,
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
      toEmail: string;
      hadInlineImages: boolean;
      secrets: Array<string | undefined>;
    },
  ): MailApiSendException {
    const error: PostmarkError = PostmarkMailProvider.readError(answer);
    const said: string = HttpMailApi.scrub(error.message, options.secrets);
    const words: string = error.message.toLowerCase();
    const status: string = `HTTP ${answer.status}${
      error.errorCode !== undefined ? `, ErrorCode ${error.errorCode}` : ""
    }`;

    let meaning: string = `Postmark did not send the email (${status}).`;

    if (
      answer.status === 401 ||
      error.errorCode === PostmarkErrorCode.BadOrMissingServerToken
    ) {
      meaning = `Postmark did not accept the server API token (${status}). Copy the token from the server's API Tokens tab in Postmark; an account token does not send.`;
    } else if (words.includes("sender signature")) {
      meaning = `${options.fromEmail} is not a confirmed sender signature in Postmark (${status}). Add and confirm it under Sender Signatures, or verify its domain.`;
    } else if (error.errorCode === PostmarkErrorCode.InactiveRecipient) {
      meaning = `Postmark will not send to ${options.toEmail}: it is marked inactive after a hard bounce or a spam complaint (${status}). Reactivate it in Postmark's Suppressions if it should get email again.`;
    } else if (error.errorCode === PostmarkErrorCode.AccountPendingApproval) {
      meaning = `The Postmark account is waiting for approval, and until then sends only to addresses at the From Email's own domain (${status}).`;
    } else if (error.errorCode === PostmarkErrorCode.AccountNotAllowedToSend) {
      meaning = `The Postmark account is not approved to send yet (${status}).`;
    } else if (error.errorCode === PostmarkErrorCode.MessageStreamNotFound) {
      meaning = `The Postmark server has no default transactional stream to send on (${status}).`;
    } else if (answer.status === 413) {
      meaning = `Postmark would not take an email this large (${status}).`;
    } else if (answer.status === 429) {
      meaning = `Postmark is limiting how fast this server sends (${status}).`;
    } else if (error.errorCode === PostmarkErrorCode.InvalidEmailRequest) {
      meaning = `Postmark refused the email (${status}).`;
    }

    return new MailApiSendException(
      said ? `${meaning} Postmark said: ${said}` : meaning,
      {
        statusCode: answer.status,
        isRetryable: HttpMailApi.isRetryableStatus(answer.status),
        retryAfterSeconds: HttpMailApi.parseRetryAfter(
          answer.headers.get("retry-after"),
        ),
        refusedInlineImages:
          options.hadInlineImages &&
          InlineImageRefusal.isPostmarkRefusal(
            answer.status,
            error.errorCode,
            error.message,
          ),
      },
    );
  }
}
