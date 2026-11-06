import { useQuery, UseQueryResult } from "@tanstack/react-query";
import {
  fetchCoverPolicies,
  fetchOverrideAddAccess,
  type CoverPolicy,
  type OverrideAddAccess,
} from "../api/onCallOverrides";

/*
 * - not-asked: nothing to ask (the person may arrange cover for every
 *   policy, or may arrange none);
 * - checking: the server has not answered yet;
 * - offered: the policies they may cover, of the ones asked about - none
 *   at all, and the sheet stays locked;
 * - unavailable: the server is older than the question, or could not
 *   answer - the sheet stays locked, as before.
 */
export type CoverPoliciesState =
  | { status: "not-asked" }
  | { status: "checking" }
  | { status: "offered"; policies: CoverPolicy[] }
  | { status: "unavailable" };

const sameId: (a: string, b: string) => boolean = (
  a: string,
  b: string,
): boolean => {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
};

// The policies, each once, in the order first named.
function distinct(policies: CoverPolicy[]): CoverPolicy[] {
  const seen: CoverPolicy[] = [];

  policies.forEach((policy: CoverPolicy) => {
    if (
      policy.policyId &&
      !seen.some((kept: CoverPolicy): boolean => {
        return sameId(kept.policyId, policy.policyId);
      })
    ) {
      seen.push(policy);
    }
  });

  return seen;
}

/**
 * For someone whose permission to add user overrides covers only some
 * policies, the policies the cover sheet may arrange cover on: of
 * `shiftPolicies` - the policies that page through the shift "Get cover"
 * was tapped on - or, opened from "Cover for me" or "I'll take over", of
 * the project's policies they can see, the ones the server says they may
 * cover (api/onCallOverrides, fetchOverrideAddAccess). Asked only while
 * `enabled`.
 */
export function useCoverPolicies(data: {
  projectId: string | null;
  enabled: boolean;
  shiftPolicies?: CoverPolicy[] | undefined;
}): CoverPoliciesState {
  const shiftPolicyIds: string = (data.shiftPolicies ?? [])
    .map((policy: CoverPolicy): string => {
      return policy.policyId;
    })
    .join(",");

  const query: UseQueryResult<CoverPoliciesState, Error> = useQuery({
    queryKey: [
      "oncall",
      "cover-policies",
      data.projectId ?? "none",
      data.shiftPolicies ? `shift:${shiftPolicyIds}` : "project",
    ],
    enabled: data.enabled && Boolean(data.projectId),
    queryFn: async (): Promise<CoverPoliciesState> => {
      const projectId: string = data.projectId as string;
      const candidates: CoverPolicy[] = distinct(
        data.shiftPolicies ?? (await fetchCoverPolicies(projectId)),
      );

      if (candidates.length === 0) {
        return { status: "offered", policies: [] };
      }

      const access: OverrideAddAccess | null = await fetchOverrideAddAccess(
        projectId,
        candidates.map((policy: CoverPolicy): string => {
          return policy.policyId;
        }),
      );

      if (!access) {
        return { status: "unavailable" };
      }

      return {
        status: "offered",
        policies: candidates.filter((policy: CoverPolicy): boolean => {
          return access.onCallDutyPolicyIds.some((id: string): boolean => {
            return sameId(id, policy.policyId);
          });
        }),
      };
    },
  });

  if (!data.enabled || !data.projectId) {
    return { status: "not-asked" };
  }

  if (query.isError) {
    return { status: "unavailable" };
  }

  return query.data ?? { status: "checking" };
}
