import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import {
  SECURITY_CASE_TEMPLATE_PLACEHOLDERS,
  SUMMARY_ENTITY_LIMIT,
  SecurityCaseTemplateValues,
  approvalDecidedMarkdown,
  assigneeChangedMarkdown,
  detectionAddedMarkdown,
  detectionOverflowMarkdown,
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

  test("a reopen is read off where the statuses sit, so leaving a project's own closing status reads as one", () => {
    expect(
      statusChangedMarkdown({
        from: "Closed - Duplicate",
        to: "Investigating",
        reopens: true,
      }).toString(),
    ).toContain("Reopened as **Investigating**");
    // Told it is no reopen, a status named Closed is not one either.
    expect(
      statusChangedMarkdown({
        from: "Closed",
        to: "Closed - Duplicate",
        reopens: false,
      }).toString(),
    ).toContain("**Closed** to **Closed - Duplicate**");
    // A renamed closing status the caller says nothing about reads as a move.
    expect(
      statusChangedMarkdown({ from: "Done", to: "Investigating" }).toString(),
    ).toContain("**Done** to **Investigating**");
    // The playbook that reopened it is named, as on every other sentence.
    expect(
      statusChangedMarkdown({
        from: "Done",
        to: "New",
        reopens: true,
        playbookName: "Reopen on new activity",
      }).toString(),
    ).toContain("Reopened as **New** (playbook **Reopen on new activity**)");
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

/*
 * The case a run opens for the groups past those with cases of their own:
 * the group values are the attacker-reachable part, so they are code.
 */
describe("detectionOverflowMarkdown", () => {
  test("names the source and the window, says what the run did, and lists some of the rest", () => {
    const markdown: string = detectionOverflowMarkdown({
      kind: "rule",
      sourceName: "Brute Force Watch",
      summary:
        "This run matched 150 groups. Alerts, incidents and cases opened for the 100 with the most matches; every one of them is a Detection Finding.",
      windowStart: "Oct 21, 2026 12:00 PM",
      windowEnd: "Oct 21, 2026 12:05 PM",
      examples: ["alice", "bob_x"],
    }).toString();

    expect(markdown).toBe(
      "**Brute Force Watch** matched more than one run opens cases for, between Oct 21, 2026 12:00 PM and Oct 21, 2026 12:05 PM.\n\n" +
        "This run matched 150 groups. Alerts, incidents and cases opened for the 100 with the most matches; every one of them is a Detection Finding.\n\n" +
        "Among the rest: `alice`, `bob_x`",
    );
  });

  test("a feed's says check, and lists at most twenty of the rest", () => {
    const examples: Array<string> = [];

    for (let index: number = 0; index < 30; index++) {
      examples.push(`host-${index}.example`);
    }

    const markdown: string = detectionOverflowMarkdown({
      kind: "feed",
      sourceName: "Abuse feed",
      summary: "This check matched 130 indicator values.",
      windowStart: "a",
      windowEnd: "b",
      examples,
    }).toString();

    expect(markdown).toContain(
      "**Abuse feed** matched more than one check opens cases for, between a and b.",
    );
    expect(markdown).toContain("`host-19.example`");
    expect(markdown).not.toContain("`host-20.example`");
  });

  test("with nothing to list, there is no list", () => {
    const markdown: string = detectionOverflowMarkdown({
      kind: "rule",
      sourceName: "Brute Force Watch",
      summary: "This run matched more than 10,000 groups.",
      windowStart: "a",
      windowEnd: "b",
      examples: [],
    }).toString();

    expect(markdown).not.toContain("Among the rest");
  });

  test("places a hostile rule name and group value as text", () => {
    assertInert(
      detectionOverflowMarkdown({
        kind: "rule",
        sourceName: HOSTILE,
        summary: "This run matched 101 groups.",
        windowStart: "a",
        windowEnd: "b",
        examples: [HOSTILE, "`backticks` [too](https://evil.example)"],
      }).toString(),
    );
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
