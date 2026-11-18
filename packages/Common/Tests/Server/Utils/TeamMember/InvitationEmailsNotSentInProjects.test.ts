import EmailLogService from "../../../../Server/Services/EmailLogService";
import InvitationEmailsNotSent, {
  EMAILS_READ_PER_PERSON,
  RECORD_COLUMNS,
} from "../../../../Server/Utils/TeamMember/InvitationEmailsNotSent";
import EmailLog from "../../../../Models/DatabaseModels/EmailLog";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import EmailTemplateType from "../../../../Types/Email/EmailTemplateType";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import MailStatus from "../../../../Types/Mail/MailStatus";
import ObjectID from "../../../../Types/ObjectID";
import UserType from "../../../../Types/UserType";
import {
  MAX_PEOPLE_PER_INVITATION_EMAILS_READ,
  ProjectInvitationEmailNotSent,
} from "../../../../Types/Team/InvitationEmailsNotSent";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { FindOperator } from "typeorm";

/*
 * WHOSE LATEST INVITATION EMAIL WAS NOT SENT, ACROSS PROJECTS (#9518): the
 * Admin Dashboard's lists name each pending row's person with the row's
 * project - a project's people, or a person's projects - and one read
 * answers the page, with the master admin's own props. Each person's
 * latest invitation email to that project decides, as in one project.
 */

jest.mock("../../../../Server/Utils/Logger");

const ACME: ObjectID = new ObjectID("95220000-0000-4000-8000-000000000001");
const GLOBEX: ObjectID = new ObjectID("95220000-0000-4000-8000-000000000002");
const GRACE: ObjectID = new ObjectID("95220000-0000-4000-8000-000000000003");
const ALAN: ObjectID = new ObjectID("95220000-0000-4000-8000-000000000004");

const MASTER_ADMIN: DatabaseCommonInteractionProps = {
  userId: new ObjectID("95220000-0000-4000-8000-000000000005"),
  userType: UserType.MasterAdmin,
  isMasterAdmin: true,
};

const REFUSAL: string = "535 5.7.8 Authentication failed";

// An Email Log row, newest first as the read sorts them.
function logRow(
  projectId: ObjectID,
  userId: ObjectID,
  status: MailStatus,
  statusMessage?: string,
): EmailLog {
  const row: EmailLog = new EmailLog();
  row._id = ObjectID.generate().toString();
  row.projectId = projectId;
  row.userId = userId;
  row.status = status;

  if (statusMessage !== undefined) {
    row.statusMessage = statusMessage;
  }

  return row;
}

type FindByArgs = Parameters<typeof EmailLogService.findBy>[0];

let findBySpy: SpyInstance<typeof EmailLogService.findBy>;

function askedWith(): FindByArgs {
  expect(findBySpy).toHaveBeenCalledTimes(1);
  return findBySpy.mock.calls[0]![0] as FindByArgs;
}

function sqlOf(operator: unknown, alias: string): string {
  const raw: FindOperator<unknown> = operator as FindOperator<unknown>;
  return (raw.getSql as (alias: string) => string)(alias);
}

function parametersOf(operator: unknown): Array<unknown> {
  return Object.values(
    (operator as FindOperator<unknown>).objectLiteralParameters || {},
  ).flat();
}

beforeEach(() => {
  findBySpy = jest.spyOn(EmailLogService, "findBy").mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the read", () => {
  test("is one, for the whole page, with the master admin's own props", async () => {
    await InvitationEmailsNotSent.readInProjects({
      invitees: [
        { projectId: ACME, userId: GRACE },
        { projectId: ACME, userId: ALAN },
      ],
      props: MASTER_ADMIN,
    });

    const args: FindByArgs = askedWith();

    expect(args.props).toBe(MASTER_ADMIN);
    expect(args.props.isRoot).toBeFalsy();
    expect(args.sort).toEqual({ createdAt: SortOrder.Descending });
    expect(args.skip).toBe(0);
    expect(args.select).toEqual({
      _id: true,
      projectId: true,
      userId: true,
      status: true,
      statusMessage: true,
      createdAt: true,
    });
  });

  test("a project's people: that project, those people, of the invitation's template or none, about no record", async () => {
    await InvitationEmailsNotSent.readInProjects({
      invitees: [
        { projectId: ACME, userId: GRACE },
        { projectId: ACME, userId: ALAN },
      ],
      props: MASTER_ADMIN,
    });

    const query: Record<string, unknown> = askedWith().query as Record<
      string,
      unknown
    >;

    // One project: named as it is, as the Dashboard's read names its own.
    expect(query["projectId"]).toEqual(ACME);
    expect(sqlOf(query["userId"], "u")).toContain("u IN");
    expect(parametersOf(query["userId"])).toEqual([
      GRACE.toString(),
      ALAN.toString(),
    ]);
    expect(sqlOf(query["templateType"], "t")).toContain("t IS NULL");
    expect(parametersOf(query["templateType"])).toEqual([
      EmailTemplateType.InviteMember,
    ]);

    for (const column of RECORD_COLUMNS) {
      expect(sqlOf(query[column], "c")).toContain("c IS NULL");
    }

    // A page of one project's people reads a page of rows, as one project's read does.
    expect(askedWith().limit).toBe(2 * EMAILS_READ_PER_PERSON);
  });

  test("a person's projects: those projects, that person", async () => {
    await InvitationEmailsNotSent.readInProjects({
      invitees: [
        { projectId: ACME, userId: GRACE },
        { projectId: GLOBEX, userId: GRACE },
      ],
      props: MASTER_ADMIN,
    });

    const query: Record<string, unknown> = askedWith().query as Record<
      string,
      unknown
    >;

    expect(sqlOf(query["projectId"], "p")).toContain("p IN");
    expect(parametersOf(query["projectId"])).toEqual([
      ACME.toString(),
      GLOBEX.toString(),
    ]);
    expect(parametersOf(query["userId"])).toEqual([GRACE.toString()]);
    expect(askedWith().limit).toBe(2 * EMAILS_READ_PER_PERSON);
  });

  test("never reads more than a page's rows, however the pairs are spread", async () => {
    const invitees: Array<{ projectId: ObjectID; userId: ObjectID }> =
      Array.from(
        { length: MAX_PEOPLE_PER_INVITATION_EMAILS_READ },
        (): { projectId: ObjectID; userId: ObjectID } => {
          return {
            projectId: ObjectID.generate(),
            userId: ObjectID.generate(),
          };
        },
      );

    await InvitationEmailsNotSent.readInProjects({
      invitees: invitees,
      props: MASTER_ADMIN,
    });

    expect(askedWith().limit).toBe(
      MAX_PEOPLE_PER_INVITATION_EMAILS_READ * EMAILS_READ_PER_PERSON,
    );
  });

  test("nobody to ask about reads nothing", async () => {
    await expect(
      InvitationEmailsNotSent.readInProjects({
        invitees: [],
        props: MASTER_ADMIN,
      }),
    ).resolves.toEqual([]);
    expect(findBySpy).not.toHaveBeenCalled();
  });

  test("a caller who may not read the Email Logs is told about nobody", async () => {
    findBySpy.mockRejectedValue(
      new NotAuthorizedException(
        "You do not have permissions to read Email Log.",
      ) as never,
    );

    await expect(
      InvitationEmailsNotSent.readInProjects({
        invitees: [{ projectId: ACME, userId: GRACE }],
        props: MASTER_ADMIN,
      }),
    ).resolves.toEqual([]);
  });

  test("any other failure is passed on", async () => {
    const failure: Error = new Error("The database went away.");
    findBySpy.mockRejectedValue(failure as never);

    await expect(
      InvitationEmailsNotSent.readInProjects({
        invitees: [{ projectId: ACME, userId: GRACE }],
        props: MASTER_ADMIN,
      }),
    ).rejects.toBe(failure);
  });
});

describe("whose latest invitation email to their project failed", () => {
  test("a failure is named with its project and the mail service's answer", async () => {
    findBySpy.mockResolvedValue([
      logRow(ACME, GRACE, MailStatus.Error, REFUSAL),
    ]);

    await expect(
      InvitationEmailsNotSent.readInProjects({
        invitees: [{ projectId: ACME, userId: GRACE }],
        props: MASTER_ADMIN,
      }),
    ).resolves.toEqual([
      {
        projectId: ACME.toString(),
        userId: GRACE.toString(),
        statusMessage: REFUSAL,
      },
    ]);
  });

  test("an email that went since - a resend - decides: nobody is named", async () => {
    findBySpy.mockResolvedValue([
      logRow(ACME, GRACE, MailStatus.Success),
      logRow(ACME, GRACE, MailStatus.Error, REFUSAL),
    ]);

    await expect(
      InvitationEmailsNotSent.readInProjects({
        invitees: [{ projectId: ACME, userId: GRACE }],
        props: MASTER_ADMIN,
      }),
    ).resolves.toEqual([]);
  });

  test("each project's latest decides for that project alone", async () => {
    findBySpy.mockResolvedValue([
      logRow(GLOBEX, GRACE, MailStatus.Success),
      logRow(ACME, GRACE, MailStatus.Error, REFUSAL),
      logRow(GLOBEX, GRACE, MailStatus.Error, "Older"),
    ]);

    const notSent: Array<ProjectInvitationEmailNotSent> =
      await InvitationEmailsNotSent.readInProjects({
        invitees: [
          { projectId: ACME, userId: GRACE },
          { projectId: GLOBEX, userId: GRACE },
        ],
        props: MASTER_ADMIN,
      });

    expect(notSent).toEqual([
      {
        projectId: ACME.toString(),
        userId: GRACE.toString(),
        statusMessage: REFUSAL,
      },
    ]);
  });

  test("a pair nobody asked about is passed over, whatever its rows say", () => {
    expect(
      InvitationEmailsNotSent.getLatestFailuresInProjects({
        rows: [
          logRow(GLOBEX, ALAN, MailStatus.Error, REFUSAL),
          logRow(ACME, GRACE, MailStatus.Error, "Mailbox full"),
        ],
        invitees: [
          { projectId: ACME.toString(), userId: GRACE.toString() },
          { projectId: GLOBEX.toString(), userId: GRACE.toString() },
        ],
      }),
    ).toEqual([
      {
        projectId: ACME.toString(),
        userId: GRACE.toString(),
        statusMessage: "Mailbox full",
      },
    ]);
  });

  test("a row with no project or no person, and a reason of nothing but spaces, read as they should", () => {
    const noProject: EmailLog = logRow(ACME, GRACE, MailStatus.Error, "x");
    noProject.projectId = undefined;

    expect(
      InvitationEmailsNotSent.getLatestFailuresInProjects({
        rows: [noProject, logRow(ACME, GRACE, MailStatus.Error, "   ")],
        invitees: [{ projectId: ACME.toString(), userId: GRACE.toString() }],
      }),
    ).toEqual([
      {
        projectId: ACME.toString(),
        userId: GRACE.toString(),
        statusMessage: "",
      },
    ]);
  });

  test("ids are compared as Postgres writes them: lower case", () => {
    expect(
      InvitationEmailsNotSent.getLatestFailuresInProjects({
        rows: [logRow(ACME, GRACE, MailStatus.Error, REFUSAL)],
        invitees: [
          {
            projectId: ACME.toString().toUpperCase(),
            userId: GRACE.toString().toUpperCase(),
          },
        ],
      }),
    ).toHaveLength(1);
  });
});
