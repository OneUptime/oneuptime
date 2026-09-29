import { expect, jest } from "@jest/globals";
import { act, fireEvent } from "@testing-library/react";
import VMwareResourceModel from "../../../Models/DatabaseModels/VMwareResource";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";

/*
 * Helpers for the VMware page render tests (VMwareOverviewTooltips,
 * VMwareResourcePagesTooltips). Not a test file itself (no .test. in the
 * name), so jest does not run it.
 *
 * An (i) is an InfoTooltip: a <button aria-label="About <title>"> whose
 * Tippy popup is created lazily on first hover and portalled to <body>.
 * Under jsdom a hidden popup never finishes animating out, so a page that
 * hovers several (i)s holds several popups at once; the text is therefore
 * read through the aria-describedby link Tippy puts on the trigger while it
 * is shown, never through "the" tooltip on the page.
 *
 * Every helper that waits expects jest fake timers.
 */

const ABOUT: string = "About ";

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

export function infoButtonsFor(
  label: string,
  root: ParentNode = document.body,
): Array<HTMLElement> {
  return infoButtons(root).filter((button: HTMLElement): boolean => {
    return button.getAttribute("aria-label") === `${ABOUT}${label}`;
  });
}

// Hover an (i), read what its tooltip says, and move the pointer away.
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

// The same, reached with the keyboard.
export async function explanationOnFocus(button: HTMLElement): Promise<string> {
  act(() => {
    button.focus();
  });
  await act(async () => {
    jest.advanceTimersByTime(250);
  });

  const describedBy: string | null = button.getAttribute("aria-describedby");
  const text: string = describedBy
    ? document.getElementById(describedBy)?.textContent || ""
    : "";

  act(() => {
    button.blur();
  });
  await act(async () => {
    jest.advanceTimersByTime(250);
  });

  return text;
}

/*
 * Hover every (i) in turn and pair each label with what it says, in
 * document order.
 */
export async function explainedLabels(
  root: ParentNode = document.body,
): Promise<Array<[string, string]>> {
  const result: Array<[string, string]> = [];

  for (const button of infoButtons(root)) {
    result.push([
      (button.getAttribute("aria-label") || "").slice(ABOUT.length),
      await explanationOnHover(button),
    ]);
  }

  return result;
}

/*
 * An (i) is a button of its own: never inside another button or a link,
 * where a click on it would also press or follow its container.
 */
export function expectNotNested(button: HTMLElement): void {
  expect(button.tagName).toBe("BUTTON");
  expect(button.getAttribute("type")).toBe("button");
  expect(button.parentElement?.closest("button, a")).toBeNull();
}

export function inventoryRow(
  fields: Partial<Record<keyof VMwareResourceModel, unknown>>,
): VMwareResourceModel {
  const row: VMwareResourceModel = new VMwareResourceModel();

  Object.assign(row, fields);

  return row;
}

export function vcenterModel(
  fields: Partial<Record<keyof VMwareVCenter, unknown>> = {},
): VMwareVCenter {
  const vcenter: VMwareVCenter = new VMwareVCenter();

  Object.assign(vcenter, {
    name: "prod-vcenter",
    otelCollectorStatus: "connected",
    ...fields,
  });

  return vcenter;
}

export const GIB: number = 1024 * 1024 * 1024;
