import MailService from "../../../Server/Services/MailService";
import ProjectService, {
  OWNER_EMAIL_TIMEOUT_IN_MS,
} from "../../../Server/Services/ProjectService";
import logger from "../../../Server/Utils/Logger";
import User from "../../../Models/DatabaseModels/User";
import EmptyResponseData from "../../../Types/API/EmptyResponse";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Email from "../../../Types/Email";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The project row's planCutoffNoticeSentAt: when its owners were last told
 * that its plan stops its API keys or limits its SCIM connections
 * (PlanDowngradeOwnerNotice). Three statements, pinned here without a
 * database - each one statement, every value bound, no hooks, no version
 * or updatedAt bump; what they do on a real Postgres, workers racing
 * included, is PlanCutoffNoticePostgres.test.ts:
 *
 *   - claimPlanCutoffNotice: the one-time notice's claim, won only while
 *     the column is empty, by one caller;
 *   - releasePlanCutoffNotice: gives back exactly the claim made, when its
 *     email could not be sent;
 *   - markPlanCutoffNoticeSent: a plan change told the owners now.
 */

type QueryCall = [string, Array<unknown>];

const mockRepository: (result: unknown) => jest.Mock = (
  result: unknown,
): jest.Mock => {
  const query: jest.Mock = jest.fn().mockImplementation(async () => {
    return result;
  });

  jest.spyOn(ProjectService, "getRepository").mockReturnValue({
    manager: { query },
  } as never);

  return query;
};

afterEach(() => {
  jest.restoreAllMocks();
});

const projectId: ObjectID = ObjectID.generate();
const now: Date = new Date("2026-10-07T15:30:00.000Z");

describe("ProjectService.claimPlanCutoffNotice", () => {
  test("one statement writes the column only while it is empty, on a project that is not deleted", async () => {
    const query: jest.Mock = mockRepository([{ _id: projectId.toString() }]);

    expect(await ProjectService.claimPlanCutoffNotice({ projectId, now })).toBe(
      true,
    );

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as QueryCall;

    expect(sql).toBe(
      `WITH "updated" AS (UPDATE "Project" SET "planCutoffNoticeSentAt" = $1 WHERE "_id" = $2 AND "deletedAt" IS NULL AND "planCutoffNoticeSentAt" IS NULL RETURNING "_id") SELECT "_id" FROM "updated"`,
    );
    expect(params).toEqual([now, projectId.toString()]);
    // A passive write: nothing else is touched.
    expect(sql).not.toContain("version");
    expect(sql).not.toContain("updatedAt");
  });

  test("no row written - told already, or the project is gone - is false", async () => {
    mockRepository([]);

    expect(await ProjectService.claimPlanCutoffNotice({ projectId, now })).toBe(
      false,
    );
  });

  test("an answer that is not a list of rows is false, never a claim", async () => {
    mockRepository(undefined);

    expect(await ProjectService.claimPlanCutoffNotice({ projectId, now })).toBe(
      false,
    );
  });

  test("a database error reaches the caller", async () => {
    jest.spyOn(ProjectService, "getRepository").mockReturnValue({
      manager: {
        query: jest.fn().mockImplementation(async () => {
          throw new Error("connection lost");
        }),
      },
    } as never);

    await expect(
      ProjectService.claimPlanCutoffNotice({ projectId, now }),
    ).rejects.toThrow("connection lost");
  });
});

describe("ProjectService.releasePlanCutoffNotice", () => {
  test("empties the column only while it still holds the claim that was made", async () => {
    const query: jest.Mock = mockRepository([]);

    await ProjectService.releasePlanCutoffNotice({
      projectId,
      claimedAt: now,
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as QueryCall;

    expect(sql).toBe(
      `UPDATE "Project" SET "planCutoffNoticeSentAt" = NULL WHERE "_id" = $1 AND "planCutoffNoticeSentAt" = $2`,
    );
    expect(params).toEqual([projectId.toString(), now]);
  });
});

describe("ProjectService.markPlanCutoffNoticeSent", () => {
  test("writes now, whether or not the owners were told before", async () => {
    const query: jest.Mock = mockRepository([]);

    await ProjectService.markPlanCutoffNoticeSent({ projectId, now });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as QueryCall;

    expect(sql).toBe(
      `UPDATE "Project" SET "planCutoffNoticeSentAt" = $1 WHERE "_id" = $2`,
    );
    expect(params).toEqual([now, projectId.toString()]);
    expect(sql).not.toContain("IS NULL");
  });
});

describe("the column", () => {
  test("is internal: no one reads or writes it through the API", async () => {
    const { default: Project } = await import(
      "../../../Models/DatabaseModels/Project"
    );
    const project: InstanceType<typeof Project> = new Project();

    expect(project.getColumnAccessControlFor("planCutoffNoticeSentAt")).toEqual(
      { create: [], read: [], update: [] },
    );
    expect(
      project.getTableColumnMetadata("planCutoffNoticeSentAt")
        .hideColumnInDocumentation,
    ).toBe(true);
  });
});

/*
 * The owners' email for a notice that must know it went out: the one-time
 * notice runs from the migrate Job, which exits as soon as its migrations
 * return, so an email still on its way to the mail service would never
 * leave. sendEmailToOwnersAndWait sends the same email the owners' billing
 * notices send, waits for the mail service to take each one, and says how
 * many it took.
 */
describe("ProjectService.sendEmailToOwnersAndWait", () => {
  const ownerNamed: (email: string) => User = (email: string): User => {
    const user: User = new User(ObjectID.generate());
    user.email = new Email(email);
    return user;
  };

  const alice: User = ownerNamed("alice@acme.example");
  const bob: User = ownerNamed("bob@acme.example");

  const taken: () => HTTPResponse<EmptyResponseData> = () => {
    return new HTTPResponse<EmptyResponseData>(200, {}, {});
  };

  let sendMail: ReturnType<typeof getJestSpyOn>;
  let loggedErrors: ReturnType<typeof getJestSpyOn>;

  beforeEach(() => {
    sendMail = getJestSpyOn(MailService, "sendMail").mockResolvedValue(taken());
    loggedErrors = getJestSpyOn(logger, "error").mockImplementation(() => {
      return undefined;
    });
  });

  test("sends each owner the owners' billing email, and counts what the mail service took", async () => {
    expect(
      await ProjectService.sendEmailToOwnersAndWait({
        projectId,
        owners: [alice, bob],
        subject: "API keys stopped working in Acme",
        message: "The project&#39;s API key stopped working.",
      }),
    ).toBe(2);

    expect(sendMail).toHaveBeenCalledTimes(2);

    const [mail, options] = sendMail.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];

    expect(String(mail["toEmail"])).toBe("alice@acme.example");
    expect(mail["templateType"]).toBe(EmailTemplateType.SimpleMessage);
    expect(mail["subject"]).toBe("API keys stopped working in Acme");
    expect(mail["isSubjectLiteral"]).toBe(true);
    expect(mail["vars"]).toEqual({
      subject: "API keys stopped working in Acme",
      message: "The project&#39;s API key stopped working.",
    });
    expect(String(options["projectId"])).toBe(projectId.toString());
    expect(String(options["userId"])).toBe(alice.id!.toString());
    // A mail service that hangs holds the run a minute per email at most.
    expect(options["timeoutInMs"]).toBe(OWNER_EMAIL_TIMEOUT_IN_MS);
    expect(OWNER_EMAIL_TIMEOUT_IN_MS).toBe(60 * 1000);
    expect(
      String(
        (sendMail.mock.calls[1]![0] as unknown as { toEmail: unknown }).toEmail,
      ),
    ).toBe("bob@acme.example");
  });

  test("answers only once every email has been handed over", async () => {
    const handOvers: Array<() => void> = [];
    sendMail.mockImplementation(() => {
      return new Promise<HTTPResponse<EmptyResponseData>>(
        (resolve: (response: HTTPResponse<EmptyResponseData>) => void) => {
          handOvers.push(() => {
            resolve(taken());
          });
        },
      );
    });

    let answered: boolean = false;
    const delivered: Promise<number> = ProjectService.sendEmailToOwnersAndWait({
      projectId,
      owners: [alice, bob],
      subject: "s",
      message: "m",
    }).then((count: number) => {
      answered = true;
      return count;
    });

    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }

    // The first email is on its way, and the answer waits for it.
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(answered).toBe(false);

    handOvers.shift()!();
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }

    // Then the second; the answer still waits.
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(answered).toBe(false);

    handOvers.shift()!();

    expect(await delivered).toBe(2);
  });

  test("an email the mail service refused is not counted, and is logged", async () => {
    sendMail
      .mockResolvedValueOnce(
        new HTTPErrorResponse(500, { message: "SMTP is not set up" }, {}),
      )
      .mockResolvedValueOnce(taken());

    expect(
      await ProjectService.sendEmailToOwnersAndWait({
        projectId,
        owners: [alice, bob],
        subject: "s",
        message: "m",
      }),
    ).toBe(1);
    expect(loggedErrors).toHaveBeenCalledTimes(1);
    expect(String(loggedErrors.mock.calls[0]![0])).toContain(
      "SMTP is not set up",
    );
  });

  test("a mail service that cannot be reached is not counted, is logged, and never throws", async () => {
    sendMail.mockRejectedValue(new Error("connect ECONNREFUSED"));

    expect(
      await ProjectService.sendEmailToOwnersAndWait({
        projectId,
        owners: [alice, bob],
        subject: "s",
        message: "m",
      }),
    ).toBe(0);
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(loggedErrors).toHaveBeenCalledTimes(2);
  });

  test("no owners: nothing is sent", async () => {
    expect(
      await ProjectService.sendEmailToOwnersAndWait({
        projectId,
        owners: [],
        subject: "s",
        message: "m",
      }),
    ).toBe(0);
    expect(sendMail).not.toHaveBeenCalled();
  });

  test("the email that does not wait sends the same email", async () => {
    getJestSpyOn(ProjectService, "getOwners").mockResolvedValue([alice]);

    await ProjectService.sendEmailToProjectOwners(
      projectId,
      "API keys stopped working in Acme",
      "The project&#39;s API key stopped working.",
    );

    expect(sendMail).toHaveBeenCalledTimes(1);
    const [mail, options] = sendMail.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];

    expect(mail["templateType"]).toBe(EmailTemplateType.SimpleMessage);
    expect(mail["isSubjectLiteral"]).toBe(true);
    expect(mail["vars"]).toEqual({
      subject: "API keys stopped working in Acme",
      message: "The project&#39;s API key stopped working.",
    });
    // Nothing waits for it, so nothing bounds it either: as before.
    expect(options["timeoutInMs"]).toBeUndefined();
  });
});
