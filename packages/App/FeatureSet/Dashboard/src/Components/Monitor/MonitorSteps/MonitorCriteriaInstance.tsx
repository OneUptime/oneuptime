import CriteriaFilters from "./CriteriaFilters";
import MonitorCriteriaIncidents from "./MonitorCriteriaIncidents";
import { Black } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import IconProp from "Common/Types/Icon/IconProp";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import { CriteriaFilter } from "Common/Types/Monitor/CriteriaFilter";
import MonitorType from "Common/Types/Monitor/MonitorType";
import HorizontalRule from "Common/UI/Components/HorizontalRule/HorizontalRule";
import Icon from "Common/UI/Components/Icon/Icon";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import { isRecordNameAsWritten } from "Common/Utils/DefaultRecordNames";
import { StateListType } from "Common/Utils/StateOrder";
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
import { isFilterConditionNeeded } from "Common/Types/Filter/FilterConditionUtil";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import {
  translatableTerm,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import OneUptimeDate from "Common/Types/Date";
import { describeWorkingHours } from "../../OnCallRule/WorkingHoursText";
import { RECOVER_WHEN_TITLE } from "../../Form/Monitor/CriteriaRecoveryAndActiveHours";

/*
 * How a criteria's filters combine, said once above them (#8533): one whole
 * sentence each way, as "All of these can match" misstated All.
 */
export const ALL_FILTERS_SENTENCE: string = translationKey(
  "All of these must match for this criteria to be met:",
);
export const ANY_FILTERS_SENTENCE: string = translationKey(
  "Any of these can match for this criteria to be met:",
);

// And when it recovers, said the same way (#10355).
export const RECOVERS_WHEN_ALL_SENTENCE: string = translationKey(
  "Once its filters stop matching, this criteria stays in effect until all of these match:",
);
export const RECOVERS_WHEN_ANY_SENTENCE: string = translationKey(
  "Once its filters stop matching, this criteria stays in effect until any of these matches:",
);
export const ACTIVE_HOURS_TITLE: string = translationKey("Active Hours");

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
  monitorType?: MonitorType | undefined;
}

const MonitorCriteriaInstanceElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const filters: Array<CriteriaFilter> =
    props.monitorCriteriaInstance.data?.filters || [];
  // As the evaluator reads a criteria saved without one.
  const filterCondition: FilterCondition =
    props.monitorCriteriaInstance.data?.filterCondition || FilterCondition.All;
  // An Incoming Email criteria that opens an incident for every email.
  const isOpenForEveryEmail: boolean =
    MonitorCriteriaInstance.isOpenForEveryEmail({
      monitorType: props.monitorType,
      criteriaInstance: props.monitorCriteriaInstance,
    });
  // Its recovery condition, when it has one of its own (#10355).
  const recoveryFilters: Array<CriteriaFilter> =
    props.monitorCriteriaInstance.data?.recoveryFilters || [];
  const recoveryFilterCondition: FilterCondition =
    props.monitorCriteriaInstance.data?.recoveryFilterCondition ||
    FilterCondition.All;
  // The days and times it is judged in, in a few words, or null.
  const activeHours: string | null = MonitorCriteriaInstance.hasActiveHours(
    props.monitorCriteriaInstance.data,
  )
    ? describeWorkingHours(
        {
          workingHours: props.monitorCriteriaInstance.data?.activeHours,
          workingHoursTimezone:
            props.monitorCriteriaInstance.data?.activeHoursTimezone,
        },
        {
          translator: translator,
          use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
        },
      )
    : null;
  // The status the criteria changes the monitor to.
  const monitorStatus: MonitorStatus | undefined =
    props.monitorStatusOptions.find((option: MonitorStatus) => {
      return (
        option.id?.toString() ===
        props.monitorCriteriaInstance.data?.monitorStatusId?.toString()
      );
    });

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
          {/*
           * All or Any is named only once there are two filters to combine
           * (isFilterConditionNeeded): one filter is simply the filter, and
           * no filter is no sentence at all. A criteria saved without a
           * condition is evaluated as All, so that is what it says.
           */}
          <div
            className="ml-1 -mt-0.5 flex-auto py-0.5 text-sm leading-5 text-gray-500"
            data-testid="monitor-criteria-filters-heading"
          >
            {isFilterConditionNeeded(filters) ? (
              <>
                <span className="font-medium text-gray-900">
                  {translator.translateTemplate("Filters ({{condition}})", {
                    condition: translatableTerm(filterCondition),
                  })}
                </span>{" "}
                {/*
                 * Said once, here, for the whole list: each filter's line
                 * below ends where its sentence does (#8533). All must
                 * match; Any is met by one.
                 */}
                {translator.translateText(
                  filterCondition === FilterCondition.Any
                    ? ANY_FILTERS_SENTENCE
                    : ALL_FILTERS_SENTENCE,
                )}
              </>
            ) : (
              <>
                <span className="font-medium text-gray-900">
                  {translator.translateText("Filters")}
                </span>
                {filters.length === 1 && (
                  <>
                    {" "}
                    {translator.translateText(
                      "This criteria is met when this filter matches:",
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>

        <CriteriaFilters
          criteriaFilters={filters}
          monitorType={props.monitorType}
        />
      </div>

      {/*
       * When it recovers, when that is not simply its filters no longer
       * matching (#10355): its recovery filters, said as its filters are.
       */}
      {recoveryFilters.length > 0 && (
        <div className="mt-4" data-testid="monitor-criteria-recovery-heading">
          <div className="flex">
            <Icon icon={IconProp.Refresh} className="h-5 w-5 text-gray-900" />
            <div className="ml-1 -mt-0.5 flex-auto py-0.5 text-sm leading-5 text-gray-500">
              <span className="font-medium text-gray-900">
                {translator.translateText(RECOVER_WHEN_TITLE)}
              </span>{" "}
              {translator.translateText(
                isFilterConditionNeeded(recoveryFilters) &&
                  recoveryFilterCondition === FilterCondition.Any
                  ? RECOVERS_WHEN_ANY_SENTENCE
                  : RECOVERS_WHEN_ALL_SENTENCE,
              )}
            </div>
          </div>

          <CriteriaFilters
            criteriaFilters={recoveryFilters}
            monitorType={props.monitorType}
          />
        </div>
      )}

      {/* When it is judged at all: "Mon–Fri 08:00–18:00 (Europe/Oslo)". */}
      {activeHours && (
        <div className="mt-4" data-testid="monitor-criteria-active-hours-line">
          <div className="flex">
            <Icon icon={IconProp.Clock} className="h-5 w-5 text-gray-900" />
            <div className="ml-1 -mt-0.5 flex-auto py-0.5 text-sm leading-5 text-gray-500">
              <span className="font-medium text-gray-900">
                {translator.translateText(ACTIVE_HOURS_TITLE)}
              </span>{" "}
              {activeHours}
            </div>
          </div>
        </div>
      )}

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
                  color={(monitorStatus?.color as Color) || Black}
                  shouldAnimate={false}
                  text={(monitorStatus?.name as string) || ""}
                  isUserContent={isRecordNameAsWritten(
                    StateListType.MonitorStatus,
                    monitorStatus?.name,
                  )}
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
                  template={
                    isOpenForEveryEmail
                      ? "{{action}} for every email that meets this criteria. These are the incident details:"
                      : "{{action}} when this criteria is met. These are the incident details:"
                  }
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
                  template={
                    isOpenForEveryEmail
                      ? "{{action}} for every email that meets this criteria. These are the alert details:"
                      : "{{action}} when this criteria is met. These are the alert details:"
                  }
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
