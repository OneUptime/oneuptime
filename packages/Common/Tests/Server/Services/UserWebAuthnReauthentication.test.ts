import "../TestingUtils/WebAuthnServiceMocks";
import UserWebAuthnService from "../../../Server/Services/UserWebAuthnService";
import Redis from "../../../Server/Infrastructure/Redis";
import UserWebAuthn from "../../../Models/DatabaseModels/UserWebAuthn";
import {
  REAUTHENTICATION_MESSAGES,
  ReauthenticationWebAuthnKind,
} from "../../../Types/Accounts/Reauthentication";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";

/*
 * A KEY'S ANSWER TO "CONFIRM IT'S YOU" (#10155,
 * UserWebAuthnService.generateReauthenticationOptions and
 * verifyReauthentication).
 *
 *   - A passkey on its own: only the account's passkeys are offered (a key
 *     registered as a second step only is not), and the device must check
 *     its person (user verification required, and verified).
 *   - A security key as the second step after the password: every key of
 *     the account, asked as the sign-in's second step asks.
 *   - The challenge is the session's own: made for one session, one kind
 *     and one account, spent whether or not it verifies, answering for no
 *     other.
 *   - A credential of somebody else's account is never accepted.
 */

const USER_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SESSION_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OTHER_SESSION_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const CHALLENGE: string = "reauthentication-challenge";

function key(data: {
  id: string;
  isPasskey: boolean | null;
  userId?: ObjectID;
}): UserWebAuthn {
  const credential: UserWebAuthn = new UserWebAuthn();
  credential._id = `${data.id}-row`;
  credential.userId = data.userId || USER_ID;
  credential.credentialId = data.id;
  credential.publicKey = Buffer.from(`${data.id}-public-key`).toString(
    "base64",
  );
  credential.counter = "3";
  credential.transports = JSON.stringify(["internal"]);
  (credential as unknown as { isPasskey: boolean | null }).isPasskey =
    data.isPasskey;
  return credential;
}

describe("a key's answer to Confirm It's You", () => {
  let store: Map<string, string>;
  let client: { set: jest.Mock; eval: jest.Mock };
  let keys: Array<UserWebAuthn>;
  let credentialLookup: jest.SpyInstance;
  let updateCredential: jest.SpyInstance;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    store = new Map<string, string>();
    client = {
      set: jest.fn(async (key: string, value: string): Promise<string> => {
        store.set(key, value);
        return "OK";
      }),
      // The challenge's GET-and-DEL.
      eval: jest.fn(
        async (
          _script: string,
          _count: number,
          key: string,
        ): Promise<string | null> => {
          const value: string | undefined = store.get(key);
          store.delete(key);
          return value || null;
        },
      ),
    };
    getJestSpyOn(Redis, "getClient").mockReturnValue(client);
    getJestSpyOn(Redis, "isConnected").mockReturnValue(true);

    keys = [
      key({ id: "passkey", isPasskey: true }),
      key({ id: "older-key", isPasskey: null }),
      key({ id: "second-step-key", isPasskey: false }),
    ];

    getJestSpyOn(UserWebAuthnService, "findBy").mockImplementation(
      async (): Promise<Array<UserWebAuthn>> => {
        return keys;
      },
    );
    credentialLookup = getJestSpyOn(
      UserWebAuthnService,
      "findOneBy",
    ).mockImplementation(
      async (data: {
        query: { credentialId: string; userId: ObjectID };
      }): Promise<UserWebAuthn | null> => {
        return (
          keys.find((candidate: UserWebAuthn): boolean => {
            return (
              candidate.credentialId === data.query.credentialId &&
              candidate.userId?.toString() === data.query.userId.toString()
            );
          }) || null
        );
      },
    );
    updateCredential = getJestSpyOn(
      UserWebAuthnService,
      "updateOneById",
    ).mockResolvedValue(1);

    (generateAuthenticationOptions as jest.Mock).mockResolvedValue({
      challenge: CHALLENGE,
    });
    (verifyAuthenticationResponse as jest.Mock).mockResolvedValue({
      verified: true,
      authenticationInfo: { userVerified: true, newCounter: 4 },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const optionsFor: (
    kind: ReauthenticationWebAuthnKind,
  ) => Promise<{ options: any }> = async (
    kind: ReauthenticationWebAuthnKind,
  ): Promise<{ options: any }> => {
    return await UserWebAuthnService.generateReauthenticationOptions({
      userId: USER_ID,
      sessionId: SESSION_ID,
      kind: kind,
    });
  };

  const answer: (data: {
    kind: ReauthenticationWebAuthnKind;
    credentialId?: string;
    userId?: ObjectID;
    sessionId?: ObjectID;
  }) => Promise<void> = async (data: {
    kind: ReauthenticationWebAuthnKind;
    credentialId?: string;
    userId?: ObjectID;
    sessionId?: ObjectID;
  }): Promise<void> => {
    return await UserWebAuthnService.verifyReauthentication({
      userId: data.userId || USER_ID,
      sessionId: data.sessionId || SESSION_ID,
      kind: data.kind,
      credential: {
        id: data.credentialId || "passkey",
        rawId: data.credentialId || "passkey",
        type: "public-key",
        response: {},
      },
    });
  };

  describe("the options", () => {
    test("a passkey's: the account's passkeys only, with the device's check of its person required", async () => {
      await optionsFor(ReauthenticationWebAuthnKind.Passkey);

      const asked: any = (generateAuthenticationOptions as jest.Mock).mock
        .calls[0]![0];

      expect(asked.userVerification).toBe("required");
      expect(
        asked.allowCredentials.map((credential: { id: string }) => {
          return credential.id;
        }),
      ).toEqual(["passkey", "older-key"]);
      expect(asked.allowCredentials[0].transports).toEqual(["internal"]);
    });

    test("a security key's: every key of the account, asked as the sign-in's second step asks", async () => {
      await optionsFor(ReauthenticationWebAuthnKind.SecurityKey);

      const asked: any = (generateAuthenticationOptions as jest.Mock).mock
        .calls[0]![0];

      expect(asked.userVerification).toBe("preferred");
      expect(asked.allowCredentials).toHaveLength(3);
    });

    test("the challenge is kept for the session, with its kind and its account, for five minutes", async () => {
      await optionsFor(ReauthenticationWebAuthnKind.Passkey);

      expect(client.set).toHaveBeenCalledWith(
        `webauthn-reauthentication-${SESSION_ID.toString()}`,
        JSON.stringify({
          challenge: CHALLENGE,
          kind: ReauthenticationWebAuthnKind.Passkey,
          userId: USER_ID.toString(),
        }),
        "EX",
        300,
      );
    });

    test("an account with no passkey, or no key, is told so and nothing is kept", async () => {
      keys = [key({ id: "second-step-key", isPasskey: false })];

      await expect(
        optionsFor(ReauthenticationWebAuthnKind.Passkey),
      ).rejects.toThrow(
        new BadDataException(REAUTHENTICATION_MESSAGES.noPasskey),
      );

      keys = [];

      await expect(
        optionsFor(ReauthenticationWebAuthnKind.SecurityKey),
      ).rejects.toThrow(
        new BadDataException(REAUTHENTICATION_MESSAGES.noSecurityKey),
      );

      expect(client.set).not.toHaveBeenCalled();
    });
  });

  describe("the answer", () => {
    test("a passkey's answer confirms: checked against the session's challenge, the device's check required, the counter moved on", async () => {
      await optionsFor(ReauthenticationWebAuthnKind.Passkey);

      await expect(
        answer({ kind: ReauthenticationWebAuthnKind.Passkey }),
      ).resolves.toBeUndefined();

      const checked: any = (verifyAuthenticationResponse as jest.Mock).mock
        .calls[0]![0];

      expect(checked.expectedChallenge).toBe(CHALLENGE);
      expect(checked.requireUserVerification).toBe(true);
      expect(checked.credential.id).toBe("passkey");
      expect(updateCredential).toHaveBeenCalledWith(
        expect.objectContaining({ data: { counter: "4" } }),
      );
    });

    test("a security key's answer is checked as the sign-in's second step checks it", async () => {
      (verifyAuthenticationResponse as jest.Mock).mockResolvedValue({
        verified: true,
        authenticationInfo: { userVerified: false, newCounter: 4 },
      });
      await optionsFor(ReauthenticationWebAuthnKind.SecurityKey);

      await expect(
        answer({
          kind: ReauthenticationWebAuthnKind.SecurityKey,
          credentialId: "second-step-key",
        }),
      ).resolves.toBeUndefined();

      expect(
        (verifyAuthenticationResponse as jest.Mock).mock.calls[0]![0]
          .requireUserVerification,
      ).toBe(false);
    });

    test("the challenge works once", async () => {
      await optionsFor(ReauthenticationWebAuthnKind.Passkey);
      await answer({ kind: ReauthenticationWebAuthnKind.Passkey });

      await expect(
        answer({ kind: ReauthenticationWebAuthnKind.Passkey }),
      ).rejects.toThrow(
        new BadDataException(REAUTHENTICATION_MESSAGES.passkeyNotAccepted),
      );
    });

    test.each([
      [
        "with no challenge made",
        async (): Promise<void> => {
          return;
        },
        { kind: ReauthenticationWebAuthnKind.Passkey },
      ],
      [
        "to another session's challenge",
        async (): Promise<void> => {
          await optionsFor(ReauthenticationWebAuthnKind.Passkey);
        },
        {
          kind: ReauthenticationWebAuthnKind.Passkey,
          sessionId: OTHER_SESSION_ID,
        },
      ],
      [
        "to a challenge made for a security key",
        async (): Promise<void> => {
          await optionsFor(ReauthenticationWebAuthnKind.SecurityKey);
        },
        { kind: ReauthenticationWebAuthnKind.Passkey },
      ],
      [
        "with a key registered as a second step only",
        async (): Promise<void> => {
          await optionsFor(ReauthenticationWebAuthnKind.Passkey);
        },
        {
          kind: ReauthenticationWebAuthnKind.Passkey,
          credentialId: "second-step-key",
        },
      ],
      [
        "with a credential the account does not have",
        async (): Promise<void> => {
          await optionsFor(ReauthenticationWebAuthnKind.Passkey);
        },
        {
          kind: ReauthenticationWebAuthnKind.Passkey,
          credentialId: "someone-elses-passkey",
        },
      ],
    ] as Array<
      [
        string,
        () => Promise<void>,
        {
          kind: ReauthenticationWebAuthnKind;
          credentialId?: string;
          sessionId?: ObjectID;
        },
      ]
    >)(
      "an answer %s is not accepted",
      async (
        _name: string,
        before: () => Promise<void>,
        data: {
          kind: ReauthenticationWebAuthnKind;
          credentialId?: string;
          sessionId?: ObjectID;
        },
      ) => {
        keys.push(
          key({
            id: "someone-elses-passkey",
            isPasskey: true,
            userId: OTHER_USER_ID,
          }),
        );
        await before();

        await expect(answer(data)).rejects.toThrow(
          new BadDataException(
            data.kind === ReauthenticationWebAuthnKind.Passkey
              ? REAUTHENTICATION_MESSAGES.passkeyNotAccepted
              : REAUTHENTICATION_MESSAGES.securityKeyNotAccepted,
          ),
        );
        expect(updateCredential).not.toHaveBeenCalled();
      },
    );

    test("a passkey whose device did not check its person is not accepted", async () => {
      (verifyAuthenticationResponse as jest.Mock).mockResolvedValue({
        verified: true,
        authenticationInfo: { userVerified: false, newCounter: 4 },
      });
      await optionsFor(ReauthenticationWebAuthnKind.Passkey);

      await expect(
        answer({ kind: ReauthenticationWebAuthnKind.Passkey }),
      ).rejects.toThrow(
        new BadDataException(REAUTHENTICATION_MESSAGES.passkeyNotAccepted),
      );
    });

    test("an answer the library refuses is not accepted, in OneUptime's words", async () => {
      (verifyAuthenticationResponse as jest.Mock).mockRejectedValue(
        new Error("Unexpected authentication response origin"),
      );
      await optionsFor(ReauthenticationWebAuthnKind.Passkey);

      await expect(
        answer({ kind: ReauthenticationWebAuthnKind.Passkey }),
      ).rejects.toThrow(
        new BadDataException(REAUTHENTICATION_MESSAGES.passkeyNotAccepted),
      );
    });

    test("the credential is looked up for the session's account, never across accounts", async () => {
      await optionsFor(ReauthenticationWebAuthnKind.Passkey);
      await answer({ kind: ReauthenticationWebAuthnKind.Passkey });

      expect(credentialLookup.mock.calls[0]![0].query).toEqual({
        credentialId: "passkey",
        userId: USER_ID,
        isVerified: true,
      });
    });
  });
});
