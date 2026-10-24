/*
 * A note whose button takes the note away - a rule that only fixes and its
 * "Investigate too", an older rule and its "Fix like a new rule" - would
 * leave keyboard focus on nothing: the button it was on is gone, and focus
 * falls back to the page, so the next Tab starts again from the dialog's
 * top. Focus goes instead to the question the note stood in for, once the
 * form has drawn it: a keyboard or screen reader user lands on "When to
 * investigate" or on the Fix answer, where a mouse user's eye goes.
 *
 * The place to look is the dialog the note is in, found when the button is
 * pressed - the note itself is gone by the time the question is drawn. The
 * question is looked for once the note is gone, a few times while the form
 * redraws, and never once focus has moved somewhere else meanwhile.
 *
 * React-free, so it is tested on its own.
 */

export const FOCUS_WHEN_DRAWN_TRIES: number = 10;

export const FOCUS_WHEN_DRAWN_INTERVAL_MS: number = 25;

export interface FocusWhenDrawnInput {
  // The element pressed, or the note it is in.
  from: Element | null;
  // Where focus goes, in order of preference: the first one drawn wins.
  selectors: Array<string>;
}

// The first element a selector finds in the scope that can take focus.
function findTarget(
  scope: ParentNode,
  selectors: Array<string>,
): HTMLElement | null {
  for (const selector of selectors) {
    const element: Element | null = scope.querySelector(selector);

    if (element && typeof (element as HTMLElement).focus === "function") {
      return element as HTMLElement;
    }
  }

  return null;
}

/*
 * Whether focus is still where pressing the note's button left it: on the
 * page, or on the button or the note while they are drawn.
 */
function isFocusLeftBehind(ownerDocument: Document, from: Element): boolean {
  const active: Element | null = ownerDocument.activeElement;

  return (
    !active ||
    active === ownerDocument.body ||
    active === ownerDocument.documentElement ||
    from.contains(active)
  );
}

export function focusWhenDrawn(input: FocusWhenDrawnInput): void {
  const from: Element | null = input.from;

  if (!from) {
    return;
  }

  const ownerDocument: Document = from.ownerDocument;
  // Found now: once the note is gone, it has no dialog to look in.
  const scope: ParentNode = from.closest("[role='dialog']") || ownerDocument;
  let triesLeft: number = FOCUS_WHEN_DRAWN_TRIES;

  const tryToFocus: () => void = (): void => {
    if (!isFocusLeftBehind(ownerDocument, from)) {
      return;
    }

    /*
     * While the note is still drawn the form has not taken the answer yet,
     * and the question may still show the one before it.
     */
    const target: HTMLElement | null = from.isConnected
      ? null
      : findTarget(scope, input.selectors);

    if (target) {
      target.focus();
      return;
    }

    triesLeft--;

    if (triesLeft > 0) {
      setTimeout(tryToFocus, FOCUS_WHEN_DRAWN_INTERVAL_MS);
    }
  };

  setTimeout(tryToFocus, 0);
}
