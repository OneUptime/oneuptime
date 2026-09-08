import UserWebAuthnService from "../../../Server/Services/UserWebAuthnService";
import UserService from "../../../Server/Services/UserService";
import User from "../../../Models/DatabaseModels/User";
import UserWebAuthn from "../../../Models/DatabaseModels/UserWebAuthn";
import Email from "../../../Types/Email";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * The user verification POLICY, held down at the seam where it was broken.
 *
 * Issue #3652: a passkey could not be registered from a MacBook running folded
 * shut, because the policy lives in two places and they had drifted apart.
 * `generateRegistrationOptions` told the authenticator that verifying the user
 * was "preferred" -- go ahead without it if you cannot -- and then
 * `verifyRegistrationResponse`, left on its own default of
 * `requireUserVerification: true`, refused the response that invitation
 * produced. The same default sits on `verifyAuthenticationResponse`, so the
 * same account could not sign in from the same laptop either.
 *
 * WHAT THIS FILE IS FOR, AND WHAT IT DELIBERATELY IS NOT
 *
 * Common's jest config maps `@simplewebauthn/server` to a stub
 * (Common/Tests/__mocks__/simplewebauthn.js). A stub has no library default,
 * so nothing here can demonstrate the FAILURE -- a test of that written
 * against the stub would have passed before the fix and after it, which is
 * worse than no test. The demonstration lives in
 * App/Tests/FeatureSet/Identity/WebAuthnUserVerification.test.ts, where the
 * real v13 library verifies real ES256 assertions from an authenticator that
 * leaves the UV bit clear.
 *
 * What belongs HERE is the invariant that made the failure possible in the
 * first place, and which is invisible end-to-end: that the ASK and the CHECK
 * are the same policy. Both are arguments this service passes to the library,
 * so both can be read straight off the call, and the agreement between them
 * asserted directly. That is the property a future edit will break -- someone
 * tightening one call site without the other -- and it breaks here loudly,
 * without waiting on the four-minute end-to-end suite.
 *
 * These assertions are written against `requireUserVerification` being
 * PRESENT, not merely falsy. Omitting the argument is what the bug WAS, and
 * `undefined` is indistinguishable from `false` under `toBeFalsy()`.
 * ---------------------------------------------------------------------------
 */

const USER_ID: ObjectID = new ObjectID("7c1f2e3d-4a5b-4c6d-8e7f-081920304050");
const USER_EMAIL: Email = new Email("policy.user@example.com");

const CREDENTIAL_ID: string = "an-already-registered-credential";

type AsMockFunction = (fn: unknown) => jest.Mock;

const asMock: AsMockFunction = (fn: unknown): jest.Mock => {
  return fn as unknown as jest.Mock;
};

type FirstArgumentFunction = (fn: unknown) => Record<string, unknown>;

const firstArgument: FirstArgumentFunction = (
  fn: unknown,
): Record<string, unknown> => {
  const call: Array<unknown> | undefined = asMock(fn).mock.calls[0];

  if (!call) {
    throw new Error(
      "Expected the service to have called this library function",
    );
  }

  return call[0] as Record<string, unknown>;
};

type BuildUserFunction = () => User;

const buildUser: BuildUserFunction = (): User => {
  const user: User = new User();
  user.id = USER_ID;
  user.email = USER_EMAIL;

  /*
   * A live, unexpired challenge, so verification gets past
   * `getAndClearStoredChallenge` and reaches the library call under test. The
   * value is whatever the stub issues.
   */
  user.webauthnChallenge = "mock-challenge";
  user.webauthnChallengeExpiresAt = OneUptimeDate.addRemoveMinutes(
    OneUptimeDate.getCurrentDate(),
    5,
  );

  return user;
};

type BuildCredentialRowFunction = () => UserWebAuthn;

const buildCredentialRow: BuildCredentialRowFunction = (): UserWebAuthn => {
  const row: UserWebAuthn = new UserWebAuthn();
  row.id = new ObjectID("0a0b0c0d-1e1f-4a2b-8c3d-4e5f60718293");
  row.credentialId = CREDENTIAL_ID;
  row.publicKey = Buffer.from("a public key").toString("base64");
  row.counter = "0";
  row.isVerified = true;
  row.userId = USER_ID;

  return row;
};

/* A credential body shaped the way navigator.credentials returns one. */
const CREDENTIAL_FROM_THE_BROWSER: Record<string, unknown> = {
  id: CREDENTIAL_ID,
  rawId: CREDENTIAL_ID,
  type: "public-key",
  response: {
    clientDataJSON: "client-data",
    attestationObject: "attestation",
    authenticatorData: "authenticator-data",
    signature: "signature",
  },
  clientExtensionResults: {},
};

beforeEach(() => {
  jest.clearAllMocks();

  UserService.findOneById = jest.fn().mockResolvedValue(buildUser()) as never;
  UserService.findOneBy = jest.fn().mockResolvedValue(buildUser()) as never;
  UserService.updateOneById = jest.fn().mockResolvedValue(undefined) as never;

  UserWebAuthnService.findBy = jest
    .fn()
    .mockResolvedValue([buildCredentialRow()]) as never;
  UserWebAuthnService.findOneBy = jest
    .fn()
    .mockResolvedValue(buildCredentialRow()) as never;
  UserWebAuthnService.create = jest.fn().mockResolvedValue({}) as never;
  UserWebAuthnService.updateOneById = jest
    .fn()
    .mockResolvedValue(undefined) as never;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("UserWebAuthnService user verification policy", () => {
  describe("registration", () => {
    test("asks the authenticator for preferred user verification", async () => {
      await UserWebAuthnService.generateRegistrationOptions({
        userId: USER_ID,
      });

      const options: Record<string, unknown> = firstArgument(
        generateRegistrationOptions,
      );

      const authenticatorSelection: Record<string, unknown> = options[
        "authenticatorSelection"
      ] as Record<string, unknown>;

      expect(authenticatorSelection["userVerification"]).toBe("preferred");
    });

    test("tells the verifier explicitly not to require it", async () => {
      /*
       * The single line the bug was missing. Asserted on its PRESENCE as well
       * as its value: leaving the property off is precisely what went wrong,
       * and the library then supplies `true` on our behalf.
       */
      await UserWebAuthnService.verifyRegistration({
        credential: CREDENTIAL_FROM_THE_BROWSER,
        name: "MacBook Touch ID",
        props: { userId: USER_ID },
      });

      const verification: Record<string, unknown> = firstArgument(
        verifyRegistrationResponse,
      );

      expect(verification).toHaveProperty("requireUserVerification");
      expect(verification["requireUserVerification"]).toBe(false);
    });
  });

  describe("authentication", () => {
    test("asks the authenticator for preferred user verification", async () => {
      await UserWebAuthnService.generateAuthenticationOptions({
        email: USER_EMAIL.toString(),
      });

      const options: Record<string, unknown> = firstArgument(
        generateAuthenticationOptions,
      );

      expect(options["userVerification"]).toBe("preferred");
    });

    test("tells the verifier explicitly not to require it", async () => {
      /*
       * The half of the bug that was never reported, because registration
       * failed first. It is the more dangerous half: the password has already
       * been accepted by the time an assertion is checked, so a refusal here
       * is a locked account rather than a failed setup.
       */
      await UserWebAuthnService.verifyAuthentication({
        userId: USER_ID.toString(),
        credential: CREDENTIAL_FROM_THE_BROWSER,
      });

      const verification: Record<string, unknown> = firstArgument(
        verifyAuthenticationResponse,
      );

      expect(verification).toHaveProperty("requireUserVerification");
      expect(verification["requireUserVerification"]).toBe(false);
    });
  });

  describe("the ask and the check describe the same policy", () => {
    /*
     * THE INVARIANT, and the reason this file exists alongside the end-to-end
     * test. Neither half is wrong on its own -- "preferred" is a legitimate
     * ask and `requireUserVerification: true` is a legitimate check. The
     * defect was the PAIR disagreeing, which no assertion on either half alone
     * can catch.
     *
     * Stated as an equivalence rather than as two literals so that tightening
     * the product's policy to "required" one day stays green here as long as
     * BOTH sides move, and goes red the moment only one does.
     */

    type PolicyPair = {
      requested: unknown;
      required: unknown;
    };

    type AssertAgreementFunction = (pair: PolicyPair) => void;

    const assertAgreement: AssertAgreementFunction = (
      pair: PolicyPair,
    ): void => {
      expect(pair.requested).toEqual(expect.any(String));
      expect(typeof pair.required).toBe("boolean");
      expect(pair.required).toBe(pair.requested === "required");
    };

    test("on the registration flow", async () => {
      await UserWebAuthnService.generateRegistrationOptions({
        userId: USER_ID,
      });

      await UserWebAuthnService.verifyRegistration({
        credential: CREDENTIAL_FROM_THE_BROWSER,
        name: "MacBook Touch ID",
        props: { userId: USER_ID },
      });

      const requested: Record<string, unknown> = firstArgument(
        generateRegistrationOptions,
      )["authenticatorSelection"] as Record<string, unknown>;

      assertAgreement({
        requested: requested["userVerification"],
        required: firstArgument(verifyRegistrationResponse)[
          "requireUserVerification"
        ],
      });
    });

    test("on the authentication flow", async () => {
      await UserWebAuthnService.generateAuthenticationOptions({
        email: USER_EMAIL.toString(),
      });

      await UserWebAuthnService.verifyAuthentication({
        userId: USER_ID.toString(),
        credential: CREDENTIAL_FROM_THE_BROWSER,
      });

      assertAgreement({
        requested: firstArgument(generateAuthenticationOptions)[
          "userVerification"
        ],
        required: firstArgument(verifyAuthenticationResponse)[
          "requireUserVerification"
        ],
      });
    });

    test("and the two flows agree with each other", async () => {
      /*
       * Registration and authentication are separate call sites with separate
       * arguments, and a key is enrolled by one and used by the other. A
       * product that asked for "preferred" at enrolment and "required" at
       * sign-in would let a user set up an authenticator they could then never
       * sign in with -- the worst version of this bug, because it only
       * surfaces later, on a different machine, after the password has been
       * accepted.
       */
      await UserWebAuthnService.generateRegistrationOptions({
        userId: USER_ID,
      });

      await UserWebAuthnService.generateAuthenticationOptions({
        email: USER_EMAIL.toString(),
      });

      const registrationSelection: Record<string, unknown> = firstArgument(
        generateRegistrationOptions,
      )["authenticatorSelection"] as Record<string, unknown>;

      expect(registrationSelection["userVerification"]).toBe(
        firstArgument(generateAuthenticationOptions)["userVerification"],
      );
    });
  });

  describe("how a refusal from the library reaches the caller", () => {
    /*
     * The second half of the bug report -- "Get a 'Server Error' message" --
     * and the reason the first half went undiagnosed. @simplewebauthn signals
     * every refusal with a plain `Error`, and the last-resort handler in
     * Common/Server/Utils/StartServer.ts has no branch for one: it answers
     * `res.status(500).send({ error: "Server Error" })` and drops the message.
     *
     * Fast to assert here because the stub can be made to reject on demand;
     * the end-to-end version, with the real library producing its own real
     * messages, lives in
     * App/Tests/FeatureSet/Identity/WebAuthnUserVerification.test.ts.
     */

    const LIBRARY_REFUSAL: Error = new Error(
      'Unexpected registration response origin "https://evil.test", expected "https://oneuptime.example.com"',
    );

    test("a registration refusal becomes an Exception carrying the reason", async () => {
      asMock(verifyRegistrationResponse).mockRejectedValueOnce(LIBRARY_REFUSAL);

      let thrown: unknown = null;

      try {
        await UserWebAuthnService.verifyRegistration({
          credential: CREDENTIAL_FROM_THE_BROWSER,
          name: "MacBook Touch ID",
          props: { userId: USER_ID },
        });
      } catch (error) {
        thrown = error;
      }

      /*
       * `instanceof Exception` is exactly what the handler branches on, so it
       * is the property worth asserting -- not merely "it threw".
       */
      expect(thrown).toBeInstanceOf(BadDataException);
      expect((thrown as Exception).message).toBe(LIBRARY_REFUSAL.message);
    });

    test("an authentication refusal does the same", async () => {
      asMock(verifyAuthenticationResponse).mockRejectedValueOnce(
        LIBRARY_REFUSAL,
      );

      let thrown: unknown = null;

      try {
        await UserWebAuthnService.verifyAuthentication({
          userId: USER_ID.toString(),
          credential: CREDENTIAL_FROM_THE_BROWSER,
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(BadDataException);
      expect((thrown as Exception).message).toBe(LIBRARY_REFUSAL.message);
    });

    test("a refusal with nothing to say still says something", async () => {
      /*
       * Defensive, and cheap: an Error with an empty message would otherwise
       * produce an empty-bodied 400, which reads to the user as a page that
       * simply did nothing.
       */
      asMock(verifyRegistrationResponse).mockRejectedValueOnce(new Error(""));

      await expect(
        UserWebAuthnService.verifyRegistration({
          credential: CREDENTIAL_FROM_THE_BROWSER,
          name: "MacBook Touch ID",
          props: { userId: USER_ID },
        }),
      ).rejects.toThrow(/could not verify this security key/i);
    });

    test("a response the library merely marks unverified is still refused", async () => {
      /*
       * The library has two ways of saying no -- throwing, and returning
       * `verified: false` -- and the wrapper only touches the first. The
       * second must keep reaching the caller as it always did, or a
       * credential that failed verification would be saved.
       */
      asMock(verifyRegistrationResponse).mockResolvedValueOnce({
        verified: false,
      });

      await expect(
        UserWebAuthnService.verifyRegistration({
          credential: CREDENTIAL_FROM_THE_BROWSER,
          name: "MacBook Touch ID",
          props: { userId: USER_ID },
        }),
      ).rejects.toThrow(/registration verification failed/i);

      expect(UserWebAuthnService.create).not.toHaveBeenCalled();
    });
  });

  describe("what the policy does not touch", () => {
    test("the challenge is still taken from the server, never from the caller", async () => {
      /*
       * Relaxing user verification removes one check, and this is the check it
       * must not be confused with. The challenge is what makes a response
       * fresh; it is read from the User row rather than from the request, and
       * it is what the library is told to expect.
       */
      await UserWebAuthnService.verifyRegistration({
        credential: {
          ...CREDENTIAL_FROM_THE_BROWSER,
          expectedChallenge: "a challenge the caller would like used",
        },
        name: "MacBook Touch ID",
        props: { userId: USER_ID },
      });

      expect(
        firstArgument(verifyRegistrationResponse)["expectedChallenge"],
      ).toBe("mock-challenge");
    });

    test("the origin and relying party are still pinned", async () => {
      /*
       * Phishing resistance, which has nothing to do with user verification
       * and everything to do with these two arguments being present at all.
       */
      await UserWebAuthnService.verifyAuthentication({
        userId: USER_ID.toString(),
        credential: CREDENTIAL_FROM_THE_BROWSER,
      });

      const verification: Record<string, unknown> = firstArgument(
        verifyAuthenticationResponse,
      );

      expect(verification["expectedOrigin"]).toEqual(expect.any(String));
      expect(verification["expectedRPID"]).toEqual(expect.any(String));
    });

    test("the challenge is still spent as it is read", async () => {
      /*
       * One-time use: the row is cleared during verification, so the same
       * captured response cannot be replayed. Asserted here because it is the
       * other write this code path makes to the User row, and a refactor of
       * the policy constants sits close enough to it to disturb it.
       */
      await UserWebAuthnService.verifyRegistration({
        credential: CREDENTIAL_FROM_THE_BROWSER,
        name: "MacBook Touch ID",
        props: { userId: USER_ID },
      });

      const clearing: Array<unknown> = asMock(
        UserService.updateOneById,
      ).mock.calls.map((call: Array<unknown>): unknown => {
        return (call[0] as { data: Record<string, unknown> }).data[
          "webauthnChallenge"
        ];
      });

      expect(clearing).toContain(null);
    });
  });
});
