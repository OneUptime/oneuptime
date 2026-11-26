import Search from "../../Types/BaseDatabase/Search";
import ObjectID from "../../Types/ObjectID";

/*
 * THE RUNBOOKS "RUN A RUNBOOK" OFFERS (#10580).
 *
 * An incident's, an alert's or a scheduled maintenance event's Run a
 * Runbook (and a runbook card's Run) offers the project's enabled runbooks,
 * the ones that can be started; a search narrows them by any part of their
 * name, in any case, as it always did.
 *
 * The dialog used to read the first 200 enabled runbooks by name when it
 * opened and search them in the browser, so in a project with more a
 * runbook whose name sorted late was never offered, and a search for it
 * said "No matches". Every search now goes to the server, a page at a time,
 * and the server filters, searches and sorts: a runbook is found by its
 * name however many the project has. The dialog shows the first page, by
 * name, and how many match, so typing more narrows the rest.
 *
 * React-free and server-safe, so the server's tests list runbooks with the
 * very query the dialog sends.
 */

// The runbooks one read lists: a search finds the rest.
export const RUNNABLE_RUNBOOKS_PAGE_SIZE: number = 50;

// A type rather than an interface: ModelAPI's query takes it as it is.
export type RunnableRunbooksQuery = {
  projectId: ObjectID;
  isEnabled: true;
  name?: Search<string>;
};

export const getRunnableRunbooksQuery: (data: {
  projectId: ObjectID;
  searchText: string;
}) => RunnableRunbooksQuery = (data: {
  projectId: ObjectID;
  searchText: string;
}): RunnableRunbooksQuery => {
  const searchText: string = data.searchText.trim();

  return {
    projectId: data.projectId,
    isEnabled: true,
    ...(searchText ? { name: new Search<string>(searchText) } : {}),
  };
};
