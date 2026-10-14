import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import {
  SECURITY_CASE_TEMPLATE_PLACEHOLDERS,
  SUMMARY_ENTITY_LIMIT,
  SecurityCaseTemplateValues,
  approvalDecidedMarkdown,
  assigneeChangedMarkdown,
  detectionAddedMarkdown,
  detectionRuleMatchMarkdown,
  playbookFinishedMarkdown,
  playbookStartedMarkdown,
  priorityChangedMarkdown,
  renderSecurityCaseTemplate,
  securityCaseSummaryMarkdown,
  statusChangedMarkdown,
  threatIntelMatchMarkdown,
} from "../../../Utils/SecurityCase/SecurityCaseMarkdown";
import { describe, expect, test } from "@jest/globals";

/*
 * Case data is attacker-reachable: a brute force picks the user names a
 * detection groups on, a connected product names its own alerts. Every
 * sentence the case feed and its notifications are written in must read
 * such text as text - never a link, an image, HTML or a chat mention.
 */

const HOSTILE: string =
  "[click me](https://evil.example) ![x](https://evil.example/p.png) <img src=x> @channel **bold**";

/*
 * Inert: outside code spans (whose content Markdown reads literally), no "["
 * or "<" is left unescaped - so no link, image or HTML can start - and the
 * hostile text is still there to read, escaped rather than dropped.
 */
function assertInert(markdown: string): void {
  let outsideCode: string = "";
  let index: number = 0;

  while (index < markdown.length) {
    if (markdown[index] === "`") {
      let fence: number = 0;

      while (markdown[index + fence] === "`") {
        fence++;
      }

      const close: number = markdown.indexOf("`".repeat(fence), index + fence);

      if (close === -1) {
        outsideCode += markdown.slice(index);
        break;
      }

      index = close + fence;
      continue;
    }

    outsideCode += markdown[index];
    index++;
  }

  for (let position: number = 0; position < outsideCode.length; position++) {
    const character: string = outsideCode[position]!;

    if (character === "[" || character === "<") {
      expect({
        character,
        escaped: outsideCode[position - 1] === "\\",
        around: outsideCode.slice(Math.max(0, position - 10), position + 10),
      }).toMatchObject({ escaped: true });
    }
  }

  expect(markdown).toContain("click me");
}

const VALUES: SecurityCaseTemplateValues = {
  number: "CASE-42",
  title: "Brute force from one IP address — 203.0.113.7",
  priority: "High",
  status: "New",
  assignee: "Maya Chen",
  url: "https://oneuptime.example/dashboard/p/security-events/cases/c",
  entities: "203.0.113.7, alice@acme.com",
  detections: "3",
};

describe("feed sentences", () => {
  test("place a hostile detection title as text", () => {
    assertInert(
      detectionAddedMarkdown({
        detectionTitle: HOSTILE,
        severity: "High",
      }).toString(),
    );
  });

  test("say what changed, from and to", () => {
    expect(
      statusChangedMarkdown({ from: "New", to: "Investigating" }).toString(),
    ).toContain("**New** to **Investigating**");
    expect(
      statusChangedMarkdown({
        from: "Investigating",
        to: "Closed",
        verdict: "False Positive",
      }).toString(),
    ).toContain("Closed as **False Positive**");
    expect(
      statusChangedMarkdown({ from: "Closed", to: "Investigating" }).toString(),
    ).toContain("Reopened as **Investigating**");
    expect(
      priorityChangedMarkdown({
        from: "Medium",
        to: "Critical",
        playbookName: "Escalate",
      }).toString(),
    ).toContain("(playbook **Escalate**)");
  });

  test("name who a case went to, or that it went to nobody", () => {
    expect(assigneeChangedMarkdown({ userName: "Maya" }).toString()).toContain(
      "Assigned to **Maya**",
    );
    expect(
      assigneeChangedMarkdown({ userName: "Maya", teamName: "SOC" }).toString(),
    ).toContain("**Maya** in **SOC**");
    expect(assigneeChangedMarkdown({ teamName: "SOC" }).toString()).toContain(
      "**SOC** queue",
    );
    expect(assigneeChangedMarkdown({}).toString()).toContain("Unassigned");
    assertInert(assigneeChangedMarkdown({ userName: HOSTILE }).toString());
  });

  test("describe playbook runs and approvals", () => {
    expect(
      playbookStartedMarkdown({
        playbookName: "Triage",
        trigger: "Case Opened",
      }).toString(),
    ).toContain("when the case opened");
    expect(
      playbookStartedMarkdown({
        playbookName: "Triage",
        trigger: "Manual",
      }).toString(),
    ).toContain("by hand");
    expect(
      playbookFinishedMarkdown({
        playbookName: "Triage",
        succeeded: 3,
        skipped: 1,
        failed: 0,
      }).toString(),
    ).toContain("3 steps ran, 1 skipped");
    expect(
      approvalDecidedMarkdown({
        playbookName: "Contain",
        stepNumber: 2,
        stepTitle: "Suspend the user in Okta",
        isApproved: false,
      }).toString(),
    ).toContain("ends the run");
  });
});

describe("detection descriptions", () => {
  test("keep the rule's own Markdown and make event text code", () => {
    const markdown: string = detectionRuleMatchMarkdown({
      ruleName: "Brute force",
      ruleDescription: "Watches for **repeated** failures.",
      matchCount: 12,
      windowStart: "Oct 14, 2026 09:00",
      windowEnd: "Oct 14, 2026 09:05",
      sampleMessage: HOSTILE,
      observables: ["203.0.113.7", HOSTILE],
    }).toString();

    expect(markdown).toContain("Watches for **repeated** failures.");
    expect(markdown).toContain("matched 12 security events");
    assertInert(markdown);
  });

  test("say the distinct count when the rule counts distinct values", () => {
    expect(
      detectionRuleMatchMarkdown({
        ruleName: "Password spraying",
        matchCount: 40,
        distinctCount: { field: "principalUser", count: 7, threshold: 5 },
        windowStart: "a",
        windowEnd: "b",
        observables: [],
      }).toString(),
    ).toContain(
      "7 distinct `principalUser` values across these events (rule threshold: 5)",
    );
  });

  test("place a feed's indicator and name as text", () => {
    const markdown: string = threatIntelMatchMarkdown({
      feedName: "Abuse feed",
      indicatorName: HOSTILE,
      indicatorValue: "203.0.113.7",
      indicatorType: "ipv4-addr",
      confidence: 90,
      matchCount: 1,
      windowStart: "a",
      windowEnd: "b",
      stixId: "indicator--1",
      sampleMessage: HOSTILE,
    }).toString();

    expect(markdown).toContain("confidence 90");
    expect(markdown).toContain("matched 1 security event between");
    assertInert(markdown);
  });
});

describe("securityCaseSummaryMarkdown", () => {
  test("links the case and lists its entities as code", () => {
    const markdown: string = securityCaseSummaryMarkdown({
      caseNumber: "CASE-42",
      title: "Brute force",
      priority: "High",
      status: "New",
      detectionCount: 1,
      entities: [{ type: SecurityEntityType.IpAddress, value: "203.0.113.7" }],
      mitreTactics: ["TA0006"],
      url: VALUES.url,
    }).toString();

    expect(markdown).toContain(`**[CASE-42](${VALUES.url})** Brute force`);
    expect(markdown).toContain("Unassigned");
    expect(markdown).toContain("1 detection");
    expect(markdown).toContain("`203.0.113.7` (IP Address)");
    expect(markdown).toContain("TA0006 Credential Access");
  });

  test("lists a bounded number of entities and counts the rest", () => {
    const entities: Array<{ type: SecurityEntityType; value: string }> = [];

    for (let index: number = 0; index < SUMMARY_ENTITY_LIMIT + 3; index++) {
      entities.push({ type: SecurityEntityType.Host, value: `host-${index}` });
    }

    const markdown: string = securityCaseSummaryMarkdown({
      caseNumber: "CASE-1",
      title: "t",
      priority: "Low",
      status: "New",
      assignee: "Maya",
      detectionCount: 2,
      entities,
      mitreTactics: [],
    }).toString();

    expect(markdown).toContain("and 3 more");
    expect(markdown).toContain("Assigned to **Maya**");
    expect(markdown).not.toContain("host-12");
  });

  test("places a hostile title as text", () => {
    assertInert(
      securityCaseSummaryMarkdown({
        caseNumber: "CASE-1",
        title: HOSTILE,
        priority: "Low",
        status: "New",
        detectionCount: 0,
        entities: [],
        mitreTactics: [],
      }).toString(),
    );
  });
});

describe("renderSecurityCaseTemplate", () => {
  test("puts the case's values in place of every placeholder it lists", () => {
    const template: string = SECURITY_CASE_TEMPLATE_PLACEHOLDERS.map(
      (item: { placeholder: string }) => {
        return item.placeholder;
      },
    ).join(" | ");

    const rendered: string = renderSecurityCaseTemplate(
      template,
      VALUES,
    ).toString();

    expect(rendered).not.toContain("{{");
    expect(rendered).toContain("CASE-42");
    expect(rendered).toContain("Maya Chen");
  });

  test("keeps the author's Markdown and tolerates spaces in a placeholder", () => {
    expect(
      renderSecurityCaseTemplate(
        "**Look at** {{ case.number }}",
        VALUES,
      ).toString(),
    ).toBe("**Look at** CASE-42");
  });

  test("leaves a placeholder that names nothing as written", () => {
    expect(
      renderSecurityCaseTemplate(
        "{{case.owner}} and {{case.constructor}}",
        VALUES,
      ).toString(),
    ).toBe("{{case.owner}} and {{case.constructor}}");
  });

  test("escapes a value that holds Markdown", () => {
    assertInert(
      renderSecurityCaseTemplate("Case: {{case.title}}", {
        ...VALUES,
        title: HOSTILE,
      }).toString(),
    );
  });

  test("renders a long template in linear time", () => {
    const template: string = "{{case.title}} ".repeat(2000);
    const started: number = Date.now();

    renderSecurityCaseTemplate(template, VALUES);

    expect(Date.now() - started).toBeLessThan(2000);
  });
});
