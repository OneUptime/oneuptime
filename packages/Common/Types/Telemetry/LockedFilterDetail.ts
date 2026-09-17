/*
 * The search syntax a LOCKED telemetry filter chip shows in its tooltip, or
 * why it has none.
 *
 * A resource page (a Kubernetes cluster, a Docker host, a RUM application,
 * an incident's stored query, ...) pins the telemetry explorers it embeds to
 * its own scope. The viewer shows that scope as a grey chip with a lock icon
 * — "Cluster: production" — and a reader who wants the same slice on the
 * main explorer page needs the search-bar text that reproduces it.
 *
 * The chip builders in the Dashboard fill one of these per locked chip: the
 * search token when the explorer's grammar can spell the filter, otherwise
 * the reason it cannot. Display-only: nothing here changes the query.
 */

export interface LockedFilterDetail {
  /**
   * Search-bar text that reproduces this filter on the explorer for the same
   * signal, e.g. `@resource.k8s.cluster.name:prod-eks-01`. Absent when the
   * grammar cannot express the filter.
   */
  searchToken?: string | undefined;
  /** Why `searchToken` is absent, when it is — shown in place of the syntax. */
  searchTokenUnavailableReason?: string | undefined;
}
