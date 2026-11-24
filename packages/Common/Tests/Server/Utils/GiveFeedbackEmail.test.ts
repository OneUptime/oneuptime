import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import MailService from "../../../Server/Services/MailService";
import ProductFeedbackService, {
  ServerFeedbackSettings,
} from "../../../Server/Services/ProductFeedbackService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import {
  GIVE_FEEDBACK_EMAILS_PER_PERSON_PER_HOUR,
  GIVE_FEEDBACK_EMAILS_PER_SERVER_PER_HOUR,
  GIVE_FEEDBACK_SUBJECT_SUMMARY_LENGTH,
  GiveFeedbackDelivery,
  GiveFeedbackEmail,
  GiveFeedbackEmailData,
  buildGiveFeedbackEmail,
  getGiveFeedbackMessageHtml,
  getGiveFeedbackSubject,
} from "../../../Server/Utils/GiveFeedbackEmail";
import logger from "../../../Server/Utils/Logger";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Email from "../../../Types/Email";
import EmailMessage from "../../../Types/Email/EmailMessage";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import {
  GiveFeedbackCategory,
  GiveFeedbackDestination,
  ONEUPTIME_SUPPORT_EMAIL,
  ProductFeedbackKind,
  ProductFeedbackSubmission,
} from "../../../Types/ProductFeedback/ProductFeedback";
import { HelpChoice } from "../../../Types/HelpAndSupport/HelpAndSupport";

/*
 * GIVE FEEDBACK, EMAILED TO THE TEAM THAT READS IT (issue #8893).
 *
 *   - where it goes: OneUptime Cloud's team at support@oneuptime.com; a
 *     self-hosted server's admins at its Admin Notification Email, never
 *     OneUptime; nobody where a self-hosted server has none;
 *   - what it says: what it is about, what they wrote (escaped, its lines
 *     kept), who wrote it, their project, the page and the version, with the
 *     person copied and replied to - only at an address they proved;
 *   - how often: so many an hour per person and per server, past which the
 *     answer is kept and not emailed;
 *   - and never a throw: a failing read or mail server is logged, and giving
 *     feedback goes on.
 */

const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const NOW_MS: number = new Date("2026-11-16T12:00:00.000Z").getTime();

const SUBMISSION: ProductFeedbackSubmission = {
  kind: ProductFeedbackKind.General,
  topic: GiveFeedbackCategory.Idea,
  score: null,
  isPositive: null,
  details: "Let me copy an SLO.\nIt would save me an hour a week.",
  page: "/dashboard/:projectId/slos",
  version: "14.3.0",
};

const EMAIL_DATA: GiveFeedbackEmailData = {
  category: GiveFeedbackCategory.Broken,
  details: "The SLO page shows no budget.\nIt did yesterday.",
  page: "/dashboard/:projectId/slos",
  version: "14.3.0",
  person: {
    name: "Ada Lovelace",
    email: "ada@acme.test",
    isEmailVerified: true,
  },
  project: { id: PROJECT_ID.toString(), name: "Acme Production" },
};

let serverSettings: ServerFeedbackSettings;
let user: User | null;
let project: Project | null;
let sendMail: SpyInstance<typeof MailService.sendMail>;

const makeUser: (data?: {
  name?: string;
  email?: string;
  isEmailVerified?: boolean;
}) => User = (data?: {
  name?: string;
  email?: string;
  isEmailVerified?: boolean;
}): User => {
  const record: User = new User();
  record.name = new Name(data?.name ?? "Ada Lovelace");
  record.email = new Email(data?.email ?? "ada@acme.test");
  record.isEmailVerified = data?.isEmailVerified ?? true;
  return record;
};

beforeEach(() => {
  serverSettings = {
    isOn: true,
    adminNotificationEmail: null,
    // Give feedback where it always went (Help and Support's default, #10865).
    giveFeedback: { choice: HelpChoice.Default, value: null },
    canSendEmail: true,
  };
  user = makeUser();
  project = new Project();
  project.name = "Acme Production";

  jest
    .spyOn(ProductFeedbackService, "getServerFeedbackSettings")
    .mockImplementation(async (): Promise<ServerFeedbackSettings> => {
      return serverSettings;
    });
  jest.spyOn(UserService, "findOneById").mockImplementation((async () => {
    return user;
  }) as never);
  jest.spyOn(ProjectService, "findOneById").mockImplementation((async () => {
    return project;
  }) as never);
  sendMail = jest.spyOn(MailService, "sendMail").mockResolvedValue({} as never);
  jest.spyOn(logger, "error").mockImplementation((() => {}) as never);
  jest.spyOn(logger, "warn").mockImplementation((() => {}) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const cloud: () => GiveFeedbackEmail = (): GiveFeedbackEmail => {
  return new GiveFeedbackEmail({
    isOneUptimeCloud: (): boolean => {
      return true;
    },
  });
};

const selfHosted: () => GiveFeedbackEmail = (): GiveFeedbackEmail => {
  return new GiveFeedbackEmail({
    isOneUptimeCloud: (): boolean => {
      return false;
    },
  });
};

const prepare: (
  email: GiveFeedbackEmail,
  overrides?: Partial<{
    submission: ProductFeedbackSubmission;
    projectId: ObjectID | null;
    nowMs: number;
    userId: ObjectID;
  }>,
) => Promise<GiveFeedbackDelivery | null> = (
  email: GiveFeedbackEmail,
  overrides?: Partial<{
    submission: ProductFeedbackSubmission;
    projectId: ObjectID | null;
    nowMs: number;
    userId: ObjectID;
  }>,
): Promise<GiveFeedbackDelivery | null> => {
  return email.prepare({
    userId: overrides?.userId || USER_ID,
    projectId:
      overrides?.projectId === undefined ? PROJECT_ID : overrides.projectId,
    submission: overrides?.submission || SUBMISSION,
    nowMs: overrides?.nowMs ?? NOW_MS,
  });
};

describe("where it goes", () => {
  test("on OneUptime Cloud, to the OneUptime team at support@oneuptime.com", async () => {
    const delivery: GiveFeedbackDelivery | null = await prepare(cloud());

    expect(delivery?.to).toBe(ONEUPTIME_SUPPORT_EMAIL);
    expect(ONEUPTIME_SUPPORT_EMAIL).toBe("support@oneuptime.com");
    expect(delivery?.destination).toBe(GiveFeedbackDestination.OneUptimeTeam);
  });

  test("on OneUptime Cloud, never to the admin address, whatever it is", async () => {
    serverSettings.adminNotificationEmail = "ops@oneuptime.test";

    expect((await prepare(cloud()))?.to).toBe(ONEUPTIME_SUPPORT_EMAIL);
  });

  test("on a self-hosted server, to its Admin Notification Email - never to OneUptime", async () => {
    serverSettings.adminNotificationEmail = "Ops@Acme.test";

    const delivery: GiveFeedbackDelivery | null = await prepare(selfHosted());

    expect(delivery?.to).toBe("ops@acme.test");
    expect(delivery?.destination).toBe(
      GiveFeedbackDestination.ServerAdminsByEmail,
    );
    expect(JSON.stringify(delivery)).not.toContain("oneuptime.com");
  });

  test("on a self-hosted server with no Admin Notification Email, nowhere: nothing is read and nothing is sent", async () => {
    const email: GiveFeedbackEmail = selfHosted();

    expect(await prepare(email)).toBeNull();
    expect(UserService.findOneById).not.toHaveBeenCalled();
    expect(email.getReceipt(null)).toEqual({ isEmailed: false, copyTo: null });
  });

  test("an admin address that is not one mailbox is none", async () => {
    serverSettings.adminNotificationEmail = "a@acme.test, b@acme.test";

    expect(await prepare(selfHosted())).toBeNull();
  });
});

describe("what it is prepared with", () => {
  test("what it is about, what they wrote, the page and the version, as kept", async () => {
    const delivery: GiveFeedbackDelivery | null = await prepare(cloud());

    expect(delivery?.email).toEqual({
      category: GiveFeedbackCategory.Idea,
      details: SUBMISSION.details,
      page: "/dashboard/:projectId/slos",
      version: "14.3.0",
      person: {
        name: "Ada Lovelace",
        email: "ada@acme.test",
        isEmailVerified: true,
      },
      project: null,
    });
    expect(delivery?.projectId).toEqual(PROJECT_ID);
  });

  test("who wrote it is read from who is signed in, never from what was posted", async () => {
    await prepare(cloud());

    expect(
      (
        jest.mocked(UserService.findOneById).mock.calls[0]![0] as {
          id: ObjectID;
        }
      ).id,
    ).toEqual(USER_ID);
  });

  test("a copy goes only to an address the person proved is theirs", async () => {
    const email: GiveFeedbackEmail = cloud();

    expect(email.getReceipt(await prepare(email))).toEqual({
      isEmailed: true,
      copyTo: "ada@acme.test",
    });

    user = makeUser({ isEmailVerified: false });

    const unproved: GiveFeedbackDelivery | null = await prepare(email);

    expect(unproved?.to).toBe(ONEUPTIME_SUPPORT_EMAIL);
    expect(email.getReceipt(unproved)).toEqual({
      isEmailed: true,
      copyTo: null,
    });
  });

  test("a person who is not found, or no words, is not emailed", async () => {
    user = null;
    expect(await prepare(cloud())).toBeNull();

    user = makeUser();
    expect(
      await prepare(cloud(), {
        submission: { ...SUBMISSION, details: null },
      }),
    ).toBeNull();
  });

  test("a topic that is no category is Other", async () => {
    const delivery: GiveFeedbackDelivery | null = await prepare(cloud(), {
      submission: { ...SUBMISSION, topic: "help" },
    });

    expect(delivery?.email.category).toBe(GiveFeedbackCategory.Other);
  });
});

describe("how often", () => {
  test(`a person has at most ${GIVE_FEEDBACK_EMAILS_PER_PERSON_PER_HOUR} emailed an hour; the hour after, again`, async () => {
    const email: GiveFeedbackEmail = cloud();

    for (let i: number = 0; i < GIVE_FEEDBACK_EMAILS_PER_PERSON_PER_HOUR; i++) {
      expect(await prepare(email)).not.toBeNull();
    }

    expect(await prepare(email)).toBeNull();
    expect(logger.warn).toHaveBeenCalled();

    // Somebody else still is.
    expect(
      await prepare(email, {
        userId: new ObjectID("55555555-5555-4555-8555-555555555555"),
      }),
    ).not.toBeNull();

    expect(
      await prepare(email, { nowMs: NOW_MS + 60 * 60 * 1000 + 1 }),
    ).not.toBeNull();
  });

  test(`the server emails at most ${GIVE_FEEDBACK_EMAILS_PER_SERVER_PER_HOUR} an hour, from everyone together`, async () => {
    const email: GiveFeedbackEmail = cloud();

    for (let i: number = 0; i < GIVE_FEEDBACK_EMAILS_PER_SERVER_PER_HOUR; i++) {
      expect(
        await prepare(email, {
          userId: new ObjectID(
            `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
          ),
        }),
      ).not.toBeNull();
    }

    expect(
      await prepare(email, {
        userId: new ObjectID("66666666-6666-4666-8666-666666666666"),
      }),
    ).toBeNull();
  });
});

describe("it never throws", () => {
  test("a failing read of the server or the person is logged, and nothing is emailed", async () => {
    jest
      .spyOn(ProductFeedbackService, "getServerFeedbackSettings")
      .mockRejectedValue(new Error("database down"));

    await expect(prepare(cloud())).resolves.toBeNull();

    jest
      .spyOn(ProductFeedbackService, "getServerFeedbackSettings")
      .mockResolvedValue(serverSettings);
    jest
      .spyOn(UserService, "findOneById")
      .mockRejectedValue(new Error("database down"));

    await expect(prepare(cloud())).resolves.toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });

  test("a failing mail server is logged, and the send resolves", async () => {
    sendMail.mockRejectedValue(new Error("connection refused"));

    const email: GiveFeedbackEmail = cloud();

    await expect(
      email.send((await prepare(email)) as GiveFeedbackDelivery),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  test("a send the notification service answers with an error, rather than throws, is logged too", async () => {
    sendMail.mockResolvedValue(
      new HTTPErrorResponse(500, { message: "No mail server is set up." }, {}),
    );

    const email: GiveFeedbackEmail = cloud();

    await expect(
      email.send((await prepare(email)) as GiveFeedbackDelivery),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("its email was not sent"),
    );
  });

  test("a failing read of the project is logged, and the send resolves", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockRejectedValue(new Error("database down"));

    const email: GiveFeedbackEmail = cloud();

    await expect(
      email.send((await prepare(email)) as GiveFeedbackDelivery),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("sending it", () => {
  test("names the project the person gave it from, and sends to the team with the person copied and replied to", async () => {
    const email: GiveFeedbackEmail = cloud();

    await email.send((await prepare(email)) as GiveFeedbackDelivery);

    expect(sendMail).toHaveBeenCalledTimes(1);

    const sent: EmailMessage = sendMail.mock.calls[0]![0];

    expect(sent.toEmail.toString()).toBe(ONEUPTIME_SUPPORT_EMAIL);
    expect(
      (sent.ccEmails || []).map((copy: Email): string => {
        return copy.toString();
      }),
    ).toEqual(["ada@acme.test"]);
    expect(sent.replyToEmail?.toString()).toBe("ada@acme.test");
    expect(sent.vars["projectName"]).toBe("Acme Production");
    expect(sent.vars["projectId"]).toBe(PROJECT_ID.toString());
    // The server's own mail settings: no project's mail server, no project's block.
    expect(sendMail.mock.calls[0]![1]).toBeUndefined();
  });

  test("feedback given outside a project names none", async () => {
    const email: GiveFeedbackEmail = cloud();

    await email.send(
      (await prepare(email, { projectId: null })) as GiveFeedbackDelivery,
    );

    expect(ProjectService.findOneById).not.toHaveBeenCalled();
    expect(sendMail.mock.calls[0]![0].vars["projectName"]).toBe("");
    expect(sendMail.mock.calls[0]![0].vars["projectId"]).toBe("");
  });
});

describe("the email", () => {
  test("goes to the team, copies the person and sends a reply to them", () => {
    const email: EmailMessage = buildGiveFeedbackEmail({
      to: ONEUPTIME_SUPPORT_EMAIL,
      email: EMAIL_DATA,
    });

    expect(email.toEmail.toString()).toBe(ONEUPTIME_SUPPORT_EMAIL);
    expect(email.ccEmails?.map(String)).toEqual(["ada@acme.test"]);
    expect(email.replyToEmail?.toString()).toBe("ada@acme.test");
    expect(email.templateType).toBe(EmailTemplateType.GiveFeedback);
    // The person's words: sent as written, never compiled as a template.
    expect(email.isSubjectLiteral).toBe(true);
  });

  test("copies and replies to nobody whose address is not proved", () => {
    const email: EmailMessage = buildGiveFeedbackEmail({
      to: ONEUPTIME_SUPPORT_EMAIL,
      email: {
        ...EMAIL_DATA,
        person: { ...EMAIL_DATA.person, isEmailVerified: false },
      },
    });

    expect(email.ccEmails).toBeUndefined();
    expect(email.replyToEmail).toBeUndefined();
    // The team still sees who wrote.
    expect(email.vars["personEmail"]).toBe("ada@acme.test");
  });

  test("says what it is about, who wrote, their project, the page and the version", () => {
    expect(
      buildGiveFeedbackEmail({
        to: ONEUPTIME_SUPPORT_EMAIL,
        email: EMAIL_DATA,
      }).vars,
    ).toEqual({
      title: "Feedback from Ada Lovelace",
      preheader: "Something's broken · Ada Lovelace · Acme Production",
      category: "Something's broken",
      messageHtml: "The SLO page shows no budget.<br/>It did yesterday.",
      personName: "Ada Lovelace",
      personEmail: "ada@acme.test",
      projectName: "Acme Production",
      projectId: PROJECT_ID.toString(),
      page: "/dashboard/:projectId/slos",
      version: "14.3.0",
    });
  });

  test("a person with no name is named by their address", () => {
    const email: EmailMessage = buildGiveFeedbackEmail({
      to: ONEUPTIME_SUPPORT_EMAIL,
      email: {
        ...EMAIL_DATA,
        person: { ...EMAIL_DATA.person, name: "  " },
        project: null,
      },
    });

    expect(email.vars["title"]).toBe("Feedback from ada@acme.test");
    expect(email.vars["preheader"]).toBe("Something's broken · ada@acme.test");
    expect(email.vars["personName"]).toBe("");
  });

  test("its subject names what it is about and starts with their first line", () => {
    expect(
      getGiveFeedbackSubject({
        category: GiveFeedbackCategory.Confusing,
        details: "\n\n  Where do I set the paging order?  \nSecond line.",
      }),
    ).toBe("Feedback (Confusing): Where do I set the paging order?");
  });

  test("a long first line is cut, with an ellipsis, to what an inbox shows", () => {
    const subject: string = getGiveFeedbackSubject({
      category: GiveFeedbackCategory.Idea,
      details: "x".repeat(500),
    });
    const summary: string = subject.slice("Feedback (Idea): ".length);

    expect(summary.length).toBe(GIVE_FEEDBACK_SUBJECT_SUMMARY_LENGTH);
    expect(summary.endsWith("…")).toBe(true);
  });

  test("nothing a person types can start a new header", () => {
    const subject: string = getGiveFeedbackSubject({
      category: GiveFeedbackCategory.Other,
      details: "Hello\u0000\u0007\tBcc: mallory@evil.test",
    });

    expect(
      Array.from(subject).some((character: string): boolean => {
        return character.charCodeAt(0) < 0x20;
      }),
    ).toBe(false);
    expect(subject).toBe("Feedback (Other): Hello   Bcc: mallory@evil.test");
  });

  test("no words is the subject's category alone", () => {
    expect(
      getGiveFeedbackSubject({
        category: GiveFeedbackCategory.Other,
        details: "   ",
      }),
    ).toBe("Feedback (Other)");
  });

  test("what they wrote is escaped, its lines kept as <br/>, and nothing else is markup", () => {
    expect(
      getGiveFeedbackMessageHtml(
        '<script>alert(1)</script>\r\n<a href="https://evil.test">Reset</a> & more\rlast',
      ),
    ).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;<br/>&lt;a href=&quot;https://evil.test&quot;&gt;Reset&lt;/a&gt; &amp; more<br/>last",
    );
  });
});

describe("where a server's admins send Give feedback (Help and Support, #10865)", () => {
  test("to an address of the server's own, in place of the Admin Notification Email", async () => {
    serverSettings.adminNotificationEmail = "ops@acme.test";
    serverSettings.giveFeedback = {
      choice: HelpChoice.Email,
      value: "support-team@acme.test",
    };

    const delivery: GiveFeedbackDelivery | null = await prepare(selfHosted());

    expect(delivery?.to).toBe("support-team@acme.test");
    expect(delivery?.destination).toBe(
      GiveFeedbackDestination.SupportTeamByEmail,
    );

    await selfHosted().send(delivery!);

    const sent: EmailMessage = sendMail.mock.calls[0]![0] as EmailMessage;

    expect(sent.toEmail.toString()).toBe("support-team@acme.test");
    // The person is still copied and replied to.
    expect(sent.replyToEmail?.toString()).toBe("ada@acme.test");
  });

  test("to an address of the server's own on OneUptime Cloud too, where its admins chose one", async () => {
    serverSettings.giveFeedback = {
      choice: HelpChoice.Email,
      value: "support-team@acme.test",
    };

    expect((await prepare(cloud()))?.to).toBe("support-team@acme.test");
  });

  test("to an address the server cannot send email to: nothing is prepared, so nothing is promised", async () => {
    serverSettings.canSendEmail = false;
    serverSettings.giveFeedback = {
      choice: HelpChoice.Email,
      value: "support-team@acme.test",
    };

    expect(await prepare(selfHosted())).toBeNull();
    expect(sendMail).not.toHaveBeenCalled();
  });

  test("to a page of the server's own: nothing is emailed from OneUptime", async () => {
    serverSettings.adminNotificationEmail = "ops@acme.test";
    serverSettings.giveFeedback = {
      choice: HelpChoice.Link,
      value: "https://desk.acme.test/feedback",
    };

    expect(await prepare(selfHosted())).toBeNull();
    expect(await prepare(cloud())).toBeNull();
  });

  test("hidden: nothing is emailed, even with an Admin Notification Email", async () => {
    serverSettings.adminNotificationEmail = "ops@acme.test";
    serverSettings.giveFeedback = { choice: HelpChoice.Hidden, value: null };

    expect(await prepare(selfHosted())).toBeNull();
  });

  test("by default, exactly as before, whether or not the server can send email", async () => {
    serverSettings.canSendEmail = false;
    serverSettings.adminNotificationEmail = "ops@acme.test";

    expect((await prepare(selfHosted()))?.to).toBe("ops@acme.test");
    expect((await prepare(cloud()))?.to).toBe(ONEUPTIME_SUPPORT_EMAIL);
  });

  test("the receipt says it is emailed, and where the copy goes", async () => {
    serverSettings.giveFeedback = {
      choice: HelpChoice.Email,
      value: "support-team@acme.test",
    };

    const email: GiveFeedbackEmail = selfHosted();

    expect(email.getReceipt(await prepare(email))).toEqual({
      isEmailed: true,
      copyTo: "ada@acme.test",
    });
  });
});
