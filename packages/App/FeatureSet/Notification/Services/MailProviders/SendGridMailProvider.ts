import { SendGridConfig } from "../../Config";
import InlineImageAttachments from "./InlineImageAttachments";
import InlineImageRefusal, {
  InlineImageRefusalFlag,
} from "./InlineImageRefusal";
import HttpMailApi from "./HttpMailApi";
import SendgridMail, {
  ClientResponse,
  MailDataRequired,
  MailService,
} from "@sendgrid/mail";
import EmailMessage from "Common/Types/Email/EmailMessage";
import BadDataException from "Common/Types/Exception/BadDataException";
import { EmailInlineImage } from "Common/Server/Utils/Mail/EmailInlineImages";
import EmailPlainText from "Common/Server/Utils/Mail/EmailPlainText";
import logger from "Common/Server/Utils/Logger";
import ProductBrandingText from "Common/Server/Utils/ProductBrandingText";

export interface SendGridSendOptions {
  /*
   * Images the body points at as "cid:<contentId>" (EmailInlineImages),
   * attached inline with those Content-IDs (InlineImageAttachments).
   */
  inlineImages?: Array<EmailInlineImage> | undefined;
}

export interface SendGridOwnClientSendOptions extends SendGridSendOptions {
  // A total deadline for the send, retries included.
  timeoutMs?: number | undefined;
  // The project's SMTP config id, so its sends share a gate of their own.
  configId?: string | undefined;
}

/*
 * SendGrid's answer to an email it did not take, in words the Email Log can
 * show. The client's own error says only its HTTP status text - "Bad
 * Request" was all an Email Log ever showed of issue #5308 - while SendGrid
 * names what it refused, and the field it refused, in its answer's body.
 */
export class SendGridSendException
  extends BadDataException
  implements InlineImageRefusalFlag
{
  public readonly statusCode: number | undefined;

  // Whether SendGrid refused the email for its inline images (InlineImageRefusal).
  public readonly refusedInlineImages: boolean;

  // How long SendGrid asked to wait (Retry-After), in seconds.
  public readonly retryAfterSeconds: number | undefined;

  public constructor(
    message: string,
    options: {
      statusCode: number | undefined;
      refusedInlineImages: boolean;
      retryAfterSeconds?: number | undefined;
    },
  ) {
    super(message);
    this.statusCode = options.statusCode;
    this.refusedInlineImages = options.refusedInlineImages;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }

  /*
   * Whether the same email could go on another try: SendGrid did not
   * answer, throttled the account, or failed on its own side.
   */
  public get isRetryable(): boolean {
    return (
      this.statusCode === undefined ||
      HttpMailApi.isRetryableStatus(this.statusCode)
    );
  }
}

// One error SendGrid lists in its answer: {"errors":[{"message","field","help"}]}.
export interface SendGridApiError {
  message: string;
  field: string | null;
}

/*
 * The fields one reason is written with, at most: SendGrid names the same
 * reason once for every attachment it refuses, and an email can hold twenty
 * screenshots beside its logo.
 */
const MAX_FIELDS_NAMED_PER_REASON: number = 3;

/*
 * What @sendgrid/client rejects with: its ResponseError when SendGrid
 * answered (code is the HTTP status, message the status text, response.body
 * the answer), else the network error. Read by shape, not by class.
 */
interface SendGridClientError {
  code?: unknown;
  message?: unknown;
  response?:
    | { body?: unknown; headers?: Record<string, unknown> | undefined }
    | undefined;
}

/**
 * Sends mail through SendGrid's v3 Mail Send API (POST
 * https://api.sendgrid.com/v3/mail/send) with @sendgrid/mail, for an
 * installation whose Email Server Type is SendGrid.
 */
export default class SendGridMailProvider {
  /*
   * The Mail Send for an email: to, from (its name, or the product's), the
   * subject, the text and the HTML, and its inline images.
   */
  public static buildMessage(
    mail: EmailMessage,
    config: SendGridConfig,
    inlineImages: Array<EmailInlineImage>,
  ): MailDataRequired {
    const html: string = mail.body || "";

    /*
     * The same email as text, beside the HTML (EmailPlainText). SendGrid
     * refuses a content value with no characters in it, so an email whose
     * HTML has no words goes as HTML alone.
     */
    const text: string = EmailPlainText.fromHtml(html);

    return {
      to: mail.toEmail.toString(),
      from: `${
        config.fromName || ProductBrandingText.getProductName()
      } <${config.fromEmail.toString()}>`,
      subject: mail.subject,
      ...(text ? { text: text } : {}),
      html: html,
      ...(inlineImages.length > 0
        ? { attachments: InlineImageAttachments.forSendgrid(inlineImages) }
        : {}),
    };
  }

  /*
   * The server's own SendGrid settings (Email Server Type: SendGrid),
   * through @sendgrid/mail's shared client, as they always were.
   */
  public async send(
    mail: EmailMessage,
    config: SendGridConfig,
    options?: SendGridSendOptions | undefined,
  ): Promise<void> {
    const inlineImages: Array<EmailInlineImage> = options?.inlineImages || [];

    SendgridMail.setApiKey(config.apiKey);

    const message: MailDataRequired = SendGridMailProvider.buildMessage(
      mail,
      config,
      inlineImages,
    );

    let response: [ClientResponse, Record<string, unknown>];

    try {
      response = await SendgridMail.send(message);
    } catch (error) {
      throw SendGridMailProvider.explainError(error, {
        hadInlineImages: inlineImages.length > 0,
      });
    }

    logger.debug("SendGrid Email Provider Response:");
    logger.debug(
      JSON.stringify(
        {
          statusCode: response[0]?.statusCode,
          headers: response[0]?.headers,
          body: response[0]?.body,
        },
        null,
        2,
      ),
    );
  }

  /*
   * A project's SendGrid config (Transport: SendGrid): a client of its own
   * for this one email, so no other config's key is ever on it - the
   * library's shared client holds one key for the whole process - and, as
   * every HTTP API provider is sent (HttpMailApi), the caller's deadline,
   * retries for throttling and SendGrid's own failures, and a gate of the
   * config's own.
   */
  public async sendWithOwnClient(
    mail: EmailMessage,
    config: SendGridConfig,
    options?: SendGridOwnClientSendOptions | undefined,
  ): Promise<void> {
    const inlineImages: Array<EmailInlineImage> = options?.inlineImages || [];
    const message: MailDataRequired = SendGridMailProvider.buildMessage(
      mail,
      config,
      inlineImages,
    );

    await HttpMailApi.withSendSlot(
      HttpMailApi.getSlotKey({
        providerName: "SendGrid",
        configId: options?.configId,
        credential: config.apiKey,
      }),
      async (): Promise<void> => {
        await HttpMailApi.sendWithRetry({
          providerName: "SendGrid",
          timeoutMs: options?.timeoutMs,
          isRetryable: (error: unknown): boolean => {
            return error instanceof SendGridSendException && error.isRetryable;
          },
          getRetryAfterSeconds: (error: unknown): number | undefined => {
            return error instanceof SendGridSendException
              ? error.retryAfterSeconds
              : undefined;
          },
          attempt: async (requestTimeoutMs: number): Promise<void> => {
            const mailer: MailService = new MailService();
            mailer.setApiKey(config.apiKey);
            mailer.setTimeout(requestTimeoutMs);

            try {
              await mailer.send(message);
            } catch (error) {
              throw SendGridMailProvider.explainError(error, {
                hadInlineImages: inlineImages.length > 0,
                isProjectConfig: true,
              });
            }
          },
        });
      },
    );
  }

  /**
   * The errors SendGrid's answer lists, from the body @sendgrid/client hands
   * back: parsed JSON, or the JSON as text. Anything else lists none.
   */
  public static readApiErrors(body: unknown): Array<SendGridApiError> {
    let parsed: unknown = body;

    if (typeof body === "string") {
      try {
        parsed = JSON.parse(body);
      } catch {
        return [];
      }
    }

    if (!parsed || typeof parsed !== "object") {
      return [];
    }

    const errors: unknown = (parsed as { errors?: unknown }).errors;

    if (!Array.isArray(errors)) {
      return [];
    }

    const apiErrors: Array<SendGridApiError> = [];

    for (const error of errors) {
      if (!error || typeof error !== "object") {
        continue;
      }

      const message: unknown = (error as { message?: unknown }).message;
      const field: unknown = (error as { field?: unknown }).field;

      if (typeof message !== "string" || !message.trim()) {
        continue;
      }

      apiErrors.push({
        message: message.trim(),
        field: typeof field === "string" && field.trim() ? field.trim() : null,
      });
    }

    return apiErrors;
  }

  /**
   * SendGrid's reasons as one text: each reason once, in the order SendGrid
   * gave them, with the fields it named it for - the first
   * MAX_FIELDS_NAMED_PER_REASON, and how many more. An email whose two
   * images both lack a Content-ID reads "The content_id parameter is
   * required if disposition = 'inline'. (attachments.0.content_id,
   * attachments.1.content_id)", not the same sentence twice.
   */
  public static describeApiErrors(apiErrors: Array<SendGridApiError>): string {
    // A Map and its Sets keep the order each was first given in.
    const fieldsByReason: Map<string, Set<string>> = new Map<
      string,
      Set<string>
    >();

    for (const apiError of apiErrors) {
      const fields: Set<string> =
        fieldsByReason.get(apiError.message) || new Set<string>();

      if (apiError.field) {
        fields.add(apiError.field);
      }

      fieldsByReason.set(apiError.message, fields);
    }

    return Array.from(fieldsByReason.entries())
      .map(([reason, fieldSet]: [string, Set<string>]): string => {
        const fields: Array<string> = Array.from(fieldSet);

        if (fields.length === 0) {
          return reason;
        }

        const named: string = fields
          .slice(0, MAX_FIELDS_NAMED_PER_REASON)
          .join(", ");
        const more: number = fields.length - MAX_FIELDS_NAMED_PER_REASON;

        return more > 0
          ? `${reason} (${named} and ${more} more)`
          : `${reason} (${named})`;
      })
      .join(" ");
  }

  /**
   * What @sendgrid/mail rejected a send with, as a SendGridSendException
   * whose message says what SendGrid said - its reasons, each with the field
   * it names - after what the status means for whoever reads the Email Log.
   */
  public static explainError(
    error: unknown,
    options: {
      hadInlineImages: boolean;
      // A project's SMTP config, not the server's own SendGrid settings.
      isProjectConfig?: boolean | undefined;
    },
  ): SendGridSendException {
    const clientError: SendGridClientError =
      error && typeof error === "object" ? (error as SendGridClientError) : {};

    const statusCode: number | undefined =
      typeof clientError.code === "number" ? clientError.code : undefined;

    const clientMessage: string =
      typeof clientError.message === "string" && clientError.message.trim()
        ? clientError.message.trim()
        : "";

    // No answer at all: the request never reached SendGrid, or never came back.
    if (statusCode === undefined || !clientError.response) {
      return new SendGridSendException(
        `SendGrid could not be reached${clientMessage ? `: ${clientMessage}` : "."}`,
        { statusCode: undefined, refusedInlineImages: false },
      );
    }

    const apiErrors: Array<SendGridApiError> =
      SendGridMailProvider.readApiErrors(clientError.response.body);

    const status: string = `HTTP ${statusCode}${clientMessage ? ` ${clientMessage}` : ""}`;

    let meaning: string = `SendGrid did not accept the email (${status}).`;

    if (statusCode === 401) {
      meaning = options.isProjectConfig
        ? `SendGrid did not accept the API key (${status}). Check the SendGrid API Key in this project's SMTP config, under Project Settings > Notifications > Notification Channels.`
        : `SendGrid did not accept the API key (${status}). Check the SendGrid API Key in the Admin Dashboard, under Settings > Emails.`;
    } else if (statusCode === 403) {
      meaning = `SendGrid would not send this email (${status}). The API key needs the Mail Send permission, and the From Email must be a sender verified in SendGrid.`;
    } else if (statusCode === 429) {
      meaning = `SendGrid is limiting how many emails this account sends (${status}).`;
    }

    const reasons: string = SendGridMailProvider.describeApiErrors(apiErrors);

    const retryAfterHeader: unknown =
      clientError.response.headers?.["retry-after"];

    return new SendGridSendException(
      reasons ? `${meaning} SendGrid said: ${reasons}` : meaning,
      {
        statusCode: statusCode,
        retryAfterSeconds: HttpMailApi.parseRetryAfter(
          typeof retryAfterHeader === "string" ? retryAfterHeader : undefined,
        ),
        refusedInlineImages:
          options.hadInlineImages &&
          InlineImageRefusal.isSendgridRefusal(
            statusCode,
            apiErrors
              .map((apiError: SendGridApiError): string | null => {
                return apiError.field;
              })
              .filter((field: string | null): field is string => {
                return field !== null;
              }),
          ),
      },
    );
  }
}
