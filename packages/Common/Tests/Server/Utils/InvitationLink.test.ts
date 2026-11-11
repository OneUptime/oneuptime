import { beforeEach, describe, expect, jest, test } from "@jest/globals";

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

const teamMemberFindOneById: jest.Mock = jest.fn();
const userFindOneById: jest.Mock = jest.fn();
const generateRegistrationLink: jest.Mock = jest.fn();

jest.mock("../../../Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (...args: Array<unknown>): unknown => {
        return teamMemberFindOneById(...args);
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
  userFindOneById.mockReset();
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
