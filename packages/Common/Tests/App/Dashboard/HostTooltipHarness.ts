import { expect, jest } from "@jest/globals";
import { act, fireEvent } from "@testing-library/react";

/*
 * Helpers for the Host page render tests (HostOverviewTooltips,
 * HostProcessViewTooltips, HostServiceUnitTooltips, HostListColumnTooltips).
 * Not a test file itself (no .test. in the name), so jest does not run it.
 *
 * An (i) is an InfoTooltip: a <button aria-label="About <title>"> whose
 * Tippy popup is created lazily on first hover and portalled to <body>.
 * Under jsdom a hidden popup never finishes animating out, so a page that
 * hovers several (i)s can hold several popups at once; the text is
 * therefore read through the aria-describedby link Tippy puts on the
 * trigger while it is shown, never through "the" tooltip on the page.
 *
 * Every helper here expects jest fake timers.
 */

const ABOUT: string = "About ";

// The (i) buttons under `root`, in document order.
export function infoButtons(
  root: ParentNode = document.body,
): Array<HTMLElement> {
  return Array.from(
    root.querySelectorAll<HTMLElement>(`button[aria-label^="${ABOUT}"]`),
  );
}

// What each (i) under `root` explains, in document order.
export function infoLabels(root: ParentNode = document.body): Array<string> {
  return infoButtons(root).map((button: HTMLElement): string => {
    return (button.getAttribute("aria-label") || "").slice(ABOUT.length);
  });
}

// The (i) buttons named "About <label>", in document order.
export function infoButtonsFor(
  label: string,
  root: ParentNode = document.body,
): Array<HTMLElement> {
  return infoButtons(root).filter((button: HTMLElement): boolean => {
    return button.getAttribute("aria-label") === `${ABOUT}${label}`;
  });
}

/*
 * Hover an (i), read the text its tooltip shows, then move the pointer
 * away again so the next hover starts clean.
 */
export async function explanationOnHover(button: HTMLElement): Promise<string> {
  fireEvent.mouseEnter(button);
  await act(async () => {
    jest.advanceTimersByTime(250);
  });

  const describedBy: string | null = button.getAttribute("aria-describedby");
  const popup: HTMLElement | null = describedBy
    ? document.getElementById(describedBy)
    : null;
  const text: string = popup?.textContent || "";

  fireEvent.mouseLeave(button);
  await act(async () => {
    jest.advanceTimersByTime(250);
  });

  return text;
}

// The same, reached with the keyboard instead of the mouse.
export async function explanationOnFocus(button: HTMLElement): Promise<string> {
  act(() => {
    button.focus();
  });
  await act(async () => {
    jest.advanceTimersByTime(250);
  });

  const describedBy: string | null = button.getAttribute("aria-describedby");
  const popup: HTMLElement | null = describedBy
    ? document.getElementById(describedBy)
    : null;
  const text: string = popup?.textContent || "";

  act(() => {
    button.blur();
  });
  await act(async () => {
    jest.advanceTimersByTime(250);
  });

  return text;
}

/*
 * An (i) is itself a button: inside another button or a link it is
 * invalid HTML and its click would reach the outer control.
 */
export function expectNotNestedInControl(button: HTMLElement): void {
  const outer: Element | null =
    button.parentElement?.closest("button, a, [role='button']") || null;

  expect({
    label: button.getAttribute("aria-label"),
    nestedIn: outer ? outer.tagName : null,
  }).toEqual({ label: button.getAttribute("aria-label"), nestedIn: null });
}

// Let every pending promise (mocked fetches, state updates) settle.
export async function settle(): Promise<void> {
  for (let i: number = 0; i < 12; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// A promise that never settles: keeps a page in its loading state.
export function never<T>(): Promise<T> {
  return new Promise<T>(() => {
    // Intentionally never resolved.
  });
}
