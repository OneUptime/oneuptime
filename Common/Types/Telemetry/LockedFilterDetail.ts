/*
 * What a LOCKED telemetry filter chip can explain about itself.
 *
 * A resource page (a Kubernetes cluster, a Docker host, a RUM application,
 * an incident's stored query, ...) pins the telemetry explorers it embeds to
 * its own scope. The viewer shows that scope as a grey chip with a lock icon
 * — "Cluster: production" — and nothing else, so a reader cannot tell whether
 * the match is by resource attribute, by entity membership, by service id,
 * or by something else, nor how to reproduce it on the main explorer page.
 *
 * The chip builders in the Dashboard fill one of these per locked chip; the
 * shared chip renderer turns it into a rich tooltip and into the
 * "Copy filter" affordance. Display-only: nothing here changes the query.
 */

/** One predicate the server evaluates for the locked filter. */
export interface LockedFilterPredicate {
  /** "Attribute", "Entity key", "Entity id", "Trace ID", ... */
  label: string;
  /** The predicate as text, e.g. `resource.k8s.cluster.name = "prod-eks-01"`. */
  expression: string;
  /** Optional plain-language note under the expression. */
  note?: string | undefined;
}

/** How several predicates of one locked filter combine. Defaults to "all". */
export type LockedFilterCombinator = "any" | "all";

export interface LockedFilterDetail {
  /** Why the chip is locked, e.g. "Pinned by this page". */
  source: string;
  /** Plain-language summary, e.g. "Only logs from this Kubernetes cluster are shown." */
  summary: string;
  /** How rows are matched, in display order. */
  predicates: Array<LockedFilterPredicate>;
  /** "any" when the predicates are OR-ed (entity scope), "all" otherwise. */
  combinator?: LockedFilterCombinator | undefined;
  /**
   * Search-bar text that reproduces this filter on the explorer for the same
   * signal, e.g. `@resource.k8s.cluster.name:prod-eks-01`. Absent when the
   * grammar cannot express the filter.
   */
  searchToken?: string | undefined;
  /** Why `searchToken` is absent, when it is — shown in place of the syntax. */
  searchTokenUnavailableReason?: string | undefined;
}
