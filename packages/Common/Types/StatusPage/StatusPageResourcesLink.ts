import ObjectID from "../ObjectID";

/*
 * A STATUS PAGE'S RESOURCES IN THE DASHBOARD, BY THE PAGE'S ID ALONE (#9180).
 *
 * A page's Resources tab lives under its project:
 * /dashboard/<project id>/status-pages/<id>/resources. The status page's
 * preview knows the page's id and nothing else: the public overview hands
 * out no project id, on purpose (StatusPageAPI). So the preview links its
 * note for a page with no resources to this address, under the Dashboard's
 * root, and the Dashboard - where the owner is signed in - finds which of
 * their projects the page is in and opens its Resources there
 * (Dashboard/src/Pages/StatusPages/OpenStatusPageResources). Someone the
 * page is not theirs to see is told so, and learns nothing the link did not
 * say already.
 */

// The Dashboard's route, under its root (/dashboard), with the page's id as :id.
export const STATUS_PAGE_RESOURCES_BY_ID_PATH: string =
  "/status-pages/:id/resources";

// The address of a status page's Resources, under the Dashboard's root.
export const getStatusPageResourcesByIdPath: (
  statusPageId: ObjectID | string,
) => string = (statusPageId: ObjectID | string): string => {
  return STATUS_PAGE_RESOURCES_BY_ID_PATH.replace(
    ":id",
    encodeURIComponent(statusPageId.toString().trim()),
  );
};
