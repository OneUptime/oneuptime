jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn().mockReturnValue(null),
      isConnected: jest.fn().mockReturnValue(false),
    },
  };
});

import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import UserService from "../../../Server/Services/UserService";
import UserTotpAuthService from "../../../Server/Services/UserTotpAuthService";
import UserWebAuthnService from "../../../Server/Services/UserWebAuthnService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import logger from "../../../Server/Utils/Logger";
import User from "../../../Models/DatabaseModels/User";
import UserTotpAuth from "../../../Models/DatabaseModels/UserTotpAuth";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import { SSO_MANAGED_SIGN_IN_MESSAGE } from "../../../Types/SSO/SsoManagedSignIn";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * EVERY LOCAL SIGN-IN SETTING IS REFUSED TO SOMEBODY WHOSE SIGN-IN THE
 * SERVER'S SSO MANAGES (issue #9688), AND TO NOBODY ELSE.
 *
 * While the whole server requires SSO, everyone but a master admin is
 * refused every sign-in that is not SSO. Their password, passkeys, security
 * keys, authenticator apps and backup codes can only lie dormant, so none of
 * them is set (Types/SSO/SsoManagedSignIn). Each write is driven here
 * through its real hook or service method, with the real rule
 * (SsoManagedSignIn, SsoRequiredSignIn), and only the server's setting, the
 * account's row and the storage behind each write stood in:
 *
 *   - a new password from the profile: UserService.onBeforeUpdate;
 *   - an authenticator app: UserTotpAuthService.onBeforeCreate;
 *   - a passkey or a security key: UserWebAuthnService
 *     .generateRegistrationOptions and .verifyRegistration.
 *
 * (Turning two-factor authentication on, finishing an app's setup and new
 * backup codes are driven through their routes: UserTwoFactorSelfService,
 * UserTotpAuthAPI, UserTwoFactorBackupCodeAPI.)
 *
 * For each: refused while SSO is required of someone who is not a master
 * admin, before anything is written or minted; allowed for a master admin,
 * without the rule being read; allowed for everyone while SSO is not
 * required; refused when the rule cannot be read; and never asked of
 * OneUptime's own writes - a reset link, a master admin's Set Password, the
 * enrolment a sign-in with a password walks somebody through.
 */

const USER_ID: ObjectID = new ObjectID("9c000000-0000-4000-8000-000000000001");

let isMasterAdmin: boolean;
let getRequireSsoForLogin: jest.SpyInstance;
let findOneById: jest.SpyInstance;

beforeEach(() => {
  isMasterAdmin = false;

  getRequireSsoForLogin = getJestSpyOn(
    GlobalConfigService,
    "getRequireSsoForLogin",
  ).mockResolvedValue(true);

  // The account, as each read selects it: its flag, its address, its name.
  findOneById = getJestSpyOn(UserService, "findOneById").mockImplementation(
    async (): Promise<User> => {
      const user: User = new User();
      user._id = USER_ID.toString();
      user.isMasterAdmin = isMasterAdmin;
      user.email = new Email("ada@example.com");
      return user;
    },
  );

  getJestSpyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

const selfService: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return { userId: USER_ID, isRoot: false };
  };

describe("a new password from the profile (UserService.onBeforeUpdate)", () => {
  let findRowsAndHold: jest.SpyInstance;

  const callOnBeforeUpdate: (updateBy: unknown) => Promise<unknown> = async (
    updateBy: unknown,
  ): Promise<unknown> => {
    return await (
      UserService as unknown as {
        onBeforeUpdate: (u: unknown) => Promise<unknown>;
      }
    ).onBeforeUpdate(updateBy);
  };

  const passwordWrite: (
    props: DatabaseCommonInteractionProps,
    password?: string,
  ) => unknown = (
    props: DatabaseCommonInteractionProps,
    password: string = "five unrelated words make a passphrase",
  ): unknown => {
    return {
      query: { _id: USER_ID.toString() },
      data: { password: new HashedString(password) },
      props: props,
      limit: 1,
      skip: 0,
    };
  };

  beforeEach(() => {
    findRowsAndHold = getJestSpyOn(
      UserService,
      "findRowsAndHoldUpdateToThem",
    ).mockResolvedValue([]);
  });

  test("is refused while the server requires SSO, before the rows are held or the password judged", async () => {
    // Too short for the password rule: the SSO refusal comes first.
    await expect(
      callOnBeforeUpdate(passwordWrite(selfService(), "short")),
    ).rejects.toThrow(new BadDataException(SSO_MANAGED_SIGN_IN_MESSAGE));

    expect(findRowsAndHold).not.toHaveBeenCalled();
  });

  test("asks about the caller's own account, as OneUptime", async () => {
    await expect(
      callOnBeforeUpdate(passwordWrite(selfService())),
    ).rejects.toThrow(SSO_MANAGED_SIGN_IN_MESSAGE);

    expect(findOneById).toHaveBeenCalledTimes(1);
    const call: Record<string, unknown> = findOneById.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(String(call["id"])).toBe(USER_ID.toString());
    expect(call["props"]).toEqual({ isRoot: true });
  });

  test("is allowed while the server does not require SSO", async () => {
    getRequireSsoForLogin.mockResolvedValue(false);

    await expect(
      callOnBeforeUpdate(passwordWrite(selfService())),
    ).resolves.toBeDefined();
    expect(findRowsAndHold).toHaveBeenCalledTimes(1);
  });

  test("the password rule still holds for everybody else", async () => {
    getRequireSsoForLogin.mockResolvedValue(false);

    await expect(
      callOnBeforeUpdate(passwordWrite(selfService(), "short")),
    ).rejects.toThrow(BadDataException);
    await expect(
      callOnBeforeUpdate(passwordWrite(selfService(), "short")),
    ).rejects.not.toThrow(SSO_MANAGED_SIGN_IN_MESSAGE);
  });

  test("a master admin changes their password while the server requires SSO, the rule never read", async () => {
    isMasterAdmin = true;

    await expect(
      callOnBeforeUpdate(
        passwordWrite({ ...selfService(), isMasterAdmin: true }),
      ),
    ).resolves.toBeDefined();
    expect(getRequireSsoForLogin).not.toHaveBeenCalled();
  });

  test("a session that says master admin over an account that no longer is one is refused", async () => {
    isMasterAdmin = false;

    await expect(
      callOnBeforeUpdate(
        passwordWrite({ ...selfService(), isMasterAdmin: true }),
      ),
    ).rejects.toThrow(SSO_MANAGED_SIGN_IN_MESSAGE);
  });

  test("a rule that cannot be read refuses, never setting the password as if SSO were not required", async () => {
    getRequireSsoForLogin.mockRejectedValue(new Error("connection refused"));

    await expect(
      callOnBeforeUpdate(passwordWrite(selfService())),
    ).rejects.toThrow("connection refused");
    expect(findRowsAndHold).not.toHaveBeenCalled();
  });

  test("OneUptime's own writes - a reset link, a master admin's Set Password - are not the profile's", async () => {
    await expect(
      callOnBeforeUpdate(passwordWrite({ isRoot: true })),
    ).resolves.toBeDefined();
    expect(getRequireSsoForLogin).not.toHaveBeenCalled();
    expect(findOneById).not.toHaveBeenCalled();
  });

  test.each([
    ["a name", { name: "Ada Lovelace" }],
    ["a time zone", { timezone: "Europe/London" }],
    ["turning two-factor authentication off", { enableTwoFactorAuth: false }],
  ])(
    "a profile write of %s does not ask about SSO",
    async (_label: string, data: Record<string, unknown>) => {
      await expect(
        callOnBeforeUpdate({
          query: { _id: USER_ID.toString() },
          data: data,
          props: selfService(),
          limit: 1,
          skip: 0,
        }),
      ).resolves.toBeDefined();
      expect(getRequireSsoForLogin).not.toHaveBeenCalled();
    },
  );
});

describe("an authenticator app (UserTotpAuthService.onBeforeCreate)", () => {
  const callOnBeforeCreate: (
    props: DatabaseCommonInteractionProps,
  ) => Promise<OnCreate<UserTotpAuth>> = async (
    props: DatabaseCommonInteractionProps,
  ): Promise<OnCreate<UserTotpAuth>> => {
    const data: UserTotpAuth = new UserTotpAuth();
    data.name = "My phone";

    const createBy: CreateBy<UserTotpAuth> = {
      data: data,
      props: props,
    };

    return (await (
      UserTotpAuthService as unknown as {
        onBeforeCreate: (c: CreateBy<UserTotpAuth>) => Promise<unknown>;
      }
    ).onBeforeCreate(createBy)) as OnCreate<UserTotpAuth>;
  };

  test("is refused while the server requires SSO, before a secret is minted", async () => {
    await expect(callOnBeforeCreate(selfService())).rejects.toThrow(
      new BadDataException(SSO_MANAGED_SIGN_IN_MESSAGE),
    );

    // Only the master-admin flag was read: the address the secret is labelled with never was.
    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(
      (findOneById.mock.calls[0]![0] as { select: Record<string, unknown> })
        .select,
    ).toEqual({ _id: true, isMasterAdmin: true });
  });

  test("is allowed while the server does not require SSO, and a secret is minted", async () => {
    getRequireSsoForLogin.mockResolvedValue(false);

    const onCreate: OnCreate<UserTotpAuth> =
      await callOnBeforeCreate(selfService());

    expect(onCreate.createBy.data.twoFactorSecret).toBeTruthy();
    expect(onCreate.createBy.data.isVerified).toBe(false);
  });

  test("a master admin adds one while the server requires SSO", async () => {
    isMasterAdmin = true;

    const onCreate: OnCreate<UserTotpAuth> =
      await callOnBeforeCreate(selfService());

    expect(onCreate.createBy.data.twoFactorSecret).toBeTruthy();
    expect(getRequireSsoForLogin).not.toHaveBeenCalled();
  });

  test("the enrolment a sign-in walks somebody through is OneUptime's write, and is not asked", async () => {
    const onCreate: OnCreate<UserTotpAuth> = await callOnBeforeCreate({
      userId: USER_ID,
      isRoot: true,
    });

    expect(onCreate.createBy.data.twoFactorSecret).toBeTruthy();
    expect(getRequireSsoForLogin).not.toHaveBeenCalled();
  });

  test("a rule that cannot be read refuses", async () => {
    getRequireSsoForLogin.mockRejectedValue(new Error("statement timeout"));

    await expect(callOnBeforeCreate(selfService())).rejects.toThrow(
      "statement timeout",
    );
  });
});

describe("a passkey or a security key (UserWebAuthnService)", () => {
  let storeChallenge: jest.SpyInstance;
  let consumeChallenge: jest.SpyInstance;
  let create: jest.SpyInstance;

  beforeEach(() => {
    storeChallenge = getJestSpyOn(
      UserWebAuthnService,
      "storeChallenge",
    ).mockResolvedValue(undefined);
    consumeChallenge = getJestSpyOn(
      UserWebAuthnService,
      "consumeChallenge",
    ).mockResolvedValue(
      JSON.stringify({
        challenge: "a-challenge",
        requireUserVerification: true,
        isPasskey: true,
      }),
    );
    create = getJestSpyOn(UserWebAuthnService, "create").mockResolvedValue(
      undefined,
    );
    getJestSpyOn(UserWebAuthnService, "findBy").mockResolvedValue([]);
  });

  test.each([true, false])(
    "making a challenge is refused while the server requires SSO (passkey: %s), and no challenge is stored",
    async (isPasskey: boolean) => {
      await expect(
        UserWebAuthnService.generateRegistrationOptions({
          userId: USER_ID,
          isPasskey: isPasskey,
        }),
      ).rejects.toThrow(new BadDataException(SSO_MANAGED_SIGN_IN_MESSAGE));

      expect(storeChallenge).not.toHaveBeenCalled();
    },
  );

  test("answering a challenge made before the server required SSO is refused, and the challenge is not spent", async () => {
    await expect(
      UserWebAuthnService.verifyRegistration({
        credential: { id: "credential" },
        name: "MacBook Pro",
        props: selfService(),
      }),
    ).rejects.toThrow(new BadDataException(SSO_MANAGED_SIGN_IN_MESSAGE));

    expect(consumeChallenge).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test("a challenge is made while the server does not require SSO", async () => {
    getRequireSsoForLogin.mockResolvedValue(false);

    await expect(
      UserWebAuthnService.generateRegistrationOptions({
        userId: USER_ID,
        isPasskey: true,
      }),
    ).resolves.toHaveProperty("challenge");
    expect(storeChallenge).toHaveBeenCalledTimes(1);
  });

  test("a master admin makes one while the server requires SSO", async () => {
    isMasterAdmin = true;

    await expect(
      UserWebAuthnService.generateRegistrationOptions({
        userId: USER_ID,
        isPasskey: false,
      }),
    ).resolves.toHaveProperty("challenge");
    expect(getRequireSsoForLogin).not.toHaveBeenCalled();
  });

  test("a rule that cannot be read refuses, and stores nothing", async () => {
    getRequireSsoForLogin.mockRejectedValue(new Error("pool exhausted"));

    await expect(
      UserWebAuthnService.generateRegistrationOptions({
        userId: USER_ID,
        isPasskey: true,
      }),
    ).rejects.toThrow("pool exhausted");
    expect(storeChallenge).not.toHaveBeenCalled();
  });
});
