import OnCallDutyPoliciesView from "../../OnCallPolicy/OnCallPolicies";
import { Black } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import { CriteriaAlert } from "Common/Types/Monitor/CriteriaAlert";
import ObjectID from "Common/Types/ObjectID";
import Detail from "Common/UI/Components/Detail/Detail";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  alert: CriteriaAlert;
  alertSeverityOptions: Array<AlertSeverity>;
  onCallPolicyOptions: Array<OnCallDutyPolicy>;
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
        ]}
      />
    </div>
  );
};

export default MonitorCriteriaAlertForm;
