import UserService from "../../../Server/Services/UserService";
import { EncryptionSecret } from "../../../Server/EnvironmentConfig";
import User from "../../../Models/DatabaseModels/User";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * ---------------------------------------------------------------------------
 * UserService.findByMagicLinkToken and consumeMagicLinkToken - reading and
 * spending an account's sign-in link (Types/Accounts/MagicLink).
 *
 * A link is a bearer credential for the account, so:
 *
 *  - it is looked up by its token's hash, never by the token, as root, and
 *    an empty token looks nothing up (an empty value hashes to "");
 *  - reading it spends nothing: a sign-in begun with a link still has it for
 *    the second factor that finishes it;
 *  - an expired link, or one with no expiry, is no link;
 *  - it is spent by the same write that checks it - the token's hash, the
 *    account, the expiry and the account not being removed all in the
 *    UPDATE's predicate - so of two requests carrying one link only the one
 *    whose write lands signs in; and that write touches only the two link
 *    columns, so the hooks that a verified address sets off (its default
 *    notification rules) are left to the hooked update that verifies it.
 *
 * Stubbed at the service and repository boundary; the database half - one
 * link racing itself, an expired link, a removed account - is
 * UserMagicLinkPostgres.test.ts.
 * ---------------------------------------------------------------------------
 */

const USER_ID: ObjectID = new ObjectID("57000000-0000-4000-8000-0000000000aa");
const TOKEN: string = "6f1c7e4a-2b3d-4c5e-8f90-a1b2c3d4e5f6";

function storedUser(expires: Date | undefined): User {
  const user: User = new User();
  user._id = USER_ID.toString();
  user.email = new Email("ada@example.com");
  user.isEmailVerified = true;
  user.enableTwoFactorAuth = false;

  if (expires) {
    user.magicLinkExpires = expires;
  }

  return user;
}

let findOneBy: jest.SpyInstance;
let repositoryUpdate: jest.Mock;

beforeEach(() => {
  findOneBy = jest
    .spyOn(UserService, "findOneBy")
    .mockResolvedValue(
      storedUser(OneUptimeDate.getSomeMinutesAfter(10)) as never,
    );

  repositoryUpdate = jest.fn().mockResolvedValue({ affected: 1 } as never);

  jest
    .spyOn(UserService, "getRepository")
    .mockReturnValue({ update: repositoryUpdate } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

type UpdateCall = [Record<string, unknown>, Record<string, unknown>];

describe("UserService.findByMagicLinkToken", () => {
  test("finds the account a live link signs in - without the link's expiry", async () => {
    const user: User | null = await UserService.findByMagicLinkToken({
      token: TOKEN,
      select: { _id: true, email: true, isEmailVerified: true },
    });

    expect(user?.id?.toString()).toBe(USER_ID.toString());
    expect(user?.email?.toString()).toBe("ada@example.com");
    expect(user?.magicLinkExpires).toBeUndefined();
  });

  test("looks the link up by its token's hash, as root, with the columns asked for and the expiry", async () => {
    await UserService.findByMagicLinkToken({
      token: TOKEN,
      select: { email: true, enableTwoFactorAuth: true, password: true },
    });

    const lookup: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    } = findOneBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    };

    expect(lookup.query).toEqual({
      magicLinkToken: await HashedString.hashValue(TOKEN, EncryptionSecret),
    });
    expect(JSON.stringify(lookup.query)).not.toContain(TOKEN);
    expect(lookup.select).toEqual({
      email: true,
      enableTwoFactorAuth: true,
      password: true,
      _id: true,
      magicLinkExpires: true,
    });
    expect(lookup.props["isRoot"]).toBe(true);
  });

  test("only reads: it spends nothing", async () => {
    await UserService.findByMagicLinkToken({
      token: TOKEN,
      select: { _id: true },
    });

    expect(repositoryUpdate).not.toHaveBeenCalled();
  });

  test.each([
    ["no link matches", null],
    ["the link expired", storedUser(OneUptimeDate.getSomeMinutesAgo(1))],
    ["the link has no expiry", storedUser(undefined)],
  ])("%s: no account", async (_name: string, found: User | null) => {
    findOneBy.mockResolvedValue(found as never);

    expect(
      await UserService.findByMagicLinkToken({
        token: TOKEN,
        select: { _id: true },
      }),
    ).toBeNull();
  });

  test("a row that came back without an id is no account", async () => {
    const user: User = storedUser(OneUptimeDate.getSomeMinutesAfter(10));
    delete user._id;
    findOneBy.mockResolvedValue(user as never);

    expect(
      await UserService.findByMagicLinkToken({
        token: TOKEN,
        select: { _id: true },
      }),
    ).toBeNull();
  });

  test("an empty token looks nothing up: it would hash to the empty string", async () => {
    expect(await HashedString.hashValue("", EncryptionSecret)).toBe("");

    expect(
      await UserService.findByMagicLinkToken({
        token: "",
        select: { _id: true },
      }),
    ).toBeNull();
    expect(findOneBy).not.toHaveBeenCalled();
  });
});

describe("UserService.consumeMagicLinkToken", () => {
  test("spends a live link: true for the request whose write cleared it", async () => {
    expect(
      await UserService.consumeMagicLinkToken({
        userId: USER_ID,
        token: TOKEN,
      }),
    ).toBe(true);
  });

  test("spends the link in the same write that checks it", async () => {
    await UserService.consumeMagicLinkToken({ userId: USER_ID, token: TOKEN });

    expect(repositoryUpdate).toHaveBeenCalledTimes(1);

    const [criteria] = repositoryUpdate.mock.calls[0] as UpdateCall;

    expect(criteria["_id"]).toBe(USER_ID.toString());
    expect(criteria["magicLinkToken"]).toBe(
      await HashedString.hashValue(TOKEN, EncryptionSecret),
    );
    expect(JSON.stringify(criteria)).not.toContain(TOKEN);

    // Still live as the write lands, and the account not removed since.
    const expires: FindOperator<Date> = criteria[
      "magicLinkExpires"
    ] as FindOperator<Date>;
    expect(expires).toBeInstanceOf(FindOperator);
    expect(expires.type).toBe("moreThan");
    expect(Math.abs(expires.value.getTime() - Date.now())).toBeLessThan(5000);

    const deletedAt: FindOperator<unknown> = criteria[
      "deletedAt"
    ] as FindOperator<unknown>;
    expect(deletedAt).toBeInstanceOf(FindOperator);
    expect(deletedAt.type).toBe("isNull");
  });

  test("clears the two link columns and nothing else - the address is verified through the hooks", async () => {
    await UserService.consumeMagicLinkToken({ userId: USER_ID, token: TOKEN });

    const [, data] = repositoryUpdate.mock.calls[0] as UpdateCall;

    expect(data).toEqual({ magicLinkToken: null, magicLinkExpires: null });
  });

  test("does not read the account first: the write alone decides", async () => {
    await UserService.consumeMagicLinkToken({ userId: USER_ID, token: TOKEN });

    expect(findOneBy).not.toHaveBeenCalled();
  });

  test.each([
    ["another request spent it first", 0],
    ["it matched nothing", undefined],
  ])(
    "%s: false, and nobody is signed in",
    async (_name: string, affected: number | undefined) => {
      repositoryUpdate.mockResolvedValue({ affected: affected } as never);

      expect(
        await UserService.consumeMagicLinkToken({
          userId: USER_ID,
          token: TOKEN,
        }),
      ).toBe(false);
    },
  );

  test("an empty token spends nothing: it would hash to the empty string", async () => {
    expect(
      await UserService.consumeMagicLinkToken({ userId: USER_ID, token: "" }),
    ).toBe(false);
    expect(repositoryUpdate).not.toHaveBeenCalled();
  });
});
