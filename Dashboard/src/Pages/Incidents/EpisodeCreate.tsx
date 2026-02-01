import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import MarkdownUtil from "Common/UI/Utils/Markdown";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import ModelForm, { FormType } from "Common/UI/Components/Forms/ModelForm";
import Navigation from "Common/UI/Utils/Navigation";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Card from "Common/UI/Components/Card/Card";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import ProjectUtil from "Common/UI/Utils/Project";
import Label from "Common/Models/DatabaseModels/Label";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FetchLabels from "../../Components/Label/FetchLabels";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import FetchOnCallDutyPolicies from "../../Components/OnCallPolicy/FetchOnCallPolicies";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Color from "Common/Types/Color";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import IncidentEpisodeRoleFormField, {
  RoleAssignment,
} from "../../Components/IncidentEpisode/IncidentEpisodeRoleFormField";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import IncidentEpisodeRoleMember from "Common/Models/DatabaseModels/IncidentEpisodeRoleMember";
import IncidentRole from "Common/Models/DatabaseModels/IncidentRole";
import UserUtil from "Common/UI/Utils/User";

const EpisodeCreate: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error] = useState<string>("");
  const roleAssignmentsRef = useRef<Array<RoleAssignment>>([]);

  const [initialValuesForEpisode, setInitialValuesForEpisode] =
    useState<JSONObject>({});

  useEffect(() => {
    fetchFirstIncidentState();
  }, []);

  const fetchFirstIncidentState: () => Promise<void> =
    async (): Promise<void> => {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
      if (!projectId) {
        setIsLoading(false);
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
            setInitialValuesForEpisode((prev: JSONObject) => {
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

      setIsLoading(false);
    };

  return (
    <Fragment>
      <Card
        title="Create New Incident Episode"
        description={
          "Create a new incident episode to group related incidents together and manage them as a single unit."
        }
        className="mb-10"
      >
        <div>
          {isLoading && <PageLoader isVisible={true} />}
          {error && <ErrorMessage message={error} />}
          {!isLoading && !error && (
            <ModelForm<IncidentEpisode>
              modelType={IncidentEpisode}
              initialValues={initialValuesForEpisode}
              name="Create New Incident Episode"
              id="create-incident-episode-form"
              fields={[
                {
                  field: {
                    title: true,
                  },
                  title: "Title",
                  fieldType: FormFieldSchemaType.Text,
                  stepId: "episode-details",
                  required: true,
                  placeholder: "Episode Title",
                  validation: {
                    minLength: 2,
                  },
                },
                {
                  field: {
                    description: true,
                  },
                  title: "Description",
                  stepId: "episode-details",
                  fieldType: FormFieldSchemaType.Markdown,
                  required: false,
                  description: MarkdownUtil.getMarkdownCheatsheet(
                    "Describe the episode details here",
                  ),
                },
                {
                  field: {
                    incidentSeverity: true,
                  },
                  title: "Incident Severity",
                  stepId: "episode-details",
                  description: "What severity level is this episode?",
                  fieldType: FormFieldSchemaType.Dropdown,
                  dropdownModal: {
                    type: IncidentSeverity,
                    labelField: "name",
                    valueField: "_id",
                  },
                  required: false,
                  placeholder: "Incident Severity",
                  getSummaryElement: (item: FormValues<IncidentEpisode>) => {
                    if (!item.incidentSeverity) {
                      return <p>No incident severity selected.</p>;
                    }

                    return <p>Severity will be set to selected value</p>;
                  },
                },
                {
                  field: {
                    currentIncidentState: true,
                  },
                  title: "Incident State",
                  stepId: "episode-details",
                  description:
                    "Select the initial state for this episode to be in.",
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
                  getSummaryElement: (item: FormValues<IncidentEpisode>) => {
                    if (!item.currentIncidentState) {
                      return <p>Will use first available state by priority</p>;
                    }

                    return <p>Initial state will be set to selected state</p>;
                  },
                },
                {
                  overrideField: {
                    episodeRoles: true,
                  },
                  showEvenIfPermissionDoesNotExist: true,
                  title: "Assign Episode Roles",
                  stepId: "episode-roles",
                  description:
                    "Assign team members to roles. Role assignments will propagate to all incidents in this episode.",
                  fieldType: FormFieldSchemaType.CustomComponent,
                  required: false,
                  overrideFieldKey: "episodeRoles",
                  getCustomElement: (
                    _value: FormValues<IncidentEpisode>,
                    props: CustomElementProps,
                  ) => {
                    return (
                      <IncidentEpisodeRoleFormField
                        initialValue={roleAssignmentsRef.current}
                        error={props.error}
                        onChange={(assignments: Array<RoleAssignment>) => {
                          roleAssignmentsRef.current = assignments;
                          if (props.onChange) {
                            props.onChange(assignments);
                          }
                        }}
                      />
                    );
                  },
                  getSummaryElement: (_item: FormValues<IncidentEpisode>) => {
                    if (roleAssignmentsRef.current.length === 0) {
                      return <p>No episode roles assigned.</p>;
                    }
                    const totalAssignments: number =
                      roleAssignmentsRef.current.reduce(
                        (acc: number, assignment: RoleAssignment) => {
                          return acc + assignment.userIds.length;
                        },
                        0,
                      );
                    return (
                      <p>
                        {totalAssignments} user
                        {totalAssignments !== 1 ? "s" : ""} assigned to{" "}
                        {roleAssignmentsRef.current.length} role
                        {roleAssignmentsRef.current.length !== 1 ? "s" : ""}.
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
                    "Select on-call duty policy to execute when this episode is created.",
                  fieldType: FormFieldSchemaType.MultiSelectDropdown,
                  dropdownModal: {
                    type: OnCallDutyPolicy,
                    labelField: "name",
                    valueField: "_id",
                  },
                  required: false,
                  placeholder: "Select on-call policies",
                  getSummaryElement: (item: FormValues<IncidentEpisode>) => {
                    if (
                      !item.onCallDutyPolicies ||
                      !Array.isArray(item.onCallDutyPolicies)
                    ) {
                      return (
                        <p>
                          No on-call policies will be executed when this episode
                          is created.
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
                  getSummaryElement: (item: FormValues<IncidentEpisode>) => {
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
              ]}
              steps={[
                {
                  title: "Episode Details",
                  id: "episode-details",
                },
                {
                  title: "Episode Roles",
                  id: "episode-roles",
                },
                {
                  title: "On-Call",
                  id: "on-call",
                },
                {
                  title: "More",
                  id: "more",
                },
              ]}
              onSuccess={async (createdItem: IncidentEpisode) => {
                // Create episode role member records for role assignments
                const projectId: ObjectID | null =
                  ProjectUtil.getCurrentProjectId();
                const episodeId: ObjectID = new ObjectID(
                  createdItem._id?.toString() || "",
                );
                const currentUserId: ObjectID | null = UserUtil.getUserId();

                if (projectId) {
                  // Create role assignments from form
                  if (roleAssignmentsRef.current.length > 0) {
                    for (const assignment of roleAssignmentsRef.current) {
                      for (const userId of assignment.userIds) {
                        try {
                          const episodeRoleMember: IncidentEpisodeRoleMember =
                            new IncidentEpisodeRoleMember();
                          episodeRoleMember.projectId = projectId;
                          episodeRoleMember.incidentEpisodeId = episodeId;
                          episodeRoleMember.incidentRoleId = new ObjectID(
                            assignment.roleId,
                          );
                          episodeRoleMember.userId = new ObjectID(userId);

                          await ModelAPI.create({
                            model: episodeRoleMember,
                            modelType: IncidentEpisodeRoleMember,
                          });
                        } catch {
                          // Continue with other assignments even if one fails
                        }
                      }
                    }
                  }

                  // Assign creator to primary roles if no one is assigned
                  if (currentUserId) {
                    try {
                      // Fetch primary roles
                      const primaryRolesResult: ListResult<IncidentRole> =
                        await ModelAPI.getList<IncidentRole>({
                          modelType: IncidentRole,
                          query: {
                            projectId: projectId,
                            isPrimaryRole: true,
                          },
                          limit: LIMIT_PER_PROJECT,
                          skip: 0,
                          select: {
                            _id: true,
                          },
                          sort: {},
                        });

                      // Get the role IDs that already have assignments
                      const assignedRoleIds: Set<string> = new Set(
                        roleAssignmentsRef.current
                          .filter((a: RoleAssignment) => {
                            return a.userIds.length > 0;
                          })
                          .map((a: RoleAssignment) => {
                            return a.roleId;
                          }),
                      );

                      // Assign creator to primary roles that don't have anyone assigned
                      for (const primaryRole of primaryRolesResult.data) {
                        const roleId: string = primaryRole.id!.toString();
                        if (!assignedRoleIds.has(roleId)) {
                          try {
                            const episodeRoleMember: IncidentEpisodeRoleMember =
                              new IncidentEpisodeRoleMember();
                            episodeRoleMember.projectId = projectId;
                            episodeRoleMember.incidentEpisodeId = episodeId;
                            episodeRoleMember.incidentRoleId = primaryRole.id!;
                            episodeRoleMember.userId = currentUserId;

                            await ModelAPI.create({
                              model: episodeRoleMember,
                              modelType: IncidentEpisodeRoleMember,
                            });
                          } catch {
                            // Continue even if assignment fails
                          }
                        }
                      }
                    } catch {
                      // Continue even if fetching primary roles fails
                    }
                  }
                }

                Navigation.navigate(
                  RouteUtil.populateRouteParams(
                    RouteUtil.populateRouteParams(
                      RouteMap[PageMap.INCIDENT_EPISODE_VIEW] as Route,
                      {
                        modelId: createdItem._id,
                      },
                    ),
                  ),
                );
              }}
              submitButtonText={"Create Episode"}
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

export default EpisodeCreate;
