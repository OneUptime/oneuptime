import HttpMailApi, {
  MailApiAnswer,
  MailApiSendException,
} from "./HttpMailApi";
import InlineImageRefusal from "./InlineImageRefusal";
import MailProvider, { MailProviderSendOptions } from "./MailProvider";
import MimeMessage from "./MimeMessage";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";
import { isMailgunDomain } from "Common/Types/Email/MailgunDomain";
import MailgunRegion, {
  getMailgunApiBaseUrl,
  toMailgunRegion,
} from "Common/Types/Email/MailgunRegion";
import BadDataException from "Common/Types/Exception/BadDataException";
import { EmailInlineImage } from "Common/Server/Utils/Mail/EmailInlineImages";
import logger from "Common/Server/Utils/Logger";

/*
 * SENDS MAIL THROUGH MAILGUN: POST /v3/{domain}/messages.mime on the API
 * host of the domain's region - https://api.mailgun.net for US domains,
 * https://api.eu.mailgun.net for EU ones
 * (https://documentation.mailgun.com/docs/mailgun/api-reference/send/mailgun/messages/post-v3--domain-name--messages-mime).
 *
 * The request is a multipart form of two fields: `to`, the recipient, and
 * `message`, the whole email as MIME - the message nodemailer writes for an
 * SMTP server (MimeMessage), so its inline images are parts with the
 * Content-IDs the HTML points at, exactly as over SMTP. (Mailgun's other
 * endpoint, /messages, names an inline image by its file name, which no
 * Content-ID of OneUptime's is.) Signed in with HTTP Basic, user "api" and
 * the API key - a domain's sending key works too, for that domain.
 *
 * What the customer sets up in Mailgun: a verified sending domain, the From
 * Email at that domain, and the region the domain was created in. A sandbox
 * domain sends only to its authorized recipients.
 */

const PROVIDER_NAME: string = "Mailgun";

export default class MailgunMailProvider implements MailProvider {
  public static getSendUrl(domain: string, region: MailgunRegion): string {
    const value: string = domain.trim().toLowerCase();

    // The domain is part of the path: nothing but a domain may pass.
    if (!isMailgunDomain(value)) {
      throw new BadDataException(
        `"${value.slice(0, 60)}" is not a domain. Set the Mailgun Domain to the sending domain as Mailgun lists it, such as mg.example.com.`,
      );
    }

    return `${getMailgunApiBaseUrl(region)}/v3/${encodeURIComponent(value)}/messages.mime`;
  }

  public static getAuthorization(apiKey: string): string {
    return `Basic ${Buffer.from(`api:${apiKey}`, "utf8").toString("base64")}`;
  }

  public async send(
    mail: EmailMessage,
    emailServer: EmailServer,
    options?: MailProviderSendOptions | undefined,
  ): Promise<void> {
    const apiKey: string = emailServer.apiKey?.trim() || "";
    const domain: string =
      emailServer.mailgunDomain?.trim().toLowerCase() || "";

    if (!apiKey || !domain) {
      throw new BadDataException(
        "Mailgun needs an API Key and a sending Domain.",
      ).asUserError();
    }

    const region: MailgunRegion = toMailgunRegion(emailServer.mailgunRegion);
    const url: string = MailgunMailProvider.getSendUrl(domain, region);
    const inlineImages: Array<EmailInlineImage> = options?.inlineImages || [];

    const mime: Buffer = await MimeMessage.compose({
      mail: mail,
      emailServer: emailServer,
      inlineImages: inlineImages,
    });

    await HttpMailApi.withSendSlot(
      HttpMailApi.getSlotKey({
        providerName: PROVIDER_NAME,
        configId: emailServer.id?.toString(),
        credential: `${apiKey}:${domain}:${region}`,
      }),
      async (): Promise<void> => {
        await HttpMailApi.sendWithRetry({
          providerName: PROVIDER_NAME,
          timeoutMs: options?.timeoutMs,
          attempt: async (requestTimeoutMs: number): Promise<void> => {
            // A fresh form each try: a sent body cannot be read again.
            const form: FormData = new FormData();
            form.append("to", mail.toEmail.toString());
            form.append(
              "message",
              new Blob([new Uint8Array(mime)], { type: "message/rfc822" }),
              "message.mime",
            );

            const answer: MailApiAnswer = await HttpMailApi.post({
              providerName: PROVIDER_NAME,
              request: {
                url: url,
                headers: {
                  Authorization: MailgunMailProvider.getAuthorization(apiKey),
                  Accept: "application/json",
                },
                body: form,
              },
              timeoutMs: requestTimeoutMs,
            });

            if (answer.status >= 200 && answer.status < 300) {
              logger.debug(`Mailgun queued the email (HTTP ${answer.status}).`);
              return;
            }

            throw MailgunMailProvider.explainError(answer, {
              domain: domain,
              region: region,
              hadInlineImages: inlineImages.length > 0,
              secrets: [apiKey],
            });
          },
        });
      },
    );
  }

  // Mailgun's words: its JSON's message, or its answer as text (a 401's "Forbidden").
  public static readMessage(answer: MailApiAnswer): string {
    const body: unknown = HttpMailApi.readJson(answer.bodyText);

    if (body && typeof body === "object") {
      const message: unknown = (body as Record<string, unknown>)["message"];

      if (typeof message === "string" && message.trim()) {
        return message.trim();
      }
    }

    return (answer.bodyText || "").trim();
  }

  /*
   * When a throttled request may go again: Retry-After where Mailgun sends
   * it, else X-RateLimit-Reset, the moment the limit resets in Unix
   * milliseconds.
   */
  public static getRetryAfterSeconds(
    answer: MailApiAnswer,
    now: number = Date.now(),
  ): number | undefined {
    const retryAfter: number | undefined = HttpMailApi.parseRetryAfter(
      answer.headers.get("retry-after"),
      now,
    );

    if (retryAfter !== undefined) {
      return retryAfter;
    }

    const reset: number = Number(answer.headers.get("x-ratelimit-reset"));

    if (!Number.isFinite(reset) || reset <= 0) {
      return undefined;
    }

    // Seconds since the epoch, should the header ever be written that way.
    const resetAt: number = reset < 100000000000 ? reset * 1000 : reset;

    return Math.max(0, Math.ceil((resetAt - now) / 1000));
  }

  public static explainError(
    answer: MailApiAnswer,
    options: {
      domain: string;
      region: MailgunRegion;
      hadInlineImages: boolean;
      secrets: Array<string | undefined>;
    },
  ): MailApiSendException {
    const message: string = MailgunMailProvider.readMessage(answer);
    const said: string = HttpMailApi.scrub(message, options.secrets);
    const words: string = message.toLowerCase();
    const status: string = `HTTP ${answer.status}`;
    const otherRegion: MailgunRegion =
      options.region === MailgunRegion.EU ? MailgunRegion.US : MailgunRegion.EU;

    let meaning: string = `Mailgun did not send the email (${status}).`;

    if (words.includes("authorized recipient") || words.includes("sandbox")) {
      meaning = `${options.domain} is a Mailgun sandbox domain, which sends only to its authorized recipients (${status}). Add the recipient under the domain's authorized recipients, or send from a domain of your own.`;
    } else if (answer.status === 401) {
      meaning = `Mailgun did not accept the API key (${status}). Check the Mailgun API Key; a sending key works only for its own domain.`;
    } else if (answer.status === 403) {
      meaning = `Mailgun would not let this key send from ${options.domain} (${status}). Use the account's API key, or a sending key made for this domain.`;
    } else if (answer.status === 404) {
      meaning = `Mailgun has no domain ${options.domain} in its ${options.region} region (${status}). Check the Mailgun Domain, and set the Mailgun Region to ${otherRegion} if the domain was made there.`;
    } else if (answer.status === 413) {
      meaning = `Mailgun would not take an email this large (${status}).`;
    } else if (answer.status === 429) {
      meaning = `Mailgun is limiting how fast this account sends (${status}).`;
    } else if (answer.status === 400) {
      meaning = `Mailgun refused the email (${status}).`;
    }

    return new MailApiSendException(
      said ? `${meaning} Mailgun said: ${said}` : meaning,
      {
        statusCode: answer.status,
        isRetryable: HttpMailApi.isRetryableStatus(answer.status),
        retryAfterSeconds: MailgunMailProvider.getRetryAfterSeconds(answer),
        refusedInlineImages:
          options.hadInlineImages &&
          InlineImageRefusal.isMailgunRefusal(answer.status, message),
      },
    );
  }
}
