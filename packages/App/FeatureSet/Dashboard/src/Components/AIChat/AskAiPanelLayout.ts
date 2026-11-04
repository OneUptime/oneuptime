import RememberedChoice from "Common/UI/Utils/RememberedChoice";
import { useEffect, useState } from "react";

/*
 * Where Ask AI sits, and how wide it is.
 *
 * On a window with room for both, it is docked beside the page, which keeps
 * working in what is left. On a narrower one there is no room for both, and it
 * is a sheet over the page until it is closed: the whole screen on a phone.
 * The page's own layouts answer to the window's width, not to the room they
 * are given, so below this width they would be laid out for more than they
 * have.
 */
export const ASK_AI_DOCK_MIN_WINDOW_WIDTH: number = 1024;

// What the panel opens at, until the person drags it to a width of their own.
export const ASK_AI_PANEL_DEFAULT_WIDTH: number = 440;

// Below this a question, a table and the composer's controls no longer fit.
export const ASK_AI_PANEL_MIN_WIDTH: number = 340;

export const ASK_AI_PANEL_MAX_WIDTH: number = 800;

// The room the page always keeps, however far the panel is dragged.
export const ASK_AI_PAGE_MIN_WIDTH: number = 640;

// How far one press of an arrow key moves the panel's edge.
export const ASK_AI_PANEL_RESIZE_KEY_STEP: number = 24;

export const ASK_AI_PANEL_WIDTH_KEY: string = "ask-ai-panel-width";

const WHOLE_NUMBER: RegExp = /^\d{1,5}$/;

export function canDockAskAi(windowWidth: number): boolean {
  return windowWidth >= ASK_AI_DOCK_MIN_WINDOW_WIDTH;
}

// The widest the panel may be in this window, leaving the page its room.
export function getAskAiPanelMaxWidth(windowWidth: number): number {
  return Math.max(
    ASK_AI_PANEL_MIN_WIDTH,
    Math.min(ASK_AI_PANEL_MAX_WIDTH, windowWidth - ASK_AI_PAGE_MIN_WIDTH),
  );
}

/*
 * A width the panel can actually have in this window. Nothing is lost by it:
 * the width asked for is kept, so a window made narrow and wide again puts the
 * panel back where the person left it.
 */
export function clampAskAiPanelWidth(
  width: number,
  windowWidth: number,
): number {
  return Math.round(
    Math.min(
      getAskAiPanelMaxWidth(windowWidth),
      Math.max(ASK_AI_PANEL_MIN_WIDTH, width),
    ),
  );
}

/*
 * The width this browser keeps for the panel, or the default for none. A value
 * an older version wrote, or a person typed into the browser's tools, is read
 * as no choice.
 */
export function readAskAiPanelWidth(): number {
  const remembered: string | null = RememberedChoice.read(
    ASK_AI_PANEL_WIDTH_KEY,
  );

  if (remembered === null || !WHOLE_NUMBER.test(remembered)) {
    return ASK_AI_PANEL_DEFAULT_WIDTH;
  }

  return Number(remembered);
}

export function rememberAskAiPanelWidth(width: number): void {
  RememberedChoice.remember(ASK_AI_PANEL_WIDTH_KEY, String(Math.round(width)));
}

// Back to the width it opens at, for a window of any size.
export function forgetAskAiPanelWidth(): void {
  RememberedChoice.forget(ASK_AI_PANEL_WIDTH_KEY);
}

function readWindowWidth(): number {
  return typeof window !== "undefined" ? window.innerWidth : 0;
}

/*
 * The window's width, followed as it changes. The page making room for the
 * panel announces itself with a resize event of its own (PageDock), which
 * leaves the window as wide as it was: that one changes nothing here.
 */
export function useWindowWidth(): number {
  const [width, setWidth] = useState<number>(readWindowWidth);

  useEffect(() => {
    const measure: () => void = (): void => {
      setWidth(readWindowWidth());
    };

    // Whatever changed between the first draw and this listener.
    measure();
    window.addEventListener("resize", measure);

    return () => {
      window.removeEventListener("resize", measure);
    };
  }, []);

  return width;
}
