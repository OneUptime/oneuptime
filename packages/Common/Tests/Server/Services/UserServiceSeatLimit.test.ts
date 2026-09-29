import UserService from "../../../Server/Services/UserService";
import EnterpriseEdition from "../../../Server/Enterprise/EnterpriseEdition";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import User from "../../../Models/DatabaseModels/User";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import FakeEnterpriseModule, {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
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
 * The limit itself is the Enterprise license client's (ee/Server/License); core
 * asks it through EnterpriseEdition.assertSeatAvailableForNewUser, which is a
 * no-op on the Community Edition. What the license client decides (billing,
 * license status, the live user count) is tested in ee/Tests/Server/License.
 *
 * The single most important assertion in this file is the isRoot one. Team
 * invitations create the invited user with `props: { isRoot: true }`
 * (TeamMemberService.onBeforeCreate), so the usual "internal writes bypass
 * this" instinct would exempt invitations — the exact path this feature was
 * asked for.
 */

// CI's config.env sets BILLING_ENABLED=true; this suite pins it per test.
jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

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

describe("UserService - the enterprise seat limit", () => {
  let fake: FakeEnterpriseModule;

  beforeEach(() => {
    jest.clearAllMocks();
    setTestBillingEnabled(false);
    fake = installFakeEnterpriseModule();
    UserService.countBy = jest.fn().mockResolvedValue(new PositiveNumber(7));
  });

  afterEach(() => {
    uninstallEnterpriseModule();
    setTestBillingEnabled(false);
    jest.restoreAllMocks();
  });

  it("asks the Enterprise license client before creating a user", async () => {
    const assertSpy: jest.SpyInstance = jest.spyOn(
      EnterpriseEdition,
      "assertSeatAvailableForNewUser",
    );

    await onBeforeCreate(makeCreateBy());

    expect(assertSpy).toHaveBeenCalledTimes(1);
    expect(assertSpy).toHaveBeenCalledWith();
    expect(fake.licensing.seatChecks).toBe(1);
  });

  it("refuses the create when there is no seat for the new user", async () => {
    fake.licensing.seatError = new BadDataException("No seats left");

    await expect(onBeforeCreate(makeCreateBy())).rejects.toBeInstanceOf(
      BadDataException,
    );
  });

  it("passes the license client's refusal through unchanged", async () => {
    fake.licensing.seatError = new BadDataException(
      "This OneUptime installation has reached the 10-user limit of its enterprise license.",
    );

    await expect(onBeforeCreate(makeCreateBy())).rejects.toThrow(
      "reached the 10-user limit",
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

      expect(fake.licensing.seatChecks).toBe(1);
    },
  );

  it.each([
    ["a root write", { isRoot: true }],
    ["a master admin", { isMasterAdmin: true }],
  ])(
    "refuses %s when the license is full",
    async (_label: string, props: Record<string, unknown>) => {
      fake.licensing.seatError = new BadDataException("No seats left");

      await expect(onBeforeCreate(makeCreateBy(props))).rejects.toBeInstanceOf(
        BadDataException,
      );
    },
  );

  it("checks the limit before anything else the hook does", async () => {
    /*
     * The hook also sanitizes attribution columns. If a refusal came after
     * that, a rejected create would still have done work; more importantly the
     * ordering pins that nothing was inserted ahead of the check later on.
     */
    fake.licensing.seatError = new BadDataException("No seats left");

    const createBy: CreateBy<User> = makeCreateBy();
    (createBy.data as unknown as Record<string, unknown>)["clickIds"] = {
      gclid: "abc",
    };

    await expect(onBeforeCreate(createBy)).rejects.toBeInstanceOf(
      BadDataException,
    );
    expect(
      (createBy.data as unknown as Record<string, unknown>)["clickIds"],
    ).toEqual({ gclid: "abc" });
  });

  /*
   * Counting users is the license client's business, and only when a limit
   * applies. The create path of every user on the installation must not pay
   * for a count in core.
   */
  it("does not count users itself", async () => {
    await onBeforeCreate(makeCreateBy());

    expect(UserService.countBy).not.toHaveBeenCalled();
  });

  describe("on the Community Edition", () => {
    beforeEach(() => {
      uninstallEnterpriseModule();
    });

    it("has no seat limit at all", async () => {
      await expect(onBeforeCreate(makeCreateBy())).resolves.toBeDefined();
      expect(UserService.countBy).not.toHaveBeenCalled();
    });

    it("has no seat limit for root writes either", async () => {
      await expect(
        onBeforeCreate(makeCreateBy({ isRoot: true })),
      ).resolves.toBeDefined();
    });

    it("has no seat limit with billing on", async () => {
      setTestBillingEnabled(true);

      await expect(onBeforeCreate(makeCreateBy())).resolves.toBeDefined();
    });
  });
});
