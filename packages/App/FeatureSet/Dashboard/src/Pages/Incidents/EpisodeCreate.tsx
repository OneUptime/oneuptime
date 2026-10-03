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
  useRef,
} from "react";
import ModelForm, { FormType } from "Common/UI/Components/Forms/ModelForm";
import Navigation from "Common/UI/Utils/Navigation";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Card from "Common/UI/Components/Card/Card";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import ProjectUtil from "Common/UI/Utils/Project";
import Label from "Common/Models/DatabaseModels/Label";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import FetchLabels from "../../Components/Label/FetchLabels";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import FetchOnCallDutyPolicies from "../../Components/OnCallPolicy/FetchOnCallPolicies";
import FetchIncidentState from "../../Components/IncidentState/FetchIncidentState";
import FetchIncidentSeverities from "../../Components/IncidentSeverity/FetchIncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IncidentEpisodeRoleFormField, {
  RoleAssignment,
} from "../../Components/IncidentEpisode/IncidentEpisodeRoleFormField";
import FetchIncidentRoleAssignments from "../../Components/IncidentRole/FetchIncidentRoleAssignments";
import {
  CustomElementProps,
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import IncidentEpisodeRoleMember from "Common/Models/DatabaseModels/IncidentEpisodeRoleMember";
import IncidentRole from "Common/Models/DatabaseModels/IncidentRole";
import UserUtil from "Common/UI/Utils/User";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * Creating an episode asks for its title, severity and description. The
 * state it starts in and its labels are folded under one "Advanced" header
 * at the end of Episode Details: it says "Configured" when one of them holds
 * something, and opens by itself when one fails validation.
 */
const advancedSection: FormFieldCollapsibleSection<IncidentEpisode> =
  getAdvancedFormSection<IncidentEpisode>();

const EpisodeCreate: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const roleAssignmentsRef: React.MutableRefObject<Array<RoleAssignment>> =
    useRef<Array<RoleAssignment>>([]);

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
          <ModelForm<IncidentEpisode>
            modelType={IncidentEpisode}
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
                  sort: {
                    order: SortOrder.Ascending,
                  },
                },
                required: false,
                placeholder: "Incident Severity",
                getSummaryElement: (item: FormValues<IncidentEpisode>) => {
                  if (!item.incidentSeverity) {
                    return (
                      <p>
                        {translator.translateText(
                          "No incident severity selected.",
                        )}
                      </p>
                    );
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
              /*
               * Left empty, the episode starts in the project's starting
               * state, which is what the server picks when it is not sent.
               */
              {
                field: {
                  currentIncidentState: true,
                },
                title: "Initial State",
                stepId: "episode-details",
                description:
                  "Leave empty for the usual starting state. Pick a later state to record an episode that is already acknowledged or resolved.",
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownModal: {
                  type: IncidentState,
                  labelField: "name",
                  valueField: "_id",
                  sort: {
                    order: SortOrder.Ascending,
                  },
                },
                required: false,
                placeholder: "Select Initial State",
                collapsibleSection: advancedSection,
                getSummaryElement: (item: FormValues<IncidentEpisode>) => {
                  if (!item.currentIncidentState) {
                    return (
                      <p>
                        {translator.translateText("The usual starting state.")}
                      </p>
                    );
                  }

                  return (
                    <FetchIncidentState
                      incidentStateId={
                        new ObjectID(item.currentIncidentState.toString())
                      }
                    />
                  );
                },
              },
              {
                field: {
                  labels: true,
                },

                title: "Labels ",
                stepId: "episode-details",
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
                collapsibleSection: advancedSection,
                getSummaryElement: (item: FormValues<IncidentEpisode>) => {
                  if (!item.labels || !Array.isArray(item.labels)) {
                    return (
                      <p>{translator.translateText("No labels assigned.")}</p>
                    );
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
                      labelIds.push(new ObjectID(label._id?.toString() || ""));
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
                        {translator.translateText(
                          "No on-call policies will be executed when this episode is created.",
                        )}
                      </p>
                    );
                  }

                  const onCallDutyPolicyIds: Array<ObjectID> = [];

                  for (const onCallDutyPolicy of item.onCallDutyPolicies) {
                    if (typeof onCallDutyPolicy === "string") {
                      onCallDutyPolicyIds.push(new ObjectID(onCallDutyPolicy));
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
                overrideField: {
                  episodeRoles: true,
                },
                showEvenIfPermissionDoesNotExist: true,
                title: "Assign Episode Roles",
                stepId: "on-call",
                description:
                  "Who takes each role on this episode, and on every incident in it. You take any role marked Primary that you leave empty.",
                fieldType: FormFieldSchemaType.CustomComponent,
                required: false,
                // Writes only the roles someone fills in.
                customElementCanBeSkipped: true,
                overrideFieldKey: "episodeRoles",
                getCustomElement: (
                  _value: FormValues<IncidentEpisode>,
                  props: CustomElementProps,
                ) => {
                  return (
                    <IncidentEpisodeRoleFormField
                      initialValue={roleAssignmentsRef.current}
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
                  // Nobody picked: the person creating it takes the primary roles.
                  if (roleAssignmentsRef.current.length === 0) {
                    return (
                      <p>
                        {translator.translateText(
                          "Nobody picked. You take any role marked Primary.",
                        )}
                      </p>
                    );
                  }
                  return (
                    <FetchIncidentRoleAssignments
                      assignments={roleAssignmentsRef.current}
                    />
                  );
                },
              },
            ]}
            steps={[
              {
                title: "Episode Details",
                id: "episode-details",
              },
              // Who is paged and who takes which role, on one step.
              {
                title: "On-Call & Roles",
                id: "on-call",
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
        </div>
      </Card>
    </Fragment>
  );
};

export default EpisodeCreate;
