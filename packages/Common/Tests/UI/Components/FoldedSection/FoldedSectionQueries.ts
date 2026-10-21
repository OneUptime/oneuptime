import { within } from "@testing-library/react";

/*
 * Reading a folded section's header the way a reader does (FoldedSection):
 * the names it lists while folded, and the chips it draws for the ones that
 * are set - "Labels: 2", "Private Incident: On". Shared by the tests of the
 * forms and pages that fold rarely needed things under More fields or More
 * settings.
 */

/*
 * A header a query did not find (null) is an error, not the whole page: read
 * as the page, a missing header would pass for one that shows nothing.
 */
function itemsIn(container?: HTMLElement | null): Array<HTMLElement> {
  if (container === null) {
    throw new Error("The folded section header to read was not found.");
  }

  const scope: HTMLElement = container || document.body;

  return within(scope).queryAllByTestId("folded-section-item");
}

// Every name a folded header lists, set or not, as read on screen.
export function listedNames(container?: HTMLElement | null): Array<string> {
  return itemsIn(container).map((item: HTMLElement): string => {
    return (item.textContent || "").trim();
  });
}

// The chips of the set ones: "Name: value", or the name alone.
export function setChips(container?: HTMLElement | null): Array<string> {
  return itemsIn(container)
    .filter((item: HTMLElement): boolean => {
      return item.getAttribute("data-item-set") === "true";
    })
    .map((item: HTMLElement): string => {
      return (item.textContent || "").trim();
    });
}

// Whether a folded header shows anything as set.
export function hasSetChip(container?: HTMLElement | null): boolean {
  return setChips(container).length > 0;
}

/*
 * The elements with this text that are not a name a folded header lists - a
 * field's own label, say, which the header names as well while it is folded.
 */
export function queryAllByTextOutsideFoldedHeaders(
  container: HTMLElement,
  text: string,
): Array<HTMLElement> {
  return within(container)
    .queryAllByText(text)
    .filter((element: HTMLElement): boolean => {
      return !element.closest("[data-testid='folded-section-header']");
    });
}

export function getByTextOutsideFoldedHeaders(
  container: HTMLElement,
  text: string,
): HTMLElement {
  const matches: Array<HTMLElement> = queryAllByTextOutsideFoldedHeaders(
    container,
    text,
  );

  if (matches.length !== 1) {
    throw new Error(
      `Expected one element with the text "${text}" outside folded headers, found ${matches.length}.`,
    );
  }

  return matches[0]!;
}

export function queryByTextOutsideFoldedHeaders(
  container: HTMLElement,
  text: string,
): HTMLElement | null {
  return queryAllByTextOutsideFoldedHeaders(container, text)[0] || null;
}
