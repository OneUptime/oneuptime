import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import Email from "../../Types/Email";
import IconProp from "../../Types/Icon/IconProp";
import MailStatus from "../../Types/Mail/MailStatus";
import ObjectID from "../../Types/ObjectID";
import { Column, Entity, Index } from "typeorm";

/*
 * THE SERVER'S OWN EMAIL LOG, FOR ITS MASTER ADMINS (#6878).
 *
 * A project's Email Logs list that project's emails. An email that belongs
 * to no project - a sign-up's verification, a password reset, a sign-in
 * link, an invitation, an email to the server's admins - left no row
 * anywhere, so "did the reset email go out?" had no answer, and a failure
 * spread over many projects was seen only as the banner's last one.
 *
 * Kept here, by MailService, through the server's own email settings:
 *
 *   - every email that belongs to no project, sent or not;
 *   - every email of a project that the server's own settings failed to
 *     send - the ones that went out are in that project's Email Logs.
 *
 * Who it went to, what it was (the subject, links taken out, and the
 * template), when, whether it went, and the mail service's answer. Never
 * the message itself: a password reset or a verification carries a token
 * that signs its holder in.
 *
 * Read by master admins only, through GET /global-config/email-log: no
 * CRUD API, no read permission for anyone (an address is personal data).
 * Kept SERVER_EMAIL_LOG_RETENTION_IN_DAYS days (ServerEmailLogService).
 */
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@TableMetadata({
  tableName: "ServerEmailLog",
  singularName: "Server Email Log",
  pluralName: "Server Email Logs",
  icon: IconProp.Email,
  tableDescription:
    "Emails this server sent through its own email settings that belong to no project, and the ones of a project that failed. Never the message itself.",
})
@Entity({
  name: "ServerEmailLog",
})
// The Email Log card's two lists, newest first: every email, and the failed ones.
@Index(["createdAt"])
@Index(["status", "createdAt"])
export default class ServerEmailLog extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Email,
    title: "To",
    description: "The address the email was sent to.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Email,
    length: ColumnLength.Email,
    transformer: Email.getDatabaseTransformer(),
  })
  public toEmail?: Email = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Subject",
    description: "The email's subject, with any link in it taken out.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public subject?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Template",
    description: "Which of OneUptime's emails it was.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public templateType?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(MailStatus),
    title: "Status",
    description: "Whether the mail service took the email.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public status?: MailStatus = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Status Message",
    description: "What the mail service answered, or why nothing was sent.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public statusMessage?: string = undefined;

  /*
   * The project the email was sent for, when there was one: a plain id,
   * never a relation, so the row is no project's to read and outlives the
   * project for its retention.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ObjectID,
    title: "Project ID",
    description: "The project the email was sent for, if any.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ObjectID,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;
}
