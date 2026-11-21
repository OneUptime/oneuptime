import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import OnCallDutyPolicyEscalationRuleScheduleService from "Common/Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleTeamService from "Common/Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "Common/Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyFeedService from "Common/Server/Services/OnCallDutyPolicyFeedService";
import OnCallDutyPolicyScheduleService from "Common/Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "Common/Server/Services/OnCallDutyPolicyService";
import OnCallDutyPolicyTimeLogService from "Common/Server/Services/OnCallDutyPolicyTimeLogService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import UserService from "Common/Server/Services/UserService";
import logger from "Common/Server/Utils/Logger";
import OnCallShiftReminderRunner, {
  ShiftReminderMessage,
} from "Common/Server/Utils/OnCall/OnCallShiftReminderRunner";
import OnDutyPoliciesCache from "Common/Server/Utils/OnCall/OnDutyPoliciesCache";
import EscalationRuleReach, {
  RuleMembers,
  RuleReach,
} from "Common/Server/Utils/OnCall/EscalationRuleReach";
import URL from "Common/Types/API/URL";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import ObjectID from "Common/Types/ObjectID";
import { MaterializedShift } from "Common/Types/OnCallDutyPolicy/MaterializedShift";
import {
  at,
  shift,
} from "Common/Tests/Types/OnCallDutyPolicy/CalendarFeedTestFixtures";
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
 * WHAT A PERSON HEARS ABOUT THEIR ON-CALL DUTY NAMES THINGS AS TEXT
 * (issue #8166).
 *
 * "You have been ADDED to On-Call Policy" and "You have been REMOVED from
 * On-Call Policy" - for a rule that names the person, their team or a
 * schedule they are on call in - and the shift reminders printed the names
 * in them raw: a policy, a rule, a team or a schedule named
 * `<a href="https://evil.test/rule">Level 1</a>` became a live link in an
 * email its reader trusts. A reminder for a shift covering for somebody
 * printed that person's name raw too, and anybody who signs up names
 * themselves.
 *
 * The emails are built here by their real senders - the hooks of
 * OnCallDutyPolicyEscalationRuleUserService, ...TeamService and
 * ...ScheduleService that run as a person, a team or a schedule is added to
 * or removed from a rule, and OnCallShiftReminderRunner's message builders -
 * and rendered through the real templates and partials. Only the database
 * reads and the sends are stubbed.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "../../FeatureSet/Notification/Templates",
);

const PROJECT_ID: ObjectID = new ObjectID(
  "81661111-0000-4000-8000-000000000001",
);
const POLICY_ID: ObjectID = new ObjectID(
  "81661111-0000-4000-8000-000000000002",
);
const RULE_ID: ObjectID = new ObjectID("81661111-0000-4000-8000-000000000003");
const TEAM_ID: ObjectID = new ObjectID("81661111-0000-4000-8000-000000000004");
const SCHEDULE_ID: ObjectID = new ObjectID(
  "81661111-0000-4000-8000-000000000005",
);
const ANA: ObjectID = new ObjectID("81661111-0000-4000-8000-0000000000a1");
const ROW_ID: ObjectID = new ObjectID("81661111-0000-4000-8000-0000000000f1");

// Names as a project's members can type them, markup and all.
const POLICY_NAME: string = 'Pay<a href="https://evil.test/policy">ments</a>';
const RULE_NAME: string = '<a href="https://evil.test/rule">Level 1</a>';
const TEAM_NAME: string = '<img src="https://evil.test/team.png">SRE';
const SCHEDULE_NAME: string =
  '<b>Primary</b><a href="https://evil.test/schedule">!</a>';
// And a person's own name, which anybody who signs up types.
const PERSON_NAME: string = '<a href="https://evil.test/person">Bob</a>';

// How Handlebars' escaping (which also escapes "=") writes each of them.
const ESCAPED_POLICY: string =
  "Pay&lt;a href&#x3D;&quot;https://evil.test/policy&quot;&gt;ments&lt;/a&gt;";
const ESCAPED_RULE: string =
  "&lt;a href&#x3D;&quot;https://evil.test/rule&quot;&gt;Level 1&lt;/a&gt;";
const ESCAPED_TEAM: string =
  "&lt;img src&#x3D;&quot;https://evil.test/team.png&quot;&gt;SRE";
const ESCAPED_SCHEDULE: string =
  "&lt;b&gt;Primary&lt;/b&gt;&lt;a href&#x3D;&quot;https://evil.test/schedule&quot;&gt;!&lt;/a&gt;";
const ESCAPED_PERSON: string =
  "&lt;a href&#x3D;&quot;https://evil.test/person&quot;&gt;Bob&lt;/a&gt;";

type AnyFunction = (...args: Array<any>) => any;

// An email a sender handed to the notification settings, and to whom.
interface SentEmail {
  userId: string;
  envelope: EmailEnvelope;
}

let emails: Array<SentEmail>;

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

// No markup a person typed is live in the email.
function expectNoLiveMarkup(html: string): void {
  expect(html).not.toContain('href="https://evil.test');
  expect(html).not.toContain('src="https://evil.test');
  expect(html).not.toContain("<b>Primary</b>");
}

function policy(name: string): OnCallDutyPolicy {
  const row: OnCallDutyPolicy = new OnCallDutyPolicy();
  row.id = POLICY_ID;
  row.name = name;
  return row;
}

function rule(name: string): OnCallDutyPolicyEscalationRule {
  const row: OnCallDutyPolicyEscalationRule =
    new OnCallDutyPolicyEscalationRule();
  row.id = RULE_ID;
  row.name = name;
  row.order = 1;
  return row;
}

function person(): User {
  const user: User = new User();
  user.id = ANA;
  return user;
}

// A person named on a rule, as its service reads the row.
function userRow(names: {
  policy: string;
  rule: string;
}): OnCallDutyPolicyEscalationRuleUser {
  const row: OnCallDutyPolicyEscalationRuleUser =
    new OnCallDutyPolicyEscalationRuleUser();
  row.id = ROW_ID;
  row.projectId = PROJECT_ID;
  row.user = person();
  row.onCallDutyPolicy = policy(names.policy);
  row.onCallDutyPolicyEscalationRule = rule(names.rule);
  return row;
}

// A team named on a rule.
function teamRow(names: {
  policy: string;
  rule: string;
  team: string;
}): OnCallDutyPolicyEscalationRuleTeam {
  const team: Team = new Team();
  team.id = TEAM_ID;
  team.name = names.team;

  const row: OnCallDutyPolicyEscalationRuleTeam =
    new OnCallDutyPolicyEscalationRuleTeam();
  row.id = ROW_ID;
  row.projectId = PROJECT_ID;
  row.teamId = TEAM_ID;
  row.team = team;
  row.onCallDutyPolicy = policy(names.policy);
  row.onCallDutyPolicyEscalationRule = rule(names.rule);
  return row;
}

// A schedule a rule pages whoever is on call in.
function scheduleRow(names: {
  policy: string;
  rule: string;
  schedule: string;
}): OnCallDutyPolicyEscalationRuleSchedule {
  const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
  schedule.id = SCHEDULE_ID;
  schedule.name = names.schedule;

  const row: OnCallDutyPolicyEscalationRuleSchedule =
    new OnCallDutyPolicyEscalationRuleSchedule();
  row.id = ROW_ID;
  row.projectId = PROJECT_ID;
  row.onCallDutyPolicyScheduleId = SCHEDULE_ID;
  row.pageNextInRotation = false;
  row.onCallDutyPolicySchedule = schedule;
  row.onCallDutyPolicy = policy(names.policy);
  row.onCallDutyPolicyEscalationRule = rule(names.rule);
  return row;
}

// A hook of a service, run as the database runs it after a write.
async function runHook(
  service: unknown,
  hook: "onCreateSuccess" | "onDeleteSuccess",
  row: unknown,
): Promise<void> {
  const call: AnyFunction = (service as Record<string, AnyFunction>)[hook]!;

  if (hook === "onCreateSuccess") {
    jest
      .spyOn(service as never, "findOneById" as never)
      .mockResolvedValue(row as never);
    await call.call(service, { createBy: {}, carryForward: null }, row);
    return;
  }

  await call.call(
    service,
    { deleteBy: {}, carryForward: { deletedItems: [row] } },
    [],
  );
}

// The one email a hook sent, rendered.
function onlyEmail(templateType: EmailTemplateType): string {
  expect(emails).toHaveLength(1);
  expect(emails[0]!.userId).toBe(ANA.toString());
  expect(emails[0]!.envelope.templateType).toBe(templateType);

  return render(emails[0]!.envelope);
}

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

  for (const level of ["debug", "info", "warn", "error"] as const) {
    jest.spyOn(logger, level).mockImplementation((() => {}) as never);
  }

  jest
    .spyOn(UserNotificationSettingService, "sendUserNotification")
    .mockImplementation((async (data: {
      userId: ObjectID;
      emailEnvelope: EmailEnvelope;
    }) => {
      emails.push({
        userId: data.userId.toString(),
        envelope: data.emailEnvelope,
      });
    }) as never);
  jest
    .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
    .mockResolvedValue(
      URL.fromString(
        `https://oneuptime.test/dashboard/${PROJECT_ID.toString()}/on-call-duty/policies/${POLICY_ID.toString()}`,
      ) as never,
    );
  jest.spyOn(OnDutyPoliciesCache, "forgetProjects").mockResolvedValue();
  jest
    .spyOn(OnCallDutyPolicyFeedService, "createOnCallDutyPolicyFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(OnCallDutyPolicyTimeLogService, "startTimeLogForUser")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(OnCallDutyPolicyTimeLogService, "endTimeLogForUser")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(UserService, "getUserMarkdownString")
    .mockResolvedValue("**Ana**" as never);
  jest
    .spyOn(TeamMemberService, "getUsersInTeam")
    .mockResolvedValue([person()] as never);
  /*
   * Who each rule pages is not read here (EscalationRuleReach, #10464):
   * every hook then tells as it always did - a team added to a rule its
   * accepted members - which is what these emails' words are read off.
   */
  jest.spyOn(EscalationRuleReach, "readOrNull").mockResolvedValue(null);
  jest
    .spyOn(EscalationRuleReach, "readEach")
    .mockResolvedValue(new Map<string, RuleReach | null>());
  jest.spyOn(EscalationRuleReach, "readMembers").mockResolvedValue({
    isMember: (): boolean => {
      return true;
    },
  } as RuleMembers);
  jest
    .spyOn(TeamMemberService, "getUsersInTeams")
    .mockResolvedValue([person()] as never);
  jest
    .spyOn(OnCallDutyPolicyScheduleService, "getCurrentUserIdInSchedule")
    .mockResolvedValue(ANA as never);
  // Attaching or detaching a schedule brings its roster up to date first.
  jest
    .spyOn(
      OnCallDutyPolicyEscalationRuleScheduleService as never,
      "refreshScheduleRoster" as never,
    )
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(
      OnCallDutyPolicyEscalationRuleScheduleService as never,
      "propagateAttachmentChange" as never,
    )
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("You have been ADDED to / REMOVED from On-Call Policy", () => {
  const CASES: Array<{
    name: string;
    service: unknown;
    hook: "onCreateSuccess" | "onDeleteSuccess";
    templateType: EmailTemplateType;
    row: () => unknown;
    // The More Information row's text, which names the team or schedule.
    reasonContains: string;
  }> = [
    {
      name: "a person added to a rule",
      service: OnCallDutyPolicyEscalationRuleUserService,
      hook: "onCreateSuccess",
      templateType: EmailTemplateType.UserAddedToOnCallPolicy,
      row: () => {
        return userRow({ policy: POLICY_NAME, rule: RULE_NAME });
      },
      reasonContains: "You have been added",
    },
    {
      name: "a person removed from a rule",
      service: OnCallDutyPolicyEscalationRuleUserService,
      hook: "onDeleteSuccess",
      templateType: EmailTemplateType.UserRemovedFromOnCallPolicy,
      row: () => {
        return userRow({ policy: POLICY_NAME, rule: RULE_NAME });
      },
      reasonContains: "You have been removed",
    },
    {
      name: "a team added to a rule",
      service: OnCallDutyPolicyEscalationRuleTeamService,
      hook: "onCreateSuccess",
      templateType: EmailTemplateType.UserAddedToOnCallPolicy,
      row: () => {
        return teamRow({
          policy: POLICY_NAME,
          rule: RULE_NAME,
          team: TEAM_NAME,
        });
      },
      reasonContains: ESCAPED_TEAM,
    },
    {
      name: "a team removed from a rule",
      service: OnCallDutyPolicyEscalationRuleTeamService,
      hook: "onDeleteSuccess",
      templateType: EmailTemplateType.UserRemovedFromOnCallPolicy,
      row: () => {
        return teamRow({
          policy: POLICY_NAME,
          rule: RULE_NAME,
          team: TEAM_NAME,
        });
      },
      reasonContains: ESCAPED_TEAM,
    },
    {
      name: "a schedule added to a rule",
      service: OnCallDutyPolicyEscalationRuleScheduleService,
      hook: "onCreateSuccess",
      templateType: EmailTemplateType.UserAddedToOnCallPolicy,
      row: () => {
        return scheduleRow({
          policy: POLICY_NAME,
          rule: RULE_NAME,
          schedule: SCHEDULE_NAME,
        });
      },
      reasonContains: ESCAPED_SCHEDULE,
    },
    {
      name: "a schedule removed from a rule",
      service: OnCallDutyPolicyEscalationRuleScheduleService,
      hook: "onDeleteSuccess",
      templateType: EmailTemplateType.UserRemovedFromOnCallPolicy,
      row: () => {
        return scheduleRow({
          policy: POLICY_NAME,
          rule: RULE_NAME,
          schedule: SCHEDULE_NAME,
        });
      },
      reasonContains: ESCAPED_SCHEDULE,
    },
  ];

  test.each(CASES)(
    "REGRESSION: $name - every name with markup in it reads as written, and adds no link",
    async (data: (typeof CASES)[number]) => {
      await runHook(data.service, data.hook, data.row());

      const html: string = onlyEmail(data.templateType);

      expectNoLiveMarkup(html);

      const rows: Array<{ label: string; value: string }> = rowsOf(html);

      expect(rows.slice(0, 3)).toEqual([
        { label: "On-Call Policy:", value: ESCAPED_POLICY },
        { label: "Escalation Rule:", value: ESCAPED_RULE },
        { label: "Escalation Order:", value: "1" },
      ]);
      expect(rows[3]!.label).toBe("More Information:");
      expect(rows[3]!.value).toContain(data.reasonContains);
      expect(rows).toHaveLength(4);
    },
  );

  test.each(CASES)(
    "$name - plain names read exactly as they always did",
    async (data: (typeof CASES)[number]) => {
      const row: unknown = data.row();
      const named: {
        onCallDutyPolicy?: OnCallDutyPolicy;
        onCallDutyPolicyEscalationRule?: OnCallDutyPolicyEscalationRule;
        team?: Team;
        onCallDutyPolicySchedule?: OnCallDutyPolicySchedule;
      } = row as never;
      named.onCallDutyPolicy!.name = "Payments";
      named.onCallDutyPolicyEscalationRule!.name = "First line";

      if (named.team) {
        named.team.name = "SRE";
      }

      if (named.onCallDutyPolicySchedule) {
        named.onCallDutyPolicySchedule.name = "Primary";
      }

      await runHook(data.service, data.hook, row);

      const html: string = onlyEmail(data.templateType);
      const rows: Array<{ label: string; value: string }> = rowsOf(html);

      expect(rows.slice(0, 3)).toEqual([
        { label: "On-Call Policy:", value: "Payments" },
        { label: "Escalation Rule:", value: "First line" },
        { label: "Escalation Order:", value: "1" },
      ]);
      // The headline still names the policy.
      expect(html).toContain("On-Call Policy: Payments");
    },
  );

  test("the headline names a policy with markup as text too", async () => {
    await runHook(
      OnCallDutyPolicyEscalationRuleUserService,
      "onCreateSuccess",
      userRow({ policy: POLICY_NAME, rule: RULE_NAME }),
    );

    const html: string = onlyEmail(EmailTemplateType.UserAddedToOnCallPolicy);

    expect(html).toContain(
      `You have been ADDED to On-Call Policy: ${ESCAPED_POLICY}`,
    );
  });

  test("the subject is sent as written, never read as a template", async () => {
    await runHook(
      OnCallDutyPolicyEscalationRuleUserService,
      "onCreateSuccess",
      userRow({ policy: "Pay {{ments}}", rule: RULE_NAME }),
    );

    expect(emails[0]!.envelope.isSubjectLiteral).toBe(true);
    expect(emails[0]!.envelope.subject).toContain("Pay {{ments}}");
  });
});

describe("the shift reminders", () => {
  const DASHBOARD_URL: string = "https://oneuptime.test/dashboard";
  const NOW: Date = at("2026-09-03T15:00:00Z");
  const START: Date = at("2026-09-03T16:00:00Z");
  const END: Date = at("2026-09-04T16:00:00Z");

  // A shift on a schedule and policy named with markup, covering for somebody.
  function coveringShift(): MaterializedShift {
    return shift({
      scheduleId: SCHEDULE_ID.toString(),
      scheduleName: SCHEDULE_NAME,
      projectId: PROJECT_ID.toString(),
      userId: "user-ana",
      userName: "Ana",
      start: START,
      end: END,
      scheduleTimezone: "Europe/Stockholm",
      policies: [
        {
          policyId: POLICY_ID.toString(),
          policyName: POLICY_NAME,
          ruleId: RULE_ID.toString(),
          ruleName: RULE_NAME,
          ruleOrder: 1,
        },
      ],
      override: {
        originalUserId: "user-bob",
        originalUserName: PERSON_NAME,
        overrideStartsAt: START,
        overrideEndsAt: END,
      },
    });
  }

  function reminderEmail(message: ShiftReminderMessage): EmailEnvelope {
    return {
      templateType: message.templateType,
      vars: message.vars,
      subject: message.subject,
    };
  }

  const MESSAGES: Array<[string, () => ShiftReminderMessage]> = [
    [
      "a reminder",
      (): ShiftReminderMessage => {
        return OnCallShiftReminderRunner.buildReminderMessage({
          shift: coveringShift(),
          lead: 60,
          now: NOW,
          timezone: "Europe/Berlin",
          dashboardUrl: DASHBOARD_URL,
        });
      },
    ],
    [
      "a late reminder",
      (): ShiftReminderMessage => {
        return OnCallShiftReminderRunner.buildCatchUpMessage({
          shift: coveringShift(),
          now: at("2026-09-03T15:32:00Z"),
          timezone: "Europe/Berlin",
          dashboardUrl: DASHBOARD_URL,
        });
      },
    ],
  ];

  test.each(MESSAGES)(
    "REGRESSION: %s names the schedule, its policies and the person covered for as text",
    (_name: string, build: () => ShiftReminderMessage) => {
      const html: string = render(reminderEmail(build()));

      expectNoLiveMarkup(html);

      const rows: Array<{ label: string; value: string }> = rowsOf(html);

      expect(rows).toEqual(
        expect.arrayContaining([
          { label: "Schedule:", value: ESCAPED_SCHEDULE },
          { label: "On-Call Policies:", value: ESCAPED_POLICY },
          { label: "Covering For:", value: ESCAPED_PERSON },
        ]),
      );

      // The opening sentence names all three, as text.
      expect(html).toContain(ESCAPED_SCHEDULE);
      expect(html).toContain(`you are covering for ${ESCAPED_PERSON}`);
    },
  );

  test.each(MESSAGES)(
    "%s keeps its times and lead time as they read",
    (_name: string, build: () => ShiftReminderMessage) => {
      const message: ShiftReminderMessage = build();
      const rows: Array<{ label: string; value: string }> = rowsOf(
        render(reminderEmail(message)),
      );

      expect(rows).toEqual(
        expect.arrayContaining([
          {
            label: "Shift Starts At:",
            value: "Thu 3 Sep 18:00 Europe/Berlin",
          },
          { label: "Shift Ends At:", value: "Fri 4 Sep 18:00 Europe/Berlin" },
          {
            label: "Reminder Lead Time:",
            value: message.vars["leadText"]!,
          },
        ]),
      );
    },
  );

  test("REGRESSION: a reassigned shift names the schedule and who covers it now as text", () => {
    const message: ShiftReminderMessage =
      OnCallShiftReminderRunner.buildReassignedMessage({
        scheduleName: SCHEDULE_NAME,
        projectId: PROJECT_ID.toString(),
        scheduleId: SCHEDULE_ID.toString(),
        shiftStartsAt: START,
        coveredBy: PERSON_NAME,
        timezone: "Europe/Berlin",
        dashboardUrl: DASHBOARD_URL,
      });
    const html: string = render(reminderEmail(message));

    expectNoLiveMarkup(html);
    expect(rowsOf(html)).toEqual([
      { label: "Schedule:", value: ESCAPED_SCHEDULE },
      {
        label: "Shift Was Starting At:",
        value: "Thu 3 Sep 18:00 Europe/Berlin",
      },
      { label: "Now Covered By:", value: ESCAPED_PERSON },
    ]);
    expect(html).toContain(`is now covered by ${ESCAPED_PERSON}`);
  });

  test("a reassigned shift nobody covers has no Now Covered By row", () => {
    const message: ShiftReminderMessage =
      OnCallShiftReminderRunner.buildReassignedMessage({
        scheduleName: "Payments",
        projectId: PROJECT_ID.toString(),
        scheduleId: SCHEDULE_ID.toString(),
        shiftStartsAt: START,
        coveredBy: null,
        timezone: "Europe/Berlin",
        dashboardUrl: DASHBOARD_URL,
      });

    expect(
      rowsOf(render(reminderEmail(message))).map(
        (row: { label: string }): string => {
          return row.label;
        },
      ),
    ).toEqual(["Schedule:", "Shift Was Starting At:"]);
  });
});
