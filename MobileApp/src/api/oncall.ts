import { appClient } from "@/api/client";
import {
  OnCallDutyPolicy,
  OnCallEscalationRuleSchedule,
  OnCallEscalationRuleTeam,
  OnCallEscalationRuleUser,
} from "@/types/models";
import { ensureListIds } from "@/utils/normalizers";

export interface CurrentOnCallResponse {
  policies: OnCallDutyPolicy[];
  escalationRulesByUser: OnCallEscalationRuleUser[];
  escalationRulesByTeam: OnCallEscalationRuleTeam[];
  escalationRulesBySchedule: OnCallEscalationRuleSchedule[];
}

export const fetchCurrentOnCall = async (): Promise<CurrentOnCallResponse> => {
  const response = await appClient.get("/on-call-duty-policy/current-on-duty-escalation-policies");
  const data = response.data as Record<string, unknown>;

  const escalationRulesByUser = ensureListIds(
    (data["escalationRulesByUser"] as Array<Record<string, unknown>>) || [],
  ) as OnCallEscalationRuleUser[];
  const escalationRulesByTeam = ensureListIds(
    (data["escalationRulesByTeam"] as Array<Record<string, unknown>>) || [],
  ) as OnCallEscalationRuleTeam[];
  const escalationRulesBySchedule = ensureListIds(
    (data["escalationRulesBySchedule"] as Array<Record<string, unknown>>) || [],
  ) as OnCallEscalationRuleSchedule[];

  const policyMap = new Map<string, OnCallDutyPolicy>();

  const collectPolicy = (rule: OnCallEscalationRuleSchedule | OnCallEscalationRuleUser | OnCallEscalationRuleTeam) => {
    const policy = (rule as any).onCallDutyPolicy as OnCallDutyPolicy | undefined;
    if (policy && (policy.id || policy._id)) {
      const normalizedPolicy = ensureListIds([policy])[0];
      policyMap.set(normalizedPolicy.id, normalizedPolicy as unknown as OnCallDutyPolicy);
    }
  };

  escalationRulesBySchedule.forEach(collectPolicy);
  escalationRulesByUser.forEach(collectPolicy);
  escalationRulesByTeam.forEach(collectPolicy);

  return {
    policies: Array.from(policyMap.values()),
    escalationRulesByUser,
    escalationRulesByTeam,
    escalationRulesBySchedule,
  };
};
