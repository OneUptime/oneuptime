import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import OneUptimeDate from "Common/Types/Date";
import Recurring from "Common/Types/Events/Recurring";
import StatusPageReportPeriodType from "Common/Types/StatusPage/StatusPageReportPeriodType";
import RecurringFieldElement from "Common/UI/Components/Events/RecurringFieldElement";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import Fields from "Common/UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import TimezoneUtil from "Common/UI/Utils/Timezone";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import {
  getReportPeriodDates,
  getReportScheduleFacts,
  REPORT_PERIOD_TYPE_OPTIONS,
  REPORT_SCHEDULE_PREVIEW_TEST_ID,
  ReportScheduleColumns,
  ReportScheduleFacts,
  StatusPageReportsCopy,
} from "./StatusPageReportsCopy";

/*
 * The "Report Schedule" dialog behind Edit Schedule on a status page's
 * Email Reports card: one short page, not the three steps it was. How often
 * and the first report's date are open; the report timezone and what each
 * report covers - set once, if ever - are folded under More fields, whose
 * header lists them and says what they are set to.
 *
 * Under the first report's date, the next report and the dates it covers
 * are worked out as the form changes, the same way the server works them
 * out on save, so what is on screen before Save is what the email will be.
 *
 * The dialog is only offered while reports are on: switching them off is
 * the card's switch, which needs no schedule at all.
 */

// Folded: rarely changed, and the schedule works without touching them.
const MORE_FIELDS: FormFieldCollapsibleSection<StatusPage> =
  getAdvancedFormSection<StatusPage>();

// The report columns the form holds right now.
const fromFormValues: (values: FormValues<StatusPage>) => ReportScheduleColumns =
  (values: FormValues<StatusPage>): ReportScheduleColumns => {
    const formValues: Record<string, unknown> = (values || {}) as Record<
      string,
      unknown
    >;

    return {
      reportRecurringInterval: formValues[
        "reportRecurringInterval"
      ] as ReportScheduleColumns["reportRecurringInterval"],
      reportStartDateTime: formValues["reportStartDateTime"] as
        | Date
        | string
        | undefined,
      reportTimezone: formValues["reportTimezone"] as string | undefined,
      reportPeriodType: formValues["reportPeriodType"] as string | undefined,
      reportDataInDays: formValues["reportDataInDays"] as
        | number
        | string
        | undefined,
    };
  };

export interface ReportSchedulePreviewProps {
  columns: ReportScheduleColumns;
}

/*
 * The next report and what it covers, for a schedule being filled in: "Next
 * report: Sun, Nov 1, 2026, 09:00 UTC", "Covering Oct 1, 2026 - Oct 31,
 * 2026", and the timezone both are read in.
 */
export const ReportSchedulePreview: FunctionComponent<
  ReportSchedulePreviewProps
> = (props: ReportSchedulePreviewProps): ReactElement => {
  const translator: Translator = useTranslator();
  const facts: ReportScheduleFacts = getReportScheduleFacts({
    columns: props.columns,
    isDraft: true,
  });

  return (
    <div
      className="mt-3 space-y-1 rounded-md border border-gray-200 bg-gray-50 p-4"
      data-testid={REPORT_SCHEDULE_PREVIEW_TEST_ID}
      aria-live="polite"
    >
      <p className="text-sm font-medium text-gray-900">
        {facts.nextSendAt
          ? translator.translateTemplate(StatusPageReportsCopy.previewNextReport, {
              date: OneUptimeDate.getDateAsFormattedStringInTimezone({
                date: facts.nextSendAt,
                timezone: facts.timezone,
                showWeekday: true,
              }),
            })
          : translator.translateText(StatusPageReportsCopy.previewNoSchedule)}
      </p>
      {facts.period ? (
        <p className="text-sm text-gray-700">
          {translator.translateTemplate(StatusPageReportsCopy.covering, {
            dates: getReportPeriodDates(facts.period),
          })}
        </p>
      ) : (
        <></>
      )}
      <p className="text-xs text-gray-500">
        {translator.translateTemplate(StatusPageReportsCopy.previewTimezone, {
          timezone: facts.timezone.toString(),
        })}
      </p>
    </div>
  );
};

/*
 * The dialog's fields: how often and the first report's date, then the
 * timezone, the reporting period and - for a rolling one - its days, folded
 * under More fields. Three rows on screen, so one page
 * (LongFormStepsGuard).
 */
export const getReportScheduleFormFields: () => Fields<StatusPage> =
  (): Fields<StatusPage> => {
    return [
      {
        field: {
          reportRecurringInterval: true,
        },
        title: "How often",
        description:
          "How often a report goes out, such as every month or every 2 weeks.",
        fieldType: FormFieldSchemaType.CustomComponent,
        required: true,
        getCustomElement: (
          values: FormValues<StatusPage>,
          customElementProps: CustomElementProps,
        ): ReactElement => {
          return (
            <RecurringFieldElement
              {...customElementProps}
              initialValue={values.reportRecurringInterval as Recurring}
            />
          );
        },
      },
      {
        field: {
          reportStartDateTime: true,
        },
        title: "First report on",
        description:
          "Later reports follow it at the same time of day. Pick the 1st of a month to send on the 1st of every month.",
        fieldType: FormFieldSchemaType.DateTime,
        required: true,
        getFooterElement: (values: FormValues<StatusPage>): ReactElement => {
          return <ReportSchedulePreview columns={fromFormValues(values)} />;
        },
      },
      {
        field: {
          reportTimezone: true,
        },
        title: "Report Timezone",
        description:
          "A monthly report in this timezone runs from the 1st at 00:00 to the last day at 23:59. Defaults to UTC.",
        fieldType: FormFieldSchemaType.Dropdown,
        dropdownOptions: TimezoneUtil.getTimezoneDropdownOptions(),
        required: true,
        placeholder: "Select Timezone",
        collapsibleSection: MORE_FIELDS,
      },
      {
        field: {
          reportPeriodType: true,
        },
        title: "Reporting period",
        description:
          "A calendar period is the last whole period before the email goes out, sized by how often you send - a monthly report covers Jul 1 to Jul 31. A rolling period always ends the moment the email is sent.",
        fieldType: FormFieldSchemaType.Dropdown,
        dropdownOptions: REPORT_PERIOD_TYPE_OPTIONS.map(
          (option: {
            value: StatusPageReportPeriodType;
            label: string;
          }): { value: StatusPageReportPeriodType; label: string } => {
            return { value: option.value, label: option.label };
          },
        ),
        required: true,
        placeholder: "Select Reporting Period",
        collapsibleSection: MORE_FIELDS,
      },
      {
        field: {
          reportDataInDays: true,
        },
        title: "How many days of data should the report cover?",
        description:
          "Counted back from the moment the report is sent. Consecutive reports overlap when this is longer than the send frequency, and leave gaps when it is shorter.",
        fieldType: FormFieldSchemaType.Number,
        required: true,
        validation: {
          minValue: 1,
          maxValue: 3650,
        },
        showIf: (values: FormValues<StatusPage>): boolean => {
          return (
            values.reportPeriodType !==
            StatusPageReportPeriodType.PreviousCalendarPeriod
          );
        },
        collapsibleSection: MORE_FIELDS,
      },
    ];
  };
