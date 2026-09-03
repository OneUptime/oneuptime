import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import UniqueColumnBy from "../../Types/Database/UniqueColumnBy";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * A reusable SNMP credential set, scoped to a project.
 *
 * WHY THIS EXISTS. Before profiles, a device's SNMP credentials lived only on
 * the device row, so a device could not be walked until somebody had typed a
 * community string or a v3 user onto that specific device - and a device
 * registered without them stayed a ping-only device for good. Profiles move
 * the credentials off the device. A device can be added with nothing but an
 * address and is pinged from its first poll; the moment a profile is attached
 * to it, or to its site, the same device is walked over SNMP on its next poll
 * with no edit to the device itself. That is also what turns a community
 * string rotation into a single edit instead of one per device.
 *
 * RESOLUTION ORDER AT POLL TIME. The poller looks for a usable credential set
 * (Utils/NetworkDevice/SnmpCredentialUtil decides "usable") in this order and
 * stops at the first hit:
 *
 *   1. the device's own snmp* columns,
 *   2. the profile the device points at (NetworkDevice.snmpCredentialProfileId),
 *   3. the profile the device's site points at (NetworkSite.snmpCredentialProfileId).
 *
 * With none of the three the device is pinged and never walked. Both
 * relations are ON DELETE SET NULL: deleting a profile must never delete the
 * devices or sites using it - they simply drop down the resolution order.
 *
 * SECRETS. snmpCommunityString, snmpV3AuthKey and snmpV3PrivKey carry exactly
 * the column access control the same three columns carry on NetworkDevice:
 * Viewer and SettingsViewer may not read them, and they are not selectable
 * through a relation query, so a device or site listing that joins its
 * profile can show the profile's name and version but never its secrets.
 * They are also ENCRYPTED AT REST (`encrypted: true`, the MonitorSecret
 * precedent): DatabaseService encrypts them on every create and update and
 * decrypts them on every server-side find, so the poller - reading as root -
 * sees plaintext while the database, a backup or a dump does not. A profile
 * is a place to keep credentials, not a place that makes them easier to read
 * than they were on the device.
 */
@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.CreateNetworkSnmpCredentialProfile,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.SettingsViewer,
    Permission.ReadNetworkSnmpCredentialProfile,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.DeleteNetworkSnmpCredentialProfile,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.EditNetworkSnmpCredentialProfile,
  ],
})
@CrudApiEndpoint(new Route("/network-snmp-credential-profile"))
@TableMetadata({
  tableName: "NetworkSnmpCredentialProfile",
  singularName: "SNMP Credential Profile",
  pluralName: "SNMP Credential Profiles",
  icon: IconProp.Key,
  tableDescription:
    "A reusable set of SNMP credentials. Attach a profile to a device or to a site and every device it covers is walked over SNMP with these credentials instead of carrying its own.",
})
@Entity({
  name: "NetworkSnmpCredentialProfile",
})
export default class NetworkSnmpCredentialProfile extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateNetworkSnmpCredentialProfile,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadNetworkSnmpCredentialProfile,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to Project Resource in which this object belongs",
  })
  @ManyToOne(
    () => {
      return Project;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "projectId" })
  public project?: Project = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateNetworkSnmpCredentialProfile,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadNetworkSnmpCredentialProfile,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of your OneUptime Project in which this object belongs",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateNetworkSnmpCredentialProfile,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadNetworkSnmpCredentialProfile,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditNetworkSnmpCredentialProfile,
    ],
  })
  /*
   * The name is the only thing a device or site listing shows about the
   * profile it is joined to, which is why it is the one credential-adjacent
   * column that is readable on a relation query. It is unique per project
   * rather than globally: "Default v2c" is a name every project wants.
   */
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "Any friendly name of this object",
    example: "Branch offices - v3 authPriv",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  @UniqueColumnBy("projectId")
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateNetworkSnmpCredentialProfile,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadNetworkSnmpCredentialProfile,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditNetworkSnmpCredentialProfile,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "Friendly description that will help you remember",
    example: "Read-only community used by every branch office switch.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  /*
   * --- Credentials ---
   * Column for column the same shape as the snmp* columns on NetworkDevice,
   * because a profile has to be able to hold anything a device could, and
   * because the poller reads the two through one predicate. The non-secret
   * columns copy the device's column exactly - type, length, default and its
   * open read list. The three secret columns copy the device's RESTRICTED
   * read list and then go one step further than the device does: they are
   * encrypted at rest, which is also why their column type is `text` rather
   * than the device's varchar (see snmpCommunityString).
   */

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateNetworkSnmpCredentialProfile,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadNetworkSnmpCredentialProfile,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditNetworkSnmpCredentialProfile,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "SNMP Version",
    description:
      "SNMP version devices using this profile are polled with (V1, V2c, V3)",
    example: "V2c",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: "V2c",
  })
  public snmpVersion?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateNetworkSnmpCredentialProfile,
    ],
    /*
     * SECRET. Viewer and SettingsViewer are deliberately absent, and there is
     * no canReadOnRelationQuery: this is the community string, and it is
     * exactly as restricted here as it is on NetworkDevice.
     */
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.ReadNetworkSnmpCredentialProfile,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditNetworkSnmpCredentialProfile,
    ],
  })
  /*
   * ENCRYPTED AT REST, and VeryLongText because of it.
   *
   * `encrypted: true` is the whole mechanism: DatabaseService.encrypt runs
   * over getEncryptedColumns() on every create and update, and
   * DatabaseService.decrypt runs over the same list on every find, so the
   * database only ever holds AES ciphertext and every server-side reader
   * gets plaintext without knowing the column was encrypted. The ciphertext
   * is salted base64, two to three times the length of the plaintext, so
   * the device's varchar(100) would overflow on a long community string -
   * which is why this column, like every other encrypted text column in the
   * schema (MonitorSecret.secretValue, RunbookCredential.*), is `text`.
   *
   * The device's own snmpCommunityString predates encryption and still holds
   * plaintext in a varchar(100). Bringing it in line means re-encrypting
   * every existing row in place and is a separate migration; a profile can
   * only make sure that the credentials it holds are not the weak copy.
   */
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "SNMP Community String",
    description: "Community string used for SNMP v1/v2c polling",
    example: "public",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public snmpCommunityString?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateNetworkSnmpCredentialProfile,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadNetworkSnmpCredentialProfile,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditNetworkSnmpCredentialProfile,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "SNMP Port",
    description: "UDP port used for SNMP polling",
    example: "161",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: 161,
  })
  public snmpPort?: number = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateNetworkSnmpCredentialProfile,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadNetworkSnmpCredentialProfile,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditNetworkSnmpCredentialProfile,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "SNMP v3 Security Level",
    description:
      "SNMP v3 security level: noAuthNoPriv, authNoPriv, or authPriv",
    example: "authPriv",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public snmpV3SecurityLevel?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateNetworkSnmpCredentialProfile,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadNetworkSnmpCredentialProfile,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditNetworkSnmpCredentialProfile,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "SNMP v3 Username",
    description: "Security name (username) used for SNMP v3 polling",
    example: "monitoring",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public snmpV3Username?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateNetworkSnmpCredentialProfile,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadNetworkSnmpCredentialProfile,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditNetworkSnmpCredentialProfile,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "SNMP v3 Authentication Protocol",
    description: "SNMP v3 authentication protocol: MD5, SHA, SHA256, or SHA512",
    example: "SHA",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public snmpV3AuthProtocol?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateNetworkSnmpCredentialProfile,
    ],
    /*
     * SECRET - see snmpCommunityString.
     */
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.ReadNetworkSnmpCredentialProfile,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditNetworkSnmpCredentialProfile,
    ],
  })
  /*
   * ENCRYPTED AT REST - see snmpCommunityString for why, and for why the
   * column is `text` where the device's is a varchar.
   */
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "SNMP v3 Authentication Key",
    description: "SNMP v3 authentication passphrase",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public snmpV3AuthKey?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateNetworkSnmpCredentialProfile,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadNetworkSnmpCredentialProfile,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditNetworkSnmpCredentialProfile,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "SNMP v3 Privacy Protocol",
    description: "SNMP v3 privacy (encryption) protocol: DES, AES, or AES256",
    example: "AES",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public snmpV3PrivProtocol?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateNetworkSnmpCredentialProfile,
    ],
    /*
     * SECRET - see snmpCommunityString.
     */
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.ReadNetworkSnmpCredentialProfile,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditNetworkSnmpCredentialProfile,
    ],
  })
  /*
   * ENCRYPTED AT REST - see snmpCommunityString.
   */
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "SNMP v3 Privacy Key",
    description: "SNMP v3 privacy (encryption) passphrase",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public snmpV3PrivKey?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateNetworkSnmpCredentialProfile,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadNetworkSnmpCredentialProfile,
    ],
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateNetworkSnmpCredentialProfile,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadNetworkSnmpCredentialProfile,
    ],
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
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadNetworkSnmpCredentialProfile,
    ],
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
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadNetworkSnmpCredentialProfile,
    ],
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
