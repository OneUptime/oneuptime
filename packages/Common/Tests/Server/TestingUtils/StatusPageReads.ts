import { jest } from "@jest/globals";

/*
 * The read of a status page's own row among the calls a spy on
 * StatusPageService.findOneById or findOneBy saw: not the lookup of the
 * page's project (a select of projectId alone) that every read a page keeps
 * for its visitors starts with (StatusPageOverviewCache.getPageKey,
 * StatusPageService.getProjectIdOfStatusPage). Undefined when there was none.
 */
export function statusPageReadOf(spy: unknown): Array<unknown> | undefined {
  const calls: Array<Array<unknown>> = (spy as jest.Mock).mock.calls as Array<
    Array<unknown>
  >;

  return calls.find((call: Array<unknown>): boolean => {
    return !isProjectLookup(call);
  });
}

// The select of statusPageReadOf's call.
export function statusPageSelectOf(spy: unknown): Record<string, unknown> {
  const call: Array<unknown> | undefined = statusPageReadOf(spy);

  return ((call?.[0] as { select?: Record<string, unknown> } | undefined)
    ?.select || {}) as Record<string, unknown>;
}

// Whether a call is the lookup of a page's project: a select of projectId alone.
export function isProjectLookup(call: Array<unknown>): boolean {
  const select: Record<string, unknown> = ((
    call[0] as { select?: Record<string, unknown> } | undefined
  )?.select || {}) as Record<string, unknown>;

  return Object.keys(select).join(",") === "projectId";
}
