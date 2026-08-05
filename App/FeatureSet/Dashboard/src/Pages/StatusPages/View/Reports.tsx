import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import RecurringFieldElement from "Common/UI/Components/Events/RecurringFieldElement";
import Recurring from "Common/Types/Events/Recurring";
import FieldType from "Common/UI/Components/Types/FieldType";
import RecurringViewElement from "Common/UI/Components/Events/RecurringViewElement";
import OneUptimeDate from "Common/Types/Date";
import Card from "Common/UI/Components/Card/Card";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import URL from "Common/Types/API/URL";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import Email from "Common/Types/Email";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/UI/Utils/API/API";
import { STATUS_PAGE_API_URL } from "Common/UI/Config";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import StatusPageReportPeriodType from "Common/Types/StatusPage/StatusPageReportPeriodType";
import StatusPageReportPeriodUtil, {
  StatusPageReportPeriod,
} from "Common/Utils/StatusPage/ReportPeriod";
import Timezone from "Common/Types/Timezone";
import TimezoneUtil from "Common/UI/Utils/Timezone";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";

export interface TestEmailObject {
  email: Email;
}

/*
 * The settings that decide what a report covers and when it goes out, pulled
 * out of either a saved StatusPage or the half-filled edit form.
 */
interface ReportSettings {
  reportPeriodType?: StatusPageReportPeriodType | undefined;
  reportRecurringInterval?: Recurring | undefined;
  reportDataInDays?: number | undefined;
  reportTimezone?: Timezone | undefined;
  reportStartDateTime?: Date | undefined;
  sendNextReportBy?: Date | undefined;
}

type ToDateFunction = (value: unknown) => Date | undefined;

const toDate: ToDateFunction = (value: unknown): Date | undefined => {
  if (!value) {
    return undefined;
  }

  try {
    return OneUptimeDate.fromString(value as string | Date);
  } catch {
    // A date picker mid-edit can hold something unparseable. Nothing to preview.
    return undefined;
  }
};

type ToRecurringFunction = (value: unknown) => Recurring | undefined;

const toRecurring: ToRecurringFunction = (
  value: unknown,
): Recurring | undefined => {
  if (!value) {
    return undefined;
  }

  try {
    return Recurring.fromJSON(value as JSONObject | Recurring);
  } catch {
    return undefined;
  }
};

type ToNumberFunction = (value: unknown) => number | undefined;

const toNumber: ToNumberFunction = (value: unknown): number | undefined => {
  const numberValue: number = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
};

type FromFormValuesFunction = (
  values: FormValues<StatusPage>,
) => ReportSettings;

const fromFormValues: FromFormValuesFunction = (
  values: FormValues<StatusPage>,
): ReportSettings => {
  return {
    reportPeriodType: values.reportPeriodType as StatusPageReportPeriodType,
    reportRecurringInterval: toRecurring(values.reportRecurringInterval),
    reportDataInDays: toNumber(values.reportDataInDays),
    reportTimezone: values.reportTimezone as Timezone,
    reportStartDateTime: toDate(values.reportStartDateTime),
  };
};

/*
 * Exactly what the next report will contain and when it will land, resolved
 * with the same util the worker uses so the preview cannot disagree with the
 * email. Rendered live under the period field while editing, and above the card
 * for the saved configuration - "no surprises" only works if the answer is on
 * screen before Save is pressed.
 */
const ReportPeriodPreview: FunctionComponent<ReportSettings> = (
  props: ReportSettings,
): ReactElement => {
  const timezone: Timezone =
    props.reportTimezone || StatusPageReportPeriodUtil.DEFAULT_TIMEZONE;

  /*
   * Prefer the send time the server already computed. While editing there isn't
   * one yet, so it is derived from the start date the same way onBeforeUpdate
   * will derive it on save.
   */
  let nextSendAt: Date | undefined = props.sendNextReportBy;

  if (
    !nextSendAt &&
    props.reportStartDateTime &&
    props.reportRecurringInterval
  ) {
    nextSendAt = Recurring.getNextDateAfter({
      startDate: props.reportStartDateTime,
      recurring: props.reportRecurringInterval,
      afterDate: OneUptimeDate.getCurrentDate(),
      timezone: timezone,
    });
  }

  const period: StatusPageReportPeriod =
    StatusPageReportPeriodUtil.getReportPeriod({
      periodType: props.reportPeriodType,
      reportRecurringInterval: props.reportRecurringInterval,
      reportDataInDays: props.reportDataInDays,
      timezone: timezone,
      // The window a calendar report covers depends on when it is sent.
      sentAt: nextSendAt,
    });

  type RowFunction = (label: string, value: string) => ReactElement;

  const row: RowFunction = (label: string, value: string): ReactElement => {
    return (
      <div className="flex flex-col sm:flex-row sm:space-x-2">
        <span className="text-sm font-medium text-gray-500 sm:w-32 shrink-0">
          {label}
        </span>
        <span className="text-sm text-gray-900">{value}</span>
      </div>
    );
  };

  return (
    <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-4 space-y-2">
      {row(
        "Next report",
        nextSendAt
          ? OneUptimeDate.getDateAsFormattedStringInTimezone({
              date: nextSendAt,
              timezone: timezone,
              showWeekday: true,
            })
          : "Set a first report date to schedule one.",
      )}
      {row("Covering", `${period.periodName} (${period.reportDates})`)}
      <p className="text-xs text-gray-500">
        Times and period boundaries are resolved in {timezone.toString()}.
      </p>
    </div>
  );
};

const StatusPageReports: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [showModal, setShowModal] = useState<boolean>(false);
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [statusPage, setStatusPage] = useState<StatusPage | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [showErrorModal, setShowErrorModal] = useState<boolean>(false);

  type SendTestEmailReportFunction = (
    testEmail: TestEmailObject,
  ) => Promise<void>;

  const setTestEmailReport: SendTestEmailReportFunction = async (
    testEmail: TestEmailObject,
  ): Promise<void> => {
    try {
      setIsLoading(true);

      // get status page id by hostname.
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(STATUS_PAGE_API_URL.toString()).addRoute(
            `/test-email-report`,
          ),
          data: {
            statusPageId: modelId.toString(),
            email: testEmail.email.toString(),
          },
          headers: {},
        });

      if (response instanceof HTTPErrorResponse) {
        setError(API.getFriendlyMessage(response));
        setShowErrorModal(true);
        return;
      }

      setError("Test email report sent successfully.");
      setShowErrorModal(true);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setShowErrorModal(true);
    }

    setShowModal(false);
    setIsLoading(false);
  };

  const periodTypeOptions: Array<DropdownOption> = [
    {
      value: StatusPageReportPeriodType.PreviousCalendarPeriod,
      label: "The previous whole calendar period",
    },
    {
      value: StatusPageReportPeriodType.Rolling,
      label: "A rolling number of days",
    },
  ];

  return (
    <Fragment>
      {statusPage?.isReportEnabled && (
        <Card
          title="Next Report"
          description="The report your subscribers will receive next, and the period it will cover."
        >
          <ReportPeriodPreview
            reportPeriodType={statusPage.reportPeriodType}
            reportRecurringInterval={statusPage.reportRecurringInterval}
            reportDataInDays={statusPage.reportDataInDays}
            reportTimezone={statusPage.reportTimezone}
            reportStartDateTime={statusPage.reportStartDateTime}
            sendNextReportBy={statusPage.sendNextReportBy}
          />
        </Card>
      )}

      <CardModelDetail<StatusPage>
        name="Status Page > Status Page Report"
        cardProps={{
          title: "Email Reports",
          description:
            "Reports enable you to send regular updates to your subscribers by email.",
        }}
        isEditable={true}
        editButtonText="Edit Report Settings"
        onSaveSuccess={(statusPage: StatusPage) => {
          setStatusPage(statusPage);
        }}
        formFields={[
          {
            field: {
              isReportEnabled: true,
            },
            title: "Enable Sending Reports to Subscribers",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            placeholder: "Enable Status Page Reports",
          },
          {
            field: {
              reportTimezone: true,
            },
            sectionTitle: "Schedule",
            sectionDescription:
              "When reports go out. Send times and period boundaries are resolved in the timezone below, so they do not shift with the server's clock or with daylight saving.",
            title: "Report Timezone",
            description:
              "A monthly report in this timezone runs from the 1st at 00:00 to the last day at 23:59. Defaults to UTC.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: TimezoneUtil.getTimezoneDropdownOptions(),
            required: true,
            placeholder: "Select Timezone",
          },
          {
            field: {
              reportStartDateTime: true,
            },
            title: "When would you like to send the first report?",
            description:
              "Every following report is scheduled from this date by the frequency below - pick the 1st of a month to send on the 1st of every month.",
            fieldType: FormFieldSchemaType.DateTime,
            required: true,
            placeholder: "Send First Report On",
          },
          {
            field: {
              reportRecurringInterval: true,
            },
            title: "How often would you like to send reports?",
            description:
              "How often would you like to send reports? You can choose from hourly, daily, weekly, monthly, or yearly.",
            fieldType: FormFieldSchemaType.CustomComponent,
            required: true,
            getCustomElement: (
              value: FormValues<StatusPage>,
              props: CustomElementProps,
            ) => {
              return (
                <RecurringFieldElement
                  {...props}
                  initialValue={value.reportRecurringInterval as Recurring}
                />
              );
            },
          },
          {
            field: {
              reportPeriodType: true,
            },
            sectionTitle: "What the report covers",
            sectionDescription:
              "The stretch of time the uptime, downtime and incident numbers in the email are measured over.",
            title: "Reporting period",
            description:
              "A calendar period is the last whole period before the email goes out, sized by how often you send - a monthly report covers Jul 1 to Jul 31. A rolling period always ends the moment the email is sent.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: periodTypeOptions,
            required: true,
            placeholder: "Select Reporting Period",
            getFooterElement: (
              values: FormValues<StatusPage>,
            ): ReactElement => {
              return <ReportPeriodPreview {...fromFormValues(values)} />;
            },
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
            showIf: (item: FormValues<StatusPage>): boolean => {
              return (
                item.reportPeriodType !==
                StatusPageReportPeriodType.PreviousCalendarPeriod
              );
            },
          },
        ]}
        modelDetailProps={{
          selectMoreFields: {
            sendNextReportBy: true,
            reportStartDateTime: true,
            reportRecurringInterval: true,
            reportDataInDays: true,
            reportPeriodType: true,
            reportTimezone: true,
          },
          onItemLoaded: (item: StatusPage) => {
            if (!statusPage) {
              setStatusPage(item);
            }
          },
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPage,
          id: "model-detail-status-page",
          fields: [
            {
              field: {
                isReportEnabled: true,
              },
              title: "Reports Enabled for Subscribers",
              placeholder: "No",
              fieldType: FieldType.Boolean,
              description: "Subscribers will receive regular reports by email.",
            },
            {
              field: {
                reportTimezone: true,
              },
              title: "Report Timezone",
              description:
                "Send times and period boundaries are resolved in this timezone.",
              fieldType: FieldType.Text,
              placeholder: StatusPageReportPeriodUtil.DEFAULT_TIMEZONE,
            },
            {
              field: {
                reportStartDateTime: true,
              },
              title: "Send First Report On",
              description: "The date and time of the first report.",
              fieldType: FieldType.DateTime,
            },
            {
              field: {
                reportRecurringInterval: true,
              },
              title: "Report Recurring Interval",
              description: "How often the report will be sent.",
              fieldType: FieldType.Element,
              placeholder: "-",
              getElement: (item: StatusPage) => {
                return (
                  <RecurringViewElement value={item.reportRecurringInterval} />
                );
              },
            },
            {
              field: {
                reportPeriodType: true,
              },
              title: "Reporting Period",
              description: "The stretch of time each report measures.",
              fieldType: FieldType.Element,
              placeholder: "-",
              getElement: (item: StatusPage) => {
                return (
                  <p>
                    {item.reportPeriodType ===
                    StatusPageReportPeriodType.PreviousCalendarPeriod
                      ? "The previous whole calendar period"
                      : `A rolling ${item.reportDataInDays || StatusPageReportPeriodUtil.DEFAULT_REPORT_DATA_IN_DAYS} days`}
                  </p>
                );
              },
            },
          ],
          modelId: modelId,
        }}
      />

      <Card
        title={`Send Test Report`}
        description={`Send a test report to your email address to see how it looks.`}
        buttons={[
          {
            title: `Send Test Report`,
            buttonStyle: ButtonStyleType.NORMAL,
            onClick: () => {
              setShowModal(true);
            },
            icon: IconProp.Email,
          },
        ]}
      />

      {showModal ? (
        <BasicFormModal<TestEmailObject>
          description={`Which email address would you like to send the test report to?`}
          title={`Send Test Report`}
          onSubmit={async (testEmail: TestEmailObject) => {
            await setTestEmailReport(testEmail);
          }}
          isLoading={isLoading}
          onClose={() => {
            setShowModal(false);
          }}
          formProps={{
            fields: [
              {
                field: {
                  email: true,
                },
                title: "Email Address",
                fieldType: FormFieldSchemaType.Email,
                required: true,
                placeholder: "Email Address",
              },
            ],
          }}
          submitButtonText={`Send Test Report`}
        />
      ) : (
        <></>
      )}

      {showErrorModal ? (
        <ConfirmModal
          description={error}
          title={`Send Test Email Status`}
          onSubmit={() => {
            setShowErrorModal(false);
            setError("");
          }}
          submitButtonText={`Close`}
          submitButtonType={ButtonStyleType.NORMAL}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default StatusPageReports;
