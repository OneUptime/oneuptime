import AccessTokenService from "../../../../Server/Services/AccessTokenService";
import MailService from "../../../../Server/Services/MailService";
import ProjectService from "../../../../Server/Services/ProjectService";
import SecurityCaseAiActionService from "../../../../Server/Services/SecurityCaseAiActionService";
import SecurityCaseService from "../../../../Server/Services/SecurityCaseService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import SecurityCaseAiWeeklyDigest, {
  SECURITY_CASE_AI_DIGEST_PERMISSIONS,
  getSecurityCaseAiWeeklyDigestHtml,
  getSecurityCaseAiWeeklyDigestLines,
  getSecurityCaseAiWeeklyDigestSubject,
} from "../../../../Server/Utils/SecurityCase/SecurityCaseAiWeeklyDigest";
import Project from "../../../../Models/DatabaseModels/Project";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseAiAction from "../../../../Models/DatabaseModels/SecurityCaseAiAction";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import EmailTemplateType from "../../../../Types/Email/EmailTemplateType";
import { NO_BREAK_SPACE } from "../../../../Types/NoBreakSpaces";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import {
  SecurityCaseAiActionKind,
  SecurityCaseAiActionStatus,
} from "../../../../Types/SecurityCase/SecurityCaseAi";
import { SecurityCaseAiHoldOutcome } from "../../../../Types/SecurityCase/SecurityCaseAiHold";
import {
  SecurityCaseAiWeeklyDigestNumbers,
  computeSecurityCaseAiWeeklyDigest,
} from "../../../../Utils/SecurityCase/SecurityCaseAiWeeklyDigest";
import { getJestSpyOn } from "../../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * THE MONDAY EMAIL OF WHAT ONEUPTIME AI DID ON SECURITY CASES (#10353): its
 * words, who gets it - the project's Project Owners and Security Admins who
 * can read security cases, once each - and that a week OneUptime AI did
 * nothing sends nothing. Numbers only: no case's title, entity or triage
 * leaves the project's pages.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const NOW: Date = new Date("2026-11-23T08:00:00.000Z");

const EMPTY: SecurityCaseAiWeeklyDigestNumbers = {
  casesHeld: 0,
  casesResolvedWithoutPerson: 0,
  casesHandedToPeople: 0,
  casesStoppedByPerson: 0,
  casesContained: 0,
  medianTimeToContainInMinutes: null,
  blocksMade: 0,
  blocksLifted: 0,
  approvalsAsked: 0,
  approvalsAnswered: 0,
  medianApprovalWaitInMinutes: null,
  undoneByPeople: 0,
  hasActivity: false,
};

interface Member {
  id: ObjectID;
  name: string;
  email: string | null;
  permissions: Array<Permission>;
  // Not a member of the project any more: their permissions name none of it.
  isGone?: boolean;
}

function member(
  name: string,
  permissions: Array<Permission>,
  extra: Partial<Member> = {},
): Member {
  return {
    id: ObjectID.generate(),
    name,
    email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`,
    permissions,
    ...extra,
  };
}

function propsFor(person: Member): DatabaseCommonInteractionProps {
  return {
    userId: person.id,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: person.isGone
      ? {}
      : {
          [PROJECT_ID.toString()]: {
            _type: "UserTenantAccessPermission",
            projectId: PROJECT_ID,
            permissions: [Permission.ProjectUser, ...person.permissions].map(
              (permission: Permission) => {
                return { _type: "UserPermission", permission, labelIds: [] };
              },
            ),
          },
        },
  } as unknown as DatabaseCommonInteractionProps;
}

function stubMembers(members: Array<Member>): void {
  getJestSpyOn(TeamMemberService, "findBy").mockImplementation(async () => {
    return members.map((person: Member): TeamMember => {
      const row: TeamMember = new TeamMember();
      row.userId = person.id;
      const user: User = new User(person.id);
      user.name = person.name as never;

      if (person.email) {
        user.email = person.email as never;
      }

      row.user = user;
      return row;
    });
  });
  getJestSpyOn(
    AccessTokenService,
    "getDatabaseCommonInteractionPropsByUserAndProject",
  ).mockImplementation(async (args: { userId: ObjectID }) => {
    const found: Member | undefined = members.find((person: Member) => {
      return person.id.toString() === args.userId.toString();
    });

    if (!found) {
      throw new Error("no such member");
    }

    return propsFor(found);
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what the email says", () => {
  test("its subject names OneUptime AI and the week", () => {
    expect(getSecurityCaseAiWeeklyDigestSubject()).toBe(
      "What OneUptime AI did on security cases this week",
    );
  });

  test("a line for each measure with something to say, its counts held to their words", () => {
    expect(
      getSecurityCaseAiWeeklyDigestLines({
        ...EMPTY,
        casesHeld: 4,
        casesResolvedWithoutPerson: 2,
        casesHandedToPeople: 1,
        casesStoppedByPerson: 1,
        casesContained: 3,
        medianTimeToContainInMinutes: 2,
        blocksMade: 1,
        blocksLifted: 2,
        approvalsAsked: 3,
        approvalsAnswered: 2,
        medianApprovalWaitInMinutes: 1,
        undoneByPeople: 1,
        hasActivity: true,
      }),
    ).toEqual([
      `Responded first to 4${NO_BREAK_SPACE}cases: 2 resolved with nobody alerted, 1 handed to people, 1 taken or paged by a person.`,
      `Time to contain: 2${NO_BREAK_SPACE}minutes at the median, over the 3${NO_BREAK_SPACE}cases it worked that were contained.`,
      `Blocks: 1${NO_BREAK_SPACE}address blocked, 2${NO_BREAK_SPACE}blocks lifted again.`,
      `Approvals: 3${NO_BREAK_SPACE}steps asked of a person, 2 answered after 1${NO_BREAK_SPACE}minute at the median.`,
      `Undone by a person: 1${NO_BREAK_SPACE}step of OneUptime AI's.`,
    ]);
  });

  test("leaves out a measure with nothing to say, and says when no approval was answered yet", () => {
    expect(
      getSecurityCaseAiWeeklyDigestLines({
        ...EMPTY,
        approvalsAsked: 1,
        hasActivity: true,
      }),
    ).toEqual([
      `Approvals: 1${NO_BREAK_SPACE}step asked of a person, none answered yet.`,
    ]);
    expect(getSecurityCaseAiWeeklyDigestLines(EMPTY)).toEqual([]);
  });

  test("the body: the week, its lines, where every case is, and why the reader gets it - the project's name escaped", () => {
    const html: string = getSecurityCaseAiWeeklyDigestHtml({
      projectName: "<b>Acme</b>",
      digest: { ...EMPTY, blocksMade: 2, hasActivity: true },
      overviewLink: URL.fromString(
        `https://oneuptime.example.com/dashboard/${PROJECT_ID.toString()}/security-events/overview`,
      ),
    });

    expect(html).toContain("&lt;b&gt;Acme&lt;/b&gt;");
    expect(html).not.toContain("<b>Acme</b>");
    expect(html).toContain(`in the last 7${NO_BREAK_SPACE}days.`);
    expect(html).toContain(
      `&bull; Blocks: 2${NO_BREAK_SPACE}addresses blocked, 0${NO_BREAK_SPACE}blocks lifted again.`,
    );
    expect(html).toContain(
      `<a href="https://oneuptime.example.com/dashboard/${PROJECT_ID.toString()}/security-events/overview">`,
    );
    expect(html).toContain(
      "You get this email because you are a Project Owner or Security Admin of &lt;b&gt;Acme&lt;/b&gt;.",
    );
  });
});

describe("who gets it", () => {
  test("Project Owners and Security Admins: the people who answer for what OneUptime AI does on cases", () => {
    expect(SECURITY_CASE_AI_DIGEST_PERMISSIONS).toEqual([
      Permission.ProjectOwner,
      Permission.SecurityAdmin,
    ]);
  });

  test("each member who holds one and can read security cases, once - nobody else", async () => {
    const owner: Member = member("Olivia Owner", [Permission.ProjectOwner]);
    const securityAdmin: Member = member("Sam Admin", [
      Permission.SecurityAdmin,
    ]);
    const projectAdmin: Member = member("Pat Admin", [Permission.ProjectAdmin]);
    const analyst: Member = member("Ana Analyst", [Permission.SecurityMember]);
    const developer: Member = member("Dev Eloper", [Permission.ProjectMember]);
    const gone: Member = member("Gail Gone", [Permission.ProjectOwner], {
      isGone: true,
    });
    const noEmail: Member = member("Nora Nomail", [Permission.ProjectOwner], {
      email: null,
    });

    // The owner twice: a member of two teams.
    stubMembers([
      owner,
      securityAdmin,
      projectAdmin,
      analyst,
      developer,
      gone,
      noEmail,
      owner,
    ]);

    const recipients: Array<User> =
      await SecurityCaseAiWeeklyDigest.whoGetsIt(PROJECT_ID);

    expect(
      recipients.map((user: User): string => {
        return String(user.email);
      }),
    ).toEqual([String(owner.email), String(securityAdmin.email)]);
  });

  test("a member whose permissions cannot be read is left out, and the others still get it", async () => {
    const owner: Member = member("Olivia Owner", [Permission.ProjectOwner]);
    const broken: Member = member("Bea Broken", [Permission.ProjectOwner]);

    stubMembers([broken, owner]);
    getJestSpyOn(
      AccessTokenService,
      "getDatabaseCommonInteractionPropsByUserAndProject",
    ).mockImplementation(async (args: { userId: ObjectID }) => {
      if (args.userId.toString() === broken.id.toString()) {
        throw new Error("could not read");
      }

      return propsFor(owner);
    });

    expect(
      (await SecurityCaseAiWeeklyDigest.whoGetsIt(PROJECT_ID)).map(
        (user: User): string => {
          return String(user.email);
        },
      ),
    ).toEqual([String(owner.email)]);
  });
});

describe("sending a project's email", () => {
  function stubWeek(data: {
    heldCases?: Array<SecurityCase>;
    actions?: Array<SecurityCaseAiAction>;
  }): void {
    getJestSpyOn(SecurityCaseService, "findBy").mockImplementation(
      async (args: { query: Record<string, unknown> }) => {
        return "aiHoldEndedAt" in args.query ? data.heldCases || [] : [];
      },
    );
    getJestSpyOn(SecurityCaseAiActionService, "findBy").mockResolvedValue(
      data.actions || [],
    );
    getJestSpyOn(ProjectService, "findOneById").mockImplementation(async () => {
      const project: Project = new Project(PROJECT_ID);
      project.name = "Acme";
      return project;
    });
    getJestSpyOn(DatabaseConfig, "getDashboardUrl").mockResolvedValue(
      URL.fromString("https://oneuptime.example.com/dashboard"),
    );
  }

  function heldCase(outcome: SecurityCaseAiHoldOutcome): SecurityCase {
    const row: SecurityCase = new SecurityCase(ObjectID.generate());
    row.createdAt = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000);
    row.aiHoldOutcome = outcome;
    row.aiHoldEndedAt = new Date(row.createdAt.getTime() + 2 * 60 * 1000);
    return row;
  }

  test("a week OneUptime AI did nothing sends nothing, and reads nobody", async () => {
    stubWeek({});
    const members: jest.Mock = getJestSpyOn(
      TeamMemberService,
      "findBy",
    ) as unknown as jest.Mock;
    const sent: jest.Mock = getJestSpyOn(
      MailService,
      "sendMail",
    ).mockResolvedValue(undefined as never) as unknown as jest.Mock;

    expect(
      await SecurityCaseAiWeeklyDigest.sendForProject({
        projectId: PROJECT_ID,
        now: NOW,
      }),
    ).toBe(0);
    expect(sent).not.toHaveBeenCalled();
    expect(members).not.toHaveBeenCalled();
  });

  test("one email to each owner, the project's numbers in the owner email's plain message", async () => {
    const owner: Member = member("Olivia Owner", [Permission.ProjectOwner]);
    const securityAdmin: Member = member("Sam Admin", [
      Permission.SecurityAdmin,
    ]);

    stubWeek({
      heldCases: [
        heldCase(SecurityCaseAiHoldOutcome.Resolved),
        heldCase(SecurityCaseAiHoldOutcome.NeedsApproval),
      ],
    });
    stubMembers([owner, securityAdmin]);

    const sent: Array<{ toEmail: string; vars: Record<string, string> }> = [];

    getJestSpyOn(MailService, "sendMail").mockImplementation(
      async (mail: unknown) => {
        const message: {
          toEmail: unknown;
          templateType: EmailTemplateType;
          subject: string;
          isSubjectLiteral: boolean;
          vars: Record<string, string>;
        } = mail as never;

        expect(message.templateType).toBe(EmailTemplateType.SimpleMessage);
        expect(message.subject).toBe(
          "What OneUptime AI did on security cases this week",
        );
        expect(message.isSubjectLiteral).toBe(true);
        sent.push({ toEmail: String(message.toEmail), vars: message.vars });
      },
    );

    expect(
      await SecurityCaseAiWeeklyDigest.sendForProject({
        projectId: PROJECT_ID,
        now: NOW,
      }),
    ).toBe(2);
    expect(
      sent.map((mail: { toEmail: string }): string => {
        return mail.toEmail;
      }),
    ).toEqual([String(owner.email), String(securityAdmin.email)]);

    const expectedLines: Array<string> = getSecurityCaseAiWeeklyDigestLines(
      computeSecurityCaseAiWeeklyDigest({
        cases: [
          {
            createdAt: new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000),
            containedAt: null,
            aiTookCaseAt: null,
            aiHoldOutcome: SecurityCaseAiHoldOutcome.Resolved,
            aiHoldEndedAt: new Date(
              NOW.getTime() - 2 * 24 * 60 * 60 * 1000 + 2 * 60 * 1000,
            ),
          },
          {
            createdAt: new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000),
            containedAt: null,
            aiTookCaseAt: null,
            aiHoldOutcome: SecurityCaseAiHoldOutcome.NeedsApproval,
            aiHoldEndedAt: new Date(
              NOW.getTime() - 2 * 24 * 60 * 60 * 1000 + 2 * 60 * 1000,
            ),
          },
        ],
        actions: [],
        weekStart: new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000),
        weekEnd: NOW,
      }),
    );

    expect(expectedLines[0]).toBe(
      `Responded first to 2${NO_BREAK_SPACE}cases: 1 resolved with nobody alerted, 1 handed to people, 0 taken or paged by a person.`,
    );
    expect(sent[0]!.vars["message"]).toContain(`&bull; ${expectedLines[0]}`);
    expect(sent[0]!.vars["message"]).toContain(
      `https://oneuptime.example.com/dashboard/${PROJECT_ID.toString()}/security-events/overview`,
    );
  });

  test("a project with nobody to tell sends nothing", async () => {
    stubWeek({ heldCases: [heldCase(SecurityCaseAiHoldOutcome.Resolved)] });
    stubMembers([member("Ana Analyst", [Permission.SecurityMember])]);
    const sent: jest.Mock = getJestSpyOn(
      MailService,
      "sendMail",
    ).mockResolvedValue(undefined as never) as unknown as jest.Mock;

    expect(
      await SecurityCaseAiWeeklyDigest.sendForProject({
        projectId: PROJECT_ID,
        now: NOW,
      }),
    ).toBe(0);
    expect(sent).not.toHaveBeenCalled();
  });

  test("one email that fails is nobody else's: the others still go", async () => {
    const owner: Member = member("Olivia Owner", [Permission.ProjectOwner]);
    const securityAdmin: Member = member("Sam Admin", [
      Permission.SecurityAdmin,
    ]);
    const done: SecurityCaseAiAction = new SecurityCaseAiAction();
    done.kind = SecurityCaseAiActionKind.BlockAddress;
    done.status = SecurityCaseAiActionStatus.Done;
    done.doneAt = new Date(NOW.getTime() - 60 * 60 * 1000);

    stubWeek({ actions: [done] });
    stubMembers([owner, securityAdmin]);

    const delivered: Array<string> = [];

    getJestSpyOn(MailService, "sendMail").mockImplementation(
      async (mail: unknown) => {
        const to: string = String((mail as { toEmail: unknown }).toEmail);

        if (to === String(owner.email)) {
          throw new Error("SMTP refused");
        }

        delivered.push(to);
      },
    );

    expect(
      await SecurityCaseAiWeeklyDigest.sendForProject({
        projectId: PROJECT_ID,
        now: NOW,
      }),
    ).toBe(1);
    expect(delivered).toEqual([String(securityAdmin.email)]);
  });
});

describe("every project's email", () => {
  test("goes to each project OneUptime AI did something in, once, and one that fails stops no other", async () => {
    const otherProjectId: ObjectID = ObjectID.generate();
    const failingProjectId: ObjectID = ObjectID.generate();

    getJestSpyOn(SecurityCaseAiActionService, "findAllBy").mockImplementation(
      async () => {
        return [PROJECT_ID, failingProjectId, PROJECT_ID].map(
          (projectId: ObjectID): SecurityCaseAiAction => {
            const row: SecurityCaseAiAction = new SecurityCaseAiAction();
            row.projectId = projectId;
            return row;
          },
        );
      },
    );
    getJestSpyOn(SecurityCaseService, "findAllBy").mockImplementation(
      async () => {
        const row: SecurityCase = new SecurityCase();
        row.projectId = otherProjectId;
        return [row];
      },
    );

    const projectsSent: Array<string> = [];

    getJestSpyOn(
      SecurityCaseAiWeeklyDigest,
      "sendForProject",
    ).mockImplementation(async (data: { projectId: ObjectID; now: Date }) => {
      if (data.projectId.toString() === failingProjectId.toString()) {
        throw new Error("could not read the week");
      }

      expect(data.now).toBe(NOW);
      projectsSent.push(data.projectId.toString());
      return 2;
    });

    expect(await SecurityCaseAiWeeklyDigest.sendAll(NOW)).toBe(4);
    expect(projectsSent.sort()).toEqual(
      [PROJECT_ID.toString(), otherProjectId.toString()].sort(),
    );
  });
});
