import CriteriaFilters from "./CriteriaFilters";
import WorkingHoursPicker, {
  DEFAULT_SIMPLE_WORKING_HOURS,
} from "../../OnCallRule/WorkingHoursPicker";
import CriteriaRecoveryFilters from "../../../Utils/Form/Monitor/CriteriaRecoveryFilters";
import { JSONObject } from "Common/Types/JSON";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import { isFilterConditionNeeded } from "Common/Types/Filter/FilterConditionUtil";
import { CriteriaFilter } from "Common/Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import OneUptimeDate from "Common/Types/Date";
import RestrictionTimes from "Common/Types/OnCallDutyPolicy/RestrictionTimes";
import WorkingHours from "Common/Types/OnCallDutyPolicy/WorkingHours";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Radio from "Common/UI/Components/Radio/Radio";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import TimezoneUtil from "Common/UI/Utils/Timezone";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useId } from "react";

/*
 * WHEN A CRITERIA RECOVERS, AND WHEN IT IS JUDGED AT ALL (#10355), under a
 * criteria's Settings.
 *
 * Both are off for every criteria until someone turns them on, so the
 * simple case - a criteria that acts while its filters match - shows two
 * switches and nothing else:
 *
 *   - Recover only when a condition of its own is met: the criteria keeps
 *     acting after its filters stop matching, until its recovery filters
 *     match. They start as the opposite of its filters, for 10 minutes
 *     where the check can be watched over a window (CriteriaRecoveryFilters).
 *   - Judge this criteria only on certain days and times: the days, from
 *     when until when, and in which time zone, as an on-call rule's working
 *     hours are set (WorkingHoursPicker). The zone starts as the reader's.
 */

export const RECOVERY_TOGGLE_TITLE: string = translationKey(
  "Recover only when a condition of its own is met",
);
export const RECOVERY_TOGGLE_DESCRIPTION: string = translationKey(
  "Keeps this criteria in effect after its filters stop matching, until the filters below match.",
);
export const RECOVER_WHEN_TITLE: string = translationKey("Recover When");
export const RECOVER_WHEN_DESCRIPTION: string = translationKey(
  "The criteria stops acting once these match: response time below 300 ms for 10 minutes, say.",
);
export const ACTIVE_HOURS_TOGGLE_TITLE: string = translationKey(
  "Judge this criteria only on certain days and times",
);
export const ACTIVE_HOURS_TOGGLE_DESCRIPTION: string = translationKey(
  "Outside these hours the criteria is skipped, and what it opened resolves.",
);
export const ACTIVE_HOURS_TIMEZONE_TITLE: string = translationKey("Timezone");

export const RECOVERY_SECTION_TEST_ID: string = "monitor-criteria-recovery";
export const ACTIVE_HOURS_SECTION_TEST_ID: string =
  "monitor-criteria-active-hours";

export interface ComponentProps {
  criteriaInstance: MonitorCriteriaInstance;
  monitorType: MonitorType;
  monitorStep: MonitorStep;
  onChange: (criteriaInstance: MonitorCriteriaInstance) => void;
}

// The zones to pick from, worked out once: some six hundred of them.
let timezoneOptions: Array<DropdownOption> | null = null;

const getTimezoneOptions: () => Array<DropdownOption> =
  (): Array<DropdownOption> => {
    if (!timezoneOptions) {
      timezoneOptions = TimezoneUtil.getTimezoneDropdownOptions();
    }

    return timezoneOptions;
  };

const CriteriaRecoveryAndActiveHours: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const recoveryConditionLabelId: string = useId();

  const criteria: MonitorCriteriaInstance["data"] = props.criteriaInstance.data;

  const recoveryFilters: Array<CriteriaFilter> =
    criteria?.recoveryFilters || [];
  const hasRecoveryCondition: boolean = recoveryFilters.length > 0;
  const recoveryFilterCondition: FilterCondition =
    criteria?.recoveryFilterCondition || FilterCondition.All;

  const hasActiveHours: boolean =
    MonitorCriteriaInstance.hasActiveHours(criteria);
  const timezone: string =
    criteria?.activeHoursTimezone ||
    OneUptimeDate.getCurrentTimezone().toString();

  // All, then Any, each in the reader's language.
  const filterConditionOptions: Array<DropdownOption> =
    DropdownUtil.getDropdownOptionsFromEnum(FilterCondition).map(
      (option: DropdownOption): DropdownOption => {
        return {
          ...option,
          label: translator.translateText(option.label) || option.label,
        };
      },
    );

  // The criteria with some of its data changed, as a new copy.
  const change: (
    data: Partial<NonNullable<MonitorCriteriaInstance["data"]>>,
  ) => void = (
    data: Partial<NonNullable<MonitorCriteriaInstance["data"]>>,
  ): void => {
    const changed: MonitorCriteriaInstance = MonitorCriteriaInstance.clone(
      props.criteriaInstance,
    );

    changed.data = {
      ...changed.data!,
      ...data,
    };

    props.onChange(changed);
  };

  return (
    <>
      <div
        className="mt-6 border-t border-gray-100 pt-4"
        data-testid={RECOVERY_SECTION_TEST_ID}
      >
        <Toggle
          value={hasRecoveryCondition}
          title={RECOVERY_TOGGLE_TITLE}
          description={RECOVERY_TOGGLE_DESCRIPTION}
          onChange={(value: boolean) => {
            if (!value) {
              change({
                recoveryFilters: undefined,
                recoveryFilterCondition: undefined,
              });
              return;
            }

            change({
              recoveryFilters: CriteriaRecoveryFilters.fromFilters({
                filters: criteria?.filters || [],
                monitorType: props.monitorType,
              }),
              recoveryFilterCondition: FilterCondition.All,
            });
          }}
        />

        {hasRecoveryCondition && (
          <div className="mt-3">
            <FieldLabelElement
              title={RECOVER_WHEN_TITLE}
              description={RECOVER_WHEN_DESCRIPTION}
            />
            <CriteriaFilters
              monitorStep={props.monitorStep}
              monitorType={props.monitorType}
              value={recoveryFilters}
              filterCondition={recoveryFilterCondition}
              onChange={(value: Array<CriteriaFilter>) => {
                change({ recoveryFilters: value });
              }}
            />

            {isFilterConditionNeeded(recoveryFilters) && (
              <div
                className="mt-4"
                data-testid="monitor-criteria-recovery-filter-condition"
              >
                <FieldLabelElement
                  id={recoveryConditionLabelId}
                  title="Match Condition"
                  description="Should all filters match, or just any one of them?"
                  required={true}
                />
                <Radio
                  ariaLabelledby={recoveryConditionLabelId}
                  value={recoveryFilterCondition}
                  options={filterConditionOptions}
                  onChange={(
                    value: DropdownValue | Array<DropdownValue> | null,
                  ) => {
                    change({
                      recoveryFilterCondition: value as FilterCondition,
                    });
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div
        className="mt-6 border-t border-gray-100 pt-4"
        data-testid={ACTIVE_HOURS_SECTION_TEST_ID}
      >
        <Toggle
          value={hasActiveHours}
          title={ACTIVE_HOURS_TOGGLE_TITLE}
          description={ACTIVE_HOURS_TOGGLE_DESCRIPTION}
          onChange={(value: boolean) => {
            if (!value) {
              change({
                activeHours: undefined,
                activeHoursTimezone: undefined,
              });
              return;
            }

            change({
              activeHours: WorkingHours.fromSimpleHours({
                ...DEFAULT_SIMPLE_WORKING_HOURS,
                timezone: timezone,
              }).toJSON(),
              activeHoursTimezone: timezone,
            });
          }}
        />

        {hasActiveHours && (
          <div className="mt-3 space-y-3">
            <WorkingHoursPicker
              value={criteria?.activeHours as JSONObject | undefined}
              timezone={timezone}
              onChange={(hours: RestrictionTimes) => {
                change({
                  activeHours: hours.toJSON(),
                  activeHoursTimezone: timezone,
                });
              }}
            />

            <div>
              <FieldLabelElement title={ACTIVE_HOURS_TIMEZONE_TITLE} />
              <Dropdown
                ariaLabel={ACTIVE_HOURS_TIMEZONE_TITLE}
                options={getTimezoneOptions()}
                value={getTimezoneOptions().find(
                  (option: DropdownOption): boolean => {
                    return option.value === timezone;
                  },
                )}
                isClearable={false}
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  const toTimezone: string = value?.toString() || timezone;

                  /*
                   * The hours stay on the clock: 08:00 to 18:00 in Oslo is
                   * 08:00 to 18:00 in New York once the zone is changed.
                   */
                  const moved: RestrictionTimes | null =
                    WorkingHours.moveToTimezone({
                      hours: criteria?.activeHours,
                      fromTimezone: timezone,
                      toTimezone: toTimezone,
                    });

                  change({
                    activeHours: moved ? moved.toJSON() : criteria?.activeHours,
                    activeHoursTimezone: toTimezone,
                  });
                }}
              />
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default CriteriaRecoveryAndActiveHours;
