import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  INVITATION_EMAILS_NOT_SENT_ROUTE,
  InvitationEmailNotSent,
  MAX_PEOPLE_PER_INVITATION_EMAILS_READ,
  readInvitationEmailsNotSentAnswer,
  readInvitationEmailsNotSentRequest,
  toInvitationEmailsNotSentAnswerJSON,
  toInvitationEmailsNotSentRequestJSON,
} from "../../../Types/Team/InvitationEmailsNotSent";
import { describe, expect, test } from "@jest/globals";

/*
 * The ask and the answer of POST /team-member/invitation-emails-not-sent
 * (#9511), read the same way by the server and the Dashboard: the pending
 * people a page shows, each once, a page at most; whose latest invitation
 * email was not sent, with the Email Log's reason.
 */

const GRACE: string = "95100000-0000-4000-8000-000000000001";
const ALAN: string = "95100000-0000-4000-8000-000000000002";

describe("the route", () => {
  test("is the team member route's own path", () => {
    expect(INVITATION_EMAILS_NOT_SENT_ROUTE).toBe(
      "/team-member/invitation-emails-not-sent",
    );
  });
});

describe("the ask", () => {
  test("is the people's ids, each once, in lower case", () => {
    expect(
      toInvitationEmailsNotSentRequestJSON([
        GRACE,
        ` ${GRACE.toUpperCase()} `,
        "",
        ALAN,
      ]),
    ).toEqual({ userIds: [GRACE, ALAN] });
  });

  test("never names more people than a page holds", () => {
    const people: Array<string> = Array.from(
      { length: MAX_PEOPLE_PER_INVITATION_EMAILS_READ + 5 },
      (): string => {
        return ObjectID.generate().toString();
      },
    );

    expect(
      (toInvitationEmailsNotSentRequestJSON(people)["userIds"] as Array<string>)
        .length,
    ).toBe(MAX_PEOPLE_PER_INVITATION_EMAILS_READ);
  });

  test("is read back as ids, each once", () => {
    const ids: Array<ObjectID> = readInvitationEmailsNotSentRequest({
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
      { length: MAX_PEOPLE_PER_INVITATION_EMAILS_READ },
      (): string => {
        return ObjectID.generate().toString();
      },
    );

    expect(readInvitationEmailsNotSentRequest({ userIds: page })).toHaveLength(
      MAX_PEOPLE_PER_INVITATION_EMAILS_READ,
    );
    expect(MAX_PEOPLE_PER_INVITATION_EMAILS_READ).toBe(100);
  });

  test.each([
    ["nothing", undefined],
    ["a list", [GRACE]],
    ["no ids", {}],
    ["ids that are not a list", { userIds: GRACE }],
    ["a number for an id", { userIds: [42] }],
    ["something that is no id", { userIds: ["'; DROP TABLE EmailLog; --"] }],
    [
      "more people than a page holds",
      {
        userIds: Array.from(
          { length: MAX_PEOPLE_PER_INVITATION_EMAILS_READ + 1 },
          (): string => {
            return ObjectID.generate().toString();
          },
        ),
      },
    ],
  ])("refuses %s", (_case: string, body: unknown) => {
    expect(() => {
      return readInvitationEmailsNotSentRequest(body);
    }).toThrow(BadDataException);
  });

  test("an empty list asks about nobody", () => {
    expect(readInvitationEmailsNotSentRequest({ userIds: [] })).toEqual([]);
  });
});

describe("the answer", () => {
  test("is sent as each person's id and reason", () => {
    expect(
      toInvitationEmailsNotSentAnswerJSON([
        {
          userId: GRACE.toUpperCase(),
          statusMessage: "535 5.7.8 Authentication failed",
        },
      ]),
    ).toEqual({
      people: [
        { userId: GRACE, statusMessage: "535 5.7.8 Authentication failed" },
      ],
    });
  });

  test("is read back as it was sent", () => {
    const people: Array<InvitationEmailNotSent> = [
      { userId: GRACE, statusMessage: "550 Mailbox unavailable" },
      { userId: ALAN, statusMessage: "" },
    ];

    expect(
      readInvitationEmailsNotSentAnswer(
        toInvitationEmailsNotSentAnswerJSON(people),
      ),
    ).toEqual(people);
  });

  test("keeps each person once, drops a person with no id, and reads a reason that is no text as none", () => {
    expect(
      readInvitationEmailsNotSentAnswer({
        people: [
          { userId: GRACE, statusMessage: "  Quota exceeded  " },
          { userId: GRACE.toUpperCase(), statusMessage: "Twice" },
          { statusMessage: "Nobody" },
          { userId: "", statusMessage: "Nobody" },
          { userId: ALAN, statusMessage: { message: "an object" } },
          "not a person",
          null,
          [ALAN],
        ],
      }),
    ).toEqual([
      { userId: GRACE, statusMessage: "Quota exceeded" },
      { userId: ALAN, statusMessage: "" },
    ]);
  });

  test.each([
    ["nothing", undefined],
    ["a list", []],
    ["no people", {}],
    ["people that are not a list", { people: "Grace" }],
  ])("of %s names nobody", (_case: string, data: unknown) => {
    expect(readInvitationEmailsNotSentAnswer(data)).toEqual([]);
  });
});
