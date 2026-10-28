import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ASK AI ON THE MAIN STAGE: the wiring a refactor could quietly undo.
 *
 * Ask AI is one dialog in the middle of the screen over the dimmed, blurred
 * page it was opened from (Components/AIChat/AskAiDialog). It replaced a
 * side panel that slid in from the right and a full page of its own under
 * /ai/chat, two designs of one conversation. The behaviour is tested for
 * real against a DOM in Common/Tests/App/Dashboard/AskAiDialog.test.tsx and
 * in a browser by packages/E2E/AskAi; what is pinned here is the structure
 * those rely on:
 *
 *   1. it is a real modal dialog: role="dialog", aria-modal and a title, a
 *      backdrop that blurs the page, portalled out of the app so no
 *      stacking context traps it;
 *   2. the page behind cannot scroll (issue #3553: the incident list the
 *      person was asking about slid around under the answer) and is inert -
 *      both through the app's shared, counted locks, never by hand, so a
 *      Modal or the command palette opened over the dialog never hands the
 *      page back while it is still covered;
 *   3. every scroller inside Ask AI contains its own overscroll, so a wheel
 *      past the end of the conversation never chains out to the page;
 *   4. the chat's own address opens the dialog rather than drawing a second
 *      design of the conversation.
 *
 * These are assertions about source text because the App suite runs in a
 * plain Node environment (App/jest.config.json sets testEnvironment:
 * "node"), and no stylesheet is loaded even under jsdom.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const COMMON_ROOT: string = path.join(__dirname, "..", "..", "..", "Common");

const AI_CHAT_DIR: string = path.join(DASHBOARD_SRC, "Components", "AIChat");

/*
 * Comments are stripped before anything is matched: the prose above the
 * locks names `usePageScrollLock` and `overscroll-contain`, and an
 * assertion about the code has to read the code, not its commentary.
 */
const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /\/\/.*$/gm;
const WHITESPACE: RegExp = /\s+/g;

function stripComments(raw: string): string {
  return raw.replace(BLOCK_COMMENT, " ").replace(LINE_COMMENT, " ");
}

function readCode(root: string, ...relativeParts: Array<string>): string {
  return stripComments(
    fs.readFileSync(path.join(root, ...relativeParts), "utf8"),
  );
}

function squash(source: string): string {
  return source.replace(WHITESPACE, " ");
}

const DIALOG_SOURCE: string = readCode(AI_CHAT_DIR, "AskAiDialog.tsx");
const DIALOG: string = squash(DIALOG_SOURCE);

// The open dialog: the component mounted on every open.
function panelComponent(): string {
  const start: number = DIALOG.indexOf("const AskAiDialogPanel:");
  const end: number = DIALOG.indexOf("const AskAiDialog:", start);

  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  return DIALOG.slice(start, end);
}

describe("Ask AI is a real dialog in the middle of the screen", () => {
  test("it is a modal dialog with a name", () => {
    const panel: string = panelComponent();

    expect(panel).toContain('role="dialog"');
    expect(panel).toContain('aria-modal="true"');
    expect(panel).toContain("aria-labelledby={titleId}");
    expect(panel).toContain("id={titleId}");
  });

  test("it blurs and dims the page behind it", () => {
    expect(panelComponent()).toContain(
      "fixed inset-0 bg-gray-950/40 backdrop-blur-md",
    );
  });

  test("it sits in the middle of the screen, and fills a phone's", () => {
    const panel: string = panelComponent();

    expect(panel).toContain(
      "fixed inset-0 flex items-stretch justify-center sm:items-center sm:p-6",
    );
    expect(panel).toContain("h-[100dvh] w-full");
    expect(panel).toContain("sm:h-[min(52rem,calc(100dvh-3rem))] sm:max-w-4xl");
  });

  test("it is portalled out of the app, following a fullscreen element", () => {
    expect(DIALOG).toContain('import { createPortal } from "react-dom";');
    expect(DIALOG).toContain("createPortal(");
    expect(DIALOG).toContain("document.fullscreenElement");
  });

  test("its entrance respects a reader who asks for less motion", () => {
    const panel: string = panelComponent();

    expect(panel).toContain("transition-opacity duration-200");
    expect(panel).toContain("motion-reduce:transition-none");
  });
});

describe("Ask AI: the page behind it", () => {
  test("takes the shared page scroll lock and inert lock while it is open", () => {
    const panel: string = panelComponent();

    expect(panel).toContain("usePageScrollLock(true)");
    expect(panel).toContain("usePageInert(true, rootRef)");
  });

  test("takes them from the modules every dialog surface shares", () => {
    expect(DIALOG).toContain(
      'import { usePageScrollLock } from "Common/UI/Utils/PageScrollLock";',
    );
    expect(DIALOG).toContain(
      'import { usePageInert } from "Common/UI/Utils/PageInert";',
    );
  });

  test("never reaches for document.body itself, which would fight that counter", () => {
    expect(DIALOG_SOURCE).not.toContain("document.body.style");
    expect(DIALOG_SOURCE).not.toContain("document.documentElement.style");
    expect(DIALOG_SOURCE).not.toContain('setAttribute("inert"');
  });

  test("the locks are taken by the component mounted per open, never above an early return", () => {
    /*
     * The host stays mounted for the life of the app and draws the dialog
     * only while it is open; the panel mounts per open, so its locks are
     * released by its own cleanup when it closes.
     */
    const host: string = DIALOG.slice(DIALOG.indexOf("const AskAiDialog:"));

    expect(host).not.toContain("usePageScrollLock(");
    expect(host).not.toContain("usePageInert(");
    expect(host).toContain("isOpen && portalTarget ? ( createPortal(");
  });

  test("shares one counter with every dialog that can open over it", () => {
    const surfaces: Array<Array<string>> = [
      ["UI", "Components", "Modal", "Modal.tsx"],
      ["UI", "Components", "SideOver", "SideOver.tsx"],
      ["UI", "Components", "CommandPalette", "CommandPalette.tsx"],
    ];

    for (const parts of surfaces) {
      const source: string = squash(readCode(COMMON_ROOT, ...parts));

      expect(source).toContain("usePageScrollLock(");
      expect(source).not.toContain("document.body.style");
    }
  });
});

describe("Ask AI: keys and focus", () => {
  test("Esc closes it and Tab goes round inside it, after what is inside had the key", () => {
    const panel: string = panelComponent();

    expect(panel).toContain('window.addEventListener("keydown", onKeyDown)');
    expect(panel).toContain(
      "if (event.defaultPrevented || !panel || !isTopmostDialog(panel)) {",
    );
    expect(panel).toContain('if (event.key === "Escape") {');
    expect(panel).toContain('if (event.key !== "Tab") {');
  });

  test("the menus inside it spend their own Esc, so it does not close with them", () => {
    for (const picker of ["PermissionModePicker.tsx", "ProviderPicker.tsx"]) {
      const source: string = squash(readCode(AI_CHAT_DIR, picker));

      expect({
        picker,
        spent: source.includes(
          'if (event.key === "Escape") { event.preventDefault(); setIsOpen(false);',
        ),
      }).toEqual({ picker, spent: true });
    }
  });

  test("Ctrl/Cmd + I still leaves other text boxes their italics, but closes Ask AI from its own", () => {
    expect(DIALOG).toContain('event.key.toLowerCase() !== "i"');
    expect(DIALOG).toContain('target.tagName === "TEXTAREA"');
    expect(DIALOG).toContain("target.isContentEditable");
    expect(DIALOG).toContain(
      "target?.closest?.('[data-testid=\"ask-ai-dialog\"]')",
    );
  });

  test("the focus goes back to what opened it", () => {
    expect(DIALOG).toContain("openerRef.current = document.activeElement");
    expect(DIALOG).toContain("opener.focus({ preventScroll: true });");
  });
});

describe("Ask AI: scroll containment", () => {
  test("the conversation scrolls on demand and contains its overscroll", () => {
    const conversation: string = squash(
      readCode(AI_CHAT_DIR, "AskAiConversation.tsx"),
    );

    expect(conversation).toContain(
      'className="h-full overflow-y-auto overscroll-contain"',
    );
  });

  test("the composer contains its overscroll once it stops growing", () => {
    /*
     * The textarea auto-grows to max-h-40 and then scrolls natively, with no
     * overflow-* class of its own for the sweep below to catch.
     */
    const composer: string = squash(readCode(AI_CHAT_DIR, "ChatInput.tsx"));

    expect(composer).toContain("max-h-40");
    expect(composer).toMatch(/className="[^"]*\boverscroll-contain\b[^"]*"/);
  });

  test("every scroller anywhere in the Ask AI tree contains its overscroll", () => {
    /*
     * A sweep rather than a list, because the leak comes back the moment
     * someone adds the next scrollable region and forgets. A horizontal
     * scroller counts too: chaining a two-finger swipe out of a chat table
     * is what triggers the browser's back gesture.
     */
    const leaks: Array<string> = [];

    for (const file of tsxFilesIn(AI_CHAT_DIR)) {
      const source: string = stripComments(fs.readFileSync(file, "utf8"));

      for (const classes of classStringsIn(source)) {
        if (leaksOnAxis(classes, "y") || leaksOnAxis(classes, "x")) {
          leaks.push(`${path.relative(AI_CHAT_DIR, file)}: ${classes}`);
        }
      }
    }

    expect(leaks).toEqual([]);
  });

  test("the sweep can actually tell a contained scroller from a leaking one", () => {
    expect(leaksOnAxis("min-h-0 flex-1 overflow-y-auto", "y")).toBe(true);
    expect(leaksOnAxis("overflow-auto p-2", "y")).toBe(true);
    expect(leaksOnAxis("max-h-72 overflow-y-scroll", "y")).toBe(true);
    expect(leaksOnAxis("overflow-x-auto", "x")).toBe(true);

    expect(leaksOnAxis("overflow-y-auto overscroll-contain", "y")).toBe(false);
    expect(leaksOnAxis("overflow-y-auto overscroll-y-contain", "y")).toBe(
      false,
    );
    expect(leaksOnAxis("overflow-auto overscroll-none", "y")).toBe(false);
    expect(leaksOnAxis("overflow-x-auto overscroll-x-contain", "x")).toBe(
      false,
    );

    // Clipping is not scrolling, and neither is a class that merely spells it.
    expect(leaksOnAxis("overflow-hidden rounded-xl", "y")).toBe(false);
    expect(leaksOnAxis("group-overflow-y-auto-ish", "y")).toBe(false);

    // Containment on the other axis must not count.
    expect(leaksOnAxis("overflow-y-auto overscroll-x-contain", "y")).toBe(true);
  });
});

describe("Ask AI has one design: the chat's own address opens the dialog", () => {
  const PAGE: string = squash(
    readCode(DASHBOARD_SRC, "Pages", "AICopilot", "AICopilot.tsx"),
  );

  test("the address asks for the dialog, on the conversation it names", () => {
    expect(PAGE).toContain("openAskAi({");
    expect(PAGE).toContain("conversationId: conversationId");
    expect(PAGE).toContain("isForwarded: true");
  });

  test("and passes the browser on: back to the page it came from, or Home", () => {
    expect(PAGE).toContain("if (hasPageToGoBackTo()) { Navigation.goBack();");
    expect(PAGE).toContain(
      "RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route), { replace: true },",
    );
  });

  test("it draws no workspace of its own: no thread, no composer, no rail", () => {
    for (const piece of [
      "ChatMessageList",
      "ChatInput",
      "ChatHomeView",
      "useAiChat",
    ]) {
      expect({ piece, drawn: PAGE.includes(piece) }).toEqual({
        piece,
        drawn: false,
      });
    }
  });

  test("the dialog lets that one navigation pass and steps aside for every other", () => {
    expect(DIALOG).toContain("if (isForwardingRef.current) {");
    expect(DIALOG).toContain(
      "if (location.pathname === openPathRef.current) { return; }",
    );
  });
});

function classStringsIn(source: string): Array<string> {
  const found: Array<string> = [];
  const literals: RegExp = /(["'`])((?:(?!\1)[\s\S])*)\1/g;

  let match: RegExpExecArray | null = literals.exec(source);

  while (match !== null) {
    if (match[2] !== undefined) {
      found.push(match[2]);
    }

    match = literals.exec(source);
  }

  return found;
}

function tsxFilesIn(directory: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...tsxFilesIn(full));
      continue;
    }

    if (entry.name.endsWith(".tsx")) {
      found.push(full);
    }
  }

  return found.sort();
}

// A class list that scrolls on the given axis and is missing containment.
function leaksOnAxis(classes: string, axis: "x" | "y"): boolean {
  const scrolls: boolean = new RegExp(
    `(?<![\\w-])overflow(?:-${axis})?-(?:auto|scroll)(?![\\w-])`,
  ).test(classes);

  if (!scrolls) {
    return false;
  }

  return !new RegExp(
    `(?<![\\w-])overscroll-(?:${axis}-)?(?:contain|none)(?![\\w-])`,
  ).test(classes);
}
