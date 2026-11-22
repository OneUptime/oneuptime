import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyEscalationRuleScheduleService from "Common/Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyScheduleService from "Common/Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "Common/Server/Services/OnCallDutyPolicyService";
import OnCallDutyPolicyTimeLogService from "Common/Server/Services/OnCallDutyPolicyTimeLogService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import UserService from "Common/Server/Services/UserService";
import logger from "Common/Server/Utils/Logger";
import EscalationRuleReach, {
  PolicyReachOfPerson,
} from "Common/Server/Utils/OnCall/EscalationRuleReach";
import OnCallHandoffPosts from "Common/Server/Utils/OnCall/OnCallHandoffPosts";
import ProjectMembership from "Common/Server/Utils/TeamMember/ProjectMembership";
import URL from "Common/Types/API/URL";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import ObjectID from "Common/Types/ObjectID";
// Registers the product's real Handlebars helpers as an import side effect.
import "../../FeatureSet/Notification/Utils/Handlebars";
import {
  EmailElement,
  EmailMarkupTree,
  findElements,
  hasClass,
  readEmailMarkup,
  textOf,
} from "./Fixtures/EmailMarkupTree";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE HAND-OFF EMAILS NAME EVERY RULE OF THEIR POLICY THAT PAGES THE
 * SCHEDULE (issue #7969).
 *
 * A hand-off tells each person once for each policy that pages the
 * schedule (OnCallHandoffPolicies), however many of the policy's rules page
 * it. Each of its three emails - You are no longer on-call, You are now
 * on-call, You are next on-call - names its rules: "Escalation Rules: First
 * line and Escalate", "Escalation Orders: 1 and 2" for a policy whose two
 * rules page the schedule, and "Escalation Rule: First line", "Escalation
 * Order: 1" for one whose single rule does, as they always read.
 *
 * The names in them - the policy's, its rules' and the schedule's - are
 * typed by the project's members, and are written as text: a name with
 * markup in it reads as written, and adds no link to the email.
 *
 * The emails are built by the real hand-off
 * (OnCallDutyPolicyScheduleService.sendNotificationToUserOnScheduleHandoff)
 * and rendered through the real templates and partials; only the database
 * reads and the sends are stubbed.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "../../FeatureSet/Notification/Templates",
);

const PROJECT_ID: ObjectID = new ObjectID(
  "79691111-0000-4000-8000-000000000001",
);
const SCHEDULE_ID: ObjectID = new ObjectID(
  "79691111-0000-4000-8000-000000000002",
);
const PAYMENTS: ObjectID = new ObjectID("79691111-0000-4000-8000-000000000003");
const CHECKOUT: ObjectID = new ObjectID("79691111-0000-4000-8000-000000000004");
const CARL: ObjectID = new ObjectID("79691111-0000-4000-8000-0000000000c1");
const ANA: ObjectID = new ObjectID("79691111-0000-4000-8000-0000000000a1");
const BOB: ObjectID = new ObjectID("79691111-0000-4000-8000-0000000000b1");

const YESTERDAY: Date = new Date("2026-11-13T22:50:00.000Z");
const TODAY: Date = new Date("2026-11-14T22:50:00.000Z");
const TOMORROW: Date = new Date("2026-11-15T22:50:00.000Z");
const DAY_AFTER: Date = new Date("2026-11-16T22:50:00.000Z");

interface Roster {
  currentUserIdOnRoster: ObjectID | null;
  rosterHandoffAt: Date | null;
  nextUserIdOnRoster: ObjectID | null;
  nextHandOffTimeAt: Date | null;
  rosterStartAt: Date | null;
  nextRosterStartAt: Date | null;
}

// Carl was on call until today, Ana next; now Ana is, until tomorrow, then Bob.
const BEFORE: Roster = {
  currentUserIdOnRoster: CARL,
  rosterHandoffAt: TODAY,
  nextUserIdOnRoster: ANA,
  nextHandOffTimeAt: TOMORROW,
  rosterStartAt: YESTERDAY,
  nextRosterStartAt: TODAY,
};

const AFTER: Roster = {
  currentUserIdOnRoster: ANA,
  rosterHandoffAt: TOMORROW,
  nextUserIdOnRoster: BOB,
  nextHandOffTimeAt: DAY_AFTER,
  rosterStartAt: TODAY,
  nextRosterStartAt: TOMORROW,
};

function attachment(data: {
  policyId: ObjectID;
  policyName: string;
  ruleName: string;
  order: number;
  scheduleName?: string;
}): OnCallDutyPolicyEscalationRuleSchedule {
  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy.id = data.policyId;
  policy.name = data.policyName;

  const rule: OnCallDutyPolicyEscalationRule =
    new OnCallDutyPolicyEscalationRule();
  rule.id = ObjectID.generate();
  rule.name = data.ruleName;
  rule.order = data.order;

  const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
  schedule.id = SCHEDULE_ID;
  schedule.name = data.scheduleName || "Primary";

  const row: OnCallDutyPolicyEscalationRuleSchedule =
    new OnCallDutyPolicyEscalationRuleSchedule();
  row.id = ObjectID.generate();
  row.projectId = PROJECT_ID;
  row.pageNextInRotation = false;
  row.onCallDutyPolicy = policy;
  row.onCallDutyPolicyEscalationRule = rule;
  row.onCallDutyPolicySchedule = schedule;
  return row;
}

// Payments pages the schedule from two rules, Checkout from one.
function attachments(): Array<OnCallDutyPolicyEscalationRuleSchedule> {
  return [
    attachment({
      policyId: PAYMENTS,
      policyName: "Payments",
      ruleName: "First line",
      order: 1,
    }),
    attachment({
      policyId: PAYMENTS,
      policyName: "Payments",
      ruleName: "Escalate",
      order: 2,
    }),
    attachment({
      policyId: CHECKOUT,
      policyName: "Checkout",
      ruleName: "First line",
      order: 1,
    }),
  ];
}

// An email the hand-off sent, with who it went to and for which policy.
interface SentEmail {
  userId: string;
  policyId: string;
  envelope: EmailEnvelope;
}

let emails: Array<SentEmail>;

async function handoff(
  rows: Array<OnCallDutyPolicyEscalationRuleSchedule>,
): Promise<void> {
  jest
    .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findBy")
    .mockResolvedValue(rows);

  await (
    OnCallDutyPolicyScheduleService as unknown as {
      sendNotificationToUserOnScheduleHandoff: (data: {
        scheduleId: ObjectID;
        previousInformation: Roster;
        newInformation: Roster;
      }) => Promise<void>;
    }
  ).sendNotificationToUserOnScheduleHandoff({
    scheduleId: SCHEDULE_ID,
    previousInformation: BEFORE,
    newInformation: AFTER,
  });
}

function render(envelope: EmailEnvelope): string {
  return Handlebars.compile(
    fs.readFileSync(
      Path.join(TEMPLATES_DIR, envelope.templateType as string),
      "utf8",
    ),
  )({
    homeURL: "https://oneuptime.test",
    year: "2026",
    ...envelope.vars,
  });
}

// Each row of the email's detail card: its label, and the text it shows.
function rowsOf(html: string): Array<{ label: string; value: string }> {
  const tree: EmailMarkupTree = readEmailMarkup(html);

  return findElements(tree.root, (element: EmailElement): boolean => {
    return hasClass(element, "st-DetailCard-field");
  }).map((field: EmailElement) => {
    const label: EmailElement | undefined = findElements(
      field,
      (element: EmailElement): boolean => {
        return hasClass(element, "st-DetailCard-label");
      },
    )[0];
    const value: EmailElement | undefined = findElements(
      field,
      (element: EmailElement): boolean => {
        return hasClass(element, "st-DetailCard-value");
      },
    )[0];

    return {
      label: label ? textOf(label).trim() : "",
      value: value ? textOf(value).trim() : "",
    };
  });
}

function emailTo(
  person: ObjectID,
  policyId: ObjectID,
  templateType: EmailTemplateType,
): EmailEnvelope {
  const found: SentEmail | undefined = emails.find((email: SentEmail) => {
    return (
      email.userId === person.toString() &&
      email.policyId === policyId.toString() &&
      email.envelope.templateType === templateType
    );
  });

  if (!found) {
    throw new Error(
      `No ${templateType} email to ${person.toString()} for ${policyId.toString()}`,
    );
  }

  return found.envelope;
}

// Who is told what, at this hand-off: Carl is off, Ana on, Bob next.
const THE_THREE_EMAILS: Array<{
  person: ObjectID;
  templateType: EmailTemplateType;
}> = [
  {
    person: CARL,
    templateType: EmailTemplateType.UserNoLongerActiveOnOnCallRoster,
  },
  { person: ANA, templateType: EmailTemplateType.UserCurrentlyOnOnCallRoster },
  { person: BOB, templateType: EmailTemplateType.UserNextOnOnCallRoster },
];

beforeAll(() => {
  const partialsDir: string = Path.join(TEMPLATES_DIR, "Partials");

  for (const file of fs.readdirSync(partialsDir)) {
    if (file.endsWith(".hbs")) {
      Handlebars.registerPartial(
        file.slice(0, -4),
        fs.readFileSync(Path.join(partialsDir, file), "utf8"),
      );
    }
  }
});

beforeEach(() => {
  emails = [];

  jest.spyOn(logger, "debug").mockImplementation((() => {}) as never);
  jest.spyOn(logger, "error").mockImplementation((() => {}) as never);
  jest.spyOn(UserService, "getTimezoneForUser").mockResolvedValue(null);
  jest
    .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
    .mockImplementation((async (_projectId: ObjectID, policyId: ObjectID) => {
      return URL.fromString(
        `https://oneuptime.test/dashboard/on-call-duty/policies/${policyId.toString()}`,
      );
    }) as never);
  jest
    .spyOn(UserNotificationSettingService, "sendUserNotification")
    .mockImplementation((async (data: {
      userId: ObjectID;
      onCallPolicyId: ObjectID;
      emailEnvelope: EmailEnvelope;
    }) => {
      emails.push({
        userId: data.userId.toString(),
        policyId: data.onCallPolicyId.toString(),
        envelope: data.emailEnvelope,
      });
    }) as never);
  jest
    .spyOn(OnCallDutyPolicyTimeLogService, "startTimeLogForUser")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(OnCallDutyPolicyTimeLogService, "endTimeLogForUser")
    .mockResolvedValue(undefined as never);
  jest.spyOn(OnCallHandoffPosts, "post").mockResolvedValue(undefined as never);

  /*
   * Carl, Ana and Bob are members of the project, and nothing on either
   * policy pages Carl once his shift ends (#10556).
   */
  jest
    .spyOn(ProjectMembership, "getMemberUserIds")
    .mockImplementation((async (data: { userIds: Array<ObjectID> }) => {
      return new Set<string>(
        data.userIds.map((userId: ObjectID): string => {
          return userId.toString().toLowerCase();
        }),
      );
    }) as never);
  jest
    .spyOn(EscalationRuleReach, "readPolicyPathsOfPerson")
    .mockResolvedValue(new Map() as PolicyReachOfPerson);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the hand-off emails", () => {
  test("REGRESSION: each person gets one email for each policy, not one for each rule", async () => {
    await handoff(attachments());

    // Carl, Ana and Bob, for Payments and for Checkout: six, not nine.
    expect(emails).toHaveLength(6);

    for (const { person, templateType } of THE_THREE_EMAILS) {
      for (const policyId of [PAYMENTS, CHECKOUT]) {
        expect(
          emails.filter((email: SentEmail) => {
            return (
              email.userId === person.toString() &&
              email.policyId === policyId.toString() &&
              email.envelope.templateType === templateType
            );
          }),
        ).toHaveLength(1);
      }
    }
  });

  for (const { templateType } of THE_THREE_EMAILS) {
    test(`${templateType}: a policy whose two rules page the schedule names both, under plural titles`, async () => {
      await handoff(attachments());

      const person: ObjectID = THE_THREE_EMAILS.find(
        (email: { templateType: EmailTemplateType }) => {
          return email.templateType === templateType;
        },
      )!.person;
      const rows: Array<{ label: string; value: string }> = rowsOf(
        render(emailTo(person, PAYMENTS, templateType)),
      );

      expect(rows).toEqual(
        expect.arrayContaining([
          { label: "On-Call Policy:", value: "Payments" },
          { label: "Escalation Rules:", value: "First line and Escalate" },
          { label: "Escalation Orders:", value: "1 and 2" },
        ]),
      );
      expect(
        rows.map((row: { label: string }): string => {
          return row.label;
        }),
      ).not.toEqual(
        expect.arrayContaining(["Escalation Rule:", "Escalation Order:"]),
      );
    });

    test(`${templateType}: a policy whose one rule pages the schedule reads as it always did`, async () => {
      await handoff(attachments());

      const person: ObjectID = THE_THREE_EMAILS.find(
        (email: { templateType: EmailTemplateType }) => {
          return email.templateType === templateType;
        },
      )!.person;
      const rows: Array<{ label: string; value: string }> = rowsOf(
        render(emailTo(person, CHECKOUT, templateType)),
      );

      expect(
        rows.slice(0, 3).map((row: { label: string; value: string }) => {
          return [row.label, row.value];
        }),
      ).toEqual([
        ["On-Call Policy:", "Checkout"],
        ["Escalation Rule:", "First line"],
        ["Escalation Order:", "1"],
      ]);
      expect(
        rows.map((row: { label: string }): string => {
          return row.label;
        }),
      ).not.toContain("Escalation Rules:");
    });
  }

  test("the rows come in the same order in every email, with the roster's times after the rules", async () => {
    await handoff(attachments());

    const labels: Array<string> = rowsOf(
      render(
        emailTo(ANA, PAYMENTS, EmailTemplateType.UserCurrentlyOnOnCallRoster),
      ),
    ).map((row: { label: string }): string => {
      return row.label;
    });

    expect(labels).toEqual([
      "On-Call Policy:",
      "Escalation Rules:",
      "Escalation Orders:",
      "More Information:",
      "Your On-Call Roster Starts At:",
      "Your On-Call Roster Ends At:",
    ]);
  });

  test("names with markup in them read as written, and add no link to the email", async () => {
    await handoff([
      attachment({
        policyId: PAYMENTS,
        policyName: 'Pay<a href="https://evil.test/policy">ments</a>',
        ruleName: '<a href="https://evil.test/rule">First line</a>',
        order: 1,
        scheduleName: '<img src="https://evil.test/schedule.png">',
      }),
      attachment({
        policyId: PAYMENTS,
        policyName: 'Pay<a href="https://evil.test/policy">ments</a>',
        ruleName: "<b>Escalate</b>",
        order: 2,
        scheduleName: '<img src="https://evil.test/schedule.png">',
      }),
    ]);

    expect(emails).toHaveLength(3);

    for (const email of emails) {
      const html: string = render(email.envelope);

      expect(html).not.toContain('href="https://evil.test');
      expect(html).not.toContain('src="https://evil.test');
      expect(html).not.toContain("<b>Escalate</b>");

      const rows: Array<{ label: string; value: string }> = rowsOf(html);

      expect(rows).toEqual(
        expect.arrayContaining([
          {
            label: "On-Call Policy:",
            value:
              "Pay&lt;a href&#x3D;&quot;https://evil.test/policy&quot;&gt;ments&lt;/a&gt;",
          },
          {
            label: "Escalation Rules:",
            value:
              "&lt;a href&#x3D;&quot;https://evil.test/rule&quot;&gt;First line&lt;/a&gt; and &lt;b&gt;Escalate&lt;/b&gt;",
          },
        ]),
      );
      expect(
        rows.find((row: { label: string }) => {
          return row.label === "More Information:";
        })!.value,
      ).toContain(
        "&lt;img src&#x3D;&quot;https://evil.test/schedule.png&quot;&gt;",
      );
    }
  });
});
