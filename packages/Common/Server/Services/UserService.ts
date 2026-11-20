import crypto from "crypto";
import DatabaseConfig from "../DatabaseConfig";
import {
  EncryptionSecret,
  IsBillingEnabled,
  NotificationSlackWebhookOnCreateUser,
} from "../EnvironmentConfig";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import Select from "../Types/Database/Select";
import DeleteBy from "../Types/Database/DeleteBy";
import OwnerOnlyColumnPermission from "../Types/Database/Permissions/OwnerOnlyColumnPermission";
import Attribution, { SignUpAttribution } from "../Utils/Attribution";
import logger, { LogAttributes } from "../Utils/Logger";
import DatabaseService from "./DatabaseService";
import EmailVerificationTokenService from "./EmailVerificationTokenService";
import MailService from "./MailService";
import ProductBrandingText from "../Utils/ProductBrandingText";
import RequestOriginUtil, {
  RequestOriginEmailVars,
} from "../Utils/RequestOrigin/RequestOriginUtil";
import TeamMemberService from "./TeamMemberService";
import UserNotificationRuleService from "./UserNotificationRuleService";
import UserNotificationSettingService from "./UserNotificationSettingService";
import UserSessionService from "./UserSessionService";
import { SessionEndCause } from "../../Types/UserSession/SessionEndCause";
import RealtimeAccessChanges, {
  RealtimeAccessChangeKind,
} from "../Utils/Realtime/RealtimeAccessChanges";
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
import OperatorSlackNotice from "../Utils/OperatorSlackNotice";
import ProductAnalytics from "../Utils/ProductAnalytics";
import MarketingEventUtil, {
  utmAnalyticsProperties,
} from "../Utils/Marketing/MarketingEventUtil";
import { MarketingEventType } from "../../Types/Marketing/MarketingEvent";
import UserTotpAuthService from "./UserTotpAuthService";
import UserTwoFactorBackupCodeService from "./UserTwoFactorBackupCodeService";
import UserWebAuthnService from "./UserWebAuthnService";
import TwoFactorWrongCodes from "../Utils/TwoFactorWrongCodes";
import BadDataException from "../../Types/Exception/BadDataException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import NewPasswordRule from "../Utils/NewPasswordRule";
import ServerSendingStatus from "../Utils/ServerSending/ServerSendingStatus";
import PendingInviteeProfiles, {
  WithheldProfile,
} from "../Utils/TeamMember/PendingInviteeProfiles";
import {
  PASSWORD_RESET_LINK_CANNOT_BE_EMAILED_MESSAGE,
  RESET_PASSWORD_PAGE_ROUTE,
  SET_PASSWORD_LINK_CANNOT_BE_EMAILED_MESSAGE,
  SET_PASSWORD_LINK_EXPIRY_DAYS,
  SET_PASSWORD_LINK_HAS_PASSWORD_MESSAGE,
  SET_PASSWORD_PAGE_ROUTE,
} from "../../Types/Accounts/SetPasswordLink";
import {
  normalizeUserLanguageToStore,
  UNSUPPORTED_USER_LANGUAGE_MESSAGE,
} from "../../Types/UserLanguage";
import UserAuthenticationStatus from "../../Types/UserAuthenticationStatus";
import TwoFactorAuthStatus from "../../Types/TwoFactorAuthStatus";
import TwoFactorAuthSetupUtil, {
  TWO_FACTOR_AUTH_LAST_METHOD_MESSAGE,
  TWO_FACTOR_AUTH_NEEDS_A_METHOD_MESSAGE,
  TWO_FACTOR_AUTH_OWN_ACCOUNT_ON_MESSAGE,
  TwoFactorAuthSetup,
} from "../../Types/TwoFactorAuthSetup";
import SsoManagedSignIn from "../Utils/SsoManagedSignIn";
import { SsoManagedBy } from "../../Types/SSO/SsoManagedSignIn";
import Name from "../../Types/Name";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { IsNull, MoreThan, UpdateResult } from "typeorm";
import Timezone from "../../Types/Timezone";
import InMemoryTTLCache from "../Infrastructure/InMemoryTTLCache";
import EnterpriseEdition from "../Enterprise/EnterpriseEdition";
import FeedMarkdown, {
  mdText,
  MarkdownText,
} from "../../Utils/Markdown/FeedMarkdown";
import EmailChangeConfirmation, {
  EMAIL_CHANGE_LINK_EXPIRY_IN_HOURS,
} from "../Utils/EmailChange/EmailChangeConfirmation";
import EmailAddressChangedNotice from "../Utils/EmailChange/EmailAddressChangedNotice";
import {
  EMAIL_ADDRESS_CHANGED_BY_KEY,
  getEmailAddressChanger,
} from "../../Types/Accounts/EmailAddressChangedEmail";
import RequestOrigin from "../../Types/RequestOrigin";

/*
 * A person's own change of address, held for the new address to confirm
 * (#9821, Utils/EmailChange/EmailChangeConfirmation): found by
 * onBeforeUpdate, its link's expiry written by onUpdatePermitted, sent for
 * by onUpdateSuccess once the update has been answered. Keyed by the update,
 * which every hook is handed.
 */
interface PendingEmailChange {
  userId: ObjectID;
  newEmail: Email;
  timezone: Timezone | null | undefined;
  origin: RequestOrigin | undefined;
  /*
   * When the link stops working (#9908): kept on the account with the
   * waiting address, for User Profile, and given to the link itself, so the
   * two end at the same moment.
   */
  linkExpires: Date;
}

const pendingEmailChanges: WeakMap<
  UpdateBy<Model>,
  PendingEmailChange
> = new WeakMap<UpdateBy<Model>, PendingEmailChange>();

// What a person is told who writes a pending address themselves.
export const PENDING_EMAIL_NOT_WRITABLE_MESSAGE: string =
  "A new email address waits until it is confirmed, so it cannot be set directly. Change your email address to send a new address a link.";

// What a person is told who names an account other than their own.
export const OWN_EMAIL_ONLY_MESSAGE: string =
  "You can only change your own email address.";

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

/*
 * What the checks on every authenticated request read about an account:
 * whether a master admin has blocked it, and whether it is a master admin
 * itself now. One primary-key read answers both.
 */
export interface AccountStanding {
  isBlocked: boolean;
  isMasterAdmin: boolean;
}

/*
 * How long one API node trusts what it read about an account
 * (AccountStanding): whether it is blocked, and whether it is a master admin.
 *
 * This bounds how long a block, or removing someone's master admin access,
 * takes to reach a session that is already open on ANOTHER node when that
 * node is not told. The node that writes the change drops its own entry at
 * once (onUpdateSuccess) and tells every other node (RealtimeAccessChanges,
 * AccountChanged), which drop theirs; a node the message cannot reach answers
 * as it last read for at most this long. A block also revokes every session,
 * so a refresh token is refused immediately everywhere, and a renewed session
 * says what its person is now; what this governs is the stateless 15-minute
 * access token, which would otherwise run to expiry with what its person was
 * when it was signed.
 */
export const ACCOUNT_STANDING_CACHE_TTL_MS: number = 60_000;

export class Service extends DatabaseService<Model> {
  /*
   * Suppresses repeated `lastActive` UPDATEs from a single API node. 60s of
   * staleness on "last seen" is acceptable; an UPDATE per request is not.
   */
  private lastActiveCache: InMemoryTTLCache<true> = new InMemoryTTLCache(
    10_000,
  );

  // What getAccountStanding read, per node.
  private accountStandingCache: InMemoryTTLCache<AccountStanding> =
    new InMemoryTTLCache(10_000);

  /*
   * One lookup per user in flight. A dashboard load fires a burst of
   * concurrent requests, and without this a cold cache turns the burst into
   * the same number of identical queries.
   */
  private accountStandingLookups: Map<string, Promise<AccountStanding>> =
    new Map();

  public constructor() {
    super(Model);
  }

  /**
   * Whether a master admin has blocked this user. For the checks that run on
   * every authenticated request (UserAuthorization, MasterAdminAuthorization),
   * so it is read with whether they are a master admin (getAccountStanding)
   * and cached per node for ACCOUNT_STANDING_CACHE_TTL_MS.
   *
   * The sign-in and refresh-token routes do NOT use this. They load the user
   * row anyway, and they are where a block has to take effect immediately, so
   * they read `isBlocked` straight from it.
   *
   * A user that does not exist is reported as not blocked. This answers the
   * blocked question only; what a deleted account may still do is out of its
   * scope (/refresh-token refuses one).
   */
  @CaptureSpan()
  public async isUserBlocked(userId: ObjectID): Promise<boolean> {
    return (await this.getAccountStanding(userId)).isBlocked;
  }

  /**
   * Whether this user is a master admin now, as their account says. A
   * session's access token says only what they were when it was signed, up
   * to 15 minutes ago: another master admin may have removed the access
   * since, and the session's next request is answered as they are now
   * (UserAuthorization.readRequestSession).
   *
   * Read with whether they are blocked, by the same row read and from the
   * same per-node cache, which a write to either column drops on every node.
   * A user that does not exist is not a master admin.
   */
  @CaptureSpan()
  public async isUserMasterAdmin(userId: ObjectID): Promise<boolean> {
    return (await this.getAccountStanding(userId)).isMasterAdmin;
  }

  /*
   * One primary-key read of what every authenticated request asks about an
   * account, kept per node for ACCOUNT_STANDING_CACHE_TTL_MS. Rejects when
   * the read fails: "we could not find out" is not an answer, and nothing
   * about a failure is kept.
   */
  private async getAccountStanding(userId: ObjectID): Promise<AccountStanding> {
    const key: string = this.getAccountStandingKey(userId);

    const cached: AccountStanding | undefined =
      this.accountStandingCache.get(key);

    if (cached !== undefined) {
      return cached;
    }

    const inFlight: Promise<AccountStanding> | undefined =
      this.accountStandingLookups.get(key);

    if (inFlight) {
      return inFlight;
    }

    const lookup: Promise<AccountStanding> = this.findOneById({
      id: userId,
      select: { isBlocked: true, isMasterAdmin: true },
      props: { isRoot: true },
    })
      .then((user: Model | null): AccountStanding => {
        const standing: AccountStanding = {
          isBlocked: Boolean(user?.isBlocked),
          isMasterAdmin: user?.isMasterAdmin === true,
        };

        /*
         * Only cached if this lookup is still the current one. A change
         * written while it was on the wire clears the slot
         * (forgetAccountStanding), and the answer this lookup read may
         * predate that write.
         */
        if (this.accountStandingLookups.get(key) === lookup) {
          this.accountStandingCache.set(
            key,
            standing,
            ACCOUNT_STANDING_CACHE_TTL_MS,
          );
        }

        return standing;
      })
      .finally((): void => {
        if (this.accountStandingLookups.get(key) === lookup) {
          this.accountStandingLookups.delete(key);
        }
      });

    this.accountStandingLookups.set(key, lookup);

    return lookup;
  }

  // Drops what this node read about the account, so the next request reads the row.
  public forgetAccountStanding(userId: ObjectID): void {
    const key: string = this.getAccountStandingKey(userId);

    this.accountStandingCache.delete(key);
    this.accountStandingLookups.delete(key);
  }

  /*
   * One account, one entry: the database compares ids without regard to
   * case, so an id written in capitals names the same account - and a write
   * to it must drop what was read under either spelling.
   */
  private getAccountStandingKey(userId: ObjectID): string {
    return userId.toString().toLowerCase();
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
  }): Promise<MarkdownText> {
    /*
     * Callers reach this through non-null assertions on nullable columns (an
     * on-call timeline row for a coverage gap has no recipient, for example).
     * Querying with an undefined id is not a harmless no-op — the id key is
     * dropped from the WHERE clause, so the query degrades into "any user" and
     * would name an arbitrary person. Fail closed instead.
     */
    if (!data.userId) {
      return FeedMarkdown.empty();
    }

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
      return FeedMarkdown.empty();
    }

    /*
     * Someone only invited to the project is named as the project knows
     * them - the name typed for them, else their address - never by their
     * account's own name, which it does not see until they join (#9823).
     * Whoever acted in the project has joined it, so only the people a line
     * is about can be named so.
     */
    const withheld: Map<string, WithheldProfile> = data.projectId
      ? await PendingInviteeProfiles.readWithheldProfilesInProject({
          userIds: [data.userId.toString()],
          projectId: data.projectId,
        })
      : new Map<string, WithheldProfile>();

    /*
     * A user's name is theirs to set, and it is placed inside the link's own
     * text in feed items and chat messages, so every Markdown character in it
     * is escaped: a "]" cannot end the text early and point the rest of the
     * sentence somewhere else, "![...](...)" is no image, and "<!channel>"
     * mentions nobody. The name still reads exactly as typed.
     */
    const displayName: string =
      PendingInviteeProfiles.getNameInProject({
        userId: data.userId,
        name: user.name,
        email: user.email,
        withheld: withheld,
      }) || "User";

    return mdText`[${displayName}](${(await this.getUserLinkInDashboard(data.projectId, data.userId)).toString()})`;
  }

  /*
   * Where a person's name links to, in every feed entry, Slack and
   * Microsoft Teams message and email: their page in the project - Users,
   * then the person (USER_VIEW in the Dashboard's RouteMap) - with their
   * teams, on-call readiness and rules. The link used to point at
   * .../settings/users/<id>, where no page has been since Users moved out
   * of Project Settings, and opened a blank page; the Dashboard forwards
   * that address to this one, for every link already written.
   */
  @CaptureSpan()
  public async getUserLinkInDashboard(
    projectId: ObjectID,
    userId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/users/${userId.toString()}`,
    );
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    /*
     * The one password rule, for a new account's password however it came:
     * sign up, a master admin's Create User, the API (Utils/NewPasswordRule).
     */
    NewPasswordRule.assertMet(createBy.data.password);

    /*
     * The enterprise seat limit, enforced here because this is the one place
     * every new user passes through: team invitations, self-service signup,
     * SSO/OIDC just-in-time provisioning, SCIM, and the Admin Dashboard all
     * end up in `create`. Enforcing on the invitation instead would leave
     * signup and SSO as open doors around it.
     *
     * No isRoot exemption on purpose — invitations create the invited user as
     * root, so exempting root would exempt invitations, which is the exact
     * thing this is here to bound. The limit itself belongs to the Enterprise
     * license client (ee/Server/License): this is a no-op on the Community
     * Edition, on oneuptime.com (billing enabled) and whenever the license is
     * not valid or in grace, and it never counts the User table on a license
     * with no seat limit.
     */
    await EnterpriseEdition.assertSeatAvailableForNewUser();

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

    Attribution.boundUtmColumns(createBy.data as unknown as JSONObject);

    this.normalizeLanguage(createBy.data as unknown as JSONObject);

    return { createBy, carryForward: null };
  }

  /*
   * A person's language as it is stored (Types/UserLanguage): one of the
   * codes OneUptime writes in ("de-AT" is "de"), or none for an empty one.
   * A language OneUptime does not write in is refused, so nobody is written
   * to in English by mistake. Left alone when the write does not name one:
   * only what the write itself carries is rewritten, so the caller is held
   * to their own permission to write it (HookWritesCallersMayMake).
   */
  private normalizeLanguage(data: JSONObject | undefined): void {
    if (!data) {
      return;
    }

    if (data["language"] === undefined) {
      return;
    }

    const language: string | null | undefined = normalizeUserLanguageToStore(
      data["language"],
    );

    if (language === undefined) {
      throw new BadDataException(UNSUPPORTED_USER_LANGUAGE_MESSAGE);
    }

    data["language"] = language;
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    /*
     * The operator's Slack channel hears of every new user
     * (OperatorSlackNotice), in the background: the signup waits on no
     * webhook, and a post that fails is logged, never thrown.
     */
    if (NotificationSlackWebhookOnCreateUser) {
      void OperatorSlackNotice.post({
        webhookUrl: NotificationSlackWebhookOnCreateUser,
        text: OperatorSlackNotice.getUserCreatedText({ user: createdItem }),
        about: "user creation",
        userId: createdItem.id,
      });
    }

    /*
     * Server-side signup event (ad blockers eat the client-side one). Also
     * fires for users created via team invites — has_password separates
     * direct signups (true) from invited users (false).
     */
    if (createdItem.email) {
      /*
       * Captured before the deferred builder below closes over it: the
       * narrowing this `if` gives us does not survive into a callback, and
       * `email` is what makes the signup conversion joinable at all.
       */
      const signUpEmail: string = createdItem.email.toString();

      ProductAnalytics.capture({
        event: "server/user_created",
        distinctId: signUpEmail,
        properties: {
          has_password: Boolean(createdItem.password),
          ...utmAnalyticsProperties(createdItem as unknown as JSONObject),
          utm_url: createdItem.utmUrl || "",
          click_ids: createdItem.clickIds || {},
          first_touch: createdItem.firstTouchAttribution || {},
        },
      });

      /*
       * The outbound sign_up conversion.
       *
       * Emitted here rather than from the register endpoint so a signup
       * reached any other way still counts, and keyed on the user id so a
       * retried delivery cannot become a second conversion.
       *
       * hasPassword separates a direct signup from a user created by a team
       * invite, exactly as the analytics event above does — both are real
       * users, only one is an acquisition, and the receiver decides which it
       * cares about rather than us deciding for it here.
       */
      MarketingEventUtil.emitInBackground(() => {
        return MarketingEventUtil.buildEvent({
          eventType: MarketingEventType.SignUp,
          eventId: `${MarketingEventType.SignUp}:${createdItem.id?.toString()}`,
          occurredAt: createdItem.createdAt || new Date(),
          email: signUpEmail,
          attributionSource: createdItem,
          data: {
            userId: createdItem.id?.toString() || "",
            hasPassword: Boolean(createdItem.password),
          },
        });
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
    // Reject values that could bypass the exact-false ownership check below.
    if (
      updateBy.data.enableTwoFactorAuth !== undefined &&
      typeof updateBy.data.enableTwoFactorAuth !== "boolean"
    ) {
      throw new BadDataException(
        "Two-factor authentication is turned on or off with true or false (enableTwoFactorAuth).",
      );
    }

    this.normalizeLanguage(updateBy.data as unknown as JSONObject);

    /*
     * Two factor authentication is switched by its owner alone, outside the
     * Admin Dashboard: this hook runs before row scoping, so the update must
     * name the caller's own account by an exact predicate. A master admin
     * requires it of someone else, or stops requiring it, with the routes
     * built for that (setTwoFactorAuthRequired), whose writes are root and
     * sign the person out when it is turned on.
     *
     * Turning it on asks one thing more (issue #9666): a second step set up
     * behind it, and a sign-in that is not managed by single sign-on
     * (assertTwoFactorAuthMayBeTurnedOn). Turning it off asks nothing more,
     * so somebody can always step down from a requirement they cannot meet.
     *
     * Asked before anything below writes, so a refused update changes nothing.
     */
    const turnsTwoFactorAuthOn: boolean =
      updateBy.data.enableTwoFactorAuth === true;
    const turnsTwoFactorAuthOff: boolean =
      updateBy.data.enableTwoFactorAuth === false;

    if (
      !updateBy.props.isRoot &&
      (turnsTwoFactorAuthOn || turnsTwoFactorAuthOff)
    ) {
      if (
        !OwnerOnlyColumnPermission.isQueryPinnedToCurrentUser(
          Model,
          updateBy.query,
          updateBy.props,
        )
      ) {
        throw new BadDataException(
          turnsTwoFactorAuthOn
            ? TWO_FACTOR_AUTH_OWN_ACCOUNT_ON_MESSAGE
            : "You can only turn off two factor authentication for your own account.",
        );
      }

      if (turnsTwoFactorAuthOn) {
        await this.assertTwoFactorAuthMayBeTurnedOn(updateBy.props.userId!);
      }
    }

    /*
     * A password set by the person it signs in (issue #9688): refused while
     * the server requires single sign-on of them (SsoManagedSignIn), when it
     * could only lie dormant until the requirement was turned off. It is the
     * caller who is asked: a person may only write their own account, so
     * the caller is the account here, unless they are a master admin -
     * who is exempt, whoever's password they set. A root write (a reset
     * link, Set Password in the Admin Dashboard) is not the profile's.
     *
     * Before the password rule, so somebody who cannot set one is not told
     * to make it longer.
     */
    if (
      updateBy.data.password &&
      !updateBy.props.isRoot &&
      updateBy.props.userId
    ) {
      await SsoManagedSignIn.assertMayChangeLocalSignIn(updateBy.props.userId);
    }

    /*
     * The one password rule, for a new password however it came: a reset
     * link, Update Password, a master admin's Set Password, the API
     * (Utils/NewPasswordRule). Only a new one: signing in writes none.
     */
    NewPasswordRule.assertMet(updateBy.data.password);

    // A new address waiting for its link is OneUptime's to write (#9821).
    this.assertPendingEmailIsNotWritten(updateBy);

    let carryForward: Array<Model> = [];

    if (updateBy.data.password || updateBy.data.email) {
      const users: Array<Model> = await this.findRowsAndHoldUpdateToThem(
        updateBy,
        {
          _id: true,
          email: true,
          // "Your password was changed" says when in the owner's own zone.
          timezone: true,
          /*
           * And the email to the address an account had, once it changed
           * (#9907), is in the owner's own language.
           */
          language: true,
          /*
           * Whether there was a password to change: an invited account has
           * none until the person signs up, and its first one is no change
           * (onUpdateSuccess, #7472). Read only for a password write.
           */
          ...(updateBy.data.password ? { password: true } : {}),
        },
      );

      carryForward = users;
    }

    /*
     * A person's own new address waits for the address to confirm it
     * (#9821): it is kept as pending and the email is left as it is, so the
     * answer is the same whether or not another account has the address.
     * Before anything below acts on `email`, which it may take out: the
     * address does not change yet, so neither do the links sent to it.
     */
    await this.holdOwnEmailChangeForConfirmation(updateBy, carryForward);

    if (updateBy.data.email) {
      await this.expirePasswordResetTokensForEmailChange({
        newEmail: updateBy.data.email as Email,
        existingUsers: carryForward,
      });
    }

    return { updateBy, carryForward: carryForward };
  }

  /*
   * CHANGING YOUR OWN EMAIL ADDRESS SAYS NOTHING ABOUT THE NEW ONE (#9821).
   *
   * Somebody signed in who writes a new `email` to their own account (the
   * profile's Basic Info, or PUT /api/user/:id) no longer has it written:
   * an address another account uses was refused on the unique index, and
   * that refusal told any signed-in account - on OneUptime Cloud, anybody -
   * which addresses have an account. Instead:
   *
   *   - the change is counted, for the account and for the address, and
   *     refused on a server that cannot send the email that confirms it
   *     (EmailChangeConfirmation.assertMayAsk) - the same for every address;
   *   - `email` is taken out of the write, and `newUnverifiedTemporaryEmail`
   *     put in, so the account keeps its address and the profile shows the
   *     new one waiting. The update succeeds as any other does;
   *   - once it has been answered (onUpdateSuccess), the new address is
   *     emailed: a link that confirms it (Identity's /verify-email swaps the
   *     account to it), or, when another account has it, word that it
   *     cannot be used.
   *
   * Not held: the address the account already has (every save of the
   * profile's form sends it), a master admin's change (they see every
   * account already, and the Admin Dashboard changes it at once), and a
   * change the server makes itself (root: SCIM, single sign-on, the
   * confirmation's own swap).
   *
   * `rows` are the update's rows, as onBeforeUpdate read them: only those
   * the caller may write, so a person's own.
   */
  private async holdOwnEmailChangeForConfirmation(
    updateBy: UpdateBy<Model>,
    rows: Array<Model>,
  ): Promise<void> {
    if (
      !updateBy.data.email ||
      updateBy.props.isRoot ||
      updateBy.props.isMasterAdmin
    ) {
      return;
    }

    const requested: Email = new Email(String(updateBy.data.email));

    const changing: Array<Model> = rows.filter((row: Model): boolean => {
      return (
        row.email?.toString().toLowerCase() !==
        requested.toString().toLowerCase()
      );
    });

    // The address it already has: nothing to confirm, and nothing changes.
    if (changing.length === 0) {
      return;
    }

    const own: Model | undefined = changing[0];

    if (
      changing.length !== 1 ||
      !own?.id ||
      !updateBy.props.userId ||
      own.id.toString().toLowerCase() !==
        updateBy.props.userId.toString().toLowerCase()
    ) {
      throw new BadDataException(OWN_EMAIL_ONLY_MESSAGE);
    }

    await EmailChangeConfirmation.assertMayAsk({
      userId: own.id,
      newEmail: requested,
    });

    delete (updateBy.data as unknown as Record<string, unknown>)["email"];
    (updateBy.data as unknown as Record<string, unknown>)[
      "newUnverifiedTemporaryEmail"
    ] = requested;

    pendingEmailChanges.set(updateBy, {
      userId: own.id,
      newEmail: requested,
      timezone: own.timezone,
      origin: updateBy.props.requestOrigin,
      linkExpires: OneUptimeDate.getSomeHoursAfter(
        EMAIL_CHANGE_LINK_EXPIRY_IN_HOURS,
      ),
    });
  }

  /*
   * `newUnverifiedTemporaryEmail` is OneUptime's to set: a person may clear
   * it (Cancel Change), never write an address into it, or they could name
   * an address the link would then move their account to unproven.
   */
  private assertPendingEmailIsNotWritten(updateBy: UpdateBy<Model>): void {
    const pendingAddress: unknown = (
      updateBy.data as unknown as Record<string, unknown>
    )["newUnverifiedTemporaryEmail"];

    if (
      !updateBy.props.isRoot &&
      pendingAddress !== undefined &&
      pendingAddress !== null &&
      pendingAddress !== ""
    ) {
      throw new BadDataException(PENDING_EMAIL_NOT_WRITABLE_MESSAGE);
    }
  }

  /*
   * What a held change of address sends, after the update that asked for
   * it has been answered: whether another account has the address is read
   * only now, so the answer could not wait on it. Never throws.
   */
  private async sendForPendingEmailChange(
    pending: PendingEmailChange,
  ): Promise<void> {
    try {
      const holder: Model | null = await this.findOneBy({
        query: { email: pending.newEmail },
        select: { _id: true },
        props: { isRoot: true },
      });

      await EmailChangeConfirmation.sendForPendingChange({
        userId: pending.userId,
        newEmail: pending.newEmail,
        isTaken: Boolean(holder),
        origin: pending.origin,
        timezone: pending.timezone,
        linkExpires: pending.linkExpires,
      });
    } catch (err) {
      logger.error(err, { userId: pending.userId.toString() } as LogAttributes);
    }
  }

  /*
   * A new password ends the links already sent for the account, however it is
   * set: the reset link's page, the profile page, a master admin's Set Password
   * or an invited person claiming their account at sign up. Each link is a bearer
   * credential found by its token's hash alone, and neither can outlive the
   * password it was sent under:
   *
   *   - a sign-in link (Types/Accounts/MagicLink) stands in for the password.
   *     Somebody holding one when the owner changes it would still get past the
   *     first step of signing in, with the wrong two factor codes onUpdateSuccess
   *     forgets counted from nothing again;
   *   - a reset link replaces the password. Somebody holding one when the owner
   *     changes it could, for up to a day, set another and sign the owner out:
   *     undoing the very change the owner made to keep them out.
   *
   * Written here, after every permission check, and never in onBeforeUpdate:
   * the links' columns are OneUptime's (update: []), and DatabaseService holds
   * what onBeforeUpdate leaves to the caller's column permissions - so written
   * there, they would refuse everybody changing their own password.
   *
   * And in the password's own UPDATE, not in one ahead of it as a new email
   * address does (expirePasswordResetTokensForEmailChange): there is no instant
   * at which the new password is stored and a link still works, a link sent
   * while the write is on its way is on the row for it to clear, and a write
   * that fails leaves the password and the links as they were.
   *
   * A hook-free write skips this, as it skips what onUpdateSuccess does for a
   * new password: any new caller that writes `password` with `ignoreHooks: true`
   * has to clear these columns itself. The upgrade of a legacy hash
   * (verifyHashedColumnValue) is hook-free and stays so: it stores the same
   * password.
   */
  @CaptureSpan()
  protected override async onUpdatePermitted(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    await super.onUpdatePermitted(updateBy);

    this.writePendingEmailLinkExpiry(updateBy);

    if (!updateBy.data.password) {
      return;
    }

    updateBy.data.resetPasswordToken = null!;
    updateBy.data.resetPasswordExpires = null!;
    updateBy.data.magicLinkToken = null!;
    updateBy.data.magicLinkExpires = null!;
  }

  /*
   * When a waiting address's link stops working (#9908), kept beside the
   * address so User Profile can say it has expired: a held change writes
   * its link's expiry - the same for a taken address as for a free one, as
   * the rest of the held write is - and clearing the address (Cancel Change,
   * the link's own write) clears it. OneUptime's column (update: []), so
   * written here, once the caller's own columns have passed their check, as
   * the links' columns above are.
   */
  private writePendingEmailLinkExpiry(updateBy: UpdateBy<Model>): void {
    const data: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;
    const pending: PendingEmailChange | undefined =
      pendingEmailChanges.get(updateBy);

    if (pending) {
      data["newUnverifiedTemporaryEmailExpires"] = pending.linkExpires;
      return;
    }

    const pendingAddress: unknown = data["newUnverifiedTemporaryEmail"];

    if (pendingAddress === null || pendingAddress === "") {
      data["newUnverifiedTemporaryEmailExpires"] = null;
    }
  }

  /**
   * Kill any outstanding password-reset link for every account whose email
   * address this update is about to change.
   *
   * A reset link is a bearer credential addressed to ONE mailbox: holding it
   * proves only that somebody could read mail sent to the address the account
   * had when the link was minted. Move the account to a different address and
   * that proof is about a mailbox the account no longer uses, so the link has
   * to die with the address it was sent to.
   *
   * Without this, changing your email is not the account-recovery step that
   * users -- and our own "You have changed your email" mail -- take it to be:
   *
   *   1. An attacker who can read the victim's mailbox requests a password
   *      reset and does NOT spend the link. Nothing about the account looks
   *      wrong, because nothing has changed yet.
   *   2. The victim notices the mailbox is compromised and moves the account
   *      to an address the attacker cannot read. This is exactly the advice
   *      they would be given, and they now believe they are safe.
   *   3. The attacker spends the link from step 1. `/reset-password` finds the
   *      row BY TOKEN HASH ALONE -- it never looks at the email address -- so
   *      it happily sets a new password on the account at its NEW address, and
   *      the victim is locked out of an account they had just rescued.
   *
   * Cleared BEFORE the email is written rather than afterwards in
   * `onUpdateSuccess`, so there is no instant in which the new address is
   * committed while a link mailed to the old one is still redeemable. The
   * price of that ordering is that an email update which subsequently fails
   * has still burned a pending link, and the user has to request another one.
   * For a credential that is the right way round.
   *
   * Only rows whose address actually CHANGES are touched. Directory syncs
   * rewrite `email` with the value it already has on every push (see
   * `App/FeatureSet/Identity/API/SCIM.ts`, which updates whenever either the
   * email or the name is present), and clearing on those would let an
   * unrelated SCIM run invalidate a reset link the user is part-way through
   * using.
   *
   * A row with no `email` stored is treated as changed: on a credential the
   * safe assumption is the one that expires the token.
   *
   * A sign-in link (Types/Accounts/MagicLink) goes with the reset link, for
   * the same reason and more: it is found by its token's hash alone too, and
   * signs the account in outright rather than resetting its password.
   *
   * NOTE: this runs from `onBeforeUpdate`, so an email write made with
   * `ignoreHooks: true` would slip past it. Nothing does that today -- the
   * dashboard, the SCIM endpoints and the admin API all go through the hooks
   * -- and any new caller that writes `email` hook-free has to clear these
   * columns itself.
   */
  @CaptureSpan()
  private async expirePasswordResetTokensForEmailChange(data: {
    newEmail: Email;
    existingUsers: Array<Model>;
  }): Promise<void> {
    const newEmail: string = data.newEmail.toString().toLowerCase();

    for (const user of data.existingUsers) {
      if (!user.id) {
        continue;
      }

      const currentEmail: string | undefined = user.email
        ?.toString()
        .toLowerCase();

      if (currentEmail === newEmail) {
        continue;
      }

      await this.updateOneById({
        id: user.id,
        data: {
          resetPasswordToken: null!,
          resetPasswordExpires: null!,
          magicLinkToken: null!,
          magicLinkExpires: null!,
        },
        /*
         * Root because `resetPasswordToken` and `magicLinkToken` are declared
         * with `update: []` -- no permission can write them -- and hook-free
         * because this IS the update hook; re-entering it would have this
         * write go looking for an email change of its own.
         */
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });
    }
  }

  /*
   * The account whose latest sign-in link carries this token, while that
   * link still works (Types/Accounts/MagicLink), read with `select` - or
   * null: no such link, one that expired, or a newer link replaced it.
   *
   * It only reads. A sign-in spends the link with consumeMagicLinkToken
   * once it has succeeded, so a link that starts a sign-in still works for
   * the authenticator code, security key or backup code that finishes it,
   * as a password does.
   */
  @CaptureSpan()
  public async findByMagicLinkToken(data: {
    token: string;
    select: Select<Model>;
  }): Promise<Model | null> {
    // An empty value hashes to "" (HashedString), which no link is.
    if (!data.token) {
      return null;
    }

    const hashedToken: string = await HashedString.hashValue(
      data.token,
      EncryptionSecret,
    );

    const user: Model | null = await this.findOneBy({
      query: {
        magicLinkToken: hashedToken,
      },
      select: {
        ...data.select,
        _id: true,
        magicLinkExpires: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (
      !user?.id ||
      !user.magicLinkExpires ||
      OneUptimeDate.hasExpired(user.magicLinkExpires)
    ) {
      return null;
    }

    delete user.magicLinkExpires;

    return user;
  }

  /*
   * Spend this account's sign-in link (Types/Accounts/MagicLink): true when
   * this request is the one that cleared it, false when there was nothing
   * to clear - another request spent it first, it expired, a newer link
   * replaced it, or the account was removed. The token's hash, the expiry
   * and the account not being removed are all in the UPDATE's predicate, so
   * of two requests that carry one link only one finds it there.
   *
   * Hook-free, as a single conditional write has to be. It touches only the
   * two link columns, which no hook reacts to.
   */
  @CaptureSpan()
  public async consumeMagicLinkToken(data: {
    userId: ObjectID;
    token: string;
  }): Promise<boolean> {
    // An empty value hashes to "" (HashedString), which no link is.
    if (!data.token) {
      return false;
    }

    const hashedToken: string = await HashedString.hashValue(
      data.token,
      EncryptionSecret,
    );

    const updateResult: UpdateResult = await this.getRepository().update(
      {
        _id: data.userId.toString(),
        magicLinkToken: hashedToken,
        magicLinkExpires: MoreThan(OneUptimeDate.getCurrentDate()),
        deletedAt: IsNull(),
      } as any,
      {
        magicLinkToken: null,
        magicLinkExpires: null,
      } as any,
    );

    return updateResult.affected === 1;
  }

  /*
   * A deleted account's live updates end at once, on every server. So does
   * whatever a server read about it: an account that is gone is no master
   * admin, and the access token of a session it already had answers its
   * next request as no master admin's - not when the minute a server keeps
   * what it read (ACCOUNT_STANDING_CACHE_TTL_MS) runs out.
   */
  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    for (const userId of itemIdsBeforeDelete) {
      this.forgetAccountStanding(userId);

      RealtimeAccessChanges.announce({
        kind: RealtimeAccessChangeKind.AccountChanged,
        userId: userId.toString(),
      });

      RealtimeAccessChanges.announce({
        kind: RealtimeAccessChangeKind.SessionsEnded,
        userId: userId.toString(),
      });
    }

    return onDelete;
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    // Every user the delete removes - and the delete held to them - may be a member of no project.
    const users: Array<Model> = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      {
        _id: true,
      },
    );

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
    updatedItemIds: ObjectID[],
  ): Promise<OnUpdate<Model>> {
    /*
     * Blocked or unblocked, made or no longer a master admin: this server
     * forgets what it read about them at once, so their next request here -
     * with the session they already hold - is answered as they are now
     * (UserAuthorization.readRequestSession reads both). The other servers
     * are told below.
     *
     * Hook-only, like the revocations below: a write made with
     * `ignoreHooks: true` is seen here only when ACCOUNT_STANDING_CACHE_TTL_MS
     * runs out.
     */
    const changesStanding: boolean = Boolean(
      onUpdate &&
        (onUpdate.updateBy.data.isBlocked !== undefined ||
          onUpdate.updateBy.data.isMasterAdmin !== undefined),
    );

    if (changesStanding) {
      for (const userId of updatedItemIds) {
        this.forgetAccountStanding(userId);
      }
    }

    /*
     * A block has to end the sessions the user already holds, not only stop
     * the next sign-in. Revoking them makes /refresh-token refuse at once; the
     * access token already in the browser is refused by UserAuthorization,
     * which reads the flag through `isUserBlocked`.
     *
     * Unblocking only drops the cached answer. The revoked sessions stay
     * revoked, and the user signs in again.
     *
     * Hook-only, like the password revocation below: a write made with
     * `ignoreHooks: true` has to revoke the sessions itself.
     */
    if (onUpdate && onUpdate.updateBy.data.isBlocked !== undefined) {
      for (const userId of updatedItemIds) {
        if (onUpdate.updateBy.data.isBlocked) {
          await UserSessionService.revokeAllSessionsByUserId(userId, {
            cause: SessionEndCause.AccountBlocked,
          });

          /*
           * Every live update of theirs ends at once, on every server, and
           * a token issued before the block opens none again.
           */
          RealtimeAccessChanges.announce({
            kind: RealtimeAccessChangeKind.SessionsEnded,
            userId: userId.toString(),
          });
        }
      }
    }

    /*
     * Blocked or unblocked, made or no longer a server admin: every server
     * forgets what it held for them - whether they are blocked or a master
     * admin, and who they are in each project for live updates - so the next
     * request and the next live update read them as they are now.
     */
    if (changesStanding) {
      for (const userId of updatedItemIds) {
        RealtimeAccessChanges.announce({
          kind: RealtimeAccessChangeKind.AccountChanged,
          userId: userId.toString(),
        });
      }
    }

    if (onUpdate && onUpdate.updateBy.data.password) {
      const host: Hostname = await DatabaseConfig.getHost();
      const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

      for (const user of onUpdate.carryForward) {
        // Revoke all active sessions for this user on password change
        await UserSessionService.revokeAllSessionsByUserId(user.id!, {
          cause: SessionEndCause.PasswordChanged,
        });

        /*
         * A new password ends any wait for wrong two factor codes. Whoever
         * entered them held the old password or a sign-in link, and neither
         * signs anybody in now: the write that stored this password ended the
         * link too (onUpdatePermitted). The owner, who just set the new one,
         * signs in at once. Every way a password changes comes through here:
         * the reset link, the profile page and a master admin's Set Password.
         */
        await TwoFactorWrongCodes.forget(user.id!);

        /*
         * An account that had no password has just been given its first
         * one: nothing was changed, and "If this was not you, someone else
         * can get into your account" would alarm a person who has just
         * signed up. That is an invited person claiming their account at
         * sign-up above all, seconds after following the invitation (#7472);
         * the sign-up page takes them in, and no email follows. Whoever sets
         * a first password held a link from the mailbox (the invitation's
         * registration link, a reset link) or is a master admin, so no
         * warning is owed. Their sessions and links still end as for any
         * new password (above, and onUpdatePermitted).
         */
        if (!user.password) {
          continue;
        }

        /*
         * Password changed: tell the owner, with when, and from where when a
         * request made the change - the reset link's page or the profile
         * page (requestOrigin, set from the request by the route or
         * CommonAPI). A server admin's Set Password carries none, so its
         * email says when alone.
         */
        MailService.sendMail({
          toEmail: user.email!,
          subject: "Password Changed.",
          isSubjectLiteral: true,
          templateType: EmailTemplateType.PasswordChanged,
          vars: {
            homeURL: new URL(httpProtocol, host).toString(),
            forgotPasswordUrl: new URL(
              httpProtocol,
              host,
              new Route(AccountsRoute.toString()).addRoute("/forgot-password"),
            ).toString(),
            ...RequestOriginUtil.getEmailVars({
              origin: onUpdate.updateBy.props.requestOrigin,
              timezone: user.timezone,
            }),
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

    /*
     * A person's own new address, held for confirmation (#9821): the new
     * address is emailed once this update has been answered - not awaited,
     * so how long the answer takes says nothing about whether another
     * account has the address.
     */
    const pendingEmailChange: PendingEmailChange | undefined = onUpdate
      ? pendingEmailChanges.get(onUpdate.updateBy)
      : undefined;

    if (onUpdate && pendingEmailChange) {
      pendingEmailChanges.delete(onUpdate.updateBy);

      // Only once the account's row has the new address waiting.
      const isWritten: boolean = updatedItemIds.some(
        (id: ObjectID): boolean => {
          return (
            id.toString().toLowerCase() ===
            pendingEmailChange.userId.toString().toLowerCase()
          );
        },
      );

      if (isWritten) {
        void this.sendForPendingEmailChange(pendingEmailChange);
      }
    }

    /*
     * An address written straight away - by a master admin, single sign-on,
     * SCIM - is proven by a link to it, as before. Except:
     *   - one the write itself says is verified: the swap a confirmed change
     *     makes (#9821), whose link proved the mailbox;
     *   - on a server that cannot send email, which cannot ask for proof:
     *     marking the address unverified there would lock its person out,
     *     as signing in would wait for a link that never comes. Its
     *     addresses are taken as verified, as its sign-ups are.
     */
    if (
      onUpdate &&
      onUpdate.updateBy.data.email &&
      onUpdate.updateBy.data.isEmailVerified !== true &&
      (await EmailChangeConfirmation.canSendEmail())
    ) {
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
            isSubjectLiteral: true,
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

    if (onUpdate && onUpdate.updateBy.data.email) {
      this.tellPreviousAddressesOfChange(onUpdate, updatedItemIds);
    }

    return onUpdate;
  }

  /*
   * EVERY ADDRESS AN ACCOUNT LEAVES IS TOLD (#9907).
   *
   * An account whose address this write changed emails the address it had
   * (Utils/EmailChange/EmailAddressChangedNotice): that it changed, to which
   * address (masked), when, from where for the account's own change, and
   * whom to ask if it was not them. Every way an address changes writes it
   * here: the link that confirms a person's own change (#9821), a master
   * admin's change, SCIM, any other write OneUptime makes. Asking for a
   * change writes no address - it is held for its link (above) - so asking
   * sends nothing to the old address; the link's write does.
   *
   * Once per account the write reached whose address it changed: a write
   * of the address an account already has - SCIM and single sign-on send
   * it again with every push and sign-in, the profile's form with every
   * save - changes nothing and sends nothing, in any case. Who changed it
   * comes from the write (getEmailAddressChanger): OneUptime's own names
   * its changer in miscDataProps, which only a root write may.
   *
   * Never awaited: the answer does not wait on an email, and the sender
   * never throws. A write made with `ignoreHooks: true` skips this, as it
   * skips the links the address change ends (onBeforeUpdate): any new
   * caller that writes `email` hook-free has to send it itself.
   */
  private tellPreviousAddressesOfChange(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): void {
    const newEmail: Email = new Email(String(onUpdate.updateBy.data.email));
    const props: DatabaseCommonInteractionProps = onUpdate.updateBy.props;
    const written: Set<string> = new Set<string>(
      updatedItemIds.map((id: ObjectID): string => {
        return id.toString().toLowerCase();
      }),
    );
    const rows: Array<Model> = Array.isArray(onUpdate.carryForward)
      ? (onUpdate.carryForward as Array<Model>)
      : [];

    for (const row of rows) {
      if (
        !row.id ||
        !row.email ||
        !written.has(row.id.toString().toLowerCase()) ||
        row.email.toString().toLowerCase() === newEmail.toString().toLowerCase()
      ) {
        continue;
      }

      void EmailAddressChangedNotice.send({
        userId: row.id,
        previousEmail: row.email,
        newEmail: newEmail,
        changedBy: getEmailAddressChanger({
          isRoot: props.isRoot === true,
          isMasterAdmin: props.isMasterAdmin === true,
          callerUserId: props.userId?.toString(),
          accountUserId: row.id.toString(),
          namedChanger:
            onUpdate.updateBy.miscDataProps?.[EMAIL_ADDRESS_CHANGED_BY_KEY],
        }),
        origin: props.requestOrigin,
        at: OneUptimeDate.getCurrentDate(),
        language: row.language,
        timezone: row.timezone,
      });
    }
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
   * the column's empty `create: []` access control). For the same reason it
   * refuses a user that already carries an `_id`.
   */
  @CaptureSpan()
  public async createUserOnSignup(data: {
    user: Model;
    props: DatabaseCommonInteractionProps;
  }): Promise<Model> {
    /*
     * A signup is always a new row. TypeORM's save() turns an entity carrying
     * an existing primary key into an UPDATE of that row, and this create runs
     * as root, which DatabaseService.create exempts from its own supplied-id
     * check -- so an `_id` reaching here would overwrite the email and password
     * of whichever user it names instead of creating one. /signup builds its
     * model from an allow-list that never includes `_id`; this is the backstop.
     */
    if (data.user._id) {
      throw new BadDataException("An id cannot be supplied when signing up.");
    }

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
   * Whether this instance has no account to sign in to yet: no user, and no
   * project either - the state in which the next signup becomes Master Admin
   * (isInstanceAwaitingFirstUser). A self-hosted server's sign-in page sends
   * people to register then, and the register page says the account it
   * creates becomes the admin.
   *
   * Read-only and lock-free: it decides nothing, so it never takes the
   * election mutex, and it logs nothing (it is asked on page loads). The
   * election itself still decides under the mutex.
   */
  @CaptureSpan()
  public async isAwaitingFirstAccount(): Promise<boolean> {
    const userCount: PositiveNumber = await this.countBy({
      props: {
        isRoot: true,
      },
      query: {},
    });

    if (!userCount.isZero()) {
      return false;
    }

    const projectCount: PositiveNumber = await ProjectService.countBy({
      props: {
        isRoot: true,
      },
      query: {},
    });

    return projectCount.isZero();
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
    attribution?: SignUpAttribution | undefined;
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

    /*
     * Where a signup that posted no form came from. Copied on to the project
     * and the conversions it makes, as the sign-up form's is.
     */
    if (data.attribution) {
      Object.assign(user, data.attribution.utm);

      if (data.attribution.clickIds) {
        user.clickIds = data.attribution.clickIds;
      }

      if (data.attribution.firstTouch) {
        user.firstTouchAttribution = data.attribution.firstTouch;
      }
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
        isMasterAdmin: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!user) {
      throw new NotFoundException("User not found.");
    }

    const isMasterAdmin: boolean = user.isMasterAdmin === true;

    /*
     * Why SSO manages their sign-in, for the page's warnings: a password or
     * a second step given to them now opens none of their projects. A rule
     * that cannot be read is logged and reads as not managed - this is what
     * the page says, never what the server allows, and it still refuses
     * what it must.
     */
    let signInManagedBy: SsoManagedBy | null = null;

    try {
      signInManagedBy = (
        await SsoManagedSignIn.getStateFor({
          userId: userId,
          isMasterAdmin: isMasterAdmin,
        })
      ).managedBy;
    } catch (err) {
      logger.error(
        "Could not read whether SSO manages a person's sign-in, for the Admin Dashboard.",
      );
      logger.error(err);
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

    const isTwoFactorAuthEnabled: boolean = Boolean(user.enableTwoFactorAuth);

    const verifiedTwoFactorAuthMethodCount: number =
      await this.countVerifiedTwoFactorAuthMethods(userId);

    /*
     * Read separately from the method count above, and NOT added to it. See
     * the note on `deriveTwoFactorAuthStatus`: folding recovery codes into the
     * configured-method count would report an account whose authenticator is
     * gone as fully set up, and login would keep sending it to the challenge
     * screen until the last code was spent.
     */
    const unusedTwoFactorBackupCodeCount: number =
      await UserTwoFactorBackupCodeService.countUnusedForUser({
        userId: userId,
      });

    return {
      hasPassword: Boolean(user.password),
      isEmailVerified: Boolean(user.isEmailVerified),
      isTwoFactorAuthEnabled: isTwoFactorAuthEnabled,
      twoFactorAuthStatus: Service.deriveTwoFactorAuthStatus({
        isTwoFactorAuthEnabled: isTwoFactorAuthEnabled,
        verifiedMethodCount: verifiedTwoFactorAuthMethodCount,
      }),
      verifiedTwoFactorAuthMethodCount: verifiedTwoFactorAuthMethodCount,
      unusedTwoFactorBackupCodeCount: unusedTwoFactorBackupCodeCount,
      hasPendingPasswordResetLink: hasPendingPasswordResetLink,
      isMasterAdmin: isMasterAdmin,
      signInManagedBy: signInManagedBy,
    };
  }

  /**
   * How many authenticators this user has actually finished setting up, across
   * TOTP apps and security keys together.
   *
   * `isVerified: true` is mandatory on BOTH queries and the two tables reach
   * it differently, which is what makes leaving it off a real bug rather than
   * a redundancy. `UserTotpAuthService.onBeforeCreate` writes `isVerified =
   * false` and only the enrolment step flips it, so an abandoned QR scan
   * leaves a row behind forever; `UserWebAuthnService` creates its rows
   * already verified because the WebAuthn ceremony has no half-finished state.
   * Counting unverified rows would therefore report a user who has never once
   * typed a code as fully configured -- and that user is precisely the one an
   * operator is looking at the page to help.
   *
   * BACKUP CODES ARE NOT COUNTED HERE, for a related reason one step further
   * on. This number decides `deriveTwoFactorAuthStatus`, which decides whether
   * login shows the two factor CHALLENGE or sends the account through
   * enrolment. An account whose only remaining material was recovery codes
   * would, if they counted, be shown a challenge it cannot answer except by
   * spending a code -- one per sign-in, with no way to enrol a new
   * authenticator, until the last one is gone. Recovery codes are the way back
   * in to an account with a factor it cannot reach; they are not a factor.
   * `UserAuthenticationStatus.unusedTwoFactorBackupCodeCount` reports them
   * separately.
   */
  @CaptureSpan()
  public async countVerifiedTwoFactorAuthMethods(
    userId: ObjectID,
  ): Promise<number> {
    const verifiedTotpCount: PositiveNumber = await UserTotpAuthService.countBy(
      {
        query: {
          userId: userId,
          isVerified: true,
        },
        props: {
          isRoot: true,
        },
      },
    );

    const verifiedWebAuthnCount: PositiveNumber =
      await UserWebAuthnService.countBy({
        query: {
          userId: userId,
          isVerified: true,
        },
        props: {
          isRoot: true,
        },
      });

    return verifiedTotpCount.toNumber() + verifiedWebAuthnCount.toNumber();
  }

  /**
   * The requirement and the configuration folded into one value.
   *
   * Kept as a pure static so the table in Common/Types/TwoFactorAuthStatus.ts
   * exists in exactly one place in code as well as in prose. Note the middle
   * case: required with nothing set up is NOT an error state, it is the state
   * an admin deliberately creates and that login resolves through enrolment.
   */
  public static deriveTwoFactorAuthStatus(data: {
    isTwoFactorAuthEnabled: boolean;
    verifiedMethodCount: number;
  }): TwoFactorAuthStatus {
    return TwoFactorAuthSetupUtil.getStatus(data);
  }

  /**
   * Where one person stands on two factor authentication, for their own
   * profile (GET /user/two-factor-auth-status): the requirement and how many
   * second steps are set up behind it, counted as the checks below count
   * them. Throws NotFoundException for an account that does not exist.
   */
  @CaptureSpan()
  public async getTwoFactorAuthSetup(
    userId: ObjectID,
  ): Promise<TwoFactorAuthSetup> {
    const user: Model | null = await this.findOneBy({
      query: {
        _id: userId,
      },
      select: {
        _id: true,
        enableTwoFactorAuth: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!user) {
      throw new NotFoundException("User not found.");
    }

    const verifiedMethodCount: number =
      await this.countVerifiedTwoFactorAuthMethods(userId);

    return {
      status: TwoFactorAuthSetupUtil.getStatus({
        isTwoFactorAuthEnabled: Boolean(user.enableTwoFactorAuth),
        verifiedMethodCount: verifiedMethodCount,
      }),
      verifiedMethodCount: verifiedMethodCount,
    };
  }

  /**
   * Refuses a person turning two factor authentication on for themselves
   * (issue #9666, Types/TwoFactorAuthSetup) unless both hold:
   *
   *  - their sign-in is not managed by single sign-on (SsoManagedSignIn): a
   *    second step guards a password or an emailed link, and the server
   *    signs them in with neither;
   *  - something is set up for the second step to ask for: an authenticator
   *    app whose code was entered, a security key or a passkey. Turned on
   *    with nothing, the profile said "Enabled" while the account had no
   *    second factor at all, and the next sign-in with the password -
   *    anybody's - enrolled an app of that person's choosing.
   *
   * Asked in that order: an SSO-managed person is told why nothing here is
   * theirs to set, not to go and add an app first.
   *
   * A master admin requiring it of somebody (setTwoFactorAuthRequired) asks
   * neither: "required, nothing set up yet" is the state that sends that
   * person through enrolment at their next sign-in.
   */
  @CaptureSpan()
  public async assertTwoFactorAuthMayBeTurnedOn(
    userId: ObjectID,
  ): Promise<void> {
    await SsoManagedSignIn.assertMayChangeLocalSignIn(userId);

    const verifiedMethodCount: number =
      await this.countVerifiedTwoFactorAuthMethods(userId);

    if (verifiedMethodCount < 1) {
      throw new BadDataException(TWO_FACTOR_AUTH_NEEDS_A_METHOD_MESSAGE);
    }
  }

  /**
   * Refuses a delete that would take away the last second step an account
   * with two factor authentication on can be asked for (issue #9666,
   * TWO_FACTOR_AUTH_LAST_METHOD_MESSAGE): its authenticator apps
   * (UserTotpAuthService) or its security keys and passkeys
   * (UserWebAuthnService). `rows` are the rows the delete removes, read with
   * findRowsAndHoldDeleteToThem; only the verified ones count, so a setup
   * that was never finished can always go.
   *
   * Removing the last one used to leave "Enabled" on an account with nothing
   * behind it - the state this issue is about. Turning two factor
   * authentication off instead is the owner's own, confirmed decision, so
   * the delete is refused with what to do, rather than quietly turning it
   * off: replace the phone first, or turn it off first.
   *
   * Counted over the whole delete, per account: a delete of two rows that
   * leaves none is refused as a delete of the last one is. Only the caller's
   * own writes ask (their services skip a root delete): a master admin's
   * Reset two factor authentication removes everything on purpose, and the
   * enrolment at sign-in sweeps only unfinished rows.
   *
   * Two deletes of an account's last two second steps at the same moment can
   * each see the other's row still there. The account is then left as a
   * master admin's requirement leaves one - on, with nothing set up - which
   * the profile shows as Setup needed and the next sign-in with a password
   * walks through enrolment: never a lockout.
   */
  @CaptureSpan()
  public async assertTwoFactorAuthKeepsASecondStep(
    rowsRemoved: Array<{
      userId?: ObjectID | undefined;
      isVerified?: boolean | undefined;
    }>,
  ): Promise<void> {
    const verifiedRemovedByUser: Map<string, number> = new Map<
      string,
      number
    >();

    for (const row of rowsRemoved) {
      if (row.isVerified !== true || !row.userId) {
        continue;
      }

      const userId: string = row.userId.toString();

      verifiedRemovedByUser.set(
        userId,
        (verifiedRemovedByUser.get(userId) || 0) + 1,
      );
    }

    for (const [userId, verifiedRemoved] of verifiedRemovedByUser) {
      const user: Model | null = await this.findOneBy({
        query: {
          _id: userId,
        },
        select: {
          _id: true,
          enableTwoFactorAuth: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!user?.enableTwoFactorAuth) {
        continue;
      }

      const verifiedMethodCount: number =
        await this.countVerifiedTwoFactorAuthMethods(new ObjectID(userId));

      if (verifiedMethodCount - verifiedRemoved < 1) {
        throw new BadDataException(TWO_FACTOR_AUTH_LAST_METHOD_MESSAGE);
      }
    }
  }

  /**
   * Turn the two factor auth requirement on or off for one user, on a master
   * admin's say-so.
   *
   * This is a dedicated method rather than a `PUT /user/:id` carrying
   * `enableTwoFactorAuth`, for the same reason `setPassword` is: the generic
   * write would work -- a master admin bypasses the column's ACL -- but it
   * would skip the session revocation below, and nothing about the URL would
   * tell a reader that turning this flag on signs somebody out.
   *
   * Turning it ON revokes every session; turning it OFF does not. That
   * asymmetry is deliberate:
   *
   *  - `getUserMiddleware` validates an access token statelessly and never
   *    looks at `UserSession`, so a user who is already signed in keeps working
   *    for the rest of that token's ~15 minute life no matter what is written
   *    here. Revoking is what stops POST /refresh-token -- which DOES check
   *    `isRevoked` -- from renewing it indefinitely, so it bounds the window
   *    to one token lifetime instead of leaving it open forever. Without this
   *    call, "require two factor auth" would be a promise the product does not
   *    keep for anybody currently signed in;
   *  - relaxing a requirement creates no such window, and signing the whole
   *    company out to give them LESS to do would be gratuitous.
   *
   * Session revocation lives here rather than in `onUpdateSuccess` because
   * that hook only fires its revocation for updates carrying a password, and
   * `onBeforeUpdate` only populates the `carryForward` it reads for password
   * or email writes. An MFA-only write reaches neither.
   */
  @CaptureSpan()
  public async setTwoFactorAuthRequired(data: {
    userId: ObjectID;
    isRequired: boolean;
  }): Promise<void> {
    const user: Model | null = await this.findOneBy({
      query: {
        _id: data.userId,
      },
      select: {
        _id: true,
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
        enableTwoFactorAuth: data.isRequired,
      },
      props: {
        isRoot: true,
      },
    });

    if (data.isRequired) {
      /*
       * Kept short on purpose: `UserSession.revokedReason` is a ShortText
       * column, and an over-long reason would fail the write that is supposed
       * to be closing a security window (SessionEndCause's words are).
       */
      await UserSessionService.revokeAllSessionsByUserId(user.id!, {
        cause: SessionEndCause.TwoFactorRequired,
      });
    }

    logger.info(
      `Two factor auth requirement set to ${data.isRequired} by a master admin for user: ${user.id!.toString()}`,
    );
  }

  /**
   * Throw away everything this user has set up for two factor auth, so that
   * they start again from a fresh QR code.
   *
   * This is the lost-device fix. Somebody whose phone is gone cannot produce a
   * code, cannot therefore sign in, and -- because two factor auth is
   * self-service everywhere else in the product -- cannot reach the page that
   * would let them enrol a new one. Deleting their authenticators from the
   * outside is the only way back in.
   *
   * `enableTwoFactorAuth` is deliberately LEFT ALONE. "Reset" means clear the
   * configuration and keep the requirement: an account under a mandate lands
   * on a new QR code at its next sign-in, which is the whole point. Clearing
   * the flag as well would quietly downgrade the account's security while
   * answering a request that never asked for that, and an operator helping
   * with a lost phone would have no reason to notice.
   *
   * Unverified rows go too. They are abandoned enrolment attempts, and leaving
   * one behind would hand the user back the very QR code they could not
   * finish rather than a new one.
   */
  @CaptureSpan()
  public async resetTwoFactorAuth(data: { userId: ObjectID }): Promise<void> {
    const user: Model | null = await this.findOneBy({
      query: {
        _id: data.userId,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!user) {
      throw new NotFoundException("User not found.");
    }

    await UserTotpAuthService.deleteBy({
      query: {
        userId: user.id!,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    await UserWebAuthnService.deleteBy({
      query: {
        userId: user.id!,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    /*
     * The recovery codes go with the authenticators, and this is not
     * bookkeeping. A backup code signs somebody in on its own, so a reset that
     * cleared the TOTP secret but left a printed list of codes alive would
     * have revoked nothing that an attacker who took the phone -- and the
     * paper next to it -- still holds. "Reset two factor auth" has to mean all
     * of the second-factor material, not the part that is easiest to see.
     *
     * It also matters in the harmless direction: the user is about to be sent
     * through enrolment at their next sign-in, and codes minted against an
     * authenticator that no longer exists are dead weight nobody would think
     * to clear.
     */
    await UserTwoFactorBackupCodeService.deleteAllForUser({
      userId: user.id!,
    });

    /*
     * Ordered after the deletes, not before. A session that survives a reset
     * is a session that never has to prove the second factor again, which
     * would make "reset because the device was stolen" do nothing about the
     * person holding the stolen device.
     */
    await UserSessionService.revokeAllSessionsByUserId(user.id!, {
      cause: SessionEndCause.TwoFactorReset,
    });

    /*
     * And the wrong codes entered against the authenticators that are gone:
     * a reset is how an administrator lets somebody in again, so it must not
     * leave them waiting behind codes for an app they no longer have.
     */
    await TwoFactorWrongCodes.forget(user.id!);

    logger.info(
      `Two factor auth reset by a master admin for user: ${user.id!.toString()}`,
    );
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
   *  - any outstanding reset link or sign-in link ends in the SAME statement, by
   *    `onUpdatePermitted`, as it does for any update that carries a password. A
   *    link mailed before the admin intervened must not still be able to change
   *    the password afterwards;
   *  - session revocation and the "Password Changed." email are NOT done here.
   *    `onUpdateSuccess` already does both for any update that carries a
   *    password, and doing it again would send the user two identical emails.
   */
  @CaptureSpan()
  public async setPassword(data: {
    userId: ObjectID;
    password: string;
  }): Promise<void> {
    // Before the user is looked up: a weak password is refused for anybody.
    NewPasswordRule.assertMet(data.password);

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
   * Mint a fresh password link for a user and email it to them.
   *
   * Which link depends on the account, never on the caller (Types/Accounts/
   * SetPasswordLink): an account with a password gets the reset link, for a
   * day, exactly as the public /forgot-password endpoint makes it; one with
   * no password yet - a user a master admin has just created (Users > Create
   * User, #9139) - gets a link to set its first one, for
   * SET_PASSWORD_LINK_EXPIRY_DAYS. Both are the same token in the same
   * column, redeemed by the same POST /identity/reset-password, so there is
   * no second code path that can set a password. Identity's /forgot-password
   * keeps its own copy of the minting for an account with a password,
   * because it differs around the edges (it finds the user by a typed email
   * and answers success without waiting for the mail); if either changes the
   * token scheme, both must move together. For an account with no password
   * yet it calls this, with `requestOrigin` (#9260).
   *
   * `requestOrigin` is set when the account's owner asked for the link
   * themselves, from Forgot password: the email then says a request was
   * made, and when and from where, as a reset email does - not that an
   * administrator created the account.
   *
   * Only the SHA-256 of the token is stored. The token itself exists just long
   * enough to be put in the email, so a leaked database row cannot be replayed
   * as a link. It is hashed unsalted on purpose: /reset-password looks the
   * row up BY that hash, which a per-row salt would make impossible, and a
   * UUID from the CSPRNG has enough entropy that there is nothing to guess.
   */
  @CaptureSpan()
  public async sendPasswordResetLink(data: {
    userId: ObjectID;
    requestOrigin?: RequestOriginEmailVars | undefined;
  }): Promise<Email> {
    const user: Model = await this.findUserForPasswordLink(data.userId);

    /*
     * `email` is a NOT NULL column, so this is unreachable through the
     * database -- it is here because the alternative is a non-null assertion
     * on the address we are about to mail a password link to, and being
     * wrong about that would send the link somewhere unintended.
     */
    if (!user.email) {
      throw new BadDataException(
        "This user has no email address, so a password link cannot be sent to them.",
      );
    }

    const isSettingFirstPassword: boolean = !user.password;

    /*
     * A server with no email set up cannot send the link, so none is made:
     * the master admin is told so in words they can act on, rather than the
     * mail service's "ask your server's admin", which is them.
     */
    if (await ServerSendingStatus.isEmailKnownNotSetUp()) {
      throw new BadDataException(
        isSettingFirstPassword
          ? SET_PASSWORD_LINK_CANNOT_BE_EMAILED_MESSAGE
          : PASSWORD_RESET_LINK_CANNOT_BE_EMAILED_MESSAGE,
      );
    }

    const link: string = await this.mintPasswordLink({
      userId: data.userId,
      isSettingFirstPassword: isSettingFirstPassword,
    });

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    /*
     * Awaited, unlike most MailService calls in this file. The caller is a
     * human who just pressed "send password reset link", or created a user,
     * and needs to be told if the instance cannot send mail -- reporting
     * success and dropping the email would leave them waiting for a link
     * that is never coming.
     */
    try {
      const homeURL: string = new URL(httpProtocol, host).toString();

      const mailResponse: HTTPResponse<EmptyResponseData> =
        await MailService.sendMail({
          toEmail: user.email,
          isSubjectLiteral: true,
          ...(isSettingFirstPassword
            ? {
                subject: `Set Your Password for ${ProductBrandingText.getProductName()}`,
                templateType: EmailTemplateType.SetPassword,
                vars: {
                  homeURL: homeURL,
                  tokenVerifyUrl: link,
                  email: user.email.toString(),
                  expiresInDays: String(SET_PASSWORD_LINK_EXPIRY_DAYS),
                  ...(data.requestOrigin || {}),
                },
              }
            : {
                subject: `Password Reset Request for ${ProductBrandingText.getProductName()}`,
                templateType: EmailTemplateType.ForgotPassword,
                vars: {
                  homeURL: homeURL,
                  tokenVerifyUrl: link,
                  ...(data.requestOrigin || {}),
                },
              }),
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
       * The mail service has already recorded it where #9246 put it: a
       * refused recipient in Settings > Emails' list of refused addresses,
       * which raises no banner; a server-wide failure in the "Email is
       * failing" banner.
       */
      if (mailResponse instanceof HTTPErrorResponse) {
        throw new BadDataException(
          isSettingFirstPassword
            ? `The email with a link to set their password was not sent. ${mailResponse.message}`
            : `The password reset email was not sent. ${mailResponse.message}`,
        );
      }
    } catch (err) {
      /*
       * The token was written before the send, so a failed send would
       * otherwise leave a live link on the row that nobody ever received --
       * and the Authentication page would then report "reset link pending"
       * directly underneath the error saying it could not be sent. Take it
       * back off so the record matches what the operator was told.
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
          `Failed to clear the unsent password link for user ${data.userId.toString()}; it will expire on its own.`,
        );
        logger.error(clearError);
      });

      throw err;
    }

    logger.info(
      `${isSettingFirstPassword ? "Set-password" : "Password reset"} link sent ${data.requestOrigin ? "from Forgot password" : "by a master admin"} to user: ${data.userId.toString()}`,
    );

    // Returned so the caller can tell the operator where the link went.
    return user.email;
  }

  /**
   * A set-password link for a master admin to copy and send the user
   * themselves, when the email with it could not be sent (#9139): the same
   * link the email carries, minted the same way, and returned instead of
   * mailed. It replaces any link sent before, as a new email would.
   *
   * Only for an account with no password yet. For one in use it would be a
   * quiet way into the account - its owner would hear of it only once the
   * link was spent - so the master admin is told to send a reset link,
   * which goes to the owner's own mailbox.
   */
  @CaptureSpan()
  public async getSetPasswordLink(data: { userId: ObjectID }): Promise<{
    link: string;
    email: Email;
  }> {
    const user: Model = await this.findUserForPasswordLink(data.userId);

    if (user.password) {
      throw new BadDataException(SET_PASSWORD_LINK_HAS_PASSWORD_MESSAGE);
    }

    if (!user.email) {
      throw new BadDataException(
        "This user has no email address, so a password link cannot be made for them.",
      );
    }

    const link: string = await this.mintPasswordLink({
      userId: data.userId,
      isSettingFirstPassword: true,
    });

    logger.info(
      `Set-password link made for a master admin to send to user: ${data.userId.toString()}`,
    );

    return { link: link, email: user.email };
  }

  private async findUserForPasswordLink(userId: ObjectID): Promise<Model> {
    const user: Model | null = await this.findOneBy({
      query: {
        _id: userId,
      },
      select: {
        _id: true,
        email: true,
        password: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!user) {
      throw new NotFoundException("User not found.");
    }

    return user;
  }

  /*
   * Writes a fresh token's hash on the user, replacing any link sent before,
   * and returns the link that carries the token itself.
   */
  private async mintPasswordLink(data: {
    userId: ObjectID;
    isSettingFirstPassword: boolean;
  }): Promise<string> {
    // A bearer secret: from the CSPRNG, never ObjectID's non-crypto fallback.
    const token: string = crypto.randomUUID();

    const hashedToken: string = await HashedString.hashValue(
      token,
      EncryptionSecret,
    );

    await this.updateOneById({
      id: data.userId,
      data: {
        resetPasswordToken: hashedToken,
        resetPasswordExpires: data.isSettingFirstPassword
          ? OneUptimeDate.getSomeDaysAfter(SET_PASSWORD_LINK_EXPIRY_DAYS)
          : OneUptimeDate.getOneDayAfter(),
      },
      props: {
        isRoot: true,
      },
    });

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    return new URL(
      httpProtocol,
      host,
      new Route(AccountsRoute.toString()).addRoute(
        (data.isSettingFirstPassword
          ? SET_PASSWORD_PAGE_ROUTE
          : RESET_PASSWORD_PAGE_ROUTE) +
          "/" +
          token,
      ),
    ).toString();
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
