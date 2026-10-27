import OperatorSlackNotice, {
  BalanceAdjustedNotice,
  BalanceRefilledNotice,
  ProjectCreatedNotice,
  ProjectDeletedNotice,
  ProjectPlanChangedNotice,
} from "../../../Server/Utils/OperatorSlackNotice";
import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import logger from "../../../Server/Utils/Logger";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import BalanceAdjustmentType from "../../../Types/Billing/BalanceAdjustmentType";
import ProjectBalanceType from "../../../Types/Billing/ProjectBalanceType";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import SubscriptionStatus from "../../../Types/Billing/SubscriptionStatus";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import {
  SlackWebhookMessages,
  captureSlackWebhookMessages,
  shownInSlack,
  shownLines,
} from "../TestingUtils/SlackWebhookMessages";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * OperatorSlackNotice: what the operator's own Slack channels are told - a
 * user created; a project created, its plan changed, the subscriptions a
 * plan change could not cancel, a balance refilled or adjusted, the project
 * deleted with the feedback its owner gave - and how it is posted.
 *
 * - Each message keeps the lines it always had, in the order it had them.
 * - Both balances read the same, title apart, so a refill of AI credits is
 *   told exactly as one of SMS and call balance is.
 * - Every value is text: a user, a company or a project named "<!channel>",
 *   or feedback with a mention, a link or Slack formatting in it, neither
 *   notifies anyone nor reshapes the message.
 * - The feedback is quoted, every line of it, as the message's last part.
 * - Posting never throws: what the message is about has happened already.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0422f23a-8ef7-4321-843e-ecfee893f5dc",
);
const ADMIN_ID: ObjectID = new ObjectID("3e000000-0000-4000-8000-0000000000a1");
const USER_ID: ObjectID = new ObjectID("5c000000-0000-4000-8000-0000000000b2");
const WEBHOOK_URL: string =
  "https://hooks.slack.com/services/T000/B000/operator-channel";

// The text as Slack shows it (TestingUtils/SlackWebhookMessages).
function readable(text: string): string {
  return shownInSlack(text);
}

function lines(text: string): Array<string> {
  return shownLines(text);
}

// The lines quoted under "Deletion Feedback", as Slack shows them.
function feedbackLines(text: string): Array<string> {
  const all: Array<string> = lines(text);

  return all.slice(all.indexOf("*Deletion Feedback:*") + 1);
}

function makeProject(values: Partial<Record<string, unknown>> = {}): Project {
  const project: Project = new Project();
  project.id = PROJECT_ID;
  project.name = "Kerberos Compliance Platform";

  for (const [column, value] of Object.entries(values)) {
    (project as unknown as Record<string, unknown>)[column] = value;
  }

  return project;
}

function refill(
  overrides: Partial<BalanceRefilledNotice> = {},
): BalanceRefilledNotice {
  return {
    balance: ProjectBalanceType.AI,
    project: makeProject(),
    amountInUSD: 20,
    currentBalanceInUSD: 20,
    isAutomatic: false,
    ...overrides,
  };
}

function adjustment(
  overrides: Partial<BalanceAdjustedNotice> = {},
): BalanceAdjustedNotice {
  return {
    balance: ProjectBalanceType.AI,
    projectId: PROJECT_ID,
    project: makeProject(),
    adjustmentType: BalanceAdjustmentType.Add,
    amountInUSDCents: 1000,
    previousBalanceInUSDCents: 2500,
    newBalanceInUSDCents: 3500,
    reason: "Goodwill credit agreed on ticket 4821",
    adjustedByUserId: ADMIN_ID,
    adjustedByUser: null,
    ...overrides,
  };
}

function makeCreator(name: string, email: string): User {
  const user: User = new User();
  user.name = new Name(name);
  user.email = new Email(email);
  return user;
}

function deletion(
  overrides: Partial<ProjectDeletedNotice> = {},
): ProjectDeletedNotice {
  return {
    project: makeProject({
      createdAt: new Date("2026-01-15T10:30:00.000Z"),
      planName: "Growth",
      createdByUser: makeCreator("Jane Doe", "jane@acme.example"),
    }),
    subscriptionStatus: "active",
    deletionReason: "Too expensive for our team.",
    ...overrides,
  };
}

// A user as created: signed up with every detail the form asks for.
function makeUser(values: Partial<Record<string, unknown>> = {}): User {
  const user: User = new User();
  user.id = USER_ID;
  user.email = new Email("jane@acme.example");
  user.name = new Name("Jane Doe");
  user.companyPhoneNumber = new Phone("+15551234567");
  user.companyName = "Acme Compliance Ltd";

  for (const [column, value] of Object.entries(values)) {
    (user as unknown as Record<string, unknown>)[column] = value;
  }

  return user;
}

// A project as it is read again once it was created, or its plan changed.
function readAgain(values: Partial<Record<string, unknown>> = {}): Project {
  return makeProject({
    createdOwnerName: new Name("Jane Doe"),
    createdOwnerEmail: new Email("jane@acme.example"),
    planName: PlanType.Growth,
    paymentProviderSubscriptionStatus: SubscriptionStatus.Trialing,
    ...values,
  });
}

function projectCreated(
  overrides: Partial<ProjectCreatedNotice> = {},
): ProjectCreatedNotice {
  return {
    project: readAgain(),
    isBillingEnabled: true,
    ...overrides,
  };
}

function planChanged(
  overrides: Partial<ProjectPlanChangedNotice> = {},
): ProjectPlanChangedNotice {
  return {
    project: readAgain({
      planName: PlanType.Scale,
      paymentProviderSubscriptionStatus: SubscriptionStatus.Active,
    }),
    isBillingEnabled: true,
    ...overrides,
  };
}

/*
 * Who created a project, as the project row has them: both, either, or
 * neither of the two (a creator with no name - invited, or signed in with
 * SSO - has only their email).
 */
const CREATORS: Array<
  [string, Partial<Record<string, unknown>>, string | null]
> = [
  [
    "name and email",
    {
      createdOwnerName: new Name("Jane Doe"),
      createdOwnerEmail: new Email("jane@acme.example"),
    },
    "Jane Doe (jane@acme.example)",
  ],
  [
    "email only",
    {
      createdOwnerName: undefined,
      createdOwnerEmail: new Email("jane@acme.example"),
    },
    "jane@acme.example",
  ],
  [
    "name only",
    { createdOwnerName: new Name("Jane Doe"), createdOwnerEmail: undefined },
    "Jane Doe",
  ],
  [
    "neither",
    { createdOwnerName: undefined, createdOwnerEmail: undefined },
    null,
  ],
];

/*
 * A name a person may give - themselves, their company, their project -
 * that would act in Slack if it were placed as it is: a mention of the
 * channel or a person, a link that hides where it goes.
 */
const HOSTILE_NAME: string =
  "<!channel> <!here> <@U012AB3CD> <#C024BE91L> <https://evil.example/login|Reset your password> AT&T";

// What HOSTILE_NAME would do in Slack: none of it may reach the text.
const SLACK_CONTROLS: Array<string> = [
  "<!channel>",
  "<!here>",
  "<@U012AB3CD>",
  "<#C024BE91L>",
  "<https://evil.example",
];

function expectNoSlackControls(text: string): void {
  for (const control of SLACK_CONTROLS) {
    expect(text).not.toContain(control);
  }
}

/*
 * What a customer may type into "Why are you deleting this project?" that
 * would act in Slack if it were placed as it is: a mention of the channel
 * or a person, a link that hides where it goes, formatting.
 */
const HOSTILE_TEXT: string = [
  "<!channel> <!here> <!everyone>",
  "<@U012AB3CD> <#C024BE91L>",
  "<https://evil.example/login|Reset your password>",
  "[click me](https://evil.example)",
  "*bold* _italic_ ~strike~ `code` ```fenced```",
  "> a quote of my own",
  "# a heading",
  "AT&T",
].join("\n");

describe("OperatorSlackNotice.formatUsd", () => {
  test.each([
    [20, "$20 USD"],
    [0, "$0 USD"],
    [-0, "$0 USD"],
    [20.5, "$20.50 USD"],
    [21.5, "$21.50 USD"],
    [0.01, "$0.01 USD"],
    [2015 / 100, "$20.15 USD"],
    [0.1 + 0.2, "$0.30 USD"],
    [1000000, "$1000000 USD"],
    [-1.5, "-$1.50 USD"],
    [-20, "-$20 USD"],
  ])("%p reads %p", (amount: number, expected: string) => {
    expect(OperatorSlackNotice.formatUsd(amount)).toBe(expected);
  });

  test.each([NaN, Infinity, -Infinity])(
    "%p is not an amount: N/A",
    (amount: number) => {
      expect(OperatorSlackNotice.formatUsd(amount)).toBe("N/A");
    },
  );
});

describe("OperatorSlackNotice.getBalanceRefilledText", () => {
  test("an AI refill reads as the SMS and call one always has, in the order it always had", () => {
    const text: string = OperatorSlackNotice.getBalanceRefilledText(
      refill({
        project: makeProject({
          createdOwnerName: new Name("Jane Doe"),
          createdOwnerEmail: new Email("jane@acme.example"),
        }),
        amountInUSD: 20,
        currentBalanceInUSD: 21.5,
      }),
    );

    expect(lines(text)).toEqual([
      "*AI Balance Refilled:*",
      "*Project Name:* Kerberos Compliance Platform",
      `*Project ID:* ${PROJECT_ID.toString()}`,
      "*Refill Amount:* $20 USD",
      "*Current Balance:* $21.50 USD",
      "*Recharge Type:* Manual",
      "*Project Created By:* Jane Doe (jane@acme.example)",
    ]);
  });

  test.each([
    [ProjectBalanceType.AI, "*AI Balance Refilled:*"],
    [ProjectBalanceType.SmsOrCall, "*SMS and Call Balance Refilled:*"],
  ])(
    "a %s refill is titled %p",
    (balance: ProjectBalanceType, title: string) => {
      const text: string = OperatorSlackNotice.getBalanceRefilledText(
        refill({ balance }),
      );

      expect(lines(text)[0]).toBe(title);
    },
  );

  test("both balances say the same, title apart", () => {
    const ai: Array<string> = lines(
      OperatorSlackNotice.getBalanceRefilledText(
        refill({ balance: ProjectBalanceType.AI, isAutomatic: true }),
      ),
    );
    const sms: Array<string> = lines(
      OperatorSlackNotice.getBalanceRefilledText(
        refill({ balance: ProjectBalanceType.SmsOrCall, isAutomatic: true }),
      ),
    );

    expect(ai.slice(1)).toEqual(sms.slice(1));
  });

  test("says whether Auto Recharge added it or somebody pressed Recharge", () => {
    expect(
      readable(
        OperatorSlackNotice.getBalanceRefilledText(
          refill({ isAutomatic: true }),
        ),
      ),
    ).toContain("*Recharge Type:* Auto Recharge");

    expect(
      readable(
        OperatorSlackNotice.getBalanceRefilledText(
          refill({ isAutomatic: false }),
        ),
      ),
    ).toContain("*Recharge Type:* Manual");
  });

  test("names whoever created the project with what is known of them", () => {
    const withName: string = readable(
      OperatorSlackNotice.getBalanceRefilledText(
        refill({
          project: makeProject({ createdOwnerName: new Name("Jane Doe") }),
        }),
      ),
    );
    const withEmail: string = readable(
      OperatorSlackNotice.getBalanceRefilledText(
        refill({
          project: makeProject({
            createdOwnerEmail: new Email("jane@acme.example"),
          }),
        }),
      ),
    );

    expect(withName).toContain("*Project Created By:* Jane Doe");
    expect(withEmail).toContain("*Project Created By:* jane@acme.example");
  });

  test("leaves the creator out when nothing is known of them", () => {
    const text: string = OperatorSlackNotice.getBalanceRefilledText(refill());

    expect(text).not.toContain("Project Created By");
    expect(lines(text)).toHaveLength(6);
  });

  test("a project whose name was not read is N/A", () => {
    const project: Project = makeProject();
    delete project.name;

    expect(
      readable(OperatorSlackNotice.getBalanceRefilledText(refill({ project }))),
    ).toContain("*Project Name:* N/A");
  });

  test("a balance taken below zero reads as owed", () => {
    expect(
      readable(
        OperatorSlackNotice.getBalanceRefilledText(
          refill({ amountInUSD: 20, currentBalanceInUSD: -1.5 }),
        ),
      ),
    ).toContain("*Current Balance:* -$1.50 USD");
  });

  test("a project's name is text: it notifies nobody and links nowhere", () => {
    const text: string = OperatorSlackNotice.getBalanceRefilledText(
      refill({
        project: makeProject({
          name: "<!channel> Acme & Co <https://evil.example|pay here>",
          createdOwnerName: new Name("<@U012AB3CD>"),
          createdOwnerEmail: new Email("jane@acme.example"),
        }),
      }),
    );

    // No "<" of theirs reaches Slack: nothing in the name is a mention or a link.
    expect(text).not.toContain("<!channel>");
    expect(text).not.toContain("<https://evil.example");
    expect(text).not.toContain("<@U012AB3CD>");

    // And it reads as it was typed.
    expect(lines(text)).toContain(
      "*Project Name:* <!channel> Acme & Co <https://evil.example|pay here>",
    );
    expect(lines(text)).toContain(
      "*Project Created By:* <@U012AB3CD> (jane@acme.example)",
    );
  });
});

describe("OperatorSlackNotice.getBalanceAdjustedText", () => {
  test("an adjustment reads with the balance before and after, who and why", () => {
    const text: string = OperatorSlackNotice.getBalanceAdjustedText(
      adjustment({
        adjustedByUser: makeCreator("Ops Admin", "ops@oneuptime.example"),
      }),
    );

    expect(lines(text)).toEqual([
      "*AI Balance Adjusted:*",
      "*Project Name:* Kerberos Compliance Platform",
      `*Project ID:* ${PROJECT_ID.toString()}`,
      "*Adjustment:* Added $10 USD",
      "*Previous Balance:* $25 USD",
      "*New Balance:* $35 USD",
      "*Adjusted By:* Ops Admin (ops@oneuptime.example)",
      "*Reason:* Goodwill credit agreed on ticket 4821",
    ]);
  });

  test.each([
    [ProjectBalanceType.AI, "*AI Balance Adjusted:*"],
    [ProjectBalanceType.SmsOrCall, "*SMS and Call Balance Adjusted:*"],
  ])(
    "a %s adjustment is titled %p",
    (balance: ProjectBalanceType, title: string) => {
      expect(
        lines(
          OperatorSlackNotice.getBalanceAdjustedText(adjustment({ balance })),
        )[0],
      ).toBe(title);
    },
  );

  test.each([
    [BalanceAdjustmentType.Add, 1000, "*Adjustment:* Added $10 USD"],
    [BalanceAdjustmentType.Deduct, 250, "*Adjustment:* Deducted $2.50 USD"],
    [BalanceAdjustmentType.Set, 0, "*Adjustment:* Set to $0 USD"],
  ])(
    "%s %p cents reads %p",
    (
      adjustmentType: BalanceAdjustmentType,
      amountInUSDCents: number,
      expected: string,
    ) => {
      expect(
        readable(
          OperatorSlackNotice.getBalanceAdjustedText(
            adjustment({ adjustmentType, amountInUSDCents }),
          ),
        ),
      ).toContain(expected);
    },
  );

  test("an admin who could not be read is named by their user ID", () => {
    expect(
      readable(
        OperatorSlackNotice.getBalanceAdjustedText(
          adjustment({ adjustedByUser: null }),
        ),
      ),
    ).toContain(`*Adjusted By:* ${ADMIN_ID.toString()}`);
  });

  test("an adjustment nobody can be named for says so", () => {
    expect(
      readable(
        OperatorSlackNotice.getBalanceAdjustedText(
          adjustment({ adjustedByUser: null, adjustedByUserId: undefined }),
        ),
      ),
    ).toContain("*Adjusted By:* Unknown");
  });

  test("a project that could not be read still names its ID", () => {
    const text: string = readable(
      OperatorSlackNotice.getBalanceAdjustedText(adjustment({ project: null })),
    );

    expect(text).toContain("*Project Name:* N/A");
    expect(text).toContain(`*Project ID:* ${PROJECT_ID.toString()}`);
  });

  test("a reason over several lines keeps them, as text", () => {
    const text: string = readable(
      OperatorSlackNotice.getBalanceAdjustedText(
        adjustment({
          reason: "Refund for the 12 Jan outage\n<!channel> see ticket 4821",
        }),
      ),
    );

    expect(text).toContain(
      "*Reason:* Refund for the 12 Jan outage\n<!channel> see ticket 4821",
    );
  });

  test("a reason that mentions the channel notifies nobody", () => {
    const text: string = OperatorSlackNotice.getBalanceAdjustedText(
      adjustment({ reason: "<!channel> <@U012AB3CD> see ticket 4821" }),
    );

    expect(text).not.toContain("<!channel>");
    expect(text).not.toContain("<@U012AB3CD>");
    expect(lines(text)).toContain(
      "*Reason:* <!channel> <@U012AB3CD> see ticket 4821",
    );
  });

  test("a blank reason reads as N/A", () => {
    expect(
      readable(
        OperatorSlackNotice.getBalanceAdjustedText(
          adjustment({ reason: "  " }),
        ),
      ),
    ).toContain("*Reason:* N/A");
  });
});

describe("OperatorSlackNotice.getProjectDeletedText", () => {
  test("a deletion reads with the project, its creator and the feedback quoted last", () => {
    const text: string = OperatorSlackNotice.getProjectDeletedText(deletion());

    expect(lines(text).filter(Boolean)).toEqual([
      "*Project Deleted:*",
      "*Project Name:* Kerberos Compliance Platform",
      `*Project ID:* ${PROJECT_ID.toString()}`,
      "*Project Created Date:* Thu, 15 Jan 2026 10:30:00 GMT",
      "*Project Plan Name:* Growth",
      "*Project Subscription Status:* active",
      "*Created By:* Jane Doe (jane@acme.example)",
      "*Deletion Feedback:*",
      "> Too expensive for our team.",
    ]);
  });

  test("feedback over several lines is quoted line by line, blank lines too", () => {
    const text: string = OperatorSlackNotice.getProjectDeletedText(
      deletion({
        deletionReason:
          "We moved to another tool.\r\n\r\nMissing:\n- SAML\r- Terraform",
      }),
    );

    expect(feedbackLines(text)).toEqual([
      "> We moved to another tool.",
      ">",
      "> Missing:",
      "> - SAML",
      "> - Terraform",
    ]);
  });

  test("feedback is trimmed of the blank space around it", () => {
    expect(
      readable(
        OperatorSlackNotice.getProjectDeletedText(
          deletion({ deletionReason: "\n\n   Too slow.   \n\n" }),
        ),
      ).trimEnd(),
    ).toMatch(/\*Deletion Feedback:\*\n+> Too slow\.$/);
  });

  test.each([
    ["no feedback", undefined],
    ["null feedback", null],
    ["empty feedback", ""],
    ["blank feedback", " \n\t\r\n "],
  ])(
    "%s reads as none given",
    (_case: string, deletionReason: string | null | undefined) => {
      const text: string = readable(
        OperatorSlackNotice.getProjectDeletedText(deletion({ deletionReason })),
      );

      expect(text.trimEnd().endsWith("*Deletion Feedback:* _None given_")).toBe(
        true,
      );
      expect(text).not.toContain(">");
    },
  );

  test("feedback can neither notify the channel, link anywhere nor step out of its quote", () => {
    const text: string = OperatorSlackNotice.getProjectDeletedText(
      deletion({ deletionReason: HOSTILE_TEXT }),
    );

    // No "<" the customer typed reaches Slack: no mention, no link.
    for (const control of [
      "<!channel>",
      "<!here>",
      "<!everyone>",
      "<@U012AB3CD>",
      "<#C024BE91L>",
      "<https://evil.example",
    ]) {
      expect(text).not.toContain(control);
    }

    // Every line they wrote is shown as they wrote it, inside the quote.
    expect(feedbackLines(text)).toEqual(
      HOSTILE_TEXT.split("\n").map((line: string): string => {
        return `> ${line}`;
      }),
    );
  });

  test("leaves out the subscription status when there is none", () => {
    const text: string = OperatorSlackNotice.getProjectDeletedText(
      deletion({ subscriptionStatus: null }),
    );

    expect(text).not.toContain("Subscription Status");
  });

  test("leaves out the creator when the project has none", () => {
    const project: Project = deletion().project;
    delete project.createdByUser;

    const text: string = OperatorSlackNotice.getProjectDeletedText(
      deletion({ project }),
    );

    expect(text).not.toContain("Created By");
  });

  test("a project without a creation date or a plan reads N/A for them", () => {
    const text: string = readable(
      OperatorSlackNotice.getProjectDeletedText(
        deletion({ project: makeProject() }),
      ),
    );

    expect(text).toContain("*Project Created Date:* N/A");
    expect(text).toContain("*Project Plan Name:* N/A");
  });

  test("the longest feedback the dashboard sends is quoted whole", () => {
    // ProjectAPI.MAX_DELETION_REASON_LENGTH
    const words: Array<string> = [];

    for (let index: number = 0; words.join(" ").length < 4990; index++) {
      words.push(`word${index}`);
    }

    const feedback: string = words.join(" ").substring(0, 5000);
    const text: string = OperatorSlackNotice.getProjectDeletedText(
      deletion({ deletionReason: feedback }),
    );

    expect(readable(text)).toContain(feedback.trim());
    expect(text).not.toContain("truncated");

    /*
     * One line of 5,000 characters is more than Slack's converter is given
     * to read (SlackUtil.SLOW_MARKDOWN_LIMITS), so the quote is shown as
     * written - and only the quote: the project above it still reads as it
     * always does.
     */
    expect(lines(text).slice(0, 2)).toEqual([
      "*Project Deleted:*",
      "*Project Name:* Kerberos Compliance Platform",
    ]);
    expect(lines(text)).toContain("*Deletion Feedback:*");
  });

  test("feedback longer than a Slack message can show is cut, with Slack's note, in no time", () => {
    const feedback: string = "Not what we needed.\n".repeat(50000);

    const timed: FastestRun<string> = fastestRun({
      run: (): string => {
        return OperatorSlackNotice.getProjectDeletedText(
          deletion({ deletionReason: feedback }),
        );
      },
      limitInMs: 5000,
    });
    const text: string = timed.result;

    expect(timed.inMs).toBeLessThan(5000);
    expect(text.endsWith(SlackUtil.TRUNCATED_SECTION_NOTE)).toBe(true);

    // What the webhook posts of it fits a Slack message, and says it was cut.
    const sections: Array<string> = SlackUtil.splitSectionText({ text });

    expect(sections.length).toBeLessThanOrEqual(
      SlackUtil.MAX_SECTIONS_PER_MARKDOWN_BLOCK,
    );

    for (const section of sections) {
      expect(section.length).toBeLessThanOrEqual(
        SlackUtil.SECTION_TEXT_MAX_LENGTH,
      );
    }

    expect(
      sections[sections.length - 1]?.endsWith(SlackUtil.TRUNCATED_SECTION_NOTE),
    ).toBe(true);

    // What is shown of it is still the project, as it reads, and the start of the quote.
    expect(lines(sections[0] || "").slice(0, 2)).toEqual([
      "*Project Deleted:*",
      "*Project Name:* Kerberos Compliance Platform",
    ]);
    expect(lines(text)).toContain("*Deletion Feedback:*");
    expect(readable(text)).toContain("> Not what we needed.");
  });
});

describe("OperatorSlackNotice.getUserCreatedText", () => {
  test("a new user reads as it always has: email, name, phone and company, in that order", () => {
    expect(
      lines(OperatorSlackNotice.getUserCreatedText({ user: makeUser() })),
    ).toEqual([
      "*New OneUptime User:*",
      "*Email:* jane@acme.example",
      "*Name:* Jane Doe",
      "*Phone:* +15551234567",
      "*Company:* Acme Compliance Ltd",
    ]);
  });

  test("what a user did not give reads N/A: one invited by email has only that", () => {
    const user: User = new User();
    user.email = new Email("new.member@acme.example");

    expect(lines(OperatorSlackNotice.getUserCreatedText({ user }))).toEqual([
      "*New OneUptime User:*",
      "*Email:* new.member@acme.example",
      "*Name:* N/A",
      "*Phone:* N/A",
      "*Company:* N/A",
    ]);
  });

  test("a name and a company are text: they notify nobody and link nowhere", () => {
    const text: string = OperatorSlackNotice.getUserCreatedText({
      user: makeUser({
        name: new Name(HOSTILE_NAME),
        companyName: HOSTILE_NAME,
      }),
    });

    // No "<" of theirs reaches Slack: nothing they typed is a mention or a link.
    expectNoSlackControls(text);

    // And it reads as it was typed.
    expect(lines(text)).toEqual([
      "*New OneUptime User:*",
      "*Email:* jane@acme.example",
      `*Name:* ${HOSTILE_NAME}`,
      "*Phone:* +15551234567",
      `*Company:* ${HOSTILE_NAME}`,
    ]);
  });

  test("a line break in a company name cannot add a line of its own", () => {
    const text: string = OperatorSlackNotice.getUserCreatedText({
      user: makeUser({
        companyName: "Acme\n*Name:* Somebody Else\r\n<!channel>",
      }),
    });

    expectNoSlackControls(text);
    expect(lines(text)).toEqual([
      "*New OneUptime User:*",
      "*Email:* jane@acme.example",
      "*Name:* Jane Doe",
      "*Phone:* +15551234567",
      "*Company:* Acme *Name:* Somebody Else <!channel>",
    ]);
  });
});

describe("OperatorSlackNotice.getProjectCreatedText", () => {
  test("a project created reads as it always has, in the order it always had", () => {
    expect(
      lines(OperatorSlackNotice.getProjectCreatedText(projectCreated())),
    ).toEqual([
      "*Project Created:*",
      "*Project Name:* Kerberos Compliance Platform",
      `*Project ID:* ${PROJECT_ID.toString()}`,
      "*Created By:* Jane Doe (jane@acme.example)",
      "*Plan:* Growth",
      "*Subscription Status:* trialing",
    ]);
  });

  test("where OneUptime does not bill, there is no plan to tell", () => {
    expect(
      lines(
        OperatorSlackNotice.getProjectCreatedText(
          projectCreated({ isBillingEnabled: false }),
        ),
      ),
    ).toEqual([
      "*Project Created:*",
      "*Project Name:* Kerberos Compliance Platform",
      `*Project ID:* ${PROJECT_ID.toString()}`,
      "*Created By:* Jane Doe (jane@acme.example)",
    ]);
  });

  test("a plan or a subscription status not known reads N/A", () => {
    const text: string = readable(
      OperatorSlackNotice.getProjectCreatedText(
        projectCreated({
          project: readAgain({
            planName: undefined,
            paymentProviderSubscriptionStatus: undefined,
          }),
        }),
      ),
    );

    expect(text).toContain("*Plan:* N/A");
    expect(text).toContain("*Subscription Status:* N/A");
  });

  test.each(CREATORS)(
    "a project whose creator has %s is announced, naming them by what is known",
    (
      _case: string,
      creator: Partial<Record<string, unknown>>,
      createdBy: string | null,
    ) => {
      expect(
        lines(
          OperatorSlackNotice.getProjectCreatedText(
            projectCreated({ project: readAgain(creator) }),
          ),
        ),
      ).toEqual([
        "*Project Created:*",
        "*Project Name:* Kerberos Compliance Platform",
        `*Project ID:* ${PROJECT_ID.toString()}`,
        ...(createdBy ? [`*Created By:* ${createdBy}`] : []),
        "*Plan:* Growth",
        "*Subscription Status:* trialing",
      ]);
    },
  );

  test("a project's name and its creator's are text: they notify nobody and link nowhere", () => {
    const text: string = OperatorSlackNotice.getProjectCreatedText(
      projectCreated({
        project: readAgain({
          name: HOSTILE_NAME,
          createdOwnerName: new Name("<@U012AB3CD> <!everyone>"),
        }),
      }),
    );

    expectNoSlackControls(text);
    expect(text).not.toContain("<!everyone>");

    expect(lines(text)).toContain(`*Project Name:* ${HOSTILE_NAME}`);
    expect(lines(text)).toContain(
      "*Created By:* <@U012AB3CD> <!everyone> (jane@acme.example)",
    );
  });
});

describe("OperatorSlackNotice.getProjectPlanChangedText", () => {
  test("a plan change reads as it always has, with the plan the project is on now", () => {
    expect(
      lines(OperatorSlackNotice.getProjectPlanChangedText(planChanged())),
    ).toEqual([
      "*Project Plan Changed:*",
      "*Project Name:* Kerberos Compliance Platform",
      `*Project ID:* ${PROJECT_ID.toString()}`,
      "*Project Created By:* Jane Doe (jane@acme.example)",
      "*Plan:* Scale",
      "*Subscription Status:* active",
    ]);
  });

  test("where OneUptime does not bill, there is no plan to tell", () => {
    expect(
      lines(
        OperatorSlackNotice.getProjectPlanChangedText(
          planChanged({ isBillingEnabled: false }),
        ),
      ),
    ).toEqual([
      "*Project Plan Changed:*",
      "*Project Name:* Kerberos Compliance Platform",
      `*Project ID:* ${PROJECT_ID.toString()}`,
      "*Project Created By:* Jane Doe (jane@acme.example)",
    ]);
  });

  test.each(CREATORS)(
    "a project whose creator has %s names them by what is known",
    (
      _case: string,
      creator: Partial<Record<string, unknown>>,
      createdBy: string | null,
    ) => {
      const shown: Array<string> = lines(
        OperatorSlackNotice.getProjectPlanChangedText(
          planChanged({ project: readAgain(creator) }),
        ),
      );

      expect(shown.slice(3, -2)).toEqual(
        createdBy ? [`*Project Created By:* ${createdBy}`] : [],
      );
    },
  );

  test("a project with no name read again, nor a plan, still says which one changed", () => {
    const project: Project = makeProject();
    delete project.name;

    expect(
      lines(
        OperatorSlackNotice.getProjectPlanChangedText(planChanged({ project })),
      ),
    ).toEqual([
      "*Project Plan Changed:*",
      "*Project Name:* N/A",
      `*Project ID:* ${PROJECT_ID.toString()}`,
      "*Plan:* N/A",
      "*Subscription Status:* N/A",
    ]);
  });

  test("a project's name and its creator's are text: they notify nobody and link nowhere", () => {
    const text: string = OperatorSlackNotice.getProjectPlanChangedText(
      planChanged({
        project: readAgain({
          name: HOSTILE_NAME,
          createdOwnerName: new Name("<!channel>"),
        }),
      }),
    );

    expectNoSlackControls(text);

    expect(lines(text)).toContain(`*Project Name:* ${HOSTILE_NAME}`);
    expect(lines(text)).toContain(
      "*Project Created By:* <!channel> (jane@acme.example)",
    );
  });
});

describe("OperatorSlackNotice.getSubscriptionsPendingCancellationText", () => {
  test("names the project, every subscription left open and what has to be done", () => {
    expect(
      lines(
        OperatorSlackNotice.getSubscriptionsPendingCancellationText({
          projectId: PROJECT_ID,
          subscriptionIds: ["sub_main_123", "sub_metered_456"],
        }),
      ),
    ).toEqual([
      "*Subscriptions could not be cancelled after a plan change:*",
      `*Project ID:* ${PROJECT_ID.toString()}`,
      "*Subscriptions still open at the payment provider:* sub_main_123, sub_metered_456",
      "These are no longer recorded against the project and have to be cancelled by hand.",
    ]);
  });

  test("a subscription ID is text, whatever it holds", () => {
    const text: string =
      OperatorSlackNotice.getSubscriptionsPendingCancellationText({
        projectId: PROJECT_ID,
        subscriptionIds: [
          "sub_1_live_*x*",
          "<!channel>",
          "<https://evil.example|sub_2>",
        ],
      });

    expect(text).not.toContain("<!channel>");
    expect(text).not.toContain("<https://evil.example");
    expect(lines(text)).toContain(
      "*Subscriptions still open at the payment provider:* sub_1_live_*x*, <!channel>, <https://evil.example|sub_2>",
    );
  });
});

describe("OperatorSlackNotice.post", () => {
  let slack: SlackWebhookMessages;
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    slack = captureSlackWebhookMessages();
    errorLog = jest.spyOn(logger, "error").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("posts the text to the webhook", async () => {
    await OperatorSlackNotice.post({
      webhookUrl: WEBHOOK_URL,
      text: "*AI Balance Refilled:*",
      about: "AI balance refill",
      projectId: PROJECT_ID,
    });

    expect(slack.messages).toEqual([
      { url: WEBHOOK_URL, text: "*AI Balance Refilled:*" },
    ]);
    expect(errorLog).not.toHaveBeenCalled();
  });

  test("a post Slack fails is logged with the project, never thrown", async () => {
    slack.failWith(new Error("socket hang up"));

    await expect(
      OperatorSlackNotice.post({
        webhookUrl: WEBHOOK_URL,
        text: "*AI Balance Refilled:*",
        about: "AI balance refill",
        projectId: PROJECT_ID,
      }),
    ).resolves.toBeUndefined();

    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(String(errorLog.mock.calls[0]?.[0])).toContain("AI balance refill");
    expect(String(errorLog.mock.calls[0]?.[0])).toContain("socket hang up");
    expect(errorLog.mock.calls[0]?.[1]).toEqual({
      projectId: PROJECT_ID.toString(),
    });
  });

  test("a post about a user that Slack fails is logged with the user, never thrown", async () => {
    slack.failWith(new Error("socket hang up"));

    await expect(
      OperatorSlackNotice.post({
        webhookUrl: WEBHOOK_URL,
        text: "*New OneUptime User:*",
        about: "user creation",
        userId: USER_ID,
      }),
    ).resolves.toBeUndefined();

    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(String(errorLog.mock.calls[0]?.[0])).toContain("user creation");
    expect(errorLog.mock.calls[0]?.[1]).toEqual({
      userId: USER_ID.toString(),
    });
  });

  test("a message Slack refuses is logged", async () => {
    jest
      .spyOn(SlackUtil, "sendMessageToChannelViaIncomingWebhook")
      .mockResolvedValue(
        new HTTPErrorResponse(400, { error: "invalid_blocks" }, {}),
      );

    await OperatorSlackNotice.post({
      webhookUrl: WEBHOOK_URL,
      text: "*Project Deleted:*",
      about: "project deletion",
    });

    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(String(errorLog.mock.calls[0]?.[0])).toContain("invalid_blocks");
    expect(errorLog.mock.calls[0]?.[1]).toEqual({});
  });

  test("a webhook that is not a Slack one is logged, never thrown, and never called", async () => {
    // The real sender: it refuses an address that is not Slack's before any request.
    jest.restoreAllMocks();
    errorLog = jest.spyOn(logger, "error").mockImplementation((): void => {});

    await expect(
      OperatorSlackNotice.post({
        webhookUrl: "https://intranet.example/hooks/operator",
        text: "*Project Deleted:*",
        about: "project deletion",
      }),
    ).resolves.toBeUndefined();

    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(String(errorLog.mock.calls[0]?.[0])).toContain(
      "https://hooks.slack.com/services/",
    );
  });

  test("a webhook setting that is no address at all is logged, never thrown", async () => {
    await expect(
      OperatorSlackNotice.post({
        webhookUrl: "not a webhook",
        text: "*Project Deleted:*",
        about: "project deletion",
      }),
    ).resolves.toBeUndefined();

    expect(slack.messages).toHaveLength(0);
    expect(errorLog).toHaveBeenCalledTimes(1);
  });
});
