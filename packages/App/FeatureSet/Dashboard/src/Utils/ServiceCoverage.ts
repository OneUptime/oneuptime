/*
 * "How many of my services are quiet?" — and when that is not a question the
 * current slice can answer.
 *
 * The rule this enforces is that the numerator and the denominator must be
 * drawn from the same population. Both Insights pages got that wrong in
 * different ways:
 *
 *   - Logs counted reporting services against the whole PROJECT's service
 *     list even when the scope was a host or a Kubernetes cluster. A
 *     30-service project scoped to one host that three services log from
 *     rendered "Quiet services / 27 / no logs in range" — twenty-seven
 *     services reported as silent when the user had simply filtered them
 *     out. That is precisely the false alarm the scoped denominator was
 *     added to prevent.
 *   - Metrics counted a synthetic "Unknown Service" (telemetry with no
 *     service.name) in the numerator while the denominator held Postgres
 *     rows only, so three services plus one unattributed collector rendered
 *     the impossible "4 of 3 services".
 *
 * A host-scoped slice genuinely cannot answer the question: the services
 * that log from a host are not a subset anyone has counted. Saying so is the
 * honest output, and it is why this returns a flag rather than a number the
 * caller would have to guess about.
 *
 * Pure, so App/Tests can pin the invariant across the whole scope matrix.
 */

export interface ScopedServiceCoverageInput {
  /** Service ids the slice is narrowed to. Empty means "not narrowed by service". */
  scopedServiceIds: Array<string>;
  /**
   * Whether the slice is narrowed by something that is not a service — a
   * host, docker host, podman host or Kubernetes cluster.
   */
  hasNonServiceResourceScope: boolean;
  /**
   * Every service the denominator could draw on. MUST come from the same
   * population as `reportingServices` — if the caller counts a synthetic
   * "Unknown Service" in the numerator, it has to be in this count too.
   */
  projectServiceCount: number;
  /** Services actually reporting telemetry in the window. */
  reportingServices: number;
}

export interface ScopedServiceCoverage {
  /** The denominator. Zero when coverage is not meaningful. */
  scopedServiceCount: number;
  /** The headline number. Zero when coverage is not meaningful. */
  quietServices: number;
  /**
   * False when the slice has no service dimension to count against. The
   * caller must show something else rather than print a number computed
   * from two different populations.
   */
  isCoverageMeaningful: boolean;
}

export function computeScopedServiceCoverage(
  input: ScopedServiceCoverageInput,
): ScopedServiceCoverage {
  const scopedServiceIds: Array<string> = Array.isArray(input.scopedServiceIds)
    ? input.scopedServiceIds
    : [];

  const reportingServices: number = Math.max(
    0,
    Number.isFinite(input.reportingServices) ? input.reportingServices : 0,
  );

  /*
   * Scoped to specific services: they are the population, and the answer is
   * exact regardless of how large the project is.
   */
  if (scopedServiceIds.length > 0) {
    const scopedServiceCount: number = scopedServiceIds.length;

    return {
      scopedServiceCount,
      quietServices: Math.max(0, scopedServiceCount - reportingServices),
      isCoverageMeaningful: true,
    };
  }

  /*
   * Scoped to a host or a cluster and nothing else. The services that log
   * from it are whatever they are — there is no denominator, and inventing
   * one out of the project's total manufactures silent services.
   */
  if (input.hasNonServiceResourceScope) {
    return {
      scopedServiceCount: 0,
      quietServices: 0,
      isCoverageMeaningful: false,
    };
  }

  const projectServiceCount: number = Math.max(
    0,
    Number.isFinite(input.projectServiceCount) ? input.projectServiceCount : 0,
  );

  return {
    scopedServiceCount: projectServiceCount,
    quietServices: Math.max(0, projectServiceCount - reportingServices),
    isCoverageMeaningful: true,
  };
}
