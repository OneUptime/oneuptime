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
            title: "Test Summary",
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
        singularName={`${props.summaryType} Summary`}
        pluralName={`${props.summaryType} Summaries`}
        id={`workspace-summary-table-${props.summaryType}`}
        name={`Settings > ${props.summaryType} Workspace Summaries`}
        isDeleteable={true}
        isEditable={true}
        createEditModalWidth={ModalWidth.Large}
        isCreateable={true}
        cardProps={{
          title: `${props.summaryType} - ${getWorkspaceTypeDisplayName(props.workspaceType)} Summary`,
          description: `Configure recurring ${props.summaryType.toLowerCase()} summary reports to be sent to ${getWorkspaceTypeDisplayName(props.workspaceType)} channels.`,
        }}
        showAs={ShowAs.List}
        noItemsMessage={"No summary rules found."}
        onBeforeCreate={(values: WorkspaceNotificationSummary) => {
          values.summaryType = props.summaryType;
          values.projectId = ProjectUtil.getCurrentProjectId()!;
          values.workspaceType = props.workspaceType;

          // Set initial nextSendAt based on recurring interval
          if (values.recurringInterval) {
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

          // Ensure summaryItems is an array
          if (!values.summaryItems) {
            values.summaryItems = allSummaryItems;
          }

          if (!values.isEnabled) {
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

          // Recalculate nextSendAt if interval changed
          if (values.recurringInterval) {
            const recurring: Recurring = Recurring.fromJSON(
              values.recurringInterval,
            );
            values.nextSendAt = Recurring.getNextDateInterval(
              OneUptimeDate.getCurrentDate(),
              recurring,
            );
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
            placeholder: "Weekly Incident Summary",
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
            placeholder:
              "Weekly summary of incidents sent to the #ops channel.",
          },
          {
            field: {
              channelNames: true,
            },
            stepId: "basic",
            title: "Channel Names",
            description:
              "Comma-separated list of channel names to post the summary to (e.g., #incidents, #ops-summary).",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "#incidents-summary",
          },
          {
            field: {
              isEnabled: true,
            },
            stepId: "basic",
            title: "Enabled",
            description: "Enable or disable this recurring summary.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
          {
            field: {
              recurringInterval: true,
            },
            title: "Recurring Interval",
            description: "How often should this summary be sent?",
            fieldType: FormFieldSchemaType.CustomComponent,
            required: true,
            stepId: "schedule",
            getCustomElement: (
              value: FormValues<WorkspaceNotificationSummary>,
              props: CustomElementProps,
            ): ReactElement => {
              return (
                <RecurringFieldElement
                  error={props.error}
                  onChange={(recurring: Recurring) => {
                    props.onChange(recurring);
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
              numberOfDaysOfData: true,
            },
            title: "Number of Days of Data",
            description:
              "How many days of historical data should be included in each summary?",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            stepId: "schedule",
            placeholder: "7",
          },
          {
            field: {
              summaryItems: true,
            },
            title: "Items to Include",
            description:
              "Select which items to include in the summary report.",
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
            title: "Basic",
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
            title: "Summary Name",
            type: FieldType.Text,
          },
          {
            field: {
              description: true,
            },
            noValueMessage: "-",
            title: "Description",
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
            title: "Recurring Interval",
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
              numberOfDaysOfData: true,
            },
            title: "Days of Data",
            type: FieldType.Number,
          },
          {
            field: {
              lastSentAt: true,
            },
            noValueMessage: "Never",
            title: "Last Sent",
            type: FieldType.DateTime,
          },
        ]}
      />

      {showTestModal && testSummary ? (
        <ConfirmModal
          title={`Test Summary`}
          error={testError}
          description={`Test the summary "${testSummary.name}" by sending it to ${getWorkspaceTypeDisplayName(props.workspaceType)} now.`}
          submitButtonText={"Send Test Summary"}
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
            testError ? `Test Failed` : `Test Summary Sent Successfully`
          }
          error={testError}
          description={`Test summary sent successfully. You should now see the summary in ${getWorkspaceTypeDisplayName(props.workspaceType)}.`}
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
