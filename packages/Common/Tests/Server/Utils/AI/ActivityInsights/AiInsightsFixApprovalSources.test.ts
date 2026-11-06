import fs from "fs";
import path from "path";
import AiActivityInsightsBuilder, {
  AiActivityFixInput,
  AiActivityInsightsInput,
} from "../../../../../Server/Utils/AI/ActivityInsights/AiActivityInsightsBuilder";
import IncidentAlertAiInsightsBuilder, {
  IncidentAlertAiFixInput,
  IncidentAlertAiInsightsInput,
  IncidentAlertAiSubjectInput,
} from "../../../../../Server/Utils/AI/IncidentAlertActivity/IncidentAlertAiInsightsBuilder";
import {
  AI_ACTIVITY_INSIGHTS_WINDOW_IN_DAYS,
  AiActivityFixOutcomes,
} from "../../../../../Types/AI/AiActivityInsights";
import { InvestigationNotStartedCode } from "../../../../../Types/AI/InvestigationNotStartedReason";
import AutoRemediationApprovalSource from "../../../../../Types/AutoRemediation/AutoRemediationApprovalSource";
import AutoRemediationSuggestionStatus from "../../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test - where the window's fixes were approved, on AI
 * Insights (#5519's follow-up: AutoRemediationSuggestion.approvedFrom):
 *
 *  - the fixes' outcomes count the approved ones by where they were
 *    approved: the AI card, Slack, Microsoft Teams - only an approved fix,
 *    only one of the three places, a fix approved before it was kept in
 *    none;
 *  - until a fix of the window was approved somewhere it was kept for, the
 *    outcomes say nothing of where, exactly as before;
 *  - a cluster's or a resource's insights and the incidents' and alerts'
 *    both count it, and both readers read the column - and nothing more
 *    about a fix than they did.
 */

const NOW: Date = new Date("2026-11-04T12:00:00.000Z");

let counter: number = 0;

function fix(
  status: AutoRemediationSuggestionStatus,
  approvedFrom?: string | undefined,
): AiActivityFixInput {
  counter++;
  return {
    id: `fix-${counter}`,
    status,
    createdAt: new Date(NOW.getTime() - counter * 60 * 60 * 1000),
    ...(approvedFrom !== undefined ? { approvedFrom } : {}),
  };
}

function input(fixes: Array<AiActivityFixInput>): AiActivityInsightsInput {
  return {
    now: NOW,
    windowInDays: AI_ACTIVITY_INSIGHTS_WINDOW_IN_DAYS,
    investigations: [],
    fixes,
    commands: { total: 0, failed: 0, timedOut: 0 },
    preventiveInsights: [],
    scopeLabelKeys: [],
    scopeNames: [],
    isPartial: false,
  };
}

function outcomesOf(fixes: Array<AiActivityFixInput>): AiActivityFixOutcomes {
  return AiActivityInsightsBuilder.build(input(fixes)).fixOutcomes;
}

describe("a cluster's or resource's insights count where fixes were approved", () => {
  test("by place, only the approved ones", () => {
    const outcomes: AiActivityFixOutcomes = outcomesOf([
      fix(
        AutoRemediationSuggestionStatus.Approved,
        AutoRemediationApprovalSource.Dashboard,
      ),
      fix(
        AutoRemediationSuggestionStatus.Approved,
        AutoRemediationApprovalSource.Slack,
      ),
      fix(
        AutoRemediationSuggestionStatus.Approved,
        AutoRemediationApprovalSource.Slack,
      ),
      fix(
        AutoRemediationSuggestionStatus.Approved,
        AutoRemediationApprovalSource.MicrosoftTeams,
      ),
      // Approved before where was kept: in none.
      fix(AutoRemediationSuggestionStatus.Approved),
      // Not approved, whatever it says.
      fix(
        AutoRemediationSuggestionStatus.Suggested,
        AutoRemediationApprovalSource.Slack,
      ),
      fix(
        AutoRemediationSuggestionStatus.Dismissed,
        AutoRemediationApprovalSource.MicrosoftTeams,
      ),
      // A place that is none of the three.
      fix(AutoRemediationSuggestionStatus.Approved, "Discord"),
    ]);

    expect(outcomes.appliedAfterApproval).toBe(6);
    expect(outcomes.approvedFrom).toEqual({
      dashboard: 1,
      slack: 2,
      microsoftTeams: 1,
    });
  });

  test("until a fix was approved somewhere it was kept for, nothing is said of where", () => {
    const outcomes: AiActivityFixOutcomes = outcomesOf([
      fix(AutoRemediationSuggestionStatus.Approved),
      fix(AutoRemediationSuggestionStatus.AutoExecuted),
      fix(
        AutoRemediationSuggestionStatus.Suggested,
        AutoRemediationApprovalSource.Slack,
      ),
    ]);

    expect("approvedFrom" in outcomes).toBe(false);
    expect(outcomesOf([])).toEqual({
      total: 0,
      planning: 0,
      awaitingApproval: 0,
      appliedAutomatically: 0,
      appliedAfterApproval: 0,
      dismissed: 0,
      noFixFound: 0,
      verified: 0,
      failed: 0,
      verifying: 0,
    });
  });

  test("a card's approvals alone are counted too", () => {
    expect(
      outcomesOf([
        fix(
          AutoRemediationSuggestionStatus.Approved,
          AutoRemediationApprovalSource.Dashboard,
        ),
      ]).approvedFrom,
    ).toEqual({ dashboard: 1, slack: 0, microsoftTeams: 0 });
  });
});

describe("the incidents' and alerts' insights count it the same way", () => {
  const SUBJECT: IncidentAlertAiSubjectInput = {
    id: "i1",
    createdAt: new Date(NOW.getTime() - 24 * 60 * 60 * 1000),
    title: "Checkout is down",
    number: 1,
    numberWithPrefix: "INC-1",
    monitorIds: [],
    serviceIds: [],
  };

  function incidentFix(
    approvedFrom: string | undefined,
  ): IncidentAlertAiFixInput {
    counter++;
    return {
      id: `fix-${counter}`,
      status: AutoRemediationSuggestionStatus.Approved,
      createdAt: new Date(NOW.getTime() - 60 * 60 * 1000),
      subjectId: "i1",
      ...(approvedFrom !== undefined ? { approvedFrom } : {}),
    };
  }

  test("each fix hands on where it was approved", () => {
    const built: { fixOutcomes: AiActivityFixOutcomes } =
      IncidentAlertAiInsightsBuilder.build({
        subjectKind: "incident",
        now: NOW,
        windowInDays: 30,
        investigations: [],
        fixes: [
          incidentFix(AutoRemediationApprovalSource.MicrosoftTeams),
          incidentFix(AutoRemediationApprovalSource.Dashboard),
          incidentFix(undefined),
        ],
        fixTasks: [],
        subjects: new Map<string, IncidentAlertAiSubjectInput>([
          ["i1", SUBJECT],
        ]),
        monitorNames: new Map<string, string>(),
        serviceNames: new Map<string, string>(),
        commands: { total: 0, failed: 0, timedOut: 0 },
        subjectsInWindow: 1,
        notInvestigatedReasons: new Map<string, InvestigationNotStartedCode>(),
        isPartial: false,
      } as IncidentAlertAiInsightsInput);

    expect(built.fixOutcomes.approvedFrom).toEqual({
      dashboard: 1,
      slack: 0,
      microsoftTeams: 1,
    });
  });
});

describe("both readers read the column, and nothing more of a fix", () => {
  const READERS: Array<string> = [
    "../../../../../Server/Utils/AI/ActivityInsights/AiActivityInsightsReader.ts",
    "../../../../../Server/Utils/AI/IncidentAlertActivity/IncidentAlertAiInsightsReader.ts",
  ];

  test.each(READERS)("%s", (relative: string) => {
    const source: string = fs.readFileSync(
      path.resolve(__dirname, relative),
      "utf8",
    );
    const start: number = source.indexOf(
      "// Statuses and dates only: never a rationale or a command plan.",
    );
    const select: string = source.slice(start, source.indexOf("},", start));

    expect(select).toContain("approvedFrom: true");
    expect(select).not.toContain("commandPlan");
    expect(select).not.toContain("rationaleMarkdown");
    expect(source).toContain("approvedFrom: suggestion.approvedFrom");
  });
});
