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
 * that makes it work on the real pages: the card's Remediation step (block
 * 43) says what fixing did, and the card that holds it decides whether it
 * is one line - a step that forgot to say would never let the card fold,
 * and one that drew itself under the line would say "nothing was fixed"
 * twice.
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
const REMEDIATION_STEP: string = readSource(
  "Components",
  "AutoRemediation",
  "RemediationStep.tsx",
);

describe.each(PAGES)(
  "the %s page draws one AI card that holds both steps",
  (subjectType: string, _folder: string, page: string) => {
    /*
     * Block 43: remediation is the AI card's second step, up top. The page
     * drew it as a card of its own far down, under the telemetry, and
     * joined the two with useAiCardFold; the card holds both now.
     */
    test("draws no Remediation card of its own, and joins nothing", () => {
      expect(page).not.toContain("RemediationSuggestionCard");
      expect(page).not.toContain("<RemediationStep");
      expect(page).not.toContain("useAiCardFold");
      expect(count(page, "<InvestigationPanel ")).toBe(1);
    });

    test("the AI card is told the record, and whether it is resolved", () => {
      const panel: string = page.slice(
        page.indexOf("<InvestigationPanel "),
        page.indexOf(
          "renderConversation=",
          page.indexOf("<InvestigationPanel "),
        ),
      );

      expect(panel).toContain(`subjectType="${subjectType}"`);
      expect(panel).toContain(
        "isRecordResolved={standing === EventStanding.Resolved}",
      );
      expect(panel).not.toContain("remediationState=");
      expect(panel).not.toContain("onCardFoldChange=");
    });

    test("the conversation it closes with is handed the card's fold", () => {
      const conversation: string = elementOf(page, "InvestigationConversation");

      expect(conversation).toContain(
        "investigationStage={slot.investigationStage}",
      );
      expect(conversation).toContain("fold={slot.fold}");
    });

  },
);

describe("the AI card holds its Remediation step", () => {
  test("keeps what the step says for this record only", () => {
    expect(PANEL).toContain(
      'import useAiCardFold, { AiCardFoldWiring } from "./useAiCardFold";',
    );
    expect(count(PANEL, "useAiCardFold(")).toBe(1);
    expect(PANEL).toContain(
      "const aiCardFold: AiCardFoldWiring = useAiCardFold(subjectKey);",
    );
    expect(PANEL).toContain(
      "const remediationState: RemediationFoldState = aiCardFold.remediationState;",
    );
  });

  test("the step says what fixing did, and is told how the card is drawn", () => {
    expect(count(PANEL, "<RemediationStep ")).toBe(1);

    const step: string = elementOf(PANEL, "RemediationStep");

    expect(step).toContain(
      '{...(subjectType === "incident" ? { incidentId: props.subjectId } : { alertId: props.subjectId })}',
    );
    expect(step).toContain(
      "onFoldStateChange={aiCardFold.onRemediationStateChange}",
    );
    expect(step).toContain("aiCardFold={cardFold}");
    expect(step).toContain("investigationStage={investigationStage}");
    expect(step).toContain("isRecordResolved={props.isRecordResolved}");
  });
});

describe("the AI card draws the line inside its one card", () => {
  test("the line is the card's body, in place of its two steps", () => {
    expect(PANEL).toContain('import AiOffSummary from "./AiOffSummary";');
    expect(count(PANEL, "<AiOffSummary ")).toBe(1);

    const region: number = PANEL.indexOf("id={AI_INVESTIGATION_PANEL_ID}");
    const line: number = PANEL.indexOf("<AiOffSummary ");
    const steps: number = PANEL.indexOf('<div data-testid="ai-card-steps"');

    // Inside the region, ahead of the steps, which it stands in for.
    expect(line).toBeGreaterThan(region);
    expect(steps).toBeGreaterThan(line);
    expect(PANEL).toContain(
      "{offSummary ? ( <AiOffSummary summary={offSummary}",
    );
    expect(PANEL).toContain(
      '<div data-testid="ai-card-steps" hidden={isFolded}> {!isFolded ? ( <AiCardStep number={1}',
    );
  });

  test("folded, the card draws no header of its own: the line is the header", () => {
    expect(PANEL).toContain("isHeaderHidden={isFolded}");
    expect(PANEL).toContain(
      'bodyClassName={isFolded ? FOLDED_CARD_BODY_CLASS_NAME : "mt-6"}',
    );
    // Still the one card, titled once.
    expect(count(PANEL, "<Card ")).toBe(1);
    expect(count(PANEL, "title={AI_CARD_TITLE}")).toBe(1);
  });

  test("decides from what it read and what its step says fixing did", () => {
    expect(PANEL).toContain(
      "isAiOffInvestigationReason(notInvestigatedReason)",
    );
    expect(PANEL).toContain(
      "const cardFold: AiCardFold = getAiCardFold({ isInvestigationLoaded, offReason, remediation: remediationState, areSwitchesRead: laneSwitches.isRead, });",
    );
    // Until the Remediation step has read, the card checks.
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

  /*
   * Read as soon as the card may fold, beside the Remediation step's own
   * read, and the card folds only once they are read: the line is drawn
   * once, in its final words ("was off", "is on now").
   */
  test("reads the record's switches once the card may fold, and folds once they are read", () => {
    expect(PANEL).toContain(
      "const laneSwitches: AiLaneSwitchRead = useAiLaneSwitchStates({ subjectType, isEnabled: canAiCardFold({ offReason, remediation: remediationState, }), });",
    );
    expect(PANEL.indexOf("useAiLaneSwitchStates({")).toBeLessThan(
      PANEL.indexOf("getAiCardFold({"),
    );
    expect(PANEL).toContain("switches: laneSwitches.states,");
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
    // The line itself opens it too, as a folded section's header does.
    expect(count(SUMMARY, "onClick={onLineClick}")).toBe(2);
    expect(SUMMARY).toContain('target.closest("button, a")');
  });

  test("only a step the reader may make links anywhere", () => {
    expect(SUMMARY).toContain("PermissionGate.holdsAnyOf(step.permissions)");
    // Each group of steps ends with its link, or who can for everyone else.
    expect(SUMMARY).toContain("getAiOffStepGroups(summary.steps, canChange)");
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

describe("the Remediation step leaves 'nothing was fixed' to the line", () => {
  test("says what it read before it decides what to draw", () => {
    const report: number = REMEDIATION_STEP.indexOf(
      "onFoldStateChangeRef.current?.(foldState);",
    );
    const firstReturn: number = REMEDIATION_STEP.indexOf(
      'if ( props.aiCardFold === "folded" || props.aiCardFold === "checking" || isRemediationFoldedIntoAiCard({ state: foldState, aiCardFold: props.aiCardFold, }) ) { return <Fragment />; }',
    );

    expect(report).toBeGreaterThan(-1);
    expect(firstReturn).toBeGreaterThan(report);
    // Every hook comes before it: the step reads, whatever it draws.
    for (const hook of ["useEffect(", "useState<", "useRef<", "useCallback("]) {
      expect({
        hook,
        before: REMEDIATION_STEP.lastIndexOf(hook) < firstReturn,
      }).toEqual({ hook, before: true });
    }
    // What it read is only ever about the record on the page.
    expect(REMEDIATION_STEP).toContain(
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
