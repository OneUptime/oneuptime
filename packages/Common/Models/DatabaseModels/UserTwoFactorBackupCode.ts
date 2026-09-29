import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import User from "./User";
import Route from "../../Types/API/Route";
import AllowAccessIfSubscriptionIsUnpaid from "../../Types/Database/AccessControl/AllowAccessIfSubscriptionIsUnpaid";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import AllowUserQueryWithoutTenant from "../../Types/Database/AllowUserQueryWithoutTenant";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import CurrentUserCanAccessRecordBy from "../../Types/Database/CurrentUserCanAccessRecordBy";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * One single-use recovery code, for the sign-in a user cannot otherwise
 * complete: the authenticator app went down with the phone, or the security
 * key is gone.
 *
 * ONE ROW PER CODE, NOT ONE ROW PER USER
 *
 * The alternative -- a single row holding a JSON array of digests -- would
 * make consuming a code a read-modify-write of the whole array, and two
 * sign-in attempts arriving together would each write back a copy of the array
 * missing only their own code, so one of the two consumed codes would come
 * back to life. A row per code turns consumption into one conditional UPDATE
 * that Postgres settles for us (see UserTwoFactorBackupCodeService.consumeCode).
 *
 * IT IS NOT A SECOND FACTOR, AND IS DELIBERATELY NOT COUNTED AS ONE
 *
 * UserService.countVerifiedTwoFactorAuthMethods sums TOTP apps and security
 * keys and does NOT look here. That is load-bearing rather than an oversight:
 * an account whose only remaining "method" was a backup code would read as
 * fully configured, so login would send it to the two factor CHALLENGE screen
 * instead of through enrolment -- and the user, having no authenticator left
 * to enrol from, would burn recovery codes one per sign-in until they ran out
 * and then be locked out for good. Backup codes are the way BACK IN to an
 * account that has a factor it cannot currently reach; they are not the
 * factor.
 *
 * NOTHING HERE IS WRITABLE THROUGH THE CRUD API
 *
 * Every table permission except read is empty, so codes can only be minted by
 * the service (which writes as root) -- never by a caller choosing their own.
 * A user who could POST their own code has turned a stolen password into a
 * permanent second factor of their own devising.
 */
@EnableDocumentation({
  isMasterAdminApiDocs: true,
})
@AllowAccessIfSubscriptionIsUnpaid()
@TableAccessControl({
  /*
   * Minting is POST /user-two-factor-backup-code/generate, which regenerates
   * the whole set at once. There is no meaningful "create one code" operation
   * and, more to the point, no safe one: the code is the credential, so a
   * caller supplying it is choosing their own recovery secret.
   */
  create: [],

  /*
   * Read is open to the owner so the profile page can count what is left. It
   * exposes nothing: `codeHash` denies read to everybody, so a row read here
   * carries only its id, its `usedAt` and its owner.
   */
  read: [Permission.CurrentUser],

  /*
   * Consumption is a server-side write on the login path and regeneration
   * replaces the set wholesale. A user-driven update or delete could only
   * make a code stop working, which is the same thing regeneration does more
   * clearly, and would give an attacker holding a session a way to quietly
   * strip the account's recovery options.
   */
  delete: [],
  update: [],
})
@CrudApiEndpoint(new Route("/user-two-factor-backup-code"))
@Entity({
  name: "UserTwoFactorBackupCode",
})
@TableMetadata({
  tableName: "UserTwoFactorBackupCode",
  singularName: "Two Factor Backup Code",
  pluralName: "Two Factor Backup Codes",
  icon: IconProp.Key,
  tableDescription:
    "Single-use backup codes that let a user sign in when their two factor authentication device is unavailable",
})
@AllowUserQueryWithoutTenant(true)
@CurrentUserCanAccessRecordBy("userId")
/*
 * The entire hot path is `WHERE "userId" = ... AND "codeHash" = ...` -- the
 * conditional UPDATE that consumes a code during a sign-in somebody is locked
 * out of. `userId` alone leads the index so the profile page's "how many are
 * left" count uses it too.
 */
@Index(["userId", "codeHash"])
class UserTwoFactorBackupCode extends BaseModel {
  /*
   * HMAC-SHA256 of the code, keyed by the instance's EncryptionSecret and
   * domain separated by the owning user -- see
   * Common/Server/Utils/TwoFactorBackupCode.ts for the construction.
   *
   * Read is denied to EVERYONE, including the owner and a master admin. There
   * is no product question this column answers: the plaintext is shown once,
   * at generation, and never again. A master admin bypasses column read
   * permissions on some paths, which is exactly why nothing here is worth
   * shipping to a browser even in digest form.
   *
   * Not UNIQUE. The digest is domain separated by user, so two users cannot
   * collide even if they were issued the same code, and within one user
   * `generateCodeSet` already rules duplicates out -- a unique constraint
   * would add nothing and would turn an astronomically unlikely collision
   * into a failed regeneration for somebody who is already having a bad day.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: false,
    title: "Backup Code Hash",
    description: "Keyed hash of this single-use two factor backup code",
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
    unique: false,
  })
  public codeHash?: string = undefined;

  /*
   * When this code was spent, or null while it is still usable.
   *
   * The row is kept rather than deleted on use, for two reasons that both
   * matter to somebody recovering an account: the profile page can say "3 of
   * 10 remaining" instead of silently shrinking a list, and a user who is
   * asking "did somebody else get into my account?" has a timestamp to look
   * at rather than an absence.
   */
  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    canReadOnRelationQuery: false,
    title: "Used At",
    description:
      "When this backup code was used to sign in. Null while the code is still unused.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
    unique: false,
  })
  public usedAt?: Date = undefined;

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

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "userId",
    type: TableColumnType.Entity,
    title: "User",
    modelType: User,
    description: "Relation to User who owns this backup code",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      cascade: false,
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "userId" })
  public user?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "User ID",
    description: "User ID who owns this backup code",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public userId?: ObjectID = undefined;
}

export default UserTwoFactorBackupCode;
