import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  INVITE_SUGGESTIONS_LIMIT,
  INVITE_SUGGESTIONS_ROUTE,
  InviteSuggestion,
  InviteSuggestionStanding,
  InviteSuggestionsRequest,
  getInviteSuggestionStanding,
  isInviteSuggestionPickable,
  readInviteSuggestionsAnswer,
  readInviteSuggestionsRequest,
  toInviteSuggestionsAnswerJSON,
} from "../../../Types/Team/InviteSuggestions";
import { PROJECT_MEMBER_SEARCH_ROUTE } from "../../../Types/Team/ProjectMemberSearch";
import { describe, expect, test } from "@jest/globals";

/*
 * WHO AN INVITATION'S EMAIL BOX SUGGESTS, AS BOTH SIDES READ IT (#9701).
 *
 *   - the request: what was typed, as Search's people take it (two letters
 *     or more), and the team the invitation is for, an id or nothing;
 *   - where a person stands: in the team (accepted, or invited to it), only
 *     invited to the project, a member, or not in the project at all;
 *   - who may be picked: never someone the team has already;
 *   - the answer: each person once, with an address and a standing it
 *     knows, a few at most.
 */

const TEAM_ID: string = "11111111-1111-4111-8111-111111111111";
const OTHER_TEAM_ID: string = "22222222-2222-4222-8222-222222222222";

function suggestion(
  overrides: Partial<InviteSuggestion> = {},
): InviteSuggestion {
  return {
    userId: "33333333-3333-4333-8333-333333333333",
    name: "Ada Lovelace",
    email: "ada@acme.test",
    standing: InviteSuggestionStanding.Member,
    ...overrides,
  };
}

function refusal(body: unknown): string {
  try {
    readInviteSuggestionsRequest(body);
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error("Expected the request to be refused.");
}

describe("the route", () => {
  test("is the team member route's, beside Search's people", () => {
    expect(INVITE_SUGGESTIONS_ROUTE).toBe("/team-member/invite-suggestions");
    expect(INVITE_SUGGESTIONS_ROUTE.split("/")[1]).toBe(
      PROJECT_MEMBER_SEARCH_ROUTE.split("/")[1],
    );
  });
});

describe("the request", () => {
  test("is what was typed, trimmed, and the team when one is named", () => {
    const request: InviteSuggestionsRequest = readInviteSuggestionsRequest({
      text: "  ada ",
      teamId: ` ${TEAM_ID} `,
    });

    expect(request.text).toBe("ada");
    expect(request.teamId?.toString()).toBe(TEAM_ID);
  });

  test.each([[undefined], [null], [""]])(
    "with no team (%j) is for the project",
    (teamId: unknown) => {
      expect(
        readInviteSuggestionsRequest({ text: "ada", teamId: teamId }).teamId,
      ).toBeNull();
    },
  );

  test.each([["not-an-id"], [42], [{ _id: TEAM_ID }]])(
    "naming a team by anything but its id (%j) is refused, with what to send",
    (teamId: unknown) => {
      expect(refusal({ text: "ada", teamId: teamId })).toBe(
        "The team to suggest people for must be a team's ID. Leave it out to suggest people for the project.",
      );
    },
  );

  test("one letter is refused rather than answered with everyone, as Search refuses it", () => {
    expect(refusal({ text: "a" })).toContain("Type at least 2 letters");
  });

  test.each([[null], ["ada"], [[]], [{}]])(
    "a body that is no search (%j) is refused",
    (body: unknown) => {
      expect(refusal(body).length).toBeGreaterThan(0);
    },
  );
});

describe("where a person stands", () => {
  test("in the team being invited to, accepted: already in it", () => {
    expect(
      getInviteSuggestionStanding({
        memberships: [
          { teamId: OTHER_TEAM_ID, hasAcceptedInvitation: true },
          { teamId: TEAM_ID.toUpperCase(), hasAcceptedInvitation: true },
        ],
        teamId: TEAM_ID,
      }),
    ).toBe(InviteSuggestionStanding.InThisTeam);
  });

  test("invited to the team being invited to, not accepted: already invited to it", () => {
    expect(
      getInviteSuggestionStanding({
        memberships: [
          { teamId: OTHER_TEAM_ID, hasAcceptedInvitation: true },
          { teamId: TEAM_ID, hasAcceptedInvitation: false },
        ],
        teamId: TEAM_ID,
      }),
    ).toBe(InviteSuggestionStanding.InvitedToThisTeam);
  });

  test("in another team, accepted: a member", () => {
    expect(
      getInviteSuggestionStanding({
        memberships: [{ teamId: OTHER_TEAM_ID, hasAcceptedInvitation: true }],
        teamId: TEAM_ID,
      }),
    ).toBe(InviteSuggestionStanding.Member);
  });

  test("invited and never accepted, anywhere in the project: invited", () => {
    expect(
      getInviteSuggestionStanding({
        memberships: [
          { teamId: OTHER_TEAM_ID, hasAcceptedInvitation: false },
          { teamId: OTHER_TEAM_ID, hasAcceptedInvitation: false },
        ],
        teamId: TEAM_ID,
      }),
    ).toBe(InviteSuggestionStanding.Invited);
  });

  test("with no team named, by the project alone", () => {
    expect(
      getInviteSuggestionStanding({
        memberships: [{ teamId: TEAM_ID, hasAcceptedInvitation: true }],
        teamId: null,
      }),
    ).toBe(InviteSuggestionStanding.Member);
    expect(
      getInviteSuggestionStanding({
        memberships: [{ teamId: TEAM_ID, hasAcceptedInvitation: false }],
        teamId: null,
      }),
    ).toBe(InviteSuggestionStanding.Invited);
  });

  test("no membership at all: not in this project", () => {
    expect(
      getInviteSuggestionStanding({ memberships: [], teamId: TEAM_ID }),
    ).toBe(InviteSuggestionStanding.NotInProject);
  });
});

describe("who may be picked", () => {
  test.each([
    [InviteSuggestionStanding.InThisTeam, false],
    [InviteSuggestionStanding.InvitedToThisTeam, false],
    [InviteSuggestionStanding.Invited, true],
    [InviteSuggestionStanding.Member, true],
    [InviteSuggestionStanding.NotInProject, true],
  ])("%s: %s", (standing: InviteSuggestionStanding, pickable: boolean) => {
    expect(isInviteSuggestionPickable({ standing: standing })).toBe(pickable);
  });
});

describe("the answer", () => {
  test("is read back as it was written", () => {
    const sent: Array<InviteSuggestion> = [
      suggestion(),
      suggestion({
        userId: "44444444-4444-4444-8444-444444444444",
        name: "",
        email: "new.person@acme.test",
        standing: InviteSuggestionStanding.Invited,
      }),
    ];

    expect(
      readInviteSuggestionsAnswer(
        JSON.parse(JSON.stringify(toInviteSuggestionsAnswerJSON(sent))),
      ),
    ).toEqual(sent);
  });

  test("drops a row with no person, no address, or a standing it does not know, and reads each person once", () => {
    expect(
      readInviteSuggestionsAnswer({
        people: [
          { userId: "", email: "a@acme.test", standing: "Member" },
          { userId: "1", email: "", standing: "Member" },
          { userId: "2", email: "b@acme.test", standing: "Owner" },
          { userId: "3", email: "c@acme.test", standing: "Member", name: 7 },
          { userId: "3", email: "c2@acme.test", standing: "Member" },
          "not a row",
          null,
        ],
      }),
    ).toEqual([
      {
        userId: "3",
        name: "",
        email: "c@acme.test",
        standing: InviteSuggestionStanding.Member,
      },
    ]);
  });

  test(`lists ${INVITE_SUGGESTIONS_LIMIT} at most, in the order given`, () => {
    const people: Array<InviteSuggestion> = Array.from(
      { length: INVITE_SUGGESTIONS_LIMIT + 3 },
      (_value: unknown, index: number): InviteSuggestion => {
        return suggestion({
          userId: ObjectID.generate().toString(),
          email: `person${index}@acme.test`,
        });
      },
    );

    const read: Array<InviteSuggestion> = readInviteSuggestionsAnswer(
      toInviteSuggestionsAnswerJSON(people),
    );

    expect(read).toHaveLength(INVITE_SUGGESTIONS_LIMIT);
    expect(read[0]?.email).toBe("person0@acme.test");
  });

  test.each([[undefined], [null], [[]], ["people"], [{ people: "x" }]])(
    "an answer that is none (%j) suggests nobody",
    (data: unknown) => {
      expect(readInviteSuggestionsAnswer(data)).toEqual([]);
    },
  );
});
