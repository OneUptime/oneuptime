import { useMemo } from "react";
import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { useProject } from "./useProject";
import { fetchCurrentOnDutyEscalationPolicies } from "../api/onCallPolicies";
import type {
  CurrentOnDutyEscalationPoliciesResponse,
  OnCallAssignmentItem,
  ProjectItem,
  ProjectOnCallAssignments,
} from "../api/types";

interface UseAllProjectOnCallPoliciesResult {
  projects: ProjectOnCallAssignments[];
  totalAssignments: number;
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<void>;
}

function getEntityId(entity?: { _id?: string; id?: string }): string | undefined {
  return entity?._id ?? entity?.id;
}

function toAssignments(
  project: ProjectItem,
  response: CurrentOnDutyEscalationPoliciesResponse,
): OnCallAssignmentItem[] {
  const assignments: OnCallAssignmentItem[] = [];

  response.escalationRulesByUser.forEach((rule) => {
    assignments.push({
      projectId: project._id,
      projectName: project.name,
      policyId: getEntityId(rule.onCallDutyPolicy),
      policyName: rule.onCallDutyPolicy?.name ?? "Unknown policy",
      escalationRuleName: rule.onCallDutyPolicyEscalationRule?.name ?? "Unknown rule",
      assignmentType: "user",
      assignmentDetail: "You are directly assigned",
    });
  });

  response.escalationRulesByTeam.forEach((rule) => {
    assignments.push({
      projectId: project._id,
      projectName: project.name,
      policyId: getEntityId(rule.onCallDutyPolicy),
      policyName: rule.onCallDutyPolicy?.name ?? "Unknown policy",
      escalationRuleName: rule.onCallDutyPolicyEscalationRule?.name ?? "Unknown rule",
      assignmentType: "team",
      assignmentDetail: `Via team: ${rule.team?.name ?? "Unknown"}`,
    });
  });

  response.escalationRulesBySchedule.forEach((rule) => {
    assignments.push({
      projectId: project._id,
      projectName: project.name,
      policyId: getEntityId(rule.onCallDutyPolicy),
      policyName: rule.onCallDutyPolicy?.name ?? "Unknown policy",
      escalationRuleName: rule.onCallDutyPolicyEscalationRule?.name ?? "Unknown rule",
      assignmentType: "schedule",
      assignmentDetail: `Via schedule: ${rule.onCallDutyPolicySchedule?.name ?? "Unknown"}`,
    });
  });

  return assignments;
}

export function useAllProjectOnCallPolicies(): UseAllProjectOnCallPoliciesResult {
  const { projectList } = useProject();

  const query: UseQueryResult<ProjectOnCallAssignments[], Error> = useQuery({
    queryKey: [
      "oncall",
      "current-duty",
      projectList
        .map((project: ProjectItem) => {
          return project._id;
        })
        .sort()
        .join(","),
    ],
    enabled: projectList.length > 0,
    queryFn: async () => {
      const results: PromiseSettledResult<ProjectOnCallAssignments | null>[] =
        await Promise.allSettled(
          projectList.map(async (project: ProjectItem) => {
            const response: CurrentOnDutyEscalationPoliciesResponse =
              await fetchCurrentOnDutyEscalationPolicies(project._id);

            const assignments: OnCallAssignmentItem[] = toAssignments(
              project,
              response,
            );

            if (assignments.length === 0) {
              return null;
            }

            return {
              projectId: project._id,
              projectName: project.name,
              assignments,
            };
          }),
        );

      const projects: ProjectOnCallAssignments[] = [];

      results.forEach((result: PromiseSettledResult<ProjectOnCallAssignments | null>) => {
        if (result.status === "fulfilled" && result.value) {
          projects.push(result.value);
        }
      });

      return projects.sort((a: ProjectOnCallAssignments, b: ProjectOnCallAssignments) => {
        return a.projectName.localeCompare(b.projectName);
      });
    },
  });

  const totalAssignments: number = useMemo(() => {
    return (query.data ?? []).reduce(
      (total: number, project: ProjectOnCallAssignments) => {
        return total + project.assignments.length;
      },
      0,
    );
  }, [query.data]);

  const refetch: () => Promise<void> = async (): Promise<void> => {
    await query.refetch();
  };

  return {
    projects: query.data ?? [],
    totalAssignments,
    isLoading: query.isPending,
    isError: query.isError,
    refetch,
  };
}
