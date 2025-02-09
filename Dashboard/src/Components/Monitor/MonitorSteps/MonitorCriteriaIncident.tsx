import OnCallDutyPoliciesView from "../../OnCallPolicy/OnCallPolicies";
import { Black } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import { CriteriaIncident } from "Common/Types/Monitor/CriteriaIncident";
import ObjectID from "Common/Types/ObjectID";
import Detail from "Common/UI/Components/Detail/Detail";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  incident: CriteriaIncident;
  incidentSeverityOptions: Array<IncidentSeverity>;
  onCallPolicyOptions: Array<OnCallDutyPolicy>;
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
        ]}
      />
    </div>
  );
};

export default MonitorCriteriaIncidentForm;
