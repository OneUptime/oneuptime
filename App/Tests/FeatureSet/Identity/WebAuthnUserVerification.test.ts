import UserWebAuthnService from "Common/Server/Services/UserWebAuthnService";
import UserService from "Common/Server/Services/UserService";
import Base64 from "Common/Utils/Base64";
import User from "Common/Models/DatabaseModels/User";
import UserWebAuthn from "Common/Models/DatabaseModels/UserWebAuthn";
import Email from "Common/Types/Email";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import Exception from "Common/Types/Exception/Exception";
import StatusCode from "Common/Types/API/StatusCode";
import {
  AuthenticationResponse,
  RegistrationResponse,
  SecurityKey,
  createSecurityKey,
} from "Common/Tests/Server/TestingUtils/SecurityKey";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * Issue #3652 — "Passkey registration fails in clamshell mode".
 *
 * A MacBook running folded shut on an external display cannot reach its Touch
 * ID sensor. The server asks for `userVerification: "preferred"`, which tells
 * the authenticator in so many words that going ahead WITHOUT verifying the
 * user is acceptable, so the browser returns a perfectly valid credential with
 * the UV bit in the authenticator data left clear. The server then threw
 *
 *     User verification was required, but user could not be verified
 *
 * out of @simplewebauthn/server and rendered it as an unexplained
 * "Server Error". The user could not enrol a passkey at all.
 *
 * The cause was a policy split across two places that had drifted apart:
 * `generateRegistrationOptions` asked for "preferred", while
 * `verifyRegistrationResponse` was left to its own default of
 * `requireUserVerification: true` and refused exactly what we had asked for.
 * The identical default sits on `verifyAuthenticationResponse`, so the bug was
 * never only about registration — a key enrolled at a desk could not SIGN IN
 * from the same laptop later, which is a lockout rather than an annoyance.
 *
 * WHY THIS FILE LIVES IN App/Tests AND NOT Common/Tests
 *
 * Common's jest config maps `@simplewebauthn/server` to a hand-written stub
 * (Common/Tests/__mocks__/simplewebauthn.js), so a test written there cannot
 * see the library default that caused the bug — it would assert against a
 * stub that has no such default and would have passed before the fix. App's
 * jest config does not map the package, so everything here runs against the
 * REAL v13 library. That is the whole point: the defect was in what the
 * library does when we say nothing, and only the real library exhibits it.
 *
 * WHAT IS REAL AND WHAT IS STUBBED
 *
 * Real: @simplewebauthn/server, the ES256 signatures, the CBOR attestation,
 * the authenticator-data flags, and `Common/Utils/Base64` — the same helper
 * the browser code uses to turn the challenge the server issued back into the
 * bytes the authenticator signs.
 *
 * Stubbed: Postgres only. `UserService` and the four `DatabaseService` methods
 * the service reaches for are replaced; nothing else is.
 *
 * The credentials come from Common/Tests/Server/TestingUtils/SecurityKey,
 * which builds them from the WebAuthn/CTAP specs with Node crypto and imports
 * nothing from @simplewebauthn/server. A fixture produced by the library under
 * test would only prove the library agrees with itself.
 * ---------------------------------------------------------------------------
 */

/*
 * Written out as a literal inside the factory as well as in RP_ID below:
 * jest hoists this call above every const in the file, so the factory runs
 * while RP_ID is still in its temporal dead zone.
 */
jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  /*
   * Host is the relying party id and, with the protocol in front of it, the
   * expected origin. Both have to be something a credential can plausibly be
   * scoped to, and the default in a test process is the empty string.
   */
  return {
    ...actual,
    __esModule: true,
    Host: "oneuptime.example.com",
    HttpProtocol: "https://",
  };
});

const RP_ID: string = "oneuptime.example.com";
const ORIGIN: string = `https://${RP_ID}`;

const USER_ID: ObjectID = new ObjectID("6f9d4a1e-2b3c-4d5e-8f10-112233445566");
const USER_EMAIL: Email = new Email("clamshell.user@example.com");

const KEY_NAME: string = "MacBook Touch ID";

/*
 * Whatever the last call to generateRegistrationOptions /
 * generateAuthenticationOptions asked the database to remember. The service
 * stores the challenge on the User row and reads it back at verification, so
 * this is the seam that carries a challenge from one half of a flow to the
 * other -- exactly as the real column does.
 */
let storedChallenge: string | null = null;
let storedChallengeExpiresAt: Date | null = null;

/* Rows the stubbed database will answer with. */
let existingCredentials: Array<UserWebAuthn> = [];
let createdCredential: UserWebAuthn | null = null;
let counterUpdates: Array<string> = [];

type BuildUserFunction = () => User;

const buildUser: BuildUserFunction = (): User => {
  const user: User = new User();
  user.id = USER_ID;
  user.email = USER_EMAIL;

  /*
   * `findOneById` is used for two different reads — the profile lookup when
   * options are generated, and the challenge lookup when a response is
   * verified — so the same object has to answer both.
   */
  user.webauthnChallenge = storedChallenge as string;
  user.webauthnChallengeExpiresAt = storedChallengeExpiresAt as unknown as Date;

  return user;
};

beforeEach(() => {
  storedChallenge = null;
  storedChallengeExpiresAt = null;
  existingCredentials = [];
  createdCredential = null;
  counterUpdates = [];

  UserService.findOneById = jest.fn().mockImplementation(async () => {
    return buildUser();
  }) as never;

  UserService.findOneBy = jest.fn().mockImplementation(async () => {
    return buildUser();
  }) as never;

  UserService.updateOneById = jest
    .fn()
    .mockImplementation(async (data: { data: Record<string, unknown> }) => {
      if ("webauthnChallenge" in data.data) {
        storedChallenge = data.data["webauthnChallenge"] as string | null;
        storedChallengeExpiresAt = data.data[
          "webauthnChallengeExpiresAt"
        ] as Date | null;
      }
      return undefined;
    }) as never;

  UserWebAuthnService.findBy = jest.fn().mockImplementation(async () => {
    return existingCredentials;
  }) as never;

  UserWebAuthnService.findOneBy = jest.fn().mockImplementation(async () => {
    return existingCredentials[0] || null;
  }) as never;

  UserWebAuthnService.create = jest
    .fn()
    .mockImplementation(async (data: { data: UserWebAuthn }) => {
      createdCredential = data.data;
      return data.data;
    }) as never;

  UserWebAuthnService.updateOneById = jest
    .fn()
    .mockImplementation(async (data: { data: Record<string, unknown> }) => {
      if (data.data["counter"] !== undefined) {
        counterUpdates.push(data.data["counter"] as string);
      }
      return undefined;
    }) as never;
});

afterEach(() => {
  jest.restoreAllMocks();
});

type MakeKeyFunction = (performsUserVerification: boolean) => SecurityKey;

const makeKey: MakeKeyFunction = (
  performsUserVerification: boolean,
): SecurityKey => {
  return createSecurityKey({
    rpId: RP_ID,
    origin: ORIGIN,
    performsUserVerification: performsUserVerification,
    isMultiDevice: true,
  });
};

/*
 * The registration half of the flow, driven exactly as the browser drives it:
 * ask the server for options, decode the challenge with the same helper
 * App/FeatureSet/Dashboard/.../TwoFactorAuth.tsx uses, hand it to the
 * authenticator, post the result back.
 */
type RegisterFunction = (key: SecurityKey) => Promise<void>;

const register: RegisterFunction = async (key: SecurityKey): Promise<void> => {
  const { options } = await UserWebAuthnService.generateRegistrationOptions({
    userId: USER_ID,
  });

  const challengeTheAuthenticatorSigns: string = Buffer.from(
    Base64.base64UrlToUint8Array(options.challenge),
  ).toString("base64url");

  const credential: RegistrationResponse = key.register({
    challenge: challengeTheAuthenticatorSigns,
  });

  await UserWebAuthnService.verifyRegistration({
    credential: credential,
    name: KEY_NAME,
    props: { userId: USER_ID },
  });
};

/* The same, for signing in. Requires a credential row to already exist. */
type AuthenticateFunction = (key: SecurityKey) => Promise<User>;

const authenticate: AuthenticateFunction = async (
  key: SecurityKey,
): Promise<User> => {
  const { options } = await UserWebAuthnService.generateAuthenticationOptions({
    email: USER_EMAIL.toString(),
  });

  const challengeTheAuthenticatorSigns: string = Buffer.from(
    Base64.base64UrlToUint8Array(options.challenge),
  ).toString("base64url");

  const assertion: AuthenticationResponse = key.authenticate({
    challenge: challengeTheAuthenticatorSigns,
  });

  return UserWebAuthnService.verifyAuthentication({
    userId: USER_ID.toString(),
    credential: assertion,
  });
};

/* Put a key on the account as if it had already been registered. */
type SeedRegisteredKeyFunction = (key: SecurityKey) => void;

const seedRegisteredKey: SeedRegisteredKeyFunction = (
  key: SecurityKey,
): void => {
  const row: UserWebAuthn = new UserWebAuthn();
  row.id = new ObjectID("11112222-3333-4444-8555-666677778888");
  row.credentialId = key.credentialId;
  row.publicKey = key.publicKeyAsStored;
  row.counter = "0";
  row.isVerified = true;
  row.userId = USER_ID;

  existingCredentials = [row];
};

describe("WebAuthn user verification (issue #3652)", () => {
  describe("registering a passkey on an authenticator that cannot verify its user", () => {
    it("accepts a credential whose UV flag is clear", async () => {
      /*
       * THE REGRESSION TEST. Before the fix this rejected with
       * "User verification was required, but user could not be verified",
       * which is precisely the bug report: a folded-shut MacBook cannot reach
       * Touch ID, so the browser returns a credential with UV clear -- as our
       * own "preferred" policy invited it to -- and the server refused it.
       */
      await expect(register(makeKey(false))).resolves.toBeUndefined();

      expect(createdCredential).not.toBeNull();
    });

    it("saves the credential the authenticator actually returned", async () => {
      /*
       * "Did not throw" is not the same as "enrolled". If the credential id or
       * the public key that lands in the row is not the authenticator's own,
       * the user has a security key the account will never recognise again --
       * a registration that reports success and produces a factor that cannot
       * sign in.
       */
      const key: SecurityKey = makeKey(false);

      await register(key);

      expect(createdCredential!.credentialId).toBe(key.credentialId);
      expect(createdCredential!.publicKey).toBe(key.publicKeyAsStored);
      expect(createdCredential!.name).toBe(KEY_NAME);
      expect(createdCredential!.userId!.toString()).toBe(USER_ID.toString());
    });

    it("still accepts a credential from an authenticator that DID verify", async () => {
      /*
       * The other half of "preferred", asserted so the fix cannot be read as
       * "user verification is now rejected". A laptop at a desk with the lid
       * open sets the UV bit, and that has to keep working.
       */
      await expect(register(makeKey(true))).resolves.toBeUndefined();

      expect(createdCredential).not.toBeNull();
    });
  });

  describe("signing in with an authenticator that cannot verify its user", () => {
    it("accepts an assertion whose UV flag is clear", async () => {
      /*
       * The half of the bug nobody reported, because nobody got far enough to
       * hit it. `verifyAuthenticationResponse` carries the SAME
       * requireUserVerification default, so a key enrolled at a desk failed to
       * sign in from the same laptop in clamshell mode -- and the password has
       * already been accepted by then, so there is no way back into the
       * account from the browser. Fixing registration alone would have moved
       * the lockout rather than removed it.
       */
      const key: SecurityKey = makeKey(false);
      seedRegisteredKey(key);

      const user: User = await authenticate(key);

      expect(user.id!.toString()).toBe(USER_ID.toString());
    });

    it("still accepts an assertion from an authenticator that DID verify", async () => {
      const key: SecurityKey = makeKey(true);
      seedRegisteredKey(key);

      const user: User = await authenticate(key);

      expect(user.id!.toString()).toBe(USER_ID.toString());
    });

    it("writes the authenticator's signature counter back", async () => {
      /*
       * Cheap, and it keeps the assertions above honest: if verification were
       * somehow short-circuiting rather than really running, nothing would
       * reach the counter write that follows it.
       */
      const key: SecurityKey = makeKey(false);
      seedRegisteredKey(key);

      await authenticate(key);

      expect(counterUpdates).toEqual(["0"]);
    });
  });

  describe("the policy the browser is asked for", () => {
    it("asks for preferred user verification when registering", async () => {
      /*
       * The ask and the check are two halves of one policy, and the bug was
       * that they disagreed. This pins the ask, so a future change that
       * tightens verification without tightening the options -- recreating the
       * exact defect -- fails here as well as in the tests above.
       */
      const { options } = await UserWebAuthnService.generateRegistrationOptions(
        {
          userId: USER_ID,
        },
      );

      expect(options.authenticatorSelection.userVerification).toBe("preferred");
    });

    it("asks for preferred user verification when signing in", async () => {
      seedRegisteredKey(makeKey(false));

      const { options } =
        await UserWebAuthnService.generateAuthenticationOptions({
          email: USER_EMAIL.toString(),
        });

      expect(options.userVerification).toBe("preferred");
    });
  });

  describe("what relaxing user verification does NOT relax", () => {
    /*
     * The fix removes ONE check, and a fix that quietly removed more than one
     * would look identical from the tests above. Each of these is a property
     * that has to survive: they are what make a security key a factor at all,
     * and they do not depend on the user being verified.
     */

    it("still rejects a response signed over a different challenge", async () => {
      const key: SecurityKey = makeKey(false);

      await UserWebAuthnService.generateRegistrationOptions({
        userId: USER_ID,
      });

      const credential: RegistrationResponse = key.register({
        challenge: Buffer.from("a challenge nobody issued").toString(
          "base64url",
        ),
      });

      await expect(
        UserWebAuthnService.verifyRegistration({
          credential: credential,
          name: KEY_NAME,
          props: { userId: USER_ID },
        }),
      ).rejects.toThrow(/challenge/i);
    });

    it("still rejects a response from another origin", async () => {
      /*
       * A credential minted by a phishing page on a look-alike domain. The
       * origin is bound into the client data the authenticator signs, so this
       * is the check that makes WebAuthn phishing-resistant -- the single most
       * valuable property it has, and entirely independent of UV.
       */
      const phishedKey: SecurityKey = createSecurityKey({
        rpId: RP_ID,
        origin: "https://oneuptime.example.com.evil.test",
        performsUserVerification: false,
      });

      const { options } = await UserWebAuthnService.generateRegistrationOptions(
        {
          userId: USER_ID,
        },
      );

      const credential: RegistrationResponse = phishedKey.register({
        challenge: options.challenge,
      });

      await expect(
        UserWebAuthnService.verifyRegistration({
          credential: credential,
          name: KEY_NAME,
          props: { userId: USER_ID },
        }),
      ).rejects.toThrow(/origin/i);
    });

    it("still rejects a response scoped to another relying party", async () => {
      const wrongRpKey: SecurityKey = createSecurityKey({
        rpId: "evil.test",
        origin: ORIGIN,
        performsUserVerification: false,
      });

      const { options } = await UserWebAuthnService.generateRegistrationOptions(
        {
          userId: USER_ID,
        },
      );

      const credential: RegistrationResponse = wrongRpKey.register({
        challenge: options.challenge,
      });

      await expect(
        UserWebAuthnService.verifyRegistration({
          credential: credential,
          name: KEY_NAME,
          props: { userId: USER_ID },
        }),
      ).rejects.toThrow(/RP ID/i);
    });

    it("still rejects an assertion signed by a different key", async () => {
      /*
       * Possession of the private key is the entire factor. An impostor
       * authenticator replaying the right credential id must fail on the
       * signature, and the UV bit has nothing to do with it.
       */
      const enrolled: SecurityKey = makeKey(false);
      seedRegisteredKey(enrolled);

      const impostor: SecurityKey = makeKey(false);

      const { options } =
        await UserWebAuthnService.generateAuthenticationOptions({
          email: USER_EMAIL.toString(),
        });

      const assertion: AuthenticationResponse = impostor.authenticate({
        challenge: options.challenge,
      });

      /* Answer to the enrolled credential's id, so only the signature differs. */
      assertion.id = enrolled.credentialId;
      assertion.rawId = enrolled.credentialId;

      await expect(
        UserWebAuthnService.verifyAuthentication({
          userId: USER_ID.toString(),
          credential: assertion,
        }),
      ).rejects.toThrow();
    });

    it("still rejects a response once its challenge has expired", async () => {
      const key: SecurityKey = makeKey(false);

      const { options } = await UserWebAuthnService.generateRegistrationOptions(
        {
          userId: USER_ID,
        },
      );

      storedChallengeExpiresAt = OneUptimeDate.addRemoveMinutes(
        OneUptimeDate.getCurrentDate(),
        -1,
      );

      const credential: RegistrationResponse = key.register({
        challenge: options.challenge,
      });

      await expect(
        UserWebAuthnService.verifyRegistration({
          credential: credential,
          name: KEY_NAME,
          props: { userId: USER_ID },
        }),
      ).rejects.toThrow(/expired/i);
    });

    it("still refuses to reuse a challenge that has already been spent", async () => {
      /*
       * The challenge is cleared as it is read, so a replay of the very same
       * credential -- captured off the wire -- finds nothing to verify
       * against. Registering twice in a row exercises exactly that.
       */
      const key: SecurityKey = makeKey(false);

      const { options } = await UserWebAuthnService.generateRegistrationOptions(
        {
          userId: USER_ID,
        },
      );

      const credential: RegistrationResponse = key.register({
        challenge: options.challenge,
      });

      await UserWebAuthnService.verifyRegistration({
        credential: credential,
        name: KEY_NAME,
        props: { userId: USER_ID },
      });

      await expect(
        UserWebAuthnService.verifyRegistration({
          credential: credential,
          name: KEY_NAME,
          props: { userId: USER_ID },
        }),
      ).rejects.toThrow(/no pending webauthn challenge/i);
    });
  });

  describe("the challenge the server issues and the challenge the key signs", () => {
    it("survives the browser's base64url round trip unchanged", async () => {
      /*
       * The dashboard turns the issued challenge into bytes with
       * `Base64.base64UrlToUint8Array` before handing it to
       * navigator.credentials, and the browser then base64url-encodes those
       * same bytes back into client data. The server compares that against the
       * string it stored, so the two encodings have to agree exactly.
       *
       * Asserted with the REAL helper the dashboard imports, because a change
       * to either end of this -- the `Buffer.from(...).toString("base64url")`
       * re-encoding in the service, or the helper -- breaks every registration
       * and every sign-in at once, with a "challenge" error that says nothing
       * about encodings.
       */
      const { options, challenge } =
        await UserWebAuthnService.generateRegistrationOptions({
          userId: USER_ID,
        });

      const asTheBrowserSendsItBack: string = Buffer.from(
        Base64.base64UrlToUint8Array(options.challenge),
      ).toString("base64url");

      expect(asTheBrowserSendsItBack).toBe(options.challenge);
      expect(challenge).toBe(options.challenge);
      expect(storedChallenge).toBe(options.challenge);
    });

    it("issues a different challenge every time", async () => {
      const first: { challenge: string } =
        await UserWebAuthnService.generateRegistrationOptions({
          userId: USER_ID,
        });

      const second: { challenge: string } =
        await UserWebAuthnService.generateRegistrationOptions({
          userId: USER_ID,
        });

      expect(first.challenge).not.toBe(second.challenge);
    });
  });

  describe("what the browser is told when verification fails", () => {
    /*
     * The other half of the bug report: "Get a 'Server Error' message, and the
     * above error in the console". @simplewebauthn/server signals every
     * refusal by throwing a plain `Error`, and the last-resort handler in
     * Common/Server/Utils/StartServer.ts has no branch for one -- it falls
     * through to `res.status(500).send({ error: "Server Error" })` and throws
     * the sentence away. So the diagnosis existed and simply never left the
     * server, which is why this took a bug report to find rather than a glance
     * at the screen.
     *
     * These assertions are about the SHAPE the failure arrives in, not about
     * the fix to user verification -- and they matter more now, not less. With
     * UV no longer able to fail, the remaining causes are configuration ones
     * a self-hoster has to be able to read: a reverse proxy serving an origin
     * that does not match HOST, or a relying party id that moved.
     */

    type ThrownByFunction = (run: () => Promise<unknown>) => Promise<unknown>;

    const thrownBy: ThrownByFunction = async (
      run: () => Promise<unknown>,
    ): Promise<unknown> => {
      try {
        await run();
      } catch (error) {
        return error;
      }

      throw new Error("Expected this to reject, and it resolved");
    };

    it("reports a mismatched origin as bad data, not as a server error", async () => {
      const phishedKey: SecurityKey = createSecurityKey({
        rpId: RP_ID,
        origin: "https://oneuptime.example.com.evil.test",
        performsUserVerification: true,
      });

      const { options } = await UserWebAuthnService.generateRegistrationOptions(
        {
          userId: USER_ID,
        },
      );

      const thrown: unknown = await thrownBy(() => {
        return UserWebAuthnService.verifyRegistration({
          credential: phishedKey.register({ challenge: options.challenge }),
          name: KEY_NAME,
          props: { userId: USER_ID },
        });
      });

      /*
       * `instanceof Exception` is the property the handler branches on. A
       * plain Error -- what the library throws and what this code path used to
       * let through -- takes the final `else` and is answered with a bare 500.
       */
      expect(thrown).toBeInstanceOf(Exception);
      expect(thrown).toBeInstanceOf(BadDataException);

      /* And a status the handler will actually accept, rather than falling back to 500. */
      expect(StatusCode.isValidStatusCode((thrown as Exception).code)).toBe(
        true,
      );
    });

    it("keeps the library's own explanation of what went wrong", async () => {
      /*
       * The message is the whole point. "Server Error" is indistinguishable
       * from a database outage; naming the origin the server expected tells a
       * self-hoster their proxy is rewriting it, which nothing else in the
       * product will tell them.
       */
      const wrongRpKey: SecurityKey = createSecurityKey({
        rpId: "evil.test",
        origin: ORIGIN,
        performsUserVerification: true,
      });

      const { options } = await UserWebAuthnService.generateRegistrationOptions(
        {
          userId: USER_ID,
        },
      );

      const thrown: unknown = await thrownBy(() => {
        return UserWebAuthnService.verifyRegistration({
          credential: wrongRpKey.register({ challenge: options.challenge }),
          name: KEY_NAME,
          props: { userId: USER_ID },
        });
      });

      expect((thrown as Exception).message).toMatch(/RP ID/i);
      expect((thrown as Exception).message).not.toBe("Server Error");
    });

    it("does the same for a failed sign-in", async () => {
      const enrolled: SecurityKey = makeKey(true);
      seedRegisteredKey(enrolled);

      const impostor: SecurityKey = makeKey(true);

      const { options } =
        await UserWebAuthnService.generateAuthenticationOptions({
          email: USER_EMAIL.toString(),
        });

      const assertion: AuthenticationResponse = impostor.authenticate({
        challenge: options.challenge,
      });

      assertion.id = enrolled.credentialId;
      assertion.rawId = enrolled.credentialId;

      const thrown: unknown = await thrownBy(() => {
        return UserWebAuthnService.verifyAuthentication({
          userId: USER_ID.toString(),
          credential: assertion,
        });
      });

      expect(thrown).toBeInstanceOf(Exception);
      expect((thrown as Exception).message).not.toBe("Server Error");
    });

    it("does not flatten the errors this service raises itself", async () => {
      /*
       * The wrapper turns library Errors into Exceptions and must leave our
       * own alone. "WebAuthn challenge has expired. Please initiate the
       * WebAuthn flow again." is actionable in a way no library message is,
       * and re-wrapping it would replace it with whatever the library said
       * next -- or with the generic fallback.
       */
      const key: SecurityKey = makeKey(true);

      const { options } = await UserWebAuthnService.generateRegistrationOptions(
        {
          userId: USER_ID,
        },
      );

      storedChallengeExpiresAt = OneUptimeDate.addRemoveMinutes(
        OneUptimeDate.getCurrentDate(),
        -1,
      );

      const thrown: unknown = await thrownBy(() => {
        return UserWebAuthnService.verifyRegistration({
          credential: key.register({ challenge: options.challenge }),
          name: KEY_NAME,
          props: { userId: USER_ID },
        });
      });

      expect(thrown).toBeInstanceOf(BadDataException);
      expect((thrown as Exception).message).toMatch(/challenge has expired/i);
    });
  });

  describe("a full enrol-then-sign-in journey from one clamshell laptop", () => {
    it("registers a key with UV clear and then signs in with it", async () => {
      /*
       * The two halves of the bug in one test, in the order the user meets
       * them. Neither half alone is the user's problem: what they wanted was
       * to set up a passkey and then use it, and before the fix the first
       * step failed -- and had it not, the second would have.
       *
       * The credential row is built from what registration actually persisted
       * rather than from the fixture, so the public key really does make the
       * round trip through the base64 the column stores.
       */
      const key: SecurityKey = makeKey(false);

      await register(key);

      const persisted: UserWebAuthn = new UserWebAuthn();
      persisted.id = new ObjectID("99998888-7777-6666-8555-444433332222");
      persisted.credentialId = createdCredential!.credentialId!;
      persisted.publicKey = createdCredential!.publicKey!;
      persisted.counter = createdCredential!.counter!;
      persisted.isVerified = true;
      persisted.userId = USER_ID;

      existingCredentials = [persisted];

      const user: User = await authenticate(key);

      expect(user.id!.toString()).toBe(USER_ID.toString());
    });
  });
});
