/*
 * ------------------------------------------------------------------
 * Whether a pool's HA can still tolerate a host failure - pure
 * ------------------------------------------------------------------
 *
 * XCP-ng's HA restarts a pool's protected VMs on the other hosts when one
 * fails, up to the number of host failures it is set to tolerate
 * (pool.ha_host_failures_to_tolerate). XAPI keeps a plan for it: how many
 * failures the pool can still survive with every protected VM restarted
 * (pool.ha_plan_exists_for), and pool.ha_overcommitted once it cannot
 * survive as many as it is set to.
 *
 * Two ways to know, depending on how the pool is read:
 *
 *   - Straight from XAPI (#10999), the plan itself: the pool can no longer
 *     tolerate what it is set to while it is overcommitted or its plan
 *     covers fewer failures than it is set to tolerate.
 *   - Through Xen Orchestra, whose REST pool object says only whether HA
 *     is on: from the hosts. A pool needs a host up and enabled beyond the
 *     one that fails - one host left, or none, cannot take another's VMs.
 *     That is what disabling a host of an HA pool of two looks like; a
 *     plan that no longer fits in the hosts' memory is XAPI's own message
 *     (HA_POOL_OVERCOMMITTED), which alerts on its own.
 *
 * The pages say which of the two a verdict comes from.
 * ------------------------------------------------------------------
 */

export enum XcpNgHaVerdictSource {
  // XAPI's plan: exact.
  Plan = "plan",
  // The hosts up and enabled: what Xen Orchestra lets OneUptime see.
  Hosts = "hosts",
}

export interface XcpNgHaReading {
  // Null: not read yet (the XCP-ng Agent reads none of it).
  haEnabled: boolean | null;
  hostFailuresToTolerate?: number | null | undefined;
  planExistsFor?: number | null | undefined;
  overcommitted?: boolean | null | undefined;
  // Hosts up (Running) and enabled, from the pool's inventory.
  hostsUpAndEnabled: number;
}

export interface XcpNgHaVerdict {
  // Null while HA is off or not read: there is nothing to tolerate with.
  canTolerateHostFailure: boolean | null;
  source: XcpNgHaVerdictSource | null;
  // The plan's own numbers, when read from XAPI.
  hostFailuresToTolerate: number | null;
  planExistsFor: number | null;
}

function readCount(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.trunc(value));
}

export function getXcpNgHaVerdict(reading: XcpNgHaReading): XcpNgHaVerdict {
  const hostFailuresToTolerate: number | null = readCount(
    reading.hostFailuresToTolerate,
  );
  const planExistsFor: number | null = readCount(reading.planExistsFor);

  if (reading.haEnabled !== true) {
    return {
      canTolerateHostFailure: null,
      source: null,
      hostFailuresToTolerate: hostFailuresToTolerate,
      planExistsFor: planExistsFor,
    };
  }

  // XAPI's plan, when it was read.
  if (hostFailuresToTolerate !== null && planExistsFor !== null) {
    return {
      canTolerateHostFailure:
        reading.overcommitted !== true &&
        planExistsFor >= hostFailuresToTolerate,
      source: XcpNgHaVerdictSource.Plan,
      hostFailuresToTolerate: hostFailuresToTolerate,
      planExistsFor: planExistsFor,
    };
  }

  // Through Xen Orchestra: a host up and enabled beyond the one that fails.
  return {
    canTolerateHostFailure:
      reading.overcommitted !== true && reading.hostsUpAndEnabled >= 2,
    source: XcpNgHaVerdictSource.Hosts,
    hostFailuresToTolerate: hostFailuresToTolerate,
    planExistsFor: planExistsFor,
  };
}
