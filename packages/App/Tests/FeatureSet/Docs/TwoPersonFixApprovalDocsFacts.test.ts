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
import { TWO_APPROVALS_MESSAGE_NOTE } from "Common/Server/Utils/AutoRemediation/RemediationChatWords";
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
 *  - the Infrastructure AI Agents page sends the reader to the section.
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
      "It is off by default, for new projects too, and project owners and admins can change it.",
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
      `the fix's steps show it, then ${bold(REMEDIATION_TWO_APPROVALS_COPY.needsSecondApproval)}.`,
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
    ).toContain("approved it first: ${running}");
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
      "A fix of safe changes only, a runbook and a fix through MCP servers need one approval, as before.",
    );

    for (const suggestionType of [
      AutoRemediationSuggestionType.Runbook,
      AutoRemediationSuggestionType.McpToolCalls,
    ]) {
      expect(
        getRemediationApprovalsNeeded({
          isTwoApprovalsRuleOn: true,
          suggestionType,
          hasRiskierChange: true,
        }),
      ).toBe(1);
    }

    expect(
      getRemediationApprovalsNeeded({
        isTwoApprovalsRuleOn: true,
        suggestionType: AutoRemediationSuggestionType.CommandPlan,
        hasRiskierChange: false,
      }),
    ).toBe(1);

    expect(section).toContain(
      `in ${bold("Automatic")} or ${bold("Bypass approval")} mode or because its allowlist names it, waits for no approval at all.`,
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
      `A project can also ask two people to approve a fix that holds a riskier change: see [Two people approve a riskier fix](${SECTION_LINK}).`,
    );
    expect(englishPage(AI_SRE)).toContain(SECTION);
    expect(page.split(SECTION_LINK).length - 1).toBe(1);
  });
});
