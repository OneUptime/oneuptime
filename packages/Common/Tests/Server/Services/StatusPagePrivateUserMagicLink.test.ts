import StatusPagePrivateUserService from "../../../Server/Services/StatusPagePrivateUserService";
import { EncryptionSecret } from "../../../Server/EnvironmentConfig";
import StatusPagePrivateUser from "../../../Models/DatabaseModels/StatusPagePrivateUser";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * ---------------------------------------------------------------------------
 * StatusPagePrivateUserService.consumeMagicLinkToken - spending a private
 * status page's sign-in link (Types/StatusPage/StatusPageMagicLink).
 *
 * A link is a bearer credential for the account, so:
 *
 *  - it is looked up by its token's hash on its own status page, never by
 *    the token, and an empty token looks nothing up (an empty value hashes
 *    to "");
 *  - it is spent by the same write that checks it - the token's hash, the
 *    page, the expiry and the user not being removed all in the UPDATE's
 *    predicate - so of two requests carrying one link only the one whose
 *    write lands signs in;
 *  - an expired link, or one with no expiry, is not spent and signs nobody
 *    in.
 *
 * Stubbed at the service and repository boundary; the database half -
 * one link racing itself, a removed user, the email change that ends it -
 * is StatusPagePrivateUserMagicLinkPostgres.test.ts.
 * ---------------------------------------------------------------------------
 */

const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "56000000-0000-4000-8000-000000000100",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "56000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("56000000-0000-4000-8000-0000000000aa");
const TOKEN: string = "6f1c7e4a-2b3d-4c5e-8f90-a1b2c3d4e5f6";

function storedUser(expires: Date | undefined): StatusPagePrivateUser {
  const user: StatusPagePrivateUser = new StatusPagePrivateUser();
  user._id = USER_ID.toString();
  user.email = new Email("reader@example.com");
  user.statusPageId = STATUS_PAGE_ID;
  user.projectId = PROJECT_ID;
  user.magicLinkExpires = expires;
  return user;
}

let findOneBy: jest.SpyInstance;
let repositoryUpdate: jest.Mock;

beforeEach(() => {
  findOneBy = jest
    .spyOn(StatusPagePrivateUserService, "findOneBy")
    .mockResolvedValue(
      storedUser(OneUptimeDate.getSomeMinutesAfter(10)) as never,
    );

  repositoryUpdate = jest.fn().mockResolvedValue({ affected: 1 } as never);

  jest
    .spyOn(StatusPagePrivateUserService, "getRepository")
    .mockReturnValue({ update: repositoryUpdate } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

type UpdateCall = [Record<string, unknown>, Record<string, unknown>];

describe("StatusPagePrivateUserService.consumeMagicLinkToken", () => {
  test("spends a live link and hands back who it signs in - without the link's expiry", async () => {
    const user: StatusPagePrivateUser | null =
      await StatusPagePrivateUserService.consumeMagicLinkToken({
        statusPageId: STATUS_PAGE_ID,
        token: TOKEN,
      });

    expect(user?.id?.toString()).toBe(USER_ID.toString());
    expect(user?.email?.toString()).toBe("reader@example.com");
    expect(user?.statusPageId?.toString()).toBe(STATUS_PAGE_ID.toString());
    expect(user?.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(user?.magicLinkExpires).toBeUndefined();
  });

  test("looks the link up by its token's hash, on this status page, as root", async () => {
    await StatusPagePrivateUserService.consumeMagicLinkToken({
      statusPageId: STATUS_PAGE_ID,
      token: TOKEN,
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
      statusPageId: STATUS_PAGE_ID,
      magicLinkToken: await HashedString.hashValue(TOKEN, EncryptionSecret),
    });
    expect(JSON.stringify(lookup.query)).not.toContain(TOKEN);
    expect(lookup.select).toMatchObject({
      _id: true,
      email: true,
      statusPageId: true,
      projectId: true,
      magicLinkExpires: true,
    });
    expect(lookup.props["isRoot"]).toBe(true);
  });

  test("spends the link in the same write that checks it", async () => {
    await StatusPagePrivateUserService.consumeMagicLinkToken({
      statusPageId: STATUS_PAGE_ID,
      token: TOKEN,
    });

    expect(repositoryUpdate).toHaveBeenCalledTimes(1);

    const [criteria, data] = repositoryUpdate.mock.calls[0] as UpdateCall;

    expect(criteria["_id"]).toBe(USER_ID.toString());
    expect(criteria["statusPageId"]).toEqual(STATUS_PAGE_ID);
    expect(criteria["magicLinkToken"]).toBe(
      await HashedString.hashValue(TOKEN, EncryptionSecret),
    );

    // Still live as the write lands, and the user not removed since.
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

    expect(data).toEqual({ magicLinkToken: null, magicLinkExpires: null });
  });

  test("a link another request spent first signs nobody in", async () => {
    repositoryUpdate.mockResolvedValue({ affected: 0 } as never);

    expect(
      await StatusPagePrivateUserService.consumeMagicLinkToken({
        statusPageId: STATUS_PAGE_ID,
        token: TOKEN,
      }),
    ).toBeNull();
  });

  test.each([
    ["no link matches", null],
    ["the link expired", storedUser(OneUptimeDate.getSomeMinutesAgo(1))],
    ["the link has no expiry", storedUser(undefined)],
  ])(
    "%s: nothing is spent and nobody signs in",
    async (_name: string, found: StatusPagePrivateUser | null) => {
      findOneBy.mockResolvedValue(found as never);

      expect(
        await StatusPagePrivateUserService.consumeMagicLinkToken({
          statusPageId: STATUS_PAGE_ID,
          token: TOKEN,
        }),
      ).toBeNull();
      expect(repositoryUpdate).not.toHaveBeenCalled();
    },
  );

  test("a row that came back without an id spends nothing", async () => {
    const user: StatusPagePrivateUser = storedUser(
      OneUptimeDate.getSomeMinutesAfter(10),
    );
    delete user._id;
    findOneBy.mockResolvedValue(user as never);

    expect(
      await StatusPagePrivateUserService.consumeMagicLinkToken({
        statusPageId: STATUS_PAGE_ID,
        token: TOKEN,
      }),
    ).toBeNull();
    expect(repositoryUpdate).not.toHaveBeenCalled();
  });

  test("an empty token looks nothing up: it would hash to the empty string", async () => {
    expect(await HashedString.hashValue("", EncryptionSecret)).toBe("");

    expect(
      await StatusPagePrivateUserService.consumeMagicLinkToken({
        statusPageId: STATUS_PAGE_ID,
        token: "",
      }),
    ).toBeNull();
    expect(findOneBy).not.toHaveBeenCalled();
    expect(repositoryUpdate).not.toHaveBeenCalled();
  });
});
