import CriteriaFilters from "./CriteriaFilters";
import MonitorCriteriaIncidents from "./MonitorCriteriaIncidents";
import { Black } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import IconProp from "Common/Types/Icon/IconProp";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import HorizontalRule from "Common/UI/Components/HorizontalRule/HorizontalRule";
import Icon from "Common/UI/Components/Icon/Icon";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Label from "Common/Models/DatabaseModels/Label";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import IncidentRole from "Common/Models/DatabaseModels/IncidentRole";
import React, { FunctionComponent, ReactElement } from "react";
import MonitorCriteriaAlerts from "./MonitorCriteriaAlerts";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import {
  translatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

export interface ComponentProps {
  monitorStatusOptions: Array<MonitorStatus>;
  incidentSeverityOptions: Array<IncidentSeverity>;
  alertSeverityOptions: Array<AlertSeverity>;
  isLastCriteria: boolean;
  monitorCriteriaInstance: MonitorCriteriaInstance;
  onCallPolicyOptions: Array<OnCallDutyPolicy>;
  labelOptions: Array<Label>;
  teamOptions: Array<Team>;
  userOptions: Array<User>;
  incidentRoleOptions: Array<IncidentRole>;
}

const MonitorCriteriaInstanceElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  return (
    <div className="mb-4">
      {props.monitorCriteriaInstance.data?.description && (
        <div className="-mt-8">
          {props.monitorCriteriaInstance.data?.description}
        </div>
      )}

      <div className="mt-4">
        <div className="flex">
          <Icon icon={IconProp.Filter} className="h-5 w-5 text-gray-900" />
          <div className="ml-1 -mt-0.5 flex-auto py-0.5 text-sm leading-5 text-gray-500">
            <span className="font-medium text-gray-900">
              {translator.translateTemplate("Filters ({{condition}})", {
                condition: translatableTerm(
                  props.monitorCriteriaInstance.data?.filterCondition || "",
                ),
              })}
            </span>{" "}
            {translator.translateTemplate(
              "{{condition}} of these can match for this criteria to be met:",
              {
                condition: translatableTerm(
                  props.monitorCriteriaInstance.data?.filterCondition || "",
                ),
              },
            )}
          </div>
        </div>

        <CriteriaFilters
          criteriaFilters={props.monitorCriteriaInstance?.data?.filters || []}
          filterCondition={
            props.monitorCriteriaInstance?.data?.filterCondition ||
            FilterCondition.Any
          }
        />
      </div>

      {props.monitorCriteriaInstance.data?.monitorStatusId && (
        <div className="mt-4">
          <div className="flex">
            <Icon icon={IconProp.AltGlobe} className="h-5 w-5 text-gray-900" />
            <div className="ml-1 -mt-0.5 flex-auto py-0.5 text-sm leading-5 text-gray-500">
              <TranslatedSentence
                template="{{action}} when this criteria is met. Change monitor status to:"
                slots={{
                  action: (
                    <span className="font-medium text-gray-900">
                      {translator.translateText("Change Monitor Status")}
                    </span>
                  ),
                }}
              />
              <div className="mt-3">
                <Statusbubble
                  color={
                    (props.monitorStatusOptions.find(
                      (option: IncidentSeverity) => {
                        return (
                          option.id?.toString() ===
                          props.monitorCriteriaInstance.data?.monitorStatusId?.toString()
                        );
                      },
                    )?.color as Color) || Black
                  }
                  shouldAnimate={false}
                  text={
                    (props.monitorStatusOptions.find(
                      (option: IncidentSeverity) => {
                        return (
                          option.id?.toString() ===
                          props.monitorCriteriaInstance.data?.monitorStatusId?.toString()
                        );
                      },
                    )?.name as string) || ""
                  }
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {(props.monitorCriteriaInstance?.data?.incidents?.length || 0) > 0 &&
        props.monitorCriteriaInstance.data?.createIncidents && (
          <div className="mt-4">
            <div className="flex">
              <Icon icon={IconProp.Alert} className="h-5 w-5 text-gray-900" />
              <div className="ml-1 flex-auto py-0.5 text-sm leading-5 text-gray-500">
                <TranslatedSentence
                  template="{{action}} when this criteria is met. These are the incident details:"
                  slots={{
                    action: (
                      <span className="font-medium text-gray-900">
                        {translator.translateText("Create incident")}
                      </span>
                    ),
                  }}
                />{" "}
              </div>
            </div>
            <MonitorCriteriaIncidents
              incidents={props.monitorCriteriaInstance?.data?.incidents || []}
              onCallPolicyOptions={props.onCallPolicyOptions}
              incidentSeverityOptions={props.incidentSeverityOptions}
              labelOptions={props.labelOptions}
              teamOptions={props.teamOptions}
              userOptions={props.userOptions}
              incidentRoleOptions={props.incidentRoleOptions}
            />
          </div>
        )}

      {(props.monitorCriteriaInstance?.data?.alerts?.length || 0) > 0 &&
        props.monitorCriteriaInstance.data?.createAlerts && (
          <div className="mt-4">
            <div className="flex">
              <Icon
                icon={IconProp.ExclaimationCircle}
                className="h-5 w-5 text-gray-900"
              />
              <div className="ml-1 flex-auto py-0.5 text-sm leading-5 text-gray-500">
                <TranslatedSentence
                  template="{{action}} when this criteria is met. These are the alert details:"
                  slots={{
                    action: (
                      <span className="font-medium text-gray-900">
                        {translator.translateText("Create alert")}
                      </span>
                    ),
                  }}
                />{" "}
              </div>
            </div>
            <MonitorCriteriaAlerts
              alerts={props.monitorCriteriaInstance?.data?.alerts || []}
              onCallPolicyOptions={props.onCallPolicyOptions}
              alertSeverityOptions={props.alertSeverityOptions}
              labelOptions={props.labelOptions}
              teamOptions={props.teamOptions}
              userOptions={props.userOptions}
            />
          </div>
        )}

      <div className="mt-10">{!props.isLastCriteria && <HorizontalRule />}</div>
    </div>
  );
};

export default MonitorCriteriaInstanceElement;
