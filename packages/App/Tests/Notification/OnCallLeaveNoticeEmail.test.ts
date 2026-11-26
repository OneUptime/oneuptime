import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import OnCallDutyPolicyService from "Common/Server/Services/OnCallDutyPolicyService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import OnCallLeaveNotices from "Common/Server/Utils/OnCall/OnCallLeaveNotices";
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
 * THE EMAIL SOMEONE WHO LEFT A TEAM GETS: ONE FOR EACH POLICY THAT STOPPED
 * PAGING THEM, NAMING EVERY RULE OF IT THE TEAM HAD PUT THEM ON (#10587).
 *
 * Leaving a team an escalation rule names tells the person once for each
 * on-call policy that pages them through nothing any more
 * (OnCallLeaveNotices), in the "You have been REMOVED from On-Call Policy"
 * email. One email names all of a policy's rules: "Escalation Rules: Level
 * 1 and Level 3", "Escalation Orders: 1 and 3", as the "added" email and
 * the hand-off emails name them; one rule's reads as that email always
 * did. The names in it are the project's own, typed by its members:
 * written as text.
 *
 * Built by the real OnCallLeaveNotices.send and rendered through the real
 * template and partials; only the send is stubbed.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "../../FeatureSet/Notification/Templates",
);

const PROJECT_ID: ObjectID = new ObjectID(
  "10587000-0000-4000-8000-000000000001",
);
const POLICY_ID: ObjectID = new ObjectID(
  "10587000-0000-4000-8000-000000000002",
);
const ANA: ObjectID = new ObjectID("10587000-0000-4000-8000-0000000000a1");

let emails: Array<EmailEnvelope>;

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

async function send(data: {
  policyName: string;
  rules: Array<{ name: string; order: number | null }>;
  teamNames: Array<string>;
}): Promise<EmailEnvelope> {
  await OnCallLeaveNotices.send({
    projectId: PROJECT_ID,
    userId: ANA,
    notice: {
      policyId: POLICY_ID,
      policyName: data.policyName,
      rules: data.rules.map((rule: { name: string; order: number | null }) => {
        return { id: ObjectID.generate(), ...rule };
      }),
      teamNames: data.teamNames,
    },
  });

  expect(emails).toHaveLength(1);

  return emails[0]!;
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

  jest
    .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
    .mockResolvedValue(
      URL.fromString(
        `https://oneuptime.test/dashboard/on-call-duty/policies/${POLICY_ID.toString()}`,
      ) as never,
    );
  jest
    .spyOn(UserNotificationSettingService, "sendUserNotification")
    .mockImplementation((async (data: { emailEnvelope: EmailEnvelope }) => {
      emails.push(data.emailEnvelope);
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the email someone who left a team gets", () => {
  test("REGRESSION: one email for a policy names every rule of it the team had put them on, under plural titles", async () => {
    const envelope: EmailEnvelope = await send({
      policyName: "Payments",
      rules: [
        { name: "Level 1", order: 1 },
        { name: "Level 3", order: 3 },
      ],
      teamNames: ["Platform"],
    });

    expect(envelope.templateType).toBe(
      EmailTemplateType.UserRemovedFromOnCallPolicy,
    );
    expect(envelope.subject).toBe(
      "You have been removed from the on-call policy Payments for team Platform",
    );
    expect(rowsOf(render(envelope))).toEqual([
      { label: "On-Call Policy:", value: "Payments" },
      { label: "Escalation Rules:", value: "Level 1 and Level 3" },
      { label: "Escalation Orders:", value: "1 and 3" },
      {
        label: "More Information:",
        value:
          "You are no longer a member of the team Platform, so this on-call policy no longer pages you.",
      },
    ]);
  });

  test("one rule reads as the email always did", async () => {
    const envelope: EmailEnvelope = await send({
      policyName: "Payments",
      rules: [{ name: "Level 1", order: 1 }],
      teamNames: ["Platform"],
    });

    expect(rowsOf(render(envelope))).toEqual([
      { label: "On-Call Policy:", value: "Payments" },
      { label: "Escalation Rule:", value: "Level 1" },
      { label: "Escalation Order:", value: "1" },
      {
        label: "More Information:",
        value:
          "You are no longer a member of the team Platform, so this on-call policy no longer pages you.",
      },
    ]);
  });

  test("several teams left at once are named together", async () => {
    const envelope: EmailEnvelope = await send({
      policyName: "Payments",
      rules: [{ name: "Level 1", order: 1 }],
      teamNames: ["Platform", "SRE"],
    });

    expect(envelope.subject).toBe(
      "You have been removed from the on-call policy Payments for teams Platform and SRE",
    );
    expect(rowsOf(render(envelope))[3]).toEqual({
      label: "More Information:",
      value:
        "You are no longer a member of the teams Platform and SRE, so this on-call policy no longer pages you.",
    });
  });

  test("the email a rule's own removal sends still reads as it always did", () => {
    const html: string = render({
      templateType: EmailTemplateType.UserRemovedFromOnCallPolicy,
      vars: {
        onCallPolicyName: "Payments",
        escalationRuleName: "Level 1",
        escalationRuleOrder: "1",
        reason:
          "You have been removed from the on-call policy escalation rule.",
        onCallPolicyViewLink: "https://oneuptime.test/policies/1",
      },
      subject: "You have been removed from the on-call policy Payments",
    } as EmailEnvelope);

    expect(rowsOf(html)).toEqual([
      { label: "On-Call Policy:", value: "Payments" },
      { label: "Escalation Rule:", value: "Level 1" },
      { label: "Escalation Order:", value: "1" },
      {
        label: "More Information:",
        value: "You have been removed from the on-call policy escalation rule.",
      },
    ]);
  });

  test("names with markup in them read as written, and add no link to the email", async () => {
    const envelope: EmailEnvelope = await send({
      policyName: "<b>Pay</b>ments",
      rules: [
        { name: "[First](https://evil.test)", order: 1 },
        { name: "<i>Escalate</i>", order: 2 },
      ],
      teamNames: ["<a href='https://evil.test'>Platform</a>"],
    });

    const html: string = render(envelope);

    expect(html).not.toContain("href='https://evil.test'");
    expect(html).not.toContain('href="https://evil.test"');
    expect(html).not.toContain("<i>Escalate</i>");
    expect(rowsOf(html)).toEqual([
      { label: "On-Call Policy:", value: "&lt;b&gt;Pay&lt;/b&gt;ments" },
      {
        label: "Escalation Rules:",
        value: "[First](https://evil.test) and &lt;i&gt;Escalate&lt;/i&gt;",
      },
      { label: "Escalation Orders:", value: "1 and 2" },
      {
        label: "More Information:",
        value:
          "You are no longer a member of the team &lt;a href&#x3D;&#x27;https://evil.test&#x27;&gt;Platform&lt;/a&gt;, so this on-call policy no longer pages you.",
      },
    ]);
  });
});
