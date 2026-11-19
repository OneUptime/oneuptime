import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  INVITATION_EMAILS_NOT_SENT_IN_PROJECTS_ROUTE,
  MAX_PEOPLE_PER_INVITATION_EMAILS_READ,
  ProjectInvitationEmailNotSent,
  getProjectInviteeKey,
  readInvitationEmailsNotSentInProjectsAnswer,
  readInvitationEmailsNotSentInProjectsRequest,
  toInvitationEmailsNotSentInProjectsAnswerJSON,
  toInvitationEmailsNotSentInProjectsRequestJSON,
} from "../../../Types/Team/InvitationEmailsNotSent";
import { describe, expect, test } from "@jest/globals";

/*
 * The Admin Dashboard's ask and answer of whose latest invitation email
 * was not sent, across projects (#9518): each pending row's person with
 * the row's project, each pair once, a page at most; whose latest
 * invitation email to that project was not sent, with the Email Log's
 * reason.
 */

const ACME: string = "95240000-0000-4000-8000-000000000001";
const GLOBEX: string = "95240000-0000-4000-8000-000000000002";
const GRACE: string = "95240000-0000-4000-8000-000000000003";
const ALAN: string = "95240000-0000-4000-8000-000000000004";

describe("the route", () => {
  test("is the team member route's own path", () => {
    expect(INVITATION_EMAILS_NOT_SENT_IN_PROJECTS_ROUTE).toBe(
      "/team-member/invitation-emails-not-sent-in-projects",
    );
  });
});

describe("a project invitee's key", () => {
  test("is its project and its person, in lower case", () => {
    expect(
      getProjectInviteeKey({
        projectId: ACME.toUpperCase(),
        userId: ` ${GRACE} `,
      }),
    ).toBe(`${ACME}/${GRACE}`);
  });
});

describe("the ask", () => {
  test("is each pair once, in lower case, leaving out a row that names no project or no person", () => {
    expect(
      toInvitationEmailsNotSentInProjectsRequestJSON([
        { projectId: ACME, userId: GRACE },
        { projectId: ACME.toUpperCase(), userId: GRACE.toUpperCase() },
        { projectId: GLOBEX, userId: GRACE },
        { projectId: "", userId: ALAN },
        { projectId: ACME, userId: "" },
      ]),
    ).toEqual({
      invitees: [
        { projectId: ACME, userId: GRACE },
        { projectId: GLOBEX, userId: GRACE },
      ],
    });
  });

  test("never names more than a page", () => {
    const invitees: Array<{ projectId: string; userId: string }> = Array.from(
      { length: MAX_PEOPLE_PER_INVITATION_EMAILS_READ + 5 },
      (): { projectId: string; userId: string } => {
        return { projectId: ACME, userId: ObjectID.generate().toString() };
      },
    );

    expect(
      (
        toInvitationEmailsNotSentInProjectsRequestJSON(invitees)[
          "invitees"
        ] as Array<unknown>
      ).length,
    ).toBe(MAX_PEOPLE_PER_INVITATION_EMAILS_READ);
  });

  test("is read back as ids, each pair once", () => {
    const read: Array<{ projectId: ObjectID; userId: ObjectID }> =
      readInvitationEmailsNotSentInProjectsRequest({
        invitees: [
          { projectId: ACME, userId: GRACE },
          { projectId: GLOBEX, userId: GRACE },
          { projectId: ACME.toUpperCase(), userId: GRACE },
        ],
      });

    expect(
      read.map((invitee: { projectId: ObjectID; userId: ObjectID }): string => {
        return `${invitee.projectId.toString()}/${invitee.userId.toString()}`;
      }),
    ).toEqual([`${ACME}/${GRACE}`, `${GLOBEX}/${GRACE}`]);
  });

  test("of a whole page is taken, and of nobody asks about nobody", () => {
    const page: Array<{ projectId: string; userId: string }> = Array.from(
      { length: MAX_PEOPLE_PER_INVITATION_EMAILS_READ },
      (): { projectId: string; userId: string } => {
        return { projectId: ACME, userId: ObjectID.generate().toString() };
      },
    );

    expect(
      readInvitationEmailsNotSentInProjectsRequest({ invitees: page }),
    ).toHaveLength(MAX_PEOPLE_PER_INVITATION_EMAILS_READ);
    expect(
      readInvitationEmailsNotSentInProjectsRequest({ invitees: [] }),
    ).toEqual([]);
  });

  test.each([
    ["nothing", undefined],
    ["a list", [{ projectId: ACME, userId: GRACE }]],
    ["no invitees", {}],
    ["invitees that are not a list", { invitees: GRACE }],
    ["user ids alone", { invitees: [GRACE] }],
    ["an invitee with no project", { invitees: [{ userId: GRACE }] }],
    ["an invitee with no person", { invitees: [{ projectId: ACME }] }],
    [
      "something that is no id",
      { invitees: [{ projectId: ACME, userId: "'; DROP TABLE EmailLog; --" }] },
    ],
    ["a number for an id", { invitees: [{ projectId: 42, userId: GRACE }] }],
    [
      "more people than a page holds",
      {
        invitees: Array.from(
          { length: MAX_PEOPLE_PER_INVITATION_EMAILS_READ + 1 },
          (): { projectId: string; userId: string } => {
            return { projectId: ACME, userId: ObjectID.generate().toString() };
          },
        ),
      },
    ],
  ])("refuses %s", (_case: string, body: unknown) => {
    expect(() => {
      return readInvitationEmailsNotSentInProjectsRequest(body);
    }).toThrow(BadDataException);
  });
});

describe("the answer", () => {
  test("is sent as each invitee's project, person and reason, read back as sent", () => {
    const invitees: Array<ProjectInvitationEmailNotSent> = [
      {
        projectId: ACME.toUpperCase(),
        userId: GRACE,
        statusMessage: "550 Mailbox unavailable",
      },
      { projectId: GLOBEX, userId: GRACE, statusMessage: "" },
    ];

    const json: ReturnType<
      typeof toInvitationEmailsNotSentInProjectsAnswerJSON
    > = toInvitationEmailsNotSentInProjectsAnswerJSON(invitees);

    expect(json).toEqual({
      invitees: [
        {
          projectId: ACME,
          userId: GRACE,
          statusMessage: "550 Mailbox unavailable",
        },
        { projectId: GLOBEX, userId: GRACE, statusMessage: "" },
      ],
    });
    expect(readInvitationEmailsNotSentInProjectsAnswer(json)).toEqual([
      {
        projectId: ACME,
        userId: GRACE,
        statusMessage: "550 Mailbox unavailable",
      },
      { projectId: GLOBEX, userId: GRACE, statusMessage: "" },
    ]);
  });

  test("keeps each pair once, drops one with no project or person, and reads a reason that is no text as none", () => {
    expect(
      readInvitationEmailsNotSentInProjectsAnswer({
        invitees: [
          {
            projectId: ACME,
            userId: GRACE,
            statusMessage: "  Quota exceeded  ",
          },
          {
            projectId: ACME.toUpperCase(),
            userId: GRACE,
            statusMessage: "Twice",
          },
          { userId: ALAN, statusMessage: "No project" },
          { projectId: ACME, statusMessage: "Nobody" },
          { projectId: GLOBEX, userId: ALAN, statusMessage: { message: "x" } },
          "not an invitee",
          null,
          [ACME, GRACE],
        ],
      }),
    ).toEqual([
      { projectId: ACME, userId: GRACE, statusMessage: "Quota exceeded" },
      { projectId: GLOBEX, userId: ALAN, statusMessage: "" },
    ]);
  });

  test.each([
    ["nothing", undefined],
    ["a list", []],
    ["no invitees", {}],
    ["invitees that are not a list", { invitees: "Grace" }],
  ])("of %s names nobody", (_case: string, data: unknown) => {
    expect(readInvitationEmailsNotSentInProjectsAnswer(data)).toEqual([]);
  });
});
