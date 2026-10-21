import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Incident and alert pages have one AI card. The investigation (or the
 * explanation of why none ran) and the conversation with OneUptime AI used
 * to be two: with no run they were two cards on the page, and with a run the
 * conversation sat in the card behind an icon tile and a header of its own.
 *
 * How the card renders is covered in Common/Tests/App/Dashboard
 * (InvestigationPanel, InvestigationConversation, InvestigationNotStarted)
 * and in the browser suite in packages/E2E/EventOverview. These read the
 * sources and hold the wiring that keeps it one card, so a second one cannot
 * come back through a page or a component nobody rendered in a test.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const AI_COMPONENTS: string = path.join(DASHBOARD_SRC, "Components", "AI");

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

type CountFunction = (source: string, pattern: RegExp) => number;

const count: CountFunction = (source: string, pattern: RegExp): number => {
  return (source.match(pattern) || []).length;
};

const INCIDENT_VIEW: string = readSource(
  "Pages",
  "Incidents",
  "View",
  "Index.tsx",
);
const ALERT_VIEW: string = readSource("Pages", "Alerts", "View", "Index.tsx");
const PANEL: string = readSource("Components", "AI", "InvestigationPanel.tsx");
const NOT_STARTED: string = readSource(
  "Components",
  "AI",
  "InvestigationNotStarted.tsx",
);
const NOTICE: string = readSource(
  "Components",
  "AI",
  "InvestigationNotice.tsx",
);
const CONVERSATION: string = readSource(
  "Components",
  "AI",
  "InvestigationConversation",
  "InvestigationConversation.tsx",
);
const COMPOSER: string = readSource(
  "Components",
  "AI",
  "InvestigationConversation",
  "ConversationComposer.tsx",
);
const SOURCES: string = readSource(
  "Components",
  "AI",
  "InvestigationConversation",
  "AnswerSources.tsx",
);

const CARD_IMPORT: RegExp = /from "Common\/UI\/Components\/Card\/Card"/;
const CARD_ELEMENT: RegExp = /<Card[\s>]/g;
const ALERT_IMPORT: RegExp = /from "Common\/UI\/Components\/Alerts\/Alert"/;

const EVENT_PAGES: Array<[string, string]> = [
  ["incident", INCIDENT_VIEW],
  ["alert", ALERT_VIEW],
];

describe.each(EVENT_PAGES)(
  "the %s page has one AI card",
  (subjectType: string, view: string) => {
    test("renders one investigation panel and hands it one conversation", () => {
      expect(count(view, /<InvestigationPanel[\s>]/g)).toBe(1);
      expect(count(view, /<InvestigationConversation[\s>]/g)).toBe(1);
    });

    test("the conversation is rendered only through the panel's slot", () => {
      const slot: RegExpMatchArray | null = view.match(
        /renderConversation=\{\(slot: InvestigationConversationSlot\) => \{ return \( (<InvestigationConversation [^>]*\/>) \); \}\}/,
      );

      expect(slot).not.toBeNull();
      // The only one on the page is the one inside the slot.
      expect(view.split("<InvestigationConversation").length - 1).toBe(1);
      expect(slot![1]).toContain(`subjectType="${subjectType}"`);
      expect(slot![1]).toContain("subjectId={modelId}");
    });

    test("tells the conversation where the investigation stands", () => {
      expect(view).toContain("investigationStage={slot.investigationStage}");
    });

    test("no longer chooses between a card and an embedded conversation", () => {
      // Everything the page hands the panel, up to the end of its element.
      const panelStart: number = view.indexOf("<InvestigationPanel ");
      const panelElement: string = view.slice(
        panelStart,
        view.indexOf("/>", view.indexOf("renderConversation=", panelStart)) + 2,
      );

      expect(panelElement).toContain("<InvestigationConversation ");
      expect(panelElement).not.toMatch(/variant/);
      expect(panelElement).not.toContain('"embedded"');
      expect(panelElement).not.toContain('"card"');
    });

    test("the panel and the conversation are for the same subject", () => {
      const panel: RegExpMatchArray | null = view.match(
        /<InvestigationPanel subjectType="(incident|alert)" subjectId=\{modelId\}/,
      );

      expect(panel).not.toBeNull();
      expect(panel![1]).toBe(subjectType);
    });
  },
);

describe("the panel draws the one card", () => {
  test("exactly one Card, whatever the state", () => {
    expect(PANEL).toMatch(CARD_IMPORT);
    expect(count(PANEL, CARD_ELEMENT)).toBe(1);
    // And one way out of the component: no early return with a card of its own.
    expect(count(PANEL, /return \( <Card /g)).toBe(1);
  });

  test("the card is titled once and its pill is drawn once", () => {
    expect(count(PANEL, /title="AI Investigation"/g)).toBe(1);
    expect(count(PANEL, /<InvestigationStatusBadge /g)).toBe(1);
    /*
     * The default header keeps the pill on the title's line at the card's
     * right edge, a phone included; the "inline" layout that once did it is
     * gone.
     */
    expect(PANEL).not.toContain("headerLayout=");
  });

  test("the not-started state is that card's body", () => {
    expect(count(PANEL, /<InvestigationNotStarted /g)).toBe(1);
    expect(NOT_STARTED).not.toMatch(CARD_IMPORT);
    expect(count(NOT_STARTED, CARD_ELEMENT)).toBe(0);
    // The title, the pill and the region belong to the panel alone.
    expect(NOT_STARTED).not.toContain("AI Investigation");
    expect(NOT_STARTED).not.toContain("<InvestigationStatusBadge");
    expect(NOT_STARTED).not.toContain("AI_INVESTIGATION_PANEL_ID");
    expect(count(PANEL, /id=\{AI_INVESTIGATION_PANEL_ID\}/g)).toBe(1);
  });

  test("the file the not-started card lived in is gone, and nothing imports it", () => {
    expect(
      fs.existsSync(
        path.join(AI_COMPONENTS, "InvestigationNotStartedCard.tsx"),
      ),
    ).toBe(false);

    for (const source of [PANEL, CONVERSATION, INCIDENT_VIEW, ALERT_VIEW]) {
      expect(source).not.toContain("InvestigationNotStartedCard");
    }
  });

  test("closes the card with the conversation in every state, from one place", () => {
    expect(count(PANEL, /props\.renderConversation\(/g)).toBe(1);
    expect(PANEL).toContain("props.renderConversation({ investigationStage })");
    // After the region opens and before it closes: inside the card.
    const region: number = PANEL.indexOf("id={AI_INVESTIGATION_PANEL_ID}");
    const call: number = PANEL.indexOf("props.renderConversation(");
    const cardEnd: number = PANEL.lastIndexOf("</Card>");

    expect(region).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(region);
    expect(cardEnd).toBeGreaterThan(call);
  });

  test("the conversation's slot does not depend on the state", () => {
    /*
     * It is called with the stage and nothing else decides whether it is
     * called: a slot that moved with the state made React rebuild the
     * conversation, and what was being typed, when an investigation started.
     */
    expect(PANEL).toMatch(
      /\{props\.renderConversation \? \( props\.renderConversation\(\{ investigationStage \}\) \) : \( <><\/> \)\}/,
    );
    expect(PANEL).not.toMatch(/renderConversation\("(card|embedded)"\)/);
  });

  test("stays independent of the conversation it is handed", () => {
    expect(PANEL).not.toContain("InvestigationConversation/");
    expect(PANEL).not.toContain("<InvestigationConversation");
  });
});

describe("the conversation is a section of that card", () => {
  test("is never a card of its own", () => {
    expect(CONVERSATION).not.toMatch(CARD_IMPORT);
    expect(count(CONVERSATION, CARD_ELEMENT)).toBe(0);
    expect(CONVERSATION).not.toMatch(/variant[?=:]/);
    expect(CONVERSATION).toContain("investigationStage");
  });

  test("uses the card's own composer and sources, not the Ask AI panel's", () => {
    expect(CONVERSATION).toContain('from "./ConversationComposer"');
    expect(CONVERSATION).toContain('from "./AnswerSources"');
    expect(CONVERSATION).not.toContain("AIChat/ChatInput");
    expect(CONVERSATION).not.toContain("AIChat/CitationChips");
    expect(COMPOSER).not.toContain("AIChat/ChatInput");
    expect(SOURCES).not.toContain("AIChat/CitationChips");
  });

  test("its thread is part of the page, not a scrolling box in the card", () => {
    for (const source of [CONVERSATION, SOURCES]) {
      expect(source).not.toMatch(/overflow-y-(auto|scroll)/);
      expect(source).not.toContain("overscroll-contain");
      expect(source).not.toMatch(/max-h-\[/);
      expect(source).not.toContain("scrollTop");
    }
  });

  test("the composer's menu opens inside the card", () => {
    expect(COMPOSER).toMatch(/<PermissionModePicker [^>]*menuAlign="left"/);
  });

  test("the composer never takes focus when the page loads", () => {
    expect(COMPOSER).not.toMatch(/autoFocus/i);
  });
});

describe("the card says things in one notice, never in a box", () => {
  test.each([
    ["the panel", PANEL],
    ["the conversation", CONVERSATION],
    ["the not-started body", NOT_STARTED],
  ])("%s does not use the alert box", (_name: string, source: string) => {
    expect(source).not.toMatch(ALERT_IMPORT);
    expect(source).not.toContain("<Alert");
    expect(source).not.toContain("AlertType.");
  });

  test("the panel and the conversation share one notice component", () => {
    expect(PANEL).toContain('from "./InvestigationNotice"');
    expect(CONVERSATION).toContain('from "../InvestigationNotice"');
    // The panel's private copy is gone.
    expect(PANEL).not.toContain("InvestigationPanelNotice");
  });

  test("the notice itself is a line: no frame, no wash, no shadow", () => {
    const classNames: Array<string> = Array.from(
      NOTICE.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1] || match[2] || "";
    });
    const BOX_TOKEN: RegExp =
      /(^|\s)(border(-[a-z]+-\d{2,3})?|shadow(-\w+)?|rounded-(lg|xl|2xl)|bg-(red|green|emerald|amber|rose|blue|indigo)-(50|100))(\s|$)/;

    expect(classNames.length).toBeGreaterThan(3);
    for (const className of classNames) {
      expect({ className, isBox: BOX_TOKEN.test(className) }).toEqual({
        className,
        isBox: false,
      });
    }
  });

  test.each([
    ["Fix task created", "investigation-fix-task-created"],
    ["Could not create the fix task", "investigation-fix-task-error"],
    ["Could not save your verdict", "investigation-verdict-error"],
  ])("'%s' is a notice", (title: string, testId: string) => {
    const notice: RegExp = new RegExp(
      `<InvestigationNotice role="alert" testId="${testId}" indicator=\\{notice(Done|Failed)Icon\\} title="${title}"`,
    );

    expect(PANEL).toMatch(notice);
  });
});
