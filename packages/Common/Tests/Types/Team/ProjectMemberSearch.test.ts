import BadDataException from "../../../Types/Exception/BadDataException";
import {
  getProjectMemberMatchRank,
  PROJECT_MEMBER_SEARCH_LIMIT,
  PROJECT_MEMBER_SEARCH_MAX_LENGTH,
  PROJECT_MEMBER_SEARCH_MIN_LENGTH,
  PROJECT_MEMBER_SEARCH_ROUTE,
  ProjectMemberSearchMatch,
  rankProjectMemberMatches,
  readProjectMemberSearchAnswer,
  readProjectMemberSearchText,
  toProjectMemberSearchAnswerJSON,
} from "../../../Types/Team/ProjectMemberSearch";
import { describe, expect, test } from "@jest/globals";

/*
 * Search's people (#7036): the request and the answer, read the same way by
 * the server and the Dashboard.
 */

const ADA: ProjectMemberSearchMatch = {
  userId: "a1",
  name: "Ada Lovelace",
  email: "ada@acme.test",
};

describe("the request", () => {
  test("is asked of the team member route, bound as Search's other record searches are", () => {
    expect(PROJECT_MEMBER_SEARCH_ROUTE).toBe("/team-member/search-members");
    expect(PROJECT_MEMBER_SEARCH_MIN_LENGTH).toBe(2);
    expect(PROJECT_MEMBER_SEARCH_LIMIT).toBe(5);
  });

  test("takes what was typed, trimmed", () => {
    expect(readProjectMemberSearchText({ text: "  ada  " })).toBe("ada");
    expect(readProjectMemberSearchText({ text: "ad" })).toBe("ad");
    expect(readProjectMemberSearchText({ text: "ada@acme.test" })).toBe(
      "ada@acme.test",
    );
  });

  test.each([
    ["one letter", { text: "a" }],
    ["one letter in spaces", { text: "  a  " }],
    ["nothing", { text: "" }],
    ["spaces", { text: "    " }],
  ])(
    "refuses %s rather than answering with everyone",
    (_what: string, body: unknown) => {
      expect(() => {
        return readProjectMemberSearchText(body);
      }).toThrow(BadDataException);
      expect(() => {
        return readProjectMemberSearchText(body);
      }).toThrow("Type at least 2 letters");
    },
  );

  test.each([
    ["no body", undefined],
    ["a list", ["ada"]],
    ["no text", {}],
    ["a number", { text: 42 }],
    ["an object", { text: { name: "ada" } }],
  ])("refuses %s, saying what to send", (_what: string, body: unknown) => {
    expect(() => {
      return readProjectMemberSearchText(body);
    }).toThrow(BadDataException);
  });

  test("cuts a long text to its limit rather than refusing it", () => {
    const long: string = `ada${"x".repeat(500)}`;
    const read: string = readProjectMemberSearchText({ text: long });

    expect(read.length).toBe(PROJECT_MEMBER_SEARCH_MAX_LENGTH);
    expect(read.startsWith("ada")).toBe(true);
  });
});

describe("the answer", () => {
  test("is sent with each person's id, name and - where there is one - email", () => {
    expect(
      toProjectMemberSearchAnswerJSON([
        ADA,
        { userId: "b1", name: "Bob Builder" },
      ]),
    ).toEqual({
      members: [
        { userId: "a1", name: "Ada Lovelace", email: "ada@acme.test" },
        { userId: "b1", name: "Bob Builder" },
      ],
    });
  });

  test("is read back as it was sent", () => {
    expect(
      readProjectMemberSearchAnswer(
        toProjectMemberSearchAnswerJSON([
          ADA,
          { userId: "e1", name: "", email: "eve@acme.test" },
        ]),
      ),
    ).toEqual([ADA, { userId: "e1", name: "", email: "eve@acme.test" }]);
  });

  test("drops rows it cannot show, and each person after the first time", () => {
    expect(
      readProjectMemberSearchAnswer({
        members: [
          ADA,
          { userId: "a1", name: "Ada again" },
          { name: "No id" },
          { userId: "", name: "Empty id" },
          { userId: "n1", name: "", email: "" },
          { userId: 5, name: "Numeric id" },
          "not a row",
          null,
          { userId: "b1", name: "  Bob Builder  ", email: 7 },
        ],
      }),
    ).toEqual([ADA, { userId: "b1", name: "Bob Builder" }]);
  });

  test("reads nothing from what is not an answer", () => {
    expect(readProjectMemberSearchAnswer(null)).toEqual([]);
    expect(readProjectMemberSearchAnswer("members")).toEqual([]);
    expect(readProjectMemberSearchAnswer([ADA])).toEqual([]);
    expect(readProjectMemberSearchAnswer({ members: "ada" })).toEqual([]);
  });

  test("lists a few people at most", () => {
    const many: Array<ProjectMemberSearchMatch> = Array.from(
      { length: 9 },
      (_value: unknown, index: number): ProjectMemberSearchMatch => {
        return { userId: `u${index}`, name: `Person ${index}` };
      },
    );

    expect(
      readProjectMemberSearchAnswer(toProjectMemberSearchAnswerJSON(many)),
    ).toHaveLength(PROJECT_MEMBER_SEARCH_LIMIT);
  });
});

describe("which people come first", () => {
  test("a name that starts with the text, then a word of a name, then an email, then the rest", () => {
    const people: Array<ProjectMemberSearchMatch> = [
      { userId: "1", name: "Rosa Parks", email: "rosa@acme.test" },
      { userId: "2", name: "Karl Jo", email: "kj@acme.test" },
      { userId: "3", name: "Johanna Smith", email: "johanna@acme.test" },
      { userId: "4", name: "Marjorie Doe", email: "mdoe@acme.test" },
      { userId: "5", name: "", email: "jo.new@acme.test" },
    ];

    expect(
      rankProjectMemberMatches(people, "jo").map(
        (match: ProjectMemberSearchMatch): string => {
          return match.userId;
        },
      ),
    ).toEqual(["3", "2", "5", "4", "1"]);

    expect(getProjectMemberMatchRank(people[2]!, "jo")).toBe(0);
    expect(getProjectMemberMatchRank(people[1]!, "jo")).toBe(1);
    expect(getProjectMemberMatchRank(people[4]!, "jo")).toBe(2);
    expect(getProjectMemberMatchRank(people[3]!, "jo")).toBe(3);
  });

  test("case and accents aside", () => {
    expect(
      getProjectMemberMatchRank({ userId: "1", name: "José Núñez" }, "JOSE"),
    ).toBe(0);
    expect(
      getProjectMemberMatchRank({ userId: "1", name: "José Núñez" }, "nun"),
    ).toBe(1);
  });

  test("between equally good matches, by name, or by email for someone with none", () => {
    expect(
      rankProjectMemberMatches(
        [
          { userId: "1", name: "Zed Ada" },
          { userId: "2", name: "", email: "bea.ada@acme.test" },
          { userId: "3", name: "Carl Ada" },
        ],
        "ada",
      ).map((match: ProjectMemberSearchMatch): string => {
        return match.userId;
      }),
    ).toEqual(["3", "1", "2"]);
  });

  test("one person on several teams is one person, with what is known of them", () => {
    expect(
      rankProjectMemberMatches(
        [
          { userId: "a1", name: "Ada Lovelace" },
          { userId: "a1", name: "Ada Lovelace", email: "ada@acme.test" },
          { userId: "a1", name: "", email: "ada@acme.test" },
        ],
        "ada",
      ),
    ).toEqual([ADA]);
  });

  test("leaves out a row with no person, or nothing to show, and keeps a few", () => {
    const many: Array<ProjectMemberSearchMatch> = Array.from(
      { length: 8 },
      (_value: unknown, index: number): ProjectMemberSearchMatch => {
        return { userId: `u${index}`, name: `Ada ${index}` };
      },
    );

    expect(
      rankProjectMemberMatches(
        [{ userId: "", name: "No one" }, { userId: "n1", name: "" }, ...many],
        "ada",
      ).map((match: ProjectMemberSearchMatch): string => {
        return match.userId;
      }),
    ).toEqual(["u0", "u1", "u2", "u3", "u4"]);
  });
});
