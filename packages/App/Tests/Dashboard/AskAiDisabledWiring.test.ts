import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Ask AI has two front doors — the quick-launch panel the header opens, and
 * the full-page Copilot — and they share one hook. When a project switches AI
 * off (Project.enableAi), has no LLM provider, or sits on a plan without AI,
 * BOTH doors have to close, and close the same way: the composer withheld, the
 * suggested prompts gone, and a notice naming the settings page that owns the
 * switch. A surface that keeps its composer is the original bug back again,
 * just on the other page.
 *
 * The panel's rendered behaviour is covered against a real DOM in
 * Common/Tests/App/Dashboard/AskAiDisabled.test.tsx, and the rule itself in
 * AskAiAvailability.test.ts. What is left is the wiring, and it is asserted
 * here as source text because the App suite runs in a plain Node environment
 * (App/jest.config.json sets testEnvironment: "node") — rendering the
 * full-page Copilot, with its Page chrome, routing and analytics, to find out
 * whether one component is mounted is not worth what it costs.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

/*
 * Comments are stripped first. Every file below explains this behaviour in
 * prose that names the very identifiers being matched, and an assertion about
 * the code has to read the code rather than the commentary about it.
 */
type StripCommentsFunction = (raw: string) => string;

const stripComments: StripCommentsFunction = (raw: string): string => {
  return raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
};

type ReadCodeFunction = (...relativeParts: Array<string>) => string;

const readCode: ReadCodeFunction = (
  ...relativeParts: Array<string>
): string => {
  return stripComments(
    fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
  ).replace(/\s+/g, " ");
};

const HOOK: string = readCode("Components", "AIChat", "useAiChat.ts");

const PANEL: string = readCode("Components", "AIChat", "AskAiDialog.tsx");

const FULL_PAGE: string = readCode("Pages", "AICopilot", "AICopilot.tsx");

const HOME_VIEW: string = readCode("Components", "AIChat", "ChatHomeView.tsx");

const AVAILABILITY: string = readCode(
  "Components",
  "AIChat",
  "AIChatAvailability.ts",
);

describe("the verdict is resolved once, in the hook both surfaces share", () => {
  test("the hook reads the project's kill switch off the providers response", () => {
    /*
     * Project.enableAi is a server row, and the chat surfaces hold no project
     * model. It rides on the request the provider picker already makes, so the
     * answer costs no extra round trip — see the server side in
     * Common/Tests/Server/API/AIChatProvidersAIEnabled.
     */
    expect(HOOK).toContain('data["isAIEnabledForProject"] !== false');
  });

  test("the hook publishes one reason, not three raw flags for each surface to combine", () => {
    expect(HOOK).toContain("getAIChatUnavailableReason({");
    expect(HOOK).toContain("unavailableReason,");
  });

  test("the plan gate feeds the same verdict rather than being a second, parallel notice", () => {
    expect(HOOK).toContain(
      'import { isAIAccessibleOnCurrentPlan } from "../AI/AIPlanGate";',
    );
    expect(HOOK).toContain("isAccessibleOnPlan: isAIAccessibleOnCurrentPlan()");
  });

  test("sendMessage refuses while a reason stands, whatever a surface does with its composer", () => {
    expect(HOOK).toContain(
      "if (!content || isSending || isWorking || unavailableReason) {",
    );
  });
});

describe("the one front door closes", () => {
  test("a reason to be off wins over every other view of the dialog", () => {
    /*
     * The dialog draws one view at a time: the notice, the history, a
     * conversation or the start. The reason AI is off is read first, so
     * none of the others - and none of their composers - is ever drawn
     * while it stands.
     */
    expect(PANEL).toContain(
      'const view: View = chat.unavailableReason ? "unavailable" : props.isHistoryOpen',
    );
  });

  test("the dialog shows the notice", () => {
    expect(PANEL).toContain(
      '{view === "unavailable" && chat.unavailableReason ? (',
    );
    expect(PANEL).toContain(
      "<AIChatUnavailableView reason={chat.unavailableReason} />",
    );
  });

  test("the dialog withholds the composer entirely", () => {
    /*
     * Withheld, not disabled: a greyed-out textarea still reads as "type here
     * and something will happen", and the send path is the thing that cannot
     * work. The composer is drawn only by the start and the conversation.
     */
    expect(PANEL.split("composer={composer}").length - 1).toBe(1);
    expect(PANEL).toContain('{view === "home" ? (');
    expect(PANEL).toContain('{view === "conversation" ? (');
    expect(PANEL).toContain('<div className="mx-auto w-full max-w-3xl px-4 sm:px-6"> {composer} </div>');
  });

  test("the chat's own address draws no workspace of its own to close", () => {
    /*
     * It used to be a second design of the conversation, with its own
     * early return for this notice. It opens the dialog now, which decides.
     */
    expect(FULL_PAGE).toContain("openAskAi({");
    expect(FULL_PAGE).not.toContain("useAiChat(");
    expect(FULL_PAGE).not.toContain("<AIChatUnavailableView");
    expect(FULL_PAGE).not.toContain("<AIPlanGate />");
  });
});

describe("the old half-measure is gone", () => {
  test("no surface still renders the inline 'no provider' notice next to a live composer", () => {
    /*
     * ChatHomeView used to show an amber "no LLM provider configured" strip
     * while leaving the composer fully usable underneath it. That is the state
     * this change replaces; a re-introduced prop would mean two notices
     * disagreeing about whether the user may type.
     */
    expect(HOME_VIEW).not.toContain("showNoProviderNotice");
    expect(PANEL).not.toContain("showNoProviderNotice");
    expect(FULL_PAGE).not.toContain("showNoProviderNotice");
  });
});

describe("the notice always has somewhere to send the user", () => {
  test("every reason carries a settings page in the copy table", () => {
    /*
     * The copy lives as data keyed by reason, so a new reason cannot be added
     * without deciding which page fixes it — TypeScript's Record makes the
     * omission a compile error rather than a blank notice.
     */
    expect(AVAILABILITY).toContain(
      "const COPY: Record<AIChatUnavailableReason, AIChatUnavailableCopy>",
    );
    expect(AVAILABILITY).toContain("PageMap.SETTINGS_AI_FEATURES");
    expect(AVAILABILITY).toContain("PageMap.SETTINGS_AI_LLM_PROVIDERS");
    expect(AVAILABILITY).toContain("PageMap.SETTINGS_BILLING");
  });

  test("the rule fails open on a verdict that has not arrived", () => {
    /*
     * The providers request is slow before it is anything else, and a member
     * without provider-read permission never gets an answer at all. Only a
     * loaded, genuinely empty list counts.
     */
    expect(AVAILABILITY).toContain(
      "if (data.hasLoadedProviders && data.providerCount === 0) {",
    );
  });
});
