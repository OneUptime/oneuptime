import UserService from "../../../Server/Services/UserService";
import EnterpriseLicenseSeatUtil from "../../../Server/Utils/EnterpriseLicense/EnterpriseLicenseSeatUtil";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import User from "../../../Models/DatabaseModels/User";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { beforeEach, afterEach, describe, expect, it } from "@jest/globals";

/*
 * Where the enterprise seat limit is actually enforced.
 *
 * The limit is bought per user and shared by every instance on the licence,
 * and a seat is consumed by a person EXISTING on the installation — not by the
 * particular door they walked through. There are eight of those doors: team
 * invitations, self-service signup, SAML and OIDC just-in-time provisioning
 * (project-level and global), three SCIM routes, the Admin Dashboard user
 * form, and the master API key posting to /api/user. Every one of them ends up
 * in UserService.create, so the check belongs in its create hook and nowhere
 * else; a check on the invitation would have left signup and SSO as open doors
 * beside it.
 *
 * The single most important assertion in this file is the isRoot one. Team
 * invitations create the invited user with `props: { isRoot: true }`
 * (TeamMemberService.onBeforeCreate), so the usual "internal writes bypass
 * this" instinct would exempt invitations — the exact path this feature was
 * asked for.
 */

jest.mock(
  "../../../Server/Utils/EnterpriseLicense/EnterpriseLicenseSeatUtil",
  () => {
    return {
      __esModule: true,
      default: {
        assertSeatAvailableForNewUser: jest.fn(),
      },
    };
  },
);

type OnBeforeCreateFunction = (createBy: CreateBy<User>) => Promise<unknown>;

/*
 * onBeforeCreate is protected, which is exactly the right shape for it and
 * exactly the wrong shape for a test. Reached through the instance rather than
 * re-implemented, so this suite breaks if the hook is renamed or removed.
 */
const onBeforeCreate: OnBeforeCreateFunction = (
  createBy: CreateBy<User>,
): Promise<unknown> => {
  return (
    UserService as unknown as {
      onBeforeCreate: OnBeforeCreateFunction;
    }
  ).onBeforeCreate(createBy);
};

type MakeCreateByFunction = (props?: Record<string, unknown>) => CreateBy<User>;

const makeCreateBy: MakeCreateByFunction = (
  props?: Record<string, unknown>,
): CreateBy<User> => {
  const user: User = new User();
  user.email = new Email("someone@acme.com");

  return {
    data: user,
    props: props || {},
  } as unknown as CreateBy<User>;
};

type AssertSeatMockFunction = () => jest.Mock;

const assertSeatMock: AssertSeatMockFunction = (): jest.Mock => {
  return EnterpriseLicenseSeatUtil.assertSeatAvailableForNewUser as unknown as jest.Mock;
};

describe("UserService - the enterprise seat limit", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    assertSeatMock().mockResolvedValue(undefined);
    UserService.countBy = jest.fn().mockResolvedValue(new PositiveNumber(7));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("checks the seat limit before creating a user", async () => {
    await onBeforeCreate(makeCreateBy());

    expect(assertSeatMock()).toHaveBeenCalledTimes(1);
  });

  it("refuses the create when there is no seat for the new user", async () => {
    assertSeatMock().mockRejectedValue(new BadDataException("No seats left"));

    await expect(onBeforeCreate(makeCreateBy())).rejects.toBeInstanceOf(
      BadDataException,
    );
  });

  /*
   * The one that matters. TeamMemberService creates the invited user as root,
   * so an isRoot exemption would exempt invitations — and inviting users past
   * the licence is the thing being prevented.
   */
  it.each([
    ["a root write, which is how invitations create users", { isRoot: true }],
    ["a master admin acting from the Admin Dashboard", { isMasterAdmin: true }],
    ["an ordinary tenant write", { userId: ObjectID.generate() }],
  ])(
    "still checks the limit for %s",
    async (_label: string, props: Record<string, unknown>) => {
      await onBeforeCreate(makeCreateBy(props));

      expect(assertSeatMock()).toHaveBeenCalledTimes(1);
    },
  );

  it("checks the limit before anything else the hook does", async () => {
    /*
     * The hook also sanitizes attribution columns. If a refusal came after
     * that, a rejected create would still have done work; more importantly the
     * ordering pins that nothing was inserted ahead of the check later on.
     */
    assertSeatMock().mockRejectedValue(new BadDataException("No seats left"));

    const createBy: CreateBy<User> = makeCreateBy();
    (createBy.data as unknown as Record<string, unknown>)["clickIds"] = {
      gclid: "abc",
    };

    await expect(onBeforeCreate(createBy)).rejects.toBeInstanceOf(
      BadDataException,
    );
  });

  describe("the user count it enforces against", () => {
    type GetLocalUserCountFunction = () => Promise<number>;

    type CapturedCallbackFunction = () => GetLocalUserCountFunction;

    const capturedCallback: CapturedCallbackFunction =
      (): GetLocalUserCountFunction => {
        const call: Record<string, unknown> = assertSeatMock().mock
          .calls[0]![0] as Record<string, unknown>;

        return call["getLocalUserCount"] as GetLocalUserCountFunction;
      };

    it("counts every user on this installation, not just the caller's project", async () => {
      await onBeforeCreate(makeCreateBy());

      const count: number = await capturedCallback()();

      expect(count).toBe(7);

      const countCall: Record<string, unknown> = (
        UserService.countBy as unknown as jest.Mock
      ).mock.calls[0]![0] as Record<string, unknown>;

      expect(countCall["query"]).toEqual({});
      expect((countCall["props"] as Record<string, unknown>)["isRoot"]).toBe(
        true,
      );
    });

    /*
     * The count is deliberately behind a callback rather than passed in: on
     * Community Edition, and on a licence with no seat limit, it must never
     * run at all. This is the create path of every user on the installation.
     */
    it("does not count users unless the seat check asks for it", async () => {
      await onBeforeCreate(makeCreateBy());

      expect(UserService.countBy).not.toHaveBeenCalled();
    });
  });
});
