import OnCallDutyPoliciesView from "../../OnCallPolicy/OnCallPolicies";
import { Black } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import { CriteriaAlert } from "Common/Types/Monitor/CriteriaAlert";
import ObjectID from "Common/Types/ObjectID";
import Detail from "Common/UI/Components/Detail/Detail";
import Pill from "Common/UI/Components/Pill/Pill";
import LabelsElement from "Common/UI/Components/Label/Labels";
import { PeopleList } from "Common/UI/Components/PeoplePicker/PeopleList";
import {
  getPeoplePickerOptionsFromModels,
  pickModelsByIds,
} from "Common/UI/Components/PeoplePicker/PeoplePickerKinds";
import { PeoplePickerKind } from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import FieldType from "Common/UI/Components/Types/FieldType";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Label from "Common/Models/DatabaseModels/Label";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  alert: CriteriaAlert;
  alertSeverityOptions: Array<AlertSeverity>;
  onCallPolicyOptions: Array<OnCallDutyPolicy>;
  labelOptions: Array<Label>;
  teamOptions: Array<Team>;
  userOptions: Array<User>;
}

const MonitorCriteriaAlertForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="mt-4 bg-gray-50 rounded rounded-xl p-5 border border-2 border-gray-100">
      <Detail<CriteriaAlert>
        id={"monitor-criteria-instance"}
        item={props.alert as any}
        showDetailsInNumberOfColumns={1}
        fields={[
          {
            key: "title",
            title: "Alert Title",
            fieldType: FieldType.Text,
            placeholder: "No data entered",
          },
          {
            key: "description",
            title: "Alert Description",
            fieldType: FieldType.Markdown,
            placeholder: "No alert description entered",
          },
          {
            key: "remediationNotes",
            title: "Remediation Notes",
            fieldType: FieldType.Markdown,
            placeholder: "No remediation notes entered",
          },
          {
            key: "alertSeverityId",
            title: "Alert Severity",
            fieldType: FieldType.Dropdown,
            placeholder: "No data entered",
            getElement: (item: CriteriaAlert): ReactElement => {
              if (item["alertSeverityId"]) {
                return (
                  <Pill
                    isMinimal={true}
                    color={
                      (props.alertSeverityOptions.find(
                        (option: AlertSeverity) => {
                          return (
                            option.id?.toString() ===
                            item["alertSeverityId"]!.toString()
                          );
                        },
                      )?.color as Color) || Black
                    }
                    text={
                      (props.alertSeverityOptions.find(
                        (option: AlertSeverity) => {
                          return (
                            option.id?.toString() ===
                            item["alertSeverityId"]!.toString()
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
            key: "autoResolveAlert",
            title: "Auto Resolve Alert",
            description:
              "Automatically resolve this alert when this criteria is no longer met.",
            fieldType: FieldType.Boolean,
            placeholder: "No",
          },
          {
            key: "onCallPolicyIds",
            title: "On-Call Policies",
            description:
              "These are the on-call policies that will be executed when this alert is created.",
            fieldType: FieldType.Element,
            getElement: (item: CriteriaAlert): ReactElement => {
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
            key: "ownerUserIds",
            title: "Owners",
            description:
              "People and teams who will own this alert when it is created.",
            fieldType: FieldType.Element,
            getElement: (item: CriteriaAlert): ReactElement => {
              return (
                <PeopleList
                  noneText="No owners assigned"
                  options={getPeoplePickerOptionsFromModels([
                    {
                      kind: PeoplePickerKind.User,
                      models: pickModelsByIds(
                        props.userOptions,
                        item["ownerUserIds"],
                      ),
                    },
                    {
                      kind: PeoplePickerKind.Team,
                      models: pickModelsByIds(
                        props.teamOptions,
                        item["ownerTeamIds"],
                      ),
                    },
                  ])}
                />
              );
            },
          },
          {
            key: "labelIds",
            title: "Labels",
            description: "Labels that will be applied to this alert.",
            fieldType: FieldType.Element,
            getElement: (item: CriteriaAlert): ReactElement => {
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
        ]}
      />
    </div>
  );
};

export default MonitorCriteriaAlertForm;
