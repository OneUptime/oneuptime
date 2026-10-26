/*
 * How many items a bulk action works on at once unless it says otherwise
 * (runBulkAction).
 *
 * Four: while one item's request waits on the database or on Slack, the
 * server works on the next. And four leave room for the page itself - a
 * browser keeps six connections to one server over HTTP/1.1, and the side
 * menu's counts and the page's other reads go on through the other two.
 *
 * An action passes 1 when its items' writes read shared state on the server
 * (a plan's monitor count, a network site's health rollup): each write must
 * see the one before it finished.
 *
 * In a module of its own, with no imports, so lists that only name a
 * concurrency (EventStateKinds) can be read where the runner cannot load -
 * the App's own tests run with no browser.
 */
export const BULK_ACTION_CONCURRENCY: number = 4;
