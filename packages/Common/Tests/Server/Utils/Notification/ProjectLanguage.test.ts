import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import UserService from "../../../../Server/Services/UserService";
import logger from "../../../../Server/Utils/Logger";
import ProjectLanguage, {
  getProjectLanguageOf,
} from "../../../../Server/Utils/Notification/ProjectLanguage";
import Includes from "../../../../Types/BaseDatabase/Includes";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * THE LANGUAGE A PROJECT'S PEOPLE READ IN (#10369): what OneUptime writes
 * once for everyone in a project - OneUptime AI's analysis of a new Data
 * Security issue - is in the language more than half of its members picked
 * for their account, and in English otherwise, or when it cannot be read.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10369200-0000-4000-8000-000000000001",
);

function memberOf(userId: ObjectID): TeamMember {
  return Object.assign(new TeamMember(), { userId });
}

function userWith(id: ObjectID, language?: string): User {
  const user: User = new User(id);

  if (language !== undefined) {
    user.language = language;
  }

  return user;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getProjectLanguageOf", () => {
  test.each([
    ["more than half picked German", ["de", "de", "en"], "de"],
    ["everyone picked French", ["fr", "fr"], "fr"],
    [
      "the most picked German, but not more than half",
      ["de", "de", "fr", ""],
      "en",
    ],
    ["exactly half picked Japanese", ["ja", ""], "en"],
    ["a few picked Hindi, and the many picked none", ["hi", "", "", ""], "en"],
    ["nobody picked any", ["", ""], "en"],
    ["there are no members", [], "en"],
  ])("%s: %s", (_name: string, languages: Array<string>, expected: string) => {
    expect(getProjectLanguageOf(languages)).toBe(expected);
  });
});

describe("ProjectLanguage.getLanguage", () => {
  test("reads the members who accepted, each once, and the language each picked, as OneUptime", async () => {
    const first: ObjectID = ObjectID.generate();
    const second: ObjectID = ObjectID.generate();
    const members: SpyInstance<typeof TeamMemberService.findBy> = jest
      .spyOn(TeamMemberService, "findBy")
      .mockResolvedValue([memberOf(first), memberOf(second), memberOf(first)]);
    const users: SpyInstance<typeof UserService.findBy> = jest
      .spyOn(UserService, "findBy")
      .mockResolvedValue([userWith(first, "de"), userWith(second, "de")]);

    expect(await ProjectLanguage.getLanguage(PROJECT_ID)).toBe("de");

    const memberQuery: JSONObject = members.mock.calls[0]![0]
      .query as JSONObject;

    expect(memberQuery["projectId"]).toEqual(PROJECT_ID);
    expect(memberQuery["hasAcceptedInvitation"]).toBe(true);
    expect(members.mock.calls[0]![0].props).toEqual({ isRoot: true });
    expect(
      (
        (users.mock.calls[0]![0].query as JSONObject)["_id"] as Includes
      ).values.map((id: unknown): string => {
        return String(id);
      }),
    ).toEqual([first.toString(), second.toString()]);
    expect(users.mock.calls[0]![0].select).toEqual({ language: true });
  });

  test("a language OneUptime is not written in counts as none", async () => {
    const first: ObjectID = ObjectID.generate();
    const second: ObjectID = ObjectID.generate();

    jest
      .spyOn(TeamMemberService, "findBy")
      .mockResolvedValue([memberOf(first), memberOf(second)]);
    jest
      .spyOn(UserService, "findBy")
      .mockResolvedValue([userWith(first, "tlh"), userWith(second, "tlh")]);

    expect(await ProjectLanguage.getLanguage(PROJECT_ID)).toBe("en");
  });

  test("a project with no members who accepted is English, and no user is read", async () => {
    jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([]);
    const users: SpyInstance<typeof UserService.findBy> = jest.spyOn(
      UserService,
      "findBy",
    );

    expect(await ProjectLanguage.getLanguage(PROJECT_ID)).toBe("en");
    expect(users).not.toHaveBeenCalled();
  });

  test("a read that fails is English, never a throw", async () => {
    jest
      .spyOn(TeamMemberService, "findBy")
      .mockRejectedValue(new Error("the database went away"));
    jest.spyOn(logger, "debug").mockImplementation((): void => {});

    expect(await ProjectLanguage.getLanguage(PROJECT_ID)).toBe("en");
  });
});
