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

const MyOnCallPolicies: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [onCallPoliciesByProject, setOnCallPoliciesByProject] = useState<
    Array<OnCallPolicyWithProject>
  >([]);

  const fetchOnCallPolicies: PromiseVoidFunction =
    async (): Promise<void> => {
      try {
        setIsLoading(true);
        setError("");

        // First, fetch all projects the user is part of
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
              overrideRequestUrl: URL.fromString(
                APP_API_URL.toString(),
              ).addRoute("/project/list-user-projects"),
            },
          });

        const projects: Array<Project> = projectsResult.data;
        const onCallData: Array<OnCallPolicyWithProject> = [];

        // For each project, fetch on-call policies
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

              // Only add if there are any on-call policies
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

  const getPolicyLink: (
    projectId: string,
    policyId: string,
  ) => Route = (projectId: string, policyId: string): Route => {
    return new Route(`/dashboard/${projectId}/on-call-duty/policies/${policyId}`);
  };

  const renderPolicyItem: (
    policyName: string | undefined,
    escalationRuleName: string | undefined,
    reason: string,
    projectId: string,
    policyId: string | undefined,
  ) => ReactElement = (
    policyName: string | undefined,
    escalationRuleName: string | undefined,
    reason: string,
    projectId: string,
    policyId: string | undefined,
  ): ReactElement => {
    return (
      <div className="py-3 border-b border-gray-100 last:border-b-0">
        <div className="flex items-start">
          <div className="flex-1">
            <div className="font-semibold text-gray-900">
              {policyId ? (
                <Link
                  to={getPolicyLink(projectId, policyId)}
                  className="hover:underline"
                >
                  {policyName || "Unknown Policy"}
                </Link>
              ) : (
                policyName || "Unknown Policy"
              )}
            </div>
            <div className="text-sm text-gray-600 mt-1">
              {reason}{" "}
              <span className="font-medium">
                {escalationRuleName || "Unknown Rule"}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <Page
        title={"My On-Call Policies"}
        breadcrumbLinks={[
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
        ]}
      >
        <PageLoader isVisible={true} />
      </Page>
    );
  }

  if (error) {
    return (
      <Page
        title={"My On-Call Policies"}
        breadcrumbLinks={[
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
        ]}
      >
        <ErrorMessage message={error} />
      </Page>
    );
  }

  return (
    <Page
      title={"My On-Call Policies"}
      breadcrumbLinks={[
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
      ]}
    >
      <Card
        title="My On-Call Policies"
        description="You are currently on-call for the following policies across all your projects."
      >
        {onCallPoliciesByProject.length === 0 ? (
          <div className="p-4 text-gray-500 text-center">
            You are not currently on-call for any policies.
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {onCallPoliciesByProject.map(
              (
                projectData: OnCallPolicyWithProject,
                index: number,
              ): ReactElement => {
                const projectId: string =
                  projectData.project._id?.toString() || "";

                return (
                  <div key={index} className="p-4">
                    <div className="flex items-center mb-3">
                      <Link
                        to={new Route(`/dashboard/${projectId}/home`)}
                        className="font-semibold text-lg text-indigo-600 hover:underline"
                      >
                        {projectData.project.name || "Unknown Project"}
                      </Link>
                    </div>

                    <div className="pl-4">
                      {/* Policies by User */}
                      {projectData.escalationRulesByUser.map(
                        (
                          rule: OnCallDutyPolicyEscalationRuleUser,
                          ruleIndex: number,
                        ): ReactElement => {
                          return (
                            <div key={`user-${ruleIndex}`}>
                              {renderPolicyItem(
                                rule.onCallDutyPolicy?.name,
                                rule.onCallDutyPolicyEscalationRule?.name,
                                "You are added to escalation rule",
                                projectId,
                                rule.onCallDutyPolicy?.id?.toString(),
                              )}
                            </div>
                          );
                        },
                      )}

                      {/* Policies by Team */}
                      {projectData.escalationRulesByTeam.map(
                        (
                          rule: OnCallDutyPolicyEscalationRuleTeam,
                          ruleIndex: number,
                        ): ReactElement => {
                          return (
                            <div key={`team-${ruleIndex}`}>
                              {renderPolicyItem(
                                rule.onCallDutyPolicy?.name,
                                rule.onCallDutyPolicyEscalationRule?.name,
                                `Team "${rule.team?.name || "Unknown"}" is added to escalation rule`,
                                projectId,
                                rule.onCallDutyPolicy?.id?.toString(),
                              )}
                            </div>
                          );
                        },
                      )}

                      {/* Policies by Schedule */}
                      {projectData.escalationRulesBySchedule.map(
                        (
                          rule: OnCallDutyPolicyEscalationRuleSchedule,
                          ruleIndex: number,
                        ): ReactElement => {
                          return (
                            <div key={`schedule-${ruleIndex}`}>
                              {renderPolicyItem(
                                rule.onCallDutyPolicy?.name,
                                rule.onCallDutyPolicyEscalationRule?.name,
                                `Schedule "${rule.onCallDutyPolicySchedule?.name || "Unknown"}" is added to escalation rule`,
                                projectId,
                                rule.onCallDutyPolicy?.id?.toString(),
                              )}
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
        )}
      </Card>
    </Page>
  );
};

export default MyOnCallPolicies;
