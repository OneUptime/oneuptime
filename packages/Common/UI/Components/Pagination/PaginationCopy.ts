/*
 * The words the shared pagination control shows of its own: the region's
 * name, the rows-per-page label, the arrows and page numbers, the page
 * indicator, the summary and the jump-to-a-page dialog.
 *
 * Kept in one React-free module so the control renders these exact strings
 * and App/Tests/Dashboard/PaginationI18n can check that each has an entry in
 * all seventeen Dashboard locale files - a string is translated by looking up
 * its English text, so one with no entry silently stays English.
 *
 * Every {{placeholder}} is filled with a number, except {{items}} in the
 * region's name, which is the list's own plural label. A locale keeps each
 * placeholder and puts it where its grammar wants it.
 */

export const PaginationCopy: {
  regionLabel: string;
  rowsPerPage: string;
  previousPage: string;
  nextPage: string;
  page: string;
  goToPageNumber: string;
  pageOfPages: string;
  pagesInBetween: string;
  goToPage: string;
  pageNumber: string;
  goToPageDescription: string;
  loading: string;
  showingRangeOfTotal: string;
  showingRange: string;
  noItems: string;
} = {
  regionLabel: "Pagination for {{items}}",
  rowsPerPage: "Rows per page",
  previousPage: "Go to previous page",
  nextPage: "Go to next page",
  // The page the reader is on, named and shown on its own.
  page: "Page {{page}}",
  goToPageNumber: "Go to page {{page}}",
  pageOfPages: "Page {{page}} of {{total}}",
  // A collapsed gap in the page list, which opens the jump dialog.
  pagesInBetween: "Go to a page in between",
  // The jump dialog's title and its button, and the hint on what opens it.
  goToPage: "Go to page",
  pageNumber: "Page number",
  goToPageDescription:
    "This list has {{count}} pages. Enter the one you want to see.",
  loading: "Loading...",
  /*
   * The summary in a locale. English names the rows instead ("Showing 1-10
   * of 240 monitors"), but the noun is the caller's - not every caller
   * translates it, and no locale file can hold every noun in every case its
   * grammar needs - so a translated summary leaves it out ("1-10 von 240").
   * See getPaginationSummary in Pagination.tsx.
   */
  showingRangeOfTotal: "Showing {{range}} of {{total}}",
  // Has-more mode, where the total is unknown: "Showing 1-10+".
  showingRange: "Showing {{range}}",
  noItems: "No items",
};

/*
 * Every string above, in the order it is declared - what the locale files
 * have to carry.
 */
export const getPaginationUiStrings: () => Array<string> =
  (): Array<string> => {
    return Object.values(PaginationCopy);
  };

export default PaginationCopy;
