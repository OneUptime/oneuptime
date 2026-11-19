import User from "../../../Models/DatabaseModels/User";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import UserService from "../../../Server/Services/UserService";
import PendingInviteeProfiles, {
  WithheldProfile,
} from "../../../Server/Utils/TeamMember/PendingInviteeProfiles";
import URL from "../../../Types/API/URL";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
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
 * A FEED LINE NAMES SOMEONE ONLY INVITED AS THE PROJECT KNOWS THEM (#9823).
 *
 * UserService.getUserMarkdownString reads a person as OneUptime and names
 * them in feed items and chat messages the project's people read: "Added
 * [Ada](...) to the incident as the owner", an override for someone, a
 * page to someone. Someone invited to the project who has not accepted is
 * named by the name typed for them, else their address - never by their
 * account's own name, which would tell the inviter whose the address is.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0194d4ba-0000-4000-8000-00000000d101",
);
const PENDING_ID: ObjectID = new ObjectID(
  "0194d4ba-0000-4000-8000-00000000d102",
);
const MEMBER_ID: ObjectID = new ObjectID(
  "0194d4ba-0000-4000-8000-00000000d103",
);

const DASHBOARD_URL: string = "https://oneuptime.example/dashboard";

function person(data: { id: ObjectID; name: string; email: string }): User {
  const user: User = new User();
  user._id = data.id.toString();
  user.name = new Name(data.name);
  user.email = new Email(data.email);
  return user;
}

describe("UserService.getUserMarkdownString names someone only invited as the project knows them", () => {
  let withheldIn: SpyInstance<
    typeof PendingInviteeProfiles.readWithheldProfilesInProject
  >;

  beforeEach(() => {
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(URL.fromString(DASHBOARD_URL));

    withheldIn = jest
      .spyOn(PendingInviteeProfiles, "readWithheldProfilesInProject")
      .mockImplementation(
        async (data: {
          userIds: Array<string>;
          projectId: ObjectID;
        }): Promise<Map<string, WithheldProfile>> => {
          return new Map<string, WithheldProfile>(
            data.userIds
              .filter((id: string): boolean => {
                return id.toLowerCase() === PENDING_ID.toString();
              })
              .map((id: string): [string, WithheldProfile] => {
                return [
                  id.toLowerCase(),
                  { inviteeName: "Grace from Payments" },
                ];
              }),
          );
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function markdownFor(user: User): Promise<string> {
    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);

    return (
      await UserService.getUserMarkdownString({
        userId: new ObjectID(user._id!),
        projectId: PROJECT_ID,
      })
    ).toString();
  }

  test("someone only invited is the name typed for them, never their own", async () => {
    const markdown: string = await markdownFor(
      person({
        id: PENDING_ID,
        name: "Grace Hopper",
        email: "grace@example.com",
      }),
    );

    expect(markdown).toContain("Grace from Payments");
    expect(markdown).not.toContain("Hopper");
    expect(markdown).toContain(
      `${DASHBOARD_URL}/${PROJECT_ID.toString()}/users/${PENDING_ID.toString()}`,
    );
    expect(withheldIn).toHaveBeenCalledTimes(1);
    expect(withheldIn.mock.calls[0]![0].projectId).toBe(PROJECT_ID);
  });

  test("someone only invited with no name typed is their address", async () => {
    withheldIn.mockResolvedValue(
      new Map<string, WithheldProfile>([
        [PENDING_ID.toString(), { inviteeName: null }],
      ]),
    );

    const markdown: string = await markdownFor(
      person({
        id: PENDING_ID,
        name: "Grace Hopper",
        email: "grace@example.com",
      }),
    );

    expect(markdown).toContain("grace@example.com");
    expect(markdown).not.toContain("Hopper");
  });

  test("a member is their own name", async () => {
    const markdown: string = await markdownFor(
      person({
        id: MEMBER_ID,
        name: "Ada Lovelace",
        email: "ada@example.com",
      }),
    );

    expect(markdown).toContain("Ada Lovelace");
    expect(markdown).not.toContain("ada@example.com");
  });
});
