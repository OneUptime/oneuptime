import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The incident and alert AI card folds into one line - "AI investigation is
 * off", and why - when OneUptime AI neither investigated nor fixed the
 * record because something was off for it ("collapse this card into one
 * simple line ... Then you can expand that card to see what more you can do
 * to enable AI" - the maintainer).
 *
 * How it draws and decides is covered in Common/Tests/App/Dashboard
 * (AiOffSummaryData, AiOffSummary, InvestigationPanelAiOff,
 * RemediationSuggestionCardAiFold, AiCardFoldHooks) and in the browser suite
 * in packages/E2E/EventOverview. These read the sources and hold the wiring
 * that makes it work on the real pages: a page that forgot one prop would
 * never fold its card, or would leave the Remediation card saying "nothing
 * was fixed" under a line that says it already.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

type ReadSourceFunction = (...relativeParts: Array<string>) => string;

// The code alone: comments are prose and may mention what is forbidden.
const readSource: ReadSourceFunction = (
  ...relativeParts: Array<string>
): string => {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
};

function count(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

/*
 * The element a page draws for a component: from its tag to the end of the
 * tag ("/>"), the props it is handed.
 */
function elementOf(source: string, tag: string): string {
  const start: number = source.indexOf(`<${tag} `);

  expect(start).toBeGreaterThan(-1);

  return source.slice(start, source.indexOf("/>", start) + 2);
}

const PAGES: Array<[string, string, string]> = [
  [
    "incident",
    "Incidents",
    readSource("Pages", "Incidents", "View", "Index.tsx"),
  ],
  ["alert", "Alerts", readSource("Pages", "Alerts", "View", "Index.tsx")],
];

const PANEL: string = readSource("Components", "AI", "InvestigationPanel.tsx");
const SUMMARY: string = readSource("Components", "AI", "AiOffSummary.tsx");
const SUMMARY_DATA: string = readSource(
  "Components",
  "AI",
  "AiOffSummaryData.ts",
);
const CONVERSATION: string = readSource(
  "Components",
  "AI",
  "InvestigationConversation",
  "InvestigationConversation.tsx",
);
const REMEDIATION_CARD: string = readSource(
  "Components",
  "AutoRemediation",
  "RemediationSuggestionCard.tsx",
);

describe.each(PAGES)(
  "the %s page joins its AI card and its Remediation card",
  (subjectType: string, _folder: string, page: string) => {
    test("keeps what each card says for this record only", () => {
      expect(page).toContain(
        'import useAiCardFold, { AiCardFoldWiring, } from "../../../Components/AI/useAiCardFold";',
      );
      expect(count(page, "useAiCardFold(")).toBe(1);
      expect(page).toContain(
        "const aiCardFold: AiCardFoldWiring = useAiCardFold(modelIdString);",
      );
    });

    test("the AI card hears what fixing did, and says how it is drawn", () => {
      const panel: string = page.slice(
        page.indexOf("<InvestigationPanel "),
        page.indexOf(
          "renderConversation=",
          page.indexOf("<InvestigationPanel "),
        ),
      );

      expect(panel).toContain(`subjectType="${subjectType}"`);
      expect(panel).toContain("remediationState={aiCardFold.remediationState}");
      expect(panel).toContain("onCardFoldChange={aiCardFold.onFoldChange}");
    });

    test("the conversation it closes with is handed the card's fold", () => {
      const conversation: string = elementOf(page, "InvestigationConversation");

      expect(conversation).toContain(
        "investigationStage={slot.investigationStage}",
      );
      expect(conversation).toContain("fold={slot.fold}");
    });

    test("the one Remediation card says what fixing did, and leaves it to the line", () => {
      expect(count(page, "<RemediationSuggestionCard ")).toBe(1);

      const card: string = elementOf(page, "RemediationSuggestionCard");

      expect(card).toContain(`${subjectType}Id={modelId}`);
      expect(card).toContain(
        "onFoldStateChange={aiCardFold.onRemediationStateChange}",
      );
      expect(card).toContain("aiCardFold={aiCardFold.fold}");
    });
  },
);

describe("the AI card draws the line inside its one card", () => {
  test("the line is the card's body, ahead of every other state", () => {
    expect(PANEL).toContain('import AiOffSummary from "./AiOffSummary";');
    expect(count(PANEL, "<AiOffSummary ")).toBe(1);

    const region: number = PANEL.indexOf("id={AI_INVESTIGATION_PANEL_ID}");
    const line: number = PANEL.indexOf("<AiOffSummary ");
    const waiting: number = PANEL.indexOf("<InvestigationWaiting");
    const notStarted: number = PANEL.indexOf("<InvestigationNotStarted ");

    // Inside the region, in the body's slot: before the other states.
    expect(line).toBeGreaterThan(region);
    expect(line).toBeLessThan(waiting);
    expect(waiting).toBeLessThan(notStarted);
    expect(PANEL).toContain(
      "{offSummary ? ( <AiOffSummary summary={offSummary}",
    );
  });

  test("folded, the card draws no header of its own: the line is the header", () => {
    expect(PANEL).toContain("isHeaderHidden={isFolded}");
    expect(PANEL).toContain(
      'bodyClassName={isFolded ? FOLDED_CARD_BODY_CLASS_NAME : "mt-6"}',
    );
    // Still the one card, titled once.
    expect(count(PANEL, "<Card ")).toBe(1);
    expect(count(PANEL, 'title="AI Investigation"')).toBe(1);
  });

  test("decides from what it read and what the page says fixing did, and tells the page", () => {
    expect(PANEL).toContain(
      "isAiOffInvestigationReason(notInvestigatedReason)",
    );
    expect(PANEL).toContain(
      "const cardFold: AiCardFold = getAiCardFold({ isInvestigationLoaded, offReason, remediation: props.remediationState, });",
    );
    expect(PANEL).toContain("onCardFoldChangeRef.current?.(cardFold);");
    // Until the Remediation card has read, the card checks.
    expect(PANEL).toContain(
      'const isCheckingStatus: boolean = cardFold === "checking";',
    );
  });

  test("offers Ask OneUptime AI on the line only while AI is on and the conversation is not on screen", () => {
    expect(PANEL).toContain(
      "const isAskAiOnLine: boolean = Boolean(props.renderConversation) && isAiOffered && askAiRequest === 0 && !conversationHasContent;",
    );
    expect(PANEL).toContain("onAskAi={ isAskAiOnLine ?");
    // The conversation is told only while the card is folded.
    expect(PANEL).toContain(
      "const conversationFold: InvestigationConversationFold | undefined = isFolded ? {",
    );
  });

  test("reads the record's switches only while folded", () => {
    expect(PANEL).toContain(
      "useAiLaneSwitchStates({ subjectType, isEnabled: isFolded, })",
    );
  });
});

describe("the line is a line", () => {
  test("never a card, a box or an alert of its own", () => {
    expect(SUMMARY).not.toContain('from "Common/UI/Components/Card/Card"');
    expect(SUMMARY).not.toMatch(/<Card[\s>]/);
    expect(SUMMARY).not.toContain("Components/Alerts/Alert");
    expect(SUMMARY).not.toContain("dark:");
    expect(SUMMARY).not.toMatch(/\bshadow(-\w+)?\b/);
  });

  test("says what is off as a heading, and opens like a disclosure", () => {
    expect(count(SUMMARY, "<h2 ")).toBe(1);
    expect(SUMMARY).toContain("aria-expanded={props.isOpen}");
    expect(SUMMARY).toContain("aria-controls={stepsId}");
    expect(SUMMARY).toContain("aria-label={whatYouCanDo}");
    expect(SUMMARY).toContain("hidden={!props.isOpen}");
  });

  test("only a step the reader may make links anywhere", () => {
    expect(SUMMARY).toContain("PermissionGate.holdsAnyOf(step.permissions)");
    expect(SUMMARY).toContain("getAiOffSummaryLinks(summary.steps, canChange)");
    expect(SUMMARY).toContain(
      "getAiOffSummaryWhoCanChange(summary.steps, canChange)",
    );
  });

  test("its rules stay React-free, so App's tests can read them", () => {
    expect(SUMMARY_DATA).not.toMatch(/from "react"/);
    expect(SUMMARY_DATA).not.toContain(".tsx");
  });
});

describe("the conversation, folded into the line", () => {
  test("draws nothing while empty and not asked for, after every hook", () => {
    expect(CONVERSATION).toContain(
      "if (isFoldMode && !hasContent && !isAskedFromLine) { return <></>; }",
    );
    // The early return comes after the last hook the component calls.
    const early: number = CONVERSATION.indexOf(
      "if (isFoldMode && !hasContent && !isAskedFromLine)",
    );
    for (const hook of [
      "useEffect(",
      "useMemo(",
      "useRef<",
      "useState<",
      "useClipboardCopy(",
      "useInvestigationConversation(",
      "useTranslator(",
    ]) {
      expect({ hook, after: CONVERSATION.lastIndexOf(hook) < early }).toEqual({
        hook,
        after: true,
      });
    }
  });

  test("takes the focus only when asked for from the line", () => {
    expect(CONVERSATION).toContain("focusRequest={fold?.askRequest || 0}");
  });
});

describe("the Remediation card leaves 'nothing was fixed' to the line", () => {
  test("says what it read before it decides what to draw", () => {
    const report: number = REMEDIATION_CARD.indexOf(
      "onFoldStateChangeRef.current?.(foldState);",
    );
    const firstReturn: number = REMEDIATION_CARD.indexOf(
      "if (!isLoaded && props.hideIfEmpty) { return <Fragment />; }",
    );

    expect(report).toBeGreaterThan(-1);
    expect(firstReturn).toBeGreaterThan(report);
    expect(REMEDIATION_CARD).toContain(
      "isRemediationFoldedIntoAiCard({ state: foldState, aiCardFold: props.aiCardFold, })",
    );
    // What it read is only ever about the record on the page.
    expect(REMEDIATION_CARD).toContain(
      "isLoaded: isLoaded && loadedSubjectId === subjectIdString",
    );
  });
});

describe("the settings pages open where the line sends people", () => {
  test("the AI rules table is the More settings item the rules link names", () => {
    const table: string = readSource(
      "Components",
      "AISettings",
      "AiRulesTable.tsx",
    );

    expect(table).toContain("id: AiLaneAdvancedCard.AiRules,");
    expect(SUMMARY_DATA).toContain(
      "export const AI_SETTINGS_RULES_ANCHOR: string = AiLaneAdvancedCard.AiRules;",
    );
  });

  test.each<[string, string, string]>([
    ["incident", "Incidents", "IncidentAISettings.tsx"],
    ["alert", "Alerts", "AlertAISettings.tsx"],
  ])(
    "the %s settings page's minimum severity card is the item the severity link names",
    (_subjectType: string, folder: string, file: string) => {
      const settings: string = readSource("Pages", folder, "Settings", file);

      expect(settings).toContain(
        "id: AiLaneAdvancedCard.WhichAreInvestigated,",
      );
    },
  );

  test("the anchors are More settings items the page lists", () => {
    expect(SUMMARY_DATA).toContain(
      "export const AI_SETTINGS_WHICH_ANCHOR: string = AiLaneAdvancedCard.WhichAreInvestigated;",
    );

    const copy: string = readSource(
      "Components",
      "AISettings",
      "ProjectAiSettingsCopy.ts",
    );

    // getAiLaneAdvancedItems keys each item by its card.
    expect(copy).toContain("key: card,");
  });
});
