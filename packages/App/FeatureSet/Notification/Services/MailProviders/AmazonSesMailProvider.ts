import HttpMailApi, {
  MailApiAnswer,
  MailApiSendException,
} from "./HttpMailApi";
import InlineImageAttachments, {
  AmazonSesInlineAttachment,
} from "./InlineImageAttachments";
import InlineImageRefusal from "./InlineImageRefusal";
import formatMailbox, { toOneLine } from "./MailboxAddress";
import MailProvider, { MailProviderSendOptions } from "./MailProvider";
import { isAwsRegion } from "Common/Types/Cloud/AwsRegionCode";
import AmazonSesAuthenticationType, {
  toAmazonSesAuthenticationType,
} from "Common/Types/Email/AmazonSesAuthenticationType";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";
import BadDataException from "Common/Types/Exception/BadDataException";
import AwsDefaultCredentialChain, {
  AwsChainCredentials,
  AwsCredentialChainError,
} from "Common/Server/Utils/Aws/AwsDefaultCredentialChain";
import { EmailInlineImage } from "Common/Server/Utils/Mail/EmailInlineImages";
import EmailPlainText from "Common/Server/Utils/Mail/EmailPlainText";
import logger from "Common/Server/Utils/Logger";
import AwsSecurityHubClient, {
  AwsSigV4SignResult,
} from "Common/Server/Utils/SecurityEvent/Connectors/AwsSecurityHub/AwsSecurityHubClient";

/*
 * SENDS MAIL THROUGH AMAZON SES: the SES API v2 SendEmail operation,
 * POST https://email.{region}.amazonaws.com/v2/email/outbound-emails
 * (https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html),
 * signed with AWS Signature Version 4 for the service "ses" by the signer the
 * AWS connectors share (AwsSecurityHubClient.signRequest, checked against
 * AWS's published test vectors). Nothing from the AWS SDK.
 *
 * The email goes as Simple content: the subject, the HTML and its text, each
 * in UTF-8, and each inline image an attachment with ContentDisposition
 * INLINE and the Content-ID its HTML points at - SES's own way of embedding
 * an image (https://docs.aws.amazon.com/ses/latest/dg/attachments.html). So
 * the IAM user or role needs only ses:SendEmail on the sender's identity.
 *
 * WHAT IT SIGNS WITH (#7000). A config signs in with an IAM user's access
 * key, stored encrypted - or, for the server's own email settings only,
 * as the IAM role AWS gives the server: IAM roles for service accounts or
 * EKS Pod Identity on Amazon EKS, a task role on Amazon ECS, an instance
 * profile on Amazon EC2 (AwsDefaultCredentialChain). Those credentials are
 * short-lived: each try signs with the ones in hand, which are fetched again
 * before they expire, and again at once when SES says they expired or does
 * not know them. The role is the server's, so a project's config - which
 * has an id - is refused if it asks for it, however it came to.
 *
 * What the customer sets up in SES: a verified identity for the From Email
 * (the address, or its domain) in the Region they pick, and - while the
 * account is in the SES sandbox - verified recipients too. Every refusal
 * SES gives for these says which, in the Email Log's words (explainError).
 */

// The SigV4 service name SES's v2 API is signed with (endpoint prefix: email).
export const AMAZON_SES_SIGNING_SERVICE: string = "ses";

export const AMAZON_SES_SEND_EMAIL_PATH: string = "/v2/email/outbound-emails";

const PROVIDER_NAME: string = "Amazon SES";

/*
 * What SES answers when it does not take the credentials themselves - they
 * expired, or it does not know them. Signed in as the server's IAM role,
 * the ones in hand are dropped and fetched again.
 */
export const AMAZON_SES_CREDENTIAL_REFUSAL_CODES: ReadonlyArray<string> = [
  "ExpiredTokenException",
  "ExpiredToken",
  "UnrecognizedClientException",
  "InvalidClientTokenId",
];

// The JSON body of a SendEmail request, as this provider writes it.
export interface AmazonSesSendEmailRequest {
  FromEmailAddress: string;
  Destination: { ToAddresses: Array<string> };
  Content: {
    Simple: {
      Subject: { Data: string; Charset: "UTF-8" };
      Body: {
        Html: { Data: string; Charset: "UTF-8" };
        Text?: { Data: string; Charset: "UTF-8" };
      };
      Attachments?: Array<AmazonSesInlineAttachment>;
    };
  };
}

// What SES says went wrong: its error's name and its words.
export interface AmazonSesError {
  code: string;
  message: string;
}

export interface AmazonSesMailProviderOptions {
  /*
   * Where the server's IAM role's credentials come from: the process's own
   * chain when left out (tests hand in one of their own).
   */
  credentialChain?: AwsDefaultCredentialChain | undefined;
}

// What one request is signed with.
interface AmazonSesSigningCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string | undefined;
}

export default class AmazonSesMailProvider implements MailProvider {
  private readonly credentialChain: AwsDefaultCredentialChain | undefined;

  public constructor(options?: AmazonSesMailProviderOptions | undefined) {
    this.credentialChain = options?.credentialChain;
  }

  /*
   * The API host for a Region: email.{region}.amazonaws.com, or
   * amazonaws.com.cn in the China partition. The Region is checked to be a
   * Region code first - it is part of a host name a tenant wrote, so
   * nothing but letters, digits and hyphens in the shape of one passes.
   */
  public static getHost(region: string): string {
    const value: string = region.trim().toLowerCase();

    if (!isAwsRegion(value)) {
      throw new BadDataException(
        `"${value.slice(0, 40)}" is not an AWS Region. Set the Amazon SES Region to a code such as us-east-1.`,
      );
    }

    return `email.${value}.${value.startsWith("cn-") ? "amazonaws.com.cn" : "amazonaws.com"}`;
  }

  public static buildRequest(data: {
    mail: EmailMessage;
    emailServer: EmailServer;
    inlineImages: Array<EmailInlineImage>;
  }): AmazonSesSendEmailRequest {
    const html: string = data.mail.body || "";
    // SES takes a text part beside the HTML; one with no words is left out.
    const text: string = EmailPlainText.fromHtml(html);

    return {
      FromEmailAddress: formatMailbox({
        name: data.emailServer.fromName,
        address: data.emailServer.fromEmail.toString(),
        encodeNonAscii: true,
      }),
      Destination: { ToAddresses: [data.mail.toEmail.toString()] },
      Content: {
        Simple: {
          Subject: {
            Data: toOneLine(data.mail.subject || ""),
            Charset: "UTF-8",
          },
          Body: {
            Html: { Data: html, Charset: "UTF-8" },
            ...(text ? { Text: { Data: text, Charset: "UTF-8" } } : {}),
          },
          ...(data.inlineImages.length > 0
            ? {
                Attachments: InlineImageAttachments.forAmazonSes(
                  data.inlineImages,
                ),
              }
            : {}),
        },
      },
    };
  }

  public async send(
    mail: EmailMessage,
    emailServer: EmailServer,
    options?: MailProviderSendOptions | undefined,
  ): Promise<void> {
    const signsInWith: AmazonSesAuthenticationType =
      toAmazonSesAuthenticationType(emailServer.awsAuthenticationType);
    const usesServerIamRole: boolean =
      signsInWith === AmazonSesAuthenticationType.ServerIamRole;
    const accessKeyId: string = emailServer.awsAccessKeyId?.trim() || "";
    const secretAccessKey: string =
      emailServer.awsSecretAccessKey?.trim() || "";
    const region: string = emailServer.awsRegion?.trim().toLowerCase() || "";

    if (usesServerIamRole) {
      /*
       * The role is the server's. Only its own settings - which are no row
       * of a project's, so have no id - may sign in as it.
       */
      if (emailServer.id) {
        throw new BadDataException(
          "A project's Amazon SES config signs in with an access key. Only this server's own email settings may sign in with its IAM role.",
        ).asUserError();
      }

      if (!region) {
        throw new BadDataException(
          "Amazon SES needs a Region to sign in with this server's IAM role.",
        ).asUserError();
      }
    } else if (!accessKeyId || !secretAccessKey || !region) {
      throw new BadDataException(
        "Amazon SES needs an Access Key ID, a Secret Access Key and a Region.",
      ).asUserError();
    }

    const host: string = AmazonSesMailProvider.getHost(region);
    const inlineImages: Array<EmailInlineImage> = options?.inlineImages || [];
    const bodyText: string = JSON.stringify(
      AmazonSesMailProvider.buildRequest({
        mail: mail,
        emailServer: emailServer,
        inlineImages: inlineImages,
      }),
    );

    await HttpMailApi.withSendSlot(
      HttpMailApi.getSlotKey({
        providerName: PROVIDER_NAME,
        configId: emailServer.id?.toString(),
        credential: usesServerIamRole
          ? `server-iam-role:${region}`
          : `${accessKeyId}:${secretAccessKey}:${region}`,
      }),
      async (): Promise<void> => {
        await HttpMailApi.sendWithRetry({
          providerName: PROVIDER_NAME,
          timeoutMs: options?.timeoutMs,
          attempt: async (requestTimeoutMs: number): Promise<void> => {
            /*
             * Each try signs with the credentials in hand: the role's are
             * fetched again before they expire, or after SES refused them.
             */
            const credentials: AmazonSesSigningCredentials = usesServerIamRole
              ? await this.getServerIamRoleCredentials(region)
              : {
                  accessKeyId: accessKeyId,
                  secretAccessKey: secretAccessKey,
                  sessionToken: undefined,
                };

            /*
             * Signed afresh on every try: a signature is good for five
             * minutes, and the body is the exact text that is sent.
             */
            const signed: AwsSigV4SignResult = AwsSecurityHubClient.signRequest(
              {
                method: "POST",
                host: host,
                path: AMAZON_SES_SEND_EMAIL_PATH,
                headers: { "Content-Type": "application/json" },
                body: bodyText,
                accessKeyId: credentials.accessKeyId,
                secretAccessKey: credentials.secretAccessKey,
                sessionToken: credentials.sessionToken,
                region: region,
                service: AMAZON_SES_SIGNING_SERVICE,
                date: new Date(),
              },
            );

            const answer: MailApiAnswer = await HttpMailApi.post({
              providerName: PROVIDER_NAME,
              request: {
                url: `https://${host}${AMAZON_SES_SEND_EMAIL_PATH}`,
                headers: signed.headers,
                body: bodyText,
              },
              timeoutMs: requestTimeoutMs,
            });

            if (answer.status >= 200 && answer.status < 300) {
              logger.debug(
                `Amazon SES accepted the email (HTTP ${answer.status}).`,
              );
              return;
            }

            if (
              usesServerIamRole &&
              AMAZON_SES_CREDENTIAL_REFUSAL_CODES.includes(
                AmazonSesMailProvider.readError(answer).code,
              )
            ) {
              this.getCredentialChain().invalidate();
            }

            throw AmazonSesMailProvider.explainError(answer, {
              region: region,
              fromEmail: emailServer.fromEmail.toString(),
              hadInlineImages: inlineImages.length > 0,
              signsInWith: signsInWith,
              secrets: [
                credentials.secretAccessKey,
                credentials.sessionToken,
                signed.signature,
              ],
            });
          },
        });
      },
    );
  }

  private getCredentialChain(): AwsDefaultCredentialChain {
    return this.credentialChain || AwsDefaultCredentialChain.getShared();
  }

  /*
   * The server's IAM role's credentials, for the Region the email goes to
   * (STS is asked there when the server does not say where it runs). A
   * server that has none, or a role that may not be assumed, is a
   * MailApiSendException in the Email Log's words: what is missing and
   * where to give it.
   */
  private async getServerIamRoleCredentials(
    region: string,
  ): Promise<AmazonSesSigningCredentials> {
    let credentials: AwsChainCredentials;

    try {
      credentials = await this.getCredentialChain().getCredentials({
        regionHint: region,
      });
    } catch (error) {
      if (error instanceof AwsCredentialChainError) {
        throw new MailApiSendException(
          `Amazon SES could not sign in with this server's IAM role. ${error.message}`,
          { isRetryable: error.isRetryable },
        );
      }

      throw error;
    }

    return {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken || undefined,
    };
  }

  /*
   * SES's error, as AWS's REST-JSON protocol carries it: the name in the
   * X-Amzn-ErrorType header ("MessageRejected:http://..."), or in the
   * body's __type or code ("...#AccessDeniedException"); the words in its
   * message (or Message).
   */
  public static readError(answer: MailApiAnswer): AmazonSesError {
    const body: unknown = HttpMailApi.readJson(answer.bodyText);
    const record: Record<string, unknown> =
      body && typeof body === "object" ? (body as Record<string, unknown>) : {};

    const rawCode: string =
      answer.headers.get("x-amzn-errortype") ||
      (typeof record["__type"] === "string"
        ? (record["__type"] as string)
        : "") ||
      (typeof record["code"] === "string" ? (record["code"] as string) : "") ||
      (typeof record["Code"] === "string" ? (record["Code"] as string) : "");

    let code: string = rawCode.split(":")[0] || "";
    const hashIndex: number = code.lastIndexOf("#");

    if (hashIndex >= 0) {
      code = code.slice(hashIndex + 1);
    }

    const message: unknown =
      record["message"] ?? record["Message"] ?? record["errorMessage"];

    return {
      code: code.trim(),
      message:
        typeof message === "string" && message.trim()
          ? message.trim()
          : answer.bodyText && !body
            ? answer.bodyText
            : "",
    };
  }

  /*
   * A refusal as a MailApiSendException: what SES said, after what it means
   * and what to change. Throttling and SES's own failures are retried; a
   * quota for the day, a key, a permission, an identity or a sandbox
   * recipient fails the same on every try. The server's IAM role's
   * credentials that expired are retried too: the next try fetches new
   * ones. What to change names what the config signs in with - an access
   * key, or the server's IAM role.
   */
  public static explainError(
    answer: MailApiAnswer,
    options: {
      region: string;
      fromEmail: string;
      hadInlineImages: boolean;
      signsInWith?: AmazonSesAuthenticationType | undefined;
      secrets: Array<string | undefined>;
    },
  ): MailApiSendException {
    const error: AmazonSesError = AmazonSesMailProvider.readError(answer);
    const said: string = HttpMailApi.scrub(
      [error.code, error.message].filter(Boolean).join(": "),
      options.secrets,
    );
    const status: string = `HTTP ${answer.status}${error.code ? ` ${error.code}` : ""}`;
    const words: string = error.message.toLowerCase();
    const usesServerIamRole: boolean =
      options.signsInWith === AmazonSesAuthenticationType.ServerIamRole;

    const isQuota: boolean = words.includes("daily message quota exceeded");
    const isThrottled: boolean =
      !isQuota &&
      (answer.status === 429 ||
        error.code === "TooManyRequestsException" ||
        error.code === "ThrottlingException" ||
        error.code === "Throttling" ||
        words.includes("maximum sending rate exceeded"));
    const isExpired: boolean =
      error.code === "ExpiredTokenException" || error.code === "ExpiredToken";

    let meaning: string = `Amazon SES did not send the email (${status}).`;

    if (
      error.code === "UnrecognizedClientException" ||
      error.code === "InvalidClientTokenId"
    ) {
      meaning = usesServerIamRole
        ? `Amazon SES does not recognize this server's IAM role credentials (${status}). New ones are fetched for the next email; if this goes on, check the IAM role this server runs as.`
        : `Amazon SES does not recognize the access key (${status}). Check the Access Key ID, and that the key is active in IAM.`;
    } else if (
      error.code === "SignatureDoesNotMatch" ||
      error.code === "InvalidSignatureException" ||
      error.code === "IncompleteSignature"
    ) {
      meaning = usesServerIamRole
        ? `Amazon SES did not accept the request's signature (${status}). Check that this server's clock is right.`
        : `Amazon SES did not accept the request's signature (${status}). Check that the Secret Access Key belongs to the Access Key ID, and that this server's clock is right.`;
    } else if (
      error.code === "AccessDeniedException" ||
      error.code === "AccessDenied"
    ) {
      meaning = usesServerIamRole
        ? `This server's IAM role may not send with Amazon SES (${status}). Allow ses:SendEmail on the sender's identity in the role's policy.`
        : `The access key may not send with Amazon SES (${status}). Allow ses:SendEmail on the sender's identity in the IAM user's or role's policy.`;
    } else if (isExpired) {
      meaning = usesServerIamRole
        ? `This server's IAM role credentials expired before Amazon SES read them (${status}). New ones are fetched for the next try.`
        : `The access key has expired (${status}). Use a long-lived IAM access key.`;
    } else if (words.includes("not verified")) {
      meaning = `Amazon SES needs a verified identity in ${options.region} for ${options.fromEmail} (${status}). Verify the address or its domain in that Region; while the account is in the SES sandbox, verify each recipient too, or request production access.`;
    } else if (error.code === "MailFromDomainNotVerifiedException") {
      meaning = `The custom MAIL FROM domain of ${options.fromEmail} is not verified in Amazon SES (${status}).`;
    } else if (error.code === "AccountSuspendedException") {
      meaning = `Amazon SES has suspended sending for this AWS account (${status}).`;
    } else if (error.code === "SendingPausedException") {
      meaning = `Sending is paused for this AWS account or its configuration set in Amazon SES (${status}).`;
    } else if (isQuota) {
      meaning = `This AWS account has sent all the email its Amazon SES quota allows today (${status}).`;
    } else if (isThrottled) {
      meaning = `Amazon SES is limiting how fast this AWS account sends (${status}).`;
    } else if (
      answer.status === 413 ||
      error.code === "RequestEntityTooLargeException"
    ) {
      meaning = `Amazon SES would not take an email this large (${status}).`;
    } else if (error.code === "MessageRejected") {
      meaning = `Amazon SES rejected the email (${status}).`;
    }

    return new MailApiSendException(
      said ? `${meaning} Amazon SES said: ${said}` : meaning,
      {
        statusCode: answer.status,
        isRetryable:
          !isQuota &&
          (isThrottled ||
            (usesServerIamRole && isExpired) ||
            HttpMailApi.isRetryableStatus(answer.status)),
        retryAfterSeconds: HttpMailApi.parseRetryAfter(
          answer.headers.get("retry-after"),
        ),
        refusedInlineImages:
          options.hadInlineImages &&
          InlineImageRefusal.isAmazonSesRefusal(
            answer.status,
            error.code,
            error.message,
          ),
      },
    );
  }
}
