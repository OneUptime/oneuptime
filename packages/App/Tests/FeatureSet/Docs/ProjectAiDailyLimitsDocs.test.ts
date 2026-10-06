import {
  PACKAGES_ROOT,
  getHeadings,
  getSection,
  read,
} from "./KubernetesAiAgentDocsSupport";
import {
  getProjectAiAdvancedSummary,
  ProjectAiDailyLimitsCopy,
} from "../../../FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import Project from "Common/Models/DatabaseModels/Project";
import {
  MIN_PROJECT_AI_DAILY_SPEND_LIMIT_IN_USD,
  MIN_PROJECT_AI_DAILY_TOKEN_LIMIT,
  ProjectAiDailyLimit,
} from "Common/Types/AI/ProjectAiDailyLimits";
import LlmLogStatus from "Common/Types/LlmLogStatus";
import Permission from "Common/Types/Permission";
import { createTranslator } from "Common/UI/Utils/TranslateTemplate";
import { getProjectDailyLimitMessage } from "Common/Server/Services/AIService";
import ProjectAiDailyLimitOwnerNotice from "Common/Server/Utils/AI/ProjectAiDailyLimitOwnerNotice";
import {
  LIMIT_CATCH_UP_WINDOW_HOURS,
} from "Common/Server/Utils/AI/SRE/InvestigationLimitCatchUp";
import ProjectAiDailyLimits from "Common/Types/AI/ProjectAiDailyLimits";
import ObjectID from "Common/Types/ObjectID";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import { describe, expect, it } from "@jest/globals";
import path from "path";

/*
 * The docs of a project's own daily AI limits (Project Settings → AI
 * Features → More settings), held to the code that makes each claim true:
 * the titles the dashboard shows, who may change the limits, the UTC day,
 * the bounds, the status a refused call gets in the AI Logs, the sentence
 * the folded section says, and that Ask AI and the LLM provider guide send
 * readers to the right section.
 */

const CONTENT_DIR: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/Docs/Content/en",
);
const AI_SRE: string = path.join(CONTENT_DIR, "ai/ai-sre.md");
const ASK_AI: string = path.join(CONTENT_DIR, "ai/ask-ai.md");
const LLM_PROVIDER: string = path.join(CONTENT_DIR, "ai/llm-provider.md");
const AI_FEATURES_PAGE: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/Dashboard/src/Pages/Settings/AIFeatures.tsx",
);

const HEADING: string = "### The project's own daily limits";
const ANCHOR: string = "/docs/ai/ai-sre#the-projects-own-daily-limits";

// Line breaks read as one space, so a claim may wrap anywhere.
function flat(markdown: string): string {
  return markdown.replace(/\s*\n\s*/g, " ").trim();
}

function section(): string {
  return flat(getSection(read(AI_SRE), HEADING));
}

describe("the AI SRE page documents the project's own daily limits", () => {
  it("in a section of its own, under Cost controls", () => {
    const headings: Array<string> = getHeadings(read(AI_SRE));

    expect(headings).toContain(HEADING);
    expect(headings.indexOf(HEADING)).toBeGreaterThan(
      headings.indexOf("## Cost controls"),
    );
    expect(headings.indexOf(HEADING)).toBeLessThan(
      headings.indexOf("## Trust and safety"),
    );
  });

  it("names the settings by the titles the dashboard shows them under", () => {
    const page: string = read(AI_FEATURES_PAGE);
    const text: string = section();

    for (const title of [
      "Daily AI Token Limit",
      "Daily AI Spend Limit (USD)",
    ]) {
      expect({ title, onPage: page.includes(`title: "${title}"`) }).toEqual({
        title,
        onPage: true,
      });
      expect({ title, inDocs: text.includes(`**${title}**`) }).toEqual({
        title,
        inDocs: true,
      });
    }

    expect(text).toContain(`**${ProjectAiDailyLimitsCopy.cardTitle}** card`);
    expect(text).toContain(
      "**Project Settings → AI Features**, folded under **More settings**",
    );
  });

  it("says unset is no limit, the bounds, and that Enable AI turns AI off", () => {
    const text: string = section();

    expect(MIN_PROJECT_AI_DAILY_TOKEN_LIMIT).toBe(1);
    expect(MIN_PROJECT_AI_DAILY_SPEND_LIMIT_IN_USD).toBe(1);
    expect(text).toContain("Unset (the default) means **no limit**.");
    expect(text).toContain(
      "A limit is a whole number of at least 1; to turn AI off, use **Enable AI**.",
    );
  });

  it("says a day is a UTC day, as the refusal sentence does", () => {
    const text: string = section();
    const refusal: string = getProjectDailyLimitMessage({
      reachedLimit: ProjectAiDailyLimit.Tokens,
      tokenLimit: 10,
      spendLimitInUSD: null,
      usage: { usedTokensToday: 10, spentTodayInUSDCents: 0 },
    });

    expect(text).toContain("A day is a UTC day");
    expect(text).toContain("the count starts again at the next midnight UTC");
    expect(refusal).toContain("midnight UTC");
    expect(refusal).toContain("Project Settings → AI Features → More settings");
  });

  it("names who may change the limits from the columns' own access control", () => {
    for (const column of ["aiDailyTokenLimit", "aiDailySpendLimitInUSD"]) {
      expect(new Project().getColumnAccessControlFor(column)?.update).toEqual([
        Permission.ProjectOwner,
        Permission.ManageProjectBilling,
      ]);
    }

    expect(section()).toContain(
      "Only a project owner or someone with **Manage Billing** can change the limits",
    );
  });

  it("says the spend limit counts billed AI only, and is OneUptime Cloud's", () => {
    const text: string = section();

    expect(text).toContain(
      "Only AI billed to the project's AI credits counts, so it never stops AI that runs on the project's own LLM provider.",
    );
    expect(text).toContain(
      "Self-hosted installations do not bill AI, so they do not offer it.",
    );
  });

  it("names the status a refused call has in the AI Logs", () => {
    expect(LlmLogStatus.BudgetExceeded).toBe("Budget Exceeded");
    expect(section()).toContain(
      `with the status **${LlmLogStatus.BudgetExceeded}**`,
    );
  });

  it("quotes the folded sentence exactly as the dashboard says it", () => {
    const sentence: string = getProjectAiAdvancedSummary({
      limits: { tokenLimit: 200000, spendLimitInUSD: null },
      usage: { usedTokensToday: 45210, spentTodayInUSDCents: 0 },
      isBillingEnabled: false,
      translator: createTranslator(undefined, "en"),
    }) as string;

    expect(sentence).toBe(
      "At most 200,000 tokens a day. Used today: 45,210 tokens.",
    );
    expect(section()).toContain(`for example "${sentence}"`);
  });

  it("keeps the incident and alert limits under the project's own", () => {
    expect(section()).toContain(
      "The incident and alert daily token limits still apply under the project's own: AI stops at whichever is reached first.",
    );
  });

  it("no longer says work outside incidents and alerts has no limits at all", () => {
    const costControls: string = flat(
      getSection(read(AI_SRE), "## Cost controls"),
    );

    expect(costControls).not.toContain(
      "has no setting and none of these limits",
    );
    expect(costControls).toContain(
      "only the project's own daily limits (below) apply to it.",
    );
  });
});

/*
 * What happens once a limit is reached - the owners' email and the catch-up
 * of the incidents and alerts it skipped - held to the code that does it.
 */
describe("the AI SRE page says what happens when a limit is reached", () => {
  const CATCH_UP_JOB: string = path.join(
    PACKAGES_ROOT,
    "App/FeatureSet/Workers/Jobs/AIChat/InvestigateAfterDailyLimitReset.ts",
  );

  it("quotes the who-can sentence every refusal ends with", () => {
    const sentence: string = ProjectAiDailyLimits.getWhoCanChangeSentence();
    const refusal: string = getProjectDailyLimitMessage({
      reachedLimit: ProjectAiDailyLimit.Tokens,
      tokenLimit: 10,
      spendLimitInUSD: null,
      usage: { usedTokensToday: 10, spentTodayInUSDCents: 0 },
    });

    expect(refusal.endsWith(sentence)).toBe(true);
    expect(section()).toContain(`"${sentence}"`);
  });

  it("says the owners are emailed once a day for each limit, with a link to the limits", () => {
    const text: string = section();
    const email: string = ProjectAiDailyLimitOwnerNotice.getHtml({
      projectId: ObjectID.generate(),
      status: {
        reachedLimit: ProjectAiDailyLimit.Tokens,
        tokenLimit: 10,
        spendLimitInUSD: null,
        usage: { usedTokensToday: 10, spentTodayInUSDCents: 0 },
        resetsAt: new Date("2026-10-08T00:00:00.000Z"),
      },
    });

    expect(text).toContain("#### When a limit is reached");
    expect(text).toContain("**The project's owners are emailed.**");
    expect(text).toContain("once a day for each limit");
    expect(email).toContain("once a day for each limit");
    expect(text).toContain("a link to **Project Settings → AI Features**");
  });

  it("says skipped incidents and alerts are investigated after the reset, while open and less than a day old, every five minutes", () => {
    const text: string = section();

    expect(text).toContain(
      "**Skipped incidents and alerts are investigated after the reset.**",
    );
    expect(text).toContain(
      "after midnight UTC, or as soon as an owner raises or removes the limit",
    );
    expect(LIMIT_CATCH_UP_WINDOW_HOURS).toBe(24);
    expect(text).toContain("still open and less than a day old");
    expect(text).toContain("every five minutes");
    expect(read(CATCH_UP_JOB)).toContain("schedule: EVERY_FIVE_MINUTE");
    expect(EVERY_FIVE_MINUTE).toBe("*/5 * * * *");
    expect(text).toContain(
      "A record that was resolved meanwhile, or that someone asked OneUptime AI to investigate in the meantime, is not investigated again.",
    );
  });

  it("no longer says skipped records are never retried after the reset", () => {
    expect(section()).not.toContain("not automatically retried");
  });
});

describe("other AI pages send readers to the section", () => {
  it("Ask AI says it counts toward the project's limits, and the lane limits never stop it", () => {
    const text: string = flat(read(ASK_AI));

    expect(text).toContain(
      "Ask AI counts toward the project's own daily AI limits",
    );
    expect(text).toContain(
      "The incident and alert daily limits never stop Ask AI.",
    );
    expect(text).toContain(`(${ANCHOR})`);
  });

  it("the LLM provider guide says how to cap what the global provider spends", () => {
    const text: string = flat(read(LLM_PROVIDER));

    expect(text).toContain("**Daily AI Spend Limit (USD)**");
    expect(text).toContain("**Daily AI Token Limit**");
    expect(text).toContain(`(${ANCHOR})`);
  });
});
