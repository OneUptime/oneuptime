import UserCall from "../../../../../Models/DatabaseModels/UserCall";
import UserEmail from "../../../../../Models/DatabaseModels/UserEmail";
import UserPush from "../../../../../Models/DatabaseModels/UserPush";
import UserSMS from "../../../../../Models/DatabaseModels/UserSMS";
import UserTelegram from "../../../../../Models/DatabaseModels/UserTelegram";
import UserWebhook from "../../../../../Models/DatabaseModels/UserWebhook";
import UserWhatsApp from "../../../../../Models/DatabaseModels/UserWhatsApp";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "../../../../../Server/Services/DatabaseService";
import FindBy from "../../../../../Server/Types/Database/FindBy";
import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import { CheckReadPermissionType } from "../../../../../Server/Types/Database/Permissions/ReadPermission";
import Query from "../../../../../Server/Types/Database/Query";
import Select from "../../../../../Server/Types/Database/Select";
import NotEqual from "../../../../../Types/BaseDatabase/NotEqual";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ColumnAccessControl from "../../../../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../../../../Types/Database/AccessControl/TableAccessControl";
import CurrentUserCanAccessRecordBy from "../../../../../Types/Database/CurrentUserCanAccessRecordBy";
import TableColumn from "../../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../../Types/Database/TableColumnType";
import TenantColumn from "../../../../../Types/Database/TenantColumn";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";

/*
 * WHAT THIS FILE PINS
 *
 * @OwnerOnlyColumn() marks a column that may be read only by a query pinned to
 * the row's owner. Phase 3 widens UserNotificationRule's TABLE read to
 * administrators - which is the feature, and is correct - and the moment it
 * does, an admin's read of that table is no longer confined to their own rows.
 * Everything reachable from those rows is then reachable by an admin, and the
 * seven notification-method models hang off them by ManyToOne relation.
 *
 * There are FOUR routes into a marked column, and closing three of them is the
 * same as closing none. Every route below is driven through the real permission
 * entry point - ModelPermission.checkReadQueryPermission for the query and
 * select routes, DatabaseService's own sort-injection for the sort route -
 * never by asserting on decorator metadata. A guard that is only proved by
 * reading back the mark that configures it proves nothing about whether the
 * mark is consulted.
 *
 *   Route 1  select: { webhookUrl: true }                      on UserWebhook
 *   Route 2  select: { userWebhook: { webhookUrl: true } }      on a rule
 *   Route 3  sort:   { webhookUrl: "ASC" }                      injected post-gate
 *   Route 4  query:  { webhookUrl: "https://..." }              as a value oracle
 *
 * HOW THE ADMIN CASE IS SET UP, AND WHY IT IS NOT THEATRE. Today the seven
 * method models list [CurrentUser] and nothing else, so TenantPermission stamps
 * every non-root caller's own userId onto their query and an administrator is
 * indistinguishable from a plain member - the admin case is currently
 * unreachable on those models, and that is precisely what Phase 3 changes. The
 * AdminReadable* classes below are the REAL models with the REAL marked columns
 * and one thing altered: Permission.ProjectAdmin added to the table read list,
 * exactly the change Phase 3 makes. Nothing about the columns, the ownership
 * column or the relation metadata is simulated.
 */

const projectId: ObjectID = ObjectID.generate();
const ownerUserId: ObjectID = ObjectID.generate();
const adminUserId: ObjectID = ObjectID.generate();
const otherUserId: ObjectID = ObjectID.generate();

type ModelTypeUnderTest = { new (): BaseModel };

/*
 * The seven notification-method models with the post-Phase-3 table read. Only
 * the table access control is restated; every column, its @OwnerOnlyColumn
 * mark, the tenant column and @CurrentUserCanAccessRecordBy("userId") are
 * inherited from the production model.
 */
const ADMIN_READABLE_TABLE_ACCESS: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
  delete: Array<Permission>;
} = {
  create: [Permission.CurrentUser],
  read: [Permission.CurrentUser, Permission.ProjectAdmin],
  update: [Permission.CurrentUser, Permission.ProjectAdmin],
  delete: [Permission.CurrentUser],
};

@TableAccessControl(ADMIN_READABLE_TABLE_ACCESS)
class AdminReadableUserEmail extends UserEmail {}

@TableAccessControl(ADMIN_READABLE_TABLE_ACCESS)
class AdminReadableUserSMS extends UserSMS {}

@TableAccessControl(ADMIN_READABLE_TABLE_ACCESS)
class AdminReadableUserCall extends UserCall {}

@TableAccessControl(ADMIN_READABLE_TABLE_ACCESS)
class AdminReadableUserPush extends UserPush {}

@TableAccessControl(ADMIN_READABLE_TABLE_ACCESS)
class AdminReadableUserWhatsApp extends UserWhatsApp {}

@TableAccessControl(ADMIN_READABLE_TABLE_ACCESS)
class AdminReadableUserTelegram extends UserTelegram {}

@TableAccessControl(ADMIN_READABLE_TABLE_ACCESS)
class AdminReadableUserWebhook extends UserWebhook {}

/*
 * UserNotificationRule's shape after Phase 3: readable by an administrator,
 * still owned by a user, and pointing at the REAL method models through the
 * same ManyToOne relations the production rule model uses. The relation columns
 * carry read permissions an admin holds, because the point of Phase 3 is that
 * an admin CAN read this table - the question this file answers is what they
 * can reach through it.
 */
@TenantColumn("projectId")
@TableAccessControl(ADMIN_READABLE_TABLE_ACCESS)
@CurrentUserCanAccessRecordBy("userId")
class AdminReadableRuleModel extends BaseModel {
  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser, Permission.ProjectAdmin],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Project ID",
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser, Permission.ProjectAdmin],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "User ID",
  })
  public userId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser, Permission.ProjectAdmin],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Entity,
    modelType: UserEmail,
    manyToOneRelationColumn: "userEmailId",
    title: "User Email",
  })
  public userEmail?: UserEmail = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser, Permission.ProjectAdmin],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Entity,
    modelType: UserSMS,
    manyToOneRelationColumn: "userSmsId",
    title: "User SMS",
  })
  public userSms?: UserSMS = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser, Permission.ProjectAdmin],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Entity,
    modelType: UserCall,
    manyToOneRelationColumn: "userCallId",
    title: "User Call",
  })
  public userCall?: UserCall = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser, Permission.ProjectAdmin],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Entity,
    modelType: UserPush,
    manyToOneRelationColumn: "userPushId",
    title: "User Push",
  })
  public userPush?: UserPush = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser, Permission.ProjectAdmin],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Entity,
    modelType: UserWhatsApp,
    manyToOneRelationColumn: "userWhatsAppId",
    title: "User WhatsApp",
  })
  public userWhatsApp?: UserWhatsApp = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser, Permission.ProjectAdmin],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Entity,
    modelType: UserTelegram,
    manyToOneRelationColumn: "userTelegramId",
    title: "User Telegram",
  })
  public userTelegram?: UserTelegram = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser, Permission.ProjectAdmin],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Entity,
    modelType: UserWebhook,
    manyToOneRelationColumn: "userWebhookId",
    title: "User Webhook",
  })
  public userWebhook?: UserWebhook = undefined;
}

interface MethodModelUnderTest {
  name: string;
  /* The production model, whose table read is [CurrentUser] today. */
  modelType: ModelTypeUnderTest;
  /* The same model with Phase 3's widened table read. */
  adminReadableModelType: ModelTypeUnderTest;
  /* The relation this method hangs off on a notification rule. */
  relationColumnName: string;
  /* Every column marked @OwnerOnlyColumn() on the model. */
  ownerOnlyColumns: Array<string>;
  /*
   * The marked columns this guard actually decides: marked AND selectable by an
   * ordinary authenticated caller.
   *
   * The four SMS/call/email/WhatsApp verification codes are marked but carry
   * `read: []`, so the column-permission layer already refuses them to
   * everybody including their owner - asserting on those would test the older
   * gate, not this one. UserTelegram.verificationCode is the instructive
   * counter-example: it is readable by CurrentUser (the user has to be shown
   * the code to type into the bot), and CurrentUser is auto-granted to every
   * authenticated caller, so the owner-only mark is the ONLY thing standing
   * between it and any admin in the project.
   */
  ownerOnlyColumnsSelectableByOwner: Array<string>;
  /*
   * A marked column that is ALSO canReadOnRelationQuery, i.e. one that a nested
   * select can actually ask for. This is the route-2 attack surface.
   */
  ownerOnlyColumnReachableThroughRelation: string;
  /*
   * An unmarked column that a nested select can ask for. This is what an admin
   * surface labels rows with, and it must keep working.
   */
  labelColumnReachableThroughRelation: string;
  /* Unmarked columns an admin must keep being able to read directly. */
  labelColumns: Array<string>;
  /* An unmarked, non-relation column that can be sorted on. */
  unmarkedSortColumn: string;
}

const METHOD_MODELS: Array<MethodModelUnderTest> = [
  {
    name: "UserEmail",
    modelType: UserEmail,
    adminReadableModelType: AdminReadableUserEmail,
    relationColumnName: "userEmail",
    ownerOnlyColumns: ["email", "verificationCode"],
    ownerOnlyColumnsSelectableByOwner: ["email"],
    ownerOnlyColumnReachableThroughRelation: "email",
    labelColumnReachableThroughRelation: "projectId",
    labelColumns: ["userId", "projectId", "isVerified"],
    unmarkedSortColumn: "isVerified",
  },
  {
    name: "UserSMS",
    modelType: UserSMS,
    adminReadableModelType: AdminReadableUserSMS,
    relationColumnName: "userSms",
    ownerOnlyColumns: ["phone", "verificationCode"],
    ownerOnlyColumnsSelectableByOwner: ["phone"],
    ownerOnlyColumnReachableThroughRelation: "phone",
    labelColumnReachableThroughRelation: "projectId",
    labelColumns: ["userId", "projectId", "isVerified"],
    unmarkedSortColumn: "isVerified",
  },
  {
    name: "UserCall",
    modelType: UserCall,
    adminReadableModelType: AdminReadableUserCall,
    relationColumnName: "userCall",
    ownerOnlyColumns: ["phone", "verificationCode"],
    ownerOnlyColumnsSelectableByOwner: ["phone"],
    ownerOnlyColumnReachableThroughRelation: "phone",
    labelColumnReachableThroughRelation: "projectId",
    labelColumns: ["userId", "projectId", "isVerified"],
    unmarkedSortColumn: "isVerified",
  },
  {
    name: "UserPush",
    modelType: UserPush,
    adminReadableModelType: AdminReadableUserPush,
    relationColumnName: "userPush",
    ownerOnlyColumns: ["deviceToken"],
    ownerOnlyColumnsSelectableByOwner: ["deviceToken"],
    ownerOnlyColumnReachableThroughRelation: "deviceToken",
    labelColumnReachableThroughRelation: "deviceName",
    labelColumns: [
      "userId",
      "projectId",
      "isVerified",
      "deviceName",
      "deviceType",
    ],
    unmarkedSortColumn: "deviceName",
  },
  {
    name: "UserWhatsApp",
    modelType: UserWhatsApp,
    adminReadableModelType: AdminReadableUserWhatsApp,
    relationColumnName: "userWhatsApp",
    ownerOnlyColumns: ["phone", "verificationCode"],
    ownerOnlyColumnsSelectableByOwner: ["phone"],
    ownerOnlyColumnReachableThroughRelation: "phone",
    labelColumnReachableThroughRelation: "projectId",
    labelColumns: ["userId", "projectId", "isVerified"],
    unmarkedSortColumn: "isVerified",
  },
  {
    name: "UserTelegram",
    modelType: UserTelegram,
    adminReadableModelType: AdminReadableUserTelegram,
    relationColumnName: "userTelegram",
    ownerOnlyColumns: [
      "telegramUserHandle",
      "telegramChatId",
      "verificationCode",
    ],
    ownerOnlyColumnsSelectableByOwner: [
      "telegramUserHandle",
      "telegramChatId",
      "verificationCode",
    ],
    ownerOnlyColumnReachableThroughRelation: "telegramChatId",
    labelColumnReachableThroughRelation: "projectId",
    labelColumns: ["userId", "projectId", "isVerified"],
    unmarkedSortColumn: "isVerified",
  },
  {
    name: "UserWebhook",
    modelType: UserWebhook,
    adminReadableModelType: AdminReadableUserWebhook,
    relationColumnName: "userWebhook",
    ownerOnlyColumns: ["webhookUrl", "secret"],
    ownerOnlyColumnsSelectableByOwner: ["webhookUrl", "secret"],
    ownerOnlyColumnReachableThroughRelation: "webhookUrl",
    labelColumnReachableThroughRelation: "name",
    labelColumns: ["userId", "projectId", "name"],
    unmarkedSortColumn: "name",
  },
];

/*
 * The marked columns that no permission list lets an ordinary caller select at
 * all. Pinned separately so that the guarded list above stays honest about what
 * this guard is responsible for.
 */
const WRITE_ONLY_VERIFICATION_CODE_MODELS: Array<ModelTypeUnderTest> = [
  UserEmail,
  UserSMS,
  UserCall,
  UserWhatsApp,
];

/*
 * Props are rebuilt for every call rather than shared. getUserPermissions()
 * MUTATES the props it is given (it pushes the auto-granted Public and
 * CurrentUser onto the global permission list), so a shared object would carry
 * state between assertions.
 */
function makeOwnerProps(): DatabaseCommonInteractionProps {
  return {
    userId: ownerUserId,
    tenantId: projectId,
  };
}

function makeAdminProps(): DatabaseCommonInteractionProps {
  return {
    userId: adminUserId,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: {
        projectId: projectId,
        permissions: [
          {
            permission: Permission.ProjectAdmin,
            labelIds: [],
            isBlockPermission: false,
            _type: "UserPermission",
          },
        ],
        _type: "UserTenantAccessPermission",
      },
    },
  };
}

/*
 * An API key carrying a project role and no user identity at all. There is no
 * id such a caller could be pinned to, so every marked column must refuse.
 */
function makeApiKeyAdminProps(): DatabaseCommonInteractionProps {
  return {
    userType: UserType.API,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: {
        projectId: projectId,
        permissions: [
          {
            permission: Permission.ProjectAdmin,
            labelIds: [],
            isBlockPermission: false,
            _type: "UserPermission",
          },
        ],
        _type: "UserTenantAccessPermission",
      },
    },
  };
}

function makeRootProps(): DatabaseCommonInteractionProps {
  return {
    isRoot: true,
    tenantId: projectId,
  };
}

type ReadCheck = (
  modelType: ModelTypeUnderTest,
  query: Record<string, unknown>,
  select: Record<string, unknown> | null,
  props: DatabaseCommonInteractionProps,
) => Promise<CheckReadPermissionType<BaseModel>>;

/*
 * The real entry point every read in the product goes through - DatabaseService
 * calls exactly this before handing anything to TypeORM.
 */
const checkRead: ReadCheck = (
  modelType: ModelTypeUnderTest,
  query: Record<string, unknown>,
  select: Record<string, unknown> | null,
  props: DatabaseCommonInteractionProps,
): Promise<CheckReadPermissionType<BaseModel>> => {
  return ModelPermission.checkReadQueryPermission<BaseModel>(
    modelType,
    query as Query<BaseModel>,
    select as Select<BaseModel> | null,
    props,
  );
};

describe("route 1 - a marked column named directly in the select", () => {
  it.each(METHOD_MODELS)(
    "lets the owner read every owner-only column on $name",
    async (model: MethodModelUnderTest): Promise<void> => {
      /*
       * The owner sends no ownership filter at all here. They do not need to:
       * the method models are CurrentUser-only, so TenantPermission stamps
       * `userId = me` onto the query before the select is ever inspected, and
       * that stamp is what pins the read.
       */
      for (const columnName of model.ownerOnlyColumnsSelectableByOwner) {
        const result: CheckReadPermissionType<BaseModel> = await checkRead(
          model.modelType,
          {},
          { [columnName]: true },
          makeOwnerProps(),
        );

        expect((result.select as Record<string, unknown>)[columnName]).toBe(
          true,
        );
      }
    },
  );

  it.each(METHOD_MODELS)(
    "lets the owner read every owner-only column on $name when they name their own id",
    async (model: MethodModelUnderTest): Promise<void> => {
      /*
       * Only the subset the owner may actually select: a verificationCode is
       * read: [] for everybody, so demanding it here would assert a leak.
       */
      for (const columnName of model.ownerOnlyColumnsSelectableByOwner) {
        await expect(
          checkRead(
            model.modelType,
            { userId: ownerUserId },
            { [columnName]: true },
            makeOwnerProps(),
          ),
        ).resolves.toBeDefined();
      }
    },
  );

  it.each(METHOD_MODELS)(
    "refuses an admin reading another member's owner-only columns on $name",
    async (model: MethodModelUnderTest): Promise<void> => {
      for (const columnName of model.ownerOnlyColumns) {
        await expect(
          checkRead(
            model.adminReadableModelType,
            { userId: otherUserId },
            { [columnName]: true },
            makeAdminProps(),
          ),
        ).rejects.toThrow(NotAuthorizedException);
      }
    },
  );

  it.each(METHOD_MODELS)(
    "refuses an admin sweeping $name for owner-only columns across the whole project",
    async (model: MethodModelUnderTest): Promise<void> => {
      /*
       * The most valuable version of the attack asks for no user at all: one
       * request, every row in the project, every credential on it.
       */
      for (const columnName of model.ownerOnlyColumns) {
        await expect(
          checkRead(
            model.adminReadableModelType,
            {},
            { [columnName]: true },
            makeAdminProps(),
          ),
        ).rejects.toThrow(NotAuthorizedException);
      }
    },
  );

  it.each(METHOD_MODELS)(
    "lets an admin read their OWN owner-only columns on $name",
    async (model: MethodModelUnderTest): Promise<void> => {
      /*
       * Being an administrator does not cost you your own settings page. The
       * rule is about which ROW is being read, not about who is asking.
       */
      /*
       * Only the subset the owner may actually select: a verificationCode is
       * read: [] for everybody, so demanding it here would assert a leak.
       */
      for (const columnName of model.ownerOnlyColumnsSelectableByOwner) {
        await expect(
          checkRead(
            model.adminReadableModelType,
            { userId: adminUserId },
            { [columnName]: true },
            makeAdminProps(),
          ),
        ).resolves.toBeDefined();
      }
    },
  );

  it.each(METHOD_MODELS)(
    "refuses an ownership filter on $name that is a query operator rather than an id",
    async (model: MethodModelUnderTest): Promise<void> => {
      /*
       * NotEqual stringifies to the id it wraps, so a guard comparing only
       * string values would read `userId != me` as `userId = me` and hand back
       * every OTHER row in the project - the exact inversion of what was asked
       * for. The type is checked before the value.
       */
      await expect(
        checkRead(
          model.adminReadableModelType,
          { userId: new NotEqual<string>(adminUserId.toString()) },
          { [model.ownerOnlyColumnReachableThroughRelation]: true },
          makeAdminProps(),
        ),
      ).rejects.toThrow(NotAuthorizedException);
    },
  );

  it.each(METHOD_MODELS)(
    "refuses an API key with a project role reading owner-only columns on $name",
    async (model: MethodModelUnderTest): Promise<void> => {
      /*
       * An API key holds project permissions and no user identity. There is no
       * id to pin to, so there is no pinning, so there is no read. Fail closed.
       */
      await expect(
        checkRead(
          model.adminReadableModelType,
          {},
          { [model.ownerOnlyColumnReachableThroughRelation]: true },
          makeApiKeyAdminProps(),
        ),
      ).rejects.toThrow(NotAuthorizedException);
    },
  );

  it.each(METHOD_MODELS)(
    "still lets an admin read the unmarked label columns of another member's $name",
    async (model: MethodModelUnderTest): Promise<void> => {
      /*
       * This is the half of Phase 3 that has to keep working. An admin who
       * cannot see that a row exists, what kind of thing it is and whether it
       * is verified cannot audit anybody's on-call setup - the feature would be
       * gone. Only the credential is withheld.
       */
      await expect(
        checkRead(
          model.adminReadableModelType,
          { userId: otherUserId },
          /*
           * The label columns come from the fixture rather than a hardcoded
           * list, because they genuinely differ per model: UserWebhook has no
           * isVerified column at all - a webhook skips verification - so naming
           * it here would fail that model for a reason that has nothing to do
           * with this guard.
           */
          model.labelColumns.reduce(
            (
              selected: Record<string, boolean>,
              columnName: string,
            ): Record<string, boolean> => {
              selected[columnName] = true;

              return selected;
            },
            { _id: true } as Record<string, boolean>,
          ),
          makeAdminProps(),
        ),
      ).resolves.toBeDefined();
    },
  );

  it.each(METHOD_MODELS)(
    "lets root read owner-only columns on $name with no ownership filter",
    async (model: MethodModelUnderTest): Promise<void> => {
      /*
       * Delivery reads these exact columns as root in order to actually send
       * the notification. A phone number the pager cannot read is a phone that
       * never rings, so root has to short-circuit before any of this.
       */
      for (const columnName of model.ownerOnlyColumns) {
        await expect(
          checkRead(
            model.modelType,
            {},
            { [columnName]: true },
            makeRootProps(),
          ),
        ).resolves.toBeDefined();
      }
    },
  );
});

describe("route 2 - a marked column reached through a relation", () => {
  it.each(METHOD_MODELS)(
    "lets the owner read $name's identifier through the rule relation",
    async (model: MethodModelUnderTest): Promise<void> => {
      /*
       * "Email: jane@example.com" on a user's own rule table. This is the
       * legitimate use of canReadOnRelationQuery, and it must survive.
       */
      const result: CheckReadPermissionType<BaseModel> = await checkRead(
        AdminReadableRuleModel,
        {},
        {
          [model.relationColumnName]: {
            [model.ownerOnlyColumnReachableThroughRelation]: true,
          },
        },
        makeOwnerProps(),
      );

      expect(
        (result.relationSelect as Record<string, unknown>)[
          model.relationColumnName
        ],
      ).toBe(true);
    },
  );

  it.each(METHOD_MODELS)(
    "refuses an admin reading $name's identifier through another member's rule",
    async (model: MethodModelUnderTest): Promise<void> => {
      /*
       * THE BLOCKER, EXACTLY. Nothing about the method table was widened here -
       * only the rule table was - and the credential still walks out through
       * the join, because checkRelationQueryPermission used to `continue` past
       * every permission check the moment canReadOnRelationQuery was set. The
       * outer query is the only thing that knows these related rows are not the
       * caller's, which is why it has to be threaded into the traversal.
       */
      await expect(
        checkRead(
          AdminReadableRuleModel,
          { userId: otherUserId },
          {
            [model.relationColumnName]: {
              [model.ownerOnlyColumnReachableThroughRelation]: true,
            },
          },
          makeAdminProps(),
        ),
      ).rejects.toThrow(NotAuthorizedException);
    },
  );

  it.each(METHOD_MODELS)(
    "refuses an admin sweeping every rule in the project for $name identifiers",
    async (model: MethodModelUnderTest): Promise<void> => {
      await expect(
        checkRead(
          AdminReadableRuleModel,
          {},
          {
            [model.relationColumnName]: {
              [model.ownerOnlyColumnReachableThroughRelation]: true,
            },
          },
          makeAdminProps(),
        ),
      ).rejects.toThrow(NotAuthorizedException);
    },
  );

  it.each(METHOD_MODELS)(
    "lets an admin read $name's identifier through their OWN rule",
    async (model: MethodModelUnderTest): Promise<void> => {
      await expect(
        checkRead(
          AdminReadableRuleModel,
          { userId: adminUserId },
          {
            [model.relationColumnName]: {
              [model.ownerOnlyColumnReachableThroughRelation]: true,
            },
          },
          makeAdminProps(),
        ),
      ).resolves.toBeDefined();
    },
  );

  it.each(METHOD_MODELS)(
    "refuses a relation read of $name when the ownership filter is a query operator",
    async (model: MethodModelUnderTest): Promise<void> => {
      await expect(
        checkRead(
          AdminReadableRuleModel,
          { userId: new NotEqual<string>(adminUserId.toString()) },
          {
            [model.relationColumnName]: {
              [model.ownerOnlyColumnReachableThroughRelation]: true,
            },
          },
          makeAdminProps(),
        ),
      ).rejects.toThrow(NotAuthorizedException);
    },
  );

  it.each(METHOD_MODELS)(
    "refuses an API key with a project role reading $name through a rule",
    async (model: MethodModelUnderTest): Promise<void> => {
      await expect(
        checkRead(
          AdminReadableRuleModel,
          {},
          {
            [model.relationColumnName]: {
              [model.ownerOnlyColumnReachableThroughRelation]: true,
            },
          },
          makeApiKeyAdminProps(),
        ),
      ).rejects.toThrow(NotAuthorizedException);
    },
  );

  it.each(METHOD_MODELS)(
    "still lets an admin label another member's rule with $name's unmarked column",
    async (model: MethodModelUnderTest): Promise<void> => {
      /*
       * The admin rule table still renders "Webhook: My Slack" and "Push:
       * Jane's iPhone". Naming the method is not the same as being handed it.
       */
      await expect(
        checkRead(
          AdminReadableRuleModel,
          { userId: otherUserId },
          {
            _id: true,
            [model.relationColumnName]: {
              [model.labelColumnReachableThroughRelation]: true,
            },
          },
          makeAdminProps(),
        ),
      ).resolves.toBeDefined();
    },
  );

  it.each(METHOD_MODELS)(
    "refuses the whole select when a marked $name column rides along with unmarked ones",
    async (model: MethodModelUnderTest): Promise<void> => {
      /*
       * A refusal that only fires for a select containing nothing BUT the
       * credential is a refusal an attacker routes around by asking for one
       * extra column.
       */
      await expect(
        checkRead(
          AdminReadableRuleModel,
          { userId: otherUserId },
          {
            _id: true,
            [model.relationColumnName]: {
              [model.labelColumnReachableThroughRelation]: true,
              [model.ownerOnlyColumnReachableThroughRelation]: true,
            },
          },
          makeAdminProps(),
        ),
      ).rejects.toThrow(NotAuthorizedException);
    },
  );

  it("lets root read every method identifier through any rule", async () => {
    for (const model of METHOD_MODELS) {
      await expect(
        checkRead(
          AdminReadableRuleModel,
          {},
          {
            [model.relationColumnName]: {
              [model.ownerOnlyColumnReachableThroughRelation]: true,
            },
          },
          makeRootProps(),
        ),
      ).resolves.toBeDefined();
    }
  });
});

describe("route 3 - a marked column injected into the select as a sort key", () => {
  /*
   * DatabaseService adds sorted columns to the select AFTER ModelPermission has
   * finished, validating them only with hasColumn/isEntityColumn. That is the
   * gap: the permission layer never sees the column at all. The private method
   * is called directly here because the public path (_findBy) needs a live
   * database connection, and the injection is the whole of the behaviour under
   * test - this is the production method, not a restatement of it.
   */
  type SortInjector = {
    addSortColumnsToSelect: (findBy: FindBy<BaseModel>) => Array<string>;
  };

  function injectSortColumns(
    modelType: ModelTypeUnderTest,
    findBy: FindBy<BaseModel>,
  ): Array<string> {
    const service: DatabaseService<BaseModel> = new DatabaseService<BaseModel>(
      modelType,
    );

    return (service as unknown as SortInjector).addSortColumnsToSelect(findBy);
  }

  it.each(METHOD_MODELS)(
    "does not smuggle an owner-only $name column into the select via sort",
    (model: MethodModelUnderTest): void => {
      for (const columnName of model.ownerOnlyColumns) {
        const findBy: FindBy<BaseModel> = {
          query: {},
          select: { _id: true } as Select<BaseModel>,
          sort: { [columnName]: SortOrder.Ascending } as Record<
            string,
            SortOrder
          >,
          limit: 10,
          skip: 0,
          props: makeOwnerProps(),
        };

        expect(injectSortColumns(model.modelType, findBy)).toEqual([]);
        expect(
          (findBy.select as Record<string, unknown>)[columnName],
        ).toBeUndefined();
      }
    },
  );

  it.each(METHOD_MODELS)(
    "still adds an unmarked sorted column on $name to the select",
    (model: MethodModelUnderTest): void => {
      /*
       * The mechanism this method exists for has to keep working, or the fix
       * would just be "delete the feature". Sorting on an ordinary column while
       * a relation is selected still needs the column in the select or TypeORM
       * fails the query outright.
       */
      const findBy: FindBy<BaseModel> = {
        query: {},
        select: { _id: true } as Select<BaseModel>,
        // Per-model: UserWebhook has no isVerified column to sort on.
        sort: { [model.unmarkedSortColumn]: SortOrder.Ascending } as Record<
          string,
          SortOrder
        >,
        limit: 10,
        skip: 0,
        props: makeOwnerProps(),
      };

      expect(injectSortColumns(model.modelType, findBy)).toEqual([
        model.unmarkedSortColumn,
      ]);
      expect(
        (findBy.select as Record<string, unknown>)[model.unmarkedSortColumn],
      ).toBe(true);
    },
  );

  it("leaves a marked column alone when the caller already selected it legitimately", () => {
    /*
     * An owner who passed route 1 has the column in their select already, so
     * the injector never reaches it - the exclusion costs a legitimate reader
     * nothing at all.
     */
    const findBy: FindBy<BaseModel> = {
      query: {},
      select: { _id: true, webhookUrl: true } as Select<BaseModel>,
      sort: { webhookUrl: SortOrder.Ascending } as Record<string, SortOrder>,
      limit: 10,
      skip: 0,
      props: makeOwnerProps(),
    };

    expect(injectSortColumns(UserWebhook, findBy)).toEqual([]);
    expect((findBy.select as Record<string, unknown>)["webhookUrl"]).toBe(true);
  });

  it("still injects marked sort columns for root", () => {
    const findBy: FindBy<BaseModel> = {
      query: {},
      select: { _id: true } as Select<BaseModel>,
      sort: { webhookUrl: SortOrder.Ascending } as Record<string, SortOrder>,
      limit: 10,
      skip: 0,
      props: makeRootProps(),
    };

    expect(injectSortColumns(UserWebhook, findBy)).toEqual(["webhookUrl"]);
    expect((findBy.select as Record<string, unknown>)["webhookUrl"]).toBe(true);
  });
});

describe("route 4 - a marked column used as a query predicate", () => {
  it.each(METHOD_MODELS)(
    "lets the owner filter their own $name rows on an owner-only column",
    async (model: MethodModelUnderTest): Promise<void> => {
      await expect(
        checkRead(
          model.modelType,
          { [model.ownerOnlyColumnReachableThroughRelation]: "probe-value" },
          { _id: true },
          makeOwnerProps(),
        ),
      ).resolves.toBeDefined();
    },
  );

  it.each(METHOD_MODELS)(
    "refuses an admin probing $name for a value across the project",
    async (model: MethodModelUnderTest): Promise<void> => {
      /*
       * Nothing is selected here. Equality on a secret is a confirm/deny
       * oracle, and a few thousand of these read the value out without a single
       * row ever being returned - so a WHERE is held to the same standard as a
       * SELECT.
       */
      await expect(
        checkRead(
          model.adminReadableModelType,
          { [model.ownerOnlyColumnReachableThroughRelation]: "probe-value" },
          { _id: true },
          makeAdminProps(),
        ),
      ).rejects.toThrow(NotAuthorizedException);
    },
  );

  it.each(METHOD_MODELS)(
    "refuses an admin probing another member's $name rows",
    async (model: MethodModelUnderTest): Promise<void> => {
      await expect(
        checkRead(
          model.adminReadableModelType,
          {
            userId: otherUserId,
            [model.ownerOnlyColumnReachableThroughRelation]: "probe-value",
          },
          { _id: true },
          makeAdminProps(),
        ),
      ).rejects.toThrow(NotAuthorizedException);
    },
  );

  it.each(METHOD_MODELS)(
    "lets an admin filter their OWN $name rows on an owner-only column",
    async (model: MethodModelUnderTest): Promise<void> => {
      await expect(
        checkRead(
          model.adminReadableModelType,
          {
            userId: adminUserId,
            [model.ownerOnlyColumnReachableThroughRelation]: "probe-value",
          },
          { _id: true },
          makeAdminProps(),
        ),
      ).resolves.toBeDefined();
    },
  );

  it.each(METHOD_MODELS)(
    "refuses an admin probing $name through a relation filter on a rule",
    async (model: MethodModelUnderTest): Promise<void> => {
      /*
       * The predicate route has the same nested variant as the select route:
       * `{ userWebhook: { webhookUrl: x } }` probes the identical value one
       * level out.
       */
      await expect(
        checkRead(
          AdminReadableRuleModel,
          {
            userId: otherUserId,
            [model.relationColumnName]: {
              [model.ownerOnlyColumnReachableThroughRelation]: "probe-value",
            },
          },
          { _id: true },
          makeAdminProps(),
        ),
      ).rejects.toThrow(NotAuthorizedException);
    },
  );

  it.each(METHOD_MODELS)(
    "lets the owner filter their own rules through a $name relation predicate",
    async (model: MethodModelUnderTest): Promise<void> => {
      await expect(
        checkRead(
          AdminReadableRuleModel,
          {
            [model.relationColumnName]: {
              [model.ownerOnlyColumnReachableThroughRelation]: "probe-value",
            },
          },
          { _id: true },
          makeOwnerProps(),
        ),
      ).resolves.toBeDefined();
    },
  );

  it.each(METHOD_MODELS)(
    "lets root probe $name on an owner-only column",
    async (model: MethodModelUnderTest): Promise<void> => {
      await expect(
        checkRead(
          model.modelType,
          { [model.ownerOnlyColumnReachableThroughRelation]: "probe-value" },
          { _id: true },
          makeRootProps(),
        ),
      ).resolves.toBeDefined();
    },
  );
});

describe("the verification codes nobody may read, owner included", () => {
  /*
   * These four columns are the one place where @OwnerOnlyColumn is NOT the thing
   * doing the work, and that is worth pinning explicitly.
   *
   * A live verification code is not a privacy question, it is an account-takeover
   * one: reading somebody's code is claiming their notification channel, and
   * claiming their channel is claiming their pages. So the column list refuses
   * EVERYONE - `read: []` - rather than refusing everyone-except-the-owner. The
   * owner has no need to read it back either; they received it out of band, and
   * they submit it rather than fetch it.
   *
   * The @OwnerOnlyColumn marker sits on top as belt and braces. If somebody later
   * widens that read list - to build an admin "resend code" screen, say - the
   * marker is what stops the widening from silently becoming cross-user, and
   * these assertions are what tell them the empty list was deliberate rather than
   * an oversight.
   */
  it.each(WRITE_ONLY_VERIFICATION_CODE_MODELS)(
    "refuses even the OWNER selecting verificationCode on %p",
    async (modelType: ModelTypeUnderTest): Promise<void> => {
      await expect(
        checkRead(
          modelType,
          { userId: ownerUserId },
          { verificationCode: true },
          makeOwnerProps(),
        ),
      ).rejects.toThrow();
    },
  );

  it.each(WRITE_ONLY_VERIFICATION_CODE_MODELS)(
    "refuses an administrator selecting verificationCode on another member's %p",
    async (modelType: ModelTypeUnderTest): Promise<void> => {
      await expect(
        checkRead(
          modelType,
          { userId: ownerUserId },
          { verificationCode: true },
          makeAdminProps(),
        ),
      ).rejects.toThrow();
    },
  );

  it.each(WRITE_ONLY_VERIFICATION_CODE_MODELS)(
    "still lets the verification flow itself read it as root on %p",
    async (modelType: ModelTypeUnderTest): Promise<void> => {
      /*
       * The code has to be readable by SOMETHING or verification cannot work.
       * That something is the server verifying a submitted code, which runs as
       * root and short-circuits every check above. If this ever starts failing,
       * nobody can verify a notification method again.
       */
      await expect(
        checkRead(
          modelType,
          { userId: ownerUserId },
          { verificationCode: true },
          makeRootProps(),
        ),
      ).resolves.toBeDefined();
    },
  );
});

describe("the production models are still owner-scoped without any of this", () => {
  it.each(METHOD_MODELS)(
    "refuses a plain member naming another user on $name outright",
    async (model: MethodModelUnderTest): Promise<void> => {
      /*
       * The owner-only guard is the second lock, not the first. On the
       * production models the table read is still [CurrentUser], so
       * TenantPermission rejects a member who names somebody else before the
       * select is ever considered. Phase 3 removes that first lock for admins
       * on purpose; this test is here so that a future change which removes it
       * for everyone is not mistaken for a passing suite.
       */
      await expect(
        checkRead(
          model.modelType,
          { userId: otherUserId },
          { _id: true },
          makeOwnerProps(),
        ),
      ).rejects.toThrow(NotAuthorizedException);
    },
  );

  it.each(METHOD_MODELS)(
    "refuses a plain member naming another user on the admin-readable $name too",
    async (model: MethodModelUnderTest): Promise<void> => {
      /*
       * Widening the table read to ProjectAdmin does not widen it to everybody:
       * a member holding no role still intersects on CurrentUser alone and is
       * still force-scoped to their own rows.
       */
      await expect(
        checkRead(
          model.adminReadableModelType,
          { userId: otherUserId },
          { _id: true },
          makeOwnerProps(),
        ),
      ).rejects.toThrow(NotAuthorizedException);
    },
  );
});
