import { AI_SRE } from "./AiDocsPages";
import { englishPage, readRepoFile } from "./InventoryAndApiDocsSupport";
import { describe, expect, it } from "@jest/globals";

/*
 * WHAT THE AI SRE PAGE SAYS OF FAILED COMMANDS AND FIX PULL REQUESTS,
 * HELD TO THE CODE (#9749, #9812).
 *
 * The AI Insights footnote's number of failed commands opens them, and
 * counts only the commands the reader may read; the incidents' and
 * alerts' AI Insights and AI Logs count a fix pull request once, as its
 * Code task stands by its newest turn - a fix asked again with Try again
 * among them - with what production showed of the pull request any turn
 * opened.
 */

const page: string = englishPage(AI_SRE);

const VIEW: string = readRepoFile(
  "App/FeatureSet/Dashboard/src/Components/AI/ActivityInsights/AiActivityInsightsView.tsx",
);
const FAILED_COMMANDS: string = readRepoFile(
  "Common/Server/Utils/AI/ActivityInsights/AiActivityFailedCommands.ts",
);
const INSIGHTS_READER: string = readRepoFile(
  "Common/Server/Utils/AI/IncidentAlertActivity/IncidentAlertAiInsightsReader.ts",
);
const LOGS_READER: string = readRepoFile(
  "Common/Server/Utils/AI/IncidentAlertActivity/IncidentAlertAiLogsReader.ts",
);
const ROW_WORDS: string = readRepoFile(
  "App/FeatureSet/Dashboard/src/Components/AI/ActivityInsights/AiActivityFailedCommands.ts",
);

describe("the AI Insights footnote's failed commands", () => {
  it("says the number opens them, newest first, with what each ran, how it ended, why and what for", () => {
    expect(page).toContain(
      "The number of commands that failed opens them, the newest first: what each one ran, its exit code and what the agent said, why OneUptime AI ran it, and the incident or alert it was for. It counts only the commands you may read.",
    );

    // The number is the pill that opens them.
    expect(VIEW).toContain("<ResourceAttentionPill");
    expect(VIEW).toContain('testId="ai-insights-failed-commands"');
    // Newest first, read as the reader: what it ran, its exit code, the agent's words, why, what for.
    expect(FAILED_COMMANDS).toContain(
      "sort: { createdAt: SortOrder.Descending },",
    );
    expect(FAILED_COMMANDS).toContain("props: data.props,");
    for (const field of [
      "exitCode: true",
      "errorMessage: true",
      "origin: true",
      "payload: true",
    ]) {
      expect(FAILED_COMMANDS).toContain(field);
    }
    expect(ROW_WORDS).toContain("describeCommandOrigin(");
    expect(ROW_WORDS).toContain("getSubjectFact(command.subject)");
  });

  it("says the incidents' and alerts' pages open them too", () => {
    expect(page).toContain(
      "Here too, the number of commands that failed opens them.",
    );
    // The incidents' and alerts' insights read them as their own.
    expect(INSIGHTS_READER).toContain("AiActivityFailedCommands.read({");
  });
});

describe("a fix pull request, as its task stands", () => {
  it("says the insights count a fix pull request once, as its task stands now", () => {
    expect(page).toContain(
      "A fix pull request counts once, as its task in Code stands now: a fix asked again with Try again that opened its pull request counts as opened.",
    );

    // Its first turn, counted once; its newest turn, how it stands.
    expect(INSIGHTS_READER).toContain("codeTaskId: QueryHelper.isNull()");
    expect(INSIGHTS_READER).toContain("CodeTaskListRows.readReplies({");
  });

  it("says the AI Logs list it once, with what production showed of any turn's pull request", () => {
    expect(page).toContain(
      "A fix pull request is one entry that says how its task in Code stands now, with what production showed once its pull request merged, whichever turn of the task opened it.",
    );

    expect(LOGS_READER).toContain("codeTaskId: QueryHelper.isNull()");
    expect(LOGS_READER).toContain("CodeTaskListRows.readReplies({");
    expect(LOGS_READER).toContain("CodeTaskListRows.readPullRequests({");
    expect(LOGS_READER).toContain(
      "FixProductionReportUtil.fromPullRequest(pullRequest)",
    );
  });
});
