import OnCallDutyPoliciesView from "../../OnCallPolicy/OnCallPolicies";
import TeamsElement from "../../Team/TeamsElement";
import UsersElement from "../../User/Users";
import { Black } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import {
  CriteriaIncident,
  IncidentMemberRoleAssignment,
} from "Common/Types/Monitor/CriteriaIncident";
import ObjectID from "Common/Types/ObjectID";
import Detail from "Common/UI/Components/Detail/Detail";
import Pill from "Common/UI/Components/Pill/Pill";
import LabelsElement from "Common/UI/Components/Label/Labels";
import FieldType from "Common/UI/Components/Types/FieldType";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Label from "Common/Models/DatabaseModels/Label";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import IncidentRole from "Common/Models/DatabaseModels/IncidentRole";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  incident: CriteriaIncident;
  incidentSeverityOptions: Array<IncidentSeverity>;
  onCallPolicyOptions: Array<OnCallDutyPolicy>;
  labelOptions: Array<Label>;
  teamOptions: Array<Team>;
  userOptions: Array<User>;
  incidentRoleOptions: Array<IncidentRole>;
}

const MonitorCriteriaIncidentForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="mt-4 bg-gray-50 rounded rounded-xl p-5 border border-2 border-gray-100">
      <Detail<CriteriaIncident>
        id={"monitor-criteria-instance"}
        item={props.incident as any}
        showDetailsInNumberOfColumns={1}
        fields={[
          {
            key: "title",
            title: "Incident Title",
            fieldType: FieldType.Text,
            placeholder: "No data entered",
          },
          {
            key: "description",
            title: "Incident Description",
            fieldType: FieldType.Markdown,
            placeholder: "No incident description entered",
          },
          {
            key: "remediationNotes",
            title: "Remediation Notes",
            fieldType: FieldType.Markdown,
            placeholder: "No remediation notes entered",
          },
          {
            key: "incidentSeverityId",
            title: "Incident Severity",
            fieldType: FieldType.Dropdown,
            placeholder: "No data entered",
            getElement: (item: CriteriaIncident): ReactElement => {
              if (item["incidentSeverityId"]) {
                return (
                  <Pill
                    isMinimal={true}
                    color={
                      (props.incidentSeverityOptions.find(
                        (option: IncidentSeverity) => {
                          return (
                            option.id?.toString() ===
                            item["incidentSeverityId"]!.toString()
                          );
                        },
                      )?.color as Color) || Black
                    }
                    text={
                      (props.incidentSeverityOptions.find(
                        (option: IncidentSeverity) => {
                          return (
                            option.id?.toString() ===
                            item["incidentSeverityId"]!.toString()
                          );
                        },
                      )?.name as string) || ""
                    }
                  />
                );
              }

              return <></>;
            },
          },
          {
            key: "autoResolveIncident",
            title: "Auto Resolve Incident",
            description:
              "Automatically resolve this incident when this criteria is no longer met.",
            fieldType: FieldType.Boolean,
            placeholder: "No",
          },
          {
            key: "onCallPolicyIds",
            title: "On-Call Policies",
            description:
              "These are the on-call policies that will be executed when this incident is created.",
            fieldType: FieldType.Element,
            getElement: (item: CriteriaIncident): ReactElement => {
              return (
                <OnCallDutyPoliciesView
                  onCallPolicies={props.onCallPolicyOptions.filter(
                    (policy: OnCallDutyPolicy) => {
                      return (
                        (item["onCallPolicyIds"] as Array<ObjectID>) || []
                      )
                        .map((id: ObjectID) => {
                          return id.toString();
                        })
                        .includes(policy.id?.toString() || "");
                    },
                  )}
                />
              );
            },
          },
          {
            key: "ownerTeamIds",
            title: "Owner Teams",
            description:
              "Teams that will own this incident when it is created.",
            fieldType: FieldType.Element,
            getElement: (item: CriteriaIncident): ReactElement => {
              const ownerTeamIds: Array<ObjectID> =
                (item["ownerTeamIds"] as Array<ObjectID>) || [];
              if (ownerTeamIds.length === 0) {
                return (
                  <span className="text-gray-400">No owner teams assigned</span>
                );
              }
              const teams: Array<Team> = props.teamOptions.filter(
                (team: Team) => {
                  return ownerTeamIds
                    .map((id: ObjectID) => {
                      return id.toString();
                    })
                    .includes(team.id?.toString() || "");
                },
              );
              return <TeamsElement teams={teams} />;
            },
          },
          {
            key: "ownerUserIds",
            title: "Owner Users",
            description:
              "Users that will own this incident when it is created.",
            fieldType: FieldType.Element,
            getElement: (item: CriteriaIncident): ReactElement => {
              const ownerUserIds: Array<ObjectID> =
                (item["ownerUserIds"] as Array<ObjectID>) || [];
              if (ownerUserIds.length === 0) {
                return (
                  <span className="text-gray-400">No owner users assigned</span>
                );
              }
              const users: Array<User> = props.userOptions.filter(
                (user: User) => {
                  return ownerUserIds
                    .map((id: ObjectID) => {
                      return id.toString();
                    })
                    .includes(user.id?.toString() || "");
                },
              );
              return <UsersElement users={users} />;
            },
          },
          {
            key: "labelIds",
            title: "Labels",
            description: "Labels that will be applied to this incident.",
            fieldType: FieldType.Element,
            getElement: (item: CriteriaIncident): ReactElement => {
              const labelIds: Array<ObjectID> =
                (item["labelIds"] as Array<ObjectID>) || [];
              if (labelIds.length === 0) {
                return (
                  <span className="text-gray-400">No labels assigned</span>
                );
              }
              const labels: Array<Label> = props.labelOptions.filter(
                (label: Label) => {
                  return labelIds
                    .map((id: ObjectID) => {
                      return id.toString();
                    })
                    .includes(label.id?.toString() || "");
                },
              );
              return <LabelsElement labels={labels} />;
            },
          },
          {
            key: "incidentMemberRoles",
            title: "Incident Roles",
            description:
              "Users assigned to incident roles when this incident is created.",
            fieldType: FieldType.Element,
            getElement: (item: CriteriaIncident): ReactElement => {
              const incidentMemberRoles: Array<IncidentMemberRoleAssignment> =
                (item[
                  "incidentMemberRoles"
                ] as Array<IncidentMemberRoleAssignment>) || [];
              if (incidentMemberRoles.length === 0) {
                return (
                  <span className="text-gray-400">
                    No incident roles assigned
                  </span>
                );
              }

              // Group assignments by role
              const roleAssignments: Map<string, Array<User>> = new Map();
              for (const assignment of incidentMemberRoles) {
                const roleId: string = assignment.roleId.toString();
                const user: User | undefined = props.userOptions.find(
                  (u: User) => {
                    return u.id?.toString() === assignment.userId.toString();
                  },
                );
                if (user) {
                  if (!roleAssignments.has(roleId)) {
                    roleAssignments.set(roleId, []);
                  }
                  roleAssignments.get(roleId)!.push(user);
                }
              }

              return (
                <div className="space-y-3">
                  {Array.from(roleAssignments.entries()).map(
                    ([roleId, users]: [string, Array<User>]) => {
                      const role: IncidentRole | undefined =
                        props.incidentRoleOptions.find((r: IncidentRole) => {
                          return r.id?.toString() === roleId;
                        });
                      return (
                        <div key={roleId}>
                          <div className="font-medium text-gray-700 mb-1">
                            {role?.name || "Unknown Role"}
                          </div>
                          <UsersElement users={users} />
                        </div>
                      );
                    },
                  )}
                </div>
              );
            },
          },
        ]}
      />
    </div>
  );
};

export default MonitorCriteriaIncidentForm;
