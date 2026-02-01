import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import OneUptimeDate from "Common/Types/Date";
import Route from "Common/Types/API/Route";
import Incident from "Common/Models/DatabaseModels/Incident";
import MarkdownUtil from "Common/UI/Utils/Markdown";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelForm, { FormType } from "Common/UI/Components/Forms/ModelForm";
import Navigation from "Common/UI/Utils/Navigation";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Card from "Common/UI/Components/Card/Card";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Team from "Common/Models/DatabaseModels/Team";
import ProjectUser from "../../Utils/ProjectUser";
import ProjectUtil from "Common/UI/Utils/Project";
import Label from "Common/Models/DatabaseModels/Label";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import IncidentTemplate from "Common/Models/DatabaseModels/IncidentTemplate";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import IncidentTemplateOwnerTeam from "Common/Models/DatabaseModels/IncidentTemplateOwnerTeam";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IncidentTemplateOwnerUser from "Common/Models/DatabaseModels/IncidentTemplateOwnerUser";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FetchLabels from "../../Components/Label/FetchLabels";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import FetchUsers from "../../Components/User/FetchUsers";
import User from "Common/Models/DatabaseModels/User";
import FetchTeam from "../../Components/Team/FetchTeams";
import FetchMonitorStatuses from "../../Components/MonitorStatus/FetchMonitorStatuses";
import FetchOnCallDutyPolicies from "../../Components/OnCallPolicy/FetchOnCallPolicies";
import FetchMonitors from "../../Components/Monitor/FetchMonitors";
import FetchIncidentSeverities from "../../Components/IncidentSeverity/FetchIncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Color from "Common/Types/Color";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import IncidentRoleFormField, {
  RoleAssignment,
} from "../../Components/Incident/IncidentRoleFormField";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import IncidentMember from "Common/Models/DatabaseModels/IncidentMember";

const IncidentCreate: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [roleAssignments, setRoleAssignments] = useState<Array<RoleAssignment>>(
    [],
  );

  const [initialValuesForIncident, setInitialValuesForIncident] =
    useState<JSONObject>({});

  useEffect(() => {
    if (Navigation.getQueryStringByName("incidentTemplateId")) {
      fetchIncidentTemplate(
        new ObjectID(
          Navigation.getQueryStringByName("incidentTemplateId") || "",
        ),
      );
    } else {
      // Fetch the first incident state to set as default
      fetchFirstIncidentState();
      setIsLoading(false);
    }
  }, []);

  const fetchFirstIncidentState: () => Promise<void> =
    async (): Promise<void> => {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
      if (!projectId) {
        return;
      }

      try {
        const incidentStates: ListResult<IncidentState> =
          await ModelAPI.getList<IncidentState>({
            modelType: IncidentState,
            query: {
              projectId: projectId,
            },
            limit: 1,
            skip: 0,
            select: {
              _id: true,
            },
            sort: {
              order: SortOrder.Ascending,
            },
          });

        if (incidentStates.data.length > 0) {
          const firstStateId: string | undefined =
            incidentStates.data[0]!._id?.toString();
          if (firstStateId) {
            setInitialValuesForIncident((prev: JSONObject) => {
              return {
                ...prev,
                currentIncidentState: firstStateId,
              };
            });
          }
        }
      } catch {
        // Silently fail to avoid breaking the form
      }
    };

  const fetchIncidentTemplate: (id: ObjectID) => Promise<void> = async (
    id: ObjectID,
  ): Promise<void> => {
    setError("");
    setIsLoading(true);

    try {
      //fetch incident template

      const incidentTemplate: IncidentTemplate | null =
        await ModelAPI.getItem<IncidentTemplate>({
          modelType: IncidentTemplate,
          id: id,
          select: {
            title: true,
            description: true,
            incidentSeverityId: true,
            initialIncidentStateId: true,
            monitors: true,
            onCallDutyPolicies: true,
            labels: true,
            changeMonitorStatusToId: true,
          },
        });

      const teamsListResult: ListResult<IncidentTemplateOwnerTeam> =
        await ModelAPI.getList<IncidentTemplateOwnerTeam>({
          modelType: IncidentTemplateOwnerTeam,
          query: {
            incidentTemplate: id,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            teamId: true,
          },
          sort: {},
        });

      const usersListResult: ListResult<IncidentTemplateOwnerUser> =
        await ModelAPI.getList<IncidentTemplateOwnerUser>({
          modelType: IncidentTemplateOwnerUser,
          query: {
            incidentTemplate: id,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            userId: true,
          },
          sort: {},
        });

      if (incidentTemplate) {
        const initialValue: JSONObject = {
          ...BaseModel.toJSONObject(incidentTemplate, IncidentTemplate),
          incidentSeverity: incidentTemplate.incidentSeverityId?.toString(),
          currentIncidentState:
            incidentTemplate.initialIncidentStateId?.toString(),
          monitors: incidentTemplate.monitors?.map((monitor: Monitor) => {
            return monitor.id!.toString();
          }),
          labels: incidentTemplate.labels?.map((label: Label) => {
            return label.id!.toString();
          }),
          changeMonitorStatusTo:
            incidentTemplate.changeMonitorStatusToId?.toString(),
          onCallDutyPolicies: incidentTemplate.onCallDutyPolicies?.map(
            (onCallPolicy: OnCallDutyPolicy) => {
              return onCallPolicy.id!.toString();
            },
          ),
          ownerUsers: usersListResult.data.map(
            (user: IncidentTemplateOwnerUser): string => {
              return user.userId!.toString() || "";
            },
          ),
          ownerTeams: teamsListResult.data.map(
            (team: IncidentTemplateOwnerTeam): string => {
              return team.teamId!.toString() || "";
            },
          ),
        };

        setInitialValuesForIncident(initialValue);
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  return (
    <Fragment>
      <Card
        title="Declare New Incident"
        description={
          "Declare a new incident to let your team know what's going on and how to respond."
        }
        className="mb-10"
      >
        <div>
          {isLoading && <PageLoader isVisible={true} />}
          {error && <ErrorMessage message={error} />}
          {!isLoading && !error && (
            <ModelForm<Incident>
              modelType={Incident}
              initialValues={initialValuesForIncident}
              name="Create New Incident"
              id="create-incident-form"
              fields={[
                {
                  field: {
                    title: true,
                  },
                  title: "Title",
                  fieldType: FormFieldSchemaType.Text,
                  stepId: "incident-details",
                  required: true,
                  placeholder: "Incident Title",
                  validation: {
                    minLength: 2,
                  },
                },
                {
                  field: {
                    description: true,
                  },
                  title: "Description",
                  stepId: "incident-details",
                  fieldType: FormFieldSchemaType.Markdown,
                  required: false,
                  description: MarkdownUtil.getMarkdownCheatsheet(
                    "Describe the incident details here",
                  ),
                },
                {
                  field: {
                    declaredAt: true,
                  },
                  title: "Declared At",
                  stepId: "incident-details",
                  description: "When was this incident first declared?",
                  fieldType: FormFieldSchemaType.DateTime,
                  required: true,
                  placeholder: "Pick date and time",
                  getDefaultValue: () => {
                    return OneUptimeDate.getCurrentDate();
                  },
                },
                {
                  field: {
                    incidentSeverity: true,
                  },
                  title: "Incident Severity",
                  stepId: "incident-details",
                  description: "What type of incident is this?",
                  fieldType: FormFieldSchemaType.Dropdown,
                  dropdownModal: {
                    type: IncidentSeverity,
                    labelField: "name",
                    valueField: "_id",
                  },
                  required: true,
                  placeholder: "Incident Severity",
                  getSummaryElement: (item: FormValues<Incident>) => {
                    if (!item.incidentSeverity) {
                      return <p>No incident severity selected.</p>;
                    }

                    return (
                      <FetchIncidentSeverities
                        incidentSeverityIds={[
                          new ObjectID(item.incidentSeverity.toString()),
                        ]}
                      />
                    );
                  },
                },
                {
                  field: {
                    currentIncidentState: true,
                  },
                  title: "Incident State",
                  stepId: "incident-details",
                  description:
                    "Select the initial state for this incident to be in.",
                  fieldType: FormFieldSchemaType.Dropdown,
                  dropdownModal: {
                    type: IncidentState,
                    labelField: "name",
                    valueField: "_id",
                  },
                  required: false,
                  placeholder: "Select Initial State",
                  fetchDropdownOptions: async () => {
                    const projectId: ObjectID | null =
                      ProjectUtil.getCurrentProjectId();
                    if (!projectId) {
                      return [];
                    }

                    try {
                      const incidentStates: ListResult<IncidentState> =
                        await ModelAPI.getList<IncidentState>({
                          modelType: IncidentState,
                          query: {
                            projectId: projectId,
                          },
                          limit: LIMIT_PER_PROJECT,
                          skip: 0,
                          select: {
                            _id: true,
                            name: true,
                            color: true,
                          },
                          sort: {
                            order: SortOrder.Ascending,
                          },
                        });

                      return incidentStates.data.map(
                        (state: IncidentState): DropdownOption => {
                          const option: DropdownOption = {
                            label: state.name || "",
                            value: state._id?.toString() || "",
                            color: state.color as Color,
                          };

                          return option;
                        },
                      );
                    } catch {
                      // Silently fail and return empty array
                      return [];
                    }
                  },
                  getSummaryElement: (item: FormValues<Incident>) => {
                    if (!item.currentIncidentState) {
                      return <p>Will use first available state by priority</p>;
                    }

                    return <p>Initial state will be set to selected state</p>;
                  },
                },
                {
                  field: {
                    monitors: true,
                  },
                  title: "Monitors affected",
                  stepId: "resources-affected",
                  description: "Select monitors affected by this incident.",
                  fieldType: FormFieldSchemaType.MultiSelectDropdown,
                  dropdownModal: {
                    type: Monitor,
                    labelField: "name",
                    valueField: "_id",
                  },
                  required: false,
                  placeholder: "Monitors affected",
                  getSummaryElement: (item: FormValues<Incident>) => {
                    if (!item.monitors || !Array.isArray(item.monitors)) {
                      return <p>No monitors affected by this incident.</p>;
                    }

                    const monitorIds: Array<ObjectID> = [];

                    for (const monitor of item.monitors) {
                      if (typeof monitor === "string") {
                        monitorIds.push(new ObjectID(monitor));
                        continue;
                      }

                      if (monitor instanceof ObjectID) {
                        monitorIds.push(monitor);
                        continue;
                      }

                      if (monitor instanceof Monitor) {
                        monitorIds.push(
                          new ObjectID(monitor._id?.toString() || ""),
                        );
                        continue;
                      }
                    }

                    return (
                      <div>
                        <FetchMonitors monitorIds={monitorIds} />
                      </div>
                    );
                  },
                },
                {
                  overrideField: {
                    incidentRoles: true,
                  },
                  showEvenIfPermissionDoesNotExist: true,
                  title: "Assign Incident Roles",
                  stepId: "incident-roles",
                  description:
                    "Assign team members to incident roles. Some roles allow multiple users.",
                  fieldType: FormFieldSchemaType.CustomComponent,
                  required: false,
                  overrideFieldKey: "incidentRoles",
                  getCustomElement: (
                    _value: FormValues<Incident>,
                    props: CustomElementProps,
                  ) => {
                    return (
                      <IncidentRoleFormField
                        initialValue={roleAssignments}
                        error={props.error}
                        onChange={(assignments: Array<RoleAssignment>) => {
                          setRoleAssignments(assignments);
                          if (props.onChange) {
                            props.onChange(assignments);
                          }
                        }}
                      />
                    );
                  },
                  getSummaryElement: (_item: FormValues<Incident>) => {
                    if (roleAssignments.length === 0) {
                      return <p>No incident roles assigned.</p>;
                    }
                    const totalAssignments: number = roleAssignments.reduce(
                      (acc: number, assignment: RoleAssignment) => {
                        return acc + assignment.userIds.length;
                      },
                      0,
                    );
                    return (
                      <p>
                        {totalAssignments} user
                        {totalAssignments !== 1 ? "s" : ""} assigned to{" "}
                        {roleAssignments.length} role
                        {roleAssignments.length !== 1 ? "s" : ""}.
                      </p>
                    );
                  },
                },
                {
                  field: {
                    onCallDutyPolicies: true,
                  },
                  title: "On-Call Policy",
                  stepId: "on-call",
                  description:
                    "Select on-call duty policy to execute when this incident is created.",
                  fieldType: FormFieldSchemaType.MultiSelectDropdown,
                  dropdownModal: {
                    type: OnCallDutyPolicy,
                    labelField: "name",
                    valueField: "_id",
                  },
                  required: false,
                  placeholder: "Select on-call policies",
                  getSummaryElement: (item: FormValues<Incident>) => {
                    if (
                      !item.onCallDutyPolicies ||
                      !Array.isArray(item.onCallDutyPolicies)
                    ) {
                      return (
                        <p>
                          No on-call policies will be executed when this
                          incident is created.
                        </p>
                      );
                    }

                    const onCallDutyPolicyIds: Array<ObjectID> = [];

                    for (const onCallDutyPolicy of item.onCallDutyPolicies) {
                      if (typeof onCallDutyPolicy === "string") {
                        onCallDutyPolicyIds.push(
                          new ObjectID(onCallDutyPolicy),
                        );
                        continue;
                      }

                      if (onCallDutyPolicy instanceof ObjectID) {
                        onCallDutyPolicyIds.push(onCallDutyPolicy);
                        continue;
                      }

                      if (onCallDutyPolicy instanceof OnCallDutyPolicy) {
                        onCallDutyPolicyIds.push(
                          new ObjectID(onCallDutyPolicy._id?.toString() || ""),
                        );
                        continue;
                      }
                    }

                    return (
                      <div>
                        <FetchOnCallDutyPolicies
                          onCallDutyPolicyIds={onCallDutyPolicyIds}
                        />
                      </div>
                    );
                  },
                },
                {
                  field: {
                    changeMonitorStatusTo: true,
                  },
                  title: "Change Monitor Status to ",
                  stepId: "resources-affected",
                  description:
                    "This will change the status of all the monitors attached to this incident.",
                  fieldType: FormFieldSchemaType.Dropdown,
                  dropdownModal: {
                    type: MonitorStatus,
                    labelField: "name",
                    valueField: "_id",
                  },
                  required: false,
                  placeholder: "Monitor Status",
                  getSummaryElement: (item: FormValues<Incident>) => {
                    if (!item.changeMonitorStatusTo) {
                      return (
                        <p>
                          Status of the monitors will not be changed when this
                          incident is created.
                        </p>
                      );
                    }

                    return (
                      <FetchMonitorStatuses
                        monitorStatusIds={[
                          new ObjectID(item.changeMonitorStatusTo.toString()),
                        ]}
                        shouldAnimate={false}
                      />
                    );
                  },
                },
                {
                  overrideField: {
                    ownerTeams: true,
                  },
                  showEvenIfPermissionDoesNotExist: true,
                  title: "Owner - Teams",
                  stepId: "owners",
                  description:
                    "Select which teams own this incident. They will be notified when the incident is created or updated.",
                  fieldType: FormFieldSchemaType.MultiSelectDropdown,
                  dropdownModal: {
                    type: Team,
                    labelField: "name",
                    valueField: "_id",
                  },
                  required: false,
                  placeholder: "Select Teams",
                  overrideFieldKey: "ownerTeams",
                  getSummaryElement: (item: FormValues<Incident>) => {
                    if (
                      !(item as JSONObject)["ownerTeams"] ||
                      !Array.isArray((item as JSONObject)["ownerTeams"])
                    ) {
                      return <p>No teams assigned.</p>;
                    }

                    const ownerTeamIds: Array<ObjectID> = [];

                    for (const ownerTeam of (item as JSONObject)[
                      "ownerTeams"
                    ] as Array<any>) {
                      if (typeof ownerTeam === "string") {
                        ownerTeamIds.push(new ObjectID(ownerTeam));
                        continue;
                      }

                      if (ownerTeam instanceof ObjectID) {
                        ownerTeamIds.push(ownerTeam);
                        continue;
                      }

                      if (ownerTeam instanceof Team) {
                        ownerTeamIds.push(
                          new ObjectID(ownerTeam._id?.toString() || ""),
                        );
                        continue;
                      }
                    }

                    return (
                      <div>
                        <FetchTeam teamIds={ownerTeamIds} />
                      </div>
                    );
                  },
                },
                {
                  overrideField: {
                    ownerUsers: true,
                  },
                  showEvenIfPermissionDoesNotExist: true,
                  title: "Owner - Users",
                  stepId: "owners",
                  description:
                    "Select which users own this incident. They will be notified when the incident is created or updated.",
                  fieldType: FormFieldSchemaType.MultiSelectDropdown,
                  fetchDropdownOptions: async () => {
                    return await ProjectUser.fetchProjectUsersAsDropdownOptions(
                      ProjectUtil.getCurrentProjectId()!,
                    );
                  },
                  required: false,
                  placeholder: "Select Users",
                  overrideFieldKey: "ownerUsers",
                  getSummaryElement: (item: FormValues<Incident>) => {
                    if (
                      !(item as JSONObject)["ownerUsers"] ||
                      !Array.isArray((item as JSONObject)["ownerUsers"])
                    ) {
                      return <p>No owners assigned.</p>;
                    }

                    const ownerUserIds: Array<ObjectID> = [];

                    for (const ownerUser of (item as JSONObject)[
                      "ownerUsers"
                    ] as Array<any>) {
                      if (typeof ownerUser === "string") {
                        ownerUserIds.push(new ObjectID(ownerUser));
                        continue;
                      }

                      if (ownerUser instanceof ObjectID) {
                        ownerUserIds.push(ownerUser);
                        continue;
                      }

                      if (ownerUser instanceof User) {
                        ownerUserIds.push(
                          new ObjectID(ownerUser._id?.toString() || ""),
                        );
                        continue;
                      }
                    }

                    return (
                      <div>
                        <FetchUsers userIds={ownerUserIds} />
                      </div>
                    );
                  },
                },
                {
                  field: {
                    labels: true,
                  },

                  title: "Labels ",
                  stepId: "more",
                  description:
                    "Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.",
                  fieldType: FormFieldSchemaType.MultiSelectDropdown,
                  dropdownModal: {
                    type: Label,
                    labelField: "name",
                    valueField: "_id",
                  },
                  required: false,
                  placeholder: "Labels",
                  getSummaryElement: (item: FormValues<Incident>) => {
                    if (!item.labels || !Array.isArray(item.labels)) {
                      return <p>No labels assigned.</p>;
                    }

                    const labelIds: Array<ObjectID> = [];

                    for (const label of item.labels) {
                      if (typeof label === "string") {
                        labelIds.push(new ObjectID(label));
                        continue;
                      }

                      if (label instanceof ObjectID) {
                        labelIds.push(label);
                        continue;
                      }

                      if (label instanceof Label) {
                        labelIds.push(
                          new ObjectID(label._id?.toString() || ""),
                        );
                        continue;
                      }
                    }

                    return (
                      <div>
                        <FetchLabels labelIds={labelIds} />
                      </div>
                    );
                  },
                },
                {
                  field: {
                    shouldStatusPageSubscribersBeNotifiedOnIncidentCreated:
                      true,
                  },

                  title: "Notify Status Page Subscribers",
                  stepId: "more",
                  description:
                    "Should status page subscribers be notified when this incident is created?",
                  fieldType: FormFieldSchemaType.Checkbox,
                  defaultValue: true,
                  required: false,
                },
              ]}
              steps={[
                {
                  title: "Incident Details",
                  id: "incident-details",
                },
                {
                  title: "Resources Affected",
                  id: "resources-affected",
                },
                {
                  title: "Incident Roles",
                  id: "incident-roles",
                },
                {
                  title: "On-Call",
                  id: "on-call",
                },
                {
                  title: "Owners",
                  id: "owners",
                },
                {
                  title: "More",
                  id: "more",
                },
              ]}
              onSuccess={async (createdItem: Incident) => {
                // Create incident member records for role assignments
                const projectId: ObjectID | null =
                  ProjectUtil.getCurrentProjectId();
                const incidentId: ObjectID = new ObjectID(
                  createdItem._id?.toString() || "",
                );

                if (projectId && roleAssignments.length > 0) {
                  for (const assignment of roleAssignments) {
                    for (const userId of assignment.userIds) {
                      try {
                        const incidentMember: IncidentMember =
                          new IncidentMember();
                        incidentMember.projectId = projectId;
                        incidentMember.incidentId = incidentId;
                        incidentMember.incidentRoleId = new ObjectID(
                          assignment.roleId,
                        );
                        incidentMember.userId = new ObjectID(userId);

                        await ModelAPI.create({
                          model: incidentMember,
                          modelType: IncidentMember,
                        });
                      } catch {
                        // Continue with other assignments even if one fails
                      }
                    }
                  }
                }

                Navigation.navigate(
                  RouteUtil.populateRouteParams(
                    RouteUtil.populateRouteParams(
                      RouteMap[PageMap.INCIDENT_VIEW] as Route,
                      {
                        modelId: createdItem._id,
                      },
                    ),
                  ),
                );
              }}
              submitButtonText={"Declare Incident"}
              formType={FormType.Create}
              summary={{
                enabled: true,
              }}
            />
          )}
        </div>
      </Card>
    </Fragment>
  );
};

export default IncidentCreate;
