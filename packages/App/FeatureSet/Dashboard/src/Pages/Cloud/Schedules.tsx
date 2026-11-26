import PageComponentProps from "../PageComponentProps";
import CloudOffHoursPreviewModal from "../../Components/Cloud/Savings/CloudOffHoursPreviewModal";
import CloudAccount from "Common/Models/DatabaseModels/CloudAccount";
import CloudOffHoursSchedule from "Common/Models/DatabaseModels/CloudOffHoursSchedule";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  CLOUD_OFF_HOURS_DEFAULT_DAYS,
  CLOUD_OFF_HOURS_DEFAULT_START,
  CLOUD_OFF_HOURS_DEFAULT_STOP,
  CLOUD_OFF_HOURS_DEFAULT_TIMEZONE,
  CLOUD_OFF_HOURS_WEEK,
  readCloudOffHoursClock,
  readCloudOffHoursDays,
} from "Common/Types/Cloud/CloudOffHours";
import OneUptimeDate from "Common/Types/Date";
import DayOfWeek from "Common/Types/Day/DayOfWeek";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ActionButtonPlacement } from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import { drawsItsOwnLines } from "Common/UI/Components/Table/ColumnLineText";
import FieldType from "Common/UI/Components/Types/FieldType";
import TimezoneUtil from "Common/UI/Utils/Timezone";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { writeStandAloneDayName } from "Common/Types/DateLanguage";
import { WORKING_HOURS_DAY_SHORT_NAMES } from "../../Components/OnCallRule/WorkingHoursText";

/*
 * Cloud > Schedules (#11010): stop non-production instances and databases
 * outside working hours, and start them again - the saving is the hours
 * they no longer run.
 *
 * A schedule picks its resources by a cloud tag of the team's own
 * (Schedule = office-hours), in one account or all of them, and says the
 * days and hours they run, in a time zone. It stops what it picks when
 * working hours end and starts again only what it stopped when they begin
 * (CloudOffHoursScheduler). It never stops production, or a resource whose
 * environment nothing says: See Resources lists what it picks and why it
 * leaves any running. Each stop and start goes through the account's cloud
 * connection, so only where its Savings actions setting is on.
 */

export const SCHEDULES_TITLE: string = translationKey("Off-Hours Schedules");
export const SCHEDULES_DESCRIPTION: string = translationKey(
  "Stop non-production instances and databases outside working hours, and start them again. Production is never stopped.",
);
export const SCHEDULES_EMPTY: string = translationKey(
  "No off-hours schedules yet. Create one to stop development and test resources at night and on weekends.",
);
export const ALL_ACCOUNTS: string = translationKey("All accounts");
export const SEE_RESOURCES: string = translationKey("See Resources");
export const TAG_PICKS: string = translationKey("Tagged {{tag}}");
export const RUNNING_UNTIL: string = translationKey("Running until {{time}}");
export const STOPPED_UNTIL: string = translationKey("Stopped until {{time}}");
export const NOT_RUN_YET: string = translationKey("Not run yet");
export const RUNNING: string = translationKey("Running");
export const STOPPED: string = translationKey("Stopped");
export const HOURS_SAVED: PluralTemplate = {
  one: "{{count}} hour stopped",
  other: "{{count}} hours stopped",
};
export const LEFT_RUNNING: PluralTemplate = {
  one: "{{count}} left running",
  other: "{{count}} left running",
};
export const CLOCK_PROBLEM: string = translationKey(
  "Write the time on a 24-hour clock, such as 08:00 or 19:00.",
);
export const SAME_TIMES_PROBLEM: string = translationKey(
  "Resources must stop at a different time than they start.",
);

// "Mon–Fri": the days resources run, as few words as they take.
export function getWorkingDaysText(
  days: Array<DayOfWeek>,
  translator: Translator,
): string {
  const ordered: Array<DayOfWeek> = CLOUD_OFF_HOURS_WEEK.filter(
    (day: DayOfWeek): boolean => {
      return days.includes(day);
    },
  );
  // A day's short name standing alone, as the reader's language writes it.
  const short: (day: DayOfWeek) => string = (day: DayOfWeek): string => {
    return writeStandAloneDayName({
      name:
        translator.translateText(
          WORKING_HOURS_DAY_SHORT_NAMES[CLOUD_OFF_HOURS_WEEK.indexOf(day)] ||
            day,
        ) || day,
      language: translator.language,
      context: "standAlone",
    });
  };
  const first: number = CLOUD_OFF_HOURS_WEEK.indexOf(ordered[0]!);
  const isRun: boolean =
    ordered.length > 2 &&
    ordered.every((day: DayOfWeek, index: number): boolean => {
      return CLOUD_OFF_HOURS_WEEK.indexOf(day) === first + index;
    });

  if (isRun) {
    return `${short(ordered[0]!)}–${short(ordered[ordered.length - 1]!)}`;
  }

  return ordered.map(short).join(", ");
}

// A time field's problem as the form shows it, or null when it reads.
export function getClockProblem(
  value: unknown,
  translator: Translator,
): string | null {
  return readCloudOffHoursClock(value) === null
    ? translator.translateText(CLOCK_PROBLEM) || CLOCK_PROBLEM
    : null;
}

const CloudSchedules: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [previewing, setPreviewing] = useState<ObjectID | null>(null);
  const moreFields: FormFieldCollapsibleSection<CloudOffHoursSchedule> =
    getAdvancedFormSection<CloudOffHoursSchedule>();

  return (
    <>
      {previewing ? (
        <CloudOffHoursPreviewModal
          scheduleId={previewing}
          onClose={() => {
            setPreviewing(null);
          }}
        />
      ) : (
        <></>
      )}
      <ModelTable<CloudOffHoursSchedule>
        modelType={CloudOffHoursSchedule}
        id="cloud-off-hours-schedules"
        userPreferencesKey="cloud-off-hours-schedules"
        name="Cloud > Schedules"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        showRefreshButton={true}
        rowSwitch={{ column: "isEnabled" }}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        cardProps={{
          title: SCHEDULES_TITLE,
          description: SCHEDULES_DESCRIPTION,
        }}
        noItemsMessage={SCHEDULES_EMPTY}
        createInitialValues={{
          tagKey: "Schedule",
          tagValue: "office-hours",
          workingDays: [...CLOUD_OFF_HOURS_DEFAULT_DAYS],
          startTime: CLOUD_OFF_HOURS_DEFAULT_START,
          stopTime: CLOUD_OFF_HOURS_DEFAULT_STOP,
          timezone: OneUptimeDate.getCurrentTimezone().toString(),
          stopsInstances: true,
          stopsDatabases: true,
          isEnabled: true,
        }}
        selectMoreFields={{
          description: true,
          tagKey: true,
          tagValue: true,
          workingDays: true,
          startTime: true,
          stopTime: true,
          timezone: true,
          lastRunSummary: true,
          lastRunAt: true,
          cloudAccountId: true,
        }}
        filters={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: { cloudAccount: { name: true } },
            title: "Account",
            type: FieldType.Entity,
            filterEntityType: CloudAccount,
            filterDropdownField: { label: "name", value: "_id" },
          },
        ]}
        actionButtons={[
          {
            title: SEE_RESOURCES,
            icon: IconProp.List,
            buttonStyleType: ButtonStyleType.NORMAL,
            placement: ActionButtonPlacement.Primary,
            onClick: (
              item: CloudOffHoursSchedule,
              onCompleteAction: VoidFunction,
            ) => {
              if (item._id) {
                setPreviewing(new ObjectID(item._id.toString()));
              }
              onCompleteAction();
            },
          },
        ]}
        columns={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Element,
            isNotCustomizable: true,
            wrapContent: true,
            getLineText: drawsItsOwnLines,
            getElement: (item: CloudOffHoursSchedule): ReactElement => {
              return (
                <div className="min-w-0">
                  <bdi className="break-words text-sm font-medium text-gray-900">
                    {item.name || ""}
                  </bdi>
                  <div className="mt-0.5 break-all text-xs text-gray-500">
                    <bdi>
                      {translator.translateTemplate(TAG_PICKS, {
                        tag: `${item.tagKey || ""} = ${item.tagValue || ""}`,
                      })}
                    </bdi>
                  </div>
                </div>
              );
            },
          },
          {
            field: { cloudAccount: { name: true } },
            title: "Account",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: CloudOffHoursSchedule): ReactElement => {
              return (
                <span className="text-sm text-gray-700">
                  {item.cloudAccount?.name ||
                    translator.translateText(ALL_ACCOUNTS)}
                </span>
              );
            },
          },
          {
            field: { startTime: true },
            title: "Working Hours",
            type: FieldType.Element,
            getElement: (item: CloudOffHoursSchedule): ReactElement => {
              return (
                <div className="text-sm text-gray-900">
                  <div className="tabular-nums">
                    {getWorkingDaysText(
                      readCloudOffHoursDays(item.workingDays),
                      translator,
                    )}{" "}
                    ·{" "}
                    <bdi>{`${item.startTime || ""}–${item.stopTime || ""}`}</bdi>
                  </div>
                  <div className="text-xs text-gray-500">
                    <bdi>
                      {item.timezone || CLOUD_OFF_HOURS_DEFAULT_TIMEZONE}
                    </bdi>
                  </div>
                </div>
              );
            },
          },
          {
            field: { lastRunSummary: true },
            title: "Now",
            type: FieldType.Element,
            getElement: (item: CloudOffHoursSchedule): ReactElement => {
              const summary: JSONObject = (item.lastRunSummary ||
                {}) as JSONObject;

              if (!item.lastRunAt) {
                return (
                  <span className="text-sm text-gray-500">
                    {translator.translateText(NOT_RUN_YET)}
                  </span>
                );
              }

              const next: string = String(summary["nextChangeAt"] || "");
              const isRunning: boolean = summary["runningNow"] === true;
              const time: string = next
                ? OneUptimeDate.getDateAsFormattedStringInTimezone({
                    date: next,
                    timezone: item.timezone || CLOUD_OFF_HOURS_DEFAULT_TIMEZONE,
                    showWeekday: true,
                    hideYear: true,
                  })
                : "";
              const state: string = isRunning ? RUNNING : STOPPED;
              // Translated here, every branch, so the pill draws it as written.
              const words: string = next
                ? translator.translateTemplate(
                    isRunning ? RUNNING_UNTIL : STOPPED_UNTIL,
                    { time },
                  )
                : translator.translateText(state) || state;

              return (
                <div className="min-w-0">
                  <Pill
                    text={words}
                    isUserContent={true}
                    tone={isRunning ? PillTone.Success : PillTone.Paused}
                  />
                </div>
              );
            },
          },
          {
            field: { lastRunAt: true },
            title: "This Month",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: CloudOffHoursSchedule): ReactElement => {
              const summary: JSONObject = (item.lastRunSummary ||
                {}) as JSONObject;
              const hours: number = Math.round(
                Number(summary["hoursThisMonth"]) || 0,
              );
              const left: number =
                (Number(summary["skippedProduction"]) || 0) +
                (Number(summary["skippedNotKnown"]) || 0) +
                (Number(summary["skippedNoAccess"]) || 0);

              return (
                <div className="text-sm">
                  <div className="tabular-nums text-gray-900">
                    {translator.translatePlural(HOURS_SAVED, hours)}
                  </div>
                  {left > 0 ? (
                    <div className="text-xs text-amber-700">
                      {translator.translatePlural(LEFT_RUNNING, left)}
                    </div>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
        ]}
        /*
         * Two steps: which resources it stops (a tag, and an account), and
         * when they run. The name comes first, a description and which kinds
         * it stops wait under More fields.
         */
        formSteps={[
          { title: "Resources", id: "resources" },
          { title: "Working Hours", id: "hours" },
        ]}
        formFields={[
          {
            field: { name: true },
            title: "Name",
            stepId: "resources",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Development, office hours",
            validation: { minLength: 2 },
          },
          {
            field: { tagKey: true },
            title: "Tag Key",
            stepId: "resources",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Schedule",
            description:
              "The cloud tag that picks the resources to stop. Only those known not to be production are stopped.",
          },
          {
            field: { tagValue: true },
            title: "Tag Value",
            stepId: "resources",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "office-hours",
          },
          {
            field: { cloudAccount: true },
            title: "Account",
            stepId: "resources",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: CloudAccount,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "All accounts",
            description:
              "Leave empty to stop tagged resources in every account.",
          },
          {
            field: { stopsInstances: true },
            title: "Stop Instances",
            stepId: "resources",
            collapsibleSection: moreFields,
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            defaultValue: true,
            description:
              "Stops EC2 instances, Azure VMs and Compute Engine instances.",
          },
          {
            field: { stopsDatabases: true },
            title: "Stop Databases",
            stepId: "resources",
            collapsibleSection: moreFields,
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            defaultValue: true,
            description:
              "Stops Amazon RDS databases. AWS starts a database stopped for seven days.",
          },
          {
            field: { description: true },
            title: "Description",
            stepId: "resources",
            collapsibleSection: moreFields,
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "What this schedule is for.",
          },
          {
            field: { workingDays: true },
            title: "Working Days",
            stepId: "hours",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownOptions: CLOUD_OFF_HOURS_WEEK.map(
              (day: DayOfWeek): { label: string; value: string } => {
                return { label: day, value: day };
              },
            ),
            required: true,
            description:
              "The days resources run. On the others they stay stopped all day.",
          },
          {
            field: { startTime: true },
            title: "Start Time",
            stepId: "hours",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "08:00",
            description:
              "When resources start on a working day, on a 24-hour clock.",
            customValidation: (
              values: FormValues<CloudOffHoursSchedule>,
            ): string | null => {
              return getClockProblem(values.startTime, translator);
            },
          },
          {
            field: { stopTime: true },
            title: "Stop Time",
            stepId: "hours",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "19:00",
            description:
              "When resources stop. A time before the start runs overnight.",
            customValidation: (
              values: FormValues<CloudOffHoursSchedule>,
            ): string | null => {
              const problem: string | null = getClockProblem(
                values.stopTime,
                translator,
              );

              if (problem) {
                return problem;
              }

              return readCloudOffHoursClock(values.stopTime) ===
                readCloudOffHoursClock(values.startTime)
                ? translator.translateText(SAME_TIMES_PROBLEM) ||
                    SAME_TIMES_PROBLEM
                : null;
            },
          },
          {
            field: { timezone: true },
            title: "Time Zone",
            stepId: "hours",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: TimezoneUtil.getTimezoneDropdownOptions(),
            required: true,
          },
        ]}
      />
    </>
  );
};

export default CloudSchedules;
