import { fireEvent, within } from "@testing-library/react";
import { settle } from "./HostTooltipHarness";

/*
 * Helpers for the render tests of lists that page client-side
 * (InfrastructureResourceTablePaging, KubernetesEventsAndCephClusterLogPaging,
 * KubernetesCostTablesPaging). Not a test file itself (no .test. in the
 * name), so jest does not run it.
 *
 * The footer is read and driven through the Pagination component's test ids.
 * Where a page holds several tables, `root` is the card around the one under
 * test; it defaults to the whole document.
 *
 * Every helper expects jest fake timers.
 */

// One column of every row on screen, top to bottom.
export function columnTexts(
  tableId: string,
  columnIndex: number = 0,
): Array<string> {
  const body: HTMLElement | null = document.getElementById(`${tableId}-body`);

  if (!body) {
    return [];
  }

  return Array.from(body.querySelectorAll("tr")).map(
    (row: HTMLTableRowElement): string => {
      return (
        row.querySelectorAll("td")[columnIndex]?.textContent || ""
      ).trim();
    },
  );
}

export function pageSizeSelect(
  root: HTMLElement = document.body,
): HTMLSelectElement {
  return within(root).getByTestId(
    "pagination-items-on-page-select",
  ) as HTMLSelectElement;
}

export function nextButton(root: HTMLElement = document.body): HTMLElement {
  return within(root).getByTestId("pagination-next-button");
}

// "Showing 26-30 of 30 pods".
export function pagingSummary(root: HTMLElement = document.body): string {
  return within(root).getByTestId("pagination-summary").textContent || "";
}

export async function choosePageSize(
  size: number,
  root: HTMLElement = document.body,
): Promise<void> {
  fireEvent.change(pageSizeSelect(root), { target: { value: String(size) } });
  await settle();
}

export async function nextPage(
  root: HTMLElement = document.body,
): Promise<void> {
  fireEvent.click(nextButton(root));
  await settle();
}

/*
 * The card's first header button. The lists under test put Refresh there,
 * as an icon with no name of its own (any Filter button comes after it).
 */
export async function clickCardRefresh(
  root: HTMLElement = document.body,
): Promise<void> {
  const actions: HTMLElement = within(root).getByTestId("card-header-actions");
  const refresh: HTMLElement | undefined =
    within(actions).getAllByRole("button")[0];

  if (!refresh) {
    throw new Error("The card has no header buttons");
  }

  fireEvent.click(refresh);
  await settle();
}

/*
 * `count` names that sort in the order they are listed: "pod-00",
 * "pod-01" and so on.
 */
export function numberedNames(prefix: string, count: number): Array<string> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return `${prefix}-${String(index).padStart(2, "0")}`;
  });
}
