import EmailLogService from "../../../../Server/Services/EmailLogService";
import InvitationEmailsNotSent, {
  EMAILS_READ_PER_PERSON,
  RECORD_COLUMNS,
} from "../../../../Server/Utils/TeamMember/InvitationEmailsNotSent";
import EmailLog from "../../../../Models/DatabaseModels/EmailLog";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import EmailTemplateType from "../../../../Types/Email/EmailTemplateType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import MailStatus from "../../../../Types/Mail/MailStatus";
import ObjectID from "../../../../Types/ObjectID";
import {
  InvitationEmailNotSent,
  MAX_PEOPLE_PER_INVITATION_EMAILS_READ,
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
 * WHOSE LATEST INVITATION EMAIL WAS NOT SENT (#9511), as the project's
 * Email Logs say: one read for the whole page, with the caller's own
 * permissions; each person's latest invitation email decides; a caller who
 * may not read the Email Logs is told about nobody.
 */

jest.mock("../../../../Server/Utils/Logger");

const PROJECT_ID: ObjectID = new ObjectID(
  "95120000-0000-4000-8000-000000000001",
);
const CALLER_ID: ObjectID = new ObjectID(
  "95120000-0000-4000-8000-000000000002",
);
const GRACE: ObjectID = new ObjectID("95130000-0000-4000-8000-000000000001");
const ALAN: ObjectID = new ObjectID("95130000-0000-4000-8000-000000000002");
const ADA: ObjectID = new ObjectID("95130000-0000-4000-8000-000000000003");

const CALLER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: CALLER_ID,
};

// An Email Log row, newest first as the read sorts them.
function logRow(
  userId: ObjectID,
  status: MailStatus,
  statusMessage?: string,
): EmailLog {
  const row: EmailLog = new EmailLog();
  row._id = ObjectID.generate().toString();
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
  test("is one, for the whole page, with the caller's own permissions", async () => {
    await InvitationEmailsNotSent.read({
      projectId: PROJECT_ID,
      userIds: [GRACE, ALAN, ADA],
      props: CALLER,
    });

    const args: FindByArgs = askedWith();

    // The caller's props, as the route got them: never OneUptime's own.
    expect(args.props).toBe(CALLER);
    expect(args.props.isRoot).toBeFalsy();
    expect(args.sort).toEqual({ createdAt: SortOrder.Descending });
    expect(args.skip).toBe(0);
    expect(args.limit).toBe(3 * EMAILS_READ_PER_PERSON);
    expect(args.select).toEqual({
      _id: true,
      userId: true,
      status: true,
      statusMessage: true,
      createdAt: true,
    });
  });

  test("reads the people's emails in the project, of the invitation's template or of none, about no record", async () => {
    await InvitationEmailsNotSent.read({
      projectId: PROJECT_ID,
      userIds: [GRACE, ALAN],
      props: CALLER,
    });

    const query: Record<string, unknown> = askedWith().query as Record<
      string,
      unknown
    >;

    expect(query["projectId"]).toBe(PROJECT_ID);

    expect(sqlOf(query["userId"], "u")).toContain("u IN");
    expect(parametersOf(query["userId"])).toEqual([
      GRACE.toString(),
      ALAN.toString(),
    ]);

    // The invitation's template - or none, on a row written before it was kept.
    expect(sqlOf(query["templateType"], "t")).toContain("t IS NULL");
    expect(parametersOf(query["templateType"])).toEqual([
      EmailTemplateType.InviteMember,
    ]);

    // An invitation names no record of the project.
    for (const column of RECORD_COLUMNS) {
      expect(sqlOf(query[column], "c")).toBe("(c IS NULL)");
    }

    expect(Object.keys(query).sort()).toEqual(
      ["projectId", "userId", "templateType", ...RECORD_COLUMNS].sort(),
    );
  });

  test("names every column of an email's record, so none of the project's notices is read as an invitation", () => {
    const columns: Array<string> = Object.keys(new EmailLog()).filter(
      (key: string): boolean => {
        return (
          key.endsWith("Id") &&
          ![
            "_id",
            "projectId",
            "userId",
            "projectSmtpConfigId",
            "deletedByUserId",
          ].includes(key)
        );
      },
    );

    expect([...RECORD_COLUMNS].sort()).toEqual(columns.sort());
  });

  test("asks about a page at most", async () => {
    const people: Array<ObjectID> = Array.from(
      { length: MAX_PEOPLE_PER_INVITATION_EMAILS_READ + 10 },
      (): ObjectID => {
        return ObjectID.generate();
      },
    );

    await InvitationEmailsNotSent.read({
      projectId: PROJECT_ID,
      userIds: people,
      props: CALLER,
    });

    expect(
      parametersOf(
        (askedWith().query as Record<string, unknown>)["userId"],
      ),
    ).toHaveLength(MAX_PEOPLE_PER_INVITATION_EMAILS_READ);
  });

  test("reads nothing for nobody", async () => {
    await expect(
      InvitationEmailsNotSent.read({
        projectId: PROJECT_ID,
        userIds: [],
        props: CALLER,
      }),
    ).resolves.toEqual([]);

    expect(findBySpy).not.toHaveBeenCalled();
  });
});

describe("each person's latest invitation email decides", () => {
  test("a failed one names them, with the Email Log's reason", async () => {
    findBySpy.mockResolvedValue([
      logRow(GRACE, MailStatus.Error, "535 5.7.8 Authentication failed"),
    ]);

    await expect(
      InvitationEmailsNotSent.read({
        projectId: PROJECT_ID,
        userIds: [GRACE],
        props: CALLER,
      }),
    ).resolves.toEqual([
      {
        userId: GRACE.toString(),
        statusMessage: "535 5.7.8 Authentication failed",
      },
    ]);
  });

  test("one that went, after one that failed, names nobody: they were invited again once email worked", async () => {
    findBySpy.mockResolvedValue([
      logRow(GRACE, MailStatus.Success, "Email sent successfully"),
      logRow(GRACE, MailStatus.Error, "535 5.7.8 Authentication failed"),
    ]);

    await expect(
      InvitationEmailsNotSent.read({
        projectId: PROJECT_ID,
        userIds: [GRACE],
        props: CALLER,
      }),
    ).resolves.toEqual([]);
  });

  test("one that failed, after one that went, names them: the latest was not sent", async () => {
    findBySpy.mockResolvedValue([
      logRow(GRACE, MailStatus.Error, "550 5.1.1 Recipient address rejected"),
      logRow(GRACE, MailStatus.Success, "Email sent successfully"),
    ]);

    const notSent: Array<InvitationEmailNotSent> =
      await InvitationEmailsNotSent.read({
        projectId: PROJECT_ID,
        userIds: [GRACE],
        props: CALLER,
      });

    expect(notSent).toEqual([
      {
        userId: GRACE.toString(),
        statusMessage: "550 5.1.1 Recipient address rejected",
      },
    ]);
  });

  test("decides for each person on the page apart, in one read", async () => {
    findBySpy.mockResolvedValue([
      logRow(ALAN, MailStatus.Error, "Quota exceeded"),
      logRow(GRACE, MailStatus.Success, "Email sent successfully"),
      logRow(ALAN, MailStatus.Success, "Email sent successfully"),
      logRow(GRACE, MailStatus.Error, "Quota exceeded"),
    ]);

    await expect(
      InvitationEmailsNotSent.read({
        projectId: PROJECT_ID,
        userIds: [GRACE, ALAN, ADA],
        props: CALLER,
      }),
    ).resolves.toEqual([
      { userId: ALAN.toString(), statusMessage: "Quota exceeded" },
    ]);
    expect(findBySpy).toHaveBeenCalledTimes(1);
  });

  test("a failed one that says nothing names them with no reason", async () => {
    findBySpy.mockResolvedValue([logRow(GRACE, MailStatus.Error)]);

    await expect(
      InvitationEmailsNotSent.read({
        projectId: PROJECT_ID,
        userIds: [GRACE],
        props: CALLER,
      }),
    ).resolves.toEqual([{ userId: GRACE.toString(), statusMessage: "" }]);
  });

  test("a row that names nobody is passed over", () => {
    const nobody: EmailLog = new EmailLog();
    nobody.status = MailStatus.Error;
    nobody.statusMessage = "Quota exceeded";

    expect(InvitationEmailsNotSent.getLatestFailures([nobody])).toEqual([]);
  });
});

describe("a caller who may not read the project's Email Logs", () => {
  test("is told about nobody, rather than refused: the page says what it always said", async () => {
    findBySpy.mockRejectedValue(
      new NotAuthorizedException(
        "You do not have permissions to read Email Logs.",
      ) as never,
    );

    await expect(
      InvitationEmailsNotSent.read({
        projectId: PROJECT_ID,
        userIds: [GRACE],
        props: CALLER,
      }),
    ).resolves.toEqual([]);
  });

  test("any other failure is not hidden", async () => {
    const failure: BadDataException = new BadDataException(
      "The database refused the read.",
    );
    findBySpy.mockRejectedValue(failure as never);

    await expect(
      InvitationEmailsNotSent.read({
        projectId: PROJECT_ID,
        userIds: [GRACE],
        props: CALLER,
      }),
    ).rejects.toBe(failure);
  });
});
