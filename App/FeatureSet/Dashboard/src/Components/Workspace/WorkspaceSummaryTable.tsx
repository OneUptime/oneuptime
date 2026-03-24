import ProjectUtil from "Common/UI/Utils/Project";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
} from "react";
import WorkspaceType, {
  getWorkspaceTypeDisplayName,
} from "Common/Types/Workspace/WorkspaceType";
import WorkspaceNotificationSummary from "Common/Models/DatabaseModels/WorkspaceNotificationSummary";
import WorkspaceNotificationSummaryType from "Common/Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryType";
import WorkspaceNotificationSummaryItem from "Common/Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryItem";
import API from "Common/Utils/API";
import Exception from "Common/Types/Exception/Exception";
import { ErrorFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import EmptyResponseData from "Common/Types/API/EmptyResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import URL from "Common/Types/API/URL";
import { APP_API_URL } from "Common/UI/Config";
import { ShowAs } from "Common/UI/Components/ModelTable/BaseModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import RecurringFieldElement from "Common/UI/Components/Events/RecurringFieldElement";
import RecurringViewElement from "Common/UI/Components/Events/RecurringViewElement";
import Recurring from "Common/Types/Events/Recurring";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import OneUptimeDate from "Common/Types/Date";

export interface ComponentProps {
  workspaceType: WorkspaceType;
  summaryType: WorkspaceNotificationSummaryType;
}

const WorkspaceSummaryTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [showTestModal, setShowTestModal] = React.useState<boolean>(false);
  const [isTestLoading, setIsTestLoading] = React.useState<boolean>(false);
  const [testError, setTestError] = React.useState<string | undefined>(
    undefined,
  );
  const [testSummary, setTestSummary] = React.useState<
    WorkspaceNotificationSummary | undefined
  >(undefined);
  const [showTestSuccessModal, setShowTestSuccessModal] =
    React.useState<boolean>(false);

  type TestSummaryFunction = (summaryId: ObjectID) => Promise<void>;

  const testSummaryFn: TestSummaryFunction = async (
    summaryId: ObjectID,
  ): Promise<void> => {
    try {
      setIsTestLoading(true);
      setTestError(undefined);

      const response: HTTPResponse<EmptyResponseData> | HTTPErrorResponse =
        await API.get({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            `/workspace-notification-summary/test/${summaryId.toString()}`,
          ),
          data: {},
        });

      if (response.isSuccess()) {
        setIsTestLoading(false);
        setShowTestModal(false);
        setShowTestSuccessModal(true);
      }

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      setIsTestLoading(false);
    } catch (err) {
      setTestError(API.getFriendlyErrorMessage(err as Exception));
      setIsTestLoading(false);
    }
  };

  const allSummaryItems: Array<WorkspaceNotificationSummaryItem> =
    Object.values(WorkspaceNotificationSummaryItem);

  const typeLabel: string = props.summaryType;

  return (
    <Fragment>
      <ModelTable<WorkspaceNotificationSummary>
        modelType={WorkspaceNotificationSummary}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          summaryType: props.summaryType,
          workspaceType: props.workspaceType,
        }}
        userPreferencesKey={`workspace-summary-table-${props.summaryType}-${props.workspaceType}`}
        actionButtons={[
          {
            title: "Send Test Now",
            buttonStyleType: ButtonStyleType.OUTLINE,
            icon: IconProp.Play,
            onClick: async (
              item: WorkspaceNotificationSummary,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                setTestSummary(item);
                setShowTestModal(true);
                onCompleteAction();
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
        ]}
        singularName={`${typeLabel} Summary`}
        pluralName={`${typeLabel} Summaries`}
        id={`workspace-summary-table-${props.summaryType}`}
        name={`${typeLabel} Workspace Summaries`}
        isDeleteable={true}
        isEditable={true}
        createEditModalWidth={ModalWidth.Large}
        isCreateable={true}
        cardProps={{
          title: `${typeLabel} Summary - ${getWorkspaceTypeDisplayName(props.workspaceType)}`,
          description: `Set up recurring ${typeLabel.toLowerCase()} summary reports posted to ${getWorkspaceTypeDisplayName(props.workspaceType)}. Each summary includes stats like total count, MTTA/MTTR, severity breakdown, and a list of ${typeLabel.toLowerCase()}s with links.`,
        }}
        showAs={ShowAs.List}
        noItemsMessage={`No ${typeLabel.toLowerCase()} summary rules configured yet. Create one to start receiving periodic reports.`}
        onBeforeCreate={(values: WorkspaceNotificationSummary) => {
          values.summaryType = props.summaryType;
          values.projectId = ProjectUtil.getCurrentProjectId()!;
          values.workspaceType = props.workspaceType;

          // Set nextSendAt: use sendFirstReportAt if provided, otherwise compute from interval
          if (values.sendFirstReportAt) {
            values.nextSendAt = values.sendFirstReportAt;
          } else if (values.recurringInterval) {
            const recurring: Recurring = Recurring.fromJSON(
              values.recurringInterval,
            );
            values.nextSendAt = Recurring.getNextDateInterval(
              OneUptimeDate.getCurrentDate(),
              recurring,
            );
          }

          // Parse channel names from comma-separated string
          if (
            values.channelNames &&
            typeof values.channelNames === "string"
          ) {
            values.channelNames = (values.channelNames as unknown as string)
              .split(",")
              .map((name: string) => {
                return name.trim();
              })
              .filter((name: string) => {
                return name.length > 0;
              });
          }

          // Default to all summary items if none selected
          if (!values.summaryItems || (Array.isArray(values.summaryItems) && values.summaryItems.length === 0)) {
            values.summaryItems = allSummaryItems;
          }

          if (values.isEnabled === undefined || values.isEnabled === null) {
            values.isEnabled = true;
          }

          return Promise.resolve(values);
        }}
        onBeforeEdit={(values: WorkspaceNotificationSummary) => {
          // Parse channel names from comma-separated string
          if (
            values.channelNames &&
            typeof values.channelNames === "string"
          ) {
            values.channelNames = (values.channelNames as unknown as string)
              .split(",")
              .map((name: string) => {
                return name.trim();
              })
              .filter((name: string) => {
                return name.length > 0;
              });
          }

          // If sendFirstReportAt was changed and is in the future, use it as nextSendAt.
          // Otherwise leave nextSendAt alone — the worker manages it after the first send.
          if (values.sendFirstReportAt) {
            const firstReportDate: Date = new Date(values.sendFirstReportAt as unknown as string);
            if (firstReportDate.getTime() > OneUptimeDate.getCurrentDate().getTime()) {
              values.nextSendAt = firstReportDate;
            }
          }

          return Promise.resolve(values);
        }}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Summary Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            stepId: "basic",
            placeholder: `Weekly ${typeLabel} Summary`,
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            stepId: "basic",
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: `e.g., Weekly ${typeLabel.toLowerCase()} summary for the engineering team.`,
          },
          {
            field: {
              channelNames: true,
            },
            stepId: "basic",
            title: "Channel Names",
            description: `Enter one or more ${getWorkspaceTypeDisplayName(props.workspaceType)} channel names (comma-separated) where the summary will be posted.`,
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "#incidents-summary, #engineering",
          },
          {
            field: {
              isEnabled: true,
            },
            stepId: "basic",
            title: "Enabled",
            description:
              "When enabled, the summary will be sent automatically on the configured schedule.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
          {
            field: {
              recurringInterval: true,
            },
            title: "How Often",
            description:
              "Choose how frequently this summary should be posted (e.g., every 1 day, every 1 week).",
            fieldType: FormFieldSchemaType.CustomComponent,
            required: true,
            stepId: "schedule",
            getCustomElement: (
              value: FormValues<WorkspaceNotificationSummary>,
              elementProps: CustomElementProps,
            ): ReactElement => {
              return (
                <RecurringFieldElement
                  error={elementProps.error}
                  onChange={(recurring: Recurring) => {
                    elementProps.onChange(recurring);
                  }}
                  initialValue={
                    value.recurringInterval
                      ? Recurring.fromJSON(value.recurringInterval)
                      : undefined
                  }
                />
              );
            },
          },
          {
            field: {
              sendFirstReportAt: true,
            },
            title: "Send First Report At",
            description:
              "When should the first summary report be sent? Subsequent reports will follow the recurring interval from this date. If left empty, the first report will be sent after the recurring interval from now.",
            fieldType: FormFieldSchemaType.DateTime,
            required: false,
            stepId: "schedule",
          },
          {
            field: {
              numberOfDaysOfData: true,
            },
            title: "Lookback Period (Days)",
            description:
              "How many days of data to include in each summary. For example, 7 means the summary will cover the last 7 days.",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            stepId: "schedule",
            placeholder: "7",
          },
          {
            field: {
              summaryItems: true,
            },
            title: "What to Include",
            description:
              "Choose which sections appear in the summary. The report will be formatted with headers, statistics, and a detailed list.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            required: true,
            stepId: "content",
            dropdownOptions: allSummaryItems.map(
              (item: WorkspaceNotificationSummaryItem) => {
                return {
                  label: item,
                  value: item,
                };
              },
            ),
          },
        ]}
        formSteps={[
          {
            title: "Basic Info",
            id: "basic",
          },
          {
            title: "Schedule",
            id: "schedule",
          },
          {
            title: "Content",
            id: "content",
          },
        ]}
        showRefreshButton={true}
        filters={[
          {
            field: {
              name: true,
            },
            type: FieldType.Text,
            title: "Summary Name",
          },
          {
            field: {
              isEnabled: true,
            },
            type: FieldType.Boolean,
            title: "Enabled",
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            type: FieldType.Boolean,
          },
          {
            field: {
              recurringInterval: true,
            },
            title: "Frequency",
            type: FieldType.Element,
            getElement: (
              value: WorkspaceNotificationSummary,
            ): ReactElement => {
              return (
                <RecurringViewElement
                  value={value.recurringInterval as Recurring}
                />
              );
            },
          },
          {
            field: {
              sendFirstReportAt: true,
            },
            noValueMessage: "-",
            title: "First Report",
            type: FieldType.DateTime,
          },
          {
            field: {
              numberOfDaysOfData: true,
            },
            title: "Lookback",
            type: FieldType.Element,
            getElement: (
              value: WorkspaceNotificationSummary,
            ): ReactElement => {
              return <span>{value.numberOfDaysOfData} days</span>;
            },
          },
          {
            field: {
              lastSentAt: true,
            },
            noValueMessage: "Never",
            title: "Last Sent",
            type: FieldType.DateTime,
          },
          {
            field: {
              nextSendAt: true,
            },
            noValueMessage: "-",
            title: "Next Send",
            type: FieldType.DateTime,
          },
        ]}
      />

      {showTestModal && testSummary ? (
        <ConfirmModal
          title={`Send Test Summary Now`}
          error={testError}
          description={`This will send the "${testSummary.name}" summary to ${getWorkspaceTypeDisplayName(props.workspaceType)} right now. The summary will include data from the last ${testSummary.numberOfDaysOfData || 7} days. This will not affect the regular schedule.`}
          submitButtonText={"Send Now"}
          onClose={() => {
            setShowTestModal(false);
            setTestSummary(undefined);
            setTestError(undefined);
          }}
          isLoading={isTestLoading}
          onSubmit={async () => {
            if (!testSummary.id) {
              return;
            }
            await testSummaryFn(testSummary.id!);
          }}
        />
      ) : (
        <></>
      )}

      {showTestSuccessModal ? (
        <ConfirmModal
          title={
            testError ? `Test Failed` : `Summary Sent`
          }
          error={testError}
          description={`The test summary was sent successfully. Check your ${getWorkspaceTypeDisplayName(props.workspaceType)} channel to see how it looks.`}
          submitButtonType={ButtonStyleType.NORMAL}
          submitButtonText={"Close"}
          onSubmit={async () => {
            setShowTestSuccessModal(false);
            setTestSummary(undefined);
            setShowTestModal(false);
            setTestError("");
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default WorkspaceSummaryTable;
