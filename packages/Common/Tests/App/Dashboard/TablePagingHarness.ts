import { fireEvent, screen, within } from "@testing-library/react";
import { settle } from "./HostTooltipHarness";

/*
 * Helpers for the render tests of lists that page client-side
 * (InfrastructureResourceTablePaging, KubernetesEventsAndCephClusterLogPaging,
 * KubernetesCostTablesPaging, ContainersAndCephDaemonsPaging). Not a test
 * file itself (no .test. in the name), so jest does not run it.
 *
 * The footer is read and driven through the Pagination component's test ids.
 * Where a page holds several tables, `root` is the card around the one under
 * test; it defaults to the whole document.
 *
 * Every helper expects jest fake timers.
 */

/*
 * One column of every row on screen, top to bottom, as a sighted reader
 * sees it: a screen reader's words (sr-only) are left out, so an empty
 * value reads as its dash, not "—Not set".
 */
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
      const cell: Element | undefined = row.querySelectorAll("td")[columnIndex];

      if (!cell) {
        return "";
      }

      const copy: Element = cell.cloneNode(true) as Element;

      for (const hidden of Array.from(copy.querySelectorAll(".sr-only"))) {
        hidden.remove();
      }

      return (copy.textContent || "").trim();
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
 * Refresh, from the ⋯ at the end of the card's header - where every table
 * keeps it (Table/TableHeaderControls' getTableHeaderButtons), as these
 * lists do since their loose refresh icons went.
 */
export async function clickCardRefresh(
  root: HTMLElement = document.body,
): Promise<void> {
  const actions: HTMLElement = within(root).getByTestId("card-header-actions");

  fireEvent.click(
    within(actions).getByRole("button", { name: "More options" }),
  );
  fireEvent.click(
    within(screen.getByRole("menu")).getByRole("menuitem", {
      name: "Refresh",
    }),
  );
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
