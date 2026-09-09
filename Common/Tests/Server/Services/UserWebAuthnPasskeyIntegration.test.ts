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
/*
 * Common's Jest configuration replaces the package entry point with a mock.
 * Import the installed implementation directly to exercise real cryptography.
 */
import {
  generateAuthenticationOptions as realGenerateAuthenticationOptions,
  generateRegistrationOptions as realGenerateRegistrationOptions,
  verifyAuthenticationResponse as realVerifyAuthenticationResponse,
  verifyRegistrationResponse as realVerifyRegistrationResponse,
} from "../../../node_modules/@simplewebauthn/server/script/index";
import {
  encodeCBOR,
  CBORType,
} from "../../../node_modules/@levischuck/tiny-cbor/script/index";
import {
  createHash,
  generateKeyPairSync,
  KeyObject,
  randomBytes,
  sign,
  webcrypto,
} from "crypto";
import { URL } from "url";

const USER_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const ROW_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const ORIGIN: string = new URL(`${HttpProtocol}${Host}`).origin;
const RP_ID: string = new URL(ORIGIN).hostname;

interface AssertionOverrides {
  challenge?: string;
  origin?: string;
  rpID?: string;
  flags?: number;
  counter?: number;
  type?: string;
  signingKey?: KeyObject;
}

describe("passkey registration and login with real WebAuthn verification", () => {
  let cache: Map<string, string>;
  let credentialBytes: Buffer;
  let privateKey: KeyObject;
  let coseKey: Uint8Array;
  let savedCredential: UserWebAuthn;
  let user: User;
  let persistCredential: jest.SpyInstance;
  let updateCounter: jest.SpyInstance;

  beforeAll(() => {
    // jsdom's Crypto does not expose subtle; the library needs Web Crypto.
    Object.defineProperty(globalThis, "crypto", {
      value: webcrypto,
      configurable: true,
    });
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    (generateAuthenticationOptions as jest.Mock).mockImplementation(
      realGenerateAuthenticationOptions,
    );
    (generateRegistrationOptions as jest.Mock).mockImplementation(
      realGenerateRegistrationOptions,
    );
    (verifyAuthenticationResponse as jest.Mock).mockImplementation(
      realVerifyAuthenticationResponse,
    );
    (verifyRegistrationResponse as jest.Mock).mockImplementation(
      realVerifyRegistrationResponse,
    );
    getJestSpyOn(logger, "error").mockImplementation(() => {});
    cache = new Map();
    getJestSpyOn(Redis, "isConnected").mockReturnValue(true);
    getJestSpyOn(Redis, "getClient").mockReturnValue({
      set: async (key: string, value: string): Promise<string> => {
        cache.set(key, value);
        return "OK";
      },
      eval: async (
        _script: string,
        _count: number,
        key: string,
      ): Promise<string | null> => {
        const value: string | null = cache.get(key) || null;
        cache.delete(key);
        return value;
      },
    });
    credentialBytes = randomBytes(32);
    const keyPair: { privateKey: KeyObject; publicKey: KeyObject } =
      generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    privateKey = keyPair.privateKey;
    const jwk: any = keyPair.publicKey.export({ format: "jwk" });
    coseKey = encodeCBOR(
      new Map<number, CBORType>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, new Uint8Array(Buffer.from(jwk.x, "base64url"))],
        [-3, new Uint8Array(Buffer.from(jwk.y, "base64url"))],
      ]),
    );
    user = new User();
    user._id = USER_ID.toString();
    user.email = new Email("passkey@example.com");
    savedCredential = new UserWebAuthn();
    savedCredential._id = ROW_ID.toString();
    savedCredential.userId = USER_ID;
    savedCredential.credentialId = credentialBytes.toString("base64url");
    savedCredential.publicKey = Buffer.from(coseKey).toString("base64");
    savedCredential.counter = "5";
    getJestSpyOn(UserService, "findOneById").mockResolvedValue(user);
    getJestSpyOn(UserWebAuthnService, "findBy").mockResolvedValue([]);
    getJestSpyOn(UserWebAuthnService, "findOneBy").mockImplementation(
      async (): Promise<UserWebAuthn> => {
        return savedCredential;
      },
    );
    persistCredential = getJestSpyOn(
      UserWebAuthnService,
      "create",
    ).mockImplementation(async (request: any): Promise<UserWebAuthn> => {
      savedCredential = request.data;
      savedCredential._id = ROW_ID.toString();
      return savedCredential;
    });
    updateCounter = getJestSpyOn(
      UserWebAuthnService,
      "updateOneById",
    ).mockImplementation(async (request: any): Promise<number> => {
      savedCredential.counter = request.data.counter;
      return 1;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const authenticatorData: (options: AssertionOverrides) => Buffer = (
    options: AssertionOverrides,
  ): Buffer => {
    const count: Buffer = Buffer.alloc(4);
    count.writeUInt32BE(options.counter ?? 6);
    return Buffer.concat([
      createHash("sha256")
        .update(options.rpID ?? RP_ID)
        .digest(),
      Buffer.from([options.flags ?? 0x05]),
      count,
    ]);
  };

  const registration: (challenge: string, flags?: number) => any = (
    challenge: string,
    flags: number = 0x45,
  ): any => {
    const credentialLength: Buffer = Buffer.alloc(2);
    credentialLength.writeUInt16BE(credentialBytes.length);
    const attestationObject: Uint8Array = encodeCBOR(
      new Map<string, CBORType>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        [
          "authData",
          new Uint8Array(
            Buffer.concat([
              authenticatorData({ counter: 5, flags }),
              Buffer.alloc(16),
              credentialLength,
              credentialBytes,
              Buffer.from(coseKey),
            ]),
          ),
        ],
      ]),
    );
    return {
      id: credentialBytes.toString("base64url"),
      rawId: credentialBytes.toString("base64url"),
      type: "public-key",
      response: {
        attestationObject: Buffer.from(attestationObject).toString("base64url"),
        clientDataJSON: Buffer.from(
          JSON.stringify({
            type: "webauthn.create",
            challenge,
            origin: ORIGIN,
          }),
        ).toString("base64url"),
        transports: ["internal", "hybrid"],
      },
      clientExtensionResults: { credProps: { rk: true } },
    };
  };

  const assertion: (
    challenge: string,
    overrides?: AssertionOverrides,
  ) => any = (challenge: string, overrides: AssertionOverrides = {}): any => {
    const clientData: Buffer = Buffer.from(
      JSON.stringify({
        type: overrides.type ?? "webauthn.get",
        challenge: overrides.challenge ?? challenge,
        origin: overrides.origin ?? ORIGIN,
        crossOrigin: false,
      }),
    );
    const authenticator: Buffer = authenticatorData(overrides);
    const signature: Buffer = sign(
      "sha256",
      Buffer.concat([
        authenticator,
        createHash("sha256").update(clientData).digest(),
      ]),
      overrides.signingKey ?? privateKey,
    );
    return {
      id: credentialBytes.toString("base64url"),
      rawId: credentialBytes.toString("base64url"),
      type: "public-key",
      response: {
        clientDataJSON: clientData.toString("base64url"),
        authenticatorData: authenticator.toString("base64url"),
        signature: signature.toString("base64url"),
        userHandle: Buffer.from(USER_ID.toString()).toString("base64url"),
      },
      clientExtensionResults: {},
    };
  };

  test("registers a discoverable passkey, then authenticates its owner without email or password", async () => {
    const registrationOptions: any =
      await UserWebAuthnService.generateRegistrationOptions({
        userId: USER_ID,
        isPasskey: true,
      });
    expect(registrationOptions.options.authenticatorSelection).toEqual(
      expect.objectContaining({
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "required",
      }),
    );
    expect(registrationOptions.options.user.id).toBe(
      Buffer.from(USER_ID.toString()).toString("base64url"),
    );
    await UserWebAuthnService.verifyRegistration({
      credential: registration(registrationOptions.options.challenge),
      name: "Laptop passkey",
      props: { userId: USER_ID },
    });
    expect(savedCredential.counter).toBe("5");
    expect(savedCredential.transports).toBe('["internal","hybrid"]');
    const login: any =
      await UserWebAuthnService.generatePasskeyAuthenticationOptions();
    expect(login.options.allowCredentials).toEqual([]);
    expect(login.options.userVerification).toBe("required");
    await expect(
      UserWebAuthnService.verifyPasskeyAuthentication({
        challengeId: login.challengeId,
        credential: assertion(login.options.challenge),
      }),
    ).resolves.toBe(user);
    expect(savedCredential.counter).toBe("6");
  });

  test("rejects passkey registration without the authenticator's user verification flag", async () => {
    const options: any = await UserWebAuthnService.generateRegistrationOptions({
      userId: USER_ID,
      isPasskey: true,
    });
    await expect(
      UserWebAuthnService.verifyRegistration({
        credential: registration(options.challenge, 0x41),
        name: "Unverified passkey",
        props: { userId: USER_ID },
      }),
    ).rejects.toThrow();
    expect(persistCredential).not.toHaveBeenCalled();
  });

  test("ordinary security keys remain registerable without biometric or PIN verification", async () => {
    const options: any = await UserWebAuthnService.generateRegistrationOptions({
      userId: USER_ID,
    });
    await UserWebAuthnService.verifyRegistration({
      credential: registration(options.challenge, 0x41),
      name: "Security key",
      props: { userId: USER_ID },
    });
    expect(persistCredential).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["wrong challenge", { challenge: "attacker-challenge" }],
    ["wrong origin", { origin: "https://attacker.example" }],
    ["wrong relying party", { rpID: "attacker.example" }],
    ["missing user verification", { flags: 0x01 }],
    ["missing user presence", { flags: 0x04 }],
    ["non-increasing counter", { counter: 5 }],
    ["lower counter", { counter: 4 }],
    ["registration response during login", { type: "webauthn.create" }],
    ["invalid backup flags", { flags: 0x15 }],
  ] as Array<[string, AssertionOverrides]>)(
    "rejects a correctly signed assertion with %s",
    async (_name: string, overrides: AssertionOverrides) => {
      const { options, challengeId } =
        await UserWebAuthnService.generatePasskeyAuthenticationOptions();
      await expect(
        UserWebAuthnService.verifyPasskeyAuthentication({
          challengeId,
          credential: assertion(options.challenge, overrides),
        }),
      ).rejects.toThrow();
      expect(updateCounter).not.toHaveBeenCalled();
    },
  );

  test("rejects a signature produced by a different private key", async () => {
    const otherKey: KeyObject = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    }).privateKey;
    const { options, challengeId } =
      await UserWebAuthnService.generatePasskeyAuthenticationOptions();
    await expect(
      UserWebAuthnService.verifyPasskeyAuthentication({
        challengeId,
        credential: assertion(options.challenge, { signingKey: otherKey }),
      }),
    ).rejects.toThrow();
    expect(updateCounter).not.toHaveBeenCalled();
  });

  test("rejects an authenticator response tampered with after signing", async () => {
    const { options, challengeId } =
      await UserWebAuthnService.generatePasskeyAuthenticationOptions();
    const response: any = assertion(options.challenge);
    response.response.authenticatorData = authenticatorData({
      counter: 99,
    }).toString("base64url");
    await expect(
      UserWebAuthnService.verifyPasskeyAuthentication({
        challengeId,
        credential: response,
      }),
    ).rejects.toThrow();
    expect(updateCounter).not.toHaveBeenCalled();
  });

  test("accepts synced passkeys that do not maintain signature counters", async () => {
    savedCredential.counter = "0";
    const { options, challengeId } =
      await UserWebAuthnService.generatePasskeyAuthenticationOptions();
    await expect(
      UserWebAuthnService.verifyPasskeyAuthentication({
        challengeId,
        credential: assertion(options.challenge, { counter: 0, flags: 0x1d }),
      }),
    ).resolves.toBe(user);
    expect(savedCredential.counter).toBe("0");
  });

  test("rejects replay after a valid signature has been accepted", async () => {
    const { options, challengeId } =
      await UserWebAuthnService.generatePasskeyAuthenticationOptions();
    const credential: any = assertion(options.challenge);
    await UserWebAuthnService.verifyPasskeyAuthentication({
      challengeId,
      credential,
    });
    await expect(
      UserWebAuthnService.verifyPasskeyAuthentication({
        challengeId,
        credential,
      }),
    ).rejects.toThrow("already used");
    expect(updateCounter).toHaveBeenCalledTimes(1);
  });
});
