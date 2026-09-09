import "../TestingUtils/WebAuthnServiceMocks";
import UserWebAuthnService from "../../../Server/Services/UserWebAuthnService";
import UserService from "../../../Server/Services/UserService";
import Redis from "../../../Server/Infrastructure/Redis";
import { Host, HttpProtocol } from "../../../Server/EnvironmentConfig";
import logger from "../../../Server/Utils/Logger";
import User from "../../../Models/DatabaseModels/User";
import UserWebAuthn from "../../../Models/DatabaseModels/UserWebAuthn";
import Email from "../../../Types/Email";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { URL } from "url";

const USER_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const CREDENTIAL_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CHALLENGE: string = Buffer.from("server-generated-challenge").toString(
  "base64url",
);
const USER_HANDLE: string = Buffer.from(USER_ID.toString()).toString(
  "base64url",
);

interface CachedChallenge {
  value: string;
  expiresAt: number;
}

describe("UserWebAuthnService passkeys", () => {
  let cache: Map<string, CachedChallenge>;
  let now: number;
  let client: { set: jest.Mock; eval: jest.Mock };
  let user: User;
  let storedCredential: UserWebAuthn;
  let userLookup: jest.SpyInstance;
  let credentialLookup: jest.SpyInstance;
  let updateCredential: jest.SpyInstance;
  let createCredential: jest.SpyInstance;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    now = Date.now();
    cache = new Map();
    client = {
      set: jest.fn(
        async (
          key: string,
          value: string,
          _ex: string,
          ttl: number,
        ): Promise<string> => {
          cache.set(key, { value, expiresAt: now + ttl * 1000 });
          return "OK";
        },
      ),
      eval: jest.fn(
        async (
          _script: string,
          _count: number,
          key: string,
        ): Promise<string | null> => {
          const entry: CachedChallenge | undefined = cache.get(key);
          cache.delete(key);
          return entry && entry.expiresAt > now ? entry.value : null;
        },
      ),
    };
    getJestSpyOn(Redis, "getClient").mockReturnValue(client);
    getJestSpyOn(Redis, "isConnected").mockReturnValue(true);
    getJestSpyOn(logger, "error").mockImplementation(() => {});
    user = new User();
    user._id = USER_ID.toString();
    user.email = new Email("passkey@example.com");
    storedCredential = new UserWebAuthn();
    storedCredential._id = CREDENTIAL_ID.toString();
    storedCredential.userId = USER_ID;
    storedCredential.credentialId = "saved-credential";
    storedCredential.publicKey = Buffer.from("public-key").toString("base64");
    storedCredential.counter = "7";
    userLookup = getJestSpyOn(UserService, "findOneById").mockResolvedValue(
      user,
    );
    getJestSpyOn(UserService, "findOneBy").mockResolvedValue(user);
    getJestSpyOn(UserService, "updateOneById").mockResolvedValue(1);
    credentialLookup = getJestSpyOn(
      UserWebAuthnService,
      "findOneBy",
    ).mockResolvedValue(storedCredential);
    getJestSpyOn(UserWebAuthnService, "findBy").mockResolvedValue([]);
    updateCredential = getJestSpyOn(
      UserWebAuthnService,
      "updateOneById",
    ).mockResolvedValue(1);
    createCredential = getJestSpyOn(
      UserWebAuthnService,
      "create",
    ).mockResolvedValue(storedCredential);
    (generateAuthenticationOptions as jest.Mock).mockResolvedValue({
      challenge: CHALLENGE,
    });
    (generateRegistrationOptions as jest.Mock).mockResolvedValue({
      challenge: CHALLENGE,
    });
    (verifyAuthenticationResponse as jest.Mock).mockResolvedValue({
      verified: true,
      authenticationInfo: { userVerified: true, newCounter: 8 },
    });
    (verifyRegistrationResponse as jest.Mock).mockResolvedValue({
      verified: true,
      registrationInfo: {
        userVerified: true,
        credential: {
          id: "new-credential",
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 12,
          transports: ["internal", "hybrid"],
        },
      },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const assertion: () => any = (): any => {
    return {
      id: "saved-credential",
      rawId: "saved-credential",
      type: "public-key",
      response: {
        userHandle: USER_HANDLE,
        clientDataJSON: "client-data",
        authenticatorData: "authenticator-data",
        signature: "signature",
      },
    };
  };

  const authenticate: (credential?: any) => Promise<User> = async (
    credential: any = assertion(),
  ): Promise<User> => {
    const { challengeId } =
      await UserWebAuthnService.generatePasskeyAuthenticationOptions();
    return UserWebAuthnService.verifyPasskeyAuthentication({
      challengeId,
      credential,
    });
  };

  test("offers discoverable credentials with mandatory user verification without looking up an email", async () => {
    const result: any =
      await UserWebAuthnService.generatePasskeyAuthenticationOptions();
    expect(generateAuthenticationOptions).toHaveBeenCalledWith({
      rpID: new URL(`${HttpProtocol}${Host}`).hostname,
      allowCredentials: [],
      userVerification: "required",
    });
    expect(result.options.challenge).toBe(CHALLENGE);
    expect(result.challengeId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.challengeId).not.toBe(CHALLENGE);
    expect(userLookup).not.toHaveBeenCalled();
    expect(credentialLookup).not.toHaveBeenCalled();
    expect(UserService.findOneBy).not.toHaveBeenCalled();
  });

  test("sets the challenge and its five minute expiry atomically", async () => {
    const { challengeId } =
      await UserWebAuthnService.generatePasskeyAuthenticationOptions();
    expect(client.set).toHaveBeenCalledWith(
      `webauthn-passkey-login-${challengeId}`,
      CHALLENGE,
      "EX",
      300,
    );
    expect(UserService.updateOneById).not.toHaveBeenCalled();
  });

  test("keeps concurrent login ceremonies independent", async () => {
    const [first, second] = await Promise.all([
      UserWebAuthnService.generatePasskeyAuthenticationOptions(),
      UserWebAuthnService.generatePasskeyAuthenticationOptions(),
    ]);
    expect(first.challengeId).not.toBe(second.challengeId);
    await expect(
      UserWebAuthnService.verifyPasskeyAuthentication({
        challengeId: first.challengeId,
        credential: assertion(),
      }),
    ).resolves.toBe(user);
    await expect(
      UserWebAuthnService.verifyPasskeyAuthentication({
        challengeId: second.challengeId,
        credential: assertion(),
      }),
    ).resolves.toBe(user);
  });

  test("verifies against the server challenge, configured origin, RPID, saved key and counter", async () => {
    await expect(authenticate()).resolves.toBe(user);
    expect(verifyAuthenticationResponse).toHaveBeenCalledWith({
      response: assertion(),
      expectedChallenge: CHALLENGE,
      expectedOrigin: new URL(`${HttpProtocol}${Host}`).origin,
      expectedRPID: new URL(`${HttpProtocol}${Host}`).hostname,
      requireUserVerification: true,
      credential: {
        id: "saved-credential",
        publicKey: new Uint8Array(Buffer.from("public-key")),
        counter: 7,
      },
    });
    expect(credentialLookup).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { credentialId: "saved-credential", isVerified: true },
      }),
    );
    expect(updateCredential).toHaveBeenCalledWith({
      id: CREDENTIAL_ID,
      data: { counter: "8" },
      props: { isRoot: true },
    });
    expect(userLookup).toHaveBeenCalledWith({
      id: USER_ID,
      select: { _id: true, email: true },
      props: { isRoot: true },
    });
  });

  test("ignores supplied user IDs, email addresses, and expected challenge values", async () => {
    const credential: any = {
      ...assertion(),
      userId: "attacker",
      email: "attacker@example.com",
      challenge: "attacker-challenge",
    };
    await expect(authenticate(credential)).resolves.toBe(user);
    expect(userLookup.mock.calls[0]?.[0].id).toEqual(USER_ID);
    expect(
      (verifyAuthenticationResponse as jest.Mock).mock.calls[0]?.[0]
        .expectedChallenge,
    ).toBe(CHALLENGE);
  });

  test("rejects sequential replay before looking up the credential again", async () => {
    const { challengeId } =
      await UserWebAuthnService.generatePasskeyAuthenticationOptions();
    await UserWebAuthnService.verifyPasskeyAuthentication({
      challengeId,
      credential: assertion(),
    });
    await expect(
      UserWebAuthnService.verifyPasskeyAuthentication({
        challengeId,
        credential: assertion(),
      }),
    ).rejects.toThrow("already used");
    expect(verifyAuthenticationResponse).toHaveBeenCalledTimes(1);
  });

  test("permits exactly one of simultaneous verification attempts", async () => {
    const { challengeId } =
      await UserWebAuthnService.generatePasskeyAuthenticationOptions();
    const results: PromiseSettledResult<User>[] = await Promise.allSettled(
      Array.from({ length: 8 }, () => {
        return UserWebAuthnService.verifyPasskeyAuthentication({
          challengeId,
          credential: assertion(),
        });
      }),
    );
    expect(
      results.filter((result: PromiseSettledResult<User>) => {
        return result.status === "fulfilled";
      }),
    ).toHaveLength(1);
    expect(verifyAuthenticationResponse).toHaveBeenCalledTimes(1);
    expect(client.eval.mock.calls[0]?.[0]).toContain(
      "redis.call('GET', KEYS[1])",
    );
    expect(client.eval.mock.calls[0]?.[0]).toContain(
      "redis.call('DEL', KEYS[1])",
    );
    expect(client.eval.mock.calls[0]?.[1]).toBe(1);
  });

  test("rejects an expired challenge", async () => {
    const { challengeId } =
      await UserWebAuthnService.generatePasskeyAuthenticationOptions();
    now += 300_001;
    await expect(
      UserWebAuthnService.verifyPasskeyAuthentication({
        challengeId,
        credential: assertion(),
      }),
    ).rejects.toThrow("expired");
    expect(credentialLookup).not.toHaveBeenCalled();
  });

  test.each(["", "short", "a".repeat(44), "../".repeat(14) + "a", null, 42])(
    "rejects malformed challenge IDs: %p",
    async (challengeId: any) => {
      await expect(
        UserWebAuthnService.verifyPasskeyAuthentication({
          challengeId,
          credential: assertion(),
        }),
      ).rejects.toThrow("Invalid passkey challenge");
      expect(client.eval).not.toHaveBeenCalled();
    },
  );

  test.each([
    null,
    undefined,
    {},
    { id: 123 },
    { id: "" },
    { id: "saved-credential", response: {} },
  ])(
    "rejects malformed assertions before database lookup: %p",
    async (credential: any) => {
      await expect(
        authenticate(credential === undefined ? null : credential),
      ).rejects.toThrow("Invalid passkey credential");
      expect(credentialLookup).not.toHaveBeenCalled();
    },
  );

  test.each([
    null,
    undefined,
    "",
    123,
    "somebody-else",
    Buffer.from("different-user").toString("base64url"),
  ])(
    "requires a user handle belonging to the saved credential owner: %p",
    async (userHandle: any) => {
      const credential: any = assertion();
      credential.response.userHandle = userHandle;
      await expect(authenticate(credential)).rejects.toThrow();
      expect(verifyAuthenticationResponse).not.toHaveBeenCalled();
      expect(updateCredential).not.toHaveBeenCalled();
    },
  );

  test("does not accept an unknown, deleted, or unverified credential", async () => {
    credentialLookup.mockResolvedValue(null);
    await expect(authenticate()).rejects.toThrow(
      "Passkey authentication failed",
    );
    expect(verifyAuthenticationResponse).not.toHaveBeenCalled();
  });

  test("rejects a credential whose owner has been deleted", async () => {
    userLookup.mockResolvedValue(null);
    await expect(authenticate()).rejects.toThrow(
      "Passkey authentication failed",
    );
  });

  test.each(["userId", "_id", "publicKey", "credentialId"])(
    "rejects incomplete saved credentials: %s",
    async (field: string) => {
      (storedCredential as any)[field] = undefined;
      await expect(authenticate()).rejects.toThrow(
        "Passkey authentication failed",
      );
      expect(verifyAuthenticationResponse).not.toHaveBeenCalled();
    },
  );

  test.each(["abc", "-1", "1.5", "9007199254740992", undefined])(
    "rejects corrupt stored counters: %p",
    async (counter: any) => {
      storedCredential.counter = counter;
      await expect(authenticate()).rejects.toThrow("Invalid passkey counter");
      expect(verifyAuthenticationResponse).not.toHaveBeenCalled();
    },
  );

  test.each([
    { verified: false },
    {
      verified: true,
      authenticationInfo: { userVerified: false, newCounter: 8 },
    },
    { verified: true },
  ])(
    "fails closed when verification or UV fails: %p",
    async (verification: any) => {
      (verifyAuthenticationResponse as jest.Mock).mockResolvedValue(
        verification,
      );
      await expect(authenticate()).rejects.toThrow(
        "Passkey authentication failed",
      );
      expect(updateCredential).not.toHaveBeenCalled();
      expect(userLookup).not.toHaveBeenCalled();
    },
  );

  test("consumes even a failed assertion so it cannot be retried", async () => {
    const { challengeId } =
      await UserWebAuthnService.generatePasskeyAuthenticationOptions();
    (verifyAuthenticationResponse as jest.Mock).mockRejectedValue(
      new Error("Invalid signature"),
    );
    await expect(
      UserWebAuthnService.verifyPasskeyAuthentication({
        challengeId,
        credential: assertion(),
      }),
    ).rejects.toThrow("Invalid signature");
    await expect(
      UserWebAuthnService.verifyPasskeyAuthentication({
        challengeId,
        credential: assertion(),
      }),
    ).rejects.toThrow("already used");
    expect(verifyAuthenticationResponse).toHaveBeenCalledTimes(1);
  });

  test("does not log in if the credential disappeared before its counter update", async () => {
    updateCredential.mockResolvedValue(0);
    await expect(authenticate()).rejects.toThrow(
      "Passkey authentication failed",
    );
    expect(userLookup).not.toHaveBeenCalled();
  });

  test("fails closed when persisting the counter fails", async () => {
    updateCredential.mockRejectedValue(new Error("Database unavailable"));
    await expect(authenticate()).rejects.toThrow("Database unavailable");
    expect(userLookup).not.toHaveBeenCalled();
  });

  test.each(["create", "verify"])(
    "fails closed when Redis is unavailable during %s",
    async (operation: string) => {
      const { challengeId } =
        await UserWebAuthnService.generatePasskeyAuthenticationOptions();
      getJestSpyOn(Redis, "isConnected").mockReturnValue(false);
      const request: Promise<unknown> =
        operation === "create"
          ? UserWebAuthnService.generatePasskeyAuthenticationOptions()
          : UserWebAuthnService.verifyPasskeyAuthentication({
              challengeId,
              credential: assertion(),
            });
      await expect(request).rejects.toThrow("challenge store is unavailable");
      expect(credentialLookup).not.toHaveBeenCalled();
    },
  );

  test("rejects challenge generation when Redis refuses the write", async () => {
    client.set.mockResolvedValue(null);
    await expect(
      UserWebAuthnService.generatePasskeyAuthenticationOptions(),
    ).rejects.toThrow("Unable to create");
  });

  test("does not fall back to client values when consuming Redis state fails", async () => {
    client.eval.mockRejectedValue(new Error("Redis unavailable"));
    await expect(authenticate()).rejects.toThrow("Redis unavailable");
    expect(credentialLookup).not.toHaveBeenCalled();
  });

  test.each(["clientDataJSON", "authenticatorData", "signature"])(
    "rejects missing assertion bytes before lookup: %s",
    async (field: string) => {
      const credential: any = assertion();
      credential.response[field] = "";
      await expect(authenticate(credential)).rejects.toThrow(
        "Invalid passkey credential",
      );
      expect(credentialLookup).not.toHaveBeenCalled();
    },
  );

  test.each(["type", "rawId"])(
    "rejects a mismatched credential envelope before lookup: %s",
    async (field: string) => {
      const credential: any = assertion();
      credential[field] = "invalid";
      await expect(authenticate(credential)).rejects.toThrow(
        "Invalid passkey credential",
      );
      expect(credentialLookup).not.toHaveBeenCalled();
    },
  );

  test("requests discoverable and verified credentials when registering a passkey", async () => {
    const result: any = await UserWebAuthnService.generateRegistrationOptions({
      userId: USER_ID,
      isPasskey: true,
    });
    expect(generateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        userID: new Uint8Array(Buffer.from(USER_ID.toString())),
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
        },
      }),
    );
    expect(result.challenge).toBe(CHALLENGE);
    expect(result.options.challenge).toBe(CHALLENGE);
    expect(client.set).toHaveBeenCalledWith(
      `webauthn-registration-${USER_ID.toString()}`,
      JSON.stringify({ challenge: CHALLENGE, requireUserVerification: true }),
      "EX",
      300,
    );
  });

  test("preserves ordinary security key registration", async () => {
    await UserWebAuthnService.generateRegistrationOptions({ userId: USER_ID });
    expect(generateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        authenticatorSelection: {
          residentKey: "discouraged",
          userVerification: "preferred",
        },
      }),
    );
    await UserWebAuthnService.verifyRegistration({
      credential: {},
      name: "Security key",
      props: { userId: USER_ID },
    });
    expect(verifyRegistrationResponse).toHaveBeenCalledWith(
      expect.objectContaining({ requireUserVerification: false }),
    );
  });

  test("excludes credentials already registered to the owner", async () => {
    getJestSpyOn(UserWebAuthnService, "findBy").mockResolvedValue([
      storedCredential,
    ]);
    await UserWebAuthnService.generateRegistrationOptions({
      userId: USER_ID,
      isPasskey: true,
    });
    expect(generateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        excludeCredentials: [{ id: "saved-credential", type: "public-key" }],
      }),
    );
  });

  test("enforces the registration ceremony's stored UV policy despite caller downgrade attempts", async () => {
    await UserWebAuthnService.generateRegistrationOptions({
      userId: USER_ID,
      isPasskey: true,
    });
    await UserWebAuthnService.verifyRegistration({
      credential: { isPasskey: false, requireUserVerification: false },
      name: "My passkey",
      props: { userId: USER_ID },
    });
    expect(verifyRegistrationResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedChallenge: CHALLENGE,
        requireUserVerification: true,
      }),
    );
  });

  test("saves the verified counter, public key and transports from registration", async () => {
    await UserWebAuthnService.generateRegistrationOptions({
      userId: USER_ID,
      isPasskey: true,
    });
    await UserWebAuthnService.verifyRegistration({
      credential: {},
      name: "My passkey",
      props: { userId: USER_ID },
    });
    expect(createCredential).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: "My passkey",
        credentialId: "new-credential",
        publicKey: "AQID",
        counter: "12",
        transports: '["internal","hybrid"]',
        isVerified: true,
        userId: USER_ID,
      }),
      props: { userId: USER_ID },
    });
  });

  test.each([
    { verified: false },
    { verified: true },
    { verified: true, registrationInfo: { userVerified: false } },
  ])(
    "does not save unverified passkey registrations: %p",
    async (verification: any) => {
      await UserWebAuthnService.generateRegistrationOptions({
        userId: USER_ID,
        isPasskey: true,
      });
      (verifyRegistrationResponse as jest.Mock).mockResolvedValue(verification);
      await expect(
        UserWebAuthnService.verifyRegistration({
          credential: {},
          name: "My passkey",
          props: { userId: USER_ID },
        }),
      ).rejects.toThrow();
      expect(createCredential).not.toHaveBeenCalled();
    },
  );

  test("rejects a replayed registration", async () => {
    await UserWebAuthnService.generateRegistrationOptions({
      userId: USER_ID,
      isPasskey: true,
    });
    await UserWebAuthnService.verifyRegistration({
      credential: {},
      name: "My passkey",
      props: { userId: USER_ID },
    });
    await expect(
      UserWebAuthnService.verifyRegistration({
        credential: {},
        name: "My passkey",
        props: { userId: USER_ID },
      }),
    ).rejects.toThrow("already used");
    expect(createCredential).toHaveBeenCalledTimes(1);
  });

  test("rejects a registration verified by a different logged-in user", async () => {
    await UserWebAuthnService.generateRegistrationOptions({
      userId: USER_ID,
      isPasskey: true,
    });
    await expect(
      UserWebAuthnService.verifyRegistration({
        credential: {},
        name: "My passkey",
        props: { userId: CREDENTIAL_ID },
      }),
    ).rejects.toThrow("expired");
    expect(createCredential).not.toHaveBeenCalled();
  });

  test("rejects registration without an authenticated user", async () => {
    await expect(
      UserWebAuthnService.verifyRegistration({
        credential: {},
        name: "My passkey",
        props: {},
      }),
    ).rejects.toThrow("User ID not found");
    expect(client.eval).not.toHaveBeenCalled();
  });

  test("registration and passkey login do not replace each other's challenges", async () => {
    const { challengeId } =
      await UserWebAuthnService.generatePasskeyAuthenticationOptions();
    await UserWebAuthnService.generateRegistrationOptions({
      userId: USER_ID,
      isPasskey: true,
    });
    await UserWebAuthnService.verifyRegistration({
      credential: {},
      name: "My passkey",
      props: { userId: USER_ID },
    });
    await expect(
      UserWebAuthnService.verifyPasskeyAuthentication({
        challengeId,
        credential: assertion(),
      }),
    ).resolves.toBe(user);
  });

  test("a password-plus-security-key challenge cannot authorize passkey login or registration", async () => {
    getJestSpyOn(UserWebAuthnService, "findBy").mockResolvedValue([
      storedCredential,
    ]);
    const result: any = await UserWebAuthnService.generateAuthenticationOptions(
      { email: "passkey@example.com" },
    );
    expect(result.options.challenge).toBe(CHALLENGE);
    expect(cache.size).toBe(1);
    expect(cache.has(`webauthn-security-key-login-${USER_ID.toString()}`)).toBe(
      true,
    );
    await expect(
      UserWebAuthnService.verifyPasskeyAuthentication({
        challengeId: "a".repeat(43),
        credential: assertion(),
      }),
    ).rejects.toThrow("expired");
    await expect(
      UserWebAuthnService.verifyRegistration({
        credential: {},
        name: "My passkey",
        props: { userId: USER_ID },
      }),
    ).rejects.toThrow("expired");
  });
});
