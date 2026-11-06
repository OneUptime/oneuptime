import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import fs from "fs";
import path from "path";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return React.createElement("div", { "data-testid": "markdown" });
    },
  };
});

import AiActivityInsightsView from "../../../../App/FeatureSet/Dashboard/src/Components/AI/ActivityInsights/AiActivityInsightsView";
import {
  AI_INSIGHTS_FIX_APPROVAL_PLACES_TITLE,
  AiInsightsFixApprovalPlace,
  describeFixVerification,
  getFixApprovalPlaces,
  parseAiActivityInsights,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/ActivityInsights/AiActivityInsightsData";
import {
  getRemediationFixSteps,
  RemediationFixStep,
  RemediationFixStepSuggestion,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationFixSteps";
import { REMEDIATION_FIX_STEP_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStepCopy";
import Route from "../../../Types/API/Route";
import {
  AiActivityFixOutcomes,
  AiActivityInsights,
} from "../../../Types/AI/AiActivityInsights";
import { AiRemediationCommandPolicyVerdict } from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationApprovalSource from "../../../Types/AutoRemediation/AutoRemediationApprovalSource";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import { JSONObject } from "../../../Types/JSON";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import { createTranslator, Translator } from "../../../Types/Translator";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { makeInsights, toBody } from "./AiActivityInsightsFixtures";

/*
 * WHERE A FIX WAS APPROVED, ON THE DASHBOARD (#5519's follow-up:
 * AutoRemediationSuggestion.approvedFrom).
 *
 *  - The Remediation step's approval line says it beside who approved the
 *    fix - "Approved by Maya Chen in Slack" - as the record's feed does; an
 *    approval on the card, or one made before where was kept, reads as it
 *    always has. In the reader's language, the name set apart.
 *  - AI Insights' Fixes section lists where the window's fixes were
 *    approved - in OneUptime, in Slack, in Microsoft Teams - once one was
 *    approved from a chat: one row a place, most first, never a place
 *    that approved none; and an answer that says nothing of where (an
 *    older server) shows nothing.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function translatorFor(language: string): Translator {
  const words: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;

  return createTranslator((text: string): string | undefined => {
    return words[text];
  }, language);
}

afterEach(() => {
  cleanup();
});

describe("the Remediation step's approval line", () => {
  function approved(
    approvedFrom: string | undefined,
    name: string | undefined = "Maya Chen",
  ): RemediationFixStepSuggestion {
    return {
      status: AutoRemediationSuggestionStatus.Approved,
      suggestionType: AutoRemediationSuggestionType.CommandPlan,
      commandPlan: {
        commands: [
          {
            sequence: 1,
            stepType: RunbookStepType.Kubectl,
            runnerId: "0193c0de-1111-4aaa-8bbb-0000000000d1",
            runnerNameSnapshot: "kubernetes-agent/prod",
            kubernetesClusterId: "0193c0de-2222-4aaa-8bbb-0000000000d2",
            kubernetesClusterNameSnapshot: "prod",
            command: "kubectl rollout restart deployment/web -n web",
            timeoutInMs: 60000,
            rationale: "stale config",
            expectedEffect: "fresh pods",
            policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
          },
        ],
      } as unknown as JSONObject,
      approvedAt: new Date("2026-11-04T09:00:00.000Z"),
      ...(name ? { approvedByUser: { name } as never } : {}),
      ...(approvedFrom !== undefined
        ? {
            approvedFrom: approvedFrom as AutoRemediationApprovalSource,
          }
        : {}),
    };
  }

  function approvalTitle(
    suggestion: RemediationFixStepSuggestion,
    translator?: Translator | undefined,
  ): string {
    const step: RemediationFixStep | undefined = getRemediationFixSteps({
      suggestion,
      translator,
    }).find((each: RemediationFixStep): boolean => {
      return each.kind === "approval";
    });

    return withoutIsolateMarks(step?.title || "");
  }

  test("says where it was approved, beside who approved it", () => {
    expect(approvalTitle(approved(AutoRemediationApprovalSource.Slack))).toBe(
      "Approved by Maya Chen in Slack",
    );
    expect(
      approvalTitle(approved(AutoRemediationApprovalSource.MicrosoftTeams)),
    ).toBe("Approved by Maya Chen in Microsoft Teams");
  });

  test("without a name to say, it still says where", () => {
    expect(
      approvalTitle(approved(AutoRemediationApprovalSource.Slack, "")),
    ).toBe("Approved in Slack");
    expect(
      approvalTitle(approved(AutoRemediationApprovalSource.MicrosoftTeams, "")),
    ).toBe("Approved in Microsoft Teams");
  });

  test("on the card, before where was kept, or anywhere else, it reads as it always has", () => {
    for (const source of [
      AutoRemediationApprovalSource.Dashboard,
      undefined,
      "Discord",
    ]) {
      expect(approvalTitle(approved(source))).toBe("Approved by Maya Chen");
      expect(approvalTitle(approved(source, ""))).toBe("Approved");
    }
  });

  test("in the reader's language, the name set apart", () => {
    expect(
      approvalTitle(
        approved(AutoRemediationApprovalSource.Slack),
        translatorFor("de"),
      ),
    ).toBe("Genehmigt von Maya Chen in Slack");
    expect(
      approvalTitle(
        approved(AutoRemediationApprovalSource.MicrosoftTeams),
        translatorFor("fa"),
      ),
    ).toBe("توسط Maya Chen در Microsoft Teams تأیید شد");
    expect(
      approvalTitle(
        approved(AutoRemediationApprovalSource.Slack, ""),
        translatorFor("ja"),
      ),
    ).toBe("Slack で承認されました");
  });

  test("its words are the step's copy (the step reads where from the fix: RemediationRunbookFixOnTheCard)", () => {
    expect(REMEDIATION_FIX_STEP_COPY.approvedByInSlack).toBe(
      "Approved by {{name}} in Slack",
    );
    expect(REMEDIATION_FIX_STEP_COPY.approvedByInTeams).toBe(
      "Approved by {{name}} in Microsoft Teams",
    );
    expect(REMEDIATION_FIX_STEP_COPY.approvedInSlack).toBe("Approved in Slack");
    expect(REMEDIATION_FIX_STEP_COPY.approvedInTeams).toBe(
      "Approved in Microsoft Teams",
    );
  });
});

describe("AI Insights: where fixes were approved", () => {
  function outcomes(
    approvedFrom?: AiActivityFixOutcomes["approvedFrom"],
  ): AiActivityFixOutcomes {
    return {
      total: 6,
      planning: 0,
      awaitingApproval: 0,
      appliedAutomatically: 0,
      appliedAfterApproval: 6,
      dismissed: 0,
      noFixFound: 0,
      verified: 4,
      failed: 1,
      verifying: 1,
      ...(approvedFrom ? { approvedFrom } : {}),
    };
  }

  test("one row a place that approved any, most first, once a chat approved one", () => {
    expect(
      getFixApprovalPlaces(
        outcomes({ dashboard: 1, slack: 3, microsoftTeams: 0 }),
      ),
    ).toEqual([
      { label: "In Slack", count: 3 },
      { label: "In OneUptime", count: 1 },
    ]);
    expect(
      getFixApprovalPlaces(
        outcomes({ dashboard: 2, slack: 2, microsoftTeams: 1 }),
      ).map((place: AiInsightsFixApprovalPlace): string => {
        return place.label;
      }),
    ).toEqual(["In OneUptime", "In Slack", "In Microsoft Teams"]);
  });

  test("nothing until a fix was approved from a chat, nor for an answer that says nothing of where", () => {
    expect(
      getFixApprovalPlaces(
        outcomes({ dashboard: 5, slack: 0, microsoftTeams: 0 }),
      ),
    ).toEqual([]);
    expect(getFixApprovalPlaces(outcomes())).toEqual([]);
  });

  test("the answer is read with where, and without it, as it comes", () => {
    const withPlaces: AiActivityInsights | null = parseAiActivityInsights(
      toBody(
        makeInsights({
          fixOutcomes: outcomes({ dashboard: 1, slack: 2, microsoftTeams: 1 }),
        }),
      ),
    );

    expect(withPlaces?.fixOutcomes.approvedFrom).toEqual({
      dashboard: 1,
      slack: 2,
      microsoftTeams: 1,
    });

    const body: JSONObject = toBody(makeInsights({ fixOutcomes: outcomes() }));
    const without: AiActivityInsights | null = parseAiActivityInsights(body);

    expect("approvedFrom" in (without?.fixOutcomes || {})).toBe(false);

    // A count that is not one reads as none.
    ((body["fixOutcomes"] as JSONObject)["approvedFrom"] as unknown) = {
      dashboard: "many",
      slack: -2,
      microsoftTeams: 1,
    };
    expect(parseAiActivityInsights(body)?.fixOutcomes.approvedFrom).toEqual({
      dashboard: 0,
      slack: 0,
      microsoftTeams: 1,
    });
  });

  function renderInsights(fixOutcomes: AiActivityFixOutcomes): void {
    render(
      <MemoryRouter>
        <AiActivityInsightsView
          insights={makeInsights({ fixOutcomes })}
          noun="cluster"
          logsRoute={new Route("/dashboard/logs")}
        />
      </MemoryRouter>,
    );
  }

  test("the Fixes section lists them under its verification line", () => {
    renderInsights(outcomes({ dashboard: 1, slack: 3, microsoftTeams: 2 }));

    const fixes: HTMLElement = screen.getByTestId("ai-insights-fixes");
    const places: HTMLElement = within(fixes).getByTestId(
      "ai-insights-fix-approval-places",
    );

    expect(places).toHaveTextContent(AI_INSIGHTS_FIX_APPROVAL_PLACES_TITLE);
    expect(
      within(places)
        .getAllByTestId("ai-insights-fix-approval-place")
        .map((row: HTMLElement): string => {
          return row.textContent || "";
        }),
    ).toEqual(["In Slack3", "In Microsoft Teams2", "In OneUptime1"]);

    // After how verification went, which it reads with.
    const verification: HTMLElement = within(fixes).getByTestId(
      "ai-insights-fix-verification",
    );
    expect(
      verification.compareDocumentPosition(places) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  /*
   * The UI review: the verification line right over the places was English
   * on every translated page, and wrote its counts in Latin digits under a
   * list that writes them in the language's own.
   */
  test("the verification line over them reads in the reader's language, its counts in the language's digits", () => {
    const fixes: AiActivityFixOutcomes = {
      ...outcomes({ dashboard: 1, slack: 3, microsoftTeams: 2 }),
      verified: 4,
      failed: 1,
      verifying: 1,
    };
    const persian: Translator = translatorFor("fa");
    const line: string | null = describeFixVerification(fixes, persian);
    const PERSIAN_DIGITS: RegExp = /[۰-۹]/;
    const LATIN_DIGITS: RegExp = /[0-9]/;

    expect(line).toBe(
      persian.translateTemplate(
        "Verification: {{verified}} resolved the problem, {{failed}} did not, {{verifying}} still being checked.",
        { verified: "۴", failed: "۱", verifying: "۱" },
      ),
    );
    expect(line).toMatch(PERSIAN_DIGITS);
    expect(line).not.toMatch(LATIN_DIGITS);
    expect(line).not.toContain("Verification");

    // German says it in German; English reads as it always has.
    expect(describeFixVerification(fixes, translatorFor("de"))).toBe(
      "Verifizierung: 4 haben das Problem behoben, 1 nicht, 1 werden noch geprüft.",
    );
    expect(describeFixVerification(fixes, translatorFor("en"))).toBe(
      "Verification: 4 resolved the problem, 1 did not, 1 still being checked.",
    );
  });

  test("no list while every fix was approved on the card", () => {
    renderInsights(outcomes({ dashboard: 6, slack: 0, microsoftTeams: 0 }));

    expect(
      screen.queryByTestId("ai-insights-fix-approval-places"),
    ).not.toBeInTheDocument();
  });

  test("its words are every language's own", () => {
    for (const language of [
      "de",
      "fr",
      "es",
      "it",
      "pt",
      "nl",
      "da",
      "no",
      "sv",
      "ru",
      "ja",
      "ko",
      "zh-CN",
      "zh-TW",
      "hi",
      "fa",
    ]) {
      const translator: Translator = translatorFor(language);

      expect({
        language,
        title: translator.translateText(AI_INSIGHTS_FIX_APPROVAL_PLACES_TITLE),
      }).not.toEqual({
        language,
        title: AI_INSIGHTS_FIX_APPROVAL_PLACES_TITLE,
      });

      for (const label of ["In OneUptime", "In Slack", "In Microsoft Teams"]) {
        expect(translator.translateText(label)).toBeTruthy();
      }
    }
  });
});
