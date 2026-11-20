import UserService from "../../../../Server/Services/UserService";
import InvitationInviterUtil, {
  InvitationInviter,
  MAX_INVITER_NAME_LENGTH,
} from "../../../../Server/Utils/TeamMember/InvitationInviter";
import User from "../../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../../Types/Email";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * WHO INVITED SOMEBODY, AS THE INVITATION NAMES THEM (#7471): the person
 * making the membership, read as their own account; nobody for OneUptime,
 * an API key, a workflow or the person themselves. Their name on one line,
 * for a subject; "Ada Walker (ada@walk.co)" in the first line; a reply to
 * them on a self-hosted server only.
 */

jest.mock("../../../../Server/Utils/Logger");

const ADA_ID: ObjectID = new ObjectID("72100000-0000-4000-8000-000000000001");
const GRACE_ID: ObjectID = new ObjectID("72100000-0000-4000-8000-000000000002");

const ADA: InvitationInviter = { name: "Ada Walker", email: "ada@walk.co" };
const NO_NAME: InvitationInviter = { name: "", email: "ada@walk.co" };

function account(name: string | null, email: string | null): User {
  const user: User = new User();
  user._id = ADA_ID.toString();

  if (name !== null) {
    user.name = new Name(name);
  }

  if (email !== null) {
    user.email = new Email(email);
  }

  return user;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("how the invitation names them", () => {
  test("by name, with the address to check it by", () => {
    expect(InvitationInviterUtil.getLabel(ADA)).toBe(
      "Ada Walker (ada@walk.co)",
    );
    expect(InvitationInviterUtil.getName(ADA)).toBe("Ada Walker");
  });

  test("by address alone, for an account with no name", () => {
    expect(InvitationInviterUtil.getLabel(NO_NAME)).toBe("ada@walk.co");
    expect(InvitationInviterUtil.getName(NO_NAME)).toBe("ada@walk.co");
  });

  test("the template's variables, or none for an invitation that names nobody", () => {
    expect(InvitationInviterUtil.getTemplateVars(ADA)).toEqual({
      inviterLabel: "Ada Walker (ada@walk.co)",
      inviterName: "Ada Walker",
    });
    expect(InvitationInviterUtil.getTemplateVars(null)).toEqual({});
  });

  test.each([
    [false, "Ada Walker invited you to Walk Co"],
    [true, "Ada Walker added you to Walk Co"],
  ])(
    "accepted %p, the subject says who and where to",
    (isAccepted: boolean, subject: string) => {
      expect(
        InvitationInviterUtil.getSubject({
          projectName: "Walk Co",
          inviter: ADA,
          isAccepted: isAccepted,
        }),
      ).toBe(subject);
    },
  );

  test.each([
    ["de", false, "Ada Walker hat Sie zu Walk Co eingeladen"],
    ["de", true, "Ada Walker hat Sie zu Walk Co hinzugefügt"],
    ["fr", false, "Ada Walker vous a invité à rejoindre Walk Co"],
    ["en", false, "Ada Walker invited you to Walk Co"],
  ])(
    "in %s, accepted %p, the subject is written in that language (#9897)",
    (language: string, isAccepted: boolean, subject: string) => {
      expect(
        InvitationInviterUtil.getSubject({
          projectName: "Walk Co",
          inviter: ADA,
          isAccepted: isAccepted,
          language: language,
        }),
      ).toBe(subject);
    },
  );

  test.each([
    [false, "You have been invited to Walk Co"],
    [true, "You have been added to Walk Co"],
  ])(
    "naming nobody, accepted %p, the subject is what it always was",
    (isAccepted: boolean, subject: string) => {
      expect(
        InvitationInviterUtil.getSubject({
          projectName: "Walk Co",
          inviter: null,
          isAccepted: isAccepted,
        }),
      ).toBe(subject);
    },
  );
});

describe("a name on one line", () => {
  test("joins its lines and runs of spaces, and drops control characters", () => {
    // A NUL, a line separator (U+2028) and a C1 control (U+0085).
    const controls: string = [0x0000, 0x2028, 0x0085]
      .map((code: number): string => {
        return String.fromCharCode(code);
      })
      .join("");

    expect(
      InvitationInviterUtil.toOneLine(
        `  Ada\r\nWalker${controls}Bcc: x@evil.example\t `,
      ),
    ).toBe("Ada Walker Bcc: x@evil.example");
  });

  test(`keeps at most ${MAX_INVITER_NAME_LENGTH} characters, never cutting one in two`, () => {
    const long: string = `${"a".repeat(MAX_INVITER_NAME_LENGTH - 1)}😀😀`;
    const line: string = InvitationInviterUtil.toOneLine(long);

    expect(Array.from(line)).toHaveLength(MAX_INVITER_NAME_LENGTH);
    expect(line.endsWith("😀")).toBe(true);
  });

  test("of nothing is nothing", () => {
    expect(InvitationInviterUtil.toOneLine(undefined)).toBe("");
    expect(InvitationInviterUtil.toOneLine("   ")).toBe("");
  });

  test("an account is read with its name on one line", () => {
    expect(
      InvitationInviterUtil.fromUser(account("Ada\nWalker", "ada@walk.co")),
    ).toEqual({ name: "Ada Walker", email: "ada@walk.co" });
  });

  test("an account with no address names nobody", () => {
    expect(InvitationInviterUtil.fromUser(account("Ada", null))).toBeNull();
    expect(InvitationInviterUtil.fromUser(null)).toBeNull();
  });
});

describe("where a reply goes", () => {
  test("to the inviter, on a self-hosted server", () => {
    expect(
      InvitationInviterUtil.getReplyTo({
        inviter: ADA,
        isSelfHosted: true,
      })?.toString(),
    ).toBe("ada@walk.co");
  });

  test("where it always went on OneUptime Cloud, and for an invitation that names nobody", () => {
    expect(
      InvitationInviterUtil.getReplyTo({ inviter: ADA, isSelfHosted: false }),
    ).toBeUndefined();
    expect(
      InvitationInviterUtil.getReplyTo({ inviter: null, isSelfHosted: true }),
    ).toBeUndefined();
  });

  test("never to something that is not one mailbox", () => {
    expect(
      InvitationInviterUtil.getReplyTo({
        inviter: { name: "Ada", email: "ada@walk.co, x@evil.example" },
        isSelfHosted: true,
      }),
    ).toBeUndefined();
  });
});

describe("who made the invitation", () => {
  const PERSON: DatabaseCommonInteractionProps = {
    userId: ADA_ID,
  } as DatabaseCommonInteractionProps;

  test("the request's person, read as OneUptime, by name and address", async () => {
    const findSpy: SpyInstance<typeof UserService.findOneById> = jest
      .spyOn(UserService, "findOneById")
      .mockResolvedValue(account("Ada Walker", "ada@walk.co"));

    await expect(
      InvitationInviterUtil.read({ props: PERSON, inviteeUserId: GRACE_ID }),
    ).resolves.toEqual(ADA);

    const read: { id: ObjectID; props: unknown; select: unknown } = findSpy.mock
      .calls[0]![0] as unknown as {
      id: ObjectID;
      props: unknown;
      select: unknown;
    };

    expect(read.id.toString()).toBe(ADA_ID.toString());
    expect(read.props).toEqual({ isRoot: true });
    // And her language: what the invitation is written in when the invitee picked none (#9897).
    expect(read.select).toEqual({
      _id: true,
      name: true,
      email: true,
      language: true,
    });
  });

  test("with the language the inviter's account picked, and none when it picked none (#9897)", async () => {
    const ada: User = account("Ada Walker", "ada@walk.co");
    ada.language = "de";

    jest.spyOn(UserService, "findOneById").mockResolvedValue(ada);

    await expect(
      InvitationInviterUtil.read({ props: PERSON, inviteeUserId: GRACE_ID }),
    ).resolves.toEqual({ ...ADA, language: "de" });

    expect(
      InvitationInviterUtil.fromUser(account("Ada Walker", "ada@walk.co")),
    ).toEqual(ADA);
    expect(
      "language" in
        InvitationInviterUtil.fromUser(account("Ada Walker", "ada@walk.co"))!,
    ).toBe(false);
  });

  test.each([
    ["OneUptime itself", { isRoot: true }],
    ["an API key", { tenantId: ObjectID.generate() }],
  ] as Array<[string, DatabaseCommonInteractionProps]>)(
    "an invitation %s makes names nobody, and reads nothing",
    async (_maker: string, props: DatabaseCommonInteractionProps) => {
      const findSpy: SpyInstance<typeof UserService.findOneById> = jest.spyOn(
        UserService,
        "findOneById",
      );

      await expect(
        InvitationInviterUtil.read({ props: props, inviteeUserId: GRACE_ID }),
      ).resolves.toBeNull();
      expect(findSpy).not.toHaveBeenCalled();
    },
  );

  test("nor does one a person makes for themselves", async () => {
    const findSpy: SpyInstance<typeof UserService.findOneById> = jest.spyOn(
      UserService,
      "findOneById",
    );

    await expect(
      InvitationInviterUtil.read({
        props: PERSON,
        inviteeUserId: new ObjectID(ADA_ID.toString().toUpperCase()),
      }),
    ).resolves.toBeNull();
    expect(findSpy).not.toHaveBeenCalled();
  });

  test("an account that cannot be read names nobody, and the invitation goes on", async () => {
    jest
      .spyOn(UserService, "findOneById")
      .mockRejectedValue(new Error("The database went away.") as never);

    await expect(
      InvitationInviterUtil.read({ props: PERSON, inviteeUserId: GRACE_ID }),
    ).resolves.toBeNull();
  });

  test("an account that is not there names nobody", async () => {
    jest.spyOn(UserService, "findOneById").mockResolvedValue(null);

    await expect(InvitationInviterUtil.readById(ADA_ID)).resolves.toBeNull();
    await expect(InvitationInviterUtil.readById(null)).resolves.toBeNull();
  });
});
