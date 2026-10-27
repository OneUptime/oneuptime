import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableEditionAccessControl from "../../Types/Database/AccessControl/TableEditionAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import { Column, Entity, JoinColumn, ManyToOne } from "typeorm";

/*
 * A CUSTOM CHANNEL: A WAY TO REACH PEOPLE THAT THE INSTALLATION'S ADMIN ADDS.
 *
 * Email, SMS, a call or a push each reach a person at an address of their own,
 * which they add and verify. A custom channel reaches everybody through one
 * service the admin runs - their company's own app, a pager system, a gateway
 * that scrubs what leaves the network - and OneUptime tells that service who
 * the page is for (their id, name and email) and what it is about. So people
 * set nothing up: the channel is there for everyone, their on-call rules point
 * at it like at any other method, and each page is POSTed to the channel's URL,
 * signed with its secret, with links its service calls back to acknowledge,
 * escalate or resolve (CustomNotificationChannelPayload).
 *
 * It belongs to the installation, not to a project, and only a master admin
 * reads or writes it: every list below is empty. The URL and the secret are
 * the admin's own - whoever holds the secret can sign requests as OneUptime -
 * so they never reach a project member, not through this table and not
 * through a rule that points at a channel (UserNotificationRule's relation is
 * read by nobody). Members see a channel's id and name alone, from
 * CustomNotificationChannelAPI's list of the channels that are on.
 *
 * An Enterprise feature (EnterpriseFeature.CustomNotificationChannels):
 * adding or changing a channel needs it (EditionPermissions), and nothing is
 * sent to one while it is not active. The table stays in core, as every
 * enterprise table does, so switching editions needs no migration; deleting
 * a channel needs no license.
 */
@TableEditionAccessControl({
  requiresEnterprise: true,
})
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@CrudApiEndpoint(new Route("/custom-notification-channel"))
@Entity({
  name: "CustomNotificationChannel",
})
@TableMetadata({
  tableName: "CustomNotificationChannel",
  singularName: "Custom Channel",
  pluralName: "Custom Channels",
  icon: IconProp.Webhook,
  tableDescription:
    "Ways to reach people that the server's admin adds: each page goes to the channel's URL as a signed JSON request.",
})
class CustomNotificationChannel extends BaseModel {
  // What people see in their notification methods and on-call rules.
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    title: "Name",
    required: true,
    unique: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    description:
      "What people see in their notification methods and on-call rules, for example CorpoApp.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    unique: false,
    nullable: false,
  })
  public name?: string = undefined;

  /*
   * Where every page is POSTed. The admin's own service, which may well be on
   * the installation's private network, so CustomNotificationChannelService
   * checks it allowing private targets, as it does a person's own webhook.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    title: "Webhook URL",
    required: true,
    unique: false,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: false,
    description:
      "Where OneUptime sends each page, as a JSON POST request signed with the signing secret.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    unique: false,
    nullable: false,
  })
  public webhookUrl?: string = undefined;

  /*
   * The HMAC key every request is signed with (X-OneUptime-Signature). The
   * service checks it to know a page came from OneUptime; whoever reads it can
   * forge one. Generated when the admin leaves it empty.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    title: "Signing Secret",
    required: true,
    unique: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: false,
    description:
      "Every request carries an HMAC-SHA256 signature of its body made with this secret, in the X-OneUptime-Signature header (sha256=<hex>).",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    unique: false,
    nullable: false,
  })
  public secret?: string = undefined;

  /*
   * Off stops every page to the channel without deleting it: the rules that
   * point at it stay, each page they make is recorded as not sent, and turning
   * it back on sends again. Deleting the channel deletes those rules.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    title: "On",
    description:
      "Whether OneUptime sends pages to this channel. Turn it off to stop sending without removing it from anyone's on-call rules.",
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    defaultValue: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: true,
  })
  public isEnabled?: boolean = undefined;

  /*
   * Whether everyone is paged through the channel without adding it
   * themselves: OneUptime adds it to every member's on-call rules in every
   * project, now and whenever somebody joins, and pages through it a
   * responder who has no rule for what fired (the fallback). Off, it is one
   * more method people may pick in their rules.
   *
   * Turning it off later stops adding it; the rules it added stay, since
   * people may have changed them since.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    title: "Page Everyone",
    description:
      "Whether OneUptime adds this channel to everyone's on-call rules, including people who join later.",
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    defaultValue: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: true,
  })
  public pageEveryoneByDefault?: boolean = undefined;

  /*
   * When OneUptime finished adding the channel to the rules of everybody who
   * was a member then; null while that is still to do. The worker job that
   * does it (AddCustomChannelToEveryonesRules) picks up every channel that is
   * on, pages everyone and has this null, so a run stopped part way is taken
   * up again by the next one, and a channel it finished is never swept again
   * - somebody who removed it from their rules afterwards keeps it removed.
   * CustomNotificationChannelService clears it whenever a channel starts
   * paging everyone; people who join later get it as they join.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    title: "Added To Everyone's Rules At",
    description:
      "When OneUptime finished adding this channel to everyone's on-call rules. Empty while that is still to do.",
    type: TableColumnType.Date,
    required: false,
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public addedToEveryonesRulesAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created by User",
    description:
      "Relation to User who created this object (if this object was created by a User)",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "createdByUserId" })
  public createdByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    title: "Deleted by User",
    modelType: User,
    description:
      "Relation to User who deleted this object (if this object was deleted by a User)",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      cascade: false,
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "deletedByUserId" })
  public deletedByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted by User ID",
    description:
      "User ID who deleted this object (if this object was deleted by a User)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}

export default CustomNotificationChannel;
