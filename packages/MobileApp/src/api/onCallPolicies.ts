import type { AxiosResponse } from "axios";
import apiClient from "./client";
import type { CurrentOnDutyEscalationPoliciesResponse } from "./types";

export async function fetchCurrentOnDutyEscalationPolicies(
  projectId: string,
): Promise<CurrentOnDutyEscalationPoliciesResponse> {
  const response: AxiosResponse = await apiClient.get(
    "/api/on-call-duty-policy/current-on-duty-escalation-policies",
    {
      headers: {
        tenantid: projectId,
      },
    },
  );

  return {
    escalationRulesByUser: response.data?.escalationRulesByUser ?? [],
    escalationRulesByTeam: response.data?.escalationRulesByTeam ?? [],
    escalationRulesBySchedule: response.data?.escalationRulesBySchedule ?? [],
  };
}
