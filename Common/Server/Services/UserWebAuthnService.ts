import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/UserWebAuthn";
import UserService from "./UserService";
import BadDataException from "../../Types/Exception/BadDataException";
import Exception from "../../Types/Exception/Exception";
import Hostname from "../../Types/API/Hostname";
import User from "../../Models/DatabaseModels/User";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { Host, HttpProtocol } from "../EnvironmentConfig";
import ObjectID from "../../Types/ObjectID";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Redis, { ClientType } from "../Infrastructure/Redis";
import DatabaseNotConnectedException from "../../Types/Exception/DatabaseNotConnectedException";
import { randomBytes } from "crypto";
import { URL } from "url";

const WEBAUTHN_CHALLENGE_TTL_MINUTES: number = 5;
const AUTHENTICATION_CHALLENGE_PREFIX: string = "webauthn-security-key-login-";
const REGISTRATION_CHALLENGE_PREFIX: string = "webauthn-registration-";
const PASSKEY_CHALLENGE_PREFIX: string = "webauthn-passkey-login-";

interface RegistrationChallenge {
  challenge: string;
  requireUserVerification: boolean;
}

/*
 * One answer for both ways of having no security key to offer, because the
 * route that asks is anonymous.
 *
 * `generateAuthenticationOptions` is reached by POSTing an email address and
 * nothing else. It used to answer "User not found" for an address nobody has
 * registered and "No WebAuthn credentials found for this user" for one that
 * exists but has no key -- two distinguishable replies, which together are a
 * free account-existence oracle for anyone who can send a request, and a
 * second oracle telling them which of those accounts is protected by hardware.
 *
 * Every other door on this surface already refuses to say that much: the login
 * routes deliberately do not reveal which half of a credential was wrong, and
 * IdentityRateLimit answers identically for a real address and an invented
 * one specifically so that being throttled does not give back the enumeration
 * the handlers withhold. This route was the exception.
 *
 * Nothing legitimate is lost. A real user only reaches this after signing in
 * with their password, from a list of their OWN registered keys returned by
 * /login -- so they cannot arrive here with an account that has none, and the
 * message they would never see is not worth an oracle to everyone else.
 */
const NO_SECURITY_KEY_AVAILABLE: string =
  "No security key is available for this account.";

/*
 * How much a security key is asked to prove about the person holding it.
 *
 * "preferred" means: verify the user -- a fingerprint, a face, a PIN, a system
 * password -- IF you can, and go ahead without it if you cannot. That second
 * clause is the entire reason to choose the value over "required", and it is
 * exercised constantly by ordinary hardware:
 *
 *   - a MacBook running folded shut on an external display ("clamshell") has
 *     no reachable Touch ID sensor;
 *   - a plain USB security key with no PIN set has nothing to verify with;
 *   - Windows Hello is unavailable on a desktop with no camera or reader.
 *
 * In each case the browser returns a perfectly good credential with the UV bit
 * in the authenticator data left CLEAR, exactly as we asked it to.
 */
type WebAuthnUserVerification = "required" | "preferred" | "discouraged";

const WEBAUTHN_USER_VERIFICATION: WebAuthnUserVerification = "preferred";

/*
 * The other half of that policy, and the half that was missing.
 *
 * `verifyRegistrationResponse` and `verifyAuthenticationResponse` both default
 * `requireUserVerification` to TRUE. Left unset, they therefore REJECT the
 * very responses the options above told the authenticator were acceptable --
 * so a user in clamshell mode got "User verification was required, but user
 * could not be verified" thrown out of the library and rendered as an
 * unexplained "Server Error" (issue #3652). Registration was where it was
 * reported, but the identical default sits on the authentication call, so a
 * key enrolled at a desk also failed to SIGN IN from the same laptop later.
 *
 * DERIVED from the requested policy rather than written as a bare `false` in
 * two places, because the drift between what we asked for and what we then
 * demanded IS the bug. Tying both to one constant means raising the policy to
 * "required" cannot leave verification behind, and relaxing it cannot leave
 * verification ahead. The comparison goes through a function taking the union
 * type because TypeScript narrows a `const` to the literal it was initialised
 * with and then rejects the comparison outright -- which would push this back
 * to a hand-written `false` and reopen the drift.
 *
 * Relaxing this does not weaken the account. A security key is OneUptime's
 * SECOND factor: the password has already been proven by the time any of this
 * runs (see the verifyWebAuthn branch in
 * App/FeatureSet/Identity/API/Authentication.ts), so user verification would
 * be buying a second proof of the same person rather than a second factor.
 * What it would cost is real -- every authenticator that cannot verify becomes
 * unusable, and the user is locked out by hardware rather than by policy.
 */
type RequiresUserVerificationFunction = (
  policy: WebAuthnUserVerification,
) => boolean;

const requiresUserVerification: RequiresUserVerificationFunction = (
  policy: WebAuthnUserVerification,
): boolean => {
  return policy === "required";
};

const WEBAUTHN_REQUIRE_USER_VERIFICATION: boolean = requiresUserVerification(
  WEBAUTHN_USER_VERIFICATION,
);

/*
 * Everything @simplewebauthn/server refuses, it refuses by throwing a plain
 * `Error` rather than one of our `Exception`s -- and the last-resort handler
 * in Common/Server/Utils/StartServer.ts has no branch for a plain Error. It
 * falls through to `res.status(500).send({ error: "Server Error" })`, which
 * DISCARDS the message.
 *
 * That is the other half of what issue #3652 reported. The user saw an
 * unexplained "Server Error"; the sentence that actually says what went wrong
 * ("User verification was required, but user could not be verified") only ever
 * reached the server log, which a hosted user cannot read at all and a
 * self-hoster has to go looking for. Every WebAuthn failure looked identical
 * from the browser: a misconfigured reverse proxy serving a different origin
 * than HOST claims, a challenge that timed out while the user hunted for their
 * key, and a genuinely bad credential were one indistinguishable 500.
 *
 * The messages are safe to show. They name the origin, the relying party id or
 * the challenge THIS SERVER expected -- all of which the browser making the
 * request already knows -- and for a self-hoster the origin mismatch is the
 * single most useful thing the product can say.
 *
 * Exceptions we raised ourselves pass straight through, so the specific
 * wording of the challenge errors below is not flattened into the generic one.
 */
type VerifyWebAuthnResponseFunction = (
  verify: () => Promise<any>,
) => Promise<any>;

const explainVerificationFailure: VerifyWebAuthnResponseFunction = async (
  verify: () => Promise<any>,
): Promise<any> => {
  try {
    return await verify();
  } catch (err) {
    if (err instanceof Exception) {
      throw err;
    }

    throw new BadDataException(
      err instanceof Error && err.message
        ? err.message
        : "Could not verify this security key.",
    );
  }
};

/*
 * The relying party id, which is NOT the origin and must not be written as if
 * it were.
 *
 * `expectedOrigin` is a full origin and MUST carry the port: a browser on
 * https://oneuptime.example.com:8443 puts exactly that in its client data. The
 * RP ID is a bare registrable domain and must NOT -- the spec defines it as a
 * domain string, and a browser handed "oneuptime.example.com:8443" rejects the
 * call outright with a SecurityError before any authenticator is asked
 * anything. The two are built from the same HOST here, so they were the same
 * string, and one of them was wrong.
 *
 * HOST is whatever the operator put in the environment (`Common/Server/EnvironmentConfig.ts`),
 * and for a self-hosted instance not sitting on 80/443 that is routinely
 * `host:port` -- which made WebAuthn unusable on those deployments rather than
 * merely awkward. Nothing is invalidated by fixing it: on exactly the
 * deployments this changes, the browser refused to create a credential at all,
 * so there are none to invalidate. Where HOST carries no port, this is the
 * identity function and no existing credential moves.
 *
 * `fromAuthority` rather than `fromString`: it is the one that understands
 * bracketed IPv6 literals and userinfo instead of splitting on the first colon
 * and turning "[::1]:8443" into a host of "[".
 */
type WebAuthnRelyingPartyIdFunction = () => string;

const webAuthnRelyingPartyId: WebAuthnRelyingPartyIdFunction = (): string => {
  return Hostname.fromAuthority(Host.toString()).hostname;
};

/*
 * The transports a stored credential reported at registration, back out of the
 * text column and into the shape `allowCredentials` wants.
 *
 * Spelled out locally rather than imported as the library's
 * `AuthenticatorTransportFuture`, for the same reason the user-verification
 * policy above is: the type has to hold when Common's jest config swaps the
 * whole package for a stub.
 *
 * Deliberately forgiving, and it returns UNDEFINED rather than an empty array
 * when it has nothing to say. Every credential registered before this change
 * holds the literal "[]", and there is a difference between telling the
 * browser "this key is reachable by no transport" and not telling it anything:
 * the first is a hint that excludes every option, the second is what those
 * credentials have always sent. An unreadable value costs the user a hint,
 * never their sign-in.
 *
 * Filtering to the known set happens on READ, not on write, so a transport
 * some future browser invents is still recorded faithfully in the column and
 * only the hint drops it.
 */
type WebAuthnTransport =
  | "ble"
  | "cable"
  | "hybrid"
  | "internal"
  | "nfc"
  | "smart-card"
  | "usb";

const KNOWN_WEBAUTHN_TRANSPORTS: Array<string> = [
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart-card",
  "usb",
];

type ParseTransportsFunction = (
  stored: string | undefined,
) => Array<WebAuthnTransport> | undefined;

const parseStoredTransports: ParseTransportsFunction = (
  stored: string | undefined,
): Array<WebAuthnTransport> | undefined => {
  if (!stored) {
    return undefined;
  }

  let parsed: unknown = undefined;

  try {
    parsed = JSON.parse(stored);
  } catch {
    return undefined;
  }

  if (!Array.isArray(parsed)) {
    return undefined;
  }

  const transports: Array<WebAuthnTransport> = parsed.filter(
    (transport: unknown) => {
      return (
        typeof transport === "string" &&
        KNOWN_WEBAUTHN_TRANSPORTS.includes(transport)
      );
    },
  ) as Array<WebAuthnTransport>;

  return transports.length > 0 ? transports : undefined;
};

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  public async generateRegistrationOptions(data: {
    userId: ObjectID;
    isPasskey?: boolean;
  }): Promise<{ options: any; challenge: string }> {
    const user: User | null = await UserService.findOneById({
      id: data.userId,
      select: {
        email: true,
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!user) {
      throw new BadDataException("User not found");
    }

    if (!user.email) {
      throw new BadDataException("User email not found");
    }

    // Get existing credentials for this user
    const existingCredentials: Array<Model> = await this.findBy({
      query: {
        userId: data.userId,
      },
      select: {
        credentialId: true,
        transports: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const options: any = await generateRegistrationOptions({
      rpName: "OneUptime",
      rpID: this.getRelyingParty().rpID,
      userID: new Uint8Array(Buffer.from(data.userId.toString())),
      userName: user.email.toString(),
      userDisplayName: user.name ? user.name.toString() : user.email.toString(),
      attestationType: "none",
      excludeCredentials: existingCredentials
        .filter((cred: Model) => {
          return cred.credentialId;
        })
        .map((cred: Model) => {
          /* Same hint as allowCredentials carries; see the note there. */
          const transports: Array<WebAuthnTransport> | undefined =
            parseStoredTransports(cred.transports);
          return {
            id: cred.credentialId!,
            type: "public-key",
            ...(transports ? { transports } : {}),
          };
        }),
      authenticatorSelection: {
        residentKey: data.isPasskey === true ? "required" : "discouraged",
        userVerification:
          data.isPasskey === true ? "required" : WEBAUTHN_USER_VERIFICATION,
      },
    });

    /*
     * SimpleWebAuthn already returns base64url JSON. Preserve the exact
     * challenge, and bind the verification requirement to server-side state.
     */
    await this.storeChallenge(
      `${REGISTRATION_CHALLENGE_PREFIX}${data.userId.toString()}`,
      JSON.stringify({
        challenge: options.challenge,
        requireUserVerification:
          data.isPasskey === true || WEBAUTHN_REQUIRE_USER_VERIFICATION,
      }),
    );

    return {
      options: options as any,
      challenge: options.challenge,
    };
  }

  @CaptureSpan()
  public async verifyRegistration(data: {
    credential: any;
    name: string;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    if (!data.props.userId) {
      throw new BadDataException("User ID not found in request");
    }

    const storedChallenge: RegistrationChallenge = JSON.parse(
      await this.consumeChallenge(
        `${REGISTRATION_CHALLENGE_PREFIX}${data.props.userId.toString()}`,
      ),
    ) as RegistrationChallenge;

    if (
      !storedChallenge.challenge ||
      typeof storedChallenge.requireUserVerification !== "boolean"
    ) {
      throw new BadDataException("Invalid registration challenge");
    }

    const verification: any = await explainVerificationFailure(() => {
      return verifyRegistrationResponse({
        response: data.credential,
        expectedChallenge: storedChallenge.challenge,
        expectedOrigin: this.getRelyingParty().origin,
        expectedRPID: this.getRelyingParty().rpID,
        requireUserVerification: storedChallenge.requireUserVerification,
      });
    });

    if (!verification.verified) {
      throw new BadDataException("Registration verification failed");
    }

    const { registrationInfo } = verification;

    if (!registrationInfo) {
      throw new BadDataException("Registration info not found");
    }

    if (
      storedChallenge.requireUserVerification &&
      !registrationInfo.userVerified
    ) {
      throw new BadDataException(
        "Passkey registration requires user verification",
      );
    }

    // Save the credential
    const userWebAuthn: Model = Model.fromJSON(
      {
        name: data.name,
        credentialId: registrationInfo.credential.id,
        publicKey: Buffer.from(registrationInfo.credential.publicKey).toString(
          "base64",
        ),
        /*
         * From the authenticator, not hard-coded.
         *
         * The counter used to be written as "0" regardless. Most platform
         * authenticators do report 0 -- a passkey synced between devices
         * cannot keep a meaningful count -- but a discrete key that has been
         * used elsewhere arrives with a real one, and pinning it to 0 threw
         * that away. `verifyAuthenticationResponse` only compares counters
         * when at least one side is above zero, so the discarded value was
         * precisely the clone detection this credential was eligible for:
         * a key registered at count 40 and a clone of it replaying count 12
         * both looked fine against a stored 0.
         *
         * The trade is not free, and the tail is worth naming: an
         * authenticator that reports the SAME counter at registration and at
         * its first assertion now fails that comparison, where a stored 0
         * would have waved it through. A spec-compliant key increments on
         * every assertion, so this should not happen -- but if it does, the
         * key is unusable and the way back in is a backup code (minted at
         * enrolment, see UserWebAuthnAPI) followed by registering it again.
         * The alternative is to keep discarding the counter and keep the
         * clone detection permanently off, which is the worse default.
         *
         * Transports were likewise always "[]". They are the browser's hint
         * about HOW to reach this key -- USB, NFC, the platform itself -- and
         * with none recorded every sign-in prompt has to offer all of them.
         */
        counter:
          typeof registrationInfo.credential.counter === "number"
            ? registrationInfo.credential.counter.toString()
            : "0",
        transports: JSON.stringify(
          registrationInfo.credential.transports || [],
        ),
        isVerified: true,
        userId: data.props.userId,
      },
      Model,
    ) as Model;

    await this.create({
      data: userWebAuthn,
      props: data.props,
    });
  }

  @CaptureSpan()
  public async generateAuthenticationOptions(data: {
    email: string;
  }): Promise<{ options: any; challenge: string }> {
    const user: User | null = await UserService.findOneBy({
      query: { email: data.email },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!user) {
      throw new BadDataException(NO_SECURITY_KEY_AVAILABLE);
    }

    // Get user's WebAuthn credentials
    const credentials: Array<Model> = await this.findBy({
      query: {
        userId: user.id!,
        isVerified: true,
      },
      select: {
        credentialId: true,
        transports: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    if (credentials.length === 0) {
      throw new BadDataException(NO_SECURITY_KEY_AVAILABLE);
    }

    const options: any = await generateAuthenticationOptions({
      rpID: this.getRelyingParty().rpID,
      allowCredentials: credentials.map((cred: Model) => {
        /*
         * Recording transports at registration buys nothing unless they are
         * handed back here: this is the only place the browser reads them.
         * With the hint, a key that says "usb" prompts for a USB key rather
         * than opening the whole carousel of ways a credential might be
         * reachable. `generateAuthenticationOptions` copies unknown fields
         * straight through onto the descriptor, and Login.tsx rewrites only
         * `id`, so the array survives to navigator.credentials.get().
         *
         * SPREAD rather than `transports: undefined`, so a credential with no
         * hint carries no `transports` member at all. The two are not the
         * same to a browser -- an empty array is a hint that excludes every
         * transport, and Chromium filters on the hint when it is present, so
         * an empty one could hide a key that works perfectly well.
         */
        const transports: Array<WebAuthnTransport> | undefined =
          parseStoredTransports(cred.transports);
        return {
          id: cred.credentialId!,
          type: "public-key",
          ...(transports ? { transports } : {}),
        };
      }),
      userVerification: WEBAUTHN_USER_VERIFICATION,
    });

    await this.storeChallenge(
      `${AUTHENTICATION_CHALLENGE_PREFIX}${user.id!.toString()}`,
      options.challenge,
    );

    /*
     * The anonymous caller gets the ceremony and nothing else.
     *
     * This used to hand back `userId` too -- the account's real row id, to
     * anybody who could name an email address with a key on it. Nothing ever
     * read it: the browser posts the assertion to /verify-webauthn-auth along
     * with the email and password again, and that route takes the user from
     * the password it has just verified
     * (App/FeatureSet/Identity/API/Authentication.ts), never from the body.
     *
     * So it was an identifier handed to strangers for free, on the one route
     * that has just been made careful about what it tells them -- and it would
     * have undone half of that: unifying the two refusals stops a caller
     * learning whether an account exists, while a success that carries its
     * internal id tells them rather more than that.
     */
    return {
      options: options as any,
      challenge: options.challenge,
    };
  }

  @CaptureSpan()
  public async verifyAuthentication(data: {
    userId: string;
    credential: any;
  }): Promise<User> {
    // Retrieve the challenge from the server-side store
    const storedChallenge: string = await this.consumeChallenge(
      `${AUTHENTICATION_CHALLENGE_PREFIX}${new ObjectID(data.userId).toString()}`,
    );

    const user: User | null = await UserService.findOneById({
      id: new ObjectID(data.userId),
      select: {
        _id: true,
        email: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!user) {
      throw new BadDataException("User not found");
    }

    // Get the credential from database
    const dbCredential: Model | null = await this.findOneBy({
      query: {
        credentialId: data.credential.id,
        userId: new ObjectID(data.userId),
        isVerified: true,
      },
      select: {
        credentialId: true,
        publicKey: true,
        counter: true,
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!dbCredential) {
      throw new BadDataException("Credential not found");
    }

    const verification: any = await explainVerificationFailure(() => {
      return verifyAuthenticationResponse({
        response: data.credential,
        expectedChallenge: storedChallenge,
        requireUserVerification: WEBAUTHN_REQUIRE_USER_VERIFICATION,
        expectedOrigin: this.getRelyingParty().origin,
        expectedRPID: this.getRelyingParty().rpID,
        credential: {
          id: dbCredential.credentialId!,
          publicKey: Buffer.from(dbCredential.publicKey!, "base64"),
          counter: parseInt(dbCredential.counter!),
        } as any,
      });
    });

    if (!verification.verified) {
      throw new BadDataException("Authentication verification failed");
    }

    // Update counter
    await this.updateOneById({
      id: dbCredential.id!,
      data: {
        counter: verification.authenticationInfo.newCounter.toString(),
      },
      props: {
        isRoot: true,
      },
    });

    return user;
  }

  @CaptureSpan()
  public async generatePasskeyAuthenticationOptions(): Promise<{
    options: any;
    challengeId: string;
  }> {
    /*
     * No email or credential allow-list is needed: the authenticator offers
     * the discoverable credentials registered for this relying party.
     */
    const options: any = await generateAuthenticationOptions({
      rpID: this.getRelyingParty().rpID,
      allowCredentials: [],
      userVerification: "required",
    });
    const challengeId: string = randomBytes(32).toString("base64url");

    await this.storeChallenge(
      `${PASSKEY_CHALLENGE_PREFIX}${challengeId}`,
      options.challenge,
    );

    return { options, challengeId };
  }

  @CaptureSpan()
  public async verifyPasskeyAuthentication(data: {
    challengeId: string;
    credential: any;
  }): Promise<User> {
    if (
      typeof data.challengeId !== "string" ||
      !data.challengeId.match(/^[A-Za-z0-9_-]{43}$/)
    ) {
      throw new BadDataException("Invalid passkey challenge");
    }

    /*
     * Consume before validation. Failed assertions cannot reuse a challenge,
     * and concurrent requests can never both claim the same ceremony.
     */
    const challenge: string = await this.consumeChallenge(
      `${PASSKEY_CHALLENGE_PREFIX}${data.challengeId}`,
    );

    if (
      typeof data.credential?.id !== "string" ||
      !data.credential.id ||
      data.credential.type !== "public-key" ||
      data.credential.rawId !== data.credential.id ||
      typeof data.credential?.response?.userHandle !== "string" ||
      !data.credential.response.userHandle ||
      !["clientDataJSON", "authenticatorData", "signature"].every(
        (field: string) => {
          return (
            typeof data.credential.response[field] === "string" &&
            data.credential.response[field].length > 0
          );
        },
      )
    ) {
      throw new BadDataException("Invalid passkey credential");
    }

    const dbCredential: Model | null = await this.findOneBy({
      query: {
        credentialId: data.credential.id,
        isVerified: true,
      },
      select: {
        _id: true,
        userId: true,
        credentialId: true,
        publicKey: true,
        counter: true,
      },
      props: { isRoot: true },
    });

    if (
      !dbCredential?.userId ||
      !dbCredential.id ||
      !dbCredential.publicKey ||
      !dbCredential.credentialId ||
      data.credential.response.userHandle !==
        Buffer.from(dbCredential.userId.toString()).toString("base64url")
    ) {
      throw new BadDataException("Passkey authentication failed");
    }

    const counter: number = Number(dbCredential.counter);

    if (
      !dbCredential.counter ||
      !dbCredential.counter.match(/^\d+$/) ||
      !Number.isSafeInteger(counter) ||
      counter < 0
    ) {
      throw new BadDataException("Invalid passkey counter");
    }

    const verification: any = await verifyAuthenticationResponse({
      response: data.credential,
      expectedChallenge: challenge,
      expectedOrigin: this.getRelyingParty().origin,
      expectedRPID: this.getRelyingParty().rpID,
      requireUserVerification: true,
      credential: {
        id: dbCredential.credentialId,
        publicKey: new Uint8Array(
          Buffer.from(dbCredential.publicKey, "base64"),
        ),
        counter,
      },
    });

    if (
      !verification.verified ||
      !verification.authenticationInfo?.userVerified
    ) {
      throw new BadDataException("Passkey authentication failed");
    }

    const updated: number = await this.updateOneById({
      id: dbCredential.id,
      data: {
        counter: verification.authenticationInfo.newCounter.toString(),
      },
      props: { isRoot: true },
    });

    if (updated !== 1) {
      throw new BadDataException("Passkey authentication failed");
    }

    const user: User | null = await UserService.findOneById({
      id: dbCredential.userId,
      select: { _id: true, email: true },
      props: { isRoot: true },
    });

    if (!user) {
      throw new BadDataException("Passkey authentication failed");
    }

    return user;
  }

  private getRelyingParty(): { rpID: string; origin: string } {
    const origin: URL = new URL(`${HttpProtocol}${Host.toString()}`);

    /*
     * Relying party IDs exclude the port; origins include it for installations
     * hosted on a non-default port.
     */
    return { rpID: webAuthnRelyingPartyId(), origin: origin.origin };
  }

  private getChallengeStore(): ClientType {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      throw new DatabaseNotConnectedException(
        "Passkey challenge store is unavailable",
      );
    }

    return client;
  }

  private async storeChallenge(key: string, value: string): Promise<void> {
    const result: string | null = await this.getChallengeStore().set(
      key,
      value,
      "EX",
      WEBAUTHN_CHALLENGE_TTL_MINUTES * 60,
    );

    if (result !== "OK") {
      throw new BadDataException("Unable to create a WebAuthn challenge");
    }
  }

  private async consumeChallenge(key: string): Promise<string> {
    /*
     * A Lua GET+DEL works on Redis versions before GETDEL was introduced.
     * Both operations execute atomically and the key remains subject to TTL.
     */
    const challenge: unknown = await this.getChallengeStore().eval(
      "local value = redis.call('GET', KEYS[1]); " +
        "if value then redis.call('DEL', KEYS[1]); end; return value",
      1,
      key,
    );

    if (typeof challenge !== "string" || !challenge) {
      throw new BadDataException(
        "WebAuthn challenge expired or was already used. Please try again.",
      );
    }

    return challenge;
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.props.userId) {
      throw new BadDataException("User id is required");
    }

    createBy.data.userId = createBy.props.userId;

    const user: User | null = await UserService.findOneById({
      id: createBy.data.userId,
      props: {
        isRoot: true,
      },
      select: {
        email: true,
      },
    });

    if (!user) {
      throw new BadDataException("User not found");
    }

    if (!user.email) {
      throw new BadDataException("User email is required");
    }

    // by default secuirty keys are always verified. You can't add an unverified security key.

    createBy.data.isVerified = true;

    return {
      createBy: createBy,
      carryForward: {},
    };
  }

  /*
   * There is no `onBeforeDelete` here any more.
   *
   * It used to refuse the deletion of a user's LAST verified factor while
   * `enableTwoFactorAuth` was on, telling them to "disable two factor auth
   * before deleting this item". Both halves of that stopped being true:
   *
   *  - the advice is impossible to follow for a user whose two factor auth was
   *    mandated by an admin. They cannot turn the requirement off, so the
   *    guard did not protect them, it stranded them on an authenticator they
   *    may have been trying to replace;
   *  - the lockout it protected against no longer exists. An account that is
   *    required to use two factor auth and has nothing set up is now sent
   *    through enrolment at its next sign-in rather than refused, so deleting
   *    the last factor costs a QR code, not an account.
   *
   * It was also wrong on its own terms: it counted the verified factors that
   * existed BEFORE the delete, once per item, inside a loop over the whole
   * `deleteBy` set -- so removing two verified factors in a single call passed
   * the check twice and landed in exactly the state it existed to prevent.
   *
   * The same guard has been removed from UserTotpAuthService for the same
   * reasons; the two were mirror images and had to move together.
   */
}

export default new Service();
