import Redis, { ClientType } from "../../Infrastructure/Redis";
import IdentityRateLimit, {
  IdentityRateLimitBucket,
  IdentityRateLimitDecision,
  IdentityRateLimitOutcome,
} from "../../Middleware/IdentityRateLimit";
import UserService from "../../Services/UserService";
import UserSessionService from "../../Services/UserSessionService";
import UserTotpAuthService from "../../Services/UserTotpAuthService";
import UserTwoFactorBackupCodeService from "../../Services/UserTwoFactorBackupCodeService";
import UserWebAuthnService from "../../Services/UserWebAuthnService";
import logger from "../Logger";
import TotpAuth from "../TotpAuth";
import User from "../../../Models/DatabaseModels/User";
import UserSession from "../../../Models/DatabaseModels/UserSession";
import UserTotpAuth from "../../../Models/DatabaseModels/UserTotpAuth";
import UserWebAuthn from "../../../Models/DatabaseModels/UserWebAuthn";
import {
  REAUTHENTICATION_FAILURES_BEFORE_SIGN_OUT,
  REAUTHENTICATION_MESSAGES,
  REAUTHENTICATION_WINDOW_IN_MINUTES,
  ReauthenticationMethods,
  ReauthenticationStatus,
  ReauthenticationWebAuthnKind,
} from "../../../Types/Accounts/Reauthentication";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import DatabaseNotConnectedException from "../../../Types/Exception/DatabaseNotConnectedException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ReauthenticationRequiredException from "../../../Types/Exception/ReauthenticationRequiredException";
import ServiceUnavailableException from "../../../Types/Exception/ServiceUnavailableException";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
import ObjectID from "../../../Types/ObjectID";
import RequestOrigin from "../../../Types/RequestOrigin";
import { SessionEndCause } from "../../../Types/UserSession/SessionEndCause";

/*
 * CONFIRM IT'S YOU BEFORE YOU CHANGE HOW YOU SIGN IN (#10155).
 *
 * Types/Accounts/Reauthentication says what this guards and what confirms
 * it; this is where the server holds both. Three things live here:
 *
 *   - getMethods: what an account confirms it's its owner's with, from what
 *     it signs in with now - its password and the second step two-factor
 *     authentication asks for, a passkey, or neither (single sign-on and
 *     the other sign-ins without a password);
 *   - confirm: a confirmation, checked as a sign-in checks it and counted
 *     for its session. Rate limited per person and client
 *     (IdentityRateLimit's Reauthentication bucket), and
 *     REAUTHENTICATION_FAILURES_BEFORE_SIGN_OUT wrong attempts in one
 *     session end that session. The account's sign-in is never touched -
 *     no wrong-code count of the sign-in's (TwoFactorWrongCodes), no
 *     waiting, no lock - so nobody can lock its owner out from a session
 *     of their own: the worst they can do is lose it;
 *   - assertConfirmed: the check every path that changes how an account
 *     signs in asks first, before it writes, counts or spends anything
 *     (UserService, the authenticator app, key and backup code routes and
 *     services). A root write - the server's own: a reset link, the link
 *     that confirms an address, single sign-on, SCIM, a master admin's
 *     Admin Dashboard routes - is not asked.
 *
 * A confirmation is kept in Valkey, for its session, for
 * REAUTHENTICATION_WINDOW_IN_MINUTES: never in the access token, which
 * the browser holds, and never for the account, which another session of
 * somebody else's would share. An account with neither a password nor a
 * passkey has nothing to confirm in place: its session's own sign-in in
 * the window is its confirmation, read from the session's row.
 *
 * FAILS CLOSED: with Valkey unreachable nothing is confirmed, and a change
 * that needs a confirmation is refused with what to do (try again in a
 * minute) - except the sign-in of an account that confirms by signing in,
 * which the database answers.
 */

// What a confirmation is checked with, as the request's body names it.
export interface ReauthenticationProof {
  password?: string | undefined;
  code?: string | undefined;
  backupCode?: string | undefined;
  securityKeyCredential?: unknown;
  passkeyCredential?: unknown;
}

// The session a change is asked for in, and its person.
export interface ReauthenticationSession {
  userId: ObjectID;
  sessionId: ObjectID;
}

// Where a session's confirmation is kept, and how many of its attempts failed.
const CONFIRMED_KEY_PREFIX: string = "reauthentication:confirmed:";
const ATTEMPTS_KEY_PREFIX: string = "reauthentication:attempts:";

/*
 * How long a session's attempts are counted for: as long as a session can
 * go unused before it ends (its refresh token's 30 days), so its
 * REAUTHENTICATION_FAILURES_BEFORE_SIGN_OUT are for its whole life, and a
 * confirmation forgets them.
 */
const ATTEMPTS_KEPT_FOR_SECONDS: number = 30 * 24 * 60 * 60;

// One more attempt, and the count: the expiry is set by the first only.
const COUNT_ATTEMPT_SCRIPT: string =
  "local count = redis.call('INCR', KEYS[1]); " +
  "if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; " +
  "return count";

// What a confirmation keeps.
interface KeptConfirmation {
  userId: string;
  confirmedAt: number;
}

// How a proof is checked once its shape is right.
enum ProofKind {
  Passkey = "Passkey",
  Password = "Password",
}

export default class Reauthentication {
  public static readonly WINDOW_IN_MS: number =
    REAUTHENTICATION_WINDOW_IN_MINUTES * 60 * 1000;

  /*
   * The session a request was made with and its person (props.sessionId,
   * CommonAPI), or a refusal: an API key, an MCP client and a workflow
   * have no session, and change nobody's sign-in.
   */
  public static getSessionOf(
    props: DatabaseCommonInteractionProps,
  ): ReauthenticationSession {
    if (!props.userId || !props.sessionId) {
      throw new BadDataException(REAUTHENTICATION_MESSAGES.notFromASession);
    }

    return { userId: props.userId, sessionId: props.sessionId };
  }

  /*
   * What an account confirms it's its owner's with, read now:
   *
   *   - its password, and while two-factor authentication is on and set up
   *     (a verified authenticator app, security key or passkey behind it),
   *     its second step too - one that is on with nothing set up asks for
   *     none, as its sign-in walks it through setting one up;
   *   - a passkey: a verified key not registered as a second step only;
   *   - neither: a new sign-in.
   */
  public static async getMethods(
    userId: ObjectID,
  ): Promise<ReauthenticationMethods> {
    const user: User | null = await UserService.findOneById({
      id: userId,
      select: {
        _id: true,
        password: true,
        enableTwoFactorAuth: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!user) {
      throw new NotFoundException("User not found.");
    }

    const [authenticatorApps, keys]: [
      Array<UserTotpAuth>,
      Array<UserWebAuthn>,
    ] = await Promise.all([
      UserTotpAuthService.findBy({
        query: { userId: userId, isVerified: true },
        select: { _id: true },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      }),
      UserWebAuthnService.findBy({
        query: { userId: userId, isVerified: true },
        select: { _id: true, isPasskey: true },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      }),
    ]);

    const hasPassword: boolean = Boolean(user.password);
    const hasPasskey: boolean = keys.some((key: UserWebAuthn): boolean => {
      return key.isPasskey !== false;
    });
    const asksForASecondStep: boolean =
      hasPassword &&
      user.enableTwoFactorAuth === true &&
      authenticatorApps.length + keys.length > 0;

    const unusedBackupCodeCount: number = asksForASecondStep
      ? await UserTwoFactorBackupCodeService.countUnusedForUser({
          userId: userId,
        })
      : 0;

    return {
      password: hasPassword,
      secondStep: asksForASecondStep
        ? {
            authenticatorApp: authenticatorApps.length > 0,
            securityKey: keys.length > 0,
            backupCode: unusedBackupCodeCount > 0,
          }
        : null,
      passkey: hasPasskey,
      signInAgain: !hasPassword && !hasPasskey,
    };
  }

  // Where the session stands, for the prompt: what it confirms with, and until when it is confirmed.
  public static async getStatus(
    session: ReauthenticationSession,
  ): Promise<ReauthenticationStatus> {
    const methods: ReauthenticationMethods = await Reauthentication.getMethods(
      session.userId,
    );

    const confirmedUntil: Date | null =
      await Reauthentication.getConfirmedUntil(session, methods);

    return {
      isConfirmed: confirmedUntil !== null,
      confirmedUntil: confirmedUntil,
      windowInMinutes: REAUTHENTICATION_WINDOW_IN_MINUTES,
      methods: methods,
    };
  }

  /*
   * THE CHECK. Refuses a change to how the caller signs in unless the
   * session it comes from has confirmed it's its person's in the window
   * (ReauthenticationRequiredException, whose code a client acts on).
   * Asked by every path that changes it, before anything is written,
   * counted or spent, so the same request can be sent again once the
   * session has confirmed. A root write is the server's own, and is not
   * asked.
   */
  public static async assertConfirmed(
    props: DatabaseCommonInteractionProps,
  ): Promise<void> {
    if (props.isRoot) {
      return;
    }

    const session: ReauthenticationSession =
      Reauthentication.getSessionOf(props);

    if ((await Reauthentication.getConfirmedUntil(session)) === null) {
      throw new ReauthenticationRequiredException();
    }
  }

  /*
   * Until when the session is confirmed, or null: its kept confirmation,
   * or - for an account that confirms by signing in - its own sign-in in
   * the window, whichever lasts longer.
   */
  public static async getConfirmedUntil(
    session: ReauthenticationSession,
    knownMethods?: ReauthenticationMethods | undefined,
  ): Promise<Date | null> {
    let kept: KeptConfirmation | null = null;
    let isConfirmationUnknown: boolean = false;

    try {
      kept = await Reauthentication.readConfirmation(session);
    } catch (err) {
      if (!(err instanceof DatabaseNotConnectedException)) {
        throw err;
      }

      isConfirmationUnknown = true;
    }

    const now: number = OneUptimeDate.getCurrentDate().getTime();

    const keptUntil: number | null =
      kept && kept.confirmedAt + Reauthentication.WINDOW_IN_MS > now
        ? kept.confirmedAt + Reauthentication.WINDOW_IN_MS
        : null;

    // Confirmed: the check needs nothing more, and reads nothing more.
    if (keptUntil !== null && !knownMethods) {
      return new Date(keptUntil);
    }

    const methods: ReauthenticationMethods =
      knownMethods || (await Reauthentication.getMethods(session.userId));

    const signedInUntil: number | null = methods.signInAgain
      ? await Reauthentication.getSignInConfirmedUntil(session, now)
      : null;

    /*
     * Unknown, and it could have been confirmed: refused with what to do.
     * An account that confirms by signing in confirms nothing in place, so
     * its session's own row is the whole answer.
     */
    if (
      keptUntil === null &&
      signedInUntil === null &&
      isConfirmationUnknown &&
      !methods.signInAgain
    ) {
      throw new ServiceUnavailableException(
        REAUTHENTICATION_MESSAGES.unavailable,
      );
    }

    const until: number | null =
      keptUntil === null
        ? signedInUntil
        : signedInUntil === null
          ? keptUntil
          : Math.max(keptUntil, signedInUntil);

    return until === null ? null : new Date(until);
  }

  /*
   * A CONFIRMATION, checked as a sign-in checks it.
   *
   * In this order, and each step only once the one before it holds:
   *
   *   1. the person's attempts from this client, counted before anything
   *      is read (IdentityRateLimit);
   *   2. the proof's shape against what the account confirms with - a
   *      password where it has one, its second step where it asks for one,
   *      a passkey where one is offered - which checks no secret, so says
   *      nothing about whether any of it is right, and is not counted;
   *   3. the session's attempts, counted BEFORE the proof is checked, so
   *      requests sent at the same moment are attempts in a row, never
   *      checks inside one allowance. A session past its allowance ends;
   *   4. the proof: the passkey; or the password, then - only once the
   *      password is right, so no backup code is spent on a wrong one - the
   *      second step;
   *   5. right: the session is confirmed for the window and its attempts are
   *      forgotten. Wrong: what was wrong is said, and the attempt that
   *      reaches the allowance ends the session (SessionEndCause.
   *      ReauthenticationFailed) and is answered with a 401, which signs the
   *      browser out.
   */
  public static async confirm(data: {
    session: ReauthenticationSession;
    proof: ReauthenticationProof;
    clientIp: string;
    requestOrigin?: RequestOrigin | undefined;
  }): Promise<{ confirmedUntil: Date }> {
    await Reauthentication.assertWithinRateLimit({
      userId: data.session.userId,
      clientIp: data.clientIp,
    });

    const methods: ReauthenticationMethods = await Reauthentication.getMethods(
      data.session.userId,
    );

    const proofKind: ProofKind = Reauthentication.assertProofShape(
      methods,
      data.proof,
    );

    const attempt: number = await Reauthentication.countAttempt(
      data.session.sessionId,
    );

    if (attempt > REAUTHENTICATION_FAILURES_BEFORE_SIGN_OUT) {
      await Reauthentication.endSession(data);
    }

    const wrong: string | null = await Reauthentication.checkProof({
      session: data.session,
      methods: methods,
      proofKind: proofKind,
      proof: data.proof,
    });

    if (wrong !== null) {
      if (attempt >= REAUTHENTICATION_FAILURES_BEFORE_SIGN_OUT) {
        await Reauthentication.endSession(data);
      }

      throw new BadDataException(wrong);
    }

    const confirmedAt: number = OneUptimeDate.getCurrentDate().getTime();

    await Reauthentication.keepConfirmation(data.session, confirmedAt);
    await Reauthentication.forgetAttempts(data.session.sessionId);

    return {
      confirmedUntil: new Date(confirmedAt + Reauthentication.WINDOW_IN_MS),
    };
  }

  /*
   * The options for a key's prompt (UserWebAuthnService), on the same terms
   * as a confirmation: counted for the person and client, and a passkey's
   * only where the account has one.
   */
  public static async getWebAuthnOptions(data: {
    session: ReauthenticationSession;
    kind: ReauthenticationWebAuthnKind;
    clientIp: string;
  }): Promise<{ options: unknown }> {
    if (
      data.kind !== ReauthenticationWebAuthnKind.Passkey &&
      data.kind !== ReauthenticationWebAuthnKind.SecurityKey
    ) {
      throw new BadDataException(
        "Say which key to use: SecurityKey or Passkey (kind).",
      );
    }

    await Reauthentication.assertWithinRateLimit({
      userId: data.session.userId,
      clientIp: data.clientIp,
    });

    const methods: ReauthenticationMethods = await Reauthentication.getMethods(
      data.session.userId,
    );

    if (
      data.kind === ReauthenticationWebAuthnKind.Passkey &&
      !methods.passkey
    ) {
      throw new BadDataException(REAUTHENTICATION_MESSAGES.noPasskey);
    }

    if (
      data.kind === ReauthenticationWebAuthnKind.SecurityKey &&
      !methods.secondStep?.securityKey
    ) {
      throw new BadDataException(REAUTHENTICATION_MESSAGES.noSecurityKey);
    }

    return await UserWebAuthnService.generateReauthenticationOptions({
      userId: data.session.userId,
      sessionId: data.session.sessionId,
      kind: data.kind,
    });
  }

  // A session's kept confirmation, or null. Throws DatabaseNotConnectedException while Valkey is unreachable.
  private static async readConfirmation(
    session: ReauthenticationSession,
  ): Promise<KeptConfirmation | null> {
    const client: ClientType = Reauthentication.getStore();

    let value: string | null = null;

    try {
      value = await client.get(
        Reauthentication.getConfirmedKey(session.sessionId),
      );
    } catch (err) {
      logger.warn("Reauthentication: could not read a confirmation.");
      logger.warn(err);
      throw new DatabaseNotConnectedException(
        REAUTHENTICATION_MESSAGES.unavailable,
      );
    }

    if (!value) {
      return null;
    }

    try {
      const kept: unknown = JSON.parse(value);

      if (
        !kept ||
        typeof kept !== "object" ||
        typeof (kept as KeptConfirmation).userId !== "string" ||
        typeof (kept as KeptConfirmation).confirmedAt !== "number" ||
        (kept as KeptConfirmation).userId.toLowerCase() !==
          session.userId.toString().toLowerCase()
      ) {
        return null;
      }

      return kept as KeptConfirmation;
    } catch {
      return null;
    }
  }

  // Until when an account that confirms by signing in is confirmed by this session's sign-in, or null.
  private static async getSignInConfirmedUntil(
    session: ReauthenticationSession,
    now: number,
  ): Promise<number | null> {
    const row: UserSession | null = await UserSessionService.findOneById({
      id: session.sessionId,
      select: {
        _id: true,
        userId: true,
        isRevoked: true,
        createdAt: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (
      !row ||
      row.isRevoked !== false ||
      !row.createdAt ||
      row.userId?.toString().toLowerCase() !==
        session.userId.toString().toLowerCase()
    ) {
      return null;
    }

    const until: number =
      new Date(row.createdAt).getTime() + Reauthentication.WINDOW_IN_MS;

    return until > now ? until : null;
  }

  private static async assertWithinRateLimit(data: {
    userId: ObjectID;
    clientIp: string;
  }): Promise<void> {
    const decision: IdentityRateLimitDecision = await IdentityRateLimit.consume(
      {
        accountKey: data.userId.toString().toLowerCase(),
        clientIp: data.clientIp,
        bucket: IdentityRateLimitBucket.Reauthentication,
      },
    );

    if (decision.outcome === IdentityRateLimitOutcome.RateLimited) {
      throw new TooManyRequestsException(
        REAUTHENTICATION_MESSAGES.tooManyAttempts,
      );
    }

    if (decision.outcome === IdentityRateLimitOutcome.CounterUnavailable) {
      throw new ServiceUnavailableException(
        REAUTHENTICATION_MESSAGES.unavailable,
      );
    }
  }

  /*
   * Which way a proof is checked, or a refusal that says what is missing.
   * Reads no secret: what it refuses, it refuses for every value.
   */
  private static assertProofShape(
    methods: ReauthenticationMethods,
    proof: ReauthenticationProof,
  ): ProofKind {
    if (proof.passkeyCredential) {
      if (!methods.passkey) {
        throw new BadDataException(REAUTHENTICATION_MESSAGES.noPasskey);
      }

      return ProofKind.Passkey;
    }

    if (!methods.password) {
      throw new BadDataException(
        methods.passkey
          ? REAUTHENTICATION_MESSAGES.noPassword
          : REAUTHENTICATION_MESSAGES.signInAgain,
      );
    }

    if (typeof proof.password !== "string" || !proof.password) {
      throw new BadDataException(REAUTHENTICATION_MESSAGES.passwordRequired);
    }

    if (methods.secondStep) {
      const hasCode: boolean =
        typeof proof.code === "string" && proof.code.trim().length > 0;
      const hasBackupCode: boolean =
        typeof proof.backupCode === "string" &&
        proof.backupCode.trim().length > 0;
      const hasKey: boolean = Boolean(proof.securityKeyCredential);

      if (!hasCode && !hasBackupCode && !hasKey) {
        throw new BadDataException(
          REAUTHENTICATION_MESSAGES.secondStepRequired,
        );
      }

      if (hasKey && !methods.secondStep.securityKey) {
        throw new BadDataException(REAUTHENTICATION_MESSAGES.noSecurityKey);
      }
    }

    return ProofKind.Password;
  }

  // What was wrong with a proof, in words, or null when it confirms.
  private static async checkProof(data: {
    session: ReauthenticationSession;
    methods: ReauthenticationMethods;
    proofKind: ProofKind;
    proof: ReauthenticationProof;
  }): Promise<string | null> {
    if (data.proofKind === ProofKind.Passkey) {
      return await Reauthentication.checkKey({
        session: data.session,
        kind: ReauthenticationWebAuthnKind.Passkey,
        credential: data.proof.passkeyCredential,
      });
    }

    if (
      !(await Reauthentication.isPasswordRight(
        data.session.userId,
        data.proof.password || "",
      ))
    ) {
      return REAUTHENTICATION_MESSAGES.wrongPassword;
    }

    if (!data.methods.secondStep) {
      return null;
    }

    if (data.proof.securityKeyCredential) {
      return await Reauthentication.checkKey({
        session: data.session,
        kind: ReauthenticationWebAuthnKind.SecurityKey,
        credential: data.proof.securityKeyCredential,
      });
    }

    if (typeof data.proof.backupCode === "string" && data.proof.backupCode) {
      return (await UserTwoFactorBackupCodeService.consumeCode({
        userId: data.session.userId,
        code: data.proof.backupCode,
      }))
        ? null
        : REAUTHENTICATION_MESSAGES.wrongBackupCode;
    }

    return (await Reauthentication.isAuthenticatorCodeRight(
      data.session.userId,
      data.proof.code || "",
    ))
      ? null
      : REAUTHENTICATION_MESSAGES.wrongCode;
  }

  private static async checkKey(data: {
    session: ReauthenticationSession;
    kind: ReauthenticationWebAuthnKind;
    credential: unknown;
  }): Promise<string | null> {
    try {
      await UserWebAuthnService.verifyReauthentication({
        userId: data.session.userId,
        sessionId: data.session.sessionId,
        kind: data.kind,
        credential: data.credential,
      });

      return null;
    } catch (err) {
      if (err instanceof BadDataException) {
        return err.message;
      }

      throw err;
    }
  }

  // The password, checked against the account's own salt as a sign-in checks it.
  private static async isPasswordRight(
    userId: ObjectID,
    password: string,
  ): Promise<boolean> {
    const user: User | null = await UserService.findOneById({
      id: userId,
      select: {
        _id: true,
        password: true,
        passwordSalt: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!user?.password) {
      return false;
    }

    return await UserService.verifyHashedColumnValue({
      item: user,
      columnName: "password",
      plainValue: password,
    });
  }

  // A code that any of the account's verified authenticator apps shows now.
  private static async isAuthenticatorCodeRight(
    userId: ObjectID,
    code: string,
  ): Promise<boolean> {
    const [user, authenticatorApps]: [User | null, Array<UserTotpAuth>] =
      await Promise.all([
        UserService.findOneById({
          id: userId,
          select: { _id: true, email: true },
          props: { isRoot: true },
        }),
        UserTotpAuthService.findBy({
          query: { userId: userId, isVerified: true },
          select: { _id: true, twoFactorSecret: true },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: { isRoot: true },
        }),
      ]);

    if (!user?.email) {
      return false;
    }

    return authenticatorApps.some((app: UserTotpAuth): boolean => {
      return TotpAuth.verifyToken({
        secret: app.twoFactorSecret || "",
        token: code,
        email: user.email!,
      });
    });
  }

  // One more attempt of this session's, and how many it has made.
  private static async countAttempt(sessionId: ObjectID): Promise<number> {
    try {
      const client: ClientType = Reauthentication.getStore();

      const count: unknown = await client.eval(
        COUNT_ATTEMPT_SCRIPT,
        1,
        Reauthentication.getAttemptsKey(sessionId),
        String(ATTEMPTS_KEPT_FOR_SECONDS),
      );

      if (typeof count !== "number" || !Number.isFinite(count)) {
        throw new Error("The attempt count answered something else.");
      }

      return count;
    } catch (err) {
      logger.warn("Reauthentication: could not count an attempt.");
      logger.warn(err);
      throw new ServiceUnavailableException(
        REAUTHENTICATION_MESSAGES.unavailable,
      );
    }
  }

  // The session that used its allowance up ends, and the browser is signed out.
  private static async endSession(data: {
    session: ReauthenticationSession;
    requestOrigin?: RequestOrigin | undefined;
  }): Promise<never> {
    await UserSessionService.revokeLiveSessionOfUser(
      {
        userId: data.session.userId,
        sessionId: data.session.sessionId,
      },
      {
        cause: SessionEndCause.ReauthenticationFailed,
        requestOrigin: data.requestOrigin,
      },
    );

    await Reauthentication.forgetAttempts(data.session.sessionId);

    logger.info(
      `A session of user ${data.session.userId.toString()} was signed out after ${REAUTHENTICATION_FAILURES_BEFORE_SIGN_OUT} wrong attempts to confirm it was theirs.`,
    );

    throw new NotAuthenticatedException(REAUTHENTICATION_MESSAGES.signedOut);
  }

  private static async keepConfirmation(
    session: ReauthenticationSession,
    confirmedAt: number,
  ): Promise<void> {
    const kept: KeptConfirmation = {
      userId: session.userId.toString().toLowerCase(),
      confirmedAt: confirmedAt,
    };

    try {
      const answer: unknown = await Reauthentication.getStore().set(
        Reauthentication.getConfirmedKey(session.sessionId),
        JSON.stringify(kept),
        "EX",
        REAUTHENTICATION_WINDOW_IN_MINUTES * 60,
      );

      if (answer !== "OK") {
        throw new Error("The confirmation was not kept.");
      }
    } catch (err) {
      logger.warn("Reauthentication: could not keep a confirmation.");
      logger.warn(err);
      throw new ServiceUnavailableException(
        REAUTHENTICATION_MESSAGES.unavailable,
      );
    }
  }

  // Never throws: the confirmation stands, and the count is forgotten with the session.
  private static async forgetAttempts(sessionId: ObjectID): Promise<void> {
    try {
      await Reauthentication.getStore().del(
        Reauthentication.getAttemptsKey(sessionId),
      );
    } catch (err) {
      logger.warn("Reauthentication: could not forget a session's attempts.");
      logger.warn(err);
    }
  }

  private static getStore(): ClientType {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      throw new DatabaseNotConnectedException(
        REAUTHENTICATION_MESSAGES.unavailable,
      );
    }

    return client;
  }

  // One key per session, whatever the case its id is written in.
  private static getConfirmedKey(sessionId: ObjectID): string {
    return `${CONFIRMED_KEY_PREFIX}${sessionId.toString().toLowerCase()}`;
  }

  private static getAttemptsKey(sessionId: ObjectID): string {
    return `${ATTEMPTS_KEY_PREFIX}${sessionId.toString().toLowerCase()}`;
  }
}
