import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ASK AI BESIDE THE PAGE: the wiring a refactor could quietly undo.
 *
 * Ask AI is a panel docked at the side of the window, with the page it is
 * about still all there beside it (Components/AIChat/AskAiPanel, issue #5597).
 * It replaced a dialog in the middle of the screen over a dimmed, blurred and
 * inert page, which had replaced a side panel that lay over the page. The
 * behaviour is tested for real against a DOM in
 * Common/Tests/App/Dashboard/AskAiPanel.test.tsx and in a browser by
 * packages/E2E/AskAi; what is pinned here is the structure those rely on:
 *
 *   1. docked, it takes its width from the page (PageDock) rather than lying
 *      over it, and leaves the page alone: no backdrop, no scroll lock, no
 *      inert page, no focus trap, no aria-modal;
 *   2. everything else pinned to the window's end stops short of it, so that
 *      nothing opens behind it;
 *   3. it stays open while the page moves, and only a sheet steps aside;
 *   4. on a window with no room for both it is a real dialog, through the
 *      app's shared, counted locks, never by hand, so a Modal or the command
 *      palette opened over it never hands the page back while it is covered;
 *   5. every scroller inside Ask AI contains its own overscroll, so a wheel
 *      past the end of the conversation never chains out to the page;
 *   6. the chat's own address opens the panel rather than drawing a second
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

// A class list with `fixed`, and with `right-0` or `end-0`: no variant of them.
const FIXED_CLASS: RegExp = /(?<![\w:-])fixed(?![\w-])/;
const PINNED_TO_END_CLASS: RegExp = /(?<![\w:-])(?:right|end)-0(?![\w-])/;

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

const PANEL_SOURCE: string = readCode(AI_CHAT_DIR, "AskAiPanel.tsx");
const PANEL: string = squash(PANEL_SOURCE);

// The open panel: the component mounted on every open.
function surfaceComponent(): string {
  const start: number = PANEL.indexOf("const AskAiPanelSurface:");
  const end: number = PANEL.indexOf("const AskAiPanel:", start);

  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  return PANEL.slice(start, end);
}

describe("Ask AI is docked beside the page", () => {
  test("the page makes room for it, through the one module that does", () => {
    expect(PANEL).toContain(
      'import { movePageDock, usePageDock } from "Common/UI/Utils/PageDock";',
    );
    expect(surfaceComponent()).toContain(
      "usePageDock(props.isDocked ? props.width : null);",
    );
  });

  test("docked it is a landmark beside the page, and a dialog only as a sheet", () => {
    const surface: string = surfaceComponent();

    expect(surface).toContain(
      'role={props.isDocked ? "complementary" : "dialog"}',
    );
    expect(surface).toContain(
      'aria-modal={props.isDocked ? undefined : "true"}',
    );
    expect(surface).toContain("aria-labelledby={titleId}");
    expect(surface).toContain("id={titleId}");
  });

  test("it sits at the end of the window, its whole height, as wide as it is told", () => {
    const surface: string = surfaceComponent();

    expect(surface).toContain('"inset-y-0 end-0 border-s"');
    expect(surface).toContain(
      "style={props.isDocked ? { width: `${props.width}px` } : undefined}",
    );
  });

  test("docked, nothing dims the page or blurs it: the backdrop is the sheet's alone", () => {
    const surface: string = surfaceComponent();
    const whileDocked: string = surface.slice(
      surface.indexOf("{props.isDocked ? ( <></> ) : ("),
    );

    expect(whileDocked).toContain('data-testid="ask-ai-backdrop"');
    expect(PANEL).not.toContain("backdrop-blur");
  });

  test("it is portalled out of the app, following a fullscreen element", () => {
    expect(PANEL).toContain('import { createPortal } from "react-dom";');
    expect(PANEL).toContain("createPortal(");
    expect(PANEL).toContain("document.fullscreenElement");
  });

  test("its entrance respects a reader who asks for less motion, and leaves no transform behind", () => {
    const surface: string = surfaceComponent();

    expect(surface).toContain("transition duration-200");
    expect(surface).toContain("motion-reduce:transition-none");
    expect(surface).toContain(
      'hasEntered ? "opacity-100" : "translate-x-4 opacity-0 [&:dir(rtl)]:-translate-x-4"',
    );
  });

  test("it stays off paper, and the page it made room for prints the whole sheet", () => {
    const theme: string = fs.readFileSync(
      path.join(COMMON_ROOT, "UI", "Styles", "Theme.css"),
      "utf8",
    );

    expect(surfaceComponent()).toContain(
      'className="relative z-40 print:hidden"',
    );
    expect(squash(theme)).toContain(
      "@media print { html { padding-inline-end: 0 !important; } }",
    );
  });
});

describe("Ask AI's edge", () => {
  const HANDLE: string = squash(readCode(AI_CHAT_DIR, "AskAiResizeHandle.tsx"));

  test("is a window splitter: focusable, with its value", () => {
    expect(HANDLE).toContain('role="separator"');
    expect(HANDLE).toContain('aria-orientation="vertical"');
    expect(HANDLE).toContain("aria-valuenow={shownWidth}");
    expect(HANDLE).toContain("aria-valuemin={props.minWidth}");
    expect(HANDLE).toContain("aria-valuemax={props.maxWidth}");
    expect(HANDLE).toContain("tabIndex={0}");
  });

  test("keeps the pointer until it is let go, wherever it wandered", () => {
    expect(HANDLE).toContain("handle.setPointerCapture(event.pointerId)");
    expect(HANDLE).toContain("onPointerCancel=");
  });

  test("starts a drag, not a text selection across the page", () => {
    expect(HANDLE).toContain(
      "onMouseDown={(event: React.MouseEvent<HTMLDivElement>) => { event.preventDefault(); }}",
    );
    expect(HANDLE).toContain("touch-none select-none");
  });

  test("moves the page without redrawing the conversation, and the page's listeners hear once it stops", () => {
    const surface: string = surfaceComponent();

    expect(surface).toContain("movePageDock(width);");
    expect(surface).toContain("onResizeEnd={props.onWidthChosen}");
    // Only the handle holds the width mid-drag: nothing above it draws again.
    expect(HANDLE).toContain("const [dragWidth, setDragWidth] = useState");
    expect(surface).not.toContain("useState<number>");
  });

  test("is only there beside the page: a sheet has no edge to drag", () => {
    expect(surfaceComponent()).toContain(
      "{props.isDocked ? ( <AskAiResizeHandle",
    );
  });
});

describe("Ask AI leaves the page alone while it is docked", () => {
  test("takes the shared page scroll lock and inert lock only as a sheet", () => {
    const surface: string = surfaceComponent();

    expect(surface).toContain("usePageScrollLock(!props.isDocked)");
    expect(surface).toContain("usePageInert(!props.isDocked, rootRef)");
  });

  test("takes them from the modules every dialog surface shares", () => {
    expect(PANEL).toContain(
      'import { usePageScrollLock } from "Common/UI/Utils/PageScrollLock";',
    );
    expect(PANEL).toContain(
      'import { usePageInert } from "Common/UI/Utils/PageInert";',
    );
  });

  test("never reaches for the page's styles itself, which would fight those modules", () => {
    expect(PANEL_SOURCE).not.toContain("document.body.style");
    expect(PANEL_SOURCE).not.toContain("document.documentElement.style");
    expect(PANEL_SOURCE).not.toContain('setAttribute("inert"');
  });

  test("the locks are taken by the component mounted per open, never above an early return", () => {
    /*
     * The host stays mounted for the life of the app and draws the panel only
     * while it is open; the surface mounts per open, so its locks and the room
     * it took are released by its own cleanup when it closes.
     */
    const host: string = PANEL.slice(PANEL.indexOf("const AskAiPanel:"));

    expect(host).not.toContain("usePageScrollLock(");
    expect(host).not.toContain("usePageInert(");
    expect(host).not.toContain("usePageDock(");
    expect(host).toContain("isOpen && portalTarget ? ( createPortal(");
  });

  test("the page's own clicks reach the page: only the sheet's backdrop closes it", () => {
    const surface: string = surfaceComponent();

    expect(surface).toContain("onClick={onBackdropClick}");
    expect(surface.split("onBackdropClick").length - 1).toBe(2);
    expect(PANEL).not.toContain("useComponentOutsideClick");
    expect(PANEL).not.toContain('addEventListener("mousedown"');
    expect(PANEL).not.toContain('addEventListener("click"');
  });

  test("the panel stays while the page moves, and only a sheet steps aside", () => {
    expect(PANEL).toContain("if (!isDockedRef.current) { close(); }");
  });

  test("shares one counter with every dialog that can open over a sheet", () => {
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

describe("what is pinned to the window's end stops short of Ask AI", () => {
  /*
   * A surface pinned to right: 0 opens behind the docked panel, or over it:
   * a log's detail drawer, a span's panel, the app's side panels. Each reads
   * the width the page made room for instead.
   */
  const PINNED: Array<[string, string]> = [
    [path.join(COMMON_ROOT, "UI/Components/SideOver/SideOver.tsx"), "layer"],
    [
      path.join(
        COMMON_ROOT,
        "UI/Components/TelemetryViewer/components/TelemetryDetailPanel.tsx",
      ),
      "a telemetry row's drawer",
    ],
    [
      path.join(DASHBOARD_SRC, "Components/Traces/TraceExplorer.tsx"),
      "a span's panel",
    ],
    [
      path.join(
        DASHBOARD_SRC,
        "Components/Dashboard/Playlist/PlaylistPlayer.tsx",
      ),
      "the playlist player",
    ],
  ];

  test.each(PINNED)("%s (%s)", (file: string) => {
    const source: string = squash(stripComments(fs.readFileSync(file, "utf8")));

    expect(source).toMatch(
      /import \{ PAGE_DOCK_END_CLASS_NAME \} from "[^"]*PageDock";/,
    );
    expect(source).toContain("${PAGE_DOCK_END_CLASS_NAME}");
    expect(source).not.toContain("fixed right-0");
    expect(source).not.toContain("fixed inset-y-0 right-0");
  });

  test("the page dock's class reads the variable the page dock writes", () => {
    const dock: string = readCode(COMMON_ROOT, "UI", "Utils", "PageDock.ts");

    expect(dock).toContain('"--page-dock-width"');
    expect(dock).toContain('"end-[var(--page-dock-width,0px)]"');
  });

  test("no other surface in the app has been pinned to the window's end since", () => {
    /*
     * A sweep rather than a list, because the next drawer pinned to right: 0
     * would open behind Ask AI and nobody would see it in a review. A surface
     * that is a dialog over the whole window has no end to pin.
     */
    const pinned: Array<string> = [];

    for (const root of [
      path.join(COMMON_ROOT, "UI", "Components"),
      path.join(DASHBOARD_SRC, "Components"),
      path.join(DASHBOARD_SRC, "Pages"),
    ]) {
      for (const file of tsxFilesIn(root)) {
        // The docked panel itself: the one surface that is at the window's end.
        if (file.endsWith("AskAiPanel.tsx")) {
          continue;
        }

        const source: string = stripComments(fs.readFileSync(file, "utf8"));

        for (const classes of classStringsIn(source)) {
          if (FIXED_CLASS.test(classes) && PINNED_TO_END_CLASS.test(classes)) {
            pinned.push(`${path.relative(root, file)}: ${classes}`);
          }
        }
      }
    }

    expect(pinned).toEqual([]);
  });
});

describe("Ask AI: keys and focus", () => {
  test("Esc closes it from inside it, after what is inside had the key", () => {
    const surface: string = surfaceComponent();

    expect(surface).toContain('window.addEventListener("keydown", onKeyDown)');
    expect(surface).toContain("if (event.defaultPrevented || !panel) {");
    expect(surface).toContain(
      'if (event.key === "Escape" && panel.contains(document.activeElement)) {',
    );
  });

  test("Tab is kept inside it only as a sheet", () => {
    const surface: string = surfaceComponent();
    const docked: number = surface.indexOf("if (isDockedRef.current) {");
    const tab: number = surface.indexOf('if (event.key !== "Tab") {');
    const trap: number = surface.indexOf("if (!isTopmostDialog(panel)) {");

    expect(docked).toBeGreaterThan(-1);
    expect(trap).toBeGreaterThan(docked);
    expect(tab).toBeGreaterThan(trap);
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
    expect(PANEL).toContain('event.key.toLowerCase() !== "i"');
    expect(PANEL).toContain('target.tagName === "TEXTAREA"');
    expect(PANEL).toContain("target.isContentEditable");
    expect(PANEL).toContain("target?.closest?.(PANEL_SELECTOR)");
  });

  test("from the page, those keys go back to the composer rather than closing it", () => {
    expect(PANEL).toContain(
      "isOpenRef.current && isDockedRef.current && panel && !panel.contains(document.activeElement)",
    );
    expect(PANEL).toContain("hasOpenDialogOtherThan(panel)");
  });

  test("the focus goes back to what opened it, if it was the panel's to give", () => {
    expect(PANEL).toContain("openerRef.current = document.activeElement");
    expect(PANEL).toContain("shouldGiveFocusBackRef.current &&");
    expect(PANEL).toContain("opener.focus({ preventScroll: true });");
  });
});

describe("the composer stays at the panel's foot", () => {
  test("drawn once, by the panel, for both the start and the conversation", () => {
    expect(surfaceComponent()).toContain(
      '<div className="mx-auto w-full max-w-3xl px-4">{composer}</div>',
    );
    expect(surfaceComponent()).toContain(
      '{view === "home" || view === "conversation" ? (',
    );
    // The start draws none of its own, to jump from.
    expect(squash(readCode(AI_CHAT_DIR, "ChatHomeView.tsx"))).not.toContain(
      "composer",
    );
  });

  test("the menus of its controls are placed against its row, which has room for them", () => {
    const composer: string = squash(readCode(AI_CHAT_DIR, "ChatInput.tsx"));

    expect(composer).toContain(
      '<div className="relative flex items-center justify-between gap-2 px-2 pb-2 pt-1">',
    );

    for (const picker of ["PermissionModePicker.tsx", "ProviderPicker.tsx"]) {
      const source: string = squash(readCode(AI_CHAT_DIR, picker));

      expect({
        picker,
        placed: source.includes("<div ref={containerRef}>"),
      }).toEqual({ picker, placed: true });
      expect({ picker, fits: source.includes("max-w-full") }).toEqual({
        picker,
        fits: true,
      });
    }
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

describe("Ask AI has one design: the chat's own address opens the panel", () => {
  const PAGE: string = squash(
    readCode(DASHBOARD_SRC, "Pages", "AICopilot", "AICopilot.tsx"),
  );

  test("the address asks for the panel, on the conversation it names", () => {
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

  test("the panel lets that one navigation pass, even as a sheet", () => {
    expect(PANEL).toContain("if (isForwardingRef.current) {");
    expect(PANEL).toContain(
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
