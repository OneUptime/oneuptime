import PageComponentProps from "../PageComponentProps";
import CloudCostReportPreviewModal from "../../Components/Cloud/Reports/CloudCostReportPreviewModal";
import CloudAccount from "Common/Models/DatabaseModels/CloudAccount";
import CloudCostGroup from "Common/Models/DatabaseModels/CloudCostGroup";
import CloudCostReport from "Common/Models/DatabaseModels/CloudCostReport";
import CloudCostView from "Common/Models/DatabaseModels/CloudCostView";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  CLOUD_COST_BASES,
  CLOUD_COST_BASIS_LABELS,
  CloudCostBasis,
} from "Common/Types/Cloud/CloudCostBasis";
import {
  CLOUD_COST_REPORT_PERIOD_LABELS,
  CLOUD_COST_REPORT_SCOPE_LABELS,
  CloudCostReportPeriod,
  CloudCostReportScope,
} from "Common/Types/Cloud/CloudCostReport";
import OneUptimeDate from "Common/Types/Date";
import EventInterval from "Common/Types/Events/EventInterval";
import Recurring from "Common/Types/Events/Recurring";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import Timezone from "Common/Types/Timezone";
import WorkspaceSummaryScheduleUtil, {
  WorkspaceSummaryScheduleWrite,
} from "Common/Utils/Workspace/WorkspaceSummarySchedule";
import { ActionButtonPlacement } from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import {
  PeoplePickerFieldConfig,
  PeoplePickerKind,
} from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import { drawsItsOwnLines } from "Common/UI/Components/Table/ColumnLineText";
import FieldType from "Common/UI/Components/Types/FieldType";
import SelectFormFields from "Common/UI/Types/SelectEntityField";
import TimezoneUtil from "Common/UI/Utils/Timezone";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * Cloud > Spend > Reports (#11009): what the clouds cost, sent weekly or
 * monthly to the people who read it rather than open a cost tool - team
 * leads, finance, whoever signs the budget.
 *
 * A report covers every account, one account, a cost group, or a cost view
 * with its groups - whose teams can each get their own section - for last
 * week, last month or the month so far, on a cost basis. It is emailed to
 * people and teams, each as they may read the costs; a Cloud admin can add
 * addresses outside the project and Slack or Microsoft Teams channels,
 * which get it as that admin may read it. It goes out on the workspace
 * summaries' schedule rules (WorkspaceSummaryScheduleUtil): every week or
 * month, the first at 09:00 next Monday (or on the 1st) in the creator's
 * time zone unless told otherwise. Preview shows what it says now; Send Me
 * a Copy emails it to the person.
 */

export const REPORTS_TITLE: string = translationKey("Cost Reports");
export const REPORTS_DESCRIPTION: string = translationKey(
  "What your clouds cost, emailed every week or month with the figures as a CSV, and posted to Slack or Microsoft Teams.",
);
export const REPORTS_EMPTY: string = translationKey(
  "No cost reports yet. Create one to send each team what its cloud spend came to.",
);
export const PREVIEW: string = translationKey("Preview");
export const EVERY_WEEK: string = translationKey("Every week");
export const EVERY_MONTH: string = translationKey("Every month");
export const NOT_SENT_YET: string = translationKey("Not sent yet");
export const SENT_ON: string = translationKey("Sent {{date}}");
export const SENT_LEFT_OUT: PluralTemplate = {
  one: "Sent {{date}}, {{count}} left out",
  other: "Sent {{date}}, {{count}} left out",
};
export const NOT_SENT: string = translationKey("Not sent");
export const NEXT_SEND: string = translationKey("Next {{date}}");
export const PROJECT_BASIS: string = translationKey("The project's cost basis");
export const FIRST_REPORT_AT: string = translationKey(
  "The first report goes out {{date}}.",
);
export const PEOPLE_COUNT: PluralTemplate = {
  one: "{{count}} person",
  other: "{{count}} people",
};
export const TEAMS_COUNT: PluralTemplate = {
  one: "{{count}} team",
  other: "{{count}} teams",
};
export const ADDRESSES_COUNT: PluralTemplate = {
  one: "{{count}} address",
  other: "{{count}} addresses",
};
export const CHANNELS_COUNT: PluralTemplate = {
  one: "{{count}} channel",
  other: "{{count}} channels",
};
export const GROUP_TEAMS: string = translationKey("each group's team");
export const NOBODY: string = translationKey("Nobody yet");
/*
 * What a report covers, with the account, cost view or cost group it
 * names: one sentence each, so a language words the scope around the name
 * as it needs ("A cost view: By team").
 */
export const SCOPE_WITH_NAME: Readonly<
  Partial<Record<CloudCostReportScope, string>>
> = {
  [CloudCostReportScope.Account]: translationKey("One account: {{name}}"),
  [CloudCostReportScope.CostGroup]: translationKey("A cost group: {{name}}"),
  [CloudCostReportScope.CostView]: translationKey("A cost view: {{name}}"),
};
export const SEND_TO_TITLE: string = translationKey("Send To");
export const SEND_TO_DESCRIPTION: string = translationKey(
  "People and teams of this project. Each gets the figures they may read.",
);
export const SEND_TO_ADD: string = translationKey("Add person or team");

// The field the Send To picker names itself by: its picks are recipientUsers and recipientTeams.
export const SEND_TO_FIELD_KEY: string = "sendTo";

// The intervals a report goes out at, as the form offers them.
const FREQUENCIES: Array<{ value: EventInterval; label: string }> = [
  { value: EventInterval.Week, label: EVERY_WEEK },
  { value: EventInterval.Month, label: EVERY_MONTH },
];

// A report's interval as the form holds it: "Week" or "Month".
export function toFrequency(value: unknown): EventInterval {
  const recurring: Recurring | undefined =
    WorkspaceSummaryScheduleUtil.toRecurring(value);

  if (recurring) {
    return recurring.intervalType === EventInterval.Month
      ? EventInterval.Month
      : EventInterval.Week;
  }

  return value === EventInterval.Month
    ? EventInterval.Month
    : EventInterval.Week;
}

// The interval a frequency is saved as: every one week or month.
export function toRecurring(frequency: unknown): Recurring {
  const recurring: Recurring = new Recurring();
  recurring.intervalType = toFrequency(frequency);
  recurring.intervalCount = new PositiveNumber(1);
  return recurring;
}

// People first, then teams, as every people picker lists them.
export function getSendToPickerConfig(): PeoplePickerFieldConfig {
  return {
    kinds: [
      { kind: PeoplePickerKind.User, valueKey: "recipientUsers" },
      { kind: PeoplePickerKind.Team, valueKey: "recipientTeams" },
    ],
    addButtonText: SEND_TO_ADD,
    searchPlaceholder: "Search people or teams...",
    emptyText: "No people or teams available.",
  };
}

// A list kept as one text in the form: "finance@example.com, cfo@example.com".
function toText(value: unknown): string {
  return Array.isArray(value) ? value.join(", ") : String(value || "");
}

function scopeOf(values: FormValues<CloudCostReport>): CloudCostReportScope {
  return (
    ((values as Record<string, unknown>)["scope"] as CloudCostReportScope) ||
    CloudCostReportScope.AllAccounts
  );
}

/*
 * When a report being created goes out first: what the server will work
 * out on save (WorkspaceSummaryScheduleUtil.getCreateWrite), in its time
 * zone - so leaving the date empty says what it means.
 */
export function getFirstReportDate(values: {
  recurringInterval?: unknown;
  sendFirstReportAt?: unknown;
  timezone?: unknown;
}): Date | undefined {
  const write: WorkspaceSummaryScheduleWrite =
    WorkspaceSummaryScheduleUtil.getCreateWrite({
      write: {
        recurringInterval: toRecurring(values.recurringInterval),
        sendFirstReportAt:
          (values.sendFirstReportAt as Date | string | undefined) || undefined,
        timezone: (values.timezone as string | undefined) || undefined,
      },
      timezone: OneUptimeDate.getCurrentTimezone(),
    });

  return write.nextSendAt;
}

function countOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

// Who a report goes to, in a line: "2 people, 1 team, 1 channel".
export function getRecipientsText(
  report: CloudCostReport,
  translator: Translator,
): string {
  const parts: Array<string> = [];
  const people: number = countOf(report.recipientUsers);
  const teams: number = countOf(report.recipientTeams);
  const addresses: number = countOf(report.emailAddresses);
  const channels: number =
    countOf(report.slackChannelNames) +
    countOf(report.microsoftTeamsChannelNames);

  if (people > 0) {
    parts.push(translator.translatePlural(PEOPLE_COUNT, people));
  }

  if (teams > 0) {
    parts.push(translator.translatePlural(TEAMS_COUNT, teams));
  }

  if (report.isSentToGroupTeams) {
    parts.push(translator.translateText(GROUP_TEAMS) || GROUP_TEAMS);
  }

  if (addresses > 0) {
    parts.push(translator.translatePlural(ADDRESSES_COUNT, addresses));
  }

  if (channels > 0) {
    parts.push(translator.translatePlural(CHANNELS_COUNT, channels));
  }

  return parts.length > 0
    ? parts.join(", ")
    : translator.translateText(NOBODY) || NOBODY;
}

// What a report covers, in a line: "A cost view: By team · Last week".
export function getCoversText(
  report: CloudCostReport,
  translator: Translator,
): string {
  const scope: CloudCostReportScope =
    report.scope || CloudCostReportScope.AllAccounts;
  const name: string =
    scope === CloudCostReportScope.Account
      ? report.cloudAccount?.name || ""
      : scope === CloudCostReportScope.CostView
        ? report.cloudCostView?.name || ""
        : scope === CloudCostReportScope.CostGroup
          ? report.cloudCostGroup?.name || ""
          : "";
  const withName: string | undefined = name
    ? SCOPE_WITH_NAME[scope]
    : undefined;
  const scopeLabel: string = withName
    ? translator.translateTemplate(withName, { name })
    : translator.translateText(CLOUD_COST_REPORT_SCOPE_LABELS[scope]) ||
      CLOUD_COST_REPORT_SCOPE_LABELS[scope];
  const periodLabel: string = report.period
    ? translator.translateText(
        CLOUD_COST_REPORT_PERIOD_LABELS[report.period],
      ) || CLOUD_COST_REPORT_PERIOD_LABELS[report.period]
    : "";

  return [scopeLabel, periodLabel]
    .filter((part: string): boolean => {
      return Boolean(part);
    })
    .join(" · ");
}

const CloudReports: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [previewing, setPreviewing] = useState<CloudCostReport | null>(null);
  const moreFields: FormFieldCollapsibleSection<CloudCostReport> =
    getAdvancedFormSection<CloudCostReport>();
  const outsideFields: FormFieldCollapsibleSection<CloudCostReport> =
    getAdvancedFormSection<CloudCostReport>({ id: "report-outside-fields" });

  const scopeOptions: Array<DropdownOption> = (
    Object.values(CloudCostReportScope) as Array<CloudCostReportScope>
  ).map((scope: CloudCostReportScope): DropdownOption => {
    return { value: scope, label: CLOUD_COST_REPORT_SCOPE_LABELS[scope] };
  });
  const periodOptions: Array<DropdownOption> = (
    Object.values(CloudCostReportPeriod) as Array<CloudCostReportPeriod>
  ).map((period: CloudCostReportPeriod): DropdownOption => {
    return { value: period, label: CLOUD_COST_REPORT_PERIOD_LABELS[period] };
  });
  const basisOptions: Array<DropdownOption> = CLOUD_COST_BASES.map(
    (basis: CloudCostBasis): DropdownOption => {
      return { value: basis, label: CLOUD_COST_BASIS_LABELS[basis] };
    },
  );

  // A form's lists and interval as the server keeps them.
  const toSaved: (values: CloudCostReport) => CloudCostReport = (
    values: CloudCostReport,
  ): CloudCostReport => {
    const data: Record<string, unknown> = values as unknown as Record<
      string,
      unknown
    >;

    if (data["recurringInterval"] !== undefined) {
      data["recurringInterval"] = toRecurring(data["recurringInterval"]);
    }

    for (const key of [
      "emailAddresses",
      "slackChannelNames",
      "microsoftTeamsChannelNames",
    ]) {
      if (typeof data[key] === "string") {
        data[key] = String(data[key])
          .split(/[\n,;]+/)
          .map((item: string): string => {
            return item.trim();
          })
          .filter((item: string): boolean => {
            return item.length > 0;
          });
      }
    }

    if (data["costBasis"] === "") {
      data["costBasis"] = null;
    }

    return values;
  };

  return (
    <>
      {previewing?._id ? (
        <CloudCostReportPreviewModal
          reportId={new ObjectID(previewing._id.toString())}
          lastSendResult={
            (previewing.lastSendResult as JSONObject) || undefined
          }
          onClose={() => {
            setPreviewing(null);
          }}
        />
      ) : (
        <></>
      )}
      <ModelTable<CloudCostReport>
        modelType={CloudCostReport}
        id="cloud-cost-reports-table"
        userPreferencesKey="cloud-cost-reports-table"
        name="Cloud > Reports"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        showRefreshButton={true}
        rowSwitch={{ column: "isEnabled" }}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        cardProps={{
          title: REPORTS_TITLE,
          description: REPORTS_DESCRIPTION,
        }}
        noItemsMessage={REPORTS_EMPTY}
        createInitialValues={{
          scope: CloudCostReportScope.AllAccounts,
          period: CloudCostReportPeriod.LastWeek,
          recurringInterval: EventInterval.Week as unknown as Recurring,
          timezone: OneUptimeDate.getCurrentTimezone() as Timezone,
          isEnabled: true,
          isSentToGroupTeams: false,
        }}
        onBeforeCreate={(values: CloudCostReport) => {
          // The time zone the form showed: the creator's own, unless changed.
          if (!values.timezone) {
            values.timezone = OneUptimeDate.getCurrentTimezone();
          }

          return Promise.resolve(toSaved(values));
        }}
        onBeforeEdit={(values: CloudCostReport) => {
          const data: Record<string, unknown> = values as unknown as Record<
            string,
            unknown
          >;

          data["recurringInterval"] = toFrequency(values.recurringInterval);

          for (const key of [
            "emailAddresses",
            "slackChannelNames",
            "microsoftTeamsChannelNames",
          ]) {
            if (Array.isArray(data[key])) {
              data[key] = toText(data[key]);
            }
          }

          return Promise.resolve(values);
        }}
        onBeforeUpdate={(values: CloudCostReport) => {
          return Promise.resolve(toSaved(values));
        }}
        selectMoreFields={{
          scope: true,
          period: true,
          costBasis: true,
          isSentToGroupTeams: true,
          recipientUsers: { _id: true },
          recipientTeams: { _id: true },
          emailAddresses: true,
          slackChannelNames: true,
          microsoftTeamsChannelNames: true,
          microsoftTeamsTeamName: true,
          recurringInterval: true,
          sendFirstReportAt: true,
          timezone: true,
          nextSendAt: true,
          lastSentAt: true,
          lastSendResult: true,
          cloudAccountId: true,
          cloudCostViewId: true,
          cloudCostGroupId: true,
          cloudAccount: { name: true },
          cloudCostView: { name: true },
          cloudCostGroup: { name: true },
        }}
        filters={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Text,
          },
        ]}
        actionButtons={[
          {
            title: PREVIEW,
            icon: IconProp.Report,
            buttonStyleType: ButtonStyleType.NORMAL,
            placement: ActionButtonPlacement.Primary,
            onClick: (
              item: CloudCostReport,
              onCompleteAction: VoidFunction,
            ) => {
              setPreviewing(item);
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
            getElement: (item: CloudCostReport): ReactElement => {
              return (
                <div className="min-w-0">
                  <bdi className="break-words text-sm font-medium text-gray-900">
                    {item.name || ""}
                  </bdi>
                  <div className="mt-0.5 break-words text-xs text-gray-500">
                    <bdi>{getCoversText(item, translator)}</bdi>
                  </div>
                </div>
              );
            },
          },
          {
            field: { recipientUsers: { _id: true } },
            title: "Send To",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: CloudCostReport): ReactElement => {
              return (
                <span className="text-sm text-gray-700">
                  {getRecipientsText(item, translator)}
                </span>
              );
            },
          },
          {
            field: { nextSendAt: true },
            title: "Schedule",
            type: FieldType.Element,
            getElement: (item: CloudCostReport): ReactElement => {
              const frequency: EventInterval = toFrequency(
                item.recurringInterval,
              );
              const timezone: string =
                item.timezone?.toString() ||
                WorkspaceSummaryScheduleUtil.DEFAULT_TIMEZONE.toString();

              return (
                <div className="text-sm text-gray-900">
                  <div>
                    {translator.translateText(
                      frequency === EventInterval.Month
                        ? EVERY_MONTH
                        : EVERY_WEEK,
                    )}
                  </div>
                  {item.nextSendAt && item.isEnabled !== false ? (
                    <div className="text-xs text-gray-500">
                      {translator.translateTemplate(NEXT_SEND, {
                        date: OneUptimeDate.getDateAsFormattedStringInTimezone({
                          date: item.nextSendAt,
                          timezone,
                          showWeekday: true,
                          hideYear: true,
                        }),
                      })}
                    </div>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
          {
            field: { lastSentAt: true },
            title: "Last Send",
            type: FieldType.Element,
            getElement: (item: CloudCostReport): ReactElement => {
              const result: JSONObject = (item.lastSendResult ||
                {}) as JSONObject;
              const left: number = Array.isArray(result["skipped"])
                ? (result["skipped"] as Array<unknown>).length
                : 0;
              const errors: number = Array.isArray(result["errors"])
                ? (result["errors"] as Array<unknown>).length
                : 0;

              if (!item.lastSendResult) {
                return (
                  <Pill
                    text={
                      translator.translateText(NOT_SENT_YET) || NOT_SENT_YET
                    }
                    isUserContent={true}
                    tone={PillTone.Neutral}
                  />
                );
              }

              if (!item.lastSentAt) {
                return (
                  <Pill
                    text={translator.translateText(NOT_SENT) || NOT_SENT}
                    isUserContent={true}
                    tone={PillTone.Danger}
                  />
                );
              }

              const date: string =
                OneUptimeDate.getDateAsFormattedStringInTimezone({
                  date: item.lastSentAt,
                  timezone:
                    item.timezone?.toString() ||
                    WorkspaceSummaryScheduleUtil.DEFAULT_TIMEZONE.toString(),
                  hideYear: true,
                });

              return (
                <Pill
                  text={
                    left + errors > 0
                      ? translator.translatePlural(
                          SENT_LEFT_OUT,
                          left + errors,
                          {
                            date,
                          },
                        )
                      : translator.translateTemplate(SENT_ON, { date })
                  }
                  isUserContent={true}
                  tone={left + errors > 0 ? PillTone.Warning : PillTone.Success}
                />
              );
            },
          },
        ]}
        /*
         * Three steps: what the report covers, who gets it, and when. The
         * cost basis, addresses outside the project and channels wait
         * under More fields.
         */
        formSteps={[
          { title: "Report", id: "report" },
          { title: "Recipients", id: "recipients" },
          { title: "Schedule", id: "schedule" },
        ]}
        formFields={[
          {
            field: { name: true },
            title: "Name",
            stepId: "report",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Weekly cloud costs by team",
            description: "The emails' subject, and how the report is listed.",
            validation: { minLength: 2 },
          },
          {
            field: { scope: true },
            title: "Covers",
            stepId: "report",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: scopeOptions,
            required: true,
            description:
              "Every account, one account, a cost group, or a cost view with all its groups.",
          },
          {
            field: { cloudAccount: true },
            title: "Account",
            stepId: "report",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: CloudAccount,
              labelField: "name",
              valueField: "_id",
            },
            showIf: (values: FormValues<CloudCostReport>): boolean => {
              return scopeOf(values) === CloudCostReportScope.Account;
            },
            required: (values: FormValues<CloudCostReport>): boolean => {
              return scopeOf(values) === CloudCostReportScope.Account;
            },
            hideColumnDescription: true,
          },
          {
            field: { cloudCostView: true },
            title: "Cost View",
            stepId: "report",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: CloudCostView,
              labelField: "name",
              valueField: "_id",
            },
            showIf: (values: FormValues<CloudCostReport>): boolean => {
              return scopeOf(values) === CloudCostReportScope.CostView;
            },
            required: (values: FormValues<CloudCostReport>): boolean => {
              return scopeOf(values) === CloudCostReportScope.CostView;
            },
            description:
              "Each of its groups is listed, with what no group takes.",
          },
          {
            field: { cloudCostGroup: true },
            title: "Cost Group",
            stepId: "report",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: CloudCostGroup,
              labelField: "name",
              valueField: "_id",
            },
            showIf: (values: FormValues<CloudCostReport>): boolean => {
              return scopeOf(values) === CloudCostReportScope.CostGroup;
            },
            required: (values: FormValues<CloudCostReport>): boolean => {
              return scopeOf(values) === CloudCostReportScope.CostGroup;
            },
            hideColumnDescription: true,
          },
          {
            field: { period: true },
            title: "Period",
            stepId: "report",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: periodOptions,
            required: true,
            description:
              "Compared with the period before: the week before, the month before, or last month by the same day.",
          },
          {
            field: { costBasis: true },
            title: "Cost Basis",
            stepId: "report",
            collapsibleSection: moreFields,
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: basisOptions,
            required: false,
            placeholder: PROJECT_BASIS,
            description:
              "Billed, amortized or net. Empty: the project's, as Costs opens on.",
          },
          {
            field: {
              [SEND_TO_FIELD_KEY]: true,
            } as unknown as SelectFormFields<CloudCostReport>,
            title: SEND_TO_TITLE,
            description: SEND_TO_DESCRIPTION,
            stepId: "recipients",
            fieldType: FormFieldSchemaType.PeoplePicker,
            peoplePicker: getSendToPickerConfig(),
            formOnly: true,
            required: false,
          },
          {
            field: { isSentToGroupTeams: true },
            title: "Send Each Group's Team Its Section",
            stepId: "recipients",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            defaultValue: false,
            showIf: (values: FormValues<CloudCostReport>): boolean => {
              return scopeOf(values) === CloudCostReportScope.CostView;
            },
            description:
              "Each group that has a team: its members get their group's figures.",
          },
          {
            field: { emailAddresses: true },
            title: "Email Addresses",
            stepId: "recipients",
            collapsibleSection: outsideFields,
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "finance@example.com, accountant@example.com",
            description:
              "Addresses outside the project, such as your accountant's. Needs Cloud Admin.",
          },
          {
            field: { slackChannelNames: true },
            title: "Slack Channels",
            stepId: "recipients",
            collapsibleSection: outsideFields,
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "#finops",
            description:
              "A short summary with a button to Costs. Needs Cloud Admin.",
          },
          {
            field: { microsoftTeamsChannelNames: true },
            title: "Microsoft Teams Channels",
            stepId: "recipients",
            collapsibleSection: outsideFields,
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "Cloud costs",
            description:
              "A short summary with a button to Costs. Needs Cloud Admin.",
          },
          {
            field: { microsoftTeamsTeamName: true },
            title: "Microsoft Teams Team",
            stepId: "recipients",
            collapsibleSection: outsideFields,
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "Engineering",
            description:
              "The team its channels are in. Empty: the connection's team.",
          },
          {
            field: { recurringInterval: true },
            title: "How Often",
            stepId: "schedule",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: FREQUENCIES.map(
              (frequency: { value: EventInterval; label: string }) => {
                return { value: frequency.value, label: frequency.label };
              },
            ),
            required: true,
            description:
              "On the same day of the week, or of the month, at the same time.",
          },
          {
            field: { sendFirstReportAt: true },
            title: "Send First Report At",
            stepId: "schedule",
            fieldType: FormFieldSchemaType.DateTime,
            required: false,
            description:
              "Later reports keep its day and time. Empty: 09:00 next Monday, or on the 1st.",
            getFooterElement: (
              values: FormValues<CloudCostReport>,
            ): ReactElement => {
              if ((values as Record<string, unknown>)["_id"]) {
                return <></>;
              }

              const first: Date | undefined = getFirstReportDate(
                values as Record<string, unknown>,
              );

              return first ? (
                <p
                  className="mt-1 text-xs text-gray-500"
                  data-testid="cloud-cost-report-first-send"
                >
                  {translator.translateTemplate(FIRST_REPORT_AT, {
                    date: OneUptimeDate.getDateAsFormattedStringInTimezone({
                      date: first,
                      timezone:
                        ((values as Record<string, unknown>)[
                          "timezone"
                        ] as string) || OneUptimeDate.getCurrentTimezone(),
                      showWeekday: true,
                    }),
                  })}
                </p>
              ) : (
                <></>
              );
            },
          },
          {
            field: { timezone: true },
            title: "Time Zone",
            stepId: "schedule",
            collapsibleSection: moreFields,
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: TimezoneUtil.getTimezoneDropdownOptions(),
            required: false,
            description:
              "Reports go out at the same time of day here all year. Starts on yours.",
          },
        ]}
      />
    </>
  );
};

export default CloudReports;
