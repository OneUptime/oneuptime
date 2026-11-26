import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import OnCallDutyPolicyService from "Common/Server/Services/OnCallDutyPolicyService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import OnCallJoinNotices from "Common/Server/Utils/OnCall/OnCallJoinNotices";
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
 * THE EMAIL SOMEONE WHO JOINED GETS: ONE FOR EACH POLICY, NAMING EVERY RULE
 * OF IT THAT STARTED PAGING THEM (#10557).
 *
 * Joining - an invitation accepted, a team joined - tells the person once
 * for each on-call policy whose rules started paging them
 * (OnCallJoinNotices), in the "You have been ADDED to On-Call Policy"
 * email. One email names all of a policy's rules: "Escalation Rules: Level
 * 1 and Level 3", "Escalation Orders: 1 and 3", as the hand-off emails name
 * them; one rule's reads as that email always did. The names in it are the
 * project's own, typed by its members: written as text.
 *
 * Built by the real OnCallJoinNotices.send and rendered through the real
 * template and partials; only the send is stubbed.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "../../FeatureSet/Notification/Templates",
);

const PROJECT_ID: ObjectID = new ObjectID(
  "10557000-0000-4000-8000-000000000001",
);
const POLICY_ID: ObjectID = new ObjectID(
  "10557000-0000-4000-8000-000000000002",
);
const IVY: ObjectID = new ObjectID("10557000-0000-4000-8000-0000000000a4");

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
  joinedProject: boolean;
  teamName?: string;
  scheduleNames?: Array<string>;
}): Promise<EmailEnvelope> {
  await OnCallJoinNotices.send({
    projectId: PROJECT_ID,
    userId: IVY,
    notice: {
      policyId: POLICY_ID,
      policyName: data.policyName,
      rules: data.rules.map((rule: { name: string; order: number | null }) => {
        return { id: ObjectID.generate(), ...rule };
      }),
      scheduleNames: data.scheduleNames || [],
    },
    joinedProject: data.joinedProject,
    teamName: data.teamName || null,
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

describe("the email someone who joined gets", () => {
  test("REGRESSION: one email for a policy names every rule of it that started paging them, under plural titles", async () => {
    const envelope: EmailEnvelope = await send({
      policyName: "Payments",
      rules: [
        { name: "Level 1", order: 1 },
        { name: "Level 3", order: 3 },
      ],
      joinedProject: true,
    });

    expect(envelope.templateType).toBe(
      EmailTemplateType.UserAddedToOnCallPolicy,
    );
    expect(rowsOf(render(envelope))).toEqual([
      { label: "On-Call Policy:", value: "Payments" },
      { label: "Escalation Rules:", value: "Level 1 and Level 3" },
      { label: "Escalation Orders:", value: "1 and 3" },
      {
        label: "More Information:",
        value:
          "You have joined the project, so this on-call policy pages you from now on.",
      },
    ]);
  });

  test("one rule reads as the email always did", async () => {
    const envelope: EmailEnvelope = await send({
      policyName: "Payments",
      rules: [{ name: "Level 1", order: 1 }],
      joinedProject: false,
      teamName: "Platform",
    });

    expect(rowsOf(render(envelope))).toEqual([
      { label: "On-Call Policy:", value: "Payments" },
      { label: "Escalation Rule:", value: "Level 1" },
      { label: "Escalation Order:", value: "1" },
      {
        label: "More Information:",
        value:
          "You have joined the team Platform, so this on-call policy pages you from now on.",
      },
    ]);
  });

  test("the shift they joined during is named", async () => {
    const envelope: EmailEnvelope = await send({
      policyName: "Payments",
      rules: [{ name: "Level 1", order: 1 }],
      joinedProject: true,
      scheduleNames: ["Primary"],
    });

    expect(rowsOf(render(envelope))[3]).toEqual({
      label: "More Information:",
      value:
        "You have joined the project, so this on-call policy pages you from now on. You are on call now on the roster of schedule Primary.",
    });
  });

  test("names with markup in them read as written, and add no link to the email", async () => {
    const envelope: EmailEnvelope = await send({
      policyName: "<b>Pay</b>ments",
      rules: [
        { name: "[First](https://evil.test)", order: 1 },
        { name: "<i>Escalate</i>", order: 2 },
      ],
      joinedProject: false,
      teamName: "<a href='https://evil.test'>Platform</a>",
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
          "You have joined the team &lt;a href&#x3D;&#x27;https://evil.test&#x27;&gt;Platform&lt;/a&gt;, so this on-call policy pages you from now on.",
      },
    ]);
  });
});
