import crypto from "crypto";
import { EncryptionSecret } from "../EnvironmentConfig";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import Query from "../Types/Database/Query";
import UpdateBy from "../Types/Database/UpdateBy";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import { StatementContext } from "../Utils/Database/StatementOutcome";
import logger from "../Utils/Logger";
import NewPasswordRule from "../Utils/NewPasswordRule";
import PublicMessageRateLimit, {
  PublicMessageSendPermit,
  TeamMessageKind,
} from "../Utils/RateLimit/PublicMessageRateLimit";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ProjectReferencesService from "./ProjectReferencesService";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OneUptimeDate from "../../Types/Date";
import Email from "../../Types/Email";
import BadDataException from "../../Types/Exception/BadDataException";
import Exception from "../../Types/Exception/Exception";
import HashedString from "../../Types/HashedString";
import ObjectID from "../../Types/ObjectID";
import { PRIVATE_USER_SESSION_PASSWORD_CHANGED_REASON } from "./PrivateUserSessionServiceBase";

/*
 * ---------------------------------------------------------------------------
 * THE PRIVATE USERS OF A PUBLIC RESOURCE.
 *
 * A dashboard (#10250) - and a form after it (#10249) - that asks the
 * visitors of its public link to sign in lets in only its private users:
 * people its team invites, by email, and the people its single sign-on
 * lets in. A status page's private users have worked this way for years
 * (StatusPagePrivateUserService); this is the same lifecycle, handed what
 * differs between the kinds (PrivateUserKind):
 *
 *   - the one password rule for every password a private user is given
 *     (Utils/NewPasswordRule), and one private user per address and
 *     resource;
 *   - an invitation emailed to every private user the team adds - on the
 *     Dashboard, with an API key or by a workflow - from this installation's
 *     mail server, whose link sets their first password, unless they come
 *     from single sign-on or the resource takes only single sign-on. Each
 *     address is sent a bounded number an hour (PublicMessageRateLimit,
 *     counted with project invitations);
 *   - a link sent is a bearer credential found by its token's hash and the
 *     resource alone, so a new password and a new address end it; a new
 *     password also ends every session of the user, and so does removing
 *     them.
 *
 * Whether a private user has a password is kept in hasPassword, written
 * here whenever the password is: the password's hash is never readable
 * through the API.
 * ---------------------------------------------------------------------------
 */

// What the invitation email is written from.
export interface PrivateUserResource {
  projectId: ObjectID;
  // The name a visitor knows it by: its page title, else its name.
  name: string;
  requireSsoForLogin: boolean;
  // Its public link: a custom domain's address first.
  url: string;
}

export interface PrivateUserKind {
  // What the resource is called in log lines: "dashboard".
  name: string;
  // The resource's two names in a write, its id column first: ["dashboardId", "dashboard"].
  resourceKeys: Array<string>;
  // How a refusal names it: "Dashboard".
  resourceLabel: string;
  alreadyInvitedMessage: string;
  getResource: (resourceId: ObjectID) => Promise<PrivateUserResource | null>;
  // Where the invitation's link and a reset link take the private user.
  getResetPasswordUrl: (data: { resourceUrl: string; token: string }) => string;
  sendInvitation: (data: {
    resource: PrivateUserResource;
    toEmail: Email;
    tokenVerifyUrl: string;
  }) => Promise<void>;
  revokeAllSessions: (
    privateUserId: ObjectID,
    options: { reason: string },
  ) => Promise<void>;
}

/*
 * What a private user's create carries from its hooks to the next: the
 * count of the invitation it emails (onCreatePermitted), given back when the
 * create ends before the email is sent (onCreateError).
 */
interface PrivateUserCreateCarryForward {
  invitationPermit: PublicMessageSendPermit | null;
  // Set as onCreateSuccess starts: from then on the email may have gone out.
  isSending: boolean;
}

// How long an invitation's link, and a reset link, works.
export const PRIVATE_USER_RESET_LINK_LIFETIME_IN_DAYS: number = 1;

export default abstract class PrivateUserServiceBase<
  TModel extends BaseModel,
> extends ProjectReferencesService<TModel> {
  protected readonly kind: PrivateUserKind;

  public constructor(modelType: { new (): TModel }, kind: PrivateUserKind) {
    super(modelType);
    this.kind = kind;
  }

  protected get resourceColumn(): string {
    return this.kind.resourceKeys[0]!;
  }

  private static record(model: unknown): Record<string, unknown> {
    return model as Record<string, unknown>;
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<TModel>,
  ): Promise<OnCreate<TModel>> {
    await super.onBeforeCreate(createBy);

    const data: Record<string, unknown> = PrivateUserServiceBase.record(
      createBy.data,
    );

    // The one password rule, for a password a new private user starts with.
    NewPasswordRule.assertMet(data["password"] as HashedString | undefined);

    /*
     * The resource under either of its names, kept in the ID column for the
     * check below and for onCreateSuccess, which mails the invitation from
     * the resource the saved row names.
     */
    const resourceId: ObjectID | null = RelationIdUtil.readIntoIdColumn(
      data,
      this.kind.resourceKeys,
      this.kind.resourceLabel,
    );

    if (resourceId && data["email"]) {
      const existing: TModel | null = await this.findOneBy({
        query: {
          email: data["email"],
          [this.resourceColumn]: resourceId,
        } as unknown as Query<TModel>,
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
        } as never,
      });

      if (existing) {
        throw new BadDataException(this.kind.alreadyInvitedMessage);
      }
    }

    const carryForward: PrivateUserCreateCarryForward = {
      invitationPermit: null,
      isSending: false,
    };

    return {
      createBy: createBy,
      carryForward: carryForward,
    };
  }

  /*
   * After every permission check: whether the new private user has a
   * password (hasPassword, which no caller writes), and the count of the
   * invitation the create emails - refused with 429, before anything is
   * written, once the address has been sent enough this hour. Only an
   * invitation that is sent counts: a user single sign-on adds, or one of a
   * resource that takes only single sign-on, is sent none.
   */
  @CaptureSpan()
  protected override async onCreatePermitted(
    onCreate: OnCreate<TModel>,
  ): Promise<void> {
    await super.onCreatePermitted(onCreate);

    const data: Record<string, unknown> = PrivateUserServiceBase.record(
      onCreate.createBy.data,
    );

    data["hasPassword"] = Boolean(data["password"]);

    const carryForward: PrivateUserCreateCarryForward | null =
      onCreate.carryForward as PrivateUserCreateCarryForward | null;

    const resourceId: ObjectID | null = RelationIdUtil.readConsistent(
      data,
      this.kind.resourceKeys,
      this.kind.resourceLabel,
    );

    if (!carryForward || data["isSsoUser"] || !data["email"] || !resourceId) {
      return;
    }

    const resource: PrivateUserResource | null =
      await this.kind.getResource(resourceId);

    if (!resource || resource.requireSsoForLogin) {
      return;
    }

    carryForward.invitationPermit =
      await PublicMessageRateLimit.assertTeamMaySend({
        kind: TeamMessageKind.Invitation,
        contacts: [PublicMessageRateLimit.forEmail(data["email"] as Email)],
      });
  }

  // A create that failed before its invitation went out gives its count back.
  @CaptureSpan()
  protected override async onCreateError(
    error: Exception,
    onCreate?: OnCreate<TModel> | undefined,
    failedStatement?: StatementContext | undefined,
  ): Promise<Exception> {
    const carryForward: PrivateUserCreateCarryForward | null | undefined =
      onCreate?.carryForward as
        | PrivateUserCreateCarryForward
        | null
        | undefined;

    if (carryForward?.invitationPermit && !carryForward.isSending) {
      await carryForward.invitationPermit.giveBack();
    }

    return await super.onCreateError(error, onCreate, failedStatement);
  }

  /*
   * The invitation: a link that sets the private user's first password,
   * good for a day - the same link a password reset sends, so the column
   * holds what the reset route looks rows up by, the SHA-256 of the token,
   * never the token itself, which is only ever mailed.
   */
  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<TModel>,
    createdItem: TModel,
  ): Promise<TModel> {
    const carryForward: PrivateUserCreateCarryForward | null =
      onCreate.carryForward as PrivateUserCreateCarryForward | null;

    if (carryForward) {
      carryForward.isSending = true;
    }

    const created: Record<string, unknown> =
      PrivateUserServiceBase.record(createdItem);

    const resourceId: ObjectID | undefined = created[this.resourceColumn] as
      | ObjectID
      | undefined;

    if (created["isSsoUser"] || !created["email"] || !resourceId) {
      return createdItem;
    }

    const resource: PrivateUserResource | null = await this.kind.getResource(
      new ObjectID(resourceId.toString()),
    );

    // A resource that takes only single sign-on mints no password link.
    if (!resource || resource.requireSsoForLogin) {
      return createdItem;
    }

    const token: string = crypto.randomUUID();
    const hashedToken: string = await HashedString.hashValue(
      token,
      EncryptionSecret,
    );

    await this.updateOneById({
      id: createdItem.id!,
      data: {
        resetPasswordToken: hashedToken,
        resetPasswordExpires: OneUptimeDate.getSomeDaysAfter(
          PRIVATE_USER_RESET_LINK_LIFETIME_IN_DAYS,
        ),
      } as never,
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    this.kind
      .sendInvitation({
        resource: resource,
        toEmail: created["email"] as Email,
        tokenVerifyUrl: this.kind.getResetPasswordUrl({
          resourceUrl: resource.url,
          token: token,
        }),
      })
      .catch((err: Error) => {
        logger.error(err);
      });

    return createdItem;
  }

  /*
   * The one password rule for a new password, however it came: a reset
   * link's page or the API. And a link sent to an address that is about to
   * change ends with it: the link is a bearer credential addressed to one
   * mailbox, found by its token's hash and the resource alone. Cleared
   * before the write, and only for rows whose address actually changes.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<TModel>,
  ): Promise<OnUpdate<TModel>> {
    await super.onBeforeUpdate(updateBy);

    const data: Record<string, unknown> = PrivateUserServiceBase.record(
      updateBy.data,
    );

    NewPasswordRule.assertMet(data["password"] as HashedString | undefined);

    if (data["email"]) {
      const newEmail: string = String(data["email"]).toLowerCase();

      const existingUsers: Array<TModel> =
        await this.findRowsAndHoldUpdateToThem(updateBy, {
          _id: true,
          email: true,
        } as never);

      for (const user of existingUsers) {
        const currentEmail: string | undefined = (
          PrivateUserServiceBase.record(user)["email"] as Email | undefined
        )
          ?.toString()
          .toLowerCase();

        if (!user.id || currentEmail === newEmail) {
          continue;
        }

        await this.updateOneById({
          id: user.id,
          data: {
            resetPasswordToken: null,
            resetPasswordExpires: null,
          } as never,
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        });
      }
    }

    return {
      updateBy: updateBy,
      carryForward: null,
    };
  }

  /*
   * A new password, in its own UPDATE, after every permission check: the
   * reset link it may have come from stops working, and hasPassword says it
   * is set. Written here and never in onBeforeUpdate, as those columns are
   * OneUptime's own and would be held against the caller's permissions.
   */
  @CaptureSpan()
  protected override async onUpdatePermitted(
    updateBy: UpdateBy<TModel>,
  ): Promise<void> {
    await super.onUpdatePermitted(updateBy);

    const data: Record<string, unknown> = PrivateUserServiceBase.record(
      updateBy.data,
    );

    if (!data["password"]) {
      return;
    }

    data["resetPasswordToken"] = null;
    data["resetPasswordExpires"] = null;
    data["hasPassword"] = true;
  }

  /*
   * And it ends their sessions: somebody who sets a new password because
   * somebody else may have the old one has locked them out at their next
   * request, not when an access token runs out.
   */
  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<TModel>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<TModel>> {
    if (PrivateUserServiceBase.record(onUpdate.updateBy.data)["password"]) {
      for (const userId of updatedItemIds) {
        await this.kind.revokeAllSessions(userId, {
          reason: PRIVATE_USER_SESSION_PASSWORD_CHANGED_REASON,
        });
      }
    }

    return onUpdate;
  }

  /*
   * A private user removed signs out everywhere: every read of a session
   * already asks whether its private user is still there, and their
   * sessions are ended too, so a refresh of one renews nothing.
   */
  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<TModel>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<TModel>> {
    for (const userId of itemIdsBeforeDelete) {
      try {
        await this.kind.revokeAllSessions(userId, {
          reason: "Private user removed",
        });
      } catch (err) {
        logger.error(
          `Failed to end the sessions of a removed ${this.kind.name} private user`,
        );
        logger.error(err);
      }
    }

    return onDelete;
  }

  /*
   * Spends a reset link: the private user of this resource whose latest
   * link carries this token and has not run out, or null. The caller then
   * writes the new password through updateOneById, whose own hooks clear the
   * link in the same statement (onUpdatePermitted).
   */
  @CaptureSpan()
  public async findByResetPasswordToken(data: {
    resourceId: ObjectID;
    token: string;
  }): Promise<{ user: TModel | null; isExpired: boolean }> {
    if (!data.token) {
      return { user: null, isExpired: false };
    }

    const hashedToken: string = await HashedString.hashValue(
      data.token,
      EncryptionSecret,
    );

    const user: TModel | null = await this.findOneBy({
      query: {
        [this.resourceColumn]: data.resourceId,
        resetPasswordToken: hashedToken,
      } as unknown as Query<TModel>,
      select: {
        _id: true,
        email: true,
        resetPasswordExpires: true,
      } as never,
      props: {
        isRoot: true,
      },
    });

    if (!user) {
      return { user: null, isExpired: false };
    }

    const expires: unknown =
      PrivateUserServiceBase.record(user)["resetPasswordExpires"];

    return {
      user,
      isExpired: !(expires instanceof Date) || OneUptimeDate.hasExpired(expires),
    };
  }
}
