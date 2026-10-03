import MonitorCriteriaInstanceElement from "./MonitorCriteriaInstance";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Label from "Common/Models/DatabaseModels/Label";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import IncidentRole from "Common/Models/DatabaseModels/IncidentRole";
import React, { FunctionComponent, ReactElement } from "react";
import {
  translatableTerm,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

/*
 * The order a criteria is checked in, as the word the sentence uses. A
 * translation key each, so a locale words its own ordinals; past the
 * twentieth the sentence names the position as a number instead.
 */
const CRITERIA_ORDINALS: Array<string> = [
  translationKey("first"),
  translationKey("second"),
  translationKey("third"),
  translationKey("fourth"),
  translationKey("fifth"),
  translationKey("sixth"),
  translationKey("seventh"),
  translationKey("eighth"),
  translationKey("ninth"),
  translationKey("tenth"),
  translationKey("eleventh"),
  translationKey("twelfth"),
  translationKey("thirteenth"),
  translationKey("fourteenth"),
  translationKey("fifteenth"),
  translationKey("sixteenth"),
  translationKey("seventeenth"),
  translationKey("eighteenth"),
  translationKey("nineteenth"),
  translationKey("twentieth"),
];

export interface ComponentProps {
  monitorCriteria: MonitorCriteria;
  monitorStatusOptions: Array<MonitorStatus>;
  incidentSeverityOptions: Array<IncidentSeverity>;
  alertSeverityOptions: Array<IncidentSeverity>;
  onCallPolicyOptions: Array<OnCallDutyPolicy>;
  labelOptions: Array<Label>;
  teamOptions: Array<Team>;
  userOptions: Array<User>;
  incidentRoleOptions: Array<IncidentRole>;
}

const MonitorCriteriaElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  return (
    <div className="mt-4">
      <ul role="list" className="space-y-6">
        {props.monitorCriteria.data?.monitorCriteriaInstanceArray.map(
          (i: MonitorCriteriaInstance, index: number) => {
            const isCriteriaDisabled: boolean = i.data?.isEnabled === false;
            return (
              <li className="relative flex gap-x-4" key={index}>
                <div className="absolute left-0 top-0 flex w-6 justify-center -bottom-6">
                  <div className="w-px bg-slate-200"></div>
                </div>
                <div className="relative flex h-6 w-6 flex-none items-center justify-center bg-white">
                  <div className="h-1.5 w-1.5 rounded-full bg-slate-100 ring-1 ring-slate-300"></div>
                </div>

                <div className="flex-auto py-0.5 text-sm leading-5 text-gray-500">
                  <span
                    className={`font-medium ${
                      isCriteriaDisabled ? "text-gray-500" : "text-gray-900"
                    }`}
                  >
                    {i.data?.name || translator.translateText("Criteria")}
                  </span>{" "}
                  {isCriteriaDisabled && (
                    <span className="ml-1 text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-600 font-medium">
                      {translator.translateText("Disabled")}</span>
                  )}{" "}
                  {isCriteriaDisabled
                    ? translator.translateText(
                        "This criteria is disabled and will not be evaluated.",
                      )
                    : CRITERIA_ORDINALS[index]
                      ? translator.translateTemplate(
                          "This criteria will be checked {{ordinal}}.",
                          {
                            ordinal: translatableTerm(CRITERIA_ORDINALS[index]!),
                          },
                        )
                      : translator.translateTemplate(
                          "This criteria will be checked at position {{position}}.",
                          { position: index + 1 },
                        )}
                  <div className="mt-10 mb-10" key={index}>
                    <MonitorCriteriaInstanceElement
                      monitorStatusOptions={props.monitorStatusOptions}
                      onCallPolicyOptions={props.onCallPolicyOptions}
                      incidentSeverityOptions={props.incidentSeverityOptions}
                      alertSeverityOptions={props.alertSeverityOptions}
                      labelOptions={props.labelOptions}
                      teamOptions={props.teamOptions}
                      userOptions={props.userOptions}
                      incidentRoleOptions={props.incidentRoleOptions}
                      monitorCriteriaInstance={i}
                      isLastCriteria={
                        index ===
                        (props.monitorCriteria.data
                          ?.monitorCriteriaInstanceArray.length || 1) -
                          1
                      }
                    />
                  </div>
                </div>
              </li>
            );
          },
        )}
      </ul>
    </div>
  );
};

export default MonitorCriteriaElement;
