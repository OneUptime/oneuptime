import DatabaseService from "./DatabaseService";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import WriteOnlyCredentialChanges from "../Utils/AuditLog/WriteOnlyCredentialChanges";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { isAwsRegion } from "../../Types/Cloud/AwsRegionCode";
import { isAwsRoleArn } from "../../Types/Cloud/AwsRoleArn";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import {
  AMAZON_SES_AUTHENTICATION_TYPE_INVALID,
  AMAZON_SES_ROLE_ARN_INVALID,
  AMAZON_SES_ROLE_REGION_REQUIRED,
} from "../../Types/Email/AmazonSesRoleWords";
import EmailServer from "../../Types/Email/EmailServer";
import { JSONValue } from "../../Types/JSON";
import ProjectAmazonSesAuthenticationType, {
  isProjectAmazonSesAuthenticationType,
  toProjectAmazonSesAuthenticationType,
} from "../../Types/Email/ProjectAmazonSesAuthenticationType";
import { isMailgunDomain } from "../../Types/Email/MailgunDomain";
import { toMailgunRegion } from "../../Types/Email/MailgunRegion";
import MailTransportType, {
  toMailTransportType,
} from "../../Types/Email/MailTransportType";
import SMTPAuthenticationType from "../../Types/Email/SMTPAuthenticationType";
import BadDataException from "../../Types/Exception/BadDataException";
import URL from "../../Types/API/URL";
import Model from "../../Models/DatabaseModels/ProjectSmtpConfig";

/*
 * The columns of a config that sign in to its mail account: the SMTP
 * password, the OAuth client secret and each HTTP API provider's key.
 * Write-only and kept encrypted at rest (ProjectSmtpConfig).
 */
export const PROJECT_SMTP_CONFIG_CREDENTIAL_COLUMNS: ReadonlyArray<string> = [
  "password",
  "clientSecret",
  "amazonSesSecretAccessKey",
  "sendgridApiKey",
  "mailgunApiKey",
  "postmarkServerToken",
  "resendApiKey",
];

/*
 * The columns how a config signs in to Amazon SES is read from and written
 * to (applyAmazonSesAuthenticationRules): the transport, the sign-in, the
 * role, the Region and the access key a role clears.
 */
export const AMAZON_SES_SIGN_IN_COLUMNS: ReadonlyArray<string> = [
  "transportType",
  "amazonSesAuthenticationType",
  "amazonSesRoleArn",
  "amazonSesRegion",
  "amazonSesAccessKeyId",
  "amazonSesSecretAccessKey",
];

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A create hands back the row it saved, and each credential is on that
   * row as it was stored: encrypted. BaseAPI serializes the row whole into
   * the answer of POST /smtp-config, without a column read check, and a
   * workflow's Create SMTP Config step returns it, to be kept in the
   * workflow's logs - a ciphertext of a credential nobody may read back
   * (read: []), which with the server's ENCRYPTION_SECRET is as good as the
   * credential. So the credentials are taken off it first. The mail service
   * reads them from the database, decrypted, when it sends.
   */
  @CaptureSpan()
  public override async create(createBy: CreateBy<Model>): Promise<Model> {
    const created: Model = await super.create(createBy);

    /*
     * Cleared rather than deleted, as BaseAPI.createItem clears a model's
     * `_id`: an unset column holds undefined, which serializes as nothing.
     */
    const row: Record<string, unknown> = created as unknown as Record<
      string,
      unknown
    >;

    for (const column of PROJECT_SMTP_CONFIG_CREDENTIAL_COLUMNS) {
      row[column] = undefined;
    }

    return created;
  }

  /*
   * Nobody reads a credential back, so the audit log leaves its value out
   * of every entry; an update that changes one is still recorded, as
   * changed - by whom, when - never with its value
   * (WriteOnlyCredentialChanges). A password rotated alone would leave no
   * entry otherwise.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await this.applyAmazonSesAuthenticationRulesOnUpdate(updateBy);

    WriteOnlyCredentialChanges.recordInAuditLog(
      updateBy,
      PROJECT_SMTP_CONFIG_CREDENTIAL_COLUMNS,
    );

    return { updateBy, carryForward: null };
  }

  // A new config's Amazon SES sign-in, checked as it is written (applyAmazonSesAuthenticationRules).
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const data: Record<string, unknown> = {};

    for (const column of AMAZON_SES_SIGN_IN_COLUMNS) {
      data[column] = createBy.data.getColumnValue(column);
    }

    Service.applyAmazonSesAuthenticationRules(data);

    for (const column of AMAZON_SES_SIGN_IN_COLUMNS) {
      if (data[column] !== createBy.data.getColumnValue(column)) {
        createBy.data.setColumnValue(
          column,
          (data[column] ?? null) as JSONValue,
        );
      }
    }

    return { createBy, carryForward: null };
  }

  /*
   * An update's Amazon SES sign-in, weighed against what each config it
   * changes holds: read only when the write names a column of it. Each
   * config must come out of the write whole, and the write does the same to
   * each - a write that would clear one config's access key and keep
   * another's is refused, rather than half done.
   */
  private async applyAmazonSesAuthenticationRulesOnUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const data: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;

    if (
      !AMAZON_SES_SIGN_IN_COLUMNS.some((column: string): boolean => {
        return data[column] !== undefined;
      })
    ) {
      return;
    }

    const select: Record<string, boolean> = {};

    for (const column of AMAZON_SES_SIGN_IN_COLUMNS) {
      select[column] = true;
    }

    const configs: Array<Model> = await this.findBy({
      query: updateBy.query,
      select: select,
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    // Nothing stored to weigh it against: the write alone.
    if (configs.length === 0) {
      Service.applyAmazonSesAuthenticationRules(data);
      return;
    }

    // The write, as each config would come out of it.
    const writes: Array<Record<string, unknown>> = configs.map(
      (config: Model): Record<string, unknown> => {
        const stored: Record<string, unknown> = {};

        for (const column of AMAZON_SES_SIGN_IN_COLUMNS) {
          stored[column] = config.getColumnValue(column);
        }

        const forThisConfig: Record<string, unknown> = { ...data };

        Service.applyAmazonSesAuthenticationRules(forThisConfig, stored);

        return forThisConfig;
      },
    );
    const written: Record<string, unknown> = writes[0]!;

    if (
      writes.some((forThisConfig: Record<string, unknown>): boolean => {
        return AMAZON_SES_SIGN_IN_COLUMNS.some((column: string): boolean => {
          return forThisConfig[column] !== written[column];
        });
      })
    ) {
      throw new BadDataException(
        "Change how one SMTP config signs in to Amazon SES at a time: these configs sign in in different ways.",
      );
    }

    for (const column of AMAZON_SES_SIGN_IN_COLUMNS) {
      if (written[column] !== data[column]) {
        data[column] = written[column];
      }
    }
  }

  public toEmailServer(
    projectSmtpConfig: Model | undefined,
  ): EmailServer | undefined {
    if (!projectSmtpConfig) {
      return undefined;
    }

    if (!projectSmtpConfig.id) {
      throw new BadDataException("Project SMTP config id is not set");
    }

    const transportType: MailTransportType = toMailTransportType(
      projectSmtpConfig.transportType,
    );

    if (!projectSmtpConfig.fromEmail) {
      throw new BadDataException("Project SMTP config from email is not set");
    }

    if (!projectSmtpConfig.fromName) {
      throw new BadDataException("Project SMTP config from name is not set");
    }

    /*
     * A provider with an HTTP API of its own sends with its own key alone:
     * none of the server, sign-in or OAuth columns below is read, and none
     * is handed on, so a key typed in for one transport never reaches
     * another's API.
     */
    switch (transportType) {
      case MailTransportType.AmazonSES:
      case MailTransportType.SendGrid:
      case MailTransportType.Mailgun:
      case MailTransportType.Postmark:
      case MailTransportType.Resend:
        return this.toApiProviderEmailServer(projectSmtpConfig, transportType);
      default:
        break;
    }

    /*
     * Get auth type, default to UsernamePassword for backward compatibility.
     * Microsoft Graph always uses OAuth (Client Credentials) regardless of what
     * the user picked — but we still let the existing OAuth validation apply.
     */
    const authType: SMTPAuthenticationType =
      transportType === MailTransportType.MicrosoftGraph
        ? SMTPAuthenticationType.OAuth
        : projectSmtpConfig.authType || SMTPAuthenticationType.UsernamePassword;

    if (transportType === MailTransportType.SMTP) {
      if (!projectSmtpConfig.hostname) {
        throw new BadDataException("Project SMTP config host is not set");
      }

      if (!projectSmtpConfig.port) {
        throw new BadDataException("Project SMTP config port is not set");
      }
    }

    // Validate based on auth type
    if (authType === SMTPAuthenticationType.UsernamePassword) {
      if (!projectSmtpConfig.username) {
        throw new BadDataException("Project SMTP config username is not set");
      }

      if (!projectSmtpConfig.password) {
        throw new BadDataException("Project SMTP config password is not set");
      }
    } else if (authType === SMTPAuthenticationType.OAuth) {
      /*
       * For Microsoft Graph, username is optional — we fall back to fromEmail
       * as the sender mailbox. For SMTP+XOAUTH2, username is required.
       */
      if (
        transportType === MailTransportType.SMTP &&
        !projectSmtpConfig.username
      ) {
        throw new BadDataException(
          "Project SMTP config username (email address) is not set for OAuth",
        );
      }

      if (!projectSmtpConfig.clientId) {
        throw new BadDataException(
          "Project SMTP config OAuth Client ID is not set",
        );
      }

      if (!projectSmtpConfig.clientSecret) {
        throw new BadDataException(
          "Project SMTP config OAuth Client Secret is not set",
        );
      }

      if (!projectSmtpConfig.tokenUrl) {
        throw new BadDataException(
          "Project SMTP config OAuth Token URL is not set",
        );
      }

      if (!projectSmtpConfig.scope) {
        throw new BadDataException(
          "Project SMTP config OAuth Scope is not set",
        );
      }
    }
    // For SMTPAuthenticationType.None, no credentials are required

    return {
      id: projectSmtpConfig.id!,
      transportType: transportType,
      host: projectSmtpConfig.hostname,
      port: projectSmtpConfig.port,
      username: projectSmtpConfig.username,
      password: projectSmtpConfig.password,
      fromEmail: projectSmtpConfig.fromEmail,
      fromName: projectSmtpConfig.fromName,
      secure: Boolean(projectSmtpConfig.secure),
      authType: authType,
      clientId: projectSmtpConfig.clientId,
      clientSecret: projectSmtpConfig.clientSecret,
      tokenUrl: projectSmtpConfig.tokenUrl
        ? URL.fromString(projectSmtpConfig.tokenUrl)
        : undefined,
      scope: projectSmtpConfig.scope,
      oauthProviderType: projectSmtpConfig.oauthProviderType,
    };
  }

  /*
   * A config that sends through Amazon SES, SendGrid, Mailgun, Postmark or
   * Resend, with that provider's settings checked as the provider would
   * check them: an AWS Region that is one (isAwsRegion), a Mailgun domain
   * that is a domain (isMailgunDomain). Each refusal names the field to fill in.
   */
  private toApiProviderEmailServer(
    projectSmtpConfig: Model,
    transportType: MailTransportType,
  ): EmailServer {
    const base: EmailServer = {
      id: projectSmtpConfig.id!,
      transportType: transportType,
      username: undefined,
      password: undefined,
      fromEmail: projectSmtpConfig.fromEmail!,
      fromName: projectSmtpConfig.fromName!,
    };

    switch (transportType) {
      case MailTransportType.AmazonSES: {
        /*
         * An IAM role in the project's own AWS account (#7378): no key, the
         * role's ARN, and the config row's own project - the external id
         * the role is signed in to with is derived from it alone, never
         * from anything a request names (AmazonSesProjectRole).
         */
        if (
          toProjectAmazonSesAuthenticationType(
            projectSmtpConfig.amazonSesAuthenticationType,
          ) === ProjectAmazonSesAuthenticationType.IamRole
        ) {
          return this.toAmazonSesRoleEmailServer(projectSmtpConfig, base);
        }

        const accessKeyId: string =
          projectSmtpConfig.amazonSesAccessKeyId?.trim() || "";
        const secretAccessKey: string =
          projectSmtpConfig.amazonSesSecretAccessKey?.trim() || "";
        const region: string =
          projectSmtpConfig.amazonSesRegion?.trim().toLowerCase() || "";

        if (!accessKeyId) {
          throw new BadDataException(
            "Project SMTP config Amazon SES Access Key ID is not set",
          );
        }

        if (!secretAccessKey) {
          throw new BadDataException(
            "Project SMTP config Amazon SES Secret Access Key is not set",
          );
        }

        if (!region) {
          throw new BadDataException(
            "Project SMTP config Amazon SES Region is not set",
          );
        }

        if (!isAwsRegion(region)) {
          throw new BadDataException(
            `Project SMTP config Amazon SES Region "${region.slice(0, 40)}" is not an AWS Region. Use a code such as us-east-1.`,
          );
        }

        return {
          ...base,
          awsAccessKeyId: accessKeyId,
          awsSecretAccessKey: secretAccessKey,
          awsRegion: region,
        };
      }

      case MailTransportType.SendGrid:
        return {
          ...base,
          apiKey: this.requireKey(
            projectSmtpConfig.sendgridApiKey,
            "SendGrid API Key",
          ),
        };

      case MailTransportType.Mailgun: {
        const apiKey: string = this.requireKey(
          projectSmtpConfig.mailgunApiKey,
          "Mailgun API Key",
        );
        const domain: string =
          projectSmtpConfig.mailgunDomain?.trim().toLowerCase() || "";

        if (!domain) {
          throw new BadDataException(
            "Project SMTP config Mailgun Domain is not set",
          );
        }

        if (!isMailgunDomain(domain)) {
          throw new BadDataException(
            `Project SMTP config Mailgun Domain "${domain.slice(0, 60)}" is not a domain. Use the sending domain as Mailgun lists it, such as mg.example.com.`,
          );
        }

        return {
          ...base,
          apiKey: apiKey,
          mailgunDomain: domain,
          mailgunRegion: toMailgunRegion(projectSmtpConfig.mailgunRegion),
        };
      }

      case MailTransportType.Postmark:
        return {
          ...base,
          apiKey: this.requireKey(
            projectSmtpConfig.postmarkServerToken,
            "Postmark Server API Token",
          ),
        };

      case MailTransportType.Resend:
        return {
          ...base,
          apiKey: this.requireKey(
            projectSmtpConfig.resendApiKey,
            "Resend API Key",
          ),
        };

      default:
        throw new BadDataException(
          `Project SMTP config transport "${transportType}" does not send through an HTTP API.`,
        );
    }
  }

  /*
   * An Amazon SES config that signs in to an IAM role in the project's own
   * AWS account: the role's ARN, the Region, and the project the row
   * belongs to. No access key is read, and none is handed on.
   */
  private toAmazonSesRoleEmailServer(
    projectSmtpConfig: Model,
    base: EmailServer,
  ): EmailServer {
    const roleArn: string = projectSmtpConfig.amazonSesRoleArn?.trim() || "";
    const region: string =
      projectSmtpConfig.amazonSesRegion?.trim().toLowerCase() || "";
    const projectId: string = projectSmtpConfig.projectId?.toString() || "";

    if (!isAwsRoleArn(roleArn)) {
      throw new BadDataException(AMAZON_SES_ROLE_ARN_INVALID);
    }

    if (!region || !isAwsRegion(region)) {
      throw new BadDataException(AMAZON_SES_ROLE_REGION_REQUIRED);
    }

    if (!projectId) {
      throw new BadDataException(
        "This SMTP config was read without its project, so its Amazon SES role cannot be signed in to.",
      );
    }

    return {
      ...base,
      awsRoleArn: roleArn,
      awsRoleProjectId: projectId,
      awsRegion: region,
    };
  }

  /*
   * HOW A CONFIG SIGNS IN TO AMAZON SES, AS IT IS WRITTEN (#7378).
   *
   * The Authentication Type is a project's own (Access Key, IAM Role), or
   * nothing written (an access key, as every config had); anything else -
   * the server's "Server IAM Role" among it - is refused with what it may
   * be. A config of Amazon SES that signs in with an IAM role needs a role
   * ARN and a Region, as stored after the write; and signing in with a
   * role stores no key, so the access key it signed in with before is
   * cleared in the same write, as the server's own Amazon SES card does
   * (GlobalConfigService.applyAmazonSesAuthenticationRules): a key nothing
   * uses any more is only one more to leak. A role ARN written on its own is
   * checked to be one.
   */
  public static applyAmazonSesAuthenticationRules(
    data: Record<string, unknown>,
    stored?: Record<string, unknown> | undefined,
  ): void {
    const value: unknown = data["amazonSesAuthenticationType"];

    if (value === "") {
      data["amazonSesAuthenticationType"] =
        ProjectAmazonSesAuthenticationType.AccessKey;
    } else if (
      value !== undefined &&
      value !== null &&
      !isProjectAmazonSesAuthenticationType(value)
    ) {
      throw new BadDataException(AMAZON_SES_AUTHENTICATION_TYPE_INVALID);
    }

    const roleArn: unknown = data["amazonSesRoleArn"];

    if (typeof roleArn === "string") {
      data["amazonSesRoleArn"] = roleArn.trim() || null;
    }

    if (
      data["amazonSesRoleArn"] !== undefined &&
      data["amazonSesRoleArn"] !== null &&
      !isAwsRoleArn(String(data["amazonSesRoleArn"]))
    ) {
      throw new BadDataException(AMAZON_SES_ROLE_ARN_INVALID);
    }

    // What the row holds once this write is done.
    const after: (column: string) => unknown = (column: string): unknown => {
      return data[column] !== undefined ? data[column] : stored?.[column];
    };

    const signsInWithRole: boolean =
      toProjectAmazonSesAuthenticationType(
        after("amazonSesAuthenticationType"),
      ) === ProjectAmazonSesAuthenticationType.IamRole;

    if (!signsInWithRole) {
      return;
    }

    // No key is stored for a role, whatever the write held.
    data["amazonSesAccessKeyId"] = null;
    data["amazonSesSecretAccessKey"] = null;

    if (
      toMailTransportType(after("transportType")) !==
      MailTransportType.AmazonSES
    ) {
      return;
    }

    if (!isAwsRoleArn(String(after("amazonSesRoleArn") || ""))) {
      throw new BadDataException(AMAZON_SES_ROLE_ARN_INVALID);
    }

    const region: string = String(after("amazonSesRegion") || "")
      .trim()
      .toLowerCase();

    if (!region || !isAwsRegion(region)) {
      throw new BadDataException(AMAZON_SES_ROLE_REGION_REQUIRED);
    }
  }

  private requireKey(value: string | undefined, fieldTitle: string): string {
    const key: string = value?.trim() || "";

    if (!key) {
      throw new BadDataException(
        `Project SMTP config ${fieldTitle} is not set`,
      );
    }

    return key;
  }
}
export default new Service();
