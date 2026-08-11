import DatabaseConfig from "../DatabaseConfig";
import {
  EncryptionSecret,
  IsBillingEnabled,
  NotificationSlackWebhookOnCreateUser,
} from "../EnvironmentConfig";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import Attribution from "../Utils/Attribution";
import logger, { LogAttributes } from "../Utils/Logger";
import DatabaseService from "./DatabaseService";
import EmailVerificationTokenService from "./EmailVerificationTokenService";
import MailService from "./MailService";
import TeamMemberService from "./TeamMemberService";
import UserNotificationRuleService from "./UserNotificationRuleService";
import UserNotificationSettingService from "./UserNotificationSettingService";
import UserSessionService from "./UserSessionService";
import { AccountsRoute } from "../../ServiceRoute";
import Hostname from "../../Types/API/Hostname";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import Protocol from "../../Types/API/Protocol";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import EmptyResponseData from "../../Types/API/EmptyResponse";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import PositiveNumber from "../../Types/PositiveNumber";
import ProjectService from "./ProjectService";
import Semaphore, { SemaphoreMutex } from "../Infrastructure/Semaphore";
import Email from "../../Types/Email";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import HashedString from "../../Types/HashedString";
import { JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Text from "../../Types/Text";
import EmailVerificationToken from "../../Models/DatabaseModels/EmailVerificationToken";
import TeamMember from "../../Models/DatabaseModels/TeamMember";
import Model from "../../Models/DatabaseModels/User";
import SlackUtil from "../Utils/Workspace/Slack/Slack";
import ProductAnalytics from "../Utils/ProductAnalytics";
import UserTotpAuth from "../../Models/DatabaseModels/UserTotpAuth";
import UserTotpAuthService from "./UserTotpAuthService";
import UserWebAuthn from "../../Models/DatabaseModels/UserWebAuthn";
import UserWebAuthnService from "./UserWebAuthnService";
import BadDataException from "../../Types/Exception/BadDataException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import { getPasswordValidationError } from "../../Types/Password";
import UserAuthenticationStatus from "../../Types/UserAuthenticationStatus";
import Name from "../../Types/Name";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import Timezone from "../../Types/Timezone";
import InMemoryTTLCache from "../Infrastructure/InMemoryTTLCache";

/*
 * Names the Redis mutex that serializes the first-Master-Admin election across
 * every process on this instance. Namespaced the same way as the other
 * cross-process mutexes in this codebase (see ProjectService's counter locks)
 * so the key is self-documenting in Redis and cannot collide with another lock.
 */
const FIRST_MASTER_ADMIN_ELECTION_LOCK_NAMESPACE: string =
  "UserService.firstMasterAdminElection";
const FIRST_MASTER_ADMIN_ELECTION_LOCK_KEY: string = "instance";

/*
 * How long the mutex survives without being refreshed. This is a crash bound,
 * NOT a work budget: redis-semaphore refreshes an held lock every
 * 0.8 * lockTimeout for as long as the holder is alive, so a slow COUNT+INSERT
 * does not expire the lock out from under itself. It only matters when a holder
 * dies mid-election (SIGKILL, eviction) — the lock then frees itself after this
 * long instead of wedging every subsequent signup on the instance forever.
 */
const FIRST_MASTER_ADMIN_ELECTION_LOCK_TIMEOUT_MS: number = 10_000;

/*
 * How long a signup waits for the lock before giving up. Signup is a
 * user-facing request, so the wait has to be bounded rather than indefinite —
 * this replaces the bound that Postgres `lock_timeout` used to give us.
 *
 * Failing the signup is the correct outcome when it fires: refusing to serve
 * one request is safe, serving it unserialized is exactly the bug this lock
 * exists to prevent (GHSA-3qqq-hprx-g2jw).
 */
const FIRST_MASTER_ADMIN_ELECTION_ACQUIRE_TIMEOUT_MS: number = 5_000;

export class Service extends DatabaseService<Model> {
  /*
   * Suppresses repeated `lastActive` UPDATEs from a single API node. 60s of
   * staleness on "last seen" is acceptable; an UPDATE per request is not.
   */
  private lastActiveCache: InMemoryTTLCache<true> = new InMemoryTTLCache(
    10_000,
  );

  public constructor() {
    super(Model);
  }

  /**
   * Debounced fire-and-forget update of `User.lastActive`. The auth
   * middleware calls this on every authenticated request; without the cache
   * we'd issue one Postgres UPDATE per request per user.
   */
  @CaptureSpan()
  public async updateLastActive(userId: ObjectID): Promise<void> {
    const key: string = userId.toString();
    if (this.lastActiveCache.has(key)) {
      return;
    }
    /*
     * Set BEFORE the await so a burst of concurrent requests collapses to one
     * UPDATE per node per 60s window.
     */
    this.lastActiveCache.set(key, true, 60_000);

    void this.updateOneById({
      id: userId,
      data: { lastActive: OneUptimeDate.getCurrentDate() },
      props: { isRoot: true },
    }).catch((err: Error) => {
      this.lastActiveCache.delete(key);
      logger.error(
        `Failed to update User.lastActive for ${key}: ${err.message}`,
      );
    });
  }

  @CaptureSpan()
  public async getUserMarkdownString(data: {
    userId: ObjectID;
    projectId: ObjectID;
  }): Promise<string> {
    const user: Model | null = await this.findOneBy({
      query: {
        _id: data.userId,
      },
      select: {
        name: true,
        email: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!user) {
      return "";
    }

    return `[${user.name?.toString() || user.email?.toString() || "User"}](${(await this.getUserLinkInDashboard(data.projectId, data.userId)).toString()})`;
  }

  @CaptureSpan()
  public async getUserLinkInDashboard(
    projectId: ObjectID,
    userId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/settings/users/${userId.toString()}`,
    );
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    /*
     * clickIds / firstTouchAttribution are publicly creatable jsonb columns
     * (set during signup). Unlike the varchar(500) utm columns they have no
     * DB-level size bound, so whitelist keys and cap value lengths here.
     */
    const sanitizedClickIds: JSONObject | undefined =
      Attribution.sanitizeClickIds(createBy.data.clickIds as JSONValue);

    if (sanitizedClickIds) {
      createBy.data.clickIds = sanitizedClickIds;
    } else {
      delete createBy.data.clickIds;
    }

    const sanitizedFirstTouchAttribution: JSONObject | undefined =
      Attribution.sanitizeFirstTouchAttribution(
        createBy.data.firstTouchAttribution as JSONValue,
      );

    if (sanitizedFirstTouchAttribution) {
      createBy.data.firstTouchAttribution = sanitizedFirstTouchAttribution;
    } else {
      delete createBy.data.firstTouchAttribution;
    }

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (NotificationSlackWebhookOnCreateUser) {
      SlackUtil.sendMessageToChannelViaIncomingWebhook({
        url: URL.fromString(NotificationSlackWebhookOnCreateUser),
        text: `*New OneUptime User:* 
  *Email:* ${createdItem.email?.toString() || "N/A"}
  *Name:* ${createdItem.name?.toString() || "N/A"}
  *Phone:* ${createdItem.companyPhoneNumber?.toString() || "N/A"}
  *Company:* ${createdItem.companyName?.toString() || "N/A"}`,
      }).catch((err: Error) => {
        // log this error but do not throw it. Not important enough to stop the process.
        logger.error(err, {
          userId: createdItem.id?.toString(),
        } as LogAttributes);
      });
    }

    /*
     * Server-side signup event (ad blockers eat the client-side one). Also
     * fires for users created via team invites — has_password separates
     * direct signups (true) from invited users (false).
     */
    if (createdItem.email) {
      ProductAnalytics.capture({
        event: "server/user_created",
        distinctId: createdItem.email.toString(),
        properties: {
          has_password: Boolean(createdItem.password),
          utm_source: createdItem.utmSource || "",
          utm_medium: createdItem.utmMedium || "",
          utm_campaign: createdItem.utmCampaign || "",
          utm_term: createdItem.utmTerm || "",
          utm_content: createdItem.utmContent || "",
          utm_url: createdItem.utmUrl || "",
          click_ids: createdItem.clickIds || {},
          first_touch: createdItem.firstTouchAttribution || {},
        },
      });
    }

    // A place holder method used for overriding.
    return Promise.resolve(createdItem);
  }

  @CaptureSpan()
  public async findByEmail(
    email: Email,
    props: DatabaseCommonInteractionProps,
  ): Promise<Model | null> {
    return await this.findOneBy({
      query: {
        email: email,
      },
      select: {
        _id: true,
      },
      props: props,
    });
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    let carryForward: Array<Model> = [];

    if (updateBy.data.password || updateBy.data.email) {
      const users: Array<Model> = await this.findBy({
        query: updateBy.query,
        select: {
          _id: true,
          email: true,
        },
        props: updateBy.props,
        limit: LIMIT_MAX,
        skip: 0,
      });

      carryForward = users;
    }

    if (updateBy.data.enableTwoFactorAuth) {
      // check if any two factor auth is verified.

      const users: Array<Model> = await this.findBy({
        query: updateBy.query,
        select: {
          _id: true,
          email: true,
        },
        props: updateBy.props,
        limit: LIMIT_MAX,
        skip: 0,
      });

      for (const user of users) {
        const totpAuth: UserTotpAuth | null =
          await UserTotpAuthService.findOneBy({
            query: {
              userId: user.id!,
              isVerified: true,
            },
            select: {
              _id: true,
            },
            props: {
              isRoot: true,
            },
          });

        const webAuthn: UserWebAuthn | null =
          await UserWebAuthnService.findOneBy({
            query: {
              userId: user.id!,
              isVerified: true,
            },
            select: {
              _id: true,
            },
            props: {
              isRoot: true,
            },
          });

        if (!totpAuth && !webAuthn) {
          throw new BadDataException(
            "Please verify two factor authentication method before you enable two factor authentication.",
          );
        }
      }
    }

    return { updateBy, carryForward: carryForward };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    // Check if the user is a member of any project
    const users: Array<Model> = await this.findBy({
      query: deleteBy.query,
      select: {
        _id: true,
      },
      props: deleteBy.props,
      limit: LIMIT_MAX,
      skip: 0,
    });

    for (const user of users) {
      const teamMembers: Array<TeamMember> = await TeamMemberService.findBy({
        query: {
          userId: user.id!,
        },
        select: {
          _id: true,
          projectId: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      if (teamMembers.length > 0) {
        throw new BadDataException(
          "You cannot delete your account because you are a member of one or more projects. Please leave all projects before deleting your account.",
        );
      }
    }

    return { deleteBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: ObjectID[],
  ): Promise<OnUpdate<Model>> {
    if (onUpdate && onUpdate.updateBy.data.password) {
      const host: Hostname = await DatabaseConfig.getHost();
      const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

      for (const user of onUpdate.carryForward) {
        // Revoke all active sessions for this user on password change
        await UserSessionService.revokeAllSessionsByUserId(user.id!, {
          reason: "Password changed",
        });

        // password changed, send password changed mail
        MailService.sendMail({
          toEmail: user.email!,
          subject: "Password Changed.",
          templateType: EmailTemplateType.PasswordChanged,
          vars: {
            homeURL: new URL(httpProtocol, host).toString(),
          },
        }).catch((err: Error) => {
          logger.error(err, { userId: user.id?.toString() } as LogAttributes);
        });
      }
    }

    if (onUpdate && onUpdate.updateBy.data.isEmailVerified) {
      // if the email is verified then create default policies for this user.

      const newUsers: Array<Model> = await this.findBy({
        query: onUpdate.updateBy.query,
        select: {
          _id: true,
          email: true,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
      });

      for (const user of newUsers) {
        // emai is verified. create default policies for this user.
        const teamMembers: Array<TeamMember> = await TeamMemberService.findBy({
          query: {
            userId: user.id!,
            hasAcceptedInvitation: true,
          },
          select: {
            projectId: true,
          },
          limit: LIMIT_MAX,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

        for (const member of teamMembers) {
          // create default policies for this user.
          await UserNotificationRuleService.addDefaultNotificationRuleForUser(
            member.projectId!,
            user.id!,
            user.email!,
          );

          await UserNotificationSettingService.addDefaultNotificationSettingsForUser(
            user.id!,
            member.projectId!,
          );
        }
      }
    }

    if (onUpdate && onUpdate.updateBy.data.email) {
      const newUsers: Array<Model> = await this.findBy({
        query: onUpdate.updateBy.query,
        select: {
          _id: true,
          email: true,
          name: true,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
      });

      for (const user of onUpdate.carryForward) {
        const newUser: Model | undefined = newUsers.find((u: Model) => {
          return u._id?.toString() === user._id.toString();
        });

        if (newUser && newUser.email?.toString() !== user.email.toString()) {
          // password changed, send password changed mail
          const generatedToken: ObjectID = ObjectID.generate();

          const emailVerificationToken: EmailVerificationToken =
            new EmailVerificationToken();
          emailVerificationToken.userId = user.id;
          emailVerificationToken.email = newUser.email!;
          emailVerificationToken.token = generatedToken;
          emailVerificationToken.expires = OneUptimeDate.getOneDayAfter();

          await EmailVerificationTokenService.create({
            data: emailVerificationToken,
            props: {
              isRoot: true,
            },
          });

          const host: Hostname = await DatabaseConfig.getHost();
          const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

          MailService.sendMail({
            toEmail: newUser.email!,
            subject: "You have changed your email. Please verify your email.",
            templateType: EmailTemplateType.EmailChanged,
            vars: {
              name: newUser.name!.toString(),
              tokenVerifyUrl: new URL(
                httpProtocol,
                host,
                new Route(AccountsRoute.toString()).addRoute(
                  "/verify-email/" + generatedToken.toString(),
                ),
              ).toString(),
              homeUrl: new URL(httpProtocol, host).toString(),
            },
          }).catch((err: Error) => {
            logger.error(err, { userId: user.id?.toString() } as LogAttributes);
          });

          await this.updateOneBy({
            query: {
              _id: user.id.toString(),
            },
            data: {
              isEmailVerified: false,
            },
            props: {
              isRoot: true,
              ignoreHooks: true,
            },
          });
        }
      }
    }

    return onUpdate;
  }

  /**
   * Creates a user who is signing themselves up, and decides — atomically —
   * whether they are the instance's very first Master Admin.
   *
   * Every signup MUST come through here rather than calling `create` directly,
   * because this method is the only place that is allowed to set
   * `isMasterAdmin` on a self-service signup. It always assigns the column, so
   * an `isMasterAdmin: true` smuggled into the request body is overwritten
   * rather than honoured (signup creates with `isRoot: true`, which bypasses
   * the column's empty `create: []` access control).
   */
  @CaptureSpan()
  public async createUserOnSignup(data: {
    user: Model;
    props: DatabaseCommonInteractionProps;
  }): Promise<Model> {
    // Never inherited from the caller. Decided below, or not at all.
    data.user.isMasterAdmin = false;

    if (IsBillingEnabled) {
      /*
       * On the hosted service there is no first-user bootstrap: master admins
       * are provisioned out of band, so there is nothing to elect and no reason
       * to take a lock.
       */
      return await this.create({
        data: data.user,
        props: data.props,
      });
    }

    /*
     * Self-hosted: the first user to sign up bootstraps the instance as Master
     * Admin. The eligibility check reads the User table and the create writes to
     * it, which is a read-then-write and therefore not atomic on its own — two
     * signups landing together both counted zero users and both became Master
     * Admin (GHSA-3qqq-hprx-g2jw). Serialize the check and the insert
     * instance-wide so the second request observes the first one's row.
     *
     * The mutex is the Redis one every other cross-process critical section in
     * this codebase uses (Semaphore), not a Postgres advisory lock. It holds no
     * database connection and no open transaction, so serializing signups
     * cannot pin a pooled backend `idle in transaction`, and it is unaffected
     * by how PgBouncer is pooling.
     */
    let mutex: SemaphoreMutex;

    try {
      mutex = await Semaphore.lock({
        key: FIRST_MASTER_ADMIN_ELECTION_LOCK_KEY,
        namespace: FIRST_MASTER_ADMIN_ELECTION_LOCK_NAMESPACE,
        lockTimeout: FIRST_MASTER_ADMIN_ELECTION_LOCK_TIMEOUT_MS,
        acquireTimeout: FIRST_MASTER_ADMIN_ELECTION_ACQUIRE_TIMEOUT_MS,
      });
    } catch (err) {
      /*
       * Redis unreachable, or the lock stayed contended past the acquire
       * timeout. Fail the signup rather than fall back to an unserialized
       * election — the fallback is the vulnerability.
       */
      logger.error(
        "Refusing to create a signup: could not acquire the first-Master-Admin election lock.",
      );
      logger.error(err);

      throw err;
    }

    /*
     * The critical section deliberately covers the INSERT, not just the count:
     * releasing after the count would let the next holder count a table the
     * winner had not written to yet, which is the same race with extra steps.
     *
     * `finally` so a failed create still frees the lock immediately instead of
     * blocking every other signup until lockTimeout elapses.
     */
    try {
      data.user.isMasterAdmin = await this.isInstanceAwaitingFirstUser();

      return await this.create({
        data: data.user,
        props: data.props,
      });
    } finally {
      try {
        await Semaphore.release(mutex);
      } catch (err) {
        /*
         * Best-effort and non-masking: an error here must not replace the
         * outcome of the signup, and an unreleased lock still expires on its
         * own after lockTimeout.
         */
        logger.error(
          "Failed to release the first-Master-Admin election lock; it will expire on its own.",
        );
        logger.error(err);
      }
    }
  }

  /**
   * Is this a brand-new instance that nobody has ever signed up to — i.e. may
   * the next user through the door take Master Admin?
   *
   * Only ever called while holding the first-Master-Admin election mutex.
   */
  private async isInstanceAwaitingFirstUser(): Promise<boolean> {
    const userCount: PositiveNumber = await this.countBy({
      props: {
        isRoot: true,
      },
      query: {},
    });

    if (!userCount.isZero()) {
      return false;
    }

    /*
     * Zero users, but projects exist: this is not a fresh install, it is an
     * instance whose User table was emptied out from under it — a bad restore, a
     * cleanup script, a cascade. Handing Master Admin to whoever signs up next
     * would be a free promotion for a stranger, so refuse and make the operator
     * grant it deliberately.
     *
     * This cannot fire on any supported path: a user who belongs to a project
     * cannot be deleted (see onBeforeDelete), so "projects with no users at all"
     * is only reachable by writing to the database directly. It does not get in
     * the way of the ordinary recovery either — someone who signs up, has no
     * projects yet, deletes their account and signs up again still bootstraps
     * normally.
     */
    const projectCount: PositiveNumber = await ProjectService.countBy({
      props: {
        isRoot: true,
      },
      query: {},
    });

    if (!projectCount.isZero()) {
      logger.warn(
        "Refusing to grant Master Admin to a new signup: the User table is empty but this instance already has projects. Grant Master Admin explicitly instead.",
      );

      return false;
    }

    return true;
  }

  @CaptureSpan()
  public async createByEmail(data: {
    email: Email;
    name: Name | undefined;
    isEmailVerified?: boolean;
    generateRandomPassword?: boolean;
    createdByUserId?: ObjectID | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<Model> {
    const { email, props } = data;

    const user: Model = new Model();
    user.email = email;
    if (data.name) {
      user.name = data.name;
    }
    user.isEmailVerified = data.isEmailVerified || false;

    /*
     * Record who created this user, when they were created on behalf of
     * another user (for example, when invited to a project by a team member).
     * This lets the admin dashboard show who invited a given user.
     */
    if (data.createdByUserId) {
      user.createdByUserId = data.createdByUserId;
    }

    if (data.generateRandomPassword) {
      user.password = new HashedString(Text.generateRandomText(20));
    }

    if (!IsBillingEnabled) {
      // if billing is not enabled, then email is verified by default.
      user.isEmailVerified = true;
    }

    return await this.create({
      data: user,
      props: props,
    });
  }

  /**
   * How this user authenticates today, for an operator looking at their
   * account. Runs as root because the caller is a master admin acting outside
   * of any project, and is authorized by the route's middleware rather than by
   * tenant permissions.
   *
   * Throws NotFoundException rather than returning null so that every caller
   * reports "no such user" the same way instead of each inventing its own.
   */
  @CaptureSpan()
  public async getAuthenticationStatus(
    userId: ObjectID,
  ): Promise<UserAuthenticationStatus> {
    const user: Model | null = await this.findOneBy({
      query: {
        _id: userId,
      },
      select: {
        _id: true,
        password: true,
        isEmailVerified: true,
        enableTwoFactorAuth: true,
        resetPasswordToken: true,
        resetPasswordExpires: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!user) {
      throw new NotFoundException("User not found.");
    }

    /*
     * An expired token is not a pending link: the row keeps the token until
     * something overwrites it, so "the column is set" on its own would report
     * a link that /reset-password would refuse.
     */
    const hasPendingPasswordResetLink: boolean = Boolean(
      user.resetPasswordToken &&
        user.resetPasswordExpires &&
        !OneUptimeDate.hasExpired(user.resetPasswordExpires),
    );

    return {
      hasPassword: Boolean(user.password),
      isEmailVerified: Boolean(user.isEmailVerified),
      isTwoFactorAuthEnabled: Boolean(user.enableTwoFactorAuth),
      hasPendingPasswordResetLink: hasPendingPasswordResetLink,
    };
  }

  /**
   * Set one user's password on their behalf. Used by the master-admin route
   * behind Admin Dashboard > User > Authentication.
   *
   * Three things make this safe to expose:
   *
   *  - the plaintext is handed to the write path as an UNHASHED HashedString,
   *    which is what makes `sanitizeCreateOrUpdate` mint a fresh per-user salt
   *    and run scrypt over it. Pre-hashing here, or passing a bare string,
   *    would be rejected by that same code (see DatabaseService's salted-column
   *    guard) precisely because it would strand the row's salt;
   *  - any outstanding reset link is invalidated in the SAME statement. A link
   *    mailed before the admin intervened must not still be able to change the
   *    password afterwards;
   *  - session revocation and the "Password Changed." email are NOT done here.
   *    `onUpdateSuccess` already does both for any update that carries a
   *    password, and doing it again would send the user two identical emails.
   */
  @CaptureSpan()
  public async setPassword(data: {
    userId: ObjectID;
    password: string;
  }): Promise<void> {
    const validationError: string | null = getPasswordValidationError(
      data.password,
    );

    if (validationError) {
      throw new BadDataException(validationError);
    }

    const user: Model | null = await this.findOneBy({
      query: {
        _id: data.userId,
      },
      select: {
        _id: true,
        email: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!user) {
      throw new NotFoundException("User not found.");
    }

    await this.updateOneById({
      id: user.id!,
      data: {
        password: new HashedString(data.password),
        resetPasswordToken: null!,
        resetPasswordExpires: null!,
      },
      props: {
        isRoot: true,
      },
    });

    logger.info(
      `Password set by a master admin for user: ${user.id!.toString()}`,
    );
  }

  /**
   * Mint a fresh password-reset link for a user and email it to them.
   *
   * Produces exactly the link the public /forgot-password endpoint produces --
   * same token minting, same hashed-at-rest storage, same 24 hour expiry, same
   * /accounts/reset-password/<token> shape -- so the link an operator sends
   * from the Admin Dashboard is redeemed by the ordinary reset-password page
   * with no second code path behind it. Identity's /forgot-password keeps its
   * own copy of this because it differs around the edges (it finds the user by
   * a typed email, refuses accounts with no password, and answers success
   * without waiting for the mail); if either changes the token scheme, both
   * must move together.
   *
   * Only the SHA-256 of the token is stored. The token itself exists just long
   * enough to be put in the email, so a leaked database row cannot be replayed
   * as a reset link. It is hashed unsalted on purpose: /reset-password looks
   * the row up BY that hash, which a per-row salt would make impossible, and a
   * generated ObjectID has enough entropy that there is nothing to guess.
   */
  @CaptureSpan()
  public async sendPasswordResetLink(data: {
    userId: ObjectID;
  }): Promise<Email> {
    const user: Model | null = await this.findOneBy({
      query: {
        _id: data.userId,
      },
      select: {
        _id: true,
        email: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!user) {
      throw new NotFoundException("User not found.");
    }

    /*
     * `email` is a NOT NULL column, so this is unreachable through the
     * database -- it is here because the alternative is a non-null assertion
     * on the address we are about to mail a password-reset link to, and being
     * wrong about that would send the link somewhere unintended.
     */
    if (!user.email) {
      throw new BadDataException(
        "This user has no email address, so a password reset link cannot be sent to them.",
      );
    }

    const token: string = ObjectID.generate().toString();

    const hashedToken: string = await HashedString.hashValue(
      token,
      EncryptionSecret,
    );

    await this.updateOneById({
      id: data.userId,
      data: {
        resetPasswordToken: hashedToken,
        resetPasswordExpires: OneUptimeDate.getOneDayAfter(),
      },
      props: {
        isRoot: true,
      },
    });

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    const tokenVerifyUrl: string = new URL(
      httpProtocol,
      host,
      new Route(AccountsRoute.toString()).addRoute("/reset-password/" + token),
    ).toString();

    /*
     * Awaited, unlike most MailService calls in this file. The caller is a
     * human who just pressed "send password reset link" and needs to be told
     * if the instance cannot send mail -- reporting success and dropping the
     * email would leave them waiting for a link that is never coming.
     */
    try {
      const mailResponse: HTTPResponse<EmptyResponseData> =
        await MailService.sendMail({
          toEmail: user.email,
          subject: "Password Reset Request for OneUptime",
          templateType: EmailTemplateType.ForgotPassword,
          vars: {
            homeURL: new URL(httpProtocol, host).toString(),
            tokenVerifyUrl: tokenVerifyUrl,
          },
        });

      /*
       * Awaiting is not enough on its own. MailService.sendMail is an HTTP
       * call to the notification service, and the API client only REJECTS
       * when no response came back at all (connection refused, timeout). A
       * response that says no -- 400 "Global SMTP Config not found" on an
       * instance with no mail set up, an auth failure, a rejected recipient --
       * arrives as a RESOLVED HTTPErrorResponse, which type-checks as an
       * HTTPResponse and would sail straight past a bare try/catch.
       *
       * That is the common failure, not the exotic one, so it has to be
       * turned back into a throw for the rollback below to mean anything.
       */
      if (mailResponse instanceof HTTPErrorResponse) {
        throw new BadDataException(
          `Could not send the password reset email: ${mailResponse.message}`,
        );
      }
    } catch (err) {
      /*
       * The token was written before the send, so a failed send would
       * otherwise leave a live 24 hour link on the row that nobody ever
       * received -- and the Authentication page would then report "reset link
       * pending" directly underneath the error saying it could not be sent.
       * Take it back off so the record matches what the operator was told.
       *
       * Best-effort, and it never masks the mail failure: that is the error
       * worth reporting, and an orphaned token expires on its own anyway.
       */
      await this.updateOneById({
        id: data.userId,
        data: {
          resetPasswordToken: null!,
          resetPasswordExpires: null!,
        },
        props: {
          isRoot: true,
        },
      }).catch((clearError: Error) => {
        logger.error(
          `Failed to clear the unsent password reset token for user ${data.userId.toString()}; it will expire on its own.`,
        );
        logger.error(clearError);
      });

      throw err;
    }

    logger.info(
      `Password reset link sent by a master admin to user: ${data.userId.toString()}`,
    );

    // Returned so the caller can tell the operator where the link went.
    return user.email;
  }

  public async getTimezoneForUser(userId: ObjectID): Promise<Timezone | null> {
    const user: Model | null = await this.findOneBy({
      query: {
        _id: userId,
      },
      select: {
        timezone: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!user) {
      return null;
    }

    return user.timezone || null;
  }
}

export default new Service();
