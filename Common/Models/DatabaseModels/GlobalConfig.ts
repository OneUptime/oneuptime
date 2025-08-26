import GlobalConfigModel from "../../Models/DatabaseModels/DatabaseBaseModel/GlobalConfig";
import Hostname from "../../Types/API/Hostname";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import Email from "../../Types/Email";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Phone from "../../Types/Phone";
import Port from "../../Types/Port";
import { Column, Entity } from "typeorm";

export enum EmailServerType {
  Sendgrid = "Sendgrid",
  CustomSMTP = "Custom SMTP",
}

@TableMetadata({
  tableName: "GlobalConfig",
  singularName: "Global Config",
  pluralName: "Global Configs",
  icon: IconProp.Settings,
  tableDescription: "Settings for OneUptime Server",
})
@Entity({
  name: "GlobalConfig",
})
@CrudApiEndpoint(new Route("/global-config"))
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
export default class GlobalConfig extends GlobalConfigModel {
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    title: "Disable Signup",
    description: "Should we disable new user sign up to this server?",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: true,
    default: false,
    unique: true,
  })
  public disableSignup?: boolean = undefined;

  // SMTP Settings.

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    title: "Is SMTP Secure",
    description: "Is this SMTP server hosted with SSL/TLS?",
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: true,
    unique: true,
  })
  public isSMTPSecure?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "SMTP Username",
    description: "Username for your SMTP Server",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: true,
  })
  public smtpUsername?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "SMTP Password",
    description: "Password for your SMTP Server",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: true,
  })
  public smtpPassword?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "SMTP Port",
    description: "Port for your SMTP Server",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    unique: true,
    transformer: Port.getDatabaseTransformer(),
  })
  public smtpPort?: Port = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "SMTP Host",
    description: "Host for your SMTP Server",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: true,
    transformer: Hostname.getDatabaseTransformer(),
  })
  public smtpHost?: Hostname = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Email,
    title: "SMTP From Email",
    description: "Which email should we send mail from?",
  })
  @Column({
    type: ColumnType.Email,
    length: ColumnLength.Email,
    nullable: true,
    unique: true,
    transformer: Email.getDatabaseTransformer(),
  })
  public smtpFromEmail?: Email = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "SMTP From Name",
    description: "Which name should we send emails from?",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: true,
  })
  public smtpFromName?: string = undefined;

  // Twilio config.

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Twilio Account SID",
    description: "Account SID for your Twilio Account",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: true,
  })
  public twilioAccountSID?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Twilio Auth Token",
    description: "Auth Token for your Twilio Account",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: true,
  })
  public twilioAuthToken?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Phone,
    title: "Twilio Primary Phone Number",
    description: "Secondary Phone Number for your Twilio account",
  })
  @Column({
    type: ColumnType.Phone,
    length: ColumnLength.Phone,
    nullable: true,
    unique: false,
    transformer: Phone.getDatabaseTransformer(),
  })
  public twilioPrimaryPhoneNumber?: Phone = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    title: "Twilio Secondary Phone Numbers",
    description: "Secondary Phone Number for your Twilio account",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
    unique: false,
  })
  public twilioSecondaryPhoneNumbers?: string = undefined; // phone numbers separated by comma

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Email Server Type",
    description: "Email Server Type",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: true,
    unique: true,
  })
  public emailServerType?: EmailServerType = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Sendgrid API Key",
    description: "Sendgrid API Key",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: true,
    unique: true,
  })
  public sendgridApiKey?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Email,
    title: "Sendgrid From Email",
    description: "Sendgrid From Email",
  })
  @Column({
    type: ColumnType.Email,
    nullable: true,
    unique: true,
  })
  public sendgridFromEmail?: Email = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Sendgrid From Name",
    description: "Sendgrid From Name",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: true,
    unique: true,
  })
  public sendgridFromName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    title: "Is Master API Key Enabled",
    description: "Is Master API Key Enabled?",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: true,
    unique: true,
    default: false,
  })
  public isMasterApiKeyEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    computed: true,
    title: "Master API Key",
    description:
      "This API key has root access to all the resources in all the projects on OneUptime.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    unique: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public masterApiKey?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Email,
    title: "Admin Notification Email",
    description:
      "Email to send admin notifications to (when probes are offline, etc.)",
  })
  @Column({
    type: ColumnType.Email,
    length: ColumnLength.Email,
    nullable: true,
    unique: true,
    transformer: Email.getDatabaseTransformer(),
  })
  public adminNotificationEmail?: Email = undefined;

  // Meta WhatsApp Business API Config

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Meta WhatsApp Access Token",
    description: "Access Token for Meta WhatsApp Business API",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: true,
  })
  public metaWhatsAppAccessToken?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Meta WhatsApp Phone Number ID",
    description: "Phone Number ID for Meta WhatsApp Business API",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: true,
  })
  public metaWhatsAppPhoneNumberId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Meta WhatsApp Business Account ID",
    description: "Business Account ID for Meta WhatsApp Business API",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: true,
  })
  public metaWhatsAppBusinessAccountId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Meta WhatsApp App ID",
    description: "App ID for Meta WhatsApp Business API",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: true,
  })
  public metaWhatsAppAppId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Meta WhatsApp App Secret",
    description: "App Secret for Meta WhatsApp Business API",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: true,
  })
  public metaWhatsAppAppSecret?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Meta WhatsApp Webhook Verify Token",
    description: "Webhook Verify Token for Meta WhatsApp Business API",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: true,
  })
  public metaWhatsAppWebhookVerifyToken?: string = undefined;
}
