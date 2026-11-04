import { AI_SRE, INFRASTRUCTURE_AI_AGENTS } from "./AiDocsPages";
import {
  bold,
  englishPage,
  englishSection,
  readRepoFile,
} from "./InventoryAndApiDocsSupport";
import {
  getViewInProductTitle,
  REMEDIATION_CHAT_WORDS,
} from "Common/Server/Utils/AutoRemediation/RemediationChatWords";
import { MAX_IMPACT_SLOS } from "Common/Server/Utils/AI/SRE/InvestigationImpactContext";
import { CLOUD_ENVIRONMENT_NOUN } from "Common/Server/Utils/AI/SRE/LinkedInfrastructureContext";
import { REMEDIATION_TRACK_RECORD_LOOKBACK_DAYS } from "Common/Types/AutoRemediation/RemediationTrackRecord";
import { describeRemediationTrackRecord } from "Common/Types/AutoRemediation/RemediationTrackRecordWords";
import AiResourceType from "Common/Types/ResourceAiAgent/AiResourceType";
import { FIX_DISMISS_REFUSED_MESSAGE } from "Common/Types/Runbook/RunbookRunPermissions";
import {
  IMPACT_LINE_LABELS,
  IMPACT_SECTION_TITLE,
  RULED_OUT_SECTION_TITLE,
} from "Common/Utils/AI/InvestigationReport";
import { describeCloudChange } from "Common/Utils/AiRemediation/CloudChangeWords";
import { AI_INSIGHTS_FIX_APPROVAL_PLACES_TITLE } from "../../../FeatureSet/Dashboard/src/Components/AI/ActivityInsights/AiActivityInsightsData";
import {
  REMEDIATION_FIX_DISMISS,
  REMEDIATION_FIX_STEP_COPY,
} from "../../../FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStepCopy";
import { describe, expect, it } from "@jest/globals";

/*
 * What the docs say about approving a fix OneUptime AI proposes, and about
 * what an investigation ruled out, held to the code that makes it true:
 *
 *  - the report section the AI SRE page names is the one the persona asks
 *    for and the card reads (RULED_OUT_SECTION_TITLE);
 *  - a change's plain words and its track record, quoted on the pages, are
 *    what the code words them as, over the window the code reads;
 *  - the chat buttons the AI SRE, Slack and Microsoft Teams pages name are
 *    the ones the server writes on a fix's message (REMEDIATION_CHAT_WORDS);
 *  - an approval from a chat is checked as the card's is, and a fix that
 *    changed since its message is refused, as the approval code does;
 *  - the Slack and Microsoft Teams pages send the reader to the AI SRE
 *    page's section on it;
 *  - #5519's follow-ups: the Impact section right after the Summary and
 *    the SLOs an investigation reads for it, an alert's recurrence, an App
 *    Platforms environment named as the activity names it, a runbook's
 *    record over Approve & Run, Dismiss fix asking what approving asks, and
 *    where a fix was approved, on its step and on AI Insights.
 *
 * AiDocsTranslations and WorkspaceAndFormsDocsTranslations hold the 16
 * translations to these English pages.
 */

const SLACK: string = "workspace-connections/slack";
const TEAMS: string = "workspace-connections/microsoft-teams";

const APPROVAL_SECTION: string =
  "### Approve or dismiss a fix from Slack or Microsoft Teams";
const BEFORE_APPROVING_SECTION: string = "### Before you approve a fix";
const CHAT_SECTION: string = "## Approving a fix OneUptime AI proposes";
const APPROVAL_LINK: string =
  "/docs/ai/ai-sre#approve-or-dismiss-a-fix-from-slack-or-microsoft-teams";

// One line of text: a page's paragraph, unwrapped.
function flat(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

describe("what the investigation ruled out", () => {
  it("is the section the persona asks for and the card reads", () => {
    const posts: string = flat(
      englishSection(AI_SRE, "## What the investigation posts"),
    );

    expect(posts).toContain(
      `${bold(RULED_OUT_SECTION_TITLE)} — the other likely causes it checked`,
    );
    // Between the evidence and the next steps, as the persona orders them.
    expect(posts.indexOf(bold("Evidence"))).toBeLessThan(
      posts.indexOf(bold(RULED_OUT_SECTION_TITLE)),
    );
    expect(posts.indexOf(bold(RULED_OUT_SECTION_TITLE))).toBeLessThan(
      posts.indexOf(bold("Suggested next steps")),
    );

    const persona: string = readRepoFile(
      "Common/Server/Utils/AI/SRE/AIInvestigationEngine.ts",
    );
    expect(persona).toContain(`**${RULED_OUT_SECTION_TITLE}** —`);
  });

  it("a past incident's verified fix is read, and a private incident never", () => {
    const reads: string = flat(
      englishSection(AI_SRE, "## What an investigation reads"),
    );

    expect(reads).toContain(
      "when OneUptime AI's fix of one was verified, what that fix ran",
    );
    expect(reads).toContain("Private incidents are left out.");

    const memory: string = readRepoFile(
      "Common/Server/Utils/AI/SRE/AIMemory.ts",
    );
    expect(memory).toContain("incident.isPrivate !== true");
    expect(memory).toContain(
      "verificationStatus: AutoRemediationVerificationStatus.Verified",
    );
  });

  it("an alert's recurrence is read as an incident's, and a private alert never", () => {
    const reads: string = flat(
      englishSection(AI_SRE, "## What an investigation reads"),
    );

    expect(reads).toContain(
      "An alert's investigation reads the project's resolved alerts the same way",
    );
    expect(reads).toContain("Private alerts are left out.");

    const memory: string = readRepoFile(
      "Common/Server/Utils/AI/SRE/AIMemory.ts",
    );
    expect(memory).toContain("alert.isPrivate === true");
    expect(memory).toContain("readVerifiedAlertFixes");
    expect(
      readRepoFile("Common/Server/Utils/AI/SRE/AlertInvestigationRunner.ts"),
    ).toContain("AIMemory.getPriorSimilarAlertsContext(");
  });

  it("names an App Platforms environment as the run's activity does", () => {
    const reads: string = flat(
      englishSection(AI_SRE, "## What an investigation reads"),
    );

    expect(reads).toContain(
      `An App Platforms environment is named as a ${CLOUD_ENVIRONMENT_NOUN.toLowerCase()}.`,
    );
  });
});

/*
 * What an investigation says it hurts (#5519's follow-ups): the section the
 * persona asks for right after the Summary, its three lines, and the SLOs
 * the investigation reads for it.
 */
describe("what the investigation says it hurts", () => {
  it("is the section the persona asks for, right after the summary, a line each for the users, the services and the SLOs", () => {
    const posts: string = flat(
      englishSection(AI_SRE, "## What the investigation posts"),
    );

    expect(posts).toContain(
      `${bold(IMPACT_SECTION_TITLE)} — who and what it hurts, and how the investigation knows`,
    );
    expect(posts.indexOf(bold("Summary"))).toBeLessThan(
      posts.indexOf(bold(IMPACT_SECTION_TITLE)),
    );
    expect(posts.indexOf(bold(IMPACT_SECTION_TITLE))).toBeLessThan(
      posts.indexOf(bold("Most likely root cause")),
    );
    expect(posts).toContain(
      "one line each for the users, the services and the SLOs",
    );

    const persona: string = readRepoFile(
      "Common/Server/Utils/AI/SRE/AIInvestigationEngine.ts",
    );
    expect(persona.indexOf("**Summary** —")).toBeLessThan(
      persona.indexOf(`**${IMPACT_SECTION_TITLE}** —`),
    );
    for (const label of Object.values(IMPACT_LINE_LABELS)) {
      expect(persona).toContain(`**${label}:**`);
    }
    expect(persona).toContain("never guess a number");
  });

  it("reads the SLOs linked to the record and those that count its monitors, as many as the context lists", () => {
    const reads: string = flat(
      englishSection(AI_SRE, "## What an investigation reads"),
    );

    expect(reads).toContain(
      `the SLOs that count its monitors, up to ${MAX_IMPACT_SLOS}`,
    );

    const context: string = readRepoFile(
      "Common/Server/Utils/AI/SRE/InvestigationImpactContext.ts",
    );
    expect(context).toContain("monitors: QueryHelper.inRelationArray(");
  });
});

describe("before you approve a fix", () => {
  const section: string = flat(
    englishSection(AI_SRE, BEFORE_APPROVING_SECTION),
  );

  it("quotes a cloud change's plain words as the code words them", () => {
    const words: string | undefined = describeCloudChange({
      resourceType: AiResourceType.AwsAccount,
      command:
        "cloud scale-out arn:aws:ecs:us-east-1:123456789012:service/prod/checkout-api --count 8",
    })?.sentence;

    expect(words).toBe("Scale the ECS service checkout-api out to 8 tasks");
    expect(section).toContain(`"${words}"`);
  });

  it("quotes a track record as the code words it, over the window the code reads", () => {
    const record: string = describeRemediationTrackRecord({
      workedCount: 3,
      didNotWorkCount: 0,
      runs: [],
    });

    expect(section).toContain(`"${record}"`);
    expect(section).toContain(
      `in the last ${REMEDIATION_TRACK_RECORD_LOOKBACK_DAYS} days`,
    );
    expect(section).toContain(
      "Private incidents and alerts are neither named nor counted.",
    );
  });

  it("a runbook says how it went before, over Approve & Run, over the same window, and the planner reads it", () => {
    expect(section).toContain(
      `A runbook OneUptime AI proposes says the same of itself, right over ${bold("Approve & Run")}`,
    );
    expect(section).toContain(
      `in the last ${REMEDIATION_TRACK_RECORD_LOOKBACK_DAYS} days, with a link to each`,
    );

    const planner: string = readRepoFile(
      "Common/Server/Utils/AI/Remediation/RemediationPlanRunner.ts",
    );
    expect(planner).toContain("RUNBOOK_TRACK_RECORD_PLANNER_NOTE");
    expect(planner).toContain("runbookTrackRecord");
  });
});

describe("approving or dismissing a fix from a chat", () => {
  const BUTTONS: Array<string> = [
    REMEDIATION_CHAT_WORDS.reviewAndApprove,
    REMEDIATION_CHAT_WORDS.dismiss,
    getViewInProductTitle(),
  ];

  it("names the buttons the server writes on a fix's message", () => {
    const section: string = flat(englishSection(AI_SRE, APPROVAL_SECTION));

    for (const button of [...BUTTONS, REMEDIATION_CHAT_WORDS.approveAndRun]) {
      expect(section).toContain(bold(button));
    }
  });

  it("says a press is checked as the card's is, and a changed fix is refused, as the approval code does", () => {
    const section: string = flat(englishSection(AI_SRE, APPROVAL_SECTION));

    expect(section).toContain("A press is checked as the card's buttons are");
    expect(section).toContain(
      "A fix that changed after its message was posted is refused, and nothing runs.",
    );

    // The chat's approval goes through the card's, with the fix's fingerprint.
    const actions: string = readRepoFile(
      "Common/Server/Utils/Workspace/WorkspaceRemediationActions.ts",
    );
    expect(actions).toContain("await RemediationApproval.approve({");
    expect(actions).toContain(
      "expectedPlanFingerprint: data.value.fingerprint,",
    );
    expect(actions).toContain("modelType: RunbookExecution,");
  });

  it("says dismissing asks what approving does, on the card and in a chat, as the dismissal checks it", () => {
    const section: string = flat(englishSection(AI_SRE, APPROVAL_SECTION));

    expect(section).toContain(
      "Dismissing a fix needs what approving one does, on the card as in a chat: permission to start runbook executions in the project.",
    );
    expect(section).toContain(
      `On the card, its button is ${bold(REMEDIATION_FIX_DISMISS)}.`,
    );
    expect(REMEDIATION_FIX_DISMISS).toBe("Dismiss fix");

    // The card's dismissal asks the chats' permission, and says so.
    const approval: string = readRepoFile(
      "Common/Server/Utils/AutoRemediation/RemediationApproval.ts",
    );
    expect(approval).toContain("assertCanDismissFixes(");
    expect(FIX_DISMISS_REFUSED_MESSAGE).toContain(
      "Dismissing a fix needs the permission approving one does: starting runbook executions in this project.",
    );
  });

  it("quotes where a fix was approved as its approval step words it, and AI Insights counts the places", () => {
    const section: string = flat(englishSection(AI_SRE, APPROVAL_SECTION));

    expect(section).toContain(
      `"${REMEDIATION_FIX_STEP_COPY.approvedByInSlack.replace("{{name}}", "Maya Chen")}"`,
    );

    const insights: string = flat(
      englishSection(
        AI_SRE,
        "## What OneUptime AI learned, and everything it did",
      ),
    );
    expect(AI_INSIGHTS_FIX_APPROVAL_PLACES_TITLE).toBe(
      "Where fixes were approved",
    );
    expect(insights).toContain(
      "Once a fix was approved from Slack or Microsoft Teams, it also says where the fixes were approved: in OneUptime, in Slack or in Microsoft Teams.",
    );
  });

  it.each([SLACK, TEAMS])(
    "the %s page names the same buttons and sends the reader to the AI SRE page's section",
    (page: string) => {
      const section: string = flat(englishSection(page, CHAT_SECTION));

      for (const button of [...BUTTONS, REMEDIATION_CHAT_WORDS.approveAndRun]) {
        expect(section).toContain(bold(button));
      }

      expect(section).toContain(`](${APPROVAL_LINK})`);
      expect(englishPage(AI_SRE)).toContain(APPROVAL_SECTION);
    },
  );

  it("the Microsoft Teams page says the approval card is confirmed, then removed", () => {
    const section: string = flat(englishSection(TEAMS, CHAT_SECTION));

    expect(section).toContain(
      "once it is approved, that card is removed and they are told the fix is being made",
    );

    const teams: string = readRepoFile(
      "Common/Server/Utils/Workspace/MicrosoftTeams/Actions/Remediation.ts",
    );
    // Confirmed first, then removed.
    expect(teams.indexOf("answer: approved,")).toBeGreaterThan(0);
    expect(teams.indexOf("answer: approved,")).toBeLessThan(
      teams.indexOf("MicrosoftTeamsReplies.deleteBestEffort("),
    );
  });
});

describe("a cloud change on the infrastructure AI agents page", () => {
  it("says it is worded from the command, and what a cloud round is told", () => {
    const fixes: string = flat(
      englishSection(INFRASTRUCTURE_AI_AGENTS, "### Fixes on cloud accounts"),
    );

    expect(fixes).toContain(
      'a cloud change also says what it does in plain words, above its exact command: "Scale the ECS service web out to 4 tasks"',
    );
    expect(
      describeCloudChange({
        resourceType: AiResourceType.AwsAccount,
        command:
          "cloud scale-out arn:aws:ecs:us-east-1:123456789012:service/prod/web --count 4",
      })?.sentence,
    ).toBe("Scale the ECS service web out to 4 tasks");
    expect(fixes).toContain("its App Platforms environments");

    const context: string = readRepoFile(
      "Common/Server/Utils/AI/Remediation/CloudRoundContext.ts",
    );
    expect(context).toContain(
      "# What this signal is linked to in this account",
    );
  });
});
