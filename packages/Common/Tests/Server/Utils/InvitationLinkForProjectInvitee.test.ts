import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserService from "../../../Server/Services/UserService";
import InvitationLink, {
  INVITATION_NOT_IN_PROJECT_MESSAGE,
  InvitationLinkAnswer,
} from "../../../Server/Utils/InvitationLink";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * THE INVITATION LINK OF AN INVITATION EMAIL THE SERVER FAILED TO SEND
 * (#7169).
 *
 * The server's email log keeps a failed invitation by the project and the
 * address it went to, and its row offers Get Invitation Link. The link is
 * read by those: the person's membership in the project - one still waiting
 * for them first, else one accepted for them - as getForTeamMember reads a
 * membership. An address with no account, or an account no longer in the
 * project, has no invitation to send, and is told so.
 */

jest.mock("../../../Server/Utils/Logger");

const PROJECT_ID: ObjectID = new ObjectID(
  "75100000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("75200000-0000-4000-8000-000000000001");
const PENDING_ID: ObjectID = new ObjectID(
  "75300000-0000-4000-8000-000000000001",
);
const ACCEPTED_ID: ObjectID = new ObjectID(
  "75300000-0000-4000-8000-000000000002",
);
const EMAIL: Email = new Email("grace@walk.example");

const ANSWER: InvitationLinkAnswer = {
  link: "https://oneuptime.example.com/accounts/register?token=x",
  isRegistered: false,
  isAccepted: false,
  email: EMAIL.toString(),
};

function membership(id: ObjectID): TeamMember {
  const member: TeamMember = new TeamMember();
  member._id = id.toString();
  return member;
}

let findUserSpy: SpyInstance<typeof UserService.findOneBy>;
let findMembershipSpy: SpyInstance<typeof TeamMemberService.findOneBy>;
let getForTeamMemberSpy: SpyInstance<typeof InvitationLink.getForTeamMember>;

beforeEach(() => {
  const user: User = new User();
  user._id = USER_ID.toString();

  findUserSpy = jest.spyOn(UserService, "findOneBy").mockResolvedValue(user);
  findMembershipSpy = jest
    .spyOn(TeamMemberService, "findOneBy")
    .mockImplementation((async (args: {
      query: { hasAcceptedInvitation: boolean };
    }) => {
      return args.query.hasAcceptedInvitation
        ? membership(ACCEPTED_ID)
        : membership(PENDING_ID);
    }) as never);
  getForTeamMemberSpy = jest
    .spyOn(InvitationLink, "getForTeamMember")
    .mockResolvedValue(ANSWER);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("InvitationLink.getForProjectInvitee", () => {
  test("reads the link of the invitation still waiting for them in the project", async () => {
    await expect(
      InvitationLink.getForProjectInvitee({
        projectId: PROJECT_ID,
        email: EMAIL,
      }),
    ).resolves.toEqual(ANSWER);

    expect(getForTeamMemberSpy).toHaveBeenCalledTimes(1);
    expect(getForTeamMemberSpy.mock.calls[0]![0].toString()).toBe(
      PENDING_ID.toString(),
    );
  });

  test("looks the account up by the address, and the membership by the account and the project, as OneUptime", async () => {
    await InvitationLink.getForProjectInvitee({
      projectId: PROJECT_ID,
      email: EMAIL,
    });

    const userRead: { query: { email: Email }; props: unknown } = findUserSpy
      .mock.calls[0]![0] as unknown as {
      query: { email: Email };
      props: unknown;
    };

    expect(userRead.query.email.toString()).toBe(EMAIL.toString());
    expect(userRead.props).toEqual({ isRoot: true });

    const membershipRead: {
      query: Record<string, unknown>;
      props: unknown;
    } = findMembershipSpy.mock.calls[0]![0] as unknown as {
      query: Record<string, unknown>;
      props: unknown;
    };

    expect(String(membershipRead.query["userId"])).toBe(USER_ID.toString());
    expect(String(membershipRead.query["projectId"])).toBe(
      PROJECT_ID.toString(),
    );
    expect(membershipRead.query["hasAcceptedInvitation"]).toBe(false);
    expect(membershipRead.props).toEqual({ isRoot: true });
  });

  test("with none waiting, reads the membership accepted for them: they may still have to sign up", async () => {
    findMembershipSpy.mockImplementation((async (args: {
      query: { hasAcceptedInvitation: boolean };
    }) => {
      return args.query.hasAcceptedInvitation ? membership(ACCEPTED_ID) : null;
    }) as never);

    await InvitationLink.getForProjectInvitee({
      projectId: PROJECT_ID,
      email: EMAIL,
    });

    expect(getForTeamMemberSpy.mock.calls[0]![0].toString()).toBe(
      ACCEPTED_ID.toString(),
    );
  });

  test("an address with no account has no invitation to send", async () => {
    findUserSpy.mockResolvedValue(null);

    await expect(
      InvitationLink.getForProjectInvitee({
        projectId: PROJECT_ID,
        email: EMAIL,
      }),
    ).rejects.toThrow(new BadDataException(INVITATION_NOT_IN_PROJECT_MESSAGE));
    expect(findMembershipSpy).not.toHaveBeenCalled();
    expect(getForTeamMemberSpy).not.toHaveBeenCalled();
  });

  test("an account no longer in the project has none either", async () => {
    findMembershipSpy.mockResolvedValue(null);

    await expect(
      InvitationLink.getForProjectInvitee({
        projectId: PROJECT_ID,
        email: EMAIL,
      }),
    ).rejects.toThrow(INVITATION_NOT_IN_PROJECT_MESSAGE);
    expect(getForTeamMemberSpy).not.toHaveBeenCalled();
  });

  test("says what to do instead, as a sentence", () => {
    expect(INVITATION_NOT_IN_PROJECT_MESSAGE).toBe(
      "This person is not invited to this project any more, so there is no invitation link to send. Invite them again from the project's Users page.",
    );
  });
});
