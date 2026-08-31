import { useMemo } from "react";
import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { useProject } from "./useProject";
import { fetchCurrentOnDutyEscalationPolicies } from "../api/onCallPolicies";
import { getGlobalSsoToken, getSsoTokens } from "../storage/ssoTokens";
import type {
  CurrentOnDutyEscalationPoliciesResponse,
  OnCallAssignmentItem,
  OnCallDutyEscalationRuleUserItem,
  OnCallDutyEscalationRuleTeamItem,
  OnCallDutyEscalationRuleScheduleItem,
  ProjectItem,
  ProjectOnCallAssignments,
} from "../api/types";

interface UseAllProjectOnCallPoliciesResult {
  projects: ProjectOnCallAssignments[];
  totalAssignments: number;
  isLoading: boolean;
  isError: boolean;

  /*
   * How many of the projects we actually asked did not answer.
   *
   * Zero and a non-empty `projects` means "on call, and that is the whole
   * picture". Zero and an empty `projects` means "genuinely not on call".
   * Anything above zero means the list on screen is INCOMPLETE - the
   * responder may hold duty in a project that is missing from it - and the
   * screen owes them that sentence rather than a confident count.
   */
  failedProjectCount: number;

  /* Some projects answered and some did not: `projects` is a partial answer. */
  isPartialFailure: boolean;

  refetch: () => Promise<void>;
}

/*
 * What the query resolves to. The failure count has to travel WITH the data
 * rather than be recomputed by the caller, because by the time the caller sees
 * it the individual per-project promises are long gone.
 */
interface OnCallDutyAcrossProjects {
  projects: ProjectOnCallAssignments[];
  failedProjectCount: number;
}

function getEntityId(entity?: {
  _id?: string;
  id?: string;
}): string | undefined {
  return entity?._id ?? entity?.id;
}

function toAssignments(
  project: ProjectItem,
  response: CurrentOnDutyEscalationPoliciesResponse,
): OnCallAssignmentItem[] {
  const assignments: OnCallAssignmentItem[] = [];

  response.escalationRulesByUser.forEach(
    (rule: OnCallDutyEscalationRuleUserItem) => {
      assignments.push({
        projectId: project._id,
        projectName: project.name,
        policyId: getEntityId(rule.onCallDutyPolicy),
        policyName: rule.onCallDutyPolicy?.name ?? "Unknown policy",
        escalationRuleName:
          rule.onCallDutyPolicyEscalationRule?.name ?? "Unknown rule",
        assignmentType: "user",
        assignmentDetail: "You are directly assigned",
      });
    },
  );

  response.escalationRulesByTeam.forEach(
    (rule: OnCallDutyEscalationRuleTeamItem) => {
      assignments.push({
        projectId: project._id,
        projectName: project.name,
        policyId: getEntityId(rule.onCallDutyPolicy),
        policyName: rule.onCallDutyPolicy?.name ?? "Unknown policy",
        escalationRuleName:
          rule.onCallDutyPolicyEscalationRule?.name ?? "Unknown rule",
        assignmentType: "team",
        assignmentDetail: `Via team: ${rule.team?.name ?? "Unknown"}`,
      });
    },
  );

  response.escalationRulesBySchedule.forEach(
    (rule: OnCallDutyEscalationRuleScheduleItem) => {
      assignments.push({
        projectId: project._id,
        projectName: project.name,
        policyId: getEntityId(rule.onCallDutyPolicy),
        policyName: rule.onCallDutyPolicy?.name ?? "Unknown policy",
        escalationRuleName:
          rule.onCallDutyPolicyEscalationRule?.name ?? "Unknown rule",
        assignmentType: "schedule",
        assignmentDetail: `Via schedule: ${rule.onCallDutyPolicySchedule?.name ?? "Unknown"}`,
      });
    },
  );

  return assignments;
}

export function useAllProjectOnCallPolicies(): UseAllProjectOnCallPoliciesResult {
  const { projectList, isLoadingProjects } = useProject();

  const query: UseQueryResult<OnCallDutyAcrossProjects, Error> = useQuery({
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
    queryFn: async (): Promise<OnCallDutyAcrossProjects> => {
      // Filter out projects that require SSO but haven't been authenticated yet
      const ssoTokens: Record<string, string> = await getSsoTokens();
      // A global SSO token satisfies enforcement for every project.
      const globalSsoToken: string | null = await getGlobalSsoToken();
      const authenticatedProjects: ProjectItem[] = projectList.filter(
        (project: ProjectItem) => {
          return (
            !project.requireSsoForLogin ||
            Boolean(ssoTokens[project._id]) ||
            Boolean(globalSsoToken)
          );
        },
      );

      const results: PromiseSettledResult<ProjectOnCallAssignments | null>[] =
        await Promise.allSettled(
          authenticatedProjects.map(async (project: ProjectItem) => {
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
      let failedProjectCount: number = 0;

      results.forEach(
        (result: PromiseSettledResult<ProjectOnCallAssignments | null>) => {
          if (result.status === "rejected") {
            failedProjectCount += 1;
            return;
          }

          if (result.value) {
            projects.push(result.value);
          }
        },
      );

      /*
       * Nothing answered, so we know NOTHING - and the difference between
       * that and "you hold no duty anywhere" is the difference between a
       * responder who checks again and one who puts the phone down. Throwing
       * is what makes react-query report isError, which is the only state the
       * screen can honestly render as "could not establish". Returning an
       * empty list here - which is what allSettled + drop-the-rejections used
       * to do - made a lapsed token or a dead network read as "Not currently
       * on-call".
       *
       * Only when EVERY project failed. One project answering is still a real
       * answer for that project; that case comes back as data with a non-zero
       * failedProjectCount so the screen can show what it has and say what it
       * could not reach.
       *
       * Projects filtered out above for pending SSO are deliberately NOT part
       * of this. Not having completed SSO is a state the app already knows
       * about and already offers a fix for (the sign-in affordance on Home) -
       * counting it as a failure would replace an actionable prompt with a
       * dead end, and would put the whole screen into an error state that
       * refetching cannot clear. Only projects we actually asked, and that
       * actually did not answer, count as "could not establish".
       */
      if (results.length > 0 && failedProjectCount === results.length) {
        throw new Error(
          "Could not read on-call duty from any project. The list is unknown, not empty.",
        );
      }

      return {
        projects: projects.sort(
          (a: ProjectOnCallAssignments, b: ProjectOnCallAssignments) => {
            return a.projectName.localeCompare(b.projectName);
          },
        ),
        failedProjectCount,
      };
    },
  });

  const totalAssignments: number = useMemo(() => {
    return (query.data?.projects ?? []).reduce(
      (total: number, project: ProjectOnCallAssignments) => {
        return total + project.assignments.length;
      },
      0,
    );
  }, [query.data]);

  const failedProjectCount: number = query.data?.failedProjectCount ?? 0;

  const refetch: () => Promise<void> = async (): Promise<void> => {
    await query.refetch();
  };

  return {
    projects: query.data?.projects ?? [],
    totalAssignments,
    /*
     * isPending is NOT "a request is in flight" in react-query v5 - it is
     * "there is no data yet", and a query with enabled:false satisfies that
     * forever. A responder with no projects (a brand new account, or one whose
     * project fetch just failed) would sit on a skeleton that never resolves,
     * with nothing to pull to refresh. isLoading is isPending && isFetching,
     * which is the real "asking right now".
     *
     * The project list is the other half: while it is still being fetched this
     * hook is disabled and reports nothing in flight, which would render the
     * on-call screen's empty state over a question we have not asked yet.
     */
    isLoading: isLoadingProjects || query.isLoading,
    isError: query.isError,
    failedProjectCount,
    isPartialFailure: failedProjectCount > 0,
    refetch,
  };
}
