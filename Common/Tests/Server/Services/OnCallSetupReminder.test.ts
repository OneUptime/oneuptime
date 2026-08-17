import DatabaseConfig from "../../../Server/DatabaseConfig";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import MailService from "../../../Server/Services/MailService";
import OnCallReadinessService, {
  ReadinessCoverageCell,
  ReadinessStatus,
  ResponderSource,
  UserReadiness,
} from "../../../Server/Services/OnCallReadinessService";
import OnCallSetupReminderService, {
  OnCallSetupReminderService as OnCallSetupReminderServiceClass,
  SetupReminderOutcome,
  SetupReminderResult,
  SetupReminderUserResult,
  SETUP_REMINDER_MAX_RECIPIENTS,
} from "../../../Server/Services/OnCallSetupReminderService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import logger from "../../../Server/Utils/Logger";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Protocol from "../../../Types/API/Protocol";
import URL from "../../../Types/API/URL";
import Hostname from "../../../Types/API/Hostname";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../../Types/ObjectID";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The setup reminder: the one action in the on-call readiness feature that
 * leaves the product and lands in somebody's inbox.
 *
 * Its first cut was a button wired to a function that threw, which is why the
 * bar for this file is not "does it call MailService". The failure modes that
 * matter are all failures of HONESTY or of RESTRAINT, and each section below
 * pins one of them:
 *
 *   (A) NEVER TRUST THE BODY. User is a global model, so a user id posted by a
 *       member of project A is a perfectly valid id in project B. Without a
 *       membership re-check inside the sending service, this endpoint mails
 *       strangers about a project they have never heard of - with that
 *       project's name in the message.
 *
 *   (B) NEVER CLAIM MORE THAN IS TRUE. A Ready responder gets no mail, because
 *       a mail telling somebody they are missing something they are not missing
 *       is a claim they can disprove in ten seconds - and the next mail from
 *       this sender might be a page. Likewise the "you are on an on-call
 *       rotation" sentence appears only for a responder some policy actually
 *       reaches.
 *
 *   (C) NEVER REPORT SENT FOR A MAIL THAT DID NOT GO. MailService goes through
 *       API.post, which RESOLVES with an error response for a non-200 rather
 *       than throwing. A try/catch on its own therefore reports success for
 *       every mail the notification service refuses, which is the exact green
 *       tick over nothing this whole phase exists to remove.
 *
 *   (D) THE THROTTLE IS A LOCK, NOT A NOTE. It is claimed atomically before the
 *       send (a check-then-send lets two concurrent clicks both send), and it
 *       is RELEASED when the send fails (or an SMTP blip silences a responder
 *       for a day).
 *
 *   (E) THE ESCAPING. SimpleMessage.hbs renders the message body through a
 *       triple stache, so the escaping in this service is the only escaping
 *       there is between an admin-typed project name and a recipient's inbox.
 *
 * Nothing here touches a database, a cache or a mail server: every collaborator
 * is a jest.spyOn. What is under test is this service's own decision-making.
 *
 * Each test builds its own service instance rather than using the module
 * singleton, because the 24h throttle is in-process state and a singleton
 * carries one test's claims into the next. The singleton is asserted to be an
 * instance of the same class at the end, so nothing here is testing a different
 * object from the one the API mounts.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "1e1e1e1e-1e1e-4e1e-8e1e-1e1e1e1e1e1e",
);
const USER_A: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const USER_B: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const USER_C: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const SEVERITY_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const DASHBOARD_URL: URL = new URL(
  Protocol.HTTPS,
  new Hostname("oneuptime.example.com"),
);

interface SentMail {
  toEmail: string;
  subject: string;
  message: string;
  templateType: string;
  options: {
    projectId?: ObjectID | undefined;
    userId?: ObjectID | undefined;
  };
}

let readinessSpy: jest.SpyInstance;
let projectSpy: jest.SpyInstance;
let teamMemberSpy: jest.SpyInstance;
let dashboardUrlSpy: jest.SpyInstance;
let mailSpy: jest.SpyInstance;
let cacheClaimSpy: jest.SpyInstance;
let cacheReleaseSpy: jest.SpyInstance;

function buildCoverage(data: {
  ruleType: NotificationRuleType;
  hasRule: boolean;
}): ReadinessCoverageCell {
  return {
    ruleType: data.ruleType,
    severityId: SEVERITY_ID,
    severityName: "Sev1",
    hasRule: data.hasRule,
    isOptOut: false,
  };
}

function buildReadiness(data: {
  userId: ObjectID;
  status?: ReadinessStatus | undefined;
  email?: string | undefined;
  reasons?: Array<string> | undefined;
  reachedVia?: Array<ResponderSource> | undefined;
  coverage?: Array<ReadinessCoverageCell> | undefined;
}): UserReadiness {
  return {
    userId: data.userId,
    userName: "Jane Responder",
    userEmail: data.email === undefined ? "jane@example.com" : data.email,
    status: data.status || ReadinessStatus.NotReachable,
    methods: [],
    coverage: data.coverage || [],
    reasons:
      data.reasons === undefined
        ? ["No verified notification method - cannot be paged"]
        : data.reasons,
    reachedVia:
      data.reachedVia === undefined
        ? [ResponderSource.Direct]
        : data.reachedVia,
    teams: [],
  };
}

/** A fresh service, with an empty in-process throttle. */
function newService(): OnCallSetupReminderServiceClass {
  return new OnCallSetupReminderServiceClass();
}

function sentMails(): Array<SentMail> {
  return mailSpy.mock.calls.map((args: Array<unknown>): SentMail => {
    const mail: {
      toEmail: { toString: () => string };
      subject: string;
      templateType: string;
      vars: Record<string, string>;
    } = args[0] as never;

    return {
      toEmail: mail.toEmail.toString(),
      subject: mail.subject,
      message: mail.vars["message"] || "",
      templateType: mail.templateType,
      options: (args[1] || {}) as SentMail["options"],
    };
  });
}

function onlyMail(): SentMail {
  const mails: Array<SentMail> = sentMails();

  if (mails.length !== 1) {
    throw new Error(`Expected exactly one mail, saw ${mails.length}`);
  }

  return mails[0]!;
}

/*
 * One case per severity-scoped rule type: the settings tab a gap of that type
 * should link to. All four are covered because sending somebody to the wrong tab
 * produces a screen with nothing wrong on it, which reads as a false alarm - and
 * the mapping is four near-identical lines of the kind that get copy-pasted with
 * one value left unchanged.
 */
interface GapLinkCase {
  ruleType: NotificationRuleType;
  path: string;
}

const GAP_LINK_CASES: Array<GapLinkCase> = [
  {
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    path: "incident-on-call-rules",
  },
  {
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
    path: "incident-episode-on-call-rules",
  },
  {
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
    path: "alert-on-call-rules",
  },
  {
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
    path: "alert-episode-on-call-rules",
  },
];

/*
 * Declared out here rather than inline in the loop that calls it: a test body
 * closing over a loop variable AND over the mutable `readinessSpy` is the shape
 * `no-loop-func` exists to catch, and the lint rule is right that it is easy to
 * get subtly wrong.
 */
function registerGapLinkTest(gapCase: GapLinkCase): void {
  test(`a ${gapCase.ruleType} gap links to ${gapCase.path}`, async () => {
    readinessSpy.mockResolvedValue([
      buildReadiness({
        userId: USER_A,
        status: ReadinessStatus.PartiallyReady,
        coverage: [
          buildCoverage({ ruleType: gapCase.ruleType, hasRule: false }),
        ],
      }),
    ] as never);

    await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    expect(onlyMail().message).toContain(
      `/${PROJECT_ID.toString()}/user-settings/${gapCase.path}`,
    );
  });
}

function outcomeFor(
  result: SetupReminderResult,
  userId: ObjectID,
): SetupReminderOutcome {
  const found: SetupReminderUserResult | undefined = result.results.find(
    (one: SetupReminderUserResult): boolean => {
      return one.userId.toString() === userId.toString();
    },
  );

  if (!found) {
    throw new Error(`No result was returned for user ${userId.toString()}`);
  }

  return found.outcome;
}

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();

  jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest.spyOn(logger, "warn").mockImplementation((): void => {});
  jest.spyOn(logger, "debug").mockImplementation((): void => {});

  projectSpy = jest
    .spyOn(ProjectService, "findOneById")
    .mockResolvedValue({ id: PROJECT_ID, name: "Acme Payments" } as never);

  readinessSpy = jest
    .spyOn(OnCallReadinessService, "getReadinessForUsers")
    .mockResolvedValue([buildReadiness({ userId: USER_A })] as never);

  teamMemberSpy = jest
    .spyOn(TeamMemberService, "findBy")
    .mockResolvedValue([] as never);

  dashboardUrlSpy = jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(DASHBOARD_URL as never);

  mailSpy = jest
    .spyOn(MailService, "sendMail")
    .mockResolvedValue(new HTTPResponse(200, {}, {}) as never);

  cacheClaimSpy = jest
    .spyOn(GlobalCache, "setStringIfNotExists")
    .mockResolvedValue(true as never);

  cacheReleaseSpy = jest
    .spyOn(GlobalCache, "deleteKeyIfValue")
    .mockResolvedValue(true as never);
});

describe("OnCallSetupReminderService - (A) never trust the body", () => {
  test("a user id that is not a member of the project is skipped and never mailed", async () => {
    /*
     * The readiness read omits non-members, and the follow-up membership read
     * confirms there are no rows for them at all.
     */
    readinessSpy.mockResolvedValue([] as never);
    teamMemberSpy.mockResolvedValue([] as never);

    const result: SetupReminderResult = await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    expect(outcomeFor(result, USER_A)).toBe(
      SetupReminderOutcome.SkippedNotAMember,
    );
    expect(mailSpy).not.toHaveBeenCalled();
    expect(result.sentCount).toBe(0);
    expect(result.skippedCount).toBe(1);
  });

  test("the membership re-check is scoped to the caller's project and reads as root", async () => {
    readinessSpy.mockResolvedValue([] as never);

    await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    const call: {
      query: Record<string, unknown>;
      props: { isRoot?: boolean | undefined };
    } = teamMemberSpy.mock.calls[0]![0] as never;

    expect(call.query["projectId"]).toBe(PROJECT_ID);
    expect(call.props.isRoot).toBe(true);
  });

  test("the readiness read is scoped to the caller's project, not to anything in the request body", async () => {
    await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    expect(readinessSpy).toHaveBeenCalledWith([USER_A], PROJECT_ID);
  });

  test("a member the readiness read could not answer for is reported as failed, not as a stranger", async () => {
    /*
     * "Not in this project" and "we could not work out what they are missing"
     * need two different sentences: the first is a list an admin should fix,
     * the second is a bug they should report.
     */
    readinessSpy.mockResolvedValue([] as never);
    teamMemberSpy.mockResolvedValue([{ _id: "tm-1", userId: USER_A }] as never);

    const result: SetupReminderResult = await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    expect(outcomeFor(result, USER_A)).toBe(SetupReminderOutcome.Failed);
    expect(result.failedCount).toBe(1);
    expect(mailSpy).not.toHaveBeenCalled();
  });

  test("no membership query is issued when readiness answered for everybody", async () => {
    // The common case must not pay for the disambiguation of a rare one.
    await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    expect(teamMemberSpy).not.toHaveBeenCalled();
  });
});

describe("OnCallSetupReminderService - (B) never claim more than is true", () => {
  test("a Ready responder is skipped rather than nagged", async () => {
    readinessSpy.mockResolvedValue([
      buildReadiness({
        userId: USER_A,
        status: ReadinessStatus.Ready,
        reasons: [],
      }),
    ] as never);

    const result: SetupReminderResult = await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    expect(outcomeFor(result, USER_A)).toBe(
      SetupReminderOutcome.SkippedNothingMissing,
    );
    expect(mailSpy).not.toHaveBeenCalled();
  });

  test("a Ready responder does not consume their 24h window either", async () => {
    /*
     * The claim must come after the "is there anything to say" decision.
     * Burning the window on a mail that was never going to be sent would
     * silence a responder who becomes genuinely unreachable an hour later.
     */
    readinessSpy.mockResolvedValue([
      buildReadiness({ userId: USER_A, status: ReadinessStatus.Ready }),
    ] as never);

    await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    expect(cacheClaimSpy).not.toHaveBeenCalled();
  });

  test("the mail says they are on a rotation only when a policy actually reaches them", async () => {
    readinessSpy.mockResolvedValue([
      buildReadiness({ userId: USER_A, reachedVia: [ResponderSource.Team] }),
    ] as never);

    await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    expect(onlyMail().message).toContain("You are on an on-call rotation");
  });

  test("a responder on no policy is not told they are on one", async () => {
    readinessSpy.mockResolvedValue([
      buildReadiness({ userId: USER_A, reachedVia: [] }),
    ] as never);

    await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    const message: string = onlyMail().message;

    expect(message).not.toContain("You are on an on-call rotation");
    expect(message).toContain("can be added to an on-call rotation");
  });

  test("the mail names the real gap, using the readiness service's own words", async () => {
    readinessSpy.mockResolvedValue([
      buildReadiness({
        userId: USER_A,
        status: ReadinessStatus.PartiallyReady,
        reasons: [
          "No rules for Sev1, Sev2 incidents - pages fall back to Email, Push",
        ],
        coverage: [
          buildCoverage({
            ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
            hasRule: false,
          }),
        ],
      }),
    ] as never);

    await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    expect(onlyMail().message).toContain(
      "No rules for Sev1, Sev2 incidents - pages fall back to Email, Push",
    );
  });

  test("an unreachable responder gets the urgent subject; a partially ready one does not", async () => {
    readinessSpy.mockResolvedValue([
      buildReadiness({ userId: USER_A, status: ReadinessStatus.NotReachable }),
    ] as never);

    await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    expect(onlyMail().subject).toBe(
      "Action needed: nothing can page you in Acme Payments",
    );

    mailSpy.mockClear();

    readinessSpy.mockResolvedValue([
      buildReadiness({
        userId: USER_A,
        status: ReadinessStatus.PartiallyReady,
      }),
    ] as never);

    await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    expect(onlyMail().subject).toBe(
      "Finish your on-call notification setup in Acme Payments",
    );
  });

  test("the mail goes to the responder's own account email, tagged with project and user", async () => {
    readinessSpy.mockResolvedValue([
      buildReadiness({ userId: USER_A, email: "jane@example.com" }),
    ] as never);

    await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    const mail: SentMail = onlyMail();

    expect(mail.toEmail).toBe("jane@example.com");
    expect(mail.options.projectId).toBe(PROJECT_ID);
    expect(mail.options.userId).toBe(USER_A);
  });
});

describe("OnCallSetupReminderService - the deep link points at the broken thing", () => {
  test("an unreachable responder is sent to notification methods", async () => {
    readinessSpy.mockResolvedValue([
      buildReadiness({
        userId: USER_A,
        status: ReadinessStatus.NotReachable,
        /*
         * A coverage gap is present and must NOT win: with no verified method,
         * adding a rule changes nothing.
         */
        coverage: [
          buildCoverage({
            ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
            hasRule: false,
          }),
        ],
      }),
    ] as never);

    await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    expect(onlyMail().message).toContain(
      `/${PROJECT_ID.toString()}/user-settings/notification-methods`,
    );
  });

  for (const gapCase of GAP_LINK_CASES) {
    registerGapLinkTest(gapCase);
  }

  test("a covered cell is not mistaken for a gap", async () => {
    readinessSpy.mockResolvedValue([
      buildReadiness({
        userId: USER_A,
        status: ReadinessStatus.PartiallyReady,
        coverage: [
          buildCoverage({
            ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
            hasRule: true,
          }),
          buildCoverage({
            ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
            hasRule: false,
          }),
        ],
      }),
    ] as never);

    await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    expect(onlyMail().message).toContain(
      `/${PROJECT_ID.toString()}/user-settings/alert-on-call-rules`,
    );
  });

  test("a muted cell is not a gap either", async () => {
    readinessSpy.mockResolvedValue([
      buildReadiness({
        userId: USER_A,
        status: ReadinessStatus.PartiallyReady,
        coverage: [
          {
            ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
            severityId: SEVERITY_ID,
            severityName: "Sev4",
            hasRule: false,
            isOptOut: true,
          },
          buildCoverage({
            ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
            hasRule: false,
          }),
        ],
      }),
    ] as never);

    await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    expect(onlyMail().message).toContain(
      `/${PROJECT_ID.toString()}/user-settings/alert-episode-on-call-rules`,
    );
  });
});

describe("OnCallSetupReminderService - (E) escaping", () => {
  test("an admin-typed project name cannot inject markup into the message body", async () => {
    projectSpy.mockResolvedValue({
      id: PROJECT_ID,
      name: '<script>alert("x")</script> & Co',
    } as never);

    await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    const message: string = onlyMail().message;

    expect(message).not.toContain("<script>");
    expect(message).toContain("&lt;script&gt;");
    expect(message).toContain("&amp; Co");
  });

  test("a reason sentence carrying a crafted severity name is escaped too", async () => {
    readinessSpy.mockResolvedValue([
      buildReadiness({
        userId: USER_A,
        reasons: ['No rules for <img src=x onerror="steal()"> incidents'],
      }),
    ] as never);

    await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    const message: string = onlyMail().message;

    expect(message).not.toContain("<img src=x");
    expect(message).toContain("&lt;img src=x");
    expect(message).toContain("&quot;steal()&quot;");
  });

  test("the subject is NOT escaped - Handlebars escapes it, and the SMTP header must stay raw", async () => {
    projectSpy.mockResolvedValue({
      id: PROJECT_ID,
      name: "Bob's & Co",
    } as never);

    await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    expect(onlyMail().subject).toContain("Bob's & Co");
    expect(onlyMail().subject).not.toContain("&amp;");
  });

  test("the structural markup this service writes itself survives", async () => {
    readinessSpy.mockResolvedValue([
      buildReadiness({
        userId: USER_A,
        reasons: ["No verified notification method - cannot be paged"],
      }),
    ] as never);

    await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    const message: string = onlyMail().message;

    expect(message).toContain("<ul>");
    expect(message).toContain(
      "<li>No verified notification method - cannot be paged</li>",
    );
    expect(message).toContain("<a href=");
  });

  test("a long reason list is summarised rather than printed in full", async () => {
    const manyReasons: Array<string> = [];

    for (let index: number = 0; index < 10; index++) {
      manyReasons.push(`Reason number ${index}`);
    }

    readinessSpy.mockResolvedValue([
      buildReadiness({ userId: USER_A, reasons: manyReasons }),
    ] as never);

    await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    const message: string = onlyMail().message;

    expect(message).toContain("Reason number 5");
    expect(message).not.toContain("Reason number 6");
    expect(message).toContain("and 4 more, listed in your settings");
  });

  test("a status with no reasons still produces a message with a link", async () => {
    readinessSpy.mockResolvedValue([
      buildReadiness({ userId: USER_A, reasons: [] }),
    ] as never);

    await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    const message: string = onlyMail().message;

    expect(message).not.toContain("<ul>");
    expect(message).toContain("Open your settings to see what is missing");
    expect(message).toContain("<a href=");
  });
});

describe("OnCallSetupReminderService - (D) the throttle is a lock", () => {
  test("the window is claimed BEFORE the send, atomically, for 24 hours", async () => {
    await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    expect(cacheClaimSpy).toHaveBeenCalledTimes(1);

    const args: Array<unknown> = cacheClaimSpy.mock.calls[0]!;

    expect(args[1]).toBe(`${PROJECT_ID.toString()}:${USER_A.toString()}`);
    expect(args[3]).toEqual({ expiresInSeconds: 24 * 60 * 60 });

    // Claim first, then send - not the other way round.
    expect(cacheClaimSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      mailSpy.mock.invocationCallOrder[0]!,
    );
  });

  test("a second reminder for the same responder in the same process is skipped without a round trip", async () => {
    const service: OnCallSetupReminderServiceClass = newService();

    await service.sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    cacheClaimSpy.mockClear();

    const second: SetupReminderResult = await service.sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    expect(outcomeFor(second, USER_A)).toBe(
      SetupReminderOutcome.SkippedThrottled,
    );
    expect(mailSpy).toHaveBeenCalledTimes(1);
    expect(cacheClaimSpy).not.toHaveBeenCalled();
  });

  test("a window already held by another pod skips the send", async () => {
    cacheClaimSpy.mockResolvedValue(false as never);

    const result: SetupReminderResult = await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    expect(outcomeFor(result, USER_A)).toBe(
      SetupReminderOutcome.SkippedThrottled,
    );
    expect(mailSpy).not.toHaveBeenCalled();
  });

  test("a window held elsewhere is remembered locally, so the next click costs no round trip", async () => {
    const service: OnCallSetupReminderServiceClass = newService();

    cacheClaimSpy.mockResolvedValue(false as never);

    await service.sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    cacheClaimSpy.mockClear();

    await service.sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    expect(cacheClaimSpy).not.toHaveBeenCalled();
  });

  test("two different responders do not share a window", async () => {
    readinessSpy.mockResolvedValue([
      buildReadiness({ userId: USER_A }),
      buildReadiness({ userId: USER_B }),
    ] as never);

    const result: SetupReminderResult = await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A, USER_B],
    });

    expect(result.sentCount).toBe(2);
    expect(mailSpy).toHaveBeenCalledTimes(2);
  });

  test("the same responder in two different projects does not share a window", async () => {
    const service: OnCallSetupReminderServiceClass = newService();

    await service.sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    const second: SetupReminderResult = await service.sendSetupReminders({
      projectId: OTHER_PROJECT_ID,
      userIds: [USER_A],
    });

    expect(outcomeFor(second, USER_A)).toBe(SetupReminderOutcome.Sent);
    expect(mailSpy).toHaveBeenCalledTimes(2);
  });

  test("a failed send gives the window back, using its own token", async () => {
    mailSpy.mockRejectedValue(new Error("smtp is down") as never);

    const result: SetupReminderResult = await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    expect(outcomeFor(result, USER_A)).toBe(SetupReminderOutcome.Failed);
    expect(cacheReleaseSpy).toHaveBeenCalledTimes(1);

    const claimArgs: Array<unknown> = cacheClaimSpy.mock.calls[0]!;
    const releaseArgs: Array<unknown> = cacheReleaseSpy.mock.calls[0]!;

    /*
     * Same namespace, same key, and crucially the SAME token: a release must
     * never be able to delete a claim somebody else is holding.
     */
    expect(releaseArgs[0]).toBe(claimArgs[0]);
    expect(releaseArgs[1]).toBe(claimArgs[1]);
    expect(releaseArgs[2]).toBe(claimArgs[2]);
  });

  test("a released window can be claimed again by the very next request", async () => {
    const service: OnCallSetupReminderServiceClass = newService();

    mailSpy.mockRejectedValueOnce(new Error("smtp blip") as never);

    await service.sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    const second: SetupReminderResult = await service.sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    expect(outcomeFor(second, USER_A)).toBe(SetupReminderOutcome.Sent);
  });

  test("a successful send never releases the window", async () => {
    await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    expect(cacheReleaseSpy).not.toHaveBeenCalled();
  });

  test("an unreachable cache fails OPEN - the reminder still goes, with a warning", async () => {
    cacheClaimSpy.mockRejectedValue(
      new Error("cache is not connected") as never,
    );

    const result: SetupReminderResult = await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    expect(outcomeFor(result, USER_A)).toBe(SetupReminderOutcome.Sent);
    expect(mailSpy).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalled();
  });

  test("with the cache down, the in-process throttle still stops a repeat click", async () => {
    const service: OnCallSetupReminderServiceClass = newService();

    cacheClaimSpy.mockRejectedValue(
      new Error("cache is not connected") as never,
    );

    await service.sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    const second: SetupReminderResult = await service.sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    expect(outcomeFor(second, USER_A)).toBe(
      SetupReminderOutcome.SkippedThrottled,
    );
    expect(mailSpy).toHaveBeenCalledTimes(1);
  });

  test("a release that cannot reach the cache does not turn a failed send into a thrown request", async () => {
    mailSpy.mockRejectedValue(new Error("smtp is down") as never);
    cacheReleaseSpy.mockRejectedValue(
      new Error("cache is not connected") as never,
    );

    const result: SetupReminderResult = await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    expect(outcomeFor(result, USER_A)).toBe(SetupReminderOutcome.Failed);
  });
});

describe("OnCallSetupReminderService - (C) never report sent for a mail that did not go", () => {
  test("a non-200 answer from the notification service is reported as failed", async () => {
    /*
     * The highest-value assertion in this file. MailService goes through
     * API.post, which RESOLVES with an error response rather than throwing, so
     * a bare try/catch would call this a success.
     */
    mailSpy.mockResolvedValue(
      new HTTPResponse(500, { message: "smtp refused" }, {}) as never,
    );

    const result: SetupReminderResult = await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    expect(outcomeFor(result, USER_A)).toBe(SetupReminderOutcome.Failed);
    expect(result.sentCount).toBe(0);
    expect(result.failedCount).toBe(1);
  });

  test("a non-200 answer also gives the throttle window back", async () => {
    mailSpy.mockResolvedValue(new HTTPResponse(502, {}, {}) as never);

    await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    expect(cacheReleaseSpy).toHaveBeenCalledTimes(1);
  });

  test("a thrown send is reported as failed", async () => {
    mailSpy.mockRejectedValue(new Error("connect ECONNREFUSED") as never);

    const result: SetupReminderResult = await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    expect(outcomeFor(result, USER_A)).toBe(SetupReminderOutcome.Failed);
  });

  test("the failure message given to the admin is prose, not a stack trace", async () => {
    mailSpy.mockRejectedValue(
      new Error("connect ECONNREFUSED 10.0.0.4:587") as never,
    );

    const result: SetupReminderResult = await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    const message: string = result.results[0]!.message;

    expect(message).not.toContain("ECONNREFUSED");
    expect(message).toContain("Nothing was delivered");
  });

  test("a responder with no usable account email is failed, not silently dropped", async () => {
    readinessSpy.mockResolvedValue([
      buildReadiness({ userId: USER_A, email: "" }),
    ] as never);

    const result: SetupReminderResult = await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    expect(outcomeFor(result, USER_A)).toBe(SetupReminderOutcome.Failed);
    expect(mailSpy).not.toHaveBeenCalled();
    // And it does not burn a window it was never going to use.
    expect(cacheClaimSpy).not.toHaveBeenCalled();
  });

  test("a malformed account email is failed rather than thrown for", async () => {
    readinessSpy.mockResolvedValue([
      buildReadiness({ userId: USER_A, email: "not-an-email" }),
    ] as never);

    const result: SetupReminderResult = await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    expect(outcomeFor(result, USER_A)).toBe(SetupReminderOutcome.Failed);
    expect(mailSpy).not.toHaveBeenCalled();
  });
});

describe("OnCallSetupReminderService - the batch answer is per user", () => {
  test("one bad recipient does not cancel the rest of the batch", async () => {
    readinessSpy.mockResolvedValue([
      buildReadiness({ userId: USER_A }),
      buildReadiness({ userId: USER_B, email: "" }),
      buildReadiness({
        userId: USER_C,
        status: ReadinessStatus.PartiallyReady,
      }),
    ] as never);

    const result: SetupReminderResult = await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A, USER_B, USER_C],
    });

    expect(outcomeFor(result, USER_A)).toBe(SetupReminderOutcome.Sent);
    expect(outcomeFor(result, USER_B)).toBe(SetupReminderOutcome.Failed);
    expect(outcomeFor(result, USER_C)).toBe(SetupReminderOutcome.Sent);
    expect(mailSpy).toHaveBeenCalledTimes(2);
  });

  test("the counts add up and describe the whole request", async () => {
    readinessSpy.mockResolvedValue([
      buildReadiness({ userId: USER_A }),
      buildReadiness({
        userId: USER_B,
        status: ReadinessStatus.Ready,
      }),
    ] as never);
    teamMemberSpy.mockResolvedValue([] as never);

    const result: SetupReminderResult = await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A, USER_B, USER_C],
    });

    expect(result.requestedCount).toBe(3);
    expect(result.sentCount).toBe(1);
    // USER_B is Ready, USER_C is not a member.
    expect(result.skippedCount).toBe(2);
    expect(result.failedCount).toBe(0);
    expect(result.results).toHaveLength(3);
    expect(result.sentCount + result.skippedCount + result.failedCount).toBe(
      result.requestedCount,
    );
  });

  test("results come back in the order the caller asked, so a UI can line them up with its rows", async () => {
    readinessSpy.mockResolvedValue([
      // Deliberately returned in the opposite order to the request.
      buildReadiness({ userId: USER_C }),
      buildReadiness({ userId: USER_B }),
      buildReadiness({ userId: USER_A }),
    ] as never);

    const result: SetupReminderResult = await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A, USER_B, USER_C],
    });

    expect(
      result.results.map((one: SetupReminderUserResult): string => {
        return one.userId.toString();
      }),
    ).toEqual([USER_A.toString(), USER_B.toString(), USER_C.toString()]);
  });

  test("a repeated id is one person, one mail and one result", async () => {
    const result: SetupReminderResult = await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A, USER_A, USER_A],
    });

    expect(result.requestedCount).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(mailSpy).toHaveBeenCalledTimes(1);
    expect(outcomeFor(result, USER_A)).toBe(SetupReminderOutcome.Sent);
  });

  test("every result carries a sentence a human can act on", async () => {
    readinessSpy.mockResolvedValue([
      buildReadiness({ userId: USER_A }),
      buildReadiness({ userId: USER_B, status: ReadinessStatus.Ready }),
    ] as never);
    teamMemberSpy.mockResolvedValue([] as never);

    const result: SetupReminderResult = await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A, USER_B, USER_C],
    });

    for (const one of result.results) {
      expect(one.message.length).toBeGreaterThan(10);
    }
  });

  test("no result echoes an email address back to the caller", async () => {
    readinessSpy.mockResolvedValue([
      buildReadiness({ userId: USER_A, email: "jane@example.com" }),
    ] as never);

    const result: SetupReminderResult = await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    expect(JSON.stringify(result.results)).not.toContain("jane@example.com");
  });
});

describe("OnCallSetupReminderService - requests that are wrong as a whole", () => {
  test("an empty selection is refused", async () => {
    await expect(
      newService().sendSetupReminders({
        projectId: PROJECT_ID,
        userIds: [],
      }),
    ).rejects.toThrow(BadDataException);

    expect(readinessSpy).not.toHaveBeenCalled();
  });

  test("more than the ceiling is REFUSED rather than quietly truncated", async () => {
    const tooMany: Array<ObjectID> = [];

    for (
      let index: number = 0;
      index <= SETUP_REMINDER_MAX_RECIPIENTS;
      index++
    ) {
      tooMany.push(ObjectID.generate());
    }

    await expect(
      newService().sendSetupReminders({
        projectId: PROJECT_ID,
        userIds: tooMany,
      }),
    ).rejects.toThrow(
      new RegExp(`at most ${SETUP_REMINDER_MAX_RECIPIENTS} responders`),
    );

    expect(mailSpy).not.toHaveBeenCalled();
  });

  test("exactly the ceiling is allowed", async () => {
    const exactly: Array<ObjectID> = [];

    for (
      let index: number = 0;
      index < SETUP_REMINDER_MAX_RECIPIENTS;
      index++
    ) {
      exactly.push(ObjectID.generate());
    }

    readinessSpy.mockResolvedValue([] as never);
    teamMemberSpy.mockResolvedValue([] as never);

    const result: SetupReminderResult = await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: exactly,
    });

    expect(result.requestedCount).toBe(SETUP_REMINDER_MAX_RECIPIENTS);
  });

  test("duplicates are collapsed before the ceiling is applied", async () => {
    const withDuplicates: Array<ObjectID> = [];

    for (
      let index: number = 0;
      index <= SETUP_REMINDER_MAX_RECIPIENTS;
      index++
    ) {
      withDuplicates.push(USER_A);
    }

    const result: SetupReminderResult = await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: withDuplicates,
    });

    expect(result.requestedCount).toBe(1);
  });

  test("a project that does not exist fails the whole request rather than mailing 'your project'", async () => {
    projectSpy.mockResolvedValue(null as never);

    await expect(
      newService().sendSetupReminders({
        projectId: PROJECT_ID,
        userIds: [USER_A],
      }),
    ).rejects.toThrow(BadDataException);

    expect(mailSpy).not.toHaveBeenCalled();
  });

  test("the dashboard URL is resolved once for the whole batch", async () => {
    readinessSpy.mockResolvedValue([
      buildReadiness({ userId: USER_A }),
      buildReadiness({ userId: USER_B }),
      buildReadiness({ userId: USER_C }),
    ] as never);

    await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A, USER_B, USER_C],
    });

    expect(dashboardUrlSpy).toHaveBeenCalledTimes(1);
  });

  test("the project is read once, as root, for its name", async () => {
    await newService().sendSetupReminders({
      projectId: PROJECT_ID,
      userIds: [USER_A],
    });

    expect(projectSpy).toHaveBeenCalledTimes(1);

    const call: { props: { isRoot?: boolean | undefined } } = projectSpy.mock
      .calls[0]![0] as never;

    expect(call.props.isRoot).toBe(true);
  });
});

describe("OnCallSetupReminderService - the exported singleton", () => {
  test("the default export is an instance of the class the tests exercise", () => {
    expect(OnCallSetupReminderService).toBeInstanceOf(
      OnCallSetupReminderServiceClass,
    );
  });
});
