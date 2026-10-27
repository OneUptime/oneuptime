/*
 * WHICH ROWS A RESOURCE OVERVIEW'S DETAILS CARD DRAWS.
 *
 * Every resource Overview (a service, a RUM application, a database, a
 * queue, a serverless function, a cloud environment or resource) ends with
 * a Details card built from the page's rows (ResourceOverview). A page lists
 * every fact it knows how to show, but most resources report only some of
 * them: a service without a cloud detector has no cloud provider, platform,
 * region or account, a database found from traces has no agent version.
 * Each of those rows used to read "—", so a new service's card was ten rows
 * of which two said something (follow-up of #4980).
 *
 * A row is drawn only when it has a value, so the card says what is known
 * and nothing else. The facts that are always known - the resource's ID,
 * its identifier - keep the card from ever being empty; when a page has
 * nothing at all, the card says so in one line (ResourceOverview).
 *
 * Plain logic, free of React, so App/Tests can read it.
 */

// A row's text, empty or blank when nothing reported it.
export interface ResourceOverviewDetailValue {
  value?: string | null | undefined;
}

// Whether a row has something to say.
export function hasResourceOverviewDetailValue(
  value: string | null | undefined,
): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

// The rows the Details card draws, in the page's order.
export function getReportedResourceOverviewDetailRows<
  T extends ResourceOverviewDetailValue,
>(rows: ReadonlyArray<T>): Array<T> {
  return rows.filter((row: T): boolean => {
    return hasResourceOverviewDetailValue(row.value);
  });
}
