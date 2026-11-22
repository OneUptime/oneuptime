import User from "../../../../Models/DatabaseModels/User";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import UserService from "../../../../Server/Services/UserService";
import FeedPersonName, {
  FEED_INVITEE_UNNAMED,
  FEED_NOBODY_NAMED,
  FeedPersonStanding,
} from "../../../../Server/Utils/Feed/FeedPersonName";
import PendingInviteeProfiles, {
  WithheldProfile,
} from "../../../../Server/Utils/TeamMember/PendingInviteeProfiles";
import { ON_CALL_CHAT_INVITEE_UNNAMED } from "../../../../Server/Utils/OnCall/OnCallChatText";
import { ON_CALL_CHAT_NOBODY_NAMED } from "../../../../Server/Utils/OnCall/OnCallChatByWorkspace";
import URL from "../../../../Types/API/URL";
import Email from "../../../../Types/Email";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
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
 * HOW EVERY FEED ENTRY AND CHANNEL LINE NAMES A PERSON (#10616, #10668,
 * #10669): FeedPersonName, the one place.
 *
 * Someone only invited to the project is named by the name typed with their
 * invitation, else "someone who hasn't joined the project yet", as text -
 * never by their account's own name (#9823) or any address. A member is
 * named by their name, else by the part of their address before the "@",
 * linked to their page. Whether someone is only invited is read once per
 * person per change; a read that fails names them "Somebody".
 */

const DASHBOARD: string = "https://oneuptime.example/dashboard";

const PROJECT_ID: ObjectID = new ObjectID(
  "fe600000-0000-4000-8000-000000000001",
);
const IVY_ID: ObjectID = new ObjectID("fe600000-0000-4000-8000-000000000002");
const ANA_ID: ObjectID = new ObjectID("fe600000-0000-4000-8000-000000000003");
const BO_ID: ObjectID = new ObjectID("fe600000-0000-4000-8000-000000000004");
const GONE_ID: ObjectID = new ObjectID("fe600000-0000-4000-8000-000000000005");

const pageOf: (userId: ObjectID) => string = (userId: ObjectID): string => {
  return `${DASHBOARD}/${PROJECT_ID.toString()}/users/${userId.toString()}`;
};

function person(data: {
  id: ObjectID;
  name?: string | undefined;
  email?: string | undefined;
}): User {
  const user: User = new User();
  user._id = data.id.toString();

  if (data.name !== undefined) {
    user.name = new Name(data.name);
  }

  if (data.email !== undefined) {
    user.email = new Email(data.email);
  }

  return user;
}

// The accounts OneUptime reads: Ivy's own name is never the project's to see.
let accounts: Array<User> = [];
// Who of them is only invited, and what their invitation kept.
let invitations: Map<string, WithheldProfile> = new Map<
  string,
  WithheldProfile
>();

let withheldReads: SpyInstance<
  typeof PendingInviteeProfiles.readWithheldProfilesInProject
>;
let userReads: SpyInstance<typeof UserService.findOneBy>;

beforeEach(() => {
  accounts = [
    person({ id: IVY_ID, name: "Ivy Account", email: "ivy@acme.test" }),
    person({ id: ANA_ID, name: "Ana Lee", email: "ana.lee@acme.test" }),
    person({ id: BO_ID, email: "bo.chen@acme.test" }),
  ];
  invitations = new Map<string, WithheldProfile>([
    [
      IVY_ID.toString(),
      { inviteeName: "Ivy from Payments", inviteeEmail: "ivy.new@acme.test" },
    ],
  ]);

  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString(DASHBOARD));

  userReads = jest
    .spyOn(UserService, "findOneBy")
    .mockImplementation((async (findBy: {
      query: { _id?: unknown };
    }): Promise<User | null> => {
      return (
        accounts.find((account: User): boolean => {
          return account._id === String(findBy.query._id).toLowerCase();
        }) || null
      );
    }) as never);

  withheldReads = jest
    .spyOn(PendingInviteeProfiles, "readWithheldProfilesInProject")
    .mockImplementation(
      async (data: {
        userIds: Array<string>;
      }): Promise<Map<string, WithheldProfile>> => {
        const withheld: Map<string, WithheldProfile> = new Map<
          string,
          WithheldProfile
        >();

        for (const userId of data.userIds) {
          const invitation: WithheldProfile | undefined = invitations.get(
            userId.toLowerCase(),
          );

          if (invitation) {
            withheld.set(userId.toLowerCase(), invitation);
          }
        }

        return withheld;
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

const invite: (inviteeName: string | null) => void = (
  inviteeName: string | null,
): void => {
  invitations.set(IVY_ID.toString(), {
    inviteeName: inviteeName,
    inviteeEmail: "ivy.new@acme.test",
  });
};

describe("the rule", () => {
  test("a name a line may say: trimmed, and none when empty or holding an address", () => {
    expect(FeedPersonName.getDisplayName("  Ivy Hart  ")).toBe("Ivy Hart");
    expect(FeedPersonName.getDisplayName(new Name("Ana Lee"))).toBe("Ana Lee");
    expect(FeedPersonName.getDisplayName("")).toBe("");
    expect(FeedPersonName.getDisplayName("   ")).toBe("");
    expect(FeedPersonName.getDisplayName(null)).toBe("");
    expect(FeedPersonName.getDisplayName(undefined)).toBe("");
    expect(FeedPersonName.getDisplayName("ivy@invited.test")).toBe("");
    expect(FeedPersonName.getDisplayName("Ivy (ivy@x.io)")).toBe("");
  });

  test("someone only invited: the name typed for them, else the words for nobody named - never an address", () => {
    expect(
      FeedPersonName.getInviteeName({
        inviteeName: " Ivy from Payments ",
        inviteeEmail: "ivy@acme.test",
      }),
    ).toBe("Ivy from Payments");

    for (const inviteeName of [null, "", "   ", "ivy@acme.test"]) {
      expect(
        FeedPersonName.getInviteeName({
          inviteeName: inviteeName,
          inviteeEmail: "ivy@acme.test",
        }),
      ).toBe(FEED_INVITEE_UNNAMED);
    }

    expect(FEED_INVITEE_UNNAMED).toBe(
      "someone who hasn't joined the project yet",
    );
  });

  test("a member: their name, else the part of their address before the @ (#10669)", () => {
    expect(
      FeedPersonName.getMemberName({
        name: new Name("Ana Lee"),
        email: new Email("ana.lee@acme.test"),
      }),
    ).toBe("Ana Lee");
    expect(
      FeedPersonName.getMemberName({
        name: undefined,
        email: new Email("ana.lee@acme.test"),
      }),
    ).toBe("ana.lee");
    expect(
      FeedPersonName.getMemberName({ name: "  ", email: "bo.chen@acme.test" }),
    ).toBe("bo.chen");
    // SSO can send the address as the name.
    expect(
      FeedPersonName.getMemberName({
        name: "ana.lee@acme.test",
        email: "ana.lee@acme.test",
      }),
    ).toBe("ana.lee");
    expect(FeedPersonName.getMemberName({ name: null, email: null })).toBe("");
  });

  test("the part of an address before the @: never an address, nor the part of a quoted one that still holds an @", () => {
    expect(FeedPersonName.getAddressName("ana.lee@acme.test")).toBe("ana.lee");
    expect(FeedPersonName.getAddressName("  bo+oncall@acme.test ")).toBe(
      "bo+oncall",
    );
    expect(FeedPersonName.getAddressName('"ana lee"@acme.test')).toBe(
      "ana lee",
    );
    expect(FeedPersonName.getAddressName('"a@b"@acme.test')).toBe("");
    expect(FeedPersonName.getAddressName("@acme.test")).toBe("");
    expect(FeedPersonName.getAddressName("no address")).toBe("");
    expect(FeedPersonName.getAddressName(null)).toBe("");
  });

  test("anyone read already, given who of them is only invited", () => {
    const withheld: Map<string, WithheldProfile> = new Map<
      string,
      WithheldProfile
    >([[IVY_ID.toString(), { inviteeName: null }]]);

    expect(
      FeedPersonName.getName({
        userId: IVY_ID,
        name: "Ivy Account",
        email: "ivy@acme.test",
        withheld: withheld,
      }),
    ).toBe(FEED_INVITEE_UNNAMED);
    expect(
      FeedPersonName.getName({
        userId: BO_ID,
        name: undefined,
        email: "bo.chen@acme.test",
        withheld: withheld,
      }),
    ).toBe("bo.chen");
  });

  test("the on-call lines say the same words: one rule, one set of words", () => {
    expect(ON_CALL_CHAT_INVITEE_UNNAMED).toBe(FEED_INVITEE_UNNAMED);
    expect(ON_CALL_CHAT_NOBODY_NAMED).toBe(FEED_NOBODY_NAMED);
    expect(FEED_NOBODY_NAMED).toBe("Somebody");
  });
});

describe("a person in a line, as Markdown", () => {
  const nameOf: (userId: ObjectID) => Promise<string> = async (
    userId: ObjectID,
  ): Promise<string> => {
    return (
      await FeedPersonName.getMarkdown({
        userId: userId,
        projectId: PROJECT_ID,
      })
    ).toString();
  };

  test("a member: their name, linked to their page in the project", async () => {
    expect(await nameOf(ANA_ID)).toBe(`[Ana Lee](${pageOf(ANA_ID)})`);
  });

  test("a member with no name: the part of their address before the @, linked", async () => {
    expect(await nameOf(BO_ID)).toBe(`[bo.chen](${pageOf(BO_ID)})`);
  });

  test("someone only invited: the name typed for them, as text - never their account's own name or any address", async () => {
    const named: string = await nameOf(IVY_ID);

    expect(named).toBe("Ivy from Payments");
    expect(named).not.toContain("Ivy Account");
    expect(named).not.toContain(pageOf(IVY_ID));
  });

  test.each([
    ["no name typed", null],
    ["only spaces typed", "   "],
    ["an address typed as the name", "ivy.new@acme.test"],
  ])(
    "someone only invited with %s: someone who hasn't joined the project yet",
    async (_label: string, inviteeName: string | null) => {
      invite(inviteeName);

      const named: string = await nameOf(IVY_ID);

      expect(named).toBe(FEED_INVITEE_UNNAMED);
      expect(named).not.toContain("@");
    },
  );

  test("whether they are only invited cannot be read: Somebody, never something that could be their address", async () => {
    withheldReads.mockRejectedValue(new Error("the database is away"));

    expect(await nameOf(IVY_ID)).toBe(FEED_NOBODY_NAMED);
    expect(await nameOf(ANA_ID)).toBe(FEED_NOBODY_NAMED);
  });

  test("nobody: no id, no read at all; no such person, empty", async () => {
    expect(
      (
        await FeedPersonName.getMarkdown({
          userId: undefined,
          projectId: PROJECT_ID,
        })
      ).isEmpty(),
    ).toBe(true);
    expect(userReads).not.toHaveBeenCalled();
    expect(withheldReads).not.toHaveBeenCalled();

    expect(await nameOf(GONE_ID)).toBe("");
  });

  test("a name is text inside its link: it cannot re-point the link, add an image or mention anybody", async () => {
    accounts.push(
      person({
        id: GONE_ID,
        name: "x](https://evil.example) ![p](https://t.example/p.png) <!channel>",
        email: "x@acme.test",
      }),
    );

    const named: string = await nameOf(GONE_ID);

    expect(named.endsWith(`](${pageOf(GONE_ID)})`)).toBe(true);
    expect(named).not.toContain("](https://evil.example)");
    expect(named).not.toContain("![p](");
    expect(named).not.toContain("<!channel>");
  });

  test("UserService.getUserMarkdownString names them the same, through the shared place", async () => {
    for (const userId of [IVY_ID, ANA_ID, BO_ID]) {
      expect(
        (
          await UserService.getUserMarkdownString({
            userId: userId,
            projectId: PROJECT_ID,
          })
        ).toString(),
      ).toBe(await nameOf(userId));
    }
  });

  test("the project asked about is the line's", async () => {
    await nameOf(IVY_ID);

    expect(withheldReads.mock.calls[0]![0].projectId).toBe(PROJECT_ID);
    expect(withheldReads.mock.calls[0]![0].userIds).toEqual([
      IVY_ID.toString(),
    ]);
  });
});

describe("a person in a line, as text", () => {
  test("named as in Markdown, without the link", async () => {
    const people: FeedPersonName = new FeedPersonName({
      projectId: PROJECT_ID,
    });

    expect(await people.textOf(ANA_ID)).toBe("Ana Lee");
    expect(await people.textOf(BO_ID)).toBe("bo.chen");
    expect(await people.textOf(IVY_ID)).toBe("Ivy from Payments");
    expect(await people.textOf(GONE_ID)).toBe("");
    expect(await people.textOf(null)).toBe("");

    invite(null);

    expect(
      await FeedPersonName.getText({ userId: IVY_ID, projectId: PROJECT_ID }),
    ).toBe(FEED_INVITEE_UNNAMED);
  });

  test("unread: Somebody", async () => {
    withheldReads.mockRejectedValue(new Error("the database is away"));

    expect(
      await FeedPersonName.getText({ userId: IVY_ID, projectId: PROJECT_ID }),
    ).toBe(FEED_NOBODY_NAMED);
  });
});

describe("one read per person per change", () => {
  test("whoever a change names is read once, however many lines name them", async () => {
    const people: FeedPersonName = new FeedPersonName({
      projectId: PROJECT_ID,
    });

    await people.nameOf(IVY_ID);
    await people.nameOf(IVY_ID);
    await people.textOf(IVY_ID);
    await people.getStanding(IVY_ID);
    await people.nameOf(new ObjectID(IVY_ID.toString().toUpperCase()));

    expect(withheldReads).toHaveBeenCalledTimes(1);

    await people.nameOf(ANA_ID);

    expect(withheldReads).toHaveBeenCalledTimes(2);
  });

  test("the standing a line reads: invited with the name said, and whether one was typed; a member; or unread", async () => {
    const people: FeedPersonName = new FeedPersonName({
      projectId: PROJECT_ID,
    });

    expect(await people.getStanding(IVY_ID)).toEqual({
      isInvited: true,
      name: "Ivy from Payments",
      isNamed: true,
    });
    expect(await people.getStanding(ANA_ID)).toEqual({ isInvited: false });

    invite("   ");

    const unnamed: FeedPersonStanding = await new FeedPersonName({
      projectId: PROJECT_ID,
    }).getStanding(IVY_ID);

    expect(unnamed).toEqual({
      isInvited: true,
      name: FEED_INVITEE_UNNAMED,
      isNamed: false,
    });

    withheldReads.mockRejectedValue(new Error("the database is away"));

    expect(
      await new FeedPersonName({ projectId: PROJECT_ID }).getStanding(IVY_ID),
    ).toBeNull();
  });

  test("with no project, nobody is pending to it: nothing is read", async () => {
    expect(
      await new FeedPersonName({ projectId: null }).getStanding(IVY_ID),
    ).toEqual({ isInvited: false });
    expect(withheldReads).not.toHaveBeenCalled();
  });
});

describe("many people in one line", () => {
  test("one read of who is only invited, for them all", async () => {
    invite(null);

    const names: Map<string, string> = await FeedPersonName.readNames({
      users: [...accounts, null, undefined],
      projectId: PROJECT_ID,
    });

    expect(withheldReads).toHaveBeenCalledTimes(1);
    expect(names.get(IVY_ID.toString())).toBe(FEED_INVITEE_UNNAMED);
    expect(names.get(ANA_ID.toString())).toBe("Ana Lee");
    expect(names.get(BO_ID.toString())).toBe("bo.chen");
    expect(names.size).toBe(3);

    for (const name of names.values()) {
      expect(name).not.toContain("@");
      expect(name).not.toBe("Ivy Account");
    }
  });

  test("unread: each of them is Somebody", async () => {
    withheldReads.mockRejectedValue(new Error("the database is away"));

    const names: Map<string, string> = await FeedPersonName.readNames({
      users: accounts,
      projectId: PROJECT_ID,
    });

    expect([...names.values()]).toEqual([
      FEED_NOBODY_NAMED,
      FEED_NOBODY_NAMED,
      FEED_NOBODY_NAMED,
    ]);
  });

  test("nobody: no read", async () => {
    expect(
      (await FeedPersonName.readNames({ users: [], projectId: PROJECT_ID }))
        .size,
    ).toBe(0);
    expect(withheldReads).not.toHaveBeenCalled();
  });
});
