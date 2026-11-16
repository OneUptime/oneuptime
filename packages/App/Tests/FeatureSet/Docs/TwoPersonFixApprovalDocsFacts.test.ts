import { AI_SRE, INFRASTRUCTURE_AI_AGENTS } from "./AiDocsPages";
import {
  bold,
  englishPage,
  englishSection,
  readRepoFile,
} from "./InventoryAndApiDocsSupport";
import {
  FIX_APPROVALS_CARD_KEY,
  FixApprovalsCopy,
  TWO_APPROVALS_COLUMN,
} from "../../../FeatureSet/Dashboard/src/Components/AISettings/FixApprovalsCopy";
import { REMEDIATION_TWO_APPROVALS_COPY } from "../../../FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStepCopy";
import {
  getViewInProductTitle,
  TWO_APPROVALS_MESSAGE_NOTE,
} from "Common/Server/Utils/AutoRemediation/RemediationChatWords";
import RemediationChatMessage from "Common/Server/Utils/AutoRemediation/RemediationChatMessage";
import Project from "Common/Models/DatabaseModels/Project";
import AutoRemediationSuggestionType from "Common/Types/AutoRemediation/AutoRemediationSuggestionType";
import {
  APPROVALS_FOR_A_RISKIER_FIX,
  getRemediationApprovalsNeeded,
} from "Common/Types/AutoRemediation/RemediationApprovals";
import { KubectlCommandTier } from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import Permission from "Common/Types/Permission";
import { ResourceCommandTier } from "Common/Types/ResourceAiAgent/ResourceAiAccess";
import { describe, expect, it } from "@jest/globals";

/*
 * TWO PEOPLE APPROVE A RISKIER FIX, AND THE TIMELINE'S RECORD OF EVERY
 * CHANGE (#6148's follow-ups), as the docs say them, held to the code that
 * makes them true:
 *
 *  - the AI SRE page's section names the switch, its card and its place as
 *    the Dashboard draws them, says it is off by default and who changes it
 *    (the column's default and update list), what a riskier change is (the
 *    policies' RiskyWrite tier), what the first and second approvals do and
 *    say (the card's and the chats' words), and which fixes need one
 *    approval still (RemediationApprovals);
 *  - the rule is read as an approval is made (RemediationApproval reads the
 *    column then);
 *  - "What auto-remediation did" says the timeline lists every command of
 *    an approved plan and every undo of a rollback, where each ran and how
 *    it ended, under Show details, and never in the chats - as
 *    CommandPlanExecutor writes the list into the entry's More information,
 *    which the feed never sends to Slack or Microsoft Teams;
 *  - the Infrastructure AI Agents page sends the reader to the section,
 *    and says no riskier change runs on its own under the rule;
 *  - what an approval holds for (#6421): the plan it approved, never one
 *    person twice, a press refused when someone else approved meanwhile;
 *    and how the fix's chat message, AI Insights and AI Logs say a fix
 *    waits for its second approval (#6422).
 *
 * AiDocsTranslations holds the 16 translations to these English pages.
 */

const SECTION: string = "### Two people approve a riskier fix";
const SECTION_LINK: string = "/docs/ai/ai-sre#two-people-approve-a-riskier-fix";

// One line of text: a page's paragraph, unwrapped.
function flat(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

describe("the AI SRE page's section on two people approving a riskier fix", () => {
  const section: string = flat(englishSection(AI_SRE, SECTION));

  it("names the switch, its section and its place as the Dashboard draws them", () => {
    expect(section).toContain(
      `Turn on ${bold(FixApprovalsCopy.switchTitle)}, in the ${bold(FixApprovalsCopy.cardTitle)} section of ${bold("More settings")} on ${bold("Project Settings → AI → AI Features")}.`,
    );
    expect(FixApprovalsCopy.switchTitle).toBe(
      "Two people approve riskier fixes",
    );
    expect(FixApprovalsCopy.cardTitle).toBe("Fix approvals");

    // The card is on AI Features, in More settings, where search lands too.
    const page: string = readRepoFile(
      "App/FeatureSet/Dashboard/src/Pages/Settings/AIFeatures.tsx",
    );
    expect(page).toContain("column={TWO_APPROVALS_COLUMN}");
    expect(page).toContain("cardId={FIX_APPROVALS_CARD_KEY}");
    expect(FIX_APPROVALS_CARD_KEY).toBe("FixApprovals");
  });

  it("says it is off by default and who changes it, as the column says", () => {
    expect(section).toContain(
      "It is off by default, for new projects too, and Project Owners and Project Admins can change it.",
    );

    const project: Project = new Project();
    expect(
      project.getTableColumnMetadata(TWO_APPROVALS_COLUMN).defaultValue,
    ).toBe(false);
    expect(
      project.getColumnAccessControlFor(TWO_APPROVALS_COLUMN)?.update,
    ).toEqual([Permission.ProjectOwner, Permission.ProjectAdmin]);
  });

  it("says what a riskier change is: the policies' RiskyWrite tier, on a cluster, a resource or a cloud account", () => {
    expect(section).toContain(
      "one the command policy tiers `RiskyWrite`, such as scaling a deployment to zero or stopping an instance, on a Kubernetes cluster, an infrastructure resource or a cloud account.",
    );
    expect(KubectlCommandTier.RiskyWrite).toBe("RiskyWrite");
    expect(ResourceCommandTier.RiskyWrite).toBe("RiskyWrite");
  });

  it("says what the first approval and the second do, in the card's and the chats' words", () => {
    expect(APPROVALS_FOR_A_RISKIER_FIX).toBe(2);
    expect(section).toContain(
      "With it on, such a fix runs only once two different people approve it.",
    );
    expect(section).toContain(
      `the fix's steps show it, then ${bold(REMEDIATION_TWO_APPROVALS_COPY.needsSecondApproval)}, and`,
    );
    expect(section).toContain(
      "The second approval, by anyone else who may approve the fix, runs it, and the incident's or alert's feed names whose approval came first.",
    );
    // The card's own words, and its button for a first approval.
    expect(section).toContain(
      `its button reads ${bold("Approve")} rather than ${bold("Approve & Run")}`,
    );
    expect(REMEDIATION_TWO_APPROVALS_COPY.yoursIsTheFirst).toContain(
      "Two people must approve this riskier fix.",
    );
    expect(
      readRepoFile(
        "App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStep.tsx",
      ),
    ).toContain('title={isFirstOfTwoApprovals ? "Approve" : "Approve & Run"}');
    // The chats' message, as the server writes it.
    expect(section).toContain(
      "the fix's message in the chats says nothing runs until two people approve it.",
    );
    expect(TWO_APPROVALS_MESSAGE_NOTE).toContain(
      "Nothing runs until two people approve it.",
    );
    // The feed of a second approval names the first approver.
    expect(
      readRepoFile(
        "Common/Server/Utils/AutoRemediation/RemediationApproval.ts",
      ),
    ).toContain("mdText`, after **${firstName}** approved it first`");
  });

  it("says how the chats' message, AI Logs and AI Insights follow the first approval", () => {
    expect(section).toContain(
      "and a cluster's or a resource's AI Logs say it waits for a second approval.",
    );
    expect(
      readRepoFile(
        "App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/AI/Logs.tsx",
      ),
    ).toContain('label: "Waiting for a second approval",');

    expect(section).toContain(
      `Once the first approval is in, that message names who gave it; once the fix is approved or dismissed, it says who did, and only ${bold(getViewInProductTitle())} is left on it.`,
    );
    expect(getViewInProductTitle()).toBe("View in OneUptime");
    expect(
      RemediationChatMessage.describeMessageNote({
        approvalsNeeded: 2,
        state: { kind: "firstApproved", firstApproverName: "Maya Chen" },
      }).toString(),
    ).toContain("**Maya Chen** approved this fix first.");
    expect(
      RemediationChatMessage.describeMessageNote({
        approvalsNeeded: 2,
        state: {
          kind: "approved",
          approverName: "Sam Lee",
          firstApproverName: "Maya Chen",
        },
      }).toString(),
    ).toContain("**Sam Lee** approved this fix");
    expect(
      RemediationChatMessage.describeMessageNote({
        approvalsNeeded: 2,
        state: { kind: "dismissed", dismisserName: "Sam Lee" },
      }).toString(),
    ).toContain("**Sam Lee** dismissed this fix.");

    expect(section).toContain(
      "AI Insights, too, tells them the fix waits for someone else's approval.",
    );
    expect(
      readRepoFile(
        "App/FeatureSet/Dashboard/src/Components/AI/ActivityInsights/AiActivityInsightsData.ts",
      ),
    ).toContain(
      'one: "A fix you approved first is waiting for someone else\'s approval",',
    );
  });

  it("says what an approval holds for: its plan, two people, and a press refused when the fix moved on", () => {
    const holds: string = flat(
      englishSection(AI_SRE, SECTION).split("\n\n")[3] || "",
    );

    expect(holds).toBe(
      "Each approval holds for the fix it was given to, and nothing else. A first approval counts only for the plan it approved: if OneUptime AI changes the plan, the fix needs two approvals again. Nobody gives both approvals, whether they approve on the card, in Slack, in Microsoft Teams or through the API. If someone else approves while you are reviewing the fix, your press does nothing and asks you to review it again; and when two people approve at once, one approval is the first and the other the second, so the fix runs once.",
    );

    const neededSource: string = readRepoFile(
      "Common/Server/Utils/AutoRemediation/RemediationApprovalsNeeded.ts",
    );
    // A first approval counts only while the plan's fingerprint is the one it approved.
    expect(neededSource).toContain(
      "return suggestion.firstApprovedPlanFingerprint ===\n    getRemediationPlanFingerprint(suggestion)",
    );

    const serviceSource: string = readRepoFile(
      "Common/Server/Services/AutoRemediationSuggestionService.ts",
    );
    // The second approval's write refuses whoever gave the first.
    expect(serviceSource).toContain("public async attemptSecondApproval(");
    expect(serviceSource).toContain(
      ".andWhere('\"firstApprovedPlanFingerprint\" = :planFingerprint', {",
    );
    expect(serviceSource).toContain(
      ".andWhere('\"firstApprovedByUserId\" <> :approverId', { approverId })",
    );

    // Someone else's approval while you reviewed: nothing done, review again.
    expect(
      readRepoFile("Common/Types/AutoRemediation/RemediationApprovals.ts"),
    ).toContain(
      "approved this fix while you were reviewing it, so approving it now would run it. Nothing was done: review it again before you approve.",
    );
  });

  it("says why the first approver's press does nothing, and that anyone may still dismiss", () => {
    expect(section).toContain(
      `The person who approved first is offered no ${bold("Approve & Run")}: the card tells them the fix runs once someone else approves it too, and so does a press of theirs in a chat.`,
    );
    expect(REMEDIATION_TWO_APPROVALS_COPY.youApprovedFirst).toBe(
      "You approved it first. It runs once someone else approves it too.",
    );
    expect(section).toContain(
      "Anyone who may approve the fix can still dismiss it, whoever approved first included.",
    );
  });

  it("says the rule is read as an approval is made, and which fixes need one approval still", () => {
    expect(section).toContain(
      "The rule is read when someone approves: turned on, it holds the fixes that already wait; turned off, the next approval runs them.",
    );
    expect(
      readRepoFile(
        "Common/Server/Utils/AutoRemediation/RemediationApproval.ts",
      ),
    ).toContain("requireTwoApprovalsForRiskierFixes: true,");

    expect(section).toContain(
      "A fix through MCP servers needs two approvals too, since OneUptime cannot tell how risky a tool's change is; a fix of safe changes only and a runbook need one, as before.",
    );

    expect(
      getRemediationApprovalsNeeded({
        isTwoApprovalsRuleOn: true,
        suggestionType: AutoRemediationSuggestionType.McpToolCalls,
        hasRiskierChange: false,
      }),
    ).toBe(2);
    expect(
      getRemediationApprovalsNeeded({
        isTwoApprovalsRuleOn: true,
        suggestionType: AutoRemediationSuggestionType.Runbook,
        hasRiskierChange: true,
      }),
    ).toBe(1);

    expect(
      getRemediationApprovalsNeeded({
        isTwoApprovalsRuleOn: true,
        suggestionType: AutoRemediationSuggestionType.CommandPlan,
        hasRiskierChange: false,
      }),
    ).toBe(1);

    expect(section).toContain(
      `With the rule on, a riskier change never runs without asking either: a cluster or a resource in ${bold("Automatic")} or ${bold("Bypass approval")} mode, or whose allowlist names the change, proposes it for two approvals instead, a change whose rollback or undo is riskier does not run on its own, and a rule that fixes through MCP servers without asking proposes its fix. Safe changes still run on their own. The rule is read again before each change OneUptime AI would make on its own, and a read that fails holds the change.`,
    );

    // The unattended round's gate, and the MCP runner's, as they read the rule.
    const tools: string = readRepoFile(
      "Common/Server/Utils/AI/Remediation/RemediationCommandTools.ts",
    );
    expect(tools).toContain(
      "this project asks two people to approve one, so it never runs unattended - Bypass approval and the allowlist included.",
    );
    expect(tools).toContain(
      "The rollbackCommand is a riskier change, and this project asks two people to approve one, so it cannot run unattended.",
    );
    expect(tools).toContain(
      "isTwoApprovalsRuleOn: await this.readTwoApprovalsRule(),",
    );
    expect(
      readRepoFile(
        "Common/Server/Utils/AI/Remediation/McpRemediationRunner.ts",
      ),
    ).toContain("!(await this.asksTwoPeopleToApprove(rule.projectId!)) &&");
  });

  it("says, beside each mode that runs changes on its own, that the rule holds a riskier one", () => {
    const note: string =
      "Where the project asks two people to approve a riskier fix, a riskier change is proposed for their approval instead";

    expect(flat(englishPage(AI_SRE))).toContain(
      `What needs a human in every mode (below) still waits for one. ${note} (see [Two people approve a riskier fix](#two-people-approve-a-riskier-fix)).`,
    );
    expect(flat(englishPage(INFRASTRUCTURE_AI_AGENTS))).toContain(
      `What always needs a person still waits for one. ${note}.`,
    );
    expect(flat(englishPage(AI_SRE))).toContain(
      "and to let a rule that fixes without asking make their changes itself, unless the project asks two people to approve a riskier fix: then it proposes them for two approvals.",
    );
  });
});

describe("the timeline's record of every command and every undo", () => {
  const did: string = flat(
    englishSection(AI_SRE, "## What auto-remediation did"),
  );

  it("says the entry lists each command and each undo, where it ran and how it ended, as the executor writes them", () => {
    expect(did).toContain(
      "Once an approved plan has run, its entry lists each command in the order it ran, with where it ran and how it ended, and a rollback's entry lists each undo the same way, with the command it undid.",
    );

    const executor: string = readRepoFile(
      "Common/Server/Utils/AutoRemediation/CommandPlanExecutor.ts",
    );
    expect(executor).toContain("**Commands, in the order they ran**");
    expect(executor).toContain(
      "**Rollback commands, in the order they were tried**",
    );
    expect(executor).toContain(
      "moreInformationInMarkdown: this.describeCommandsRun(plan),",
    );
    expect(executor).toContain(
      "moreInformationInMarkdown: this.describeRollbacksRun(plan),",
    );
  });

  it("says the list is under Show details, on the timeline only, never in the chats", () => {
    expect(did).toContain(
      `The list is under the entry's ${bold("Show details")}, on the timeline only: the incident's or alert's Slack and Microsoft Teams channels get at most the entry's one line, never the list.`,
    );

    /*
     * At most: a rollback's entry always goes to the chats, a plan's only
     * when it did not complete.
     */
    const executor: string = readRepoFile(
      "Common/Server/Utils/AutoRemediation/CommandPlanExecutor.ts",
    );
    const runEntry: string = executor.slice(
      executor.indexOf(
        "moreInformationInMarkdown: this.describeCommandsRun(plan),",
      ),
    );
    const rollbackEntry: string = executor.slice(
      executor.indexOf(
        "moreInformationInMarkdown: this.describeRollbacksRun(plan),",
      ),
    );

    expect(runEntry.slice(0, runEntry.indexOf("});"))).toContain(
      "pingWorkspace: failed || settledMidPlan,",
    );
    expect(rollbackEntry.slice(0, rollbackEntry.indexOf("});"))).toContain(
      "pingWorkspace: true,",
    );

    // The timeline's details press, by default.
    expect(readRepoFile("Common/UI/Components/Feed/FeedItem.tsx")).toContain(
      'const DEFAULT_DETAILS_LABEL: string = translationKey("Show details");',
    );

    /*
     * The feed sends its channels the entry's line alone: the workspace
     * message is built from feedInfoInMarkdown, never More information.
     */
    for (const service of [
      "Common/Server/Services/IncidentFeedService.ts",
      "Common/Server/Services/AlertFeedService.ts",
    ]) {
      const source: string = readRepoFile(service);
      const callAt: number = source.indexOf(
        "await this.sendWorkspaceNotification({",
      );
      const methodAt: number = source.indexOf(
        "public async sendWorkspaceNotification(data: {",
      );

      expect(callAt).toBeGreaterThan(-1);
      expect(methodAt).toBeGreaterThan(-1);

      const call: string = source.slice(callAt);
      const method: string = source.slice(methodAt);

      // The call hands over the entry's line...
      expect(call.slice(0, call.indexOf("});"))).toContain(
        "feedInfoInMarkdown: data.feedInfoInMarkdown,",
      );
      // ...and neither it nor the method it calls takes More information.
      expect(call.slice(0, call.indexOf("});"))).not.toContain(
        "moreInformationInMarkdown",
      );
      expect(
        method.slice(0, method.indexOf("}): Promise<void>")),
      ).not.toContain("moreInformationInMarkdown");
    }
  });
});

describe("the Infrastructure AI Agents page", () => {
  it("sends the reader to the AI SRE page's section from what always needs a person", () => {
    const page: string = englishPage(INFRASTRUCTURE_AI_AGENTS);
    const safeRiskierNever: string = flat(
      englishSection(INFRASTRUCTURE_AI_AGENTS, "### Safe, riskier and never"),
    );

    expect(safeRiskierNever).toContain(
      `A project can also ask two people to approve a fix that holds a riskier change; then no riskier change runs on its own, the allowlist and Bypass approval included: see [Two people approve a riskier fix](${SECTION_LINK}).`,
    );
    expect(englishPage(AI_SRE)).toContain(SECTION);
    expect(page.split(SECTION_LINK).length - 1).toBe(1);
  });
});
