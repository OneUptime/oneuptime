import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import AIChatUnavailableReason, {
  AIChatUnavailableCopy,
  getAIChatUnavailableCopy,
  getAIChatUnavailableReason,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/AIChatAvailability";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";

/*
 * The rule Ask AI uses to decide whether it can take a question, and the words
 * it uses to explain a "no".
 *
 * Two things are easy to get wrong here and neither shows up as a crash:
 *
 *   ORDER. Three separate switches can each stop a chat turn, and they are not
 *   independent — a project on a plan without AI cannot use its own enableAi
 *   toggle, and a toggle that is off makes a configured provider irrelevant.
 *   Reporting the wrong one sends the user to a settings page that will not fix
 *   anything, which is worse than saying nothing.
 *
 *   FAILING OPEN. The verdict arrives on the same request as the provider list,
 *   and that request is slow before it is anything else. Treating "not answered
 *   yet" as "disabled" would flash a setup notice over a working assistant on
 *   every single open, and would strand members whose permissions do not let
 *   them read providers at all.
 */

const REPO_ROOT: string = path.join(__dirname, "..", "..", "..", "..");

const ALL_REASONS: Array<AIChatUnavailableReason> = Object.values(
  AIChatUnavailableReason,
);

// Everything on: the state in which Ask AI must simply work.
const HEALTHY: Parameters<typeof getAIChatUnavailableReason>[0] = {
  isAccessibleOnPlan: true,
  isProjectAIEnabled: true,
  hasLoadedProviders: true,
  providerCount: 1,
};

describe("what stops Ask AI from taking a question", () => {
  test("nothing, when the plan allows it, the project has AI on and a provider exists", () => {
    expect(getAIChatUnavailableReason(HEALTHY)).toBeNull();
  });

  test("a plan without AI", () => {
    expect(
      getAIChatUnavailableReason({ ...HEALTHY, isAccessibleOnPlan: false }),
    ).toBe(AIChatUnavailableReason.PlanUpgradeRequired);
  });

  test("the project's own AI kill switch", () => {
    expect(
      getAIChatUnavailableReason({ ...HEALTHY, isProjectAIEnabled: false }),
    ).toBe(AIChatUnavailableReason.DisabledForProject);
  });

  test("a project with no LLM provider at all", () => {
    expect(getAIChatUnavailableReason({ ...HEALTHY, providerCount: 0 })).toBe(
      AIChatUnavailableReason.NoProviderConfigured,
    );
  });
});

describe("the reason reported is the one the user has to fix first", () => {
  test("plan beats the project toggle — the toggle cannot help without the plan", () => {
    expect(
      getAIChatUnavailableReason({
        ...HEALTHY,
        isAccessibleOnPlan: false,
        isProjectAIEnabled: false,
      }),
    ).toBe(AIChatUnavailableReason.PlanUpgradeRequired);
  });

  test("plan beats a missing provider", () => {
    expect(
      getAIChatUnavailableReason({
        ...HEALTHY,
        isAccessibleOnPlan: false,
        providerCount: 0,
      }),
    ).toBe(AIChatUnavailableReason.PlanUpgradeRequired);
  });

  test("the project toggle beats a missing provider — adding one changes nothing while AI is off", () => {
    expect(
      getAIChatUnavailableReason({
        ...HEALTHY,
        isProjectAIEnabled: false,
        providerCount: 0,
      }),
    ).toBe(AIChatUnavailableReason.DisabledForProject);
  });

  test("with everything off, the answer is still the plan", () => {
    expect(
      getAIChatUnavailableReason({
        isAccessibleOnPlan: false,
        isProjectAIEnabled: false,
        hasLoadedProviders: true,
        providerCount: 0,
      }),
    ).toBe(AIChatUnavailableReason.PlanUpgradeRequired);
  });
});

describe("an unanswered question is not a 'no'", () => {
  test("an empty provider list that has not loaded yet reports nothing", () => {
    expect(
      getAIChatUnavailableReason({
        ...HEALTHY,
        hasLoadedProviders: false,
        providerCount: 0,
      }),
    ).toBeNull();
  });

  test("the toggle defaults to enabled, so a surface that never asked stays usable", () => {
    /*
     * This is the shape of a first render, and of a member whose permissions
     * get the providers request refused: no verdict, no providers, no notice.
     */
    expect(
      getAIChatUnavailableReason({
        isAccessibleOnPlan: true,
        isProjectAIEnabled: true,
        hasLoadedProviders: false,
        providerCount: 0,
      }),
    ).toBeNull();
  });

  test("only a loaded, genuinely empty provider list closes the door", () => {
    expect(
      getAIChatUnavailableReason({
        ...HEALTHY,
        hasLoadedProviders: true,
        providerCount: 0,
      }),
    ).not.toBeNull();
  });
});

describe("every reason can be explained to the person who hit it", () => {
  test.each(ALL_REASONS)(
    "%s has a title, an explanation and a way out",
    (reason: AIChatUnavailableReason) => {
      const copy: AIChatUnavailableCopy = getAIChatUnavailableCopy(reason);

      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.description.length).toBeGreaterThan(0);
      expect(copy.actionLabel.length).toBeGreaterThan(0);
    },
  );

  test.each(ALL_REASONS)(
    "%s points at a page that actually exists",
    (reason: AIChatUnavailableReason) => {
      const copy: AIChatUnavailableCopy = getAIChatUnavailableCopy(reason);

      expect(Object.values(PageMap)).toContain(copy.actionPage);
      expect(RouteMap[copy.actionPage as PageMap]).toBeInstanceOf(Route);
    },
  );

  test.each(ALL_REASONS)(
    "%s tells the user where to go, not just that something is wrong",
    (reason: AIChatUnavailableReason) => {
      const copy: AIChatUnavailableCopy = getAIChatUnavailableCopy(reason);

      /*
       * The whole point of the notice: whoever is looking at it usually did
       * not flip the switch, so "Settings" alone is not an answer.
       */
      expect(copy.actionLabel).toMatch(/Settings/);
    },
  );

  test("each reason points somewhere different — three reasons collapsing onto one page would hide two of them", () => {
    const pages: Array<PageMap> = ALL_REASONS.map(
      (reason: AIChatUnavailableReason) => {
        return getAIChatUnavailableCopy(reason).actionPage;
      },
    );

    expect(new Set(pages).size).toBe(ALL_REASONS.length);
  });

  test("the kill-switch notice points at the same page the server's own refusal names", () => {
    /*
     * AIService.AI_DISABLED_MESSAGE is the sentence a user reads in Slack, on
     * a runbook step and behind every "Generate with AI" button. Ask AI now
     * says the same thing before the request instead of after it, and the two
     * must not drift into naming different screens.
     *
     * Read as source text rather than imported: AIService is server code with
     * a database-shaped import graph, and this file runs in the browser suite.
     */
    const aiService: string = fs.readFileSync(
      path.join(REPO_ROOT, "Common", "Server", "Services", "AIService.ts"),
      "utf8",
    );

    const message: string = (aiService.match(
      /AI_DISABLED_MESSAGE:\s*string\s*=\s*\n?\s*"([^"]+)"/,
    ) || [])[1] as string;

    expect(message).toBeDefined();
    expect(message).toContain("AI Credits");

    const copy: AIChatUnavailableCopy = getAIChatUnavailableCopy(
      AIChatUnavailableReason.DisabledForProject,
    );

    expect(copy.actionPage).toBe(PageMap.SETTINGS_AI_CREDITS);
    expect(copy.actionLabel).toContain("AI Credits");
  });
});
