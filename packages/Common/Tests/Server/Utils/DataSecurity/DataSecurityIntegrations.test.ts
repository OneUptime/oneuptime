import DataSecurityIntegrations, {
  OpenedIssueForIntegrations,
} from "../../../../Server/Utils/DataSecurity/DataSecurityIntegrations";
import SecurityCaseIngest, {
  SecurityDetectionSignal,
} from "../../../../Server/Utils/SecurityCase/SecurityCaseIngest";
import * as SecurityEventAlerting from "../../../../Server/Utils/SecurityEvent/SecurityEventAlerting";
import DataSecurityIssueFeedService from "../../../../Server/Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../../../Server/Services/DataSecurityIssueService";
import DataStoreOwnerTeamService from "../../../../Server/Services/DataStoreOwnerTeamService";
import DataStoreOwnerUserService from "../../../../Server/Services/DataStoreOwnerUserService";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import MailService from "../../../../Server/Services/MailService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import UserService from "../../../../Server/Services/UserService";
import logger from "../../../../Server/Utils/Logger";
import DataSecuritySetting from "../../../../Models/DatabaseModels/DataSecuritySetting";
import { DataSecurityIssueFeedEventType } from "../../../../Models/DatabaseModels/DataSecurityIssueFeed";
import DataStoreOwnerTeam from "../../../../Models/DatabaseModels/DataStoreOwnerTeam";
import DataStoreOwnerUser from "../../../../Models/DatabaseModels/DataStoreOwnerUser";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import URL from "../../../../Types/API/URL";
import { Blue500, Red500 } from "../../../../Types/BrandColors";
import Includes from "../../../../Types/BaseDatabase/Includes";
import Email from "../../../../Types/Email";
import EmailTemplateType from "../../../../Types/Email/EmailTemplateType";
import { JSONObject } from "../../../../Types/JSON";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import SecuritySeverity from "../../../../Types/SecuritySeverity";
import SecurityDetectionSource from "../../../../Types/SecurityCase/SecurityDetectionSource";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import DataSensitivity from "../../../../Types/DataSecurity/DataSensitivity";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * What happens elsewhere in OneUptime when Data Security opens issues
 * (DataSecurityIntegrations): a Critical issue opens a security case about
 * its store and - when the project asks - raises a deduplicated alert, and
 * every new issue is emailed to the people who own its store. Each is best
 * effort. The case ingest, the alerting, the owner tables and the mail
 * service are stood in for, and recorded.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STORE_A: ObjectID = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const STORE_B: ObjectID = new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const ALERT_SEVERITY_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const DASHBOARD: string = "https://oneuptime.example.com/dashboard";

interface OwnerFixture {
  usersByStore: Map<string, Array<ObjectID>>;
  teamsByStore: Map<string, Array<ObjectID>>;
  membersByTeam: Map<string, Array<{ userId: ObjectID; accepted: boolean }>>;
  users: Array<User>;
}

let owners: OwnerFixture;
let setting: DataSecuritySetting;
let casesSpy: jest.SpyInstance;
let severitySpy: jest.SpyInstance;
let alertsSpy: jest.SpyInstance;
let feedSpy: jest.SpyInstance;
let mailSpy: jest.SpyInstance;
let notifiedSpy: jest.SpyInstance;
let issueLinkSpy: jest.SpyInstance;
let ownerUsersSpy: jest.SpyInstance;
let teamMembersSpy: jest.SpyInstance;
let usersSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;

function userOf(name: string, email?: string): User {
  const user: User = new User(ObjectID.generate());
  user.name = new Name(name);

  if (email) {
    user.email = new Email(email);
  }

  owners.users.push(user);
  return user;
}

beforeEach(() => {
  owners = {
    usersByStore: new Map(),
    teamsByStore: new Map(),
    membersByTeam: new Map(),
    users: [],
  };
  setting = new DataSecuritySetting();
  setting.projectId = PROJECT_ID;

  issueLinkSpy = jest
    .spyOn(DataSecurityIssueService, "getIssueLinkInDashboard")
    .mockImplementation(async (projectId: ObjectID, issueId: ObjectID) => {
      return URL.fromString(
        `${DASHBOARD}/${projectId.toString()}/data-security/issues/${issueId.toString()}`,
      );
    });
  jest
    .spyOn(DataStoreService, "getDataStoreLinkInDashboard")
    .mockImplementation(async (projectId: ObjectID, dataStoreId: ObjectID) => {
      return URL.fromString(
        `${DASHBOARD}/${projectId.toString()}/data-security/stores/${dataStoreId.toString()}`,
      );
    });
  casesSpy = jest
    .spyOn(SecurityCaseIngest, "recordDetections")
    .mockResolvedValue({
      casesOpened: 1,
      detectionsAdded: 1,
      detectionsRepeated: 0,
    } as never);
  severitySpy = jest
    .spyOn(SecurityEventAlerting, "resolveAlertSeverityIdForProject")
    .mockResolvedValue(ALERT_SEVERITY_ID);
  alertsSpy = jest
    .spyOn(SecurityEventAlerting, "openDedupedAlerts")
    .mockImplementation(async (data: { matches: Array<unknown> }) => {
      return data.matches.length;
    });
  feedSpy = jest
    .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
    .mockResolvedValue(undefined);
  mailSpy = jest
    .spyOn(MailService, "sendMail")
    .mockResolvedValue(undefined as never);
  notifiedSpy = jest
    .spyOn(DataSecurityIssueService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);

  ownerUsersSpy = jest
    .spyOn(DataStoreOwnerUserService, "findBy")
    .mockImplementation((async (findBy: { query: JSONObject }) => {
      const storeId: string = (
        findBy.query["dataStoreId"] as ObjectID
      ).toString();

      return (owners.usersByStore.get(storeId) || []).map(
        (userId: ObjectID): DataStoreOwnerUser => {
          const owner: DataStoreOwnerUser = new DataStoreOwnerUser();
          owner.userId = userId;
          return owner;
        },
      );
    }) as never);
  jest
    .spyOn(DataStoreOwnerTeamService, "findBy")
    .mockImplementation((async (findBy: { query: JSONObject }) => {
      const storeId: string = (
        findBy.query["dataStoreId"] as ObjectID
      ).toString();

      return (owners.teamsByStore.get(storeId) || []).map(
        (teamId: ObjectID): DataStoreOwnerTeam => {
          const owner: DataStoreOwnerTeam = new DataStoreOwnerTeam();
          owner.teamId = teamId;
          return owner;
        },
      );
    }) as never);
  teamMembersSpy = jest
    .spyOn(TeamMemberService, "findBy")
    .mockImplementation((async (findBy: { query: JSONObject }) => {
      const teamIds: Array<string> = (
        (findBy.query["teamId"] as Includes).values as Array<ObjectID>
      ).map((teamId: ObjectID): string => {
        return teamId.toString();
      });
      const members: Array<TeamMember> = [];

      for (const teamId of teamIds) {
        for (const member of owners.membersByTeam.get(teamId) || []) {
          if (
            findBy.query["hasAcceptedInvitation"] === true &&
            !member.accepted
          ) {
            continue;
          }

          const row: TeamMember = new TeamMember();
          row.userId = member.userId;
          members.push(row);
        }
      }

      return members;
    }) as never);
  usersSpy = jest
    .spyOn(UserService, "findBy")
    .mockImplementation((async (findBy: { query: JSONObject }) => {
      const ids: Array<string> = (
        (findBy.query["_id"] as Includes).values as Array<ObjectID>
      ).map((id: ObjectID): string => {
        return id.toString();
      });

      return owners.users.filter((user: User) => {
        return ids.includes(user.id!.toString());
      });
    }) as never);

  errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function issueOf(data: {
  severity: SecuritySeverity;
  checkId?: string | undefined;
  title?: string | undefined;
  storeId?: ObjectID | undefined;
  storeName?: string | undefined;
  storeKey?: string | undefined;
  sensitivity?: DataSensitivity | undefined;
}): OpenedIssueForIntegrations {
  return {
    issueId: ObjectID.generate(),
    checkId: data.checkId || "public-read",
    title: data.title || "Anyone on the internet can read it",
    severity: data.severity,
    riskScore: 85,
    dataStoreId: data.storeId || STORE_A,
    dataStoreName: data.storeName || "customer-exports",
    dataStoreKey:
      data.storeKey === undefined
        ? "cloud:aws:AWS S3 Bucket:arn:aws:s3:::customer-exports"
        : data.storeKey,
    dataStoreKind: DataStoreKind.AwsS3Bucket,
    sensitivity: data.sensitivity || DataSensitivity.Restricted,
  };
}

function opened(issues: Array<OpenedIssueForIntegrations>): Promise<void> {
  return DataSecurityIntegrations.onIssuesOpened({
    projectId: PROJECT_ID,
    setting,
    issues,
  });
}

function signals(): Array<SecurityDetectionSignal> {
  return casesSpy.mock.calls.flatMap((call: Array<unknown>) => {
    return call[0] as Array<SecurityDetectionSignal>;
  });
}

function feedsOf(eventType: DataSecurityIssueFeedEventType): Array<JSONObject> {
  return feedSpy.mock.calls
    .map((call: Array<unknown>): JSONObject => {
      return call[0] as JSONObject;
    })
    .filter((feed: JSONObject) => {
      return feed["eventType"] === eventType;
    });
}

interface SentMail {
  toEmail: string;
  subject: string;
  message: string;
  templateType: EmailTemplateType;
  isSubjectLiteral: boolean | undefined;
  options: { projectId: ObjectID; userId: ObjectID };
}

function mails(): Array<SentMail> {
  return mailSpy.mock.calls.map((call: Array<unknown>): SentMail => {
    const mail: {
      toEmail: Email;
      subject: string;
      templateType: EmailTemplateType;
      isSubjectLiteral?: boolean;
      vars: { subject: string; message: string };
    } = call[0] as never;

    expect(mail.vars.subject).toBe(mail.subject);

    return {
      toEmail: mail.toEmail.toString(),
      subject: mail.subject,
      message: mail.vars.message,
      templateType: mail.templateType,
      isSubjectLiteral: mail.isSubjectLiteral,
      options: call[1] as { projectId: ObjectID; userId: ObjectID },
    };
  });
}

function ownedBy(store: ObjectID, ...users: Array<User>): void {
  owners.usersByStore.set(
    store.toString(),
    users.map((user: User): ObjectID => {
      return user.id!;
    }),
  );
}

async function settle(): Promise<void> {
  await new Promise((resolve: (value: unknown) => void) => {
    setTimeout(resolve, 0);
  });
}

describe("entityValueOf", () => {
  test("a store is the Data Store entity data-store:<its key>, or of its id when it has none", () => {
    expect(
      DataSecurityIntegrations.entityValueOf(
        issueOf({ severity: SecuritySeverity.Critical }),
      ),
    ).toBe("data-store:cloud:aws:AWS S3 Bucket:arn:aws:s3:::customer-exports");
    expect(
      DataSecurityIntegrations.entityValueOf(
        issueOf({ severity: SecuritySeverity.Critical, storeKey: "" }),
      ),
    ).toBe(`data-store:${STORE_A.toString()}`);
  });
});

describe("onIssuesOpened: security cases", () => {
  test("a Critical issue opens a security case about its store, from Data Security", async () => {
    const issue: OpenedIssueForIntegrations = issueOf({
      severity: SecuritySeverity.Critical,
    });

    await opened([issue]);

    expect(casesSpy).toHaveBeenCalledTimes(1);
    expect(signals()).toHaveLength(1);

    const signal: SecurityDetectionSignal = signals()[0]!;
    const entity: string =
      "data-store:cloud:aws:AWS S3 Bucket:arn:aws:s3:::customer-exports";

    expect(signal.projectId).toBe(PROJECT_ID);
    expect(signal.source).toBe(SecurityDetectionSource.DataSecurity);
    expect(signal.fingerprint).toBe(
      `data-security-issue:${issue.issueId.toString()}`,
    );
    expect(signal.title).toBe(
      "Anyone on the internet can read it: customer-exports",
    );
    expect(signal.description).toBe(
      `Data Security opened a **Critical** issue on customer-exports (Restricted data): Anyone on the internet can read it. [Open the issue](${DASHBOARD}/${PROJECT_ID.toString()}/data-security/issues/${issue.issueId.toString()}).`,
    );
    expect(signal.severity).toBe(OcsfSeverity.Critical);
    expect(signal.eventCount).toBe(1);
    expect(signal.groupValue).toBe(entity);
    expect(signal.entities).toEqual([
      { type: SecurityEntityType.DataStore, value: entity },
    ]);
    expect(signal.mitreTactics).toEqual([]);
    expect(signal.mitreTechniques).toEqual([]);
    expect(signal.ruleName).toBe("Data Security: public-read");
    expect(signal.seenAt).toBeInstanceOf(Date);
  });

  test("two Critical issues on one store name the same entity, so the second joins the first's case", async () => {
    const first: OpenedIssueForIntegrations = issueOf({
      severity: SecuritySeverity.Critical,
    });
    const second: OpenedIssueForIntegrations = issueOf({
      severity: SecuritySeverity.Critical,
      checkId: "secrets-stored",
      title: "Secrets are stored in it",
    });
    const elsewhere: OpenedIssueForIntegrations = issueOf({
      severity: SecuritySeverity.Critical,
      storeId: STORE_B,
      storeName: "billing-db",
      storeKey: "database:billing",
    });

    await opened([first, second, elsewhere]);

    expect(casesSpy).toHaveBeenCalledTimes(1);
    expect(
      signals().map((signal: SecurityDetectionSignal): string => {
        return signal.groupValue || "";
      }),
    ).toEqual([
      "data-store:cloud:aws:AWS S3 Bucket:arn:aws:s3:::customer-exports",
      "data-store:cloud:aws:AWS S3 Bucket:arn:aws:s3:::customer-exports",
      "data-store:database:billing",
    ]);
    expect(
      new Set(
        signals().map((signal: SecurityDetectionSignal): string => {
          return signal.fingerprint;
        }),
      ).size,
    ).toBe(3);
  });

  test("the store's name and the title are written as text, never markup, and a long title is cut", async () => {
    await opened([
      issueOf({
        severity: SecuritySeverity.Critical,
        storeName: "exports [click](https://evil.example)",
        title: `${"Very long title ".repeat(40)}*bold*`,
      }),
    ]);

    const signal: SecurityDetectionSignal = signals()[0]!;

    expect(signal.title).toHaveLength(480);
    expect(signal.description).not.toContain("[click](https://evil.example)");
    expect(signal.description).toContain("\\[click\\]");
    expect(signal.description).not.toContain("*bold*");
  });

  test("High, Medium and Low issues open no case and raise no alert", async () => {
    setting.raiseAlertsForCriticalIssues = true;

    await opened([
      issueOf({ severity: SecuritySeverity.High }),
      issueOf({ severity: SecuritySeverity.Medium }),
      issueOf({ severity: SecuritySeverity.Low }),
    ]);

    expect(casesSpy).not.toHaveBeenCalled();
    expect(severitySpy).not.toHaveBeenCalled();
    expect(alertsSpy).not.toHaveBeenCalled();
  });

  test("cases open unless the project turned them off", async () => {
    setting.openCasesForCriticalIssues = false;
    await opened([issueOf({ severity: SecuritySeverity.Critical })]);
    expect(casesSpy).not.toHaveBeenCalled();

    setting.openCasesForCriticalIssues = true;
    await opened([issueOf({ severity: SecuritySeverity.Critical })]);
    expect(casesSpy).toHaveBeenCalledTimes(1);
  });

  test("each case is noted, in red, on the timeline of the Critical issue it took in", async () => {
    const critical: OpenedIssueForIntegrations = issueOf({
      severity: SecuritySeverity.Critical,
    });

    await opened([critical, issueOf({ severity: SecuritySeverity.High })]);

    expect(feedsOf(DataSecurityIssueFeedEventType.SecurityCaseOpened)).toEqual([
      {
        projectId: PROJECT_ID,
        dataSecurityIssueId: critical.issueId,
        eventType: DataSecurityIssueFeedEventType.SecurityCaseOpened,
        displayColor: Red500,
        feedInfoInMarkdown:
          "Sent to Security Operations: a security case about this store was opened, or the open one took this issue in.",
      },
    ]);
  });

  test("a case that cannot be opened is logged; no timeline claims one, and alerts and owner emails still go", async () => {
    setting.raiseAlertsForCriticalIssues = true;
    ownedBy(STORE_A, userOf("Alice Owner", "alice@acme.io"));
    casesSpy.mockRejectedValue(new Error("Postgres went away"));

    await expect(
      opened([issueOf({ severity: SecuritySeverity.Critical })]),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      `DataSecurity: could not open security cases for project ${PROJECT_ID.toString()}:`,
    );
    expect(feedsOf(DataSecurityIssueFeedEventType.SecurityCaseOpened)).toEqual(
      [],
    );
    expect(alertsSpy).toHaveBeenCalledTimes(1);
    expect(mails()).toHaveLength(1);
  });

  test("a case whose link cannot be made is logged too, and alerts and owner emails still go", async () => {
    setting.raiseAlertsForCriticalIssues = true;
    ownedBy(STORE_A, userOf("Alice Owner", "alice@acme.io"));
    issueLinkSpy.mockRejectedValueOnce(new Error("Could not read the host."));

    await expect(
      opened([issueOf({ severity: SecuritySeverity.Critical })]),
    ).resolves.toBeUndefined();

    expect(casesSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      `DataSecurity: could not open security cases for project ${PROJECT_ID.toString()}:`,
    );
    expect(alertsSpy).toHaveBeenCalledTimes(1);
    expect(mails()).toHaveLength(1);
  });
});

describe("onIssuesOpened: alerts", () => {
  test("alerts are off unless the project turns them on", async () => {
    await opened([issueOf({ severity: SecuritySeverity.Critical })]);

    expect(severitySpy).not.toHaveBeenCalled();
    expect(alertsSpy).not.toHaveBeenCalled();
  });

  test("a Critical issue raises an alert at the project's Critical severity, deduplicated by issue", async () => {
    setting.raiseAlertsForCriticalIssues = true;
    const first: OpenedIssueForIntegrations = issueOf({
      severity: SecuritySeverity.Critical,
    });
    const second: OpenedIssueForIntegrations = issueOf({
      severity: SecuritySeverity.Critical,
      checkId: "card-security-codes-stored",
      title: "Card security codes are stored",
      storeId: STORE_B,
      storeName: "payments-db",
    });

    await opened([first, second, issueOf({ severity: SecuritySeverity.High })]);

    expect(severitySpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      explicitSeverityId: undefined,
      severityLabel: "Critical",
      isSevere: true,
    });
    expect(alertsSpy).toHaveBeenCalledTimes(1);

    const call: {
      projectId: ObjectID;
      alertSeverityId: ObjectID;
      matches: Array<SecurityEventAlerting.AlertableMatch>;
      logLabel: string;
    } = alertsSpy.mock.calls[0]![0];

    expect(call.projectId).toBe(PROJECT_ID);
    expect(call.alertSeverityId).toBe(ALERT_SEVERITY_ID);
    expect(call.logLabel).toBe(
      `DataSecurity: project ${PROJECT_ID.toString()}`,
    );
    expect(call.matches).toEqual([
      {
        fingerprint: `data-security-issue:${first.issueId.toString()}`,
        title:
          "Data Security: Anyone on the internet can read it (customer-exports)",
        description: `customer-exports holds Restricted data and failed a Data Security check: Anyone on the internet can read it. [Open the issue](${DASHBOARD}/${PROJECT_ID.toString()}/data-security/issues/${first.issueId.toString()}).`,
        rootCause:
          'The Data Security check "public-read" failed on customer-exports.',
      },
      {
        fingerprint: `data-security-issue:${second.issueId.toString()}`,
        title: "Data Security: Card security codes are stored (payments-db)",
        description: `payments-db holds Restricted data and failed a Data Security check: Card security codes are stored. [Open the issue](${DASHBOARD}/${PROJECT_ID.toString()}/data-security/issues/${second.issueId.toString()}).`,
        rootCause:
          'The Data Security check "card-security-codes-stored" failed on payments-db.',
      },
    ]);
    expect(
      feedsOf(DataSecurityIssueFeedEventType.AlertRaised).map(
        (feed: JSONObject): string => {
          return (feed["dataSecurityIssueId"] as ObjectID).toString();
        },
      ),
    ).toEqual([first.issueId.toString(), second.issueId.toString()]);
    expect(
      feedsOf(DataSecurityIssueFeedEventType.AlertRaised)[0],
    ).toMatchObject({
      displayColor: Red500,
      feedInfoInMarkdown:
        "An alert was raised, so whoever is on call is paged.",
    });
  });

  test("the alert severity the project chose is the one asked for", async () => {
    setting.raiseAlertsForCriticalIssues = true;
    setting.alertSeverityId = ALERT_SEVERITY_ID;

    await opened([issueOf({ severity: SecuritySeverity.Critical })]);

    expect(
      (severitySpy.mock.calls[0]![0] as { explicitSeverityId: ObjectID })
        .explicitSeverityId,
    ).toBe(ALERT_SEVERITY_ID);
  });

  test("an alert already open for the issue is not raised again, and no timeline says one was", async () => {
    setting.raiseAlertsForCriticalIssues = true;
    alertsSpy.mockResolvedValue(0);

    await opened([issueOf({ severity: SecuritySeverity.Critical })]);

    expect(alertsSpy).toHaveBeenCalledTimes(1);
    expect(feedsOf(DataSecurityIssueFeedEventType.AlertRaised)).toEqual([]);
  });

  test("with no severity to raise it at, no alert is raised", async () => {
    setting.raiseAlertsForCriticalIssues = true;
    severitySpy.mockResolvedValue(null);

    await opened([issueOf({ severity: SecuritySeverity.Critical })]);

    expect(alertsSpy).not.toHaveBeenCalled();
    expect(feedsOf(DataSecurityIssueFeedEventType.AlertRaised)).toEqual([]);
  });

  test("an alert that cannot be raised is logged, and owner emails still go", async () => {
    setting.raiseAlertsForCriticalIssues = true;
    ownedBy(STORE_A, userOf("Alice Owner", "alice@acme.io"));
    alertsSpy.mockRejectedValue(
      new Error("No alert state is marked resolved."),
    );

    await opened([issueOf({ severity: SecuritySeverity.Critical })]);

    expect(errorSpy).toHaveBeenCalledWith(
      `DataSecurity: could not raise alerts for project ${PROJECT_ID.toString()}:`,
    );
    expect(mails()).toHaveLength(1);
  });
});

describe("onIssuesOpened: the store's owners", () => {
  test("every new issue is emailed to its store's owners, directly or through a team, and to nobody else", async () => {
    const alice: User = userOf("Alice Owner", "alice@acme.io");
    const bob: User = userOf("Bob Teammate", "bob@acme.io");
    const carol: User = userOf("Carol Invited", "carol@acme.io");
    userOf("Dave Bystander", "dave@acme.io");
    const team: ObjectID = ObjectID.generate();

    ownedBy(STORE_A, alice);
    owners.teamsByStore.set(STORE_A.toString(), [team]);
    owners.membersByTeam.set(team.toString(), [
      { userId: bob.id!, accepted: true },
      { userId: carol.id!, accepted: false },
    ]);

    const critical: OpenedIssueForIntegrations = issueOf({
      severity: SecuritySeverity.Critical,
    });
    const medium: OpenedIssueForIntegrations = issueOf({
      severity: SecuritySeverity.Medium,
      checkId: "access-not-logged",
      title: "Reads of it are not logged",
    });

    await opened([critical, medium]);

    const sent: Array<SentMail> = mails();
    const link: string = `${DASHBOARD}/${PROJECT_ID.toString()}/data-security/stores/${STORE_A.toString()}`;

    expect(
      sent
        .map((mail: SentMail): string => {
          return mail.toEmail;
        })
        .sort(),
    ).toEqual(["alice@acme.io", "bob@acme.io"]);

    for (const mail of sent) {
      expect(mail.subject).toBe(
        "Data Security: 2 new issue(s) on customer-exports",
      );
      expect(mail.templateType).toBe(EmailTemplateType.SimpleMessage);
      expect(mail.isSubjectLiteral).toBe(true);
      expect(mail.message).toBe(
        [
          "customer-exports (Restricted data), which you own, has new Data Security issues:",
          "",
          "- Critical: Anyone on the internet can read it",
          "- Medium: Reads of it are not logged",
          "",
          `Open the store to see each issue and how to fix it: ${link}`,
        ].join("\n"),
      );
      expect(mail.options.projectId).toBe(PROJECT_ID);
    }

    expect(
      sent
        .map((mail: SentMail): string => {
          return mail.options.userId.toString();
        })
        .sort(),
    ).toEqual([alice.id!.toString(), bob.id!.toString()].sort());
  });

  test("each emailed issue is marked notified, and its timeline says how many owners were told", async () => {
    ownedBy(
      STORE_A,
      userOf("Alice Owner", "alice@acme.io"),
      userOf("Erin Owner", "erin@acme.io"),
    );
    const issue: OpenedIssueForIntegrations = issueOf({
      severity: SecuritySeverity.High,
    });

    await opened([issue]);

    expect(notifiedSpy).toHaveBeenCalledWith({
      id: issue.issueId,
      data: { isOwnerNotified: true },
    });
    expect(feedsOf(DataSecurityIssueFeedEventType.OwnersNotified)).toEqual([
      {
        projectId: PROJECT_ID,
        dataSecurityIssueId: issue.issueId,
        eventType: DataSecurityIssueFeedEventType.OwnersNotified,
        displayColor: Blue500,
        feedInfoInMarkdown:
          "The store's 2 owner(s) were emailed about this issue.",
      },
    ]);
  });

  test("each store's owners hear of their store's issues only", async () => {
    ownedBy(STORE_A, userOf("Alice Owner", "alice@acme.io"));
    ownedBy(STORE_B, userOf("Frank Owner", "frank@acme.io"));

    await opened([
      issueOf({
        severity: SecuritySeverity.Low,
        checkId: "no-owner",
        title: "Nobody owns it",
      }),
      issueOf({
        severity: SecuritySeverity.High,
        storeId: STORE_B,
        storeName: "billing-db",
        sensitivity: DataSensitivity.Confidential,
      }),
    ]);

    const byRecipient: Map<string, SentMail> = new Map(
      mails().map((mail: SentMail): [string, SentMail] => {
        return [mail.toEmail, mail];
      }),
    );

    expect(byRecipient.get("alice@acme.io")?.subject).toBe(
      "Data Security: 1 new issue(s) on customer-exports",
    );
    expect(byRecipient.get("alice@acme.io")?.message).toContain(
      "- Low: Nobody owns it",
    );
    expect(byRecipient.get("alice@acme.io")?.message).not.toContain(
      "billing-db",
    );
    expect(byRecipient.get("frank@acme.io")?.subject).toBe(
      "Data Security: 1 new issue(s) on billing-db",
    );
    expect(byRecipient.get("frank@acme.io")?.message).toContain(
      "billing-db (Confidential data), which you own",
    );
  });

  test("a store nobody owns: no email, nothing marked, no user looked up", async () => {
    await opened([issueOf({ severity: SecuritySeverity.Critical })]);

    expect(ownerUsersSpy).toHaveBeenCalledTimes(1);
    expect(usersSpy).not.toHaveBeenCalled();
    expect(mailSpy).not.toHaveBeenCalled();
    expect(notifiedSpy).not.toHaveBeenCalled();
    expect(feedsOf(DataSecurityIssueFeedEventType.OwnersNotified)).toEqual([]);
  });

  test("owners are told unless the project turned it off", async () => {
    ownedBy(STORE_A, userOf("Alice Owner", "alice@acme.io"));
    setting.notifyOwners = false;

    await opened([issueOf({ severity: SecuritySeverity.Critical })]);

    expect(ownerUsersSpy).not.toHaveBeenCalled();
    expect(mailSpy).not.toHaveBeenCalled();
  });

  test("an owner with no email address is skipped", async () => {
    ownedBy(
      STORE_A,
      userOf("Alice Owner", "alice@acme.io"),
      userOf("Grace NoEmail"),
    );

    await opened([issueOf({ severity: SecuritySeverity.Medium })]);

    expect(
      mails().map((mail: SentMail): string => {
        return mail.toEmail;
      }),
    ).toEqual(["alice@acme.io"]);
  });

  test("owners that cannot be looked up are logged, and the next store's owners are still told", async () => {
    ownedBy(STORE_B, userOf("Frank Owner", "frank@acme.io"));
    ownerUsersSpy.mockImplementationOnce(async () => {
      throw new Error("Postgres went away");
    });

    await opened([
      issueOf({ severity: SecuritySeverity.Medium }),
      issueOf({
        severity: SecuritySeverity.Medium,
        storeId: STORE_B,
        storeName: "billing-db",
      }),
    ]);

    expect(errorSpy).toHaveBeenCalledWith(
      `DataSecurity: could not notify the owners of store ${STORE_A.toString()}:`,
    );
    expect(
      mails().map((mail: SentMail): string => {
        return mail.toEmail;
      }),
    ).toEqual(["frank@acme.io"]);
  });

  test("an email that cannot be sent is logged, never thrown", async () => {
    ownedBy(STORE_A, userOf("Alice Owner", "alice@acme.io"));
    const failure: Error = new Error("SMTP refused the connection");
    mailSpy.mockRejectedValue(failure);

    await expect(
      opened([issueOf({ severity: SecuritySeverity.Medium })]),
    ).resolves.toBeUndefined();
    await settle();

    expect(errorSpy).toHaveBeenCalledWith(failure);
  });
});

describe("onIssuesOpened with nothing opened", () => {
  test("does nothing at all", async () => {
    setting.raiseAlertsForCriticalIssues = true;
    ownedBy(STORE_A, userOf("Alice Owner", "alice@acme.io"));

    await opened([]);

    expect(casesSpy).not.toHaveBeenCalled();
    expect(severitySpy).not.toHaveBeenCalled();
    expect(alertsSpy).not.toHaveBeenCalled();
    expect(ownerUsersSpy).not.toHaveBeenCalled();
    expect(mailSpy).not.toHaveBeenCalled();
    expect(feedSpy).not.toHaveBeenCalled();
    expect(notifiedSpy).not.toHaveBeenCalled();
  });
});

describe("getOwnerUsers", () => {
  test("reads a store's owners, and its owner teams' members who accepted, as root, at most 50", async () => {
    const alice: User = userOf("Alice Owner", "alice@acme.io");
    const bob: User = userOf("Bob Teammate", "bob@acme.io");
    const team: ObjectID = ObjectID.generate();
    ownedBy(STORE_A, alice);
    owners.teamsByStore.set(STORE_A.toString(), [team]);
    owners.membersByTeam.set(team.toString(), [
      { userId: bob.id!, accepted: true },
    ]);

    const found: Array<User> =
      await DataSecurityIntegrations.getOwnerUsers(STORE_A);

    expect(
      found
        .map((user: User): string => {
          return user.email!.toString();
        })
        .sort(),
    ).toEqual(["alice@acme.io", "bob@acme.io"]);
    expect(ownerUsersSpy.mock.calls[0]![0]).toMatchObject({
      query: { dataStoreId: STORE_A },
      select: { userId: true },
      limit: 50,
      props: { isRoot: true },
    });
    expect(
      (teamMembersSpy.mock.calls[0]![0] as { query: JSONObject }).query[
        "hasAcceptedInvitation"
      ],
    ).toBe(true);
    expect(usersSpy.mock.calls[0]![0]).toMatchObject({
      select: { _id: true, email: true, name: true },
      limit: 50,
    });
  });

  test("a person who owns a store directly and through a team is one owner", async () => {
    const alice: User = userOf("Alice Owner", "alice@acme.io");
    const team: ObjectID = ObjectID.generate();
    ownedBy(STORE_A, alice);
    owners.teamsByStore.set(STORE_A.toString(), [team]);
    owners.membersByTeam.set(team.toString(), [
      { userId: alice.id!, accepted: true },
    ]);

    await DataSecurityIntegrations.getOwnerUsers(STORE_A);

    expect(
      (
        (usersSpy.mock.calls[0]![0] as { query: JSONObject }).query[
          "_id"
        ] as Includes
      ).values,
    ).toHaveLength(1);
  });

  test("a store with no owners and no owner teams has nobody, and asks for no users", async () => {
    expect(await DataSecurityIntegrations.getOwnerUsers(STORE_A)).toEqual([]);
    expect(teamMembersSpy).not.toHaveBeenCalled();
    expect(usersSpy).not.toHaveBeenCalled();
  });
});
