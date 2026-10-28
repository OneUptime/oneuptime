import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import {
  SecurityCaseMessage,
  SecurityCaseMessageFacts,
  buildTargetAlertMessage,
  buildTaskAssignedMessage,
} from "Common/Server/Utils/SecurityCase/SecurityCaseNotifications";
import Color from "Common/Types/Color";
import Dictionary from "Common/Types/Dictionary";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { SecurityEntityType } from "Common/Types/SecurityCase/SecurityEntity";
import Timezone from "Common/Types/Timezone";
import {
  SecurityCaseTarget,
  SecurityCaseTargetAlertKind,
} from "Common/Utils/SecurityCase/SecurityCaseTargets";
import { htmlAsText, visibleText } from "Common/Tests/Helpers/HtmlText";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * Registers the product's real `ifCond` / `ifNotCond` / `concat` helpers on
 * the shared Handlebars instance as a side effect of import, so this suite
 * renders with the helpers MailService renders with. The partials are
 * registered from disk below.
 */
import "../../FeatureSet/Notification/Utils/Handlebars";

/*
 * THE TWO EMAILS OF A SECURITY CASE'S RESPONSE TARGETS AND TASKS, AS A
 * PERSON GETS THEM (SecurityCaseTargetDue.hbs, SecurityCaseTaskAssigned.hbs).
 * The vars come from the real builders (SecurityCaseNotifications) and are
 * rendered the way MailService renders them: the template the message
 * names, with the real partials and helpers.
 *
 *   - A target alert is headed with what happened - "CASE-142 is about to
 *     miss its acknowledge target" - as its push is; the case's title is
 *     the first row under it, then the target, when it is due in the
 *     reader's own time zone, the priority, the status, who has the case.
 *     It used to be headed "Security Case CASE-142: <title>", as every
 *     other case email is, and said what happened only in the line under it.
 *   - A task email is headed "Task for you on CASE-142", as its push is -
 *     "Task for you on security case CASE-142" broke "CASE-" from "142" at
 *     640px -,
 *     names the task first and the case's assignee as the case's - "Case
 *     Assigned To" - not the task's, which is the reader; its button opens
 *     the case's Tasks page.
 *   - A case's or a task's words with markup are shown as text, never run.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "Templates",
);

const NOW: Date = new Date("2026-10-14T12:00:00.000Z");
const CASE_URL: string =
  "https://oneuptime.example.com/dashboard/10000000-0000-4000-8000-000000000001/security-events/cases/20000000-0000-4000-8000-000000000142";
const XSS: string = '<img src=x onerror="alert(1)">Spray';

const FACTS: SecurityCaseMessageFacts = {
  caseId: new ObjectID("20000000-0000-4000-8000-000000000142"),
  projectId: new ObjectID("10000000-0000-4000-8000-000000000001"),
  number: "CASE-142",
  title: "Password spray against Okta from 203.0.113.47",
  priority: "Critical",
  priorityColor: new Color("#ef4444"),
  isCritical: true,
  status: "New",
  source: "Detection Rule",
  assignee: "Maya Chen",
  entities: [{ type: SecurityEntityType.IpAddress, value: "203.0.113.47" }],
  mitreTactics: ["TA0006"],
  detectionCount: 3,
  projectName: "Acme Commerce",
  url: CASE_URL,
  descriptionHtml: "<p>A burst of failed Okta sign-ins from one address.</p>",
};

function minutesFromNow(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * 60 * 1000);
}

const templateSource: (name: string) => string = (name: string): string => {
  return fs.readFileSync(Path.resolve(TEMPLATES_DIR, name), {
    encoding: "utf8",
  });
};

// What MailService.compileEmailBody does with the message's template and vars.
function render(message: SecurityCaseMessage): string {
  const vars: Dictionary<string | JSONObject> = {
    year: "2026",
    ...message.emailVars,
  };

  return Handlebars.compile(templateSource(message.templateType))(
    vars,
  ).toString();
}

// The email's one heading, as text.
function heading(html: string): string {
  const start: number = html.indexOf("<h1");
  const end: number = html.indexOf("</h1>", start);

  return htmlAsText(html.slice(start, end + "</h1>".length)).trim();
}

function targetAlert(data: {
  target: SecurityCaseTarget;
  alertKind: SecurityCaseTargetAlertKind;
  facts?: SecurityCaseMessageFacts;
}): SecurityCaseMessage {
  const isMissed: boolean =
    data.alertKind === SecurityCaseTargetAlertKind.Missed;
  const isAcknowledge: boolean = data.target === SecurityCaseTarget.Acknowledge;

  return buildTargetAlertMessage({
    facts: data.facts || FACTS,
    target: data.target,
    alertKind: data.alertKind,
    dueAt: isMissed
      ? minutesFromNow(-1)
      : minutesFromNow(isAcknowledge ? 3 : 48),
    targetInMinutes: isAcknowledge ? 15 : 240,
    now: NOW,
    timezone: Timezone.EuropeLondon,
    audience: { isOnCase: true, teamName: "SOC Tier 2" },
  });
}

beforeAll(() => {
  const partialsDir: string = Path.resolve(TEMPLATES_DIR, "Partials");

  for (const filename of fs.readdirSync(partialsDir)) {
    if (!filename.endsWith(".hbs")) {
      continue;
    }

    Handlebars.registerPartial(
      filename.slice(0, -".hbs".length),
      fs.readFileSync(Path.resolve(partialsDir, filename), {
        encoding: "utf8",
      }),
    );
  }
});

describe("the email when a security case is about to miss, or misses, a response target", () => {
  test("is its own template", () => {
    const message: SecurityCaseMessage = targetAlert({
      target: SecurityCaseTarget.Acknowledge,
      alertKind: SecurityCaseTargetAlertKind.AtRisk,
    });

    expect(message.templateType).toBe(EmailTemplateType.SecurityCaseTargetDue);
    expect(
      fs.existsSync(Path.resolve(TEMPLATES_DIR, message.templateType)),
    ).toBe(true);
  });

  test("is headed with what happened, as its push is, and says what is left under it", () => {
    const atRisk: SecurityCaseMessage = targetAlert({
      target: SecurityCaseTarget.Acknowledge,
      alertKind: SecurityCaseTargetAlertKind.AtRisk,
    });
    const atRiskHtml: string = render(atRisk);

    expect(heading(atRiskHtml)).toBe(
      "CASE-142 is about to miss its acknowledge target",
    );
    expect(heading(atRiskHtml)).toBe(atRisk.pushTitle);
    expect(visibleText(atRiskHtml)).toContain(
      "Nobody has taken this Critical security case on yet, and its acknowledge target is due in 3 minutes.",
    );

    const missedHtml: string = render(
      targetAlert({
        target: SecurityCaseTarget.Contain,
        alertKind: SecurityCaseTargetAlertKind.Missed,
      }),
    );

    expect(heading(missedHtml)).toBe("CASE-142 missed its contain target");
    expect(visibleText(missedHtml)).toContain(
      "This Critical security case is not contained yet, and it missed its contain target of 4 hours.",
    );
  });

  test("lists the case, the target, when it is due in the reader's time zone, and the case's state, in that order", () => {
    const text: string = visibleText(
      render(
        targetAlert({
          target: SecurityCaseTarget.Acknowledge,
          alertKind: SecurityCaseTargetAlertKind.AtRisk,
        }),
      ),
    );

    const rows: Array<string> = [
      "Case: Password spray against Okta from 203.0.113.47",
      "Target: Acknowledge within 15 minutes",
      // 12:03 UTC is 1:03 PM in London on Oct 14 (summer time).
      "Due: Oct 14 2026, 01:03 PM BST",
      "Priority: Critical",
      "Status: New",
      "Assigned To: Maya Chen",
      "Entities: 203.0.113.47",
      "Project: Acme Commerce",
    ];
    let from: number = 0;

    for (const row of rows) {
      const at: number = text.indexOf(row, from);

      expect(at).toBeGreaterThanOrEqual(from);
      from = at + row.length;
    }
  });

  test("says why it came, opens the case, and leaves nothing unfilled", () => {
    const html: string = render(
      targetAlert({
        target: SecurityCaseTarget.Acknowledge,
        alertKind: SecurityCaseTargetAlertKind.AtRisk,
      }),
    );

    expect(visibleText(html)).toContain(
      "You are on SOC Tier 2, the team this case is assigned to.",
    );
    expect(html).toContain(`href="${CASE_URL}"`);
    expect(visibleText(html)).toContain("View Case");
    expect(html).not.toContain("{{");
  });

  test("a case title with markup is shown as text, never run", () => {
    const html: string = render(
      targetAlert({
        target: SecurityCaseTarget.Acknowledge,
        alertKind: SecurityCaseTargetAlertKind.Missed,
        facts: { ...FACTS, title: XSS },
      }),
    );

    expect(html).not.toContain("<img src=x");
    expect(visibleText(html)).toContain(XSS);
  });
});

describe("the email when a task on a security case is assigned to the reader", () => {
  function taskEmail(
    data: { taskTitle?: string; assignedBy?: string } = {},
  ): string {
    return render(
      buildTaskAssignedMessage({
        facts: FACTS,
        taskTitle: data.taskTitle || "Reset the sprayed accounts' passwords",
        assignedBy: data.assignedBy ?? "Diego Alvarez",
        tasksUrl: `${CASE_URL}/tasks`,
      }),
    );
  }

  test("is headed as a task for the reader, and says who assigned it", () => {
    const html: string = taskEmail();

    expect(heading(html)).toBe("Task for you on CASE-142");
    expect(visibleText(html)).toContain(
      "Diego Alvarez assigned you a task on this Critical security case.",
    );
  });

  test("names the task first, and the case's assignee as the case's", () => {
    const text: string = visibleText(taskEmail());

    expect(text.indexOf("Task: Reset the sprayed accounts' passwords")).toBe(
      text.indexOf("Task:"),
    );
    expect(text.indexOf("Task:")).toBeLessThan(text.indexOf("Case:"));
    // The task is the reader's: an "Assigned To" row of the case's assignee read as the task's.
    expect(text).toContain("Case Assigned To: Maya Chen");
    expect(text.split("Assigned To:").length).toBe(
      text.split("Case Assigned To:").length,
    );
  });

  test("opens the case's Tasks page", () => {
    const html: string = taskEmail();

    expect(html).toContain(`href="${CASE_URL}/tasks"`);
    expect(visibleText(html)).toContain("View Tasks");
    expect(html).not.toContain("{{");
  });

  test("a task title with markup is shown as text, never run", () => {
    const html: string = taskEmail({ taskTitle: XSS });

    expect(html).not.toContain("<img src=x");
    expect(visibleText(html)).toContain(XSS);
  });
});
