import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * THE INVITATION LINK, FOR A MASTER ADMIN TO SEND (#6825).
 *
 * On a server that cannot send email, a master admin who invites someone is
 * handed what the invitation email would have carried:
 *
 *   - someone with no account yet gets the sign-up link with a registration
 *     token, minted exactly as the email's is (UserRegistrationToken: for
 *     this account and this address, single use, a week);
 *   - someone with an account gets the sign-in page, and no token is minted
 *     for an account that cannot be claimed;
 *   - an invitation that is not there gets no link at all.
 */

const teamMemberFindOneById: Mock = jest.fn();
const teamMemberFindBy: Mock = jest.fn();
const userFindOneById: Mock = jest.fn();
const userFindBy: Mock = jest.fn();
const generateRegistrationLink: Mock = jest.fn();

jest.mock("../../../Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (...args: Array<unknown>): unknown => {
        return teamMemberFindOneById(...args);
      },
      findBy: (...args: Array<unknown>): unknown => {
        return teamMemberFindBy(...args);
      },
    },
  };
});

jest.mock("../../../Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (...args: Array<unknown>): unknown => {
        return userFindOneById(...args);
      },
      findBy: (...args: Array<unknown>): unknown => {
        return userFindBy(...args);
      },
    },
  };
});

jest.mock("../../../Server/Utils/UserRegistrationToken", () => {
  return {
    __esModule: true,
    default: {
      generateRegistrationLink: (...args: Array<unknown>): unknown => {
        return generateRegistrationLink(...args);
      },
    },
  };
});

jest.mock("../../../Server/DatabaseConfig", () => {
  return {
    __esModule: true,
    default: {
      getHost: async (): Promise<unknown> => {
        const { default: Hostname } = await import(
          "../../../Types/API/Hostname"
        );
        return new Hostname("oneuptime.example.com");
      },
      getHttpProtocol: async (): Promise<unknown> => {
        const { default: Protocol } = await import(
          "../../../Types/API/Protocol"
        );
        return Protocol.HTTPS;
      },
    },
  };
});

import InvitationLink, {
  InvitationLinkAnswer,
  MAX_MEMBERSHIPS_PER_SIGN_UP_READ,
} from "../../../Server/Utils/InvitationLink";
import URL from "../../../Types/API/URL";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";

const TEAM_MEMBER_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();
const EMAIL: Email = new Email("new.person@example.com");

beforeEach(() => {
  teamMemberFindOneById.mockReset();
  teamMemberFindBy.mockReset();
  userFindOneById.mockReset();
  userFindBy.mockReset();
  generateRegistrationLink.mockReset();

  teamMemberFindOneById.mockResolvedValue({ userId: USER_ID } as never);
  generateRegistrationLink.mockResolvedValue(
    URL.fromString(
      `https://oneuptime.example.com/accounts/register?email=${encodeURIComponent(EMAIL.toString())}&token=11111111-2222-3333-4444-555555555555`,
    ) as never,
  );
});

describe("someone who has no account yet", () => {
  test("gets the sign-up link with a registration token for this account and address", async () => {
    userFindOneById.mockResolvedValue({
      id: USER_ID,
      email: EMAIL,
      password: undefined,
    } as never);

    const answer: InvitationLinkAnswer =
      await InvitationLink.getForTeamMember(TEAM_MEMBER_ID);

    expect(answer.isRegistered).toBe(false);
    expect(answer.email).toBe(EMAIL.toString());
    expect(answer.link).toContain("/accounts/register");
    expect(answer.link).toContain("token=");

    expect(generateRegistrationLink).toHaveBeenCalledTimes(1);
    expect(generateRegistrationLink).toHaveBeenCalledWith({
      userId: USER_ID,
      email: EMAIL,
    });
  });

  test("reads the membership and the account as root, by their ids", async () => {
    userFindOneById.mockResolvedValue({
      id: USER_ID,
      email: EMAIL,
    } as never);

    await InvitationLink.getForTeamMember(TEAM_MEMBER_ID);

    const memberArgs: Record<string, any> = teamMemberFindOneById.mock
      .calls[0]![0] as Record<string, any>;
    const userArgs: Record<string, any> = userFindOneById.mock
      .calls[0]![0] as Record<string, any>;

    expect(memberArgs["id"]).toBe(TEAM_MEMBER_ID);
    expect(memberArgs["props"]).toEqual({ isRoot: true });
    expect(userArgs["id"]).toBe(USER_ID);
    expect(userArgs["select"]["password"]).toBe(true);
  });
});

describe("someone who already has an account", () => {
  test("gets the sign-in page, and no token is minted", async () => {
    userFindOneById.mockResolvedValue({
      id: USER_ID,
      email: EMAIL,
      password: "a-password-hash",
    } as never);

    const answer: InvitationLinkAnswer =
      await InvitationLink.getForTeamMember(TEAM_MEMBER_ID);

    expect(answer.isRegistered).toBe(true);
    expect(answer.link).toBe("https://oneuptime.example.com/accounts");
    expect(answer.link).not.toContain("token");
    expect(generateRegistrationLink).not.toHaveBeenCalled();
  });
});

describe("an invitation that is not there", () => {
  test("no membership: no link, and nothing minted", async () => {
    teamMemberFindOneById.mockResolvedValue(null as never);

    await expect(
      InvitationLink.getForTeamMember(TEAM_MEMBER_ID),
    ).rejects.toBeInstanceOf(BadDataException);
    expect(generateRegistrationLink).not.toHaveBeenCalled();
  });

  test("a membership whose account is gone: no link either", async () => {
    userFindOneById.mockResolvedValue(null as never);

    await expect(
      InvitationLink.getForTeamMember(TEAM_MEMBER_ID),
    ).rejects.toBeInstanceOf(BadDataException);
    expect(generateRegistrationLink).not.toHaveBeenCalled();
  });
});

/*
 * Get Invitation Link on a pending person's row (#7168) reads the link
 * again, for an invitation somebody else made or one whose link expired.
 */
describe("read again, later", () => {
  test("each read mints a new token, for the same account and address", async () => {
    userFindOneById.mockResolvedValue({
      id: USER_ID,
      email: EMAIL,
      password: undefined,
    } as never);
    generateRegistrationLink
      .mockResolvedValueOnce(
        URL.fromString(
          "https://oneuptime.example.com/accounts/register?email=new.person%40example.com&token=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        ) as never,
      )
      .mockResolvedValueOnce(
        URL.fromString(
          "https://oneuptime.example.com/accounts/register?email=new.person%40example.com&token=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        ) as never,
      );

    const first: InvitationLinkAnswer =
      await InvitationLink.getForTeamMember(TEAM_MEMBER_ID);
    const second: InvitationLinkAnswer =
      await InvitationLink.getForTeamMember(TEAM_MEMBER_ID);

    expect(generateRegistrationLink).toHaveBeenCalledTimes(2);
    expect(first.link).not.toBe(second.link);

    for (const call of generateRegistrationLink.mock.calls) {
      expect(call[0]).toEqual({ userId: USER_ID, email: EMAIL });
    }
  });

  test("the link is for the account the membership names, whatever team it is on", async () => {
    const OTHER_TEAM_MEMBER_ID: ObjectID = ObjectID.generate();
    userFindOneById.mockResolvedValue({
      id: USER_ID,
      email: EMAIL,
      password: undefined,
    } as never);

    await InvitationLink.getForTeamMember(OTHER_TEAM_MEMBER_ID);

    expect(
      (teamMemberFindOneById.mock.calls[0]![0] as Record<string, unknown>)[
        "id"
      ],
    ).toBe(OTHER_TEAM_MEMBER_ID);
    expect(
      (userFindOneById.mock.calls[0]![0] as Record<string, unknown>)["id"],
    ).toBe(USER_ID);
  });
});

/*
 * The link is the account's, not the membership's: an accepted invitation
 * does not change it.
 */
describe("an invitation that was accepted", () => {
  test("accepted for them, before they had an account: still the sign-up link", async () => {
    teamMemberFindOneById.mockResolvedValue({
      userId: USER_ID,
      hasAcceptedInvitation: true,
    } as never);
    userFindOneById.mockResolvedValue({
      id: USER_ID,
      email: EMAIL,
      password: undefined,
    } as never);

    const answer: InvitationLinkAnswer =
      await InvitationLink.getForTeamMember(TEAM_MEMBER_ID);

    expect(answer.isRegistered).toBe(false);
    expect(answer.link).toContain("/accounts/register");
    expect(generateRegistrationLink).toHaveBeenCalledTimes(1);
  });

  test("by someone with an account: the sign-in page, and nothing minted", async () => {
    teamMemberFindOneById.mockResolvedValue({
      userId: USER_ID,
      hasAcceptedInvitation: true,
    } as never);
    userFindOneById.mockResolvedValue({
      id: USER_ID,
      email: EMAIL,
      password: "a-password-hash",
    } as never);

    const answer: InvitationLinkAnswer =
      await InvitationLink.getForTeamMember(TEAM_MEMBER_ID);

    expect(answer.isRegistered).toBe(true);
    expect(answer.link).toBe("https://oneuptime.example.com/accounts");
    expect(generateRegistrationLink).not.toHaveBeenCalled();
  });
});

/*
 * Whether the membership is accepted already, so the dialog can say there
 * is nothing left to accept (#8191).
 */
describe("whether the invitation was accepted", () => {
  test("the membership is read with whether it was accepted", async () => {
    userFindOneById.mockResolvedValue({
      id: USER_ID,
      email: EMAIL,
      password: "a-password-hash",
    } as never);

    await InvitationLink.getForTeamMember(TEAM_MEMBER_ID);

    expect(
      (teamMemberFindOneById.mock.calls[0]![0] as Record<string, any>)[
        "select"
      ],
    ).toEqual({ userId: true, hasAcceptedInvitation: true });
  });

  test.each([
    // [accepted, has a password, isRegistered, isAccepted]
    [false, false, false, false],
    [false, true, true, false],
    [true, false, false, true],
    [true, true, true, true],
    [undefined, true, true, false],
  ])(
    "accepted %p, a password %p: registered %p, accepted %p",
    async (
      hasAcceptedInvitation: boolean | undefined,
      hasPassword: boolean,
      isRegistered: boolean,
      isAccepted: boolean,
    ) => {
      teamMemberFindOneById.mockResolvedValue({
        userId: USER_ID,
        hasAcceptedInvitation: hasAcceptedInvitation,
      } as never);
      userFindOneById.mockResolvedValue({
        id: USER_ID,
        email: EMAIL,
        password: hasPassword ? "a-password-hash" : undefined,
      } as never);

      const answer: InvitationLinkAnswer =
        await InvitationLink.getForTeamMember(TEAM_MEMBER_ID);

      expect({
        isRegistered: answer.isRegistered,
        isAccepted: answer.isAccepted,
      }).toEqual({ isRegistered, isAccepted });
    },
  );
});

/*
 * WHICH MEMBERSHIPS' PEOPLE HAVE NOT SIGNED UP (#8191).
 *
 * A list shows someone whose invitation was accepted for them as Member,
 * and cannot tell from the row whether they have an account: it asks, for
 * the rows on its page. The answer is the memberships whose account has no
 * password - nothing else about anybody.
 */
describe("the memberships whose person has not signed up", () => {
  const MEMBERSHIP_A: ObjectID = ObjectID.generate();
  const MEMBERSHIP_B: ObjectID = ObjectID.generate();
  const MEMBERSHIP_C: ObjectID = ObjectID.generate();
  const SIGNED_UP_USER: ObjectID = ObjectID.generate();
  const INVITED_USER: ObjectID = ObjectID.generate();

  const ids: (list: Array<ObjectID>) => Array<string> = (
    list: Array<ObjectID>,
  ): Array<string> => {
    return list.map((id: ObjectID): string => {
      return id.toString();
    });
  };

  test("are the ones whose account has no password", async () => {
    teamMemberFindBy.mockResolvedValue([
      { id: MEMBERSHIP_A, userId: INVITED_USER },
      { id: MEMBERSHIP_B, userId: SIGNED_UP_USER },
    ] as never);
    userFindBy.mockResolvedValue([
      { id: INVITED_USER, password: undefined },
      { id: SIGNED_UP_USER, password: "a-password-hash" },
    ] as never);

    expect(
      ids(
        await InvitationLink.getMembershipsNotSignedUp([
          MEMBERSHIP_A,
          MEMBERSHIP_B,
        ]),
      ),
    ).toEqual([MEMBERSHIP_A.toString()]);
  });

  test("every membership of someone who has not signed up is named", async () => {
    teamMemberFindBy.mockResolvedValue([
      { id: MEMBERSHIP_A, userId: INVITED_USER },
      { id: MEMBERSHIP_C, userId: INVITED_USER },
    ] as never);
    userFindBy.mockResolvedValue([
      { id: INVITED_USER, password: undefined },
    ] as never);

    expect(
      ids(
        await InvitationLink.getMembershipsNotSignedUp([
          MEMBERSHIP_A,
          MEMBERSHIP_C,
        ]),
      ),
    ).toEqual([MEMBERSHIP_A.toString(), MEMBERSHIP_C.toString()]);

    // Their account is read once.
    const userQuery: Record<string, any> = userFindBy.mock
      .calls[0]![0] as Record<string, any>;

    expect(userQuery["limit"]).toBe(1);
  });

  test("reads the memberships and the accounts as root, asking only whether there is a password", async () => {
    teamMemberFindBy.mockResolvedValue([
      { id: MEMBERSHIP_A, userId: INVITED_USER },
    ] as never);
    userFindBy.mockResolvedValue([
      { id: INVITED_USER, password: undefined },
    ] as never);

    await InvitationLink.getMembershipsNotSignedUp([MEMBERSHIP_A]);

    const memberQuery: Record<string, any> = teamMemberFindBy.mock
      .calls[0]![0] as Record<string, any>;
    const userQuery: Record<string, any> = userFindBy.mock
      .calls[0]![0] as Record<string, any>;

    expect(memberQuery["props"]).toEqual({ isRoot: true });
    expect(memberQuery["select"]).toEqual({ _id: true, userId: true });
    expect(memberQuery["limit"]).toBe(1);
    expect(userQuery["props"]).toEqual({ isRoot: true });
    expect(userQuery["select"]).toEqual({ _id: true, password: true });
  });

  test("a membership that is not there, or whose account is gone, is left out", async () => {
    teamMemberFindBy.mockResolvedValue([
      { id: MEMBERSHIP_A, userId: INVITED_USER },
      { id: MEMBERSHIP_B, userId: undefined },
    ] as never);
    // The account was deleted: no row for it.
    userFindBy.mockResolvedValue([] as never);

    expect(
      await InvitationLink.getMembershipsNotSignedUp([
        MEMBERSHIP_A,
        MEMBERSHIP_B,
        MEMBERSHIP_C,
      ]),
    ).toEqual([]);
  });

  test("nobody to ask about reads nothing", async () => {
    expect(await InvitationLink.getMembershipsNotSignedUp([])).toEqual([]);
    expect(teamMemberFindBy).not.toHaveBeenCalled();
    expect(userFindBy).not.toHaveBeenCalled();
  });

  test("memberships with no account read no accounts", async () => {
    teamMemberFindBy.mockResolvedValue([
      { id: MEMBERSHIP_A, userId: undefined },
    ] as never);

    expect(
      await InvitationLink.getMembershipsNotSignedUp([MEMBERSHIP_A]),
    ).toEqual([]);
    expect(userFindBy).not.toHaveBeenCalled();
  });

  test(`more than a page (${MAX_MEMBERSHIPS_PER_SIGN_UP_READ}) is refused, and nothing is read`, async () => {
    const tooMany: Array<ObjectID> = Array.from(
      { length: MAX_MEMBERSHIPS_PER_SIGN_UP_READ + 1 },
      (): ObjectID => {
        return ObjectID.generate();
      },
    );

    await expect(
      InvitationLink.getMembershipsNotSignedUp(tooMany),
    ).rejects.toBeInstanceOf(BadDataException);
    expect(teamMemberFindBy).not.toHaveBeenCalled();
  });

  test("a page's worth is read", async () => {
    teamMemberFindBy.mockResolvedValue([] as never);

    await InvitationLink.getMembershipsNotSignedUp(
      Array.from({ length: MAX_MEMBERSHIPS_PER_SIGN_UP_READ }, (): ObjectID => {
        return ObjectID.generate();
      }),
    );

    expect(teamMemberFindBy).toHaveBeenCalledTimes(1);
  });

  test("a page is a list's largest page", () => {
    expect(MAX_MEMBERSHIPS_PER_SIGN_UP_READ).toBe(100);
  });
});
