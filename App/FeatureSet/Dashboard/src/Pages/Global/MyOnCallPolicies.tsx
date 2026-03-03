import ProjectElement from "../../Components/Project/Project";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Page from "Common/UI/Components/Page/Page";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/Utils/API";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRuleUser from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import OnCallDutyPolicyEscalationRuleTeam from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleSchedule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "Common/Models/DatabaseModels/Project";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Card from "Common/UI/Components/Card/Card";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import Pill from "Common/UI/Components/Pill/Pill";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import { Green, Blue, Purple } from "Common/Types/BrandColors";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Link from "Common/UI/Components/Link/Link";

interface OnCallPolicyWithProject {
  project: Project;
  escalationRulesByUser: Array<OnCallDutyPolicyEscalationRuleUser>;
  escalationRulesByTeam: Array<OnCallDutyPolicyEscalationRuleTeam>;
  escalationRulesBySchedule: Array<OnCallDutyPolicyEscalationRuleSchedule>;
}

type AssignmentType = "user" | "team" | "schedule";

interface PolicyItem {
  policyId: string | undefined;
  policyName: string | undefined;
  escalationRuleName: string | undefined;
  assignmentType: AssignmentType;
  assignmentDetail: string;
  projectId: string;
}

const MyOnCallPolicies: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [onCallPoliciesByProject, setOnCallPoliciesByProject] = useState<
    Array<OnCallPolicyWithProject>
  >([]);

  const fetchOnCallPolicies: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError("");

      const projectsResult: ListResult<Project> =
        await ModelAPI.getList<Project>({
          modelType: Project,
          query: {},
          limit: 100,
          skip: 0,
          select: {
            name: true,
            _id: true,
          },
          sort: {
            name: SortOrder.Ascending,
          },
          requestOptions: {
            isMultiTenantRequest: true,
            overrideRequestUrl: URL.fromString(APP_API_URL.toString()).addRoute(
              "/project/list-user-projects",
            ),
          },
        });

      const projects: Array<Project> = projectsResult.data;
      const onCallData: Array<OnCallPolicyWithProject> = [];

      for (const project of projects) {
        if (!project._id) {
          continue;
        }

        try {
          const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
            await API.get<JSONObject>({
              url: URL.fromString(APP_API_URL.toString()).addRoute(
                `/${new OnCallDutyPolicy().crudApiPath}/current-on-duty-escalation-policies`,
              ),
              data: {},
              headers: {
                ...ModelAPI.getCommonHeaders(),
                tenantid: project._id.toString(),
              },
            });

          if (response.isSuccess()) {
            const result: JSONObject = response.jsonData as JSONObject;

            const escalationRulesByUser: Array<OnCallDutyPolicyEscalationRuleUser> =
              DatabaseBaseModel.fromJSONArray(
                result["escalationRulesByUser"] as Array<JSONObject>,
                OnCallDutyPolicyEscalationRuleUser,
              ) as Array<OnCallDutyPolicyEscalationRuleUser>;

            const escalationRulesByTeam: Array<OnCallDutyPolicyEscalationRuleTeam> =
              DatabaseBaseModel.fromJSONArray(
                result["escalationRulesByTeam"] as Array<JSONObject>,
                OnCallDutyPolicyEscalationRuleTeam,
              ) as Array<OnCallDutyPolicyEscalationRuleTeam>;

            const escalationRulesBySchedule: Array<OnCallDutyPolicyEscalationRuleSchedule> =
              DatabaseBaseModel.fromJSONArray(
                result["escalationRulesBySchedule"] as Array<JSONObject>,
                OnCallDutyPolicyEscalationRuleSchedule,
              ) as Array<OnCallDutyPolicyEscalationRuleSchedule>;

            if (
              escalationRulesByUser.length > 0 ||
              escalationRulesByTeam.length > 0 ||
              escalationRulesBySchedule.length > 0
            ) {
              onCallData.push({
                project,
                escalationRulesByUser,
                escalationRulesByTeam,
                escalationRulesBySchedule,
              });
            }
          }
        } catch {
          // Continue with other projects if one fails
        }
      }

      setOnCallPoliciesByProject(onCallData);
      setIsLoading(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "An error occurred while fetching on-call policies",
      );
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOnCallPolicies().catch(() => {
      // handled in the function
    });
  }, []);

  const getPolicyLink: (projectId: string, policyId: string) => Route = (
    projectId: string,
    policyId: string,
  ): Route => {
    return new Route(
      `/dashboard/${projectId}/on-call-duty/policies/${policyId}`,
    );
  };

  const getAssignmentTypePill: (type: AssignmentType) => ReactElement = (
    type: AssignmentType,
  ): ReactElement => {
    switch (type) {
      case "user":
        return <Pill text="Direct" color={Green} icon={IconProp.User} />;
      case "team":
        return <Pill text="Team" color={Blue} icon={IconProp.Team} />;
      case "schedule":
        return <Pill text="Schedule" color={Purple} icon={IconProp.Clock} />;
    }
  };

  const getTotalPolicyCount: () => number = (): number => {
    let count: number = 0;
    for (const projectData of onCallPoliciesByProject) {
      count += projectData.escalationRulesByUser.length;
      count += projectData.escalationRulesByTeam.length;
      count += projectData.escalationRulesBySchedule.length;
    }
    return count;
  };

  const getPolicyItemsForProject: (
    projectData: OnCallPolicyWithProject,
  ) => Array<PolicyItem> = (
    projectData: OnCallPolicyWithProject,
  ): Array<PolicyItem> => {
    const items: Array<PolicyItem> = [];
    const projectId: string = projectData.project._id?.toString() || "";

    for (const rule of projectData.escalationRulesByUser) {
      items.push({
        policyId: rule.onCallDutyPolicy?.id?.toString(),
        policyName: rule.onCallDutyPolicy?.name,
        escalationRuleName: rule.onCallDutyPolicyEscalationRule?.name,
        assignmentType: "user",
        assignmentDetail: "You are directly assigned",
        projectId,
      });
    }

    for (const rule of projectData.escalationRulesByTeam) {
      items.push({
        policyId: rule.onCallDutyPolicy?.id?.toString(),
        policyName: rule.onCallDutyPolicy?.name,
        escalationRuleName: rule.onCallDutyPolicyEscalationRule?.name,
        assignmentType: "team",
        assignmentDetail: `Via team: ${rule.team?.name || "Unknown"}`,
        projectId,
      });
    }

    for (const rule of projectData.escalationRulesBySchedule) {
      items.push({
        policyId: rule.onCallDutyPolicy?.id?.toString(),
        policyName: rule.onCallDutyPolicy?.name,
        escalationRuleName: rule.onCallDutyPolicyEscalationRule?.name,
        assignmentType: "schedule",
        assignmentDetail: `Via schedule: ${rule.onCallDutyPolicySchedule?.name || "Unknown"}`,
        projectId,
      });
    }

    return items;
  };

  const breadcrumbLinks: Array<{ title: string; to: Route }> = [
    {
      title: "Home",
      to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
    },
    {
      title: "My On-Call Policies",
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.MY_ON_CALL_POLICIES] as Route,
      ),
    },
  ];

  if (isLoading) {
    return (
      <Page title={"My On-Call Policies"} breadcrumbLinks={breadcrumbLinks}>
        <PageLoader isVisible={true} />
      </Page>
    );
  }

  if (error) {
    return (
      <Page title={"My On-Call Policies"} breadcrumbLinks={breadcrumbLinks}>
        <ErrorMessage message={error} />
      </Page>
    );
  }

  return (
    <Page title={"My On-Call Policies"} breadcrumbLinks={breadcrumbLinks}>
      <Card
        title="Active On-Call Assignments"
        description="All on-call policies you are currently on duty for across all your projects."
        buttons={[
          {
            title: "Refresh",
            icon: IconProp.Refresh,
            buttonStyle: ButtonStyleType.OUTLINE,
            onClick: () => {
              fetchOnCallPolicies().catch(() => {
                // handled
              });
            },
          },
        ]}
      >
        {onCallPoliciesByProject.length === 0 ? (
          <EmptyState
            id="no-on-call-policies"
            icon={IconProp.Call}
            title="Not Currently On-Call"
            description="You are not currently on duty for any on-call policies across your projects."
          />
        ) : (
          <div>
            {/* Summary Banner */}
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6 flex items-center">
              <div className="flex-shrink-0">
                <Icon
                  icon={IconProp.CheckCircle}
                  className="h-6 w-6 text-green-600"
                />
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium text-green-800">
                  You are currently on duty for{" "}
                  <span className="font-bold">{getTotalPolicyCount()}</span>{" "}
                  {getTotalPolicyCount() === 1
                    ? "policy assignment"
                    : "policy assignments"}{" "}
                  across{" "}
                  <span className="font-bold">
                    {onCallPoliciesByProject.length}
                  </span>{" "}
                  {onCallPoliciesByProject.length === 1
                    ? "project"
                    : "projects"}
                  .
                </p>
              </div>
            </div>

            {/* Policies by Project */}
            <div className="space-y-6">
              {onCallPoliciesByProject.map(
                (
                  projectData: OnCallPolicyWithProject,
                  projectIndex: number,
                ): ReactElement => {
                  const policyItems: Array<PolicyItem> =
                    getPolicyItemsForProject(projectData);

                  return (
                    <div
                      key={projectIndex}
                      className="border border-gray-200 rounded-lg overflow-hidden"
                    >
                      {/* Project Header */}
                      <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <div className="flex-shrink-0">
                              <Icon
                                icon={IconProp.Folder}
                                className="h-5 w-5 text-gray-500"
                              />
                            </div>
                            <div>
                              <ProjectElement project={projectData.project} />
                            </div>
                          </div>
                          <div className="text-sm text-gray-500">
                            {policyItems.length}{" "}
                            {policyItems.length === 1
                              ? "assignment"
                              : "assignments"}
                          </div>
                        </div>
                      </div>

                      {/* Policy Items */}
                      <div className="divide-y divide-gray-100">
                        {policyItems.map(
                          (
                            item: PolicyItem,
                            itemIndex: number,
                          ): ReactElement => {
                            return (
                              <div
                                key={itemIndex}
                                className="px-4 py-4 hover:bg-gray-50 transition-colors"
                              >
                                <div className="flex items-start justify-between">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center space-x-3 mb-2">
                                      {/* Policy Name */}
                                      <div className="font-medium text-gray-900">
                                        {item.policyId ? (
                                          <Link
                                            to={getPolicyLink(
                                              item.projectId,
                                              item.policyId,
                                            )}
                                            className="hover:text-indigo-600 hover:underline"
                                          >
                                            {item.policyName ||
                                              "Unknown Policy"}
                                          </Link>
                                        ) : (
                                          item.policyName || "Unknown Policy"
                                        )}
                                      </div>
                                      {/* Assignment Type Pill */}
                                      {getAssignmentTypePill(
                                        item.assignmentType,
                                      )}
                                    </div>

                                    {/* Escalation Rule and Assignment Detail */}
                                    <div className="flex flex-col sm:flex-row sm:items-center text-sm text-gray-500 space-y-1 sm:space-y-0 sm:space-x-4">
                                      <div className="flex items-center">
                                        <Icon
                                          icon={IconProp.ArrowCircleUp}
                                          className="h-4 w-4 mr-1.5 text-gray-400"
                                        />
                                        <span>
                                          Escalation Rule:{" "}
                                          <span className="font-medium text-gray-700">
                                            {item.escalationRuleName ||
                                              "Unknown"}
                                          </span>
                                        </span>
                                      </div>
                                      <div className="flex items-center">
                                        <Icon
                                          icon={IconProp.Info}
                                          className="h-4 w-4 mr-1.5 text-gray-400"
                                        />
                                        <span>{item.assignmentDetail}</span>
                                      </div>
                                    </div>
                                  </div>

                                  {/* View Button */}
                                  {item.policyId && (
                                    <div className="flex-shrink-0 ml-4">
                                      <Button
                                        title="View"
                                        buttonStyle={
                                          ButtonStyleType.SECONDARY_LINK
                                        }
                                        icon={IconProp.ChevronRight}
                                        onClick={() => {
                                          window.location.href = getPolicyLink(
                                            item.projectId,
                                            item.policyId!,
                                          ).toString();
                                        }}
                                      />
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          },
                        )}
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          </div>
        )}
      </Card>
    </Page>
  );
};

export default MyOnCallPolicies;
