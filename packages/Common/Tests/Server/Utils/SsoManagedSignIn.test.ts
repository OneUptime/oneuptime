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
import logger from "../../../Server/Utils/Logger";
import SsoManagedSignIn from "../../../Server/Utils/SsoManagedSignIn";
import SsoSignInMethods from "../../../Server/Utils/SsoSignInMethods";
import User from "../../../Models/DatabaseModels/User";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ObjectID from "../../../Types/ObjectID";
import { SsoSignInProvider } from "../../../Types/SSO/SignInMethods";
import { SSO_MANAGED_SIGN_IN_MESSAGE } from "../../../Types/SSO/SsoManagedSignIn";
import SsoProviderType from "../../../Types/SSO/SsoProviderType";
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
 * WHO HAS NO LOCAL SIGN-IN SETTINGS (issue #9688), EXACTLY.
 *
 * SsoManagedSignIn answers whether somebody's organization manages how they
 * sign in: everyone but a master admin, while the whole server requires SSO
 * (Types/SSO/SsoManagedSignIn). Every write of a password, passkey, security
 * key, authenticator app, backup codes or two-factor authentication asks it
 * first, so each case of the definition is pinned here, with only the
 * account's row, the server's rule and its providers stood in:
 *
 *   - the rule on, someone who is not a master admin: covered;
 *   - the rule off: nobody is, master admin or not;
 *   - a master admin: never, without the rule even being read - so a rule
 *     that cannot be read never refuses one anything;
 *   - a rule that cannot be read, for anyone else: refused, never "not
 *     required";
 *   - whether someone is a master admin is read from their account, never
 *     taken from what a caller says;
 *   - an account that does not exist: an answer about the account, not a
 *     rule that let it through.
 */

const USER_ID: ObjectID = new ObjectID("9a000000-0000-4000-8000-000000000001");

const account: (data: {
  isMasterAdmin?: boolean | undefined;
}) => User = (data: { isMasterAdmin?: boolean | undefined }): User => {
  const user: User = new User();
  user._id = USER_ID.toString();

  if (data.isMasterAdmin !== undefined) {
    user.isMasterAdmin = data.isMasterAdmin;
  }

  return user;
};

const provider: (name: string, type?: SsoProviderType) => SsoSignInProvider = (
  name: string,
  type: SsoProviderType = SsoProviderType.GlobalSSO,
): SsoSignInProvider => {
  return {
    type: type,
    id: "9b000000-0000-4000-8000-000000000001",
    name: name,
    description: "",
  };
};

let findOneById: jest.SpyInstance;
let getRequireSsoForLogin: jest.SpyInstance;
let getInstanceWideProviders: jest.SpyInstance;

beforeEach(() => {
  findOneById = getJestSpyOn(UserService, "findOneById").mockResolvedValue(
    account({ isMasterAdmin: false }),
  );
  getRequireSsoForLogin = getJestSpyOn(
    GlobalConfigService,
    "getRequireSsoForLogin",
  ).mockResolvedValue(true);
  getInstanceWideProviders = getJestSpyOn(
    SsoSignInMethods,
    "getInstanceWideProviders",
  ).mockResolvedValue([provider("Okta")]);
  getJestSpyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SsoManagedSignIn.isManagedBySso: each case of the definition", () => {
  test("the server requires SSO, and the person is not a master admin: covered", async () => {
    await expect(SsoManagedSignIn.isManagedBySso(USER_ID)).resolves.toBe(true);
    expect(getRequireSsoForLogin).toHaveBeenCalledTimes(1);
  });

  test("an account with no master-admin flag at all is not a master admin", async () => {
    findOneById.mockResolvedValue(account({}));

    await expect(SsoManagedSignIn.isManagedBySso(USER_ID)).resolves.toBe(true);
  });

  test("the server does not require SSO: nobody is covered", async () => {
    getRequireSsoForLogin.mockResolvedValue(false);

    await expect(SsoManagedSignIn.isManagedBySso(USER_ID)).resolves.toBe(false);
  });

  test.each([true, false])(
    "a master admin is never covered, the rule never read (server requires SSO: %s)",
    async (isRequired: boolean) => {
      findOneById.mockResolvedValue(account({ isMasterAdmin: true }));
      getRequireSsoForLogin.mockResolvedValue(isRequired);

      await expect(SsoManagedSignIn.isManagedBySso(USER_ID)).resolves.toBe(
        false,
      );
      expect(getRequireSsoForLogin).not.toHaveBeenCalled();
    },
  );

  test("a rule that cannot be read never keeps a master admin out", async () => {
    findOneById.mockResolvedValue(account({ isMasterAdmin: true }));
    getRequireSsoForLogin.mockRejectedValue(new Error("connection refused"));

    await expect(SsoManagedSignIn.isManagedBySso(USER_ID)).resolves.toBe(false);
  });

  test("a rule that cannot be read is no answer for anyone else: it throws", async () => {
    getRequireSsoForLogin.mockRejectedValue(new Error("connection refused"));

    await expect(SsoManagedSignIn.isManagedBySso(USER_ID)).rejects.toThrow(
      "connection refused",
    );
  });

  test("whether someone is a master admin is read from their own account, as OneUptime", async () => {
    await SsoManagedSignIn.isManagedBySso(USER_ID);

    expect(findOneById).toHaveBeenCalledTimes(1);
    const call: Record<string, unknown> = findOneById.mock
      .calls[0]![0] as Record<string, unknown>;
    expect((call["id"] as ObjectID).toString()).toBe(USER_ID.toString());
    expect(call["select"]).toEqual({ _id: true, isMasterAdmin: true });
    expect(call["props"]).toEqual({ isRoot: true });
  });

  test("an account that does not exist is not found, before the rule is read", async () => {
    findOneById.mockResolvedValue(null);

    await expect(SsoManagedSignIn.isManagedBySso(USER_ID)).rejects.toThrow(
      NotFoundException,
    );
    expect(getRequireSsoForLogin).not.toHaveBeenCalled();
  });
});

describe("SsoManagedSignIn.isManagedBySsoFor", () => {
  test.each([
    [true, false, true],
    [true, true, false],
    [false, false, false],
    [false, true, false],
  ])(
    "server requires SSO: %s, master admin: %s -> covered: %s",
    async (isRequired: boolean, isMasterAdmin: boolean, expected: boolean) => {
      getRequireSsoForLogin.mockResolvedValue(isRequired);

      await expect(
        SsoManagedSignIn.isManagedBySsoFor({ isMasterAdmin }),
      ).resolves.toBe(expected);
      // It is told who the account is: it reads no account itself.
      expect(findOneById).not.toHaveBeenCalled();
    },
  );
});

describe("SsoManagedSignIn.assertMayChangeLocalSignIn", () => {
  test("refuses a covered person with why, as a refusal and not a failure", async () => {
    const refusal: Promise<void> =
      SsoManagedSignIn.assertMayChangeLocalSignIn(USER_ID);

    await expect(refusal).rejects.toThrow(BadDataException);
    await expect(
      SsoManagedSignIn.assertMayChangeLocalSignIn(USER_ID),
    ).rejects.toThrow(SSO_MANAGED_SIGN_IN_MESSAGE);
  });

  test("lets everyone through while the server does not require SSO", async () => {
    getRequireSsoForLogin.mockResolvedValue(false);

    await expect(
      SsoManagedSignIn.assertMayChangeLocalSignIn(USER_ID),
    ).resolves.toBeUndefined();
  });

  test("lets a master admin through while it does", async () => {
    findOneById.mockResolvedValue(account({ isMasterAdmin: true }));

    await expect(
      SsoManagedSignIn.assertMayChangeLocalSignIn(USER_ID),
    ).resolves.toBeUndefined();
  });

  test("a rule that cannot be read refuses with the read's own error, not the SSO sentence", async () => {
    getRequireSsoForLogin.mockRejectedValue(new Error("statement timeout"));

    await expect(
      SsoManagedSignIn.assertMayChangeLocalSignIn(USER_ID),
    ).rejects.toThrow("statement timeout");
  });
});

describe("SsoManagedSignIn.getSignInManagement: what User Profile is told", () => {
  test("a covered person is told so, with the server's providers by name", async () => {
    getInstanceWideProviders.mockResolvedValue([
      provider("Microsoft Entra ID"),
      provider("Okta", SsoProviderType.GlobalOIDC),
    ]);

    await expect(
      SsoManagedSignIn.getSignInManagement(USER_ID),
    ).resolves.toEqual({
      isManagedBySso: true,
      ssoProviderNames: ["Microsoft Entra ID", "Okta"],
    });
  });

  test("somebody who is not covered is told nothing more, and no provider is read", async () => {
    getRequireSsoForLogin.mockResolvedValue(false);

    await expect(
      SsoManagedSignIn.getSignInManagement(USER_ID),
    ).resolves.toEqual({ isManagedBySso: false, ssoProviderNames: [] });
    expect(getInstanceWideProviders).not.toHaveBeenCalled();
  });

  test("a master admin is not covered, whatever the server requires", async () => {
    findOneById.mockResolvedValue(account({ isMasterAdmin: true }));

    await expect(
      SsoManagedSignIn.getSignInManagement(USER_ID),
    ).resolves.toEqual({ isManagedBySso: false, ssoProviderNames: [] });
  });

  test("providers that cannot be read leave the profile naming none, never showing the settings", async () => {
    getInstanceWideProviders.mockRejectedValue(new Error("pool exhausted"));

    await expect(
      SsoManagedSignIn.getSignInManagement(USER_ID),
    ).resolves.toEqual({ isManagedBySso: true, ssoProviderNames: [] });
    expect(logger.error).toHaveBeenCalled();
  });

  test("no provider on names none", async () => {
    getInstanceWideProviders.mockResolvedValue([]);

    await expect(
      SsoManagedSignIn.getSignInManagement(USER_ID),
    ).resolves.toEqual({ isManagedBySso: true, ssoProviderNames: [] });
  });

  test("a rule that cannot be read is an error to the profile, never a 'not managed'", async () => {
    getRequireSsoForLogin.mockRejectedValue(new Error("connection refused"));

    await expect(SsoManagedSignIn.getSignInManagement(USER_ID)).rejects.toThrow(
      "connection refused",
    );
  });
});
