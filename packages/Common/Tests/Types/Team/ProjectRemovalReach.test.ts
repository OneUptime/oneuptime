import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  MAX_PEOPLE_PER_PROJECT_REMOVAL_REACH,
  PersonKeptInProject,
  readProjectRemovalReachAnswer,
  readProjectRemovalReachRequest,
  toProjectRemovalReachAnswerJSON,
  toProjectRemovalReachRequestJSON,
  toSortedTeamNames,
} from "../../../Types/Team/ProjectRemovalReach";
import { describe, expect, test } from "@jest/globals";

/*
 * The ask and the answer of POST /team-member/project-removal-reach
 * (#6599), read the same way by the server and the Dashboard: the people
 * asked about, each once, a page at most; whom Remove from Project would
 * leave, with the teams that keep them by name or by count.
 */

const GRACE: string = "70100000-0000-4000-8000-000000000001";
const ALAN: string = "70100000-0000-4000-8000-000000000002";

describe("the ask", () => {
  test("is the people's ids, each once, in lower case", () => {
    expect(
      toProjectRemovalReachRequestJSON([GRACE, ` ${GRACE.toUpperCase()} `, ""]),
    ).toEqual({ userIds: [GRACE] });
  });

  test("is read back as ids, each once", () => {
    const ids: Array<ObjectID> = readProjectRemovalReachRequest({
      userIds: [GRACE, ALAN, GRACE.toUpperCase()],
    });

    expect(
      ids.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([GRACE, ALAN]);
  });

  test("of a whole page is taken", () => {
    const page: Array<string> = Array.from(
      { length: MAX_PEOPLE_PER_PROJECT_REMOVAL_REACH },
      (): string => {
        return ObjectID.generate().toString();
      },
    );

    expect(readProjectRemovalReachRequest({ userIds: page })).toHaveLength(
      MAX_PEOPLE_PER_PROJECT_REMOVAL_REACH,
    );
    expect(MAX_PEOPLE_PER_PROJECT_REMOVAL_REACH).toBe(100);
  });

  test.each([
    ["nothing", undefined],
    ["a list", [GRACE]],
    ["no ids", {}],
    ["ids that are not text", { userIds: [1, 2] }],
    ["an id that is not one", { userIds: [GRACE, "grace"] }],
    [
      "more than a page",
      {
        userIds: Array.from(
          { length: MAX_PEOPLE_PER_PROJECT_REMOVAL_REACH + 1 },
          (): string => {
            return ObjectID.generate().toString();
          },
        ),
      },
    ],
  ])("is refused when it is %s", (_case: string, body: unknown) => {
    expect(() => {
      return readProjectRemovalReachRequest(body);
    }).toThrow(BadDataException);
  });
});

describe("the answer", () => {
  const PERSON: PersonKeptInProject = {
    userId: GRACE,
    teamNames: ["Security", " Platform", "Security"],
    hiddenTeamCount: 2,
    hasTeamInReach: true,
  };

  test("names the teams sorted, each once, and counts the others", () => {
    expect(toProjectRemovalReachAnswerJSON([PERSON])).toEqual({
      people: [
        {
          userId: GRACE,
          teamNames: ["Platform", "Security"],
          hiddenTeamCount: 2,
          hasTeamInReach: true,
        },
      ],
    });
  });

  test("is read back as it was sent", () => {
    expect(
      readProjectRemovalReachAnswer(toProjectRemovalReachAnswerJSON([PERSON])),
    ).toEqual([
      {
        userId: GRACE,
        teamNames: ["Platform", "Security"],
        hiddenTeamCount: 2,
        hasTeamInReach: true,
      },
    ]);
  });

  test("drops a person with no id, a person named twice, and one no team keeps", () => {
    expect(
      readProjectRemovalReachAnswer({
        people: [
          { teamNames: ["Platform"] },
          { userId: ALAN, teamNames: [], hiddenTeamCount: 0 },
          {
            userId: GRACE.toUpperCase(),
            teamNames: ["Platform"],
            hasTeamInReach: "yes",
          },
          { userId: GRACE, teamNames: ["Security"] },
          "nobody",
        ],
      }),
    ).toEqual([
      {
        userId: GRACE,
        teamNames: ["Platform"],
        hiddenTeamCount: 0,
        hasTeamInReach: false,
      },
    ]);
  });

  test("reads a count that is not one as none, and a team name that is not text as no name", () => {
    expect(
      readProjectRemovalReachAnswer({
        people: [
          {
            userId: GRACE,
            teamNames: ["Platform", 7, null],
            hiddenTeamCount: "three",
          },
          { userId: ALAN, teamNames: [], hiddenTeamCount: -4 },
        ],
      }),
    ).toEqual([
      {
        userId: GRACE,
        teamNames: ["Platform"],
        hiddenTeamCount: 0,
        hasTeamInReach: false,
      },
    ]);
  });

  test.each([undefined, null, "people", [], { people: "everyone" }])(
    "of another shape (%p) names nobody",
    (data: unknown) => {
      expect(readProjectRemovalReachAnswer(data)).toEqual([]);
    },
  );

  test("sorts team names the way a reader does, not by code point", () => {
    expect(toSortedTeamNames(["beta", "Alpha", "alpha "])).toEqual([
      "Alpha",
      "alpha",
      "beta",
    ]);
  });
});
