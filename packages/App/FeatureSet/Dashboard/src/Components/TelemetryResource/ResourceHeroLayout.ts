/*
 * HOW A RESOURCE HERO'S TOP ROW IS LAID OUT: the resource's icon, name,
 * badges and when it was last seen (the identity), and the page's controls
 * beside them - the refresh control, and on most pages the time range
 * picker (with Reset zoom beside it while a chart is zoomed).
 *
 * The name keeps its room; the controls give way. Every resource hero
 * (a host and its services, processes and systemd units, a Docker or
 * Podman host, a Docker Swarm, a Kubernetes cluster, a vCenter, a Proxmox
 * or Ceph cluster, a storage array, an IoT fleet) used to put its controls
 * beside the name from the md breakpoint and keep their whole width, which
 * squeezed the name: a hero sits beside the resource's side menu, so at a
 * 768px window a host's name vanished under its time range picker and its
 * Auto-refresh select ran 35px past the window, and at 1024 the name read
 * "a.." with "Last seen" one word a line (#5268's follow-up); a Docker
 * Swarm's name read "swa…" on a phone (#5076's). The Kubernetes cluster's
 * hero had been fixed for this already (#4105, where a zoom widens the
 * controls), and its layout is now every hero's:
 *
 * - On a phone, a column: the controls under the name.
 * - From md, one wrapping row. The identity never shrinks below its own
 *   content (a flex item's automatic minimum - a min-w-0 on it is what let
 *   the name go), capped at the row by w-full, so a name longer than the
 *   whole row still truncates inside the hero.
 * - The controls take the rest of the row up to their full width (basis 0,
 *   max-w-max, and a grow that outweighs the identity's), and wrap onto a
 *   line of their own when squeezed, kept on the right.
 * - When that rest is narrower than 24rem - about a custom range and Reset
 *   zoom side by side, so the picker's label never has to wrap - they move
 *   under the name as one block, still on the right.
 *
 * Intrinsic, with no width to tune per page: it holds for a hero with the
 * refresh control alone and for one with a time range picker too, for any
 * name, in any language. The browser measures it in packages/E2E
 * (ChartTimeZoom's KubernetesOverviewHeader and HostOverviewHeader specs,
 * DockerSwarmPages); App/Tests/Dashboard/ResourceHeroLayoutGuard holds
 * every hero to these three class names.
 *
 * The services, RUM applications, databases, queues, serverless functions
 * and cloud resources draw their hero through ResourceOverview, which lays
 * out its own row the same way (a title basis, the controls wrapping under).
 *
 * Plain strings, free of React, so App/Tests can read them.
 */

// The row: a column on a phone, one wrapping row from md.
export const RESOURCE_HERO_TOP_ROW_CLASS_NAME: string =
  "flex flex-col gap-4 md:flex-row md:flex-wrap md:items-start md:justify-between";

// The icon, the name and its badges, the identifier and "Last seen".
export const RESOURCE_HERO_IDENTITY_CLASS_NAME: string =
  "flex items-start gap-4 md:w-full md:flex-1";

/*
 * The controls: the rest of the row, under the name when that rest is under
 * 24rem; their own row (AutoRefreshControl's) kept on the right - at the
 * row's end, so on a right-to-left page on the left, its mirror: the margin
 * that pushes them there is the inline start's (ms-auto), not the left's,
 * which put them beside the name's side of a Persian hero.
 */
export const RESOURCE_HERO_CONTROLS_CLASS_NAME: string =
  "md:ms-auto md:min-w-[min(100%,24rem)] md:max-w-max md:flex-[1000_1_0%] md:self-start md:[&>div]:justify-end";

// Test ids of the three, for the browser suites that measure them.
export const RESOURCE_HERO_TOP_ROW_TEST_ID: string = "resource-hero-top-row";
export const RESOURCE_HERO_IDENTITY_TEST_ID: string = "resource-hero-identity";
export const RESOURCE_HERO_CONTROLS_TEST_ID: string = "resource-hero-controls";

/*
 * WHAT THE RESOURCE IS, in its owner's words (its Settings), under its name
 * in every hero that shows it (ResourceHeroDescription): two lines at most,
 * wrapping between its words.
 *
 * It used to be one line cut short ("truncate") on a Docker Swarm, a vCenter,
 * a Proxmox cluster and an IoT fleet: on a phone that was half a sentence,
 * and from md up the line refused to wrap, so the identity - which never
 * shrinks below its own content (above) - claimed the description's whole
 * width and pushed the refresh control under the name even at 1280px. A
 * description that wraps asks for 20rem from md up, not its whole length:
 * the name keeps its room and, from about 1200px beside the side menu, the
 * controls keep their place beside it - with the icon, the 24rem a
 * ResourceOverview's title asks for. Narrower, they move under it, rather
 * than squeezing the description to a word a line. (A min(100%, 20rem)
 * would count for nothing: a percentage is 0 while the row measures its
 * items. On a phone the hero is a column, so it needs no floor.) On a service's,
 * database's, queue's, RUM application's, serverless function's and cloud
 * resource's Overview (ResourceOverview) it used to be the Details card's
 * line instead, at the foot of the page, which a card hides on a phone.
 *
 * Its words are laid out by their own script (dir="auto") and aligned as
 * the page is (left, or right on a right-to-left page): an English
 * description on a Persian page reads left to right, its full stop at its
 * end, at the right edge under the name - not ".and charges the card".
 * (text-align: match-parent says the same in one word, but Chromium
 * ignores it.)
 */
export const RESOURCE_HERO_DESCRIPTION_CLASS_NAME: string =
  "mt-1 line-clamp-2 text-left text-sm text-gray-500 [overflow-wrap:anywhere] md:min-w-[20rem] rtl:text-right";

export const RESOURCE_HERO_DESCRIPTION_TEST_ID: string =
  "resource-hero-description";
