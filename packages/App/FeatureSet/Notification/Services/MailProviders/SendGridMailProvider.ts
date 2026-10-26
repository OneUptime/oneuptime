import { SendGridConfig } from "../../Config";
import InlineImageAttachments from "./InlineImageAttachments";
import InlineImageRefusal, {
  InlineImageRefusalFlag,
} from "./InlineImageRefusal";
import SendgridMail, { ClientResponse, MailDataRequired } from "@sendgrid/mail";
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

  public constructor(
    message: string,
    options: { statusCode: number | undefined; refusedInlineImages: boolean },
  ) {
    super(message);
    this.statusCode = options.statusCode;
    this.refusedInlineImages = options.refusedInlineImages;
  }
}

// One error SendGrid lists in its answer: {"errors":[{"message","field","help"}]}.
export interface SendGridApiError {
  message: string;
  field: string | null;
}

/*
 * What @sendgrid/client rejects with: its ResponseError when SendGrid
 * answered (code is the HTTP status, message the status text, response.body
 * the answer), else the network error. Read by shape, not by class.
 */
interface SendGridClientError {
  code?: unknown;
  message?: unknown;
  response?: { body?: unknown } | undefined;
}

/**
 * Sends mail through SendGrid's v3 Mail Send API (POST
 * https://api.sendgrid.com/v3/mail/send) with @sendgrid/mail, for an
 * installation whose Email Server Type is SendGrid.
 */
export default class SendGridMailProvider {
  public async send(
    mail: EmailMessage,
    config: SendGridConfig,
    options?: SendGridSendOptions | undefined,
  ): Promise<void> {
    const inlineImages: Array<EmailInlineImage> = options?.inlineImages || [];
    const html: string = mail.body || "";

    /*
     * The same email as text, beside the HTML (EmailPlainText). SendGrid
     * refuses a content value with no characters in it, so an email whose
     * HTML has no words goes as HTML alone.
     */
    const text: string = EmailPlainText.fromHtml(html);

    SendgridMail.setApiKey(config.apiKey);

    const message: MailDataRequired = {
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
   * What @sendgrid/mail rejected a send with, as a SendGridSendException
   * whose message says what SendGrid said - its reasons, each with the field
   * it names - after what the status means for whoever reads the Email Log.
   */
  public static explainError(
    error: unknown,
    options: { hadInlineImages: boolean },
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
      meaning = `SendGrid did not accept the API key (${status}). Check the SendGrid API Key in the admin dashboard, under Settings > Emails.`;
    } else if (statusCode === 403) {
      meaning = `SendGrid would not send this email (${status}). The API key needs the Mail Send permission, and the From Email must be a sender verified in SendGrid.`;
    } else if (statusCode === 429) {
      meaning = `SendGrid is limiting how many emails this account sends (${status}).`;
    }

    const reasons: string = apiErrors
      .map((apiError: SendGridApiError): string => {
        return apiError.field
          ? `${apiError.message} (${apiError.field})`
          : apiError.message;
      })
      .join(" ");

    return new SendGridSendException(
      reasons ? `${meaning} SendGrid said: ${reasons}` : meaning,
      {
        statusCode: statusCode,
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
