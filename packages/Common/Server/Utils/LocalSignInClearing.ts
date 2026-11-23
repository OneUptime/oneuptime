import AuditLogService from "../Services/AuditLogService";
import UserService from "../Services/UserService";
import UserSessionService from "../Services/UserSessionService";
import UserTotpAuthService from "../Services/UserTotpAuthService";
import UserTwoFactorBackupCodeService from "../Services/UserTwoFactorBackupCodeService";
import UserWebAuthnService from "../Services/UserWebAuthnService";
import QueryHelper from "../Types/Database/QueryHelper";
import logger from "./Logger";
import SignInSettingsClearedEmail, {
  SignInSettingsClearedEmailEvent,
} from "./SignInSettingsClearedEmail";
import SsoRequiredSignIn from "./SsoRequiredSignIn";
import TwoFactorWrongCodes from "./TwoFactorWrongCodes";
import User from "../../Models/DatabaseModels/User";
import { SignInSettingsClearedAuditEvent } from "../../Types/AuditLog/AuditLogSignInSettingsCleared";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import {
  CLEAR_MASTER_ADMIN_SIGN_IN_NOT_CONFIRMED_MESSAGE,
  CLEAR_OWN_SIGN_IN_MESSAGE,
  CLEAR_SAVED_SIGN_IN_SETTINGS_NEEDS_SSO_REQUIRED_MESSAGE,
  ClearLocalSignInAnswer,
  LocalSignInSettings,
} from "../../Types/SSO/LocalSignInClearing";
import { SignInSettingsClearedBy } from "../../Types/SSO/SignInSettingsClearedEmail";
import { SelectQueryBuilder } from "typeorm";

/*
 * CLEARING THE SIGN-IN SETTINGS PEOPLE SAVED IN ONEUPTIME (issue #9762).
 *
 * What is cleared, who for, and why are in Common/Types/SSO/
 * LocalSignInClearing.ts. In short: a person's password (with any reset or
 * sign-in link sent), passkeys and security keys, authenticator apps,
 * backup codes and two-factor authentication go, and their sessions not
 * signed in with single sign-on end. For one person at a master admin's
 * say-so - never the master admin's own account, and a master admin's only
 * when asked for that person by name - or for everyone the server's SSO
 * requirement covers, never a master admin.
 *
 * Every write is OneUptime's own (root), past the per-person rules that
 * guard these settings in the profile - the last-second-step guard, the
 * owner-only switch - since clearing is the master admin's decision, made
 * after a confirmation that says it cannot be undone. Each person cleared
 * is recorded in the audit log of their projects, as the master admin's
 * Update of them (AuditLogService.recordSignInSettingsCleared), and is
 * emailed what was removed and how they sign in now (#9818,
 * SignInSettingsClearedEmail) - by a job a worker sends (#9991), so a clear
 * never waits for the mail service, never fails with it, and a restart
 * loses no email.
 *
 * The clear of everyone works through the people who have anything, a batch
 * at a time, so a server of thousands of people is a few statements a
 * batch. Each batch is read again with master admins left out, and the
 * write that clears their passwords leaves master admins out again: a
 * master admin made one in the middle of a clear keeps their password, and
 * their second steps unless the batch they were in was already being
 * cleared.
 */

// How many people one batch of the clear of everyone clears.
export const CLEAR_BATCH_SIZE: number = 500;

/*
 * How many batches one clear of everyone runs at most: CLEAR_BATCH_SIZE
 * times this many people. A server with more clears again from the card.
 */
export const MAX_CLEAR_BATCHES: number = 1000;

/*
 * The people the server's SSO requirement covers - not master admins, not
 * deleted - who still have anything saved to sign in with: a password, two
 * -factor authentication on, an authenticator app, a passkey or security
 * key, a backup code not spent, or a password reset link that still works.
 */
const COVERED_PEOPLE_WITH_SETTINGS_SQL: string = `"person"."isMasterAdmin" = false
  AND "person"."deletedAt" IS NULL
  AND (
    "person"."password" IS NOT NULL
    OR "person"."enableTwoFactorAuth" = true
    OR ("person"."resetPasswordToken" IS NOT NULL AND "person"."resetPasswordExpires" > NOW())
    OR EXISTS (SELECT 1 FROM "UserTotpAuth" "app" WHERE "app"."userId" = "person"."_id" AND "app"."deletedAt" IS NULL)
    OR EXISTS (SELECT 1 FROM "UserWebAuthn" "key" WHERE "key"."userId" = "person"."_id" AND "key"."deletedAt" IS NULL)
    OR EXISTS (SELECT 1 FROM "UserTwoFactorBackupCode" "code" WHERE "code"."userId" = "person"."_id" AND "code"."usedAt" IS NULL AND "code"."deletedAt" IS NULL)
  )`;

/*
 * Whether a password reset link still works, read as the count reads it
 * (COVERED_PEOPLE_WITH_SETTINGS_SQL): a token stored, and an expiry still to
 * come. A link that ran out signs nobody in, so a clear that removes it
 * removes no way in, and the count never counted it.
 */
export const isPasswordResetLinkWorking: (data: {
  resetPasswordToken: string | null | undefined;
  resetPasswordExpires: Date | null | undefined;
  now: Date;
}) => boolean = (data: {
  resetPasswordToken: string | null | undefined;
  resetPasswordExpires: Date | null | undefined;
  now: Date;
}): boolean => {
  if (
    data.resetPasswordToken === null ||
    data.resetPasswordToken === undefined
  ) {
    return false;
  }

  if (!data.resetPasswordExpires) {
    return false;
  }

  const expiresAt: number = new Date(data.resetPasswordExpires).getTime();

  return Number.isFinite(expiresAt) && expiresAt > data.now.getTime();
};

export default class LocalSignInClearing {
  /*
   * What one person has saved to sign in with: each thing the count of
   * people with settings saved counts them for, so a clear never reports
   * less than it counted - a working password reset link included (#9992).
   */
  public static async readSettings(
    userId: ObjectID,
  ): Promise<LocalSignInSettings> {
    const user: User | null = await UserService.findOneById({
      id: userId,
      select: {
        _id: true,
        password: true,
        resetPasswordToken: true,
        resetPasswordExpires: true,
        enableTwoFactorAuth: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!user) {
      throw new NotFoundException("User not found.");
    }

    const [authenticatorApps, keys, backupCodeCount] = await Promise.all([
      UserTotpAuthService.countBy({
        query: { userId: userId },
        props: { isRoot: true },
      }),
      UserWebAuthnService.countBy({
        query: { userId: userId },
        props: { isRoot: true },
      }),
      UserTwoFactorBackupCodeService.countUnusedForUser({ userId: userId }),
    ]);

    return {
      hasPassword: Boolean(user.password),
      hasPasswordResetLink: isPasswordResetLinkWorking({
        resetPasswordToken: user.resetPasswordToken,
        resetPasswordExpires: user.resetPasswordExpires,
        now: OneUptimeDate.getCurrentDate(),
      }),
      isTwoFactorAuthEnabled: user.enableTwoFactorAuth === true,
      authenticatorAppCount: (authenticatorApps as PositiveNumber).toNumber(),
      passkeyAndSecurityKeyCount: (keys as PositiveNumber).toNumber(),
      backupCodeCount: backupCodeCount,
    };
  }

  /*
   * Clears one person's sign-in settings, for the master admin
   * `clearedByUserId`. Refused for the master admin's own account, and for
   * another master admin unless `isMasterAdminConfirmed` says the master
   * admin asked for exactly that. Throws NotFoundException for an account
   * that does not exist. Answers what was removed, and how many sessions
   * ended.
   */
  public static async clearForPerson(data: {
    userId: ObjectID;
    clearedByUserId: ObjectID;
    isMasterAdminConfirmed: boolean;
  }): Promise<ClearLocalSignInAnswer> {
    /*
     * However the id is spelled: an id is a UUID, which Postgres compares
     * without regard to case, so "ABC" in the path is the same account as
     * the session's "abc".
     */
    if (
      data.userId.toString().toLowerCase() ===
      data.clearedByUserId.toString().toLowerCase()
    ) {
      throw new BadDataException(CLEAR_OWN_SIGN_IN_MESSAGE);
    }

    const user: User | null = await UserService.findOneById({
      id: data.userId,
      select: {
        _id: true,
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

    if (isMasterAdmin && !data.isMasterAdminConfirmed) {
      throw new BadDataException(
        CLEAR_MASTER_ADMIN_SIGN_IN_NOT_CONFIRMED_MESSAGE,
      );
    }

    const cleared: LocalSignInSettings = await LocalSignInClearing.readSettings(
      data.userId,
    );

    const sessionsEnded: number = (
      await LocalSignInClearing.clearPeople({
        userIds: [data.userId],
        // Asked for this person by name: a master admin's goes too.
        isMasterAdminIncluded: isMasterAdmin,
      })
    ).sessionsEnded;

    await AuditLogService.recordSignInSettingsCleared([
      {
        userId: data.userId,
        clearedByUserId: data.clearedByUserId,
        cleared: cleared,
      },
    ]);

    /*
     * The person is told, at their own address (#9818), by a job a worker
     * sends (#9991): queued in milliseconds, so a restart loses no email,
     * and the clear, done and recorded, never waits for the mail service or
     * fails with it. Nothing removed, nothing sent.
     */
    await SignInSettingsClearedEmail.notify([
      {
        userId: data.userId,
        cleared: cleared,
        clearedBy: SignInSettingsClearedBy.ServerAdmin,
      },
    ]);

    logger.info(
      `Sign-in settings cleared by master admin ${data.clearedByUserId.toString()} for user ${data.userId.toString()}${isMasterAdmin ? " (a master admin)" : ""}: ${sessionsEnded} session(s) ended.`,
    );

    return { cleared: cleared, sessionsEnded: sessionsEnded };
  }

  /*
   * How many people the server's SSO requirement covers - everyone but
   * master admins - still have anything saved to sign in with.
   */
  public static async countPeopleCoveredBySsoRequirement(): Promise<number> {
    const row: { peopleCount?: unknown } | undefined =
      await LocalSignInClearing.getCoveredPeopleQuery()
        .select("COUNT(*)", "peopleCount")
        .getRawOne();

    return Number(row?.peopleCount || 0);
  }

  /*
   * Clears the sign-in settings of everyone the server's SSO requirement
   * covers, for the master admin `clearedByUserId`: refused while the
   * server does not require SSO, when these settings still sign people in.
   * Never a master admin's. Answers how many people it cleared.
   */
  public static async clearForEveryoneCoveredBySsoRequirement(data: {
    clearedByUserId: ObjectID;
  }): Promise<number> {
    if (!(await SsoRequiredSignIn.isSsoRequired())) {
      throw new BadDataException(
        CLEAR_SAVED_SIGN_IN_SETTINGS_NEEDS_SSO_REQUIRED_MESSAGE,
      );
    }

    let peopleCleared: number = 0;
    let sessionsEnded: number = 0;
    const seen: Set<string> = new Set<string>();
    // Each batch's emails, queued while the next batch is cleared.
    const emailsQueued: Array<Promise<void>> = [];

    for (let batch: number = 0; batch < MAX_CLEAR_BATCHES; batch++) {
      const rows: Array<{ userId?: unknown }> =
        await LocalSignInClearing.getCoveredPeopleQuery()
          .select('"person"."_id"', "userId")
          .orderBy('"person"."_id"')
          .limit(CLEAR_BATCH_SIZE)
          .getRawMany();

      const userIds: Array<ObjectID> = rows
        .map((row: { userId?: unknown }): string => {
          return String(row.userId || "");
        })
        .filter((userId: string): boolean => {
          return ObjectID.isValidUUID(userId) && !seen.has(userId);
        })
        .map((userId: string): ObjectID => {
          seen.add(userId);
          return new ObjectID(userId);
        });

      /*
       * Nobody left - or only people a batch before already cleared, whose
       * settings something keeps putting back: never the same people twice.
       */
      if (userIds.length === 0) {
        break;
      }

      // Read before they are cleared, for the audit log.
      const settingsByUser: Map<string, LocalSignInSettings> = new Map();

      for (const userId of userIds) {
        settingsByUser.set(
          userId.toString(),
          await LocalSignInClearing.readSettings(userId),
        );
      }

      const result: { clearedUserIds: Array<ObjectID>; sessionsEnded: number } =
        await LocalSignInClearing.clearPeople({
          userIds: userIds,
          isMasterAdminIncluded: false,
        });

      sessionsEnded += result.sessionsEnded;

      // Only the people it cleared: a master admin made one since is not.
      await AuditLogService.recordSignInSettingsCleared(
        result.clearedUserIds.map(
          (userId: ObjectID): SignInSettingsClearedAuditEvent => {
            return {
              userId: userId,
              clearedByUserId: data.clearedByUserId,
              cleared: settingsByUser.get(userId.toString())!,
            };
          },
        ),
      );

      /*
       * Each of them is told (#9818), and only them: the batch's emails are
       * queued as jobs (#9991) while the next batch is cleared, so the
       * clear of everyone never waits for the mail service, and a restart
       * in the middle of it loses none of the emails of a batch cleared.
       */
      emailsQueued.push(
        SignInSettingsClearedEmail.notify(
          result.clearedUserIds.map(
            (userId: ObjectID): SignInSettingsClearedEmailEvent => {
              return {
                userId: userId,
                cleared: settingsByUser.get(userId.toString())!,
                clearedBy: SignInSettingsClearedBy.ServerAdmin,
              };
            },
          ),
        ),
      );

      peopleCleared += result.clearedUserIds.length;

      if (rows.length < CLEAR_BATCH_SIZE) {
        break;
      }
    }

    // Queued, each within EMAIL_ENQUEUE_TIMEOUT_IN_MS: never a failure.
    await Promise.all(emailsQueued);

    logger.info(
      `A master admin (${data.clearedByUserId.toString()}) cleared the sign-in settings of everyone the SSO requirement covers: ${peopleCleared} people, ${sessionsEnded} session(s) ended.`,
    );

    return peopleCleared;
  }

  /*
   * Which of these people - never a master admin, never a deleted account -
   * still have anything saved to sign in with, by the same query the clear
   * of everyone reads (an owner's clear of their organization's people,
   * ProjectSignInClearing, #9820). Read a batch at a time.
   */
  public static async findPeopleWithSettings(
    userIds: Array<ObjectID>,
  ): Promise<Array<ObjectID>> {
    const found: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (let start: number = 0; start < userIds.length; start += LIMIT_MAX) {
      const batch: Array<string> = userIds
        .slice(start, start + LIMIT_MAX)
        .map((userId: ObjectID): string => {
          return userId.toString();
        });

      const rows: Array<{ userId?: unknown }> =
        await LocalSignInClearing.getCoveredPeopleQuery()
          .andWhere('"person"."_id" IN (:...userIds)', { userIds: batch })
          .select('"person"."_id"', "userId")
          .getRawMany();

      for (const row of rows) {
        const userId: string = String(row.userId || "");

        if (ObjectID.isValidUUID(userId)) {
          found.set(userId.toLowerCase(), new ObjectID(userId));
        }
      }
    }

    return Array.from(found.values());
  }

  // The covered people who still have settings, as a query over "person".
  private static getCoveredPeopleQuery(): SelectQueryBuilder<User> {
    return UserService.getQueryBuilder("person").where(
      COVERED_PEOPLE_WITH_SETTINGS_SQL,
    );
  }

  /*
   * Clears these people's settings, as root, and ends their sessions not
   * signed in with SSO: who it cleared, and how many sessions ended. Their
   * passwords and links go in one write, which leaves master admins out
   * unless `isMasterAdminIncluded`; their second steps and backup codes go
   * with them. The callers decide who: a master admin's clears here, and an
   * owner's clear of their organization's people (ProjectSignInClearing),
   * which never includes a master admin.
   */
  public static async clearPeople(data: {
    userIds: Array<ObjectID>;
    isMasterAdminIncluded: boolean;
  }): Promise<{ clearedUserIds: Array<ObjectID>; sessionsEnded: number }> {
    /*
     * The clear of everyone never reaches a master admin: the people are
     * read again here with master admins left out, so somebody made one
     * since the batch was read keeps everything.
     */
    const userIds: Array<ObjectID> = data.isMasterAdminIncluded
      ? data.userIds
      : (
          await UserService.findBy({
            query: {
              _id: QueryHelper.any(data.userIds),
              isMasterAdmin: false,
            },
            select: { _id: true },
            limit: data.userIds.length,
            skip: 0,
            props: { isRoot: true },
          })
        )
          .map((user: User): ObjectID | undefined => {
            return user.id || undefined;
          })
          .filter((userId: ObjectID | undefined): boolean => {
            return Boolean(userId);
          })
          .map((userId: ObjectID | undefined): ObjectID => {
            return userId!;
          });

    if (userIds.length === 0) {
      return { clearedUserIds: [], sessionsEnded: 0 };
    }

    /*
     * The password and the links that stand in for it or replace it, and
     * the switch: with nothing behind it, two-factor authentication would
     * only send them through setting up a second step again. A password
     * written as nothing is no new password, so nobody is mailed "Password
     * changed" and no session ends here (UserService.onUpdateSuccess).
     */
    await UserService.updateBy({
      query: {
        _id: QueryHelper.any(userIds),
        ...(data.isMasterAdminIncluded ? {} : { isMasterAdmin: false }),
      },
      data: {
        password: null!,
        passwordSalt: null!,
        resetPasswordToken: null!,
        resetPasswordExpires: null!,
        magicLinkToken: null!,
        magicLinkExpires: null!,
        enableTwoFactorAuth: false,
      },
      limit: userIds.length,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    // Every authenticator app, set up or not, every key and every code.
    await UserTotpAuthService.deleteBy({
      query: { userId: QueryHelper.any(userIds) },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    await UserWebAuthnService.deleteBy({
      query: { userId: QueryHelper.any(userIds) },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    await UserTwoFactorBackupCodeService.deleteBy({
      query: { userId: QueryHelper.any(userIds) },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    // The wrong codes counted against second steps that are gone.
    for (const userId of userIds) {
      await TwoFactorWrongCodes.forget(userId);
    }

    return {
      clearedUserIds: userIds,
      sessionsEnded:
        await UserSessionService.endSessionsOfPeopleSignedInWithoutSso(userIds),
    };
  }
}
