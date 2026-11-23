import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import Project from "../../../../Models/DatabaseModels/Project";
import ServiceOwnerTeam from "../../../../Models/DatabaseModels/ServiceOwnerTeam";
import ServiceOwnerUser from "../../../../Models/DatabaseModels/ServiceOwnerUser";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import DataSecurityIssueFeedService from "../../../../Server/Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../../../Server/Services/DataSecurityIssueService";
import MailService from "../../../../Server/Services/MailService";
import ProjectService from "../../../../Server/Services/ProjectService";
import ServiceOwnerTeamService from "../../../../Server/Services/ServiceOwnerTeamService";
import ServiceOwnerUserService from "../../../../Server/Services/ServiceOwnerUserService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import UserService from "../../../../Server/Services/UserService";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import DataSecurityContainmentNotice, {
  buildContainmentNoticeMarkdown,
  getContainmentNoticeSubject,
} from "../../../../Server/Utils/DataSecurity/DataSecurityContainmentNotice";
import DataSecurityIntegrations from "../../../../Server/Utils/DataSecurity/DataSecurityIntegrations";
import * as Jobs from "../../../../Server/Utils/DataSecurity/DataSecurityJobs";
import logger from "../../../../Server/Utils/Logger";
import URL from "../../../../Types/API/URL";
import DataSecurityIssueStatus from "../../../../Types/DataSecurity/DataSecurityIssueStatus";
import ObjectID from "../../../../Types/ObjectID";
import { mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { SpyInstance } from "jest-mock";

/*
 * WHO IS TOLD OF A CHANGE ONEUPTIME AI MADE WITHOUT ASKING (#10366): the
 * store's owners and the owners of its service, each once, with what was
 * done, how it was proven, how to undo it and - for a secret - that it
 * must be rotated, and where it was seen. And the new findings that have
 * OneUptime AI work on an open telemetry issue again.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10366000-0000-4000-8000-000000000001",
);
const STORE_ID: ObjectID = new ObjectID("10366000-0000-4000-8000-0000000000b1");
const SERVICE_ID: ObjectID = new ObjectID(
  "10366000-0000-4000-8000-0000000000e1",
);
const ISSUE_ID: ObjectID = new ObjectID("10366000-0000-4000-8000-0000000000a1");
const STORE_OWNER: string = "10366000-0000-4000-8000-0000000000f1";
const SERVICE_OWNER: string = "10366000-0000-4000-8000-0000000000f2";
const TEAM_MEMBER: string = "10366000-0000-4000-8000-0000000000f3";
const TEAM_ID: string = "10366000-0000-4000-8000-0000000000d1";

function user(id: string, email: string): User {
  const found: User = new User(new ObjectID(id));
  found.email = email as never;
  return found;
}

const CONTENT: {
  title: string;
  ruleLines: Array<ReturnType<typeof mdText>>;
  proofLines: Array<ReturnType<typeof mdText>>;
  actionLines: Array<ReturnType<typeof mdText>>;
} = {
  title: "Scrub Password or secret in attributes.db.password of checkout logs",
  ruleLines: [
    mdText`**Data Security: Password or secret in db.password of checkout**: It redacts the whole value of db.password.`,
  ],
  proofLines: [
    mdText`Proven on 12 records, 2 of them the finding's own: it hid the data in all 5 values that held it, and changed none of the 7 other values at its place.`,
  ],
  actionLines: [
    mdText`**Rotate this secret.** Hiding it stops new copies only. It was seen in attributes.db.password of checkout logs (last seen 2026-11-20).`,
  ],
};

let sent: Array<{ to: string; subject: string; message: string }>;
let feed: SpyInstance<
  typeof DataSecurityIssueFeedService.createDataSecurityIssueFeedItem
>;

beforeEach(() => {
  sent = [];

  jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString("https://oneuptime.example/dashboard"));
  jest
    .spyOn(DataSecurityIntegrations, "getOwnerUsers")
    .mockResolvedValue([user(STORE_OWNER, "store-owner@acme.test")]);
  jest.spyOn(ServiceOwnerUserService, "findBy").mockResolvedValue([
    { userId: new ObjectID(SERVICE_OWNER) } as unknown as ServiceOwnerUser,
    // The store's owner owns the service too: emailed once.
    { userId: new ObjectID(STORE_OWNER) } as unknown as ServiceOwnerUser,
  ] as never);
  jest
    .spyOn(ServiceOwnerTeamService, "findBy")
    .mockResolvedValue([
      { teamId: new ObjectID(TEAM_ID) } as unknown as ServiceOwnerTeam,
    ] as never);
  jest
    .spyOn(TeamMemberService, "findBy")
    .mockResolvedValue([
      { userId: new ObjectID(TEAM_MEMBER) } as unknown as TeamMember,
    ] as never);
  jest.spyOn(UserService, "findBy").mockImplementation((async (findBy: {
    query: { _id: { values: Array<ObjectID> } };
  }) => {
    return findBy.query._id.values.map((id: ObjectID): User => {
      return user(id.toString(), `${id.toString().slice(-2)}@acme.test`);
    });
  }) as never);
  jest.spyOn(MailService, "sendMail").mockImplementation((async (mail: {
    toEmail: string;
    subject: string;
    vars: { message: string };
  }) => {
    sent.push({
      to: mail.toEmail.toString(),
      subject: mail.subject,
      message: mail.vars.message,
    });
  }) as never);
  feed = jest
    .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the email", () => {
  test("says what was done, how it was proven, to rotate the secret, and how to undo it", () => {
    const markdown: string = buildContainmentNoticeMarkdown({
      dataStoreName: "checkout logs",
      content: CONTENT,
      issueLink: URL.fromString(
        "https://oneuptime.example/dashboard/p/data-security/issues/i",
      ),
      aiLink: URL.fromString(
        "https://oneuptime.example/dashboard/p/data-security/ai",
      ),
    }).toString();

    expect(markdown).toContain(
      "OneUptime AI made a change to **checkout logs** without asking",
    );
    expect(markdown).toContain(
      "Data Security: Password or secret in db.password",
    );
    expect(markdown).toContain("How it was proven before anything was changed");
    expect(markdown).toContain("**Rotate this secret.**");
    expect(markdown).toContain("press Undo there");
    expect(
      getContainmentNoticeSubject({
        dataStoreName: "checkout logs",
        isSecret: true,
      }),
    ).toBe(
      "Data Security: OneUptime AI hid a secret in checkout logs - rotate it",
    );
  });

  test("a store's name a person wrote is text, never Markdown", () => {
    expect(
      buildContainmentNoticeMarkdown({
        dataStoreName: "**[click](https://evil.example)**",
        content: CONTENT,
        issueLink: URL.fromString("https://oneuptime.example/i"),
        aiLink: URL.fromString("https://oneuptime.example/ai"),
      }).toString(),
    ).not.toContain("[click](https://evil.example)");
  });
});

describe("who it goes to", () => {
  test("the store's owners and the service's - its people and its teams' members - each once, and the issue says so", async () => {
    const emailed: number = await DataSecurityContainmentNotice.send({
      projectId: PROJECT_ID,
      dataStoreId: STORE_ID,
      dataStoreName: "checkout logs",
      serviceId: SERVICE_ID,
      dataSecurityIssueId: ISSUE_ID,
      isSecret: true,
      content: CONTENT,
    });

    expect(emailed).toBe(3);
    expect(
      sent
        .map((mail: { to: string }) => {
          return mail.to;
        })
        .sort(),
    ).toEqual(["store-owner@acme.test", "f2@acme.test", "f3@acme.test"].sort());
    expect(sent[0]!.subject).toContain("rotate it");
    expect(sent[0]!.message).toContain("Rotate this secret.");
    expect(feed).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        dataSecurityIssueId: ISSUE_ID,
        feedInfoInMarkdown:
          "The 3 owners of the store and its service were emailed about the change OneUptime AI made.",
      }),
    );
  });

  test("nobody when nobody owns the store or the service - and an email that cannot go never fails the change", async () => {
    jest.spyOn(DataSecurityIntegrations, "getOwnerUsers").mockResolvedValue([]);

    expect(
      await DataSecurityContainmentNotice.send({
        projectId: PROJECT_ID,
        dataStoreId: STORE_ID,
        dataStoreName: "checkout logs",
        isSecret: true,
        content: CONTENT,
      }),
    ).toBe(0);
    expect(sent).toEqual([]);
    expect(feed).not.toHaveBeenCalled();

    // With an issue, its timeline says nobody was told, so a reader names owners.
    expect(
      await DataSecurityContainmentNotice.send({
        projectId: PROJECT_ID,
        dataStoreId: STORE_ID,
        dataStoreName: "checkout logs",
        dataSecurityIssueId: ISSUE_ID,
        isSecret: true,
        content: CONTENT,
      }),
    ).toBe(0);
    expect(sent).toEqual([]);
    expect(feed).toHaveBeenCalledWith(
      expect.objectContaining({
        dataSecurityIssueId: ISSUE_ID,
        feedInfoInMarkdown:
          "No one was emailed about the change OneUptime AI made: neither the store nor its service has an owner.",
      }),
    );

    jest
      .spyOn(DataSecurityIntegrations, "getOwnerUsers")
      .mockRejectedValue(new Error("the database is down"));

    expect(
      await DataSecurityContainmentNotice.send({
        projectId: PROJECT_ID,
        dataStoreId: STORE_ID,
        dataStoreName: "checkout logs",
        isSecret: true,
        content: CONTENT,
      }),
    ).toBe(0);
  });
});

describe("new findings on a store with an open telemetry issue", () => {
  let queued: SpyInstance<typeof Jobs.queueDataSecurityAiEvaluation>;

  beforeEach(() => {
    queued = jest
      .spyOn(Jobs, "queueDataSecurityAiEvaluation")
      .mockResolvedValue(undefined);
    jest.spyOn(DataSecurityIssueService, "findBy").mockResolvedValue([
      {
        id: ISSUE_ID,
        checkId: "secrets-in-telemetry",
        status: DataSecurityIssueStatus.Open,
      } as unknown as DataSecurityIssue,
      {
        id: new ObjectID("10366000-0000-4000-8000-0000000000a2"),
        checkId: "public-read",
        status: DataSecurityIssueStatus.Open,
      } as unknown as DataSecurityIssue,
    ] as never);
  });

  test("have OneUptime AI work on the telemetry issue again - only while it works on its own", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      enableAi: true,
      enableAutomaticDataSecurityAi: true,
    } as unknown as Project);

    await DataSecurityIntegrations.onNewTelemetryFindings({
      projectId: PROJECT_ID,
      dataStoreId: STORE_ID,
    });

    expect(queued).toHaveBeenCalledTimes(1);
    expect(queued).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      dataSecurityIssueId: ISSUE_ID,
    });

    queued.mockClear();
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      enableAi: true,
      enableAutomaticDataSecurityAi: false,
    } as unknown as Project);

    await DataSecurityIntegrations.onNewTelemetryFindings({
      projectId: PROJECT_ID,
      dataStoreId: STORE_ID,
    });

    expect(queued).not.toHaveBeenCalled();
  });
});
